/**
 * Botão flutuante global + painel de chat em tempo real.
 * Injetado em todas as páginas autenticadas via wireUsersNav().
 */

import { getSessionUser, getToken } from "../services/auth.js";
import { getAssetUrl, getApiBaseUrl } from "../services/api.js";
import { openModal } from "./ui.js";
import {
  fetchConversations,
  fetchMessages,
  createConversation,
  markConversationRead,
  searchUsers,
  fetchNotifications,
} from "../services/chatApi.js";
import {
  connectSocket,
  onSocketEvent,
  joinConversation,
  leaveConversation,
  sendSocketMessage,
  emitTypingStart,
  emitTypingStop,
  markMessagesRead,
} from "../services/socketClient.js";
import { escapeHtml } from "./ui.js";
import {
  enqueuePaymentNotification,
  loadUnreadPaymentNotifications,
} from "./paymentNotificationBar.js";

let panelEl = null;
let fabEl = null;
let isOpen = false;
let wired = false;

const state = {
  conversations: [],
  activeId: null,
  messages: [],
  typingUsers: new Map(),
  searchFilter: "",
  loading: false,
};

function el(id) {
  return document.getElementById(id);
}

function presenceDot(status) {
  const colors = { ONLINE: "bg-emerald-500", AWAY: "bg-amber-400", OFFLINE: "bg-slate-300" };
  return `<span class="w-2 h-2 rounded-full ${colors[status] || colors.OFFLINE}"></span>`;
}

function userAvatar(user, size = "w-10 h-10") {
  const src = getAssetUrl(user?.profilePic) || "/assets/img/placeholder-user.png";
  const name = escapeHtml(user?.name || user?.email || "?");
  return `<img src="${src}" alt="${name}" class="${size} rounded-xl object-cover bg-slate-100" onerror="this.src='/assets/img/placeholder-user.png'" />`;
}

function formatTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
}

function renderMentionBody(body) {
  return escapeHtml(body || "").replace(
    /@\[([^\]]+)\]\(([^)]+)\)/g,
    '<span class="text-[#0d3fd1] font-bold bg-blue-50 px-1 rounded">@$1</span>'
  );
}

function getCurrentUserId() {
  return getSessionUser()?.id || null;
}

function isMineMessage(m) {
  const me = getCurrentUserId();
  if (!me || !m) return false;
  return m.sender?.id === me || m.senderId === me;
}

function receiptLabel(status) {
  if (status === "READ") return "Lida";
  if (status === "DELIVERED") return "Entregue";
  return "Enviada";
}

function isCurrentUserCliente() {
  return String(getSessionUser()?.role || "").toLowerCase() === "cliente";
}

function filterChatUsers(items) {
  if (!isCurrentUserCliente()) return items;
  return (items || []).filter((u) => String(u.role || "").toLowerCase() !== "cliente");
}

function totalUnread() {
  return state.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
}

function createFab() {
  if (el("globalChatFab")) return;

  fabEl = document.createElement("button");
  fabEl.id = "globalChatFab";
  fabEl.type = "button";
  fabEl.setAttribute("aria-label", "Abrir chat");
  fabEl.setAttribute("data-role-visible", "admin,operador,financeiro,tecnico,supervisor,leitura,cliente");
  fabEl.className =
    "fixed bottom-8 right-8 w-16 h-16 bg-slate-900 text-[#2afc8d] rounded-2xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-[90] group";
  fabEl.innerHTML = `
    <span class="material-symbols-outlined text-3xl">forum</span>
    <span id="globalChatFabBadge"
      class="hidden absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">0</span>
    <span
      class="absolute right-20 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">Chat</span>
  `;

  fabEl.addEventListener("click", () => {
    try {
      toggleChatPanel();
    } catch (err) {
      console.error("[Chat] Erro ao abrir painel:", err);
    }
  });
  document.body.appendChild(fabEl);
}

function createPanel() {
  if (el("globalChatPanel")) return;

  panelEl = document.createElement("aside");
  panelEl.id = "globalChatPanel";
  panelEl.setAttribute("aria-hidden", "true");
  panelEl.className =
    "fixed bottom-28 right-8 w-[min(420px,calc(100vw-2rem))] h-[min(560px,calc(100vh-8rem))] bg-white rounded-2xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden z-[95] transform scale-95 opacity-0 pointer-events-none transition-all duration-200 origin-bottom-right";

  panelEl.innerHTML = `
    <header class="shrink-0 flex items-center justify-between px-5 py-4 bg-slate-900 text-white">
      <div class="flex items-center gap-3 min-w-0">
        <button type="button" id="globalChatBack" class="hidden w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-white/10 hover:text-white transition-colors shrink-0">
          <span class="material-symbols-outlined text-xl">arrow_back</span>
        </button>
        <span class="material-symbols-outlined text-[#2afc8d] shrink-0">forum</span>
        <div class="min-w-0">
          <h2 id="globalChatTitle" class="text-sm font-bold leading-tight truncate">Mensagens</h2>
          <p id="globalChatSubtitle" class="text-[10px] text-slate-400 font-medium truncate">Comunicação em tempo real</p>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button type="button" id="globalChatNew" aria-label="Nova conversa"
          class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-white/10 hover:text-white transition-colors">
          <span class="material-symbols-outlined text-xl">edit_square</span>
        </button>
        <button type="button" id="globalChatClose" aria-label="Fechar chat"
          class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-white/10 hover:text-white transition-colors">
          <span class="material-symbols-outlined text-xl">close</span>
        </button>
      </div>
    </header>

    <div id="globalChatListView">
      <div class="shrink-0 px-4 py-3 border-b border-slate-100">
        <div class="relative">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
          <input id="globalChatSearch" type="search" placeholder="Pesquisar conversas..."
            class="w-full h-10 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/30" />
        </div>
      </div>
      <div id="globalChatConversations" class="flex-1 overflow-y-auto custom-scroll divide-y divide-slate-50 min-h-0" style="max-height: calc(min(560px, 100vh - 8rem) - 140px)"></div>
    </div>

    <div id="globalChatThreadView" class="hidden flex-1 flex flex-col min-h-0">
      <div id="globalChatMessages" class="flex-1 overflow-y-auto custom-scroll p-4 space-y-3 min-h-0" style="max-height: calc(min(560px, 100vh - 8rem) - 180px)"></div>
      <p id="globalChatTyping" class="hidden px-4 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest"></p>
    </div>

    <footer id="globalChatFooter" class="hidden shrink-0 p-4 border-t border-slate-100 bg-slate-50/50">
      <div class="flex gap-2 items-center">
        <input type="file" id="globalChatFileInput" class="hidden" />
        <button type="button" id="globalChatAttach" title="Anexar ficheiro"
          class="w-11 h-11 text-slate-400 hover:text-slate-900 rounded-xl flex items-center justify-center hover:bg-slate-200 transition-all shrink-0">
          <span class="material-symbols-outlined">attach_file</span>
        </button>
        <button type="button" id="globalChatAudio" title="Gravar áudio"
          class="w-11 h-11 text-slate-400 hover:text-red-500 rounded-xl flex items-center justify-center hover:bg-slate-200 transition-all shrink-0">
          <span class="material-symbols-outlined">mic</span>
        </button>
        <input id="globalChatInput" type="text" disabled placeholder="Seleccione uma conversa..."
          class="flex-1 min-w-0 h-11 bg-white border border-slate-200 rounded-xl px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/30 disabled:text-slate-400 disabled:cursor-not-allowed" />
        <button type="button" id="globalChatSend" disabled
          class="w-11 h-11 bg-slate-900 text-[#2afc8d] rounded-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed disabled:hover:scale-100 shrink-0">
          <span class="material-symbols-outlined">send</span>
        </button>
      </div>
    </footer>
  `;

  document.body.appendChild(panelEl);

  panelEl.querySelector("#globalChatClose")?.addEventListener("click", closeChatPanel);
  panelEl.querySelector("#globalChatBack")?.addEventListener("click", showListView);
  panelEl.querySelector("#globalChatSearch")?.addEventListener("input", (e) => {
    state.searchFilter = e.target.value.trim().toLowerCase();
    renderConversationList();
  });
  panelEl.querySelector("#globalChatSend")?.addEventListener("click", handleSend);
  panelEl.querySelector("#globalChatInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  let typingTimeout;
  panelEl.querySelector("#globalChatInput")?.addEventListener("input", () => {
    if (!state.activeId) return;
    emitTypingStart(state.activeId);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => emitTypingStop(state.activeId), 1500);
  });

  panelEl.querySelector("#globalChatNew")?.addEventListener("click", openNewConversationPrompt);

  const fileInput = panelEl.querySelector("#globalChatFileInput");
  const attachBtn = panelEl.querySelector("#globalChatAttach");
  const audioBtn = panelEl.querySelector("#globalChatAudio");

  attachBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  });

  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;

  audioBtn?.addEventListener("click", async () => {
    if (!state.activeId) return;
    if (isRecording) {
      mediaRecorder?.stop();
      isRecording = false;
      audioBtn.classList.remove("text-red-500", "animate-pulse");
      audioBtn.classList.add("text-slate-400");
      el("globalChatInput").placeholder = "Escreva uma mensagem...";
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          const file = new File([audioBlob], `audio_${Date.now()}.webm`, { type: 'audio/webm' });
          handleFileUpload(file);
          stream.getTracks().forEach(track => track.stop());
        };
        mediaRecorder.start();
        isRecording = true;
        audioBtn.classList.remove("text-slate-400");
        audioBtn.classList.add("text-red-500", "animate-pulse");
        el("globalChatInput").placeholder = "A gravar áudio... (clique no microfone para parar)";
      } catch (err) {
        console.error("Erro no microfone:", err);
        alert("Não foi possível aceder ao microfone.");
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closeChatPanel();
  });
}

function showListView() {
  if (state.activeId) leaveConversation(state.activeId);
  state.activeId = null;
  state.messages = [];
  el("globalChatListView")?.classList.remove("hidden");
  el("globalChatThreadView")?.classList.add("hidden");
  el("globalChatBack")?.classList.add("hidden");
  el("globalChatTitle").textContent = "Mensagens";
  el("globalChatSubtitle").textContent = "Comunicação em tempo real";
  el("globalChatFooter")?.classList.add("hidden");
  const input = el("globalChatInput");
  const sendBtn = el("globalChatSend");
  if (input) {
    input.disabled = true;
    input.value = "";
  }
  if (sendBtn) sendBtn.disabled = true;
}

async function openConversation(conversationId) {
  const conv = state.conversations.find((c) => c.id === conversationId);
  if (!conv) return;

  if (state.activeId && state.activeId !== conversationId) {
    leaveConversation(state.activeId);
  }

  state.activeId = conversationId;
  el("globalChatListView")?.classList.add("hidden");
  el("globalChatThreadView")?.classList.remove("hidden");
  el("globalChatBack")?.classList.remove("hidden");
  el("globalChatTitle").textContent = conv.title || "Conversa";
  el("globalChatSubtitle").textContent = conv.participants?.map((p) => p.name || p.email).join(", ") || "";

  el("globalChatFooter")?.classList.remove("hidden");

  const input = el("globalChatInput");
  const sendBtn = el("globalChatSend");
  if (input) {
    input.disabled = false;
    input.placeholder = "Escreva uma mensagem...";
    input.focus();
  }
  if (sendBtn) sendBtn.disabled = false;

  el("globalChatMessages").innerHTML = `<div class="flex justify-center p-8"><div class="animate-spin w-6 h-6 border-2 border-slate-200 border-t-slate-900 rounded-full"></div></div>`;

  await joinConversation(conversationId);
  const data = await fetchMessages(conversationId);
  state.messages = data.items || [];
  renderMessages();
  await markConversationRead(conversationId);
  await markMessagesRead(conversationId);
  conv.unreadCount = 0;
  setChatUnreadCount(totalUnread());
  renderConversationList();
}

function renderConversationList() {
  const host = el("globalChatConversations");
  if (!host) return;

  const filtered = state.conversations.filter((c) => {
    if (!state.searchFilter) return true;
    const hay = `${c.title} ${(c.lastMessage?.body || "")}`.toLowerCase();
    return hay.includes(state.searchFilter);
  });

  if (!filtered.length) {
    host.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full p-8 text-center min-h-[200px]">
        <span class="material-symbols-outlined text-4xl text-slate-200 mb-3">chat_bubble</span>
        <p class="text-sm font-bold text-slate-600">Sem conversas</p>
        <p class="text-xs text-slate-400 mt-1">Clique em + para iniciar uma conversa.</p>
      </div>`;
    return;
  }

  host.innerHTML = filtered
    .map((c) => {
      const other = (c.participants || []).find((p) => p.id !== getCurrentUserId()) || c.participants?.[0];
      let previewHTML = escapeHtml(c.lastMessage?.body || "");
      if (!previewHTML && c.lastMessage?.attachments?.length > 0) {
        const mime = c.lastMessage.attachments[0].mimeType || "";
        if (mime.startsWith('image/')) previewHTML = `<span class="material-symbols-outlined text-[14px] align-text-bottom mr-0.5">image</span> Imagem`;
        else if (mime.startsWith('audio/')) previewHTML = `<span class="material-symbols-outlined text-[14px] align-text-bottom mr-0.5">mic</span> Áudio`;
        else previewHTML = `<span class="material-symbols-outlined text-[14px] align-text-bottom mr-0.5">attach_file</span> Anexo`;
      }
      previewHTML = previewHTML || (c.lastMessage ? "Nova mensagem" : "Sem mensagens");

      const time = formatTime(c.lastMessage?.createdAt || c.updatedAt);
      const unread = c.unreadCount > 0;
      return `
        <button type="button" data-conv-id="${c.id}"
          class="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left ${state.activeId === c.id ? "bg-slate-50" : ""}">
          <div class="relative shrink-0">
            ${userAvatar(other)}
            <span class="absolute -bottom-0.5 -right-0.5">${presenceDot(other?.presence?.status)}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex justify-between items-center gap-2">
              <span class="text-sm font-bold text-slate-900 truncate">${escapeHtml(c.title || other?.name || "Conversa")}</span>
              <span class="text-[10px] text-slate-400 shrink-0">${time}</span>
            </div>
            <p class="text-xs text-slate-500 truncate mt-0.5 ${unread ? "font-bold text-slate-800" : ""}">${previewHTML}</p>
          </div>
          ${unread ? `<span class="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#2afc8d] text-[#0F172A] text-[10px] font-black flex items-center justify-center">${c.unreadCount > 9 ? "9+" : c.unreadCount}</span>` : ""}
        </button>`;
    })
    .join("");

  host.querySelectorAll("[data-conv-id]").forEach((btn) => {
    btn.addEventListener("click", () => openConversation(btn.getAttribute("data-conv-id")));
  });
}

function renderMessages() {
  const host = el("globalChatMessages");
  if (!host) return;
  const conv = state.conversations.find((c) => c.id === state.activeId);
  const isDirect = (conv?.type || "DIRECT") !== "GROUP";

  if (!state.messages.length) {
    host.innerHTML = `<p class="text-center text-xs text-slate-400 py-8">Sem mensagens. Envie a primeira!</p>`;
    host.scrollTop = 0;
    return;
  }

  host.innerHTML = state.messages
    .map((m, i) => {
      const mine = isMineMessage(m);
      const prev = state.messages[i - 1];
      const sameAsPrev =
        prev &&
        isMineMessage(prev) === mine &&
        (prev.sender?.id || prev.senderId) === (m.sender?.id || m.senderId);
      const showIncomingMeta = !mine && !sameAsPrev && !isDirect;
      const showAvatar = !mine && !sameAsPrev;
      const statusLine = mine
        ? `${formatTime(m.createdAt)} · ${receiptLabel(m.status)}`
        : formatTime(m.createdAt);
      return `
        <div class="flex ${mine ? "justify-end" : "justify-start"} gap-2 ${sameAsPrev ? "mt-0.5" : "mt-3"}">
          ${mine ? "" : showAvatar ? `<div class="shrink-0 self-end">${userAvatar(m.sender, "w-8 h-8")}</div>` : `<div class="w-8 shrink-0" aria-hidden="true"></div>`}
          <div class="max-w-[75%] ${mine ? "items-end" : ""}">
            ${showIncomingMeta ? `<p class="text-[10px] font-bold text-slate-400 mb-1 ml-1">${escapeHtml(m.sender?.name || m.sender?.email || "")}</p>` : ""}
            <div class="${mine ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-800"} rounded-2xl ${mine ? "rounded-br-md" : "rounded-bl-md"} px-4 py-2.5 text-sm leading-relaxed">
              ${m.body ? renderMentionBody(m.body) : ""}
              ${renderAttachments(m.attachments, mine)}
            </div>
            <p class="text-[9px] text-slate-400 mt-1 ${mine ? "text-right" : "ml-1"}">${statusLine}</p>
          </div>
        </div>`;
    })
    .join("");

  host.scrollTop = host.scrollHeight;

  host.onclick = (e) => {
    const img = e.target.closest("img[data-lightbox-url]");
    if (img) openImageLightbox(img.dataset.lightboxUrl, img.dataset.lightboxName);
  };
}

function updateTypingIndicator() {
  const elTyping = el("globalChatTyping");
  if (!elTyping || !state.activeId) return;
  const names = state.typingUsers.get(state.activeId);
  if (!names?.size) {
    elTyping.classList.add("hidden");
    return;
  }
  elTyping.textContent = `${[...names].join(", ")} a escrever...`;
  elTyping.classList.remove("hidden");
}

async function handleSend() {
  const input = el("globalChatInput");
  if (!input || !state.activeId) return;
  const body = input.value.trim();
  if (!body) return;

  input.value = "";
  input.disabled = true;
  el("globalChatSend").disabled = true;

  const result = await sendSocketMessage({ conversationId: state.activeId, body });
  if (result?.ok && result.message) {
    if (!state.messages.some((m) => m.id === result.message.id)) {
      state.messages.push(result.message);
      renderMessages();
    }
  } else if (!result?.ok) {
    const { sendMessageRest } = await import("../services/chatApi.js");
    try {
      const fallback = await sendMessageRest(state.activeId, body);
      if (fallback?.message) {
        state.messages.push(fallback.message);
        renderMessages();
      }
    } catch {
      input.value = body;
    }
  }

  input.disabled = false;
  el("globalChatSend").disabled = false;
  input.focus();
}

async function handleFileUpload(file) {
  if (!state.activeId) return;
  const input = el("globalChatInput");
  const originalPlaceholder = input.placeholder;
  input.placeholder = "A enviar anexo...";
  input.disabled = true;
  el("globalChatSend").disabled = true;

  try {
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch(`${getApiBaseUrl()}/conversations/${state.activeId}/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd
    });

    if (!res.ok) throw new Error("Upload falhou");
    const data = await res.json();

    const result = await sendSocketMessage({
      conversationId: state.activeId,
      body: "",
      attachments: [data]
    });

    if (!result?.ok) {
      throw new Error("Falha ao enviar anexo via socket");
    }
  } catch (err) {
    console.error("Upload error:", err);
    alert("Erro ao enviar anexo: " + err.message);
  } finally {
    input.placeholder = originalPlaceholder;
    input.disabled = false;
    el("globalChatSend").disabled = false;
    input.focus();
  }
}

function openImageLightbox(url, fileName) {
  const existing = document.getElementById('chatImageLightbox');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'chatImageLightbox';
  overlay.className = 'fixed inset-0 z-[200] flex items-center justify-center p-4';
  overlay.style.cssText = 'background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);';
  overlay.innerHTML = `
    <div class="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3">
      <img src="${url}" alt="${escapeHtml(fileName || 'Imagem')}"
        class="max-w-[85vw] max-h-[80vh] rounded-2xl object-contain shadow-2xl"
        style="border: 1px solid rgba(255,255,255,0.1);" />
      <div class="flex items-center gap-3">
        <a href="${url}" download="${escapeHtml(fileName || 'imagem')}" target="_blank"
          class="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all backdrop-blur-sm border border-white/10">
          <span class="material-symbols-outlined text-[16px]">download</span> Guardar
        </a>
        <button type="button" id="chatLightboxClose"
          class="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all backdrop-blur-sm border border-white/10">
          <span class="material-symbols-outlined text-[16px]">close</span> Fechar
        </button>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('#chatLightboxClose').addEventListener('click', () => overlay.remove());

  const onKeydown = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKeydown); }
  };
  document.addEventListener('keydown', onKeydown);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

function renderAttachments(attachments, mine) {
  if (!attachments || !attachments.length) return "";
  return attachments.map(a => {
    const url = getAssetUrl(a.path) || a.url;
    const safeName = escapeHtml(a.fileName || "ficheiro");
    if (a.mimeType.startsWith('image/')) {
      return `<img src="${url}" alt="${safeName}"
        class="max-w-[200px] rounded-xl mt-2 cursor-pointer hover:opacity-90 hover:scale-[1.02] transition-all shadow-md"
        data-lightbox-url="${url}" data-lightbox-name="${safeName}" />`;
    }
    if (a.mimeType.startsWith('audio/')) {
      return `<audio controls src="${url}" class="max-w-[200px] mt-2 h-10 ${mine ? 'grayscale invert opacity-90' : ''}"></audio>`;
    }
    return `<a href="${url}" target="_blank" class="flex items-center gap-2 mt-2 p-2 rounded bg-black/10 hover:bg-black/20 transition-colors text-xs font-medium">
      <span class="material-symbols-outlined text-sm">download</span>
      <span class="truncate" style="max-width: 150px;">${safeName}</span>
    </a>`;
  }).join('');
}

async function openNewConversationPrompt() {
  openModal({
    title: "Nova Conversa",
    contentHtml: `
      <div class="flex flex-col gap-4 min-h-[300px]">
        <div class="relative">
          <input type="text" id="chatUserSearch" placeholder="Pesquisar utilizadores por nome ou email..." class="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 focus:outline-none focus:border-[#2afc8d] focus:ring-1 focus:ring-[#2afc8d] text-sm" />
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
        </div>
        <div id="chatUserList" class="flex flex-col gap-2 max-h-[400px] overflow-y-auto custom-scroll pr-2">
          <div class="text-center text-sm text-slate-500 py-4">A carregar utilizadores...</div>
        </div>
      </div>
    `,
    primaryLabel: null,
    secondaryLabel: "Cancelar",
    onRender: async ({ close, panel }) => {
      const searchInput = panel.querySelector("#chatUserSearch");
      const listEl = panel.querySelector("#chatUserList");

      const renderUsers = async (q = "") => {
        try {
          const data = await searchUsers(q);
          const items = filterChatUsers(data.items || []);
          if (!items.length) {
            listEl.innerHTML = '<div class="text-center text-sm text-slate-500 py-4">Nenhum utilizador encontrado.</div>';
            return;
          }

          listEl.innerHTML = items.map(u => `
            <button type="button" data-user-id="${u.id}" class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left group border border-transparent hover:border-slate-100">
              <img src="${getAssetUrl(u.profilePic) || '/assets/img/placeholder-user.png'}" class="w-10 h-10 rounded-full object-cover bg-slate-100 shrink-0" onerror="this.src='/assets/img/placeholder-user.png'" />
              <div class="min-w-0 flex-1">
                <div class="font-bold text-sm text-slate-900 truncate group-hover:text-[#0d3fd1] transition-colors">${escapeHtml(u.name || u.email)}</div>
                <div class="text-xs text-slate-500 truncate capitalize">${escapeHtml((u.role || "Utilizador").toLowerCase())}</div>
              </div>
            </button>
          `).join('');

          listEl.querySelectorAll("button[data-user-id]").forEach(btn => {
            btn.addEventListener("click", async () => {
              const userId = btn.getAttribute("data-user-id");
              btn.classList.add("opacity-50", "pointer-events-none");
              try {
                const created = await createConversation({ participantIds: [userId], type: "DIRECT" });
                await loadConversations();
                if (created?.conversation?.id) openConversation(created.conversation.id);
                close();
              } catch (err) {
                const msg = err.message?.includes("CLIENT_TO_CLIENT")
                  ? "Clientes não podem iniciar conversas com outros clientes."
                  : (err.message || "Erro ao criar conversa.");
                alert(msg);
                btn.classList.remove("opacity-50", "pointer-events-none");
              }
            });
          });
        } catch (err) {
          listEl.innerHTML = '<div class="text-center text-sm text-red-500 py-4">Erro ao carregar utilizadores.</div>';
        }
      };

      await renderUsers();

      let timeout;
      searchInput.addEventListener("input", (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => renderUsers(e.target.value), 300);
      });
      requestAnimationFrame(() => searchInput.focus());
    }
  });
}

async function loadConversations() {
  try {
    const data = await fetchConversations();
    state.conversations = data.items || [];
    setChatUnreadCount(totalUnread());
    renderConversationList();
  } catch (err) {
    console.warn("Chat: falha ao carregar conversas", err.message);
  }
}

function wireSocketEvents() {
  if (wired) return;
  wired = true;

  onSocketEvent("message:new", (message) => {
    const conv = state.conversations.find((c) => c.id === message.conversationId);
    if (conv) {
      conv.lastMessage = message;
      conv.updatedAt = message.createdAt;
      if (message.conversationId !== state.activeId && !isMineMessage(message)) {
        conv.unreadCount = (conv.unreadCount || 0) + 1;
      }
    } else {
      loadConversations();
    }

    if (message.conversationId === state.activeId) {
      if (!state.messages.some((m) => m.id === message.id)) {
        state.messages.push(message);
        renderMessages();
      }
      if (!isMineMessage(message)) {
        markMessagesRead(state.activeId, message.id);
      }
    }

    setChatUnreadCount(totalUnread());
    renderConversationList();
  });

  onSocketEvent("typing:update", ({ conversationId, userId, isTyping, userName }) => {
    if (userId === getCurrentUserId()) return;
    if (!state.typingUsers.has(conversationId)) state.typingUsers.set(conversationId, new Set());
    const set = state.typingUsers.get(conversationId);
    if (isTyping) set.add(userName || "Alguém");
    else set.delete(userName || "Alguém");
    if (conversationId === state.activeId) updateTypingIndicator();
  });

  onSocketEvent("message:status", ({ messageId, conversationId, status }) => {
    if (status !== "READ" || !messageId) return;
    const msg = state.messages.find((m) => m.id === messageId);
    if (msg) msg.status = "READ";
    const conv = state.conversations.find((c) => c.id === conversationId);
    if (conv?.lastMessage?.id === messageId) conv.lastMessage.status = "READ";
    if (conversationId === state.activeId) renderMessages();
  });

  onSocketEvent("presence:changed", ({ userId, status }) => {
    state.conversations.forEach((c) => {
      c.participants?.forEach((p) => {
        if (p.id === userId && p.presence) p.presence.status = status;
      });
    });
    if (isOpen && !state.activeId) renderConversationList();
  });

  onSocketEvent("notification:new", (payload) => {
    if (payload?.type === "PAYMENT") {
      enqueuePaymentNotification(payload);
    }
  });
}

export function openChatPanel() {
  if (!panelEl) createPanel();
  // Recover panelEl from DOM in case createPanel() returned early (element already existed)
  if (!panelEl) panelEl = document.getElementById("globalChatPanel");
  if (!panelEl) {
    console.error("[Chat] panelEl não encontrado! initChatFab correu?");
    return;
  }
  isOpen = true;
  panelEl.setAttribute("aria-hidden", "false");
  panelEl.classList.remove("scale-95", "opacity-0", "pointer-events-none");
  panelEl.classList.add("scale-100", "opacity-100", "pointer-events-auto");
  loadConversations();
}

export function closeChatPanel() {
  if (!panelEl) return;
  isOpen = false;
  if (!fabEl) fabEl = document.getElementById("globalChatFab");
  fabEl?.focus();
  panelEl.setAttribute("aria-hidden", "true");
  panelEl.classList.add("scale-95", "opacity-0", "pointer-events-none");
  panelEl.classList.remove("scale-100", "opacity-100", "pointer-events-auto");
}

export function toggleChatPanel() {
  if (isOpen) closeChatPanel();
  else openChatPanel();
}

export function setChatUnreadCount(count) {
  const badge = el("globalChatFabBadge");
  if (!badge) return;
  const n = Math.max(0, Number(count) || 0);
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.classList.toggle("hidden", n === 0);
}

export async function initChatFab() {
  createFab();
  createPanel();
  wireSocketEvents();
  await connectSocket().catch(() => { });
  await loadUnreadPaymentNotifications(fetchNotifications);
  await loadConversations();
}
