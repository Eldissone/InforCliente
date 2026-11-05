/**
 * Valores de uma fatura emitida ao cliente, a partir do V. Ilíquido e das
 * percentagens (da fatura ou, na falta delas, da configuração da obra).
 *
 *   IVA            = ilíquido × % IVA                 (o IVA do documento)
 *   IVA cativo     = IVA × % cativação (0, 50, 100)   (o cliente entrega-o ao Estado)
 *   Líquido        = ilíquido + IVA − IVA cativo − retenção − CAR − garantia
 *
 * Retenção, CAR e garantia incidem sobre o ilíquido.
 *
 * Amortização de adiantamento: a fatura indica o valor dos trabalhos e a parte
 * do adiantamento a descontar; o ilíquido do documento é a diferença (o IVA do
 * adiantamento já foi faturado na fatura de adiantamento).
 */

const CATIVO_LEVELS = [0, 50, 100];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function isSet(value) {
  return value !== null && value !== undefined && value !== "";
}

/**
 * % do IVA cativo. Ordem: valor explícito → marca antiga «cativo» (= 100%) →
 * configuração da obra (% ou marca antiga) → 0.
 */
function resolveCativoPercent(raw = {}, config = {}) {
  let pct;
  if (isSet(raw.vatCativoPercent)) pct = toNumber(raw.vatCativoPercent);
  else if (raw.flagVatCativo !== undefined && raw.flagVatCativo !== null) pct = raw.flagVatCativo ? 100 : 0;
  else if (isSet(config.billingVatCativoPercent)) pct = toNumber(config.billingVatCativoPercent);
  else pct = config.billingVatCativo ? 100 : 0;
  return Math.min(Math.max(pct, 0), 100);
}

function computeInvoiceAmounts(raw, config = {}) {
  const advanceDeductionAmount = round2(Math.max(toNumber(raw.advanceDeductionAmount), 0));
  const workValue = round2(isSet(raw.workValue) ? raw.workValue : raw.grossAmount);
  const gross = round2(workValue - advanceDeductionAmount);
  const pick = (value, fallback) => (isSet(value) ? toNumber(value) : toNumber(fallback));
  const vatPercent = pick(raw.vatPercent, config.billingVatPercent);
  const withholdingPercent = pick(raw.withholdingPercent, config.billingWithholdingPercent);
  const carPercent = pick(raw.carPercent, config.billingCarPercent);
  const guaranteePercent = pick(raw.guaranteePercent, config.billingGuaranteePercent);
  const vatCativoPercent = resolveCativoPercent(raw, config);

  const vatAmount = round2((gross * vatPercent) / 100);
  const vatCativoAmount = round2((vatAmount * vatCativoPercent) / 100);
  const withholdingAmount = round2((gross * withholdingPercent) / 100);
  const carInsuranceAmount = round2((gross * carPercent) / 100);
  const guaranteeAmount = round2((gross * guaranteePercent) / 100);
  const netAmount = round2(
    gross + vatAmount - vatCativoAmount - withholdingAmount - carInsuranceAmount - guaranteeAmount
  );

  return {
    grossAmount: gross,
    workValue,
    advanceDeductionAmount,
    vatAmount,
    vatCativoPercent,
    vatCativoAmount,
    withholdingAmount,
    carInsuranceAmount,
    guaranteeAmount,
    netAmount,
    flagVatCativo: vatCativoPercent > 0,
    flagRetention: withholdingPercent > 0,
    flagCar: carPercent > 0,
    flagGuarantee: guaranteePercent > 0,
  };
}

/**
 * Valor em aberto de um documento: líquido − recebido − anulado por notas de
 * crédito. Uma nota de crédito não fica em aberto (é aplicada à fatura que
 * corrige). Pode ser negativo: crédito a favor do cliente.
 */
function invoiceOpenAmount(invoice) {
  if (!invoice || invoice.kind === "NOTA_CREDITO") return 0;
  const net = toNumber(invoice.netAmount ?? invoice.grossAmount);
  return round2(net - toNumber(invoice.receivedAmount) - toNumber(invoice.creditedAmount));
}

/** Valores de uma nota de crédito: os da fatura original, na proporção do ilíquido anulado, a negativo. */
function creditNoteAmounts(original, grossToCredit) {
  const base = toNumber(original.grossAmount);
  const ratio = base > 0 ? toNumber(grossToCredit) / base : 0;
  const part = (v) => -round2(toNumber(v) * ratio);
  const gross = -round2(grossToCredit);
  const vatAmount = part(original.vatAmount);
  const vatCativoAmount = part(original.vatCativoAmount);
  const withholdingAmount = part(original.withholdingAmount);
  const carInsuranceAmount = part(original.carInsuranceAmount);
  const guaranteeAmount = part(original.guaranteeAmount);
  return {
    grossAmount: gross,
    vatAmount,
    vatCativoAmount,
    withholdingAmount,
    carInsuranceAmount,
    guaranteeAmount,
    netAmount: round2(gross + vatAmount - vatCativoAmount - withholdingAmount - carInsuranceAmount - guaranteeAmount),
  };
}

/**
 * Faturado (receita) de um conjunto de documentos: soma dos ilíquidos menos o
 * adiantamento ainda por amortizar — o adiantamento só é receita à medida que é
 * descontado nas faturas de trabalhos. As notas de crédito entram a negativo.
 */
function billedRevenue(invoices) {
  let gross = 0;
  let advances = 0;
  let amortized = 0;
  (invoices || []).forEach((i) => {
    gross += toNumber(i.grossAmount);
    if (i.kind === "ADIANTAMENTO") advances += toNumber(i.grossAmount);
    amortized += toNumber(i.advanceDeductionAmount);
  });
  const advanceOutstanding = round2(Math.max(advances - amortized, 0));
  return { invoiced: round2(gross - advanceOutstanding), advanceOutstanding };
}

module.exports = { CATIVO_LEVELS, billedRevenue, computeInvoiceAmounts, creditNoteAmounts, invoiceOpenAmount, resolveCativoPercent };
