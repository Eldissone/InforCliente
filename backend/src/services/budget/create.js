/**
 * Criar um orçamento — um só caminho.
 *
 * A rota `POST /budgets` e qualquer script que crie orçamentos em lote passam
 * por aqui. Ter duas maneiras de montar o documento era garantir que mais cedo
 * ou mais tarde divergiam, e os orçamentos criados por um lado deixavam de ser
 * iguais aos criados pelo outro.
 */

const { prisma } = require("../../db");
const { calcBudget, budgetTotals, PRICE_METHODS, QTY_SHEET, SHEET_KEYS } = require("./calc");
const { DEFAULT_ROWS, DEFAULT_MARGINS, DEFAULT_IMPACTS } = require("./sheetDefs");
const { allocate, costCenterCodeFor } = require("./numbering");
const { getBudgetParams, getBudgetLists, getCurrencies } = require("./companySettings");

/** Todas as folhas do documento: as de custo mais o mapa de quantidades. */
const ALL_SHEETS = [QTY_SHEET, ...SHEET_KEYS];

/** Colunas da tabela que são cópia de um parâmetro, para se poder filtrar e ordenar. */
const COLUMN_FROM_PARAMS = {
  projectName: "obra",
  location: "local",
  responsibleName: "respOrc",
  projectDirName: "dirProj",
  currencyBase: "moedaBase",
  currencyRef: "moedaRef",
  method: "metodo",
  marginMin: "margemMin",
  marginTarget: "margemObj",
  vatRate: "iva",
  commercialAdjust: "ajuste",
};

function dateOnly(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

/** As colunas da tabela a partir do documento e do cálculo. */
function columnsFor(doc, R) {
  const P = doc.params || {};
  const cols = {};
  for (const [col, key] of Object.entries(COLUMN_FROM_PARAMS)) {
    const v = P[key];
    cols[col] = v === "" || v === undefined ? null : v;
  }
  cols.projectName = String(P.obra || "").trim() || "(sem nome)";
  cols.method = PRICE_METHODS.includes(P.metodo) ? P.metodo : "MARGEM_SOBRE_VENDA";
  cols.currencyBase = P.moedaBase || "AOA";
  cols.startDate = P.inicio ? new Date(`${P.inicio}T00:00:00Z`) : null;
  cols.endDate = P.fim ? new Date(`${P.fim}T00:00:00Z`) : null;
  cols.priceBaseDate = P.dataBase ? new Date(`${P.dataBase}T00:00:00Z`) : null;
  cols.validityDays = Number(P.validade) || 30;
  return { ...cols, ...budgetTotals(R) };
}

/** Fotografia da biblioteca de baremes da empresa, para o orçamento não mudar sozinho. */
async function snapshotFromLibrary() {
  const rows = await prisma.baremItem.findMany({
    where: { active: true },
    orderBy: [{ kind: "asc" }, { code: "asc" }, { name: "asc" }],
  });
  return {
    takenAt: new Date().toISOString(),
    source: "empresa",
    items: rows.map((r) => ({
      kind: r.kind,
      code: r.code,
      name: r.name,
      unit: r.unit,
      ownership: r.ownership,
      fields: r.fields || {},
      priceDate: r.priceDate ? r.priceDate.toISOString().slice(0, 10) : null,
    })),
  };
}

/**
 * Monta o documento de um orçamento novo, sem o gravar.
 *
 * @param {object} input
 * @param {string} input.number número já reservado (`allocate("ORC")`)
 * @param {string} input.costCenterCode
 * @param {object|null} input.client
 * @param {object} input.snapshot baremes
 * @param {object} input.company `{ params, lists, currencies }`
 * @param {object} input.fields campos do formulário
 * @param {object} [input.sheets] folhas iniciais (por omissão, as de arranque)
 */
function buildBudgetDocument({ number, costCenterCode, client, snapshot, company, fields, sheets }) {
  const today = new Date().toISOString().slice(0, 10);
  const params = {
    ...company.params,
    codOrc: number,
    cc: costCenterCode,
    revisao: "R0",
    proposta: null,
    codObra: fields.projectCode ?? null,
    data: today,
    estado: "Em elaboração",
    clienteId: client ? client.id : null,
    cliente: client ? client.name : null,
    obra: fields.projectName,
    local: fields.location,
    respOrc: fields.responsibleName,
    dirProj: fields.projectDirName,
    inicio: dateOnly(fields.startDate),
    fim: dateOnly(fields.endDate),
    dataBase: dateOnly(fields.priceBaseDate) || today,
    validade: fields.validityDays,
    moedaBase: fields.currencyBase,
    moedaRef: fields.currencyRef,
    metodo: fields.method,
    margemMin: fields.marginMin ?? company.params.margemMin,
    margemObj: fields.marginTarget ?? company.params.margemObj,
    iva: fields.vatRate ?? company.params.iva,
    ajuste: 0,
    currencies: company.currencies,
  };

  const base = Object.fromEntries(ALL_SHEETS.map((k) => [k, (DEFAULT_ROWS[k] || []).map((r) => ({ ...r }))]));
  const doc = {
    params,
    sheets: { ...base, ...(sheets || {}) },
    baremSnapshot: snapshot,
    lists: { ...company.lists, impacto: DEFAULT_IMPACTS },
    dispatch: { margens: { ...DEFAULT_MARGINS }, estado: "Em análise" },
  };
  return { doc, R: calcBudget(doc) };
}

/** Os parâmetros, listas e câmbios da empresa, numa chamada. */
async function loadCompanyDefaults() {
  const [{ params }, { lists }, { currencies }] = await Promise.all([
    getBudgetParams(),
    getBudgetLists(),
    getCurrencies(),
  ]);
  return { params, lists, currencies };
}

module.exports = {
  ALL_SHEETS,
  COLUMN_FROM_PARAMS,
  columnsFor,
  snapshotFromLibrary,
  buildBudgetDocument,
  loadCompanyDefaults,
  dateOnly,
};
