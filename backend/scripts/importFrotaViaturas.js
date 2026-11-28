/**
 * Importa viaturas para a Frota a partir de um JSON (uma linha por viatura,
 * com os campos da folha da frota: matrícula, estado, marca, modelo, versão,
 * ano, cor, tipo de viatura, categoria, tipo de utilização, VIN, n.º motor,
 * caixa, combustível).
 *
 *   node scripts/importFrotaViaturas.js scripts/data/frota-viaturas-2026-11.json            (simulação)
 *   node scripts/importFrotaViaturas.js scripts/data/frota-viaturas-2026-11.json --aplicar  (grava)
 *
 * Não duplica: uma matrícula que já existe é ignorada. Os campos obrigatórios
 * em falta na folha (marca, modelo, tipo) ficam «N/D», para se completarem
 * depois na ficha.
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

const COMBUSTIVEL = { diesel: "Gasóleo", gasoleo: "Gasóleo", "gasóleo": "Gasóleo", gasolina: "Gasolina", eletrico: "Eléctrico", "eléctrico": "Eléctrico", hibrido: "Híbrido", "híbrido": "Híbrido" };
const ESTADOS = new Set(F.LISTAS.estadosViatura);
const ND = "N/D";

function linhaParaViatura(r) {
  const plate = String(r.plate || "").trim().toUpperCase().replace(/\s+/g, "-");
  const tipologia = F.TIPOLOGIAS.some(([k]) => k === r.tipologia) ? r.tipologia : "VIATURA";
  const fuel = COMBUSTIVEL[String(r.fuel || "").trim().toLowerCase()] || (r.fuel ? String(r.fuel).trim() : null);
  const status = ESTADOS.has(r.status) ? r.status : "Operacional";
  const faltam = ["brand", "model", "kind"].filter((k) => !String(r[k] || "").trim());
  return {
    faltam,
    data: {
      plate,
      tipologia,
      kind: String(r.kind || ND).trim().toUpperCase(),
      brand: String(r.brand || ND).trim().toUpperCase(),
      model: String(r.model || ND).trim().toUpperCase(),
      year: Number.isFinite(Number(r.year)) && r.year ? Number(r.year) : null,
      unit: ["MAQUINA", "EQUIPAMENTO"].includes(tipologia) ? "HORAS" : "KM",
      fuel,
      status,
      active: !["Vendida", "Abatida"].includes(status),
      details: F.limparFicha({ versao: r.versao, cor: r.cor, categoria: r.categoria, utilizacao: r.utilizacao, vin: r.vin, motor: r.motor, caixa: r.caixa }),
    },
  };
}

(async () => {
  const linhas = JSON.parse(fs.readFileSync(path.resolve(ficheiro), "utf8"));
  const existentes = new Set((await prisma.fleetVehicle.findMany({ select: { plate: true } })).map((v) => v.plate));
  const codigos = (await prisma.fleetVehicle.findMany({ where: { code: { startsWith: "FR-" } }, select: { code: true } })).map((v) => v.code);
  const novos = [];
  const ignorados = [];
  const vistos = new Set();
  for (const r of linhas) {
    const { data, faltam } = linhaParaViatura(r);
    if (!data.plate) {
      ignorados.push(["(sem matrícula)", "linha sem matrícula"]);
      continue;
    }
    if (existentes.has(data.plate) || vistos.has(data.plate)) {
      ignorados.push([data.plate, "matrícula já registada"]);
      continue;
    }
    vistos.add(data.plate);
    data.code = F.proximoCodigo("FR", [...codigos, ...novos.map((n) => n.data.code)]);
    novos.push({ data, faltam });
  }

  console.log(`${linhas.length} linha(s) no ficheiro · ${novos.length} a criar · ${ignorados.length} ignorada(s)`);
  for (const n of novos) {
    const d = n.data;
    console.log(`  ${d.code}  ${d.plate.padEnd(13)} ${d.tipologia.padEnd(9)} ${`${d.brand} ${d.model}`.slice(0, 34).padEnd(34)} ${d.status.padEnd(14)} ${d.fuel || "—"}${n.faltam.length ? `   (em falta: ${n.faltam.join(", ")} → ${ND})` : ""}`);
  }
  ignorados.forEach(([p, m]) => console.log(`  ignorada: ${p} — ${m}`));

  if (!aplicar) {
    console.log("\nSimulação: nada foi gravado. Para gravar, repita com --aplicar.");
  } else {
    await prisma.$transaction(novos.map((n) => prisma.fleetVehicle.create({ data: n.data })));
    console.log(`\nGravadas ${novos.length} viatura(s).`);
  }
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("Falhou:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
