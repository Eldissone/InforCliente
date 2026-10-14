import { getAssetUrl } from "../../services/api.js";
import { openModal } from "../ui.js";
import { escapeFinanceHtml as esc } from "../financePage.js";

/**
 * Visualização da fatura física (PDF ou fotografia) na Área Financeira.
 * Usado pelo ecrã «Registar Faturas» e pela «Faturação Prevista».
 */

export function invoiceHasDocument(invoice) {
  return Boolean(invoice?.documentPath || invoice?.hasDocument);
}

function isImageDocument(invoice) {
  const mime = String(invoice?.documentMimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  if (mime.includes("pdf")) return false;
  return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(String(invoice?.documentPath || ""));
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderViewer(invoice) {
  const url = getAssetUrl(invoice.documentPath);
  if (!url) {
    return `<div class="finance-empty">
        <span class="material-symbols-outlined">image_not_supported</span>
        Não foi possível abrir o ficheiro da fatura.
      </div>`;
  }
  if (isImageDocument(invoice)) {
    return `
      <div style="display:flex;justify-content:center;background:#f8fafc;border-radius:12px;padding:0.5rem">
        <img src="${esc(url)}" alt="Fatura física" style="max-width:100%;max-height:72vh;object-fit:contain;border-radius:8px" />
      </div>`;
  }
  return `
    <iframe src="${esc(url)}" title="Fatura física" style="width:100%;height:72vh;border:1px solid #e2e8f0;border-radius:12px;background:#fff"></iframe>`;
}

/**
 * Abre a fatura física num modal com pré-visualização e link de download.
 * `context` permite mostrar a obra e o nº do documento no cabeçalho.
 */
export function openInvoiceDocumentModal(invoice, { context = null } = {}) {
  if (!invoiceHasDocument(invoice)) return false;

  const meta = [
    invoice.docNumber ? `Nº ${invoice.docNumber}` : null,
    context?.projectName || null,
    invoice.documentName || null,
    formatSize(invoice.documentSize) || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const url = getAssetUrl(invoice.documentPath);

  openModal({
    title: `Fatura física${invoice.docNumber ? ` — ${invoice.docNumber}` : ""}`,
    contentHtml: `
      ${meta ? `<p class="finance-note" style="margin-bottom:0.75rem">${esc(meta)}</p>` : ""}
      ${renderViewer(invoice)}`,
    primaryLabel: "Abrir em nova janela",
    secondaryLabel: "Fechar",
    onPrimary: () => {
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    },
    onRender: ({ panel }) => {
      // Alarga o painel para a fatura ser legível.
      panel.classList.remove("max-w-[640px]");
      panel.classList.add("max-w-[1100px]");
    },
  });

  return true;
}
