import { formatDateBR } from "./format.js";

function fmtQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0,00";
  return v.toLocaleString("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoney(n, currency = "Kz") {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  return `${v.toLocaleString("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0,00%";
  return `${v.toFixed(2)}%`;
}

function rowClassToFill(rowClass) {
  if (rowClass === "grand") return "E2E8F0";
  if (rowClass === "section") return "212E3E";
  if (rowClass === "category") return "DBEAFE";
  return "FFFFFF";
}

function rowClassToFont(rowClass) {
  if (rowClass === "section") return { color: "FFFFFF", bold: true };
  if (rowClass === "category") return { color: "1E3A8A", bold: true };
  if (rowClass === "grand") return { color: "0F172A", bold: true };
  return { color: "334155", bold: false };
}

function snapshotTableHead(currency) {
  return [
    "Código WBS", "Descrição", "UN", "QUANT", `PU (${currency})`, `TOTAL (${currency})`, "% Global",
    "Acum. QTD", "Acum. TOTAL", "Acum. %",
    "Ant. QTD", "Ant. TOTAL", "Ant. %",
    "Período QTD", "Período TOTAL", "Período %",
    "Aberto QTD", "Aberto TOTAL", "Aberto %",
  ];
}

function snapshotRowToArray(row) {
  const curr = row.currency || "Kz";
  const totalVal = row.totalVal || 0;
  const accPct = totalVal > 0 ? (row.accVal / totalVal) * 100 : 0;
  const prevPct = totalVal > 0 ? (row.prevVal / totalVal) * 100 : 0;
  const periodPct = totalVal > 0 ? (row.periodVal / totalVal) * 100 : 0;
  const openVal = row.openVal ?? Math.max(0, totalVal - (row.accVal || 0));
  const openPct = totalVal > 0 ? (openVal / totalVal) * 100 : 0;

  return [
    row.wbs || "",
    row.description || "",
    row.unit || "",
    fmtQty(row.exp),
    row.uv > 0 ? fmtMoney(row.uv, curr) : "—",
    totalVal > 0 ? fmtMoney(totalVal, curr) : "—",
    fmtPct(row.pctGlobal ?? 0),
    fmtQty(row.acc),
    row.accVal > 0 ? fmtMoney(row.accVal, curr) : "—",
    fmtPct(accPct),
    fmtQty(row.prev),
    row.prevVal > 0 ? fmtMoney(row.prevVal, curr) : "—",
    fmtPct(prevPct),
    fmtQty(row.period),
    row.periodVal > 0 ? fmtMoney(row.periodVal, curr) : "—",
    fmtPct(periodPct),
    fmtQty(row.open),
    openVal > 0 ? fmtMoney(openVal, curr) : "—",
    fmtPct(openPct),
  ];
}

export function exportMeasurementExcel(snapshot, projectMeta = {}) {
  if (typeof XLSX === "undefined") {
    throw new Error("Biblioteca Excel não carregada.");
  }

  const currency = snapshot.meta?.currency || projectMeta.currency || "Kz";
  const meta = snapshot.meta || {};
  const title = `AUTO DE MEDIÇÃO Nº ${meta.reportNumber || "—"} — ${projectMeta.name || meta.projectName || "Obra"}`;
  const subtitle = [
    meta.currentDate ? `Data: ${formatDateBR(meta.currentDate)}` : null,
    meta.prevDate ? `Auto anterior até: ${formatDateBR(meta.prevDate)}` : null,
    projectMeta.location ? `Local: ${projectMeta.location}` : null,
  ].filter(Boolean).join(" | ");

  const aoa = [
    [title],
    [subtitle],
    [],
    snapshotTableHead(currency),
    ...[snapshot.grand, ...snapshot.rows].map(snapshotRowToArray),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 12 }, { wch: 42 }, { wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 10 },
    { wch: 12 }, { wch: 16 }, { wch: 8 },
    { wch: 12 }, { wch: 16 }, { wch: 8 },
    { wch: 12 }, { wch: 16 }, { wch: 8 },
    { wch: 12 }, { wch: 16 }, { wch: 8 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Auto de Medição");
  const fname = `${(projectMeta.name || "obra").replace(/[^\w\s-]/gi, "").trim().replace(/\s+/g, "_")}_auto_${meta.reportNumber || "01"}.xlsx`;
  XLSX.writeFile(wb, fname);
}

export function exportMeasurementPdf(snapshot, projectMeta = {}) {
  if (typeof window.jspdf === "undefined") {
    throw new Error("Biblioteca PDF não carregada.");
  }

  const { jsPDF } = window.jspdf;
  const currency = snapshot.meta?.currency || projectMeta.currency || "Kz";
  const meta = snapshot.meta || {};
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const margin = 8;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(`AUTO DE MEDIÇÃO Nº ${meta.reportNumber || "—"}`, margin, 12);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(projectMeta.name || meta.projectName || "Obra", margin, 18);
  if (meta.currentDate) doc.text(`Data: ${formatDateBR(meta.currentDate)}`, margin, 23);
  if (meta.prevDate) doc.text(`Auto anterior até: ${formatDateBR(meta.prevDate)}`, margin, 28);

  const head = [snapshotTableHead(currency)];
  const body = [snapshot.grand, ...snapshot.rows].map(snapshotRowToArray);

  doc.autoTable({
    startY: 32,
    head,
    body,
    styles: { fontSize: 6, cellPadding: 1.2 },
    headStyles: { fillColor: [33, 46, 62], textColor: 255, fontStyle: "bold" },
    margin: { left: margin, right: margin },
  });

  const fname = `${(projectMeta.name || "obra").replace(/[^\w\s-]/gi, "").trim().replace(/\s+/g, "_")}_auto_${meta.reportNumber || "01"}.pdf`;
  doc.save(fname);
}
