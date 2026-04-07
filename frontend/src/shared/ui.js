export function setText(el, text) {
  if (!el) return;
  el.textContent = text ?? "";
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
  overlay.className = "fixed inset-0 bg-black/50 z-[9998] flex items-center justify-center p-6";

  const panel = document.createElement("div");
  panel.className = "bg-white rounded-xl shadow-2xl w-full max-w-[720px] overflow-hidden";

  panel.innerHTML = `
    <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
      <div class="font-extrabold text-slate-900">${title || ""}</div>
      <button data-close class="text-slate-500 hover:text-slate-900 font-bold">✕</button>
    </div>
    <div class="p-6" data-body>${contentHtml || ""}</div>
    <div class="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 bg-slate-50">
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
      await onPrimary({ close, panel, body });
    } else {
      close();
    }
  });

  return { close, overlay, panel };
}

