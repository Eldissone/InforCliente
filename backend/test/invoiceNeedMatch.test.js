const test = require("node:test");
const assert = require("node:assert/strict");
const { matchInvoiceItemsToNeeds } = require("../src/services/invoiceSupplierMatchService");

const need = { id: "n1", description: "Cimento Portland 42.5 saco 50kg", quantity: 100 };

test("escolhe a linha mais parecida e usa o preço unitário da linha", () => {
  const items = [
    { description: "Areia fina", quantity: 10, unitPrice: 500, total: 5000 },
    { description: "Cimento Portland 42.5", quantity: 100, unitPrice: 8500, total: 850000, vatPercent: 14 },
  ];
  const [m] = matchInvoiceItemsToNeeds(items, [need], { grossAmount: 855000 });
  assert.equal(m.matchedItemIndex, 1);
  assert.equal(m.quotedPrice, 8500);
  assert.equal(m.estimated, false);
  assert.equal(m.vatPercent, 14);
});

test("sem correspondência com várias linhas: preço estimado pelo total ilíquido", () => {
  const items = [
    { description: "Serviço A", quantity: 1, unitPrice: 1000, total: 1000 },
    { description: "Serviço B", quantity: 1, unitPrice: 1000, total: 1000 },
  ];
  const [m] = matchInvoiceItemsToNeeds(items, [need], { grossAmount: 20000 });
  assert.equal(m.estimated, true);
  assert.equal(m.quotedPrice, 200);
});

test("sem linhas: usa totais do documento e marca como estimado", () => {
  const [m] = matchInvoiceItemsToNeeds([], [need], { grossAmount: 50000 });
  assert.equal(m.estimated, true);
  assert.equal(m.quotedPrice, 500);
  assert.equal(m.matchedItemIndex, null);
});
