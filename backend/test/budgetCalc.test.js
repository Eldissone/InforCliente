const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const C = require("../src/services/budget/calc");

/**
 * Orçamento mínimo com números redondos, para cada passo do cálculo poder ser
 * conferido à mão. Os valores esperados estão escritos em cada teste como conta,
 * não como número mágico.
 *
 * Baremes (8 h/dia, 22 dias/mês, 1800 h/ano, gasóleo 400/L):
 *   RH Eletricista   mensal 440 000 → diário 20 000 → hora c/ encargos 2 500 → real 23 500
 *   EQ Escavadora    1 800 000 / 1 000 h = 1 800 dep + 200 man + 100 oper → 2 100/h
 *   VI Pick-up       10 L/100 km × 400 = 40 + 10 man → 50/km; 22 000 dep ÷ 22 → 1 000/dia
 *   FE Kit           36 500 / 365 = 100/dia
 *   LO Contentor     50 000/mês
 */
function miniBudget(over = {}) {
  const b = {
    params: {
      data: "2026-01-01",
      inicio: "2026-01-01",
      fim: "2026-01-10",
      validade: 30,
      moedaBase: "AOA",
      moedaRef: "USD",
      currencies: [
        { moeda: "AOA", desc: "Kwanza", cambio: 1, data: "2026-01-01" },
        { moeda: "USD", desc: "Dólar", cambio: 900, data: "2026-01-01" },
      ],
      metodo: "MARGEM_SOBRE_VENDA",
      margemMin: 0.15,
      margemObj: 0.25,
      iva: 0.14,
      ajuste: 0,
      diasMes: 22,
      horasDia: 8,
      horasAnoEquip: 1800,
      validadeBarem: 180,
      validadeCambio: 15,
      validadeComb: 30,
      limiarAtencao: 0.9,
      desvioMax: 0.1,
      contMin: 0.03,
      abcA: 0.8,
      abcB: 0.95,
      taxaJuro: 0.18,
      pmr: 90,
      pmp: 45,
    },
    baremSnapshot: {
      items: [
        { kind: "COMBUSTIVEL", code: "CB-01", name: "Gasóleo", unit: "L", fields: { preco: 400 } },
        {
          kind: "RH",
          code: "RH-01",
          name: "Eletricista",
          fields: { mensal: 440000, enc: 0, seg: 0, alim: 1000, aloj: 2000, transp: 500 },
        },
        {
          kind: "EQUIPAMENTO",
          code: "EQ-01",
          name: "Escavadora",
          ownership: "Próprio",
          fields: { aq: 1800000, vida: 1000, man: 200, oper: 100 },
        },
        {
          kind: "VIATURA",
          code: "VI-01",
          name: "Pick-up",
          fields: { cons: 10, comb: "Gasóleo", man: 10, dep: 22000 },
        },
        {
          kind: "FERRAMENTA",
          code: "FE-01",
          name: "Kit",
          unit: "dia",
          fields: { tipo: "Kit equipa", aq: 36500, vida: 365 },
        },
        { kind: "LOGISTICA", code: "LO-01", name: "Contentor", unit: "mês", fields: { custo: 50000 } },
      ],
    },
    dispatch: {
      margens: { MAT: 0.2, RH: 0.4, EQ: 0.35, VI: 0.25, FE: 0.25, SUB: 0.2, LOG: 0.2, ENG: 0.4, FIN: 0, IND: 0, RIS: 0 },
    },
    lists: {},
    sheets: {
      mat: [{ cod: "M1", fam: "Cabos BT", desc: "Cabo", un: "m", q: 100, preco: 10, moeda: "USD", tr: 0.1, desp: 0.05 }],
      rh: [{ funcao: "Eletricista", n: 2, h: 8, d: 10, desloc: "Sim" }],
      eq: [{ equip: "Escavadora", q: 1, h: 8, d: 10, mob: 5000 }],
      vi: [{ viat: "Pick-up", q: 1, d: 10, km: 500 }],
      fe: [{ item: "Kit", q: 2, dias: 10 }],
      sub: [{ sub: "Sub A", desc: "Valas", un: "m", q: 100, pu: 1000, mob: 10000, imp: 0.1, cont: 0.05 }],
      log: [{ item: "Contentor", q: 1, dias: 2 }],
      eng: [{ area: "Engenharia", rec: "Eletricista", ut: "Dias", n: 1, q: 10, ded: 0.5 }],
      ind: [{ rub: "Administração", tipo: "Percentagem", pct: 0.02, base: "Custo direto" }],
      fin: [{ item: "Custos bancários", tipo: "Valor fixo", fixo: 20000 }],
      ris: [{ n: 1, desc: "Variação cambial", cat: "Cambial", prob: 0.5, imp: "Alto", vbase: "Exposição cambial", fator: 0.1 }],
    },
  };
  return { ...b, ...over, params: { ...b.params, ...(over.params || {}) } };
}

const HOJE = new Date("2026-01-15T00:00:00Z");
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const close = (actual, expected, label, tol = 1e-6) =>
  assert.ok(near(actual, expected, tol), `${label}: esperado ${expected}, obtido ${actual}`);

// ───────────────────────── folhas de custo direto ─────────────────────────

test("03 Materiais: câmbio, encargos e quantidade corrigida", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  const m = R.mat[0];
  close(m.cambio, 900, "câmbio USD");
  close(m.qc, 100 * 1.05, "quantidade corrigida (desperdício 5%)");
  close(m.cu, 10 * 900 * 1.1, "custo unitário posto em obra (transporte 10%)");
  close(m.ct, 105 * 9900, "custo total");
  close(m.ct, 1039500, "custo total (valor absoluto)");
  close(m.exp, 1039500, "exposição cambial");
  assert.equal(m.estrangeira, true);
  assert.equal(m.semCambio, false);
  // margem 20% sobre a venda: PV = custo ÷ (1 − 0,20)
  close(m.pv, 1039500 / 0.8, "preço de venda");
  close(m.mv, 1039500 / 0.8 - 1039500, "margem em valor");
});

test("03 Materiais: material do cliente não tem custo", () => {
  const b = miniBudget();
  b.sheets.mat[0].cli = "Cliente";
  const R = C.calcBudget(b, HOJE);
  close(R.mat[0].cu, 0, "custo unitário");
  close(R.mat[0].ct, 0, "custo total");
  close(R.mat[0].pv, 0, "sem custo não há preço");
});

test("03 Materiais: moeda estrangeira sem câmbio é assinalada", () => {
  const b = miniBudget();
  b.params.currencies = [{ moeda: "AOA", cambio: 1 }];
  const R = C.calcBudget(b, HOJE);
  assert.equal(R.mat[0].semCambio, true);
  close(R.mat[0].cambio, 1, "sem câmbio, assume 1 para não rebentar");
  assert.ok(R.alerts.find((a) => /sem câmbio/i.test(a.t)).n > 0);
});

test("04 Recursos humanos: horas, alimentação, alojamento e transporte", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  const r = R.rh[0];
  close(r.ch, 2500, "custo/hora c/ encargos vindo do barém");
  close(r.cd, 2500 * 8, "custo/dia = custo/hora × horas/dia da linha");
  close(r.alim, 2 * 10 * 1000, "alimentação = pessoas × dias × valor do barém");
  close(r.aloj, 2 * 10 * 2000, "alojamento (deslocado = Sim)");
  close(r.transp, 2 * 10 * 500, "transporte");
  close(r.ct, 2 * 10 * 20000 + 20000 + 40000 + 10000, "custo total");
  close(r.ct, 470000, "custo total (valor absoluto)");
  assert.equal(r.ok, true);
});

test("04 Recursos humanos: não deslocado não tem alojamento", () => {
  const b = miniBudget();
  b.sheets.rh[0].desloc = "Não";
  const R = C.calcBudget(b, HOJE);
  close(R.rh[0].aloj, 0, "alojamento");
  close(R.rh[0].ct, 470000 - 40000, "custo total sem alojamento");
});

test("04 Recursos humanos: função que não existe no barém fica a zero e dá alerta", () => {
  const b = miniBudget();
  b.sheets.rh[0].funcao = "Astronauta";
  const R = C.calcBudget(b, HOJE);
  assert.equal(R.rh[0].ok, false);
  close(R.rh[0].ct, 0, "custo total");
  assert.ok(R.alerts.find((a) => /não existe no barém/i.test(a.t)).n > 0);
});

test("05 Equipamentos: horas × barém/hora + mobilização", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  const e = R.eq[0];
  close(e.bh, 2100, "barém/hora");
  close(e.bd, 2100 * 8, "barém/dia");
  close(e.ct, 1 * 8 * 10 * 2100 + 5000, "custo total");
  close(e.ct, 173000, "custo total (valor absoluto)");
  close(e.oper, 80 * 100, "operador incluído");
  assert.equal(e.pa, "Próprio");
});

test("05 Equipamentos: aluguer na própria linha substitui o barém", () => {
  const b = miniBudget();
  b.sheets.eq[0].ald = 16000; // por dia
  const R = C.calcBudget(b, HOJE);
  close(R.eq[0].bh, 16000 / 8, "barém/hora = aluguer/dia ÷ horas/dia");
  close(R.eq[0].ct, 80 * 2000 + 5000, "custo total");
  close(R.eq[0].oper, 0, "alugado não traz operador do barém");
  assert.match(R.eq[0].pa, /Alugado/);
});

test("06 Viaturas: dias × custo/dia + km × custo/km", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  const v = R.vi[0];
  close(v.bkm, 50, "custo/km (40 combustível + 10 manutenção)");
  close(v.bd, 1000, "custo/dia (22 000 ÷ 22)");
  close(v.ct, 1 * 10 * 1000 + 500 * 50, "custo total");
  close(v.ct, 35000, "custo total (valor absoluto)");
  close(v.comb, 500 * 40, "combustível incluído");
});

test("07 Ferramentas: unidade dia multiplica pelos dias", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  const f = R.fe[0];
  assert.equal(f.un, "dia");
  close(f.barem, 100, "custo unitário do barém");
  close(f.ct, 2 * 10 * 100, "custo total");
  assert.equal(f.tipo, "Kit equipa");
});

test("07 Ferramentas: sem barém usa o custo manual e avisa", () => {
  const b = miniBudget();
  b.sheets.fe[0] = { item: "Serra nova", q: 3, manual: 500 };
  const R = C.calcBudget(b, HOJE);
  assert.equal(R.fe[0].tipo, "Sem barém");
  assert.equal(R.fe[0].un, "un", "sem barém assume unidade");
  close(R.fe[0].ct, 3 * 500, "custo total = quantidade × custo manual");
});

test("08 Subempreitadas: impostos sobre valor + mobilização, contingência sobre o valor", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  const s = R.sub[0];
  close(s.valor, 100 * 1000, "valor");
  close(s.ct, (100000 + 10000) * 1.1 + 100000 * 0.05, "custo total");
  close(s.ct, 126000, "custo total (valor absoluto)");
});

test("09 Logística: quantidade × períodos × barém", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  close(R.log[0].barem, 50000, "barém");
  close(R.log[0].ct, 1 * 2 * 50000, "custo total");
  assert.equal(R.log[0].un, "mês");
});

test("09 Logística: dias vazios contam como 1 período", () => {
  const b = miniBudget();
  delete b.sheets.log[0].dias;
  const R = C.calcBudget(b, HOJE);
  close(R.log[0].ct, 50000, "custo total");
});

test("10 Engenharia: converte o custo real diário pela unidade de tempo", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  close(R.eng[0].cu, 23500, "custo unitário em dias = custo real diário");
  close(R.eng[0].ct, 1 * 10 * 0.5 * 23500, "custo total com 50% de dedicação");
  close(R.eng[0].ct, 117500, "custo total (valor absoluto)");

  const horas = miniBudget();
  horas.sheets.eng[0].ut = "Horas";
  close(C.calcBudget(horas, HOJE).eng[0].cu, 23500 / 8, "em horas divide pelas horas/dia");

  const meses = miniBudget();
  meses.sheets.eng[0].ut = "Meses";
  close(C.calcBudget(meses, HOJE).eng[0].cu, 23500 * 22, "em meses multiplica pelos dias úteis");
});

test("10 Engenharia: dedicação vazia conta como 100%", () => {
  const b = miniBudget();
  delete b.sheets.eng[0].ded;
  const R = C.calcBudget(b, HOJE);
  close(R.eng[0].ct, 10 * 23500, "custo total");
});

// ───────────────────────── custo direto e indiretos ─────────────────────────

test("custo direto é a soma das oito folhas", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  close(R.C.MAT, 1039500, "materiais");
  close(R.C.RH, 470000, "recursos humanos");
  close(R.C.EQ, 173000, "equipamentos");
  close(R.C.VI, 35000, "viaturas");
  close(R.C.FE, 2000, "ferramentas");
  close(R.C.SUB, 126000, "subempreitadas");
  close(R.C.LOG, 100000, "logística");
  close(R.C.ENG, 117500, "engenharia");
  close(R.CD, 2063000, "custo direto");
  close(R.MO, 470000 + 117500, "mão de obra");
  close(R.custoTempo, 470000 + 173000 + 35000 + 2000 + 100000 + 117500, "custo dependente do tempo");
  close(R.durDias, 10, "duração em dias (1 a 10 de janeiro)");
  close(R.custoTempoDia, 897500 / 10, "custo por dia de obra");
});

test("12 Estrutura: percentagem sobre a base de incidência escolhida", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  close(R.bases["Custo direto"], 2063000, "base custo direto");
  close(R.bases["Custo direto s/ subempreitadas"], 2063000 - 126000, "base sem subempreitadas");
  close(R.bases["Mão de obra (RH + Engenharia)"], 587500, "base mão de obra");
  close(R.ind[0].vb, 2063000, "valor da base");
  close(R.C.IND, 2063000 * 0.02, "custo indireto");
  close(R.C.IND, 41260, "custo indireto (valor absoluto)");
});

test("12 Estrutura: valor fixo ignora a base", () => {
  const b = miniBudget();
  b.sheets.ind = [{ rub: "Escritório", tipo: "Valor fixo", fixo: 300000, base: "Custo direto" }];
  const R = C.calcBudget(b, HOJE);
  close(R.ind[0].vb, 0, "valor da base");
  close(R.C.IND, 300000, "custo indireto");
});

test("13 Riscos: valor potencial, contingência recomendada e nível", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  close(R.expCambial, 1039500, "exposição cambial");
  close(R.ris[0].valor, 1039500 * 0.1, "valor potencial = base × fator");
  close(R.ris[0].rec, 0.5 * 103950, "contingência recomendada = probabilidade × valor");
  close(R.ris[0].cons, 51975, "sem valor aplicado, considera-se a recomendada");
  assert.equal(R.ris[0].nivel, "ALTO", "0,5 × peso 3 = 1,5 ≥ 1,2");
  close(R.C.RIS, 51975, "contingência considerada");
  close(R.contMinVal, 0.03 * 2063000, "contingência mínima");
  assert.equal(R.contEstado, "INSUFICIENTE", "51 975 < 61 890 mínimo");
});

test("13 Riscos: contingência aplicada à mão substitui a recomendada", () => {
  const b = miniBudget();
  b.sheets.ris[0].aplicada = 80000;
  const R = C.calcBudget(b, HOJE);
  close(R.C.RIS, 80000, "contingência considerada");
  assert.equal(R.contEstado, "ADEQUADA", "80 000 ≥ recomendada e ≥ mínima");
});

test("13 Riscos: base manual usa o valor escrito", () => {
  const b = miniBudget();
  b.sheets.ris[0] = { desc: "Multa", cat: "Outros", prob: 0.2, imp: "Baixo", vbase: "Manual", manual: 500000 };
  const R = C.calcBudget(b, HOJE);
  close(R.ris[0].valor, 500000, "valor potencial");
  close(R.ris[0].rec, 100000, "recomendada");
  assert.equal(R.ris[0].nivel, "BAIXO", "0,2 × peso 1 = 0,2 < 0,6");
});

test("11 Custos financeiros: comissão sobre o contrato estimado, taxa e prazo automáticos", () => {
  const b = miniBudget();
  b.sheets.fin = [
    { item: "Garantia", tipo: "Comissão s/ contrato", pct: 0.1, taxa: 0.025, prazo: 6 },
    { item: "Retenção", tipo: "Comissão s/ contrato", pct: 0.05, taxaAuto: "Taxa de juro", prazoAuto: "Duração" },
    { item: "Seguros", tipo: "% s/ custo direto", taxa: 0.003 },
  ];
  const R = C.calcBudget(b, HOJE);

  // contrato estimado = soma dos preços de venda das 8 diretas + indiretos + riscos
  const pvDirect =
    1039500 / 0.8 + 470000 / 0.6 + 173000 / 0.65 + 35000 / 0.75 + 2000 / 0.75 + 126000 / 0.8 + 100000 / 0.8 + 117500 / 0.6;
  close(R.contratoEst, pvDirect + 41260 + 51975, "contrato estimado");

  close(R.fin[0].base, R.contratoEst * 0.1, "base da comissão");
  close(R.fin[0].custo, R.contratoEst * 0.1 * 0.025 * (6 / 12), "comissão = base × taxa × prazo/12");
  close(R.fin[1].taxa, 0.18, "taxa automática = taxa de juro da empresa");
  close(R.fin[1].prazo, Math.round(10 / 30.42), "prazo automático = duração em meses arredondada");
  close(R.fin[2].base, 2063000, "base % s/ custo direto");
  close(R.fin[2].custo, 2063000 * 0.003, "% s/ custo direto não usa prazo");
});

test("11 Custos financeiros: juros do fundo de maneio usam PMR − PMP", () => {
  const b = miniBudget();
  b.sheets.fin = [{ item: "Fundo de maneio", tipo: "Juros s/ fundo de maneio", taxaAuto: "Taxa de juro", prazoAuto: "Duração" }];
  const R = C.calcBudget(b, HOJE);
  const durMeses = 10 / 30.42;
  const custoMes = (2063000 + 41260) / durMeses;
  close(R.custoMes, custoMes, "custo por mês");
  close(R.NFM, (custoMes * (90 - 45)) / 30, "necessidade de fundo de maneio");
  close(R.fin[0].base, R.NFM, "base dos juros");
});

test("11 Custos financeiros: PMP maior que PMR não dá fundo de maneio negativo", () => {
  const b = miniBudget({ params: { pmr: 30, pmp: 60 } });
  const R = C.calcBudget(b, HOJE);
  close(R.NFM, 0, "necessidade de fundo de maneio");
});

// ───────────────────────── preço de venda ─────────────────────────

test("custo total, preço de venda, IVA e margem bruta", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  close(R.CT, 2063000 + 41260 + 20000 + 51975, "custo total");
  close(R.CT, 2176235, "custo total (valor absoluto)");

  const pvDirect =
    1039500 / 0.8 + 470000 / 0.6 + 173000 / 0.65 + 35000 / 0.75 + 2000 / 0.75 + 126000 / 0.8 + 100000 / 0.8 + 117500 / 0.6;
  const pvCalc = pvDirect + 41260 + 20000 + 51975;
  close(R.PVcalc, pvCalc, "preço de venda calculado");
  close(R.PVsi, pvCalc, "sem ajuste comercial, PV s/ IVA = calculado");
  close(R.imp, pvCalc * 0.14, "IVA");
  close(R.PVfinal, pvCalc * 1.14, "preço com IVA");
  close(R.MB, pvCalc - 2176235, "margem bruta");
  close(R.MBpct, (pvCalc - 2176235) / pvCalc, "margem bruta %");
  assert.equal(R.mgEstado, "OBJETIVO_ATINGIDO", "margem acima dos 25% objetivo");
});

test("ajuste comercial entra depois do preço calculado", () => {
  const R = C.calcBudget(miniBudget({ params: { ajuste: -100000 } }), HOJE);
  close(R.PVsi, R.PVcalc - 100000, "PV s/ IVA");
  close(R.MB, R.PVsi - R.CT, "margem bruta cai com o desconto");
});

test("metodologia markup sobre o custo: PV = custo × (1 + markup)", () => {
  const R = C.calcBudget(miniBudget({ params: { metodo: "MARKUP_SOBRE_CUSTO" } }), HOJE);
  close(R.mat[0].pv, 1039500 * 1.2, "preço do material");
  close(R.rh[0].pv, 470000 * 1.4, "preço dos recursos humanos");
  close(R.cat.find((c) => c.k === "MAT").pv, 1039500 * 1.2, "preço da categoria");
});

test("margem de 100% ou mais sobre a venda dá preço zero, não infinito", () => {
  const b = miniBudget();
  b.dispatch.margens.MAT = 1;
  const R = C.calcBudget(b, HOJE);
  close(R.mat[0].pv, 0, "preço do material");
});

test("margem na linha substitui a margem da categoria", () => {
  const b = miniBudget();
  b.sheets.mat[0].mg = 0.5;
  const R = C.calcBudget(b, HOJE);
  close(R.mat[0].mga, 0.5, "margem usada");
  close(R.mat[0].pv, 1039500 / 0.5, "preço de venda");
});

test("linha sem custo não gera margem", () => {
  const b = miniBudget();
  b.sheets.mat[0].q = 0;
  const R = C.calcBudget(b, HOJE);
  close(R.mat[0].ct, 0, "custo");
  close(R.mat[0].pv, 0, "preço");
  close(R.mat[0].mga, 0, "margem");
});

test("estado da margem percorre os quatro patamares", () => {
  const base = miniBudget();
  // margens a zero em tudo → PV = custo → margem 0, abaixo do mínimo
  for (const k of Object.keys(base.dispatch.margens)) base.dispatch.margens[k] = 0;
  assert.equal(C.calcBudget(base, HOJE).mgEstado, "ABAIXO_DO_MINIMO");

  const neg = miniBudget({ params: { ajuste: -5000000 } });
  assert.equal(C.calcBudget(neg, HOJE).mgEstado, "MARGEM_NEGATIVA");

  const meio = miniBudget();
  for (const k of Object.keys(meio.dispatch.margens)) meio.dispatch.margens[k] = 0.2;
  assert.equal(C.calcBudget(meio, HOJE).mgEstado, "ENTRE_MINIMO_E_OBJETIVO");

  assert.equal(C.calcBudget(miniBudget(), HOJE).mgEstado, "OBJETIVO_ATINGIDO");
});

test("categorias: percentagem do custo total e margem em valor", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  const mat = R.cat.find((c) => c.k === "MAT");
  close(mat.c, 1039500, "custo");
  close(mat.pct, 1039500 / 2176235, "% do custo total");
  close(mat.mv, 1039500 / 0.8 - 1039500, "margem em valor");
  close(mat.mgPct, (1039500 / 0.8 - 1039500) / (1039500 / 0.8), "margem % sobre a venda");
  assert.equal(R.cat.length, 11, "11 categorias");
  close(R.catTot.c, R.CT, "total do quadro = custo total");
});

// ───────────────────────── ABC ─────────────────────────

test("análise ABC: Pareto do custo direto com classes A, B e C", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  close(R.abcTot, 2063000, "total analisado = custo direto");
  assert.equal(R.abc.length, 8, "uma linha por item com custo");
  assert.equal(R.abc[0].item, "Cabo", "o maior custo vem primeiro");
  close(R.abc[0].pct, 1039500 / 2063000, "peso do maior item");
  // 1 039 500 + 470 000 + 173 000 = 1 682 500 → 81,5% do custo direto
  assert.equal(R.abcA.n, 3, "classe A");
  close(R.abcA.pct, 1682500 / 2063000, "peso da classe A");
  assert.equal(R.abcB, 3, "classe B");
  assert.equal(R.abcC, 2, "classe C");
  assert.deepEqual(
    R.abc.map((x) => x.cls),
    ["A", "A", "A", "B", "B", "B", "C", "C"]
  );
});

test("análise ABC: orçamento vazio não rebenta", () => {
  const b = miniBudget();
  for (const k of C.SHEET_KEYS) b.sheets[k] = [];
  const R = C.calcBudget(b, HOJE);
  close(R.CD, 0, "custo direto");
  close(R.CT, 0, "custo total");
  close(R.MBpct, 0, "margem");
  assert.equal(R.abc.length, 0, "sem itens");
  assert.equal(R.abcTot, 0, "total");
});

// ───────────────────────── alertas ─────────────────────────

test("alertas: contingência insuficiente e baremes sem data", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  const byName = (rx) => R.alerts.find((a) => rx.test(a.t));
  assert.equal(byName(/contingência insuficiente/i).n, 1);
  assert.equal(byName(/contingência insuficiente/i).estado, "ATENÇÃO");
  assert.equal(byName(/desatualizados ou sem data/i).n, 6, "os 6 baremes do snapshot não têm data");
  assert.equal(byName(/abaixo do mínimo/i).n, 0, "margem está acima do mínimo");
  assert.equal(byName(/margem negativa/i).n, 0);
  assert.equal(byName(/não existe no barém/i).n, 0);
  assert.equal(byName(/custo unitário não preenchido/i).n, 0);
});

test("alertas: margem negativa aparece como crítica", () => {
  const R = C.calcBudget(miniBudget({ params: { ajuste: -5000000 } }), HOJE);
  const a = R.alerts.find((x) => /margem negativa/i.test(x.t));
  assert.ok(a.n > 0);
  assert.equal(a.estado, "CRÍTICO");
});

test("alertas: equipamento próprio sem depreciação", () => {
  const b = miniBudget();
  b.baremSnapshot.items[2].fields = { man: 200 };
  const R = C.calcBudget(b, HOJE);
  assert.equal(R.alerts.find((a) => /sem custo interno/i.test(a.t)).n, 1);
});

test("alertas: quantidade a zero", () => {
  const b = miniBudget();
  b.sheets.rh[0].d = 0;
  const R = C.calcBudget(b, HOJE);
  assert.ok(R.alerts.find((a) => /quantidade a zero/i.test(a.t)).n >= 1);
});

test("alertas: cada um diz onde se resolve", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  for (const a of R.alerts) {
    assert.ok(typeof a.t === "string" && a.t.length > 0, "alerta sem texto");
    assert.ok(typeof a.n === "number", `alerta "${a.t}" sem contagem`);
    assert.ok(["OK", "ATENÇÃO", "CRÍTICO"].includes(a.estado), `estado inválido em "${a.t}"`);
    assert.ok(typeof a.go === "string" && a.go.length > 0, `alerta "${a.t}" sem destino`);
  }
});

// ───────────────────────── câmbios e prazos ─────────────────────────

test("câmbios: estado por moeda", () => {
  const b = miniBudget();
  b.params.currencies = [
    { moeda: "AOA", cambio: 1, data: "2026-01-01" },
    { moeda: "USD", cambio: 900, data: "2026-01-14" },
    { moeda: "EUR", cambio: 1000, data: "2025-01-01" },
    { moeda: "ZAR", cambio: null, data: null },
    { moeda: "BRL", cambio: 50 },
  ];
  const R = C.calcBudget(b, HOJE);
  const st = Object.fromEntries(R.currencies.map((c) => [c.moeda, c.estado]));
  assert.equal(st.AOA, "BASE");
  assert.equal(st.USD, "OK", "1 dia, dentro dos 15");
  assert.equal(st.EUR, "DESATUALIZADO");
  assert.equal(st.ZAR, "SEM_CAMBIO");
  assert.equal(st.BRL, "SEM_DATA");
});

test("prazos: duração em dias inclui o primeiro e o último", () => {
  assert.equal(C.daysBetween("2026-01-01", "2026-01-10"), 10);
  assert.equal(C.daysBetween("2026-01-01", "2026-01-01"), 1);
  const R = C.calcBudget(miniBudget({ params: { inicio: null, fim: null } }), HOJE);
  assert.equal(R.durDias, 0, "sem datas, duração zero");
  assert.equal(R.custoTempoDia, 0, "e custo por dia zero, sem divisão por zero");
  assert.ok(R.alerts.find((a) => /datas de início/i.test(a.t)).n === 1);
});

test("validade da proposta é a data mais os dias", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  assert.equal(R.validaAte, "2026-01-31", "1 de janeiro + 30 dias");
});

// ───────────────────────── totais materializados ─────────────────────────

test("budgetTotals: arredonda a dois decimais e classifica a margem", () => {
  const R = C.calcBudget(miniBudget(), HOJE);
  const t = C.budgetTotals(R);
  assert.equal(t.directCost, 2063000);
  assert.equal(t.totalCost, 2176235);
  assert.equal(t.marginState, "good");
  assert.ok(Math.abs(t.salePriceExVat - R.PVsi) < 0.01);
  assert.ok(Math.abs(t.grossMargin - R.MB) < 0.01);

  const bad = C.budgetTotals(C.calcBudget(miniBudget({ params: { ajuste: -5000000 } }), HOJE));
  assert.equal(bad.marginState, "bad");
});

// ───────────────────────── robustez ─────────────────────────

test("orçamento sem nada preenchido não rebenta", () => {
  const R = C.calcBudget({}, HOJE);
  assert.equal(R.CD, 0);
  assert.equal(R.CT, 0);
  assert.equal(R.PVsi, 0);
  assert.equal(R.cat.length, 11);
  assert.ok(Array.isArray(R.alerts));
});

test("campos vazios contam como zero, não como erro", () => {
  const b = miniBudget();
  b.sheets.mat = [{ desc: "Sem nada" }];
  b.sheets.rh = [{ funcao: "Eletricista" }];
  const R = C.calcBudget(b, HOJE);
  close(R.mat[0].ct, 0, "material sem quantidade nem preço");
  close(R.rh[0].ct, 0, "pessoa sem dias nem horas");
});

test("baremes: ferramenta desambiguada pelo código", () => {
  const b = miniBudget();
  b.baremSnapshot.items.push({
    kind: "FERRAMENTA",
    code: "FE-99",
    name: "Kit",
    unit: "un",
    fields: { tipo: "Consumível", aq: 7000 },
  });
  b.sheets.fe = [{ item: "Kit [FE-99]", q: 3 }];
  const R = C.calcBudget(b, HOJE);
  close(R.fe[0].barem, 7000, "o código escolhe a linha certa");
  close(R.fe[0].ct, 3 * 7000, "custo total");
  assert.ok(R.alerts.find((a) => /mesmo nome no barém/i.test(a.t)).n >= 1);
});

// ───────── o espelho do frontend tem de dar exactamente o mesmo ─────────

test("o espelho do frontend (budgetCalc.js) dá os mesmos resultados", async () => {
  const mirrorPath = path.resolve(__dirname, "../../frontend/src/shared/comercial/budgetCalc.js");
  const M = await import(pathToFileURL(mirrorPath).href);

  const CASOS = [
    ["mínimo", miniBudget()],
    ["markup", miniBudget({ params: { metodo: "MARKUP_SOBRE_CUSTO" } })],
    ["com desconto", miniBudget({ params: { ajuste: -250000 } })],
    ["sem datas", miniBudget({ params: { inicio: null, fim: null } })],
    ["outros parâmetros", miniBudget({ params: { horasDia: 10, diasMes: 20, horasAnoEquip: 2200, iva: 0.07 } })],
    ["vazio", {}],
  ];

  // Um caso com todas as variantes das folhas financeiras e de risco
  const completo = miniBudget();
  completo.sheets.fin = [
    { item: "A", tipo: "Comissão s/ contrato", pct: 0.1, taxa: 0.025, prazo: 6 },
    { item: "B", tipo: "Comissão s/ contrato", pct: 0.05, taxaAuto: "Taxa de juro", prazoAuto: "Duração + 12" },
    { item: "C", tipo: "% s/ custo direto", taxa: 0.003 },
    { item: "D", tipo: "Juros s/ fundo de maneio", taxaAuto: "Taxa de juro", prazoAuto: "Duração" },
    { item: "E", tipo: "Valor fixo", fixo: 450000 },
  ];
  completo.sheets.ris = [
    { n: 1, desc: "Cambial", cat: "Cambial", prob: 0.5, imp: "Alto", vbase: "Exposição cambial", fator: 0.1 },
    { n: 2, desc: "Clima", cat: "Clima", prob: 0.5, imp: "Médio", vbase: "Custo por dia de obra", fator: 10 },
    { n: 3, desc: "Manual", cat: "Outros", prob: 0.2, imp: "Muito alto", vbase: "Manual", manual: 900000, aplicada: 100000 },
  ];
  completo.sheets.ind = [
    { rub: "Administração", tipo: "Percentagem", pct: 0.02, base: "Custo direto" },
    { rub: "RH", tipo: "Percentagem", pct: 0.005, base: "Mão de obra (RH + Engenharia)" },
    { rub: "Compras", tipo: "Percentagem", pct: 0.005, base: "Materiais" },
    { rub: "Escritório", tipo: "Valor fixo", fixo: 1200000 },
  ];
  completo.sheets.eq.push({ equip: "Escavadora", q: 2, h: 6, d: 5, ald: 20000 });
  completo.sheets.fe.push({ item: "Sem barém", q: 4, manual: 1200 });
  CASOS.push(["completo", completo]);

  for (const [nome, b] of CASOS) {
    const a = C.calcBudget(b, HOJE);
    const z = M.calcBudget(b, HOJE);
    assert.deepEqual(z, a, `resultado divergente no caso "${nome}"`);
    assert.deepEqual(M.budgetTotals(z), C.budgetTotals(a), `totais divergentes no caso "${nome}"`);
  }

  assert.deepEqual(M.CATS, C.CATS);
  assert.deepEqual(M.SHEET_KEYS, C.SHEET_KEYS);
  assert.deepEqual(M.IND_BASES, C.IND_BASES);
  assert.deepEqual(M.FIN_TYPES, C.FIN_TYPES);
  assert.deepEqual(M.RIS_BASES, C.RIS_BASES);
  assert.equal(M.daysBetween("2026-01-01", "2026-01-10"), C.daysBetween("2026-01-01", "2026-01-10"));
});
