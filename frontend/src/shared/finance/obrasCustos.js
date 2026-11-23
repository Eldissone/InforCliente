/**
 * O2 Custos por Obra — o `V.fjob` do protótipo.
 *
 * A lista: por obra, a venda, o custo orçado, o pago, o comprometido, o custo
 * previsto final, o desvio, quanto do orçamento já foi consumido e a margem
 * prevista. Escolhida uma obra (`?obra=`): os cartões da obra e os custos por
 * categoria ou por fornecedor.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, codigoNoCabecalho, seg, moedaSeg, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { lista: null, obra: null, det: null, por: "cat", e: "ativas", q: "", moeda: "AOA", erro: null };

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const pc = (v) => `${(Number(v) || 0).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`;

function consumido(x) {
  if (x.consumido === null) return `<span class="fx2-mut">sem orçamento</span>`;
  return `<div class="fx3-cons"><i style="width:${Math.min(100, x.consumido).toFixed(1)}%"${x.consumido > 100 ? ' class="mau"' : ""}></i><span>${pc(x.consumido)}</span></div>`;
}

function lista() {
  const q = norm(S.q).trim();
  const L = S.lista.obras
    .filter((x) => x.moeda === S.moeda)
    .filter((x) => S.e !== "ativas" || (x.ativa && (x.contr || x.real || x.comp || x.orc)))
    .filter((x) => !q || norm([x.codigo, x.nome, x.cliente].join(" ")).includes(q))
    .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
  const soma = (k) => L.reduce((s, x) => s + (x[k] || 0), 0);
  const contr = soma("contr");
  const eac = soma("eac");
  return `
    <div class="fcal-filtros">
      <input type="search" class="fcal-q" data-o2q placeholder="código, obra, cliente…" value="${esc(S.q)}">
      ${seg("o2", "e", S.e, [["ativas", "Obras em Curso"], ["todas", "Todas"]])}
      ${moedaSeg("o2", S.moeda, S.lista.moedas)}
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Obra</th><th class="r">Venda Prevista</th><th class="r">Custo Orçado</th><th class="r">Pago</th><th class="r">Comprometido</th><th class="r">Custo Previsto Final</th><th class="r">Desvio</th><th>Consumido do Orçamento</th><th class="r">Margem Prev.</th></tr></thead>
      <tbody>${L.map(
        (x) => `<tr class="fx2-k-row" data-o2x="${esc(x.id)}">
          <td><b>${esc(x.codigo)}</b> <span class="fx2-mut">${esc(x.nome)}</span></td>
          <td class="r">${x.contr ? fmt(x.contr) : "—"}</td>
          <td class="r">${x.orc ? fmt(x.orc) : "—"}</td>
          <td class="r">${fmt(x.real)}</td>
          <td class="r">${x.comp ? fmt(x.comp) : "—"}</td>
          <td class="r"><b>${fmt(x.eac)}</b></td>
          <td class="r${x.desv > 0.5 ? " fcal-out" : ""}">${x.desv === null ? "—" : fmt(x.desv)}</td>
          <td>${consumido(x)}</td>
          <td class="r${x.mPrevPct < 0 ? " fcal-out" : ""}">${x.mPrevPct === null ? "—" : pc(x.mPrevPct)}</td>
        </tr>`
      ).join("")}</tbody>
      <tfoot><tr><td>Total (${L.length})</td><td class="r">${fmt(contr)}</td><td class="r">${fmt(soma("orc"))}</td><td class="r">${fmt(soma("real"))}</td><td class="r">${fmt(soma("comp"))}</td><td class="r">${fmt(eac)}</td><td class="r">${fmt(L.reduce((s, x) => s + (x.desv || 0), 0))}</td><td></td><td class="r">${contr ? pc(((contr - eac) / contr) * 100) : "—"}</td></tr></tfoot>
    </table></div>`
        : vazio("Sem obras com estes filtros.")
    }
    <p class="fcal-nota">Custo previsto final = pago + comprometido (no mínimo o orçado). Desvio = previsto final − orçado. Clique numa obra para ver os custos por categoria e por fornecedor. Valores em ${esc(S.moeda)}.</p>`;
}

function detalhe() {
  const { resumo: x, alertas, custos: J } = S.det;
  const T = J.pago + J.porPagar;
  const linha = (g, sub) => `<tr${sub ? ' class="fx3-sub"' : ""}>
    <td>${sub ? esc(g.k) : `<b>${esc(g.k)}</b>`}</td>
    <td class="r">${fmt(g.pago)}</td>
    <td class="r">${g.pp > 0.5 ? fmt(g.pp) : "—"}</td>
    <td class="r">${sub ? fmt(g.pago + g.pp) : `<b>${fmt(g.pago + g.pp)}</b>`}</td>
    <td>${sub ? "" : `<div class="fx3-cons"><i style="width:${T ? (((g.pago + g.pp) / T) * 100).toFixed(1) : 0}%"></i><span>${T ? pc(((g.pago + g.pp) / T) * 100) : "0%"}</span></div>`}</td>
  </tr>`;
  return `
    <div class="fx2-barra">
      <button type="button" class="fcal-todos" data-o2back>← Todas as obras</button>
      <h2 class="fx2-h2">${esc(x.codigo)} · ${esc(x.nome)}</h2>
    </div>
    ${alertas.length ? `<ul class="fx3-alertas">${alertas.map((a) => `<li><span class="material-symbols-outlined" style="font-size:16px;vertical-align:text-bottom">warning</span> ${esc(a)}</li>`).join("")}</ul>` : ""}
    ${kpis([
      { tom: "neu", titulo: "Venda Prevista", valor: x.contr ? fmt(x.contr) : "—", nota: x.moeda },
      { tom: "neu", titulo: "Custo Orçado", valor: x.orc ? fmt(x.orc) : "—" },
      { tom: "good", titulo: "Pago", valor: fmt(x.real) },
      { tom: "warn", titulo: "Comprometido", valor: fmt(x.comp), nota: "pedidos aprovados por pagar" },
      {
        tom: x.desv > 0.5 ? "bad" : "neu",
        titulo: "Custo Previsto Final",
        valor: fmt(x.eac),
        nota: x.desv === null ? "sem custo orçado" : x.desv > 0.5 ? `acima do orçado em ${fmt(x.desv)}` : "dentro do orçado",
      },
      { tom: x.mPrev < 0 ? "bad" : "good", titulo: "Margem Prevista", valor: x.mPrev === null ? "—" : fmt(x.mPrev), nota: x.mPrevPct === null ? "" : pc(x.mPrevPct) },
    ])}
    <section class="fx2-blk">
      <div class="fx2-barra"><h3 style="margin:0">Custos ${S.por === "forn" ? "por Fornecedor" : "por Categoria"}</h3>${seg("o2", "por", S.por, [["cat", "Por Categoria"], ["forn", "Por Fornecedor"]])}</div>
      ${
        J.grupos.length
          ? `<div class="fx2-tw"><table class="fx2-t">
        <thead><tr><th>${S.por === "forn" ? "Fornecedor" : "Categoria / Origem"}</th><th class="r">Pago</th><th class="r">Por Pagar</th><th class="r">Total</th><th>% do Total</th></tr></thead>
        <tbody>${J.grupos
          // O detalhe só aparece quando o grupo tem mais de uma origem: com uma
          // só, a linha de baixo repetia a de cima.
          .map((g) => linha(g) + (S.por === "forn" || g.sub.length < 2 ? "" : g.sub.map((z) => linha(z, true)).join("")))
          .join("")}</tbody>
        <tfoot><tr><td>Total</td><td class="r">${fmt(J.pago)}</td><td class="r">${fmt(J.porPagar)}</td><td class="r">${fmt(T)}</td><td></td></tr></tfoot>
      </table></div>`
          : `<p class="fx2-mut">Ainda não há custos registados para esta obra.</p>`
      }
    </section>
    <div class="fx3-links">
      <a class="fcal-todos" href="/Financeiro/obra-tesouraria?obra=${encodeURIComponent(x.id)}">O3 · Tesouraria da obra</a>
      <a class="fcal-todos" href="/Financeiro/obra-previsoes?obra=${encodeURIComponent(x.id)}">O4 · Previsões</a>
    </div>`;
}

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (S.obra) return (el.innerHTML = S.det ? detalhe() : vazio("A carregar…"));
  el.innerHTML = S.lista ? lista() : vazio("A carregar…");
}

function marcarObra(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("obra", id);
  else url.searchParams.delete("obra");
  window.history.replaceState({}, "", url);
}

async function carregarLista() {
  try {
    S.lista = await apiRequest("/finance/project-summary");
    if (!S.lista.moedas.includes(S.moeda)) S.moeda = S.lista.moedas[0] || "AOA";
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

async function abrir(id) {
  S.obra = id;
  S.det = null;
  marcarObra(id);
  desenhar();
  try {
    S.det = await apiRequest(`/finance/project-summary/${encodeURIComponent(id)}/costs?por=${S.por}`);
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render() {
  codigoNoCabecalho("O2");
  const el = root();
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-o2],[data-o2x],[data-o2back]");
    if (!b) return;
    if (b.dataset.o2back !== undefined) {
      S.obra = null;
      marcarObra(null);
      desenhar();
      if (!S.lista) carregarLista();
      return;
    }
    if (b.dataset.o2x) return abrir(b.dataset.o2x);
    const [k, v] = b.dataset.o2.split("|");
    S[k] = v;
    if (k === "por" && S.obra) return abrir(S.obra);
    desenhar();
  });
  el.addEventListener("input", (e) => {
    if (e.target.dataset.o2q === undefined) return;
    S.q = e.target.value;
    const pos = e.target.selectionStart;
    desenhar();
    const n = root().querySelector("[data-o2q]");
    if (n) {
      n.focus();
      n.setSelectionRange(pos, pos);
    }
  });
  const obra = new URLSearchParams(window.location.search).get("obra");
  if (obra) return abrir(obra);
  desenhar();
  await carregarLista();
}
