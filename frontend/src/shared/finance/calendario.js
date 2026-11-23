/**
 * F1 Calendário Financeiro · P2 Calendário de Pagamentos · R2 Calendário de
 * Recebimentos — o mesmo ecrã, escolhido por `?ver=` (vazio, `pagar`,
 * `receber`), como no protótipo.
 *
 * Em cima, um cartão por período com o que há a receber, a pagar e o saldo;
 * escolhido um período, as duas listas lado a lado, agrupadas pela origem.
 * Cada documento aparece no período em que vence; o que já passou a data fica
 * a vermelho. Os previstos (autos aprovados sem fatura) entram quando se marca
 * a caixa, e as datas estimadas dizem-no.
 */

import { apiRequest } from "../../services/api.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { markActiveDropdownTriggers, markTopNavActive } from "../appNav.js";
import { buildCalendar, periodLabel, periodShort, MESES, JANELAS } from "./calendarioCore.js";

const VER = {
  tudo: { num: "F1", titulo: "Calendário Financeiro", lado: "" },
  pagar: { num: "P2", titulo: "Calendário de Pagamentos", lado: "P" },
  receber: { num: "R2", titulo: "Calendário de Recebimentos", lado: "R" },
};

const fmt = (v) => Number(v || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Nos cartões dos períodos não cabem centavos: são seis por linha.
const fmt0 = (v) => Number(v || 0).toLocaleString("pt-PT", { maximumFractionDigits: 0 });

const state = { dados: null, F: null, erro: null };

function root() {
  return document.getElementById("financeRoot");
}

function marcarMenu() {
  try {
    markActiveDropdownTriggers();
    markTopNavActive();
  } catch {
    // Sem menu (vista embebida).
  }
}

const verDe = (lado) => (lado === "P" ? "pagar" : lado === "R" ? "receber" : "tudo");

/**
 * O lado vive sempre no endereço — também o F1, com `ver=tudo` —, para o menu
 * acender só a entrada certa: um endereço sem parâmetro casaria com as três.
 */
function gravarLado(lado) {
  const url = new URL(window.location.href);
  url.searchParams.set("ver", verDe(lado));
  window.history.replaceState({}, "", url);
  marcarMenu();
}

function cabecalho() {
  const ver = VER[verDe(state.F.lado)];
  const h = document.getElementById("financePageHeader");
  if (h) {
    const num = h.querySelector("[data-fcal-num]");
    const tit = h.querySelector("h1, h2");
    if (tit) tit.textContent = ver.titulo;
    if (num) num.remove();
  }
  document.title = `Info Gestor — ${ver.titulo}`;
}

const seg = (k, opcoes) =>
  `<span class="finance-seg">${opcoes
    .map(([v, l]) => `<button type="button" class="${String(state.F[k] ?? "") === v ? "active" : ""}" data-fcal="${k}|${v}">${esc(l)}</button>`)
    .join("")}</span>`;

const PILL = {
  atr: `<span class="fcal-pill fcal-pill--bad">Em atraso</span>`,
  pp: `<span class="fcal-pill fcal-pill--warn">Parcial</span>`,
  prev: `<span class="fcal-pill fcal-pill--blue">Previsto</span>`,
  comp: `<span class="fcal-pill fcal-pill--slate">Compromisso</span>`,
};

function linhaHtml(x, hoje) {
  const dd = x.data ? x.data.slice(8, 10) : "—";
  const mm = x.data ? MESES[Number(x.data.slice(5, 7)) - 1].slice(0, 3) : "";
  const atraso = x.estado === "atr" && x.data
    ? ` — em atraso há ${Math.round((new Date(`${hoje}T00:00:00Z`) - new Date(`${x.data}T00:00:00Z`)) / 86400000)} dia(s)`
    : "";
  const titulo = `Vencimento: ${x.data ? x.data.split("-").reverse().join("/") : "sem data"}${x.estimada ? " (estimado)" : ""}${atraso}`;
  return `<a class="fcal-r fcal-r--${x.estado}" href="${esc(x.link)}" title="${esc(titulo)}">
    <span class="fcal-d"><b>${dd}</b>${esc(mm)}${x.estimada ? `<i title="Data estimada">≈</i>` : ""}</span>
    <span class="fcal-e">
      <span class="fcal-n">${esc(x.entidade || "—")}</span>
      <span class="fcal-m">${esc([x.doc, x.sub].filter(Boolean).join(" · "))}</span>
    </span>
    <span class="fcal-v">${fmt(x.valor)}${x.moeda && x.moeda !== "AOA" ? ` <small>${esc(x.moeda)}</small>` : ""}<span>${PILL[x.estado] || ""}</span></span>
  </a>`;
}

function listaHtml(lado, titulo, bloco, hoje) {
  return `<section class="fcal-box">
    <header class="fcal-h">
      <h3>${titulo} <small>(${bloco.n})</small></h3>
      <span class="fcal-tot ${lado === "R" ? "fcal-in" : "fcal-out"}">${fmt(bloco.total)}</span>
    </header>
    ${
      bloco.n
        ? bloco.grupos
            .map(
              (g) => `<div class="fcal-g"><span>${esc(g.nome)}</span><span>${fmt(g.total)}</span></div>
                ${g.linhas.map((x) => linhaHtml(x, hoje)).join("")}`
            )
            .join("")
        : `<p class="fcal-vazio">Nada ${lado === "R" ? "a receber" : "a pagar"} neste período.</p>`
    }
  </section>`;
}

function desenhar() {
  const el = root();
  if (!el) return;
  if (state.erro) {
    el.innerHTML = `<div class="finance-empty">Não foi possível carregar o calendário: ${esc(state.erro)}</div>`;
    return;
  }
  if (!state.dados) {
    el.innerHTML = `<div class="finance-empty">A carregar…</div>`;
    return;
  }

  const { hoje, itens } = state.dados;
  const F = state.F;
  {
    const ms = new Set(itens.map((x) => String(x.moeda || "AOA").toUpperCase()));
    if (!F.moeda || !ms.has(F.moeda)) F.moeda = ms.has("AOA") ? "AOA" : [...ms][0] || "AOA";
  }
  const C = buildCalendar(itens, F, hoje);
  F.sel = C.sel;
  cabecalho();

  const anoAtual = Number(hoje.slice(0, 4));
  const anos = [anoAtual - 1, anoAtual, anoAtual + 1].map(String);
  const nPrev = itens.filter((x) => x.estado === "prev").length;

  const cartoes = C.periodos
    .map((p) => {
      const tit = `${p.nR} a receber · ${p.nP} a pagar${p.atr ? ` · ${p.atr} em atraso` : ""}`;
      return `<button type="button" class="fcal-p${F.sel === p.k ? " on" : ""}${p.atual ? " cur" : ""}" data-fcal="sel|${p.k}" title="${esc(tit)}">
        <span class="fcal-t">${esc(periodShort(F.per, p.k))}</span>
        ${F.lado !== "P" ? `<span class="fcal-l"><span>Receber</span><b class="fcal-in" title="${fmt(p.R)}">${p.R ? fmt0(p.R) : "—"}</b></span>` : ""}
        ${F.lado !== "R" ? `<span class="fcal-l"><span>Pagar</span><b class="fcal-out" title="${fmt(p.P)}">${p.P ? fmt0(p.P) : "—"}</b></span>` : ""}
        ${!F.lado ? `<span class="fcal-l s"><span>Saldo</span><b class="${p.saldo < 0 ? "fcal-out" : "fcal-in"}" title="${fmt(p.saldo)}">${p.R || p.P ? fmt0(p.saldo) : "—"}</b></span>` : ""}
        ${p.atr ? `<span class="fcal-atr"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:text-bottom">warning</span> ${p.atr} em atraso</span>` : ""}
      </button>`;
    })
    .join("");

  // Clientes (ou fornecedores) do lado escolhido, para o filtro por entidade.
  const entidades = [...new Set(itens.filter((x) => !F.lado || x.lado === F.lado).map((x) => x.entidade).filter((e) => e && e !== "—"))].sort((a, b) =>
    a.localeCompare(b, "pt")
  );
  const janelas = `<div class="fcal-janelas">${JANELAS.map(
    ([k, l]) => `<button type="button" class="fx2-chip${(F.janela || "") === k ? " on" : ""}" data-fcal="janela|${k}">${esc(l)} <i>${C.contagens[k]}</i></button>`
  ).join("")}</div>`;

  const moedas = [...new Set(itens.map((x) => String(x.moeda || "AOA").toUpperCase()))].sort((a, b) => (a === "AOA" ? -1 : b === "AOA" ? 1 : a.localeCompare(b)));

  el.innerHTML = `
    ${janelas}
    <div class="fcal-filtros">
      ${moedas.length > 1 ? seg("moeda", moedas.map((m) => [m, m])) : ""}
      <input type="search" class="fcal-q" data-fcalq placeholder="Pesquisar entidade, documento, obra, valor…" value="${esc(F.q || "")}">
      ${seg("lado", [["", "Pagar e Receber"], ["P", "Só a Pagar"], ["R", "Só a Receber"]])}
      ${seg("per", [["M", "Por Mês"], ["S", "Por Semana"]])}
      ${
        F.per === "M"
          ? `<select class="fcal-ano" data-fcals="ano">${anos.map((a) => `<option${F.ano === a ? " selected" : ""}>${a}</option>`).join("")}</select>`
          : ""
      }
      <select class="fcal-ano" data-fcals="ent"><option value="">${F.lado === "P" ? "Todos os fornecedores" : F.lado === "R" ? "Todos os clientes" : "Todas as entidades"}</option>${entidades
        .map((e) => `<option${F.ent === e ? " selected" : ""}>${esc(e)}</option>`)
        .join("")}</select>
      ${
        F.lado === "R"
          ? seg("fonte", [["", "Faturas e previstos"], ["fat", "Só faturas emitidas"], ["prev", "Só autos previstos"]])
          : ""
      }
      <label class="fcal-chk" title="${nPrev} auto(s) aprovado(s) ainda sem fatura">
        <input type="checkbox" data-fcalc="prev"${F.prev ? " checked" : ""}> incluir previstos (autos ainda sem fatura)
      </label>
      <button type="button" class="fcal-todos${F.sel === "tudo" ? " on" : ""}" data-fcal="sel|tudo">Ver todos os períodos</button>
    </div>

    <div class="fcal-strip">${cartoes}</div>

    <div class="fcal-cab">
      <h3>${esc(periodLabel(F.per, F.sel))}</h3>
      <span>
        ${F.lado !== "P" ? `A receber <b class="fcal-in">${fmt(C.receber.total)}</b>` : ""}
        ${!F.lado ? " · " : ""}
        ${F.lado !== "R" ? `A pagar <b class="fcal-out">${fmt(C.pagar.total)}</b>` : ""}
        ${!F.lado ? ` · Saldo <b class="${C.saldo < 0 ? "fcal-out" : "fcal-in"}">${fmt(C.saldo)}</b>` : ""}
      </span>
    </div>

    <div class="fcal-cols${F.lado ? " fcal-cols--1" : ""}">
      ${F.lado !== "P" ? listaHtml("R", "A Receber", C.receber, hoje) : ""}
      ${F.lado !== "R" ? listaHtml("P", "A Pagar", C.pagar, hoje) : ""}
    </div>

    <p class="fcal-nota">
      Cada documento aparece no período do seu vencimento; os que já passaram a data ficam a vermelho
      («em atraso»). Sem vencimento registado, a fatura vence ${state.dados.prazoPadraoDias} dias depois do
      documento, e o auto aprovado ${state.dados.prazoPadraoDias} dias depois da sua data — essas datas estão
      marcadas com ≈. Passe o rato para ver a data; clique para abrir o ecrã onde o documento se trata.
    </p>`;
}

function ligar() {
  const el = root();
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fcal]");
    if (!b) return;
    const [k, v] = b.dataset.fcal.split("|");
    if (k === "sel") {
      state.F.sel = v;
      state.F.janela = "";
    } else if (k === "fonte") {
      state.F.fonte = v;
      // «Só autos previstos» precisa dos previstos ligados.
      if (v === "prev") state.F.prev = true;
    }
    else {
      state.F[k] = v;
      if (k === "lado") {
        gravarLado(v);
        state.F.ent = "";
      }
      if (k === "per") state.F.sel = null;
    }
    desenhar();
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.fcals) {
      state.F[t.dataset.fcals] = t.value;
      state.F.sel = null;
      desenhar();
    } else if (t.dataset.fcalc) {
      state.F[t.dataset.fcalc] = t.checked;
      desenhar();
    }
  });
  let tempo = null;
  el.addEventListener("input", (e) => {
    if (e.target.dataset.fcalq === undefined) return;
    state.F.q = e.target.value;
    clearTimeout(tempo);
    tempo = setTimeout(() => {
      const pos = e.target.selectionStart;
      desenhar();
      const novo = root().querySelector("[data-fcalq]");
      if (novo) {
        novo.focus();
        novo.setSelectionRange(pos, pos);
      }
    }, 200);
  });
}

export async function render() {
  const ver = new URLSearchParams(window.location.search).get("ver") || "";
  const agora = new Date();
  state.F = {
    per: "M",
    ano: String(agora.getFullYear()),
    lado: (VER[ver] || VER.tudo).lado,
    q: "",
    sel: null,
    prev: true,
  };
  state.dados = null;
  state.erro = null;
  gravarLado(state.F.lado);
  ligar();
  desenhar();
  try {
    state.dados = await apiRequest("/finance/calendar");
    state.F.ano = state.dados.hoje.slice(0, 4);
  } catch (err) {
    state.erro = err?.message || "erro";
  }
  desenhar();
}
