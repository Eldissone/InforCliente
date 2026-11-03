const { prisma } = require("../db");
const {
  INVOICE_CATEGORY_META,
  inferCostCategoryFromText,
} = require("./invoiceScanService");

function normalizeNifDigits(raw) {
  return String(raw || "").replace(/[^0-9A-Za-z]/g, "").trim();
}

function normalizeTextKey(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferSupplierType(categoryKey) {
  const cat = String(categoryKey || "").toUpperCase();
  if (cat === "TRANSPORTE") return "TRANSPORTADOR";
  if (cat === "SERVICOS_MAO_DE_OBRA" || cat === "EQUIPAMENTO") return "SERVICO";
  return "MATERIAL";
}

/**
 * Procura um fornecedor pelo NIF ou Nome lido na fatura/proforma.
 * Se `autoCreate` for verdadeiro e existir nome, cria o fornecedor automaticamente.
 */
async function resolveOrCreateSupplierFromInvoice(fields = {}, { autoCreate = true } = {}) {
  const nif = normalizeNifDigits(fields.supplierNif);
  const name = String(fields.supplierName || "").trim();

  let matched = null;
  if (nif && nif.length >= 5) {
    matched = await prisma.supplier.findFirst({
      where: {
        OR: [
          { nif: { equals: nif, mode: "insensitive" } },
          { nif: { contains: nif, mode: "insensitive" } },
        ],
      },
      include: { bankAccounts: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!matched && name) {
    matched = await prisma.supplier.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
      },
      include: { bankAccounts: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!matched && name && name.length >= 4) {
    const allSuppliers = await prisma.supplier.findMany({
      select: {
        id: true,
        name: true,
        nif: true,
        vatPercent: true,
        withholdingPercent: true,
        discountPercent: true,
        iban: true,
        phone: true,
        email: true,
        type: true,
      },
      take: 400,
    });
    const targetKey = normalizeTextKey(name);
    matched =
      allSuppliers.find((s) => {
        const sKey = normalizeTextKey(s.name);
        return (
          sKey &&
          targetKey &&
          (sKey === targetKey ||
            (sKey.length > 5 && targetKey.includes(sKey)) ||
            (targetKey.length > 5 && sKey.includes(targetKey)))
        );
      }) || null;
  }

  if (matched) {
    const patch = {};
    if (!matched.nif && nif) patch.nif = nif;
    if (matched.vatPercent == null && fields.vatPercent != null) patch.vatPercent = fields.vatPercent;
    if (matched.withholdingPercent == null && fields.withholdingPercent != null) {
      patch.withholdingPercent = fields.withholdingPercent;
    }
    if (matched.discountPercent == null && fields.discountPercent != null) {
      patch.discountPercent = fields.discountPercent;
    }
    if (!matched.iban && fields.supplierIban) patch.iban = fields.supplierIban;
    if (!matched.phone && fields.supplierPhone) patch.phone = fields.supplierPhone;
    if (Object.keys(patch).length > 0) {
      try {
        matched = await prisma.supplier.update({
          where: { id: matched.id },
          data: patch,
        });
      } catch {
        // Ignora erro de atualização opcional
      }
    }
    return { supplier: matched, created: false };
  }

  if (!autoCreate || !name) {
    return { supplier: null, created: false };
  }

  const emailRaw = String(fields.supplierEmail || "").trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;

  const createdSupplier = await prisma.supplier.create({
    data: {
      name,
      nif: nif || null,
      phone: fields.supplierPhone || null,
      email: validEmail,
      iban: fields.supplierIban || null,
      vatPercent: fields.vatPercent ?? 14,
      withholdingPercent: fields.withholdingPercent ?? 0,
      discountPercent: fields.discountPercent ?? 0,
      type: inferSupplierType(fields.suggestedCategory),
      category:
        INVOICE_CATEGORY_META[fields.suggestedCategory]?.name || "Materiais e Serviços",
    },
  });

  return { supplier: createdSupplier, created: true };
}

/**
 * Calcula similaridade entre descrições de itens (0..1)
 */
function computeDescriptionSimilarity(a, b) {
  const keyA = normalizeTextKey(a);
  const keyB = normalizeTextKey(b);
  if (!keyA || !keyB) return 0;
  if (keyA === keyB) return 1;
  if (keyA.includes(keyB) || keyB.includes(keyA)) return 0.85;

  const wordsA = new Set(keyA.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(keyB.split(" ").filter((w) => w.length > 2));
  if (!wordsA.size || !wordsB.size) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap += 1;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

/**
 * Associa as linhas extraídas da fatura/proforma às necessidades (WorkNeed) selecionadas.
 */
function matchInvoiceItemsToNeeds(invoiceItems = [], needs = [], headerFields = {}) {
  const items = Array.isArray(invoiceItems) ? invoiceItems : [];
  const needList = Array.isArray(needs) ? needs : [];
  if (!needList.length) return [];

  const usedItemIndices = new Set();
  const mappings = [];

  for (let i = 0; i < needList.length; i++) {
    const need = needList[i];
    let bestIdx = -1;
    let bestScore = 0;

    for (let j = 0; j < items.length; j++) {
      if (usedItemIndices.has(j)) continue;
      const score = computeDescriptionSimilarity(need.description, items[j].description);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    let matchedItem = null;
    if (bestIdx !== -1 && bestScore >= 0.25) {
      usedItemIndices.add(bestIdx);
      matchedItem = items[bestIdx];
    } else if (needList.length === 1 && items.length > 1) {
      const needQty = Number(need.quantity) > 0 ? Number(need.quantity) : 1;
      const totalGross =
        headerFields.grossAmount ??
        items.reduce((acc, it) => acc + (Number(it.total) || 0), 0);
      matchedItem = {
        description: headerFields.description || items.map((it) => it.description).join("; "),
        quantity: needQty,
        unitPrice: Math.round(((totalGross / needQty) + Number.EPSILON) * 100) / 100,
        total: totalGross,
        discountPercent: headerFields.discountPercent ?? 0,
        vatPercent: headerFields.vatPercent ?? null,
      };
    } else if (i < items.length && !usedItemIndices.has(i)) {
      usedItemIndices.add(i);
      matchedItem = items[i];
    }

    const needQty = Number(need.quantity) > 0 ? Number(need.quantity) : 1;
    let suggestedUnitPrice = null;
    let suggestedQuantity = needQty;

    if (matchedItem) {
      const itemQty = Number(matchedItem.quantity) > 0 ? Number(matchedItem.quantity) : 1;
      const itemUnit = Number(matchedItem.unitPrice) || 0;
      const itemTotal = Number(matchedItem.total) || itemQty * itemUnit;

      if (Math.abs(itemQty - needQty) < 0.001 || itemUnit > 0) {
        suggestedUnitPrice = itemUnit > 0 ? itemUnit : Math.round(((itemTotal / needQty) + Number.EPSILON) * 100) / 100;
        suggestedQuantity = itemQty > 0 ? itemQty : needQty;
      } else {
        suggestedUnitPrice = Math.round(((itemTotal / needQty) + Number.EPSILON) * 100) / 100;
      }
    } else if (needList.length === 1 && (headerFields.grossAmount || headerFields.netAmount)) {
      const base = Number(headerFields.grossAmount ?? headerFields.netAmount) || 0;
      suggestedUnitPrice = Math.round(((base / needQty) + Number.EPSILON) * 100) / 100;
    }

    mappings.push({
      needId: need.id,
      needDescription: need.description,
      needQuantity: needQty,
      matchedInvoiceDescription: matchedItem?.description || null,
      similarity: Math.round(bestScore * 100),
      quotedPrice: suggestedUnitPrice,
      quantity: suggestedQuantity,
      total:
        suggestedUnitPrice != null
          ? Math.round((suggestedUnitPrice * suggestedQuantity + Number.EPSILON) * 100) / 100
          : null,
      vatPercent: matchedItem?.vatPercent ?? headerFields.vatPercent ?? null,
      discountPercent: matchedItem?.discountPercent ?? headerFields.discountPercent ?? null,
      withholdingPercent: headerFields.withholdingPercent ?? null,
    });
  }

  return mappings;
}

/**
 * Mapeia um CostCenter existente da obra para uma das categorias CBS (INVOICE_CATEGORY_META)
 */
function inferCategoryKeyFromCostCenter(cc) {
  if (!cc) return "MATERIAIS_INSUMOS";
  const code = String(cc.code || "").toUpperCase().trim();
  for (const [key, meta] of Object.entries(INVOICE_CATEGORY_META)) {
    if (code === meta.code || code.startsWith(`${meta.code}-`) || code.startsWith(`${meta.code}_`)) {
      return key;
    }
  }
  return inferCostCategoryFromText(`${cc.code || ""} ${cc.name || ""} ${cc.description || ""}`, "MATERIAIS_INSUMOS");
}

/**
 * Procura um Centro de Custo correspondente à categoria na obra
 */
function matchCostCenterForCategory(costCenters = [], categoryKey = "MATERIAIS_INSUMOS") {
  const meta =
    INVOICE_CATEGORY_META[categoryKey] || INVOICE_CATEGORY_META.MATERIAIS_INSUMOS;
  const list = Array.isArray(costCenters) ? costCenters : [];

  const byCode = list.find((cc) => {
    const c = String(cc.code || "").toUpperCase().trim();
    return c === meta.code || c.startsWith(`${meta.code}-`) || c.startsWith(`${meta.code}0`);
  });
  if (byCode) return byCode;

  const byInferred = list.find((cc) => inferCategoryKeyFromCostCenter(cc) === meta.key);
  if (byInferred) return byInferred;

  return null;
}

/**
 * Associa um item lido da fatura ao Centro de Custo (Categoria) mais adequado da obra.
 */
function matchItemToProjectCostCenter(item = {}, costCenters = [], fallbackCategory = "MATERIAIS_INSUMOS") {
  const list = Array.isArray(costCenters) ? costCenters : [];
  if (!list.length) return null;

  // 1) Se o Gemini indicou costCenterHint (código ou nome do CC da obra)
  const hint = String(item.costCenterHint || "").trim();
  if (hint) {
    const hintUpper = hint.toUpperCase();
    const hintNorm = normalizeTextKey(hint);
    const exactCode = list.find((cc) => String(cc.code || "").toUpperCase().trim() === hintUpper);
    if (exactCode) return exactCode;
    const byNameOrCode = list.find((cc) => {
      const cCode = String(cc.code || "").toUpperCase().trim();
      const cName = normalizeTextKey(cc.name);
      return (
        (cCode && hintUpper.includes(cCode)) ||
        (cName && hintNorm && (cName === hintNorm || cName.includes(hintNorm) || hintNorm.includes(cName)))
      );
    });
    if (byNameOrCode) return byNameOrCode;
  }

  // 2) Similaridade textual entre a descrição do item e o nome/descrição do Centro de Custo
  let bestCC = null;
  let bestScore = 0;
  for (const cc of list) {
    const score = computeDescriptionSimilarity(
      item.description || "",
      `${cc.name || ""} ${cc.description || ""}`
    );
    if (score > bestScore) {
      bestScore = score;
      bestCC = cc;
    }
  }
  if (bestCC && bestScore >= 0.3) return bestCC;

  // 3) Categoria semântica (ex.: Materiais, Mão de Obra, Equipamentos, etc.)
  const catKey = INVOICE_CATEGORY_META[item.category]
    ? item.category
    : inferCostCategoryFromText(item.description, fallbackCategory);
  const byCategory = matchCostCenterForCategory(list, catKey);
  if (byCategory) return byCategory;

  // 4) Fallback para o primeiro Centro de Custo ativo da obra
  return list.find((cc) => cc.active !== false) || list[0];
}

module.exports = {
  resolveOrCreateSupplierFromInvoice,
  matchInvoiceItemsToNeeds,
  inferCategoryKeyFromCostCenter,
  matchCostCenterForCategory,
  matchItemToProjectCostCenter,
};
