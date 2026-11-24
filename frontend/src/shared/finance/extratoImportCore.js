/**
 * T3 Extratos Bancários — a leitura de um ficheiro de extrato (CSV / Excel),
 * como no `FXIMP` do protótipo. Sem dependências do navegador (testável).
 *
 *  - a tabela do ficheiro é uma lista de linhas (cada linha, lista de células);
 *  - descobre-se a linha de cabeçalho e a coluna de cada campo pelo nome
 *    (Data, Descrição, Valor ou Débito/Crédito, Saldo, Referência…);
 *  - o n.º da conta escrito no topo do ficheiro identifica a conta;
 *  - o saldo anterior vem do topo («Saldo anterior / inicial») ou calcula-se
 *    do saldo da 1.ª linha menos o seu valor.
 */

/** Campos que se podem mapear (o IMPF do protótipo, os que a app guarda). */
export const CAMPOS = [
  ["data", "Data mov."],
  ["dataEf", "Data efetiva"],
  ["desc", "Descrição"],
  ["valor", "Valor (com sinal)"],
  ["deb", "Débito"],
  ["cred", "Crédito"],
  ["saldo", "Saldo"],
  ["ref", "Referência"],
  ["docn", "Doc n.º"],
];

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** «1.234.567,89», «-1 234,50», «(1,234.50)», «1234.5-» → número; null se não for. */
export function parseMoney(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/-$/.test(s)) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (/^-/.test(s)) {
    neg = true;
    s = s.slice(1);
  }
  s = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;
  const lc = s.lastIndexOf(",");
  const lp = s.lastIndexOf(".");
  if (lc > lp) s = s.replace(/\./g, "").replace(",", ".");
  else if (lp > lc && lc >= 0) s = s.replace(/,/g, "");
  else if (lp >= 0 && s.split(".").length > 2) s = s.replace(/\./g, "");
  else if (lp >= 0 && /\.\d{3}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** «03/11/2026», «3-11-26», «2026-11-03», número de série do Excel → AAAA-MM-DD. */
export function parseDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const mo = Number(m[2]);
    const d = Number(m[1]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/** Texto (CSV / TXT) → tabela. Separador: ; tab | ou , (o mais frequente). */
export function tabelaDeTexto(texto) {
  const linhas = String(texto || "").replace(/^﻿/, "").split(/\r?\n/);
  const conta = { ";": 0, "\t": 0, "|": 0, ",": 0 };
  linhas.slice(0, 40).forEach((l) => Object.keys(conta).forEach((k) => (conta[k] += l.split(k).length - 1)));
  const sep = conta[";"] || conta["\t"] || conta["|"] ? [";", "\t", "|"].sort((a, b) => conta[b] - conta[a])[0] : ",";
  return linhas
    .filter((l) => l.trim())
    .map((l) => {
      const out = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (ch === '"') {
          if (q && l[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = !q;
        } else if (ch === sep && !q) {
          out.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      out.push(cur.trim());
      return out;
    });
}

const PISTAS = {
  data: [/^data( mov| (do )?movimento| operac| lancamento| valor)?\b/, /^date/, /^dt\b/],
  dataEf: [/^data (valor|efetiva|disponivel)/, /^value date/],
  desc: [/descri|^historico|^movimento$|^detalhe|^narrat|^operacao$/],
  valor: [/^valor$|^montante|^importancia|^amount/],
  deb: [/^debito|^debit|^saidas?$/],
  cred: [/^credito|^credit|^entradas?$/],
  saldo: [/^saldo/],
  ref: [/^ref|^n\.?o? (do )?doc|^documento/],
  docn: [/^doc\.? n|^n\.?o? fatura|^fatura/],
};

/** A linha de cabeçalho: a primeira com «data» e pelo menos mais um campo conhecido. */
export function linhaCabecalho(tabela) {
  for (let i = 0; i < Math.min(tabela.length, 40); i++) {
    const c = (tabela[i] || []).map(norm);
    const tem = (k) => c.some((x) => PISTAS[k].some((re) => re.test(x)));
    if (tem("data") && (tem("desc") || tem("valor") || tem("deb") || tem("cred"))) return i;
  }
  return -1;
}

/** Coluna de cada campo, pelo nome no cabeçalho; −1 se não houver. */
export function mapaAuto(tabela, hi) {
  const cab = hi >= 0 ? (tabela[hi] || []).map(norm) : [];
  const map = {};
  const usadas = new Set();
  for (const [k] of CAMPOS) {
    const j = cab.findIndex((x, i) => !usadas.has(i) && (PISTAS[k] || []).some((re) => re.test(x)));
    map[k] = j;
    if (j >= 0) usadas.add(j);
  }
  // Sem cabeçalho: 1.ª coluna data, última valor, as do meio descrição.
  if (hi < 0) {
    const w = Math.max(...tabela.slice(0, 20).map((r) => r.length), 0);
    Object.assign(map, { data: 0, desc: w > 2 ? 1 : -1, valor: w - 1 });
  }
  return map;
}

/** As linhas de movimento da tabela, já com data, descrição e valor com sinal. */
export function movimentosDaTabela(tabela, map, hi) {
  const cel = (r, k) => (map[k] >= 0 ? r[map[k]] : undefined);
  const out = [];
  for (const r of tabela.slice(hi + 1)) {
    const data = parseDate(cel(r, "data"));
    if (!data) continue;
    let valor = null;
    if (map.valor >= 0) valor = parseMoney(cel(r, "valor"));
    if (valor === null && (map.deb >= 0 || map.cred >= 0)) {
      const d = parseMoney(cel(r, "deb"));
      const c = parseMoney(cel(r, "cred"));
      if (d || c) valor = (c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0);
    }
    if (!valor) continue;
    const saldo = map.saldo >= 0 ? parseMoney(cel(r, "saldo")) : null;
    out.push({
      data,
      dataEf: map.dataEf >= 0 ? parseDate(cel(r, "dataEf")) : null,
      desc: String(cel(r, "desc") ?? "").trim(),
      valor: Math.round(valor * 100) / 100,
      saldo,
      ref: String(cel(r, "ref") ?? "").trim(),
      docn: String(cel(r, "docn") ?? "").trim(),
    });
  }
  return out;
}

/** O n.º da conta escrito no topo e a conta registada que lhe corresponde. */
export function contaDoFicheiro(tabela, hi, contas) {
  const topo = tabela.slice(0, Math.max(hi, 0) || 12).flat().join(" ");
  const nums = [...new Set((topo.match(/\d[\d\s.-]{5,}\d/g) || []).map((x) => x.replace(/\D/g, "")).filter((x) => x.length >= 6))];
  const iban = /\bAO\d{2}\s?(\d{4})/i.exec(topo);
  for (const n of nums) {
    const c = contas.find((k) => {
      const dig = [k.lastDigits, String(k.cardNumberMasked || "").replace(/\D/g, "")].filter((x) => x && x.length >= 3);
      return dig.some((d) => n.endsWith(d) || (d.length >= 6 && n.includes(d)));
    });
    if (c) return { num: n, conta: c };
  }
  return { num: nums[0] || "", conta: null, bancoIban: iban ? iban[1] : "" };
}

/** Saldo antes do 1.º movimento: o do topo, ou o saldo da 1.ª linha menos o seu valor. */
export function saldoAnterior(tabela, hi, movs) {
  for (const r of tabela.slice(0, Math.max(hi, 0))) {
    const i = r.findIndex((c) => /saldo (anterior|inicial)/.test(norm(c)));
    if (i < 0) continue;
    for (const c of r.slice(i + 1)) {
      const v = parseMoney(c);
      if (v !== null) return { valor: v, calculado: false };
    }
    const m = /saldo (?:anterior|inicial)[^\d-]*(-?[\d.,\s]+)/.exec(norm(r[i]));
    if (m && parseMoney(m[1]) !== null) return { valor: parseMoney(m[1]), calculado: false };
  }
  const ord = [...movs].sort((a, b) => a.data.localeCompare(b.data));
  const p = movs.find((m) => m.saldo !== null && m.data === ord[0]?.data);
  if (p) return { valor: Math.round((p.saldo - p.valor) * 100) / 100, calculado: true };
  return null;
}

/** Saldo no fim: o da linha mais recente que traga saldo. */
export function saldoFinal(movs) {
  const c = movs.filter((m) => m.saldo !== null);
  if (!c.length) return null;
  const maxData = c.reduce((a, m) => (m.data > a ? m.data : a), "");
  const ult = c.filter((m) => m.data === maxData);
  // No mesmo dia, o extrato vem ordenado: o último escrito (ou o primeiro, se vier do mais recente).
  const asc = movs.indexOf(c[0]) <= movs.indexOf(c[c.length - 1]) && c[0].data <= c[c.length - 1].data;
  return (asc ? ult[ult.length - 1] : ult[0]).saldo;
}

/**
 * A regra que classifica um movimento («a descrição contém…», e o sinal:
 * "" qualquer, "-" só saídas, "+" só entradas); a 1.ª que casa ganha. É a
 * mesma leitura do servidor (backend/src/services/finance/bankRules.js).
 */
export function regraPara(desc, saida, regras) {
  const d = norm(desc);
  return (
    (regras || []).find(
      (r) => r.texto && d.includes(norm(r.texto)) && (!r.sinal || (r.sinal === "-" ? saida : !saida)) && !(r.tipo === "RECEBIMENTO_CLIENTE" && saida)
    ) || null
  );
}

/** Só o tipo (sem sinal conhecido, vale qualquer). */
export function tipoPelasRegras(desc, regras, saida = null) {
  const r = saida === null ? (regras || []).find((x) => x.texto && norm(desc).includes(norm(x.texto))) : regraPara(desc, saida, regras);
  return r ? r.tipo : null;
}

/** Chave para reconhecer um movimento já importado na mesma conta. */
export const chaveMov = (data, valor, desc) => `${data}|${Math.round(Math.abs(valor) * 100)}|${valor < 0 ? "S" : "E"}|${norm(desc).replace(/\s+/g, " ")}`;
