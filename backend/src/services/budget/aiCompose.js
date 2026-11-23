/**
 * Compor os custos a partir do mapa de quantidades.
 *
 * Isto **não existe no protótipo**: é o que se pediu a mais. O ponto de partida
 * é o que esta casa tem de facto — 24 orçamentos com o mapa de quantidades
 * cheio (o que se vende, com o preço do cliente) e as folhas de custo vazias ou
 * sem preços. Sem custo não há margem, e sem margem o orçamento não diz nada.
 *
 * A ideia é a composição de custos unitários, como um orçamentista a faz:
 *
 *   «Abertura de cova para poste — 207 un»
 *      → 0,5 dias de servente por cova      × 207 = 103,5 dias de servente
 *      → 0,15 dias de retroescavadora/cova  × 207 =  31 dias de máquina
 *      → 0,08 m³ de betão por cova          × 207 =  16,6 m³ de betão
 *
 * **A IA só dá o consumo por unidade** — que é o juízo de engenharia. As
 * multiplicações são nossas, e por isso podem ser conferidas e testadas. Assim
 * ninguém tem de acreditar numa conta que a IA fez de cabeça.
 */

const { generate } = require("../ai/client");
const { CATS, CAT_KEYS, SHEET_OF } = require("./aiImport");

/** A funcionalidade no catálogo da Gestão do Sistema. */
const FEATURE = "budget_compose";

/** O pedido leva os trabalhos e as quantidades do orçamento. */
const CATEGORIES = ["budget"];

/** Quantos trabalhos se compõem de uma vez (o pedido tem de caber). */
const MAX_ITENS = 25;

const N = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const round = (v, d = 2) => Math.round(N(v) * 10 ** d) / 10 ** d;
const txt = (v, max = 300) => String(v ?? "").trim().slice(0, max);

/** Os trabalhos do mapa de quantidades que se podem compor. */
function trabalhosDe(budget) {
  const qt = Array.isArray(budget?.sheets?.qt) ? budget.sheets.qt : [];
  return qt
    .map((l, i) => ({
      i,
      cod: txt(l.cod, 20) || String(i + 1),
      desc: txt(l.desc),
      un: txt(l.un, 20) || "un",
      q: N(l.q),
      grupo: txt(l.grupo, 120),
      pu: N(l.pu),
    }))
    .filter((l) => l.desc && l.q > 0);
}

/** O que já está nas folhas de custo, para não se propor o que lá está. */
function resumoDasFolhas(budget) {
  const s = budget?.sheets || {};
  const conta = (k) => (Array.isArray(s[k]) ? s[k].length : 0);
  return CATS.map(([cat, folha]) => `${cat}: ${conta(folha)} linha(s)`).join(", ");
}

const nomes = (arr) => (arr || []).map((x) => x.name || x.nome).filter(Boolean).join("; ");

/**
 * O pedido.
 *
 * Leva os trabalhos escolhidos (com unidade e quantidade), os baremes que
 * existem — para a IA **ligar** a composição a eles em vez de inventar nomes —
 * e a instrução que mais importa: dar o consumo **por unidade de trabalho**.
 */
function buildPrompt(trabalhos, { baremesPorTipo = {}, familias = [], jaTem = "", empresa = "a empresa", contexto = "" } = {}) {
  const lista = (k) => nomes(baremesPorTipo[k]) || "(nenhum)";
  return `És orçamentista sénior de ${empresa} (obras de redes eléctricas MT/BT e postos de transformação em Angola). Vais fazer a COMPOSIÇÃO DE CUSTOS UNITÁRIOS de trabalhos de um mapa de quantidades.

Para cada trabalho, diz que recursos são precisos **por cada unidade do trabalho** (por cada "un", por cada "m", por cada "m³"…). Não multipliques pela quantidade total: o programa é que multiplica.

Categorias de recurso:
${CATS.map(([k, , desc]) => `- "${k}": ${desc}`).join("\n")}

Baremes que já existem (usa o nome EXACTO quando o recurso for um deles):
- Mão de obra: ${lista("rh")}
- Equipamentos: ${lista("equipamento") || lista("eq")}
- Viaturas: ${lista("viatura") || lista("vi")}
- Ferramentas: ${lista("ferramenta") || lista("fe")}
- Logística: ${lista("logistica") || lista("lo")}
Famílias de materiais: ${familias.join("; ") || "(nenhuma)"}
${contexto ? `\n${contexto}` : ""}
${jaTem ? `\nO orçamento já tem nas folhas de custo: ${jaTem}.` : ""}

Regras:
- "porUnidade" = quantidade do recurso por **uma** unidade do trabalho. Para mão de obra, equipamentos e viaturas é em **dias** (0,5 = meio dia por unidade). Para materiais é na unidade do material (m³, kg, m…).
- "barem" = nome exacto de um barem de cima, quando houver; senão "" e põe a descrição em "desc".
- Para materiais põe "un" (a unidade do material) e, se puder, a "fam" (família).
- Não inventes preços: o custo vem dos baremes e dos preços dos materiais, que o programa aplica.
- Só o que é mesmo preciso para executar o trabalho. Se um trabalho for um fornecimento puro (só material), não ponhas mão de obra.
- Se não souberes compor um trabalho, devolve-o com "linhas": [] e diz porquê em "nota".
- Escreve em português de Portugal/Angola.

TRABALHOS:
${trabalhos.map((t) => `[${t.cod}] ${t.desc} — ${t.q} ${t.un}${t.grupo ? ` (capítulo: ${t.grupo})` : ""}`).join("\n")}

Responde APENAS com JSON: {"itens":[{"cod":"1.1","nota":"","linhas":[{"cat":"rh","barem":"Servente","desc":"","porUnidade":0.5,"un":"dia","fam":""}]}]}`;
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
 * Dá forma à resposta e **faz as contas**: consumo por unidade × quantidade do
 * trabalho. É aqui que a proposta deixa de ser uma opinião e passa a ser um
 * número que se pode conferir.
 */
function shape(raw, trabalhos) {
  const porCod = new Map(trabalhos.map((t) => [t.cod, t]));
  const itens = Array.isArray(raw?.itens) ? raw.itens : [];
  const out = [];

  for (const it of itens) {
    const t = porCod.get(txt(it.cod, 20));
    if (!t) continue;
    const linhas = (Array.isArray(it.linhas) ? it.linhas : [])
      .map((l) => {
        const cat = CAT_KEYS.includes(l.cat) ? l.cat : null;
        const porUnidade = N(l.porUnidade);
        if (!cat || porUnidade <= 0) return null;
        const barem = txt(l.barem, 120);
        const desc = txt(l.desc) || barem;
        if (!desc) return null;
        return {
          on: true,
          cat,
          barem,
          desc,
          un: txt(l.un, 20) || (["rh", "equipamento", "viatura"].includes(cat) ? "dia" : "un"),
          fam: txt(l.fam, 60),
          porUnidade: round(porUnidade, 4),
          // A conta: por unidade × quantidade do trabalho.
          total: round(porUnidade * t.q, 2),
        };
      })
      .filter(Boolean);
    out.push({ cod: t.cod, desc: t.desc, q: t.q, un: t.un, nota: txt(it.nota, 300), linhas });
  }
  return out;
}

/** Pede a composição dos trabalhos escolhidos. */
async function propor({ budget, cods, baremesPorTipo, familias, empresa, contexto, userId, io }) {
  const todos = trabalhosDe(budget);
  if (!todos.length) throw Object.assign(new Error("Este orçamento não tem mapa de quantidades."), { status: 400 });

  const escolhidos = (Array.isArray(cods) && cods.length ? todos.filter((t) => cods.includes(t.cod)) : todos).slice(0, MAX_ITENS);
  if (!escolhidos.length) throw Object.assign(new Error("Escolha os trabalhos a compor."), { status: 400 });

  const res = await generate({
    feature: FEATURE,
    userId,
    categories: CATEGORIES,
    prompt: buildPrompt(escolhidos, { baremesPorTipo, familias, jaTem: resumoDasFolhas(budget), empresa, contexto }),
    json: true,
    maxOutputTokens: 8000,
    timeoutMs: 90_000,
    io,
  });

  const itens = shape(parseJson(res.text), escolhidos);
  if (!itens.length) throw Object.assign(new Error("A IA não conseguiu compor estes trabalhos."), { status: 422 });
  return { itens, pedidos: escolhidos.length, model: res.model };
}

/**
 * As linhas propostas, na forma das folhas de custo.
 *
 * Junta o mesmo recurso usado em vários trabalhos numa só linha — senão a folha
 * de mão de obra ficava com «Servente» repetido quinze vezes, uma por trabalho.
 * A observação diz de que trabalhos veio.
 */
function toSheetRows(itens, { horasDia = 8 } = {}) {
  const juntos = new Map();

  for (const item of itens || []) {
    for (const l of item.linhas || []) {
      if (!l.on) continue;
      const nome = l.barem || l.desc;
      const chave = `${l.cat}|${nome.toLowerCase()}|${(l.un || "").toLowerCase()}`;
      const acc = juntos.get(chave) || { cat: l.cat, barem: l.barem, desc: nome, un: l.un, fam: l.fam, total: 0, de: [] };
      acc.total = round(acc.total + N(l.total), 2);
      acc.de.push(`${item.cod} (${round(l.porUnidade, 4)}/${item.un})`);
      if (!acc.fam && l.fam) acc.fam = l.fam;
      juntos.set(chave, acc);
    }
  }

  const sheets = {};
  const push = (folha, linha) => {
    sheets[folha] = sheets[folha] || [];
    sheets[folha].push(linha);
  };
  const obs = (x) => `Composto de: ${x.de.slice(0, 6).join(", ")}${x.de.length > 6 ? "…" : ""}`;

  for (const x of juntos.values()) {
    const folha = SHEET_OF[x.cat];
    if (x.cat === "material") {
      push(folha, { fam: x.fam || "Outros", desc: x.desc, un: x.un || "un", q: x.total, preco: 0, moeda: null, obs: obs(x) });
    } else if (x.cat === "rh") {
      // O total vem em dias de recurso: uma pessoa, N dias.
      push(folha, { funcao: x.barem || x.desc, n: 1, h: horasDia, d: x.total, desloc: "Não", obs: obs(x) });
    } else if (x.cat === "equipamento") {
      push(folha, { equip: x.barem || x.desc, q: 1, h: horasDia, d: x.total, obs: obs(x) });
    } else if (x.cat === "viatura") {
      push(folha, { viat: x.barem || x.desc, q: 1, d: x.total, km: 0, obs: obs(x) });
    } else if (x.cat === "ferramenta") {
      push(folha, { item: x.barem || x.desc, q: 1, dias: x.total, obs: obs(x) });
    } else if (x.cat === "subempreitada") {
      push(folha, { sub: "", desc: x.desc, un: x.un || "vg", q: x.total, pu: null, obs: obs(x) });
    } else if (x.cat === "logistica") {
      push(folha, { item: x.barem || x.desc, descr: obs(x), q: 1, dias: x.total });
    }
  }

  // Os recursos sem barem ficam assinalados: são os que vão entrar sem preço.
  const semBarem = [...juntos.values()].filter((x) => !x.barem && x.cat !== "material" && x.cat !== "subempreitada").map((x) => `${x.cat}: ${x.desc}`);
  const materiaisSemPreco = [...juntos.values()].filter((x) => x.cat === "material").length;
  return { sheets, semBarem, materiaisSemPreco, recursos: juntos.size };
}

module.exports = { FEATURE, CATEGORIES, MAX_ITENS, trabalhosDe, resumoDasFolhas, buildPrompt, parseJson, shape, propor, toSheetRows };
