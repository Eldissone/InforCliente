import { formatDateBR } from "./format.js";
import { escapeHtml } from "./ui.js";

const HEADER_BLUE = [33, 46, 62];
const EXCEL_NAVY = "212E3E";
const EXCEL_WHITE = "FFFFFF";
const EXCEL_ZEBRA = "F8FAFC";

const EXCEL_STYLES = {
  headerLabel: {
    fill: { patternType: "solid", fgColor: { rgb: EXCEL_NAVY } },
    font: { color: { rgb: EXCEL_WHITE }, bold: true, sz: 10 },
    alignment: { vertical: "center" },
  },
  headerValue: {
    fill: { patternType: "solid", fgColor: { rgb: EXCEL_NAVY } },
    font: { color: { rgb: EXCEL_WHITE }, sz: 10 },
    alignment: { vertical: "center", wrapText: true },
  },
  globalLabel: {
    fill: { patternType: "solid", fgColor: { rgb: EXCEL_NAVY } },
    font: { color: { rgb: EXCEL_WHITE }, bold: true, sz: 9 },
    alignment: { horizontal: "center", vertical: "top" },
  },
  globalPct: {
    fill: { patternType: "solid", fgColor: { rgb: EXCEL_NAVY } },
    font: { color: { rgb: EXCEL_WHITE }, bold: true, sz: 20 },
    alignment: { horizontal: "center", vertical: "center" },
  },
  title: {
    font: { bold: true, sz: 11 },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
  },
  tableHead: {
    fill: { patternType: "solid", fgColor: { rgb: EXCEL_NAVY } },
    font: { color: { rgb: EXCEL_WHITE }, bold: true, sz: 9 },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
  },
  groupRow: {
    fill: { patternType: "solid", fgColor: { rgb: EXCEL_NAVY } },
    font: { color: { rgb: EXCEL_WHITE }, bold: true, sz: 10 },
    alignment: { vertical: "center", wrapText: true },
  },
  dataText: {
    font: { sz: 10 },
    alignment: { vertical: "center", wrapText: true },
  },
  dataCenter: {
    font: { sz: 10 },
    alignment: { horizontal: "center", vertical: "center" },
  },
  dataNum: {
    font: { sz: 10 },
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: "#,##0.00",
  },
  dataPct: {
    font: { sz: 10 },
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: "0.00%",
  },
};

function excelCellRef(r, c) {
  return XLSX.utils.encode_cell({ r, c });
}

function setExcelCell(ws, r, c, value, style) {
  const ref = excelCellRef(r, c);
  const isNum = typeof value === "number" && Number.isFinite(value);
  ws[ref] = {
    v: isNum ? value : value ?? "",
    t: isNum ? "n" : "s",
    ...(style ? { s: style } : {}),
  };
}

function pushExcelMerge(merges, r1, c1, r2, c2) {
  merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
}

function applyExcelZebra(ws, row, cols, zebra) {
  if (!zebra) return;
  cols.forEach((c) => {
    const ref = excelCellRef(row, c);
    if (ws[ref]?.s) {
      ws[ref].s = {
        ...ws[ref].s,
        fill: { patternType: "solid", fgColor: { rgb: EXCEL_ZEBRA } },
      };
    }
  });
}

function groupLabelForFilter(t) {
  return escapeHtml(t.itemGroup || "Outros / Geral");
}

function fmtQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return v.toLocaleString("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0,00%";
  return `${v.toFixed(2)}%`;
}

function contractMonthsLabel(startDate, dueDate) {
  if (!startDate || !dueDate) return "—";
  const start = new Date(startDate);
  const end = new Date(dueDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";
  const months = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.44)));
  return `${months} MESES`;
}

/** Metadados do relatório a partir do dashboard e/ou projeto completo. */
export function resolveContractualReportMeta(projectId, dashboardData, projectDetail) {
  const dash = dashboardData?.projects?.find((p) => p.id === projectId);
  const p = projectDetail || {};
  const name = p.name || dash?.name || "—";
  const location = p.location || p.region || dash?.location || dash?.region || "—";

  return {
    obra: name,
    local: location,
    empreiteiro: p.empreiteiro || dash?.empreiteiro || "—",
    subempreiteiro: p.subempreiteiro || dash?.subempreiteiro || "—",
    directorObra: p.directorObra || dash?.director?.name || "—",
    referencia: p.referencia || dash?.referencia || "",
    dataConsignacao: p.startDate || dash?.startDate || null,
    prazoContratual: contractMonthsLabel(
      p.startDate || dash?.startDate,
      p.dueDate || dash?.dueDate
    ),
    reportNumber: "00",
    reportDate: new Date(),
    globalPct: Number(
      p.physicalProgressPct ?? dash?.progress ?? dashboardData?.overallProgress ?? 0
    ),
    titleSuffix: (name || "").toUpperCase(),
  };
}

function taskQuantities(task, children) {
  let exp = Number(task.expectedQty || 0);
  let exe = Number(task.executedQty || 0);
  const subs = children.filter((c) => c.parentId === task.id);
  if (subs.length > 0) {
    exp = subs.reduce((acc, s) => acc + Number(s.expectedQty || 0), 0);
    exe = subs.reduce((acc, s) => acc + Number(s.executedQty || 0), 0);
  }
  const remaining = Math.max(0, exp - exe);
  const pct = exp > 0 ? (exe / exp) * 100 : exe > 0 ? 100 : 0;
  return { exp, exe, remaining, pct };
}

/**
 * Linhas planas para exportação (quantidades, estilo relatório de avanço).
 * @returns {{ meta: object, rows: Array, globalPct: number }}
 */
export function buildContractualReportData(tasks, filterVal, dashboardData, projectId, projectDetail) {
  const meta = resolveContractualReportMeta(projectId, dashboardData, projectDetail);
  const filter = filterVal || "all";

  const tasksFiltered = (tasks || []).filter((t) => {
    const g = groupLabelForFilter(t);
    return filter === "all" || g === filter;
  });

  if (tasksFiltered.length === 0) {
    return { meta, rows: [], globalPct: meta.globalPct };
  }

  tasksFiltered.sort((a, b) =>
    (a.itemGroup || "").localeCompare(b.itemGroup || "", "pt", { sensitivity: "base" })
  );

  const children = tasksFiltered.filter((t) => t.parentId);
  const parents = tasksFiltered.filter((t) => !t.parentId);

  const groupInvoicingTotals = {};
  const groupInvoicedTotals = {};
  tasksFiltered.forEach((t) => {
    const g = t.itemGroup || "";
    if (!groupInvoicingTotals[g]) groupInvoicingTotals[g] = 0;
    if (!groupInvoicedTotals[g]) groupInvoicedTotals[g] = 0;
    const exp = Number(t.expectedQty || 0);
    const exe = Number(t.executedQty || 0);
    const uv = Number(t.unitValue || 0);
    groupInvoicingTotals[g] += uv * exp;
    groupInvoicedTotals[g] += uv * exe;
  });

  const groupProgressMap = {};
  Object.keys(groupInvoicingTotals).forEach((g) => {
    const inv = groupInvoicingTotals[g] || 0;
    const exd = groupInvoicedTotals[g] || 0;
    groupProgressMap[g] = inv > 0 ? (exd / inv) * 100 : 0;
  });

  let globalPct = meta.globalPct;
  if (filter === "all") {
    const keys = Object.keys(groupProgressMap);
    if (keys.length > 0) {
      globalPct = Math.round(
        keys.reduce((a, k) => a + groupProgressMap[k], 0) / keys.length
      );
    }
  } else {
    globalPct = Math.round(groupProgressMap[filter] || 0);
  }
  meta.globalPct = globalPct;

  const rows = [];
  let lastGroup = null;
  let groupIndex = 0;

  parents.forEach((t) => {
    const groupName = t.itemGroup || "Outros / Geral";
    if (t.itemGroup !== lastGroup) {
      rows.push({
        kind: "group",
        item: "",
        descritivo: groupName.toUpperCase(),
        unid: "",
        qtdContratual: "",
        qtdAplicada: "",
        qtdPorAplicar: "",
        pctExecucao: fmtPct(groupProgressMap[t.itemGroup || ""] || 0),
      });
      lastGroup = t.itemGroup;
      groupIndex = 0;
    }

    groupIndex++;
    const subs = children.filter((c) => c.parentId === t.id);
    const parentQty = taskQuantities(t, children);

    rows.push({
      kind: "task",
      item: t.itemCode || String(groupIndex),
      descritivo: t.description || "",
      unid: t.unit || "",
      qtdContratual: parentQty.exp,
      qtdAplicada: parentQty.exe,
      qtdPorAplicar: parentQty.remaining,
      pctExecucao: parentQty.pct,
    });

    subs.forEach((sub, subI) => {
      const q = taskQuantities(sub, []);
      rows.push({
        kind: "sub",
        item: sub.itemCode || `${groupIndex}.${subI + 1}`,
        descritivo: sub.description || "",
        unid: sub.unit || "",
        qtdContratual: q.exp,
        qtdAplicada: q.exe,
        qtdPorAplicar: q.remaining,
        pctExecucao: q.pct,
      });
    });
  });

  return { meta, rows, globalPct };
}

function reportTitle(meta) {
  const suffix = meta.titleSuffix || meta.obra || "";
  return `RELATÓRIO DE AVANÇO (EMPREITADA PARA O PROJECTO DE ${suffix})`;
}

function safeFilePart(str) {
  return String(str || "obra")
    .replace(/[^\w\s-]/gi, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

function drawPdfHeader(doc, meta, margin, pageW) {
  const headerH = 38;
  const y0 = 8;
  const colW = (pageW - margin * 2) / 3;

  doc.setFillColor(...HEADER_BLUE);
  doc.rect(margin, y0, pageW - margin * 2, headerH, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");

  const leftX = margin + 3;
  const midX = margin + colW + 3;
  const rightX = margin + colW * 2 + 3;
  let ly = y0 + 5;

  const leftLines = [
    `Obra: ${meta.obra}`,
    `Local: ${meta.local}`,
    `Empreiteiro: ${meta.empreiteiro}`,
    `Sub-Empreiteiro: ${meta.subempreiteiro}`,
    `Diretor de Obra: ${meta.directorObra}`,
  ];
  leftLines.forEach((line) => {
    doc.text(line, leftX, ly, { maxWidth: colW - 6 });
    ly += 4.2;
  });

  let my = y0 + 5;
  const midLines = [
    `Refª Contrato: ${meta.referencia || "—"}`,
    `Data de Consignação: ${meta.dataConsignacao ? formatDateBR(meta.dataConsignacao) : "—"}`,
    `Prazo Contratual / Unid. Tempo: ${meta.prazoContratual}`,
    `Relatório de Obra Nº ${meta.reportNumber}`,
    `Data: ${formatDateBR(meta.reportDate)}`,
  ];
  midLines.forEach((line) => {
    doc.text(line, midX, my, { maxWidth: colW - 6 });
    my += 4.2;
  });

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("% GLOBAL", rightX + colW / 2 - 12, y0 + 10);
  doc.setFontSize(16);
  doc.text(`${Number(meta.globalPct || 0).toFixed(1)}%`, rightX + colW / 2 - 10, y0 + 22);

  doc.setTextColor(0, 0, 0);
  return y0 + headerH + 4;
}

export function exportContractualReportPdf(reportData, filenameBase) {
  if (typeof window.jspdf === "undefined" || typeof window.jspdf.jsPDF === "undefined") {
    throw new Error("PDF_LIBRARY_MISSING");
  }
  const { meta, rows } = reportData;
  if (!rows.length) {
    throw new Error("NO_DATA");
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 10;
  const pageW = doc.internal.pageSize.getWidth();

  let startY = drawPdfHeader(doc, meta, margin, pageW);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const title = reportTitle(meta);
  const titleLines = doc.splitTextToSize(title, pageW - margin * 2);
  doc.text(titleLines, pageW / 2, startY + 4, { align: "center" });
  startY += 4 + titleLines.length * 4;

  const tableWidth = pageW - margin * 2;
  const colW = (pct) => Math.round(tableWidth * pct * 100) / 100;
  // Larguras proporcionais — somam 100% da área útil (alinha com o cabeçalho azul)
  const widths = {
    item: colW(0.07),
    descritivo: colW(0.36),
    unid: colW(0.06),
    qtdContratual: colW(0.14),
    qtdAplicada: colW(0.14),
    qtdPorAplicar: colW(0.14),
    pct: colW(0.09),
  };
  // Corrigir arredondamentos para preencher exactamente a largura
  const widthSum =
    widths.item +
    widths.descritivo +
    widths.unid +
    widths.qtdContratual +
    widths.qtdAplicada +
    widths.qtdPorAplicar +
    widths.pct;
  widths.descritivo += tableWidth - widthSum;

  const head = [
    [
      "Item",
      "Descritivo",
      "Unid.",
      "Qtd.\nContratual",
      "Qtd.\nAplicada",
      "Qtd. Por\nAplicar",
      "% Exec.",
    ],
  ];

  const body = [];
  rows.forEach((r) => {
    if (r.kind === "group") {
      body.push([
        {
          content: r.descritivo,
          colSpan: 7,
          styles: {
            fillColor: HEADER_BLUE,
            textColor: 255,
            fontStyle: "bold",
            halign: "left",
            fontSize: 7,
          },
        },
      ]);
    } else {
      body.push([
        String(r.item),
        r.descritivo,
        r.unid,
        fmtQty(r.qtdContratual),
        fmtQty(r.qtdAplicada),
        fmtQty(r.qtdPorAplicar),
        fmtPct(r.pctExecucao),
      ]);
    }
  });

  doc.autoTable({
    head,
    body,
    startY: startY + 2,
    tableWidth,
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 7,
      cellPadding: 1.5,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: HEADER_BLUE,
      textColor: 255,
      fontStyle: "bold",
      fontSize: 6.5,
      halign: "center",
      valign: "middle",
    },
    bodyStyles: { textColor: [30, 41, 59] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: widths.item, halign: "center" },
      1: { cellWidth: widths.descritivo, halign: "left" },
      2: { cellWidth: widths.unid, halign: "center" },
      3: { cellWidth: widths.qtdContratual, halign: "right" },
      4: { cellWidth: widths.qtdAplicada, halign: "right" },
      5: { cellWidth: widths.qtdPorAplicar, halign: "right" },
      6: { cellWidth: widths.pct, halign: "right" },
    },
    showHead: "everyPage",
    rowPageBreak: "auto",
  });

  const fname = `${filenameBase || safeFilePart(meta.obra)}_relatorio_avanco.pdf`;
  doc.save(fname);
}

export function exportContractualReportExcel(reportData, filenameBase) {
  if (typeof XLSX === "undefined") {
    throw new Error("EXCEL_LIBRARY_MISSING");
  }
  const { meta, rows } = reportData;
  if (!rows.length) {
    throw new Error("NO_DATA");
  }

  const title = reportTitle(meta);
  const merges = [];
  const ws = {};
  const COLS = 7;
  const L = 0;
  const LV1 = 1;
  const LV2 = 2;
  const ML = 3;
  const MV1 = 4;
  const MV2 = 5;
  const G = 6;

  const headerRows = [
    ["Obra:", meta.obra, "", "Refª Contrato:", meta.referencia || "—"],
    ["Local:", meta.local, "", "Data de Consignação:", meta.dataConsignacao ? formatDateBR(meta.dataConsignacao) : "—"],
    ["Empreiteiro:", meta.empreiteiro, "", "Prazo Contratual / Unid. Tempo:", meta.prazoContratual],
    ["Sub-Empreiteiro:", meta.subempreiteiro, "", `Relatório de Obra Nº ${meta.reportNumber}`, `Data: ${formatDateBR(meta.reportDate)}`],
    ["Diretor de Obra:", meta.directorObra, "", "", ""],
  ];

  headerRows.forEach((row, ri) => {
    setExcelCell(ws, ri, L, row[0], EXCEL_STYLES.headerLabel);
    setExcelCell(ws, ri, LV1, row[1], EXCEL_STYLES.headerValue);
    pushExcelMerge(merges, ri, LV1, ri, LV2);
    setExcelCell(ws, ri, ML, row[3] || "", EXCEL_STYLES.headerLabel);
    setExcelCell(ws, ri, MV1, row[4] || "", EXCEL_STYLES.headerValue);
    if (row[4]) pushExcelMerge(merges, ri, MV1, ri, MV2);
    for (let c = 0; c < COLS; c++) {
      const ref = excelCellRef(ri, c);
      if (!ws[ref]) setExcelCell(ws, ri, c, "", EXCEL_STYLES.headerValue);
      else if (!ws[ref].s) ws[ref].s = EXCEL_STYLES.headerValue;
    }
  });

  setExcelCell(ws, 0, G, "% GLOBAL", EXCEL_STYLES.globalLabel);
  setExcelCell(ws, 1, G, Number(meta.globalPct || 0) / 100, {
    ...EXCEL_STYLES.globalPct,
    numFmt: "0.0%",
  });
  for (let ri = 2; ri <= 4; ri++) {
    setExcelCell(ws, ri, G, "", EXCEL_STYLES.headerValue);
  }
  pushExcelMerge(merges, 1, G, 4, G);

  const TITLE_ROW = 6;
  const TABLE_HEAD_ROW = 8;
  const DATA_START = 9;

  setExcelCell(ws, TITLE_ROW, 0, title, EXCEL_STYLES.title);
  pushExcelMerge(merges, TITLE_ROW, 0, TITLE_ROW, G);

  const headLabels = [
    "Item",
    "Descritivo",
    "Unid.",
    "Qtd. Contratual",
    "Qtd. Aplicada",
    "Qtd. Por Aplicar",
    "% Exec.",
  ];
  headLabels.forEach((label, c) => {
    setExcelCell(ws, TABLE_HEAD_ROW, c, label, EXCEL_STYLES.tableHead);
  });

  let dataRow = DATA_START;
  let zebra = false;

  rows.forEach((r) => {
    if (r.kind === "group") {
      setExcelCell(ws, dataRow, 0, r.descritivo, EXCEL_STYLES.groupRow);
      pushExcelMerge(merges, dataRow, 0, dataRow, G);
      for (let c = 1; c <= G; c++) {
        setExcelCell(ws, dataRow, c, "", EXCEL_STYLES.groupRow);
      }
      dataRow += 1;
      return;
    }

    const cols = [0, 1, 2, 3, 4, 5, 6];
    setExcelCell(ws, dataRow, 0, String(r.item), EXCEL_STYLES.dataCenter);
    setExcelCell(ws, dataRow, 1, r.descritivo, EXCEL_STYLES.dataText);
    setExcelCell(ws, dataRow, 2, r.unid, EXCEL_STYLES.dataCenter);
    setExcelCell(ws, dataRow, 3, Number(r.qtdContratual) || 0, EXCEL_STYLES.dataNum);
    setExcelCell(ws, dataRow, 4, Number(r.qtdAplicada) || 0, EXCEL_STYLES.dataNum);
    setExcelCell(ws, dataRow, 5, Number(r.qtdPorAplicar) || 0, EXCEL_STYLES.dataNum);
    setExcelCell(
      ws,
      dataRow,
      6,
      (Number(r.pctExecucao) || 0) / 100,
      EXCEL_STYLES.dataPct
    );
    applyExcelZebra(ws, dataRow, cols, zebra);
    zebra = !zebra;
    dataRow += 1;
  });

  const lastRow = Math.max(dataRow - 1, TABLE_HEAD_ROW);
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: G } });
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 11 },
    { wch: 38 },
    { wch: 8 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
  ];
  ws["!rows"] = [
    { hpt: 16 },
    { hpt: 16 },
    { hpt: 16 },
    { hpt: 16 },
    { hpt: 16 },
    {},
    { hpt: 28 },
    {},
    { hpt: 32 },
  ];

  ws["!freeze"] = {
    xSplit: 0,
    ySplit: DATA_START,
    topLeftCell: excelCellRef(DATA_START, 0),
    activePane: "bottomLeft",
    state: "frozen",
  };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório de Avanço");
  const fname = `${filenameBase || safeFilePart(meta.obra)}_relatorio_avanco.xlsx`;
  XLSX.writeFile(wb, fname, { cellStyles: true });
}

export { safeFilePart };
