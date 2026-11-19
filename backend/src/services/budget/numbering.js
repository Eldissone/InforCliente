/**
 * Numeração sequencial por ano dos documentos do Comercial.
 *
 *   ORC-2026-0001   orçamento
 *   CC-2026-0001    centro de custo reservado (derivado do número do orçamento)
 *   PROP-2026-0001  proposta
 *   OB-2026-0001    obra criada na adjudicação (Fase 3)
 *
 * O incremento é feito numa só instrução `INSERT … ON CONFLICT DO UPDATE … RETURNING`,
 * que o Postgres resolve de forma atómica: dois orçamentistas a criar ao mesmo tempo
 * nunca recebem o mesmo número.
 */

const { prisma } = require("../../db");

const KINDS = ["ORC", "PROP", "OB"];
const PAD = 4;

function currentYear(today = new Date()) {
  return today.getUTCFullYear();
}

function format(kind, year, n) {
  return `${kind}-${year}-${String(n).padStart(PAD, "0")}`;
}

/**
 * Reserva o próximo número de `kind` para o ano indicado.
 * @returns {Promise<{number:string, kind:string, year:number, seq:number}>}
 */
async function allocate(kind, { year, client } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`NUMERACAO_TIPO_DESCONHECIDO: ${kind}`);
  const y = Number(year) || currentYear();
  const db = client || prisma;

  const rows = await db.$queryRaw`
    INSERT INTO "DocumentCounter" ("kind", "year", "last", "updatedAt")
    VALUES (${kind}, ${y}, 1, NOW())
    ON CONFLICT ("kind", "year")
    DO UPDATE SET "last" = "DocumentCounter"."last" + 1, "updatedAt" = NOW()
    RETURNING "last"
  `;
  const seq = Number(rows[0].last);
  return { number: format(kind, y, seq), kind, year: y, seq };
}

/**
 * Qual seria o próximo número, sem o reservar. Para mostrar no assistente de
 * criação («números automáticos, atribuídos ao criar»).
 */
async function peek(kind, { year } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`NUMERACAO_TIPO_DESCONHECIDO: ${kind}`);
  const y = Number(year) || currentYear();
  const row = await prisma.documentCounter.findUnique({ where: { kind_year: { kind, year: y } } });
  const seq = (row ? row.last : 0) + 1;
  return { number: format(kind, y, seq), kind, year: y, seq };
}

/** O centro de custo acompanha o número do orçamento: ORC-2026-0007 → CC-2026-0007. */
function costCenterCodeFor(budgetNumber) {
  const m = /^ORC-(\d{4})-(\d+)$/.exec(String(budgetNumber || ""));
  if (!m) return null;
  return `CC-${m[1]}-${m[2]}`;
}

/** Revisão seguinte: R0 → R1 → R2… O número do orçamento não muda. */
function nextRevision(revision) {
  const m = /^R(\d+)$/.exec(String(revision || "R0"));
  return `R${m ? Number(m[1]) + 1 : 1}`;
}

module.exports = {
  KINDS,
  allocate,
  peek,
  format,
  costCenterCodeFor,
  nextRevision,
  currentYear,
};
