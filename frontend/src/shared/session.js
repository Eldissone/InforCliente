import { getSessionUser, logout as clearSession } from "../services/auth.js";
import { resolveHomePathByRole } from "./postLoginRedirect.js";
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

  // Fetch fresh user data from server to get the real avatar, bypassing localStorage
  import("../services/api.js").then(({ getAssetUrl, apiRequest }) => {
    apiRequest("/users/me").then(freshUser => {
      if (!freshUser) return;
      
      document.querySelectorAll("[data-user-profile]").forEach((btn) => {
        // Replace the material icon (or existing image if called twice) with the real avatar
        const icon = btn.querySelector(".material-symbols-outlined") || btn.querySelector("img") || btn.querySelector("span:not([data-user-role])");
        if (!icon) return;
        
        const avatarSrc = freshUser.profilePic ? getAssetUrl(freshUser.profilePic) : null;
        const nameInitial = (freshUser.name || freshUser.email || "?")[0].toUpperCase();
        
        if (avatarSrc) {
          const img = document.createElement("img");
          img.src = avatarSrc;
          img.alt = freshUser.name || "Avatar";
          img.className = "w-7 h-7 rounded-lg object-cover ring-1 ring-[#2afc8d]/40";
          img.onerror = () => {
            const fallback = document.createElement("span");
            fallback.className = "material-symbols-outlined text-sm";
            fallback.textContent = "person";
            img.replaceWith(fallback);
          };
          icon.replaceWith(img);
        } else {
          // Text avatar fallback
          const span = document.createElement("span");
          span.textContent = nameInitial;
          span.className = "w-7 h-7 rounded-lg bg-[#2afc8d]/20 text-[#2afc8d] text-xs font-black flex items-center justify-center";
          icon.replaceWith(span);
        }
      });
      
      // Update name text instantly if it changed
      document.querySelectorAll("[data-user-role]").forEach((el) => {
        el.textContent = freshUser.name || (role ? String(role).toUpperCase() : "");
      });
      document.querySelectorAll("[data-user-name]").forEach((el) => {
        el.textContent = freshUser.name || freshUser.email || "";
      });

      // Keep localStorage in sync silently for other parts of the app
      const USER_KEY = "InfoCliente.user";
      const storedUser = JSON.parse(localStorage.getItem(USER_KEY) || "{}");
      storedUser.profilePic = freshUser.profilePic;
      storedUser.name = freshUser.name;
      localStorage.setItem(USER_KEY, JSON.stringify(storedUser));
    }).catch(() => {});
  });

  // Also support data-user-name explicitly if needed
  document.querySelectorAll("[data-user-name]").forEach((el) => {
    el.textContent = user?.name || user?.email || "";
  });

  // Dynamic Dashboard Link
  document.querySelectorAll("[data-nav-dashboard]").forEach((el) => {
    const target = resolveHomePathByRole(role);
    if (el.tagName === "A") el.href = target;
  });

  // Dynamic Brand Text
  const brandText = document.getElementById("navBrandText");
  if (brandText) {
    brandText.textContent =
      role === "cliente" ? "Cliente" : role === "financeiro" ? "Financeiro" : "Gestor";
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

  const user = await apiRequest("/users/me");
  const avatarUrl = user.profilePic ? getAssetUrl(user.profilePic) : "/assets/img/placeholder-user.png";
  const displayName = escapeHtml(user.name || user.email);
  const displayBio = user.bio ? escapeHtml(user.bio) : "";
  const bioPlaceholder = "Sem bio definida.";

  openModal({
    title: "O Meu Perfil",
    primaryLabel: "Guardar",
    contentHtml: `
      <div class="space-y-4">
        <div class="flex items-start gap-4 mb-2">
          <div class="relative w-20 h-20 rounded-full bg-slate-100 overflow-hidden shrink-0 group cursor-pointer shadow-sm border border-slate-200">
            <img id="p_avatar_preview" src="${avatarUrl}" onerror="this.src='/assets/img/placeholder-user.png'" class="w-full h-full object-cover" />
            <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span class="material-symbols-outlined text-white">photo_camera</span>
            </div>
            <input type="file" id="p_avatar_input" accept="image/jpeg, image/png, image/webp" class="absolute inset-0 opacity-0 cursor-pointer" />
          </div>
          <div class="flex-1 min-w-0 pt-1">
            <div class="flex items-center gap-2">
              <h4 id="p_display_name" class="font-bold text-slate-900 text-base truncate">${displayName}</h4>
              <button type="button" id="p_edit_toggle" aria-label="Editar perfil" aria-expanded="false"
                class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors shrink-0">
                <span class="material-symbols-outlined text-lg">edit</span>
              </button>
            </div>
            <p id="p_display_bio" class="mt-1 text-sm leading-relaxed ${displayBio ? "text-slate-500" : "text-slate-400 italic"}">${displayBio || bioPlaceholder}</p>
            <div class="flex items-center gap-2 mt-2 min-w-0">
              <span class="material-symbols-outlined text-base text-slate-400 shrink-0">mail</span>
              <span class="text-sm text-slate-400 truncate">${escapeHtml(user.email)}</span>
            </div>
          </div>
        </div>

        <div id="p_edit_fields" class="hidden space-y-4">
          <div>
            <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Nome Completo</label>
            <input id="p_name" type="text" value="${escapeHtml(user.name || "")}" class="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-[#2afc8d] transition-all" placeholder="O seu nome..." />
          </div>
          <div>
            <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Bio</label>
            <textarea id="p_bio" rows="3" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-[#2afc8d] transition-all resize-none" placeholder="Conte um pouco sobre si...">${displayBio}</textarea>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Telefone</label>
              <input id="p_phone" type="tel" value="${escapeHtml(user.phone || "")}" class="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-[#2afc8d] transition-all" placeholder="+244 ..." />
            </div>
            <div>
              <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">WhatsApp</label>
              <input id="p_whatsapp" type="tel" value="${escapeHtml(user.whatsapp || "")}" class="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-[#2afc8d] transition-all" placeholder="+244 ..." />
            </div>
          </div>
          <div>
            <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Nova Senha (Deixe em branco para manter)</label>
            <input id="p_pass" type="password" class="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-bold focus:ring-2 focus:ring-[#2afc8d] transition-all" placeholder="••••••••" />
          </div>
        </div>
      </div>
    `,
    onRender: ({ panel }) => {
      const input = panel.querySelector("#p_avatar_input");
      const preview = panel.querySelector("#p_avatar_preview");
      const editToggle = panel.querySelector("#p_edit_toggle");
      const editFields = panel.querySelector("#p_edit_fields");
      const nameInput = panel.querySelector("#p_name");
      const passInput = panel.querySelector("#p_pass");

      input.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) preview.src = URL.createObjectURL(file);
      });

      editToggle.addEventListener("click", () => {
        const isOpen = !editFields.classList.contains("hidden");
        if (isOpen) {
          editFields.classList.add("hidden");
          editToggle.setAttribute("aria-expanded", "false");
          editToggle.classList.remove("bg-slate-900", "text-white");
          passInput.value = "";
        } else {
          editFields.classList.remove("hidden");
          editToggle.setAttribute("aria-expanded", "true");
          editToggle.classList.add("bg-slate-900", "text-white");
          nameInput.focus();
        }
      });
    },
    onPrimary: async ({ close, btn, panel }) => {
      const editFields = panel.querySelector("#p_edit_fields");
      const isEditing = !editFields.classList.contains("hidden");
      const fileInput = panel.querySelector("#p_avatar_input");
      const file = fileInput.files[0];

      setButtonLoading(btn, true);
      try {
        let uploadedAvatar = null;
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
            })(),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Erro ao atualizar foto de perfil.");
          }
          const resData = await res.json();
          uploadedAvatar = resData.profilePic;
        }

        const patchBody = {};
        if (isEditing) {
          const name = panel.querySelector("#p_name").value.trim();
          const password = panel.querySelector("#p_pass").value.trim();
          const bio = panel.querySelector("#p_bio").value.trim();
          const phone = panel.querySelector("#p_phone")?.value.trim();
          const whatsapp = panel.querySelector("#p_whatsapp")?.value.trim();
          patchBody.name = name || null;
          patchBody.bio = bio || null;
          patchBody.phone = phone || null;
          patchBody.whatsapp = whatsapp || null;
          if (password) patchBody.password = password;
        }

        if (Object.keys(patchBody).length > 0) {
          await apiRequest("/users/me", {
            method: "PATCH",
            body: patchBody,
          });
        }

        if (isEditing) {
          const name = patchBody.name || user.email;
          const bio = patchBody.bio || "";
          panel.querySelector("#p_display_name").textContent = name;
          const bioEl = panel.querySelector("#p_display_bio");
          bioEl.textContent = bio || bioPlaceholder;
          bioEl.classList.toggle("text-slate-500", Boolean(bio));
          bioEl.classList.toggle("text-slate-400", !bio);
          bioEl.classList.toggle("italic", !bio);
        }

        const USER_KEY = "InfoCliente.user";
        const storedUser = JSON.parse(localStorage.getItem(USER_KEY) || "{}");
        if (isEditing && patchBody.name) storedUser.name = patchBody.name;
        if (uploadedAvatar) storedUser.profilePic = uploadedAvatar;
        localStorage.setItem(USER_KEY, JSON.stringify(storedUser));

        toast("Perfil atualizado com sucesso!", { type: "success" });
        wireUsersNav();
        close();
      } catch (err) {
        setButtonLoading(btn, false);
        toast(err.message || "Erro ao atualizar perfil", { type: "error" });
      }
    },
  });
}
