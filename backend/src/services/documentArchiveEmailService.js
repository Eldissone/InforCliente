const { config } = require("../config");
const emailProvider = require("./notifications/providers/emailProvider");

function formatMoney(value, currency = "AOA") {
  const n = Number(value);
  if (!Number.isFinite(n)) return `0,00 ${currency}`;
  return `${n.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/**
 * Envia e-mail ao arquivo documental quando um pagamento é liquidado.
 * Requer DOCUMENT_ARCHIVE_EMAIL + provider SMTP/SendGrid configurado.
 */
async function notifyDocumentArchiveOnPayment(payment) {
  const archiveEmail = config.notifications.email.documentArchiveEmail;
  if (!archiveEmail || !emailProvider.isConfigured()) {
    return { sent: false, reason: "NOT_CONFIGURED" };
  }

  const cur = payment.costCenter?.currency || "AOA";
  const amount = formatMoney(payment.paidAmount || payment.budgetedAmount, cur);
  const projectName = payment.project?.name || payment.project?.code || "Obra";
  const supplier = payment.supplier || payment.supplierRef?.name || "—";
  const title = `Arquivo documental · Liquidação · ${projectName}`;
  const body = [
    `Obra: ${projectName}`,
    `Descrição: ${payment.description}`,
    `Fornecedor: ${supplier}`,
    `Valor: ${amount}`,
    `Data pagamento: ${new Date(payment.paymentDate).toLocaleDateString("pt-PT")}`,
    payment.docNumber ? `N.º documento: ${payment.docNumber}` : null,
    payment.comprovativoUrl ? `Comprovativo: ${payment.comprovativoUrl}` : null,
    payment.faturaUrl ? `Fatura: ${payment.faturaUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const attachments = [];
  if (payment.comprovativoUrl) {
    attachments.push({ url: payment.comprovativoUrl, filename: "comprovativo.pdf" });
  }
  if (payment.faturaUrl) {
    attachments.push({ url: payment.faturaUrl, filename: "fatura.pdf" });
  }

  const result = await emailProvider.send({
    user: { id: "document-archive", email: archiveEmail },
    title,
    body,
    link: payment.comprovativoUrl || payment.faturaUrl || null,
    attachments,
  });

  return {
    sent: result.status === "SENT",
    status: result.status,
    reason: result.reason,
  };
}

module.exports = { notifyDocumentArchiveOnPayment };
