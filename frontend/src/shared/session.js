import { getSessionUser, logout as clearSession } from "../services/auth.js";

export function wireLogout() {
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-logout]");
    if (!btn) return;
    clearSession();
    window.location.href = "/Auth/login.html";
  });
}

export function wireUsersNav() {
  const user = getSessionUser();
  const role = user?.role;
  document.querySelectorAll("[data-nav-users]").forEach((el) => {
    if (role === "admin") {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
  document.querySelectorAll("[data-user-role]").forEach((el) => {
    el.textContent = role ? String(role).toUpperCase() : "";
  });
}

