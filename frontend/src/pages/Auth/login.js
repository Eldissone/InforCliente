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

document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");

  const email = qs("email")?.value?.trim();
  const password = qs("password")?.value;
  const submitBtn = qs("submitBtn");

  try {
    setButtonLoading(submitBtn, true);
    const res = await apiRequest("/auth/login", { method: "POST", body: { email, password } });
    setSession(res);
    
    // Toast com design premium (já configurado no shared/ui.js)
    toast(`Bem-vindo, ${res.user.name || 'Usuário'}!`);

    const next = getNext();
    setTimeout(() => {
      if (next) {
        window.location.href = `/${next}`;
      } else {
        window.location.href =
          res?.user?.role === "cliente" ? "../Projectos/ProjectGeral.html" : "../Dashboard/index.html";
      }
    }, 800);
  } catch (err) {
    setButtonLoading(submitBtn, false);
    setError(err.message || "Credenciais inválidas. Tente novamente.");
  }
});
