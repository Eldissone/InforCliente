/**
 * Núcleo do Calendário Financeiro: períodos, filtros e totais.
 *
 * Sem DOM e sem pedidos, para se poder testar. Segue o `agdView` do protótipo
 * (prototipo.html): doze meses do ano escolhido, ou doze semanas à volta da
 * semana atual (duas para trás, nove para a frente); o que cai fora fica em
 * «Anteriores» ou «Depois», e o que não tem data em «Sem data».
 */

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Soma dias a uma data AAAA-MM-DD. */
export function addDays(key, days) {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** A segunda-feira da semana de uma data AAAA-MM-DD. */
export function weekOf(key) {
  const d = new Date(`${key}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  return addDays(key, -dow);
}

/** Os períodos visíveis: 12 meses (`M`) ou 12 semanas (`S`). */
export function periodKeys({ per, ano, hoje }) {
  if (per === "S") {
    const w = weekOf(hoje);
    return Array.from({ length: 12 }, (_, i) => addDays(w, (i - 2) * 7));
  }
  return Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);
}

/** Em que período cai uma data: uma das chaves, ou `ant`, `dep`, `sd`. */
export function periodOf(per, data, keys) {
  if (!data) return "sd";
  const k = per === "S" ? weekOf(data) : data.slice(0, 7);
  if (keys.includes(k)) return k;
  return k < keys[0] ? "ant" : "dep";
}

const fmtDia = (key) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

/** Nome do período por extenso. */
export function periodLabel(per, k) {
  if (k === "ant") return "Anteriores";
  if (k === "dep") return "Depois";
  if (k === "sd") return "Sem data";
  if (k === "tudo") return "Todos os períodos";
  if (per === "S") return `Semana de ${fmtDia(k)} a ${fmtDia(addDays(k, 6))}`;
  return `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
}

/** Nome curto, para o cartão do período. */
export function periodShort(per, k) {
  if (["ant", "dep", "sd"].includes(k)) return periodLabel(per, k);
  if (per === "S") return `${fmtDia(k)}–${fmtDia(addDays(k, 6))}`;
  return `${MESES[Number(k.slice(5, 7)) - 1].slice(0, 3)} ${k.slice(2, 4)}`;
}

/** Minúsculas e sem acentos, para a pesquisa. */
export function norm(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Aplica os filtros e agrupa por período.
 *
 * @param {Array} itens linhas do `/finance/calendar`
 * @param {object} F filtros: `per` (M|S), `ano`, `lado` ("" | P | R),
 *   `prev` (incluir previstos), `q` (pesquisa), `sel` (período escolhido)
 * @param {string} hoje AAAA-MM-DD
 */
export function buildCalendar(itens, F, hoje) {
  const keys = periodKeys({ per: F.per, ano: F.ano, hoje });
  const atual = F.per === "S" ? weekOf(hoje) : hoje.slice(0, 7);
  const q = norm(F.q || "").trim();

  const visiveis = (itens || []).filter(
    (x) =>
      (!F.lado || x.lado === F.lado) &&
      (F.prev || x.estado !== "prev") &&
      (!q || norm([x.entidade, x.doc, x.sub, x.grupo, x.valor].join(" ")).includes(q))
  );

  const P = {};
  for (const x of visiveis) {
    const k = periodOf(F.per, x.data, keys);
    const p = (P[k] = P[k] || { R: 0, P: 0, nR: 0, nP: 0, atr: 0 });
    p[x.lado] += x.valor;
    p[`n${x.lado}`] += 1;
    if (x.estado === "atr") p.atr += 1;
  }

  const ordem = [...(P.ant ? ["ant"] : []), ...keys, ...(P.dep ? ["dep"] : []), ...(P.sd ? ["sd"] : [])];
  const periodos = ordem.map((k) => {
    const p = P[k] || { R: 0, P: 0, nR: 0, nP: 0, atr: 0 };
    return { k, ...p, saldo: p.R - p.P, atual: k === atual };
  });

  // O período escolhido: o que vier no filtro, se ainda existir; senão o
  // atual; senão o primeiro.
  let sel = F.sel;
  if (sel !== "tudo" && !ordem.includes(sel)) sel = keys.includes(atual) ? atual : keys[0];

  const doPeriodo = sel === "tudo" ? visiveis : visiveis.filter((x) => periodOf(F.per, x.data, keys) === sel);

  const lado = (l) => {
    const L = doPeriodo
      .filter((x) => x.lado === l)
      .sort((a, b) => (a.data || "9").localeCompare(b.data || "9") || b.valor - a.valor);
    const grupos = new Map();
    for (const x of L) {
      if (!grupos.has(x.grupo)) grupos.set(x.grupo, []);
      grupos.get(x.grupo).push(x);
    }
    return {
      total: L.reduce((s, x) => s + x.valor, 0),
      n: L.length,
      grupos: [...grupos.entries()]
        .map(([nome, linhas]) => ({ nome, total: linhas.reduce((s, x) => s + x.valor, 0), linhas }))
        .sort((a, b) => b.total - a.total),
    };
  };

  const R = lado("R");
  const Pg = lado("P");
  return { keys, atual, sel, periodos, receber: R, pagar: Pg, saldo: R.total - Pg.total };
}
