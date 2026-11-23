/**
 * «? Dúvidas» — o assistente da página, como no protótipo (`helpAsk`).
 *
 * Explica o FUNCIONAMENTO do ecrã em que o utilizador está: para que serve, o
 * que se preenche, de onde vêm os valores e para onde vão, que erros evitar.
 *
 * Diferença deliberada do protótipo: o protótipo manda ao modelo o texto todo
 * do ecrã, com os valores. Aqui o ecrã manda só a **estrutura** — títulos,
 * colunas, botões, filtros e notas —, já sem números. Para explicar como uma
 * página funciona não é preciso saber quanto deve um cliente, e assim a ajuda
 * não precisa de nenhuma das categorias de dados da Gestão do Sistema.
 */

const FEATURE = "page_help";

const PROGRAMA = `O Info Gestor é o programa de gestão da MBT Energia, empresa angolana de obras elétricas de média e baixa tensão (redes MT/BT, postos de transformação, iluminação pública).

Áreas e ecrãs principais:
- Comercial: orçamentos (mapa de quantidades → custos diretos por folha: materiais, recursos humanos, equipamentos, viaturas, ferramentas, subempreitadas, logística, engenharia → custos indiretos → margens na folha de despacho → preço de venda → proposta ao cliente → adjudicação, que cria a obra e o centro de custo).
- Financeiro: Painel (F0), Calendário Financeiro (F1), Mapa de Fluxos (F2), Previsto × Realizado (F3); Contas a Pagar (P1 Centro de Pagamentos, P2 Calendário de Pagamentos, P3 Despesas sem Comprovativo); Contas a Receber (R1 Centro de Recebimentos, R2, R3 Autos de Medição, R4 Conta Corrente de Clientes); Tesouraria (T1 Contas e Saldos, T3 Extratos e Conciliação, T4 Previsão, T8 Mapa de Fluxo de Caixa); Análise de Custos (A1); Controlo de Obras (O1–O5); Registos (RG8 Centros de Custo).
- Pedidos de pagamento: criam-se, aprovam-se, pagam-se e confirmam-se no Centro de Pagamentos; o valor é base + IVA − retenção.
- Uma moeda de cada vez: valores em moedas diferentes nunca se somam; não se convertem pelo câmbio de hoje.
- Cores dos campos no Comercial: amarelo = escreve-se à mão; azul = escolhe-se de uma lista; cinzento = calculado.`;

const SYSTEM =
  "És o assistente de ajuda do Info Gestor (MBT Energia). Explicas o FUNCIONAMENTO do programa a quem o está a usar, " +
  "em português de Portugal, claro e curto. Respondes só sobre o ecrã e o programa; se não souberes, dizes que não sabes " +
  "em vez de inventar. Não inventas números nem dados: o ecrã que recebes vem sem valores, de propósito.";

/** Tira números e valores do texto do ecrã (defesa em profundidade: o ecrã já os tira). */
function semValores(texto) {
  return String(texto || "")
    .replace(/[-+]?\d[\d\s.,]*\d(?:\s?%)?/g, "…")
    .replace(/[-+]?\d(?:\s?%)?/g, "…")
    .replace(/(…\s*){2,}/g, "… ")
    .slice(0, 6000);
}

/**
 * @param {object} o
 * @param {{codigo?:string, titulo:string, lead?:string, area?:string}} o.pagina
 * @param {string} o.estrutura títulos, colunas, botões e notas do ecrã
 * @param {string} o.pergunta
 * @param {Array<{r:"u"|"a", t:string}>} [o.historico]
 */
function buildPrompt({ pagina, estrutura, pergunta, historico = [] }) {
  const conv = historico
    .slice(-6)
    .map((m) => `${m.r === "u" ? "Utilizador" : "Assistente"}: ${String(m.t || "").slice(0, 800)}`)
    .join("\n\n");
  return [
    PROGRAMA,
    "",
    `Ecrã atual: ${[pagina.codigo, pagina.titulo].filter(Boolean).join(" · ")}${pagina.area ? ` (área ${pagina.area})` : ""}`,
    pagina.lead ? `Descrição do ecrã: ${semValores(pagina.lead)}` : "",
    "",
    "Estrutura do ecrã (sem valores):",
    semValores(estrutura),
    conv ? `\nConversa até agora:\n${conv}` : "",
    "",
    `Pergunta: ${String(pergunta).slice(0, 1000)}`,
    "",
    "Responde em poucos parágrafos ou numa lista curta. Se a pergunta for sobre valores concretos, explica de onde vêm e onde se vêem, sem os inventar.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

module.exports = { FEATURE, SYSTEM, buildPrompt, semValores };
