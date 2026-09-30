import { apiRequest, apiUpload } from "/services/api.js";
import { checkAuth } from "/services/auth.js";
import { wireLogout, wireUsersNav } from "/shared/session.js";
import { initMobileMenu, openModal, toast } from "/shared/ui.js";

const CONTACTS_KEY = "InfoCliente.registo.contactos";
const SETORES_KEY = "InfoCliente.registo.setores";
const PESSOAL_KEY = "InfoCliente.registo.pessoal";

const TIPOS_OBRA = [
  "Eletrificação Rural",
  "Eletrificação Urbana",
  "Expansão da Rede",
  "Reabilitação da Rede",
  "Melhoria / Reforço da Rede",
  "Nova Infraestrutura Elétrica",
  "Ligação de Cliente / Empreendimento",
  "Iluminação Pública",
  "Instalação Elétrica",
  "Energia Solar / Sistema Isolado",
  "Outro",
];

const SERVICOS = [
  "Rede de Média Tensão (MT)",
  "Postos de Transformação (PT)",
  "Rede de Baixa Tensão (BT)",
  "Ramal",
  "Ligação Domiciliária",
  "Iluminação Pública",
  "Subestação Elétrica",
];

const FUNCOES = [
  "Director de Obra",
  "Supervisor de Obra",
  "Coordenador Financeiro",
  "Encarregado",
  "Técnico de Obra",
  "Responsável de Segurança",
];

const CATEGORIAS = [
  "Combustível",
  "EPI e Uniformes",
  "Equipamentos",
  "Ferramentas e Utensílios",
  "Viaturas e Maquinarias",
  "Materiais Diversos",
  "Materiais de Obra",
  "Materiais de Escritório",
  "Comunicação",
  "Materiais Informáticos",
  "Materiais de Limpeza e Higiene",
  "Peças e Acessórios",
  "Deslocação e Estadia",
  "Produtos Alimentares",
  "Despesas de Representação",
  "Empréstimos",
  "Impostos",
  "Pessoal",
  "Seguros",
  "Serviços de Maquinaria",
  "Serviços Diversos",
  "Serviços Internos",
  "Serviços de Manutenção de Frota",
  "Serviços de Transporte e Logística",
];

const SUBCATEGORIAS = [
  "Gasolina",
  "Gasóleo",
  "EPIs",
  "Uniformes",
  "Eletrodomésticos",
  "Mobiliário",
  "Equipamentos Informáticos",
  "Ferramentas e Utensílios de Obra",
  "Consumíveis de Ferramentas",
  "Maquinaria",
  "Material Elétrico",
  "Inertes",
  "Material de Construção",
  "Ferragens",
  "Consumíveis de Obra",
  "Material de Limpeza e Higiene",
  "Consumíveis de Limpeza e Higiene",
  "Lubrificantes e Óleos",
  "Peças de Viaturas",
  "Filtros",
  "Transporte",
  "Pneus",
  "Baterias",
  "Alimentação",
  "Alojamento",
  "Ferramentas e Utensílios de Cozinha",
  "Empréstimos",
  "Impostos Gerais",
  "Impostos com Pessoal",
  "Impostos de Viaturas",
  "Salários",
  "Horas Extras",
  "Aluguer de Máquinas",
  "Operação de Máquinas",
  "Subcontratação",
  "Seguros de Viaturas e Maquinarias",
  "Outros Seguros",
  "Frete / Transporte",
  "Estafeta",
  "Viaturas",
];

const UNIDADES = ["UN", "KG", "M", "L", "CX", "PAR", "MT2", "MT3"];

const STATUS_MAP = {
  "Por Iniciar": "ACTIVE",
  "Em Execução": "ACTIVE",
  "Em Pausa": "ON_HOLD",
  "Concluído": "COMPLETED",
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function readStore(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(key, items) {
  localStorage.setItem(key, JSON.stringify(items));
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function invalid(message) {
  const error = new Error(message);
  error.validation = true;
  throw error;
}

function parseMoney(raw) {
  const text = String(raw || "").trim().replace(/\s/g, "");
  if (!text) return null;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(text)
      ? text.replace(/\./g, "")
      : text;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function apiMessage(error) {
  return error?.data?.message || error?.data?.error || error?.message || "Não foi possível guardar.";
}

export function readObraRegisto(project) {
  const raw = project?.maoDeObraIndireta;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.registo && typeof raw.registo === "object") {
    return raw.registo;
  }
  return {};
}

function mergeObraRegisto(project, registo) {
  const raw = project?.maoDeObraIndireta;
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  if (raw != null && (Array.isArray(raw) || typeof raw !== "object")) base.legado = raw;
  base.registo = { ...(base.registo || {}), ...registo };
  return base;
}

export function obraEstadoLabel(project) {
  const estado = readObraRegisto(project).estado;
  if (estado) return estado;
  if (["Por Iniciar", "Em Execução", "Em Pausa", "Concluído"].includes(project?.phaseLabel)) return project.phaseLabel;
  if (project?.status === "ON_HOLD") return "Em Pausa";
  if (project?.status === "COMPLETED") return "Concluído";
  return "Em Execução";
}

export function obraTiposLabel(project) {
  const tipos = readObraRegisto(project).tipos;
  if (Array.isArray(tipos) && tipos.length) return tipos.join(" · ");
  return project?.projectType || "";
}

function field(label, control, extra = "") {
  return `<label class="registry-field ${extra}"><span>${label}</span>${control}</label>`;
}

function textInput(name, options = {}) {
  const type = options.type || "text";
  return `<input name="${name}" type="${type}" ${options.required ? "required" : ""} ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ""} ${options.list ? `list="${options.list}"` : ""} ${options.accept ? `accept="${options.accept}"` : ""} ${options.step ? `step="${options.step}"` : ""}>`;
}

function selectInput(name, options, placeholder) {
  const items = options.map((option) => {
    const value = typeof option === "string" ? option : option.value;
    const label = typeof option === "string" ? option : option.label;
    return `<option value="${esc(value)}">${esc(label)}</option>`;
  }).join("");
  return `<select name="${name}" required><option value="">${esc(placeholder || "Seleccionar")}</option>${items}</select>`;
}

function checkGrid(name, options) {
  return `<div class="registry-checks">${options.map((option) => {
    const value = typeof option === "string" ? option : option.value;
    const label = typeof option === "string" ? option : option.label;
    const photo = typeof option === "string" ? "" : option.photo;
    return `<label class="registry-check"><input type="checkbox" name="${esc(name)}" value="${esc(value)}">${photo ? `<img src="${esc(photo)}" alt="">` : ""}<span>${label}</span></label>`;
  }).join("")}</div>`;
}

function checkedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function formShell(lead, body, submitLabel = "Registar") {
  return `<form class="registry-form" novalidate>
    <p class="registry-lead">${lead}</p>
    ${body}
    <div class="registry-actions"><button class="registry-submit" type="submit">${submitLabel}</button></div>
  </form>`;
}

function estadoFields(selected = "") {
  const options = ["Por Iniciar", "Em Execução", "Em Pausa", "Concluído"].map((estado) => (
    `<option value="${estado}" ${estado === selected ? "selected" : ""}>${estado}</option>`
  )).join("");
  return `<div class="registry-section" data-estado-box>
    ${field("Estado da Obra", `<select name="estado" required><option value="">Seleccionar</option>${options}</select>`)}
    <div class="registry-pausas" data-pausas hidden>
      <p class="registry-note">Uma obra pode ter várias pausas. Indique o início e o fim de cada uma.</p>
      <div data-pausa-list></div>
      <div class="registry-inline-actions"><button class="registry-ghost" type="button" data-add-pausa>Adicionar pausa</button></div>
    </div>
    <div data-efetiva hidden>
      ${field("Data Conclusão Obra (Efetiva)", textInput("conclusaoEfetiva", { type: "date" }))}
    </div>
  </div>`;
}

function addPausaRow(list, index, values = {}) {
  const row = document.createElement("div");
  row.className = "registry-grid";
  row.innerHTML = `
    ${field(`Data Início — Pausa ${index}`, `<input type="date" data-pausa-inicio value="${esc(values.inicio || "")}">`)}
    ${field(`Data Fim — Pausa ${index}`, `<input type="date" data-pausa-fim value="${esc(values.fim || "")}">`)}
  `;
  list.appendChild(row);
}

function bindEstado(scope, pausas = []) {
  const select = scope.querySelector("[name=estado]");
  const pausaBox = scope.querySelector("[data-pausas]");
  const efetiva = scope.querySelector("[data-efetiva]");
  const list = scope.querySelector("[data-pausa-list]");
  if (!select || !pausaBox || !list) return;

  const sync = () => {
    pausaBox.hidden = select.value !== "Em Pausa";
    if (efetiva) efetiva.hidden = select.value !== "Concluído";
    if (select.value === "Em Pausa" && !list.children.length) addPausaRow(list, 1);
  };

  scope.querySelector("[data-add-pausa]")?.addEventListener("click", () => {
    addPausaRow(list, list.children.length + 1);
  });
  select.addEventListener("change", sync);
  pausas.forEach((pausa, index) => addPausaRow(list, index + 1, pausa));
  sync();
}

function collectEstado(scope) {
  const estado = scope.querySelector("[name=estado]")?.value || "";
  if (!estado) invalid("Seleccione o estado da obra.");
  const pausas = [...scope.querySelectorAll("[data-pausa-list] .registry-grid")].map((row) => ({
    inicio: row.querySelector("[data-pausa-inicio]")?.value || "",
    fim: row.querySelector("[data-pausa-fim]")?.value || "",
  })).filter((pausa) => pausa.inicio || pausa.fim);

  if (estado === "Em Pausa" && (!pausas.length || pausas.some((pausa) => !pausa.inicio || !pausa.fim))) {
    invalid("Indique a data de início e de fim de cada pausa.");
  }
  const conclusaoEfetiva = scope.querySelector("[name=conclusaoEfetiva]")?.value || "";
  if (estado === "Concluído" && !conclusaoEfetiva) invalid("Indique a data de conclusão efetiva.");
  return {
    estado,
    pausas: estado === "Em Pausa" ? pausas : [],
    conclusaoEfetiva: estado === "Concluído" ? conclusaoEfetiva : "",
  };
}

function readPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    if (!file.type.startsWith("image/")) {
      reject(new Error("A foto tem de ser uma imagem."));
      return;
    }
    if (file.size > 350 * 1024) {
      reject(new Error("A foto deve ter no máximo 350 KB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler a foto."));
    reader.readAsDataURL(file);
  });
}

function mount(kind, html, onSubmit) {
  const root = document.getElementById("registryRoot");
  if (!root) return;
  root.innerHTML = html;
  const form = root.querySelector("form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("[type=submit]");
    if (button) button.disabled = true;
    try {
      await onSubmit(form);
      toast("Registo guardado.", { type: "success" });
      renderKind(kind);
    } catch (error) {
      toast(apiMessage(error), { type: "error" });
      if (button) button.disabled = false;
    }
  });
  return form;
}

function renderContactos() {
  const funcoes = FUNCOES.map((funcao) => `<option value="${esc(funcao)}"></option>`).join("");
  mount("contactos", formShell(
    "Registe as pessoas que podem ser associadas a uma obra, incluindo a área financeira.",
    `<div class="registry-grid">
      ${field("Nome", textInput("nome", { required: true, placeholder: "Euclides Cabenda" }), "span-2")}
      ${field("Função", `${textInput("funcao", { required: true, placeholder: "Director de Obra", list: "funcoes-list" })}<datalist id="funcoes-list">${funcoes}</datalist>`)}
      ${field("Telefone", textInput("telefone", { required: true, placeholder: "+244" }))}
      ${field("Email", textInput("email", { type: "email", placeholder: "nome@empresa.com" }))}
      ${field("Foto", textInput("foto", { type: "file", accept: "image/*" }))}
    </div>`
  ), async (form) => {
    const data = new FormData(form);
    const nome = String(data.get("nome") || "").trim();
    const funcao = String(data.get("funcao") || "").trim();
    if (nome.length < 2 || funcao.length < 2) invalid("Indique o nome e a função.");
    const foto = await readPhoto(data.get("foto"));
    const items = readStore(CONTACTS_KEY);
    items.push({
      id: newId(),
      nome,
      funcao,
      telefone: String(data.get("telefone") || "").trim(),
      email: String(data.get("email") || "").trim(),
      foto,
    });
    writeStore(CONTACTS_KEY, items);
  });
}

function renderPessoal() {
  const funcoes = FUNCOES.map((funcao) => `<option value="${esc(funcao)}"></option>`).join("");
  mount("pessoal", formShell(
    "Registo de pessoal. Fica disponível neste dispositivo.",
    `<div class="registry-grid">
      ${field("Nome", textInput("nome", { required: true }), "span-2")}
      ${field("Função", `${textInput("funcao", { required: true, list: "funcoes-pessoal" })}<datalist id="funcoes-pessoal">${funcoes}</datalist>`)}
      ${field("Telefone", textInput("telefone"))}
      ${field("Email", textInput("email", { type: "email" }))}
      ${field("Foto", textInput("foto", { type: "file", accept: "image/*" }))}
    </div>`
  ), async (form) => {
    const data = new FormData(form);
    const nome = String(data.get("nome") || "").trim();
    const funcao = String(data.get("funcao") || "").trim();
    if (nome.length < 2 || funcao.length < 2) invalid("Indique o nome e a função.");
    const items = readStore(PESSOAL_KEY);
    items.push({
      id: newId(),
      nome,
      funcao,
      telefone: String(data.get("telefone") || "").trim(),
      email: String(data.get("email") || "").trim(),
      foto: await readPhoto(data.get("foto")),
    });
    writeStore(PESSOAL_KEY, items);
  });
}

function renderSetores() {
  mount("setores", formShell(
    "Registo de setores. Fica disponível neste dispositivo.",
    field("Nome do setor", textInput("nome", { required: true, placeholder: "Financeiro" }))
  ), async (form) => {
    const nome = String(new FormData(form).get("nome") || "").trim();
    if (nome.length < 2) invalid("Indique o nome do setor.");
    const items = readStore(SETORES_KEY);
    items.push({ id: newId(), nome });
    writeStore(SETORES_KEY, items);
  });
}

function renderFornecedores() {
  mount("fornecedores", formShell(
    "Registo de fornecedores no Info Gestor.",
    `<div class="registry-grid">
      ${field("Nome", textInput("name", { required: true }), "span-2")}
      ${field("NIF", textInput("nif"))}
      ${field("Categoria", textInput("category", { placeholder: "Materiais, transporte..." }))}
      ${field("Contacto", textInput("contact"))}
      ${field("Telefone", textInput("phone"))}
      ${field("Email", textInput("email", { type: "email" }))}
      ${field("Morada", textInput("address"), "span-2")}
    </div>`
  ), async (form) => {
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    if (!name) invalid("Indique o nome do fornecedor.");
    await apiRequest("/suppliers", {
      method: "POST",
      body: {
        name,
        nif: String(data.get("nif") || "").trim() || null,
        category: String(data.get("category") || "").trim() || null,
        contact: String(data.get("contact") || "").trim() || null,
        phone: String(data.get("phone") || "").trim() || null,
        email: String(data.get("email") || "").trim() || null,
        address: String(data.get("address") || "").trim() || null,
      },
    });
  });
}

function renderClientes() {
  mount("clientes", formShell(
    "Registo de clientes no Info Gestor. O email e a palavra-passe criam o acesso do cliente.",
    `<div class="registry-grid">
      ${field("Código", textInput("code", { required: true, placeholder: "CLI-001" }))}
      ${field("Nome", textInput("name", { required: true, placeholder: "Mitrelli Project" }))}
      ${field("Setor / actividade", textInput("industry"))}
      ${field("Região", textInput("region", { placeholder: "Kwanza Sul" }))}
      ${field("Email de acesso", textInput("email", { type: "email", required: true }))}
      ${field("Palavra-passe", textInput("password", { type: "password", required: true }))}
    </div>`
  ), async (form) => {
    const data = new FormData(form);
    const password = String(data.get("password") || "");
    if (password.length < 6) invalid("A palavra-passe deve ter pelo menos 6 caracteres.");
    await apiRequest("/clients", {
      method: "POST",
      body: {
        code: String(data.get("code") || "").trim(),
        name: String(data.get("name") || "").trim(),
        industry: String(data.get("industry") || "").trim() || null,
        region: String(data.get("region") || "").trim() || null,
        email: String(data.get("email") || "").trim(),
        password,
      },
    });
  });
}

async function renderObras() {
  let clients = [];
  try {
    const data = await apiRequest("/clients?page=1&pageSize=100&sort=updatedAt_desc");
    clients = data.items || [];
  } catch {
    clients = [];
  }
  const contacts = readStore(CONTACTS_KEY);
  const clientOptions = clients.map((client) => ({ value: client.id, label: client.name }));
  const contactOptions = contacts.map((contact) => ({
    value: contact.id,
    label: `${esc(contact.nome)} — ${esc(contact.funcao || "Sem função")}`,
    photo: contact.foto || "",
  }));

  const form = mount("obras", `<form class="registry-form obra-form" novalidate>
    <header class="obra-form-heading"><div><h2>Criar Obra</h2><p>Preencha os dados da nova obra para iniciar o processo de criação.</p></div><a href="/Projectos/ProjectGeral.html">‹ &nbsp; Voltar</a></header>
    <section class="obra-card"><h3>Informação Geral da Obra</h3><div class="registry-grid obra-general">
      ${field("Descrição da Obra", textInput("descricao", { required: true, placeholder: "Ex: Electrificação Rural Município da Quibala" }))}
      ${field("Tipo de Obra", `<details class="obra-multiselect"><summary>Seleccione múltiplos</summary>${checkGrid("tipos", TIPOS_OBRA)}</details>`)}
      ${field("Composição de Serviços", `<details class="obra-multiselect"><summary>Seleccione múltiplos</summary>${checkGrid("servicos", SERVICOS)}</details>`)}
      ${field("Sigla", textInput("sigla", { required: true, placeholder: "Ex: MTR-QUIB" }))}
      ${field("Cliente", clients.length ? selectInput("clientId", clientOptions, "Seleccione cliente") : `<select disabled><option value="">Registe um cliente primeiro</option></select>`)}
      ${field("Local", textInput("local", { required: true, placeholder: "Ex: Kwanza Sul" }))}
      ${field("Empreiteiro", textInput("empreiteiro", { placeholder: "MBT Energia" }))}
      ${field("Sub-Empreiteiro", textInput("subempreiteiro", { placeholder: "Opcional" }))}
      ${field("Valor Venda S/IVA", textInput("valor", { required: true, placeholder: "0.00" }))}
    </div></section>
    <section class="obra-card"><h3>Datas</h3><div class="registry-grid">
      ${field("Data Início Operacional", textInput("inicioOperacional", { type: "date" }))}
      ${field("Data Arranque Obra", textInput("arranque", { type: "date" }))}
      ${field("Data Conclusão Obra Previsional", textInput("conclusaoPrevisional", { type: "date" }))}
    </div></section>
    <section class="obra-card"><h3>Estado da Obra</h3><div class="registry-grid obra-status">${estadoFields()}</div></section>
    <section class="obra-card obra-contacts"><div class="obra-card-title"><h3>Contactos da Obra</h3><a class="registry-ghost" href="/registos/contactos">Adicionar Contacto</a></div>
      ${contacts.length ? `<div class="obra-contact-options">${checkGrid("contactos", contactOptions)}</div>` : `<p class="registry-note"><a href="/registos/contactos">Registe contactos</a> antes de os associar à obra.</p>`}
    </section>
    <div class="registry-actions"><a class="registry-ghost" href="/Projectos/ProjectGeral.html">Cancelar</a><button class="registry-submit" type="submit">Guardar Obra</button></div>
  </form>`, async (form) => {
    const data = new FormData(form);
    const descricao = String(data.get("descricao") || "").trim();
    const sigla = String(data.get("sigla") || "").trim();
    const local = String(data.get("local") || "").trim();
    const valor = parseMoney(data.get("valor"));
    const tipos = checkedValues(form, "tipos");
    const servicos = checkedValues(form, "servicos");
    if (descricao.length < 2) invalid("Indique a descrição da obra.");
    if (sigla.length < 3) invalid("A sigla deve ter pelo menos 3 caracteres.");
    if (!local) invalid("Indique o local.");
    if (valor == null || valor < 0) invalid("Indique o valor de venda.");
    if (!tipos.length) invalid("Seleccione pelo menos um tipo de obra.");
    if (!servicos.length) invalid("Seleccione pelo menos um serviço.");
    const estado = collectEstado(form);
    const selected = readStore(CONTACTS_KEY).filter((contact) => checkedValues(form, "contactos").includes(contact.id));
    const director = selected.find((contact) => /director/i.test(contact.funcao || "")) || selected[0] || null;
    const inicio = toIsoDate(data.get("inicioOperacional"));
    const previsional = toIsoDate(data.get("conclusaoPrevisional"));
    const efetiva = toIsoDate(estado.conclusaoEfetiva);

    await apiRequest("/projects", {
      method: "POST",
      body: {
        code: sigla,
        referencia: sigla,
        name: descricao,
        clientId: String(data.get("clientId") || "") || null,
        location: local,
        region: local,
        empreiteiro: String(data.get("empreiteiro") || "").trim() || null,
        subempreiteiro: String(data.get("subempreiteiro") || "").trim() || null,
        budgetTotal: valor,
        currency: "AOA",
        status: STATUS_MAP[estado.estado] || "ACTIVE",
        phaseLabel: estado.estado,
        startDate: inicio,
        dueDate: previsional,
        contact: selected.map((contact) => contact.nome).join(", ") || null,
        directorObra: director?.nome || null,
        directorPhone: director?.telefone || null,
        directorEmail: director?.email || null,
        technicians: selected.map((contact) => ({
          name: contact.nome,
          role: contact.funcao,
          phone: contact.telefone,
          email: contact.email,
        })),
        maoDeObraIndireta: {
          registo: {
            tipos,
            servicos,
            sigla,
            inicioOperacional: data.get("inicioOperacional") || "",
            arranque: data.get("arranque") || "",
            conclusaoPrevisional: data.get("conclusaoPrevisional") || "",
            conclusaoEfetiva: efetiva ? estado.conclusaoEfetiva : "",
            estado: estado.estado,
            pausas: estado.pausas,
            contactos: selected.map(({ id, nome, funcao, telefone, email }) => ({ id, nome, funcao, telefone, email })),
          },
        },
      },
    });
  });
  if (form) {
    bindEstado(form);
    form.querySelectorAll(".obra-multiselect").forEach((select) => {
      const summary = select.querySelector("summary");
      const refresh = () => {
        const count = select.querySelectorAll("input:checked").length;
        summary.textContent = count ? `${count} seleccionado${count === 1 ? "" : "s"}` : "Seleccione múltiplos";
      };
      select.addEventListener("change", refresh);
    });
  }
}

function renderProdutos() {
  mount("produtos", formShell(
    "Registo de um produto ou de um serviço no catálogo.",
    `<div class="registry-grid">
      ${field("Nome", textInput("name", { required: true }), "span-2")}
      ${field("Classificação", selectInput("kind", ["Produto", "Serviço"]))}
      ${field("SKU / Ref", textInput("sku"))}
      ${field("Unidade", selectInput("unit", UNIDADES))}
      ${field("Descrição", `<textarea name="description"></textarea>`, "span-2")}
      ${field("Foto", textInput("photo", { type: "file", accept: "image/*" }))}
    </div>`
  ), async (form) => {
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const kind = String(data.get("kind") || "");
    if (name.length < 2) invalid("Indique o nome.");
    if (!kind) invalid("Seleccione a classificação.");
    const description = String(data.get("description") || "").trim();
    const created = await apiRequest("/products", {
      method: "POST",
      body: {
        name,
        sku: String(data.get("sku") || "").trim() || null,
        description: description || (kind === "Serviço" ? "Serviço" : null),
        category: kind === "Serviço" ? "CONSUMABLE" : "MATERIAL",
        unit: String(data.get("unit") || "UN"),
        minStock: 0,
      },
    });
    const photo = data.get("photo");
    if (photo && photo.size && created?.id) {
      await apiUpload(`/products/${created.id}/photo`, { file: photo, fieldName: "photo" });
    }
  });
}

function renderEquipamentos() {
  mount("equipamentos", formShell(
    "Registo de equipamento, maquinaria, viatura ou ferramenta.",
    `<div class="registry-grid">
      ${field("Nome", textInput("name", { required: true }), "span-2")}
      ${field("Tipo", selectInput("kind", ["Equipamento", "Maquinaria", "Viatura", "Ferramenta"]))}
      ${field("Matrícula / série", textInput("sku"))}
      ${field("Unidade", selectInput("unit", UNIDADES))}
      ${field("Descrição", `<textarea name="description"></textarea>`, "span-2")}
      ${field("Foto", textInput("photo", { type: "file", accept: "image/*" }))}
    </div>`
  ), async (form) => {
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const kind = String(data.get("kind") || "");
    if (name.length < 2) invalid("Indique o nome.");
    if (!kind) invalid("Seleccione o tipo.");
    const serie = String(data.get("sku") || "").trim();
    const description = [kind, serie ? `Série/matrícula: ${serie}` : "", String(data.get("description") || "").trim()]
      .filter(Boolean)
      .join(" · ");
    const created = await apiRequest("/products", {
      method: "POST",
      body: {
        name,
        sku: serie || null,
        description,
        category: kind === "Ferramenta" ? "TOOL" : "EQUIPMENT",
        unit: String(data.get("unit") || "UN"),
        minStock: 0,
      },
    });
    const photo = data.get("photo");
    if (photo && photo.size && created?.id) {
      await apiUpload(`/products/${created.id}/photo`, { file: photo, fieldName: "photo" });
    }
  });
}

function renderTipoCusto() {
  mount("tipo-custo", formShell(
    "Classifique o tipo de custo como produto ou serviço.",
    `<div class="registry-grid">
      ${field("Tipo", selectInput("tipo", ["Produto", "Serviço"]))}
      ${field("Designação", textInput("nome", { required: true, placeholder: "Nome do tipo de custo" }), "span-2")}
    </div>`
  ), async (form) => {
    const data = new FormData(form);
    const tipo = String(data.get("tipo") || "").trim();
    const nome = String(data.get("nome") || "").trim();
    if (!tipo || nome.length < 2) invalid("Indique o tipo e a designação.");
    await apiRequest("/cost-categories", {
      method: "POST",
      body: {
        domain: "GERAL",
        sheetLevel: "TIPO1",
        name: `${tipo} — ${nome}`,
      },
    });
  });
}

function renderCategorias() {
  mount("categorias", formShell(
    "Registe uma categoria de custo.",
    field("Categoria", selectInput("nome", CATEGORIAS, "Seleccionar categoria"))
  ), async (form) => {
    const nome = String(new FormData(form).get("nome") || "").trim();
    if (!nome) invalid("Seleccione a categoria.");
    await apiRequest("/cost-categories", {
      method: "POST",
      body: {
        domain: "OBRA",
        sheetLevel: "TIPO2",
        name: nome,
      },
    });
  });
}

async function renderSubcategorias() {
  let parents = [];
  try {
    const data = await apiRequest("/cost-categories?all=true&domain=OBRA");
    parents = (data.items || []).filter((item) => item.parentId == null);
  } catch {
    parents = [];
  }
  mount("subcategorias", formShell(
    "Registe uma subcategoria dentro de uma categoria de custo já criada.",
    `<div class="registry-grid">
      ${field("Categoria", parents.length
        ? selectInput("parentId", parents.map((item) => ({ value: String(item.id), label: item.name })))
        : `<select disabled><option>Registe primeiro uma categoria</option></select>`)}
      ${field("Subcategoria", selectInput("nome", SUBCATEGORIAS, "Seleccionar subcategoria"))}
    </div>`
  ), async (form) => {
    const data = new FormData(form);
    const parentId = Number(data.get("parentId"));
    const nome = String(data.get("nome") || "").trim();
    if (!parentId || !nome) invalid("Seleccione a categoria e a subcategoria.");
    await apiRequest("/cost-categories", {
      method: "POST",
      body: {
        domain: "OBRA",
        sheetLevel: "SUBCUSTO",
        parentId,
        name: nome,
      },
    });
  });
}

function renderCartoes() {
  mount("cartoes", formShell(
    "O cartão fica disponível para várias obras. Não fica preso a uma obra só.",
    `<div class="registry-grid">
      ${field("Designação", textInput("label", { required: true, placeholder: "Cartão operacional" }), "span-2")}
      ${field("Banco", textInput("bank"))}
      ${field("Titular", textInput("holderName"))}
      ${field("Últimos 4 dígitos", textInput("lastDigits", { placeholder: "1234" }))}
      ${field("Tipo", selectInput("type", [
        { value: "PREPAGO", label: "Pré-pago" },
        { value: "DEBITO", label: "Débito" },
        { value: "CREDITO", label: "Crédito" },
      ]))}
      ${field("Moeda", selectInput("currency", ["AOA", "USD", "EUR"]))}
      ${field("Responsável", textInput("responsibleName"))}
      ${field("Saldo inicial", textInput("initialBalance", { placeholder: "0" }))}
      ${field("Notas", `<textarea name="notes"></textarea>`, "span-2")}
    </div>`
  ), async (form) => {
    const data = new FormData(form);
    const label = String(data.get("label") || "").trim();
    if (!label) invalid("Indique a designação do cartão.");
    const digits = String(data.get("lastDigits") || "").replace(/\D/g, "").slice(-4);
    if (String(data.get("lastDigits") || "").trim() && digits.length !== 4) invalid("Indique os últimos 4 dígitos.");
    const saldo = parseMoney(data.get("initialBalance") || "0");
    if (saldo == null || saldo < 0) invalid("Indique um saldo inicial válido.");
    await apiRequest("/petty-cash/cards", {
      method: "POST",
      body: {
        label,
        bank: String(data.get("bank") || "").trim() || null,
        holderName: String(data.get("holderName") || "").trim() || null,
        lastDigits: digits || null,
        type: String(data.get("type") || "PREPAGO"),
        currency: String(data.get("currency") || "AOA"),
        responsibleName: String(data.get("responsibleName") || "").trim() || null,
        initialBalance: saldo,
        notes: String(data.get("notes") || "").trim() || null,
      },
    });
  });
}

async function renderMovimentos() {
  let cards = [];
  try {
    const data = await apiRequest("/petty-cash/cards");
    cards = data.items || [];
  } catch {
    cards = [];
  }
  mount("movimentos", formShell(
    "Registe um crédito ou um ajuste num cartão bancário.",
    `<div class="registry-grid">
      ${field("Cartão", cards.length
        ? selectInput("cardId", cards.map((card) => ({
          value: card.id,
          label: [card.label, card.bank, card.lastDigits ? `•••• ${card.lastDigits}` : ""].filter(Boolean).join(" · "),
        })))
        : `<select disabled><option>Registe primeiro um cartão</option></select>`, "span-2")}
      ${field("Movimento", selectInput("type", [
        { value: "CREDITO", label: "Crédito" },
        { value: "AJUSTE", label: "Ajuste" },
      ]))}
      ${field("Valor", textInput("amount", { required: true, placeholder: "0" }))}
      ${field("Descrição", `<textarea name="description" required></textarea>`, "span-2")}
    </div>`
  ), async (form) => {
    const data = new FormData(form);
    const cardId = String(data.get("cardId") || "");
    const description = String(data.get("description") || "").trim();
    const amount = parseMoney(data.get("amount"));
    if (!cardId) invalid("Seleccione o cartão.");
    if (description.length < 2) invalid("Indique a descrição do movimento.");
    if (amount == null) invalid("Indique o valor.");
    await apiRequest(`/petty-cash/cards/${encodeURIComponent(cardId)}/movements`, {
      method: "POST",
      body: {
        type: String(data.get("type") || "CREDITO"),
        amount,
        description,
      },
    });
  });
}

const RENDERERS = {
  contactos: renderContactos,
  obras: renderObras,
  setores: renderSetores,
  fornecedores: renderFornecedores,
  clientes: renderClientes,
  produtos: renderProdutos,
  equipamentos: renderEquipamentos,
  pessoal: renderPessoal,
  "tipo-custo": renderTipoCusto,
  categorias: renderCategorias,
  subcategorias: renderSubcategorias,
  cartoes: renderCartoes,
  movimentos: renderMovimentos,
};

function renderKind(kind) {
  const render = RENDERERS[kind];
  if (render) render();
}

export function openObraEstadoDialog(project, onSaved) {
  const registo = readObraRegisto(project);
  openModal({
    title: "Estado da obra",
    primaryLabel: "Atualizar",
    contentHtml: estadoFields(registo.estado || obraEstadoLabel(project)),
    onRender: ({ panel }) => {
      const body = panel.querySelector("[data-body]");
      if (registo.conclusaoEfetiva) {
        const input = body.querySelector("[name=conclusaoEfetiva]");
        if (input) input.value = registo.conclusaoEfetiva;
      }
      bindEstado(body, Array.isArray(registo.pausas) ? registo.pausas : []);
    },
    onPrimary: async ({ close, panel }) => {
      const body = panel.querySelector("[data-body]");
      try {
        const estado = collectEstado(body);
        await apiRequest(`/projects/${encodeURIComponent(project.id)}`, {
          method: "PATCH",
          body: {
            status: STATUS_MAP[estado.estado] || "ACTIVE",
            phaseLabel: estado.estado,
            maoDeObraIndireta: mergeObraRegisto(project, {
              estado: estado.estado,
              pausas: estado.pausas,
              conclusaoEfetiva: estado.conclusaoEfetiva,
            }),
          },
        });
        toast("Estado da obra actualizado.", { type: "success" });
        close();
        if (onSaved) await onSaved();
      } catch (error) {
        toast(apiMessage(error), { type: "error" });
      }
    },
  });
}

const kind = document.body?.dataset.registry;
if (kind && RENDERERS[kind]) {
  checkAuth();
  wireUsersNav();
  wireLogout();
  initMobileMenu();
  renderKind(kind);
}
