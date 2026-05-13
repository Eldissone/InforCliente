import { apiRequest, apiUpload, getAssetUrl } from "../../services/api.js";
import { wireUsersNav, wireLogout } from "../../shared/session.js";
import { openModal, initMobileMenu, escapeHtml as esc } from "../../shared/ui.js";

document.addEventListener("DOMContentLoaded", async () => {
    await wireUsersNav();
    wireLogout();
    initMobileMenu();
    init();
});

let currentTab = "inventory";

function init() {
    setupTabs();
    loadTabContent(currentTab);
    setupGlobalEvents();
}

function setupTabs() {
    const tabs = document.querySelectorAll(".tab-btn");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("tab-active"));
            tab.classList.add("tab-active");
            currentTab = tab.dataset.tab;
            loadTabContent(currentTab);
        });
    });
}

function setupGlobalEvents() {
    document.getElementById("btnNewEntry")?.addEventListener("click", () => openMovementModal("ENTRY"));
    document.getElementById("btnTransfer")?.addEventListener("click", () => openTransferModal());
}

async function loadTabContent(tab) {
    const container = document.getElementById("tabContent");
    container.innerHTML = `<div class="flex items-center justify-center py-20"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2afc8d]"></div></div>`;

    try {
        if (tab === "inventory") await renderInventory(container);
        else if (tab === "catalog") await renderCatalog(container);
        else if (tab === "tools") await renderTools(container);
        else if (tab === "warehouses") await renderWarehouses(container);
        else if (tab === "movements") await renderMovements(container);
        else if (tab.startsWith("warehouse_detail_")) {
            const warehouseId = tab.replace("warehouse_detail_", "");
            await renderWarehouseDetail(container, warehouseId);
        }
    } catch (error) {
        container.innerHTML = `<div class="bg-red-50 text-red-600 p-8 rounded-2xl font-bold text-center">Erro ao carregar dados: ${error.message}</div>`;
    }
}

async function renderInventory(container) {
    const { items: balances } = await apiRequest("/stock/balance");
    const { items: allItems } = await apiRequest("/items");

    // Agrupar ativos por produto e armazém para contar quantidades
    const assetCounts = {};
    allItems.forEach(item => {
        const key = `${item.productId}-${item.warehouseId}-${item.ownerId || 'proprio'}`;
        if (!assetCounts[key]) {
            assetCounts[key] = {
                product: item.product,
                warehouse: item.warehouse,
                ownerId: item.ownerId,
                quantity: 0,
                isAsset: true
            };
        }
        assetCounts[key].quantity++;
    });

    // Combinar balances com contagens de ativos
    const consolidated = [
        ...balances.map(b => ({ ...b, isAsset: false })),
        ...Object.values(assetCounts)
    ];

    let html = `
        <div class="mb-10 flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
            <div>
                <h3 class="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-1">Visão Consolidada</h3>
                <h2 class="text-3xl font-black text-slate-900 tracking-tighter">Inventário Geral</h2>
            </div>
            <div class="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                <div class="bg-white p-1.5 rounded-2xl border border-slate-100 shadow-sm flex gap-1">
                    <button data-filter="ALL" class="inventory-filter-btn px-5 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-900 text-white transition-all">Tudo</button>
                    <button data-filter="MATERIAL" class="inventory-filter-btn px-5 py-2 rounded-xl text-[10px] font-black uppercase text-slate-400 hover:bg-slate-50 transition-all">Materiais</button>
                    <button data-filter="ASSET" class="inventory-filter-btn px-5 py-2 rounded-xl text-[10px] font-black uppercase text-slate-400 hover:bg-slate-50 transition-all">Ferramentas</button>
                </div>
                <div class="relative flex-grow lg:flex-grow-0 lg:w-64">
                    <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl">search</span>
                    <input type="text" id="searchInventory" placeholder="Procurar no inventário..." class="w-full pl-12 pr-4 h-11 bg-white border border-slate-200 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-[#2afc8d] transition-all">
                </div>
            </div>
        </div>

        <div class="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-sm">
            <table class="w-full text-left">
                <thead>
                    <tr class="text-[10px] font-black uppercase text-slate-400 bg-slate-50/30">
                        <th class="px-10 py-5">Produto</th>
                        <th class="px-10 py-5">Localização</th>
                        <th class="px-10 py-5">Tipo / Propriedade</th>
                        <th class="px-10 py-5 text-right">Quantidade</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-50">
    `;

    if (consolidated.length === 0) {
        html += `<tr><td colspan="4" class="p-20 text-center text-slate-400 font-medium italic">Nenhum registo de stock ou ativos.</td></tr>`;
    } else {
        consolidated.forEach(item => {
            const isLow = !item.isAsset && item.quantity < 5;
            const isTool = item.product.category === 'TOOL' || item.product.category === 'EQUIPMENT';

            html += `
                <tr class="inventory-row group hover:bg-slate-50/50 transition-colors" data-type="${isTool ? 'ASSET' : 'MATERIAL'}">
                    <td class="px-10 py-6">
                        <div class="font-bold text-slate-900 text-base">${esc(item.product.name)}</div>
                        <div class="text-[10px] text-slate-400 font-black uppercase tracking-wider">${esc(item.product.sku || 'N/A')}</div>
                    </td>
                    <td class="px-10 py-6">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm text-slate-300">location_on</span>
                            <span class="text-sm font-bold text-slate-600">${esc(item.warehouse?.name || '---')}</span>
                        </div>
                    </td>
                    <td class="px-10 py-6">
                        <div class="flex flex-col gap-1">
                            <span class="px-2 py-0.5 w-fit rounded-md ${item.isAsset ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'} text-[9px] font-black uppercase tracking-widest">
                                ${item.isAsset ? 'Ativo' : 'Stock'}
                            </span>
                            <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                                ${item.ownerId ? 'Cliente' : 'Próprio'}
                            </span>
                        </div>
                    </td>
                    <td class="px-10 py-6 text-right">
                        <div class="flex flex-col items-end">
                            <span class="text-2xl font-black ${isLow ? 'text-amber-500' : 'text-slate-900'}">${item.quantity}</span>
                            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${esc(item.product.unit)}</span>
                        </div>
                    </td>
                </tr>
            `;
        });
    }

    html += `</tbody></table></div>`;
    container.innerHTML = html;

    // Lógica de Pesquisa e Filtros no Inventário
    const searchInput = document.getElementById("searchInventory");
    const filterBtns = container.querySelectorAll(".inventory-filter-btn");
    const rows = container.querySelectorAll(".inventory-row");

    let currentSearch = '';
    let currentFilter = 'ALL';

    const applyInventoryFilters = () => {
        rows.forEach(row => {
            const matchesType = currentFilter === 'ALL' || row.dataset.type === currentFilter;
            const matchesSearch = row.innerText.toLowerCase().includes(currentSearch);
            if (matchesType && matchesSearch) row.classList.remove("hidden");
            else row.classList.add("hidden");
        });
    };

    searchInput?.addEventListener("input", (e) => {
        currentSearch = e.target.value.toLowerCase();
        applyInventoryFilters();
    });

    filterBtns.forEach(btn => {
        btn.onclick = () => {
            currentFilter = btn.dataset.filter;
            filterBtns.forEach(b => {
                b.classList.remove("bg-slate-900", "text-white");
                b.classList.add("text-slate-400");
            });
            btn.classList.add("bg-slate-900", "text-white");
            btn.classList.remove("text-slate-400");
            applyInventoryFilters();
        };
    });
}

async function renderCatalog(container) {
    const { items } = await apiRequest("/products");
    const { items: allStock } = await apiRequest("/stock/balance");
    const { items: allItems } = await apiRequest("/items");

    const materials = items.filter(p => p.category === 'MATERIAL' || p.category === 'CONSUMABLE');
    const tools = items.filter(p => p.category === 'TOOL' || p.category === 'EQUIPMENT');

    const renderTable = (products, title, colorClass) => `
        <div class="mb-12">
            <div class="flex justify-between items-center mb-6 px-2">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-2xl ${colorClass} flex items-center justify-center shadow-sm">
                        <span class="material-symbols-outlined text-xl">${title.includes('Materiais') ? 'inventory_2' : 'construction'}</span>
                    </div>
                    <div>
                        <h3 class="text-lg font-black text-slate-900 tracking-tighter uppercase">${title}</h3>
                        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${products.length} Referências no Sistema</p>
                    </div>
                </div>
            </div>
            <div class="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-sm">
                <table class="w-full text-left">
                    <thead>
                        <tr class="bg-slate-50/50 border-b border-slate-50 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                            <th class="px-8 py-5">Nome do Produto</th>
                            <th class="px-8 py-5">SKU / Referência</th>
                            <th class="px-8 py-5 text-right">Ações</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-50">
                        ${products.map(p => `
                            <tr class="hover:bg-slate-50/50 transition-colors group">
                                <td class="px-8 py-4">
                                    <div class="font-bold text-slate-900 text-sm">${esc(p.name)}</div>
                                    <div class="text-[9px] font-black text-slate-300 uppercase tracking-widest">${esc(p.category)}</div>
                                </td>
                                <td class="px-8 py-4 text-xs font-bold text-slate-500">${esc(p.sku || '---')}</td>
                                <td class="px-8 py-4 text-right">
                                    <div class="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onclick="window.editProduct('${p.id}')" class="w-8 h-8 rounded-lg text-slate-300 hover:bg-blue-50 hover:text-blue-600 transition-all flex items-center justify-center">
                                            <span class="material-symbols-outlined text-lg">edit</span>
                                        </button>
                                        <button onclick="window.deleteProduct('${p.id}')" class="w-8 h-8 rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-600 transition-all flex items-center justify-center">
                                            <span class="material-symbols-outlined text-lg">delete</span>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `).join('') || `<tr><td colspan="4" class="p-12 text-center text-slate-300 font-medium italic">Nenhuma referência registada neste grupo.</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    container.innerHTML = `
        <div class="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10">
            <div>
                <h3 class="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-1">Catálogo Mestre</h3>
                <h2 class="text-3xl font-black text-slate-900 tracking-tighter">Gestão de Referências</h2>
            </div>
            <div class="flex flex-wrap gap-3 w-full md:w-auto">
                <div class="relative flex-grow md:flex-grow-0 min-w-[300px]">
                    <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl">search</span>
                    <input type="text" id="searchCatalog" placeholder="Procurar no catálogo (Nome, SKU...)" class="w-full pl-12 pr-4 h-12 bg-white border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-[#2afc8d] transition-all">
                </div>
                <button id="btnCreateProduct" class="h-12 bg-slate-900 text-white px-8 rounded-2xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl shadow-slate-900/20 flex items-center gap-2">
                    <span class="material-symbols-outlined text-xl">add</span> Novo Produto
                </button>
            </div>
        </div>

        <div id="catalogContent">
            ${renderTable(materials, "Material de Consumo", "bg-emerald-50 text-emerald-600")}
            ${renderTable(tools, "Ferramentas", "bg-indigo-50 text-indigo-600")}
        </div>
    `;

    // Lógica de Pesquisa no Catálogo
    const searchCatalog = document.getElementById("searchCatalog");
    searchCatalog?.addEventListener("input", (e) => {
        const term = e.target.value.toLowerCase();
        const rows = container.querySelectorAll("tbody tr");
        rows.forEach(row => {
            const text = row.innerText.toLowerCase();
            if (text.includes(term)) {
                row.classList.remove("hidden");
            } else {
                row.classList.add("hidden");
            }
        });

        // Esconder tabelas vazias
        container.querySelectorAll(".mb-12").forEach(section => {
            const visibleRows = section.querySelectorAll("tbody tr:not(.hidden)").length;
            if (visibleRows === 0) section.classList.add("hidden");
            else section.classList.remove("hidden");
        });
    });

    document.getElementById("btnCreateProduct")?.addEventListener("click", () => openProductModal());
    window.editProduct = (id) => openProductModal(items.find(p => p.id === id));
    window.deleteProduct = async (id) => {
        if (!confirm("Confirmar eliminação?")) return;
        try {
            await apiRequest(`/products/${id}`, { method: "DELETE" });
            loadTabContent("catalog");
        } catch (error) { alert("Erro: Não pode eliminar produtos com stock ou ativos vinculados."); }
    };
}

async function openProductModal(product = null) {
    const contentHtml = `
        <form id="formProduct" class="space-y-6 pt-4">
            <div class="space-y-2">
                <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Nome do Produto</label>
                <input type="text" name="name" value="${esc(product?.name || '')}" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
            </div>
            <div class="grid grid-cols-2 gap-6">
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">SKU / Ref</label>
                    <input type="text" name="sku" value="${esc(product?.sku || '')}" class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                </div>
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Unidade</label>
                    <select name="unit" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700">
                        ${['UN', 'KG', 'M', 'L', 'CX', 'PAR', 'MT2', 'MT3'].map(u => `<option value="${u}" ${product?.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="space-y-2">
                <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Tipo / Categoria</label>
                <select name="category" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700">
                    <optgroup label="Consumíveis (Stock por Qtd)">
                        <option value="CONSUMABLE" ${product?.category === 'CONSUMABLE' ? 'selected' : ''}>Consumível Geral</option>
                        <option value="MATERIAL" ${product?.category === 'MATERIAL' ? 'selected' : ''}>Material de Obra</option>
                    </optgroup>
                    <optgroup label="Ativos (Controlo Individual)">
                        <option value="TOOL" ${product?.category === 'TOOL' ? 'selected' : ''}>Ferramenta</option>
                        <option value="EQUIPMENT" ${product?.category === 'EQUIPMENT' ? 'selected' : ''}>Equipamento Pesado</option>
                    </optgroup>
                </select>
            </div>
        </form>
    `;

    const { close } = openModal({
        title: product ? "Editar Produto" : "Novo Produto no Catálogo",
        contentHtml,
        primaryLabel: product ? "Atualizar" : "Criar Produto",
        onPrimary: async ({ body }) => {
            const data = Object.fromEntries(new FormData(body.querySelector("#formProduct")).entries());
            try {
                await apiRequest(product ? `/products/${product.id}` : "/products", {
                    method: product ? "PATCH" : "POST",
                    body: data
                });
                close();
                loadTabContent("catalog");
            } catch (error) { alert("Erro: " + error.message); }
        }
    });
}

async function renderTools(container) {
    const currentUser = await apiRequest("/users/me");
    const { items: allItems } = await apiRequest("/items");
    // FILTRO: Apenas produtos que sejam ferramentas ou equipamentos
    const items = allItems.filter(i => i.product.category === 'TOOL' || i.product.category === 'EQUIPMENT');

    const available = items.filter(i => i.status === 'AVAILABLE').length;
    const assignedCount = items.filter(i => i.status === 'ASSIGNED' || i.status === 'PENDING_RECEIPT' || i.status === 'PENDING_RETURN').length;
    const maintenanceCount = items.filter(i => i.status === 'MAINTENANCE').length;

    // Agrupar ferramentas por produto para o resumo de quantidades
    const toolGroups = {};
    items.forEach(i => {
        if (!toolGroups[i.productId]) {
            toolGroups[i.productId] = {
                product: i.product,
                total: 0,
                available: 0,
                assigned: 0,
                maintenance: 0
            };
        }
        toolGroups[i.productId].total++;
        if (i.status === 'AVAILABLE') {
            toolGroups[i.productId].available++;
        } else if (i.status === 'ASSIGNED' || i.status === 'PENDING_RECEIPT' || i.status === 'PENDING_RETURN') {
            toolGroups[i.productId].assigned++;
        } else if (i.status === 'MAINTENANCE') {
            toolGroups[i.productId].maintenance++;
        }
    });

    let html = `
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
            <div>
                <h3 class="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-1">Logística de Ativos</h3>
                <h2 class="text-3xl font-black text-slate-900 tracking-tighter">Ferramentas & Equipamento</h2>
            </div>
            <div class="flex flex-wrap gap-3 w-full md:w-auto">
                <div class="relative flex-grow md:flex-grow-0 min-w-[240px]">
                    <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl">search</span>
                    <input type="text" id="searchTools" placeholder="Procurar ferramenta ou S/N..." class="w-full pl-12 pr-4 h-12 bg-white border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-[#2afc8d] transition-all">
                </div>
                <button id="btnCreateTool" class="h-12 bg-slate-900 text-white px-6 rounded-2xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-2 shadow-xl shadow-slate-900/20">
                    <span class="material-symbols-outlined text-xl">add</span> Cadastrar
                </button>
            </div>
        </div>

        <!-- Resumo por Modelo (Quantidades) -->
        <div class="mb-10 bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100">
            <h4 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 ml-4">Resumo por Modelo / Quantidades</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                ${Object.values(toolGroups).map(g => `
                    <div class="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex justify-between items-center group hover:border-[#2afc8d] transition-all">
                        <div>
                            <p class="font-bold text-slate-900 text-sm mb-1">${esc(g.product.name)}</p>
                            <div class="flex gap-3">
                                <span class="text-[10px] font-black text-emerald-500 uppercase">${g.available} Livres</span>
                                <span class="text-[10px] font-black text-slate-400 uppercase">${g.assigned} Em Obra</span>
                            </div>
                        </div>
                        <button onclick="window.openDeliveryModal({ productId: '${g.product.id}' })" class="h-10 px-4 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all ${g.available === 0 ? 'opacity-30 pointer-events-none' : ''}">
                            Entregar
                        </button>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="flex overflow-x-auto no-scrollbar gap-2 mb-10 pb-2">
            <button data-status="ALL" class="tool-filter-btn shrink-0 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white transition-all">Todos</button>
            <button data-status="AVAILABLE" class="tool-filter-btn shrink-0 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-400 hover:bg-slate-50 transition-all">Disponíveis (${available})</button>
            <button data-status="ASSIGNED" class="tool-filter-btn shrink-0 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-400 hover:bg-slate-50 transition-all">Em Obra / Trânsito (${assignedCount})</button>
            <button data-status="MAINTENANCE" class="tool-filter-btn shrink-0 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-400 hover:bg-slate-50 transition-all">Manutenção (${maintenanceCount})</button>
        </div>

        <div id="toolsGrid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 sm:gap-6">
    `;

    if (items.length === 0) {
        container.innerHTML = `<div class="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-20 text-center col-span-full"><span class="material-symbols-outlined text-5xl text-slate-300 mb-4">construction</span><p class="text-slate-500 font-bold">Nenhuma ferramenta registada.</p></div>`;
        return;
    }

    // Agrupar itens para exibição na grelha principal
    const displayGroups = {};
    items.forEach(item => {
        const key = `${item.productId}-${item.warehouseId}-${item.targetWarehouseId || 'none'}-${item.responsibleId || 'none'}-${item.status}`;
        if (!displayGroups[key]) {
            displayGroups[key] = {
                ...item,
                quantity: 0,
                itemIds: []
            };
        }
        displayGroups[key].quantity++;
        displayGroups[key].itemIds.push(item.id);
    });

    Object.values(displayGroups).forEach(group => {
        const statusMap = {
            'AVAILABLE': { label: 'Livre', color: 'bg-emerald-500', icon: 'check_circle' },
            'PENDING_RECEIPT': { label: 'Pendente Receção', color: 'bg-amber-500', icon: 'hourglass_empty' },
            'ASSIGNED': { label: 'Em Obra', color: 'bg-blue-600', icon: 'construction' },
            'PENDING_RETURN': { label: 'Aguardando Validação', color: 'bg-indigo-500', icon: 'assignment_return' },
            'MAINTENANCE': { label: 'Manutenção', color: 'bg-red-500', icon: 'build' }
        };
        const status = statusMap[group.status] || { label: group.status, color: 'bg-slate-500', icon: 'help' };
        const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
        const isResponsible = group.responsibleId === currentUser.id;

        const imgUrl = getAssetUrl(group.imageUrl || group.product.image) || 'https://placehold.co/400x300/f8fafc/cbd5e1?text=Ferramenta';

        html += `
            <div class="tool-card bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all group flex flex-col h-full" 
                 data-status="${group.status}" 
                 data-search="${esc(group.product.name.toLowerCase())}">
                
                <div class="h-32 sm:h-40 overflow-hidden bg-slate-50 relative border-b border-slate-100 p-4 shrink-0">
                    <img src="${imgUrl}" alt="${esc(group.product.name)}" class="w-full h-full object-contain group-hover:scale-110 transition-all duration-700 mix-blend-multiply">
                    <div class="absolute top-3 right-3 sm:top-4 sm:right-4 px-2.5 py-1 sm:px-3 sm:py-1.5 ${status.color} text-white rounded-xl text-[8px] sm:text-[9px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1 sm:gap-1.5 animate-pulse-slow">
                        <span class="material-symbols-outlined text-[10px] sm:text-xs">${status.icon}</span>
                        ${status.label}
                    </div>
                </div>

                <div class="p-4 sm:p-6 flex flex-col flex-grow">
                    <div class="mb-4">
                        <h3 class="font-black text-slate-900 text-sm mb-1 group-hover:text-emerald-600 transition-colors line-clamp-2">${esc(group.product.name)}</h3>
                        <p class="text-[8px] sm:text-[9px] font-black text-slate-400 uppercase tracking-widest">Modelo: ${esc(group.product.sku || '---')}</p>
                    </div>
                    
                    <div class="space-y-2 sm:space-y-3 mb-5 sm:mb-6 flex-grow">
                        <div class="flex items-center gap-2.5 sm:gap-3 p-2.5 sm:p-3 bg-slate-50 rounded-2xl border border-slate-100/50">
                            <div class="w-7 h-7 sm:w-8 sm:h-8 shrink-0 bg-white rounded-xl flex items-center justify-center shadow-sm text-slate-400">
                                <span class="material-symbols-outlined text-base sm:text-lg">${group.status === 'PENDING_RECEIPT' ? 'local_shipping' : 'location_on'}</span>
                            </div>
                            <div class="min-w-0 flex-grow">
                                <p class="text-[9px] sm:text-[10px] font-bold text-slate-700 truncate w-full">
                                    ${group.status === 'PENDING_RECEIPT' ? esc(group.targetWarehouse?.name || '---') : esc(group.warehouse?.name || '---')}
                                </p>
                            </div>
                        </div>

                        <div class="flex items-center gap-2.5 sm:gap-3 p-2.5 sm:p-3 ${group.responsibleId ? 'bg-amber-50 border-amber-100/50' : 'bg-emerald-50 border-emerald-100/50'} rounded-2xl border transition-colors">
                            <div class="w-7 h-7 sm:w-8 sm:h-8 shrink-0 bg-white rounded-xl flex items-center justify-center shadow-sm ${group.responsibleId ? 'text-amber-500' : 'text-emerald-500'}">
                                <span class="material-symbols-outlined text-base sm:text-lg">${group.responsibleId ? 'person_check' : 'check_circle'}</span>
                            </div>
                            <div class="flex-grow min-w-0">
                                <div class="flex justify-between items-baseline gap-1">
                                    <p class="text-[9px] sm:text-[10px] font-bold ${group.responsibleId ? 'text-amber-900' : 'text-emerald-900'} truncate">
                                        ${group.responsibleId ? esc(group.responsible?.name) : 'Livre em Stock'}
                                    </p>
                                    <span class="text-[10px] sm:text-xs font-black ${group.responsibleId ? 'text-amber-600' : 'text-emerald-600'} shrink-0">x${group.quantity}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="flex flex-wrap gap-2 mt-auto">
                        ${group.status === 'PENDING_RECEIPT' && isResponsible ? `
                            <button onclick="window.confirmReceiptGroup('${group.itemIds.join(',')}')" class="flex-1 h-10 rounded-xl bg-[#2afc8d] text-slate-900 text-[9px] sm:text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-[#2afc8d]/20 flex items-center justify-center gap-1.5">
                                <span class="material-symbols-outlined text-sm sm:text-base">check</span> Receber
                            </button>
                        ` : ''}

                        ${group.status === 'ASSIGNED' && isResponsible ? `
                            <button onclick="window.requestReturnGroup('${group.itemIds.join(',')}')" class="flex-1 h-10 rounded-xl bg-slate-900 text-white text-[9px] sm:text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-slate-900/20 flex items-center justify-center gap-1.5">
                                <span class="material-symbols-outlined text-sm sm:text-base">assignment_return</span> Devolver
                            </button>
                        ` : ''}

                        ${group.status === 'PENDING_RETURN' && isResponsible ? `
                            <button onclick="window.confirmReturnGroup('${group.itemIds.join(',')}')" class="flex-1 h-10 rounded-xl bg-indigo-600 text-white text-[9px] sm:text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-1.5">
                                <span class="material-symbols-outlined text-sm sm:text-base">verified</span> Validar
                            </button>
                        ` : ''}

                        ${group.status === 'AVAILABLE' ? `
                            <button onclick="window.openDeliveryModal({ productId: '${group.productId}' })" class="flex-1 h-10 rounded-xl bg-slate-900 text-white text-[9px] sm:text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-slate-900/20 mt-4">
                                Entregar
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;

    document.getElementById("btnCreateTool")?.addEventListener("click", () => openToolModal());

    // Lógica de Pesquisa e Filtros
    const searchInput = document.getElementById("searchTools");
    const filterBtns = document.querySelectorAll(".tool-filter-btn");
    const toolCards = document.querySelectorAll(".tool-card");

    let currentFilter = 'ALL';
    let currentSearch = '';

    const applyFilters = () => {
        toolCards.forEach(card => {
            const matchesStatus = currentFilter === 'ALL'
                || (currentFilter === 'ASSIGNED' && (card.dataset.status === 'ASSIGNED' || card.dataset.status === 'PENDING_RECEIPT' || card.dataset.status === 'PENDING_RETURN'))
                || card.dataset.status === currentFilter;
            const matchesSearch = card.dataset.search.includes(currentSearch);
            if (matchesStatus && matchesSearch) {
                card.classList.remove("hidden");
            } else {
                card.classList.add("hidden");
            }
        });
    };

    searchInput?.addEventListener("input", (e) => {
        currentSearch = e.target.value.toLowerCase();
        applyFilters();
    });

    filterBtns.forEach(btn => {
        btn.onclick = () => {
            currentFilter = btn.dataset.status;
            filterBtns.forEach(b => {
                b.classList.remove("bg-slate-900", "text-white");
                b.classList.add("bg-white", "border", "border-slate-200", "text-slate-400");
            });
            btn.classList.add("bg-slate-900", "text-white");
            btn.classList.remove("bg-white", "border", "border-slate-200", "text-slate-400");
            applyFilters();
        };
    });
}

async function openToolModal(tool = null) {
    const productsRes = await apiRequest("/products");
    const warehousesRes = await apiRequest("/warehouses");

    // FILTRO: Apenas produtos que sejam ferramentas ou equipamentos para o cadastro individual
    const toolProducts = productsRes.items.filter(p => p.category === 'TOOL' || p.category === 'EQUIPMENT');

    const contentHtml = `
        <form id="formTool" class="space-y-6 pt-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Produto / Modelo</label>
                    <select name="productId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                        <option value="">Selecionar...</option>
                        ${toolProducts.map(p => `<option value="${p.id}" ${tool?.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Armazém Base</label>
                    <select name="warehouseId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                        ${warehousesRes.items.map(w => `<option value="${w.id}" ${tool?.warehouseId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Número de Série</label>
                    <input type="text" name="serialNumber" value="${esc(tool?.serialNumber || '')}" placeholder="Ex: SN-9928..." class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                </div>
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">${tool ? 'Estado' : 'Quantidade'}</label>
                    ${tool ? `
                        <select name="status" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                            <option value="AVAILABLE" ${tool?.status === 'AVAILABLE' ? 'selected' : ''}>Disponível</option>
                            <option value="ASSIGNED" ${tool?.status === 'ASSIGNED' ? 'selected' : ''}>Em Obra</option>
                            <option value="MAINTENANCE" ${tool?.status === 'MAINTENANCE' ? 'selected' : ''}>Manutenção</option>
                        </select>
                    ` : `
                        <input type="number" name="quantity" value="1" min="1" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                    `}
                </div>
            </div>
            <div class="space-y-2">
                <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Foto do Ativo</label>
                <div class="flex gap-4 items-center">
                    ${tool?.imageUrl ? `<img src="${getAssetUrl(tool.imageUrl)}" class="w-16 h-16 rounded-xl object-cover border border-slate-200">` : ''}
                    <input type="file" name="photo" accept="image/*" capture="environment" class="flex-1 bg-slate-50 border-none rounded-2xl p-4 text-xs font-bold text-slate-400">
                </div>
            </div>
        </form>
    `;

    const { close } = openModal({
        title: tool ? "Editar Ativo" : "Novo Ativo",
        contentHtml,
        primaryLabel: tool ? "Atualizar" : "Registar Ativo",
        onPrimary: async ({ body }) => {
            const formData = new FormData(body.querySelector("#formTool"));
            try {
                if (tool) {
                    await apiUpload(`/items/${tool.id}`, formData, "PATCH");
                } else {
                    await apiUpload("/items", formData, "POST");
                }
                close();
                loadTabContent("tools");
            } catch (error) { alert("Erro: " + error.message); }
        }
    });
}

window.editTool = async (id) => {
    const { items } = await apiRequest("/items");
    const tool = items.find(i => i.id === id);
    openToolModal(tool);
};

window.deleteTool = async (id) => {
    if (!confirm("Confirmar eliminação permanente deste ativo?")) return;
    try {
        await apiRequest(`/items/${id}`, { method: "DELETE" });
        loadTabContent("tools");
    } catch (error) { alert("Erro ao eliminar: " + error.message); }
};

window.openDeliveryModal = async ({ toolId, productId }) => {
    const usersRes = await apiRequest("/users");
    const warehousesRes = await apiRequest("/warehouses");
    const projectsRes = await apiRequest("/projects");

    let tool = null;
    let availableItems = [];
    let product = null;

    if (toolId) {
        const { items } = await apiRequest("/items");
        tool = items.find(i => i.id === toolId);
        if (!tool) return alert("Erro: Ativo não encontrado.");
        product = tool.product;
    } else if (productId) {
        const { items } = await apiRequest("/items");
        availableItems = items.filter(i => i.productId === productId && i.status === 'AVAILABLE');
        product = items.find(i => i.productId === productId)?.product;
        if (!product) return alert("Erro: Produto não encontrado.");
    }

    const isBulk = !!productId && !toolId;

    const contentHtml = `
        <div class="space-y-6 pt-4">
            <div class="bg-slate-50 p-6 rounded-3xl border border-slate-100 flex items-center gap-4">
                <div class="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                    <span class="material-symbols-outlined text-slate-400">construction</span>
                </div>
                <div>
                    <h4 class="font-bold text-slate-900">${esc(product?.name)}</h4>
                    ${isBulk
            ? `<p class="text-[10px] font-black text-emerald-500 uppercase tracking-widest">${availableItems.length} Unidades Disponíveis</p>`
            : `<p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">S/N: ${esc(tool.serialNumber || '---')}</p>`
        }
                </div>
            </div>

            <form id="formDelivery" class="space-y-4">
                ${isBulk ? `
                <div class="space-y-2">
                    <div class="flex justify-between items-end">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Quantidade a Entregar</label>
                        <span class="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Disponível: ${availableItems.length}</span>
                    </div>
                    <input type="number" name="qty" min="1" max="${availableItems.length}" value="1" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                </div>
                ` : ''}
                
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Entregar a (Responsável)</label>
                    <select name="responsibleId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                        <option value="">Selecionar funcionário...</option>
                        ${usersRes.items.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
                    </select>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Projeto / Obra</label>
                        <select name="projectId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                            <option value="">Selecionar...</option>
                            ${projectsRes.items.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="space-y-2">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Destino (Estaleiro)</label>
                        <select name="warehouseId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                            <option value="">Selecionar...</option>
                            ${warehousesRes.items.filter(w => w.type === 'SITE').map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </form>
        </div>
    `;

    const { close } = openModal({
        title: isBulk ? "Entrega em Lote" : "Entrega de Ferramenta",
        contentHtml,
        primaryLabel: "Confirmar Entrega",
        onPrimary: async ({ body }) => {
            const formData = new FormData(body.querySelector("#formDelivery"));
            const data = Object.fromEntries(formData.entries());

            try {
                if (isBulk) {
                    const qty = parseInt(data.qty);
                    if (qty > availableItems.length) {
                        return alert(`Erro: Quantidade excede o stock disponível (${availableItems.length} unidades).`);
                    }
                    const toAssign = availableItems.slice(0, qty);
                    for (const item of toAssign) {
                        await apiRequest(`/items/${item.id}/assign`, {
                            method: "PATCH",
                            body: {
                                responsibleId: data.responsibleId,
                                warehouseId: data.warehouseId,
                                projectId: data.projectId,
                                status: "PENDING_RECEIPT"
                            }
                        });
                    }
                } else {
                    await apiRequest(`/items/${tool.id}/assign`, {
                        method: "PATCH",
                        body: { ...data, status: "PENDING_RECEIPT" }
                    });
                }
                close();
                loadTabContent("tools");
            } catch (error) { alert("Erro ao entregar: " + error.message); }
        }
    });
};

async function renderWarehouses(container) {
    const { items: warehouses } = await apiRequest("/warehouses");
    const { items: allStock } = await apiRequest("/stock/balance");
    const { items: allItems } = await apiRequest("/items");

    container.innerHTML = `
        <div class="mb-10 flex justify-between items-end">
            <div>
                <h4 class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Rede Logística</h4>
                <h2 class="text-3xl font-bold text-slate-900 tracking-tight">Armazéns & Estaleiros</h2>
            </div>
            <button id="btnCreateWarehouse" class="h-10 bg-slate-900 text-white px-6 rounded-xl font-bold text-xs flex items-center gap-2 hover:scale-105 transition-all">
                <span class="material-symbols-outlined text-lg">add</span> Novo Armazém
            </button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            ${warehouses.map(w => {
        // Quantidade REAL de Materiais (Soma das quantidades)
        const warehouseStock = allStock.filter(s => s.warehouseId === w.id && (s.product.category === 'MATERIAL' || s.product.category === 'CONSUMABLE'));
        const totalStockQty = warehouseStock.reduce((acc, curr) => acc + (curr.quantity || 0), 0);

        // Quantidade de Ativos (Contagem individual de ferramentas/equipamentos)
        const toolCount = allItems.filter(i => i.warehouseId === w.id && (i.product.category === 'TOOL' || i.product.category === 'EQUIPMENT')).length;
        const pendingCount = allItems.filter(i => i.targetWarehouseId === w.id && (i.status === 'PENDING_RECEIPT' || i.status === 'PENDING_RETURN')).length;

        const isCentral = w.type === 'CENTRAL';

        return `
                <div onclick="window.enterWarehouse('${w.id}')" class="bg-white rounded-3xl border border-slate-200 p-8 hover:border-[#2afc8d] hover:shadow-xl hover:-translate-y-1 cursor-pointer transition-all group relative overflow-hidden flex flex-col h-full">
                    <div class="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full -mr-16 -mt-16 group-hover:bg-[#2afc8d]/5 transition-colors"></div>
                    
                    <div class="flex justify-between items-start mb-8 relative">
                        <div class="w-14 h-14 ${isCentral ? 'bg-slate-900 text-[#2afc8d]' : 'bg-emerald-50 text-emerald-600'} rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110">
                            <span class="material-symbols-outlined text-3xl">${isCentral ? 'warehouse' : 'construction'}</span>
                        </div>
                        <div class="flex gap-1">
                            ${pendingCount > 0 ? `
                            <div onclick="event.stopPropagation(); window.viewPendingReceipts('${w.id}')" class="h-8 px-3 bg-amber-100 text-amber-600 rounded-lg flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest animate-pulse hover:bg-amber-200 transition-colors cursor-pointer border border-amber-200">
                                <span class="material-symbols-outlined text-xs">local_shipping</span>
                                ${pendingCount} a caminho
                            </div>
                            ` : ''}
                            <button onclick="event.stopPropagation(); window.editWarehouse('${w.id}')" class="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition-all">
                                <span class="material-symbols-outlined text-base">edit</span>
                            </button>
                            <button onclick="event.stopPropagation(); window.deleteWarehouse('${w.id}')" class="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition-all">
                                <span class="material-symbols-outlined text-base">delete</span>
                            </button>
                        </div>
                    </div>

                    <h3 class="text-xl font-bold text-slate-900 mb-1 group-hover:text-emerald-700 transition-colors">${esc(w.name)}</h3>
                    <p class="text-xs text-slate-400 font-medium mb-6 line-clamp-1">${w.project ? `Obra: ${esc(w.project.name)}` : 'Gestão Central de Inventário'}</p>

                    <div class="mt-auto pt-6 border-t border-slate-50 flex items-center justify-between">
                        <span class="text-[10px] font-black text-[#2afc8d] uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Detalhes do Local</span>
                        <span class="material-symbols-outlined text-slate-300 group-hover:translate-x-1 transition-transform group-hover:text-[#2afc8d]">arrow_forward</span>
                    </div>
                </div>
                `;
    }).join('')}
        </div>
    `;

    document.getElementById("btnCreateWarehouse")?.addEventListener("click", () => openWarehouseModal());
    window.enterWarehouse = (id) => {
        currentTab = `warehouse_detail_${id}`;
        loadTabContent(currentTab);
    };
}

async function openWarehouseModal(warehouseId = null) {
    let warehouse = null;
    if (warehouseId) {
        const { items } = await apiRequest("/warehouses");
        warehouse = items.find(w => w.id === warehouseId);
    }

    const projectsRes = await apiRequest("/projects");

    const contentHtml = `
        <form id="formWarehouse" class="space-y-6 pt-4">
            <div class="space-y-2">
                <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Nome da Localização</label>
                <input type="text" name="name" value="${esc(warehouse?.name || '')}" required placeholder="Ex: Estaleiro de Coimbra" class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Tipo</label>
                    <select name="type" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700">
                        <option value="SITE" ${warehouse?.type === 'SITE' ? 'selected' : ''}>Obra / Estaleiro</option>
                        <option value="CENTRAL" ${warehouse?.type === 'CENTRAL' ? 'selected' : ''}>Armazém Central</option>
                    </select>
                </div>
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Obra Associada</label>
                    <select name="projectId" class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700">
                        <option value="">Sem obra (Geral)</option>
                        ${projectsRes.items.map(p => `<option value="${p.id}" ${warehouse?.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                    </select>
                </div>
            </div>
        </form>
    `;

    const { close } = openModal({
        title: warehouse ? "Editar Localização" : "Nova Localização",
        contentHtml,
        primaryLabel: warehouse ? "Atualizar" : "Criar Local",
        onPrimary: async ({ body }) => {
            const data = Object.fromEntries(new FormData(body.querySelector("#formWarehouse")).entries());
            if (!data.projectId) data.projectId = null;
            try {
                await apiRequest(warehouseId ? `/warehouses/${warehouseId}` : "/warehouses", {
                    method: warehouseId ? "PATCH" : "POST",
                    body: data
                });
                close();
                loadTabContent("warehouses");
            } catch (error) { alert("Erro: " + error.message); }
        }
    });
}

window.editWarehouse = (id) => openWarehouseModal(id);
window.deleteWarehouse = async (id) => {
    if (!confirm("Confirmar remoção desta localização?")) return;
    try {
        await apiRequest(`/warehouses/${id}`, { method: "DELETE" });
        loadTabContent("warehouses");
    } catch (error) { alert("Erro: Não é possível remover locais com stock ou ativos."); }
};

async function renderMovements(container) {
    const { items } = await apiRequest("/stock/movements");

    const totalEntries = items.filter(m => m.type === 'ENTRY').length;
    const totalExits = items.filter(m => m.type === 'EXIT').length;
    const totalTransfer = items.filter(m => m.type.startsWith('TRANSFER')).length;
    const totalQty = items.reduce((acc, m) => acc + parseFloat(m.quantity || 0), 0);

    const typeConfig = {
        'ENTRY': { icon: 'download', color: '#10b981', bg: '#d1fae5', label: 'Entrada de Stock', tag: 'ENTRADA' },
        'EXIT': { icon: 'upload', color: '#f59e0b', bg: '#fef3c7', label: 'Saída de Stock', tag: 'SAÍDA' },
        'TRANSFER_OUT': { icon: 'swap_horiz', color: '#3b82f6', bg: '#dbeafe', label: 'Transferência (Saída)', tag: 'TRANSF. SAÍDA' },
        'TRANSFER_IN': { icon: 'swap_horiz', color: '#6366f1', bg: '#e0e7ff', label: 'Transferência (Entrada)', tag: 'TRANSF. ENTRADA' },
        'ADJUSTMENT': { icon: 'tune', color: '#8b5cf6', bg: '#ede9fe', label: 'Ajuste de Stock', tag: 'AJUSTE' },
        'LOSS': { icon: 'remove_circle', color: '#ef4444', bg: '#fee2e2', label: 'Perda Registada', tag: 'PERDA' },
        'ASSIGNED': { icon: 'person_add', color: '#0891b2', bg: '#cffafe', label: 'Alocação de Ativo', tag: 'ALOCAÇÃO' },
        'RETURNED': { icon: 'assignment_return', color: '#7c3aed', bg: '#f5f3ff', label: 'Devolução de Ativo', tag: 'DEVOLUÇÃO' },
    };

    let html = `
        <!-- Header -->
        <div class="mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
            <div>
                <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Rastreabilidade Total</p>
                <h2 class="text-3xl font-black text-slate-900 tracking-tighter">Histórico de Atividade</h2>
            </div>
            <div class="bg-white border border-slate-100 rounded-2xl shadow-sm p-1.5 flex gap-1 flex-wrap">
                <button data-type="ALL" class="timeline-filter px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white transition-all">
                    Todos <span class="badge ml-1 bg-white/20 px-1.5 py-0.5 rounded-full">${items.length}</span>
                </button>
                <button data-type="ENTRY" class="timeline-filter px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-transparent text-slate-400 hover:bg-slate-50 transition-all">
                    Entradas <span class="badge ml-1 bg-slate-100 px-1.5 py-0.5 rounded-full">${totalEntries}</span>
                </button>
                <button data-type="EXIT" class="timeline-filter px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-transparent text-slate-400 hover:bg-slate-50 transition-all">
                    Saídas <span class="badge ml-1 bg-slate-100 px-1.5 py-0.5 rounded-full">${totalExits}</span>
                </button>
                <button data-type="TRANSFER" class="timeline-filter px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-transparent text-slate-400 hover:bg-slate-50 transition-all">
                    Transferências <span class="badge ml-1 bg-slate-100 px-1.5 py-0.5 rounded-full">${totalTransfer}</span>
                </button>
            </div>
        </div>

        <!-- KPI Strip -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div class="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
                <div class="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                    <span class="material-symbols-outlined text-emerald-500">download</span>
                </div>
                <div>
                    <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">Entradas</p>
                    <p class="text-2xl font-black text-slate-900">${totalEntries}</p>
                </div>
            </div>
            <div class="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
                <div class="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                    <span class="material-symbols-outlined text-amber-500">upload</span>
                </div>
                <div>
                    <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">Saídas</p>
                    <p class="text-2xl font-black text-slate-900">${totalExits}</p>
                </div>
            </div>
            <div class="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
                <div class="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                    <span class="material-symbols-outlined text-blue-500">swap_horiz</span>
                </div>
                <div>
                    <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">Transferências</p>
                    <p class="text-2xl font-black text-slate-900">${totalTransfer}</p>
                </div>
            </div>
            <div class="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
                <div class="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                    <span class="material-symbols-outlined text-slate-500">inventory_2</span>
                </div>
                <div>
                    <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">Unidades Total</p>
                    <p class="text-2xl font-black text-slate-900">${totalQty}</p>
                </div>
            </div>
        </div>

        <!-- Table -->
        <div class="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left">
                    <thead>
                        <tr class="bg-slate-50/70 border-b border-slate-100">
                            <th class="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400 w-28">Data / Hora</th>
                            <th class="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Tipo</th>
                            <th class="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Produto</th>
                            <th class="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Armazém</th>
                            <th class="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Utilizador</th>
                            <th class="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400 text-right">Qtd.</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-50" id="movementsTableBody">
    `;

    if (items.length === 0) {
        html += `<tr><td colspan="6" class="p-20 text-center text-slate-400 font-bold">Sem movimentos registados.</td></tr>`;
    } else {
        items.forEach(m => {
            const date = new Date(m.createdAt);
            const timeStr = date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
            const config = typeConfig[m.type] || { icon: 'history', color: '#94a3b8', bg: '#f1f5f9', label: m.type, tag: m.type };
            const isPositive = m.type === 'ENTRY' || m.type === 'TRANSFER_IN';
            const isNegative = m.type === 'EXIT' || m.type === 'TRANSFER_OUT' || m.type === 'LOSS';
            const qtyColor = isPositive ? '#10b981' : isNegative ? '#ef4444' : '#64748b';
            const qtySign = isPositive ? '+' : isNegative ? '−' : '';
            const catIsAsset = m.product.category === 'TOOL' || m.product.category === 'EQUIPMENT';
            const initials = (m.user?.name || 'S').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

            html += `
                <tr class="timeline-item hover:bg-slate-50/60 transition-colors cursor-default" data-type="${m.type}">
                    <td class="px-6 py-5 whitespace-nowrap">
                        <p class="text-xs font-black text-slate-700">${timeStr}</p>
                        <p class="text-[10px] text-slate-400 font-medium mt-0.5">${dateStr}</p>
                    </td>
                    <td class="px-6 py-5">
                        <div class="flex items-center gap-2.5">
                            <div class="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style="background:${config.bg}">
                                <span class="material-symbols-outlined text-base" style="color:${config.color}">${config.icon}</span>
                            </div>
                            <span class="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg whitespace-nowrap" style="background:${config.bg};color:${config.color}">${config.tag}</span>
                        </div>
                    </td>
                    <td class="px-6 py-5">
                        <p class="text-sm font-bold text-slate-900">${esc(m.product.name)}</p>
                        <span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${catIsAsset ? 'bg-indigo-50 text-indigo-500' : 'bg-emerald-50 text-emerald-600'}">${catIsAsset ? 'Ativo' : 'Material'}</span>
                    </td>
                    <td class="px-6 py-5">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm text-slate-300">warehouse</span>
                            <span class="text-xs font-bold text-slate-600">${esc(m.warehouse?.name || '—')}</span>
                        </div>
                        ${m.notes ? `<p class="text-[10px] text-slate-400 mt-1 italic truncate max-w-[180px]">${esc(m.notes)}</p>` : ''}
                    </td>
                    <td class="px-6 py-5">
                        <div class="flex items-center gap-2">
                            <div class="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center text-[9px] font-black">${initials}</div>
                            <span class="text-xs font-bold text-slate-600 max-w-[100px] truncate">${esc(m.user?.name || 'Sistema')}</span>
                        </div>
                    </td>
                    <td class="px-6 py-5 text-right whitespace-nowrap">
                        <span class="text-lg font-black" style="color:${qtyColor}">${qtySign}${parseFloat(m.quantity)}</span>
                        <span class="text-[9px] font-black text-slate-400 uppercase block">${esc(m.product.unit)}</span>
                    </td>
                </tr>
            `;
        });
    }

    html += `</tbody></table></div></div>`;
    container.innerHTML = html;

    // Lógica de Filtros
    const filterBtns = container.querySelectorAll(".timeline-filter");
    filterBtns.forEach(btn => {
        btn.onclick = () => {
            const type = btn.dataset.type;

            // Atualiza botões
            filterBtns.forEach(b => {
                b.classList.remove("bg-slate-900", "text-white");
                b.classList.add("bg-transparent", "text-slate-400", "hover:bg-slate-50");

                // Atualiza badge
                const badge = b.querySelector(".badge");
                if (badge) {
                    badge.classList.remove("bg-white/20");
                    badge.classList.add("bg-slate-100");
                }
            });

            // Botão Ativo
            btn.classList.remove("bg-transparent", "text-slate-400", "hover:bg-slate-50");
            btn.classList.add("bg-slate-900", "text-white");

            // Badge Ativo
            const badge = btn.querySelector(".badge");
            if (badge) {
                badge.classList.remove("bg-slate-100");
                badge.classList.add("bg-white/20");
            }

            // Filtragem
            const rows = container.querySelectorAll(".timeline-item");
            rows.forEach(row => {
                const match = type === 'ALL'
                    || row.dataset.type === type
                    || (type === 'TRANSFER' && row.dataset.type.startsWith('TRANSFER'));
                row.style.display = match ? '' : 'none';
            });
        };
    });
}





async function renderWarehouseDetail(container, warehouseId) {
    const warehouses = (await apiRequest("/warehouses")).items;
    const warehouse = warehouses.find(w => w.id === warehouseId);
    const { items: allStock } = await apiRequest(`/stock/balance?warehouseId=${warehouseId}`);
    const { items: allTools } = await apiRequest(`/items?warehouseId=${warehouseId}`);
    const { items: movements } = await apiRequest(`/stock/movements?warehouseId=${warehouseId}`);

    // FILTROS RÍGIDOS
    const stock = allStock.filter(s => s.product.category === 'MATERIAL' || s.product.category === 'CONSUMABLE');
    const assignedTools = allTools.filter(t => t.product.category === 'TOOL' || t.product.category === 'EQUIPMENT');

    const isCentral = warehouse.type === 'CENTRAL';

    container.innerHTML = `
        <div class="mb-10">
            <button onclick="window.backToWarehouses()" class="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-slate-900 uppercase tracking-widest transition-all mb-8">
                <span class="material-symbols-outlined text-lg">arrow_back</span> Voltar à Rede
            </button>
            
            <div class="flex flex-col md:flex-row justify-between items-start gap-8">
                <div class="flex items-center gap-6">
                    <div class="w-20 h-20 ${isCentral ? 'bg-slate-900 text-[#2afc8d]' : 'bg-emerald-50 text-emerald-600'} rounded-[2.5rem] flex items-center justify-center shadow-2xl shadow-slate-200">
                        <span class="material-symbols-outlined text-4xl">${isCentral ? 'warehouse' : 'construction'}</span>
                    </div>
                    <div>
                        <h4 class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">${isCentral ? 'Gestão Central' : 'Estaleiro de Obra'}</h4>
                        <h2 class="text-4xl font-black text-slate-900 tracking-tighter">${esc(warehouse.name)}</h2>
                        <p class="text-sm text-slate-400 font-medium mt-1">${warehouse.project ? `Vinculado a: ${esc(warehouse.project.name)}` : 'Operação Logística Geral'}</p>
                    </div>
                </div>
                
                <div class="flex gap-3">
                    <button onclick="window.openMovement('${warehouseId}')" class="h-12 bg-[#2afc8d] text-slate-900 px-8 rounded-2xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl shadow-[#2afc8d]/20">
                        Entrada de Stock
                    </button>
                    <button onclick="window.openTransfer('${warehouseId}')" class="h-12 bg-white text-slate-900 border border-slate-200 px-8 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-50 transition-all">
                        Transferir
                    </button>
                </div>
            </div>
        </div>

        <!-- KPIs Locais -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center gap-6">
                <div class="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><span class="material-symbols-outlined text-3xl">inventory_2</span></div>
                <div><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Stock Local</p><p class="text-3xl font-black text-slate-900">${stock.length} <span class="text-sm text-slate-300 font-bold">Artigos</span></p></div>
            </div>
            <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center gap-6">
                <div class="w-14 h-14 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center"><span class="material-symbols-outlined text-3xl">construction</span></div>
                <div><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Ferramentas</p><p class="text-3xl font-black text-slate-900">${assignedTools.length} <span class="text-sm text-slate-300 font-bold">Ativos</span></p></div>
            </div>
            <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center gap-6">
                <div class="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center"><span class="material-symbols-outlined text-3xl">swap_horiz</span></div>
                <div><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Atividade</p><p class="text-3xl font-black text-slate-900">${movements.length} <span class="text-sm text-slate-300 font-bold">Movimentos</span></p></div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-1 gap-8">
            <div class="lg:col-span-3 space-y-8">
                <!-- Materiais -->
                <div class="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-sm">
                    <div class="px-10 py-8 border-b border-slate-50 flex justify-between items-center">
                        <h3 class="text-lg font-black text-slate-900 uppercase tracking-tighter">Material de Consumo</h3>
                        <div class="flex gap-2">
                            <span class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                            <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Stock Ativo</span>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left">
                            <thead>
                                <tr class="text-[10px] font-black uppercase text-slate-400 bg-slate-50/30">
                                    <th class="px-10 py-5">Material</th>
                                    <th class="px-10 py-5 text-right">Quantidade Disponível</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-50">
                                ${stock.map(s => {
        const isLow = s.quantity < 5; // Exemplo de regra simples
        return `
                                <tr class="group hover:bg-slate-50/50 transition-colors">
                                    <td class="px-10 py-6">
                                        <div class="font-bold text-slate-900 text-base">${esc(s.product.name)}</div>
                                        <div class="text-[10px] text-slate-400 font-black uppercase tracking-wider">${esc(s.product.sku || 'N/A')}</div>
                                    </td>
                                    <td class="px-10 py-6 text-right">
                                        <div class="flex flex-col items-end">
                                            <span class="text-2xl font-black ${isLow ? 'text-amber-500' : 'text-slate-900'}">${s.quantity}</span>
                                            <span class="text-[10px] font-black text-[#2afc8d] uppercase tracking-widest">${esc(s.product.unit)}</span>
                                        </div>
                                    </td>
                                </tr>`;
    }).join('') || '<tr><td colspan="2" class="p-20 text-center text-slate-400 font-medium italic">Nenhum material registado neste local.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Ferramentas -->
                <div class="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden w-full shadow-sm mt-4">
                    <div class="px-10 py-8 border-b border-slate-50 flex justify-between items-center">
                        <h3 class="text-lg font-black text-slate-900 uppercase tracking-tighter">Controle de Ferramentas</h3>
                    </div>
                    <div class="overflow-hidden w-full">
                        <table class="w-full text-left">
                            <thead>
                                <tr class="text-[10px] font-black uppercase text-slate-400 bg-slate-50/30">
                                    <th class="px-10 py-5">Ativo / Foto</th>
                                    <th class="px-10 py-5 text-center">Quantidade</th>
                                    <th class="px-10 py-5">Estado</th>
                                    <th class="px-10 py-5">Responsável Atual</th>
                                    <th class="px-10 py-5 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-50">
                                ${(() => {
            const groups = {};
            assignedTools.forEach(t => {
                const key = `${t.productId}-${t.responsibleId || 'none'}-${t.status}`;
                if (!groups[key]) groups[key] = { ...t, quantity: 0, itemIds: [] };
                groups[key].quantity++;
                groups[key].itemIds.push(t.id);
            });

            return Object.values(groups).map(t => {
                const imgUrl = getAssetUrl(t.imageUrl || t.product.image) || 'https://placehold.co/100x100/f8fafc/cbd5e1?text=Tool';
                const statusMap = {
                    'AVAILABLE': { label: 'Em Stock', color: 'text-emerald-600 bg-emerald-50' },
                    'PENDING_RECEIPT': { label: 'Pendente Receção', color: 'text-amber-600 bg-amber-50' },
                    'ASSIGNED': { label: 'Em Obra', color: 'text-emerald-600 bg-emerald-50' },
                    'PENDING_RETURN': { label: 'Aguardando Validação', color: 'text-indigo-600 bg-indigo-50' },
                    'MAINTENANCE': { label: 'Manutenção', color: 'text-red-600 bg-red-50' }
                };
                const status = statusMap[t.status] || { label: t.status, color: 'text-slate-600 bg-slate-50' };

                return `
                                    <tr class="group hover:bg-slate-50/50 transition-colors">
                                         <td class="px-10 py-6 flex items-center gap-5">
                                            <div class="w-16 h-16 rounded-2xl overflow-hidden bg-slate-100 border border-slate-100 shadow-sm transition-transform group-hover:scale-105">
                                                <img src="${imgUrl}" class="w-full h-full object-cover">
                                            </div>
                                            <div>
                                                <div class="font-bold text-slate-900 text-base">${esc(t.product.name)}</div>
                                                <div class="text-[10px] text-slate-400 font-black uppercase tracking-widest">Modelo: ${esc(t.product.sku || '---')}</div>
                                            </div>
                                        </td>
                                        <td class="px-10 py-6 text-center">
                                            <span class="text-xl font-black text-slate-900">x${t.quantity}</span>
                                        </td>
                                        <td class="px-10 py-6">
                                            <span class="px-3 py-1 ${status.color} rounded-lg text-[9px] font-black uppercase tracking-widest">
                                                ${status.label}
                                            </span>
                                        </td>
                                        <td class="px-10 py-6">
                                            <div class="flex items-center gap-3">
                                                <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-black text-[10px] tracking-tighter">
                                                    ${(t.responsible?.name || '??').slice(0, 2).toUpperCase()}
                                                </div>
                                                <div class="flex flex-col">
                                                    <span class="text-sm font-bold text-slate-700">${esc(t.responsible?.name || 'Indefinido')}</span>
                                                    <span class="text-[9px] text-slate-400 font-bold italic">${t.assignedAt ? 'Desde ' + new Date(t.assignedAt).toLocaleDateString() : ''}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td class="px-10 py-6 text-right">
                                            <button onclick="window.requestReturnGroup('${t.itemIds.join(',')}')" class="h-10 px-6 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all">
                                                Devolver
                                            </button>
                                        </td>
                                    </tr>
                                    `;
            }).join('') || '<tr><td colspan="4" class="p-20 text-center text-slate-400 font-medium italic">Nenhum ativo alocado a este local.</td></tr>';
        })()}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Sidebar Informativa -->
            <div class="space-y-8">
                <div class="bg-[#0F172A] rounded-[2.5rem] p-10 text-white shadow-2xl shadow-slate-300 relative overflow-hidden">
                    <div class="absolute bottom-0 right-0 w-32 h-32 bg-white/5 rounded-full -mb-16 -mr-16"></div>
                    <h4 class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-10">Ficha Informativa</h4>
                    <div class="space-y-10 relative">
                        <div class="flex items-start gap-4">
                            <span class="material-symbols-outlined text-[#2afc8d] mt-1">info</span>
                            <div>
                                <p class="text-[10px] font-black text-slate-500 uppercase mb-1">Tipo de Localização</p>
                                <p class="font-bold text-lg">${esc(warehouse.type)}</p>
                            </div>
                        </div>
                        ${warehouse.project ? `
                        <div class="flex items-start gap-4">
                            <span class="material-symbols-outlined text-blue-400 mt-1">location_city</span>
                            <div>
                                <p class="text-[10px] font-black text-slate-500 uppercase mb-1">Obra Associada</p>
                                <p class="font-bold text-lg text-[#2afc8d]">${esc(warehouse.project.name)}</p>
                            </div>
                        </div>
                        ` : ''}
                        <div class="flex items-start gap-4 pb-10">
                            <span class="material-symbols-outlined text-amber-400 mt-1">calendar_today</span>
                            <div>
                                <p class="text-[10px] font-black text-slate-500 uppercase mb-1">Última Atividade</p>
                                <p class="font-bold text-lg">${movements.length > 0 ? new Date(movements[0].createdAt).toLocaleDateString() : 'Sem registos'}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="mt-16 p-3 bg-white/5 rounded-3xl border border-white/10">
                        <p class="text-[10px] font-black text-slate-400 uppercase mb-4 text-center">Status da Operação</p>
                        <div class="flex justify-center items-center gap-3">
                            <div class="w-3 h-3 bg-emerald-500 rounded-full animate-ping"></div>
                            <span class="font-black text-xs uppercase tracking-widest text-[#2afc8d]">Ativo & Seguro</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    window.backToWarehouses = () => { currentTab = "warehouses"; loadTabContent(currentTab); };
    window.openMovement = (id) => openMovementModal("ENTRY", id);
    window.openTransfer = (id) => openTransferModal(id);

    window.returnTool = async (itemId) => {
        if (!confirm("Confirmar devolução da ferramenta ao Armazém Central?")) return;
        try {
            const warehouses = (await apiRequest("/warehouses")).items;
            const central = warehouses.find(w => w.type === 'CENTRAL');
            await apiRequest(`/items/${itemId}/assign`, {
                method: "PATCH",
                body: {
                    status: "AVAILABLE",
                    warehouseId: central?.id || null,
                    projectId: null,
                    responsibleId: null
                }
            });
            loadTabContent(currentTab);
        } catch (error) { alert("Erro ao devolver: " + error.message); }
    };
}

async function openMovementModal(type = "ENTRY", defaultWarehouseId = null) {
    const productsRes = await apiRequest("/products");
    const warehousesRes = await apiRequest("/warehouses");
    const clientsRes = await apiRequest("/clients");

    const materials = productsRes.items.filter(p => p.category === 'MATERIAL' || p.category === 'CONSUMABLE');
    const tools = productsRes.items.filter(p => p.category === 'TOOL' || p.category === 'EQUIPMENT');

    const contentHtml = `
        <form id="formMovement" class="space-y-6 pt-4">
            <input type="hidden" name="type" value="${type}">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Produto / Material</label>
                    <select name="productId" id="movementProductId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                        <option value="">Selecionar...</option>
                        <optgroup label="Materiais de Consumo">
                            ${materials.map(p => `<option value="${p.id}" data-category="${p.category}">${esc(p.name)} (${p.unit})</option>`).join('')}
                        </optgroup>
                        <optgroup label="Ferramentas">
                            ${tools.map(p => `<option value="${p.id}" data-category="${p.category}">${esc(p.name)} (${p.unit})</option>`).join('')}
                        </optgroup>
                    </select>
                </div>
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Armazém Destino</label>
                    <select name="warehouseId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                        ${warehousesRes.items.map(w => `<option value="${w.id}" ${w.id === defaultWarehouseId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
                    </select>
                </div>
            </div>
            
            <div id="assetNotice" class="hidden p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
                <div class="flex gap-3 text-indigo-600">
                    <span class="material-symbols-outlined">info</span>
                    <p class="text-[10px] font-bold uppercase tracking-widest">Aviso: Este produto é um Ativo. Recomendamos o registo na aba "Ferramentas" para controlo individual.</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Quantidade</label>
                    <input type="number" name="quantity" step="0.01" required placeholder="0.00" class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                </div>
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Proprietário</label>
                    <select name="ownerId" class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                        <option value="">Empresa (Próprio)</option>
                        ${clientsRes.items.map(c => `<option value="${c.id}">Cliente: ${esc(c.name)}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div class="space-y-2">
                <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Foto de Evidência / Ativo</label>
                <input type="file" name="photo" accept="image/*" capture="environment" class="w-full bg-slate-50 border-none rounded-2xl p-4 text-xs font-bold text-slate-400">
            </div>
        </form>
    `;

    const { close } = openModal({
        title: type === "ENTRY" ? "Entrada de Material" : "Saída de Material",
        contentHtml,
        primaryLabel: "Registar",
        onPrimary: async ({ body }) => {
            const formData = new FormData(body.querySelector("#formMovement"));
            try {
                await apiUpload("/stock/move", formData, "POST");
                close();
                loadTabContent(currentTab);
            } catch (error) {
                const msg = error.data?.message || error.message;
                alert("Erro ao registar movimento: " + msg);
            }
        }
    });

    // Lógica para mostrar aviso se for Ativo
    document.getElementById("movementProductId")?.addEventListener("change", (e) => {
        const option = e.target.selectedOptions[0];
        const category = option.dataset.category;
        const notice = document.getElementById("assetNotice");
        if (category === 'TOOL' || category === 'EQUIPMENT') {
            notice.classList.remove("hidden");
        } else {
            notice.classList.add("hidden");
        }
    });
}

async function openTransferModal(fromWarehouseId = null) {
    const warehousesRes = await apiRequest("/warehouses");

    const contentHtml = `
        <form id="formTransfer" class="space-y-6 pt-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Origem</label>
                    <select name="fromWarehouseId" id="transferFromId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                        <option value="">Selecionar origem...</option>
                        ${warehousesRes.items.map(w => `<option value="${w.id}" ${w.id === fromWarehouseId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Destino</label>
                    <select name="toWarehouseId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                        <option value="">Selecionar destino...</option>
                        ${warehousesRes.items.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div class="space-y-2">
                <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Produto a Transferir</label>
                <select name="productId" id="transferProductId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                    <option value="">Selecione primeiro a origem...</option>
                </select>
            </div>

            <div class="space-y-2">
                <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Quantidade</label>
                <input type="number" name="quantity" step="0.01" required placeholder="0.00" class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
            </div>
        </form>
    `;

    const { close } = openModal({
        title: "Transferência entre Armazéns",
        contentHtml,
        primaryLabel: "Confirmar",
        onPrimary: async ({ body }) => {
            const data = Object.fromEntries(new FormData(body.querySelector("#formTransfer")).entries());
            data.quantity = parseFloat(data.quantity);
            try {
                await apiRequest("/stock/transfer", { method: "POST", body: data });
                close();
                loadTabContent(currentTab);
            } catch (error) { alert("Erro: " + error.message); }
        }
    });

    // Lógica para carregar produtos do stock da origem selecionada
    const fromSelect = document.getElementById("transferFromId");
    const productSelect = document.getElementById("transferProductId");

    const updateProducts = async (wId) => {
        if (!wId) {
            productSelect.innerHTML = '<option value="">Selecione primeiro a origem...</option>';
            return;
        }
        productSelect.innerHTML = '<option value="">A carregar stock...</option>';
        try {
            const { items: stock } = await apiRequest(`/stock/balance?warehouseId=${wId}`);
            // Filtrar apenas o que tem quantidade > 0 e é material/consumível
            const available = stock.filter(s => s.quantity > 0 && (s.product.category === 'MATERIAL' || s.product.category === 'CONSUMABLE'));

            if (available.length === 0) {
                productSelect.innerHTML = '<option value="">Nenhum material disponível neste armazém</option>';
            } else {
                productSelect.innerHTML = `
                    <option value="">Selecionar material...</option>
                    ${available.map(s => `<option value="${s.product.id}">${esc(s.product.name)} (${s.quantity} em stock)</option>`).join('')}
                `;
            }
        } catch (e) {
            productSelect.innerHTML = '<option value="">Erro ao carregar stock</option>';
        }
    };

    fromSelect.addEventListener("change", (e) => updateProducts(e.target.value));

    // Se já vier com armazém de origem, carregar logo
    if (fromWarehouseId) updateProducts(fromWarehouseId);
}

window.confirmReceipt = async (id) => {
    if (!confirm("Confirmar que recebeu esta ferramenta em boas condições?")) return;
    try {
        await apiRequest(`/items/${id}/confirm-receipt`, { method: "PATCH" });
        loadTabContent("tools");
    } catch (error) { alert("Erro ao confirmar: " + error.message); }
};

window.requestReturn = async (id) => {
    const notes = prompt("Observações sobre o estado da ferramenta (opcional):");
    if (notes === null) return;
    try {
        await apiRequest(`/items/${id}/request-return`, {
            method: "PATCH",
            body: { notes }
        });
        loadTabContent("tools");
    } catch (error) { alert("Erro ao solicitar devolução: " + error.message); }
};

window.confirmReturn = async (id) => {
    const warehousesRes = await apiRequest("/warehouses");
    const centralWarehouses = warehousesRes.items.filter(w => w.type === 'CENTRAL');

    const contentHtml = `
        <div class="space-y-6 pt-4">
            <div class="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                <p class="text-[10px] font-black text-indigo-400 uppercase mb-1">Validação de Devolução</p>
                <p class="text-xs text-indigo-900 leading-relaxed">Confirme que a ferramenta foi entregue no armazém e está em condições de voltar ao stock disponível.</p>
            </div>

            <form id="formConfirmReturn" class="space-y-4">
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Armazém de Destino</label>
                    <select name="warehouseId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700">
                        ${centralWarehouses.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}
                    </select>
                </div>
            </form>
        </div>
    `;

    const { close } = openModal({
        title: "Validar Regresso ao Stock",
        contentHtml,
        primaryLabel: "Confirmar e Finalizar",
        onPrimary: async ({ body }) => {
            const data = Object.fromEntries(new FormData(body.querySelector("#formConfirmReturn")).entries());
            try {
                await apiRequest(`/items/${id}/confirm-return`, {
                    method: "PATCH",
                    body: data
                });
                close();
                loadTabContent("tools");
            } catch (error) { alert("Erro ao validar: " + error.message); }
        }
    });
};

window.confirmReceiptGroup = async (idsStr) => {
    const ids = idsStr.split(',');
    const warehousesRes = await apiRequest("/warehouses");
    const centralWarehouses = warehousesRes.items.filter(w => w.type === 'CENTRAL');

    const contentHtml = `
        <div class="space-y-6 pt-4">
            <div class="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                <p class="text-[10px] font-black text-amber-500 uppercase mb-1">Inspeção de Receção</p>
                <p class="text-xs text-amber-900 leading-relaxed">Indique quantas unidades estão em boas condições. As unidades rejeitadas voltarão ao armazém para manutenção.</p>
            </div>

            <form id="formConfirmReceiptGroup" class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Quantidade OK</label>
                        <input type="number" name="qtyOk" min="0" max="${ids.length}" value="${ids.length}" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d]">
                    </div>
                    <div class="space-y-2 text-right">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Total Pendente</label>
                        <p class="text-2xl font-black text-slate-900 p-2">${ids.length}</p>
                    </div>
                </div>

                <div id="rejectSection" class="hidden space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div class="space-y-2">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Motivo da Rejeição</label>
                        <textarea name="rejectNote" placeholder="Ex: Cabo partido, sem bateria..." class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-red-400 min-h-[100px]"></textarea>
                    </div>
                    <div class="space-y-2">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Devolver para</label>
                        <select name="returnWarehouseId" class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700">
                            ${centralWarehouses.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </form>
        </div>
    `;

    const { close } = openModal({
        title: "Confirmar Receção de Ativos",
        contentHtml,
        primaryLabel: "Finalizar Receção",
        onPrimary: async ({ body }) => {
            const data = Object.fromEntries(new FormData(body.querySelector("#formConfirmReceiptGroup")).entries());
            const qtyOk = parseInt(data.qtyOk);
            const qtyReject = ids.length - qtyOk;

            try {
                // 1. Confirmar os que estão OK
                const idsOk = ids.slice(0, qtyOk);
                for (const id of idsOk) {
                    await apiRequest(`/items/${id}/confirm-receipt`, { method: "PATCH" });
                }

                // 2. Rejeitar os que estão mal
                if (qtyReject > 0) {
                    const idsReject = ids.slice(qtyOk);
                    for (const id of idsReject) {
                        // Forçar regresso ao armazém central com estado MAINTENANCE
                        await apiRequest(`/items/${id}/confirm-return`, {
                            method: "PATCH",
                            body: {
                                warehouseId: data.returnWarehouseId,
                                status: "MAINTENANCE",
                                notes: data.rejectNote || "Rejeitado na receção: Sem condição de uso"
                            }
                        });
                    }
                }

                close();
                loadTabContent("tools");
            } catch (error) { alert("Erro na receção: " + error.message); }
        }
    });

    // Lógica para mostrar secção de rejeição se a quantidade for menor
    const form = document.getElementById("formConfirmReceiptGroup");
    const qtyInput = form.querySelector('input[name="qtyOk"]');
    const rejectSection = document.getElementById("rejectSection");

    qtyInput.addEventListener("input", (e) => {
        const val = parseInt(e.target.value) || 0;
        if (val < ids.length) {
            rejectSection.classList.remove("hidden");
        } else {
            rejectSection.classList.add("hidden");
        }
    });
};

window.requestReturnGroup = async (idsStr) => {
    const ids = idsStr.split(',');
    const { items: receivers } = await apiRequest("/users/receivers");
    const { items: warehouses } = await apiRequest("/warehouses");
    const centralWarehouses = warehouses.filter(w => w.type === 'CENTRAL');

    const contentHtml = `
        <div class="space-y-6 pt-4">
            <div class="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-4">
                <div class="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-slate-900 shadow-sm">
                    <span class="material-symbols-outlined text-2xl">assignment_return</span>
                </div>
                <div>
                    <p class="text-[10px] font-black text-slate-400 uppercase mb-1">Solicitar Devolução</p>
                    <p class="text-xs text-slate-900 leading-relaxed">Indique o armazém de destino e o responsável pela receção.</p>
                </div>
            </div>

            <form id="formRequestReturnGroup" class="space-y-4">
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Armazém de Destino</label>
                    <select name="targetWarehouseId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500">
                        ${centralWarehouses.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Responsável pela Receção</label>
                    <select name="responsibleId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500">
                        <option value="">Selecionar destinatário...</option>
                        ${receivers.map(u => `<option value="${u.id}">${esc(u.name)} (${u.email})</option>`).join('')}
                    </select>
                </div>
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Observações (Opcional)</label>
                    <textarea name="notes" placeholder="Ex: Equipamento com desgaste no cabo..." class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 min-h-[80px]"></textarea>
                </div>
            </form>
        </div>
    `;

    const { close } = openModal({
        title: "Devolver para Sede",
        contentHtml,
        primaryLabel: "Enviar para Validação",
        onPrimary: async ({ body }) => {
            const data = Object.fromEntries(new FormData(body.querySelector("#formRequestReturnGroup")).entries());
            try {
                for (const id of ids) {
                    await apiRequest(`/items/${id}`, {
                        method: "PATCH",
                        body: {
                            status: "PENDING_RETURN",
                            responsibleId: data.responsibleId,
                            targetWarehouseId: data.targetWarehouseId,
                            lastStatusNote: data.notes
                        }
                    });
                }
                close();
                loadTabContent("tools");
                if (currentTab.startsWith("warehouse_detail_")) {
                    const wid = currentTab.replace("warehouse_detail_", "");
                    enterWarehouse(wid);
                }
            } catch (error) { alert("Erro ao solicitar devolução: " + error.message); }
        }
    });
};

window.confirmReturnGroup = async (idsStr) => {
    const ids = idsStr.split(',');
    const warehousesRes = await apiRequest("/warehouses");
    const centralWarehouses = warehousesRes.items.filter(w => w.type === 'CENTRAL');

    const contentHtml = `
        <div class="space-y-6 pt-4">
            <div class="p-4 bg-indigo-50 rounded-2xl border border-indigo-100 flex items-center gap-4">
                <div class="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-indigo-500 shadow-sm">
                    <span class="material-symbols-outlined text-2xl">assignment_return</span>
                </div>
                <div>
                    <p class="text-[10px] font-black text-indigo-400 uppercase mb-1">Validação de Regresso</p>
                    <p class="text-xs text-indigo-900 leading-relaxed">Confira o estado das ${ids.length} unidades que estão a regressar.</p>
                </div>
            </div>

            <form id="formConfirmReturnGroup" class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Quantidade em Bom Estado</label>
                        <input type="number" name="qtyOk" min="0" max="${ids.length}" value="${ids.length}" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d]">
                    </div>
                    <div class="space-y-2 text-right">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Total a Devolver</label>
                        <p class="text-2xl font-black text-slate-900 p-2">${ids.length}</p>
                    </div>
                </div>

                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Armazém de Destino</label>
                    <select name="warehouseId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700">
                        ${centralWarehouses.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}
                    </select>
                </div>

                <div id="returnRejectSection" class="hidden space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div class="space-y-2">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Notas de Manutenção (para as unidades danificadas)</label>
                        <textarea name="rejectNote" placeholder="Ex: Desgaste excessivo, precisa de reparação..." class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-red-400 min-h-[80px]"></textarea>
                    </div>
                </div>
            </form>
        </div>
    `;

    const { close } = openModal({
        title: "Validar Regresso de Ativos",
        contentHtml,
        primaryLabel: "Finalizar Devolução",
        onPrimary: async ({ body }) => {
            const data = Object.fromEntries(new FormData(body.querySelector("#formConfirmReturnGroup")).entries());
            const qtyOk = parseInt(data.qtyOk);
            const qtyReject = ids.length - qtyOk;

            try {
                // 1. Unidades que voltam como AVAILABLE
                const idsOk = ids.slice(0, qtyOk);
                for (const id of idsOk) {
                    await apiRequest(`/items/${id}/confirm-return`, {
                        method: "PATCH",
                        body: {
                            warehouseId: data.warehouseId,
                            status: "AVAILABLE",
                            notes: "Devolução confirmada: Bom estado"
                        }
                    });
                }

                // 2. Unidades que voltam como MAINTENANCE
                if (qtyReject > 0) {
                    const idsReject = ids.slice(qtyOk);
                    for (const id of idsReject) {
                        await apiRequest(`/items/${id}/confirm-return`, {
                            method: "PATCH",
                            body: {
                                warehouseId: data.warehouseId,
                                status: "MAINTENANCE",
                                notes: data.rejectNote || "Devolução confirmada: Necessita manutenção"
                            }
                        });
                    }
                }

                close();
                loadTabContent("tools");
                if (currentTab.startsWith("warehouse_detail_")) {
                    const wid = currentTab.replace("warehouse_detail_", "");
                    enterWarehouse(wid);
                }
            } catch (error) { alert("Erro ao validar regresso: " + error.message); }
        }
    });

    const form = document.getElementById("formConfirmReturnGroup");
    const qtyInput = form.querySelector('input[name="qtyOk"]');
    const rejectSection = document.getElementById("returnRejectSection");

    qtyInput.addEventListener("input", (e) => {
        const val = parseInt(e.target.value) || 0;
        if (val < ids.length) {
            rejectSection.classList.remove("hidden");
        } else {
            rejectSection.classList.add("hidden");
        }
    });
};

window.viewPendingReceipts = async (warehouseId) => {
    const { items: allItems } = await apiRequest("/items");
    const pending = allItems.filter(i => i.targetWarehouseId === warehouseId && (i.status === 'PENDING_RECEIPT' || i.status === 'PENDING_RETURN'));
    const { items: warehouses } = await apiRequest("/warehouses");
    const w = warehouses.find(wh => wh.id === warehouseId);

    // Agrupar por produto e tipo (Receção vs Regresso)
    const groups = {};
    pending.forEach(item => {
        const key = `${item.productId}-${item.status}`;
        if (!groups[key]) groups[key] = { ...item, quantity: 0, itemIds: [] };
        groups[key].quantity++;
        groups[key].itemIds.push(item.id);
    });

    const contentHtml = `
        <div class="space-y-6 pt-4">
            <div class="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-center gap-4">
                <div class="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-amber-500 shadow-sm">
                    <span class="material-symbols-outlined text-2xl">local_shipping</span>
                </div>
                <div>
                    <p class="text-[10px] font-black text-amber-500 uppercase tracking-widest">A Caminho de</p>
                    <p class="text-sm font-black text-amber-900">${esc(w?.name || 'Armazém')}</p>
                </div>
            </div>

            <div class="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                ${Object.values(groups).map(g => {
        const isReturn = g.status === 'PENDING_RETURN';
        const actionFn = isReturn ? 'window.confirmReturnGroup' : 'window.confirmReceiptGroup';
        const actionLabel = isReturn ? 'Validar Regresso' : 'Receber';
        const icon = isReturn ? 'assignment_return' : 'check';
        const btnStyle = isReturn
            ? 'background:#4f46e5;color:#fff;'
            : 'background:#0f172a;color:#fff;';
        const badgeStyle = isReturn
            ? 'background:#eef2ff;color:#6366f1;'
            : 'background:#fffbeb;color:#d97706;';

        return `
                    <div class="bg-white rounded-2xl border border-slate-100 p-4 flex items-center justify-between group hover:border-[#2afc8d] transition-all">
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 bg-slate-50 rounded-xl overflow-hidden">
                                <img src="${getAssetUrl(g.product.image) || 'https://placehold.co/100x100?text=Tool'}" class="w-full h-full object-contain">
                            </div>
                            <div>
                                <div class="flex items-center gap-2">
                                    <h4 class="text-xs font-black text-slate-900 uppercase tracking-tight">${esc(g.product.name)}</h4>
                                    <span style="${badgeStyle}" class="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest">
                                        ${isReturn ? 'Devolução' : 'Entrega'}
                                    </span>
                                </div>
                                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Qtd: ${g.quantity}</p>
                            </div>
                        </div>
                        <button onclick="${actionFn}('${g.itemIds.join(',')}')" style="${btnStyle}" class="h-9 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 hover:opacity-80">
                            <span class="material-symbols-outlined text-sm">${icon}</span> ${actionLabel}
                        </button>
                    </div>
                `;
    }).join('')}
                ${pending.length === 0 ? '<p class="text-center py-10 text-slate-400 font-bold text-sm">Não há ferramentas pendentes para este local.</p>' : ''}
            </div>
        </div>
    `;

    openModal({
        title: "Ferramentas a Caminho",
        contentHtml,
        showPrimary: false,
        secondaryLabel: "Fechar"
    });
};
