/**
 * A IA que redige os textos da Proposta Técnica e Comercial.
 *
 * São as três funções de texto do protótipo (§8.2.C do plano):
 *   - `memoria`  → a memória descritiva e justificativa (introdução + pontos);
 *   - `textos`   → objectivo, documentação de referência, introdução e fases
 *                  das condições técnicas, e o texto do traçado;
 *   - `bloco`    → um bloco de texto novo para qualquer secção, a partir de um
 *                  pedido escrito.
 *
 * ⚠️ **Nunca vão custos nem margens no contexto.** O que o cliente lê é a
 * solução técnica, não a estrutura de custo da empresa — é a regra do protótipo
 * e é a que faz sentido: basta um parágrafo com a margem lá dentro para a
 * proposta deixar de poder ser enviada.
 *
 * A IA **propõe**: devolve o texto, não grava nada. Quem decide é quem assina a
 * proposta.
 */

const { generate } = require("../ai/client");
const { PROPOSAL_STANDARD } = require("./standard");

/** A funcionalidade no catálogo da Gestão do Sistema. */
const FEATURE = "proposal_texts";

/**
 * As categorias de dados que o contexto leva.
 *
 * `budget` cobre o que vai no prompt: a obra, o prazo e as **quantidades e
 * descrições** dos materiais e dos serviços do orçamento. Preços, custos e
 * margens não vão — ver `buildContext`.
 */
const CATEGORIES = ["budget"];

const TAREFAS = ["memoria", "textos", "bloco"];

const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** As secções da proposta, para o pedido de um bloco dizer onde entra. */
const ZONAS = {
  objectivo: "Objectivo e documentação de referência",
  memoria: "Memória descritiva",
  condicoes: "Condições técnicas",
  quadro: "Quadro resumo",
  tracado: "Traçado de execução",
  cronograma: "Cronograma de execução",
  equipamentos: "Meios e equipamentos",
  organograma: "Organização da obra",
  execucao: "Execução dos trabalhos",
  qsa: "Qualidade, segurança, ambiente e exclusões",
  comercial: "Condições comerciais",
  financeiro: "Cronograma financeiro",
  anexos: "Anexos",
};

/**
 * O contexto que vai em todos os pedidos.
 *
 * Leva a obra, o cliente, o local, os lotes, o prazo, **os principais materiais
 * com as suas quantidades** e os serviços subcontratados — o que é preciso para
 * descrever a solução. Não leva preços, custos, margens nem o valor da proposta.
 *
 * @param {object[]} budgets os orçamentos da proposta
 * @param {object} doc o documento, para a IA não repetir o que já lá está
 */
function buildContext(budgets, doc) {
  const lista = (Array.isArray(budgets) ? budgets : [budgets]).filter(Boolean);
  const P = (lista[0] || {}).params || {};
  const empresa = doc?.empresa?.nome || PROPOSAL_STANDARD.empresa.nome;

  /**
   * Sem repetidos e sem exageros.
   *
   * Um mapa de quantidades de uma obra grande tem centenas de linhas, muitas
   * iguais em localidades diferentes. Mandá-las todas enche o pedido, torna-o
   * lento e não acrescenta nada: para descrever a solução bastam as primeiras.
   */
  const distintas = (linhas, max) => [...new Set(linhas)].slice(0, max);

  const materiais = distintas(
    lista.flatMap((b) =>
      ((b.sheets || {}).mat || [])
        .filter((m) => m.desc)
        .map((m) => `- ${m.desc}${N(m.q) ? ` (${N(m.q)} ${m.un || "un"})` : ""}`)
    ),
    25
  );

  // Sem folhas de custo preenchidas, o mapa de quantidades é que descreve a obra.
  const mapa = distintas(
    lista.flatMap((b) =>
      ((b.sheets || {}).qt || [])
        .filter((l) => l.desc)
        .map((l) => `- ${l.desc}${N(l.q) ? ` (${N(l.q)} ${l.un || "un"})` : ""}${l.grupo ? ` [${l.grupo}]` : ""}`)
    ),
    30
  );

  const subs = lista
    .flatMap((b) => ((b.sheets || {}).sub || []).filter((s) => s.desc || s.sub).map((s) => `- ${s.desc || s.sub}`))
    .slice(0, 20);

  const lotes = (doc?.comercial?.lotes || []).map((l) => l.nome).filter(Boolean);

  return [
    `Empresa: ${empresa} (Angola), obras de redes eléctricas MT/BT e postos de transformação.`,
    `Obra: ${doc?.obra?.titulo || P.obra || ""}`,
    `Cliente: ${doc?.cliente?.nome || P.cliente || ""}`,
    `Local: ${doc?.obra?.localizacao || P.local || ""}`,
    lotes.length > 1 ? `Lotes: ${lotes.join(", ")}` : "",
    P.inicio && P.fim ? `Prazo: ${P.inicio} a ${P.fim}` : "",
    doc?.sintese?.prazo ? `Duração: ${doc.sintese.prazo}` : "",
    materiais.length ? `Principais materiais:\n${materiais.join("\n")}` : "",
    mapa.length ? `Trabalhos do mapa de quantidades:\n${mapa.join("\n")}` : "",
    subs.length ? `Serviços subcontratados:\n${subs.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const REGRAS = [
  "Escreve em português de Portugal/Angola, tom técnico e formal, frases claras.",
  "Usa só os dados fornecidos. Não inventes quantidades, marcas, normas específicas nem certificações; podes referir de forma genérica «a regulamentação angolana aplicável e as normas da concessionária».",
  "NÃO menciones custos, preços, margens nem o valor da proposta.",
  "Podes usar <b>…</b> para destacar 1 a 3 expressões por parágrafo.",
].join("\n");

/** O pedido de cada tarefa: o que se pede e o formato da resposta. */
function buildPrompt(tarefa, ctx, { zona, pedido, doc } = {}) {
  const cabeca = `És o diretor técnico da ${doc?.empresa?.nome || PROPOSAL_STANDARD.empresa.nome}.`;

  if (tarefa === "memoria") {
    const fotos = (doc?.memoria?.fotos || [])
      .map((f, i) => `Fotografia ${i + 1}: ${f.legenda || "(sem legenda)"}`)
      .join("\n");
    return `${cabeca} Redige a MEMÓRIA DESCRITIVA E JUSTIFICATIVA de uma Proposta Técnica e Comercial.
${REGRAS}

${ctx}
${fotos ? `\nFotografias já anexadas:\n${fotos}` : ""}

Responde APENAS com JSON, neste formato:
{"texto":"parágrafo de introdução","seccoes":[{"titulo":"Enquadramento e descrição geral do projecto","texto":"1-2 parágrafos separados por linha em branco"},{"titulo":"Descrição da solução técnica","texto":"2-4 parágrafos: rede MT, postos de transformação, rede BT, iluminação, conforme os dados"},{"titulo":"Justificação das soluções adoptadas","texto":"1-2 parágrafos"},{"titulo":"Normas e regulamentos aplicáveis","texto":"1 parágrafo"}]}`;
  }

  if (tarefa === "textos") {
    return `${cabeca} Redige os textos técnicos de uma Proposta Técnica e Comercial.
${REGRAS}

${ctx}

Responde APENAS com JSON, neste formato:
{"objectivo":"1 parágrafo","documentacao_referencia":"1 parágrafo curto","introducao":"1 parágrafo sobre a forma de execução","fases":[{"titulo":"Fase I – …","texto":"1 parágrafo"}],"tracado_texto":"1 parágrafo (ou vazio se não se aplicar)"}`;
  }

  // bloco
  return `${cabeca} Redige um bloco de texto para a secção "${ZONAS[zona] || zona}" de uma Proposta Técnica e Comercial.
${REGRAS}

Pedido de quem está a escrever a proposta: ${pedido}

${ctx}

Responde APENAS com JSON, neste formato:
{"titulo":"título curto do bloco (ou vazio)","texto":"1 a 4 parágrafos, separados por linha em branco"}`;
}

/**
 * Lê o JSON da resposta, tolerando as cercas de código que alguns modelos põem.
 *
 * Resposta **vazia** e resposta **ilegível** são coisas diferentes e dizem-se
 * de maneira diferente: a primeira é o fornecedor sobrecarregado ou a recusar,
 * e volta a correr bem daqui a pouco; a segunda é o modelo a responder fora do
 * formato, e vale a pena tentar outra vez já.
 */
function parseJson(text) {
  const limpo = String(text || "")
    .replace(/^```(json)?/i, "")
    .replace(/```$/, "")
    .trim();
  if (!limpo) {
    throw Object.assign(new Error("A IA não respondeu. Tente de novo dentro de momentos."), {
      status: 503,
      code: "IA_SEM_RESPOSTA",
    });
  }
  try {
    return JSON.parse(limpo);
  } catch {
    throw Object.assign(new Error("A IA respondeu fora do formato esperado. Tente de novo."), {
      status: 502,
      code: "IA_RESPOSTA_INVALIDA",
    });
  }
}

/** Dá forma ao que vem da IA, para o documento nunca receber lixo. */
function shape(tarefa, raw) {
  const txt = (v, max = 6000) => String(v ?? "").trim().slice(0, max);
  if (tarefa === "memoria") {
    const seccoes = Array.isArray(raw.seccoes) ? raw.seccoes : [];
    if (!seccoes.length) throw Object.assign(new Error("A IA não devolveu a memória descritiva."), { status: 502 });
    return {
      texto: txt(raw.texto, 2000),
      seccoes: seccoes.slice(0, 8).map((s) => ({ titulo: txt(s.titulo, 200), texto: txt(s.texto) })),
    };
  }
  if (tarefa === "textos") {
    return {
      objectivo: txt(raw.objectivo, 2000),
      documentacao_referencia: txt(raw.documentacao_referencia, 2000),
      introducao: txt(raw.introducao, 2000),
      fases: (Array.isArray(raw.fases) ? raw.fases : []).slice(0, 8).map((f) => ({ titulo: txt(f.titulo, 200), texto: txt(f.texto) })),
      tracado_texto: txt(raw.tracado_texto, 2000),
    };
  }
  return { titulo: txt(raw.titulo, 200), texto: txt(raw.texto) };
}

/**
 * Pede à IA o texto de uma das três tarefas.
 *
 * @returns {Promise<{tarefa:string, resultado:object, model:string}>}
 */
async function writeText({ tarefa, budgets, doc, zona, pedido, userId, io }) {
  if (!TAREFAS.includes(tarefa)) throw Object.assign(new Error("Tarefa desconhecida."), { status: 400 });
  if (tarefa === "bloco" && !String(pedido || "").trim()) {
    throw Object.assign(new Error("Escreva o que quer que a IA redija."), { status: 400 });
  }

  const ctx = buildContext(budgets, doc);
  const res = await generate({
    feature: FEATURE,
    userId,
    categories: CATEGORIES,
    projectIds: [],
    prompt: buildPrompt(tarefa, ctx, { zona, pedido: String(pedido || "").slice(0, 1000), doc }),
    json: true,
    maxOutputTokens: 4000,
    timeoutMs: 60_000,
    io,
  });

  return { tarefa, resultado: shape(tarefa, parseJson(res.text)), model: res.model };
}

/**
 * Onde é que cada tarefa escreve no documento.
 *
 * Fica aqui, e não no ecrã, para o servidor e o ecrã concordarem sobre o que a
 * IA mexe — e para se poder testar sem navegador.
 */
function applyToDocument(doc, tarefa, resultado, { zona = "anexos" } = {}) {
  const D = doc;
  if (tarefa === "memoria") {
    D.memoria = D.memoria || { texto: "", seccoes: [], fotos: [] };
    if (resultado.texto) D.memoria.texto = resultado.texto;
    D.memoria.seccoes = resultado.seccoes;
    return ["memoria.texto", "memoria.seccoes"];
  }
  if (tarefa === "textos") {
    const tocados = [];
    if (resultado.objectivo) {
      D.objectivo = resultado.objectivo;
      tocados.push("objectivo");
    }
    if (resultado.documentacao_referencia) {
      D.documentacao_referencia = resultado.documentacao_referencia;
      tocados.push("documentacao_referencia");
    }
    D.condicoes_tecnicas = D.condicoes_tecnicas || { introducao: "", fases: [] };
    if (resultado.introducao) {
      D.condicoes_tecnicas.introducao = resultado.introducao;
      tocados.push("condicoes_tecnicas.introducao");
    }
    if (resultado.fases.length) {
      D.condicoes_tecnicas.fases = resultado.fases;
      tocados.push("condicoes_tecnicas.fases");
    }
    // O traçado só se escreve se a secção existir ou se houver texto para ela:
    // criar uma secção vazia fazia aparecer um capítulo em branco na proposta.
    if (resultado.tracado_texto) {
      D.tracado = D.tracado || { texto: "", criterios: [], mapas: [] };
      D.tracado.texto = resultado.tracado_texto;
      tocados.push("tracado.texto");
    }
    return tocados;
  }
  // bloco: entra como anexo da zona, para não substituir nada do que lá está
  D.extras = Array.isArray(D.extras) ? D.extras : [];
  D.extras.push({ zona, tipo: "texto", titulo: resultado.titulo, texto: resultado.texto });
  return ["extras"];
}

module.exports = { FEATURE, CATEGORIES, TAREFAS, ZONAS, buildContext, buildPrompt, shape, parseJson, writeText, applyToDocument };
