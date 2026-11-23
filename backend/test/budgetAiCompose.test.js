const test = require("node:test");
const assert = require("node:assert/strict");

const CP = require("../src/services/budget/aiCompose");
const { calcBudget } = require("../src/services/budget/calc");

/**
 * Compor os custos a partir do mapa de quantidades.
 *
 * A regra que estes testes guardam: **a IA dá o consumo por unidade, as
 * multiplicações são nossas**. Se as contas fossem dela, ninguém as podia
 * conferir — e um orçamento inteiro assentaria numa conta feita de cabeça por
 * um modelo de linguagem.
 */

const orcamento = () => ({
  number: "ORC-2026-0019",
  params: { metodo: "PRECO_DADO", moedaBase: "AOA", iva: 0.14, diasMes: 22, horasDia: 8 },
  lists: { familias: ["Postes", "Cabos MT"] },
  sheets: {
    qt: [
      { cod: "1.1", desc: "Abertura de cova para poste", un: "un", q: 207, pu: 22000, grupo: "1 - RAMAL MT" },
      { cod: "1.2", desc: "Fornecimento de poste de betão 12 m", un: "un", q: 207, pu: 85000, grupo: "1 - RAMAL MT" },
      { cod: "2.1", desc: "Linha sem quantidade", un: "un", q: 0, pu: 0, grupo: "2" },
      { cod: "2.2", desc: "", un: "un", q: 10, pu: 1000, grupo: "2" },
    ],
    mat: [],
    rh: [],
  },
  dispatch: {},
});

/** O que a IA devolveria: consumo por unidade, nunca totais. */
const respostaDaIA = () => ({
  itens: [
    {
      cod: "1.1",
      linhas: [
        { cat: "rh", barem: "Servente", porUnidade: 0.5, un: "dia" },
        { cat: "equipamento", barem: "Retroescavadora JCB 3CX", porUnidade: 0.15, un: "dia" },
        { cat: "material", desc: "Betão B20", un: "m3", porUnidade: 0.08, fam: "Construção civil" },
      ],
    },
    {
      cod: "1.2",
      nota: "Fornecimento puro: sem mão de obra.",
      linhas: [{ cat: "material", barem: "", desc: "Poste de betão 12 m", un: "un", porUnidade: 1, fam: "Postes" }],
    },
  ],
});

test("só se compõem trabalhos com descrição e quantidade", () => {
  const t = CP.trabalhosDe(orcamento());
  assert.equal(t.length, 2, "a linha sem quantidade e a linha sem descrição ficam de fora");
  assert.deepEqual(t.map((x) => x.cod), ["1.1", "1.2"]);
  assert.equal(t[0].q, 207);
});

test("sem mapa de quantidades não há nada a compor", async () => {
  await assert.rejects(() => CP.propor({ budget: { sheets: {} } }), /não tem mapa de quantidades/);
});

test("o pedido manda dar o consumo por unidade, e não multiplicar", () => {
  const p = CP.buildPrompt(CP.trabalhosDe(orcamento()), {
    baremesPorTipo: { rh: [{ name: "Servente" }], equipamento: [{ name: "Retroescavadora JCB 3CX" }] },
    familias: ["Postes"],
  });
  assert.match(p, /por cada unidade do trabalho/);
  assert.match(p, /Não multipliques pela quantidade total: o programa é que multiplica/);
  assert.match(p, /Servente/, "os baremes que existem vão no pedido");
  assert.match(p, /Retroescavadora JCB 3CX/);
  assert.match(p, /\[1\.1\] Abertura de cova para poste — 207 un/);
  assert.match(p, /Não inventes preços/);
});

test("🔴 a multiplicação é nossa: por unidade × quantidade do trabalho", () => {
  const itens = CP.shape(respostaDaIA(), CP.trabalhosDe(orcamento()));
  const cova = itens.find((x) => x.cod === "1.1");
  assert.equal(cova.q, 207);
  const servente = cova.linhas.find((l) => l.barem === "Servente");
  assert.equal(servente.porUnidade, 0.5);
  assert.equal(servente.total, 103.5, "0,5 dias × 207 covas");
  assert.equal(cova.linhas.find((l) => l.cat === "equipamento").total, 31.05);
  assert.equal(cova.linhas.find((l) => l.cat === "material").total, 16.56);
  const poste = itens.find((x) => x.cod === "1.2");
  assert.equal(poste.linhas[0].total, 207);
  assert.match(poste.nota, /Fornecimento puro/);
});

test("uma linha sem consumo, sem categoria ou sem nome é deitada fora", () => {
  const itens = CP.shape(
    {
      itens: [
        {
          cod: "1.1",
          linhas: [
            { cat: "rh", barem: "Servente", porUnidade: 0 },
            { cat: "inventada", desc: "Qualquer coisa", porUnidade: 1 },
            { cat: "rh", desc: "", barem: "", porUnidade: 2 },
            { cat: "rh", barem: "Pedreiro", porUnidade: 0.25 },
          ],
        },
      ],
    },
    CP.trabalhosDe(orcamento())
  );
  assert.equal(itens[0].linhas.length, 1);
  assert.equal(itens[0].linhas[0].barem, "Pedreiro");
});

test("um trabalho que não estava na lista é ignorado", () => {
  const itens = CP.shape({ itens: [{ cod: "9.9", linhas: [{ cat: "rh", barem: "X", porUnidade: 1 }] }] }, CP.trabalhosDe(orcamento()));
  assert.equal(itens.length, 0, "a IA não pode compor trabalhos que ninguém pediu");
});

test("o mesmo recurso em vários trabalhos junta-se numa linha só", () => {
  const itens = CP.shape(
    {
      itens: [
        { cod: "1.1", linhas: [{ cat: "rh", barem: "Servente", porUnidade: 0.5, un: "dia" }] },
        { cod: "1.2", linhas: [{ cat: "rh", barem: "Servente", porUnidade: 0.25, un: "dia" }] },
      ],
    },
    CP.trabalhosDe(orcamento())
  );
  const { sheets, recursos } = CP.toSheetRows(itens);
  assert.equal(recursos, 1, "um servente, não dois");
  assert.equal(sheets.rh.length, 1);
  assert.equal(sheets.rh[0].funcao, "Servente");
  assert.equal(sheets.rh[0].d, 155.25, "0,5×207 + 0,25×207");
  assert.match(sheets.rh[0].obs, /1\.1 \(0\.5\/un\)/);
  assert.match(sheets.rh[0].obs, /1\.2 \(0\.25\/un\)/);
});

test("as linhas propostas entram nas folhas certas", () => {
  const itens = CP.shape(respostaDaIA(), CP.trabalhosDe(orcamento()));
  const { sheets, semBarem, materiaisSemPreco } = CP.toSheetRows(itens);
  assert.equal(sheets.rh[0].funcao, "Servente");
  assert.equal(sheets.rh[0].n, 1, "uma pessoa");
  assert.equal(sheets.rh[0].d, 103.5, "durante N dias");
  assert.equal(sheets.eq[0].equip, "Retroescavadora JCB 3CX");
  assert.equal(sheets.mat.length, 2);
  assert.equal(sheets.mat.find((m) => m.desc === "Betão B20").q, 16.56);
  assert.equal(sheets.mat.find((m) => m.desc === "Betão B20").preco, 0, "o preço do material não vem da IA");
  assert.equal(materiaisSemPreco, 2, "e diz-se quantos ficam por preçar");
  assert.deepEqual(semBarem, [], "neste caso todos os recursos tinham barem");
});

test("os recursos sem barem são assinalados: são os que entram sem preço", () => {
  const itens = CP.shape(
    { itens: [{ cod: "1.1", linhas: [{ cat: "rh", desc: "Encarregado de linha", porUnidade: 0.1 }] }] },
    CP.trabalhosDe(orcamento())
  );
  const { semBarem } = CP.toSheetRows(itens);
  assert.deepEqual(semBarem, ["rh: Encarregado de linha"]);
});

test("uma linha desmarcada na revisão não entra", () => {
  const itens = CP.shape(respostaDaIA(), CP.trabalhosDe(orcamento()));
  itens[0].linhas[0].on = false;
  const { sheets } = CP.toSheetRows(itens);
  assert.ok(!sheets.rh, "o servente foi desmarcado");
  assert.ok(sheets.eq, "o resto entra na mesma");
});

test("o orçamento composto passa a ter custo — e margem", () => {
  // Com baremes a dar preço, o custo deixa de ser zero e a margem do preço
  // dado pelo cliente passa a poder ler-se. É este o ponto de tudo isto.
  const itens = CP.shape(respostaDaIA(), CP.trabalhosDe(orcamento()));
  const { sheets } = CP.toSheetRows(itens);
  const b = orcamento();
  b.sheets = { ...b.sheets, ...sheets };
  b.sheets.mat = b.sheets.mat.map((m) => ({ ...m, preco: m.desc === "Betão B20" ? 85000 : 85000, moeda: "AOA" }));
  b.baremSnapshot = {
    items: [
      { kind: "RH", name: "Servente", fields: { mensal: 150000 } },
      { kind: "EQUIPAMENTO", name: "Retroescavadora JCB 3CX", ownership: "Alugado", fields: { aluguer: 650000, alugUn: "Dia" } },
    ],
  };
  const R = calcBudget(b);
  assert.ok(R.CD > 0, `o custo direto deixou de ser zero (${R.CD})`);
  assert.ok(R.PVsi > 0);
  assert.ok(R.MB !== 0, "e há margem para ler");
});

test("resposta vazia e resposta ilegível dizem-se de maneira diferente", () => {
  assert.throws(() => CP.parseJson(""), (e) => e.code === "IA_SEM_RESPOSTA");
  assert.throws(() => CP.parseJson("nada disto é JSON"), (e) => e.code === "IA_RESPOSTA_INVALIDA");
});

test("a funcionalidade está no catálogo e nasce desligada", () => {
  const { FEATURES } = require("../src/services/ai/catalog");
  const f = FEATURES.find((x) => x.key === CP.FEATURE);
  assert.ok(f);
  assert.equal(f.default, false);
});
