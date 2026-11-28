/**
 * Importa apólices de seguro da Frota a partir de um JSON
 * ({ corrigirMatricula: { errada: certa }, apolices: [...] }).
 * Cada apólice liga-se à viatura pela matrícula; sem data de fim, o fim é o
 * início + 1 ano (menos um dia).
 *
 *   node scripts/importFrotaSeguros.js scripts/data/frota-seguros-2026-11.json            (simulação)
 *   node scripts/importFrotaSeguros.js scripts/data/frota-seguros-2026-11.json --aplicar  (grava)
 *
 * Não duplica: uma apólice (seguradora + n.º) que já existe é ignorada; uma
 * matrícula que não existe na frota fica de fora e é listada.
 */

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const F = require("../src/services/fleet/fleetCore");

const prisma = new PrismaClient();
const ficheiro = process.argv[2];
const aplicar = process.argv.includes("--aplicar");
if (!ficheiro) {
  console.error("Indique o ficheiro JSON.");
  process.exit(1);
}

const umAno = (d) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCFullYear(x.getUTCFullYear() + 1);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};
const chave = (seg, num) => `${String(seg).trim().toUpperCase()}|${String(num).replace(/\s+/g, "").toUpperCase()}`;

(async () => {
  const J = JSON.parse(fs.readFileSync(path.resolve(ficheiro), "utf8"));
  const corrige = J.corrigirMatricula || {};
  const porMatricula = new Map((await prisma.fleetVehicle.findMany({ select: { id: true, plate: true } })).map((v) => [v.plate, v.id]));
  const existentes = new Set((await prisma.fleetInsurance.findMany({ select: { insurer: true, policyNumber: true } })).map((s) => chave(s.insurer, s.policyNumber)));
  const codigos = (await prisma.fleetInsurance.findMany({ where: { code: { startsWith: "SEG-" } }, select: { code: true } })).map((s) => s.code);
  const novas = [];
  const fora = [];
  for (const a of J.apolices) {
    const plate = corrige[a.plate] || a.plate;
    const vid = porMatricula.get(plate);
    if (!vid) {
      fora.push([a.policyNumber, `matrícula ${a.plate} não existe na frota`]);
      continue;
    }
    const k = chave(a.insurer, a.policyNumber);
    if (existentes.has(k) || novas.some((n) => chave(n.insurer, n.policyNumber) === k)) {
      fora.push([a.policyNumber, "apólice já registada"]);
      continue;
    }
    const startDate = a.startDate;
    const endDate = a.endDate || umAno(startDate);
    novas.push({
      code: F.proximoCodigo("SEG", [...codigos, ...novas.map((n) => n.code)]),
      insurer: String(a.insurer).trim().toUpperCase(),
      policyNumber: String(a.policyNumber).trim().toUpperCase(),
      coverages: (a.coverages || []).filter(Boolean),
      vehicleIds: [vid],
      startDate,
      endDate,
      premium: a.premium === null || a.premium === undefined ? null : Number(a.premium),
      periodicity: F.LISTAS.periodicidades.includes(a.periodicity) ? a.periodicity : "ANUAL",
      _plate: plate,
      _corrigida: plate !== a.plate ? a.plate : "",
    });
  }

  console.log(`${J.apolices.length} apólice(s) no ficheiro · ${novas.length} a criar · ${fora.length} de fora`);
  for (const n of novas) {
    console.log(`  ${n.code}  ${n.policyNumber.padEnd(19)} ${n.insurer.slice(0, 22).padEnd(22)} ${n._plate.padEnd(13)} ${n.startDate} → ${n.endDate}  ${n.premium === null ? "—" : n.premium.toFixed(2)}  ${n.periodicity}${n._corrigida ? `   (tabela: ${n._corrigida})` : ""}`);
  }
  fora.forEach(([p, m]) => console.log(`  de fora: ${p} — ${m}`));

  if (!aplicar) {
    console.log("\nSimulação: nada foi gravado. Para gravar, repita com --aplicar.");
  } else {
    await prisma.$transaction(
      novas.map(({ _plate, _corrigida, startDate, endDate, ...d }) =>
        prisma.fleetInsurance.create({ data: { ...d, startDate: new Date(`${startDate}T00:00:00Z`), endDate: new Date(`${endDate}T00:00:00Z`), notes: "Importada da tabela de apólices (2026-11); data de fim = início + 1 ano — confirmar." } })
      )
    );
    console.log(`\nGravadas ${novas.length} apólice(s).`);
  }
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("Falhou:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
