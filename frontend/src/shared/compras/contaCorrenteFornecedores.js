/**
 * C6 Conta Corrente de Fornecedores — o `V.fccf` do protótipo.
 *
 * A lista: por fornecedor, a dívida e a antiguidade pelo vencimento (a vencer,
 * 1–30, 31–60, 61–90, mais de 90 dias), o pago nos últimos 12 meses e o último
 * pagamento. Clicando num fornecedor (`?fornecedor=`) abre-se o extrato: os
 * documentos em aberto e os pagamentos feitos.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtData, kpis, vazio, erro, moedaSeg, root, norm, chip, pesquisa, ligar } from "./ui.js";

const S = { dados: null, ext: null, erro: null, f: "div", q: "", moeda: "AOA" };

const FILTROS = {
  div: (c) => c.saldo > 0.5,
  atr: (c) => c.ag.atr > 0.5,
  a90: (c) => c.ag.b4 > 0.5,
  todos: () => true,
};

function lista() {
  const D = S.dados;
  const L = D.fornecedores;
  const T = D.totais;
  const q = norm(S.q).trim();
  const R = L.filter((c) => FILTROS[S.f](c) && (!q || norm([c.nome, c.nif].join(" ")).includes(q)));
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
    ])}
    <div class="fx2-chips">
      ${chip("f", "div", S.f, "Com Dívida", T.comDivida)}
      ${chip("f", "atr", S.f, "Em Atraso", T.comAtraso)}
      ${chip("f", "a90", S.f, "Atraso +90 Dias", T.com90)}
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
            <td><b>${esc(c.nome)}</b> ${c.nif ? `<span class="fx2-mut">NIF ${esc(c.nif)}</span>` : ""} <span class="fx2-mut">${c.documentos} doc.</span></td>
            <td class="r"><b>${fmt(c.saldo)}</b></td>
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
      Dívida = o que está no Centro de Pagamentos por pagar a cada fornecedor (pagamentos aprovados,
      encomendas aprovadas e pedidos extra), pelo valor a pagar com IVA e retenção. Sem data de vencimento
      conta como «a vencer». Os compromissos ainda por aprovar estão em
      <a href="/compras/compromissos">C5 Compromissos Pendentes</a>. A app ainda não regista notas de crédito de fornecedor.
    </p>`;
}

function extrato() {
  const { fornecedor: x, abertos, pagos } = S.ext;
  const atraso = (d) =>
    d > 0
      ? `<span class="fcal-pill fcal-pill--${d > 90 ? "bad" : "warn"}">${d} d atraso</span>`
      : d === null || d === undefined
        ? `<span class="fcal-pill fcal-pill--slate">sem data</span>`
        : `<span class="fcal-pill fcal-pill--blue">a vencer</span>`;
  return `
    <div class="fx2-barra">
      <button type="button" class="fcal-todos" data-ccback>← Todos os Fornecedores</button>
      <h2 class="fx2-h2">${esc(x.nome)}</h2>
    </div>
    ${kpis([
      { tom: "neu", titulo: "Em Dívida", valor: fmt(x.saldo), nota: `${x.documentos} documento(s)` },
      { tom: x.ag.atr > 0.5 ? "bad" : "good", titulo: "Em Atraso", valor: fmt(x.ag.atr), nota: x.ag.b4 > 0.5 ? `+90 dias: ${fmt(x.ag.b4)}` : "" },
      { tom: "good", titulo: "Pago nos Últimos 12 Meses", valor: fmt(x.pago12m), nota: x.ultPagamento ? `último a ${fmtData(x.ultPagamento)}` : "" },
    ])}
    <div class="fx2-ag">
      <div><span>A vencer</span><b>${fmt(x.ag.av + x.ag.sd)}</b></div>
      <div><span>1–30 dias</span><b>${fmt(x.ag.b1)}</b></div>
      <div><span>31–60 dias</span><b>${fmt(x.ag.b2)}</b></div>
      <div><span>61–90 dias</span><b>${fmt(x.ag.b3)}</b></div>
      <div class="${x.ag.b4 > 0.5 ? "quente" : ""}"><span>+90 dias</span><b>${fmt(x.ag.b4)}</b></div>
    </div>
    <h3 class="cs-sec">Documentos em aberto</h3>
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
      <tfoot><tr><td colspan="7">Total em dívida</td><td class="r">${fmt(abertos.reduce((s, l) => s + l.valor, 0))}</td></tr></tfoot>
      </table></div>`
        : vazio("Nada em aberto. ✓")
    }
    <h3 class="cs-sec">Pagamentos (últimos 12 meses)</h3>
    ${
      pagos.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Data</th><th>Origem</th><th>Obra</th><th>Descrição</th><th>Meio</th><th class="r">Pago</th></tr></thead>
      <tbody>${pagos
        .map(
          (l) => `<tr><td>${fmtData(l.data)}</td><td class="fx2-mut">${esc(l.origem)}</td><td class="fx2-mut">${esc(l.obra || "Sede")}</td>
          <td class="fx2-mut">${esc(String(l.descricao).slice(0, 90))}</td><td class="fx2-mut">${esc(l.meio || "")}</td><td class="r"><b>${fmt(l.valor)}</b></td></tr>`
        )
        .join("")}</tbody>
      <tfoot><tr><td colspan="5">Total pago</td><td class="r">${fmt(pagos.reduce((s, l) => s + l.valor, 0))}</td></tr></tfoot>
      </table></div>`
        : vazio(S.moeda === "AOA" ? "Sem pagamentos registados nos últimos 12 meses." : "Os pagamentos só se mostram em AOA.")
    }`;
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
  url.searchParams.delete("fornecedor");
  window.history.replaceState({}, "", url);
  S.ext = null;
  desenhar();
}

export async function render() {
  ligar(S, desenhar);
  root().addEventListener("click", (e) => {
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
