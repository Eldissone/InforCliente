/**
 * Centro de Requisições de Material.
 *
 * UM ecrã para os dois pedidos que o protótipo separava: pedir ao armazém e pedir
 * para comprar. As abas são **papéis**, não áreas — quem pede, quem decide, quem
 * entrega, quem compra, quem recebe — e o que cada um vê depende das permissões.
 *
 * O custo: material que entra no armazém não é custo. O custo nasce na saída,
 * ao custo médio do armazém.
 */

import { apiRequest } from "/services/api.js";
import { checkAuth } from "/services/auth.js";
import { guardPageAccess, initPermissionLayer, can } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu, toast, escapeHtml } from "/shared/ui.js";

checkAuth();

const el = (id) => document.getElementById(id);
const esc = (v) => escapeHtml(String(v ?? ""));

const S = {
  meta: null,
  items: [],
  counts: {},
  roleCounts: {},
  role: new URLSearchParams(window.location.search).get("aba") || "abertas",
  q: "",
  open: null,
  draft: null,
  warehouse: null,
};

const ROLE_TABS = [
  ["abertas", "Em aberto", "Tudo o que ainda está em jogo"],
  ["minhas", "As minhas", "Requisições que eu pedi"],
  ["decidir", "A minha decisão", "Submetidas, à espera de aprovação"],
  ["entregar", "A entregar", "Aprovadas, à espera do armazém"],
  ["comprar", "A comprar", "Sem stock: foram para compra"],
  ["receber", "A receber em obra", "Entregues, à espera de confirmação"],
  ["", "Todas", "O registo completo"],
];

const STATUS = {
  RASCUNHO: ["", "Rascunho"],
  SUBMETIDA: ["is-warn", "Submetida"],
  APROVADA: ["is-warn", "Aprovada"],
  PARCIAL: ["is-warn", "Entrega parcial"],
  ATENDIDA: ["is-good", "Atendida"],
  EM_COMPRA: ["is-warn", "Em compra"],
  RECUSADA: ["is-bad", "Recusada"],
  CANCELADA: ["is-bad", "Cancelada"],
};

const DEST = { ARMAZEM: "Do armazém", COMPRA: "Para comprar" };

const MOV_LABELS = {
  ENTRY: "Entrada",
  EXIT: "Saída (consumo)",
  TRANSFER_IN: "Entrada por transferência",
  TRANSFER_OUT: "Saída por transferência",
  ADJUSTMENT: "Acerto",
  LOSS: "Perda",
  ALLOCATION: "Alocação",
  RETURN: "Devolução",
};

const fmt = (v, d = 0) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—");

// ───────────────────────── carregamento ─────────────────────────

async function load() {
  const p = new URLSearchParams();
  if (S.q) p.set("q", S.q);
  if (S.role === "abertas") p.set("open", "1");
  else if (S.role) p.set("role", S.role);
  const data = await apiRequest(`/requisitions${p.toString() ? `?${p}` : ""}`);
  S.items = data.items || [];
  S.counts = data.counts || {};
  S.roleCounts = data.roleCounts || {};
}

// ───────────────────────── lista ─────────────────────────

function render() {
  el("rqHeadActions").innerHTML = `
    <input id="rqSearch" class="cell-list" style="min-width:250px" type="search"
           placeholder="Procurar por número, material, obra ou quem pediu…" value="${esc(S.q)}" aria-label="Procurar requisições">
    <button class="cm-chip is-on" type="button" id="rqNew">+ Pedir material</button>`;

  const openCount = ["SUBMETIDA", "APROVADA", "PARCIAL", "EM_COMPRA"].reduce((a, k) => a + (S.counts[k] || 0), 0);
  const total = Object.values(S.counts).reduce((a, b) => a + b, 0);
  const countFor = (k) => (k === "abertas" ? openCount : k === "" ? total : S.roleCounts[k] || 0);

  el("rqTabs").innerHTML = ROLE_TABS.map(
    ([k, l, help]) => `<button type="button" class="cm-chip${S.role === k ? " is-on" : ""}" data-role="${k}" title="${esc(help)}">
      <span>${esc(l)}</span><b>${countFor(k)}</b></button>`
  ).join("");

  el("rqFlow").innerHTML = (S.meta.flow || [])
    .map((step, i) => `<span class="cm-flow-step"><b>${i + 1}</b> ${esc(step)}</span>`)
    .join('<span class="cm-flow-sep">›</span>');

  el("rqContent").innerHTML = `
    <div class="cm-table-wrap"><table class="cm-table">
      <thead><tr>
        <th>N.º</th><th>Data</th><th>Para</th><th>Pedido por</th><th>Material</th>
        <th class="num">Pedido</th><th class="num">Entregue</th><th>Até</th><th>Destino</th><th>Estado</th><th></th>
      </tr></thead>
      <tbody>${
        S.items.length
          ? S.items.map(rowHtml).join("")
          : `<tr><td colspan="11" style="padding:1.25rem;color:var(--cm-muted)">
               ${S.q ? "Nenhuma requisição corresponde à pesquisa." : "Nada nesta aba."}
             </td></tr>`
      }</tbody>
    </table></div>`;
}

function rowHtml(r) {
  const [cls, label] = STATUS[r.status] || ["", r.status];
  const mats = r.items.map((i) => i.description).slice(0, 3).join(", ");
  const late = r.neededBy && r.neededBy < new Date().toISOString().slice(0, 10) && ["SUBMETIDA", "APROVADA", "PARCIAL", "EM_COMPRA"].includes(r.status);
  return `<tr>
    <td><button class="lnk" type="button" data-open="${esc(r.id)}"><b>${esc(r.number)}</b></button></td>
    <td>${fmtDate(r.createdAt)}</td>
    <td>${esc(r.project ? `${r.project.code} · ${r.project.name}` : r.department || "—")}</td>
    <td>${esc(r.requestedByName)}</td>
    <td style="min-width:13rem">${esc(mats)}${r.items.length > 3 ? "…" : ""}</td>
    <td class="num">${fmt(r.totals.requested, 2)}</td>
    <td class="num">${fmt(r.totals.fulfilled, 2)}</td>
    <td>${fmtDate(r.neededBy)}${late ? ` <span class="cm-pill is-bad">atrasada</span>` : ""}</td>
    <td><span class="cm-pill">${esc(DEST[r.destination] || r.destination)}</span></td>
    <td><span class="cm-pill ${cls}">${esc(label)}</span></td>
    <td><button class="cm-chip" type="button" data-open="${esc(r.id)}">Abrir</button></td>
  </tr>`;
}

// ───────────────────────── documento ─────────────────────────

async function openDoc(id) {
  el("rqDrawer").innerHTML = panel(`<p class="cm-lead">A carregar…</p>`);
  try {
    S.open = await apiRequest(`/requisitions/${id}`);
    drawDoc();
  } catch (err) {
    el("rqDrawer").innerHTML = "";
    toast(err?.message || "Não foi possível abrir a requisição.", { type: "error" });
  }
}

function panel(inner, width = 860) {
  return `<div class="cm-wizard-backdrop"><div class="cm-panel cm-wizard" style="max-width:${width}px">${inner}</div></div>`;
}

function drawDoc() {
  const r = S.open;
  const [cls, label] = STATUS[r.status] || ["", r.status];
  const can_ = r.can || {};
  const pend = r.items.filter((i) => i.remaining > 1e-6);

  el("rqDrawer").innerHTML = panel(`
    <div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">${esc(r.number)}</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">
          ${esc(r.project ? `${r.project.code} · ${r.project.name}` : r.department || "Pedido da sede")}
        </h2>
        <p class="cm-lead" style="margin-top:.25rem">
          Pedido por ${esc(r.requestedByName)} em ${fmtDate(r.createdAt)}
          ${r.neededBy ? ` · preciso até ${fmtDate(r.neededBy)}` : ""}
          ${r.costCategory ? ` · ${esc((S.meta.costCategories.find((c) => c[0] === r.costCategory) || [])[1] || r.costCategory)}` : ""}
        </p>
      </div>
      <div class="cm-head-actions">
        <span class="cm-pill ${cls}">${esc(label)}</span>
        <span class="cm-pill">${esc(DEST[r.destination] || r.destination)}</span>
        <button class="cm-chip" type="button" data-dx="close">Fechar</button>
      </div>
    </div>

    ${r.justification ? `<div class="cm-note">${esc(r.justification)}</div>` : ""}
    ${r.refusalReason ? `<div class="cm-note is-bad"><b>Recusada:</b> ${esc(r.refusalReason)}</div>` : ""}
    ${
      r.purchaseOrder
        ? `<div class="cm-note is-warn">Foi para compra: pedido <b>${esc(r.purchaseOrder.number)}</b> (${esc(r.purchaseOrder.status)}).
             <a href="/Financeiro/centro-pagamentos">Ver no Centro de Pagamentos ›</a></div>`
        : ""
    }

    <section class="cm-panel" style="padding:0;border:0">
      <h3 class="cm-panel-title">Itens</h3>
      <div class="cm-table-wrap"><table class="cm-table">
        <thead><tr><th>Material</th><th>Un.</th><th class="num">Pedido</th><th class="num">Entregue</th>
          <th class="num">Falta</th><th class="num">Em stock</th><th>Obs.</th></tr></thead>
        <tbody>${r.items
          .map((i) => {
            const st = (r.stock || {})[i.id];
            const short = st && Number(st.quantity) < i.remaining;
            return `<tr>
              <td><b>${esc(i.description)}</b>${i.productId ? "" : ` <span class="cm-pill is-warn">fora do catálogo</span>`}</td>
              <td>${esc(i.unit || i.product?.unit || "")}</td>
              <td class="num">${fmt(i.quantity, 2)}</td>
              <td class="num">${fmt(i.fulfilledQuantity, 2)}</td>
              <td class="num">${i.remaining > 1e-6 ? `<b>${fmt(i.remaining, 2)}</b>` : "—"}</td>
              <td class="num">${st ? `<span class="${short ? "cm-neg" : ""}">${fmt(st.quantity, 2)}</span>` : "—"}</td>
              <td class="small">${esc(i.notes || "")}</td>
            </tr>`;
          })
          .join("")}</tbody>
      </table></div>
    </section>

    ${r.checklist ? checklistHtml(r.checklist) : ""}

    ${
      r.movements.length
        ? `<section class="cm-panel" style="padding:0;border:0">
             <h3 class="cm-panel-title">Movimentos de stock</h3>
             <div class="cm-table-wrap"><table class="cm-table">
               <thead><tr><th>Quando</th><th>Movimento</th><th>Armazém</th><th>Material</th>
                 <th class="num">Qtd.</th><th class="num">Custo unit.</th><th class="num">Valor</th></tr></thead>
               <tbody>${r.movements
                 .map(
                   (m) => `<tr>
                     <td>${fmtDate(m.createdAt)}</td>
                     <td>${esc(MOV_LABELS[m.type] || m.type)}</td>
                     <td>${esc(m.warehouse?.name || "")}</td>
                     <td>${esc(m.product?.name || "")}</td>
                     <td class="num">${fmt(m.quantity, 2)}</td>
                     <td class="num">${fmt(m.unitCost, 2)}</td>
                     <td class="num">${fmt(m.totalValue, 2)}</td>
                   </tr>`
                 )
                 .join("")}</tbody>
             </table></div>
           </section>`
        : ""
    }

    <section class="cm-panel" style="padding:0;border:0">
      <h3 class="cm-panel-title">Histórico</h3>
      <ul class="cm-check" style="font-size:.8125rem">
        ${
          r.history.length
            ? r.history
                .map(
                  (h) => `<li class="ok">${fmtDate(h.at)} · ${esc(h.by || "—")} — ${esc(h.action)}${h.detail ? ` (${esc(h.detail)})` : ""}</li>`
                )
                .join("")
            : `<li class="advised">Sem registos.</li>`
        }
      </ul>
    </section>

    <div class="cm-head-actions" style="margin-top:1rem;flex-wrap:wrap">
      ${actionsHtml(r, can_, pend)}
      <span id="dxMsg" class="cm-lead" style="margin:0;flex:1 1 100%"></span>
    </div>`);

  el("rqDrawer").querySelector("[data-dx]")?.scrollIntoView?.({ block: "nearest" });
}

function checklistHtml(list) {
  const faltam = list.filter((x) => x.required && !x.ok);
  return `<section class="cm-panel" style="padding:.875rem;background:#fafbfd">
    <b class="small">Antes de entregar ou mandar comprar</b>
    <ul class="cm-check" style="margin-top:.5rem">
      ${list
        .map(
          (x) => `<li class="${x.ok ? "ok" : x.required ? "required" : "advised"}">
            ${esc(x.label)}${!x.ok && x.required ? " <small>(obrigatório)</small>" : ""}</li>`
        )
        .join("")}
    </ul>
    ${faltam.length ? `<p class="cm-lead" style="margin:.5rem 0 0">Faltam ${faltam.length} ponto(s) obrigatório(s).</p>` : ""}
  </section>`;
}

function actionsHtml(r, can_, pend) {
  const out = [];
  if (["RASCUNHO", "RECUSADA"].includes(r.status)) {
    out.push(`<button class="cm-chip is-on" type="button" data-dx="submit">${r.status === "RECUSADA" ? "Reenviar" : "Submeter para aprovação"}</button>`);
  }
  if (r.status === "SUBMETIDA") {
    if (can_.decide) {
      out.push(`<button class="cm-chip is-on" type="button" data-dx="approve">Aprovar</button>`);
      out.push(`<button class="cm-chip" type="button" data-dx="refuse">Recusar</button>`);
    } else {
      out.push(`<span class="cm-lead" style="margin:0">À espera da aprovação de quem pode decidir.</span>`);
    }
  }
  if (["APROVADA", "PARCIAL"].includes(r.status) && pend.length) {
    if (can_.fulfil) {
      if (r.destination === "ARMAZEM") out.push(`<button class="cm-chip is-on" type="button" data-dx="deliver">Entregar do stock</button>`);
      out.push(`<button class="cm-chip" type="button" data-dx="purchase">Pedir compra</button>`);
    } else {
      out.push(`<span class="cm-lead" style="margin:0">À espera do armazém.</span>`);
    }
  }
  if (!["ATENDIDA", "CANCELADA"].includes(r.status) && !r.totals.fulfilled) {
    out.push(`<button class="cm-chip" type="button" data-dx="cancel">Cancelar</button>`);
  }
  return out.join("");
}

// ───────────────────────── ações ─────────────────────────

async function act(action, body) {
  const msg = el("dxMsg");
  if (msg) msg.textContent = "A registar…";
  try {
    const r = await apiRequest(`/requisitions/${S.open.id}/${action}`, { method: "POST", body: body || {} });
    S.open = { ...S.open, ...r };
    await load();
    render();
    await openDoc(S.open.id);
    if (r.warnings?.length) toast(r.warnings.join(" "), { type: "info", timeoutMs: 7000 });
    else toast("Feito.", { type: "success" });
  } catch (err) {
    const p = err?.payload;
    const m = el("dxMsg");
    const text = p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível concluir.";
    if (m) m.textContent = text;
    else toast(text, { type: "error" });
  }
}

function openDeliver() {
  const r = S.open;
  const pend = r.items.filter((i) => i.remaining > 1e-6);
  const whs = (S.meta.warehouses || []).filter((w) => w.type !== "CLIENT");
  el("rqDrawer").innerHTML = panel(
    `<div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">${esc(r.number)}</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">Entregar do stock</h2>
        <p class="cm-lead" style="margin-top:.25rem">
          O material sai do armazém de origem ao custo médio desse armazém. Se for para o armazém
          da obra continua a ser stock; só a baixa na obra é que passa a custo.
        </p>
      </div>
      <button class="cm-chip" type="button" data-dx="back">Voltar</button>
    </div>
    <div class="cm-wizard-grid">
      <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
        <span>Sai do armazém</span>
        <select class="cell-list" id="dvSource">
          ${whs.map((w) => `<option value="${esc(w.id)}"${r.sourceWarehouse?.id === w.id ? " selected" : ""}>${esc(w.name)}</option>`).join("")}
        </select>
      </label>
      <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
        <span>Vai para</span>
        <select class="cell-list" id="dvTarget">
          <option value="">— consumo direto (passa logo a custo) —</option>
          ${whs.map((w) => `<option value="${esc(w.id)}"${r.targetWarehouse?.id === w.id ? " selected" : ""}>${esc(w.name)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="cm-table-wrap" style="margin-top:.75rem"><table class="cm-table">
      <thead><tr><th>Material</th><th class="num">Falta</th><th class="num">Em stock</th><th class="num">Entregar agora</th></tr></thead>
      <tbody>${pend
        .map((i) => {
          const st = (r.stock || {})[i.id];
          const avail = st ? Number(st.quantity) : null;
          const suggest = avail === null ? i.remaining : Math.min(i.remaining, Math.max(0, avail));
          return `<tr>
            <td>${esc(i.description)}</td>
            <td class="num">${fmt(i.remaining, 2)}</td>
            <td class="num">${avail === null ? "—" : `<span class="${avail < i.remaining ? "cm-neg" : ""}">${fmt(avail, 2)}</span>`}</td>
            <td class="num"><input class="cell-manual" type="number" step="any" min="0" max="${i.remaining}"
              data-dv="${esc(i.id)}" value="${suggest > 0 ? suggest : ""}"></td>
          </tr>`;
        })
        .join("")}</tbody>
    </table></div>
    <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted);margin-top:.75rem">
      <span>Observações da entrega</span><input class="cell-manual" id="dvNotes">
    </label>
    <div class="cm-head-actions" style="margin-top:1rem;justify-content:flex-end">
      <span id="dxMsg" class="cm-lead" style="margin:0;flex:1"></span>
      <button class="cm-chip" type="button" data-dx="back">Voltar</button>
      <button class="cm-chip is-on" type="button" data-dx="deliver-ok">Confirmar entrega</button>
    </div>`
  );
}

async function doDeliver() {
  const lines = [...document.querySelectorAll("[data-dv]")]
    .map((n) => ({ itemId: n.dataset.dv, quantity: Number(n.value) }))
    .filter((l) => l.quantity > 0);
  if (!lines.length) {
    el("dxMsg").textContent = "Indique a quantidade a entregar em pelo menos um item.";
    return;
  }
  await act("deliver", {
    sourceWarehouseId: el("dvSource").value || null,
    targetWarehouseId: el("dvTarget").value || null,
    consume: !el("dvTarget").value,
    lines,
    notes: el("dvNotes").value.trim() || null,
  });
}

// ───────────────────────── novo pedido ─────────────────────────

function openNew() {
  S.draft = {
    destination: "ARMAZEM",
    projectId: "",
    department: "",
    costCategory: "MAT",
    neededBy: "",
    justification: "",
    sourceWarehouseId: "",
    items: [{ productId: "", description: "", unit: "", quantity: null }],
  };
  drawNew();
}

function drawNew() {
  const D = S.draft;
  const whs = (S.meta.warehouses || []).filter((w) => w.type !== "CLIENT" && !w.projectId);
  el("rqDrawer").innerHTML = panel(
    `<div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">Nova requisição</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">Pedir material</h2>
        <p class="cm-lead" style="margin-top:.25rem">
          Diga o que precisa e para onde. O armazém entrega do stock que tem; o que não houver
          segue para compra, sem precisar de outro pedido.
        </p>
      </div>
      <button class="cm-chip" type="button" data-nx="close">Cancelar</button>
    </div>
    <div class="cm-wizard-grid">
      <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
        <span>Para que obra</span>
        <select class="cell-list" data-nf="projectId">
          <option value="">— um departamento da sede —</option>
          ${(S.meta.projects || []).map((p) => `<option value="${esc(p.id)}"${D.projectId === p.id ? " selected" : ""}>${esc(p.code)} · ${esc(p.name)}</option>`).join("")}
        </select>
      </label>
      ${
        D.projectId
          ? ""
          : `<label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
               <span>Departamento <b style="color:var(--cm-bad-fg)">*</b></span>
               <input class="cell-manual" data-nf="department" value="${esc(D.department)}" placeholder="Ex.: Logística, Administrativo">
             </label>`
      }
      <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
        <span>Categoria de custo</span>
        <select class="cell-list" data-nf="costCategory">
          ${(S.meta.costCategories || []).map(([k, l]) => `<option value="${k}"${D.costCategory === k ? " selected" : ""}>${esc(l)}</option>`).join("")}
        </select>
      </label>
      <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
        <span>Preciso até</span>
        <input class="cell-manual" type="date" data-nf="neededBy" value="${esc(D.neededBy)}">
      </label>
      <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
        <span>Pedir a que armazém</span>
        <select class="cell-list" data-nf="sourceWarehouseId">
          <option value="">— o armazém decide —</option>
          ${whs.map((w) => `<option value="${esc(w.id)}"${D.sourceWarehouseId === w.id ? " selected" : ""}>${esc(w.name)}</option>`).join("")}
        </select>
      </label>
      <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted);grid-column:span 2">
        <span>Para quê (justificação)</span>
        <input class="cell-manual" data-nf="justification" value="${esc(D.justification)}" placeholder="Ex.: rede BT do bairro das Acácias">
      </label>
    </div>

    <h4 class="cm-panel-title" style="font-size:.875rem;margin:1rem 0 .5rem">O que precisa</h4>
    <div class="cm-table-wrap"><table class="cm-table">
      <thead><tr><th>Material ou serviço</th><th>Un.</th><th class="num">Quantidade</th><th>Obs.</th><th></th></tr></thead>
      <tbody>${D.items
        .map(
          (i, idx) => `<tr>
            <td><input class="cell-manual" style="min-width:16rem" data-ni="${idx}|description" value="${esc(i.description)}" placeholder="Nome do material"></td>
            <td><input class="cell-manual" style="width:5rem" data-ni="${idx}|unit" value="${esc(i.unit)}"></td>
            <td class="num"><input class="cell-manual" type="number" step="any" data-ni="${idx}|quantity" value="${i.quantity ?? ""}"></td>
            <td><input class="cell-manual" data-ni="${idx}|notes" value="${esc(i.notes)}"></td>
            <td>${D.items.length > 1 ? `<button class="cm-chip" type="button" data-nx="del|${idx}">×</button>` : ""}</td>
          </tr>`
        )
        .join("")}</tbody>
    </table></div>
    <button class="cm-chip" type="button" data-nx="add" style="margin-top:.625rem">+ Item</button>

    <div class="cm-head-actions" style="margin-top:1rem;justify-content:flex-end">
      <span id="nxMsg" class="cm-lead" style="margin:0;flex:1"></span>
      <button class="cm-chip" type="button" data-nx="close">Cancelar</button>
      <button class="cm-chip" type="button" data-nx="draft">Guardar rascunho</button>
      <button class="cm-chip is-on" type="button" data-nx="submit">Submeter</button>
    </div>`
  );
  el("rqDrawer").querySelector('[data-ni="0|description"]')?.focus();
}

async function createReq(submit) {
  const D = S.draft;
  const msg = el("nxMsg");
  const items = D.items.filter((i) => String(i.description || "").trim() && Number(i.quantity) > 0);
  if (!items.length) {
    msg.textContent = "Indique pelo menos um material com quantidade.";
    return;
  }
  if (!D.projectId && !String(D.department || "").trim()) {
    msg.textContent = "Diga para que obra ou departamento é o material.";
    return;
  }
  msg.textContent = "A criar…";
  try {
    const r = await apiRequest("/requisitions", {
      method: "POST",
      body: {
        destination: D.destination,
        projectId: D.projectId || null,
        department: D.projectId ? null : D.department.trim(),
        costCategory: D.costCategory || null,
        neededBy: D.neededBy || null,
        justification: D.justification.trim() || null,
        sourceWarehouseId: D.sourceWarehouseId || null,
        items: items.map((i) => ({
          description: i.description.trim(),
          unit: i.unit || null,
          quantity: Number(i.quantity),
          notes: i.notes || null,
        })),
        submit,
      },
    });
    S.draft = null;
    await load();
    render();
    await openDoc(r.id);
    toast(submit ? `Requisição ${r.number} submetida.` : `Rascunho ${r.number} guardado.`, { type: "success" });
  } catch (err) {
    const p = err?.payload;
    msg.textContent = p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível criar.";
  }
}

// ───────────────────────── armazém da obra ─────────────────────────

async function openWarehouse(id) {
  el("rqDrawer").innerHTML = panel(`<p class="cm-lead">A carregar o armazém…</p>`);
  try {
    S.warehouse = await apiRequest(`/requisitions/warehouse/${id}/summary`);
    drawWarehouse();
  } catch (err) {
    el("rqDrawer").innerHTML = "";
    toast(err?.message || "Não foi possível abrir o armazém.", { type: "error" });
  }
}

function drawWarehouse() {
  const W = S.warehouse;
  const canMove = can("stock", "manage");
  el("rqDrawer").innerHTML = panel(
    `<div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">${esc(W.warehouse.project ? W.warehouse.project.code : "Armazém")}</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">${esc(W.warehouse.name)}</h2>
        <p class="cm-lead" style="margin-top:.25rem">
          Material que está aqui. Ao <b>dar baixa</b>, o material é consumido e passa a custo da obra.
          No fim, devolva ao armazém geral o que sobrou; perdas e roubos registam-se com o motivo.
        </p>
      </div>
      <button class="cm-chip" type="button" data-dx="close">Fechar</button>
    </div>

    <div class="cm-chips">
      <span class="cm-chip"><span>Linhas em stock</span><b>${W.value.lines}</b></span>
      <span class="cm-chip"><span>Valor em stock</span><b>${fmt(W.value.value, 2)}</b></span>
      ${W.value.withoutCost ? `<span class="cm-chip"><span>Sem custo médio</span><b>${W.value.withoutCost}</b></span>` : ""}
    </div>

    ${
      W.value.withoutCost
        ? `<div class="cm-note is-warn">${W.value.withoutCost} produto(s) sem custo médio: entraram sem preço de compra, por isso a baixa deles fica sem custo.</div>`
        : ""
    }

    <div class="cm-table-wrap"><table class="cm-table">
      <thead><tr><th>Material</th><th>Un.</th><th class="num">Quantidade</th>
        <th class="num">Custo médio</th><th class="num">Valor</th>${canMove ? "<th></th>" : ""}</tr></thead>
      <tbody>${
        W.stock.length
          ? W.stock
              .map(
                (s) => `<tr>
                  <td><b>${esc(s.product?.name || "")}</b></td>
                  <td>${esc(s.product?.unit || "")}</td>
                  <td class="num">${fmt(s.quantity, 2)}</td>
                  <td class="num">${fmt(s.avgCost, 2)}</td>
                  <td class="num">${fmt(s.value, 2)}</td>
                  ${
                    canMove
                      ? `<td style="white-space:nowrap">
                           <button class="cm-chip" type="button" data-wm="BAIXA|${esc(s.productId)}" title="Consumo na obra: passa a custo">Baixa</button>
                           <button class="cm-chip" type="button" data-wm="DEVOLUCAO|${esc(s.productId)}">Devolver</button>
                           <button class="cm-chip" type="button" data-wm="PERDA|${esc(s.productId)}">Perda</button>
                         </td>`
                      : ""
                  }
                </tr>`
              )
              .join("")
          : `<tr><td colspan="${canMove ? 6 : 5}" style="padding:1.25rem;color:var(--cm-muted)">Sem material neste armazém.</td></tr>`
      }</tbody>
    </table></div>

    ${
      W.movements.length
        ? `<h4 class="cm-panel-title" style="font-size:.875rem;margin:1rem 0 .5rem">Últimos movimentos</h4>
           <div class="cm-table-wrap"><table class="cm-table">
             <thead><tr><th>Quando</th><th>Movimento</th><th>Material</th><th class="num">Qtd.</th>
               <th class="num">Custo unit.</th><th class="num">Valor</th><th>Nota</th></tr></thead>
             <tbody>${W.movements
               .map(
                 (m) => `<tr>
                   <td>${fmtDate(m.createdAt)}</td>
                   <td>${esc(MOV_LABELS[m.type] || m.type)}</td>
                   <td>${esc(m.product?.name || "")}</td>
                   <td class="num">${fmt(m.quantity, 2)}</td>
                   <td class="num">${fmt(m.unitCost, 2)}</td>
                   <td class="num">${fmt(m.totalValue, 2)}</td>
                   <td class="small">${esc(m.notes || m.reference || "")}</td>
                 </tr>`
               )
               .join("")}</tbody>
           </table></div>`
        : ""
    }
    <span id="dxMsg" class="cm-lead" style="margin:.75rem 0 0;display:block"></span>`,
    1000
  );
}

async function doWarehouseMovement(kind, productId) {
  const W = S.warehouse;
  const LABEL = { BAIXA: "dar baixa (consumo)", DEVOLUCAO: "devolver", PERDA: "registar perda de" };
  const qty = window.prompt(`Quantidade a ${LABEL[kind]}:`, "");
  if (qty === null) return;
  if (!(Number(qty) > 0)) {
    toast("Indique uma quantidade maior que zero.", { type: "error" });
    return;
  }
  let reason = null;
  let targetWarehouseId = null;
  if (kind === "PERDA") {
    reason = window.prompt("Motivo da perda (obrigatório):", "");
    if (!reason) return;
  }
  if (kind === "DEVOLUCAO") {
    const whs = (S.meta.warehouses || []).filter((w) => w.id !== W.warehouse.id && !w.projectId);
    if (!whs.length) {
      toast("Não há armazém geral para onde devolver.", { type: "error" });
      return;
    }
    targetWarehouseId = whs[0].id;
    reason = window.prompt(`Devolver para «${whs[0].name}». Motivo (opcional):`, "");
    if (reason === null) return;
  }

  try {
    const r = await apiRequest(`/requisitions/warehouse/${W.warehouse.id}/movement`, {
      method: "POST",
      body: { kind, productId, quantity: Number(qty), targetWarehouseId, reason: reason || null },
    });
    await openWarehouse(W.warehouse.id);
    const cost = r.totalValue !== null ? ` · ${fmt(r.totalValue, 2)}` : "";
    toast(
      `${r.label}${cost}${r.becameProjectCost ? " — passou a custo da obra" : ""}.`,
      { type: "success", timeoutMs: 6000 }
    );
    if (r.warnings?.length) toast(r.warnings.join(" "), { type: "info", timeoutMs: 7000 });
  } catch (err) {
    const p = err?.payload;
    toast(p?.errors?.length ? p.errors.join(" ") : err?.message || "Não foi possível registar o movimento.", { type: "error" });
  }
}

// ───────────────────────── eventos ─────────────────────────

function wire() {
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset?.nf !== undefined && S.draft) {
      S.draft[t.dataset.nf] = t.value;
      return;
    }
    if (t.dataset?.ni && S.draft) {
      const [i, k] = t.dataset.ni.split("|");
      S.draft.items[Number(i)][k] = k === "quantity" ? (t.value === "" ? null : Number(t.value)) : t.value;
      return;
    }
    if (t.id === "rqSearch") {
      S.q = t.value;
      clearTimeout(wire._t);
      wire._t = setTimeout(async () => {
        await load();
        render();
        const again = el("rqSearch");
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      }, 300);
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset?.nf !== undefined && S.draft) {
      S.draft[t.dataset.nf] = t.value;
      if (t.dataset.nf === "projectId") drawNew();
    }
  });

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-role],[data-open],[data-dx],[data-nx],[data-wm],#rqNew");
    if (!t) return;

    if (t.dataset.role !== undefined) {
      S.role = t.dataset.role;
      const u = new URL(window.location.href);
      if (S.role) u.searchParams.set("aba", S.role);
      else u.searchParams.delete("aba");
      window.history.replaceState({}, "", u);
      await load();
      render();
      return;
    }
    if (t.dataset.open) return openDoc(t.dataset.open);
    if (t.id === "rqNew") return openNew();

    if (t.dataset.nx) {
      const [a, i] = t.dataset.nx.split("|");
      if (a === "close") {
        S.draft = null;
        el("rqDrawer").innerHTML = "";
      } else if (a === "add") {
        S.draft.items.push({ description: "", unit: "", quantity: null });
        drawNew();
      } else if (a === "del") {
        S.draft.items.splice(Number(i), 1);
        drawNew();
      } else if (a === "draft") await createReq(false);
      else if (a === "submit") await createReq(true);
      return;
    }

    if (t.dataset.wm) {
      const [kind, productId] = t.dataset.wm.split("|");
      return doWarehouseMovement(kind, productId);
    }

    if (t.dataset.dx) {
      const a = t.dataset.dx;
      if (a === "close") {
        S.open = null;
        S.warehouse = null;
        el("rqDrawer").innerHTML = "";
        return;
      }
      if (a === "back") return drawDoc();
      if (a === "submit") return act("submit");
      if (a === "approve") return act("decision", { decision: "APROVAR" });
      if (a === "refuse") {
        const reason = window.prompt("Motivo da recusa (obrigatório):", "");
        if (!reason) return;
        return act("decision", { decision: "RECUSAR", reason });
      }
      if (a === "deliver") return openDeliver();
      if (a === "deliver-ok") return doDeliver();
      if (a === "purchase") {
        const reason = window.prompt("Porque é que vai a compra? (opcional)", "Sem stock no armazém.");
        if (reason === null) return;
        return act("to-purchase", { reason: reason || null });
      }
      if (a === "cancel") {
        const reason = window.prompt("Motivo do cancelamento (opcional):", "");
        if (reason === null) return;
        return act("cancel", { reason: reason || null });
      }
    }
  });
}

// ───────────────────────── arranque ─────────────────────────

(async () => {
  const ok = await guardPageAccess("obras:view|stock:view");
  if (!ok) return;

  initMobileMenu();
  wireLogout();
  wireUsersNav();
  await initPermissionLayer();

  el("rqContent").innerHTML = `<p class="cm-lead">A carregar requisições…</p>`;
  try {
    S.meta = await apiRequest("/requisitions/meta");
    await load();
    wire();
    render();

    // Atalho para o armazém de uma obra, quando se chega por lá
    const wh = new URLSearchParams(window.location.search).get("armazem");
    if (wh) openWarehouse(wh);

    // Lista de armazéns, para quem gere o stock
    if (can("stock", "view")) {
      const whs = (S.meta.warehouses || []).filter((w) => w.projectId);
      if (whs.length) {
        el("rqWarehouses").innerHTML = `
          <h3 class="cm-panel-title" style="font-size:.9375rem">Armazéns das obras</h3>
          <p class="cm-panel-sub">O material entregue fica aqui. A baixa é que passa a custo da obra.</p>
          <div class="cm-chips">${whs
            .map((w) => `<button type="button" class="cm-chip" data-wh="${esc(w.id)}"><span>${esc(w.name)}</span></button>`)
            .join("")}</div>`;
        el("rqWarehouses").addEventListener("click", (e) => {
          const b = e.target.closest("[data-wh]");
          if (b) openWarehouse(b.dataset.wh);
        });
      }
    }
  } catch (err) {
    el("rqContent").innerHTML = `<div class="cm-note is-bad">Não foi possível carregar: ${esc(err?.message || err)}</div>`;
  }
})();
