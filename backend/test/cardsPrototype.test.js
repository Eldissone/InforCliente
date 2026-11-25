const test = require("node:test");
const assert = require("node:assert/strict");
const CARDS = require("../src/services/finance/cards");
const TES = require("../src/services/finance/treasury");

test("T5 Contas Bancárias / Cartões: bancos de Angola, siglas e deteção pelo IBAN", () => {
  assert.equal(CARDS.BANCOS_REG.length, 18);
  assert.equal(CARDS.bancoSig("BCGA"), "BCGA");
  assert.equal(CARDS.bancoSig("Banco Caixa Geral Angola"), "BCGA");
  assert.equal(CARDS.bancoSig("BFA — Banco de Fomento Angola"), "BFA");
  assert.equal(CARDS.bancoNome("BAI"), "Banco Angolano de Investimentos");
  assert.equal(CARDS.bancoLbl("BCGA"), "BCGA — Banco Caixa Geral Angola");
  assert.equal(CARDS.detectBankFromIban("AO06 0004 0000 0981 3648 1018 4"), "BCGA");
  assert.equal(CARDS.detectBankFromIban("AO06000600000100037131174"), "BFA");
  assert.equal(CARDS.detectBankFromIban("AO06004000001234567890123"), "BAI");
  assert.equal(CARDS.detectBankFromIban("PT50000400001234567890123"), null);
});

test("T5 Contas Bancárias / Cartões: serialização e leitura de metadados da conta/cartão", () => {
  const raw = CARDS.serializeCardMeta({
    accountNumber: "0981364 810 184",
    iban: "AO06 0004 0000 0981 3648 1018 4",
    initialBalanceDate: "2026-01-01",
    paymentCardId: "c1",
    closingDay: 25,
    paymentDay: 10,
    validade: "2028-03",
    notes: "Cartão executivo",
  });

  const meta = CARDS.parseCardMeta({}, { notes: raw });
  assert.equal(meta.accountNumber, "0981364810184");
  assert.equal(meta.iban, "AO06000400000981364810184");
  assert.equal(meta.initialBalanceDate, "2026-01-01");
  assert.equal(meta.paymentCardId, "c1");
  assert.equal(meta.closingDay, 25);
  assert.equal(meta.paymentDay, 10);
  assert.equal(meta.validade, "2028-03");
  assert.equal(meta.notes, "Cartão executivo");
});

test("T5 Contas Bancárias / Cartões: saldoCaixa e T1 Contas e Saldos não abatem dívida de cartão de crédito ao saldo disponível", () => {
  assert.equal(CARDS.saldoCaixa("DEBITO", 1000000), 1000000);
  assert.equal(CARDS.saldoCaixa("PREPAGO", 250000), 250000);
  assert.equal(CARDS.saldoCaixa("CREDITO", -350000), 0);
  assert.equal(CARDS.saldoCaixa("CREDITO", 50000), 50000);

  const resumo = TES.treasurySummary({
    contas: [
      { card: { id: "c1", label: "BCGA C1", bank: "BCGA", type: "DEBITO" }, balance: 1000000, currency: "AOA", source: "EXTRATO" },
      { card: { id: "c9", label: "BCGA CC 1", bank: "BCGA", type: "CREDITO" }, balance: -350000, currency: "AOA", source: "EXTRATO" },
    ],
    movimentos: [],
    mes: "2026-03",
    moeda: "AOA",
  });

  assert.equal(resumo.saldo, 1000000);
  assert.equal(resumo.divida, 350000);
});

test("T5 / T6: estragadoDe identifica cartão devolvido estragado quando não há alocação posterior", () => {
  const alocacoes = [
    { id: "a1", cardId: "c1", responsible: "Eng. Pedro", startDate: "2026-01-10", endDate: "2026-02-15", returnState: "ESTRAGADO", returnNotes: "Chip partido" },
  ];
  const est = CARDS.estragadoDe(alocacoes, "c1");
  assert.deepEqual(est, { id: "a1", by: "Eng. Pedro", date: "2026-02-15", notes: "Chip partido" });

  // Se houver nova alocação posterior, deixa de mostrar o aviso de devolvido estragado
  alocacoes.push({ id: "a2", cardId: "c1", responsible: "Eng. Sofia", startDate: "2026-02-20", endDate: null });
  assert.equal(CARDS.estragadoDe(alocacoes, "c1"), null);
});
