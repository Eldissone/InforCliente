import { getSessionUser, logout as clearSession } from "../services/auth.js";

export function wireLogout() {
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-logout]");
    if (!btn) return;
    clearSession();
    window.location.href = "/Auth/login.html";
  });
}

function applyRoleVisibility(role) {
  document.querySelectorAll("[data-role-visible]").forEach((el) => {
    const allowedRoles = String(el.getAttribute("data-role-visible") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!allowedRoles.length || allowedRoles.includes(role)) {
      el.classList.remove("hidden");
      return;
    }

    el.classList.add("hidden");
  });

  document.querySelectorAll("[data-role-hidden]").forEach((el) => {
    const hiddenRoles = String(el.getAttribute("data-role-hidden") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (hiddenRoles.includes(role)) {
      el.classList.add("hidden");
    } else {
      el.classList.remove("hidden");
    }
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

  // Dynamic Dashboard Link
  document.querySelectorAll("[data-nav-dashboard]").forEach((el) => {
    const target = role === "cliente" ? "../Dashboard/clientDashboard.html" : "../Dashboard/index.html";
    if (el.tagName === "A") el.href = target;
  });

  applyRoleVisibility(role);
}
