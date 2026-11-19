/**
 * Funcionários — base de pessoas da empresa (Comercial › Base › Funcionários).
 *
 * Assenta no registo de pessoal que já existe (`/personnel`), não cria uma segunda
 * base de pessoas. A ligação ao barém é pela **função** (cargo), não pela pessoa:
 * em cada tarefa escolhe-se a função do barém de RH e depois quem a desempenha.
 */

import { apiRequest } from "/services/api.js";
import { toast, escapeHtml } from "/shared/ui.js";
import { initComercialPage, canEdit } from "/shared/comercial/page.js";

const el = (id) => document.getElementById(id);
const esc = (v) => escapeHtml(String(v ?? ""));

const S = {
  items: [],
  total: 0,
  q: "",
  department: "",
  includeInactive: false,
  lists: { departamentos: [], vinculos: [], funcoes: [] },
  /** funções do barém de RH (nomes), para o campo «cargo» */
  baremRoles: [],
  edit: null,
  readonly: false,
};

const fullName = (p) => [p.firstName, p.lastName].filter(Boolean).join(" ");
const fmtDate = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—");
const toDateInput = (v) => (v ? String(v).slice(0, 10) : "");

// ───────────────────────── carregamento ─────────────────────────

async function loadLists() {
  const [settings, baremes] = await Promise.all([
    apiRequest("/company-settings/budget-lists").catch(() => ({ lists: {} })),
    apiRequest("/baremes?kind=RH").catch(() => ({ items: [] })),
  ]);
  const l = settings.lists || {};
  S.lists = {
    departamentos: l.departamentos || [],
    vinculos: l.vinculos || [],
    funcoes: l.funcoes || [],
  };
  S.baremRoles = [...new Set((baremes.items || []).map((b) => b.name).filter(Boolean))];
}

async function loadItems() {
  const qs = new URLSearchParams({ pageSize: "500" });
  if (S.q) qs.set("q", S.q);
  if (S.department) qs.set("department", S.department);
  const data = await apiRequest(`/personnel?${qs}`);
  const all = data.items || [];
  S.total = all.length;
  S.items = S.includeInactive ? all : all.filter((p) => p.active !== false);
  S.items.sort((a, b) => fullName(a).localeCompare(fullName(b), "pt"));
}

// ───────────────────────── render ─────────────────────────

function render() {
  const ativos = S.items.filter((p) => p.active !== false).length;
  const semCargo = S.items.filter((p) => !roleInBarem(p)).length;

  el("cmHeadActions").innerHTML = `
    <input id="fqSearch" class="cell-list" style="min-width:240px" type="search"
           placeholder="Procurar por nome, cargo, departamento, telefone…" value="${esc(S.q)}" aria-label="Procurar funcionários">
    <select id="fqDep" class="cell-list" style="min-width:12rem" aria-label="Departamento">
      <option value="">Todos os departamentos</option>
      ${S.lists.departamentos.map((d) => `<option value="${esc(d)}"${S.department === d ? " selected" : ""}>${esc(d)}</option>`).join("")}
    </select>
    <label class="cm-chip" style="cursor:pointer">
      <input id="fqInactive" type="checkbox" ${S.includeInactive ? "checked" : ""}> Incluir inativos
    </label>
    ${S.readonly ? "" : `<button class="cm-chip is-on" type="button" id="fqNew" data-cm-write="1">+ Novo funcionário</button>`}
  `;

  el("cmContent").innerHTML = `
    <div class="cm-chips">
      <span class="cm-chip"><span>Nesta lista</span><b>${S.items.length}</b></span>
      <span class="cm-chip"><span>Ativos</span><b>${ativos}</b></span>
      ${semCargo ? `<span class="cm-chip"><span>Cargo fora do barém</span><b>${semCargo}</b></span>` : ""}
    </div>
    ${
      S.baremRoles.length
        ? ""
        : `<div class="cm-note is-warn">Ainda não há funções no barém de recursos humanos. Crie-as em <a href="/comercial/base/baremes">Baremes › Recursos humanos</a> para poder ligar cada pessoa a uma função com custo.</div>`
    }
    ${
      semCargo
        ? `<div class="cm-note is-warn"><b>${semCargo}</b> pessoa(s) com um cargo que não existe no barém de recursos humanos. Enquanto o cargo não corresponder a uma função do barém, o custo dessa pessoa não entra nas folhas automaticamente.</div>`
        : ""
    }
    <div class="cm-table-wrap">
      <table class="cm-table">
        <thead><tr>
          <th>N.º</th><th>Nome</th><th>Cargo / função</th><th>Departamento</th>
          <th>Telefone</th><th>E-mail</th><th>Vínculo</th><th>Admissão</th><th>Estado</th><th></th>
        </tr></thead>
        <tbody>
          ${
            S.items.length
              ? S.items.map(rowHtml).join("")
              : `<tr><td colspan="10" style="padding:1.25rem;color:var(--cm-muted)">
                   Nenhum funcionário corresponde à pesquisa.${S.readonly ? "" : " Use «+ Novo funcionário»."}
                 </td></tr>`
          }
        </tbody>
      </table>
    </div>
    <p class="cm-lead" style="margin-top:.75rem">
      Esta é a mesma base do registo de pessoal (<a href="/registos/pessoal">Registos › Pessoal</a>):
      quem for criado aqui aparece lá e ao contrário.
    </p>`;
}

function roleInBarem(p) {
  const r = String(p.role || "").trim();
  return !r || S.baremRoles.includes(r);
}

function rowHtml(p) {
  const ok = roleInBarem(p);
  return `<tr${p.active === false ? ' style="opacity:.55"' : ""}>
    <td>${esc(p.employeeCode)}</td>
    <td><b>${esc(fullName(p))}</b></td>
    <td>${esc(p.role)}${ok ? "" : ` <span class="cm-pill is-warn" title="Não existe no barém de recursos humanos">fora do barém</span>`}</td>
    <td>${esc(p.department)}</td>
    <td>${esc(p.phone)}</td>
    <td>${esc(p.email)}</td>
    <td>${esc(p.contractType)}</td>
    <td>${fmtDate(p.admissionDate)}</td>
    <td>${p.active === false ? `<span class="cm-pill is-warn">inativo</span>` : `<span class="cm-pill is-good">ativo</span>`}</td>
    <td style="white-space:nowrap">
      <button class="cm-chip" type="button" data-open="${esc(p.id)}">${S.readonly ? "Ver ficha" : "Abrir ficha"}</button>
    </td>
  </tr>`;
}

// ───────────────────────── ficha ─────────────────────────

function openFicha(p) {
  S.edit = p
    ? { ...p }
    : {
        id: null,
        firstName: "",
        lastName: "",
        role: "",
        type: "INTERNO",
        department: S.lists.departamentos[1] || S.lists.departamentos[0] || "",
        contractType: S.lists.vinculos[0] || "",
        employeeCode: "",
        phone: "",
        email: "",
        admissionDate: null,
        idNumber: "",
        taxNumber: "",
        emergencyContact: "",
        emergencyPhone: "",
        notes: "",
        active: true,
      };
  drawFicha();
}

function fld(label, key, { ty = "text", options = null, list = null, span = 1, help = "" } = {}) {
  const v = S.edit[key];
  const dis = S.readonly ? "disabled" : "";
  let input;
  if (options) {
    input = `<select class="cell-list" data-f="${key}" ${dis}>
      <option value=""></option>
      ${options.map((o) => `<option value="${esc(o)}"${String(v || "") === String(o) ? " selected" : ""}>${esc(o)}</option>`).join("")}
    </select>`;
  } else if (ty === "date") {
    input = `<input class="cell-manual" type="date" data-f="${key}" value="${toDateInput(v)}" ${dis}>`;
  } else if (ty === "textarea") {
    input = `<textarea class="cell-manual" rows="3" data-f="${key}" ${dis}>${esc(v)}</textarea>`;
  } else {
    input = `<input class="cell-manual" type="${ty}" data-f="${key}" value="${esc(v)}" ${list ? `list="${list}"` : ""} ${dis}>`;
  }
  return `<label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted);grid-column:span ${span}">
    <span>${label}</span>${input}
    ${help ? `<small style="color:var(--cm-muted)">${help}</small>` : ""}
  </label>`;
}

function drawFicha() {
  const p = S.edit;
  const isNew = !p.id;
  el("cmDrawer").innerHTML = `
    <div class="cm-panel" style="position:fixed;right:1rem;top:5rem;width:min(760px,calc(100% - 2rem));max-height:calc(100vh - 7rem);overflow:auto;z-index:60;box-shadow:0 20px 50px rgba(0,0,0,.25)">
      <div class="cm-head" style="margin-bottom:.75rem">
        <div>
          <div class="cm-head-num">Ficha de funcionário</div>
          <h2 class="cm-panel-title">${esc(isNew ? "Novo funcionário" : fullName(p))}</h2>
        </div>
        <button class="cm-chip" type="button" data-fclose="1">Fechar</button>
      </div>

      <h4 class="cm-panel-title" style="font-size:.875rem;margin:.5rem 0">Identificação</h4>
      <div style="display:grid;gap:.625rem;grid-template-columns:repeat(3,minmax(0,1fr))">
        ${fld("N.º de funcionário", "employeeCode")}
        ${fld('Nome <b style="color:var(--cm-bad-fg)">*</b>', "firstName", { span: 1 })}
        ${fld("Apelido", "lastName")}
        ${fld('Cargo / função habitual <b style="color:var(--cm-bad-fg)">*</b>', "role", {
          list: "dl-funcoes",
          span: 2,
          help: "A lista vem do barém de recursos humanos. O custo da pessoa entra nas folhas pela função.",
        })}
        ${fld("Departamento", "department", { options: S.lists.departamentos })}
        ${fld("Vínculo", "contractType", { options: S.lists.vinculos })}
        ${fld("Data de admissão", "admissionDate", { ty: "date" })}
        ${fld("Tipo", "type", { options: ["INTERNO", "SUBCONTRATADO"] })}
      </div>

      <h4 class="cm-panel-title" style="font-size:.875rem;margin:1rem 0 .5rem">Contactos</h4>
      <div style="display:grid;gap:.625rem;grid-template-columns:repeat(3,minmax(0,1fr))">
        ${fld("Telefone", "phone", { ty: "tel" })}
        ${fld("E-mail", "email", { ty: "email" })}
        ${fld("Contacto de emergência (nome)", "emergencyContact")}
        ${fld("Telefone de emergência", "emergencyPhone", { ty: "tel" })}
      </div>

      <h4 class="cm-panel-title" style="font-size:.875rem;margin:1rem 0 .5rem">Documentos</h4>
      <div style="display:grid;gap:.625rem;grid-template-columns:repeat(3,minmax(0,1fr))">
        ${fld("N.º do BI", "idNumber")}
        ${fld("NIF", "taxNumber")}
        <label style="display:grid;gap:.25rem;font-size:.8125rem;color:var(--cm-muted)">
          <span>Estado</span>
          <select class="cell-list" data-f="active" ${S.readonly ? "disabled" : ""}>
            <option value="true"${p.active !== false ? " selected" : ""}>Ativo</option>
            <option value="false"${p.active === false ? " selected" : ""}>Inativo</option>
          </select>
        </label>
      </div>

      <div style="margin-top:1rem">${fld("Observações", "notes", { ty: "textarea", span: 3 })}</div>

      <datalist id="dl-funcoes">
        ${[...new Set([...S.baremRoles, ...S.lists.funcoes])].map((r) => `<option value="${esc(r)}"></option>`).join("")}
      </datalist>

      ${
        S.readonly
          ? `<p class="cm-lead" style="margin-top:1rem">Só consulta: não tem permissão para alterar fichas.</p>`
          : `<div class="cm-head-actions" style="margin-top:1rem">
               <button class="cm-chip is-on" type="button" id="fSave">Guardar ficha</button>
               <span id="fMsg" class="cm-lead" style="margin:0"></span>
             </div>`
      }
    </div>`;

  el("cmDrawer").querySelector("[data-fclose]").addEventListener("click", closeFicha);
  if (!S.readonly) el("fSave").addEventListener("click", saveFicha);
  const first = el("cmDrawer").querySelector('[data-f="firstName"]');
  if (first) first.focus();
}

function closeFicha() {
  S.edit = null;
  el("cmDrawer").innerHTML = "";
}

async function saveFicha() {
  const p = S.edit;
  const msg = el("fMsg");
  if (!String(p.firstName || "").trim()) {
    msg.textContent = "Indique o nome.";
    return;
  }
  if (String(p.firstName).trim().length < 2) {
    msg.textContent = "O nome tem de ter pelo menos 2 letras.";
    return;
  }
  if (!String(p.role || "").trim() || String(p.role).trim().length < 2) {
    msg.textContent = "Indique o cargo / função habitual.";
    return;
  }

  const body = {
    firstName: String(p.firstName).trim(),
    lastName: p.lastName || null,
    role: String(p.role).trim(),
    type: p.type || null,
    department: p.department || null,
    contractType: p.contractType || null,
    employeeCode: p.employeeCode || null,
    phone: p.phone || null,
    email: p.email || null,
    admissionDate: p.admissionDate ? toDateInput(p.admissionDate) : null,
    idNumber: p.idNumber || null,
    taxNumber: p.taxNumber || null,
    emergencyContact: p.emergencyContact || null,
    emergencyPhone: p.emergencyPhone || null,
    notes: p.notes || null,
  };
  if (p.id) body.active = p.active !== false;

  msg.textContent = "A guardar…";
  try {
    if (p.id) await apiRequest(`/personnel/${p.id}`, { method: "PATCH", body });
    else await apiRequest("/personnel", { method: "POST", body });
    closeFicha();
    await loadItems();
    render();
    toast("Ficha guardada.", { type: "success" });
  } catch (err) {
    msg.textContent = err?.message || "Não foi possível guardar a ficha.";
  }
}

// ───────────────────────── eventos ─────────────────────────

function wire() {
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset?.f && S.edit) {
      S.edit[t.dataset.f] = t.value;
      return;
    }
    if (t.id === "fqSearch") {
      S.q = t.value;
      clearTimeout(wire._t);
      wire._t = setTimeout(async () => {
        await loadItems();
        render();
        const again = el("fqSearch");
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      }, 300);
    }
  });

  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset?.f && S.edit) {
      S.edit[t.dataset.f] = t.dataset.f === "active" ? t.value === "true" : t.value;
      return;
    }
    if (t.id === "fqDep") {
      S.department = t.value;
      await loadItems();
      render();
    }
    if (t.id === "fqInactive") {
      S.includeInactive = t.checked;
      await loadItems();
      render();
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-open],#fqNew");
    if (!t) return;
    if (t.id === "fqNew") return openFicha(null);
    const p = S.items.find((x) => x.id === t.dataset.open);
    if (p) openFicha(p);
  });
}

// ───────────────────────── arranque ─────────────────────────

initComercialPage({
  perm: "tab_funcionarios",
  onReady: async () => {
    S.readonly = !canEdit();
    el("cmContent").innerHTML = `<p class="cm-lead">A carregar funcionários…</p>`;
    try {
      await loadLists();
      await loadItems();
      wire();
      render();
    } catch (err) {
      el("cmContent").innerHTML = `<div class="cm-note is-bad">Não foi possível carregar os funcionários: ${esc(
        err?.message || err
      )}</div>`;
    }
  },
});
