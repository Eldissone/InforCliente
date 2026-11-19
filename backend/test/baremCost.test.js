const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const B = require("../src/services/budget/baremCost");

/**
 * Valores de referência: os baremes de exemplo do protótipo
 * "Orçamentação de Obras MBT", com os parâmetros de cálculo do mesmo exemplo
 * (horasDia 8, diasMes 22, horasAnoEquip 1800, gasóleo 400/L, gasolina 300/L).
 *
 * Qualquer alteração às fórmulas tem de manter estes números, senão os orçamentos
 * deixam de bater com os que foram feitos no protótipo.
 */
const CTX = {
  horasDia: 8,
  diasMes: 22,
  horasAnoEquip: 1800,
  validadeBarem: 180,
  validadeComb: 30,
  fuelPrices: { "Gasóleo": 400, Gasolina: 300 },
};

/** Data fixa, para os testes de validade não dependerem de quando correm. */
const HOJE = new Date("2026-11-19T00:00:00Z");

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const close = (actual, expected, label, tol = 1e-6) =>
  assert.ok(near(actual, expected, tol), `${label}: esperado ${expected}, obtido ${actual}`);

// ───────────────────────── COMBUSTIVEL ─────────────────────────

test("COMBUSTIVEL: o custo é o preço por litro", () => {
  const r = B.computeBaremCost("COMBUSTIVEL", { name: "Gasóleo", fields: { preco: 400 } }, CTX);
  assert.equal(r.computedCost, 400);
});

// ───────────────────────── RH ─────────────────────────

test("RH-02 Engenheiro: diário, real, real/hora e hora c/ encargos", () => {
  const item = {
    name: "Engenheiro",
    fields: { mensal: 1350000, enc: 0.25, seg: 600, alim: 3500, aloj: 7500, transp: 1500, outros: 0 },
  };
  const { computedCost, detail } = B.computeBaremCost("RH", item, CTX);

  close(detail.dia, 1350000 / 22, "custo diário");
  close(detail.hora, 1350000 / 22 / 8, "custo/hora");
  // real = diário × (1 + encargos) + seguro + alimentação + alojamento + transporte + outros
  close(detail.real, (1350000 / 22) * 1.25 + 600 + 3500 + 7500 + 1500, "custo real diário");
  close(detail.realH, detail.real / 8, "custo real/hora");
  // hEnc exclui alimentação, alojamento e transporte (entram por dia na folha 04)
  close(detail.hEnc, ((1350000 / 22) * 1.25 + 600) / 8, "custo/hora c/ encargos");
  close(computedCost, detail.real, "computedCost = custo real diário");
  close(detail.hEnc, 9663.068181818182, "custo/hora c/ encargos (valor absoluto)", 1e-9);
});

test("RH-01 Diretor de Projeto: sem alimentação, alojamento nem transporte", () => {
  const item = { name: "Diretor de Projeto", fields: { mensal: 2800000, enc: 0.25, seg: 600 } };
  const { detail } = B.computeBaremCost("RH", item, CTX);
  close(detail.real, (2800000 / 22) * 1.25 + 600, "custo real diário");
  close(detail.real, detail.hEnc * 8, "sem extras diários, real = hEnc × horas/dia");
});

test("RH: sem custo mensal, tudo a zero menos os adicionais diários", () => {
  const { computedCost, detail } = B.computeBaremCost("RH", { name: "X", fields: { alim: 3500 } }, CTX);
  assert.equal(detail.dia, 0);
  assert.equal(computedCost, 3500);
});

// ───────────────────────── EQUIPAMENTO ─────────────────────────

test("EQ-03 Retroescavadora (próprio): depreciação, combustível e seguro anual repartido", () => {
  const item = {
    name: "Retroescavadora",
    ownership: "Próprio",
    fields: { aq: 98000000, vida: 10000, man: 3000, lh: 8, tipo: "Gasóleo", lub: 500, pneus: 1000, oper: 2450, seguro: 1400000 },
  };
  const { computedCost, detail } = B.computeBaremCost("EQUIPAMENTO", item, CTX);

  close(detail.dep, 9800, "depreciação/h");
  close(detail.precoL, 400, "preço do litro");
  close(detail.combH, 3200, "combustível/h");
  // próprio: dep + manutenção + lubrificantes + pneus + seguro/horasAno + combustível + operador + outros
  close(detail.custoH, 9800 + 3000 + 500 + 1000 + 1400000 / 1800 + 3200 + 2450, "custo/hora");
  close(detail.custoH, 20727.777777777777, "custo/hora (valor absoluto)", 1e-9);
  close(detail.dia, detail.custoH * 8, "custo/dia");
  close(detail.mes, detail.custoH * 8 * 22, "custo/mês");
  close(computedCost, detail.custoH, "computedCost = custo/hora");
});

test("EQ-01 Autogrua (alugado por dia): aluguer dividido pelas horas/dia", () => {
  const item = {
    name: "Autogrua 50 t",
    ownership: "Alugado",
    fields: { aluguer: 650000, lh: 14, tipo: "Gasóleo" },
  };
  const { detail } = B.computeBaremCost("EQUIPAMENTO", item, CTX);
  close(detail.dep, 0, "alugado não tem depreciação");
  close(detail.custoH, 650000 / 8 + 14 * 400, "custo/hora");
  close(detail.custoH, 86850, "custo/hora (valor absoluto)");
});

test("EQ alugado à hora: o aluguer entra direto, sem dividir", () => {
  const item = { name: "X", ownership: "Alugado", fields: { aluguer: 90000, alugUn: "Hora" } };
  const { detail } = B.computeBaremCost("EQUIPAMENTO", item, CTX);
  close(detail.custoH, 90000, "custo/hora");
});

test("EQ-08 Betoneira a gasolina: usa o preço da gasolina", () => {
  const item = {
    name: "Betoneira 350 L",
    ownership: "Próprio",
    fields: { aq: 1600000, vida: 5000, man: 120, lh: 1, tipo: "Gasolina", lub: 20 },
  };
  const { detail } = B.computeBaremCost("EQUIPAMENTO", item, CTX);
  close(detail.precoL, 300, "preço da gasolina");
  close(detail.combH, 300, "combustível/h");
  close(detail.custoH, 1600000 / 5000 + 120 + 20 + 300, "custo/hora");
});

test("EQ: preço específico por litro tem prioridade sobre o tipo de combustível", () => {
  const item = { name: "X", ownership: "Alugado", fields: { aluguer: 8, alugUn: "Hora", lh: 1, tipo: "Gasóleo", esp: 555 } };
  const { detail } = B.computeBaremCost("EQUIPAMENTO", item, CTX);
  close(detail.precoL, 555, "preço específico");
});

// ───────────────────────── VIATURA ─────────────────────────

test("VI-01 Pick-up 4x4: custo/km e custo/dia", () => {
  const item = {
    name: "Pick-up 4x4 cabine dupla",
    fields: { cons: 12, comb: "Gasóleo", man: 45, pneus: 20, seg: 450000, dep: 520000, outros: 40000 },
  };
  const { computedCost, detail } = B.computeBaremCost("VIATURA", item, CTX);

  close(detail.combKm, 48, "combustível/km");
  close(detail.km, 48 + 45 + 20, "custo/km");
  close(detail.km, 113, "custo/km (valor absoluto)");
  // dia = (seguro anual / 12 + depreciação mensal + motorista + outros) / dias úteis do mês
  close(detail.dia, (450000 / 12 + 520000 + 40000) / 22, "custo/dia");
  close(detail.dia, 27159.090909090908, "custo/dia (valor absoluto)", 1e-9);
  close(detail.mes, 597500, "custo/mês");
  close(computedCost, detail.dia, "computedCost = custo/dia");
});

test("VI-02 Camião com grua: motorista mensal entra no custo/dia", () => {
  const item = {
    name: "Camião 10 t com grua",
    fields: { cons: 30, comb: "Gasóleo", man: 120, pneus: 60, seg: 1200000, dep: 1300000, mot: 300000, outros: 80000 },
  };
  const { detail } = B.computeBaremCost("VIATURA", item, CTX);
  close(detail.km, 30 / 100 * 400 + 120 + 60, "custo/km");
  close(detail.dia, (1200000 / 12 + 1300000 + 300000 + 80000) / 22, "custo/dia");
});

test("VI-04 Viatura a gasolina: custo/km com o preço da gasolina", () => {
  const item = { name: "Viatura ligeira (direção)", fields: { cons: 9, comb: "Gasolina", man: 35, pneus: 15 } };
  const { detail } = B.computeBaremCost("VIATURA", item, CTX);
  close(detail.combKm, 27, "combustível/km");
  close(detail.km, 77, "custo/km");
});

// ───────────────────────── FERRAMENTA ─────────────────────────

test("FE-01 Kit eletricista (unidade dia): aquisição/vida útil + manutenção + consumíveis", () => {
  const item = {
    name: "Kit ferramentas eletricista (por equipa)",
    unit: "dia",
    fields: { tipo: "Kit equipa", aq: 650000, vida: 365, man: 200, cons: 300 },
  };
  const { computedCost, detail } = B.computeBaremCost("FERRAMENTA", item, CTX);
  close(detail.dia, 650000 / 365 + 200 + 300, "custo/dia");
  close(detail.dia, 2280.821917808219, "custo/dia (valor absoluto)", 1e-9);
  close(detail.hora, detail.dia / 8, "custo/hora");
  close(detail.equipa, detail.dia, "kit de equipa: custo por equipa/dia = custo/dia");
  close(computedCost, detail.dia, "computedCost = custo unitário (dia)");
});

test("FE-03 Ferramentas elétricas: não é kit de equipa, custo/equipa fica a zero", () => {
  const item = { name: "Ferramentas elétricas", unit: "dia", fields: { tipo: "Elétrica", aq: 520000, vida: 540, man: 250, cons: 0 } };
  const { detail } = B.computeBaremCost("FERRAMENTA", item, CTX);
  close(detail.equipa, 0, "custo/equipa/dia");
  close(detail.dia, 520000 / 540 + 250, "custo/dia");
});

test("FE-08 Consumível (unidade un): o custo é o preço por unidade", () => {
  const item = { name: "Discos de corte/rebarbar", unit: "un", fields: { tipo: "Consumível", aq: 1900 } };
  const { computedCost, detail } = B.computeBaremCost("FERRAMENTA", item, CTX);
  assert.equal(detail.dia, 0, "unidade «un» não tem custo por dia");
  assert.equal(computedCost, 1900);
});

// ───────────────────────── LOGISTICA ─────────────────────────

test("LO-01 Mobilização: usa o custo unitário escrito", () => {
  const r = B.computeBaremCost("LOGISTICA", { name: "Mobilização de estaleiro", unit: "vg", fields: { custo: 1800000 } }, CTX);
  assert.equal(r.computedCost, 1800000);
});

test("LO-10 Gasóleo de estaleiro: ligado ao preço do combustível, ignora o custo escrito", () => {
  const r = B.computeBaremCost(
    "LOGISTICA",
    { name: "Gasóleo (estaleiro)", unit: "L", fields: { custo: 999999, link: "Gasóleo" } },
    CTX
  );
  assert.equal(r.computedCost, 400, "segue a tabela de combustíveis");
});

test("LOGISTICA ligada a um combustível que não existe: custo zero", () => {
  const r = B.computeBaremCost("LOGISTICA", { name: "X", fields: { link: "Querosene" } }, CTX);
  assert.equal(r.computedCost, 0);
});

// ───────────────────────── parâmetros de cálculo ─────────────────────────

test("alterar dias úteis/mês e horas/dia muda os custos derivados", () => {
  const item = { name: "Engenheiro", fields: { mensal: 1320000, enc: 0 } };
  const a = B.computeBaremCost("RH", item, { ...CTX, diasMes: 22, horasDia: 8 });
  const b = B.computeBaremCost("RH", item, { ...CTX, diasMes: 20, horasDia: 10 });
  close(a.detail.dia, 60000, "22 dias");
  close(b.detail.dia, 66000, "20 dias");
  close(b.detail.hora, 6600, "66000 / 10 h");
});

test("contexto vazio cai nos valores por omissão (8 h, 22 dias, 1800 h/ano)", () => {
  const item = { name: "X", fields: { mensal: 2200 } };
  const r = B.computeBaremCost("RH", item, {});
  close(r.detail.dia, 100, "2200 / 22");
  close(r.detail.hora, 12.5, "100 / 8");
});

// ───────────────────────── estado de validade ─────────────────────────

test("estado: dentro da validade é Atualizado", () => {
  const s = B.computeBaremStatus(
    "RH",
    { name: "Engenheiro", priceDate: "2026-08-31", fields: { mensal: 1 } },
    CTX,
    HOJE
  );
  assert.equal(s.code, "OK");
  assert.equal(s.severity, "good");
});

test("estado: barém com mais de 180 dias fica Desatualizado", () => {
  const s = B.computeBaremStatus(
    "RH",
    { name: "Topógrafo", priceDate: "2025-11-15", fields: { mensal: 560000 } },
    CTX,
    HOJE
  );
  assert.equal(s.code, "DESATUALIZADO");
  assert.equal(s.severity, "warn");
});

test("estado: combustível usa a validade própria (30 dias), não a dos baremes", () => {
  const item = { name: "Gasóleo", priceDate: "2026-09-30", fields: { preco: 400 } };
  // 50 dias depois: dentro dos 180 dos baremes, mas fora dos 30 dos combustíveis
  assert.equal(B.computeBaremStatus("COMBUSTIVEL", item, CTX, HOJE).code, "DESATUALIZADO");
  assert.equal(B.computeBaremStatus("RH", { ...item, fields: { mensal: 1 } }, CTX, HOJE).code, "OK");
});

test("estado: sem data de preço fica Sem data", () => {
  const s = B.computeBaremStatus("RH", { name: "X", fields: { mensal: 1 } }, CTX, HOJE);
  assert.equal(s.code, "SEM_DATA");
});

test("estado: equipamento próprio sem depreciação é marcado antes da validade", () => {
  const s = B.computeBaremStatus(
    "EQUIPAMENTO",
    { name: "Escavadora", ownership: "Próprio", priceDate: "2026-11-01", fields: { man: 3000 } },
    CTX,
    HOJE
  );
  assert.equal(s.code, "SEM_DEPRECIACAO");
  assert.equal(s.severity, "bad");
});

test("estado: equipamento alugado sem preço de aluguer", () => {
  const s = B.computeBaremStatus(
    "EQUIPAMENTO",
    { name: "Autogrua", ownership: "Alugado", priceDate: "2026-11-01", fields: {} },
    CTX,
    HOJE
  );
  assert.equal(s.code, "SEM_PRECO_ALUGUER");
});

test("estado: sem nome", () => {
  assert.equal(B.computeBaremStatus("RH", { name: "  ", fields: {} }, CTX, HOJE).code, "SEM_NOME");
});

// ───────────────────────── validação ─────────────────────────

test("validação: equipamento próprio nunca pode ficar com custo zero", () => {
  const errs = B.validateBarem("EQUIPAMENTO", { name: "Escavadora", ownership: "Próprio", fields: { man: 100 } });
  assert.ok(errs.some((e) => /valor de aquisição e a vida útil/i.test(e)), errs.join(" | "));
});

test("validação: equipamento próprio com aquisição e vida útil passa", () => {
  const errs = B.validateBarem("EQUIPAMENTO", {
    name: "Escavadora",
    ownership: "Próprio",
    fields: { aq: 1000, vida: 100 },
  });
  assert.deepEqual(errs, []);
});

test("validação: equipamento alugado exige o valor do aluguer", () => {
  const errs = B.validateBarem("EQUIPAMENTO", { name: "Autogrua", ownership: "Alugado", fields: {} });
  assert.ok(errs.some((e) => /valor do aluguer/i.test(e)), errs.join(" | "));
});

test("validação: ferramenta exige unidade de custo válida", () => {
  const errs = B.validateBarem("FERRAMENTA", { name: "Kit", unit: "mês", fields: { aq: 10 } });
  assert.ok(errs.some((e) => /unidade de custo/i.test(e)), errs.join(" | "));
});

test("validação: ferramenta por dia sem vida útil nem manutenção avisa do custo zero", () => {
  const errs = B.validateBarem("FERRAMENTA", { name: "Kit", unit: "dia", fields: { aq: 10 } });
  assert.ok(errs.some((e) => /custo fica a zero/i.test(e)), errs.join(" | "));
});

test("validação: logística exige custo ou ligação a combustível", () => {
  assert.ok(B.validateBarem("LOGISTICA", { name: "Água", fields: {} }).length > 0);
  assert.deepEqual(B.validateBarem("LOGISTICA", { name: "Água", fields: { custo: 6000 } }), []);
  assert.deepEqual(B.validateBarem("LOGISTICA", { name: "Gasóleo", fields: { link: "Gasóleo" } }), []);
});

test("validação: nome obrigatório e tipo desconhecido", () => {
  assert.ok(B.validateBarem("RH", { name: "", fields: { mensal: 1 } }).some((e) => /nome/i.test(e)));
  assert.ok(B.validateBarem("XPTO", { name: "A" }).some((e) => /desconhecido/i.test(e)));
});

// ───────────────────────── auxiliares ─────────────────────────

test("buildFuelPrices: constrói o mapa a partir das linhas de combustível", () => {
  const rows = [
    { kind: "COMBUSTIVEL", name: "Gasóleo", fields: { preco: 400 } },
    { kind: "COMBUSTIVEL", name: "Gasolina", fields: { preco: 300 } },
    { kind: "COMBUSTIVEL", name: "Gasóleo", fields: { preco: 999 } }, // repetido: fica o primeiro
    { kind: "RH", name: "Engenheiro", fields: { mensal: 1 } },
  ];
  assert.deepEqual(B.buildFuelPrices(rows), { "Gasóleo": 400, Gasolina: 300 });
});

test("decorateBarem: junta custo calculado, estado e detalhe ao registo", () => {
  const row = {
    id: "x",
    kind: "RH",
    name: "Engenheiro",
    unit: null,
    ownership: null,
    priceDate: "2026-08-31",
    fields: { mensal: 1350000, enc: 0.25, seg: 600 },
  };
  const d = B.decorateBarem(row, CTX, HOJE);
  close(d.computedCost, (1350000 / 22) * 1.25 + 600, "custo");
  assert.equal(d.status, "OK");
  assert.equal(d.statusLabel, "Atualizado");
  assert.ok(d.detail.hEnc > 0);
});

test("decorateBarem: tipo inválido não rebenta, devolve custo zero", () => {
  const d = B.decorateBarem({ kind: "XPTO", name: "A", fields: {} }, CTX, HOJE);
  assert.equal(d.computedCost, 0);
});

test("N(): trata vazios, nulos e texto como zero", () => {
  assert.equal(B.N(null), 0);
  assert.equal(B.N(undefined), 0);
  assert.equal(B.N(""), 0);
  assert.equal(B.N("abc"), 0);
  assert.equal(B.N("12.5"), 12.5);
  assert.equal(B.N(7), 7);
});

// ───────── o espelho do frontend tem de dar exatamente o mesmo ─────────

test("o espelho do frontend (baremFormulas.js) dá os mesmos resultados", async () => {
  const mirrorPath = path.resolve(__dirname, "../../frontend/src/shared/comercial/baremFormulas.js");
  const M = await import(pathToFileURL(mirrorPath).href);

  const CASOS = [
    ["COMBUSTIVEL", { name: "Gasóleo", fields: { preco: 400 } }],
    ["COMBUSTIVEL", { name: "X", fields: {} }],
    ["RH", { name: "Engenheiro", fields: { mensal: 1350000, enc: 0.25, seg: 600, alim: 3500, aloj: 7500, transp: 1500 } }],
    ["RH", { name: "Servente", fields: { mensal: 130000, enc: 0.25, seg: 350, alim: 3500, aloj: 7500, transp: 1500 } }],
    ["RH", { name: "X", fields: {} }],
    ["EQUIPAMENTO", { name: "Retro", ownership: "Próprio", fields: { aq: 98000000, vida: 10000, man: 3000, lh: 8, tipo: "Gasóleo", lub: 500, pneus: 1000, oper: 2450, seguro: 1400000 } }],
    ["EQUIPAMENTO", { name: "Autogrua", ownership: "Alugado", fields: { aluguer: 650000, lh: 14, tipo: "Gasóleo" } }],
    ["EQUIPAMENTO", { name: "Hora", ownership: "Alugado", fields: { aluguer: 90000, alugUn: "Hora" } }],
    ["EQUIPAMENTO", { name: "Esp", ownership: "Próprio", fields: { aq: 10, vida: 1, lh: 2, esp: 555 } }],
    ["VIATURA", { name: "Pick-up", fields: { cons: 12, comb: "Gasóleo", man: 45, pneus: 20, seg: 450000, dep: 520000, outros: 40000 } }],
    ["VIATURA", { name: "Ligeira", fields: { cons: 9, comb: "Gasolina", man: 35, pneus: 15 } }],
    ["VIATURA", { name: "Vazia", fields: {} }],
    ["FERRAMENTA", { name: "Kit", unit: "dia", fields: { tipo: "Kit equipa", aq: 650000, vida: 365, man: 200, cons: 300 } }],
    ["FERRAMENTA", { name: "Disco", unit: "un", fields: { tipo: "Consumível", aq: 1900 } }],
    ["FERRAMENTA", { name: "Sem vida", unit: "dia", fields: { aq: 100, man: 5 } }],
    ["LOGISTICA", { name: "Mobilização", unit: "vg", fields: { custo: 1800000 } }],
    ["LOGISTICA", { name: "Gasóleo estaleiro", unit: "L", fields: { custo: 999, link: "Gasóleo" } }],
    ["LOGISTICA", { name: "Vazia", fields: {} }],
  ];

  const CTXS = [CTX, { ...CTX, horasDia: 10, diasMes: 20, horasAnoEquip: 2000 }, {}];

  for (const ctx of CTXS) {
    for (const [kind, item] of CASOS) {
      const a = B.computeBaremCost(kind, item, ctx);
      const b = M.computeBaremCost(kind, item, ctx);
      assert.deepEqual(b, a, `custo divergente em ${kind} / ${item.name}`);

      const sa = B.computeBaremStatus(kind, item, ctx, HOJE);
      const sb = M.computeBaremStatus(kind, item, ctx, HOJE);
      assert.deepEqual(sb, sa, `estado divergente em ${kind} / ${item.name}`);
    }
  }

  // Auxiliares partilhados
  assert.equal(M.N("12.5"), B.N("12.5"));
  assert.equal(M.daysSince("2026-08-31", HOJE), B.daysSince("2026-08-31", HOJE));
  assert.deepEqual(
    M.buildFuelPrices([{ kind: "COMBUSTIVEL", name: "Gasóleo", fields: { preco: 400 } }]),
    B.buildFuelPrices([{ kind: "COMBUSTIVEL", name: "Gasóleo", fields: { preco: 400 } }])
  );
  assert.deepEqual(M.BAREM_KINDS, B.BAREM_KINDS);
});
