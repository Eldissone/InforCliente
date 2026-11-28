import { initFinancePage, renderFinancePlaceholder } from "./financePage.js";

/**
 * Páginas da área Frota (o `NAV_FROTA` do protótipo). Mesma casca das páginas
 * de Compras e do Financeiro (`#financePageHeader`, `#financeRoot`), com a
 * guarda `frota:view`. Cada página é uma vista do módulo `frota/frota.js`.
 */
const PAGES = {
  painel: { code: "", title: "Painel de Gestão da Frota", subtitle: "Quanto custa a frota, mês a mês, e o volume da operação — para a gestão, sem mexer no dia a dia." },
  alertas: { code: "V2", title: "Alertas da Frota", subtitle: "Tudo o que precisa de atenção: seguros, documentos, manutenção, cartas de condução, ocorrências e abastecimentos anómalos." },
  viatura: { code: "", title: "Viatura", subtitle: "Tudo o que diz respeito a esta viatura: painel, novos registos, histórico e ficha." },
  viaturas: { code: "", title: "Viaturas e Equipamentos", subtitle: "Clique numa viatura para ver tudo o que lhe diz respeito: painel, abastecimentos, manutenções, ocorrências, documentos, custos, fotografias e motoristas." },
  motoristas: { code: "V4", title: "Motoristas", subtitle: "Condutores e operadores, com fotografia. A carta fica a laranja 60 dias antes de caducar." },
  abastecimentos: { code: "V5", title: "Abastecimentos", subtitle: "Combustível por viatura, com o percurso, o consumo e as anomalias (km abaixo do anterior, consumo fora da referência)." },
  manutencoes: { code: "V6", title: "Manutenções e Reparações", subtitle: "Intervenções nas viaturas: preventivas, correctivas e reparações, com o custo." },
  planos: { code: "V7", title: "Planos Preventivos", subtitle: "Os planos de manutenção de cada viatura, por km / horas ou por meses, e quando vence o próximo." },
  ocorrencias: { code: "V8", title: "Ocorrências e Acidentes", subtitle: "Avarias, acidentes, multas e outras ocorrências, do registo ao fecho." },
  documentos: { code: "V9", title: "Documentos", subtitle: "Livrete, inspecção, taxa de circulação e outros documentos de cada viatura, com a validade." },
  seguros: { code: "V10", title: "Seguros", subtitle: "Apólices de seguro da frota. As que expiram nos próximos 30 dias ficam a laranja; as expiradas a vermelho." },
  configuracoes: { code: "", title: "Configurações da Frota", subtitle: "Tudo o que é preciso criar e registar para a frota funcionar: motoristas, seguros, planos preventivos, tipologias, documentos, oficinas e responsáveis." },
  custos: { code: "V13", title: "Custos por Viatura", subtitle: "Quanto custa cada viatura: combustível, manutenção, ocorrências e documentos." },
  // Oficina (protótipo v667): ordens de trabalho
  oficina: { oficina: true, title: "Oficina", subtitle: "Calendário da oficina: pedidos da frota por aceitar, trabalhos marcados e viaturas na oficina. Arraste um cartão para reagendar." },
  ordens: { oficina: true, title: "Ordens de Trabalho", subtitle: "Todas as ordens da oficina, com o ponto de situação." },
  material: { oficina: true, title: "Material da Oficina", subtitle: "Material entregue pela empresa para cada ordem de trabalho: o que já chegou, o que foi aplicado e o que falta." },
  indicadores: { oficina: true, title: "Indicadores da Oficina", subtitle: "Horas por técnico, tempo de reparação e trabalhos no prazo." },
};

(async () => {
  const vista = document.body.dataset.frotaPage;
  const meta = PAGES[vista];
  if (!meta) {
    console.warn("Página da Frota desconhecida:", vista);
    return;
  }
  // A Oficina abre com `oficina:view` (perfil da oficina) ou `frota:view` (quem gere a frota).
  const guards = meta.oficina ? [["oficina", "view"], ["frota", "view"]] : [["frota", "view"]];
  const ok = await initFinancePage({ ...meta, kicker: "Frota", guards });
  if (!ok) return;
  try {
    const mod = await import(meta.oficina ? "./frota/oficina.js" : "./frota/frota.js");
    await mod.render({ ...meta, vista });
  } catch (err) {
    console.error("Falha ao carregar o módulo da Frota:", err);
    renderFinancePlaceholder("financeRoot", meta.title, []);
  }
})();
