/**
 * Fatura emitida ao cliente — formulário do Centro de Recebimentos (R1),
 * também usado na Conciliação Bancária («Registar à mão» / «Importar a fatura»).
 */
import {
  apiRequest,
  apiUpload,
  toast,
  esc,
  num,
  round2,
  money,
  parseMoney,
  todayKey,
  addDays,
  daysBetween,
  fmtDate,
  norm,
  icon,
  openDrawer,
  ask,
  bindCombo,
  bindMoney,
  fileZoneHtml,
  bindFileZones,
  errorBox,
  setBusy,
  errMsg,
  fileUrl,
  pickFiles,
} from "./fin.js";

export const INVOICE_TYPES = [
  { code: "AUTO", short: "AM", label: "Auto de Medição" },
  { code: "FINAL", short: "FU", label: "Fatura Única / Final da Obra (sem autos)" },
  { code: "MARCO", short: "MC", label: "Marco de Pagamento (sem autos)" },
  { code: "ADI", short: "ADI", label: "Adiantamento" },
  { code: "RET", short: "RET", label: "Retenção / Seguro-Garantia" },
  { code: "DRET", short: "DRET", label: "Devolução de Retenção" },
  { code: "REV", short: "REV", label: "Revisão de Preços" },
  { code: "SERV", short: "SERV", label: "Serviços / Manutenção (sem autos)" },
  { code: "OUT", short: "OUT", label: "Outros" },
];

/** Tipo de uma fatura (as antigas não têm `invoiceType`). */
export function invoiceTypeOf(inv) {
  if (inv.invoiceType) return inv.invoiceType;
  if (inv.kind === "ADIANTAMENTO") return "ADI";
  if (inv.measurementId || inv.measurement) return "AUTO";
  return "OUT";
}

export function invoiceTypeInfo(code) {
  return INVOICE_TYPES.find((t) => t.code === code) || INVOICE_TYPES[INVOICE_TYPES.length - 1];
}

let optsPromise = null;
export function loadInvoiceOptions(force = false) {
  if (!optsPromise || force) {
    optsPromise = Promise.all([apiRequest("/finance/options/projects"), apiRequest("/finance/options/clients")])
      .then(([p, c]) => ({ projects: p.items || [], clients: c.items || [] }))
      .catch((err) => {
        optsPromise = null;
        throw err;
      });
  }
  return optsPromise;
}

/** Cálculo do programa de orçamentação (fteCalc). */
export function invoiceCalc(f) {
  const b = num(f.base);
  const ivaP = num(f.vatPercent) / 100;
  const iva = b * ivaP;
  const gar = (b * num(f.guaranteePercent)) / 100;
  // Faturas antigas (`legacy`): retenção sobre o valor s/ IVA e seguro sem IVA.
  const ret = f.hasWithholding === "Não" || f.hasWithholding === false ? 0 : (((f.legacy ? b : b - gar)) * num(f.withholdingPercent)) / 100;
  const ivaCat = (iva * num(f.vatCativoPercent)) / 100;
  const seg = ((b * num(f.carPercent)) / 100) * (f.legacy ? 1 : 1 + ivaP);
  const rec = b + iva - ivaCat - ret - seg - gar;
  return { base: round2(b), iva: round2(iva), gar: round2(gar), ret: round2(ret), ivaCat: round2(ivaCat), seg: round2(seg), total: round2(b + iva), rec: round2(rec) };
}

function pct(part, whole) {
  // 4 casas: ao reabrir a fatura, os valores recalculados têm de bater com os guardados.
  return whole > 0 ? Math.round((part / whole) * 1000000) / 10000 : 0;
}

const isRound = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 0.05;

function fromInvoice(inv) {
  const gross = num(inv.grossAmount);
  const vatP = pct(num(inv.vatAmount), gross);
  const gar = num(inv.guaranteeAmount);
  const ret = num(inv.withholdingAmount);
  const car = num(inv.carInsuranceAmount);
  // Que regra calculou a fatura? A do Centro de Recebimentos dá percentagens redondas.
  const mbtRet = pct(ret, gross - gar);
  const oldRet = pct(ret, gross);
  const mbtCar = pct(car, gross * (1 + vatP / 100));
  const oldCar = pct(car, gross);
  const legacy = (ret > 0 && !isRound(mbtRet) && isRound(oldRet)) || (car > 0 && !isRound(mbtCar) && isRound(oldCar));
  const docDate = String(inv.docDate || "").slice(0, 10);
  const dueDate = String(inv.dueDate || inv.effectiveDueDate || "").slice(0, 10);
  return {
    id: inv.id,
    invoiceType: invoiceTypeOf(inv),
    docNumber: inv.docNumber || "",
    docDate,
    clientId: inv.client?.id || inv.clientId || "",
    clientNif: "",
    projectId: inv.projectId || inv.project?.id || "",
    measurementId: inv.measurementId || inv.measurement?.id || "",
    description: inv.description || "",
    foreign: inv.currency && inv.currency !== "AOA",
    currency: inv.currency && inv.currency !== "AOA" ? inv.currency : "USD",
    foreignAmount: inv.foreignAmount ?? "",
    exchangeRate: inv.exchangeRate ?? "",
    base: gross,
    vatPercent: vatP,
    termDays: docDate && dueDate ? Math.max(daysBetween(dueDate, docDate), 0) : 30,
    dueDate,
    hasWithholding: num(inv.withholdingAmount) > 0 ? "Sim" : "Não",
    legacy,
    withholdingPercent: ret > 0 ? (legacy ? oldRet : mbtRet) : 6.5,
    vatCativoPercent: num(inv.vatCativoPercent),
    carPercent: car > 0 ? (legacy ? oldCar : mbtCar) : 0,
    guaranteePercent: pct(gar, gross),
    notes: inv.notes || "",
    documentPath: inv.documentPath || null,
    documentName: inv.documentName || null,
  };
}

/**
 * Abre o formulário.
 *  - `invoice`: editar
 *  - `scanFile`: lê logo este PDF com IA
 *  - `prefill`: valores iniciais (ex.: valor do movimento do banco)
 *  - `existingNumbers`: n.ºs já usados (para avisar antes de gravar)
 */
export async function openInvoiceForm({ invoice = null, scanFile = null, prefill = {}, existingNumbers = [], onSaved } = {}) {
  let opts;
  try {
    opts = await loadInvoiceOptions();
  } catch (err) {
    toast(errMsg(err, "Não foi possível carregar as obras e os clientes."), { type: "error" });
    return;
  }
  const today = todayKey();
  const f = invoice
    ? fromInvoice(invoice)
    : {
        id: null,
        invoiceType: "",
        docNumber: "",
        docDate: today,
        clientId: "",
        clientNif: "",
        projectId: "",
        measurementId: "",
        description: "",
        foreign: false,
        currency: "USD",
        foreignAmount: "",
        exchangeRate: "",
        base: "",
        vatPercent: 14,
        termDays: 30,
        dueDate: addDays(today, 30),
        hasWithholding: "",
        withholdingPercent: 6.5,
        vatCativoPercent: 0,
        carPercent: 0,
        guaranteePercent: 0,
        notes: "",
        documentPath: null,
        ...prefill,
      };
  const files = { pdf: scanFile ? [scanFile] : [] };
  let scan = null;
  let measurements = [];
  let dirty = false;
  let tried = false;
  const isEdit = Boolean(invoice);

  const drawer = openDrawer({
    kicker: isEdit ? "Fatura emitida" : "Nova fatura emitida",
    title: isEdit ? `Editar ${esc(invoice.docNumber || "fatura")}` : "Registar Fatura Emitida",
    subtitle: isEdit ? `${esc(invoice.client?.name || "")}${invoice.project ? ` · ${esc(invoice.project.code)} ${esc(invoice.project.name)}` : ""}` : "Os recebimentos registam-se depois, na Conciliação Bancária.",
    width: 1000,
    headerActions: `<button type="button" class="fo-btn fo-btn--ghost fo-btn--sm" data-scan>${icon("document_scanner")}Ler a Fatura do PDF</button>`,
    onClose: async () => (dirty ? ask("Há alterações por gravar. Fechar e perder as alterações?", { title: "Fechar o formulário", ok: "Fechar sem gravar", danger: true }) : true),
  });
  const body = drawer.body;

  const projectLabel = (p) => `${p.code} · ${p.name}`;
  const clientName = (id) => opts.clients.find((c) => c.id === id)?.name || "";

  async function loadMeasurements() {
    measurements = [];
    if (!f.projectId || f.invoiceType !== "AUTO") return;
    try {
      const { items } = await apiRequest(`/finance/projects/${encodeURIComponent(f.projectId)}/open-measurements`);
      measurements = items || [];
      if (isEdit && invoice.measurement && !measurements.some((m) => m.id === invoice.measurement.id)) {
        measurements.unshift({ id: invoice.measurement.id, reportNumber: invoice.measurement.reportNumber, reportDate: invoice.measurement.reportDate, periodValTotal: null });
      }
    } catch {
      measurements = [];
    }
  }

  function html() {
    const c = invoiceCalc(f);
    const proj = opts.projects.find((p) => p.id === f.projectId);
    return `
      <div data-errors></div>
      ${f.legacy ? `<div class="fo-note fo-note--muted">${icon("history")}<span>Fatura calculada com as regras anteriores (retenção sobre o valor s/ IVA, seguro sem IVA). Mantêm-se ao editar, para o valor a receber não mudar.</span></div>` : ""}
      ${scan ? `<div class="fo-note fo-note--good">${icon("auto_awesome")}<span>Lido do PDF${scan.model ? ` (${esc(scan.model)})` : ""} — confirme os campos antes de gravar.${scan.warnings?.length ? `<br><b>${esc(scan.warnings.join(" "))}</b>` : ""}${scan.projectHint && !f.projectId ? `<br>Obra indicada no documento: <b>${esc(scan.projectHint)}</b>` : ""}</span></div>` : ""}
      <section class="fo-section">
        <div class="fo-section-head"><h3 class="fo-section-title"><span class="fo-step">1</span>Documento</h3></div>
        <div class="fo-grid">
          <label class="fo-field fo-col-6"><span class="fo-label">Tipo de fatura <i class="fo-req">*</i></span>
            <select class="fo-input" data-f="invoiceType" data-req="invoiceType"><option value="">— escolher —</option>${INVOICE_TYPES.map((t) => `<option value="${t.code}" ${f.invoiceType === t.code ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></label>
          <label class="fo-field fo-col-3"><span class="fo-label">N.º da fatura <i class="fo-req">*</i></span><input class="fo-input" data-f="docNumber" data-req="docNumber" value="${esc(f.docNumber)}" placeholder="FT 2026/001"></label>
          <label class="fo-field fo-col-3"><span class="fo-label">Data de emissão <i class="fo-req">*</i></span><input type="date" class="fo-input" data-f="docDate" data-req="docDate" value="${esc(f.docDate)}"></label>
          <div class="fo-field fo-col-6"><span class="fo-label">Obra <i class="fo-req">*</i></span>
            <input class="fo-input" data-combo="project" data-req="projectId" value="${esc(proj ? projectLabel(proj) : "")}" placeholder="Pesquisar obra…" ${isEdit ? "disabled" : ""}>
            ${isEdit ? '<span class="fo-help">A obra de uma fatura gravada não se altera.</span>' : ""}</div>
          <div class="fo-field fo-col-4"><span class="fo-label">Cliente</span>
            <input class="fo-input" data-combo="client" value="${esc(clientName(f.clientId))}" placeholder="${proj?.clientName ? `${esc(proj.clientName)} (da obra)` : "Pesquisar cliente…"}"></div>
          <label class="fo-field fo-col-2"><span class="fo-label">NIF do cliente</span><input class="fo-input" data-f="clientNif" value="${esc(f.clientNif)}" placeholder="—"></label>
          ${
            f.invoiceType === "AUTO"
              ? `<label class="fo-field fo-col-6"><span class="fo-label">Auto de medição</span><select class="fo-input" data-f="measurementId"><option value="">${f.projectId ? (measurements.length ? "— escolher o auto —" : "Sem autos aprovados por faturar") : "Escolha primeiro a obra"}</option>${measurements
                  .map((m) => `<option value="${esc(m.id)}" ${f.measurementId === m.id ? "selected" : ""}>Auto n.º ${esc(m.reportNumber)} · ${fmtDate(String(m.reportDate || "").slice(0, 10))}${m.periodValTotal ? ` · ${money(m.periodValTotal)}` : ""}</option>`)
                  .join("")}</select></label>`
              : ""
          }
          <label class="fo-field ${f.invoiceType === "AUTO" ? "fo-col-6" : "fo-col-12"}"><span class="fo-label">Descrição / auto</span><input class="fo-input" data-f="description" value="${esc(f.description)}" placeholder="Ex.: Auto n.º 3 — trabalhos de março"></label>
        </div>
      </section>

      <section class="fo-section">
        <div class="fo-section-head"><h3 class="fo-section-title"><span class="fo-step">2</span>Valores</h3>
          <label class="fo-check ${f.foreign ? "is-on" : ""}" style="height:32px"><input type="checkbox" data-foreign ${f.foreign ? "checked" : ""}>Noutra moeda (USD / EUR)?</label></div>
        <div class="fo-grid">
          ${
            f.foreign
              ? `<label class="fo-field fo-col-2"><span class="fo-label">Moeda</span><select class="fo-input" data-f="currency">${["USD", "EUR"].map((m) => `<option ${f.currency === m ? "selected" : ""}>${m}</option>`).join("")}</select></label>
                 <label class="fo-field fo-col-4"><span class="fo-label">Valor s/ IVA em ${esc(f.currency)}</span><input class="fo-input" data-money data-f="foreignAmount" value="${f.foreignAmount === "" ? "" : money(f.foreignAmount)}"></label>
                 <label class="fo-field fo-col-3"><span class="fo-label">Câmbio (AOA por ${esc(f.currency)})</span><input class="fo-input is-num" data-f="exchangeRate" data-dec value="${esc(String(f.exchangeRate).replace(".", ","))}"></label>
                 <div class="fo-field fo-col-3"><span class="fo-label">&nbsp;</span><span class="fo-help" style="padding-top:.6rem">= valor s/ IVA em AOA</span></div>`
              : ""
          }
          <label class="fo-field fo-col-4"><span class="fo-label">Valor s/ IVA <i class="fo-req">*</i></span><div class="fo-input-group"><input class="fo-input" data-money data-f="base" data-req="base" value="${f.base === "" ? "" : money(f.base)}" placeholder="0,00" ${f.foreign ? "readonly" : ""}><span class="fo-addon">AOA</span></div></label>
          <label class="fo-field fo-col-2"><span class="fo-label">IVA %</span><input class="fo-input is-num" data-f="vatPercent" data-dec value="${esc(String(f.vatPercent).replace(".", ","))}"></label>
          <label class="fo-field fo-col-3"><span class="fo-label">Prazo de pagamento (dias)</span><input class="fo-input is-num" data-f="termDays" inputmode="numeric" value="${esc(f.termDays)}"></label>
          <label class="fo-field fo-col-3"><span class="fo-label">Vencimento / receção prevista <i class="fo-req">*</i></span><input type="date" class="fo-input" data-f="dueDate" data-req="dueDate" value="${esc(f.dueDate)}"></label>

          <div class="fo-field fo-col-4"><span class="fo-label">Tem retenção na fonte? <i class="fo-req">*</i></span>
            <div class="fo-seg fo-seg--full" data-req-seg="hasWithholding"><button type="button" data-wh="Sim" class="${f.hasWithholding === "Sim" ? "is-on" : ""}">Sim</button><button type="button" data-wh="Não" class="${f.hasWithholding === "Não" ? "is-on" : ""}">Não</button></div></div>
          ${f.hasWithholding === "Sim" ? `<label class="fo-field fo-col-2"><span class="fo-label">Retenção %</span><input class="fo-input is-num" data-f="withholdingPercent" data-dec value="${esc(String(f.withholdingPercent).replace(".", ","))}"></label>` : ""}
          <label class="fo-field fo-col-2"><span class="fo-label">IVA cativo</span><select class="fo-input" data-f="vatCativoPercent">${[0, 50, 100].map((v) => `<option value="${v}" ${num(f.vatCativoPercent) === v ? "selected" : ""}>${v}%</option>`).join("")}</select></label>
          <label class="fo-field fo-col-2"><span class="fo-label">Seguro de construção %</span><input class="fo-input is-num" data-f="carPercent" data-dec value="${esc(String(f.carPercent).replace(".", ","))}"></label>
          <label class="fo-field fo-col-2"><span class="fo-label">Garantia retida %</span><input class="fo-input is-num" data-f="guaranteePercent" data-dec value="${esc(String(f.guaranteePercent).replace(".", ","))}"></label>
        </div>
        <div class="fo-totals" data-calc style="margin-top:1rem;width:min(460px,100%)">${calcHtml(c)}</div>
      </section>

      <section class="fo-section">
        <div class="fo-section-head"><h3 class="fo-section-title"><span class="fo-step">3</span>PDF e observações</h3></div>
        <div class="fo-grid">
          <div class="fo-field fo-col-6"><span class="fo-label">PDF da fatura ${f.documentPath ? "" : '<i class="fo-req">*</i>'}</span>
            <div data-zone>${fileZoneHtml("pdf", { label: f.documentPath ? "Substituir o PDF" : "Anexar o PDF", accept: ".pdf,application/pdf,image/*", files: files.pdf })}</div>
            ${f.documentPath ? `<div class="fo-doclink" style="margin-top:.4rem">${icon("picture_as_pdf")}<a href="${esc(fileUrl(f.documentPath))}" target="_blank" rel="noopener">${esc(f.documentName || "PDF atual")}</a></div>` : ""}</div>
          <label class="fo-field fo-col-6"><span class="fo-label">Observações</span><textarea class="fo-input" rows="4" data-f="notes">${esc(f.notes)}</textarea></label>
        </div>
      </section>`;
  }

  function calcHtml(c) {
    return `<div><span>Total da fatura (c/ IVA)</span><b>${money(c.total)}</b></div>
      ${c.ivaCat ? `<div class="is-neg"><span>IVA cativo</span><b>− ${money(c.ivaCat)}</b></div>` : ""}
      ${c.ret ? `<div class="is-neg"><span>Retenção <small class="fo-faint">${f.legacy ? "(s/ IVA)" : "(s/ IVA − garantia)"}</small></span><b>− ${money(c.ret)}</b></div>` : ""}
      ${c.seg ? `<div class="is-neg"><span>Seguro de construção <small class="fo-faint">${f.legacy ? "" : "(c/ IVA)"}</small></span><b>− ${money(c.seg)}</b></div>` : ""}
      ${c.gar ? `<div class="is-neg"><span>Garantia</span><b>− ${money(c.gar)}</b></div>` : ""}
      <div class="is-big"><span>A receber</span><b>${money(c.rec)} <small style="font-size:.6em;color:var(--fo-faint)">AOA</small></b></div>`;
  }

  function renderFooter() {
    const c = invoiceCalc(f);
    drawer.setFooter(`<div class="fo-foot-info"><span>A receber <b>${money(c.rec)}</b> AOA</span></div><div class="fo-foot-btns"><button type="button" class="fo-btn fo-btn--ghost" data-cancel>Cancelar</button><button type="button" class="fo-btn fo-btn--primary" data-save>${icon("save")}Gravar</button></div>`);
  }

  function renderAll() {
    body.innerHTML = html();
    bindMoney(body);
    const zone = body.querySelector("[data-zone]");
    bindFileZones(zone, files, () => {
      dirty = true;
      renderAll();
    });
    bindCombos();
    renderFooter();
    if (tried) showErrors(validate(), false);
  }

  function refreshCalc() {
    const c = invoiceCalc(f);
    const el = body.querySelector("[data-calc]");
    if (el) el.innerHTML = calcHtml(c);
    const fi = drawer.footer.querySelector(".fo-foot-info");
    if (fi) fi.innerHTML = `<span>A receber <b>${money(c.rec)}</b> AOA</span>`;
  }

  function bindCombos() {
    const pInp = body.querySelector('[data-combo="project"]');
    if (pInp && !pInp.disabled) {
      bindCombo(pInp, {
        items: () => opts.projects.map((p) => ({ value: p.id, label: projectLabel(p), sub: p.clientName || "", data: p })),
        onPick: async (it) => {
          f.projectId = it.value;
          if (!f.clientId && it.data.clientId) f.clientId = it.data.clientId;
          dirty = true;
          await loadMeasurements();
          renderAll();
        },
      });
    }
    const cInp = body.querySelector('[data-combo="client"]');
    if (cInp) {
      bindCombo(cInp, {
        items: () => opts.clients.map((c) => ({ value: c.id, label: c.name, sub: c.code || "" })),
        onPick: (it) => {
          f.clientId = it.value;
          cInp.value = it.label;
          dirty = true;
        },
      });
    }
  }

  function validate() {
    const errs = [];
    const mark = [];
    const need = (cond, label, sel) => {
      if (!cond) {
        errs.push(label);
        if (sel) mark.push(sel);
      }
    };
    need(f.invoiceType, "tipo de fatura", '[data-req="invoiceType"]');
    need(String(f.docNumber).trim(), "n.º da fatura", '[data-req="docNumber"]');
    need(f.docDate, "data de emissão", '[data-req="docDate"]');
    need(f.projectId, "obra", '[data-req="projectId"]');
    need(num(f.base) > 0, "valor s/ IVA", '[data-req="base"]');
    need(f.dueDate, "vencimento / receção prevista", '[data-req="dueDate"]');
    if (f.dueDate && f.docDate && f.dueDate < f.docDate) {
      errs.push("vencimento depois da data de emissão");
      mark.push('[data-req="dueDate"]');
    }
    need(f.hasWithholding === "Sim" || f.hasWithholding === "Não", "tem retenção na fonte? (sim / não)", '[data-req-seg="hasWithholding"]');
    need(files.pdf.length || f.documentPath, "PDF da fatura", "[data-zone] .fo-filezone");
    const dup = String(f.docNumber).trim() && existingNumbers.some((n) => norm(n) === norm(f.docNumber) && (!isEdit || norm(n) !== norm(invoice.docNumber)));
    if (dup) {
      errs.push(`n.º da fatura diferente — a ${f.docNumber} já está registada`);
      mark.push('[data-req="docNumber"]');
    }
    return { errs, mark };
  }

  function showErrors({ errs, mark }, scroll = true) {
    body.querySelectorAll(".is-invalid").forEach((e) => e.classList.remove("is-invalid"));
    mark.forEach((s) => body.querySelector(s)?.classList.add("is-invalid"));
    const box = body.querySelector("[data-errors]");
    box.innerHTML = errorBox(errs);
    if (scroll && errs.length) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function runScan(file) {
    const btn = drawer.el.querySelector("[data-scan]");
    setBusy(btn, true, "A ler o PDF…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiUpload("/finance/invoices/scan", fd, "POST");
      const x = res.fields || {};
      scan = { model: x.model, warnings: res.warnings || [], projectHint: x.projectHint, raw: x.raw };
      if (x.docNumber) f.docNumber = x.docNumber;
      if (x.docDate) f.docDate = x.docDate;
      if (x.grossAmount) f.base = x.grossAmount;
      if (x.vatPercent !== null && x.vatPercent !== undefined) f.vatPercent = x.vatPercent;
      else if (x.vatAmount && x.grossAmount) f.vatPercent = pct(x.vatAmount, x.grossAmount);
      if (x.withholdingPercent || x.withholdingAmount) {
        f.hasWithholding = "Sim";
        f.withholdingPercent = x.withholdingPercent || pct(x.withholdingAmount, x.grossAmount);
      } else if (x.grossAmount) f.hasWithholding = "Não";
      if (x.vatCativoPercent !== null && x.vatCativoPercent !== undefined) f.vatCativoPercent = [0, 50, 100].reduce((a, v) => (Math.abs(v - x.vatCativoPercent) < Math.abs(a - x.vatCativoPercent) ? v : a), 0);
      if (x.guaranteeAmount && x.grossAmount) f.guaranteePercent = pct(x.guaranteeAmount, x.grossAmount);
      if (x.carInsuranceAmount && x.grossAmount) f.carPercent = pct(x.carInsuranceAmount, x.grossAmount * (1 + num(f.vatPercent) / 100));
      if (x.dueDate) f.dueDate = x.dueDate;
      else if (f.docDate) f.dueDate = addDays(f.docDate, num(f.termDays) || 30);
      if (f.dueDate && f.docDate) f.termDays = Math.max(daysBetween(f.dueDate, f.docDate), 0);
      if (x.currency && x.currency !== "AOA" && ["USD", "EUR"].includes(x.currency)) {
        f.foreign = true;
        f.currency = x.currency;
        f.foreignAmount = x.grossAmount || "";
      }
      if (x.description) f.description = x.description;
      if (x.notes && !f.notes) f.notes = x.notes;
      if (x.clientNif) f.clientNif = x.clientNif;
      if (!isEdit && x.suggestedProjectId && opts.projects.some((p) => p.id === x.suggestedProjectId)) {
        f.projectId = x.suggestedProjectId;
        const p = opts.projects.find((pp) => pp.id === f.projectId);
        if (p?.clientId && !f.clientId) f.clientId = p.clientId;
      }
      if (x.clientName && !f.clientId) {
        const c = opts.clients.find((cc) => norm(cc.name) === norm(x.clientName)) || opts.clients.find((cc) => norm(cc.name).includes(norm(x.clientName)) || norm(x.clientName).includes(norm(cc.name)));
        if (c) f.clientId = c.id;
      }
      if (!f.invoiceType) f.invoiceType = /adiant/i.test(`${x.description} ${x.documentType}`) ? "ADI" : /auto/i.test(x.description || "") ? "AUTO" : "";
      files.pdf = [file];
      dirty = true;
      scanFields = {
        scanSource: "AI",
        scanModel: x.model || null,
      };
      await loadMeasurements();
      renderAll();
      toast("Fatura lida — confirme os campos.", { type: "success" });
    } catch (err) {
      toast(errMsg(err, "Não foi possível ler a fatura."), { type: "error" });
      files.pdf = [file];
      renderAll();
    } finally {
      setBusy(btn, false);
    }
  }
  let scanFields = {};

  body.addEventListener("input", (e) => {
    const el = e.target;
    const k = el.dataset.f;
    if (!k) return;
    dirty = true;
    el.classList.remove("is-invalid");
    if (["base", "foreignAmount", "exchangeRate", "vatPercent", "withholdingPercent", "carPercent", "guaranteePercent"].includes(k)) f[k] = parseMoney(el.value);
    else f[k] = el.value;
    if (k === "foreignAmount" || k === "exchangeRate") {
      f.base = round2(num(f.foreignAmount) * num(f.exchangeRate));
      const b = body.querySelector('[data-f="base"]');
      if (b) b.value = f.base ? money(f.base) : "";
    }
    if (k === "termDays" && f.docDate && el.value !== "") {
      f.dueDate = addDays(f.docDate, Math.round(num(el.value)));
      const d = body.querySelector('[data-f="dueDate"]');
      if (d) d.value = f.dueDate;
    }
    if (k === "dueDate" && f.docDate && el.value) {
      f.termDays = Math.max(daysBetween(el.value, f.docDate), 0);
      const d = body.querySelector('[data-f="termDays"]');
      if (d) d.value = f.termDays;
    }
    if (k === "docDate" && el.value && f.termDays !== "") {
      f.dueDate = addDays(el.value, Math.round(num(f.termDays)));
      const d = body.querySelector('[data-f="dueDate"]');
      if (d) d.value = f.dueDate;
    }
    refreshCalc();
  });

  body.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.matches("[data-foreign]")) {
      f.foreign = el.checked;
      if (!f.foreign) {
        f.foreignAmount = "";
        f.exchangeRate = "";
      }
      dirty = true;
      return renderAll();
    }
    if (el.dataset.f === "invoiceType") {
      f.invoiceType = el.value;
      await loadMeasurements();
      return renderAll();
    }
    if (el.dataset.f === "measurementId") {
      f.measurementId = el.value;
      const m = measurements.find((x) => x.id === el.value);
      if (m) {
        if (!num(f.base) && m.periodValTotal) f.base = m.periodValTotal;
        if (!f.description) f.description = `Auto n.º ${m.reportNumber}`;
      }
      return renderAll();
    }
    if (el.dataset.f === "vatCativoPercent" || el.dataset.f === "currency") {
      f[el.dataset.f] = el.dataset.f === "vatCativoPercent" ? Number(el.value) : el.value;
      if (el.dataset.f === "currency") renderAll();
      else refreshCalc();
    }
  });

  body.addEventListener("click", (e) => {
    const wh = e.target.closest("[data-wh]");
    if (wh) {
      f.hasWithholding = wh.dataset.wh;
      dirty = true;
      renderAll();
    }
  });

  drawer.el.querySelector("[data-scan]").addEventListener("click", async () => {
    const [file] = await pickFiles({ accept: ".pdf,application/pdf,image/*" });
    if (file) runScan(file);
  });

  drawer.footer.addEventListener("click", async (e) => {
    if (e.target.closest("[data-cancel]")) return drawer.close();
    const btn = e.target.closest("[data-save]");
    if (!btn) return;
    tried = true;
    const v = validate();
    showErrors(v);
    if (v.errs.length) return;
    const noon = (d) => (d ? `${d}T12:00:00.000Z` : null);
    const payload = {
      invoiceType: f.invoiceType,
      docNumber: String(f.docNumber).trim(),
      docDate: noon(f.docDate),
      dueDate: noon(f.dueDate),
      clientId: f.clientId || null,
      measurementId: f.invoiceType === "AUTO" ? f.measurementId || null : null,
      description: f.description || null,
      currency: f.foreign ? f.currency : "AOA",
      foreignAmount: f.foreign ? num(f.foreignAmount) || null : null,
      exchangeRate: f.foreign ? num(f.exchangeRate) || null : null,
      grossAmount: round2(num(f.base)),
      vatPercent: num(f.vatPercent),
      withholdingPercent: f.hasWithholding === "Sim" ? num(f.withholdingPercent) : 0,
      carPercent: num(f.carPercent),
      guaranteePercent: num(f.guaranteePercent),
      vatCativoPercent: num(f.vatCativoPercent),
      calcMode: f.legacy ? null : "MBT",
      notes: f.notes || null,
    };
    if (!isEdit) {
      payload.projectId = f.projectId;
      Object.assign(payload, scanFields);
    }
    setBusy(btn, true);
    try {
      const res = isEdit ? await apiRequest(`/finance/invoices/${invoice.id}`, { method: "PATCH", body: payload }) : await apiRequest("/finance/invoices", { method: "POST", body: payload });
      let saved = res.invoice;
      if (files.pdf[0]) {
        const fd = new FormData();
        fd.append("file", files.pdf[0]);
        try {
          const up = await apiUpload(`/finance/invoices/${saved.id}/document`, fd, "POST");
          if (up?.invoice) saved = up.invoice;
        } catch (err) {
          toast(`Fatura gravada, mas o PDF não foi anexado: ${errMsg(err)}`, { type: "error" });
        }
      }
      (res.warnings || []).forEach((w) => toast(typeof w === "string" ? w : w.message || "", { type: "info", timeoutMs: 6000 }));
      dirty = false;
      toast(`Fatura ${saved.docNumber || ""} ${isEdit ? "atualizada" : "registada"}.`, { type: "success" });
      drawer.close(true);
      onSaved?.(saved);
    } catch (err) {
      setBusy(btn, false);
      if (err?.data?.error === "DUPLICATE_DOC_NUMBER") body.querySelector('[data-req="docNumber"]')?.classList.add("is-invalid");
      toast(errMsg(err, "Não foi possível gravar a fatura."), { type: "error" });
    }
  });

  await loadMeasurements();
  renderAll();
  if (scanFile) runScan(scanFile);
  else if (!isEdit) setTimeout(() => body.querySelector('[data-f="invoiceType"]')?.focus(), 80);
}
