/**
 * Catálogo de artigos de venda — o que a empresa já vendeu, e por quanto.
 *
 * Não há tabela nova. As tabelas de quantidades das obras já são, na prática,
 * uma lista de preços praticados: o mesmo artigo repetido em várias obras, cada
 * uma com o preço que foi cobrado. Isto agrupa essas linhas por artigo e devolve
 * o histórico, para quem está a orçamentar ver por quanto é que aquilo saiu da
 * última vez, em que obra e quando.
 *
 * Ser derivado em vez de guardado é de propósito: não há sincronização para
 * correr mal, não envelhece, e nenhuma linha fica a dizer uma coisa enquanto a
 * obra diz outra.
 *
 * ─── O que esta análise NÃO faz, de propósito ───────────────────────────────
 *
 * **Não mistura moedas.** Cinco das obras estão em dólares e as outras em
 * kwanzas. Somar as duas dava disparates — um eléctrodo de terra parecia valer
 * entre 7 e 24 189. Cada moeda tem o seu histórico, separado.
 *
 * **Não converte.** Converter um preço de há meses pela taxa de hoje não dá o
 * preço de hoje; quem orçamenta é que decide o que fazer com um preço em
 * dólares.
 *
 * **Não recomenda um preço.** Devolve o último, o intervalo e a mediana, cada
 * um com a sua data, porque num país com inflação a média de preços de anos
 * diferentes não quer dizer nada. A decisão é de quem orçamenta.
 *
 * **Não junta descrições parecidas.** «Travessa HTP4» e «Montagem de Travessa
 * HTP4» ficam separadas. Juntá-las era adivinhar; quem quiser juntá-las
 * escreve-as da mesma maneira.
 */

const { normalizeUnit } = require("./units");

/** Minúsculas, sem acentos, sem pontuação, espaços colapsados. */
function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A chave que diz «é o mesmo artigo»: descrição normalizada mais unidade.
 * Unidades diferentes são artigos diferentes — cabo ao metro não é cabo ao rolo.
 */
function articleKey(description, unit) {
  return `${fold(description)}|${fold(normalizeUnit(unit).unit)}`;
}

function median(sorted) {
  if (!sorted.length) return 0;
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

/**
 * Agrupa linhas de tabelas de quantidades em artigos.
 *
 * @param {Array} lines cada uma `{ description, unit, unitPrice, quantity,
 *   currency, projectId, projectCode, projectName, date }`
 * @returns {Array} artigos, do mais usado para o menos usado
 */
function buildCatalog(lines) {
  const byKey = new Map();

  for (const l of lines || []) {
    const desc = String(l.description ?? "").trim();
    if (!desc) continue;
    const u = normalizeUnit(l.unit);
    const key = articleKey(desc, l.unit);
    const price = Number(l.unitPrice) || 0;
    const cur = String(l.currency || "AOA").toUpperCase();

    const art =
      byKey.get(key) ||
      byKey.set(key, { key, desc, un: u.unit, grafias: new Map(), moedas: new Map(), linhas: 0, obras: new Set() }).get(key);

    art.linhas += 1;
    if (l.projectId) art.obras.add(l.projectId);
    art.grafias.set(desc, (art.grafias.get(desc) || 0) + 1);

    // Linha sem preço conta como uso do artigo, mas não entra no histórico de
    // preços: zero não é um preço, é a falta dele.
    if (!(price > 0)) continue;

    const m = art.moedas.get(cur) || { cur, usos: [], obras: new Set() };
    m.usos.push({
      price,
      qty: Number(l.quantity) || 0,
      projectId: l.projectId || null,
      projectCode: l.projectCode || null,
      projectName: l.projectName || null,
      date: l.date || null,
    });
    if (l.projectId) m.obras.add(l.projectId);
    art.moedas.set(cur, m);
  }

  return [...byKey.values()]
    .map((art) => {
      // A grafia mais usada é a que se mostra: é a que a casa escreve.
      const desc = [...art.grafias.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

      const moedas = [...art.moedas.values()]
        .map((m) => {
          const ordenados = m.usos.map((u) => u.price).sort((a, b) => a - b);
          const recentes = m.usos
            .slice()
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
            .map((u) => ({ ...u, price: round2(u.price) }));
          const ultimo = recentes[0];
          return {
            cur: m.cur,
            obras: m.obras.size,
            usos: m.usos.length,
            ultimo: ultimo ? { preco: ultimo.price, obra: ultimo.projectCode, obraNome: ultimo.projectName, data: ultimo.date } : null,
            min: round2(ordenados[0]),
            max: round2(ordenados[ordenados.length - 1]),
            mediana: round2(median(ordenados)),
            historico: recentes,
          };
        })
        .sort((a, b) => b.obras - a.obras || b.usos - a.usos);

      return {
        key: art.key,
        desc,
        un: art.un,
        linhas: art.linhas,
        obras: art.obras.size,
        grafias: art.grafias.size,
        moedas,
        semPreco: art.linhas - moedas.reduce((a, m) => a + m.usos, 0),
      };
    })
    .sort((a, b) => b.obras - a.obras || b.linhas - a.linhas || a.desc.localeCompare(b.desc));
}

/**
 * Procura no catálogo.
 *
 * Ordem: quem casa exactamente primeiro, depois quem começa pelo que se
 * escreveu, depois quem o contém; dentro de cada grupo, o artigo usado em mais
 * obras vem à frente, porque é o que a casa mais vende.
 */
function searchCatalog(catalog, query, { unit = null, currency = null, limit = 20 } = {}) {
  const q = fold(query);
  const un = unit ? fold(normalizeUnit(unit).unit) : null;

  const pontuacao = (art) => {
    const d = fold(art.desc);
    if (!q) return 1;
    if (d === q) return 4;
    if (d.startsWith(q)) return 3;
    if (d.includes(q)) return 2;
    // Todas as palavras escritas aparecem, por qualquer ordem.
    const palavras = q.split(" ").filter(Boolean);
    if (palavras.length > 1 && palavras.every((p) => d.includes(p))) return 2;
    return 0;
  };

  return (catalog || [])
    .map((art) => ({ art, p: pontuacao(art) }))
    .filter(({ art, p }) => p > 0 && (!un || fold(art.un) === un))
    .map(({ art, p }) => ({
      ...art,
      moedas: currency ? art.moedas.filter((m) => m.cur === String(currency).toUpperCase()) : art.moedas,
      _p: p,
    }))
    .filter((art) => !currency || art.moedas.length)
    .sort((a, b) => b._p - a._p || b.obras - a.obras || b.linhas - a.linhas || a.desc.localeCompare(b.desc))
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map(({ _p, ...art }) => art);
}

/** Números para mostrar no cabeçalho do catálogo. */
function catalogStats(catalog) {
  const moedas = new Map();
  for (const a of catalog || []) {
    for (const m of a.moedas) moedas.set(m.cur, (moedas.get(m.cur) || 0) + 1);
  }
  return {
    artigos: (catalog || []).length,
    linhas: (catalog || []).reduce((a, x) => a + x.linhas, 0),
    repetidos: (catalog || []).filter((a) => a.obras > 1).length,
    moedas: [...moedas.entries()].map(([cur, artigos]) => ({ cur, artigos })).sort((a, b) => b.artigos - a.artigos),
  };
}

module.exports = { fold, articleKey, buildCatalog, searchCatalog, catalogStats };
