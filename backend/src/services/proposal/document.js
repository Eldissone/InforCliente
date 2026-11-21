/**
 * O documento da Proposta Técnica e Comercial — **fonte única**.
 *
 * Espelha o `buildD` / `lotFromBudget` / `finalD` do protótipo (§8.1 do plano).
 * O que sai daqui é exactamente a estrutura que o modelo
 * `.plans/anexos/template-proposta-mbt.html` lê: os mesmos 23 campos, com os
 * mesmos nomes. É esse modelo que desenha a pré-visualização **e** o PDF, por
 * isso o que se vê no ecrã é o que sai no ficheiro.
 *
 * Nada aqui toca na base de dados: recebe o orçamento já lido e devolve um
 * objeto. Assim o documento testa-se sem servidor e sem Postgres.
 */

const { calcBudget, DIRECT } = require("../budget/calc");
const { PROPOSAL_STANDARD } = require("./standard");

const N = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round(N(v) * 100) / 100;
const sum = (arr, f = (x) => x) => (arr || []).reduce((s, x) => s + N(f(x)), 0);
const isBlank = (v) => v === null || v === undefined || v === "";
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const today = () => new Date().toISOString().slice(0, 10);

function addDays(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

/**
 * Como a lista de preços se apresenta ao cliente.
 *
 * `fmt` manda no corpo da lista:
 *  - `detalhada`   → materiais por família e os serviços em capítulos próprios;
 *  - `artigo_incl` → uma linha por artigo, com o serviço já incluído no preço;
 *  - `artigo_sep`  → uma linha por artigo, com fornecimento e montagem em colunas;
 *  - `capitulos`   → uma linha por família, tudo incluído;
 *  - `global`      → sem lista: só o valor total (trata-se no `finalizeDocument`).
 * `mat` e `serv` só contam no formato `detalhada`.
 */
const PRICE_LIST_FORMATS = ["mapa", "detalhada", "artigo_incl", "artigo_sep", "capitulos", "global"];
const DEFAULT_OPTIONS = Object.freeze({ fmt: "mapa", mat: "linhas", serv: "linhas" });

/**
 * A lista de preços **tal como está no mapa de quantidades** do orçamento.
 *
 * É este o caminho normal: o mapa de quantidades é a tabela que o cliente
 * mandou ou que lhe vai ser apresentada — com o código do artigo, a designação,
 * a unidade, a quantidade e o preço unitário, agrupada por capítulos («1 —
 * RAMAL DE MÉDIA TENSÃO 30 kV»). Derivá-la das folhas de custo, como fazia o
 * protótipo, só faz sentido nos orçamentos em que o preço **sai** do custo; nos
 * que têm o preço dado pelo cliente (o método `PRECO_DADO`) as folhas de custo
 * podem nem existir, e a lista derivada vinha vazia.
 */
function priceListFromQuantities(budget, R, { nome, designacao } = {}) {
  const rows = (R.qt || []).filter((l) => l.desc || l.total);
  const caps = [];
  let cn = 0;
  for (const l of rows) {
    const g = l.grupo || "Trabalhos";
    let cap = caps.find((c) => c.designacao === g);
    if (!cap) {
      cn += 1;
      cap = { numero: String(cn), designacao: g, designacao_curta: g, itens: [] };
      caps.push(cap);
    }
    const q = N(l.q) > 0 ? N(l.q) : 1;
    const unidade = N(l.q) > 0 ? l.un || "un" : "vg";
    cap.itens.push({
      item: l.cod || `${cap.numero}.${cap.itens.length + 1}`,
      designacao: l.desc || "—",
      unidade,
      quantidade: r2(q),
      // No mapa de quantidades o preço é um só: o unitário da proposta.
      preco_material: r2(N(l.total) / q),
      preco_servico: 0,
      total: r2(l.total),
    });
  }
  return {
    nome,
    designacao,
    capitulos: caps.filter((c) => c.itens.length),
    colunas: "pu",
    _pv: r2(R.PVsi),
    _ct: r2(R.CT),
    _mb: R.MBpct,
    _orc: [budget.number, budget.revision].filter(Boolean).join(" "),
  };
}

/** O orçamento traz mapa de quantidades com valor? */
function hasQuantitySheet(R) {
  return (R?.qt || []).some((l) => N(l.total) > 0);
}

/**
 * A lista de preços de um lote, a partir do orçamento.
 *
 * O preço de venda de cada linha de custo (`pv`) é escalado por `k` para que a
 * soma da lista dê exactamente o preço de venda do orçamento — o ajuste, os
 * indiretos e os riscos estão no `PVsi` mas não em nenhuma linha direta. Sem
 * isto, a lista que o cliente assina não bate com o orçamento aprovado.
 */
function priceList(budget, R, { nome, designacao } = {}, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...(options || {}) };
  // Com mapa de quantidades, é ele a lista — a não ser que se peça outro formato.
  if (o.fmt === "mapa") {
    if (hasQuantitySheet(R)) return priceListFromQuantities(budget, R, { nome, designacao });
    o.fmt = "detalhada"; // sem mapa, deriva-se das folhas de custo
  }
  const S = budget.sheets || {};
  const sheet = (k) => (Array.isArray(S[k]) ? S[k] : []);
  const direct = sum(DIRECT, (c) => R.PVbyCat?.[c[0]]);
  const k = direct > 0 ? R.PVsi / direct : 0;

  const caps = [];
  let cn = 0;
  const it = (des, un, q, tot, isMat) => {
    let quantidade = N(q);
    let unidade = un;
    if (!(quantidade > 0)) {
      quantidade = 1;
      unidade = "vg";
    }
    const pu = r2(N(tot) / quantidade);
    return {
      designacao: des || "—",
      unidade: unidade || "vg",
      quantidade: r2(quantidade),
      preco_material: isMat ? pu : 0,
      preco_servico: isMat ? 0 : pu,
      total: r2(tot),
    };
  };
  const cap = (des, curta, itens) => {
    const rows = (itens || []).filter((x) => x && x.total > 0.005);
    if (!rows.length) return;
    cn += 1;
    rows.forEach((x, i) => {
      x.item = `${cn}.${i + 1}`;
    });
    caps.push({ numero: String(cn), designacao: des, designacao_curta: curta || des, itens: rows });
  };

  const mats = sheet("mat");
  const familias = [...new Set([...(budget.lists?.familias || []), ...mats.map((m) => m.fam || "Outros")])];
  const matPV = mats.map((_, i) => N(R.mat?.[i]?.pv) * k);
  const sMat = sum(matPV);
  const servico = R.PVsi - sMat;
  const famName = (f) => (f === "Outros" ? "Outros materiais" : `Fornecimento e montagem de ${f}`);

  // ── Formatos por artigo: o serviço reparte-se pelos materiais ─────────────
  if (sMat > 0.005 && ["artigo_incl", "artigo_sep", "capitulos"].includes(o.fmt)) {
    const share = (i) => (sMat === 0 ? 0 : (servico * matPV[i]) / sMat);
    if (o.fmt === "capitulos") {
      cap(
        "Fornecimento e montagem",
        "Fornecimento e montagem",
        familias.map((f) => {
          const t = sum(mats.map((m, i) => ((m.fam || "Outros") === f ? matPV[i] + share(i) : 0)));
          return it(f === "Outros" ? "Outros materiais e trabalhos" : `${f} — fornecimento e montagem`, "vg", 1, t, true);
        })
      );
    } else {
      familias.forEach((f) =>
        cap(
          famName(f),
          f,
          mats
            .map((m, i) => {
              if ((m.fam || "Outros") !== f) return null;
              const x = it(m.desc, m.un, m.q, matPV[i] + share(i), true);
              if (o.fmt === "artigo_sep") {
                const q = x.quantidade;
                x.preco_material = r2(matPV[i] / q);
                x.preco_servico = r2(share(i) / q);
                x.total = r2(matPV[i] + share(i));
              }
              return x;
            })
            .filter(Boolean)
        )
      );
    }
    return {
      nome,
      designacao,
      capitulos: caps,
      colunas: o.fmt === "artigo_sep" ? "fm" : "pu",
      _pv: r2(R.PVsi),
      _ct: r2(R.CT),
      _mb: R.MBpct,
      _orc: [budget.number, budget.revision].filter(Boolean).join(" "),
    };
  }

  // ── Formato detalhado: materiais de um lado, serviços do outro ────────────
  if (o.mat === "linhas") {
    familias.forEach((f) =>
      cap(
        f === "Outros" ? "Outros materiais" : `Fornecimento de ${f}`,
        f,
        mats.map((m, i) => ((m.fam || "Outros") === f ? it(m.desc, m.un, m.q, matPV[i], true) : null)).filter(Boolean)
      )
    );
  } else {
    cap(
      "Fornecimento de materiais",
      "Materiais",
      familias.map((f) => it(f, "vg", 1, sum(mats.map((m, i) => ((m.fam || "Outros") === f ? matPV[i] : 0))), true))
    );
  }

  const pv = (key, i) => N(R[key]?.[i]?.pv) * k;
  const svc = [
    ["Mão de obra especializada", "Mão de obra", sheet("rh").map((x, i) => it(x.funcao, "dia", N(x.n) * N(x.d), pv("rh", i)))],
    [
      "Equipamentos, viaturas e ferramentas",
      "Equipamentos",
      [
        ...sheet("eq").map((x, i) => it(x.equip, "dia", N(x.q) * N(x.d), pv("eq", i))),
        ...sheet("vi").map((x, i) => it(x.viat, "dia", N(x.q) * N(x.d), pv("vi", i))),
        ...sheet("fe").map((x, i) => {
          const un = R.fe?.[i]?.un === "dia" ? "dia" : "un";
          return it(x.item, un, un === "dia" ? N(x.q) * N(x.dias) : N(x.q), pv("fe", i));
        }),
      ],
    ],
    ["Subempreitadas e serviços especializados", "Subempreitadas", sheet("sub").map((x, i) => it(x.desc || x.sub, x.un, x.q, pv("sub", i)))],
    [
      "Estaleiro, transportes e logística",
      "Estaleiro",
      sheet("log").map((x, i) => it(x.item, R.log?.[i]?.un || "vg", N(x.q) * (isBlank(x.dias) ? 1 : N(x.dias)), pv("log", i))),
    ],
    [
      "Engenharia e gestão de obra",
      "Engenharia",
      sheet("eng").map((x, i) =>
        it(
          [x.area, x.rec].filter(Boolean).join(" — "),
          x.ut === "Meses" ? "mês" : x.ut === "Dias" ? "dia" : "h",
          N(x.n) * N(x.q) * (isBlank(x.ded) ? 1 : N(x.ded)),
          pv("eng", i)
        )
      ),
    ],
  ];

  if (o.serv === "linhas") svc.forEach(([d, c, itens]) => cap(d, c, itens));
  else if (o.serv === "capitulo") {
    cap(
      "Mão de obra, equipamentos e serviços",
      "Serviços",
      svc.map(([d, , itens]) => it(d, "vg", 1, sum(itens, (x) => x.total)))
    );
  } else {
    cap("Mão de obra e serviços", "Serviços", [
      it("Mão de obra, equipamentos, subempreitadas, estaleiro e engenharia", "vg", 1, servico),
    ]);
  }

  return {
    nome,
    designacao,
    capitulos: caps,
    _pv: r2(R.PVsi),
    _ct: r2(R.CT),
    _mb: R.MBpct,
    _orc: [budget.number, budget.revision].filter(Boolean).join(" "),
  };
}

/** A memória descritiva por omissão: a introdução escrita, os pontos por preencher. */
function defaultMemory(obra, local, empresa) {
  return {
    texto:
      "A presente Memória Descritiva e Justificativa tem por objectivo descrever e fundamentar as soluções técnicas propostas pela " +
      `${empresa || PROPOSAL_STANDARD.empresa.nome} para a execução da empreitada` +
      (obra ? ` de <b>${obra}</b>` : "") +
      (local ? `, em ${local}` : "") +
      ".",
    seccoes: [
      { titulo: "Enquadramento e descrição geral do projecto", texto: "" },
      { titulo: "Descrição da solução técnica", texto: "" },
      { titulo: "Justificação das soluções adoptadas", texto: "" },
      { titulo: "Normas e regulamentos aplicáveis", texto: "" },
    ],
    fotos: [],
  };
}

/**
 * O cronograma por omissão: sete actividades em duas fases, distribuídas pelo
 * prazo do orçamento. É um ponto de partida para editar, não uma invenção de
 * datas — o prazo é o que está no orçamento.
 */
function defaultSchedule(params, standard) {
  const a = params.inicio || today();
  const b = params.fim || addDays(a, 120);
  const dias = Math.max(7, Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000));
  const at = (f) => addDays(a, Math.round(dias * f));
  return {
    texto: standard.cronograma_texto,
    fases: [
      { id: "I", nome: "Fase I · Preparação e fornecimentos" },
      { id: "II", nome: "Fase II · Execução, ensaios e receção" },
    ],
    actividades: [
      { fase: "I", nome: "Mobilização e montagem do estaleiro", inicio: a, fim: at(0.06) },
      { fase: "I", nome: "Levantamento topográfico e piquetagem", inicio: at(0.03), fim: at(0.12) },
      { fase: "I", nome: "Aprovisionamento de materiais", inicio: a, fim: at(0.35) },
      { fase: "II", nome: "Construção civil e implantação de apoios", inicio: at(0.1), fim: at(0.55) },
      { fase: "II", nome: "Montagem de redes e equipamentos", inicio: at(0.3), fim: at(0.85) },
      { fase: "II", nome: "Ensaios e comissionamento", inicio: at(0.85), fim: at(0.95) },
      { fase: "II", nome: "Desmobilização e receção provisória", inicio: at(0.95), fim: b },
    ],
  };
}

/**
 * Monta o documento da proposta a partir de um ou mais orçamentos.
 *
 * Cada orçamento é um **lote**: é assim que o protótipo junta, por exemplo, três
 * localidades numa só proposta. O primeiro manda nos dados do cabeçalho (cliente,
 * prazo, moeda, IVA).
 *
 * @param {object[]} budgets orçamentos já lidos (com `params`, `sheets`, `dispatch`)
 * @param {object} [opts.standard] o texto-padrão da empresa (ganha ao `PROPOSAL_STANDARD`)
 * @param {object} [opts.options] formato da lista de preços
 * @param {string} [opts.reference] referência do documento (ex.: PROP-2026-0001)
 */
function buildDocument(budgets, { standard, options, reference, revision, lotNames } = {}) {
  const list = (Array.isArray(budgets) ? budgets : [budgets]).filter(Boolean);
  if (!list.length) throw new Error("SEM_ORCAMENTO");
  const S0 = { ...PROPOSAL_STANDARD, ...(standard || {}) };
  const o = { ...DEFAULT_OPTIONS, ...(options || {}) };

  const first = list[0];
  const P = first.params || {};
  const R = calcBudget(first);
  const results = list.map((b) => (b === first ? R : calcBudget(b)));
  const totPV = sum(results, (r) => r.PVsi);
  const meses = Math.max(1, Math.round(N(R.durMeses)));
  const moeda = P.moedaBase || "AOA";

  const nomeDe = (b, i) => {
    if (lotNames && lotNames[i]) return lotNames[i];
    const p = b.params || {};
    return (String(p.local || "").split(",")[0] || p.obra || `Lote ${i + 1}`).trim();
  };

  const lotes = list.map((b, i) => priceList(b, results[i], { nome: nomeDe(b, i), designacao: (b.params || {}).obra || nomeDe(b, i) }, o));

  return {
    documento: {
      tipo: S0.documento.tipo,
      referencia: reference || first.number || "",
      revisao: String(revision ?? P.revisao ?? "0").replace(/^R/i, ""),
      data: today(),
      moeda,
      taxa_iva: N(P.iva),
    },
    cliente: { nome: P.cliente || "", nome_curto: P.cliente || "" },
    obra: {
      titulo: P.obra || "",
      titulo_capa_destaque: String(P.local || "").split(",")[0].trim(),
      subtitulo: list.length > 1 ? lotes.map((l) => l.nome) : [String(P.local || "").split(",")[0].trim()].filter(Boolean),
      designacao_completa: P.obra || "",
      localizacao: P.local || "",
    },
    empresa: clone(S0.empresa),
    capa: {
      imagem: "",
      slogan: S0.capa?.slogan || "",
      slogan_sub: "",
      ilustracao: "foto",
      indicadores: [
        { valor: String(Math.round(totPV / 1e6)), unidade: `M ${moeda}`, rotulo: "Valor da proposta s/ IVA" },
        { valor: String(meses), unidade: "meses", rotulo: "Prazo de execução" },
      ],
    },
    sintese: {
      prazo: `${meses} ${meses === 1 ? "mês" : "meses"}`,
      inicio: S0.sintese.inicio,
      garantia: S0.sintese.garantia,
      extra: list.length > 1 ? [{ icone: "map", titulo: `${list.length} lotes`, texto: lotes.map((l) => l.nome).join(" · ") }] : [],
    },
    objectivo:
      `A presente proposta tem por objectivo definir as condições técnicas e comerciais para a execução dos trabalhos de <b>“${P.obra || ""}”</b>` +
      (P.local ? `, localizados em <b>${P.local}</b>` : "") +
      `, conforme solicitado pelo ${P.cliente || "Cliente"}.`,
    documentacao_referencia: "A presente Proposta Técnica e Comercial teve por base os elementos e o escopo enviados pelo Cliente.",
    memoria: defaultMemory(P.obra || "", P.local || "", S0.empresa?.nome),
    condicoes_tecnicas: {
      introducao:
        "Os trabalhos serão executados de acordo com as normas técnicas aplicáveis e as boas práticas de execução, com a sequência e os meios descritos nesta proposta.",
      fases: [],
    },
    quadro_resumo: null,
    tracado: null,
    cronograma: defaultSchedule(P, S0),
    organograma: { texto: S0.organograma_texto, diagramas: [] },
    execucao_trabalhos: clone(S0.execucao_trabalhos),
    qualidade_seguranca_ambiente: clone(S0.qualidade_seguranca_ambiente),
    exclusoes: clone(S0.exclusoes),
    comercial: { ...clone(S0.comercial), lotes },
    prazo: {
      titulo: `Início em ${S0.sintese.inicio} · Duração de ${meses} ${meses === 1 ? "mês" : "meses"}`,
      texto:
        `O início dos trabalhos está previsto para ${S0.sintese.inicio} após a adjudicação. A duração prevista para a execução da ` +
        `empreitada é de ${Math.round(N(R.durDias))} dias de calendário (cerca de ${meses} ${meses === 1 ? "mês" : "meses"}).`,
    },
    recepcao: S0.recepcao,
    validade: `A presente proposta tem a validade de <b>${Math.round(N(P.validade) || 30)} dias</b> após a data da sua assinatura ou data de envio por email.`,
    contactos: clone(S0.contactos),
    extras: [],
  };
}

/**
 * O documento pronto a desenhar: limpa o que está vazio, para o modelo não
 * abrir secções sem conteúdo. É o `finalD` do protótipo.
 */
function finalizeDocument(doc, options = {}) {
  const D = clone(doc) || {};
  const o = { ...DEFAULT_OPTIONS, ...(options || {}) };

  if (D.memoria) {
    D.memoria.seccoes = (D.memoria.seccoes || []).filter((s) => String(s.texto || "").trim());
    D.memoria.fotos = (D.memoria.fotos || []).filter((f) => f.imagem);
  }
  D.comercial = D.comercial || {};
  // Formato «global»: o cliente vê o valor, não a lista artigo a artigo.
  D.comercial.sem_lista = o.fmt === "global";
  if (D.tracado && !D.tracado.texto && !(D.tracado.criterios || []).length && !(D.tracado.mapas || []).length) D.tracado = null;
  if (D.condicoes_tecnicas && !(D.condicoes_tecnicas.fases || []).length && !D.condicoes_tecnicas.introducao) D.condicoes_tecnicas = {};
  if (D.cronograma && !(D.cronograma.actividades || []).length) D.cronograma = null;
  if (D.organograma && !(D.organograma.diagramas || []).length && !D.organograma.texto) D.organograma = null;
  D.extras = (D.extras || []).map((x) => {
    const y = { ...x };
    delete y.asset;
    delete y.origem;
    // Colunas escondidas numa tabela anexa não vão para o documento.
    if (y.tipo === "tabela" && (y.ocultas || []).length) {
      const keep = (y.colunas || []).map((_, j) => !y.ocultas.includes(j));
      y.colunas = (y.colunas || []).filter((_, j) => keep[j]);
      y.linhas = (y.linhas || []).map((r) => r.filter((_, j) => keep[j]));
    }
    delete y.ocultas;
    return y;
  });
  return D;
}

/** O total da lista de preços de um lote, e de todos. */
const lotTotal = (lote) => r2(sum(lote?.capitulos, (c) => sum(c.itens, (i) => i.total)));
const documentTotal = (doc) => r2(sum(doc?.comercial?.lotes, lotTotal));

module.exports = {
  PRICE_LIST_FORMATS,
  hasQuantitySheet,
  priceListFromQuantities,
  DEFAULT_OPTIONS,
  priceList,
  buildDocument,
  finalizeDocument,
  defaultMemory,
  defaultSchedule,
  lotTotal,
  documentTotal,
};
