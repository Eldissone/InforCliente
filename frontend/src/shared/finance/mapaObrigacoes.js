/**
 * P4 Mapa de Obrigações e R4 Mapa de Recebimentos — o `obMapa` do protótipo
 * (`V.fobr` e `V.frmap`).
 *
 * Uma matriz em árvore: nas linhas, o tipo de obrigação › o fornecedor › o
 * documento (a pagar), ou o cliente › a obra › o documento (a receber); nas
 * colunas, os meses do ano (ou de um semestre) ou as semanas. Clica-se numa
 * linha para a abrir. Filtros: o estado (atrasado, em aberto, pago em parte,
 * previsto ou compromisso), o período e «incluir anteriores».
 *
 * Os documentos são os do Calendário Financeiro (`/finance/calendar`): o que
 * está por pagar ou por receber, com o valor em dívida. Uma moeda de cada vez.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, codigoNoCabecalho, seg, vazio, erro } from "./f2Ui.js";
import { addDays, weekOf } from "./calendarioCore.js";

const root = () => document.getElementById("financeRoot");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const S = { d: null, erro: null, lado: "P", F: null, abertos: new Set() };

const ESTADOS_P = [
  ["atr", "Atrasado"],
  ["abe", "Em aberto"],
  ["pp", "Pago em parte"],
  ["comp", "Compromisso"],
];
const ESTADOS_R = [
  ["atr", "Atrasado"],
  ["abe", "Em aberto"],
  ["pp", "Recebido em parte"],
  ["prev", "Previsto"],
];

function colunas(F, hoje) {
  if (F.per === "S") {
    let d = addDays(weekOf(hoje), -14);
    return Array.from({ length: 8 }, () => {
      const k = d;
      d = addDays(d, 7);
      return k;
    });
  }
  const m0 = F.sem === "2" ? 7 : 1;
  const n = F.sem ? 6 : 12;
  return Array.from({ length: n }, (_, i) => `${F.ano}-${String(i + m0).padStart(2, "0")}`);
}

const chaveDe = (F, data) => (F.per === "S" ? weekOf(data) : data.slice(0, 7));

function caminho(x, F) {
  if (S.lado === "R") return [x.entidade || "—", x.sub || "Sem obra", x.doc || "—"];
  if (F.by === "forn") return [x.entidade || "—", x.doc || "—"];
  return [x.grupo || "Outros", x.entidade || "—", x.doc || "—"];
}

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const F = S.F;
  const { hoje, itens } = S.d;
  const moedas = [...new Set(itens.filter((x) => x.lado === S.lado).map((x) => String(x.moeda || "AOA").toUpperCase()))].sort((a, b) =>
    a === "AOA" ? -1 : b === "AOA" ? 1 : a.localeCompare(b)
  );
  if (!moedas.includes(F.moeda)) F.moeda = moedas.includes("AOA") ? "AOA" : moedas[0] || "AOA";
  const K = colunas(F, hoje);
  const cols = (F.per === "M" && F.inc ? ["ant"] : []).concat(K);
  const estados = S.lado === "R" ? ESTADOS_R : ESTADOS_P;

  // A árvore: cada nó soma por coluna e no total (v633: Em Dívida por omissão, ou Valor Original).
  const valDe = (x) => (S.lado === "P" && F.mo === "orig" ? Number(x.valorOriginal || x.valor) || 0 : Number(x.valor) || 0);
  const T = { v: {}, C: {} };
  for (const x of itens) {
    if (x.lado !== S.lado || String(x.moeda || "AOA").toUpperCase() !== F.moeda || !F.est.includes(x.estado) || !x.data) continue;
    if (S.lado === "P" && /s[óo]cio/i.test(x.grupo || "")) continue; // v611: Mapa de Obrigações sem sócios
    let k = chaveDe(F, x.data);
    if (!K.includes(k)) {
      if (F.per === "M" && F.inc && x.data < `${K[0]}-01`) k = "ant";
      else continue;
    }
    const v = valDe(x);
    const nos = [T];
    let c = T;
    const parts = caminho(x, F);
    for (let idx = 0; idx < parts.length; idx++) {
      const p = parts[idx];
      c = c.C[p] = c.C[p] || { k: p, v: {}, C: {}, fornKey: null };
      if (S.lado === "P" && ((F.by === "forn" && idx === 0) || (F.by !== "forn" && idx === 1))) {
        c.fornKey = x.supplierId ? `id:${x.supplierId}` : `nome:${String(x.entidade || "").trim().toLowerCase()}`;
      }
      nos.push(c);
    }
    for (const n of nos) {
      n.v[k] = (n.v[k] || 0) + v;
      n.v.t = (n.v.t || 0) + v;
    }
  }
  const atual = F.per === "S" ? weekOf(hoje) : hoje.slice(0, 7);
  const rot = (k) => (k === "ant" ? "Anterior" : F.per === "S" ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : MESES[Number(k.slice(5, 7)) - 1]);
  const niveis = S.lado === "P" && F.by === "forn" ? 2 : 3;
  const linhas = (n, id, nv) =>
    Object.values(n.C)
      .sort((a, b) => (b.v.t || 0) - (a.v.t || 0))
      .map((z) => {
        const key = `${id}›${z.k}`;
        const tem = Object.keys(z.C).length && nv < niveis;
        const ab = S.abertos.has(key);
        const ccLink =
          S.lado === "P" && z.fornKey && z.k !== "—" && z.k !== "Sem beneficiário"
            ? ` <a class="t3-lnk" style="font-size:11px;margin-left:6px" href="/compras/conta-corrente-fornecedores?fornecedor=${encodeURIComponent(z.fornKey)}&from=mapa-obrigacoes" data-stop title="Abrir Conta Corrente deste fornecedor">Conta Corrente ↗</a>`
            : "";
        return `<tr class="p4-n${nv}${tem ? " fx2-k-row" : ""}"${tem ? ` data-p4ab="${esc(key)}"` : ""}>
          <td style="padding-left:${6 + (nv - 1) * 16}px">${tem ? (ab ? "▾ " : "▸ ") : ""}${esc(z.k)}${ccLink}</td>
          ${cols.map((k) => `<td class="r">${z.v[k] ? (nv === 1 ? `<b>${fmt(z.v[k])}</b>` : fmt(z.v[k])) : ""}</td>`).join("")}
          <td class="r"><b>${fmt(z.v.t || 0)}</b></td></tr>${tem && ab ? linhas(z, key, nv + 1) : ""}`;
      })
      .join("");
  const anos = [String(Number(hoje.slice(0, 4)) - 1), hoje.slice(0, 4), String(Number(hoje.slice(0, 4)) + 1)];
  const titulo = S.lado === "R" ? "Cliente / Obra" : F.by === "forn" ? "Fornecedor / Documento" : "Tipo de Obrigação";
  const corpo = linhas(T, "r", 1);
  const atr = itens.filter((x) => x.lado === S.lado && String(x.moeda || "AOA").toUpperCase() === F.moeda && x.estado === "atr").reduce((s, x) => s + x.valor, 0);
  const tot = itens.filter((x) => x.lado === S.lado && String(x.moeda || "AOA").toUpperCase() === F.moeda && x.estado !== "prev" && x.estado !== "comp").reduce((s, x) => s + x.valor, 0);

  el.innerHTML = `
    <div class="fx2-chips">
      <span class="fx2-chip"><span>${S.lado === "R" ? "Por Receber" : "Em Dívida"}</span> <b>${fmt(tot)}</b></span>
      <span class="fx2-chip"><span>Atrasado</span> <b class="f0-neg">${fmt(atr)}</b></span>
    </div>
    <div class="cp-filtros">
      <span class="fx2-mut">Estado</span>
      ${estados.map(([k, l]) => `<button type="button" class="fx2-chip${F.est.includes(k) ? " on" : ""}" data-p4est="${k}">${esc(l)}</button>`).join("")}
      ${S.lado === "P" ? seg("p4", "by", F.by, [["geral", "Por tipo"], ["forn", "Por fornecedor"]]) : ""}
      ${S.lado === "P" ? seg("p4", "mo", F.mo, [["div", "Em Dívida"], ["orig", "Valor Original"]]) : ""}
      ${moedas.length > 1 ? seg("p4", "moeda", F.moeda, moedas.map((m) => [m, m])) : ""}
    </div>
    <div class="cp-filtros">
      ${seg("p4", "per", F.per, [["M", "Mensal"], ["S", "Semanal"]])}
      ${
        F.per === "M"
          ? `${seg("p4", "ano", F.ano, anos.map((a) => [a, a]))} ${seg("p4", "sem", F.sem, [["", "Ano"], ["1", "1.º Sem."], ["2", "2.º Sem."]])}
             <label class="cp-venc"><input type="checkbox" data-p4inc${F.inc ? " checked" : ""}> incluir anteriores</label>`
          : ""
      }
      <button type="button" class="finance-btn finance-btn--sm" data-p4tudo>${S.abertos.size ? "Fechar tudo" : "Expandir"}</button>
    </div>
    <section class="fx2-blk"><div class="fx2-tw"><table class="fx2-t p4-t">
      <thead><tr><th>${titulo}</th>${cols.map((k) => `<th class="r${k === atual ? " p4-now" : ""}">${rot(k)}</th>`).join("")}<th class="r">Total</th></tr></thead>
      <tbody>${corpo || `<tr><td colspan="${cols.length + 2}" class="fx2-mut">Sem valores com estes filtros.</td></tr>`}</tbody>
      <tfoot><tr class="f0-tot"><td>${S.lado === "R" ? "V. Líq. a Receber" : "Total"}</td>${cols.map((k) => `<td class="r">${T.v[k] ? fmt(T.v[k]) : ""}</td>`).join("")}<td class="r">${fmt(T.v.t || 0)}</td></tr></tfoot>
    </table></div></section>
    <p class="fcal-nota">Cada documento conta na coluna do seu vencimento, pelo valor ainda em dívida. ${
      S.lado === "R"
        ? "Os previstos são autos aprovados ainda sem fatura e autos planeados (R3)."
        : "Os compromissos são encomendas e pedidos ainda por aprovar; os impostos por pagar entram de G1."
    } O dia a dia destes documentos está no <a href="/Financeiro/calendario?ver=${S.lado === "R" ? "receber" : "pagar"}">calendário</a>.</p>`;
}

async function carregar() {
  try {
    S.d = await apiRequest("/finance/calendar");
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render(meta) {
  S.lado = meta?.lado === "R" ? "R" : "P";
  codigoNoCabecalho(S.lado === "R" ? "R4" : "P4");
  const hoje = new Date().toISOString().slice(0, 10);
  S.F = {
    per: "M",
    ano: hoje.slice(0, 4),
    sem: window.innerWidth < 1600 ? (Number(hoje.slice(5, 7)) <= 6 ? "1" : "2") : "",
    inc: true,
    by: "geral",
    mo: "div",
    moeda: "AOA",
    est: S.lado === "R" ? ["atr", "abe", "pp", "prev"] : ["atr", "abe", "pp"],
  };
  const el = root();
  el.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-stop]")) return;
    const st = t.closest("[data-p4est]");
    if (st) {
      const k = st.dataset.p4est;
      S.F.est = S.F.est.includes(k) ? S.F.est.filter((x) => x !== k) : [...S.F.est, k];
      return desenhar();
    }
    const b = t.closest("[data-p4]");
    if (b) {
      const [k, v] = b.dataset.p4.split("|");
      S.F[k] = v;
      S.abertos.clear();
      return desenhar();
    }
    const ab = t.closest("[data-p4ab]");
    if (ab) {
      const k = ab.dataset.p4ab;
      if (S.abertos.has(k)) S.abertos.delete(k);
      else S.abertos.add(k);
      return desenhar();
    }
    if (t.closest("[data-p4tudo]")) {
      if (S.abertos.size) S.abertos.clear();
      else {
        // Abre nível a nível: as linhas de baixo só existem depois de abrir as de cima.
        for (let i = 0; i < 3; i++) {
          for (const r of root().querySelectorAll("[data-p4ab]")) S.abertos.add(r.dataset.p4ab);
          desenhar();
        }
        return;
      }
      desenhar();
    }
  });
  el.addEventListener("change", (e) => {
    if (e.target.dataset.p4inc === undefined) return;
    S.F.inc = e.target.checked;
    desenhar();
  });
  desenhar();
  await carregar();
}
