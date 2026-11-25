/**
 * C6 / P6 Conta Corrente de Fornecedores — alinhado com `V.fccf` e `V.fccx` do protótipo (v600–v638f):
 *  - Lista: 6 cartões KPI (Dívida a Fornecedores, Em Atraso, Atraso +90 Dias, Pedidos sem Fatura,
 *    Saldo a Nosso Favor, Notas de Crédito), 7 chips de filtro, «+ Saldo Inicial» (v625) e «+ Nota de Crédito / Débito»;
 *  - Extrato: cartão «Retenção na Fonte» (v631), extrato corrido Débito / Crédito / Saldo com linha própria RF a débito,
 *    faturas em aberto, registo/remoção de notas e saldos iniciais, e «⤓ Extrato PDF» para enviar ao fornecedor (v631).
 */

import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, kpis, vazio, erro, moedaSeg, root, norm, chip, pesquisa, ligar } from "./ui.js";

const JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const AUTOTABLE_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js";

const S = { dados: null, ext: null, erro: null, f: "div", q: "", moeda: "AOA" };

const FILTROS = {
  div: (c) => c.saldo > 0.5,
  atr: (c) => c.ag.atr > 0.5,
  a90: (c) => c.ag.b4 > 0.5,
  sft: (c) => (c.semFatura || 0) > 0.5,
  fav: (c) => c.saldo < -0.5,
  lim: (c) => Boolean(c.acimaLimite),
  todos: () => true,
};

const podeEditar = () => can("financeiro", "edit") || can("fornecedores", "edit");

function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Falha ao carregar ${url}`));
    document.head.appendChild(s);
  });
}

function renderHeaderActions() {
  const acts = document.getElementById("financePageActions");
  if (!acts) return;
  const forn = S.ext?.fornecedor || null;
  acts.innerHTML = `
    ${S.ext ? `<button type="button" class="finance-btn" id="ccfPdfBtn">⤓ Extrato PDF</button>` : ""}
    ${
      podeEditar()
        ? `<button type="button" class="finance-btn" id="ccfSiBtn">+ Saldo Inicial</button>
           <button type="button" class="finance-btn finance-btn--primary" id="ccfNcBtn">+ Nota de Crédito / Débito</button>`
        : ""
    }`;
  document.getElementById("ccfSiBtn")?.addEventListener("click", () => abrirModalNota("SI", forn));
  document.getElementById("ccfNcBtn")?.addEventListener("click", () => abrirModalNota("NC", forn));
  document.getElementById("ccfPdfBtn")?.addEventListener("click", () => gerarExtratoPdf().catch((e) => toast(e.message, { type: "error" })));
}

function abrirModalNota(modo, fornPreset = null) {
  const isSi = modo === "SI";
  const lastYearEnd = `${new Date().getFullYear() - 1}-12-31`;
  const today = new Date().toISOString().slice(0, 10);
  const sups = S.dados?.suppliers || (S.dados?.fornecedores || []).map((f) => ({ id: f.id, name: f.nome }));

  openModal({
    title: isSi ? "Saldo Inicial de Fornecedor" : "Nota de Crédito / Débito de Fornecedor",
    width: 620,
    primaryLabel: "Gravar",
    contentHtml: `
      <p class="fx2-mut t3-small" style="margin:0 0 10px">${
        isSi
          ? "Dívida ou crédito antigo que não está no sistema (ex.: saldo do ano anterior). Entra na conta corrente na data indicada; não cria movimentos no banco."
          : "Fica na conta corrente do fornecedor e abate (NC) ou aumenta (ND) o saldo. Não cria movimentos no banco."
      }</p>
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field finance-field--full">
          <label class="finance-label">Fornecedor *</label>
          <input id="ncfForn" list="ncfFornList" class="finance-input" value="${esc(fornPreset?.nome || "")}" placeholder="Nome do fornecedor">
          <datalist id="ncfFornList">${sups.map((s) => `<option value="${esc(s.name)}">`).join("")}</datalist>
        </div>
        ${
          isSi
            ? `<div class="finance-field">
                 <label class="finance-label">Natureza do saldo *</label>
                 <select id="ncfSentido" class="finance-select">
                   <option value="DIVIDA_FORN">Dívida ao fornecedor (a pagar)</option>
                   <option value="CREDITO_NOSSO">Crédito a nosso favor</option>
                 </select>
               </div>`
            : `<div class="finance-field">
                 <label class="finance-label">Tipo *</label>
                 <select id="ncfTipo" class="finance-select">
                   <option value="NC">NC — Nota de Crédito (abate dívida)</option>
                   <option value="ND">ND — Nota de Débito (aumenta dívida)</option>
                 </select>
               </div>`
        }
        <div class="finance-field">
          <label class="finance-label">N.º do documento ${isSi ? "(opcional)" : ""}</label>
          <input id="ncfNum" class="finance-input" placeholder="${isSi ? "se houver" : "vazio = ainda por receber"}">
        </div>
        <div class="finance-field">
          <label class="finance-label">Data *</label>
          <input id="ncfData" type="date" class="finance-input" value="${isSi ? lastYearEnd : today}">
        </div>
        <div class="finance-field">
          <label class="finance-label">Vencimento</label>
          <input id="ncfVenc" type="date" class="finance-input" value="${isSi ? lastYearEnd : ""}">
        </div>
        <div class="finance-field">
          <label class="finance-label">Valor (${esc(S.moeda)}) *</label>
          <input id="ncfValor" type="number" step="0.01" min="0" class="finance-input">
        </div>
        <div class="finance-field">
          <label class="finance-label">Pedido relacionado (opcional)</label>
          <input id="ncfPed" class="finance-input" placeholder="ex.: REQ-2026-0001">
        </div>
        <div class="finance-field finance-field--full">
          <label class="finance-label">Motivo / Descrição</label>
          <input id="ncfMotivo" class="finance-input" value="${isSi ? "Saldo do ano anterior" : ""}">
        </div>
      </div>`,
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id)?.value?.trim() || "";
      const fornName = $("#ncfForn");
      const valor = Number($("#ncfValor"));
      const data = $("#ncfData");
      if (!fornName) return toast("Indique o fornecedor.", { type: "error" });
      if (!(valor > 0)) return toast("Indique um valor maior que zero.", { type: "error" });
      if (!data) return toast("Indique a data.", { type: "error" });
      const matchSup = sups.find((s) => norm(s.name) === norm(fornName));
      try {
        await apiRequest("/compras-stock/supplier-notes", {
          method: "POST",
          body: {
            tipo: isSi ? "SI" : $("#ncfTipo") || "NC",
            sentido: isSi ? $("#ncfSentido") || "DIVIDA_FORN" : undefined,
            fornecedorId: fornPreset?.id || matchSup?.id || null,
            fornecedor: matchSup?.name || fornName,
            num: $("#ncfNum") || null,
            data,
            venc: $("#ncfVenc") || null,
            valor,
            moeda: S.moeda,
            pedidoNum: $("#ncfPed") || null,
            motivo: $("#ncfMotivo") || null,
          },
        });
        toast("Registo gravado na conta corrente.", { type: "success" });
        close();
        const curKey = new URLSearchParams(window.location.search).get("fornecedor");
        await carregarLista();
        if (curKey) await abrirExtrato(curKey);
      } catch (e) {
        toast(e?.data?.message || e.message || "Não foi possível gravar.", { type: "error" });
      }
    },
  });
}

async function gerarExtratoPdf() {
  if (!S.ext) return;
  await loadScript(JSPDF_URL);
  await loadScript(AUTOTABLE_URL);
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) throw new Error("Gerador PDF indisponível.");

  const { fornecedor: x, extrato: E = [], abertos = [] } = S.ext;
  const hoje = new Date().toISOString().slice(0, 10);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  const M = 14;
  const dk = [27, 39, 54];
  const gr = [31, 163, 107];
  const mu = [93, 107, 124];

  const fat = E.filter((l) => ["FT", "PD", "ND", "SI"].includes(l.tp)).reduce((s, l) => s + (l.cred || 0), 0);
  const rf = E.filter((l) => l.tp === "RF").reduce((s, l) => s + (l.deb || 0), 0);
  const pg = E.filter((l) => l.tp === "PG").reduce((s, l) => s + (l.deb || 0), 0);
  const nc = E.filter((l) => l.tp === "NC").reduce((s, l) => s + (l.deb || 0), 0);
  const saldo = E.length ? E[E.length - 1].saldo : x.saldo;

  doc.setTextColor(...dk);
  doc.setFontSize(15);
  doc.text("Extrato de Conta Corrente — Fornecedor", W - M, 15, { align: "right" });
  doc.setFontSize(9);
  doc.setTextColor(...mu);
  doc.text(`Data: ${fmtData(hoje)} · Moeda: ${S.moeda}`, W - M, 21, { align: "right" });
  doc.setDrawColor(...gr);
  doc.setLineWidth(0.5);
  doc.line(M, 25, W - M, 25);

  doc.setFontSize(8);
  doc.text("FORNECEDOR", M, 31);
  doc.setFontSize(11);
  doc.setTextColor(...dk);
  doc.text(String(x.nome || ""), M, 36);
  doc.setFontSize(8.5);
  doc.setTextColor(...mu);
  if (x.nif) doc.text(`NIF: ${x.nif}`, M, 41);

  doc.setFontSize(8);
  doc.text("EMPRESA", W / 2, 31);
  doc.setFontSize(11);
  doc.setTextColor(...dk);
  doc.text("MBT Energia, Lda", W / 2, 36);

  const box = [
    ["Faturado / Requisitado (bruto)", fat],
    ["Retenção na fonte (entregue ao Estado)", -rf],
    ["Pagamentos efetuados", -pg],
    ...(nc > 0 ? [["Notas de crédito", -nc]] : []),
  ];
  let y = 48;
  box.forEach(([l, v]) => {
    doc.setFontSize(9);
    doc.setTextColor(...mu);
    doc.text(l, M + 2, y);
    doc.setTextColor(...dk);
    doc.text(fmt(v), W - M - 2, y, { align: "right" });
    y += 5.5;
  });
  doc.setFont(undefined, "bold");
  doc.setFontSize(10.5);
  doc.text("Saldo a pagar ao fornecedor", M + 2, y + 2);
  doc.text(`${fmt(saldo)} ${S.moeda}`, W - M - 2, y + 2, { align: "right" });
  doc.setFont(undefined, "normal");
  y += 10;

  doc.autoTable({
    startY: y,
    margin: { left: M, right: M, bottom: 16 },
    head: [["Data", "Tipo", "Documento", "Descrição", "Vencimento", "Débito", "Crédito", "Saldo"]],
    body: E.map((l) => [
      fmtData(l.data),
      l.tp,
      l.doc || "",
      String(l.desc || "").slice(0, 110),
      l.venc ? fmtData(l.venc) : "",
      l.deb ? fmt(l.deb) : "",
      l.cred ? fmt(l.cred) : "",
      fmt(l.saldo),
    ]),
    foot: [["", "", "", "Totais", "", fmt(E.reduce((s, l) => s + (l.deb || 0), 0)), fmt(E.reduce((s, l) => s + (l.cred || 0), 0)), fmt(saldo)]],
    styles: { fontSize: 7.8, cellPadding: 1.5, textColor: dk },
    headStyles: { fillColor: [238, 242, 245], textColor: dk, fontStyle: "bold" },
    footStyles: { fillColor: [248, 250, 252], textColor: dk, fontStyle: "bold" },
    columnStyles: { 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
  });

  y = doc.lastAutoTable.finalY + 8;
  if (abertos.length) {
    if (y > 175) {
      doc.addPage();
      y = 18;
    }
    doc.setFontSize(10);
    doc.text("Documentos em aberto", M, y);
    doc.autoTable({
      startY: y + 2,
      margin: { left: M, right: M, bottom: 16 },
      head: [["Documento", "Data", "Obra", "Vencimento", "Situação", "Em aberto"]],
      body: abertos.map((a) => [
        a.documento || a.origem,
        fmtData(a.data),
        a.obra || "Sede",
        a.vencimento ? fmtData(a.vencimento) : "",
        a.diasAtraso > 0 ? `${a.diasAtraso} dias de atraso` : "a vencer",
        fmt(a.valor),
      ]),
      styles: { fontSize: 8, cellPadding: 1.5, textColor: dk },
      headStyles: { fillColor: [238, 242, 245], textColor: dk, fontStyle: "bold" },
      columnStyles: { 5: { halign: "right", fontStyle: "bold" } },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  doc.setFontSize(7.5);
  doc.setTextColor(...mu);
  doc.text(
    `A retenção na fonte sobre serviços é descontada no pagamento e entregue ao Estado em nome do fornecedor. Valores em ${S.moeda}.`,
    M,
    Math.min(200, y)
  );
  doc.save(`Extrato Conta Corrente - ${String(x.nome).replace(/[\\/:*?"<>|]/g, "")} - ${hoje}.pdf`);
}

function lista() {
  const D = S.dados;
  const L = D.fornecedores;
  const T = D.totais;
  const q = norm(S.q).trim();
  const fn = FILTROS[S.f] || FILTROS.todos;
  const R = L.filter((c) => fn(c) && (!q || norm([c.nome, c.nif].join(" ")).includes(q)));
  const soma = (k) => R.reduce((s, c) => s + (k === "saldo" ? c.saldo : k === "av" ? c.ag.av + c.ag.sd : c.ag[k]), 0);
  return `
    ${kpis([
      { tom: "neu", titulo: "Dívida a Fornecedores", valor: fmt(T.divida), nota: `${T.comDivida} fornecedor(es)` },
      {
        tom: T.emAtraso > 0.5 ? "bad" : "good",
        titulo: "Em Atraso",
        valor: fmt(T.emAtraso),
        nota: T.divida > 0 ? `${((T.emAtraso / T.divida) * 100).toFixed(1)}% da dívida` : "—",
      },
      { tom: T.mais90 > 0.5 ? "bad" : "good", titulo: "Atraso Superior a 90 Dias", valor: fmt(T.mais90), nota: `${T.com90} fornecedor(es)` },
      { tom: (T.semFatura || 0) > 0.5 ? "warn" : "neu", titulo: "Pedidos sem Fatura", valor: fmt(T.semFatura || 0), nota: `${T.comSemFatura || 0} fornecedor(es)` },
      { tom: "good", titulo: "Saldo a Nosso Favor", valor: fmt(T.aNossoFavor || 0), nota: "NC por usar e pagamentos a mais" },
      { tom: "neu", titulo: "Notas de Crédito", valor: fmt(T.notasCredito || 0), nota: "total registado" },
    ])}
    <div class="fx2-chips">
      ${chip("f", "div", S.f, "Com Dívida", T.comDivida)}
      ${chip("f", "atr", S.f, "Em Atraso", T.comAtraso)}
      ${chip("f", "a90", S.f, "Atraso +90 Dias", T.com90)}
      ${chip("f", "sft", S.f, "Com Pedidos sem Fatura", T.comSemFatura || 0)}
      ${chip("f", "fav", S.f, "Saldo a Nosso Favor", T.comFavor || 0)}
      ${chip("f", "lim", S.f, "Acima do Limite de Crédito", T.comAcimaLimite || 0)}
      ${chip("f", "todos", S.f, "Todos", L.length)}
    </div>
    <div class="fcal-filtros">
      ${pesquisa(S, "fornecedor ou NIF…")}
      ${moedaSeg("ccf", S.moeda, D.moedas)}
      <span class="fx2-ajuda">Clique numa linha para ver o extrato. Valores em ${esc(S.moeda)}.</span>
    </div>
    ${
      R.length
        ? `<div class="fx2-tw"><table class="fx2-t">
        <thead><tr><th>Fornecedor</th><th class="r">Em Dívida</th><th class="r">A Vencer</th><th class="r">1–30 d</th><th class="r">31–60 d</th><th class="r">61–90 d</th><th class="r">+90 d</th><th class="r">Pago (12 meses)</th><th>Últ. Pagamento</th></tr></thead>
        <tbody>${R.map(
          (c) => `<tr class="fx2-k-row" data-ccx="${esc(c.chave)}">
            <td><b>${esc(c.nome)}</b> ${c.nif ? `<span class="fx2-mut">NIF ${esc(c.nif)}</span>` : ""} <span class="fx2-mut">${c.documentos} doc.</span>${c.acimaLimite ? ' <span class="fcal-pill fcal-pill--bad" title="Acima do limite de crédito">limite!</span>' : ""}</td>
            <td class="r"><b class="${c.saldo < -0.5 ? "fcal-in" : ""}">${fmt(c.saldo)}</b></td>
            <td class="r">${fmt(c.ag.av + c.ag.sd)}</td>
            <td class="r">${fmt(c.ag.b1)}</td>
            <td class="r">${fmt(c.ag.b2)}</td>
            <td class="r">${fmt(c.ag.b3)}</td>
            <td class="r${c.ag.b4 > 0.5 ? " fcal-out" : ""}">${fmt(c.ag.b4)}</td>
            <td class="r fx2-mut">${fmt(c.pago12m)}</td>
            <td>${fmtData(c.ultPagamento)}</td>
          </tr>`
        ).join("")}</tbody>
        <tfoot><tr><td>Total (${R.length})</td><td class="r">${fmt(soma("saldo"))}</td><td class="r">${fmt(soma("av"))}</td><td class="r">${fmt(soma("b1"))}</td><td class="r">${fmt(soma("b2"))}</td><td class="r">${fmt(soma("b3"))}</td><td class="r">${fmt(soma("b4"))}</td><td></td><td></td></tr></tfoot>
      </table></div>`
        : vazio(L.length ? "Nada a mostrar com estes filtros." : `Sem contas a pagar a fornecedores em ${S.moeda}.`)
    }
    <p class="fcal-nota">
      Dívida = faturas e pedidos aprovados por pagar a cada fornecedor, ajustada por saldos iniciais e notas de crédito/débito.
      Os compromissos ainda por aprovar estão em <a href="/compras/compromissos">C5 Compromissos Pendentes</a>.
    </p>`;
}

function extrato() {
  const { fornecedor: x, abertos = [], extrato: E = [] } = S.ext;
  const from = new URLSearchParams(window.location.search).get("from");
  const backLabel = from === "mapa-obrigacoes" ? "← Mapa de Obrigações" : "← Todos os Fornecedores";
  const rfTot = E.filter((l) => l.tp === "RF").reduce((s, l) => s + (l.deb || 0), 0);
  const ncLiq = (x.ncTotal || 0) - (x.ndTotal || 0);
  const tpBadge = {
    FT: ["FT", "blue"],
    PD: ["PD", "slate"],
    RF: ["RF", "warn"],
    PG: ["PG", "good"],
    NC: ["NC", "good"],
    ND: ["ND", "bad"],
    SI: ["SI", "slate"],
  };

  const atraso = (d) =>
    d > 0
      ? `<span class="fcal-pill fcal-pill--${d > 90 ? "bad" : "warn"}">${d} d atraso</span>`
      : d === null || d === undefined
        ? `<span class="fcal-pill fcal-pill--slate">sem data</span>`
        : `<span class="fcal-pill fcal-pill--blue">a vencer</span>`;

  return `
    <div class="fx2-barra">
      <button type="button" class="fcal-todos" data-ccback>${esc(backLabel)}</button>
      <h2 class="fx2-h2">${esc(x.nome)}${x.nif ? ` <small class="fx2-mut">NIF ${esc(x.nif)}</small>` : ""}</h2>
    </div>
    ${kpis([
      { tom: x.saldo < -0.5 ? "good" : "neu", titulo: x.saldo < -0.5 ? "Saldo a Nosso Favor" : "Em Dívida", valor: fmt(Math.abs(x.saldo)), nota: `${x.documentos} documento(s)` },
      { tom: x.ag.atr > 0.5 ? "bad" : "good", titulo: "Em Atraso", valor: fmt(x.ag.atr), nota: x.ag.b4 > 0.5 ? `+90 dias: ${fmt(x.ag.b4)}` : "" },
      { tom: "warn", titulo: "Retenção na Fonte", valor: fmt(rfTot), nota: "a débito, entregue ao Estado" },
      { tom: ncLiq >= 0 ? "good" : "warn", titulo: "NC (− ND)", valor: fmt(ncLiq), nota: "notas de crédito / débito" },
      { tom: "good", titulo: "Pago nos Últimos 12 Meses", valor: fmt(x.pago12m), nota: x.ultPagamento ? `último a ${fmtData(x.ultPagamento)}` : "" },
    ])}
    <div class="fx2-ag">
      <div><span>A vencer</span><b>${fmt(x.ag.av + x.ag.sd)}</b></div>
      <div><span>1–30 dias</span><b>${fmt(x.ag.b1)}</b></div>
      <div><span>31–60 dias</span><b>${fmt(x.ag.b2)}</b></div>
      <div><span>61–90 dias</span><b>${fmt(x.ag.b3)}</b></div>
      <div class="${x.ag.b4 > 0.5 ? "quente" : ""}"><span>+90 dias</span><b>${fmt(x.ag.b4)}</b></div>
    </div>

    <h3 class="cs-sec">Movimentos da Conta Corrente (${E.length})</h3>
    ${
      E.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Data</th><th>Tipo</th><th>Documento</th><th>Pedido</th><th>Obra</th><th>Descrição</th><th>Vencimento</th><th class="r">Débito</th><th class="r">Crédito</th><th class="r">Saldo</th><th></th></tr></thead>
      <tbody>${E.map((l) => {
        const [tl, tc] = tpBadge[l.tp] || [l.tp, "slate"];
        return `<tr${l.orderId ? ` class="fx2-k-row" data-ccorder="${esc(l.orderId)}" title="Clique para abrir no Centro de Pagamentos"` : ""}>
          <td>${fmtData(l.data)}</td>
          <td><span class="fcal-pill fcal-pill--${tc}">${esc(tl)}</span></td>
          <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.doc || "")}"><b>${esc(l.doc || "—")}</b></td>
          <td class="fx2-mut">${esc(l.pedido || "")}</td>
          <td class="fx2-mut">${esc(l.obra || "")}</td>
          <td>${esc(l.desc || "")}</td>
          <td class="fx2-mut">${l.venc ? fmtData(l.venc) : ""}</td>
          <td class="r fcal-in">${l.deb ? fmt(l.deb) : ""}</td>
          <td class="r">${l.cred ? fmt(l.cred) : ""}</td>
          <td class="r"><b>${fmt(l.saldo)}</b></td>
          <td class="r">${l.noteId && podeEditar() ? `<button type="button" class="finance-btn finance-btn--sm" data-ncfdel="${esc(l.noteId)}" title="Apagar nota / saldo inicial">×</button>` : ""}</td>
        </tr>`;
      }).join("")}</tbody>
      <tfoot><tr class="f0-tot"><td colspan="7">Totais</td><td class="r">${fmt(E.reduce((s, l) => s + (l.deb || 0), 0))}</td><td class="r">${fmt(E.reduce((s, l) => s + (l.cred || 0), 0))}</td><td class="r">${fmt(E[E.length - 1].saldo)}</td><td></td></tr></tfoot>
      </table></div>`
        : vazio("Sem movimentos registados.")
    }

    <h3 class="cs-sec">Documentos em aberto (${abertos.length})</h3>
    ${
      abertos.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Data</th><th>Documento</th><th>Origem</th><th>Obra</th><th>Descrição</th><th>Vencimento</th><th>Situação</th><th class="r">Por Pagar</th></tr></thead>
      <tbody>${abertos
        .map(
          (l) => `<tr>
          <td>${fmtData(l.data)}</td><td><b>${esc(l.documento || "—")}</b></td><td class="fx2-mut">${esc(l.origem)}</td>
          <td class="fx2-mut">${esc(l.obra || "Sede")}</td><td class="fx2-mut">${esc(String(l.descricao).slice(0, 90))}</td>
          <td class="fx2-mut">${l.vencimento ? fmtData(l.vencimento) : ""}</td><td>${atraso(l.diasAtraso)}</td>
          <td class="r"><b>${fmt(l.valor)}</b></td></tr>`
        )
        .join("")}</tbody>
      <tfoot><tr><td colspan="7">Total em aberto</td><td class="r">${fmt(abertos.reduce((s, l) => s + l.valor, 0))}</td></tr></tfoot>
      </table></div>`
        : vazio("Nada em aberto.")
    }`;
}

function desenhar() {
  renderHeaderActions();
  const el = root();
  if (S.erro) el.innerHTML = erro(S.erro);
  else if (S.ext) el.innerHTML = extrato();
  else if (S.dados) el.innerHTML = lista();
  else el.innerHTML = vazio("A carregar…");
}

async function carregarLista() {
  S.ext = null;
  S.erro = null;
  try {
    S.dados = await apiRequest(`/compras-stock/supplier-accounts?moeda=${encodeURIComponent(S.moeda)}`);
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

async function abrirExtrato(chave) {
  const url = new URL(window.location.href);
  url.searchParams.set("fornecedor", chave);
  window.history.replaceState({}, "", url);
  try {
    S.ext = await apiRequest(
      `/compras-stock/supplier-accounts?fornecedor=${encodeURIComponent(chave)}&moeda=${encodeURIComponent(S.moeda)}`
    );
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

function voltar() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("from") === "mapa-obrigacoes") {
    window.location.href = "/Financeiro/mapa-obrigacoes";
    return;
  }
  url.searchParams.delete("fornecedor");
  window.history.replaceState({}, "", url);
  S.ext = null;
  desenhar();
}

export async function render() {
  ligar(S, desenhar);
  root().addEventListener("click", async (e) => {
    const del = e.target.closest("[data-ncfdel]");
    if (del) {
      e.stopPropagation();
      if (!window.confirm("Apagar este registo da conta corrente?")) return;
      await apiRequest(`/compras-stock/supplier-notes/${encodeURIComponent(del.dataset.ncfdel)}`, { method: "DELETE" });
      const curKey = new URLSearchParams(window.location.search).get("fornecedor");
      await carregarLista();
      if (curKey) await abrirExtrato(curKey);
      return;
    }
    const ord = e.target.closest("[data-ccorder]");
    if (ord && !e.target.closest("button")) {
      window.location.href = "/Financeiro/centro-pagamentos";
      return;
    }
    const b = e.target.closest("[data-ccf],[data-ccx],[data-ccback]");
    if (!b) return;
    if (b.dataset.ccback !== undefined) return voltar();
    if (b.dataset.ccx) return abrirExtrato(b.dataset.ccx);
    const [k, v] = b.dataset.ccf.split("|");
    if (k === "moeda") {
      S.moeda = v;
      carregarLista();
    }
  });
  desenhar();
  await carregarLista();
  const f = new URLSearchParams(window.location.search).get("fornecedor");
  if (f) await abrirExtrato(f);
}
