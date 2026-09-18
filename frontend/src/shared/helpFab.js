/**
 * Botão flutuante de ajuda: sugestões e dúvidas com captura de ecrã.
 * Injetado em páginas autenticadas (excepto clientes) via session.js.
 */

import { getSessionUser } from "../services/auth.js";
import { getAssetUrl } from "../services/api.js";
import { toast, escapeHtml } from "./ui.js";
import { closeChatPanel } from "./chatFab.js";
import {
  createHelpTicket,
  fetchMyHelpTickets,
  fetchHelpTicket,
} from "../services/helpApi.js";

let panelEl = null;
let fabEl = null;
let isOpen = false;
let capturing = false;

const state = {
  view: "choose", // choose | form | mine | detail
  type: null,
  screenshotFile: null,
  screenshotUrl: null,
  pageUrl: "",
  pageTitle: "",
  myTickets: [],
  detail: null,
  loadingMine: false,
  submitting: false,
};

const HTML2CANVAS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";

function el(id) {
  return document.getElementById(id);
}

function isCurrentUserCliente() {
  return String(getSessionUser()?.role || "").toLowerCase() === "cliente";
}

function typeLabel(type) {
  return type === "DUVIDA" ? "Dúvida" : "Melhoria";
}

function statusLabel(status) {
  if (status === "RESOLVIDO") return "Resolvido";
  if (status === "EM_ANALISE") return "Em análise";
  return "Aberto";
}

function statusClass(status) {
  if (status === "RESOLVIDO") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (status === "EM_ANALISE") return "bg-amber-50 text-amber-700 border-amber-100";
  return "bg-sky-50 text-sky-700 border-sky-100";
}

function formatWhen(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
}

function currentPageContext() {
  return {
    pageUrl: `${window.location.pathname}${window.location.search || ""}`,
    pageTitle: document.title || "",
  };
}

function hideCaptureTargets(hidden) {
  ["globalHelpFab", "globalHelpPanel", "globalChatFab", "globalChatPanel", "payment-notification-bar"].forEach((id) => {
    const node = el(id);
    if (!node) return;
    node.dataset.helpCapturePrev = hidden ? (node.style.visibility || "") : "";
    node.style.visibility = hidden ? "hidden" : node.dataset.helpCapturePrev || "";
    if (!hidden) delete node.dataset.helpCapturePrev;
  });
}

function loadHtml2Canvas() {
  if (typeof window.html2canvas === "function") return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${HTML2CANVAS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.html2canvas), { once: true });
      existing.addEventListener("error", () => reject(new Error("HTML2CANVAS_LOAD_FAILED")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = HTML2CANVAS_SRC;
    script.async = true;
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => reject(new Error("HTML2CANVAS_LOAD_FAILED"));
    document.head.appendChild(script);
  });
}

function waitFrames(n = 2) {
  return new Promise((resolve) => {
    const step = (left) => {
      if (left <= 0) return resolve();
      requestAnimationFrame(() => step(left - 1));
    };
    step(n);
  });
}

function revokePreview() {
  if (state.screenshotUrl && state.screenshotUrl.startsWith("blob:")) {
    URL.revokeObjectURL(state.screenshotUrl);
  }
  state.screenshotUrl = null;
}

function setScreenshotFile(file) {
  revokePreview();
  state.screenshotFile = file || null;
  state.screenshotUrl = file ? URL.createObjectURL(file) : null;
}

async function captureScreenshot() {
  capturing = true;
  hideCaptureTargets(true);
  await waitFrames(3);
  await new Promise((r) => setTimeout(r, 80));
  try {
    const html2canvas = await loadHtml2Canvas();
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      logging: false,
      scale: Math.min(window.devicePixelRatio || 1, 1.25),
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      ignoreElements: (node) =>
        ["globalHelpFab", "globalHelpPanel", "globalChatFab", "globalChatPanel", "payment-notification-bar"].includes(
          node?.id
        ),
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
    if (!blob) throw new Error("CAPTURE_EMPTY");
    setScreenshotFile(new File([blob], "screenshot.png", { type: "image/png" }));
    return true;
  } catch (err) {
    console.warn("[Ajuda] Captura de ecrã falhou:", err);
    setScreenshotFile(null);
    return false;
  } finally {
    hideCaptureTargets(false);
    capturing = false;
  }
}

function createFab() {
  if (el("globalHelpFab")) return;

  fabEl = document.createElement("button");
  fabEl.id = "globalHelpFab";
  fabEl.type = "button";
  fabEl.setAttribute("aria-label", "Abrir ajuda");
  fabEl.setAttribute("data-role-visible", "admin,operador,financeiro,tecnico,supervisor,leitura");
  fabEl.className =
    "fixed bottom-8 w-12 h-12 bg-slate-900 text-[#2afc8d] rounded-2xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-[90] group";
  fabEl.style.right = "5.5rem";
  fabEl.innerHTML = `
    <span class="material-symbols-outlined text-3xl">help</span>
    
  `;
  fabEl.addEventListener("click", () => {
    try {
      toggleHelpPanel();
    } catch (err) {
      console.error("[Ajuda] Erro ao abrir painel:", err);
    }
  });
  document.body.appendChild(fabEl);
}

function createPanel() {
  if (el("globalHelpPanel")) return;

  panelEl = document.createElement("aside");
  panelEl.id = "globalHelpPanel";
  panelEl.setAttribute("aria-hidden", "true");
  panelEl.className =
    "fixed bottom-28 right-8 w-[min(420px,calc(100vw-2rem))] h-auto max-h-[min(380px,calc(100vh-8rem))] bg-white rounded-2xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden z-[95] transform scale-95 opacity-0 pointer-events-none transition-all duration-200 origin-bottom-right";
  panelEl.style.maxHeight = "min(380px, calc(100vh - 8rem))";
  panelEl.innerHTML = `
    <header class="shrink-0 flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
      <div class="flex items-center gap-3 min-w-0">
        <button type="button" id="globalHelpBack" class="hidden w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-white/10 hover:text-white transition-colors shrink-0">
          <span class="material-symbols-outlined text-xl">arrow_back</span>
        </button>
        <span class="material-symbols-outlined text-[#2afc8d] shrink-0">help</span>
        <div class="min-w-0">
          <div id="globalHelpTitle" class="font-black text-sm tracking-tight truncate">Ajuda</div>
          <div id="globalHelpSubtitle" class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Sugestões e dúvidas</div>
        </div>
      </div>
      <button type="button" id="globalHelpClose" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-white/10 hover:text-white transition-colors">
        <span class="material-symbols-outlined text-xl">close</span>
      </button>
    </header>
    <div id="globalHelpBody" class="flex-1 min-h-0 overflow-y-auto"></div>
    <input id="globalHelpFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" />
  `;
  document.body.appendChild(panelEl);

  el("globalHelpClose")?.addEventListener("click", closeHelpPanel);
  el("globalHelpBack")?.addEventListener("click", onBack);
  el("globalHelpFile")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) setScreenshotFile(file);
    e.target.value = "";
    renderBody();
  });

  panelEl.addEventListener("paste", (e) => {
    if (state.view !== "form") return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    setScreenshotFile(new File([file], file.name || "paste.png", { type: file.type || "image/png" }));
    renderBody();
    toast("Imagem colada.", { type: "success" });
  });
}

function setHeader(title, subtitle, showBack) {
  const titleEl = el("globalHelpTitle");
  const subEl = el("globalHelpSubtitle");
  const backEl = el("globalHelpBack");
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;
  backEl?.classList.toggle("hidden", !showBack);
}

function renderBody() {
  const body = el("globalHelpBody");
  if (!body) return;
  if (state.view === "choose") renderChoose(body);
  else if (state.view === "form") renderForm(body);
  else if (state.view === "mine") renderMine(body);
  else if (state.view === "detail") renderDetail(body);
}

function renderChoose(body) {
  setHeader("Ajuda", "Sugestões e dúvidas", false);
  body.innerHTML = `
    <div class="p-4 flex flex-col gap-2.5">
      <p class="text-[13px] text-slate-500 font-medium leading-snug">Ajude a melhorar o sistema. Captura e descreva sua dúvida ou sugestão.</p>
      <button type="button" data-help-type="MELHORIA" class="w-full text-left p-3 rounded-2xl border border-slate-100 hover:border-slate-900 hover:shadow-md transition-all bg-slate-50/80">
        <div class="flex items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-slate-900 text-[#2afc8d] flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined">lightbulb</span>
          </span>
          <div>
            <div class="font-black text-slate-900 text-sm">Sugerir melhoria</div>
            <div class="text-[11px] text-slate-500 font-medium">Propor uma alteração neste ecrã</div>
          </div>
        </div>
      </button>
      <button type="button" data-help-type="DUVIDA" class="w-full text-left p-3 rounded-2xl border border-slate-100 hover:border-slate-900 hover:shadow-md transition-all bg-slate-50/80">
        <div class="flex items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-sky-700 text-white flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined">contact_support</span>
          </span>
          <div>
            <div class="font-black text-slate-900 text-sm">Tirar uma dúvida</div>
            <div class="text-[11px] text-slate-500 font-medium">Perguntar sobre este ponto do sistema</div>
          </div>
        </div>
      </button>
      <button type="button" id="globalHelpMineBtn" class="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-colors">
        <span class="material-symbols-outlined text-base">history</span> Os meus pedidos
      </button>
    </div>
  `;
  body.querySelectorAll("[data-help-type]").forEach((btn) => {
    btn.addEventListener("click", () => startCaptureFlow(btn.getAttribute("data-help-type")));
  });
  el("globalHelpMineBtn")?.addEventListener("click", () => openMine());
}

function renderCapturing(body) {
  setHeader("A capturar…", "Aguarde um instante", false);
  body.innerHTML = `
    <div class="flex flex-col items-center justify-center gap-2 text-slate-500 p-6">
      <span class="material-symbols-outlined text-4xl animate-pulse">photo_camera</span>
      <p class="text-sm font-semibold text-center">A capturar o ecrã actual…</p>
    </div>
  `;
}

function renderForm(body) {
  const kind = typeLabel(state.type);
  setHeader(kind, "Descreva e envie", true);
  const preview = state.screenshotUrl
    ? `<img src="${escapeHtml(state.screenshotUrl)}" alt="Captura de ecrã" class="w-full h-24 object-cover object-top bg-slate-100" />`
    : `<div class="h-24 flex flex-col items-center justify-center gap-1 text-slate-400 bg-slate-50">
        <span class="material-symbols-outlined text-3xl">hide_image</span>
        <span class="text-[11px] font-semibold">Sem captura — anexe ou cole uma imagem</span>
      </div>`;

  body.innerHTML = `
    <form id="globalHelpForm" class="p-4 flex flex-col gap-3">
      <div class="rounded-2xl overflow-hidden border border-slate-100">
        ${preview}
        <div class="flex items-center gap-2 px-3 py-2 bg-white border-t border-slate-100">
          <button type="button" id="helpRecapture" class="text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-900 flex items-center gap-1">
            <span class="material-symbols-outlined text-base">photo_camera</span> Recapturar
          </button>
          <button type="button" id="helpAttach" class="text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-900 flex items-center gap-1">
            <span class="material-symbols-outlined text-base">attach_file</span> Anexar
          </button>
          ${state.screenshotFile ? `<button type="button" id="helpRemoveShot" class="ml-auto text-[10px] font-black uppercase tracking-widest text-rose-500 hover:text-rose-700">Remover</button>` : `<span class="ml-auto text-[10px] text-slate-400 font-medium">Ctrl+V para colar</span>`}
        </div>
      </div>
      <p class="text-[11px] text-slate-400 font-medium truncate" title="${escapeHtml(state.pageUrl)}">
        <span class="material-symbols-outlined text-sm align-middle">location_on</span>
        ${escapeHtml(state.pageTitle || state.pageUrl)}
      </p>
      <textarea id="helpMessage" required maxlength="5000" rows="3" placeholder="${state.type === "DUVIDA" ? "Qual é a sua dúvida?" : "Que melhoria sugere?"}"
        class="w-full min-h-[4.5rem] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-900"></textarea>
      <button type="submit" id="helpSubmit" class="h-10 rounded-xl bg-slate-900 text-[#2afc8d] font-black text-xs uppercase tracking-widest hover:bg-slate-800 disabled:opacity-60">
        Enviar ${escapeHtml(kind)}
      </button>
    </form>
  `;

  el("helpRecapture")?.addEventListener("click", () => startCaptureFlow(state.type, { recapture: true }));
  el("helpAttach")?.addEventListener("click", () => el("globalHelpFile")?.click());
  el("helpRemoveShot")?.addEventListener("click", () => {
    setScreenshotFile(null);
    renderBody();
  });
  el("globalHelpForm")?.addEventListener("submit", onSubmit);
  el("helpMessage")?.focus();
}

function renderMine(body) {
  setHeader("Os meus pedidos", "Histórico e respostas", true);
  if (state.loadingMine) {
    body.innerHTML = `<div class="p-8 text-center text-sm text-slate-400 font-semibold">A carregar…</div>`;
    return;
  }
  const items = state.myTickets || [];
  if (!items.length) {
    body.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center gap-2 text-slate-400 p-8">
        <span class="material-symbols-outlined text-4xl">inbox</span>
        <p class="text-sm font-semibold">Ainda não enviou pedidos.</p>
      </div>`;
    return;
  }
  body.innerHTML = `
    <div class="divide-y divide-slate-50">
      ${items
        .map(
          (t) => `
        <button type="button" data-help-open="${escapeHtml(t.id)}" class="w-full text-left px-5 py-4 hover:bg-slate-50 transition-colors">
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="text-[10px] font-black uppercase tracking-widest ${t.type === "DUVIDA" ? "text-sky-700" : "text-slate-700"}">${escapeHtml(typeLabel(t.type))}</span>
            <span class="px-2 py-0.5 rounded-lg border text-[9px] font-black uppercase tracking-widest ${statusClass(t.status)}">${escapeHtml(statusLabel(t.status))}</span>
          </div>
          <p class="text-sm font-semibold text-slate-800 line-clamp-2">${escapeHtml(t.message)}</p>
          <p class="text-[11px] text-slate-400 mt-1">${escapeHtml(formatWhen(t.createdAt))}${t.adminReply ? " · Com resposta" : ""}</p>
        </button>`
        )
        .join("")}
    </div>
  `;
  body.querySelectorAll("[data-help-open]").forEach((btn) => {
    btn.addEventListener("click", () => openDetail(btn.getAttribute("data-help-open")));
  });
}

function renderDetail(body) {
  const t = state.detail;
  if (!t) {
    body.innerHTML = `<div class="p-8 text-center text-sm text-slate-400">Pedido não encontrado.</div>`;
    return;
  }
  setHeader(typeLabel(t.type), statusLabel(t.status), true);
  const shot = t.screenshotUrl ? getAssetUrl(t.screenshotUrl) : null;
  body.innerHTML = `
    <div class="p-5 flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <span class="px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest ${statusClass(t.status)}">${escapeHtml(statusLabel(t.status))}</span>
        <span class="text-[11px] text-slate-400">${escapeHtml(formatWhen(t.createdAt))}</span>
      </div>
      ${
        shot
          ? `<a href="${escapeHtml(shot)}" target="_blank" rel="noopener" class="rounded-2xl overflow-hidden border border-slate-100 block">
              <img src="${escapeHtml(shot)}" alt="Captura" class="w-full max-h-48 object-cover object-top bg-slate-100" />
            </a>`
          : ""
      }
      <p class="text-[11px] text-slate-400 font-medium truncate">${escapeHtml(t.pageTitle || t.pageUrl || "")}</p>
      <div>
        <div class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">A sua mensagem</div>
        <p class="text-sm text-slate-800 font-medium whitespace-pre-wrap">${escapeHtml(t.message)}</p>
      </div>
      ${
        t.adminReply
          ? `<div class="rounded-2xl bg-emerald-50 border border-emerald-100 p-4">
              <div class="text-[10px] font-black uppercase tracking-widest text-emerald-700 mb-1">Resposta</div>
              <p class="text-sm text-emerald-950 font-medium whitespace-pre-wrap">${escapeHtml(t.adminReply)}</p>
            </div>`
          : `<p class="text-sm text-slate-400 font-medium">Ainda sem resposta da administração.</p>`
      }
    </div>
  `;
}

async function startCaptureFlow(type, { recapture = false } = {}) {
  state.type = type;
  Object.assign(state, currentPageContext());
  closeChatPanel?.();

  if (!recapture) {
    state.view = "form";
  }
  const body = el("globalHelpBody");
  if (body) renderCapturing(body);

  closeHelpPanelVisual();
  const ok = await captureScreenshot();
  openHelpPanelVisual();
  state.view = "form";
  renderBody();
  if (!ok) toast("Não foi possível capturar o ecrã. Anexe ou cole uma imagem.", { type: "info" });
}

async function onSubmit(e) {
  e.preventDefault();
  if (state.submitting) return;
  const message = String(el("helpMessage")?.value || "").trim();
  if (!message) {
    toast("Escreva a mensagem.", { type: "error" });
    return;
  }

  const btn = el("helpSubmit");
  state.submitting = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "A enviar…";
  }

  try {
    const form = new FormData();
    form.append("type", state.type);
    form.append("message", message);
    form.append("pageUrl", state.pageUrl || window.location.pathname);
    form.append("pageTitle", state.pageTitle || document.title || "");
    if (state.screenshotFile) form.append("file", state.screenshotFile, state.screenshotFile.name || "screenshot.png");
    await createHelpTicket(form);
    toast("Pedido enviado. A administração foi notificada.", { type: "success" });
    resetComposer();
    closeHelpPanel();
  } catch (err) {
    toast(err.message || "Falha ao enviar o pedido.", { type: "error" });
    if (btn) {
      btn.disabled = false;
      btn.textContent = `Enviar ${typeLabel(state.type)}`;
    }
  } finally {
    state.submitting = false;
  }
}

function resetComposer() {
  revokePreview();
  state.type = null;
  state.screenshotFile = null;
  state.pageUrl = "";
  state.pageTitle = "";
  state.view = "choose";
}

async function openMine() {
  state.view = "mine";
  state.loadingMine = true;
  renderBody();
  try {
    const data = await fetchMyHelpTickets();
    state.myTickets = data.items || [];
  } catch (err) {
    toast(err.message || "Falha ao carregar os pedidos.", { type: "error" });
    state.myTickets = [];
  } finally {
    state.loadingMine = false;
    if (state.view === "mine") renderBody();
  }
}

async function openDetail(id) {
  state.view = "detail";
  state.detail = state.myTickets.find((t) => t.id === id) || null;
  renderBody();
  try {
    state.detail = await fetchHelpTicket(id);
    if (state.view === "detail") renderBody();
  } catch (err) {
    toast(err.message || "Falha ao abrir o pedido.", { type: "error" });
  }
}

function onBack() {
  if (state.view === "detail") {
    openMine();
    return;
  }
  resetComposer();
  renderBody();
}

function openHelpPanelVisual() {
  if (!panelEl) panelEl = el("globalHelpPanel");
  if (!panelEl) return;
  isOpen = true;
  panelEl.setAttribute("aria-hidden", "false");
  panelEl.classList.remove("scale-95", "opacity-0", "pointer-events-none");
  panelEl.classList.add("scale-100", "opacity-100", "pointer-events-auto");
}

function closeHelpPanelVisual() {
  if (!panelEl) panelEl = el("globalHelpPanel");
  if (!panelEl) return;
  panelEl.setAttribute("aria-hidden", "true");
  panelEl.classList.add("scale-95", "opacity-0", "pointer-events-none");
  panelEl.classList.remove("scale-100", "opacity-100", "pointer-events-auto");
}

export function openHelpPanel() {
  if (!panelEl) createPanel();
  if (!panelEl) panelEl = el("globalHelpPanel");
  if (!panelEl) return;
  closeChatPanel?.();
  if (state.view !== "form") {
    state.view = "choose";
  }
  openHelpPanelVisual();
  renderBody();
}

export function closeHelpPanel() {
  if (!panelEl) return;
  isOpen = false;
  if (!capturing) {
    closeHelpPanelVisual();
  }
  fabEl?.focus();
}

export function toggleHelpPanel() {
  if (capturing) return;
  if (isOpen) closeHelpPanel();
  else openHelpPanel();
}

async function consumeAuthorDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("helpTicket");
  if (!id) return;
  params.delete("helpTicket");
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash || ""}`;
  window.history.replaceState({}, "", next);
  openHelpPanel();
  await openDetail(id);
}

export async function initHelpFab() {
  if (isCurrentUserCliente()) return;
  createFab();
  createPanel();
  window.addEventListener("inforcliente:chat-open", () => {
    if (isOpen && !capturing) closeHelpPanel();
  });
  await consumeAuthorDeepLink();
}
