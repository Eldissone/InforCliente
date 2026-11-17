const test = require("node:test");
const assert = require("node:assert");
const { buildPreview } = require("../src/services/chatNotificationService");

test("buildPreview troca menções por @Nome e encurta", () => {
  assert.strictEqual(buildPreview("Olá @[Ana Silva](u1), tudo bem?"), "Olá @Ana Silva, tudo bem?");
  const long = "x".repeat(300);
  const out = buildPreview(long);
  assert.strictEqual(out.length, 140);
  assert.ok(out.endsWith("…"));
});

test("buildPreview de mensagem só com anexo", () => {
  assert.strictEqual(buildPreview("", [{ id: "a" }]), "📎 Anexo");
  assert.strictEqual(buildPreview("   ", []), null);
});
