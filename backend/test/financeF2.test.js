const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { buildClientAccounts, clientStatement, aging } = require("../src/services/finance/clientAccounts");
const { paidOutflows, flowRecords } = require("../src/services/finance/flows");
const { treasurySummary, lastMonths } = require("../src/services/finance/treasury");
const { costCenterSummary } = require("../src/services/finance/costCenters");
const { dscLines, DSC_ENCARGO } = require("../src/services/finance/dsc");

/**
 * Fase F-2 do alinhamento do Financeiro com o protótipo: R4 Conta Corrente de
 * Clientes, T1 Contas e Saldos, F2 Mapa de Fluxos, T8 Mapa de Fluxo de Caixa,
 * RG8 Centros de Custo e P3 Despesas sem Comprovativo.
 */
const core = () =>
  import(pathToFileURL(path.join(__dirname, "../../frontend/src/shared/finance/fluxosCore.js")).href);

const HOJE = "2026-11-23";

// ═══ R4 Conta Corrente de Clientes ═════════════════════════════════════════

const fatura = (over = {}) => ({
  id: "f1",
  docNumber: "FT 1",
  docDate: "2026-09-01T00:00:00.000Z",
  due: "2026-10-01T00:00:00.000Z",
  net: 1000,
  received: 0,
  currency: "AOA",
  client: { id: "c1", name: "Omatapalo" },
  project: { code: "OBR-1", name: "Kwawa", currency: "AOA" },
  receipts: [],
  ...over,
});

test("R4 · a antiguidade conta-se pelo vencimento", () => {
  const a = aging(
    [
      { ab: 10, venc: "2026-12-01" },
      { ab: 20, venc: "2026-11-10" },
      { ab: 30, venc: "2026-10-10" },
      { ab: 40, venc: "2026-09-10" },
      { ab: 50, venc: "2026-01-01" },
      { ab: 60, venc: null },
    ],
    HOJE
  );
  assert.deepEqual(
    { av: a.av, b1: a.b1, b2: a.b2, b3: a.b3, b4: a.b4, sd: a.sd, atr: a.atr },
    { av: 10, b1: 20, b2: 30, b3: 40, b4: 50, sd: 60, atr: 140 }
  );
});

test("R4 · vencer hoje ainda não é atraso", () => {
  assert.equal(aging([{ ab: 5, venc: HOJE }], HOJE).av, 5);
});

test("R4 · o saldo do cliente é o que falta receber das faturas", () => {
  const { clientes, totais } = buildClientAccounts([fatura(), fatura({ id: "f2", net: 500, received: 200 })], HOJE);
  assert.equal(clientes.length, 1);
  assert.equal(clientes[0].saldo, 1300);
  assert.equal(clientes[0].fat, 1500);
  assert.equal(totais.porReceber, 1300);
});

test("R4 · o recebido a mais abate primeiro a fatura que vence primeiro", () => {
  const { clientes } = buildClientAccounts(
    [
      fatura({ id: "a", net: 1000, received: 1300 }), // 300 a mais
      fatura({ id: "b", net: 500, due: "2026-12-30T00:00:00.000Z" }),
      fatura({ id: "c", net: 200, due: "2026-08-01T00:00:00.000Z" }),
    ],
    HOJE
  );
  const c = clientes[0];
  assert.equal(c.saldo, 400, "700 em aberto − 300 recebidos a mais");
  assert.equal(c.ag.b4, 0, "a de agosto (+90 d) foi a primeira a ser abatida");
  assert.equal(c.ag.av, 400);
});

test("R4 · o que sobra depois de abater tudo é crédito do cliente", () => {
  const { clientes, totais } = buildClientAccounts([fatura({ net: 1000, received: 1250 })], HOJE);
  assert.equal(clientes[0].saldo, -250);
  assert.equal(totais.credito, 250);
  assert.equal(totais.comCredito, 1);
});

test("R4 · moedas diferentes não se somam: uma de cada vez", () => {
  const inv = [fatura(), fatura({ id: "u", currency: "USD", net: 9, client: { id: "c2", name: "Mitrelli" } })];
  const aoa = buildClientAccounts(inv, HOJE);
  const usd = buildClientAccounts(inv, HOJE, "usd");
  assert.deepEqual(aoa.clientes.map((c) => c.nome), ["Omatapalo"]);
  assert.deepEqual(usd.clientes.map((c) => c.nome), ["Mitrelli"]);
  assert.deepEqual(aoa.moedas, ["AOA", "USD"]);
});

test("R4 · sem cliente registado agrupa pelo nome", () => {
  const { clientes } = buildClientAccounts([fatura({ client: { id: null, name: "Avulso" } })], HOJE);
  assert.equal(clientes[0].id, null);
  assert.equal(clientes[0].nome, "Avulso");
});

test("R4 · o último recebimento é a data mais recente", () => {
  const { clientes } = buildClientAccounts(
    [
      fatura({
        received: 600,
        receipts: [
          { amount: 100, receivedDate: "2026-10-05T00:00:00.000Z" },
          { amount: 500, receivedDate: "2026-11-02T00:00:00.000Z" },
        ],
      }),
    ],
    HOJE
  );
  assert.equal(clientes[0].ult, "2026-11-02");
  assert.equal(clientes[0].rec, 600);
});

test("R4 · o extrato põe faturas a débito, recebimentos a crédito e corre o saldo", () => {
  const L = clientStatement(
    [
      fatura({ received: 400, receipts: [{ amount: 400, receivedDate: "2026-09-20T00:00:00.000Z", method: "TRF" }] }),
      fatura({ id: "f2", docNumber: "FT 2", docDate: "2026-11-01T00:00:00.000Z", due: "2026-12-01T00:00:00.000Z", net: 300 }),
    ],
    "c1",
    HOJE
  );
  assert.deepEqual(L.map((l) => [l.tipo, l.deb, l.cred, l.saldo]), [
    ["FT", 1000, 0, 1000],
    ["RC", 0, 400, 600],
    ["FT", 300, 0, 900],
  ]);
  assert.equal(L[0].situacao, "atraso");
  assert.equal(L[0].atraso, 53);
  assert.equal(L[2].situacao, "aberto");
});

test("R4 · fatura totalmente recebida fica liquidada", () => {
  const [l] = clientStatement([fatura({ received: 1000 })], "c1", HOJE);
  assert.equal(l.situacao, "liquidada");
});

// ═══ Fluxos (F2 e T8) ═══════════════════════════════════════════════════════

test("Fluxos · o consumo de stock não é saída de caixa", () => {
  assert.deepEqual(paidOutflows([{ source: "CONSUMO_STOCK", paidAmount: 100, date: "2026-11-01" }]), []);
});

test("Fluxos · a compra de mercadoria sai pelo valor do stock", () => {
  const [x] = paidOutflows([{ source: "PAGAMENTO", kind: "STOCK", stockValue: 70, paidAmount: 0, date: "2026-11-01" }]);
  assert.equal(x.valor, 70);
});

test("Fluxos · a saída conta na data da liquidação, sem ela na do documento", () => {
  const [a, b] = paidOutflows([
    { source: "PAGAMENTO", paidAmount: 10, paidAt: "2026-11-05", date: "2026-10-01" },
    { source: "PAGAMENTO", paidAmount: 10, date: "2026-10-01" },
  ]);
  assert.equal(a.data, "2026-11-05");
  assert.equal(b.data, "2026-10-01");
});

test("Fluxos · o que não foi pago não sai", () => {
  assert.deepEqual(paidOutflows([{ source: "PAGAMENTO", paidAmount: 0, date: "2026-11-01" }]), []);
});

test("Fluxos · cada registo leva a moeda, e a resposta diz as moedas que há", () => {
  const { registos, moedas } = flowRecords({
    receipts: [{ amount: 50, receivedDate: "2026-11-01", invoice: { docNumber: "FT 1", client: { name: "GPN" }, project: { code: "O", name: "N", currency: "AOA" } } }],
    ledgerItems: [{ source: "LANCAMENTO", sourceLabel: "Lançamento de Obra", paidAmount: 32000, currency: "USD", date: "2026-05-25", description: "Gerador" }],
    calendarItems: [{ lado: "P", data: "2026-12-01", valor: 7, moeda: "AOA", estado: "abe", entidade: "NewCom", grupo: "Pagamento / Cotação", doc: "FT 9" }],
  });
  assert.deepEqual(moedas, ["AOA", "USD"]);
  assert.deepEqual(registos.map((r) => [r.lado, r.tipo, r.moeda]), [
    ["R", "real", "AOA"],
    ["P", "real", "USD"],
    ["P", "comp", "AOA"],
  ]);
});

test("Fluxos · recebimentos agrupam por cliente, pagamentos pela origem", () => {
  const { registos } = flowRecords({
    receipts: [{ amount: 1, receivedDate: "2026-11-01", invoice: { client: { name: "GPN" }, project: { code: "O", name: "Bela Vista", currency: "AOA" } } }],
    ledgerItems: [],
    calendarItems: [
      { lado: "R", data: "2026-12-01", valor: 2, moeda: "AOA", estado: "prev", entidade: "GPN", sub: "O · Bela Vista", grupo: "Previstos" },
      { lado: "P", data: "2026-12-01", valor: 3, moeda: "AOA", estado: "abe", entidade: "NewCom", grupo: "Pagamento / Cotação" },
    ],
  });
  assert.equal(registos[0].grupo, "GPN");
  assert.equal(registos[1].grupo, "GPN", "o previsto do mesmo cliente cai na mesma linha");
  assert.equal(registos[1].tipo, "prev");
  assert.equal(registos[2].grupo, "Pagamento / Cotação");
  assert.equal(registos[2].sub, "NewCom");
});

const reg = (over) => ({ lado: "R", data: "2026-11-10", valor: 100, moeda: "AOA", tipo: "real", grupo: "GPN", sub: "Obra", ...over });

test("F2 · soma por mês e por grupo, com o saldo e o acumulado", async () => {
  const { mapaFluxos } = await core();
  const C = mapaFluxos(
    [reg(), reg({ data: "2026-12-05", valor: 50 }), reg({ lado: "P", grupo: "Compras", sub: "NewCom", valor: 30 })],
    { per: "M", ano: "2026", modo: "tudo", moeda: "AOA" },
    HOJE
  );
  assert.equal(C.R.T["2026-11"], 100);
  assert.equal(C.R.T.t, 150);
  assert.equal(C.P.T["2026-11"], 30);
  const nov = C.saldos.find((s) => s.k === "2026-11");
  const dez = C.saldos.find((s) => s.k === "2026-12");
  assert.equal(nov.s, 70);
  assert.equal(dez.ac, 120);
  assert.equal(C.R.G[0].S[0].k, "Obra");
});

test("F2 · só realizado e só compromissos", async () => {
  const { mapaFluxos } = await core();
  const R = [reg(), reg({ tipo: "comp", valor: 40 }), reg({ tipo: "prev", valor: 7 })];
  const F = { per: "M", ano: "2026", moeda: "AOA" };
  assert.equal(mapaFluxos(R, { ...F, modo: "real" }, HOJE).tR, 100);
  assert.equal(mapaFluxos(R, { ...F, modo: "comp" }, HOJE).tR, 40);
  assert.equal(mapaFluxos(R, { ...F, modo: "tudo" }, HOJE).tR, 147);
});

test("F2 · uma moeda de cada vez", async () => {
  const { mapaFluxos } = await core();
  const C = mapaFluxos([reg(), reg({ moeda: "USD", valor: 9 })], { per: "M", ano: "2026", modo: "tudo", moeda: "USD" }, HOJE);
  assert.equal(C.tR, 9);
});

test("F2 · por semana são doze, quatro para trás", async () => {
  const { periodosF2 } = await core();
  const K = periodosF2({ per: "S", ano: "2026", hoje: HOJE });
  assert.equal(K.length, 12);
  assert.equal(K[4], "2026-11-23");
});

test("T8 · o saldo do primeiro mês é o de hoje menos o realizado desde então", async () => {
  const { mapaCaixa } = await core();
  // hoje há 1000; desde 1 de agosto entraram 300 e saíram 100.
  const C = mapaCaixa(
    [reg({ data: "2026-09-10", valor: 300 }), reg({ lado: "P", data: "2026-10-02", valor: 100, grupo: "Compras" })],
    { ini: -3, n: 12, vis: "tudo", moeda: "AOA" },
    HOJE,
    1000
  );
  assert.equal(C.M[0], "2026-08");
  assert.equal(C.ini[0], 800);
  assert.equal(C.fim[C.M.indexOf("2026-11")], 1000, "chega a hoje com o saldo das contas");
});

test("T8 · o que já venceu e continua por pagar conta no mês atual", async () => {
  const { mapaCaixa } = await core();
  const C = mapaCaixa([reg({ lado: "P", tipo: "comp", data: "2026-07-01", valor: 250, grupo: "Compras" })], { ini: -3, n: 12, vis: "tudo", moeda: "AOA" }, HOJE, 0);
  assert.equal(C.atrS, 250);
  assert.equal(C.totS[C.M.indexOf("2026-11")], 250);
});

test("T8 · o realizado não aparece nos meses futuros, e o previsto não entra nos passados", async () => {
  const { mapaCaixa } = await core();
  const C = mapaCaixa(
    [reg({ data: "2027-01-10", valor: 5 }), reg({ tipo: "comp", data: "2026-12-10", valor: 7 })],
    { ini: -3, n: 12, vis: "tudo", moeda: "AOA" },
    HOJE,
    0
  );
  assert.equal(C.totE[C.M.indexOf("2027-01")], 0);
  assert.equal(C.totE[C.M.indexOf("2026-12")], 7);
});

test("T8 · o auto por faturar não é dívida vencida do cliente", async () => {
  const { mapaCaixa } = await core();
  const C = mapaCaixa(
    [reg({ tipo: "prev", data: "2026-09-01", valor: 900 }), reg({ tipo: "comp", data: "2026-10-01", valor: 40 })],
    { ini: -3, n: 12, vis: "tudo", moeda: "AOA" },
    HOJE,
    0
  );
  assert.equal(C.atrE, 40, "só a fatura vencida");
  assert.equal(C.porFaturar, 900);
  assert.equal(C.totE[C.M.indexOf("2026-11")], 940, "os dois contam como entrada esperada no mês atual");
});

test("T8 · avisa o primeiro mês com saldo negativo", async () => {
  const { mapaCaixa } = await core();
  const C = mapaCaixa([reg({ lado: "P", tipo: "comp", data: "2027-02-01", valor: 500, grupo: "Compras" })], { ini: -3, n: 12, vis: "tudo", moeda: "AOA" }, HOJE, 100);
  assert.equal(C.negativo, "2027-02");
});

test("T8 · só realizado deixa de fora os compromissos", async () => {
  const { mapaCaixa } = await core();
  const C = mapaCaixa([reg({ tipo: "comp", data: "2026-12-10", valor: 7 })], { ini: -3, n: 12, vis: "real", moeda: "AOA" }, HOJE, 0);
  assert.equal(C.totE.reduce((s, x) => s + x, 0), 0);
});

// ═══ T1 Contas e Saldos ═════════════════════════════════════════════════════

const conta = (id, over = {}) => ({
  card: { id, label: `Conta ${id}`, bank: "BFA", lastDigits: "0001", type: "DEBITO" },
  balance: 1000,
  currency: "AOA",
  source: "EXTRATO",
  asOf: "2026-11-01T00:00:00.000Z",
  ...over,
});
const mov = (over) => ({ cardId: "a", direction: "SAIDA", amount: 100, movementDate: "2026-11-05T00:00:00.000Z", movementType: "PF", costAssigned: true, ...over });

test("T1 · as transferências internas não são entradas nem saídas", () => {
  const T = treasurySummary({
    contas: [conta("a")],
    movimentos: [mov(), mov({ movementType: "TRANSFERENCIA_INTERNA", amount: 900 }), mov({ direction: "ENTRADA", amount: 400, movementType: "RECEBIMENTO_CLIENTE" })],
    mes: "2026-11",
  });
  assert.equal(T.sa, 100);
  assert.equal(T.en, 400);
});

test("T1 · saldos agrupados por banco", () => {
  const T = treasurySummary({
    contas: [conta("a"), conta("b", { balance: 500 }), conta("c", { card: { id: "c", label: "C", bank: "BAI", type: "DEBITO" }, balance: 50 })],
    movimentos: [],
    mes: "2026-11",
  });
  assert.equal(T.saldo, 1550);
  assert.deepEqual(T.bancos.map((b) => [b.banco, b.saldo]), [["BFA", 1500], ["BAI", 50]]);
});

test("T1 · saída sem custo associado está por conciliar", () => {
  const T = treasurySummary({
    contas: [conta("a")],
    movimentos: [mov({ costAssigned: false }), mov(), mov({ costAssigned: false, movementType: "TRANSFERENCIA_INTERNA" })],
    mes: "2026-11",
  });
  assert.equal(T.porConciliar, 1);
});

test("T1 · cartão de crédito em negativo é dívida", () => {
  const T = treasurySummary({
    contas: [conta("a", { card: { id: "a", label: "Crédito", bank: "BFA", type: "CREDITO" }, balance: -300 })],
    movimentos: [],
    mes: "2026-11",
  });
  assert.equal(T.divida, 300);
});

test("T1 · uma moeda de cada vez", () => {
  const T = treasurySummary({ contas: [conta("a"), conta("u", { currency: "USD", balance: 7 })], movimentos: [], mes: "2026-11", moeda: "USD" });
  assert.equal(T.saldo, 7);
  assert.deepEqual(T.moedas, ["AOA", "USD"]);
});

test("T1 · saldo sem extrato fica marcado como estimado", () => {
  const T = treasurySummary({ contas: [conta("a", { source: "CARTAO" })], movimentos: [], mes: "2026-11" });
  assert.equal(T.estimado, true);
  assert.equal(T.bancos[0].contas[0].estimado, true);
});

test("T1 · os doze meses acabam no mês escolhido e atravessam o ano", () => {
  const K = lastMonths("2026-02");
  assert.equal(K.length, 12);
  assert.equal(K[0], "2025-03");
  assert.equal(K[11], "2026-02");
});

test("T1 · saídas do mês por tipo", () => {
  const T = treasurySummary({
    contas: [conta("a")],
    movimentos: [mov(), mov({ movementType: "LEVANTAMENTO_ATM", amount: 50 }), mov({ movementDate: "2026-10-01T00:00:00.000Z" })],
    mes: "2026-11",
  });
  assert.deepEqual(T.tipos, [
    { tipo: "Pagamento a fornecedor", valor: 100 },
    { tipo: "Levantamento ATM", valor: 50 },
  ]);
});

// ═══ RG8 Centros de Custo ═══════════════════════════════════════════════════

const centro = (id, over = {}) => ({ id, code: id.toUpperCase(), name: `Centro ${id}`, currency: "AOA", active: true, project: { id: "p1", code: "OBR-1", name: "Kwawa" }, ...over });
const lanc = (over) => ({ source: "PAGAMENTO", kind: "REALIZADO", paidBase: 100, paidAmount: 114, remaining: 0, costCenter: { id: "a" }, project: { id: "p1" }, ...over });

test("RG8 · realizado sem IVA, pago e por pagar por centro", () => {
  const R = costCenterSummary({
    centrosObra: [centro("a")],
    centrosGerais: [],
    ledgerItems: [lanc(), lanc({ kind: "COMPROMETIDO", paidBase: 0, paidAmount: 0, remaining: 50 })],
    custosGerais: { byCenter: [] },
    previsto: new Map(),
  });
  const a = R.linhas[0];
  assert.equal(a.realizado, 100);
  assert.equal(a.pago, 114);
  assert.equal(a.porPagar, 50);
  assert.equal(a.lancamentos, 2);
});

test("RG8 · a compra para armazém não é custo; o consumo é custo mas não é pagamento", () => {
  const R = costCenterSummary({
    centrosObra: [centro("a")],
    centrosGerais: [],
    ledgerItems: [lanc({ kind: "STOCK", paidBase: 0, paidAmount: 500 }), lanc({ source: "CONSUMO_STOCK", paidBase: 80, paidAmount: 80 })],
    custosGerais: { byCenter: [] },
    previsto: new Map(),
  });
  assert.equal(R.linhas[0].realizado, 80);
  assert.equal(R.linhas[0].pago, 500);
});

test("RG8 · o previsto só existe onde há orçamento adjudicado, e dá a execução", () => {
  const R = costCenterSummary({
    centrosObra: [centro("a"), centro("b")],
    centrosGerais: [],
    ledgerItems: [lanc({ paidBase: 250 })],
    custosGerais: { byCenter: [] },
    previsto: new Map([["a", 1000]]),
  });
  const a = R.linhas.find((l) => l.id === "a");
  const b = R.linhas.find((l) => l.id === "b");
  assert.equal(a.previsto, 1000);
  assert.equal(a.execucao, 0.25);
  assert.equal(b.previsto, null);
  assert.equal(b.execucao, null);
});

test("RG8 · custos com obra mas sem centro aparecem à parte", () => {
  const R = costCenterSummary({
    centrosObra: [centro("a")],
    centrosGerais: [],
    ledgerItems: [lanc({ costCenter: null, project: { id: "p9" } }), lanc({ costCenter: null, project: { id: "p8" }, paidBase: 50 })],
    custosGerais: { byCenter: [] },
    previsto: new Map(),
  });
  assert.equal(R.semCentro.length, 1);
  assert.equal(R.semCentro[0].moeda, "AOA");
  assert.equal(R.semCentro[0].lancamentos, 2);
  assert.equal(R.semCentro[0].obras, 2);
  assert.equal(R.semCentro[0].realizado, 150);
  assert.equal(R.linhas[0].realizado, 0);
});

test("RG8 · os custos sem centro separam-se por moeda — dólares não se somam a kwanzas", () => {
  const R = costCenterSummary({
    centrosObra: [],
    centrosGerais: [],
    ledgerItems: [
      lanc({ costCenter: null, project: { id: "p1" } }),
      lanc({ costCenter: null, project: { id: "s" }, currency: "USD", paidBase: 32000 }),
    ],
    custosGerais: { byCenter: [] },
    previsto: new Map(),
  });
  assert.deepEqual(R.semCentro.map((x) => [x.moeda, x.realizado]), [["AOA", 100], ["USD", 32000]]);
});

test("RG8 · os centros gerais vêm dos pedidos gerais", () => {
  const R = costCenterSummary({
    centrosObra: [],
    centrosGerais: [{ id: "g1", code: "SEDE", name: "Sede", active: true }],
    ledgerItems: [],
    custosGerais: { byCenter: [{ id: "g1", realized: 300, committed: 20 }] },
    previsto: new Map(),
  });
  assert.deepEqual([R.linhas[0].tipo, R.linhas[0].realizado, R.linhas[0].porPagar], ["GERAL", 300, 20]);
});

test("RG8 · os totais só somam kwanzas", () => {
  const R = costCenterSummary({
    centrosObra: [centro("a"), centro("u", { currency: "USD" })],
    centrosGerais: [],
    ledgerItems: [lanc(), lanc({ costCenter: { id: "u" }, paidBase: 9 })],
    custosGerais: { byCenter: [] },
    previsto: new Map(),
  });
  assert.equal(R.totais.realizado, 100);
  assert.equal(R.totais.noutraMoeda, 1);
});

// ═══ P3 Despesas sem Comprovativo ═══════════════════════════════════════════

const pedido = (over = {}) => ({
  id: "o1",
  number: "PC-1",
  status: "APROVADO",
  createdAt: "2026-11-10T00:00:00.000Z",
  supplier: { name: "Kitanda" },
  project: { code: "OBR-1", name: "Kwawa" },
  items: [
    { id: "i1", name: "Areia", quantity: 10, unitPrice: 100, docException: "DSC" },
    { id: "i2", name: "Pedra", quantity: 1, unitPrice: 300, docException: "AF" },
    { id: "i3", name: "Cimento", quantity: 1, unitPrice: 999, docException: null },
  ],
  ...over,
});

test("P3 · só entram as linhas DSC e AF", () => {
  const { linhas } = dscLines([pedido()]);
  assert.deepEqual(linhas.map((l) => [l.produto, l.marcado, l.decisao]), [["Areia", "DSC", null], ["Pedra", "AF", null]]);
});

test("P3 · sem decisão do financeiro, as linhas estão «por decidir»; a marca DSC já leva o encargo", () => {
  const { linhas, totais } = dscLines([pedido()]);
  assert.equal(DSC_ENCARGO, 0.25);
  assert.equal(linhas[0].encargo, 250);
  assert.equal(linhas[1].encargo, 0);
  assert.equal(totais.porDecidir, 1300);
  assert.equal(totais.nPorDecidir, 2);
  assert.equal(totais.dsc, 0);
});

test("P3 · decisões: mantém DSC (encargo), autofaturação e apareceu a fatura (sem encargo)", () => {
  const { linhas, totais } = dscLines([
    pedido({
      items: [
        { id: "a", name: "Areia", quantity: 10, unitPrice: 100, docException: "DSC", dscDecision: "DSC" },
        { id: "b", name: "Pedra", quantity: 1, unitPrice: 300, docException: "DSC", dscDecision: "AF" },
        { id: "c", name: "Tubo", quantity: 1, unitPrice: 50, docException: "DSC", dscDecision: "FATURA", dscDocPath: "finance/dsc/c/ft.pdf" },
      ],
    }),
  ]);
  assert.deepEqual(linhas.map((l) => l.encargo), [250, 0, 0]);
  assert.equal(totais.dsc, 1000);
  assert.equal(totais.dscCustoTotal, 1250);
  assert.equal(totais.af, 300);
  assert.equal(totais.fatura, 50);
  assert.equal(totais.nPorDecidir, 0);
  assert.equal(linhas[2].documento, "finance/dsc/c/ft.pdf");
});

test("P3 · o valor da linha é o do pedido, com IVA e retenção", () => {
  const { linhas } = dscLines([pedido({ items: [{ id: "i", name: "X", quantity: 1, unitPrice: 1000, vatPercent: 14, withholdingPercent: 6.5, docException: "DSC" }] })]);
  assert.equal(linhas[0].valor, 1075, "1000 + 140 − 65");
});

test("P3 · pedidos em rascunho, não aprovados ou cancelados não contam", () => {
  for (const status of ["RASCUNHO", "NAO_APROVADO", "CANCELADO"]) {
    assert.deepEqual(dscLines([pedido({ status })]).linhas, [], status);
  }
});

test("T1 tesRange: dia, mês, ano, 12 meses e intervalo; o período filtra as somas", () => {
  const { tesRange, treasurySummary } = require("../src/services/finance/treasury");
  const hoje = "2026-11-23";
  assert.deepEqual(tesRange({ p: "dia", d: "2026-03-04", hoje }), { p: "dia", de: "2026-03-04", ate: "2026-03-04", rotulo: "04/03/2026" });
  assert.equal(tesRange({ p: "mes", mes: "2026-02", hoje }).ate, "2026-02-28");
  assert.equal(tesRange({ p: "ano", ano: "2025", hoje }).rotulo, "Ano 2025");
  assert.equal(tesRange({ p: "12m", hoje }).de, "2025-12-01");
  assert.equal(tesRange({ p: "int", d1: "2026-01-10", d2: "2026-01-20", hoje }).rotulo, "10/01/2026 – 20/01/2026");
  const contas = [{ card: { id: "c1", bank: "BAI", label: "BAI 1", type: "DEBITO" }, balance: 100, currency: "AOA" }];
  const movimentos = [
    { cardId: "c1", direction: "ENTRADA", amount: 50, movementDate: "2026-01-15", movementType: "RECEBIMENTO_CLIENTE" },
    { cardId: "c1", direction: "SAIDA", amount: 20, movementDate: "2026-01-25", movementType: "PF" },
    { cardId: "c1", direction: "SAIDA", amount: 5, movementDate: "2026-01-15", movementType: "TRANSFERENCIA_INTERNA" },
  ];
  const r = treasurySummary({ contas, movimentos, periodo: tesRange({ p: "int", d1: "2026-01-10", d2: "2026-01-20", hoje }) });
  assert.equal(r.en, 50);
  assert.equal(r.sa, 0);
  const m = treasurySummary({ contas, movimentos, mes: "2026-01" });
  assert.equal(m.sa, 20);
  assert.equal(m.periodo.rotulo, "janeiro 2026");
});

test("T4 previsaoT4: atraso na 1.ª linha, comprometido vs previsto, «depois» e «sem data» fora dos saldos", async () => {
  const { previsaoT4, periodosT4 } = await core();
  const hoje = "2026-11-23"; // segunda-feira
  const S = periodosT4("S", hoje);
  assert.equal(S.length, 13);
  assert.equal(S[0].a, hoje);
  assert.equal(S[0].b, "2026-11-29");
  assert.equal(periodosT4("D", hoje).length, 31);
  const M = periodosT4("M", hoje);
  assert.equal(M[0].b, "2026-11-30");
  assert.equal(M[1].a, "2026-12-01");
  const reg = [
    { moeda: "AOA", lado: "R", tipo: "comp", data: "2026-11-10", valor: 100 }, // atraso
    { moeda: "AOA", lado: "P", tipo: "comp", data: "2026-11-20", valor: 30 }, // atraso
    { moeda: "AOA", lado: "P", tipo: "comp", data: "2026-11-25", valor: 50 },
    { moeda: "AOA", lado: "P", tipo: "prev", data: "2026-12-02", valor: 20 },
    { moeda: "AOA", lado: "R", tipo: "prev", data: "2027-12-01", valor: 999 }, // depois
    { moeda: "AOA", lado: "P", tipo: "comp", data: null, valor: 7 }, // sem data
    { moeda: "AOA", lado: "P", tipo: "real", data: "2026-11-24", valor: 500 }, // realizado: fora
    { moeda: "USD", lado: "P", tipo: "comp", data: "2026-11-25", valor: 9 }, // outra moeda
  ];
  const T = previsaoT4(reg, { g: "S", hoje, moeda: "AOA", saldoHoje: 1000 });
  assert.equal(T.linhas[0].en, 100);
  assert.equal(T.linhas[0].sc, 30);
  assert.equal(T.linhas[0].rp, 1070);
  assert.equal(T.linhas[1].sc, 50);
  assert.equal(T.linhas[1].rc, 920);
  assert.equal(T.comprometido, 80);
  assert.equal(T.entradas, 100);
  assert.equal(T.saidasPrevistas, 20);
  assert.equal(T.saldoFim, 1000);
  assert.equal(T.linhas.find((r) => r.k === "dep").en, 999);
  assert.equal(T.linhas.find((r) => r.k === "sd").sc, 7);
  assert.equal(T.negativo, null);
  const N = previsaoT4(reg, { g: "S", hoje, moeda: "AOA", saldoHoje: -60 }); // atraso: 10; esta semana: −40
  assert.equal(N.negativo, "Esta semana · 23/11 – 29/11");
});

test("RG8: centro geral com orçamento anual e tipo; subcustos por categoria", () => {
  const { costCenterSummary } = require("../src/services/finance/costCenters");
  const r = costCenterSummary({
    centrosObra: [{ id: "c1", code: "CC-1", name: "Material", currency: "AOA", project: { id: "p", code: "OBR", name: "X" } }],
    centrosGerais: [{ id: "g1", code: "FROTA", name: "Frota", active: true, kind: "FROTA", annualBudget: 1000, usos: 0 }],
    ledgerItems: [
      { costCenter: { id: "c1" }, project: { id: "p" }, kind: "REALIZADO", category: "GASTOS_PESSOAL", paidBase: 30, paidAmount: 30, remaining: 0 },
      { costCenter: { id: "c1" }, project: { id: "p" }, kind: "REALIZADO", category: "GASTOS_PESSOAL", paidBase: 20, paidAmount: 20, remaining: 0 },
      { costCenter: { id: "c1" }, project: { id: "p" }, kind: "STOCK", category: "MATERIAL", paidBase: 99, paidAmount: 99, remaining: 0 },
    ],
    custosGerais: { byCenter: [{ id: "g1", realized: 250, committed: 50 }] },
    previsto: new Map(),
    pedidosGerais: [
      { generalCostCenterId: "g1", amount: 200, paid: true, categoria: "Combustível" },
      { generalCostCenterId: "g1", amount: 50, paid: true, categoria: null },
      { generalCostCenterId: "g1", amount: 50, paid: false, categoria: "Pneus" },
    ],
  });
  const g = r.linhas.find((l) => l.id === "g1");
  assert.equal(g.natureza, "FROTA");
  assert.equal(g.previsto, 1000);
  assert.equal(g.execucao, 0.25);
  assert.equal(g.apagavel, true);
  assert.deepEqual(g.subs, [
    { k: "Combustível", n: 1, custo: 200 },
    { k: "Sem categoria", n: 1, custo: 50 },
  ]);
  const c = r.linhas.find((l) => l.id === "c1");
  assert.deepEqual(c.subs, [{ k: "Gastos pessoal", n: 2, custo: 50 }]);
});

test("P2/R3 calendário: atalhos de vencimento, só faturas / só previstos e filtro de cliente", async () => {
  const { buildCalendar, naJanela } = await import(
    require("node:url").pathToFileURL(require("node:path").join(__dirname, "../../frontend/src/shared/finance/calendarioCore.js")).href
  );
  const hoje = "2026-11-23"; // segunda-feira
  const it = (o) => ({ lado: "R", valor: 10, entidade: "A", grupo: "g", estado: "abe", ...o });
  const itens = [
    it({ data: "2026-11-10", estado: "atr" }),
    it({ data: "2026-11-25" }),
    it({ data: "2026-12-02", entidade: "B" }),
    it({ data: "2026-12-20", estado: "prev" }),
    it({ data: "2027-01-05" }),
  ];
  assert.equal(naJanela("sem", itens[1], hoje), true);
  assert.equal(naJanela("psem", itens[2], hoje), true);
  assert.equal(naJanela("atr", itens[0], hoje), true);
  const F = { per: "M", ano: "2026", prev: true, lado: "R" };
  const C = buildCalendar(itens, F, hoje);
  assert.deepEqual(C.contagens, { atr: 1, sem: 1, psem: 1, mes: 1, pmes: 2, "": 5 });
  assert.equal(buildCalendar(itens, { ...F, janela: "pmes" }, hoje).receber.n, 2);
  assert.equal(buildCalendar(itens, { ...F, janela: "", sel: "tudo", fonte: "prev" }, hoje).receber.n, 1);
  assert.equal(buildCalendar(itens, { ...F, sel: "tudo", fonte: "fat" }, hoje).receber.n, 4);
  assert.equal(buildCalendar(itens, { ...F, sel: "tudo", ent: "B" }, hoje).receber.n, 1);
  // Uma moeda de cada vez.
  const mix = [...itens, it({ data: "2026-11-26", moeda: "USD", valor: 7 })];
  assert.equal(buildCalendar(mix, { ...F, sel: "tudo", moeda: "AOA" }, hoje).receber.total, 50);
  assert.equal(buildCalendar(mix, { ...F, sel: "tudo", moeda: "USD" }, hoje).receber.total, 7);
});
