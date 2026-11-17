const test = require("node:test");
const assert = require("node:assert/strict");

const svc = require("../src/services/ai/digests/service");
const { ruleHighlights, sectionsFor } = require("../src/services/ai/digests/facts");

// Segunda-feira, 16/11/2026, 08:00 (hora local)
const MONDAY_8 = new Date(2026, 10, 16, 8, 0);
const SUNDAY_8 = new Date(2026, 10, 15, 8, 0);

test("período: chave diária e semanal (ISO)", () => {
  assert.equal(svc.periodFor("DAILY_SUMMARY", MONDAY_8).key, "2026-11-16");
  assert.equal(svc.periodFor("WEEKLY_SUMMARY", MONDAY_8).key, "2026-W47");
  assert.equal(svc.isoWeekKey(new Date(2027, 0, 1)), "2026-W53");
});

test("isRuleDue: hora, dia da semana e período já enviado", () => {
  const daily = { enabled: true, digestType: "DAILY_SUMMARY", sendTime: "07:30", lastRunKey: null };
  assert.equal(svc.isRuleDue(daily, MONDAY_8), true);
  assert.equal(svc.isRuleDue({ ...daily, sendTime: "08:30" }, MONDAY_8), false, "ainda não é hora");
  assert.equal(svc.isRuleDue({ ...daily, lastRunKey: "2026-11-16" }, MONDAY_8), false, "já enviado hoje");
  assert.equal(svc.isRuleDue(daily, SUNDAY_8), false, "não há resumo diário ao domingo");
  assert.equal(svc.isRuleDue({ ...daily, enabled: false }, MONDAY_8), false);

  const weekly = { enabled: true, digestType: "WEEKLY_SUMMARY", sendTime: "07:30", lastRunKey: "2026-W46" };
  assert.equal(svc.isRuleDue(weekly, MONDAY_8), true);
  assert.equal(svc.isRuleDue(weekly, new Date(2026, 10, 17, 8, 0)), false, "semanal só à segunda");
  assert.equal(svc.isRuleDue({ ...weekly, digestType: "PREDICTIVE_ALERTS" }, MONDAY_8), false, "alertas não são resumos");
});

test("secções: conteúdo escolhido ∩ módulos do utilizador", () => {
  const all = { obras: true, stock: true, financeiro: true };
  assert.deepEqual(sectionsFor("FULL", all), ["progress", "needs", "stock", "budget", "payments"]);
  assert.deepEqual(sectionsFor("FINANCIAL", all), ["budget", "payments"]);
  assert.deepEqual(sectionsFor("FULL", { obras: true, stock: false, financeiro: false }), ["progress", "needs"]);
  assert.deepEqual(sectionsFor("FINANCIAL", { obras: true, stock: true, financeiro: false }), []);
});

test("pontos de atenção por regras", () => {
  const out = ruleHighlights({
    code: "OB-1",
    status: "ACTIVE",
    progress: { physicalProgressPct: 40, timeElapsedPct: 70, scheduleGapPts: -30, daysToDue: 20, latePlansCount: 3 },
    needs: { stalledCount: 2 },
    stock: { shortagesCount: 1, shortages: [{ product: "Cimento", missing: 5, unit: "saco", neededOn: "2026-11-18" }] },
    budget: { committedPct: 60, mainCurrency: "AOA", costGapPts: 20 },
    payments: { overdueCount: 1 },
  });
  const text = out.map((o) => o.text).join("\n");
  assert.match(text, /OB-1: avanço físico 40% para 70% do prazo decorrido/);
  assert.match(text, /3 plano\(s\) diário\(s\) atrasado/);
  assert.match(text, /Cimento, 5 saco até 2026-11-18/);
  assert.match(text, /comprometido 60% \(AOA\)/);
  assert.match(text, /1 pagamento\(s\) em atraso/);

  const late = ruleHighlights({ code: "OB-2", progress: { physicalProgressPct: 90, timeElapsedPct: 100, scheduleGapPts: -10, daysToDue: -5, latePlansCount: 0 } });
  assert.equal(late.length, 1, "prazo ultrapassado não repete o desvio de prazo");
  assert.match(late[0].text, /prazo ultrapassado há 5 dia/);
});

test("IA: só recebe categorias autorizadas e nunca obras excluídas", () => {
  const projects = [
    { id: "p1", code: "OB-1", name: "A", status: "ACTIVE", progress: { x: 1 }, budget: { y: 2 }, payments: { z: 3 } },
    { id: "p2", code: "OB-2", name: "B", status: "ACTIVE", progress: { x: 1 } },
  ];
  const input = svc.aiInputFor(projects, { progress: "on", budget: "off", payments: "anonymize" }, new Set(["p2"]));
  assert.equal(input.items.length, 1);
  assert.deepEqual(Object.keys(input.items[0]).sort(), ["code", "name", "payments", "progress", "status"]);
  assert.deepEqual(input.categories.sort(), ["payments", "progress"]);
  assert.deepEqual(input.projectIds, ["p1"]);

  const none = svc.aiInputFor(projects, {}, new Set());
  assert.equal(none.items.length, 0, "sem categorias autorizadas não há chamada à IA");
});

test("texto do email inclui pontos de atenção e obras", () => {
  const text = svc.plainText({
    title: "Resumo diário · 16/11 · 1 obra",
    headline: "1 ponto de atenção.",
    highlights: ["OB-1: 1 pagamento(s) em atraso."],
    projects: [{ code: "OB-1", name: "A", payments: { overdueCount: 1 } }],
  });
  assert.match(text, /Pontos de atenção:\n• OB-1/);
  assert.match(text, /- OB-1 · A: 1 pagamento\(s\) em atraso/);
});
