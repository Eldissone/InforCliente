import { getSessionUser, logout as clearSession } from "../services/auth.js";
import { toast } from "./ui.js";

export function wireLogout() {
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-logout]");
    if (!btn) return;
    clearSession();
    window.location.href = "/Auth/login.html";
  });
}

function applyRoleVisibility(role) {
  const normalizedUserRole = (role || "").toLowerCase();

  document.querySelectorAll("[data-role-visible]").forEach((el) => {
    const allowedRoles = String(el.getAttribute("data-role-visible") || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    if (!allowedRoles.length || allowedRoles.includes(normalizedUserRole)) {
      el.classList.remove("hidden");
      return;
    }

    el.classList.add("hidden");
  });

  document.querySelectorAll("[data-role-hidden]").forEach((el) => {
    const hiddenRoles = String(el.getAttribute("data-role-hidden") || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    if (hiddenRoles.includes(normalizedUserRole)) {
      el.classList.add("hidden");
    } else {
      el.classList.remove("hidden");
    }
  });
}

export function wireUsersNav() {
  const user = getSessionUser();
  const role = (user?.role || "").toLowerCase();

  document.querySelectorAll("[data-nav-users]").forEach((el) => {
    if (role === "admin") {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });

  document.querySelectorAll("[data-user-role]").forEach((el) => {
    // Show name if available, fallback to role label
    el.textContent = user?.name || (role ? String(role).toUpperCase() : "");
  });

  // Also support data-user-name explicitly if needed
  document.querySelectorAll("[data-user-name]").forEach((el) => {
    el.textContent = user?.name || user?.email || "";
  });

  // Dynamic Dashboard Link
  document.querySelectorAll("[data-nav-dashboard]").forEach((el) => {
    const target = role === "cliente" ? "../Dashboard/clientDashboard.html" : (role === "tecnico" ? "../Projectos/tecnicoPlanos.html" : "../Dashboard/index.html");
    if (el.tagName === "A") el.href = target;
  });

  // Dynamic Brand Text
  const brandText = document.getElementById("navBrandText");
  if (brandText) {
    brandText.textContent = role === "cliente" ? "Cliente" : "Gestor";
  }

  applyRoleVisibility(role);

  import("./permissions.js")
    .then(({ initPermissionLayer }) => initPermissionLayer())
    .catch(() => {});

  wireUserProfile();
  processUrlMessages();
}

function processUrlMessages() {
  const params = new URLSearchParams(window.location.search);
  const msg = params.get("msg");
  if (msg === "access_denied") {
    toast("Acesso negado: não tem permissão para aceder a esta página.", { type: "error" });
    // Clean URL without refresh
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
  }
}

export function wireUserProfile() {
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-user-profile], [data-user-role]");
    if (!btn) return;
    openProfileModal();
  });
}

async function openProfileModal() {
  const { openModal, toast, setButtonLoading, escapeHtml } = await import("./ui.js");
  const { apiRequest } = await import("../services/api.js");

  // Fetch fresh data
  const user = await apiRequest("/users/me");

  openModal({
    title: "O Meu Perfil",
    primaryLabel: "Guardar",
    contentHtml: `
      <div class="space-y-4">
        <div>
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Nome Completo</label>
          <input id="p_name" type="text" value="${escapeHtml(user.name || '')}" class="w-full h-12 bg-slate-50 border-slate-200 rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-[#2afc8d] transition-all" placeholder="O seu nome..." />
        </div>
        <div>
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Email (Apenas Leitura)</label>
          <input type="text" value="${escapeHtml(user.email)}" class="w-full h-12 bg-slate-100 border-none rounded-xl px-4 text-sm font-bold text-slate-400 cursor-not-allowed" readonly />
        </div>
        <div>
          <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Nova Senha (Deixe em branco para manter)</label>
          <input id="p_pass" type="password" class="w-full h-12 bg-slate-50 border-slate-200 rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-[#2afc8d] transition-all" placeholder="••••••••" />
        </div>
      </div>
    `,
    onPrimary: async ({ close, btn, panel }) => {
      const name = panel.querySelector("#p_name").value.trim();
      const password = panel.querySelector("#p_pass").value.trim();

      setButtonLoading(btn, true);
      try {
        await apiRequest("/users/me", {
          method: "PATCH",
          body: {
            name: name || null,
            ...(password ? { password } : {})
          }
        });

        // Update session info locally to persist after refresh
        const USER_KEY = "InfoCliente.user";
        const storedUser = JSON.parse(localStorage.getItem(USER_KEY) || "{}");
        storedUser.name = name;
        localStorage.setItem(USER_KEY, JSON.stringify(storedUser));

        toast("Perfil atualizado com sucesso!", { type: "success" });

        // Update the header name instantly
        document.querySelectorAll("[data-user-role], [data-user-name]").forEach(el => {
          el.textContent = name || storedUser.email;
        });

        close();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao atualizar perfil", { type: "error" });
      }
    }
  });
}
