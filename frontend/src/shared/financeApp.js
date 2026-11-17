import { initFinancePage, renderFinancePlaceholder } from "./financePage.js";

/**
 * Mapa das páginas da Área Financeira (chave = `data-finance-page` do <body>).
 * `module` — caminho (relativo a /shared/finance) do módulo que renderiza o ecrã.
 * Enquanto não existir, mostramos um placeholder com `placeholder`.
 */
const PAGES = {
  "cp-centro": {
    kicker: "Financeiro · Contas a Pagar · P1",
    title: "Centro de Pagamentos",
    subtitle: "Requisições de pagamento: aprovação, pagamento, faturas e comprovativos.",
    module: "centroPagamentos.js",
  },
  "cr-centro": {
    kicker: "Financeiro · Contas a Receber · R1",
    title: "Centro de Recebimentos",
    subtitle: "Faturas emitidas aos clientes e o que falta receber.",
    module: "centroRecebimentos.js",
  },
  "tes-conciliacao": {
    kicker: "Financeiro · Tesouraria · T2",
    title: "Conciliação Bancária",
    subtitle: "Cada movimento do extrato ligado ao pagamento, recebimento ou transferência que o explica.",
    module: "conciliacao.js",
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
