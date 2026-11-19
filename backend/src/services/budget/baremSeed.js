/**
 * Baremes de referência — valores do exemplo do protótipo "Orçamentação de Obras MBT"
 * (rede MT/BT em Angola), para arrancar a biblioteca da empresa.
 *
 * São semeados **sem data de preço**, de propósito: ficam com o estado «Sem data»
 * até alguém confirmar cada valor e pôr a data. São um ponto de partida, não preços
 * da empresa.
 */

const SOURCE_NOTE = "Valor de referência (protótipo MBT) — confirmar o preço e pôr a data.";

const row = (keys) => (values) => {
  const o = {};
  keys.forEach((k, i) => {
    const v = values[i];
    if (v !== undefined && v !== null && v !== "") o[k] = v;
  });
  return o;
};

// ─── 0. Combustíveis ────────────────────────────────────────────────────────
const comb = row(["code", "name", "preco"]);
const COMBUSTIVEL = [
  comb(["CB-01", "Gasóleo", 400]),
  comb(["CB-02", "Gasolina", 300]),
].map((r) => ({
  kind: "COMBUSTIVEL",
  code: r.code,
  name: r.name,
  unit: "L",
  fields: { preco: r.preco, fonte: "Preço de bomba (ilustrativo)" },
  notes: SOURCE_NOTE,
}));

// ─── A. Recursos humanos ────────────────────────────────────────────────────
const rh = row(["code", "name", "mensal", "enc", "seg", "alim", "aloj", "transp"]);
const RH = [
  rh(["RH-01", "Diretor de Projeto", 2800000, 0.25, 600]),
  rh(["RH-02", "Engenheiro", 1350000, 0.25, 600, 3500, 7500, 1500]),
  rh(["RH-03", "Coordenador", 950000, 0.25, 350, 3500, 7500, 1500]),
  rh(["RH-04", "Encarregado", 520000, 0.25, 350, 3500, 7500, 1500]),
  rh(["RH-05", "Eletricista", 320000, 0.25, 350, 3500, 7500, 1500]),
  rh(["RH-06", "Técnico", 400000, 0.25, 350, 3500, 7500, 1500]),
  rh(["RH-07", "Operador de máquina", 340000, 0.25, 350, 3500, 7500, 1500]),
  rh(["RH-08", "Motorista", 230000, 0.25, 350, 3500, 7500, 1500]),
  rh(["RH-09", "Pedreiro", 210000, 0.25, 350, 3500, 7500, 1500]),
  rh(["RH-10", "Servente", 130000, 0.25, 350, 3500, 7500, 1500]),
  rh(["RH-11", "Administrativo", 280000, 0.25, 350, undefined, undefined, 1500]),
  rh(["RH-12", "Segurança/HSE", 480000, 0.25, 350, 3500, 7500, 1500]),
  rh(["RH-13", "Topógrafo", 560000, 0.25, 350, 3500, 7500, 1500]),
].map((r) => ({
  kind: "RH",
  code: r.code,
  name: r.name,
  fields: {
    mensal: r.mensal,
    enc: r.enc,
    seg: r.seg,
    ...(r.alim ? { alim: r.alim } : {}),
    ...(r.aloj ? { aloj: r.aloj } : {}),
    ...(r.transp ? { transp: r.transp } : {}),
  },
  notes: SOURCE_NOTE,
}));

// ─── B. Equipamentos ────────────────────────────────────────────────────────
const eq = row([
  "code", "name", "marca", "ownership", "aq", "vida", "aluguer",
  "man", "lh", "tipo", "lub", "pneus", "oper", "seguro",
]);
const EQUIPAMENTO = [
  eq(["EQ-01", "Autogrua 50 t", "Grua móvel 50 t", "Alugado", undefined, undefined, 650000, undefined, 14, "Gasóleo"]),
  eq(["EQ-02", "Autobetoneira 8 m³", undefined, "Próprio", 85000000, 12000, undefined, 2500, 9, "Gasóleo", 450, 900, 2450, 1200000]),
  eq(["EQ-03", "Retroescavadora", "JCB 3CX ou equivalente", "Próprio", 98000000, 10000, undefined, 3000, 8, "Gasóleo", 500, 1000, 2450, 1400000]),
  eq(["EQ-04", "Escavadora 20 t", "CAT 320 ou equivalente", "Próprio", 165000000, 12000, undefined, 4500, 15, "Gasóleo", 700, 1200, 2450, 2200000]),
  eq(["EQ-05", "Grua (camião-grua 10 t)", undefined, "Próprio", 120000000, 12000, undefined, 3500, 10, "Gasóleo", 500, 1200, 2450, 1800000]),
  eq(["EQ-06", "Gerador 100 kVA", undefined, "Próprio", 26000000, 20000, undefined, 800, 15, "Gasóleo", 150, undefined, undefined, 350000]),
  eq(["EQ-07", "Compressor 7 bar", undefined, "Próprio", 18000000, 10000, undefined, 600, 6, "Gasóleo", 100, undefined, undefined, 250000]),
  eq(["EQ-08", "Betoneira 350 L", "Motor a gasolina", "Próprio", 1600000, 5000, undefined, 120, 1, "Gasolina", 20]),
  eq(["EQ-09", "Equipamento de perfuração", "Perfuradora sobre camião", "Alugado", undefined, undefined, 380000, undefined, 12, "Gasóleo", undefined, undefined, 2450]),
  eq(["EQ-10", "Camião basculante 20 m³", undefined, "Próprio", 110000000, 15000, undefined, 2800, 14, "Gasóleo", 400, 1500, 2450, 1600000]),
].map((r) => ({
  kind: "EQUIPAMENTO",
  code: r.code,
  name: r.name,
  ownership: r.ownership,
  fields: {
    ...(r.marca ? { marca: r.marca } : {}),
    ...(r.aq ? { aq: r.aq } : {}),
    ...(r.vida ? { vida: r.vida } : {}),
    ...(r.aluguer ? { aluguer: r.aluguer, alugUn: "Dia" } : {}),
    ...(r.man ? { man: r.man } : {}),
    ...(r.lh ? { lh: r.lh } : {}),
    ...(r.tipo ? { tipo: r.tipo } : {}),
    ...(r.lub ? { lub: r.lub } : {}),
    ...(r.pneus ? { pneus: r.pneus } : {}),
    ...(r.oper ? { oper: r.oper } : {}),
    ...(r.seguro ? { seguro: r.seguro } : {}),
  },
  notes: SOURCE_NOTE,
}));

// ─── C. Viaturas ────────────────────────────────────────────────────────────
const vi = row(["code", "name", "tipo", "cons", "comb", "man", "pneus", "seg", "dep", "mot", "outros"]);
const VIATURA = [
  vi(["VI-01", "Pick-up 4x4 cabine dupla", "Ligeira todo-o-terreno", 12, "Gasóleo", 45, 20, 450000, 520000, undefined, 40000]),
  vi(["VI-02", "Camião 10 t com grua", "Pesado", 30, "Gasóleo", 120, 60, 1200000, 1300000, 300000, 80000]),
  vi(["VI-03", "Carrinha 15 lugares", "Transporte de pessoal", 14, "Gasóleo", 55, 25, 500000, 600000, 300000, 40000]),
  vi(["VI-04", "Viatura ligeira (direção)", "Ligeira", 9, "Gasolina", 35, 15, 380000, 450000, undefined, 30000]),
  vi(["VI-05", "Camião cisterna 10 m³", "Pesado", 32, "Gasóleo", 110, 60, 900000, 900000, 300000, 60000]),
].map((r) => ({
  kind: "VIATURA",
  code: r.code,
  name: r.name,
  fields: {
    tipo: r.tipo,
    cons: r.cons,
    comb: r.comb,
    man: r.man,
    pneus: r.pneus,
    seg: r.seg,
    dep: r.dep,
    ...(r.mot ? { mot: r.mot } : {}),
    ...(r.outros ? { outros: r.outros } : {}),
  },
  notes: SOURCE_NOTE,
}));

// ─── D. Ferramentas e consumíveis ───────────────────────────────────────────
const fe = row(["code", "name", "tipo", "unit", "aq", "vida", "man", "cons"]);
const FERRAMENTA = [
  fe(["FE-01", "Kit ferramentas eletricista (por equipa)", "Kit equipa", "dia", 650000, 365, 200, 300]),
  fe(["FE-02", "Kit ferramentas construção civil (por equipa)", "Kit equipa", "dia", 380000, 365, 100, 200]),
  fe(["FE-03", "Ferramentas elétricas (berbequim, rebarbadora, serra)", "Elétrica", "dia", 520000, 540, 250]),
  fe(["FE-04", "Megóhmetro 5 kV", "Medição", "dia", 1900000, 1800, 150]),
  fe(["FE-05", "Medidor de resistência de terra", "Medição", "dia", 850000, 1800, 80]),
  fe(["FE-06", "Equipamento de ensaio de cabos MT (VLF)", "Ensaio", "dia", 18000000, 2500, 1500]),
  fe(["FE-07", "Tirfor, roldanas e material de tração", "Individual", "dia", 1200000, 1000, 150]),
  fe(["FE-08", "Discos de corte/rebarbar", "Consumível", "un", 1900]),
  fe(["FE-09", "Brocas SDS (diversas)", "Consumível", "un", 7500]),
  fe(["FE-10", "Elétrodos de soldadura (kg)", "Consumível", "un", 4200]),
  fe(["FE-11", "Gases acetileno/oxigénio (garrafa)", "Consumível", "un", 48000]),
  fe(["FE-12", "Óleos e lubrificantes (L)", "Consumível", "un", 4800]),
  fe(["FE-13", "Pequenos consumíveis (por mês)", "Consumível", "un", 180000]),
  fe(["FE-14", "EPI completo (por trabalhador)", "EPI", "un", 68000]),
  fe(["FE-15", "EPI dielétrico (luvas, tapete, vara)", "EPI", "un", 420000]),
].map((r) => ({
  kind: "FERRAMENTA",
  code: r.code,
  name: r.name,
  unit: r.unit,
  fields: {
    tipo: r.tipo,
    aq: r.aq,
    ...(r.vida ? { vida: r.vida } : {}),
    ...(r.man ? { man: r.man } : {}),
    ...(r.cons ? { cons: r.cons } : {}),
  },
  notes: SOURCE_NOTE,
}));

// ─── E. Logística e estaleiro ───────────────────────────────────────────────
const lo = row(["code", "name", "unit", "custo", "link"]);
const LOGISTICA = [
  lo(["LO-01", "Mobilização de estaleiro", "vg", 1800000]),
  lo(["LO-02", "Desmobilização de estaleiro", "vg", 900000]),
  lo(["LO-03", "Transporte de equipamentos", "viagem", 850000]),
  lo(["LO-04", "Transporte de materiais", "viagem", 450000]),
  lo(["LO-05", "Transporte de trabalhadores", "viagem", 25000]),
  lo(["LO-06", "Alojamento (pessoa/dia)", "dia", 7500]),
  lo(["LO-07", "Alimentação (pessoa/dia)", "dia", 3500]),
  lo(["LO-08", "Água", "dia", 6000]),
  lo(["LO-09", "Energia (estaleiro)", "mês", 220000]),
  lo(["LO-10", "Gasóleo (estaleiro)", "L", undefined, "Gasóleo"]),
  lo(["LO-11", "Gasolina (estaleiro)", "L", undefined, "Gasolina"]),
  lo(["LO-12", "Contentor", "mês", 120000]),
  lo(["LO-13", "Escritório de obra", "mês", 180000]),
  lo(["LO-14", "Armazém", "mês", 250000]),
  lo(["LO-15", "Segurança (vigilância)", "mês", 450000]),
  lo(["LO-16", "Internet e comunicações", "mês", 85000]),
  lo(["LO-17", "Limpeza", "mês", 90000]),
  lo(["LO-18", "Instalações sanitárias", "mês", 75000]),
  lo(["LO-19", "Outros custos logísticos", "vg", 500000]),
].map((r) => ({
  kind: "LOGISTICA",
  code: r.code,
  name: r.name,
  unit: r.unit,
  fields: {
    ...(r.custo ? { custo: r.custo } : {}),
    ...(r.link ? { link: r.link } : {}),
  },
  notes: SOURCE_NOTE,
}));

/** Combustíveis primeiro: os outros tipos dependem do preço do litro. */
const BAREM_SEED = [...COMBUSTIVEL, ...RH, ...EQUIPAMENTO, ...VIATURA, ...FERRAMENTA, ...LOGISTICA];

module.exports = { BAREM_SEED, SOURCE_NOTE };
