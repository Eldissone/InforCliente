import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../../shared/ui.js";
import { formatCurrencyBRL, formatDateBR, formatPercent } from "../../shared/format.js";

function el(id) {
  return document.getElementById(id);
}

function getProjectId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function statusLabel(s) {
  if (s === "PAID") return { text: "Liquidado", cls: "text-emerald-700", dot: "bg-[#2afc8d]" };
  if (s === "LATE") return { text: "Atrasado", cls: "text-error", dot: "bg-error" };
  return { text: "Pendente", cls: "text-slate-400", dot: "bg-slate-300" };
}

function catLabel(c) {
  if (c === "MATERIALS") return "MATERIAIS";
  if (c === "EQUIPMENT") return "EQUIPAMENTOS";
  if (c === "LABOR") return "MÃO DE OBRA";
  return "OUTROS";
}

function renderTxRow(t) {
  const st = statusLabel(t.status);
  return `
    <tr class="hover:bg-surface-container-low transition-colors group">
      <td class="px-8 py-4 text-sm">${formatDateBR(t.date)}</td>
      <td class="px-8 py-4">
        <div class="font-bold text-on-surface">${t.description}</div>
      </td>
      <td class="px-8 py-4">
        <span class="bg-surface-container px-2 py-1 rounded text-[10px] font-bold">${catLabel(t.category)}</span>
      </td>
      <td class="px-8 py-4 text-sm font-medium">${t.ownerName || "-"}</td>
      <td class="px-8 py-4">
        <div class="flex items-center gap-2 ${st.cls}">
          <span class="w-2 h-2 rounded-full ${st.dot} ${t.status === "PAID" ? "shadow-[0_0_6px_#2afc8d]" : ""}"></span>
          <span class="text-xs font-semibold">${st.text}</span>
        </div>
      </td>
      <td class="px-8 py-4 text-right font-bold text-on-surface">${formatCurrencyBRL(t.amount)}</td>
    </tr>
  `;
}

async function loadProject() {
  const id = getProjectId();
  const data = await apiRequest(`/projects/${encodeURIComponent(id)}`);
  const p = data.project;

  el("projectTitle").textContent = p.name;
  el("projectBreadcrumb").textContent = p.code;

  el("budgetTotal").textContent = formatCurrencyBRL(p.budgetTotal);
  el("budgetConsumed").textContent = formatCurrencyBRL(p.budgetConsumed);
  el("budgetCommitted").textContent = formatCurrencyBRL(p.budgetCommitted);
  el("budgetAvailable").textContent = formatCurrencyBRL(p.budgetAvailable);

  const total = Number(p.budgetTotal || 0);
  const consumed = Number(p.budgetConsumed || 0);
  const pct = total > 0 ? Math.round((consumed / total) * 100) : 0;
  el("budgetDelta").textContent = `Consumido: ${formatPercent(pct, { digits: 0 })}`;
  if (el("budgetBar")) el("budgetBar").style.width = `${Math.max(0, Math.min(100, pct))}%`;

  el("physicalProgress").textContent = formatPercent(p.physicalProgressPct || 0, { digits: 0 });

  return p;
}

let txState = { search: "" };

async function loadTransactions() {
  const id = getProjectId();
  const tbody = el("transactionsTbody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td class="px-8 py-6 text-sm text-on-surface-variant" colspan="6">Carregando...</td></tr>`;
  const qs = new URLSearchParams({
    search: txState.search,
    page: "1",
    pageSize: "20",
  });
  const data = await apiRequest(`/projects/${encodeURIComponent(id)}/transactions?${qs.toString()}`);
  if (!data.items?.length) {
    tbody.innerHTML = `<tr><td class="px-8 py-6 text-sm text-on-surface-variant" colspan="6">Sem lançamentos.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.items.map(renderTxRow).join("");
}

function wireSearch() {
  const input = el("transactionsSearch");
  let t = null;
  input?.addEventListener("input", () => {
    txState.search = input.value.trim();
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => loadTransactions().catch(() => toast("Erro ao carregar lançamentos", { type: "error" })), 250);
  });
}

function wireExport() {
  el("exportProjectBtn")?.addEventListener("click", async () => {
    const id = getProjectId();
    const project = (await apiRequest(`/projects/${encodeURIComponent(id)}`)).project;
    const tx = await apiRequest(`/projects/${encodeURIComponent(id)}/transactions?page=1&pageSize=200`);

    const lines = [
      ["Projeto", project.name],
      ["Código", project.code],
      ["Orçamento_total", project.budgetTotal],
      ["Consumido", project.budgetConsumed],
      [],
      ["data", "descricao", "categoria", "responsavel", "status", "valor"],
      ...(tx.items || []).map((t) => [
        new Date(t.date).toISOString(),
        String(t.description || "").replaceAll('"', '""'),
        t.category,
        t.ownerName || "",
        t.status,
        t.amount,
      ]),
    ];
    const csv = lines
      .map((row) => (row.length ? row.map((c) => `"${String(c ?? "")}"`).join(",") : ""))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `projeto-${project.code}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function wireNewTransaction() {
  el("newTransactionBtn")?.addEventListener("click", () => {
    openModal({
      title: "Novo lançamento",
      primaryLabel: "Salvar",
      contentHtml: `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Descrição</label>
            <input id="t_desc" class="w-full rounded-lg border-slate-300" placeholder="Descrição..." />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Categoria</label>
            <select id="t_cat" class="w-full rounded-lg border-slate-300">
              <option value="MATERIALS">Materiais</option>
              <option value="EQUIPMENT">Equipamentos</option>
              <option value="LABOR">Mão de obra</option>
              <option value="OTHER">Outros</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Status</label>
            <select id="t_status" class="w-full rounded-lg border-slate-300">
              <option value="PENDING">Pendente</option>
              <option value="PAID">Liquidado</option>
              <option value="LATE">Atrasado</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Responsável</label>
            <input id="t_owner" class="w-full rounded-lg border-slate-300" placeholder="Nome" />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Valor (R$)</label>
            <input id="t_amount" type="number" step="0.01" class="w-full rounded-lg border-slate-300" value="0" />
          </div>
        </div>
      `,
      onPrimary: async ({ close, panel }) => {
        const id = getProjectId();
        const v = (x) => panel.querySelector(`#${x}`)?.value?.trim?.();
        await apiRequest(`/projects/${encodeURIComponent(id)}/transactions`, {
          method: "POST",
          body: {
            description: v("t_desc"),
            category: v("t_cat"),
            status: v("t_status"),
            ownerName: v("t_owner") || null,
            amount: Number(v("t_amount") || 0),
          },
        });
        toast("Lançamento criado", { type: "success" });
        close();
        await loadTransactions();
      },
    });
  });
}

async function init() {
  await loadProject();
  await loadTransactions();
  wireSearch();
  wireExport();
  wireNewTransaction();
}

init().catch(() => toast("Falha ao carregar projeto. Verifique login/API.", { type: "error" }));

