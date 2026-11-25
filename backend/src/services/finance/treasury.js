/**
 * T1 Contas e Saldos — quanto dinheiro há, em que banco, e o que entrou e saiu.
 *
 * Segue o `V.ftes` do protótipo: o saldo disponível numa moeda, os saldos
 * agrupados por banco com as entradas e saídas do mês escolhido, o fluxo dos
 * últimos doze meses, as saídas do mês por tipo e quantos movimentos estão por
 * conciliar.
 *
 * As transferências internas não são entradas nem saídas da empresa — é
 * dinheiro a mudar de conta — e ficam fora das somas, como no protótipo.
 *
 * O saldo de cada conta vem de `loadBankBalances` (último saldo registado mais
 * os movimentos seguintes; sem saldo registado, o do cartão, marcado como
 * estimado). Aqui não se recalcula: agrupa-se.
 */

const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;

const TIPOS = {
  TRANSFERENCIA_INTERNA: "Transferência interna",
  PF: "Pagamento a fornecedor",
  REEMBOLSO: "Reembolso",
  OPERACAO_ANULADA: "Operação anulada",
  RECEBIMENTO_CLIENTE: "Recebimento de cliente",
  LEVANTAMENTO_ATM: "Levantamento ATM",
  OUTRO: "Outro",
};

function monthKey(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
}

/** Os doze meses que acabam em `mes` (AAAA-MM), do mais antigo para o mais recente. */
function lastMonths(mes, n = 12) {
  const [y, m] = mes.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

const interna = (m) => m.movementType === "TRANSFERENCIA_INTERNA";

function dayKey(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dataPt = (k) => k.split("-").reverse().join("/");

/**
 * O intervalo de um período, como o `tesRange` do protótipo:
 * `dia` (d), `mes` (mes), `ano` (ano), `12m` ou `int` (d1, d2).
 */
function tesRange({ p = "mes", d, mes, ano, d1, d2, hoje }) {
  if (p === "dia") {
    const x = d || hoje;
    return { p, de: x, ate: x, rotulo: dataPt(x) };
  }
  if (p === "ano") {
    const y = ano || hoje.slice(0, 4);
    return { p, de: `${y}-01-01`, ate: `${y}-12-31`, rotulo: `Ano ${y}` };
  }
  if (p === "12m") {
    const [y, m] = hoje.split("-").map(Number);
    const de = new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10);
    return { p, de, ate: hoje, rotulo: "Últimos 12 meses" };
  }
  if (p === "int") {
    const de = d1 || `${hoje.slice(0, 8)}01`;
    const ate = d2 || hoje;
    return { p, de, ate, rotulo: `${dataPt(de)} – ${dataPt(ate)}` };
  }
  const k = mes || hoje.slice(0, 7);
  const fim = new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return { p: "mes", de: `${k}-01`, ate: fim, rotulo: `${MESES_PT[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` };
}

/** Saída sem custo associado: é o que falta conciliar. */
const porConciliar = (m) => m.direction === "SAIDA" && !interna(m) && !m.costAssigned;

/**
 * @param {object} o
 * @param {Array} o.contas itens de `loadBankBalances` (`card`, `balance`,
 *   `currency`, `source`, `asOf`)
 * @param {Array} o.movimentos movimentos bancários `{ cardId, direction,
 *   amount, movementDate, movementType, costAssigned }`
 * @param {string} [o.mes] AAAA-MM (sem `periodo`, é o mês inteiro)
 * @param {object} [o.periodo] `{ de, ate, rotulo }` (`tesRange`)
 * @param {string} [o.moeda] só as contas nesta moeda (AOA por omissão) —
 *   saldos de moedas diferentes não se somam
 */
function treasurySummary({ contas, movimentos, mes, periodo, moeda = "AOA" }) {
  const P = periodo || tesRange({ p: "mes", mes, hoje: `${mes}-01` });
  mes = mes || P.ate.slice(0, 7);
  const noPeriodo = (m) => {
    const d = dayKey(m.movementDate);
    return d && d >= P.de && d <= P.ate;
  };
  const M0 = String(moeda || "AOA").toUpperCase();
  const moedaDe = (c) => String(c.currency || "AOA").toUpperCase();
  const aoa = (contas || []).filter((c) => moedaDe(c) === M0);
  const ids = new Set(aoa.map((c) => c.card.id));
  const M = (movimentos || []).filter((m) => ids.has(m.cardId));

  const doMes = (lista, k) =>
    lista.reduce(
      (o, m) => {
        if (interna(m) || monthKey(m.movementDate) !== k) return o;
        if (m.direction === "ENTRADA") o.en += N(m.amount);
        else o.sa += N(m.amount);
        return o;
      },
      { en: 0, sa: 0 }
    );

  const doPeriodo = (lista) =>
    lista.reduce(
      (o, m) => {
        if (interna(m) || !noPeriodo(m)) return o;
        if (m.direction === "ENTRADA") o.en += N(m.amount);
        else o.sa += N(m.amount);
        return o;
      },
      { en: 0, sa: 0 }
    );

  const porBanco = new Map();
  for (const c of aoa) {
    const b = c.card.bank || "Sem banco";
    if (!porBanco.has(b)) porBanco.set(b, []);
    porBanco.get(b).push(c);
  }
  const bancos = [...porBanco.entries()]
    .map(([banco, C]) => {
      const meus = new Set(C.map((c) => c.card.id));
      const mm = doPeriodo(M.filter((m) => meus.has(m.cardId)));
      // Cartão de crédito com saldo negativo é dívida, não dinheiro.
      const divida = C.filter((c) => c.card.type === "CREDITO").reduce((s, c) => s + Math.max(0, -N(c.balance)), 0);
      const saldoCaixa = (c) => (c.card.type === "CREDITO" ? Math.max(0, N(c.balance)) : N(c.balance));
      return {
        banco,
        contas: C.map((c) => ({
          id: c.card.id,
          nome: c.card.label,
          digitos: c.card.lastDigits || null,
          tipo: c.card.type,
          saldo: round2(c.balance),
          estimado: c.source === "CARTAO",
          desde: c.asOf || null,
        })),
        saldo: round2(C.reduce((s, c) => s + saldoCaixa(c), 0)),
        divida: round2(divida),
        en: round2(mm.en),
        sa: round2(mm.sa),
      };
    })
    .sort((a, b) => b.saldo - a.saldo);

  const meses = lastMonths(mes).map((k) => {
    const x = doMes(M, k);
    return { k, en: round2(x.en), sa: round2(x.sa) };
  });

  const tipos = {};
  for (const m of M) {
    if (m.direction !== "SAIDA" || interna(m) || !noPeriodo(m)) continue;
    const t = TIPOS[m.movementType] || m.movementType || "Outro";
    tipos[t] = (tipos[t] || 0) + N(m.amount);
  }

  const en = bancos.reduce((s, b) => s + b.en, 0);
  const sa = bancos.reduce((s, b) => s + b.sa, 0);
  return {
    mes,
    periodo: P,
    saldo: round2(bancos.reduce((s, b) => s + b.saldo, 0)),
    divida: round2(bancos.reduce((s, b) => s + b.divida, 0)),
    contas: aoa.length,
    estimado: aoa.some((c) => c.source === "CARTAO"),
    en: round2(en),
    sa: round2(sa),
    porConciliar: M.filter(porConciliar).length,
    bancos,
    meses,
    tipos: Object.entries(tipos)
      .map(([tipo, valor]) => ({ tipo, valor: round2(valor) }))
      .sort((a, b) => b.valor - a.valor),
    moeda: M0,
    moedas: [...new Set((contas || []).map(moedaDe))].sort(),
  };
}

module.exports = { treasurySummary, lastMonths, tesRange, TIPOS };
