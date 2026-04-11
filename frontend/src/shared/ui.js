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
    root.className = "fixed bottom-6 left-6 z-[9999] flex flex-col gap-2";
    document.body.appendChild(root);
  }

  const el = document.createElement("div");
  const bg =
    type === "error"
      ? "bg-red-600"
      : type === "success"
        ? "bg-emerald-600"
        : "bg-slate-900";
  el.className = `${bg} text-white text-sm font-semibold px-4 py-3 rounded-lg shadow-xl max-w-[420px]`;
  el.textContent = message;
  root.appendChild(el);

  window.setTimeout(() => {
    el.remove();
    if (root.childElementCount === 0) root.remove();
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
    "fixed inset-0 z-[9998] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center sm:p-6";

  const panel = document.createElement("div");
  panel.className =
    "my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl";

  panel.innerHTML = `
    <div class="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
      <div class="font-extrabold text-slate-900">${title || ""}</div>
      <button data-close class="font-bold text-slate-500 hover:text-slate-900">&times;</button>
    </div>
    <div class="overflow-y-auto p-6" data-body>${contentHtml || ""}</div>
    <div class="flex shrink-0 justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
      <button data-secondary class="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-white">${secondaryLabel}</button>
      <button data-primary class="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700">${primaryLabel}</button>
    </div>
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
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
      const inputs = Array.from(body.querySelectorAll("input, select, textarea"));
      const firstInvalid = inputs.find((el) => !el.checkValidity());
      if (firstInvalid) {
        firstInvalid.reportValidity();
        return;
      }
      await onPrimary({ close, panel, body });
    } else {
      close();
    }
  });

  return { close, overlay, panel };
}
