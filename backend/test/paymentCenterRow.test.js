const test = require("node:test");
const assert = require("node:assert/strict");

const { purchasePayable, purchaseRequestFields } = require("../src/services/financeLedgerService");

/**
 * A linha do pedido de pagamento como chega ao **Centro de Pagamentos**.
 *
 * ⚠️ Fecha dois defeitos:
 *  1. o valor a pagar era `totalValue` (a soma de quantidade × preço das
 *     linhas), não o total fiscal — num pedido com IVA e retenção mandava-se
 *     pagar o ilíquido, e os tipos sem itens (impostos, pessoal, empréstimo),
 *     que não têm `totalValue`, valiam **zero** e desapareciam da fila;
 *  2. sem plano de prestações a data de vencimento era `null`, mesmo quando o
 *     pedido traz a sua própria data.
 */

const pedido = (over = {}) => ({
  id: "o1",
  status: "APROVADO",
  requestType: "SEDE",
  paymentMode: "FORN",
  paymentTerm: "PRONTO",
  totalValue: 1000000,
  typeData: {},
  items: [],
  ...over,
});

const linhasFiscais = [
  { name: "Resmas", quantity: 100, unitPrice: 8000, vatPercent: 14, withholdingPercent: 6.5, discountPercent: 5 },
  { name: "Toner", quantity: 2, unitPrice: 100000, vatPercent: 14, withholdingPercent: 6.5, discountPercent: 5 },
];

test("o valor a pagar é o total fiscal, não o ilíquido das linhas", () => {
  // 1 000 000 − 5% = 950 000 · IVA 133 000 · retido 61 750 → 1 021 250
  const { payable } = purchasePayable(pedido({ items: linhasFiscais }));
  assert.equal(payable, 1021250);
});

test("os tipos sem itens tiram o valor dos seus próprios dados", () => {
  assert.equal(
    purchasePayable(pedido({ requestType: "IMPOSTOS", totalValue: null, typeData: { tipo: "IVA", valor: 4500000 } })).payable,
    4500000
  );
  assert.equal(
    purchasePayable(
      pedido({
        requestType: "PESSOAL",
        totalValue: null,
        typeData: { sub: "Salários", linhas: [{ nome: "Ana", valor: 300000 }, { nome: "Bento", valor: 250000 }] },
      })
    ).payable,
    550000
  );
  assert.equal(
    purchasePayable(pedido({ requestType: "EMPRESTIMO", totalValue: null, typeData: { por: "Carlos", valor: 150000 } })).payable,
    150000
  );
});

test("sem plano de prestações vale a data do próprio pedido", () => {
  const due = new Date("2026-12-20T00:00:00Z");
  assert.equal(purchasePayable(pedido({ dueDate: due })).dueDate, due);
  assert.equal(purchasePayable(pedido()).dueDate, null);
});

test("com plano, conta o que falta liquidar e o próximo vencimento", () => {
  const order = pedido({
    items: linhasFiscais,
    dueDate: new Date("2026-12-20T00:00:00Z"),
    paymentPlan: {
      installments: [
        { status: "PAGO", amount: 500000, dueDate: "2026-11-01" },
        { status: "PENDENTE", amount: 300000, dueDate: "2026-12-01" },
        { status: "PENDENTE", amount: 221250, dueDate: "2027-01-01" },
      ],
    },
  });
  const { payable, dueDate } = purchasePayable(order);
  assert.equal(payable, 521250);
  assert.equal(new Date(dueDate).toISOString().slice(0, 10), "2026-12-01");
});

test("plano todo liquidado: nada a pagar, e a fila deixa-o cair", () => {
  const order = pedido({
    items: linhasFiscais,
    paymentPlan: { installments: [{ status: "PAGO", amount: 1021250, dueDate: "2026-11-01" }] },
  });
  assert.equal(purchasePayable(order).payable, 0);
});

test("a linha leva o tipo, o modo, a condição e quem recebe", () => {
  const impostos = purchaseRequestFields(
    pedido({
      requestType: "IMPOSTOS",
      paymentTerm: "PRONTO",
      totalValue: null,
      typeData: { tipo: "IVA", mes: "2026-10", valor: 4500000 },
    })
  );
  assert.equal(impostos.requestType, "IMPOSTOS");
  assert.match(impostos.beneficiary, /AGT/);
  assert.equal(impostos.shortDescription, "IVA · 2026-10");

  const fundo = purchaseRequestFields(
    pedido({ paymentMode: "FM", pettyCashFund: { name: "CARTÃO 1" }, supplierName: "Loja" })
  );
  assert.equal(fundo.paymentMode, "FM");
  assert.equal(fundo.fundName, "CARTÃO 1");
  assert.match(fundo.beneficiary, /fundo de maneio/);

  const credito = purchaseRequestFields(pedido({ paymentTerm: "CREDITO", creditDays: 45 }));
  assert.equal(credito.paymentTerm, "CREDITO");
  assert.equal(credito.creditDays, 45);
});

test("o estado derivado vai na linha, para o ecrã não dizer só «Aprovado»", () => {
  const pausado = purchaseRequestFields(pedido({ onHold: true }));
  assert.equal(pausado.derivedStatus, "EM_PAUSA");
  assert.equal(pausado.derivedStatusLabel, "Em pausa");
  assert.equal(pausado.derivedStatusSeverity, "warn");

  const atrasado = purchaseRequestFields(pedido({ items: linhasFiscais, dueDate: new Date("2020-01-01") }));
  assert.equal(atrasado.derivedStatus, "ATRASADO");
  assert.equal(atrasado.derivedStatusSeverity, "bad");
});
