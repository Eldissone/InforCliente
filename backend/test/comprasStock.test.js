const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPriceBase,
  buildComparisons,
  buildCommitments,
  buildSupplierAccounts,
  supplierStatement,
  buildStockByWarehouse,
} = require("../src/services/compras/aggregates");

/**
 * Área Compras e Stock alinhada com o protótipo (NAV_COMP): C3 Base de Preços,
 * C5 Compromissos Pendentes, C6 Conta Corrente de Fornecedores e S3 Stock por
 * Armazém.
 */
const HOJE = new Date(2026, 10, 23);

test("C3: preço da tabela válido pela validade; cotação velha fica expirada; destaca o mais barato", () => {
  const r = buildPriceBase(
    {
      supplierProducts: [
        { id: "a", name: "Cabo 16mm", price: 1200, currency: "AOA", unit: "m", supplierId: "s1", supplier: { name: "Forn A" }, updatedAt: new Date(2026, 0, 1), validUntil: new Date(2026, 11, 31) },
        { id: "b", name: "Cabo 16mm", price: 1500, currency: "AOA", unit: "m", supplierId: "s2", supplier: { name: "Forn B" }, updatedAt: new Date(2026, 10, 1) },
      ],
      quotes: [
        { id: "q", supplierId: "s3", supplier: { name: "Forn C" }, quotedPrice: 900, currency: "AOA", updatedAt: new Date(2026, 1, 1), need: { description: "Cabo 16mm", unit: "m" } },
      ],
    },
    HOJE
  );
  const by = Object.fromEntries(r.items.map((x) => [x.id, x]));
  assert.equal(by["sp:a"].valido, true, "validade explícita manda");
  assert.equal(by["sp:b"].valido, true, "22 dias < 90");
  assert.equal(by["nq:q"].valido, false, "cotação com mais de 90 dias");
  assert.equal(by["sp:a"].melhor, true, "o mais barato entre os válidos");
  assert.equal(by["nq:q"].melhor, false, "expirado não conta para o melhor");
  assert.equal(r.totais.artigos, 1);
  assert.equal(r.totais.fornecedores, 3);
});

test("C5: requisições sem pedido, pedidos por aprovar e aprovados sem fatura", () => {
  const r = buildCommitments({
    requisitions: [
      { id: "r1", number: "RQ-1", status: "APROVADA", createdAt: "2026-11-01", items: [{ description: "Tubo", quantity: 10, fulfilledQuantity: 4, estimatedUnitPrice: 100 }] },
      { id: "r2", number: "RQ-2", status: "APROVADA", purchaseOrderId: "po", createdAt: "2026-11-02", items: [] },
    ],
    payables: [
      { id: "po:1", stage: "COMPROMISSO", source: "PEDIDO_COMPRA", payable: 500, supplier: "X", date: "2026-11-05" },
      { id: "po:2", stage: "A_PAGAR", source: "PEDIDO_COMPRA", payable: 700, supplier: "Y", date: "2026-11-06" },
      { id: "cp:3", stage: "A_PAGAR", source: "PAGAMENTO", payable: 999, supplier: "Z", date: "2026-11-07" },
    ],
  });
  assert.equal(r.grupos.req.n, 1, "a requisição já com pedido sai");
  assert.equal(r.grupos.req.valor, 600, "só o que falta entregar");
  assert.equal(r.grupos.apr.valor, 500);
  assert.equal(r.grupos.sft.valor, 700);
  assert.equal(r.total, 1800, "o pagamento já documentado não é compromisso");
});

test("C6: saldo e antiguidade por fornecedor, juntando id e nome", () => {
  const input = {
    suppliers: [{ id: "s1", name: "Elétrica Lda", nif: "500" }],
    payables: [
      { id: "a", stage: "A_PAGAR", supplierId: "s1", supplier: "Elétrica Lda", payable: 100, daysLate: -5, currency: "AOA" },
      { id: "b", stage: "A_PAGAR", supplier: "ELETRICA LDA", payable: 50, daysLate: 45, currency: "AOA" },
      { id: "c", stage: "A_PAGAR", supplier: "Outro", payable: 30, daysLate: 120, currency: "AOA" },
      { id: "d", stage: "COMPROMISSO", supplier: "Outro", payable: 1000, daysLate: null, currency: "AOA" },
      { id: "e", stage: "A_PAGAR", supplier: "Outro", payable: 9, daysLate: null, currency: "USD" },
    ],
    payments: [{ id: "p", party: "Elétrica Lda", amount: 70, date: "2026-10-10" }],
  };
  const r = buildSupplierAccounts(input, "AOA");
  const el = r.fornecedores.find((f) => f.id === "s1");
  assert.equal(el.saldo, 150, "o mesmo fornecedor pelo id e pelo nome");
  assert.equal(el.ag.av, 100);
  assert.equal(el.ag.b2, 50);
  assert.equal(el.pago12m, 70);
  assert.equal(r.totais.divida, 180, "compromissos e outras moedas não entram");
  assert.equal(r.totais.mais90, 30);
  assert.deepEqual(r.moedas.sort(), ["AOA", "USD"]);

  const ext = supplierStatement(input, el.chave, "AOA");
  assert.equal(ext.abertos.length, 2);
  assert.equal(ext.pagos.length, 1);
});

test("S3: stock ao custo médio, agrupado por tipo de armazém", () => {
  const r = buildStockByWarehouse([
    { id: "1", warehouseId: "w1", productId: "p1", quantity: 10, avgCost: 5, warehouse: { name: "Central", type: "CENTRAL" }, product: { name: "Parafuso", unit: "UN" } },
    { id: "2", warehouseId: "w2", productId: "p1", quantity: 2, avgCost: null, warehouse: { name: "Obra 1", type: "SITE", project: { code: "OB-1" } }, product: { name: "Parafuso", unit: "UN" } },
    { id: "3", warehouseId: "w1", productId: "p2", quantity: 0, avgCost: 9, warehouse: { name: "Central", type: "CENTRAL" }, product: { name: "Zero" } },
  ]);
  assert.equal(r.items.length, 2, "sem quantidade não aparece");
  assert.equal(r.total, 50);
  assert.equal(r.semCusto, 1);
  assert.equal(r.grupos.find((g) => g.tipo === "SITE").linhas, 1);
});

test("C2: propostas lado a lado, a mais barata e o que custou escolher outra", () => {
  const r = buildComparisons([
    {
      id: "n1", description: "Poste 12m", quantity: 4, status: "APPROVED", date: "2026-11-01",
      quotes: [
        { id: "a", supplier: { name: "A" }, quotedPrice: 100, selected: true },
        { id: "b", supplier: { name: "B" }, quotedPrice: 90, netTotal: 380 },
      ],
    },
    { id: "n2", description: "Sem cotações", quotes: [] },
    { id: "n3", description: "Cabo", quantity: 1, date: "2026-11-02", quotes: [{ id: "c", quotedPrice: 5 }, { id: "d", quotedPrice: 6 }] },
  ]);
  assert.equal(r.mapas.length, 2, "sem cotações não é mapa");
  const n1 = r.mapas.find((m) => m.id === "n1");
  assert.equal(n1.estado, "Adjudicado");
  assert.equal(n1.propostas[0].id, "b", "ordenado pelo total");
  assert.equal(n1.propostas[0].maisBarata, true);
  assert.equal(n1.poupanca, 20, "400 escolhido − 380 mais barato");
  assert.equal(r.totais.decidir, 1);
});
