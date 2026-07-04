import { getToken, getSessionUser } from "./auth.js";
import { getApiBaseUrl } from "./api.js";

let socket = null;
let connectPromise = null;
const listeners = new Map();

function getSocketUrl() {
  const base = getApiBaseUrl().replace(/\/$/, "");
  return base;
}

async function loadSocketIo() {
  const { io } = await import("https://cdn.socket.io/4.8.1/socket.io.esm.min.js");
  return io;
}

export function onSocketEvent(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

function emitLocal(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      console.error("socket listener error", event, err);
    }
  });
}

function attachSocketHandlers(sock) {
  const events = [
    "message:new",
    "message:status",
    "typing:update",
    "presence:changed",
    "notification:new",
    "user:profile_updated",
  ];
  events.forEach((event) => {
    sock.on(event, (payload) => emitLocal(event, payload));
  });

  sock.on("connect", () => emitLocal("connect", {}));
  sock.on("disconnect", () => emitLocal("disconnect", {}));
}

export async function connectSocket() {
  const token = getToken();
  if (!token) return null;

  if (socket?.connected) return socket;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const io = await loadSocketIo();
    socket = io(getSocketUrl(), {
      path: "/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
    });

    attachSocketHandlers(socket);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("SOCKET_TIMEOUT")), 10000);
      socket.once("connect", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("connect_error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    startHeartbeat();
    return socket;
  })();

  try {
    return await connectPromise;
  } catch (err) {
    console.warn("Socket.IO: ligação indisponível", err.message);
    connectPromise = null;
    socket = null;
    return null;
  }
}

let heartbeatTimer = null;

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    socket?.emit("presence:heartbeat");
  }, 45_000);
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  clearInterval(heartbeatTimer);
  socket?.disconnect();
  socket = null;
  connectPromise = null;
}

// ── BFCache (Back-Forward Cache) handling ────────────────────────────────────
// When the browser caches a page for instant back/forward navigation it drops
// all WebSocket connections. We listen for the lifecycle events so we can
// cleanly tear down before the page is frozen and reconnect after it is
// restored, avoiding the "Page entered Back-Forward Cache" console warning
// and stale-socket state.
function handlePageHide(event) {
  // event.persisted === true means the page is being stored in BFCache
  if (event.persisted) {
    clearInterval(heartbeatTimer);
    // Disconnect without nulling out state so we can detect we need to reconnect
    socket?.disconnect();
  }
}

async function handlePageShow(event) {
  // event.persisted === true means the page was restored from BFCache
  if (event.persisted && getToken()) {
    // Reset stale references so connectSocket() creates a fresh connection
    connectPromise = null;
    socket = null;
    await connectSocket();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
}

export function joinConversation(conversationId) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false });
    socket.emit("conversation:join", { conversationId }, resolve);
  });
}

export function leaveConversation(conversationId) {
  socket?.emit("conversation:leave", { conversationId });
}

export function sendSocketMessage({ conversationId, body, mentionIds, attachments }) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, error: "OFFLINE" });
    const user = getSessionUser();
    const userName = user?.name || (user?.email ? user.email.split('@')[0] : "Utilizador");
    socket.emit("message:send", { conversationId, body, mentionIds, attachments, userName }, resolve);
  });
}

export function emitTypingStart(conversationId) {
  const user = getSessionUser();
  const userName = user?.name || (user?.email ? user.email.split('@')[0] : "Utilizador");
  socket?.emit("typing:start", { conversationId, userName });
}

export function emitTypingStop(conversationId) {
  socket?.emit("typing:stop", { conversationId });
}

export function markMessagesRead(conversationId, messageId) {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false });
    socket.emit("message:read", { conversationId, messageId }, resolve);
  });
}
