/**
 * Totais e estado dos pedidos de pagamento — FONTE ÚNICA.
 *
 * ⚠️ Corrige um defeito: a fiscalidade das linhas estava escrita em **texto** nas
 * notas ("IVA 14% · Ret. 6,5% · Desc. 5%") e era lida de volta por expressão regular;
 * a **retenção na fonte era extraída e descartada** no cálculo do total. O sistema
 * mandava pagar ao fornecedor o valor da retenção que devia ficar retido — num pedido
 * de 1 000 000 com IVA 14%, retenção 6,5% e desconto 5%, mandava pagar 1 083 000 em
 * vez de 1 021 250 (61 750 a mais).
 *
 * A fórmula, igual à do protótipo (`rpLin` / `rpTot`):
 *
 *   base  = quantidade × preço × (1 − desconto%)
 *   IVA   = base × iva%
 *   RF    = base × retenção%
 *   total = base + IVA − RF          ← o que o fornecedor recebe
 *
 * A retenção não desaparece: fica retida e é entregue ao Estado. Por isso vai
 * separada em `withheld`, para o mapa fiscal a poder usar.
 */

const N = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;

/** Condições de pagamento possíveis. */
const PAYMENT_TERMS = ["PRONTO", "CREDITO", "PARCIAL"];

/** Tipos de pedido e se levam linhas de item. */
const REQUEST_TYPES = [
  ["SEDE", "Pedido geral (sede)", true],
  ["OBRA", "Pedido para obra", true],
  ["FROTA", "Frota e equipamentos", true],
  ["IMPOSTOS", "Impostos", false],
  ["PESSOAL", "Pessoal", false],
  ["EMPRESTIMO", "Empréstimo", false],
];

/** Os tipos que se descrevem por linhas de item. */
const ITEM_TYPES = REQUEST_TYPES.filter(([, , hasItems]) => hasItems).map(([k]) => k);

const hasItems = (type) => ITEM_TYPES.includes(type);

/**
 * Lê as percentagens de uma linha: primeiro as colunas; se estiverem vazias,
 * recupera do texto das notas (dados antigos que a migração não apanhou).
 */
function itemRates(item) {
  const fromColumn = {
    vat: item.vatPercent,
    withholding: item.withholdingPercent,
    discount: item.discountPercent,
  };
  const anyColumn =
    fromColumn.vat !== null && fromColumn.vat !== undefined
      ? true
      : fromColumn.withholding !== null && fromColumn.withholding !== undefined
        ? true
        : fromColumn.discount !== null && fromColumn.discount !== undefined;

  if (anyColumn) {
    return { vat: N(fromColumn.vat), withholding: N(fromColumn.withholding), discount: N(fromColumn.discount) };
  }
  return parseRatesFromNotes(item.notes);
}

/** Compatibilidade com as linhas antigas, onde a fiscalidade vinha no texto. */
function parseRatesFromNotes(notes) {
  const text = String(notes || "");
  const pick = (re) => {
    const m = text.match(re);
    return m ? Number(String(m[1]).replace(",", ".")) : 0;
  };
  return {
    vat: pick(/IVA\s+(\d+(?:[.,]\d+)?)\s*%/i),
    withholding: pick(/Ret\.?\s+(\d+(?:[.,]\d+)?)\s*%/i),
    discount: pick(/Desc\.?\s+(\d+(?:[.,]\d+)?)\s*%/i),
  };
}

/** Quantidade × preço da linha, ou o total escrito quando não há preço unitário. */
function itemGross(item) {
  const qty = N(item.quantity);
  const price = N(item.unitPrice);
  if (qty && price) return qty * price;
  return N(item.totalPrice);
}

/**
 * Uma linha decomposta.
 * @returns {{gross:number, base:number, vat:number, withheld:number, total:number, rates:object}}
 */
function lineTotals(item) {
  const rates = itemRates(item);
  const gross = itemGross(item);
  const base = gross * (1 - rates.discount / 100);
  const vat = (base * rates.vat) / 100;
  const withheld = (base * rates.withholding) / 100;
  return {
    gross: round2(gross),
    base: round2(base),
    vat: round2(vat),
    withheld: round2(withheld),
    total: round2(base + vat - withheld),
    rates,
  };
}

/**
 * Totais de um pedido de pagamento.
 *
 * Os tipos sem itens (impostos, pessoal, empréstimo) tiram o valor de `typeData`,
 * como no protótipo.
 *
 * @returns {{base:number, vat:number, withheld:number, total:number, lines:Array, source:string}}
 */
function orderTotals(order) {
  const type = order?.requestType || "SEDE";

  if (type === "IMPOSTOS") {
    const v = round2(N(order?.typeData?.valor));
    return { base: v, vat: 0, withheld: 0, total: v, lines: [], source: "impostos" };
  }
  if (type === "PESSOAL") {
    const linhas = Array.isArray(order?.typeData?.linhas) ? order.typeData.linhas : [];
    const v = round2(linhas.reduce((s, l) => s + N(l.valor), 0));
    return { base: v, vat: 0, withheld: 0, total: v, lines: [], source: "pessoal" };
  }
  if (type === "EMPRESTIMO") {
    const v = round2(N(order?.typeData?.valor));
    return { base: v, vat: 0, withheld: 0, total: v, lines: [], source: "emprestimo" };
  }

  const items = order?.items || [];
  const lines = items.map(lineTotals);
  if (lines.length) {
    return {
      base: round2(lines.reduce((s, l) => s + l.base, 0)),
      vat: round2(lines.reduce((s, l) => s + l.vat, 0)),
      withheld: round2(lines.reduce((s, l) => s + l.withheld, 0)),
      total: round2(lines.reduce((s, l) => s + l.total, 0)),
      lines,
      source: "itens",
    };
  }

  // Sem linhas: o valor cotado, senão o valor escrito no pedido
  const quoted = N(order?.requisition?.quotedValue);
  const fallback = quoted > 0 ? quoted : N(order?.totalValue);
  const v = round2(fallback);
  return { base: v, vat: 0, withheld: 0, total: v, lines: [], source: quoted > 0 ? "cotacao" : "pedido" };
}

/**
 * Uma linha do pedido como vai para a base de dados — **para criar e para editar**.
 *
 * Estava escrita duas vezes, uma em cada rota, e as duas cópias divergiram: a de
 * editar não copiava `vatPercent`, `withholdingPercent`, `discountPercent` nem
 * `docException`. Editar um pedido apagava a fiscalidade de todas as linhas e
 * punha o total a quantidade × preço outra vez. Duas cópias da mesma regra é
 * uma a mais.
 *
 * @param {object} item a linha validada que vem do pedido HTTP
 * @param {number} index a ordem em que aparece
 */
function itemRowForDb(item, index = 0) {
  const quantity = N(item?.quantity);
  // Sem preço utilizável, o total fica **nulo**, não zero: zero diria que a
  // linha custa nada, quando o que se passa é que ainda não tem preço — é o
  // caso de tudo o que vai à cotação. (Antes gravava-se preço nulo e total
  // zero na mesma linha, o que era dizer as duas coisas ao mesmo tempo.)
  const unitPrice = N(item?.unitPrice) > 0 ? N(item.unitPrice) : null;
  return {
    name: item?.name,
    quantity: item?.quantity,
    unit: item?.unit || null,
    unitPrice,
    totalPrice: unitPrice === null ? null : quantity * unitPrice,
    notes: item?.notes || null,
    vatPercent: item?.vatPercent ?? null,
    withholdingPercent: item?.withholdingPercent ?? null,
    discountPercent: item?.discountPercent ?? null,
    docException: item?.docException || null,
    code: item?.code ? String(item.code).trim() || null : null,
    lineSupplierName: item?.lineSupplierName ? String(item.lineSupplierName).trim() || null : null,
    order: index,
  };
}

/**
 * As parcelas acordadas na requisição (Crédito em Parcelas): `typeData.parcelas`
 * = [{ data: "AAAA-MM-DD", valor }]. Devolve as prestações a gravar, ou null se
 * não houver pelo menos duas parcelas válidas que somem o total (±0,5).
 */
function parcelasAcordadas(typeData, total) {
  const L = Array.isArray(typeData?.parcelas) ? typeData.parcelas : [];
  if (L.length < 2) return null;
  const out = [];
  for (const [i, p] of L.entries()) {
    const data = String(p?.data || "").slice(0, 10);
    const valor = round2(N(p?.valor));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !(valor > 0)) return null;
    out.push({ number: i + 1, amount: valor, dueDate: data });
  }
  const soma = round2(out.reduce((s, p) => s + p.amount, 0));
  if (!(N(total) > 0) || Math.abs(soma - N(total)) > 0.5) return null;
  return out;
}

/** Quanto já foi pago, pelas prestações liquidadas. */
function paidAmount(order) {
  const inst = order?.paymentPlan?.installments || [];
  return round2(inst.filter((i) => i.status === "PAGO").reduce((s, i) => s + N(i.amount), 0));
}

/** O próximo vencimento ainda em aberto. */
function nextDueDate(order) {
  const inst = (order?.paymentPlan?.installments || [])
    .filter((i) => i.status !== "PAGO" && i.dueDate)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  if (inst.length) return inst[0].dueDate;
  return order?.dueDate || null;
}

/** O dia (sem horas), para comparar vencimentos sem o instante contar. */
function dayOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Estado **derivado**, como o `rpEst` do protótipo: persiste-se o estado de
 * decisão e calcula-se o resto. Evita estados inconsistentes na base de dados.
 *
 * @returns {{code:string, label:string, severity:"good"|"warn"|"bad"|"neutral"}}
 */
function derivedStatus(order, today = new Date()) {
  const persisted = order?.status;

  if (order?.deletedAt) return { code: "ELIMINADO", label: "Eliminado", severity: "bad" };
  if (persisted === "CANCELADO") return { code: "CANCELADO", label: "Cancelado", severity: "bad" };
  if (persisted === "NAO_APROVADO") return { code: "REJEITADO", label: "Rejeitado", severity: "bad" };
  if (order?.onHold) return { code: "EM_PAUSA", label: "Em pausa", severity: "warn" };
  if (persisted === "RASCUNHO") return { code: "RASCUNHO", label: "Rascunho", severity: "neutral" };
  if (persisted === "PENDENTE_REQUISICAO") return { code: "EM_COTACAO", label: "Em cotação", severity: "warn" };
  if (persisted === "PENDENTE_APROVACAO") return { code: "POR_APROVAR", label: "Por aprovar", severity: "warn" };

  const total = orderTotals(order).total;
  const paid = paidAmount(order);

  if (total > 0 && paid >= total - 0.5) return { code: "PAGO", label: "Pago", severity: "good" };
  if (order?.typeData?.emTransito) return { code: "EM_TRANSITO", label: "Em trânsito", severity: "warn" };

  // O atraso vem antes do pagamento parcial, como no protótipo: um pedido com
  // uma prestação paga e a seguinte vencida está **atrasado** — é isso que
  // interessa a quem paga, não que já se pagou parte.
  //
  // Compara-se o **dia**, não o instante: vencer hoje não é estar atrasado. A
  // data guardada é meia-noite, por isso qualquer hora do dia a dava como
  // passada — no Centro de Pagamentos um pedido que vence hoje aparecia
  // «Atrasado» em vermelho ao lado do seu próprio «vence hoje». É a mesma
  // regra do `daysPastDue` do financeiro (dia local, sem horas).
  const due = nextDueDate(order);
  if (due && dayOf(new Date(due)) < dayOf(today)) return { code: "ATRASADO", label: "Atrasado", severity: "bad" };

  if (paid > 0) return { code: "PAGO_PARCIAL", label: "Pago parcial", severity: "warn" };

  return { code: "EM_ABERTO", label: "Em aberto", severity: "neutral" };
}

/**
 * Documentos exigidos e em falta.
 *
 * A proforma só se exige quando o pedido passou por cotação e não é do fundo de
 * maneio. A fatura dispensa-se nas linhas marcadas DSC (despesa sem comprovativo)
 * ou AF (autofaturação). O comprovativo exige-se depois de haver pagamento.
 */
function documentStatus(order) {
  const attachments = order?.requisition?.attachments || [];
  const names = attachments.map((a) => String(a.fileName || "").toLowerCase());
  const has = (kind) => names.some((n) => n.includes(kind));

  const items = order?.items || [];
  const nSC = items.filter((i) => i.docException === "DSC").length;
  const nAF = items.filter((i) => i.docException === "AF").length;
  const allExcepted = items.length > 0 && nSC + nAF === items.length;

  const needsProforma = Boolean(order?.requiresQuote) && order?.paymentMode !== "FM";
  const needsInvoice =
    hasItems(order?.requestType || "SEDE") &&
    !allExcepted &&
    !["RASCUNHO", "PENDENTE_REQUISICAO", "PENDENTE_APROVACAO"].includes(order?.status);
  const needsReceipt = paidAmount(order) > 0;

  const docs = [
    { kind: "proforma", label: "Proforma", required: needsProforma, present: has("proforma") },
    { kind: "fatura", label: "Fatura", required: needsInvoice, present: has("fatura") },
    { kind: "comprovativo", label: "Comprovativo de pagamento", required: needsReceipt, present: has("comprovativo") },
  ];

  return {
    docs,
    missing: docs.filter((d) => d.required && !d.present).map((d) => d.kind),
    exceptions: { dsc: nSC, af: nAF, all: allExcepted },
  };
}

/** Quem recebe: fornecedor, colaboradores, a AGT, ou o fundo de maneio. */
function beneficiary(order) {
  const type = order?.requestType || "SEDE";
  const d = order?.typeData || {};
  if (type === "IMPOSTOS") return order?.supplierName || "AGT — Administração Geral Tributária";
  if (type === "PESSOAL") {
    const l = Array.isArray(d.linhas) ? d.linhas : [];
    if (l.length === 1) return l[0].nome || "—";
    return `${l.length} colaborador(es)`;
  }
  if (type === "EMPRESTIMO") return d.terc || d.por || "—";
  if (order?.paymentMode === "FM") {
    return order?.supplierName ? `${order.supplierName} (fundo de maneio)` : "Fundo de maneio";
  }
  return order?.supplierName || "—";
}

/** Uma linha de descrição curta, para listas e notificações. */
function shortDescription(order) {
  const type = order?.requestType || "SEDE";
  const d = order?.typeData || {};
  if (type === "IMPOSTOS") return [d.tipo || "Imposto", d.mes].filter(Boolean).join(" · ");
  if (type === "PESSOAL") return [d.sub || "Pessoal", d.mes].filter(Boolean).join(" · ");
  if (type === "EMPRESTIMO") return ["Empréstimo", d.fim].filter(Boolean).join(" · ");
  const items = (order?.items || []).filter((i) => i.name);
  if (!items.length) return order?.description || "";
  return items[0].name + (items.length > 1 ? ` (+${items.length - 1} itens)` : "");
}

/** Divide o total em N prestações iguais, com o resto na última. */
function splitInstallments(total, count, firstDate, stepDays = 30) {
  const n = Math.max(1, Math.min(24, Math.round(N(count)) || 1));
  const t = round2(total);
  const each = Math.floor((t / n) * 100) / 100;
  const start = firstDate ? new Date(firstDate) : new Date();
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const amount = i === n - 1 ? round2(t - each * (n - 1)) : each;
    const due = new Date(start.getTime() + i * stepDays * 86400000);
    out.push({ number: i + 1, amount, dueDate: due.toISOString().slice(0, 10) });
  }
  return out;
}

/** Tudo o que a lista e o detalhe precisam, num só sítio. */
function decorateOrder(order, today = new Date()) {
  const totals = orderTotals(order);
  const paid = paidAmount(order);
  const status = derivedStatus(order, today);
  const docs = documentStatus(order);
  return {
    totals,
    paid,
    outstanding: round2(totals.total - paid),
    status: status.code,
    statusLabel: status.label,
    statusSeverity: status.severity,
    dueDate: nextDueDate(order),
    documents: docs,
    beneficiary: beneficiary(order),
    shortDescription: shortDescription(order),
  };
}

module.exports = {
  PAYMENT_TERMS,
  REQUEST_TYPES,
  ITEM_TYPES,
  hasItems,
  itemRowForDb,
  itemRates,
  parseRatesFromNotes,
  itemGross,
  lineTotals,
  orderTotals,
  paidAmount,
  nextDueDate,
  derivedStatus,
  documentStatus,
  beneficiary,
  shortDescription,
  splitInstallments,
  decorateOrder,
  parcelasAcordadas,
};
