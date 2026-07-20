import { apiRequest } from "../services/api.js";
import { openModal, escapeHtml as esc, toast, setButtonLoading } from "./ui.js";
import { formatCurrency } from "./format.js";

const STATUS_LABELS = {
  PENDENTE: { text: "Pendente", cls: "bg-slate-100 text-slate-600" },
  EM_ANALISE: { text: "Em análise", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { text: "Aprovado", cls: "bg-sky-50 text-sky-700" },
  PAGO: { text: "Pago", cls: "bg-emerald-50 text-emerald-700" },
  CANCELADO: { text: "Cancelado", cls: "bg-red-50 text-red-600" },
};

let _eligibleQuotes = [];
let _carriers = [];
let _allocationRows = [];

function statusBadge(status) {
  const s = STATUS_LABELS[status] || STATUS_LABELS.PENDENTE;
  return `<span class="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide ${s.cls}">${s.text}</span>`;
}

function renderAllocationRows() {
  const tbody = document.getElementById("freightAllocBody");
  const sumEl = document.getElementById("freightAllocSum");
  if (!tbody) return;

  if (!_allocationRows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-xs text-slate-400 font-semibold">Adicione linhas de rateio</td></tr>`;
    if (sumEl) sumEl.textContent = "0,00 AOA";
    return;
  }

  tbody.innerHTML = _allocationRows
    .map(
      (row, idx) => `
    <tr class="border-t border-slate-100">
      <td class="py-2 px-2 text-xs font-semibold text-slate-700">${esc(row.projectLabel || "—")}</td>
      <td class="py-2 px-2 text-xs text-slate-600">${esc(row.description)}</td>
      <td class="py-2 px-2 text-xs font-bold text-right tabular-nums">${formatCurrency(row.amount, "AOA")}</td>
      <td class="py-2 px-2 text-right">
        <button type="button" data-remove-alloc="${idx}" class="text-red-400 hover:text-red-600"><span class="material-symbols-outlined text-base">delete</span></button>
      </td>
    </tr>`
    )
    .join("");

  const sum = _allocationRows.reduce((a, r) => a + Number(r.amount || 0), 0);
  if (sumEl) sumEl.textContent = formatCurrency(sum, "AOA");

  tbody.querySelectorAll("[data-remove-alloc]").forEach((btn) => {
    btn.onclick = () => {
      _allocationRows.splice(Number(btn.dataset.removeAlloc), 1);
      renderAllocationRows();
    };
  });
}

function openFreightCreateModal({ onSaved } = {}) {
  _allocationRows = [];

  openModal({
    title: "Novo frete com rateio",
    primaryLabel: "Guardar frete",
    contentHtml: `
      <div class="flex flex-col gap-4 max-h-[70vh] overflow-y-auto pr-1">
        <div>
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Transportador *</label>
          <select id="freightSupplierId" required class="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"></select>
          <p class="text-[10px] text-slate-400 mt-1">Apenas fornecedores tipo Transportador</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total do frete *</label>
            <input id="freightTotal" type="number" min="0" step="0.01" required class="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold" />
          </div>
          <div>
            <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Notas</label>
            <input id="freightNotes" type="text" class="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm" placeholder="Opcional" />
          </div>
        </div>
        <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl">
          <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Adicionar linha de rateio</p>
          <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
            <div class="sm:col-span-5">
              <label class="text-[10px] font-bold text-slate-400">Encomenda / material</label>
              <select id="freightQuotePick" class="w-full h-10 px-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold"></select>
            </div>
            <div class="sm:col-span-4">
              <label class="text-[10px] font-bold text-slate-400">Descrição</label>
              <input id="freightLineDesc" type="text" class="w-full h-10 px-2 bg-white border border-slate-200 rounded-lg text-xs" placeholder="Ex.: Frete poste" />
            </div>
            <div class="sm:col-span-2">
              <label class="text-[10px] font-bold text-slate-400">Valor</label>
              <input id="freightLineAmount" type="number" min="0" step="0.01" class="w-full h-10 px-2 bg-white border border-slate-200 rounded-lg text-xs font-bold" />
            </div>
            <div class="sm:col-span-1">
              <button type="button" id="freightAddLine" class="w-full h-10 rounded-lg bg-[#0f172a] text-[#2afc8d] text-xs font-black">+</button>
            </div>
          </div>
        </div>
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left">
            <thead class="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <tr><th class="py-2 px-2">Obra</th><th class="py-2 px-2">Descrição</th><th class="py-2 px-2 text-right">Valor</th><th class="py-2 px-2"></th></tr>
            </thead>
            <tbody id="freightAllocBody"></tbody>
          </table>
        </div>
        <div class="flex justify-between items-center text-xs font-bold">
          <span class="text-slate-500 uppercase tracking-wide">Soma alocações</span>
          <span id="freightAllocSum" class="text-[#0f172a] tabular-nums">0,00 AOA</span>
        </div>
      </div>`,
    onPrimary: async ({ close, btn }) => {
      const supplierId = document.getElementById("freightSupplierId")?.value;
      const totalAmount = document.getElementById("freightTotal")?.value;
      const notes = document.getElementById("freightNotes")?.value?.trim();

      if (!supplierId) return toast("Seleccione o transportador", { type: "error" });
      if (!_allocationRows.length) return toast("Adicione pelo menos uma linha de rateio", { type: "error" });

      setButtonLoading(btn, true);
      try {
        await apiRequest("/freight-orders", {
          method: "POST",
          body: {
            supplierId,
            totalAmount,
            notes: notes || null,
            allocations: _allocationRows.map((r) => ({
              needQuoteId: r.needQuoteId || null,
              projectId: r.projectId,
              costCenterId: r.costCenterId || null,
              description: r.description,
              amount: r.amount,
            })),
          },
        });
        toast("Frete registado");
        close();
        await onSaved?.();
      } catch (e) {
        toast(e.message || "Erro ao guardar frete", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
    onRender: () => {
      const supSel = document.getElementById("freightSupplierId");
      supSel.innerHTML =
        `<option value="">— Seleccionar —</option>` +
        _carriers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");

      const quoteSel = document.getElementById("freightQuotePick");
      quoteSel.innerHTML =
        _eligibleQuotes
          .map(
            (q) =>
              `<option value="${q.id}">${esc(q.project?.name || "Obra")} · ${esc(q.description?.slice(0, 40) || "—")}</option>`
          )
          .join("") || `<option value="">Sem encomendas disponíveis</option>`;

      quoteSel.onchange = () => {
        const q = _eligibleQuotes.find((x) => x.id === quoteSel.value);
        const desc = document.getElementById("freightLineDesc");
        if (q && desc && !desc.value) {
          desc.value = `Frete — ${q.description || ""}`.trim();
        }
      };

      document.getElementById("freightAddLine")?.addEventListener("click", () => {
        const quoteId = document.getElementById("freightQuotePick")?.value;
        const description = document.getElementById("freightLineDesc")?.value?.trim();
        const amount = Number(document.getElementById("freightLineAmount")?.value);
        if (!quoteId) return toast("Seleccione uma encomenda/material", { type: "error" });
        if (!description) return toast("Descrição obrigatória", { type: "error" });
        if (!amount || amount <= 0) return toast("Valor inválido", { type: "error" });

        const q = _eligibleQuotes.find((x) => x.id === quoteId);
        _allocationRows.push({
          needQuoteId: q?.id || null,
          projectId: q?.projectId,
          costCenterId: q?.costCenterId || null,
          projectLabel: q?.project?.name || "—",
          description,
          amount,
        });
        document.getElementById("freightLineDesc").value = "";
        document.getElementById("freightLineAmount").value = "";
        renderAllocationRows();
      });

      renderAllocationRows();
    },
  });
}

async function freightAction(id, action, reload) {
  const paths = {
    submit: `/freight-orders/${id}/submit-analysis`,
    approve: `/freight-orders/${id}/approve`,
    finance: `/freight-orders/${id}/send-to-finance`,
  };
  try {
    if (action === "finance") {
      await apiRequest(paths.finance, { method: "POST", body: {} });
      toast("Frete enviado ao financeiro");
    } else {
      await apiRequest(paths[action], { method: "PATCH" });
      toast(action === "approve" ? "Frete aprovado" : "Submetido para análise");
    }
    await reload?.();
  } catch (e) {
    toast(e.message || "Erro", { type: "error" });
  }
}

export async function renderFreightTab(container) {
  const [{ items: orders }, { items: quotes }, { items: carriers }] = await Promise.all([
    apiRequest("/freight-orders"),
    apiRequest("/freight-orders/eligible-quotes"),
    apiRequest("/freight-orders/carriers"),
  ]);

  _eligibleQuotes = quotes || [];
  _carriers = carriers || [];

  container.innerHTML = `
    <div class="flex flex-col gap-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-900">Frete &amp; Rateio</h2>
          <p class="text-xs text-slate-500 font-medium">Um transporte, várias obras — um pagamento ao transportador</p>
        </div>
        <button id="btnNewFreight" class="h-10 px-4 rounded-xl bg-slate-900 text-[#2afc8d] text-xs font-black flex items-center gap-2">
          <span class="material-symbols-outlined text-base">local_shipping</span> Novo frete
        </button>
      </div>
      <div class="overflow-x-auto bg-white border border-slate-200 rounded-2xl shadow-sm">
        <table class="w-full text-left min-w-[720px]">
          <thead class="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-200">
            <tr>
              <th class="py-3 px-4">Transportador</th>
              <th class="py-3 px-4 text-right">Total</th>
              <th class="py-3 px-4">Obras</th>
              <th class="py-3 px-4">Estado</th>
              <th class="py-3 px-4 text-right">Acções</th>
            </tr>
          </thead>
          <tbody id="freightOrdersBody"></tbody>
        </table>
      </div>
    </div>`;

  const tbody = container.querySelector("#freightOrdersBody");
  const reload = () => renderFreightTab(container);

  if (!orders?.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-sm text-slate-400 font-semibold">Sem fretes registados</td></tr>`;
  } else {
    tbody.innerHTML = orders
      .map((o) => {
        const projects = [...new Set((o.allocations || []).map((a) => a.project?.name).filter(Boolean))];
        const actions = [];
        if (o.status === "PENDENTE") {
          actions.push(`<button data-fa="${o.id}" data-act="submit" class="text-[10px] font-black uppercase text-amber-600 hover:underline">Análise</button>`);
          actions.push(`<button data-fa="${o.id}" data-act="approve" class="text-[10px] font-black uppercase text-sky-600 hover:underline ml-2">Aprovar</button>`);
        } else if (o.status === "EM_ANALISE") {
          actions.push(`<button data-fa="${o.id}" data-act="approve" class="text-[10px] font-black uppercase text-sky-600 hover:underline">Aprovar</button>`);
        } else if (o.status === "APPROVED" && !o.costPaymentId) {
          actions.push(`<button data-fa="${o.id}" data-act="finance" class="text-[10px] font-black uppercase text-emerald-600 hover:underline">→ Financeiro</button>`);
        }
        return `<tr class="border-t border-slate-100 hover:bg-slate-50/50">
          <td class="py-3 px-4 text-sm font-bold text-slate-800">${esc(o.supplier?.name || "—")}</td>
          <td class="py-3 px-4 text-sm font-black text-right tabular-nums">${formatCurrency(o.totalAmount, o.currency)}</td>
          <td class="py-3 px-4 text-xs text-slate-600">${esc(projects.join(", ") || "—")}</td>
          <td class="py-3 px-4">${statusBadge(o.status)}</td>
          <td class="py-3 px-4 text-right">${actions.join("") || "—"}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll("[data-fa]").forEach((btn) => {
      btn.onclick = () => freightAction(btn.dataset.fa, btn.dataset.act, reload);
    });
  }

  container.querySelector("#btnNewFreight")?.addEventListener("click", () => {
    openFreightCreateModal({ onSaved: reload });
  });
}
