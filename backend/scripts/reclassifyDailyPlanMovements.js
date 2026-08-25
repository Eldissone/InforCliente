/**
 * Reclassifica o histórico de movimentos gerados pelos planos diários.
 *
 * As entregas de material a um plano eram gravadas como EXIT e as devoluções como ENTRY, o que
 * inflava as colunas Entradas e Saídas exactamente pela quantidade devolvida. ALLOCATION e RETURN
 * têm o mesmo sinal que EXIT e ENTRY, pelo que esta reclassificação altera apenas a etiqueta:
 * nenhum saldo é recalculado e nenhuma quantidade é modificada.
 *
 * Uso:
 *   node scripts/reclassifyDailyPlanMovements.js            (dry-run, não escreve nada)
 *   node scripts/reclassifyDailyPlanMovements.js --apply    (grava)
 *
 * Requer que a migração já esteja aplicada e o Prisma Client regenerado:
 *   npx prisma migrate deploy && npx prisma generate
 */
require("dotenv").config();
const { prisma } = require("../src/db");

const APPLY = process.argv.includes("--apply");

const HANDOUT_NOTE = "Disponibilizado para Plano Diario (ID:";
const RETURN_NOTES = [
  "Devolução de material não consumido (Plano",
  "Devolução de ferramenta/equipamento não extraviado (Plano",
  "Devolução de ferramenta/equipamento do Plano",
];
const TOOL_LOSS_NOTE = "Ferramenta/Equipamento extraviado em obra";

const PLAN_ID_PATTERNS = [/\(ID:\s*([A-Za-z0-9_-]+)\)/, /\(Plano\s+([A-Za-z0-9_-]+)\)/, /\bdo Plano\s+([A-Za-z0-9_-]+)\b/];

function extractPlanId(notes) {
  for (const re of PLAN_ID_PATTERNS) {
    const match = re.exec(notes || "");
    if (match) return match[1];
  }
  return null;
}

/** Sinal do movimento no saldo do armazém. ADJUSTMENT tem direcção desconhecida. */
function balanceSign(type) {
  if (type === "ENTRY" || type === "TRANSFER_IN" || type === "RETURN") return 1;
  if (type === "EXIT" || type === "TRANSFER_OUT" || type === "LOSS" || type === "ALLOCATION") return -1;
  return 0;
}

function stockKey(m) {
  return `${m.productId}_${m.warehouseId}`;
}

async function main() {
  console.log(`\n=== Reclassificação de movimentos de planos diários (${APPLY ? "APLICAR" : "DRY-RUN"}) ===\n`);

  const movements = await prisma.stockMovement.findMany({
    select: {
      id: true,
      type: true,
      quantity: true,
      notes: true,
      productId: true,
      warehouseId: true,
      projectId: true,
      dailyPlanId: true,
    },
  });
  console.log(`Movimentos analisados: ${movements.length}`);

  const toAllocation = [];
  const toReturn = [];
  const toolLosses = [];

  for (const m of movements) {
    const notes = m.notes || "";
    if (m.type === "EXIT" && notes.includes(HANDOUT_NOTE)) {
      toAllocation.push(m);
    } else if (m.type === "ENTRY" && RETURN_NOTES.some((n) => notes.includes(n))) {
      toReturn.push(m);
    } else if (m.type === "EXIT" && notes.includes(TOOL_LOSS_NOTE)) {
      toolLosses.push(m);
    }
  }

  console.log(`  Entregas a planos diários (EXIT -> ALLOCATION): ${toAllocation.length}`);
  console.log(`  Devoluções ao estaleiro (ENTRY -> RETURN):      ${toReturn.length}`);
  console.log(`  Extravios de ferramenta (EXIT, mantidos):       ${toolLosses.length}`);

  const newTypeById = new Map();
  toAllocation.forEach((m) => newTypeById.set(m.id, "ALLOCATION"));
  toReturn.forEach((m) => newTypeById.set(m.id, "RETURN"));

  // Invariante: a reclassificação não pode alterar o saldo derivado de nenhum par
  // produto/armazém. Se alterar, o padrão de notas apanhou um movimento que não devia.
  const derivedBefore = new Map();
  const derivedAfter = new Map();
  for (const m of movements) {
    const key = stockKey(m);
    const qty = Number(m.quantity || 0);
    derivedBefore.set(key, (derivedBefore.get(key) || 0) + balanceSign(m.type) * qty);
    const newType = newTypeById.get(m.id) || m.type;
    derivedAfter.set(key, (derivedAfter.get(key) || 0) + balanceSign(newType) * qty);
  }

  const drifted = [];
  for (const [key, before] of derivedBefore) {
    const after = derivedAfter.get(key) || 0;
    if (Math.abs(after - before) > 1e-6) drifted.push({ key, before, after });
  }

  if (drifted.length) {
    console.error("\nABORTADO: a reclassificação alteraria o saldo derivado destes materiais:");
    drifted.slice(0, 20).forEach((d) => console.error(`  ${d.key}: ${d.before} -> ${d.after}`));
    process.exitCode = 1;
    return;
  }
  console.log("\nInvariante verificada: nenhum saldo derivado muda com a reclassificação.");

  // Divergências pré-existentes entre o saldo gravado e o histórico. Não são causadas por
  // esta reclassificação, mas convém ficarem registadas antes de escrever.
  const stockRows = await prisma.warehouseStock.groupBy({
    by: ["productId", "warehouseId"],
    _sum: { quantity: true },
  });
  const divergences = [];
  for (const row of stockRows) {
    const key = `${row.productId}_${row.warehouseId}`;
    const stored = Number(row._sum?.quantity || 0);
    const derived = derivedBefore.get(key) || 0;
    if (Math.abs(stored - derived) > 1e-6) {
      divergences.push({ key, stored, derived, delta: stored - derived });
    }
  }
  if (divergences.length) {
    console.log(`\nDivergências pré-existentes saldo vs histórico: ${divergences.length}`);
    console.log("(esperadas onde houve ajustes manuais ou extravios de ferramenta auditados)");
    divergences
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 15)
      .forEach((d) => console.log(`  ${d.key}: gravado ${d.stored}, histórico ${d.derived}, delta ${d.delta}`));
  } else {
    console.log("\nSem divergências entre saldo gravado e histórico.");
  }

  const planIdByMovement = new Map();
  let withoutPlan = 0;
  for (const m of [...toAllocation, ...toReturn]) {
    const planId = m.dailyPlanId || extractPlanId(m.notes);
    if (planId) planIdByMovement.set(m.id, planId);
    else withoutPlan += 1;
  }

  const candidatePlanIds = [...new Set(planIdByMovement.values())];
  const existingPlans = candidatePlanIds.length
    ? await prisma.dailyPlan.findMany({
        where: { id: { in: candidatePlanIds } },
        select: { id: true },
      })
    : [];
  const existingPlanIds = new Set(existingPlans.map((p) => p.id));
  const resolvablePlanLinks = [...planIdByMovement.entries()].filter(([, planId]) =>
    existingPlanIds.has(planId)
  );

  console.log(`\nLigações ao plano diário: ${resolvablePlanLinks.length} resolvidas`);
  if (withoutPlan) console.log(`  ${withoutPlan} movimentos sem id de plano nas notas (ficam sem ligação)`);
  const unresolved = planIdByMovement.size - resolvablePlanLinks.length;
  if (unresolved) console.log(`  ${unresolved} referenciam planos já apagados (ficam sem ligação)`);

  if (!APPLY) {
    console.log("\nDry-run concluído. Nada foi escrito. Use --apply para gravar.\n");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (toAllocation.length) {
      await tx.stockMovement.updateMany({
        where: { id: { in: toAllocation.map((m) => m.id) } },
        data: { type: "ALLOCATION" },
      });
    }
    if (toReturn.length) {
      await tx.stockMovement.updateMany({
        where: { id: { in: toReturn.map((m) => m.id) } },
        data: { type: "RETURN" },
      });
    }
    for (const [movementId, planId] of resolvablePlanLinks) {
      await tx.stockMovement.update({
        where: { id: movementId },
        data: { dailyPlanId: planId },
      });
    }
  });

  console.log("\nReclassificação aplicada. Nenhum saldo foi alterado.\n");
}

main()
  .catch((err) => {
    console.error("Falha na reclassificação:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
