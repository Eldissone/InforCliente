const { prisma } = require("../../../db");
const { generate } = require("../client");
const { similarity } = require("../needs/service");

/**
 * Paleta de comandos (Fase 4 — Ctrl+K).
 *
 * O utilizador escreve em linguagem natural; o sistema devolve uma intenção
 * que o browser executa (abrir uma obra, abrir um ecrã, começar uma
 * necessidade…). Nada é gravado aqui: as ações que escrevem dados abrem o
 * formulário de sempre, para a pessoa rever e confirmar.
 *
 *  1. parseLocal(): frases comuns resolvidas sem IA (rápido e sem custo).
 *  2. interpretWithAi(): o resto vai à IA, que recebe SÓ o texto escrito —
 *     nem a lista de obras nem dados do sistema. A obra é encontrada depois,
 *     aqui, entre as obras a que o utilizador tem acesso.
 */

const ACTIONS = ["open_project", "new_need", "register_progress", "open_page", "open_approvals", "open_alerts", "ask"];

/** Separadores da obra que um comando pode abrir. */
const PROJECT_TABS = {
  dashboard: ["resumo", "dashboard", "painel"],
  planos_diarios: ["planos diarios", "plano diario", "planos"],
  relatorio: ["relatorio", "relatorios"],
  medicoes: ["medicoes", "medicao", "autos", "auto de medicao"],
  plano_gantt: ["gantt", "cronograma de obra", "planeamento"],
  plano_financeiro: ["plano financeiro", "necessidades", "cronograma financeiro", "pagamentos da obra"],
  stock: ["stock", "armazem", "materiais em stock"],
  galeria_obra: ["fotos", "galeria", "imagens"],
  files: ["ficheiros", "documentos", "arquivos"],
  orcamento_custo: ["orcamento", "orcamento de custo", "custos"],
};

const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function tabFrom(text) {
  const t = fold(text);
  for (const [tab, words] of Object.entries(PROJECT_TABS)) {
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(t))) return tab;
  }
  return null;
}

const strip = (s) => String(s || "").replace(/^[\s,.:;-]+|[\s,.:;?!-]+$/g, "").trim();

/**
 * Frases comuns, sem IA. Devolve a intenção ou null.
 * Pura: só olha para o texto.
 */
function parseLocal(input) {
  const raw = String(input || "").trim();
  const t = fold(raw);
  if (!t) return null;

  if (/^(ver |abrir |abre |mostra(r)? )?(as |minhas )?(aprovacoes|aprovacao|por aprovar|pendentes de aprovacao)\b/.test(t)) {
    return { action: "open_approvals" };
  }
  if (/^(ver |abrir |abre |mostra(r)? )?(os )?alertas\b/.test(t)) return { action: "open_alerts" };

  // «nova necessidade de cimento para a obra X» / «pedir 20 sacos de cimento na obra X»
  let m = raw.match(/^(?:nova|criar|cria|registar|pedir|preciso de)\s+(?:uma\s+)?(?:necessidade\s+)?(?:de\s+)?(.+?)\s+(?:para|na|no|da|do)\s+(?:a\s+|o\s+)?obra\s+(.+)$/i);
  // «nova/criar/registar …» só conta como necessidade se a palavra aparecer.
  const needWordOk = !/^(nova|criar|cria|registar)\b/i.test(raw) || /necessidade/i.test(raw);
  if (m && needWordOk) {
    return { action: "new_need", text: strip(m[1]), project: strip(m[2]) };
  }

  // «registar execução: betonámos 12 m3 na obra X»
  m = raw.match(/^(?:registar|regista)\s+(?:execu[cç][aã]o|avan[cç]o|progresso)\s*:?\s*(.*?)\s+(?:na|no|da|do|para a|para o)\s+obra\s+(.+)$/i);
  if (m) return { action: "register_progress", text: strip(m[1]), project: strip(m[2]) };

  // «abrir obra X», «obra X fotos», «abrir as fotos da obra X»
  m = raw.match(/^(?:abrir|abre|ir para|vai para|ver|mostra(?:r)?)\s+(?:a\s+|o\s+|as\s+|os\s+)?(.*?)\s*(?:d[ao]s?\s+)?obra\s+(.+)$/i);
  if (m) {
    const tab = tabFrom(m[1]);
    return { action: "open_project", project: strip(m[2]), ...(tab ? { tab } : {}) };
  }

  // Perguntas sobre dados → assistente.
  if (/\?$/.test(raw) || /^(quais|qual|quanto|quantos|quantas|que |como esta|como vai|o que|ha |existem|lista|mostra)/.test(t)) {
    return { action: "ask", question: raw };
  }
  return null;
}

const SYSTEM_PROMPT = `És o intérprete da paleta de comandos de um ERP de gestão de obras (construção civil, Angola).
Recebes uma frase do utilizador em português e devolves SÓ JSON com a intenção. Não inventes dados.
Ações possíveis:
- "open_project": abrir uma obra. Campos: "project" (nome ou código como o utilizador escreveu), "tab" opcional: ${Object.keys(PROJECT_TABS).join(", ")}.
- "new_need": pedir material/serviço para uma obra. Campos: "project", "text" (o que é preciso, com quantidades).
- "register_progress": registar trabalho executado. Campos: "project", "text" (o que foi feito).
- "open_page": abrir um ecrã do sistema. Campo "page": palavras curtas do ecrã (ex.: "fornecedores", "centro de compras", "contas a pagar", "stock", "faturação").
- "open_approvals": ver aprovações pendentes.
- "open_alerts": ver alertas das obras.
- "ask": pergunta sobre dados (pagamentos, prazos, atrasos, stock, orçamento…). Campos: "question" (a pergunta reescrita de forma clara), "project" opcional.
Formato: {"action":"…", …campos, "confidence":"alta"|"media"|"baixa"}. Se não perceberes, usa "ask" com a frase original.`;

function parseJson(text) {
  return JSON.parse(String(text || "").replace(/^```(json)?|```$/g, "").trim());
}

/** Normaliza a resposta da IA para uma intenção segura. Pura. */
function cleanIntent(input, original) {
  const parsed = input && typeof input === "object" ? input : {};
  const action = ACTIONS.includes(parsed?.action) ? parsed.action : "ask";
  const str = (v, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const out = { action };
  if (["open_project", "new_need", "register_progress", "ask"].includes(action) && str(parsed.project, 120)) out.project = str(parsed.project, 120);
  if (action === "open_project" && PROJECT_TABS[parsed.tab]) out.tab = parsed.tab;
  if (["new_need", "register_progress"].includes(action)) out.text = str(parsed.text, 1000) || "";
  if (action === "open_page") out.page = str(parsed.page, 80);
  if (action === "ask") out.question = str(parsed.question, 1000) || String(original).slice(0, 1000);
  if (["open_project", "new_need", "register_progress"].includes(action) && !out.project) {
    return { action: "ask", question: String(original).slice(0, 1000) };
  }
  if (action === "open_page" && !out.page) return { action: "ask", question: String(original).slice(0, 1000) };
  return out;
}

async function interpretWithAi({ text, userId, io }) {
  const res = await generate({
    feature: "command",
    userId,
    categories: [],
    projectIds: [],
    system: SYSTEM_PROMPT,
    prompt: `Frase: ${JSON.stringify(text)}`,
    json: true,
    maxOutputTokens: 2000,
    timeoutMs: 20_000,
    io,
  });
  let parsed;
  try {
    parsed = parseJson(res.text);
  } catch {
    parsed = null;
  }
  return { intent: cleanIntent(parsed, text), model: res.model };
}

/** Pontua obras por código / nome / referência. Pura. */
function rankProjects(query, projects, { limit = 5 } = {}) {
  const q = fold(query);
  if (!q) return [];
  return projects
    .map((p) => {
      const code = fold(p.code);
      const ref = fold(p.referencia);
      let score = 0;
      if (code && (code === q || ref === q)) score = 1;
      else if (code && (code.includes(q) || (ref && ref.includes(q)))) score = 0.9;
      else {
        score = Math.max(similarity(q, p.name || ""), similarity(q, [p.name, p.code, p.referencia, p.location].filter(Boolean).join(" ")));
        if (fold(p.name).includes(q)) score = Math.max(score, 0.85);
      }
      return { p, score };
    })
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score || String(a.p.name).localeCompare(String(b.p.name)))
    .slice(0, limit)
    .map(({ p, score }) => ({ id: p.id, code: p.code || null, name: p.name, score }));
}

async function findProjects(query, projectIds) {
  if (!projectIds.length) return [];
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, code: true, name: true, referencia: true, location: true },
  });
  return rankProjects(query, projects);
}

module.exports = { parseLocal, cleanIntent, rankProjects, findProjects, interpretWithAi, PROJECT_TABS, fold };
