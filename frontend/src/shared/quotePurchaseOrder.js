import { apiUpload, getAssetUrl } from "../services/api.js";
import { getSessionUser } from "../services/auth.js";
import { computeQuoteLineFiscalBreakdown, formatFiscalAmount } from "./supplierFiscal.js";

const PDF_TEMPLATE_VERSION = "v1.1";

function generateDocumentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `doc-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function fmtDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("pt-PT")} ${d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`;
}

const MBT_COMPANY = {
  legalName: "MBT LDA",
  name: "MBT ENERGIA",
  nif: "517116264",
  street: "POLIS | Zona Industrial Edifício MBT Energia Estrada da Zootécnica km5 Humpata, Huíla",
  number: "—",
  locality: "Humpata",
  postalCode: "—",
  city: "Huíla",
  country: "AO",
  phone: "(+244) 936 000 271",
  email: "comercial@mbtenergia.com",
  website: "www.mbtenergia.com",
};

const LOGO_URL = "/assets/icon/MBT.png";
let logoDataUrlCache = null;

async function loadMbtLogo() {
  if (logoDataUrlCache) return logoDataUrlCache;
  const res = await fetch(LOGO_URL);
  if (!res.ok) throw new Error("Logo MBT não encontrado.");
  const blob = await res.blob();
  logoDataUrlCache = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return logoDataUrlCache;
}

export async function fetchCatalogSuggestions(searchTerm, suppliers, apiRequest) {
  if (!searchTerm || searchTerm.length < 3 || !suppliers?.length) return [];

  const term = searchTerm.replace(/\(.*?\)/g, "").trim().toLowerCase();
  const results = await Promise.all(
    suppliers.map((s) => apiRequest(`/suppliers/${s.id}/products`).catch(() => ({ items: [] })))
  );

  const matches = [];
  results.forEach((res, index) => {
    const supplier = suppliers[index];
    (res.items || []).forEach((product) => {
      const hay = `${product.name} ${product.description || ""}`.toLowerCase();
      if (hay.includes(term)) {
        matches.push({ supplier, product });
      }
    });
  });

  return matches.sort((a, b) => Number(a.product.price) - Number(b.product.price));
}

function formatOrderNumber(orderNumber) {
  const num = Number(orderNumber) || 1;
  return `EF${String(num).padStart(3, "0")}`;
}

function fmtDate(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-PT");
}

function fmtMoney(value, currency = "AOA") {
  const n = Number(value);
  if (!Number.isFinite(n)) return `0,00 ${currency}`;
  return `${n.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function deliveryEstimate(fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + 30);
  return d;
}

function drawLabelValue(doc, label, value, x, y, labelW = 42, maxW = 80) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(20, 20, 20);
  const lines = doc.splitTextToSize(String(value || "—"), maxW);
  doc.text(lines, x + labelW, y);
  return y + Math.max(lines.length * 3.6, 4.5);
}

function drawPartyBlock(doc, title, party, orderMeta, x, y, colW) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 20);
  doc.text(title, x, y);
  y += 5;

  const fields = [
    [party.roleLabel, party.name],
    ["NIF:", party.nif],
    ["Endereço:", party.street],
    ["N.º:", party.number],
    ["Localidade:", party.locality],
    ["Cód. Postal:", party.postalCode],
    ["Cidade:", party.city],
    ["País:", party.country],
    ["Nº da Encomenda:", orderMeta.orderNo],
    ["Data:", orderMeta.orderDate],
    ["Entrega prevista:", orderMeta.deliveryDate],
    ["Entregue em obra:", orderMeta.deliverySite],
  ];

  fields.forEach(([label, value]) => {
    y = drawLabelValue(doc, label, value, x, y, 34, colW - 36);
  });

  return y;
}

export async function generatePurchaseOrderPdf({ quote, need, supplier, project, quotes }) {
  if (typeof window.jspdf === "undefined") {
    throw new Error("Biblioteca PDF não disponível.");
  }

  const logo = await loadMbtLogo();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const lineItems = (quotes && quotes.length ? quotes : [{ quote, need }]).map((row, idx) => {
    const q = row.quote || row;
    const n = row.need || q.need || need;
    const qty = Number(q.quantity ?? n?.quantity ?? 0);
    const unitPrice = Number(q.quotedPrice || 0);
    const total = Number(q.totalValue ?? qty * unitPrice);
    return {
      idx: idx + 1,
      description: n?.description || q.supplierProduct?.name || "—",
      unit: n?.unit || q.supplierProduct?.unit || "uni",
      qty,
      unitPrice,
      total,
    };
  });

  const firstQuote = quote || quotes?.[0]?.quote || quotes?.[0];
  const firstNeed = need || firstQuote?.need;
  const total = lineItems.reduce((sum, l) => sum + (Number(l.total) || 0), 0);
  const currency = firstQuote?.currency || firstNeed?.costCenter?.currency || "AOA";
  const orderNo = formatOrderNumber(firstQuote?.orderNumber);
  const orderDate = new Date();
  const deliveryDate = deliveryEstimate(orderDate);
  const deliverySite = firstNeed?.siteReceptionLocation?.trim()
    || [project?.location, project?.region].filter(Boolean).join(" - ")
    || project?.name
    || "—";
  const paymentTerm = supplier?.paymentTerm === "CREDITO" ? "Crédito" : "Pronto Pagamento";

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;

  // ── Cabeçalho ───────────────────────────────────────────────────────────────
  doc.addImage(logo, "PNG", margin, 10, 52, 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text("ENCOMENDA A FORNECEDOR", pageW - margin, 18, { align: "right" });

  let y = 30;

  // ── Dados da empresa (MBT) ──────────────────────────────────────────────────
  y = drawLabelValue(doc, "Empresa:", MBT_COMPANY.legalName, margin, y, 28, contentW - 28);
  y = drawLabelValue(doc, "NIF:", MBT_COMPANY.nif, margin, y, 28, contentW - 28);
  y = drawLabelValue(doc, "Tel:", MBT_COMPANY.phone, margin, y, 28, contentW - 28);
  y = drawLabelValue(doc, "Email:", MBT_COMPANY.email, margin, y, 28, contentW - 28);
  y = drawLabelValue(doc, "Web:", MBT_COMPANY.website, margin, y, 28, contentW - 28);

  y += 2;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // ── Fornecedor vs Empresa ───────────────────────────────────────────────────
  const colW = (contentW - 6) / 2;
  const leftX = margin;
  const rightX = margin + colW + 6;
  const blockTop = y;

  const orderMeta = {
    orderNo,
    orderDate: fmtDate(orderDate),
    deliveryDate: fmtDate(deliveryDate),
    deliverySite,
  };

  const supplierParty = {
    roleLabel: "Fornecedor:",
    name: supplier?.name || "—",
    nif: supplier?.nif || "—",
    street: supplier?.address || "—",
    number: "—",
    locality: "—",
    postalCode: "—",
    city: "—",
    country: "—",
  };

  const companyParty = {
    roleLabel: "Empresa:",
    name: MBT_COMPANY.name,
    nif: MBT_COMPANY.nif,
    street: MBT_COMPANY.street,
    number: MBT_COMPANY.number,
    locality: MBT_COMPANY.locality,
    postalCode: MBT_COMPANY.postalCode,
    city: MBT_COMPANY.city,
    country: MBT_COMPANY.country,
  };

  const leftEnd = drawPartyBlock(doc, "FORNECEDOR", supplierParty, orderMeta, leftX, blockTop, colW);
  const rightEnd = drawPartyBlock(doc, "EMPRESA", companyParty, orderMeta, rightX, blockTop, colW);
  y = Math.max(leftEnd, rightEnd) + 4;

  // ── Tabela de itens ─────────────────────────────────────────────────────────
  if (typeof doc.autoTable === "function") {
    doc.autoTable({
      startY: y,
      head: [["Item", "Descrição", "QTD", "Preço unitário", "Total Price"]],
      body: lineItems.map((l) => [
        String(l.idx),
        l.description,
        `${l.qty.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${l.unit}`,
        fmtMoney(l.unitPrice, currency),
        fmtMoney(l.total, currency),
      ]),
      theme: "grid",
      styles: {
        fontSize: 8.5,
        cellPadding: 2.5,
        lineColor: [180, 180, 180],
        lineWidth: 0.2,
        textColor: [20, 20, 20],
      },
      headStyles: {
        fillColor: [217, 217, 217],
        textColor: [20, 20, 20],
        fontStyle: "bold",
        halign: "center",
      },
      columnStyles: {
        0: { halign: "center", cellWidth: 14 },
        1: { halign: "left" },
        2: { halign: "center", cellWidth: 24 },
        3: { halign: "right", cellWidth: 34 },
        4: { halign: "right", cellWidth: 34 },
      },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 6;
  } else {
    doc.setFontSize(9);
    lineItems.forEach((l) => {
      doc.text(`${l.description} — ${l.qty} ${l.unit} × ${fmtMoney(l.unitPrice, currency)} = ${fmtMoney(l.total, currency)}`, margin, y);
      y += 5;
    });
    y += 3;
  }

  // ── Totais ──────────────────────────────────────────────────────────────────
  const totalsX = pageW - margin - 70;
  const drawTotalLine = (label, value, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(9);
    doc.text(label, totalsX, y);
    doc.text(value, pageW - margin, y, { align: "right" });
    y += 5;
  };

  drawTotalLine("Subtotal:", fmtMoney(total, currency));
  const quotesForFiscal = quotes && quotes.length ? quotes : [{ quote, need }];
  let vatTotal = 0;
  let discTotal = 0;
  let whTotal = 0;
  quotesForFiscal.forEach((row) => {
    const q = row.quote || row;
    const n = row.need || q.need || need;
    const qty = Number(q.quantity ?? n?.quantity ?? 0);
    const unitPrice = Number(q.quotedPrice || 0);
    const lineBase = Number(q.totalValue ?? qty * unitPrice);
    const br = computeQuoteLineFiscalBreakdown(q, lineBase, q.supplierProduct);
    vatTotal += br.vat || 0;
    discTotal += br.discount || 0;
    whTotal += br.withholding || 0;
  });
  if (discTotal > 0) drawTotalLine("Desconto:", `−${formatFiscalAmount(discTotal, currency)}`);
  if (vatTotal > 0) {
    drawTotalLine("IVA:", `+${formatFiscalAmount(vatTotal, currency)}`);
    drawTotalLine("Total IVA:", fmtMoney(vatTotal, currency));
  } else {
    drawTotalLine("Total IVA:", "—");
  }
  if (whTotal > 0) drawTotalLine("Retenção:", `−${formatFiscalAmount(whTotal, currency)}`);
  const netTotal = total - discTotal + vatTotal - whTotal;
  drawTotalLine("Total (base):", fmtMoney(total, currency), true);
  if (Math.abs(netTotal - total) > 0.005) {
    drawTotalLine("Líquido a pagar:", fmtMoney(netTotal, currency), true);
  }
  y += 4;

  // ── Observações ─────────────────────────────────────────────────────────────
  const bankAccounts = supplier?.bankAccounts?.length
    ? supplier.bankAccounts
    : supplier?.iban
      ? [{ bankName: "Principal", iban: supplier.iban }]
      : [];

  const notesParts = [
    `Condição de pagamento: ${paymentTerm}.`,
  ];


  if (firstQuote?.notes) notesParts.push(firstQuote.notes);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(40, 40, 40);
  const noteLines = doc.splitTextToSize(notesParts.join(" "), contentW);
  doc.text(noteLines, margin, y);
  y += noteLines.length * 3.6 + 6;

  // ── Rodapé ──────────────────────────────────────────────────────────────────
  const footerY = Math.min(pageH - 26, y + 8);
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.2);
  doc.line(margin, footerY - 4, pageW - margin, footerY - 4);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(20, 20, 20);
  doc.text(`${MBT_COMPANY.legalName} · ${MBT_COMPANY.name}`, margin, footerY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(MBT_COMPANY.street, margin, footerY + 4);
  doc.text(`NIF: ${MBT_COMPANY.nif}  ·  Tel: ${MBT_COMPANY.phone}`, margin, footerY + 8);
  doc.text(`Email: ${MBT_COMPANY.email}  ·  ${MBT_COMPANY.website}`, margin, footerY + 12);

  // ── Rodapé de auditoria / rastreabilidade ────────────────────────────────────
  const issuer = getSessionUser();
  const issuedAt = new Date();
  const documentId = generateDocumentId();

  const auditY = pageH - 5;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.15);
  doc.line(margin, auditY - 3.5, pageW - margin, auditY - 3.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(130, 130, 130);
  const auditLine = `Gerado por: ${issuer?.name || issuer?.email || "—"}  ·  Emitido em: ${fmtDateTime(issuedAt)}  ·  ID: ${documentId}  ·  Modelo ${PDF_TEMPLATE_VERSION}`;
  doc.text(auditLine, margin, auditY);

  const fileOrderNo = orderNo.replace("/", "-");
  return { doc, orderNo: fileOrderNo, documentId, issuedAt: issuedAt.toISOString(), issuedBy: issuer?.name || issuer?.email || null };
}

export async function uploadPurchaseOrderPdf(quoteId, doc, orderNo, meta = {}) {
  const blob = doc.output("blob");
  const form = new FormData();
  form.append("file", blob, `${orderNo}.pdf`);
  if (meta.documentId) form.append("documentId", meta.documentId);
  if (meta.issuedBy) form.append("issuedBy", meta.issuedBy);
  if (meta.issuedAt) form.append("issuedAt", meta.issuedAt);
  const res = await apiUpload(`/quotes/${quoteId}/purchase-order`, form, "POST");
  return res?.purchaseOrderUrl || null;
}

export async function uploadBundlePurchaseOrderPdf(orderId, doc, orderNo, meta = {}) {
  const blob = doc.output("blob");
  const form = new FormData();
  form.append("file", blob, `${orderNo}.pdf`);
  if (meta.documentId) form.append("documentId", meta.documentId);
  if (meta.issuedBy) form.append("issuedBy", meta.issuedBy);
  if (meta.issuedAt) form.append("issuedAt", meta.issuedAt);
  const res = await apiUpload(`/quotes/supplier-orders/${orderId}/purchase-order`, form, "POST");
  return res?.purchaseOrderUrl || null;
}

export function downloadPurchaseOrderPdf(doc, orderNo) {
  doc.save(`${orderNo}.pdf`);
}
