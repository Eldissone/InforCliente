import { apiRequest } from "../services/api.js";

/**
 * Leitura dos resumos diários/semanais (Fase 3.1).
 * `renderDigestHtml(content)` também é usado na pré-visualização da Gestão.
 */

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const pct = (v) => (v === null || v === undefined ? "—" : `${String(v).replace(".", ",")}%`);
const money = (v, cur) =>
  v === null || v === undefined
    ? "—"
    : `${Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 0 })}${cur ? ` ${esc(cur)}` : ""}`;

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = `
    .dg-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px}
    .dg-modal{background:#fff;border-radius:18px;max-width:760px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(15,23,42,.3);overflow:hidden}
    .dg-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px;background:#0f172a;color:#fff}
    .dg-head h2{font-size:17px;font-weight:700;margin:0}
    .dg-head p{font-size:12px;color:#cbd5e1;margin:4px 0 0}
    .dg-close{margin-left:auto;background:none;border:0;color:#fff;cursor:pointer;padding:4px}
    .dg-body{padding:18px 20px;overflow:auto;font-size:14px;color:#0f172a}
    .dg-headline{font-weight:600;margin:0 0 12px}
    .dg-hl{list-style:disc;padding-left:20px;margin:0 0 18px}
    .dg-hl li{margin:4px 0;line-height:1.45}
    .dg-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;border-radius:999px;padding:2px 8px;background:#ede9fe;color:#6d28d9}
    .dg-badge.rules{background:#e2e8f0;color:#475569}
    .dg-proj{border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px;margin:10px 0}
    .dg-proj h3{font-size:14px;font-weight:700;margin:0 0 8px}
    .dg-proj h3 a{color:inherit;text-decoration:none}
    .dg-proj h3 a:hover{text-decoration:underline}
    .dg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
    .dg-kpi{background:#f8fafc;border-radius:10px;padding:8px 10px}
    .dg-kpi span{display:block;font-size:11px;color:#64748b}
    .dg-kpi b{font-size:14px}
    .dg-kpi.bad b{color:#dc2626}
    .dg-list{margin:8px 0 0;padding-left:18px;list-style:disc;font-size:13px;color:#334155}
    .dg-empty{color:#64748b;font-size:13px}
  `;
  document.head.appendChild(style);
}

function kpi(label, value, bad = false) {
  return `<div class="dg-kpi${bad ? " bad" : ""}"><span>${esc(label)}</span><b>${value}</b></div>`;
}

function projectHtml(p) {
  const k = [];
  const lists = [];
  if (p.progress) {
    const pr = p.progress;
    k.push(kpi("Avanço físico", pct(pr.physicalProgressPct)));
    if (pr.timeElapsedPct != null) k.push(kpi("Prazo decorrido", pct(pr.timeElapsedPct), pr.scheduleGapPts != null && pr.scheduleGapPts <= -10));
    if (pr.daysToDue != null) k.push(kpi(pr.daysToDue < 0 ? "Dias de atraso" : "Dias até ao fim", esc(Math.abs(pr.daysToDue)), pr.daysToDue < 0));
    k.push(kpi("Planos atrasados", esc(pr.latePlansCount), pr.latePlansCount > 0));
    pr.latePlans?.forEach((x) => lists.push(`Plano atrasado ${esc(x.daysLate)} dia(s): ${esc(x.description)}`));
  }
  if (p.needs) {
    k.push(kpi("Necessidades paradas", `${esc(p.needs.stalledCount)} / ${esc(p.needs.openCount)}`, p.needs.stalledCount > 0));
    p.needs.stalled?.forEach((x) => lists.push(`Necessidade parada há ${esc(x.daysOpen)} dia(s): ${esc(x.description)}`));
  }
  if (p.stock) {
    k.push(kpi("Faltas (7 dias)", esc(p.stock.shortagesCount), p.stock.shortagesCount > 0));
    if (p.stock.belowMinCount) k.push(kpi("Abaixo do mínimo", esc(p.stock.belowMinCount), true));
    p.stock.shortages?.forEach((x) => lists.push(`Falta ${esc(x.missing)} ${esc(x.unit || "")} de ${esc(x.product)} até ${esc(x.neededOn)}`));
  }
  if (p.budget) {
    const main = p.budget.byCurrency?.find((c) => c.currency === p.budget.mainCurrency);
    if (main) {
      k.push(kpi(`Previsto (${esc(main.currency)})`, money(main.previsto)));
      k.push(kpi("Comprometido", pct(main.committedPct), p.budget.costGapPts != null && p.budget.costGapPts >= 10));
      k.push(kpi("Pago", pct(main.paidPct)));
    }
  }
  if (p.payments) {
    k.push(kpi("Pagamentos em atraso", esc(p.payments.overdueCount), p.payments.overdueCount > 0));
    k.push(kpi("A vencer (7 dias)", esc(p.payments.dueNext7DaysCount)));
  }
  return `<div class="dg-proj">
    <h3><a href="/Projectos/projectView?id=${encodeURIComponent(p.id)}">${esc(p.code)} · ${esc(p.name)}</a></h3>
    <div class="dg-grid">${k.join("")}</div>
    ${lists.length ? `<ul class="dg-list">${lists.map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}
  </div>`;
}

/** HTML do resumo (conteúdo gravado em AiDigest.content). Todo o texto é escapado. */
export function renderDigestHtml(content, { aiUsed = false } = {}) {
  injectStyles();
  if (!content) return '<p class="dg-empty">Sem conteúdo.</p>';
  const badge = aiUsed
    ? '<span class="dg-badge">✨ Pontos de atenção escritos pela IA a partir dos números do sistema</span>'
    : '<span class="dg-badge rules">Pontos de atenção calculados pelo sistema</span>';
  const hl = content.highlights?.length
    ? `<ul class="dg-hl">${content.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`
    : '<p class="dg-empty">Sem pontos de atenção.</p>';
  const projects = content.projects?.length ? content.projects.map(projectHtml).join("") : '<p class="dg-empty">Sem obras.</p>';
  return `<p class="dg-headline">${esc(content.headline || "")}</p>
    <div style="margin-bottom:8px">${badge}</div>
    ${hl}
    <h3 style="font-size:13px;font-weight:700;color:#475569;margin:6px 0">Obras</h3>
    ${projects}`;
}

function close(overlay) {
  overlay.remove();
  document.removeEventListener("keydown", overlay._onKey);
}

/** Abre o resumo num modal. */
export async function openDigest(id) {
  injectStyles();
  const overlay = document.createElement("div");
  overlay.className = "dg-overlay";
  overlay.innerHTML = `<div class="dg-modal" role="dialog" aria-modal="true">
    <div class="dg-head"><div><h2>Resumo</h2><p>A carregar…</p></div>
    <button type="button" class="dg-close" aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <div class="dg-body"><p class="dg-empty">A carregar…</p></div></div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".dg-close")) close(overlay);
  });
  overlay._onKey = (e) => e.key === "Escape" && close(overlay);
  document.addEventListener("keydown", overlay._onKey);
  document.body.appendChild(overlay);

  try {
    const { digest } = await apiRequest(`/ai/digests/${encodeURIComponent(id)}`);
    const c = digest.content || {};
    const from = c.from ? new Date(c.from).toLocaleDateString("pt-PT") : "";
    const to = c.to ? new Date(c.to).toLocaleDateString("pt-PT") : "";
    overlay.querySelector(".dg-head h2").textContent = digest.title;
    overlay.querySelector(".dg-head p").textContent = from && to ? `Período: ${from} a ${to}` : "";
    overlay.querySelector(".dg-body").innerHTML = renderDigestHtml(c, { aiUsed: digest.aiUsed });
  } catch (error) {
    overlay.querySelector(".dg-body").innerHTML = `<p class="dg-empty">${esc(error.message || "Não foi possível abrir o resumo.")}</p>`;
  }
}
