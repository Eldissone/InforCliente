import { apiRequest, getApiBaseUrl } from "../../services/api.js";
import { setSession } from "../../services/auth.js";
import { toast } from "../../shared/ui.js";

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
    if (submitBtn) submitBtn.disabled = true;
    const res = await apiRequest("/auth/login", { method: "POST", body: { email, password } });
    setSession(res);
    toast(`Conectado em ${getApiBaseUrl()}`, { type: "success" });

    const next = getNext();
    if (next) {
      // next é um caminho relativo curto (ex: "Dashboard/index.html")
    window.location.href = `/${next}`;
    } else {
    window.location.href = "/Dashboard/index.html";
    }
  } catch (err) {
    setError("Falha no login. Verifique email/senha e se a API está rodando.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

