const test = require("node:test");
const assert = require("node:assert/strict");
const PT = require("../src/services/purchase/purchaseTotals");

test("parcelas acordadas na requisição: duas ou mais, com data e valor, que somam o total", () => {
  const ok = PT.parcelasAcordadas({ parcelas: [{ data: "2026-11-23", valor: 4000 }, { data: "2026-12-23", valor: 7400 }] }, 11400);
  assert.deepEqual(ok, [
    { number: 1, amount: 4000, dueDate: "2026-11-23" },
    { number: 2, amount: 7400, dueDate: "2026-12-23" },
  ]);
  assert.equal(PT.parcelasAcordadas({ parcelas: [{ data: "2026-11-23", valor: 100 }] }, 100), null, "uma só não é parcelado");
  assert.equal(PT.parcelasAcordadas({ parcelas: [{ data: "2026-11-23", valor: 50 }, { data: "2026-12-23", valor: 40 }] }, 100), null, "não soma o total");
  assert.equal(PT.parcelasAcordadas({ parcelas: [{ data: "", valor: 50 }, { data: "2026-12-23", valor: 50 }] }, 100), null, "sem data");
  assert.equal(PT.parcelasAcordadas({ parcelas: [{ data: "2026-11-23", valor: 0 }, { data: "2026-12-23", valor: 0 }] }, 0), null, "sem total (vai à cotação)");
  assert.equal(PT.parcelasAcordadas({}, 100), null);
});

test("linha da requisição guarda o código do produto e o fornecedor do fundo de maneio", () => {
  const r = PT.itemRowForDb({ name: "Cabo", quantity: 2, unitPrice: 10, code: " 00000957 ", lineSupplierName: "Loja X" });
  assert.equal(r.code, "00000957");
  assert.equal(r.lineSupplierName, "Loja X");
  const s = PT.itemRowForDb({ name: "Cabo", quantity: 1 });
  assert.equal(s.code, null);
  assert.equal(s.lineSupplierName, null);
});
