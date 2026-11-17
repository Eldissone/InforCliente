// Painel lateral (drawer) para formulários extensos, organizado por secções.
import { setButtonLoading } from "../../shared/ui.js";

function escAttr(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * sections: [{ id, label, icon, html, badge? }]
 * onPrimary({ btn, close, panel }) — chamar close(true) após gravar para não pedir confirmação.
 */
export function openDrawer({
  title,
  subtitle = "",
  headerHtml = "",
  sections = [],
  primaryLabel = "Guardar",
  cancelLabel = "Cancelar",
  dangerLabel = "",
  onPrimary,
  onDanger,
  onRender,
  width = 560,
}) {
  const overlay = document.createElement("div");
  overlay.setAttribute("data-app-drawer", "");
  overlay.className = "fixed inset-0 z-[9997] bg-slate-900/40 backdrop-blur-sm opacity-0 transition-opacity duration-200";

  const panel = document.createElement("aside");
  panel.className =
    "fixed right-0 top-0 z-[9998] flex h-full w-full flex-col bg-white shadow-2xl translate-x-full transition-transform duration-300 ease-out";
  panel.style.maxWidth = `${width}px`;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");

  const tabs = sections.length > 1
    ? `<nav class="flex gap-1 px-6 border-b border-slate-100 overflow-x-auto" data-drawer-tabs>
        ${sections.map((s, i) => `
          <button type="button" data-drawer-tab="${escAttr(s.id)}"
            class="drawer-tab ${i === 0 ? "is-active" : ""}">
            ${s.icon ? `<span class="material-symbols-outlined text-base">${s.icon}</span>` : ""}${s.label}
            ${s.badge ? `<span class="drawer-tab-badge" data-drawer-badge="${escAttr(s.id)}">${s.badge}</span>` : `<span class="drawer-tab-badge hidden" data-drawer-badge="${escAttr(s.id)}"></span>`}
          </button>`).join("")}
      </nav>`
    : "";

  panel.innerHTML = `
    <header class="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
      <div class="min-w-0">
        <h3 class="text-xl font-bold text-slate-900 tracking-tight">${title || ""}</h3>
        ${subtitle ? `<p class="text-xs text-slate-500 mt-0.5">${subtitle}</p>` : ""}
      </div>
      <button type="button" data-drawer-close aria-label="Fechar"
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors">
        <span class="material-symbols-outlined">close</span>
      </button>
    </header>
    ${headerHtml ? `<div class="px-6 pb-4" data-drawer-head>${headerHtml}</div>` : ""}
    ${tabs}
    <div class="flex-1 overflow-y-auto px-6 py-5" data-drawer-body>
      ${sections.map((s, i) => `<section data-drawer-section="${escAttr(s.id)}" class="${i === 0 ? "" : "hidden"}">${s.html}</section>`).join("")}
    </div>
    <footer class="flex shrink-0 items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
      ${dangerLabel ? `<button type="button" data-drawer-danger class="h-11 px-4 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 transition-colors">${dangerLabel}</button>` : ""}
      <div class="ml-auto flex items-center gap-2">
        <button type="button" data-drawer-cancel class="h-11 px-5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors">${cancelLabel}</button>
        <button type="button" data-drawer-primary class="h-11 px-6 rounded-xl bg-slate-900 text-sm font-bold text-white hover:bg-slate-800 active:scale-95 transition-all">${primaryLabel}</button>
      </div>
    </footer>`;

  document.body.appendChild(overlay);
  document.body.appendChild(panel);
  requestAnimationFrame(() => {
    overlay.classList.remove("opacity-0");
    panel.classList.remove("translate-x-full");
  });

  let dirty = false;
  let closed = false;
  const markDirty = () => { dirty = true; };
  panel.addEventListener("input", markDirty);
  panel.addEventListener("change", markDirty);

  function destroy() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.classList.add("opacity-0");
    panel.classList.add("translate-x-full");
    setTimeout(() => { overlay.remove(); panel.remove(); }, 300);
  }

  function close(force = false) {
    if (!force && dirty && !window.confirm("Tem alterações por guardar. Fechar e descartá-las?")) return false;
    destroy();
    return true;
  }

  function onKey(e) {
    if (e.key !== "Escape") return;
    // não fecha o drawer se houver um modal por cima
    if (document.querySelector("[data-app-modal]")) return;
    close();
  }
  document.addEventListener("keydown", onKey);

  function showSection(id) {
    panel.querySelectorAll("[data-drawer-section]").forEach((el) => el.classList.toggle("hidden", el.dataset.drawerSection !== id));
    panel.querySelectorAll("[data-drawer-tab]").forEach((el) => el.classList.toggle("is-active", el.dataset.drawerTab === id));
    panel.querySelector("[data-drawer-body]")?.scrollTo({ top: 0 });
  }
  function setBadge(id, text) {
    const b = panel.querySelector(`[data-drawer-badge="${id}"]`);
    if (!b) return;
    b.textContent = text || "";
    b.classList.toggle("hidden", !text);
  }

  overlay.addEventListener("click", () => close());
  panel.querySelector("[data-drawer-close]")?.addEventListener("click", () => close());
  panel.querySelector("[data-drawer-cancel]")?.addEventListener("click", () => close());
  panel.querySelectorAll("[data-drawer-tab]").forEach((el) => el.addEventListener("click", () => showSection(el.dataset.drawerTab)));

  const primary = panel.querySelector("[data-drawer-primary]");
  primary?.addEventListener("click", async () => {
    clearFieldErrors(panel);
    if (onPrimary) {
      await onPrimary({ btn: primary, close: (force = true) => close(force), panel, showSection });
    } else close();
  });
  panel.querySelector("[data-drawer-danger]")?.addEventListener("click", async () => {
    const btn = panel.querySelector("[data-drawer-danger]");
    if (onDanger) await onDanger({ btn, close: (force = true) => close(force), panel });
  });

  const api = { close, panel, overlay, showSection, setBadge, markClean: () => { dirty = false; }, setLoading: (on) => setButtonLoading(primary, on) };
  onRender?.(api);
  return api;
}

// ── Validação inline ─────────────────────────────────────────
export function clearFieldErrors(panel) {
  panel.querySelectorAll("[data-field-error]").forEach((n) => n.remove());
  panel.querySelectorAll(".field-invalid").forEach((n) => n.classList.remove("field-invalid"));
}

/** Marca um campo como inválido e, se tiver secção/tab, navega até ele. */
export function setFieldError(panel, selector, message, showSection) {
  const input = panel.querySelector(selector);
  if (!input) return;
  const section = input.closest("[data-drawer-section]");
  if (section && showSection) showSection(section.dataset.drawerSection);
  input.classList.add("field-invalid");
  const msg = document.createElement("p");
  msg.setAttribute("data-field-error", "");
  msg.className = "mt-1 text-[11px] font-semibold text-red-600";
  msg.textContent = message;
  input.insertAdjacentElement("afterend", msg);
  input.focus?.();
}
