import { apiRequest } from "../../services/api.js";
import { openModal, setText, toast, setButtonLoading, renderLoadingRow } from "../../shared/ui.js";
import { formatCurrencyKZ, formatPercent, formatDateBR } from "../../shared/format.js";
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

function renderLinkedProjectCard(project) {
  const progress = Math.max(0, Math.min(100, Number(project.physicalProgressPct || 0)));
  return `
    <article class="rounded-2xl border border-outline-variant/30 bg-white p-6 shadow-sm">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-[10px] font-black uppercase tracking-widest text-primary">${project.code}</div>
          <h4 class="mt-1 text-lg font-extrabold text-[#212e3e]">${project.name}</h4>
          <p class="mt-2 text-sm text-on-surface-variant">${project.location || "Morada não informada"}</p>
        </div>
        <button data-open-project="${project.id}" class="rounded-lg bg-primary-container px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:brightness-110">
          Abrir
        </button>
      </div>
      <div class="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div class="rounded-xl bg-surface-container-low px-4 py-3">
          <div class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Contatos</div>
          <div class="mt-1 font-semibold text-on-surface">${project.contact || "-"}</div>
          <div class="mt-1 font-semibold text-on-surface">${project.accountEmail || "-"}</div>
        </div>
        <div class="rounded-xl bg-surface-container-low px-4 py-3">
          <div class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Orçamento</div>
          <div class="mt-1 font-semibold text-on-surface">${formatCurrencyKZ(project.budgetTotal)}</div>
        </div>
        <div class="rounded-xl bg-surface-container-low px-4 py-3">
          <div class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Início</div>
          <div class="mt-1 font-semibold text-on-surface">${formatDateBR(project.startDate)}</div>
        </div>
        <div class="rounded-xl bg-surface-container-low px-4 py-3">
          <div class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Fim</div>
          <div class="mt-1 font-semibold text-on-surface">${formatDateBR(project.dueDate)}</div>
        </div>
      </div>
      <div class="mt-5">
        <div class="mb-2 flex items-center justify-between text-xs font-bold text-on-surface-variant">
          <span>Progresso</span>
        </div>
        <div class="h-2 rounded-full bg-surface-container overflow-hidden">
          <div class="h-full rounded-full bg-[#2afc8d]" style="width:${progress}%"></div>
        </div>
      </div>
    </article>
  `;
}

function renderClientProjects(projects) {
  const host = el("clientProjects");
  const count = el("clientProjectsCount");
  if (!host || !count) return;

  count.textContent = `${projects.length} ${projects.length === 1 ? "obra" : "obras"}`;
  if (!projects.length) {
    host.innerHTML = `<div class="rounded-2xl border border-dashed border-outline-variant bg-surface-container-low px-6 py-8 text-sm text-on-surface-variant">Nenhuma obra vinculada a este cliente.</div>`;
    return;
  }

  host.innerHTML = projects.map(renderLinkedProjectCard).join("");
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
  if (c.profilePic) {
    const imgEl = el("clientProfilePic");
    if (imgEl) {
      imgEl.src = c.profilePic;
      imgEl.classList.remove("grayscale"); // Optional: remove grayscale if it's a custom photo
    }
  }

  setText(el("clientLocationTier"), `${c.region || "Região não informada"} • ${c.tier || "Tier não informado"}`);
  setText(el("clientAccountEmail"), c.accountEmail || "Sem conta vinculada");

  const statusBadgeEl = el("clientStatusBadge");
  if (statusBadgeEl) {
    const s = c.status || "ACTIVE";
    const labels = { ACTIVE: "Ativo", AT_RISK: "Em Risco", INACTIVE: "Inativo" };
    const colors = {
      ACTIVE: "border-tertiary/30 bg-tertiary/10 text-tertiary",
      AT_RISK: "border-error/30 bg-error/10 text-error",
      INACTIVE: "border-outline/30 bg-surface-container-high text-on-surface-variant"
    };
    statusBadgeEl.className = `flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase w-fit ${colors[s]}`;
    statusBadgeEl.innerHTML = `<span class="size-1.5 rounded-full ${s === 'AT_RISK' ? 'bg-error' : s === 'INACTIVE' ? 'bg-outline' : 'bg-tertiary'}"></span>${labels[s]}`;
  }

  const tagsHost = el("clientTags");
  if (tagsHost) {
    const industryTag = c.industry ? `<span class="px-3 py-1 rounded-full bg-surface-container text-on-surface-variant text-[10px] font-black uppercase tracking-wider">${c.industry}</span>` : "";
    const otherTags = (c.tags || []).map(t => `<span class="px-3 py-1 rounded-full bg-[#2afc8d]/10 text-[#005229] text-[10px] font-black uppercase tracking-wider">${t}</span>`).join("");
    tagsHost.innerHTML = industryTag + otherTags;
  }

  renderClientProjects(c.projects || []);

  return c;
}

async function loadTimeline() {
  const id = getClientId();
  const host = el("clientTimeline");
  if (!host) return;
  host.innerHTML = renderLoadingRow(1);

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
        const btn = panel.querySelector("[data-primary]");
        try {
          setButtonLoading(btn, true);
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
        } catch (err) {
          setButtonLoading(btn, false);
          toast(err.message || "Erro ao adicionar interação", { type: "error" });
        }
      },
    });
  });
}

function wireProjectLinks() {
  document.addEventListener("click", (e) => {
    const id = e.target?.closest?.("[data-open-project]")?.getAttribute?.("data-open-project");
    if (!id) return;
    window.location.href = `../Projectos/projectView.html?id=${encodeURIComponent(id)}`;
  });
}

async function init() {
  wireLogout();
  wireUsersNav();
  wireProjectLinks();
  await loadClient();
  await loadTimeline();
  wireFullHistory();
  wireFab();
}

init().catch(() => toast("Falha ao carregar cliente. Verifique login/API.", { type: "error" }));
