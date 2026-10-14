const { test } = require("node:test");
const assert = require("node:assert/strict");

const { computeSaleBudget, aggregateCosts, round2, safeDiv } = require("./financeLedgerService");

const project = { budgetTotal: "500000" };

function inputs(overrides = {}) {
  return {
    costPayments: [],
    extraRequests: [],
    transactions: [],
    purchaseOrders: [],
    freightAllocations: [],
    ...overrides,
  };
}

test("computeSaleBudget usa a tabela de quantidades (unitValue × quantidade)", () => {
  const tasks = [
    { parentId: null, expectedQty: "10", unitValue: "1000", totalValue: null, unitValueMaterial: null, unitValueService: null },
    { parentId: null, expectedQty: "2", unitValue: null, totalValue: "500", unitValueMaterial: null, unitValueService: null },
    // subtarefas não contam duas vezes
    { parentId: "x", expectedQty: "99", unitValue: "1000", totalValue: null },
  ];
  const result = computeSaleBudget(tasks, project);
  assert.equal(result.saleBudget, 10500);
  assert.equal(result.saleBudgetSource, "TABELA_QUANTIDADES");
});

test("computeSaleBudget soma material + serviço quando não há valor unitário", () => {
  const tasks = [
    { parentId: null, expectedQty: "4", unitValue: null, totalValue: null, unitValueMaterial: "100", unitValueService: "50" },
  ];
  const result = computeSaleBudget(tasks, project);
  assert.equal(result.saleBudget, 600);
  assert.equal(result.saleBudgetSource, "TABELA_QUANTIDADES");
});

test("computeSaleBudget cai para o valor global da obra sem tabela de quantidades", () => {
  const result = computeSaleBudget([], project);
  assert.equal(result.saleBudget, 500000);
  assert.equal(result.saleBudgetSource, "VALOR_GLOBAL");
  assert.equal(computeSaleBudget([], { budgetTotal: 0 }).saleBudgetSource, "SEM_ORCAMENTO");
});

test("aggregateCosts distingue realizado, por confirmar e comprometido", () => {
  const result = aggregateCosts("p1", inputs({
    costPayments: [
      { projectId: "p1", paidAmount: "100", budgetedAmount: "100", status: "CONFIRMADO", confirmationStatus: "CONFIRMADO" },
      { projectId: "p1", paidAmount: "0", budgetedAmount: "250", status: "PENDENTE", confirmationStatus: "POR_CONFIRMAR" },
      { projectId: "p2", paidAmount: "999", budgetedAmount: "999", status: "CONFIRMADO", confirmationStatus: "CONFIRMADO" },
    ],
    extraRequests: [
      { projectId: "p1", amount: "40", status: "PAGO" },
      { projectId: "p1", amount: "60", status: "APROVADO" },
      { projectId: "p1", amount: "70", status: "REJEITADO" },
    ],
    transactions: [
      { projectId: "p1", amount: "80", realizedAmount: null, status: "PAID" },
      { projectId: "p1", amount: "90", status: "PENDING" },
      { projectId: "p1", amount: "95", status: "CANCELLED" },
    ],
    purchaseOrders: [{ projectId: "p1", totalValue: "300", status: "APROVADO" }],
  }));

  // Realizado: 100 (pago) + 40 (pedido extra pago) + 80 (lançamento pago)
  assert.equal(result.realized, 220);
  // Por confirmar: 40 do pedido extra pago (não tem confirmação do financeiro)
  assert.equal(result.pending, 40);
  // Comprometido: 250 por liquidar + 60 aprovado + 90 a lançar + 300 pedido de compra
  assert.equal(result.committed, 700);
  assert.equal(result.bySource.COST_PAYMENT, 100);
  assert.equal(result.bySource.EXTRA_REQUEST, 40);
  assert.equal(result.bySource.PROJECT_TRANSACTION, 80);
  assert.equal(result.bySource.PURCHASE_ORDER, 300);
});

test("aggregateCosts ignora rejeitados/cancelados e outras obras", () => {
  const result = aggregateCosts("p1", inputs({
    costPayments: [
      { projectId: "p1", paidAmount: "10", budgetedAmount: "10", status: "CANCELADO", confirmationStatus: "CONFIRMADO" },
    ],
    extraRequests: [{ projectId: "p2", amount: "500", status: "PAGO" }],
    transactions: [{ projectId: "p1", amount: "500", status: "CANCELLED" }],
  }));
  assert.equal(result.realized, 10);
  assert.equal(result.committed, 0);
  assert.equal(result.bySource.EXTRA_REQUEST, 0);
});

test("aggregateCosts soma as alocações de frete ainda não enviadas ao financeiro", () => {
  const result = aggregateCosts("p1", inputs({
    freightAllocations: [
      { projectId: "p1", amount: "50000" },
      { projectId: "p1", amount: "30000" },
      { projectId: "p2", amount: "20000" },
    ],
  }));
  assert.equal(result.committed, 80000);
  assert.equal(result.realized, 0);
  assert.equal(result.bySource.FREIGHT, 80000);
});

test("round2 e safeDiv tratam valores vazios e divisão por zero", () => {
  assert.equal(round2(null), 0);
  assert.equal(round2("10.005"), 10.01);
  assert.equal(safeDiv(50, 200), 25);
  assert.equal(safeDiv(50, 0), 0);
});
