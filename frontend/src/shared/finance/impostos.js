/**
 * G1 Impostos — o `V.ffis` do protótipo.
 *
 * Os impostos de cada mês (IVA, retenção na fonte, IRT-B, outros), as
 * prestações dos planos PPP e os impostos pedidos pelo RH (IRT, INSS), com a
 * data limite, o valor, a nota de liquidação, o RUPE e o estado do pagamento.
 *
 *  - «Registo Rápido» grava um imposto com a nota de liquidação anexada;
 *  - «Criar pedido de pagamento» abre o pedido do tipo Impostos já preenchido
 *    e ligado ao imposto: o estado passa a vir do Centro de Pagamentos;
 *  - «Registar pago» serve para o que foi pago fora de um pedido.
 */

import { apiRequest, apiUpload, getAssetUrl } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, codigoNoCabecalho, seg, vazio, erro } from "./f2Ui.js";
import { addMonths, monthLabel } from "./fluxosCore.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, erro: null, mes: "", g: "", e: "", ppp: "", q: "", qr: null };

const ESTADO_TOM = { Pago: "good", "Pago parcial": "warn", "Em pagamento": "blue", Atrasado: "bad", "Por pagar": "slate" };
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const podeEditar = () => can("financeiro", "edit");

/** A data limite habitual (como o servidor): IVA a 15, INSS a 10 do mês seguinte; os outros no último dia. */
function limiteAuto(tipo, mes) {
  if (!/^\d{4}-\d{2}$/.test(mes || "")) return "";
  const m = addMonths(mes, 1);
  const [y, mo] = m.split("-").map(Number);
  const ult = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const dia = { IVA: 15, INSS: 10 }[tipo] || ult;
  return `${m}-${String(Math.min(dia, ult)).padStart(2, "0")}`;
}

function filtradas() {
  const q = norm(S.q).trim();
  const base = S.d.linhas.filter((l) => !S.mes || l.mes === S.mes);
  const L = base.filter(
    (l) =>
      (!S.g || l.grupo === S.g) &&
      (!S.ppp || l.plano?.id === S.ppp) &&
      (!S.e || (S.e === "Por pagar" ? l.estado !== "Pago" && l.estado !== "Atrasado" : l.estado === S.e)) &&
      (!q || norm([l.tipo, l.plano?.nome, l.rupe, l.nl, l.pedido?.numero, l.notas, monthLabel(l.mes || "")].join(" ")).includes(q))
  );
  return { base, L };
}

function registoRapido() {
  if (!podeEditar()) return "";
  const hoje = S.d.hoje;
  const Q = (S.qr = S.qr || { tipo: "IVA", mes: addMonths(hoje.slice(0, 7), -1), limite: "", valor: "", nl: "", rupe: "", file: null });
  const auto = limiteAuto(Q.tipo, Q.mes);
  return `<section class="finance-card g1-qr">
    <b>Registo Rápido</b>
    <div class="g1-qrow">
      <label class="f0-lbl">Imposto<select class="finance-input" data-qr="tipo">${S.d.tipos.map((t) => `<option${Q.tipo === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label class="f0-lbl">Mês de referência<input class="finance-input" type="month" data-qr="mes" value="${esc(Q.mes)}"></label>
      <label class="f0-lbl">Data limite<input class="finance-input" type="date" data-qr="limite" value="${esc(Q.limite || auto || "")}"></label>
      <label class="f0-lbl">Valor<input class="finance-input g1-num" type="number" min="0" step="any" data-qr="valor" value="${esc(Q.valor)}"></label>
      <label class="f0-lbl">N.º Nota Liquidação<input class="finance-input" data-qr="nl" value="${esc(Q.nl)}"></label>
      <label class="f0-lbl">RUPE<input class="finance-input" data-qr="rupe" value="${esc(Q.rupe)}"></label>
      <label class="f0-lbl"><span>Nota Liquidação <b class="g1-req">*</b></span>
        <span class="finance-btn finance-btn--sm g1-file">${Q.file ? `📎 ${esc(Q.file.name)}` : "Anexar nota"}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" data-qrfile></span></label>
      <button type="button" class="finance-btn finance-btn--primary" data-qrok>Gravar</button>
    </div>
    <p class="fx2-mut">IVA, retenção na fonte, IRT-B e outros (contabilidade). <b>IRT e INSS são pedidos pelo RH</b> e aparecem aqui sozinhos.
      A data limite vazia fica a habitual (IVA a 15, INSS a 10 do mês seguinte; os outros no fim do mês seguinte).
      Para pagar, use «Criar pedido de pagamento» na linha: o pedido entra no Centro de Pagamentos.</p>
  </section>`;
}

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const { base, L } = filtradas();
  const soma = (X) => X.reduce((s, l) => s + l.valor, 0);
  const tot = soma(L);
  const pg = soma(L.filter((l) => l.estado === "Pago"));
  const cnt = (g) => base.filter((l) => l.grupo === g).length;
  const mes0 = S.mes || S.d.hoje.slice(0, 7);
  const edita = podeEditar();

  el.innerHTML = `${registoRapido()}
    <div class="cp-filtros">
      <input type="search" class="finance-input" data-g1q placeholder="Procurar RUPE, nota, pedido…" value="${esc(S.q)}">
      <button type="button" class="finance-btn finance-btn--sm" data-g1mes="${addMonths(mes0, -1)}">‹</button>
      <input class="finance-input" type="month" data-g1f="mes" value="${esc(S.mes)}">
      <button type="button" class="finance-btn finance-btn--sm" data-g1mes="${addMonths(mes0, 1)}">›</button>
      <button type="button" class="finance-btn finance-btn--sm${!S.mes ? " is-on" : ""}" data-g1mes="">Todos os meses</button>
      <select class="finance-input" data-g1f="e">${[
        ["", "Todos os estados"],
        ["Por pagar", "Por pagar"],
        ["Atrasado", `Atrasados (${S.d.resumo.atrasados})`],
        ["Pago", "Pagos"],
      ]
        .map(([k, l]) => `<option value="${k}"${S.e === k ? " selected" : ""}>${l}</option>`)
        .join("")}</select>
      ${
        S.d.planos.length
          ? `<select class="finance-input" data-g1f="ppp"><option value="">Todos os PPP</option>${S.d.planos
              .map((p) => `<option value="${esc(p.id)}"${S.ppp === p.id ? " selected" : ""}>${esc(p.nome)}</option>`)
              .join("")}</select>`
          : ""
      }
    </div>
    <div class="cp-filtros">${seg("g1", "g", S.g, [["", `Todos (${base.length})`], ...S.d.grupos.filter(cnt).map((g) => [g, `${g} (${cnt(g)})`])])}</div>
    <div class="fx2-chips">
      <span class="fx2-chip"><span>Total</span> <b>${fmt(tot)}</b></span>
      <span class="fx2-chip"><span>Pago</span> <b class="fcal-in">${fmt(pg)}</b></span>
      <span class="fx2-chip"><span>Por pagar</span> <b class="g1-warn">${fmt(tot - pg)}</b></span>
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t g1-t">
      <thead><tr><th>Imposto</th><th>Tipo</th><th>Mês Ref.</th><th>Data Limite</th><th class="r">Valor</th><th>RUPE</th><th>Estado</th><th>Nota</th><th>Pedido</th><th></th></tr></thead>
      <tbody>${L.map((l) => {
        const nome = l.plano ? `<b>${esc(/^PPP/i.test(l.plano.nome) ? l.plano.nome : `PPP · ${l.plano.nome}`)}</b> <span class="fx2-mut">${l.plano.prestacao}/${l.plano.prestacoes || "?"}</span>` : `<b>${esc(l.tipo)}</b>`;
        const tipo = l.plano ? "PPP" : S.d.tiposRH.includes(l.tipo) ? "RH" : "Financeiro";
        const acoes = [];
        if (edita && l.estado !== "Pago" && !l.pedido && l.origem === "obrigacao") {
          acoes.push(`<button type="button" class="finance-btn finance-btn--sm" data-g1pedido="${esc(l.id)}">Criar pedido de pagamento</button>`);
        }
        if (edita && l.origem === "obrigacao") acoes.push(`<button type="button" class="finance-btn finance-btn--sm" data-g1ed="${esc(l.id)}">Editar</button>`);
        return `<tr>
          <td>${nome}</td><td class="fx2-mut">${tipo}</td><td>${l.mes ? esc(monthLabel(l.mes)) : "—"}</td>
          <td${l.estado === "Atrasado" ? ' class="f0-neg"' : ""}>${l.limite ? fmtData(l.limite) : "—"}</td>
          <td class="r">${l.valor ? fmt(l.valor) : '<span class="fx2-mut">por apurar</span>'}</td>
          <td class="fx2-mut">${esc(l.rupe || "")}</td>
          <td><span class="fcal-pill fcal-pill--${ESTADO_TOM[l.estado] || "slate"}">${esc(l.estado)}</span>${l.pagoEm ? `<div class="fx2-mut">${fmtData(l.pagoEm)}${l.pagoNota ? ` · ${esc(l.pagoNota)}` : ""}</div>` : ""}</td>
          <td>${l.nota ? `<a href="${esc(getAssetUrl(l.nota.path))}" target="_blank" rel="noopener">📄</a>` : "—"}</td>
          <td>${l.pedido ? `<a href="/Financeiro/centro-pagamentos" title="${esc(l.pedido.estado)}">${esc(l.pedido.numero)}</a>` : "—"}</td>
          <td class="g1-acts">${acoes.join(" ")}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`
        : vazio(S.d.linhas.length ? "Nada com estes filtros." : "Ainda não há impostos registados. Use o Registo Rápido.")
    }
    <p class="fcal-nota">Os planos PPP criam-se e gerem-se em <a href="/Financeiro/impostos-planos">G2 · Planos de Pagamento</a>; as prestações aparecem aqui.
      O mapa do ano está em <a href="/Financeiro/mapa-fiscal">G4 · Mapa Fiscal</a>.</p>`;
}

async function carregar() {
  try {
    S.d = await apiRequest("/finance/taxes");
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

async function anexar(id, file) {
  const fd = new FormData();
  fd.append("file", file);
  await apiUpload(`/finance/taxes/${id}/document`, fd);
}

async function gravarRapido() {
  const Q = S.qr;
  if (!Q.file) return toast("Anexe a nota de liquidação (obrigatória).", { type: "error" });
  if (!(Number(Q.valor) > 0)) return toast("Indique o valor.", { type: "error" });
  try {
    const r = await apiRequest("/finance/taxes", {
      method: "POST",
      body: { tipo: Q.tipo, mes: Q.mes, limite: Q.limite || null, valor: Number(Q.valor), nl: Q.nl || null, rupe: Q.rupe || null },
    });
    await anexar(r.item.id, Q.file);
    toast(`${Q.tipo} de ${monthLabel(Q.mes)} gravado.`, { type: "success" });
    S.qr = { ...Q, valor: "", nl: "", rupe: "", limite: "", file: null };
    await carregar();
  } catch (e) {
    toast(e.message || "Não foi possível gravar.", { type: "error" });
  }
}

function formImposto(l) {
  const novo = !l;
  const o = l || { tipo: "IVA", mes: S.d.hoje.slice(0, 7), limite: "", valor: "", nl: "", rupe: "", notas: "" };
  const tipos = [...new Set([...S.d.tipos, ...S.d.tiposRH, o.tipo].filter(Boolean))];
  openModal({
    title: novo ? "Novo imposto" : `${o.plano ? `PPP · ${o.plano.nome} ${o.plano.prestacao}/${o.plano.prestacoes}` : o.tipo} · ${monthLabel(o.mes || "")}`,
    primaryLabel: "Guardar",
    width: 640,
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field"><label class="finance-label">Imposto</label>${
        o.plano
          ? `<input class="finance-input" value="PPP" disabled>`
          : `<select id="gfT" class="finance-input">${tipos.map((t) => `<option${o.tipo === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`
      }</div>
      <div class="finance-field"><label class="finance-label">Mês de referência</label><input id="gfM" class="finance-input" type="month" value="${esc(o.mes || "")}"></div>
      <div class="finance-field"><label class="finance-label">Data limite</label><input id="gfL" class="finance-input" type="date" value="${esc(o.limite || "")}"></div>
      <div class="finance-field"><label class="finance-label">Valor</label><input id="gfV" class="finance-input" type="number" min="0" step="any" value="${esc(o.valor ?? "")}"></div>
      <div class="finance-field"><label class="finance-label">N.º Nota Liquidação</label><input id="gfN" class="finance-input" value="${esc(o.nl || "")}"></div>
      <div class="finance-field"><label class="finance-label">RUPE</label><input id="gfR" class="finance-input" value="${esc(o.rupe || "")}"></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Observações</label><textarea id="gfO" class="finance-textarea" rows="2">${esc(o.notas || "")}</textarea></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Nota de liquidação</label>
        ${o.nota ? `<a href="${esc(getAssetUrl(o.nota.path))}" target="_blank" rel="noopener">📄 ${esc(o.nota.nome)}</a> · ` : ""}<input id="gfF" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"></div>
      ${
        novo
          ? ""
          : `<div class="finance-field finance-field--full g1-pago">
              ${
                o.pagoEm
                  ? `Registado como pago em ${fmtData(o.pagoEm)}. <button type="button" class="finance-btn finance-btn--sm" id="gfDesf">Desfazer</button>`
                  : o.pedido
                    ? `Pago pelo pedido <b>${esc(o.pedido.numero)}</b> (${esc(o.pedido.estado)}).`
                    : `Pago fora de um pedido? <input id="gfPD" class="finance-input" type="date" value="${S.d.hoje}"> <input id="gfPN" class="finance-input" placeholder="como (ex.: transferência BAI)"> <button type="button" class="finance-btn finance-btn--sm" id="gfPago">Registar pago</button>`
              }
              ${!o.pagoEm && !o.pedido ? ` <button type="button" class="finance-btn finance-btn--sm" id="gfDel">Apagar</button>` : ""}
            </div>`
      }
    </div>`,
    onRender: ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id);
      const fixar = async (body) => {
        try {
          await apiRequest(`/finance/taxes/${o.id}/paid`, { method: "POST", body });
          close();
          carregar();
        } catch (e) {
          toast(e.message || "Não foi possível.", { type: "error" });
        }
      };
      $("#gfPago")?.addEventListener("click", () => fixar({ data: $("#gfPD").value, nota: $("#gfPN").value.trim() || null }));
      $("#gfDesf")?.addEventListener("click", () => fixar({ data: null }));
      $("#gfDel")?.addEventListener("click", async () => {
        if (!confirm("Apagar este imposto? Não se pode desfazer.")) return;
        try {
          await apiRequest(`/finance/taxes/${o.id}`, { method: "DELETE" });
          close();
          carregar();
        } catch (e) {
          toast(e.message || "Não foi possível apagar.", { type: "error" });
        }
      });
    },
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id);
      const body = {
        mes: $("#gfM").value,
        limite: $("#gfL").value || null,
        valor: Number($("#gfV").value) || 0,
        nl: $("#gfN").value.trim() || null,
        rupe: $("#gfR").value.trim() || null,
        notas: $("#gfO").value.trim() || null,
      };
      if (!o.plano) body.tipo = $("#gfT").value;
      if (!/^\d{4}-\d{2}$/.test(body.mes)) return toast("Indique o mês de referência.", { type: "error" });
      try {
        const r = novo
          ? await apiRequest("/finance/taxes", { method: "POST", body })
          : await apiRequest(`/finance/taxes/${o.id}`, { method: "PATCH", body });
        const f = $("#gfF").files?.[0];
        if (f) await anexar(novo ? r.item.id : o.id, f);
        toast("Imposto guardado.", { type: "success" });
        close();
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível guardar.", { type: "error" });
      }
    },
  });
}

function criarPedido(l) {
  const q = new URLSearchParams({
    type: "IMPOSTOS",
    lockType: "1",
    obrigacao: l.id,
    imp: l.plano ? "PPP" : l.tipo,
    mes: l.mes || "",
    limite: l.limite || "",
    valor: String(l.valor || ""),
    rupe: l.rupe || "",
    returnTo: "/Financeiro/impostos",
  });
  location.href = `/Financeiro/novoPedido?${q}`;
}

export async function render() {
  codigoNoCabecalho("G1");
  const acts = document.getElementById("financePageActions");
  if (acts && podeEditar()) {
    acts.innerHTML = `<button type="button" class="finance-btn finance-btn--primary" id="g1Novo">+ Novo Imposto</button>`;
    document.getElementById("g1Novo").onclick = () => S.d && formImposto(null);
  }
  const el = root();
  el.addEventListener("click", (e) => {
    const t = e.target;
    const m = t.closest("[data-g1mes]");
    if (m) {
      S.mes = m.dataset.g1mes;
      return desenhar();
    }
    const b = t.closest("[data-g1]");
    if (b) {
      const [k, v] = b.dataset.g1.split("|");
      S[k] = v;
      return desenhar();
    }
    if (t.closest("[data-qrok]")) return gravarRapido();
    const ed = t.closest("[data-g1ed]");
    if (ed) return formImposto(S.d.linhas.find((l) => l.id === ed.dataset.g1ed));
    const pd = t.closest("[data-g1pedido]");
    if (pd) return criarPedido(S.d.linhas.find((l) => l.id === pd.dataset.g1pedido));
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.g1f) {
      S[t.dataset.g1f] = t.value;
      return desenhar();
    }
    if (t.dataset.qr) {
      S.qr[t.dataset.qr] = t.value;
      if (t.dataset.qr === "tipo" || t.dataset.qr === "mes") S.qr.limite = "";
      return desenhar();
    }
    if (t.dataset.qrfile !== undefined) {
      S.qr.file = t.files?.[0] || null;
      return desenhar();
    }
  });
  let tempo = null;
  el.addEventListener("input", (e) => {
    if (e.target.dataset.g1q === undefined) return;
    S.q = e.target.value;
    clearTimeout(tempo);
    tempo = setTimeout(() => {
      const pos = e.target.selectionStart;
      desenhar();
      const n = root().querySelector("[data-g1q]");
      if (n) {
        n.focus();
        n.setSelectionRange(pos, pos);
      }
    }, 250);
  });
  desenhar();
  await carregar();
}
