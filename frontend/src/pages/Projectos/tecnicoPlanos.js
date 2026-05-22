import { apiRequest, getApiBaseUrl, getAssetUrl } from "../../services/api.js";
import { checkAuth } from "../../services/auth.js";
import { openModal, setText, toast, setButtonLoading } from "../../shared/ui.js";
import { wireLogout } from "../../shared/session.js";

// Check authentication and authorize role
const currentUser = checkAuth({ allowedRoles: ["tecnico", "admin", "supervisor", "operador"] });

const state = {
  plans: [],
  activeTab: "active", // "active" or "history"
};

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(unsafe) {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateBR(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function renderStatusBadge(status) {
  switch (status) {
    case "DRAFT":
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
        <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Rascunho
      </span>`;
    case "PENDING_MATERIAL":
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-100">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span> Aguardando Material
      </span>`;
    case "IN_PROGRESS":
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100 pulse-emerald">
        <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span> Em Execução
      </span>`;
    case "PENDING_VALIDATION":
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-orange-50 text-orange-700 border border-orange-100 animate-pulse">
        <span class="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span> Pendente Validação
      </span>`;
    case "PENDING_RETURN":
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100 animate-pulse">
        <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span> Aguardando Devolução Logística
      </span>`;
    case "COMPLETED":
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Concluído
      </span>`;
    default:
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">${status}</span>`;
  }
}

async function loadPlans() {
  const container = el("plansListContainer");
  if (!container) return;

  try {
    container.innerHTML = `
      <div class="p-8 text-center bg-white rounded-2xl border border-slate-100 shadow-sm animate-pulse">
        <div class="h-6 w-1/4 bg-slate-200 rounded mx-auto mb-4"></div>
        <div class="h-4 w-1/2 bg-slate-100 rounded mx-auto mb-6"></div>
        <div class="h-20 bg-slate-50 rounded-xl max-w-lg mx-auto"></div>
      </div>
    `;

    const plans = await apiRequest("/daily-plans/my-plans");
    state.plans = plans;

    updateKPIs();
    renderPlansList();
  } catch (err) {
    console.error("Erro ao buscar planos diários:", err);
    container.innerHTML = `
      <div class="p-8 text-center bg-white rounded-2xl border border-red-100 shadow-sm">
        <span class="material-symbols-outlined text-4xl text-red-500 mb-2">error</span>
        <h3 class="font-bold text-slate-900">Erro ao carregar planos</h3>
        <p class="text-xs text-slate-500 mt-1">${err.message || "Por favor, verifique a ligação ao servidor."}</p>
        <button onclick="window.location.reload()" class="mt-4 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all">Tentar novamente</button>
      </div>
    `;
  }
}

function updateKPIs() {
  const pending = state.plans.filter(p => p.status === "DRAFT" || p.status === "PENDING_MATERIAL").length;
  const active = state.plans.filter(p => p.status === "IN_PROGRESS").length;
  const completed = state.plans.filter(p => p.status === "COMPLETED" || p.status === "PENDING_VALIDATION" || p.status === "PENDING_RETURN").length;

  setText(el("kpiPendingCount"), pending);
  setText(el("kpiActiveCount"), active);
  setText(el("kpiCompletedCount"), completed);
}

function renderPlansList() {
  const container = el("plansListContainer");
  if (!container) return;

  // Filter plans based on selected tab
  const filteredPlans = state.plans.filter(p => {
    if (state.activeTab === "active") {
      return p.status !== "COMPLETED" && p.status !== "PENDING_VALIDATION" && p.status !== "PENDING_RETURN";
    } else {
      return p.status === "COMPLETED" || p.status === "PENDING_VALIDATION" || p.status === "PENDING_RETURN";
    }
  });

  if (filteredPlans.length === 0) {
    container.innerHTML = `
      <div class="p-12 text-center bg-white rounded-2xl border border-slate-100 shadow-xl shadow-black/5">
        <span class="material-symbols-outlined text-5xl text-slate-300 mb-2">event_busy</span>
        <h3 class="font-bold text-slate-700 text-sm">Nenhum plano diário encontrado</h3>
        <p class="text-xs text-slate-400 mt-1">Não possui planos de trabalho registados nesta categoria.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredPlans.map(renderPlanCard).join("");
}

function renderPlanCard(p) {
  const isDraft = p.status === "DRAFT";
  const isMaterialReady = isDraft && !!p.receivedBy; // DRAFT + materiais já entregues pela logística
  const isInProgress = p.status === "IN_PROGRESS";
  const isPendingMaterial = p.status === "PENDING_MATERIAL";
  const isCompleted = p.status === "COMPLETED";

  // Filter tasks to show which belong to current technician
  const myUserId = currentUser?.id;
  const tasksListHtml = p.tasks.map(t => {
    const isMine = t.technicianId === myUserId;
    const mineBadge = isMine 
      ? `<span class="bg-blue-50 text-blue-600 text-[9px] font-black uppercase px-2 py-0.5 rounded border border-blue-100 tracking-wider">Atribuído a Si</span>` 
      : `<span class="bg-slate-100 text-slate-500 text-[9px] font-medium px-2 py-0.5 rounded">${escapeHtml(t.technician?.name || "Técnico")}</span>`;
    const taskUnit = escapeHtml(t.progressTask?.unit || "");
    
    return `
      <div class="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h5 class="text-xs font-bold text-slate-800">${escapeHtml(t.progressTask?.description || "Tarefa")}</h5>
            ${mineBadge}
          </div>
          <p class="text-[10px] text-slate-400 mt-1">Progresso Físico da Obra</p>
        </div>
        <div class="flex items-center gap-4 text-right shrink-0">
          <div>
            <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Qtd Planeada</p>
            <p class="text-xs font-bold text-slate-900">${t.plannedQty} <span class="text-[#2afc8d] font-black">${taskUnit}</span></p>
          </div>
          ${t.executedQty !== null && Number(t.executedQty) > 0 ? `
          <div>
            <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Qtd Executada</p>
            <p class="text-xs font-bold text-emerald-600">${t.executedQty} <span class="text-emerald-400 font-black">${taskUnit}</span></p>
          </div>` : ""}
        </div>
      </div>
    `;
  }).join("");

  const materialsHeaderHtml = p.materials.length > 0 ? `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
      <h4 class="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
        <span class="material-symbols-outlined text-sm text-amber-600">inventory_2</span> Materiais do Plano
      </h4>
      <div class="flex flex-wrap items-center gap-2">
        ${p.receivedBy ? `
          <div class="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-lg text-[10px] font-bold text-slate-600">
            <span class="material-symbols-outlined text-[12px]">person</span> Recebido por: ${escapeHtml(p.receivedBy)}
          </div>
        ` : ''}
        ${p.returnedBy ? `
          <div class="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-100 rounded-lg text-[10px] font-bold text-amber-700">
            <span class="material-symbols-outlined text-[12px]">assignment_return</span> Devolvido por: ${escapeHtml(p.returnedBy)}
          </div>
        ` : ''}
      </div>
    </div>
  ` : '';

  const materialsHtml = p.materials.length > 0 ? materialsHeaderHtml + p.materials.map(m => {
    const showConsumed = p.status === "COMPLETED" || p.status === "PENDING_VALIDATION" || p.status === "PENDING_RETURN";
    const consumedHtml = showConsumed ? `
        <div>
          <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Usado</p>
          <p class="text-xs font-bold text-blue-600">${m.consumedQty || 0} ${escapeHtml(m.product?.unit || "")}</p>
        </div>
        <div>
          <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Devolvido</p>
          <p class="text-xs font-bold text-amber-600">${Math.max(0, m.providedQty - (m.consumedQty || 0)).toFixed(2)} ${escapeHtml(m.product?.unit || "")}</p>
        </div>
    ` : '';

    return `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50/50 rounded-xl border border-slate-100/50 gap-3">
      <div>
        <p class="text-xs font-bold text-slate-800">${escapeHtml(m.product?.name || "Material")}</p>
        <p class="text-[9px] text-slate-400">Unidade: ${escapeHtml(m.product?.unit || "un")}</p>
      </div>
      <div class="flex flex-wrap gap-4 text-right shrink-0">
        <div>
          <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Pedido</p>
          <p class="text-xs font-bold text-slate-600">${m.requestedQty} <span class="text-[#2afc8d] font-black">${escapeHtml(m.product?.unit || "")}</span></p>
        </div>
        <div>
          <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Entregue</p>
          <p class="text-xs font-bold ${m.providedQty > 0 ? 'text-emerald-600' : 'text-amber-500'}">${m.providedQty || 0} <span class="font-black">${escapeHtml(m.product?.unit || "")}</span></p>
        </div>
        ${consumedHtml}
      </div>
    </div>
  `;
  }).join("") : `<p class="text-xs text-slate-400 italic">Nenhum material associado a este plano.</p>`;

  // Determine if materials were allocated by logistics (receivedBy set) but technician hasn't confirmed receipt yet
  const hasMaterials = p.materials.length > 0;
  const materialsAllocated = hasMaterials && !!p.receivedBy; // logistics already filled receivedBy when they provided materials
  const technicianConfirmed = !!p.technicianReceived;

  let actionButtonHtml = "";
  if (isDraft && materialsAllocated && !technicianConfirmed) {
    // Logistics have prepared the materials but technician must confirm physical receipt first
    actionButtonHtml = `
      <div class="flex flex-col items-end gap-2">
        <div class="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl text-[10px] font-black text-amber-700">
          <span class="material-symbols-outlined text-sm">package_2</span>
          Material preparado pela logística — confirme a recepção para continuar
        </div>
        <button onclick="window.receiveMaterials('${p.id}')" class="w-full sm:w-auto h-11 px-6 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 transition-all active:scale-95">
          <span class="material-symbols-outlined text-sm">inventory_2</span> Confirmar Recepção de Material
        </button>
      </div>
    `;
  } else if (isDraft && materialsAllocated && technicianConfirmed) {
    // Technician confirmed receipt, now they can start
    actionButtonHtml = `
      <div class="flex flex-col items-end gap-2">
        <div class="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl text-[10px] font-black text-emerald-700">
          <span class="material-symbols-outlined text-sm">check_circle</span> Material recebido e confirmado por ${escapeHtml(p.receivedBy)}
        </div>
        <button onclick="window.startPlan('${p.id}')" class="w-full sm:w-auto h-11 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 pulse-emerald transition-all active:scale-95">
          <span class="material-symbols-outlined text-sm">play_arrow</span> Iniciar Execução
        </button>
      </div>
    `;
  } else if (isDraft && !hasMaterials) {
    // No materials needed, can start directly
    actionButtonHtml = `
      <button onclick="window.startPlan('${p.id}')" class="w-full sm:w-auto h-11 px-6 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95">
        <span class="material-symbols-outlined text-sm">play_arrow</span> Iniciar Execução
      </button>
    `;
  } else if (isDraft) {
    // Has materials but logistics haven't released them yet — shouldn't happen normally (would be PENDING_MATERIAL)
    actionButtonHtml = `
      <button onclick="window.startPlan('${p.id}')" class="w-full sm:w-auto h-11 px-6 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95">
        <span class="material-symbols-outlined text-sm">play_arrow</span> Iniciar Execução
      </button>
    `;
  } else if (isInProgress) {
    actionButtonHtml = `
      <button onclick="window.completePlan('${p.id}')" class="w-full sm:w-auto h-11 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg pulse-emerald transition-all active:scale-95">
        <span class="material-symbols-outlined text-sm">check</span> Registar e Concluir
      </button>
    `;
  } else if (isPendingMaterial) {
    actionButtonHtml = `
      <div class="text-center sm:text-right text-xs font-bold text-amber-600 flex items-center gap-2 justify-center sm:justify-end bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5">
        <span class="material-symbols-outlined text-lg">hourglass_empty</span> Aguardando liberação do stock...
      </div>
    `;
  } else if (p.status === "PENDING_VALIDATION") {
    actionButtonHtml = `
      <div class="text-right text-xs font-bold text-orange-600 flex items-center gap-2 justify-end bg-orange-50 border border-orange-100 rounded-xl px-4 py-2.5">
        <span class="material-symbols-outlined text-lg">fact_check</span> Relatório Enviado. Aguardando Validação do Gestor
      </div>
    `;
  } else if (p.status === "PENDING_RETURN") {
    actionButtonHtml = `
      <div class="text-right text-xs font-bold text-blue-600 flex items-center gap-2 justify-end bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
        <span class="material-symbols-outlined text-lg">inventory_2</span> Aguardando Devolução na Logística
      </div>
    `;
  } else if (isCompleted) {
    actionButtonHtml = `
      <div class="text-right text-xs font-bold text-emerald-600 flex items-center gap-2 justify-end bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5">
        <span class="material-symbols-outlined text-lg">task_alt</span> Trabalho Validado e Concluído
      </div>
    `;
  }

  return `
    <div class="bg-white rounded-[2rem] border border-slate-100 p-6 md:p-8 shadow-xl shadow-black/5 transition-all hover:border-slate-200">
      <!-- Card Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 mb-6 gap-4">
        <div>
          <span class="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded tracking-widest uppercase mb-1.5 inline-block">${escapeHtml(p.project?.code || "OBRA")}</span>
          <h4 class="text-base font-bold text-slate-900 uppercase tracking-tight">${escapeHtml(p.project?.name || "Obra")}</h4>
        </div>
        <div class="flex items-center gap-3 self-start sm:self-center">
          <span class="text-xs font-bold text-slate-500 flex items-center gap-1.5">
            <span class="material-symbols-outlined text-sm">calendar_month</span> ${formatDateBR(p.date)}
          </span>
          ${renderStatusBadge(p.status)}
        </div>
      </div>

      <!-- Description -->
      <div class="mb-6 bg-slate-50/50 border border-slate-100 p-4 rounded-2xl">
        <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 leading-none">Descrição Geral do Trabalho</p>
        <p class="text-xs font-bold text-slate-700">${escapeHtml(p.description || "Sem descrição detalhada.")}</p>
      </div>

      <!-- Accordion Section: Tasks & Materials -->
      <div class="space-y-6">
        <div>
          <h4 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
            <span class="material-symbols-outlined text-sm text-blue-600">task</span> Tarefas do Plano
          </h4>
          <div class="space-y-2">
            ${tasksListHtml}
          </div>
        </div>

        <!-- Materiais do Plano -->
        <div class="pt-2 border-t border-slate-100">
          ${materialsHtml}
        </div>

      </div>

      <!-- Action Button Area -->
      <div class="mt-8 pt-6 border-t border-slate-100 flex justify-end">
        ${actionButtonHtml}
      </div>
    </div>
  `;
}

window.startPlan = async function(planId) {
  if (!confirm("Deseja iniciar a execução deste plano diário agora?")) return;

  try {
    toast("A iniciar plano...", { type: "info" });
    await apiRequest(`/daily-plans/${encodeURIComponent(planId)}/start`, { method: "POST" });
    toast("Execução de plano diário iniciada com sucesso!", { type: "success" });
    await loadPlans();
  } catch (err) {
    console.error("Erro ao iniciar plano:", err);
    toast(err.message || "Erro ao iniciar o plano.", { type: "error" });
  }
};

window.receiveMaterials = async function(planId) {
  const plan = state.plans.find(p => p.id === planId);
  if (!plan) return;

  // Show a small confirmation with list of materials being confirmed
  const matList = plan.materials.map(m =>
    `<li class="flex justify-between text-xs font-medium text-slate-700 py-1.5 border-b border-slate-100 last:border-0">
      <span>${escapeHtml(m.product?.name || "Material")}</span>
      <span class="font-bold text-slate-900">${m.providedQty} <span class="text-[#2afc8d]">${escapeHtml(m.product?.unit || "")}</span></span>
    </li>`
  ).join("");

  const { close } = openModal({
    title: "Confirmar Recepção de Material",
    primaryLabel: "✓ Confirmar que Recebi o Material",
    contentHtml: `
      <div class="space-y-4">
        <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
          <span class="material-symbols-outlined text-amber-600 text-xl shrink-0">warning</span>
          <p class="text-xs text-amber-800 font-medium leading-relaxed">
            Ao confirmar, está a declarar que recebeu fisicamente os materiais abaixo listados e assume a responsabilidade pelos mesmos durante a execução da obra.
          </p>
        </div>
        <div>
          <h4 class="text-xs font-black uppercase text-slate-400 tracking-widest mb-2">Materiais a receber</h4>
          <ul class="bg-slate-50 rounded-xl border border-slate-100 px-4 py-2">
            ${matList || '<li class="text-xs text-slate-400 italic py-2">Sem materiais listados</li>'}
          </ul>
        </div>
        <p class="text-[10px] text-slate-400 text-center">Esta ação ficará registada com o seu nome de utilizador.</p>
      </div>
    `,
    onPrimary: async ({ btn }) => {
      setButtonLoading(btn, true);
      try {
        await apiRequest(`/daily-plans/${encodeURIComponent(planId)}/receive`, { method: "POST" });
        toast("Recepção de material confirmada! Pode iniciar a execução.", { type: "success" });
        close();
        await loadPlans();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao confirmar recepção.", { type: "error" });
      }
    }
  });
};

window.completePlan = async function(planId) {
  const plan = state.plans.find(p => p.id === planId);
  if (!plan) return toast("Plano não encontrado.");

  const myUserId = currentUser?.id;
  // Get tasks that belong to the technician so they prioritize reporting them
  const myTasks = plan.tasks; // We let them see/edit all tasks of the plan if needed, but we can highlight their assigned ones!
  
  const tasksHtml = myTasks.map(t => {
    const isMine = t.technicianId === myUserId;
    const highlightClass = isMine ? "border-blue-200 bg-blue-50/50" : "border-slate-100 bg-slate-50";
    const highlightBadge = isMine ? `<span class="bg-blue-100 text-blue-800 text-[9px] font-black uppercase px-2 rounded tracking-wider">A Seu Cargo</span>` : "";

    return `
      <div class="p-3 rounded-xl mb-3 flex flex-col sm:flex-row sm:items-center gap-3 border ${highlightClass}">
        <div class="flex-1">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <p class="text-xs font-bold text-slate-900">${escapeHtml(t.progressTask?.description || "Tarefa")}</p>
            ${highlightBadge}
          </div>
          <p class="text-[10px] text-slate-500">Qtd Planeada: <span class="font-bold text-slate-700">${t.plannedQty} ${escapeHtml(t.progressTask?.unit || "")}</span></p>
          <p class="text-[9px] text-slate-400">Técnico: ${escapeHtml(t.technician?.name || "Sem técnico")}</p>
        </div>
        <div class="w-full sm:w-32 shrink-0">
          <label class="text-[9px] font-black uppercase text-slate-400 block mb-1">Qtd Executada</label>
          <input type="number" step="0.01" data-task-id="${t.id}" value="${t.plannedQty}" class="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-xs font-bold focus:ring-2 focus:ring-emerald-500">
        </div>
      </div>
    `;
  }).join('');

  const matsHtml = plan.materials.map(m => `
    <div class="bg-slate-50 p-3 rounded-xl mb-3 flex flex-col sm:flex-row sm:items-center gap-3 border border-slate-100">
      <div class="flex-1">
        <p class="text-xs font-bold text-slate-900">${escapeHtml(m.product?.name || "Material")}</p>
        <p class="text-[10px] text-slate-500">Disponibilizado: <span class="font-bold text-slate-700">${m.providedQty} <span class="text-[#2afc8d] font-black">${escapeHtml(m.product?.unit || "")}</span></span></p>
      </div>
      <div class="w-full sm:w-36 shrink-0">
        <label class="text-[9px] font-black uppercase text-slate-400 block mb-1">Qtd Consumida (${escapeHtml(m.product?.unit || "un")})</label>
        <input type="number" step="0.01" data-mat-id="${m.id}" data-provided="${m.providedQty}" value="${m.providedQty}" max="${m.providedQty}" oninput="document.getElementById('dev-${m.id}').innerText = Math.max(0, this.dataset.provided - this.value).toFixed(2); if(window.checkReturnsNeeded) window.checkReturnsNeeded();" class="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-xs font-bold focus:ring-2 focus:ring-emerald-500">
      </div>
      <div class="w-full sm:w-24 shrink-0 text-right">
        <label class="text-[9px] font-black uppercase text-slate-400 block mb-1">A Devolver (${escapeHtml(m.product?.unit || "un")})</label>
        <p class="text-xs font-bold text-amber-600" id="dev-${m.id}">0.00</p>
      </div>
    </div>
  `).join('');

  const returnedByHtml = plan.materials.length > 0 ? `
    <div id="returnedByContainer" class="mt-4 p-4 bg-amber-50 rounded-xl border border-amber-200" style="display: none;">
      <label class="text-[10px] font-black uppercase text-amber-800 block mb-1">Quem vai devolver o material remanescente ao armazém?</label>
      <input type="text" id="returnedByInput" placeholder="Ex: João Silva (Técnico)" class="w-full h-10 bg-white border border-amber-300 rounded-lg px-3 text-xs font-bold focus:ring-2 focus:ring-amber-500 outline-none">
      <p class="text-[9px] text-amber-600 mt-1">Obrigatório se as quantidades consumidas forem menores que as disponibilizadas.</p>
    </div>
  ` : '';

  const renderTasks = tasksHtml || '<p class="text-xs text-slate-400 italic">Sem tarefas para reportar.</p>';
  const renderMats = matsHtml || '<p class="text-xs text-slate-400 italic">Nenhum material fornecido para este plano.</p>';

  window.checkReturnsNeeded = function() {
    const inputs = document.querySelectorAll('input[data-mat-id]');
    let needsReturn = false;
    inputs.forEach(input => {
      const provided = parseFloat(input.getAttribute('data-provided') || 0);
      const consumed = parseFloat(input.value || 0);
      if (consumed < provided) needsReturn = true;
    });
    const container = document.getElementById('returnedByContainer');
    if (container) {
      container.style.display = needsReturn ? 'block' : 'none';
    }
  };

  openModal({
    title: "Confirmar Conclusão do Plano",
    primaryLabel: "Finalizar Execução",
    contentHtml: `
      <div class="space-y-6">
        <div class="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 flex gap-3">
          <span class="material-symbols-outlined text-emerald-600 text-xl">info</span>
          <p class="text-xs text-emerald-800 font-medium leading-relaxed">
            Reporte as quantidades de trabalho físicas efetivamente executadas no terreno e os consumos reais de materiais. Itens não consumidos retornarão automaticamente ao stock do estaleiro.
          </p>
        </div>

        <div>
          <h4 class="text-sm font-bold text-slate-950 mb-3 flex items-center gap-1.5">
            <span class="material-symbols-outlined text-blue-600 text-lg">task</span> 1. Quantidades de Tarefas
          </h4>
          <div class="max-h-[250px] overflow-y-auto pr-1">
            ${renderTasks}
          </div>
        </div>

        <div>
          <h4 class="text-sm font-bold text-slate-950 mb-3 flex items-center gap-1.5">
            <span class="material-symbols-outlined text-amber-600 text-lg">inventory_2</span> 2. Consumo de Materiais
          </h4>
          <div class="max-h-[250px] overflow-y-auto pr-1">
            ${renderMats}
          </div>
          ${returnedByHtml}
        </div>
      </div>
    `,
    onPrimary: async ({ close, btn, panel }) => {
      const executedTasks = Array.from(panel.querySelectorAll("input[data-task-id]")).map(el => ({
        dailyPlanTaskId: el.getAttribute("data-task-id"),
        executedQty: Number(el.value || 0)
      }));

      const consumedMaterials = Array.from(panel.querySelectorAll("input[data-mat-id]")).map(el => ({
        dailyPlanMaterialId: el.getAttribute("data-mat-id"),
        consumedQty: Number(el.value || 0)
      }));

      const returnedByInput = panel.querySelector("#returnedByInput");
      const returnedBy = returnedByInput ? returnedByInput.value.trim() : null;

      // Simple validation if there are returns
      const hasReturns = consumedMaterials.some(cm => {
        const mat = plan.materials.find(m => m.id === cm.dailyPlanMaterialId);
        return mat && cm.consumedQty < mat.providedQty;
      });

      if (hasReturns && !returnedBy) {
        toast("Por favor, preencha quem vai devolver o material remanescente.", { type: "warning" });
        return; // Assuming openModal handles return gracefully or the user will just have to try again. If it closes, they will reopen.
      }

      setButtonLoading(btn, true);
      try {
        await apiRequest(`/daily-plans/${encodeURIComponent(planId)}/complete`, {
          method: "POST",
          body: { executedTasks, consumedMaterials, returnedBy }
        });
        toast("Execução reportada e plano diário concluído com sucesso!", { type: "success" });
        close();
        await loadPlans();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao concluir plano diário.", { type: "error" });
      }
    }
  });
};

function wireEvents() {
  wireLogout();

  // Tabs toggle
  const tabActive = el("tabActiveBtn");
  const tabHistory = el("tabHistoryBtn");

  tabActive?.addEventListener("click", () => {
    state.activeTab = "active";
    tabActive.className = "px-4 py-2 text-sm font-bold text-[#0d3fd1] border-b-2 border-[#0d3fd1] transition-all flex items-center gap-2";
    tabHistory.className = "px-4 py-2 text-sm font-bold text-slate-400 hover:text-slate-900 border-b-2 border-transparent transition-all flex items-center gap-2";
    renderPlansList();
  });

  tabHistory?.addEventListener("click", () => {
    state.activeTab = "history";
    tabHistory.className = "px-4 py-2 text-sm font-bold text-[#0d3fd1] border-b-2 border-[#0d3fd1] transition-all flex items-center gap-2";
    tabActive.className = "px-4 py-2 text-sm font-bold text-slate-400 hover:text-slate-900 border-b-2 border-transparent transition-all flex items-center gap-2";
    renderPlansList();
  });

  el("refreshPlansBtn")?.addEventListener("click", () => {
    loadPlans();
    toast("Lista de planos diários atualizada.", { type: "success" });
  });

  // Welcome user styling
  if (currentUser) {
    const techWelcomeName = el("techWelcomeName");
    if (techWelcomeName) techWelcomeName.textContent = currentUser.name || currentUser.email;

    const headerUserName = el("headerUserName");
    if (headerUserName) headerUserName.textContent = currentUser.name || currentUser.email;

    const userAvatarPlaceholder = el("userAvatarPlaceholder");
    if (userAvatarPlaceholder && currentUser.profilePic) {
      const picUrl = getAssetUrl(currentUser.profilePic);
      const img = document.createElement("img");
      img.src = picUrl;
      img.className = "w-full h-full object-cover rounded-2xl";
      userAvatarPlaceholder.replaceWith(img);
    }
  }

  // Today Date
  const todayDateStr = el("todayDateStr");
  if (todayDateStr) {
    const now = new Date();
    todayDateStr.textContent = now.toLocaleDateString("pt-PT", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }
}

async function init() {
  wireEvents();
  await loadPlans();
}

init().catch(err => {
  toast("Falha na inicialização do painel.", { type: "error" });
});
