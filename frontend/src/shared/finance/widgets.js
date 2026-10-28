import { escapeFinanceHtml as esc } from "../financePage.js";
import { drawSparkline } from "./charts.js";

/**
 * Peças visuais partilhadas pelos ecrãs da Área Financeira (Overview,
 * Faturação…): cartões de indicadores com comparação e tendência, barras de
 * progresso com marcador do previsto, faixa de posição e esqueletos de
 * carregamento. Os estilos estão em `financeiro.css` (classes `ov-*`).
 */

export function num(value) {
  return Number(value) || 0;
}

function clampPct(value) {
  return Math.max(0, Math.min(100, num(value)));
}

/** «pos» / «neg» conforme o sinal — usado nas classes `ov-pos` / `ov-neg`. */
export function toneOf(value) {
  return num(value) >= 0 ? "pos" : "neg";
}

export function skeletonHtml(count, variant) {
  return Array.from({ length: count }, () => `<div class="ov-skeleton ov-skeleton--${variant}"></div>`).join("");
}

/**
 * Barra de progresso com um ou mais segmentos (em %) e, opcionalmente, um
 * marcador vertical (ex.: o previsto).
 * `segments`: [{ value, tone: "blue" | "emerald" | "amber" | "amber-soft" | "red" | "slate" | "violet" }]
 */
export function meterHtml(segments, { marker = null, title = "" } = {}) {
  return `
    <div class="ov-meter"${title ? ` title="${esc(title)}"` : ""}>
      ${segments
        .map((s) => `<span class="ov-meter-fill ov-meter-fill--${s.tone}" style="width:${clampPct(s.value).toFixed(1)}%"></span>`)
        .join("")}
      ${marker !== null ? `<i class="ov-meter-marker" style="left:${clampPct(marker).toFixed(1)}%"></i>` : ""}
    </div>`;
}

/**
 * Cartões de indicadores principais.
 * `cards`: [{ key, label, icon, tone, value, badge?, badgeTone?, body?, spark?: { data, color }, foot? }]
 * Depois de inserir o HTML, chamar `drawKpiSparks(cards, prefix)`.
 */
export function kpiCardsHtml(cards, prefix = "kpi") {
  return cards
    .map(
      (k) => `
      <article class="ov-kpi ov-kpi--${k.tone || "blue"}">
        <header class="ov-kpi-head">
          <span class="ov-kpi-icon"><span class="material-symbols-outlined">${k.icon}</span></span>
          <span class="ov-kpi-label">${esc(k.label)}</span>
        </header>
        <div class="ov-kpi-main">
          <div class="ov-kpi-value" title="${esc(k.value)}">${esc(k.value)}</div>
          ${k.badge ? `<span class="ov-badge ov-badge--${k.badgeTone || "blue"}">${esc(k.badge)}</span>` : ""}
        </div>
        ${k.body ? `<div class="ov-kpi-body">${k.body}</div>` : ""}
        ${
          k.spark || k.foot
            ? `<footer class="ov-kpi-foot">
                 ${k.spark ? `<div id="${prefix}Spark-${k.key}" class="ov-spark"></div>` : ""}
                 ${k.foot ? `<span>${esc(k.foot)}</span>` : ""}
               </footer>`
            : ""
        }
      </article>`
    )
    .join("");
}

export function drawKpiSparks(cards, prefix = "kpi") {
  cards.forEach((k) => {
    if (k.spark) drawSparkline(`${prefix}Spark-${k.key}`, { ...k.spark, height: 38 });
  });
}

/**
 * Faixa de posição: valores compactos lado a lado; cada célula pode levar ao
 * ecrã onde se atua (`href`) ou servir de filtro (`action`).
 * `cells`: [{ label, icon, value, valueTone?, sub, subTone?, href?, action?, active? }]
 */
export function stripHtml(cells) {
  return cells
    .map((cell) => {
      const inner = `
        <span class="ov-cell-label"><span class="material-symbols-outlined">${cell.icon}</span>${esc(cell.label)}</span>
        <span class="ov-cell-value ${cell.valueTone ? `ov-${cell.valueTone}` : ""}"${cell.title ? ` title="${esc(cell.title)}"` : ""}>${esc(cell.value)}</span>
        <span class="ov-cell-sub ${cell.subTone ? `ov-${cell.subTone}` : ""}">${esc(cell.sub || "")}</span>`;
      if (cell.href) return `<a class="ov-cell" href="${cell.href}">${inner}</a>`;
      if (cell.action) {
        return `<button type="button" class="ov-cell${cell.active ? " active" : ""}" data-action="${esc(cell.action)}">${inner}</button>`;
      }
      return `<div class="ov-cell ov-cell--static">${inner}</div>`;
    })
    .join("");
}
