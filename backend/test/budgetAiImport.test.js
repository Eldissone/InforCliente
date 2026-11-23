const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");

const IMP = require("../src/services/budget/aiImport");
const { calcBudget } = require("../src/services/budget/calc");

/**
 * Importar um orçamento de uma folha de Excel com a IA a ler as linhas.
 *
 * A IA só classifica: diz o que cada linha é e a que barem corresponde. Tudo o
 * resto — ler o ficheiro, juntar as linhas em pedidos, marcar repetidos, fazer
 * as contas e encher as folhas — é código, e é o que estes testes cobrem. Da
 * IA testa-se o que se pode testar sem a chamar: que o pedido leva as regras e
 * que a resposta é limpa antes de tocar no orçamento.
 */

/** Um mapa de quantidades como os que chegam dos clientes. */
function excelDeEnsaio() {
  const linhas = [
    ["MAPA DE QUANTIDADES E PREÇOS", "", "", "", ""],
    ["Obra: Electrificação do Ucuma", "", "", "", ""],
    ["Cliente: Pro Redes, Utilities", "", "", "", ""],
    ["", "", "", "", ""],
    ["Item", "Designação", "Un.", "Qtd.", "Preço unitário"],
    ["1", "RAMAL DE MÉDIA TENSÃO 30kV", "", "", ""],
    ["1.1", "Abertura de cova para poste", "un", 207, 22000],
    ["1.2", "Fornecimento de poste de betão 12 m", "un", 207, 85000],
    ["", "Subtotal", "", "", 22149000],
    ["2", "POSTOS DE TRANSFORMAÇÃO", "", "", ""],
    ["2.1", "Posto de transformação aéreo 160 kVA", "un", 3, 18000000],
    ["", "TOTAL", "", "", 76149000],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), "Mapa");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Notas"], ["Folha sem artigos"]]), "Notas");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/** O que a IA devolveria para esse ficheiro. */
const itensDaIA = () => [
  { id: "0:6", cat: "material", cod: "1.1", grupo: "1 - RAMAL DE MÉDIA TENSÃO 30kV", desc: "Abertura de cova para poste", un: "un", q: 207, pu: 22000, moeda: "AOA", fam: "Construção civil", barem: "" },
  { id: "0:7", cat: "material", cod: "1.2", grupo: "1 - RAMAL DE MÉDIA TENSÃO 30kV", desc: "Fornecimento de poste de betão 12 m", un: "un", q: 207, pu: 85000, moeda: "AOA", fam: "Postes", barem: "" },
  { id: "0:10", cat: "material", cod: "2.1", grupo: "2 - POSTOS DE TRANSFORMAÇÃO", desc: "Posto de transformação aéreo 160 kVA", un: "un", q: 3, pu: 18000000, moeda: "AOA", fam: "Transformadores", barem: "" },
];

test("lê as folhas do ficheiro sem adivinhar nada", () => {
  const folhas = IMP.readWorkbook(excelDeEnsaio());
  assert.equal(folhas.length, 2);
  assert.equal(folhas[0].nome, "Mapa");
  assert.equal(folhas[0].rows[6][1], "Abertura de cova para poste");
  assert.equal(folhas[0].rows[6][3], 207);
});

test("as linhas vão com o seu endereço, e as de cabeçalho servem de contexto", () => {
  const folhas = IMP.readWorkbook(excelDeEnsaio());
  const { linhas, contexto } = IMP.sheetLines(folhas);
  assert.ok(linhas.every((l) => /^\[\d+:\d+\]/.test(l.t)), "cada linha leva o seu [folha:linha]");
  assert.ok(contexto.some((c) => c.includes("Electrificação do Ucuma")), "a obra está no contexto");
  assert.ok(linhas.some((l) => l.t.includes("Abertura de cova")));
  // Linhas de uma célula só (títulos soltos) não vão.
  assert.ok(!linhas.some((l) => l.t.includes("Folha sem artigos")));
});

test("só se analisam as folhas escolhidas", () => {
  const folhas = IMP.readWorkbook(excelDeEnsaio());
  const { linhas } = IMP.sheetLines(folhas, [1]);
  assert.ok(!linhas.some((l) => l.t.includes("Abertura de cova")), "a folha 0 ficou de fora");
});

test("as linhas partem-se em pedidos que o modelo aguenta", () => {
  const muitas = Array.from({ length: 300 }, (_, i) => ({ id: `0:${i}`, t: `[0:${i}] ${"x".repeat(100)}` }));
  const chunks = IMP.chunkLines(muitas);
  assert.ok(chunks.length > 1, "300 linhas não vão num pedido só");
  assert.ok(chunks.every((c) => c.length <= 110), "nenhum pedido passa das 110 linhas");
  assert.equal(chunks.reduce((n, c) => n + c.length, 0), 300, "não se perde nenhuma linha");
});

test("o pedido leva os baremes que existem e as regras", () => {
  const p = IMP.buildPrompt([{ id: "0:6", t: "[0:6] 1.1 | Abertura de cova | un | 207 | 22000" }], {
    baremesPorTipo: { rh: [{ name: "Eletricista" }], eq: [{ name: "Retroescavadora JCB 3CX" }] },
    familias: ["Postes", "Cabos MT"],
    contexto: ["Mapa: Obra: Ucuma"],
    primeiro: true,
  });
  assert.match(p, /Eletricista/, "a IA tem de saber que baremes existem, para os ligar");
  assert.match(p, /Retroescavadora JCB 3CX/);
  assert.match(p, /Postes; Cabos MT/);
  assert.match(p, /\*\*Não inventes quantidades nem preços\.\*\*/);
  assert.match(p, /IGNORA cabeçalhos, títulos de capítulo, subtotais, totais/);
  assert.match(p, /"projeto"/, "o primeiro pedido também pergunta a obra e o cliente");
  const segundo = IMP.buildPrompt([], { primeiro: false });
  assert.ok(!segundo.includes('"projeto"'), "os pedidos seguintes já não perguntam");
});

test("a resposta da IA é limpa antes de entrar no orçamento", () => {
  assert.equal(IMP.shapeItem({ desc: "" }), null, "sem descrição não é artigo");
  assert.equal(IMP.shapeItem(null), null);
  const x = IMP.shapeItem({ id: "0:6", cat: "inventada", desc: "  Poste  ", q: "207", pu: "22 000,50", moeda: "GBP", fam: "Postes" });
  assert.equal(x.cat, "material", "uma categoria que não existe cai em material");
  assert.equal(x.desc, "Poste");
  assert.equal(x.q, 207);
  assert.equal(x.pu, 22000.5, "o número em formato português é lido");
  assert.equal(x.moeda, "AOA", "uma moeda que não se trata vira AOA");
  assert.equal(x.on, true);
});

test("sem preço na folha, o preço fica nulo — não zero", () => {
  const x = IMP.shapeItem({ desc: "Cabo", q: 100, pu: null });
  assert.equal(x.pu, null, "zero diria que é grátis; nulo diz que ainda não tem preço");
});

test("os repetidos de outra folha ficam desmarcados, os da mesma só assinalados", () => {
  const itens = IMP.markDuplicates([
    IMP.shapeItem({ id: "0:6", cat: "material", desc: "Poste de betão 12 m" }),
    IMP.shapeItem({ id: "0:9", cat: "material", desc: "Poste de betão 12m" }),
    IMP.shapeItem({ id: "1:4", cat: "material", desc: "POSTE DE BETÃO 12 M" }),
    IMP.shapeItem({ id: "0:12", cat: "material", desc: "Cabo ACSR" }),
  ]);
  assert.equal(itens[0].dup, undefined);
  assert.equal(itens[0].on, true);
  assert.match(itens[1].dup, /nesta folha/);
  assert.equal(itens[1].on, true, "na mesma folha pode ser mesmo outro sítio: quem revê decide");
  assert.match(itens[2].dup, /outra folha/);
  assert.equal(itens[2].on, false, "de outra folha é quase de certeza o mesmo artigo");
  assert.equal(itens[3].dup, undefined);
});

test("o custo de cada linha, para quem revê ver no que dá", () => {
  assert.equal(IMP.itemCost(IMP.shapeItem({ desc: "Poste", q: 207, pu: 85000 })), 17595000);
  // Moeda estrangeira converte-se pelo câmbio.
  assert.equal(IMP.itemCost(IMP.shapeItem({ desc: "Cela", q: 2, pu: 1000, moeda: "USD" }), { cambios: { USD: 900 } }), 1800000);
  // RH: pessoas × dias × custo/dia.
  assert.equal(IMP.itemCost(IMP.shapeItem({ cat: "rh", desc: "Eletricista", pessoas: 6, dias: 120, pu: 20000 })), 14400000);
  // Com barem, o custo vem do barem e não da folha.
  assert.equal(IMP.itemCost(IMP.shapeItem({ cat: "rh", desc: "Eletricista", barem: "Eletricista", pu: 20000 })), null);
});

test("destino «mapa»: as linhas tornam-se o mapa de quantidades", () => {
  const { sheets, semPreco } = IMP.toSheets(itensDaIA().map(IMP.shapeItem), { destino: "mapa" });
  assert.equal(sheets.qt.length, 3);
  assert.deepEqual(sheets.qt[0], { cod: "1.1", desc: "Abertura de cova para poste", un: "un", q: 207, pu: 22000, grupo: "1 - RAMAL DE MÉDIA TENSÃO 30kV" });
  assert.equal(semPreco, 0);

  // E o orçamento que sai daí vale o que a folha dizia.
  const orcamento = { params: { metodo: "PRECO_DADO", moedaBase: "AOA", iva: 0.14 }, sheets, lists: {}, dispatch: {} };
  const R = calcBudget(orcamento);
  assert.equal(Math.round(R.PVsi), 207 * 22000 + 207 * 85000 + 3 * 18000000);
  assert.equal(R.qtGrupos.length, 2, "dois capítulos, como na folha");
});

test("destino «custo»: cada linha vai para a sua folha", () => {
  const itens = [
    IMP.shapeItem({ id: "0:1", cat: "material", desc: "Cabo ACSR", un: "m", q: 1000, pu: 1200, fam: "Cabos MT" }),
    IMP.shapeItem({ id: "0:2", cat: "rh", desc: "Eletricista", pessoas: 6, dias: 120, pu: 20000 }),
    IMP.shapeItem({ id: "0:3", cat: "equipamento", desc: "Retroescavadora", pessoas: 1, dias: 30, pu: 650000, barem: "Retroescavadora JCB 3CX" }),
    IMP.shapeItem({ id: "0:4", cat: "subempreitada", desc: "Topografia", un: "vg", q: 1, pu: 4500000 }),
    IMP.shapeItem({ id: "0:5", cat: "logistica", desc: "Contentor de estaleiro", un: "mês", q: 6, pu: 120000 }),
  ];
  const { sheets, novosBaremes, familias } = IMP.toSheets(itens, { destino: "custo" });
  assert.equal(sheets.mat.length, 1);
  assert.equal(sheets.mat[0].fam, "Cabos MT");
  assert.equal(sheets.rh[0].funcao, "Eletricista");
  assert.equal(sheets.rh[0].n, 6);
  assert.equal(sheets.rh[0].d, 120);
  assert.equal(sheets.eq[0].equip, "Retroescavadora JCB 3CX", "com barem, usa-se o nome do barem");
  assert.equal(sheets.sub[0].pu, 4500000);
  assert.equal(sheets.log.length, 1);
  assert.deepEqual(familias, ["Cabos MT"]);

  // Os baremes que faltam são listados, não criados às escondidas.
  const nomes = novosBaremes.map((b) => `${b.kind}:${b.name}`);
  assert.ok(nomes.includes("RH:Eletricista"), "o eletricista não tinha barem");
  assert.ok(!nomes.some((n) => n.includes("Retroescavadora JCB")), "o que já tinha barem não entra na lista");
});

test("as linhas desmarcadas não entram", () => {
  const itens = itensDaIA().map(IMP.shapeItem);
  itens[1].on = false;
  const { sheets } = IMP.toSheets(itens, { destino: "mapa" });
  assert.equal(sheets.qt.length, 2);
  assert.ok(!sheets.qt.some((l) => l.desc.includes("poste de betão")));
});

test("as linhas sem preço contam-se, para se avisar quem importa", () => {
  const itens = [IMP.shapeItem({ desc: "Cabo", q: 100, pu: null }), IMP.shapeItem({ desc: "Poste", q: 10, pu: 85000 })];
  assert.equal(IMP.toSheets(itens, { destino: "mapa" }).semPreco, 1);
  assert.equal(IMP.toSheets(itens, { destino: "custo" }).semPreco, 1);
});

test("um destino que não existe é recusado", () => {
  assert.throws(() => IMP.toSheets([], { destino: "inventado" }), /Destino desconhecido/);
});

test("a funcionalidade está no catálogo e nasce desligada", () => {
  const { FEATURES } = require("../src/services/ai/catalog");
  const f = FEATURES.find((x) => x.key === IMP.FEATURE);
  assert.ok(f, "sem entrada no catálogo não há como ligar ou desligar isto");
  assert.equal(f.default, false);
});
