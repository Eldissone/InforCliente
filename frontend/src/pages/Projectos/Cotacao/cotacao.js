import { apiRequest, apiUpload, getAssetUrl } from "/services/api.js";
import { guardPageAccess, initPermissionLayer } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { openQuotePricingModal, submitQuoteForm } from "/shared/quotePricingModal.js";
import {
  formatSupplierFiscalSummary,
  computeSupplierFiscalBreakdown,
  formatFiscalAmount,
} from "/shared/supplierFiscal.js";
import { initExtraRequestModal, wireExtraRequestButton } from "/shared/extraRequestModal.js";
import {
  generatePurchaseOrderPdf,
  downloadPurchaseOrderPdf,
  uploadBundlePurchaseOrderPdf,
} from "/shared/quotePurchaseOrder.js";
import {
  bindNifLookup,
  normalizeNif,
  setNifLookupStatus,
} from "/shared/supplierNifLookup.js";

let currentProjectId = null;
let currentNeeds = [];
let currentSuppliers = [];
let allProjects = [];
let pendingBundleProforma = null;
const GERAL_SCOPE = "__geral__";

function isGeralScope() {
  return !currentProjectId;
}

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await guardPageAccess("obras", "view");
  if (!ok) return;

  await initPermissionLayer();
  wireLogout();
  wireUsersNav();
  await initExtraRequestModal({
    showToast,
    onSuccess: async () => {
      await loadNeeds();
    },
  });
  wireExtraRequestButton("btnNewExtra", () => {
    if (isGeralScope()) {
      return { type: "GERAL", lockType: true };
    }
    return {
      type: "OBRA",
      projectId: currentProjectId,
      lockType: true,
      lockProject: true,
    };
  });

  const urlParams = new URLSearchParams(window.location.search);
  const scope = urlParams.get("scope");
  currentProjectId =
    scope === "geral"
      ? null
      : urlParams.get("project") || localStorage.getItem("InfoCliente.currentProjectId");

  await loadProjects();

  initTabs();
  initEvents();

  const backBtn = document.getElementById("btnBackToBudget");
  if (isGeralScope()) {
    if (backBtn) backBtn.style.display = "none";
    document.getElementById("selectedProjName").textContent = "Pedidos Gerais";
  } else {
    if (backBtn) backBtn.href = `../centroCustos.html?project=${currentProjectId}`;
  }

  await loadSuppliers();
  await loadNeeds();
});

// ── Load Projects ──────────────────────────────────────────────────────────────
async function loadProjects() {
  try {
    const data = await apiRequest("/projects?pageSize=100&sort=updatedAt_desc");
    allProjects = data.items || [];
    const selector = document.getElementById("projectSelector");
    
    if (selector) {
      selector.innerHTML =
        `<option value="${GERAL_SCOPE}" ${isGeralScope() ? "selected" : ""}>Pedidos Gerais</option>` +
        allProjects
          .map(
            (p) =>
              `<option value="${p.id}" ${p.id === currentProjectId ? "selected" : ""}>${p.name}</option>`
          )
          .join("");
      
      selector.classList.remove("hidden");
      
      selector.addEventListener("change", (e) => {
        const id = e.target.value;
        if (id === GERAL_SCOPE || !id) {
          localStorage.removeItem("InfoCliente.currentProjectId");
          window.location.href = `?scope=geral`;
          return;
        }
        localStorage.setItem("InfoCliente.currentProjectId", id);
        window.location.href = `?project=${id}`;
      });
      
      if (currentProjectId) {
        const p = allProjects.find(x => x.id === currentProjectId);
        if (p) {
          document.getElementById("selectedProjName").textContent = p.name;
        }
      }
    }
  } catch (err) {
    console.error("Erro a carregar obras:", err);
  }
}

function initTabs() {
  const btns = document.querySelectorAll(".tab-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-tab");
      document.getElementById(`tab-${target}`).classList.add("active");
    });
  });
}

function initEvents() {
  document.getElementById("formSupplier").addEventListener("submit", submitSupplier);
  document.getElementById("btnAddSupplierBank")?.addEventListener("click", () => addSupplierBankRow());
  bindCotacaoSupplierNifLookup();
  document.getElementById("btnShowNewProduct")?.addEventListener("click", () => {
    const panel = document.getElementById("supplierProductFormPanel");
    const isOpen = panel && !panel.classList.contains("hidden");
    if (isOpen) {
      cancelProductEdit();
    } else {
      openNewSupplierProductForm();
    }
  });
  document.getElementById("formAddQuote").addEventListener("submit", (e) =>
    submitQuoteForm(e, {
      apiRequest,
      apiUpload,
      showToast,
      suppliers: currentSuppliers,
      openProformaViewer: window.openProformaViewer,
    })
  );

  const searchInput = document.getElementById("searchPendentes");
  const filterCc = document.getElementById("filterCentroCusto");
  if (searchInput) searchInput.addEventListener("input", renderNeeds);
  if (filterCc) filterCc.addEventListener("change", renderNeeds);
  document.getElementById("selectAllPendentes")?.addEventListener("change", (e) => {
    document.querySelectorAll(".need-batch-check").forEach((cb) => {
      cb.checked = e.target.checked;
    });
    syncBatchQuoteButton();
  });
  document.getElementById("btnBatchQuote")?.addEventListener("click", openBatchQuoteModal);
  document.getElementById("btnCloseBatchQuote")?.addEventListener("click", () => {
    document.getElementById("modalBatchQuote")?.classList.remove("open");
  });
  document.getElementById("btnSaveBatchQuote")?.addEventListener("click", () => submitBatchQuote(false));
  document.getElementById("btnSaveAndOrderBatch")?.addEventListener("click", () => submitBatchQuote(true));
  document.getElementById("batchQuoteSupplier")?.addEventListener("change", refreshBatchFiscalTotals);
  document.getElementById("btnViewSupplierOrders")?.addEventListener("click", openSupplierOrdersModal);
  document.getElementById("btnCloseSupplierOrders")?.addEventListener("click", () => {
    document.getElementById("modalSupplierOrders")?.classList.remove("open");
  });
  document.getElementById("btnCloseBundleProforma")?.addEventListener("click", () => {
    document.getElementById("modalBundleProforma")?.classList.remove("open");
    pendingBundleProforma = null;
  });
  document.getElementById("btnSubmitBundleProforma")?.addEventListener("click", submitBundleProforma);
}

// ==========================================
// PENDENTES / NEEDS
// ==========================================
async function loadNeeds() {
  try {
    const data = isGeralScope()
      ? await apiRequest("/quotes/geral/needs")
      : await apiRequest(`/quotes/project/${currentProjectId}/needs`);
    currentNeeds = data.items || [];

    const filterCc = document.getElementById("filterCentroCusto");
    if (filterCc) {
      if (isGeralScope()) {
        const cats = [];
        const seen = new Set();
        currentNeeds.forEach((n) => {
          const label =
            n.extraRequest?.costCategory?.name ||
            n.extraRequest?.generalCostCenter?.name ||
            "Geral";
          const key = String(label).toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          cats.push(label);
        });
        cats.sort((a, b) => a.localeCompare(b, "pt"));
        const currentVal = filterCc.value;
        filterCc.innerHTML =
          '<option value="">Todas as categorias</option>' +
          cats.map((c) => `<option value="${c}">${c}</option>`).join("");
        if (cats.includes(currentVal)) filterCc.value = currentVal;
      } else {
        try {
          const ccData = await apiRequest(`/cost-centers/project/${currentProjectId}`);
          const ccs = ccData.items || [];
          ccs.sort((a, b) => a.name.localeCompare(b.name));
          const currentVal = filterCc.value;
          filterCc.innerHTML = '<option value="">Todos Centros de Custo</option>' + 
            ccs.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
          if (ccs.some(c => c.id === currentVal)) {
            filterCc.value = currentVal;
          }
        } catch (ccErr) {
          console.error("Erro a carregar centros de custo:", ccErr);
        }
      }
    }

    renderNeeds();
  } catch (err) {
    console.error("Erro a carregar needs:", err);
    document.getElementById("pendentesTableBody").innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">Erro: ${err.message}</td></tr>`;
  }
}

function renderNeeds() {
  const tbody = document.getElementById("pendentesTableBody");
  
  const searchInput = document.getElementById("searchPendentes");
  const filterCc = document.getElementById("filterCentroCusto");
  
  const term = searchInput ? searchInput.value.toLowerCase() : "";
  const ccId = filterCc ? filterCc.value : "";

  let filtered = currentNeeds;
  
  if (term) {
    filtered = filtered.filter(n => n.description.toLowerCase().includes(term));
  }
  
  if (ccId) {
    filtered = filtered.filter((n) => {
      if (isGeralScope()) {
        const label =
          n.extraRequest?.costCategory?.name ||
          n.extraRequest?.generalCostCenter?.name ||
          "Geral";
        return label === ccId;
      }
      return String(n.costCenter?.id || n.costCenterId) === String(ccId);
    });
  }

  document.getElementById("pendentesCount").textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400 font-medium">Nenhum item em cotação.</td></tr>`;
    return;
  }

  const groups = groupNeedsForTable(filtered);
  tbody.innerHTML = groups.map((group) => {
    if (group.type === "bundle") return renderBundleGroup(group);
    return renderNeedRow(group.needs[0], { variant: "single" });
  }).join("");

  tbody.querySelectorAll(".need-batch-check").forEach((cb) => {
    cb.addEventListener("change", syncBatchQuoteButton);
  });
  syncBatchQuoteButton();
}

const NEED_STATUS_LABELS = {
  PENDING: "Pendente",
  IN_QUOTATION: "Em Cotação",
  ORDERED: "Encomenda",
  EM_ANALISE: "Em Análise",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
};

const NEED_STATUS_CLASSES = {
  PENDING: "bg-slate-100 text-slate-600",
  IN_QUOTATION: "bg-blue-100 text-blue-600",
  ORDERED: "bg-amber-100 text-amber-700",
  EM_ANALISE: "bg-sky-100 text-sky-700",
  APPROVED: "bg-[#2afc8d]/20 text-green-700",
  REJECTED: "bg-red-100 text-red-600",
};

function formatEfRef(num) {
  if (num == null || num === "") return "";
  return `EF${String(num).padStart(3, "0")}`;
}

function needBundleMeta(n) {
  const q = (n.quotes || []).find((x) => x.supplierOrder?.id || x.supplierOrderId || x.orderNumber != null);
  if (!q) return null;
  return {
    orderId: q.supplierOrder?.id || q.supplierOrderId || null,
    orderNumber: q.supplierOrder?.orderNumber ?? q.orderNumber ?? null,
    supplierName: q.supplier?.name || "Fornecedor",
    proformaUrl: q.supplierOrder?.proformaUrl || q.proformaUrl || null,
    quoteId: q.id,
  };
}

function needBundleKey(n) {
  const meta = needBundleMeta(n);
  if (!meta) return null;
  if (meta.orderId) return `so:${meta.orderId}`;
  if (meta.orderNumber != null) return `ef:${meta.orderNumber}`;
  return null;
}

function groupNeedsForTable(filtered) {
  const used = new Set();
  const groups = [];
  for (const n of filtered) {
    if (used.has(n.id)) continue;
    const key = needBundleKey(n);
    if (!key) {
      used.add(n.id);
      groups.push({ type: "single", needs: [n] });
      continue;
    }
    const siblings = filtered.filter((x) => needBundleKey(x) === key);
    siblings.forEach((x) => used.add(x.id));
    if (siblings.length >= 2) {
      groups.push({ type: "bundle", key, needs: siblings, meta: needBundleMeta(n) });
    } else {
      groups.push({ type: "single", needs: siblings });
    }
  }
  return groups;
}

function costCenterLabel(n) {
  return (
    n.costCenter?.name ||
    n.extraRequest?.costCategory?.name ||
    n.extraRequest?.generalCostCenter?.name ||
    (isGeralScope() ? "Geral" : "—")
  );
}

function statusBadge(status) {
  return `<span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${NEED_STATUS_CLASSES[status] || "bg-slate-100"}">${NEED_STATUS_LABELS[status] || status}</span>`;
}

function renderNeedRow(n, { variant = "single" } = {}) {
  const qty = n.quantity ? Number(n.quantity).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) : "—";
  const quotesCount = n.quotes ? n.quotes.length : 0;

  let bestQuotePriceStr = "";
  if (quotesCount > 0 && n.status === "IN_QUOTATION") {
    const minPrice = Math.min(...n.quotes.map((q) => Number(q.quotedPrice)));
    bestQuotePriceStr = `<div class="text-[10px] text-amber-600 font-bold mt-1">Melhor Preço: ${Number(minPrice).toLocaleString("pt-PT")}</div>`;
  }

  const isApproved = n.status === "APPROVED";
  const isOrdered = n.status === "ORDERED";
  const isPedidoQuote = Boolean(n.extraRequestId || n.purchaseOrderId);
  const sourceBadge = isPedidoQuote
    ? `<span class="ml-1 text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">Pedido</span>`
    : "";

  const meta = needBundleMeta(n);
  const efRef = meta?.orderNumber != null ? formatEfRef(meta.orderNumber) : "";
  const canBatch = ["IN_QUOTATION", "PENDING"].includes(n.status) && !efRef && variant === "single";
  const isChild = variant === "child";

  let actionBtn;
  if (isChild) {
    actionBtn = `<button type="button" onclick="openQuoteModal('${n.id}')"
      class="h-8 px-3 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-xs transition-all flex items-center justify-center gap-1 mx-auto">
      <span class="material-symbols-outlined text-[14px]">visibility</span>
      Ver
    </button>`;
  } else {
    actionBtn = `<button type="button" onclick="openQuoteModal('${n.id}')"
      class="h-8 px-3 rounded-lg ${isApproved ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700 hover:bg-amber-200"} font-bold text-xs transition-all flex items-center justify-center gap-1 mx-auto">
      <span class="material-symbols-outlined text-[14px]">${isApproved ? "visibility" : isOrdered ? "upload_file" : "price_change"}</span>
      ${isApproved ? "Ver Cotação" : isOrdered ? "Proforma" : "Precificar"}
    </button>`;
  }

  return `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors ${isChild ? "quote-bundle-child" : ""}">
        <td class="py-3 px-3">
          ${canBatch
            ? `<input type="checkbox" class="need-batch-check rounded border-slate-300 accent-emerald-600" value="${n.id}">`
            : ""}
        </td>
        <td class="py-3 px-4 text-xs text-slate-500">${new Date(n.createdAt).toLocaleDateString("pt-PT")}</td>
        <td class="py-3 px-4 text-xs font-bold text-slate-600">${costCenterLabel(n)}</td>
        <td class="py-3 px-4 ${isChild ? "pl-8" : ""}">
          <div class="font-medium text-slate-900">${isChild ? `<span class="text-indigo-400 mr-1">↳</span>` : ""}${n.description}${sourceBadge}</div>
          <div class="text-xs text-slate-400 mt-0.5">${quotesCount} cotações recebidas</div>
          ${bestQuotePriceStr}
          ${!isChild && efRef ? `<div class="text-[10px] font-black text-indigo-700 mt-1">${efRef} · ${meta?.supplierName || "Encomenda"}</div>` : ""}
        </td>
        <td class="py-3 px-4 text-center text-sm font-bold text-slate-700">${qty} ${n.unit || ""}</td>
        <td class="py-3 px-4 text-center">${statusBadge(n.status)}</td>
        <td class="py-3 px-4 text-center">${actionBtn}</td>
      </tr>
    `;
}

function renderBundleGroup(group) {
  const { needs, meta } = group;
  const first = needs[0];
  const ref = meta?.orderNumber != null ? formatEfRef(meta.orderNumber) : "Cotação conjunta";
  const supplier = meta?.supplierName || "Fornecedor";
  const allHaveProforma = needs.every((n) => {
    const m = needBundleMeta(n);
    return Boolean(m?.proformaUrl);
  });
  const statuses = [...new Set(needs.map((n) => n.status))];
  const groupStatus = statuses.length === 1
    ? statuses[0]
    : statuses.includes("ORDERED")
      ? "ORDERED"
      : statuses.includes("EM_ANALISE")
        ? "EM_ANALISE"
        : first.status;
  const leadId = first.id;
  const action = allHaveProforma
    ? `<button type="button" onclick="viewBundleProforma('${leadId}')"
        class="h-8 px-3 rounded-lg bg-emerald-100 text-emerald-800 hover:bg-emerald-200 font-bold text-xs transition-all flex items-center justify-center gap-1 mx-auto">
        <span class="material-symbols-outlined text-[14px]">description</span>
        Ver proforma
      </button>`
    : `<button type="button" onclick="openBundleProformaFromNeed('${leadId}')"
        class="h-8 px-3 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 font-bold text-xs transition-all flex items-center justify-center gap-1 mx-auto">
        <span class="material-symbols-outlined text-[14px]">upload_file</span>
        Proforma
      </button>`;

  const head = `
    <tr class="quote-bundle-head">
      <td class="py-3 px-3"></td>
      <td class="py-3 px-4 text-xs text-slate-500">${new Date(first.createdAt).toLocaleDateString("pt-PT")}</td>
      <td class="py-3 px-4 text-xs font-bold text-slate-600">${costCenterLabel(first)}</td>
      <td class="py-3 px-4">
        <div class="font-black text-indigo-900">${ref} · ${supplier}</div>
        <div class="text-[11px] text-indigo-700 font-semibold mt-0.5">${needs.length} itens cotados em conjunto — uma proforma para o pedido</div>
      </td>
      <td class="py-3 px-4 text-center text-xs font-bold text-indigo-700">${needs.length} itens</td>
      <td class="py-3 px-4 text-center">${statusBadge(groupStatus)}</td>
      <td class="py-3 px-4 text-center">${action}</td>
    </tr>`;

  const children = needs.map((n, idx) => {
    const row = renderNeedRow(n, { variant: "child" });
    return idx === needs.length - 1 ? row.replace('quote-bundle-child"', 'quote-bundle-child quote-bundle-last"') : row;
  }).join("");

  return head + children;
}

function bundlePayloadFromNeed(needId) {
  const need = currentNeeds.find((n) => n.id === needId);
  if (!need) return null;
  const key = needBundleKey(need);
  const siblings = key
    ? currentNeeds.filter((n) => needBundleKey(n) === key)
    : [need];
  const meta = needBundleMeta(need);
  return {
    orderId: meta?.orderId || null,
    orderNumber: meta?.orderNumber ?? null,
    supplierName: meta?.supplierName || "Fornecedor",
    quoteId: meta?.quoteId || null,
    proformaUrl: meta?.proformaUrl || null,
    items: siblings.map((n) => ({
      description: n.description,
      quantity: n.quantity,
      unit: n.unit,
    })),
  };
}

window.openBundleProformaFromNeed = function (needId) {
  const payload = bundlePayloadFromNeed(needId);
  if (!payload) return;
  openBundleProformaModal(payload);
};

window.viewBundleProforma = function (needId) {
  const payload = bundlePayloadFromNeed(needId);
  const url = payload?.proformaUrl ? getAssetUrl(payload.proformaUrl) : null;
  if (!url) {
    showToast("Este pedido ainda não tem proforma", "warning");
    return;
  }
  window.openProformaViewer(url);
};

function openBundleProformaModal(payload) {
  pendingBundleProforma = payload;
  const ref = payload.orderNumber != null ? formatEfRef(payload.orderNumber) : "Cotação conjunta";
  const title = document.getElementById("bundleProformaTitle");
  const subtitle = document.getElementById("bundleProformaSubtitle");
  const list = document.getElementById("bundleProformaItems");
  const file = document.getElementById("bundleProformaFile");
  if (title) title.textContent = `Proforma · ${ref}`;
  if (subtitle) subtitle.textContent = `${payload.supplierName} — ${payload.items.length} item(ns) no mesmo pedido`;
  if (list) {
    list.innerHTML = payload.items
      .map((item) => {
        const qty = item.quantity != null ? Number(item.quantity).toLocaleString("pt-PT") : "—";
        return `<li>${item.description} · ${qty} ${item.unit || ""}</li>`;
      })
      .join("");
  }
  if (file) file.value = "";
  document.getElementById("modalBundleProforma")?.classList.add("open");
}

async function submitBundleProforma() {
  if (!pendingBundleProforma) return;
  const file = document.getElementById("bundleProformaFile")?.files?.[0];
  if (!file) {
    showToast("Seleccione o ficheiro da proforma", "error");
    return;
  }
  const fd = new FormData();
  fd.append("proforma", file);
  const path = pendingBundleProforma.orderId
    ? `/quotes/supplier-orders/${pendingBundleProforma.orderId}/proforma`
    : pendingBundleProforma.quoteId
      ? `/quotes/${pendingBundleProforma.quoteId}/proforma`
      : null;
  if (!path) {
    showToast("Não foi possível identificar o pedido", "error");
    return;
  }
  try {
    const result = await apiUpload(path, fd, "POST");
    document.getElementById("modalBundleProforma")?.classList.remove("open");
    const count = result.itemCount || pendingBundleProforma.items.length;
    showToast(`Proforma aplicada aos ${count} itens do pedido`, "success");
    const url = result.order?.proformaUrl || result.quote?.proformaUrl;
    pendingBundleProforma = null;
    await loadNeeds();
    if (url) {
      setTimeout(() => {
        if (confirm("Proforma carregada. Deseja visualizar agora?")) {
          window.openProformaViewer(getAssetUrl(url));
        }
      }, 200);
    }
  } catch (err) {
    showToast(err?.data?.message || err.message || "Erro ao carregar a proforma", "error");
  }
}

function needOrderRef(n) {
  const meta = needBundleMeta(n);
  if (meta?.orderNumber == null) return "";
  return formatEfRef(meta.orderNumber);
}

function selectedBatchNeeds() {
  return [...document.querySelectorAll(".need-batch-check:checked")]
    .map((cb) => currentNeeds.find((n) => n.id === cb.value))
    .filter(Boolean);
}

function syncBatchQuoteButton() {
  const btn = document.getElementById("btnBatchQuote");
  const n = selectedBatchNeeds().length;
  if (btn) {
    btn.disabled = n < 2;
    btn.title = n < 2 ? "Seleccione pelo menos 2 itens" : `Precificar ${n} itens no mesmo fornecedor`;
  }
}

function openBatchQuoteModal() {
  const needs = selectedBatchNeeds();
  if (needs.length < 2) {
    showToast("Seleccione pelo menos dois itens", "warning");
    return;
  }
  const sel = document.getElementById("batchQuoteSupplier");
  if (sel) {
    sel.innerHTML =
      `<option value="">Seleccionar fornecedor...</option>` +
      currentSuppliers
        .filter((s) => s.active !== false)
        .map((s) => `<option value="${s.id}">${s.name}</option>`)
        .join("");
  }
  const body = document.getElementById("batchQuoteItemsBody");
  if (body) {
    body.innerHTML = needs
      .map((n) => {
        const qty = Number(n.quantity) || 1;
        return `<tr class="border-t border-slate-100" data-need-id="${n.id}">
          <td class="py-2 px-3 text-sm font-semibold text-slate-800">${n.description}</td>
          <td class="py-2 px-3 text-center">
            <input type="number" min="0" step="0.01" value="${qty}" data-qty
              class="w-20 h-9 px-2 border border-slate-200 rounded-lg text-center text-sm">
            <span class="text-[10px] text-slate-400 ml-1">${n.unit || ""}</span>
          </td>
          <td class="py-2 px-3 text-right">
            <input type="number" min="0" step="0.01" value="" data-price required
              class="w-28 h-9 px-2 border border-slate-200 rounded-lg text-right text-sm" placeholder="0,00">
          </td>
          <td class="py-2 px-3 text-right text-xs font-bold text-slate-700 tabular-nums" data-line-base>—</td>
        </tr>`;
      })
      .join("");
  }
  const notes = document.getElementById("batchQuoteNotes");
  if (notes) notes.value = "";
  const file = document.getElementById("batchQuoteProforma");
  if (file) file.value = "";
  document.getElementById("batchQuoteItemsBody")?.querySelectorAll("[data-qty], [data-price]").forEach((el) => {
    el.addEventListener("input", refreshBatchFiscalTotals);
  });
  document.getElementById("modalBatchQuote")?.classList.add("open");
  refreshBatchFiscalTotals();
}

function batchSelectedSupplier() {
  const id = document.getElementById("batchQuoteSupplier")?.value;
  return currentSuppliers.find((s) => s.id === id) || null;
}

function refreshBatchFiscalTotals() {
  const supplier = batchSelectedSupplier();
  const hint = document.getElementById("batchQuoteFiscalHint");
  if (hint) {
    hint.textContent = supplier
      ? `Impostos do fornecedor: ${formatSupplierFiscalSummary(supplier)}`
      : "Seleccione o fornecedor para ver IVA, retenção e desconto.";
  }

  let baseSum = 0;
  document.querySelectorAll("#batchQuoteItemsBody tr").forEach((tr) => {
    const qty = parseFloat(tr.querySelector("[data-qty]")?.value || "0") || 0;
    const price = parseFloat(tr.querySelector("[data-price]")?.value || "0") || 0;
    const base = qty * price;
    baseSum += base;
    const cell = tr.querySelector("[data-line-base]");
    if (cell) {
      cell.textContent = Number.isFinite(base)
        ? base.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "—";
    }
  });

  const box = document.getElementById("batchQuoteTotals");
  if (!box) return;
  if (!supplier || baseSum <= 0) {
    box.innerHTML = `<p class="text-xs text-slate-500 font-semibold">Preencha os preços para ver o total com impostos.</p>`;
    return;
  }

  const br = computeSupplierFiscalBreakdown(supplier, baseSum);
  const money = (n) => formatFiscalAmount(n, "AOA");
  const extra = (br.lines || [])
    .map((line) => {
      const sign = line.amount >= 0 ? "+" : "−";
      const color = line.amount >= 0 ? "text-emerald-700" : "text-red-600";
      return `<div class="flex justify-between"><span class="text-slate-500">${line.label}</span><span class="font-bold tabular-nums ${color}">${sign}${money(line.amount)}</span></div>`;
    })
    .join("");
  box.innerHTML = `
    <div class="flex justify-between text-slate-600"><span>Base (s/ impostos)</span><span class="font-bold tabular-nums">${money(br.base)}</span></div>
    ${extra || `<p class="text-[11px] text-slate-400">Este fornecedor não tem IVA, retenção ou desconto cadastrados.</p>`}
    <div class="flex justify-between pt-1.5 border-t border-slate-200"><span class="font-black text-slate-800 uppercase text-[11px] tracking-wide">Líquido a pagar</span><span class="font-black tabular-nums text-[#0f172a]">${money(br.net)}</span></div>
  `;
}

async function submitBatchQuote(placeOrder) {
  const supplierId = document.getElementById("batchQuoteSupplier")?.value;
  if (!supplierId) {
    showToast("Seleccione o fornecedor", "error");
    return;
  }
  const rows = [...document.querySelectorAll("#batchQuoteItemsBody tr")];
  const items = [];
  for (const tr of rows) {
    const needId = tr.dataset.needId;
    const quotedPrice = parseFloat(tr.querySelector("[data-price]")?.value || "");
    const quantity = parseFloat(tr.querySelector("[data-qty]")?.value || "");
    if (!Number.isFinite(quotedPrice) || quotedPrice < 0) {
      showToast("Indique o preço unitário de todos os itens", "error");
      return;
    }
    items.push({
      needId,
      quotedPrice,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    });
  }
  const fd = new FormData();
  fd.append(
    "payload",
    JSON.stringify({
      supplierId,
      projectId: isGeralScope() ? null : currentProjectId,
      notes: document.getElementById("batchQuoteNotes")?.value?.trim() || null,
      placeOrder,
      items,
    })
  );
  const file = document.getElementById("batchQuoteProforma")?.files?.[0];
  if (file) fd.append("proforma", file);

  try {
    const order = await apiUpload("/quotes/bundle", fd, "POST");
    document.getElementById("modalBatchQuote")?.classList.remove("open");
    if (placeOrder && order?.orderNumber != null) {
      const supplier = currentSuppliers.find((s) => s.id === supplierId) || order.supplier;
      const quotes = (order.quotes || []).map((q) => ({ quote: q, need: q.need }));
      const { doc, orderNo, documentId, issuedAt, issuedBy } = await generatePurchaseOrderPdf({
        quote: order.quotes?.[0],
        need: order.quotes?.[0]?.need,
        supplier,
        project: order.project,
        quotes,
      });
      downloadPurchaseOrderPdf(doc, orderNo);
      try {
        await uploadBundlePurchaseOrderPdf(order.id, doc, orderNo, { documentId, issuedAt, issuedBy });
      } catch (err) {
        console.warn("Upload da encomenda falhou:", err);
      }
      showToast(`Encomenda ${orderNo} gerada com ${items.length} itens`, "success");
    } else {
      showToast(`Cotação conjunta guardada (${items.length} itens)`, "success");
    }
    await loadNeeds();
  } catch (err) {
    showToast(err?.data?.message || err.message || "Erro ao guardar o lote", "error");
  }
}

async function openSupplierOrdersModal() {
  const list = document.getElementById("supplierOrdersList");
  if (!list) return;
  list.innerHTML = `<p class="text-sm text-slate-400">A carregar...</p>`;
  document.getElementById("modalSupplierOrders")?.classList.add("open");
  try {
    const qs = isGeralScope()
      ? "/quotes/supplier-orders?geral=1"
      : `/quotes/supplier-orders?projectId=${encodeURIComponent(currentProjectId)}`;
    const data = await apiRequest(qs);
    const items = data.items || [];
    if (!items.length) {
      list.innerHTML = `<p class="text-sm text-slate-400">Ainda não há encomendas agrupadas neste âmbito.</p>`;
      return;
    }
    list.innerHTML = items
      .map((o) => {
        const ref = o.orderNumber != null ? `EF${String(o.orderNumber).padStart(3, "0")}` : "Rascunho";
        const lines = (o.quotes || [])
          .map((q) => `<li>${q.need?.description || "Item"} · ${q.quantity || "—"} × ${Number(q.quotedPrice || 0).toLocaleString("pt-PT")}</li>`)
          .join("");
        const pdf = o.purchaseOrderUrl
          ? `<a href="${o.purchaseOrderUrl}" target="_blank" class="text-xs font-bold text-indigo-600 underline">PDF encomenda</a>`
          : "";
        const proformaUrl = o.proformaUrl || (o.quotes || []).find((q) => q.proformaUrl)?.proformaUrl;
        const proformaAction = proformaUrl
          ? `<button type="button" class="text-xs font-bold text-emerald-700 underline" data-view-order-proforma="${getAssetUrl(proformaUrl)}">Ver proforma</button>`
          : `<button type="button" class="h-8 px-3 rounded-lg bg-amber-100 text-amber-800 text-[11px] font-bold" data-order-proforma="${o.id}">Proforma</button>`;
        return `<div class="rounded-xl border border-slate-200 p-4">
          <div class="flex justify-between gap-3 items-start">
            <div>
              <p class="text-sm font-black text-slate-900">${ref} · ${o.supplier?.name || "Fornecedor"}</p>
              <p class="text-[11px] text-slate-500 mt-0.5">${o.status === "ORDERED" ? "Encomendado" : "Cotação conjunta"} · ${new Date(o.createdAt).toLocaleDateString("pt-PT")} · ${(o.quotes || []).length} item(ns)</p>
            </div>
            <div class="flex flex-col items-end gap-2">${pdf}${proformaAction}</div>
          </div>
          <ul class="mt-2 text-xs text-slate-700 list-disc pl-4 space-y-0.5">${lines}</ul>
        </div>`;
      })
      .join("");
    list.querySelectorAll("[data-view-order-proforma]").forEach((btn) => {
      btn.addEventListener("click", () => window.openProformaViewer(btn.dataset.viewOrderProforma));
    });
    list.querySelectorAll("[data-order-proforma]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const order = items.find((o) => o.id === btn.dataset.orderProforma);
        if (!order) return;
        document.getElementById("modalSupplierOrders")?.classList.remove("open");
        openBundleProformaModal({
          orderId: order.id,
          orderNumber: order.orderNumber,
          supplierName: order.supplier?.name || "Fornecedor",
          quoteId: order.quotes?.[0]?.id || null,
          proformaUrl: order.proformaUrl || null,
          items: (order.quotes || []).map((q) => ({
            description: q.need?.description || "Item",
            quantity: q.quantity,
            unit: q.need?.unit,
          })),
        });
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="text-sm text-red-500">${err.message}</p>`;
  }
}

// ==========================================
// FORNECEDORES
// ==========================================
async function loadSuppliers() {
  try {
    const data = await apiRequest(`/suppliers`);
    currentSuppliers = data.items || [];
    renderSuppliers();
  } catch (err) {
    console.error("Erro a carregar fornecedores:", err);
  }
}

function renderSuppliers() {
  const tbody = document.getElementById("suppliersTableBody");
  
  if (currentSuppliers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400 font-medium">Nenhum fornecedor registado.</td></tr>`;
    return;
  }

  const paymentTermLabels = {
    "PRONTO_PAGAMENTO": "Pronto Pagamento",
    "CREDITO": "Crédito"
  };

  tbody.innerHTML = currentSuppliers.map(s => `
    <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
      <td class="py-3 px-4 font-bold text-slate-800">${s.name}</td>
      <td class="py-3 px-4 text-sm text-slate-600">${s.nif || "—"}</td>
      <td class="py-3 px-4">
        <div class="text-sm font-medium text-slate-700">${s.contact || "—"}</div>
        <div class="text-xs text-slate-400">${s.email || ""}</div>
      </td>
      <td class="py-3 px-4 text-sm text-slate-600">${s.category || "—"}</td>
      <td class="py-3 px-4 text-center text-sm font-bold text-slate-600">${s.paymentTerm ? paymentTermLabels[s.paymentTerm] || s.paymentTerm : "—"}</td>
      <td class="py-3 px-4 text-center text-[11px] font-semibold text-slate-500">${formatSupplierFiscalSummary(s)}</td>
      <td class="py-3 px-4 text-center font-bold text-slate-700">${s._count?.products || 0}</td>
      <td class="py-3 px-4 text-center">
        <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${s.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
          ${s.active ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td class="py-3 px-4 text-center">
        <div class="flex justify-center gap-2">
          <button onclick="openSupplierProducts('${s.id}', '${s.name.replace(/'/g, '')}')" class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center hover:bg-blue-100 transition-all text-blue-500" title="Catálogo de Produtos">
            <span class="material-symbols-outlined text-base">inventory_2</span>
          </button>
          <button onclick="editSupplier('${s.id}')" data-supplier='${JSON.stringify(s).replace(/'/g, "&#39;")}' class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-all text-slate-500">
            <span class="material-symbols-outlined text-base">edit</span>
          </button>
          <button onclick="deleteSupplier('${s.id}')" class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-all text-slate-500">
            <span class="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `).join("");

  // Update Quote modal select if open
  updateQuoteSupplierSelect();
}

function renderSupplierBankAccounts(accounts = []) {
  const container = document.getElementById("supplierBankAccounts");
  if (!container) return;

  const rows = accounts.length
    ? accounts
    : [{ bankName: "", iban: "" }];

  container.innerHTML = rows.map((acc, index) => `
    <div class="supplier-bank-row grid grid-cols-[1fr_1.2fr_auto] gap-2 items-center" data-index="${index}">
      <input type="text" data-bank-name placeholder="Banco (ex: BAI)" value="${acc.bankName || ""}"
        class="h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/50">
      <input type="text" data-bank-iban placeholder="AO06..." value="${acc.iban || ""}"
        class="h-10 px-3 bg-white border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/50">
      <button type="button" data-remove-bank title="Remover conta"
        class="w-9 h-9 rounded-lg bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all flex items-center justify-center">
        <span class="material-symbols-outlined text-base">close</span>
      </button>
    </div>
  `).join("");

  container.querySelectorAll("[data-remove-bank]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".supplier-bank-row");
      const total = container.querySelectorAll(".supplier-bank-row").length;
      if (total <= 1) {
        row.querySelector("[data-bank-name]").value = "";
        row.querySelector("[data-bank-iban]").value = "";
        return;
      }
      row.remove();
    });
  });
}

function addSupplierBankRow() {
  const container = document.getElementById("supplierBankAccounts");
  if (!container) return;
  const current = collectSupplierBankAccounts();
  current.push({ bankName: "", iban: "" });
  renderSupplierBankAccounts(current);
  const lastIban = container.querySelector(".supplier-bank-row:last-child [data-bank-iban]");
  lastIban?.focus();
}

function collectSupplierBankAccounts() {
  const container = document.getElementById("supplierBankAccounts");
  if (!container) return [];
  return Array.from(container.querySelectorAll(".supplier-bank-row"))
    .map((row) => ({
      bankName: row.querySelector("[data-bank-name]")?.value.trim() || "",
      iban: row.querySelector("[data-bank-iban]")?.value.trim() || "",
    }))
    .filter((a) => a.bankName || a.iban)
    .map((a) => ({
      bankName: a.bankName || "Banco",
      iban: a.iban,
    }))
    .filter((a) => a.iban);
}

function parseOptionalPercentInput(id) {
  const raw = document.getElementById(id)?.value.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function applyAgtResultToSupplierForm(agt, existingSupplier = null) {
  if (existingSupplier) {
    document.getElementById("supplierId").value = existingSupplier.id || "";
    document.getElementById("modalSupplierTitle").textContent = "Editar Fornecedor";
  }
  const nameEl = document.getElementById("supplierName");
  const nifEl = document.getElementById("supplierNif");
  const vatEl = document.getElementById("supplierVatPercent");
  const statusEl = document.getElementById("supplierAgtStatus");
  if (agt?.nome && nameEl) nameEl.value = agt.nome;
  if (nifEl) {
    nifEl.dataset.validatedNif = normalizeNif(nifEl.value);
    nifEl.dataset.vatRegime = agt?.regimeIva || "";
    nifEl.dataset.agtStatus = agt?.estado || "";
    nifEl.dataset.agtType = agt?.tipo || "";
  }
  if (vatEl && agt?.vatPercent != null) vatEl.value = agt.vatPercent;
  if (statusEl) statusEl.value = [agt?.estado, agt?.regimeIva].filter(Boolean).join(" · ");
}

function bindCotacaoSupplierNifLookup() {
  bindNifLookup({
    nifInput: "supplierNif",
    button: "btnSupplierConsultarNif",
    statusEl: "supplierNifStatus",
    register: false,
    onResult: ({ ok, agt, result }) => {
      if (!ok) return;
      const existing = result?.existingSupplier || null;
      applyAgtResultToSupplierForm(agt, existing);
      if (existing) {
        showToast("Este NIF já está cadastrado. Foi usado o fornecedor existente.", "info");
      }
    },
  });
  document.getElementById("supplierNif")?.addEventListener("input", () => {
    const el = document.getElementById("supplierNif");
    if (el?.dataset?.validatedNif && el.dataset.validatedNif !== normalizeNif(el.value)) {
      delete el.dataset.validatedNif;
    }
  });
}

function openSupplierModal(supplier = null) {
  document.getElementById("modalSupplierTitle").textContent = supplier ? "Editar Fornecedor" : "Novo Fornecedor";
  document.getElementById("supplierId").value = supplier?.id || "";
  document.getElementById("supplierName").value = supplier?.name || "";
  document.getElementById("supplierNif").value = supplier?.nif || "";
  const nifEl = document.getElementById("supplierNif");
  if (nifEl) {
    if (supplier?.nif) nifEl.dataset.validatedNif = normalizeNif(supplier.nif);
    else delete nifEl.dataset.validatedNif;
    nifEl.dataset.vatRegime = supplier?.vatRegime || "";
    nifEl.dataset.agtStatus = supplier?.agtStatus || "";
    nifEl.dataset.agtType = supplier?.agtType || "";
  }
  document.getElementById("supplierPhone").value = supplier?.phone || "";
  document.getElementById("supplierEmail").value = supplier?.email || "";
  document.getElementById("supplierCategory").value = supplier?.category || "";
  document.getElementById("supplierType").value = supplier?.type || "MATERIAL";
  document.getElementById("supplierPaymentTerm").value = supplier?.paymentTerm || "";
  document.getElementById("supplierVatPercent").value = supplier?.vatPercent ?? "";
  document.getElementById("supplierWithholdingPercent").value = supplier?.withholdingPercent ?? "";
  document.getElementById("supplierDiscountPercent").value = supplier?.discountPercent ?? "";
  const agtStatusEl = document.getElementById("supplierAgtStatus");
  if (agtStatusEl) {
    agtStatusEl.value = [supplier?.agtStatus, supplier?.vatRegime].filter(Boolean).join(" · ");
  }
  setNifLookupStatus(document.getElementById("supplierNifStatus"), "");

  const accounts = supplier?.bankAccounts?.length
    ? supplier.bankAccounts.map((a) => ({ bankName: a.bankName, iban: a.iban }))
    : supplier?.iban
      ? [{ bankName: "Principal", iban: supplier.iban }]
      : [];
  renderSupplierBankAccounts(accounts);

  document.getElementById("modalSupplier").classList.add("open");
}

window.editSupplier = function(id) {
  const btn = document.querySelector(`[onclick="editSupplier('${id}')"]`);
  if (!btn) return;
  const supplier = JSON.parse(btn.getAttribute("data-supplier"));
  openSupplierModal(supplier);
}

window.deleteSupplier = async function(id) {
  if(!confirm("Apagar este fornecedor?")) return;
  try {
    await apiRequest(`/suppliers/${id}`, { method: "DELETE" });
    showToast("Fornecedor removido", "success");
    loadSuppliers();
  } catch(err) {
    showToast("Erro: " + err.message, "error");
  }
}

async function submitSupplier(e) {
  e.preventDefault();
  const id = document.getElementById("supplierId").value;
  const nif = normalizeNif(document.getElementById("supplierNif").value);
  const validated = document.getElementById("supplierNif")?.dataset?.validatedNif || "";
  if (!id && !nif) {
    showToast("Preencha o NIF e consulte a AGT para cadastrar o fornecedor.", "error");
    return;
  }
  if (nif && validated !== nif) {
    showToast("Consulte o NIF na AGT antes de gravar o fornecedor.", "error");
    return;
  }
  const nifEl = document.getElementById("supplierNif");
  const bankAccounts = collectSupplierBankAccounts();
  const body = {
    name: document.getElementById("supplierName").value.trim(),
    nif: nif || null,
    phone: document.getElementById("supplierPhone").value.trim() || null,
    email: document.getElementById("supplierEmail").value.trim() || null,
    category: document.getElementById("supplierCategory").value.trim() || null,
    type: document.getElementById("supplierType").value || "MATERIAL",
    paymentTerm: document.getElementById("supplierPaymentTerm").value || null,
    vatPercent: parseOptionalPercentInput("supplierVatPercent"),
    withholdingPercent: parseOptionalPercentInput("supplierWithholdingPercent"),
    discountPercent: parseOptionalPercentInput("supplierDiscountPercent"),
    vatRegime: nifEl?.dataset?.vatRegime || null,
    agtStatus: nifEl?.dataset?.agtStatus || null,
    agtType: nifEl?.dataset?.agtType || null,
    bankAccounts,
  };

  try {
    if (id) {
      await apiRequest(`/suppliers/${id}`, { method: "PATCH", body });
    } else {
      await apiRequest(`/suppliers`, { method: "POST", body });
    }
    showToast(id ? "Fornecedor actualizado" : "Fornecedor adicionado", "success");
    document.getElementById("modalSupplier").classList.remove("open");
    loadSuppliers();
  } catch(err) {
    if (err?.status === 409) {
      showToast("Este NIF já está cadastrado. Não foi criado um fornecedor duplicado.", "info");
      document.getElementById("modalSupplier").classList.remove("open");
      loadSuppliers();
      return;
    }
    showToast("Erro: " + err.message, "error");
  }
}

// ==========================================
// CATÁLOGO DE PRODUTOS DO FORNECEDOR
// ==========================================

let currentCatalogSupplierId = null;
let currentCatalogProducts = [];

function setSupplierProductFormVisible(visible) {
  const panel = document.getElementById("supplierProductFormPanel");
  const btn = document.getElementById("btnShowNewProduct");
  if (panel) panel.classList.toggle("hidden", !visible);
  if (btn) {
    btn.innerHTML = visible
      ? `<span class="material-symbols-outlined text-base">close</span> Cancelar`
      : `<span class="material-symbols-outlined text-base">add</span> Novo Produto`;
    btn.classList.toggle("bg-slate-200", visible);
    btn.classList.toggle("text-slate-700", visible);
    btn.classList.toggle("hover:bg-slate-300", visible);
    btn.classList.toggle("bg-[#0f172a]", !visible);
    btn.classList.toggle("text-white", !visible);
    btn.classList.toggle("hover:bg-slate-800", !visible);
  }
}

function openNewSupplierProductForm() {
  cancelProductEdit(false);
  setSupplierProductFormVisible(true);
  document.getElementById("productName")?.focus();
}

window.openSupplierProducts = async function(supplierId, supplierName) {
  currentCatalogSupplierId = supplierId;
  document.getElementById("modalProductsSupplierName").textContent = supplierName;
  document.getElementById("supplierProductSupplierId").value = supplierId;
  cancelProductEdit(false);
  setSupplierProductFormVisible(false);
  document.getElementById("modalSupplierProducts").classList.add("open");
  await loadSupplierProducts();
};

async function loadSupplierProducts() {
  if (!currentCatalogSupplierId) return;
  const tbody = document.getElementById("supplierProductsTableBody");
  tbody.innerHTML = `<tr><td colspan="5"><div class="spinner mx-auto my-4"></div></td></tr>`;
  try {
    const data = await apiRequest(`/suppliers/${currentCatalogSupplierId}/products`);
    currentCatalogProducts = data.items || [];
    renderSupplierProducts();
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">${err.message}</td></tr>`;
  }
}

function renderSupplierProducts() {
  const tbody = document.getElementById("supplierProductsTableBody");
  const countEl = document.getElementById("supplierProductsCount");
  if (countEl) countEl.textContent = currentCatalogProducts.length + " produto" + (currentCatalogProducts.length !== 1 ? "s" : "");

  const fmtPct = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? `${n.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}%` : "—";
  };

  if (currentCatalogProducts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-slate-400 font-medium">Nenhum produto registado. Clique em <strong>Novo Produto</strong> para adicionar.</td></tr>`;
    return;
  }

  const fmt = (v, cur = "AOA") => Number(v).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) + " " + cur;
  const fmtDate = d => d ? new Date(d).toLocaleDateString("pt-PT") : "—";

  tbody.innerHTML = currentCatalogProducts.map(p => {
    const expired = p.validUntil && new Date(p.validUntil) < new Date();
    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
        <td class="py-3 px-5">
          <div class="font-bold text-slate-800 text-sm">${p.name}</div>
          ${p.description ? `<div class="text-xs text-slate-400 mt-0.5">${p.description}</div>` : ""}
        </td>
        <td class="py-3 px-5 text-center text-sm text-slate-500">${p.unit || "—"}</td>
        <td class="py-3 px-5 text-right font-bold text-slate-800">${fmt(p.price, p.currency)}</td>
        <td class="py-3 px-3 text-center text-xs text-slate-600">${fmtPct(p.vatPercent)}</td>
        <td class="py-3 px-3 text-center text-xs text-slate-600">${fmtPct(p.withholdingPercent)}</td>
        <td class="py-3 px-3 text-center text-xs text-slate-600">${fmtPct(p.discountPercent)}</td>
        <td class="py-3 px-5 text-center text-xs ${expired ? "text-red-500 font-bold" : "text-slate-400"}">${fmtDate(p.validUntil)}</td>
        <td class="py-3 px-5">
          <div class="flex justify-center gap-1.5">
            <button onclick="editSupplierProduct('${p.id}')" class="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-all text-slate-500" title="Editar">
              <span class="material-symbols-outlined text-[13px]">edit</span>
            </button>
            <button onclick="deleteSupplierProduct('${p.id}')" class="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-all text-slate-500" title="Apagar">
              <span class="material-symbols-outlined text-[13px]">delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

document.getElementById("formSupplierProduct").addEventListener("submit", async function(e) {
  e.preventDefault();
  const id = document.getElementById("supplierProductId").value;
  const supplierId = document.getElementById("supplierProductSupplierId").value;
  const body = {
    name: document.getElementById("productName").value.trim(),
    description: document.getElementById("productDescription").value.trim() || null,
    price: parseFloat(document.getElementById("productPrice").value),
    currency: document.getElementById("productCurrency").value,
    unit: document.getElementById("productUnit").value.trim() || null,
    validUntil: document.getElementById("productValidUntil").value
      ? new Date(document.getElementById("productValidUntil").value).toISOString()
      : null,
    vatPercent: parseOptionalPercentInput("productVatPercent"),
    withholdingPercent: parseOptionalPercentInput("productWithholdingPercent"),
    discountPercent: parseOptionalPercentInput("productDiscountPercent"),
  };

  try {
    if (id) {
      await apiRequest(`/suppliers/${supplierId}/products/${id}`, { method: "PATCH", body });
      showToast("Produto actualizado", "success");
    } else {
      await apiRequest(`/suppliers/${supplierId}/products`, { method: "POST", body });
      showToast("Produto adicionado ao catálogo", "success");
    }
    cancelProductEdit();
    await loadSupplierProducts();
    loadSuppliers(); // refresh o contador de produtos na tabela
  } catch(err) {
    showToast("Erro: " + err.message, "error");
  }
});

window.editSupplierProduct = function(productOrId) {
  const product = typeof productOrId === "string"
    ? currentCatalogProducts.find(p => p.id === productOrId)
    : productOrId;
  if (!product) return;
  document.getElementById("supplierProductId").value = product.id;
  document.getElementById("productName").value = product.name || "";
  document.getElementById("productDescription").value = product.description || "";
  document.getElementById("productPrice").value = product.price || "";
  document.getElementById("productCurrency").value = product.currency || "AOA";
  document.getElementById("productUnit").value = product.unit || "";
  document.getElementById("productValidUntil").value = product.validUntil
    ? product.validUntil.substring(0, 10)
    : "";
  document.getElementById("productVatPercent").value = product.vatPercent ?? "";
  document.getElementById("productWithholdingPercent").value = product.withholdingPercent ?? "";
  document.getElementById("productDiscountPercent").value = product.discountPercent ?? "";
  document.getElementById("supplierProductSubmitLabel").textContent = "Actualizar Produto";
  document.getElementById("supplierProductCancelEdit").style.display = "block";
  const titleEl = document.getElementById("formProductTitle");
  if (titleEl) titleEl.textContent = "Editar Produto";
  setSupplierProductFormVisible(true);
  document.getElementById("productName").focus();
};

window.deleteSupplierProduct = async function(id) {
  if (!confirm("Remover este produto do catálogo?")) return;
  try {
    await apiRequest(`/suppliers/${currentCatalogSupplierId}/products/${id}`, { method: "DELETE" });
    showToast("Produto removido", "success");
    await loadSupplierProducts();
    loadSuppliers();
  } catch(err) {
    showToast("Erro: " + err.message, "error");
  }
};

window.cancelProductEdit = function(hidePanel = true) {
  document.getElementById("formSupplierProduct").reset();
  document.getElementById("supplierProductId").value = "";
  document.getElementById("supplierProductSupplierId").value = currentCatalogSupplierId || "";
  document.getElementById("supplierProductSubmitLabel").textContent = "Guardar Produto";
  document.getElementById("supplierProductCancelEdit").style.display = "none";
  const titleEl = document.getElementById("formProductTitle");
  if (titleEl) titleEl.textContent = "Novo Produto";
  if (hidePanel) setSupplierProductFormVisible(false);
};

// ==========================================
// COTAÇÕES / PREÇOS
// ==========================================
function updateQuoteSupplierSelect() {
  const sel = document.getElementById("quoteSupplier");
  if (!sel) return;
  sel.innerHTML = `<option value="">Selecionar...</option>` +
    currentSuppliers.map(s => {
      let termStr = "";
      if (s.paymentTerm === "CREDITO") termStr = " (Crédito)";
      else if (s.paymentTerm === "PRONTO_PAGAMENTO") termStr = " (PP)";
      return `<option value="${s.id}">${s.name}${termStr}</option>`;
    }).join("");
}

async function openQuoteModal(needId) {
  const need = currentNeeds.find((n) => n.id === needId);
  if (!need) return;
  window.onQuoteApproved = async () => { await loadNeeds(); };
  window.showQuoteToast = showToast;
  await openQuotePricingModal({
    need,
    suppliers: currentSuppliers,
    apiRequest,
    openProformaViewer: window.openProformaViewer,
    showToast,
  });
}

window.openSupplierModal = openSupplierModal;
window.openQuoteModal = openQuoteModal;

function showToast(msg, type = "info") {
  const container = document.getElementById("toast");
  if (!container) return;
  
  const toast = document.createElement("div");
  toast.className = `px-4 py-3 rounded-xl font-bold text-sm text-white shadow-lg flex items-center gap-2 transform transition-all translate-y-full opacity-0 duration-300`;
  
  if (type === "success") {
    toast.classList.add("bg-emerald-500", "shadow-emerald-500/20");
    toast.innerHTML = `<span class="material-symbols-outlined text-lg">check_circle</span> ${msg}`;
  } else if (type === "error") {
    toast.classList.add("bg-red-500", "shadow-red-500/20");
    toast.innerHTML = `<span class="material-symbols-outlined text-lg">error</span> ${msg}`;
  } else {
    toast.classList.add("bg-[#0f172a]", "shadow-slate-900/20");
    toast.innerHTML = `<span class="material-symbols-outlined text-lg">info</span> ${msg}`;
  }

  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.remove("translate-y-full", "opacity-0");
    toast.classList.add("translate-y-0", "opacity-100");
  }, 10);

  setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-full", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

window.openProformaViewer = function(url) {
  const iframe = document.getElementById('sideViewerIframe');
  const loading = document.getElementById('sideViewerLoading');
  const downloadBtn = document.getElementById('sideViewerDownloadBtn');
  
  // Reset
  iframe.classList.add('hidden');
  loading.style.display = 'flex';
  iframe.src = url;
  if (downloadBtn) downloadBtn.href = url;

  // Open panel
  document.getElementById('sideViewerOverlay').classList.remove('opacity-0', 'pointer-events-none');
  document.getElementById('sideViewerPanel').style.transform = 'translateX(0)';
};

window.closeProformaViewer = function() {
  document.getElementById('sideViewerOverlay').classList.add('opacity-0', 'pointer-events-none');
  document.getElementById('sideViewerPanel').style.transform = 'translateX(100%)';
  setTimeout(() => {
    document.getElementById('sideViewerIframe').src = '';
  }, 300);
};
