const test = require("node:test");
const assert = require("node:assert/strict");

const { articleKey, buildCatalog, searchCatalog, catalogStats } = require("../src/services/budget/articleCatalog");

const linha = (over = {}) => ({
  description: "Aplicação de Varões M16",
  unit: "un",
  unitPrice: 27358.74,
  quantity: 30,
  currency: "AOA",
  projectId: "p1",
  projectCode: "OBR-1",
  projectName: "Obra 1",
  date: "2026-10-23T00:00:00.000Z",
  ...over,
});

// ─── A chave do artigo ─────────────────────────────────────────────────────

test("a mesma coisa escrita de maneiras diferentes é o mesmo artigo", () => {
  const a = articleKey("Aplicação de Varões M16", "un");
  for (const d of ["aplicacao de varoes m16", "APLICAÇÃO DE VARÕES M16", "  Aplicação  de Varões  M16 ", "Aplicação de Varões M16."]) {
    assert.equal(articleKey(d, "un"), a, `"${d}" devia dar a mesma chave`);
  }
});

test("a unidade entra na chave: ao metro não é à unidade", () => {
  assert.notEqual(articleKey("Cabo XV 95", "m"), articleKey("Cabo XV 95", "un"));
});

test("grafias diferentes da mesma unidade dão a mesma chave", () => {
  assert.equal(articleKey("Cabo", "mts"), articleKey("Cabo", "m"));
  assert.equal(articleKey("Água", "litros"), articleKey("Água", "l"));
});

test("descrições parecidas ficam separadas — juntá-las era adivinhar", () => {
  assert.notEqual(articleKey("Travessa HTP4", "un"), articleKey("Montagem de Travessa HTP4", "un"));
});

// ─── Agrupar ───────────────────────────────────────────────────────────────

test("linhas iguais de obras diferentes juntam-se num artigo", () => {
  const c = buildCatalog([
    linha(),
    linha({ projectId: "p2", projectCode: "OBR-2", unitPrice: 30000 }),
    linha({ projectId: "p3", projectCode: "OBR-3", unitPrice: 25000 }),
  ]);
  assert.equal(c.length, 1);
  assert.equal(c[0].obras, 3);
  assert.equal(c[0].linhas, 3);
});

test("duas linhas do mesmo artigo na mesma obra contam uma obra só", () => {
  const c = buildCatalog([linha(), linha({ unitPrice: 28000 })]);
  assert.equal(c[0].obras, 1);
  assert.equal(c[0].linhas, 2);
  assert.equal(c[0].moedas[0].usos, 2);
});

test("mostra-se a grafia mais usada", () => {
  // As três são o mesmo artigo (a chave normaliza caixa, acentos e pontuação);
  // o que se mostra é como a casa mais a escreve.
  const c = buildCatalog([
    linha({ description: "aplicacao de varoes m16" }),
    linha({ description: "Aplicação de Varões M16", projectId: "p2" }),
    linha({ description: "Aplicação de Varões M16", projectId: "p3" }),
  ]);
  assert.equal(c.length, 1, "é tudo o mesmo artigo");
  assert.equal(c[0].desc, "Aplicação de Varões M16");
  assert.equal(c[0].grafias, 2, "as duas grafias ficam contadas");
});

test("a unidade sai na grafia do orçamento", () => {
  const c = buildCatalog([linha({ unit: "mts" })]);
  assert.equal(c[0].un, "m");
});

test("linha sem descrição não entra", () => {
  const c = buildCatalog([linha({ description: "" }), linha({ description: "   " }), linha()]);
  assert.equal(c.length, 1);
});

test("os mais usados vêm à frente", () => {
  const c = buildCatalog([
    linha({ description: "Raro" }),
    linha({ description: "Comum" }),
    linha({ description: "Comum", projectId: "p2" }),
    linha({ description: "Comum", projectId: "p3" }),
  ]);
  assert.equal(c[0].desc, "Comum");
});

// ─── Moedas: o que motivou metade deste serviço ────────────────────────────

test("moedas não se misturam", () => {
  const c = buildCatalog([
    linha({ unitPrice: 24189 }),
    linha({ projectId: "p2", currency: "USD", unitPrice: 10.73 }),
  ]);
  assert.equal(c.length, 1, "é o mesmo artigo");
  assert.equal(c[0].moedas.length, 2);
  const aoa = c[0].moedas.find((m) => m.cur === "AOA");
  const usd = c[0].moedas.find((m) => m.cur === "USD");
  assert.equal(aoa.min, 24189);
  assert.equal(usd.min, 10.73);
  assert.ok(!c[0].moedas.some((m) => m.min === 10.73 && m.max === 24189), "nunca num intervalo só");
});

test("a moeda com mais obras vem à frente", () => {
  const c = buildCatalog([
    linha({ currency: "USD", projectId: "u1", unitPrice: 10 }),
    linha({ currency: "USD", projectId: "u2", unitPrice: 11 }),
    linha({ currency: "AOA", projectId: "a1", unitPrice: 24000 }),
  ]);
  assert.equal(c[0].moedas[0].cur, "USD");
});

test("a moeda é normalizada em maiúsculas", () => {
  const c = buildCatalog([linha({ currency: "usd" })]);
  assert.equal(c[0].moedas[0].cur, "USD");
});

test("sem moeda indicada assume-se kwanza", () => {
  const c = buildCatalog([linha({ currency: null })]);
  assert.equal(c[0].moedas[0].cur, "AOA");
});

// ─── Preços ────────────────────────────────────────────────────────────────

test("o último preço é o da obra mais recente, não o maior", () => {
  const c = buildCatalog([
    linha({ unitPrice: 100, date: "2026-01-01T00:00:00.000Z", projectCode: "OBR-VELHA" }),
    linha({ unitPrice: 50, date: "2026-10-01T00:00:00.000Z", projectId: "p2", projectCode: "OBR-NOVA" }),
  ]);
  assert.equal(c[0].moedas[0].ultimo.preco, 50);
  assert.equal(c[0].moedas[0].ultimo.obra, "OBR-NOVA");
});

test("intervalo e mediana", () => {
  const c = buildCatalog([
    linha({ unitPrice: 10 }),
    linha({ unitPrice: 20, projectId: "p2" }),
    linha({ unitPrice: 60, projectId: "p3" }),
  ]);
  const m = c[0].moedas[0];
  assert.equal(m.min, 10);
  assert.equal(m.max, 60);
  assert.equal(m.mediana, 20);
});

test("mediana com número par de preços é a média dos dois do meio", () => {
  const c = buildCatalog([
    linha({ unitPrice: 10 }),
    linha({ unitPrice: 20, projectId: "p2" }),
    linha({ unitPrice: 30, projectId: "p3" }),
    linha({ unitPrice: 50, projectId: "p4" }),
  ]);
  assert.equal(c[0].moedas[0].mediana, 25);
});

test("preço zero não é preço: conta o uso mas não entra no histórico", () => {
  const c = buildCatalog([linha({ unitPrice: 0 }), linha({ unitPrice: 24000, projectId: "p2" })]);
  assert.equal(c[0].linhas, 2);
  assert.equal(c[0].semPreco, 1);
  assert.equal(c[0].moedas[0].usos, 1);
  assert.equal(c[0].moedas[0].min, 24000);
});

test("artigo só com linhas sem preço aparece, mas sem histórico", () => {
  const c = buildCatalog([linha({ unitPrice: 0 }), linha({ unitPrice: null, projectId: "p2" })]);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].moedas, []);
  assert.equal(c[0].semPreco, 2);
});

test("o histórico vem do mais recente para o mais antigo", () => {
  const c = buildCatalog([
    linha({ unitPrice: 1, date: "2026-01-01T00:00:00.000Z" }),
    linha({ unitPrice: 2, date: "2026-10-01T00:00:00.000Z", projectId: "p2" }),
    linha({ unitPrice: 3, date: "2026-05-01T00:00:00.000Z", projectId: "p3" }),
  ]);
  assert.deepEqual(c[0].moedas[0].historico.map((h) => h.price), [2, 3, 1]);
});

test("o histórico diz de que obra veio cada preço", () => {
  const c = buildCatalog([linha({ unitPrice: 999, projectCode: "OBR-X", projectName: "Obra X" })]);
  const h = c[0].moedas[0].historico[0];
  assert.equal(h.projectCode, "OBR-X");
  assert.equal(h.projectName, "Obra X");
  assert.equal(h.qty, 30);
});

// ─── Procurar ──────────────────────────────────────────────────────────────

const catalogo = () =>
  buildCatalog([
    linha({ description: "Aplicação de Varões M16" }),
    linha({ description: "Aplicação de Varões M16", projectId: "p2" }),
    linha({ description: "Aplicação de Porcas M16", projectId: "p3" }),
    linha({ description: "Montagem de Travessa HTP4", projectId: "p4" }),
    linha({ description: "Lançamento de Condutor ACSR 116", unit: "m", projectId: "p5" }),
    linha({ description: "Varões", projectId: "p6" }),
  ]);

test("o que casa exactamente vem primeiro", () => {
  const r = searchCatalog(catalogo(), "Varões");
  assert.equal(r[0].desc, "Varões");
});

test("sem casar exactamente, ganha quem é usado em mais obras", () => {
  const r = searchCatalog(catalogo(), "m16");
  assert.equal(r[0].desc, "Aplicação de Varões M16", "2 obras contra 1");
});

test("encontra sem acentos e sem caixa", () => {
  assert.ok(searchCatalog(catalogo(), "varoes").length);
  assert.ok(searchCatalog(catalogo(), "VARÕES").length);
});

test("palavras soltas por qualquer ordem também encontram", () => {
  const r = searchCatalog(catalogo(), "travessa montagem");
  assert.equal(r[0].desc, "Montagem de Travessa HTP4");
});

test("filtrar por unidade", () => {
  const r = searchCatalog(catalogo(), "", { unit: "m" });
  assert.equal(r.length, 1);
  assert.equal(r[0].desc, "Lançamento de Condutor ACSR 116");
});

test("o filtro de unidade aceita outra grafia", () => {
  assert.equal(searchCatalog(catalogo(), "", { unit: "mts" }).length, 1);
});

test("filtrar por moeda deixa de fora quem não tem preços nessa moeda", () => {
  const c = buildCatalog([
    linha({ description: "Só em kwanzas" }),
    linha({ description: "Só em dólares", currency: "USD", projectId: "p2" }),
  ]);
  const r = searchCatalog(c, "", { currency: "USD" });
  assert.equal(r.length, 1);
  assert.equal(r[0].desc, "Só em dólares");
  assert.equal(r[0].moedas.length, 1);
});

test("procura vazia devolve o catálogo por ordem de uso", () => {
  const r = searchCatalog(catalogo(), "");
  assert.equal(r[0].desc, "Aplicação de Varões M16");
});

test("o limite respeita-se e nunca passa de 100", () => {
  assert.equal(searchCatalog(catalogo(), "", { limit: 2 }).length, 2);
  assert.ok(searchCatalog(catalogo(), "", { limit: 9999 }).length <= 100);
  assert.ok(searchCatalog(catalogo(), "", { limit: 0 }).length >= 1, "limite zero não devolve vazio por engano");
});

test("o que não existe não devolve nada", () => {
  assert.deepEqual(searchCatalog(catalogo(), "helicóptero"), []);
});

test("catálogo vazio não rebenta", () => {
  assert.deepEqual(searchCatalog([], "seja o que for"), []);
  assert.deepEqual(buildCatalog([]), []);
  assert.deepEqual(buildCatalog(null), []);
});

// ─── Os números do cabeçalho ───────────────────────────────────────────────

test("as contas do catálogo", () => {
  const s = catalogStats(catalogo());
  assert.equal(s.artigos, 5);
  assert.equal(s.linhas, 6);
  assert.equal(s.repetidos, 1, "só «Varões M16» aparece em mais de uma obra");
  assert.deepEqual(s.moedas, [{ cur: "AOA", artigos: 5 }]);
});

test("as contas separam as moedas", () => {
  const s = catalogStats(
    buildCatalog([linha(), linha({ description: "Outro", currency: "USD", projectId: "p2" })])
  );
  assert.deepEqual(s.moedas.map((m) => m.cur).sort(), ["AOA", "USD"]);
});
