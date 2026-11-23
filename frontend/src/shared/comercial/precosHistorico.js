/**
 * Preços do histórico — preencher o preço de compra com o que a casa já pagou.
 *
 * Mostra, linha a linha, os preços que estão nas necessidades de obra, nas
 * cotações escolhidas, no catálogo dos fornecedores, nas entradas em armazém e
 * nas ordens de compra. Cada candidato traz a origem e a data; a correspondência
 * exacta vem escolhida, tudo o mais fica por decidir.
 *
 * Nenhum preço é calculado nem estimado: ou é um registo que existe, ou a linha
 * diz «nada no histórico» — que é uma resposta, não uma falha. Quando não há
 * candidato mas quem orçamenta sabe o nome pelo qual a coisa foi comprada
 * («poste de iluminação» em vez de «coluna metálica de IP»), a procura à mão de
 * cada linha trata do resto.
 *
 * Escreve só na folha que está no ecrã e deixa o orçamento por gravar: quem
 * decide vê o efeito nos totais antes de gravar.
 */

import { apiRequest, apiUpload } from "/services/api.js";
import { toast, escapeHtml } from "/shared/ui.js";

const esc = (v) => escapeHtml(String(v ?? ""));
const el = (id) => document.getElementById(id);
const fmt = (v, d = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });

const CONFIANCA = {
  igual: { l: "Igual", t: "is-good" },
  forte: { l: "Forte", t: "is-good" },
  possivel: { l: "Possível", t: "is-warn" },
  // Veio da procura à mão: entrou porque alguém o foi buscar, não porque o
  // programa o reconheceu nesta linha.
  procurado: { l: "Procurado à mão", t: "is-warn" },
};

const FONTE = {
  necessidade: "necessidade de obra",
  cotacao: "cotação escolhida",
  catalogo: "catálogo de fornecedor",
  armazem: "entrada em armazém",
  ordem: "ordem de compra",
  proforma: "fatura pró-forma",
};

const S = {
  aCorrer: false,
  resposta: null,
  apenasSemPreco: true,
  procura: {}, // índice da linha → { texto, aCorrer }
  ctx: null,
};

const dataCurta = (d) => (d ? String(d).slice(0, 10) : "");

function envolver(corpo) {
  return `<div class="cm-wizard-backdrop" id="phBackdrop"><div class="cm-panel cm-wizard ph-wizard">
    <div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">Comercial · preços de compra</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">${S.ctx?.file ? "Preços da fatura pró-forma" : "Preços do histórico"}</h2>
      </div>
      <button class="cm-chip" type="button" id="phFechar">Fechar</button>
    </div>
    ${corpo}
  </div></div>`;
}

function candidatoHtml(l, c, ci) {
  const marcado = l.escolhido === ci;
  const conf = CONFIANCA[c.confianca] || CONFIANCA.possivel;
  const de = [c.origem || FONTE[c.fonte] || c.fonte, c.forn, dataCurta(c.data)].filter(Boolean).join(" · ");
  const intervalo =
    c.usos > 1 && c.min !== c.max ? ` · ${c.usos} compras, de ${fmt(c.min)} a ${fmt(c.max)}` : "";
  return `<label class="ph-cand${marcado ? " is-on" : ""}">
    <input type="radio" name="ph-${l.i}" data-phc="${l.i}|${ci}" ${marcado ? "checked" : ""}>
    <span class="ph-cand-preco"><b>${fmt(c.preco)}</b> ${esc(c.moeda)}/${esc(c.un)}</span>
    <span class="ph-cand-desc">
      ${esc(c.desc)}
      <span class="cm-pill ${conf.t}">${conf.l}</span>
      ${c.unDifere ? `<span class="imp-dup">un. difere</span>` : ""}
      ${c.falta?.length ? `<span class="imp-meta">não diz: ${esc(c.falta.join(", "))}</span>` : ""}
      <span class="imp-meta">${esc(de)}${esc(intervalo)}</span>
    </span>
    <span class="ph-cand-total">${l.q ? `${fmt(c.preco * l.q, 0)} no total` : ""}</span>
  </label>`;
}

function linhaHtml(l) {
  const p = S.procura[l.i] || {};
  return `<tr class="ph-linha"><td colspan="2">
      <b>${esc(l.desc)}</b>
      <span class="imp-meta">${fmt(l.q, 0)} ${esc(l.un || "")}${l.preco ? ` · já tem ${fmt(l.preco)}` : ""}</span>
    </td></tr>
    <tr><td colspan="2">
      ${
        l.candidatos.length
          ? `<div class="ph-cands">
               ${l.candidatos.map((c, ci) => candidatoHtml(l, c, ci)).join("")}
               <label class="ph-cand${l.escolhido === null ? " is-on" : ""}">
                 <input type="radio" name="ph-${l.i}" data-phc="${l.i}|" ${l.escolhido === null ? "checked" : ""}>
                 <span class="ph-cand-preco">—</span>
                 <span class="ph-cand-desc">Nenhum destes</span>
                 <span class="ph-cand-total"></span>
               </label>
             </div>`
          : `<p class="ba-nota" style="margin:.25rem 0">
               Nada no histórico casa com esta descrição. Se sabe o nome pelo qual foi comprada, procure-o.
             </p>`
      }
      <div class="ph-procura">
        <input type="text" class="cell-manual" data-phq="${l.i}" placeholder="Procurar por outro nome…" value="${esc(p.texto || "")}">
        <button class="cm-chip" type="button" data-phgo="${l.i}" ${p.aCorrer ? "disabled" : ""}>${p.aCorrer ? "A procurar…" : "Procurar"}</button>
      </div>
    </td></tr>`;
}

function corpo() {
  const r = S.resposta;
  const escolhidas = r.linhas.filter((l) => l.escolhido !== null);
  const f = r.fontes || {};
  const pf = r.proforma;
  return envolver(`
    ${
      pf
        ? `<p class="cm-lead">
             A IA leu <b>${esc(pf.ficheiro || "a pró-forma")}</b>${pf.fornecedor ? ` de <b>${esc(pf.fornecedor)}</b>` : ""}${
               pf.documento ? ` (${esc(pf.documento)})` : ""
             }: ${pf.artigos} artigo(s) com preço. Para cada linha da folha propõe-se o artigo da pró-forma
             que lhe corresponde, pelas mesmas regras dos preços do histórico. Confira antes de preencher.
           </p>`
        : `<p class="cm-lead">
      Os preços vêm do que a casa já comprou, cotou ou recebeu por escrito de um fornecedor —
      nunca de uma estimativa. Cada um traz a origem e a data. Só a correspondência <b>igual</b>
      vem escolhida; as outras ficam por decidir.
    </p>`
    }
    <div class="imp-resumo">
      <span><b>${escolhidas.length}</b> de ${r.linhas.length} linha(s) com preço escolhido</span>
      <span>histórico: <b>${(f.artigos || 0).toLocaleString("pt-PT")}</b> artigos</span>
      <span class="imp-acts">
        <button type="button" class="cm-chip${S.apenasSemPreco ? " is-on" : ""}" id="phFiltro">
          ${S.apenasSemPreco ? "Só as que faltam preçar" : "Todas as linhas"}
        </button>
      </span>
    </div>
    <div class="imp-tabela">
      <table class="cm-table ph-tabela"><tbody>
        ${r.linhas.length ? r.linhas.map(linhaHtml).join("") : `<tr><td>Não há linhas para preçar nesta folha.</td></tr>`}
      </tbody></table>
    </div>
    <p class="ba-nota">
      O preço entra na linha com a origem escrita nas observações, e o orçamento fica
      <b>por gravar</b>: veja o efeito no custo e na margem antes de gravar.
    </p>
    <div class="cm-head-actions" style="margin-top:.75rem">
      <button class="cm-chip is-on" type="button" id="phAplicar" ${S.aCorrer || !escolhidas.length ? "disabled" : ""}>
        Preencher ${escolhidas.length} preço(s)
      </button>
      <span class="cm-lead" id="phMsg" style="margin:0"></span>
    </div>`);
}

function desenhar() {
  const host = el("cmDrawer") || el("cmModal");
  if (!host) return;
  host.innerHTML = S.resposta
    ? corpo()
    : envolver(`<p class="cm-lead">${S.ctx?.file ? "A IA está a ler a pró-forma… (pode levar até um minuto)" : "A procurar no histórico…"}</p>`);
}

async function carregar() {
  S.aCorrer = true;
  desenhar();
  try {
    if (S.ctx.file) {
      // Pró-forma: a IA lê o documento uma vez; o filtro «só as que faltam» filtra no ecrã.
      if (!S.proforma) {
        const fd = new FormData();
        fd.append("file", S.ctx.file);
        fd.append("folha", S.ctx.folha);
        fd.append("linhas", JSON.stringify(S.ctx.rows()));
        S.proforma = await apiUpload(`/budgets/${encodeURIComponent(S.ctx.id)}/proforma-prices`, fd);
      }
      const r = S.proforma;
      S.resposta = { ...r, linhas: S.apenasSemPreco ? r.linhas.filter((l) => !(l.preco > 0)) : r.linhas };
    } else {
      S.resposta = await apiRequest(`/budgets/${encodeURIComponent(S.ctx.id)}/purchase-prices`, {
        method: "POST",
        body: { folha: S.ctx.folha, apenasSemPreco: S.apenasSemPreco, linhas: S.ctx.rows() },
      });
    }
  } catch (err) {
    toast(err.message || (S.ctx.file ? "Não foi possível ler a pró-forma." : "Não foi possível procurar no histórico."), { type: "error" });
    (el("cmDrawer") || el("cmModal")).innerHTML = "";
    return;
  } finally {
    S.aCorrer = false;
  }
  desenhar();
}

/** Procura à mão para uma linha: junta o que vier aos candidatos dela. */
async function procurar(i) {
  const linha = S.resposta?.linhas.find((l) => l.i === i);
  const p = S.procura[i];
  if (!linha || !p?.texto?.trim()) return;
  p.aCorrer = true;
  desenhar();
  try {
    const q = new URLSearchParams({ q: p.texto.trim(), linha: linha.desc, limit: "6" });
    if (linha.un) q.set("un", linha.un);
    const r = await apiRequest(`/budgets/purchase-prices?${q}`);
    const novos = (r.items || []).filter((c) => !linha.candidatos.some((x) => x.desc === c.desc && x.moeda === c.moeda));
    if (!novos.length) toast("Nada no histórico com esse nome.", { type: "info" });
    linha.candidatos = [...linha.candidatos, ...novos];
  } catch (err) {
    toast(err.message || "Não foi possível procurar.", { type: "error" });
  } finally {
    p.aCorrer = false;
    desenhar();
  }
}

function aplicar() {
  const r = S.resposta;
  const escolhas = r.linhas
    .filter((l) => l.escolhido !== null && l.candidatos[l.escolhido])
    .map((l) => ({ i: l.i, candidato: l.candidatos[l.escolhido] }));
  if (!escolhas.length) return;
  (el("cmDrawer") || el("cmModal")).innerHTML = "";
  S.ctx.onAplicar?.({ folha: r.folha, campos: r.campos, escolhas });
}

export function wirePrecosHistorico() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest("#phFechar,#phAplicar,#phFiltro,[data-phgo]");
    if (!t) return;
    if (t.id === "phFechar") {
      (el("cmDrawer") || el("cmModal")).innerHTML = "";
      return;
    }
    if (t.id === "phAplicar") return aplicar();
    if (t.id === "phFiltro") {
      S.apenasSemPreco = !S.apenasSemPreco;
      S.procura = {};
      return carregar();
    }
    if (t.dataset.phgo !== undefined) return procurar(Number(t.dataset.phgo));
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset?.phc === undefined || !S.resposta) return;
    const [i, ci] = t.dataset.phc.split("|");
    const linha = S.resposta.linhas.find((l) => l.i === Number(i));
    if (!linha) return;
    linha.escolhido = ci === "" ? null : Number(ci);
    desenhar();
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset?.phq === undefined) return;
    const i = Number(t.dataset.phq);
    S.procura[i] = { ...(S.procura[i] || {}), texto: t.value };
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target?.dataset?.phq === undefined) return;
    e.preventDefault();
    procurar(Number(e.target.dataset.phq));
  });
}

/**
 * Abre a procura de preços.
 *
 * @param {object} o
 * @param {string} o.id orçamento
 * @param {string} o.folha `mat` ou `sub`
 * @param {() => object[]} o.rows as linhas da folha como estão no ecrã
 * @param {(r:{folha:string, campos:object, escolhas:{i:number, candidato:object}[]}) => void} o.onAplicar
 */
export function abrirPrecosHistorico({ id, folha, rows, onAplicar, file = null }) {
  S.resposta = null;
  S.proforma = null;
  // Da pró-forma interessam todas as linhas: é o preço que se quer, mesmo que já haja outro.
  S.apenasSemPreco = !file;
  S.procura = {};
  S.aCorrer = false;
  S.ctx = { id, folha, rows, onAplicar, file };
  carregar();
}
