import { apiRequest, apiUpload, getAssetUrl } from "/services/api.js";
import { guardPageAccess, initPermissionLayer } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";

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
  document.getElementById("formAddQuote").addEventListener("submit", submitQuote);

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
    "APPROVED": "Aprovado",
    "REJECTED": "Rejeitado"
  };

  const statusClasses = {
    "PENDING": "bg-slate-100 text-slate-600",
    "IN_QUOTATION": "bg-blue-100 text-blue-600",
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
            class="h-8 px-3 rounded-lg ${isApproved ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'} font-bold text-xs transition-all flex items-center justify-center gap-1 mx-auto">
            <span class="material-symbols-outlined text-[14px]">${isApproved ? 'visibility' : 'price_change'}</span>
            ${isApproved ? 'Ver Cotação' : 'Precificar'}
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
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400 font-medium">Nenhum fornecedor registado.</td></tr>`;
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

function openSupplierModal(supplier = null) {
  document.getElementById("modalSupplierTitle").textContent = supplier ? "Editar Fornecedor" : "Novo Fornecedor";
  document.getElementById("supplierId").value = supplier?.id || "";
  document.getElementById("supplierName").value = supplier?.name || "";
  document.getElementById("supplierNif").value = supplier?.nif || "";
  document.getElementById("supplierPhone").value = supplier?.phone || "";
  document.getElementById("supplierEmail").value = supplier?.email || "";
  document.getElementById("supplierCategory").value = supplier?.category || "";
  document.getElementById("supplierPaymentTerm").value = supplier?.paymentTerm || "";
  const ibanInput = document.getElementById("supplierIban");
  if (ibanInput) ibanInput.value = supplier?.iban || "";
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
  const body = {
    name: document.getElementById("supplierName").value.trim(),
    nif: document.getElementById("supplierNif").value.trim() || null,
    phone: document.getElementById("supplierPhone").value.trim() || null,
    email: document.getElementById("supplierEmail").value.trim() || null,
    category: document.getElementById("supplierCategory").value.trim() || null,
    paymentTerm: document.getElementById("supplierPaymentTerm").value || null,
  };
  const ibanInput = document.getElementById("supplierIban");
  if (ibanInput) body.iban = ibanInput.value.trim() || null;

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

window.openSupplierProducts = async function(supplierId, supplierName) {
  currentCatalogSupplierId = supplierId;
  document.getElementById("modalProductsSupplierName").textContent = supplierName;
  document.getElementById("supplierProductSupplierId").value = supplierId;
  cancelProductEdit(); // reset the form
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
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-slate-400 font-medium">Nenhum produto registado. Adicione o primeiro produto ao catálogo.</td></tr>`;
    return;
  }

  const fmt = (v, cur = "AOA") => Number(v).toLocaleString("pt-PT", { minimumFractionDigits: 2 }) + " " + cur;
  const fmtDate = d => d ? new Date(d).toLocaleDateString("pt-PT") : "—";

  tbody.innerHTML = currentCatalogProducts.map(p => {
    const expired = p.validUntil && new Date(p.validUntil) < new Date();
    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
        <td class="py-3 px-4">
          <div class="font-bold text-slate-800 text-sm">${p.name}</div>
          ${p.description ? `<div class="text-xs text-slate-400">${p.description}</div>` : ''}
        </td>
        <td class="py-3 px-4 text-right font-bold text-slate-700">${fmt(p.price, p.currency)}</td>
        <td class="py-3 px-4 text-center text-sm text-slate-500">${p.unit || '—'}</td>
        <td class="py-3 px-4 text-right text-xs ${expired ? 'text-red-500 font-bold' : 'text-slate-400'}">${fmtDate(p.validUntil)}</td>
        <td class="py-3 px-4">
          <div class="flex justify-center gap-1.5">
            <button onclick="editSupplierProduct(${JSON.stringify(p).replace(/"/g, '&quot;')})" class="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-all text-slate-500" title="Editar">
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

window.editSupplierProduct = function(product) {
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

window.cancelProductEdit = function() {
  document.getElementById("formSupplierProduct").reset();
  document.getElementById("supplierProductId").value = "";
  document.getElementById("supplierProductSupplierId").value = currentCatalogSupplierId || "";
  document.getElementById("supplierProductSubmitLabel").textContent = "Guardar Produto";
  document.getElementById("supplierProductCancelEdit").style.display = "none";
  const titleEl = document.getElementById("formProductTitle");
  if (titleEl) titleEl.textContent = "Novo Produto";
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
  const need = currentNeeds.find(n => n.id === needId);
  if (!need) return;

  document.getElementById("quoteNeedId").value = need.id;
  document.getElementById("quoteItemDesc").textContent = `${need.description} (${need.quantity || '0'} ${need.unit || ''})`;
  
  updateQuoteSupplierSelect();
  document.getElementById("quotePrice").value = "";
  document.getElementById("quoteQuantity").value = need.quantity || "";
  const proformaInput = document.getElementById("quoteProforma");
  if (proformaInput) proformaInput.value = "";
  document.getElementById("quoteProductRow").style.display = "none";
  document.getElementById("quoteSupplierProduct").innerHTML = `<option value="">Selecionar produto...</option>`;

  // When supplier changes: load its products and auto-fill price
  const supplierSel = document.getElementById("quoteSupplier");
  supplierSel.onchange = async function() {
    const sid = this.value;
    const productRow = document.getElementById("quoteProductRow");
    const productSel = document.getElementById("quoteSupplierProduct");
    productSel.innerHTML = `<option value="">Selecionar produto...</option>`;
    document.getElementById("quotePrice").value = "";
    if (!sid) { productRow.style.display = "none"; return; }
    try {
      const data = await apiRequest(`/suppliers/${sid}/products`);
      const products = data.items || [];
      if (products.length > 0) {
        productRow.style.display = "block";
        productSel.innerHTML = `<option value="">Selecionar produto...</option>` +
          products.map(p => `<option value="${p.id}" data-price="${p.price}" data-currency="${p.currency}">${p.name} — ${Number(p.price).toLocaleString("pt-PT")} ${p.currency} / ${p.unit || 'uni'}</option>`).join("");
        productSel.onchange = function() {
          const opt = this.options[this.selectedIndex];
          if (opt.value) {
            document.getElementById("quotePrice").value = opt.dataset.price;
            document.getElementById("quoteCurrency").value = opt.dataset.currency;
          }
        };
      } else {
        productRow.style.display = "none";
      }
    } catch(e) {
      productRow.style.display = "none";
    }
  };

  document.getElementById("modalQuote").classList.add("open");
  
  // Hide the add form if already approved
  const formBlock = document.getElementById("formAddQuote").parentElement;
  if(need.status === "APPROVED") {
    formBlock.classList.add("hidden");
  } else {
    formBlock.classList.remove("hidden");
    // Suggest items from all catalogs based on description
    findAndSuggestProducts(need.description);
  }

  await loadQuotesForNeed(need.id, need.status === "APPROVED");
}

async function findAndSuggestProducts(searchTerm) {
  const box = document.getElementById("catalogSuggestionsBox");
  const list = document.getElementById("catalogSuggestionsList");
  
  if (!searchTerm || searchTerm.length < 3) {
    box.classList.add("hidden");
    return;
  }

  try {
    // Normaliza termo de pesquisa (remover quantidades e unidades)
    // Ex: "Areia (36 m3)" -> "Areia"
    const term = searchTerm.replace(/\(.*?\)/g, '').trim().toLowerCase();
    
    // Procura em todos os produtos de todos os fornecedores (idealmente seria um endpoint /products/search?q=...)
    // Como temos currentSuppliers carregado, vamos iterar (ou chamar a API se precisarmos de garantir dados frescos)
    
    let allMatches = [];
    
    // Para simplificar, vou iterar nos fornecedores e fazer fetch dos produtos deles 
    // Em produção seria melhor ter um endpoint de pesquisa global.
    const promises = currentSuppliers.map(s => apiRequest(`/suppliers/${s.id}/products`).catch(() => ({items: []})));
    const results = await Promise.all(promises);
    
    results.forEach((res, index) => {
      const supplier = currentSuppliers[index];
      const products = res.items || [];
      const matches = products.filter(p => p.name.toLowerCase().includes(term) || (p.description && p.description.toLowerCase().includes(term)));
      
      matches.forEach(m => {
        allMatches.push({
          supplier: supplier,
          product: m
        });
      });
    });

    if (allMatches.length > 0) {
      list.innerHTML = allMatches.map(m => {
        let termBadge = "";
        if (m.supplier.paymentTerm === "CREDITO") termBadge = `<span class="mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 w-max inline-block">Crédito</span>`;
        else if (m.supplier.paymentTerm === "PRONTO_PAGAMENTO") termBadge = `<span class="mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 w-max inline-block">PP</span>`;
        
        return `
        <div class="bg-white p-3 rounded-xl border border-blue-100 flex flex-col gap-2 shadow-sm hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group" 
             onclick="autoFillSuggestion('${m.supplier.id}', '${m.product.id}', '${m.product.price}', '${m.product.currency}')">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex flex-col">
              <p class="text-sm font-bold text-slate-800 truncate group-hover:text-blue-600 transition-colors">${m.product.name}</p>
              <p class="text-[10px] text-slate-500 font-medium truncate mt-0.5 flex items-center"><span class="material-symbols-outlined text-[10px] mr-0.5">storefront</span>${m.supplier.name}</p>
              ${termBadge}
            </div>
            <div class="w-8 h-8 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500 group-hover:text-white transition-colors">
              <span class="material-symbols-outlined text-[14px]">add</span>
            </div>
          </div>
          <div class="flex items-end justify-between border-t border-slate-50 pt-2 mt-1">
            <span class="text-[10px] text-slate-400 font-semibold">Preço Base</span>
            <div class="text-right flex-shrink-0">
              <span class="text-sm font-black text-slate-900">${Number(m.product.price).toLocaleString("pt-PT")} ${m.product.currency}</span>
              <span class="text-[10px] font-bold text-slate-400">/${m.product.unit || 'uni'}</span>
            </div>
          </div>
        </div>
      `}).join("");
      box.classList.remove("hidden");
    } else {
      box.classList.add("hidden");
    }
    
  } catch (err) {
    console.error("Erro ao procurar sugestões:", err);
    box.classList.add("hidden");
  }
}

window.autoFillSuggestion = async function(supplierId, productId, price, currency) {
  // Preenche os campos do formulário
  const supplierSel = document.getElementById("quoteSupplier");
  supplierSel.value = supplierId;
  
  // Despoleta o evento onchange para carregar os produtos no select
  await supplierSel.onchange();
  
  // Define o produto e o preço
  setTimeout(() => {
    const productSel = document.getElementById("quoteSupplierProduct");
    if (productSel) productSel.value = productId;
    
    document.getElementById("quotePrice").value = price;
    document.getElementById("quoteCurrency").value = currency;
  }, 100); // Aguarda o carregamento dos produtos do fornecedor (promises)
}

async function loadQuotesForNeed(needId, isApproved) {
  const list = document.getElementById("quotesList");
  list.innerHTML = `<div class="spinner mx-auto my-4"></div>`;
  
  try {
    const data = await apiRequest(`/quotes/need/${needId}`);
    const quotes = data.items || [];
    
    if (quotes.length === 0) {
      list.innerHTML = `<div class="p-8 text-center text-slate-400 text-sm font-medium border border-dashed border-slate-200 rounded-xl">Nenhuma cotação registada.</div>`;
      return;
    }

    list.innerHTML = quotes.map(q => {
      const price = Number(q.quotedPrice).toLocaleString("pt-PT", {minimumFractionDigits: 2});
      const total = Number(q.totalValue).toLocaleString("pt-PT", {minimumFractionDigits: 2});
      
      const selectBtn = (!isApproved && !q.selected) 
        ? `<button onclick="selectQuote('${q.id}', '${needId}')" class="h-8 px-4 bg-[#0f172a] text-white text-[10px] font-bold rounded-lg hover:bg-[#2afc8d] hover:text-[#0f172a] transition-all whitespace-nowrap">Aprovar este Preço</button>`
        : ``;

      const badge = q.selected 
        ? `<span class="bg-[#2afc8d]/20 text-green-700 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest"><span class="material-symbols-outlined text-[10px] align-middle mr-1">verified</span>Vencedor</span>`
        : ``;

      const deleteBtn = (!isApproved && !q.selected)
        ? `<button onclick="deleteQuote('${q.id}', '${needId}')" class="text-slate-300 hover:text-red-500 transition-colors" title="Remover"><span class="material-symbols-outlined text-sm">close</span></button>`
        : ``;

      const proformaLink = q.proformaUrl 
        ? `<button onclick="openProformaViewer('${getAssetUrl(q.proformaUrl)}')" class="text-blue-500 hover:text-blue-700 transition-colors" title="Ver Proforma"><span class="material-symbols-outlined text-sm">description</span></button>`
        : ``;

      const supplierProductName = q.supplierProduct?.name ? `(${q.supplierProduct.name})` : "";
      
      let paymentTermBadge = "";
      if (q.supplier?.paymentTerm === "CREDITO") {
        paymentTermBadge = `<span class="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">Crédito</span>`;
      } else if (q.supplier?.paymentTerm === "PRONTO_PAGAMENTO") {
        paymentTermBadge = `<span class="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">PP</span>`;
      }

      return `
        <div class="bg-white p-4 rounded-xl border ${q.selected ? 'border-[#2afc8d] shadow-sm shadow-[#2afc8d]/20' : 'border-slate-200'} flex items-center justify-between gap-4">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <h4 class="font-bold text-slate-800 text-sm">${q.supplier?.name} ${paymentTermBadge} <span class="text-xs text-slate-400 font-medium">${supplierProductName}</span></h4>
              ${badge}
            </div>
            <div class="text-xs text-slate-500">${q.quantity} uni × ${price} ${q.currency}</div>
          </div>
          <div class="text-right">
            <div class="font-black text-slate-900">${total} ${q.currency}</div>
          </div>
          <div class="flex flex-col gap-2 items-end ml-2 border-l border-slate-100 pl-4">
            ${selectBtn}
            <div class="flex gap-2 items-center">
              ${proformaLink}
              ${deleteBtn}
            </div>
          </div>
        </div>
      `;
    }).join("");

  } catch (err) {
    list.innerHTML = `<div class="text-red-500 text-sm">Erro: ${err.message}</div>`;
  }
}

async function submitQuote(e) {
  e.preventDefault();
  const needId = document.getElementById("quoteNeedId").value;
  const spId = document.getElementById("quoteSupplierProduct")?.value || null;
  
  const form = new FormData();
  form.append("supplierId", document.getElementById("quoteSupplier").value);
  if (spId) form.append("supplierProductId", spId);
  form.append("quotedPrice", document.getElementById("quotePrice").value);
  const qty = document.getElementById("quoteQuantity").value;
  if (qty) form.append("quantity", qty);
  form.append("currency", document.getElementById("quoteCurrency").value);
  
  const proformaInput = document.getElementById("quoteProforma");
  if (proformaInput && proformaInput.files[0]) {
    form.append("proforma", proformaInput.files[0]);
  }

  try {
    await apiUpload(`/quotes/need/${needId}`, form, "POST");
    showToast("Preço adicionado", "success");
    document.getElementById("quotePrice").value = "";
    document.getElementById("quoteSupplierProduct").innerHTML = `<option value="">Selecionar produto...</option>`;
    document.getElementById("quoteProductRow").style.display = "none";
    document.getElementById("quoteSupplier").value = "";
    if (proformaInput) proformaInput.value = "";
    
    // Recarrega cotações do modal e a lista principal
    await loadQuotesForNeed(needId, false);
    await loadNeeds(); // actualiza a tag "Melhor preço"
  } catch(err) {
    showToast("Erro: " + err.message, "error");
  }
}

window.deleteQuote = async function(id, needId) {
  if(!confirm("Remover esta cotação?")) return;
  try {
    await apiRequest(`/quotes/${id}`, { method: "DELETE" });
    showToast("Cotação removida", "success");
    await loadQuotesForNeed(needId, false);
    await loadNeeds();
  } catch(err) {
    showToast("Erro: " + err.message, "error");
  }
}

window.selectQuote = async function(quoteId, needId) {
  if(!confirm("Aprovar este preço? O item passará para Aprovado.")) return;
  try {
    await apiRequest(`/quotes/${quoteId}/select`, { method: "PATCH" });
    showToast("Cotação aprovada com sucesso!", "success");
    document.getElementById("modalQuote").classList.remove("open");
    await loadNeeds();
  } catch(err) {
    showToast("Erro: " + err.message, "error");
  }
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
