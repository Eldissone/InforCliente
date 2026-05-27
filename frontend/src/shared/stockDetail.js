import { getAssetUrl, resolveProductImageUrl } from "../services/api.js";
import { escapeHtml } from "./ui.js";
import { formatDateBR } from "./format.js";

export const STOCK_TYPE_LABELS = {
  ENTRY: "Entrada",
  EXIT: "Saída",
  TRANSFER_IN: "Transferência (Entrada)",
  TRANSFER_OUT: "Transferência (Saída)",
  ADJUSTMENT: "Ajuste",
  LOSS: "Perda",
  ENTRADA: "Entrada",
  SAIDA: "Saída",
};

export function parseStockMovementLogistics(m) {
  const notes = (m.notes || "").trim();
  if (notes && /devolução|devolvido por/i.test(notes)) {
    return { driverInfo: "—", vehicleInfo: "—", operationNote: notes };
  }

  const refLooksLikeUrl = m.reference && /^(https?:\/\/|uploads\/|\/)/i.test(m.reference);
  const text = [refLooksLikeUrl ? null : m.reference, notes].filter(Boolean).join(" | ");
  if (!text) return { driverInfo: "—", vehicleInfo: "—", operationNote: null };

  const logisticsMatch = text.match(
    /motorista:\s*([^|]+)(?:\|\s*(?:viatura|matr[íi]cula):\s*([^|]+))?/i
  );
  if (logisticsMatch) {
    const driverInfo = logisticsMatch[1].trim() || "—";
    const vehicleInfo = (logisticsMatch[2] || "").trim() || "—";
    return { driverInfo, vehicleInfo, operationNote: null };
  }

  if (/viatura|matr[íi]cula/i.test(text)) {
    const vehicleInfo = text.replace(/^(?:viatura|matr[íi]cula):\s*/i, "").trim() || "—";
    return { driverInfo: "—", vehicleInfo, operationNote: null };
  }

  return { driverInfo: "—", vehicleInfo: "—", operationNote: text };
}

function renderEvidenceBlock(m, label = "Evidência / Guia / Viatura") {
  const evidenceUrl = resolveProductImageUrl({ image: m.evidenceUrl });
  if (!evidenceUrl) {
    return `
      <div class="p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center">
        <span class="material-symbols-outlined text-4xl text-slate-300 mb-2">hide_image</span>
        <p class="text-xs font-bold text-slate-400">Sem imagem anexada nesta operação</p>
      </div>`;
  }
  return `
    <div class="space-y-2">
      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">${escapeHtml(label)}</p>
      <button type="button" data-preview-url="${escapeHtml(evidenceUrl)}" data-preview-title="${escapeHtml(label)}"
        class="block w-full rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 hover:ring-2 hover:ring-[#2afc8d] transition-all cursor-zoom-in">
        <img src="${escapeHtml(evidenceUrl)}" alt="${escapeHtml(label)}" class="w-full max-h-72 object-contain mx-auto" loading="lazy" />
      </button>
      <p class="text-[9px] text-slate-400 text-center">Clique para ampliar</p>
    </div>`;
}

function renderStockSummaryStrip(summary) {
  if (!summary) return "";
  const { planned, totalIn, totalOut, balance, warehouseName, entriesOnly } = summary;
  const cols = entriesOnly ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4";
  const exitsCell = entriesOnly
    ? ""
    : `<div><p class="text-[9px] font-black uppercase text-slate-400">Saídas</p><p class="text-lg font-black text-red-400">${totalOut}</p></div>`;
  return `
    <div class="grid ${cols} gap-3 p-4 bg-slate-900 rounded-2xl text-white">
      <div><p class="text-[9px] font-black uppercase text-slate-400">Previsto</p><p class="text-lg font-black text-blue-300">${planned}</p></div>
      <div><p class="text-[9px] font-black uppercase text-slate-400">Entradas</p><p class="text-lg font-black text-emerald-400">${totalIn}</p></div>
      ${exitsCell}
      <div><p class="text-[9px] font-black uppercase text-slate-400">Saldo</p><p class="text-lg font-black text-[#2afc8d]">${balance}</p></div>
    </div>
    ${warehouseName ? `<p class="text-[10px] font-bold text-slate-500 text-center mt-2">Armazém: ${escapeHtml(warehouseName)}</p>` : ""}`;
}

function renderEntryTimeline(entries, activeId) {
  if (!entries || entries.length <= 1) return "";
  return `
    <div class="space-y-2">
      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Histórico de entradas (${entries.length})</p>
      <div class="max-h-40 overflow-y-auto space-y-2 pr-1">
        ${entries.map((e) => {
          const { driverInfo, vehicleInfo } = parseStockMovementLogistics(e);
          const isActive = e.id === activeId;
          const thumb = resolveProductImageUrl({ image: e.evidenceUrl });
          return `
            <div class="flex items-center gap-3 p-3 rounded-xl border ${isActive ? "border-[#2afc8d] bg-emerald-50/50" : "border-slate-100 bg-slate-50"}">
              <div class="w-10 h-10 rounded-lg overflow-hidden bg-slate-200 shrink-0 flex items-center justify-center">
                ${thumb ? `<img src="${escapeHtml(thumb)}" class="w-full h-full object-cover" alt="" />` : `<span class="material-symbols-outlined text-slate-400 text-sm">local_shipping</span>`}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-[10px] font-black text-slate-800">${formatDateBR(e.createdAt)} · ${Number(e.quantity)} ${escapeHtml(e.product?.unit || "un")}</p>
                <p class="text-[9px] text-slate-500 truncate">${escapeHtml(driverInfo)} · ${escapeHtml(vehicleInfo)}</p>
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

/** HTML completo para modal de detalhe de entrada/operação de stock. */
export function buildStockMovementDetailHtml(m, options = {}) {
  const { stockSummary, entryHistory, entriesOnly } = options;
  const summaryForStrip = stockSummary
    ? { ...stockSummary, entriesOnly: entriesOnly ?? stockSummary.entriesOnly }
    : null;
  const { driverInfo, vehicleInfo, operationNote } = parseStockMovementLogistics(m);
  const hasTransport = driverInfo !== "—" || vehicleInfo !== "—";
  const typeLabel = STOCK_TYPE_LABELS[m.type] || m.type;
  const product = m.product || {};
  const productImg = resolveProductImageUrl(product);
  const registeredBy = m.user?.name || m.user?.email || "Sistema";
  const isEntry = m.type === "ENTRY" || m.type === "TRANSFER_IN" || m.type === "ENTRADA";

  const productImgHtml = productImg
    ? `<img src="${escapeHtml(productImg)}" class="w-16 h-16 rounded-xl object-cover border border-slate-200" alt="" />`
    : `<div class="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center"><span class="material-symbols-outlined text-slate-300">inventory_2</span></div>`;

  return `
    <div class="space-y-6">
      ${renderStockSummaryStrip(summaryForStrip)}

      <div class="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
        ${productImgHtml}
        <div class="flex-1 min-w-0">
          <h4 class="text-lg font-bold text-slate-900 leading-tight">${escapeHtml(product.name || "Material")}</h4>
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">${escapeHtml(product.sku || product.reference || "—")} · ${escapeHtml(product.category || "—")}</p>
          <span class="inline-block mt-2 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${isEntry ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}">${typeLabel}</span>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="space-y-3">
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Dados da operação</p>
          <div class="bg-white border border-slate-100 rounded-2xl divide-y divide-slate-50">
            <div class="flex justify-between px-4 py-3"><span class="text-[10px] font-bold text-slate-500">Quantidade</span><span class="text-xs font-black text-emerald-600">${Number(m.quantity || 0)} ${escapeHtml(product.unit || "un")}</span></div>
            <div class="flex justify-between px-4 py-3"><span class="text-[10px] font-bold text-slate-500">Data</span><span class="text-xs font-black text-slate-900">${formatDateBR(m.createdAt)}</span></div>
            <div class="flex justify-between px-4 py-3"><span class="text-[10px] font-bold text-slate-500">Registado por</span><span class="text-xs font-bold text-slate-700">${escapeHtml(registeredBy)}</span></div>
            ${m.warehouse?.name ? `<div class="flex justify-between px-4 py-3"><span class="text-[10px] font-bold text-slate-500">Armazém</span><span class="text-xs font-bold text-slate-700">${escapeHtml(m.warehouse.name)}</span></div>` : ""}
            ${operationNote ? `<div class="px-4 py-3"><span class="text-[10px] font-bold text-slate-500 block mb-1">Observações</span><span class="text-xs text-slate-600 leading-relaxed">${escapeHtml(operationNote)}</span></div>` : ""}
            ${m.notes && !operationNote && !m.notes.includes("Motorista:") ? `<div class="px-4 py-3"><span class="text-[10px] font-bold text-slate-500 block mb-1">Observações</span><span class="text-xs text-slate-600">${escapeHtml(m.notes)}</span></div>` : ""}
          </div>
        </div>
        <div class="space-y-3">
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Controlo de transporte</p>
          <div class="bg-slate-50 rounded-2xl p-4 space-y-4 border border-slate-100">
            ${operationNote && !hasTransport ? `
            <div class="flex items-start gap-3">
              <span class="material-symbols-outlined text-slate-400 text-xl mt-0.5">info</span>
              <div>
                <span class="text-[9px] font-black text-slate-400 block uppercase">Registo</span>
                <span class="text-xs font-medium text-slate-600 leading-relaxed">Sem dados de motorista/viatura (ver observações).</span>
              </div>
            </div>` : ""}
            ${hasTransport ? `
            <div class="flex items-start gap-3">
              <span class="material-symbols-outlined text-blue-500 text-xl mt-0.5">person</span>
              <div>
                <span class="text-[9px] font-black text-slate-400 block uppercase">Motorista</span>
                <span class="text-sm font-bold text-slate-900">${escapeHtml(driverInfo)}</span>
              </div>
            </div>
            <div class="flex items-start gap-3">
              <span class="material-symbols-outlined text-amber-500 text-xl mt-0.5">local_shipping</span>
              <div>
                <span class="text-[9px] font-black text-slate-400 block uppercase">Viatura / Matrícula</span>
                <span class="text-sm font-bold text-slate-900 uppercase">${escapeHtml(vehicleInfo)}</span>
              </div>
            </div>` : ""}
            ${(() => {
              const vehicleImg = resolveProductImageUrl({ image: m.vehicleImageUrl });
              if (!vehicleImg) return "";
              return `
            <div class="flex items-center gap-3 pt-2 border-t border-slate-100">
              <span class="material-symbols-outlined text-slate-400 text-lg">photo_camera</span>
              <div class="flex items-center gap-2">
                <span class="text-[9px] font-black text-slate-400 uppercase">Foto da viatura</span>
                <button type="button" data-preview-url="${escapeHtml(vehicleImg)}" data-preview-title="Foto da viatura"
                  class="w-12 h-12 rounded-lg overflow-hidden border border-slate-200 cursor-zoom-in hover:ring-2 hover:ring-[#2afc8d]">
                  <img src="${escapeHtml(vehicleImg)}" alt="Viatura" class="w-full h-full object-cover" loading="lazy" />
                </button>
              </div>
            </div>`;
            })()}
          </div>
        </div>
      </div>

      ${renderEntryTimeline(entryHistory, m.id)}
    </div>`;
}

export function computeStockTotals(movements, productId, warehouseId = null) {
  const pMovements = movements.filter((m) => {
    if (m.productId !== productId) return false;
    if (warehouseId == null || warehouseId === "") return true;
    return String(m.warehouseId || "") === String(warehouseId);
  });
  const totalIn = pMovements
    .filter((m) => m.type === "ENTRY" || m.type === "TRANSFER_IN" || m.type === "ENTRADA")
    .reduce((acc, m) => acc + Number(m.quantity || 0), 0);
  const totalOut = pMovements
    .filter((m) => m.type === "EXIT" || m.type === "TRANSFER_OUT" || m.type === "LOSS" || m.type === "SAIDA")
    .reduce((acc, m) => acc + Number(m.quantity || 0), 0);
  return { pMovements, totalIn, totalOut };
}

/** Entradas registadas via Nova Operação Logística. */
export function filterLogisticsEntries(pMovements) {
  return pMovements
    .filter((m) => m.type === "ENTRY" || m.type === "TRANSFER_IN" || m.type === "ENTRADA")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function pickPrimaryEntryMovement(pMovements) {
  const entries = filterLogisticsEntries(pMovements);
  if (entries.length) return { primary: entries[0], entries };
  const any = [...pMovements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { primary: any[0] || null, entries: [] };
}

/** Modal quando há saldo mas ainda não há movimento de entrada registado. */
export function buildStockInventoryOnlyHtml(item, totals, options = {}) {
  const product = item.product || {};
  const productImg = resolveProductImageUrl(product);
  const productImgHtml = productImg
    ? `<img src="${escapeHtml(productImg)}" class="w-16 h-16 rounded-xl object-cover border border-slate-200" alt="" />`
    : `<div class="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center"><span class="material-symbols-outlined text-slate-300">inventory_2</span></div>`;

  return `
    <div class="space-y-6">
      ${renderStockSummaryStrip({
        planned: totals.planned,
        totalIn: totals.totalIn,
        totalOut: totals.totalOut,
        balance: totals.balance,
        warehouseName: totals.warehouseName,
        entriesOnly: options.entriesOnly ?? totals.entriesOnly,
      })}
      <div class="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
        ${productImgHtml}
        <div>
          <h4 class="text-lg font-bold text-slate-900">${escapeHtml(product.name || "Material")}</h4>
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">${escapeHtml(product.sku || "—")}</p>
        </div>
      </div>
      <div class="p-6 bg-amber-50 border border-amber-100 rounded-2xl text-center">
        <span class="material-symbols-outlined text-amber-500 text-3xl mb-2">info</span>
        <p class="text-xs font-bold text-amber-800">Há saldo neste armazém, mas ainda não foi registada nenhuma <strong>Entrada (Nova Operação Logística)</strong> para este material. Use o botão «+ Nova Operação» para registar receção com motorista e foto.</p>
      </div>
    </div>`;
}
