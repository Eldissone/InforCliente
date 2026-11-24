import { apiRequest, apiUpload, getAssetUrl } from "/services/api.js";
import { checkAuth } from "/services/auth.js";
import { can, guardPageAccess, initPermissionLayer } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu, toast } from "/shared/ui.js";

/**
 * RG1 Produtos e Serviços › ficha (o FXDRAW.prod do protótipo), no layout
 * desta página (cartões e grelha):
 *  - Informação: Código (atribuído ao gravar), Descrição*, Descrição Extra
 *    (palavras para a pesquisa), Condição* (Comercial / Compra / outra),
 *    Unidade*, IVA*, Retenção na fonte;
 *  - Categoria* e Subcategoria (RG2), com «+ Criar nova…» e «Gerir»;
 *  - Observações; Fotografia (produtos); Estado (ao editar).
 * O tipo (Produto / Serviço) é o separador do topo. `?id=` abre para editar.
 */

const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png"];
const UNITS = [
  ["UN", "UN — unidade"],
  ["M", "M — metro"],
  ["MT2", "M² — metro quadrado"],
  ["MT3", "M³ — metro cúbico"],
  ["KG", "KG — quilograma"],
  ["TON", "TON — tonelada"],
  ["L", "L — litro"],
  ["H", "H — hora"],
  ["DIA", "DIA — dia"],
  ["MES", "MÊS — mês"],
  ["CX", "CX — caixa"],
  ["PAR", "PAR — par"],
];
const IVAS = [
  ["14", "14%"],
  ["7", "7%"],
  ["5", "5%"],
  ["0", "Isento / sem IVA"],
];
const CONDICOES = [
  ["COMERCIAL", "Comercial", "Entra nos orçamentos e propostas"],
  ["COMPRA", "Compra", "Entra nas compras e pedidos de pagamento"],
];

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const apiMessage = (error) => error?.data?.message || error?.data?.error || error?.message || "Não foi possível guardar.";
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const params = () => new URLSearchParams(window.location.search);
function currentKind(produto) {
  if (produto) return produto.kind === "SERVICO" ? "servico" : "produto";
  const tipo = norm(params().get("tipo"));
  return tipo === "servico" ? "servico" : "produto";
}
const kindHref = (kind) => (kind === "servico" ? "/registos/produtos?tipo=servico" : "/registos/produtos");

function field(label, control, { req = false, extra = "", wide = false } = {}) {
  return `<label class="ps-field${wide ? " ps-wide" : ""}"><span>${label}${req ? ' <b class="ps-req">*</b>' : ""}${extra}</span>${control}</label>`;
}
const options = (items, selected, placeholder) =>
  `${placeholder != null ? `<option value="">${esc(placeholder)}</option>` : ""}${items
    .map(([v, l]) => `<option value="${esc(v)}"${String(selected ?? "") === String(v) ? " selected" : ""}>${esc(l)}</option>`)
    .join("")}`;

async function carregarCategorias() {
  try {
    const r = await apiRequest("/catalog-categories");
    return r.items || [];
  } catch {
    return [];
  }
}

export async function renderProdutosForm() {
  const root = document.getElementById("registryRoot");
  if (!root) return;
  await initPermissionLayer();
  const canManage = can("materiais", "manage");

  const id = params().get("id");
  let produto = null;
  if (id) {
    try {
      produto = await apiRequest(`/products/${encodeURIComponent(id)}`);
    } catch (e) {
      toast(`Não foi possível abrir o produto: ${apiMessage(e)}`, { type: "error" });
    }
  }
  const kind = currentKind(produto);
  const isService = kind === "servico";
  const KIND = isService ? "SERVICO" : "PRODUTO";
  let cats = await carregarCategorias();
  const nomeTipo = isService ? "Serviço" : "Produto";

  const title = document.querySelector("title");
  if (title) title.textContent = `Info Gestor — ${produto ? `Editar ${nomeTipo}` : `Novo ${nomeTipo}`}`;

  const st = {
    conds: new Set(produto?.conditions?.length ? produto.conditions : []),
    cat: produto?.catalogCategoryId || "",
    sub: produto?.catalogSubcategoryId || "",
  };
  const outrasConds = () => [...st.conds].filter((c) => !CONDICOES.some(([k]) => k === c));

  const catsDoTipo = () => cats.filter((c) => c.kind === KIND || c.id === st.cat);
  const catOpts = () =>
    `<option value="">— escolher —</option>${canManage ? '<option value="__new">+ Criar nova…</option>' : ""}${catsDoTipo()
      .map((c) => `<option value="${esc(c.id)}"${c.id === st.cat ? " selected" : ""}>${esc(c.name)}</option>`)
      .join("")}`;
  const subOpts = () => {
    const c = cats.find((x) => x.id === st.cat);
    const L = c?.subs || [];
    return `<option value="">— escolher —</option>${c && canManage ? '<option value="__new">+ Criar nova…</option>' : ""}${L.map(
      (s) => `<option value="${esc(s.id)}"${s.id === st.sub ? " selected" : ""}>${esc(s.name)}</option>`
    ).join("")}`;
  };
  const condHtml = () =>
    `<span class="ps-seg" id="psConds">${CONDICOES.map(
      ([k, l, t]) => `<button type="button" class="${st.conds.has(k) ? "is-on" : ""}" data-cond="${k}" title="${esc(t)}">${l}</button>`
    ).join("")}${outrasConds()
      .map((k) => `<button type="button" class="is-on" data-cond="${esc(k)}" title="Clique para retirar">${esc(k)}</button>`)
      .join("")}${canManage ? '<button type="button" data-condnew="1" title="Acrescentar outra condição">+</button>' : ""}</span>`;

  const aliases = (produto?.aliases || []).map((a) => a.alias).join(", ");
  const iva = produto?.vatPercent != null ? String(Number(produto.vatPercent)) : "";
  const ret = produto?.withholdingPercent != null ? String(Number(produto.withholdingPercent)) : "";

  root.innerHTML = `
    <nav class="ps-switch" aria-label="Tipo de registo">
      ${
        produto
          ? `<span class="is-active">${nomeTipo}</span>`
          : `<a href="${kindHref("produto")}" class="${isService ? "" : "is-active"}">Produto</a>
             <a href="${kindHref("servico")}" class="${isService ? "is-active" : ""}">Serviço</a>`
      }
    </nav>
    <header class="ps-header">
      <div>
        <div class="ps-kick">PRODUTO / SERVIÇO</div>
        <h1 class="ps-title">${produto ? `${esc(produto.name)}` : `Novo ${nomeTipo}`}</h1>
        <p class="ps-lead">Registo e configuração do ${isService ? "serviço" : "produto"}${produto?.sku ? ` · código ${esc(produto.sku)}` : ""}.</p>
      </div>
      <a href="/produtos" class="ps-top-btn">
        <span class="material-symbols-outlined" aria-hidden="true">format_list_bulleted</span>
        Lista de Produtos e Serviços
      </a>
    </header>
    <form class="ps-form" id="psForm" novalidate>
      <section class="ps-card">
        <h2>Informação do ${nomeTipo}</h2>
        <div class="ps-grid">
          ${field("Código", `<input name="sku" type="text" value="${esc(produto?.sku || "")}" placeholder="(atribuído ao gravar)">`)}
          ${field(`Descrição do ${nomeTipo}`, `<input name="name" type="text" required value="${esc(produto?.name || "")}" placeholder="designação técnica">`, { req: true })}
          ${field("Descrição Extra", `<input name="aliases" type="text" value="${esc(aliases)}" placeholder="palavras para a pesquisa, separadas por vírgula">`)}
          ${field("Condição", condHtml(), { req: true, wide: true })}
          ${field("Unidade", `<select name="unit">${options(UNITS, produto?.unit || "", "— escolher —")}</select>`, { req: true })}
          ${field("IVA", `<select name="vat">${options(IVAS, iva, "— escolher —")}</select>`, { req: true })}
          ${field("Retenção na fonte (%)", `<input name="withholding" type="number" min="0" max="100" step="0.01" value="${esc(ret)}" placeholder="${isService ? "ex.: 6,5" : "—"}">`)}
        </div>
      </section>
      <section class="ps-card">
        <h2>Categoria</h2>
        <div class="ps-grid ps-grid--2">
          ${field("Categoria", `<select name="cat" id="psCat">${catOpts()}</select>`, { req: true, extra: ' <a class="ps-gerir" href="/registos/categorias-produtos">Gerir</a>' })}
          ${field("Subcategoria", `<select name="sub" id="psSub">${subOpts()}</select>`)}
        </div>
      </section>
      <section class="ps-card">
        <h2>Observações</h2>
        <div class="ps-grid ps-grid--1">
          ${field("Observações", `<textarea name="notes" rows="2" placeholder="opcional">${esc(produto?.notes || "")}</textarea>`, { wide: true })}
        </div>
      </section>
      ${
        isService
          ? ""
          : `<section class="ps-card">
        <h2>Fotografia</h2>
        ${produto?.image ? `<img class="ps-foto" src="${esc(getAssetUrl(produto.image))}" alt="">` : ""}
        <label class="ps-field ps-photo"><span>Anexar JPG, JPEG ou PNG (máximo 2 MB)</span><input name="photo" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png"></label>
      </section>`
      }
      ${
        produto
          ? `<section class="ps-card"><h2>Estado</h2><div class="ps-grid">${field(
              "Estado",
              `<select name="active">${options([["1", "Ativo"], ["0", "Inativo — não aparece nas listas de escolha"]], produto.active === false ? "0" : "1", null)}</select>`
            )}</div></section>`
          : ""
      }
      <div class="ps-actions">
        <a class="ps-top-btn" href="/produtos">Cancelar</a>
        ${
          canManage
            ? `<button class="ps-submit" type="submit" data-perm="materiais:manage">${produto ? "Gravar alterações" : `Gravar ${isService ? "serviço" : "produto"}`}</button>`
            : `<p class="ps-denied">Sem permissão para guardar no catálogo.</p>`
        }
      </div>
    </form>`;

  const form = root.querySelector("#psForm");
  const catSel = form.querySelector("#psCat");
  const subSel = form.querySelector("#psSub");

  const criarCategoria = async (parentId) => {
    const nome = window.prompt(parentId ? "Nome da nova subcategoria:" : `Nome da nova categoria de ${isService ? "serviços" : "produtos"}:`);
    if (!nome || nome.trim().length < 2) return null;
    try {
      const c = await apiRequest("/catalog-categories", { method: "POST", body: { name: nome.trim(), kind: KIND, parentId: parentId || null } });
      cats = await carregarCategorias();
      toast(`${parentId ? "Subcategoria" : "Categoria"} «${c.name}» criada.`, { type: "success" });
      return c.id;
    } catch (e) {
      toast(apiMessage(e), { type: "error" });
      return null;
    }
  };

  catSel?.addEventListener("change", async () => {
    if (catSel.value === "__new") {
      const novo = await criarCategoria(null);
      st.cat = novo || st.cat;
    } else st.cat = catSel.value;
    st.sub = "";
    catSel.innerHTML = catOpts();
    subSel.innerHTML = subOpts();
  });
  subSel?.addEventListener("change", async () => {
    if (subSel.value === "__new") {
      const novo = await criarCategoria(st.cat);
      st.sub = novo || "";
    } else st.sub = subSel.value;
    subSel.innerHTML = subOpts();
  });
  form.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cond]");
    if (b) {
      const k = b.dataset.cond;
      if (st.conds.has(k)) st.conds.delete(k);
      else st.conds.add(k);
      form.querySelector("#psConds").outerHTML = condHtml();
      return;
    }
    if (e.target.closest("[data-condnew]")) {
      const n = window.prompt("Nova condição (ex.: STOCK):");
      if (n && n.trim()) st.conds.add(n.trim().toUpperCase().slice(0, 40));
      form.querySelector("#psConds").outerHTML = condHtml();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!can("materiais", "manage")) return toast("Sem permissão para guardar.", { type: "error" });
    const button = form.querySelector("[type=submit]");
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const unit = String(data.get("unit") || "");
    const vat = String(data.get("vat") || "");
    const falta = [];
    if (name.length < 2) falta.push("a descrição");
    if (!st.conds.size) falta.push("a condição");
    if (!unit) falta.push("a unidade");
    if (vat === "") falta.push("o IVA");
    if (!st.cat) falta.push("a categoria");
    if (falta.length) return toast(`Falta ${falta.join(", ")}.`, { type: "error" });
    const photo = data.get("photo");
    if (photo instanceof File && photo.size) {
      if (!PHOTO_TYPES.includes(photo.type) && !/\.(jpe?g|png)$/i.test(photo.name || "")) return toast("A fotografia tem de ser JPG, JPEG ou PNG.", { type: "error" });
      if (photo.size > PHOTO_MAX_BYTES) return toast("A fotografia deve ter no máximo 2 MB.", { type: "error" });
    }
    const ret = String(data.get("withholding") || "").replace(",", ".");
    const body = {
      name,
      sku: String(data.get("sku") || "").trim() || null,
      unit,
      kind: KIND,
      conditions: [...st.conds],
      vatPercent: Number(vat),
      withholdingPercent: ret === "" ? null : Number(ret),
      catalogCategoryId: st.cat || null,
      catalogSubcategoryId: st.sub || null,
      notes: String(data.get("notes") || "").trim() || null,
      ...(produto ? { active: data.get("active") !== "0" } : { minStock: 0 }),
    };
    if (button) button.disabled = true;
    try {
      const saved = produto
        ? await apiRequest(`/products/${encodeURIComponent(produto.id)}`, { method: "PATCH", body })
        : await apiRequest("/products", { method: "POST", body });

      // Descrição Extra = os nomes alternativos (aliases) usados na pesquisa.
      const quero = [...new Set(String(data.get("aliases") || "").split(",").map((x) => x.trim()).filter((x) => x.length >= 2))];
      const tinha = produto?.aliases || [];
      const avisos = [];
      for (const a of tinha) {
        if (!quero.some((q) => norm(q) === norm(a.alias))) {
          await apiRequest(`/products/${encodeURIComponent(saved.id)}/aliases/${encodeURIComponent(a.id)}`, { method: "DELETE" }).catch(() => {});
        }
      }
      for (const q of quero) {
        if (tinha.some((a) => norm(a.alias) === norm(q))) continue;
        try {
          await apiRequest(`/products/${encodeURIComponent(saved.id)}/aliases`, { method: "POST", body: { alias: q } });
        } catch (e) {
          avisos.push(`«${q}»: ${apiMessage(e)}`);
        }
      }
      if (photo instanceof File && photo.size && saved?.id) {
        try {
          await apiUpload(`/products/${saved.id}/photo`, { file: photo, fieldName: "photo" });
        } catch (e) {
          avisos.push(`fotografia: ${apiMessage(e)}`);
        }
      }
      toast(`${nomeTipo} ${saved.sku ? `${saved.sku} ` : ""}gravado.${avisos.length ? ` Atenção — ${avisos.join("; ")}` : ""}`, { type: avisos.length ? "info" : "success" });
      window.location.href = "/produtos";
    } catch (error) {
      toast(apiMessage(error), { type: "error" });
      if (button) button.disabled = false;
    }
  });
}

async function boot() {
  if (!document.body || document.body.dataset.registry !== "produtos") return;
  if (!checkAuth()) return;
  const ok = await guardPageAccess("materiais", "view");
  if (!ok) return;
  await initPermissionLayer();
  wireUsersNav();
  wireLogout();
  initMobileMenu();
  await renderProdutosForm();
}

if (document.querySelector('script[src*="/registos/produtos/index.js"]')) {
  boot();
}
