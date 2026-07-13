import { markNotificationRead } from "../services/chatApi.js";
import { apiRequest, getAssetUrl } from "../services/api.js";

const queue = [];
const seenIds = new Set();
let shellEl = null;
let cardEl = null;
let currentPayload = null;

function resolveStyle(payload) {
  const title = String(payload?.title || "").toLowerCase();
  if (payload?.metadata?.extraRequestId || title.includes("pedido extra")) {
    return { bar: "bg-indigo-600 text-white", icon: "request_quote", accent: "text-indigo-100" };
  }
  if (title.includes("atraso")) {
    return { bar: "bg-red-600 text-white", icon: "warning", accent: "text-red-100" };
  }
  if (title.includes("vencer")) {
    return { bar: "bg-amber-500 text-white", icon: "schedule", accent: "text-amber-100" };
  }
  if (title.includes("confirmado")) {
    return { bar: "bg-emerald-600 text-white", icon: "check_circle", accent: "text-emerald-100" };
  }
  return { bar: "bg-slate-900 text-white", icon: "payments", accent: "text-slate-300" };
}

function totalPending() {
  return queue.length + (currentPayload ? 1 : 0);
}

function getComprovativoUrl(payload) {
  const raw = payload?.metadata?.comprovativoUrl;
  return raw ? getAssetUrl(raw) : null;
}

function buildFinanceiroNotificationUrl(payload) {
  const extraId = payload?.metadata?.extraRequestId;
  if (extraId) {
    const params = new URLSearchParams({ extraRequestId: extraId });
    if (payload.metadata?.projectId) params.set("projectId", payload.metadata.projectId);
    return `/Financeiro/financeiro.html?${params}`;
  }
  const paymentId = payload?.metadata?.paymentId;
  if (!paymentId) return null;
  const params = new URLSearchParams({ paymentId });
  if (payload.metadata?.projectId) params.set("projectId", payload.metadata.projectId);
  if (payload.metadata?.event === "PAYMENT_CONFIRMED" && payload.metadata?.comprovativoUrl) {
    params.set("focus", "comprovativo");
  }
  return `/Financeiro/financeiro.html?${params}`;
}

function openNotificationTarget(payload) {
  if (payload?.type === "PAYMENT") {
    const financeiroUrl = buildFinanceiroNotificationUrl(payload);
    if (financeiroUrl) {
      window.location.href = financeiroUrl;
      return;
    }
  }

  const comprovativo = getComprovativoUrl(payload);
  if (comprovativo) {
    window.open(comprovativo, "_blank", "noopener,noreferrer");
    return;
  }
  const link = payload?.link;
  if (link) {
    window.location.href = link.startsWith("/") ? link : `/${link}`;
  }
}

function canOpenNotification(payload) {
  if (payload?.type === "PAYMENT" && (payload?.metadata?.paymentId || payload?.metadata?.extraRequestId)) {
    return true;
  }
  return Boolean(getComprovativoUrl(payload) || payload?.link);
}

function ensureShell() {
  if (shellEl) return shellEl;

  shellEl = document.createElement("div");
  shellEl.id = "payment-notification-bar";
  shellEl.className = "fixed top-4 left-1/2 z-[9999] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 pointer-events-none";
  shellEl.setAttribute("aria-live", "polite");
  shellEl.hidden = true;

  cardEl = document.createElement("div");
  cardEl.className =
    "pointer-events-auto rounded-2xl shadow-2xl shadow-black/20 overflow-hidden border border-white/10 opacity-0 scale-95 -translate-y-2 transition-all duration-300";
  shellEl.appendChild(cardEl);

  document.body.appendChild(shellEl);
  return shellEl;
}

function hideBar() {
  if (!cardEl) return;
  cardEl.classList.add("opacity-0", "scale-95", "-translate-y-2", "pointer-events-none");
  cardEl.classList.remove("opacity-100", "scale-100", "translate-y-0", "pointer-events-auto");
  window.setTimeout(() => {
    if (shellEl && totalPending() === 0) shellEl.hidden = true;
  }, 300);
}

function showBarVisible() {
  ensureShell();
  shellEl.hidden = false;
  requestAnimationFrame(() => {
    cardEl.classList.remove("opacity-0", "scale-95", "-translate-y-2", "pointer-events-none");
    cardEl.classList.add("opacity-100", "scale-100", "translate-y-0", "pointer-events-auto");
  });
}

function renderCurrent() {
  if (!currentPayload) {
    hideBar();
    return;
  }

  const style = resolveStyle(currentPayload);
  const title = currentPayload.title || "Notificação de pagamento";
  const subtitle = currentPayload.body || "";
  const comprovativoUrl = getComprovativoUrl(currentPayload);
  const pending = totalPending();
  const queueLabel = pending > 1 ? `1 de ${pending}` : "";
  const openable = canOpenNotification(currentPayload);

  ensureShell();
  cardEl.className = `pointer-events-auto rounded-2xl shadow-2xl shadow-black/20 overflow-hidden border border-white/10 opacity-100 scale-100 translate-y-0 transition-all duration-300 ${style.bar}`;
  cardEl.replaceChildren();

  const row = document.createElement("div");
  row.className = "flex items-start gap-3 px-4 py-3.5";
  if (openable) {
    row.classList.add("cursor-pointer");
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openNotificationTarget(currentPayload);
      closeCurrent(true);
    });
    row.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      openNotificationTarget(currentPayload);
      closeCurrent(true);
    });
  }

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined text-[22px] shrink-0 mt-0.5";
  icon.textContent = style.icon;

  const body = document.createElement("div");
  body.className = "flex-1 min-w-0";

  const titleEl = document.createElement("p");
  titleEl.className = "font-bold text-sm leading-snug truncate";
  titleEl.textContent = title;
  body.appendChild(titleEl);

  if (subtitle) {
    const subEl = document.createElement("p");
    subEl.className = `text-xs ${style.accent} mt-0.5 line-clamp-2 leading-relaxed`;
    subEl.textContent = subtitle;
    body.appendChild(subEl);
  }

  if (queueLabel) {
    const queueEl = document.createElement("p");
    queueEl.className = `text-[10px] font-bold uppercase tracking-widest ${style.accent} mt-1.5`;
    queueEl.textContent = queueLabel;
    body.appendChild(queueEl);
  }

  const actions = document.createElement("div");
  actions.className = "flex items-center gap-1 shrink-0";

  if (canOpenNotification(currentPayload)) {
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className =
      "h-8 px-3 rounded-lg text-[10px] font-black uppercase tracking-wide bg-white/15 hover:bg-white/25 transition-colors";
    openBtn.textContent =
      payload?.metadata?.extraRequestId || String(currentPayload?.title || "").toLowerCase().includes("pedido extra")
        ? "Liquidar"
        : String(currentPayload?.metadata?.event || "") === "PAYMENT_CONFIRMED"
          ? "Ver lançamento"
          : "Liquidar";
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openNotificationTarget(currentPayload);
      closeCurrent(true);
    });
    actions.appendChild(openBtn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Fechar notificação");
  closeBtn.className = "w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/15 transition-colors";
  closeBtn.innerHTML = `<span class="material-symbols-outlined text-[20px]">close</span>`;
  closeBtn.addEventListener("click", () => {
    closeCurrent(true);
  });
  actions.appendChild(closeBtn);

  row.append(icon, body, actions);
  cardEl.appendChild(row);

  if (pending > 2) {
    const footer = document.createElement("div");
    footer.className = "px-4 pb-2.5 pt-0 flex justify-end";
    const dismissAllBtn = document.createElement("button");
    dismissAllBtn.type = "button";
    dismissAllBtn.className =
      "text-[10px] font-bold uppercase tracking-wide underline underline-offset-2 opacity-80 hover:opacity-100";
    dismissAllBtn.textContent = `Ignorar todas (${pending})`;
    dismissAllBtn.addEventListener("click", () => {
      dismissAllRemaining();
    });
    footer.appendChild(dismissAllBtn);
    cardEl.appendChild(footer);
  }

  showBarVisible();
}

async function closeCurrent(markRead) {
  const payload = currentPayload;
  currentPayload = null;

  if (markRead && payload?.id) {
    seenIds.add(payload.id);
    await markNotificationRead(payload.id).catch(() => {});
  }

  if (queue.length) {
    currentPayload = queue.shift();
    renderCurrent();
    return;
  }

  hideBar();
}

async function dismissAllRemaining() {
  if (currentPayload?.id) seenIds.add(currentPayload.id);
  queue.forEach((p) => {
    if (p?.id) seenIds.add(p.id);
  });

  currentPayload = null;
  queue.length = 0;
  hideBar();

  await apiRequest("/notifications/read-all", { method: "PATCH" }).catch(() => {});
}

export function enqueuePaymentNotification(payload) {
  if (!payload?.id) return;
  if (seenIds.has(payload.id)) return;
  if (currentPayload?.id === payload.id) return;
  if (queue.some((p) => p.id === payload.id)) return;

  if (!currentPayload) {
    currentPayload = payload;
  } else {
    queue.push(payload);
  }
  renderCurrent();
}

export async function loadUnreadPaymentNotifications(fetchNotifications) {
  try {
    const data = await fetchNotifications({ unreadOnly: true });
    const items = (data.items || [])
      .filter((n) => n.type === "PAYMENT" && n.id && !seenIds.has(n.id))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    for (const item of items) {
      if (!currentPayload) {
        currentPayload = item;
      } else {
        queue.push(item);
      }
    }

    if (currentPayload) renderCurrent();
  } catch {
    /* offline */
  }
}
