/**
 * Tesouraria — T6 Alocação de Cartões e T7 Fundo de Maneio, como no protótipo.
 *
 * T6: cada cartão está entregue a alguém (e, se for o caso, a uma obra) de uma
 * data a outra. Só há uma alocação aberta por cartão; ao devolver, regista-se
 * o estado em que voltou (bom ou estragado).
 *
 * T7: por cartão, o dinheiro que lá entrou (carregamentos do fundo e entradas
 * do extrato), o que se gastou (saídas e utilizações do fundo), o que está
 * por gastar (pedidos extra aprovados a pagar por esse cartão ou fundo), o
 * saldo e a sobra livre (saldo − por gastar).
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

/** A alocação em uso de um cartão (a aberta mais recente). */
function alocacaoAtual(alocacoes, cardId) {
  return (
    (alocacoes || [])
      .filter((a) => a.cardId === cardId && !a.endDate)
      .sort((a, b) => String(dayKey(b.startDate)).localeCompare(String(dayKey(a.startDate))))[0] || null
  );
}

/** Valida uma nova alocação: o cartão não pode já estar entregue. */
function podeAlocar(alocacoes, cardId) {
  const a = alocacaoAtual(alocacoes, cardId);
  return a ? { ok: false, erro: `O cartão já está entregue a ${a.responsible} desde ${dayKey(a.startDate)}. Registe primeiro a devolução.` } : { ok: true };
}

/**
 * T7 Fundo de Maneio.
 *
 * @param {object} o
 * @param {Array} o.cartoes `{ id, label, bank, lastDigits, type, fundId, fund: { name, currency, project }, saldo }`
 * @param {Array} o.movFundo `PettyCashMovement` `{ fundId, cardId, type, amount, createdAt }`
 * @param {Array} o.movBanco `BankMovement` `{ cardId, direction, amount, movementDate, movementType }`
 * @param {Array} o.pedidos pedidos extra `{ fundId, cardId, status, amount, netAmount }`
 * @param {Array} o.alocacoes
 */
function fundoManeio({ cartoes, movFundo, movBanco, pedidos, alocacoes }) {
  return (cartoes || []).map((c) => {
    const mf = (movFundo || []).filter((m) => m.cardId === c.id);
    const mb = (movBanco || []).filter((m) => m.cardId === c.id && m.movementType !== "OPERACAO_ANULADA");
    const transferido = mf.filter((m) => m.type === "CREDITO").reduce((s, m) => s + N(m.amount), 0) + mb.filter((m) => m.direction === "ENTRADA").reduce((s, m) => s + N(m.amount), 0);
    const gasto = mf.filter((m) => m.type === "DEBITO").reduce((s, m) => s + N(m.amount), 0) + mb.filter((m) => m.direction === "SAIDA").reduce((s, m) => s + N(m.amount), 0);
    // Por gastar: pedidos aprovados ainda por pagar por este cartão (ou pelo fundo, se não disserem o cartão).
    const porGastar = (pedidos || [])
      .filter((p) => p.status === "APROVADO" && (p.cardId ? p.cardId === c.id : p.fundId && p.fundId === c.fundId))
      .reduce((s, p) => s + N(p.netAmount ?? p.amount), 0);
    const datas = [...mf.map((m) => dayKey(m.createdAt)), ...mb.map((m) => dayKey(m.movementDate))].filter(Boolean).sort();
    const al = alocacaoAtual(alocacoes, c.id);
    const saldo = round2(c.saldo);
    return {
      id: c.id,
      cartao: [c.bank, c.label, c.lastDigits ? `•${c.lastDigits}` : ""].filter(Boolean).join(" "),
      tipo: c.type,
      fundo: c.fund?.name || null,
      moeda: c.fund?.currency || "AOA",
      obra: al?.project ? [al.project.code, al.project.name].filter(Boolean).join(" · ") : c.fund?.project ? [c.fund.project.code, c.fund.project.name].filter(Boolean).join(" · ") : "Sede",
      responsavel: al?.responsible || null,
      ultimo: datas[datas.length - 1] || null,
      transferido: round2(transferido),
      gasto: round2(gasto),
      porGastar: round2(porGastar),
      saldo,
      sobra: round2(saldo - porGastar),
      movimentos: mf.length + mb.length,
    };
  });
}

module.exports = { alocacaoAtual, podeAlocar, fundoManeio };
