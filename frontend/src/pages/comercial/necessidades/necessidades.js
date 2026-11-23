/**
 * Comercial › Compras › C0 Necessidades em orçamento (o `V.cnec` do protótipo).
 *
 * Lista: os orçamentos em curso com quantos artigos têm por comprar, por tipo,
 * e o estado do preço (🔴 sem preço · 🟡 antigo ou de barém · 🟢 cotado).
 * Detalhe: os artigos de um orçamento, para escolher os que vão no pedido de
 * cotação — exporta-se o pedido (Excel, para enviar aos fornecedores) e
 * avisa-se a Logística. Vista consolidada: o mesmo artigo de vários orçamentos.
 *
 * Os pedidos de cotação da app são por obra; um orçamento ainda não tem obra,
 * por isso aqui o pedido sai em Excel e a Logística é avisada.
 */

import { apiRequest } from "/services/api.js";
import { toast, escapeHtml } from "/shared/ui.js";
import { initComercialPage, canEdit } from "/shared/comercial/page.js";

const esc = (v) => escapeHtml(String(v ?? ""));
const fmt = (v, d = 0) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
const dt = (k) => (k ? String(k).slice(0, 10).split("-").reverse().join("/") : "—");
const SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const EST = { none: ["🔴", "Sem preço"], old: ["🟡", "Preço antigo ou de barém"], ok: ["🟢", "Cotado e válido"] };
const ESTADO = { EM_ELABORACAO: "Em elaboração", EM_ANALISE: "Em análise", APROVADO: "Aprovado", PROPOSTA_ENVIADA: "Proposta enviada" };

const S = { lista: null, det: null, src: null, cat: "", est: "", q: "", sel: new Set(), erro: null };
const root = () => document.getElementById("cmContent");
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function lista() {
  const L = S.lista.orcamentos;
  const cats = S.lista.cats;
  if (!L.length) return `<p class="cm-lead">Não há orçamentos em curso com artigos para comprar. Os orçamentos aparecem aqui quando têm materiais, EPI, ferramentas ou mantimentos com quantidade.</p>`;
  return `<div class="nc-grid">${L.map(
    (o) => `<button type="button" class="nc-card" data-ncsrc="${esc(o.id)}">
      <div class="nc-t"><b>${esc(o.numero)}</b> <span class="cm-pill">${esc(ESTADO[o.estado] || o.estado)}</span>${o.pronto ? ' <span class="cm-pill is-good">✔ pronto para cotação</span>' : ' <span class="cm-pill">pode mudar</span>'}</div>
      <div class="nc-o">${esc(o.obra || "")}</div>
      <div class="nc-m">${o.inicio ? `Início ${dt(o.inicio)} · ` : ""}${o.artigos} artigos · ${cats.map(([k, l]) => (o.porCat[k] ? `${l} ${o.porCat[k]}` : "")).filter(Boolean).join(" · ")}</div>
      <div class="nc-s"><span>🔴 ${o.semPreco} sem preço</span><span>🟡 ${o.antigo} preço antigo/barém</span><span>🟢 ${o.cotados} cotados</span>${o.pedidos ? `<span>📨 ${o.pedidos} pedido(s) de cotação</span>` : ""}</div>
      <span class="nc-a">Abrir ›</span></button>`
  ).join("")}</div>
  ${L.length > 1 ? `<p class="cm-calc" style="margin-top:.75rem">Para juntar o mesmo artigo de vários orçamentos num só pedido (mais volume, melhor preço): <a href="#" data-ncsrc="__all">vista consolidada de todos os orçamentos</a>.</p>` : ""}`;
}

function filtrados() {
  const q = norm(S.q).trim();
  return S.det.artigos.filter((r) => (!S.cat || r.cat === S.cat) && (!S.est || r.est === S.est) && (!q || norm(r.desc).includes(q)));
}

function detalhe() {
  const D = S.det;
  const todos = S.src === "__all";
  const all = D.artigos;
  const L = filtrados();
  const cnt = (k) => all.filter((r) => r.est === k).length;
  const cats = D.cats;
  return `<div class="cm-head-actions" style="margin-bottom:.5rem"><button type="button" class="cm-chip" data-ncsrc="">‹ Todos os orçamentos</button></div>
  <h2 class="cm-panel-title">${todos ? "Vista consolidada" : esc(D.orcamento.numero)} <span class="cm-calc">${todos ? "· todos os orçamentos em curso" : `· ${esc(D.orcamento.obra || "")}`}</span></h2>
  <div class="cm-grupos" style="margin:.5rem 0">
    <span class="cm-chip"><span>Artigos</span><b>${all.length}</b></span>
    <span class="cm-chip"><span>🔴 Sem preço</span><b>${cnt("none")}</b></span>
    <span class="cm-chip"><span>🟡 Preço antigo ou de barém</span><b>${cnt("old")}</b></span>
    <span class="cm-chip"><span>🟢 Cotados e válidos</span><b>${cnt("ok")}</b></span>
  </div>
  ${
    !todos && D.pedidos.length
      ? `<div class="cm-note" style="margin-bottom:.5rem">Pedidos de cotação deste orçamento: ${D.pedidos.map((p) => `${dt(p.data)} · ${esc(p.por || "")} · ${p.linhas} linha(s)`).join(" — ")}</div>`
      : ""
  }
  <div class="cm-head-actions" style="flex-wrap:wrap;margin-bottom:.5rem">
    ${[["", "Todos"], ...cats].map(([k, l]) => `<button type="button" class="cm-chip${S.cat === k ? " is-on" : ""}" data-nc="cat|${k}">${esc(l)} (${k ? all.filter((r) => r.cat === k).length : all.length})</button>`).join("")}
    <select class="cell-list" data-ncf="est"><option value="">Todos os estados</option>${Object.entries(EST).map(([k, v]) => `<option value="${k}"${S.est === k ? " selected" : ""}>${v[0]} ${v[1]}</option>`).join("")}</select>
    <input class="cell-manual" data-ncq placeholder="Procurar artigo…" value="${esc(S.q)}">
  </div>
  ${
    L.length
      ? `<div class="cm-table-wrap"><table class="cm-table"><thead><tr><th><input type="checkbox" data-ncall ${L.every((r) => S.sel.has(r.k)) ? "checked" : ""}></th><th>Preço</th>${S.cat ? "" : "<th>Tipo</th>"}<th>Artigo</th><th>Un.</th><th class="num">Quantidade</th><th class="num">Preço no orçamento</th><th class="num">Último preço cotado</th>${todos ? "<th>Orçamentos</th>" : ""}</tr></thead>
      <tbody>${L.map(
        (r) => `<tr><td><input type="checkbox" data-ncs="${esc(r.k)}" ${S.sel.has(r.k) ? "checked" : ""}></td>
          <td title="${esc(EST[r.est][1])}" style="text-align:center">${EST[r.est][0]}</td>
          ${S.cat ? "" : `<td><span class="cm-pill">${esc((cats.find((c) => c[0] === r.cat) || ["", ""])[1])}</span></td>`}
          <td><b>${esc(r.desc)}</b></td><td>${esc(r.un)}</td><td class="num"><b>${fmt(Math.ceil(r.q - 1e-9))}</b></td>
          <td class="num">${r.preco ? fmt(r.preco, r.preco % 1 ? 2 : 0) : "—"}</td>
          <td class="num">${r.pb ? `<b>${fmt(r.pb.preco, r.pb.preco % 1 ? 2 : 0)}</b> ${esc(r.pb.moeda || "")}<div class="cm-calc">${esc(r.pb.forn || "")} · ${dt(r.pb.data)}${r.pb.desc !== r.desc ? ` · ${esc(r.pb.desc)}` : ""}</div>` : "—"}</td>
          ${todos ? `<td class="cm-calc">${esc(r.origens.map((o) => `${o.numero} (${fmt(o.q)})`).join(", "))}</td>` : ""}</tr>`
      ).join("")}</tbody></table></div>`
      : `<p class="cm-lead">Sem artigos com estes filtros.</p>`
  }
  <div class="cm-head-actions" style="margin-top:.75rem;flex-wrap:wrap">
    <button type="button" class="cm-chip is-on" data-nc="xlsx" ${S.sel.size ? "" : "disabled"}>Exportar pedido de cotação com ${S.sel.size} artigo(s) (Excel)</button>
    ${!todos && canEdit() ? `<button type="button" class="cm-chip" data-nc="avisar">Avisar a Logística</button>` : ""}
    ${!todos ? `<a class="cm-chip" href="/comercial/orcamento?id=${esc(D.orcamento.id)}&v=mat">Abrir o orçamento ›</a>` : ""}
  </div>
  <p class="cm-calc">🟢 = há uma compra ou cotação da casa que casa com o artigo, com menos de ${D.validade} dias. 🟡 = preço mais antigo, parecido mas não igual, ou só o do barém/orçamento. 🔴 = sem preço nenhum.
    Os pedidos de cotação da app são por obra: como o orçamento ainda não tem obra, o pedido sai em Excel para enviar aos fornecedores, e a Logística é avisada.</p>`;
}

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = `<p class="cm-lead">Não foi possível carregar: ${esc(S.erro)}</p>`);
  if (S.src) {
    if (!S.det) return (el.innerHTML = `<p class="cm-lead">A carregar os artigos…</p>`);
    return (el.innerHTML = detalhe());
  }
  if (!S.lista) return (el.innerHTML = `<p class="cm-lead">A carregar…</p>`);
  el.innerHTML = lista();
}

async function abrir(src) {
  S.src = src || null;
  S.det = null;
  S.sel.clear();
  S.cat = "";
  S.est = "";
  S.q = "";
  const u = new URL(location.href);
  if (S.src) u.searchParams.set("orc", S.src);
  else u.searchParams.delete("orc");
  history.replaceState({}, "", u);
  desenhar();
  if (!S.src) return;
  try {
    S.det = await apiRequest(S.src === "__all" ? "/budgets/needs?todos=1" : `/budgets/needs?id=${encodeURIComponent(S.src)}`);
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

async function exportar() {
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = SHEETJS;
      s.onload = res;
      s.onerror = () => rej(new Error("não foi possível carregar o Excel"));
      document.head.appendChild(s);
    });
  }
  const linhas = S.det.artigos.filter((r) => S.sel.has(r.k));
  const titulo = S.src === "__all" ? "Pedido de cotação — vários orçamentos" : `Pedido de cotação — ${S.det.orcamento.numero} · ${S.det.orcamento.obra || ""}`;
  const aoa = [
    [titulo],
    [`Data: ${new Date().toLocaleDateString("pt-PT")}. Pedimos o preço unitário sem IVA, o prazo de entrega e a validade da proposta.`],
    [],
    ["N.º", "Artigo", "Un.", "Quantidade", "Preço unitário (s/ IVA)", "Prazo de entrega (dias)", "Observações"],
    ...linhas.map((r, i) => [i + 1, r.desc, r.un, Math.ceil(r.q - 1e-9), "", "", ""]),
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [6, 60, 8, 12, 22, 22, 30].map((w) => ({ wch: w }));
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Pedido de cotação");
  window.XLSX.writeFile(wb, `${titulo.replace(/[\\/:*?"<>|]/g, "-")}.xlsx`);
}

async function avisar() {
  const n = S.sel.size || S.det.artigos.length;
  if (!confirm(`Avisar quem tem acesso à Logística de que ${n} artigo(s) do ${S.det.orcamento.numero} estão prontos para cotar?`)) return;
  try {
    const r = await apiRequest(`/budgets/${S.det.orcamento.id}/quote-request`, { method: "POST", body: { linhas: n } });
    toast(r.avisados ? `Aviso enviado a ${r.avisados} pessoa(s) da Logística.` : "Ninguém com acesso à Logística para avisar.", { type: r.avisados ? "success" : "info" });
  } catch (e) {
    toast(e.message || "Não foi possível avisar.", { type: "error" });
  }
}

function ligar() {
  const el = root();
  el.addEventListener("click", (e) => {
    const s = e.target.closest("[data-ncsrc]");
    if (s) {
      e.preventDefault();
      return abrir(s.dataset.ncsrc);
    }
    const b = e.target.closest("[data-nc]");
    if (!b) return;
    const [k, v] = b.dataset.nc.split("|");
    if (k === "cat") {
      S.cat = v;
      return desenhar();
    }
    if (k === "xlsx") return exportar().catch((err) => toast(err.message, { type: "error" }));
    if (k === "avisar") return avisar();
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.ncf) {
      S[t.dataset.ncf] = t.value;
      return desenhar();
    }
    if (t.dataset.ncs) {
      if (t.checked) S.sel.add(t.dataset.ncs);
      else S.sel.delete(t.dataset.ncs);
      return desenhar();
    }
    if (t.dataset.ncall !== undefined) {
      for (const r of filtrados()) {
        if (t.checked) S.sel.add(r.k);
        else S.sel.delete(r.k);
      }
      desenhar();
    }
  });
  el.addEventListener("input", (e) => {
    if (e.target.dataset.ncq === undefined) return;
    S.q = e.target.value;
    const pos = e.target.selectionStart;
    desenhar();
    const n = root().querySelector("[data-ncq]");
    if (n) {
      n.focus();
      n.setSelectionRange(pos, pos);
    }
  });
}

initComercialPage({
  perm: "tab_orcamentos",
  onReady: async () => {
    ligar();
    desenhar();
    try {
      S.lista = await apiRequest("/budgets/needs");
    } catch (e) {
      S.erro = e.message;
    }
    const orc = new URL(location.href).searchParams.get("orc");
    if (orc) await abrir(orc);
    else desenhar();
  },
});
