const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/services/finance/cards");

test("T6: só uma alocação aberta por cartão", () => {
  const A = [
    { id: "1", cardId: "c", responsible: "Ana", startDate: "2026-01-01", endDate: "2026-03-01" },
    { id: "2", cardId: "c", responsible: "Rui", startDate: "2026-03-02", endDate: null },
  ];
  assert.equal(C.alocacaoAtual(A, "c").responsible, "Rui");
  assert.equal(C.podeAlocar(A, "c").ok, false);
  assert.equal(C.podeAlocar(A, "x").ok, true);
});

test("T7: transferido, gasto, por gastar, saldo e sobra livre por cartão", () => {
  const R = C.fundoManeio({
    cartoes: [{ id: "c", label: "FM Obra", bank: "BAI", lastDigits: "1234", type: "PREPAGO", fundId: "f", fund: { name: "Fundo", currency: "AOA", project: { code: "OBR", name: "Sumbe" } }, saldo: 700 }],
    movFundo: [
      { fundId: "f", cardId: "c", type: "CREDITO", amount: 1000, createdAt: "2026-10-01" },
      { fundId: "f", cardId: "c", type: "DEBITO", amount: 200, createdAt: "2026-10-05" },
    ],
    movBanco: [
      { cardId: "c", direction: "SAIDA", amount: 100, movementDate: "2026-10-09", movementType: "OUTRO" },
      { cardId: "c", direction: "SAIDA", amount: 999, movementDate: "2026-10-09", movementType: "OPERACAO_ANULADA" },
    ],
    pedidos: [
      { fundId: "f", cardId: null, status: "APROVADO", amount: 150 },
      { fundId: "f", cardId: "c", status: "PAGO", amount: 50 },
      { fundId: "x", status: "APROVADO", amount: 9 },
    ],
    alocacoes: [{ cardId: "c", responsible: "Ana", startDate: "2026-09-01", endDate: null }],
  });
  assert.deepEqual(
    { t: R[0].transferido, g: R[0].gasto, p: R[0].porGastar, s: R[0].saldo, l: R[0].sobra, u: R[0].ultimo, r: R[0].responsavel, o: R[0].obra },
    { t: 1000, g: 300, p: 150, s: 700, l: 550, u: "2026-10-09", r: "Ana", o: "OBR · Sumbe" }
  );
});
