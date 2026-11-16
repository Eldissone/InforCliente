const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanAnalysis } = require("../src/services/ai/photos/service");

const tasks = [{ ref: "T1", id: "t1", wbsCode: "2.3", description: "Betonagem da laje" }];

test("análise: tarefa da lista, riscos normalizados, categorias e gravidades desconhecidas", () => {
  const out = cleanAnalysis(
    {
      caption: "  Betonagem   da laje  ",
      taskRef: "T1",
      taskConfidence: "alta",
      ppe: "ok",
      risks: [
        { category: "fall", severity: "high", description: "Bordo da laje sem guarda-corpos" },
        { category: "QUALQUER", severity: "enorme", description: "Material espalhado" },
        { category: "PPE", description: "x" },
      ],
    },
    tasks
  );
  assert.equal(out.caption, "Betonagem da laje");
  assert.equal(out.taskId, "t1");
  assert.equal(out.taskLabel, "2.3 · Betonagem da laje");
  assert.deepEqual(out.risks.map((r) => [r.category, r.severity]), [["FALL", "HIGH"], ["OTHER", "MEDIUM"]]);
});

test("análise: tarefa inventada é ignorada; falta de EPI sem risco listado gera um", () => {
  const out = cleanAnalysis({ caption: "Obra", taskRef: "T99", ppe: "falta", risks: [] }, tasks);
  assert.equal(out.taskId, null);
  assert.equal(out.taskConfidence, null);
  assert.equal(out.risks.length, 1);
  assert.equal(out.risks[0].category, "PPE");
});

test("análise: resposta vazia não rebenta", () => {
  const out = cleanAnalysis(undefined, tasks);
  assert.deepEqual(out, { caption: null, taskId: null, taskLabel: null, taskConfidence: null, ppe: null, risks: [] });
});
