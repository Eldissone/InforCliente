/**
 * O assistente de baremes: descreve-se o recurso por palavras, a IA calcula.
 *
 * É o `aiCalc` / `aiAsk` do protótipo (§8.2.A do plano) e o ponto 6.8 do
 * roadmap. Duas diferenças, as duas por a casa já ter o que o protótipo
 * repetia à mão:
 *
 *  - **os campos saem do `BAREM_FIELDS`**, que é onde já estão definidos para o
 *    formulário: quem acrescentar um campo a um tipo de barem vê-o aparecer no
 *    pedido à IA sem mexer aqui;
 *  - **as fórmulas no pedido descrevem o `computeBaremCost`**, que é o cálculo
 *    verdadeiro. Se a IA calculasse por outra fórmula, o valor que ela
 *    propusesse não daria o mesmo que o programa mostra a seguir.
 *
 * A IA **propõe**: devolve os campos, a conta que fez em cada um, o que teve de
 * assumir, perguntas para afinar e um nível de confiança. Quem aplica ao barem
 * é quem está a olhar.
 */

const { generate } = require("../ai/client");
const { BAREM_KINDS, BAREM_KIND_LABELS, BAREM_FIELDS, OWNERSHIP, RENT_UNITS, FE_COST_UNITS, FE_TYPES } = require("./baremCost");

/** A funcionalidade no catálogo da Gestão do Sistema. */
const FEATURE = "barem_assist";

/** O pedido leva custos internos da empresa: salários, preços e consumos. */
const CATEGORIES = ["budget"];

/** Os tipos que o assistente calcula (o combustível é um preço, não se estima). */
const TIPOS = BAREM_KINDS.filter((k) => k !== "COMBUSTIVEL");

/**
 * Como o programa calcula cada tipo — a descrição do `computeBaremCost`.
 *
 * Vai no pedido para a IA preencher os campos de maneira a que a conta dê o que
 * ela própria disse. Sem isto, a IA devolve um «custo/hora» que o programa
 * depois recalcula de outra maneira e dá outro número.
 */
const FORMULAS = {
  RH:
    "Custo diário = Custo mensal ÷ dias úteis por mês. " +
    "Custo real diário = Custo diário × (1 + Encargos sociais) + Seguro/dia + Alimentação/dia + Alojamento/dia + Transporte/dia + Outros/dia. " +
    "Custo/hora com encargos = (Custo diário × (1 + Encargos) + Seguro/dia + Outros/dia) ÷ horas por dia. " +
    "O «Custo mensal» é o salário base mensal; os encargos sociais vão em percentagem (fração).",
  EQUIPAMENTO:
    "Próprio: Custo/hora = Valor de aquisição ÷ Vida útil (h) + Manutenção/h + Lubrificantes/h + Pneus/h + Seguro anual ÷ horas de utilização por ano + Combustível (L/h × preço do litro) + Operador/h + Outros/h. " +
    "Alugado: Custo/hora = Aluguer (se cobrado por hora) ou Aluguer ÷ horas por dia (se por dia), mais Combustível/h, Operador/h e Outros/h. " +
    "O preço do litro vem do barem de combustível do tipo indicado, salvo se se der um preço específico. " +
    "Operador/h: usar o «custo/hora com encargos» do barem de RH correspondente, ou 0 se o aluguer já incluir operador.",
  VIATURA:
    "Custo/km = Consumo (L/100 km) ÷ 100 × preço do litro + Manutenção/km + Pneus/km. " +
    "Custo/dia = (Seguro anual ÷ 12 + Depreciação mensal + Motorista mensal + Outros mensal) ÷ dias úteis por mês. " +
    "Depreciação mensal = (valor de compra − valor residual) ÷ meses de vida útil. " +
    "Pneus/km = custo de um jogo ÷ km de duração. Manutenção/km = custo anual de revisões ÷ km por ano.",
  FERRAMENTA:
    "Unidade «dia» (ferramentas, kits, aparelhos): Custo/dia = Valor de aquisição ÷ Vida útil (dias de trabalho) + Manutenção/dia + Consumíveis/dia. " +
    "Vida útil em dias de trabalho = anos × dias úteis por mês × 12. " +
    "Unidade «un» (consumíveis e EPI): o custo é o preço de compra por unidade, no «Valor de aquisição»; vida útil, manutenção e consumíveis ficam vazios.",
  LOGISTICA:
    "Custo unitário directo por unidade (dia, mês, viagem, vg, litro), a partir de cotações e facturas recentes. " +
    "Na folha de custo: Custo = Quantidade × Dias/períodos × Custo unitário.",
};

/** Um exemplo de descrição, para o ecrã sugerir o que escrever. */
const EXEMPLOS = {
  RH: "Ex.: Eletricista de 1.ª, salário base 440 000 AOA/mês, encargos de 8%, subsídio de alimentação de 2 500 por dia e transporte de 1 000 por dia.",
  EQUIPAMENTO:
    "Ex.: Retroescavadora JCB 3CX própria, comprada em 2021 por 98 000 000 AOA, trabalha cerca de 1 500 h/ano, consome ~8 L/h de gasóleo, manutenção na oficina própria. Ou: Autogrua de 50 t alugada a 650 000 AOA/dia, operador incluído.",
  VIATURA:
    "Ex.: Toyota Hilux 2.8 cabine dupla de 2022, comprada por 32 000 000 AOA, vida útil de 5 anos com valor residual de 20%, faz ~3 000 km/mês em estradas de terra, motorista já contado na folha de RH.",
  FERRAMENTA: "Ex.: Megóhmetro Megger de 5 kV comprado por 1 900 000 AOA, dura cerca de 5 anos, calibração anual de 120 000. Ou: discos de corte de 115 mm a 1 900 AOA cada.",
  LOGISTICA: "Ex.: Aluguer de contentor de 20 pés no Huambo, cotação de 120 000 AOA por mês, transporte de ida e volta incluído.",
};

const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const txt = (v, max = 2000) => String(v ?? "").trim().slice(0, max);

/** Os campos de um tipo, como a IA os deve devolver. */
function fieldsOf(kind) {
  return (BAREM_FIELDS[kind] || []).map((f) => ({
    k: f.k,
    l: f.l,
    ty: f.ty,
    options: f.ty === "sel" ? f.options : f.ty === "fuel" ? ["(nome de um combustível da empresa)"] : null,
    required: Boolean(f.required),
  }));
}

/**
 * O contexto da empresa: o que muda a conta e a IA não pode adivinhar.
 */
function buildContext({ params = {}, fuelPrices = {}, currencies = [], empresa = "a empresa" } = {}) {
  const cambios = (currencies || [])
    .filter((c) => c.moeda && c.cambio)
    .map((c) => `${c.moeda} = ${c.cambio}`)
    .join("; ");
  const combustiveis = Object.entries(fuelPrices || {})
    .map(([nome, preco]) => `${nome} = ${preco}`)
    .join("; ");
  return [
    `Empresa: ${empresa} (Angola), obras de redes eléctricas MT/BT e postos de transformação.`,
    `Data de hoje: ${new Date().toISOString().slice(0, 10)}. Moeda-base: ${params.moedaBase || "AOA"}.`,
    cambios ? `Câmbios em vigor (moeda-base por 1 unidade): ${cambios}.` : "",
    combustiveis ? `Preços de combustível em vigor (por litro): ${combustiveis}.` : "",
    `Dias úteis por mês: ${params.diasMes ?? 22}. Horas de trabalho por dia: ${params.horasDia ?? 8}. Horas de utilização por ano dos equipamentos: ${params.horasAnoEquip ?? 1800}.`,
    '"Barem" = custo interno padrão de um recurso, usado para orçamentar obras.',
  ]
    .filter(Boolean)
    .join("\n");
}

/** O molde da resposta, montado a partir dos campos do tipo. */
function answerShape(kind) {
  const campos = fieldsOf(kind)
    .map((f) => `"${f.k}":${f.ty === "text" || f.ty === "sel" || f.ty === "fuel" ? '"texto"' : f.ty === "pct" ? "0.08" : "número ou null"}`)
    .join(",");
  const extra = kind === "EQUIPAMENTO" ? `,"ownership":"${OWNERSHIP.join(" | ")}"` : kind === "FERRAMENTA" ? `,"unit":"${FE_COST_UNITS.join(" | ")}"` : "";
  return `{"campos":{${campos}${extra}},"explicacoes":{"campo":"a conta feita, com números"},"pressupostos":["..."],"perguntas":["..."],"confianca":"alta | média | baixa","resumo":"uma ou duas frases"}`;
}

/** O pedido de cálculo de um barem. */
function buildPrompt(kind, descricao, { contexto, existentes = [], unidade } = {}) {
  const campos = fieldsOf(kind);
  const listaExistentes = existentes
    .slice(0, 30)
    .map((b) => `- ${b.name}: ${JSON.stringify(b.fields || {})}`)
    .join("\n");

  return `És um técnico sénior de custos e orçamentação. Ajudas a equipa a calcular um BAREM do tipo "${BAREM_KIND_LABELS[kind]}".
${contexto}

COMO O PROGRAMA USA ESTE BAREM
${FORMULAS[kind]}

CAMPOS A PREENCHER
${campos.map((f) => `- ${f.k}: ${f.l}${f.required ? " (obrigatório)" : ""}${f.options ? ` — um de: ${f.options.join(", ")}` : ""}`).join("\n")}
${kind === "EQUIPAMENTO" ? `- ownership: um de ${OWNERSHIP.join(", ")} (próprio ou alugado)\n` : ""}${kind === "FERRAMENTA" ? `- unit: um de ${FE_COST_UNITS.join(", ")} ("dia" para ferramentas e aparelhos, "un" para consumíveis e EPI)\n` : ""}${unidade ? `A unidade escolhida é "${unidade}".\n` : ""}
${listaExistentes ? `BAREMES QUE JÁ EXISTEM DESTE TIPO (para manter coerência de critérios):\n${listaExistentes}\n` : ""}
DESCRIÇÃO DADA PELO UTILIZADOR:
"""${descricao}"""

REGRAS
- Todos os valores monetários em ${"AOA"}. Converte moeda estrangeira com os câmbios indicados e diz que o fizeste.
- Percentagens como fração (0.08 = 8%).
- Usa primeiro os dados do utilizador. O que faltar, estima com referências do mercado angolano e do setor, e diz em "pressupostos" que é estimativa. **Nunca apresentes uma estimativa como valor confirmado.**
- Campos que não se aplicam = null (ex.: aluguer num equipamento próprio).
- Em "explicacoes" mostra a conta de cada campo, com números (ex.: "32 000 000 × 0,8 ÷ 60 meses = 426 667").
- Em "perguntas" põe até 4 perguntas curtas cujas respostas tornariam o barem mais exacto.
- Escreve em português (Portugal/Angola), simples, para pessoal técnico.

Responde APENAS com JSON neste formato:
${answerShape(kind)}`;
}

/** O pedido de uma dúvida: as fórmulas todas, resposta em texto. */
function buildQuestionPrompt(pergunta, { contexto, empresa = "a empresa" } = {}) {
  return `És um técnico sénior de custos e orçamentação. Respondes a dúvidas da equipa de ${empresa} sobre como calcular baremes e custos de obra.
${contexto}

FÓRMULAS QUE O PROGRAMA USA
${TIPOS.map((k) => `- ${BAREM_KIND_LABELS[k]}: ${FORMULAS[k]}`).join("\n")}
- Materiais: Custo posto em obra = Compra × Câmbio × (1 + Transporte + Frete + Seguro + Direitos + Descarga); Quantidade corrigida = Quantidade × (1 + Desperdício + Perdas).

Responde em português (Portugal/Angola), em linguagem simples, com um exemplo numérico quando ajudar. Texto simples, sem tabelas nem formatação pesada. Se depender de valores de mercado, dá uma ordem de grandeza e diz que deve ser confirmada.

DÚVIDA: ${pergunta}`;
}

function parseJson(text) {
  const limpo = String(text || "").replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  if (!limpo) throw Object.assign(new Error("A IA não respondeu. Tente de novo dentro de momentos."), { status: 503, code: "IA_SEM_RESPOSTA" });
  try {
    return JSON.parse(limpo);
  } catch {
    throw Object.assign(new Error("A IA respondeu fora do formato esperado. Tente de novo."), { status: 502, code: "IA_RESPOSTA_INVALIDA" });
  }
}

/**
 * Dá forma à resposta: só os campos que este tipo tem, com o tipo certo.
 *
 * Um campo que a IA invente é deitado fora, e um número que venha como texto
 * («32 000») é lido. O que entra no formulário tem de ser o que o formulário
 * sabe mostrar.
 */
function shape(kind, raw) {
  if (!raw || typeof raw !== "object" || !raw.campos) {
    throw Object.assign(new Error("A IA não devolveu os campos do barem."), { status: 502 });
  }
  const defs = fieldsOf(kind);
  const campos = {};
  for (const f of defs) {
    const v = raw.campos[f.k];
    if (v === null || v === undefined || v === "") {
      campos[f.k] = null;
      continue;
    }
    if (f.ty === "num" || f.ty === "pct") {
      const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
      campos[f.k] = Number.isFinite(n) ? n : null;
    } else {
      campos[f.k] = txt(v, 200);
    }
  }
  const out = {
    campos,
    explicacoes: {},
    pressupostos: (Array.isArray(raw.pressupostos) ? raw.pressupostos : []).slice(0, 10).map((x) => txt(x, 400)),
    perguntas: (Array.isArray(raw.perguntas) ? raw.perguntas : []).slice(0, 4).map((x) => txt(x, 300)),
    confianca: ["alta", "média", "media", "baixa"].includes(String(raw.confianca || "").toLowerCase())
      ? String(raw.confianca).toLowerCase().replace("media", "média")
      : "média",
    resumo: txt(raw.resumo, 600),
  };
  for (const f of defs) {
    const e = raw.explicacoes?.[f.k];
    if (e) out.explicacoes[f.k] = txt(e, 500);
  }
  // Os dois campos que não vivem em `fields` mas o barem precisa.
  if (kind === "EQUIPAMENTO" && OWNERSHIP.includes(txt(raw.campos.ownership, 20))) out.ownership = txt(raw.campos.ownership, 20);
  if (kind === "FERRAMENTA" && FE_COST_UNITS.includes(txt(raw.campos.unit, 10))) out.unit = txt(raw.campos.unit, 10);
  if (kind === "FERRAMENTA" && campos.tipo && !FE_TYPES.includes(campos.tipo)) campos.tipo = null;
  if (kind === "EQUIPAMENTO" && campos.alugUn && !RENT_UNITS.includes(campos.alugUn)) campos.alugUn = null;
  return out;
}

/**
 * Calcula um barem a partir da descrição.
 *
 * `respostas` continua a conversa: manda-se a proposta anterior e o que o
 * utilizador respondeu às perguntas, e a IA refaz o cálculo.
 */
async function calcular({ kind, descricao, anterior, respostas, contexto, existentes, unidade, userId, io }) {
  if (!TIPOS.includes(kind)) throw Object.assign(new Error("Tipo de barem desconhecido."), { status: 400 });
  if (!txt(descricao) || txt(descricao).length < 8) {
    throw Object.assign(new Error("Descreva o recurso primeiro (pelo menos uma frase)."), { status: 400 });
  }

  let prompt = buildPrompt(kind, txt(descricao, 4000), { contexto, existentes, unidade });
  if (anterior && txt(respostas)) {
    prompt += `\n\nPROPOSTA ANTERIOR:\n${JSON.stringify(anterior)}\n\nRESPOSTAS E CORREÇÕES DO UTILIZADOR:\n${txt(respostas, 2000)}\n\nDevolve o JSON completo actualizado, no mesmo formato.`;
  }

  const res = await generate({
    feature: FEATURE,
    userId,
    categories: CATEGORIES,
    prompt,
    json: true,
    maxOutputTokens: 4000,
    timeoutMs: 90_000,
    io,
  });
  return { kind, resultado: shape(kind, parseJson(res.text)), model: res.model };
}

/** Responde a uma dúvida sobre como calcular custos. */
async function perguntar({ pergunta, contexto, empresa, userId, io }) {
  if (!txt(pergunta)) throw Object.assign(new Error("Escreva a dúvida."), { status: 400 });
  const res = await generate({
    feature: FEATURE,
    userId,
    categories: CATEGORIES,
    prompt: buildQuestionPrompt(txt(pergunta, 1000), { contexto, empresa }),
    maxOutputTokens: 2000,
    timeoutMs: 60_000,
    io,
  });
  return { resposta: txt(res.text, 8000), model: res.model };
}

module.exports = {
  FEATURE,
  CATEGORIES,
  TIPOS,
  FORMULAS,
  EXEMPLOS,
  fieldsOf,
  buildContext,
  buildPrompt,
  buildQuestionPrompt,
  answerShape,
  parseJson,
  shape,
  calcular,
  perguntar,
  N,
};
