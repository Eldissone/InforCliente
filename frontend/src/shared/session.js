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
    .catch(() => { });

  wireUserProfile();
  processUrlMessages();

  import("./chatFab.js")
    .then(({ initChatFab }) => initChatFab())
    .catch(() => { });
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
  const { apiRequest, getAssetUrl } = await import("../services/api.js");

  // Fetch fresh data
  const user = await apiRequest("/users/me");
  const avatarUrl = user.profilePic ? getAssetUrl(user.profilePic) : '/assets/img/placeholder-user.png';

  openModal({
    title: "O Meu Perfil",
    primaryLabel: "Guardar",
    contentHtml: `
      <div class="space-y-4">
        <div class="flex items-center gap-4 mb-2">
          <div class="relative w-20 h-20 rounded-full bg-slate-100 overflow-hidden shrink-0 group cursor-pointer shadow-sm border border-slate-200">
            <img id="p_avatar_preview" src="${avatarUrl}" onerror="this.src='/assets/img/placeholder-user.png'" class="w-full h-full object-cover" />
            <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span class="material-symbols-outlined text-white">photo_camera</span>
            </div>
            <input type="file" id="p_avatar_input" accept="image/jpeg, image/png, image/webp" class="absolute inset-0 opacity-0 cursor-pointer" />
          </div>
          <div>
            <h4 class="font-bold text-slate-900 text-base">${escapeHtml(user.name || user.email)}</h4>
          </div>
        </div>
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
    onRender: ({ panel }) => {
      const input = panel.querySelector("#p_avatar_input");
      const preview = panel.querySelector("#p_avatar_preview");
      input.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
          preview.src = URL.createObjectURL(file);
        }
      });
    },
    onPrimary: async ({ close, btn, panel }) => {
      const name = panel.querySelector("#p_name").value.trim();
      const password = panel.querySelector("#p_pass").value.trim();
      const fileInput = panel.querySelector("#p_avatar_input");
      const file = fileInput.files[0];

      setButtonLoading(btn, true);
      try {
        if (file) {
          const { getToken } = await import("../services/auth.js");
          const { getApiBaseUrl } = await import("../services/api.js");
          const res = await fetch(`${getApiBaseUrl()}/users/me/avatar`, {
            method: "POST",
            headers: { Authorization: `Bearer ${getToken()}` },
            body: (() => {
              const fd = new FormData();
              fd.append("file", file);
              return fd;
            })()
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Erro ao atualizar foto de perfil.");
          }
        }

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
