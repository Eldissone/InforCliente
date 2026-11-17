/**
 * Painel lateral "Assistente da Obra".
 *
 * - Pergunta em linguagem natural; a resposta vem com as fontes (que dados
 *   foram lidos). O assistente só lê dados, com as permissões do utilizador.
 * - Histórico de conversas por obra (privado de cada utilizador).
 * - Sugestões rápidas conforme os dados autorizados na Gestão do Sistema.
 * Estilos inline/próprios (prefixo .aia-) para não depender do Tailwind compilado.
 */

import { apiRequest, getAssetUrl } from "../services/api.js";

let panelEl = null;
const state = {
  projectId: null,
  projectLabel: "",
  conversationId: null,
  messages: [],
  status: null,
  busy: false,
  view: "chat", // "chat" | "history"
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Markdown mínimo e seguro (escapa primeiro): **negrito**, listas e parágrafos. */
function renderMarkdown(text) {
  const lines = esc(text).split(/\r?\n/);
  let html = "";
  let inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${item[1]}</li>`;
      continue;
    }
    if (inList) {
      html += "</ul>";
      inList = false;
    }
    if (line.trim()) html += `<p>${line.replace(/^#{1,4}\s*/, "")}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

function injectStyles() {
  if (document.getElementById("aiAssistantStyles")) return;
  const style = document.createElement("style");
  style.id = "aiAssistantStyles";
  style.textContent = `
    #aiAssistantPanel{position:fixed;top:0;right:0;height:100vh;height:100dvh;width:min(440px,100vw);background:#fff;box-shadow:-18px 0 48px rgba(15,23,42,.18);z-index:140;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s ease;font-size:14px;color:#0f172a}
    #aiAssistantPanel[data-open="true"]{transform:none}
    .aia-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:#0f172a;color:#fff}
    .aia-head h2{margin:0;font-size:15px;font-weight:800}
    .aia-head p{margin:2px 0 0;font-size:11px;color:#94a3b8}
    .aia-ib{border:0;background:transparent;color:#94a3b8;width:34px;height:34px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .aia-ib:hover{background:rgba(255,255,255,.1);color:#fff}
    .aia-body{flex:1;min-height:0;overflow-y:auto;padding:16px;background:#f8fafc}
    .aia-msg{max-width:92%;margin-bottom:12px;padding:10px 13px;border-radius:14px;line-height:1.45}
    .aia-msg p{margin:0 0 6px}.aia-msg p:last-child{margin:0}
    .aia-msg ul{margin:4px 0 6px;padding-left:18px;list-style:disc}.aia-msg li{margin:2px 0}
    .aia-user{margin-left:auto;background:#0f172a;color:#fff;border-bottom-right-radius:4px}
    .aia-bot{background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px}
    .aia-src{margin-top:8px;padding-top:8px;border-top:1px dashed #e2e8f0;font-size:11px;color:#64748b}
    .aia-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;margin-top:8px}
    .aia-photo{display:block;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;background:#f8fafc;text-decoration:none;color:#334155}
    .aia-photo img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}
    .aia-photo span{display:block;padding:3px 6px;font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .aia-chip{display:inline-block;margin:3px 4px 0 0;padding:2px 8px;border-radius:999px;background:#f1f5f9;color:#334155;font-weight:700}
    .aia-sugg{display:flex;flex-direction:column;gap:8px;margin-top:8px}
    .aia-sugg button{text-align:left;border:1px solid #e2e8f0;background:#fff;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:600;color:#0f172a;cursor:pointer}
    .aia-sugg button:hover{border-color:#0f172a}
    .aia-foot{padding:12px;border-top:1px solid #f1f5f9;background:#fff}
    .aia-form{display:flex;gap:8px;align-items:flex-end}
    .aia-form textarea{flex:1;min-height:44px;max-height:140px;resize:none;border:1px solid #e2e8f0;border-radius:12px;padding:11px 12px;font:inherit;background:#f8fafc}
    .aia-send{width:44px;height:44px;border:0;border-radius:12px;background:#0f172a;color:#2afc8d;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .aia-send:disabled{background:#e2e8f0;color:#94a3b8;cursor:not-allowed}
    .aia-note{font-size:11px;color:#94a3b8;margin:6px 2px 0}
    .aia-empty{padding:28px 8px;text-align:center;color:#64748b}
    .aia-dots{display:inline-flex;gap:4px}.aia-dots span{width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:aiaDot 1s infinite ease-in-out}
    .aia-dots span:nth-child(2){animation-delay:.15s}.aia-dots span:nth-child(3){animation-delay:.3s}
    @keyframes aiaDot{0%,80%,100%{opacity:.3}40%{opacity:1}}
    .aia-hist{list-style:none;margin:0;padding:0}
    .aia-hist li{display:flex;align-items:center;gap:8px;padding:10px 4px;border-bottom:1px solid #e2e8f0}
    .aia-hist button.open{flex:1;text-align:left;border:0;background:transparent;font:inherit;font-weight:600;cursor:pointer;color:#0f172a}
  `;
  document.head.appendChild(style);
}

function ensurePanel() {
  if (panelEl) return panelEl;
  injectStyles();
  panelEl = document.createElement("aside");
  panelEl.id = "aiAssistantPanel";
  panelEl.setAttribute("role", "dialog");
  panelEl.setAttribute("aria-label", "Assistente da obra");
  panelEl.setAttribute("data-open", "false");
  panelEl.innerHTML = `
    <header class="aia-head">
      <span class="material-symbols-outlined" style="color:#2afc8d">auto_awesome</span>
      <div style="flex:1;min-width:0"><h2>Assistente da obra</h2><p data-aia-sub></p></div>
      <button type="button" class="aia-ib" data-aia-new title="Nova conversa" aria-label="Nova conversa"><span class="material-symbols-outlined">add_comment</span></button>
      <button type="button" class="aia-ib" data-aia-history title="Conversas anteriores" aria-label="Conversas anteriores"><span class="material-symbols-outlined">history</span></button>
      <button type="button" class="aia-ib" data-aia-close title="Fechar" aria-label="Fechar"><span class="material-symbols-outlined">close</span></button>
    </header>
    <div class="aia-body" data-aia-body aria-live="polite"></div>
    <footer class="aia-foot">
      <form class="aia-form" data-aia-form>
        <textarea data-aia-input rows="1" maxlength="2000" placeholder="Pergunte sobre a obra…" aria-label="Pergunta ao assistente"></textarea>
        <button type="submit" class="aia-send" data-aia-send aria-label="Enviar"><span class="material-symbols-outlined">send</span></button>
      </form>
      <p class="aia-note">Só lê dados, com as suas permissões. Confirme os números importantes no sistema.</p>
    </footer>`;
  document.body.appendChild(panelEl);

  panelEl.querySelector("[data-aia-close]").addEventListener("click", closeAssistant);
  panelEl.querySelector("[data-aia-new]").addEventListener("click", () => {
    state.conversationId = null;
    state.messages = [];
    state.view = "chat";
    render();
    focusInput();
  });
  panelEl.querySelector("[data-aia-history]").addEventListener("click", () => {
    state.view = state.view === "history" ? "chat" : "history";
    render();
  });
  const input = panelEl.querySelector("[data-aia-input]");
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(140, input.scrollHeight)}px`;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      panelEl.querySelector("[data-aia-form]").requestSubmit();
    }
  });
  panelEl.querySelector("[data-aia-form]").addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });
  panelEl.addEventListener("click", (e) => {
    const sugg = e.target.closest("[data-aia-sugg]");
    if (sugg) ask(sugg.dataset.aiaSugg);
    const open = e.target.closest("[data-aia-open]");
    if (open) loadConversation(open.dataset.aiaOpen);
    const del = e.target.closest("[data-aia-del]");
    if (del) deleteConversation(del.dataset.aiaDel);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panelEl.dataset.open === "true") closeAssistant();
  });
  return panelEl;
}

function focusInput() {
  setTimeout(() => panelEl?.querySelector("[data-aia-input]")?.focus(), 50);
}

function setBusy(busy) {
  state.busy = busy;
  const send = panelEl.querySelector("[data-aia-send]");
  const input = panelEl.querySelector("[data-aia-input]");
  const off = busy || !state.status?.enabled;
  send.disabled = off;
  input.disabled = !state.status?.enabled;
}

function messageHtml(m) {
  if (m.role === "user") return `<div class="aia-msg aia-user">${esc(m.content)}</div>`;
  if (m.role === "error") return `<div class="aia-msg aia-bot" style="border-color:#fecaca;color:#991b1b">${esc(m.content)}</div>`;
  const sources = Array.isArray(m.sources) ? m.sources : [];
  const src = sources.length
    ? `<div class="aia-src">Dados consultados: ${sources.map((s) => `<span class="aia-chip">${esc(s.label)}</span>`).join("")}</div>`
    : "";
  const photos = sources.flatMap((s) => (Array.isArray(s.photos) ? s.photos : []));
  const gallery = photos.length
    ? `<div class="aia-photos">${photos
        .map(
          (p, i) => `<a class="aia-photo" href="/Projectos/projectView?id=${encodeURIComponent(p.projectId)}&tab=galeria_obra" title="${esc(p.description || "Foto da obra")}">
            <img src="${esc(getAssetUrl(p.path))}" alt="${esc(p.description || "Foto da obra")}" loading="lazy" />
            <span>F${i + 1} · ${esc(p.date || "")}</span></a>`
        )
        .join("")}</div>`
    : "";
  return `<div class="aia-msg aia-bot">${renderMarkdown(m.content)}${gallery}${src}</div>`;
}

async function renderHistory(body) {
  body.innerHTML = '<p class="aia-empty">A carregar…</p>';
  try {
    const qs = state.projectId ? `?projectId=${encodeURIComponent(state.projectId)}` : "";
    const { items } = await apiRequest(`/ai/assistant/conversations${qs}`);
    body.innerHTML = items.length
      ? `<ul class="aia-hist">${items
          .map(
            (c) => `<li><button type="button" class="open" data-aia-open="${esc(c.id)}">${esc(c.title)}
              <div style="font-size:11px;color:#94a3b8;font-weight:500">${esc(new Date(c.updatedAt).toLocaleString("pt-PT"))}</div></button>
              <button type="button" class="aia-ib" style="color:#94a3b8" data-aia-del="${esc(c.id)}" aria-label="Apagar conversa" title="Apagar"><span class="material-symbols-outlined">delete</span></button></li>`
          )
          .join("")}</ul>`
      : '<p class="aia-empty">Ainda não há conversas.</p>';
  } catch (error) {
    body.innerHTML = `<p class="aia-empty">${esc(error.message)}</p>`;
  }
}

function render() {
  if (!panelEl) return;
  panelEl.querySelector("[data-aia-sub]").textContent = state.projectLabel || "Todas as obras a que tem acesso";
  const body = panelEl.querySelector("[data-aia-body]");
  setBusy(state.busy);

  if (state.view === "history") {
    renderHistory(body);
    return;
  }

  const st = state.status;
  if (!st) {
    body.innerHTML = '<p class="aia-empty">A carregar…</p>';
    return;
  }
  if (!st.enabled) {
    body.innerHTML = `<div class="aia-empty"><span class="material-symbols-outlined" style="font-size:36px;color:#cbd5e1">smart_toy</span><p>${esc(st.reason)}</p>${
      st.canConfigure
        ? `<a href="/Users/index.html?section=ai" style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:8px 14px;border-radius:10px;background:#7c3aed;color:#fff;font-weight:600;font-size:13px;text-decoration:none"><span class="material-symbols-outlined" style="font-size:18px">settings</span>Abrir definições de IA</a>`
        : ""
    }</div>`;
    return;
  }

  let html = "";
  if (!state.messages.length) {
    html += `<div class="aia-msg aia-bot"><p>Olá! Pergunte-me sobre ${state.projectLabel ? "esta obra" : "as suas obras"}: avanço, planos atrasados, materiais, necessidades${
      st.tools.some((t) => /Orçamento|Pagamentos/.test(t)) ? ", orçamento e pagamentos" : ""
    }.</p>${st.projectExcluded ? "<p><strong>Esta obra está excluída do envio à IA.</strong> Não consigo ler os dados dela.</p>" : ""}
      <div class="aia-src">Dados a que tenho acesso: ${
        st.tools.length ? st.tools.map((t) => `<span class="aia-chip">${esc(t)}</span>`).join("") : "nenhum"
      }</div>${
        st.tools.length
          ? ""
          : `<p style="margin-top:8px;color:#b45309"><strong>Nenhum tipo de dados está autorizado para a IA</strong>, por isso não consigo consultar a obra. Um administrador pode autorizar em Gestão → Inteligência Artificial → Dados enviados à IA (por exemplo "Progresso e planeamento").</p>`
      }</div>`;
    if (st.suggestions?.length) {
      html += `<div class="aia-sugg">${st.suggestions.map((s) => `<button type="button" data-aia-sugg="${esc(s)}">${esc(s)}</button>`).join("")}</div>`;
    }
  }
  html += state.messages.map(messageHtml).join("");
  if (state.busy) html += `<div class="aia-msg aia-bot"><span class="aia-dots"><span></span><span></span><span></span></span> a consultar os dados…</div>`;
  body.innerHTML = html;
  body.scrollTop = body.scrollHeight;
}

async function loadStatus() {
  try {
    const qs = state.projectId ? `?projectId=${encodeURIComponent(state.projectId)}` : "";
    state.status = await apiRequest(`/ai/assistant/status${qs}`);
  } catch (error) {
    state.status = { enabled: false, reason: error.message || "Assistente indisponível." };
  }
  render();
}

async function loadConversation(id) {
  try {
    const { conversation, messages } = await apiRequest(`/ai/assistant/conversations/${encodeURIComponent(id)}`);
    state.conversationId = conversation.id;
    state.messages = messages;
    state.view = "chat";
    render();
    focusInput();
  } catch (error) {
    state.messages.push({ role: "error", content: error.message });
    state.view = "chat";
    render();
  }
}

async function deleteConversation(id) {
  try {
    await apiRequest(`/ai/assistant/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (state.conversationId === id) {
      state.conversationId = null;
      state.messages = [];
    }
    render();
  } catch (error) {
    alert(error.message);
  }
}

async function ask(question) {
  const text = String(question || "").trim();
  if (!text || state.busy || !state.status?.enabled) return;
  const input = panelEl.querySelector("[data-aia-input]");
  input.value = "";
  input.style.height = "auto";
  state.view = "chat";
  state.messages.push({ role: "user", content: text });
  state.busy = true;
  render();
  try {
    const res = await apiRequest("/ai/assistant/ask", {
      method: "POST",
      body: {
        message: text,
        ...(state.conversationId ? { conversationId: state.conversationId } : {}),
        ...(!state.conversationId && state.projectId ? { projectId: state.projectId } : {}),
      },
    });
    state.conversationId = res.conversationId;
    state.messages.push(res.message);
  } catch (error) {
    state.messages.push({ role: "error", content: error.message || "Não foi possível obter resposta." });
  } finally {
    state.busy = false;
    render();
    focusInput();
  }
}

/**
 * Abre o painel. Mudar de obra começa uma conversa nova.
 * @param {{projectId?: string, projectLabel?: string}} [opts]
 */
export function openAssistant({ projectId = null, projectLabel = "", question = "" } = {}) {
  ensurePanel();
  if (projectId !== state.projectId) {
    state.conversationId = null;
    state.messages = [];
    state.status = null;
  }
  state.projectId = projectId;
  state.projectLabel = projectLabel;
  state.view = "chat";
  panelEl.dataset.open = "true";
  render();
  // Reavalia sempre que estava desligado (o administrador pode tê-lo ligado entretanto).
  if (!state.status?.enabled) {
    state.status = null;
    const loading = loadStatus();
    if (question) loading.then(() => askOrPrefill(question));
  } else if (question) askOrPrefill(question);
  focusInput();
}

/** Pergunta vinda da paleta de comandos: envia se o assistente estiver ligado, senão deixa escrita. */
function askOrPrefill(question) {
  if (state.status?.enabled) return ask(question);
  const input = panelEl?.querySelector("[data-aia-input]");
  if (input) input.value = question;
}

export function closeAssistant() {
  if (panelEl) panelEl.dataset.open = "false";
}
