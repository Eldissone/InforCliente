const test = require("node:test");
const assert = require("node:assert/strict");

const T = require("../src/services/budget/paymentTerms");
const { buildBudgetLines, checkCanAward } = require("../src/services/budget/award");
const { calcBudget } = require("../src/services/budget/calc");

const PV = 1000000;
const START = "2026-01-01";
const END = "2026-06-30"; // 181 dias

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const close = (actual, expected, label, tol = 1) =>
  assert.ok(near(actual, expected, tol), `${label}: esperado ${expected}, obtido ${actual}`);

const sched = (terms, over = {}) =>
  T.buildClientSchedule({ terms, salePriceExVat: PV, startDate: START, endDate: END, ...over });

// ───────────────────────── marcos ─────────────────────────

test("marcos: os três marcos somam o preço de venda", () => {
  const s = sched({ modo: "marcos" });
  assert.equal(s.mode, "marcos");
  assert.equal(s.rows.length, 3);
  close(s.rows[0].gross, 600000, "adiantamento 60%");
  close(s.rows[1].gross, 300000, "material 30%");
  close(s.rows[2].gross, 100000, "conclusão 10%");
  close(s.totals.gross, PV, "soma dos marcos");
});

test("marcos: o adiantamento na adjudicação não leva retenção nem prazo de aprovação", () => {
  const s = sched({ modo: "marcos", ret: 0.05, aprov: 15, pag: 30 });
  const adj = s.rows.find((r) => r.event === "adj");
  close(adj.retained, 0, "retenção do adiantamento");
  assert.equal(adj.receiptDate, adj.date, "recebe-se na própria data");

  const fim = s.rows.find((r) => r.event === "fim");
  close(fim.retained, 100000 * 0.05, "retenção na conclusão");
  assert.equal(fim.approvalDate, "2026-07-15", "30 de junho + 15 dias de aprovação");
  assert.equal(fim.receiptDate, "2026-08-14", "aprovação + 30 dias de pagamento");
});

test("marcos: o marco por % de execução cai na data do progresso linear", () => {
  const s = sched({
    modo: "marcos",
    marcos: [
      { desc: "Metade", pct: 0.5, ev: "pct", exec: 0.5 },
      { desc: "Fim", pct: 0.5, ev: "fim" },
    ],
  });
  const meio = s.rows.find((r) => r.desc === "Metade");
  // 181 dias × 50% = 90,5 → arredonda a 91 → 1 de janeiro + 90 dias
  assert.equal(meio.date, "2026-04-01");
  assert.equal(s.basis, "linear", "diz que é estimativa linear");
});

test("marcos: o marco do material usa a data de entrega quando a há", () => {
  const s = sched({ modo: "marcos" }, { materialDate: "2026-03-20" });
  assert.equal(s.rows.find((r) => r.event === "mat").date, "2026-03-20");
});

test("marcos: numa data fixa", () => {
  const s = sched({
    modo: "marcos",
    marcos: [
      { desc: "A", pct: 0.5, ev: "data", data: "2026-02-10" },
      { desc: "B", pct: 0.5, ev: "fim" },
    ],
  });
  assert.equal(s.rows[0].date, "2026-02-10");
});

test("marcos: as linhas saem por ordem de data", () => {
  const s = sched({
    modo: "marcos",
    marcos: [
      { desc: "Fim", pct: 0.4, ev: "fim" },
      { desc: "Arranque", pct: 0.6, ev: "adj" },
    ],
  });
  assert.deepEqual(s.rows.map((r) => r.desc), ["Arranque", "Fim"]);
  assert.deepEqual(s.rows.map((r) => r.n), [1, 2]);
});

// ───────────────────────── autos ─────────────────────────

test("autos mensais: um auto por mês, somando o preço de venda", () => {
  const s = sched({ modo: "autos", per: "Mensal", ret: 0 });
  assert.equal(s.advance, 0, "sem adiantamento");
  assert.equal(s.rows.length, 6, "janeiro a junho");
  assert.deepEqual(
    s.rows.map((r) => r.date),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]
  );
  close(s.totals.gross, PV, "soma dos autos");
  close(s.totals.net, PV, "líquido sem retenção");
});

test("autos: a retenção sai de cada auto", () => {
  const s = sched({ modo: "autos", ret: 0.05 });
  close(s.totals.retained, PV * 0.05, "retido no total");
  close(s.totals.net, PV * 0.95, "líquido");
  close(s.retention.value, PV * 0.05, "retenção acumulada");
});

test("autos: prazos de aprovação e pagamento somam-se à data do auto", () => {
  const s = sched({ modo: "autos", aprov: 10, pag: 45 });
  assert.equal(s.rows[0].date, "2026-01-31");
  assert.equal(s.rows[0].approvalDate, "2026-02-10");
  assert.equal(s.rows[0].receiptDate, "2026-03-27");
});

test("autos semanais e quinzenais mudam a periodicidade", () => {
  const sem = sched({ modo: "autos", per: "Semanal" });
  const qui = sched({ modo: "autos", per: "Quinzenal" });
  assert.equal(sem.rows[0].date, "2026-01-07", "primeiro auto 7 dias depois");
  assert.equal(qui.rows[0].date, "2026-01-14");
  assert.ok(sem.rows.length > qui.rows.length, "semanal dá mais autos");
  close(sem.totals.gross, PV, "semanal soma o preço");
  close(qui.totals.gross, PV, "quinzenal soma o preço");
});

test("autos: mais de 60 autos dá aviso", () => {
  const s = T.buildClientSchedule({
    terms: { modo: "autos", per: "Semanal" },
    salePriceExVat: PV,
    startDate: "2026-01-01",
    endDate: "2028-12-31",
  });
  assert.ok(s.rows.length > 60);
  assert.ok(s.warnings.some((w) => /periodicidade/i.test(w)));
});

// ───────────────────────── adiantamentos ─────────────────────────

test("adiantamento diluído: entra como linha e é amortizado nos autos", () => {
  const s = sched({ modo: "amort", adPct: 0.3, ret: 0 });
  close(s.advance, 300000, "adiantamento");
  const adv = s.rows[0];
  assert.equal(adv.event, "adj");
  close(adv.gross, 300000, "linha do adiantamento");
  close(s.totals.amortised, 300000, "amortizado na totalidade");
  // bruto = adiantamento + preço; líquido = preço (o adiantamento abate-se)
  close(s.totals.gross, PV + 300000, "bruto inclui o adiantamento");
  close(s.totals.net, PV, "líquido fecha no preço de venda");
});

test("adiantamento diluído: a taxa de amortização pode ser escrita à mão", () => {
  const s = sched({ modo: "amort", adPct: 0.3, amort: 0.5, ret: 0 });
  // Com 50% por auto, amortiza mais depressa, mas nunca mais do que o adiantamento
  close(s.totals.amortised, 300000, "amortizado na totalidade");
  assert.ok(s.rows[1].amortised > s.rows[1].gross * 0.3, "primeiro auto amortiza mais");
});

test("adiantamento inicial: não é amortizado e os autos medem só o restante", () => {
  const s = sched({ modo: "inicial", adPct: 0.4, ret: 0 });
  close(s.advance, 400000, "adiantamento");
  close(s.totals.amortised, 0, "não se amortiza");
  close(s.totals.gross, PV, "adiantamento + autos = preço");
  const autos = s.rows.filter((r) => r.event === "auto");
  close(autos.reduce((a, r) => a + r.gross, 0), 600000, "autos medem o restante");
});

test("adiantamento em valor absoluto quando não há percentagem", () => {
  const s = sched({ modo: "inicial", adPct: null, adiant: 250000 });
  close(s.advance, 250000, "adiantamento");
});

test("só autos e marcos não têm adiantamento à parte", () => {
  close(T.advanceOf({ modo: "autos", adPct: 0.3 }, PV), 0, "só autos");
  close(T.advanceOf({ modo: "marcos", adPct: 0.3 }, PV), 0, "marcos");
});

// ───────────────────────── retenção ─────────────────────────

test("retenção: libertação é no fim da obra mais os anos indicados", () => {
  const s = sched({ modo: "autos", ret: 0.05, retAnos: 2 });
  assert.equal(s.retention.releaseDate, "2028-06-30");
  assert.equal(s.retention.years, 2);
});

// ───────────────────────── validação ─────────────────────────

test("validação: os marcos têm de somar 100%", () => {
  assert.deepEqual(T.validateTerms({ modo: "marcos" }), [], "os marcos por omissão somam 100%");
  const errs = T.validateTerms({ modo: "marcos", marcos: [{ desc: "A", pct: 0.7, ev: "adj" }] });
  assert.ok(errs.some((e) => /somam 70.0%/.test(e)), errs.join(" | "));
});

test("validação: marco por data sem data e por % sem %", () => {
  const errs = T.validateTerms({
    modo: "marcos",
    marcos: [
      { desc: "Sem data", pct: 0.5, ev: "data" },
      { desc: "Sem pct", pct: 0.5, ev: "pct" },
    ],
  });
  assert.ok(errs.some((e) => /Sem data.*data está vazia/.test(e)), errs.join(" | "));
  assert.ok(errs.some((e) => /Sem pct.*% está vazia/.test(e)), errs.join(" | "));
});

test("validação: prazos negativos, retenção fora do intervalo, adiantamento acima de 100%", () => {
  assert.ok(T.validateTerms({ aprov: -1 }).some((e) => /negativos/.test(e)));
  assert.ok(T.validateTerms({ ret: 0.8 }).some((e) => /entre 0% e 50%/.test(e)));
  assert.ok(T.validateTerms({ modo: "amort", adPct: 1.5 }).some((e) => /entre 0% e 100%/.test(e)));
  assert.deepEqual(T.validateTerms({ modo: "amort", adPct: 0.3, ret: 0.05, aprov: 15, pag: 30 }), []);
});

// ───────────────────────── robustez ─────────────────────────

test("sem datas não há calendário, e diz porquê", () => {
  const s = T.buildClientSchedule({ terms: { modo: "autos" }, salePriceExVat: PV });
  assert.equal(s.rows.length, 0);
  assert.ok(s.warnings.some((w) => /Sem datas/.test(w)));
});

test("conclusão antes do início não rebenta", () => {
  const s = T.buildClientSchedule({ terms: { modo: "autos" }, salePriceExVat: PV, startDate: "2026-06-30", endDate: "2026-01-01" });
  assert.ok(s.rows.length >= 1);
  close(s.totals.gross, PV, "soma o preço");
});

test("normalizeTerms preenche o que falta e corrige modos inválidos", () => {
  const t = T.normalizeTerms({ modo: "xpto", per: "Anual" });
  assert.equal(t.modo, "amort");
  assert.equal(t.per, "Mensal");
  assert.equal(t.aprov, 15);
  assert.equal(t.marcos.length, 3);
});

test("describeTerms escreve as condições por palavras", () => {
  assert.match(T.describeTerms({ modo: "marcos" }, PV), /pagamentos por marcos: 60%/);
  assert.match(T.describeTerms({ modo: "autos", per: "Mensal" }, PV), /só autos de medição mensais, sem adiantamento/);
  assert.match(T.describeTerms({ modo: "inicial", adPct: 0.4 }, PV), /adiantamento inicial de 40%/);
  assert.match(T.describeTerms({ modo: "amort", adPct: 0.3 }, PV), /diluído nos autos/);
  assert.match(T.describeTerms({ ret: 0 }, PV), /sem retenção de garantia/);
  assert.match(T.describeTerms({ ret: 0.05, retAnos: 1 }, PV), /retenção de garantia de 5.0% durante 1 ano/);
  assert.match(T.describeTerms({ ret: 0.05, retAnos: 2 }, PV), /durante 2 anos/);
});

// ───────────────────────── adjudicação ─────────────────────────

function budgetDoc() {
  return {
    params: {
      inicio: "2026-01-01",
      fim: "2026-06-30",
      diasMes: 22,
      horasDia: 8,
      horasAnoEquip: 1800,
      iva: 0.14,
      margemMin: 0.15,
      margemObj: 0.25,
      metodo: "MARGEM_SOBRE_VENDA",
      moedaBase: "AOA",
      currencies: [{ moeda: "AOA", cambio: 1 }],
      contMin: 0.03,
      abcA: 0.8,
      abcB: 0.95,
    },
    baremSnapshot: {
      items: [
        { kind: "RH", code: "RH-01", name: "Eletricista", fields: { mensal: 440000, enc: 0 } },
        { kind: "EQUIPAMENTO", code: "EQ-01", name: "Escavadora", ownership: "Próprio", fields: { aq: 1800000, vida: 1000, man: 200 } },
      ],
    },
    dispatch: { margens: { MAT: 0.2, RH: 0.4, EQ: 0.35, VI: 0, FE: 0, SUB: 0, LOG: 0, ENG: 0, FIN: 0, IND: 0, RIS: 0 } },
    lists: {},
    sheets: {
      mat: [{ desc: "Cabo", un: "m", q: 100, preco: 500 }],
      rh: [{ funcao: "Eletricista", n: 2, h: 8, d: 10 }],
      eq: [{ equip: "Escavadora", q: 1, h: 8, d: 5 }],
      vi: [],
      fe: [],
      sub: [],
      log: [],
      eng: [],
      ind: [{ rub: "Administração", tipo: "Percentagem", pct: 0.02, base: "Custo direto" }],
      fin: [{ item: "Banco", tipo: "Valor fixo", fixo: 10000 }],
      ris: [{ desc: "Clima", prob: 0.5, imp: "Médio", vbase: "Custo direto", fator: 0.02 }],
    },
  };
}

test("adjudicação: as linhas de previsto somam o custo total do orçamento", () => {
  const doc = budgetDoc();
  const R = calcBudget(doc);
  const lines = buildBudgetLines(doc, R);
  const soma = lines.reduce((s, l) => s + l.total, 0);
  close(soma, Math.round(R.CT * 100) / 100, "soma das linhas = custo total", 0.5);
  assert.ok(lines.length >= 6, "uma linha por linha de folha com custo");
});

test("adjudicação: cada linha leva categoria, unidade, quantidade e preço unitário", () => {
  const doc = budgetDoc();
  const lines = buildBudgetLines(doc, calcBudget(doc));
  const cabo = lines.find((l) => l.description === "Cabo");
  assert.equal(cabo.category, "Materiais");
  assert.equal(cabo.unit, "m");
  close(cabo.quantity, 100, "quantidade");
  close(cabo.unitPrice, 500, "preço unitário");
  close(cabo.total, 50000, "total");

  const rh = lines.find((l) => l.description === "Eletricista");
  assert.equal(rh.category, "Recursos humanos");
  assert.equal(rh.unit, "dia");
  close(rh.quantity, 20, "2 pessoas × 10 dias");
});

test("adjudicação: linhas sem custo não entram", () => {
  const doc = budgetDoc();
  doc.sheets.mat.push({ desc: "Nada", q: 0, preco: 0 });
  doc.sheets.mat.push({ desc: "Do cliente", q: 10, preco: 100, cli: "Sim" });
  const lines = buildBudgetLines(doc, calcBudget(doc));
  assert.ok(!lines.some((l) => l.description === "Nada"), "linha a zero fora");
  assert.ok(!lines.some((l) => l.description === "Do cliente"), "material do cliente tem custo zero, fica fora");
});

test("adjudicação: as linhas de indiretos, financeiros e riscos também entram", () => {
  const doc = budgetDoc();
  const lines = buildBudgetLines(doc, calcBudget(doc));
  const cats = new Set(lines.map((l) => l.category));
  assert.ok(cats.has("Estrutura e sede"), "indiretos");
  assert.ok(cats.has("Garantias, seguros e financiamento"), "financeiros");
  assert.ok(cats.has("Riscos e contingências"), "contingência");
});

test("checkCanAward: exige despacho aprovado, cliente, e recusa repetir", () => {
  const base = { id: "b", status: "APROVADO", clientId: "c", dispatch: { estado: "Aprovado" } };
  assert.deepEqual(checkCanAward(base), []);

  assert.ok(checkCanAward({ ...base, dispatch: { estado: "Em análise" } }).some((e) => /despacho/i.test(e)));
  assert.ok(checkCanAward({ ...base, clientId: null }).some((e) => /cliente/i.test(e)));
  assert.ok(checkCanAward({ ...base, locked: true }).some((e) => /já foi adjudicado/i.test(e)));
  assert.ok(checkCanAward({ ...base, awardedProjectId: "p" }).some((e) => /já foi adjudicado/i.test(e)));
  assert.ok(checkCanAward({ ...base, status: "CANCELADO" }).some((e) => /cancelado/i.test(e)));
  assert.ok(checkCanAward({ ...base, status: "PERDIDO" }).some((e) => /perdido/i.test(e)));
  assert.ok(checkCanAward(null).some((e) => /não encontrado/i.test(e)));
});

test("checkCanAward: «aprovado com alterações» também serve", () => {
  assert.deepEqual(
    checkCanAward({ id: "b", status: "APROVADO", clientId: "c", dispatch: { estado: "Aprovado com alterações" } }),
    []
  );
});
