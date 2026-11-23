const test = require("node:test");
const assert = require("node:assert/strict");
const NE = require("../src/services/budget/needs");
const PC = require("../src/services/budget/purchaseCatalog");

const hoje = "2026-11-23";
const doc = {
  baremSnapshot: { items: [{ kind: "FERRAMENTA", name: "Capacete", unit: "un", cost: 2500, fields: { tipo: "EPI" } }] },
  sheets: {
    mat: [
      { desc: "Cabo LXAV 4x16mm2", un: "m", q: 100, desp: 0.05, perd: 0.05, preco: 2700 },
      { desc: "Coluna IP 10m", un: "un", q: 10, preco: 0 },
      { desc: "Poste do cliente", un: "un", q: 5, cli: "Sim" },
      { desc: "Areia", un: "m3", q: 0 },
    ],
    fe: [{ item: "Capacete", q: 12 }, { item: "Rebarbadora", q: 2, manual: 45000 }],
    log: [{ item: "Mobilização de estaleiro", q: 1 }, { item: "Água potável", q: 10, dias: 30, manual: 100 }],
  },
};

test("C0: artigos a comprar — sem os do cliente nem quantidades zero, com desperdício e perdas; EPI à parte", () => {
  const L = NE.necessidades(doc);
  assert.deepEqual(L.map((x) => [x.cat, x.desc, x.q]), [
    ["mat", "Cabo LXAV 4x16mm2", 110.00000000000001],
    ["mat", "Coluna IP 10m", 10],
    ["epi", "Capacete", 12],
    ["fe", "Rebarbadora", 2],
    ["log", "Água potável", 300],
  ]);
});

test("C0: estado do preço — cotado e válido, antigo, sem preço", () => {
  const catalog = PC.buildPurchaseCatalog([
    { description: "Cabo LXAV 4x16mm2", unit: "m", unitPrice: 2900, currency: "AOA", source: "cotacao", supplier: "Kitanda", date: "2026-10-01" },
    { description: "Rebarbadora 230mm", unit: "un", unitPrice: 40000, currency: "AOA", source: "cotacao", date: "2025-01-10" },
  ]);
  const A = NE.artigos(doc, catalog, hoje);
  const e = Object.fromEntries(A.map((x) => [x.desc, x.est]));
  assert.equal(e["Cabo LXAV 4x16mm2"], "ok");
  assert.equal(e["Coluna IP 10m"], "none");
  assert.equal(e["Capacete"], "old", "só o preço do barém");
  assert.equal(A[0].est, "none", "sem preço primeiro");
  const R = NE.resumo({ id: "b", number: "ORC-1", projectName: "X", status: "EM_ELABORACAO", params: { prontoCot: true } }, A);
  assert.deepEqual([R.semPreco, R.antigo, R.cotados, R.pronto, R.porCat.epi], [1, 3, 1, true, 1]);
});

test("C0 consolidado: o mesmo artigo de vários orçamentos soma", () => {
  const a = [{ cat: "mat", desc: "Cabo", un: "m", q: 10, est: "none" }];
  const b = [{ cat: "mat", desc: "cabo", un: "M", q: 5, est: "none" }];
  const C = NE.consolidar([{ orc: { numero: "A" }, lista: a }, { orc: { numero: "B" }, lista: b }]);
  assert.equal(C.length, 1);
  assert.equal(C[0].q, 15);
  assert.equal(C[0].origens.length, 2);
});

test("C0 consolidado: o mesmo orçamento com o artigo em duas linhas conta como uma origem", () => {
  const a = [{ cat: "mat", desc: "Cabo", un: "m", q: 10, est: "none" }, { cat: "mat", desc: "Cabo", un: "m", q: 4, est: "none" }];
  const C = NE.consolidar([{ orc: { numero: "A" }, lista: a }]);
  assert.deepEqual(C[0].origens, [{ numero: "A", obra: undefined, q: 14 }]);
});
