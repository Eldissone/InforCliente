/**
 * Orçamento › Produção (P1–P8) — os cálculos, sem ecrã (testáveis).
 *
 * O documento de produção (`budget.production`):
 *   cal:    { inicio, dias (5|6|7), efic (0–1), feriados: ["AAAA-MM-DD"] }
 *   tarefas: [{ id, nome, un, q, rend (por equipa e por dia), equipas,
 *               equipa: [{ f, n }], maq: [{ tipo: "eq"|"vi", nome, n }],
 *               mat: [{ desc, un, c (consumo por unidade da tarefa) }],
 *               dep: [ids], ini (opcional, AAAA-MM-DD) }]
 *   ind:    [{ f, n, ded (0–1), ini?, fim? }]   pessoal indireto
 *   indm:   [{ tipo, nome, n, ini?, fim? }]     viaturas/equipamentos de apoio
 *   org:    { nomes: { [função]: "nome" } }
 *   epi:    { itens: [{ item, preco, por: { [função]: qtd } }] }
 *   alim:   { ativo, refeicoes (por pessoa/dia), custo (por refeição) }
 *
 * Como no protótipo: a duração de uma tarefa é a quantidade ÷ (rendimento ×
 * equipas × eficiência), em dias de trabalho; começa no início da obra, ou no
 * dia útil a seguir ao fim das tarefas de que depende, ou na data indicada.
 */

const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function addDays(k, n) {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Segunda-feira da semana de uma data. */
export function weekOf(k) {
  const dow = (new Date(`${k}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(k, -dow);
}

/** É dia de trabalho? (5 = seg–sex, 6 = seg–sáb, 7 = todos), sem feriados. */
export function diaUtil(k, cal) {
  const dias = N(cal?.dias) || 6;
  const dow = (new Date(`${k}T00:00:00Z`).getUTCDay() + 6) % 7; // seg = 0
  if (dow >= dias) return false;
  return !(cal?.feriados || []).includes(k);
}

/** O primeiro dia útil a partir de `k` (inclusive). */
export function proximoUtil(k, cal) {
  let d = k;
  for (let i = 0; i < 400 && !diaUtil(d, cal); i++) d = addDays(d, 1);
  return d;
}

/** Os `n` dias úteis a partir de `k`. */
export function diasUteis(k, n, cal) {
  const out = [];
  let d = proximoUtil(k, cal);
  for (let i = 0; out.length < n && i < 5000; i++) {
    if (diaUtil(d, cal)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** Duração de uma tarefa em dias de trabalho. */
export function duracao(t, cal) {
  const ef = N(cal?.efic) > 0 ? N(cal.efic) : 1;
  const por = N(t.rend) * Math.max(1, N(t.equipas) || 1) * ef;
  if (!(N(t.q) > 0) || !(por > 0)) return 0;
  return Math.ceil(N(t.q) / por - 1e-9);
}

/**
 * O plano: para cada tarefa, o início, o fim e os dias. As dependências
 * resolvem-se por ordem (uma tarefa só começa depois das de que depende);
 * um ciclo não bloqueia — a tarefa começa no início da obra.
 */
export function planear(prod, hoje = new Date().toISOString().slice(0, 10)) {
  const cal = prod?.cal || {};
  const inicio = proximoUtil(cal.inicio || hoje, cal);
  const T = prod?.tarefas || [];
  const res = new Map();
  const aVer = new Set();
  const calc = (t) => {
    if (res.has(t.id)) return res.get(t.id);
    if (aVer.has(t.id)) return null; // ciclo
    aVer.add(t.id);
    let ini = t.ini ? proximoUtil(t.ini, cal) : inicio;
    for (const d of t.dep || []) {
      const p = T.find((x) => x.id === d);
      const r = p && calc(p);
      if (r?.fim && addDays(r.fim, 1) > ini) ini = proximoUtil(addDays(r.fim, 1), cal);
    }
    const n = duracao(t, cal);
    const dias = n ? diasUteis(ini, n, cal) : [];
    const r = { id: t.id, ini: dias[0] || null, fim: dias[dias.length - 1] || null, n, dias };
    res.set(t.id, r);
    return r;
  };
  T.forEach(calc);
  const tarefas = T.map((t) => ({ ...t, ...res.get(t.id) }));
  const datas = tarefas.flatMap((t) => (t.ini ? [t.ini, t.fim] : [])).sort();
  const ini = datas[0] || null;
  const fim = datas[datas.length - 1] || null;
  // O pessoal indireto e os meios de apoio: a obra toda, salvo datas próprias.
  const periodo = (x) => {
    const a = x.ini || ini;
    const b = x.fim || fim;
    if (!a || !b || b < a) return [];
    const out = [];
    for (let d = proximoUtil(a, cal); d <= b; d = addDays(d, 1)) if (diaUtil(d, cal)) out.push(d);
    return out;
  };
  const ind = (prod?.ind || []).map((p) => ({ ...p, dias: periodo(p) }));
  const indm = (prod?.indm || []).map((m) => ({ ...m, dias: periodo(m) }));
  return { inicio, ini, fim, tarefas, ind, indm };
}

/** As semanas (segundas-feiras) do plano. */
export function semanas(plano) {
  if (!plano.ini || !plano.fim) return [];
  const out = [];
  for (let w = weekOf(plano.ini); w <= plano.fim; w = addDays(w, 7)) out.push(w);
  return out;
}

const somaSemana = (mapa, chave, dia, v) => {
  const w = weekOf(dia);
  if (!mapa.has(chave)) mapa.set(chave, new Map());
  const m = mapa.get(chave);
  m.set(w, (m.get(w) || 0) + v);
};

/** P5 — pessoas por função e por semana (máximo por dia na semana), e pessoas-dia. */
export function rhPorSemana(plano) {
  const porDia = new Map(); // função → dia → pessoas
  const add = (f, dia, n) => {
    if (!f || !(n > 0)) return;
    if (!porDia.has(f)) porDia.set(f, new Map());
    const m = porDia.get(f);
    m.set(dia, (m.get(dia) || 0) + n);
  };
  for (const t of plano.tarefas) for (const d of t.dias || []) for (const p of t.equipa || []) add(p.f, d, N(p.n) * Math.max(1, N(t.equipas) || 1));
  for (const p of plano.ind) for (const d of p.dias) add(p.f, d, N(p.n) * (p.ded === undefined || p.ded === null || p.ded === "" ? 1 : N(p.ded)));
  const out = [];
  for (const [f, m] of porDia) {
    const sem = new Map();
    let pd = 0;
    let max = 0;
    for (const [d, n] of m) {
      const w = weekOf(d);
      sem.set(w, Math.max(sem.get(w) || 0, n));
      pd += n;
      max = Math.max(max, n);
    }
    out.push({ f, semanas: Object.fromEntries(sem), pessoasDia: Math.round(pd * 100) / 100, max });
  }
  return out.sort((a, b) => b.pessoasDia - a.pessoasDia);
}

/** P4 — unidades de cada equipamento/viatura por semana, e unidades-dia. */
export function maqPorSemana(plano) {
  const porDia = new Map();
  const add = (k, dia, n) => {
    if (!(n > 0)) return;
    if (!porDia.has(k)) porDia.set(k, new Map());
    const m = porDia.get(k);
    m.set(dia, (m.get(dia) || 0) + n);
  };
  for (const t of plano.tarefas) for (const d of t.dias || []) for (const m of t.maq || []) if (m.nome) add(`${m.tipo || "eq"}|${m.nome}`, d, N(m.n) * Math.max(1, N(t.equipas) || 1));
  for (const m of plano.indm) for (const d of m.dias) if (m.nome) add(`${m.tipo || "vi"}|${m.nome}`, d, N(m.n) || 1);
  const out = [];
  for (const [k, m] of porDia) {
    const [tipo, nome] = k.split("|");
    const sem = new Map();
    let ud = 0;
    let max = 0;
    for (const [d, n] of m) {
      const w = weekOf(d);
      sem.set(w, Math.max(sem.get(w) || 0, n));
      ud += n;
      max = Math.max(max, n);
    }
    out.push({ tipo, nome, semanas: Object.fromEntries(sem), unidadesDia: ud, max });
  }
  return out.sort((a, b) => b.unidadesDia - a.unidadesDia);
}

/** P3 — a meta de cada tarefa por semana (quantidade a fazer, pela mesma cadência). */
export function metas(plano) {
  return plano.tarefas
    .filter((t) => t.n > 0)
    .map((t) => {
      const porDia = N(t.q) / t.n;
      const sem = new Map();
      for (const d of t.dias) sem.set(weekOf(d), (sem.get(weekOf(d)) || 0) + porDia);
      let ac = 0;
      const S = {};
      for (const [w, v] of [...sem.entries()].sort()) {
        ac += v;
        S[w] = { q: Math.round(v * 100) / 100, pct: N(t.q) ? Math.min(100, (ac / N(t.q)) * 100) : 0 };
      }
      return { id: t.id, nome: t.nome, un: t.un, q: N(t.q), semanas: S };
    });
}

/** Os materiais que as tarefas consomem (quantidade × consumo por unidade). */
export function materiais(plano) {
  const M = new Map();
  for (const t of plano.tarefas) {
    for (const m of t.mat || []) {
      if (!m.desc) continue;
      const k = `${m.desc}|${m.un || ""}`;
      const x = M.get(k) || { desc: m.desc, un: m.un || "un", q: 0 };
      x.q += N(t.q) * N(m.c);
      M.set(k, x);
    }
  }
  return [...M.values()].map((x) => ({ ...x, q: Math.round(x.q * 100) / 100 }));
}

/**
 * As linhas que o plano põe nas folhas de custo (marcadas `orig: "tarefas"`):
 * RH (função, pessoas, dias), Equipamentos e Viaturas (unidades, dias),
 * Materiais (quantidade). As outras linhas das folhas não se tocam.
 */
export function linhasParaFolhas(plano) {
  const rh = rhPorSemana(plano).map((r) => ({
    funcao: r.f,
    n: r.max,
    h: 8,
    d: r.max ? Math.round((r.pessoasDia / r.max) * 100) / 100 : 0,
    orig: "tarefas",
    obs: `Do planeamento: ${r.pessoasDia} pessoas-dia`,
  }));
  const M = maqPorSemana(plano);
  const eq = M.filter((m) => m.tipo === "eq").map((m) => ({ equip: m.nome, q: m.max, h: 8, d: m.max ? Math.round((m.unidadesDia / m.max) * 100) / 100 : 0, orig: "tarefas", obs: `Do planeamento: ${m.unidadesDia} unidades-dia` }));
  const vi = M.filter((m) => m.tipo === "vi").map((m) => ({ viat: m.nome, q: m.max, d: m.max ? Math.round((m.unidadesDia / m.max) * 100) / 100 : 0, orig: "tarefas", obs: `Do planeamento: ${m.unidadesDia} unidades-dia` }));
  const mat = materiais(plano).map((m) => ({ desc: m.desc, un: m.un, q: m.q, orig: "tarefas", obs: "Consumo das tarefas" }));
  return { rh, eq, vi, mat };
}

/** Junta as linhas do plano a uma folha: tira as antigas «tarefas» e mantém as escritas à mão (com os preços já postos). */
export function aplicarFolha(atuais, novas, chave) {
  const antigas = new Map((atuais || []).filter((r) => r.orig === "tarefas").map((r) => [r[chave], r]));
  const manuais = (atuais || []).filter((r) => r.orig !== "tarefas");
  // Mantém o que o utilizador acrescentou numa linha «tarefas» (preço, moeda, margem).
  const fundidas = novas.map((n) => ({ ...(antigas.get(n[chave]) || {}), ...n }));
  return [...manuais, ...fundidas];
}

/** P7 — EPI: por função, quantas peças de cada item; total = pessoas (máx.) × peças × preço. */
export function epi(prod, rh) {
  const maxPor = new Map(rh.map((r) => [r.f, r.max]));
  const itens = (prod?.epi?.itens || []).map((it) => {
    let pecas = 0;
    for (const [f, q] of Object.entries(it.por || {})) pecas += N(q) * (maxPor.get(f) || 0);
    return { item: it.item, preco: N(it.preco), pecas, total: Math.round(pecas * N(it.preco) * 100) / 100 };
  });
  return { itens, total: Math.round(itens.reduce((s, x) => s + x.total, 0) * 100) / 100 };
}

/** P8 — Alimentação: pessoas-dia × refeições × custo. */
export function alimentacao(prod, rh) {
  const a = prod?.alim || {};
  const pd = rh.reduce((s, r) => s + r.pessoasDia, 0);
  const ref = N(a.refeicoes) || 0;
  const total = a.ativo ? Math.round(pd * ref * N(a.custo) * 100) / 100 : 0;
  return { pessoasDia: Math.round(pd * 100) / 100, refeicoes: Math.round(pd * ref * 100) / 100, total };
}

/** BoQ → tarefas: cada linha do mapa de quantidades com quantidade passa a tarefa. */
export function tarefasDoMapa(qt, existentes = []) {
  const ja = new Set(existentes.map((t) => `${t.nome}|${t.un}`));
  let k = existentes.length;
  return (qt || [])
    .filter((l) => String(l.desc || "").trim() && N(l.q) > 0 && !ja.has(`${String(l.desc).trim()}|${l.un || "un"}`))
    .map((l) => ({ id: `t${Date.now().toString(36)}${(k++).toString(36)}`, nome: String(l.desc).trim(), un: l.un || "un", q: N(l.q), rend: 0, equipas: 1, equipa: [], maq: [], mat: [], dep: [] }));
}
