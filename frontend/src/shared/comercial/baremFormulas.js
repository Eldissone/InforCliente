/**
 * Espelho das fórmulas dos baremes, para resposta instantânea enquanto se escreve.
 *
 * A FONTE DA VERDADE é `backend/src/services/budget/baremCost.js`; o servidor recalcula
 * e materializa os valores ao gravar. O teste `backend/test/baremCost.test.js` importa
 * este ficheiro e garante que os dois dão exatamente o mesmo resultado — por isso este
 * módulo não pode importar nada (nem DOM, nem outros módulos).
 *
 * Ao alterar uma fórmula aqui, altere-a também no serviço do backend; o teste falha se
 * os dois divergirem.
 */

export const BAREM_KINDS = ["COMBUSTIVEL", "RH", "EQUIPAMENTO", "VIATURA", "FERRAMENTA", "LOGISTICA"];

export const DEFAULT_CTX = Object.freeze({
  horasDia: 8,
  diasMes: 22,
  horasAnoEquip: 1800,
  validadeBarem: 180,
  validadeComb: 30,
  fuelPrices: Object.freeze({}),
});

const DAY_MS = 86400000;

/** Número tolerante: null / "" / undefined / NaN → 0. */
export function N(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function isBlank(v) {
  return v === null || v === undefined || v === "";
}

export function resolveCtx(ctx = {}) {
  return {
    horasDia: N(ctx.horasDia) || DEFAULT_CTX.horasDia,
    diasMes: N(ctx.diasMes) || DEFAULT_CTX.diasMes,
    horasAnoEquip: N(ctx.horasAnoEquip) || DEFAULT_CTX.horasAnoEquip,
    validadeBarem: N(ctx.validadeBarem) || DEFAULT_CTX.validadeBarem,
    validadeComb: N(ctx.validadeComb) || DEFAULT_CTX.validadeComb,
    fuelPrices: ctx.fuelPrices || {},
  };
}

export function fuelPrice(esp, tipo, fuelPrices) {
  if (!isBlank(esp)) return N(esp);
  const key = tipo || "Gasóleo";
  return N(fuelPrices[key]);
}

/**
 * @param {string} kind
 * @param {{fields?:object, unit?:string|null, ownership?:string|null}} item
 * @param {object} ctx
 * @returns {{computedCost:number, detail:object}}
 */
export function computeBaremCost(kind, item = {}, ctx = {}) {
  const c = resolveCtx(ctx);
  const f = item.fields || {};
  const unit = item.unit || null;
  const ownership = item.ownership || null;

  if (kind === "COMBUSTIVEL") {
    return { computedCost: N(f.preco), detail: {} };
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

export function daysSince(date, today = new Date()) {
  if (!date) return Infinity;
  const d = date instanceof Date ? date : new Date(String(date).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return Infinity;
  const ref = today instanceof Date ? today : new Date(today);
  return Math.floor((ref.getTime() - d.getTime()) / DAY_MS);
}

/** @returns {{code:string,label:string,severity:"good"|"warn"|"bad"}} */
export function computeBaremStatus(kind, item = {}, ctx = {}, today = new Date()) {
  const c = resolveCtx(ctx);
  const f = item.fields || {};

  if (!String(item.name || "").trim()) {
    return { code: "SEM_NOME", label: "Sem nome", severity: "bad" };
  }

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

/** Mapa { nome do combustível → preço/L } a partir das linhas COMBUSTIVEL. */
export function buildFuelPrices(rows = []) {
  const out = {};
  for (const r of rows) {
    if (r.kind !== "COMBUSTIVEL") continue;
    const name = String(r.name || "").trim();
    if (!name || out[name] !== undefined) continue;
    out[name] = N((r.fields || {}).preco);
  }
  return out;
}
