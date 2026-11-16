const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanItems, matchProducts, similarity } = require("../src/services/ai/needs/service");

const catalog = [
  { id: "p1", name: "Cimento Portland 42,5", unit: "UN", aliases: ["Cimento cinza"] },
  { id: "p2", name: "Areia Grossa", unit: "MT3", aliases: [] },
  { id: "p3", name: "Areia Fina", unit: "MT3", aliases: [] },
  { id: "p4", name: "Tijolo 15", unit: "UN", aliases: ["Bloco de cimento 15"] },
];

test("semelhança ignora acentos, maiúsculas, palavras vazias e plural simples", () => {
  assert.equal(similarity("AREIA FINA", "areia fina"), 1);
  assert.ok(similarity("tijolos", "Tijolo 15") >= 0.8);
  assert.equal(similarity("de da do", "Areia"), 0);
});

test("associa ao produto do catálogo (nome ou sinónimo) e ordena pelo melhor", () => {
  assert.equal(matchProducts("Areia fina lavada", catalog)[0].id, "p3");
  assert.equal(matchProducts("cimento cinza", catalog)[0].id, "p1");
  assert.equal(matchProducts("Tijolos", catalog)[0].id, "p4");
  assert.deepEqual(matchProducts("Luvas de proteção", catalog), []);
});

test("limpa as linhas da IA: quantidade com vírgula, prioridade, descrições vazias", () => {
  const out = cleanItems([
    { description: "  Cimento  ", quantity: "20,5", unit: "saco", priority: "alta" },
    { description: "Areia", quantity: "muita", priority: "urgentíssimo" },
    { description: "x" },
    { description: "Pregos", quantity: -3 },
  ]);
  assert.deepEqual(
    out.map((i) => [i.description, i.quantity, i.unit, i.priority]),
    [
      ["Cimento", 20.5, "saco", "ALTA"],
      ["Areia", null, null, "MEDIA"],
      ["Pregos", null, null, "MEDIA"],
    ]
  );
  assert.deepEqual(cleanItems(undefined), []);
});
