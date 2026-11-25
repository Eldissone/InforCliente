/**
 * T6 Alocação de Cartões — alinhado com `V.faloc` do protótipo:
 * cartões disponíveis vs alocados, filtros por tipo, estado, obra e cartão,
 * e histórico de alocações com Dias, Carregado e Gasto em cada período.
 */

import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmtData, codigoNoCabecalho, seg, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { al: null, cards: null, obras: [], erro: null, t: "", est: "", obra: "", hc: "", q: "" };
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const fmt = (v) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nomeCartao = (c) => [c?.bank, c?.label, c?.lastDigits ? `•${c.lastDigits}` : ""].filter(Boolean).join(" ");
const podeEditar = () => can("financeiro", "edit");

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.al) return (el.innerHTML = vazio("A carregar…"));
  const q = norm(S.q).trim();
  const hoje = new Date().toISOString().slice(0, 10);

  const cartoesDistribuiveis = (S.cards || []).filter((c) => c.active !== false && (c.type === "PREPAGO" || c.type === "CREDITO"));
  const todosCartoes = cartoesDistribuiveis.length ? cartoesDistribuiveis : (S.cards || []).filter((c) => c.active !== false);
  const emUso = S.al.filter((a) => !a.endDate);
  const livres = todosCartoes.filter((c) => !emUso.some((a) => a.cardId === c.id));
  const estragados = S.al.filter((a) => a.returnState === "ESTRAGADO").length;

  const L = S.al.filter(
    (a) =>
      (!S.t || a.card?.type === S.t) &&
      (!S.est || (S.est === "uso" ? !a.endDate : Boolean(a.endDate))) &&
      (!S.obra || (S.obra === "__sede" ? !a.projectId : a.projectId === S.obra)) &&
      (!S.hc || a.cardId === S.hc) &&
      (!q || norm([nomeCartao(a.card), a.responsible, a.project?.name, a.project?.code, a.notes, a.returnNotes].join(" ")).includes(q))
  );

  const cardsComHist = [...new Map(S.al.filter((a) => a.card).map((a) => [a.cardId, a.card])).values()].sort((a, b) =>
    nomeCartao(a).localeCompare(nomeCartao(b), "pt", { numeric: true })
  );

  el.innerHTML = `
    ${kpis([
      { tom: "good", titulo: "Cartões Disponíveis (na Área Financeira)", valor: String(livres.length), nota: `de ${todosCartoes.length} cartão(ões)` },
      { tom: "blue", titulo: "Cartões Alocados", valor: String(emUso.length), nota: "em obras ou com pessoas" },
      { tom: estragados ? "bad" : "neu", titulo: "Devolvidos Estragados", valor: String(estragados), nota: estragados ? "verificar estado" : "nenhum estragado" },
    ])}
    <section class="t3-sec" style="margin-bottom:12px">
      <h3 style="margin:0 0 8px;font-size:14px">Cartões Disponíveis</h3>
      ${
        livres.length
          ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${livres
              .filter((c) => !S.t || c.type === S.t)
              .map((c) => {
                const val = c.validade || (c.expiresAt ? String(c.expiresAt).slice(0, 7) : "");
                const venc = val && val < hoje.slice(0, 7);
                return `<div style="min-width:210px;display:flex;align-items:center;gap:10px;justify-content:space-between;border:1px solid var(--line,#e2e8f0);border-radius:10px;padding:8px 10px;background:#fff">
                  <span><b>${esc(nomeCartao(c))}</b>${val ? `<div class="t3-small${venc ? "" : " fx2-mut"}"${venc ? ' style="color:#dc2626"' : ""}>val. ${esc(val.split("-").reverse().join("/"))}</div>` : ""}</span>
                  ${podeEditar() ? `<button type="button" class="finance-btn finance-btn--sm finance-btn--primary" data-t6aloc="${esc(c.id)}">Alocar</button>` : ""}
                </div>`;
              })
              .join("")}</div>`
          : `<p class="fx2-mut t3-small" style="margin:0">${todosCartoes.length ? "Todos os cartões estão alocados." : "Ainda não há cartões registados em Contas e Saldos."}</p>`
      }
    </section>
    <div class="cp-filtros" style="flex-wrap:wrap">
      ${seg("t6", "t", S.t, [["", "Todos os cartões"], ["PREPAGO", "Fundo de Maneio"], ["CREDITO", "Cartão de Crédito"]])}
      <select class="finance-input" data-t6sel="est" style="width:auto">
        <option value=""${!S.est ? " selected" : ""}>Todos (${S.al.length})</option>
        <option value="uso"${S.est === "uso" ? " selected" : ""}>Em uso (${emUso.length})</option>
        <option value="dev"${S.est === "dev" ? " selected" : ""}>Devolvidos (${S.al.length - emUso.length})</option>
      </select>
      <select class="finance-input" data-t6sel="obra" style="width:auto">
        <option value=""${!S.obra ? " selected" : ""}>Todas as obras</option>
        <option value="__sede"${S.obra === "__sede" ? " selected" : ""}>Sede (sem obra)</option>
        ${(S.obras || [])
          .map((o) => `<option value="${esc(o.id)}"${S.obra === o.id ? " selected" : ""}>${esc([o.code || o.referencia, o.name].filter(Boolean).join(" · "))}</option>`)
          .join("")}
      </select>
      <select class="finance-input" data-t6sel="hc" style="width:auto">
        <option value=""${!S.hc ? " selected" : ""}>Todos os cartões (histórico)</option>
        ${cardsComHist.map((c) => `<option value="${esc(c.id)}"${S.hc === c.id ? " selected" : ""}>${esc(nomeCartao(c))}</option>`).join("")}
      </select>
      <input type="search" class="finance-input" data-t6q placeholder="cartão, responsável, obra…" value="${esc(S.q)}">
    </div>
    <h3 class="f0-h3">Histórico de Alocações</h3>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Cartão</th><th>Responsável</th><th>Obra / Localização</th><th>Entrega</th><th>Devolução</th><th class="r">Dias</th><th class="r">Carregado</th><th class="r">Gasto</th><th>Estado</th><th>Notas</th><th></th></tr></thead>
      <tbody>${L.map((a) => {
        const dias = a.dias ?? Math.max(0, Math.round((new Date(a.endDate || hoje) - new Date(a.startDate)) / 86400000));
        return `<tr>
          <td><b>${esc(nomeCartao(a.card))}</b>${a.returnState === "ESTRAGADO" ? ' <span class="fcal-pill fcal-pill--bad">estragado</span>' : ""}</td>
          <td><b>${esc(a.responsible)}</b></td>
          <td class="fx2-mut">${esc(a.project ? [a.project.code, a.project.name].filter(Boolean).join(" · ") : "Sede")}</td>
          <td>${fmtData(a.startDate)}</td>
          <td>${a.endDate ? fmtData(a.endDate) : "—"}</td>
          <td class="r">${dias}d</td>
          <td class="r">${a.carregado > 0 ? fmt(a.carregado) : "—"}</td>
          <td class="r">${a.gasto > 0 ? fmt(a.gasto) : "—"}</td>
          <td>${a.endDate ? `<span class="fcal-pill fcal-pill--slate">devolvido${a.returnState === "BOM" ? " · bom" : ""}</span>` : '<span class="fcal-pill fcal-pill--blue">em uso</span>'}</td>
          <td class="fx2-mut">${esc([a.notes, a.returnNotes].filter(Boolean).join(" · "))}</td>
          <td class="g1-acts">${
            podeEditar()
              ? `${a.endDate ? "" : `<button type="button" class="finance-btn finance-btn--sm" data-t6dev="${esc(a.id)}">Devolver</button>`}
                 <button type="button" class="finance-btn finance-btn--sm" data-t6del="${esc(a.id)}" title="Apagar (registado por engano)"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button>`
              : ""
          }</td></tr>`;
      }).join("")}</tbody></table></div>`
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

function nova(preCardId = "") {
  const todosAtivos = (S.cards || []).filter((c) => c.active !== false);
  if (!todosAtivos.length) return toast("Não há cartões ativos. Crie um cartão em Contas e Saldos.", { type: "info" });
  const emUsoMap = new Map(S.al.filter((a) => !a.endDate).map((a) => [a.cardId, a]));
  const hoje = new Date().toISOString().slice(0, 10);
  openModal({
    title: "Nova alocação de cartão",
    primaryLabel: "Entregar",
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field finance-field--full"><label class="finance-label">Cartão *</label><select id="naC" class="finance-input">${todosAtivos
        .map((c) => {
          const atual = emUsoMap.get(c.id);
          return `<option value="${esc(c.id)}"${c.id === preCardId ? " selected" : ""}>${esc(nomeCartao(c))}${atual ? ` (atualmente com ${esc(atual.responsible)})` : ""}</option>`;
        })
        .join("")}</select>
        <div class="fx2-mut t3-small" style="margin-top:4px">Ao entregar um cartão já em uso a outra pessoa, a alocação anterior fecha-se automaticamente.</div>
      </div>
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
    const alBtn = t.closest("[data-t6aloc]");
    if (alBtn) return nova(alBtn.dataset.t6aloc);
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
  el.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-t6sel]");
    if (!sel) return;
    S[sel.dataset.t6sel] = sel.value;
    desenhar();
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
