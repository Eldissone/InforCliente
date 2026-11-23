/**
 * Orçamento › R1 Relatórios e documentos (o `V.rel` do protótipo).
 *
 * Todos os documentos que o programa produz sobre o orçamento, num só sítio:
 * cada cartão abre o ecrã onde se gera. E dois do próprio R1:
 *  - **Relatório do orçamento** — resumo e detalhe por categoria, aqui no
 *    ecrã; exporta-se com ⤓ PDF / ⤓ Word do cabeçalho (com o logótipo);
 *  - **Exportar todos os dados** — Excel com o resumo e todas as folhas.
 */

import { escapeHtml, toast } from "/shared/ui.js";
import { CATS } from "/shared/comercial/budgetCalc.js";

const esc = (v) => escapeHtml(String(v ?? ""));
const fmt = (v) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct = (v) => `${((Number(v) || 0) * 100).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`;
const SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

let C = null;

function card(ic, t, sub, attrs) {
  return `<button type="button" class="rel-card" ${attrs}><span class="rel-ic material-symbols-outlined">${ic}</span><span><b>${esc(t)}</b><small>${esc(sub)}</small></span></button>`;
}

/** As colunas de dados (não as calculadas) de uma folha. */
const colunas = (def) => (def?.cols || []).filter((c) => c.k);

function relatorio() {
  const S = C.S;
  const R = S.R;
  const mb = esc(S.doc.params.moedaBase || "AOA");
  const linhasCat = CATS.filter(([k]) => Number(R.C?.[k]) > 0.5);
  const detalhe = linhasCat
    .map(([k, label, , sheet]) => {
      const def = S.meta.sheets[sheet];
      const rows = (S.doc.sheets[sheet] || []).map((r, i) => ({ r, x: R[sheet]?.[i] || {} })).filter(({ x }) => Number(x.ct) > 0.005);
      if (!rows.length) return "";
      const cols = colunas(def).filter((c) => ["text", "sel", "combo", "num"].includes(c.ty) && !/obs|mg/.test(c.k)).slice(0, 5);
      return `<h3>${esc(def?.tag || "")} ${esc(label)}</h3>
      <div class="cm-table-wrap"><table class="cm-table"><thead><tr>${cols.map((c) => `<th${c.ty === "num" ? ' class="num"' : ""}>${esc(c.l)}</th>`).join("")}<th class="num">Custo</th></tr></thead>
      <tbody>${rows
        .map(({ r, x }) => `<tr>${cols.map((c) => `<td${c.ty === "num" ? ' class="num"' : ""}>${c.ty === "num" ? fmt(r[c.k]) : esc(r[c.k] ?? "")}</td>`).join("")}<td class="num">${fmt(x.ct)}</td></tr>`)
        .join("")}</tbody>
      <tfoot><tr><td colspan="${cols.length}">Total ${esc(label)}</td><td class="num">${fmt(R.C[k])}</td></tr></tfoot></table></div>`;
    })
    .join("");
  return `<section class="rel-rep">
    <h2>Relatório do orçamento ${esc(S.head.number)} · ${esc(S.head.revision)}</h2>
    <p class="cm-lead">${esc(S.doc.params.obra || S.head.projectName)} · ${esc(S.head.client?.name || "sem cliente")} · ${esc(S.doc.params.local || "")}</p>
    <div class="cm-grupos">
      <span class="cm-chip"><span>Custo total</span><b>${fmt(R.CT)}</b></span>
      <span class="cm-chip"><span>Preço s/ IVA</span><b>${fmt(R.PVsi)}</b></span>
      <span class="cm-chip"><span>Margem bruta</span><b>${pct(R.MBpct)}</b></span>
      <span class="cm-chip"><span>Moeda</span><b>${mb}</b></span>
    </div>
    <h3>Resumo por categoria</h3>
    <div class="cm-table-wrap"><table class="cm-table"><thead><tr><th>Categoria</th><th>Tipo</th><th class="num">Custo</th><th class="num">% do custo</th><th class="num">Preço de venda</th></tr></thead>
    <tbody>${linhasCat
      .map(([k, label, tipo]) => `<tr><td>${esc(label)}</td><td>${esc(tipo)}</td><td class="num">${fmt(R.C[k])}</td><td class="num">${R.CT ? pct(R.C[k] / R.CT) : "—"}</td><td class="num">${fmt(R.PVbyCat?.[k])}</td></tr>`)
      .join("")}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td class="num">${fmt(R.CT)}</td><td class="num">100%</td><td class="num">${fmt(R.PVsi)}</td></tr></tfoot></table></div>
    ${detalhe}
  </section>`;
}

export function viewR1(ctx) {
  C = ctx;
  const S = C.S;
  const id = encodeURIComponent(S.id);
  const go = (v) => `data-view="${v}"`;
  const href = (u) => `data-relhref="${esc(u)}"`;
  const G = [
    [
      "Orçamento",
      [
        card("description", "Relatório do orçamento", "Resumo e detalhe por categoria, aqui em baixo; PDF ou Word com o logótipo da MBT (botões do cabeçalho)", `data-rel="rep"`),
        card("table_view", "Exportar todos os dados", "Excel com o resumo e todas as folhas do orçamento", `data-rel="xlsx"`),
        card("fact_check", "Folha de despacho", "Custos, margens e decisão comercial", href(`/comercial/despacho?id=${id}`)),
        card("forward_to_inbox", "Propostas", "Proposta ao cliente (PDF/Word)", href(`/comercial/propostas?id=${id}`)),
      ],
    ],
    [
      "Produção",
      [
        card("calendar_month", "Cronograma de execução", "As tarefas no tempo (P2)", go("pcron")),
        card("track_changes", "Metas", "O que cada tarefa faz por semana (P3)", go("metas")),
        card("engineering", "Recursos humanos", "Pessoal por função e por semana (P5)", go("prh")),
        card("agriculture", "Equipamentos e máquinas", "Meios por semana (P4)", go("pmaq")),
        card("account_tree", "Organograma da obra", "Funções e nomes (P6)", go("org")),
        card("health_and_safety", "EPI", "Lista por função (P7)", go("epi")),
        card("payments", "Cronograma financeiro", "Do cliente (T1) e interno (T2)", go("pfinc")),
      ],
    ],
    ["Compras", [card("shopping_cart", "Necessidades e pedido de cotação", "Artigos a comprar e o pedido em Excel (C0)", href(`/comercial/necessidades?orc=${id}`))]],
  ];
  return `<div class="cm-head" style="margin-bottom:.5rem"><div><div class="cm-head-num">R1</div><h2 class="cm-panel-title" style="font-size:1.0625rem">Relatórios e documentos</h2>
    <p class="cm-lead" style="margin-top:.25rem">Todos os documentos que o programa produz sobre este orçamento, num só sítio. Cada um abre a página onde se gera.</p></div><div class="cm-head-actions"></div></div>
    ${G.map(([g, it]) => `<h3 class="cm-panel-title rel-g">${esc(g)}</h3><div class="rel-cards">${it.join("")}</div>`).join("")}
    ${S.relVer ? relatorio() : ""}`;
}

async function exportarTudo() {
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = SHEETJS;
      s.onload = res;
      s.onerror = () => rej(new Error("não foi possível carregar o Excel"));
      document.head.appendChild(s);
    });
  }
  const S = C.S;
  const R = S.R;
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const resumo = [
    [`Orçamento ${S.head.number} · ${S.head.revision}`],
    [S.doc.params.obra || S.head.projectName || ""],
    [],
    ["Categoria", "Tipo", "Custo", "Preço de venda"],
    ...CATS.map(([k, l, t]) => [l, t, Number(R.C?.[k]) || 0, Number(R.PVbyCat?.[k]) || 0]),
    [],
    ["Custo total", "", R.CT],
    ["Preço s/ IVA", "", R.PVsi],
    ["Margem bruta", "", R.MBpct],
  ];
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(resumo), "Resumo");
  const usados = new Set();
  for (const [sheet, def] of Object.entries(S.meta.sheets || {})) {
    const rows = S.doc.sheets[sheet] || [];
    if (!rows.length) continue;
    const cols = colunas(def);
    const temCusto = Array.isArray(R[sheet]);
    const aoa = [[...cols.map((c) => c.l), ...(temCusto ? ["Custo"] : [])], ...rows.map((r, i) => [...cols.map((c) => r[c.k] ?? ""), ...(temCusto ? [Number(R[sheet][i]?.ct) || 0] : [])])];
    let nome = `${def.tag || ""} ${def.title || sheet}`.trim().replace(/[\\/?*[\]:]/g, "").slice(0, 31);
    while (usados.has(nome)) nome = `${nome.slice(0, 28)}_${usados.size}`;
    usados.add(nome);
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), nome);
  }
  X.writeFile(wb, `Orçamento ${S.head.number} ${S.head.revision}.xlsx`);
}

export function wireRelatorios(getCtx) {
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rel], [data-relhref]");
    if (!b || !document.getElementById("cmContent")?.contains(b)) return;
    C = getCtx();
    if (b.dataset.relhref) {
      if (C.S.dirty && !confirm("Há alterações por gravar no orçamento. Sair na mesma?")) return;
      location.href = b.dataset.relhref;
      return;
    }
    if (b.dataset.rel === "rep") {
      C.S.relVer = !C.S.relVer;
      C.render();
      if (C.S.relVer) setTimeout(() => document.querySelector(".rel-rep")?.scrollIntoView({ behavior: "smooth" }), 50);
      return;
    }
    if (b.dataset.rel === "xlsx") exportarTudo().catch((err) => toast(err.message || "Falha ao exportar.", { type: "error" }));
  });
}
