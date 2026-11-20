/**
 * Parâmetros padrão da empresa para a orçamentação (módulo Comercial).
 *
 * Guardados em `CompanySetting` (chave → JSON), em três chaves:
 *   budget.params      parâmetros de cálculo, formação do preço, alertas e financeiros
 *   budget.lists       listas de validação (funções, unidades, famílias…)
 *   budget.currencies  tabela de câmbios
 *
 * Cada orçamento novo recebe uma cópia destes valores em `Budget.params` (Fase 2);
 * a partir daí é independente, como no protótipo.
 */

const { prisma } = require("../../db");

const KEY_PARAMS = "budget.params";
const KEY_LISTS = "budget.lists";
const KEY_CURRENCIES = "budget.currencies";

const PRICE_METHODS = ["MARGEM_SOBRE_VENDA", "MARKUP_SOBRE_CUSTO"];

/** Valores de arranque — os do exemplo do protótipo, adaptados a Angola. */
const DEFAULT_BUDGET_PARAMS = Object.freeze({
  // Moedas
  moedaBase: "AOA",
  moedaRef: "USD",
  // B. Formação do preço
  metodo: "MARGEM_SOBRE_VENDA",
  margemMin: 0.15,
  margemObj: 0.25,
  iva: 0.14,
  validade: 30,
  // C. Parâmetros de cálculo
  diasMes: 22,
  horasDia: 8,
  horasAnoEquip: 1800,
  // D. Controlo e alertas
  validadeBarem: 180,
  validadeCambio: 15,
  validadeComb: 30,
  duracaoAprovada: 150,
  limiarAtencao: 0.9,
  desvioMax: 0.1,
  contMin: 0.03,
  abcA: 0.8,
  abcB: 0.95,
  // E. Parâmetros financeiros
  taxaJuro: 0.18,
  pmr: 90,
  pmp: 45,
});

const DEFAULT_BUDGET_LISTS = Object.freeze({
  funcoes: [
    "Diretor de Projeto",
    "Engenheiro",
    "Coordenador",
    "Encarregado",
    "Eletricista",
    "Técnico",
    "Operador de máquina",
    "Motorista",
    "Pedreiro",
    "Servente",
    "Administrativo",
    "Segurança/HSE",
    "Topógrafo",
  ],
  estados: [
    "Em elaboração",
    "Em revisão",
    "Aguardando aprovação",
    "Aprovado",
    "Proposta enviada",
    "Em negociação",
    "Adjudicado",
    "Não adjudicado",
  ],
  unid: ["un", "m", "km", "m2", "m3", "kg", "t", "L", "cj", "vg", "h", "dia", "mês", "viagem"],
  familias: [
    "Cabos MT",
    "Cabos BT",
    "Postes",
    "Ferragens",
    "Isoladores",
    "Transformadores",
    "Celas MT",
    "Quadros BT",
    "Acessórios",
    "Terras",
    "Construção civil",
    "Iluminação",
    "Outros",
  ],
  tipoFE: ["Kit equipa", "Individual", "Elétrica", "Medição", "Ensaio", "Consumível", "EPI"],
  catRisco: [
    "Cambial",
    "Mercado/preços",
    "Clima",
    "Prazo",
    "Equipamentos",
    "Produtividade",
    "Qualidade",
    "Logística",
    "Âmbito/contrato",
    "Outros",
  ],
  departamentos: [
    "Direção",
    "Obras",
    "Produção",
    "Logística",
    "Comercial / Orçamentação",
    "Administrativo e financeiro",
    "HSE",
    "Manutenção",
    "Frota",
  ],
  vinculos: ["Efetivo", "Contrato a prazo", "Eventual / jornaleiro", "Prestador de serviços"],
});

const DEFAULT_CURRENCIES = Object.freeze([
  { moeda: "AOA", desc: "Kwanza", cambio: 1, data: null },
  { moeda: "USD", desc: "Dólar americano", cambio: null, data: null },
  { moeda: "EUR", desc: "Euro", cambio: null, data: null },
]);

/**
 * Metadados dos blocos de parâmetros, para o ecrã se desenhar a partir daqui
 * em vez de repetir a lista.
 * ty: "num" | "pct" | "sel"
 */
const PARAM_GROUPS = Object.freeze([
  {
    id: "preco",
    label: "B. Formação do preço",
    help: "Como se passa do custo ao preço de venda. Cada orçamento novo parte destes valores.",
    fields: [
      {
        k: "metodo",
        l: "Metodologia de preço",
        ty: "sel",
        options: PRICE_METHODS,
        optionLabels: {
          MARGEM_SOBRE_VENDA: "Margem sobre a venda — PV = Custo ÷ (1 − Margem)",
          MARKUP_SOBRE_CUSTO: "Markup sobre o custo — PV = Custo × (1 + Markup)",
          PRECO_DADO: "Preço dado pelo cliente — PV = total do mapa de quantidades, e a margem é o que sobra",
        },
      },
      { k: "margemMin", l: "Margem mínima aceitável (s/ venda)", ty: "pct", help: "Abaixo deste valor o orçamento fica em alerta vermelho." },
      { k: "margemObj", l: "Margem objetivo (s/ venda)", ty: "pct" },
      { k: "iva", l: "IVA", ty: "pct", help: "Taxa geral em Angola: 14%. Confirmar o regime do cliente." },
      { k: "validade", l: "Validade da proposta (dias)", ty: "num" },
    ],
  },
  {
    id: "calculo",
    label: "C. Parâmetros de cálculo",
    help: "Comandam as fórmulas dos baremes: mudar aqui muda todos os custos calculados.",
    fields: [
      { k: "diasMes", l: "Dias úteis por mês", ty: "num", help: "Converte custos mensais em diários." },
      { k: "horasDia", l: "Horas de trabalho por dia", ty: "num" },
      { k: "horasAnoEquip", l: "Horas de utilização por ano (equipamentos)", ty: "num", help: "Reparte o seguro anual dos equipamentos." },
    ],
  },
  {
    id: "alertas",
    label: "D. Controlo e alertas",
    help: "Quando é que um valor passa a estar desatualizado e quando é que um desvio dá alerta.",
    fields: [
      { k: "validadeBarem", l: "Validade máxima dos baremes (dias)", ty: "num" },
      { k: "validadeCambio", l: "Validade máxima do câmbio (dias)", ty: "num" },
      { k: "validadeComb", l: "Validade máxima do preço dos combustíveis (dias)", ty: "num" },
      { k: "duracaoAprovada", l: "Duração do orçamento aprovado (dias)", ty: "num" },
      { k: "limiarAtencao", l: "Limiar de atenção — consumo do orçamento", ty: "pct" },
      { k: "desvioMax", l: "Desvio máximo admissível por categoria", ty: "pct" },
      { k: "contMin", l: "Contingência mínima (% do custo direto)", ty: "pct" },
      { k: "abcA", l: "Análise ABC — limite da classe A (% acumulada)", ty: "pct" },
      { k: "abcB", l: "Análise ABC — limite da classe B (% acumulada)", ty: "pct" },
    ],
  },
  {
    id: "financeiro",
    label: "E. Parâmetros financeiros",
    help: "Usados nos custos financeiros e no cálculo do fundo de maneio.",
    fields: [
      { k: "taxaJuro", l: "Taxa de juro / custo do capital (anual)", ty: "pct", help: "Usar a taxa efetiva da empresa." },
      { k: "pmr", l: "Prazo médio de recebimento (dias)", ty: "num" },
      { k: "pmp", l: "Prazo médio de pagamento (dias)", ty: "num" },
    ],
  },
]);

/** Listas editáveis no ecrã de parâmetros, com a respetiva etiqueta. */
const LIST_LABELS = Object.freeze({
  funcoes: "Categorias / funções (barém de RH)",
  estados: "Estados do orçamento",
  unid: "Unidades",
  familias: "Famílias de materiais",
  tipoFE: "Tipos de ferramenta",
  catRisco: "Categorias de risco",
  departamentos: "Departamentos",
  vinculos: "Vínculos contratuais",
});

async function readSetting(key, fallback) {
  const row = await prisma.companySetting.findUnique({ where: { key } });
  if (!row) return { value: fallback, stored: false, updatedAt: null };
  return { value: row.value, stored: true, updatedAt: row.updatedAt };
}

/** Parâmetros com os valores por omissão preenchidos nos campos que faltam. */
async function getBudgetParams() {
  const { value, stored, updatedAt } = await readSetting(KEY_PARAMS, {});
  return { params: { ...DEFAULT_BUDGET_PARAMS, ...(value || {}) }, stored, updatedAt };
}

async function getBudgetLists() {
  const { value, stored, updatedAt } = await readSetting(KEY_LISTS, {});
  const lists = { ...DEFAULT_BUDGET_LISTS };
  for (const [k, v] of Object.entries(value || {})) {
    if (Array.isArray(v)) lists[k] = v;
  }
  return { lists, stored, updatedAt };
}

async function getCurrencies() {
  const { value, stored, updatedAt } = await readSetting(KEY_CURRENCIES, null);
  const currencies = Array.isArray(value) && value.length ? value : DEFAULT_CURRENCIES.map((c) => ({ ...c }));
  return { currencies, stored, updatedAt };
}

/**
 * Subconjunto dos parâmetros de que as fórmulas dos baremes precisam.
 * É este o `ctx` que `baremCost.js` recebe (sem os preços dos combustíveis,
 * que vêm da própria tabela de baremes).
 */
async function getBudgetCalcContext() {
  const { params } = await getBudgetParams();
  return {
    horasDia: params.horasDia,
    diasMes: params.diasMes,
    horasAnoEquip: params.horasAnoEquip,
    validadeBarem: params.validadeBarem,
    validadeComb: params.validadeComb,
  };
}

async function writeSetting(key, value, label, userId) {
  return prisma.companySetting.upsert({
    where: { key },
    create: { key, value, label: label || null, updatedById: userId || null },
    update: { value, label: label || undefined, updatedById: userId || null },
  });
}

module.exports = {
  KEY_PARAMS,
  KEY_LISTS,
  KEY_CURRENCIES,
  PRICE_METHODS,
  DEFAULT_BUDGET_PARAMS,
  DEFAULT_BUDGET_LISTS,
  DEFAULT_CURRENCIES,
  PARAM_GROUPS,
  LIST_LABELS,
  getBudgetParams,
  getBudgetLists,
  getCurrencies,
  getBudgetCalcContext,
  writeSetting,
};
