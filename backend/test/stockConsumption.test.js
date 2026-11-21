const test = require("node:test");
const assert = require("node:assert/strict");

const { CONSUMPTION_TYPES, consumptionRows } = require("../src/services/budget/stockConsumption");
const { productUnit } = require("../src/services/budget/units");

const mv = (over = {}) => ({
  productId: "p1",
  type: "EXIT",
  quantity: 10,
  product: { name: "Poste de Betão 16/1600", sku: "PB16", unit: "UN" },
  ...over,
});

// ─── O que conta como consumo ──────────────────────────────────────────────

test("só EXIT e LOSS contam", () => {
  assert.deepEqual([...CONSUMPTION_TYPES].sort(), ["EXIT", "LOSS"]);
});

test("a custódia das equipas não é consumo", () => {
  // ALLOCATION é entrega a um plano diário e RETURN é a devolução do que
  // sobrou: contá-las era contar duas vezes o que sai depois como EXIT.
  const r = consumptionRows([
    mv({ type: "ALLOCATION", quantity: 100 }),
    mv({ type: "RETURN", quantity: 40 }),
    mv({ type: "EXIT", quantity: 60 }),
  ]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].q, 60);
  assert.equal(r.resumo.ignorados, 2);
});

test("entradas no armazém não são consumo da obra", () => {
  const r = consumptionRows([mv({ type: "ENTRY", quantity: 500 }), mv({ type: "EXIT", quantity: 5 })]);
  assert.equal(r.rows[0].q, 5);
});

test("as perdas contam como consumo e ficam assinaladas", () => {
  const r = consumptionRows([mv({ quantity: 10 }), mv({ type: "LOSS", quantity: 2 })]);
  assert.equal(r.rows[0].q, 12);
  assert.equal(r.resumo.comPerdas, 1);
});

test("transferências e ajustes ficam de fora", () => {
  const r = consumptionRows([mv({ type: "TRANSFER_OUT" }), mv({ type: "ADJUSTMENT" })]);
  assert.deepEqual(r.rows, []);
  assert.equal(r.resumo.ignorados, 2);
});

// ─── Agregar ───────────────────────────────────────────────────────────────

test("várias saídas do mesmo produto dão uma linha só", () => {
  const r = consumptionRows([mv({ quantity: 10 }), mv({ quantity: 5 }), mv({ quantity: 2.5 })]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].q, 17.5);
  assert.equal(r.resumo.movimentos, 3);
});

test("produtos diferentes dão linhas diferentes", () => {
  const r = consumptionRows([
    mv(),
    mv({ productId: "p2", product: { name: "Cabo XV", sku: "CB", unit: "M" }, quantity: 300 }),
  ]);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].desc, "Cabo XV", "o que mais se consumiu vem à frente");
});

test("as quantidades guardam as casas decimais", () => {
  const r = consumptionRows([mv({ quantity: 0.3333 }), mv({ quantity: 0.6667 })]);
  assert.equal(r.rows[0].q, 1);
});

test("produto sem nome não entra", () => {
  const r = consumptionRows([mv({ product: { name: "", unit: "UN" } }), mv()]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.resumo.ignorados, 1);
});

test("quantidade a zero ou negativa não vira linha", () => {
  const r = consumptionRows([mv({ quantity: 0 }), mv({ productId: "p2", product: { name: "X", unit: "UN" }, quantity: -5 })]);
  assert.deepEqual(r.rows, []);
});

test("saída e devolução que se anulam não deixam linha", () => {
  // RETURN não conta, mas uma saída corrigida por um ajuste negativo no
  // próprio EXIT (dados antigos) não pode gerar uma linha a zero.
  const r = consumptionRows([mv({ quantity: 10 }), mv({ quantity: -10 })]);
  assert.deepEqual(r.rows, []);
});

// ─── A linha que sai ───────────────────────────────────────────────────────

test("a linha traz o que o armazém sabe e deixa o preço em branco", () => {
  const r = consumptionRows([mv({ quantity: 7 })], { currency: "AOA" });
  assert.deepEqual(r.rows[0], {
    cod: "PB16",
    fam: "",
    desc: "Poste de Betão 16/1600",
    un: "un",
    q: 7,
    cli: "Não",
    preco: null,
    moeda: "AOA",
  });
});

test("o preço fica sempre por preencher — não se inventa", () => {
  const r = consumptionRows([mv(), mv({ productId: "p2", product: { name: "Y", unit: "M" } })]);
  assert.ok(r.rows.every((x) => x.preco === null), "alguma linha veio com preço");
});

test("o material não é do cliente: é da empresa, só não tem preço", () => {
  // «Do cliente = Sim» põe o custo a zero de propósito; não é o caso aqui.
  const r = consumptionRows([mv()]);
  assert.equal(r.rows[0].cli, "Não");
});

test("a moeda do orçamento vai para a linha", () => {
  assert.equal(consumptionRows([mv()], { currency: "USD" }).rows[0].moeda, "USD");
  assert.equal(consumptionRows([mv()]).rows[0].moeda, "AOA", "por omissão, kwanza");
});

test("sem SKU o código fica vazio, não nulo", () => {
  const r = consumptionRows([mv({ product: { name: "Sem código", unit: "UN" } })]);
  assert.equal(r.rows[0].cod, "");
});

// ─── Unidades ──────────────────────────────────────────────────────────────

test("as unidades do armazém passam à grafia do orçamento", () => {
  for (const [armazem, orcamento] of [["UN", "un"], ["M", "m"], ["MT3", "m3"], ["MT2", "m2"], ["KG", "kg"], ["L", "L"]]) {
    const r = consumptionRows([mv({ product: { name: "X", unit: armazem } })]);
    assert.equal(r.rows[0].un, orcamento, `${armazem} devia dar ${orcamento}`);
  }
});

test("caixa e par não se traduzem para «un» — ficam assinaladas", () => {
  const r = consumptionRows([
    mv({ product: { name: "Parafusos", unit: "CX" } }),
    mv({ productId: "p2", product: { name: "Luvas", unit: "PAR" } }),
  ]);
  assert.deepEqual(
    r.resumo.unidadesPorReconhecer.map((u) => u.original).sort(),
    ["CX", "PAR"]
  );
  assert.equal(productUnit("CX").matched, false);
});

// ─── O resumo ──────────────────────────────────────────────────────────────

test("o resumo conta artigos, movimentos e o que ficou de fora", () => {
  const r = consumptionRows([
    mv({ quantity: 10 }),
    mv({ quantity: 5 }),
    mv({ productId: "p2", product: { name: "Cabo", unit: "M" }, quantity: 100 }),
    mv({ type: "ALLOCATION" }),
  ]);
  assert.equal(r.resumo.artigos, 2);
  assert.equal(r.resumo.movimentos, 3);
  assert.equal(r.resumo.ignorados, 1);
  assert.equal(r.resumo.quantidadeTotal, 115);
});

test("lista vazia não rebenta", () => {
  for (const v of [[], null, undefined]) {
    const r = consumptionRows(v);
    assert.deepEqual(r.rows, []);
    assert.equal(r.resumo.artigos, 0);
  }
});

test("quantidade que não é número não propaga NaN", () => {
  const r = consumptionRows([mv({ quantity: "abc" }), mv({ quantity: 3 })]);
  assert.equal(r.rows[0].q, 3);
  assert.ok(!Number.isNaN(r.resumo.quantidadeTotal));
});
