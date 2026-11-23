/**
 * O que se pode editar na Proposta Técnica e Comercial — **o esquema**.
 *
 * O documento é o objeto que o modelo `proposta-mbt.html` desenha (23 campos,
 * ver `backend/src/services/proposal/document.js`). Em vez de um formulário
 * escrito à mão para cada campo, descreve-se aqui **o que** se edita e o editor
 * constrói-se a partir disto. Assim o ecrã e o documento não podem divergir: um
 * teste percorre este esquema e confirma que cada caminho existe mesmo num
 * documento acabado de montar.
 *
 * Cada secção corresponde a uma zona do protótipo (`ZONAS`), e as zonas com
 * `anexos: true` aceitam imagens, mapas, tabelas e blocos de texto, que entram
 * no documento pela lista `extras` com a sua `zona`.
 */

/** Tipos de campo que o editor sabe desenhar. */
export const FIELD_KINDS = ["text", "area", "lines", "num", "date", "list"];

/**
 * As secções do documento, pela ordem em que aparecem na proposta.
 *
 * `path` é o caminho dentro do documento (`a.b.0.c`). Nas listas, `item`
 * descreve os campos de cada linha e `novo` o que se cria ao acrescentar.
 */
export const SECTIONS = [
  {
    zona: "capa",
    titulo: "Capa e síntese",
    anexos: false,
    ajuda: "O que aparece na primeira página e no resumo do projecto.",
    campos: [
      { path: "documento.revisao", label: "Revisão", kind: "text", largura: "6rem" },
      { path: "cliente.nome", label: "Cliente", kind: "text" },
      { path: "obra.titulo", label: "Título da obra", kind: "text" },
      { path: "obra.localizacao", label: "Localização", kind: "text" },
      { path: "capa.slogan", label: "Slogan da capa", kind: "text" },
      { path: "sintese.prazo", label: "Prazo", kind: "text", largura: "10rem" },
      { path: "sintese.inicio", label: "Início depois da adjudicação", kind: "text", largura: "10rem" },
      { path: "sintese.garantia", label: "Garantia", kind: "text", largura: "10rem" },
    ],
  },
  {
    zona: "objectivo",
    titulo: "01 · Objectivo e documentação de referência",
    anexos: true,
    ia: {
      tarefa: "textos",
      label: "✦ Redigir os textos técnicos",
      ajuda: "Escreve o objectivo, a documentação de referência, a introdução e as fases das condições técnicas e o texto do traçado.",
    },
    campos: [
      { path: "objectivo", label: "Objectivo", kind: "area", linhas: 3 },
      { path: "documentacao_referencia", label: "Documentação de referência", kind: "area", linhas: 2 },
    ],
  },
  {
    zona: "memoria",
    titulo: "02 · Memória descritiva e justificativa",
    anexos: true,
    ajuda: "Explica o projecto: o que se vai fazer, a solução técnica escolhida e porquê.",
    ia: {
      tarefa: "memoria",
      label: "✦ Redigir a memória",
      ajuda: "Escreve a introdução e os pontos da memória a partir do orçamento. Substitui o que lá estiver.",
    },
    campos: [
      { path: "memoria.texto", label: "Introdução", kind: "area", linhas: 3 },
      {
        path: "memoria.seccoes",
        label: "Pontos da memória",
        kind: "list",
        item: [
          { path: "titulo", label: "Título", kind: "text" },
          { path: "texto", label: "Texto", kind: "area", linhas: 4 },
        ],
        novo: { titulo: "Novo ponto", texto: "" },
      },
      {
        path: "memoria.fotos",
        label: "Registo fotográfico",
        kind: "list",
        imagens: true,
        ajuda: "Cada fotografia leva uma legenda a dizer o que mostra.",
        item: [
          { path: "imagem", label: "Imagem", kind: "imagem" },
          { path: "legenda", label: "Legenda", kind: "text" },
        ],
        novo: { imagem: "", legenda: "" },
      },
    ],
  },
  {
    zona: "condicoes",
    titulo: "03 · Condições técnicas",
    anexos: true,
    campos: [
      { path: "condicoes_tecnicas.introducao", label: "Introdução", kind: "area", linhas: 3 },
      {
        path: "condicoes_tecnicas.fases",
        label: "Fases de execução",
        kind: "list",
        item: [
          { path: "titulo", label: "Título", kind: "text" },
          { path: "texto", label: "Texto", kind: "area", linhas: 3 },
        ],
        novo: { titulo: "Fase", texto: "" },
      },
    ],
  },
  {
    zona: "quadro",
    titulo: "04 · Quadro resumo",
    anexos: true,
    ajuda: "Os números da obra por localidade. Deixe vazio para não aparecer.",
    campos: [
      { path: "quadro_resumo.texto", label: "Texto", kind: "area", linhas: 2 },
      {
        path: "quadro_resumo.linhas",
        label: "Localidades",
        kind: "list",
        item: [
          { path: "obra", label: "Obra", kind: "text" },
          { path: "mt", label: "Rede MT (km)", kind: "num" },
          { path: "pt", label: "PT", kind: "num" },
          { path: "bt", label: "Rede BT (km)", kind: "num" },
          { path: "lum", label: "Luminárias", kind: "num" },
          { path: "lig", label: "Ligações", kind: "num" },
        ],
        novo: { obra: "", mt: null, pt: null, bt: null, lum: null, lig: null },
      },
    ],
  },
  {
    zona: "tracado",
    titulo: "05 · Traçado de execução",
    anexos: true,
    campos: [
      { path: "tracado.texto", label: "Texto", kind: "area", linhas: 3 },
      {
        path: "tracado.criterios",
        label: "Critérios técnicos",
        kind: "list",
        item: [
          { path: "titulo", label: "Título", kind: "text" },
          { path: "texto", label: "Texto", kind: "area", linhas: 2 },
        ],
        novo: { icone: "terrain", titulo: "Critério", texto: "" },
      },
    ],
  },
  {
    zona: "cronograma",
    titulo: "06 · Cronograma de execução",
    anexos: true,
    campos: [
      { path: "cronograma.texto", label: "Texto", kind: "area", linhas: 3 },
      {
        path: "cronograma.fases",
        label: "Fases",
        kind: "list",
        item: [
          { path: "id", label: "Id", kind: "text", largura: "4rem" },
          { path: "nome", label: "Nome", kind: "text" },
        ],
        novo: { id: "I", nome: "Fase" },
      },
      {
        path: "cronograma.actividades",
        label: "Actividades",
        kind: "list",
        item: [
          { path: "fase", label: "Fase", kind: "text", largura: "4rem" },
          { path: "nome", label: "Actividade", kind: "text" },
          { path: "inicio", label: "Início", kind: "date" },
          { path: "fim", label: "Fim", kind: "date" },
        ],
        novo: { fase: "I", nome: "Actividade", inicio: "", fim: "" },
      },
    ],
  },
  { zona: "equipamentos", titulo: "07 · Meios e equipamentos", anexos: true, campos: [], ajuda: "Só anexos: fotografias ou listas de meios." },
  {
    zona: "organograma",
    titulo: "08 · Organização da obra",
    anexos: true,
    ajuda: "A estrutura da equipa. O nível diz de quem depende: 0 é o topo.",
    campos: [
      { path: "organograma.texto", label: "Texto", kind: "area", linhas: 3 },
      {
        path: "organograma.diagramas",
        label: "Organogramas",
        kind: "list",
        arvore: true,
        item: [
          { path: "titulo", label: "Título", kind: "text" },
          { path: "_plano", label: "Cargos", kind: "arvore" },
        ],
        novo: { titulo: "Organograma da Obra", raiz: { cargo: "Diretor de Obra", nome: "", filhos: [] } },
      },
    ],
  },
  {
    zona: "execucao",
    titulo: "09 · Execução dos trabalhos",
    anexos: true,
    campos: [
      {
        path: "execucao_trabalhos",
        label: "Pontos",
        kind: "list",
        item: [{ path: "texto", label: "Texto", kind: "area", linhas: 2 }],
        novo: { icone: "tool", texto: "" },
      },
    ],
  },
  {
    zona: "qsa",
    titulo: "10 · Qualidade, segurança, ambiente e exclusões",
    anexos: true,
    campos: [
      { path: "qualidade_seguranca_ambiente", label: "Qualidade, segurança e ambiente", kind: "lines", linhas: 6, ajuda: "Um parágrafo por linha." },
      { path: "exclusoes", label: "Limites de fornecimento / exclusões", kind: "lines", linhas: 6, ajuda: "Uma exclusão por linha." },
    ],
  },
  {
    zona: "comercial",
    titulo: "11 · Condições comerciais",
    anexos: true,
    ajuda: "A lista de preços vem do orçamento e não se escreve aqui.",
    campos: [
      { path: "comercial.nota_iva", label: "Nota sobre o IVA", kind: "area", linhas: 2 },
      { path: "comercial.titulo_lista", label: "Título da lista", kind: "text" },
      { path: "comercial.regime", label: "Regime da empreitada", kind: "area", linhas: 2 },
      {
        path: "comercial.pagamento",
        label: "Condições de pagamento",
        kind: "list",
        item: [
          { path: "destaque", label: "Destaque", kind: "text", largura: "8rem" },
          { path: "texto", label: "Texto", kind: "area", linhas: 2 },
        ],
        novo: { destaque: "", texto: "" },
      },
      { path: "comercial.garantia.titulo", label: "Garantia (título)", kind: "text" },
      { path: "comercial.garantia.texto", label: "Garantia (texto)", kind: "area", linhas: 2 },
    ],
  },
  { zona: "financeiro", titulo: "12 · Cronograma financeiro", anexos: true, campos: [], ajuda: "Só anexos: o mapa de recebimentos, se quiser mostrá-lo." },
  {
    zona: "prazo",
    titulo: "13 · Prazo, receção e validade",
    anexos: false,
    campos: [
      { path: "prazo.titulo", label: "Título", kind: "text" },
      { path: "prazo.texto", label: "Texto", kind: "area", linhas: 3 },
      { path: "recepcao", label: "Receção da obra", kind: "area", linhas: 2 },
      { path: "validade", label: "Validade da proposta", kind: "area", linhas: 2 },
    ],
  },
  {
    zona: "contactos",
    titulo: "14 · Contactos",
    anexos: false,
    campos: [
      { path: "contactos.texto", label: "Introdução", kind: "area", linhas: 2 },
      {
        path: "contactos.pessoas",
        label: "Pessoas",
        kind: "list",
        item: [
          { path: "cargo", label: "Cargo", kind: "text" },
          { path: "nome", label: "Nome", kind: "text" },
          { path: "telefone", label: "Telefone", kind: "text", largura: "10rem" },
        ],
        novo: { cargo: "", nome: "", telefone: "" },
      },
      { path: "contactos.morada_profissional", label: "Morada", kind: "area", linhas: 2 },
      { path: "contactos.telefone", label: "Telefone", kind: "text", largura: "12rem" },
      { path: "contactos.fax", label: "Fax", kind: "text", largura: "12rem" },
      { path: "contactos.fecho", label: "Fecho", kind: "area", linhas: 2 },
      { path: "contactos.assinatura.nome", label: "Assina (nome)", kind: "text" },
      { path: "contactos.assinatura.cargo", label: "Assina (cargo)", kind: "text" },
      { path: "contactos.assinatura.img", label: "Assinatura digitalizada", kind: "imagem" },
    ],
  },
  { zona: "anexos", titulo: "15 · Anexos", anexos: true, campos: [], ajuda: "Vão para o fim da proposta." },
];

/** As zonas que aceitam anexos, para a lista `extras`. */
export const ZONAS_COM_ANEXOS = SECTIONS.filter((s) => s.anexos).map((s) => s.zona);

/** Tipos de anexo. */
export const TIPOS_ANEXO = [
  ["texto", "Bloco de texto"],
  ["imagem", "Imagem ou mapa"],
];

/* ─── Caminhos ──────────────────────────────────────────────────────────── */

/** O valor que está em `a.b.0.c`. */
export function getPath(obj, path) {
  if (!path) return undefined;
  let cur = obj;
  for (const k of String(path).split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Escreve em `a.b.0.c`, criando pelo caminho o que faltar.
 *
 * Um segmento que seja um número cria uma lista; o resto cria objetos. Assim
 * pode escrever-se em `tracado.criterios.0.titulo` num documento onde o traçado
 * ainda nem existe — é o que acontece quando se começa a escrever uma secção
 * que estava vazia.
 */
export function setPath(obj, path, value) {
  const keys = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i];
    const proximoEhIndice = /^\d+$/.test(keys[i + 1]);
    if (cur[k] === null || cur[k] === undefined || typeof cur[k] !== "object") {
      cur[k] = proximoEhIndice ? [] : {};
    }
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
  return obj;
}

/** A lista que está em `path` (criando-a se não existir). */
export function listAt(doc, path) {
  const v = getPath(doc, path);
  if (Array.isArray(v)) return v;
  setPath(doc, path, []);
  return getPath(doc, path);
}

/** Acrescenta uma linha nova ao fim de uma lista. */
export function addItem(doc, path, novo) {
  const arr = listAt(doc, path);
  arr.push(JSON.parse(JSON.stringify(novo ?? {})));
  return arr.length - 1;
}

/** Retira a linha `i`. */
export function removeItem(doc, path, i) {
  const arr = listAt(doc, path);
  if (i >= 0 && i < arr.length) arr.splice(i, 1);
  return arr;
}

/** Sobe (-1) ou desce (+1) a linha `i`. */
export function moveItem(doc, path, i, dir) {
  const arr = listAt(doc, path);
  const j = i + dir;
  if (i < 0 || i >= arr.length || j < 0 || j >= arr.length) return arr;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return arr;
}

/* ─── Organograma: árvore ↔ lista com níveis ────────────────────────────── */

/**
 * A árvore do organograma como uma lista de cargos com nível.
 *
 * Editar uma árvore à mão é mau de usar; uma lista em que cada linha diz o seu
 * nível (0 é o topo) dá o mesmo resultado e escreve-se depressa.
 */
export function treeToRows(raiz) {
  const out = [];
  const walk = (n, nivel) => {
    if (!n) return;
    out.push({ nivel, cargo: n.cargo || "", nome: n.nome || "" });
    (n.filhos || []).forEach((f) => walk(f, nivel + 1));
  };
  walk(raiz, 0);
  return out;
}

/**
 * De volta a árvore. Um nível que salte (0 → 2) é tratado como o seguinte
 * possível, para nunca se perder um cargo por causa de um número mal escrito.
 */
export function rowsToTree(rows) {
  const linhas = (rows || []).filter((r) => (r.cargo || "").trim() || (r.nome || "").trim());
  if (!linhas.length) return { cargo: "Diretor de Obra", nome: "", filhos: [] };
  const raiz = { cargo: linhas[0].cargo || "—", nome: linhas[0].nome || "", filhos: [] };
  const pilha = [raiz];
  for (let i = 1; i < linhas.length; i += 1) {
    const l = linhas[i];
    const nivel = Math.max(1, Math.min(Number(l.nivel) || 0, pilha.length));
    const no = { cargo: l.cargo || "—", nome: l.nome || "", filhos: [] };
    pilha[nivel - 1].filhos.push(no);
    pilha.length = nivel;
    pilha.push(no);
  }
  return raiz;
}

/**
 * A árvore como texto, uma linha por cargo, com o nível dado pela indentação.
 *
 *   Diretor de Obra — Ana
 *     Supervisor — Bento
 *       Chefe de equipa
 *
 * Escreve-se de uma assentada e lê-se sem explicação, que é mais do que se pode
 * dizer de um editor de árvore com botões.
 */
export function rowsToText(rows) {
  return (rows || [])
    .map((r) => "  ".repeat(Math.max(0, Number(r.nivel) || 0)) + [r.cargo, r.nome].filter(Boolean).join(" — "))
    .join("\n");
}

/** De volta: dois espaços (ou um tab) por nível. */
export function textToRows(text) {
  return String(text || "")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const semIndent = l.replace(/^\s+/, "");
      const indent = l.length - semIndent.length;
      const nivel = Math.round(indent / 2);
      const [cargo, ...resto] = semIndent.split("—");
      return { nivel, cargo: cargo.trim(), nome: resto.join("—").trim() };
    });
}

/* ─── Anexos ────────────────────────────────────────────────────────────── */

/**
 * Onde é que o documento guarda imagens.
 *
 * O documento guarda **caminhos** (`uploads/…`), não endereços completos: o
 * endereço depende de quem está a ver (o ecrã resolve-o para o servidor, a
 * extração mete a imagem dentro do ficheiro). Guardar o endereço completo
 * prendia o documento ao servidor onde foi escrito.
 *
 * O servidor tem a mesma lista em `services/proposal/render.js` (`inlineImages`).
 */
export function mapImages(doc, fn) {
  if (!doc) return doc;
  const toca = (obj, campo) => {
    if (!obj) return;
    const v = obj[campo];
    if (typeof v === "string" && v) obj[campo] = fn(v) || v;
  };
  toca(doc.capa, "imagem");
  toca(doc.contactos?.assinatura, "img");
  (doc.memoria?.fotos || []).forEach((f) => toca(f, "imagem"));
  (doc.extras || []).forEach((x) => toca(x, "imagem"));
  (doc.tracado?.mapas || []).forEach((m) => toca(m, "imagem"));
  return doc;
}

/** Um anexo novo da zona e do tipo indicados. */
export function novoAnexo(zona, tipo) {
  const base = { zona, tipo, titulo: "" };
  if (tipo === "imagem") return { ...base, imagem: "", legenda: "" };
  return { ...base, texto: "" };
}

/** Os anexos de uma zona, com o índice que têm na lista completa. */
export function anexosDaZona(doc, zona) {
  return (doc?.extras || []).map((x, i) => ({ x, i })).filter(({ x }) => x.zona === zona);
}
