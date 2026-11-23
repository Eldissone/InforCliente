const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const mod = (f) => import(pathToFileURL(path.join(__dirname, `../../frontend/src/shared/comercial/${f}`)).href);

const P = { inicio: "2026-01-01", fim: "2026-03-31", pmp: 45, iva: 0.14 };
const R = { PVsi: 900, C: { RH: 300, MAT: 0 }, mat: [] };

test("sem planeamento: produção linear, adiantamento amortizado nos autos, retenção e prazos", async () => {
  const F = await mod("cronogramaFin.js");
  const o = F.calcular({ P, R, mat: [], plano: null, terms: { modo: "amort", adPct: 0.3, per: "Mensal", aprov: 15, pag: 30, ret: 0.05 }, fin: {} });
  assert.equal(o.basis, "linear");
  assert.equal(o.A, 270);
  assert.deepEqual(o.autos.map((x) => x.d), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  const v = o.autos.reduce((s, x) => s + x.v, 0);
  assert.ok(Math.abs(v - 900) < 1e-6);
  const am = o.autos.reduce((s, x) => s + x.am, 0);
  assert.ok(Math.abs(am - 270) < 1e-6, "o adiantamento fica todo amortizado");
  assert.equal(o.autos[0].ap, "2026-02-15");
  assert.equal(o.autos[0].rc, "2026-03-17");
  // Entradas: adiantamento + líquidos = PV − retenção
  const ent = Object.values(o.ent).reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(ent - (900 - 45)) < 1e-6);
});

test("salários no fim do mês, saldo acumulado e maior défice (T2); IVA e meses (T1)", async () => {
  const F = await mod("cronogramaFin.js");
  const o = F.calcular({ P, R, mat: [], plano: null, terms: { modo: "autos", per: "Mensal", aprov: 0, pag: 30, ret: 0 }, fin: { saldo0: 0 } });
  const T = F.tesouraria(o, "M");
  const jan = T.linhas.find((l) => l.k === "2026-01");
  assert.ok(Math.abs(jan.sal - (300 * 31) / 90) < 1e-6, "salário de janeiro pago a 31/01");
  assert.equal(jan.ent, 0);
  assert.ok(T.minB < 0, "antes do primeiro auto a obra está a débito");
  const C = F.cliente(o, 0.14);
  assert.equal(C.linhas.length, 3);
  assert.ok(Math.abs(C.linhas[0].tot - C.linhas[0].liq * 1.14) < 1e-9);
  assert.equal(C.meses[0].k, "2026-03");
});

test("com planeamento: os materiais pagam-se pela condição e pela data da tarefa", async () => {
  const F = await mod("cronogramaFin.js");
  const PC = await mod("producaoCore.js");
  const plano = PC.planear({ cal: { inicio: "2026-02-02", dias: 5, efic: 1 }, tarefas: [{ id: "a", nome: "Postes", q: 10, rend: 5, equipas: 1, equipa: [{ f: "X", n: 2 }], mat: [{ desc: "Poste", c: 1 }] }] });
  const o = F.calcular({
    P,
    R: { PVsi: 1000, C: { MAT: 500, RH: 100 }, mat: [{ ct: 500 }] },
    mat: [{ desc: "Poste", cond: "Crédito 30 dias", entrega: 10 }],
    plano,
    terms: { modo: "autos", per: "Mensal", aprov: 0, pag: 0, ret: 0 },
    fin: {},
  });
  assert.equal(o.basis, "producao");
  assert.equal(o.a, "2026-02-02");
  assert.deepEqual(Object.keys(o.pag.mat).sort(), ["2026-03-04", "2026-03-05"]);
  assert.equal(o.compras[0].enc, "2026-01-23");
  assert.ok(Math.abs(o.autos.reduce((s, x) => s + x.v, 0) - 1000) < 1e-6);
});

test("T2: «o adiantamento paga a obra até» — último período antes do acumulado negativo", async () => {
  const F = await mod("cronogramaFin.js");
  const o = { f: { saldo0: 0 }, ent: { "2026-01-05": 100 }, pag: { mat: { "2026-01-20": 50, "2026-02-10": 80 }, sal: {}, mei: {}, out: {} } };
  const T = F.tesouraria(o, "M");
  assert.deepEqual([T.cobre, T.negativoEm, T.minB], ["2026-01", "2026-02", -30]);
  const T2 = F.tesouraria({ ...o, pag: { mat: { "2026-01-20": 150 }, sal: {}, mei: {}, out: {} } }, "M");
  assert.deepEqual([T2.cobre, T2.negativoEm], [null, "2026-01"]);
});
