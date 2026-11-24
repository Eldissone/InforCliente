import { apiRequest } from "../../../services/api.js";
import { checkAuth } from "../../../services/auth.js";
import { openModal, toast, escapeHtml as esc } from "../../../shared/ui.js";
import { can, guardPageAccess, initPermissionLayer } from "../../../shared/permissions.js";
import { wireLogout, wireUsersNav } from "../../../shared/session.js";

/**
 * RG2 Categorias de produtos e serviços (o V.fcat do protótipo): nova
 * categoria (nome e tipo), filtro Todas / Produtos / Serviços, e por
 * categoria: ✎ (nome, tipo, apagar) e as subcategorias (✎ mudar o nome,
 * × apagar, «+ Subcategoria»).
 */

checkAuth();
const el = (id) => document.getElementById(id);
let cats = [];
let filtro = "";
const erro = (e) => e?.data?.error || e?.data?.message || e?.message || "Falhou.";

function desenhar() {
  const ed = can("materiais", "manage");
  const n = (k) => cats.filter((c) => !k || c.kind === k).length;
  el("catFiltro").innerHTML = `<span class="cp-f inline-flex gap-1.5">${[
    ["", "Todas"],
    ["PRODUTO", "Produtos"],
    ["SERVICO", "Serviços"],
  ]
    .map(([k, l]) => `<button type="button" class="${filtro === k ? "on" : ""}" data-f="${k}">${l} (${n(k)})</button>`)
    .join("")}</span>`;
  const L = cats.filter((c) => !filtro || c.kind === filtro);
  el("catBody").innerHTML = L.length
    ? L.map(
        (c) => `<tr class="border-b border-slate-50">
      <td class="px-6 py-3 align-top"><b class="text-sm">${esc(c.name)}</b>${ed ? `<button type="button" class="cp-ed" data-cated="${esc(c.id)}" title="Mudar o nome, o tipo ou apagar a categoria">✎</button>` : ""}</td>
      <td class="px-4 py-3 align-top"><span class="inline-flex px-3 py-1 rounded-full text-[10px] font-bold border ${
        c.kind === "SERVICO" ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-slate-50 text-slate-600 border-slate-200"
      }">${c.kind === "SERVICO" ? "Serviço" : "Produto"}</span></td>
      <td class="px-4 py-3">${c.subs
        .map(
          (s) =>
            `<span class="cp-sub">${esc(s.name)}${s.produtos ? ` <small class="text-slate-400">(${s.produtos})</small>` : ""}${
              ed ? `<button type="button" data-subed="${esc(s.id)}" title="Mudar o nome">✎</button><button type="button" data-subdel="${esc(s.id)}" title="Apagar subcategoria">×</button>` : ""
            }</span>`
        )
        .join("")}${ed ? `<button type="button" class="cp-new" data-subnew="${esc(c.id)}" title="Acrescentar uma subcategoria a ${esc(c.name)}">+ Subcategoria</button>` : ""}${!c.subs.length && !ed ? '<span class="text-slate-400 text-sm">—</span>' : ""}</td>
      <td class="px-4 py-3 text-right text-sm text-slate-600 align-top">${c.produtos || "—"}</td></tr>`
      ).join("")
    : `<tr><td colspan="4" class="px-8 py-12 text-center text-slate-400 text-sm">${
        cats.length ? "Nenhuma categoria deste tipo." : "Ainda não há categorias. Crie a primeira acima — ou diretamente no formulário do produto («+ Criar nova…»)."
      }</td></tr>`;
}

async function carregar() {
  try {
    cats = (await apiRequest("/catalog-categories")).items || [];
  } catch (e) {
    toast(`Não foi possível carregar as categorias: ${erro(e)}`, { type: "error" });
    cats = [];
  }
  desenhar();
}

const acharSub = (id) => {
  for (const c of cats) {
    const s = c.subs.find((x) => x.id === id);
    if (s) return { c, s };
  }
  return {};
};

function editarCategoria(c) {
  openModal({
    title: "Categoria",
    contentHtml: `<label class="block text-xs font-bold text-slate-500 mb-1">Nome</label>
      <input id="ceNome" class="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm mb-3" value="${esc(c.name)}">
      <label class="block text-xs font-bold text-slate-500 mb-1">Tipo</label>
      <select id="ceTipo" class="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm mb-3"><option value="PRODUTO"${c.kind === "PRODUTO" ? " selected" : ""}>Produto</option><option value="SERVICO"${c.kind === "SERVICO" ? " selected" : ""}>Serviço</option></select>
      <p class="text-xs text-slate-400">${c.produtos ? `${c.produtos} produto(s) usam esta categoria.` : "Nenhum produto usa esta categoria."}</p>
      <button type="button" id="ceApagar" class="mt-4 text-sm font-bold text-red-600">Apagar a categoria${c.subs.length ? ` e as ${c.subs.length} subcategoria(s)` : ""}</button>`,
    primaryLabel: "Gravar",
    secondaryLabel: "Cancelar",
    onRender: ({ panel, close }) => {
      panel.querySelector("#ceApagar").addEventListener("click", async () => {
        const msg = c.produtos ? `Apagar «${c.name}»? Os ${c.produtos} produto(s) que a usam ficam sem categoria.` : `Apagar «${c.name}»?`;
        if (!window.confirm(msg)) return;
        try {
          await apiRequest(`/catalog-categories/${encodeURIComponent(c.id)}`, { method: "DELETE" });
          toast("Categoria apagada.", { type: "success" });
          close();
          carregar();
        } catch (e) {
          toast(erro(e), { type: "error" });
        }
      });
    },
    onPrimary: async ({ body, close, btn }) => {
      btn.disabled = true;
      try {
        await apiRequest(`/catalog-categories/${encodeURIComponent(c.id)}`, {
          method: "PATCH",
          body: { name: body.querySelector("#ceNome").value.trim(), kind: body.querySelector("#ceTipo").value },
        });
        close();
        carregar();
      } catch (e) {
        btn.disabled = false;
        toast(erro(e), { type: "error" });
      }
    },
  });
}

async function init() {
  const ok = await guardPageAccess("materiais", "view");
  if (!ok) return;
  await initPermissionLayer();
  wireLogout();
  wireUsersNav();
  el("catAdd")?.addEventListener("click", async () => {
    const nome = el("catNova").value.trim();
    if (nome.length < 2) return toast("Escreva o nome da categoria.", { type: "error" });
    try {
      await apiRequest("/catalog-categories", { method: "POST", body: { name: nome, kind: el("catTipo").value } });
      el("catNova").value = "";
      toast("Categoria criada.", { type: "success" });
      carregar();
    } catch (e) {
      toast(erro(e), { type: "error" });
    }
  });
  el("catNova")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el("catAdd").click();
  });
  document.addEventListener("click", async (e) => {
    const t = e.target;
    const f = t.closest("[data-f]");
    if (f) {
      filtro = f.dataset.f;
      return desenhar();
    }
    const ce = t.closest("[data-cated]");
    if (ce) return editarCategoria(cats.find((c) => c.id === ce.dataset.cated));
    const sn = t.closest("[data-subnew]");
    if (sn) {
      const c = cats.find((x) => x.id === sn.dataset.subnew);
      const nome = window.prompt(`Nova subcategoria de ${c.name}:`);
      if (!nome || nome.trim().length < 2) return;
      try {
        await apiRequest("/catalog-categories", { method: "POST", body: { name: nome.trim(), parentId: c.id } });
        return carregar();
      } catch (err) {
        return toast(erro(err), { type: "error" });
      }
    }
    const se = t.closest("[data-subed]");
    if (se) {
      const { s } = acharSub(se.dataset.subed);
      const nome = window.prompt("Novo nome da subcategoria:", s?.name || "");
      if (!nome || nome.trim().length < 2 || nome.trim() === s.name) return;
      try {
        await apiRequest(`/catalog-categories/${encodeURIComponent(s.id)}`, { method: "PATCH", body: { name: nome.trim() } });
        return carregar();
      } catch (err) {
        return toast(erro(err), { type: "error" });
      }
    }
    const sd = t.closest("[data-subdel]");
    if (sd) {
      const { s } = acharSub(sd.dataset.subdel);
      if (!window.confirm(`Apagar a subcategoria «${s.name}»?${s.produtos ? ` Os ${s.produtos} produto(s) que a usam ficam sem subcategoria.` : ""}`)) return;
      try {
        await apiRequest(`/catalog-categories/${encodeURIComponent(s.id)}`, { method: "DELETE" });
        return carregar();
      } catch (err) {
        return toast(erro(err), { type: "error" });
      }
    }
  });
  await carregar();
}

init();
