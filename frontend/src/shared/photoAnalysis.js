import { apiRequest, getAssetUrl } from "../services/api.js";
import { toast } from "./ui.js";

/**
 * Fotos da obra com IA e histórico de segurança (Fase 3.5).
 *  - openPhotoAnalysis(): legenda e tarefa sugeridas (aplicar com um clique) e
 *    riscos de segurança vistos na foto (confirmar ou descartar);
 *  - openSafetyHistory(): todas as observações de segurança da obra.
 * Os riscos sugeridos pela IA só contam depois de uma pessoa os confirmar.
 */

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("pt-PT") : "");
const SEV = { HIGH: "Grave", MEDIUM: "Médio", LOW: "Baixo" };
const STATUS = { SUGGESTED: "Sugerido pela IA", CONFIRMED: "Confirmado", DISMISSED: "Descartado", RESOLVED: "Resolvido" };
const PPE = { ok: "EPI em uso pelas pessoas visíveis", falta: "Falta de EPI visível", sem_pessoas: "Sem pessoas na foto" };

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = `
    .ph-overlay{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px}
    .ph-modal{background:#fff;border-radius:18px;max-width:880px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(15,23,42,.3);overflow:hidden}
    .ph-head{display:flex;align-items:flex-start;gap:12px;padding:16px 20px;background:#212e3e;color:#fff}
    .ph-head h2{font-size:17px;font-weight:700;margin:0}
    .ph-head p{font-size:12px;color:#cbd5e1;margin:4px 0 0}
    .ph-close{margin-left:auto;background:none;border:0;color:#fff;cursor:pointer;padding:4px}
    .ph-body{padding:16px 20px;overflow:auto;font-size:14px;color:#0f172a}
    .ph-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
    @media (max-width:720px){.ph-cols{grid-template-columns:1fr}}
    .ph-img{width:100%;border-radius:12px;border:1px solid #e2e8f0;max-height:420px;object-fit:contain;background:#f8fafc}
    .ph-box{border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;margin:0 0 10px}
    .ph-box h3{font-size:12px;font-weight:700;color:#475569;margin:0 0 6px;text-transform:uppercase;letter-spacing:.03em}
    .ph-btn{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;border-radius:10px;padding:6px 10px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer}
    .ph-btn.primary{background:#212e3e;border-color:#212e3e;color:#fff}
    .ph-btn.ok{background:#047857;border-color:#047857;color:#fff}
    .ph-btn[disabled]{opacity:.5;cursor:default}
    .ph-hint{font-size:12px;color:#64748b;margin:6px 0 0}
    .ph-chip{display:inline-block;font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px;background:#f1f5f9;color:#475569;margin-right:4px}
    .ph-chip.HIGH{background:#fee2e2;color:#b91c1c}.ph-chip.MEDIUM{background:#fef3c7;color:#92400e}.ph-chip.LOW{background:#e0f2fe;color:#075985}
    .ph-chip.SUGGESTED{background:#ede9fe;color:#6d28d9}.ph-chip.CONFIRMED{background:#fee2e2;color:#b91c1c}.ph-chip.RESOLVED{background:#dcfce7;color:#166534}
    .ph-risk{border-top:1px solid #f1f5f9;padding:8px 0}
    .ph-risk:first-of-type{border-top:0}
    .ph-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
    .ph-input,.ph-select{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:7px 9px;font-size:13px;box-sizing:border-box;background:#fff}
    .ph-row{display:flex;gap:12px;align-items:flex-start;border:1px solid #e2e8f0;border-radius:12px;padding:10px;margin:8px 0}
    .ph-row img{width:84px;height:64px;object-fit:cover;border-radius:8px;flex-shrink:0}
    .ph-filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
    .ph-filters button.on{background:#212e3e;color:#fff;border-color:#212e3e}
  `;
  document.head.appendChild(style);
}

function modal(title, subtitle) {
  injectStyles();
  const overlay = document.createElement("div");
  overlay.className = "ph-overlay";
  overlay.innerHTML = `<div class="ph-modal" role="dialog" aria-modal="true">
    <div class="ph-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>
    <button type="button" class="ph-close" aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <div class="ph-body"><p class="ph-hint">A carregar…</p></div></div>`;
  const onKey = (e) => e.key === "Escape" && closeIt();
  const closeIt = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".ph-close")) closeIt();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return { overlay, body: overlay.querySelector(".ph-body"), close: closeIt };
}

function riskHtml(o, canReview) {
  const actions = [];
  if (canReview && o.status === "SUGGESTED") {
    actions.push(`<button type="button" class="ph-btn" data-review="CONFIRMED" data-id="${esc(o.id)}">Confirmar risco</button>`);
    actions.push(`<button type="button" class="ph-btn" data-review="DISMISSED" data-id="${esc(o.id)}">Descartar</button>`);
  }
  if (canReview && o.status === "CONFIRMED") actions.push(`<button type="button" class="ph-btn ok" data-review="RESOLVED" data-id="${esc(o.id)}">Marcar como resolvido</button>`);
  return `<div class="ph-risk">
    <span class="ph-chip ${esc(o.severity)}">${esc(SEV[o.severity] || o.severity)}</span><span class="ph-chip">${esc(o.categoryLabel || o.category)}</span><span class="ph-chip ${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span>
    <div style="margin-top:4px;font-size:13px">${esc(o.description)}</div>
    ${o.reviewedByName ? `<div class="ph-hint">${esc(STATUS[o.status])} por ${esc(o.reviewedByName)} a ${fmtDate(o.reviewedAt)}${o.reviewNotes ? ` · ${esc(o.reviewNotes)}` : ""}</div>` : ""}
    ${actions.length ? `<div class="ph-actions">${actions.join("")}</div>` : ""}
  </div>`;
}

async function review(id, decision) {
  const notes = decision === "DISMISSED" ? prompt("Porque descarta este risco? (opcional)") ?? undefined : undefined;
  await apiRequest(`/ai/safety/${encodeURIComponent(id)}/review`, { method: "POST", body: { decision, ...(notes ? { notes } : {}) } });
}

/** Análise de uma foto. `photo` = item de /projects/:id/photos. */
export async function openPhotoAnalysis({ projectId, photo, onChanged } = {}) {
  const ui = modal("Análise da foto", "Legenda, tarefa e riscos de segurança sugeridos pela IA. Nada é aplicado sem confirmar.");
  let status;
  let current = photo;

  const render = async () => {
    const [{ items, categories }] = await Promise.all([apiRequest(`/ai/safety?projectId=${encodeURIComponent(projectId)}`)]);
    const risks = items.filter((o) => o.photoId === current.id).map((o) => ({ ...o, categoryLabel: categories[o.category] }));
    const a = current.aiAnalysis;
    const analysis = a
      ? `<div class="ph-box"><h3>Legenda sugerida</h3>
          <div style="font-size:13px">${esc(a.caption || "—")}</div>
          ${status.canReview && a.caption ? `<div class="ph-actions"><button type="button" class="ph-btn" data-apply-caption>Usar como descrição da foto</button></div><p class="ph-hint">A descrição é visível ao cliente na galeria.</p>` : ""}
        </div>
        <div class="ph-box"><h3>Tarefa do plano de trabalhos</h3>
          ${
            a.taskId
              ? `<div style="font-size:13px">${esc(a.taskLabel)} <span class="ph-chip">confiança ${esc(a.taskConfidence)}</span></div>
                 ${status.canReview ? `<div class="ph-actions"><button type="button" class="ph-btn" data-apply-task ${current.progressTaskId === a.taskId ? "disabled" : ""}>${current.progressTaskId === a.taskId ? "Associada" : "Associar a esta tarefa"}</button></div>` : ""}`
              : `<div class="ph-hint" style="margin:0">${status.withTasks ? "A IA não identificou a tarefa com segurança." : 'Sem associação: "Progresso e planeamento" não está autorizado para a IA.'}</div>`
          }
        </div>
        <div class="ph-box"><h3>Segurança</h3>
          ${a.ppe ? `<div style="font-size:13px;margin-bottom:6px">${esc(PPE[a.ppe] || a.ppe)}</div>` : ""}
          ${risks.length ? risks.map((o) => riskHtml(o, status.canReview)).join("") : '<div class="ph-hint" style="margin:0">Sem riscos visíveis indicados.</div>'}
        </div>
        <p class="ph-hint">Analisada a ${fmtDate(current.aiAnalyzedAt)}${a.model ? ` · ${esc(a.model)}` : ""}. Os riscos sugeridos só entram no histórico de segurança depois de confirmados.</p>`
      : '<p class="ph-hint">Esta foto ainda não foi analisada.</p>';
    ui.body.innerHTML = `<div class="ph-cols">
      <div><img class="ph-img" src="${esc(getAssetUrl(current.path))}" alt="Foto da obra" />
        <p class="ph-hint">${esc(current.description || "Sem descrição")} · ${fmtDate(current.createdAt)}</p></div>
      <div>${analysis}
        ${
          status.enabled
            ? `<div class="ph-actions" style="margin-top:4px"><button type="button" class="ph-btn primary" data-analyze><span class="material-symbols-outlined" style="font-size:16px">auto_awesome</span>${a ? "Analisar de novo" : "Analisar com IA"}</button></div>`
            : `<p class="ph-hint">${esc(status.reason)}</p>`
        }
      </div></div>`;
  };

  ui.body.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    try {
      if (btn.hasAttribute("data-analyze")) {
        btn.disabled = true;
        btn.textContent = "A analisar…";
        const res = await apiRequest(`/ai/photos/${encodeURIComponent(current.id)}/analyze`, { method: "POST" });
        current = { ...current, aiAnalysis: res.analysis, aiAnalyzedAt: new Date().toISOString() };
        if (res.observations.length) toast(`${res.observations.length} risco(s) sugerido(s): reveja-os.`, { type: "info" });
      } else if (btn.hasAttribute("data-apply-caption")) {
        const r = await apiRequest(`/ai/photos/${encodeURIComponent(current.id)}/apply`, { method: "POST", body: { caption: current.aiAnalysis.caption } });
        current = { ...current, description: r.photo.description };
        toast("Descrição atualizada.", { type: "success" });
      } else if (btn.hasAttribute("data-apply-task")) {
        const r = await apiRequest(`/ai/photos/${encodeURIComponent(current.id)}/apply`, { method: "POST", body: { progressTaskId: current.aiAnalysis.taskId } });
        current = { ...current, progressTaskId: r.photo.progressTaskId };
        toast("Foto associada à tarefa.", { type: "success" });
      } else if (btn.dataset.review) {
        await review(btn.dataset.id, btn.dataset.review);
      } else return;
      onChanged?.(current);
      await render();
    } catch (error) {
      toast(error.message || "Não foi possível concluir.", { type: "error" });
      await render().catch(() => {});
    }
  });

  try {
    status = await apiRequest(`/ai/photos/status?projectId=${encodeURIComponent(projectId)}`);
    await render();
  } catch (error) {
    ui.body.innerHTML = `<p class="ph-hint">${esc(error.message || "Não foi possível abrir.")}</p>`;
  }
}

/** Histórico de segurança da obra. */
export async function openSafetyHistory({ projectId } = {}) {
  const ui = modal("Histórico de segurança", "Riscos confirmados, resolvidos e sugeridos pela IA nas fotos, e observações registadas manualmente.");
  let filter = "OPEN";
  let data;

  const render = () => {
    const counts = { SUGGESTED: 0, CONFIRMED: 0, RESOLVED: 0, DISMISSED: 0 };
    data.items.forEach((o) => (counts[o.status] = (counts[o.status] || 0) + 1));
    const shown = data.items.filter((o) => (filter === "OPEN" ? ["SUGGESTED", "CONFIRMED"].includes(o.status) : filter === "ALL" || o.status === filter));
    const tabs = [
      ["OPEN", `Por tratar (${counts.SUGGESTED + counts.CONFIRMED})`],
      ["RESOLVED", `Resolvidos (${counts.RESOLVED})`],
      ["DISMISSED", `Descartados (${counts.DISMISSED})`],
      ["ALL", `Todos (${data.items.length})`],
    ];
    ui.body.innerHTML = `
      <div class="ph-filters">${tabs.map(([k, l]) => `<button type="button" class="ph-btn ${k === filter ? "on" : ""}" data-filter="${k}">${esc(l)}</button>`).join("")}</div>
      ${
        data.canReview
          ? `<details class="ph-box"><summary style="cursor:pointer;font-size:13px;font-weight:600">Registar observação manual</summary>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
                <select class="ph-select" id="phCat">${Object.entries(data.categories).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("")}</select>
                <select class="ph-select" id="phSev"><option value="HIGH">Grave</option><option value="MEDIUM" selected>Médio</option><option value="LOW">Baixo</option></select>
              </div>
              <textarea class="ph-input" id="phDesc" rows="2" maxlength="500" placeholder="O que foi observado e onde" style="margin-top:8px"></textarea>
              <div class="ph-actions"><button type="button" class="ph-btn primary" data-add>Registar</button></div>
            </details>`
          : ""
      }
      ${
        shown.length
          ? shown
              .map(
                (o) => `<div class="ph-row">
                  ${o.photo ? `<img src="${esc(getAssetUrl(o.photo.path))}" alt="" />` : '<span class="material-symbols-outlined" style="font-size:40px;color:#cbd5e1">engineering</span>'}
                  <div style="flex:1;min-width:0">${riskHtml({ ...o, categoryLabel: data.categories[o.category] }, data.canReview)}
                    <div class="ph-hint">${o.source === "MANUAL" ? "Registo manual" : "Visto pela IA numa foto"} · ${fmtDate(o.createdAt)}</div></div>
                </div>`
              )
              .join("")
          : '<p class="ph-hint">Sem observações neste filtro.</p>'
      }`;
  };
  const load = async () => {
    data = await apiRequest(`/ai/safety?projectId=${encodeURIComponent(projectId)}`);
    render();
  };

  ui.body.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    try {
      if (btn.dataset.filter) {
        filter = btn.dataset.filter;
        return render();
      }
      if (btn.dataset.review) {
        await review(btn.dataset.id, btn.dataset.review);
        return load();
      }
      if (btn.hasAttribute("data-add")) {
        const description = ui.body.querySelector("#phDesc").value.trim();
        if (description.length < 3) return toast("Descreva a observação.", { type: "error" });
        await apiRequest("/ai/safety", {
          method: "POST",
          body: { projectId, category: ui.body.querySelector("#phCat").value, severity: ui.body.querySelector("#phSev").value, description },
        });
        toast("Observação registada.", { type: "success" });
        return load();
      }
    } catch (error) {
      toast(error.message || "Não foi possível concluir.", { type: "error" });
    }
  });

  try {
    await load();
  } catch (error) {
    ui.body.innerHTML = `<p class="ph-hint">${esc(error.message || "Não foi possível abrir.")}</p>`;
  }
}
