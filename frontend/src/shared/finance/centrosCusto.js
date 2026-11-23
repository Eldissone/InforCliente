/**
 * RG8 Centros de Custo — o `V.fccu` do protótipo.
 *
 * Cada centro com o previsto (só os que nasceram de um orçamento adjudicado),
 * o realizado sem IVA, o pago, o que está por pagar e a execução. Os custos
 * com obra mas sem centro aparecem à parte.
 */

import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtPct, codigoNoCabecalho, seg, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, tipo: "todos", ativos: "1", q: "", erro: null, abertos: new Set() };

const NATUREZA = { SEDE: "Sede", FROTA: "Frota", OUTRO: "Outro" };
const podeEditar = () => can("financeiro", "edit");
const tipoDe = (l) => (l.tipo === "OBRA" ? "Obra" : NATUREZA[l.natureza] || "Sede");

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const { linhas, semCentro, totais } = S.d;
  const q = norm(S.q).trim();
  const L = linhas.filter(
    (l) =>
      (S.tipo === "todos" || l.tipo === S.tipo) &&
      (S.ativos !== "1" || l.ativo) &&
      (!q || norm([l.codigo, l.nome, l.obra].join(" ")).includes(q))
  );

  el.innerHTML = `
    ${kpis([
      { tom: "blue", titulo: "Realizado (s/ IVA)", valor: fmt(totais.realizado), nota: `${totais.ativos} centro(s) ativo(s)` },
      { tom: "good", titulo: "Pago", valor: fmt(totais.pago) },
      { tom: totais.porPagar > 0.5 ? "warn" : "good", titulo: "Por Pagar", valor: fmt(totais.porPagar) },
      ...semCentro.map((x) => ({
        tom: "bad",
        titulo: `Sem Centro de Custo (${x.moeda})`,
        valor: fmt(x.realizado + x.porPagar),
        nota: `${x.lancamentos} lançamento(s) em ${x.obras} obra(s)`,
      })),
    ])}
    <div class="fcal-filtros">
      <input type="search" class="fcal-q" data-rgq placeholder="código, designação, obra…" value="${esc(S.q)}">
      ${seg("rg", "tipo", S.tipo, [["todos", "Todos"], ["OBRA", "Das obras"], ["GERAL", "Gerais (Sede e Frota)"]])}
      ${seg("rg", "ativos", S.ativos, [["1", "Só ativos"], ["0", "Também inativos"]])}
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Código</th><th>Designação</th><th>Tipo</th><th>Obra</th><th class="r">Previsto</th><th class="r">Realizado (s/ IVA)</th><th class="r">Pago</th><th class="r">Por Pagar</th><th class="r">Execução</th><th>Estado</th><th></th></tr></thead>
      <tbody>${L.map(
        (l) => `<tr${l.ativo ? "" : ' class="fx2-off"'}>
          <td><b>${esc(l.codigo)}</b></td>
          <td>${esc(l.nome)}</td>
          <td class="fx2-mut">${tipoDe(l)}</td>
          <td class="fx2-mut">${esc(l.obra)}</td>
          <td class="r">${
            l.tipo === "GERAL" && podeEditar()
              ? `<input class="finance-input rg-orc" type="number" min="0" step="any" data-rgorc="${esc(l.id)}" value="${l.orcamentoAnual ?? ""}" placeholder="orçamento anual">`
              : l.previsto === null
                ? '<span class="fx2-mut" title="Sem orçamento adjudicado ligado a este centro">—</span>'
                : fmt(l.previsto)
          }</td>
          <td class="r">${fmt(l.realizado)}${l.moeda !== "AOA" ? ` <small class="fx2-mut">${esc(l.moeda)}</small>` : ""}</td>
          <td class="r">${fmt(l.pago)}</td>
          <td class="r">${l.porPagar ? fmt(l.porPagar) : "—"}</td>
          <td class="r">${l.execucao === null ? "—" : `<span class="${l.execucao > 1 ? "fcal-out" : ""}">${fmtPct(l.execucao)}</span>`}</td>
          <td>${l.ativo ? '<span class="fcal-pill fcal-pill--blue">ativo</span>' : '<span class="fcal-pill fcal-pill--slate">inativo</span>'}</td>
          <td class="rg-acts"><button type="button" class="finance-btn finance-btn--sm${S.abertos.has(l.id) ? " is-on" : ""}" data-rgsub="${esc(l.id)}">Subcustos${
            l.subs?.length ? ` (${l.subs.length})` : ""
          }</button>${podeEditar() ? ` <button type="button" class="finance-btn finance-btn--sm" data-rged="${esc(l.id)}">Editar</button>` : ""}</td>
        </tr>${S.abertos.has(l.id) ? subsHtml(l) : ""}`
      ).join("")}</tbody>
    </table></div>`
        : vazio("Nada a mostrar com estes filtros.")
    }
    ${
      podeEditar()
        ? `<section class="fx2-blk"><h3>Novo centro de custo</h3><div class="cp-filtros">
        <input class="finance-input" id="rgNovoC" placeholder="Código (ex.: CC-ARMAZEM)">
        <input class="finance-input rg-nome" id="rgNovoN" placeholder="Designação">
        <select class="finance-input" id="rgNovoT">${Object.entries(NATUREZA).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <input class="finance-input rg-orc" id="rgNovoO" type="number" min="0" step="any" placeholder="orçamento anual">
        <button type="button" class="finance-btn finance-btn--primary" data-rgnovo>Adicionar</button>
      </div><p class="fx2-mut">Os centros das obras nascem na adjudicação do orçamento; aqui criam-se os da estrutura (Sede, Frota, outros).</p></section>`
        : ""
    }
    <p class="fcal-nota">
      Indique o orçamento anual dos centros que não são obras para comparar com o realizado. Em <b>Editar</b> muda o nome
      e o tipo, desativa um centro (deixa de aparecer nas listas de escolha) ou apaga um geral que ainda não foi usado.
      Realizado = custo sem IVA (a compra para armazém não é custo; o custo nasce no consumo). Pago = o
      dinheiro que saiu. O previsto só existe nos centros que nasceram de um orçamento adjudicado — é o custo
      previsto da obra; os outros centros da mesma obra não têm previsto próprio.
      ${totais.noutraMoeda ? `Os totais em cima são só dos centros em kwanzas (${totais.noutraMoeda} noutra moeda).` : ""}
    </p>`;
}

function subsHtml(l) {
  const S2 = l.subs || [];
  return `<tr class="rg-subs"><td colspan="11">${
    S2.length
      ? `<table class="fx2-t rg-subt"><thead><tr><th>Subcusto</th><th class="r">Lançamentos</th><th class="r">Custo (s/ IVA)</th></tr></thead><tbody>${S2.map(
          (x) => `<tr><td>${esc(x.k)}</td><td class="r">${x.n}</td><td class="r"><b>${fmt(x.custo)}</b></td></tr>`
        ).join("")}</tbody><tfoot><tr class="f0-tot"><td>Total</td><td></td><td class="r">${fmt(S2.reduce((a, x) => a + x.custo, 0))}</td></tr></tfoot></table>
        <p class="fx2-mut">Só custos (sem IVA), pela categoria. Empréstimos, impostos a entregar e transferências não aparecem aqui.</p>`
      : '<span class="fx2-mut">Sem custos neste centro de custo.</span>'
  }</td></tr>`;
}

async function carregar() {
  try {
    S.d = await apiRequest("/finance/cost-centers/summary");
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

async function guardar(url, method, body, ok) {
  try {
    await apiRequest(url, { method, body });
    if (ok) toast(ok, { type: "success" });
    await carregar();
    return true;
  } catch (e) {
    toast(e.message || "Não foi possível guardar.", { type: "error" });
    return false;
  }
}

function editar(l) {
  const geral = l.tipo === "GERAL";
  openModal({
    title: `Editar ${l.codigo}`,
    primaryLabel: "Guardar",
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field finance-field--full"><label class="finance-label">Designação</label><input id="rgEdN" class="finance-input" value="${esc(l.nome)}"></div>
      ${
        geral
          ? `<div class="finance-field"><label class="finance-label">Tipo</label><select id="rgEdT" class="finance-input">${Object.entries(NATUREZA)
              .map(([k, v]) => `<option value="${k}"${l.natureza === k ? " selected" : ""}>${v}</option>`)
              .join("")}</select></div>
             <div class="finance-field"><label class="finance-label">Orçamento anual</label><input id="rgEdO" class="finance-input" type="number" min="0" step="any" value="${l.orcamentoAnual ?? ""}"></div>`
          : `<p class="fx2-mut finance-field--full">Centro de obra (${esc(l.obra)}): o código é o do orçamento e não muda.</p>`
      }
      <label class="finance-field finance-field--full"><span><input id="rgEdA" type="checkbox"${l.ativo ? " checked" : ""}> Ativo (aparece nas listas de escolha)</span></label>
      ${geral && l.apagavel ? `<div class="finance-field--full"><button type="button" id="rgEdDel" class="finance-btn">Apagar este centro (nunca foi usado)</button></div>` : ""}
    </div>`,
    onRender: ({ panel, close }) => {
      panel.querySelector("#rgEdDel")?.addEventListener("click", async () => {
        if (!confirm(`Apagar o centro ${l.codigo}? Não se pode desfazer.`)) return;
        if (await guardar(`/finance/cost-centers/general/${l.id}`, "DELETE", undefined, "Centro apagado.")) close();
      });
    },
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id);
      const nome = $("#rgEdN").value.trim();
      if (nome.length < 2) return toast("Indique a designação.", { type: "error" });
      const body = { name: nome, active: $("#rgEdA").checked };
      if (geral) {
        body.kind = $("#rgEdT").value;
        body.annualBudget = $("#rgEdO").value === "" ? null : Number($("#rgEdO").value);
      }
      const url = geral ? `/finance/cost-centers/general/${l.id}` : `/finance/cost-centers/project/${l.id}`;
      if (await guardar(url, "PATCH", body, "Centro de custo guardado.")) close();
    },
  });
}

export async function render() {
  codigoNoCabecalho("RG8");
  const el = root();
  el.addEventListener("click", (e) => {
    const sub = e.target.closest("[data-rgsub]");
    if (sub) {
      const id = sub.dataset.rgsub;
      if (S.abertos.has(id)) S.abertos.delete(id);
      else S.abertos.add(id);
      return desenhar();
    }
    const ed = e.target.closest("[data-rged]");
    if (ed) {
      const l = S.d?.linhas.find((x) => x.id === ed.dataset.rged);
      if (l) editar(l);
      return;
    }
    if (e.target.closest("[data-rgnovo]")) {
      const $ = (id) => root().querySelector(id);
      const code = $("#rgNovoC").value.trim();
      const name = $("#rgNovoN").value.trim();
      if (code.length < 2 || name.length < 2) return toast("Indique o código e a designação.", { type: "error" });
      const orc = $("#rgNovoO").value;
      guardar(
        "/finance/cost-centers/general",
        "POST",
        { code, name, kind: $("#rgNovoT").value, annualBudget: orc === "" ? null : Number(orc) },
        `Centro ${code.toUpperCase()} criado.`
      );
      return;
    }
    const b = e.target.closest("[data-rg]");
    if (!b) return;
    const [k, v] = b.dataset.rg.split("|");
    S[k] = v;
    desenhar();
  });
  el.addEventListener("change", (e) => {
    const id = e.target.dataset.rgorc;
    if (!id) return;
    const v = e.target.value;
    guardar(`/finance/cost-centers/general/${id}`, "PATCH", { annualBudget: v === "" ? null : Number(v) }, "Orçamento anual guardado.");
  });
  el.addEventListener("input", (e) => {
    if (e.target.dataset.rgq === undefined) return;
    S.q = e.target.value;
    const pos = e.target.selectionStart;
    desenhar();
    const n = root().querySelector("[data-rgq]");
    if (n) {
      n.focus();
      n.setSelectionRange(pos, pos);
    }
  });
  desenhar();
  await carregar();
}
