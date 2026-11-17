const test = require("node:test");
const assert = require("node:assert/strict");

const { parseLocal, cleanIntent, rankProjects } = require("../src/services/ai/command/service");

test("frases comuns resolvidas sem IA", () => {
  assert.deepEqual(parseLocal("abrir obra Talatona"), { action: "open_project", project: "Talatona" });
  assert.deepEqual(parseLocal("ver as fotos da obra OBR-12"), { action: "open_project", project: "OBR-12", tab: "galeria_obra" });
  assert.deepEqual(parseLocal("nova necessidade de 20 sacos de cimento para a obra Viana"), {
    action: "new_need",
    text: "20 sacos de cimento",
    project: "Viana",
  });
  assert.deepEqual(parseLocal("pedir areia fina na obra Cacuaco"), { action: "new_need", text: "areia fina", project: "Cacuaco" });
  assert.deepEqual(parseLocal("registar execução: betonámos 12 m3 da laje na obra Viana"), {
    action: "register_progress",
    text: "betonámos 12 m3 da laje",
    project: "Viana",
  });
  assert.deepEqual(parseLocal("Aprovações"), { action: "open_approvals" });
  assert.deepEqual(parseLocal("alertas"), { action: "open_alerts" });
  assert.equal(parseLocal("pagamentos que vencem esta semana?").action, "ask");
  assert.equal(parseLocal("quais obras estão atrasadas").action, "ask");
  assert.equal(parseLocal("fornecedores"), null, "texto solto fica para a lista local / IA");
});

test("resposta da IA é limpa e nunca devolve ações desconhecidas", () => {
  assert.deepEqual(cleanIntent({ action: "delete_everything" }, "x"), { action: "ask", question: "x" });
  assert.deepEqual(cleanIntent({ action: "open_project", project: "Viana", tab: "hack" }, "x"), { action: "open_project", project: "Viana" });
  assert.deepEqual(cleanIntent({ action: "new_need", text: "cimento" }, "frase"), { action: "ask", question: "frase" }, "sem obra → pergunta");
  assert.deepEqual(cleanIntent({ action: "open_page", page: "fornecedores" }, "x"), { action: "open_page", page: "fornecedores" });
  assert.deepEqual(cleanIntent(null, "frase"), { action: "ask", question: "frase" });
});

test("obras ordenadas por código e nome", () => {
  const projects = [
    { id: "1", code: "OBR-AAA-1", name: "Edifício Talatona", referencia: null },
    { id: "2", code: "OBR-BBB-2", name: "Subestação de Viana", referencia: "SE-VIANA" },
    { id: "3", code: "OBR-CCC-3", name: "Armazém Cacuaco", referencia: null },
  ];
  assert.equal(rankProjects("OBR-BBB-2", projects)[0].id, "2");
  assert.equal(rankProjects("viana", projects)[0].id, "2");
  assert.equal(rankProjects("talatona", projects)[0].id, "1");
  assert.equal(rankProjects("Luanda Sul", projects).length, 0);
});
