const test = require("node:test");
const assert = require("node:assert/strict");

const OBR = require("../src/services/finance/projects");

/**
 * Fase F-3 do alinhamento do Financeiro com o protótipo: Controlo de Obras
 * (O1–O5) e R3 Autos de Medição.
 */

// ═══ O3 Tesouraria da obra ══════════════════════════════════════════════════

const saida = (over = {}) => ({
  valor: 100,
  data: "2026-10-05",
  item: { source: "PAGAMENTO", sourceId: "p1", category: "MATERIAIS", sourceLabel: "Pagamento / Cotação" },
  ...over,
});

test("O3 · o saldo da obra é o recebido menos o que saiu da conta principal e para os cartões", () => {
  const T = OBR.tesourariaObra({
    faturas: [{ docDate: "2026-10-01", net: 1000 }],
    recebimentos: [{ receivedDate: "2026-10-20", amount: 600 }],
    saidas: [saida()],
    movimentosFundo: [{ type: "CREDITO", amount: 200, createdAt: "2026-10-10" }],
  });
  assert.equal(T.totais.fat, 1000);
  assert.equal(T.totais.rec, 600);
  assert.equal(T.totais.dir, 100);
  assert.equal(T.totais.trf, 200);
  assert.equal(T.totais.saldo, 300);
});

test("O3 · o que se paga com o cartão não volta a sair: já saiu na transferência", () => {
  const T = OBR.tesourariaObra({
    faturas: [],
    recebimentos: [],
    saidas: [
      saida({ item: { source: "ATM", sourceId: "a1" }, valor: 50 }),
      saida({ item: { source: "PEDIDO_EXTRA", sourceId: "x1" }, valor: 70 }),
      saida({ item: { source: "PEDIDO_EXTRA", sourceId: "x2" }, valor: 30 }),
    ],
    movimentosFundo: [
      { type: "CREDITO", amount: 200, createdAt: "2026-10-01" },
      { type: "DEBITO", amount: 70, createdAt: "2026-10-06", extraRequestId: "x1" },
    ],
  });
  assert.equal(T.totais.car, 120, "ATM + pedido pago pelo fundo");
  assert.equal(T.totais.dir, 30, "o pedido extra pago de outra forma é conta principal");
  assert.equal(T.totais.saldo, -230, "200 transferidos + 30 da conta principal");
  assert.equal(T.totais.porJustificar, 80);
});

test("O3 · débito do fundo sem pedido extra é gasto com o cartão", () => {
  const T = OBR.tesourariaObra({
    faturas: [],
    recebimentos: [],
    saidas: [],
    movimentosFundo: [{ type: "DEBITO", amount: 40, createdAt: "2026-10-06" }],
  });
  assert.equal(T.totais.car, 40);
  assert.equal(T.totais.saldo, 0, "gasto do cartão não mexe no saldo da obra");
});

test("O3 · por mês, com o saldo acumulado", () => {
  const T = OBR.tesourariaObra({
    faturas: [],
    recebimentos: [{ receivedDate: "2026-11-02", amount: 500 }],
    saidas: [saida(), saida({ data: "2026-11-03", valor: 50 })],
    movimentosFundo: [],
  });
  assert.deepEqual(T.meses.map((m) => [m.k, m.sal, m.ac]), [
    ["2026-10", -100, -100],
    ["2026-11", 450, 350],
  ]);
});

test("O3 · o período filtra pela data", () => {
  const T = OBR.tesourariaObra({
    faturas: [],
    recebimentos: [{ receivedDate: "2026-09-02", amount: 500 }],
    saidas: [saida()],
    movimentosFundo: [],
    de: "2026-10-01",
  });
  assert.equal(T.totais.rec, 0);
  assert.equal(T.totais.dir, 100);
});

test("O3 · pagamentos agrupados por categoria", () => {
  const T = OBR.tesourariaObra({
    faturas: [],
    recebimentos: [],
    saidas: [saida(), saida({ item: { source: "LANCAMENTO", category: "GASTOS_PESSOAL" }, valor: 300 })],
    movimentosFundo: [],
  });
  assert.deepEqual(T.categorias.map((c) => [c.k, c.total]), [
    ["Gastos pessoal", 300],
    ["Materiais", 100],
  ]);
});

// ═══ O1 Resumo · O2 Custos ═══════════════════════════════════════════════════

const fin = (over = {}) => ({
  project: { id: "o1", code: "OBR-1", name: "Kwawa", active: true, client: { name: "Omatapalo" } },
  currency: "AOA",
  budget: { sale: 1000, cost: 600, saleSource: "TABELA_QUANTIDADES" },
  costs: { realized: 300, committed: 100 },
  control: { eac: 600 },
  progress: { pct: 50 },
  revenue: { invoiced: 200, received: 100 },
  ...over,
});

test("O1 · percentagens sobre a venda prevista", () => {
  const r = OBR.resumoObra(fin(), { medido: 400, saldoCaixa: -50 });
  assert.equal(r.pMed, 40);
  assert.equal(r.pFat, 20);
  assert.equal(r.pRec, 10);
  assert.equal(r.av, 50);
  assert.equal(r.cash, -50);
});

test("O1 · margem prevista = venda − custo previsto final", () => {
  const r = OBR.resumoObra(fin({ control: { eac: 700 } }));
  assert.equal(r.mPrev, 300);
  assert.equal(r.mPrevPct, 30);
  assert.equal(r.desv, 100);
});

test("O1 · sem custo orçado não há desvio nem consumo", () => {
  const r = OBR.resumoObra(fin({ budget: { sale: 1000, cost: 0 }, control: { eac: 0 } }));
  assert.equal(r.desv, null);
  assert.equal(r.consumido, null);
  assert.equal(r.eac, 400, "sem previsto final calculado, pago + comprometido");
});

test("O1 · sem avanço conhecido fica nulo, não zero", () => {
  assert.equal(OBR.resumoObra(fin({ progress: { pct: null } })).av, null);
});

test("O1 · os alertas da ficha", () => {
  const r = OBR.resumoObra(fin({ control: { eac: 900 } }), { medido: 100, saldoCaixa: -20 });
  const A = OBR.alertasObra(r);
  assert.equal(A.length, 3);
  assert.match(A[0], /Produção por medir/);
  assert.match(A[1], /Custo previsto final acima/);
  assert.match(A[2], /consumiu mais dinheiro/);
});

test("O1 · medido acima do faturado dá alerta", () => {
  const A = OBR.alertasObra(OBR.resumoObra(fin({ progress: { pct: 40 } }), { medido: 400 }));
  assert.ok(A.some((a) => /Medido por faturar/.test(a)));
});

const lanc = (over) => ({ source: "PAGAMENTO", kind: "REALIZADO", category: "MATERIAIS", sourceLabel: "Pagamento / Cotação", paidAmount: 100, remaining: 0, supplier: "NewCom", ...over });

test("O2 · custos por categoria, com a origem por baixo", () => {
  const J = OBR.custosDaObra([lanc(), lanc({ category: "MATERIAIS", sourceLabel: "Pedido de Compra", remaining: 40, paidAmount: 0 }), lanc({ category: "GASTOS_PESSOAL", paidAmount: 30 })]);
  assert.deepEqual(J.grupos.map((g) => [g.k, g.pago, g.pp]), [
    ["Materiais", 100, 40],
    ["Gastos pessoal", 30, 0],
  ]);
  assert.equal(J.grupos[0].sub.length, 2);
  assert.equal(J.pago, 130);
  assert.equal(J.porPagar, 40);
});

test("O2 · custos por fornecedor; o consumo de stock é custo, a compra para armazém não", () => {
  const J = OBR.custosDaObra(
    [lanc(), lanc({ source: "CONSUMO_STOCK", paidBase: 25, paidAmount: 25, supplier: null }), lanc({ kind: "STOCK", paidAmount: 999, supplier: "Armazém" })],
    "forn"
  );
  assert.deepEqual(J.grupos.map((g) => [g.k, g.pago]), [
    ["NewCom", 100],
    ["Stock (consumo)", 25],
  ]);
});

// ═══ O4 Previsões ════════════════════════════════════════════════════════════

test("O4 · previsto e real mês a mês, com os acumulados", () => {
  const P = OBR.previsoesObra({
    resumo: OBR.resumoObra(fin()),
    projeto: { startDate: "2026-01-01", dueDate: "2026-12-31" },
    reais: [
      { data: "2026-10-03", lado: "R", valor: 100 },
      { data: "2026-10-05", lado: "P", valor: 40 },
    ],
    previstos: [
      { data: "2026-11-10", lado: "R", valor: 500 },
      { data: "2026-11-20", lado: "P", valor: 200 },
    ],
  });
  assert.equal(P.dias, 364);
  assert.equal(P.valor, 1000);
  assert.deepEqual(P.meses.map((m) => [m.k, m.ent, m.sai, m.entPrev, m.saiPrev, m.acReal, m.acPrev]), [
    ["2026-10", 100, 40, 0, 0, 60, 0],
    ["2026-11", 0, 0, 500, 200, 60, 300],
  ]);
});

test("O4 · sem datas na obra não há prazo", () => {
  const P = OBR.previsoesObra({ resumo: OBR.resumoObra(fin()), projeto: {}, reais: [], previstos: [] });
  assert.equal(P.dias, null);
  assert.deepEqual(P.meses, []);
});

// ═══ O5 Áreas de negócio ═══════════════════════════════════════════════════

test("O5 · faturação sem IVA por tipo de obra, contra o custo pago", () => {
  const A = OBR.areasDeNegocio({
    faturas: [
      { docDate: "2026-05-01", gross: 1140, vat: 140, received: 500, moeda: "AOA", tipo: "MÉDIA TENSÃO" },
      { docDate: "2025-05-01", gross: 100, vat: 0, received: 0, moeda: "AOA", tipo: "MÉDIA TENSÃO" },
    ],
    obras: [
      { tipo: "MÉDIA TENSÃO", moeda: "AOA", custoPago: 400 },
      { tipo: null, moeda: "AOA", custoPago: 50 },
    ],
    ano: "2026",
  });
  const mt = A.areas.find((a) => a.area === "MÉDIA TENSÃO");
  assert.equal(mt.fat, 1000);
  assert.equal(mt.faturas, 1, "o ano filtra as faturas");
  assert.equal(mt.margem, 600);
  assert.equal(mt.margemPct, 60);
  assert.ok(A.areas.some((a) => a.area === "Sem tipo de obra"));
});

test("O5 · uma moeda de cada vez", () => {
  const A = OBR.areasDeNegocio({
    faturas: [{ docDate: "2026-05-01", gross: 10, vat: 0, received: 0, moeda: "USD", tipo: "X" }],
    obras: [{ tipo: "X", moeda: "USD", custoPago: 4 }],
    moeda: "AOA",
  });
  assert.deepEqual(A.areas, []);
});

// ═══ R3 Autos de medição ═══════════════════════════════════════════════════

const auto = (over = {}) => ({
  id: "a1",
  reportNumber: "01",
  reportDate: "2026-08-19T00:00:00.000Z",
  status: "APPROVED",
  periodValTotal: 250,
  project: { id: "o1", code: "OBR-1", name: "Kwawa", currency: "AOA" },
  invoices: [],
  ...over,
});

test("R3 · percentagem de cada auto e acumulada sobre a venda da obra", () => {
  const R = OBR.autosDeMedicao(
    [auto(), auto({ id: "a2", reportNumber: "02", reportDate: "2026-09-19", periodValTotal: 500 })],
    new Map([["o1", 1000]])
  );
  const a2 = R.linhas.find((l) => l.id === "a2");
  assert.equal(a2.pctAuto, 50);
  assert.equal(a2.pctAcum, 75);
});

test("R3 · os autos rejeitados não entram na acumulada", () => {
  const R = OBR.autosDeMedicao(
    [auto({ status: "REJECTED" }), auto({ id: "a2", reportNumber: "02", periodValTotal: 100 })],
    new Map([["o1", 1000]])
  );
  assert.equal(R.linhas.find((l) => l.id === "a2").pctAcum, 10);
});

test("R3 · aprovado, faturado e por faturar", () => {
  const R = OBR.autosDeMedicao(
    [auto({ invoices: [{ docNumber: "FT 7" }] }), auto({ id: "a2", reportNumber: "02", periodValTotal: 100 }), auto({ id: "a3", reportNumber: "03", status: "SUBMITTED", periodValTotal: 9 })],
    new Map()
  );
  assert.deepEqual(R.totais.aprovado, { valor: 350, n: 2 });
  assert.deepEqual(R.totais.faturado, { valor: 250, n: 1 });
  assert.deepEqual(R.totais.porFaturar, { valor: 100, n: 1 });
  assert.deepEqual(R.totais.submetido, { valor: 9, n: 1 });
  assert.deepEqual(R.linhas.find((l) => l.id === "a1").faturas, ["FT 7"]);
});

test("R3 · sem venda prevista não há percentagem", () => {
  const R = OBR.autosDeMedicao([auto()], new Map());
  assert.equal(R.linhas[0].pctAuto, null);
});

test("R3 · autos que passam da venda prevista ficam acima de 100%", () => {
  const R = OBR.autosDeMedicao(
    [auto({ periodValTotal: 800 }), auto({ id: "a2", reportNumber: "02", periodValTotal: 900 })],
    new Map([["o1", 1000]])
  );
  assert.equal(R.linhas.find((l) => l.id === "a2").pctAcum, 170);
});
