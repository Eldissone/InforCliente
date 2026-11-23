const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const core = () => import(pathToFileURL(path.join(__dirname, "../../frontend/src/shared/finance/extratoImportCore.js")).href);

test("valores e datas dos extratos angolanos", async () => {
  const { parseMoney, parseDate } = await core();
  assert.equal(parseMoney("1.234.567,89"), 1234567.89);
  assert.equal(parseMoney("-1 234,50"), -1234.5);
  assert.equal(parseMoney("(2.500,00)"), -2500);
  assert.equal(parseMoney("1234.5-"), -1234.5);
  assert.equal(parseMoney("1,234.50"), 1234.5);
  assert.equal(parseMoney(""), null);
  assert.equal(parseDate("03/11/2026"), "2026-11-03");
  assert.equal(parseDate("3-11-26"), "2026-11-03");
  assert.equal(parseDate("2026-11-03T00:00"), "2026-11-03");
  assert.equal(parseDate(46329), "2026-11-03", "série do Excel");
  assert.equal(parseDate("Saldo"), null);
});

test("CSV com cabeçalho, débito/crédito, conta e saldos", async () => {
  const C = await core();
  const csv = "BANCO X\nConta n.º: 1234 5678 0008\nSaldo anterior;;;1.000.000,00\n\nData Mov.;Data Valor;Descrição;Débito;Crédito;Saldo\n03/11/2026;03/11/2026;TRF PARA BAI 02;50.000,00;;950.000,00\n08/11/2026;08/11/2026;RECEBIMENTO CLIENTE;;850.000,00;1.800.000,00\nTotal;;;;;\n";
  const t = C.tabelaDeTexto(csv);
  const hi = C.linhaCabecalho(t);
  assert.equal(hi, 3, "as linhas em branco não contam");
  const map = C.mapaAuto(t, hi);
  assert.deepEqual([map.data, map.desc, map.deb, map.cred, map.saldo], [0, 2, 3, 4, 5]);
  const rows = C.movimentosDaTabela(t, map, hi);
  assert.deepEqual(rows.map((r) => [r.data, r.valor]), [["2026-11-03", -50000], ["2026-11-08", 850000]]);
  assert.deepEqual(C.saldoAnterior(t, hi, rows), { valor: 1000000, calculado: false });
  assert.equal(C.saldoFinal(rows), 1800000);
  const d = C.contaDoFicheiro(t, hi, [{ id: "a", lastDigits: "2000" }, { id: "b", lastDigits: "0008" }]);
  assert.equal(d.conta.id, "b");
});

test("saldo anterior calculado da 1.ª linha; regras; chave de duplicado", async () => {
  const C = await core();
  const rows = [{ data: "2026-11-03", valor: -100, saldo: 900, desc: "x" }];
  assert.deepEqual(C.saldoAnterior([], -1, rows), { valor: 1000, calculado: true });
  const regras = [{ texto: "trf", tipo: "TRANSFERENCIA_INTERNA" }, { texto: "Receb", tipo: "RECEBIMENTO_CLIENTE" }];
  assert.equal(C.tipoPelasRegras("TRF PARA BAI 02", regras), "TRANSFERENCIA_INTERNA");
  assert.equal(C.tipoPelasRegras("recebimento cliente", regras), "RECEBIMENTO_CLIENTE");
  assert.equal(C.tipoPelasRegras("COMISSÃO", regras), null);
  assert.equal(C.chaveMov("2026-11-03", -50000, "TRF  Para"), C.chaveMov("2026-11-03", -50000, "trf para"));
  assert.notEqual(C.chaveMov("2026-11-03", -50000, "x"), C.chaveMov("2026-11-03", 50000, "x"));
});
