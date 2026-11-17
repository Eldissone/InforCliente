const test = require("node:test");
const assert = require("node:assert/strict");

const { bestMatch, keyword } = require("../src/services/prefill/service");

test("palavra-chave: a mais longa, com e sem acentos", () => {
  assert.deepEqual(keyword("Fusível NH1 200A"), ["fusível", "fusivel"]);
  assert.deepEqual(keyword("20 sacos de cimento"), ["cimento"]);
  assert.equal(keyword("de 20"), null);
});

test("escolhe o mais parecido e, em empate, o mais recente", () => {
  const rows = [
    { description: "Cimento Portland 42,5 saco 50kg", date: "2026-01-10", id: "old" },
    { description: "Cimento Portland 42,5 saco 50kg", date: "2026-09-01", id: "new" },
    { description: "Areia fina", date: "2026-10-01", id: "areia" },
  ];
  assert.equal(bestMatch("Cimento Portland 42,5 saco 50kg", rows).id, "new");
  assert.equal(bestMatch("Areia fina lavada", rows).id, "areia");
  assert.equal(bestMatch("Varão 12 mm", rows), null);
});
