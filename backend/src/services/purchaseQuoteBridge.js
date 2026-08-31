const { quoteFiscalSnapshot } = require("./needInstallmentSchedulingService");

const SOURCE_COTACAO = "__source:cotacao";
const SOURCE_MANUAL = "__source:manual";

const QUOTE_BRIDGE_INCLUDE = {
  supplier: {
    select: {
      id: true,
      name: true,
      nif: true,
      vatPercent: true,
      withholdingPercent: true,
      discountPercent: true,
    },
  },
  supplierProduct: {
    select: { vatPercent: true, withholdingPercent: true, discountPercent: true },
  },
  supplierOrder: { select: { proformaUrl: true } },
};

function requisitionSource(notes) {
  const t = String(notes || "");
  if (t.includes(SOURCE_MANUAL)) return "manual";
  if (t.includes(SOURCE_COTACAO)) return "cotacao";
  return null;
}

function withSourceTag(existingNotes, source) {
  const t = String(existingNotes || "")
    .replace(/\s*__source:(cotacao|manual)\s*/g, "")
    .trim();
  const tag = source === "manual" ? SOURCE_MANUAL : SOURCE_COTACAO;
  return t ? `${t}\n${tag}` : tag;
}

function fileNameFromUrl(url) {
  try {
    const path = decodeURIComponent(String(url || "").split("?")[0]);
    const last = path.split("/").filter(Boolean).pop();
    return last || "Proforma";
  } catch {
    return "Proforma";
  }
}

function pickQuotesForNeed(need) {
  const quotes = need?.quotes || [];
  const selected = quotes.filter((q) => q.selected);
  if (selected.length) return selected;
  return quotes.slice(0, 1);
}

function quoteGross(quote, need) {
  const storedNet = Number(quote?.netTotal);
  const storedVat = Number(quote?.vatAmount) || 0;
  if (Number.isFinite(storedNet) && storedNet > 0) {
    return Math.round((storedNet + storedVat) * 100) / 100;
  }
  const snap = quoteFiscalSnapshot(quote, need || quote?.need);
  return Number(snap?.gross) || Number(quote?.totalValue) || 0;
}

function snapshotFromNeeds(needs, requisition = null) {
  const quotes = [];
  for (const need of needs || []) {
    for (const quote of pickQuotesForNeed(need)) {
      quotes.push({ ...quote, need });
    }
  }

  const quoted = quotes.length > 0;
  const quotedValue = quotes.reduce((sum, q) => sum + quoteGross(q, q.need), 0);

  const supplierCounts = new Map();
  for (const q of quotes) {
    const id = q.supplierId || q.supplier?.id;
    if (!id) continue;
    const prev = supplierCounts.get(id) || { count: 0, supplier: q.supplier };
    prev.count += 1;
    supplierCounts.set(id, prev);
  }
  let supplier = null;
  let supplierId = null;
  let best = 0;
  for (const [id, info] of supplierCounts) {
    if (info.count > best) {
      best = info.count;
      supplierId = id;
      supplier = info.supplier;
    }
  }

  const proformaUrls = [];
  const seen = new Set();
  for (const q of quotes) {
    for (const url of [q.proformaUrl, q.supplierOrder?.proformaUrl]) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      proformaUrls.push(url);
    }
  }

  return {
    quoted,
    overridden: requisitionSource(requisition?.notes) === "manual",
    quotedValue: quoted ? String(Math.round(quotedValue * 100) / 100) : null,
    supplierId: supplierId || null,
    supplierName: supplier?.name || null,
    supplierNif: supplier?.nif || null,
    proformas: proformaUrls.map((url) => ({ url, fileName: fileNameFromUrl(url) })),
    quoteCount: quotes.length,
  };
}

async function loadPedidoNeeds(prisma, purchaseOrderId) {
  return prisma.workNeed.findMany({
    where: { purchaseOrderId },
    include: {
      quotes: {
        include: QUOTE_BRIDGE_INCLUDE,
        orderBy: [{ selected: "desc" }, { createdAt: "desc" }],
      },
    },
  });
}

async function buildCotacaoSnapshot(prisma, purchaseOrderId, requisition = null) {
  const needs = await loadPedidoNeeds(prisma, purchaseOrderId);
  return snapshotFromNeeds(needs, requisition);
}

async function applyRequisitionFromCotacao(prisma, purchaseOrderId) {
  if (!purchaseOrderId) return null;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { requisition: { include: { attachments: true } } },
  });
  if (!order) return null;
  if (!["PENDENTE_REQUISICAO", "NAO_APROVADO"].includes(order.status)) return null;
  if (requisitionSource(order.requisition?.notes) === "manual") return order.requisition;

  const snapshot = await buildCotacaoSnapshot(prisma, purchaseOrderId, order.requisition);
  if (!snapshot.quoted) return order.requisition;

  const quotedValue = Number(snapshot.quotedValue);
  const data = {
    supplierId: snapshot.supplierId || null,
    supplierName: snapshot.supplierName || null,
    quotedValue: Number.isFinite(quotedValue) && quotedValue > 0 ? quotedValue : null,
    notes: withSourceTag(order.requisition?.notes, "cotacao"),
  };

  let requisition;
  if (order.requisition) {
    requisition = await prisma.purchaseRequisition.update({
      where: { purchaseOrderId: order.id },
      data,
      include: { attachments: true },
    });
  } else {
    requisition = await prisma.purchaseRequisition.create({
      data: { purchaseOrderId: order.id, ...data },
      include: { attachments: true },
    });
  }

  await prisma.purchaseOrder.update({
    where: { id: order.id },
    data: {
      ...(data.quotedValue != null ? { totalValue: data.quotedValue } : {}),
      supplierId: snapshot.supplierId || order.supplierId,
      supplierName: snapshot.supplierName || order.supplierName,
    },
  });

  const existingUrls = new Set((requisition.attachments || []).map((a) => a.url));
  for (const file of snapshot.proformas) {
    if (existingUrls.has(file.url)) continue;
    await prisma.purchaseAttachment.create({
      data: {
        purchaseRequisitionId: requisition.id,
        fileName: file.fileName,
        mimeType: "application/pdf",
        size: 0,
        url: file.url,
        uploadedByName: "Cotação",
      },
    });
    existingUrls.add(file.url);
  }

  return prisma.purchaseRequisition.findUnique({
    where: { id: requisition.id },
    include: { attachments: true },
  });
}

async function syncPurchaseRequisitionFromNeed(prisma, needId) {
  if (!needId) return null;
  const need = await prisma.workNeed.findUnique({
    where: { id: needId },
    select: { purchaseOrderId: true },
  });
  if (!need?.purchaseOrderId) return null;
  return applyRequisitionFromCotacao(prisma, need.purchaseOrderId);
}

function cotacaoFromOrder(order) {
  return snapshotFromNeeds(order?.workNeeds || [], order?.requisition);
}

module.exports = {
  SOURCE_COTACAO,
  SOURCE_MANUAL,
  withSourceTag,
  requisitionSource,
  snapshotFromNeeds,
  buildCotacaoSnapshot,
  applyRequisitionFromCotacao,
  syncPurchaseRequisitionFromNeed,
  cotacaoFromOrder,
};
