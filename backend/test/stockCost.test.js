const test = require("node:test");
const assert = require("node:assert/strict");

const S = require("../src/services/stock/stockCost");
const { buildChecklist, STATUSES, DESTINATIONS, COST_CATEGORIES } = require("../src/routes/requisitions");

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const close = (actual, expected, label, tol = 1e-6) =>
  assert.ok(near(actual, expected, tol), `${label}: esperado ${expected}, obtido ${actual}`);

// ───────────────────────── sentido dos movimentos ─────────────────────────

test("direction: entradas, saídas e acertos", () => {
  for (const t of ["ENTRY", "TRANSFER_IN", "RETURN"]) assert.equal(S.direction(t), 1, t);
  for (const t of ["EXIT", "TRANSFER_OUT", "LOSS", "ALLOCATION"]) assert.equal(S.direction(t), -1, t);
  assert.equal(S.direction("ADJUSTMENT"), 0, "o acerto leva o sinal na quantidade");
});

test("direction: a devolução ao estaleiro repõe stock", () => {
  assert.equal(S.direction("RETURN"), 1, "material alocado e não consumido volta ao armazém");
  assert.equal(S.direction("ALLOCATION"), -1, "sai para a custódia da equipa");
});

// ───────────────────────── custo médio ponderado ─────────────────────────

test("primeira entrada: a média é o custo de compra", () => {
  close(S.averageAfterEntry({ qtyBefore: 0, avgBefore: null, qtyIn: 100, unitCostIn: 500 }), 500, "média");
});

test("segunda entrada a preço diferente: média ponderada pelas quantidades", () => {
  // 100 a 500 + 100 a 700 → (50 000 + 70 000) ÷ 200 = 600
  close(S.averageAfterEntry({ qtyBefore: 100, avgBefore: 500, qtyIn: 100, unitCostIn: 700 }), 600, "média");
  // 300 a 500 + 100 a 900 → (150 000 + 90 000) ÷ 400 = 600
  close(S.averageAfterEntry({ qtyBefore: 300, avgBefore: 500, qtyIn: 100, unitCostIn: 900 }), 600, "média ponderada");
});

test("entrada sem custo não dilui a média conhecida", () => {
  close(S.averageAfterEntry({ qtyBefore: 100, avgBefore: 500, qtyIn: 50, unitCostIn: 0 }), 500, "mantém a média");
  assert.equal(S.averageAfterEntry({ qtyBefore: 0, avgBefore: null, qtyIn: 50, unitCostIn: 0 }), null, "sem média nenhuma");
});

test("stock a zero ou negativo: a média passa a ser a da entrada", () => {
  close(S.averageAfterEntry({ qtyBefore: 0, avgBefore: 500, qtyIn: 10, unitCostIn: 800 }), 800, "stock a zero");
  close(S.averageAfterEntry({ qtyBefore: -5, avgBefore: 500, qtyIn: 10, unitCostIn: 800 }), 800, "stock negativo");
});

test("entrada de quantidade zero não mexe na média", () => {
  close(S.averageAfterEntry({ qtyBefore: 100, avgBefore: 500, qtyIn: 0, unitCostIn: 900 }), 500, "média");
});

test("a média arredonda a 4 casas, para não acumular erro", () => {
  // 3 a 10 + 1 a 11 → 41 ÷ 4 = 10,25
  close(S.averageAfterEntry({ qtyBefore: 3, avgBefore: 10, qtyIn: 1, unitCostIn: 11 }), 10.25, "média");
  // 7 a 100 + 3 a 133 → (700 + 399) ÷ 10 = 109,9
  close(S.averageAfterEntry({ qtyBefore: 7, avgBefore: 100, qtyIn: 3, unitCostIn: 133 }), 109.9, "média");
});

test("sequência de entradas: a média acompanha os preços", () => {
  let avg = null;
  let qty = 0;
  const entry = (q, c) => {
    avg = S.averageAfterEntry({ qtyBefore: qty, avgBefore: avg, qtyIn: q, unitCostIn: c });
    qty += q;
  };
  entry(100, 400);
  close(avg, 400, "depois da 1.ª entrada");
  entry(100, 600);
  close(avg, 500, "depois da 2.ª");
  entry(200, 500);
  close(avg, 500, "entrada ao preço da média não a muda");
  entry(400, 250);
  // 400 a 500 + 400 a 250 → (200 000 + 100 000) ÷ 800 = 375
  close(avg, 375, "depois da 4.ª");
});

// ───────────────────────── checklist antes de entregar ─────────────────────────

function req(over = {}) {
  return {
    status: "APROVADA",
    destination: "ARMAZEM",
    project: { id: "p", code: "OB-1", name: "Obra" },
    sourceWarehouse: { id: "w1", name: "Geral" },
    targetWarehouse: { id: "w2", name: "Obra" },
    costCategory: "MAT",
    neededBy: "2026-02-01",
    items: [{ id: "i1", description: "Cabo", quantity: 10, remaining: 10, productId: "prod1" }],
    ...over,
  };
}

test("checklist: requisição completa passa tudo o que é obrigatório", () => {
  const c = buildChecklist(req());
  const falhas = c.filter((x) => x.required && !x.ok);
  assert.deepEqual(falhas, [], falhas.map((f) => f.label).join(" | "));
});

test("checklist: item sem produto do catálogo é obrigatório quando sai do armazém", () => {
  const c = buildChecklist(req({ items: [{ id: "i1", description: "Coisa", quantity: 1, remaining: 1, productId: null }] }));
  const x = c.find((i) => /catálogo/i.test(i.label));
  assert.equal(x.ok, false);
  assert.equal(x.required, true);
});

test("checklist: para compra, o produto do catálogo não é obrigatório", () => {
  const c = buildChecklist(
    req({ destination: "COMPRA", items: [{ id: "i1", description: "Coisa nova", quantity: 1, remaining: 1, productId: null }] })
  );
  assert.equal(c.find((i) => /catálogo/i.test(i.label)).required, false);
});

test("checklist: pedido da sede não exige armazém de destino", () => {
  const c = buildChecklist(req({ project: null, targetWarehouse: null }));
  const x = c.find((i) => /Destino do material/i.test(i.label));
  assert.equal(x.required, false);
  assert.equal(x.ok, true, "sem obra, o consumo é direto");
});

test("checklist: obra sem armazém de destino falha", () => {
  const c = buildChecklist(req({ targetWarehouse: null }));
  const x = c.find((i) => /Destino do material/i.test(i.label));
  assert.equal(x.required, true);
  assert.equal(x.ok, false);
});

test("checklist: requisição ainda não aprovada falha", () => {
  const c = buildChecklist(req({ status: "SUBMETIDA" }));
  assert.equal(c.find((i) => /aprovada/i.test(i.label)).ok, false);
});

test("checklist: avisa quando falta stock, sem bloquear", () => {
  const c = buildChecklist(req(), { i1: { quantity: 4 } });
  const x = c.find((i) => /Stock/i.test(i.label));
  assert.equal(x.ok, false);
  assert.equal(x.required, false, "falta de stock não bloqueia: manda-se comprar");
  assert.match(x.label, /faltam 1 item/);
});

test("checklist: stock suficiente", () => {
  const c = buildChecklist(req(), { i1: { quantity: 50 } });
  assert.equal(c.find((i) => /Stock/i.test(i.label)).ok, true);
});

test("checklist: categoria de custo e data são recomendadas, não obrigatórias", () => {
  const c = buildChecklist(req({ costCategory: null, neededBy: null }));
  for (const rx of [/Categoria de custo/i, /Data em que é preciso/i]) {
    const x = c.find((i) => rx.test(i.label));
    assert.equal(x.ok, false);
    assert.equal(x.required, false);
  }
});

// ───────────────────────── vocabulário ─────────────────────────

test("estados e destinos: um só vocabulário, sem duplicados", () => {
  assert.deepEqual(DESTINATIONS, ["ARMAZEM", "COMPRA"], "dois destinos, não quatro documentos");
  assert.equal(new Set(STATUSES).size, STATUSES.length, "sem estados repetidos");
  for (const s of ["RASCUNHO", "SUBMETIDA", "APROVADA", "PARCIAL", "ATENDIDA", "EM_COMPRA", "RECUSADA", "CANCELADA"]) {
    assert.ok(STATUSES.includes(s), `falta o estado ${s}`);
  }
});

test("categorias de custo são as mesmas do orçamento", () => {
  const { CATS } = require("../src/services/budget/calc");
  const orcamento = new Set(CATS.map(([k]) => k));
  for (const [k] of COST_CATEGORIES) {
    assert.ok(orcamento.has(k), `a categoria ${k} não existe no orçamento`);
  }
});
