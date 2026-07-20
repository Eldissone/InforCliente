import { apiRequest, apiUpload, getAssetUrl } from "/services/api.js";
import { guardPageAccess, initPermissionLayer } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { openQuotePricingModal, submitQuoteForm } from "/shared/quotePricingModal.js";
import { formatSupplierFiscalSummary } from "/shared/supplierFiscal.js";

let currentProjectId = null;
let currentNeeds = [];
let currentSuppliers = [];
let allProjects = [];

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await guardPageAccess("obras", "view");
  if (!ok) return;

  await initPermissionLayer();
  wireLogout();
  wireUsersNav();

  const urlParams = new URLSearchParams(window.location.search);
  currentProjectId = urlParams.get("project") || localStorage.getItem("InfoCliente.currentProjectId");

  await loadProjects();

  if (!currentProjectId) {
    // Se não tiver obra, mostra apenas a gestão de fornecedores
    const pendentesBtn = document.querySelector('[data-tab="pendentes"]');
    if(pendentesBtn) pendentesBtn.style.display = "none";
    
    document.getElementById("btnBackToBudget").style.display = "none";
    document.getElementById("selectedProjName").textContent = "Fornecedores";
    
    initTabs();
    initEvents();
    const forTab = document.querySelector('[data-tab="fornecedores"]');
    if(forTab) forTab.click();
    
    await loadSuppliers();
    return;
  }

  initTabs();
  initEvents();

  document.getElementById("btnBackToBudget").href = `../centroCustos.html?project=${currentProjectId}`;

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
      selector.innerHTML = '<option value="">Selecionar Obra...</option>' + 
        allProjects.map(p => `<option value="${p.id}" ${p.id === currentProjectId ? 'selected' : ''}>${p.name}</option>`).join("");
      
      selector.classList.remove("hidden");
      
      selector.addEventListener("change", (e) => {
        const id = e.target.value;
        if (id) {
          localStorage.setItem("InfoCliente.currentProjectId", id);
          window.location.href = `?project=${id}`;
        } else {
          localStorage.removeItem("InfoCliente.currentProjectId");
          window.location.href = `?`;
        }
      });
      
      // Update selected project name if we have a currentProjectId
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
}

// ==========================================
// PENDENTES / NEEDS
// ==========================================
async function loadNeeds() {
  try {
    const data = await apiRequest(`/quotes/project/${currentProjectId}/needs`);
    currentNeeds = data.items || [];

    const filterCc = document.getElementById("filterCentroCusto");
    if (filterCc) {
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
    filtered = filtered.filter(n => String(n.costCenter?.id || n.costCenterId) === String(ccId));
  }

  document.getElementById("pendentesCount").textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400 font-medium">Nenhum item em cotação.</td></tr>`;
    return;
  }

  const statusLabels = {
    "PENDING": "Pendente",
    "IN_QUOTATION": "Em Cotação",
    "ORDERED": "Encomenda",
    "EM_ANALISE": "Em Análise",
    "APPROVED": "Aprovado",
    "REJECTED": "Rejeitado"
  };

  const statusClasses = {
    "PENDING": "bg-slate-100 text-slate-600",
    "IN_QUOTATION": "bg-blue-100 text-blue-600",
    "ORDERED": "bg-amber-100 text-amber-700",
    "EM_ANALISE": "bg-sky-100 text-sky-700",
    "APPROVED": "bg-[#2afc8d]/20 text-green-700",
    "REJECTED": "bg-red-100 text-red-600"
  };

  tbody.innerHTML = filtered.map(n => {
    const qty = n.quantity ? Number(n.quantity).toLocaleString("pt-PT", {minimumFractionDigits: 2}) : "—";
    const quotesCount = n.quotes ? n.quotes.length : 0;
    
    let bestQuotePriceStr = "";
    if (quotesCount > 0 && n.status === "IN_QUOTATION") {
      const minPrice = Math.min(...n.quotes.map(q => Number(q.quotedPrice)));
      bestQuotePriceStr = `<div class="text-[10px] text-amber-600 font-bold mt-1">Melhor Preço: ${Number(minPrice).toLocaleString("pt-PT")}</div>`;
    }

    const isApproved = n.status === "APPROVED";
    const isOrdered = n.status === "ORDERED";

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
        <td class="py-3 px-4 text-xs text-slate-500">${new Date(n.createdAt).toLocaleDateString("pt-PT")}</td>
        <td class="py-3 px-4 text-xs font-bold text-slate-600">${n.costCenter?.name || "—"}</td>
        <td class="py-3 px-4">
          <div class="font-medium text-slate-900">${n.description}</div>
          <div class="text-xs text-slate-400 mt-0.5">${quotesCount} cotações recebidas</div>
          ${bestQuotePriceStr}
        </td>
        <td class="py-3 px-4 text-center text-sm font-bold text-slate-700">${qty} ${n.unit || ""}</td>
        <td class="py-3 px-4 text-center">
          <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${statusClasses[n.status] || "bg-slate-100"}">${statusLabels[n.status] || n.status}</span>
        </td>
        <td class="py-3 px-4 text-center">
          <button onclick="openQuoteModal('${n.id}')" 
            class="h-8 px-3 rounded-lg ${isApproved ? 'bg-slate-100 text-slate-500' : isOrdered ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'} font-bold text-xs transition-all flex items-center justify-center gap-1 mx-auto">
            <span class="material-symbols-outlined text-[14px]">${isApproved ? 'visibility' : isOrdered ? 'upload_file' : 'price_change'}</span>
            ${isApproved ? 'Ver Cotação' : isOrdered ? 'Proforma' : 'Precificar'}
          </button>
        </td>
      </tr>
    `;
  }).join("");
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

function openSupplierModal(supplier = null) {
  document.getElementById("modalSupplierTitle").textContent = supplier ? "Editar Fornecedor" : "Novo Fornecedor";
  document.getElementById("supplierId").value = supplier?.id || "";
  document.getElementById("supplierName").value = supplier?.name || "";
  document.getElementById("supplierNif").value = supplier?.nif || "";
  document.getElementById("supplierPhone").value = supplier?.phone || "";
  document.getElementById("supplierEmail").value = supplier?.email || "";
  document.getElementById("supplierCategory").value = supplier?.category || "";
  document.getElementById("supplierType").value = supplier?.type || "MATERIAL";
  document.getElementById("supplierPaymentTerm").value = supplier?.paymentTerm || "";
  document.getElementById("supplierVatPercent").value = supplier?.vatPercent ?? "";
  document.getElementById("supplierWithholdingPercent").value = supplier?.withholdingPercent ?? "";
  document.getElementById("supplierDiscountPercent").value = supplier?.discountPercent ?? "";

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
  const bankAccounts = collectSupplierBankAccounts();
  const body = {
    name: document.getElementById("supplierName").value.trim(),
    nif: document.getElementById("supplierNif").value.trim() || null,
    phone: document.getElementById("supplierPhone").value.trim() || null,
    email: document.getElementById("supplierEmail").value.trim() || null,
    category: document.getElementById("supplierCategory").value.trim() || null,
    type: document.getElementById("supplierType").value || "MATERIAL",
    paymentTerm: document.getElementById("supplierPaymentTerm").value || null,
    vatPercent: parseOptionalPercentInput("supplierVatPercent"),
    withholdingPercent: parseOptionalPercentInput("supplierWithholdingPercent"),
    discountPercent: parseOptionalPercentInput("supplierDiscountPercent"),
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

  if (currentCatalogProducts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-slate-400 font-medium">Nenhum produto registado. Clique em <strong>Novo Produto</strong> para adicionar.</td></tr>`;
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
