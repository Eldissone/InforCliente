const test = require("node:test");
const assert = require("node:assert/strict");

const AI = require("../src/services/proposal/ai");
const PD = require("../src/services/proposal/document");

/**
 * A IA que redige os textos da proposta.
 *
 * O que estes testes guardam, acima de tudo: **o contexto que vai para a IA não
 * leva custos, preços nem margens**. O que o cliente lê é a solução técnica. Um
 * parágrafo com a margem lá dentro bastava para a proposta deixar de poder ser
 * enviada — e não haveria erro nenhum a avisar.
 */

const orcamento = () => ({
  number: "ORC-2026-0011",
  revision: "R0",
  params: {
    obra: "Electrificação do Município do Ucuma",
    cliente: "Pro Redes, Utilities",
    local: "Ucuma, Huambo",
    moedaBase: "AOA",
    iva: 0.14,
    inicio: "2026-12-01",
    fim: "2027-05-30",
    metodo: "PRECO_DADO",
  },
  lists: { familias: ["Cabos BT"] },
  sheets: {
    qt: [
      { cod: "1.1", desc: "Abertura de cova para poste", un: "un", q: 207, pu: 22000, grupo: "1 - RAMAL DE MÉDIA TENSÃO 30kV" },
      { cod: "2.1", desc: "Posto de transformação aéreo 160 kVA", un: "un", q: 3, pu: 18000000, grupo: "2 - POSTOS DE TRANSFORMAÇÃO" },
    ],
    mat: [{ desc: "Cabo condutor ACSR 1x160 mm2", fam: "Cabos BT", un: "m", q: 66750, preco: 1250, moeda: "AOA" }],
    sub: [{ desc: "Topografia e piquetagem", un: "vg", q: 1, pu: 4500000 }],
  },
  dispatch: { margens: { MAT: 0.27 } },
});

const docDe = (b) => PD.buildDocument([b], { reference: "PROP-2026-0011" });

test("o contexto leva a obra, o cliente, o prazo e o que se vai fazer", () => {
  const b = orcamento();
  const ctx = AI.buildContext([b], docDe(b));
  assert.match(ctx, /Electrificação do Município do Ucuma/);
  assert.match(ctx, /Pro Redes, Utilities/);
  assert.match(ctx, /Ucuma, Huambo/);
  assert.match(ctx, /2026-12-01 a 2027-05-30/);
  assert.match(ctx, /Cabo condutor ACSR 1x160 mm2 \(66750 m\)/);
  assert.match(ctx, /Posto de transformação aéreo 160 kVA \(3 un\)/);
  assert.match(ctx, /Topografia e piquetagem/);
});

test("🔴 o contexto NÃO leva preços, custos nem margens", () => {
  const b = orcamento();
  const doc = docDe(b);
  const ctx = AI.buildContext([b], doc);
  // Os números que não podem lá estar: preço unitário, preço do material,
  // valor da subempreitada, margem e o total da proposta.
  for (const proibido of ["22000", "18000000", "1250", "4500000", "0.27", "27%"]) {
    assert.ok(!ctx.includes(proibido), `o contexto não pode levar «${proibido}»:\n${ctx}`);
  }
  const total = PD.documentTotal(doc);
  assert.ok(total > 0, "a proposta de teste tem de valer alguma coisa");
  assert.ok(!ctx.includes(String(Math.round(total))), "o contexto não pode levar o valor da proposta");
});

test("os pedidos dizem à IA para não falar de dinheiro", () => {
  const b = orcamento();
  const ctx = AI.buildContext([b], docDe(b));
  for (const tarefa of AI.TAREFAS) {
    const p = AI.buildPrompt(tarefa, ctx, { zona: "memoria", pedido: "fala do estaleiro", doc: docDe(b) });
    assert.match(p, /NÃO menciones custos, preços, margens/, `${tarefa}: falta a regra do dinheiro`);
    assert.match(p, /Não inventes quantidades/, `${tarefa}: falta a regra de não inventar`);
    assert.match(p, /Responde APENAS com JSON/, `${tarefa}: falta o formato da resposta`);
  }
});

test("o pedido de um bloco diz em que secção entra", () => {
  const b = orcamento();
  const p = AI.buildPrompt("bloco", AI.buildContext([b], docDe(b)), {
    zona: "qsa",
    pedido: "escreve sobre os equipamentos de protecção individual",
    doc: docDe(b),
  });
  assert.match(p, /Qualidade, segurança, ambiente/);
  assert.match(p, /equipamentos de protecção individual/);
});

test("a resposta da IA é limpa antes de entrar no documento", () => {
  const m = AI.shape("memoria", {
    texto: "  Introdução.  ",
    seccoes: [
      { titulo: "Enquadramento", texto: "Texto." },
      { titulo: null, texto: undefined },
    ],
    lixo: "campo que não existe",
  });
  assert.equal(m.texto, "Introdução.");
  assert.equal(m.seccoes.length, 2);
  assert.equal(m.seccoes[1].titulo, "");
  assert.ok(!("lixo" in m));
});

test("uma resposta sem memória nenhuma é recusada", () => {
  assert.throws(() => AI.shape("memoria", { texto: "só isto" }), /não devolveu a memória/);
});

test("o JSON vem limpo mesmo com as cercas de código", () => {
  assert.deepEqual(AI.parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(AI.parseJson('{"a":2}'), { a: 2 });
});

test("resposta vazia e resposta ilegível dizem-se de maneira diferente", () => {
  // Vazia é o fornecedor sobrecarregado ou a recusar: passa dentro de momentos.
  assert.throws(() => AI.parseJson(""), /não respondeu/);
  assert.throws(() => AI.parseJson("   "), (e) => e.code === "IA_SEM_RESPOSTA" && e.status === 503);
  // Ilegível é o modelo a responder fora do formato: vale a pena tentar já.
  assert.throws(() => AI.parseJson("isto não é JSON"), /fora do formato/);
  assert.throws(() => AI.parseJson("isto não é JSON"), (e) => e.code === "IA_RESPOSTA_INVALIDA" && e.status === 502);
});

test("a memória escrita pela IA entra no sítio certo", () => {
  const doc = docDe(orcamento());
  const tocados = AI.applyToDocument(doc, "memoria", {
    texto: "A presente memória…",
    seccoes: [{ titulo: "Enquadramento", texto: "Parágrafo." }],
  });
  assert.equal(doc.memoria.texto, "A presente memória…");
  assert.equal(doc.memoria.seccoes.length, 1);
  assert.deepEqual(tocados, ["memoria.texto", "memoria.seccoes"]);
});

test("os textos técnicos entram todos, e o traçado só se houver texto", () => {
  const doc = docDe(orcamento());
  assert.equal(doc.tracado, null);
  const tocados = AI.applyToDocument(doc, "textos", {
    objectivo: "Objectivo.",
    documentacao_referencia: "Documentação.",
    introducao: "Introdução.",
    fases: [{ titulo: "Fase I", texto: "Texto." }],
    tracado_texto: "",
  });
  assert.equal(doc.objectivo, "Objectivo.");
  assert.equal(doc.condicoes_tecnicas.fases.length, 1);
  assert.equal(doc.tracado, null, "sem texto, não se abre uma secção de traçado vazia");
  assert.ok(!tocados.includes("tracado.texto"));

  const doc2 = docDe(orcamento());
  AI.applyToDocument(doc2, "textos", { objectivo: "", documentacao_referencia: "", introducao: "", fases: [], tracado_texto: "O traçado…" });
  assert.equal(doc2.tracado.texto, "O traçado…");
});

test("um bloco entra como anexo da sua secção, sem substituir nada", () => {
  const doc = docDe(orcamento());
  const objectivoAntes = doc.objectivo;
  AI.applyToDocument(doc, "bloco", { titulo: "EPI", texto: "Sobre o EPI." }, { zona: "qsa" });
  assert.equal(doc.extras.length, 1);
  assert.equal(doc.extras[0].zona, "qsa");
  assert.equal(doc.extras[0].tipo, "texto");
  assert.equal(doc.extras[0].titulo, "EPI");
  assert.equal(doc.objectivo, objectivoAntes, "o bloco não mexe no que já estava escrito");
});

test("um pedido de bloco sem texto nenhum é recusado antes de chegar à IA", async () => {
  await assert.rejects(
    () => AI.writeText({ tarefa: "bloco", budgets: [orcamento()], doc: docDe(orcamento()), zona: "qsa", pedido: "   " }),
    /Escreva o que quer/
  );
});

test("uma tarefa que não existe é recusada", async () => {
  await assert.rejects(() => AI.writeText({ tarefa: "inventada", budgets: [orcamento()], doc: {} }), /Tarefa desconhecida/);
});

test("a funcionalidade está no catálogo da Gestão do Sistema", () => {
  const { FEATURES } = require("../src/services/ai/catalog");
  const f = FEATURES.find((x) => x.key === AI.FEATURE);
  assert.ok(f, "sem entrada no catálogo não há como ligar ou desligar isto");
  assert.equal(f.default, false, "a IA da proposta nasce desligada");
});
