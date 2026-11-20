const test = require("node:test");
const assert = require("node:assert/strict");

const { CANONICAL, normalizeUnit, summarizeUnits } = require("../src/services/budget/units");

// ─── As grafias que estão mesmo nas 23 obras ───────────────────────────────
//
// Contagens reais à data da importação: un 790 · km 36 · mts 32 · m 30 ·
// cj 27 · m3 26 · vg 18 · m³ 4 · l 2 · um 1 · litros 1 · unid 1.

test("as grafias que existem nas obras traduzem-se todas", () => {
  const esperado = {
    un: "un",
    km: "km",
    mts: "m",
    m: "m",
    cj: "cj",
    m3: "m3",
    vg: "vg",
    "m³": "m3",
    l: "L",
    um: "un",
    litros: "L",
    unid: "un",
  };
  for (const [escrito, canonico] of Object.entries(esperado)) {
    const r = normalizeUnit(escrito);
    assert.equal(r.unit, canonico, `"${escrito}" devia dar "${canonico}", deu "${r.unit}"`);
    assert.equal(r.matched, true, `"${escrito}" ficou por reconhecer`);
  }
});

test("tudo o que sai está na lista de validação do orçamento", () => {
  const escritas = ["un", "km", "mts", "m", "cj", "m3", "vg", "m³", "l", "um", "litros", "unid"];
  for (const e of escritas) {
    assert.ok(CANONICAL.includes(normalizeUnit(e).unit), `"${e}" saiu fora da lista`);
  }
});

// ─── Caixa, espaços e pontuação ────────────────────────────────────────────

test("a caixa não conta", () => {
  assert.equal(normalizeUnit("UN").unit, "un");
  assert.equal(normalizeUnit("Km").unit, "km");
  assert.equal(normalizeUnit("MTS").unit, "m");
  assert.equal(normalizeUnit("Litros").unit, "L");
});

test("espaços à volta e ponto final não contam", () => {
  assert.equal(normalizeUnit("  un  ").unit, "un");
  assert.equal(normalizeUnit("un.").unit, "un");
  assert.equal(normalizeUnit(" Mts. ").unit, "m");
});

test("o original fica sempre guardado", () => {
  const r = normalizeUnit("  MTS. ");
  assert.equal(r.unit, "m");
  assert.equal(r.original, "MTS.");
});

test("acentos não contam, mas o expoente do m³ não é acento", () => {
  assert.equal(normalizeUnit("mês").unit, "mês");
  assert.equal(normalizeUnit("mes").unit, "mês");
  assert.equal(normalizeUnit("m³").unit, "m3");
  assert.equal(normalizeUnit("m²").unit, "m2");
});

// ─── O que não se reconhece não se perde ───────────────────────────────────

test("o que não se reconhece volta tal e qual, assinalado", () => {
  const r = normalizeUnit("bobine");
  assert.equal(r.unit, "bobine");
  assert.equal(r.matched, false);
  assert.equal(r.original, "bobine");
});

test("vazio é vazio, não um palpite", () => {
  for (const v of ["", "   ", null, undefined]) {
    const r = normalizeUnit(v);
    assert.equal(r.unit, "");
    assert.equal(r.matched, false);
  }
});

test("não se adivinha: cj e vg ficam como estão", () => {
  assert.equal(normalizeUnit("cj").unit, "cj");
  assert.equal(normalizeUnit("vg").unit, "vg");
});

test("nunca devolve nada nulo", () => {
  for (const v of ["", "xpto", "un", null, 7, {}]) {
    const r = normalizeUnit(v);
    assert.equal(typeof r.unit, "string");
    assert.equal(typeof r.original, "string");
    assert.equal(typeof r.matched, "boolean");
  }
});

// ─── O resumo que se mostra antes de gravar ────────────────────────────────

test("o resumo conta as linhas por grafia", () => {
  const s = summarizeUnits(["un", "un", "mts", "m³", "bobine"]);
  const un = s.rows.find((r) => r.original === "un");
  assert.equal(un.count, 2);
  assert.equal(s.rows[0].original, "un", "a mais usada vem à frente");
});

test("o resumo separa o que muda do que fica por reconhecer", () => {
  const s = summarizeUnits(["un", "mts", "m³", "bobine", "un"]);
  assert.deepEqual(
    s.changed.map((r) => `${r.original}→${r.unit}`).sort(),
    ["mts→m", "m³→m3"]
  );
  assert.deepEqual(s.unknown.map((r) => r.original), ["bobine"]);
});

test("sem nada para mudar, as listas vêm vazias", () => {
  const s = summarizeUnits(["un", "km", "cj"]);
  assert.equal(s.changed.length, 0);
  assert.equal(s.unknown.length, 0);
  assert.equal(s.rows.length, 3);
});

test("o resumo aguenta uma lista vazia", () => {
  const s = summarizeUnits([]);
  assert.deepEqual(s.rows, []);
  assert.deepEqual(s.changed, []);
  assert.deepEqual(s.unknown, []);
});

test("linhas sem unidade aparecem no resumo como (vazio)", () => {
  const s = summarizeUnits(["un", "", "  "]);
  const vazio = s.rows.find((r) => r.original === "(vazio)");
  assert.equal(vazio.count, 2);
  assert.equal(vazio.matched, false);
});
