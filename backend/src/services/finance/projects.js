/**
 * Controlo de Obras — O1 a O5 do protótipo — e R3 Autos de Medição.
 *
 * A ficha financeira de cada obra já existe (`buildProjectFinancials`: venda
 * prevista, custo orçado, custos realizados e comprometidos, avanço, faturado,
 * recebido, margem). Aqui só se junta o que o protótipo mostra a mais e que a
 * ficha não tinha:
 *
 *  - o **medido** — o valor dos autos aprovados —, para se ver produção por
 *    medir e medição por faturar;
 *  - a **tesouraria da obra** (O3): o que entrou do cliente e o que saiu da
 *    conta principal ou foi transferido para os cartões de fundo de maneio. O
 *    saldo diz se a obra anda a crédito ou se a empresa a está a financiar. Os
 *    gastos feitos com os cartões ficam à parte: o dinheiro já tinha saído da
 *    conta principal quando foi transferido para o cartão, contá-lo outra vez
 *    seria contá-lo duas vezes.
 *
 * Tudo por obra e na moeda da obra. Os totais de várias obras só somam obras
 * da mesma moeda.
 */

const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);

function dayKey(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** «DESPESAS_OPERACIONAIS» → «Despesas operacionais». */
function rotulo(codigo) {
  const s = String(codigo || "").replace(/_/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

// ─── O3 Tesouraria da obra ─────────────────────────────────────────────────

/**
 * Entradas e saídas de dinheiro de uma obra, por mês.
 *
 * @param {object} o
 * @param {Array} o.faturas `{ docDate, net }`
 * @param {Array} o.recebimentos `{ receivedDate, amount }`
 * @param {Array} o.saidas saídas do razão da obra (`flows.paidOutflows`):
 *   `{ valor, data, item: { source, sourceId, category, sourceLabel } }`
 * @param {Array} o.movimentosFundo movimentos dos fundos de maneio da obra:
 *   `{ type: CREDITO|DEBITO|AJUSTE, amount, createdAt, extraRequestId }`
 * @param {string} [o.de] AAAA-MM-DD
 * @param {string} [o.ate] AAAA-MM-DD
 * @param {string} [o.moeda] a moeda da obra — as saídas noutra moeda ficam
 *   fora dos totais e contam-se em `outraMoeda`
 */
function tesourariaObra({ faturas, recebimentos, saidas, movimentosFundo, de, ate, moeda = null }) {
  const dentro = (d) => d && (!de || d >= de) && (!ate || d <= ate);
  const M = new Map();
  const T = { fat: 0, rec: 0, dir: 0, trf: 0, car: 0 };
  const cat = new Map();
  const add = (data, campo, v) => {
    const d = dayKey(data);
    if (!v || !dentro(d)) return;
    const k = d.slice(0, 7);
    if (!M.has(k)) M.set(k, { k, fat: 0, rec: 0, dir: 0, trf: 0, car: 0 });
    M.get(k)[campo] += v;
    T[campo] += v;
  };

  for (const f of faturas || []) add(f.docDate, "fat", N(f.net));
  for (const r of recebimentos || []) add(r.receivedDate, "rec", N(r.amount));

  // O que foi pago com o cartão já saiu da conta principal na transferência:
  // os levantamentos ATM e os pedidos extra pagos pelo fundo contam como gasto
  // com cartões, não como pagamento da conta principal.
  const pagosPeloFundo = new Set(
    (movimentosFundo || []).filter((m) => m.type === "DEBITO" && m.extraRequestId).map((m) => m.extraRequestId)
  );
  const outraMoeda = {};
  for (const s of saidas || []) {
    const e = s.item || {};
    const m = String(e.currency || "").toUpperCase();
    if (moeda && m && m !== String(moeda).toUpperCase()) {
      if (dentro(dayKey(s.data))) outraMoeda[m] = round2((outraMoeda[m] || 0) + N(s.valor));
      continue;
    }
    const peloCartao = e.source === "ATM" || (e.source === "PEDIDO_EXTRA" && pagosPeloFundo.has(e.sourceId));
    const campo = peloCartao ? "car" : "dir";
    add(s.data, campo, N(s.valor));
    if (dentro(dayKey(s.data))) {
      const k = rotulo(e.category) || e.sourceLabel || "Outros";
      const c = cat.get(k) || { k, dir: 0, car: 0 };
      c[campo] += N(s.valor);
      cat.set(k, c);
    }
  }
  for (const m of movimentosFundo || []) {
    if (m.type === "CREDITO") add(m.createdAt, "trf", N(m.amount));
    // Os débitos que não vieram de um pedido extra já pago (e por isso já no
    // razão) são gastos com o cartão registados só no fundo.
    else if (m.type === "DEBITO" && !m.extraRequestId) add(m.createdAt, "car", N(m.amount));
  }

  const meses = [...M.values()].sort((a, b) => a.k.localeCompare(b.k));
  let ac = 0;
  for (const m of meses) {
    m.sai = m.dir + m.trf;
    m.sal = m.rec - m.sai;
    ac += m.sal;
    m.ac = ac;
    for (const k of ["fat", "rec", "dir", "trf", "car", "sai", "sal", "ac"]) m[k] = round2(m[k]);
  }
  const sai = T.dir + T.trf;
  return {
    meses,
    totais: {
      fat: round2(T.fat),
      rec: round2(T.rec),
      dir: round2(T.dir),
      trf: round2(T.trf),
      car: round2(T.car),
      sai: round2(sai),
      saldo: round2(T.rec - sai),
      porJustificar: round2(Math.max(0, T.trf - T.car)),
    },
    outraMoeda,
    categorias: [...cat.values()]
      .map((c) => ({ k: c.k, dir: round2(c.dir), car: round2(c.car), total: round2(c.dir + c.car) }))
      .sort((a, b) => b.total - a.total),
  };
}

// ─── O1 Resumo das obras · O2 Custos por obra ──────────────────────────────

/**
 * Uma linha do resumo: a ficha financeira da obra mais o medido e o dinheiro.
 *
 * @param {object} fin item de `buildProjectFinancials`
 * @param {object} x `{ medido, saldoCaixa }`
 */
function resumoObra(fin, { medido = 0, saldoCaixa = 0 } = {}) {
  const contr = N(fin.budget?.sale);
  const orc = N(fin.budget?.cost);
  const real = N(fin.costs?.realized);
  const comp = N(fin.costs?.committed);
  const eac = N(fin.control?.eac) || Math.max(orc, real + comp);
  const fat = N(fin.revenue?.invoiced);
  const rec = N(fin.revenue?.received);
  return {
    id: fin.project?.id,
    codigo: fin.project?.code,
    nome: fin.project?.name,
    cliente: fin.project?.client?.name || "",
    ativa: fin.project?.active !== false,
    moeda: fin.currency || fin.project?.currency || "AOA",
    contr: round2(contr),
    fonteContrato: fin.budget?.saleSource || null,
    av: fin.progress?.pct === null || fin.progress?.pct === undefined ? null : N(fin.progress.pct),
    medido: round2(medido),
    pMed: pct(N(medido), contr),
    fat: round2(fat),
    pFat: pct(fat, contr),
    rec: round2(rec),
    pRec: pct(rec, contr),
    orc: round2(orc),
    real: round2(real),
    comp: round2(comp),
    eac: round2(eac),
    desv: orc > 0 ? round2(eac - orc) : null,
    consumido: orc > 0 ? pct(real + comp, orc) : null,
    mPrev: contr > 0 ? round2(contr - eac) : null,
    mPrevPct: contr > 0 ? pct(contr - eac, contr) : null,
    cash: round2(saldoCaixa),
    // Custos registados noutra moeda: não entram em nenhum total desta obra.
    outraMoeda: Object.entries(fin.costs?.otherCurrency || {}).map(([moeda, x]) => ({
      moeda,
      realizado: round2(x.realized),
      comprometido: round2(x.committed),
      lancamentos: x.count,
    })),
  };
}

/** Os alertas da ficha, como no `sobraPop` do protótipo. */
function alertasObra(r) {
  const A = [];
  if (r.av !== null && r.av - r.pMed > 5) A.push(`Produção por medir: avanço ${r.av.toFixed(0)}% e medido só ${r.pMed.toFixed(0)}%.`);
  if (r.pMed - r.pFat > 5) A.push(`Medido por faturar: ${round2(r.medido - r.fat).toLocaleString("pt-PT")} (${(r.pMed - r.pFat).toFixed(0)}%).`);
  if (r.desv !== null && r.desv > 0.5) A.push(`Custo previsto final acima do orçado em ${r.desv.toLocaleString("pt-PT")}.`);
  if (r.cash < -0.5) A.push(`A obra consumiu mais dinheiro do que recebeu: ${(-r.cash).toLocaleString("pt-PT")}.`);
  for (const x of r.outraMoeda || []) {
    A.push(
      `${x.lancamentos} custo(s) em ${x.moeda} (${(x.realizado + x.comprometido).toLocaleString("pt-PT")} ${x.moeda}) numa obra em ${r.moeda}: ficam fora do custo da obra — sem câmbio não se somam.`
    );
  }
  return A;
}

/**
 * O2 — os custos de uma obra por categoria ou por fornecedor.
 *
 * Pago é o dinheiro que saiu (o consumo de stock não é pagamento, mas é custo:
 * entra pelo valor consumido); por pagar é o comprometido em aberto.
 *
 * @param {Array} itens linhas do razão desta obra
 * @param {"cat"|"forn"} por
 */
function custosDaObra(itens, por = "cat") {
  const G = new Map();
  for (const e of itens || []) {
    const pago = e.source === "CONSUMO_STOCK" ? N(e.paidBase ?? e.paidAmount) : e.kind === "STOCK" ? 0 : N(e.paidAmount);
    const pp = N(e.remaining);
    if (!(pago > 0.005) && !(pp > 0.005)) continue;
    const g =
      por === "forn"
        ? e.supplierRef?.name || e.supplier || (e.source === "CONSUMO_STOCK" ? "Stock (consumo)" : "Sem fornecedor")
        : rotulo(e.category) || e.sourceLabel || "Sem categoria";
    const s = por === "forn" ? "" : e.sourceLabel || "—";
    if (!G.has(g)) G.set(g, { k: g, pago: 0, pp: 0, S: new Map() });
    const x = G.get(g);
    x.pago += pago;
    x.pp += pp;
    if (s) {
      const y = x.S.get(s) || { k: s, pago: 0, pp: 0 };
      y.pago += pago;
      y.pp += pp;
      x.S.set(s, y);
    }
  }
  const grupos = [...G.values()]
    .map((g) => ({
      k: g.k,
      pago: round2(g.pago),
      pp: round2(g.pp),
      sub: [...g.S.values()]
        .map((s) => ({ k: s.k, pago: round2(s.pago), pp: round2(s.pp) }))
        .sort((a, b) => b.pago + b.pp - (a.pago + a.pp)),
    }))
    .sort((a, b) => b.pago + b.pp - (a.pago + a.pp));
  return {
    grupos,
    pago: round2(grupos.reduce((s, g) => s + g.pago, 0)),
    porPagar: round2(grupos.reduce((s, g) => s + g.pp, 0)),
  };
}

// ─── O4 Previsões por obra ─────────────────────────────────────────────────

/**
 * O previsto da obra contra o que já entrou e saiu, mês a mês.
 *
 * No protótipo as previsões são validadas pela equipa de obra («Arranque e
 * negociação»). Essa figura não existe na app: o previsto aqui é o que a obra
 * já tem — a venda prevista (tabela de quantidades ou contrato), o custo
 * orçado, o prazo da obra — e, mês a mês, o que se espera receber (faturas por
 * receber e autos aprovados por faturar) e pagar (contas a pagar).
 *
 * @param {object} o
 * @param {object} o.resumo linha de `resumoObra`
 * @param {object} o.projeto `{ startDate, dueDate }`
 * @param {Array} o.reais `{ data, lado: R|P, valor }` — recebido e pago
 * @param {Array} o.previstos `{ data, lado: R|P, valor }` — por receber / pagar
 */
function previsoesObra({ resumo, projeto, reais, previstos }) {
  const ini = dayKey(projeto?.startDate);
  const fim = dayKey(projeto?.dueDate);
  const dias = ini && fim ? Math.round((new Date(fim) - new Date(ini)) / 86400000) : null;
  const M = new Map();
  const put = (d, campo, v) => {
    const k = (dayKey(d) || "").slice(0, 7);
    if (!k) return;
    if (!M.has(k)) M.set(k, { k, entPrev: 0, saiPrev: 0, ent: 0, sai: 0 });
    M.get(k)[campo] += N(v);
  };
  for (const x of previstos || []) put(x.data, x.lado === "R" ? "entPrev" : "saiPrev", x.valor);
  for (const x of reais || []) put(x.data, x.lado === "R" ? "ent" : "sai", x.valor);
  const meses = [...M.values()].sort((a, b) => a.k.localeCompare(b.k));
  let acPrev = 0;
  let acReal = 0;
  for (const m of meses) {
    acPrev += m.entPrev - m.saiPrev;
    acReal += m.ent - m.sai;
    m.acPrev = round2(acPrev);
    m.acReal = round2(acReal);
    for (const k of ["entPrev", "saiPrev", "ent", "sai"]) m[k] = round2(m[k]);
  }
  return {
    valor: resumo.contr,
    fonteValor: resumo.fonteContrato,
    custoPrevisto: resumo.orc || null,
    custoReal: resumo.real,
    margem: resumo.mPrev,
    margemPct: resumo.mPrevPct,
    inicio: ini,
    fim,
    dias,
    meses,
  };
}

// ─── O5 Áreas de negócio ───────────────────────────────────────────────────

/**
 * Faturação por área de negócio, com o custo pago das obras dessa área.
 *
 * O protótipo tem três áreas de negócio (fornecimento e montagem, manutenção,
 * venda de produtos), guardadas na fatura ou na obra. A app não tem esse campo:
 * a área aqui é o **tipo de obra** (`projectType`) — Média Tensão, Obra
 * Complexa, Eletrificação Rural… —, e as obras sem tipo ficam juntas.
 *
 * Valores sem IVA. Uma moeda de cada vez.
 *
 * @param {object} o
 * @param {Array} o.faturas `{ docDate, gross, vat, received, moeda, tipo }`
 * @param {Array} o.obras `{ tipo, moeda, custoPago }`
 * @param {string} [o.ano] AAAA
 * @param {string} [o.moeda]
 */
function areasDeNegocio({ faturas, obras, ano, moeda = "AOA" }) {
  const M0 = String(moeda || "AOA").toUpperCase();
  const tipo = (t) => (t && String(t).trim()) || "Sem tipo de obra";
  const G = new Map();
  const g = (k) => {
    if (!G.has(k)) G.set(k, { k, n: 0, fat: 0, rec: 0, custo: 0, obras: 0 });
    return G.get(k);
  };
  for (const f of faturas || []) {
    if (String(f.moeda || "AOA").toUpperCase() !== M0) continue;
    if (ano && !(dayKey(f.docDate) || "").startsWith(ano)) continue;
    const x = g(tipo(f.tipo));
    x.n += 1;
    x.fat += N(f.gross) - N(f.vat);
    x.rec += N(f.received);
  }
  for (const o of obras || []) {
    if (String(o.moeda || "AOA").toUpperCase() !== M0) continue;
    const x = g(tipo(o.tipo));
    x.custo += N(o.custoPago);
    x.obras += 1;
  }
  const areas = [...G.values()]
    .map((x) => ({
      area: x.k,
      faturas: x.n,
      obras: x.obras,
      fat: round2(x.fat),
      rec: round2(x.rec),
      custo: round2(x.custo),
      margem: round2(x.fat - x.custo),
      margemPct: x.fat > 0 ? ((x.fat - x.custo) / x.fat) * 100 : null,
    }))
    .sort((a, b) => b.fat - a.fat || b.custo - a.custo);
  const soma = (k) => round2(areas.reduce((s, a) => s + a[k], 0));
  return { moeda: M0, areas, totais: { fat: soma("fat"), rec: soma("rec"), custo: soma("custo"), margem: soma("margem") } };
}

// ─── R3 Autos de medição ───────────────────────────────────────────────────

const ESTADO_AUTO = { DRAFT: "Rascunho", SUBMITTED: "Submetido", APPROVED: "Aprovado", REJECTED: "Rejeitado" };

/**
 * Os autos de medição de todas as obras, com a percentagem do contrato que
 * cada um mede e a acumulada, e as faturas que o faturaram.
 *
 * @param {Array} autos `{ id, reportNumber, reportDate, status, periodValTotal,
 *   project: { id, code, name, currency }, invoices: [{ docNumber }] }`
 * @param {Map<string, number>} contratos id da obra → valor de venda
 */
function autosDeMedicao(autos, contratos) {
  const porObra = new Map();
  for (const a of autos || []) {
    const k = a.project?.id;
    if (!porObra.has(k)) porObra.set(k, []);
    porObra.get(k).push(a);
  }
  const linhas = [];
  for (const [obraId, L] of porObra) {
    const c = N(contratos?.get(obraId));
    const ord = [...L].sort(
      (x, y) => (parseInt(x.reportNumber, 10) || 0) - (parseInt(y.reportNumber, 10) || 0) || (dayKey(x.reportDate) || "").localeCompare(dayKey(y.reportDate) || "")
    );
    let acum = 0;
    for (const a of ord) {
      const v = N(a.periodValTotal);
      if (a.status !== "REJECTED") acum += v;
      const faturas = (a.invoices || []).map((f) => f.docNumber || "fatura").filter(Boolean);
      linhas.push({
        id: a.id,
        obraId,
        obra: [a.project?.code, a.project?.name].filter(Boolean).join(" · "),
        moeda: a.project?.currency || "AOA",
        numero: a.reportNumber,
        data: dayKey(a.reportDate),
        estado: a.status,
        estadoLabel: ESTADO_AUTO[a.status] || a.status,
        valor: round2(v),
        pctAuto: c > 0 ? (v / c) * 100 : null,
        pctAcum: c > 0 ? (acum / c) * 100 : null,
        faturas,
        faturado: faturas.length > 0,
      });
    }
  }
  linhas.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const aprov = linhas.filter((l) => l.estado === "APPROVED");
  const resumo = (L) => ({ valor: round2(L.reduce((s, l) => s + l.valor, 0)), n: L.length });
  return {
    linhas,
    totais: {
      aprovado: resumo(aprov),
      faturado: resumo(aprov.filter((l) => l.faturado)),
      porFaturar: resumo(aprov.filter((l) => !l.faturado)),
      submetido: resumo(linhas.filter((l) => l.estado === "SUBMITTED")),
    },
  };
}

module.exports = {
  tesourariaObra,
  resumoObra,
  alertasObra,
  custosDaObra,
  previsoesObra,
  areasDeNegocio,
  autosDeMedicao,
  rotulo,
  ESTADO_AUTO,
};
