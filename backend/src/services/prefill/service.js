const { prisma } = require("../../db");
const { similarity } = require("../ai/needs/service");

/**
 * Pré-preenchimento inteligente (Fase 4).
 *
 * Para um produto/serviço escrito num pedido de compra, devolve o que foi
 * usado da última vez para o mesmo produto: fornecedor (nome, NIF, IBAN),
 * categoria de custo, centro de custo (na mesma obra), unidade e preço.
 * Sem IA: só histórico do sistema. O formulário mostra a sugestão e a
 * pessoa decide aplicá-la; só preenche campos vazios.
 */

const MIN_SCORE = 0.6;
const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "para", "com", "e", "a", "o", "em", "un", "und"]);

const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Palavra mais distintiva do texto (a mais longa), para filtrar na BD.
 * Devolve a forma escrita e a forma sem acentos (a BD compara acentos).
 */
function keyword(text) {
  const words = String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(fold(w)) && !/^\d+$/.test(w));
  const best = words.sort((a, b) => b.length - a.length)[0];
  if (!best) return null;
  return [...new Set([best, fold(best)])];
}

const containsAny = (field, kws) => ({ OR: kws.map((k) => ({ [field]: { contains: k, mode: "insensitive" } })) });

const num = (v) => (v == null ? null : Number(v));

/**
 * Escolhe a melhor correspondência: a mais parecida e, em empate, a mais
 * recente. Pura (testável).
 * @param {string} description
 * @param {{description:string, date:Date|string}[]} rows
 */
function bestMatch(description, rows, { min = MIN_SCORE } = {}) {
  let best = null;
  for (const row of rows) {
    const score = similarity(description, row.description);
    if (score < min) continue;
    const t = new Date(row.date).getTime() || 0;
    if (!best || score > best.score + 0.05 || (Math.abs(score - best.score) <= 0.05 && t > best.t)) {
      best = { row, score, t };
    }
  }
  return best ? { ...best.row, score: best.score } : null;
}

function parseTax(notes, label) {
  const m = String(notes || "").match(new RegExp(`${label}\\s+(\\d+(?:[.,]\\d+)?)\\s*%`, "i"));
  return m ? Number(String(m[1]).replace(",", ".")) : null;
}

/**
 * @param {{description:string, projectId?:string|null, projectIds:string[]}} opts
 *   projectIds: obras que o utilizador pode ver (o histórico de outras não entra).
 */
async function purchasePrefill({ description, projectId = null, projectIds }) {
  const kw = keyword(description);
  if (!kw) return { suggestion: null };
  const visible = { OR: [{ projectId: null }, { projectId: { in: projectIds } }] };

  // 1) Pedidos extra anteriores com um item parecido.
  const items = await prisma.extraRequestItem.findMany({
    where: {
      AND: [containsAny("description", kw), { extraRequest: { status: { notIn: ["CANCELADO", "REJEITADO"] }, ...visible } }],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      description: true,
      unit: true,
      unitPrice: true,
      notes: true,
      createdAt: true,
      extraRequest: {
        select: {
          id: true,
          type: true,
          projectId: true,
          costCenterId: true,
          costCategoryId: true,
          paymentSource: true,
          supplierId: true,
          supplierName: true,
          supplierNif: true,
          supplierIban: true,
          requestedAt: true,
          description: true,
          project: { select: { name: true, code: true } },
          costCategory: { select: { name: true } },
        },
      },
    },
  });
  const extraHit = bestMatch(
    description,
    items.map((i) => ({ ...i, date: i.extraRequest.requestedAt || i.createdAt }))
  );

  // 2) Cotações escolhidas em necessidades parecidas (fornecedor e preço).
  const needs = await prisma.workNeed.findMany({
    where: {
      ...containsAny("description", kw),
      quotes: { some: { selected: true } },
      projectId: { in: projectIds },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      description: true,
      unit: true,
      updatedAt: true,
      projectId: true,
      costCenterId: true,
      project: { select: { name: true, code: true } },
      quotes: {
        where: { selected: true },
        take: 1,
        select: {
          quotedPrice: true,
          vatPercent: true,
          supplier: { select: { id: true, name: true, nif: true, iban: true, bankAccounts: { select: { iban: true }, take: 1 } } },
        },
      },
    },
  });
  const needHit = bestMatch(description, needs.map((n) => ({ ...n, date: n.updatedAt })));

  if (!extraHit && !needHit) return { suggestion: null };

  // O pedido extra é a fonte principal (tem categoria e origem de pagamento);
  // a cotação completa o fornecedor quando o pedido não o tinha.
  const er = extraHit?.extraRequest;
  const q = needHit?.quotes?.[0];
  const useExtraFirst = extraHit && (!needHit || new Date(extraHit.date) >= new Date(needHit.date) || er?.supplierName);

  let supplier = null;
  if (er?.supplierName && useExtraFirst) {
    supplier = { id: er.supplierId || null, name: er.supplierName, nif: er.supplierNif || null, iban: er.supplierIban || null };
  } else if (q?.supplier) {
    supplier = {
      id: q.supplier.id,
      name: q.supplier.name,
      nif: q.supplier.nif || null,
      iban: q.supplier.bankAccounts?.[0]?.iban || q.supplier.iban || null,
    };
  } else if (er?.supplierName) {
    supplier = { id: er.supplierId || null, name: er.supplierName, nif: er.supplierNif || null, iban: er.supplierIban || null };
  }

  const sameProject = (pid) => Boolean(projectId && pid && pid === projectId);
  let costCenterId = null;
  if (er && sameProject(er.projectId) && er.costCenterId) costCenterId = er.costCenterId;
  else if (needHit && sameProject(needHit.projectId) && needHit.costCenterId) costCenterId = needHit.costCenterId;

  const src = useExtraFirst ? extraHit : needHit;
  const unitPrice = useExtraFirst ? num(extraHit.unitPrice) : num(q?.quotedPrice);
  const basedOnProject = (useExtraFirst ? er?.project : needHit?.project) || null;

  return {
    suggestion: {
      matchedDescription: src.description,
      score: src.score,
      unit: src.unit || null,
      unitPrice: unitPrice != null && unitPrice > 0 ? unitPrice : null,
      vatPercent: useExtraFirst ? parseTax(extraHit.notes, "IVA") : num(q?.vatPercent),
      supplier,
      costCategoryId: er?.costCategoryId ?? null,
      costCategoryName: er?.costCategory?.name || null,
      costCenterId,
      paymentSource: er?.paymentSource || null,
      basedOn: {
        kind: useExtraFirst ? "EXTRA_REQUEST" : "NEED_QUOTE",
        date: src.date,
        project: basedOnProject ? [basedOnProject.code, basedOnProject.name].filter(Boolean).join(" · ") : null,
      },
    },
  };
}

module.exports = { purchasePrefill, bestMatch, keyword };
