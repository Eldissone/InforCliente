/**
 * Centro de notificações (sino) no cabeçalho.
 *
 * - Lista todas as notificações do utilizador (não só pagamentos), com filtros
 *   por tipo, por estado (não lidas) e por obra.
 * - Clicar numa notificação marca-a como lida e abre o destino (conversa,
 *   pagamento, pedido, ticket…).
 * - Permite silenciar uma obra e abrir as preferências de alertas completas.
 * - Atualiza em tempo real pelo evento `notification:new`.
 * Estilos inline para não depender das classes Tailwind compiladas.
 */

import { apiRequest } from "../services/api.js";
import { onSocketEvent } from "../services/socketClient.js";
import { escapeHtml } from "./ui.js";
import { renderAlertSettings } from "./notificationSettings.js";
import { isProjectMuted, onNotifyPrefsChange, toggleProjectMuted } from "./notificationSound.js";
import { decideApproval, fetchPendingApprovals, openApprovals } from "./approvals.js";

const TYPE_META = {
  NEW_MESSAGE: { icon: "chat", color: "#0d3fd1", label: "Mensagem" },
  MENTION: { icon: "alternate_email", color: "#7c3aed", label: "Menção" },
  PAYMENT: { icon: "payments", color: "#059669", label: "Pagamento" },
  REQUEST: { icon: "assignment", color: "#4f46e5", label: "Pedido" },
  APPROVAL: { icon: "task_alt", color: "#0891b2", label: "Aprovação" },
  SYSTEM: { icon: "help", color: "#0369a1", label: "Sistema" },
  DAILY_PLAN: { icon: "event_note", color: "#ca8a04", label: "Plano diário" },
  STOCK: { icon: "inventory_2", color: "#ea580c", label: "Stock" },
  DEADLINE: { icon: "schedule", color: "#dc2626", label: "Prazo" },
  AI_INSIGHT: { icon: "auto_awesome", color: "#9333ea", label: "IA" },
};

const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "unread", label: "Não lidas" },
  { key: "approvals", label: "Aprovações", types: ["APPROVAL"] },
  { key: "mentions", label: "Menções", types: ["MENTION"] },
  { key: "messages", label: "Mensagens", types: ["NEW_MESSAGE"] },
  { key: "payments", label: "Pagamentos", types: ["PAYMENT"] },
  { key: "works", label: "Obra", types: ["REQUEST", "APPROVAL", "DAILY_PLAN", "STOCK", "DEADLINE"] },
  { key: "ai", label: "IA", types: ["AI_INSIGHT"] },
];

const PRIORITY_COLORS = { HIGH: "#f59e0b", URGENT: "#dc2626" };

const state = {
  view: "list",
  filter: "all",
  projectId: "",
  items: [],
  projects: new Map(),
  unread: 0,
  loading: false,
  open: false,
  /** Aprovações pendentes do utilizador (null = ainda não carregadas). */
  approvals: null,
  /** Notificação com a aprovação à espera de confirmação: id. */
  confirming: "",
  deciding: "",
};

let bellEl = null;
let badgeEl = null;
let panelEl = null;
let initialised = false;

// ── Utilitários ─────────────────────────────────────────────────────────────

function relativeTime(dateStr) {
  const diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} d`;
  return new Date(dateStr).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
}

function setBadge(count) {
  state.unread = Math.max(0, Number(count) || 0);
  if (!badgeEl) return;
  badgeEl.textContent = state.unread > 99 ? "99+" : String(state.unread);
  badgeEl.style.display = state.unread ? "flex" : "none";
  bellEl?.setAttribute("aria-label", state.unread ? `Notificações (${state.unread} por ler)` : "Notificações");
}

let countTimer = null;
function refreshUnreadCount() {
  clearTimeout(countTimer);
  countTimer = setTimeout(async () => {
    try {
      const { unreadCount } = await apiRequest("/notifications/unread-count");
      setBadge(unreadCount);
    } catch {
      /* sem sessão / sem rede: mantém o valor */
    }
  }, 300);
}

// ── Montagem ────────────────────────────────────────────────────────────────

function createBell() {
  if (document.getElementById("notificationBell")) return;
  bellEl = document.createElement("button");
  bellEl.id = "notificationBell";
  bellEl.type = "button";
  bellEl.setAttribute("aria-haspopup", "dialog");
  bellEl.setAttribute("aria-expanded", "false");
  bellEl.setAttribute("aria-label", "Notificações");
  bellEl.title = "Notificações";
  bellEl.innerHTML = `
    <span class="material-symbols-outlined" style="font-size:22px;">notifications</span>
    <span data-bell-badge style="display:none;position:absolute;top:2px;right:2px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#ef4444;color:#fff;font-size:10px;font-weight:800;align-items:center;justify-content:center;line-height:1;">0</span>
  `;
  badgeEl = bellEl.querySelector("[data-bell-badge]");

  const profileBtn = document.querySelector("nav.app-top-nav [data-user-profile]");
  if (profileBtn) {
    bellEl.setAttribute(
      "style",
      "position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:10px;color:rgba(255,255,255,.75);background:transparent;border:0;cursor:pointer;"
    );
    bellEl.addEventListener("mouseenter", () => (bellEl.style.background = "rgba(255,255,255,.1)"));
    bellEl.addEventListener("mouseleave", () => (bellEl.style.background = "transparent"));
    profileBtn.parentElement.insertBefore(bellEl, profileBtn);
  } else {
    // Páginas sem cabeçalho partilhado: botão flutuante acima do chat.
    bellEl.setAttribute(
      "style",
      "position:fixed;right:32px;bottom:96px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:16px;background:#0f172a;color:#2afc8d;border:0;cursor:pointer;box-shadow:0 18px 40px rgba(15,23,42,.25);z-index:90;"
    );
    document.body.appendChild(bellEl);
  }

  bellEl.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.open) closeNotificationCenter();
    else openNotificationCenter();
  });
}

function createPanel() {
  if (panelEl) return;
  panelEl = document.createElement("section");
  panelEl.id = "notificationCenter";
  panelEl.setAttribute("role", "dialog");
  panelEl.setAttribute("aria-label", "Centro de notificações");
  panelEl.setAttribute(
    "style",
    "position:fixed;display:none;flex-direction:column;width:min(420px,calc(100vw - 32px));max-height:min(620px,calc(100vh - 96px));background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.25);z-index:120;overflow:hidden;font-size:13px;"
  );
  panelEl.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(panelEl);

  document.addEventListener("click", () => state.open && closeNotificationCenter());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.open) {
      closeNotificationCenter();
      bellEl?.focus();
    }
  });
  window.addEventListener("resize", () => state.open && positionPanel());
}

function positionPanel() {
  if (!panelEl || !bellEl) return;
  const rect = bellEl.getBoundingClientRect();
  const gutter = 16;
  const width = Math.min(420, window.innerWidth - gutter * 2);
  panelEl.style.width = `${width}px`;
  if (rect.top > window.innerHeight / 2) {
    // botão flutuante em baixo: abre para cima
    panelEl.style.top = "";
    panelEl.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  } else {
    panelEl.style.bottom = "";
    panelEl.style.top = `${rect.bottom + 8}px`;
  }
  const left = Math.min(Math.max(gutter, rect.right - width), window.innerWidth - width - gutter);
  panelEl.style.left = `${left}px`;
}

// ── Dados ───────────────────────────────────────────────────────────────────

async function loadItems() {
  state.loading = true;
  renderPanel();
  const filter = FILTERS.find((f) => f.key === state.filter) || FILTERS[0];
  const params = new URLSearchParams({ limit: "50" });
  if (filter.key === "unread") params.set("unreadOnly", "true");
  if (filter.types) params.set("types", filter.types.join(","));
  if (state.projectId) params.set("projectId", state.projectId);
  loadApprovals();
  try {
    const data = await apiRequest(`/notifications?${params}`);
    state.items = data.items || [];
    setBadge(data.unreadCount);
    state.items.forEach((n) => n.project && state.projects.set(n.project.id, n.project));
  } catch (err) {
    state.items = [];
    console.warn("[notificações] falha ao carregar", err.message);
  } finally {
    state.loading = false;
    renderPanel();
  }
}

async function loadApprovals({ force = false } = {}) {
  try {
    state.approvals = await fetchPendingApprovals({ force });
  } catch {
    state.approvals = null;
  }
  renderPanel();
}

/** Itens ainda pendentes referidos por uma notificação de aprovação. */
function pendingFor(n) {
  const ids = n.metadata?.approval?.ids;
  if (!Array.isArray(ids) || !state.approvals) return null;
  return state.approvals.items.filter((i) => ids.includes(i.id));
}

async function approveFromNotification(n) {
  const pending = pendingFor(n) || [];
  const item = pending[0];
  if (!item) return;
  state.deciding = n.id;
  renderPanel();
  const { toast } = await import("./ui.js");
  try {
    await decideApproval(item, "approve");
    toast(`${item.kindLabel || "Pedido"} aprovado.`, { type: "success" });
    await markRead(n);
    window.dispatchEvent(new CustomEvent("inforcliente:approvals-changed"));
  } catch (error) {
    toast(error?.data?.message || error.message || "Não foi possível aprovar.", { type: "error", timeoutMs: 6000 });
  }
  state.deciding = "";
  state.confirming = "";
  await loadApprovals({ force: true });
}

function approvalActionsHtml(n) {
  const pending = pendingFor(n);
  if (!pending) return "";
  const small = "border-radius:8px;font-size:11px;font-weight:800;padding:4px 10px;cursor:pointer;";
  if (!pending.length) {
    return `<span style="font-size:11px;font-weight:700;color:#64748b;background:#f1f5f9;border-radius:999px;padding:2px 8px;">Já decidida</span>`;
  }
  if (state.deciding === n.id) return `<span style="font-size:11px;color:#64748b;">A aprovar…</span>`;
  if (pending.length > 1) {
    return `<button type="button" data-nc-review="${escapeHtml(n.id)}" style="${small}border:0;background:#059669;color:#fff;">Rever e aprovar (${pending.length})</button>`;
  }
  const item = pending[0];
  if (item.blocker) {
    return `<span style="font-size:11px;font-weight:700;color:#92400e;background:#fef3c7;border-radius:999px;padding:2px 8px;">${escapeHtml(item.blocker)}</span>`;
  }
  if (state.confirming === n.id) {
    return `<button type="button" data-nc-approve-go="${escapeHtml(n.id)}" style="${small}border:0;background:#059669;color:#fff;">Confirmar aprovação</button>
      <button type="button" data-nc-approve-cancel style="${small}border:1px solid #e2e8f0;background:#fff;color:#475569;">Cancelar</button>`;
  }
  return `<button type="button" data-nc-approve="${escapeHtml(n.id)}" style="${small}border:0;background:#059669;color:#fff;">Aprovar</button>
    ${item.canReject ? `<button type="button" data-nc-review="${escapeHtml(n.id)}" style="${small}border:1px solid #fecaca;background:#fff;color:#b91c1c;">Rejeitar</button>` : ""}`;
}

async function markRead(item) {
  if (!item || item.read) return;
  item.read = true;
  setBadge(state.unread - 1);
  try {
    await apiRequest(`/notifications/${encodeURIComponent(item.id)}/read`, { method: "PATCH" });
  } catch {
    item.read = false;
    refreshUnreadCount();
  }
}

async function markAllRead() {
  state.items.forEach((n) => (n.read = true));
  setBadge(0);
  renderPanel();
  try {
    await apiRequest("/notifications/read-all", { method: "PATCH" });
  } catch {
    refreshUnreadCount();
  }
}

async function openItem(item) {
  await markRead(item);
  closeNotificationCenter();
  const conversationId = item.metadata?.conversationId;
  if ((item.type === "NEW_MESSAGE" || item.type === "MENTION") && conversationId) {
    const { openConversationById } = await import("./chatFab.js");
    openConversationById(conversationId);
    return;
  }
  const { openNotificationTarget } = await import("./paymentNotificationBar.js");
  openNotificationTarget(item);
}

// ── Desenho ─────────────────────────────────────────────────────────────────

const BTN = "border:0;background:transparent;cursor:pointer;color:#475569;border-radius:8px;";

function headerHtml() {
  const settings = state.view === "settings";
  return `
    <header style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px;background:#0f172a;color:#fff;">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;">
        ${
          settings
            ? `<button type="button" data-nc-back aria-label="Voltar" style="${BTN}color:#94a3b8;width:30px;height:30px;"><span class="material-symbols-outlined" style="font-size:20px;">arrow_back</span></button>`
            : `<span class="material-symbols-outlined" style="color:#2afc8d;">notifications</span>`
        }
        <strong style="font-size:14px;">${settings ? "Preferências de alertas" : "Notificações"}</strong>
      </div>
      <div style="display:flex;align-items:center;gap:4px;">
        ${
          settings
            ? ""
            : `${
                state.approvals?.total
                  ? `<button type="button" data-nc-approvals title="Aprovar vários de uma vez" style="${BTN}color:#0f172a;background:#2afc8d;font-size:11px;font-weight:800;padding:5px 9px;">Aprovações · ${state.approvals.total}</button>`
                  : ""
              }<button type="button" data-nc-readall style="${BTN}color:#cbd5e1;font-size:11px;font-weight:700;padding:6px 8px;" ${state.unread ? "" : "disabled"}>Marcar todas como lidas</button>
               <button type="button" data-nc-settings aria-label="Preferências de alertas" title="Preferências de alertas" style="${BTN}color:#94a3b8;width:30px;height:30px;"><span class="material-symbols-outlined" style="font-size:20px;">tune</span></button>`
        }
        <button type="button" data-nc-close aria-label="Fechar" style="${BTN}color:#94a3b8;width:30px;height:30px;"><span class="material-symbols-outlined" style="font-size:20px;">close</span></button>
      </div>
    </header>`;
}

function filtersHtml() {
  const chips = FILTERS.map((f) => {
    const active = f.key === state.filter;
    return `<button type="button" data-nc-filter="${f.key}" aria-pressed="${active}"
      style="flex:none;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${active ? "#0f172a" : "#e2e8f0"};background:${active ? "#0f172a" : "#fff"};color:${active ? "#2afc8d" : "#475569"};">${escapeHtml(f.label)}</button>`;
  }).join("");
  const projects = [...state.projects.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const select = projects.length
    ? `<select data-nc-project aria-label="Filtrar por obra" style="margin-top:8px;width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:12px;background:#fff;">
         <option value="">Todas as obras</option>
         ${projects
           .map(
             (p) =>
               `<option value="${escapeHtml(p.id)}" ${p.id === state.projectId ? "selected" : ""}>${escapeHtml(
                 [p.code, p.name].filter(Boolean).join(" · ")
               )}${isProjectMuted(p.id) ? " (silenciada)" : ""}</option>`
           )
           .join("")}
       </select>`
    : "";
  return `<div style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none;">${chips}</div>${select}
    </div>`;
}

function itemHtml(n) {
  const meta = TYPE_META[n.type] || TYPE_META.SYSTEM;
  const priorityColor = PRIORITY_COLORS[n.priority];
  const projectLabel = n.project ? [n.project.code, n.project.name].filter(Boolean).join(" · ") : "";
  const muted = n.projectId && isProjectMuted(n.projectId);
  return `
    <li data-nc-item="${escapeHtml(n.id)}" style="display:flex;gap:10px;padding:12px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer;background:${n.read ? "#fff" : "#f8fafc"};${priorityColor ? `box-shadow:inset 3px 0 0 ${priorityColor};` : ""}">
      <span class="material-symbols-outlined" aria-hidden="true" style="flex:none;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:19px;color:${meta.color};background:${meta.color}14;">${meta.icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:flex-start;gap:6px;">
          <p style="flex:1;margin:0;font-weight:${n.read ? 600 : 800};line-height:1.3;">${escapeHtml(n.title)}</p>
          ${n.read ? "" : `<span aria-label="Não lida" style="flex:none;width:8px;height:8px;margin-top:5px;border-radius:999px;background:#0d3fd1;"></span>`}
        </div>
        ${n.body ? `<p style="margin:3px 0 0;color:#475569;font-size:12px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(n.body)}</p>` : ""}
        ${n.metadata?.approval ? `<div data-nc-approval style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">${approvalActionsHtml(n)}</div>` : ""}
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:6px;font-size:11px;color:#64748b;">
          <span>${escapeHtml(meta.label)}</span><span>·</span><span>${relativeTime(n.createdAt)}</span>
          ${projectLabel ? `<span>·</span><span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(projectLabel)}</span>` : ""}
          <span style="flex:1;"></span>
          ${n.read ? "" : `<button type="button" data-nc-mark="${escapeHtml(n.id)}" style="${BTN}font-size:11px;font-weight:700;padding:2px 6px;">Marcar lida</button>`}
          ${
            n.projectId
              ? `<button type="button" data-nc-mute="${escapeHtml(n.projectId)}" title="${muted ? "Voltar a ter som desta obra" : "Silenciar esta obra"}" style="${BTN}font-size:11px;font-weight:700;padding:2px 6px;">${muted ? "Reativar obra" : "Silenciar obra"}</button>`
              : ""
          }
        </div>
      </div>
    </li>`;
}

function listHtml() {
  if (state.loading && !state.items.length) {
    return `<p style="padding:32px;text-align:center;color:#64748b;">A carregar…</p>`;
  }
  if (!state.items.length) {
    return `<div style="padding:36px 24px;text-align:center;color:#64748b;">
      <span class="material-symbols-outlined" style="font-size:36px;color:#cbd5e1;">notifications_off</span>
      <p style="margin:6px 0 0;">Sem notificações${state.filter !== "all" || state.projectId ? " neste filtro" : ""}.</p>
    </div>`;
  }
  return `<ul style="list-style:none;margin:0;padding:0;">${state.items.map(itemHtml).join("")}</ul>`;
}

function renderPanel() {
  if (!panelEl || !state.open) return;
  if (state.view === "settings") {
    panelEl.innerHTML = `${headerHtml()}<div data-nc-settings-body style="padding:12px 16px;overflow-y:auto;"></div>`;
    renderAlertSettings(panelEl.querySelector("[data-nc-settings-body]"));
  } else {
    panelEl.innerHTML = `${headerHtml()}${filtersHtml()}<div style="overflow-y:auto;flex:1;min-height:0;">${listHtml()}</div>`;
  }
  wirePanel();
}

function wirePanel() {
  const q = (sel) => panelEl.querySelector(sel);
  q("[data-nc-close]")?.addEventListener("click", closeNotificationCenter);
  q("[data-nc-settings]")?.addEventListener("click", () => {
    state.view = "settings";
    renderPanel();
  });
  q("[data-nc-back]")?.addEventListener("click", () => {
    state.view = "list";
    renderPanel();
  });
  q("[data-nc-readall]")?.addEventListener("click", markAllRead);
  q("[data-nc-project]")?.addEventListener("change", (e) => {
    state.projectId = e.target.value;
    loadItems();
  });
  panelEl.querySelectorAll("[data-nc-filter]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.ncFilter;
      loadItems();
    })
  );
  panelEl.querySelectorAll("[data-nc-mark]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await markRead(state.items.find((n) => n.id === btn.dataset.ncMark));
      renderPanel();
    })
  );
  panelEl.querySelectorAll("[data-nc-mute]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleProjectMuted(btn.dataset.ncMute);
      renderPanel();
    })
  );
  q("[data-nc-approvals]")?.addEventListener("click", () => {
    closeNotificationCenter();
    openApprovals();
  });
  const byId = (id) => state.items.find((n) => n.id === id);
  panelEl.querySelectorAll("[data-nc-approve]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.confirming = btn.dataset.ncApprove;
      renderPanel();
    })
  );
  panelEl.querySelectorAll("[data-nc-approve-cancel]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.confirming = "";
      renderPanel();
    })
  );
  panelEl.querySelectorAll("[data-nc-approve-go]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      approveFromNotification(byId(btn.dataset.ncApproveGo));
    })
  );
  panelEl.querySelectorAll("[data-nc-review]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const n = byId(btn.dataset.ncReview);
      await markRead(n);
      closeNotificationCenter();
      openApprovals({ ids: n?.metadata?.approval?.ids || [] });
    })
  );
  panelEl.querySelectorAll("[data-nc-approval]").forEach((box) => box.addEventListener("click", (e) => e.stopPropagation()));
  panelEl.querySelectorAll("[data-nc-item]").forEach((li) =>
    li.addEventListener("click", () => openItem(state.items.find((n) => n.id === li.dataset.ncItem)))
  );
}

// ── API pública ─────────────────────────────────────────────────────────────

export function openNotificationCenter({ view = "list" } = {}) {
  if (!panelEl) createPanel();
  state.open = true;
  state.view = view;
  panelEl.style.display = "flex";
  bellEl?.setAttribute("aria-expanded", "true");
  positionPanel();
  renderPanel();
  if (view === "list") loadItems();
}

export function closeNotificationCenter() {
  if (!panelEl) return;
  state.open = false;
  panelEl.style.display = "none";
  bellEl?.setAttribute("aria-expanded", "false");
}

export function initNotificationCenter() {
  if (initialised) return;
  initialised = true;
  createBell();
  createPanel();
  refreshUnreadCount();

  onSocketEvent("notification:new", () => {
    refreshUnreadCount();
    if (state.open && state.view === "list") loadItems();
  });
  window.addEventListener("inforcliente:notifications-changed", () => {
    refreshUnreadCount();
    if (state.open && state.view === "list") loadItems();
  });
  onNotifyPrefsChange(() => state.open && state.view === "list" && renderPanel());
  window.addEventListener("inforcliente:approvals-changed", () => state.open && state.view === "list" && loadApprovals({ force: true }));
}
