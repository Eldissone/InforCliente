import { apiRequest, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { openModal, toast, escapeHtml } from "../../shared/ui.js";
import { can, initPermissionLayer } from "../../shared/permissions.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

/**
 * RG1 Produtos e Serviços › lista (o V.cprod do protótipo), no aspeto desta
 * página: Todos / Produtos / Serviços (com contagem), pesquisa, categoria,
 * Ativos / Inativos; Importar Excel, Categorias, Unidades, + Novo. Colunas:
 * Código · Descrição · Tipo · Un. · Categoria · Subcategoria · IVA ·
 * Ret. Fonte · Preço Ref. · Estado · Ações. Clicar na linha abre a ficha.
 */

checkAuth();

const el = (id) => document.getElementById(id);
const SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const UNIT_LABELS = {
  UN: "UN — unidade",
  M: "M — metro",
  MT2: "M² — metro quadrado",
  MT3: "M³ — metro cúbico",
  KG: "KG — quilograma",
  TON: "TON — tonelada",
  L: "L — litro",
  H: "H — hora",
  DIA: "DIA — dia",
  MES: "MÊS — mês",
  CX: "CX — caixa",
  PAR: "PAR — par",
};
const unidade = (u) => ({ MT2: "M²", MT3: "M³", MES: "MÊS" })[u] || u || "UN";
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
const fmt = (v) => (Number(v) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v) => (v == null || v === "" ? "—" : `${Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 2 })}%`);

let allProducts = [];
let cats = [];
const state = { page: 1, pageSize: 25, search: "", kind: "", category: "", active: "1", sort: "name_asc" };

function renderKinds() {
  const host = el("productsKinds");
  if (!host) return;
  const base = allProducts.filter((p) => state.active === "" || (state.active === "1" ? p.active !== false : p.active === false));
  const n = (k) => base.filter((p) => !k || p.kind === k).length;
  host.innerHTML = [
    ["", "Todos"],
    ["PRODUTO", "Produtos"],
    ["SERVICO", "Serviços"],
  ]
    .map(([k, l]) => `<button type="button" class="${state.kind === k ? "on" : ""}" data-kind="${k}">${l} (${n(k)})</button>`)
    .join("");
}

function renderCategoryFilter() {
  const sel = el("productsCategory");
  if (!sel) return;
  const L = cats.filter((c) => !state.kind || c.kind === state.kind);
  sel.innerHTML = `<option value="">Todas as categorias</option>${L.map(
    (c) => `<option value="${escapeHtml(c.id)}"${state.category === c.id ? " selected" : ""}>${escapeHtml(c.name)}</option>`
  ).join("")}`;
}

function renderRow(item) {
  const serv = item.kind === "SERVICO";
  const alias = (item.aliases || []).map((a) => a.alias).join(", ");
  const ref = item.precoRef;
  return `
    <tr data-row="${item.id}" title="Clique para abrir a ficha completa" class="hover:bg-slate-50 transition-all duration-200 group border-b border-slate-50 last:border-0${item.active === false ? " opacity-60" : ""}">
      <td class="px-5 py-3 text-xs font-mono font-bold text-slate-500 whitespace-nowrap">${escapeHtml(item.sku || "—")}</td>
      <td class="px-5 py-3">
        <div class="flex items-center gap-3">
          ${
            item.image
              ? `<div class="h-9 w-9 rounded-xl overflow-hidden border border-slate-100 shrink-0"><img src="${getAssetUrl(item.image)}" alt="" class="w-full h-full object-cover" /></div>`
              : `<div class="h-9 w-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-lg">${serv ? "engineering" : "inventory_2"}</span></div>`
          }
          <div class="min-w-0">
            <p class="text-sm font-bold text-slate-900 truncate max-w-[340px]">${escapeHtml(item.name)}</p>
            ${alias ? `<p class="text-[11px] text-slate-400 truncate max-w-[340px]">${escapeHtml(alias)}</p>` : ""}
          </div>
        </div>
      </td>
      <td class="px-4 py-3 text-center"><span class="inline-flex px-3 py-1 rounded-full text-[10px] font-bold border ${
        serv ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-emerald-50 text-emerald-700 border-emerald-100"
      }">${serv ? "Serviço" : "Produto"}</span></td>
      <td class="px-4 py-3 text-center text-sm font-semibold text-slate-600">${escapeHtml(unidade(item.unit))}</td>
      <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(item.catalogCategory?.name || "—")}</td>
      <td class="px-4 py-3 text-sm text-slate-500">${escapeHtml(item.catalogSubcategory?.name || "—")}</td>
      <td class="px-4 py-3 text-right text-sm text-slate-700">${pct(item.vatPercent)}</td>
      <td class="px-4 py-3 text-right text-sm text-slate-700">${pct(item.withholdingPercent)}</td>
      <td class="px-4 py-3 text-right text-sm text-slate-700 whitespace-nowrap" title="${ref ? escapeHtml(`${ref.fornecedor || ""} · ${String(ref.data || "").slice(0, 10)}`) : ""}">${ref ? `${fmt(ref.valor)} <span class="text-[10px] text-slate-400">${escapeHtml(ref.moeda || "")}</span>` : "—"}</td>
      <td class="px-4 py-3 text-center"><span class="inline-flex px-3 py-1 rounded-full text-[10px] font-bold border ${
        item.active === false ? "bg-slate-50 text-slate-500 border-slate-200" : "bg-emerald-50 text-emerald-700 border-emerald-100"
      }">${item.active === false ? "Inativo" : "Ativo"}</span></td>
      <td class="px-5 py-3 text-right">
        <div class="flex items-center justify-end gap-1.5">
          <a href="/registos/produtos?id=${encodeURIComponent(item.id)}" class="h-8 w-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-400 shadow-sm" title="Editar">
            <span class="material-symbols-outlined text-base">edit</span></a>
          ${
            can("materiais", "manage")
              ? `<button type="button" data-delete="${item.id}" class="h-8 w-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-red-500 hover:text-red-700 hover:border-red-300 shadow-sm" title="Eliminar">
            <span class="material-symbols-outlined text-base">delete</span></button>`
              : ""
          }
        </div>
      </td>
    </tr>`;
}

function getFilteredProducts() {
  const q = norm(state.search);
  let list = allProducts.filter(
    (p) =>
      (state.active === "" || (state.active === "1" ? p.active !== false : p.active === false)) &&
      (!state.kind || p.kind === state.kind) &&
      (!state.category || p.catalogCategoryId === state.category) &&
      (!q ||
        norm([p.name, p.sku, p.notes, p.catalogCategory?.name, p.catalogSubcategory?.name, ...(p.aliases || []).map((a) => a.alias)].join(" ")).includes(q))
  );
  if (state.sort === "name_desc") list.sort((a, b) => String(b.name || "").localeCompare(String(a.name || ""), "pt"));
  else if (state.sort === "sku_asc") list.sort((a, b) => String(a.sku || "").localeCompare(String(b.sku || ""), "pt", { numeric: true }));
  else list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt"));
  return list;
}

function renderTable() {
  renderKinds();
  const tbody = el("productsTbody");
  if (!tbody) return;
  const filtered = getFilteredProducts();
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * state.pageSize;
  const slice = filtered.slice(start, start + state.pageSize);
  tbody.innerHTML = slice.length
    ? slice.map(renderRow).join("")
    : `<tr><td colspan="11" class="px-8 py-16 text-center text-slate-400">
        <span class="material-symbols-outlined text-5xl opacity-40">inventory_2</span>
        <p class="text-sm font-semibold mt-2">${allProducts.length ? "Nenhum produto ou serviço com estes filtros." : "Ainda não há produtos."}</p>
        <p class="text-xs text-slate-400 mt-1">Crie o primeiro, ou importe uma lista em Excel (colunas código, descrição, unidade, categoria, subcategoria, IVA).</p></td></tr>`;
  const count = el("productsCount");
  if (count) count.textContent = `${total} de ${allProducts.length} produto(s)`;
  const pagingText = el("productsPagingText");
  if (pagingText) pagingText.textContent = `Mostrando ${total ? start + 1 : 0}-${Math.min(total, start + state.pageSize)} de ${total} itens`;
  renderPages(totalPages);
}

function renderPages(totalPages) {
  const host = el("productsPages");
  const prev = el("productsPrev");
  const next = el("productsNext");
  if (!host || !prev || !next) return;
  prev.disabled = state.page <= 1;
  next.disabled = state.page >= totalPages;
  let start = Math.max(1, state.page - 2);
  const end = Math.min(totalPages, start + 4);
  start = Math.max(1, end - 4);
  host.innerHTML = "";
  for (let i = start; i <= end; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(i);
    btn.className =
      i === state.page
        ? "h-9 w-9 rounded-xl bg-slate-900 text-white font-bold text-xs"
        : "h-9 w-9 rounded-xl border border-slate-200 bg-white text-slate-600 font-bold text-xs hover:border-slate-400 transition-all";
    btn.addEventListener("click", () => {
      state.page = i;
      renderTable();
    });
    host.appendChild(btn);
  }
}

async function loadProducts() {
  try {
    const [res, c] = await Promise.all([apiRequest("/products?includeInactive=true"), apiRequest("/catalog-categories").catch(() => ({ items: [] }))]);
    allProducts = Array.isArray(res?.items) ? res.items : [];
    cats = c.items || [];
    renderCategoryFilter();
    renderTable();
  } catch (error) {
    toast(error?.message || "Erro ao carregar o catálogo de produtos e serviços.", { type: "error" });
    const tbody = el("productsTbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" class="px-8 py-12 text-center text-red-500 font-semibold text-sm">Não foi possível carregar os produtos. Tente recarregar a página.</td></tr>`;
  }
}

function handleDelete(productId) {
  const product = allProducts.find((p) => p.id === productId);
  if (!product) return;
  openModal({
    title: "Confirmar Eliminação",
    contentHtml: `<div class="py-2 text-slate-600 text-sm">
      <p class="mb-2">Tem a certeza que deseja eliminar <strong class="text-slate-900">${escapeHtml(product.name)}</strong>?</p>
      <p class="text-xs text-slate-400">Se já tiver histórico em obras ou requisições, fica inativo em vez de ser apagado, sem perda de dados.</p></div>`,
    primaryLabel: "Sim, Eliminar",
    secondaryLabel: "Cancelar",
    onPrimary: async ({ close }) => {
      try {
        await apiRequest(`/products/${product.id}`, { method: "DELETE" });
        toast("Item removido.", { type: "success" });
        close();
        await loadProducts();
      } catch (err) {
        toast(err?.message || "Erro ao eliminar item.", { type: "error" });
      }
    },
  });
}

function abrirUnidades() {
  const uso = (u) => allProducts.filter((p) => p.unit === u).length;
  openModal({
    title: "Unidades",
    contentHtml: `<table class="w-full text-sm"><thead><tr class="text-left text-[10px] uppercase tracking-widest text-slate-400"><th class="py-2">Unidade</th><th class="py-2 text-right">Produtos</th></tr></thead><tbody>${Object.entries(UNIT_LABELS)
      .map(([k, l]) => `<tr class="border-t border-slate-100"><td class="py-2">${escapeHtml(l)}</td><td class="py-2 text-right">${uso(k) || "—"}</td></tr>`)
      .join("")}</tbody></table>
      <p class="text-xs text-slate-400 mt-3">As unidades são fixas na aplicação (as do protótipo e ainda CX e PAR).</p>`,
    primaryLabel: null,
    secondaryLabel: "Fechar",
  });
}

/** Importar Excel: colunas código, descrição, unidade, categoria, subcategoria, IVA (e tipo, se houver). */
async function importarExcel(file) {
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = SHEETJS;
      s.onload = res;
      s.onerror = () => rej(new Error("não foi possível carregar o leitor de Excel"));
      document.head.appendChild(s);
    });
  }
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const hi = rows.findIndex((r) => r.some((c) => /descri/i.test(norm(c))));
  if (hi < 0) throw new Error("não encontrei a coluna «descrição»");
  const cab = rows[hi].map(norm);
  const col = (re) => cab.findIndex((c) => re.test(c));
  const C = { cod: col(/^cod|^ref|^sku/), desc: col(/descri/), un: col(/^un/), cat: col(/^categ/), sub: col(/^sub/), iva: col(/^iva/), tipo: col(/^tipo/) };
  const UN = { un: "UN", unidade: "UN", m: "M", metro: "M", m2: "MT2", "m²": "MT2", m3: "MT3", "m³": "MT3", kg: "KG", ton: "TON", t: "TON", l: "L", lt: "L", h: "H", hora: "H", dia: "DIA", mes: "MES", "mês": "MES", cx: "CX", par: "PAR" };
  const L = rows
    .slice(hi + 1)
    .map((r) => ({
      sku: C.cod >= 0 ? String(r[C.cod]).trim() : "",
      name: String(r[C.desc] || "").trim(),
      unit: UN[norm(C.un >= 0 ? r[C.un] : "un")] || "UN",
      cat: C.cat >= 0 ? String(r[C.cat]).trim() : "",
      sub: C.sub >= 0 ? String(r[C.sub]).trim() : "",
      iva: C.iva >= 0 && String(r[C.iva]).trim() !== "" ? Number(String(r[C.iva]).replace(/[%\s]/g, "").replace(",", ".")) : 14,
      kind: C.tipo >= 0 && /serv/i.test(norm(r[C.tipo])) ? "SERVICO" : "PRODUTO",
    }))
    .filter((x) => x.name.length >= 2);
  if (!L.length) throw new Error("o ficheiro não tem linhas com descrição");
  const existe = new Set(allProducts.map((p) => norm(p.name)));
  const novos = L.filter((x) => !existe.has(norm(x.name)));
  openModal({
    title: "Importar produtos do Excel",
    contentHtml: `<p class="text-sm text-slate-600">${L.length} linha(s) no ficheiro · <b>${novos.length} novo(s)</b>${L.length - novos.length ? ` · ${L.length - novos.length} já existem (ignorados)` : ""}.</p>
      <p class="text-xs text-slate-400 mt-2">As categorias e subcategorias que não existem são criadas. Sem coluna de IVA fica 14%; sem condição, «Compra».</p>`,
    primaryLabel: novos.length ? `Importar ${novos.length}` : null,
    secondaryLabel: "Cancelar",
    onPrimary: async ({ close, btn }) => {
      btn.disabled = true;
      let ok = 0;
      const erros = [];
      let lista = (await apiRequest("/catalog-categories")).items || [];
      const catId = async (nome, kind, parentId) => {
        if (!nome) return null;
        const pool = parentId ? lista.find((c) => c.id === parentId)?.subs || [] : lista.filter((c) => c.kind === kind);
        const hit = pool.find((c) => norm(c.name) === norm(nome));
        if (hit) return hit.id;
        const c = await apiRequest("/catalog-categories", { method: "POST", body: { name: nome, kind, parentId } });
        lista = (await apiRequest("/catalog-categories")).items || [];
        return c.id;
      };
      for (const x of novos) {
        try {
          const cat = await catId(x.cat, x.kind, null);
          const sub = cat && x.sub ? await catId(x.sub, x.kind, cat) : null;
          await apiRequest("/products", {
            method: "POST",
            body: { name: x.name, sku: x.sku || null, unit: x.unit, kind: x.kind, conditions: ["COMPRA"], vatPercent: Number.isFinite(x.iva) ? x.iva : 14, catalogCategoryId: cat, catalogSubcategoryId: sub, minStock: 0 },
          });
          ok++;
        } catch (e) {
          erros.push(`${x.name}: ${e?.data?.error || e?.message}`);
        }
      }
      toast(`${ok} importado(s)${erros.length ? ` · ${erros.length} com erro (${erros.slice(0, 2).join("; ")})` : ""}.`, { type: erros.length ? "info" : "success" });
      close();
      await loadProducts();
    },
  });
}

function bindEvents() {
  el("productsSearch")?.addEventListener("input", (e) => {
    state.search = e.target.value;
    state.page = 1;
    renderTable();
  });
  el("productsKinds")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b) return;
    state.kind = b.dataset.kind;
    state.category = "";
    state.page = 1;
    renderCategoryFilter();
    renderTable();
  });
  el("productsCategory")?.addEventListener("change", (e) => {
    state.category = e.target.value;
    state.page = 1;
    renderTable();
  });
  el("productsActive")?.addEventListener("change", (e) => {
    state.active = e.target.value;
    state.page = 1;
    renderTable();
  });
  el("productsSort")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderTable();
  });
  el("productsPrev")?.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      renderTable();
    }
  });
  el("productsNext")?.addEventListener("click", () => {
    state.page += 1;
    renderTable();
  });
  el("productsUnits")?.addEventListener("click", abrirUnidades);
  el("productsImport")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) importarExcel(f).catch((err) => toast(`Não foi possível ler o ficheiro: ${err.message || err}`, { type: "error" }));
  });
  el("productsTbody")?.addEventListener("click", (e) => {
    const del = e.target.closest("[data-delete]");
    if (del) return handleDelete(del.dataset.delete);
    if (e.target.closest("a")) return;
    const row = e.target.closest("[data-row]");
    if (row) window.location.href = `/registos/produtos?id=${encodeURIComponent(row.dataset.row)}`;
  });
}

async function init() {
  await initPermissionLayer();
  wireLogout();
  wireUsersNav();
  bindEvents();
  await loadProducts();
}

init();
