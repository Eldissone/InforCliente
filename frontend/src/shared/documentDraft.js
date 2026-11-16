import { apiRequest } from "../services/api.js";
import { toast } from "./ui.js";

/**
 * Rascunhos de documentos com IA (Fase 3.6).
 *  - openMeasurementText(): texto descritivo de um auto (guarda nas observações do auto);
 *  - openMonthlyReport(): relatório mensal ao cliente (copiar ou imprimir).
 * Os números vêm do sistema; a IA só redige. Tudo é editável antes de usar.
 */

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = `
    .dd-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px}
    .dd-modal{background:#fff;border-radius:18px;max-width:820px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(15,23,42,.3);overflow:hidden}
    .dd-head{display:flex;align-items:flex-start;gap:12px;padding:16px 20px;background:#212e3e;color:#fff}
    .dd-head h2{font-size:17px;font-weight:700;margin:0}
    .dd-head p{font-size:12px;color:#cbd5e1;margin:4px 0 0}
    .dd-close{margin-left:auto;background:none;border:0;color:#fff;cursor:pointer;padding:4px}
    .dd-body{padding:16px 20px;overflow:auto;font-size:14px;color:#0f172a;display:flex;flex-direction:column;gap:10px}
    .dd-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid #e2e8f0}
    .dd-text{width:100%;min-height:360px;border:1px solid #cbd5e1;border-radius:12px;padding:12px 14px;font-size:13.5px;line-height:1.55;resize:vertical;box-sizing:border-box;font-family:inherit}
    .dd-btn{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;border-radius:12px;padding:8px 14px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer}
    .dd-btn.primary{background:#212e3e;border-color:#212e3e;color:#fff}
    .dd-btn[disabled]{opacity:.5;cursor:default}
    .dd-hint{font-size:12px;color:#64748b;margin:0}
    .dd-note{font-size:12px;background:#fff7ed;color:#9a3412;border-radius:10px;padding:8px 10px;margin:0}
    .dd-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px}
    .dd-label{display:block;font-size:11px;font-weight:600;color:#64748b;margin-bottom:3px}
    .dd-input{border:1px solid #cbd5e1;border-radius:10px;padding:7px 9px;font-size:13px}
  `;
  document.head.appendChild(style);
}

function modal(title, subtitle) {
  injectStyles();
  const overlay = document.createElement("div");
  overlay.className = "dd-overlay";
  overlay.innerHTML = `<div class="dd-modal" role="dialog" aria-modal="true">
    <div class="dd-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>
    <button type="button" class="dd-close" aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <div class="dd-body"></div><div class="dd-foot"></div></div>`;
  const onKey = (e) => e.key === "Escape" && close();
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".dd-close")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return { overlay, body: overlay.querySelector(".dd-body"), foot: overlay.querySelector(".dd-foot"), close };
}

async function checkStatus(ui, projectId) {
  const status = await apiRequest(`/ai/documents/status?projectId=${encodeURIComponent(projectId)}`);
  if (!status.enabled) {
    ui.body.innerHTML = `<p class="dd-hint">${esc(status.reason)}</p>${
      status.canConfigure ? '<p><a class="dd-btn" href="/Users/index.html?section=ai">Abrir definições de IA</a></p>' : ""
    }`;
    return null;
  }
  return status;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Texto copiado.", { type: "success" });
  } catch {
    toast("Não foi possível copiar. Selecione o texto e copie à mão.", { type: "error" });
  }
}

function printText(title, text) {
  const w = window.open("", "_blank");
  if (!w) return toast("O navegador bloqueou a janela de impressão.", { type: "error" });
  const body = esc(text)
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n");
      const first = lines[0].trim();
      const isHeading = first.length > 2 && first.length < 80 && first === first.toUpperCase() && /[A-ZÀ-Ú]/.test(first);
      return isHeading ? `<h2>${first}</h2>${lines.slice(1).length ? `<p>${lines.slice(1).join("<br>")}</p>` : ""}` : `<p>${lines.join("<br>")}</p>`;
    })
    .join("");
  w.document.write(`<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:32px auto;padding:0 24px;color:#0f172a;font-size:13px;line-height:1.55}
    h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.04em;margin:22px 0 6px;color:#212e3e;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
    .meta{color:#64748b;font-size:12px;margin-bottom:18px}</style></head>
    <body><h1>${esc(title)}</h1><div class="meta">Emitido a ${new Date().toLocaleDateString("pt-PT")}</div>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

/** Texto descritivo de um auto de medição. `report` = { id, reportNumber, status, notes }. */
export async function openMeasurementText({ projectId, report, onSaved } = {}) {
  const ui = modal(`Texto do Auto Nº ${report.reportNumber}`, "Memória descritiva redigida pela IA a partir do mapa de quantidades do auto. Reveja antes de guardar.");
  ui.body.innerHTML = '<p class="dd-hint">A carregar…</p>';
  let status;
  try {
    status = await checkStatus(ui, projectId);
  } catch (error) {
    ui.body.innerHTML = `<p class="dd-hint">${esc(error.message)}</p>`;
    return;
  }
  if (!status) return;

  const generateText = async () => {
    ui.body.innerHTML = '<p class="dd-hint">A redigir o texto…</p>';
    ui.foot.innerHTML = "";
    try {
      const res = await apiRequest("/ai/documents/measurement-text", { method: "POST", body: { projectId, reportId: report.id } });
      ui.body.innerHTML = `
        ${res.withValues ? "" : '<p class="dd-note">Sem valores monetários: "Valores de orçamento e custos" não está autorizado para a IA (ou não tem acesso ao financeiro).</p>'}
        <textarea class="dd-text" id="ddText">${esc(res.text)}</textarea>
        <p class="dd-hint">Gerado por ${esc(res.model || "IA")}. Confirme os números com o mapa do auto antes de usar.</p>`;
      ui.foot.innerHTML = `<button type="button" class="dd-btn" data-dd="again">Gerar de novo</button>
        <button type="button" class="dd-btn" data-dd="copy">Copiar</button>
        <button type="button" class="dd-btn primary" data-dd="save"><span class="material-symbols-outlined" style="font-size:18px">save</span>Guardar nas observações do auto</button>`;
    } catch (error) {
      ui.body.innerHTML = `<p class="dd-hint">${esc(error.message || "Não foi possível gerar o texto.")}</p>`;
      ui.foot.innerHTML = '<button type="button" class="dd-btn" data-dd="again">Tentar de novo</button>';
    }
  };

  ui.overlay.addEventListener("click", async (e) => {
    const action = e.target.closest("[data-dd]")?.dataset.dd;
    if (!action) return;
    const text = ui.body.querySelector("#ddText")?.value || "";
    if (action === "again") return generateText();
    if (action === "copy") return copy(text);
    if (action === "save") {
      if (report.notes && !confirm("O auto já tem observações. Substituir pelo texto novo?")) return;
      try {
        await apiRequest(`/projects/${encodeURIComponent(projectId)}/measurement-reports/${encodeURIComponent(report.id)}`, { method: "PATCH", body: { notes: text } });
        report.notes = text;
        toast("Texto guardado nas observações do auto.", { type: "success" });
        onSaved?.(text);
        ui.close();
      } catch (error) {
        toast(error.message || "Não foi possível guardar.", { type: "error" });
      }
    }
  });
  generateText();
}

function defaultMonth() {
  const d = new Date();
  // Até dia 10 o relatório é normalmente do mês anterior.
  if (d.getDate() <= 10) d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Relatório mensal de progresso para o cliente. */
export async function openMonthlyReport({ projectId, projectLabel = "" } = {}) {
  const ui = modal("Relatório mensal ao cliente", "Rascunho redigido pela IA com o progresso, os autos e os registos do mês. Sem dados internos (necessidades, pagamentos, segurança).");
  ui.body.innerHTML = '<p class="dd-hint">A carregar…</p>';
  let status;
  try {
    status = await checkStatus(ui, projectId);
  } catch (error) {
    ui.body.innerHTML = `<p class="dd-hint">${esc(error.message)}</p>`;
    return;
  }
  if (!status) return;
  let month = defaultMonth();

  const renderPicker = (extra = "") => {
    ui.body.innerHTML = `<div class="dd-row"><div><label class="dd-label" for="ddMonth">Mês</label><input type="month" id="ddMonth" class="dd-input" value="${esc(month)}" /></div>
      <button type="button" class="dd-btn primary" data-dd="gen"><span class="material-symbols-outlined" style="font-size:18px">auto_awesome</span>Gerar relatório</button></div>
      ${status.withValues ? "" : '<p class="dd-note">Sem valores monetários: "Valores de orçamento e custos" não está autorizado para a IA (ou não tem acesso ao financeiro).</p>'}
      ${extra}`;
  };

  const generateReport = async () => {
    month = ui.body.querySelector("#ddMonth")?.value || month;
    renderPicker('<p class="dd-hint">A redigir o relatório…</p>');
    ui.foot.innerHTML = "";
    try {
      const res = await apiRequest("/ai/documents/monthly-report", { method: "POST", body: { projectId, month } });
      renderPicker(`${res.empty ? '<p class="dd-note">Não há registos de progresso nem autos neste mês: o relatório pode ficar pobre.</p>' : ""}
        <textarea class="dd-text" id="ddText">${esc(res.text)}</textarea>
        <p class="dd-hint">Gerado por ${esc(res.model || "IA")}. Reveja antes de enviar ao cliente.</p>`);
      ui.foot.innerHTML = `<button type="button" class="dd-btn" data-dd="copy">Copiar</button>
        <button type="button" class="dd-btn primary" data-dd="print"><span class="material-symbols-outlined" style="font-size:18px">print</span>Imprimir / PDF</button>`;
    } catch (error) {
      renderPicker(`<p class="dd-hint">${esc(error.message || "Não foi possível gerar o relatório.")}</p>`);
    }
  };

  ui.overlay.addEventListener("click", (e) => {
    const action = e.target.closest("[data-dd]")?.dataset.dd;
    if (!action) return;
    const text = ui.body.querySelector("#ddText")?.value || "";
    if (action === "gen") return generateReport();
    if (action === "copy") return copy(text);
    if (action === "print") {
      const [y, m] = month.split("-");
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
      return printText(`Relatório mensal · ${projectLabel} · ${label}`, text);
    }
  });
  renderPicker();
}
