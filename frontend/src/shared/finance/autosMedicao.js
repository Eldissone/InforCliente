/**
 * R3 Autos de Medição — o `V.faut` do protótipo, visto do Financeiro.
 *
 * Os autos de todas as obras: o valor, a percentagem do contrato que cada um
 * mede e a acumulada, o estado e as faturas que o faturaram. Os autos
 * registam-se na obra; aqui vê-se o que está aprovado e ainda por faturar.
 */

import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, codigoNoCabecalho, moedaSeg, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, o: "", e: "", f: "", q: "", moeda: "", erro: null };

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const pc = (v) => (v === null || v === undefined ? "—" : `${v.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`);
const TOM = { APPROVED: "blue", REJECTED: "bad", SUBMITTED: "warn", DRAFT: "slate", PREVISTO: "blue" };

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const { totais, moedas } = S.d;
  // Os previstos (R3 · Planear) entram na lista com o estado «Previsto».
  const prev = (S.d.previstos || []).map((p) => ({
    ...p,
    previsto: true,
    estado: "PREVISTO",
    estadoLabel: "Previsto",
    pctAcum: null,
    faturado: false,
    faturas: [],
  }));
  const linhas = [...S.d.linhas, ...prev].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const vPrev = prev.filter((p) => !S.o || p.obraId === S.o);
  const q = norm(S.q).trim();
  const obras = [...new Map(linhas.map((l) => [l.obraId, l.obra])).entries()];
  const estados = [...new Map(linhas.map((l) => [l.estado, l.estadoLabel])).entries()];
  const L = linhas.filter(
    (l) =>
      (!S.o || l.obraId === S.o) &&
      (!S.e || l.estado === S.e) &&
      (!S.f || (S.f === "sim" ? l.faturado : !l.faturado && l.estado === "APPROVED")) &&
      (!q || norm([l.numero, l.obra].join(" ")).includes(q))
  );
  const acima = linhas.filter((l) => l.pctAcum !== null && l.pctAcum > 100.5);

  el.innerHTML = `
    ${kpis([
      { tom: "neu", titulo: "Medido e Aprovado", valor: fmt(totais.aprovado.valor), nota: `${totais.aprovado.n} auto(s)` },
      { tom: "good", titulo: "Já Faturado", valor: fmt(totais.faturado.valor), nota: `${totais.faturado.n} auto(s)` },
      { tom: "warn", titulo: "Aprovado por Faturar", valor: fmt(totais.porFaturar.valor), nota: `${totais.porFaturar.n} auto(s)` },
      { tom: "blue", titulo: "Previstos", valor: fmt(vPrev.reduce((a, p) => a + p.valor, 0)), nota: `${vPrev.length} auto(s)` },
      { tom: "blue", titulo: "Submetidos (à espera do cliente)", valor: fmt(totais.submetido.valor), nota: `${totais.submetido.n} auto(s)` },
    ])}
    ${
      acima.length
        ? `<ul class="fx3-alertas"><li><span class="material-symbols-outlined" style="font-size:16px;vertical-align:text-bottom">warning</span> ${[...new Set(acima.map((l) => l.obra))]
            .map((o) => esc(o))
            .join(", ")}: os autos já medem mais do que a venda prevista da obra (até ${pc(Math.max(...acima.map((l) => l.pctAcum)))}). Ou a venda prevista está incompleta, ou há autos a mais.</li></ul>`
        : ""
    }
    <div class="fcal-filtros">
      <input type="search" class="fcal-q" data-r3q placeholder="n.º, obra…" value="${esc(S.q)}">
      <select class="fcal-ano" data-r3s="o"><option value="">Todas as obras</option>${obras
        .map(([id, n]) => `<option value="${esc(id)}"${S.o === id ? " selected" : ""}>${esc(n)}</option>`)
        .join("")}</select>
      <select class="fcal-ano" data-r3s="e"><option value="">Todos os estados</option>${estados
        .map(([k, l]) => `<option value="${esc(k)}"${S.e === k ? " selected" : ""}>${esc(l)}</option>`)
        .join("")}</select>
      <select class="fcal-ano" data-r3s="f"><option value="">Faturação: todos</option><option value="nao"${S.f === "nao" ? " selected" : ""}>Aprovados por faturar</option><option value="sim"${S.f === "sim" ? " selected" : ""}>Faturados</option></select>
      ${moedaSeg("r3", S.d.moeda, moedas)}
      ${can("financeiro", "edit") ? `<button type="button" class="finance-btn" data-r3plan><span class="material-symbols-outlined">calendar_month</span> Planear Autos Previstos</button>` : ""}
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Data</th><th>Obra</th><th>Auto</th><th class="r">% Auto</th><th class="r">% Acum.</th><th class="r">Valor s/ IVA</th><th>Estado</th><th>Fatura</th></tr></thead>
      <tbody>${L.map(
        (l) => `<tr>
          <td>${fmtData(l.data)}</td>
          <td>${esc(l.obra)}</td>
          <td><b>n.º ${esc(l.numero)}</b></td>
          <td class="r">${pc(l.pctAuto)}</td>
          <td class="r${l.pctAcum > 100.5 ? " fcal-out" : ""}">${pc(l.pctAcum)}</td>
          <td class="r"><b>${fmt(l.valor)}</b></td>
          <td><span class="fcal-pill fcal-pill--${TOM[l.estado] || "slate"}">${esc(l.estadoLabel)}</span></td>
          <td>${
            l.previsto
              ? can("financeiro", "edit")
                ? `<button type="button" class="finance-btn finance-btn--sm" data-r3del="${esc(l.id)}">Cancelar a previsão</button>`
                : "previsto"
              : l.faturado
                ? esc(l.faturas.join(", "))
                : l.estado === "APPROVED"
                  ? `<a class="fcal-out" href="/Financeiro/faturacao/registar">por faturar</a>`
                  : "—"
          }</td>
        </tr>`
      ).join("")}</tbody>
      <tfoot><tr><td colspan="5">Total (${L.length})</td><td class="r">${fmt(L.reduce((s, l) => s + l.valor, 0))}</td><td colspan="2"></td></tr></tfoot>
    </table></div>`
        : vazio(linhas.length ? "Nenhum auto com estes filtros." : "Ainda não há autos de medição nesta moeda.")
    }
    <p class="fcal-nota">Os autos registam-se na obra. Os <b>previstos</b> planeiam-se aqui: não são autos de medição — não
      contam no medido nem no progresso da obra —, só na previsão de recebimentos (R1 «Previsto», calendário, T4 e T8). % Auto = valor do auto sobre a venda prevista da obra; % Acum. = soma dos autos até este (sem os rejeitados). Valores em ${esc(S.d.moeda)}.</p>`;
}

const PER = [
  ["S", "Semanal"],
  ["Q", "Quinzenal"],
  ["M", "Mensal"],
];

function planearModal() {
  const obras = S.d.obras || [];
  if (!obras.length) return toast("Não há obras nesta moeda.", { type: "error" });
  const hoje = new Date().toISOString().slice(0, 10);
  const obra0 = S.o || obras[0].id;
  let ultimo = null;
  const ler = (panel) => {
    const $ = (id) => panel.querySelector(id);
    return {
      obra: $("#plObra").value,
      ini: $("#plIni").value,
      per: $("#plPer").value,
      modo: $("#plModo").value,
      val: Number($("#plVal").value),
      nmax: Number($("#plN").value) || 0,
      ate100: $("#plAte").checked,
      substituir: $("#plSub").checked,
    };
  };
  const previsualizar = async (panel) => {
    const out = panel.querySelector("#plOut");
    const b = ler(panel);
    if (!(b.val > 0) || !b.ini) {
      out.innerHTML = '<p class="fx2-mut">Indique a data do primeiro e o valor ou a percentagem por auto.</p>';
      ultimo = null;
      return;
    }
    try {
      const r = await apiRequest("/finance/planned-measurements/plan", { method: "POST", body: { ...b, gravar: false } });
      ultimo = r.L.length ? b : null;
      out.innerHTML = r.L.length
        ? `<p class="fx2-mut">Contrato ${fmt(r.contrato)} · já medido ${fmt(r.medido)} · ${r.L.length} auto(s) previsto(s)${
            r.substituidos ? ` · substitui ${r.substituidos} previsto(s) desta obra` : ""
          }${r.resto > 0.5 ? ` · fica por medir ${fmt(r.resto)}` : ""}</p>
           <div class="fx2-tw pl-out"><table class="fx2-t"><thead><tr><th>Auto</th><th>Data</th><th class="r">Valor</th><th class="r">% Auto</th><th class="r">% Acum.</th></tr></thead><tbody>${r.L.map(
             (x) => `<tr><td>n.º ${x.numero}</td><td>${fmtData(x.data)}</td><td class="r">${fmt(x.valor)}</td><td class="r">${pc(x.pct)}</td><td class="r">${pc(x.pctAcum)}</td></tr>`
           ).join("")}</tbody></table></div>`
        : '<p class="fx2-mut">Nada a planear: o contrato já está todo medido.</p>';
    } catch (e) {
      ultimo = null;
      out.innerHTML = `<p class="fcal-out">${esc(e.message || "Não foi possível planear.")}</p>`;
    }
  };
  openModal({
    title: "Planear Autos Previstos",
    primaryLabel: "Gravar previstos",
    width: 720,
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field finance-field--full"><label class="finance-label">Obra</label><select id="plObra" class="finance-input">${obras
        .map((o) => `<option value="${esc(o.id)}"${o.id === obra0 ? " selected" : ""}>${esc([o.codigo, o.nome].filter(Boolean).join(" · "))} — contrato ${fmt(o.contrato)}</option>`)
        .join("")}</select></div>
      <div class="finance-field"><label class="finance-label">Primeiro auto previsto</label><input id="plIni" class="finance-input" type="date" value="${hoje}"></div>
      <div class="finance-field"><label class="finance-label">Ritmo</label><select id="plPer" class="finance-input">${PER.map(([k, l]) => `<option value="${k}"${k === "M" ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="finance-field"><label class="finance-label">Cada auto</label><select id="plModo" class="finance-input"><option value="P">% do contrato</option><option value="V">valor fixo</option></select></div>
      <div class="finance-field"><label class="finance-label">% ou valor</label><input id="plVal" class="finance-input" type="number" min="0" step="any" placeholder="ex.: 10"></div>
      <div class="finance-field"><label class="finance-label">N.º máximo de autos (0 = sem limite)</label><input id="plN" class="finance-input" type="number" min="0" max="200" value="0"></div>
      <div class="finance-field"><label class="finance-label">&nbsp;</label><label><input id="plAte" type="checkbox" checked> Fechar 100% do contrato (o último acerta a diferença)</label>
        <label><input id="plSub" type="checkbox" checked> Substituir os previstos desta obra</label></div>
      <div class="finance-field finance-field--full" id="plOut"><p class="fx2-mut">Indique a data do primeiro e o valor ou a percentagem por auto.</p></div>
    </div>`,
    onRender: ({ panel }) => {
      let t = null;
      const agenda = () => {
        clearTimeout(t);
        t = setTimeout(() => previsualizar(panel), 250);
      };
      panel.addEventListener("input", agenda);
      panel.addEventListener("change", agenda);
    },
    onPrimary: async ({ panel, close }) => {
      await previsualizar(panel);
      if (!ultimo) return toast("Não há nada para gravar.", { type: "error" });
      try {
        const r = await apiRequest("/finance/planned-measurements/plan", { method: "POST", body: { ...ultimo, gravar: true } });
        toast(`${r.gravados} auto(s) previsto(s) gravado(s).`, { type: "success" });
        close();
        S.o = ultimo.obra;
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível gravar.", { type: "error" });
      }
    },
  });
}

async function carregar() {
  S.erro = null;
  try {
    S.d = await apiRequest(`/finance/measurements${S.moeda ? `?moeda=${encodeURIComponent(S.moeda)}` : ""}`);
    S.moeda = S.d.moeda;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render() {
  codigoNoCabecalho("R3");
  const el = root();
  el.addEventListener("change", (e) => {
    const k = e.target.dataset.r3s;
    if (!k) return;
    S[k] = e.target.value;
    desenhar();
  });
  el.addEventListener("click", async (e) => {
    if (e.target.closest("[data-r3plan]")) return planearModal();
    const del = e.target.closest("[data-r3del]");
    if (del) {
      try {
        await apiRequest(`/finance/planned-measurements/${del.dataset.r3del}`, { method: "DELETE" });
        toast("Previsão cancelada.", { type: "success" });
      } catch (err) {
        toast(err.message || "Não foi possível cancelar.", { type: "error" });
      }
      return carregar();
    }
    const b = e.target.closest("[data-r3]");
    if (!b) return;
    S.moeda = b.dataset.r3.split("|")[1];
    S.o = "";
    carregar();
  });
  el.addEventListener("input", (e) => {
    if (e.target.dataset.r3q === undefined) return;
    S.q = e.target.value;
    const pos = e.target.selectionStart;
    desenhar();
    const n = root().querySelector("[data-r3q]");
    if (n) {
      n.focus();
      n.setSelectionRange(pos, pos);
    }
  });
  desenhar();
  await carregar();
}
