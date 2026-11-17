/**
 * Formulário de preferências de alertas, partilhado entre o menu "Som e
 * alertas" do chat (versão compacta) e o centro de notificações (completa).
 * Usa estilos inline para não depender das classes Tailwind compiladas.
 */

import { escapeHtml } from "./ui.js";
import {
  desktopPermission,
  getNotifyPrefs,
  previewSound,
  requestDesktopPermission,
  setNotifyPrefs,
} from "./notificationSound.js";

/** Grupos de tipos mostrados ao utilizador (um interruptor por grupo). */
export const TYPE_GROUPS = [
  { key: "messages", label: "Mensagens", types: ["NEW_MESSAGE"] },
  { key: "mentions", label: "Menções", types: ["MENTION"] },
  { key: "payments", label: "Pagamentos", types: ["PAYMENT"] },
  { key: "requests", label: "Pedidos e aprovações", types: ["REQUEST", "APPROVAL"] },
  { key: "works", label: "Obra (planos, stock, prazos)", types: ["DAILY_PLAN", "STOCK", "DEADLINE"] },
  { key: "ai", label: "Assistente IA", types: ["AI_INSIGHT"] },
  { key: "system", label: "Sistema e ajuda", types: ["SYSTEM"] },
];

const S = {
  row: "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 2px;",
  hint: "font-size:11px;color:#64748b;margin:2px 2px 6px;",
  title: "font-weight:700;margin:10px 2px 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#475569;",
  time: "width:84px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;",
  btn: "width:100%;margin-top:8px;padding:8px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;font-size:12px;cursor:pointer;",
};

function desktopStatusLabel() {
  const perm = desktopPermission();
  if (perm === "unsupported") return "Este browser não suporta avisos do sistema.";
  if (perm === "denied") return "Bloqueado no browser. Ative nas definições do site.";
  return "";
}

function checkbox(id, checked, disabled = false) {
  return `<input type="checkbox" id="${id}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />`;
}

/**
 * Desenha as preferências em `container` e liga os eventos.
 * @param {HTMLElement} container
 * @param {{compact?: boolean, onMore?: Function}} [options]
 */
export function renderAlertSettings(container, { compact = false, onMore } = {}) {
  if (!container) return;
  const prefs = getNotifyPrefs();
  const perm = desktopPermission();
  const status = desktopStatusLabel();
  const muted = new Set(prefs.mutedTypes);

  container.innerHTML = `
    <label style="${S.row}"><span>Som</span>${checkbox("ns_sound", prefs.soundEnabled)}</label>
    <label style="${S.row}">
      <span>Volume</span>
      <input type="range" id="ns_volume" min="0" max="1" step="0.1" value="${prefs.volume}"
        style="width:120px;" ${prefs.soundEnabled ? "" : "disabled"} />
    </label>
    <label style="${S.row}">
      <span>Avisos no ambiente de trabalho</span>
      ${checkbox("ns_desktop", prefs.desktopEnabled && perm === "granted", perm === "unsupported" || perm === "denied")}
    </label>
    ${status ? `<p style="${S.hint}">${escapeHtml(status)}</p>` : ""}
    <label style="${S.row}"><span>Não incomodar</span>${checkbox("ns_dnd", prefs.dndEnabled)}</label>
    <div style="${S.row}${prefs.dndEnabled ? "" : "opacity:.5;"}">
      <span style="font-size:12px;color:#475569;">Das</span>
      <input type="time" id="ns_dnd_from" value="${escapeHtml(prefs.dndFrom)}" style="${S.time}" ${prefs.dndEnabled ? "" : "disabled"} />
      <span style="font-size:12px;color:#475569;">às</span>
      <input type="time" id="ns_dnd_to" value="${escapeHtml(prefs.dndTo)}" style="${S.time}" ${prefs.dndEnabled ? "" : "disabled"} />
    </div>
    <p style="${S.hint}">Avisos urgentes tocam mesmo em "não incomodar".</p>
    ${
      compact
        ? ""
        : `<p style="${S.title}">Silenciar tipos</p>
           <p style="${S.hint}">Continuam no sino, mas sem som nem aviso.</p>
           ${TYPE_GROUPS.map(
             (g) => `<label style="${S.row}"><span>${escapeHtml(g.label)}</span>
               ${checkbox(`ns_type_${g.key}`, g.types.every((t) => muted.has(t)))}</label>`
           ).join("")}`
    }
    <button type="button" id="ns_test" style="${S.btn}">Testar som</button>
    ${compact && onMore ? `<button type="button" id="ns_more" style="${S.btn}">Mais opções no sino</button>` : ""}
  `;

  const rerender = () => renderAlertSettings(container, { compact, onMore });
  const on = (sel, evt, fn) => container.querySelector(sel)?.addEventListener(evt, fn);

  on("#ns_sound", "change", (e) => {
    setNotifyPrefs({ soundEnabled: e.target.checked });
    rerender();
  });
  on("#ns_volume", "change", (e) => {
    setNotifyPrefs({ volume: Number(e.target.value) });
    previewSound("message");
  });
  on("#ns_desktop", "change", async (e) => {
    if (e.target.checked) await requestDesktopPermission();
    else setNotifyPrefs({ desktopEnabled: false });
    rerender();
  });
  on("#ns_dnd", "change", (e) => {
    setNotifyPrefs({ dndEnabled: e.target.checked });
    rerender();
  });
  on("#ns_dnd_from", "change", (e) => e.target.value && setNotifyPrefs({ dndFrom: e.target.value }));
  on("#ns_dnd_to", "change", (e) => e.target.value && setNotifyPrefs({ dndTo: e.target.value }));
  on("#ns_test", "click", () => previewSound("message"));
  on("#ns_more", "click", () => onMore?.());

  for (const g of compact ? [] : TYPE_GROUPS) {
    on(`#ns_type_${g.key}`, "change", (e) => {
      const set = new Set(getNotifyPrefs().mutedTypes);
      g.types.forEach((t) => (e.target.checked ? set.add(t) : set.delete(t)));
      setNotifyPrefs({ mutedTypes: [...set] });
    });
  }
}
