const test = require("node:test");
const assert = require("node:assert/strict");

const det = require("../src/services/ai/alerts/detectors");
const svc = require("../src/services/ai/alerts/service");

// Segunda-feira, 16/11/2026, 10:00 (hora local)
const NOW = new Date(2026, 10, 16, 10, 0);
const day = (offset) => new Date(2026, 10, 16 + offset, 0, 0);
const project = { id: "p1", code: "OB-1" };

test("atraso em cadeia: propaga pelos sucessores FS e ignora o que já começou", () => {
  const plans = [
    { id: "a", description: "Cofragem", date: day(-5), plannedEndDate: day(-2), status: "IN_PROGRESS" },
    { id: "b", description: "Betonagem", date: day(1), plannedEndDate: day(1), status: "DRAFT" },
    { id: "c", description: "Descofragem", date: day(2), plannedEndDate: day(2), status: "DRAFT" },
    { id: "d", description: "Já arrancou", date: day(0), plannedEndDate: day(1), status: "IN_PROGRESS" },
    { id: "e", description: "Folga larga", date: day(20), plannedEndDate: day(21), status: "DRAFT" },
  ];
  const deps = [
    { predecessorId: "a", successorId: "b", type: "FS", lagDays: 1 },
    { predecessorId: "b", successorId: "c", type: "FS", lagDays: 0 },
    { predecessorId: "a", successorId: "d", type: "FS", lagDays: 0 },
    { predecessorId: "a", successorId: "e", type: "FS", lagDays: 0 },
    { predecessorId: "a", successorId: "c", type: "SS", lagDays: 0 },
  ];
  const out = det.detectChainDelays(project, plans, deps, NOW);
  assert.equal(out.length, 1);
  const [alert] = out;
  assert.equal(alert.fingerprint, "CHAIN_DELAY:a");
  assert.equal(alert.severity, "HIGH", "sucessor começa amanhã");
  // "a" acaba no mínimo hoje → "b" (folga 1) só pode começar dia +2 (1 dia de desvio) → "c" no dia +3 (1 dia).
  assert.deepEqual(alert.metadata.impacted.map((x) => [x.id, x.slipDays]), [["b", 1], ["c", 1]]);
  assert.equal(alert.metadata.rootPlan.daysLate, 2);
});

test("atraso em cadeia: sem sucessores afetados não há alerta; plano em atraso dentro da cadeia não é raiz", () => {
  const plans = [
    { id: "a", date: day(-6), plannedEndDate: day(-4), status: "DRAFT" },
    { id: "b", date: day(-3), plannedEndDate: day(-1), status: "DRAFT" },
    { id: "c", date: day(1), plannedEndDate: day(1), status: "DRAFT" },
  ];
  const deps = [
    { predecessorId: "a", successorId: "b", type: "FS", lagDays: 0 },
    { predecessorId: "b", successorId: "c", type: "FS", lagDays: 0 },
  ];
  const out = det.detectChainDelays(project, plans, deps, NOW);
  assert.equal(out.length, 1, "um alerta por cadeia, a partir da raiz");
  assert.equal(out[0].fingerprint, "CHAIN_DELAY:a");
  assert.deepEqual(det.detectChainDelays(project, [plans[0]], [], NOW), []);
});

test("falta de material: urgente quando é para daqui a ≤ 2 dias", () => {
  const out = det.detectMaterialShortages(
    project,
    [
      { productId: "x", product: "Cimento", unit: "saco", needed: 50, inStock: 20, missing: 30, neededOn: "2026-11-17", plans: ["Laje"] },
      { productId: "y", product: "Areia", unit: "m3", needed: 5, inStock: 0, missing: 5, neededOn: "2026-11-20", plans: [] },
    ],
    NOW
  );
  assert.deepEqual(out.map((a) => [a.fingerprint, a.severity]), [
    ["MATERIAL_SHORTAGE:p1:x", "HIGH"],
    ["MATERIAL_SHORTAGE:p1:y", "MEDIUM"],
  ]);
  assert.match(out[0].body, /Faltam 30 saco/);
  assert.match(out[0].body, /criar a necessidade/);
});

test("necessidades paradas: só PENDING/EM_ANALISE com N+ dias; urgente se ALTA ou o dobro do prazo", () => {
  const out = det.detectStalledNeeds(
    project,
    [
      { id: "n1", description: "Ferro", status: "PENDING", priority: "MEDIA", date: day(-4) },
      { id: "n2", description: "Tinta", status: "EM_ANALISE", priority: "ALTA", date: day(-3) },
      { id: "n3", description: "Areia", status: "PENDING", priority: "MEDIA", date: day(-8) },
      { id: "n4", description: "Recente", status: "PENDING", priority: "ALTA", date: day(-1) },
      { id: "n5", description: "Cotação", status: "IN_QUOTATION", priority: "MEDIA", date: day(-9) },
    ],
    NOW
  );
  assert.deepEqual(out.map((a) => [a.fingerprint, a.severity]), [
    ["STALLED_NEED:n1", "MEDIUM"],
    ["STALLED_NEED:n2", "HIGH"],
    ["STALLED_NEED:n3", "HIGH"],
  ]);
  assert.equal(out[0].title, 'OB-1: "Ferro" por aprovar há 4 dia(s)');
});

test("derrapagem orçamental por centro de custo", () => {
  const out = det.detectBudgetOverruns(
    project,
    [
      { costCenterId: "c1", code: "CC1", name: "Estrutura", currency: "AOA", previsto: 1000, realizado: 1150 },
      { costCenterId: "c2", code: "CC2", name: "Acabamentos", currency: "AOA", previsto: 1000, realizado: 1300 },
      { costCenterId: "c3", code: "CC3", name: "Ok", currency: "AOA", previsto: 1000, realizado: 1050 },
      { costCenterId: "c4", code: "CC4", name: "Sem previsto", currency: "AOA", previsto: 0, realizado: 500 },
    ],
    40
  );
  assert.deepEqual(out.map((a) => [a.fingerprint, a.severity, a.metadata.overPct]), [
    ["BUDGET_OVERRUN:c1", "MEDIUM", 15],
    ["BUDGET_OVERRUN:c2", "HIGH", 30],
  ]);
});

test("destinatário só recebe alertas das suas obras e das secções que vê", () => {
  const alerts = [
    { id: "1", projectId: "p1", kind: "CHAIN_DELAY" },
    { id: "2", projectId: "p1", kind: "BUDGET_OVERRUN" },
    { id: "3", projectId: "p2", kind: "STALLED_NEED" },
    { id: "4", projectId: "p1", kind: "MATERIAL_SHORTAGE" },
  ];
  const recipient = { projectIds: ["p1"], modules: { obras: true, stock: false, financeiro: true } };
  assert.deepEqual(svc.alertsForRecipient(alerts, recipient, "FULL").map((a) => a.id), ["1", "2"]);
  assert.deepEqual(svc.alertsForRecipient(alerts, recipient, "FINANCIAL").map((a) => a.id), ["2"]);
  assert.deepEqual(svc.alertsForRecipient(alerts, recipient, "OPERATIONAL").map((a) => a.id), ["1"]);
});

test("lista diária de alertas: hora, domingo e já enviada hoje", () => {
  const rule = { enabled: true, digestType: "PREDICTIVE_ALERTS", sendTime: "07:30", lastRunKey: null };
  assert.equal(svc.isPredictiveDue(rule, NOW), true);
  assert.equal(svc.isPredictiveDue({ ...rule, sendTime: "11:00" }, NOW), false);
  assert.equal(svc.isPredictiveDue({ ...rule, lastRunKey: "2026-11-16" }, NOW), false);
  assert.equal(svc.isPredictiveDue(rule, new Date(2026, 10, 15, 10, 0)), false, "domingo");
  assert.equal(svc.isPredictiveDue({ ...rule, digestType: "URGENT_ALERTS" }, NOW), false, "urgentes saem logo, não à hora");
});

test("texto do alerta: curto na notificação, completo no email", () => {
  const list = Array.from({ length: 7 }, (_, i) => ({ severity: i ? "MEDIUM" : "HIGH", title: `A${i}`, body: `corpo ${i}`, aiExplanation: i ? null : "Aprovar hoje." }));
  const short = svc.alertsText(list);
  assert.match(short, /^🔴 A0/);
  assert.match(short, /… e mais 2\./);
  const full = svc.alertsText(list, { full: true });
  assert.match(full, /corpo 6/);
  assert.match(full, /IA: Aprovar hoje\./);
});

test("a IA não recebe identificadores internos", () => {
  const out = svc.withoutIds({ needId: "x", id: "y", description: "Areia", impacted: [{ id: "a", description: "Laje", slipDays: 2 }] });
  assert.deepEqual(out, { description: "Areia", impacted: [{ description: "Laje", slipDays: 2 }] });
});
