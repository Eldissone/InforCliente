/**
 * Tesouraria — T5 Contas Bancárias / Cartões, T6 Alocação de Cartões e T7 Fundo de Maneio, como no protótipo.
 *
 * T5: contas bancárias e cartões (Conta Principal = DEBITO, Fundo de Maneio = PREPAGO,
 * Cartão de Crédito = CREDITO), com bancos de Angola, IBAN, n.º de conta, validade,
 * saldo inicial, data do saldo inicial e dados de cartão de crédito.
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

/** Bancos de Angola registados no protótipo (sigla + nome completo). */
const BANCOS_REG = [
  { s: "BCGA", n: "Banco Caixa Geral Angola" },
  { s: "BFA", n: "Banco de Fomento Angola" },
  { s: "BPC", n: "Banco de Poupança e Crédito" },
  { s: "BAI", n: "Banco Angolano de Investimentos" },
  { s: "BIC", n: "Banco BIC" },
  { s: "BMA", n: "Banco Millennium Atlântico" },
  { s: "SOL", n: "Banco Sol" },
  { s: "KEVE", n: "Banco Keve" },
  { s: "BNI", n: "Banco de Negócios Internacional" },
  { s: "SBA", n: "Standard Bank Angola" },
  { s: "BE", n: "Banco Económico" },
  { s: "YETU", n: "Banco Yetu" },
  { s: "ACCESS", n: "Access Bank Angola" },
  { s: "BCA", n: "Banco Comercial Angolano" },
  { s: "BCI", n: "Banco de Comércio e Indústria" },
  { s: "VTB", n: "VTB África" },
  { s: "BVB", n: "Banco Valor" },
  { s: "BCS", n: "Banco de Crédito do Sul" },
];

const IBAN_BANK_MAP = {
  "0004": "BCGA",
  "0006": "BFA",
  "0010": "BPC",
  "0040": "BAI",
  "0051": "BIC",
  "0055": "BMA",
  "0044": "SOL",
  "0047": "KEVE",
  "0052": "BNI",
  "0060": "SBA",
  "0045": "BE",
};

function bancoSig(v) {
  if (!v) return "";
  const s = String(v).trim();
  const u = s.toUpperCase();
  const bySig = BANCOS_REG.find((b) => b.s === u);
  if (bySig) return bySig.s;
  const byName = BANCOS_REG.find((b) => b.n.toLowerCase() === s.toLowerCase());
  if (byName) return byName.s;
  const dash = s.split(/\s*[—\-]\s*/)[0].trim().toUpperCase();
  const byPrefix = BANCOS_REG.find((b) => b.s === dash);
  if (byPrefix) return byPrefix.s;
  return s;
}

function bancoNome(sig) {
  const s = bancoSig(sig);
  const b = BANCOS_REG.find((x) => x.s === s);
  return b ? b.n : sig || "";
}

function bancoLbl(v) {
  if (!v) return "";
  const s = bancoSig(v);
  const b = BANCOS_REG.find((x) => x.s === s);
  return b ? `${b.s} — ${b.n}` : String(v).trim();
}

function detectBankFromIban(iban) {
  const clean = String(iban || "").replace(/\s+/g, "").toUpperCase();
  const m = clean.match(/^AO\d{2}(\d{4})/);
  return m && IBAN_BANK_MAP[m[1]] ? IBAN_BANK_MAP[m[1]] : null;
}

function dayKey(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function monthKey(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}/.test(value)) return value.slice(0, 7);
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 7);
}

/**
 * Lê metadados adicionais da conta/cartão guardados em `fund.notes` (JSON com `__meta: 1`)
 * com fallback para os campos nativos do cartão (`issuedAt`, `cardNumberMasked`, `expiresAt`).
 */
function parseCardMeta(card = {}, fund = {}) {
  const rawNotes = fund?.notes || card?.fund?.notes || null;
  let parsed = null;
  if (typeof rawNotes === "string" && rawNotes.trim().startsWith("{")) {
    try {
      const obj = JSON.parse(rawNotes);
      if (obj && typeof obj === "object" && (obj.__meta === 1 || "accountNumber" in obj || "iban" in obj || "initialBalanceDate" in obj || "paymentCardId" in obj)) {
        parsed = obj;
      }
    } catch {
      parsed = null;
    }
  }
  const masked = String(card?.cardNumberMasked || "").trim();
  const cleanMasked = masked.replace(/\s+/g, "");
  const fallbackIban = /^AO\d{2}/i.test(cleanMasked) ? cleanMasked.toUpperCase() : "";
  const fallbackNumero = !fallbackIban && cleanMasked && !cleanMasked.includes("•") && !cleanMasked.includes("*") ? cleanMasked : "";

  const accountNumber = String(parsed?.accountNumber ?? fallbackNumero ?? "").replace(/\s+/g, "");
  const iban = String(parsed?.iban ?? fallbackIban ?? "").replace(/\s+/g, "").toUpperCase();
  const initialBalanceDate = parsed?.initialBalanceDate
    ? String(parsed.initialBalanceDate).slice(0, 10)
    : dayKey(card?.issuedAt) || "";
  const paymentCardId = parsed?.paymentCardId ? String(parsed.paymentCardId) : "";
  const closingDay = parsed?.closingDay ? Number(parsed.closingDay) || null : null;
  const paymentDay = parsed?.paymentDay ? Number(parsed.paymentDay) || null : null;
  const notes = parsed ? String(parsed.notes || "") : typeof rawNotes === "string" ? rawNotes : "";
  const validade = parsed?.validade || monthKey(card?.expiresAt) || "";

  return {
    accountNumber,
    iban,
    initialBalanceDate,
    paymentCardId,
    closingDay,
    paymentDay,
    notes,
    validade,
  };
}

/** Serializa os metadados adicionais da conta/cartão para guardar em `fund.notes`. */
function serializeCardMeta(meta = {}) {
  const clean = {
    __meta: 1,
    accountNumber: String(meta.accountNumber || "").replace(/\s+/g, ""),
    iban: String(meta.iban || "").replace(/\s+/g, "").toUpperCase(),
    initialBalanceDate: meta.initialBalanceDate ? String(meta.initialBalanceDate).slice(0, 10) : "",
    paymentCardId: meta.paymentCardId ? String(meta.paymentCardId) : "",
    closingDay: meta.closingDay ? Number(meta.closingDay) || null : null,
    paymentDay: meta.paymentDay ? Number(meta.paymentDay) || null : null,
    validade: meta.validade ? String(meta.validade).slice(0, 7) : "",
    notes: meta.notes ? String(meta.notes) : "",
  };
  return JSON.stringify(clean);
}

/** Saldo que conta como dinheiro disponível (cartão de crédito negativo é dívida, não caixa). */
function saldoCaixa(type, balance) {
  const b = N(balance);
  return type === "CREDITO" ? Math.max(0, b) : b;
}

/** A alocação em uso de um cartão (a aberta mais recente). */
function alocacaoAtual(alocacoes, cardId) {
  return (
    (alocacoes || [])
      .filter((a) => a.cardId === cardId && !a.endDate)
      .sort((a, b) => String(dayKey(b.startDate)).localeCompare(String(dayKey(a.startDate))))[0] || null
  );
}

/**
 * Última devolução estragada de um cartão, se não houver nenhuma alocação mais recente
 * (tal como `estragadoDe(cid)` no protótipo).
 */
function estragadoDe(alocacoes, cardId) {
  const todas = (alocacoes || []).filter((a) => a.cardId === cardId);
  const estragadas = todas
    .filter((a) => a.endDate && a.returnState === "ESTRAGADO")
    .sort((a, b) => String(dayKey(b.endDate)).localeCompare(String(dayKey(a.endDate))));
  const u = estragadas[0];
  if (!u) return null;
  const endKey = dayKey(u.endDate) || "";
  const maisRecente = todas.some((a) => a.id !== u.id && String(dayKey(a.startDate) || "") >= endKey);
  if (maisRecente) return null;
  return {
    id: u.id,
    by: u.responsible || null,
    date: endKey,
    notes: u.returnNotes || u.notes || null,
  };
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

module.exports = {
  BANCOS_REG,
  IBAN_BANK_MAP,
  bancoSig,
  bancoNome,
  bancoLbl,
  detectBankFromIban,
  parseCardMeta,
  serializeCardMeta,
  saldoCaixa,
  alocacaoAtual,
  estragadoDe,
  podeAlocar,
  fundoManeio,
};
