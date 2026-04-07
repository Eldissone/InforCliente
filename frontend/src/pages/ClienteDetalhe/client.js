import { apiRequest } from "../../services/api.js";
import { openModal, setText, toast } from "../../shared/ui.js";
import { formatCurrencyBRL, formatPercent, formatDateBR } from "../../shared/format.js";
import { wireLogout, wireUsersNav } from "../../shared/session.js";

function el(id) {
  return document.getElementById(id);
}

function getClientId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function timelineDotColor(type) {
  if (String(type).toLowerCase().includes("support")) return "border-primary-container";
  if (String(type).toLowerCase().includes("upgrade")) return "border-primary-container";
  return "border-[#2afc8d]";
}

function renderTimelineItem(item) {
  return `
    <div class="relative pl-6 border-l-2 border-surface-container group">
      <div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-white border-2 ${timelineDotColor(
        item.type
      )} group-hover:scale-125 transition-transform"></div>
      <span class="text-[10px] font-black text-on-surface-variant block mb-1">${formatDateBR(item.occurredAt)}</span>
      <h4 class="font-bold text-[#212e3e] text-sm mb-2">${item.title}</h4>
      <p class="text-xs text-on-surface-variant mb-3 leading-relaxed">${item.description || ""}</p>
      ${
        item.leadName
          ? `<span class="text-[10px] text-on-surface-variant italic">Lead: ${item.leadName}</span>`
          : ""
      }
    </div>
  `;
}

async function loadClient() {
  const id = getClientId();
  if (!id) throw new Error("missing id");

  const data = await apiRequest(`/clients/${encodeURIComponent(id)}`);
  const c = data.client;

  setText(el("clientName"), c.name);
  setText(el("clientCode"), `ID: ${c.code}`);

  const health = Math.max(0, Math.min(100, Number(c.healthScore || 0)));
  setText(el("clientHealthScore"), String(health));
  if (el("clientHealthBar")) el("clientHealthBar").style.width = `${health}%`;

  const churn = Math.max(0, Math.min(100, Number(c.churnRisk || 0)));
  setText(el("clientChurnRisk"), String(c.churnRisk ?? "-"));
  if (el("clientChurnBar")) el("clientChurnBar").style.width = `${Math.max(0, Math.min(100, churn))}%`;

  setText(el("clientLtvPotential"), formatCurrencyBRL(c.ltvPotential));

  return c;
}

async function loadTimeline() {
  const id = getClientId();
  const host = el("clientTimeline");
  if (!host) return;
  host.innerHTML = `<div class="text-sm text-on-surface-variant">Carregando...</div>`;

  const data = await apiRequest(`/clients/${encodeURIComponent(id)}/interactions`);
  const items = data.items || [];
  if (!items.length) {
    host.innerHTML = `<div class="text-sm text-on-surface-variant">Sem interações registradas.</div>`;
    return;
  }
  host.innerHTML = items.slice(0, 8).map(renderTimelineItem).join("");
}

function wireFullHistory() {
  el("viewFullHistory")?.addEventListener("click", async () => {
    const id = getClientId();
    const data = await apiRequest(`/clients/${encodeURIComponent(id)}/interactions`);
    const items = data.items || [];
    openModal({
      title: "Histórico completo",
      primaryLabel: "Fechar",
      secondaryLabel: "OK",
      contentHtml: `
        <div class="space-y-3 max-h-[60vh] overflow-auto">
          ${items
            .map(
              (i) => `
            <div class="border border-slate-200 rounded-xl p-4">
              <div class="text-[10px] font-black uppercase tracking-widest text-slate-500">${formatDateBR(
                i.occurredAt
              )} • ${i.type}</div>
              <div class="mt-1 font-extrabold text-slate-900">${i.title}</div>
              <div class="mt-1 text-sm text-slate-700">${i.description || ""}</div>
              ${i.leadName ? `<div class="mt-2 text-xs text-slate-500">Lead: ${i.leadName}</div>` : ""}
            </div>
          `
            )
            .join("")}
        </div>
      `,
      onPrimary: async ({ close }) => close(),
    });
  });
}

function wireFab() {
  el("clientFab")?.addEventListener("click", () => {
    openModal({
      title: "Adicionar interação",
      primaryLabel: "Salvar",
      contentHtml: `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Tipo</label>
            <input id="i_type" class="w-full rounded-lg border-slate-300" placeholder="SupportTicket" />
          </div>
          <div>
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Lead</label>
            <input id="i_lead" class="w-full rounded-lg border-slate-300" placeholder="Nome" />
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Título</label>
            <input id="i_title" class="w-full rounded-lg border-slate-300" placeholder="Executive Review" />
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Descrição</label>
            <textarea id="i_desc" class="w-full rounded-lg border-slate-300" rows="4" placeholder="Detalhes..."></textarea>
          </div>
        </div>
      `,
      onPrimary: async ({ close, panel }) => {
        const id = getClientId();
        const v = (x) => panel.querySelector(`#${x}`)?.value?.trim?.();
        await apiRequest(`/clients/${encodeURIComponent(id)}/interactions`, {
          method: "POST",
          body: {
            type: v("i_type") || "Note",
            title: v("i_title") || "Interação",
            description: v("i_desc") || null,
            leadName: v("i_lead") || null,
          },
        });
        toast("Interação adicionada", { type: "success" });
        close();
        await loadTimeline();
      },
    });
  });
}

async function init() {
  wireLogout();
  wireUsersNav();
  await loadClient();
  await loadTimeline();
  wireFullHistory();
  wireFab();
}

init().catch(() => toast("Falha ao carregar cliente. Verifique login/API.", { type: "error" }));

