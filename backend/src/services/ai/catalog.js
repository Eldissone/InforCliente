/**
 * Catálogo da IA: funcionalidades, categorias de dados, tipos de resumo e
 * grupos de destinatários. É a fonte única usada pelas rotas (validação),
 * pelo serviço de definições (valores por omissão) e pelo ecrã de gestão.
 */

const FEATURES = [
  { key: "invoice_scan", label: "Leitura de faturas", default: true },
  { key: "assistant", label: "Assistente da obra", default: false },
  { key: "chat_mention", label: "@IA no chat", default: false },
  { key: "digests", label: "Resumos diários e semanais", default: false },
  { key: "alerts", label: "Alertas preditivos", default: false },
  { key: "needs_assist", label: "Necessidades assistidas (texto ou foto)", default: false },
  { key: "proposal_texts", label: "Textos da proposta ao cliente", default: false },
  { key: "budget_import", label: "Importar orçamento de uma folha de Excel", default: false },
  { key: "barem_assist", label: "Assistente de baremes (calcular e tirar dúvidas)", default: false },
  { key: "budget_compose", label: "Compor os custos a partir do mapa de quantidades", default: false },
  { key: "documents_draft", label: "Rascunhos de documentos (autos e relatório mensal)", default: false },
  { key: "photos", label: "Análise de fotos", default: false },
];

/**
 * Categorias de dados que podem ser enviadas ao fornecedor de IA.
 * Por omissão nada é enviado, exceto os documentos/faturas, que a leitura de
 * faturas já enviava antes desta configuração existir.
 * `anonymizable`: aceita o modo "anonimizar" (nomes trocados por etiquetas).
 */
const DATA_CATEGORIES = [
  { key: "progress", label: "Progresso e planeamento (WBS, planos diários)", default: "off", anonymizable: false },
  { key: "stock", label: "Stock e materiais", default: "off", anonymizable: false },
  { key: "needs", label: "Necessidades e cotações", default: "off", anonymizable: false },
  { key: "budget", label: "Valores de orçamento e custos", default: "off", anonymizable: false },
  { key: "payments", label: "Pagamentos e tesouraria", default: "off", anonymizable: false },
  { key: "suppliers", label: "Nomes de fornecedores", default: "off", anonymizable: true },
  { key: "personnel_names", label: "Pessoal: nomes", default: "off", anonymizable: true },
  { key: "personnel_pay", label: "Pessoal: salários e folha de ponto", default: "off", anonymizable: false },
  { key: "photos", label: "Fotos da obra", default: "off", anonymizable: false },
  { key: "documents", label: "Documentos e faturas", default: "on", anonymizable: false },
  { key: "chat", label: "Mensagens do chat", default: "off", anonymizable: true },
];

const CATEGORY_MODES = ["off", "on", "anonymize"];

const DIGEST_TYPES = [
  { key: "DAILY_SUMMARY", label: "Resumo diário" },
  { key: "WEEKLY_SUMMARY", label: "Resumo semanal" },
  { key: "PREDICTIVE_ALERTS", label: "Alertas preditivos" },
  { key: "URGENT_ALERTS", label: "Alertas urgentes" },
];

const RECIPIENT_GROUPS = [
  {
    key: "PROJECT_DIRECTOR",
    label: "Director de obra",
    hint: "O director/responsável de cada obra. Recebe só as obras dele.",
    selectsUsers: false,
    defaultContent: "FULL",
  },
  {
    key: "DIRECTION",
    label: "Direcção",
    hint: "Utilizadores escolhidos. Recebem todas as obras ou só as selecionadas.",
    selectsUsers: true,
    defaultContent: "FULL",
  },
  {
    key: "FINANCE",
    label: "Financeiro",
    hint: "Perfil financeiro ou marcados como recetores financeiros.",
    selectsUsers: false,
    defaultContent: "FINANCIAL",
  },
  {
    key: "OPERATORS",
    label: "Operadores selecionados",
    hint: "Utilizadores escolhidos, cada um com as suas obras.",
    selectsUsers: true,
    defaultContent: "OPERATIONAL",
  },
];

const CONTENT_TYPES = [
  { key: "FULL", label: "Completo" },
  { key: "OPERATIONAL", label: "Só operacional" },
  { key: "FINANCIAL", label: "Só financeiro" },
];

const CHANNELS = ["in_app", "email"];

const featureKeys = () => FEATURES.map((f) => f.key);
const categoryKeys = () => DATA_CATEGORIES.map((c) => c.key);

function defaultFeatures() {
  return Object.fromEntries(FEATURES.map((f) => [f.key, f.default]));
}

function defaultCategories() {
  return Object.fromEntries(DATA_CATEGORIES.map((c) => [c.key, c.default]));
}

module.exports = {
  FEATURES,
  DATA_CATEGORIES,
  CATEGORY_MODES,
  DIGEST_TYPES,
  RECIPIENT_GROUPS,
  CONTENT_TYPES,
  CHANNELS,
  featureKeys,
  categoryKeys,
  defaultFeatures,
  defaultCategories,
};
