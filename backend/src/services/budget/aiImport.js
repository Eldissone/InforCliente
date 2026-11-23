/**
 * Importar um orçamento de uma folha de Excel, com a IA a ler as linhas.
 *
 * É o «✦ Importar Excel (IA)» do protótipo (`impAnalyze` → `impCreate`), com uma
 * diferença que os dados desta casa obrigam: lá o Excel enchia sempre as folhas
 * de **custo**; aqui pode encher essas **ou o mapa de quantidades**, que é o que
 * os orçamentos reais usam (o preço vem do cliente, não do custo).
 *
 * O caminho é sempre o mesmo, e a revisão pelo meio não é opcional:
 *
 *   1. `readWorkbook`  — lê as folhas, sem IA;
 *   2. `analyze`       — a IA diz, linha a linha, o que é (artigo de custo ou
 *                        trabalho do mapa), em que categoria entra e a que
 *                        barem corresponde. **Não inventa preços nem quantidades**;
 *   3. (o utilizador revê, corrige e desmarca o que não quer);
 *   4. `toSheets`      — transforma o que ficou marcado nas folhas do orçamento
 *                        e diz que baremes faltam criar.
 *
 * A IA nunca cria o orçamento: devolve linhas para alguém olhar.
 */

const XLSX = require("xlsx");
const { generate } = require("../ai/client");

/** A funcionalidade no catálogo da Gestão do Sistema. */
const FEATURE = "budget_import";

/** O que vai no prompt: descrições, quantidades e unidades de uma folha de cálculo. */
const CATEGORIES = ["budget"];

/** As categorias de custo, como as folhas do orçamento. */
const CATS = [
  ["material", "mat", "Materiais e equipamentos a fornecer ou instalar: cabos, postes, transformadores, celas, quadros, ferragens, betão"],
  ["rh", "rh", "Mão de obra e funções de pessoal"],
  ["equipamento", "eq", "Máquinas e equipamentos de obra: gruas, escavadoras, geradores, compressores"],
  ["viatura", "vi", "Viaturas, camiões, pick-ups"],
  ["ferramenta", "fe", "Ferramentas, EPI e consumíveis de obra"],
  ["subempreitada", "sub", "Serviços contratados a terceiros: topografia, escavações, construção civil, ensaios"],
  ["logistica", "log", "Estaleiro, transportes, alojamento, alimentação, combustível de estaleiro"],
];
const CAT_KEYS = CATS.map(([k]) => k);
const SHEET_OF = Object.fromEntries(CATS.map(([k, folha]) => [k, folha]));

/** Para onde vai o que se importa. */
const DESTINOS = ["mapa", "custo"];

const MAX_LINES = 900;
const CHUNK_LINES = 110;
const CHUNK_CHARS = 9000;

const N = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;
const txt = (v, max = 300) => String(v ?? "").trim().slice(0, max);

/* ─── 1. Ler o ficheiro ─────────────────────────────────────────────────── */

/**
 * As folhas do ficheiro, em linhas de células. Sem IA e sem adivinhar
 * cabeçalhos: é a IA que depois percebe o que cada linha é.
 */
function readWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  return wb.SheetNames.map((nome) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: "", raw: true });
    return {
      nome,
      linhas: rows.length,
      rows: rows.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c))),
    };
  });
}

/** As linhas com conteúdo, prontas para ir no pedido, com o seu endereço. */
function sheetLines(sheets, selecionadas) {
  const quais = Array.isArray(selecionadas) && selecionadas.length ? selecionadas : sheets.map((_, i) => i);
  const linhas = [];
  const contexto = [];
  sheets.forEach((sh, si) => {
    if (!quais.includes(si)) return;
    (sh.rows || []).forEach((r, ri) => {
      const cheias = r.filter((c) => String(c).trim());
      if (ri < 6 && cheias.length) contexto.push(`${sh.nome}: ${cheias.join(" | ")}`);
      if (cheias.length >= 2) {
        linhas.push({ id: `${si}:${ri}`, t: `[${si}:${ri}] ${r.map((c) => String(c).trim()).join(" | ").replace(/( \| )+$/, "")}` });
      }
    });
  });
  return { linhas: linhas.slice(0, MAX_LINES), contexto, total: linhas.length };
}

/** Parte as linhas em pedidos que o modelo aguenta. */
function chunkLines(linhas) {
  const out = [];
  let cur = [];
  let tamanho = 0;
  for (const l of linhas) {
    if (cur.length && (tamanho + l.t.length > CHUNK_CHARS || cur.length >= CHUNK_LINES)) {
      out.push(cur);
      cur = [];
      tamanho = 0;
    }
    cur.push(l);
    tamanho += l.t.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/* ─── 2. O pedido à IA ──────────────────────────────────────────────────── */

const nomes = (arr) => (arr || []).map((x) => x.name || x.nome).filter(Boolean).join("; ");

/**
 * O pedido de classificação.
 *
 * Leva os baremes que existem, para a IA **ligar** a linha a um deles em vez de
 * criar um novo — é o que impede a biblioteca de encher de duplicados. E leva a
 * regra que mais importa: não inventar quantidades nem preços.
 */
function buildPrompt(chunk, { baremesPorTipo = {}, familias = [], contexto = [], primeiro = false, empresa = "a empresa" } = {}) {
  const lista = (k) => nomes(baremesPorTipo[k]) || "(nenhum)";
  return `És orçamentista de ${empresa} (obras eléctricas MT/BT e postos de transformação em Angola). Recebes linhas de uma folha de Excel (mapa de quantidades, orçamento ou lista). Cada linha começa por [id]; as células estão separadas por " | ". Os números podem estar no formato português (1 234,56).

Para CADA linha que seja um artigo (com descrição e, normalmente, quantidade e/ou preço), devolve um item. IGNORA cabeçalhos, títulos de capítulo, subtotais, totais, IVA e linhas sem artigo.

Categorias:
${CATS.map(([k, , desc]) => `- "${k}": ${desc}`).join("\n")}

Baremes que já existem (usa o nome EXACTO quando a linha corresponder claramente a um deles):
- RH: ${lista("rh")}
- Equipamentos: ${lista("eq")}
- Viaturas: ${lista("vi")}
- Ferramentas: ${lista("fe")}
- Logística: ${lista("lo")}
Famílias de materiais: ${familias.join("; ") || "(nenhuma)"}

Regras:
- "barem" = nome exacto de um barem de cima que corresponda claramente; senão "".
- "fam" só para materiais: uma das famílias acima, ou uma nova curta.
- "cod" = o código do artigo, se a folha o tiver (ex.: "1.1"); senão "".
- "grupo" = o capítulo a que a linha pertence (o título que vem antes dela na folha); senão "".
- "pu" = preço unitário, na moeda indicada (null se a folha não tiver preço).
- Para rh, equipamento e viatura: "pessoas" = n.º de pessoas/unidades, "dias" = n.º de dias, e "pu" = custo POR DIA por pessoa/unidade (converte de hora ×8 ou de mês ÷22 se for o caso).
- "moeda" = "AOA", "USD" ou "EUR" (AOA se não houver indicação).
- **Não inventes quantidades nem preços.** O que a folha não disser fica a null.
${primeiro && contexto.length ? `\nLinhas iniciais das folhas (para identificar obra, cliente e local):\n${contexto.slice(0, 25).join("\n")}\n` : ""}
LINHAS:
${chunk.map((l) => l.t).join("\n")}

Responde APENAS com JSON: {${primeiro ? '"projeto":{"obra":"","cliente":"","local":""},' : ""}"itens":[{"id":"0:12","cat":"material","cod":"","grupo":"","desc":"","un":"","q":0,"pu":null,"moeda":"AOA","fam":"","pessoas":null,"dias":null,"barem":""}]}`;
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

/** Dá forma a um item vindo da IA, para nenhuma folha receber lixo. */
function shapeItem(x) {
  if (!x || !txt(x.desc)) return null;
  const cat = CAT_KEYS.includes(x.cat) ? x.cat : "material";
  return {
    on: true,
    id: txt(x.id, 20),
    cat,
    cod: txt(x.cod, 20),
    grupo: txt(x.grupo, 120),
    desc: txt(x.desc),
    un: txt(x.un, 20),
    q: N(x.q),
    pu: x.pu === null || x.pu === undefined || x.pu === "" ? null : N(x.pu),
    moeda: ["AOA", "USD", "EUR"].includes(x.moeda) ? x.moeda : "AOA",
    fam: txt(x.fam, 60),
    pessoas: x.pessoas === null || x.pessoas === undefined ? null : N(x.pessoas),
    dias: x.dias === null || x.dias === undefined ? null : N(x.dias),
    barem: txt(x.barem, 120),
  };
}

/**
 * Marca as linhas repetidas: a primeira fica, as outras ficam desmarcadas.
 *
 * Um mapa de quantidades com várias localidades repete os mesmos artigos; sem
 * isto, importar criava a mesma linha cinco vezes.
 */
function markDuplicates(items) {
  const chave = (x) =>
    x.cat +
    "|" +
    String(x.desc)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\(.*?\)|[–-].*$/g, "")
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 40);
  const visto = new Map();
  items.forEach((x, i) => {
    x.folha = Number(String(x.id || "").split(":")[0]) || 0;
    const k = chave(x);
    if (visto.has(k)) {
      const primeiro = items[visto.get(k)];
      x.dup = primeiro.folha !== x.folha ? "Repetido de outra folha" : "Repetido nesta folha";
      // Só se desmarca o que vem de outra folha: na mesma folha pode ser mesmo
      // a mesma coisa em sítios diferentes, e quem revê é que sabe.
      if (primeiro.folha !== x.folha) x.on = false;
    } else {
      visto.set(k, i);
    }
  });
  return items;
}

/**
 * A IA lê a folha e devolve as linhas classificadas.
 *
 * @returns {Promise<{projeto:object, itens:object[], folhas:object[], analisadas:number, total:number, modelo:string}>}
 */
async function analyze({ buffer, sheets: selecionadas, baremesPorTipo, familias, empresa, userId, io }) {
  const sheets = readWorkbook(buffer);
  if (!sheets.length) throw Object.assign(new Error("O ficheiro não tem folhas."), { status: 400 });

  const { linhas, contexto, total } = sheetLines(sheets, selecionadas);
  if (!linhas.length) throw Object.assign(new Error("Não encontrei linhas com dados neste ficheiro."), { status: 400 });

  const chunks = chunkLines(linhas);
  const itens = [];
  let projeto = { obra: "", cliente: "", local: "" };
  let modelo = null;

  for (let k = 0; k < chunks.length; k += 1) {
    const res = await generate({
      feature: FEATURE,
      userId,
      categories: CATEGORIES,
      prompt: buildPrompt(chunks[k], { baremesPorTipo, familias, contexto, primeiro: k === 0, empresa }),
      json: true,
      maxOutputTokens: 8000,
      timeoutMs: 90_000,
      io,
    });
    modelo = res.model;
    const y = parseJson(res.text);
    if (k === 0 && y.projeto) {
      projeto = { obra: txt(y.projeto.obra, 200), cliente: txt(y.projeto.cliente, 200), local: txt(y.projeto.local, 200) };
    }
    (Array.isArray(y.itens) ? y.itens : []).forEach((x) => {
      const item = shapeItem(x);
      if (item) itens.push(item);
    });
  }

  if (!itens.length) throw Object.assign(new Error("A IA não encontrou artigos nesta folha."), { status: 422 });

  return {
    projeto,
    itens: markDuplicates(itens),
    folhas: sheets.map((s, i) => ({ i, nome: s.nome, linhas: s.linhas })),
    analisadas: linhas.length,
    total,
    modelo,
  };
}

/* ─── 3. As linhas tornam-se folhas do orçamento ────────────────────────── */

/** O custo de uma linha, para quem está a rever ver no que dá. */
function itemCost(item, { cambios = {} } = {}) {
  const cambio = item.moeda === "AOA" ? 1 : N(cambios[item.moeda]) || 1;
  const pu = item.pu === null ? 0 : N(item.pu) * cambio;
  if (["rh", "equipamento", "viatura"].includes(item.cat)) {
    if (item.barem) return null; // o custo vem do barem, não da folha
    return round2((N(item.pessoas) || 1) * (N(item.dias) || (/dia/i.test(item.un) ? N(item.q) : 0) || 1) * pu);
  }
  return round2((N(item.q) || 1) * pu);
}

/**
 * Transforma as linhas marcadas nas folhas do orçamento.
 *
 * `destino`:
 *  - `mapa`  → tudo vai para o **mapa de quantidades** (o que se vende), que é
 *              como os orçamentos desta casa trabalham: o preço vem do cliente
 *              e as folhas de custo preenchem-se depois;
 *  - `custo` → cada linha vai para a sua folha de custo, como no protótipo.
 *
 * Devolve também os **baremes que faltam**: a importação não os cria sozinha,
 * diz quais são para alguém decidir.
 */
function toSheets(itens, { destino = "mapa", cambios = {}, diasMes = 22, horasDia = 8 } = {}) {
  if (!DESTINOS.includes(destino)) throw Object.assign(new Error("Destino desconhecido."), { status: 400 });
  const usar = (itens || []).filter((x) => x.on && CAT_KEYS.includes(x.cat));
  const sheets = {};
  const novosBaremes = [];
  const familias = new Set();
  let semPreco = 0;

  if (destino === "mapa") {
    sheets.qt = usar.map((x, i) => {
      if (x.pu === null) semPreco += 1;
      const cambio = x.moeda === "AOA" ? 1 : N(cambios[x.moeda]) || 1;
      return {
        cod: x.cod || String(i + 1),
        desc: x.desc,
        un: x.un || "un",
        q: N(x.q) || 1,
        pu: x.pu === null ? 0 : round2(N(x.pu) * cambio),
        grupo: x.grupo || "",
      };
    });
    return { sheets, novosBaremes, familias: [], semPreco };
  }

  const push = (folha, linha) => {
    sheets[folha] = sheets[folha] || [];
    sheets[folha].push(linha);
  };
  const precisaBarem = (tipo, nome, campos) => {
    if (!novosBaremes.some((b) => b.kind === tipo && b.name === nome)) novosBaremes.push({ kind: tipo, name: nome, fields: campos });
  };

  usar.forEach((x, i) => {
    const cambio = x.moeda === "AOA" ? 1 : N(cambios[x.moeda]) || 1;
    const pu = x.pu === null ? null : round2(N(x.pu) * cambio);
    const pessoas = N(x.pessoas) || 1;
    const dias = N(x.dias) || (/dia/i.test(x.un) ? N(x.q) : 0) || 1;
    if (pu === null) semPreco += 1;

    if (x.cat === "material") {
      const fam = x.fam || "Outros";
      familias.add(fam);
      push("mat", {
        cod: x.cod || `MAT-${String(i + 1).padStart(3, "0")}`,
        fam,
        desc: x.desc,
        un: x.un || "un",
        q: N(x.q),
        preco: pu ?? 0,
        moeda: x.moeda,
      });
    } else if (x.cat === "rh") {
      const nome = x.barem || x.desc;
      if (!x.barem) precisaBarem("RH", nome, { mensal: pu === null ? null : round2(pu * diasMes) });
      push("rh", { funcao: nome, n: pessoas, h: horasDia, d: dias, desloc: "Não", obs: x.barem ? "" : "Importado do Excel" });
    } else if (x.cat === "equipamento") {
      const nome = x.barem || x.desc;
      if (!x.barem) precisaBarem("EQ", nome, { pa: "Alugado", aluguer: pu, alugUn: "Dia" });
      push("eq", { equip: nome, q: pessoas, h: horasDia, d: dias, obs: x.barem ? "" : "Importado do Excel" });
    } else if (x.cat === "viatura") {
      const nome = x.barem || x.desc;
      if (!x.barem) precisaBarem("VI", nome, { outros: pu === null ? null : round2(pu * diasMes) });
      push("vi", { viat: nome, q: pessoas, d: dias, km: 0, obs: x.barem ? "" : "Importado do Excel" });
    } else if (x.cat === "ferramenta") {
      push("fe", x.barem ? { item: x.barem, q: N(x.q) || 1, dias: N(x.dias) || null } : { item: x.desc, q: N(x.q) || 1, manual: pu, obs: "Importado do Excel" });
    } else if (x.cat === "subempreitada") {
      push("sub", { sub: "", desc: x.desc, un: x.un || "vg", q: N(x.q) || 1, pu });
    } else if (x.cat === "logistica") {
      push("log", x.barem ? { item: x.barem, descr: x.desc, q: N(x.q) || 1, dias: N(x.dias) || null } : { item: x.desc, descr: "", q: N(x.q) || 1, manual: pu });
    }
  });

  return { sheets, novosBaremes, familias: [...familias], semPreco };
}

module.exports = {
  FEATURE,
  CATEGORIES,
  CATS,
  CAT_KEYS,
  SHEET_OF,
  DESTINOS,
  readWorkbook,
  sheetLines,
  chunkLines,
  buildPrompt,
  parseJson,
  shapeItem,
  markDuplicates,
  analyze,
  itemCost,
  toSheets,
};
