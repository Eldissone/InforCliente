import { getAssetUrl } from "../services/api.js";

function renderDocumentContent(url, title = "Documento") {
  if (!url) {
    return `
      <div class="py-8 text-center text-slate-300">
        <span class="material-symbols-outlined text-4xl mb-2">description</span>
        <p class="text-xs font-semibold text-slate-500">Sem ${title.toLowerCase()} disponível.</p>
      </div>`;
  }
  const assetUrl = getAssetUrl(url);
  const isImage = url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i);
  if (isImage) {
    return `
      <div class="relative w-full h-full flex flex-col items-center justify-center">
        <img src="${assetUrl}" alt="${title}" class="w-full h-auto object-contain max-h-full rounded-lg shadow-sm border border-slate-200">
      </div>`;
  }
  return `
    <div class="relative w-full h-full min-h-[300px]">
      <iframe src="${assetUrl}" class="w-full h-full min-h-[70vh] rounded-lg shadow-sm border border-slate-200" title="${title}"></iframe>
    </div>`;
}

function ensureDocumentViewerShell() {
  if (document.getElementById("docAside")) return;

  const overlay = document.createElement("div");
  overlay.id = "docAsideOverlay";
  overlay.className =
    "fixed inset-0 bg-slate-900/20 backdrop-blur-sm hidden transition-opacity opacity-0 z-[120]";
  overlay.addEventListener("click", () => closeDocumentViewer());

  const aside = document.createElement("aside");
  aside.id = "docAside";
  aside.className =
    "fixed right-0 top-0 h-full w-full max-w-[640px] bg-white shadow-2xl transform translate-x-full transition-transform duration-300 flex flex-col border-l border-slate-200 z-[130]";
  aside.innerHTML = `
    <div class="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
      <h2 id="docAsideTitle" class="text-lg font-bold text-slate-900 tracking-tight">Documento</h2>
      <button type="button" id="docAsideCloseBtn" aria-label="Fechar documento"
        class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-400 transition-colors">
        <span class="material-symbols-outlined text-lg">close</span>
      </button>
    </div>
    <div id="docAsideContainer" class="flex-1 overflow-auto p-4 bg-slate-50 custom-scroll min-h-[300px]"></div>`;

  aside.querySelector("#docAsideCloseBtn")?.addEventListener("click", () => closeDocumentViewer());

  document.body.appendChild(overlay);
  document.body.appendChild(aside);
}

export function openDocumentViewer(url, title = "Documento") {
  if (!url) return;
  ensureDocumentViewerShell();

  const aside = document.getElementById("docAside");
  const overlay = document.getElementById("docAsideOverlay");
  const container = document.getElementById("docAsideContainer");
  const titleEl = document.getElementById("docAsideTitle");
  if (!aside || !overlay || !container) {
    window.open(getAssetUrl(url), "_blank", "noopener,noreferrer");
    return;
  }

  if (titleEl) titleEl.textContent = title;
  container.innerHTML = renderDocumentContent(url, title);
  document.body.classList.add("doc-viewer-open");
  overlay.classList.remove("hidden");
  requestAnimationFrame(() => {
    overlay.classList.remove("opacity-0");
    aside.classList.remove("translate-x-full");
  });
}

export function closeDocumentViewer() {
  const aside = document.getElementById("docAside");
  const overlay = document.getElementById("docAsideOverlay");
  document.body.classList.remove("doc-viewer-open");
  aside?.classList.add("translate-x-full");
  overlay?.classList.add("opacity-0");
  setTimeout(() => overlay?.classList.add("hidden"), 300);
}

if (typeof window !== "undefined") {
  window.openDocumentViewer = openDocumentViewer;
  window.closeDocumentViewer = closeDocumentViewer;
}
