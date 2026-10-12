const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizePersonnelProjectIds } = require("./personnelProjects");

test("INTERNO POST com dois projectIds usa a lista e sincroniza a obra principal com a primeira", () => {
  const result = normalizePersonnelProjectIds({
    type: "INTERNO",
    projectId: "legado-ignorado",
    projectIds: ["obra-a", "obra-b"],
  });
  assert.deepEqual(result.ids, ["obra-a", "obra-b"]);
  assert.equal(result.primaryId, "obra-a");
});

test("INTERNO aceita 0 obras e projectId legado quando projectIds não vem", () => {
  const empty = normalizePersonnelProjectIds({ type: "INTERNO", projectIds: [] });
  assert.deepEqual(empty.ids, []);
  assert.equal(empty.primaryId, null);

  const legacy = normalizePersonnelProjectIds({ type: "INTERNO", projectId: "obra-unica" });
  assert.deepEqual(legacy.ids, ["obra-unica"]);
  assert.equal(legacy.primaryId, "obra-unica");
});

test("SUBCONTRATADO fica só com a primeira obra mesmo se enviarem várias", () => {
  const result = normalizePersonnelProjectIds({
    type: "SUBCONTRATADO",
    projectIds: ["obra-a", "obra-b"],
  });
  assert.deepEqual(result.ids, ["obra-a"]);
  assert.equal(result.primaryId, "obra-a");
});
