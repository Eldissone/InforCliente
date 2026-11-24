const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ROLES,
  ACTION_LABELS,
  PERMISSION_GROUPS,
  PAGE_ROUTE_GUARDS,
  defaultAllowedFor,
  buildDefaultPermissions,
  buildDisplayCatalog,
} = require("../src/config/permissionsCatalog");

function buildEffectiveMapForRole(role, overrides = {}) {
  const rows = buildDefaultPermissions().filter((r) => r.role === role);
  const map = {};
  for (const r of rows) {
    map[`${r.module}:${r.action}`] = r.allowed;
  }
  return { ...map, ...overrides };
}

test("permissionsCatalog: todas as ações de navlinks possuem ACTION_LABELS legíveis", () => {
  const navGroup = PERMISSION_GROUPS.find((g) => g.id === "navlinks");
  assert.ok(navGroup, "Grupo navlinks deve existir");
  assert.ok(navGroup.actions.includes("nav_registos"), "nav_registos deve existir em navlinks");

  for (const action of navGroup.actions) {
    assert.ok(
      ACTION_LABELS[action] && ACTION_LABELS[action] !== action,
      `ACTION_LABELS deve definir etiqueta legível para ${action}`
    );
  }
});

test("permissionsCatalog: fornecedores possui defaults definidos para perfis operacionais", () => {
  assert.equal(defaultAllowedFor("admin", "fornecedores", "view"), "true");
  assert.equal(defaultAllowedFor("supervisor", "fornecedores", "view"), "true");
  assert.equal(defaultAllowedFor("operador", "fornecedores", "view"), "true");
  assert.equal(defaultAllowedFor("financeiro", "fornecedores", "view"), "true");
  assert.equal(defaultAllowedFor("tecnico", "fornecedores", "view"), "view");
  assert.equal(defaultAllowedFor("leitura", "fornecedores", "view"), "true");
  assert.equal(defaultAllowedFor("cliente", "fornecedores", "view"), "false");
});

test("permissionsCatalog: buildDisplayCatalog inclui todos os grupos e linhas com labels traduzidas", () => {
  const catalog = buildDisplayCatalog();
  const navDisplay = catalog.find((g) => g.module === "navlinks");
  assert.ok(navDisplay);
  for (const row of navDisplay.rows) {
    assert.ok(row.label.startsWith("Menu:"), `Etiqueta inesperada para ${row.action}: ${row.label}`);
  }
});

test("permissionsCatalog: mapas efetivos de cada perfil distinguem áreas de navegação", () => {
  const finMap = buildEffectiveMapForRole("financeiro");
  assert.equal(finMap["navlinks:nav_financeiro"], "true");
  assert.equal(finMap["navlinks:nav_logistica"], "false");
  assert.equal(finMap["navlinks:nav_registos"], "true");
  assert.equal(finMap["financeiro:view"], "true");
  assert.equal(finMap["stock:view"], "false");

  const leituraMap = buildEffectiveMapForRole("leitura");
  assert.equal(leituraMap["navlinks:nav_dashboard"], "true");
  assert.equal(leituraMap["navlinks:nav_registos"], "true");
  assert.equal(leituraMap["navlinks:nav_obras"], "true");
  assert.equal(leituraMap["navlinks:nav_comercial"], "true");
  assert.equal(leituraMap["navlinks:nav_financeiro"], "false");
  assert.equal(leituraMap["obras:create"], "false");

  const clienteMap = buildEffectiveMapForRole("cliente");
  assert.equal(clienteMap["navlinks:nav_dashboard"], "false");
  assert.equal(clienteMap["navlinks:nav_registos"], "false");
  assert.equal(clienteMap["portal:view"], "true");
});

test("PAGE_ROUTE_GUARDS: cobre rotas principais sem bloquear overrides de utilizador", () => {
  const routes = new Map(PAGE_ROUTE_GUARDS.map((g) => [g.route, g]));
  assert.ok(routes.has("/Dashboard/index.html"));
  assert.ok(routes.has("/Financeiro/overview"));
  assert.ok(routes.has("/comercial/orcamentos"));
  assert.ok(routes.has("/fornecedores"));
  assert.ok(routes.has("/equipamentos"));
  assert.ok(routes.has("/registos/contactos"));
  assert.ok(routes.has("/registos/obras"));
  assert.ok(routes.has("/Users/index.html"));
  assert.equal(routes.get("/Users/index.html").roles, undefined);
  assert.equal(routes.get("/Financeiro/overview").roles, undefined);
});
