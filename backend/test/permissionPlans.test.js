const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeRoleBulk,
  computeUserBulk,
  computeCopyPlan,
} = require("../src/services/permissionPlans");

/** Constrói o resultado de getEffectivePermissionsForUser sem base de dados. */
function person(id, role, roleMap, overrides = {}) {
  const ov = Object.entries(overrides).map(([key, allowed]) => {
    const [module, action] = key.split(":");
    return { module, action, allowed };
  });
  const effectiveMap = { ...roleMap, ...overrides };
  return { user: { id, role, name: id, email: `${id}@x.pt` }, roleMap, effectiveMap, overrides: ov };
}

const OPERADOR = { "obras:view": "true", "obras:create": "true", "obras:delete": "false", "stock:view": "view" };
const LEITURA = { "obras:view": "view", "obras:create": "false", "obras:delete": "false", "stock:view": "false" };

const asObj = (changes) => Object.fromEntries(changes.map((c) => [`${c.module}:${c.action}`, `${c.before}>${c.after}`]));

// ───────────── lote por perfil ─────────────
test("computeRoleBulk: só devolve o que realmente muda e deduplica", () => {
  const existing = new Map([["obras:view", "view"], ["obras:create", "false"]]);
  const r = computeRoleBulk({
    role: "operador",
    existing,
    items: [
      { module: "obras", action: "view", allowed: "view" }, // igual → não muda
      { module: "obras", action: "create", allowed: "own" },
      { module: "obras", action: "create", allowed: "true" }, // último ganha
      { module: "stock", action: "view", allowed: "true" }, // novo
    ],
  });
  assert.deepEqual(asObj(r.changes), { "obras:create": "false>true", "stock:view": "null>true" });
  assert.equal(r.unchanged, 1);
  assert.deepEqual(r.rejected, []);
});

test("computeRoleBulk: protege o acesso do admin ao sistema e às permissões", () => {
  const r = computeRoleBulk({
    role: "admin",
    existing: new Map(),
    items: [
      { module: "sistema", action: "view", allowed: "false" },
      { module: "sistema", action: "full_access", allowed: "false" },
      { module: "permissoes", action: "manage_permissions", allowed: "false" },
      { module: "obras", action: "view", allowed: "false" }, // permitido
    ],
  });
  assert.deepEqual(r.rejected.map((x) => x.error).sort(), [
    "CANNOT_REVOKE_ADMIN_PERMISSIONS",
    "CANNOT_REVOKE_ADMIN_SYSTEM_ACCESS",
    "CANNOT_REVOKE_ADMIN_SYSTEM_ACCESS",
  ]);
  assert.deepEqual(asObj(r.changes), { "obras:view": "null>false" });
});

test("computeRoleBulk: noutros perfis as mesmas chaves não são bloqueadas", () => {
  const r = computeRoleBulk({ role: "operador", existing: new Map(), items: [{ module: "sistema", action: "view", allowed: "false" }] });
  assert.equal(r.rejected.length, 0);
  assert.equal(r.changes.length, 1);
});

// ───────────── lote por utilizador ─────────────
test("computeUserBulk: 'inherit' remove a exceção e valores iguais não contam", () => {
  const overrides = new Map([["obras:view", "false"], ["obras:create", "true"]]);
  const r = computeUserBulk({
    overrides,
    items: [
      { module: "obras", action: "view", allowed: "inherit" },
      { module: "obras", action: "create", allowed: "true" }, // igual
      { module: "stock", action: "view", allowed: "own" },
      { module: "obras", action: "delete", allowed: "inherit" }, // já herdava
    ],
  });
  assert.deepEqual(asObj(r.changes), { "obras:view": "false>inherit", "stock:view": "inherit>own" });
  assert.equal(r.unchanged, 2);
});

// ───────────── cópia ─────────────
test("cópia 'overrides' + merge: junta as exceções do origem e mantém as do destino", () => {
  const source = person("src", "operador", OPERADOR, { "obras:delete": "true" });
  const target = person("dst", "operador", OPERADOR, { "stock:view": "false" });
  const plan = computeCopyPlan({ source, target, mode: "overrides", strategy: "merge" });
  assert.deepEqual(asObj(plan.changes), { "obras:delete": "inherit>true" });
  assert.equal(plan.roleChange, null);
});

test("cópia 'overrides' + replace: remove as exceções do destino que o origem não tem", () => {
  const source = person("src", "operador", OPERADOR, { "obras:delete": "true" });
  const target = person("dst", "operador", OPERADOR, { "stock:view": "false" });
  const plan = computeCopyPlan({ source, target, mode: "overrides", strategy: "replace" });
  assert.deepEqual(asObj(plan.changes), { "obras:delete": "inherit>true", "stock:view": "false>inherit" });
});

test("cópia 'effective': iguala as permissões finais com perfis diferentes", () => {
  const source = person("src", "operador", OPERADOR, { "obras:delete": "true" });
  const target = person("dst", "leitura", LEITURA);
  const plan = computeCopyPlan({ source, target, mode: "effective" });
  // o destino (leitura) passa a ter as permissões finais do origem como exceções
  assert.deepEqual(asObj(plan.changes), {
    "obras:view": "inherit>true",
    "obras:create": "inherit>true",
    "obras:delete": "inherit>true",
    "stock:view": "inherit>view",
  });
  assert.equal(plan.roleChange, null);
});

test("cópia 'effective': só grava exceção onde difere do perfil do destino", () => {
  const source = person("src", "operador", OPERADOR, { "obras:delete": "true" });
  const target = person("dst", "operador", OPERADOR);
  const plan = computeCopyPlan({ source, target, mode: "effective" });
  assert.deepEqual(asObj(plan.changes), { "obras:delete": "inherit>true" });
});

test("cópia 'effective': limpa exceções do destino que já coincidem com o perfil (herdar)", () => {
  const source = person("src", "operador", OPERADOR);
  const target = person("dst", "operador", OPERADOR, { "obras:delete": "false", "stock:view": "own" });
  const plan = computeCopyPlan({ source, target, mode: "effective" });
  // obras:delete=false é igual ao perfil → fica a herdar; stock:view=own difere do origem (view) → herdar também
  assert.deepEqual(asObj(plan.changes), { "obras:delete": "false>inherit", "stock:view": "own>inherit" });
});

test("cópia 'role_and_overrides': muda o perfil e substitui as exceções", () => {
  const source = person("src", "operador", OPERADOR, { "obras:delete": "true" });
  const target = person("dst", "leitura", LEITURA, { "stock:view": "own" });
  const plan = computeCopyPlan({ source, target, mode: "role_and_overrides" });
  assert.deepEqual(plan.roleChange, { from: "leitura", to: "operador" });
  assert.deepEqual(asObj(plan.changes), { "obras:delete": "inherit>true", "stock:view": "own>inherit" });
});

test("cópia 'role_and_overrides' não se aplica a clientes", () => {
  const source = person("src", "cliente", {});
  const target = person("dst", "operador", OPERADOR);
  assert.throws(() => computeCopyPlan({ source, target, mode: "role_and_overrides" }), { message: "ROLE_COPY_NOT_ALLOWED_FOR_CLIENT" });
  assert.throws(() => computeCopyPlan({ source: target, target: source, mode: "role_and_overrides" }), { message: "ROLE_COPY_NOT_ALLOWED_FOR_CLIENT" });
});

test("cópia: não permite copiar para si próprio nem com utilizadores inexistentes", () => {
  const a = person("a", "operador", OPERADOR);
  assert.throws(() => computeCopyPlan({ source: a, target: a }), { message: "SAME_USER" });
  assert.throws(() => computeCopyPlan({ source: null, target: a }), { message: "SOURCE_USER_NOT_FOUND" });
  assert.throws(() => computeCopyPlan({ source: a, target: null }), { message: "TARGET_USER_NOT_FOUND" });
});

test("cópia é idempotente: repetir depois de aplicada não gera alterações", () => {
  const source = person("src", "operador", OPERADOR, { "obras:delete": "true" });
  const target = person("dst", "leitura", LEITURA);
  const first = computeCopyPlan({ source, target, mode: "effective" });
  // aplica o plano ao destino
  const applied = { ...LEITURA };
  const overrides = {};
  first.changes.forEach((c) => { if (c.after !== "inherit") overrides[`${c.module}:${c.action}`] = c.after; });
  const after = person("dst", "leitura", applied, overrides);
  const second = computeCopyPlan({ source, target: after, mode: "effective" });
  assert.equal(second.changes.length, 0);
});
