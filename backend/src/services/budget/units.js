/**
 * Unidades: o que está escrito nas obras → o que o orçamento usa.
 *
 * As tabelas de quantidades das obras foram escritas à mão ao longo do tempo e
 * têm o mesmo significado escrito de várias maneiras: `un`, `unid`, `um`;
 * `m` e `mts`; `m3` e `m³`; `l` e `litros`. São 12 grafias para 8 unidades.
 * A lista de validação do orçamento (`lists.unid`) tem uma grafia só por
 * unidade, e é para lá que isto traduz.
 *
 * Regras que guiaram a tabela:
 *  - **Nada se perde.** O que não se reconhece volta tal como está, limpo de
 *    espaços, e é assinalado com `matched: false` para quem importa poder
 *    mostrar a linha a quem decide.
 *  - **Não se adivinha.** Só está aqui o que é inequívoco. `vg` (verba global)
 *    e `cj` (conjunto) ficam como estão porque são unidades de facto, não
 *    erros de escrita.
 */

/** A grafia canónica, igual à lista `unid` do orçamento. */
const CANONICAL = ["un", "m", "km", "m2", "m3", "kg", "t", "L", "cj", "vg", "h", "dia", "mês", "viagem"];

/**
 * Variante escrita → grafia canónica. A chave está em minúsculas e sem
 * acentos; a comparação faz a mesma normalização antes de procurar.
 */
const ALIASES = {
  // unidade
  un: "un",
  und: "un",
  unid: "un",
  unidade: "un",
  unidades: "un",
  um: "un",
  uni: "un",
  pc: "un",
  pcs: "un",
  // comprimento
  m: "m",
  mt: "m",
  mts: "m",
  metro: "m",
  metros: "m",
  ml: "m",
  km: "km",
  kms: "km",
  quilometro: "km",
  quilometros: "km",
  // área
  m2: "m2",
  "m²": "m2",
  mq: "m2",
  // volume
  m3: "m3",
  "m³": "m3",
  mc: "m3",
  // massa
  kg: "kg",
  kgs: "kg",
  quilo: "kg",
  quilos: "kg",
  t: "t",
  ton: "t",
  tons: "t",
  tonelada: "t",
  toneladas: "t",
  // capacidade
  l: "L",
  lt: "L",
  lts: "L",
  litro: "L",
  litros: "L",
  // conjuntos e verbas — são unidades, não erros
  cj: "cj",
  conj: "cj",
  conjunto: "cj",
  vg: "vg",
  vb: "vg",
  verba: "vg",
  // tempo
  h: "h",
  hr: "h",
  hrs: "h",
  hora: "h",
  horas: "h",
  dia: "dia",
  dias: "dia",
  mes: "mês",
  meses: "mês",
  // transporte
  viagem: "viagem",
  viagens: "viagem",
};

/** Minúsculas, sem acentos, sem espaços nem pontos finais. */
function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-̂̄-ͯ]/g, "") // tira acentos, mas deixa o ³ (que não é diacrítico) e o ²
    .trim()
    .replace(/\.+$/, "")
    .toLowerCase();
}

/**
 * @param {string} raw a unidade tal como está escrita na obra
 * @returns {{ unit: string, original: string, matched: boolean }}
 *   `unit` é a grafia a usar; `original` é o que lá estava; `matched` diz se
 *   foi reconhecida (falso = devolvida tal e qual, para alguém confirmar).
 */
function normalizeUnit(raw) {
  const original = String(raw ?? "").trim();
  if (!original) return { unit: "", original: "", matched: false };

  const key = fold(original);
  const hit = ALIASES[key];
  if (hit) return { unit: hit, original, matched: true };

  // Já está na grafia canónica, mas com outra caixa ("UN", "Km").
  const canon = CANONICAL.find((c) => fold(c) === key);
  if (canon) return { unit: canon, original, matched: true };

  return { unit: original, matched: false, original };
}

/**
 * Resume o que uma importação vai fazer às unidades, para se poder mostrar
 * antes de gravar: quantas linhas por unidade, quais mudam e quais ficam por
 * reconhecer.
 */
function summarizeUnits(rawUnits) {
  const byOriginal = new Map();
  for (const raw of rawUnits || []) {
    const r = normalizeUnit(raw);
    const k = r.original || "(vazio)";
    const entry = byOriginal.get(k) || { original: k, unit: r.unit, matched: r.matched, count: 0 };
    entry.count += 1;
    byOriginal.set(k, entry);
  }
  const rows = [...byOriginal.values()].sort((a, b) => b.count - a.count);
  return {
    rows,
    changed: rows.filter((r) => r.matched && r.unit !== r.original),
    unknown: rows.filter((r) => !r.matched),
  };
}

module.exports = { CANONICAL, ALIASES, normalizeUnit, summarizeUnits };
