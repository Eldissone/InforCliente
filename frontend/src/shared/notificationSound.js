/**
 * Alertas de notificações e mensagens: som, aviso do sistema operativo,
 * contador no título do separador e vibração no telemóvel.
 *
 * - Os sons são gerados com a Web Audio API (sem ficheiros de áudio).
 * - O browser só deixa tocar som depois da primeira interação do utilizador;
 *   o AudioContext é "desbloqueado" no primeiro clique/tecla.
 * - Com vários separadores abertos, só um toca o som e mostra o aviso
 *   (o separador visível tem prioridade), coordenado por BroadcastChannel.
 * - Preferências guardadas localmente por browser (a Fase 1.2 do plano
 *   passa-as para o perfil do utilizador no servidor).
 */

const PREFS_KEY = "inforcliente:notify-prefs";
const THROTTLE_MS = 2000;
const HIDDEN_TAB_DELAY_MS = 250;
const DEFAULT_PREFS = { soundEnabled: true, volume: 0.6, desktopEnabled: false };

let audioCtx = null;
let lastPlayedAt = 0;
let hiddenCount = 0;
let baseTitle = null;
const handledKeys = new Set();
const tabId = Math.random().toString(36).slice(2);
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("inforcliente-notify") : null;

channel?.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "handled" && data.key && data.tabId !== tabId) rememberKey(data.key);
  if (data.type === "prefs") listeners.forEach((fn) => safeCall(fn, getNotifyPrefs()));
});

const listeners = new Set();

function safeCall(fn, arg) {
  try {
    fn(arg);
  } catch (err) {
    console.error("[notify] listener", err);
  }
}

function rememberKey(key) {
  handledKeys.add(key);
  if (handledKeys.size > 200) handledKeys.delete(handledKeys.values().next().value);
}

// ── Preferências ────────────────────────────────────────────────────────────

export function getNotifyPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return { ...DEFAULT_PREFS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setNotifyPrefs(patch) {
  const next = { ...getNotifyPrefs(), ...patch };
  next.volume = Math.min(1, Math.max(0, Number(next.volume) || 0));
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* modo privado / armazenamento bloqueado: fica só nesta sessão */
  }
  listeners.forEach((fn) => safeCall(fn, next));
  channel?.postMessage({ type: "prefs" });
  return next;
}

export function onNotifyPrefsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Áudio ───────────────────────────────────────────────────────────────────

function getAudioContext() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

/** Sequências de tons por tipo: [frequência Hz, início s, duração s, forma]. */
const SOUNDS = {
  soft: [[1200, 0, 0.08, "sine"]],
  message: [
    [880, 0, 0.11, "sine"],
    [1320, 0.11, 0.16, "sine"],
  ],
  mention: [
    [880, 0, 0.1, "sine"],
    [1175, 0.1, 0.1, "sine"],
    [1568, 0.2, 0.2, "sine"],
  ],
  notification: [
    [660, 0, 0.18, "triangle"],
    [990, 0.16, 0.32, "triangle"],
  ],
  urgent: [
    [988, 0, 0.12, "square"],
    [784, 0.14, 0.12, "square"],
    [988, 0.32, 0.12, "square"],
    [784, 0.46, 0.12, "square"],
  ],
};

function playTones(kind, volume) {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return false;
  const tones = SOUNDS[kind] || SOUNDS.notification;
  const peak = (kind === "urgent" ? 0.12 : kind === "soft" ? 0.15 : 0.25) * volume;
  const now = ctx.currentTime + 0.01;

  for (const [freq, start, dur, type] of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
  }
  return true;
}

/** Toca um som já (ignora throttle). Usado pelo botão "Testar som". */
export function previewSound(kind = "message") {
  unlockAudio();
  const { volume } = getNotifyPrefs();
  // resume() é assíncrono: dá um instante ao contexto para arrancar
  setTimeout(() => playTones(kind, volume || 0.6), 30);
}

// ── Aviso do sistema operativo ──────────────────────────────────────────────

export function desktopPermission() {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Tem de ser chamado a partir de um clique do utilizador. */
export async function requestDesktopPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  let result = Notification.permission;
  if (result === "default") {
    try {
      result = await Notification.requestPermission();
    } catch {
      result = Notification.permission;
    }
  }
  setNotifyPrefs({ desktopEnabled: result === "granted" });
  return result;
}

function showDesktopNotification({ title, body, tag, onClick }) {
  if (desktopPermission() !== "granted") return;
  try {
    const n = new Notification(title || "InforCliente", {
      body: body || "",
      tag: tag || undefined,
      icon: "/assets/icon/MBT.png",
    });
    n.onclick = () => {
      window.focus();
      n.close();
      if (typeof onClick === "function") onClick();
    };
  } catch (err) {
    console.warn("[notify] aviso do sistema indisponível", err.message);
  }
}

// ── Contador no título do separador ─────────────────────────────────────────

function bumpTitleCounter() {
  if (baseTitle === null) baseTitle = document.title.replace(/^\(\d+\+?\)\s*/, "");
  hiddenCount += 1;
  document.title = `(${hiddenCount > 99 ? "99+" : hiddenCount}) ${baseTitle}`;
}

function resetTitleCounter() {
  if (baseTitle === null) return;
  document.title = baseTitle;
  baseTitle = null;
  hiddenCount = 0;
}

// ── API principal ───────────────────────────────────────────────────────────

/**
 * Alerta o utilizador de uma notificação ou mensagem.
 *
 * @param {object} opts
 * @param {string} opts.key - identificador único (id da notificação/mensagem), para não alertar 2x
 * @param {"soft"|"message"|"mention"|"notification"|"urgent"} opts.sound
 * @param {string} [opts.title] - título do aviso do sistema
 * @param {string} [opts.body]
 * @param {Function} [opts.onClick] - ação ao clicar no aviso do sistema
 */
export function alertUser({ key, sound = "notification", title, body, onClick } = {}) {
  if (key && handledKeys.has(key)) return;

  const run = () => {
    if (key && handledKeys.has(key)) return;
    if (key) {
      rememberKey(key);
      channel?.postMessage({ type: "handled", key, tabId });
    }

    const prefs = getNotifyPrefs();
    const hidden = document.visibilityState !== "visible";
    const now = Date.now();

    if (prefs.soundEnabled && now - lastPlayedAt >= THROTTLE_MS) {
      if (playTones(sound, prefs.volume)) lastPlayedAt = now;
    }

    if (hidden && sound !== "soft") {
      bumpTitleCounter();
      if (prefs.desktopEnabled) showDesktopNotification({ title, body, tag: key, onClick });
      if (sound === "urgent" || sound === "mention") navigator.vibrate?.([120, 60, 120]);
    }
  };

  // O separador visível alerta logo; os escondidos esperam para ver se
  // algum separador visível já tratou o alerta.
  if (document.visibilityState === "visible") run();
  else setTimeout(run, HIDDEN_TAB_DELAY_MS + Math.random() * 150);
}

let initialised = false;

/** Liga o desbloqueio de áudio e a limpeza do título. Idempotente. */
export function initNotificationSound() {
  if (initialised || typeof window === "undefined") return;
  initialised = true;
  const unlock = () => unlockAudio();
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resetTitleCounter();
  });
}
