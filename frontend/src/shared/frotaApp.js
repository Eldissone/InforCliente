import { initFinancePage, renderFinancePlaceholder } from "./financePage.js";

/**
 * Páginas da área Frota (o `NAV_FROTA` do protótipo). Mesma casca das páginas
 * de Compras e do Financeiro (`#financePageHeader`, `#financeRoot`), com a
 * guarda `frota:view`. Cada página é uma vista do módulo `frota/frota.js`.
 */
const PAGES = {
  painel: { code: "V1", title: "Painel da Frota", subtitle: "Estado das viaturas, custos do ano, alertas e próximos vencimentos num só ecrã." },
  alertas: { code: "V2", title: "Alertas da Frota", subtitle: "Tudo o que precisa de atenção: seguros, documentos, manutenção, cartas de condução, ocorrências e abastecimentos anómalos." },
  viaturas: { code: "V3", title: "Viaturas e Equipamentos", subtitle: "Viaturas, máquinas e equipamentos da empresa. Clique numa linha para abrir a ficha." },
  motoristas: { code: "V4", title: "Motoristas", subtitle: "Motoristas e operadores, com a carta de condução e a validade." },
  abastecimentos: { code: "V5", title: "Abastecimentos", subtitle: "Combustível por viatura, com o percurso, o consumo e as anomalias (km abaixo do anterior, consumo fora da referência)." },
  manutencoes: { code: "V6", title: "Manutenções e Reparações", subtitle: "Intervenções nas viaturas: preventivas, correctivas e reparações, com o custo." },
  planos: { code: "V7", title: "Planos Preventivos", subtitle: "Os planos de manutenção de cada viatura, por km / horas ou por meses, e quando vence o próximo." },
  ocorrencias: { code: "V8", title: "Ocorrências e Acidentes", subtitle: "Avarias, acidentes, multas e outras ocorrências, do registo ao fecho." },
  documentos: { code: "V9", title: "Documentos", subtitle: "Livrete, inspecção, taxa de circulação e outros documentos de cada viatura, com a validade." },
  seguros: { code: "V10", title: "Seguros", subtitle: "Apólices de seguro da frota. As que expiram nos próximos 30 dias ficam a laranja; as expiradas a vermelho." },
  custos: { code: "V13", title: "Custos por Viatura", subtitle: "Quanto custa cada viatura: combustível, manutenção, ocorrências e documentos." },
};

(async () => {
  const vista = document.body.dataset.frotaPage;
  const meta = PAGES[vista];
  if (!meta) {
    console.warn("Página da Frota desconhecida:", vista);
    return;
  }
  const ok = await initFinancePage({ ...meta, kicker: "Frota", guards: [["frota", "view"]] });
  if (!ok) return;
  try {
    const mod = await import("./frota/frota.js");
    await mod.render({ ...meta, vista });
  } catch (err) {
    console.error("Falha ao carregar o módulo da Frota:", err);
    renderFinancePlaceholder("financeRoot", meta.title, []);
  }
})();
