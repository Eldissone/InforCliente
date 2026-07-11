const { prisma } = require("../db");

const TOLERANCE_PERCENT = 0.01;
const TOLERANCE_MIN = 100;
const DATE_WINDOW_DAYS = 14;

function withinTolerance(expected, actual) {
  const exp = Number(expected) || 0;
  const act = Number(actual) || 0;
  const diff = Math.abs(exp - act);
  const tol = Math.max(TOLERANCE_MIN, exp * TOLERANCE_PERCENT);
  return diff <= tol;
}

function paymentDateWindow(paymentDate) {
  const center = new Date(paymentDate);
  const from = new Date(center);
  from.setDate(from.getDate() - DATE_WINDOW_DAYS);
  const to = new Date(center);
  to.setDate(to.getDate() + DATE_WINDOW_DAYS);
  return { from, to };
}

/**
 * Recolhe transferências e débitos de fundo de maneio que possam corresponder
 * a um pagamento liquidado (mesma obra, valor e janela temporal).
 */
async function gatherPaymentEvidence(payment) {
  const invoiceAmount = Number(payment.paidAmount) || 0;
  const { from, to } = paymentDateWindow(payment.paymentDate);
  const evidence = [];
  const seenIds = new Set();

  const pushEvidence = (item) => {
    const key = `${item.type}:${item.id}`;
    if (seenIds.has(key)) return;
    seenIds.add(key);
    evidence.push(item);
  };

  const txs = await prisma.projectTransaction.findMany({
    where: {
      projectId: payment.projectId,
      status: "PAID",
      date: { gte: from, lte: to },
      ...(payment.costCenterId ? { costCenterId: payment.costCenterId } : {}),
    },
    select: {
      id: true,
      amount: true,
      realizedAmount: true,
      date: true,
      description: true,
      supplier: true,
    },
  });

  for (const tx of txs) {
    const txAmount = Number(tx.realizedAmount ?? tx.amount) || 0;
    if (withinTolerance(invoiceAmount, txAmount)) {
      pushEvidence({
        type: "TRANSFERENCIA",
        id: tx.id,
        amount: txAmount,
        date: tx.date,
        label: tx.description || tx.supplier || "Transferência",
      });
    }
  }

  const extras = await prisma.extraRequest.findMany({
    where: {
      projectId: payment.projectId,
      status: "PAGO",
      paidAt: { gte: from, lte: to },
    },
    select: {
      id: true,
      amount: true,
      paidAt: true,
      description: true,
      paymentSource: true,
    },
  });

  for (const ex of extras) {
    const exAmount = Number(ex.amount) || 0;
    if (withinTolerance(invoiceAmount, exAmount)) {
      pushEvidence({
        type: "PEDIDO_EXTRA",
        id: ex.id,
        amount: exAmount,
        date: ex.paidAt,
        label: ex.description || "Pedido extra",
        paymentSource: ex.paymentSource,
      });
    }
  }

  const movements = await prisma.pettyCashMovement.findMany({
    where: {
      type: "DEBITO",
      createdAt: { gte: from, lte: to },
      extraRequest: { projectId: payment.projectId },
    },
    select: {
      id: true,
      amount: true,
      createdAt: true,
      description: true,
      extraRequest: { select: { id: true, description: true } },
    },
  });

  for (const m of movements) {
    const mAmount = Number(m.amount) || 0;
    if (withinTolerance(invoiceAmount, mAmount)) {
      pushEvidence({
        type: "FUNDO_MANEIO",
        id: m.id,
        amount: mAmount,
        date: m.createdAt,
        label: m.description || m.extraRequest?.description || "Débito fundo de maneio",
      });
    }
  }

  const evidenceTotal = evidence.reduce((sum, e) => sum + e.amount, 0);
  return { evidence, evidenceTotal, invoiceAmount };
}

async function analyzeCertification(payment) {
  const { evidence, evidenceTotal, invoiceAmount } = await gatherPaymentEvidence(payment);

  let suggestedStatus = "PENDENTE";
  let reason = "";

  if (!payment.faturaUrl) {
    reason = "Fatura ainda não anexada — aguarda documento para certificação.";
  } else if (evidence.length === 0) {
    if (payment.comprovativoUrl) {
      reason =
        "Comprovativo e fatura anexados, mas nenhuma transferência ou débito de fundo de maneio foi encontrado automaticamente para este valor e período.";
    } else {
      reason =
        "Nenhuma transferência ou débito de fundo de maneio encontrado para este valor e período.";
    }
    suggestedStatus = "PENDENTE";
  } else if (withinTolerance(invoiceAmount, evidenceTotal)) {
    suggestedStatus = "CONFORME";
    reason = `Valor liquidado (${invoiceAmount.toFixed(2)}) corresponde ao histórico financeiro encontrado (${evidenceTotal.toFixed(2)}).`;
  } else {
    suggestedStatus = "DIVERGENTE";
    reason = `Valor liquidado (${invoiceAmount.toFixed(2)}) difere do histórico encontrado (${evidenceTotal.toFixed(2)}).`;
  }

  return {
    suggestedStatus,
    reason,
    evidence,
    evidenceTotal,
    invoiceAmount,
    tolerancePercent: TOLERANCE_PERCENT,
    toleranceMin: TOLERANCE_MIN,
  };
}

async function loadPaymentForCertification(paymentId) {
  return prisma.costPayment.findUnique({
    where: { id: paymentId },
    include: {
      project: { select: { id: true, name: true, code: true } },
      costCenter: { select: { id: true, code: true, name: true, currency: true } },
      supplierRef: { select: { id: true, name: true, nif: true } },
    },
  });
}

async function certifyPayment(paymentId, user, { status, notes, useSuggestion = false } = {}) {
  const payment = await loadPaymentForCertification(paymentId);
  if (!payment) {
    const err = new Error("PAYMENT_NOT_FOUND");
    err.code = "PAYMENT_NOT_FOUND";
    throw err;
  }
  if (payment.status !== "CONFIRMADO") {
    const err = new Error("PAYMENT_NOT_CONFIRMED");
    err.code = "PAYMENT_NOT_CONFIRMED";
    throw err;
  }

  const analysis = await analyzeCertification(payment);
  let finalStatus = status;

  if (useSuggestion) {
    finalStatus = analysis.suggestedStatus;
  }

  if (!["CONFORME", "DIVERGENTE"].includes(finalStatus)) {
    const err = new Error("INVALID_CERTIFICATION_STATUS");
    err.code = "INVALID_CERTIFICATION_STATUS";
    err.analysis = analysis;
    throw err;
  }

  const certifierName = user?.name || user?.email || user?.sub || "Sistema";
  const updated = await prisma.costPayment.update({
    where: { id: paymentId },
    data: {
      certificationStatus: finalStatus,
      certifiedBy: certifierName,
      certifiedAt: new Date(),
      certificationNotes: notes?.trim() || analysis.reason,
    },
    include: {
      project: { select: { id: true, name: true, code: true } },
      costCenter: { select: { id: true, code: true, name: true, currency: true } },
      supplierRef: { select: { id: true, name: true, nif: true } },
    },
  });

  return { payment: updated, analysis };
}

async function getAuditSummary(where = {}) {
  const baseWhere = {
    status: "CONFIRMADO",
    ...where,
  };

  const [pending, conforme, divergente, total] = await Promise.all([
    prisma.costPayment.count({ where: { ...baseWhere, certificationStatus: "PENDENTE" } }),
    prisma.costPayment.count({ where: { ...baseWhere, certificationStatus: "CONFORME" } }),
    prisma.costPayment.count({ where: { ...baseWhere, certificationStatus: "DIVERGENTE" } }),
    prisma.costPayment.count({ where: baseWhere }),
  ]);

  return { pending, conforme, divergente, total };
}

module.exports = {
  withinTolerance,
  gatherPaymentEvidence,
  analyzeCertification,
  loadPaymentForCertification,
  certifyPayment,
  getAuditSummary,
  TOLERANCE_PERCENT,
  TOLERANCE_MIN,
};
