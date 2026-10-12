import { apiRequest, apiUpload } from "/services/api.js";
import { checkAuth } from "/services/auth.js";
import { can, initPermissionLayer } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu, toast } from "/shared/ui.js";

const EXTRAS_KEY = "InfoCliente.registo.produtosExtras";
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png"];
const UNITS = ["UN", "KG", "M", "L", "CX", "PAR", "MT2", "MT3"];

const UNIT_LABELS = {
  UN: "Unidade",
  KG: "Quilograma",
  M: "Metro",
  L: "Litro",
  CX: "Caixa",
  PAR: "Par",
  MT2: "Metro quadrado",
  MT3: "Metro cúbico",
};

const FALLBACK_CATEGORIAS = [
  "Materiais de Obra",
  "Materiais Diversos",
  "Equipamentos",
  "Ferramentas e Utensílios",
  "Serviços de Maquinaria",
  "Serviços Diversos",
  "Serviços Internos",
  "Serviços de Manutenção de Frota",
  "Serviços de Transporte e Logística",
];

const FALLBACK_SUBCATEGORIAS = [
  "Material Eléctrico",
  "Material de Construção",
  "Inertes",
  "Ferragens",
  "Consumíveis de Obra",
  "Aluguer de Máquinas",
  "Operação de Máquinas",
  "Subcontratação",
];

const PRODUCT_DEFAULTS = {
  familia: "Material Eléctrico",
  tipoCusto: "Produto",
  categoria: "Materiais de Obra",
  subcategoria: "Material Eléctrico",
  origem: "XSOFT",
  sincronizacao: "Power Automate",
  alternativa: "Manual em ambos - Plano B",
};

const SERVICE_DEFAULTS = {
  familia: "Serviços",
  tipoCusto: "Serviço",
  categoria: "Serviços de Maquinaria",
  subcategoria: "Aluguer de Máquinas",
  origem: "Manual",
  registoXsoft: "XSOFT",
  estado: "Rascunho",
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function invalid(message) {
  const error = new Error(message);
  error.validation = true;
  throw error;
}

function apiMessage(error) {
  return error?.data?.message || error?.data?.error || error?.message || "Não foi possível guardar.";
}

function currentKind() {
  const tipo = new URLSearchParams(window.location.search).get("tipo") || "";
  return tipo.toLowerCase() === "servico" || tipo.toLowerCase() === "serviço" ? "servico" : "produto";
}

function kindHref(kind) {
  return kind === "servico" ? "/registos/produtos?tipo=servico" : "/registos/produtos";
}

function readExtras() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXTRAS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeExtras(map) {
  localStorage.setItem(EXTRAS_KEY, JSON.stringify(map));
}

function optionList(items, selected, placeholder, { includeEmpty = true } = {}) {
  const opts = items.map((item) => {
    const value = typeof item === "string" ? item : item.value;
    const label = typeof item === "string" ? item : item.label;
    return `<option value="${esc(value)}" ${String(selected) === String(value) ? "selected" : ""}>${esc(label)}</option>`;
  }).join("");
  if (!includeEmpty) return opts;
  return `<option value="">${esc(placeholder)}</option>${opts}`;
}

function field(label, control) {
  return `<label class="ps-field"><span>${label}</span>${control}</label>`;
}

function ensureNamedOption(items, value, label) {
  if (!value) return items;
  const exists = items.some((item) => String(typeof item === "string" ? item : item.value) === String(value));
  return exists ? items : [{ value, label: label || value }, ...items];
}

function pickByName(items, name) {
  if (!name) return "";
  const match = items.find((item) => {
    const label = typeof item === "string" ? item : item.label;
    return String(label).toLocaleLowerCase("pt") === String(name).toLocaleLowerCase("pt");
  });
  if (!match) return "";
  return typeof match === "string" ? match : match.value;
}

function unitOptions(kind) {
  return UNITS.map((unit) => ({
    value: unit,
    label: kind === "servico" && unit === "UN" ? "Hora / serviço" : (UNIT_LABELS[unit] || unit),
  }));
}

async function loadLookups(kind) {
  const [categoriesRes, suppliersRes, productsRes] = await Promise.allSettled([
    apiRequest("/cost-categories?all=true&domain=OBRA"),
    apiRequest(kind === "servico" ? "/suppliers?type=SERVICO" : "/suppliers?type=MATERIAL"),
    apiRequest("/products"),
  ]);

  let categories = [];
  if (categoriesRes.status === "fulfilled") {
    categories = categoriesRes.value?.items || [];
  }
  if (!categories.length && categoriesRes.status === "rejected") {
    try {
      const fallback = await apiRequest("/cost-categories?all=true");
      categories = fallback.items || [];
    } catch {
      categories = [];
    }
  }

  const parents = categories.filter((item) => item.parentId == null);
  const children = categories.filter((item) => item.parentId != null);
  const categoryOptions = parents.length
    ? parents.map((item) => ({ value: String(item.id), label: item.name, raw: item }))
    : FALLBACK_CATEGORIAS.map((name) => ({ value: name, label: name }));
  const subcategoryOptions = children.length
    ? children.map((item) => ({
      value: String(item.id),
      label: item.name,
      parentId: String(item.parentId),
    }))
    : FALLBACK_SUBCATEGORIAS.map((name) => ({ value: name, label: name, parentId: "" }));

  let suppliers = [];
  if (suppliersRes.status === "fulfilled") {
    suppliers = suppliersRes.value?.items || [];
  }
  if (!suppliers.length) {
    try {
      const all = await apiRequest("/suppliers");
      suppliers = all.items || [];
    } catch {
      suppliers = [];
    }
  }
  const supplierOptions = suppliers.map((item) => ({ value: item.id, label: item.name }));

  const products = productsRes.status === "fulfilled" ? (productsRes.value?.items || []) : [];

  return { categoryOptions, subcategoryOptions, supplierOptions, products };
}

function filterSubs(allSubs, parentId) {
  if (!parentId) return allSubs;
  const filtered = allSubs.filter((item) => !item.parentId || item.parentId === String(parentId));
  return filtered.length ? filtered : allSubs.filter((item) => !item.parentId);
}

function buildDescription(kind, extras) {
  const parts = [];
  if (kind === "servico") parts.push("Serviço");
  if (extras.familia) parts.push(extras.familia);
  if (extras.subfamilia) parts.push(extras.subfamilia);
  if (extras.costCategoryName) parts.push(extras.costCategoryName);
  if (extras.costSubcategoryName) parts.push(extras.costSubcategoryName);
  return parts.join(" · ") || (kind === "servico" ? "Serviço" : null);
}

function labelOf(options, value) {
  const match = options.find((item) => String(item.value) === String(value));
  return match?.label || value || "";
}

export async function renderProdutosForm() {
  const root = document.getElementById("registryRoot");
  if (!root) return;
  await initPermissionLayer();

  const kind = currentKind();
  const isService = kind === "servico";
  const defaults = isService ? SERVICE_DEFAULTS : PRODUCT_DEFAULTS;
  const canManage = can("materiais", "manage");
  const lookups = await loadLookups(kind);

  const categoryOptions = ensureNamedOption(
    lookups.categoryOptions,
    pickByName(lookups.categoryOptions, defaults.categoria) || defaults.categoria,
    defaults.categoria
  );
  const selectedCategory = pickByName(categoryOptions, defaults.categoria)
    || categoryOptions[0]?.value
    || defaults.categoria;
  const visibleSubs = filterSubs(lookups.subcategoryOptions, selectedCategory);
  const subcategoryOptions = ensureNamedOption(
    visibleSubs,
    pickByName(visibleSubs, defaults.subcategoria) || defaults.subcategoria,
    defaults.subcategoria
  );
  const selectedSub = pickByName(subcategoryOptions, defaults.subcategoria)
    || subcategoryOptions[0]?.value
    || defaults.subcategoria;

  const nameList = lookups.products.map((item) => `<option value="${esc(item.name)}"></option>`).join("");
  const title = document.querySelector("title");
  if (title) title.textContent = isService ? "Info Gestor — Criar Serviço" : "Info Gestor — Criar Produto";

  root.innerHTML = `
    <nav class="ps-switch" aria-label="Tipo de registo">
      <a href="${kindHref("produto")}" class="${isService ? "" : "is-active"}">Produto</a>
      <a href="${kindHref("servico")}" class="${isService ? "is-active" : ""}">Serviço</a>
    </nav>
    <h1 class="ps-title">${isService ? "Criar Serviço" : "Criar Produto"}</h1>
    <p class="ps-lead">Dados demonstrativos / campos por preencher · moeda não especificada no overview.</p>
    <form class="ps-form" id="psForm" novalidate>
      <section class="ps-card">
        <h2>${isService ? "Identificação do serviço" : "Identificação do produto"}</h2>
        <div class="ps-grid">
          ${field(isService ? "Serviço" : "Produto", `<input name="name" type="text" required list="ps-names" placeholder="${isService ? "Preencher descrição" : "Seleccionar ou preencher"}">${isService ? "" : `<datalist id="ps-names">${nameList}</datalist>`}`)}
          ${field("Código", `<input name="sku" type="text" placeholder="${isService ? "Código do serviço" : "Código do catálogo"}">`)}
          ${field("Família", `<input name="familia" type="text" value="${esc(defaults.familia)}" placeholder="${isService ? "Serviços" : "Material Eléctrico"}">`)}
          ${field("Subfamília", `<input name="subfamilia" type="text" placeholder="Definir subfamília">`)}
          ${field("Tipo de custo", `<select name="tipoCusto">${optionList([defaults.tipoCusto], defaults.tipoCusto, defaults.tipoCusto, { includeEmpty: false })}</select>`)}
          ${field("Unidade", `<select name="unit">${optionList(unitOptions(kind), isService ? "UN" : "", isService ? "Hora / serviço" : "Unidade de medida", { includeEmpty: !isService })}</select>`)}
        </div>
      </section>
      <section class="ps-card">
        <h2>Classificação e origem</h2>
        <div class="ps-grid">
          ${field("Categoria de custo", `<select name="costCategory">${optionList(categoryOptions, selectedCategory, "Seleccionar categoria", { includeEmpty: false })}</select>`)}
          ${field("Subcategoria de custo", `<select name="costSubcategory">${optionList(subcategoryOptions, selectedSub, "Seleccionar subcategoria", { includeEmpty: false })}</select>`)}
          ${field(isService ? "Prestador" : "Fornecedor", `<select name="supplierId">${optionList(lookups.supplierOptions, "", "Seleccionar fornecedor")}</select>`)}
          ${field("Origem", `<select name="origem">${optionList([
            "XSOFT",
            "Manual",
            "Manual em ambos - Plano B",
          ], defaults.origem, "Seleccionar origem", { includeEmpty: false })}</select>`)}
          ${isService
            ? `${field("Registo XSOFT", `<select name="registoXsoft">${optionList(["A efetuar no XSOFT", "Efectuado", "Não aplicável"], defaults.registoXsoft, "Seleccionar", { includeEmpty: false })}</select>`)}
               ${field("Estado", `<select name="estado">${optionList(["Rascunho", "A efetuar", "Activo"], defaults.estado, "Seleccionar", { includeEmpty: false })}</select>`)}`
            : `${field("Sincronização", `<select name="sincronizacao">${optionList(["Prevista via Power Automate", "Manual", "Não aplicável"], defaults.sincronizacao, "Seleccionar", { includeEmpty: false })}</select>`)}
               ${field("Alternativa", `<select name="alternativa">${optionList(["Manual em ambos - Plano B", "Apenas XSOFT", "Apenas INFO GESTOR"], defaults.alternativa, "Seleccionar", { includeEmpty: false })}</select>`)}`}
        </div>
      </section>
      ${isService ? "" : `<section class="ps-card">
        <h2>Fotografia</h2>
        <label class="ps-field ps-photo"><span>Anexar JPG, JPEG ou PNG (máximo 2 MB)</span><input name="photo" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png"></label>
      </section>`}
      <div class="ps-actions">
        ${canManage
          ? `<button class="ps-submit" type="submit" data-perm="materiais:manage">${isService ? "Guardar serviço" : "Guardar produto"}</button>`
          : `<p class="ps-denied">Sem permissão para guardar no catálogo.</p>`}
      </div>
    </form>`;

  const form = root.querySelector("#psForm");
  const categorySelect = form?.querySelector("[name=costCategory]");
  const subSelect = form?.querySelector("[name=costSubcategory]");

  categorySelect?.addEventListener("change", () => {
    if (!subSelect) return;
    const next = filterSubs(lookups.subcategoryOptions, categorySelect.value);
    const current = next.some((item) => item.value === subSelect.value) ? subSelect.value : (next[0]?.value || "");
    subSelect.innerHTML = optionList(next, current, "Seleccionar subcategoria", { includeEmpty: !next.length });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!can("materiais", "manage")) {
      toast("Sem permissão para guardar.", { type: "error" });
      return;
    }
    const button = form.querySelector("[type=submit]");
    if (button) button.disabled = true;
    try {
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim();
      if (name.length < 2) invalid(isService ? "Indique a descrição do serviço." : "Indique o nome do produto.");

      const unit = UNITS.includes(String(data.get("unit") || "")) ? String(data.get("unit")) : "UN";

      const photo = data.get("photo");
      if (photo instanceof File && photo.size) {
        if (!PHOTO_TYPES.includes(photo.type) && !/\.(jpe?g|png)$/i.test(photo.name || "")) {
          invalid("A fotografia tem de ser JPG, JPEG ou PNG.");
        }
        if (photo.size > PHOTO_MAX_BYTES) invalid("A fotografia deve ter no máximo 2 MB.");
      }

      const extras = {
        kind,
        familia: String(data.get("familia") || "").trim(),
        subfamilia: String(data.get("subfamilia") || "").trim(),
        tipoCusto: String(data.get("tipoCusto") || defaults.tipoCusto),
        costCategoryId: String(data.get("costCategory") || ""),
        costCategoryName: labelOf(categoryOptions, data.get("costCategory")),
        costSubcategoryId: String(data.get("costSubcategory") || ""),
        costSubcategoryName: labelOf(subcategoryOptions, data.get("costSubcategory")) || labelOf(lookups.subcategoryOptions, data.get("costSubcategory")),
        supplierId: String(data.get("supplierId") || ""),
        supplierName: labelOf(lookups.supplierOptions, data.get("supplierId")),
        origem: String(data.get("origem") || ""),
        sincronizacao: String(data.get("sincronizacao") || ""),
        alternativa: String(data.get("alternativa") || ""),
        registoXsoft: String(data.get("registoXsoft") || ""),
        estado: String(data.get("estado") || ""),
      };

      const created = await apiRequest("/products", {
        method: "POST",
        body: {
          name,
          sku: String(data.get("sku") || "").trim() || null,
          description: buildDescription(kind, extras),
          category: isService ? "CONSUMABLE" : "MATERIAL",
          unit,
          minStock: 0,
        },
      });

      if (photo instanceof File && photo.size && created?.id) {
        try {
          await apiUpload(`/products/${created.id}/photo`, { file: photo, fieldName: "photo" });
        } catch (error) {
          toast(apiMessage(error) || "Produto guardado, mas a fotografia não foi enviada.", { type: "error" });
        }
      }

      if (created?.id) {
        const stored = readExtras();
        stored[created.id] = extras;
        writeExtras(stored);
      }

      toast(isService ? "Serviço guardado no catálogo." : "Produto guardado no catálogo.", { type: "success" });
      form.reset();
      await renderProdutosForm();
    } catch (error) {
      toast(apiMessage(error), { type: "error" });
      if (button) button.disabled = false;
    }
  });
}

async function boot() {
  if (!document.body || document.body.dataset.registry !== "produtos") return;
  if (!checkAuth()) return;
  await initPermissionLayer();
  wireUsersNav();
  wireLogout();
  initMobileMenu();
  await renderProdutosForm();
}

if (document.querySelector('script[src*="/registos/produtos/index.js"]')) {
  boot();
}
