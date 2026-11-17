/**
 * Alertas de notificações e mensagens: som, aviso do sistema operativo,
 * contador no título do separador e vibração no telemóvel.
 *
 * - Os sons são gerados com a Web Audio API (sem ficheiros de áudio).
 * - O browser só deixa tocar som depois da primeira interação do utilizador;
 *   o AudioContext é "desbloqueado" no primeiro clique/tecla.
 * - Com vários separadores abertos, só um toca o som e mostra o aviso
 *   (o separador visível tem prioridade), coordenado por BroadcastChannel.
 * - Preferências guardadas no servidor (GET/PUT /notifications/preferences),
 *   com cópia local para arrancar logo e funcionar sem rede.
 * - Silenciar (por tipo ou por obra) e "não incomodar" tiram o som e o aviso;
 *   a notificação continua no centro de notificações. URGENT ignora o
 *   "não incomodar", mas não um silenciar explícito.
 */

import { apiRequest } from "../services/api.js";

const PREFS_KEY = "inforcliente:notify-prefs";
const THROTTLE_MS = 2000;
const HIDDEN_TAB_DELAY_MS = 250;
const DEFAULT_PREFS = {
  soundEnabled: true,
  volume: 0.6,
  desktopEnabled: false,
  dndEnabled: false,
  dndFrom: "22:00",
  dndTo: "07:00",
  mutedTypes: [],
  mutedProjectIds: [],
};
const SERVER_KEYS = Object.keys(DEFAULT_PREFS);
const SAVE_DEBOUNCE_MS = 600;

let audioCtx = null;
let lastPlayedAt = 0;
let hiddenCount = 0;
let baseTitle = null;
const handledKeys = new Set();
const tabId = Math.random().toString(36).slice(2);
const listeners = new Set();
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("inforcliente-notify") : null;

channel?.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "handled" && data.key && data.tabId !== tabId) rememberKey(data.key);
  if (data.type === "prefs") listeners.forEach((fn) => safeCall(fn, getNotifyPrefs()));
});

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

function storeLocal(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* modo privado / armazenamento bloqueado: fica só nesta sessão */
  }
  listeners.forEach((fn) => safeCall(fn, prefs));
  channel?.postMessage({ type: "prefs" });
}

let pendingPatch = {};
let saveTimer = null;

function scheduleServerSave(patch) {
  Object.assign(pendingPatch, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const body = pendingPatch;
    pendingPatch = {};
    try {
      await apiRequest("/notifications/preferences", { method: "PUT", body });
    } catch (err) {
      console.warn("[notify] não foi possível guardar as preferências", err.message);
    }
  }, SAVE_DEBOUNCE_MS);
}

export function setNotifyPrefs(patch) {
  const next = { ...getNotifyPrefs(), ...patch };
  next.volume = Math.min(1, Math.max(0, Number(next.volume) || 0));
  storeLocal(next);
  const serverPatch = {};
  for (const key of SERVER_KEYS) if (key in patch) serverPatch[key] = next[key];
  if (Object.keys(serverPatch).length) scheduleServerSave(serverPatch);
  return next;
}

/** Lê as preferências do servidor (a fonte de verdade) e atualiza a cópia local. */
export async function syncNotifyPrefsFromServer() {
  try {
    const { preferences } = await apiRequest("/notifications/preferences");
    if (preferences) storeLocal({ ...getNotifyPrefs(), ...preferences });
  } catch (err) {
    console.warn("[notify] preferências do servidor indisponíveis", err.message);
  }
  return getNotifyPrefs();
}

export function isTypeMuted(type, prefs = getNotifyPrefs()) {
  return Boolean(type) && prefs.mutedTypes.includes(type);
}

export function isProjectMuted(projectId, prefs = getNotifyPrefs()) {
  return Boolean(projectId) && prefs.mutedProjectIds.includes(projectId);
}

export function toggleProjectMuted(projectId) {
  const prefs = getNotifyPrefs();
  const muted = new Set(prefs.mutedProjectIds);
  if (muted.has(projectId)) muted.delete(projectId);
  else muted.add(projectId);
  return setNotifyPrefs({ mutedProjectIds: [...muted] });
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/** true se agora estiver dentro do horário de "não incomodar" (aceita passar a meia-noite). */
export function isInDoNotDisturb(prefs = getNotifyPrefs(), now = new Date()) {
  if (!prefs.dndEnabled) return false;
  const from = minutesOf(prefs.dndFrom);
  const to = minutesOf(prefs.dndTo);
  if (from === null || to === null || from === to) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
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
  hideBlockedHint();
}

// ── Aviso "som bloqueado" ───────────────────────────────────────────────────
// O browser só deixa tocar som depois de um clique/tecla EM CADA PÁGINA
// carregada. Como a aplicação muda de página a cada menu, uma mensagem que
// chegue antes do primeiro clique fica sem som — mostramos um aviso discreto.

let blockedHintEl = null;

function showBlockedHint() {
  if (blockedHintEl || typeof document === "undefined" || !document.body) return;
  blockedHintEl = document.createElement("button");
  blockedHintEl.type = "button";
  blockedHintEl.id = "notifySoundBlockedHint";
  blockedHintEl.setAttribute("role", "status");
  blockedHintEl.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;">volume_off</span>
    <span>Chegou uma notificação, mas o browser bloqueou o som. Clique aqui para o ativar.</span>`;
  blockedHintEl.setAttribute(
    "style",
    "position:fixed;right:32px;bottom:96px;max-width:min(340px,calc(100vw - 32px));display:flex;align-items:center;gap:8px;padding:10px 14px;border:0;border-radius:14px;background:#0f172a;color:#fff;font-size:12px;font-weight:600;text-align:left;box-shadow:0 18px 40px rgba(15,23,42,.25);z-index:130;cursor:pointer;"
  );
  blockedHintEl.addEventListener("click", () => previewSound("message"));
  document.body.appendChild(blockedHintEl);
}

function hideBlockedHint() {
  blockedHintEl?.remove();
  blockedHintEl = null;
}

/** Sequências de tons por tipo: [frequência Hz, início s, duração s, forma]. */
const SOUNDS = {
  soft: [
    [1047, 0, 0.09, "sine"],
    [1319, 0.09, 0.12, "sine"],
  ],
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
  const peak = (kind === "urgent" ? 0.12 : kind === "soft" ? 0.18 : 0.25) * volume;
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
 * @param {string} [opts.type] - tipo da notificação (para silenciar por tipo)
 * @param {string} [opts.projectId] - obra (para silenciar por obra)
 */
export function alertUser({ key, sound = "notification", title, body, onClick, type, projectId } = {}) {
  if (key && handledKeys.has(key)) return;
  const current = getNotifyPrefs();
  if (isTypeMuted(type, current) || isProjectMuted(projectId, current)) {
    console.info("[notify] sem som: tipo ou obra silenciados", { type, projectId });
    return;
  }
  if (sound !== "urgent" && isInDoNotDisturb(current)) {
    console.info("[notify] sem som: horário de não incomodar");
    return;
  }

  const run = () => {
    if (key && handledKeys.has(key)) return;

    const prefs = getNotifyPrefs();
    const hidden = document.visibilityState !== "visible";
    const now = Date.now();
    let played = false;
    let blocked = false;

    if (!prefs.soundEnabled) {
      console.info("[notify] sem som: som desligado nas preferências");
    } else if (now - lastPlayedAt < THROTTLE_MS) {
      played = true; // outro som acabou de tocar (rajada): conta como tratado
    } else if (playTones(sound, prefs.volume)) {
      lastPlayedAt = now;
      played = true;
    } else {
      blocked = true;
      console.info("[notify] som bloqueado pelo browser: falta um clique nesta página");
    }

    // Só "fica com" o alerta (e avisa os outros separadores) se tocou ou se o
    // som está desligado. Se o browser bloqueou o som aqui, outro separador
    // da aplicação onde já se clicou ainda o pode tocar.
    if (key && !blocked) {
      rememberKey(key);
      channel?.postMessage({ type: "handled", key, tabId });
    }
    if (blocked && !hidden) showBlockedHint();

    if (hidden && sound !== "soft") {
      bumpTitleCounter();
      // `tag` = mesma chave: o sistema não repete o aviso se vários separadores o mostrarem.
      if (prefs.desktopEnabled && desktopPermission() === "granted") showDesktopNotification({ title, body, tag: key, onClick });
      if (sound === "urgent" || sound === "mention") navigator.vibrate?.([120, 60, 120]);
    }
    return played;
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
