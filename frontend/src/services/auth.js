const TOKEN_KEY = "InfoCliente.token";
const USER_KEY = "InfoCliente.user";
const PENDING_AUTH_USER_KEY = "pending_auth_user";
const PENDING_AUTH_ACCOUNTS_KEY = "pending_auth_accounts";
const PENDING_AUTH_SELECTION_TOKEN_KEY = "pending_auth_selection_token";

export function setPendingAuthSelection({ user, accounts = [], selectionToken }) {
  sessionStorage.setItem(PENDING_AUTH_USER_KEY, JSON.stringify(user || null));
  sessionStorage.setItem(PENDING_AUTH_ACCOUNTS_KEY, JSON.stringify(accounts));
  if (selectionToken) {
    sessionStorage.setItem(PENDING_AUTH_SELECTION_TOKEN_KEY, selectionToken);
  } else {
    sessionStorage.removeItem(PENDING_AUTH_SELECTION_TOKEN_KEY);
  }
}

export function getPendingAuthUser() {
  const raw = sessionStorage.getItem(PENDING_AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getPendingAuthAccounts() {
  const raw = sessionStorage.getItem(PENDING_AUTH_ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function getPendingAuthSelectionToken() {
  return sessionStorage.getItem(PENDING_AUTH_SELECTION_TOKEN_KEY);
}

export function clearPendingAuthSelection() {
  [
    PENDING_AUTH_USER_KEY,
    PENDING_AUTH_ACCOUNTS_KEY,
    PENDING_AUTH_SELECTION_TOKEN_KEY,
  ].forEach((key) => sessionStorage.removeItem(key));
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession({ token, user }) {
  clearPendingAuthSelection();
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
  ["selected_project_id"].forEach(k => {
    localStorage.removeItem(k);
  });
  clearPendingAuthSelection();
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
    console.warn("checkAuth: Sessão ausente. Redirecionando para login.", { hasUser: !!user, hasToken: !!token });
    const here = window.location.pathname.split("/").slice(-2).join("/");
    window.location.href = `/Auth/login.html?next=${encodeURIComponent(here)}`;
    return null;
  }

  // Normalize current user role to uppercase for comparison
  const currentRole = (user.role || "").toUpperCase();
  const normalizedAllowed = allowedRoles.map(r => r.toUpperCase());

  if (normalizedAllowed.length > 0 && !normalizedAllowed.includes(currentRole)) {
    console.warn("checkAuth: Acesso negado para o papel", currentRole);
    // If access is denied, determine the best landing page based on role
    let target = "/Dashboard/index.html"; // Default for ADMIN/OPERADOR

    if (currentRole === "CLIENT" || currentRole === "CLIENTE") {
      target = "/Dashboard/clientDashboard.html";
    } else if (currentRole === "TECNICO") {
      target = "/Projectos/tecnicoPlanos.html";
    } else if (currentRole === "USER") {
      target = "/Dashboard/index.html";
    }

    // Prevent redirect loop if already on target
    if (window.location.pathname.includes(target)) {
      console.warn("checkAuth: Acesso negado mas já está na página de destino. Parando loop.");
      return user;
    }

    console.log("checkAuth: Redirecionando para landing page do papel:", target);
    window.location.href = `${target}?msg=access_denied`;
    return null;
  }

  return user;
}

