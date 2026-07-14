import { apiRequest, apiUpload } from "/services/api.js";
import { guardPageAccess, initPermissionLayer, can } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu } from "/shared/ui.js";
import { formatCurrency, formatDateBR } from "/shared/format.js";

let generalCenters = [];
let allProjects = [];
let currentFunds = [];
let selectedGccFilter = "";

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
  FUNDO_MANEIO: "Fundo de Maneio",
  SOLICITACAO_TRANSFERENCIA: "Solicitação de Transferência",
};

function fundDisplayBalance(fund) {
  return fund?.currentBalance ?? fund?.balance ?? 0;
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
}

function extraReferenceLabel(it) {
  if (it.type === "GERAL") {
    return it.generalCostCenter?.name || "Centro geral";
  }
  if (it.project) {
    return `${it.project.name}${it.project.code ? ` (${it.project.code})` : ""}`;
  }
  return "—";
}

function renderExtraRow(it) {
  const sourceLabel =
    it.paymentSource === "FUNDO_MANEIO"
      ? `Fundo: ${it.fund?.name || "—"}`
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

  if (it.status === "PENDENTE" && canApprove) {
    actions.push(`<button data-action="approve" data-id="${it.id}" class="text-xs font-bold text-emerald-600 hover:underline">Aprovar</button>`);
    actions.push(`<button data-action="reject" data-id="${it.id}" class="text-xs font-bold text-red-600 hover:underline">Rejeitar</button>`);
  }
  if (it.status === "APROVADO") {
    actions.push(`<span class="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">Aguarda Financeiro</span>`);
  }
  if ((it.status === "PENDENTE" || it.status === "APROVADO") && canCreate) {
    actions.push(`<button data-action="cancel" data-id="${it.id}" class="text-xs font-bold text-slate-500 hover:underline">Cancelar</button>`);
  }
  if (canDelete && it.status !== "PAGO" && it.status !== "APROVADO") {
    actions.push(`<button data-action="delete" data-id="${it.id}" class="text-xs font-bold text-red-600 hover:underline">Eliminar</button>`);
  }

  return `<tr class="border-t border-slate-50 hover:bg-slate-50/50">
    <td class="px-5 py-3 text-xs text-slate-500">${formatDateBR(it.createdAt)}</td>
    <td class="px-5 py-3">${typeBadge}</td>
    <td class="px-5 py-3 text-xs font-semibold text-slate-700 max-w-[180px] truncate">${extraReferenceLabel(it)}</td>
    <td class="px-5 py-3 text-xs font-semibold text-slate-700 max-w-[200px] truncate">${it.description}</td>
    <td class="px-5 py-3 text-xs text-slate-500">${sourceLabel}</td>
    <td class="px-5 py-3 text-xs font-bold text-slate-900 text-right">${formatCurrency(it.amount, it.currency)}</td>
    <td class="px-5 py-3">${statusBadge}</td>
    <td class="px-5 py-3 text-center"><div class="flex items-center justify-center gap-2 flex-wrap">${actions.join("") || "—"}</div></td>
  </tr>`;
}

async function loadExtras() {
  const tbody = document.getElementById("extrasTableBody");
  tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12"><div class="spinner mx-auto"></div></td></tr>`;

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
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-slate-400 text-xs">Nenhum pedido extra encontrado</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(renderExtraRow).join("");
    bindTableActions();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-red-500 text-xs font-bold">${err.message}</td></tr>`;
  }
}

function bindTableActions() {
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === "approve") {
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
  document.getElementById("extraGeneralCcId").required = isGeral;
  document.getElementById("extraProjectId").required = !isGeral;
  document.getElementById("modalExtraTitle").textContent = isGeral
    ? "Novo Pedido Extra Geral"
    : "Novo Pedido Extra da Obra";
  ensureFundsLoadedForExtra(type);
}

function toggleExtraPaymentFields() {
  const source = document.getElementById("extraSource").value;
  document.getElementById("extraFundRow").classList.toggle("hidden", source !== "FUNDO_MANEIO");
  document.getElementById("extraProformaRow").classList.toggle("hidden", source !== "SOLICITACAO_TRANSFERENCIA");
  const proformaInput = document.getElementById("extraProforma");
  if (proformaInput) {
    proformaInput.required = source === "SOLICITACAO_TRANSFERENCIA";
    if (source !== "SOLICITACAO_TRANSFERENCIA") proformaInput.value = "";
  }
}

function toggleExtraFundRow() {
  toggleExtraPaymentFields();
}

async function ensureFundsLoadedForExtra(type) {
  try {
    const projectId = document.getElementById("extraProjectId")?.value || "";
    const query =
      type === "OBRA" && projectId ? `?projectId=${projectId}` : type === "OBRA" ? "" : "";
    const data = await apiRequest(`/petty-cash/funds${query}`);
    currentFunds = data.items || [];
  } catch (err) {
    console.error("Erro ao carregar fundos:", err);
    currentFunds = [];
  }
  const fundSelect = document.getElementById("extraFundId");
  fundSelect.innerHTML =
    `<option value="">Selecionar...</option>` +
    currentFunds
      .map(
        (f) =>
          `<option value="${f.id}">${f.name} (${formatCurrency(fundDisplayBalance(f), f.currency)})</option>`
      )
      .join("");
  populateExtraCardOptions();
}

function populateExtraCardOptions() {
  const fundId = document.getElementById("extraFundId").value;
  const fund = currentFunds.find((f) => f.id === fundId);
  document.getElementById("extraCardId").innerHTML =
    `<option value="">— Sem cartão —</option>` +
    (fund?.cards || []).map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
}

async function openExtraModal(prefillType = "GERAL", prefillGccId = "") {
  document.getElementById("formExtra").reset();
  setExtraType(prefillType);
  if (prefillGccId) {
    document.getElementById("extraGeneralCcId").value = prefillGccId;
  }
  toggleExtraPaymentFields();
  document.getElementById("modalExtra").classList.add("open");
}

function closeExtraModal() {
  document.getElementById("modalExtra").classList.remove("open");
}

async function submitExtra(e) {
  e.preventDefault();
  const type = document.getElementById("extraType").value || "GERAL";
  const source = document.getElementById("extraSource").value;
  const body = {
    type,
    projectId: type === "OBRA" ? document.getElementById("extraProjectId").value || null : null,
    generalCostCenterId:
      type === "GERAL" ? document.getElementById("extraGeneralCcId").value || null : null,
    description: document.getElementById("extraDesc").value.trim(),
    amount: parseFloat(document.getElementById("extraAmount").value) || 0,
    paymentSource: source,
    fundId: source === "FUNDO_MANEIO" ? document.getElementById("extraFundId").value || null : null,
    cardId: source === "FUNDO_MANEIO" ? document.getElementById("extraCardId").value || null : null,
    notes: document.getElementById("extraNotes").value.trim() || null,
  };

  if (type === "GERAL" && !body.generalCostCenterId) {
    showToast("Seleccione o centro de custo geral", "error");
    return;
  }
  if (type === "OBRA" && !body.projectId) {
    showToast("Seleccione a obra", "error");
    return;
  }
  if (source === "SOLICITACAO_TRANSFERENCIA") {
    const proformaFile = document.getElementById("extraProforma")?.files?.[0];
    if (!proformaFile) {
      showToast("Anexe a proforma para transferência bancária", "error");
      return;
    }
  }

  try {
    const created = await apiRequest("/extra-requests", { method: "POST", body });
    if (source === "SOLICITACAO_TRANSFERENCIA") {
      const proformaFile = document.getElementById("extraProforma").files[0];
      const fd = new FormData();
      fd.append("proforma", proformaFile);
      await apiUpload(`/extra-requests/${created.id}/proforma`, fd);
    }
    showToast("Pedido Extra criado", "success");
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
  document.getElementById("extraSource")?.addEventListener("change", toggleExtraFundRow);
  document.getElementById("extraFundId")?.addEventListener("change", populateExtraCardOptions);
  document.getElementById("extraProjectId")?.addEventListener("change", () => {
    if (document.getElementById("extraType").value === "OBRA") {
      ensureFundsLoadedForExtra("OBRA");
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

async function loadInitialData() {
  const projectsData = await apiRequest("/projects?pageSize=200");
  allProjects = projectsData.items || projectsData.projects || [];
  populateProjectSelects();
  await loadGeneralCenters();
  await loadExtras();
}

(async () => {
  const ok = await guardPageAccess("pedidosExtras", "view");
  if (!ok) return;
  await initPermissionLayer();
  wireLogout();
  wireUsersNav();
  initMobileMenu();
  bindEvents();

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
