const test = require("node:test");
const assert = require("node:assert/strict");
const { eDoBanco } = require("../src/routes/banks");

const BFA = { code: "BFA", name: "Banco de Fomento Angola", aliases: ["FOMENTO"] };
const BMA = { code: "BMA", name: "Banco Millennium Atlântico", aliases: ["ATL", "ATLANTICO", "MILLENNIUM"] };

test("o banco de uma conta reconhece-se pela sigla, pelo nome ou por outro nome", () => {
  assert.equal(eDoBanco("BFA", BFA), true);
  assert.equal(eDoBanco("bfa 08", BFA), true);
  assert.equal(eDoBanco("Banco de Fomento Angola", BFA), true);
  assert.equal(eDoBanco("FOMENTO ANGOLA SA", BFA), true);
  assert.equal(eDoBanco("Millennium Atlantico", BMA), true, "sem acentos");
  assert.equal(eDoBanco("ATL 02", BMA), true);
  assert.equal(eDoBanco("BAI", BFA), false);
  assert.equal(eDoBanco("", BFA), false);
  assert.equal(eDoBanco("SALTO", BMA), false, "«ATL» dentro de outra palavra não conta");
});
