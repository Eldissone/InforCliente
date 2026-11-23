const test = require("node:test");
const assert = require("node:assert/strict");

const BAI = require("../src/services/budget/baremAi");
const { BAREM_FIELDS, computeBaremCost } = require("../src/services/budget/baremCost");

/**
 * O assistente de baremes.
 *
 * O que estes testes guardam: **o pedido à IA e o cálculo do programa não podem
 * divergir**. Se a IA preencher os campos por uma fórmula e o
 * `computeBaremCost` calcular por outra, o número que ela propõe não é o que a
 * lista mostra a seguir — e ninguém percebe porquê.
 */

const contexto = BAI.buildContext({
  params: { moedaBase: "AOA", diasMes: 22, horasDia: 8, horasAnoEquip: 1800 },
  fuelPrices: { Gasóleo: 400, Gasolina: 450 },
  currencies: [{ moeda: "USD", cambio: 900 }],
  empresa: "MBT ENERGIA",
});

test("os campos que a IA preenche são os do formulário, não uma cópia", () => {
  // É o ponto todo de os ir buscar ao BAREM_FIELDS: quem acrescentar um campo
  // ao formulário vê-o aparecer no pedido sem mexer no assistente.
  for (const kind of BAI.TIPOS) {
    const doAssistente = BAI.fieldsOf(kind).map((f) => f.k);
    const doFormulario = (BAREM_FIELDS[kind] || []).map((f) => f.k);
    assert.deepEqual(doAssistente, doFormulario, `${kind}: os campos divergiram`);
    assert.ok(doAssistente.length > 0, `${kind}: sem campos`);
  }
});

test("o combustível fica de fora: é um preço, não se estima", () => {
  assert.ok(!BAI.TIPOS.includes("COMBUSTIVEL"));
  assert.deepEqual(BAI.TIPOS, ["RH", "EQUIPAMENTO", "VIATURA", "FERRAMENTA", "LOGISTICA"]);
});

test("o contexto leva o que muda a conta e a IA não adivinha", () => {
  assert.match(contexto, /Dias úteis por mês: 22/);
  assert.match(contexto, /Horas de trabalho por dia: 8/);
  assert.match(contexto, /Horas de utilização por ano dos equipamentos: 1800/);
  assert.match(contexto, /Gasóleo = 400/);
  assert.match(contexto, /USD = 900/);
});

test("cada tipo leva no pedido a fórmula que o programa usa", () => {
  for (const kind of BAI.TIPOS) {
    const p = BAI.buildPrompt(kind, "um recurso qualquer para orçamentar", { contexto });
    assert.match(p, /COMO O PROGRAMA USA ESTE BAREM/, `${kind}: sem a fórmula`);
    assert.ok(p.includes(BAI.FORMULAS[kind]), `${kind}: a fórmula não entrou`);
    assert.match(p, /Responde APENAS com JSON/, `${kind}: sem o formato`);
    assert.match(p, /Nunca apresentes uma estimativa como valor confirmado/, `${kind}: sem a regra da estimativa`);
    assert.match(p, /Percentagens como fração/, `${kind}: sem a regra das percentagens`);
    for (const f of BAI.fieldsOf(kind)) {
      assert.ok(p.includes(`- ${f.k}:`), `${kind}: o campo ${f.k} não vai no pedido`);
    }
  }
});

test("a fórmula do RH no pedido é mesmo a do programa", () => {
  // Confronto directo: a conta descrita à IA, feita à mão, tem de dar o que o
  // `computeBaremCost` dá.
  const fields = { mensal: 440000, enc: 0.08, seg: 0, alim: 2500, aloj: 0, transp: 1000, outros: 0 };
  const { computedCost, detail } = computeBaremCost("RH", { fields }, { diasMes: 22, horasDia: 8 });
  const dia = 440000 / 22;
  const real = dia * 1.08 + 0 + 2500 + 0 + 1000 + 0;
  assert.equal(Math.round(detail.dia), Math.round(dia));
  assert.equal(Math.round(computedCost), Math.round(real));
  assert.match(BAI.FORMULAS.RH, /Custo mensal ÷ dias úteis por mês/);
  assert.match(BAI.FORMULAS.RH, /\(1 \+ Encargos sociais\) \+ Seguro\/dia \+ Alimentação\/dia/);
});

test("os baremes que já existem vão no pedido, para manter critérios", () => {
  const p = BAI.buildPrompt("RH", "Eletricista de 1.ª", {
    contexto,
    existentes: [{ name: "Eletricista", fields: { mensal: 440000, enc: 0.08 } }],
  });
  assert.match(p, /BAREMES QUE JÁ EXISTEM/);
  assert.match(p, /Eletricista.*440000/s);
});

test("o molde da resposta tem os campos próprios de cada tipo", () => {
  assert.match(BAI.answerShape("EQUIPAMENTO"), /"ownership":"Próprio \| Alugado"/);
  assert.match(BAI.answerShape("FERRAMENTA"), /"unit":"dia \| un"/);
  assert.match(BAI.answerShape("RH"), /"enc":0\.08/, "a percentagem vai como fração no exemplo");
  assert.ok(!BAI.answerShape("RH").includes("ownership"), "o RH não tem posse");
});

test("a resposta é limpa: só os campos deste tipo, com o tipo certo", () => {
  const out = BAI.shape("RH", {
    campos: { mensal: "440 000", enc: 0.08, alim: "2.500", inventado: 1, outros: null },
    explicacoes: { mensal: "salário base", inventado: "não interessa" },
    pressupostos: ["Encargos típicos de 8%"],
    perguntas: ["Há subsídio de turno?", "b", "c", "d", "e"],
    confianca: "ALTA",
    resumo: "Eletricista de 1.ª",
  });
  assert.equal(out.campos.mensal, 440000, "o número em formato português é lido");
  assert.equal(out.campos.alim, 2500);
  assert.equal(out.campos.outros, null);
  assert.ok(!("inventado" in out.campos), "um campo que a IA invente não entra");
  assert.ok(!("inventado" in out.explicacoes));
  assert.equal(out.perguntas.length, 4, "no máximo quatro perguntas");
  assert.equal(out.confianca, "alta");
});

test("a posse e a unidade só entram quando são válidas", () => {
  const eq = BAI.shape("EQUIPAMENTO", { campos: { ownership: "Alugado", alugUn: "Semana", aluguer: 650000 } });
  assert.equal(eq.ownership, "Alugado");
  assert.equal(eq.campos.alugUn, null, "«Semana» não é uma opção: fica vazio em vez de entrar errado");

  const fe = BAI.shape("FERRAMENTA", { campos: { unit: "mês", tipo: "Inventado", aq: 1900 } });
  assert.equal(fe.unit, undefined, "«mês» não é unidade de ferramenta");
  assert.equal(fe.campos.tipo, null);
});

test("uma resposta sem campos nenhuns é recusada", () => {
  assert.throws(() => BAI.shape("RH", { resumo: "só isto" }), /não devolveu os campos/);
  assert.throws(() => BAI.shape("RH", null), /não devolveu os campos/);
});

test("resposta vazia e resposta ilegível dizem-se de maneira diferente", () => {
  assert.throws(() => BAI.parseJson(""), (e) => e.code === "IA_SEM_RESPOSTA");
  assert.throws(() => BAI.parseJson("isto não é JSON"), (e) => e.code === "IA_RESPOSTA_INVALIDA");
  assert.deepEqual(BAI.parseJson('```json\n{"a":1}\n```'), { a: 1 });
});

test("os campos propostos passam pelo cálculo do programa", () => {
  // O caminho completo: resposta da IA → limpeza → cálculo. É este número que
  // o ecrã mostra antes de se aplicar.
  const out = BAI.shape("EQUIPAMENTO", {
    campos: { ownership: "Próprio", aq: 98000000, vida: 10000, man: 500, lh: 8, tipo: "Gasóleo", oper: 0, seguro: 1800000 },
  });
  const { computedCost } = computeBaremCost(
    "EQUIPAMENTO",
    { fields: out.campos, ownership: out.ownership },
    { horasDia: 8, horasAnoEquip: 1800, fuelPrices: { Gasóleo: 400 } }
  );
  // 98 000 000/10 000 = 9 800 + 500 man + 1 800 000/1 800 = 1 000 + 8×400 = 3 200
  assert.equal(Math.round(computedCost), 9800 + 500 + 1000 + 3200);
});

test("uma descrição curta de mais nem chega à IA", async () => {
  await assert.rejects(() => BAI.calcular({ kind: "RH", descricao: "x", contexto }), /Descreva o recurso/);
  await assert.rejects(() => BAI.calcular({ kind: "COMBUSTIVEL", descricao: "gasóleo a 400" }), /Tipo de barem desconhecido/);
  await assert.rejects(() => BAI.perguntar({ pergunta: "  " }), /Escreva a dúvida/);
});

test("a dúvida leva todas as fórmulas, para a resposta ser a desta casa", () => {
  const p = BAI.buildQuestionPrompt("Como calculo a depreciação de uma Hilux?", { contexto });
  for (const kind of BAI.TIPOS) assert.ok(p.includes(BAI.FORMULAS[kind]), `falta a fórmula de ${kind}`);
  assert.match(p, /Custo posto em obra/, "a dos materiais também");
  assert.match(p, /Hilux/);
});

test("a funcionalidade está no catálogo e nasce desligada", () => {
  const { FEATURES } = require("../src/services/ai/catalog");
  const f = FEATURES.find((x) => x.key === BAI.FEATURE);
  assert.ok(f);
  assert.equal(f.default, false);
});

test("a conta do programa bate com a fórmula descrita à IA — com a resposta real", () => {
  /*
   * Os campos exactos que o fornecedor devolveu na verificação de 2026-11-22,
   * para a descrição «Eletricista de 1.ª … 440 000/mês, encargos 8%,
   * alimentação 2 500/dia, transporte 1 000/dia, sem alojamento».
   *
   * Repare-se no `seg: 350`: a IA **estimou** um seguro diário que ninguém lhe
   * deu — é o que o pedido manda fazer, e é por isso que a proposta vem com
   * pressupostos e numa tabela que se pode corrigir antes de aplicar.
   */
  const campos = { mensal: 440000, enc: 0.08, seg: 350, alim: 2500, aloj: null, transp: 1000, outros: null };
  const { computedCost, detail } = computeBaremCost("RH", { fields: campos }, { diasMes: 22, horasDia: 8 });
  const aMao = (440000 / 22) * 1.08 + 350 + 2500 + 1000;
  assert.equal(Math.round(detail.dia), 20000);
  assert.equal(Math.round(computedCost), Math.round(aMao));
  assert.equal(Math.round(computedCost), 25450);
});
