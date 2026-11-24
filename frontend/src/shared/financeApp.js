import { initFinancePage, renderFinancePlaceholder } from "./financePage.js";

/**
 * Mapa das páginas da Área Financeira.
 * `module` — caminho (relativo a /shared) do módulo que renderiza o ecrã.
 * Enquanto não existir, mostramos um placeholder.
 */
const PAGES = {
  overview: {
    code: "F0",
    kicker: "Financeiro",
    title: "Painel Financeiro",
    subtitle: "Visão consolidada de receita, custos, resultado e margem de todas as obras.",
    module: "overview.js",
    placeholder: ["Cards de receita, custos, resultado e margem", "Previsão vs realizado", "Contas a receber / a pagar e cash flow", "Centro de Pagamentos"],
  },
  "faturacao-registar": {
    code: "R1",
    kicker: "Financeiro · Faturação",
    title: "Centro de Recebimentos",
    subtitle: "Registo e acompanhamento das faturas emitidas ao cliente.",
    module: "registarFaturas.js",
    placeholder: ["Filtros por mês, estado, cliente e obra", "Cálculo automático de retenção, IVA, seguro CAR e garantia", "Valor recebido e valor em falta", "Destaque de faturas atrasadas"],
  },
  "custos-realizados": {
    code: "A1",
    kicker: "Financeiro · Custos",
    title: "Custos da Empresa",
    subtitle: "Custos realizados por obra, centro de custo e cliente.",
    module: "custosRealizados.js",
    placeholder: ["Total por obra", "Total por centro de custo", "Total por cliente"],
  },
  "tesouraria-extratos": {
    code: "T3",
    kicker: "Financeiro · Tesouraria",
    title: "Extratos Bancários",
    subtitle: "",
    module: "tesourariaExtratos.js",
    placeholder: ["Importar extrato", "Classificar movimentos", "Associar custo"],
  },
  "tesouraria-pagamentos": {
    kicker: "Financeiro · Tesouraria",
    title: "Pagamentos a Fornecedor",
    subtitle: "Saídas de valores: crédito ou pronto pagamento, material ou serviço.",
    module: "tesourariaMovimentos.js",
    placeholder: ["Crédito vs pronto pagamento", "Material vs serviços"],
  },
  "centro-pagamentos": {
    code: "P1",
    kicker: "Financeiro",
    title: "Centro de Pagamentos",
    subtitle: "Pedidos de pagamento: agendar, aprovar, pagar e confirmar — e o plano da semana contra o saldo.",
    module: "centroPagamentos.js",
    placeholder: ["Pedidos pendentes", "Pedidos aprovados", "Liquidação"],
  },
  calendario: {
    kicker: "Financeiro · Painel",
    title: "Calendário Financeiro",
    subtitle: "O que há a pagar e a receber, pela data em que vence — por mês ou por semana.",
    module: "calendario.js",
    placeholder: ["A pagar e a receber por período", "Em atraso", "Previstos (autos ainda sem fatura)"],
  },
  "conta-corrente": {
    kicker: "Financeiro · Contas a Receber",
    title: "Conta Corrente de Clientes",
    subtitle: "Quanto cada cliente deve e há quanto tempo — com o extrato completo de cada um.",
    module: "contaCorrente.js",
    placeholder: [],
  },
  "contas-saldos": {
    kicker: "Financeiro · Tesouraria",
    title: "Contas e Saldos",
    subtitle: "O dinheiro que há, em que banco, e o que entrou e saiu no mês.",
    module: "contasSaldos.js",
    placeholder: [],
  },
  "mapa-fluxos": {
    kicker: "Financeiro · Painel",
    title: "Mapa de Fluxos",
    subtitle: "Recebimentos e pagamentos por mês ou por semana — realizado, compromissos e previsto.",
    module: "mapaFluxos.js",
    placeholder: [],
  },
  "conciliacao": {
    code: "T2",
    kicker: "Financeiro · Tesouraria",
    title: "Conciliação Bancária",
    subtitle: "",
    module: "conciliacao.js",
    placeholder: [],
  },
  "contas-cartoes": {
    code: "T5",
    kicker: "Financeiro · Tesouraria",
    title: "Contas Bancárias / Cartões",
    subtitle: "As contas e os cartões, com o responsável e o saldo.",
    module: "contasCartoes.js",
    placeholder: [],
  },
  "alocacao-cartoes": {
    code: "T6",
    kicker: "Financeiro · Tesouraria",
    title: "Alocação de Cartões",
    subtitle: "A quem e a que obra cada cartão está entregue.",
    module: "alocacaoCartoes.js",
    placeholder: [],
  },
  "fundo-maneio": {
    code: "T7",
    kicker: "Financeiro · Tesouraria",
    title: "Fundo de Maneio",
    subtitle: "Por cartão: transferido, gasto, por gastar, saldo e sobra livre.",
    module: "fundoManeio.js",
    placeholder: [],
  },
  "financiamentos": {
    code: "E1",
    vista: "E1",
    kicker: "Financeiro · Financiamentos",
    title: "Financiamentos Bancários",
    subtitle: "Empréstimos, leasing e linhas de crédito, com o plano de prestações.",
    module: "financiamentos.js",
    placeholder: [],
  },
  "emprestimos": {
    code: "E2",
    vista: "E2",
    kicker: "Financeiro · Financiamentos",
    title: "Empréstimos Obtidos e Concedidos",
    subtitle: "O que a MBT deve e o que lhe devem, por empresa.",
    module: "financiamentos.js",
    placeholder: [],
  },
  "garantias": {
    code: "E3",
    vista: "E3",
    kicker: "Financeiro · Financiamentos",
    title: "Garantias e Livranças",
    subtitle: "Garantias bancárias e livranças: valor, validade e comissões.",
    module: "financiamentos.js",
    placeholder: [],
  },
  "socios": {
    code: "E4",
    vista: "E4",
    kicker: "Financeiro · Financiamentos",
    title: "Distribuição aos Sócios",
    subtitle: "Lucros distribuídos, IAC e pagamentos por sócio.",
    module: "socios.js",
    placeholder: [],
  },
  "mapa-obrigacoes": {
    code: "P4",
    lado: "P",
    kicker: "Financeiro · Contas a Pagar",
    title: "Mapa de Obrigações",
    subtitle: "O que há a pagar, por tipo e fornecedor, mês a mês.",
    module: "mapaObrigacoes.js",
    placeholder: [],
  },
  impostos: {
    code: "G1",
    kicker: "Financeiro · Impostos",
    title: "Impostos",
    subtitle: "Os impostos de cada mês: data limite, nota de liquidação, RUPE e pagamento.",
    module: "impostos.js",
    placeholder: [],
  },
  "impostos-planos": {
    code: "G2",
    kicker: "Financeiro · Impostos",
    title: "Planos de Pagamento (PPP)",
    subtitle: "Acordos para pagar impostos em prestações.",
    module: "impostosPlanos.js",
    placeholder: [],
  },
  "impostos-iva": {
    code: "G3",
    kicker: "Financeiro · Impostos",
    title: "IVA e Retenções",
    subtitle: "Apuramento indicativo, mês a mês.",
    module: "impostosIva.js",
    placeholder: [],
  },
  "mapa-fiscal": {
    code: "G4",
    kicker: "Financeiro · Impostos",
    title: "Mapa Fiscal",
    subtitle: "Cada imposto e cada plano, mês a mês.",
    module: "mapaFiscal.js",
    placeholder: [],
  },
  "previsao-tesouraria": {
    kicker: "Financeiro · Tesouraria",
    title: "Previsão de Tesouraria",
    subtitle: "Por dia, semana ou mês a partir do saldo de hoje: o que entra, o que já está comprometido e o que se prevê sair.",
    module: "previsaoTesouraria.js",
    placeholder: [],
  },
  "fluxo-caixa": {
    kicker: "Financeiro · Tesouraria",
    title: "Mapa de Fluxo de Caixa",
    subtitle: "Doze meses de caixa a partir do saldo de hoje: realizado, atual e previsto.",
    module: "fluxoCaixa.js",
    placeholder: [],
  },
  "bancos": {
    kicker: "Financeiro · Registos",
    title: "Bancos",
    subtitle: "",
    module: "bancos.js",
    placeholder: [],
  },
  "centros-custo": {
    kicker: "Financeiro · Registos",
    title: "Centros de Custo",
    subtitle: "Cada centro de custo: previsto, realizado sem IVA, pago e por pagar.",
    module: "centrosCusto.js",
    placeholder: [],
  },
  "despesas-sem-comprovativo": {
    kicker: "Financeiro · Contas a Pagar",
    title: "Despesas sem Comprovativo",
    subtitle: "Linhas de pedidos sem documento fiscal ou em autofaturação, com o custo da decisão.",
    module: "despesasSemComprovativo.js",
    placeholder: [],
  },
  "obras-resumo": {
    kicker: "Financeiro · Controlo de Obras",
    title: "Resumo das Obras",
    subtitle: "Por obra: avanço, medido, faturado e recebido; custo real, desvio, margem prevista e dinheiro da obra.",
    module: "obrasResumo.js",
    placeholder: [],
  },
  "obras-custos": {
    kicker: "Financeiro · Controlo de Obras",
    title: "Custos por Obra",
    subtitle: "O orçado, o pago, o comprometido e o custo previsto no fim de cada obra — por categoria ou por fornecedor.",
    module: "obrasCustos.js",
    placeholder: [],
  },
  "obra-tesouraria": {
    kicker: "Financeiro · Controlo de Obras",
    title: "Tesouraria da Obra",
    subtitle: "O que entrou e saiu de dinheiro numa obra — e se a empresa a está a financiar.",
    module: "obraTesouraria.js",
    placeholder: [],
  },
  "obra-previsoes": {
    kicker: "Financeiro · Controlo de Obras",
    title: "Previsões por Obra",
    subtitle: "Venda, custo, margem e prazo previstos, e o previsto mês a mês contra o realizado.",
    module: "obraPrevisoes.js",
    placeholder: [],
  },
  "areas-negocio": {
    kicker: "Financeiro · Controlo de Obras",
    title: "Áreas de Negócio",
    subtitle: "Faturação, custo e margem por tipo de obra.",
    module: "areasNegocio.js",
    placeholder: [],
  },
  "autos-medicao": {
    kicker: "Financeiro · Contas a Receber",
    title: "Autos de Medição",
    subtitle: "Os autos de todas as obras: o que está medido, aprovado, faturado e por faturar.",
    module: "autosMedicao.js",
    placeholder: [],
  },
  controlo: {
    code: "F3",
    kicker: "Financeiro",
    title: "Previsto × Realizado",
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
