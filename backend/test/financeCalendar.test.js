const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const FCAL = require("../src/services/financeCalendarService");

/**
 * Calendário Financeiro (F1 / P2 / R2 do protótipo): o servidor junta as
 * fontes numa lista só, o ecrã agrupa por período. As duas metades testam-se
 * aqui — o núcleo do ecrã é um módulo do frontend, sem DOM.
 */
const core = () =>
  import(pathToFileURL(path.join(__dirname, "../../frontend/src/shared/finance/calendarioCore.js")).href);

const HOJE = "2026-11-23"; // segunda-feira

const pagavel = (over = {}) => ({
  id: "cp:1",
  stage: "A_PAGAR",
  payable: 1000,
  paidAmount: 0,
  dueDate: "2026-11-30T00:00:00.000Z",
  supplier: "NewCom",
  beneficiary: null,
  docNumber: "FT 12",
  description: "Fusíveis",
  shortDescription: null,
  sourceLabel: "Pagamento / Cotação",
  currency: "AOA",
  project: { code: "OBR-1", name: "Kwawa", client: { name: "Omatapalo" } },
  ...over,
});

const fatura = (over = {}) => ({
  id: "f1",
  missingAmount: 5000,
  receivedAmount: 0,
  effectiveDue: "2026-12-10T00:00:00.000Z",
  noDueDate: false,
  docNumber: "FT 2026/7",
  client: { name: "Governo Provincial do Namibe" },
  measurement: { reportNumber: "3" },
  project: { code: "OBR-2", name: "Bela Vista", currency: "AOA" },
  ...over,
});

// ─── Servidor: contas a pagar ──────────────────────────────────────────────

test("a conta a pagar entra pela data de vencimento, com o que falta pagar", () => {
  const [x] = FCAL.fromPayables([pagavel()], HOJE);
  assert.equal(x.lado, "P");
  assert.equal(x.data, "2026-11-30");
  assert.equal(x.valor, 1000);
  assert.equal(x.entidade, "NewCom");
  assert.equal(x.estado, "abe");
  assert.equal(x.grupo, "Pagamento / Cotação");
});

test("vencida e por pagar fica em atraso", () => {
  const [x] = FCAL.fromPayables([pagavel({ dueDate: "2026-11-01T00:00:00.000Z" })], HOJE);
  assert.equal(x.estado, "atr");
});

test("paga em parte fica parcial", () => {
  const [x] = FCAL.fromPayables([pagavel({ paidAmount: 300, payable: 700 })], HOJE);
  assert.equal(x.estado, "pp");
  assert.equal(x.valor, 700, "o valor é o que falta pagar");
});

test("um compromisso entra marcado como tal, mesmo vencido", () => {
  const [x] = FCAL.fromPayables([pagavel({ stage: "COMPROMISSO", dueDate: "2026-10-01T00:00:00.000Z" })], HOJE);
  assert.equal(x.estado, "comp");
});

test("o beneficiário do pedido manda sobre o fornecedor", () => {
  const [x] = FCAL.fromPayables([pagavel({ beneficiary: "Maria Silva" })], HOJE);
  assert.equal(x.entidade, "Maria Silva");
});

test("sem fornecedor nem beneficiário, diz que falta — o cliente da obra não é quem recebe", () => {
  const [x] = FCAL.fromPayables([pagavel({ supplier: null, beneficiary: null })], HOJE);
  assert.equal(x.entidade, "Sem beneficiário");
});

test("o que já está pago não entra", () => {
  assert.deepEqual(FCAL.fromPayables([pagavel({ payable: 0 })], HOJE), []);
});

test("sem vencimento a conta fica sem data — não se inventa uma", () => {
  const [x] = FCAL.fromPayables([pagavel({ dueDate: null })], HOJE);
  assert.equal(x.data, null);
  assert.equal(x.estado, "abe");
});

// ─── Servidor: faturas por receber ─────────────────────────────────────────

test("a fatura entra pelo vencimento efetivo, com o que falta receber", () => {
  const [x] = FCAL.fromReceivables([fatura()], HOJE);
  assert.equal(x.lado, "R");
  assert.equal(x.data, "2026-12-10");
  assert.equal(x.valor, 5000);
  assert.equal(x.entidade, "Governo Provincial do Namibe");
  assert.match(x.doc, /FT 2026\/7/);
  assert.match(x.doc, /AM 3/);
  assert.equal(x.grupo, "Faturas emitidas");
});

test("o vencimento estimado fica dito", () => {
  const [x] = FCAL.fromReceivables([fatura({ noDueDate: true })], HOJE);
  assert.equal(x.estimada, true);
});

test("fatura recebida em parte fica parcial; vencida, em atraso", () => {
  assert.equal(FCAL.fromReceivables([fatura({ receivedAmount: 100 })], HOJE)[0].estado, "pp");
  assert.equal(FCAL.fromReceivables([fatura({ effectiveDue: "2026-11-01T00:00:00.000Z" })], HOJE)[0].estado, "atr");
});

test("sem cliente na fatura, vale o da obra", () => {
  const [x] = FCAL.fromReceivables([fatura({ client: null, project: { code: "O", name: "N", client: { name: "Cliente da obra" } } })], HOJE);
  assert.equal(x.entidade, "Cliente da obra");
});

// ─── Servidor: previstos ───────────────────────────────────────────────────

test("o auto aprovado sem fatura entra como previsto, com a data estimada", () => {
  const [x] = FCAL.fromOpenMeasurements(
    [{ id: "a1", reportNumber: "4", reportDate: "2026-11-10T00:00:00.000Z", periodValTotal: "800000", project: { code: "OBR-2", name: "Bela Vista", client: { name: "GPN" } } }],
    HOJE,
    30
  );
  assert.equal(x.estado, "prev");
  assert.equal(x.estimada, true);
  assert.equal(x.data, "2026-12-10", "data do auto mais o prazo padrão");
  assert.equal(x.valor, 800000);
  assert.equal(x.grupo, "Previstos (autos ainda sem fatura)");
});

test("auto sem valor não entra", () => {
  assert.deepEqual(FCAL.fromOpenMeasurements([{ id: "a", reportNumber: "1", reportDate: "2026-11-10", periodValTotal: 0 }], HOJE, 30), []);
});

// ─── Ecrã: períodos ────────────────────────────────────────────────────────

test("por mês são os doze meses do ano escolhido", async () => {
  const { periodKeys } = await core();
  const k = periodKeys({ per: "M", ano: "2026", hoje: HOJE });
  assert.equal(k.length, 12);
  assert.equal(k[0], "2026-01");
  assert.equal(k[11], "2026-12");
});

test("por semana são doze semanas: duas para trás e nove para a frente", async () => {
  const { periodKeys } = await core();
  const k = periodKeys({ per: "S", ano: "2026", hoje: HOJE });
  assert.equal(k.length, 12);
  assert.equal(k[2], "2026-11-23", "a semana atual é a terceira");
  assert.equal(k[0], "2026-11-09");
});

test("a semana começa à segunda-feira", async () => {
  const { weekOf } = await core();
  assert.equal(weekOf("2026-11-29"), "2026-11-23", "domingo pertence à semana de segunda 23");
  assert.equal(weekOf("2026-11-23"), "2026-11-23");
});

test("o que cai fora dos períodos vai para Anteriores, Depois ou Sem data", async () => {
  const { periodOf, periodKeys } = await core();
  const k = periodKeys({ per: "M", ano: "2026", hoje: HOJE });
  assert.equal(periodOf("M", "2025-12-31", k), "ant");
  assert.equal(periodOf("M", "2027-01-01", k), "dep");
  assert.equal(periodOf("M", null, k), "sd");
  assert.equal(periodOf("M", "2026-11-30", k), "2026-11");
});

// ─── Ecrã: totais e filtros ────────────────────────────────────────────────

const itens = () => [
  ...FCAL.fromPayables([pagavel(), pagavel({ id: "cp:2", dueDate: "2026-11-01T00:00:00.000Z", payable: 400, supplier: "Karam", description: "Cabo ACSR" })], HOJE),
  ...FCAL.fromReceivables([fatura()], HOJE),
  ...FCAL.fromOpenMeasurements(
    [{ id: "a1", reportNumber: "4", reportDate: "2026-11-10T00:00:00.000Z", periodValTotal: 800, project: { code: "O", name: "N", client: { name: "GPN" } } }],
    HOJE,
    30
  ),
];

const F0 = { per: "M", ano: "2026", lado: "", prev: true, q: "", sel: null };

test("cada período soma o que há a receber, a pagar, o saldo e os atrasos", async () => {
  const { buildCalendar } = await core();
  const C = buildCalendar(itens(), F0, HOJE);
  const nov = C.periodos.find((p) => p.k === "2026-11");
  const dez = C.periodos.find((p) => p.k === "2026-12");
  assert.equal(nov.P, 1400);
  assert.equal(nov.atr, 1);
  assert.equal(nov.atual, true);
  assert.equal(dez.R, 5800, "fatura + previsto");
  assert.equal(dez.saldo, 5800);
});

test("sem período escolhido, abre no período atual", async () => {
  const { buildCalendar } = await core();
  assert.equal(buildCalendar(itens(), F0, HOJE).sel, "2026-11");
});

test("só a pagar deixa de fora o que há a receber", async () => {
  const { buildCalendar } = await core();
  const C = buildCalendar(itens(), { ...F0, lado: "P", sel: "tudo" }, HOJE);
  assert.equal(C.receber.n, 0);
  assert.equal(C.pagar.n, 2);
});

test("sem a caixa dos previstos, os autos sem fatura não entram", async () => {
  const { buildCalendar } = await core();
  const C = buildCalendar(itens(), { ...F0, prev: false, sel: "tudo" }, HOJE);
  assert.equal(C.receber.total, 5000);
});

test("a pesquisa ignora acentos e apanha entidade, documento e obra", async () => {
  const { buildCalendar } = await core();
  assert.equal(buildCalendar(itens(), { ...F0, q: "namibe", sel: "tudo" }, HOJE).receber.n, 1);
  assert.equal(buildCalendar(itens(), { ...F0, q: "KARAM", sel: "tudo" }, HOJE).pagar.n, 1);
  assert.equal(buildCalendar(itens(), { ...F0, q: "fusiveis", sel: "tudo" }, HOJE).pagar.n, 1);
});

test("as listas agrupam pela origem e ordenam pela data", async () => {
  const { buildCalendar } = await core();
  const C = buildCalendar(itens(), { ...F0, sel: "tudo" }, HOJE);
  assert.deepEqual(C.receber.grupos.map((g) => g.nome).sort(), ["Faturas emitidas", "Previstos (autos ainda sem fatura)"]);
  const p = C.pagar.grupos[0].linhas;
  assert.equal(p[0].entidade, "Karam", "a mais antiga primeiro");
});

test("ano de outro período mostra Anteriores quando há coisas de antes", async () => {
  const { buildCalendar } = await core();
  const C = buildCalendar(itens(), { ...F0, ano: "2027" }, HOJE);
  assert.equal(C.periodos[0].k, "ant");
  assert.equal(C.sel, "2027-01", "o atual não está à vista: abre no primeiro mês");
});

test("os nomes dos períodos", async () => {
  const { periodLabel, periodShort } = await core();
  assert.equal(periodLabel("M", "2026-11"), "Novembro 2026");
  assert.equal(periodShort("M", "2026-11"), "Nov 26");
  assert.equal(periodLabel("S", "2026-11-23"), "Semana de 23/11 a 29/11");
  assert.equal(periodLabel("M", "tudo"), "Todos os períodos");
});
