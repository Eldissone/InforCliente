const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/services/fleet/fleetCore");

const HOJE = "2026-11-28";
const V1 = { id: "v1", plate: "LD-01-AA", brand: "Toyota", model: "Hilux", unit: "KM", odometer: 52000, odometerAt: "2026-11-20", status: "Operacional", active: true, refConsumption: 10, tankCapacity: 80, maintenancePlans: [] };

test("proximoCodigo continua a série do ano", () => {
  assert.equal(F.proximoCodigo("AB", ["AB-2026-001", "AB-2026-009", "AB-2025-050"], { ano: 2026 }), "AB-2026-010");
  assert.equal(F.proximoCodigo("FR", []), "FR-001");
});

test("estadoDocumento: válido, a caducar, caducado, arquivado", () => {
  assert.equal(F.estadoDocumento({ expiryDate: "2027-06-01" }, HOJE)[1], "good");
  assert.equal(F.estadoDocumento({ expiryDate: "2026-12-10" }, HOJE)[1], "warn");
  assert.equal(F.estadoDocumento({ expiryDate: "2026-11-01" }, HOJE)[1], "bad");
  assert.equal(F.estadoDocumento({ expiryDate: "2026-11-01", situation: "Arquivado" }, HOJE)[1], "neu");
});

test("estadoCarta avisa com 60 dias", () => {
  assert.equal(F.estadoCarta({ licenseExpiry: "2027-01-15" }, HOJE)[1], "warn");
  assert.equal(F.estadoCarta({ licenseExpiry: "2027-06-15" }, HOJE)[1], "good");
});

test("estadoPlano por km e por meses", () => {
  const v = { ...V1, odometer: 59500 };
  assert.equal(F.estadoPlano(v, { nome: "REVISÃO", km: 10000, ultKm: 50000 }, HOJE).k, "warn");
  assert.equal(F.estadoPlano({ ...V1, odometer: 61000 }, { nome: "REVISÃO", km: 10000, ultKm: 50000 }, HOJE).k, "bad");
  assert.equal(F.estadoPlano(V1, { nome: "ÓLEO", meses: 6, ultData: "2026-01-01" }, HOJE).k, "bad");
  assert.equal(F.estadoPlano(V1, { nome: "ÓLEO", meses: 6, ultData: "2026-10-01" }, HOJE).k, "good");
});

test("abastecimentos: consumo e km abaixo do anterior", () => {
  const ab = [
    { id: "a1", vehicleId: "v1", date: "2026-11-01", odometer: 50000, liters: 50, amount: 20000 },
    { id: "a2", vehicleId: "v1", date: "2026-11-10", odometer: 50500, liters: 50, amount: 20000 },
    { id: "a3", vehicleId: "v1", date: "2026-11-15", odometer: 50400, liters: 40, amount: 16000 },
  ];
  const C = F.calcularAbastecimentos(ab, [V1]);
  assert.equal(C.get("a2").cons, 10);
  assert.equal(C.get("a2").an.length, 0);
  assert.equal(C.get("a3").an[0][0], "bad");
});

test("linhas de custo e custos por viatura", () => {
  const dados = {
    viaturas: [V1],
    abastecimentos: [{ id: "a1", code: "AB-1", vehicleId: "v1", date: "2026-11-01", odometer: 50000, liters: 50, amount: 20000 }],
    intervencoes: [{ id: "i1", code: "OS-1", vehicleId: "v1", date: "2026-11-05", odometer: 50300, type: "Reparação", description: "Travões", laborCost: 5000, partsCost: 15000 }],
    ocorrencias: [{ id: "o1", code: "OC-1", vehicleId: "v1", date: "2026-11-06", type: "Multa", description: "Velocidade", cost: 3000, status: "Resolvida" }],
    documentos: [{ id: "d1", vehicleId: "v1", type: "Taxa de Circulação", issueDate: "2026-02-01", cost: 1000 }],
  };
  const c = F.custosViatura("v1", dados, {});
  assert.equal(c.total, 44000);
  assert.equal(c.porCategoria.find((x) => x.categoria === "Multas").valor, 3000);
  assert.equal(c.percurso, 300);
  const r = F.custosResumo(dados, { de: "2026-11-01" });
  assert.equal(r[0].total, 43000);
});

test("alertas: sem seguro, documentos em falta, ocorrência crítica", () => {
  const dados = {
    viaturas: [V1],
    ocorrencias: [{ id: "o1", code: "OC-1", vehicleId: "v1", date: "2026-11-20", type: "Acidente", severity: "Crítica", status: "Aberta" }],
    seguros: [],
    documentos: [],
  };
  const A = F.alertas(dados, HOJE);
  assert.ok(A.some((a) => a.area === "Seguro" && a.p === 1));
  assert.equal(A.filter((a) => a.area === "Documentos").length, 3);
  assert.ok(A.some((a) => a.area === "Ocorrências" && a.p === 1));
  assert.equal(A[0].p, 1);
  const comSeguro = F.alertas({ ...dados, seguros: [{ vehicleIds: ["v1"], insurer: "ENSA", startDate: "2026-01-01", endDate: "2027-01-01" }] }, HOJE);
  assert.ok(!comSeguro.some((a) => a.area === "Seguro"));
});

test("painel conta viaturas ativas e custo do ano", () => {
  const p = F.painel({ viaturas: [V1, { ...V1, id: "v2", plate: "X", status: "Vendida" }], abastecimentos: [{ id: "a", vehicleId: "v1", date: "2026-03-01", liters: 30, amount: 9000 }] }, HOJE);
  assert.equal(p.ativas, 1);
  assert.equal(p.custoAno, 9000);
  assert.equal(p.litrosAno, 30);
});
