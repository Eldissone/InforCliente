/**
 * Núcleo do F2 Mapa de Fluxos e do T8 Mapa de Fluxo de Caixa.
 *
 * Sem DOM e sem pedidos, para se poder testar. Os registos vêm do
 * `/finance/flows`: `{ lado: R|P, data, valor, moeda, tipo: real|comp|prev,
 * grupo, sub, texto }`. Uma moeda de cada vez — nunca se somam moedas.
 */

import { addDays, weekOf, MESES } from "./calendarioCore.js";

const MES3 = MESES.map((m) => m.slice(0, 3));

/** Soma meses a uma chave AAAA-MM. */
export function addMonths(k, n) {
  const [y, m] = k.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function monthLabel(k) {
  return `${MES3[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
}

/**
 * F2 — os períodos: os 12 meses do ano, ou 12 semanas (quatro para trás e
 * oito para a frente), como no protótipo.
 */
export function periodosF2({ per, ano, hoje }) {
  if (per === "S") {
    const w = weekOf(hoje);
    return Array.from({ length: 12 }, (_, i) => addDays(w, (i - 4) * 7));
  }
  return Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);
}

/** Que registos entram em cada modo do F2. */
const MODO = {
  tudo: () => true,
  real: (r) => r.tipo === "real",
  comp: (r) => r.tipo === "comp",
};

/**
 * F2 Mapa de Fluxos: recebimentos e pagamentos por período, agrupados (com o
 * detalhe por subgrupo), o saldo de cada período e o acumulado.
 *
 * @param {Array} registos
 * @param {object} F `per` (M|S), `ano`, `modo` (tudo|real|comp), `moeda`
 * @param {string} hoje AAAA-MM-DD
 */
export function mapaFluxos(registos, F, hoje) {
  const K = periodosF2({ per: F.per, ano: F.ano, hoje });
  const atual = F.per === "S" ? weekOf(hoje) : hoje.slice(0, 7);
  const kOf = (d) => {
    if (!d) return null;
    const k = F.per === "S" ? weekOf(d) : d.slice(0, 7);
    return K.includes(k) ? k : null;
  };
  const entra = MODO[F.modo] || MODO.tudo;
  const L = (registos || []).filter((r) => r.moeda === F.moeda && entra(r));

  const agg = (lado) => {
    const G = new Map();
    const T = { t: 0 };
    for (const z of L) {
      if (z.lado !== lado) continue;
      const k = kOf(z.data);
      if (!k) continue;
      if (!G.has(z.grupo)) G.set(z.grupo, { k: z.grupo, v: { t: 0 }, S: new Map() });
      const g = G.get(z.grupo);
      if (!g.S.has(z.sub)) g.S.set(z.sub, { k: z.sub, v: { t: 0 } });
      const s = g.S.get(z.sub);
      for (const m of [g.v, s.v, T]) {
        m[k] = (m[k] || 0) + z.valor;
        m.t += z.valor;
      }
    }
    const grupos = [...G.values()]
      .map((g) => ({ k: g.k, v: g.v, S: [...g.S.values()].sort((a, b) => b.v.t - a.v.t) }))
      .sort((a, b) => b.v.t - a.v.t);
    return { G: grupos, T };
  };

  const R = agg("R");
  const P = agg("P");
  let ac = 0;
  const saldos = K.map((k) => {
    const s = (R.T[k] || 0) - (P.T[k] || 0);
    ac += s;
    return { k, s, ac };
  });
  return { K, atual, R, P, saldos, tR: R.T.t, tP: P.T.t };
}

/**
 * T8 Mapa de Fluxo de Caixa: doze meses a partir de três para trás. Os meses
 * passados são realizado; o atual, realizado mais previsto; os futuros,
 * previsto. O que já venceu e não se pagou nem recebeu conta no mês atual —
 * é dinheiro que ainda tem de entrar ou sair. O saldo do primeiro mês é o
 * saldo de hoje menos o que entrou e saiu desde o início desse mês.
 *
 * @param {Array} registos
 * @param {object} F `ini` (meses antes do atual, -3), `n` (12), `vis`
 *   (tudo|real|prev), `moeda`
 * @param {string} hoje AAAA-MM-DD
 * @param {number} saldoHoje saldo das contas hoje, nesta moeda
 */
export function mapaCaixa(registos, F, hoje, saldoHoje) {
  const m0 = hoje.slice(0, 7);
  const M = Array.from({ length: F.n || 12 }, (_, i) => addMonths(m0, (F.ini ?? -3) + i));
  const first = M[0];
  const last = M[M.length - 1];
  const L = (registos || []).filter((r) => r.moeda === F.moeda);

  const cel = new Map();
  const put = (mk, lado, grupo, x) => {
    const key = `${mk}|${lado}|${grupo}`;
    const z = cel.get(key) || { v: 0, L: [] };
    z.v += x.valor;
    z.L.push(x);
    cel.set(key, z);
  };

  let atrE = 0;
  let atrS = 0;
  // Auto aprovado cuja data estimada já passou: não é dívida vencida do
  // cliente — ainda nem há fatura. Conta-se à parte.
  let porFaturar = 0;
  for (const x of L) {
    if (!x.data) continue;
    let mk = x.data.slice(0, 7);
    if (x.tipo === "real") {
      if (mk < first || mk > last || mk > m0) continue;
      if (F.vis !== "prev") put(mk, x.lado, x.grupo, x);
      continue;
    }
    if (x.data < hoje) {
      mk = m0;
      if (x.tipo === "prev") porFaturar += x.valor;
      else if (x.lado === "R") atrE += x.valor;
      else atrS += x.valor;
    }
    if (mk < m0 || mk > last) continue;
    if (F.vis !== "real") put(mk, x.lado, x.grupo, { ...x, prev: true });
  }

  const grupos = (lado) =>
    [...new Set([...cel.keys()].filter((k) => k.split("|")[1] === lado).map((k) => k.split("|").slice(2).join("|")))]
      .map((g) => {
        const vals = M.map((mk) => cel.get(`${mk}|${lado}|${g}`) || null);
        return { g, vals, total: vals.reduce((s, z) => s + (z ? z.v : 0), 0) };
      })
      .filter((r) => r.total > 0.5)
      .sort((a, b) => b.total - a.total);

  const E = grupos("R");
  const S = grupos("P");
  const totE = M.map((_, i) => E.reduce((s, r) => s + (r.vals[i] ? r.vals[i].v : 0), 0));
  const totS = M.map((_, i) => S.reduce((s, r) => s + (r.vals[i] ? r.vals[i].v : 0), 0));

  const realDesde = L.filter((x) => x.tipo === "real" && x.data && x.data >= `${first}-01` && x.data <= hoje).reduce(
    (s, x) => s + (x.lado === "R" ? x.valor : -x.valor),
    0
  );
  let saldo = (Number(saldoHoje) || 0) - realDesde;
  const ini = [];
  const fim = [];
  M.forEach((_, i) => {
    ini.push(saldo);
    saldo += totE[i] - totS[i];
    fim.push(saldo);
  });

  const negativo = M.find((mk, i) => fim[i] < 0 && mk >= m0) || null;
  const fase = (mk) => (mk < m0 ? "real" : mk === m0 ? "misto" : "prev");
  return { M, m0, fase, E, S, totE, totS, ini, fim, atrE, atrS, porFaturar, negativo };
}

/* ─── T4 Previsão de Tesouraria (`V.fflx` do protótipo) ─────────────────────── */

function addDaysK(k, n) {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const ddmm = (k) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;

/**
 * Os períodos do T4 a partir de hoje: 31 dias (`D`), 13 semanas a começar à
 * segunda-feira (`S`) ou 12 meses (`M`). O primeiro começa sempre hoje.
 */
export function periodosT4(g, hoje) {
  const P = [];
  if (g === "D") {
    for (let k = 0; k < 31; k++) {
      const a = addDaysK(hoje, k);
      P.push({ k: a, a, b: a, l: k ? `${ddmm(a)}/${a.slice(0, 4)}` : "Hoje" });
    }
  } else if (g === "M") {
    for (let k = 0; k < 12; k++) {
      const m = addMonths(hoje.slice(0, 7), k);
      const fim = addDaysK(`${addMonths(m, 1)}-01`, -1);
      P.push({ k: m, a: k ? `${m}-01` : hoje, b: fim, l: monthLabel(m) });
    }
  } else {
    const dw = (new Date(`${hoje}T00:00:00Z`).getUTCDay() + 6) % 7;
    const seg = addDaysK(hoje, -dw);
    for (let k = 0; k < 13; k++) {
      const a = addDaysK(seg, 7 * k);
      const b = addDaysK(a, 6);
      P.push({ k: a, a: k ? a : hoje, b, l: `${k ? "" : "Esta semana · "}${ddmm(a)} – ${ddmm(b)}` });
    }
  }
  return P;
}

/**
 * A tabela do T4. Só conta o que ainda não aconteceu (registos `comp` e
 * `prev`): o realizado já está no saldo de hoje.
 *  - Entradas previstas: o que há a receber (faturas e autos por faturar);
 *  - Saídas comprometidas: o que há a pagar já assumido (`comp`);
 *  - Saídas previstas: o que se espera pagar mas não está firme (`prev`).
 * «Saldo só c/ comprometido» = saldo de hoje − saídas comprometidas;
 * «Saldo previsto» = saldo de hoje + entradas − todas as saídas. O que está
 * em atraso entra logo na primeira linha; «depois» e «sem data» não entram
 * nos saldos.
 */
export function previsaoT4(registos, { g = "S", hoje, moeda = "AOA", saldoHoje = 0 }) {
  const I = (registos || []).filter((r) => r.moeda === moeda && r.tipo !== "real");
  const P = periodosT4(g, hoje);
  const fim = P[P.length - 1].b;
  const dentro = (x, p) => x.data && x.data >= p.a && x.data <= p.b;
  const R = [
    { k: "atr", l: "Em atraso (já vencido)", L: I.filter((x) => x.data && x.data < hoje) },
    ...P.map((p) => ({ k: p.k, l: p.l, L: I.filter((x) => dentro(x, p)) })),
    { k: "dep", l: `Depois de ${ddmm(fim)}/${fim.slice(0, 4)}`, L: I.filter((x) => x.data && x.data > fim), fora: true },
    { k: "sd", l: "Sem data", L: I.filter((x) => !x.data), fora: true },
  ];
  const soma = (L, f) => Math.round(L.filter(f).reduce((s, x) => s + Math.abs(Number(x.valor) || 0), 0) * 100) / 100;
  let rc = saldoHoje;
  let rp = saldoHoje;
  const linhas = R.map((r) => {
    const en = soma(r.L, (x) => x.lado === "R");
    const sc = soma(r.L, (x) => x.lado === "P" && x.tipo === "comp");
    const sp = soma(r.L, (x) => x.lado === "P" && x.tipo === "prev");
    if (!r.fora) {
      rc -= sc;
      rp += en - sc - sp;
    }
    return { ...r, en, sc, sp, rc: Math.round(rc * 100) / 100, rp: Math.round(rp * 100) / 100 };
  });
  const dentroH = linhas.filter((r) => !r.fora);
  const tot = (k) => Math.round(dentroH.reduce((s, r) => s + r[k], 0) * 100) / 100;
  const neg = dentroH.find((r) => r.rp < 0) || null;
  return {
    fim,
    linhas,
    saldoHoje,
    comprometido: tot("sc"),
    entradas: tot("en"),
    saidasPrevistas: tot("sp"),
    atrasoComprometido: linhas[0].sc,
    saldoFim: dentroH[dentroH.length - 1].rp,
    negativo: neg ? neg.l : null,
  };
}
