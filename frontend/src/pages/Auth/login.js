import { apiRequest } from "../../services/api.js";
import { setPendingAuthSelection, setSession } from "../../services/auth.js";
import { resolvePostLoginPath } from "../../shared/postLoginRedirect.js";
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
      setPendingAuthSelection({
        user: res.user,
        accounts: res.accounts || [],
        selectionToken: res.selectionToken || null,
      });
      window.location.href = "ProjectSelection.html" + (getNext() ? `?next=${getNext()}` : "");
      return;
    }

    if (!res || !res.token) {
       throw new Error("Resposta inválida do servidor.");
    }

    setSession(res);

    toast(`Bem-vindo, ${res.user.name || res.user.email || "Utilizador"}!`);

    const next = getNext();
    setTimeout(async () => {
      if (next) {
        window.location.href = `/${next}`;
        return;
      }
      const path = await resolvePostLoginPath(res.user);
      window.location.href = path;
    }, 800);
  } catch (err) {
    setButtonLoading(submitBtn, false);
    setError(err.message || "Credenciais inválidas. Tente novamente.");
  }
});
