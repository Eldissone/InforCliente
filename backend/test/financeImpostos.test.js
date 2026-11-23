const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/services/finance/taxes");

const hoje = "2026-11-23";

test("limiteAuto: IVA dia 15 e INSS dia 10 do mês seguinte; os outros no último dia", () => {
  assert.equal(T.limiteAuto("IVA", "2026-10"), "2026-11-15");
  assert.equal(T.limiteAuto("INSS", "2026-10"), "2026-11-10");
  assert.equal(T.limiteAuto("RF", "2026-01"), "2026-02-28");
  assert.equal(T.limiteAuto("IVA", "x"), null);
});

const ob = (o) => ({ id: "o1", type: "IVA", referenceMonth: "2026-10", dueDate: "2026-11-15", amount: 100, ...o });

test("estados: pago à mão, pedido pago, em pagamento, atrasado, por pagar", () => {
  const L = T.linhasImpostos({
    hoje,
    obrigacoes: [
      ob({ id: "a", paidAt: "2026-11-10" }),
      ob({ id: "b" }),
      ob({ id: "c", dueDate: "2026-12-15" }),
      ob({ id: "d", dueDate: "2026-12-15" }),
      ob({ id: "e", planId: "p", plan: { name: "PPP I" }, installment: 1, type: "PPP", dueDate: "2026-12-01" }),
    ],
    pedidos: [
      { id: "x", number: "PC-1", estado: "PAGO", typeData: { obrigacaoId: "c" } },
      { id: "y", number: "PC-2", estado: "EM_PAGAMENTO", typeData: { obrigacaoId: "d" } },
      { id: "z", number: "PC-3", estado: "EM_ABERTO", typeData: { tipo: "IRT", mes: "2026-10", limite: "2026-11-20", valor: 50 } },
    ],
  });
  const e = Object.fromEntries(L.map((l) => [l.id, l.estado]));
  assert.deepEqual(e, { a: "Pago", b: "Atrasado", c: "Pago", d: "Em pagamento", e: "Por pagar", "pedido:z": "Atrasado" });
  assert.equal(L.find((l) => l.id === "e").grupo, "PPP");
  assert.equal(L.find((l) => l.id === "pedido:z").grupo, "IRT");
  const R = T.resumoImpostos(L);
  assert.equal(R.total, 550);
  assert.equal(R.pago, 200);
  assert.equal(R.atrasados, 2);
  assert.equal(R.grupos.IRT, 1);
});

test("planos: prestações mensais no mesmo dia; resumo com pago, falta e próxima", () => {
  const P = T.gerarPrestacoes({ n: 3, valor: 1000, d1: "2026-01-31" });
  assert.deepEqual(P.map((p) => p.limite), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  const linhas = P.map((p, i) => ({ valor: p.valor, limite: p.limite, estado: i === 0 ? "Pago" : i === 1 ? "Atrasado" : "Por pagar", plano: { prestacao: p.prestacao } }));
  const r = T.resumoPlano({ id: "p", name: "PPP I", startDate: "2026-01-01" }, linhas, hoje);
  assert.equal(r.total, 3000);
  assert.equal(r.pago, 1000);
  assert.equal(r.falta, 2000);
  assert.equal(r.np, 1);
  assert.equal(r.estado, "Atrasado");
  assert.equal(r.proxima.prestacao, 2);
});

test("G3: IVA liquidado das faturas, suportado e retenções dos pedidos; só AOA", () => {
  const r = T.ivaRetencoes({
    hoje,
    faturas: [
      { docDate: "2026-10-05", vatAmount: 140, withholdingAmount: 65, moeda: "AOA" },
      { docDate: "2026-10-05", vatAmount: 999, moeda: "USD" },
    ],
    pedidos: [{ id: "p", number: "PC-1", createdAt: "2026-10-09", fornecedor: "F", nif: "1", moeda: "AOA", base: 1000, vat: 40, withheld: 65 }],
  });
  const out = r.meses.find((m) => m.k === "2026-10");
  assert.deepEqual(out, { k: "2026-10", liq: 140, ded: 40, aEntregar: 100, rfE: 65, rfS: 65 });
  assert.equal(r.sel, "2026-10");
  assert.equal(r.retencoes.length, 1);
});

test("G4: células por mês, sem registo num imposto mensal em falta, macro", () => {
  const linhas = T.linhasImpostos({
    hoje,
    obrigacoes: [ob({ id: "a", referenceMonth: "2026-08", dueDate: "2026-09-15", paidAt: "2026-09-10" }), ob({ id: "b", referenceMonth: "2026-10", dueDate: "2026-11-15" })],
    pedidos: [],
  });
  const M = T.mapaFiscal({ linhas, planos: [], ano: 2026, hoje });
  const iva = M.linhas.find((l) => l.nome === "IVA");
  const s = Object.fromEntries(iva.celulas.map((c) => [c.m, c.s]));
  assert.equal(s["2026-08"], "pg");
  assert.equal(s["2026-09"], "sr", "o IVA de setembro venceu a 15/10 e não está lançado");
  assert.equal(s["2026-10"], "at");
  assert.equal(s["2026-11"], "");
  assert.equal(M.macro.atrasado, 100);
  assert.equal(M.macro.divida, 100);
});
