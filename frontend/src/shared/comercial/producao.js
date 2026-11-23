/**
 * Orçamento › Produção (P1–P8) — os ecrãs, como no protótipo:
 *   P1 Planeamento de tarefas · P2 Cronograma de execução · P3 Metas ·
 *   P4 Cronograma de equipamentos e máquinas · P5 Planeamento de RH ·
 *   P6 Organograma da obra · P7 EPI · P8 Alimentação.
 *
 * O documento vive em `S.doc.production` e grava-se com o orçamento. As contas
 * estão em `producaoCore.js`. Nada passa sozinho para as folhas de custo: o
 * botão «Passar para Custos diretos» põe lá as linhas marcadas «tarefas», sem
 * tocar nas que foram escritas à mão.
 */

import { escapeHtml, toast, openModal } from "/shared/ui.js";
import * as P from "/shared/comercial/producaoCore.js";

const esc = (v) => escapeHtml(String(v ?? ""));
const fmt = (v, d = 0) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
const dt = (k) => (k ? k.split("-").reverse().join("/") : "—");
const dm = (k) => (k ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : "");

export const PRODUCAO = [
  ["prod", "P1", "Planeamento de tarefas"],
  ["pcron", "P2", "Cronograma de execução"],
  ["metas", "P3", "Metas"],
  ["pmaq", "P4", "Cronograma de equipamentos e máquinas"],
  ["prh", "P5", "Planeamento de recursos humanos"],
  ["org", "P6", "Organograma da obra"],
  ["epi", "P7", "EPI"],
  ["alim", "P8", "Alimentação"],
];

let C = null; // { S, markDirty, render, optionsFor, editable }

function doc() {
  const S = C.S;
  if (!S.doc.production || typeof S.doc.production !== "object") S.doc.production = {};
  const d = S.doc.production;
  d.cal = d.cal || { inicio: S.head?.startDate || null, dias: 6, efic: 0.85, feriados: [] };
  d.tarefas = d.tarefas || [];
  d.ind = d.ind || [];
  d.indm = d.indm || [];
  d.org = d.org || { nomes: {} };
  d.epi = d.epi || { itens: [] };
  d.alim = d.alim || { ativo: false, refeicoes: 2, custo: 0 };
  return d;
}

function mudou() {
  C.markDirty();
  C.render();
}

const head = (tag, titulo, lead, acoes = "") => `<div class="cm-head" style="margin-bottom:.5rem">
  <div><div class="cm-head-num">${tag}</div><h2 class="cm-panel-title" style="font-size:1.0625rem">${esc(titulo)}</h2>
  <p class="cm-lead" style="margin-top:.25rem">${esc(lead)}</p></div>
  <div class="cm-head-actions">${acoes}</div></div>`;

const vazio = (t) => `<p class="cm-lead" style="padding:1rem 0">${t}</p>`;

function plano() {
  return P.planear(doc());
}

// ─────────────────────────────── P1 ───────────────────────────────

function viewP1() {
  const d = doc();
  const pl = plano();
  const ed = C.editable;
  const cal = d.cal;
  const tarefas = pl.tarefas;
  const ops = (src) => C.optionsFor(src).map((o) => o.v);
  const fn = ops("barem.RH");
  return `${head(
    "P1",
    "Planeamento de tarefas",
    "Cada tarefa: a quantidade, quanto uma equipa faz por dia, quantas equipas, a equipa, as máquinas e os materiais por unidade. A duração e as datas saem do calendário. O pessoal indireto (direção, segurança, armazém…) e os meios de apoio ficam por baixo. «Passar para Custos diretos» põe tudo em RH, Equipamentos, Viaturas e Materiais.",
    ed
      ? `<button class="cm-chip" type="button" data-pr="doMapa">Importar do mapa de quantidades</button>
         <button class="cm-chip is-on" type="button" data-pr="nova">+ Criar tarefa</button>
         <button class="cm-chip is-on" type="button" data-pr="aplicar" ${tarefas.length || d.ind.length ? "" : "disabled"}>Passar para Custos diretos</button>`
      : ""
  )}
  <section class="cm-panel pr-cal">
    <b>Calendário</b>
    <label>Início da obra <input type="date" class="cell-manual" data-prc="inicio" value="${esc(cal.inicio || "")}" ${ed ? "" : "disabled"}></label>
    <label>Dias por semana <select class="cell-list" data-prc="dias" ${ed ? "" : "disabled"}>${[[5, "5 (seg–sex)"], [6, "6 (seg–sáb)"], [7, "7 (todos)"]]
      .map(([v, l]) => `<option value="${v}"${Number(cal.dias) === v ? " selected" : ""}>${l}</option>`)
      .join("")}</select></label>
    <label>Eficiência (%) <input type="number" min="10" max="100" class="cell-manual pr-n" data-prc="efic" value="${Math.round((Number(cal.efic) || 1) * 100)}" ${ed ? "" : "disabled"}></label>
    <label class="pr-fer">Feriados (dd/mm/aaaa, separados por vírgula) <input class="cell-manual" data-prc="feriados" value="${esc((cal.feriados || []).map(dt).join(", "))}" ${ed ? "" : "disabled"}></label>
    <span class="cm-calc">Obra: <b>${dt(pl.ini)}</b> → <b>${dt(pl.fim)}</b></span>
  </section>
  ${
    tarefas.length
      ? `<div class="cm-table-wrap"><table class="cm-table pr-t"><thead><tr><th>#</th><th>Tarefa</th><th>Un.</th><th class="num">Quantidade</th><th class="num">Rend./equipa/dia</th><th class="num">Equipas</th><th>Equipa</th><th>Máquinas</th><th>Materiais</th><th>Depende de</th><th class="num">Dias</th><th>Início</th><th>Fim</th>${ed ? "<th></th>" : ""}</tr></thead>
        <tbody>${tarefas
          .map(
            (t, i) => `<tr>
          <td>${i + 1}</td><td><b>${esc(t.nome)}</b></td><td>${esc(t.un || "")}</td><td class="num">${fmt(t.q, 2)}</td>
          <td class="num">${t.rend ? fmt(t.rend, 2) : '<span class="pr-falta">falta</span>'}</td><td class="num">${t.equipas || 1}</td>
          <td class="cm-calc">${esc((t.equipa || []).map((p) => `${p.n} ${p.f}`).join(" + ") || "—")}</td>
          <td class="cm-calc">${esc((t.maq || []).map((m) => `${m.n} ${m.nome}`).join(", ") || "—")}</td>
          <td class="cm-calc">${esc((t.mat || []).map((m) => `${m.c}/${t.un || "un"} ${m.desc}`).join(", ") || "—")}</td>
          <td class="cm-calc">${esc((t.dep || []).map((id) => tarefas.findIndex((x) => x.id === id) + 1).filter((n) => n > 0).join(", ") || "—")}</td>
          <td class="num">${t.n || "—"}</td><td>${dt(t.ini)}</td><td>${dt(t.fim)}</td>
          ${ed ? `<td class="pr-acts"><button class="cm-chip" type="button" data-pr="editar|${esc(t.id)}">Editar</button><button class="cm-chip" type="button" data-pr="apagar|${esc(t.id)}"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button></td>` : ""}
        </tr>`
          )
          .join("")}</tbody></table></div>`
      : vazio(
          "Ainda não há tarefas. Comece por <b>Importar do mapa de quantidades</b> (cada artigo passa a tarefa) ou <b>+ Criar tarefa</b>."
        )
  }
  <h3 class="cm-panel-title" style="margin-top:1rem">Pessoal indireto e meios de apoio</h3>
  <p class="cm-calc">Quem trabalha para a obra mas não pertence a nenhuma tarefa. Por omissão, a obra toda; preencha Desde/Até só se for diferente.</p>
  ${
    ed
      ? `<div class="cm-head-actions" style="margin:.375rem 0">${[
          ["Diretor de obra", 0.3],
          ["Encarregado", 1],
          ["Segurança/HSE", 1],
          ["Fiel de armazém", 1],
          ["Guarda", 2],
          ["Motorista", 1],
        ]
          .map(([f, x]) => `<button class="cm-chip" type="button" data-pr="ind|${esc(f)}|${x}">+ ${esc(f)}</button>`)
          .join("")}<button class="cm-chip" type="button" data-pr="ind||1">+ Outra função</button><button class="cm-chip" type="button" data-pr="indm|vi">+ Viatura de apoio</button><button class="cm-chip" type="button" data-pr="indm|eq">+ Equipamento de apoio</button></div>`
      : ""
  }
  ${
    d.ind.length || d.indm.length
      ? `<div class="cm-table-wrap"><table class="cm-table"><thead><tr><th>Tipo</th><th>Função / meio</th><th class="num">Pessoas / unidades</th><th class="num">Dedicação %</th><th>Desde</th><th>Até</th><th class="num">Dias</th>${ed ? "<th></th>" : ""}</tr></thead><tbody>
        ${d.ind
          .map(
            (p, i) => `<tr><td>Pessoal</td>
            <td><input class="cell-manual" list="prFn" data-pri="ind|${i}|f" value="${esc(p.f || "")}" ${ed ? "" : "disabled"}></td>
            <td class="num"><input type="number" min="0" class="cell-manual pr-n" data-pri="ind|${i}|n" value="${esc(p.n ?? 1)}" ${ed ? "" : "disabled"}></td>
            <td class="num"><input type="number" min="0" max="100" class="cell-manual pr-n" data-pri="ind|${i}|ded" value="${Math.round((p.ded ?? 1) * 100)}" ${ed ? "" : "disabled"}></td>
            <td><input type="date" class="cell-manual" data-pri="ind|${i}|ini" value="${esc(p.ini || "")}" ${ed ? "" : "disabled"}></td>
            <td><input type="date" class="cell-manual" data-pri="ind|${i}|fim" value="${esc(p.fim || "")}" ${ed ? "" : "disabled"}></td>
            <td class="num">${pl.ind[i]?.dias.length || 0}</td>${ed ? `<td><button class="cm-chip" type="button" data-pr="inddel|${i}"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button></td>` : ""}</tr>`
          )
          .join("")}
        ${d.indm
          .map(
            (m, i) => `<tr><td>${m.tipo === "eq" ? "Equipamento" : "Viatura"}</td>
            <td><input class="cell-manual" list="${m.tipo === "eq" ? "prEq" : "prVi"}" data-pri="indm|${i}|nome" value="${esc(m.nome || "")}" ${ed ? "" : "disabled"}></td>
            <td class="num"><input type="number" min="0" class="cell-manual pr-n" data-pri="indm|${i}|n" value="${esc(m.n ?? 1)}" ${ed ? "" : "disabled"}></td><td></td>
            <td><input type="date" class="cell-manual" data-pri="indm|${i}|ini" value="${esc(m.ini || "")}" ${ed ? "" : "disabled"}></td>
            <td><input type="date" class="cell-manual" data-pri="indm|${i}|fim" value="${esc(m.fim || "")}" ${ed ? "" : "disabled"}></td>
            <td class="num">${pl.indm[i]?.dias.length || 0}</td>${ed ? `<td><button class="cm-chip" type="button" data-pr="indmdel|${i}"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button></td>` : ""}</tr>`
          )
          .join("")}</tbody></table></div>`
      : ""
  }
  <datalist id="prFn">${fn.map((v) => `<option value="${esc(v)}">`).join("")}</datalist>
  <datalist id="prEq">${ops("barem.EQUIPAMENTO").map((v) => `<option value="${esc(v)}">`).join("")}</datalist>
  <datalist id="prVi">${ops("barem.VIATURA").map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`;
}

function formTarefa(t) {
  const d = doc();
  const novo = !t;
  const o = t ? JSON.parse(JSON.stringify(t)) : { id: `t${Date.now().toString(36)}`, nome: "", un: "un", q: 0, rend: 0, equipas: 1, equipa: [], maq: [], mat: [], dep: [] };
  const ops = (src) => C.optionsFor(src).map((x) => x.v);
  const outras = d.tarefas.filter((x) => x.id !== o.id);
  const linhas = (arr, campos) =>
    (arr.length ? arr : [{}])
      .map(
        (r, i) => `<div class="pr-lin">${campos
          .map(([k, ph, tipo, lista]) => `<input class="finance-input" ${lista ? `list="${lista}"` : ""} type="${tipo || "text"}" data-l="${k}" data-i="${i}" placeholder="${ph}" value="${esc(r[k] ?? "")}">`)
          .join("")}</div>`
      )
      .join("");
  openModal({
    title: novo ? "Criar tarefa" : `Tarefa · ${o.nome}`,
    primaryLabel: "Guardar tarefa",
    width: 820,
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field finance-field--full"><label class="finance-label">Tarefa *</label><input id="tfN" class="finance-input" value="${esc(o.nome)}" placeholder="ex.: Abertura de caboucos"></div>
      <div class="finance-field"><label class="finance-label">Unidade</label><input id="tfU" class="finance-input" value="${esc(o.un || "un")}"></div>
      <div class="finance-field"><label class="finance-label">Quantidade *</label><input id="tfQ" class="finance-input" type="number" min="0" step="any" value="${esc(o.q)}"></div>
      <div class="finance-field"><label class="finance-label">Quanto uma equipa faz por dia *</label><input id="tfR" class="finance-input" type="number" min="0" step="any" value="${esc(o.rend || "")}"></div>
      <div class="finance-field"><label class="finance-label">N.º de equipas</label><input id="tfE" class="finance-input" type="number" min="1" step="1" value="${esc(o.equipas || 1)}"></div>
      <div class="finance-field"><label class="finance-label">Início fixo (opcional)</label><input id="tfI" class="finance-input" type="date" value="${esc(o.ini || "")}"></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Depende de (começa depois de)</label>
        <select id="tfD" class="finance-input" multiple size="${Math.min(5, Math.max(2, outras.length))}">${outras
          .map((x) => `<option value="${esc(x.id)}"${(o.dep || []).includes(x.id) ? " selected" : ""}>${esc(x.nome)}</option>`)
          .join("")}</select></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Equipa (por equipa): função e n.º de pessoas</label><div id="tfEq">${linhas(o.equipa, [["f", "Função", "text", "tfFn"], ["n", "Pessoas", "number"]])}</div><button type="button" class="finance-btn finance-btn--sm" data-add="tfEq">+ pessoa</button></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Máquinas e viaturas (por equipa): tipo (eq/vi), nome e unidades</label><div id="tfMq">${linhas(o.maq, [["tipo", "eq ou vi"], ["nome", "Equipamento / viatura", "text", "tfMqL"], ["n", "Unidades", "number"]])}</div><button type="button" class="finance-btn finance-btn--sm" data-add="tfMq">+ máquina</button></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Materiais: descrição, unidade e consumo por unidade da tarefa</label><div id="tfMt">${linhas(o.mat, [["desc", "Material"], ["un", "Un."], ["c", "Consumo", "number"]])}</div><button type="button" class="finance-btn finance-btn--sm" data-add="tfMt">+ material</button></div>
      <datalist id="tfFn">${ops("barem.RH").map((v) => `<option value="${esc(v)}">`).join("")}</datalist>
      <datalist id="tfMqL">${[...ops("barem.EQUIPAMENTO"), ...ops("barem.VIATURA")].map((v) => `<option value="${esc(v)}">`).join("")}</datalist>
    </div>`,
    onRender: ({ panel }) => {
      panel.addEventListener("click", (e) => {
        const b = e.target.closest("[data-add]");
        if (!b) return;
        const box = panel.querySelector(`#${b.dataset.add}`);
        const ult = box.lastElementChild;
        const novaL = ult.cloneNode(true);
        const i = box.children.length;
        novaL.querySelectorAll("input").forEach((inp) => {
          inp.value = "";
          inp.dataset.i = String(i);
        });
        box.appendChild(novaL);
      });
    },
    onPrimary: ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id);
      const ler = (box, campos, nums) =>
        [...$(box).children]
          .map((row) => Object.fromEntries(campos.map((k) => [k, row.querySelector(`[data-l="${k}"]`).value.trim()])))
          .filter((r) => Object.values(r).some(Boolean))
          .map((r) => {
            for (const k of nums) r[k] = Number(r[k]) || 0;
            return r;
          });
      o.nome = $("#tfN").value.trim();
      if (o.nome.length < 2) return toast("Indique a tarefa.", { type: "error" });
      o.un = $("#tfU").value.trim() || "un";
      o.q = Number($("#tfQ").value) || 0;
      o.rend = Number($("#tfR").value) || 0;
      o.equipas = Math.max(1, Math.round(Number($("#tfE").value) || 1));
      o.ini = $("#tfI").value || null;
      o.dep = [...$("#tfD").selectedOptions].map((x) => x.value);
      o.equipa = ler("#tfEq", ["f", "n"], ["n"]).filter((p) => p.f);
      o.maq = ler("#tfMq", ["tipo", "nome", "n"], ["n"])
        .filter((m) => m.nome)
        .map((m) => ({ ...m, tipo: m.tipo === "vi" ? "vi" : "eq" }));
      o.mat = ler("#tfMt", ["desc", "un", "c"], ["c"]).filter((m) => m.desc);
      const i = d.tarefas.findIndex((x) => x.id === o.id);
      if (i >= 0) d.tarefas[i] = o;
      else d.tarefas.push(o);
      close();
      mudou();
    },
  });
}

function aplicarFolhas() {
  const S = C.S;
  const L = P.linhasParaFolhas(plano());
  S.doc.sheets.rh = P.aplicarFolha(S.doc.sheets.rh, L.rh, "funcao");
  S.doc.sheets.eq = P.aplicarFolha(S.doc.sheets.eq, L.eq, "equip");
  S.doc.sheets.vi = P.aplicarFolha(S.doc.sheets.vi, L.vi, "viat");
  S.doc.sheets.mat = P.aplicarFolha(S.doc.sheets.mat, L.mat, "desc");
  toast(`Custos diretos atualizados: ${L.rh.length} função(ões), ${L.eq.length} equipamento(s), ${L.vi.length} viatura(s), ${L.mat.length} material(is). Grave o orçamento.`, { type: "success" });
  mudou();
}

// ─────────────────────────────── P2–P5 ───────────────────────────────

function grelha(linhas, sem, celula, primeira, extra = []) {
  if (!sem.length) return vazio("Sem tarefas com datas. Preencha as tarefas em P1 (quantidade e rendimento).");
  const hoje = P.weekOf(new Date().toISOString().slice(0, 10));
  return `<div class="cm-table-wrap pr-gantt"><table class="cm-table"><thead><tr><th>${primeira}</th>${extra.map((x) => `<th class="num">${x}</th>`).join("")}${sem
    .map((w) => `<th class="pr-w${w === hoje ? " pr-hoje" : ""}">${dm(w)}</th>`)
    .join("")}</tr></thead><tbody>${linhas.join("")}</tbody></table></div>`;
}

function viewP2() {
  const pl = plano();
  const sem = P.semanas(pl);
  const L = pl.tarefas.map((t) => {
    const ws = new Set((t.dias || []).map(P.weekOf));
    return `<tr><td><b>${esc(t.nome)}</b><div class="cm-calc">${dt(t.ini)} → ${dt(t.fim)} · ${t.n || 0} dia(s)</div></td>${sem
      .map((w) => `<td class="pr-cel">${ws.has(w) ? '<i class="pr-bar"></i>' : ""}</td>`)
      .join("")}</tr>`;
  });
  return `${head("P2", "Cronograma de execução", "As tarefas no tempo, semana a semana, pelas datas do planeamento (P1).")}${grelha(L, sem, null, "Tarefa")}`;
}

function viewP3() {
  const pl = plano();
  const sem = P.semanas(pl);
  const M = P.metas(pl);
  const L = M.map(
    (m) => `<tr><td><b>${esc(m.nome)}</b><div class="cm-calc">${fmt(m.q, 2)} ${esc(m.un || "")}</div></td>${sem
      .map((w) => {
        const x = m.semanas[w];
        return `<td class="num pr-cel">${x ? `${fmt(x.q, 1)}<div class="cm-calc">${fmt(x.pct)}%</div>` : ""}</td>`;
      })
      .join("")}</tr>`
  );
  return `${head("P3", "Metas", "O que cada tarefa tem de fazer em cada semana para cumprir o prazo, e a percentagem acumulada.")}${grelha(L, sem, null, "Tarefa")}`;
}

function viewP4() {
  const pl = plano();
  const sem = P.semanas(pl);
  const M = P.maqPorSemana(pl);
  const L = M.map(
    (m) => `<tr><td><b>${esc(m.nome)}</b> <span class="cm-calc">${m.tipo === "vi" ? "viatura" : "equipamento"}</span></td><td class="num">${fmt(m.unidadesDia)}</td>${sem
      .map((w) => `<td class="num pr-cel">${m.semanas[w] ? fmt(m.semanas[w]) : ""}</td>`)
      .join("")}</tr>`
  );
  return `${head("P4", "Cronograma de equipamentos e máquinas", "Quantas unidades de cada equipamento e viatura são precisas em cada semana (o máximo de um dia), e as unidades-dia no total.")}${
    M.length ? grelha(L, sem, null, "Equipamento / viatura", ["Unid.-dia"]) : vazio("As tarefas ainda não têm máquinas nem viaturas.")
  }`;
}

function viewP5() {
  const pl = plano();
  const sem = P.semanas(pl);
  const R = P.rhPorSemana(pl);
  const tot = sem.map((w) => R.reduce((s, r) => s + (r.semanas[w] || 0), 0));
  const L = R.map(
    (r) => `<tr><td><b>${esc(r.f)}</b></td><td class="num">${fmt(r.pessoasDia)}</td>${sem.map((w) => `<td class="num pr-cel">${r.semanas[w] ? fmt(r.semanas[w], 1) : ""}</td>`).join("")}</tr>`
  );
  if (R.length) L.push(`<tr class="pr-tot"><td>Total na obra</td><td class="num">${fmt(R.reduce((s, r) => s + r.pessoasDia, 0))}</td>${tot.map((n) => `<td class="num">${n ? fmt(n, 1) : ""}</td>`).join("")}</tr>`);
  return `${head("P5", "Planeamento de recursos humanos", "Quantas pessoas de cada função estão na obra em cada semana (o máximo de um dia), das tarefas e do pessoal indireto.")}${
    R.length ? grelha(L, sem, null, "Função", ["Pessoas-dia"]) : vazio("As tarefas ainda não têm equipa.")
  }`;
}

// ─────────────────────────────── P6–P8 ───────────────────────────────

const NIVEL = [
  [/diretor|director/i, 0],
  [/engenheir|técnico|tecnico|hse|segurança|seguranca/i, 1],
  [/encarregad|chefe|capataz/i, 2],
];
const nivelDe = (f) => (NIVEL.find(([r]) => r.test(f)) || [null, 3])[1];

function viewP6() {
  const d = doc();
  const R = P.rhPorSemana(plano());
  const ed = C.editable;
  const niveis = [[], [], [], []];
  for (const r of R) niveis[nivelDe(r.f)].push(r);
  const caixa = (r) => `<div class="pr-org-c"><b>${esc(r.f)}</b><span>${r.max} pessoa(s)</span>
    <input class="cell-manual" data-pro="${esc(r.f)}" placeholder="nome(s)" value="${esc(d.org.nomes[r.f] || "")}" ${ed ? "" : "disabled"}></div>`;
  return `${head("P6", "Organograma da obra", "As funções da obra por nível (direção, técnicos e segurança, encarregados, equipas), com o número de pessoas do planeamento. Escreva os nomes.")}${
    R.length
      ? `<div class="pr-org">${["Direção", "Técnicos e segurança", "Encarregados", "Equipas"]
          .map((l, i) => (niveis[i].length ? `<div class="pr-org-n"><span class="cm-calc">${l}</span><div class="pr-org-l">${niveis[i].map(caixa).join("")}</div></div>` : ""))
          .join("")}</div>`
      : vazio("Ainda não há funções: crie as tarefas e o pessoal indireto em P1.")
  }`;
}

function viewP7() {
  const d = doc();
  const R = P.rhPorSemana(plano());
  const E = P.epi(d, R);
  const ed = C.editable;
  const fns = R.map((r) => r.f);
  return `${head(
    "P7",
    "EPI",
    "Para cada equipamento de proteção, o preço e quantas peças leva cada pessoa de cada função. O total conta as pessoas do planeamento (o máximo de cada função).",
    ed
      ? `<button class="cm-chip" type="button" data-pr="epiBase">+ Lista base (capacete, botas, luvas, colete, óculos)</button><button class="cm-chip" type="button" data-pr="epiAdd">+ Item</button>
         <button class="cm-chip is-on" type="button" data-pr="epiFe" ${E.total ? "" : "disabled"}>Passar para Ferramentas e consumíveis</button>`
      : ""
  )}${
    d.epi.itens.length
      ? `<div class="cm-table-wrap"><table class="cm-table"><thead><tr><th>Item</th><th class="num">Preço unit.</th>${fns.map((f) => `<th class="num">${esc(f)}<div class="cm-calc">${R.find((r) => r.f === f).max} p.</div></th>`).join("")}<th class="num">Peças</th><th class="num">Total</th>${ed ? "<th></th>" : ""}</tr></thead>
        <tbody>${d.epi.itens
          .map(
            (it, i) => `<tr><td><input class="cell-manual" data-pre="${i}|item" value="${esc(it.item)}" ${ed ? "" : "disabled"}></td>
            <td class="num"><input type="number" min="0" class="cell-manual pr-n" data-pre="${i}|preco" value="${esc(it.preco ?? "")}" ${ed ? "" : "disabled"}></td>
            ${fns.map((f) => `<td class="num"><input type="number" min="0" class="cell-manual pr-n" data-pre="${i}|por|${esc(f)}" value="${esc(it.por?.[f] ?? "")}" ${ed ? "" : "disabled"}></td>`).join("")}
            <td class="num">${fmt(E.itens[i].pecas)}</td><td class="num"><b>${fmt(E.itens[i].total)}</b></td>${ed ? `<td><button class="cm-chip" type="button" data-pr="epiDel|${i}"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button></td>` : ""}</tr>`
          )
          .join("")}</tbody><tfoot><tr><td colspan="${fns.length + 3}">Total EPI</td><td class="num"><b>${fmt(E.total)}</b></td>${ed ? "<td></td>" : ""}</tr></tfoot></table></div>`
      : vazio("Ainda não há itens de EPI.")
  }`;
}

function viewP8() {
  const d = doc();
  const R = P.rhPorSemana(plano());
  const A = P.alimentacao(d, R);
  const ed = C.editable;
  return `${head(
    "P8",
    "Alimentação",
    "Se a MBT dá a alimentação ao pessoal: refeições por pessoa e por dia e o custo de cada refeição. As pessoas-dia vêm do planeamento.",
    ed ? `<button class="cm-chip is-on" type="button" data-pr="alimLog" ${A.total ? "" : "disabled"}>Passar para Logística e estaleiro</button>` : ""
  )}
  <section class="cm-panel pr-cal">
    <label><input type="checkbox" data-pra="ativo" ${d.alim.ativo ? "checked" : ""} ${ed ? "" : "disabled"}> A MBT dá a alimentação</label>
    <label>Refeições por pessoa e por dia <input type="number" min="0" step="any" class="cell-manual pr-n" data-pra="refeicoes" value="${esc(d.alim.refeicoes ?? 2)}" ${ed ? "" : "disabled"}></label>
    <label>Custo por refeição <input type="number" min="0" step="any" class="cell-manual pr-n" data-pra="custo" value="${esc(d.alim.custo ?? 0)}" ${ed ? "" : "disabled"}></label>
  </section>
  <div class="cm-grupos">
    <span class="cm-chip"><span>Pessoas-dia</span><b>${fmt(A.pessoasDia)}</b></span>
    <span class="cm-chip"><span>Refeições</span><b>${fmt(A.refeicoes)}</b></span>
    <span class="cm-chip"><span>Custo</span><b>${fmt(A.total)}</b></span>
  </div>
  <p class="cm-calc">Atenção: a folha de RH também conta a alimentação por pessoa e por dia pelo barém. Se passar este valor para a Logística, confirme que não fica contado duas vezes.</p>`;
}

const VIEWS = { prod: viewP1, pcron: viewP2, metas: viewP3, pmaq: viewP4, prh: viewP5, org: viewP6, epi: viewP7, alim: viewP8 };

export function viewProducao(id, ctx) {
  C = ctx;
  doc();
  return VIEWS[id]();
}

function ddmmaaaaParaIso(s) {
  return String(s || "")
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(x);
      return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null;
    })
    .filter(Boolean);
}

/** Liga os cliques e as alterações dos ecrãs de Produção (uma vez). */
export function wireProducao(getCtx) {
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pr]");
    if (!b || !document.getElementById("cmContent")?.contains(b)) return;
    C = getCtx();
    const d = doc();
    const [a, x, y] = b.dataset.pr.split("|");
    if (a === "nova") return formTarefa(null);
    if (a === "editar") return formTarefa(d.tarefas.find((t) => t.id === x));
    if (a === "apagar") {
      if (!confirm("Apagar esta tarefa?")) return;
      d.tarefas = d.tarefas.filter((t) => t.id !== x).map((t) => ({ ...t, dep: (t.dep || []).filter((k) => k !== x) }));
      return mudou();
    }
    if (a === "doMapa") {
      const novas = P.tarefasDoMapa(C.S.doc.sheets.qt, d.tarefas);
      if (!novas.length) return toast("Não há linhas novas no mapa de quantidades (com quantidade).", { type: "info" });
      d.tarefas.push(...novas);
      toast(`${novas.length} tarefa(s) criada(s) do mapa. Falta o rendimento e a equipa de cada uma.`, { type: "success" });
      return mudou();
    }
    if (a === "aplicar") return aplicarFolhas();
    if (a === "ind") {
      d.ind.push({ f: x || "", n: 1, ded: Number(y) || 1 });
      return mudou();
    }
    if (a === "inddel") {
      d.ind.splice(Number(x), 1);
      return mudou();
    }
    if (a === "indm") {
      d.indm.push({ tipo: x, nome: "", n: 1 });
      return mudou();
    }
    if (a === "indmdel") {
      d.indm.splice(Number(x), 1);
      return mudou();
    }
    if (a === "epiBase") {
      const base = ["Capacete", "Botas de segurança", "Luvas", "Colete refletor", "Óculos de proteção"];
      const ja = new Set(d.epi.itens.map((i) => i.item));
      const fns = P.rhPorSemana(P.planear(d)).map((r) => r.f);
      for (const it of base) if (!ja.has(it)) d.epi.itens.push({ item: it, preco: 0, por: Object.fromEntries(fns.map((f) => [f, 1])) });
      return mudou();
    }
    if (a === "epiAdd") {
      d.epi.itens.push({ item: "", preco: 0, por: {} });
      return mudou();
    }
    if (a === "epiDel") {
      d.epi.itens.splice(Number(x), 1);
      return mudou();
    }
    if (a === "epiFe" || a === "alimLog") {
      const R = P.rhPorSemana(P.planear(d));
      const S = C.S;
      if (a === "epiFe") {
        const E = P.epi(d, R);
        const linhas = E.itens.filter((i) => i.total > 0).map((i) => ({ item: `EPI · ${i.item}`, q: i.pecas, manual: i.total / (i.pecas || 1), orig: "epi", obs: "Do separador EPI (P7)" }));
        S.doc.sheets.fe = [...(S.doc.sheets.fe || []).filter((r) => r.orig !== "epi"), ...linhas];
        toast(`${linhas.length} item(ns) de EPI em Ferramentas e consumíveis. Grave o orçamento.`, { type: "success" });
      } else {
        const A = P.alimentacao(d, R);
        S.doc.sheets.log = [...(S.doc.sheets.log || []).filter((r) => r.orig !== "alim"), { item: "Alimentação do pessoal", descr: `${A.refeicoes} refeições (P8)`, q: A.refeicoes, dias: 1, manual: Number(d.alim.custo) || 0, orig: "alim" }];
        toast("Alimentação em Logística e estaleiro. Grave o orçamento.", { type: "success" });
      }
      return mudou();
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!document.getElementById("cmContent")?.contains(t)) return;
    if (!(t.dataset.prc || t.dataset.pri || t.dataset.pro !== undefined || t.dataset.pre || t.dataset.pra)) return;
    C = getCtx();
    const d = doc();
    if (t.dataset.prc) {
      const k = t.dataset.prc;
      d.cal[k] = k === "dias" ? Number(t.value) : k === "efic" ? Math.max(0.1, Math.min(1, (Number(t.value) || 100) / 100)) : k === "feriados" ? ddmmaaaaParaIso(t.value) : t.value || null;
    } else if (t.dataset.pri) {
      const [lista, i, k] = t.dataset.pri.split("|");
      const v = k === "n" ? Number(t.value) || 0 : k === "ded" ? Math.max(0, Math.min(1, (Number(t.value) || 0) / 100)) : t.value || null;
      d[lista][Number(i)][k] = v;
    } else if (t.dataset.pro !== undefined) {
      d.org.nomes[t.dataset.pro] = t.value;
    } else if (t.dataset.pre) {
      const [i, k, f] = t.dataset.pre.split("|");
      const it = d.epi.itens[Number(i)];
      if (k === "por") {
        it.por = it.por || {};
        it.por[f] = Number(t.value) || 0;
      } else it[k] = k === "preco" ? Number(t.value) || 0 : t.value;
    } else if (t.dataset.pra) {
      const k = t.dataset.pra;
      d.alim[k] = k === "ativo" ? t.checked : Number(t.value) || 0;
    }
    mudou();
  });
}
