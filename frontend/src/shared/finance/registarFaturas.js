import { apiRequest, apiUpload } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { openInvoiceDocumentModal, invoiceHasDocument } from "./invoiceDocument.js";
import { compactMoney as compact } from "./charts.js";
import { daysLate } from "./aging.js";
import { openReceiptModal, RECEIPT_METHODS } from "./receiptModal.js";
import { meterHtml, num, stripHtml } from "./widgets.js";
import { codigoNoCabecalho } from "./f2Ui.js";

/**
 * Ecrã «Registar Faturas» (Financeiro · Faturação).
 *
 *  - Indicadores do filtro actual (faturado, recebido, em falta, atrasadas).
 *  - Faixa de estados que também serve de filtro rápido.
 *  - Tabela com o essencial de cada fatura; as deduções abrem no detalhe.
 *  - Formulário em duas colunas: dados da fatura à esquerda e, à direita, o
 *    documento físico (leitura com IA) e o resumo dos valores calculados.
 */

const STATUS = {
  EM_ABERTO: { label: "Em Aberto", badge: "slate" },
  PAGO_PARCIAL: { label: "Pago Parcial", badge: "amber" },
  PAGO_TOTAL: { label: "Pago Total", badge: "emerald" },
  ATRASADO: { label: "Atrasado", badge: "red" },
};

const state = {
  // Como no protótipo (R1): abre em «Por receber».
  filters: { month: "", status: "__aberto", clientId: "", projectId: "", type: "", noPdf: false, until: "" },
  forecast: [],
  receivedThisMonth: {},
  query: "",
  projects: [],
  clients: [],
  cards: [],
  items: [],
  totals: null,
  selected: new Set(),
  expanded: new Set(),
  // Estado da leitura automática de faturas (Gemini).
  ai: { configured: false, model: null, loaded: false },
};

/**
 * Metadados da última leitura com IA feita no formulário aberto — guardados
 * com a fatura para se saber que foi lida automaticamente e por que modelo.
 */
let lastScan = null;

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function pct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function canEdit() {
  return can("financeiro", "edit") || can("financeiro", "approve") || can("financeiro", "manage");
}

function projectById(id) {
  return state.projects.find((p) => p.id === id) || null;
}

/** Data «só dia» (docDate/dueDate vêm em ISO) — evita desvio de fuso. */
function formatDateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function addDays(dateKey, days) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  if (!y || !m || !d) return "";
  return toDateKey(new Date(Date.UTC(y, m - 1, d + days)));
}

/* ─── Estrutura ───────────────────────────────────────────────────────────── */

/** Tipos de fatura (R1 do protótipo). */
const TIPOS = [
  ["AM", "Auto de Medição"],
  ["FU", "Fatura Única / Final"],
  ["MC", "Marco de Pagamento"],
  ["ADI", "Adiantamento"],
  ["RET", "Retenção"],
  ["DRET", "Devolução de Retenção"],
  ["REV", "Revisão de Preços"],
  ["SERV", "Serviços / Manutenção"],
];

const ESTADOS = [
  ["__aberto", "Por receber"],
  ["ATRASADO", "Atrasados"],
  ["a90", "Atraso superior a 90 dias"],
  ["EM_ABERTO", "Em aberto"],
  ["PAGO_PARCIAL", "Recebidos em parte"],
  ["PAGO_TOTAL", "Recebidos"],
  ["prev", "Previstos"],
  ["", "Todos"],
];

const POR_RECEBER = ["EM_ABERTO", "PAGO_PARCIAL", "ATRASADO"];
const SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

function renderShell() {
  codigoNoCabecalho("R1");
  const root = document.getElementById("financeRoot");
  root.innerHTML = `
    <div class="ov fcp-root">
      <div class="fcp-f1">
        <input id="invSearch" class="finance-input fcp-q" type="search" placeholder="Pesquisar n.º, cliente, obra, auto, valor…" autocomplete="off" />
        <select id="invFilterType" class="finance-select fcp-sel" title="Tipo de fatura">
          <option value="">Todos os tipos de fatura</option>
          ${TIPOS.map(([k, l]) => `<option value="${k}">${k} — ${esc(l)}</option>`).join("")}
          <option value="PREV">Previstos (ainda sem fatura)</option>
        </select>
        <select id="invFilterClient" class="finance-select fcp-sel" title="Cliente"></select>
        <select id="invFilterProject" class="finance-select fcp-sel" title="Obra"></select>
        <input id="invFilterMonth" class="finance-input fcp-sel" type="month" title="Mês do documento" />
        <button id="invFilterClear" type="button" class="finance-btn finance-btn--sm">Limpar</button>
      </div>
      <div id="invFiltros2" class="fcp-f2"></div>
      <div id="invCards" class="fcp-kpr"></div>
      <p class="fcp-resumo" id="invCount">—</p>
      <div id="invBulkBar"></div>
      <section class="finance-card ov-panel" style="padding:0">
        <div id="invoiceTable" class="fx2-tw"></div>
      </section>
      <p class="fcal-nota">Tipos: AM Auto de Medição · FU Fatura Única / Final · MC Marco de Pagamento · ADI Adiantamento ·
        RET Retenção · DRET Devolução de Retenção · REV Revisão de Preços · SERV Serviços / Manutenção.
        Selecione uma ou várias faturas do mesmo cliente para registar um <b>Recibo Único</b>, ou clique numa linha para ver o detalhe.</p>
    </div>`;

  const clientSel = document.getElementById("invFilterClient");
  clientSel.innerHTML =
    `<option value="">Todos os clientes</option>` +
    state.clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

  const projectSel = document.getElementById("invFilterProject");
  projectSel.innerHTML =
    `<option value="">Todas as obras</option>` +
    state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.referencia ? `${p.referencia} — ${p.name}` : p.name)}</option>`).join("");

  clientSel.value = state.filters.clientId;
  projectSel.value = state.filters.projectId;
  document.getElementById("invFilterMonth").value = state.filters.month;
  document.getElementById("invFilterType").value = state.filters.type;

  clientSel.addEventListener("change", () => {
    state.filters.clientId = clientSel.value;
    loadInvoices();
  });
  projectSel.addEventListener("change", () => {
    state.filters.projectId = projectSel.value;
    loadInvoices();
  });
  document.getElementById("invFilterMonth").addEventListener("change", (e) => {
    state.filters.month = e.target.value;
    loadInvoices();
  });
  document.getElementById("invFilterType").addEventListener("change", (e) => {
    state.filters.type = e.target.value;
    renderAll();
  });
  document.getElementById("invFilterClear").addEventListener("click", () => {
    state.filters = { month: "", status: "__aberto", clientId: "", projectId: "", type: "", noPdf: false, until: "" };
    state.query = "";
    document.getElementById("invFilterMonth").value = "";
    document.getElementById("invFilterType").value = "";
    document.getElementById("invSearch").value = "";
    clientSel.value = "";
    projectSel.value = "";
    loadInvoices();
  });

  let timer = null;
  document.getElementById("invSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value;
      renderAll();
    }, 150);
  });

  // Segunda linha: estado, faturas sem PDF, receção até.
  const f2 = document.getElementById("invFiltros2");
  f2.addEventListener("change", (e) => {
    if (e.target.id === "invEstado") state.filters.status = e.target.value;
    if (e.target.id === "invNoPdf") state.filters.noPdf = e.target.checked;
    if (e.target.id === "invAte") state.filters.until = e.target.value;
    renderAll();
  });
  f2.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ate]");
    if (!b) return;
    const hoje = toDateKey(new Date());
    const fimMes = toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
    const v = { hoje, fim: fimMes, "": "" }[b.dataset.ate];
    state.filters.until = state.filters.until === v ? "" : v;
    renderAll();
  });
  document.getElementById("invCards").addEventListener("click", (e) => {
    const b = e.target.closest("[data-r1est]");
    if (!b) return;
    const v = b.dataset.r1est;
    state.filters.status = state.filters.status === v && v !== "__aberto" ? "__aberto" : v;
    renderAll();
  });

  const actions = document.getElementById("financePageActions");
  if (actions) {
    actions.innerHTML = `
      <button id="invXlsx" type="button" class="finance-btn">Exportar Excel</button>
      ${
        canEdit()
          ? `<label class="finance-btn" title="Lê cada PDF e abre o formulário já preenchido, para conferir e guardar"><span class="material-symbols-outlined">upload_file</span> Importar Faturas (PDF)
               <input id="invImport" type="file" hidden multiple accept="application/pdf,.pdf" /></label>
             <button id="invNew" type="button" class="finance-btn finance-btn--primary">+ Registar Fatura</button>`
          : ""
      }`;
    document.getElementById("invNew")?.addEventListener("click", () => openInvoiceModal(null));
    document.getElementById("invXlsx")?.addEventListener("click", () =>
      exportarExcel().catch((err) => toast(err.message || "Falha ao exportar.", { type: "error" }))
    );
    document.getElementById("invImport")?.addEventListener("change", (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = "";
      importarPdfs(files);
    });
  }
}

/** Importar faturas em PDF: abre o formulário para cada uma, com o ficheiro já escolhido (e lido com IA, se houver). */
function importarPdfs(files) {
  if (!files.length) return;
  const proximo = () => {
    const file = files.shift();
    if (!file) return;
    openInvoiceModal(null, { file });
    const overlays = document.querySelectorAll("[data-app-modal]");
    const ov = overlays[overlays.length - 1];
    if (!ov || !files.length) return;
    toast(`Faltam ${files.length} fatura(s): abrem a seguir a esta.`);
    const obs = new MutationObserver(() => {
      if (!document.body.contains(ov)) {
        obs.disconnect();
        setTimeout(proximo, 300);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  };
  proximo();
}

const vencDe = (inv) => toDateKey(inv.dueDate || inv.effectiveDueDate);

function em7Dias(inv) {
  const v = vencDe(inv);
  if (!v || !POR_RECEBER.includes(inv.status)) return false;
  const hoje = toDateKey(new Date());
  return v >= hoje && v <= addDays(hoje, 7);
}

/** Soma por moeda (nunca se somam moedas diferentes). */
function porMoeda(list, valor, moeda = (i) => i.project?.currency || "AOA") {
  const m = {};
  for (const i of list) {
    const k = String(moeda(i) || "AOA").toUpperCase();
    m[k] = (m[k] || 0) + num(valor(i));
  }
  return m;
}

function moedasHtml(m) {
  const ks = Object.keys(m).sort((a, b) => (a === "AOA" ? -1 : b === "AOA" ? 1 : a.localeCompare(b)));
  if (!ks.length) return esc(money(0, "AOA"));
  return ks.map((k, i) => (i ? `<small class="fx2-mut"> + ${esc(money(m[k], k))}</small>` : esc(money(m[k], k)))).join("");
}

/** Em atraso há mais de 90 dias (pela data de receção). */
function atraso90(inv) {
  const v = vencDe(inv);
  return inv.status === "ATRASADO" && v && v < addDays(toDateKey(new Date()), -90);
}

/**
 * Os 5 cartões KPI do Centro de Recebimentos (v638, mesmo formato do Centro de Pagamentos):
 * Por Receber · Em Atraso · Vence em 7 Dias · Atraso Superior a 90 Dias · Recebido.
 */
function renderCards() {
  const base = filteredBase();
  const ab = base.filter((i) => POR_RECEBER.includes(i.status) && num(i.missingAmount) > 0.5);
  const atr = ab.filter((i) => i.status === "ATRASADO");
  const v7 = ab.filter(em7Dias);
  const a90 = atr.filter(atraso90);
  const rec = base.filter((i) => num(i.receivedAmount) > 0.5);
  const st = state.filters.status;

  const kpi = (k, cls, lbl, L, valFn = (i) => i.missingAmount) =>
    `<button type="button" class="fcp-kpc ${cls}${st === k ? " is-on" : ""}" data-r1est="${k}">
      <span>${esc(lbl)}</span>
      <b>${moedasHtml(porMoeda(L, valFn))}</b>
      <i>${L.length} fatura(s)</i>
    </button>`;

  document.getElementById("invCards").innerHTML =
    kpi("__aberto", "", "Por Receber", ab) +
    kpi("ATRASADO", "bad", "Em Atraso", atr) +
    kpi("v7", "warn", "Vence em 7 Dias", v7) +
    kpi("a90", "bad", "Atraso Superior a 90 Dias", a90) +
    kpi("rec_any", "good", "Recebido", rec, (i) => i.receivedAmount);
}

function renderFiltros2() {
  const f = state.filters;
  const semPdf = state.items.filter((i) => !invoiceHasDocument(i)).length;
  const hoje = toDateKey(new Date());
  const fimMes = toDateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
  document.getElementById("invFiltros2").innerHTML = `
    <select id="invEstado" class="finance-select">${ESTADOS.map(([k, l]) => `<option value="${k}"${f.status === k ? " selected" : ""}>${l}</option>`).join("")}${
      f.status === "v7" ? `<option value="v7" selected>Recebe em 7 dias</option>` : ""
    }</select>
    <label class="cp-venc"><input id="invNoPdf" type="checkbox"${f.noPdf ? " checked" : ""}> Faturas sem PDF${semPdf ? ` (${semPdf})` : ""}</label>
    <span class="cp-venc inv-ate">Receção até
      <button type="button" class="finance-btn finance-btn--sm${f.until === hoje ? " is-on" : ""}" data-ate="hoje">Hoje</button>
      <button type="button" class="finance-btn finance-btn--sm${f.until === fimMes ? " is-on" : ""}" data-ate="fim">Fim do mês</button>
      <input id="invAte" class="finance-input" type="date" value="${esc(f.until || "")}">
      ${f.until ? `<button type="button" class="finance-btn finance-btn--sm" data-ate="" title="Sem limite"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button>` : ""}
    </span>`;
}

/** Autos aprovados ainda sem fatura, com os mesmos filtros (pesquisa, receção até não se aplica). */
function forecastVisible() {
  const q = state.query.trim().toLowerCase();
  if (state.filters.type && state.filters.type !== "PREV" && state.filters.type !== "AM") return [];
  return (state.forecast || []).filter(
    (a) => !q || [a.reportNumber, a.project?.name, a.project?.code, a.client?.name].some((v) => String(v || "").toLowerCase().includes(q))
  );
}

async function exportarExcel() {
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = SHEETJS;
      sc.onload = resolve;
      sc.onerror = () => reject(new Error("não foi possível carregar o Excel"));
      document.head.appendChild(sc);
    });
  }
  const linhas = [
    ["Fatura", "Data", "Receção", "Tipo", "Obra", "Cliente", "Auto", "Moeda", "V. ilíquido", "IVA", "V. a receber (líquido)", "Recebido", "Falta", "Estado"],
  ];
  for (const i of state.items) {
    linhas.push([
      i.docNumber || "",
      toDateKey(i.docDate) || "",
      vencDe(i) || "",
      i.invoiceType || "",
      [i.project?.code, i.project?.name].filter(Boolean).join(" · "),
      i.client?.name || "",
      i.measurement?.reportNumber || "",
      i.project?.currency || "AOA",
      num(i.grossAmount),
      num(i.vatAmount),
      num(i.netAmount),
      num(i.receivedAmount),
      num(i.missingAmount),
      STATUS_LABEL[i.status] || i.status,
    ]);
  }
  for (const a of state.forecast || []) {
    linhas.push(["PREV", toDateKey(a.reportDate) || "", "", "AM", [a.project?.code, a.project?.name].filter(Boolean).join(" · "), a.client?.name || "", a.reportNumber || "", a.currency, "", "", a.value, 0, a.value, "Previsto"]);
  }
  const ws = window.XLSX.utils.aoa_to_sheet(linhas);
  ws["!cols"] = [14, 11, 11, 6, 30, 30, 10, 7, 16, 14, 18, 16, 16, 14].map((w) => ({ wch: w }));
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Recebimentos");
  window.XLSX.writeFile(wb, "Centro de Recebimentos.xlsx");
}

/** Faturas do filtro do servidor, já com a pesquisa local aplicada. */
function searched() {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.items;
  return state.items.filter((inv) =>
    [inv.docNumber, inv.project?.name, inv.project?.code, inv.client?.name, inv.measurement?.reportNumber].some((v) =>
      String(v || "").toLowerCase().includes(q)
    )
  );
}

/** Pesquisa + tipo + sem PDF + receção até (sem o estado). */
function filteredBase() {
  const f = state.filters;
  return searched().filter(
    (i) =>
      (!f.type || (f.type === "PREV" ? false : i.invoiceType === f.type)) &&
      (!f.noPdf || !invoiceHasDocument(i)) &&
      (!f.until || (vencDe(i) || "9999") <= f.until)
  );
}

function totalLiquidarOf(inv) {
  if (inv.totalToLiquidate !== undefined && inv.totalToLiquidate !== null) return num(inv.totalToLiquidate);
  const vat = inv.flagVatCativo ? 0 : num(inv.vatAmount);
  return Math.round((num(inv.grossAmount) + vat - num(inv.carInsuranceAmount) - num(inv.guaranteeAmount)) * 100) / 100;
}

/** Faturas visíveis na tabela. */
function visibleItems() {
  const items = filteredBase();
  const s = state.filters.status;
  if (s === "__aberto") return items.filter((i) => POR_RECEBER.includes(i.status) && num(i.missingAmount) > 0.5);
  if (s === "v7") return items.filter(em7Dias);
  if (s === "a90") return items.filter(atraso90);
  if (s === "rec_any") return items.filter((i) => num(i.receivedAmount) > 0.5);
  if (s === "prev") return [];
  return s ? items.filter((i) => i.status === s) : items;
}

const STATUS_LABEL = { EM_ABERTO: "Em aberto", PAGO_PARCIAL: "Pago parcial", PAGO_TOTAL: "Pago total", ATRASADO: "Atrasado" };

/* ─── Indicadores ─────────────────────────────────────────────────────────── */

function renderKpis() {
  const items = visibleItems();
  const sum = (key) => items.reduce((a, i) => a + num(i[key]), 0);
  const gross = sum("grossAmount");
  const net = sum("netAmount");
  const received = sum("receivedAmount");
  const missing = sum("missingAmount");
  const deductions = sum("withholdingAmount") + sum("carInsuranceAmount") + sum("guaranteeAmount");
  const overdue = items.filter((i) => i.status === "ATRASADO");
  const overdueValue = overdue.reduce((a, i) => a + num(i.missingAmount), 0);
  const receivedPct = net > 0 ? (received / net) * 100 : 0;
  const oldest = overdue.reduce((max, i) => Math.max(max, daysLate(i.dueDate || i.effectiveDueDate) || 0), 0);

  const cards = [
    {
      key: "gross",
      label: "Total faturado",
      icon: "receipt_long",
      tone: "blue",
      value: money(gross),
      badge: `${items.length} fatura${items.length === 1 ? "" : "s"}`,
      badgeTone: "blue",
      body: `
        <dl class="ov-kpi-split">
          <div><dt>Valor líquido</dt><dd>${esc(compact(net))}</dd></div>
          <div><dt>Retenções, CAR e garantia</dt><dd class="ov-neg">− ${esc(compact(deductions))}</dd></div>
        </dl>`,
    },
    {
      key: "received",
      label: "Total recebido",
      icon: "savings",
      tone: "emerald",
      value: money(received),
      badge: `${pct(receivedPct, 1)} do líquido`,
      badgeTone: "emerald",
      body: `
        ${meterHtml([{ value: receivedPct, tone: "emerald" }])}
        <p class="ov-kpi-compare">de <strong>${esc(compact(net))}</strong> a receber em valor líquido</p>`,
    },
    {
      key: "missing",
      label: "Em falta",
      icon: "pending_actions",
      tone: "amber",
      value: money(missing),
      badge: overdueValue > 0 ? `${compact(overdueValue)} vencido` : "Nada vencido",
      badgeTone: overdueValue > 0 ? "red" : "emerald",
      body: `
        ${meterHtml([
          { value: missing > 0 ? (overdueValue / missing) * 100 : 0, tone: "red" },
          { value: missing > 0 ? ((missing - overdueValue) / missing) * 100 : 0, tone: "amber-soft" },
        ])}
        <p class="ov-kpi-compare">
          <span class="ov-legend"><i class="ov-dot ov-dot--red"></i>Vencido</span>
          <span class="ov-legend" style="margin-left:0.6rem"><i class="ov-dot ov-dot--amber"></i>A vencer</span>
        </p>`,
    },
    {
      key: "overdue",
      label: "Faturas atrasadas",
      icon: "event_busy",
      tone: overdue.length ? "red" : "emerald",
      value: String(overdue.length),
      badge: overdue.length ? `${compact(overdueValue)} em atraso` : "Em dia",
      badgeTone: overdue.length ? "red" : "emerald",
      body: `<p class="ov-kpi-compare">${
        overdue.length
          ? `A mais antiga está vencida há <strong>${oldest} dias</strong>. Use «Registar recebimento» quando o cliente pagar.`
          : "Nenhuma fatura passou da data de vencimento."
      }</p>`,
    },
  ];

  document.getElementById("invoiceKpis").innerHTML = kpiCardsHtml(cards, "inv");
}

function statusBadge(status) {
  const s = STATUS[status] || { label: status, badge: "slate" };
  return `<span class="finance-badge finance-badge--${s.badge}">${esc(s.label)}</span>`;
}

function dueChip(inv) {
  const due = inv.dueDate || inv.effectiveDueDate;
  if (!due || num(inv.missingAmount) <= 0) return "";
  const days = daysLate(due);
  if (days === null) return "";
  if (days > 0) return `<span class="inv-due inv-due--late">há ${days} d</span>`;
  if (days === 0) return `<span class="inv-due inv-due--today">hoje</span>`;
  if (days >= -7) return `<span class="inv-due inv-due--soon">em ${Math.abs(days)} d</span>`;
  return "";
}

function detailRow(inv, cur) {
  const item = (label, value, cls = "") => `
    <div class="inv-detail-item">
      <span>${esc(label)}</span>
      <strong class="${cls}">${value}</strong>
    </div>`;
  return `
    <div class="inv-detail">
      ${item("Retenção na fonte", `− ${esc(money(inv.withholdingAmount, cur))}`, "ov-neg")}
      ${item("IVA", inv.flagVatCativo ? "Cativo pelo cliente" : esc(money(inv.vatAmount, cur)))}
      ${item("Seguro CAR", `− ${esc(money(inv.carInsuranceAmount, cur))}`, "ov-neg")}
      ${item("Garantia", `− ${esc(money(inv.guaranteeAmount, cur))}`, "ov-neg")}
      ${item("% da obra", inv.workPercent === null ? "—" : esc(pct(inv.workPercent)))}
      ${item("Último recebimento", esc(formatDateOnly(inv.receivedDate)))}
      ${inv.notes ? `<div class="inv-detail-item inv-detail-item--wide"><span>Notas</span><strong>${esc(inv.notes)}</strong></div>` : ""}
    </div>`;
}

function renderBulkReceiptBar(items) {
  const slot = document.getElementById("invBulkBar");
  if (!slot) return;
  const openIds = new Set(state.items.filter((i) => num(i.missingAmount) > 0.5).map((i) => i.id));
  [...state.selected].forEach((id) => {
    if (!openIds.has(id)) state.selected.delete(id);
  });
  if (!state.selected.size || !canEdit()) {
    slot.innerHTML = "";
    return;
  }
  const selList = state.items.filter((i) => state.selected.has(i.id));
  const clients = [...new Set(selList.map((i) => i.client?.name || i.project?.client?.name || "—"))];
  slot.innerHTML = `
    <div class="fcp-bulkbar">
      <b>${selList.length} fatura(s)</b>
      <span class="fx2-mut">${esc(clients.join(", "))} · falta receber <b>${moedasHtml(porMoeda(selList, (i) => i.missingAmount))}</b></span>
      <span style="flex:1"></span>
      <button type="button" class="finance-btn finance-btn--sm" id="invSelClear">Limpar</button>
      <button type="button" class="finance-btn finance-btn--sm finance-btn--primary" id="invBulkRcvBtn">Registar Recebimento (Recibo Único)</button>
    </div>`;
  document.getElementById("invSelClear")?.addEventListener("click", () => {
    state.selected.clear();
    renderTable();
  });
  document.getElementById("invBulkRcvBtn")?.addEventListener("click", () => openBulkReceiptModal(selList));
}

/** Recibo Único para várias faturas (`FXDRAW.rcmul` v638/v639). */
function openBulkReceiptModal(selList) {
  const clientKeys = new Set(selList.map((i) => i.client?.id || i.client?.name || i.project?.client?.name || i.id));
  if (clientKeys.size > 1) {
    return toast("Selecione apenas faturas do mesmo cliente para emitir um Recibo Único.", { type: "error" });
  }
  const cur = selList[0]?.project?.currency || "AOA";
  const cliName = selList[0]?.client?.name || selList[0]?.project?.client?.name || "Cliente";
  const lines = selList.map((inv) => ({ inv, val: Math.round(num(inv.missingAmount) * 100) / 100 }));
  const today = toDateKey(new Date());
  const fmtN = (v) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  openModal({
    title: `RECEBIMENTO · ${lines.length} fatura(s) · ${cliName}`,
    width: 980,
    primaryLabel: "Registar Recebimento",
    secondaryLabel: "Cancelar",
    contentHtml: `
      <p class="fx2-mut t3-small" style="margin:0 0 10px">Um só recibo para várias faturas. Pode receber só parte de uma fatura: ajuste o valor recebido em cada linha.</p>
      <div class="finance-form-grid finance-form-grid--3" style="margin-bottom:12px">
        <div class="finance-field">
          <label class="finance-label">Data do recebimento <span class="inv-req">*</span></label>
          <input id="rcmDate" type="date" class="finance-input" value="${today}" max="${today}">
        </div>
        <div class="finance-field">
          <label class="finance-label">Conta onde entrou <span class="inv-req">*</span></label>
          <select id="rcmCard" class="finance-select">
            <option value="">— escolher conta —</option>
            ${state.cards.map((c) => `<option value="${esc(c.id)}" data-label="${esc([c.bank, c.label].filter(Boolean).join(" "))}">${esc([c.bank, c.label, c.lastDigits ? `•${c.lastDigits}` : ""].filter(Boolean).join(" "))}</option>`).join("")}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label">N.º do recibo / referência <span class="inv-req">*</span></label>
          <input id="rcmRef" type="text" class="finance-input" placeholder="ex.: RC MBT2026/15">
        </div>
      </div>
      <div class="fx2-tw">
        <table class="fx2-t">
          <thead>
            <tr>
              <th>Fatura</th><th>Obra</th><th>Vencimento</th>
              <th class="r" title="Ilíquido + IVA − seguro − garantia">Total a Liquidar</th>
              <th class="r">Retenção</th>
              <th class="r">V. a Receber</th>
              <th class="r">Já Recebido</th>
              <th class="r">Falta</th>
              <th class="r">Valor Recebido Agora</th>
              <th class="r">Fica a Faltar</th>
            </tr>
          </thead>
          <tbody>
            ${lines
              .map((z, idx) => {
                const f = Math.round(num(z.inv.missingAmount) * 100) / 100;
                return `<tr>
                  <td><b>${esc(z.inv.docNumber || "—")}</b></td>
                  <td class="fx2-mut">${esc(z.inv.project?.referencia || z.inv.project?.code || z.inv.project?.name || "—")}</td>
                  <td>${esc(formatDateOnly(z.inv.dueDate || z.inv.effectiveDueDate))}</td>
                  <td class="r"><b>${fmtN(totalLiquidarOf(z.inv))}</b></td>
                  <td class="r">${fmtN(z.inv.withholdingAmount)}</td>
                  <td class="r">${fmtN(z.inv.netAmount)}</td>
                  <td class="r">${fmtN(z.inv.receivedAmount)}</td>
                  <td class="r">${fmtN(f)}</td>
                  <td class="r"><input type="number" step="0.01" min="0" max="${f}" class="finance-input" style="width:140px;text-align:right" data-rcmval="${idx}" value="${z.val}"></td>
                  <td class="r" data-rcmrest="${idx}">—</td>
                </tr>`;
              })
              .join("")}
          </tbody>
          <tfoot>
            <tr class="f0-tot">
              <td colspan="8"><b>Total do recibo (${esc(cur)})</b></td>
              <td class="r"><b id="rcmTotal">${fmtN(lines.reduce((s, z) => s + z.val, 0))}</b></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>`,
    onRender: ({ panel }) => {
      panel.addEventListener("input", (e) => {
        const inp = e.target.closest("[data-rcmval]");
        if (!inp) return;
        const idx = Number(inp.dataset.rcmval);
        lines[idx].val = Math.round((Number(inp.value) || 0) * 100) / 100;
        const rest = Math.round((num(lines[idx].inv.missingAmount) - lines[idx].val) * 100) / 100;
        const cell = panel.querySelector(`[data-rcmrest="${idx}"]`);
        if (cell) cell.textContent = rest > 0.5 ? fmtN(rest) : "—";
        const tot = lines.reduce((s, z) => s + (z.val > 0 ? z.val : 0), 0);
        panel.querySelector("#rcmTotal").textContent = fmtN(tot);
      });
    },
    onPrimary: async ({ panel, btn, close }) => {
      const receivedDate = panel.querySelector("#rcmDate")?.value;
      const cardSel = panel.querySelector("#rcmCard");
      const reference = panel.querySelector("#rcmRef")?.value?.trim();
      if (!receivedDate) return toast("Indique a data do recebimento.", { type: "error" });
      if (!cardSel?.value && state.cards.length) return toast("Escolha a conta onde entrou o valor.", { type: "error" });
      if (!reference) return toast("Indique o n.º do recibo ou referência.", { type: "error" });
      const validLines = lines.filter((z) => z.val > 0);
      if (!validLines.length) return toast("Indique um valor recebido maior que zero.", { type: "error" });
      for (const z of validLines) {
        if (z.val > num(z.inv.missingAmount) + 0.5) {
          return toast(`${z.inv.docNumber}: valor recebido maior do que falta.`, { type: "error" });
        }
      }
      setButtonLoading(btn, true);
      try {
        const res = await apiRequest("/finance/invoices/bulk-receipts", {
          method: "POST",
          body: {
            receivedDate,
            cardId: cardSel?.value || null,
            cardLabel: cardSel?.selectedOptions?.[0]?.dataset?.label || null,
            reference,
            lines: validLines.map((z) => ({ invoiceId: z.inv.id, amount: z.val })),
          },
        });
        toast(`Recibo ${reference} registado em ${res.count} fatura(s).`, { type: "success" });
        state.selected.clear();
        close();
        await loadInvoices();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err?.data?.message || err.message || "Falha ao registar recibo único.", { type: "error" });
      }
    },
  });
}

function renderTable() {
  const wrap = document.getElementById("invoiceTable");
  if (!wrap) return;
  const showPrev = state.filters.status === "prev" || state.filters.type === "PREV";
  if (showPrev) {
    renderBulkReceiptBar([]);
    return renderForecastTable(wrap);
  }
  const items = visibleItems();
  renderBulkReceiptBar(items);
  const count = document.getElementById("invCount");
  if (count) {
    const falta = porMoeda(items, (i) => i.missingAmount);
    const totLiq = porMoeda(items, totalLiquidarOf);
    count.innerHTML = `<span class="fx2-mut">${items.length} fatura(s) na lista · total a liquidar <b>${moedasHtml(totLiq)}</b> · em falta <b>${moedasHtml(falta)}</b></span>`;
  }

  if (!items.length) {
    wrap.innerHTML = `
      <div class="finance-empty">
        ${state.items.length ? "Nenhuma fatura corresponde aos filtros." : "Ainda não há faturas registadas."}
      </div>`;
    return;
  }

  const editable = canEdit();
  const fmtN = (v) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const selectableItems = items.filter((i) => num(i.missingAmount) > 0.5);
  const allChecked = selectableItems.length > 0 && selectableItems.every((i) => state.selected.has(i.id));

  const rows = items
    .map((inv) => {
      const cur = inv.project?.currency || "AOA";
      const open = state.expanded.has(inv.id);
      const canSel = editable && num(inv.missingAmount) > 0.5;
      const tl = totalLiquidarOf(inv);
      const falta = num(inv.missingAmount);
      const wp = inv.workPercent !== null && inv.workPercent !== undefined ? `${Number(inv.workPercent).toFixed(1)}%` : "—";
      const cp = inv.cumWorkPercent !== null && inv.cumWorkPercent !== undefined ? `${Number(inv.cumWorkPercent).toFixed(1)}%` : null;
      const hasDoc = invoiceHasDocument(inv);
      return `
      <tr data-id="${esc(inv.id)}" class="fcp-row ${inv.status === "ATRASADO" ? "is-late" : ""}">
        <td data-stop>${canSel ? `<input type="checkbox" data-invsel="${esc(inv.id)}"${state.selected.has(inv.id) ? " checked" : ""} title="Selecionar para Recibo Único">` : ""}</td>
        <td>
          <b style="color:#1a8a5a">${esc(inv.docNumber || "Sem n.º")}</b>
          ${inv.invoiceType ? ` <span class="fcp-docpill">${esc(inv.invoiceType)}</span>` : ""}
          ${inv.scanSource === "IA" ? ` <span class="fcp-docpill" title="Lida com IA">IA</span>` : ""}
        </td>
        <td class="fx2-mut">${esc(inv.measurement?.reportNumber || "—")}</td>
        <td>
          <div><b>${esc(inv.client?.name || inv.project?.client?.name || "—")}</b></div>
          <div class="fx2-mut" style="font-size:11.5px">${esc([inv.project?.referencia || inv.project?.code, inv.project?.name].filter(Boolean).join(" · ") || "—")}</div>
        </td>
        <td>${esc(formatDateOnly(inv.docDate))}</td>
        <td>
          <div>${esc(formatDateOnly(inv.dueDate || inv.effectiveDueDate))}</div>
          ${dueChip(inv)}
        </td>
        <td class="r fx2-mut">${esc(cp ? `${wp} · ${cp}` : wp)}</td>
        <td class="r">${fmtN(inv.grossAmount)}</td>
        <td class="r">${inv.flagVatCativo ? '<span class="fx2-mut" title="IVA cativo">cativo</span>' : fmtN(inv.vatAmount)}</td>
        <td class="r">${num(inv.carInsuranceAmount) ? fmtN(inv.carInsuranceAmount) : "—"}</td>
        <td class="r">${num(inv.guaranteeAmount) ? fmtN(inv.guaranteeAmount) : "—"}</td>
        <td class="r" title="Ilíquido + IVA − seguro − garantia (antes da retenção na fonte)"><b>${fmtN(tl)}</b></td>
        <td class="r">${num(inv.withholdingAmount) ? fmtN(inv.withholdingAmount) : "—"}</td>
        <td class="r" title="Total a liquidar − retenção na fonte"><b>${fmtN(inv.netAmount)}</b>${cur !== "AOA" ? ` <small class="fx2-mut">${esc(cur)}</small>` : ""}</td>
        <td class="r fcal-in">${num(inv.receivedAmount) ? fmtN(inv.receivedAmount) : "—"}</td>
        <td class="r ${falta > 0.5 ? "f0-neg" : ""}"><b>${falta > 0.5 ? fmtN(falta) : "—"}</b></td>
        <td data-stop style="white-space:nowrap">
          <div class="fin-actions">
            ${
              hasDoc
                ? `<button type="button" class="fcp-doc ok" title="Ver fatura física" data-action="document">✓</button>`
                : `<span class="fcp-doc miss" title="Fatura sem PDF anexado">!</span>`
            }
            ${
              editable
                ? `${
                    falta > 0.5
                      ? `<button type="button" class="fin-icon-btn fin-icon-btn--emerald" title="Registar recebimento" data-action="receipt">
                           <span class="material-symbols-outlined" style="font-size:16px">payments</span>
                         </button>`
                      : ""
                  }
                   <button type="button" class="fin-icon-btn fin-icon-btn--blue" title="Editar" data-action="edit">
                     <span class="material-symbols-outlined" style="font-size:16px">edit</span>
                   </button>
                   <button type="button" class="fin-icon-btn fin-icon-btn--red" title="Eliminar" data-action="delete">
                     <span class="material-symbols-outlined" style="font-size:16px">delete</span>
                   </button>`
                : ""
            }
          </div>
        </td>
      </tr>
      <tr class="fin-subrow" ${open ? "" : "hidden"}>
        <td colspan="17">${detailRow(inv, cur)}</td>
      </tr>`;
    })
    .join("");

  const sum = (fn) => items.reduce((a, i) => a + num(typeof fn === "function" ? fn(i) : i[fn]), 0);
  wrap.innerHTML = `
    <table class="fx2-t fcp-table">
      <thead>
        <tr>
          <th style="width:26px">${editable && selectableItems.length ? `<input type="checkbox" id="invSelAll"${allChecked ? " checked" : ""} title="Selecionar todas em aberto">` : ""}</th>
          <th>Fatura</th>
          <th>Auto</th>
          <th>Cliente / Obra</th>
          <th>Emissão</th>
          <th>Vencimento</th>
          <th class="r">% Obra<br><small style="font-weight:400">fat. · acum.</small></th>
          <th class="r">V. Ilíquido</th>
          <th class="r">IVA</th>
          <th class="r">Seguro</th>
          <th class="r">Garantia</th>
          <th class="r" title="Ilíquido + IVA − seguro − garantia (antes da retenção na fonte)">Total a Liquidar</th>
          <th class="r">Retenção</th>
          <th class="r" title="Total a liquidar − retenção na fonte">V. a Receber</th>
          <th class="r">Recebido</th>
          <th class="r" title="O que ainda falta receber (já sem a retenção)">Em Falta</th>
          <th>Docs</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr class="f0-tot">
          <td colspan="7">Totais (${items.length} fatura${items.length === 1 ? "" : "s"})</td>
          <td class="r">${fmtN(sum("grossAmount"))}</td>
          <td class="r">${fmtN(sum((i) => (i.flagVatCativo ? 0 : i.vatAmount)))}</td>
          <td class="r">${fmtN(sum("carInsuranceAmount"))}</td>
          <td class="r">${fmtN(sum("guaranteeAmount"))}</td>
          <td class="r"><b>${fmtN(sum(totalLiquidarOf))}</b></td>
          <td class="r">${fmtN(sum("withholdingAmount"))}</td>
          <td class="r"><b>${fmtN(sum("netAmount"))}</b></td>
          <td class="r">${fmtN(sum("receivedAmount"))}</td>
          <td class="r"><b>${fmtN(sum("missingAmount"))}</b></td>
          <td></td>
        </tr>
      </tfoot>
    </table>`;

  wrap.querySelector("#invSelAll")?.addEventListener("change", (e) => {
    if (e.target.checked) selectableItems.forEach((i) => state.selected.add(i.id));
    else selectableItems.forEach((i) => state.selected.delete(i.id));
    renderTable();
  });

  wrap.querySelectorAll("[data-invsel]").forEach((chk) => {
    chk.addEventListener("change", (e) => {
      e.stopPropagation();
      if (chk.checked) state.selected.add(chk.dataset.invsel);
      else state.selected.delete(chk.dataset.invsel);
      renderBulkReceiptBar(items);
    });
  });

  wrap.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
    const inv = state.items.find((i) => i.id === tr.dataset.id);
    if (!inv) return;
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button, input, [data-stop]")) return;
      if (state.expanded.has(inv.id)) state.expanded.delete(inv.id);
      else state.expanded.add(inv.id);
      renderTable();
    });
    tr.querySelector('[data-action="edit"]')?.addEventListener("click", () => openInvoiceModal(inv));
    tr.querySelector('[data-action="receipt"]')?.addEventListener("click", () => openReceiptModal(inv, { onSaved: loadInvoices }));
    tr.querySelector('[data-action="delete"]')?.addEventListener("click", () => removeInvoice(inv));
    tr.querySelector('[data-action="document"]')?.addEventListener("click", () =>
      openInvoiceDocumentModal(inv, { context: { projectName: inv.project?.name } })
    );
  });
}

function renderAll() {
  renderFiltros2();
  renderCards();
  renderTable();
}

function renderForecastTable(wrap) {
  const L = forecastVisible();
  const count = document.getElementById("invCount");
  if (count) count.innerHTML = `${L.length} auto(s) sem fatura (aprovados e planeados) · previsto <b>${moedasHtml(porMoeda(L, (a) => a.value, (a) => a.currency))}</b>`;
  if (!L.length) {
    wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Não há autos aprovados por faturar nem autos previstos.</div>`;
    return;
  }
  wrap.innerHTML = `<table class="fin-table inv-table">
    <thead><tr><th>Fatura</th><th>Data do auto</th><th>Tipo</th><th>Obra · Cliente</th><th>Auto</th><th style="text-align:right">Previsto</th><th>Estado</th></tr></thead>
    <tbody>${L.map(
      (a) => `<tr><td><span class="finance-chip finance-chip--blue">PREV</span></td><td>${esc(formatDateOnly(a.reportDate))}</td><td><b>AM</b></td>
        <td><div class="ov-project"><span class="ov-project-name">${esc(a.project?.name || "—")}</span><span class="ov-project-meta">${esc(a.client?.name || a.project?.code || "")}</span></div></td>
        <td>${esc(a.reportNumber || "")}</td><td class="fin-num"><strong>${esc(money(a.value, a.currency))}</strong></td><td>${a.planned ? "Previsto · planeado (R3)" : "Aprovado · por faturar"}</td></tr>`
    ).join("")}</tbody></table>`;
}

/* ─── Carregamento ────────────────────────────────────────────────────────── */

async function loadOptions() {
  const [projects, clients, cards] = await Promise.all([
    apiRequest("/finance/options/projects"),
    apiRequest("/finance/options/clients"),
    apiRequest("/finance/options/cards").catch(() => ({ items: [] })),
  ]);
  state.projects = projects.items || [];
  state.clients = clients.items || [];
  state.cards = (cards.items || []).filter((c) => c.active !== false);
}

async function loadInvoices() {
  const wrap = document.getElementById("invoiceTable");
  if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">A carregar faturas…</div>`;
  const params = new URLSearchParams();
  // O estado filtra-se localmente (faixa de estados), o resto no servidor.
  ["month", "clientId", "projectId"].forEach((k) => {
    if (state.filters[k]) params.set(k, state.filters[k]);
  });
  try {
    const data = await apiRequest(`/finance/invoices?${params.toString()}`);
    state.items = data.items || [];
    state.totals = data.totals || null;
    state.forecast = data.forecast || [];
    state.receivedThisMonth = data.receivedThisMonth || {};
    renderAll();
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="ov-empty ov-empty--lg">Falha ao carregar faturas: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar faturas.", { type: "error" });
  }
}

/* ─── Formulário de fatura ────────────────────────────────────────────────── */

function buildPreview(draft) {
  const g = Number(draft.grossAmount) || 0;
  const vat = draft.flagVatCativo ? 0 : (g * (Number(draft.vatPercent) || 0)) / 100;
  const withholding = (g * (Number(draft.withholdingPercent) || 0)) / 100;
  const car = (g * (Number(draft.carPercent) || 0)) / 100;
  const guarantee = (g * (Number(draft.guaranteePercent) || 0)) / 100;
  const net = g + vat - withholding - car - guarantee;
  const totalLiquidar = g + vat - car - guarantee;
  const budget = Number(draft.saleBudget) || 0;
  const workPercent = budget > 0 ? (g / budget) * 100 : null;
  return { gross: g, vat, withholding, car, guarantee, totalLiquidar, net, workPercent };
}

/** Resumo legível do que a IA leu, para o financeiro confirmar antes de gravar. */
function buildScanSummary(fields, warnings) {
  const parts = [];
  if (fields.docNumber) parts.push(`Nº ${fields.docNumber}`);
  if (fields.docDate) parts.push(`Data ${fields.docDate}`);
  if (fields.supplierName) parts.push(`Fornecedor ${fields.supplierName}`);
  if (fields.supplierNif) parts.push(`NIF ${fields.supplierNif}`);
  if (fields.documentType) parts.push(fields.documentType.replace(/_/g, " "));
  if (fields.confidence != null) parts.push(`confiança ${fields.confidence}%`);
  const summary = parts.join(" · ");
  const list = warnings?.length ? ` A confirmar: ${warnings.join(" ")}` : "";
  return `${summary || "Campos lidos preenchidos abaixo."}${list} Revise e corrija antes de guardar.`;
}

/**
 * Lê o PDF/fotografia da fatura com IA e devolve os campos sugeridos.
 * Devolve também o `File` para ser anexado depois de a fatura existir.
 */
async function scanInvoiceFile(file) {
  const data = await apiUpload("/finance/invoices/scan", { file, fieldName: "file" });
  return { fields: data.fields || {}, warnings: data.warnings || [] };
}

async function lookupScannedInvoiceNif(fields, noteEl, scanSummary) {
  const nif = String(fields.clientNif || fields.supplierNif || "").replace(/\D/g, "");
  if (nif.length < 9) return;
  const party = fields.clientNif ? "destinatário" : "emitente";
  noteEl.textContent = `${scanSummary} A confirmar o NIF do ${party} no Portal da AGT…`;
  try {
    const result = await apiRequest("/finance/invoices/lookup-nif", {
      method: "POST",
      body: { nif },
    });
    const agt = result?.data || {};
    const companyDetails = [agt.nome, agt.tipo, agt.estado, agt.regimeIva]
      .filter(Boolean)
      .join(" · ");
    noteEl.textContent = result?.found && companyDetails
      ? `${scanSummary} Dados AGT (${nif}): ${companyDetails}.`
      : `${scanSummary} A AGT não encontrou dados para o NIF ${nif}.`;
  } catch (error) {
    noteEl.textContent = `${scanSummary} Não foi possível confirmar o NIF na AGT: ${error.message || "serviço indisponível"}`;
  }
}

/** Linha de dedução/imposto: % editável e o valor calculado automaticamente. */
function deductionRowHtml({ id, label, value, hint, sign = "−", extra = "" }) {
  return `
    <div class="inv-ded-row">
      <div class="inv-ded-label">
        <span>${esc(label)}</span>
        <small>${esc(hint)}</small>
      </div>
      <div class="inv-pct-input">
        <input id="${id}" class="finance-input" type="number" min="0" max="100" step="0.01" value="${esc(value)}" />
        <span>%</span>
      </div>
      <div class="inv-ded-amount" id="${id}_amount">${sign} —</div>
      ${extra}
    </div>`;
}

function stepTitle(n, title, sub = "") {
  return `
    <div class="inv-step">
      <span class="inv-step-n">${n}</span>
      <div>
        <p class="inv-step-title">${esc(title)}</p>
        ${sub ? `<p class="inv-step-sub">${esc(sub)}</p>` : ""}
      </div>
    </div>`;
}

const AREAS_NEGOCIO = [
  ["PROJ", "Projeto de Eletrificação"],
  ["MANUT", "Manutenção Preventiva / Corretiva"],
  ["VENDA", "Venda de Produtos"],
  ["OUT", "Outros"],
];

function inferAreaFromProject(p) {
  const t = String(p?.projectType || "").toUpperCase();
  if (!t) return "";
  if (t.includes("MANUT")) return "MANUT";
  if (t.includes("VENDA") || t.includes("PROD")) return "VENDA";
  if (t.includes("ELETR") || t.includes("PROJ") || t.includes("OBRA") || t.includes("TENSAO") || t.includes("TENSÃO")) return "PROJ";
  return "OUT";
}

function daysBetweenDates(fromKey, toKeyStr) {
  if (!fromKey || !toKeyStr) return "";
  const a = new Date(`${fromKey}T00:00:00Z`);
  const b = new Date(`${toKeyStr}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  return Math.round((b - a) / 86400000);
}

async function openInvoiceModal(invoice, { file = null } = {}) {
  const isEdit = Boolean(invoice);
  const hasDoc = invoiceHasDocument(invoice);
  const aiReady = state.ai.configured;
  lastScan = null;
  const today = toDateKey(new Date());
  const initDocDate = invoice?.docDate ? toDateKey(invoice.docDate) : today;
  const initDueDate = invoice?.dueDate ? toDateKey(invoice.dueDate) : addDays(initDocDate, 30);
  const initDias = daysBetweenDates(initDocDate, initDueDate);
  const initProj = projectById(invoice?.projectId || "");
  const initArea = inferAreaFromProject(initProj);
  const initRetPct = isEdit ? pctValue(invoice.withholdingAmount, invoice.grossAmount) : "";
  const initRetSim = isEdit ? (Number(invoice.withholdingAmount) > 0.005 ? "Sim" : "Não") : "";

  const content = `
    <div class="fte-wrap">
      <div class="fte-head-sub">Registo da fatura emitida no programa de faturação certificado</div>

      <section class="fte-scan" id="inv_scanPanel">
        <input id="inv_docFileInput" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden />
        <button id="inv_pickBtn" type="button" class="finance-btn finance-btn--primary">📄 Ler a Fatura do PDF</button>
        <button id="inv_scanBtn" type="button" class="finance-btn finance-btn--sm" ${aiReady ? "" : "disabled"} style="display:none">✨ Ler com IA</button>
        <span class="fte-scan-txt" id="inv_docNote">${
          aiReady
            ? "Escolha o PDF da fatura (xSoft): o sistema lê o n.º, a data, o cliente, o NIF e os valores; só corrige o que não estiver certo."
            : `${esc(aiUnavailableText())} Anexe o PDF da fatura e preencha os campos abaixo.`
        }</span>
        ${
          hasDoc
            ? `<button id="inv_viewDoc" type="button" class="finance-btn finance-btn--sm" title="Ver fatura física">👁 Ver PDF</button>
               <button id="inv_removeDoc" type="button" class="finance-btn finance-btn--sm" title="Remover documento">✕</button>`
            : ""
        }
      </section>

      <section class="fxsec">
        <div class="fxg">
          <label class="w2">
            <span>Área de negócio</span>
            <select id="inv_areaNeg" class="finance-input">
              <option value="">— escolher —</option>
              ${AREAS_NEGOCIO.map(([k, l]) => `<option value="${k}"${initArea === k ? " selected" : ""}>${esc(l)}</option>`).join("")}
            </select>
          </label>
          <label class="w2">
            <span>Tipo de fatura</span>
            <select id="inv_type" class="finance-input">
              <option value="">— escolher —</option>
              ${TIPOS.map(([k, l]) => `<option value="${k}"${(invoice?.invoiceType || "") === k ? " selected" : ""}>${k} — ${esc(l)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div id="inv_tipoHint" class="fx2-mut t3-small">Autos de Medição (AM): a fatura inclui autos aprovados da obra. Fatura Única (FU): sem autos (manutenção, serviço, pagamento por % do serviço…).</div>
      </section>

      <section class="fxsec">
        <div class="fxg">
          <label>
            <span>N.º da fatura <b class="rq">*</b></span>
            <input id="inv_docNumber" class="finance-input" type="text" placeholder="ex.: FT MBT2026/123" value="${esc(invoice?.docNumber || "")}" />
          </label>
          <label>
            <span>Data de emissão <b class="rq">*</b></span>
            <input id="inv_docDate" class="finance-input" type="date" required value="${esc(initDocDate)}" />
          </label>
          <label>
            <span style="display:flex;justify-content:space-between;gap:6px">
              <span>Cliente</span>
              ${!isEdit ? `<a href="/registos/terceiros" target="_blank" rel="noopener" class="t3-lnk" style="font-weight:400">+ Criar novo cliente</a>` : ""}
            </span>
            <input id="inv_client" class="finance-input" type="text" value="${esc(invoice?.client?.name || initProj?.clientName || "")}" readonly placeholder="Associado à obra" style="background:#f8fafc" />
          </label>
          <label>
            <span>NIF do cliente</span>
            <input id="inv_nif" class="finance-input" type="text" placeholder="ex.: 5000123456" value="" />
          </label>
          <label class="w2">
            <span style="display:flex;justify-content:space-between;gap:6px">
              <span>Obra / Serviço <b class="rq">*</b></span>
              ${!isEdit ? `<span style="display:flex;gap:8px;font-weight:400"><a href="/registos/obras" target="_blank" rel="noopener" class="t3-lnk">+ Nova obra / serviço</a> <button type="button" id="inv_refreshOpts" class="t3-lnk" style="border:0;background:none;cursor:pointer;padding:0" title="Atualizar lista de obras e clientes">⟳</button></span>` : ""}
            </span>
            <select id="inv_project" class="finance-select" required ${isEdit ? "disabled" : ""}>
              <option value="">— escolher —</option>
              ${state.projects
                .map((p) => `<option value="${esc(p.id)}" ${invoice?.projectId === p.id ? "selected" : ""}>${esc([p.referencia || p.code, p.name].filter(Boolean).join(" · "))}</option>`)
                .join("")}
            </select>
          </label>
          <label class="w2">
            <span>Descrição / auto</span>
            <input id="inv_descAuto" class="finance-input" type="text" placeholder="ex.: Auto #1 ou descrição da fatura" value="${esc(invoice?.measurement ? `Auto ${invoice.measurement.reportNumber}` : "")}" />
          </label>
        </div>

        <div id="inv_amWrap" style="margin-top:4px">
          <input id="inv_measurement" type="hidden" value="${esc(invoice?.measurementId || "")}" />
          <div id="inv_amList" class="inv-am-list">
            ${
              isEdit
                ? `<div class="inv-am inv-am--static">
                     <span class="material-symbols-outlined">${invoice.measurement ? "fact_check" : "remove"}</span>
                     <span>${esc(invoice.measurement ? `Auto ${invoice.measurement.reportNumber || "AM"} · ${formatDateOnly(invoice.measurement.reportDate)}` : "Sem auto de medição associado")}</span>
                   </div>`
                : `<p class="inv-am-empty" style="margin:0">Escolha a obra para ver os autos de medição aprovados por faturar.</p>`
            }
          </div>
        </div>
      </section>

      <div class="fte-moe-bar">
        <span>Fatura em <b id="inv_currencyLbl">${esc(invoice?.project?.currency || "AOA")}</b>.</span>
        <div id="inv_context" class="fte-ctx-pills" hidden></div>
      </div>

      <section class="fxsec">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
          <h3>Valores</h3>
          <span class="fx2-mut t3-small">Condições aplicadas pela obra (IVA cativo, retenção na fonte, seguro de construção e garantia).</span>
        </div>

        <div class="fxg">
          <label>
            <span>Valor s/ IVA (<span id="inv_grossCur">${esc(invoice?.project?.currency || "AOA")}</span>) <b class="rq">*</b></span>
            <input id="inv_gross" class="finance-input" type="number" min="0" step="0.01" required placeholder="0,00" value="${invoice ? Number(invoice.grossAmount) : ""}" style="text-align:right;font-weight:600" />
          </label>
          <label>
            <span>IVA %</span>
            <input id="inv_vat" class="finance-input" type="number" min="0" max="100" step="0.01" value="${esc(isEdit ? pctValue(invoice.vatAmount, invoice.grossAmount) : 14)}" />
          </label>
          <label>
            <span>Prazo de pagamento (dias)</span>
            <input id="inv_dias" class="finance-input" type="number" min="0" step="1" value="${esc(initDias === "" ? 30 : initDias)}" />
          </label>
          <label>
            <span>Vencimento / receção prevista <b class="rq">*</b></span>
            <input id="inv_dueDate" class="finance-input" type="date" value="${esc(initDueDate)}" />
          </label>
        </div>

        <div class="fxg">
          <label>
            <span>Tem retenção na fonte? <b class="rq">*</b></span>
            <select id="inv_retSim" class="finance-input">
              <option value=""${initRetSim === "" ? " selected" : ""}>— escolher —</option>
              <option value="Sim"${initRetSim === "Sim" ? " selected" : ""}>Sim</option>
              <option value="Não"${initRetSim === "Não" ? " selected" : ""}>Não</option>
            </select>
          </label>
          <label id="inv_retPctWrap"${initRetSim === "Não" || initRetSim === "" ? ' style="display:none"' : ""}>
            <span>Retenção na fonte %</span>
            <input id="inv_withholding" class="finance-input" type="number" min="0" max="100" step="0.01" value="${esc(initRetPct === "" ? 6.5 : initRetPct)}" />
          </label>
          <label>
            <span>IVA cativo</span>
            <select id="inv_vatCativo" class="finance-input">
              <option value="0"${!invoice?.flagVatCativo ? " selected" : ""}>Não</option>
              <option value="100"${invoice?.flagVatCativo ? " selected" : ""}>Sim</option>
            </select>
          </label>
          <label>
            <span>Seguro de construção %</span>
            <input id="inv_car" class="finance-input" type="number" min="0" max="100" step="0.01" value="${esc(isEdit ? pctValue(invoice.carInsuranceAmount, invoice.grossAmount) : 0)}" />
          </label>
          <label>
            <span>Garantia retida %</span>
            <input id="inv_guarantee" class="finance-input" type="number" min="0" max="100" step="0.01" value="${esc(isEdit ? pctValue(invoice.guaranteeAmount, invoice.grossAmount) : 0)}" />
          </label>
        </div>

        <div class="fxg" id="inv_pctServRow">
          <label>
            <span>% desta fatura no serviço</span>
            <input id="inv_pctServ" class="finance-input" type="number" min="0" max="100" step="any" placeholder="ex.: 60" value="" />
            <small class="muted">ex.: 60% agora e 40% depois</small>
          </label>
          <div style="grid-column:span 3;display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap">
            <div class="inv-quick" id="inv_dueQuick" style="margin:0">
              ${[30, 60, 90].map((d) => `<button type="button" data-days="${d}">+${d} dias</button>`).join("")}
            </div>
            <button id="inv_saveConfig" type="button" class="inv-link-btn" style="margin:0">
              <span class="material-symbols-outlined">save</span>Guardar estas % na obra
            </button>
          </div>
        </div>

        <div class="fxtot" id="fteTot">
          <span>Total da fatura <b id="pv_totalFat">—</b></span>
          <span class="fx2-mut" id="pv_vat">(IVA —)</span>
          <span id="pv_carWrap" style="display:none">Seguro <b id="pv_car" class="ov-neg">—</b></span>
          <span id="pv_garWrap" style="display:none">Garantia <b id="pv_guarantee" class="ov-neg">—</b></span>
          <span id="pv_liqWrap" style="display:none">Total a liquidar <b id="pv_liquidar">—</b></span>
          <span id="pv_retWrap" style="display:none">Retenção <b id="pv_withholding" class="ov-neg">—</b></span>
          <span class="fte-tot-net">A receber <b id="pv_net">—</b></span>
        </div>

        <div class="fte-work-row">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:240px">
            <span>% da obra: <strong id="pv_work">—</strong></span>
            <div id="pv_workBar" style="flex:1;max-width:220px"></div>
            <span id="pv_workNote" class="fx2-mut">Escolha a obra para comparar com a venda prevista.</span>
          </div>
          <span id="pv_warning" class="nvft-err" hidden></span>
        </div>
      </section>

      <section class="fxsec">
        <div class="fxslot">
          <span><b>PDF da fatura</b></span>
          <span class="fxslot-name" id="inv_docFile">${hasDoc ? esc(invoice.documentName || "Documento anexado") : "sem ficheiro"}</span>
          <button type="button" class="finance-btn finance-btn--sm" id="inv_pickBtn2">Anexar</button>
        </div>

        ${
          !isEdit
            ? `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:2px">
                <span class="t3-small"><b>Recebimento:</b></span>
                <div class="finance-choice-grid" id="rcv_choice" style="display:flex;gap:8px;flex:1">
                  <button type="button" class="finance-choice active" data-mode="aberto" style="padding:6px 10px">
                    <span><span class="finance-choice-title" style="font-size:12.5px">Fica em aberto</span></span>
                  </button>
                  <button type="button" class="finance-choice" data-mode="recebido" style="padding:6px 10px">
                    <span><span class="finance-choice-title" style="font-size:12.5px">Já recebi do cliente</span></span>
                  </button>
                </div>
                <span class="t3-small fx2-mut">Recebido: <b id="rcv_sum_received">—</b> · Falta: <b id="rcv_sum_missing">—</b></span>
              </div>
              <div id="rcv_fields" class="fxg" hidden>
                <label><span>Data recebimento</span><input id="inv_receivedDate" class="finance-input" type="date" value="${esc(today)}" /></label>
                <label><span>Valor recebido</span><input id="inv_received" class="finance-input" type="number" min="0" step="0.01" value="0" /></label>
                <label class="w2"><span>Meio de pagamento</span>
                  <select id="inv_receivedMethod" class="finance-select">
                    <option value="">—</option>
                    ${RECEIPT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join("")}
                  </select>
                </label>
              </div>`
            : `<p class="fx2-mut t3-small" style="margin:0">Os recebimentos desta fatura registam-se na lista, com o botão «Registar recebimento» (já recebido: <b>${esc(money(invoice.receivedAmount, invoice.project?.currency || "AOA"))}</b>).</p>`
        }

        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#334155;font-weight:500">
          <span>Observações</span>
          <textarea id="inv_notes" class="finance-textarea" rows="2" placeholder="Observações, referência ao auto de medição ou condições…">${esc(invoice?.notes || "")}</textarea>
        </label>
      </section>
    </div>`;

  openModal({
    title: isEdit ? `<span class="rg-kick">FATURA EMITIDA</span><br>Editar fatura ${esc(invoice.docNumber || "")}` : `<span class="rg-kick">NOVA FATURA EMITIDA</span><br>Registar fatura emitida`,
    contentHtml: content,
    primaryLabel: isEdit ? "Guardar alterações" : "Gravar",
    secondaryLabel: "Cancelar",
    width: 980,
    onRender: ({ panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const projectSel = $("inv_project");
      const amHidden = $("inv_measurement");
      const amList = $("inv_amList");
      let currentProject = projectById(invoice?.projectId || projectSel.value) || null;

      const cur = () => currentProject?.currency || invoice?.project?.currency || "AOA";

      const rcvChoice = $("rcv_choice");
      const rcvFields = $("rcv_fields");
      const rcvAmount = $("inv_received");
      const rcvDate = $("inv_receivedDate");
      const rcvMethod = $("inv_receivedMethod");
      let rcvMode = isEdit ? "recebido" : "aberto";

      const isVatCativo = () => $("inv_vatCativo").value === "100";
      const retPctEffective = () => ($("inv_retSim").value === "Sim" ? Number($("inv_withholding").value) || 0 : 0);

      const draftPreview = () =>
        buildPreview({
          grossAmount: $("inv_gross").value,
          vatPercent: $("inv_vat").value,
          withholdingPercent: retPctEffective(),
          carPercent: $("inv_car").value,
          guaranteePercent: $("inv_guarantee").value,
          flagVatCativo: isVatCativo(),
          saleBudget: currentProject?.saleBudget ?? currentProject?.budgetTotal,
        });

      function refreshReceipt() {
        if (isEdit) return;
        const pv = draftPreview();
        rcvChoice?.querySelectorAll(".finance-choice").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.mode === rcvMode);
        });
        const paying = rcvMode === "recebido";
        if (rcvFields) rcvFields.hidden = !paying;
        if (rcvAmount) rcvAmount.disabled = !paying;
        if (rcvDate) rcvDate.disabled = !paying;
        if (rcvMethod) rcvMethod.disabled = !paying;
        if (paying && Number(rcvAmount?.value || 0) === 0 && pv.net > 0) {
          rcvAmount.value = pv.net.toFixed(2);
        }
        const received = rcvMode === "recebido" ? Number(rcvAmount?.value) || 0 : 0;
        if ($("rcv_sum_received")) $("rcv_sum_received").textContent = money(received, cur());
        if ($("rcv_sum_missing")) $("rcv_sum_missing").textContent = money(Math.max(pv.net - received, 0), cur());
      }

      const refreshPreview = () => {
        const pv = draftPreview();
        const c = cur();
        const cativo = isVatCativo();
        const totalFat = pv.gross + pv.vat;

        $("inv_retPctWrap").style.display = $("inv_retSim").value === "Sim" ? "" : "none";
        $("inv_vat").disabled = cativo;
        $("inv_grossCur").textContent = c;
        $("inv_currencyLbl").textContent = c;

        $("pv_totalFat").textContent = money(totalFat, c);
        $("pv_vat").textContent = cativo ? "(IVA cativo)" : `(IVA ${money(pv.vat, c)})`;

        $("pv_carWrap").style.display = pv.car > 0.005 ? "" : "none";
        $("pv_car").textContent = `−${money(pv.car, c)}`;

        $("pv_garWrap").style.display = pv.guarantee > 0.005 ? "" : "none";
        $("pv_guarantee").textContent = `−${money(pv.guarantee, c)}`;

        $("pv_liqWrap").style.display = pv.car > 0.005 || pv.guarantee > 0.005 ? "" : "none";
        $("pv_liquidar").textContent = money(pv.totalLiquidar, c);

        $("pv_retWrap").style.display = pv.withholding > 0.005 ? "" : "none";
        $("pv_withholding").textContent = `−${money(pv.withholding, c)}`;

        $("pv_net").textContent = money(pv.net, c);

        const sale = Number(currentProject?.saleBudget ?? currentProject?.budgetTotal) || 0;
        const already = Math.max((Number(currentProject?.alreadyBilled) || 0) - (isEdit ? Number(invoice.grossAmount) || 0 : 0), 0);
        const warning = $("pv_warning");
        if (sale > 0) {
          const alreadyPct = (already / sale) * 100;
          const thisPct = (pv.gross / sale) * 100;
          $("pv_work").textContent = `${thisPct.toFixed(2)}%`;
          $("pv_workBar").innerHTML = meterHtml([
            { value: alreadyPct, tone: "blue" },
            { value: thisPct, tone: "violet" },
          ]);
          $("pv_workNote").textContent = `Já faturado ${alreadyPct.toFixed(1)}% · Venda ${compact(sale)}`;
          const over = already + pv.gross - sale;
          warning.hidden = over <= 0.005;
          if (over > 0.005) warning.textContent = `Excede a venda prevista em ${money(over, c)}.`;
        } else {
          $("pv_work").textContent = "—";
          $("pv_workBar").innerHTML = "";
          $("pv_workNote").textContent = currentProject ? "Sem venda prevista na obra." : "Escolha a obra para comparar com a venda prevista.";
          warning.hidden = true;
        }
        refreshReceipt();
      };

      rcvChoice?.querySelectorAll(".finance-choice").forEach((btn) => {
        btn.addEventListener("click", () => {
          rcvMode = btn.dataset.mode;
          if (rcvMode === "aberto" && rcvAmount) rcvAmount.value = 0;
          refreshPreview();
          if (rcvMode === "recebido") rcvAmount?.focus();
        });
      });

      rcvAmount?.addEventListener("input", () => {
        if (Number(rcvAmount.value) > 0 && rcvMode !== "recebido") rcvMode = "recebido";
        refreshReceipt();
      });

      const applyBillingConfig = (cfg) => {
        if (cfg.billingVatPercent !== null && cfg.billingVatPercent !== undefined) $("inv_vat").value = Number(cfg.billingVatPercent);
        if (cfg.billingWithholdingPercent !== null && cfg.billingWithholdingPercent !== undefined) {
          const wp = Number(cfg.billingWithholdingPercent);
          $("inv_withholding").value = wp;
          if (!$("inv_retSim").value) $("inv_retSim").value = wp > 0 ? "Sim" : "Não";
        }
        if (cfg.billingCarPercent !== null && cfg.billingCarPercent !== undefined) $("inv_car").value = Number(cfg.billingCarPercent);
        if (cfg.billingGuaranteePercent !== null && cfg.billingGuaranteePercent !== undefined) $("inv_guarantee").value = Number(cfg.billingGuaranteePercent);
        $("inv_vatCativo").value = cfg.billingVatCativo ? "100" : "0";
      };

      const renderContext = () => {
        const ctx = $("inv_context");
        if (!currentProject || currentProject.saleBudget === undefined) {
          ctx.hidden = true;
          return;
        }
        const c = cur();
        const hasSale = Number(currentProject.saleBudget) > 0;
        ctx.hidden = false;
        ctx.innerHTML = `
          <span>Venda prevista: <b class="${hasSale ? "" : "ov-warn"}">${hasSale ? esc(money(currentProject.saleBudget, c)) : "Sem venda prevista"}</b></span>
          <span>Já faturado: <b>${esc(money(currentProject.alreadyBilled, c))}</b></span>
          <span>Por faturar: <b class="ov-warn">${hasSale ? esc(money(currentProject.toInvoice, c)) : "—"}</b></span>`;
      };

      const selectAm = (id) => {
        amHidden.value = id || "";
        amList.querySelectorAll("[data-am]").forEach((el) => el.classList.toggle("active", el.dataset.am === (id || "")));
      };

      const renderAmList = (reports) => {
        if (!reports.length) {
          amList.innerHTML = `<p class="inv-am-empty" style="margin:0">Esta obra não tem autos de medição aprovados por faturar. A fatura fica sem AM associado.</p>`;
          amHidden.value = "";
          return;
        }
        amList.innerHTML = [
          `<button type="button" class="inv-am" data-am="">
             <span class="material-symbols-outlined">remove</span>
             <span class="inv-am-text"><strong>Sem AM</strong><small>Fatura avulsa</small></span>
           </button>`,
          ...reports.map(
            (r) => `
            <button type="button" class="inv-am" data-am="${esc(r.id)}" data-num="${esc(r.reportNumber || "AM")}" data-total="${Number(r.periodValTotal) || 0}">
              <span class="material-symbols-outlined">fact_check</span>
              <span class="inv-am-text">
                <strong>${esc(r.reportNumber || "AM")}</strong>
                <small>${esc(formatDateOnly(r.reportDate))}</small>
              </span>
              <span class="inv-am-value">${esc(money(r.periodValTotal, cur()))}</span>
            </button>`
          ),
        ].join("");
        amList.querySelectorAll("[data-am]").forEach((btn) => {
          btn.addEventListener("click", () => {
            selectAm(btn.dataset.am);
            const total = Number(btn.dataset.total || 0);
            if (total > 0) $("inv_gross").value = total;
            if (btn.dataset.am) {
              if (!$("inv_type").value) $("inv_type").value = "AM";
              if (!$("inv_descAuto").value.trim()) $("inv_descAuto").value = `Auto ${btn.dataset.num}`;
            }
            refreshPreview();
          });
        });
        selectAm("");
      };

      const loadProjectContext = async () => {
        const id = projectSel.value || invoice?.projectId;
        currentProject = projectById(id);
        $("inv_client").value = currentProject?.clientName || invoice?.client?.name || "";
        if (currentProject && !$("inv_areaNeg").value) {
          const inf = inferAreaFromProject(currentProject);
          if (inf) $("inv_areaNeg").value = inf;
        }
        if (!id) {
          if (!isEdit) {
            amList.innerHTML = `<p class="inv-am-empty" style="margin:0">Escolha a obra para ver os autos de medição aprovados por faturar.</p>`;
          }
          renderContext();
          refreshPreview();
          return;
        }
        try {
          const [billing, open] = await Promise.all([
            apiRequest(`/finance/projects/${id}/billing`),
            isEdit ? Promise.resolve(null) : apiRequest(`/finance/projects/${id}/open-measurements`),
          ]);
          if (!isEdit) applyBillingConfig(billing.project || {});
          currentProject = { ...(currentProject || {}), ...(billing.project || {}) };
          if (billing.project?.client?.name) $("inv_client").value = billing.project.client.name;
          if (!$("inv_client").value) $("inv_client").placeholder = "Obra sem cliente associado";
          if (open) {
            renderAmList(open.items || []);
            if ((open.items || []).length && $("inv_tipoHint")) {
              $("inv_tipoHint").innerHTML = `<b>Esta obra tem ${open.items.length} auto(s) de medição aprovado(s) por faturar.</b> Selecione-o abaixo ou escolha Fatura Única (FU).`;
            }
          }
        } catch (err) {
          toast(err.message || "Falha ao carregar dados da obra.", { type: "error" });
        }
        renderContext();
        refreshPreview();
      };

      if (isEdit) {
        $("inv_withholding").value = pctValue(invoice.withholdingAmount, invoice.grossAmount);
        $("inv_vat").value = pctValue(invoice.vatAmount, invoice.grossAmount);
        $("inv_car").value = pctValue(invoice.carInsuranceAmount, invoice.grossAmount);
        $("inv_guarantee").value = pctValue(invoice.guaranteeAmount, invoice.grossAmount);
        $("inv_retSim").value = Number(invoice.withholdingAmount) > 0.005 ? "Sim" : "Não";
      }

      $("inv_refreshOpts")?.addEventListener("click", async () => {
        const prev = projectSel.value;
        await loadOptions();
        projectSel.innerHTML =
          `<option value="">— escolher —</option>` +
          state.projects.map((p) => `<option value="${esc(p.id)}"${p.id === prev ? " selected" : ""}>${esc([p.referencia || p.code, p.name].filter(Boolean).join(" · "))}</option>`).join("");
        toast("Lista de obras e clientes atualizada.", { type: "info" });
      });

      projectSel.addEventListener("change", loadProjectContext);
      ["inv_gross", "inv_vat", "inv_withholding", "inv_car", "inv_guarantee"].forEach((id) =>
        $(id).addEventListener("input", refreshPreview)
      );
      $("inv_vatCativo").addEventListener("change", refreshPreview);
      $("inv_retSim").addEventListener("change", () => {
        if ($("inv_retSim").value === "Sim" && Number($("inv_withholding").value) === 0) {
          $("inv_withholding").value = 6.5;
        }
        refreshPreview();
      });

      // Sincronia bidirecional Prazo (dias) <-> Vencimento
      $("inv_dias").addEventListener("input", () => {
        const d = Number($("inv_dias").value);
        const base = $("inv_docDate").value || today;
        if (Number.isFinite(d) && d >= 0 && base) {
          $("inv_dueDate").value = addDays(base, Math.round(d));
        }
      });
      $("inv_docDate").addEventListener("change", () => {
        const d = Number($("inv_dias").value);
        const base = $("inv_docDate").value;
        if (Number.isFinite(d) && d >= 0 && base) {
          $("inv_dueDate").value = addDays(base, Math.round(d));
        }
      });
      $("inv_dueDate").addEventListener("change", () => {
        const diff = daysBetweenDates($("inv_docDate").value, $("inv_dueDate").value);
        if (diff !== "" && diff >= 0) $("inv_dias").value = diff;
      });

      $("inv_dueQuick").querySelectorAll("[data-days]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const days = Number(btn.dataset.days);
          const base = $("inv_docDate").value || today;
          $("inv_dias").value = days;
          $("inv_dueDate").value = addDays(base, days);
        });
      });

      $("inv_saveConfig").addEventListener("click", async (e) => {
        const id = projectSel.value || invoice?.projectId;
        if (!id) return toast("Escolha a obra primeiro.", { type: "error" });
        const btn = e.currentTarget;
        setButtonLoading(btn, true);
        try {
          await apiRequest(`/finance/projects/${id}/billing`, {
            method: "PATCH",
            body: {
              billingVatCativo: isVatCativo(),
              billingVatPercent: numOrNull($("inv_vat").value),
              billingWithholdingPercent: retPctEffective(),
              billingCarPercent: numOrNull($("inv_car").value),
              billingGuaranteePercent: numOrNull($("inv_guarantee").value),
            },
          });
          toast("Configuração de faturação guardada na obra.", { type: "success" });
        } catch (err) {
          toast(err.message || "Falha ao guardar configuração.", { type: "error" });
        } finally {
          setButtonLoading(btn, false);
        }
      });

      const docFileInput = $("inv_docFileInput");
      const docFileName = $("inv_docFile");
      const docNote = $("inv_docNote");
      const scanBtn = $("inv_scanBtn");
      const scanPanel = $("inv_scanPanel");

      const setScanState = (mode, html) => {
        if (scanPanel) scanPanel.classList.toggle("is-busy", mode === "busy");
        if (html !== undefined && docNote) docNote.innerHTML = html;
      };

      const runScan = async () => {
        const f = docFileInput?.files?.[0];
        if (!f || !aiReady) return;
        setButtonLoading(scanBtn, true);
        setScanState("busy", `<b>A ler a fatura com IA…</b> os campos lidos são sugeridos e devem ser confirmados.`);
        try {
          const { fields, warnings } = await scanInvoiceFile(f);
          const fill = (id, value, { onlyEmpty = true } = {}) => {
            const el = $(id);
            if (!el) return;
            const isEmpty = value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value));
            if (isEmpty) return;
            if (onlyEmpty && String(el.value ?? "").trim()) return;
            el.value = typeof value === "number" ? String(value) : value;
          };

          fill("inv_docNumber", fields.docNumber);
          fill("inv_docDate", fields.docDate, { onlyEmpty: isEdit });
          fill("inv_dueDate", fields.dueDate);
          fill("inv_nif", fields.clientNif || fields.supplierNif);
          fill("inv_gross", Number(fields.grossAmount) > 0 ? fields.grossAmount : null, { onlyEmpty: isEdit });
          fill("inv_vat", fields.vatPercent ?? pctValue(fields.vatAmount, fields.grossAmount));
          const retP = fields.withholdingPercent ?? pctValue(fields.withholdingAmount, fields.grossAmount);
          if (retP !== null && retP !== undefined && retP !== "") {
            $("inv_withholding").value = retP;
            $("inv_retSim").value = Number(retP) > 0 ? "Sim" : "Não";
          }
          fill("inv_car", pctValue(fields.carInsuranceAmount, fields.grossAmount));
          fill("inv_guarantee", pctValue(fields.guaranteeAmount, fields.grossAmount));
          fill("inv_notes", fields.notes || fields.description, { onlyEmpty: false });

          if (fields.suggestedProjectId && !projectSel.disabled && fields.suggestedProjectId !== projectSel.value) {
            projectSel.value = fields.suggestedProjectId;
            await loadProjectContext();
          }
          refreshPreview();
          lastScan = { source: "IA", model: fields.model || null, raw: fields.raw || null };
          const scanSummary = buildScanSummary(fields, warnings);
          setScanState("ready", `✓ ${esc(scanSummary)}`);
          toast("Fatura lida. Confirme os valores antes de guardar.", { type: "success" });
          void lookupScannedInvoiceNif(fields, docNote, scanSummary);
        } catch (err) {
          setScanState("idle", `⚠ ${esc(err.message || "Falha ao ler a fatura.")}`);
          toast(err.message || "Falha ao ler a fatura.", { type: "error" });
        } finally {
          setButtonLoading(scanBtn, false);
        }
      };

      $("inv_pickBtn")?.addEventListener("click", () => docFileInput?.click());
      $("inv_pickBtn2")?.addEventListener("click", () => docFileInput?.click());
      scanBtn?.addEventListener("click", runScan);

      if (docFileInput) {
        docFileInput.addEventListener("change", () => {
          const picked = docFileInput.files?.[0] || null;
          if (scanBtn) {
            scanBtn.style.display = picked && aiReady ? "" : "none";
            scanBtn.disabled = !picked || !aiReady;
          }
          if (docFileName) {
            docFileName.textContent = picked ? `${picked.name} · ${Math.max(1, Math.round((picked.size || 0) / 1024))} KB` : "sem ficheiro";
          }
          if (picked && aiReady) {
            void runScan();
          } else if (picked) {
            setScanState("ready", `📎 Ficheiro selecionado (${esc(picked.name)}). Preencha os valores e clique em Gravar.`);
          }
        });
      }

      if (file && docFileInput) {
        setTimeout(() => {
          try {
            const dt = new DataTransfer();
            dt.items.add(file);
            docFileInput.files = dt.files;
            docFileInput.dispatchEvent(new Event("change"));
          } catch {
            toast("Escolha o ficheiro no formulário.", { type: "error" });
          }
        }, 0);
      }

      $("inv_viewDoc")?.addEventListener("click", () =>
        openInvoiceDocumentModal(invoice, { context: { projectName: invoice?.project?.name } })
      );

      $("inv_removeDoc")?.addEventListener("click", async (e) => {
        if (!window.confirm("Remover a fatura física anexada a esta fatura?")) return;
        const btn = e.currentTarget;
        setButtonLoading(btn, true);
        try {
          await apiRequest(`/finance/invoices/${invoice.id}/document`, { method: "DELETE" });
          toast("Documento removido.", { type: "success" });
          btn.hidden = true;
          const viewBtn = $("inv_viewDoc");
          if (viewBtn) viewBtn.hidden = true;
          docFileName.textContent = "sem ficheiro";
          docNote.textContent = "Sem fatura física anexada.";
        } catch (err) {
          toast(err.message || "Falha ao remover o documento.", { type: "error" });
        } finally {
          setButtonLoading(btn, false);
        }
      });

      if (projectSel.value || isEdit) loadProjectContext();
      else refreshPreview();
    },
    onPrimary: async ({ btn, close, panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const isVatCat = $("inv_vatCativo").value === "100";
      const retSim = $("inv_retSim").value;
      if (!isEdit && !retSim) {
        $("inv_retSim").focus();
        return toast("Indique se a fatura tem retenção na fonte (Sim ou Não).", { type: "error" });
      }
      const descAuto = $("inv_descAuto").value.trim();
      const nif = $("inv_nif").value.trim();
      const pctServ = $("inv_pctServ").value.trim();
      const obsRaw = $("inv_notes").value.trim();
      const extras = [
        descAuto && !obsRaw.includes(descAuto) ? descAuto : "",
        nif && !obsRaw.includes(nif) ? `NIF ${nif}` : "",
        pctServ ? `${pctServ}% do serviço` : "",
      ].filter(Boolean);
      const notesCombined = [obsRaw, extras.join(" · ")].filter(Boolean).join(obsRaw && extras.length ? "\n" : "") || null;

      const raw = {
        docNumber: $("inv_docNumber").value.trim() || null,
        invoiceType: $("inv_type").value || null,
        docDate: $("inv_docDate").value,
        dueDate: $("inv_dueDate").value || ($("inv_docDate").value ? addDays($("inv_docDate").value, 30) || null : null),
        grossAmount: Number($("inv_gross").value),
        vatPercent: isVatCat ? 0 : numOrNull($("inv_vat").value),
        withholdingPercent: retSim === "Sim" ? numOrNull($("inv_withholding").value) : 0,
        carPercent: numOrNull($("inv_car").value),
        guaranteePercent: numOrNull($("inv_guarantee").value),
        flagVatCativo: isVatCat,
        notes: notesCombined,
      };
      if (!raw.grossAmount || raw.grossAmount <= 0) {
        $("inv_gross").focus();
        return toast("Indique o valor s/ IVA.", { type: "error" });
      }
      if (raw.dueDate && raw.docDate && raw.dueDate < raw.docDate) {
        $("inv_dueDate").focus();
        return toast("O vencimento não pode ser anterior à data de emissão.", { type: "error" });
      }

      const percentageFields = [
        ["vatPercent", "inv_vat", "IVA"],
        ["withholdingPercent", "inv_withholding", "retenção na fonte"],
        ["carPercent", "inv_car", "Seguro CAR"],
        ["guaranteePercent", "inv_guarantee", "garantia"],
      ];
      const invalidPercent = percentageFields.find(([key]) => raw[key] !== null && (raw[key] < 0 || raw[key] > 100));
      if (invalidPercent) {
        const [, inputId, label] = invalidPercent;
        $(inputId)?.focus();
        return toast(`${label}: indique uma percentagem entre 0% e 100%.`, { type: "error" });
      }

      setButtonLoading(btn, true);
      try {
        const pickedFile = $("inv_docFileInput")?.files?.[0] || null;
        const receivedAmount =
          $("rcv_choice")?.querySelector(".finance-choice.active")?.dataset.mode === "recebido"
            ? numOrNull($("inv_received")?.value) || 0
            : 0;
        let targetId = invoice?.id || null;
        let result = null;

        if (isEdit) {
          result = await apiRequest(`/finance/invoices/${invoice.id}`, { method: "PATCH", body: raw });
          toast("Fatura atualizada.", { type: "success" });
        } else {
          const projectId = $("inv_project").value;
          if (!projectId) {
            setButtonLoading(btn, false);
            return toast("Selecione a obra / serviço.", { type: "error" });
          }
          result = await apiRequest("/finance/invoices", {
            method: "POST",
            body: {
              ...raw,
              projectId,
              measurementId: $("inv_measurement").value || null,
              receivedAmount,
              receivedDate: receivedAmount > 0 ? $("inv_receivedDate").value || null : null,
              receivedMethod: receivedAmount > 0 ? $("inv_receivedMethod").value || null : null,
              scanSource: lastScan?.source || null,
              scanModel: lastScan?.model || null,
              scanRaw: lastScan?.raw || null,
            },
          });
          targetId = result?.invoice?.id || null;
          toast("Fatura registada.", { type: "success" });
        }
        (result?.warnings || []).forEach((w) => toast(w.message, { type: "info", timeoutMs: 7000 }));

        if (pickedFile && targetId) {
          try {
            await apiUpload(`/finance/invoices/${targetId}/document`, { file: pickedFile, fieldName: "file" });
          } catch (err) {
            toast(`Fatura guardada, mas o ficheiro não foi anexado: ${err.message}`, { type: "error" });
          }
        }

        close();
        await loadInvoices();
      } catch (err) {
        toast(err.message || "Falha ao guardar a fatura.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}

function numOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(value) {
  return numOr(value, null);
}

/** Percentagem implícita (valor / base × 100) para pré-encher em edição. */
function pctValue(amount, base) {
  const a = Number(amount) || 0;
  const b = Number(base) || 0;
  if (b <= 0) return "";
  return Math.round((a / b) * 10000) / 100;
}

/* ─── Recebimento ─────────────────────────────────────────────────────────── */

/* ─── Eliminar ────────────────────────────────────────────────────────────── */

async function removeInvoice(invoice) {
  const label = invoice.docNumber || invoice.project?.name || "esta fatura";
  if (!window.confirm(`Eliminar a fatura ${label}? Esta ação não pode ser revertida.`)) return;
  try {
    await apiRequest(`/finance/invoices/${invoice.id}`, { method: "DELETE" });
    toast("Fatura eliminada.", { type: "success" });
    await loadInvoices();
  } catch (err) {
    toast(err.message || "Falha ao eliminar fatura.", { type: "error" });
  }
}

/* ─── Entrada ─────────────────────────────────────────────────────────────── */

function aiUnavailableText() {
  return state.ai?.reason || "Leitura automática indisponível.";
}

async function loadAiStatus() {
  try {
    const ai = await apiRequest("/finance/ai-status");
    state.ai = { configured: Boolean(ai?.configured), model: ai?.model || null, reason: ai?.reason || null, loaded: true };
  } catch {
    state.ai = { configured: false, model: null, reason: null, loaded: true };
  }
}

export async function render() {
  state.expanded = new Set();
  try {
    await Promise.all([loadOptions(), loadAiStatus()]);
  } catch (err) {
    toast(err.message || "Falha ao carregar obras e clientes.", { type: "error" });
  }
  renderShell();
  await loadInvoices();
}
