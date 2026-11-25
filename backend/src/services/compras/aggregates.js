/**
 * Agregações da área Compras e Stock (o `NAV_COMP` do protótipo).
 *
 * Funções puras sobre linhas já carregadas da base de dados, para poderem ser
 * testadas sem Prisma:
 *  - C3 Base de Preços            → `buildPriceBase`
 *  - C5 Compromissos Pendentes    → `buildCommitments`
 *  - C6 Conta Corrente de Fornec. → `buildSupplierAccounts`, `supplierStatement`
 *  - S3 Stock por Armazém         → `buildStockByWarehouse`
 */

const PRICE_VALID_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(num(v) * 100) / 100;

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function startOfDay(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

function ageDays(date, today = new Date()) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((startOfDay(today) - startOfDay(d)) / DAY_MS);
}

// ─── C3 Base de Preços ──────────────────────────────────────────────────────

/**
 * Preços de compra de toda a empresa: as tabelas de preço dos fornecedores
 * (`SupplierProduct`) e os preços das cotações escolhidas (`NeedQuote` com
 * `selected`). Um preço vale `PRICE_VALID_DAYS` dias, salvo validade própria.
 */
function buildPriceBase({ supplierProducts = [], quotes = [] }, today = new Date()) {
  const rows = [];
  supplierProducts.forEach((p) => {
    const date = p.updatedAt || p.createdAt;
    const age = ageDays(date, today);
    const validUntil = p.validUntil ? new Date(p.validUntil) : null;
    const valid = validUntil ? startOfDay(validUntil) >= startOfDay(today) : age !== null && age <= PRICE_VALID_DAYS;
    rows.push({
      id: `sp:${p.id}`,
      origem: "Tabela do fornecedor",
      tipo: p.product?.category || null,
      artigo: p.product?.name || p.name,
      codigo: p.product?.sku || null,
      un: p.unit || (p.product?.unit ? String(p.product.unit).toLowerCase() : null),
      preco: round2(p.price),
      moeda: p.currency || "AOA",
      iva: p.vatPercent != null ? num(p.vatPercent) : null,
      fornecedor: p.supplier?.name || null,
      fornecedorId: p.supplierId || null,
      obra: null,
      data: date || null,
      validade: validUntil,
      idade: age,
      valido: Boolean(valid),
    });
  });
  quotes.forEach((q) => {
    const date = q.updatedAt || q.createdAt;
    const age = ageDays(date, today);
    const qty = num(q.quantity) || num(q.need?.quantity);
    const unit = num(q.quotedPrice) || (qty ? num(q.totalValue) / qty : 0);
    rows.push({
      id: `nq:${q.id}`,
      origem: "Cotação adjudicada",
      tipo: null,
      artigo: q.need?.description || q.supplierProduct?.name || "—",
      codigo: null,
      un: q.need?.unit || q.supplierProduct?.unit || null,
      preco: round2(unit),
      moeda: q.currency || "AOA",
      iva: q.vatPercent != null ? num(q.vatPercent) : null,
      fornecedor: q.supplier?.name || null,
      fornecedorId: q.supplierId || null,
      obra: q.need?.project?.code || null,
      condicao: q.creditTermDays ? `Crédito ${q.creditTermDays} dias` : null,
      data: date || null,
      validade: null,
      idade: age,
      valido: age !== null && age <= PRICE_VALID_DAYS,
    });
  });
  rows.sort((a, b) => String(a.artigo).localeCompare(String(b.artigo), "pt") || num(a.preco) - num(b.preco));

  // O preço mais baixo válido por artigo (mesma moeda), para destacar.
  const best = new Map();
  rows.forEach((r) => {
    if (!r.valido || !(r.preco > 0)) return;
    const k = `${norm(r.artigo)}|${r.moeda}`;
    const cur = best.get(k);
    if (!cur || r.preco < cur.preco) best.set(k, r);
  });
  rows.forEach((r) => {
    r.melhor = best.get(`${norm(r.artigo)}|${r.moeda}`)?.id === r.id;
  });

  return {
    validadeDias: PRICE_VALID_DAYS,
    items: rows,
    totais: {
      precos: rows.length,
      validos: rows.filter((r) => r.valido).length,
      artigos: new Set(rows.map((r) => norm(r.artigo))).size,
      fornecedores: new Set(rows.map((r) => r.fornecedorId || norm(r.fornecedor)).filter(Boolean)).size,
    },
  };
}

// ─── C5 Compromissos Pendentes ─────────────────────────────────────────────

const REQ_OPEN = ["SUBMETIDA", "APROVADA", "PARCIAL"];

/**
 * Compras já assumidas que ainda não são uma dívida documentada, nos três
 * grupos do protótipo:
 *  - req → requisições das obras que ainda não viraram pedido de compra;
 *  - apr → pedidos por aprovar / em cotação (contas a pagar em `COMPROMISSO`);
 *  - sft → aprovados sem fatura (contas a pagar `A_PAGAR` sem documento).
 */
function buildCommitments({ requisitions = [], payables = [] }) {
  const items = [];
  requisitions
    .filter((r) => REQ_OPEN.includes(r.status) && !r.purchaseOrderId)
    .forEach((r) => {
      const v = (r.items || []).reduce(
        (s, i) => s + Math.max(0, num(i.quantity) - num(i.fulfilledQuantity)) * num(i.estimatedUnitPrice),
        0
      );
      items.push({
        id: `rq:${r.id}`,
        g: "req",
        ref: r.number,
        data: r.createdAt,
        obra: r.project?.code || null,
        obraNome: r.project?.name || null,
        projectId: r.projectId || null,
        fornecedor: "—",
        descricao: (r.items || []).map((i) => i.description).filter(Boolean).join(", ") || r.justification || "",
        situacao: `Requisição ${String(r.status).toLowerCase()}`,
        valor: round2(v),
        moeda: "AOA",
        link: `/requisicoes?id=${encodeURIComponent(r.id)}`,
      });
    });
  payables.forEach((p) => {
    const semFatura = p.stage === "A_PAGAR" && p.source === "PEDIDO_COMPRA";
    const g = p.stage === "COMPROMISSO" ? "apr" : semFatura ? "sft" : null;
    if (!g) return;
    items.push({
      id: p.id,
      g,
      ref: p.docNumber || null,
      data: p.date || null,
      obra: p.project?.code || null,
      obraNome: p.project?.name || null,
      projectId: p.projectId || null,
      fornecedor: p.supplier || p.beneficiary || "—",
      descricao: p.shortDescription || p.description || "",
      situacao: p.derivedStatusLabel || p.sourceLabel || p.status || "",
      valor: round2(p.payable),
      moeda: p.currency || "AOA",
      link: null,
    });
  });
  items.sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
  const grupo = (g) => {
    const L = items.filter((x) => x.g === g);
    return { n: L.length, valor: round2(L.reduce((s, x) => s + x.valor, 0)) };
  };
  return {
    items,
    grupos: { req: grupo("req"), apr: grupo("apr"), sft: grupo("sft") },
    total: round2(items.reduce((s, x) => s + x.valor, 0)),
  };
}

// ─── C6 Conta Corrente de Fornecedores ─────────────────────────────────────

function emptyAging() {
  return { av: 0, sd: 0, b1: 0, b2: 0, b3: 0, b4: 0, atr: 0 };
}

function addAging(a, value, daysLate) {
  if (daysLate === null || daysLate === undefined) a.sd += value;
  else if (daysLate <= 0) a.av += value;
  else if (daysLate <= 30) a.b1 += value;
  else if (daysLate <= 60) a.b2 += value;
  else if (daysLate <= 90) a.b3 += value;
  else a.b4 += value;
  if (daysLate > 0) a.atr += value;
}

function roundAging(a) {
  Object.keys(a).forEach((k) => {
    a[k] = round2(a[k]);
  });
  return a;
}

function supplierKey(name, id) {
  return id ? `id:${id}` : `nome:${norm(name) || "—"}`;
}

/**
 * Quanto devemos a cada fornecedor e há quanto tempo (antiguidade pelo
 * vencimento), com o pago nos últimos 12 meses e o último pagamento.
 * `payables`: contas a pagar `A_PAGAR` (o que o Centro de Pagamentos mostra);
 * `payments`: liquidações (`loadRecentPayments`), com `party` = beneficiário.
 */
function buildSupplierAccounts({ payables = [], payments = [], suppliers = [], orders = [], notes = [] }, moeda = "AOA") {
  const byName = new Map(suppliers.map((s) => [norm(s.name), s]));
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const M = new Map();
  const get = (name, id) => {
    const rec = (id && byId.get(id)) || byName.get(norm(name)) || null;
    const key = supplierKey(rec?.name || name, rec?.id || null);
    let x = M.get(key);
    if (!x) {
      const creditLimit = num(rec?.profile?.limiteCredito ?? rec?.profile?.creditLimit ?? 0);
      x = {
        chave: key,
        id: rec?.id || null,
        nome: rec?.name || name || "—",
        nif: rec?.nif || null,
        limiteCredito: creditLimit > 0 ? round2(creditLimit) : null,
        saldo: 0,
        semFatura: 0,
        ncTotal: 0,
        ndTotal: 0,
        retencao: 0,
        documentos: 0,
        pago12m: 0,
        ultPagamento: null,
        ag: emptyAging(),
      };
      M.set(key, x);
    }
    return x;
  };

  // Pre-seed orders info (sem fatura & retenção)
  const orderHasInvoice = new Map();
  orders.forEach((o) => {
    if ((o.currency || "AOA") !== moeda) return;
    const atts = o.requisition?.attachments || [];
    const hasFt = atts.some((a) => /fatura/i.test(a.fileName || ""));
    const allExc = (o.items || []).length > 0 && (o.items || []).every((i) => i.docException === "DSC" || i.docException === "AF");
    orderHasInvoice.set(o.id, hasFt || allExc);
    if (o.withheld > 0 && (o.supplierName || o.supplierId)) {
      const x = get(o.supplierName, o.supplierId);
      x.retencao += num(o.withheld);
    }
  });

  const moedas = new Set(["AOA"]);
  payables.forEach((p) => {
    if (p.currency) moedas.add(p.currency);
    if (p.stage !== "A_PAGAR" || (p.currency || "AOA") !== moeda) return;
    const name = p.supplier || p.beneficiary;
    if (!name && !p.supplierId) return;
    const x = get(name, p.supplierId);
    const v = num(p.payable);
    x.saldo += v;
    x.documentos += 1;
    if (p.source === "PEDIDO_COMPRA" && p.sourceId && orderHasInvoice.get(p.sourceId) === false) {
      x.semFatura += v;
    }
    addAging(x.ag, v, p.daysLate);
  });

  // Saldos iniciais e Notas de Crédito / Débito (v625)
  const today = new Date();
  notes.forEach((n) => {
    const cur = String(n.moeda || "AOA").toUpperCase();
    moedas.add(cur);
    if (cur !== moeda) return;
    const val = num(n.valor);
    if (!(val > 0)) return;
    const x = get(n.fornecedor, n.fornecedorId);
    if (n.tipo === "NC" || (n.tipo === "SI" && n.sentido === "CREDITO_NOSSO")) {
      x.saldo -= val;
      if (n.tipo === "NC") x.ncTotal += val;
    } else {
      // ND ou Saldo Inicial em dívida ao fornecedor
      x.saldo += val;
      x.ndTotal += val;
      x.documentos += 1;
      const dt = n.venc || n.data;
      const late = dt ? ageDays(dt, today) : 0;
      addAging(x.ag, val, late);
    }
  });

  if (moeda === "AOA") {
    payments.forEach((p) => {
      if (!p.party) return;
      const x = get(p.party, null);
      x.pago12m += num(p.amount);
      if (p.date && (!x.ultPagamento || new Date(p.date) > new Date(x.ultPagamento))) x.ultPagamento = p.date;
    });
  }

  const fornecedores = [...M.values()].map((x) => ({
    ...x,
    saldo: round2(x.saldo),
    semFatura: round2(x.semFatura),
    ncTotal: round2(x.ncTotal),
    ndTotal: round2(x.ndTotal),
    retencao: round2(x.retencao),
    pago12m: round2(x.pago12m),
    acimaLimite: Boolean(x.limiteCredito && x.saldo > x.limiteCredito + 0.5),
    ag: roundAging(x.ag),
  }));
  fornecedores.sort((a, b) => b.saldo - a.saldo || a.nome.localeCompare(b.nome, "pt"));
  const comSaldo = fornecedores.filter((f) => f.saldo > 0.5);
  const comFavor = fornecedores.filter((f) => f.saldo < -0.5);
  const comSemFat = fornecedores.filter((f) => f.semFatura > 0.5);
  const comAcimaLim = fornecedores.filter((f) => f.acimaLimite);
  const T = (k) => round2(fornecedores.reduce((s, f) => s + f.ag[k], 0));
  return {
    moeda,
    moedas: [...moedas],
    fornecedores,
    totais: {
      divida: round2(comSaldo.reduce((s, f) => s + f.saldo, 0)),
      comDivida: comSaldo.length,
      emAtraso: T("atr"),
      comAtraso: fornecedores.filter((f) => f.ag.atr > 0.5).length,
      mais90: T("b4"),
      com90: fornecedores.filter((f) => f.ag.b4 > 0.5).length,
      semFatura: round2(comSemFat.reduce((s, f) => s + f.semFatura, 0)),
      comSemFatura: comSemFat.length,
      aNossoFavor: round2(comFavor.reduce((s, f) => s + Math.abs(f.saldo), 0)),
      comFavor: comFavor.length,
      notasCredito: round2(fornecedores.reduce((s, f) => s + f.ncTotal, 0)),
      comAcimaLimite: comAcimaLim.length,
    },
  };
}

/** O extrato de um fornecedor: movimentos corridos Débito/Crédito/Saldo (v627/v631), documentos em aberto e pagamentos. */
function supplierStatement({ payables = [], payments = [], suppliers = [], orders = [], notes = [] }, chave, moeda = "AOA") {
  const acc = buildSupplierAccounts({ payables, payments, suppliers, orders, notes }, moeda);
  const f = acc.fornecedores.find((x) => x.chave === chave);
  if (!f) return null;
  const belongs = (name, id) => {
    if (f.id && id) return f.id === id;
    return norm(name) === norm(f.nome);
  };
  const abertos = payables
    .filter((p) => p.stage === "A_PAGAR" && (p.currency || "AOA") === moeda && belongs(p.supplier || p.beneficiary, p.supplierId))
    .map((p) => ({
      id: p.id,
      sourceId: p.sourceId || null,
      data: p.date || null,
      documento: p.docNumber || null,
      origem: p.sourceLabel || p.source,
      obra: p.project?.code || null,
      descricao: p.shortDescription || p.description || "",
      vencimento: p.dueDate || null,
      diasAtraso: p.daysLate ?? null,
      valor: round2(p.payable),
    }))
    .sort((a, b) => String(a.vencimento || "9").localeCompare(String(b.vencimento || "9")));

  const pagos =
    moeda === "AOA"
      ? payments
          .filter((p) => p.party && norm(p.party) === norm(f.nome))
          .map((p) => ({
            id: p.id,
            data: p.date,
            origem: p.sourceLabel || p.source,
            obra: p.project?.code || null,
            descricao: p.description || "",
            meio: p.method || null,
            valor: round2(p.amount),
          }))
          .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")))
      : [];

  // Extrato corrido (Débito / Crédito / Saldo) com Retenção na Fonte em linha própria (v627/v631)
  const movs = [];
  const fornNotes = notes.filter((n) => String(n.moeda || "AOA").toUpperCase() === moeda && belongs(n.fornecedor, n.fornecedorId));
  fornNotes.forEach((n) => {
    const val = round2(n.valor);
    if (n.tipo === "SI") {
      const cred = n.sentido === "CREDITO_NOSSO" ? 0 : val;
      const deb = n.sentido === "CREDITO_NOSSO" ? val : 0;
      movs.push({
        id: n.id,
        noteId: n.id,
        data: n.data,
        tp: "SI",
        doc: n.num ? `SI ${n.num}` : "Saldo Inicial",
        pedido: "",
        obra: "",
        desc: n.motivo || "Saldo do ano anterior",
        venc: n.venc || n.data,
        deb,
        cred,
      });
    } else if (n.tipo === "NC") {
      movs.push({
        id: n.id,
        noteId: n.id,
        data: n.data,
        tp: "NC",
        doc: n.num ? `NC ${n.num}` : "NC (por receber)",
        pedido: n.pedidoNum || "",
        obra: "",
        desc: n.motivo || "Nota de crédito de fornecedor",
        venc: "",
        deb: val,
        cred: 0,
      });
    } else {
      movs.push({
        id: n.id,
        noteId: n.id,
        data: n.data,
        tp: "ND",
        doc: n.num ? `ND ${n.num}` : "ND",
        pedido: n.pedidoNum || "",
        obra: "",
        desc: n.motivo || "Nota de débito de fornecedor",
        venc: n.venc || n.data,
        deb: 0,
        cred: val,
      });
    }
  });

  // Pedidos / faturas (valor bruto a crédito + linha RF a débito)
  const fornOrders = orders.filter((o) => (o.currency || "AOA") === moeda && belongs(o.supplierName, o.supplierId));
  const coveredOrderIds = new Set();
  fornOrders.forEach((o) => {
    coveredOrderIds.add(o.id);
    const bruto = round2(num(o.base) + num(o.vat));
    const rf = round2(num(o.withheld));
    const fatNum = (Array.isArray(o.typeData?.faturas) && o.typeData.faturas[0]?.num) || o.number;
    const dStr = o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : "";
    const vencStr = o.dueDate ? new Date(o.dueDate).toISOString().slice(0, 10) : "";
    if (bruto > 0.005) {
      movs.push({
        id: `ft:${o.id}`,
        orderId: o.id,
        data: dStr,
        tp: Array.isArray(o.typeData?.faturas) && o.typeData.faturas.length ? "FT" : "PD",
        doc: fatNum || o.number,
        pedido: o.number || "",
        obra: o.project?.code || "",
        desc: o.description || "",
        venc: vencStr,
        deb: 0,
        cred: bruto,
      });
    }
    if (rf > 0.005) {
      const pctRf = num(o.base) > 0 ? Math.round((rf / num(o.base)) * 1000) / 10 : 0;
      movs.push({
        id: `rf:${o.id}`,
        orderId: o.id,
        data: dStr,
        tp: "RF",
        doc: fatNum || o.number,
        pedido: o.number || "",
        obra: o.project?.code || "",
        desc: `Retenção na fonte${pctRf ? ` ${String(pctRf).replace(".", ",")}%` : ""} (entregue ao Estado)`,
        venc: "",
        deb: rf,
        cred: 0,
      });
    }
    // Pagamentos registados nas prestações do pedido
    (o.installments || [])
      .filter((i) => i.status === "PAGO" && num(i.amount) > 0)
      .forEach((i) => {
        movs.push({
          id: `pg:${i.id}`,
          orderId: o.id,
          instId: i.id,
          data: i.paidAt ? new Date(i.paidAt).toISOString().slice(0, 10) : dStr,
          tp: "PG",
          doc: i.notes ? String(i.notes).slice(0, 28) : "Pagamento",
          pedido: o.number || "",
          obra: o.project?.code || "",
          desc: `→ Liquida ${fatNum || o.number}${i.notes ? ` · ${i.notes}` : ""}`,
          venc: "",
          deb: round2(i.amount),
          cred: 0,
        });
      });
  });

  // Contas em aberto que não vêm de PurchaseOrder (ex.: pedidos extra / lançamentos diretos)
  abertos.forEach((a) => {
    if (a.sourceId && coveredOrderIds.has(a.sourceId)) return;
    movs.push({
      id: `ab:${a.id}`,
      data: a.data ? new Date(a.data).toISOString().slice(0, 10) : "",
      tp: "PD",
      doc: a.documento || a.origem,
      pedido: "",
      obra: a.obra || "",
      desc: a.descricao || "",
      venc: a.vencimento ? new Date(a.vencimento).toISOString().slice(0, 10) : "",
      deb: 0,
      cred: a.valor,
    });
  });

  const tpOrder = { SI: 0, FT: 1, PD: 1, ND: 2, RF: 3, NC: 4, PG: 5 };
  movs.sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")) || (tpOrder[a.tp] ?? 9) - (tpOrder[b.tp] ?? 9));
  let running = 0;
  const extrato = movs.map((m) => {
    running = round2(running + m.cred - m.deb);
    return { ...m, saldo: running };
  });

  return { fornecedor: f, abertos, pagos, extrato, notas: fornNotes, moeda };
}

// ─── S3 Stock por Armazém ──────────────────────────────────────────────────

const WAREHOUSE_GROUP = { CENTRAL: "Armazéns Centrais", SITE: "Armazéns das Obras", CLIENT: "Armazéns de Clientes" };

/**
 * Stock com quantidade positiva, ao custo médio do armazém. O material em
 * stock não é custo: o custo da obra nasce na saída, a este custo médio.
 */
function buildStockByWarehouse(rows = []) {
  const items = rows
    .filter((r) => num(r.quantity) > 0.0001)
    .map((r) => {
      const q = num(r.quantity);
      const pm = num(r.avgCost);
      return {
        id: r.id,
        armazemId: r.warehouseId,
        armazem: r.warehouse?.name || "—",
        armazemTipo: r.warehouse?.type || null,
        obra: r.warehouse?.project?.code || null,
        produtoId: r.productId,
        codigo: r.product?.sku || null,
        produto: r.product?.name || "—",
        categoria: r.product?.category || null,
        un: r.product?.unit ? String(r.product.unit).toLowerCase() : "un",
        minimo: num(r.product?.minStock),
        terceiro: Boolean(r.ownerId),
        quantidade: q,
        custoMedio: r.avgCost != null ? round2(pm) : null,
        valor: round2(q * pm),
      };
    })
    .sort((a, b) => a.armazem.localeCompare(b.armazem, "pt") || a.produto.localeCompare(b.produto, "pt"));

  const grupos = {};
  items.forEach((i) => {
    const k = i.armazemTipo || "CENTRAL";
    const g = grupos[k] || (grupos[k] = { tipo: k, nome: WAREHOUSE_GROUP[k] || k, valor: 0, linhas: 0 });
    g.valor = round2(g.valor + i.valor);
    g.linhas += 1;
  });
  return {
    items,
    grupos: Object.values(grupos),
    total: round2(items.reduce((s, i) => s + i.valor, 0)),
    semCusto: items.filter((i) => i.custoMedio === null).length,
  };
}

// ─── C2 Mapas Comparativos ─────────────────────────────────────────────────

/**
 * Uma linha por necessidade com cotações: as propostas de cada fornecedor lado
 * a lado, a mais barata e a escolhida. Compara pelo total da proposta (com IVA
 * e descontos quando a cotação os traz; senão preço × quantidade).
 */
function buildComparisons(needs = []) {
  const mapas = needs
    .filter((n) => (n.quotes || []).length)
    .map((n) => {
      const qtd = num(n.quantity);
      const propostas = n.quotes.map((q) => {
        const q0 = num(q.quantity) || qtd;
        const total = num(q.netTotal) || num(q.totalValue) || num(q.quotedPrice) * q0;
        return {
          id: q.id,
          fornecedor: q.supplier?.name || "—",
          fornecedorId: q.supplierId || null,
          preco: round2(q.quotedPrice),
          quantidade: q0,
          total: round2(total),
          moeda: q.currency || "AOA",
          credito: q.creditTermDays ?? null,
          entrega: q.expectedReceiptDate || null,
          escolhida: Boolean(q.selected),
          proforma: q.proformaUrl || null,
        };
      });
      const validas = propostas.filter((p) => p.total > 0);
      const min = validas.length ? Math.min(...validas.map((p) => p.total)) : null;
      propostas.forEach((p) => {
        p.maisBarata = min !== null && p.total === min;
      });
      propostas.sort((a, b) => (a.total || Infinity) - (b.total || Infinity));
      const esc = propostas.find((p) => p.escolhida) || null;
      const estado = esc ? "Adjudicado" : propostas.length > 1 ? "Para decidir" : "Só uma proposta";
      return {
        id: n.id,
        descricao: n.description,
        quantidade: qtd,
        un: n.unit || "",
        obra: n.project?.code || null,
        obraNome: n.project?.name || null,
        centro: n.costCenter?.name || null,
        data: n.date || n.createdAt || null,
        estado,
        estadoNecessidade: n.status,
        propostas,
        poupanca: esc && min !== null ? round2(esc.total - min) : null,
      };
    })
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
  const c = (e) => mapas.filter((m) => m.estado === e).length;
  return {
    mapas,
    totais: { mapas: mapas.length, decidir: c("Para decidir"), adjudicados: c("Adjudicado"), unica: c("Só uma proposta") },
  };
}

module.exports = {
  PRICE_VALID_DAYS,
  buildPriceBase,
  buildComparisons,
  buildCommitments,
  buildSupplierAccounts,
  supplierStatement,
  buildStockByWarehouse,
  norm,
};
