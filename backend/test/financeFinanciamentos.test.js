const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/services/finance/financing");

const hoje = "2026-11-23";
const emp = (o) => ({ id: "e", kind: "EMPRESTIMO_BANCARIO", entity: "BAI", amount: 1200, rate: 12, startDate: "2026-01-15", termMonths: 12, periodMonths: 1, graceMonths: 0, ...o });

test("plano francês: prestação constante, juros e amortização somam, capital chega a zero", () => {
  const pl = F.plano(emp());
  assert.equal(pl.length, 12);
  assert.equal(pl[0].d, "2026-02-15");
  assert.equal(pl[0].juro, 12);
  const p = pl[0].prest;
  assert.ok(pl.slice(0, 11).every((x) => Math.abs(x.prest - p) < 0.02));
  assert.equal(pl[11].cap, 0);
  assert.ok(Math.abs(pl.reduce((s, x) => s + x.amort, 0) - 1200) < 0.05);
});

test("carência: só juros nos primeiros períodos; sem taxa, prestações iguais", () => {
  const pl = F.plano(emp({ graceMonths: 3 }));
  assert.deepEqual(pl.slice(0, 3).map((x) => [x.amort, x.prest]), [[0, 12], [0, 12], [0, 12]]);
  const sem = F.plano(emp({ rate: 0, termMonths: 4 }));
  assert.deepEqual(sem.map((x) => x.prest), [300, 300, 300, 300]);
});

test("capital em dívida pela última prestação vencida; linha e garantia", () => {
  const r = F.resumo(emp(), hoje);
  assert.equal(r.proxima.d, "2026-12-15");
  assert.ok(Math.abs(r.divida - 210.07) < 0.05, `capital depois de 10 prestações: ${r.divida}`);
  const l = F.resumo({ id: "l", kind: "LINHA_CREDITO", entity: "BFA", amount: 1000, used: 300 }, hoje);
  assert.equal(l.divida, 300);
  assert.equal(l.disponivel, 700);
  const g = F.resumo({ id: "g", kind: "GARANTIA_BANCARIA", entity: "BFA", amount: 500, validUntil: "2026-12-10", commissionPct: 2 }, hoje);
  assert.equal(g.aExpirar, true);
  assert.deepEqual(F.resumoE3([g]), { ativas: 500, nAtivas: 1, aExpirar: 1, aExpirarValor: 500, comissoes: 10 });
});

test("E2: posição por empresa — obtidos do grupo contra concedidos pagos menos devolvidos", () => {
  const itens = [F.resumo({ id: "a", kind: "EMPRESTIMO_GRUPO", entity: "MBT Holding", amount: 1000, rate: 0, startDate: "2027-01-01", termMonths: 10 }, hoje)];
  const P = F.posicaoEmpresas(itens, [
    { numero: "PC-1", beneficiario: "mbt holding", pago: 400, devolvido: 100 },
    { numero: "PC-2", beneficiario: "Outra", pago: 50, devolvido: 50 },
  ]);
  assert.equal(P.linhas.length, 1);
  assert.deepEqual([P.deve, P.deveAMbt, P.liquida], [1000, 300, -700]);
});

test("E4: lucro bruto, IAC 10%, líquido, pago e remanescente por sócio", () => {
  const r = F.distribuicaoSocios(
    [{ total: 1000, parts: [{ nome: "Ana", pct: 60 }, { nome: "Rui", pct: 40 }] }],
    [{ socio: "Ana", tipo: "LUCRO", valor: 540 }, { socio: "ana", tipo: "IAC", valor: 60 }]
  );
  const ana = r.socios.find((s) => s.socio === "Ana");
  assert.deepEqual([ana.bruto, ana.iac, ana.liquido, ana.pago, ana.remanescente, ana.iacPago], [600, 60, 540, 540, 0, 60]);
  assert.deepEqual([r.bruto, r.iac, r.pago, r.remanescente], [1000, 100, 540, 360]);
});
