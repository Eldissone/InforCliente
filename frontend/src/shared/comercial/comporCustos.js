/**
 * Compor os custos a partir do mapa de quantidades.
 *
 * Escolhem-se os trabalhos, a IA diz que recursos cada um leva **por unidade**,
 * o programa multiplica pela quantidade e mostra tudo para rever. Só o que
 * ficar marcado é que entra nas folhas de custo — acrescentado, nunca a
 * substituir o que lá estiver.
 */

import { apiRequest } from "/services/api.js";
import { toast, escapeHtml } from "/shared/ui.js";

const esc = (v) => escapeHtml(String(v ?? ""));
const el = (id) => document.getElementById(id);
const fmt = (v, d = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });

const CAT_LABEL = {
  material: "Material",
  rh: "Mão de obra",
  equipamento: "Equipamento",
  viatura: "Viatura",
  ferramenta: "Ferramenta",
  subempreitada: "Subempreitada",
  logistica: "Logística",
};

const S = {
  passo: "escolher",
  trabalhos: [],
  escolhidos: new Set(),
  proposta: null,
  aCorrer: false,
  ctx: null,
};

function envolver(corpo) {
  return `<div class="cm-wizard-backdrop" id="ccBackdrop"><div class="cm-panel cm-wizard cc-wizard">
    <div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">Comercial · composição de custos</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">Compor os custos a partir do mapa</h2>
      </div>
      <button class="cm-chip" type="button" id="ccFechar">Fechar</button>
    </div>
    ${corpo}
  </div></div>`;
}

function passoEscolher() {
  const n = S.escolhidos.size;
  return envolver(`
    <p class="cm-lead">
      A IA diz que recursos cada trabalho leva <b>por unidade</b> — meio dia de servente por cova,
      0,08 m³ de betão por cova — e o programa multiplica pela quantidade. Nada entra sem passar por si.
      Escolha até 25 trabalhos de cada vez.
    </p>
    <div class="imp-resumo">
      <span><b>${n}</b> de ${S.trabalhos.length} trabalho(s) escolhidos</span>
      <span class="imp-acts">
        <button type="button" class="cm-chip" data-ccall="1">Escolher todos</button>
        <button type="button" class="cm-chip" data-ccall="0">Limpar</button>
      </span>
    </div>
    <div class="imp-tabela">
      <table class="cm-table">
        <thead><tr><th></th><th>Cód.</th><th>Trabalho</th><th>Un.</th><th class="cell-num">Qtd.</th></tr></thead>
        <tbody>${S.trabalhos
          .map(
            (t) => `<tr class="${S.escolhidos.has(t.cod) ? "" : "imp-off"}">
              <td><input type="checkbox" data-cct="${esc(t.cod)}" ${S.escolhidos.has(t.cod) ? "checked" : ""}></td>
              <td>${esc(t.cod)}</td>
              <td>${esc(t.desc)}<div class="imp-meta">${esc(t.grupo || "")}</div></td>
              <td>${esc(t.un)}</td>
              <td class="cell-num">${fmt(t.q, 0)}</td>
            </tr>`
          )
          .join("")}</tbody>
      </table>
    </div>
    <div class="cm-head-actions" style="margin-top:.75rem">
      <button class="cm-chip is-on" type="button" id="ccCompor" ${S.aCorrer || !n ? "disabled" : ""}>
        ${S.aCorrer ? "A compor…" : `✦ Compor ${n} trabalho(s)`}
      </button>
      <span class="cm-lead" id="ccMsg" style="margin:0"></span>
    </div>`);
}

function passoRever() {
  const itens = S.proposta.itens;
  const marcadas = itens.flatMap((i) => i.linhas.filter((l) => l.on));
  const porCat = {};
  for (const l of marcadas) porCat[l.cat] = (porCat[l.cat] || 0) + 1;

  return envolver(`
    <p class="cm-lead">
      A coluna <b>por unidade</b> é o que a IA propôs; o <b>total</b> é essa quantidade vezes a
      quantidade do trabalho — a conta é do programa. Desmarque o que não quiser.
    </p>
    <div class="imp-resumo">
      <span><b>${marcadas.length}</b> linha(s) marcadas</span>
      ${Object.entries(porCat)
        .map(([c, n]) => `<span>${esc(CAT_LABEL[c] || c)}: <b>${n}</b></span>`)
        .join("")}
    </div>
    <div class="imp-tabela">
      <table class="cm-table">
        <thead><tr><th></th><th>Recurso</th><th>Categoria</th><th class="cell-num">Por unidade</th><th>Un.</th><th class="cell-num">Total</th></tr></thead>
        <tbody>${itens
          .map(
            (it, ii) => `
          <tr class="cc-trabalho"><td colspan="6">
            <b>${esc(it.cod)}</b> ${esc(it.desc)} — ${fmt(it.q, 0)} ${esc(it.un)}
            ${it.nota ? `<span class="imp-meta">${esc(it.nota)}</span>` : ""}
            ${!it.linhas.length ? `<span class="imp-falta">sem composição</span>` : ""}
          </td></tr>
          ${it.linhas
            .map(
              (l, li) => `<tr class="${l.on ? "" : "imp-off"}">
                <td><input type="checkbox" data-ccl="${ii}|${li}" ${l.on ? "checked" : ""}></td>
                <td>${esc(l.desc)}${l.barem ? `<div class="imp-meta imp-barem">${esc(l.barem)}</div>` : `<div class="imp-meta imp-falta">sem barem</div>`}</td>
                <td>${esc(CAT_LABEL[l.cat] || l.cat)}</td>
                <td class="cell-num">${fmt(l.porUnidade, 4)}</td>
                <td>${esc(l.un)}</td>
                <td class="cell-num"><b>${fmt(l.total)}</b></td>
              </tr>`
            )
            .join("")}`
          )
          .join("")}</tbody>
      </table>
    </div>
    <p class="ba-nota">
      Os recursos sem barem e os materiais entram <b>sem preço</b>: o custo só aparece depois de
      se preencher o preço ou de se criar o barem.
    </p>
    <div class="cm-head-actions" style="margin-top:.75rem">
      <button class="cm-chip" type="button" id="ccVoltar">‹ Escolher outros</button>
      <button class="cm-chip is-on" type="button" id="ccAplicar" ${S.aCorrer || !marcadas.length ? "disabled" : ""}>
        ${S.aCorrer ? "A juntar…" : `Juntar ${marcadas.length} linha(s) às folhas de custo`}
      </button>
      <span class="cm-lead" id="ccMsg" style="margin:0"></span>
    </div>`);
}

function desenhar() {
  const host = el("cmDrawer") || el("cmModal");
  if (!host) return;
  host.innerHTML = S.passo === "escolher" ? passoEscolher() : passoRever();
}

async function compor() {
  S.aCorrer = true;
  desenhar();
  if (el("ccMsg")) el("ccMsg").textContent = "A IA está a compor. Pode demorar até dois minutos.";
  try {
    const r = await apiRequest(`/budgets/${encodeURIComponent(S.ctx.id)}/ai/compose`, {
      method: "POST",
      body: { cods: [...S.escolhidos] },
    });
    S.proposta = r;
    S.passo = "rever";
  } catch (err) {
    toast(err.message || "Não foi possível compor.", { type: "error" });
  } finally {
    S.aCorrer = false;
    desenhar();
  }
}

async function aplicar() {
  S.aCorrer = true;
  desenhar();
  try {
    const r = await apiRequest(`/budgets/${encodeURIComponent(S.ctx.id)}/ai/compose/apply`, {
      method: "POST",
      body: { version: S.ctx.version(), itens: S.proposta.itens },
    });
    const c = r.composicao || {};
    (el("cmDrawer") || el("cmModal")).innerHTML = "";
    toast(
      `${c.recursos} recurso(s) juntos às folhas de custo.` +
        (c.semBarem?.length ? ` ${c.semBarem.length} sem barem.` : "") +
        (c.materiaisSemPreco ? ` ${c.materiaisSemPreco} material(is) por preçar.` : ""),
      { type: "success" }
    );
    S.ctx.onAplicado?.(r);
  } catch (err) {
    toast(err.message || "Não foi possível juntar.", { type: "error" });
    S.aCorrer = false;
    desenhar();
  }
}

export function wireComposicao() {
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("#ccFechar,#ccCompor,#ccVoltar,#ccAplicar,[data-ccall]");
    if (!t) return;
    if (t.id === "ccFechar") {
      (el("cmDrawer") || el("cmModal")).innerHTML = "";
      return;
    }
    if (t.id === "ccCompor") return compor();
    if (t.id === "ccVoltar") {
      S.passo = "escolher";
      S.proposta = null;
      desenhar();
      return;
    }
    if (t.id === "ccAplicar") return aplicar();
    if (t.dataset.ccall !== undefined) {
      if (t.dataset.ccall === "1") S.trabalhos.slice(0, 25).forEach((x) => S.escolhidos.add(x.cod));
      else S.escolhidos.clear();
      desenhar();
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset?.cct) {
      if (t.checked) S.escolhidos.add(t.dataset.cct);
      else S.escolhidos.delete(t.dataset.cct);
      desenhar();
      return;
    }
    if (t.dataset?.ccl && S.proposta) {
      const [ii, li] = t.dataset.ccl.split("|").map(Number);
      const linha = S.proposta.itens[ii]?.linhas[li];
      if (linha) {
        linha.on = t.checked;
        desenhar();
      }
    }
  });
}

/**
 * Abre a composição.
 *
 * @param {object} o
 * @param {string} o.id orçamento
 * @param {object[]} o.trabalhos linhas do mapa de quantidades (cod, desc, un, q, grupo)
 * @param {() => number} o.version a versão do documento, para gravar em segurança
 * @param {(r:object) => void} o.onAplicado
 */
export function abrirComposicao({ id, trabalhos, version, onAplicado }) {
  S.passo = "escolher";
  S.trabalhos = (trabalhos || []).filter((t) => t.desc && Number(t.q) > 0);
  S.escolhidos = new Set(S.trabalhos.slice(0, 25).map((t) => t.cod));
  S.proposta = null;
  S.aCorrer = false;
  S.ctx = { id, version, onAplicado };
  desenhar();
}
