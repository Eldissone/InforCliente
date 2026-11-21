const test = require("node:test");
const assert = require("node:assert/strict");

const PT = require("../src/services/purchase/purchaseTotals");

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const close = (actual, expected, label, tol = 0.01) =>
  assert.ok(near(actual, expected, tol), `${label}: esperado ${expected}, obtido ${actual}`);

const order = (over = {}) => ({ requestType: "SEDE", items: [], typeData: {}, ...over });

// ═══════════════ o defeito que esta fase corrige ═══════════════

test("a retenção na fonte é descontada do que o fornecedor recebe", () => {
  // 10 × 100 000, desconto 5%, IVA 14%, retenção 6,5%
  const t = PT.orderTotals(
    order({ items: [{ quantity: 10, unitPrice: 100000, discountPercent: 5, vatPercent: 14, withholdingPercent: 6.5 }] })
  );
  close(t.base, 950000, "base = 1 000 000 × (1 − 5%)");
  close(t.vat, 133000, "IVA = 950 000 × 14%");
  close(t.withheld, 61750, "retenção = 950 000 × 6,5%");
  close(t.total, 1021250, "a pagar = base + IVA − retenção");
  // O defeito antigo dava 1 083 000: base + IVA, sem descontar a retenção
  assert.ok(t.total < 1083000, "não pode mandar pagar a retenção ao fornecedor");
  close(1083000 - t.total, 61750, "o que se pagava a mais era exactamente a retenção");
});

test("a retenção não desaparece: fica separada, para o Estado", () => {
  const t = PT.orderTotals(order({ items: [{ quantity: 1, unitPrice: 1000, vatPercent: 14, withholdingPercent: 6.5 }] }));
  close(t.withheld, 65, "retenção");
  close(t.base + t.vat, t.total + t.withheld, "o que se fatura = o que se paga + o que se retém");
});

test("linhas antigas, com a fiscalidade escrita no texto, dão o mesmo resultado", () => {
  const comColunas = PT.orderTotals(
    order({ items: [{ quantity: 10, unitPrice: 100000, discountPercent: 5, vatPercent: 14, withholdingPercent: 6.5 }] })
  );
  const comTexto = PT.orderTotals(
    order({ items: [{ quantity: 10, unitPrice: 100000, notes: "IVA 14% · Ret. 6,5% · Desc. 5%" }] })
  );
  assert.deepEqual(
    { base: comTexto.base, vat: comTexto.vat, withheld: comTexto.withheld, total: comTexto.total },
    { base: comColunas.base, vat: comColunas.vat, withheld: comColunas.withheld, total: comColunas.total }
  );
});

test("as colunas têm prioridade sobre o texto das notas", () => {
  // O texto diz 14%, a coluna diz 7%: vale a coluna
  const t = PT.orderTotals(order({ items: [{ quantity: 1, unitPrice: 1000, vatPercent: 7, notes: "IVA 14%" }] }));
  close(t.vat, 70, "IVA pela coluna");
});

test("uma coluna a zero conta como zero, não cai no texto", () => {
  const t = PT.orderTotals(order({ items: [{ quantity: 1, unitPrice: 1000, vatPercent: 0, notes: "IVA 14%" }] }));
  close(t.vat, 0, "IVA zero é uma decisão, não uma ausência");
});

test("o texto aceita vírgula e ponto como separador decimal", () => {
  close(PT.parseRatesFromNotes("Ret. 6,5%").withholding, 6.5, "vírgula");
  close(PT.parseRatesFromNotes("Ret. 6.5%").withholding, 6.5, "ponto");
  close(PT.parseRatesFromNotes("IVA 14 %").vat, 14, "espaço antes do %");
  assert.deepEqual(PT.parseRatesFromNotes(null), { vat: 0, withholding: 0, discount: 0 });
  assert.deepEqual(PT.parseRatesFromNotes("nota qualquer"), { vat: 0, withholding: 0, discount: 0 });
});

// ═══════════════ linhas e totais ═══════════════

test("linha sem preço unitário usa o total escrito", () => {
  const l = PT.lineTotals({ quantity: 0, totalPrice: 50000, vatPercent: 14 });
  close(l.base, 50000, "base");
  close(l.total, 57000, "base + IVA");
});

test("linha sem fiscalidade: o total é a base", () => {
  const l = PT.lineTotals({ quantity: 3, unitPrice: 1000 });
  close(l.base, 3000, "base");
  close(l.total, 3000, "total");
  close(l.vat, 0, "IVA");
  close(l.withheld, 0, "retenção");
});

test("várias linhas somam-se por campo", () => {
  const t = PT.orderTotals(
    order({
      items: [
        { quantity: 1, unitPrice: 1000, vatPercent: 14 },
        { quantity: 2, unitPrice: 500, vatPercent: 14, withholdingPercent: 6.5 },
        { quantity: 1, unitPrice: 2000, discountPercent: 10 },
      ],
    })
  );
  close(t.base, 1000 + 1000 + 1800, "base");
  close(t.vat, 140 + 140, "IVA");
  close(t.withheld, 65, "retenção");
  close(t.total, 1140 + 1075 + 1800, "total");
});

test("sem linhas, usa o valor cotado; sem cotação, o valor do pedido", () => {
  const comCotacao = PT.orderTotals(order({ requisition: { quotedValue: 80000 }, totalValue: 50000 }));
  close(comCotacao.total, 80000, "a cotação manda");
  assert.equal(comCotacao.source, "cotacao");

  const semCotacao = PT.orderTotals(order({ totalValue: 50000 }));
  close(semCotacao.total, 50000, "valor do pedido");
  assert.equal(semCotacao.source, "pedido");
});

// ═══════════════ tipos sem itens ═══════════════

test("impostos: o valor vem dos dados do tipo, sem IVA nem retenção", () => {
  const t = PT.orderTotals(order({ requestType: "IMPOSTOS", typeData: { tipo: "IVA", mes: "2026-01", valor: 450000 } }));
  close(t.total, 450000, "total");
  close(t.vat, 0, "imposto não leva IVA");
  assert.equal(t.source, "impostos");
});

test("pessoal: soma as linhas dos colaboradores", () => {
  const t = PT.orderTotals(
    order({
      requestType: "PESSOAL",
      typeData: { sub: "SALÁRIO", mes: "2026-01", linhas: [{ nome: "A", valor: 300000 }, { nome: "B", valor: 250000 }] },
    })
  );
  close(t.total, 550000, "total");
  assert.equal(t.source, "pessoal");
});

test("empréstimo: o valor do empréstimo", () => {
  const t = PT.orderTotals(order({ requestType: "EMPRESTIMO", typeData: { por: "João", valor: 200000 } }));
  close(t.total, 200000, "total");
});

test("os tipos sem itens ignoram as linhas que lá estejam", () => {
  const t = PT.orderTotals(
    order({ requestType: "IMPOSTOS", typeData: { valor: 100 }, items: [{ quantity: 99, unitPrice: 99999 }] })
  );
  close(t.total, 100, "manda o valor do tipo");
});

test("hasItems distingue os tipos", () => {
  for (const k of ["SEDE", "OBRA", "FROTA"]) assert.equal(PT.hasItems(k), true, k);
  for (const k of ["IMPOSTOS", "PESSOAL", "EMPRESTIMO"]) assert.equal(PT.hasItems(k), false, k);
});

// ═══════════════ estado derivado ═══════════════

const withPlan = (installments, over = {}) =>
  order({ status: "APROVADO", items: [{ quantity: 1, unitPrice: 1000 }], paymentPlan: { installments }, ...over });

test("estado derivado: por aprovar, em cotação, em aberto", () => {
  assert.equal(PT.derivedStatus(order({ status: "PENDENTE_APROVACAO" })).code, "POR_APROVAR");
  assert.equal(PT.derivedStatus(order({ status: "PENDENTE_REQUISICAO" })).code, "EM_COTACAO");
  assert.equal(PT.derivedStatus(order({ status: "RASCUNHO" })).code, "RASCUNHO");
  assert.equal(PT.derivedStatus(withPlan([])).code, "EM_ABERTO");
});

test("estado derivado: pago e pago parcial saem dos pagamentos, não de um campo", () => {
  assert.equal(PT.derivedStatus(withPlan([{ status: "PAGO", amount: 1000 }])).code, "PAGO");
  assert.equal(PT.derivedStatus(withPlan([{ status: "PAGO", amount: 400 }])).code, "PAGO_PARCIAL");
  assert.equal(PT.derivedStatus(withPlan([{ status: "PENDENTE", amount: 1000 }])).code, "EM_ABERTO");
});

test("estado derivado: pago com diferença de cêntimos conta como pago", () => {
  assert.equal(PT.derivedStatus(withPlan([{ status: "PAGO", amount: 999.6 }])).code, "PAGO");
});

test("estado derivado: atrasado quando o vencimento já passou", () => {
  const hoje = new Date("2026-03-01T00:00:00Z");
  const atrasado = withPlan([{ status: "PENDENTE", amount: 1000, dueDate: "2026-02-01" }]);
  assert.equal(PT.derivedStatus(atrasado, hoje).code, "ATRASADO");
  const porVencer = withPlan([{ status: "PENDENTE", amount: 1000, dueDate: "2026-04-01" }]);
  assert.equal(PT.derivedStatus(porVencer, hoje).code, "EM_ABERTO");
});

test("estado derivado: vencer hoje não é estar atrasado", () => {
  // A data guardada é meia-noite; comparada com o instante atual, qualquer hora
  // do dia dava o pedido como atrasado. No ecrã isso punha «Atrasado» em
  // vermelho ao lado de «vence hoje» na mesma linha.
  const hoje = new Date(2026, 2, 1, 15, 30);
  const venceHoje = withPlan([{ status: "PENDENTE", amount: 1000, dueDate: new Date(2026, 2, 1) }]);
  assert.equal(PT.derivedStatus(venceHoje, hoje).code, "EM_ABERTO");
  const venceuOntem = withPlan([{ status: "PENDENTE", amount: 1000, dueDate: new Date(2026, 1, 28) }]);
  assert.equal(PT.derivedStatus(venceuOntem, hoje).code, "ATRASADO");
});

test("estado derivado: o atraso ganha ao pagamento parcial", () => {
  // Uma prestação paga e a seguinte vencida: o que interessa a quem paga é que
  // está atrasado, não que já se pagou parte.
  const o = withPlan([
    { status: "PAGO", amount: 400, dueDate: "2026-01-01" },
    { status: "PENDENTE", amount: 600, dueDate: "2026-02-01" },
  ]);
  assert.equal(PT.derivedStatus(o, new Date("2026-03-01T00:00:00Z")).code, "ATRASADO");
  // Sem nada vencido, aí sim é pagamento parcial
  assert.equal(PT.derivedStatus(o, new Date("2026-01-15T00:00:00Z")).code, "PAGO_PARCIAL");
});

test("estado derivado: a pausa e a eliminação ganham a tudo", () => {
  assert.equal(PT.derivedStatus(withPlan([{ status: "PAGO", amount: 1000 }], { onHold: true })).code, "EM_PAUSA");
  assert.equal(PT.derivedStatus(withPlan([], { deletedAt: new Date() })).code, "ELIMINADO");
  assert.equal(PT.derivedStatus(order({ status: "NAO_APROVADO" })).code, "REJEITADO");
  assert.equal(PT.derivedStatus(order({ status: "CANCELADO" })).code, "CANCELADO");
});

test("estado derivado: cada estado tem gravidade, para a cor do ecrã", () => {
  for (const o of [
    order({ status: "RASCUNHO" }),
    order({ status: "PENDENTE_APROVACAO" }),
    withPlan([{ status: "PAGO", amount: 1000 }]),
    withPlan([{ status: "PENDENTE", amount: 1000, dueDate: "2020-01-01" }]),
  ]) {
    const s = PT.derivedStatus(o);
    assert.ok(["good", "warn", "bad", "neutral"].includes(s.severity), `${s.code} sem gravidade`);
    assert.ok(s.label && s.label.length > 0, `${s.code} sem etiqueta`);
  }
});

// ═══════════════ documentos ═══════════════

const docOrder = (over = {}) =>
  order({ status: "APROVADO", requiresQuote: true, items: [{ quantity: 1, unitPrice: 100 }], ...over });

test("documentos: a proforma só se exige quando houve cotação", () => {
  const comCot = PT.documentStatus(docOrder());
  assert.ok(comCot.docs.find((d) => d.kind === "proforma").required);
  const semCot = PT.documentStatus(docOrder({ requiresQuote: false }));
  assert.equal(semCot.docs.find((d) => d.kind === "proforma").required, false);
});

test("documentos: o fundo de maneio não precisa de proforma", () => {
  const d = PT.documentStatus(docOrder({ paymentMode: "FM" }));
  assert.equal(d.docs.find((x) => x.kind === "proforma").required, false);
});

test("documentos: a fatura dispensa-se quando todas as linhas são DSC ou AF", () => {
  const todasDsc = PT.documentStatus(
    docOrder({ items: [{ quantity: 1, unitPrice: 100, docException: "DSC" }, { quantity: 1, unitPrice: 50, docException: "AF" }] })
  );
  assert.equal(todasDsc.docs.find((d) => d.kind === "fatura").required, false);
  assert.equal(todasDsc.exceptions.all, true);
  assert.equal(todasDsc.exceptions.dsc, 1);
  assert.equal(todasDsc.exceptions.af, 1);

  const soUma = PT.documentStatus(
    docOrder({ items: [{ quantity: 1, unitPrice: 100, docException: "DSC" }, { quantity: 1, unitPrice: 50 }] })
  );
  assert.equal(soUma.docs.find((d) => d.kind === "fatura").required, true, "basta uma linha normal para a fatura ser exigida");
  assert.equal(soUma.exceptions.all, false);
});

test("documentos: o comprovativo exige-se depois de haver pagamento", () => {
  const semPagamento = PT.documentStatus(docOrder());
  assert.equal(semPagamento.docs.find((d) => d.kind === "comprovativo").required, false);
  const pago = PT.documentStatus(docOrder({ paymentPlan: { installments: [{ status: "PAGO", amount: 100 }] } }));
  assert.equal(pago.docs.find((d) => d.kind === "comprovativo").required, true);
});

test("documentos: reconhece os anexos pelo nome do ficheiro", () => {
  const d = PT.documentStatus(
    docOrder({ requisition: { attachments: [{ fileName: "proforma-123.pdf" }, { fileName: "Fatura FT2026.pdf" }] } })
  );
  assert.equal(d.docs.find((x) => x.kind === "proforma").present, true);
  assert.equal(d.docs.find((x) => x.kind === "fatura").present, true);
  assert.deepEqual(d.missing, [], "nada em falta");
});

test("documentos: diz o que falta", () => {
  const d = PT.documentStatus(docOrder());
  assert.deepEqual(d.missing.sort(), ["fatura", "proforma"]);
});

// ═══════════════ beneficiário e descrição ═══════════════

test("beneficiário: fornecedor, fundo de maneio, AGT, colaboradores", () => {
  assert.equal(PT.beneficiary(order({ supplierName: "Sonangol" })), "Sonangol");
  assert.match(PT.beneficiary(order({ supplierName: "Sonangol", paymentMode: "FM" })), /fundo de maneio/);
  assert.match(PT.beneficiary(order({ paymentMode: "FM" })), /^Fundo de maneio$/);
  assert.match(PT.beneficiary(order({ requestType: "IMPOSTOS" })), /AGT/);
  assert.equal(
    PT.beneficiary(order({ requestType: "PESSOAL", typeData: { linhas: [{ nome: "Ana" }] } })),
    "Ana"
  );
  assert.equal(
    PT.beneficiary(order({ requestType: "PESSOAL", typeData: { linhas: [{ nome: "Ana" }, { nome: "Beto" }] } })),
    "2 colaborador(es)"
  );
  assert.equal(PT.beneficiary(order({ requestType: "EMPRESTIMO", typeData: { por: "João" } })), "João");
});

test("descrição curta: o primeiro item e quantos mais", () => {
  assert.equal(
    PT.shortDescription(order({ items: [{ name: "Cabo" }, { name: "Poste" }, { name: "Terra" }] })),
    "Cabo (+2 itens)"
  );
  assert.equal(PT.shortDescription(order({ items: [{ name: "Cabo" }] })), "Cabo");
  assert.equal(PT.shortDescription(order({ description: "Pedido geral" })), "Pedido geral");
  assert.match(PT.shortDescription(order({ requestType: "IMPOSTOS", typeData: { tipo: "IVA", mes: "2026-01" } })), /IVA · 2026-01/);
});

// ═══════════════ prestações ═══════════════

test("prestações iguais: somam o total, o resto fica na última", () => {
  const p = PT.splitInstallments(1000, 3, "2026-01-31");
  assert.equal(p.length, 3);
  close(
    p.reduce((s, x) => s + x.amount, 0),
    1000,
    "a soma fecha no total"
  );
  close(p[0].amount, 333.33, "primeira");
  close(p[2].amount, 333.34, "a última leva o resto");
  assert.deepEqual(p.map((x) => x.dueDate), ["2026-01-31", "2026-03-02", "2026-04-01"]);
});

test("prestações: o passo entre vencimentos é configurável", () => {
  const p = PT.splitInstallments(600, 3, "2026-01-01", 15);
  assert.deepEqual(p.map((x) => x.dueDate), ["2026-01-01", "2026-01-16", "2026-01-31"]);
});

test("prestações: limites de 1 a 24", () => {
  assert.equal(PT.splitInstallments(100, 0).length, 1);
  assert.equal(PT.splitInstallments(100, 99).length, 24);
});

// ═══════════════ decoração completa ═══════════════

test("decorateOrder junta totais, estado, documentos e beneficiário", () => {
  const o = order({
    status: "APROVADO",
    supplierName: "Fornecedor X",
    requiresQuote: true,
    items: [{ name: "Cabo", quantity: 10, unitPrice: 100000, vatPercent: 14, withholdingPercent: 6.5, discountPercent: 5 }],
    paymentPlan: { installments: [{ status: "PAGO", amount: 500000, dueDate: "2026-01-01" }] },
  });
  const d = PT.decorateOrder(o, new Date("2026-02-01T00:00:00Z"));
  close(d.totals.total, 1021250, "total a pagar");
  close(d.paid, 500000, "pago");
  close(d.outstanding, 521250, "em dívida");
  assert.equal(d.status, "PAGO_PARCIAL");
  assert.equal(d.beneficiary, "Fornecedor X");
  assert.equal(d.shortDescription, "Cabo");
  assert.ok(d.documents.missing.length > 0, "faltam documentos");
});

test("decorateOrder: pedido vazio não rebenta", () => {
  const d = PT.decorateOrder({});
  close(d.totals.total, 0, "total");
  close(d.paid, 0, "pago");
  assert.ok(d.status);
});

// ─── A linha como vai para a base de dados ─────────────────────────────────
//
// Esta função existe porque o mapeamento estava escrito duas vezes, uma por
// rota, e as cópias divergiram: a de editar não copiava as percentagens nem a
// excepção documental. Editar um pedido apagava o IVA e a retenção de todas as
// linhas e o total voltava a ser quantidade × preço.

test("a linha leva a fiscalidade para a base de dados", () => {
  const r = PT.itemRowForDb(
    {
      name: "Cimento",
      quantity: 100,
      unit: "sc",
      unitPrice: 10000,
      notes: "entrega no estaleiro",
      vatPercent: 14,
      withholdingPercent: 6.5,
      discountPercent: 5,
      docException: "DSC",
    },
    3
  );
  assert.equal(r.vatPercent, 14);
  assert.equal(r.withholdingPercent, 6.5);
  assert.equal(r.discountPercent, 5);
  assert.equal(r.docException, "DSC");
  assert.equal(r.notes, "entrega no estaleiro");
  assert.equal(r.order, 3, "a ordem é a da lista");
});

test("o total da linha é quantidade × preço, e nulo sem preço", () => {
  assert.equal(PT.itemRowForDb({ name: "x", quantity: 100, unitPrice: 10000 }).totalPrice, 1000000);
  assert.equal(PT.itemRowForDb({ name: "x", quantity: 100 }).totalPrice, null, "sem preço não se inventa total");
  assert.equal(PT.itemRowForDb({ name: "x", quantity: 100, unitPrice: 0 }).totalPrice, null, "preço zero é como não ter preço");
});

test("uma percentagem a zero não é o mesmo que não ter percentagem", () => {
  // Zero é uma escolha: «esta linha não tem IVA». Null é «não foi preenchido»,
  // e é o null que manda o cálculo recuperar as percentagens do texto antigo.
  assert.equal(PT.itemRowForDb({ name: "x", quantity: 1, vatPercent: 0 }).vatPercent, 0);
  assert.equal(PT.itemRowForDb({ name: "x", quantity: 1 }).vatPercent, null);
});

test("os campos vazios ficam nulos, não a cadeia vazia", () => {
  const r = PT.itemRowForDb({ name: "x", quantity: 1, unit: "", notes: "", docException: "" });
  assert.equal(r.unit, null);
  assert.equal(r.notes, null);
  assert.equal(r.docException, null);
});

test("a linha que sai daqui é lida de volta pelo mesmo cálculo", () => {
  // O que se grava e o que se soma têm de concordar: a conta da base de
  // referência é base = qtd × preço × (1 − desc), total = base + IVA − retenção.
  const row = PT.itemRowForDb({ name: "x", quantity: 100, unitPrice: 10000, vatPercent: 14, withholdingPercent: 6.5, discountPercent: 5 });
  const t = PT.lineTotals(row);
  assert.equal(t.base, 950000);
  assert.equal(t.vat, 133000);
  assert.equal(t.withheld, 61750);
  assert.equal(t.total, 1021250);
});
