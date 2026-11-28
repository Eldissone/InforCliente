/**
 * Importa planos preventivos da Frota (e a leitura de km atual) a partir de um JSON
 * ({ corrigirMatricula, completarViatura, planos: [{ plate, nome, km, meses, ultKm, ultData, atual }] }).
 *
 *   node scripts/importFrotaPlanos.js scripts/data/frota-planos-2026-11.json            (simulação)
 *   node scripts/importFrotaPlanos.js scripts/data/frota-planos-2026-11.json --aplicar  (grava)
 *
 * - O plano com o mesmo nome na viatura é atualizado; senão junta-se aos que ela tem.
 * - A leitura «atual» só substitui a da viatura quando é maior (ou a viatura não tinha).
 * - `completarViatura` só preenche marca / modelo que estejam «N/D».
 * - Matrícula que não existe na frota fica de fora e é listada.
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
const hoje = new Date().toISOString().slice(0, 10);
const fmt = (x) => (x === null || x === undefined ? "—" : Number(x).toLocaleString("pt-PT"));

(async () => {
  const J = JSON.parse(fs.readFileSync(path.resolve(ficheiro), "utf8"));
  const corrige = J.corrigirMatricula || {};
  const viaturas = new Map((await prisma.fleetVehicle.findMany()).map((v) => [v.plate, v]));
  const alteracoes = new Map(); // id → { v, data, linhas[] }
  const fora = [];

  for (const p of J.planos) {
    const plate = corrige[p.plate] || p.plate;
    const v = viaturas.get(plate);
    if (!v) {
      fora.push(`${p.plate} — não existe na frota${p.viatura ? ` (${p.viatura})` : ""}`);
      continue;
    }
    const a = alteracoes.get(v.id) || { v, data: {}, linhas: [], planos: Array.isArray(v.maintenancePlans) ? v.maintenancePlans.map((x) => ({ ...x })) : [] };
    const nome = String(p.nome).trim().toUpperCase();
    const novo = { nome, km: p.km || null, meses: p.meses || null, ultKm: p.ultKm ?? null, ultData: p.ultData || null };
    const i = a.planos.findIndex((x) => String(x.nome).toUpperCase() === nome);
    if (i >= 0) a.planos[i] = { ...a.planos[i], ...novo };
    else a.planos.push({ id: `p${Date.now().toString(36)}${a.planos.length}${Math.random().toString(36).slice(2, 5)}`, ...novo });
    a.data.maintenancePlans = a.planos;
    if (p.atual !== null && p.atual !== undefined && (v.odometer === null || Number(p.atual) > Number(v.odometer))) {
      a.data.odometer = Number(p.atual);
      a.data.odometerAt = new Date(`${hoje}T00:00:00Z`);
    }
    const comp = (J.completarViatura || {})[plate];
    if (comp) {
      if (comp.brand && v.brand === "N/D") a.data.brand = comp.brand.toUpperCase();
      if (comp.model && v.model === "N/D") a.data.model = comp.model.toUpperCase();
    }
    const vv = { ...v, odometer: a.data.odometer ?? v.odometer };
    const est = F.estadoPlano(vv, novo, hoje);
    a.linhas.push(`${v.code}  ${plate.padEnd(13)} ${nome.slice(0, 26).padEnd(26)} cada ${fmt(novo.km)} km${novo.meses ? ` / ${novo.meses} meses` : ""} · último ${fmt(novo.ultKm)}${novo.ultData ? ` em ${novo.ultData}` : ""} · km atual ${fmt(vv.odometer)}${a.data.odometer !== undefined ? " (novo)" : ""} → ${est.t}${plate !== p.plate ? `   (tabela: ${p.plate})` : ""}${a.data.brand || a.data.model ? `   (marca/modelo: ${a.data.brand || v.brand} ${a.data.model || v.model})` : ""}`);
    alteracoes.set(v.id, a);
  }

  console.log(`${J.planos.length} plano(s) no ficheiro · ${alteracoes.size} viatura(s) a atualizar · ${fora.length} de fora`);
  [...alteracoes.values()].forEach((a) => a.linhas.forEach((l) => console.log(`  ${l}`)));
  fora.forEach((m) => console.log(`  de fora: ${m}`));

  if (!aplicar) {
    console.log("\nSimulação: nada foi gravado. Para gravar, repita com --aplicar.");
  } else {
    await prisma.$transaction([...alteracoes.values()].map((a) => prisma.fleetVehicle.update({ where: { id: a.v.id }, data: a.data })));
    console.log(`\nAtualizadas ${alteracoes.size} viatura(s).`);
  }
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("Falhou:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
