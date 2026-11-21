const test = require("node:test");
const assert = require("node:assert/strict");

const D = require("../src/services/proposal/document");
const { calcBudget } = require("../src/services/budget/calc");

/**
 * O documento da Proposta Técnica e Comercial.
 *
 * O que mais importa aqui: **a lista de preços tem de somar exactamente o preço
 * de venda do orçamento**. O preço de venda inclui os custos indiretos, os
 * riscos e o ajuste, que não estão em nenhuma linha direta; sem o factor de
 * escala, a lista que o cliente assina ficava abaixo do orçamento aprovado.
 */

const orcamento = (over = {}) => ({
  number: "ORC-2026-0001",
  revision: "R0",
  params: {
    obra: "Electrificação do Longonjo",
    cliente: "Governo Provincial do Huambo",
    local: "Longonjo, Huambo",
    moedaBase: "AOA",
    iva: 0.14,
    inicio: "2026-12-01",
    fim: "2027-05-30",
    validade: 30,
    metodo: "MARGEM_SOBRE_VENDA",
    ...(over.params || {}),
  },
  lists: { familias: ["Cabos BT", "Postes"] },
  sheets: {
    mat: [
      { desc: "Cabo BT 4x95", fam: "Cabos BT", un: "m", q: 5000, preco: 1200, moeda: "AOA" },
      { desc: "Poste de betão 12 m", fam: "Postes", un: "un", q: 120, preco: 85000, moeda: "AOA" },
    ],
    sub: [{ desc: "Abertura de valas", un: "m", q: 3000, pu: 2500 }],
    ...(over.sheets || {}),
  },
  dispatch: { margens: { MAT: 0.2, SUB: 0.15, IND: 0.2, RIS: 0.2 }, ...(over.dispatch || {}) },
});

const soma = (doc) => D.documentTotal(doc);

test("o documento traz os 23 campos que o modelo lê", () => {
  const doc = D.buildDocument([orcamento()], { reference: "PROP-2026-0007" });
  const esperados = [
    "documento", "cliente", "obra", "empresa", "capa", "sintese", "objectivo", "documentacao_referencia",
    "memoria", "condicoes_tecnicas", "quadro_resumo", "tracado", "cronograma", "organograma",
    "execucao_trabalhos", "qualidade_seguranca_ambiente", "exclusoes", "comercial", "prazo",
    "recepcao", "validade", "contactos", "extras",
  ];
  for (const k of esperados) assert.ok(k in doc, `falta ${k}`);
  assert.equal(doc.documento.referencia, "PROP-2026-0007");
  assert.equal(doc.documento.moeda, "AOA");
  assert.equal(doc.documento.taxa_iva, 0.14);
});

test("a lista de preços soma o preço de venda do orçamento", () => {
  const b = orcamento();
  const R = calcBudget(b);
  const doc = D.buildDocument([b]);
  assert.ok(R.PVsi > 0, "o orçamento de teste tem de ter preço");
  assert.ok(Math.abs(soma(doc) - R.PVsi) < 1, `lista ${soma(doc)} ≠ preço ${R.PVsi}`);
});

test("com custos indiretos e ajuste, a lista continua a somar o preço de venda", () => {
  // Os indiretos e o ajuste não estão em nenhuma linha direta: é o factor de
  // escala que os reparte pela lista.
  const b = orcamento({
    params: { ajuste: 500000 },
    sheets: {
      mat: [{ desc: "Cabo BT 4x95", fam: "Cabos BT", un: "m", q: 5000, preco: 1200, moeda: "AOA" }],
      ind: [{ desc: "Estrutura e sede", tipo: "Percentagem", base: "Custo direto", valor: 0.08 }],
    },
  });
  const R = calcBudget(b);
  const doc = D.buildDocument([b]);
  assert.ok(Math.abs(soma(doc) - R.PVsi) < 1, `lista ${soma(doc)} ≠ preço ${R.PVsi}`);
});

test("com mapa de quantidades, é ele a lista de preços", () => {
  // É o caso de todos os orçamentos reais: o preço vem do mapa de quantidades
  // (método «preço dado»), e as folhas de custo podem nem existir. Derivar a
  // lista do custo dava uma lista vazia.
  const b = {
    number: "ORC-2026-0019",
    revision: "R0",
    params: { obra: "Ramal de MT", cliente: "Pro Redes", local: "Huíla", moedaBase: "AOA", iva: 0.14, metodo: "PRECO_DADO" },
    lists: {},
    sheets: {
      qt: [
        { cod: "1.1", desc: "Abertura de cova", un: "un", q: 207, pu: 22000, grupo: "1 - RAMAL DE MÉDIA TENSÃO 30kV" },
        { cod: "1.2", desc: "Montagem de poste", un: "un", q: 207, pu: 45000, grupo: "1 - RAMAL DE MÉDIA TENSÃO 30kV" },
        { cod: "2.1", desc: "Posto de transformação", un: "un", q: 3, pu: 18000000, grupo: "2 - POSTOS DE TRANSFORMAÇÃO" },
      ],
    },
    dispatch: {},
  };
  const R = calcBudget(b);
  const doc = D.buildDocument([b]);
  const lote = doc.comercial.lotes[0];
  assert.equal(lote.capitulos.length, 2, "um capítulo por grupo do mapa");
  assert.equal(lote.capitulos[0].designacao, "1 - RAMAL DE MÉDIA TENSÃO 30kV");
  assert.equal(lote.capitulos[0].itens[0].item, "1.1", "o código do artigo é o do mapa");
  assert.equal(lote.capitulos[0].itens[0].quantidade, 207);
  assert.equal(lote.capitulos[0].itens[0].preco_material, 22000);
  assert.ok(Math.abs(soma(doc) - R.PVsi) < 1, `lista ${soma(doc)} ≠ preço ${R.PVsi}`);
  assert.ok(Math.abs(R.PVsi - (207 * 22000 + 207 * 45000 + 3 * 18000000)) < 1);
});

test("sem mapa de quantidades, a lista deriva das folhas de custo", () => {
  const b = orcamento();
  const doc = D.buildDocument([b], { options: { fmt: "mapa" } });
  assert.ok(doc.comercial.lotes[0].capitulos.length > 0, "não fica vazia");
  assert.ok(Math.abs(soma(doc) - calcBudget(b).PVsi) < 1);
});

test("os cinco formatos derivados do custo", () => {
  const b = orcamento();
  const R = calcBudget(b);
  const fmtTotal = (fmt, extra = {}) => {
    const doc = D.buildDocument([b], { options: { fmt, ...extra } });
    return { doc, total: soma(doc) };
  };

  // Detalhada: materiais por família + capítulos de serviço
  const det = fmtTotal("detalhada");
  assert.ok(det.doc.comercial.lotes[0].capitulos.length >= 3);
  assert.ok(Math.abs(det.total - R.PVsi) < 1);

  // Por artigo, serviço incluído: uma coluna de preço unitário
  const inc = fmtTotal("artigo_incl");
  assert.equal(inc.doc.comercial.lotes[0].colunas, "pu");
  assert.ok(Math.abs(inc.total - R.PVsi) < 1);

  // Por artigo, fornecimento e montagem separados: duas colunas
  const sep = fmtTotal("artigo_sep");
  assert.equal(sep.doc.comercial.lotes[0].colunas, "fm");
  const linha = sep.doc.comercial.lotes[0].capitulos[0].itens[0];
  assert.ok(linha.preco_material > 0 && linha.preco_servico > 0, "fornecimento e montagem separados");
  assert.ok(Math.abs(sep.total - R.PVsi) < 1);

  // Capítulos: uma linha por família, num só capítulo
  const cap = fmtTotal("capitulos");
  assert.equal(cap.doc.comercial.lotes[0].capitulos.length, 1);
  assert.ok(Math.abs(cap.total - R.PVsi) < 1);

  // Global: a lista existe, mas o documento final esconde-a
  const glob = D.finalizeDocument(D.buildDocument([b], { options: { fmt: "global" } }), { fmt: "global" });
  assert.equal(glob.comercial.sem_lista, true);
});

test("materiais e serviços resumidos num capítulo cada", () => {
  const b = orcamento();
  const R = calcBudget(b);
  const doc = D.buildDocument([b], { options: { fmt: "detalhada", mat: "capitulo", serv: "global" } });
  const caps = doc.comercial.lotes[0].capitulos;
  assert.equal(caps.length, 2, "um capítulo de materiais e um de serviços");
  assert.equal(caps[0].designacao, "Fornecimento de materiais");
  assert.ok(Math.abs(soma(doc) - R.PVsi) < 1);
});

test("vários orçamentos tornam-se vários lotes", () => {
  const a = orcamento();
  const b = orcamento({ params: { obra: "Electrificação do Ukuma", local: "Ukuma, Huambo" } });
  const doc = D.buildDocument([a, b]);
  assert.equal(doc.comercial.lotes.length, 2);
  assert.equal(doc.comercial.lotes[0].nome, "Longonjo");
  assert.equal(doc.comercial.lotes[1].nome, "Ukuma");
  assert.equal(doc.obra.subtitulo.length, 2);
  assert.equal(doc.sintese.extra[0].titulo, "2 lotes");
  const total = calcBudget(a).PVsi + calcBudget(b).PVsi;
  assert.ok(Math.abs(soma(doc) - total) < 2);
});

test("uma linha sem quantidade vira verba global, não divide por zero", () => {
  const b = orcamento({ sheets: { mat: [{ desc: "Diversos", fam: "Outros", un: "", q: 0, preco: 0, moeda: "AOA" }], sub: [{ desc: "Empreitada geral", un: "vg", q: 1, pu: 1000000 }] } });
  const doc = D.buildDocument([b]);
  const itens = doc.comercial.lotes[0].capitulos.flatMap((c) => c.itens);
  for (const it of itens) {
    assert.ok(Number.isFinite(it.preco_material) && Number.isFinite(it.preco_servico), `preço inválido em ${it.designacao}`);
    assert.ok(it.quantidade > 0, "a quantidade nunca é zero na lista");
  }
});

test("o documento final limpa o que está vazio", () => {
  const doc = D.buildDocument([orcamento()]);
  doc.memoria.seccoes[0].texto = "Texto escrito.";
  doc.tracado = { texto: "", criterios: [], mapas: [] };
  const fin = D.finalizeDocument(doc);
  assert.equal(fin.memoria.seccoes.length, 1, "só as secções escritas");
  assert.equal(fin.tracado, null, "o traçado vazio não abre secção");
  assert.ok(fin.cronograma, "o cronograma por omissão fica");
});

test("as colunas escondidas de uma tabela anexa não vão para o documento", () => {
  const doc = D.buildDocument([orcamento()]);
  doc.extras = [{ zona: "quadro", tipo: "tabela", colunas: ["A", "Interno", "B"], linhas: [["1", "x", "2"]], ocultas: [1], asset: "blob:…" }];
  const fin = D.finalizeDocument(doc);
  assert.deepEqual(fin.extras[0].colunas, ["A", "B"]);
  assert.deepEqual(fin.extras[0].linhas, [["1", "2"]]);
  assert.ok(!("asset" in fin.extras[0]), "o blob local não vai no documento");
});

test("o cronograma por omissão respeita o prazo do orçamento", () => {
  const doc = D.buildDocument([orcamento()]);
  const acts = doc.cronograma.actividades;
  assert.equal(acts.length, 7);
  assert.equal(acts[0].inicio, "2026-12-01");
  assert.equal(acts[acts.length - 1].fim, "2027-05-30");
  for (const a of acts) assert.ok(a.inicio <= a.fim, `${a.nome}: começa depois de acabar`);
});

test("o texto-padrão da empresa pode ser substituído", () => {
  const doc = D.buildDocument([orcamento()], {
    standard: { empresa: { nome: "OUTRA EMPRESA, LDA", email: "geral@outra.ao" }, sintese: { inicio: "30 dias", garantia: "5 anos" } },
  });
  assert.equal(doc.empresa.nome, "OUTRA EMPRESA, LDA");
  assert.equal(doc.sintese.garantia, "5 anos");
  assert.match(doc.memoria.texto, /OUTRA EMPRESA/);
  assert.match(doc.prazo.titulo, /30 dias/);
});

test("sem orçamento não há documento", () => {
  assert.throws(() => D.buildDocument([]), /SEM_ORCAMENTO/);
});
