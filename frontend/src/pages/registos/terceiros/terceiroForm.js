import { apiRequest } from "/services/api.js";
import { checkAuth } from "/services/auth.js";
import { can, guardPageAccess, initPermissionLayer } from "/shared/permissions.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu, toast } from "/shared/ui.js";
import { bindNifLookup, normalizeNif } from "/shared/supplierNifLookup.js";

/**
 * RG3 Novo Terceiro — o FXDRAW.terc do protótipo, com o aspeto dos
 * formulários de registo da app. Uma só ficha para cliente, fornecedor,
 * empresa do grupo e sócio (pode ser vários ao mesmo tempo):
 *  - Identificação: código (ao gravar), nome*, NIF* (com consulta à AGT),
 *    tipo*, setor do cliente / do fornecedor, país*, região*, morada;
 *  - Condições fiscais / financeiras: como cliente (condição*, regime de IVA,
 *    seguros, moeda) e como fornecedor (limite de crédito, condição*, regime
 *    de IVA, retenção na fonte*, moeda); descontos;
 *  - Contas bancárias (IBAN e/ou n.º de conta, banco, descrição);
 *  - Contactos (nome, cargo, telefone, email).
 * Sendo cliente, cria também o registo de cliente (o acesso ao portal dá-se
 * em Clientes).
 */

const TIPOS = [
  ["CLIENTE", "Cliente"],
  ["FORNECEDOR", "Fornecedor"],
  ["GRUPO", "Empresa do grupo"],
  ["SOCIO", "Sócio"],
];
const SET_CLI = ["Empresa", "Entidade Pública", "ONG / Organização", "Cliente Particular", "Outro"];
const SET_FORN = ["Fornecedor", "Subempreiteiro", "Prestador de Serviços", "Transportador", "Outro"];
const PAISES = ["Angola", "Portugal", "Brasil", "Moçambique", "Namíbia", "África do Sul", "Zâmbia", "República Democrática do Congo", "República do Congo", "Cabo Verde", "São Tomé e Príncipe", "Espanha", "França", "Alemanha", "Itália", "Reino Unido", "Estados Unidos", "China", "Outro"];
const PROVINCIAS = ["Bengo", "Benguela", "Bié", "Cabinda", "Cuando", "Cubango", "Cuanza Norte", "Cuanza Sul", "Cunene", "Huambo", "Huíla", "Icolo e Bengo", "Luanda", "Lunda Norte", "Lunda Sul", "Malanje", "Moxico", "Moxico Leste", "Namibe", "Uíge", "Zaire", "Fora de Angola"];
const CONDS = ["Pronto pagamento", "30 dias", "60 dias", "90 dias"];
const IVAS = ["Regime geral (14%)", "Regime simplificado", "Regime de exclusão", "Não sujeito / isento"];
const MOEDAS = [["AOA", "Kz (AOA)"], ["USD", "USD"], ["EUR", "EUR"]];

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const opts = (L, sel = "", ph = "— selecionar —") =>
  `${ph != null ? `<option value="">${esc(ph)}</option>` : ""}${L.map((x) => {
    const [v, l] = Array.isArray(x) ? x : [x, x];
    return `<option value="${esc(v)}"${String(sel) === String(v) ? " selected" : ""}>${esc(l)}</option>`;
  }).join("")}`;
const fld = (label, control, extra = "", req = false) => `<label class="forn-field ${extra}"><span>${label}${req ? ' <b class="tc-req">*</b>' : ""}</span>${control}</label>`;
const simNao = (name, ph = "— escolher —") => `<select name="${name}">${opts([["0", "Não"], ["1", "Sim"]], "", ph)}</select>`;

let BANCOS = [];

const contaRow = (c = {}) => `<div class="tc-row" data-conta>
  ${fld("IBAN", `<input data-c="iban" value="${esc(c.iban || "")}" placeholder="AO06 0000 0000 0000 0000 0000 0">`, "tc-w2")}
  ${fld("N.º de conta", `<input data-c="accountNumber" value="${esc(c.accountNumber || "")}" placeholder="ex.: 123456789 10 001">`)}
  ${fld("Banco", `<select data-c="bankName">${opts(BANCOS.map((b) => [b.code, `${b.code} — ${b.name}`]), c.bankName || "", "—")}</select>`)}
  ${fld("Descrição (opcional)", `<input data-c="description" value="${esc(c.description || "")}" placeholder="ex.: conta para pagamentos em USD · conta da obra X">`, "tc-w2")}
  <button type="button" class="tc-del" data-del>Retirar</button></div>`;
const contatoRow = () => `<div class="tc-row" data-contato>
  ${fld("Nome", '<input data-k="nome">')}${fld("Cargo", '<input data-k="cargo">')}${fld("Telefone", '<input data-k="telefone" inputmode="tel">')}${fld("Email", '<input data-k="email" type="email">')}
  <button type="button" class="tc-del" data-del>Retirar</button></div>`;

function secCondicoes(roles) {
  const cli = roles.has("CLIENTE");
  const forn = roles.has("FORNECEDOR");
  if (!cli && !forn) return "";
  return `<section class="forn-card"><h2>Condições fiscais / financeiras</h2>
    ${
      cli
        ? `<h3 class="tc-sub">Como cliente</h3><div class="forn-grid">
      ${fld("Cond. pagamento", `<select name="cliCond">${opts(CONDS)}</select>`, "", true)}
      ${fld("Regime de IVA", `<select name="cliIva">${opts(IVAS)}</select>`)}
      ${fld("Seguro construção", `<select name="cliSegC">${opts([["0", "Não"], ["1", "Sim"]], "0", null)}</select>`)}
      ${fld("Seguro garantia", `<select name="cliSegG">${opts([["0", "Não"], ["1", "Sim"]], "0", null)}</select>`)}
      ${fld("Moeda", `<select name="cliMoeda">${opts(MOEDAS, "AOA", null)}</select>`)}</div>`
        : ""
    }
    ${
      forn
        ? `<h3 class="tc-sub">Como fornecedor</h3><div class="forn-grid">
      ${fld("Limite de crédito (AOA)", '<input name="fornLimite" type="number" min="0" step="0.01">')}
      ${fld("Cond. pagamento", `<select name="fornCond">${opts(CONDS)}</select>`, "", true)}
      ${fld("Regime de IVA", `<select name="fornIva">${opts(IVAS)}</select>`)}
      ${fld("Retenção na fonte", simNao("fornRet"), "", true)}
      ${fld("Moeda", `<select name="fornMoeda">${opts(MOEDAS, "AOA", null)}</select>`)}</div>`
        : ""
    }
    <h3 class="tc-sub">Descontos</h3><div class="forn-grid">
      ${forn ? fld("Fornecedor dá-nos desconto?", simNao("fornDesc")) : ""}
      ${cli ? fld("Cliente tem direito a desconto?", simNao("cliDesc")) : ""}
    </div></section>`;
}

async function render() {
  const root = document.getElementById("registryRoot");
  const canManage = can("fornecedores", "manage");
  let code = "";
  try {
    code = (await apiRequest("/suppliers/terceiro/next-code")).code;
  } catch {
    /* fica «ao gravar» */
  }
  try {
    BANCOS = ((await apiRequest("/banks")).items || []).filter((b) => b.active !== false);
  } catch {
    BANCOS = [];
  }
  const roles = new Set();

  root.innerHTML = `
    <header class="forn-header">
      <div>
        <div class="tc-kick">TERCEIRO</div>
        <h1 class="forn-title">Novo Terceiro</h1>
        <p class="forn-lead">Registo do cliente ou fornecedor — uma só ficha, mesmo que seja os dois.</p>
      </div>
      <a href="/fornecedores" class="forn-top-btn"><span class="material-symbols-outlined" aria-hidden="true">format_list_bulleted</span>Lista de Fornecedores</a>
    </header>
    <form class="forn-form" id="tcForm" novalidate>
      <section class="forn-card">
        <h2>Identificação do Terceiro</h2>
        <div class="forn-grid">
          ${fld("Código terceiro", `<input name="code" placeholder="${esc(code || "T0001")} (ao gravar)">`)}
          ${fld("Nome do terceiro", '<input name="name" required placeholder="EX.: MITRELLI PROJECTS, LDA">', "span-2", true)}
          <div class="forn-field"><span>NIF <b class="tc-req">*</b></span>
            <div class="forn-nif-row"><input name="nif" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="ex.: 5417XXXXXX"><button type="button" class="forn-nif-btn" data-lookup-nif>Consultar AGT</button></div>
            <p class="forn-nif-status hidden" data-nif-status></p></div>
          <div class="forn-field span-2"><span>Tipo de terceiro <b class="tc-req">*</b></span>
            <div class="tc-chips">${TIPOS.map(([k, l]) => `<label class="tc-chip"><input type="checkbox" data-role="${k}"> ${l}</label>`).join("")}</div></div>
          <div class="forn-field tc-setcli hidden"><span>Setor / categoria (cliente)</span><select name="setorCliente">${opts(SET_CLI)}</select></div>
          <div class="forn-field tc-setforn hidden"><span>Setor / categoria (fornecedor)</span><select name="setorFornecedor">${opts(SET_FORN)}</select></div>
          ${fld("País", `<select name="country">${opts(PAISES, "Angola")}</select>`, "", true)}
          ${fld("Região / província", `<select name="region">${opts(PROVINCIAS)}</select>`, "", true)}
          ${fld("Morada", '<input name="address" placeholder="RUA, N.º, CIDADE">', "span-2")}
        </div>
      </section>
      <div id="tcCond"></div>
      <section class="forn-card">
        <div class="forn-bank-head"><h2>Contas Bancárias <small class="tc-muted">(opcional — IBAN e/ou n.º de conta; pode acrescentar mais tarde)</small></h2></div>
        <div id="tcContas">${contaRow()}</div>
        <button type="button" class="forn-add-bank" data-add="conta">+ Adicionar conta bancária</button>
      </section>
      <section class="forn-card">
        <h2>Contactos</h2>
        <div id="tcContatos">${contatoRow()}</div>
        <button type="button" class="forn-add-bank" data-add="contato">+ Adicionar contacto</button>
      </section>
      <div class="forn-actions">
        <a href="/fornecedores" class="forn-top-btn">Cancelar</a>
        ${canManage ? '<button class="forn-submit" type="submit">Guardar terceiro</button>' : '<p class="forn-denied">Sem permissão para guardar terceiros.</p>'}
      </div>
    </form>`;

  const form = root.querySelector("#tcForm");
  const sincronizar = () => {
    root.querySelector(".tc-setcli").classList.toggle("hidden", !roles.has("CLIENTE"));
    root.querySelector(".tc-setforn").classList.toggle("hidden", !roles.has("FORNECEDOR"));
    root.querySelector("#tcCond").innerHTML = secCondicoes(roles);
  };
  form.addEventListener("change", (e) => {
    const r = e.target.dataset?.role;
    if (r) {
      if (e.target.checked) roles.add(r);
      else roles.delete(r);
      sincronizar();
    }
    if (e.target.name === "country") {
      const reg = form.querySelector("[name=region]");
      if (e.target.value && e.target.value !== "Angola") reg.value = "Fora de Angola";
      else if (reg.value === "Fora de Angola") reg.value = "";
    }
  });
  form.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) {
      const host = form.querySelector(add.dataset.add === "conta" ? "#tcContas" : "#tcContatos");
      host.insertAdjacentHTML("beforeend", add.dataset.add === "conta" ? contaRow() : contatoRow());
      return;
    }
    const del = e.target.closest("[data-del]");
    if (del) del.closest(".tc-row").remove();
  });
  // Ao escrever o IBAN, o banco reconhece-se pelos 4 algarismos depois de «AO06».
  form.addEventListener("input", (e) => {
    if (e.target.dataset?.c !== "iban") return;
    const m = /^AO\d{2}\s?(\d{4})/i.exec(e.target.value.replace(/\s+/g, ""));
    const sel = e.target.closest("[data-conta]").querySelector('[data-c="bankName"]');
    const b = m && BANCOS.find((x) => x.ibanCode === m[1]);
    if (b && !sel.value) sel.value = b.code;
  });

  bindNifLookup({
    nifInput: form.querySelector("[name=nif]"),
    button: form.querySelector("[data-lookup-nif]"),
    statusEl: form.querySelector("[data-nif-status]"),
    register: false,
    onResult: ({ ok, agt, result }) => {
      if (!ok) return;
      if (result?.existingSupplier) toast(`Este NIF já está registado (${result.existingSupplier.name}).`, { type: "error" });
      const nome = form.querySelector("[name=name]");
      if (agt?.nome && !nome.value.trim()) nome.value = agt.nome;
      const ivaTxt = String(agt?.regimeIva || "").toLowerCase();
      const iva = /geral/.test(ivaTxt) ? IVAS[0] : /simplific/.test(ivaTxt) ? IVAS[1] : /exclus/.test(ivaTxt) ? IVAS[2] : "";
      if (iva) form.querySelectorAll("[name=cliIva],[name=fornIva]").forEach((s) => !s.value && (s.value = iva));
    },
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!can("fornecedores", "manage")) return toast("Sem permissão para guardar.", { type: "error" });
    const v = (n) => form.querySelector(`[name=${n}]`)?.value?.trim() || "";
    const falta = [];
    if (v("name").length < 2) falta.push("o nome");
    if (normalizeNif(v("nif")).length < 5) falta.push("o NIF");
    if (!roles.size) falta.push("o tipo de terceiro");
    if (!v("country")) falta.push("o país");
    if (!v("region")) falta.push("a região / província");
    if (roles.has("CLIENTE") && !v("cliCond")) falta.push("a condição de pagamento como cliente");
    if (roles.has("FORNECEDOR") && !v("fornCond")) falta.push("a condição de pagamento como fornecedor");
    if (roles.has("FORNECEDOR") && !v("fornRet")) falta.push("a retenção na fonte");
    const contas = [...form.querySelectorAll("[data-conta]")]
      .map((r) => Object.fromEntries([...r.querySelectorAll("[data-c]")].map((i) => [i.dataset.c, i.value.trim() || null])))
      .filter((c) => c.iban || c.accountNumber);
    const ibanMau = contas.find((c) => c.iban && !/^AO\d{2}\d{21}$/i.test(c.iban.replace(/\s+/g, "")) && v("country") === "Angola");
    if (ibanMau) falta.push(`um IBAN válido (AO06 + 21 algarismos): ${ibanMau.iban}`);
    if (falta.length) return toast(`Falta ${falta.join(", ")}.`, { type: "error" });
    const yn = (n) => (v(n) === "" ? null : v(n) === "1");
    const body = {
      code: v("code") || null,
      name: v("name").toUpperCase(),
      nif: normalizeNif(v("nif")),
      roles: [...roles],
      country: v("country"),
      region: v("region"),
      address: v("address") || null,
      setorCliente: roles.has("CLIENTE") ? v("setorCliente") || null : null,
      setorFornecedor: roles.has("FORNECEDOR") ? v("setorFornecedor") || null : null,
      cliente: roles.has("CLIENTE")
        ? { cond: v("cliCond"), regimeIva: v("cliIva") || null, seguroConstrucao: v("cliSegC") === "1", seguroGarantia: v("cliSegG") === "1", moeda: v("cliMoeda") || "AOA", desconto: yn("cliDesc") }
        : null,
      fornecedor: roles.has("FORNECEDOR")
        ? { limiteCredito: v("fornLimite") === "" ? null : Number(v("fornLimite")), cond: v("fornCond"), regimeIva: v("fornIva") || null, retencao: v("fornRet") === "1", moeda: v("fornMoeda") || "AOA", desconto: yn("fornDesc") }
        : null,
      contas,
      contatos: [...form.querySelectorAll("[data-contato]")]
        .map((r) => Object.fromEntries([...r.querySelectorAll("[data-k]")].map((i) => [i.dataset.k, i.value.trim() || null])))
        .filter((c) => c.nome || c.telefone || c.email),
    };
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const t = await apiRequest("/suppliers/terceiro", { method: "POST", body });
      toast(`Terceiro ${t.code} — ${t.name} guardado${roles.has("CLIENTE") ? " (e registado como cliente)" : ""}.`, { type: "success" });
      await render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      btn.disabled = false;
      const d = err?.data;
      toast(d?.message || (typeof d?.error === "string" ? d.error : null) || err.message || "Não foi possível guardar.", { type: "error" });
    }
  });
}

async function boot() {
  if (!document.body?.dataset.terceiro) return;
  if (!checkAuth()) return;
  const ok = await guardPageAccess("fornecedores", "view");
  if (!ok) return;
  await initPermissionLayer();
  wireUsersNav();
  wireLogout();
  initMobileMenu();
  await render();
}

boot();
