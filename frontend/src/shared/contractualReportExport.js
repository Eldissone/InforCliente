import { formatDateBR } from "./format.js";
import { escapeHtml } from "./ui.js";

const HEADER_BLUE = [33, 46, 62];

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
  const aoa = [
    ["Obra:", meta.obra, "", "Refª Contrato:", meta.referencia || "—", "", "% GLOBAL", `${Number(meta.globalPct || 0).toFixed(1)}%`],
    ["Local:", meta.local, "", "Data de Consignação:", meta.dataConsignacao ? formatDateBR(meta.dataConsignacao) : "—"],
    ["Empreiteiro:", meta.empreiteiro, "", "Prazo Contratual:", meta.prazoContratual],
    ["Sub-Empreiteiro:", meta.subempreiteiro, "", `Relatório de Obra Nº ${meta.reportNumber}`, `Data: ${formatDateBR(meta.reportDate)}`],
    ["Diretor de Obra:", meta.directorObra],
    [],
    [title],
    [],
    ["Item", "Descritivo", "Unid.", "Quantidade Contratual", "Quantidade Aplicada", "Quantidade Por Aplicar", "% Execução"],
  ];

  rows.forEach((r) => {
    if (r.kind === "group") {
      aoa.push([r.descritivo, "", "", "", "", "", ""]);
      return;
    }
    aoa.push([
      r.item,
      r.descritivo,
      r.unid,
      Number(r.qtdContratual),
      Number(r.qtdAplicada),
      Number(r.qtdPorAplicar),
      Number(r.pctExecucao),
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 10 }, { wch: 48 }, { wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 12 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório de Avanço");
  const fname = `${filenameBase || safeFilePart(meta.obra)}_relatorio_avanco.xlsx`;
  XLSX.writeFile(wb, fname);
}

export { safeFilePart };
