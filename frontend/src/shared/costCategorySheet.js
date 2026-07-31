import { formatCategoryDisplayName } from "/shared/costCategoryCascade.js";

/** Rótulos TIPO CUSTO 1 como na folha Excel (domínios planos). */
export const SHEET_TIPO1_FLAT = {
  OBRA: "CUSTOS DE OBRA",
  VIATURAS: "CUSTOS VIATURAS E EQUIPAMENTOS",
};

export const SHEET_LEVEL_LABELS = {
  TIPO1: "Tipo custo 1",
  GRUPO: "Grupo",
  TIPO2: "Tipo custo 2",
  SUBCUSTO: "Subcusto (tipo 3)",
};

export function classifyCategorySheetLevel(cat) {
  if (!cat?.code) return "TIPO2";
  const code = cat.code;
  if (code.includes("_FAM_") && !/_GRP_|_R_|_D_/.test(code)) return "TIPO1";
  if (code.includes("_GRP_")) return "GRUPO";
  if (code.includes("_D_")) return "SUBCUSTO";
  if (code.includes("_R_")) return "TIPO2";
  if (!cat.parentId && cat.domain !== "GERAL") return "TIPO2";
  return "SUBCUSTO";
}

function isFamCat(c) {
  return classifyCategorySheetLevel(c) === "TIPO1";
}
function isFam(c) {
  return isFamCat(c);
}
function isGrpCat(c) {
  return classifyCategorySheetLevel(c) === "GRUPO";
}
function isExcludedTipo1Fam(c) {
  if (!isFam(c)) return false;
  if (c.code?.includes("_PRODUCAO")) return true;
  if (String(c.name).toUpperCase().includes("PRODUÇÃO")) return true;
  return false;
}
function isGrp(c) {
  return isGrpCat(c);
}
function isRubricCode(c) {
  return c.code?.includes("_R_");
}
function isSheetRubric(c) {
  if (!c || isFam(c) || isGrp(c)) return false;
  if (isRubricCode(c)) return true;
  return classifyCategorySheetLevel(c) === "TIPO2";
}
function isDetailCode(c) {
  return c.code?.includes("_D_");
}
function isSheetSubcost(c) {
  if (!c) return false;
  if (isDetailCode(c)) return true;
  return classifyCategorySheetLevel(c) === "SUBCUSTO";
}

/**
 * Linhas estilo folha «TIPO SUBCUSTOS»: Tipo 1, grupo, Tipo 2, Tipo 3, id seleccionável.
 * @param {object[]} items
 * @returns {Array<{domain:string,tipo1:string,grupo:string,tipo2:string,tipo2Id:string,tipo3:string,tipo3Id:string|null,pickCategoryId:string,requiresDetailText:boolean,sortOrder:number}>}
 */
export function buildCostCatalogSheetRows(items = []) {
  const active = items.filter((c) => c.active !== false);
  const rows = [];

  function childrenOf(parentId) {
    return active
      .filter((c) => (c.parentId || null) === (parentId || null))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt"));
  }

  function pushRow(ctx, rubric, leaf) {
    const pick = leaf || rubric;
    if (!pick) return;
    const tipo3Node = leaf && rubric && leaf.id !== rubric.id ? leaf : null;
    rows.push({
      domain: ctx.domain,
      tipo1: ctx.tipo1,
      tipo1CategoryId: ctx.tipo1CategoryId || null,
      grupo: ctx.grupo || "",
      grupoCategoryId: ctx.grupoCategoryId || null,
      tipo2: formatCategoryDisplayName(rubric.name),
      tipo2Id: rubric.id,
      tipo3: tipo3Node ? formatCategoryDisplayName(tipo3Node.name) : "—",
      tipo3Id: tipo3Node?.id || null,
      pickCategoryId: pick.id,
      requiresDetailText: Boolean(pick.requiresDetailText),
      sortOrder: rubric.sortOrder ?? 0,
    });
  }

  function walkFam(fam, ctx) {
    walkChildren(fam.id, {
      ...ctx,
      tipo1: fam.name,
      tipo1CategoryId: fam.id,
      grupo: "",
      grupoCategoryId: null,
      rubric: null,
    });
  }

  function walkChildren(parentId, ctx) {
    childrenOf(parentId).forEach((node) => walkNode(node, ctx));
  }

  function walkNode(node, ctx) {
    if (isFam(node)) {
      walkFam(node, ctx);
      return;
    }

    let nextCtx = { ...ctx };

    if (isGrp(node)) {
      nextCtx = { ...nextCtx, grupo: node.name, grupoCategoryId: node.id };
      walkChildren(node.id, nextCtx);
      return;
    }

    if (isSheetRubric(node)) {
      const rubricCtx = { ...nextCtx, rubric: node };
      const kids = childrenOf(node.id);

      if (!kids.length) {
        pushRow(rubricCtx, node, node);
        return;
      }

      let emitted = false;
      kids.forEach((k) => {
        if (isSheetSubcost(k) && !childrenOf(k.id).length) {
          pushRow(rubricCtx, node, k);
          emitted = true;
        } else if (!isSheetSubcost(k) && k.isSelectable && !childrenOf(k.id).length) {
          pushRow(rubricCtx, node, k);
          emitted = true;
        } else {
          walkNode(k, rubricCtx);
        }
      });

      if (!emitted) pushRow(rubricCtx, node, node);
      return;
    }

    if (isSheetSubcost(node) && ctx.rubric) {
      pushRow(ctx, ctx.rubric, node);
      return;
    }

    walkChildren(node.id, nextCtx);
  }

  active
    .filter((c) => c.domain === "GERAL" && isFam(c) && !c.parentId && !isExcludedTipo1Fam(c))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((fam) => walkFam(fam, { domain: "GERAL" }));

  ["OBRA", "VIATURAS"].forEach((domain) => {
    const tipo1 = SHEET_TIPO1_FLAT[domain];
    const roots = active.filter(
      (c) =>
        c.domain === domain &&
        !c.parentId &&
        !isFam(c) &&
        !isGrp(c) &&
        !c.code?.includes("_D_")
    );

    roots.forEach((rubric) => {
      const kids = childrenOf(rubric.id).filter((c) => !isFam(c) && !isGrp(c));
      const ctxFlat = { domain, tipo1, tipo1CategoryId: null, grupo: "", grupoCategoryId: null };
      if (!kids.length) {
        pushRow(ctxFlat, rubric, rubric);
        return;
      }
      let any = false;
      kids.forEach((k) => {
        pushRow(ctxFlat, rubric, k);
        any = true;
      });
      if (!any) pushRow(ctxFlat, rubric, rubric);
    });
  });

  supplementSheetRowsFromOrphans(active, rows, pushRow);

  return rows;
}

/** Tipos na BD que não entraram na árvore principal (códigos legados, etc.). */
function supplementSheetRowsFromOrphans(active, rows, pushRow) {
  const seen = new Set(rows.map((r) => r.pickCategoryId));
  const byId = new Map(active.map((c) => [c.id, c]));

  function ancestorsOf(cat) {
    let fam = null;
    let grp = null;
    let rubric = null;
    let cur = cat;
    while (cur) {
      const lvl = classifyCategorySheetLevel(cur);
      if (lvl === "TIPO1") fam = cur;
      if (lvl === "GRUPO") grp = cur;
      if (lvl === "TIPO2" || isSheetRubric(cur)) rubric = cur;
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return { fam, grp, rubric };
  }

  function ctxFor(cat) {
    const { fam, grp } = ancestorsOf(cat);
    const tipo1 =
      cat.domain === "GERAL"
        ? fam?.name || "CUSTO GERAIS"
        : SHEET_TIPO1_FLAT[cat.domain] || cat.domain;
    return {
      domain: cat.domain,
      tipo1,
      tipo1CategoryId: fam?.id || null,
      grupo: grp?.name || "",
      grupoCategoryId: grp?.id || null,
    };
  }

  for (const cat of active) {
    if (seen.has(cat.id)) continue;
    const lvl = classifyCategorySheetLevel(cat);
    if (lvl === "SUBCUSTO" || (isSheetSubcost(cat) && cat.parentId)) {
      const { rubric } = ancestorsOf(cat);
      if (!rubric) continue;
      pushRow(ctxFor(cat), rubric, cat);
      seen.add(cat.id);
      continue;
    }
    if ((lvl === "TIPO2" || isSheetRubric(cat)) && !isFam(cat) && !isGrp(cat)) {
      const hasChild = active.some((c) => c.parentId === cat.id);
      if (hasChild) continue;
      pushRow(ctxFor(cat), cat, cat);
      seen.add(cat.id);
    }
  }
}

export function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "pt", { sensitivity: "base" })
  );
}

/** Opções em cascata para filtros (como Excel). */
export function sheetFilterOptions(allRows, filters) {
  let pool = allRows;
  if (filters.domain) pool = pool.filter((r) => r.domain === filters.domain);
  if (filters.tipo1) pool = pool.filter((r) => r.tipo1 === filters.tipo1);
  if (filters.grupo === "__EMPTY__") pool = pool.filter((r) => !r.grupo);
  else if (filters.grupo) pool = pool.filter((r) => r.grupo === filters.grupo);
  if (filters.tipo2) pool = pool.filter((r) => r.tipo2 === filters.tipo2);

  const baseDomain = filters.domain
    ? allRows.filter((r) => r.domain === filters.domain)
    : allRows;
  const baseT1 = filters.tipo1
    ? baseDomain.filter((r) => r.tipo1 === filters.tipo1)
    : baseDomain;
  let baseT1G = baseT1;
  if (filters.grupo === "__EMPTY__") baseT1G = baseT1.filter((r) => !r.grupo);
  else if (filters.grupo) baseT1G = baseT1.filter((r) => r.grupo === filters.grupo);

  return {
    domains: uniqueSorted(allRows.map((r) => r.domain)),
    tipo1: uniqueSorted(
      (filters.domain ? baseDomain : allRows).map((r) => r.tipo1)
    ),
    grupo: uniqueSorted(baseT1.map((r) => r.grupo)),
    tipo2: uniqueSorted(baseT1G.map((r) => r.tipo2)),
    tipo3: uniqueSorted(pool.map((r) => r.tipo3)),
  };
}

export function applySheetFilters(rows, filters) {
  return rows.filter((r) => {
    if (filters.domain && r.domain !== filters.domain) return false;
    if (filters.tipo1 && r.tipo1 !== filters.tipo1) return false;
    if (filters.grupo === "__EMPTY__" && r.grupo) return false;
    if (filters.grupo && filters.grupo !== "__EMPTY__" && r.grupo !== filters.grupo) return false;
    if (filters.tipo2 && r.tipo2 !== filters.tipo2) return false;
    if (filters.tipo3 && r.tipo3 !== filters.tipo3) return false;
    return true;
  });
}

/** Chave estável para agrupar linhas da folha pelo mesmo tipo custo 2. */
export function catalogSheetGroupKey(row) {
  return `${row.domain}|${row.tipo1}|${row.grupo || ""}|${row.tipo2}`;
}

/**
 * Agrupa linhas filtradas: uma linha de tabela por tipo custo 2, com variantes de tipo custo 3.
 */
export function groupCatalogSheetDisplayRows(rows = []) {
  const order = [];
  const groups = new Map();
  for (const r of rows) {
    const key = catalogSheetGroupKey(r);
    if (!groups.has(key)) {
      groups.set(key, {
        domain: r.domain,
        tipo1: r.tipo1,
        tipo1CategoryId: r.tipo1CategoryId,
        grupo: r.grupo,
        grupoCategoryId: r.grupoCategoryId,
        tipo2: r.tipo2,
        tipo2Id: r.tipo2Id,
        variants: [],
      });
      order.push(key);
    }
    groups.get(key).variants.push({
      tipo3: r.tipo3,
      tipo3Id: r.tipo3Id,
      pickCategoryId: r.pickCategoryId,
      requiresDetailText: r.requiresDetailText,
    });
  }
  return order.map((key) => {
    const g = groups.get(key);
    const seen = new Set();
    g.variants = g.variants.filter((v) => {
      if (seen.has(v.pickCategoryId)) return false;
      seen.add(v.pickCategoryId);
      return true;
    });
    return g;
  });
}

export function resolveGroupActiveVariant(group, preferredPickId = "") {
  if (preferredPickId) {
    const hit = group.variants.find((v) => v.pickCategoryId === preferredPickId);
    if (hit) return hit;
  }
  return group.variants[0] || null;
}

/** Uma linha por rubrica (aba Tipos de custo). */
export function dedupeSheetRubrics(rows) {
  const seen = new Map();
  rows.forEach((r) => {
    const key = `${r.domain}|${r.tipo1}|${r.grupo}|${r.tipo2}`;
    if (!seen.has(key)) seen.set(key, { ...r, subcostCount: 0 });
    const entry = seen.get(key);
    if (r.tipo3 && r.tipo3 !== "—") entry.subcostCount += 1;
  });
  return [...seen.values()].sort(
    (a, b) =>
      a.domain.localeCompare(b.domain) ||
      a.tipo1.localeCompare(b.tipo1, "pt") ||
      a.grupo.localeCompare(b.grupo, "pt") ||
      a.tipo2.localeCompare(b.tipo2, "pt")
  );
}

/** 0 = célula omitida (continuação do rowspan acima); >0 = rowspan a aplicar. */
export function sheetCellRowspan(rows, index, level) {
  if (!rows.length || index < 0 || index >= rows.length) return 0;
  const same =
    level === "tipo1"
      ? (a, b) => a.tipo1 === b.tipo1
      : level === "grupo"
        ? (a, b) => a.tipo1 === b.tipo1 && (a.grupo || "") === (b.grupo || "")
        : level === "tipo2"
          ? (a, b) =>
              a.tipo1 === b.tipo1 &&
              (a.grupo || "") === (b.grupo || "") &&
              a.tipo2 === b.tipo2
          : () => false;
  if (index > 0 && same(rows[index], rows[index - 1])) return 0;
  let span = 1;
  for (let j = index + 1; j < rows.length; j += 1) {
    if (same(rows[j], rows[index])) span += 1;
    else break;
  }
  return span;
}
