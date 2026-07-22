import { apiRequest, apiUpload } from "/services/api.js";
import { guardPageAccess, initPermissionLayer, can } from "/shared/permissions.js";
import { getSessionUser } from "/services/auth.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu } from "/shared/ui.js";
import { formatCurrency, formatDateBR } from "/shared/format.js";

let generalCenters = [];
let allProjects = [];
let allCards = [];
let managedCards = [];
let selectedCardId = null;
let selectedCardCache = null;
let selectedGccFilter = "";
let extrasCache = [];

const CARD_TYPE_LABELS = { PREPAGO: "Pré-pago", DEBITO: "Débito", CREDITO: "Crédito" };

const EXTRA_STATUS_LABELS = {
  PENDENTE: "Pendente",
  APROVADO: "A liquidar",
  PAGO: "Pago",
  REJEITADO: "Rejeitado",
  CANCELADO: "Cancelado",
};

const EXTRA_STATUS_STYLES = {
  PENDENTE: "bg-amber-100 text-amber-700",
  APROVADO: "bg-indigo-100 text-indigo-700",
  PAGO: "bg-emerald-100 text-emerald-700",
  REJEITADO: "bg-red-100 text-red-700",
  CANCELADO: "bg-slate-100 text-slate-600",
};

const EXTRA_SOURCE_LABELS = {
  CAIXA: "Caixa",
  BANCO: "Banco",
  FUNDO_MANEIO: "Cartão",
  SOLICITACAO_TRANSFERENCIA: "Solicitação de Transferência",
};

function cardScopeLabel(card) {
  if (!card?.projectId) return "Global";
  const p = card.project || allProjects.find((pr) => pr.id === card.projectId);
  if (p) return `${p.name}${p.code ? ` (${p.code})` : ""}`;
  return "Obra";
}

function apiErrorMessage(err) {
  return err?.data?.message || err?.message || "Erro desconhecido";
}

function movementReferenceLabel(m) {
  const ex = m.extraRequest;
  if (!ex) return "—";
  if (ex.generalCostCenter?.name) return ex.generalCostCenter.name;
  if (ex.project) return `${ex.project.name}${ex.project.code ? ` (${ex.project.code})` : ""}`;
  return "Pedido extra";
}

function showToast(msg, type = "info") {
  const container = document.getElementById("toast");
  const colors = {
    success: "bg-emerald-600 text-white",
    error: "bg-red-600 text-white",
    info: "bg-slate-800 text-white",
  };
  const icons = { success: "check_circle", error: "error", info: "info" };
  const el = document.createElement("div");
  el.className = `pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl text-sm font-bold ${colors[type]}`;
  el.innerHTML = `<span class="material-symbols-outlined text-base">${icons[type]}</span>${msg}`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
  }, 3500);
}

function renderGeneralCentersGrid() {
  const grid = document.getElementById("gccGrid");
  const meta = document.getElementById("gccSectionMeta");
  if (meta) {
    meta.textContent = generalCenters.length
      ? `${generalCenters.length} centro(s) geral(is) configurado(s)`
      : "Nenhum centro geral configurado";
  }
  if (!generalCenters.length) {
    grid.innerHTML = `<p class="text-sm text-slate-400 col-span-full">Nenhum centro geral configurado.</p>`;
    return;
  }
  grid.innerHTML = generalCenters
    .map(
      (cc) => `
    <button type="button" data-gcc-id="${cc.id}"
      class="gcc-card text-left ${selectedGccFilter === cc.id ? "gcc-card--active" : ""}">
      <div class="flex items-start gap-3">
        <span class="material-symbols-outlined text-emerald-600 text-xl mt-0.5">account_balance_wallet</span>
        <div class="min-w-0">
          <p class="text-sm font-bold text-slate-900">${cc.name}</p>
          <p class="text-[11px] text-slate-500 mt-1 leading-relaxed">${cc.description || "—"}</p>
        </div>
      </div>
    </button>`
    )
    .join("");

  grid.querySelectorAll("[data-gcc-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.gccId;
      selectedGccFilter = selectedGccFilter === id ? "" : id;
      document.getElementById("filterGeneralCc").value = selectedGccFilter;
      renderGeneralCentersGrid();
      loadExtras();
    });
  });
}

function populateGeneralCcSelects() {
  const opts = generalCenters
    .map((cc) => `<option value="${cc.id}">${cc.name}</option>`)
    .join("");
  document.getElementById("extraGeneralCcId").innerHTML =
    `<option value="">Selecionar centro geral...</option>${opts}`;
  document.getElementById("filterGeneralCc").innerHTML =
    `<option value="">Todos os centros gerais</option>${opts}`;
}

function populateProjectSelects() {
  const opts = allProjects
    .map((p) => `<option value="${p.id}">${p.name}${p.code ? ` (${p.code})` : ""}</option>`)
    .join("");
  document.getElementById("extraProjectId").innerHTML =
    `<option value="">Selecionar obra...</option>${opts}`;
  document.getElementById("filterProject").innerHTML =
    `<option value="">Todas as obras</option>${opts}`;
  document.getElementById("filterCardProject").innerHTML =
    `<option value="">Todas as obras</option>${opts}`;
  document.getElementById("cardProjectId").innerHTML =
    `<option value="">Selecionar obra...</option>${opts}`;
}

function escapeAttr(value) {
  return String(value || "").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

function renderIconBtn(icon, title, variant = "slate", { attrs = "", disabled = false } = {}) {
  const disabledAttr = disabled ? "disabled" : "";
  const mutedClass = disabled ? " fin-icon-btn--muted" : "";
  return `
    <button type="button" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}"
      class="fin-icon-btn fin-icon-btn--${variant}${mutedClass}" ${disabledAttr} ${attrs}>
      <span class="material-symbols-outlined text-base">${icon}</span>
    </button>`;
}

function toDateInputValue(value) {
  if (!value) return "";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function extraReferenceLabel(it) {
  if (it.type === "GERAL") {
    return it.generalCostCenter?.name || "Centro geral";
  }
  const obra = it.project
    ? `${it.project.name}${it.project.code ? ` (${it.project.code})` : ""}`
    : "";
  const cc = it.costCenter
    ? `${it.costCenter.code ? `${it.costCenter.code} — ` : ""}${it.costCenter.name}`
    : "";
  if (obra && cc) return `${obra} · ${cc}`;
  return obra || cc || "—";
}

async function loadCostCentersForExtra(projectId, selectedId = "") {
  const select = document.getElementById("extraCostCenterId");
  if (!select) return;
  if (!projectId) {
    select.innerHTML = `<option value="">Seleccione primeiro a obra...</option>`;
    select.value = "";
    return;
  }
  select.innerHTML = `<option value="">A carregar...</option>`;
  try {
    const data = await apiRequest(`/cost-centers/project/${projectId}`);
    const items = (data.items || []).filter((cc) => cc.active !== false);
    select.innerHTML =
      `<option value="">Selecionar centro de custo...</option>` +
      items
        .map(
          (cc) =>
            `<option value="${cc.id}">${cc.code} — ${cc.name}${cc.currency ? ` (${cc.currency})` : ""}</option>`
        )
        .join("");
    if (selectedId) select.value = selectedId;
  } catch (err) {
    console.error("Erro ao carregar centros de custo:", err);
    select.innerHTML = `<option value="">Erro ao carregar centros</option>`;
    showToast("Erro ao carregar centros de custo: " + err.message, "error");
  }
}

function renderExtraRow(it) {
  const sourceLabel =
    it.paymentSource === "FUNDO_MANEIO"
      ? `Cartão: ${it.card?.label || it.fund?.name || "—"}`
      : EXTRA_SOURCE_LABELS[it.paymentSource] || it.paymentSource;
  const statusBadge = `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${EXTRA_STATUS_STYLES[it.status] || ""}">${EXTRA_STATUS_LABELS[it.status] || it.status}</span>`;
  const typeBadge =
    it.type === "GERAL"
      ? `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-violet-100 text-violet-700">Geral</span>`
      : `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-sky-100 text-sky-700">Obra</span>`;

  const actions = [];
  const canApprove = can("pedidosExtras", "approve");
  const canCreate = can("pedidosExtras", "create");
  const canDelete = can("pedidosExtras", "delete");
  const canEdit = canCreate && (it.status === "PENDENTE" || it.status === "APROVADO");

  if (canEdit) {
    actions.push(
      renderIconBtn("edit", "Editar pedido extra", "blue", {
        attrs: `data-action="edit" data-id="${it.id}"`,
      })
    );
  }
  if (it.status === "PENDENTE" && canApprove) {
    actions.push(
      renderIconBtn("check_circle", "Aprovar", "emerald", {
        attrs: `data-action="approve" data-id="${it.id}"`,
      }),
      renderIconBtn("block", "Rejeitar", "red", {
        attrs: `data-action="reject" data-id="${it.id}"`,
      })
    );
  }
  if ((it.status === "PENDENTE" || it.status === "APROVADO") && canCreate) {
    actions.push(
      renderIconBtn("cancel", "Cancelar pedido", "amber", {
        attrs: `data-action="cancel" data-id="${it.id}"`,
      })
    );
  }
  if (canDelete && it.status !== "PAGO" && it.status !== "APROVADO") {
    actions.push(
      renderIconBtn("delete", "Eliminar", "red", {
        attrs: `data-action="delete" data-id="${it.id}"`,
      })
    );
  }

  const actionsHtml = actions.length
    ? `<div class="fin-actions">${actions.join("")}</div>`
    : `<span class="text-slate-300">—</span>`;

  return `<tr class="border-t border-slate-50 hover:bg-slate-50/50">
    <td class="px-5 py-3 text-xs font-bold text-slate-800">${it.paymentDueDate ? formatDateBR(it.paymentDueDate) : "—"}</td>
    <td class="px-5 py-3 text-xs text-slate-500">${formatDateBR(it.createdAt)}</td>
    <td class="px-5 py-3">${typeBadge}</td>
    <td class="px-5 py-3 text-xs font-semibold text-slate-700 max-w-[180px] truncate">${extraReferenceLabel(it)}</td>
    <td class="px-5 py-3 text-xs font-semibold text-slate-700 max-w-[200px] truncate">${it.description}</td>
    <td class="px-5 py-3 text-xs text-slate-500">${sourceLabel}</td>
    <td class="px-5 py-3 text-xs font-bold text-slate-900 text-right">${formatCurrency(it.amount, it.currency)}</td>
    <td class="px-5 py-3">${statusBadge}</td>
    <td class="px-5 py-3 text-center">${actionsHtml}</td>
  </tr>`;
}

async function loadExtras() {
  const tbody = document.getElementById("extrasTableBody");
  tbody.innerHTML = `<tr><td colspan="9" class="text-center py-12"><div class="spinner mx-auto"></div></td></tr>`;

  const type = document.getElementById("filterType")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";
  const generalCostCenterId = document.getElementById("filterGeneralCc")?.value || "";
  const projectId = document.getElementById("filterProject")?.value || "";

  const params = new URLSearchParams({ pageSize: "100" });
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  if (generalCostCenterId) params.set("generalCostCenterId", generalCostCenterId);
  if (projectId) params.set("projectId", projectId);

  try {
    const data = await apiRequest(`/extra-requests?${params.toString()}`);
    const items = data.items || [];
    extrasCache = items;
    const meta = document.getElementById("extrasSectionMeta");
    if (meta) {
      const pending = items.filter((it) => it.status === "PENDENTE").length;
      meta.textContent = items.length
        ? `${items.length} pedido(s) · ${pending} pendente(s)`
        : "Nenhum pedido extra encontrado";
    }
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-10 text-slate-400 text-xs">Nenhum pedido extra encontrado</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(renderExtraRow).join("");
    bindTableActions();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-10 text-red-500 text-xs font-bold">${err.message}</td></tr>`;
  }
}

function bindTableActions() {
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === "edit") {
        openExtraModalForEdit(id);
      } else if (action === "approve") {
        if (!confirm("Aprovar este Pedido Extra?")) return;
        try {
          await apiRequest(`/extra-requests/${id}/approve`, { method: "PATCH" });
          showToast("Pedido aprovado", "success");
          loadExtras();
        } catch (err) {
          showToast("Erro: " + err.message, "error");
        }
      } else if (action === "reject") {
        const reason = prompt("Motivo da rejeição (opcional):") || "";
        try {
          await apiRequest(`/extra-requests/${id}/reject`, { method: "PATCH", body: { reason } });
          showToast("Pedido rejeitado", "success");
          loadExtras();
        } catch (err) {
          showToast("Erro: " + err.message, "error");
        }
      } else if (action === "cancel") {
        if (!confirm("Cancelar este Pedido Extra?")) return;
        try {
          await apiRequest(`/extra-requests/${id}/cancel`, { method: "PATCH" });
          showToast("Pedido cancelado", "success");
          loadExtras();
        } catch (err) {
          showToast("Erro: " + err.message, "error");
        }
      } else if (action === "delete") {
        if (!confirm("Eliminar permanentemente este Pedido Extra?")) return;
        try {
          await apiRequest(`/extra-requests/${id}`, { method: "DELETE" });
          showToast("Pedido eliminado", "success");
          loadExtras();
        } catch (err) {
          showToast("Erro: " + err.message, "error");
        }
      }
    });
  });
}

function setExtraType(type) {
  const isGeral = type === "GERAL";
  document.getElementById("extraType").value = type;
  document.getElementById("btnTypeGeral").classList.toggle("active", isGeral);
  document.getElementById("btnTypeObra").classList.toggle("active", !isGeral);
  document.getElementById("rowGeneralCc").classList.toggle("hidden", !isGeral);
  document.getElementById("rowProject").classList.toggle("hidden", isGeral);
  document.getElementById("rowObraCostCenter").classList.toggle("hidden", isGeral);
  document.getElementById("extraGeneralCcId").required = isGeral;
  document.getElementById("extraProjectId").required = !isGeral;
  document.getElementById("extraCostCenterId").required = !isGeral;
  if (isGeral) {
    document.getElementById("extraCostCenterId").value = "";
  }
  document.getElementById("modalExtraTitle").textContent = isGeral
    ? "Novo Pedido Extra Geral"
    : "Novo Pedido Extra da Obra";
  ensureCardsLoadedForExtra(type);
}

function toggleExtraPaymentFields() {
  const source = document.getElementById("extraSource").value;
  const isEdit = Boolean(document.getElementById("extraEditId").value);
  const editing = isEdit ? extrasCache.find((e) => e.id === document.getElementById("extraEditId").value) : null;
  document.getElementById("extraCardRow").classList.toggle("hidden", source !== "FUNDO_MANEIO");
  document.getElementById("extraProformaRow").classList.toggle("hidden", source !== "SOLICITACAO_TRANSFERENCIA");
  const proformaInput = document.getElementById("extraProforma");
  if (proformaInput) {
    proformaInput.required = source === "SOLICITACAO_TRANSFERENCIA" && !isEdit && !editing?.proformaUrl;
    if (source !== "SOLICITACAO_TRANSFERENCIA") proformaInput.value = "";
  }
  const proformaHint = document.getElementById("extraProformaHint");
  if (proformaHint) {
    proformaHint.classList.toggle(
      "hidden",
      !(source === "SOLICITACAO_TRANSFERENCIA" && editing?.proformaUrl)
    );
  }
}

async function ensureCardsLoadedForExtra(type) {
  try {
    const projectId = document.getElementById("extraProjectId")?.value || "";
    const params = new URLSearchParams();
    if (type === "OBRA" && projectId) params.set("projectId", projectId);
    const data = await apiRequest(`/petty-cash/cards${params.toString() ? `?${params}` : ""}`);
    allCards = data.items || [];
  } catch (err) {
    console.error("Erro ao carregar cartões:", err);
    allCards = [];
  }
  populateExtraCardSelect();
}

function populateExtraCardSelect() {
  const cardSelect = document.getElementById("extraCardId");
  const type = document.getElementById("extraType").value || "GERAL";
  const projectId = document.getElementById("extraProjectId")?.value || "";
  let cards = allCards.filter((c) => c.active !== false);
  if (type === "OBRA" && projectId) {
    cards = cards.filter((c) => !c.projectId || c.projectId === projectId);
  }
  cardSelect.innerHTML =
    `<option value="">Selecionar cartão...</option>` +
    cards
      .map(
        (c) =>
          `<option value="${c.id}" data-fund-id="${c.fundId}">${c.label} (${formatCurrency(c.currentBalance, c.currency)})</option>`
      )
      .join("");
  syncExtraFundFromCard();
}

function syncExtraFundFromCard() {
  const cardSelect = document.getElementById("extraCardId");
  const selected = cardSelect.options[cardSelect.selectedIndex];
  document.getElementById("extraFundId").value = selected?.dataset?.fundId || "";
}

function setExtraFormLocked(locked) {
  document.getElementById("btnTypeGeral").disabled = locked;
  document.getElementById("btnTypeObra").disabled = locked;
  document.getElementById("extraGeneralCcId").disabled = locked;
  document.getElementById("extraProjectId").disabled = locked;
  document.getElementById("extraCostCenterId").disabled = locked;
  document.getElementById("extraTypeRow")?.classList.toggle("opacity-60", locked);
}

function resetExtraFormState() {
  document.getElementById("extraEditId").value = "";
  document.getElementById("modalExtraTitle").textContent = "Novo Pedido Extra";
  document.getElementById("extraSubmitBtn").textContent = "Guardar Pedido";
  document.getElementById("extraProformaHint")?.classList.add("hidden");
  setExtraFormLocked(false);
}

async function openExtraModalForEdit(id) {
  const item = extrasCache.find((e) => e.id === id);
  if (!item) {
    showToast("Pedido extra não encontrado", "error");
    return;
  }
  if (item.status !== "PENDENTE" && item.status !== "APROVADO") {
    showToast("Só é possível editar pedidos não liquidados", "error");
    return;
  }

  document.getElementById("formExtra").reset();
  document.getElementById("extraEditId").value = item.id;
  document.getElementById("modalExtraTitle").textContent = "Editar Pedido Extra";
  document.getElementById("extraSubmitBtn").textContent = "Guardar alterações";

  setExtraType(item.type);
  setExtraFormLocked(true);

  if (item.type === "GERAL") {
    document.getElementById("extraGeneralCcId").value = item.generalCostCenterId || "";
    if (item.paymentSource === "FUNDO_MANEIO") {
      await ensureCardsLoadedForExtra("GERAL");
    }
  } else {
    document.getElementById("extraProjectId").value = item.projectId || "";
    await loadCostCentersForExtra(item.projectId, item.costCenterId || "");
    await ensureCardsLoadedForExtra("OBRA");
  }

  document.getElementById("extraDesc").value = item.description || "";
  document.getElementById("extraAmount").value = item.amount || "";
  document.getElementById("extraPaymentDueDate").value = toDateInputValue(item.paymentDueDate);
  document.getElementById("extraSource").value = item.paymentSource || "SOLICITACAO_TRANSFERENCIA";
  toggleExtraPaymentFields();

  if (item.cardId) document.getElementById("extraCardId").value = item.cardId;
  syncExtraFundFromCard();
  if (!document.getElementById("extraFundId").value && item.fundId) {
    document.getElementById("extraFundId").value = item.fundId;
  }

  document.getElementById("extraNotes").value = item.notes || "";

  const proformaInput = document.getElementById("extraProforma");
  if (proformaInput) proformaInput.required = false;
  const proformaHint = document.getElementById("extraProformaHint");
  if (proformaHint) {
    proformaHint.classList.toggle("hidden", !(item.paymentSource === "SOLICITACAO_TRANSFERENCIA" && item.proformaUrl));
  }

  document.getElementById("modalExtra").classList.add("open");
}

async function openExtraModal(prefillType = "GERAL", prefillGccId = "") {
  document.getElementById("formExtra").reset();
  resetExtraFormState();
  setExtraType(prefillType);
  if (prefillGccId) {
    document.getElementById("extraGeneralCcId").value = prefillGccId;
  }
  const dueInput = document.getElementById("extraPaymentDueDate");
  if (dueInput) dueInput.value = new Date().toISOString().slice(0, 10);
  toggleExtraPaymentFields();
  document.getElementById("modalExtra").classList.add("open");
}

function closeExtraModal() {
  document.getElementById("modalExtra").classList.remove("open");
  resetExtraFormState();
}

async function submitExtra(e) {
  e.preventDefault();
  const editId = document.getElementById("extraEditId").value;
  const type = document.getElementById("extraType").value || "GERAL";
  const source = document.getElementById("extraSource").value;
  const body = {
    type,
    projectId: type === "OBRA" ? document.getElementById("extraProjectId").value || null : null,
    costCenterId: type === "OBRA" ? document.getElementById("extraCostCenterId").value || null : null,
    generalCostCenterId:
      type === "GERAL" ? document.getElementById("extraGeneralCcId").value || null : null,
    description: document.getElementById("extraDesc").value.trim(),
    amount: parseFloat(document.getElementById("extraAmount").value) || 0,
    paymentDueDate: document.getElementById("extraPaymentDueDate").value,
    paymentSource: source,
    fundId: source === "FUNDO_MANEIO" ? document.getElementById("extraFundId").value || null : null,
    cardId: source === "FUNDO_MANEIO" ? document.getElementById("extraCardId").value || null : null,
    notes: document.getElementById("extraNotes").value.trim() || null,
  };

  if (!editId) {
    if (type === "GERAL" && !body.generalCostCenterId) {
      showToast("Seleccione o centro de custo geral", "error");
      return;
    }
    if (type === "OBRA" && !body.projectId) {
      showToast("Seleccione a obra", "error");
      return;
    }
    if (type === "OBRA" && !body.costCenterId) {
      showToast("Seleccione o centro de custo da obra", "error");
      return;
    }
  }

  if (!body.paymentDueDate) {
    showToast("Indique a data prevista de liquidação", "error");
    return;
  }

  if (source === "FUNDO_MANEIO" && !body.cardId) {
    showToast("Seleccione o cartão", "error");
    return;
  }

  const editing = extrasCache.find((item) => item.id === editId);
  const proformaFile = document.getElementById("extraProforma")?.files?.[0];
  const needsProforma = source === "SOLICITACAO_TRANSFERENCIA";
  const hasExistingProforma = Boolean(editing?.proformaUrl);

  if (needsProforma && !editId && !proformaFile) {
    showToast("Anexe a proforma para transferência bancária", "error");
    return;
  }
  if (needsProforma && editId && !hasExistingProforma && !proformaFile) {
    showToast("Anexe a proforma para transferência bancária", "error");
    return;
  }

  try {
    if (editId) {
      const patchBody = {
        description: body.description,
        amount: body.amount,
        paymentDueDate: body.paymentDueDate,
        paymentSource: body.paymentSource,
        fundId: body.fundId,
        cardId: body.cardId,
        notes: body.notes,
      };
      await apiRequest(`/extra-requests/${editId}`, { method: "PATCH", body: patchBody });
      if (needsProforma && proformaFile) {
        const fd = new FormData();
        fd.append("proforma", proformaFile);
        await apiUpload(`/extra-requests/${editId}/proforma`, fd);
      }
      showToast("Pedido Extra actualizado", "success");
    } else {
      const created = await apiRequest("/extra-requests", { method: "POST", body });
      if (needsProforma && proformaFile) {
        const fd = new FormData();
        fd.append("proforma", proformaFile);
        await apiUpload(`/extra-requests/${created.id}/proforma`, fd);
      }
      showToast("Pedido Extra criado", "success");
    }
    closeExtraModal();
    loadExtras();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

function bindEvents() {
  document.getElementById("btnNewGcc")?.addEventListener("click", () => {
    if (!can("pedidosExtras", "create")) {
      showToast("Sem permissão para criar centros gerais", "error");
      return;
    }
    openGccModal();
  });
  document.getElementById("formGcc")?.addEventListener("submit", submitGcc);
  document.getElementById("btnCloseGccModal")?.addEventListener("click", closeGccModal);
  document.getElementById("btnCancelGcc")?.addEventListener("click", closeGccModal);

  document.getElementById("btnNewExtra")?.addEventListener("click", () => {
    if (!can("pedidosExtras", "create")) {
      showToast("Sem permissão para criar pedidos extra", "error");
      return;
    }
    openExtraModal(selectedGccFilter ? "GERAL" : "GERAL", selectedGccFilter);
  });
  document.getElementById("btnTypeGeral")?.addEventListener("click", () => setExtraType("GERAL"));
  document.getElementById("btnTypeObra")?.addEventListener("click", () => setExtraType("OBRA"));
  document.getElementById("extraSource")?.addEventListener("change", toggleExtraPaymentFields);
  document.getElementById("extraCardId")?.addEventListener("change", syncExtraFundFromCard);
  document.getElementById("extraProjectId")?.addEventListener("change", async () => {
    if (document.getElementById("extraType").value === "OBRA") {
      const projectId = document.getElementById("extraProjectId").value;
      await loadCostCentersForExtra(projectId);
      await ensureCardsLoadedForExtra("OBRA");
    }
  });
  document.getElementById("formExtra")?.addEventListener("submit", submitExtra);
  document.getElementById("btnCloseExtraModal")?.addEventListener("click", closeExtraModal);
  document.getElementById("btnCancelExtra")?.addEventListener("click", closeExtraModal);

  ["filterType", "filterStatus", "filterGeneralCc", "filterProject"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      if (id === "filterGeneralCc") {
        selectedGccFilter = document.getElementById("filterGeneralCc").value;
        renderGeneralCentersGrid();
      }
      loadExtras();
    });
  });

  bindCardEvents();
}

async function loadGeneralCenters() {
  const gccData = await apiRequest("/general-cost-centers");
  generalCenters = gccData.items || [];
  populateGeneralCcSelects();
  renderGeneralCentersGrid();
}

function openGccModal() {
  document.getElementById("formGcc").reset();
  document.getElementById("modalGcc").classList.add("open");
}

function closeGccModal() {
  document.getElementById("modalGcc").classList.remove("open");
}

async function submitGcc(e) {
  e.preventDefault();
  const name = document.getElementById("gccName").value.trim();
  const description = document.getElementById("gccDescription").value.trim();
  if (!name) {
    showToast("Indique o nome do centro geral", "error");
    return;
  }
  try {
    const created = await apiRequest("/general-cost-centers", {
      method: "POST",
      body: { name, description: description || null },
    });
    showToast(`Centro "${created.name}" criado`, "success");
    closeGccModal();
    await loadGeneralCenters();
    selectedGccFilter = created.id;
    document.getElementById("filterGeneralCc").value = created.id;
    renderGeneralCentersGrid();
    loadExtras();
  } catch (err) {
    showToast("Erro: " + err.message, "error");
  }
}

// ── Gestão de Cartões ────────────────────────────────────────────────────────

function updateCardsSectionMeta() {
  const meta = document.getElementById("cardsSectionMeta");
  if (!meta) return;
  const cards = getFilteredManagedCards();
  if (!cards.length) {
    meta.textContent = "Nenhum cartão encontrado";
    return;
  }
  const totalBalance = cards.reduce((sum, c) => sum + Number(c.currentBalance || 0), 0);
  const currency = cards[0]?.currency || "AOA";
  meta.textContent = `${cards.length} cartão(ões) · ${formatCurrency(totalBalance, currency)} total visível`;
}

function isCardDetailOpen() {
  return document.getElementById("modalCardDetail")?.classList.contains("open");
}

function openCardDetailModal() {
  document.getElementById("modalCardDetail")?.classList.add("open");
}

function closeCardDetailModal() {
  document.getElementById("modalCardDetail")?.classList.remove("open");
  selectedCardId = null;
  selectedCardCache = null;
  renderCardsGrid();
}

function toggleSectionPanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const collapsed = panel.classList.toggle("is-collapsed");
  const toggle = panel.querySelector("[data-section-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function bindSectionToggles() {
  document.querySelectorAll("[data-section-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggleSectionPanel(btn.dataset.sectionToggle));
  });
}

function setSectionCollapsed(panelId, collapsed) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.classList.toggle("is-collapsed", collapsed);
  const toggle = panel.querySelector("[data-section-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function setCardScope(scope) {
  const isGlobal = scope === "global";
  document.getElementById("cardScope").value = scope;
  document.getElementById("btnCardScopeGlobal").classList.toggle("active", isGlobal);
  document.getElementById("btnCardScopeObra").classList.toggle("active", !isGlobal);
  document.getElementById("rowCardProject").classList.toggle("hidden", isGlobal);
  document.getElementById("cardProjectId").required = !isGlobal;
}

function getFilteredManagedCards() {
  const scope = document.getElementById("filterCardScope")?.value || "";
  const projectId = document.getElementById("filterCardProject")?.value || "";
  return managedCards.filter((c) => {
    if (scope === "global" && c.projectId) return false;
    if (scope === "obra" && !c.projectId) return false;
    if (projectId && c.projectId !== projectId) return false;
    return true;
  });
}

async function loadCards() {
  const grid = document.getElementById("cardsGrid");
  if (!grid) return;
  grid.innerHTML = `<div class="col-span-full flex justify-center py-8"><div class="spinner"></div></div>`;

  const projectId = document.getElementById("filterCardProject")?.value || "";
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);

  try {
    const data = await apiRequest(`/petty-cash/cards${params.toString() ? `?${params}` : ""}`);
    managedCards = data.items || [];
    allCards = managedCards;
    renderCardsGrid();
    updateCardsSectionMeta();
    if (selectedCardId && isCardDetailOpen()) {
      await selectCard(selectedCardId);
    }
  } catch (err) {
    grid.innerHTML = `<p class="text-center py-8 text-red-500 text-xs font-bold col-span-full">${err.message}</p>`;
  }
}

function renderCardsGrid() {
  const grid = document.getElementById("cardsGrid");
  const cards = getFilteredManagedCards();
  if (!cards.length) {
    grid.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center py-12 text-slate-400">
      <span class="material-symbols-outlined text-4xl mb-2">credit_card</span>
      <p class="text-sm font-semibold">Nenhum cartão encontrado</p>
    </div>`;
    return;
  }
  grid.innerHTML = cards
    .map((c) => {
      const active = c.id === selectedCardId;
      const balance = Number(c.currentBalance || 0);
      const scope = cardScopeLabel(c);
      const scopeBadge = c.projectId
        ? `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-sky-100 text-sky-700">${scope}</span>`
        : `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-violet-100 text-violet-700">Global</span>`;
      const meta = [c.bank, c.holderName, CARD_TYPE_LABELS[c.type] || c.type].filter(Boolean).join(" · ");
      return `<button type="button" data-card-id="${c.id}"
        class="card-item ${active ? "card-item--active" : ""}">
        <div class="flex items-start justify-between gap-2 mb-2">${scopeBadge}</div>
        <p class="text-xs font-bold text-slate-400 uppercase tracking-wide truncate">${c.label}${c.lastDigits ? ` •••• ${c.lastDigits}` : ""}</p>
        <p class="text-2xl font-bold text-slate-900 mt-1">${formatCurrency(balance, c.currency)}</p>
        <p class="text-[11px] text-slate-400 mt-1">${meta || "Cartão"}</p>
        <span class="fund-card__hint"><span class="material-symbols-outlined text-sm">open_in_new</span> Ver detalhes</span>
      </button>`;
    })
    .join("");

  grid.querySelectorAll("[data-card-id]").forEach((btn) => {
    btn.addEventListener("click", () => selectCard(btn.dataset.cardId));
  });
}

async function selectCard(cardId) {
  selectedCardId = cardId;
  renderCardsGrid();
  openCardDetailModal();
  document.getElementById("cardMovementsBody").innerHTML =
    `<tr><td colspan="6" class="text-center py-8"><div class="spinner mx-auto"></div></td></tr>`;

  try {
    const data = await apiRequest(`/petty-cash/cards/${cardId}?pageSize=30`);
    const card = data.card;
    selectedCardCache = card;
    const balance = Number(card.currentBalance || 0);
    document.getElementById("cardDetailName").textContent =
      `${card.label}${card.lastDigits ? ` •••• ${card.lastDigits}` : ""} · ${formatCurrency(balance, card.currency)}`;
    document.getElementById("cardDetailScope").textContent =
      `${cardScopeLabel(card)} · Histórico de carregamentos e gastos`;

    const movements = data.movements.items || [];
    document.getElementById("cardMovementsBody").innerHTML =
      movements
        .map((m) => {
          const typeColor =
            m.type === "DEBITO" ? "text-red-600" : m.type === "CREDITO" ? "text-emerald-600" : "text-amber-600";
          const sign = m.type === "DEBITO" ? "-" : "+";
          return `<tr class="border-t border-slate-50">
            <td class="px-4 py-3 text-xs text-slate-500">${formatDateBR(m.createdAt)}</td>
            <td class="px-4 py-3 text-xs font-bold ${typeColor}">${m.type}</td>
            <td class="px-4 py-3 text-xs text-slate-700">${m.description}</td>
            <td class="px-4 py-3 text-xs text-slate-500">${movementReferenceLabel(m)}</td>
            <td class="px-4 py-3 text-xs font-bold ${typeColor} text-right">${sign}${formatCurrency(m.amount, card.currency)}</td>
            <td class="px-4 py-3 text-xs text-slate-500 text-right">${formatCurrency(m.balanceAfter, card.currency)}</td>
          </tr>`;
        })
        .join("") ||
      `<tr><td colspan="6" class="text-center py-8 text-slate-400 text-xs">Sem movimentações registadas</td></tr>`;

    updateCardActionButtons();
  } catch (err) {
    showToast("Erro ao carregar cartão: " + err.message, "error");
  }
}

function updateCardActionButtons() {
  const canCreate = can("fundoManeio", "create");
  const canManage = can("fundoManeio", "manage");
  const canEdit = can("fundoManeio", "edit") || canManage;
  document.getElementById("cardLoadBtn")?.classList.toggle("hidden", !canManage);
  document.getElementById("cardAdjustBtn")?.classList.toggle("hidden", !canManage);
  document.getElementById("cardEditBtn")?.classList.toggle("hidden", !canEdit);
  document.getElementById("cardDeleteBtn")?.classList.toggle("hidden", !canManage);
}

function openCardFormModal(cardId = "") {
  document.getElementById("formCard").reset();
  document.getElementById("cardEditId").value = "";
  document.getElementById("cardCurrency").value = "AOA";
  document.getElementById("modalCardFormTitle").textContent = "Novo Cartão";
  document.getElementById("cardFormSubmitBtn").textContent = "Criar Cartão";
  document.getElementById("cardInitialBalanceRow").classList.remove("hidden");
  document.getElementById("cardInitialBalance").disabled = false;
  setCardScope("global");

  const prefillProject = document.getElementById("filterCardProject")?.value || "";
  if (prefillProject) {
    setCardScope("obra");
    document.getElementById("cardProjectId").value = prefillProject;
  }

  if (cardId) {
    const card = selectedCardCache || managedCards.find((c) => c.id === cardId);
    if (!card) return;
    document.getElementById("cardEditId").value = card.id;
    document.getElementById("modalCardFormTitle").textContent = "Editar Cartão";
    document.getElementById("cardFormSubmitBtn").textContent = "Guardar";
    document.getElementById("cardInitialBalanceRow").classList.add("hidden");
    document.getElementById("cardLabel").value = card.label || "";
    document.getElementById("cardType").value = card.type || "PREPAGO";
    document.getElementById("cardBank").value = card.bank || "";
    document.getElementById("cardLastDigits").value = card.lastDigits || "";
    document.getElementById("cardHolderName").value = card.holderName || "";
    document.getElementById("cardCurrency").value = card.currency || "AOA";
    if (card.projectId) {
      setCardScope("obra");
      document.getElementById("cardProjectId").value = card.projectId;
    } else {
      setCardScope("global");
    }
  }

  document.getElementById("modalCardForm").classList.add("open");
}

function closeCardFormModal() {
  document.getElementById("modalCardForm").classList.remove("open");
}

async function submitCardForm(e) {
  e.preventDefault();
  const cardId = document.getElementById("cardEditId").value;
  const scope = document.getElementById("cardScope").value;
  const projectId = scope === "obra" ? document.getElementById("cardProjectId").value || null : null;
  if (scope === "obra" && !projectId) {
    showToast("Seleccione a obra", "error");
    return;
  }
  const body = {
    label: document.getElementById("cardLabel").value.trim(),
    type: document.getElementById("cardType").value,
    bank: document.getElementById("cardBank").value.trim() || null,
    lastDigits: document.getElementById("cardLastDigits").value.trim() || null,
    holderName: document.getElementById("cardHolderName").value.trim() || null,
    currency: document.getElementById("cardCurrency").value.trim() || "AOA",
    projectId,
  };
  if (!cardId) {
    body.initialBalance = parseFloat(document.getElementById("cardInitialBalance").value) || 0;
  }
  try {
    if (cardId) {
      await apiRequest(`/petty-cash/cards/${cardId}`, { method: "PATCH", body });
      showToast("Cartão actualizado", "success");
    } else {
      await apiRequest("/petty-cash/cards", { method: "POST", body });
      showToast("Cartão criado", "success");
    }
    closeCardFormModal();
    await loadCards();
  } catch (err) {
    showToast(apiErrorMessage(err), "error");
  }
}

function openCardMovementModal(type = "CREDITO") {
  if (!selectedCardId) {
    showToast("Selecciona um cartão primeiro", "error");
    return;
  }
  document.getElementById("formCardMovement").reset();
  document.getElementById("cardMovementCardId").value = selectedCardId;
  document.getElementById("cardMovementType").value = type;
  document.getElementById("modalCardMovementTitle").textContent =
    type === "AJUSTE" ? "Ajuste de Saldo" : "Carregar Cartão";
  document.getElementById("modalCardMovement").classList.add("open");
}

function closeCardMovementModal() {
  document.getElementById("modalCardMovement").classList.remove("open");
}

async function submitCardMovement(e) {
  e.preventDefault();
  const cardId = document.getElementById("cardMovementCardId").value;
  const body = {
    type: document.getElementById("cardMovementType").value || "CREDITO",
    amount: parseFloat(document.getElementById("cardMovementAmount").value) || 0,
    description: document.getElementById("cardMovementDesc").value.trim(),
  };
  try {
    await apiRequest(`/petty-cash/cards/${cardId}/movements`, { method: "POST", body });
    showToast(body.type === "AJUSTE" ? "Ajuste registado" : "Cartão carregado", "success");
    closeCardMovementModal();
    await loadCards();
    if (selectedCardId) await selectCard(selectedCardId);
  } catch (err) {
    showToast(apiErrorMessage(err), "error");
  }
}

async function deleteCardHandler() {
  if (!selectedCardId) return;
  const card = selectedCardCache || managedCards.find((c) => c.id === selectedCardId);
  const label = card?.label || "este cartão";
  if (
    !confirm(
      `Eliminar o cartão "${label}"?\n\nSó é possível se o saldo for zero e não houver movimentações.`
    )
  ) {
    return;
  }
  try {
    await apiRequest(`/petty-cash/cards/${selectedCardId}`, { method: "DELETE" });
    showToast("Cartão eliminado", "success");
    closeCardDetailModal();
    await loadCards();
  } catch (err) {
    showToast(apiErrorMessage(err), "error");
  }
}

function bindCardEvents() {
  document.getElementById("btnNewCard")?.addEventListener("click", () => {
    if (!can("fundoManeio", "create")) {
      showToast("Sem permissão para criar cartões", "error");
      return;
    }
    openCardFormModal();
  });
  document.getElementById("btnCardScopeGlobal")?.addEventListener("click", () => setCardScope("global"));
  document.getElementById("btnCardScopeObra")?.addEventListener("click", () => setCardScope("obra"));
  document.getElementById("formCard")?.addEventListener("submit", submitCardForm);
  document.getElementById("btnCloseCardFormModal")?.addEventListener("click", closeCardFormModal);
  document.getElementById("btnCancelCardForm")?.addEventListener("click", closeCardFormModal);
  document.getElementById("cardLoadBtn")?.addEventListener("click", () => openCardMovementModal("CREDITO"));
  document.getElementById("cardAdjustBtn")?.addEventListener("click", () => openCardMovementModal("AJUSTE"));
  document.getElementById("cardEditBtn")?.addEventListener("click", () => openCardFormModal(selectedCardId));
  document.getElementById("cardDeleteBtn")?.addEventListener("click", deleteCardHandler);
  document.getElementById("formCardMovement")?.addEventListener("submit", submitCardMovement);
  document.getElementById("btnCloseCardMovementModal")?.addEventListener("click", closeCardMovementModal);
  document.getElementById("btnCancelCardMovement")?.addEventListener("click", closeCardMovementModal);
  document.getElementById("btnCloseCardDetailModal")?.addEventListener("click", closeCardDetailModal);

  ["filterCardScope", "filterCardProject"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      if (id === "filterCardProject") {
        const pid = document.getElementById("filterCardProject").value;
        if (pid) document.getElementById("filterCardScope").value = "obra";
        loadCards();
      } else {
        renderCardsGrid();
        updateCardsSectionMeta();
        if (selectedCardId && isCardDetailOpen()) {
          const stillVisible = getFilteredManagedCards().some((c) => c.id === selectedCardId);
          if (!stillVisible) closeCardDetailModal();
        }
      }
    });
  });

  ["modalCardForm", "modalCardMovement", "modalCardDetail"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) {
        if (id === "modalCardDetail") closeCardDetailModal();
        else e.currentTarget.classList.remove("open");
      }
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isCardDetailOpen()) closeCardDetailModal();
  });
}

function applySectionVisibility() {
  const hasCards = can("fundoManeio", "view");
  const hasExtras = can("pedidosExtras", "view");
  document.getElementById("sectionCards")?.classList.toggle("hidden", !hasCards);
  document.getElementById("sectionGcc")?.classList.toggle("hidden", !hasExtras);
  document.getElementById("sectionExtras")?.classList.toggle("hidden", !hasExtras);
  if (!can("fundoManeio", "create")) {
    document.getElementById("btnNewCard")?.classList.add("hidden");
  }
  updateCardActionButtons();
}

async function guardCentrosGeraisAccess() {
  const user = getSessionUser();
  if (!user) return false;
  await initPermissionLayer();
  if ((user.role || "").toLowerCase() === "admin") return true;
  if (can("pedidosExtras", "view") || can("fundoManeio", "view")) return true;
  return guardPageAccess("pedidosExtras", "view");
}

async function loadInitialData() {
  const projectsData = await apiRequest("/projects?pageSize=200");
  allProjects = projectsData.items || projectsData.projects || [];
  populateProjectSelects();

  const urlParams = new URLSearchParams(window.location.search);
  const urlProjectId = urlParams.get("projectId");
  if (urlProjectId) {
    document.getElementById("filterCardProject").value = urlProjectId;
    document.getElementById("filterCardScope").value = "obra";
    document.getElementById("filterProject").value = urlProjectId;
  }

  if (can("fundoManeio", "view")) {
    await loadCards();
  }
  if (can("pedidosExtras", "view")) {
    await loadGeneralCenters();
    await loadExtras();
  }
}

(async () => {
  const ok = await guardCentrosGeraisAccess();
  if (!ok) return;
  wireLogout();
  wireUsersNav();
  initMobileMenu();
  bindEvents();
  bindSectionToggles();
  applySectionVisibility();

  // Por defeito: cartões expandidos; restantes colapsados (se visíveis)
  if (can("fundoManeio", "view")) {
    setSectionCollapsed("panelGcc", true);
    setSectionCollapsed("panelExtras", true);
  } else {
    setSectionCollapsed("panelCards", true);
  }

  if (!can("pedidosExtras", "create")) {
    document.getElementById("btnNewExtra")?.classList.add("hidden");
    document.getElementById("btnNewGcc")?.classList.add("hidden");
  }

  try {
    await loadInitialData();
  } catch (err) {
    showToast("Erro ao carregar dados: " + err.message, "error");
  }
})();
