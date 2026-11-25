import { apiRequest } from "../../services/api.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtPct, estPill, margemTom, novoOrcamento, ESTADOS } from "./orcUi.js";

/**
 * OR1 Lista de Orçamentos (o V.orbl do protótipo): todos os orçamentos,
 * adjudicados ou não; filtro por estado e pesquisa; «+ Novo Orçamento».
 */

const root = () => document.getElementById("financeRoot");
const S = { itens: null, erro: null, est: "", q: "" };
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = `<div class="finance-empty">Não foi possível carregar: ${esc(S.erro)}</div>`);
  if (!S.itens) return (el.innerHTML = '<div class="finance-empty">A carregar…</div>');
  const q = norm(S.q).trim();
  const base = S.itens.filter((b) => !q || norm([b.code, b.name, b.clientName, b.ficha?.sigla].join(" ")).includes(q));
  const L = base.filter((b) => !S.est || b.status === S.est);
  const ed = can("comercial", "edit");
  el.innerHTML = `
    <div class="t3-bar">
      ${ed ? '<button type="button" class="finance-btn finance-btn--primary" data-orb="novo">+ Novo Orçamento</button>' : ""}
    </div>
    <p class="fx2-mut t3-small">Todos os orçamentos, adjudicados ou não. Clique num orçamento para o abrir. Quando o cliente adjudica, a obra nasce a partir do orçamento (Estado e Adjudicação).</p>
    <div class="t3-bar">
      <input type="search" class="finance-input orc-q" data-orbq placeholder="Procurar orçamento…" value="${esc(S.q)}">
      <span class="orc-chips">${[["", "Todos"], ...ESTADOS.map((e) => [e, e])]
        .map(([k, l]) => `<button type="button" class="${S.est === k ? "on" : ""}" data-orbe="${esc(k)}">${esc(l)} (${base.filter((b) => !k || b.status === k).length})</button>`)
        .join("")}</span>
    </div>
    <section class="t3-sec t3-flush"><div class="fx2-tw"><table class="fx2-t orc-lista">
      <thead><tr><th>Orçamento</th><th>Designação</th><th>Cliente</th><th class="r">Custo (AOA)</th><th class="r">Venda</th><th class="r">Venda (AOA)</th><th class="r">Margem</th><th>Estado</th></tr></thead>
      <tbody>${
        L.length
          ? L.map(
              (b) => `<tr data-orbopen="${esc(b.id)}" title="Abrir o orçamento">
          <td><b>${esc(b.code)}</b>${b.ficha?.sigla ? `<div class="fx2-mut">${esc(b.ficha.sigla)}</div>` : ""}</td>
          <td>${esc(b.name)}</td><td>${esc(b.clientName || "—")}</td>
          <td class="r">${b.totais.custo ? fmt(b.totais.custo) : "—"}</td>
          <td class="r">${b.totais.venda ? `${fmt(b.totais.venda)} <span class="fx2-mut">${esc(b.currency)}</span>` : "—"}</td>
          <td class="r">${b.totais.vendaAOA ? fmt(b.totais.vendaAOA) : "—"}</td>
          <td class="r orc-m--${margemTom(b.totais.mp, b.pricing)}">${b.totais.vendaAOA ? fmtPct(b.totais.mp) : "—"}</td>
          <td>${estPill(b.status)}</td></tr>`
            ).join("")
          : `<tr><td colspan="8" class="fx2-mut">${S.itens.length ? "Nenhum orçamento com estes filtros." : "Sem orçamentos."}</td></tr>`
      }</tbody></table></div></section>`;
}

async function carregar() {
  try {
    S.itens = (await apiRequest("/work-budgets")).items || [];
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render() {
  const el = root();
  el.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-orb=novo]")) return novoOrcamento();
    const est = t.closest("[data-orbe]");
    if (est) {
      S.est = est.dataset.orbe;
      return desenhar();
    }
    const row = t.closest("[data-orbopen]");
    if (row) location.href = `/orcamentacao/orcamento/?id=${encodeURIComponent(row.dataset.orbopen)}&v=resumo`;
  });
  let tempo = null;
  el.addEventListener("input", (e) => {
    if (e.target.dataset.orbq === undefined) return;
    S.q = e.target.value;
    clearTimeout(tempo);
    tempo = setTimeout(() => {
      desenhar();
      const n = root().querySelector("[data-orbq]");
      n?.focus();
      n?.setSelectionRange(n.value.length, n.value.length);
    }, 250);
  });
  desenhar();
  await carregar();
}
