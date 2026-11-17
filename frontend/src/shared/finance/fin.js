/**
 * Componentes partilhados dos ecrãs operacionais da Área Financeira
 * (Centro de Pagamentos, Centro de Recebimentos, Conciliação Bancária).
 *
 * Tudo é HTML + CSS próprio (assets/styles/pages/finance-ops.css), sem
 * depender de classes Tailwind que não estejam compiladas.
 */
import { apiRequest, apiUpload, getAssetUrl } from "../../services/api.js";
import { toast } from "../ui.js";

export { apiRequest, apiUpload, getAssetUrl, toast };

// ─── texto e números ─────────────────────────────────────────────────────────

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function num(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function round2(value) {
  return Math.round(num(value) * 100) / 100;
}

/** 1234567.8 → «1 234 567,80» (como no programa de orçamentação). */
export function money(value, digits = 2) {
  const v = num(value);
  const neg = v < 0;
  const [int, dec] = Math.abs(v).toFixed(digits).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "−" : ""}${grouped}${digits ? `,${dec}` : ""}`;
}

/** Valor compacto para KPIs: 1,2 M · 350 mil. */
export function compact(value) {
  const v = Math.abs(num(value));
  const sign = num(value) < 0 ? "−" : "";
  if (v >= 1e9) return `${sign}${(v / 1e9).toFixed(1).replace(".", ",")} mM`;
  if (v >= 1e6) return `${sign}${(v / 1e6).toFixed(1).replace(".", ",")} M`;
  if (v >= 1e4) return `${sign}${Math.round(v / 1e3)} mil`;
  return money(value);
}

/** Lê «1 234,56», «1234.56» ou «1.234,56» → 1234.56. */
export function parseMoney(text) {
  let s = String(text ?? "").replace(/[\s  ]/g, "").replace(/[^\d,.\-]/g, "");
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = s.replace(",", ".");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function todayKey() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDays(key, days) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function endOfMonth(key) {
  const d = new Date(`${key.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(key) {
  if (!key) return "—";
  const [y, m, d] = String(key).slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(key);
}

export function monthLabel(key) {
  if (!key) return "—";
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 86400000);
}

export function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function icon(name, extra = "") {
  return `<span class="material-symbols-outlined ${extra}" aria-hidden="true">${name}</span>`;
}

// ─── estados ─────────────────────────────────────────────────────────────────

const PILL_TONES = {
  Pago: "good",
  Recebido: "good",
  Conciliado: "good",
  Atrasado: "bad",
  Rejeitado: "bad",
  Anulada: "bad",
  "Por aprovar": "warn",
  "Em pausa": "warn",
  "Pago parcial": "warn",
  Parcial: "warn",
  "Em trânsito": "info",
  "Em cotação": "violet",
  Previsto: "info",
};

export function pill(label, tone) {
  const t = tone || PILL_TONES[label] || "neutral";
  return `<span class="fo-pill fo-pill--${t}"><span class="fo-pill-dot"></span>${esc(label)}</span>`;
}

// ─── ficheiros ───────────────────────────────────────────────────────────────

export function fileUrl(path) {
  return path ? getAssetUrl(path) : null;
}

export function openFile(path) {
  const url = fileUrl(path);
  if (url) window.open(url, "_blank", "noopener");
}

export async function copyText(text, label = "Copiado") {
  try {
    await navigator.clipboard.writeText(String(text ?? ""));
    toast(`${label}.`, { type: "success", timeoutMs: 1500 });
  } catch {
    toast("Não foi possível copiar.", { type: "error" });
  }
}

// ─── camada de sobreposição: gaveta lateral, diálogo, menus ───────────────────

let layerZ = 9000;

function trapEscape(onEscape) {
  const handler = (e) => {
    if (e.key !== "Escape") return;
    // Com um menu / lista aberta, o Esc fecha primeiro esse menu.
    if (document.querySelector("[data-fo-popover]")) return;
    // Num campo com lista de sugestões, o Esc só fecha a lista.
    if (e.target?.closest?.("[data-combo]")) return;
    // Só fecha a camada de cima.
    const layers = [...document.querySelectorAll("[data-fo-layer]")];
    const top = layers[layers.length - 1];
    if (top && top.dataset.foLayer === handler.id) {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
    }
  };
  handler.id = `l${Math.random().toString(36).slice(2)}`;
  document.addEventListener("keydown", handler, true);
  return handler;
}

/**
 * Gaveta lateral (formularios e detalhes). Devolve { el, body, footer, close, setTitle }.
 * `width`: largura máxima em px.
 */
export function openDrawer({ kicker = "", title = "", subtitle = "", width = 920, onClose, headerActions = "" } = {}) {
  const root = document.createElement("div");
  root.className = "fo-drawer-root";
  root.style.zIndex = String((layerZ += 2));
  root.innerHTML = `
    <div class="fo-drawer-scrim" data-close></div>
    <aside class="fo-drawer" role="dialog" aria-modal="true" style="--fo-drawer-w:${width}px">
      <header class="fo-drawer-head">
        <div class="fo-drawer-titles">
          ${kicker ? `<p class="fo-kicker">${kicker}</p>` : ""}
          <h2 class="fo-drawer-title">${title}</h2>
          ${subtitle ? `<p class="fo-drawer-sub">${subtitle}</p>` : ""}
        </div>
        <div class="fo-drawer-actions">${headerActions}<button type="button" class="fo-icon-btn" data-close title="Fechar (Esc)">${icon("close")}</button></div>
      </header>
      <div class="fo-drawer-body" data-body></div>
      <footer class="fo-drawer-foot" data-footer hidden></footer>
    </aside>`;
  document.body.appendChild(root);
  document.body.classList.add("fo-no-scroll");
  requestAnimationFrame(() => root.classList.add("is-open"));
  let closed = false;
  const escH = trapEscape(() => api.close());
  root.dataset.foLayer = escH.id;
  const api = {
    el: root,
    body: root.querySelector("[data-body]"),
    footer: root.querySelector("[data-footer]"),
    head: root.querySelector(".fo-drawer-head"),
    async close(force = false) {
      if (closed) return;
      if (!force && onClose && (await onClose()) === false) return;
      closed = true;
      document.removeEventListener("keydown", escH, true);
      root.classList.remove("is-open");
      setTimeout(() => {
        root.remove();
        if (!document.querySelector(".fo-drawer-root")) document.body.classList.remove("fo-no-scroll");
      }, 220);
    },
    setHeader({ kicker: k, title: t, subtitle: s, actions } = {}) {
      const titles = root.querySelector(".fo-drawer-titles");
      if (t !== undefined || k !== undefined || s !== undefined) {
        titles.innerHTML = `${k ? `<p class="fo-kicker">${k}</p>` : ""}<h2 class="fo-drawer-title">${t || ""}</h2>${s ? `<p class="fo-drawer-sub">${s}</p>` : ""}`;
      }
      if (actions !== undefined) {
        root.querySelector(".fo-drawer-actions").innerHTML = `${actions}<button type="button" class="fo-icon-btn" data-close title="Fechar (Esc)">${icon("close")}</button>`;
      }
    },
    setFooter(html) {
      api.footer.hidden = !html;
      api.footer.innerHTML = html || "";
    },
  };
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) api.close();
  });
  return api;
}

/** Diálogo pequeno centrado. Devolve { el, body, close }. */
export function openDialog({ title = "", contentHtml = "", width = 520, actions = "", onClose } = {}) {
  const root = document.createElement("div");
  root.className = "fo-dialog-root";
  root.style.zIndex = String((layerZ += 2));
  root.innerHTML = `
    <div class="fo-dialog" role="dialog" aria-modal="true" style="max-width:${width}px">
      <header class="fo-dialog-head"><h3>${title}</h3><button type="button" class="fo-icon-btn" data-close>${icon("close")}</button></header>
      <div class="fo-dialog-body" data-body>${contentHtml}</div>
      ${actions ? `<footer class="fo-dialog-foot" data-footer>${actions}</footer>` : ""}
    </div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add("is-open"));
  let closed = false;
  const escH = trapEscape(() => api.close());
  root.dataset.foLayer = escH.id;
  const api = {
    el: root,
    body: root.querySelector("[data-body]"),
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", escH, true);
      root.classList.remove("is-open");
      onClose?.();
      setTimeout(() => root.remove(), 180);
    },
  };
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) api.close();
  });
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) api.close();
  });
  return api;
}

/** Confirmação / alerta / pergunta com texto (substitui confirm/prompt do browser). */
export function ask(message, { title = "Confirmar", ok = "Confirmar", danger = false, input = false, placeholder = "", value = "", required = false, cancel = "Cancelar", alert = false } = {}) {
  return new Promise((resolve) => {
    const dlg = openDialog({
      title,
      width: 460,
      contentHtml: `<p class="fo-ask-text">${esc(message)}</p>${
        input ? `<textarea class="fo-input fo-ask-input" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : ""
      }`,
      actions: `${alert ? "" : `<button type="button" class="fo-btn fo-btn--ghost" data-a="0">${esc(cancel)}</button>`}<button type="button" class="fo-btn ${danger ? "fo-btn--danger" : "fo-btn--primary"}" data-a="1">${esc(ok)}</button>`,
      onClose: () => resolve(input ? null : false),
    });
    const field = dlg.el.querySelector(".fo-ask-input");
    setTimeout(() => (field || dlg.el.querySelector('[data-a="1"]')).focus(), 30);
    const done = (yes) => {
      if (yes && input && required && !String(field.value).trim()) {
        field.classList.add("is-invalid");
        field.focus();
        return;
      }
      const v = yes ? (input ? field.value : true) : input ? null : false;
      dlg.el.querySelectorAll("[data-a]").forEach((b) => (b.disabled = true));
      resolve(v);
      dlg.close();
    };
    dlg.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (b) done(b.dataset.a === "1");
    });
    dlg.el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (!input || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        done(true);
      }
    });
  });
}

/** Menu de opções junto de um elemento. items: [{label, icon, tone, onClick, disabled, hint}] | "sep" */
export function popMenu(anchor, items, { title = "", width = 260 } = {}) {
  closePopovers();
  const r = anchor.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "fo-menu";
  el.dataset.foPopover = "1";
  el.style.width = `${width}px`;
  el.innerHTML = `${title ? `<div class="fo-menu-title">${title}</div>` : ""}${items
    .map((it, i) =>
      it === "sep"
        ? `<div class="fo-menu-sep"></div>`
        : `<button type="button" class="fo-menu-item ${it.tone ? `is-${it.tone}` : ""}" data-i="${i}" ${it.disabled ? "disabled" : ""}>${it.icon ? icon(it.icon) : ""}<span><b>${esc(it.label)}</b>${it.hint ? `<small>${esc(it.hint)}</small>` : ""}</span></button>`
    )
    .join("")}`;
  document.body.appendChild(el);
  placePopover(el, r, width);
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    closePopovers();
    it?.onClick?.();
  });
  return el;
}

/** Cartão flutuante (ex.: dados do beneficiário). */
export function popCard(anchor, html, { width = 340 } = {}) {
  closePopovers();
  const el = document.createElement("div");
  el.className = "fo-popcard";
  el.dataset.foPopover = "1";
  el.style.width = `${width}px`;
  el.innerHTML = html;
  document.body.appendChild(el);
  placePopover(el, anchor.getBoundingClientRect(), width);
  return el;
}

function placePopover(el, r, width) {
  // Abre do lado com mais espaço; se não couber, rola por dentro em vez de sair do ecrã.
  const below = window.innerHeight - r.bottom - 14;
  const above = r.top - 14;
  let h = el.offsetHeight;
  const room = h <= below ? below : Math.max(below, above);
  if (h > room) {
    el.style.maxHeight = `${Math.max(160, room)}px`;
    el.style.overflowY = "auto";
    h = el.offsetHeight;
  }
  let top = h <= below || below >= above ? r.bottom + 6 : r.top - h - 6;
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 12));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  requestAnimationFrame(() => el.classList.add("is-open"));
}

export function closePopovers() {
  document.querySelectorAll("[data-fo-popover]").forEach((p) => p.remove());
}

document.addEventListener(
  "mousedown",
  (e) => {
    if (!e.target.closest("[data-fo-popover]") && !e.target.closest("[data-fo-keep-pop]")) closePopovers();
  },
  true
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.querySelector("[data-fo-popover]")) {
    closePopovers();
    e.stopPropagation();
  }
});
window.addEventListener("resize", closePopovers);
document.addEventListener("scroll", (e) => {
  if (!e.target.closest?.("[data-fo-popover]")) closePopovers();
}, true);

// ─── filtro de escolha múltipla (botão + lista com caixas) ────────────────────

/**
 * Filtro tipo «Todos os estados ▾». options: [{value,label,group?}]
 * value atual: array (vazio = todos). onChange(values).
 */
export function multiFilterHtml(key, label, values, options, { allLabel } = {}) {
  const sel = options.filter((o) => values.includes(o.value));
  const text = !sel.length ? allLabel || label : sel.length === 1 ? sel[0].label : `${sel.length} selecionados`;
  return `<button type="button" class="fo-filter ${sel.length ? "is-on" : ""}" data-fo-keep-pop data-mf="${esc(key)}"><span>${esc(text)}</span>${icon("expand_more")}</button>`;
}

export function openMultiFilter(anchor, { title, values, options, allLabel, presets = [], onChange }) {
  closePopovers();
  const el = document.createElement("div");
  el.className = "fo-menu fo-menu--check";
  el.dataset.foPopover = "1";
  el.style.width = "300px";
  const render = () => {
    let lastGroup = null;
    el.innerHTML = `<div class="fo-menu-title">${esc(title)}</div>
      <button type="button" class="fo-menu-item ${!values.length ? "is-checked" : ""}" data-all>${icon(!values.length ? "radio_button_checked" : "radio_button_unchecked")}<span><b>${esc(allLabel || "Todos")}</b></span></button>
      ${presets.map((p, i) => `<button type="button" class="fo-menu-item ${sameSet(values, p.values) ? "is-checked" : ""}" data-preset="${i}">${icon(sameSet(values, p.values) ? "radio_button_checked" : "radio_button_unchecked")}<span><b>${esc(p.label)}</b>${p.hint ? `<small>${esc(p.hint)}</small>` : ""}</span></button>`).join("")}
      <div class="fo-menu-sep"></div>
      <div class="fo-menu-scroll">${options
        .map((o) => {
          const head = o.group && o.group !== lastGroup ? `<div class="fo-menu-group">${esc(o.group)}</div>` : "";
          lastGroup = o.group || lastGroup;
          const on = values.includes(o.value);
          return `${head}<button type="button" class="fo-menu-item ${on ? "is-checked" : ""}" data-v="${esc(o.value)}" ${o.disabled ? "disabled" : ""}>${icon(on ? "check_box" : "check_box_outline_blank")}<span><b>${esc(o.label)}</b>${o.hint ? `<small>${esc(o.hint)}</small>` : ""}</span></button>`;
        })
        .join("")}</div>`;
  };
  render();
  document.body.appendChild(el);
  placePopover(el, anchor.getBoundingClientRect(), 300);
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-all]")) values = [];
    else if (e.target.closest("[data-preset]")) values = presets[Number(e.target.closest("[data-preset]").dataset.preset)].values.slice();
    else {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      const v = b.dataset.v;
      values = values.includes(v) ? values.filter((x) => x !== v) : [...values, v];
    }
    render();
    onChange(values.slice());
  });
}

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

// ─── combobox com pesquisa (terceiros, produtos, obras…) ──────────────────────

/**
 * Liga um <input> a uma lista com pesquisa. items: [{value,label,sub?,search?}]
 * onPick(item) quando se escolhe; createLabel(text) mostra «＋ Criar …».
 */
export function bindCombo(input, { items, onPick, onCreate, createLabel, max = 60, emptyText = "Sem resultados" }) {
  let list = null;
  let active = 0;
  let shown = [];
  const close = () => {
    list?.remove();
    list = null;
  };
  const render = () => {
    const q = norm(input.value);
    const src = typeof items === "function" ? items() : items;
    shown = src.filter((it) => !q || norm(`${it.label} ${it.sub || ""} ${it.search || ""}`).includes(q)).slice(0, max);
    const canCreate = onCreate && input.value.trim() && !src.some((it) => norm(it.label) === q);
    if (!list) {
      list = document.createElement("div");
      list.className = "fo-combo";
      list.dataset.foPopover = "1";
      document.body.appendChild(list);
    }
    list.innerHTML =
      shown
        .map((it, i) => `<button type="button" class="fo-combo-item ${i === active ? "is-active" : ""}" data-i="${i}"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</button>`)
        .join("") +
      (!shown.length && !canCreate ? `<div class="fo-combo-empty">${esc(emptyText)}</div>` : "") +
      (canCreate ? `<button type="button" class="fo-combo-item fo-combo-create" data-create>${icon("add")}<b>${esc(createLabel ? createLabel(input.value.trim()) : `Criar «${input.value.trim()}»`)}</b></button>` : "");
    const r = input.getBoundingClientRect();
    const w = Math.max(r.width, 280);
    list.style.width = `${w}px`;
    list.style.left = `${Math.min(r.left, window.innerWidth - w - 12)}px`;
    const below = window.innerHeight - r.bottom;
    if (below < 260 && r.top > below) {
      list.style.top = "";
      list.style.bottom = `${window.innerHeight - r.top + 4}px`;
    } else {
      list.style.bottom = "";
      list.style.top = `${r.bottom + 4}px`;
    }
    list.classList.add("is-open");
  };
  const pick = (i) => {
    const it = shown[i];
    if (!it) return;
    close();
    onPick(it);
  };
  input.setAttribute("autocomplete", "off");
  input.addEventListener("focus", () => {
    active = 0;
    render();
  });
  input.addEventListener("input", () => {
    active = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (!list) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(active + 1, shown.length - 1);
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      render();
    } else if (e.key === "Enter") {
      if (shown[active]) {
        e.preventDefault();
        pick(active);
      } else if (onCreate && input.value.trim()) {
        e.preventDefault();
        close();
        onCreate(input.value.trim());
      }
    } else if (e.key === "Escape") {
      close();
      e.stopPropagation();
    } else if (e.key === "Tab") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 160));
  document.addEventListener("mousedown", (e) => {
    if (!list) return;
    const b = e.target.closest(".fo-combo [data-i], .fo-combo [data-create]");
    if (b && list.contains(b)) {
      e.preventDefault();
      if (b.dataset.create !== undefined) {
        close();
        onCreate(input.value.trim());
      } else pick(Number(b.dataset.i));
    }
  });
}

// ─── campos de valor ─────────────────────────────────────────────────────────

/** Formata ao sair do campo; devolve o número com input.dataset.value. */
export function bindMoney(root) {
  root.querySelectorAll("input[data-money]").forEach((inp) => {
    if (inp.dataset.moneyBound) return;
    inp.dataset.moneyBound = "1";
    inp.setAttribute("inputmode", "decimal");
    inp.addEventListener("focus", () => {
      const v = parseMoney(inp.value);
      if (inp.value) inp.value = v ? String(v).replace(".", ",") : "";
      inp.select();
    });
    inp.addEventListener("blur", () => {
      if (!String(inp.value).trim()) return;
      inp.value = money(parseMoney(inp.value));
    });
  });
}

// ─── escolher ficheiros ──────────────────────────────────────────────────────

export function pickFiles({ accept = "", multiple = false } = {}) {
  return new Promise((resolve) => {
    const i = document.createElement("input");
    i.type = "file";
    if (accept) i.accept = accept;
    i.multiple = multiple;
    i.style.display = "none";
    document.body.appendChild(i);
    i.addEventListener("change", () => {
      const files = [...(i.files || [])];
      i.remove();
      resolve(files);
    });
    i.click();
  });
}

/** Zona para anexar ficheiros (arrastar ou escolher). state: { files: File[] } */
export function fileZoneHtml(key, { label = "Anexar", hint = "", multiple = false, accept = "", required = false, files = [] } = {}) {
  return `<div class="fo-filezone ${files.length ? "has-files" : ""}" data-fz="${esc(key)}" data-accept="${esc(accept)}" data-multiple="${multiple ? 1 : 0}">
    <div class="fo-filezone-drop">${icon("upload_file")}<span><b>${esc(label)}${required ? ' <i class="fo-req">*</i>' : ""}</b><small>${esc(hint || "Arraste o ficheiro para aqui ou clique para escolher")}</small></span></div>
    ${files.length ? `<ul class="fo-filelist">${files.map((f, i) => `<li>${icon(/pdf/i.test(f.type || f.name) ? "picture_as_pdf" : "description")}<span>${esc(f.name)}</span><small>${(f.size / 1024).toFixed(0)} KB</small><button type="button" class="fo-icon-btn fo-icon-btn--sm" data-fz-rm="${i}" title="Retirar">${icon("close")}</button></li>`).join("")}</ul>` : ""}
  </div>`;
}

/** Liga as zonas de ficheiros de `root` ao objeto `store` (store[key] = File[]). */
export function bindFileZones(root, store, onChange) {
  root.querySelectorAll("[data-fz]").forEach((zone) => {
    if (zone.dataset.fzBound) return;
    zone.dataset.fzBound = "1";
    const key = zone.dataset.fz;
    const multiple = zone.dataset.multiple === "1";
    const accept = zone.dataset.accept;
    const add = (files) => {
      const ok = files.filter((f) => !accept || accept.split(",").some((a) => (a.trim().startsWith(".") ? f.name.toLowerCase().endsWith(a.trim()) : (f.type || "").match(a.trim().replace("*", ".*")))));
      if (ok.length < files.length) toast(`Formato não aceite${accept ? ` (${accept})` : ""}.`, { type: "error" });
      if (!ok.length) return;
      store[key] = multiple ? [...(store[key] || []), ...ok] : [ok[0]];
      onChange?.(key);
    };
    zone.addEventListener("click", async (e) => {
      const rm = e.target.closest("[data-fz-rm]");
      if (rm) {
        e.stopPropagation();
        store[key] = (store[key] || []).filter((_, i) => i !== Number(rm.dataset.fzRm));
        onChange?.(key);
        return;
      }
      if (e.target.closest(".fo-filezone-drop")) add(await pickFiles({ accept, multiple }));
    });
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("is-drag");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("is-drag"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("is-drag");
      add([...(e.dataTransfer?.files || [])]);
    });
  });
}

// ─── blocos de página ────────────────────────────────────────────────────────

export function kpiCard({ key, label, value, sub, tone = "neutral", active = false, iconName }) {
  return `<button type="button" class="fo-kpi fo-kpi--${tone} ${active ? "is-active" : ""}" data-kpi="${esc(key)}">
    <span class="fo-kpi-top">${iconName ? icon(iconName) : ""}<span class="fo-kpi-label">${esc(label)}</span></span>
    <b class="fo-kpi-value">${value}</b>
    <span class="fo-kpi-sub">${sub || ""}</span>
  </button>`;
}

export function emptyState({ iconName = "inbox", title, text = "", action = "" }) {
  return `<div class="fo-empty">${icon(iconName)}<h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ""}${action}</div>`;
}

export function skeletonRows(cols = 8, rows = 6) {
  return Array.from({ length: rows }, () => `<tr class="fo-skel-row">${Array.from({ length: cols }, () => `<td><span class="fo-skel"></span></td>`).join("")}</tr>`).join("");
}

export function errorBox(errors) {
  if (!errors || !errors.length) return "";
  return `<div class="fo-errors" role="alert">${icon("error")}<div><b>Para continuar, falta:</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div></div>`;
}

export function setBusy(btn, busy, text) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add("is-busy");
    btn.innerHTML = `<span class="fo-spin"></span>${esc(text || "A gravar…")}`;
  } else {
    btn.disabled = false;
    btn.classList.remove("is-busy");
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

/** Exporta linhas para Excel (SheetJS carregado a pedido). */
export async function exportXlsx(filename, sheetName, header, rows, widths = []) {
  try {
    const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs");
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws["!cols"] = header.map((_, i) => ({ wch: widths[i] || 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 30));
    XLSX.writeFile(wb, filename);
  } catch (err) {
    console.error(err);
    toast("Não foi possível gerar o Excel.", { type: "error" });
  }
}

/** Carrega o SheetJS (para ler extratos em Excel/CSV). */
export async function loadXlsx() {
  return import("https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs");
}

export function errMsg(err, fallback = "Não foi possível concluir.") {
  if (err?.data?.errors?.length) return `Falta: ${err.data.errors.join(", ")}.`;
  return err?.data?.message || err?.message || fallback;
}

/** Atalhos: «/» pesquisa, «N» novo. Ignora quando se escreve num campo. */
export function bindShortcuts(map) {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector(".fo-drawer-root, .fo-dialog-root")) return;
    const fn = map[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });
}
