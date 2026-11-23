/**
 * F0 Painel Financeiro — a parte de cima do ecrã, como o `V.fhome` do protótipo:
 *
 *  - período (Mês · Trimestre · Ano · 12 Meses · Intervalo) e obra
 *    («Todas as Obras e Sede» ou uma só);
 *  - «Resultado do período»: faturação s/ IVA, recebido, custos pagos e cash
 *    líquido, cada um comparado com o período anterior do mesmo tamanho;
 *  - «Posição atual»: saldo bancário, por receber, por pagar e margem prevista;
 *  - faturação, recebimentos e custos nos 12 meses até ao fim do período;
 *  - custos pagos por natureza, fluxos de caixa por natureza e desempenho por obra.
 *
 * Os números vêm de `/finance/dashboard`. Uma moeda de cada vez.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, kpis, seg, moedaSeg, vazio, erro } from "./f2Ui.js";
import { drawComboChart, chartCardHtml } from "./charts.js";

const PERIODOS = [
  ["mes", "Mês"],
  ["trimestre", "Trimestre"],
  ["ano", "Ano"],
  ["12m", "12 Meses"],
  ["intervalo", "Intervalo"],
];

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const st = { p: "ano", ano: "", mes: "", de: "", ate: "", obra: "", moeda: "AOA", data: null, el: null };

const pc = (v) => (v === null || v === undefined ? "—" : `${(Number(v) * 100).toLocaleString("pt-PT", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`);

function vs(v, v0) {
  if (!(v0 > 0)) return "sem comparação";
  const sobe = v >= v0;
  const d = Math.abs(v / v0 - 1) * 100;
  return `<span class="f0-vs f0-vs--${sobe ? "up" : "down"}">${sobe ? "▲" : "▼"} ${d.toLocaleString("pt-PT", { maximumFractionDigits: 0 })}%</span> vs. período anterior`;
}

function query() {
  const q = new URLSearchParams({ p: st.p, moeda: st.moeda });
  if (st.p === "ano" && st.ano) q.set("ano", st.ano);
  if (st.p === "mes" || st.p === "trimestre") if (st.mes) q.set("mes", st.mes);
  if (st.p === "intervalo" && st.de && st.ate) {
    q.set("de", st.de);
    q.set("ate", st.ate);
  }
  if (st.obra) q.set("obra", st.obra);
  return q.toString();
}

function filtrosHtml(d) {
  const hoje = d?.hoje || new Date().toISOString().slice(0, 10);
  const obras = (d?.listaObras || []).filter((o) => o.moeda === st.moeda || !o.moeda);
  let extra = "";
  if (st.p === "mes" || st.p === "trimestre")
    extra = `<label class="f0-lbl">Mês<input class="finance-input" type="month" data-f0="mes" value="${esc(st.mes || hoje.slice(0, 7))}"></label>`;
  if (st.p === "ano")
    extra = `<label class="f0-lbl">Ano<input class="finance-input f0-ano" type="number" min="2000" max="2100" data-f0="ano" value="${esc(st.ano || hoje.slice(0, 4))}"></label>`;
  if (st.p === "intervalo")
    extra = `<label class="f0-lbl">De<input class="finance-input" type="date" data-f0="de" value="${esc(st.de || d?.periodo?.de || "")}"></label>
      <label class="f0-lbl">Até<input class="finance-input" type="date" data-f0="ate" value="${esc(st.ate || d?.periodo?.ate || "")}"></label>`;
  return `<div class="f0-filtros">
    ${seg("f0seg", "p", st.p, PERIODOS)}
    ${extra}
    <label class="f0-lbl">Obra<select class="finance-input f0-obra" data-f0="obra">
      <option value="">Todas as Obras e Sede</option>
      ${obras.map((o) => `<option value="${esc(o.id)}"${o.id === st.obra ? " selected" : ""}>${esc([o.codigo, o.nome].filter(Boolean).join(" · "))}</option>`).join("")}
    </select></label>
    ${moedaSeg("f0seg", st.moeda, d?.moedas)}
    <span class="f0-rot">${esc(d?.periodo?.rotulo || "")} · valores em ${esc(st.moeda)}</span>
  </div>`;
}

function resultadoHtml(d) {
  const r = d.resultado;
  const a = d.anterior || {};
  return kpis([
    { tom: "neu", titulo: "Faturação (s/ IVA)", valor: fmt(r.faturacao), nota: `${r.faturas} fatura(s) · ${vs(r.faturacao, a.faturacao)}`, acao: "/Financeiro/faturacao/registar" },
    { tom: "good", titulo: "Recebido (c/ IVA)", valor: fmt(r.recebido), nota: `${r.recebimentos} recebimento(s) · ${vs(r.recebido, a.recebido)}`, acao: "/Financeiro/tesouraria/recebimentos" },
    { tom: "warn", titulo: "Custos Pagos", valor: fmt(r.custos), nota: `${r.pagamentos} pagamento(s) · ${vs(r.custos, a.custos)}`, acao: "/Financeiro/centro-pagamentos" },
    { tom: r.cash >= 0 ? "good" : "bad", titulo: "Cash Líquido", valor: fmt(r.cash), nota: "recebido − custos pagos", acao: "/Financeiro/mapa-fluxos" },
  ]);
}

function posicaoHtml(d) {
  const p = d.posicao;
  return kpis([
    p.saldo === null
      ? { tom: "neu", titulo: "Saldo Bancário", valor: "—", nota: "as contas não são de uma obra" }
      : { tom: "good", titulo: "Saldo Bancário", valor: fmt(p.saldo), nota: `${p.contas} conta(s)`, acao: "/Financeiro/contas-saldos" },
    { tom: p.porReceberAtraso > 0.5 ? "warn" : "neu", titulo: "Por Receber de Clientes", valor: fmt(p.porReceber), nota: `${fmt(p.porReceberAtraso)} em atraso`, acao: "/Financeiro/contas?tab=receber" },
    { tom: p.porPagarAtraso > 0.5 ? "bad" : "neu", titulo: "Por Pagar a Fornecedores", valor: fmt(p.porPagar), nota: `${fmt(p.porPagarAtraso)} em atraso`, acao: "/Financeiro/contas?tab=pagar" },
    { tom: p.desvio > 0.5 ? "warn" : "good", titulo: "Margem Prevista das Obras", valor: pc(p.margemPct), nota: `${fmt(p.margem)} · desvio de custo ${pc(p.desvioPct)}`, acao: "/Financeiro/controlo" },
  ]);
}

function naturezaHtml(d) {
  const L = d.natureza || [];
  if (!L.length) return vazio("Sem custos pagos no período.");
  const tot = d.resultado.custos || 0;
  const max = L[0].v || 1;
  return `<table class="fx2-t f0-nat"><tbody>${L.map(
    (x) => `<tr><td>${esc(x.k)}<div class="f0-bar"><i style="width:${Math.max(2, (x.v / max) * 100)}%"></i></div></td>
      <td class="r"><b>${fmt(x.v)}</b><div class="fx2-mut">${tot ? pc(x.v / tot) : "—"}</div></td></tr>`
  ).join("")}<tr class="f0-tot"><td>Total</td><td class="r">${fmt(tot)}</td></tr></tbody></table>`;
}

function fluxosHtml(d) {
  const F = d.fluxos;
  if (!F) return "";
  const linha = (l, v, forte) =>
    `<tr${forte ? ' class="f0-tot"' : ""}><td${forte ? "" : ' class="f0-ind"'}>${esc(l)}</td><td class="r${v < 0 ? " f0-neg" : ""}">${forte ? `<b>${fmt(v)}</b>` : fmt(v)}</td></tr>`;
  const grupo = (g, l) => linha(l, g.total, true) + g.linhas.map((x) => linha(x.k, x.v)).join("");
  const corpo = F.movimentos
    ? `<div class="f0-flx">
        <table class="fx2-t"><tbody>${grupo(F.operacionais, "Atividades Operacionais")}</tbody></table>
        <table class="fx2-t"><tbody>${grupo(F.investimento, "Atividades de Investimento")}${grupo(F.financiamento, "Atividades de Financiamento")}${
          F.porClassificar.total ? grupo(F.porClassificar, "Por Classificar") : ""
        }<tr class="f0-tot"><td><b>Variação de Caixa</b></td><td class="r${F.variacao < 0 ? " f0-neg" : ""}"><b>${fmt(F.variacao)}</b></td></tr></tbody></table>
      </div>`
    : vazio("Sem movimentos bancários no período. Os fluxos aparecem quando se importarem os extratos (T3).");
  return `<section class="finance-card f0-blk"><h3 class="f0-h3">Fluxos de Caixa por Natureza <small>· movimentos bancários do período (AOA), sem transferências entre contas</small></h3>${corpo}</section>`;
}

function obrasHtml(d) {
  const L = (d.obras || []).filter((o) => o.venda || o.custo || o.faturado);
  if (!L.length) return vazio("Sem obras com contrato ou custos nesta moeda.");
  return `<div class="fx2-tw"><table class="fx2-t">
    <thead><tr><th>Obra</th><th class="r">Contrato</th><th class="r">Faturado</th><th class="r">Recebido</th><th class="r">Por Receber</th><th class="r">Custo Real</th><th class="r">Margem Prev.</th></tr></thead>
    <tbody>${L.map(
      (o) => `<tr class="f0-row" data-f0obra="${esc(o.id)}"><td><b>${esc(o.codigo || "")}</b> <span class="fx2-mut">${esc(o.nome || "")}</span></td>
        <td class="r">${fmt(o.venda)}</td><td class="r">${fmt(o.faturado)}</td><td class="r">${fmt(o.recebido)}</td>
        <td class="r">${fmt(Math.max(0, o.faturado - o.recebido))}</td><td class="r">${fmt(o.custo)}</td>
        <td class="r${o.margem < 0 ? " f0-neg" : ""}">${fmt(o.margem)}${o.venda ? ` <small class="fx2-mut">${pc(o.margem / o.venda)}</small>` : ""}</td></tr>`
    ).join("")}</tbody></table></div>`;
}

function desenhar() {
  const d = st.data;
  const el = st.el;
  if (!el) return;
  if (!d) {
    el.innerHTML = filtrosHtml(null) + `<div class="finance-empty">A carregar…</div>`;
    return;
  }
  el.innerHTML = `${filtrosHtml(d)}
    <h3 class="f0-h3">Resultado do Período</h3>${resultadoHtml(d)}
    <h3 class="f0-h3">Posição Atual</h3>${posicaoHtml(d)}
    <div class="f0-grid">
      ${chartCardHtml({ id: "f0Chart", title: "Faturação, Recebimentos e Custos · Últimos 12 Meses", height: 280 })}
      <section class="finance-card f0-blk"><h3 class="f0-h3">Custos Pagos por Natureza</h3>${naturezaHtml(d)}</section>
    </div>
    ${fluxosHtml(d)}
    <section class="finance-card f0-blk"><h3 class="f0-h3">Desempenho por Obra <small>· acumulado desde o início · clique numa obra para ver o detalhe</small></h3>${obrasHtml(d)}</section>`;
  const cat = d.meses.map((m) => `${MESES[Number(m.k.slice(5, 7)) - 1]} ${m.k.slice(2, 4)}`);
  drawComboChart("f0Chart", {
    categories: cat,
    currency: d.moeda,
    series: [
      { name: "Faturação (s/ IVA)", type: "column", data: d.meses.map((m) => m.fat), color: "#1f5fd1" },
      { name: "Recebimentos", type: "column", data: d.meses.map((m) => m.rec), color: "#1fa36a" },
      { name: "Custos pagos", type: "column", data: d.meses.map((m) => m.cus), color: "#e0a419" },
    ],
  });
}

async function carregar() {
  try {
    st.data = await apiRequest(`/finance/dashboard?${query()}`);
    desenhar();
  } catch (e) {
    if (st.el) st.el.innerHTML = filtrosHtml(st.data) + erro(e.message || "erro");
  }
}

function ligar(el) {
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-f0seg]");
    if (b) {
      const [k, v] = b.dataset.f0seg.split("|");
      if (k === "moeda") st.obra = "";
      st[k] = v;
      carregar();
      return;
    }
    const r = e.target.closest("[data-f0obra]");
    if (r) location.href = `/Financeiro/obras-custos?obra=${encodeURIComponent(r.dataset.f0obra)}`;
  });
  el.addEventListener("change", (e) => {
    const k = e.target.dataset.f0;
    if (!k) return;
    st[k] = e.target.value;
    if (k === "de" || k === "ate") if (!(st.de && st.ate)) return;
    carregar();
  });
}

export async function renderPainelF0(el) {
  if (!el) return;
  st.el = el;
  if (!el.dataset.f0Ligado) {
    ligar(el);
    el.dataset.f0Ligado = "1";
  }
  desenhar();
  await carregar();
}
