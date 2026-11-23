import { initFinancePage, renderFinancePlaceholder } from "./financePage.js";

/**
 * Páginas da área Compras e Stock (o `NAV_COMP` do protótipo) que a app ainda
 * não tinha. Usam a mesma casca das páginas do Financeiro (cabeçalho com o
 * código do ecrã, `#financeRoot`), com a guarda de Stock / Logística — e o
 * Financeiro também entra, porque C5 e C6 são dele tanto quanto das Compras.
 */
const GUARDS = [
  ["stock", "view"],
  ["logistica", "view"],
  ["financeiro", "view"],
];

const PAGES = {
  "mapas-comparativos": {
    code: "C2",
    kicker: "Compras",
    title: "Mapas Comparativos",
    subtitle: "Para cada necessidade com cotações, as propostas dos fornecedores lado a lado: a mais barata e a escolhida.",
    module: "mapasComparativos.js",
  },
  "base-precos": {
    code: "C3",
    kicker: "Compras",
    title: "Base de Preços",
    subtitle: "Preços de compra da empresa: tabelas dos fornecedores e preços das cotações adjudicadas.",
    module: "basePrecos.js",
  },
  compromissos: {
    code: "C5",
    kicker: "Compras · Encomendas",
    title: "Compromissos Pendentes",
    subtitle: "Compras já assumidas que ainda não são uma dívida documentada. Contam para a tesouraria futura.",
    module: "compromissos.js",
  },
  "conta-corrente-fornecedores": {
    code: "P5",
    kicker: "Financeiro · Contas a Pagar",
    title: "Conta Corrente de Fornecedores",
    subtitle: "Quanto devemos a cada fornecedor e há quanto tempo (antiguidade pelo vencimento).",
    module: "contaCorrenteFornecedores.js",
  },
  "stock-armazem": {
    code: "S3",
    kicker: "Stock",
    title: "Stock por Armazém",
    subtitle: "O que está em cada armazém, ao custo médio. O stock não é custo: o custo nasce na saída.",
    module: "stockArmazem.js",
  },
  "movimentos-armazem": {
    code: "S4",
    kicker: "Stock",
    title: "Movimentos de Armazém",
    subtitle: "Entradas, saídas, transferências e acertos de todos os armazéns.",
    module: "movimentosArmazem.js",
  },
};

(async () => {
  const key = document.body.dataset.comprasPage;
  const meta = PAGES[key];
  if (!meta) {
    console.warn("Página de Compras e Stock desconhecida:", key);
    return;
  }
  const ok = await initFinancePage({ ...meta, guards: GUARDS });
  if (!ok) return;
  try {
    const mod = await import(`./compras/${meta.module}`);
    await mod.render?.(meta);
  } catch (err) {
    console.error("Falha ao carregar o módulo de Compras e Stock:", err);
    renderFinancePlaceholder("financeRoot", meta.title, []);
  }
})();
