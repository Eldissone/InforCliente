/**
 * T6 Alocação de Cartões — o `V.faloc` do protótipo: a quem (e a que obra)
 * cada cartão está entregue, de quando a quando, e em que estado voltou.
 */

import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmtData, codigoNoCabecalho, seg, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { al: null, cards: null, obras: [], erro: null, t: "", est: "", q: "" };
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const nomeCartao = (c) => [c?.bank, c?.label, c?.lastDigits ? `•${c.lastDigits}` : ""].filter(Boolean).join(" ");
const podeEditar = () => can("financeiro", "edit");

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.al) return (el.innerHTML = vazio("A carregar…"));
  const q = norm(S.q).trim();
  const L = S.al.filter(
    (a) =>
      (!S.t || a.card?.type === S.t) &&
      (!S.est || (S.est === "uso" ? !a.endDate : a.endDate)) &&
      (!q || norm([nomeCartao(a.card), a.responsible, a.project?.name, a.project?.code, a.notes].join(" ")).includes(q))
  );
  const emUso = S.al.filter((a) => !a.endDate);
  const livres = (S.cards || []).filter((c) => c.active && !emUso.some((a) => a.cardId === c.id));
  const estragados = S.al.filter((a) => a.returnState === "ESTRAGADO").length;
  el.innerHTML = `
    ${kpis([
      { tom: "blue", titulo: "Cartões Entregues", valor: String(emUso.length), nota: "alocações em uso" },
      { tom: "good", titulo: "Cartões Livres", valor: String(livres.length), nota: livres.map(nomeCartao).slice(0, 3).join(" · ") || "&nbsp;" },
      { tom: estragados ? "bad" : "neu", titulo: "Devolvidos Estragados", valor: String(estragados), nota: "&nbsp;" },
    ])}
    <div class="cp-filtros">
      ${seg("t6", "t", S.t, [["", "Todos os cartões"], ["PREPAGO", "Fundo de Maneio"], ["CREDITO", "Cartão de Crédito"], ["DEBITO", "Conta principal"]])}
      ${seg("t6", "est", S.est, [["", `Todos (${S.al.length})`], ["uso", `Em uso (${emUso.length})`], ["dev", "Devolvidos"]])}
      <input type="search" class="finance-input" data-t6q placeholder="cartão, responsável, obra…" value="${esc(S.q)}">
    </div>
    <h3 class="f0-h3">Histórico de Alocações</h3>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Cartão</th><th>Responsável</th><th>Obra</th><th>Entregue em</th><th>Devolvido em</th><th>Estado</th><th>Notas</th><th></th></tr></thead>
      <tbody>${L.map(
        (a) => `<tr>
          <td><b>${esc(nomeCartao(a.card))}</b>${a.returnState === "ESTRAGADO" ? ' <span class="fcal-pill fcal-pill--bad">estragado</span>' : ""}</td>
          <td>${esc(a.responsible)}</td><td class="fx2-mut">${esc(a.project ? [a.project.code, a.project.name].filter(Boolean).join(" · ") : "Sede")}</td>
          <td>${fmtData(a.startDate)}</td><td>${a.endDate ? fmtData(a.endDate) : "—"}</td>
          <td>${a.endDate ? `<span class="fcal-pill fcal-pill--slate">devolvido${a.returnState === "BOM" ? " · bom" : ""}</span>` : '<span class="fcal-pill fcal-pill--blue">em uso</span>'}</td>
          <td class="fx2-mut">${esc([a.notes, a.returnNotes].filter(Boolean).join(" · "))}</td>
          <td class="g1-acts">${
            podeEditar()
              ? `${a.endDate ? "" : `<button type="button" class="finance-btn finance-btn--sm" data-t6dev="${esc(a.id)}">Devolver</button>`}
                 <button type="button" class="finance-btn finance-btn--sm" data-t6del="${esc(a.id)}" title="Apagar (registado por engano)"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button>`
              : ""
          }</td></tr>`
      ).join("")}</tbody></table></div>`
        : vazio(S.al.length ? "Nada com estes filtros." : "Ainda não há alocações. Use «+ Nova Alocação».")
    }`;
}

async function carregar() {
  try {
    const [al, cards, obras] = await Promise.all([apiRequest("/finance/card-allocations"), apiRequest("/finance/cards"), apiRequest("/finance/options/projects")]);
    S.al = al.items || [];
    S.cards = cards.items || [];
    S.obras = obras.items || [];
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

function nova() {
  const emUso = new Set(S.al.filter((a) => !a.endDate).map((a) => a.cardId));
  const livres = S.cards.filter((c) => c.active && !emUso.has(c.id));
  if (!livres.length) return toast("Todos os cartões ativos estão entregues. Registe primeiro uma devolução.", { type: "info" });
  const hoje = new Date().toISOString().slice(0, 10);
  openModal({
    title: "Nova alocação de cartão",
    primaryLabel: "Entregar",
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field finance-field--full"><label class="finance-label">Cartão *</label><select id="naC" class="finance-input">${livres
        .map((c) => `<option value="${esc(c.id)}">${esc(nomeCartao(c))}</option>`)
        .join("")}</select></div>
      <div class="finance-field"><label class="finance-label">Responsável *</label><input id="naR" class="finance-input"></div>
      <div class="finance-field"><label class="finance-label">Entregue em *</label><input id="naD" class="finance-input" type="date" value="${hoje}"></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Obra</label><select id="naO" class="finance-input"><option value="">Sede (sem obra)</option>${S.obras
        .map((o) => `<option value="${esc(o.id)}">${esc([o.code || o.referencia, o.name].filter(Boolean).join(" · "))}</option>`)
        .join("")}</select></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Notas</label><input id="naN" class="finance-input"></div>
    </div>`,
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id).value.trim();
      if ($("#naR").length < 2) return toast("Indique o responsável.", { type: "error" });
      try {
        await apiRequest("/finance/card-allocations", {
          method: "POST",
          body: { cardId: $("#naC"), responsavel: $("#naR"), obraId: $("#naO") || null, inicio: $("#naD"), notas: $("#naN") || null },
        });
        close();
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível gravar.", { type: "error" });
      }
    },
  });
}

function devolver(a) {
  const hoje = new Date().toISOString().slice(0, 10);
  openModal({
    title: `Devolver ${nomeCartao(a.card)}`,
    primaryLabel: "Registar devolução",
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field"><label class="finance-label">Devolvido em</label><input id="dvD" class="finance-input" type="date" value="${hoje}"></div>
      <div class="finance-field"><label class="finance-label">Estado do cartão</label><select id="dvE" class="finance-input"><option value="BOM">Bom</option><option value="ESTRAGADO">Estragado</option></select></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Observações</label><input id="dvO" class="finance-input"></div>
    </div>`,
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id).value.trim();
      try {
        await apiRequest(`/finance/card-allocations/${a.id}/return`, { method: "POST", body: { fim: $("#dvD"), estado: $("#dvE"), obs: $("#dvO") || null } });
        close();
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível gravar.", { type: "error" });
      }
    },
  });
}

export async function render() {
  codigoNoCabecalho("T6");
  const params = new URLSearchParams(window.location.search);
  if (params.get("q")) S.q = params.get("q");
  if (params.get("t")) S.t = params.get("t");
  const acts = document.getElementById("financePageActions");
  if (acts && podeEditar()) {
    acts.innerHTML = `<button type="button" class="finance-btn finance-btn--primary" id="t6Nova">+ Nova Alocação</button>`;
    document.getElementById("t6Nova").onclick = () => S.al && nova();
  }
  const el = root();
  el.addEventListener("click", async (e) => {
    const t = e.target;
    const b = t.closest("[data-t6]");
    if (b) {
      const [k, v] = b.dataset.t6.split("|");
      S[k] = v;
      return desenhar();
    }
    const dv = t.closest("[data-t6dev]");
    if (dv) return devolver(S.al.find((a) => a.id === dv.dataset.t6dev));
    const del = t.closest("[data-t6del]");
    if (del && confirm("Apagar esta alocação (registada por engano)?")) {
      try {
        await apiRequest(`/finance/card-allocations/${del.dataset.t6del}`, { method: "DELETE" });
        carregar();
      } catch (err) {
        toast(err.message || "Não foi possível apagar.", { type: "error" });
      }
    }
  });
  el.addEventListener("input", (e) => {
    if (e.target.dataset.t6q === undefined) return;
    S.q = e.target.value;
    const pos = e.target.selectionStart;
    desenhar();
    const n = root().querySelector("[data-t6q]");
    if (n) {
      n.focus();
      n.setSelectionRange(pos, pos);
    }
  });
  desenhar();
  await carregar();
}
