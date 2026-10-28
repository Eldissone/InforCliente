const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeSaleBudget,
  aggregateCosts,
  isMerchandisePayment,
  computeProgress,
  computeCostControl,
  round2,
  safeDiv,
} = require("./financeLedgerService");

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
  // Por confirmar: nada pago por confirmar (o pedido extra pago entra confirmado,
  // tal como aparece na lista de custos)
  assert.equal(result.pending, 0);
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
  assert.equal(result.realized, 0);
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

test("aggregateCosts: mercadoria paga fica em stock e o custo da obra vem do consumo", () => {
  const result = aggregateCosts("p1", inputs({
    merchNeedIds: new Set(["need-cimento"]),
    costPayments: [
      { projectId: "p1", needId: "need-cimento", paidAmount: "1000", budgetedAmount: "1000", status: "CONFIRMADO", confirmationStatus: "POR_CONFIRMAR" },
      { projectId: "p1", needId: "need-servico", paidAmount: "200", budgetedAmount: "200", status: "CONFIRMADO", confirmationStatus: "POR_CONFIRMAR" },
    ],
    stockConsumption: [
      { projectId: "p1", value: 300, confirmedAt: null },
      { projectId: "p1", value: 100, confirmedAt: new Date() },
      { projectId: "p2", value: 999, confirmedAt: null },
    ],
  }));
  // Realizado: 200 do serviço + 400 de consumo (os 1000 de cimento estão em stock)
  assert.equal(result.realized, 600);
  assert.equal(result.stockPurchases, 1000);
  assert.equal(result.bySource.STOCK_CONSUMPTION, 400);
  // Por confirmar: 200 do serviço + 300 de consumo sem confirmação
  assert.equal(result.pending, 500);
});

test("aggregateCosts conta o levantamento ATM por discriminar como realizado por confirmar", () => {
  const result = aggregateCosts("p1", inputs({
    atmMovements: [{ projectId: "p1", amount: "50000" }, { projectId: "p2", amount: "1" }],
  }));
  assert.equal(result.realized, 50000);
  assert.equal(result.pending, 50000);
  assert.equal(result.bySource.ATM, 50000);
});

test("isMerchandisePayment reconhece a entrada em stock ou a origem explícita", () => {
  const merch = new Set(["n1"]);
  assert.equal(isMerchandisePayment({ needId: "n1" }, merch), true);
  assert.equal(isMerchandisePayment({ needId: "n2" }, merch), false);
  assert.equal(isMerchandisePayment({ sourceType: "MERCADORIA_STOCK" }, merch), true);
  assert.equal(isMerchandisePayment({ needId: null }, undefined), false);
});

test("round2 e safeDiv tratam valores vazios e divisão por zero", () => {
  assert.equal(round2(null), 0);
  assert.equal(round2("10.005"), 10.01);
  assert.equal(safeDiv(50, 200), 25);
  assert.equal(safeDiv(50, 0), 0);
});

test("aggregateCosts separa o IVA dedutível da parte paga", () => {
  const result = aggregateCosts("p1", inputs({
    costPayments: [
      { projectId: "p1", status: "CONFIRMADO", paidAmount: "57000", budgetedAmount: "114000", grossAmount: "114000", vatAmount: "14000", fiscalApplyVat: true },
      { projectId: "p1", status: "CONFIRMADO", paidAmount: "10000", budgetedAmount: "10000", grossAmount: "11400", vatAmount: "1400", fiscalApplyVat: false },
    ],
  }));
  assert.equal(result.realized, 67000);
  assert.equal(result.realizedVat, 7000);
});

test("computeProgress usa o avanço físico, depois as quantidades e por fim a faturação", () => {
  assert.deepEqual(computeProgress({ physicalPct: 40 }), { pct: 40, source: "FISICO" });
  const tasks = [
    { parentId: null, unitValue: "100", expectedQty: "10", executedQty: "5" },
    { parentId: null, unitValue: "300", expectedQty: "10", executedQty: "0" },
    { parentId: "x", unitValue: "999", expectedQty: "1", executedQty: "1" },
  ];
  assert.deepEqual(computeProgress({ physicalPct: 0, tasks }), { pct: 12.5, source: "QUANTIDADES" });
  assert.deepEqual(computeProgress({ physicalPct: 0, tasks: [], invoiced: 300, saleBudget: 1000 }), { pct: 30, source: "FATURACAO" });
  assert.deepEqual(computeProgress({}), { pct: 0, source: "SEM_AVANCO" });
});

test("computeCostControl compara o realizado com o esperado para o avanço", () => {
  const c = computeCostControl({ budget: 1000, realized: 600, committed: 200, progressPct: 50 });
  assert.equal(c.expectedToDate, 500);
  assert.equal(c.deviationToDate, 100);
  assert.equal(c.deviationToDatePct, 20);
  assert.equal(c.eac, 1000);
  assert.equal(c.eacDeviation, 0);
  const over = computeCostControl({ budget: 1000, realized: 900, committed: 300, progressPct: 60 });
  assert.equal(over.eac, 1200);
  assert.equal(over.eacDeviationPct, 20);
});

test("computeCostControl sem avanço conhecido não calcula desvio à data", () => {
  const c = computeCostControl({ budget: 1000, realized: 400, committed: 0, progressPct: null });
  assert.equal(c.expectedToDate, null);
  assert.equal(c.deviationToDate, null);
  assert.equal(c.eac, 1000);
});

test("aggregateCosts: pagamento pendente com valor do documento não conta como pago", () => {
  const result = aggregateCosts("p1", inputs({
    costPayments: [
      // Prestação agendada: o documento tem valor mas ainda não foi paga.
      { projectId: "p1", status: "PENDENTE", paidAmount: "268800", budgetedAmount: "240000", grossAmount: "268800", vatAmount: "33600", netAmount: "268800", fiscalApplyVat: true },
      // Paga: base 9 180 000, IVA 14%, retenção 6,5% → líquido 9 868 500.
      { projectId: "p1", status: "CONFIRMADO", paidAmount: "9868500", budgetedAmount: "9180000", grossAmount: "10465200", vatAmount: "1285200", withholdingAmount: "596700", netAmount: "9868500", fiscalApplyVat: true },
    ],
  }));
  assert.equal(result.committed, 268800);
  assert.equal(result.realized, 9868500);
  // Custo sem IVA = a base (a retenção continua a ser custo).
  assert.equal(round2(result.realized - result.realizedVat), 9180000);
});
