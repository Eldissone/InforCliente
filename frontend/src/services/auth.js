const TOKEN_KEY = "InfoCliente.token";
const USER_KEY = "InfoCliente.user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession({ token, user }) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getSessionUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function logout() {
  const keysToKeep = ["InfoCliente.apiBaseUrl"];
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith("InfoCliente.") && !keysToKeep.includes(key)) {
      localStorage.removeItem(key);
    }
  });
  
  // Specific keys used without the InfoCliente prefix
  ["pending_auth_user", "pending_auth_accounts", "selected_project_id"].forEach(k => {
    localStorage.removeItem(k);
  });
}

/**
 * Checks if a session exists, otherwise redirects to login.
 * @param {Object} options 
 * @param {string[]} options.allowedRoles Roles allowed to access this page
 */
export function checkAuth({ allowedRoles = [] } = {}) {
  const user = getSessionUser();
  const token = getToken();

  if (!user || !token) {
    const here = window.location.pathname.split("/").slice(-2).join("/");
    window.location.href = `/Auth/login.html?next=${encodeURIComponent(here)}`;
    return null;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    // If client tries to access admin pages, or vice versa
    window.location.href = user.role === "cliente" 
      ? "/Dashboard/clientDashboard.html" 
      : "/Dashboard/index.html";
    return null;
  }

  return user;
}

