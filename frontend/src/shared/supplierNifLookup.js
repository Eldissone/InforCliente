import { apiRequest } from "/services/api.js";

export function normalizeNif(raw) {
  return String(raw || "").replace(/\D/g, "");
}

export function formatAgtLookupMessage(agt = {}) {
  const parts = [];
  if (agt.nome) parts.push(agt.nome);
  if (agt.estado) parts.push(`Estado: ${agt.estado}`);
  if (agt.regimeIva) parts.push(`Regime IVA: ${agt.regimeIva}`);
  if (agt.tipo) parts.push(`Tipo: ${agt.tipo}`);
  if (agt.inadimplente && String(agt.inadimplente).toLowerCase() !== "não") {
    parts.push(`Inadimplente: ${agt.inadimplente}`);
  }
  return parts.join(" · ");
}

const NIF_OVERLAY_ID = "nif-lookup-overlay";

function showNifLookupOverlay() {
  let el = document.getElementById(NIF_OVERLAY_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = NIF_OVERLAY_ID;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.className = "fixed inset-0 z-[20000] flex items-center justify-center bg-slate-900/55 backdrop-blur-sm";
    el.innerHTML = `
      <div class="mx-4 w-full max-w-sm rounded-2xl bg-white px-6 py-7 shadow-2xl text-center">
        <div class="mx-auto mb-4 spinner text-emerald-600" style="width:44px;height:44px;border-width:4px;"></div>
        <p class="text-sm font-bold text-slate-800">A consultar o NIF</p>
        <p class="mt-1 text-xs text-slate-500">A aguardar resposta do Portal da AGT. Isto pode demorar alguns segundos.</p>
      </div>
    `;
    document.body.appendChild(el);
  }
  el.hidden = false;
}

function hideNifLookupOverlay() {
  document.getElementById(NIF_OVERLAY_ID)?.remove();
}

export function setNifLookupStatus(el, message, kind = "info") {
  if (!el) return;
  el.classList.remove("hidden", "text-slate-500", "text-emerald-700", "text-rose-600", "text-amber-600");
  if (!message) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  const color =
    kind === "ok" ? "text-emerald-700" :
    kind === "error" ? "text-rose-600" :
    kind === "warn" ? "text-amber-600" :
    "text-slate-500";
  el.classList.add(color);
  if (kind === "loading") {
    el.innerHTML = `<span class="inline-flex items-center gap-2"><span class="spinner shrink-0" style="width:12px;height:12px;border-width:2px;"></span><span>${message}</span></span>`;
    return;
  }
  el.textContent = message;
}

export async function lookupSupplierNif(nif) {
  return apiRequest("/suppliers/lookup-nif", {
    method: "POST",
    body: { nif: normalizeNif(nif) },
  });
}

export async function registerSupplierFromNif(payload) {
  return apiRequest("/suppliers/from-nif", {
    method: "POST",
    body: {
      ...payload,
      nif: normalizeNif(payload.nif),
    },
  });
}

export function bindNifLookup(opts) {
  const nifEl = typeof opts.nifInput === "string" ? document.getElementById(opts.nifInput) : opts.nifInput;
  const btnEl = typeof opts.button === "string" ? document.getElementById(opts.button) : opts.button;
  const statusEl = typeof opts.statusEl === "string" ? document.getElementById(opts.statusEl) : opts.statusEl;
  if (!nifEl || nifEl.dataset.nifLookupBound === "1") return;

  nifEl.dataset.nifLookupBound = "1";
  let running = false;

  const run = async () => {
    if (running) return null;
    const nif = normalizeNif(nifEl.value);
    if (nif.length < 9) {
      setNifLookupStatus(statusEl, "Indique um NIF válido (mínimo 9 dígitos).", "error");
      return null;
    }

    running = true;
    const prevLabel = btnEl?.textContent;
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.classList.add("btn-loading");
      btnEl.setAttribute("aria-busy", "true");
    }
    nifEl.disabled = true;
    showNifLookupOverlay();
    setNifLookupStatus(statusEl, "A consultar o NIF no Portal da AGT...", "loading");

    try {
      const result = opts.register
        ? await registerSupplierFromNif({
            nif,
            ...(typeof opts.extraBody === "function" ? opts.extraBody() : opts.extraBody || {}),
          })
        : await lookupSupplierNif(nif);

      const agt = result?.data || {};
      const supplier = result?.supplier || result?.existingSupplier || null;
      const alreadyRegistered = Boolean(result?.alreadyRegistered || (supplier && !result?.created));

      if (!agt.found && !supplier) {
        setNifLookupStatus(statusEl, result?.error || "NIF não encontrado no Portal da AGT.", "error");
        opts.onResult?.({ ok: false, agt, result });
        return result;
      }

      const prefix = result?.created
        ? "NIF validado e fornecedor cadastrado. "
        : alreadyRegistered
          ? "NIF já cadastrado. Foi usado o fornecedor existente. "
          : "NIF validado. ";
      setNifLookupStatus(statusEl, prefix + formatAgtLookupMessage(agt), "ok");
      opts.onResult?.({
        ok: true,
        agt,
        supplier,
        created: Boolean(result?.created),
        alreadyRegistered,
        result,
      });
      return result;
    } catch (err) {
      setNifLookupStatus(statusEl, err?.message || "Falha ao consultar o NIF.", "error");
      opts.onResult?.({ ok: false, error: err });
      return null;
    } finally {
      running = false;
      hideNifLookupOverlay();
      nifEl.disabled = false;
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.classList.remove("btn-loading");
        btnEl.removeAttribute("aria-busy");
        btnEl.textContent = prevLabel || "Consultar NIF";
      }
    }
  };

  btnEl?.addEventListener("click", (e) => {
    e.preventDefault();
    run();
  });

  nifEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });

  nifEl.addEventListener("blur", () => {
    const nif = normalizeNif(nifEl.value);
    if (nif.length >= 9 && opts.autoOnBlur) run();
  });

  return run;
}
