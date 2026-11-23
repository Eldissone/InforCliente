/**
 * Colunas das 11 folhas do orçamento — metadados servidos ao ecrã por
 * `GET /budgets/meta`, para o frontend não repetir a lista.
 *
 * Cada coluna é:
 *   { k, l, ty, src?, w?, help? }   campo editável
 *   { calc, l, f? }                  valor calculado (célula a cinzento)
 *
 * ty:  "text" | "num" | "pct" | "date" | "sel" | "combo"
 *      "combo" = lista com escrita livre (para itens que aceitam custo manual)
 * src: de onde vêm as opções de um "sel":
 *   "lists.<nome>"   lista de validação do orçamento (unid, familias, …)
 *   "currencies"     moedas da tabela de câmbios
 *   "barem.<KIND>"   nomes dos baremes desse tipo no snapshot do orçamento
 *   "fixed.<nome>"   lista fixa, porque comanda fórmulas
 * f:   formato do valor calculado — "n0" (por omissão), "n1", "n2", "pct", "txt", "pill"
 */

const { IND_BASES, IND_TYPES, FIN_TYPES, FIN_AUTO_RATE, FIN_AUTO_TERM, RIS_BASES, TIME_UNITS, QTY_SHEET } = require("./calc");

const FIXED_LISTS = {
  simnao: ["Sim", "Não"],
  tempo: TIME_UNITS,
  indTypes: IND_TYPES,
  indBases: IND_BASES,
  finTypes: FIN_TYPES,
  finAutoRate: FIN_AUTO_RATE,
  finAutoTerm: FIN_AUTO_TERM,
  risBases: RIS_BASES,
  matCond: ["Pronto pagamento", "Crédito 30 dias", "Crédito 60 dias", "Crédito 90 dias", "Adiantamento + crédito"],
};

/** A coluna de margem por linha, igual em todas as folhas de custo direto. */
const MARGIN_COLS = [
  { k: "mg", l: "Margem da linha", ty: "pct", help: "Vazio = usa a margem da categoria definida na folha de despacho." },
  { calc: "mga", l: "Margem usada", f: "pct" },
  { calc: "pv", l: "Preço de venda" },
  { calc: "mv", l: "Margem em valor" },
];

const SHEETS = {
  /*
   * Mapa de quantidades — o que se VENDE, não o que custa.
   *
   * É a tabela que vai no contrato: grupo, código, descrição, quantidade,
   * unidade e preço unitário de venda. Não tem margem por linha nem entra no
   * custo total; serve o método de preço «dado pelo cliente», em que o total
   * daqui é o preço de venda e a margem passa a ser o que sobra depois do
   * custo. É também por aqui que entram, sem lhes mexer, as tabelas de
   * quantidades das obras que já existem.
   */
  [QTY_SHEET]: {
    tag: "01",
    title: "Mapa de quantidades",
    sale: true,
    lead:
      "O que se vende ao cliente, aos preços do contrato. Não é custo: não entra no custo total. " +
      "Com a metodologia «Preço dado pelo cliente», o total desta folha é o preço de venda do orçamento " +
      "e a margem passa a ser o que sobra depois de somar os custos. " +
      "O total de cada linha é quantidade × preço unitário, salvo se escrever um total à mão — aí manda esse, " +
      "para o documento bater ao cêntimo com o que foi contratado.",
    cols: [
      { k: "grupo", l: "Grupo", ty: "text", w: 2, help: "Capítulo da tabela: «1 - MÉDIA TENSÃO», «2 - BAIXA TENSÃO»…" },
      { k: "cod", l: "Código", ty: "text" },
      { k: "desc", l: "Descrição", ty: "artigo", w: 4, help: "Escreva e escolha do catálogo para trazer a unidade e o último preço praticado." },
      { k: "un", l: "Un.", ty: "sel", src: "lists.unid" },
      { k: "q", l: "Quantidade", ty: "num" },
      { k: "pu", l: "Preço unit. de venda", ty: "num" },
      { k: "tfix", l: "Total do contrato", ty: "num", help: "Deixe vazio para calcular quantidade × preço. Preencha só quando o contrato fixa um total que não bate com a multiplicação." },
      { calc: "total", l: "Total da linha" },
    ],
  },
  mat: {
    cat: "MAT",
    tag: "03",
    title: "Materiais",
    lead:
      "Materiais comprados para a obra. O custo unitário posto em obra junta ao preço de compra o transporte, " +
      "o frete, o seguro, os direitos e a descarga; a quantidade corrigida acrescenta o desperdício e as perdas. " +
      "Material do cliente entra com custo zero, mas fica registado.",
    cols: [
      { k: "cod", l: "Código", ty: "text" },
      { k: "fam", l: "Família", ty: "sel", src: "lists.familias" },
      { k: "desc", l: "Descrição", ty: "text", w: 3 },
      { k: "un", l: "Un.", ty: "sel", src: "lists.unid" },
      { k: "q", l: "Quantidade", ty: "num" },
      { k: "cli", l: "Do cliente?", ty: "sel", src: "fixed.simnao", help: "Sim = fornecido pelo cliente, custo zero." },
      { k: "preco", l: "Preço unit. de compra", ty: "num" },
      { k: "moeda", l: "Moeda", ty: "sel", src: "currencies" },
      { calc: "cambio", l: "Câmbio", f: "n2" },
      { k: "forn", l: "Fornecedor", ty: "text", w: 2 },
      { k: "cond", l: "Condição de pagamento", ty: "sel", src: "fixed.matCond" },
      { k: "entrega", l: "Prazo de entrega (dias)", ty: "num" },
      { k: "tr", l: "Transporte %", ty: "pct" },
      { k: "fr", l: "Frete %", ty: "pct" },
      { k: "seg", l: "Seguro %", ty: "pct" },
      { k: "tax", l: "Direitos e taxas %", ty: "pct" },
      { k: "dsc", l: "Descarga %", ty: "pct" },
      { k: "desp", l: "Desperdício %", ty: "pct" },
      { k: "perd", l: "Perdas %", ty: "pct" },
      { k: "obs", l: "Observações", ty: "text", w: 2 },
      { calc: "qc", l: "Qtd. corrigida", f: "n2" },
      { calc: "cu", l: "Custo unit. posto em obra", f: "n2" },
      { calc: "ct", l: "Custo total" },
      ...MARGIN_COLS,
      { calc: "exp", l: "Exposição cambial" },
    ],
  },

  rh: {
    cat: "RH",
    tag: "04",
    title: "Recursos humanos",
    lead:
      "Pessoal da obra. O custo/hora com encargos vem do barém de recursos humanos pela função. " +
      "Alimentação e transporte contam por pessoa e por dia; o alojamento só para quem está deslocado.",
    cols: [
      { k: "funcao", l: "Função", ty: "sel", src: "barem.RH" },
      { k: "n", l: "N.º de pessoas", ty: "num" },
      { k: "h", l: "Horas/dia", ty: "num" },
      { k: "d", l: "Dias", ty: "num" },
      { k: "ini", l: "Início (opcional)", ty: "date" },
      { k: "desloc", l: "Deslocado", ty: "sel", src: "fixed.simnao" },
      { calc: "ch", l: "Custo/hora", f: "n2" },
      { calc: "cd", l: "Custo/dia", f: "n2" },
      { calc: "alim", l: "Alimentação" },
      { calc: "aloj", l: "Alojamento" },
      { calc: "transp", l: "Transporte" },
      { k: "outros", l: "Outros", ty: "num" },
      { calc: "ct", l: "Custo total" },
      ...MARGIN_COLS,
      { k: "obs", l: "Observações", ty: "text", w: 2 },
    ],
  },

  eq: {
    cat: "EQ",
    tag: "05",
    title: "Equipamentos",
    lead:
      "Equipamentos da obra. O custo/hora vem do barém; para alugar só nesta obra, escreva o aluguer por dia " +
      "na linha e o barém é ignorado. Mobilização e desmobilização entram uma vez.",
    cols: [
      { k: "equip", l: "Equipamento", ty: "sel", src: "barem.EQUIPAMENTO" },
      { calc: "pa", l: "Próprio / Alugado", f: "txt" },
      { k: "q", l: "Quantidade", ty: "num" },
      { k: "h", l: "Horas/dia", ty: "num" },
      { k: "d", l: "N.º de dias", ty: "num" },
      { k: "ald", l: "Aluguer/dia (nesta linha)", ty: "num", help: "Preenchido, substitui o barém." },
      { calc: "bh", l: "Barém/hora", f: "n2" },
      { calc: "bd", l: "Barém/dia", f: "n2" },
      { k: "mob", l: "Mobilização", ty: "num" },
      { k: "desmob", l: "Desmobilização", ty: "num" },
      { calc: "oper", l: "Operador (incluído)" },
      { calc: "comb", l: "Combustível (incluído)" },
      { k: "outros", l: "Outros custos", ty: "num" },
      { calc: "ct", l: "Custo total" },
      ...MARGIN_COLS,
      { k: "obs", l: "Observações", ty: "text", w: 2 },
    ],
  },

  vi: {
    cat: "VI",
    tag: "06",
    title: "Viaturas",
    lead:
      "Viaturas da obra. Pagam-se por dia (seguro, depreciação, motorista) e por quilómetro " +
      "(combustível, manutenção, pneus). Para alugar só nesta obra, escreva o aluguer por dia na linha.",
    cols: [
      { k: "viat", l: "Viatura", ty: "sel", src: "barem.VIATURA" },
      { k: "q", l: "Quantidade", ty: "num" },
      { k: "d", l: "N.º de dias", ty: "num" },
      { k: "ald", l: "Aluguer/dia (nesta linha)", ty: "num" },
      { k: "km", l: "Km previstos", ty: "num" },
      { calc: "bkm", l: "Barém/km", f: "n2" },
      { calc: "bd", l: "Barém/dia", f: "n2" },
      { calc: "comb", l: "Combustível (incluído)" },
      { calc: "mot", l: "Motorista (incluído)" },
      { calc: "man", l: "Manutenção (incluída)" },
      { k: "outros", l: "Outros", ty: "num" },
      { calc: "ct", l: "Custo total" },
      ...MARGIN_COLS,
      { k: "obs", l: "Observações", ty: "text", w: 2 },
    ],
  },

  fe: {
    cat: "FE",
    tag: "07",
    title: "Ferramentas e consumíveis",
    lead:
      "Ferramentas e consumíveis. As de unidade «dia» multiplicam pelos dias de uso; as de unidade «un» " +
      "contam por unidade. Sem barém, escreva o custo à mão — a linha fica marcada como «Sem barém».",
    cols: [
      { k: "item", l: "Item", ty: "combo", src: "barem.FERRAMENTA", w: 3, help: "Escolha do barém ou escreva um item novo e preencha o custo manual." },
      { calc: "tipo", l: "Tipo", f: "txt" },
      { calc: "un", l: "Unidade", f: "txt" },
      { k: "q", l: "Quantidade", ty: "num" },
      { k: "dias", l: "Dias", ty: "num" },
      { k: "manual", l: "Custo manual (sem barém)", ty: "num" },
      { calc: "barem", l: "Barém", f: "n2" },
      { calc: "ct", l: "Custo total" },
      ...MARGIN_COLS,
      { k: "obs", l: "Observações", ty: "text", w: 2 },
    ],
  },

  sub: {
    cat: "SUB",
    tag: "08",
    title: "Subempreitadas",
    lead:
      "Trabalho entregue a terceiros. Os impostos aplicam-se ao valor mais a mobilização; a contingência " +
      "específica aplica-se só ao valor do serviço.",
    cols: [
      { k: "sub", l: "Subempreiteiro", ty: "text", w: 2 },
      { k: "desc", l: "Descrição do serviço", ty: "text", w: 3 },
      { k: "un", l: "Un.", ty: "sel", src: "lists.unid" },
      { k: "q", l: "Quantidade", ty: "num" },
      { k: "pu", l: "Preço unitário", ty: "num" },
      { calc: "valor", l: "Valor" },
      { k: "mob", l: "Mobilização", ty: "num" },
      { k: "imp", l: "Impostos %", ty: "pct" },
      { k: "outros", l: "Outros custos", ty: "num" },
      { k: "cont", l: "Contingência específica %", ty: "pct" },
      { k: "obs", l: "Observações", ty: "text", w: 2 },
      { calc: "ct", l: "Custo total" },
      ...MARGIN_COLS,
    ],
  },

  log: {
    cat: "LOG",
    tag: "09",
    title: "Logística e estaleiro",
    lead:
      "Estaleiro, transportes, alojamento, água, energia e afins. O custo unitário vem do barém de logística; " +
      "os itens ligados a um combustível seguem sempre a tabela de combustíveis.",
    cols: [
      { k: "item", l: "Item", ty: "combo", src: "barem.LOGISTICA", w: 2, help: "Escolha do barém ou escreva um item novo e preencha o custo manual." },
      { k: "descr", l: "Descrição / observação", ty: "text", w: 2 },
      { calc: "un", l: "Unidade", f: "txt" },
      { k: "q", l: "Quantidade", ty: "num" },
      { k: "dias", l: "Dias / períodos", ty: "num", help: "Vazio conta como 1 período." },
      { k: "manual", l: "Custo manual (sem barém)", ty: "num" },
      { calc: "barem", l: "Barém", f: "n2" },
      { calc: "ct", l: "Custo total" },
      ...MARGIN_COLS,
    ],
  },

  eng: {
    cat: "ENG",
    tag: "10",
    title: "Engenharia e gestão",
    lead:
      "Quem gere a obra sem estar numa tarefa: direção, engenharia, planeamento, qualidade, HSE, administrativo. " +
      "O custo unitário é o custo real do barém de recursos humanos, convertido para a unidade de tempo escolhida. " +
      "A dedicação diz que fração do tempo da pessoa é desta obra.",
    cols: [
      { k: "area", l: "Área", ty: "text", w: 2 },
      { k: "rec", l: "Recurso (barém de RH)", ty: "sel", src: "barem.RH" },
      { k: "ut", l: "Unidade de tempo", ty: "sel", src: "fixed.tempo" },
      { k: "n", l: "N.º de pessoas", ty: "num" },
      { k: "q", l: "Quantidade", ty: "num" },
      { k: "ded", l: "% de dedicação", ty: "pct", help: "Vazio conta como 100%." },
      { calc: "cu", l: "Custo unitário", f: "n2" },
      { calc: "ct", l: "Custo total" },
      ...MARGIN_COLS,
    ],
  },

  ind: {
    cat: "IND",
    tag: "12",
    title: "Estrutura e sede",
    lead:
      "O que a sede custa a esta obra: administração, financeiro, RH, compras, TI, escritório, seguros gerais. " +
      "Pode ser uma percentagem de uma base de incidência ou um valor fixo.",
    cols: [
      { k: "rub", l: "Rubrica", ty: "text", w: 2 },
      { k: "tipo", l: "Tipo", ty: "sel", src: "fixed.indTypes" },
      { k: "fixo", l: "Valor fixo", ty: "num" },
      { k: "pct", l: "Percentagem", ty: "pct" },
      { k: "base", l: "Base de incidência", ty: "sel", src: "fixed.indBases" },
      { calc: "vb", l: "Valor da base" },
      { calc: "custo", l: "Custo" },
      { k: "obs", l: "Observações", ty: "text", w: 2 },
    ],
  },

  fin: {
    cat: "FIN",
    tag: "11",
    title: "Garantias, seguros e financiamento",
    lead:
      "Garantias bancárias, cauções, retenções e o custo do dinheiro. A comissão sobre o contrato aplica-se " +
      "ao preço de venda estimado; os juros do fundo de maneio à diferença entre o prazo de recebimento e o de " +
      "pagamento. A taxa e o prazo podem ser automáticos.",
    cols: [
      { k: "item", l: "Item", ty: "text", w: 3 },
      { k: "tipo", l: "Tipo de cálculo", ty: "sel", src: "fixed.finTypes" },
      { k: "pct", l: "% do contrato abrangido", ty: "pct" },
      { k: "taxa", l: "Taxa anual % (manual)", ty: "pct" },
      { k: "taxaAuto", l: "Taxa automática", ty: "sel", src: "fixed.finAutoRate" },
      { calc: "taxa", l: "Taxa usada", f: "pct" },
      { k: "prazo", l: "Prazo em meses (manual)", ty: "num" },
      { k: "prazoAuto", l: "Prazo automático", ty: "sel", src: "fixed.finAutoTerm" },
      { calc: "prazo", l: "Prazo usado", f: "n0" },
      { k: "fixo", l: "Valor fixo", ty: "num" },
      { calc: "base", l: "Base de cálculo" },
      { calc: "custo", l: "Custo" },
      { k: "obs", l: "Observações", ty: "text", w: 2 },
    ],
  },

  ris: {
    cat: "RIS",
    tag: "13",
    title: "Riscos e contingências",
    lead:
      "O que pode correr mal e quanto custaria. A contingência recomendada é a probabilidade vezes o valor " +
      "potencial; pode aceitar-se a recomendada ou escrever outra. O nível de risco cruza a probabilidade " +
      "com o peso do impacto.",
    cols: [
      { k: "n", l: "N.º", ty: "num" },
      { k: "desc", l: "Descrição", ty: "text", w: 2 },
      { k: "cat", l: "Categoria", ty: "sel", src: "lists.catRisco" },
      { k: "prob", l: "Probabilidade", ty: "pct" },
      { k: "imp", l: "Impacto", ty: "sel", src: "lists.impacto" },
      { k: "vbase", l: "Valor potencial: base", ty: "sel", src: "fixed.risBases" },
      { k: "fator", l: "Fator (× base)", ty: "num" },
      { k: "manual", l: "Valor manual", ty: "num" },
      { calc: "valor", l: "Valor potencial" },
      { calc: "rec", l: "Contingência recomendada" },
      { k: "aplicada", l: "Contingência aplicada", ty: "num", help: "Vazio = aceita a recomendada." },
      { calc: "cons", l: "Contingência considerada" },
      { calc: "nivel", l: "Nível de risco", f: "pill" },
      { k: "mit", l: "Mitigação / resposta", ty: "text", w: 3 },
    ],
  },
};

/** Linhas por omissão de um orçamento novo (as folhas diretas começam vazias). */
const DEFAULT_ROWS = {
  ind: [
    { rub: "Administração", tipo: "Percentagem", pct: 0.02, base: "Custo direto" },
    { rub: "Financeiro", tipo: "Percentagem", pct: 0.005, base: "Custo direto" },
    { rub: "Recursos humanos", tipo: "Percentagem", pct: 0.005, base: "Mão de obra (RH + Engenharia)" },
    { rub: "Compras", tipo: "Percentagem", pct: 0.005, base: "Materiais" },
    { rub: "Informática", tipo: "Percentagem", pct: 0.003, base: "Custo direto" },
    { rub: "Contabilidade", tipo: "Percentagem", pct: 0.003, base: "Custo direto" },
    { rub: "Seguros gerais", tipo: "Percentagem", pct: 0.004, base: "Custo direto" },
    { rub: "Outros", tipo: "Percentagem", pct: 0.003, base: "Custo direto" },
  ],
  fin: [
    { item: "Garantia bancária (proposta)", tipo: "Comissão s/ contrato", pct: 0.05, taxa: 0.025, prazo: 3, obs: "5% do contrato durante o concurso" },
    { item: "Garantia de boa execução", tipo: "Comissão s/ contrato", pct: 0.1, taxa: 0.025, prazoAuto: "Duração + 12", obs: "Até à receção definitiva" },
    { item: "Caução (garantia de adiantamento)", tipo: "Comissão s/ contrato", pct: 0.15, taxa: 0.025, prazoAuto: "Duração" },
    { item: "Retenção (custo de oportunidade)", tipo: "Comissão s/ contrato", pct: 0.05, taxaAuto: "Taxa de juro", prazo: 12 },
    { item: "Juros do fundo de maneio", tipo: "Juros s/ fundo de maneio", taxaAuto: "Taxa de juro", prazoAuto: "Duração" },
    { item: "Seguros financeiros (crédito, caução)", tipo: "% s/ custo direto", taxa: 0.003 },
    { item: "Custos bancários", tipo: "Valor fixo", fixo: 0 },
  ],
  ris: [
    { n: 1, desc: "Variação cambial", cat: "Cambial", prob: 0.5, imp: "Alto", vbase: "Exposição cambial", fator: 0.1, mit: "Comprar divisas cedo; cláusula de revisão cambial" },
    { n: 2, desc: "Inflação", cat: "Mercado/preços", prob: 0.5, imp: "Médio", vbase: "Custo direto", fator: 0.03, mit: "Fórmula de revisão de preços" },
    { n: 3, desc: "Aumento do preço dos materiais", cat: "Mercado/preços", prob: 0.3, imp: "Médio", vbase: "Materiais", fator: 0.05, mit: "Fechar preços com fornecedores" },
    { n: 4, desc: "Chuva", cat: "Clima", prob: 0.5, imp: "Médio", vbase: "Custo por dia de obra", fator: 10, mit: "Planear trabalhos de vala fora da época das chuvas" },
    { n: 5, desc: "Atrasos", cat: "Prazo", prob: 0.3, imp: "Alto", vbase: "Custo por dia de obra", fator: 20, mit: "Planeamento semanal com folgas" },
    { n: 6, desc: "Avarias de equipamento", cat: "Equipamentos", prob: 0.25, imp: "Médio", vbase: "Equipamentos", fator: 0.15, mit: "Manutenção preventiva" },
    { n: 7, desc: "Improdutividade", cat: "Produtividade", prob: 0.3, imp: "Médio", vbase: "Recursos humanos", fator: 0.08, mit: "Supervisão e metas diárias" },
    { n: 8, desc: "Retrabalho", cat: "Qualidade", prob: 0.2, imp: "Médio", vbase: "Custo direto", fator: 0.01, mit: "Plano de inspeção e ensaio" },
    { n: 9, desc: "Perdas e roubos", cat: "Logística", prob: 0.2, imp: "Baixo", vbase: "Materiais", fator: 0.01, mit: "Controlo de armazém" },
    { n: 10, desc: "Alteração de âmbito", cat: "Âmbito/contrato", prob: 0.15, imp: "Alto", vbase: "Custo direto", fator: 0.05, mit: "Trabalhos a mais sempre por escrito" },
  ],
};

/** O mapa de quantidades arranca vazio: enche-se à mão ou importa-se de uma obra. */
DEFAULT_ROWS[QTY_SHEET] = [];

/** Margens de arranque por categoria (as do exemplo do protótipo). */
const DEFAULT_MARGINS = {
  MAT: 0.15,
  RH: 0.4,
  EQ: 0.35,
  VI: 0.25,
  FE: 0.25,
  SUB: 0.2,
  LOG: 0.2,
  ENG: 0.4,
  FIN: 0,
  IND: 0,
  RIS: 0,
};

/** Impactos e pesos, usados no nível de risco. */
const DEFAULT_IMPACTS = [
  { nome: "Baixo", peso: 1 },
  { nome: "Médio", peso: 2 },
  { nome: "Alto", peso: 3 },
  { nome: "Muito alto", peso: 4 },
];

module.exports = { SHEETS, FIXED_LISTS, DEFAULT_ROWS, DEFAULT_MARGINS, DEFAULT_IMPACTS, MARGIN_COLS };
