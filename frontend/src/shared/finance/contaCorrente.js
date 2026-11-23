/**
 * R4 Conta Corrente de Clientes — o `V.fccc` do protótipo.
 *
 * A lista: por cliente, o saldo e a antiguidade (a vencer, 1–30, 31–60,
 * 61–90, mais de 90 dias), com filtros rápidos. Clicando num cliente abre-se
 * o extrato (`?cliente=`): faturas a débito, recebimentos a crédito, saldo
 * corrido e a situação de cada fatura.
 */

import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, codigoNoCabecalho, seg, moedaSeg, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { dados: null, ext: null, f: "div", q: "", moeda: "AOA", erro: null };

const FILTROS = {
  div: (c) => c.saldo > 0.5,
  atr: (c) => c.ag.atr > 0.5,
  a90: (c) => c.ag.b4 > 0.5,
  fav: (c) => c.saldo < -0.5,
  todos: () => true,
};

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function chaveDe(c) {
  return c.id || `nome:${c.nome}`;
}

function saldoHtml(v) {
  return v < -0.5 ? `<span class="fcal-in" title="crédito do cliente">${fmt(v)}</span>` : fmt(v);
}

function lista() {
  const D = S.dados;
  const L = D.clientes;
  const T = D.totais;
  const q = norm(S.q).trim();
  const R = L.filter((c) => FILTROS[S.f](c) && (!q || norm(c.nome).includes(q)));
  const chip = (v, l, n, cl = "") =>
    `<button type="button" class="fx2-chip${cl}${S.f === v ? " on" : ""}" data-cc="f|${v}"><span>${l}</span><b>${n}</b></button>`;
  const soma = (k) => R.reduce((s, c) => s + (k === "saldo" ? c.saldo : k === "av" ? c.ag.av + c.ag.sd : c.ag[k]), 0);

  return `
    ${kpis([
      { tom: "neu", titulo: "Por Receber de Clientes", valor: fmt(T.porReceber), nota: `${T.comSaldo} cliente(s)` },
      {
        tom: T.emAtraso > 0.5 ? "bad" : "good",
        titulo: "Em Atraso",
        valor: fmt(T.emAtraso),
        nota: T.porReceber > 0 ? `${((T.emAtraso / T.porReceber) * 100).toFixed(1)}% do saldo` : "—",
      },
      { tom: T.mais90 > 0.5 ? "bad" : "good", titulo: "Atraso Superior a 90 Dias", valor: fmt(T.mais90), nota: `${T.com90} cliente(s)` },
      { tom: "good", titulo: "Crédito de Clientes", valor: fmt(T.credito), nota: "recebido a mais" },
      { tom: "neu", titulo: "Notas de Crédito", valor: fmt(T.notasCredito || 0), nota: "abatidas às faturas" },
    ])}
    <div class="fx2-chips">
      ${chip("div", "Com Saldo por Receber", T.comSaldo)}
      ${chip("atr", "Em Atraso", T.comAtraso, " bad")}
      ${chip("a90", "Atraso +90 Dias", T.com90, " bad")}
      ${chip("fav", "Com Crédito do Cliente", T.comCredito)}
      ${chip("todos", "Todos", L.length)}
    </div>
    <div class="fcal-filtros">
      <input type="search" class="fcal-q" data-ccq placeholder="cliente…" value="${esc(S.q)}">
      ${moedaSeg("cc", S.moeda, D.moedas)}
      <span class="fx2-ajuda">Clique numa linha para abrir a conta corrente completa. Valores em ${esc(S.moeda)}.</span>
    </div>
    ${
      R.length
        ? `<div class="fx2-tw"><table class="fx2-t">
        <thead><tr><th>Cliente</th><th class="r">Saldo</th><th class="r">A Vencer</th><th class="r">1–30 d</th><th class="r">31–60 d</th><th class="r">61–90 d</th><th class="r">+90 d</th><th>Últ. Recebimento</th></tr></thead>
        <tbody>${R.map(
          (c) => `<tr class="fx2-k-row" data-ccx="${esc(chaveDe(c))}">
            <td><b>${esc(c.nome)}</b> <span class="fx2-mut">${c.faturas} fatura(s)</span></td>
            <td class="r"><b>${saldoHtml(c.saldo)}</b></td>
            <td class="r">${fmt(c.ag.av + c.ag.sd)}</td>
            <td class="r">${fmt(c.ag.b1)}</td>
            <td class="r">${fmt(c.ag.b2)}</td>
            <td class="r">${fmt(c.ag.b3)}</td>
            <td class="r${c.ag.b4 > 0.5 ? " fcal-out" : ""}">${fmt(c.ag.b4)}</td>
            <td>${fmtData(c.ult)}</td>
          </tr>`
        ).join("")}</tbody>
        <tfoot><tr><td>Total (${R.length})</td><td class="r">${saldoHtml(soma("saldo"))}</td><td class="r">${fmt(soma("av"))}</td><td class="r">${fmt(soma("b1"))}</td><td class="r">${fmt(soma("b2"))}</td><td class="r">${fmt(soma("b3"))}</td><td class="r">${fmt(soma("b4"))}</td><td></td></tr></tfoot>
      </table></div>`
        : vazio(L.length ? "Nada a mostrar com estes filtros." : `Ainda não há faturas em ${S.moeda}.`)
    }
    <p class="fcal-nota">
      Saldo = faturas emitidas − recebimentos, pelo valor líquido de cada fatura (o que o cliente tem de
      pagar depois da retenção). O que um cliente pagou a mais numa fatura abate as outras dele, a começar
      pela que vence primeiro; o que sobrar é crédito do cliente (a verde). A antiguidade conta-se pelo
      vencimento. A app ainda não regista notas de crédito.
    </p>`;
}

const SIT = {
  liquidada: `<span class="fcal-pill fcal-pill--slate">Liquidada</span>`,
  aberto: `<span class="fcal-pill fcal-pill--blue">Em aberto</span>`,
};

function extrato() {
  const { conta: x, linhas } = S.ext;
  const sit = (l) => {
    if (l.tipo !== "FT") return "";
    if (l.situacao === "atraso") {
      return `<span class="fcal-pill fcal-pill--${l.atraso > 90 ? "bad" : "warn"}" title="em aberto ${fmt(l.emAberto)}">${l.atraso} d atraso</span>`;
    }
    return SIT[l.situacao] || "";
  };
  const tD = linhas.reduce((s, l) => s + l.deb, 0);
  const tC = linhas.reduce((s, l) => s + l.cred, 0);
  return `
    <div class="fx2-barra">
      <button type="button" class="fcal-todos" data-ccback>← Todos os Clientes</button>
      <h2 class="fx2-h2">${esc(x.nome)}</h2>
    </div>
    ${kpis([
      { tom: "blue", titulo: "Faturado", valor: fmt(x.fat) },
      { tom: "good", titulo: "Recebido", valor: fmt(x.rec), nota: x.ult ? `último a ${fmtData(x.ult)}` : "" },
      {
        tom: x.saldo < -0.5 ? "good" : "neu",
        titulo: x.saldo < -0.5 ? "Crédito do Cliente" : "Saldo a Receber",
        valor: fmt(Math.abs(x.saldo)),
      },
      { tom: x.ag.atr > 0.5 ? "bad" : "good", titulo: "Em Atraso", valor: fmt(x.ag.atr), nota: x.ag.b4 > 0.5 ? `+90 dias: ${fmt(x.ag.b4)}` : "" },
      { tom: "neu", titulo: "Notas de Crédito", valor: fmt(x.nc || 0) },
    ])}
    <div class="fx2-ag">
      <div><span>A vencer</span><b>${fmt(x.ag.av + x.ag.sd)}</b></div>
      <div><span>1–30 dias</span><b>${fmt(x.ag.b1)}</b></div>
      <div><span>31–60 dias</span><b>${fmt(x.ag.b2)}</b></div>
      <div><span>61–90 dias</span><b>${fmt(x.ag.b3)}</b></div>
      <div class="${x.ag.b4 > 0.5 ? "quente" : ""}"><span>+90 dias</span><b>${fmt(x.ag.b4)}</b></div>
    </div>
    <div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Data</th><th>Tipo</th><th>Documento</th><th>Obra</th><th>Descrição</th><th>Vencimento</th><th>Situação</th><th class="r">Débito</th><th class="r">Crédito</th><th class="r">Saldo</th><th></th></tr></thead>
      <tbody>${
        linhas
          .map(
            (l) => `<tr>
          <td>${fmtData(l.data)}</td>
          <td><span class="fx2-tp fx2-tp--${l.tipo}">${l.tipo}</span></td>
          <td><b>${esc(l.doc)}</b></td>
          <td class="fx2-mut">${esc(l.obra)}</td>
          <td class="fx2-mut">${esc(l.descricao)}</td>
          <td class="fx2-mut">${l.venc ? fmtData(l.venc) : ""}</td>
          <td>${sit(l)}</td>
          <td class="r">${l.deb ? fmt(l.deb) : ""}</td>
          <td class="r">${l.cred ? fmt(l.cred) : ""}</td>
          <td class="r"><b>${saldoHtml(l.saldo)}</b></td>
          <td class="g1-acts">${
            !can("financeiro", "edit")
              ? ""
              : l.tipo === "FT" && l.emAberto > 0.005
                ? `<button type="button" class="finance-btn finance-btn--sm" data-ccnc="${esc(l.faturaId)}|${l.emAberto}|${esc(l.doc)}">Nota de crédito</button>`
                : l.tipo === "NC" && l.notaId
                  ? `<button type="button" class="finance-btn finance-btn--sm" data-ccncdel="${esc(l.notaId)}" title="Apagar a nota de crédito"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button>`
                  : ""
          }</td>
        </tr>`
          )
          .join("") || `<tr><td colspan="11" class="fx2-mut">Sem movimentos.</td></tr>`
      }</tbody>
      <tfoot><tr><td colspan="7">Totais</td><td class="r">${fmt(tD)}</td><td class="r">${fmt(tC)}</td><td class="r">${saldoHtml(tD - tC)}</td><td></td></tr></tfoot>
    </table></div>
    <p class="fcal-nota">Débito: faturas emitidas · Crédito: recebimentos e notas de crédito (NC). O saldo corrido é antes de abater o que foi recebido a mais.</p>`;
}

function desenhar() {
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
    S.dados = await apiRequest(`/finance/client-accounts?moeda=${encodeURIComponent(S.moeda)}`);
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

function notaCredito(faturaId, falta, doc) {
  const hoje = new Date().toISOString().slice(0, 10);
  openModal({
    title: `Nota de crédito · ${doc}`,
    primaryLabel: "Emitir",
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field"><label class="finance-label">N.º da nota</label><input id="ncN" class="finance-input" placeholder="NC 2026/001"></div>
      <div class="finance-field"><label class="finance-label">Data</label><input id="ncD" class="finance-input" type="date" value="${hoje}"></div>
      <div class="finance-field"><label class="finance-label">Valor * (até ${fmt(falta)})</label><input id="ncV" class="finance-input" type="number" min="0" step="any" value="${falta}"></div>
      <div class="finance-field"><label class="finance-label">Motivo</label><input id="ncM" class="finance-input" placeholder="ex.: anulação, desconto, devolução"></div>
    </div>`,
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id).value.trim();
      try {
        await apiRequest(`/finance/invoices/${faturaId}/credit-notes`, { method: "POST", body: { numero: $("#ncN") || null, data: $("#ncD"), valor: Number($("#ncV")), motivo: $("#ncM") || null } });
        close();
        toast("Nota de crédito emitida.", { type: "success" });
        abrirExtrato(S.extChave);
      } catch (e) {
        toast(e.message || "Não foi possível emitir.", { type: "error" });
      }
    },
  });
}

async function abrirExtrato(chave) {
  S.extChave = chave;
  const url = new URL(window.location.href);
  url.searchParams.set("cliente", chave);
  window.history.replaceState({}, "", url);
  try {
    S.ext = await apiRequest(
      `/finance/client-accounts/statement?cliente=${encodeURIComponent(chave)}&moeda=${encodeURIComponent(S.moeda)}`
    );
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

function voltar() {
  const url = new URL(window.location.href);
  url.searchParams.delete("cliente");
  window.history.replaceState({}, "", url);
  S.ext = null;
  desenhar();
}

export async function render() {
  codigoNoCabecalho("R4");
  const el = root();
  el.addEventListener("click", (e) => {
    const nc = e.target.closest("[data-ccnc]");
    if (nc) {
      const [id, falta, ...doc] = nc.dataset.ccnc.split("|");
      return notaCredito(id, Number(falta), doc.join("|"));
    }
    const ncd = e.target.closest("[data-ccncdel]");
    if (ncd) {
      if (!confirm("Apagar esta nota de crédito? O valor volta a ficar por receber.")) return;
      return apiRequest(`/finance/credit-notes/${ncd.dataset.ccncdel}`, { method: "DELETE" })
        .then(() => abrirExtrato(S.extChave))
        .catch((err) => toast(err.message || "Não foi possível apagar.", { type: "error" }));
    }
    const b = e.target.closest("[data-cc],[data-ccx],[data-ccback]");
    if (!b) return;
    if (b.dataset.ccback !== undefined) return voltar();
    if (b.dataset.ccx) return abrirExtrato(b.dataset.ccx);
    const [k, v] = b.dataset.cc.split("|");
    if (k === "moeda") {
      S.moeda = v;
      return carregarLista();
    }
    S[k] = v;
    desenhar();
  });
  el.addEventListener("input", (e) => {
    if (e.target.dataset.ccq === undefined) return;
    S.q = e.target.value;
    const pos = e.target.selectionStart;
    desenhar();
    const n = root().querySelector("[data-ccq]");
    if (n) {
      n.focus();
      n.setSelectionRange(pos, pos);
    }
  });

  desenhar();
  await carregarLista();
  const cliente = new URLSearchParams(window.location.search).get("cliente");
  if (cliente) await abrirExtrato(cliente);
}
