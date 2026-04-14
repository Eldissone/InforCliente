export function setText(el, text) {
  if (!el) return;
  el.textContent = text ?? "";
}

/**
 * Toggles a loading spinner on a button.
 * Requires shared-ui.css for .btn-loading class.
 */
export function setButtonLoading(btn, isLoading) {
  if (!btn) return;
  if (isLoading) {
    btn.classList.add("btn-loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("btn-loading");
    btn.disabled = false;
  }
}

/**
 * Returns a template for a loading table row.
 * Requires shared-ui.css for .skeleton class.
 */
export function renderLoadingRow(colspan = 6) {
  return `
    <tr>
      <td colspan="${colspan}" class="px-6 py-12">
        <div class="flex flex-col gap-4 w-full">
          <div class="h-4 w-3/4 skeleton opacity-50"></div>
          <div class="h-4 w-1/2 skeleton opacity-30"></div>
          <div class="h-4 w-2/3 skeleton opacity-40"></div>
        </div>
      </td>
    </tr>
  `;
}

export function toast(message, { type = "info", timeoutMs = 3000 } = {}) {
  const rootId = "inforcliente-toast-root";
  let root = document.getElementById(rootId);
  if (!root) {
    root = document.createElement("div");
    root.id = rootId;
    root.className = "fixed top-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none";
    document.body.appendChild(root);
  }

  const el = document.createElement("div");
  const bg =
    type === "error"
      ? "bg-red-50 text-red-800 border-red-100"
      : type === "success"
        ? "bg-emerald-50 text-emerald-800 border-emerald-100"
        : "bg-white text-slate-800 border-slate-100";
  
  el.className = `pointer-events-auto border ${bg} flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg shadow-black/5 min-w-[320px] transform translate-y-[-20px] opacity-0 transition-all duration-300 ease-out`;
  el.innerHTML = `
    <span class="material-symbols-outlined text-[20px] ${type === 'error' ? 'text-red-500' : type === 'success' ? 'text-emerald-500' : 'text-blue-500'}">
      ${type === 'error' ? 'error' : type === 'success' ? 'check_circle' : 'info'}
    </span>
    <span class="font-medium text-sm">${message}</span>
  `;
  root.appendChild(el);

  // Trigger animation
  requestAnimationFrame(() => {
    el.classList.remove("translate-y-[-20px]", "opacity-0");
  });

  window.setTimeout(() => {
    el.classList.add("translate-y-[-20px]", "opacity-0");
    el.addEventListener("transitionend", () => {
      el.remove();
      if (root.childElementCount === 0) root.remove();
    });
  }, timeoutMs);
}

export function openModal({
  title,
  contentHtml,
  primaryLabel = "Salvar",
  onPrimary,
  secondaryLabel = "Cancelar",
  onSecondary,
}) {
  const overlay = document.createElement("div");
  overlay.className =
    "fixed inset-0 z-[9998] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 transition-opacity duration-300 ease-out opacity-0";

  const panel = document.createElement("div");
  panel.className =
    "relative flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.1)] transform scale-95 transition-transform duration-300 ease-out";

  panel.innerHTML = `
    <div class="flex shrink-0 items-center justify-between px-8 py-6">
      <h3 class="text-xl font-bold text-slate-900">${title || ""}</h3>
      <button data-close class="flex h-10 w-10 items-center justify-center rounded-full text-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-colors">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div class="overflow-y-auto px-8 pb-8" data-body>${contentHtml || ""}</div>
    <div class="flex shrink-0 justify-end gap-3 bg-slate-50/50 px-8 py-6">
      ${secondaryLabel ? `<button data-secondary class="h-11 px-6 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 transition-colors">${secondaryLabel}</button>` : ""}
      ${primaryLabel ? `<button data-primary class="h-11 px-6 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 transition-all active:scale-95">${primaryLabel}</button>` : ""}
    </div>
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Trigger animations
  requestAnimationFrame(() => {
    overlay.classList.remove("opacity-0");
    panel.classList.remove("scale-95");
  });

  function close() {
    overlay.classList.add("opacity-0");
    panel.classList.add("scale-95");
    overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  panel.querySelector("[data-close]")?.addEventListener("click", close);
  panel.querySelector("[data-secondary]")?.addEventListener("click", async () => {
    if (onSecondary) {
      const body = panel.querySelector("[data-body]");
      await onSecondary({ close, panel, body });
    } else {
      close();
    }
  });
  panel.querySelector("[data-primary]")?.addEventListener("click", async () => {
    if (onPrimary) {
      const body = panel.querySelector("[data-body]");
      const inputs = Array.from(body.querySelectorAll("input:required, select:required, textarea:required"));
      const firstInvalid = inputs.find((el) => !el.checkValidity());
      if (firstInvalid) {
        firstInvalid.reportValidity();
        return;
      }
      const btn = panel.querySelector("[data-primary]");
      await onPrimary({ btn, close, panel, body });
    } else {
      close();
    }
  });

  return { close, overlay, panel };
}

/**
 * Initializes mobile menu toggle for the navbar.
 * Expected HTML structure:
 * <button id="mobileMenuBtn">...</button>
 * <div id="navMenu">...</div>
 */
export function initMobileMenu() {
  const btn = document.getElementById("mobileMenuBtn");
  const menu = document.getElementById("navMenu");
  if (!btn || !menu) return;

  btn.addEventListener("click", () => {
    const isExpanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", !isExpanded);
    
    if (!isExpanded) {
      menu.classList.remove("hidden");
      // Pequeno delay para permitir animação se houver
      requestAnimationFrame(() => {
        menu.classList.add("flex");
      });
    } else {
      menu.classList.add("hidden");
      menu.classList.remove("flex");
    }
  });
}

export function escapeHtml(unsafe) {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
