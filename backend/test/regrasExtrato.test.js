const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const BR = require("../src/services/finance/bankRules");

const core = () => import(pathToFileURL(path.join(__dirname, "../../frontend/src/shared/finance/extratoImportCore.js")).href);

test("regras de base: só as do protótipo com tipo na app", () => {
  assert.ok(BR.REGRAS_BASE.length >= 10);
  for (const r of BR.REGRAS_BASE) assert.ok(BR.TIPOS.includes(r.tipo), r.texto);
  assert.equal(BR.regraPara("TRF INT BFA 01", true, BR.REGRAS_BASE).tipo, "TRANSFERENCIA_INTERNA");
  assert.equal(BR.regraPara("MCX-LEV 123", true, BR.REGRAS_BASE).tipo, "LEVANTAMENTO_ATM");
  assert.equal(BR.regraPara("SPTR DE CLIENTE", false, BR.REGRAS_BASE).tipo, "RECEBIMENTO_CLIENTE");
});

test("o sinal da regra: só saídas, só entradas ou qualquer", () => {
  const R = [
    { texto: "subcont", sinal: "-", tipo: "PF" },
    { texto: "sptr de", sinal: "+", tipo: "RECEBIMENTO_CLIENTE" },
  ];
  assert.equal(BR.regraPara("SUBCONT obra", true, R).tipo, "PF");
  assert.equal(BR.regraPara("SUBCONT obra", false, R), null, "regra de saída não casa numa entrada");
  assert.equal(BR.regraPara("SPTR DE x", true, R), null, "regra de entrada não casa numa saída");
  // Um recebimento de cliente nunca é uma saída, mesmo com sinal «qualquer».
  assert.equal(BR.regraPara("receb", true, [{ texto: "receb", sinal: "", tipo: "RECEBIMENTO_CLIENTE" }]), null);
});

test("a primeira que corresponde ganha; ecrã e servidor leem igual", async () => {
  const { regraPara } = await core();
  const R = [
    { texto: "TRF INT", sinal: "", tipo: "TRANSFERENCIA_INTERNA" },
    { texto: "TRF", sinal: "", tipo: "PF" },
  ];
  for (const [d, s] of [["TRF INT x", true], ["TRF HB", true], ["Comissão", true], ["SUBCONT", false]]) {
    assert.deepEqual(regraPara(d, s, R), BR.regraPara(d, s, R), d);
  }
  assert.equal(regraPara("TRF INT x", true, R).tipo, "TRANSFERENCIA_INTERNA");
  assert.equal(regraPara("TRF HB", true, R).tipo, "PF");
});
