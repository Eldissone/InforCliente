import { apiRequest, apiUpload, getAssetUrl } from "../../services/api.js";
import { openModal, setButtonLoading, toast } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { can } from "../permissions.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { destroyCharts } from "./charts.js";
import { codigoNoCabecalho } from "./f2Ui.js";
import { num } from "./widgets.js";
import { canPayHere, openPayModal } from "./payModal.js";

/**
 * P1 Centro de Pagamentos — alinhado com o `V.fcp` e `FXDRAW.rpd` do protótipo (v640):
 *  - Filtros na ordem fixa (pesquisa, tipo, conta, estado [Atrasado e Em Aberto primeiro],
 *    pedido por [escolha múltipla], fornecedor, vencimento/emissão/pagamento de…até,
 *    centro de custo, condição) + linha de Pendências (Pagos sem fatura / sem comprovativo);
 *  - 5 cartões KPI clicáveis: Por Pagar · Em Atraso · Vence em 7 Dias · A Crédito · Pago;
 *  - Seleção múltipla com «📎 Anexar comprovativo» único para vários pedidos (v592) e aprovação em lote;
 *  - Tabela de 14 colunas: ☐ · Requisição · Venc. · Tipo · CC · Terceiro / Descrição · Destino ·
 *    Produto · V. a pagar c/IVA s/RF · Estado (com menu rápido + 🏦 resumo bancário) · PP · CP · FT · Util.;
 *  - Ficha do pedido (`rpd`) com itens, documentos (anexar / retirar ×), pagamentos editáveis (✎) e histórico.
 */

const SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

const REQUEST_TYPE_LABEL = {
  SEDE: "Pedido Geral (Sede)",
  GERAL: "Pedido Geral (Sede)",
  OBRA: "Pedido para Obra",
  FROTA: "Frota e Equipamentos",
  IMPOSTOS: "Impostos (PE)",
  PESSOAL: "Pessoal (SL)",
  EMPRESTIMO: "Empréstimo (EMP)",
};

const TERM_LABEL = { PRONTO: "Pronto pagamento", CREDITO: "A crédito", PARCIAL: "Crédito em parcelas" };
const PILL_TONE = { bad: "bad", warn: "warn", good: "good", neutral: "slate" };

const FILTROS0 = {
  q: "",
  tc: "",
  conta: "",
  est: "",
  porM: [],
  forn: "",
  dtRef: "venc",
  de: "",
  ate: "",
  cc: "",
  cond: "",
  semFt: false,
  semCp: false,
  kpi: "",
  filaExtra: "",
};

const S = {
  data: null,
  f: { ...FILTROS0, porM: [] },
  sel: new Set(),
  porOpen: false,
};

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function money(v, cur = "AOA") {
  return formatCurrency(Number(v) || 0, cur);
}

function fmtN(v) {
  return (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

function canPay() {
  return can("financeiro", "edit") || can("financeiro", "approve") || can("financeiro", "manage");
}

function canApproveOrder() {
  return can("pedidosExtras", "approve") || can("financeiro", "approve") || can("financeiro", "edit");
}

function userInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + (parts[1]?.[0] || "") + (parts[parts.length - 1]?.[0] || "")).slice(0, 3).toUpperCase();
}

function cardsList() {
  return (S.data?.balances?.items || []).map((b) => b.card).filter(Boolean);
}

/** Código curto de tipo de pagamento como no protótipo: PF, TRF INT, PE, SL, AD SL, EMP. */
function paymentTypeCode(r) {
  if (!r.isOrder) return r.source === "PEDIDO_EXTRA" ? "PF" : "OUT";
  if (r.paymentMode === "FM") return "TRF INT";
  if (r.requestType === "IMPOSTOS") return "PE";
  if (r.requestType === "EMPRESTIMO") return "EMP";
  if (r.requestType === "PESSOAL") {
    const sub = norm(r.typeData?.sub || "");
    return sub.includes("adiant") ? "AD SL" : "SL";
  }
  return "PF";
}

function ccCodeOf(r) {
  if (r.project) return r.project.referencia || r.project.code || r.project.name || "Obra";
  if (r.requestType === "FROTA") return "CC-FROTA";
  if (r.costCenter?.code || r.costCenter?.name) return r.costCenter.code || r.costCenter.name;
  return "CC-SEDE";
}

function contaLabelOf(r) {
  if (r.typeData?.emTransito?.cardLabel) return r.typeData.emTransito.cardLabel;
  if (r.bankMovements?.length) {
    const c = r.bankMovements[0].card;
    if (c) return [c.bank, c.label].filter(Boolean).join(" ");
  }
  if (r.fund?.name) return r.fund.name;
  if (r.fundName) return r.fundName;
  const pags = r.typeData?.pagamentos || [];
  if (pags.length && pags[pags.length - 1].contaNome) return pags[pags.length - 1].contaNome;
  return "";
}

/** Normaliza pedidos (`orders`) + contas legadas (`items` não-PurchaseOrder) numa só lista uniforme. */
function allRows() {
  const orders = (S.data?.orders || []).map((o) => {
    const docs = o.documents?.docs || [];
    const docOf = (k) => docs.find((d) => d.kind === k) || { present: false, required: false };
    const attsOf = (k) => (o.attachments || []).filter((a) => norm(a.fileName).includes(k));
    const total = num(o.totals?.total);
    const paid = num(o.paidAmount);
    const openStates = ["EM_ABERTO", "ATRASADO", "PAGO_PARCIAL", "EM_TRANSITO"];
    return {
      isOrder: true,
      rowId: o.id,
      order: o,
      number: o.number || "—",
      createdKey: toDateKey(o.createdAt) || "",
      dueKey: o.dueKey || toDateKey(o.dueDate) || "",
      paidKey:
        toDateKey(
          (o.installments || []).filter((i) => i.status === "PAGO" && i.paidAt).sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0]?.paidAt
        ) || "",
      daysLate: o.daysLate,
      tc: paymentTypeCode({ ...o, isOrder: true }),
      requestType: o.requestType,
      typeTitle: `${REQUEST_TYPE_LABEL[o.requestType] || o.requestType} · ${o.paymentMode === "FM" ? "Fundo de Maneio" : "Pagamento a Fornecedor"}`,
      cc: ccCodeOf(o),
      beneficiary: o.beneficiary || o.supplierName || "—",
      benefNome: o.benefNome || null,
      iban: o.iban || null,
      bankName: o.bankName || null,
      nif: o.supplierNif || null,
      product: o.shortDescription || o.description || "—",
      total,
      paid,
      payable: Math.max(0, num(o.payable)),
      currency: o.currency || "AOA",
      paymentTerm: o.paymentTerm || "PRONTO",
      creditDays: o.creditDays,
      estCode: o.derivedStatus,
      estLabel: o.derivedStatusLabel,
      estSeverity: o.derivedStatusSeverity,
      isOpenPayable: openStates.includes(o.derivedStatus) && !["ELIMINADO", "CANCELADO", "REJEITADO"].includes(o.derivedStatus),
      pp: { ...docOf("proforma"), files: attsOf("proforma") },
      cp: { ...docOf("comprovativo"), files: attsOf("comprovativo") },
      ft: { ...docOf("fatura"), files: attsOf("fatura"), exc: o.documents?.exceptions },
      requestedBy: o.requestedBy || "",
      bankMovements: o.bankMovements || [],
      conta: contaLabelOf(o),
      rawPayItem: {
        id: `po:${o.id}`,
        sourceId: o.id,
        source: "PEDIDO_COMPRA",
        sourceLabel: "Requisição de pagamento",
        stage: "A_PAGAR",
        status: o.status,
        onHold: o.onHold,
        payable: Math.max(0, num(o.payable)),
        paidAmount: paid,
        amount: total,
        currency: o.currency || "AOA",
        beneficiary: o.beneficiary,
        benefNome: o.benefNome,
        iban: o.iban,
        supplier: o.supplierName,
        docNumber: o.number,
        description: o.shortDescription || o.description,
        dueDate: o.dueDate,
        daysLate: o.daysLate,
        project: o.project,
        costCenter: o.costCenter,
        typeData: o.typeData,
      },
    };
  });

  // Contas avulsas que não são PurchaseOrder (pedidos extra antigos, lançamentos, custos diretos)
  const orderIds = new Set(orders.map((x) => x.rowId));
  const legacy = (S.data?.items || [])
    .filter((p) => p.source !== "PEDIDO_COMPRA" && !orderIds.has(p.sourceId))
    .map((p) => {
      const late = p.daysLate > 0;
      const estCode = p.stage === "COMPROMISSO" ? "POR_APROVAR" : late ? "ATRASADO" : "EM_ABERTO";
      const estLabel = p.derivedStatusLabel || (late ? "Atrasado" : p.stage === "COMPROMISSO" ? "Por aprovar" : "Em aberto");
      return {
        isOrder: false,
        rowId: p.id,
        legacyItem: p,
        number: p.docNumber || p.sourceLabel || "Conta",
        createdKey: toDateKey(p.date) || "",
        dueKey: toDateKey(p.dueDate) || "",
        paidKey: "",
        daysLate: p.daysLate,
        tc: "OUT",
        requestType: p.requestType || "OBRA",
        typeTitle: p.sourceLabel || p.source,
        cc: ccCodeOf(p),
        beneficiary: p.beneficiary || p.supplier || "—",
        benefNome: null,
        iban: null,
        bankName: null,
        nif: null,
        product: p.shortDescription || p.description || "—",
        total: num(p.amount),
        paid: num(p.paidAmount),
        payable: num(p.payable),
        currency: p.currency || "AOA",
        paymentTerm: p.paymentTerm || "PRONTO",
        creditDays: p.creditDays,
        estCode,
        estLabel,
        estSeverity: late ? "bad" : "neutral",
        isOpenPayable: p.stage === "A_PAGAR",
        pp: { present: false, required: false, files: [] },
        cp: { present: false, required: false, files: [] },
        ft: { present: false, required: false, files: [] },
        requestedBy: p.requestedBy || "",
        bankMovements: [],
        conta: p.fundName || "",
        rawPayItem: p,
      };
    });

  return [...orders, ...legacy];
}

/** Pesquisa flexível (texto + valores escritos como 310000, 310 000, 310.000,00). */
function matchesQuery(r, raw) {
  const q = String(raw || "").trim();
  if (!q) return true;
  const k = norm(q);
  const sp = (s) => String(s || "").replace(/[\s\u00a0\u202f]/g, "");
  const qd = sp(q).replace(/^-/, "");
  if (/^[\d.,]+$/.test(qd) && qd.replace(/\D/g, "").length >= 2) {
    let n = qd;
    if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, "").replace(",", ".");
    else if (/\.\d{1,2}$/.test(n) && !/\.\d{3}$/.test(n)) n = n.replace(/,/g, "");
    else n = n.replace(/[.,]/g, "");
    const val = parseFloat(n);
    if (Number.isFinite(val)) {
      const targets = [r.total, r.payable, r.paid];
      if (targets.some((v) => Math.round(v * 100) === Math.round(val * 100) || Math.floor(v) === Math.floor(val))) return true;
      if (targets.some((v) => String(Math.floor(v)).includes(qd.replace(/\D/g, "")))) return true;
    }
  }
  const hay = norm([r.number, r.beneficiary, r.benefNome, r.product, r.cc, r.tc, r.requestedBy, r.iban, r.nif, fmtN(r.total), fmtN(r.payable)].join(" "));
  return hay.includes(k) || sp(hay).includes(sp(k));
}

function passaBase(r, { ignoreKpi = false } = {}) {
  const f = S.f;
  if (r.estCode === "ELIMINADO" || r.estCode === "CANCELADO") return false;
  if (!matchesQuery(r, f.q)) return false;
  if (f.tc && r.tc !== f.tc) return false;
  if (f.conta && r.conta !== f.conta) return false;
  if (f.porM.length && !f.porM.includes(r.requestedBy)) return false;
  if (f.forn && r.beneficiary !== f.forn) return false;
  if (f.cc && r.cc !== f.cc) return false;
  if (f.cond) {
    if (f.cond === "CRED" && r.paymentTerm !== "CREDITO" && r.paymentTerm !== "PARCIAL") return false;
    if (f.cond === "PRONTO" && r.paymentTerm !== "PRONTO") return false;
    if (f.cond === "PARCIAL" && r.paymentTerm !== "PARCIAL") return false;
  }
  if (f.de || f.ate) {
    const dt = f.dtRef === "ped" ? r.createdKey : f.dtRef === "pag" ? r.paidKey : r.dueKey;
    if (f.de && (!dt || dt < f.de)) return false;
    if (f.ate && (!dt || dt > f.ate)) return false;
  }
  if (f.semFt && !(r.paid > 0 && !r.ft.present && !r.ft.exc?.all)) return false;
  if (f.semCp && !(r.paid > 0 && !r.cp.present && !r.bankMovements.length)) return false;

  if (f.est) {
    if (f.est === "__aberto") {
      if (!r.isOpenPayable) return false;
    } else if (r.estCode !== f.est) {
      return false;
    }
  }

  if (!ignoreKpi && f.kpi) {
    if (f.kpi === "pagar" && !r.isOpenPayable) return false;
    if (f.kpi === "atr" && !(r.isOpenPayable && r.daysLate > 0)) return false;
    if (f.kpi === "sem" && !(r.isOpenPayable && r.daysLate !== null && r.daysLate <= 0 && r.daysLate >= -7)) return false;
    if (f.kpi === "cred" && !(r.isOpenPayable && (r.paymentTerm === "CREDITO" || r.paymentTerm === "PARCIAL"))) return false;
    if (f.kpi === "pago" && !(r.paid > 0 || r.estCode === "PAGO")) return false;
  }
  return true;
}

function visibleRows() {
  return allRows()
    .filter((r) => passaBase(r))
    .sort((a, b) => {
      // Atrasados e em aberto primeiro pelo vencimento; pagos mais recentes primeiro quando filtrado por Pago
      if (S.f.kpi === "pago" || S.f.est === "PAGO") return (b.paidKey || b.createdKey).localeCompare(a.paidKey || a.createdKey);
      const aOpen = a.isOpenPayable ? 0 : 1;
      const bOpen = b.isOpenPayable ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return (a.dueKey || "9999").localeCompare(b.dueKey || "9999");
    });
}

/* ─── Renderização principal ─────────────────────────────────────────────── */

function renderShell() {
  codigoNoCabecalho("P1");
  const actions = document.getElementById("financePageActions");
  if (actions) {
    actions.innerHTML = `
      <button type="button" class="finance-btn finance-btn--ghost" id="cpXlsx">Exportar Excel</button>
      <a class="finance-btn finance-btn--primary" href="/Financeiro/novoPedido">+ Nova Requisição de Pagamento</a>`;
    document.getElementById("cpXlsx")?.addEventListener("click", exportarExcel);
  }

  document.getElementById("financeRoot").innerHTML = `
    <div class="ov fcp-root">
      <div id="cpFiltros1" class="fcp-f1"></div>
      <div id="cpFiltros2" class="fcp-f2"></div>
      <div id="cpExtraQueue"></div>
      <div id="cpKpis" class="fcp-kpr"></div>
      <div id="cpResumo" class="fcp-resumo"></div>
      <div id="cpBulkBar"></div>
      <section class="finance-card ov-panel" style="padding:0;overflow:visible">
        <div id="cpTable" class="fx2-tw"></div>
      </section>
      <p class="fcal-nota">
        Estado: Em cotação → Por aprovar → Em aberto → Em trânsito → Pago (ou Atrasado, se passar a data de vencimento).
        Análise de custos: <a href="/Financeiro/obras-custos">O2 · Custos por Obra</a>.
      </p>
    </div>`;

  bindEvents();
}

function renderFiltros() {
  const rows = allRows();
  const f = S.f;
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt"));
  const contas = uniq([...cardsList().map((c) => [c.bank, c.label].filter(Boolean).join(" ")), ...rows.map((r) => r.conta)]);
  const requerentes = uniq(rows.map((r) => r.requestedBy));
  const fornecedores = uniq(rows.map((r) => r.beneficiary).filter((x) => x !== "—"));
  const centros = uniq(rows.map((r) => r.cc));

  // Ordem v635b dos estados: Atrasado e Em Aberto primeiro, depois Por Pagar (todos) e restantes
  const estados = [
    ["", "Todos os estados"],
    ["ATRASADO", "Atrasado"],
    ["EM_ABERTO", "Em Aberto"],
    ["__aberto", "Por Pagar (todos)"],
    ["PAGO_PARCIAL", "Pago parcial"],
    ["EM_TRANSITO", "Em trânsito"],
    ["POR_APROVAR", "Por aprovar"],
    ["EM_COTACAO", "Em cotação"],
    ["EM_PAUSA", "Em pausa"],
    ["PAGO", "Pago"],
    ["REJEITADO", "Rejeitado"],
  ];

  const tipos = [
    ["", "Todos os tipos"],
    ["PF", "PF — Pagamento a Fornecedor"],
    ["TRF INT", "TRF INT — Transferência Interna / FM"],
    ["SL", "SL — Salário"],
    ["AD SL", "AD SL — Adiantamento de Salário"],
    ["PE", "PE — Pagamento ao Estado"],
    ["EMP", "EMP — Empréstimo"],
    ...(rows.some((r) => r.tc === "OUT") ? [["OUT", "Outros lançamentos"]] : []),
  ];

  const porTxt = !f.porM.length
    ? "Pedido por: todos"
    : f.porM.length === 1
      ? f.porM[0]
      : `${f.porM[0]} +${f.porM.length - 1}`;

  const temFiltro = Boolean(f.q || f.tc || f.conta || f.est || f.porM.length || f.forn || f.de || f.ate || f.cc || f.cond || f.semFt || f.semCp || f.kpi);

  document.getElementById("cpFiltros1").innerHTML = `
    <input id="cpSearch" class="finance-input fcp-q" type="search" placeholder="Pesquisar n.º, terceiro, descrição, valor…" value="${esc(f.q)}" autocomplete="off">
    <select class="finance-input fcp-sel" data-cpf="tc" title="Tipo de pagamento">
      ${tipos.map(([k, l]) => `<option value="${esc(k)}"${f.tc === k ? " selected" : ""}>${esc(l)}</option>`).join("")}
    </select>
    <select class="finance-input fcp-sel" data-cpf="conta" title="Conta de saída">
      <option value="">Todas as contas</option>
      ${contas.map((c) => `<option value="${esc(c)}"${f.conta === c ? " selected" : ""}>${esc(c)}</option>`).join("")}
    </select>
    <select class="finance-input fcp-sel" data-cpf="est" title="Estado">
      ${estados.map(([k, l]) => `<option value="${esc(k)}"${f.est === k ? " selected" : ""}>${esc(l)}</option>`).join("")}
    </select>
    <div class="fcp-mswrap">
      <button type="button" class="finance-input fcp-msb${f.porM.length ? " is-on" : ""}" data-cpporbtn title="${esc(f.porM.join(", ") || "Quem fez o pedido — pode escolher vários")}">
        <span>${esc(porTxt)}</span><span class="fcp-caret">▼</span>
      </button>
      <div class="fcp-msmenu${S.porOpen ? "" : " hidden"}" id="cpPorMenu">
        <button type="button" class="fcp-msclr" data-cpporclr>Todos os utilizadores</button>
        ${requerentes
          .map(
            (u) => `<label class="fcp-msopt"><input type="checkbox" data-cppor="${esc(u)}"${f.porM.includes(u) ? " checked" : ""}> <span>${esc(u)}</span></label>`
          )
          .join("") || '<div class="fx2-mut" style="padding:6px 8px">Sem utilizadores</div>'}
      </div>
    </div>
    <select class="finance-input fcp-sel" data-cpf="forn" title="Filtrar por fornecedor / terceiro">
      <option value="">Fornecedor: todos</option>
      ${fornecedores.map((x) => `<option value="${esc(x)}"${f.forn === x ? " selected" : ""}>${esc(x)}</option>`).join("")}
    </select>
    <span class="fcp-dt">
      <select class="finance-input fcp-sel" data-cpf="dtRef">
        <option value="venc"${f.dtRef === "venc" ? " selected" : ""}>Vencimento</option>
        <option value="ped"${f.dtRef === "ped" ? " selected" : ""}>Data do pedido</option>
        <option value="pag"${f.dtRef === "pag" ? " selected" : ""}>Data de pagamento</option>
      </select>
      <span class="fx2-mut">de</span>
      <input class="finance-input" type="date" data-cpf="de" value="${esc(f.de)}">
      <span class="fx2-mut">até</span>
      <input class="finance-input" type="date" data-cpf="ate" value="${esc(f.ate)}">
    </span>
    <select class="finance-input fcp-sel" data-cpf="cc" title="Centro de custo">
      <option value="">Todos os centros de custo</option>
      ${centros.map((c) => `<option value="${esc(c)}"${f.cc === c ? " selected" : ""}>${esc(c)}</option>`).join("")}
    </select>
    <select class="finance-input fcp-sel" data-cpf="cond" title="Condição de pagamento">
      <option value="">Todos</option>
      <option value="PRONTO"${f.cond === "PRONTO" ? " selected" : ""}>Pronto Pagamento</option>
      <option value="CRED"${f.cond === "CRED" ? " selected" : ""}>A Crédito</option>
      <option value="PARCIAL"${f.cond === "PARCIAL" ? " selected" : ""}>Em Parcelas</option>
    </select>
    ${temFiltro ? `<button type="button" class="finance-btn finance-btn--sm" data-cplimpar>Limpar</button>` : ""}`;

  const nSched = (S.data?.schedule || []).length;
  const nAppr = (S.data?.approvals || []).length;
  document.getElementById("cpFiltros2").innerHTML = `
    <span class="fx2-mut">Pendências:</span>
    <label class="fcp-chk"><input type="checkbox" data-cpchk="semFt"${f.semFt ? " checked" : ""}> Pagos sem fatura</label>
    <label class="fcp-chk"><input type="checkbox" data-cpchk="semCp"${f.semCp ? " checked" : ""}> Pagos sem comprovativo</label>
    ${
      nSched
        ? `<button type="button" class="fcp-qpill${f.filaExtra === "schedule" ? " on" : ""}" data-cpfila="schedule"><span class="material-symbols-outlined">calendar_month</span> Cotações por agendar (${nSched})</button>`
        : ""
    }
    ${
      nAppr
        ? `<button type="button" class="fcp-qpill${f.filaExtra === "approve" ? " on" : ""}" data-cpfila="approve"><span class="material-symbols-outlined">task_alt</span> Reforços FM por aprovar (${nAppr})</button>`
        : ""
    }`;
}

function renderExtraQueue() {
  const slot = document.getElementById("cpExtraQueue");
  if (!slot) return;
  if (S.f.filaExtra === "schedule") {
    const rows = S.data?.schedule || [];
    slot.innerHTML = `<section class="finance-card" style="margin-bottom:10px;padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>Cotações aprovadas à espera de plano de prestações (${rows.length})</b><button type="button" class="finance-btn finance-btn--sm" data-cpfila="">Fechar</button></div>
      <table class="fx2-t"><thead><tr><th>Enviado</th><th>Necessidade · Fornecedor</th><th>Obra</th><th class="r">Valor</th><th></th></tr></thead>
      <tbody>${rows
        .map(
          (n) => `<tr><td>${esc(dateOnly(n.sentAt))}</td><td><b>${esc(n.description)}</b> <span class="fx2-mut">${esc(n.supplier || "")}</span></td>
          <td>${esc(n.project?.name || "—")}</td><td class="r"><b>${esc(money(n.amount, n.currency))}</b></td>
          <td class="r"><a class="finance-btn finance-btn--sm" href="/Projectos/projectView?id=${encodeURIComponent(n.projectId)}&tab=plano_financeiro&sub=cronograma&needId=${encodeURIComponent(n.id)}">Definir parcelas</a></td></tr>`
        )
        .join("")}</tbody></table></section>`;
    return;
  }
  if (S.f.filaExtra === "approve") {
    const rows = S.data?.approvals || [];
    slot.innerHTML = `<section class="finance-card" style="margin-bottom:10px;padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>Pedidos de reforço de fundo de maneio (${rows.length})</b><button type="button" class="finance-btn finance-btn--sm" data-cpfila="">Fechar</button></div>
      <table class="fx2-t"><thead><tr><th>Data</th><th>Motivo</th><th>Fundo · Obra</th><th>Pedido por</th><th class="r">Valor</th><th></th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr><td>${esc(dateOnly(r.requestedAt))}</td><td><b>${esc(r.reason)}</b></td><td>${esc(r.fund?.name || "—")}</td><td>${esc(r.requestedBy || "—")}</td>
          <td class="r"><b>${esc(money(r.amount, r.currency))}</b></td>
          <td class="r">${
            canPay()
              ? `<button type="button" class="finance-btn finance-btn--sm finance-btn--primary" data-rfapp="${esc(r.id)}">Aprovar</button>
                 <button type="button" class="finance-btn finance-btn--sm" data-rfrej="${esc(r.id)}">Rejeitar</button>`
              : ""
          }</td></tr>`
        )
        .join("")}</tbody></table></section>`;
    return;
  }
  slot.innerHTML = "";
}

function renderKpis() {
  const base = allRows().filter((r) => passaBase(r, { ignoreKpi: true }));
  const open = base.filter((r) => r.isOpenPayable);
  const atr = open.filter((r) => r.daysLate > 0);
  const sem = open.filter((r) => r.daysLate !== null && r.daysLate <= 0 && r.daysLate >= -7);
  const cred = open.filter((r) => r.paymentTerm === "CREDITO" || r.paymentTerm === "PARCIAL");
  const pagos = base.filter((r) => r.paid > 0 || r.estCode === "PAGO");
  const sum = (L, k = "payable") => L.reduce((a, x) => a + num(x[k]), 0);

  const card = (id, cls, lbl, val, cnt) =>
    `<button type="button" class="fcp-kpc ${cls}${S.f.kpi === id ? " is-on" : ""}" data-cpkpi="${id}">
      <span>${esc(lbl)}</span><b>${esc(fmtN(val))}</b><i>${cnt} pagamento(s)</i>
    </button>`;

  document.getElementById("cpKpis").innerHTML =
    card("pagar", "", "Por Pagar", sum(open), open.length) +
    card("atr", "bad", "Em Atraso", sum(atr), atr.length) +
    card("sem", "warn", "Vence em 7 Dias", sum(sem), sem.length) +
    card("cred", "blue", "A Crédito", sum(cred), cred.length) +
    card("pago", "good", "Pago", sum(pagos, "paid"), pagos.length);
}

function renderBulkBar(visiveis) {
  const slot = document.getElementById("cpBulkBar");
  if (!slot) return;
  const validIds = new Set(visiveis.filter((r) => r.isOrder).map((r) => r.rowId));
  [...S.sel].forEach((id) => {
    if (!validIds.has(id)) S.sel.delete(id);
  });
  if (!S.sel.size) {
    slot.innerHTML = "";
    return;
  }
  const selRows = visiveis.filter((r) => S.sel.has(r.rowId));
  const tot = selRows.reduce((s, r) => s + (r.payable || r.total), 0);
  const hasPorAprovar = selRows.some((r) => r.estCode === "POR_APROVAR");
  slot.innerHTML = `
    <div class="fcp-bulkbar">
      <b>${S.sel.size} selecionado(s)</b>
      <span class="fx2-mut">total ${fmtN(tot)} AOA</span>
      <span style="flex:1"></span>
      ${
        canPay()
          ? `<label class="finance-btn finance-btn--sm" title="Anexar um único comprovativo a todos os pedidos selecionados (mesma transferência)">
               📎 Anexar comprovativo<input type="file" hidden accept="application/pdf,image/*" id="cpBulkProofInput">
             </label>`
          : ""
      }
      ${hasPorAprovar && canApproveOrder() ? `<button type="button" class="finance-btn finance-btn--sm finance-btn--primary" data-cpbulkappr>✓ Aprovar selecionados</button>` : ""}
      <button type="button" class="finance-btn finance-btn--sm" data-cpselclr>Limpar</button>
    </div>`;
}

function docSlotHtml(r, kind, d) {
  if (!r.isOrder) return '<span class="fx2-mut">—</span>';
  if (kind === "ft" && d.exc?.all) {
    return `<span class="fcp-docpill" title="Dispensado de fatura (${d.exc.dsc ? "DSC" : "AF"})">${d.exc.dsc ? "DSC" : "AF"}</span>`;
  }
  if (d.present && d.files?.length) {
    const f = d.files[d.files.length - 1];
    return `<a class="fcp-doc ok" href="${esc(getAssetUrl(f.url))}" target="_blank" rel="noopener" title="${esc(f.fileName)}" data-stop>✓</a>`;
  }
  if (!canPay() && !can("pedidosExtras", "edit")) return '<span class="fx2-mut">—</span>';
  const miss = d.required;
  const sym = kind === "ft" && miss ? "!" : "+";
  const lbl = kind === "pp" ? "Proforma" : kind === "cp" ? "Comprovativo" : "Fatura";
  return `<button type="button" class="fcp-doc${miss ? " miss" : ""}" data-cpdoc="${esc(r.rowId)}|${kind}" title="${lbl}: ${miss ? "em falta — anexar" : "carregar"}">${sym}</button>`;
}

function renderTable() {
  const rows = visibleRows();
  const sumTot = rows.reduce((s, r) => s + r.total, 0);
  const sumPaid = rows.reduce((s, r) => s + r.paid, 0);
  const sumPayable = rows.reduce((s, r) => s + r.payable, 0);

  document.getElementById("cpResumo").innerHTML =
    `<span class="fx2-mut">${rows.length} pedido(s) na lista · total <b>${fmtN(sumTot)}</b> · pago <b>${fmtN(sumPaid)}</b> · por pagar <b>${fmtN(sumPayable)}</b></span>`;

  renderBulkBar(rows);

  const wrap = document.getElementById("cpTable");
  if (!rows.length) {
    wrap.innerHTML = `<div class="finance-empty">Nenhum pedido de pagamento com estes filtros.</div>`;
    return;
  }

  const orderRows = rows.filter((r) => r.isOrder);
  const allChecked = orderRows.length > 0 && orderRows.every((r) => S.sel.has(r.rowId));

  wrap.innerHTML = `
    <table class="fx2-t fcp-table">
      <thead>
        <tr>
          <th style="width:28px"><input type="checkbox" data-cpall${allChecked ? " checked" : ""} title="Selecionar todos os pedidos da lista"></th>
          <th>Requisição</th>
          <th>Venc.</th>
          <th>Tipo</th>
          <th>CC</th>
          <th>Terceiro / Descrição</th>
          <th title="Banco / conta para onde vai o dinheiro — clique para ver o IBAN">Destino</th>
          <th>Produto</th>
          <th class="r" title="Valor a pagar com IVA e sem retenção na fonte">V. a pagar<br><small style="font-weight:400">c/IVA s/RF</small></th>
          <th>Estado</th>
          <th title="Proforma">PP</th>
          <th title="Comprovativo de pagamento">CP</th>
          <th title="Fatura">FT</th>
          <th title="Utilizador que fez o pedido">Util.</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((r) => {
            const tone = PILL_TONE[r.estSeverity] || "slate";
            const showVal = r.estCode === "PAGO" ? r.total : r.payable || r.total;
            const hasBank = r.bankMovements.length > 0;
            const showBankIcon = r.isOrder && (r.paid > 0 || hasBank);
            return `<tr class="fcp-row${r.isOpenPayable && r.daysLate > 0 ? " is-late" : ""}" data-cprow="${esc(r.rowId)}">
              <td data-stop>${r.isOrder ? `<input type="checkbox" data-cpsel="${esc(r.rowId)}"${S.sel.has(r.rowId) ? " checked" : ""}>` : ""}</td>
              <td>
                ${
                  r.isOrder
                    ? `<button type="button" class="fcp-reqbtn" data-cpopen="${esc(r.rowId)}" title="Abrir requisição · emitida a ${dateOnly(r.createdKey)} por ${esc(r.requestedBy || "—")}">${esc(r.number)}</button>`
                    : `<span class="fx2-mut">${esc(r.number)}</span>`
                }
              </td>
              <td title="${r.createdKey ? `Emitida a ${dateOnly(r.createdKey)}` : ""}">
                <span>${esc(dateOnly(r.dueKey))}</span>
                ${r.isOpenPayable && r.daysLate > 0 ? `<div class="fcp-late">há ${r.daysLate} d</div>` : ""}
              </td>
              <td title="${esc(r.typeTitle)}"><b>${esc(r.tc)}</b></td>
              <td>${esc(r.cc)}</td>
              <td class="fcp-terc">
                <div>${esc(r.beneficiary)}</div>
                ${r.benefNome ? `<div class="fx2-mut" style="font-size:11px">Benef.: ${esc(r.benefNome)}</div>` : ""}
              </td>
              <td data-stop>
                <button type="button" class="fcp-iban${r.iban ? " ok" : " miss"}" data-cpiban="${esc(r.rowId)}" title="${esc(r.iban ? `${r.bankName ? `${r.bankName} · ` : ""}${r.iban}` : "Sem IBAN registado — clique para ver")}">
                  <span class="material-symbols-outlined" style="font-size:15px">credit_card</span>
                </button>
              </td>
              <td class="fcp-prod" title="${esc(r.product)}">${esc(r.product)}</td>
              <td class="r">
                <b class="${r.isOpenPayable && r.daysLate > 0 ? "f0-neg" : ""}">${esc(fmtN(showVal))}</b>
                ${r.currency !== "AOA" ? `<small class="fx2-mut"> ${esc(r.currency)}</small>` : ""}
                ${r.paid > 0 && r.payable > 0 ? `<div class="fx2-mut" style="font-size:11px">pago ${esc(fmtN(r.paid))}</div>` : ""}
              </td>
              <td data-stop style="white-space:nowrap">
                <button type="button" class="fcp-estbtn" data-cpest="${esc(r.rowId)}" title="Clique para ações de estado / pagamento">
                  <span class="fcal-pill fcal-pill--${tone}">${esc(r.estLabel)}</span><span class="fcp-caret">▾</span>
                </button>
                ${
                  showBankIcon
                    ? `<button type="button" class="fcp-bk${hasBank ? " ok" : " miss"}" data-cpbank="${esc(r.rowId)}" title="${hasBank ? "Conciliado com o extrato bancário — clique para ver" : "Pago, ainda sem movimento bancário conciliado — clique para ver"}">🏦</button>`
                    : ""
                }
              </td>
              <td data-stop class="c">${docSlotHtml(r, "pp", r.pp)}</td>
              <td data-stop class="c">${docSlotHtml(r, "cp", r.cp)}</td>
              <td data-stop class="c">${docSlotHtml(r, "ft", r.ft)}</td>
              <td title="${esc(r.requestedBy || "—")}"><span class="fcp-usr">${esc(userInitials(r.requestedBy))}</span></td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;
}

function refreshAll() {
  renderFiltros();
  renderExtraQueue();
  renderKpis();
  renderTable();
}

/* ─── Modais e ações do protótipo (Destino, 🏦, Estado, Anexos, rpd) ─────── */

function openIbanModal(r) {
  openModal({
    title: `Destino de pagamento · ${r.number}`,
    width: 480,
    contentHtml: `
      <div class="fcp-kvgrid">
        <div><span>Terceiro</span><b>${esc(r.beneficiary)}</b></div>
        ${r.benefNome ? `<div><span>Beneficiário da conta</span><b>${esc(r.benefNome)}</b></div>` : ""}
        <div><span>NIF</span><b>${esc(r.nif || "—")}</b></div>
        <div><span>Banco</span><b>${esc(r.bankName || "—")}</b></div>
        <div style="grid-column:1/-1"><span>IBAN / Conta</span><b style="font-family:monospace">${esc(r.iban || "Não indicado")}</b></div>
      </div>`,
    secondaryLabel: "Fechar",
  });
}

function openBankSummaryModal(r) {
  const o = r.order;
  if (!o) return;
  const instPaid = (o.installments || []).filter((i) => i.status === "PAGO");
  const movs = o.bankMovements || [];
  const sumMovs = movs.reduce((s, m) => s + Math.abs(num(m.amount)), 0);
  const semBanco = Math.max(0, r.paid - sumMovs);

  openModal({
    title: `Pagamentos e Conciliação · ${o.number}`,
    width: 620,
    contentHtml: `
      <div style="margin-bottom:10px" class="t3-small">
        Total pago no pedido: <b>${fmtN(r.paid)} ${esc(r.currency)}</b> ·
        Conciliado no extrato: <b class="fcal-in">${fmtN(sumMovs)} ${esc(r.currency)}</b>
        ${semBanco > 0.5 ? ` · <span style="color:#c77700;font-weight:600">por conciliar ${fmtN(semBanco)}</span>` : ""}
      </div>
      <h4 class="f0-h3" style="margin:8px 0 4px">Pagamentos registados no pedido (${instPaid.length})</h4>
      ${
        instPaid.length
          ? `<table class="fx2-t"><thead><tr><th>Data</th><th>Conta / Ref.</th><th class="r">Valor</th><th>Situação</th></tr></thead>
             <tbody>${instPaid
               .map(
                 (i) => `<tr><td>${dateOnly(i.paidAt || i.dueDate)}</td><td>${esc(i.notes || "—")}</td><td class="r"><b>${fmtN(i.amount)}</b></td>
                 <td>${movs.length ? '<span class="fcal-pill fcal-pill--good">✓ com extrato</span>' : '<span class="fcal-pill fcal-pill--warn">sem movimento no extrato</span>'}</td></tr>`
               )
               .join("")}</tbody></table>`
          : '<p class="fx2-mut t3-small">Sem prestações pagas registadas no pedido.</p>'
      }
      <h4 class="f0-h3" style="margin:12px 0 4px">Movimentos bancários conciliados (${movs.length})</h4>
      ${
        movs.length
          ? `<table class="fx2-t"><thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th class="r">Valor</th></tr></thead>
             <tbody>${movs
               .map(
                 (m) => `<tr><td>${dateOnly(m.date)}</td><td>${esc([m.card?.bank, m.card?.label].filter(Boolean).join(" ") || "—")}</td>
                 <td>${esc(m.description || "")}</td><td class="r"><b>${fmtN(Math.abs(m.amount))}</b></td></tr>`
               )
               .join("")}</tbody></table>`
          : '<p class="fx2-mut t3-small">Ainda sem movimentos ligados em <a href="/Financeiro/conciliacao">T2 · Conciliação Bancária</a>.</p>'
      }
      <p class="fx2-mut t3-small" style="margin-top:8px">Para corrigir data, valor, conta ou comprovativo: abra a requisição → secção Pagamentos → ✎.</p>`,
    primaryLabel: "Abrir requisição",
    secondaryLabel: "Fechar",
    onPrimary: ({ close }) => {
      close();
      openOrderDetailModal(o.id);
    },
  });
}

function openStateActionsModal(r) {
  if (!r.isOrder) {
    if (canPay() && canPayHere(r.rawPayItem)) {
      openPayModal(r.rawPayItem, { onSaved: load, cards: cardsList() });
    }
    return;
  }
  const o = r.order;
  const cards = cardsList();
  const isPorAprovar = r.estCode === "POR_APROVAR";
  const isPausa = o.onHold;
  const canPayOrder = ["APROVADO", "EM_PAGAMENTO"].includes(o.status) && !o.onHold && r.payable > 0.5;
  const inTransit = Boolean(o.typeData?.emTransito);

  openModal({
    title: `Estado · ${o.number} (${r.estLabel})`,
    width: 520,
    contentHtml: `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${
          isPorAprovar && canApproveOrder()
            ? `<div class="fcp-actbox">
                 <b>Decisão de aprovação</b>
                 <div style="display:flex;gap:8px;margin-top:6px">
                   <button type="button" class="finance-btn finance-btn--primary" data-stact="aprovar">✓ Aprovar requisição</button>
                   <button type="button" class="finance-btn" data-stact="rejeitar">✕ Rejeitar</button>
                 </div>
               </div>`
            : ""
        }
        ${
          canPayOrder && canPay()
            ? `<div class="fcp-actbox">
                 <b>Pagamento</b>
                 <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">
                   <button type="button" class="finance-btn finance-btn--primary" data-stact="pagar">Registar pagamento efetuado</button>
                 </div>
               </div>
               <div class="fcp-actbox">
                 <b>Em trânsito (${inTransit ? `atual: ${esc(o.typeData.emTransito.cardLabel || "sim")}` : "ordem enviada ao banco"})</b>
                 <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
                   <select id="stTransitCard" class="finance-input" style="flex:1">
                     <option value="">— escolher conta principal —</option>
                     ${cards.map((c) => `<option value="${esc(c.id)}" data-label="${esc([c.bank, c.label].filter(Boolean).join(" "))}"${o.typeData?.emTransito?.cardId === c.id ? " selected" : ""}>${esc([c.bank, c.label, c.lastDigits ? `•${c.lastDigits}` : ""].filter(Boolean).join(" "))}</option>`).join("")}
                   </select>
                   <button type="button" class="finance-btn finance-btn--sm" data-stact="transito">Marcar em trânsito</button>
                   ${inTransit ? `<button type="button" class="finance-btn finance-btn--sm" data-stact="semtransito">Retirar</button>` : ""}
                 </div>
               </div>`
            : ""
        }
        ${
          canApproveOrder() || canPay()
            ? `<div class="fcp-actbox">
                 <b>${isPausa ? "Pedido em pausa" : "Pôr em pausa"}</b>
                 ${
                   isPausa
                     ? `<p class="fx2-mut t3-small" style="margin:4px 0">Motivo: ${esc(o.holdReason || "—")}. Retomar mantém a aprovação se o valor não mudou.</p>
                        <button type="button" class="finance-btn finance-btn--primary" data-stact="retomar">Retomar pedido</button>`
                     : `<div style="display:flex;gap:8px;margin-top:6px">
                          <input id="stHoldReason" class="finance-input" placeholder="Motivo da pausa…" style="flex:1">
                          <button type="button" class="finance-btn" data-stact="pausar">Pôr em pausa</button>
                        </div>`
                 }
               </div>`
            : ""
        }
      </div>`,
    secondaryLabel: "Fechar",
    onRender: ({ panel, close }) => {
      panel.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-stact]");
        if (!b) return;
        const act = b.dataset.stact;
        try {
          if (act === "pagar") {
            close();
            openPayModal(r.rawPayItem, { onSaved: load, cards });
            return;
          }
          if (act === "aprovar") {
            await apiRequest(`/purchase-orders/${encodeURIComponent(o.id)}/approve`, { method: "POST", body: { decision: "APROVADO" } });
            toast(`${o.number} aprovado.`, { type: "success" });
          } else if (act === "rejeitar") {
            const obs = window.prompt("Motivo da rejeição (opcional):") ?? "";
            await apiRequest(`/purchase-orders/${encodeURIComponent(o.id)}/approve`, { method: "POST", body: { decision: "NAO_APROVADO", observations: obs || null } });
            toast(`${o.number} rejeitado.`, { type: "info" });
          } else if (act === "transito") {
            const sel = panel.querySelector("#stTransitCard");
            const cardId = sel?.value || null;
            const cardLabel = sel?.selectedOptions?.[0]?.dataset?.label || null;
            await apiRequest(`/purchase-orders/${encodeURIComponent(o.id)}/transit`, { method: "POST", body: { inTransit: true, cardId, cardLabel } });
            toast(`${o.number} marcado em trânsito.`, { type: "success" });
          } else if (act === "semtransito") {
            await apiRequest(`/purchase-orders/${encodeURIComponent(o.id)}/transit`, { method: "POST", body: { inTransit: false } });
            toast(`${o.number} retirado de trânsito.`, { type: "info" });
          } else if (act === "pausar") {
            const reason = panel.querySelector("#stHoldReason")?.value?.trim();
            if (!reason) return toast("Escreva o motivo da pausa.", { type: "error" });
            await apiRequest(`/purchase-orders/${encodeURIComponent(o.id)}/hold`, { method: "POST", body: { onHold: true, reason } });
            toast(`${o.number} posto em pausa.`, { type: "info" });
          } else if (act === "retomar") {
            await apiRequest(`/purchase-orders/${encodeURIComponent(o.id)}/hold`, { method: "POST", body: { onHold: false } });
            toast(`${o.number} retomado.`, { type: "success" });
          }
          close();
          await load();
        } catch (err) {
          toast(err?.data?.message || err.message || "Operação falhou.", { type: "error" });
        }
      });
    },
  });
}

function openUploadDocModal(orderId, kind, { onDone } = {}) {
  const mapKind = { pp: ["proforma", "Proforma"], cp: ["comprovativo", "Comprovativo de pagamento"], ft: ["fatura", "Fatura"] };
  const [apiKind, label] = mapKind[kind] || ["fatura", "Documento"];
  openModal({
    title: `Anexar ${label}`,
    width: 480,
    contentHtml: `
      <div class="finance-form-grid finance-form-grid--2">
        ${
          kind === "ft"
            ? `<div class="finance-field"><label class="finance-label">Tipo</label>
                 <select id="upDocType" class="finance-input"><option value="FT">FT — Fatura</option><option value="FR">FR — Fatura-Recibo</option><option value="ND">ND — Nota de Débito</option></select>
               </div>
               <div class="finance-field"><label class="finance-label">N.º da fatura *</label>
                 <input id="upDocNum" class="finance-input" placeholder="ex.: FT 2026/104">
               </div>`
            : ""
        }
        <div class="finance-field finance-field--full">
          <label class="finance-label">Ficheiro (PDF ou imagem) *</label>
          <input id="upDocFile" type="file" class="finance-input" accept="application/pdf,image/*">
        </div>
      </div>`,
    primaryLabel: "Anexar",
    onPrimary: async ({ panel, btn, close }) => {
      const file = panel.querySelector("#upDocFile")?.files?.[0];
      if (!file) return toast("Escolha o ficheiro.", { type: "error" });
      const docNum = panel.querySelector("#upDocNum")?.value?.trim();
      if (kind === "ft" && !docNum) return toast("Indique o número da fatura.", { type: "error" });
      setButtonLoading(btn, true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (docNum) fd.append("docNumber", docNum);
        const docType = panel.querySelector("#upDocType")?.value;
        if (docType) fd.append("docType", docType);
        await apiUpload(`/purchase-orders/${encodeURIComponent(orderId)}/doc/${apiKind}`, fd, "POST");
        toast(`${label} anexado.`, { type: "success" });
        close();
        await load();
        onDone?.();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err?.data?.message || err.message || "Falha ao anexar.", { type: "error" });
      }
    },
  });
}

/** Ficha completa da requisição (`FXDRAW.rpd` do protótipo, com edição de pagamentos v632 e retirar comprovativo v634). */
function openOrderDetailModal(orderId) {
  let editInstId = null;
  let savedMsg = null;

  const findRow = () => allRows().find((x) => x.isOrder && x.rowId === orderId);
  let bodyEl = null;
  let closeModal = null;

  const draw = () => {
    const r = findRow();
    if (!r || !bodyEl) return;
    const o = r.order;
    const cards = cardsList();
    const tone = PILL_TONE[r.estSeverity] || "slate";
    const hadApproval = (o.approvals || []).some((a) => a.decision === "APROVADO") || ["APROVADO", "EM_PAGAMENTO", "CONCLUIDO"].includes(o.status);
    // v635: pedido em pausa já aprovado não mostra «Aprovar», só «Retomar»
    const showApprove = r.estCode === "POR_APROVAR" && !(o.onHold && hadApproval) && canApproveOrder();
    const showPay = ["APROVADO", "EM_PAGAMENTO"].includes(o.status) && !o.onHold && r.payable > 0.5 && canPay();
    const paidInsts = (o.installments || []).filter((i) => i.status === "PAGO");

    const docFilesHtml = (files, allowRemove = false) =>
      files.length
        ? files
            .map(
              (f) => `<span class="fcp-att">
                <a href="${esc(getAssetUrl(f.url))}" target="_blank" rel="noopener">📎 ${esc(f.fileName)}</a>
                ${allowRemove && canPay() ? `<button type="button" class="fcp-attdel" data-rpddelatt="${esc(f.id)}" title="Retirar este anexo (fica no histórico)">×</button>` : ""}
              </span>`
            )
            .join(" ")
        : '<span class="fx2-mut">em falta</span>';

    bodyEl.innerHTML = `
      <div class="rpd-head">
        <div>
          <div class="rg-kick">${esc(o.number)} · ${esc((REQUEST_TYPE_LABEL[o.requestType] || o.requestType).toUpperCase())}</div>
          <h3 style="margin:2px 0;font-size:18px">${esc(r.beneficiary)} <span class="fcal-pill fcal-pill--${tone}">${esc(r.estLabel)}</span></h3>
          <div class="fx2-mut t3-small">Pedido por ${esc(o.requestedBy || "—")} em ${dateOnly(o.createdAt)}</div>
        </div>
        <div class="rpd-acts">
          ${showApprove ? `<button type="button" class="finance-btn finance-btn--sm finance-btn--primary" data-rpdact="aprovar">Aprovar</button><button type="button" class="finance-btn finance-btn--sm" data-rpdact="rejeitar">Rejeitar</button>` : ""}
          ${showPay ? `<button type="button" class="finance-btn finance-btn--sm finance-btn--primary" data-rpdact="pagar">Registar pagamento</button>` : ""}
          ${o.onHold ? `<button type="button" class="finance-btn finance-btn--sm finance-btn--primary" data-rpdact="retomar">Retomar</button>` : `<button type="button" class="finance-btn finance-btn--sm" data-rpdact="pausar">Pôr em pausa</button>`}
          <a class="finance-btn finance-btn--sm" href="/Financeiro/novoPedido?id=${encodeURIComponent(o.id)}">Editar</a>
        </div>
      </div>

      ${
        o.benefNome
          ? `<div class="fcp-genban">Terceiro genérico · <b>Beneficiário da conta: ${esc(o.benefNome)}</b>${o.iban ? ` · IBAN ${esc(o.iban)}` : ""}${o.bankName ? ` · ${esc(o.bankName)}` : ""}</div>`
          : ""
      }

      <section class="t3-sec">
        <div class="fcp-kvgrid">
          <div><span>Centro de custo</span><b>${esc(r.cc)}</b></div>
          <div><span>Obra</span><b>${esc(o.project ? [o.project.referencia || o.project.code, o.project.name].filter(Boolean).join(" · ") : "—")}</b></div>
          <div><span>Modo</span><b>${o.paymentMode === "FM" ? "Fundo de maneio (TRF INT)" : "Pagamento a fornecedor (PF)"}</b></div>
          <div><span>NIF</span><b>${esc(o.supplierNif || "—")}</b></div>
          <div><span>IBAN</span><b>${esc(o.iban || "—")}</b></div>
          <div><span>Requer cotação</span><b>${o.requiresQuote ? "Sim" : "Não"}</b></div>
          <div><span>Condição</span><b>${esc(TERM_LABEL[o.paymentTerm] || o.paymentTerm)}</b></div>
          <div><span>Vencimento</span><b>${dateOnly(o.dueDate)}</b></div>
        </div>
      </section>

      <section class="t3-sec">
        <h3>Itens</h3>
        ${
          o.items.length
            ? `<div class="fx2-tw"><table class="fx2-t">
                <thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th>Obs.</th><th class="r">Qtd.</th><th class="r">V. unit.</th><th class="r">IVA %</th><th class="r">RF %</th><th class="r">Desc. %</th><th class="r">Total s/ IVA</th></tr></thead>
                <tbody>${o.items
                  .map(
                    (it) => `<tr>
                      <td class="fx2-mut">${esc(it.code || "")}</td>
                      <td>${esc(it.name)}${it.docException ? ` <span class="fcp-docpill">${esc(it.docException)}</span>` : ""}</td>
                      <td>${esc(it.unit || "UN")}</td>
                      <td class="fx2-mut">${esc(it.notes || "")}</td>
                      <td class="r">${it.quantity}</td>
                      <td class="r">${fmtN(it.unitPrice)}</td>
                      <td class="r">${fmtN(it.lineTotals?.rates?.vat || 0)}</td>
                      <td class="r">${fmtN(it.lineTotals?.rates?.withholding || 0)}</td>
                      <td class="r">${fmtN(it.lineTotals?.rates?.discount || 0)}</td>
                      <td class="r">${fmtN(it.lineTotals?.base || 0)}</td>
                    </tr>`
                  )
                  .join("")}</tbody>
              </table></div>`
            : `<p class="fx2-mut t3-small">${esc(o.shortDescription || o.description || "Sem linhas de artigos.")}</p>`
        }
        <div class="rpd-totbar">
          <span>Total s/ IVA <b>${fmtN(o.totals?.base)}</b></span>
          <span>IVA <b>${fmtN(o.totals?.vat)}</b></span>
          <span>Retenção na fonte <b>${fmtN(o.totals?.withheld)}</b></span>
          <span>Total a pagar <b style="font-size:15px">${fmtN(o.totals?.total)} ${esc(r.currency)}</b></span>
          <span>Pago <b>${fmtN(r.paid)}</b></span>
          <span>Em dívida <b class="${r.payable > 0.5 ? "f0-neg" : "fcal-in"}">${fmtN(r.payable)}</b></span>
        </div>
      </section>

      <section class="t3-sec">
        <h3>Documentos</h3>
        <div class="rpd-docs">
          <div class="rpd-docrow"><span>Proforma</span><div>${docFilesHtml(r.pp.files, true)}</div><button type="button" class="finance-btn finance-btn--sm" data-rpdup="pp">Carregar</button></div>
          <div class="rpd-docrow"><span>Faturas</span><div>${docFilesHtml(r.ft.files, true)}</div><button type="button" class="finance-btn finance-btn--sm" data-rpdup="ft">Anexar fatura</button></div>
          <div class="rpd-docrow"><span>Comprovativo</span><div>${docFilesHtml(r.cp.files, true)}</div><button type="button" class="finance-btn finance-btn--sm" data-rpdup="cp">Anexar comprovativo</button></div>
        </div>
      </section>

      <section class="t3-sec">
        <h3>Pagamentos</h3>
        ${savedMsg ? `<div class="rpd-okmsg">✓ ${esc(savedMsg)}</div>` : ""}
        ${
          paidInsts.length
            ? `<div class="fx2-tw"><table class="fx2-t">
                <thead><tr><th>Data</th><th>Conta / Referência</th><th class="r">Valor</th><th>Comprovativo</th><th></th></tr></thead>
                <tbody>${paidInsts
                  .map((inst) => {
                    if (editInstId === inst.id) {
                      const dtVal = toDateKey(inst.paidAt || inst.dueDate) || toDateKey(new Date());
                      return `<tr class="rpd-pged"><td colspan="5">
                        <div class="finance-form-grid finance-form-grid--2" style="margin-bottom:8px">
                          <label class="f0-lbl">Data<input type="date" id="pgeDate" class="finance-input" value="${esc(dtVal)}"></label>
                          <label class="f0-lbl">Valor pago<input type="number" step="0.01" id="pgeVal" class="finance-input" value="${esc(inst.amount)}"></label>
                          <label class="f0-lbl">Conta de saída<select id="pgeCard" class="finance-input">
                            <option value="">— manter / escolher —</option>
                            ${cards.map((c) => `<option value="${esc([c.bank, c.label].filter(Boolean).join(" "))}">${esc([c.bank, c.label, c.lastDigits ? `•${c.lastDigits}` : ""].filter(Boolean).join(" "))}</option>`).join("")}
                          </select></label>
                          <label class="f0-lbl">Referência<input type="text" id="pgeRef" class="finance-input" value="${esc(inst.notes || "")}"></label>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                          <label class="t3-small">Substituir/anexar comprovativo <input type="file" id="pgeFile" accept="application/pdf,image/*"></label>
                          <span style="flex:1"></span>
                          <button type="button" class="finance-btn finance-btn--sm" data-pgedcancel>Cancelar</button>
                          <button type="button" class="finance-btn finance-btn--sm finance-btn--primary" data-pgedsave="${esc(inst.id)}">Gravar</button>
                        </div>
                      </td></tr>`;
                    }
                    return `<tr>
                      <td>${dateOnly(inst.paidAt || inst.dueDate)}</td>
                      <td>${esc(inst.notes || "—")}</td>
                      <td class="r"><b>${fmtN(inst.amount)}</b></td>
                      <td>${docFilesHtml(r.cp.files, true)}</td>
                      <td class="r">${canPay() ? `<button type="button" class="finance-btn finance-btn--sm" data-pged="${esc(inst.id)}" title="Editar pagamento (data, valor, conta, referência, comprovativo)">✎</button>` : ""}</td>
                    </tr>`;
                  })
                  .join("")}</tbody>
              </table></div>`
            : '<p class="fx2-mut t3-small">Sem pagamentos registados neste pedido.</p>'
        }
      </section>

      <section class="t3-sec">
        <h3>Histórico</h3>
        ${
          o.history?.length
            ? `<ul class="rpd-hist">${o.history
                .map((h) => `<li><b>${dateOnly(h.createdAt)}</b> · ${esc(h.userName || "Sistema")} — ${esc(h.action)}${h.notes ? `: ${esc(h.notes)}` : ""}</li>`)
                .join("")}</ul>`
            : '<p class="fx2-mut t3-small">Sem eventos no histórico.</p>'
        }
      </section>`;
  };

  openModal({
    title: "Detalhe da Requisição de Pagamento",
    width: 960,
    contentHtml: `<div data-rpdbody></div>`,
    secondaryLabel: "Fechar",
    onRender: ({ panel, close }) => {
      closeModal = close;
      bodyEl = panel.querySelector("[data-rpdbody]");
      draw();

      bodyEl.addEventListener("click", async (e) => {
        const t = e.target;
        const up = t.closest("[data-rpdup]");
        if (up) {
          return openUploadDocModal(orderId, up.dataset.rpdup, { onDone: draw });
        }
        const delAtt = t.closest("[data-rpddelatt]");
        if (delAtt) {
          if (!window.confirm("Retirar este comprovativo/anexo do pedido? Fica registado no histórico.")) return;
          try {
            await apiRequest(`/purchase-orders/${encodeURIComponent(orderId)}/attachments/${encodeURIComponent(delAtt.dataset.rpddelatt)}`, { method: "DELETE" });
            savedMsg = "Anexo retirado do pedido.";
            await load();
            draw();
          } catch (err) {
            toast(err?.data?.message || err.message || "Falha ao retirar anexo.", { type: "error" });
          }
          return;
        }
        const ed = t.closest("[data-pged]");
        if (ed) {
          editInstId = ed.dataset.pged;
          savedMsg = null;
          draw();
          return;
        }
        if (t.closest("[data-pgedcancel]")) {
          editInstId = null;
          draw();
          return;
        }
        const sv = t.closest("[data-pgedsave]");
        if (sv) {
          const instId = sv.dataset.pgedsave;
          const dt = bodyEl.querySelector("#pgeDate")?.value;
          const val = Number(bodyEl.querySelector("#pgeVal")?.value);
          const card = bodyEl.querySelector("#pgeCard")?.value || "";
          const ref = bodyEl.querySelector("#pgeRef")?.value || "";
          const file = bodyEl.querySelector("#pgeFile")?.files?.[0];
          if (!dt || !(val > 0)) return toast("Indique a data e um valor válido.", { type: "error" });
          sv.disabled = true;
          try {
            const fd = new FormData();
            fd.append("paidAt", dt);
            fd.append("amount", String(val));
            if (card) fd.append("cardLabel", card);
            fd.append("reference", ref);
            if (file) fd.append("comprovativo", file);
            await apiUpload(`/purchase-orders/${encodeURIComponent(orderId)}/payments/${encodeURIComponent(instId)}`, fd, "PATCH");
            editInstId = null;
            savedMsg = `Pagamento atualizado (${fmtN(val)} em ${dateOnly(dt)}).`;
            await load();
            draw();
          } catch (err) {
            sv.disabled = false;
            toast(err?.data?.message || err.message || "Não foi possível gravar.", { type: "error" });
          }
          return;
        }
        const actBtn = t.closest("[data-rpdact]");
        if (actBtn) {
          const r = findRow();
          if (!r) return;
          const act = actBtn.dataset.rpdact;
          if (act === "pagar") {
            closeModal();
            openPayModal(r.rawPayItem, { onSaved: load, cards: cardsList() });
            return;
          }
          try {
            if (act === "aprovar") {
              await apiRequest(`/purchase-orders/${encodeURIComponent(orderId)}/approve`, { method: "POST", body: { decision: "APROVADO" } });
              toast("Requisição aprovada.", { type: "success" });
            } else if (act === "rejeitar") {
              const obs = window.prompt("Motivo da rejeição (opcional):") ?? "";
              await apiRequest(`/purchase-orders/${encodeURIComponent(orderId)}/approve`, { method: "POST", body: { decision: "NAO_APROVADO", observations: obs || null } });
            } else if (act === "pausar") {
              const reason = window.prompt("Motivo para pôr em pausa:");
              if (!reason?.trim()) return;
              await apiRequest(`/purchase-orders/${encodeURIComponent(orderId)}/hold`, { method: "POST", body: { onHold: true, reason: reason.trim() } });
            } else if (act === "retomar") {
              await apiRequest(`/purchase-orders/${encodeURIComponent(orderId)}/hold`, { method: "POST", body: { onHold: false } });
            }
            await load();
            draw();
          } catch (err) {
            toast(err?.data?.message || err.message || "Operação falhou.", { type: "error" });
          }
        }
      });
    },
  });
}

/* ─── Exportar Excel ──────────────────────────────────────────────────────── */

async function exportarExcel() {
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SHEETJS;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Não foi possível carregar o gerador Excel."));
      document.head.appendChild(s);
    }).catch((e) => toast(e.message, { type: "error" }));
  }
  if (!window.XLSX) return;
  const rows = visibleRows().map((r) => ({
    Requisição: r.number,
    Vencimento: dateOnly(r.dueKey),
    Tipo: r.tc,
    "Centro de Custo": r.cc,
    Terceiro: r.beneficiary,
    "Beneficiário Conta": r.benefNome || "",
    IBAN: r.iban || "",
    Produto: r.product,
    "V. a Pagar": r.total,
    Pago: r.paid,
    "Em Dívida": r.payable,
    Moeda: r.currency,
    Estado: r.estLabel,
    Proforma: r.pp.present ? "Sim" : "Não",
    Comprovativo: r.cp.present ? "Sim" : "Não",
    Fatura: r.ft.present ? "Sim" : "Não",
    "Pedido por": r.requestedBy,
  }));
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Centro de Pagamentos");
  window.XLSX.writeFile(wb, `P1 Centro de Pagamentos — ${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* ─── Eventos e Carregamento ──────────────────────────────────────────────── */

function bindEvents() {
  const root = document.getElementById("financeRoot");
  let qTimer = null;

  root.addEventListener("input", (e) => {
    if (e.target.id === "cpSearch") {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        S.f.q = e.target.value;
        renderKpis();
        renderTable();
      }, 150);
    }
  });

  root.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.cpf) {
      S.f[t.dataset.cpf] = t.value;
      refreshAll();
      return;
    }
    if (t.dataset.cpchk) {
      S.f[t.dataset.cpchk] = t.checked;
      refreshAll();
      return;
    }
    if (t.dataset.cppor) {
      const u = t.dataset.cppor;
      S.f.porM = t.checked ? [...new Set([...S.f.porM, u])] : S.f.porM.filter((x) => x !== u);
      refreshAll();
      return;
    }
    if (t.dataset.cpall !== undefined) {
      const vis = visibleRows().filter((r) => r.isOrder);
      if (t.checked) vis.forEach((r) => S.sel.add(r.rowId));
      else vis.forEach((r) => S.sel.delete(r.rowId));
      renderTable();
      return;
    }
    if (t.dataset.cpsel) {
      if (t.checked) S.sel.add(t.dataset.cpsel);
      else S.sel.delete(t.dataset.cpsel);
      renderBulkBar(visibleRows());
      return;
    }
    if (t.id === "cpBulkProofInput") {
      const file = t.files?.[0];
      t.value = "";
      if (!file || !S.sel.size) return;
      try {
        const fd = new FormData();
        fd.append("comprovativo", file);
        fd.append("orderIds", JSON.stringify([...S.sel]));
        const r = await apiUpload("/purchase-orders/bulk-proof", fd, "POST");
        toast(`Comprovativo anexado em ${r.count} pedido(s).`, { type: "success" });
        S.sel.clear();
        await load();
      } catch (err) {
        toast(err?.data?.message || err.message || "Falha ao anexar comprovativo em lote.", { type: "error" });
      }
    }
  });

  root.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-cpporbtn]")) {
      e.stopPropagation();
      S.porOpen = !S.porOpen;
      document.getElementById("cpPorMenu")?.classList.toggle("hidden", !S.porOpen);
      return;
    }
    if (!t.closest(".fcp-mswrap") && S.porOpen) {
      S.porOpen = false;
      document.getElementById("cpPorMenu")?.classList.add("hidden");
    }
    if (t.closest("[data-cpporclr]")) {
      S.f.porM = [];
      S.porOpen = false;
      refreshAll();
      return;
    }
    if (t.closest("[data-cplimpar]")) {
      S.f = { ...FILTROS0, porM: [] };
      refreshAll();
      return;
    }
    const kpi = t.closest("[data-cpkpi]");
    if (kpi) {
      const id = kpi.dataset.cpkpi;
      S.f.kpi = S.f.kpi === id ? "" : id;
      refreshAll();
      return;
    }
    const fila = t.closest("[data-cpfila]");
    if (fila) {
      const v = fila.dataset.cpfila;
      S.f.filaExtra = S.f.filaExtra === v ? "" : v;
      refreshAll();
      return;
    }
    if (t.closest("[data-cpselclr]")) {
      S.sel.clear();
      renderTable();
      return;
    }
    if (t.closest("[data-cpbulkappr]")) {
      const ids = visibleRows()
        .filter((r) => S.sel.has(r.rowId) && r.estCode === "POR_APROVAR")
        .map((r) => r.rowId);
      if (!ids.length) return;
      try {
        for (const id of ids) {
          await apiRequest(`/purchase-orders/${encodeURIComponent(id)}/approve`, { method: "POST", body: { decision: "APROVADO" } });
        }
        toast(`${ids.length} pedido(s) aprovado(s).`, { type: "success" });
        S.sel.clear();
        await load();
      } catch (err) {
        toast(err?.data?.message || err.message || "Falha ao aprovar em lote.", { type: "error" });
      }
      return;
    }
    const rfApp = t.closest("[data-rfapp]");
    if (rfApp) {
      await apiRequest(`/petty-cash/reinforcement-requests/${encodeURIComponent(rfApp.dataset.rfapp)}/approve`, { method: "PATCH" });
      toast("Reforço aprovado.", { type: "success" });
      return load();
    }
    const rfRej = t.closest("[data-rfrej]");
    if (rfRej) {
      const reason = window.prompt("Motivo da rejeição:");
      if (!reason?.trim()) return;
      await apiRequest(`/petty-cash/reinforcement-requests/${encodeURIComponent(rfRej.dataset.rfrej)}/reject`, { method: "PATCH", body: { reason: reason.trim() } });
      toast("Reforço rejeitado.", { type: "info" });
      return load();
    }
    const openBtn = t.closest("[data-cpopen]");
    if (openBtn) return openOrderDetailModal(openBtn.dataset.cpopen);

    const ibanBtn = t.closest("[data-cpiban]");
    if (ibanBtn) {
      const r = allRows().find((x) => x.rowId === ibanBtn.dataset.cpiban);
      if (r) openIbanModal(r);
      return;
    }
    const bkBtn = t.closest("[data-cpbank]");
    if (bkBtn) {
      const r = allRows().find((x) => x.rowId === bkBtn.dataset.cpbank);
      if (r) openBankSummaryModal(r);
      return;
    }
    const estBtn = t.closest("[data-cpest]");
    if (estBtn) {
      const r = allRows().find((x) => x.rowId === estBtn.dataset.cpest);
      if (r) openStateActionsModal(r);
      return;
    }
    const docBtn = t.closest("[data-cpdoc]");
    if (docBtn) {
      const [id, kind] = docBtn.dataset.cpdoc.split("|");
      return openUploadDocModal(id, kind);
    }
    const tr = t.closest("[data-cprow]");
    if (tr && !t.closest("[data-stop], button, a, input")) {
      const r = allRows().find((x) => x.rowId === tr.dataset.cprow);
      if (r?.isOrder) openOrderDetailModal(r.rowId);
    }
  });
}

async function load() {
  try {
    S.data = await apiRequest("/finance/payment-center");
    refreshAll();
  } catch (err) {
    const wrap = document.getElementById("cpTable");
    if (wrap) wrap.innerHTML = `<div class="finance-empty">Falha ao carregar: ${esc(err.message)}</div>`;
    toast(err.message || "Falha ao carregar o Centro de Pagamentos.", { type: "error" });
  }
}

export async function render() {
  destroyCharts();
  const stage = new URLSearchParams(window.location.search).get("stage");
  if (stage === "overdue") S.f.kpi = "atr";
  else if (stage === "paid") S.f.kpi = "pago";
  else if (stage === "schedule") S.f.filaExtra = "schedule";
  else if (stage === "approve") S.f.filaExtra = "approve";
  renderShell();
  await load();
}
