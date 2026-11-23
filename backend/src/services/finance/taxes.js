/**
 * F-4 Impostos — G1 Impostos, G2 Planos de Pagamento (PPP), G3 IVA e
 * Retenções e G4 Mapa Fiscal, como no protótipo.
 *
 * Uma obrigação fiscal (`TaxObligation`) é um imposto de um mês, com a data
 * limite, o valor, a nota de liquidação e o RUPE. Paga-se por um pedido de
 * pagamento do tipo IMPOSTOS (o Centro de Pagamentos), ligado pelo
 * `typeData.obrigacaoId`, ou regista-se como paga à mão. Os pedidos de
 * impostos feitos sem obrigação (por exemplo, IRT e INSS pedidos pelo RH)
 * também aparecem, para nada ficar de fora.
 *
 * Um plano PPP (`TaxPaymentPlan`) é um acordo para pagar em prestações; cada
 * prestação é uma obrigação do tipo «PPP».
 *
 * Tudo em kwanzas: os impostos ao Estado angolano pagam-se em AOA.
 */

const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;

function dayKey(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function addMonthsK(mes, n) {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Impostos que o Financeiro regista (os do RH — IRT e INSS — vêm dos pedidos do RH). */
const TIPOS_FIN = ["IVA", "RF", "IRT-B", "Imposto Industrial", "Imposto de Selo", "Imposto Predial", "Outros"];
const TIPOS_RH = ["IRT", "INSS"];
const GRUPOS = ["IVA", "IRT", "INSS", "IRT-B", "RF", "PPP", "Outros"];
/** Dia do mês seguinte em que o imposto vence (sem dia, o último do mês). */
const DIA_LIMITE = { IVA: 15, INSS: 10 };

/** A data limite habitual: no mês seguinte ao de referência. */
function limiteAuto(tipo, mesRef) {
  if (!/^\d{4}-\d{2}$/.test(String(mesRef || ""))) return null;
  const m = addMonthsK(mesRef, 1);
  const [y, mo] = m.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${m}-${String(Math.min(DIA_LIMITE[tipo] || ultimo, ultimo)).padStart(2, "0")}`;
}

function grupoDe(tipo, ppp) {
  if (ppp) return "PPP";
  return ["IVA", "IRT", "IRT-B", "INSS", "RF"].includes(tipo) ? tipo : "Outros";
}

/**
 * Estado de uma obrigação: pago (à mão, ou o pedido ligado está pago),
 * em pagamento (o pedido foi aprovado e está a ser pago), atrasado (passou o
 * limite), por pagar.
 *
 * @param {object} o `{ paidAt, dueDate }`
 * @param {object|null} pedido `{ estado }` — o código de `derivedStatus` do pedido
 */
function estadoDe(o, pedido, hoje) {
  if (o.paidAt) return "Pago";
  if (pedido) {
    if (pedido.estado === "PAGO") return "Pago";
    if (pedido.estado === "PAGO_PARCIAL") return "Pago parcial";
    if (["EM_PAGAMENTO", "APROVADO", "EM_ABERTO"].includes(pedido.estado) && !(dayKey(o.dueDate) && dayKey(o.dueDate) < hoje))
      return "Em pagamento";
  }
  const lim = dayKey(o.dueDate);
  return lim && lim < hoje ? "Atrasado" : "Por pagar";
}

/**
 * As linhas do G1: as obrigações, mais os pedidos de impostos que não estão
 * ligados a nenhuma.
 *
 * @param {object} o
 * @param {Array} o.obrigacoes `TaxObligation` com `plan: { id, name }`
 * @param {Array} o.pedidos pedidos IMPOSTOS `{ id, number, estado, typeData, createdAt, total }`
 * @param {string} o.hoje
 */
function linhasImpostos({ obrigacoes, pedidos, hoje }) {
  const porObrigacao = new Map();
  for (const p of pedidos || []) {
    const id = p.typeData?.obrigacaoId;
    if (id) porObrigacao.set(id, p);
  }
  const linhas = (obrigacoes || []).map((o) => {
    const ped = porObrigacao.get(o.id) || null;
    const ppp = Boolean(o.planId);
    return {
      id: o.id,
      origem: "obrigacao",
      tipo: o.type,
      grupo: grupoDe(o.type, ppp),
      plano: ppp ? { id: o.planId, nome: o.plan?.name || "PPP", prestacao: o.installment, prestacoes: o.plan?.n || null } : null,
      mes: o.referenceMonth,
      limite: dayKey(o.dueDate),
      valor: round2(o.amount),
      nl: o.liquidationNote || null,
      rupe: o.rupe || null,
      nota: o.docPath ? { path: o.docPath, nome: o.docName || "nota" } : null,
      pagoEm: dayKey(o.paidAt),
      pagoNota: o.paidNote || null,
      notas: o.notes || null,
      pedido: ped ? { id: ped.id, numero: ped.number, estado: ped.estado } : null,
      estado: estadoDe(o, ped, hoje),
    };
  });
  // Pedidos de impostos sem obrigação (RH, ou feitos direto no Centro de Pagamentos).
  for (const p of pedidos || []) {
    if (p.typeData?.obrigacaoId) continue;
    const td = p.typeData || {};
    const limite = dayKey(td.limite) || null;
    linhas.push({
      id: `pedido:${p.id}`,
      origem: "pedido",
      tipo: td.tipo || "Outros",
      grupo: grupoDe(td.tipo, false),
      plano: null,
      mes: /^\d{4}-\d{2}$/.test(String(td.mes || "")) ? td.mes : String(dayKey(p.createdAt) || "").slice(0, 7),
      limite,
      valor: round2(td.valor ?? p.total),
      nl: null,
      rupe: td.rupe || null,
      nota: null,
      pagoEm: null,
      pagoNota: null,
      notas: null,
      pedido: { id: p.id, numero: p.number, estado: p.estado },
      estado: estadoDe({ dueDate: limite }, { estado: p.estado }, hoje),
    });
  }
  linhas.sort((a, b) => (a.limite || "9").localeCompare(b.limite || "9") || a.grupo.localeCompare(b.grupo));
  return linhas;
}

const pago = (l) => l.estado === "Pago";
const aberto = (l) => !pago(l);

/** Os totais do G1 e as contagens por grupo (para os botões). */
function resumoImpostos(linhas) {
  const soma = (L) => round2(L.reduce((s, l) => s + l.valor, 0));
  return {
    total: soma(linhas),
    pago: soma(linhas.filter(pago)),
    porPagar: soma(linhas.filter(aberto)),
    atrasados: linhas.filter((l) => l.estado === "Atrasado").length,
    grupos: Object.fromEntries(GRUPOS.map((g) => [g, linhas.filter((l) => l.grupo === g).length])),
  };
}

/**
 * As prestações de um plano: `n` prestações de `valor`, a primeira na data
 * `d1` e as seguintes no mesmo dia dos meses seguintes. O total é a soma.
 */
function gerarPrestacoes({ n, valor, d1 }) {
  const k = Math.max(0, Math.min(240, Math.round(N(n))));
  if (!k || !(N(valor) > 0) || !dayKey(d1)) return [];
  const [y, m, d] = dayKey(d1).split("-").map(Number);
  return Array.from({ length: k }, (_, i) => {
    const ult = new Date(Date.UTC(y, m - 1 + i + 1, 0)).getUTCDate();
    const data = new Date(Date.UTC(y, m - 1 + i, Math.min(d, ult))).toISOString().slice(0, 10);
    return { prestacao: i + 1, limite: data, mes: data.slice(0, 7), valor: round2(valor) };
  });
}

/** O resumo de um plano, a partir das linhas (G1) das suas prestações. */
function resumoPlano(plano, linhasDoPlano, hoje) {
  const L = linhasDoPlano.slice().sort((a, b) => (a.plano?.prestacao || 0) - (b.plano?.prestacao || 0));
  const total = round2(L.reduce((s, l) => s + l.valor, 0));
  const vp = round2(L.filter(pago).reduce((s, l) => s + l.valor, 0));
  const atr = L.filter((l) => l.estado === "Atrasado");
  const prox = L.find((l) => aberto(l)) || null;
  const falta = round2(total - vp);
  return {
    id: plano.id,
    nome: plano.name,
    entidade: plano.entity || "AGT",
    processo: plano.reference || null,
    imposto: plano.taxType || null,
    acordo: dayKey(plano.startDate),
    notas: plano.notes || null,
    total,
    pago: vp,
    falta,
    n: L.length,
    np: L.filter(pago).length,
    atrasadas: atr.length,
    proxima: prox ? { limite: prox.limite, valor: prox.valor, prestacao: prox.plano?.prestacao } : null,
    estado: falta <= 0.5 ? "Liquidado" : atr.length ? "Atrasado" : "Em curso",
    prestacoes: L,
  };
}

/**
 * G3 IVA e Retenções — os 12 meses até ao mês corrente:
 *  - IVA liquidado e retenções sofridas: das faturas emitidas (pela data);
 *  - IVA suportado e retenções feitas (a entregar): dos pedidos de pagamento
 *    aprovados (pela data do pedido), linha a linha.
 * Só kwanzas: é o que se declara.
 *
 * @param {object} o
 * @param {Array} o.faturas `{ docDate, vatAmount, withholdingAmount, moeda }`
 * @param {Array} o.pedidos `{ id, number, createdAt, fornecedor, nif, moeda, base, vat, withheld }`
 */
function ivaRetencoes({ faturas, pedidos, hoje, mes = null }) {
  const fim = hoje.slice(0, 7);
  const ks = Array.from({ length: 12 }, (_, i) => addMonthsK(fim, i - 11));
  const M = Object.fromEntries(ks.map((k) => [k, { liq: 0, ded: 0, rfE: 0, rfS: 0 }]));
  for (const f of faturas || []) {
    if (String(f.moeda || "AOA").toUpperCase() !== "AOA") continue;
    const m = M[String(dayKey(f.docDate) || "").slice(0, 7)];
    if (!m) continue;
    m.liq += N(f.vatAmount);
    m.rfS += N(f.withholdingAmount);
  }
  for (const p of pedidos || []) {
    if (String(p.moeda || "AOA").toUpperCase() !== "AOA") continue;
    const m = M[String(dayKey(p.createdAt) || "").slice(0, 7)];
    if (!m) continue;
    m.ded += N(p.vat);
    m.rfE += N(p.withheld);
  }
  const sel = mes && M[mes] ? mes : ks[ks.length - 2];
  return {
    meses: ks.map((k) => ({
      k,
      liq: round2(M[k].liq),
      ded: round2(M[k].ded),
      aEntregar: round2(M[k].liq - M[k].ded),
      rfE: round2(M[k].rfE),
      rfS: round2(M[k].rfS),
    })),
    sel,
    retencoes: (pedidos || [])
      .filter((p) => String(p.moeda || "AOA").toUpperCase() === "AOA" && N(p.withheld) > 0 && String(dayKey(p.createdAt) || "").startsWith(sel))
      .map((p) => ({ id: p.id, numero: p.number, fornecedor: p.fornecedor || "—", nif: p.nif || null, base: round2(p.base), retencao: round2(p.withheld) })),
  };
}

/**
 * G4 Mapa Fiscal: a situação de cada imposto (e de cada plano) mês a mês num
 * ano, mais os números de cima (dívida, atrasado, compromisso do mês e do
 * seguinte, planos).
 *
 * Célula: pg (pago), pp (em pagamento), at (atrasado), fu (por pagar),
 * sr (sem registo: um imposto mensal que já devia estar lançado e não está).
 */
function mapaFiscal({ linhas, planos, ano, hoje }) {
  const mesHoje = hoje.slice(0, 7);
  const prox = addMonthsK(mesHoje, 1);
  const est = (l) => (l.estado === "Pago" ? "pg" : l.estado === "Atrasado" ? "at" : l.estado === "Em pagamento" || l.estado === "Pago parcial" ? "pp" : "fu");
  const ORD = { at: 4, fu: 3, pp: 2, pg: 1 };
  const soma = (L) => round2(L.reduce((s, l) => s + l.valor, 0));
  const ab = linhas.filter(aberto);
  const atr = ab.filter((l) => l.estado === "Atrasado");
  const doMes = (m) => ab.filter((l) => String(l.limite || "").slice(0, 7) === m);
  const ppp = (l) => Boolean(l.plano);

  const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);
  const mesDe = (l) => (l.plano ? String(l.limite || "").slice(0, 7) : l.mes || String(l.limite || "").slice(0, 7));
  const linha = (nome, tipo, L, mensal) => {
    const primeiro = L.map(mesDe).filter(Boolean).sort()[0] || null;
    const celulas = meses.map((m) => {
      const X = L.filter((l) => mesDe(l) === m);
      if (!X.length) {
        // Imposto mensal (IVA, IRT, INSS) que já venceu sem registo nenhum.
        const lim = limiteAuto(tipo, m);
        const falhou = mensal && primeiro && m >= primeiro && lim && lim < hoje;
        return { m, s: falhou ? "sr" : "", v: 0, n: 0 };
      }
      const s = X.map(est).sort((a, b) => ORD[b] - ORD[a])[0];
      return { m, s, v: soma(X), n: X.length };
    });
    const doAno = L.filter((l) => String(mesDe(l)).startsWith(String(ano)));
    return {
      nome,
      tipo,
      celulas,
      pago: soma(doAno.filter(pago)),
      atrasado: soma(doAno.filter((l) => l.estado === "Atrasado")),
      futuro: soma(doAno.filter((l) => aberto(l) && l.estado !== "Atrasado")),
    };
  };
  const porTipo = new Map();
  for (const l of linhas.filter((x) => !ppp(x))) {
    if (!porTipo.has(l.tipo)) porTipo.set(l.tipo, []);
    porTipo.get(l.tipo).push(l);
  }
  const rows = [...porTipo.entries()].map(([t, L]) => linha(t, t, L, ["IVA", "IRT", "INSS"].includes(t)));
  for (const p of planos || []) {
    const L = linhas.filter((l) => l.plano?.id === p.id);
    if (L.length) rows.push(linha(p.name || p.nome, "PPP", L, false));
  }
  rows.sort((a, b) => (b.atrasado > 0) - (a.atrasado > 0) || (a.tipo === "PPP") - (b.tipo === "PPP") || a.nome.localeCompare(b.nome));
  return {
    ano,
    meses,
    macro: {
      divida: soma(ab),
      dividaPPP: soma(ab.filter(ppp)),
      dividaImpostos: soma(ab.filter((l) => !ppp(l))),
      atrasado: soma(atr),
      nAtrasado: atr.length,
      compromissoMes: soma(doMes(mesHoje)),
      compromissoProx: soma(doMes(prox)),
      mesHoje,
      prox,
    },
    linhas: rows,
  };
}

module.exports = {
  TIPOS_FIN,
  TIPOS_RH,
  GRUPOS,
  limiteAuto,
  grupoDe,
  estadoDe,
  linhasImpostos,
  resumoImpostos,
  gerarPrestacoes,
  resumoPlano,
  ivaRetencoes,
  mapaFiscal,
};
