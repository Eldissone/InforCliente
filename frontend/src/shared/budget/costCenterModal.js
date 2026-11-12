// Modal e CRUD de Centro de Custo
import { apiRequest } from "/services/api.js";

let _ctx = null;
const ctx = () => _ctx;

/** ctx: { getProject, getCostCenters, showToast(msg,type), onChanged() } */
export function initCostCenterModal(context) {
  _ctx = context;
}

const MODAL_HTML = `    <div class="modal-overlay" id="modalCC">
        <div class="modal-box">
            <div class="flex items-center justify-between mb-6">
                <h2 id="modalCCTitle" class="text-lg font-bold text-slate-900">Novo Centro de Custo</h2>
                <button type="button" onclick="document.getElementById('modalCC').classList.remove('open')"
                    aria-label="Fechar"
                    class="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 transition-all">
                    <span class="material-symbols-outlined text-base">close</span>
                </button>
            </div>
            <form id="formCC" class="flex flex-col gap-4">
                <input type="hidden" id="ccId">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label for="ccCode"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Código
                            *</label>
                        <input id="ccCode" type="text" placeholder="CC001" required maxlength="20"
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/40">
                    </div>
                    <div>
                        <label for="ccCurrency"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Moeda
                            *</label>
                        <select id="ccCurrency" required
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/40">
                            <option value="AOA">AOA (Kwanza)</option>
                            <option value="USD">USD (Dólar)</option>
                            <option value="EUR">EUR (Euro)</option>
                            <option value="ZAR">ZAR (Rand)</option>
                        </select>
                    </div>
                    <div class="md:col-span-1">
                        <label for="ccName"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Nome
                            *</label>
                        <input id="ccName" type="text" placeholder="Terraplanagem" required
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/40">
                    </div>
                    <div class="md:col-span-1">
                        <label for="ccActive"
                            class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Estado
                            *</label>
                        <select id="ccActive" required
                            class="w-full h-11 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#2afc8d]/40">
                            <option value="true">Ativo</option>
                            <option value="false">Inativo</option>
                        </select>
                    </div>
                </div>
                <label class="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer">
                    <input type="checkbox" id="ccRequiresQuotation" class="mt-0.5 rounded border-slate-300 text-emerald-600 accent-emerald-600" checked>
                    <span>
                        <span class="block text-sm font-bold text-slate-800">Requer pesquisa de fornecedor (cotação)</span>
                        <span class="block text-xs text-slate-500 mt-0.5">Desmarque para CCs com preços fixos ou sem ida a mercado — não entram no envio em lote para cotação.</span>
                    </span>
                </label>
                <div class="flex gap-3 justify-end pt-2">
                    <button type="button" onclick="document.getElementById('modalCC').classList.remove('open')"
                        class="h-10 px-5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all">Cancelar</button>
                    <button type="submit" id="ccSubmitBtn"
                        class="h-10 px-6 rounded-xl bg-[#212e3e] text-white text-sm font-bold hover:bg-slate-800 transition-all">Guardar</button>
                </div>
            </form>
        </div>
    </div>`;

function ensureModal() {
  if (document.getElementById("modalCC")) return;
  document.body.insertAdjacentHTML("beforeend", MODAL_HTML);
  document.getElementById("formCC").addEventListener("submit", submitCC);
}

export function openCCModal(cc = null) {
  ensureModal();
  document.getElementById("modalCCTitle").textContent = cc ? "Editar Centro de Custo" : "Novo Centro de Custo";
  document.getElementById("ccId").value = cc?.id || "";
  document.getElementById("ccCode").value = cc?.code || "";
  document.getElementById("ccName").value = cc?.name || "";
  document.getElementById("ccCurrency").value = cc?.currency || "AOA";
  document.getElementById("ccActive").value = cc?.active !== false ? "true" : "false";
  document.getElementById("ccRequiresQuotation").checked = cc?.requiresQuotation !== false;
  document.getElementById("modalCC").classList.add("open");
}

export function editCC(id) {
  const cc = ctx().getCostCenters().find((x) => x.id === id);
  if (cc) openCCModal(cc);
}

export async function deleteCC(id, name) {
  if (!confirm(`Eliminar "${name}"?\nTodos os dados associados serão perdidos.`)) return;
  try {
    await apiRequest(`/cost-centers/${id}`, { method: "DELETE" });
    ctx().showToast("Centro de custo eliminado", "success");
    await ctx().onChanged();
  } catch (err) {
    ctx().showToast("Erro: " + err.message, "error");
  }
}

async function submitCC(e) {
  e.preventDefault();
  const id = document.getElementById("ccId").value;
  const body = {
    code: document.getElementById("ccCode").value.trim(),
    name: document.getElementById("ccName").value.trim(),
    currency: document.getElementById("ccCurrency").value,
    active: document.getElementById("ccActive").value === "true",
    requiresQuotation: document.getElementById("ccRequiresQuotation").checked,
  };
  try {
    if (id) {
      await apiRequest(`/cost-centers/${id}`, { method: "PATCH", body });
      ctx().showToast("Centro de custo actualizado", "success");
    } else {
      await apiRequest(`/cost-centers/project/${ctx().getProject().id}`, { method: "POST", body });
      ctx().showToast("Centro de custo criado", "success");
    }
    document.getElementById("modalCC").classList.remove("open");
    await ctx().onChanged();
  } catch (err) {
    ctx().showToast("Erro: " + err.message, "error");
  }
}
