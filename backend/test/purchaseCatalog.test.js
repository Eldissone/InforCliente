const test = require("node:test");
const assert = require("node:assert/strict");

const {
  foldTec,
  specs,
  compararDescricao,
  buildPurchaseCatalog,
  matchPrices,
  matchSheet,
  origemTexto,
} = require("../src/services/budget/purchaseCatalog");

/**
 * Os casos aqui são os do histórico verdadeiro do ORC-2026-0008 (Kwawa), onde
 * esta procura foi feita à mão pela primeira vez: é por isso que as
 * correspondências que têm de chumbar são tão específicas.
 */
const registo = (over = {}) => ({
  description: "Eletrodo de Terra 2 m",
  unit: "un",
  unitPrice: 11395,
  currency: "AOA",
  source: "necessidade",
  sourceLabel: "necessidade de obra",
  supplier: null,
  date: "2026-09-15T00:00:00.000Z",
  ...over,
});

// ─── Normalizar texto técnico ──────────────────────────────────────────────

test("mm² e mm2 são a mesma coisa", () => {
  assert.equal(foldTec("Cabo Lxs 4x16mm²"), foldTec("Cabo Lxs 4x16mm2"));
});

test("a vírgula decimal e o ponto são a mesma coisa", () => {
  assert.equal(foldTec("Cabo 3G 2,5mm2"), foldTec("Cabo 3G 2.5mm2"));
});

test("acentos e maiúsculas não distinguem artigos", () => {
  assert.equal(foldTec("Elétrodo de TERRA"), foldTec("eletrodo de terra"));
});

// ─── Extrair especificações ────────────────────────────────────────────────

test("a secção escrita com x é uma especificação só", () => {
  const { specs: s } = specs("Cabo LXAV 4x16mm2");
  assert.deepEqual([...s.get("sec")], ["4x16"]);
});

test("a bitola da secção também conta como bitola", () => {
  // Sem isto, um cabo de 4x95mm² não se dava com um de 35mm.
  assert.deepEqual([...specs("Cabo LXAV 4x95mm2").specs.get("mm")], ["95"]);
});

test("a secção sem sufixo não contradiz a mesma secção com sufixo", () => {
  assert.ok(compararDescricao("Cabo 4x16", "Cabo Lxs 4x16mm²"));
});

test("a secção não se confunde com a bitola", () => {
  assert.notDeepEqual([...specs("Cabo 4x16mm2").specs.get("sec")], [...specs("Cabo 4x95mm2").specs.get("sec")]);
});

test("medida com sufixo entra na espécie certa", () => {
  assert.deepEqual([...specs("Cabo de Terra Nú 35mm").specs.get("mm")], ["35"]);
  assert.deepEqual([...specs("Coluna metálica de IP 10m").specs.get("m")], ["10"]);
  assert.deepEqual([...specs("Luminária Led 100W").specs.get("w")], ["100"]);
  assert.deepEqual([...specs("Fusível NHO 16A").specs.get("a")], ["16"]);
  assert.deepEqual([...specs("Postes de Betão 9 Mts - 400 Dan").specs.get("dan")], ["400"]);
});

test("mts e m são a mesma espécie de medida", () => {
  assert.deepEqual([...specs("Poste 9 Mts").specs.get("m")], [...specs("Poste 9m").specs.get("m")]);
});

test("as palavras banais não contam", () => {
  assert.deepEqual(specs("Cabo de cobre nu").palavras, ["cabo", "cobre", "nu"]);
});

// ─── Comparar: o que tem de chumbar ────────────────────────────────────────

test("secções diferentes chumbam, por muito que as palavras batam", () => {
  assert.equal(compararDescricao("Cabo LXAV 4x95mm2", "Cabo Lxs 4x16mm²"), null);
});

test("bitolas diferentes chumbam — 35mm² não dá o preço do de 16mm²", () => {
  assert.equal(compararDescricao("Cabo de cobre nu 16mm2", "Cabo de Terra Nú 35mm"), null);
});

test("a secção de um cabo de 2,5 não vem do de 1,5", () => {
  assert.equal(compararDescricao("Cabo 3G 2,5mm2", "Cabo 3G1,5 mm2"), null);
});

test("calibres diferentes de fusível chumbam", () => {
  assert.equal(compararDescricao("Fusível NHO 16A", "Fusível NH1 40A"), null);
});

test("uma coluna de 10m não é um poste de 9m", () => {
  assert.equal(compararDescricao("Coluna metálica de IP 10m", "Postes de Betão 9 Mts - 400 Dan"), null);
});

test("artigos sem nada em comum chumbam", () => {
  assert.equal(compararDescricao("Cimento 42,5R", "Luminária Led 100W"), null);
});

test("uma linha sem descrição não casa com nada", () => {
  assert.equal(compararDescricao("", "Luminária Led 100W"), null);
});

// ─── Comparar: o que tem de passar ─────────────────────────────────────────

test("texto igual é correspondência exacta", () => {
  assert.equal(compararDescricao("Eletrodo de Terra 2 m", "Eletrodo de Terra 2 m").confianca, "igual");
});

test("a mesma coisa escrita com outros acentos é exacta", () => {
  assert.equal(compararDescricao("Elétrodo de Terra 2 M", "eletrodo de terra 2 m").confianca, "igual");
});

test("todas as palavras escritas aparecem no artigo: correspondência forte", () => {
  const r = compararDescricao("Elétrodo de terra", "Eletrodo de Terra 2 m");
  assert.equal(r.confianca, "forte");
});

test("plurais não estragam a correspondência", () => {
  assert.equal(compararDescricao("Fusíveis NH", "Fusível NH").confianca, "forte");
});

test("metade das palavras e nenhum número a contradizer: possível", () => {
  const r = compararDescricao("Cabo LXAV 4x16mm2", "Cabo Lxs 4x16mm²");
  assert.equal(r.confianca, "possivel");
  assert.deepEqual(r.falta, ["lxav"]);
});

test("o artigo pode ter especificações a mais", () => {
  assert.ok(compararDescricao("Coluna metálica de IP", "Coluna metálica de IP 10m"));
});

// ─── Agrupar registos ──────────────────────────────────────────────────────

test("registos do mesmo artigo juntam-se e o mais recente manda", () => {
  const c = buildPurchaseCatalog([
    registo({ unitPrice: 9000, date: "2026-06-30T00:00:00.000Z" }),
    registo({ unitPrice: 11395, date: "2026-09-15T00:00:00.000Z" }),
  ]);
  assert.equal(c.length, 1);
  assert.equal(c[0].usos, 2);
  assert.equal(c[0].ultimo.preco, 11395);
  assert.equal(c[0].min, 9000);
  assert.equal(c[0].max, 11395);
  assert.equal(c[0].mediana, 10197.5);
});

test("moedas diferentes não se misturam", () => {
  const c = buildPurchaseCatalog([registo(), registo({ currency: "USD", unitPrice: 12 })]);
  assert.equal(c.length, 2);
  assert.deepEqual(c.map((x) => x.moeda).sort(), ["AOA", "USD"]);
});

test("unidades diferentes são artigos diferentes", () => {
  const c = buildPurchaseCatalog([registo({ unit: "m" }), registo({ unit: "un" })]);
  assert.equal(c.length, 2);
});

test("grafias da mesma unidade juntam-se", () => {
  const c = buildPurchaseCatalog([registo({ unit: "mts" }), registo({ unit: "m" })]);
  assert.equal(c.length, 1);
});

test("preço zero ou em falta não entra — zero não é um preço", () => {
  assert.deepEqual(buildPurchaseCatalog([registo({ unitPrice: 0 }), registo({ unitPrice: null })]), []);
});

test("registo sem descrição não entra", () => {
  assert.deepEqual(buildPurchaseCatalog([registo({ description: "  " })]), []);
});

test("a grafia mais usada é a que se mostra", () => {
  const c = buildPurchaseCatalog([
    registo({ description: "Eletrodo de Terra 2 m" }),
    registo({ description: "Eletrodo de Terra 2 m" }),
    registo({ description: "ELETRODO DE TERRA 2 M" }),
  ]);
  assert.equal(c[0].desc, "Eletrodo de Terra 2 m");
});

test("sem registos nenhuns, catálogo vazio", () => {
  assert.deepEqual(buildPurchaseCatalog([]), []);
  assert.deepEqual(buildPurchaseCatalog(null), []);
});

// ─── Procurar candidatos ───────────────────────────────────────────────────

const catalogo = () =>
  buildPurchaseCatalog([
    registo({ description: "Eletrodo de Terra 2 m", unitPrice: 11395 }),
    registo({ description: "Cabo de Terra Nú 35mm", unit: "mts", unitPrice: 14070 }),
    registo({ description: "Cabo Lxs 4x16mm²", unit: "mts", unitPrice: 2700 }),
    registo({ description: "Cabo Lxs 4x50mm²", unit: "mts", unitPrice: 7800 }),
    registo({ description: "Luminária Led 100W", unitPrice: 60200 }),
    registo({
      description: "Fusível NHO 16A",
      unit: "UNI",
      unitPrice: 5253.91,
      source: "cotacao",
      sourceLabel: "cotação escolhida",
      supplier: "NewCom (SU), Lda",
      date: "2026-11-16T00:00:00.000Z",
    }),
    registo({
      description: "Poste de Iluminação",
      unitPrice: 60000,
      source: "catalogo",
      sourceLabel: "catálogo de fornecedor",
      supplier: "José Augusto",
      date: "2026-07-31T00:00:00.000Z",
    }),
  ]);

test("a correspondência exacta vem à frente", () => {
  const r = matchPrices(catalogo(), "Eletrodo de Terra 2 m", { unit: "un" });
  assert.equal(r[0].desc, "Eletrodo de Terra 2 m");
  assert.equal(r[0].confianca, "igual");
  assert.equal(r[0].preco, 11395);
});

test("o cabo de 16mm² não recebe candidatos do de 35mm nem do de 50mm²", () => {
  const r = matchPrices(catalogo(), "Cabo de cobre nu 16mm2", { unit: "m" });
  assert.deepEqual(r, []);
});

test("o cabo de 95mm² não recebe candidatos", () => {
  assert.deepEqual(matchPrices(catalogo(), "Cabo LXAV 4x95mm2", { unit: "m" }), []);
});

test("o de 16mm² recebe o LXS de 16mm², como possível", () => {
  const r = matchPrices(catalogo(), "Cabo LXAV 4x16mm2", { unit: "m" });
  assert.equal(r.length, 1);
  assert.equal(r[0].desc, "Cabo Lxs 4x16mm²");
  assert.equal(r[0].confianca, "possivel");
  assert.equal(r[0].preco, 2700);
});

test("a origem do candidato vem com ele", () => {
  const r = matchPrices(catalogo(), "Fusíveis NH", { unit: "un" });
  assert.equal(r[0].desc, "Fusível NHO 16A");
  assert.equal(r[0].origem, "cotação escolhida");
  assert.equal(r[0].forn, "NewCom (SU), Lda");
});

test("unidade diferente fica dita e nunca é exacta", () => {
  const r = matchPrices(catalogo(), "Eletrodo de Terra 2 m", { unit: "cj" });
  assert.equal(r[0].unDifere, true);
  assert.equal(r[0].confianca, "possivel");
});

test("sem unidade escrita, não se exige nenhuma", () => {
  const r = matchPrices(catalogo(), "Eletrodo de Terra 2 m", {});
  assert.equal(r[0].confianca, "igual");
  assert.equal(r[0].unDifere, false);
});

test("filtra por moeda quando a folha não tem onde escrever outra", () => {
  const c = buildPurchaseCatalog([registo({ description: "Betão", currency: "USD", unitPrice: 190 })]);
  assert.deepEqual(matchPrices(c, "Betão", { currencies: ["AOA"] }), []);
  assert.equal(matchPrices(c, "Betão", { currencies: ["AOA", "USD"] }).length, 1);
});

test("procura vazia não devolve nada", () => {
  assert.deepEqual(matchPrices(catalogo(), "   "), []);
  assert.deepEqual(matchPrices([], "Eletrodo"), []);
});

test("o limite é respeitado", () => {
  const c = buildPurchaseCatalog([
    registo({ description: "Areia", unit: "m3", unitPrice: 1000 }),
    registo({ description: "Areia grossa", unit: "m3", unitPrice: 1200 }),
    registo({ description: "Areia lavada", unit: "m3", unitPrice: 1500 }),
  ]);
  assert.equal(matchPrices(c, "Areia", { unit: "m3" }).length, 3);
  assert.equal(matchPrices(c, "Areia", { unit: "m3", limit: 2 }).length, 2);
});

// ─── Casar uma folha inteira ───────────────────────────────────────────────

const folhaMat = () => [
  { desc: "Elétrodo de terra", un: "un", q: 154, preco: 0, obs: "Composto de: 1.1 (1/un)" },
  { desc: "Cabo LXAV 4x95mm2", un: "m", q: 3150, preco: 0 },
  { desc: "Luminária Led 100W", un: "un", q: 154, preco: 55000 },
  { desc: "", un: "un", q: 0, preco: 0 },
];

test("só as linhas sem preço, por omissão", () => {
  const r = matchSheet(catalogo(), { folha: "mat", rows: folhaMat(), moedaBase: "AOA" });
  assert.deepEqual(r.linhas.map((l) => l.desc), ["Elétrodo de terra", "Cabo LXAV 4x95mm2"]);
});

test("as linhas já preçadas entram se se pedir", () => {
  const r = matchSheet(catalogo(), { folha: "mat", rows: folhaMat(), moedaBase: "AOA", apenasSemPreco: false });
  assert.equal(r.linhas.length, 3, "a linha sem descrição nunca entra");
  assert.equal(r.linhas[2].preco, 55000);
});

test("guarda o índice da linha na folha, para se saber onde escrever", () => {
  const r = matchSheet(catalogo(), { folha: "mat", rows: folhaMat(), moedaBase: "AOA" });
  assert.deepEqual(r.linhas.map((l) => l.i), [0, 1]);
});

test("a linha sem candidatos vem com a lista vazia, não desaparece", () => {
  const r = matchSheet(catalogo(), { folha: "mat", rows: folhaMat(), moedaBase: "AOA" });
  const cabo = r.linhas.find((l) => l.desc === "Cabo LXAV 4x95mm2");
  assert.deepEqual(cabo.candidatos, []);
  assert.equal(cabo.escolhido, null);
});

test("nada vem escolhido sem ser a correspondência exacta", () => {
  const rows = [{ desc: "Eletrodo de Terra 2 m", un: "un", q: 1, preco: 0 }, { desc: "Cabo LXAV 4x16mm2", un: "m", q: 1, preco: 0 }];
  const r = matchSheet(catalogo(), { folha: "mat", rows, moedaBase: "AOA" });
  assert.equal(r.linhas[0].escolhido, 0, "a exacta vem escolhida");
  assert.equal(r.linhas[1].escolhido, null, "a possível fica por decidir");
});

test("a folha de subempreitadas usa o preço unitário e só a moeda-base", () => {
  const c = buildPurchaseCatalog([
    registo({ description: "Subcontratação técnicos", unitPrice: 2500 }),
    registo({ description: "Subcontratação técnicos", currency: "USD", unitPrice: 3 }),
  ]);
  const r = matchSheet(c, { folha: "sub", rows: [{ desc: "Subcontratação técnicos", un: "un", q: 1, pu: 0 }], moedaBase: "AOA" });
  assert.equal(r.campos.preco, "pu");
  assert.equal(r.linhas[0].candidatos.length, 1);
  assert.equal(r.linhas[0].candidatos[0].moeda, "AOA");
});

test("folha que não se preça devolve lista vazia", () => {
  const r = matchSheet(catalogo(), { folha: "rh", rows: [{ item: "Eletricista" }], moedaBase: "AOA" });
  assert.equal(r.campos, null);
  assert.deepEqual(r.linhas, []);
});

test("folha vazia não dá erro", () => {
  assert.deepEqual(matchSheet(catalogo(), { folha: "mat", rows: null, moedaBase: "AOA" }).linhas, []);
});

// ─── A frase da observação ─────────────────────────────────────────────────

test("a observação diz o artigo, o preço, a origem e a data", () => {
  const c = matchPrices(catalogo(), "Fusíveis NH", { unit: "un" })[0];
  const t = origemTexto(c);
  assert.match(t, /Fusível NHO 16A/);
  assert.match(t, /5253\.91\/un/);
  assert.match(t, /cotação escolhida/);
  assert.match(t, /NewCom/);
  assert.match(t, /2026-11-16/);
});

test("a observação marca com ≈ o que não é correspondência exacta", () => {
  const exacta = matchPrices(catalogo(), "Eletrodo de Terra 2 m", { unit: "un" })[0];
  const aprox = matchPrices(catalogo(), "Cabo LXAV 4x16mm2", { unit: "m" })[0];
  assert.ok(!origemTexto(exacta).includes("≈"));
  assert.ok(origemTexto(aprox).includes("≈"));
});

// ─── Uma palavra em comum não é prova ──────────────────────────────────────

test("«Tesoura de Cortar Cabo» não é candidata a preço de cabo", () => {
  // Partilham «cabo» e não têm nada a ver. Foi este o furo que apareceu na
  // verificação contra o histórico verdadeiro.
  assert.equal(compararDescricao("Cabo LXAV 4x95mm2", "Tesoura de Cortar Cabo"), null);
  assert.equal(compararDescricao("Cabo 3G 2,5mm2", "Tesoura de Cortar Cabo"), null);
});

test("a primeira palavra vale uma prova — é a que diz o que a coisa é", () => {
  assert.equal(compararDescricao("Areia lavada", "Areia").confianca, "possivel");
  assert.equal(compararDescricao("Luminária de IP com braço simples", "Luminária Led 100W").confianca, "possivel");
});

test("designações curtas com uma letra de diferença são a mesma família", () => {
  const r = compararDescricao("Fusíveis NH BT", "Fusível NHO 16A");
  assert.equal(r.confianca, "possivel");
  assert.deepEqual(r.falta, ["bt"]);
});

test("um sinónimo não é correspondência — a procura à mão é que o resolve", () => {
  // «Coluna metálica de IP» e «Poste de Iluminação» são a mesma coisa para quem
  // sabe, e não partilham uma palavra. O programa não adivinha.
  assert.equal(compararDescricao("Coluna metálica de IP 10m", "Poste de Iluminação"), null);
});

test("um cabo de um condutor não recebe o preço de um de quatro", () => {
  // Mesma bitola (16mm²), construção diferente: «16mm2» é um condutor,
  // «4x16mm²» são quatro.
  assert.equal(compararDescricao("Cabo de cobre nu 16mm2", "Cabo Lxs 4x16mm²"), null);
  assert.equal(compararDescricao("Cabo Lxs 4x16mm²", "Cabo de cobre nu 16mm2"), null);
});

// ─── Procura à mão ─────────────────────────────────────────────────────────

test("a procura à mão escolhe os artigos, mas a confiança mede-se contra a linha", () => {
  // Quem escreve «poste de iluminação» para preçar uma «Coluna metálica de IP»
  // não está a dizer que são a mesma coisa escrita igual.
  const r = matchPrices(catalogo(), "Poste de Iluminação", {
    unit: "un",
    contra: "Coluna metálica de IP 10m",
  });
  assert.equal(r[0].desc, "Poste de Iluminação");
  assert.equal(r[0].confianca, "procurado");
});

test("sem procura à mão, a confiança é contra a própria descrição", () => {
  const r = matchPrices(catalogo(), "Poste de Iluminação", { unit: "un", contra: "Poste de Iluminação" });
  assert.equal(r[0].confianca, "igual");
});

test("o que se procurou à mão fica marcado como aproximado na observação", () => {
  const r = matchPrices(catalogo(), "Poste de Iluminação", { unit: "un", contra: "Coluna metálica de IP 10m" });
  assert.ok(r[0].nota.includes("≈"));
});

test("a procura à mão ainda reconhece o que casa mesmo com a linha", () => {
  const r = matchPrices(catalogo(), "eletrodo", { unit: "un", contra: "Elétrodo de terra" });
  assert.equal(r[0].confianca, "forte");
});

test("na procura à mão, o artigo que se escreveu vem à frente", () => {
  const c = buildPurchaseCatalog([
    registo({ description: "Poste de Iluminação", unitPrice: 60000, date: "2026-07-31T00:00:00.000Z" }),
    registo({ description: "Postes de Betão 9 Mts - 400 Dan", unitPrice: 204747.93, date: "2026-09-15T00:00:00.000Z" }),
  ]);
  const r = matchPrices(c, "Poste de Iluminação", { unit: "un", contra: "Coluna metálica de IP 10m" });
  assert.equal(r[0].desc, "Poste de Iluminação", "o mais recente não ganha ao que se procurou");
  assert.equal(r.every((x) => x.confianca === "procurado"), true);
});

test("a pontuação interna da procura não sai na resposta", () => {
  const r = matchPrices(catalogo(), "Eletrodo de Terra 2 m", { unit: "un" });
  assert.equal("_q" in r[0], false);
});

test("proformaRecords: as linhas da pró-forma viram registos do catálogo e casam com a folha", () => {
  const PC = require("../src/services/budget/purchaseCatalog");
  const reg = PC.proformaRecords({
    currency: "aoa",
    supplierName: "Kitanda Lda",
    docNumber: "PF 12",
    docDate: "2026-11-20",
    items: [
      { description: "Cabo VAV 4x16mm2", unit: "m", unitPrice: 4500 },
      { description: "Transporte", unit: "vg", unitPrice: 0 },
      { description: "", unitPrice: 9 },
    ],
  });
  assert.equal(reg.length, 1);
  assert.equal(reg[0].currency, "AOA");
  assert.equal(reg[0].sourceLabel, "Pró-forma PF 12");
  const cat = PC.buildPurchaseCatalog(reg);
  const r = PC.matchSheet(cat, { folha: "mat", rows: [{ desc: "Cabo VAV 4x16mm2", un: "m", q: 100, preco: 3000 }], moedaBase: "AOA", moedas: ["AOA"], apenasSemPreco: false });
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].candidatos[0].preco, 4500);
  assert.equal(r.linhas[0].escolhido, 0);
});
