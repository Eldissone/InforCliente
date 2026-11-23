/**
 * Orçamento › Financeiro da obra — T1 Cronograma Previsto do Cliente e T2
 * Tesouraria Prevista (o `fcCalc` do protótipo). Sem ecrã: testável.
 *
 * A produção (valor executado a preço de venda) segue o ritmo dos custos: os
 * salários pelo pessoal de cada dia do planeamento (P1), os meios pelas
 * máquinas de cada dia, os materiais pelos dias das tarefas que os consomem;
 * o resto (ferramentas, subempreitadas, estaleiro, estrutura…) por igual.
 * Sem planeamento, tudo por igual entre o início e o fim da obra — como a T3.
 *
 * Os autos seguem as condições de pagamento do cliente (T3): modo,
 * periodicidade, prazos de aprovação e de pagamento, retenção. As saídas
 * seguem a condição de cada material (pronto pagamento na encomenda, crédito
 * N dias depois da entrega…), os salários no fim do mês, os meios e os outros
 * custos a N dias do fim do mês. Valores sem IVA.
 */

const N = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isBlank = (v) => v === null || v === undefined || v === "";

export function addDays(k, n) {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function eom(k) {
  const [y, m] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const weekOf = (k) => addDays(k, -((new Date(`${k}T00:00:00Z`).getUTCDay() + 6) % 7));

const FIN0 = { per: "M", sal: "fim", meios: 30, outros: 30, antec: 15, saldo0: 0 };
const TERMS0 = { modo: "amort", adPct: 0.3, adiant: null, adData: null, amort: null, per: "Mensal", prim: null, aprov: 15, pag: 30, ret: 0.05, marcos: [] };

/** As datas dos autos: fim de cada mês, ou de 14 em 14 / 7 em 7 dias, até ao fim da obra. */
function datasAutos(t, a, b) {
  const step = t.per === "Semanal" ? 7 : t.per === "Quinzenal" ? 14 : 0;
  const prim = t.prim || (step ? addDays(a, step - 1) : eom(a));
  const out = [];
  let d = prim;
  for (let k = 1; out.length < 1500; k++) {
    out.push(d);
    if (d >= b) break;
    if (step) d = addDays(prim, k * step);
    else {
      const [y, m] = prim.split("-").map(Number);
      d = new Date(Date.UTC(y, m - 1 + k + 1, 0)).toISOString().slice(0, 10);
    }
  }
  return out;
}

/**
 * @param {object} o
 * @param {object} o.P params do orçamento (inicio, fim, pmp, iva)
 * @param {object} o.R resultado do cálculo do orçamento (C, mat, PVsi)
 * @param {Array} o.mat linhas da folha de materiais
 * @param {object|null} o.plano `producaoCore.planear` (ou null)
 * @param {object} o.terms condições de pagamento previstas (T3)
 * @param {object} o.fin regras de pagamento internas (T2)
 */
export function calcular({ P, R, mat, plano, terms, fin }) {
  const f = { ...FIN0, ...(fin || {}) };
  const t = { ...TERMS0, ...(terms || {}) };
  const a = (plano?.ini && plano.ini) || P?.inicio;
  let b = (plano?.fim && plano.fim) || P?.fim;
  if (!a || !b) return null;
  if (b < a) b = a;
  const dias = [];
  for (let d = a; d <= b && dias.length < 4000; d = addDays(d, 1)) dias.push(d);
  const C = R?.C || {};
  const PV = N(R?.PVsi);

  // ─── custos incorridos por dia ───
  const inc = { mat: {}, sal: {}, mei: {}, out: {} };
  const add = (o, d, v) => {
    if (v) o[d] = (o[d] || 0) + v;
  };
  const pessoas = {};
  const maquinas = {};
  for (const tk of plano?.tarefas || []) {
    const eq = Math.max(1, N(tk.equipas) || 1);
    for (const d of tk.dias || []) {
      pessoas[d] = (pessoas[d] || 0) + (tk.equipa || []).reduce((s, p) => s + N(p.n) * eq, 0);
      maquinas[d] = (maquinas[d] || 0) + (tk.maq || []).reduce((s, m) => s + N(m.n) * eq, 0);
    }
  }
  for (const p of plano?.ind || []) for (const d of p.dias || []) pessoas[d] = (pessoas[d] || 0) + N(p.n) * (isBlank(p.ded) ? 1 : N(p.ded));
  for (const m of plano?.indm || []) for (const d of m.dias || []) maquinas[d] = (maquinas[d] || 0) + (N(m.n) || 1);
  const espalhar = (o, total, peso) => {
    if (!total) return;
    let ws = dias.map((d) => peso[d] || 0);
    let s = ws.reduce((x, y) => x + y, 0);
    if (!(s > 0)) {
      ws = dias.map(() => 1);
      s = dias.length;
    }
    dias.forEach((d, i) => add(o, d, (total * ws[i]) / s));
  };
  espalhar(inc.sal, N(C.RH) + N(C.ENG), pessoas);
  espalhar(inc.mei, N(C.EQ) + N(C.VI), maquinas);
  espalhar(inc.out, N(C.FE) + N(C.SUB) + N(C.LOG) + N(C.IND) + N(C.FIN) + N(C.RIS), {});

  // Materiais: nos dias das tarefas que os consomem; os outros no início.
  const usos = {};
  for (const tk of plano?.tarefas || []) {
    for (const m of tk.mat || []) {
      const k = String(m.desc || "").trim().toLowerCase();
      if (!k || !(tk.dias || []).length) continue;
      const q = (N(tk.q) * N(m.c)) / tk.dias.length;
      usos[k] = usos[k] || {};
      for (const d of tk.dias) usos[k][d] = (usos[k][d] || 0) + q;
    }
  }
  const compras = [];
  const pagMat = {};
  (mat || []).forEach((m, i) => {
    const ct = N(R?.mat?.[i]?.ct);
    if (!(ct > 0)) return;
    const serie = usos[String(m.desc || "").trim().toLowerCase()];
    let partes = [];
    if (serie) {
      const tq = Object.values(serie).reduce((x, y) => x + y, 0);
      if (tq > 0) partes = Object.entries(serie).map(([d, q]) => [d < a ? a : d > b ? b : d, (ct * q) / tq]);
    }
    if (!partes.length) partes = [[a, ct]];
    const ent = isBlank(m.entrega) ? N(f.antec) : N(m.entrega);
    const cond = m.cond || "";
    let p1 = null;
    let pN = null;
    const pagar = (d, v) => {
      add(pagMat, d, v);
      if (!p1 || d < p1) p1 = d;
      if (!pN || d > pN) pN = d;
    };
    for (const [d, v] of partes) {
      add(inc.mat, d, v);
      const enc = addDays(d, -ent);
      const cr = /Crédito (\d+)/.exec(cond);
      if (cond === "Pronto pagamento") pagar(enc, v);
      else if (cr) pagar(addDays(d, Number(cr[1])), v);
      else if (/^Adiantamento/.test(cond) || /^50%/.test(cond)) {
        pagar(enc, v / 2);
        pagar(addDays(d, 30), v / 2);
      } else pagar(addDays(enc, N(P?.pmp) || 0), v);
    }
    const d0 = partes.reduce((p, q) => (!p || q[0] < p ? q[0] : p), null);
    compras.push({ desc: m.desc, forn: m.forn || "", cond: cond || `Prazo geral (${N(P?.pmp)} dias)`, ct, nec: d0, enc: addDays(d0, -ent), p1, pN, faseado: partes.length > 1 });
  });

  // ─── produção a preço de venda, ao ritmo dos custos ───
  const incDia = {};
  for (const o of Object.values(inc)) for (const [d, v] of Object.entries(o)) incDia[d] = (incDia[d] || 0) + v;
  const CTi = Object.values(incDia).reduce((x, y) => x + y, 0);
  const val = {};
  for (const d of dias) val[d] = CTi ? (PV * (incDia[d] || 0)) / CTi : PV / dias.length;

  // ─── autos e recebimentos (T3) ───
  const modo = t.modo || "amort";
  const A = modo === "autos" || modo === "marcos" ? 0 : !isBlank(t.adPct) ? PV * N(t.adPct) : N(t.adiant);
  const retP = N(t.ret);
  const autos = [];
  if (modo === "marcos") {
    const matD = t.matData || compras.reduce((p, c) => (!p || c.nec < p ? c.nec : p), null) || a;
    let ac = 0;
    const acum = dias.map((d) => [d, (ac += val[d])]);
    for (const m of t.marcos || []) {
      if (!(N(m.pct) > 0)) continue;
      const d =
        m.ev === "adj" ? t.adData || a : m.ev === "mat" ? matD : m.ev === "fim" ? b : m.ev === "data" ? m.data || b : (acum.find(([, v]) => PV && v / PV >= N(m.exec) - 1e-9) || [b])[0];
      const v = PV * N(m.pct);
      const adj = m.ev === "adj";
      const rt = adj ? 0 : v * retP;
      const ap = adj ? d : addDays(d, N(t.aprov));
      autos.push({ desc: m.desc || "Marco", d, de: null, v, am: 0, rt, liq: v - rt, ap, rc: adj ? d : addDays(ap, N(t.pag)) });
    }
    autos.sort((x, y) => x.d.localeCompare(y.d));
  } else {
    const datas = datasAutos(t, a, b);
    const kIni = modo === "inicial" && PV ? (PV - A) / PV : 1;
    const amP = modo !== "amort" ? 0 : isBlank(t.amort) ? (PV ? A / PV : 0) : N(t.amort);
    let resto = A;
    let vi = 0;
    datas.forEach((dt, i) => {
      const ultimo = i === datas.length - 1;
      let v = 0;
      while (vi < dias.length && (dias[vi] <= dt || ultimo)) v += val[dias[vi++]];
      v *= kIni;
      let am = modo !== "amort" ? 0 : Math.min(resto, v * amP);
      if (ultimo && modo === "amort") am = Math.min(resto, v);
      resto -= am;
      const rt = v * retP;
      const ap = addDays(dt, N(t.aprov));
      if (v > 0.5) autos.push({ desc: null, d: dt, de: i ? addDays(datas[i - 1], 1) : a, v, am, rt, liq: v - am - rt, ap, rc: addDays(ap, N(t.pag)) });
    });
  }
  autos.forEach((x, i) => (x.n = i + 1));

  // ─── pagamentos ───
  const pag = { mat: {}, sal: {}, mei: {}, out: {} };
  for (const [d, v] of Object.entries(pagMat)) add(pag.mat, d, v);
  const salDia = (d) => (f.sal === "fim" ? eom(d) : addDays(eom(d), N(f.sal)));
  for (const [d, v] of Object.entries(inc.sal)) add(pag.sal, salDia(d), v);
  for (const [d, v] of Object.entries(inc.mei)) add(pag.mei, addDays(eom(d), N(f.meios)), v);
  for (const [d, v] of Object.entries(inc.out)) add(pag.out, addDays(eom(d), N(f.outros)), v);
  const ent = {};
  if (A > 0) add(ent, t.adData || a, A);
  for (const x of autos) add(ent, x.rc, x.liq);

  return { a, b, PV, A, adData: t.adData || a, modo, autos, compras, ent, pag, inc, basis: plano?.tarefas?.length ? "producao" : "linear", f };
}

/** T2 — as linhas por período (mês ou semana): entradas, saídas por natureza, saldo e acumulado. */
export function tesouraria(o, per = "M") {
  if (!o) return { linhas: [], minB: 0, cobre: null };
  const chave = (d) => (per === "S" ? weekOf(d) : d.slice(0, 7));
  const L = new Map();
  const linha = (k) => {
    if (!L.has(k)) L.set(k, { k, ent: 0, mat: 0, sal: 0, mei: 0, out: 0 });
    return L.get(k);
  };
  for (const [d, v] of Object.entries(o.ent)) linha(chave(d)).ent += v;
  for (const nat of ["mat", "sal", "mei", "out"]) for (const [d, v] of Object.entries(o.pag[nat])) linha(chave(d))[nat] += v;
  let acc = N(o.f?.saldo0);
  let minB = acc;
  // Até quando o dinheiro (adiantamento incluído) chega: o último período antes de o acumulado ficar negativo.
  let cobre = null;
  let negativoEm = null;
  const linhas = [...L.values()]
    .sort((x, y) => x.k.localeCompare(y.k))
    .map((x) => {
      const sai = x.mat + x.sal + x.mei + x.out;
      acc += x.ent - sai;
      if (acc < minB) minB = acc;
      if (acc < -0.5 && !negativoEm) negativoEm = x.k;
      else if (!negativoEm) cobre = x.k;
      return { ...x, sai, saldo: x.ent - sai, acum: acc };
    });
  return { linhas, minB: Math.min(0, minB), cobre, negativoEm, total: { ent: linhas.reduce((s, x) => s + x.ent, 0), sai: linhas.reduce((s, x) => s + x.sai, 0) } };
}

/** T1 — as linhas para o cliente (com IVA) e os recebimentos por mês. */
export function cliente(o, iva = 0) {
  if (!o) return { linhas: [], meses: [] };
  const linhas = [];
  if (o.A > 0) linhas.push({ tipo: "Adiantamento", n: "", de: null, d: o.adData, v: 0, am: 0, rt: 0, liq: o.A, ap: null, rc: o.adData, pct: 0, pa: 0 });
  let pa = 0;
  for (const x of o.autos) {
    pa += x.v;
    linhas.push({ tipo: x.desc || `Auto ${x.n}`, n: x.n, de: x.de, d: x.d, v: x.v, am: x.am, rt: x.rt, liq: x.liq, ap: x.ap, rc: x.rc, pct: o.PV ? x.v / o.PV : 0, pa: o.PV ? pa / o.PV : 0 });
  }
  for (const r of linhas) {
    r.iva = r.liq * N(iva);
    r.tot = r.liq + r.iva;
  }
  const M = new Map();
  for (const r of linhas) {
    const k = String(r.rc || "").slice(0, 7);
    if (!k) continue;
    const m = M.get(k) || { k, liq: 0, tot: 0 };
    m.liq += r.liq;
    m.tot += r.tot;
    M.set(k, m);
  }
  let ac = 0;
  const meses = [...M.values()].sort((x, y) => x.k.localeCompare(y.k)).map((m) => ({ ...m, ac: (ac += m.tot) }));
  return { linhas, meses };
}
