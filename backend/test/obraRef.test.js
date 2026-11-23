const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const core = () => import(pathToFileURL(path.join(__dirname, "../../frontend/src/shared/obraRefCore.js")).href);

test("referência da obra no lugar do código; sem referência fica o nome", async () => {
  const { trocarCodigos } = await core();
  const refs = new Map([["OBR-MP5N7CKS-MV21", "INF/MBT03/2026"], ["OBR-MROQR641-4FRR", null]]);
  assert.equal(trocarCodigos("OBR-MP5N7CKS-MV21 · Projecto do Sumbe", refs), "INF/MBT03/2026 · Projecto do Sumbe");
  assert.equal(trocarCodigos("OBR-MROQR641-4FRR · Obra Teste FLUXO", refs), "Obra Teste FLUXO");
  assert.equal(trocarCodigos("Obra Teste FLUXO — OBR-MROQR641-4FRR", refs), "Obra Teste FLUXO");
  assert.equal(trocarCodigos("OBR-MROQR641-4FRR", refs), "—");
  assert.equal(trocarCodigos("Obras: OBR-MP5N7CKS-MV21, OBR-XXXXXXXX-ZZZZ", refs), "Obras: INF/MBT03/2026, OBR-XXXXXXXX-ZZZZ", "códigos desconhecidos ficam");
  assert.equal(trocarCodigos("sem código nenhum", refs), "sem código nenhum");
});
