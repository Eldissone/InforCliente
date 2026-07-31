const fs = require("fs");
const path = require("path");
const { prisma } = require("../db");

const SEED_PATH = path.join(__dirname, "../../data/cost-categories.json");

const DOMAIN_LABELS = {
  GERAL: "CUSTO GERAIS",
  OBRA: "CUSTOS DE OBRA",
  VIATURAS: "CUSTOS VIATURAS E EQUIPAMENTOS",
};

function loadSeedNodes() {
  const raw = fs.readFileSync(SEED_PATH, "utf8");
  return JSON.parse(raw);
}

async function ensureCostCategories() {
  try {
    const nodes = loadSeedNodes();
    const byCode = new Map(nodes.map((n) => [n.code, n]));

    for (const node of nodes) {
      if (node.parentCode && !byCode.has(node.parentCode)) {
        throw new Error(`Parent inexistente: ${node.parentCode} (${node.code})`);
      }
    }

    for (const node of [...nodes].sort((a, b) => a.level - b.level)) {
      let parentId = null;
      if (node.parentCode) {
        const parentRow = await prisma.costCategory.findUnique({ where: { code: node.parentCode } });
        if (!parentRow) {
          throw new Error(`Parent inexistente na BD: ${node.parentCode} (${node.code})`);
        }
        parentId = parentRow.id;
      }

      const payload = {
        name: node.name,
        domain: node.domain,
        parentId,
        level: node.level,
        sortOrder: node.sortOrder,
        isSelectable: node.isSelectable,
        requiresDetailText: node.requiresDetailText,
        active: true,
      };

      const existingByCode = await prisma.costCategory.findUnique({ where: { code: node.code } });
      if (existingByCode) {
        await prisma.costCategory.update({ where: { code: node.code }, data: payload });
        continue;
      }

      const existingById = await prisma.costCategory.findUnique({ where: { id: node.id } });
      if (existingById) {
        await prisma.costCategory.update({
          where: { id: node.id },
          data: { ...payload, code: node.code },
        });
        continue;
      }

      await prisma.costCategory.create({
        data: { id: node.id, code: node.code, ...payload },
      });
    }
    console.log(`✅ Catálogo de tipos de custo verificado (${nodes.length} nós)`);

    await prisma.costCategory.updateMany({
      where: {
        OR: [
          { code: "GERAL_FAM_CUSTO_GERAIS_PRODUCAO" },
          { code: { contains: "_PRODUCAO_" } },
        ],
      },
      data: { active: false, isSelectable: false },
    });
  } catch (error) {
    console.error("❌ Erro ao garantir tipos de custo:", error.message);
  }
}

const { randomUUID } = require("crypto");

function slugifyCode(name) {
  return (
    String(name)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "ITEM"
  );
}

async function generateUniqueCostCategoryCode(domain, name) {
  let base = `${domain}_${slugifyCode(name)}`;
  let code = base;
  let n = 2;
  while (await prisma.costCategory.findUnique({ where: { code } })) {
    code = `${base}_${n}`;
    n += 1;
  }
  return code;
}

function isFamCode(code) {
  return code && code.includes("_FAM_") && !/_GRP_|_R_|_D_/.test(code);
}
function isGrpCode(code) {
  return code && code.includes("_GRP_");
}
function isRubricCode(code) {
  return code && code.includes("_R_");
}
function isSubcostCode(code) {
  return code && code.includes("_D_");
}

function classifySheetLevel(category) {
  if (!category) return "TIPO2";
  const { code, parentId } = category;
  if (isFamCode(code)) return "TIPO1";
  if (isGrpCode(code)) return "GRUPO";
  if (isSubcostCode(code)) return "SUBCUSTO";
  if (isRubricCode(code)) return "TIPO2";
  if (!parentId) return "TIPO2";
  return "SUBCUSTO";
}

async function generateStructuredCostCategoryCode(domain, parent, sheetLevel, name) {
  const slug = slugifyCode(name);
  let base;
  if (sheetLevel === "TIPO1") {
    base = `${domain}_FAM_${slug}`;
  } else if (sheetLevel === "GRUPO") {
    if (!parent) throw Object.assign(new Error("PARENT_REQUIRED"), { status: 400 });
    base = `${parent.code}_GRP_${slug}`;
  } else if (sheetLevel === "TIPO2") {
    if (parent) base = `${parent.code}_R_${slug}`;
    else base = `${domain}_${slug}`;
  } else if (sheetLevel === "SUBCUSTO") {
    if (!parent) throw Object.assign(new Error("PARENT_REQUIRED"), { status: 400 });
    base = `${parent.code}_D_${slug}`;
  } else {
    base = `${domain}_${slug}`;
  }
  let code = base;
  let n = 2;
  while (await prisma.costCategory.findUnique({ where: { code } })) {
    code = `${base}_${n}`;
    n += 1;
  }
  return code;
}

function defaultFlagsForSheetLevel(sheetLevel) {
  switch (sheetLevel) {
    case "TIPO1":
    case "GRUPO":
      return { isSelectable: false, requiresDetailText: false };
    case "TIPO2":
      return { isSelectable: true, requiresDetailText: false };
    case "SUBCUSTO":
      return { isSelectable: true, requiresDetailText: false };
    default:
      return { isSelectable: true, requiresDetailText: false };
  }
}

async function resolveParentForSheetLevel(sheetLevel, body, domain) {
  if (sheetLevel === "TIPO1") {
    if (body.parentId) {
      const err = new Error("TIPO1_CANNOT_HAVE_PARENT");
      err.status = 400;
      throw err;
    }
    if (domain !== "GERAL") {
      const err = new Error("TIPO1_ONLY_GERAL");
      err.status = 400;
      throw err;
    }
    return null;
  }
  if (sheetLevel === "GRUPO") {
    if (!body.parentId) {
      const err = new Error("PARENT_TIPO1_REQUIRED");
      err.status = 400;
      throw err;
    }
    const parent = await prisma.costCategory.findUnique({ where: { id: body.parentId } });
    if (!parent || !isFamCode(parent.code)) {
      const err = new Error("PARENT_MUST_BE_TIPO1");
      err.status = 400;
      throw err;
    }
    return parent;
  }
  if (sheetLevel === "TIPO2") {
    if (domain === "GERAL") {
      if (!body.parentId) {
        const err = new Error("PARENT_REQUIRED_GERAL_TIPO2");
        err.status = 400;
        throw err;
      }
      const parent = await prisma.costCategory.findUnique({ where: { id: body.parentId } });
      if (!parent || (!isFamCode(parent.code) && !isGrpCode(parent.code))) {
        const err = new Error("PARENT_MUST_BE_TIPO1_OR_GRUPO");
        err.status = 400;
        throw err;
      }
      return parent;
    }
    if (body.parentId) {
      const err = new Error("TIPO2_OBRA_VIATURAS_NO_PARENT");
      err.status = 400;
      throw err;
    }
    return null;
  }
  if (sheetLevel === "SUBCUSTO") {
    if (!body.parentId) {
      const err = new Error("PARENT_TIPO2_REQUIRED");
      err.status = 400;
      throw err;
    }
    const parent = await prisma.costCategory.findUnique({ where: { id: body.parentId } });
    if (!parent) {
      const err = new Error("PARENT_NOT_FOUND");
      err.status = 400;
      throw err;
    }
    if (isFamCode(parent.code) || isGrpCode(parent.code)) {
      const err = new Error("PARENT_MUST_BE_TIPO2");
      err.status = 400;
      throw err;
    }
    if (isSubcostCode(parent.code)) {
      const err = new Error("PARENT_MUST_BE_TIPO2");
      err.status = 400;
      throw err;
    }
    return parent;
  }
  return body.parentId
    ? await prisma.costCategory.findUnique({ where: { id: body.parentId } })
    : null;
}

async function computeLevelAndDomain(parentId, domainFallback) {
  if (!parentId) {
    return { level: 1, domain: domainFallback };
  }
  const parent = await prisma.costCategory.findUnique({ where: { id: parentId } });
  if (!parent || !parent.active) {
    const err = new Error("PARENT_NOT_FOUND");
    err.status = 400;
    throw err;
  }
  return { level: parent.level + 1, domain: parent.domain };
}

/** Verifica se `candidateParentId` é o próprio nó ou um descendente (evita ciclos ao reparentar). */
async function wouldCreateParentCycle(nodeId, candidateParentId) {
  if (!candidateParentId) return false;
  if (candidateParentId === nodeId) return true;
  let cur = await prisma.costCategory.findUnique({ where: { id: candidateParentId } });
  while (cur?.parentId) {
    if (cur.parentId === nodeId) return true;
    cur = await prisma.costCategory.findUnique({ where: { id: cur.parentId } });
  }
  return false;
}

async function resolveParentIdForUpdate(existing, parentIdInput) {
  const sheetLevel = classifySheetLevel(existing);
  const body = { parentId: parentIdInput ?? null };
  const parentRecord = await resolveParentForSheetLevel(sheetLevel, body, existing.domain);
  const parentId = parentRecord ? parentRecord.id : null;
  if (await wouldCreateParentCycle(existing.id, parentId)) {
    const err = new Error("PARENT_CYCLE");
    err.status = 400;
    throw err;
  }
  const { level, domain } = await computeLevelAndDomain(parentId, existing.domain);
  if (domain !== existing.domain) {
    const err = new Error("DOMAIN_MISMATCH_WITH_PARENT");
    err.status = 400;
    throw err;
  }
  return { parentId, level };
}

async function refreshDescendantLevels(parentId) {
  const parent = await prisma.costCategory.findUnique({ where: { id: parentId } });
  if (!parent) return;
  const children = await prisma.costCategory.findMany({ where: { parentId: parent.id } });
  for (const child of children) {
    const newLevel = parent.level + 1;
    if (child.level !== newLevel) {
      await prisma.costCategory.update({ where: { id: child.id }, data: { level: newLevel } });
    }
    await refreshDescendantLevels(child.id);
  }
}

async function validateSelectableCategory(categoryId, expectedDomain) {
  if (!categoryId) return { ok: false, error: "COST_CATEGORY_REQUIRED" };
  const cat = await prisma.costCategory.findFirst({
    where: { id: categoryId, active: true },
  });
  if (!cat) return { ok: false, error: "COST_CATEGORY_NOT_FOUND" };
  if (expectedDomain && cat.domain !== expectedDomain) {
    return { ok: false, error: "COST_CATEGORY_DOMAIN_MISMATCH" };
  }
  if (!cat.isSelectable) return { ok: false, error: "COST_CATEGORY_NOT_SELECTABLE" };
  const childCount = await prisma.costCategory.count({
    where: { parentId: cat.id, active: true },
  });
  if (childCount > 0) return { ok: false, error: "COST_CATEGORY_NOT_LEAF" };
  return { ok: true, category: cat };
}

module.exports = {
  ensureCostCategories,
  validateSelectableCategory,
  DOMAIN_LABELS,
  loadSeedNodes,
  slugifyCode,
  generateUniqueCostCategoryCode,
  generateStructuredCostCategoryCode,
  classifySheetLevel,
  defaultFlagsForSheetLevel,
  resolveParentForSheetLevel,
  computeLevelAndDomain,
  resolveParentIdForUpdate,
  refreshDescendantLevels,
};
