import { apiRequest } from "../../services/api.js";
import { setSession } from "../../services/auth.js";
import { toast } from "../../shared/ui.js";

function getNext() {
  const params = new URLSearchParams(window.location.search);
  return params.get("next");
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = JSON.parse(localStorage.getItem("pending_auth_user") || "{}");

  if (!user.id) {
    window.location.href = "login.html";
    return;
  }

  const welcomeEl = document.getElementById("welcomeUser");

  if (welcomeEl) {
    welcomeEl.textContent = user.email;
  }

  const listEl = document.getElementById("projectsList");
  const overlay = document.getElementById("loadingOverlay");

  try {
    const res = await apiRequest(`/auth/available-projects?userId=${user.id}`);
    const projects = res.items || [];

    if (projects.length === 0) {
      listEl.innerHTML = `<div class="text-slate-500 font-bold">Nenhuma obra vinculada a esta conta.</div>`;
      return;
    }

    projects.forEach((p, index) => {
      const card = document.createElement("div");
      card.className = "project-card";
      card.style.animationDelay = `${index * 0.1}s`;

      const statusMap = {
        'ACTIVE': 'Em curso',
        'ON_HOLD': 'Suspenso',
        'COMPLETED': 'Concluído'
      };

      const clientName = p.client?.name || "Empresa";

      card.innerHTML = `
            <div class="client-badge">
                <span class="material-symbols-outlined text-[14px]">corporate_fare</span>
                ${clientName}
            </div>
            <h3 class="project-name">${p.name}</h3>
            <div class="project-location">
                <span class="material-symbols-outlined text-[16px]">location_on</span>
                ${p.location || 'Localização não definida'}
            </div>
            <div class="p-footer">
                <span class="p-status">${statusMap[p.status] || p.status}</span>
                <div class="enter-icon">
                    <span class="material-symbols-outlined">arrow_forward</span>
                </div>
            </div>
        `;

      card.addEventListener("click", async () => {
        try {
          overlay.style.display = "flex";

          const authRes = await apiRequest("/auth/select-account", {
            method: "POST",
            body: {
              userId: user.id,
              clientId: p.client?.id || ""
            }
          });

          // Clear temp storage
          localStorage.removeItem("pending_auth_user");
          localStorage.removeItem("pending_auth_accounts");

          setSession(authRes);

          // Store selected project ID to help the dashboard jump to it
          localStorage.setItem("selected_project_id", p.id);

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
          toast(err.message || "Erro ao aceder à obra", { type: "error" });
        }
      });

      listEl.appendChild(card);
    });

  } catch (err) {
    toast("Erro ao carregar obras disponíveis", { type: "error" });
    console.error(err);
  }
});
