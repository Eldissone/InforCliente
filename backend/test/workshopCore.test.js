const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../src/services/fleet/workshopCore");

const HOJE = "2026-11-28";
const ot = (o) => ({ id: o.id || "x", code: "OT-2026-001", vehicleId: "v1", date: "2026-11-20", workOrderStatus: "Marcado", workOrder: {}, ...o });

test("minutos e horas de trabalho", () => {
  assert.equal(W.minutos("08:00", "12:30"), 270);
  assert.equal(W.minutos("12:00", "08:00"), 0);
  assert.equal(W.minutos("", "08:00"), 0);
  assert.equal(W.horasOT({ horas: [{ ini: "08:00", fim: "10:00" }, { ini: "14:00", fim: "15:30" }] }), 3.5);
});

test("dia da OT: marcado, pretendido, data", () => {
  assert.equal(W.diaOT(ot({ workOrder: { dm: "2026-12-01", pedido: { dp: "2026-11-30" } } })), "2026-12-01");
  assert.equal(W.diaOT(ot({ workOrder: { pedido: { dp: "2026-11-30" } } })), "2026-11-30");
  assert.equal(W.diaOT(ot({ workOrder: null })), "2026-11-20");
});

test("situação: atrasada, material, pronta", () => {
  assert.equal(W.situacao(ot({ workOrderStatus: "Em Trabalho", workOrder: { dm: "2026-11-20", de: "2026-11-25" } }), HOJE)[1], "bad");
  assert.equal(W.situacao(ot({ workOrderStatus: "Marcado", workOrder: { dm: "2026-12-02", mat: [{ desc: "filtro", est: "Por entregar" }] } }), HOJE)[0], "Material por receber");
  assert.equal(W.situacao(ot({ workOrderStatus: "Concluído" }), HOJE)[0], "Pronta para entrega");
  assert.equal(W.situacao(ot({ workOrderStatus: "Pedido" }), HOJE)[1], "warn");
});

test("mudarEstado: datas, estado da intervenção e da viatura", () => {
  const r = W.mudarEstado(ot({ workOrderStatus: "Marcado" }), "Recebida", { hoje: HOJE, por: "Ana" });
  assert.equal(r.data.entryDate, HOJE);
  assert.equal(r.data.status, "Em curso");
  assert.equal(r.viatura.status, "Em manutenção");
  assert.equal(r.data.workOrder.chat.at(-1).t, "Estado: Recebida");
  const e = W.mudarEstado(ot({ workOrderStatus: "Concluído", exitDate: "2026-11-27" }), "Entregue", { hoje: HOJE, por: "Ana" });
  assert.equal(e.data.status, "Concluída");
  assert.equal(e.data.exitDate, undefined);
  assert.ok(e.viatura.so("Em manutenção"));
  const m = W.mudarEstado(ot({ workOrderStatus: "Pedido", workOrder: { pedido: { dp: "2026-12-03" } } }), "Marcado", { hoje: HOJE, por: "Ana" });
  assert.equal(m.data.workOrder.dm, "2026-12-03");
  assert.equal(W.mudarEstado(ot({ vehicleId: null }), "Recebida", { hoje: HOJE, por: "x" }).viatura, null);
  assert.throws(() => W.mudarEstado(ot({}), "Voando", { hoje: HOJE, por: "x" }));
});

test("calendário e indicadores", () => {
  const L = [
    ot({ id: "a", workOrderStatus: "Pedido", workOrder: { pedido: { dp: "2026-11-29" } } }),
    ot({ id: "b", workOrderStatus: "Recebida", workOrder: { dm: HOJE, mat: [{ est: "Não recebido" }] } }),
    ot({ id: "c", workOrderStatus: "Entregue", entryDate: "2026-11-20", exitDate: "2026-11-23", workOrder: { dm: "2026-11-20", de: "2026-11-24", horas: [{ tec: "Rui", ini: "08:00", fim: "12:00" }] }, laborCost: 20000 }),
    ot({ id: "d", workOrderStatus: "Cancelado" }),
  ];
  const c = W.calendario(L, HOJE);
  assert.deepEqual(c.kpis, { pedidos: 1, hoje: 1, dentro: 1, material: 1, atrasados: 0 });
  const k = W.indicadores(L);
  assert.equal(k.feitas, 1);
  assert.equal(k.tempoMedio, 3);
  assert.equal(k.pctPrazo, 1);
  assert.equal(k.horas, 4);
  assert.equal(k.porTecnico[0].tec, "Rui");
  assert.equal(W.materiais(L).length, 1);
});
