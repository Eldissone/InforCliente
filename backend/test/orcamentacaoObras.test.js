const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const core = () => import(pathToFileURL(path.join(__dirname, "../../frontend/src/shared/orcamentacao/orcCore.js")).href);

// O exemplo verificado no protótipo (ORC-26-001): 1000 M de cabo a 1500 e 20 dias de electricista a 25 000,
// reserva 5 %, venda 3 000 000 AOA, de 01/12/2026 a 28/02/2027, autos mensais, 15 + 30 dias.
const ORC = {
  currency: "AOA",
  pricing: { metodo: "MARGEM", mMin: 15, mObj: 25, reserva: 5 },
  startDate: "2026-12-01",
  endDate: "2027-02-28",
  cost: [
    { cat: "Material", tipo: "Compra", desc: "CABO VV 3X2,5MM", un: "M", qt: 1000, pu: 1500, q: { 0: 500, 1: 500 } },
    { cat: "Mão de Obra", tipo: "Pessoal", desc: "ELECTRICISTA", un: "Dia", qt: 20, pu: 25000, q: { 0: 10, 1: 10 } },
  ],
  sale: { valor: 3000000 },
};

test("totais: custo com reserva, margem e preço sugerido (como no protótipo)", async () => {
  const { totais } = await core();
  const t = totais(ORC);
  assert.equal(t.linhas, 2000000);
  assert.equal(t.reserva, 100000);
  assert.equal(t.custo, 2100000);
  assert.equal(t.vendaAOA, 3000000);
  assert.equal(t.margem, 900000);
  assert.equal(Math.round(t.mp * 10) / 10, 30);
  assert.equal(t.pvAOA, 2800000, "custo ÷ (1 − 25 %)");
  assert.equal(totais({ ...ORC, pricing: { ...ORC.pricing, metodo: "MARKUP" } }).pvAOA, 2625000, "custo × (1 + 25 %)");
  assert.equal(t.porTipo.Compra, 1500000);
  assert.equal(t.semDist, 0);
});

test("semanas, recebimentos e previsão mensal batem com o protótipo", async () => {
  const { weeks, recebimentos, mensal } = await core();
  const W = weeks(ORC);
  assert.equal(W.length, 13);
  assert.deepEqual([W[0].ini, W[0].fim, W[12].fim], ["2026-12-01", "2026-12-07", "2027-02-28"]);
  const R = recebimentos(ORC);
  assert.deepEqual(R.map((r) => [r.d, Math.round(r.v * 100) / 100]), [
    ["2027-02-14", 1033333.33],
    ["2027-03-17", 1033333.33],
    ["2027-04-14", 933333.33],
  ]);
  const M = mensal(ORC);
  assert.deepEqual(M.map((m) => [m.k, m.r, m.c, m.ac]), [
    ["2026-12", 0, 2000000, -2000000],
    ["2027-02", 1033333.33, 0, -966666.67],
    ["2027-03", 1033333.33, 0, 66666.67],
    ["2027-04", 933333.33, 0, 1000000],
  ]);
});

test("adiantamento diluído, retenção, marcos e moeda estrangeira", async () => {
  const { recebimentos, totais, distribuir, weeks, cQd } = await core();
  const amort = { ...ORC, sale: { valor: 3000000, cond: { modo: "amort", adPct: 10, ret: 5, retAnos: 1 } } };
  const R = recebimentos(amort);
  assert.equal(R[0].desc, "Adiantamento (10%)");
  const soma = R.reduce((s, r) => s + r.v, 0);
  assert.ok(Math.abs(soma - 3000000) < 0.01, "adiantamento + autos + devolução da retenção = venda");
  assert.match(R[R.length - 1].desc, /Devolução da retenção/);
  const marcos = recebimentos({ ...ORC, sale: { valor: 1000, cond: { modo: "marcos", pag: 0, marcos: [{ pct: 40, data: "2027-01-10", desc: "Assinatura" }, { pct: 60, data: "2026-12-20" }] } } });
  assert.deepEqual(marcos.map((m) => [m.d, m.v]), [["2026-12-20", 600], ["2027-01-10", 400]]);
  const usd = totais({ ...ORC, currency: "USD", exchangeRate: 900, sale: { valor: 4000 } });
  assert.equal(usd.vendaAOA, 3600000);
  const l = { qt: 10, hrs: 2 };
  const q = distribuir(l, weeks(ORC), [0, 1, 2]);
  assert.equal(Object.values(q).reduce((s, v) => s + v, 0), cQd(l));
});
