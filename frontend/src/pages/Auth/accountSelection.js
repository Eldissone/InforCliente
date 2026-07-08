import { apiRequest } from "../../services/api.js";
import {
  clearPendingAuthSelection,
  getPendingAuthAccounts,
  getPendingAuthSelectionToken,
  getPendingAuthUser,
  setSession,
} from "../../services/auth.js";
import { toast } from "../../shared/ui.js";

function getNext() {
  const params = new URLSearchParams(window.location.search);
  return params.get("next");
}

document.addEventListener("DOMContentLoaded", () => {
  const user = getPendingAuthUser() || {};
  const accounts = getPendingAuthAccounts();
  const selectionToken = getPendingAuthSelectionToken();

  if (!user.id || !selectionToken || accounts.length === 0) {
    window.location.href = "login.html";
    return;
  }

  const welcomeEl = document.getElementById("welcomeUser");
  welcomeEl.textContent = `Bem-vindo!`; // You could add user's name if available in the model

  const listEl = document.getElementById("accountsList");
  const overlay = document.getElementById("loadingOverlay");

  accounts.forEach(acc => {
    const card = document.createElement("div");
    card.className = "account-card";
    
    // Fallback for avatar: first letter of name
    const avatarContent = acc.profilePic 
        ? `<img src="${acc.profilePic}" alt="${acc.name}" />`
        : `<span>${acc.name.charAt(0)}</span>`;

    card.innerHTML = `
      <div class="client-avatar">
        ${avatarContent}
      </div>
      <div class="client-info">
        <h3>${acc.name}</h3>
        <p>${acc.code}</p>
      </div>
      <span class="material-symbols-outlined ml-auto text-slate-700">chevron_right</span>
    `;

    card.addEventListener("click", async () => {
      try {
        overlay.style.display = "flex";
        
        const res = await apiRequest("/auth/select-account", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${selectionToken}`,
          },
          body: {
            clientId: acc.id
          }
        });

        clearPendingAuthSelection();

        setSession(res);
        import("../../shared/permissions.js")
          .then(({ loadUserPermissions }) => loadUserPermissions({ force: true }))
          .catch(() => {});
        toast(`Acedendo a ${acc.name}...`);

        const next = getNext();
        setTimeout(() => {
          if (next) {
            window.location.href = `/${next}`;
          } else {
            window.location.href = "../Dashboard/clientDashboard.html";
          }
        }, 1000);

      } catch (err) {
        overlay.style.display = "none";
        toast(err.message || "Erro ao seleccionar conta", { type: "error" });
      }
    });

    listEl.appendChild(card);
  });
});
