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
            ${renderTable(materials, "Materiais & Consumíveis", "bg-emerald-50 text-emerald-600")}
            ${renderTable(tools, "Ativos & Ferramentas", "bg-indigo-50 text-indigo-600")}
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
    const { items: allItems } = await apiRequest("/items");
    // FILTRO: Apenas produtos que sejam ferramentas ou equipamentos
    const items = allItems.filter(i => i.product.category === 'TOOL' || i.product.category === 'EQUIPMENT');

    const available = items.filter(i => i.status === 'AVAILABLE').length;
    const assigned = items.filter(i => i.status === 'ASSIGNED').length;
    const maintenance = items.filter(i => i.status === 'MAINTENANCE').length;

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
        if (i.status === 'AVAILABLE') toolGroups[i.productId].available++;
        else if (i.status === 'ASSIGNED') toolGroups[i.productId].assigned++;
        else if (i.status === 'MAINTENANCE') toolGroups[i.productId].maintenance++;
    });

    window.openBulkAssign = async (productId) => {
        const product = items.find(i => i.productId === productId)?.product;
        const availableItems = items.filter(i => i.productId === productId && i.status === 'AVAILABLE');
        const usersRes = await apiRequest("/users");
        const warehousesRes = await apiRequest("/warehouses");

        const contentHtml = `
            <div class="space-y-6 pt-4">
                <div class="bg-slate-50 p-6 rounded-3xl border border-slate-100 flex items-center gap-4">
                    <div class="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                        <span class="material-symbols-outlined text-slate-400">construction</span>
                    </div>
                    <div>
                        <h4 class="font-bold text-slate-900">${esc(product?.name)}</h4>
                        <p class="text-[10px] font-black text-emerald-500 uppercase tracking-widest">${availableItems.length} Unidades Disponíveis</p>
                    </div>
                </div>

                <form id="formBulkAssign" class="space-y-4">
                    <div class="space-y-2">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Quantidade a Entregar</label>
                        <input type="number" name="qty" min="1" max="${availableItems.length}" value="1" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                    </div>
                    <div class="space-y-2">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Entregar a (Responsável)</label>
                        <select name="responsibleId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                            <option value="">Selecionar funcionário...</option>
                            ${usersRes.items.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="space-y-2">
                        <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Local de Destino (Obra/Estaleiro)</label>
                        <select name="warehouseId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                            <option value="">Selecionar local...</option>
                            ${warehousesRes.items.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}
                        </select>
                    </div>
                </form>
            </div>
        `;

        const { close } = openModal({
            title: "Entrega em Lote de Ferramentas",
            contentHtml,
            primaryLabel: "Confirmar Entrega",
            onPrimary: async ({ body }) => {
                const formData = new FormData(body.querySelector("#formBulkAssign"));
                const qty = parseInt(formData.get("qty"));
                const responsibleId = formData.get("responsibleId");
                const warehouseId = formData.get("warehouseId");

                const toAssign = availableItems.slice(0, qty);

                try {
                    for (const item of toAssign) {
                        await apiRequest(`/items/${item.id}/assign`, {
                            method: "PATCH",
                            body: {
                                status: "ASSIGNED",
                                responsibleId,
                                warehouseId,
                                projectId: warehousesRes.items.find(w => w.id === warehouseId)?.projectId || null
                            }
                        });
                    }
                    close();
                    loadTabContent("tools");
                } catch (error) { alert("Erro ao atribuir: " + error.message); }
            }
        });
    };

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
                        <button onclick="window.openBulkAssign('${g.product.id}')" class="h-10 px-4 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all ${g.available === 0 ? 'opacity-30 pointer-events-none' : ''}">
                            Entregar
                        </button>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="flex flex-wrap gap-2 mb-10">
            <button data-status="ALL" class="tool-filter-btn px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white transition-all">Individual (Todos)</button>
            <button data-status="AVAILABLE" class="tool-filter-btn px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-400 hover:bg-slate-50 transition-all">Disponíveis (${available})</button>
            <button data-status="ASSIGNED" class="tool-filter-btn px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-400 hover:bg-slate-50 transition-all">Em Obra (${assigned})</button>
            <button data-status="MAINTENANCE" class="tool-filter-btn px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-400 hover:bg-slate-50 transition-all">Manutenção (${maintenance})</button>
        </div>

        <div id="toolsGrid" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
    `;

    if (items.length === 0) {
        container.innerHTML = `<div class="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-20 text-center col-span-full"><span class="material-symbols-outlined text-5xl text-slate-300 mb-4">construction</span><p class="text-slate-500 font-bold">Nenhuma ferramenta registada.</p></div>`;
        return;
    }

    items.forEach(item => {
        const statusMap = {
            'AVAILABLE': { label: 'Disponível', color: 'bg-emerald-500' },
            'ASSIGNED': { label: 'Em Obra', color: 'bg-yellow-500' },
            'MAINTENANCE': { label: 'Manutenção', color: 'bg-red-500' }
        };
        const status = statusMap[item.status] || { label: item.status, color: 'bg-slate-500' };

        const imgUrl = getAssetUrl(item.imageUrl || item.product.image) || 'https://placehold.co/400x300/f8fafc/cbd5e1?text=Ferramenta';

        html += `
            <div class="tool-card bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-all group flex flex-col h-full" 
                 data-status="${item.status}" 
                 data-search="${esc(item.product.name.toLowerCase())} ${esc((item.serialNumber || '').toLowerCase())}">
                <div class="h-32 overflow-hidden bg-slate-50 relative border-b border-slate-100">
                    <img src="${imgUrl}" alt="${esc(item.product.name)}" class="w-full h-full object-cover group-hover:scale-110 transition-all duration-500">
                    <div class="absolute top-2 right-2 px-2 py-1 ${status.color} text-white rounded-lg text-[8px] font-black uppercase tracking-widest shadow-lg">
                        ${status.label}
                    </div>
                </div>
                <div class="p-4 flex flex-col flex-grow">
                    <h3 class="font-bold text-slate-900 text-xs mb-0.5 line-clamp-1">${esc(item.product.name)}</h3>
                    <p class="text-[9px] font-black text-slate-400 uppercase tracking-tighter mb-3">S/N: ${esc(item.serialNumber || '---')}</p>
                    
                    <div class="space-y-1.5 mb-4 flex-grow">
                        <div class="flex items-center gap-2 text-slate-500">
                            <span class="material-symbols-outlined text-[14px]">location_on</span>
                            <span class="text-[10px] font-bold truncate">${esc(item.warehouse?.name || '---')}</span>
                        </div>
                        <div class="flex items-center gap-2 text-slate-500">
                            <span class="material-symbols-outlined text-[14px]">person</span>
                            <span class="text-[10px] font-bold truncate">${esc(item.responsible?.name || 'Livre')}</span>
                        </div>
                    </div>

                    <div class="flex gap-2">
                        <button onclick="window.openAssignModal('${item.id}')" class="flex-1 h-8 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all">
                            Entregar
                        </button>
                        <button onclick="window.editTool('${item.id}')" class="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center">
                            <span class="material-symbols-outlined text-base">edit</span>
                        </button>
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
            const matchesStatus = currentFilter === 'ALL' || card.dataset.status === currentFilter;
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
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Estado</label>
                    <select name="status" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                        <option value="AVAILABLE" ${tool?.status === 'AVAILABLE' ? 'selected' : ''}>Disponível</option>
                        <option value="ASSIGNED" ${tool?.status === 'ASSIGNED' ? 'selected' : ''}>Em Obra</option>
                        <option value="MAINTENANCE" ${tool?.status === 'MAINTENANCE' ? 'selected' : ''}>Manutenção</option>
                    </select>
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

window.openAssignModal = async (toolOrId) => {
    let tool = toolOrId;
    if (typeof toolOrId === 'string') {
        const { items } = await apiRequest("/items");
        tool = items.find(i => i.id === toolOrId);
    }

    if (!tool) return alert("Erro: Ativo não encontrado.");

    const resRes = await apiRequest("/users");
    const projectsRes = await apiRequest("/projects");
    const warehousesRes = await apiRequest("/warehouses");

    const contentHtml = `
        <form id="formAssign" class="space-y-6 pt-4">
            <div class="p-4 bg-blue-50 rounded-2xl border border-blue-100 mb-6">
                <p class="text-[10px] font-black text-blue-400 uppercase mb-1">A Alocar</p>
                <p class="font-bold text-blue-900">${esc(tool.product.name)} <span class="text-xs opacity-50">(${esc(tool.serialNumber || 'SN/N')})</span></p>
            </div>
            
            <div class="space-y-2">
                <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Responsável (Técnico)</label>
                <select name="responsibleId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700">
                    <option value="">Selecionar...</option>
                    ${resRes.items.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
                </select>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Projeto / Obra</label>
                    <select name="projectId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700">
                        <option value="">Selecionar...</option>
                        ${projectsRes.items.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Armazém Destino</label>
                    <select name="warehouseId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700">
                        ${warehousesRes.items.filter(w => w.type === 'SITE').map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}
                    </select>
                </div>
            </div>
        </form>
    `;

    const { close } = openModal({
        title: "Alocar Ferramenta",
        contentHtml,
        primaryLabel: "Confirmar Entrega",
        onPrimary: async ({ body }) => {
            const data = Object.fromEntries(new FormData(body.querySelector("#formAssign")).entries());
            try {
                await apiRequest(`/items/${tool.id}/assign`, {
                    method: "PATCH",
                    body: { ...data, status: "ASSIGNED" }
                });
                close();
                loadTabContent("tools");
            } catch (error) { alert("Erro: " + error.message); }
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

        const isCentral = w.type === 'CENTRAL';

        return `
                <div onclick="window.enterWarehouse('${w.id}')" class="bg-white rounded-3xl border border-slate-200 p-8 hover:border-[#2afc8d] hover:shadow-xl hover:-translate-y-1 cursor-pointer transition-all group relative overflow-hidden flex flex-col h-full">
                    <div class="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full -mr-16 -mt-16 group-hover:bg-[#2afc8d]/5 transition-colors"></div>
                    
                    <div class="flex justify-between items-start mb-8 relative">
                        <div class="w-14 h-14 ${isCentral ? 'bg-slate-900 text-[#2afc8d]' : 'bg-emerald-50 text-emerald-600'} rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110">
                            <span class="material-symbols-outlined text-3xl">${isCentral ? 'warehouse' : 'construction'}</span>
                        </div>
                        <div class="flex gap-1">
                            <button onclick="event.stopPropagation(); window.editWarehouse('${w.id}')" class="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition-all">
                                <span class="material-symbols-outlined text-base">edit</span>
                            </button>
                            <button onclick="event.stopPropagation(); window.deleteWarehouse('${w.id}')" class="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition-all">
                                <span class="material-symbols-outlined text-base">delete</span>
                            </button>
                        </div>
                    </div>

                    <h3 class="text-xl font-bold text-slate-900 mb-1 group-hover:text-emerald-700 transition-colors">${esc(w.name)}</h3>
                    <p class="text-xs text-slate-400 font-medium mb-8 line-clamp-1">${w.project ? `Obra: ${esc(w.project.name)}` : 'Gestão Central de Inventário'}</p>

                    <div class="grid grid-cols-2 gap-4 mb-8">
                        <div class="bg-slate-50 rounded-2xl p-4 group-hover:bg-white group-hover:ring-1 group-hover:ring-slate-100 transition-all">
                            <p class="text-[9px] font-black text-slate-400 uppercase mb-1">Stock</p>
                            <p class="text-2xl font-black text-slate-900">${totalStockQty}</p>
                            <p class="text-[9px] font-bold text-slate-400 uppercase">Unidades</p>
                        </div>
                        <div class="bg-slate-50 rounded-2xl p-4 group-hover:bg-white group-hover:ring-1 group-hover:ring-slate-100 transition-all">
                            <p class="text-[9px] font-black text-slate-400 uppercase mb-1">Ativos</p>
                            <p class="text-2xl font-black text-slate-900">${toolCount}</p>
                            <p class="text-[9px] font-bold text-slate-400 uppercase">Ferramentas</p>
                        </div>
                    </div>

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

    let html = `
        <div class="mb-10 flex justify-between items-end">
            <div>
                <h3 class="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-1">Rastreabilidade Total</h3>
                <h2 class="text-3xl font-black text-slate-900 tracking-tighter">Histórico de Atividade</h2>
            </div>
            <div class="bg-white p-2 rounded-2xl border border-slate-100 shadow-sm flex gap-1">
                <button data-type="ALL" class="timeline-filter px-4 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-900 text-white">Todos</button>
                <button data-type="ENTRY" class="timeline-filter px-4 py-2 rounded-xl text-[10px] font-black uppercase text-slate-400 hover:bg-slate-50 transition-all">Entradas</button>
                <button data-type="TRANSFER" class="timeline-filter px-4 py-2 rounded-xl text-[10px] font-black uppercase text-slate-400 hover:bg-slate-50 transition-all">Transferências</button>
            </div>
        </div>

        <div class="relative">
            <!-- Linha da Timeline -->
            <div class="absolute left-8 top-0 bottom-0 w-px bg-slate-100"></div>

            <div class="space-y-8 relative">
    `;

    if (items.length === 0) {
        html += `<div class="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-20 text-center ml-16"><p class="text-slate-400 font-bold">Sem movimentos registados.</p></div>`;
    } else {
        items.forEach(m => {
            const date = new Date(m.createdAt);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString();

            const typeConfig = {
                'ENTRY': { icon: 'download', color: 'text-emerald-500', bg: 'bg-emerald-50', label: 'Entrada de Stock' },
                'EXIT': { icon: 'upload', color: 'text-amber-500', bg: 'bg-amber-50', label: 'Saída de Stock' },
                'TRANSFER_OUT': { icon: 'swap_horiz', color: 'text-blue-500', bg: 'bg-blue-50', label: 'Transferência (Saída)' },
                'TRANSFER_IN': { icon: 'swap_horiz', color: 'text-blue-500', bg: 'bg-blue-50', label: 'Transferência (Entrada)' },
                'ASSIGNED': { icon: 'person_add', color: 'text-indigo-500', bg: 'bg-indigo-50', label: 'Alocação de Ativo' },
                'RETURNED': { icon: 'assignment_return', color: 'text-purple-500', bg: 'bg-purple-50', label: 'Devolução de Ativo' }
            };

            const config = typeConfig[m.type] || { icon: 'history', color: 'text-slate-400', bg: 'bg-slate-50', label: m.type };

            html += `
                <div class="timeline-item flex gap-8 group" data-type="${m.type}">
                    <!-- Icone da Timeline -->
                    <div class="w-16 flex-shrink-0 flex flex-col items-center">
                        <div class="w-10 h-10 rounded-2xl ${config.bg} ${config.color} flex items-center justify-center shadow-sm relative z-10 group-hover:scale-110 transition-transform">
                            <span class="material-symbols-outlined text-xl">${config.icon}</span>
                        </div>
                        <span class="text-[9px] font-black text-slate-400 mt-2 uppercase">${timeStr}</span>
                    </div>

                    <!-- Card da Timeline -->
                    <div class="flex-grow bg-white p-6 rounded-3xl border border-slate-100 shadow-sm group-hover:border-slate-200 group-hover:shadow-md transition-all">
                        <div class="flex justify-between items-start mb-4">
                            <div>
                                <span class="text-[9px] font-black uppercase tracking-widest ${config.color} mb-1 block">${config.label}</span>
                                <h4 class="text-base font-bold text-slate-900">${esc(m.product.name)}</h4>
                            </div>
                            <div class="text-right">
                                <span class="text-xl font-black text-slate-900">${m.quantity > 0 ? '+' : ''}${m.quantity}</span>
                                <span class="text-[9px] font-black text-slate-400 uppercase block">${esc(m.product.unit)}</span>
                            </div>
                        </div>

                        <div class="flex flex-wrap items-center gap-6 pt-4 border-t border-slate-50">
                            <div class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm text-slate-300">location_on</span>
                                <span class="text-[10px] font-bold text-slate-500 uppercase">${esc(m.warehouse.name)}</span>
                            </div>
                            ${m.reference ? `
                            <div class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm text-slate-300">description</span>
                                <span class="text-[10px] font-bold text-slate-500 uppercase">${esc(m.reference)}</span>
                            </div>` : ''}
                            <div class="ml-auto text-[9px] font-black text-slate-300 uppercase tracking-widest">${dateStr}</div>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    html += `</div></div>`;
    container.innerHTML = html;

    // Lógica de Filtros da Timeline
    const filterBtns = container.querySelectorAll(".timeline-filter");
    filterBtns.forEach(btn => {
        btn.onclick = () => {
            const type = btn.dataset.type;
            filterBtns.forEach(b => b.classList.remove("bg-slate-900", "text-white"));
            filterBtns.forEach(b => b.classList.add("text-slate-400"));
            btn.classList.add("bg-slate-900", "text-white");
            btn.classList.remove("text-slate-400");

            const cards = container.querySelectorAll(".timeline-item");
            cards.forEach(card => {
                if (type === 'ALL' || card.dataset.type === type || (type === 'TRANSFER' && card.dataset.type.startsWith('TRANSFER'))) {
                    card.classList.remove("hidden");
                } else {
                    card.classList.add("hidden");
                }
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

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div class="lg:col-span-3 space-y-8">
                <!-- Materiais -->
                <div class="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-sm">
                    <div class="px-10 py-8 border-b border-slate-50 flex justify-between items-center">
                        <h3 class="text-lg font-black text-slate-900 uppercase tracking-tighter">Materiais & Consumíveis</h3>
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
                        <h3 class="text-lg font-black text-slate-900 uppercase tracking-tighter">Controle de Ativos</h3>
                    </div>
                    <div class="overflow-hidden w-full">
                        <table class="w-full text-left">
                            <thead>
                                <tr class="text-[10px] font-black uppercase text-slate-400 bg-slate-50/30">
                                    <th class="px-10 py-5">Ativo / Foto</th>
                                    <th class="px-10 py-5">Estado</th>
                                    <th class="px-10 py-5">Responsável Atual</th>
                                    <th class="px-10 py-5 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-50">
                                ${assignedTools.map(t => {
        const imgUrl = getAssetUrl(t.imageUrl || t.product.image) || 'https://placehold.co/100x100/f8fafc/cbd5e1?text=Tool';
        const statusMap = {
            'AVAILABLE': { label: 'Em Stock', color: 'text-emerald-600 bg-emerald-50' },
            'ASSIGNED': { label: 'Em Obra', color: 'text-emerald-600 bg-emerald-50' },
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
                                                <div class="text-[10px] text-slate-400 font-black uppercase tracking-widest">SN: ${esc(t.serialNumber || '---')}</div>
                                            </div>
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
                                            <button onclick="window.returnTool('${t.id}')" class="h-10 px-6 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all">
                                                Retorno Sede
                                            </button>
                                        </td>
                                    </tr>
                                    `;
    }).join('') || '<tr><td colspan="4" class="p-20 text-center text-slate-400 font-medium italic">Nenhum ativo alocado a este local.</td></tr>'}
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
                        <div class="flex items-start gap-4">
                            <span class="material-symbols-outlined text-amber-400 mt-1">calendar_today</span>
                            <div>
                                <p class="text-[10px] font-black text-slate-500 uppercase mb-1">Última Atividade</p>
                                <p class="font-bold text-lg">${movements.length > 0 ? new Date(movements[0].createdAt).toLocaleDateString() : 'Sem registos'}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="mt-16 p-6 bg-white/5 rounded-3xl border border-white/10">
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
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-2">
                    <label class="text-[11px] font-black text-slate-400 uppercase tracking-widest">Produto / Material</label>
                    <select name="productId" id="movementProductId" required class="w-full bg-slate-50 border-none rounded-2xl p-4 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#2afc8d] transition-all">
                        <option value="">Selecionar...</option>
                        <optgroup label="Materiais & Consumíveis">
                            ${materials.map(p => `<option value="${p.id}" data-category="${p.category}">${esc(p.name)} (${p.unit})</option>`).join('')}
                        </optgroup>
                        <optgroup label="Ativos & Ferramentas">
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
        </form>
    `;

    const { close } = openModal({
        title: type === "ENTRY" ? "Entrada de Material" : "Saída de Material",
        contentHtml,
        primaryLabel: "Registar Movimento",
        onPrimary: async ({ body }) => {
            const data = Object.fromEntries(new FormData(body.querySelector("#formMovement")).entries());
            data.quantity = parseFloat(data.quantity);
            data.type = type;
            try {
                await apiRequest("/stock/movements", { method: "POST", body: data });
                close();
                loadTabContent(currentTab);
            } catch (error) { alert("Erro: " + error.message); }
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
        primaryLabel: "Confirmar Transferência",
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
