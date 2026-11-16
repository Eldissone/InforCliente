import { apiRequest } from "../services/api.js";
import { toast } from "./ui.js";

/**
 * Registo de execução por texto ou voz (Fase 3.3).
 * O técnico escreve ou grava "Hoje betonámos 12 m³ da laje do piso 2"; a IA
 * propõe as quantidades por tarefa; o técnico revê, corrige e confirma.
 * Nada é gravado sem o botão "Confirmar registo".
 */

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const fmt = (v) => Number(v ?? 0).toLocaleString("pt-PT", { maximumFractionDigits: 3 });
const MAX_RECORD_MS = 3 * 60 * 1000;

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = `
    .pc-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px}
    .pc-modal{background:#fff;border-radius:18px;max-width:720px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(15,23,42,.3);overflow:hidden}
    .pc-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px;background:#212e3e;color:#fff}
    .pc-head h2{font-size:17px;font-weight:700;margin:0}
    .pc-head p{font-size:12px;color:#cbd5e1;margin:4px 0 0}
    .pc-close{margin-left:auto;background:none;border:0;color:#fff;cursor:pointer;padding:4px}
    .pc-body{padding:16px 20px;overflow:auto;font-size:14px;color:#0f172a}
    .pc-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid #e2e8f0}
    .pc-text{width:100%;min-height:90px;border:1px solid #cbd5e1;border-radius:12px;padding:10px 12px;font-size:14px;resize:vertical;box-sizing:border-box}
    .pc-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
    .pc-btn{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;border-radius:12px;padding:8px 14px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer}
    .pc-btn.primary{background:#212e3e;border-color:#212e3e;color:#fff}
    .pc-btn.rec{background:#dc2626;border-color:#dc2626;color:#fff}
    .pc-btn[disabled]{opacity:.5;cursor:default}
    .pc-hint{font-size:12px;color:#64748b;margin:6px 0 0}
    .pc-note{font-size:13px;color:#334155;background:#f8fafc;border-radius:10px;padding:8px 10px;margin:10px 0}
    .pc-entry{border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin:10px 0}
    .pc-entry.off{opacity:.5}
    .pc-entry h3{font-size:14px;font-weight:700;margin:0}
    .pc-entry .pc-path{font-size:12px;color:#64748b}
    .pc-grid{display:grid;grid-template-columns:140px 1fr;gap:8px;margin-top:8px;align-items:end}
    @media (max-width:560px){.pc-grid{grid-template-columns:1fr}}
    .pc-label{display:block;font-size:11px;font-weight:600;color:#64748b;margin-bottom:3px}
    .pc-input,.pc-select{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:7px 9px;font-size:13px;box-sizing:border-box;background:#fff}
    .pc-warn{margin:8px 0 0;padding:0 0 0 18px;font-size:12px;color:#b45309}
    .pc-evidence{font-size:12px;color:#475569;font-style:italic;margin-top:6px}
    .pc-empty{color:#64748b;font-size:13px}
    .pc-rejected{font-size:12px;color:#b91c1c;margin:6px 0 0;padding-left:18px}
  `;
  document.head.appendChild(style);
}

function close(state) {
  stopRecording(state, { discard: true });
  state.overlay.remove();
  document.removeEventListener("keydown", state.onKey);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function startRecording(state) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    toast("Este navegador não permite gravar áudio. Escreva o texto.", { type: "error" });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(state.recTimer);
      if (state.discard) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      renderInput(state);
      await interpret(state, { audio: { mimeType: blob.type || "audio/webm", base64: await blobToBase64(blob) } });
    };
    state.recorder = recorder;
    state.discard = false;
    recorder.start();
    state.recTimer = setTimeout(() => stopRecording(state), MAX_RECORD_MS);
    renderInput(state, { recording: true });
  } catch {
    toast("Não foi possível usar o microfone. Verifique a autorização do navegador.", { type: "error" });
  }
}

function stopRecording(state, { discard = false } = {}) {
  if (!state.recorder || state.recorder.state === "inactive") return;
  state.discard = discard;
  state.recorder.stop();
}

function renderInput(state, { recording = false } = {}) {
  const { status } = state;
  state.body.innerHTML = `
    <label class="pc-label" for="pcText">O que foi feito?</label>
    <textarea id="pcText" class="pc-text" maxlength="2000" placeholder="Ex.: Hoje betonámos 12 m³ da laje do piso 2 e cofrámos 30 m² de pilares." ${recording ? "disabled" : ""}>${esc(state.text || "")}</textarea>
    <div class="pc-row">
      <button type="button" class="pc-btn primary" data-pc-interpret ${recording ? "disabled" : ""}><span class="material-symbols-outlined" style="font-size:18px">auto_awesome</span>Interpretar</button>
      ${
        status.audio
          ? recording
            ? '<button type="button" class="pc-btn rec" data-pc-stop><span class="material-symbols-outlined" style="font-size:18px">stop_circle</span>Parar e interpretar</button><span class="pc-hint">A gravar… (máx. 3 min)</span>'
            : '<button type="button" class="pc-btn" data-pc-record><span class="material-symbols-outlined" style="font-size:18px">mic</span>Gravar áudio</button>'
          : ""
      }
    </div>
    <p class="pc-hint">A IA associa o texto às tarefas da obra e propõe as quantidades. Revê e confirma antes de gravar; nada é gravado sozinho.</p>`;
  state.foot.innerHTML = "";
}

function targetOptions(entry, allowDirect) {
  const opts = entry.planOptions.map(
    (p) =>
      `<option value="${esc(p.id)}" ${p.id === entry.dailyPlanTaskId ? "selected" : ""}>Plano diário: ${esc(p.label)} (planeado ${fmt(p.plannedQty)}, já reportado ${fmt(p.reportedQty)})</option>`
  );
  if (allowDirect) opts.push(`<option value="" ${!entry.dailyPlanTaskId ? "selected" : ""}>Direto no progresso da tarefa</option>`);
  return opts.join("");
}

function renderProposal(state) {
  const r = state.result;
  const entries = r.entries;
  const header = `
    ${r.transcript ? `<div class="pc-note"><b>${state.source === "voice" ? "Transcrição" : "Texto"}:</b> ${esc(r.transcript)}</div>` : ""}
    ${r.unmatched ? `<div class="pc-note" style="background:#fff7ed;color:#9a3412"><b>Não associado:</b> ${esc(r.unmatched)}</div>` : ""}
    ${r.rejected?.length ? `<ul class="pc-rejected">${r.rejected.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
  if (!entries.length) {
    state.body.innerHTML = `${header}<p class="pc-empty">A IA não encontrou quantidades para registar. Indique a quantidade e o trabalho (ex.: "12 m³ de betonagem da laje").</p>`;
    state.foot.innerHTML = '<button type="button" class="pc-btn" data-pc-back>Voltar</button>';
    return;
  }
  state.body.innerHTML =
    header +
    entries
      .map((e, i) => {
        const noTarget = !e.planOptions.length && !r.allowDirect;
        return `<div class="pc-entry" data-pc-entry="${i}">
          <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer">
            <input type="checkbox" data-pc-on ${noTarget ? "disabled" : "checked"} style="margin-top:3px" />
            <span><h3>${esc(e.task.wbsCode ? `${e.task.wbsCode} · ` : "")}${esc(e.task.description)}</h3>
            <span class="pc-path">${esc(e.task.path || "")}${e.task.path ? " · " : ""}executado ${fmt(e.task.executedQty)} de ${fmt(e.task.expectedQty)} ${esc(e.task.unit)}</span></span>
          </label>
          <div class="pc-grid">
            <div><span class="pc-label">Quantidade (${esc(e.task.unit)})</span><input type="number" min="0" step="any" class="pc-input" data-pc-qty value="${esc(e.quantity)}" /></div>
            <div><span class="pc-label">Onde registar</span>${
              noTarget
                ? '<p class="pc-hint" style="margin:0">Sem plano diário aberto para esta tarefa e sem permissão para registo direto.</p>'
                : `<select class="pc-select" data-pc-target>${targetOptions(e, r.allowDirect)}</select>`
            }</div>
          </div>
          ${e.evidence ? `<div class="pc-evidence">"${esc(e.evidence)}"</div>` : ""}
          ${e.warnings.length ? `<ul class="pc-warn">${e.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
          <p class="pc-hint">${e.planOptions.length ? "No plano diário, a quantidade conta no progresso quando o plano for aprovado." : "Registo direto: atualiza já o progresso e o histórico da tarefa."}</p>
        </div>`;
      })
      .join("");
  state.foot.innerHTML = `<button type="button" class="pc-btn" data-pc-back>Voltar</button>
    <button type="button" class="pc-btn primary" data-pc-confirm><span class="material-symbols-outlined" style="font-size:18px">check</span>Confirmar registo</button>`;
}

async function interpret(state, payload) {
  state.source = payload.audio ? "voice" : "text";
  state.body.innerHTML = `<p class="pc-empty">${payload.audio ? "A transcrever e a interpretar o áudio…" : "A interpretar…"}</p>`;
  state.foot.innerHTML = "";
  try {
    state.result = await apiRequest("/ai/progress/interpret", { method: "POST", body: { projectId: state.projectId, ...payload } });
    renderProposal(state);
  } catch (error) {
    renderInput(state);
    toast(error.message || "Não foi possível interpretar.", { type: "error" });
  }
}

async function confirmEntries(state, button) {
  const entries = [];
  for (const node of state.body.querySelectorAll("[data-pc-entry]")) {
    const e = state.result.entries[Number(node.dataset.pcEntry)];
    if (!node.querySelector("[data-pc-on]")?.checked) continue;
    const quantity = Number(node.querySelector("[data-pc-qty]").value);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast(`Quantidade inválida em "${e.task.description}".`, { type: "error" });
      return;
    }
    const target = node.querySelector("[data-pc-target]");
    entries.push({ taskId: e.taskId, dailyPlanTaskId: target?.value || null, quantity, ...(e.evidence ? { note: e.evidence.slice(0, 300) } : {}) });
  }
  if (!entries.length) {
    toast("Escolha pelo menos uma linha para registar.", { type: "error" });
    return;
  }
  button.disabled = true;
  try {
    const res = await apiRequest("/ai/progress/confirm", {
      method: "POST",
      body: { projectId: state.projectId, source: state.source, transcript: state.result.transcript || undefined, entries },
    });
    const plan = res.saved.filter((s) => s.mode === "PLAN").length;
    const direct = res.saved.length - plan;
    toast(
      [direct ? `${direct} registo(s) no progresso` : "", plan ? `${plan} quantidade(s) reportada(s) nos planos diários` : ""].filter(Boolean).join(" e ") + ".",
      { type: "success" }
    );
    state.onSaved?.(res);
    close(state);
  } catch (error) {
    button.disabled = false;
    toast(error.message || "Não foi possível gravar.", { type: "error" });
  }
}

/** Abre o registo de execução da obra. */
export async function openProgressCapture({ projectId, onSaved } = {}) {
  injectStyles();
  const overlay = document.createElement("div");
  overlay.className = "pc-overlay";
  overlay.innerHTML = `<div class="pc-modal" role="dialog" aria-modal="true" aria-labelledby="pcTitle">
    <div class="pc-head"><div><h2 id="pcTitle">Registar execução</h2><p>Escreva ou grave o trabalho feito. A IA propõe; o técnico confirma.</p></div>
    <button type="button" class="pc-close" aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <div class="pc-body"><p class="pc-empty">A carregar…</p></div><div class="pc-foot"></div></div>`;
  const state = { overlay, projectId, onSaved, body: overlay.querySelector(".pc-body"), foot: overlay.querySelector(".pc-foot") };
  state.onKey = (e) => e.key === "Escape" && close(state);
  document.addEventListener("keydown", state.onKey);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".pc-close")) return close(state);
    if (e.target.closest("[data-pc-record]")) return startRecording(state);
    if (e.target.closest("[data-pc-stop]")) return stopRecording(state);
    if (e.target.closest("[data-pc-back]")) return renderInput(state);
    const confirmBtn = e.target.closest("[data-pc-confirm]");
    if (confirmBtn) return confirmEntries(state, confirmBtn);
    if (e.target.closest("[data-pc-interpret]")) {
      const text = state.body.querySelector("#pcText").value.trim();
      state.text = text;
      if (text.length < 3) return toast("Escreva o trabalho feito (ex.: quantidade e tarefa).", { type: "error" });
      return interpret(state, { text });
    }
  });
  overlay.addEventListener("change", (e) => {
    if (e.target.matches("[data-pc-on]")) e.target.closest("[data-pc-entry]").classList.toggle("off", !e.target.checked);
  });

  try {
    state.status = await apiRequest(`/ai/progress/status?projectId=${encodeURIComponent(projectId)}`);
  } catch (error) {
    state.body.innerHTML = `<p class="pc-empty">${esc(error.message || "Não foi possível abrir.")}</p>`;
    return;
  }
  if (!state.status.enabled) {
    state.body.innerHTML = `<p class="pc-empty">${esc(state.status.reason)}</p>${
      state.status.canConfigure ? '<p style="margin-top:10px"><a class="pc-btn" href="/Users/index.html?section=ai">Abrir definições de IA</a></p>' : ""
    }`;
    return;
  }
  renderInput(state);
}
