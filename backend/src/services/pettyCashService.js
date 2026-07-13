// Serviço financeiro centralizado para o Fundo de Maneio (Fase 7/8).
// Toda movimentação de saldo passa por aqui para garantir consistência,
// auditoria e proteção contra condições de corrida (race conditions).
const { prisma } = require("../db");
const { createLog } = require("./logService");

class InsufficientBalanceError extends Error {
  constructor(message = "SALDO_INSUFICIENTE") {
    super(message);
    this.name = "InsufficientBalanceError";
    this.statusCode = 422;
  }
}

async function logFundAction(req, { action, fundId, details }) {
  const u = req?.user || {};
  await createLog({
    userId: u.sub || u.id || null,
    userName: u.name || null,
    userEmail: u.email || null,
    action,
    module: "pettyCash",
    status: "success",
    ipAddress: req?.ip || null,
    userAgent: String(req?.headers?.["user-agent"] || ""),
    details: { fundId, ...(details || null) },
  });
}

class CardRequiredError extends Error {
  constructor(message = "CARD_REQUIRED") {
    super(message);
    this.name = "CardRequiredError";
    this.statusCode = 422;
  }
}

async function sumActiveCardsBalance(tx, fundId) {
  const cards = await tx.pettyCashCard.findMany({
    where: { fundId, active: true },
    select: { currentBalance: true },
  });
  return cards.reduce((sum, c) => sum + Number(c.currentBalance), 0);
}

/** Mantém fund.currentBalance = soma dos cartões activos (quando existem cartões). */
async function syncFundBalanceFromCards(tx, fundId) {
  const activeCount = await tx.pettyCashCard.count({ where: { fundId, active: true } });
  if (activeCount === 0) return null;
  const total = await sumActiveCardsBalance(tx, fundId);
  return tx.pettyCashFund.update({
    where: { id: fundId },
    data: { currentBalance: String(total) },
  });
}

/**
 * Aplica uma movimentação (crédito/débito/ajuste) num Fundo de Maneio de forma
 * transacional e segura contra concorrência. Débitos nunca podem levar o saldo
 * a negativo — a operação falha atomically (nenhuma escrita parcial).
 *
 * O saldo "vive" no cartão: quando o fundo tem cartões activos,
 * toda movimentação exige `cardId` e o saldo do fundo é sempre a soma
 * dos cartões activos (sincronizado após cada operação).
 * Fundos sem cartões (legado) continuam a operar ao nível do próprio fundo.
 */
async function applyFundMovement({
  fundId,
  cardId = null,
  type,
  amount,
  description,
  extraRequestId = null,
  createdBy = null,
}) {
  const amountNum = Number(amount);
  if (!fundId) throw new Error("FUND_ID_REQUIRED");
  if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error("INVALID_AMOUNT");
  if (!["CREDITO", "DEBITO", "AJUSTE"].includes(type)) throw new Error("INVALID_MOVEMENT_TYPE");

  return prisma.$transaction(async (tx) => {
    const fund = await tx.pettyCashFund.findUnique({ where: { id: fundId } });
    if (!fund) throw new Error("FUND_NOT_FOUND");
    if (!fund.active) throw new Error("FUND_INACTIVE");

    let card = null;
    if (cardId) {
      card = await tx.pettyCashCard.findFirst({ where: { id: cardId, fundId } });
      if (!card) throw new Error("CARD_NOT_FOUND");
      if (!card.active) throw new Error("CARD_INACTIVE");
    } else {
      const activeCardsCount = await tx.pettyCashCard.count({ where: { fundId, active: true } });
      if (activeCardsCount > 0) throw new CardRequiredError();
    }

    const delta = type === "DEBITO" ? -amountNum : amountNum;

    if (type === "DEBITO") {
      if (card) {
        const cardUpdateResult = await tx.pettyCashCard.updateMany({
          where: { id: card.id, currentBalance: { gte: amountNum } },
          data: { currentBalance: { decrement: amountNum } },
        });
        if (cardUpdateResult.count === 0) throw new InsufficientBalanceError();
      } else {
        const updateResult = await tx.pettyCashFund.updateMany({
          where: { id: fundId, currentBalance: { gte: amountNum } },
          data: { currentBalance: { decrement: amountNum } },
        });
        if (updateResult.count === 0) throw new InsufficientBalanceError();
      }
    } else if (card) {
      await tx.pettyCashCard.update({ where: { id: card.id }, data: { currentBalance: { increment: delta } } });
    } else {
      await tx.pettyCashFund.update({
        where: { id: fundId },
        data: { currentBalance: { increment: delta } },
      });
    }

    if (card) {
      await syncFundBalanceFromCards(tx, fundId);
    }

    const updatedFund = await tx.pettyCashFund.findUnique({ where: { id: fundId } });
    const updatedCard = card ? await tx.pettyCashCard.findUnique({ where: { id: card.id } }) : null;

    const movement = await tx.pettyCashMovement.create({
      data: {
        fundId,
        cardId: cardId || null,
        type,
        amount: String(amountNum),
        balanceAfter: updatedCard ? updatedCard.currentBalance : updatedFund.currentBalance,
        description,
        extraRequestId: extraRequestId || null,
        createdBy,
      },
    });

    return { movement, fund: updatedFund, card: updatedCard };
  });
}

module.exports = {
  InsufficientBalanceError,
  CardRequiredError,
  applyFundMovement,
  logFundAction,
  syncFundBalanceFromCards,
  sumActiveCardsBalance,
};
