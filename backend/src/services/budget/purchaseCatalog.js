/**
 * Catálogo de preços de compra — por quanto é que a casa já comprou.
 *
 * O par deste é `articleCatalog.js`, que faz o mesmo para o que a casa **vende**
 * (as tabelas de quantidades das obras). Aqui é o outro lado: o que as coisas
 * custaram a comprar. Serve para preencher o «Preço unit. de compra» da folha
 * de materiais sem ninguém ter de ir procurar a cotação à mão.
 *
 * Não há tabela nova: os preços já estão espalhados pelas necessidades de obra,
 * pelas cotações escolhidas, pelo catálogo dos fornecedores, pelas entradas em
 * armazém e pelas ordens de compra. Isto agrupa-os por artigo e põe-nos ao
 * alcance de quem orçamenta.
 *
 * ─── O que isto NÃO faz, de propósito ───────────────────────────────────────
 *
 * **Não inventa preços.** Cada preço devolvido é um registo que existe, com a
 * data e a origem. Não há médias de artigos diferentes, não se escala o preço
 * de uma secção para outra (um cabo de 35mm² não dá o preço do de 16mm²) e não
 * se converte de moeda. Quando nada casa, a resposta é «nada no histórico» —
 * que é uma resposta útil, e muito melhor do que um número com bom aspecto.
 *
 * **Não lê os outros orçamentos.** Era tentador: um material preçado noutro
 * orçamento parece histórico. Mas um orçamento é uma intenção, não uma compra,
 * e os preços aproximados que alguém lá pôs voltariam a sair daqui como se
 * fossem factos. Só entram registos de coisas que se compraram, se cotaram ou
 * que um fornecedor pôs por escrito.
 *
 * **Não decide.** Devolve candidatos ordenados, cada um com a confiança da
 * correspondência à vista, e quem orçamenta é que escolhe. Só a correspondência
 * exacta vem pré-escolhida.
 *
 * ─── Como é que sabe que é o mesmo artigo ───────────────────────────────────
 *
 * A parte difícil não são as palavras, são os números. «Cabo de Terra Nú 35mm»
 * e «Cabo de cobre nu 16mm2» têm quase as mesmas palavras e são artigos com
 * preços muito diferentes. Por isso as especificações técnicas — secções
 * (4x16), medidas (10m, 35mm), potências (100W), calibres (16A) — são extraídas
 * à parte, e **duas especificações da mesma espécie com valores diferentes
 * chumbam a correspondência**, por muito que as palavras coincidam.
 */

const { normalizeUnit } = require("./units");

/** Espécies de especificação e as grafias que as escrevem. */
const SPEC_KINDS = {
  mm: ["mm2", "mm²", "mm"],
  m: ["mts", "mt", "metros", "metro", "m"],
  cm: ["cm"],
  w: ["kw", "w"],
  kva: ["kva"],
  a: ["a"],
  v: ["kv", "v"],
  kg: ["kg"],
  t: ["ton", "t"],
  l: ["lt", "l"],
  dan: ["dan"],
  pol: ["polegadas", "polegada"],
};

/** Grafia da especificação → espécie. As mais longas primeiro, para `mm2` não cair em `m`. */
const SPEC_SUFFIXES = Object.entries(SPEC_KINDS)
  .flatMap(([kind, grafias]) => grafias.map((g) => [g, kind]))
  .sort((a, b) => b[0].length - a[0].length);

/**
 * Palavras que não distinguem nada. Não contam para a pontuação — mas também
 * não penalizam, por isso «Cabo de cobre» e «Cabo cobre» valem o mesmo.
 */
const BANAIS = new Set([
  "de", "do", "da", "dos", "das", "e", "o", "a", "os", "as", "em", "no", "na", "nos", "nas",
  "para", "por", "com", "sem", "ao", "aos", "um", "uma", "tipo", "ref", "un", "unid", "cada",
]);

/**
 * Normalização para comparar texto técnico.
 *
 * Diferente do `fold` do catálogo de venda em duas coisas que aqui contam:
 * `mm²` passa a `mm2` em vez de se partir em duas palavras, e a vírgula decimal
 * passa a ponto, para «2,5mm2» e «2.5mm2» serem a mesma coisa.
 */
function foldTec(value) {
  return String(value ?? "")
    .replace(/[²₂]/g, "2")
    .replace(/[³₃]/g, "3")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.x]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numero(txt) {
  const v = Number(txt);
  return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : null;
}

/**
 * As especificações técnicas de uma descrição: `{ espécie → conjunto de valores }`.
 *
 * `sec` é a secção escrita com x (4x16, 3x2.5); as outras espécies são números
 * com sufixo de unidade (35mm, 10m, 100w, 16a). Números soltos sem sufixo
 * entram como `num` — contam para chumbar («Fusível NH1 40A» contra «NH2 63A»)
 * mas não para confirmar.
 */
function specs(text) {
  const out = new Map();
  const juntar = (kind, valor) => {
    if (valor === null) return;
    if (!out.has(kind)) out.set(kind, new Set());
    out.get(kind).add(valor);
  };

  let resto = ` ${foldTec(text)} `;

  // Secções: 4x16, 3x2.5, 4 x 95. Consome o sufixo de unidade se vier atrás.
  //
  // A bitola entra **também** na espécie do sufixo: «4x95mm2» é uma secção de
  // 4x95 e uma bitola de 95mm. Sem isto, «Cabo LXAV 4x95mm2» não se dava com
  // «Cabo de Terra Nú 35mm» — a secção e a bitola eram espécies diferentes e
  // nada as punha em contradição, apesar de falarem da mesma grossura.
  resto = resto.replace(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*([a-z0-9]*)/g, (_m, a, b, suf) => {
    const kind = SPEC_SUFFIXES.find(([g]) => g === suf)?.[1];
    juntar("sec", `${numero(a)}x${numero(b)}`);
    if (kind) juntar(kind, numero(b));
    return " ";
  });

  // Número com sufixo de unidade: 35mm, 10 m, 100w, 16a, 400 dan.
  for (const [grafia, kind] of SPEC_SUFFIXES) {
    const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${grafia}(?![a-z0-9])`, "g");
    resto = resto.replace(re, (_m, n) => {
      juntar(kind, numero(n));
      return " ";
    });
  }

  // Números soltos que sobraram.
  resto = resto.replace(/(?<![a-z])(\d+(?:\.\d+)?)(?![a-z])/g, (_m, n) => {
    juntar("num", numero(n));
    return " ";
  });

  return { specs: out, palavras: resto.split(" ").filter((p) => p && !BANAIS.has(p)) };
}

/** Duas palavras dizem o mesmo artigo? Tolera plurais e terminações. */
function mesmaPalavra(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5)) return true;
  // Designações curtas — NH, BT, GL, VD — com uma letra de diferença: «NH» e
  // «NHO» são a mesma família de fusíveis.
  return (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2;
}

function intersecta(a, b) {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function median(sorted) {
  if (!sorted.length) return 0;
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}

/**
 * Agrupa registos de compra em artigos.
 *
 * A chave junta descrição, unidade e **moeda**: preços em moedas diferentes não
 * se misturam nem se comparam, como no catálogo de venda.
 *
 * @param {Array} records cada um `{ description, unit, unitPrice, currency,
 *   source, sourceLabel, supplier, date }`
 * @returns {Array} artigos, do mais usado para o menos usado
 */
function buildPurchaseCatalog(records) {
  const byKey = new Map();

  for (const r of records || []) {
    const desc = String(r.description ?? "").trim();
    const preco = Number(r.unitPrice) || 0;
    // Zero não é um preço, é a falta dele: não entra.
    if (!desc || !(preco > 0)) continue;

    const un = normalizeUnit(r.unit).unit;
    const moeda = String(r.currency || "AOA").toUpperCase();
    const key = `${foldTec(desc)}|${foldTec(un)}|${moeda}`;

    const art =
      byKey.get(key) ||
      byKey.set(key, { key, desc, un, moeda, grafias: new Map(), registos: [] }).get(key);

    art.grafias.set(desc, (art.grafias.get(desc) || 0) + 1);
    art.registos.push({
      preco: round2(preco),
      fonte: r.source || null,
      origem: r.sourceLabel || null,
      forn: r.supplier || null,
      data: r.date || null,
    });
  }

  return [...byKey.values()]
    .map((art) => {
      // A grafia mais usada é a que se mostra: é a que a casa escreve.
      const desc = [...art.grafias.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      const recentes = art.registos.slice().sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
      const precos = art.registos.map((x) => x.preco).sort((a, b) => a - b);
      return {
        key: art.key,
        desc,
        un: art.un,
        moeda: art.moeda,
        usos: art.registos.length,
        ultimo: recentes[0],
        min: round2(precos[0]),
        max: round2(precos[precos.length - 1]),
        mediana: round2(median(precos)),
        registos: recentes,
        fontes: [...new Set(art.registos.map((x) => x.fonte).filter(Boolean))],
      };
    })
    .sort((a, b) => b.usos - a.usos || new Date(b.ultimo.data || 0) - new Date(a.ultimo.data || 0));
}

const PESO = { igual: 3, forte: 2, possivel: 1, procurado: 0 };

/**
 * Compara a descrição de uma linha com a de um artigo do catálogo.
 *
 * @returns {null|{confianca:"igual"|"forte"|"possivel", conflitos:string[], falta:string[]}}
 *   `null` quando não é candidato — ou porque as especificações se contradizem,
 *   ou porque as palavras não chegam.
 */
function compararDescricao(linha, artigo) {
  const A = specs(linha);
  const B = specs(artigo);

  // Especificações da mesma espécie com valores diferentes: artigos diferentes.
  // É isto que impede o preço do cabo de 35mm² de ir para o de 16mm².
  const conflitos = [];
  for (const [kind, valores] of A.specs) {
    const outros = B.specs.get(kind);
    if (outros && !intersecta(valores, outros)) {
      conflitos.push(`${[...valores].join("/")}${kind === "num" || kind === "sec" ? "" : kind} ≠ ${[...outros].join("/")}${kind === "num" || kind === "sec" ? "" : kind}`);
    }
  }
  /*
   * A secção é parte do artigo, não um detalhe que se omite: diz quantos
   * condutores leva. Um «Cabo de cobre nu 16mm2» (um condutor) e um «Cabo Lxs
   * 4x16mm²» (quatro) têm a mesma bitola e são coisas diferentes, por isso a
   * secção declarada só de um lado também chumba. As medidas não: uma descrição
   * pode simplesmente não dizer a altura ou o comprimento.
   */
  if (A.specs.has("sec") !== B.specs.has("sec")) {
    conflitos.push("secção declarada só de um lado");
  }
  if (conflitos.length) return null;

  if (foldTec(linha) === foldTec(artigo)) return { confianca: "igual", falta: [] };

  if (!A.palavras.length) return null;
  const temPalavra = (p) => B.palavras.some((q) => mesmaPalavra(p, q));
  const comuns = A.palavras.filter(temPalavra);
  const falta = A.palavras.filter((p) => !temPalavra(p));

  // Todas as palavras e todas as especificações escritas aparecem no artigo.
  const especsComuns = [...A.specs].filter(([kind, valores]) => {
    const outros = B.specs.get(kind);
    return !!outros && intersecta(valores, outros);
  }).length;
  if (!falta.length && especsComuns === A.specs.size) return { confianca: "forte", falta: [] };

  /*
   * Provas de que é o mesmo artigo. Uma palavra em comum não é prova: «Cabo
   * LXAV 4x95mm2» e «Tesoura de Cortar Cabo» partilham «cabo» e não têm nada a
   * ver. Contam as palavras em comum, as especificações que batem, e a
   * primeira palavra — que é a que diz o que a coisa é, e por isso vale uma
   * prova por si: «Areia lavada» e «Areia» dizem o mesmo, «Cabo…» e
   * «Tesoura…» não.
   */
  const mesmaCabeca = !!A.palavras[0] && !!B.palavras[0] && mesmaPalavra(A.palavras[0], B.palavras[0]);
  const provas = comuns.length + especsComuns + (mesmaCabeca ? 1 : 0);
  if (provas >= 2) return { confianca: "possivel", falta };
  return null;
}

/**
 * Candidatos de preço para uma descrição.
 *
 * @param {Array} catalog de `buildPurchaseCatalog`
 * @param {string} desc descrição da linha
 * @param {object} o
 * @param {string} [o.unit] unidade da linha — não exclui ninguém, mas uma
 *   unidade diferente limita a confiança e fica dita, porque cabo ao metro não
 *   é cabo ao rolo.
 * @param {string[]} [o.currencies] moedas aceitáveis (a folha de
 *   subempreitadas não tem coluna de moeda, por isso só aceita a moeda-base)
 * @param {string} [o.contra] a descrição da linha, quando `desc` é uma procura
 *   à mão. O texto escrito escolhe os artigos; a confiança mede-se sempre
 *   contra a linha, senão «Poste de Iluminação» aparecia como correspondência
 *   «igual» de uma linha que diz «Coluna metálica de IP 10m». O que a procura
 *   trouxe mas não casa com a linha fica como `procurado`: veio daqui porque
 *   alguém o foi buscar, e não porque o programa o reconheceu.
 * @param {number} [o.limit]
 */
function matchPrices(catalog, desc, { unit = null, currencies = null, contra = null, limit = 6 } = {}) {
  if (!String(desc || "").trim()) return [];
  const linha = String(contra || "").trim();
  const un = unit ? foldTec(normalizeUnit(unit).unit) : null;
  const moedas = currencies ? currencies.map((c) => String(c).toUpperCase()) : null;

  return (catalog || [])
    .filter((art) => !moedas || moedas.includes(art.moeda))
    .map((art) => {
      const m = compararDescricao(desc, art.desc);
      if (!m) return null;
      const unDifere = !!un && foldTec(art.un) !== un;
      // Quando o texto procurado não é a descrição da linha, é contra a linha
      // que a confiança se mede.
      const contraLinha = linha && linha !== desc ? compararDescricao(linha, art.desc) : m;
      const bruta = contraLinha ? contraLinha.confianca : "procurado";
      // Unidade diferente nunca é correspondência exacta, por muito que o texto
      // bata: quem decide tem de ver que a unidade mudou.
      const confianca = unDifere && (bruta === "igual" || bruta === "forte") ? "possivel" : bruta;
      const c = {
        desc: art.desc,
        un: art.un,
        unDifere,
        moeda: art.moeda,
        preco: art.ultimo.preco,
        data: art.ultimo.data,
        fonte: art.ultimo.fonte,
        origem: art.ultimo.origem,
        forn: art.ultimo.forn,
        usos: art.usos,
        min: art.min,
        max: art.max,
        mediana: art.mediana,
        confianca,
        falta: contraLinha?.falta || [],
        // Quão bem o artigo casa com o TEXTO ESCRITO. Não se mostra: serve
        // para, numa procura à mão, o artigo que se escreveu vir à frente dos
        // outros que a procura arrastou.
        _q: PESO[m.confianca] ?? 0,
      };
      // A frase da observação vem feita daqui, para o ecrã não ter de a
      // reescrever e as duas versões não poderem divergir.
      c.nota = origemTexto(c);
      return c;
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        PESO[b.confianca] - PESO[a.confianca] ||
        b._q - a._q ||
        Number(a.unDifere) - Number(b.unDifere) ||
        new Date(b.data || 0) - new Date(a.data || 0) ||
        b.usos - a.usos
    )
    .slice(0, Math.max(1, Math.min(20, limit)))
    .map(({ _q, ...c }) => c);
}

/** Que campos é que cada folha usa para descrição, unidade, quantidade e preço. */
const SHEET_FIELDS = {
  mat: { desc: "desc", un: "un", q: "q", preco: "preco", moeda: "moeda", forn: "forn", obs: "obs" },
  sub: { desc: "desc", un: "un", q: "q", preco: "pu", moeda: null, forn: "sub", obs: "obs" },
};

/**
 * Candidatos para cada linha de uma folha de custo.
 *
 * @param {Array} catalog
 * @param {object} o
 * @param {string} o.folha `mat` ou `sub`
 * @param {Array} o.rows as linhas da folha, na ordem em que lá estão
 * @param {string} o.moedaBase moeda-base do orçamento
 * @param {string[]} [o.moedas] moedas que o orçamento conhece
 * @param {boolean} [o.apenasSemPreco] só as linhas que ainda não têm preço
 */
function matchSheet(catalog, { folha, rows, moedaBase, moedas = null, apenasSemPreco = true, limit = 6 }) {
  const campos = SHEET_FIELDS[folha];
  if (!campos) return { folha, campos: null, linhas: [] };

  // Sem coluna de moeda na folha, um preço noutra moeda não teria onde ser
  // escrito: nessa folha só se oferecem preços na moeda-base.
  const aceitaveis = campos.moeda
    ? moedas && moedas.length
      ? moedas
      : null
    : [moedaBase || "AOA"];

  const linhas = [];
  (rows || []).forEach((row, i) => {
    const desc = String(row?.[campos.desc] ?? "").trim();
    if (!desc) return;
    const preco = Number(row?.[campos.preco]) || 0;
    if (apenasSemPreco && preco > 0) return;
    const candidatos = matchPrices(catalog, desc, { unit: row?.[campos.un], currencies: aceitaveis, limit });
    linhas.push({
      i,
      desc,
      un: row?.[campos.un] ?? null,
      q: Number(row?.[campos.q]) || 0,
      preco,
      candidatos,
      // Só a correspondência exacta vem escolhida; tudo o mais fica por decidir.
      escolhido: candidatos.length && candidatos[0].confianca === "igual" ? 0 : null,
    });
  });

  return { folha, campos, linhas };
}

/**
 * As linhas de uma fatura pró-forma lida com IA, como registos do catálogo:
 * cada artigo com o preço unitário sem IVA, na moeda do documento.
 *
 * @param {object} doc `readInvoiceDocument` — `{ items, currency, supplierName, docNumber, docDate }`
 */
function proformaRecords(doc) {
  const forn = doc?.supplierName || null;
  const rotulo = ["Pró-forma", doc?.docNumber].filter(Boolean).join(" ");
  return (doc?.items || [])
    .filter((it) => String(it?.description || "").trim() && Number(it?.unitPrice) > 0)
    .map((it) => ({
      description: String(it.description).trim(),
      unit: it.unit || "un",
      unitPrice: Number(it.unitPrice),
      currency: String(doc?.currency || "AOA").toUpperCase(),
      source: "proforma",
      sourceLabel: rotulo,
      supplier: forn,
      date: doc?.docDate || null,
    }));
}

/** A frase que fica na observação da linha, a dizer de onde veio o preço. */
function origemTexto(c) {
  const marca = c.confianca === "igual" ? "" : "≈ ";
  const partes = [c.desc, `${c.preco}/${c.un}`];
  const de = [c.origem, c.forn, c.data ? new Date(c.data).toISOString().slice(0, 10) : null].filter(Boolean);
  return `Preço: ${marca}${partes.join(" ")}${de.length ? ` [${de.join(" · ")}]` : ""}`;
}

module.exports = {
  proformaRecords,
  foldTec,
  specs,
  compararDescricao,
  buildPurchaseCatalog,
  matchPrices,
  matchSheet,
  origemTexto,
  SHEET_FIELDS,
  SPEC_KINDS,
};
