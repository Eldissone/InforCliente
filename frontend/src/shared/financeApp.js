import { initFinancePage, renderFinancePlaceholder } from "./financePage.js";

/**
 * Mapa das páginas da Área Financeira.
 * `module` — caminho (relativo a /shared) do módulo que renderiza o ecrã.
 * Enquanto não existir, mostramos um placeholder.
 */
const PAGES = {
  overview: {
    kicker: "Financeiro",
    title: "Overview Financeiro",
    subtitle: "Visão consolidada de receita, custos, resultado e margem de todas as obras.",
    module: "overview.js",
    placeholder: ["Cards de receita, custos, resultado e margem", "Previsão vs realizado", "Contas a receber / a pagar e cash flow", "Centro de Pagamentos"],
  },
  "faturacao-registar": {
    kicker: "Financeiro · Faturação",
    title: "Registar Faturas",
    subtitle: "Registo e acompanhamento das faturas emitidas ao cliente.",
    module: "registarFaturas.js",
    placeholder: ["Filtros por mês, estado, cliente e obra", "Cálculo automático de retenção, IVA, seguro CAR e garantia", "Valor recebido e valor em falta", "Destaque de faturas atrasadas"],
  },
  "faturacao-prevista": {
    kicker: "Financeiro · Faturação",
    title: "Faturação Prevista",
    subtitle: "Faturação emitida vs previsão, total, por obra e por cliente.",
    module: "faturacaoPrevista.js",
    placeholder: ["Faturação prevista vs realizada", "Valores por faturar", "Listagem por auto de medição"],
  },
  "faturacao-resumo": {
    kicker: "Financeiro · Faturação",
    title: "Resumo Faturas vs Previsão",
    subtitle: "Comparação entre o faturado e a previsão da obra.",
    module: "faturacaoResumo.js",
    placeholder: ["% da obra com AM feitos", "% da obra sem AM feitos", "% executada e por executar"],
  },
  "custos-registar": {
    kicker: "Financeiro · Custos",
    title: "Registar Custos",
    subtitle: "Custos previstos, comprometidos e realizados por obra.",
    module: "custosRegistar.js",
    placeholder: ["Entrada automática de pagamentos, stock e ATM", "Estado Por confirmar / Confirmado", "Responsável pela confirmação"],
  },
  "custos-realizados": {
    kicker: "Financeiro · Custos",
    title: "Custos Realizados",
    subtitle: "Custos realizados por obra, centro de custo e cliente.",
    module: "custosRealizados.js",
    placeholder: ["Total por obra", "Total por centro de custo", "Total por cliente"],
  },
  "custos-overview": {
    kicker: "Financeiro · Custos",
    title: "Overview Custos",
    subtitle: "Custos previstos vs realizados e desvios.",
    module: "custosOverview.js",
    placeholder: ["Custos previstos vs realizados", "Desvios de custo"],
  },
  contas: {
    kicker: "Financeiro",
    title: "Contas a Receber / Pagar",
    subtitle: "O que cobrar, o que pagar e como fica a caixa nas próximas semanas.",
    module: "contas.js",
    placeholder: ["Recebimentos", "Pagamentos", "Cash flow"],
  },
  "tesouraria-extratos": {
    kicker: "Financeiro · Tesouraria",
    title: "Extratos Bancários",
    subtitle: "Importar extratos, conferir saldos, classificar movimentos e associar custos às saídas.",
    module: "tesourariaExtratos.js",
    placeholder: ["Importar extrato", "Classificar movimentos", "Associar custo"],
  },
  "tesouraria-recebimentos": {
    kicker: "Financeiro · Tesouraria",
    title: "Recebimentos do Cliente",
    subtitle: "Entradas de valores do cliente, ligadas às faturas em aberto.",
    module: "tesourariaMovimentos.js",
    placeholder: ["Recebimentos por obra", "Associação à fatura"],
  },
  "tesouraria-transferencias": {
    kicker: "Financeiro · Tesouraria",
    title: "Transferências Internas",
    subtitle: "Requisições de fundo → entrada no cartão da obra → pagamento a fornecedor.",
    module: "tesourariaMovimentos.js",
    placeholder: ["Requisições de fundo", "Entrada no cash flow da obra"],
  },
  "tesouraria-atm": {
    kicker: "Financeiro · Tesouraria",
    title: "Levantamentos ATM",
    subtitle: "Saídas de valores dos cartões de obra, separadas em custos por fornecedor e tipo.",
    module: "tesourariaMovimentos.js",
    placeholder: ["Levantamentos em ATM", "Separação de custos por fornecedor e tipo"],
  },
  "tesouraria-pagamentos": {
    kicker: "Financeiro · Tesouraria",
    title: "Pagamentos a Fornecedor",
    subtitle: "Saídas de valores: crédito ou pronto pagamento, material ou serviço.",
    module: "tesourariaMovimentos.js",
    placeholder: ["Crédito vs pronto pagamento", "Material vs serviços"],
  },
  "centro-pagamentos": {
    kicker: "Financeiro",
    title: "Centro de Pagamentos",
    subtitle: "Pedidos de pagamento: agendar, aprovar, pagar e confirmar — e o plano da semana contra o saldo.",
    module: "centroPagamentos.js",
    placeholder: ["Pedidos pendentes", "Pedidos aprovados", "Liquidação"],
  },
  controlo: {
    kicker: "Financeiro",
    title: "Controlo Financeiro",
    subtitle: "Custo face ao avanço das obras, custo final previsto, resultado e margem sem IVA.",
    module: "controlo.js",
    placeholder: ["Previsto vs realizado", "Resultado & margem", "Desvios e cash flow"],
  },
};

const MODULE_BASE = "./finance/";

(async () => {
  const key = document.body.dataset.financePage;
  const meta = PAGES[key];
  if (!meta) {
    console.warn("Página financeira desconhecida:", key);
    return;
  }

  const ok = await initFinancePage(meta);
  if (!ok) return;

  if (meta.module) {
    try {
      const mod = await import(`${MODULE_BASE}${meta.module}`);
      await mod.render?.(meta);
      return;
    } catch (err) {
      console.error("Falha ao carregar o módulo financeiro:", err);
    }
  }

  renderFinancePlaceholder("financeRoot", meta.title, meta.placeholder);
})();
