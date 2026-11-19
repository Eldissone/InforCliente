/**
 * Fórmulas dos baremes (custos internos padrão) — FONTE DA VERDADE.
 *
 * Espelhado em `frontend/src/shared/comercial/baremFormulas.js`, que repete apenas a
 * matemática para dar resposta instantânea enquanto se escreve. O teste
 * `test/baremCost.test.js` garante que os dois ficheiros dão o mesmo resultado.
 *
 * Convenção de `computedCost` (o custo unitário principal de cada tipo, materializado
 * na coluna `BaremItem.computedCost` para listas, folhas de custo e relatórios):
 *
 *   COMBUSTIVEL  preço por litro
 *   RH           custo real diário
 *   EQUIPAMENTO  custo por hora
 *   VIATURA      custo por dia
 *   FERRAMENTA   custo unitário do barém (por dia ou por unidade, conforme `unit`)
 *   LOGISTICA    custo unitário em vigor
 *
 * Os restantes valores derivados ficam em `detail` (ex.: custo/hora do RH,
 * depreciação/hora do equipamento, custo/km da viatura).
 */

const BAREM_KINDS = ["COMBUSTIVEL", "RH", "EQUIPAMENTO", "VIATURA", "FERRAMENTA", "LOGISTICA"];

const BAREM_KIND_LABELS = {
  COMBUSTIVEL: "Combustíveis",
  RH: "Recursos humanos",
  EQUIPAMENTO: "Equipamentos",
  VIATURA: "Viaturas",
  FERRAMENTA: "Ferramentas e consumíveis",
  LOGISTICA: "Logística e estaleiro",
};

/** Ordem das abas e a letra que o protótipo usa em cada secção. */
const BAREM_KIND_ORDER = [
  { kind: "COMBUSTIVEL", tag: "0", label: BAREM_KIND_LABELS.COMBUSTIVEL },
  { kind: "RH", tag: "A", label: BAREM_KIND_LABELS.RH },
  { kind: "EQUIPAMENTO", tag: "B", label: BAREM_KIND_LABELS.EQUIPAMENTO },
  { kind: "VIATURA", tag: "C", label: BAREM_KIND_LABELS.VIATURA },
  { kind: "FERRAMENTA", tag: "D", label: BAREM_KIND_LABELS.FERRAMENTA },
  { kind: "LOGISTICA", tag: "E", label: BAREM_KIND_LABELS.LOGISTICA },
];

const OWNERSHIP = ["Próprio", "Alugado"];
const RENT_UNITS = ["Dia", "Hora"];
const FE_COST_UNITS = ["dia", "un"];
const FE_TYPES = ["Kit equipa", "Individual", "Elétrica", "Medição", "Ensaio", "Consumível", "EPI"];

/**
 * Campos próprios de cada tipo, guardados em `BaremItem.fields` (JSONB).
 * `code`, `name`, `unit`, `ownership`, `priceDate`, `active` e `notes` são colunas.
 *
 * ty: "num" número | "pct" percentagem (guardada em fração: 0.25 = 25%)
 *     "text" texto  | "fuel" lista dos combustíveis existentes
 *     "sel"  lista fixa em `options`
 */
const BAREM_FIELDS = {
  COMBUSTIVEL: [
    { k: "preco", l: "Preço por litro", ty: "num", required: true },
    { k: "fonte", l: "Fonte / observação", ty: "text" },
  ],
  RH: [
    { k: "mensal", l: "Custo mensal", ty: "num", required: true },
    { k: "enc", l: "Encargos sociais %", ty: "pct" },
    { k: "seg", l: "Seguro/dia", ty: "num" },
    { k: "alim", l: "Alimentação/dia", ty: "num" },
    { k: "aloj", l: "Alojamento/dia", ty: "num" },
    { k: "transp", l: "Transporte/dia", ty: "num" },
    { k: "outros", l: "Outros/dia", ty: "num" },
  ],
  EQUIPAMENTO: [
    { k: "marca", l: "Marca / modelo", ty: "text" },
    { k: "aq", l: "Valor de aquisição", ty: "num", when: { ownership: "Próprio" } },
    { k: "vida", l: "Vida útil (h)", ty: "num", when: { ownership: "Próprio" } },
    { k: "aluguer", l: "Valor do aluguer", ty: "num", when: { ownership: "Alugado" } },
    { k: "alugUn", l: "Aluguer cobrado por", ty: "sel", options: RENT_UNITS, when: { ownership: "Alugado" } },
    { k: "man", l: "Manutenção/h", ty: "num" },
    { k: "lh", l: "Combustível (L/h)", ty: "num" },
    { k: "tipo", l: "Tipo de combustível", ty: "fuel" },
    { k: "esp", l: "Preço específico/L (opcional)", ty: "num" },
    { k: "lub", l: "Lubrificantes/h", ty: "num" },
    { k: "pneus", l: "Pneus e consumíveis/h", ty: "num" },
    { k: "oper", l: "Operador/h", ty: "num" },
    { k: "seguro", l: "Seguro anual", ty: "num" },
    { k: "outros", l: "Outros custos/h", ty: "num" },
  ],
  VIATURA: [
    { k: "tipo", l: "Tipo", ty: "text" },
    { k: "cons", l: "Consumo (L/100 km)", ty: "num" },
    { k: "comb", l: "Tipo de combustível", ty: "fuel" },
    { k: "esp", l: "Preço específico/L (opcional)", ty: "num" },
    { k: "man", l: "Manutenção/km", ty: "num" },
    { k: "pneus", l: "Pneus/km", ty: "num" },
    { k: "seg", l: "Seguro anual", ty: "num" },
    { k: "dep", l: "Depreciação mensal", ty: "num" },
    { k: "mot", l: "Motorista mensal", ty: "num" },
    { k: "outros", l: "Outros mensal", ty: "num" },
  ],
  FERRAMENTA: [
    { k: "tipo", l: "Tipo", ty: "sel", options: FE_TYPES },
    { k: "aq", l: "Valor de aquisição (ou preço/un)", ty: "num", required: true },
    { k: "vida", l: "Vida útil (dias)", ty: "num", when: { unit: "dia" } },
    { k: "man", l: "Manutenção/dia", ty: "num", when: { unit: "dia" } },
    { k: "cons", l: "Consumíveis/dia", ty: "num", when: { unit: "dia" } },
  ],
  LOGISTICA: [
    { k: "custo", l: "Custo unitário", ty: "num" },
    { k: "link", l: "Ligado ao preço do combustível", ty: "fuel" },
  ],
};

/** Valores derivados mostrados a cinzento (calculados) em cada tipo. */
const BAREM_DERIVED = {
  COMBUSTIVEL: [],
  RH: [
    { k: "dia", l: "Custo diário" },
    { k: "hora", l: "Custo/hora" },
    { k: "real", l: "Custo real diário", headline: true },
    { k: "realH", l: "Custo real/hora" },
    { k: "hEnc", l: "Custo/hora c/ encargos" },
  ],
  EQUIPAMENTO: [
    { k: "dep", l: "Depreciação/h" },
    { k: "precoL", l: "Preço combustível/L" },
    { k: "combH", l: "Combustível/h" },
    { k: "custoH", l: "Custo/hora", headline: true },
    { k: "dia", l: "Custo/dia" },
    { k: "mes", l: "Custo/mês" },
  ],
  VIATURA: [
    { k: "precoL", l: "Preço combustível/L" },
    { k: "combKm", l: "Combustível/km" },
    { k: "km", l: "Custo/km" },
    { k: "dia", l: "Custo/dia", headline: true },
    { k: "mes", l: "Custo/mês" },
  ],
  FERRAMENTA: [
    { k: "dia", l: "Custo/dia" },
    { k: "hora", l: "Custo/hora" },
    { k: "equipa", l: "Custo/equipa/dia" },
    { k: "unit", l: "Custo unitário barem", headline: true },
  ],
  LOGISTICA: [{ k: "custo", l: "Custo em vigor", headline: true }],
};

/** Unidade implícita de cada tipo (quando não é escolhida pelo utilizador). */
const BAREM_FIXED_UNIT = { COMBUSTIVEL: "L" };

const DEFAULT_CTX = Object.freeze({
  horasDia: 8,
  diasMes: 22,
  horasAnoEquip: 1800,
  validadeBarem: 180,
  validadeComb: 30,
  fuelPrices: Object.freeze({}),
});

const DAY_MS = 86400000;

/** Número tolerante: null / "" / undefined / NaN → 0. Aceita Decimal do Prisma. */
function N(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isBlank(v) {
  return v === null || v === undefined || v === "";
}

/** Normaliza o contexto de cálculo, aplicando os valores por omissão. */
function resolveCtx(ctx = {}) {
  return {
    horasDia: N(ctx.horasDia) || DEFAULT_CTX.horasDia,
    diasMes: N(ctx.diasMes) || DEFAULT_CTX.diasMes,
    horasAnoEquip: N(ctx.horasAnoEquip) || DEFAULT_CTX.horasAnoEquip,
    validadeBarem: N(ctx.validadeBarem) || DEFAULT_CTX.validadeBarem,
    validadeComb: N(ctx.validadeComb) || DEFAULT_CTX.validadeComb,
    fuelPrices: ctx.fuelPrices || {},
  };
}

/** Preço do litro: o específico da linha, senão o do combustível escolhido. */
function fuelPrice(esp, tipo, fuelPrices) {
  if (!isBlank(esp)) return N(esp);
  const key = tipo || "Gasóleo";
  return N(fuelPrices[key]);
}

/**
 * Calcula os valores derivados de um barém.
 * @param {string} kind  um de BAREM_KINDS
 * @param {object} item  { fields, unit, ownership }
 * @param {object} ctx   { horasDia, diasMes, horasAnoEquip, fuelPrices }
 * @returns {{ computedCost: number, detail: object }}
 */
function computeBaremCost(kind, item = {}, ctx = {}) {
  const c = resolveCtx(ctx);
  const f = item.fields || {};
  const unit = item.unit || null;
  const ownership = item.ownership || null;

  if (kind === "COMBUSTIVEL") {
    const preco = N(f.preco);
    return { computedCost: preco, detail: {} };
  }

  if (kind === "RH") {
    const dia = isBlank(f.mensal) ? 0 : N(f.mensal) / c.diasMes;
    const hora = dia / c.horasDia;
    const real = dia * (1 + N(f.enc)) + N(f.seg) + N(f.alim) + N(f.aloj) + N(f.transp) + N(f.outros);
    const realH = real / c.horasDia;
    const hEnc = (dia * (1 + N(f.enc)) + N(f.seg) + N(f.outros)) / c.horasDia;
    return { computedCost: real, detail: { dia, hora, real, realH, hEnc } };
  }

  if (kind === "EQUIPAMENTO") {
    const own = ownership === "Alugado" ? "Alugado" : "Próprio";
    const dep = own === "Próprio" && N(f.vida) > 0 ? N(f.aq) / N(f.vida) : 0;
    const precoL = fuelPrice(f.esp, f.tipo, c.fuelPrices);
    const combH = N(f.lh) * precoL;
    const base =
      own === "Alugado"
        ? f.alugUn === "Hora"
          ? N(f.aluguer)
          : N(f.aluguer) / c.horasDia
        : dep + N(f.man) + N(f.lub) + N(f.pneus) + N(f.seguro) / c.horasAnoEquip;
    const custoH = base + combH + N(f.oper) + N(f.outros);
    const dia = custoH * c.horasDia;
    return { computedCost: custoH, detail: { dep, precoL, combH, custoH, dia, mes: dia * c.diasMes } };
  }

  if (kind === "VIATURA") {
    const precoL = fuelPrice(f.esp, f.comb, c.fuelPrices);
    const combKm = (N(f.cons) / 100) * precoL;
    const km = combKm + N(f.man) + N(f.pneus);
    const dia = (N(f.seg) / 12 + N(f.dep) + N(f.mot) + N(f.outros)) / c.diasMes;
    return { computedCost: dia, detail: { precoL, combKm, km, dia, mes: dia * c.diasMes } };
  }

  if (kind === "FERRAMENTA") {
    const perUnit = unit === "un";
    const dia = perUnit ? 0 : (N(f.vida) > 0 ? N(f.aq) / N(f.vida) : 0) + N(f.man) + N(f.cons);
    const unitCost = perUnit ? N(f.aq) : dia;
    return {
      computedCost: unitCost,
      detail: {
        dia,
        hora: dia / c.horasDia,
        equipa: f.tipo === "Kit equipa" ? dia : 0,
        unit: unitCost,
      },
    };
  }

  if (kind === "LOGISTICA") {
    const custo = f.link ? N(c.fuelPrices[f.link]) : N(f.custo);
    return { computedCost: custo, detail: { custo } };
  }

  throw new Error(`BAREM_KIND_DESCONHECIDO: ${kind}`);
}

/** Dias decorridos desde uma data ISO (ou Date). */
function daysSince(date, today = new Date()) {
  if (!date) return Infinity;
  const d = date instanceof Date ? date : new Date(String(date).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return Infinity;
  const ref = today instanceof Date ? today : new Date(today);
  return Math.floor((ref.getTime() - d.getTime()) / DAY_MS);
}

/**
 * Estado de validade de um barém.
 * @returns {{ code: string, label: string, severity: "good"|"warn"|"bad" }}
 */
function computeBaremStatus(kind, item = {}, ctx = {}, today = new Date()) {
  const c = resolveCtx(ctx);
  const f = item.fields || {};

  if (!String(item.name || "").trim()) {
    return { code: "SEM_NOME", label: "Sem nome", severity: "bad" };
  }

  // Regras próprias dos equipamentos, antes da validade (o protótipo faz o mesmo):
  // um equipamento próprio sem depreciação custaria menos do que custa de facto.
  if (kind === "EQUIPAMENTO") {
    const own = item.ownership === "Alugado" ? "Alugado" : "Próprio";
    if (own === "Próprio" && !(N(f.vida) > 0 && N(f.aq) > 0)) {
      return { code: "SEM_DEPRECIACAO", label: "Sem depreciação", severity: "bad" };
    }
    if (own === "Alugado" && !(N(f.aluguer) > 0)) {
      return { code: "SEM_PRECO_ALUGUER", label: "Sem preço de aluguer", severity: "bad" };
    }
  }

  const limite = kind === "COMBUSTIVEL" ? c.validadeComb : c.validadeBarem;
  if (!item.priceDate) return { code: "SEM_DATA", label: "Sem data", severity: "warn" };
  if (daysSince(item.priceDate, today) > limite) {
    return { code: "DESATUALIZADO", label: "Desatualizado", severity: "warn" };
  }
  return { code: "OK", label: "Atualizado", severity: "good" };
}

/**
 * Valida um barém antes de gravar.
 * @returns {string[]} lista de erros (vazia = pode gravar)
 */
function validateBarem(kind, item = {}) {
  const errors = [];
  const f = item.fields || {};

  if (!BAREM_KINDS.includes(kind)) {
    errors.push(`Tipo de barém desconhecido: ${kind}.`);
    return errors;
  }
  if (!String(item.name || "").trim()) errors.push("Indique o nome do recurso.");

  if (kind === "COMBUSTIVEL" && !(N(f.preco) > 0)) {
    errors.push("Indique o preço por litro.");
  }

  if (kind === "RH" && !(N(f.mensal) > 0)) {
    errors.push("Indique o custo mensal.");
  }

  if (kind === "EQUIPAMENTO") {
    const own = item.ownership === "Alugado" ? "Alugado" : "Próprio";
    if (own === "Próprio" && !(N(f.aq) > 0 && N(f.vida) > 0)) {
      // Regra do protótipo: equipamento próprio nunca tem custo zero.
      errors.push("Equipamento próprio: indique o valor de aquisição e a vida útil em horas, para haver depreciação.");
    }
    if (own === "Alugado" && !(N(f.aluguer) > 0)) {
      errors.push("Equipamento alugado: indique o valor do aluguer.");
    }
  }

  if (kind === "FERRAMENTA") {
    if (!FE_COST_UNITS.includes(item.unit)) errors.push('Escolha a unidade de custo: "dia" ou "un".');
    if (!(N(f.aq) > 0)) errors.push("Indique o valor de aquisição (ou o preço por unidade).");
    if (item.unit === "dia" && !(N(f.vida) > 0) && !(N(f.man) > 0) && !(N(f.cons) > 0)) {
      errors.push("Unidade «dia»: indique a vida útil, a manutenção ou os consumíveis, senão o custo fica a zero.");
    }
  }

  if (kind === "LOGISTICA" && !f.link && !(N(f.custo) > 0)) {
    errors.push("Indique o custo unitário ou ligue a linha ao preço de um combustível.");
  }

  return errors;
}

/** Enriquece um registo da base de dados com o custo calculado e o estado. */
function decorateBarem(row, ctx = {}, today = new Date()) {
  const item = {
    name: row.name,
    unit: row.unit,
    ownership: row.ownership,
    fields: row.fields || {},
    priceDate: row.priceDate,
  };
  let computed = { computedCost: 0, detail: {} };
  try {
    computed = computeBaremCost(row.kind, item, ctx);
  } catch {
    computed = { computedCost: 0, detail: {} };
  }
  const status = computeBaremStatus(row.kind, item, ctx, today);
  return {
    ...row,
    fields: row.fields || {},
    computedCost: computed.computedCost,
    detail: computed.detail,
    status: status.code,
    statusLabel: status.label,
    statusSeverity: status.severity,
  };
}

/** Mapa { nome do combustível → preço/L } a partir das linhas COMBUSTIVEL. */
function buildFuelPrices(rows = []) {
  const out = {};
  for (const r of rows) {
    if (r.kind !== "COMBUSTIVEL") continue;
    const name = String(r.name || "").trim();
    if (!name || out[name] !== undefined) continue;
    out[name] = N((r.fields || {}).preco);
  }
  return out;
}

module.exports = {
  BAREM_KINDS,
  BAREM_KIND_LABELS,
  BAREM_KIND_ORDER,
  BAREM_FIELDS,
  BAREM_DERIVED,
  BAREM_FIXED_UNIT,
  OWNERSHIP,
  RENT_UNITS,
  FE_COST_UNITS,
  FE_TYPES,
  DEFAULT_CTX,
  N,
  isBlank,
  resolveCtx,
  fuelPrice,
  computeBaremCost,
  computeBaremStatus,
  validateBarem,
  decorateBarem,
  buildFuelPrices,
  daysSince,
};
