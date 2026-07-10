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

/**
 * Aplica uma movimentação (crédito/débito/ajuste) num Fundo de Maneio de forma
 * transacional e segura contra concorrência. Débitos nunca podem levar o saldo
 * a negativo — a operação falha atomically (nenhuma escrita parcial).
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

    if (cardId) {
      const card = await tx.pettyCashCard.findFirst({ where: { id: cardId, fundId } });
      if (!card) throw new Error("CARD_NOT_FOUND");
    }

    const delta = type === "DEBITO" ? -amountNum : amountNum;

    if (type === "DEBITO") {
      // Actualização condicional atómica: só sucede se o saldo actual comportar o débito.
      const updateResult = await tx.pettyCashFund.updateMany({
        where: { id: fundId, currentBalance: { gte: amountNum } },
        data: { currentBalance: { decrement: amountNum } },
      });
      if (updateResult.count === 0) {
        throw new InsufficientBalanceError();
      }
    } else {
      await tx.pettyCashFund.update({
        where: { id: fundId },
        data: { currentBalance: { increment: delta } },
      });
    }

    const updatedFund = await tx.pettyCashFund.findUnique({ where: { id: fundId } });

    const movement = await tx.pettyCashMovement.create({
      data: {
        fundId,
        cardId: cardId || null,
        type,
        amount: String(amountNum),
        balanceAfter: updatedFund.currentBalance,
        description,
        extraRequestId: extraRequestId || null,
        createdBy,
      },
    });

    return { movement, fund: updatedFund };
  });
}

module.exports = {
  InsufficientBalanceError,
  applyFundMovement,
  logFundAction,
};
