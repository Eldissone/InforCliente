// Perfis de acesso — fonte única para selects, filtros, crachás e regras de âmbito.
// A ordem de ROLE_DEFS é a ordem de apresentação nos formulários e filtros.

export const ROLE_DEFS = [
  { id: "admin", label: "Administrador", short: "Admin", icon: "verified_user", cls: "bg-slate-900 text-[#2afc8d] border-slate-800", hint: "Acesso total ao sistema e à gestão de permissões." },
  { id: "supervisor", label: "Supervisor de Obra", short: "Supervisor", icon: "manage_accounts", cls: "bg-purple-50 text-purple-700 border-purple-100", hint: "Acompanha e aprova o trabalho nas obras que lhe são atribuídas." },
  { id: "operador", label: "Operador", short: "Operador", icon: "engineering", cls: "bg-blue-50 text-blue-700 border-blue-100", hint: "Opera o dia a dia: cria e edita registos nas obras atribuídas." },
  { id: "financeiro", label: "Financeiro", short: "Financeiro", icon: "payments", cls: "bg-teal-50 text-teal-700 border-teal-100", hint: "Pagamentos, faturação e módulo financeiro." },
  { id: "tecnico", label: "Técnico de Obra", short: "Técnico", icon: "construction", cls: "bg-indigo-50 text-indigo-700 border-indigo-100", hint: "Registos de campo: planos diários, avanço físico e medições." },
  { id: "leitura", label: "Leitura", short: "Leitura", icon: "visibility", cls: "bg-slate-50 text-slate-500 border-slate-200", hint: "Apenas consulta. Não altera dados." },
  { id: "cliente", label: "Cliente", short: "Cliente", icon: "business", cls: "bg-emerald-50 text-emerald-700 border-emerald-100", hint: "Portal do cliente: só vê as obras e documentos da sua entidade." },
];

/** Perfis cujo acesso depende das obras atribuídas. */
export const PROJECT_SCOPED_ROLES = ["operador", "financeiro", "leitura", "cliente", "tecnico", "supervisor"];

export function roleDef(id) {
  return ROLE_DEFS.find((r) => r.id === id) || ROLE_DEFS.find((r) => r.id === "leitura");
}

export function isProjectScopedRole(role) {
  return PROJECT_SCOPED_ROLES.includes(role);
}

export function roleOptionsHtml(selected = "", { all = false } = {}) {
  const head = all ? `<option value="">Todos os perfis</option>` : "";
  return head + ROLE_DEFS.map((r) => `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${r.label}</option>`).join("");
}
