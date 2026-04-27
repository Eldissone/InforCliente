import { apiRequest, getApiBaseUrl } from "../../services/api.js";
import { setSession } from "../../services/auth.js";
import { toast, setButtonLoading } from "../../shared/ui.js";

function qs(id) {
  return document.getElementById(id);
}

function setError(msg) {
  const box = qs("errorBox");
  if (!box) return;
  if (!msg) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }
  box.classList.remove("hidden");
  box.textContent = msg;
}

function getNext() {
  const params = new URLSearchParams(window.location.search);
  return params.get("next");
}

qs("togglePassword")?.addEventListener("click", () => {
  const passwordInp = qs("password");
  const icon = qs("togglePassword").querySelector("span");
  if (passwordInp.type === "password") {
    passwordInp.type = "text";
    icon.textContent = "visibility_off";
  } else {
    passwordInp.type = "password";
    icon.textContent = "visibility";
  }
});

document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");

  const email = qs("email")?.value?.trim();
  const password = qs("password")?.value;
  const submitBtn = qs("submitBtn");

  try {
    setButtonLoading(submitBtn, true);
    const res = await apiRequest("/auth/login", { method: "POST", body: { email, password } });
    console.log("Full Login Response:", res);
    
    if (res && res.status === "MULTI_ACCOUNT") {
      console.log("Redirecting to ProjectSelection.html...");
      localStorage.setItem("pending_auth_user", JSON.stringify(res.user));
      localStorage.setItem("pending_auth_accounts", JSON.stringify(res.accounts || []));
      window.location.href = "ProjectSelection.html" + (getNext() ? `?next=${getNext()}` : "");
      return;
    }

    if (!res || !res.token) {
       throw new Error("Resposta inválida do servidor.");
    }

    setSession(res);
    
    // Toast com design premium
    toast(`Bem-vindo, ${res.user.email || 'Usuário'}!`);

    const next = getNext();
    setTimeout(() => {
      if (next) {
        window.location.href = `/${next}`;
      } else {
        window.location.href =
          res?.user?.role === "cliente" ? "../Dashboard/clientDashboard.html" : "../Dashboard/index.html";
      }
    }, 800);
  } catch (err) {
    setButtonLoading(submitBtn, false);
    setError(err.message || "Credenciais inválidas. Tente novamente.");
  }
});
