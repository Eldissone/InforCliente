import { apiRequest, apiUpload, getAssetUrl } from "/services/api.js";
import { guardPageAccess, initPermissionLayer, can } from "/shared/permissions.js";
import { getSessionUser } from "/services/auth.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu } from "/shared/ui.js";
import { formatCurrency, formatDateBR } from "/shared/format.js";
import {
  initExtraRequestModal,
  openExtraRequestModal,
  openExtraRequestModalForReview,
  wireExtraRequestButton,
  novoPedidoHref,
} from "/shared/extraRequestModal.js";

import { formatExtraCostLabel } from "/shared/costCategoryCascade.js";
import {
  bindNifLookup,
  normalizeNif,
  setNifLookupStatus,
} from "/shared/supplierNifLookup.js";
import { parseItemTax } from "/shared/purchaseOrderForm.js";

let allProjects = [];
let centrosMainTab = "compras";

function switchCentrosMainTab(tab) {
  // Só existe painel para as abas presentes no HTML; evita esconder tudo.
  if (!document.getElementById(`centrosPanel${tab.charAt(0).toUpperCase()}${tab.slice(1)}`)) {
    tab = "compras";
  }
  centrosMainTab = tab;
  document.querySelectorAll("[data-centros-tab]").forEach((btn) => {
    const active = btn.dataset.centrosTab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.getElementById("centrosPanelExtras")?.classList.toggle("hidden", tab !== "extras");
  document.getElementById("centrosPanelCompras")?.classList.toggle("hidden", tab !== "compras");

  if (tab === "compras") {
    loadCCDashboard();
  }

  try {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url);
  } catch {
    /* ignore */
  }
}

function bindCentrosMainTabs() {
  document.querySelectorAll("[data-centros-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchCentrosMainTab(btn.dataset.centrosTab));
  });

  // Sidebar CC toggle (ocultar/expandir)
  document.getElementById("btnToggleCCSidebar")?.addEventListener("click", () => {
    const sidebar = document.getElementById("ccSidebar");
    const btn = document.getElementById("btnToggleCCSidebar");
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.toggle("collapsed");
    const icon = btn.querySelector(".material-symbols-outlined");
    if (icon) icon.textContent = isCollapsed ? "menu" : "menu_open";
    btn.setAttribute("aria-expanded", String(!isCollapsed));
    try { localStorage.setItem("ccSidebarCollapsed", isCollapsed ? "1" : "0"); } catch { }
  });

  // Restore sidebar state from localStorage
  try {
    const saved = localStorage.getItem("ccSidebarCollapsed");
    if (saved === "1") {
      const sidebar = document.getElementById("ccSidebar");
      const btn = document.getElementById("btnToggleCCSidebar");
      if (sidebar) sidebar.classList.add("collapsed");
      const icon = btn?.querySelector(".material-symbols-outlined");
      if (icon) icon.textContent = "menu";
      btn?.setAttribute("aria-expanded", "false");
    }
  } catch { }
}

function applyCentrosMainTabVisibility() {
  // Assumindo permissão geral de compras ou admin (usando view genérico para testes/demonstração)
  const hasCompras = true; // Todo: usar uma permissão dedicada "centroCompras" quando existir

  document.getElementById("centrosTabBtnCompras")?.classList.toggle("hidden", !hasCompras);

  const validTabs = [];
  if (hasCompras) validTabs.push("compras");

  const urlTab = new URLSearchParams(window.location.search).get("tab");
  const initial = validTabs.includes(urlTab) ? urlTab : validTabs[0] || "compras";
  switchCentrosMainTab(initial);
}

let selectedCostCategoryFilter = "";
let extrasCache = [];
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

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
  TRANSFERENCIA_INTERNA_CARTAO: "Transferência interna (carregar cartão)",
};

function showToast(msg, type = "info") {
  let container = document.getElementById("toast");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast";
    document.body.appendChild(container);
  }
  if (container.parentElement !== document.body) {
    document.body.appendChild(container);
  }
  container.style.zIndex = "10000";
  const colors = {
    success: "bg-emerald-600 text-white",
    error: "bg-red-600 text-white",
    info: "bg-slate-800 text-white",
  };
  const icons = { success: "check_circle", error: "error", info: "info" };
  const el = document.createElement("div");
  el.className = `pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl text-sm font-bold ${colors[type]}`;
  el.style.position = "relative";
  el.style.zIndex = "10001";
  el.innerHTML = `<span class="material-symbols-outlined text-base">${icons[type]}</span>${msg}`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
  }, 3500);
}


function populateProjectSelects() {
  const opts = allProjects
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}${p.code ? ` (${escapeHtml(p.code)})` : ""}</option>`)
    .join("");
  const extraProjectEl = document.getElementById("extraProjectId");
  if (extraProjectEl) extraProjectEl.innerHTML = `<option value="">Selecionar obra...</option>${opts}`;

  const filterProjectEl = document.getElementById("filterProject");
  if (filterProjectEl) filterProjectEl.innerHTML = `<option value="">Todas as obras</option>${opts}`;
}

function escapeAttr(value) {
  return String(value || "").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

function iconMarkup(icon) {
  return `<span class="material-symbols-outlined text-sm" aria-hidden="true">${icon}</span>`;
}

function renderIconBtn(icon, title, variant = "slate", { attrs = "", disabled = false } = {}) {
  const disabledAttr = disabled ? "disabled" : "";
  const mutedClass = disabled ? " fin-icon-btn--muted" : "";
  return `
    <button type="button" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}"
      class="fin-icon-btn fin-icon-btn--${variant}${mutedClass}" ${disabledAttr} ${attrs}>
      ${iconMarkup(icon)}
    </button>`;
}

function extraReferenceLabel(it) {
  const costLabel = formatExtraCostLabel(it);
  if (it.type === "GERAL") {
    return costLabel !== "—" ? costLabel : "Geral";
  }
  const obra = it.project
    ? `${it.project.name}${it.project.code ? ` (${it.project.code})` : ""}`
    : "";
  const cc = it.costCenter
    ? `${it.costCenter.code ? `${it.costCenter.code} — ` : ""}${it.costCenter.name}`
    : "";
  const costPart = costLabel !== "—" ? costLabel : "";
  if (obra && cc && costPart) return `${obra} · ${cc} · ${costPart}`;
  if (obra && cc) return `${obra} · ${cc}`;
  if (obra && costPart) return `${obra} · ${costPart}`;
  return obra || cc || costPart || "—";
}

function renderExtraRow(it) {
  const sourceLabel =
    it.paymentSource === "FUNDO_MANEIO"
      ? `Cartão: ${it.card?.label || it.fund?.name || "—"}`
      : it.paymentSource === "TRANSFERENCIA_INTERNA_CARTAO"
        ? `Carregar: ${it.card?.label || "—"}`
        : EXTRA_SOURCE_LABELS[it.paymentSource] || it.paymentSource;
  const statusBadge = `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${EXTRA_STATUS_STYLES[it.status] || ""}">${escapeHtml(EXTRA_STATUS_LABELS[it.status] || it.status)}</span>`;
  const typeBadge =
    it.type === "GERAL"
      ? `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-violet-100 text-violet-700">Geral</span>`
      : `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-sky-100 text-sky-700">Obra</span>`;

  const actions = [];
  const canApprove = can("pedidosExtras", "approve");
  const canCreate = can("pedidosExtras", "create");
  const canDelete = can("pedidosExtras", "delete");
  const canEdit = canCreate && (it.status === "PENDENTE" || it.status === "APROVADO" || it.status === "REJEITADO");

  if (canEdit) {
    actions.push(
      renderIconBtn("edit_square", "Editar pedido extra", "blue", {
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
    <td class="px-5 py-3 text-xs font-semibold text-slate-700 max-w-[180px] truncate">${escapeHtml(extraReferenceLabel(it))}</td>
    <td class="px-5 py-3 text-xs font-semibold text-slate-700 max-w-[200px] truncate">${escapeHtml(it.description)}${it.quantity != null && it.quantity !== ""
      ? ` <span class="text-slate-400 font-bold">× ${escapeHtml(String(it.quantity))}</span>`
      : ""
    }</td>
    <td class="px-5 py-3 text-xs text-slate-500">${escapeHtml(sourceLabel)}</td>
    <td class="px-5 py-3 text-xs font-bold text-slate-900 text-right">${formatCurrency(it.amount, it.currency)}</td>
    <td class="px-5 py-3">${statusBadge}</td>
    <td class="px-5 py-3 text-center">${actionsHtml}</td>
  </tr>`;
}

async function loadExtras() {
  const tbody = document.getElementById("extrasTableBody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="9" class="text-center py-12"><div class="spinner mx-auto"></div></td></tr>`;

  const type = document.getElementById("filterType")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";
  const costCategoryId = document.getElementById("filterCostCategory")?.value || "";
  const projectId = document.getElementById("filterProject")?.value || "";

  const params = new URLSearchParams({ pageSize: "100" });
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  if (costCategoryId) params.set("costCategoryId", costCategoryId);
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
        btn.blur();
        window.location.href = novoPedidoHref({ extraId: id });
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

function bindEvents() {
  wireExtraRequestButton("btnNewExtra", () => ({
    type: "GERAL",
    costCategoryId: selectedCostCategoryFilter || "",
  }));

  ["filterType", "filterStatus", "filterCostCategory", "filterProject"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      if (id === "filterCostCategory") {
        selectedCostCategoryFilter = document.getElementById("filterCostCategory").value;
      }
      loadExtras();
    });
  });
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

function applySectionVisibility() {
  const hasExtras = can("pedidosExtras", "view");
  document.getElementById("sectionGcc")?.classList.toggle("hidden", !hasExtras);
  document.getElementById("sectionExtras")?.classList.toggle("hidden", !hasExtras);
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
    const projectFilterEl = document.getElementById("filterProject");
    if (projectFilterEl) projectFilterEl.value = urlProjectId;
  }

  if (can("pedidosExtras", "view")) {
    await loadExtras();
  }
}

(async () => {
  const ok = await guardCentrosGeraisAccess();
  if (!ok) return;
  wireLogout();
  wireUsersNav();
  initMobileMenu();
  await initExtraRequestModal({
    showToast,
    onSuccess: () => {
      loadExtras();
      loadCCDashboard();
      loadCCPedidos();
      loadCCRequisicoes();
      if (typeof window.reloadFinanceiroPlan === "function") window.reloadFinanceiroPlan();
    },
    getEditItem: (id) => extrasCache.find((e) => e.id === id),
  });
  bindEvents();
  bindSectionToggles();
  bindCentrosMainTabs();
  applySectionVisibility();
  applyCentrosMainTabVisibility();
  initCentroCompras();

  if (can("pedidosExtras", "view")) {
    setSectionCollapsed("panelGcc", false);
    setSectionCollapsed("panelExtras", false);
  }

  if (!can("pedidosExtras", "create")) {
    document.getElementById("btnNewExtra")?.classList.add("hidden");
  }

  try {
    await loadInitialData();
  } catch (err) {
    showToast("Erro ao carregar dados: " + err.message, "error");
  }
})();

/* ==========================================================================
   MÓDULO CENTRO DE COMPRAS
   ========================================================================== */

let ccCache = {
  pedidos: [],
  requisicoes: [],
  pagamentos: [],
  dashboard: null,
  pedidosPage: 1,
  pedidosTotal: 0,
  suppliers: [],
  tools: [],
};

// Configuração do Upload (Supabase via Backend)
async function uploadCCFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  // Supondo rota de upload partilhada ou na própria requisição
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + localStorage.getItem("token")
    },
    body: formData
  });
  if (!res.ok) {
    const d = await res.json();
    throw new Error(d.error || "Erro no upload");
  }
  const data = await res.json();
  return data.url; // Retorna URL do supabase
}

function openCCModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("active");
  el.classList.add("open");
}

function closeCCModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("open", "active");
}

function switchCCSubTab(tab) {
  document.querySelectorAll(".cc-sub-tab").forEach((b) => {
    const active = b.dataset.ccTab === tab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".cc-panel").forEach((p) => p.classList.add("hidden"));
  const panelId = `ccPanel${tab.charAt(0).toUpperCase()}${tab.slice(1)}`;
  document.getElementById(panelId)?.classList.remove("hidden");

  if (tab === "dashboard") loadCCDashboard();
  if (tab === "pedidos") loadCCPedidos();
  if (tab === "requisicoes") loadCCRequisicoes();
  if (tab === "planoPagamentos") {
    if (typeof window.reloadFinanceiroPlan === "function") window.reloadFinanceiroPlan();
    else loadCCPagamentos();
  }
}

function initCentroCompras() {
  document.querySelectorAll(".cc-sub-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchCCSubTab(btn.dataset.ccTab));
  });

  document.getElementById("btnNovoPedido")?.addEventListener("click", () => {
    window.location.href = novoPedidoHref();
  });
  bindCCReqSupplierNifLookup();
  document.getElementById("ccPedidosTableBody")?.addEventListener("click", onCCListActionClick);
  document.getElementById("ccReqTableBody")?.addEventListener("click", onCCListActionClick);

  document.getElementById("btnCCVerTodos")?.addEventListener("click", () => switchCCSubTab("requisicoes"));

  document.getElementById("btnCloseReqDrawer")?.addEventListener("click", () => {
    document.getElementById("drawerRequisicao")?.classList.remove("open");
  });
  document.getElementById("formCCQuote")?.addEventListener("submit", submitCCQuote);
  document.getElementById("btnCCAlterarCotacao")?.addEventListener("click", () => {
    document.getElementById("ccReqQuoteFields")?.classList.remove("hidden");
    document.getElementById("ccReqQuoteSaveRow")?.classList.remove("hidden");
    const btn = document.getElementById("btnCCAlterarCotacao");
    if (btn) btn.classList.add("hidden");
  });

  document.getElementById("btnCCSubmitApproval")?.addEventListener("click", submitCCForApproval);
  document.getElementById("btnCCApprove")?.addEventListener("click", () => openCCAprovacaoModal("APROVAR"));
  document.getElementById("btnCCReject")?.addEventListener("click", () => openCCAprovacaoModal("REJEITAR"));
  document.getElementById("btnCCCreatePayment")?.addEventListener("click", openCCPlanoModal);

  document.getElementById("btnCancelAprov")?.addEventListener("click", () => closeCCModal("modalAprovacao"));
  document.getElementById("btnConfirmAprov")?.addEventListener("click", submitCCAprovacao);

  document.getElementById("btnClosePlano")?.addEventListener("click", () => closeCCModal("modalPlanoPagamento"));
  document.getElementById("btnCancelPlano")?.addEventListener("click", () => closeCCModal("modalPlanoPagamento"));
  document.getElementById("btnCCAddParcela")?.addEventListener("click", addCCParcelaRow);
  document.getElementById("ccPlanoTotal")?.addEventListener("input", redistributeCCParcelas);
  document.getElementById("formPlanoPagamento")?.addEventListener("submit", submitCCPlano);

  const bindFilter = (id, fn) => {
    document.getElementById(id)?.addEventListener("change", fn);
    document.getElementById(id)?.addEventListener("input", fn);
  };
  let pedidosSearchTimer = null;
  bindFilter("ccPedidosFilterStatus", () => { ccCache.pedidosPage = 1; loadCCPedidos(); });
  bindFilter("ccPedidosFilterPriority", () => { ccCache.pedidosPage = 1; loadCCPedidos(); });
  document.getElementById("ccPedidosSearch")?.addEventListener("input", () => {
    clearTimeout(pedidosSearchTimer);
    pedidosSearchTimer = setTimeout(() => { ccCache.pedidosPage = 1; loadCCPedidos(); }, 300);
  });
  let reqSearchTimer = null;
  bindFilter("ccReqFilterStatus", () => loadCCRequisicoes());
  document.getElementById("ccReqSearch")?.addEventListener("input", () => {
    clearTimeout(reqSearchTimer);
    reqSearchTimer = setTimeout(() => loadCCRequisicoes(), 300);
  });

  loadCCDashboard();
}

// ======================== API CALLS ========================

function ccApiError(err) {
  const e = err?.data?.error;
  if (e && typeof e === "object") {
    const fields = e.fieldErrors
      ? Object.entries(e.fieldErrors).flatMap(([k, msgs]) => (msgs || []).map((m) => `${k}: ${m}`))
      : [];
    const form = e.formErrors || [];
    const all = [...form, ...fields].filter(Boolean);
    if (all.length) return all.join(" · ");
  }
  if (typeof e === "string") {
    const map = {
      FORBIDDEN: "Sem permissão para esta acção",
      NOT_FOUND: "Pedido não encontrado",
      REQUISITION_REQUIRED: "Guarde a cotação antes de submeter para aprovação",
      ORDER_NOT_IN_REQUISITION_STATUS: "Este pedido já não está em requisição",
      CANNOT_SUBMIT_IN_CURRENT_STATUS: "Não é possível submeter neste estado",
      ORDER_NOT_PENDING_APPROVAL: "Pedido não está pendente de aprovação",
      ORDER_NOT_APPROVED: "Pedido ainda não está aprovado",
      CANNOT_EDIT_IN_CURRENT_STATUS: "Este pedido já não pode ser editado neste estado",
      FILE_REQUIRED: "Seleccione um ficheiro",
      UPLOAD_FAILED: "Falha no envio do ficheiro",
      PROFORMA_REQUIRED: "Anexe a proforma na cotação antes de submeter para aprovação",
    };
    return map[e] || e;
  }
  return err?.data?.message || err?.message || "Erro desconhecido";
}

function ccOrderNumber(r) {
  return r?.number || r?.requisitionNumber || "—";
}

function ccRequestedBy(r) {
  return r?.requestedByName || r?.requestedBy || "—";
}

function ccOrderValue(r) {
  const cotacaoVal = Number(r?.cotacao?.quotedValue);
  if (r?.cotacao?.quoted && Number.isFinite(cotacaoVal) && cotacaoVal > 0 && !r.cotacao.overridden) {
    return cotacaoVal;
  }
  return r?.requisition?.quotedValue ?? r?.totalValue ?? 0;
}

function ccItemGross(item) {
  const qty = Number(item?.quantity) || 0;
  const price = Number(item?.unitPrice) || 0;
  const base = qty && price ? qty * price : Number(item?.totalPrice) || 0;
  const { vat, discount } = parseItemTax(item?.notes);
  const liquido = base - (base * discount) / 100;
  return liquido + (liquido * vat) / 100;
}

function ccOrderTotalWithTax(r) {
  const items = r?.items || [];
  const fromItems = items.reduce((sum, item) => sum + ccItemGross(item), 0);
  if (fromItems > 0) return fromItems;
  if (r?.totalWithTax != null && r.totalWithTax !== "") return Number(r.totalWithTax) || 0;
  return Number(ccOrderValue(r)) || 0;
}

/** Valor inicial do campo "Valor Cotado": cotação da página Cotação, senão requisição, senão itens. */
function ccQuoteInputDefault(order) {
  const fromCotacao = Number(order?.cotacao?.quotedValue);
  if (order?.cotacao?.quoted && Number.isFinite(fromCotacao) && fromCotacao > 0 && !order.cotacao.overridden) {
    return String(Math.round(fromCotacao * 100) / 100);
  }
  const quoted = Number(order?.requisition?.quotedValue);
  const base = Number(order?.totalValue);
  const withTax = ccOrderTotalWithTax(order);
  const quotedLooksLikePedidoBase =
    Number.isFinite(quoted) &&
    quoted > 0 &&
    Number.isFinite(base) &&
    Math.abs(quoted - base) < 0.01 &&
    withTax > 0 &&
    Math.abs(quoted - withTax) >= 0.01;
  if (Number.isFinite(quoted) && quoted > 0 && !quotedLooksLikePedidoBase) {
    return quoted;
  }
  if (withTax > 0) return String(Math.round(withTax * 100) / 100);
  if (Number.isFinite(quoted) && quoted > 0) return quoted;
  if (Number.isFinite(base) && base > 0) return base;
  return "";
}

function ccSupplierName(r) {
  if (r?.cotacao?.quoted && r.cotacao.supplierName && !r.cotacao.overridden) {
    return r.cotacao.supplierName;
  }
  return r?.requisition?.supplierName || r?.supplier?.name || r?.supplierName || "—";
}

function ccItemName(i) {
  return i?.name || i?.description || "—";
}

function ccPriorityHtml(priority) {
  if (priority === "URGENTE") return '<span class="text-red-600 font-bold">Urgente</span>';
  if (priority === "ALTA") return '<span class="text-orange-500 font-bold">Alta</span>';
  return '<span class="text-slate-500">Normal</span>';
}

function ccPedidoPageHref(r) {
  const id = typeof r === "string" ? r : r?.id;
  const isExtra = typeof r === "object" && r?._isExtra;
  return isExtra ? novoPedidoHref({ extraId: id }) : novoPedidoHref({ id });
}

function ccOpenDetailsBtn(r, label, extraClass = "") {
  const id = typeof r === "string" ? r : r?.id;
  const isExtra = typeof r === "object" && r?._isExtra;
  return `<button type="button" onclick="openCCPedidoReview('${escapeAttr(id)}', ${isExtra ? "true" : "false"})" class="${extraClass}">${label}</button>`;
}

function ccCanApprovePedido(r) {
  if (r?._isExtra) {
    return can("pedidosExtras", "approve") && (r.extraStatus || r.status) === "PENDENTE";
  }
  return r?.status === "PENDENTE_APROVACAO" && can("pedidosExtras", "approve");
}

function ccCanEditPedido(r) {
  if (r?._isExtra) {
    const st = r.extraStatus || r.status;
    return can("pedidosExtras", "create") && st !== "PAGO" && st !== "CANCELADO" && st !== "CONCLUIDO";
  }
  return !["EM_PAGAMENTO", "CONCLUIDO", "CANCELADO"].includes(r?.status);
}

function ccCanDeletePedido(r) {
  if (r?._isExtra) {
    const st = r.extraStatus || r.status;
    return can("pedidosExtras", "delete") && st !== "PAGO" && st !== "APROVADO";
  }
  return !["EM_PAGAMENTO", "CONCLUIDO", "CANCELADO"].includes(r?.status);
}

function ccPedidoActionsHtml(r, { requisition = false } = {}) {
  const id = r.id;
  const extra = r._isExtra ? "1" : "0";
  const actions = [];
  actions.push(
    renderIconBtn("visibility", requisition ? "Ver requisição" : "Ver pedido", "slate", {
      attrs: `data-cc-action="view" data-id="${escapeAttr(id)}" data-extra="${extra}" data-req="${requisition ? "1" : "0"}"`,
    })
  );

  if (ccCanApprovePedido(r)) {
    actions.push(
      renderIconBtn("check_circle", "Aprovar / rejeitar", "emerald", {
        attrs: `data-cc-action="approve" data-id="${escapeAttr(id)}" data-extra="${extra}"`,
      })
    );
  }

  if (ccCanEditPedido(r)) {
    actions.push(
      renderIconBtn(
        "edit_square",
        requisition ? "Editar requisição" : "Editar pedido",
        "blue",
        {
          attrs: `data-cc-action="edit" 
                        data-id="${escapeAttr(id)}" 
                        data-extra="${extra}" 
                        data-req="${requisition ? "1" : "0"}"`
        }
      )
    );
  }
  
  if (ccCanDeletePedido(r)) {
    actions.push(
      renderIconBtn("delete", "Eliminar / cancelar", "red", {
        attrs: `data-cc-action="delete" data-id="${escapeAttr(id)}" data-extra="${extra}"`,
      })
    );
  }
  return `<div class="fin-actions justify-center">${actions.join("")}</div>`;
}

async function onCCListActionClick(e) {
  const btn = e.target.closest("[data-cc-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.ccAction;
  const isExtra = btn.dataset.extra === "1";
  if (!id || !action) return;

  if (action === "view" || action === "approve") {
    openCCPedidoReview(id, isExtra);
    return;
  }
  if (action === "edit") {
    btn.blur();
    window.location.href = isExtra ? novoPedidoHref({ extraId: id }) : novoPedidoHref({ id });
    return;
  }
  if (action === "delete") {
    if (!confirm(isExtra ? "Eliminar este pedido extra?" : "Cancelar este pedido de compra?")) return;
    try {
      if (isExtra) await apiRequest(`/extra-requests/${id}`, { method: "DELETE" });
      else await apiRequest(`/purchase-orders/${id}`, { method: "DELETE" });
      showToast(isExtra ? "Pedido extra eliminado" : "Pedido cancelado", "success");
      loadCCPedidos();
      loadCCRequisicoes();
      loadCCDashboard();
    } catch (err) {
      showToast(ccApiError(err), "error");
    }
  }
}

function mapExtraStatusToCC(extra) {
  if (extra.status === "PENDENTE") {
    return extra.requiresQuote ? "PENDENTE_REQUISICAO" : "PENDENTE_APROVACAO";
  }
  if (extra.status === "APROVADO") return "EM_PAGAMENTO";
  if (extra.status === "PAGO") return "CONCLUIDO";
  if (extra.status === "REJEITADO") return "NAO_APROVADO";
  if (extra.status === "CANCELADO") return "CANCELADO";
  return extra.status;
}

function mapExtraToCCPedido(extra) {
  const items = extra.items || [];
  const baseFromItems = items.reduce((sum, item) => {
    const qty = Number(item?.quantity) || 0;
    const price = Number(item?.unitPrice) || 0;
    const line = qty && price ? qty * price : Number(item?.totalPrice) || 0;
    return sum + line;
  }, 0);
  const withTaxFromItems = items.reduce((sum, item) => sum + ccItemGross(item), 0);
  const amount = Number(extra.amount) || 0;
  return {
    ...extra,
    _isExtra: true,
    number: `PE-${String(extra.id || "").slice(-6).toUpperCase()}`,
    requestedByName: extra.requestedBy,
    status: mapExtraStatusToCC(extra),
    extraStatus: extra.status,
    totalValue: baseFromItems > 0 ? baseFromItems : amount,
    totalWithTax: withTaxFromItems > 0 ? withTaxFromItems : amount,
    supplierName: extra.supplierName || extra.supplierRef?.name || extra.supplier?.name || null,
  };
}

function extraMatchesCCFilters(mapped, { status, priority, search }) {
  if (status && mapped.status !== status) return false;
  if (priority && mapped.priority !== priority) return false;
  const q = String(search || "").trim().toLowerCase();
  if (q) {
    const hay = [
      mapped.number,
      mapped.description,
      mapped.requestedByName,
      mapped.requestedBy,
      mapped.supplierName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

async function fetchCCExtraPedidos() {
  if (!can("pedidosExtras", "view")) return [];
  try {
    const res = await apiRequest("/extra-requests?pageSize=100");
    const items = res.items || [];
    extrasCache = items;
    return items.map(mapExtraToCCPedido);
  } catch {
    return [];
  }
}

window.openCCExtraPedido = function openCCExtraPedido(id) {
  window.location.href = novoPedidoHref({ extraId: id });
};

async function loadCCDashboard() {
  try {
    const [data, extraPedidos] = await Promise.all([
      apiRequest("/purchase-orders/dashboard"),
      fetchCCExtraPedidos(),
    ]);
    const stats = data.kpis || {};
    const recents = data.recentes || [];

    const extraPendentes = extraPedidos.filter((e) => e.extraStatus === "PENDENTE");
    const extraReq = extraPendentes.filter((e) => e.status === "PENDENTE_REQUISICAO");
    const extraAprov = extraPendentes.filter((e) => e.status === "PENDENTE_APROVACAO");
    const extraPag = extraPedidos.filter((e) => e.extraStatus === "APROVADO");
    const extraUrgentes = extraPendentes.filter((e) => e.priority === "URGENTE").length;

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setText("ccKpiPedidos", (stats.pedidosPendentes || 0) + extraPendentes.length);
    setText("ccKpiReq", (stats.requisicoesPendentes || 0) + extraReq.length);
    setText("ccKpiAprov", (stats.aprovacoesPendentes || 0) + extraAprov.length);
    setText("ccKpiPag", (stats.pagamentosPendentes || 0) + extraPag.length);
    setText("ccKpiAndamento", (stats.emAndamento || 0) + extraPendentes.length + extraPag.length);
    const extraComprometido = extraPag.reduce((sum, e) => sum + ccOrderTotalWithTax(e), 0);
    setText("ccKpiValor", formatCurrency((Number(stats.valorComprometido) || 0) + extraComprometido));

    const badge = document.getElementById("ccKpiBadgeUrgent");
    if (badge) {
      const urgentes = (stats.pedidosUrgentes || 0) + extraUrgentes;
      if (urgentes > 0) {
        badge.textContent = `${urgentes} Urgente(s)`;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }

    const tbody = document.getElementById("ccRecentTable");
    if (!tbody) return;

    const mergedRecents = [...recents, ...extraPedidos]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    if (!mergedRecents.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-slate-400 text-xs">Sem processos recentes.</td></tr>`;
      return;
    }

    tbody.innerHTML = mergedRecents.map((r) => `
            <tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                <td class="px-4 py-3 text-xs font-semibold text-slate-900">${escapeHtml(ccOrderNumber(r))}</td>
                <td class="px-4 py-3 text-xs text-slate-600 truncate max-w-[200px]">${escapeHtml(r.description || "—")}</td>
                <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(ccRequestedBy(r))}</td>
                <td class="px-4 py-3 text-xs font-bold text-slate-900 text-right">${formatCurrency(ccOrderTotalWithTax(r))}</td>
                <td class="px-4 py-3"><span class="${ccGetStatusClass(r.status)}">${ccFormatStatus(r.status)}</span></td>
                <td class="px-4 py-3 text-xs text-slate-500">${formatDateBR(r.createdAt)}</td>
                <td class="px-4 py-3 text-center">
                    ${ccOpenDetailsBtn(r, "Detalhes", "text-indigo-600 hover:text-indigo-800 text-xs font-bold underline")}
                </td>
            </tr>
        `).join("");
  } catch (err) {
    console.error(err);
    showToast("Erro ao carregar Dashboard de Compras: " + ccApiError(err), "error");
  }
}
window.loadCCDashboard = loadCCDashboard;

async function loadCCPedidos() {
  try {
    const page = ccCache.pedidosPage || 1;
    const pageSize = 20;
    const status = document.getElementById("ccPedidosFilterStatus")?.value || "";
    const priority = document.getElementById("ccPedidosFilterPriority")?.value || "";
    const search = document.getElementById("ccPedidosSearch")?.value?.trim().toLowerCase() || "";

    const poParams = new URLSearchParams({ page: "1", pageSize: "100" });
    if (status) poParams.set("status", status);
    if (priority) poParams.set("priority", priority);
    if (search) poParams.set("search", search);

    const [res, extraPedidos] = await Promise.all([
      apiRequest(`/purchase-orders?${poParams.toString()}`),
      fetchCCExtraPedidos(),
    ]);
    const poItems = res.items || [];
    const extrasFiltered = extraPedidos.filter((e) => extraMatchesCCFilters(e, { status, priority, search }));
    const combined = [...poItems, ...extrasFiltered]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = combined.length;
    const data = combined.slice((page - 1) * pageSize, page * pageSize);
    ccCache.pedidos = data;
    ccCache.pedidosTotal = total;
    renderCCPedidos(data);
    renderCCPedidosPagination(page, pageSize, total);
  } catch (err) {
    showToast("Erro ao carregar Pedidos: " + ccApiError(err), "error");
    const tbody = document.getElementById("ccPedidosTableBody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-red-500 text-xs">${escapeHtml(ccApiError(err))}</td></tr>`;
    }
  }
}

function renderCCPedidosPagination(page, pageSize, total) {
  const el = document.getElementById("ccPedidosPagination");
  if (!el) return;
  const pages = Math.max(1, Math.ceil((total || 0) / pageSize));
  const meta = document.getElementById("ccPedidosMeta");
  if (meta) {
    meta.textContent = total
      ? `${total} pedido${total === 1 ? "" : "s"}`
      : "Nenhum pedido encontrado";
  }
  if (!total) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
        <span>${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} de ${total}</span>
        <span class="flex gap-2">
            <button type="button" class="h-8 px-3 rounded-lg border border-slate-200 bg-white disabled:opacity-40" data-cc-page="prev" ${page <= 1 ? "disabled" : ""}>Anterior</button>
            <button type="button" class="h-8 px-3 rounded-lg border border-slate-200 bg-white disabled:opacity-40" data-cc-page="next" ${page >= pages ? "disabled" : ""}>Seguinte</button>
        </span>`;
  el.querySelector("[data-cc-page='prev']")?.addEventListener("click", () => {
    if (ccCache.pedidosPage > 1) {
      ccCache.pedidosPage -= 1;
      loadCCPedidos();
    }
  });
  el.querySelector("[data-cc-page='next']")?.addEventListener("click", () => {
    ccCache.pedidosPage += 1;
    loadCCPedidos();
  });
}

function renderCCPedidos(data) {
  const tbody = document.getElementById("ccPedidosTableBody");
  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-slate-400 text-xs">Nenhum pedido encontrado.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((r) => `
        <tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
            <td class="px-4 py-3 text-xs font-semibold text-slate-900">${escapeHtml(ccOrderNumber(r))}</td>
            <td class="px-4 py-3 text-xs text-slate-600 max-w-[200px] truncate">${escapeHtml(r.description || "—")}</td>
            <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(ccRequestedBy(r))}</td>
            <td class="px-4 py-3 text-xs text-slate-500 text-right">${formatCurrency(ccOrderValue(r))}</td>
            <td class="px-4 py-3 text-xs font-bold text-slate-900 text-right">${formatCurrency(ccOrderTotalWithTax(r))}</td>
            <td class="px-4 py-3 text-xs">${ccPriorityHtml(r.priority)}</td>
            <td class="px-4 py-3"><span class="${ccGetStatusClass(r.status)}">${ccFormatStatus(r.status)}</span></td>
            <td class="px-4 py-3 text-center">
                ${ccPedidoActionsHtml(r)}
            </td>
        </tr>
    `).join("");
}

async function loadCCRequisicoes() {
  try {
    const params = new URLSearchParams({ pageSize: "50" });
    const status = document.getElementById("ccReqFilterStatus")?.value || "";
    const search = document.getElementById("ccReqSearch")?.value?.trim().toLowerCase() || "";
    if (status) params.set("status", status);
    if (search) params.set("search", search);

    const [res, extraPedidos] = await Promise.all([
      apiRequest(`/purchase-orders?${params.toString()}`),
      fetchCCExtraPedidos(),
    ]);
    let data = res.items || [];
    if (!status) {
      data = data.filter((r) =>
        ["PENDENTE_REQUISICAO", "PENDENTE_APROVACAO", "NAO_APROVADO"].includes(r.status)
      );
    }
    const extrasFiltered = extraPedidos.filter((e) => {
      if (!extraMatchesCCFilters(e, { status, search })) return false;
      if (status) return true;
      return ["PENDENTE_REQUISICAO", "PENDENTE_APROVACAO", "NAO_APROVADO"].includes(e.status);
    });
    data = [...data, ...extrasFiltered]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    ccCache.requisicoes = data;
    const meta = document.getElementById("ccReqMeta");
    if (meta) {
      meta.textContent = data.length
        ? `${data.length} requisição${data.length === 1 ? "" : "ões"}`
        : "Nenhuma requisição encontrada";
    }
    renderCCRequisicoes(data);
  } catch (err) {
    showToast("Erro ao carregar Requisições: " + ccApiError(err), "error");
  }
}

function renderCCRequisicoes(data) {
  const tbody = document.getElementById("ccReqTableBody");
  if (!tbody) return;
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-slate-400 text-xs">Nenhuma requisição encontrada.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map((r) => `
        <tr class="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
            <td class="px-4 py-3 text-xs font-bold text-indigo-600">${escapeHtml(ccOrderNumber(r))}</td>
            <td class="px-4 py-3 text-xs text-slate-600 truncate max-w-[150px]">${escapeHtml(r.description || "—")}</td>
            <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(ccRequestedBy(r))}</td>
            <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(ccSupplierName(r))}</td>
            <td class="px-4 py-3 text-xs font-bold text-slate-900 text-right">${formatCurrency(ccOrderValue(r))}</td>
            <td class="px-4 py-3"><span class="${ccGetStatusClass(r.status)}">${ccFormatStatus(r.status)}</span></td>
            <td class="px-4 py-3 text-xs text-slate-500">${formatDateBR(r.createdAt)}</td>
            <td class="px-4 py-3 text-center">
                ${ccPedidoActionsHtml(r, { requisition: true })}
            </td>
        </tr>
    `).join("");
}

async function loadCCPagamentos() {
  try {
    const res = await apiRequest("/purchase-orders?status=EM_PAGAMENTO&pageSize=50");
    const data = res.items || [];
    ccCache.pagamentos = data;
    const tbody = document.getElementById("ccPagTableBody") || document.getElementById("planTableBody");
    if (!tbody) return;
    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-slate-400 text-xs">Nenhum pagamento pendente.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.map((r) => `
            <tr class="border-b border-slate-50 hover:bg-slate-50/50">
                <td class="px-4 py-3 text-xs font-bold text-emerald-600">${escapeHtml(ccOrderNumber(r))}</td>
                <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(r.description || "—")}</td>
                <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(ccSupplierName(r))}</td>
                <td class="px-4 py-3 text-xs font-black text-slate-900 text-right">${formatCurrency(ccOrderValue(r))}</td>
                <td class="px-4 py-3"><span class="${ccGetStatusClass(r.status)}">${ccFormatStatus(r.status)}</span></td>
                <td class="px-4 py-3 text-center">
                    ${ccOpenDetailsBtn(r, "Gerir Planos", "h-8 px-3 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100")}
                </td>
            </tr>
        `).join("");
  } catch (err) {
    showToast("Erro ao carregar Pagamentos: " + ccApiError(err), "error");
  }
}

async function ensureCCSuppliersLoaded() {
  if (ccCache.suppliers?.length) return ccCache.suppliers;
  const sups = await apiRequest("/suppliers?limit=500");
  ccCache.suppliers = Array.isArray(sups) ? sups : (sups?.items || sups?.data || []);
  return ccCache.suppliers;
}

function upsertCCReqSupplierOption(supplier) {
  const sel = document.getElementById("ccReqSupplierId");
  if (!sel || !supplier?.id) return;
  let opt = [...sel.options].find((o) => o.value === supplier.id);
  const label = (supplier.name || supplier.id) + (supplier.nif ? " (" + supplier.nif + ")" : "");
  if (!opt) {
    opt = document.createElement("option");
    opt.value = supplier.id;
    sel.appendChild(opt);
  }
  opt.textContent = label;
  sel.value = supplier.id;
}

function bindCCReqSupplierNifLookup() {
  bindNifLookup({
    nifInput: "ccReqSupplierNif",
    button: "btnCcReqConsultarNif",
    statusEl: "ccReqSupplierNifStatus",
    register: true,
    onResult: ({ ok, agt, supplier }) => {
      if (!ok) return;
      const nameEl = document.getElementById("ccReqFornecedor");
      if (supplier) {
        ccCache.suppliers = ccCache.suppliers || [];
        const idx = ccCache.suppliers.findIndex((s) => s.id === supplier.id);
        if (idx >= 0) ccCache.suppliers[idx] = supplier;
        else ccCache.suppliers.push(supplier);
        upsertCCReqSupplierOption(supplier);
        if (nameEl) nameEl.value = supplier.name || "";
        const nifEl = document.getElementById("ccReqSupplierNif");
        if (nifEl) {
          nifEl.value = supplier.nif || "";
          nifEl.dataset.validatedNif = normalizeNif(supplier.nif);
        }
        return;
      }
      if (agt?.nome && nameEl) nameEl.value = agt.nome;
    },
  });
}

// ======================== DRAWER REQUISIÇÃO E WORKFLOW ========================

function openCCPedidoReview(id, isExtra = false) {
  if (isExtra) {
    openExtraRequestModalForReview(id);
    return;
  }
  openCCReqDrawer(id);
}
window.openCCPedidoReview = openCCPedidoReview;

async function openCCReqDrawer(id) {
  const drawer = document.getElementById("drawerRequisicao");
  if (!drawer) return;
  drawer.classList.add("open");
  const titleEl = document.getElementById("ccReqDrawerTitle");
  if (titleEl) titleEl.textContent = "A carregar...";

  try {
    const order = await apiRequest(`/purchase-orders/${id}`);
    ccCache.currentOrder = order;
    if (titleEl) titleEl.textContent = ccOrderNumber(order);
    const sub = document.getElementById("ccReqDrawerSub");
    if (sub) sub.textContent = order.description || "";

    const setText = (elId, val) => {
      const el = document.getElementById(elId);
      if (el) el.textContent = val;
    };
    setText("ccReqStatusText", ccFormatStatus(order.status));
    setText("ccReqDetailSol", ccRequestedBy(order));
    setText("ccReqDetailPri", order.priority || "NORMAL");
    setText("ccReqDetailJust", order.justification || "Nenhuma justificação");

    const itemsEl = document.getElementById("ccReqDetailItems");
    if (itemsEl) {
      const items = order.items || [];
      itemsEl.innerHTML = items.length
        ? items.map((i) => `
                    <li class="flex justify-between items-center py-1 border-b border-slate-50 last:border-0">
                        <span>${escapeHtml(String(i.quantity))} ${escapeHtml(i.unit || "")} — ${escapeHtml(ccItemName(i))}</span>
                        <span class="font-bold text-slate-900">${formatCurrency(i.totalWithTax ?? ccItemGross(i))}</span>
                    </li>`).join("")
        : `<li class="text-xs text-slate-400">Sem itens</li>`;
    }

    const orderIdEl = document.getElementById("ccReqOrderId");
    if (orderIdEl) orderIdEl.value = order.id;

    const quoteForm = document.getElementById("ccReqQuoteSection");
    const actions = document.getElementById("ccReqFooterActions");
    actions?.querySelectorAll("button").forEach((b) => b.classList.add("hidden"));
    quoteForm?.classList.add("hidden");

    const forn = document.getElementById("ccReqFornecedor");
    const valor = document.getElementById("ccReqValorCotado");
    const nifEl = document.getElementById("ccReqSupplierNif");
    const reqSel = document.getElementById("ccReqSupplierId");
    try { await ensureCCSuppliersLoaded(); } catch { /* ignore */ }
    if (reqSel && reqSel.options.length <= 1) {
      (ccCache.suppliers || []).forEach((s) => upsertCCReqSupplierOption(s));
    }
    if (reqSel && !reqSel.dataset.ccWired) {
      reqSel.dataset.ccWired = "1";
      reqSel.addEventListener("change", () => {
        const v = reqSel.value;
        const cached = (ccCache.suppliers || []).find((s) => s.id === v);
        if (!cached) return;
        if (forn) forn.value = cached.name || "";
        if (nifEl) {
          nifEl.value = cached.nif || "";
          nifEl.dataset.validatedNif = normalizeNif(cached.nif);
        }
      });
    }
    const cotacao = order.cotacao || {};
    const fromCotacao = Boolean(cotacao.quoted && !cotacao.overridden);
    const supplierId = fromCotacao
      ? cotacao.supplierId || ""
      : order.requisition?.supplierId || order.supplierId || "";
    const supplierName = fromCotacao
      ? (cotacao.supplierName || "")
      : (ccSupplierName(order) === "—" ? "" : ccSupplierName(order));
    const supplierNif = fromCotacao
      ? (cotacao.supplierNif || "")
      : (order.supplier?.nif || order.requisition?.supplier?.nif || "");

    if (fromCotacao && cotacao.supplierId) {
      upsertCCReqSupplierOption({
        id: cotacao.supplierId,
        name: cotacao.supplierName,
        nif: cotacao.supplierNif,
      });
    }
    if (reqSel) reqSel.value = supplierId;
    if (forn) forn.value = supplierName;
    if (nifEl) {
      nifEl.value = supplierNif;
      if (nifEl.value) nifEl.dataset.validatedNif = normalizeNif(nifEl.value);
      else delete nifEl.dataset.validatedNif;
    }
    setNifLookupStatus(document.getElementById("ccReqSupplierNifStatus"), "");
    if (valor) valor.value = ccQuoteInputDefault(order);

    const banner = document.getElementById("ccReqCotacaoBanner");
    const bannerText = document.getElementById("ccReqCotacaoBannerText");
    const quoteFields = document.getElementById("ccReqQuoteFields");
    const quoteSave = document.getElementById("ccReqQuoteSaveRow");
    const alterarBtn = document.getElementById("btnCCAlterarCotacao");
    if (fromCotacao) {
      banner?.classList.remove("hidden");
      const fornLabel = cotacao.supplierName || "fornecedor seleccionado";
      const valLabel = formatCurrency(cotacao.quotedValue);
      if (bannerText) {
        bannerText.textContent = `Cotação importada de Cotação: ${fornLabel} · ${valLabel}. Pode submeter para aprovação ou alterar se quiser.`;
      }
      quoteFields?.classList.add("hidden");
      quoteSave?.classList.add("hidden");
      alterarBtn?.classList.remove("hidden");
    } else {
      banner?.classList.add("hidden");
      quoteFields?.classList.remove("hidden");
      quoteSave?.classList.remove("hidden");
      alterarBtn?.classList.add("hidden");
    }

    if (order.status === "PENDENTE_REQUISICAO") {
      quoteForm?.classList.remove("hidden");
      document.getElementById("btnCCSubmitApproval")?.classList.remove("hidden");
    } else if (order.status === "PENDENTE_APROVACAO") {
      document.getElementById("btnCCApprove")?.classList.remove("hidden");
      document.getElementById("btnCCReject")?.classList.remove("hidden");
    } else if (order.status === "APROVADO") {
      document.getElementById("btnCCCreatePayment")?.classList.remove("hidden");
    } else if (order.status === "NAO_APROVADO") {
      quoteForm?.classList.remove("hidden");
      document.getElementById("btnCCSubmitApproval")?.classList.remove("hidden");
    }

    const attachWrap = document.getElementById("ccReqAttachments");
    const reqAtts = order.requisition?.attachments || [];
    const cotacaoAtts = (cotacao.proformas || []).map((p) => ({
      url: p.url,
      fileName: p.fileName || "Proforma",
    }));
    const seenUrls = new Set();
    const atts = [...reqAtts, ...cotacaoAtts].filter((a) => {
      if (!a?.url || seenUrls.has(a.url)) return false;
      seenUrls.add(a.url);
      return true;
    });
    if (attachWrap) {
      attachWrap.innerHTML = atts.length
        ? atts.map((a) => `<a class="block text-xs text-indigo-600 underline truncate" href="${escapeHtml(getAssetUrl(a.url) || a.url)}" target="_blank" rel="noopener">${escapeHtml(a.fileName)}</a>`).join("")
        : `<p class="text-[11px] text-amber-600">Nenhuma proforma anexada.</p>`;
    }

    const timeline = document.getElementById("ccReqTimeline");
    if (timeline) {
      const history = [...(order.history || [])].reverse();
      timeline.innerHTML = history.length
        ? history.map((h, i) => {
          let c = i === 0 ? "active" : "";
          if (h.toStatus === "APROVADO") c = "success";
          if (h.toStatus === "NAO_APROVADO" || h.toStatus === "CANCELADO") c = "error";
          const label = h.toStatus ? ccFormatStatus(h.toStatus) : (h.action || "Evento");
          const who = h.userName || "Sistema";
          return `
                    <div class="cc-timeline-item ${c}">
                        <div class="cc-timeline-dot"></div>
                        <div class="cc-timeline-content">
                            <p class="text-xs font-bold text-slate-900">${escapeHtml(label)}</p>
                            <p class="text-[10px] text-slate-500">${formatDateBR(h.createdAt)} — ${escapeHtml(who)}</p>
                            ${h.notes ? `<p class="text-xs text-slate-600 mt-1 bg-slate-50 p-2 rounded">${escapeHtml(h.notes)}</p>` : ""}
                        </div>
                    </div>`;
        }).join("")
        : `<p class="text-xs text-slate-500">Sem histórico registado.</p>`;
    }
  } catch (err) {
    showToast("Erro ao carregar detalhes: " + ccApiError(err), "error");
    drawer.classList.remove("open");
  }
}
window.openCCReqDrawer = openCCReqDrawer;

async function submitCCQuote(e) {
  e.preventDefault();
  const id = document.getElementById("ccReqOrderId")?.value;
  if (!id) return;
  const fornecedor = document.getElementById("ccReqFornecedor")?.value?.trim() || "";
  const supplierId = document.getElementById("ccReqSupplierId")?.value || null;
  const nif = normalizeNif(document.getElementById("ccReqSupplierNif")?.value);
  const validated = document.getElementById("ccReqSupplierNif")?.dataset?.validatedNif || "";
  if (!supplierId && nif && validated !== nif) {
    showToast("Consulte o NIF na AGT antes de gravar a cotação.", "error");
    return;
  }
  if (!supplierId && !fornecedor) {
    showToast("Indique o fornecedor ou consulte o NIF para cadastrar.", "error");
    return;
  }
  const valRaw = document.getElementById("ccReqValorCotado")?.value;
  const val = valRaw === "" || valRaw == null ? null : parseFloat(valRaw);
  const fileInput = document.getElementById("ccReqFile");

  try {
    await apiRequest(`/purchase-orders/${id}/requisition`, {
      method: "POST",
      body: {
        supplierId: supplierId || null,
        supplierName: fornecedor || null,
        quotedValue: Number.isFinite(val) ? val : null,
      },
    });

    const file = fileInput?.files?.[0];
    if (file) {
      showToast("A anexar proforma...", "info");
      await apiUpload(`/purchase-orders/${id}/requisition/upload`, { file, fieldName: "file" });
    }

    showToast("Cotação guardada", "success");
    if (fileInput) fileInput.value = "";
    await openCCReqDrawer(id);
    loadCCRequisicoes();
    loadCCDashboard();
  } catch (err) {
    showToast(ccApiError(err), "error");
  }
}

async function submitCCForApproval() {
  const id = document.getElementById("ccReqOrderId")?.value;
  if (!id) return;
  const cached = ccCache.currentOrder;
  const hasProforma =
    (cached?.requisition?.attachments || []).length > 0 ||
    (cached?.cotacao?.proformas || []).length > 0;
  if (cached?.requiresQuote && !hasProforma) {
    showToast("Anexe a proforma na cotação antes de submeter para aprovação.", "error");
    return;
  }
  try {
    await apiRequest(`/purchase-orders/${id}/submit-for-approval`, { method: "POST" });
    showToast("Submetido para aprovação", "success");
    await openCCReqDrawer(id);
    loadCCDashboard();
    loadCCRequisicoes();
    loadCCPedidos();
  } catch (err) {
    showToast(ccApiError(err), "error");
  }
}

function openCCAprovacaoModal(decision) {
  const id = document.getElementById("ccReqOrderId")?.value;
  if (!id) return;
  document.getElementById("ccAprovOrderId").value = id;
  document.getElementById("ccAprovDecision").value = decision;
  document.getElementById("ccAprovObs").value = "";

  const title = document.getElementById("modalAprovacaoTitle");
  const btn = document.getElementById("btnConfirmAprov");
  if (decision === "APROVAR") {
    if (title) title.textContent = "Aprovar Requisição";
    if (btn) {
      btn.className = "h-10 px-5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700";
      btn.textContent = "Aprovar";
    }
  } else {
    if (title) title.textContent = "Rejeitar Requisição";
    if (btn) {
      btn.className = "h-10 px-5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700";
      btn.textContent = "Rejeitar";
    }
  }
  openCCModal("modalAprovacao");
}
window.openCCAprovacaoModal = openCCAprovacaoModal;

async function submitCCAprovacao() {
  const id = document.getElementById("ccAprovOrderId")?.value;
  const uiDecision = document.getElementById("ccAprovDecision")?.value;
  const observations = document.getElementById("ccAprovObs")?.value?.trim() || null;
  if (!id) return;
  const decision = uiDecision === "APROVAR" ? "APROVADO" : "NAO_APROVADO";
  try {
    await apiRequest(`/purchase-orders/${id}/approve`, {
      method: "POST",
      body: { decision, observations },
    });
    closeCCModal("modalAprovacao");
    showToast(decision === "APROVADO" ? "Pedido aprovado — disponível no plano de pagamentos" : "Requisição rejeitada", "success");
    await openCCReqDrawer(id);
    loadCCDashboard();
    loadCCRequisicoes();
    loadCCPedidos();
  } catch (err) {
    showToast(ccApiError(err), "error");
  }
}

function parseCCPlanoTotal() {
  const raw = String(document.getElementById("ccPlanoTotal")?.value || "").replace(",", ".");
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseCCParcelaAmount(raw) {
  const n = parseFloat(String(raw || "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function setCCParcelaAmount(input, cents) {
  if (!input) return;
  input.value = (Math.max(0, cents) / 100).toFixed(2);
}

function ccParcelaRows() {
  return Array.from(document.querySelectorAll("#ccParcelasContainer .cc-parcela-row"));
}

function ccParcelaValueInputs() {
  return ccParcelaRows().map((row) => row.querySelector(".cc-parc-val")).filter(Boolean);
}

function syncCCParcelaRemoveButtons() {
  const rows = ccParcelaRows();
  rows.forEach((row) => {
    const btn = row.querySelector(".cc-parc-del");
    if (!btn) return;
    const only = rows.length <= 1;
    btn.disabled = only;
    btn.classList.toggle("opacity-30", only);
    btn.classList.toggle("pointer-events-none", only);
  });
}

function splitCents(cents, count) {
  if (count <= 0) return [];
  const safe = Math.max(0, cents);
  const base = Math.floor(safe / count);
  let remainder = safe - base * count;
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

function redistributeCCParcelas() {
  const inputs = ccParcelaValueInputs();
  if (!inputs.length) return;
  const total = parseCCPlanoTotal();
  if (!total) {
    inputs.forEach((input) => { input.value = ""; });
    return;
  }
  splitCents(Math.round(total * 100), inputs.length).forEach((cents, i) => {
    setCCParcelaAmount(inputs[i], cents);
  });
}

function syncCCParcelasFromEdited(editedInput) {
  const inputs = ccParcelaValueInputs();
  if (!inputs.length || !editedInput) return;
  const totalCents = Math.round(parseCCPlanoTotal() * 100);
  if (!totalCents) return;

  const others = inputs.filter((el) => el !== editedInput);
  if (!others.length) {
    setCCParcelaAmount(editedInput, totalCents);
    return;
  }

  let editedCents = Math.round(parseCCParcelaAmount(editedInput.value) * 100);
  editedCents = Math.max(0, Math.min(editedCents, totalCents));
  setCCParcelaAmount(editedInput, editedCents);
  splitCents(totalCents - editedCents, others.length).forEach((cents, i) => {
    setCCParcelaAmount(others[i], cents);
  });
}

function openCCPlanoModal() {
  const id = document.getElementById("ccReqOrderId")?.value;
  if (!id) return;
  document.getElementById("ccPlanoOrderId").value = id;
  const cached = ccCache.currentOrder;
  const currentVal =
    document.getElementById("ccReqValorCotado")?.value ||
    cached?.requisition?.quotedValue ||
    cached?.totalValue ||
    "";
  const totalEl = document.getElementById("ccPlanoTotal");
  if (totalEl) totalEl.value = currentVal || "";
  const container = document.getElementById("ccParcelasContainer");
  if (container) container.innerHTML = "";
  addCCParcelaRow();
  openCCModal("modalPlanoPagamento");
}
window.openCCPlanoModal = openCCPlanoModal;

function addCCParcelaRow() {
  const container = document.getElementById("ccParcelasContainer");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "flex items-center gap-2 cc-parcela-row";
  div.innerHTML = `
        <input type="date" required class="cc-parc-date h-9 px-2 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none flex-1">
        <input type="number" step="0.01" required placeholder="Valor" class="cc-parc-val h-9 px-2 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none w-32">
        <button type="button" class="cc-parc-del w-8 h-9 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-sm">close</span>
        </button>
    `;
  const valInput = div.querySelector(".cc-parc-val");
  valInput?.addEventListener("change", () => syncCCParcelasFromEdited(valInput));
  div.querySelector(".cc-parc-del")?.addEventListener("click", () => {
    if (ccParcelaRows().length <= 1) return;
    div.remove();
    syncCCParcelaRemoveButtons();
    redistributeCCParcelas();
  });
  container.appendChild(div);
  syncCCParcelaRemoveButtons();
  redistributeCCParcelas();
}

async function submitCCPlano(e) {
  e.preventDefault();
  const id = document.getElementById("ccPlanoOrderId")?.value;
  const total = parseFloat(document.getElementById("ccPlanoTotal")?.value);
  if (!id || !Number.isFinite(total) || total <= 0) {
    showToast("Indique o valor total do plano", "error");
    return;
  }

  const parcelas = Array.from(document.querySelectorAll(".cc-parcela-row")).map((row, idx) => ({
    number: idx + 1,
    dueDate: row.querySelector(".cc-parc-date")?.value,
    amount: parseFloat(row.querySelector(".cc-parc-val")?.value),
  }));

  if (!parcelas.length || parcelas.some((p) => !p.dueDate || !Number.isFinite(p.amount) || p.amount <= 0)) {
    showToast("Preencha data e valor de todas as parcelas", "error");
    return;
  }

  const sum = parcelas.reduce((a, b) => a + b.amount, 0);
  if (Math.abs(sum - total) > 0.01) {
    showToast(`Soma das parcelas (${sum}) não bate com o total (${total})`, "error");
    return;
  }

  try {
    await apiRequest(`/purchase-orders/${id}/payment-plan`, {
      method: "POST",
      body: { totalValue: total, currency: "AOA", installments: parcelas },
    });
    closeCCModal("modalPlanoPagamento");
    showToast("Plano de pagamento criado", "success");
    await openCCReqDrawer(id);
    loadCCPagamentos();
    loadCCDashboard();
    loadCCPedidos();
  } catch (err) {
    showToast(ccApiError(err), "error");
  }
}

// Helpers
function ccFormatStatus(s) {
  const map = {
    'RASCUNHO': 'Rascunho',
    'PENDENTE_REQUISICAO': 'Aguard. Requisição',
    'PENDENTE_APROVACAO': 'Pendente Aprovação',
    'APROVADO': 'Aprovado',
    'NAO_APROVADO': 'Não Aprovado',
    'EM_PAGAMENTO': 'Em Pagamento',
    'CONCLUIDO': 'Concluído',
    'CANCELADO': 'Cancelado'
  };
  return map[s] || s;
}

function ccGetStatusClass(s) {
  const base = "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ";
  if (s === 'PENDENTE_REQUISICAO') return base + "bg-blue-50 text-blue-700";
  if (s === 'PENDENTE_APROVACAO') return base + "bg-amber-50 text-amber-700";
  if (s === 'APROVADO') return base + "bg-emerald-50 text-emerald-700";
  if (s === 'NAO_APROVADO' || s === 'CANCELADO') return base + "bg-red-50 text-red-700";
  if (s === 'EM_PAGAMENTO') return base + "bg-indigo-50 text-indigo-700";
  if (s === 'CONCLUIDO') return base + "bg-slate-100 text-slate-700";
  return base + "bg-slate-100 text-slate-600";
}

