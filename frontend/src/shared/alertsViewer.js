import { apiRequest } from "../services/api.js";

/**
 * Alertas preditivos das obras (Fase 3.2).
 * `openAlerts({ ids })` abre o modal com os alertas indicados (de uma
 * notificação) ou, sem ids, com todos os alertas abertos do utilizador.
 * `renderAlertsHtml(list)` também é usado na pré-visualização da Gestão.
 */

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const STATUS_LABEL = { OPEN: "Aberto", ACK: "Visto", RESOLVED: "Resolvido" };

/** Onde se resolve cada tipo de alerta. */
function actionFor(a) {
  if (!a.projectId) return null;
  const base = `/Projectos/projectView?id=${encodeURIComponent(a.projectId)}`;
  if (a.kind === "MATERIAL_SHORTAGE") return { href: `${base}&tab=necessidades`, label: "Criar a necessidade" };
  if (a.kind === "STALLED_NEED" && a.metadata?.needId)
    return { href: `${base}&tab=cronograma&needId=${encodeURIComponent(a.metadata.needId)}`, label: "Abrir a necessidade" };
  if (a.kind === "CHAIN_DELAY") return { href: `${base}&tab=planos_diarios`, label: "Ver os planos" };
  if (a.kind === "BUDGET_OVERRUN") return { href: `${base}&tab=centros`, label: "Ver o centro de custo" };
  return { href: base, label: "Abrir a obra" };
}

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = `
    .al-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px}
    .al-modal{background:#fff;border-radius:18px;max-width:720px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(15,23,42,.3);overflow:hidden}
    .al-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px;background:#7f1d1d;color:#fff}
    .al-head h2{font-size:17px;font-weight:700;margin:0}
    .al-head p{font-size:12px;color:#fecaca;margin:4px 0 0}
    .al-close{margin-left:auto;background:none;border:0;color:#fff;cursor:pointer;padding:4px}
    .al-body{padding:16px 20px;overflow:auto;font-size:14px;color:#0f172a}
    .al-item{border:1px solid #e2e8f0;border-left:4px solid #f59e0b;border-radius:12px;padding:12px 14px;margin:0 0 10px}
    .al-item.high{border-left-color:#dc2626}
    .al-item.done{opacity:.6}
    .al-top{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:6px}
    .al-chip{font-size:11px;font-weight:600;border-radius:999px;padding:2px 8px;background:#fef3c7;color:#92400e}
    .al-chip.high{background:#fee2e2;color:#b91c1c}
    .al-chip.kind{background:#f1f5f9;color:#475569}
    .al-title{font-weight:700;margin:0 0 4px;font-size:14px}
    .al-text{margin:0;color:#334155;line-height:1.45;font-size:13px}
    .al-ai{margin:8px 0 0;padding:8px 10px;border-radius:10px;background:#f5f3ff;color:#4c1d95;font-size:13px;line-height:1.45}
    .al-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
    .al-btn{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;border-radius:10px;padding:6px 10px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;text-decoration:none}
    .al-btn.primary{background:#0f172a;border-color:#0f172a;color:#fff}
    .al-btn[disabled]{opacity:.5;cursor:default}
    .al-empty{color:#64748b;font-size:13px}
  `;
  document.head.appendChild(style);
}

/** HTML de uma lista de alertas. Todo o texto é escapado. */
export function renderAlertsHtml(list, { actions = true } = {}) {
  injectStyles();
  if (!list?.length) return '<p class="al-empty">Sem alertas abertos.</p>';
  return list
    .map((a) => {
      const high = a.severity === "HIGH";
      const done = a.status && a.status !== "OPEN";
      const action = actions ? actionFor(a) : null;
      return `<div class="al-item${high ? " high" : ""}${done ? " done" : ""}" data-alert-id="${esc(a.id)}">
        <div class="al-top">
          <span class="al-chip${high ? " high" : ""}">${high ? "Urgente" : "Atenção"}</span>
          <span class="al-chip kind">${esc(a.kindLabel || "Alerta")}</span>
          ${a.project ? `<span class="al-chip kind">${esc(a.project.code)}</span>` : ""}
          ${done ? `<span class="al-chip kind">${esc(STATUS_LABEL[a.status] || a.status)}</span>` : ""}
        </div>
        <p class="al-title">${esc(a.title)}</p>
        <p class="al-text">${esc(a.body)}</p>
        ${a.aiExplanation ? `<p class="al-ai">✨ ${esc(a.aiExplanation)}</p>` : ""}
        ${
          actions
            ? `<div class="al-actions">
                ${action ? `<a class="al-btn primary" href="${esc(action.href)}">${esc(action.label)}</a>` : ""}
                ${a.status === "OPEN" ? '<button type="button" class="al-btn" data-alert-ack>Marcar como visto</button>' : ""}
              </div>`
            : ""
        }
      </div>`;
    })
    .join("");
}

function close(overlay) {
  overlay.remove();
  document.removeEventListener("keydown", overlay._onKey);
}

/** Abre os alertas num modal. */
export async function openAlerts({ ids = [] } = {}) {
  injectStyles();
  const overlay = document.createElement("div");
  overlay.className = "al-overlay";
  overlay.innerHTML = `<div class="al-modal" role="dialog" aria-modal="true">
    <div class="al-head"><div><h2>Alertas das obras</h2><p>Detetados pelo sistema a partir dos planos, stock, necessidades e orçamento. Fecham sozinhos quando a situação se resolve.</p></div>
    <button type="button" class="al-close" aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <div class="al-body"><p class="al-empty">A carregar…</p></div></div>`;
  overlay.addEventListener("click", async (e) => {
    if (e.target === overlay || e.target.closest(".al-close")) return close(overlay);
    const ack = e.target.closest("[data-alert-ack]");
    if (!ack) return;
    const item = ack.closest("[data-alert-id]");
    ack.disabled = true;
    try {
      await apiRequest(`/ai/alerts/${encodeURIComponent(item.dataset.alertId)}/ack`, { method: "POST" });
      item.classList.add("done");
      ack.replaceWith(Object.assign(document.createElement("span"), { className: "al-chip kind", textContent: "Visto" }));
    } catch (error) {
      ack.disabled = false;
      alert(error.message || "Não foi possível marcar o alerta.");
    }
  });
  overlay._onKey = (e) => e.key === "Escape" && close(overlay);
  document.addEventListener("keydown", overlay._onKey);
  document.body.appendChild(overlay);

  const body = overlay.querySelector(".al-body");
  try {
    const query = ids.length ? `?ids=${encodeURIComponent(ids.join(","))}` : "";
    const { items } = await apiRequest(`/ai/alerts${query}`);
    const resolved = items.filter((a) => a.status === "RESOLVED").length;
    body.innerHTML =
      (resolved ? `<p class="al-empty" style="margin:0 0 10px">${resolved} destes alertas já foram resolvidos entretanto.</p>` : "") +
      renderAlertsHtml(items);
  } catch (error) {
    body.innerHTML = `<p class="al-empty">${esc(error.message || "Não foi possível abrir os alertas.")}</p>`;
  }
}
