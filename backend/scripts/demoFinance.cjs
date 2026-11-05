/**
 * Carteira de demonstração da área financeira (apresentações e formação).
 *
 *   node scripts/demoFinance.cjs seed    → cria as obras com faturação, tesouraria e custos
 *   node scripts/demoFinance.cjs clean   → remove tudo o que foi criado
 *
 * Três obras, cada uma com um perfil diferente de cliente e de faturação:
 *  - OBR-2026-001 Edifício Residencial Talatona (cliente privado, IVA normal):
 *      adiantamento e amortização, nota de crédito, fatura vencida com pagamento
 *      parcial, auto por faturar; custos de todas as fontes (pagamentos, stock,
 *      pedido extra, lançamento, encomenda, frete, ATM discriminado).
 *  - OBR-2026-002 Reabilitação do Hospital do Cazenga (Estado, IVA 100% cativo, CAR):
 *      fatura vencida com a entrada no banco ainda por ligar, fatura a crédito
 *      liquidada pelo extrato, ATM por discriminar, compromissos por aprovar.
 *  - OBR-2026-003 Armazém Logístico de Viana (grande contribuinte, IVA 50% cativo):
 *      obra concluída, tudo faturado e recebido, desconto por NC, devolução de
 *      50% da garantia na receção provisória.
 *
 * Tesouraria: extratos mensais das contas BFA (Cartão 1), BAI (Cartão 2) e CAIXA
 * (Cartão 3) com saldos inicial/final encadeados. Cada recebimento de fatura
 * está ligado à entrada do extrato e cada pagamento ao movimento de saída.
 *
 * Faturas, notas de crédito, recebimentos, extratos, associação de custos e
 * devoluções de garantia são criados pela API (as mesmas validações que um
 * utilizador): o backend tem de estar a correr em API_URL.
 */
const path = require("path");
const jwt = require("jsonwebtoken");
const { prisma } = require(path.join(__dirname, "../src/db"));
const { config } = require(path.join(__dirname, "../src/config"));

const API_URL = process.env.API_URL || "http://127.0.0.1:4000";

const VAT = 14;
const WITHHOLDING = 6.5;
const M = 1_000_000;
const k = 1_000;
const TODAY = "2026-11-04";

const d = (iso) => new Date(`${iso}T12:00:00.000Z`);
const r2 = (n) => Math.round(n * 100) / 100;

async function api(token, method, url, body) {
  const res = await fetch(API_URL + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${data.error || ""} ${data.message || ""}`);
  return data;
}

/** Valores fiscais de um custo: base, IVA e retenção (serviços). */
function fiscal(base, { vat = true, wh = false } = {}) {
  const vatAmount = vat ? r2((base * VAT) / 100) : 0;
  const withholdingAmount = wh ? r2((base * WITHHOLDING) / 100) : 0;
  const gross = r2(base + vatAmount);
  const taxed = vat || wh;
  return {
    budgetedAmount: base,
    grossAmount: taxed ? gross : null,
    vatAmount: vat ? vatAmount : null,
    withholdingAmount: wh ? withholdingAmount : null,
    netAmount: taxed ? r2(gross - withholdingAmount) : null,
    fiscalApplyVat: vat,
    fiscalApplyWithholding: wh,
    fiscalInputMode: taxed ? "base" : null,
    cash: r2(gross - withholdingAmount),
  };
}

/* ─── Dados ──────────────────────────────────────────────────────────────── */

const CLIENTS = {
  horizonte: { code: "CLI-101", name: "Imobiliária Horizonte, S.A.", region: "Luanda" },
  gpl: { code: "CLI-102", name: "Governo Provincial — Direção de Obras Públicas", region: "Luanda" },
  atlantico: { code: "CLI-103", name: "Terminal Logístico Atlântico, S.A.", region: "Luanda" },
};

// [nome, tipo, NIF] — os NIF 50000000xx identificam os fornecedores da demonstração.
const SUPPLIERS = {
  cimentos: ["Cimentos do Sul, Lda", "MATERIAL", "5000000001"],
  aco: ["Aço Angola, S.A.", "MATERIAL", "5000000002"],
  gruas: ["Equipa Gruas, Lda", "SERVICO", "5000000003"],
  inst: ["Instala Mais, Lda", "SERVICO", "5000000004"],
  transp: ["Transportes Rápidos, Lda", "SERVICO", "5000000005"],
  alum: ["Alumínios Kianda, Lda", "MATERIAL", "5000000006"],
  avac: ["Clima Total AVAC, Lda", "SERVICO", "5000000007"],
  comb: ["Combustíveis do Bengo, Lda", "MATERIAL", "5000000008"],
};

const PRODUCT = { sku: "CIM-425R-50", name: "Cimento Portland CEM II 42,5R — saco 50 kg", unitPrice: 8500 };
const STATEMENT_FILE = /^extrato_(BFA|BAI|CAIXA)_\d{4}-\d{2}\.pdf$/;

/*
 * Custos de cada obra:
 *   pay "bank"   → pago por transferência na data (movimento de saída no extrato, ligado ao custo)
 *   pay "credit" → fatura do fornecedor a crédito, por pagar até `due`
 *   pay "settle" → registado a crédito e depois liquidado pelo extrato em `paid` (ligação pela API)
 *   checked      → conferido pelo financeiro (fatura confirmada)
 */
const PROJECTS = [
  {
    code: "OBR-2026-001",
    name: "Edifício Residencial Talatona",
    location: "Talatona, Luanda",
    type: "Edifício residencial",
    director: "Eng.º Paulo Mendes",
    client: "horizonte",
    account: "bfa",
    start: "2026-07-01",
    end: "2027-06-30",
    physical: 50,
    billing: { vat: VAT, withholding: WITHHOLDING, car: 0, guarantee: 5, cativo: 0 },
    tasks: [
      ["01", "Estaleiro e trabalhos preparatórios", 12 * M, 1],
      ["02", "Estrutura de betão armado", 80 * M, 0.65],
      ["03", "Alvenarias e coberturas", 38 * M, 0.4],
      ["04", "Instalações e acabamentos", 70 * M, 20.8 / 70],
    ],
    centers: [
      ["CC01", "Materiais", [["Cimento, agregados e aço", 46.9 * M], ["Blocos, cofragem e diversos", 18 * M]]],
      ["CC02", "Mão de obra", [["Equipa própria (12 meses)", 40 * M]]],
      ["CC03", "Equipamentos", [["Aluguer de grua, betoneiras e combustível", 22 * M]]],
      ["CC04", "Subempreitadas", [["Instalações eléctricas e hidráulicas", 25 * M]]],
    ],
    costs: [
      { date: "2026-07-05", cc: "CC01", sup: "cimentos", cat: "MATERIAL", desc: "Cimento e agregados — 1ª fase", base: 9.5 * M, pay: "bank", checked: true, doc: "FT CS/2026/0712" },
      { date: "2026-07-20", cc: "CC01", sup: "aco", cat: "MATERIAL", desc: "Aço A500 — sapatas e pilares", base: 14 * M, pay: "bank", checked: true, doc: "FT AA/2026/1188" },
      { date: "2026-08-18", cc: "CC01", sup: "cimentos", cat: "MATERIAL", desc: "Blocos e argamassa", base: 7.2 * M, pay: "bank", checked: false, doc: null },
      { date: "2026-09-25", cc: "CC01", sup: "cimentos", cat: "MATERIAL", desc: "Cofragem e madeiras", base: 4.8 * M, pay: "bank", checked: true, doc: "FT CS/2026/0981" },
      { date: "2026-07-31", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários da equipa — julho", base: 5.5 * M, vat: false, pay: "bank", checked: true, doc: "FP 07/2026" },
      { date: "2026-08-31", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários da equipa — agosto", base: 5.5 * M, vat: false, pay: "bank", checked: true, doc: "FP 08/2026" },
      { date: "2026-09-30", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários da equipa — setembro", base: 5.5 * M, vat: false, pay: "bank", checked: true, doc: "FP 09/2026" },
      { date: "2026-10-30", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários da equipa — outubro", base: 5.5 * M, vat: false, pay: "bank", checked: false, doc: "FP 10/2026" },
      { date: "2026-08-10", cc: "CC03", sup: "gruas", cat: "EQUIPAMENTO", desc: "Aluguer de grua — julho/agosto", base: 5 * M, wh: true, pay: "bank", checked: true, doc: "FT EG/2026/0233" },
      { date: "2026-10-09", cc: "CC03", sup: "gruas", cat: "EQUIPAMENTO", desc: "Aluguer de grua — setembro/outubro", base: 5 * M, wh: true, pay: "bank", checked: true, doc: "FT EG/2026/0301" },
      { date: "2026-09-15", cc: "CC04", sup: "inst", cat: "SERVICO", desc: "Instalações eléctricas — 1ª fase", base: 6 * M, wh: true, pay: "bank", checked: true, doc: "FT IM/2026/0077" },
      { date: "2026-10-28", due: "2026-11-27", cc: "CC01", sup: "aco", cat: "MATERIAL", desc: "Aço A500 — lajes do 2º piso", base: 6.5 * M, pay: "credit", checked: false, doc: "FT AA/2026/1402" },
      { date: "2026-10-30", due: "2026-11-29", cc: "CC04", sup: "inst", cat: "SERVICO", desc: "Instalações eléctricas — 2ª fase", base: 4 * M, wh: true, pay: "credit", checked: false, doc: "FT IM/2026/0091" },
      { date: "2026-09-25", due: "2026-10-25", cc: "CC01", sup: "transp", cat: "TRANSPORTE", desc: "Transporte de materiais — setembro", base: 1.2 * M, pay: "credit", checked: false, doc: "FT TR/2026/0450" },
    ],
    // Pagamentos lidos do extrato e associados pela Tesouraria (custo criado a partir do movimento).
    bankCosts: [
      {
        date: "2026-10-12", cc: "CC03", text: "TRF P/ COMBUSTIVEIS DO BENGO LDA", doc: "FT CB/2026/5521", confirm: true,
        items: [{ desc: "Gasóleo — geradores e máquinas (outubro)", sup: "comb", cat: "EQUIPAMENTO", amount: 1_140_000 }],
      },
    ],
    // Levantamentos ATM no cartão de despesas: discriminados (items) ou por discriminar.
    atm: [
      {
        date: "2026-10-18", amount: 600 * k, text: "LEV ATM TALATONA CARTAO 0123", cc: "CC01",
        items: [
          { desc: "Refeições da equipa — betonagem da laje do 1º piso", cat: "OUTRO", amount: 250 * k },
          { desc: "Pequeno material de obra (pregos, arame, discos)", cat: "MATERIAL", amount: 350 * k },
        ],
      },
    ],
    // Saída no extrato ainda por associar a um custo (tarefa da Tesouraria).
    unassigned: [{ date: "2026-10-30", amount: 1.5 * M, text: "TRF P/ INSTALA MAIS LDA ADIANT 2 FASE", sup: "inst" }],
    extras: [
      { status: "PAGO", date: "2026-09-08", cc: "CC03", desc: "Reparação urgente da betoneira (motor)", supplierName: "Oficina Mecânica do Kikolo", amount: 850 * k, source: "CAIXA" },
    ],
    transactions: [
      { status: "PAID", date: "2026-07-03", cc: "CC01", category: "DESPESAS_OPERACIONAIS", desc: "Licença de obra e taxas municipais", amount: 1.8 * M, supplier: "Administração Municipal de Talatona" },
    ],
    orders: [
      { number: "REQ-20261020-0901", status: "APROVADO", cc: "CC04", sup: "alum", desc: "Caixilharia de alumínio — fachada principal", items: [["Janela de correr 1,50 × 1,20 m", 38, 190 * k], ["Porta de varanda 0,90 × 2,10 m", 12, 190 * k]], date: "2026-10-20" },
    ],
    reports: [
      ["AM-01", "2026-07-10", 30 * M],
      ["AM-02", "2026-08-28", 25 * M],
      ["AM-03", "2026-09-26", 22 * M],
      ["AM-04", "2026-10-16", 15 * M],
      ["AM-05", "2026-10-31", 5 * M],
    ],
    invoices: [
      { doc: "FT HZ 2026/095", kind: "ADIANTAMENTO", date: "2026-07-02", due: "2026-07-17", gross: 20 * M, pct: { guarantee: 0 }, events: [["receipt", "rest", "2026-07-14"]], notes: "Adiantamento de 10% do contrato" },
      { doc: "FT HZ 2026/101", date: "2026-07-15", due: "2026-08-14", gross: 30 * M, am: "AM-01", amort: 3 * M, events: [["receipt", "rest", "2026-08-12"]] },
      { doc: "FT HZ 2026/112", date: "2026-08-31", due: "2026-09-30", gross: 25 * M, am: "AM-02", amort: 2.5 * M, events: [["receipt", "rest", "2026-10-02"]] },
      {
        doc: "FT HZ 2026/128", date: "2026-09-30", due: "2026-10-30", gross: 22 * M, am: "AM-03", amort: 2.2 * M,
        events: [["nc", "NC HZ 2026/007", "2026-10-15", 2 * M, "Correção de quantidades do AM-03 (alvenarias medidas em duplicado)"], ["receipt", 12 * M, "2026-10-28"]],
      },
      { doc: "FT HZ 2026/135", date: "2026-10-20", due: "2026-11-19", gross: 15 * M, am: "AM-04", amort: 1.5 * M, events: [] },
    ],
    releases: [],
    // Mercadoria comprada para o armazém central e consumida pelas obras.
    stock: {
      cc: "CC01", sup: "cimentos", qty: 600, date: "2026-08-01", doc: "FT CS/2026/0790",
      exits: [
        ["OBR-2026-001", "EXIT", 300, "2026-08-20", true],
        ["OBR-2026-002", "EXIT", 100, "2026-09-10", true],
        ["OBR-2026-001", "EXIT", 150, "2026-10-05", false],
        ["OBR-2026-001", "LOSS", 6, "2026-10-06", false],
      ],
    },
  },
  {
    code: "OBR-2026-002",
    name: "Reabilitação do Hospital Municipal do Cazenga",
    location: "Cazenga, Luanda",
    type: "Reabilitação — equipamento de saúde",
    director: "Eng.ª Marta Kiala",
    client: "gpl",
    account: "bai",
    start: "2026-06-01",
    end: "2027-12-31",
    physical: 35,
    billing: { vat: VAT, withholding: WITHHOLDING, car: 0.5, guarantee: 5, cativo: 100 },
    tasks: [
      ["01", "Demolições e estaleiro", 30 * M, 1],
      ["02", "Reforço estrutural", 110 * M, 0.55],
      ["03", "Redes técnicas (eléctrica, AVAC, gases medicinais)", 130 * M, 0.12],
      ["04", "Acabamentos e equipamento fixo", 80 * M, 0.06],
    ],
    centers: [
      ["CC01", "Materiais", [["Betão, aço e reforço estrutural", 85 * M], ["Materiais de acabamento", 40 * M]]],
      ["CC02", "Mão de obra", [["Equipa própria (18 meses)", 70 * M]]],
      ["CC03", "Subempreitadas", [["Redes técnicas e AVAC", 85 * M]]],
      ["CC04", "Equipamentos", [["Gerador, andaimes e equipamento de estaleiro", 25 * M]]],
    ],
    costs: [
      { date: "2026-06-20", cc: "CC01", sup: "transp", cat: "TRANSPORTE", desc: "Demolições — contentores e transporte a vazadouro", base: 6 * M, pay: "bank", checked: true, doc: "FT TR/2026/0312" },
      { date: "2026-07-15", cc: "CC01", sup: "aco", cat: "MATERIAL", desc: "Aço e chapas de reforço — fase 1", base: 22 * M, pay: "bank", checked: true, doc: "FT AA/2026/1201" },
      { date: "2026-08-28", cc: "CC01", sup: "cimentos", cat: "MATERIAL", desc: "Betão e grout de reforço", base: 14 * M, pay: "bank", checked: true, doc: "FT CS/2026/0901" },
      { date: "2026-06-30", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários — junho", base: 6.5 * M, vat: false, pay: "bank", checked: true, doc: "FP 06/2026" },
      { date: "2026-07-31", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários — julho", base: 6.5 * M, vat: false, pay: "bank", checked: true, doc: "FP 07/2026" },
      { date: "2026-08-31", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários — agosto", base: 6.5 * M, vat: false, pay: "bank", checked: true, doc: "FP 08/2026" },
      { date: "2026-09-30", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários — setembro", base: 6.5 * M, vat: false, pay: "bank", checked: true, doc: "FP 09/2026" },
      { date: "2026-10-30", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários — outubro", base: 6.5 * M, vat: false, pay: "bank", checked: true, doc: "FP 10/2026" },
      { date: "2026-09-20", due: "2026-10-05", paid: "2026-10-06", cc: "CC03", sup: "avac", cat: "SERVICO", desc: "AVAC — condutas do bloco A", base: 9 * M, wh: true, pay: "settle", checked: true, doc: "FT CT/2026/0144" },
      { date: "2026-10-21", due: "2026-11-20", cc: "CC03", sup: "avac", cat: "SERVICO", desc: "AVAC — unidades de tratamento de ar", base: 12 * M, wh: true, pay: "credit", checked: false, doc: "FT CT/2026/0170" },
      { date: "2026-10-12", due: "2026-11-10", cc: "CC01", sup: "aco", cat: "MATERIAL", desc: "Aço de reforço — fase 2", base: 8 * M, pay: "credit", checked: false, doc: "FT AA/2026/1455" },
    ],
    bankCosts: [],
    atm: [{ date: "2026-10-22", amount: 300 * k, text: "LEV ATM CAZENGA CARTAO 0123" }],
    unassigned: [],
    extras: [
      { status: "APROVADO", date: "2026-11-12", cc: "CC04", desc: "Aluguer de gerador de emergência — novembro", supplierName: "Energia Móvel, Lda", amount: 1.2 * M, source: "SOLICITACAO_TRANSFERENCIA" },
    ],
    transactions: [
      { status: "PENDING", date: "2026-11-15", cc: "CC04", category: "DESPESAS_OPERACIONAIS", desc: "Seguro de obra (todos os riscos) — 2º semestre", amount: 2.4 * M, supplier: "Seguradora Kwanza" },
    ],
    orders: [
      { number: "REQ-20261028-0902", status: "PENDENTE_APROVACAO", cc: "CC04", sup: null, supplierName: "A cotar", desc: "Grupo gerador 250 kVA para o bloco operatório", items: [["Grupo gerador 250 kVA insonorizado", 1, 18 * M]], date: "2026-10-28" },
    ],
    reports: [
      ["AM-01", "2026-07-25", 20 * M],
      ["AM-02", "2026-08-20", 45 * M],
      ["AM-03", "2026-09-30", 38 * M],
      ["AM-04", "2026-10-30", 12 * M],
    ],
    invoices: [
      // Vencida: o cliente já transferiu (entrada no extrato), falta ligar o recebimento.
      { doc: "FT GP 2026/109", date: "2026-08-05", due: "2026-09-04", gross: 20 * M, am: "AM-01", events: [], bankUnlinked: "2026-11-02" },
      { doc: "FT GP 2026/118", date: "2026-08-25", due: "2026-09-24", gross: 45 * M, am: "AM-02", events: [["receipt", "rest", "2026-10-30"]] },
      { doc: "FT GP 2026/131", date: "2026-10-05", due: "2026-11-04", gross: 38 * M, am: "AM-03", events: [["receipt", 15 * M, "2026-11-03"]] },
    ],
    releases: [],
  },
  {
    code: "OBR-2026-003",
    name: "Armazém Logístico de Viana",
    location: "Viana, Luanda",
    type: "Armazém industrial",
    director: "Eng.º Hélder Santos",
    client: "atlantico",
    account: "bfa",
    status: "COMPLETED",
    start: "2026-01-15",
    end: "2026-09-30",
    physical: 100,
    billing: { vat: VAT, withholding: WITHHOLDING, car: 0, guarantee: 5, cativo: 50 },
    tasks: [
      ["01", "Movimento de terras e fundações", 28 * M, 1],
      ["02", "Estrutura metálica e cobertura", 52 * M, 1],
      ["03", "Pavimento industrial e redes", 40 * M, 1],
    ],
    centers: [
      ["CC01", "Materiais", [["Estrutura metálica, chapa e betão", 58 * M]]],
      ["CC02", "Mão de obra", [["Equipa própria (8 meses)", 22 * M]]],
      ["CC03", "Equipamentos", [["Gruas e plataformas elevatórias", 16 * M]]],
    ],
    costs: [
      { date: "2026-01-30", cc: "CC01", sup: "cimentos", cat: "MATERIAL", desc: "Betão de fundações", base: 11 * M, pay: "bank", checked: true, doc: "FT CS/2026/0105" },
      { date: "2026-03-10", cc: "CC01", sup: "aco", cat: "MATERIAL", desc: "Estrutura metálica", base: 26 * M, pay: "bank", checked: true, doc: "FT AA/2026/0350" },
      { date: "2026-05-12", cc: "CC01", sup: "alum", cat: "MATERIAL", desc: "Chapa de cobertura e fachada", base: 12 * M, pay: "bank", checked: true, doc: "FT AK/2026/0081" },
      { date: "2026-07-08", cc: "CC01", sup: "cimentos", cat: "MATERIAL", desc: "Pavimento industrial", base: 9.5 * M, pay: "bank", checked: true, doc: "FT CS/2026/0688" },
      { date: "2026-03-31", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários — 1º trimestre", base: 8 * M, vat: false, pay: "bank", checked: true, doc: "FP T1/2026" },
      { date: "2026-06-30", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários — 2º trimestre", base: 8 * M, vat: false, pay: "bank", checked: true, doc: "FP T2/2026" },
      { date: "2026-09-30", cc: "CC02", cat: "MAO_DE_OBRA", desc: "Salários — 3º trimestre", base: 6 * M, vat: false, pay: "bank", checked: true, doc: "FP T3/2026" },
      { date: "2026-04-20", cc: "CC03", sup: "gruas", cat: "EQUIPAMENTO", desc: "Grua móvel — montagem da estrutura", base: 9 * M, wh: true, pay: "bank", checked: true, doc: "FT EG/2026/0102" },
      { date: "2026-07-20", cc: "CC03", sup: "gruas", cat: "EQUIPAMENTO", desc: "Plataformas elevatórias", base: 4.5 * M, wh: true, pay: "bank", checked: true, doc: "FT EG/2026/0190" },
    ],
    bankCosts: [],
    atm: [],
    unassigned: [],
    extras: [],
    transactions: [],
    orders: [],
    reports: [
      ["AM-01", "2026-03-15", 40 * M],
      ["AM-02", "2026-05-15", 45 * M],
      ["AM-03", "2026-07-10", 35 * M],
    ],
    invoices: [
      { doc: "FT LA 2026/031", date: "2026-03-20", due: "2026-04-19", gross: 40 * M, am: "AM-01", events: [["receipt", "rest", "2026-04-15"]] },
      { doc: "FT LA 2026/058", date: "2026-05-20", due: "2026-06-19", gross: 45 * M, am: "AM-02", events: [["receipt", "rest", "2026-06-18"]] },
      {
        doc: "FT LA 2026/079", date: "2026-07-15", due: "2026-08-14", gross: 35 * M, am: "AM-03",
        events: [["nc", "NC LA 2026/004", "2026-07-25", 1.5 * M, "Desconto comercial acordado na receção provisória"], ["receipt", "rest", "2026-08-10"]],
      },
    ],
    // Receção provisória: devolução de 50% das garantias retidas.
    releases: [[0.5, "2026-10-15", "Receção provisória — devolução de 50% da garantia"]],
  },
];

// Custos de estrutura (sede, frota): fora das obras, entram no resultado operacional.
const GENERAL_COSTS = [
  { status: "PAGO", date: "2026-10-05", center: "gcc_sede_escritorios", desc: "Renda da sede — outubro 2026", supplierName: "Edifício Kianda Business Center", amount: 2.5 * M },
  { status: "PAGO", date: "2026-09-22", center: "gcc_manutencao_frota", desc: "Revisão da frota — 3 viaturas de obra", supplierName: "Auto Serviço Morro Bento", amount: 780 * k },
  { status: "APROVADO", date: "2026-11-05", center: "gcc_sede_escritorios", desc: "Renda da sede — novembro 2026", supplierName: "Edifício Kianda Business Center", amount: 2.5 * M },
];

// Carregamento do cartão de despesas (CAIXA) a partir da conta principal (BFA).
const INTERNAL_TRANSFERS = [{ date: "2026-10-15", from: "bfa", to: "caixa", amount: 1.5 * M }];

const ACCOUNTS = { bfa: "BFA", bai: "BAI", caixa: "CAIXA" };
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/* ─── Limpeza ────────────────────────────────────────────────────────────── */

async function clean() {
  const codes = PROJECTS.map((p) => p.code);
  const projects = await prisma.project.findMany({ where: { code: { in: codes } }, select: { id: true, name: true } });
  const ids = projects.map((p) => p.id);

  const invoices = await prisma.invoice.findMany({ where: { projectId: { in: ids } }, select: { id: true } });
  const invoiceIds = invoices.map((i) => i.id);
  await prisma.invoiceReceipt.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  // Notas de crédito primeiro (apontam para as faturas que corrigem).
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds }, kind: "NOTA_CREDITO" } });
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await prisma.guaranteeRelease.deleteMany({ where: { projectId: { in: ids } } });

  // Extratos da demonstração (e os saldos que fixaram).
  const statements = (await prisma.bankStatement.findMany({ select: { id: true, fileName: true } })).filter((s) =>
    STATEMENT_FILE.test(s.fileName || "")
  );
  const stIds = statements.map((s) => s.id);
  await prisma.bankBalance.deleteMany({ where: { statementId: { in: stIds } } });
  await prisma.bankMovement.deleteMany({ where: { statementId: { in: stIds } } });
  await prisma.bankStatement.deleteMany({ where: { id: { in: stIds } } });

  // Stock da mercadoria de demonstração.
  const product = await prisma.product.findUnique({ where: { sku: PRODUCT.sku } });
  if (product) {
    await prisma.stockMovement.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  }

  const orderNumbers = PROJECTS.flatMap((p) => p.orders.map((o) => o.number));
  await prisma.purchaseOrder.deleteMany({ where: { number: { in: orderNumbers } } });
  await prisma.extraRequest.deleteMany({ where: { type: "GERAL", description: { in: GENERAL_COSTS.map((g) => g.desc) } } });
  // Pedidos extra das obras: a obra é SetNull, não apagam em cascata (também os que ficaram órfãos).
  await prisma.extraRequest.deleteMany({
    where: {
      type: "OBRA",
      OR: [
        { projectId: { in: ids } },
        { projectId: null, description: { in: PROJECTS.flatMap((p) => p.extras.map((e) => e.desc)) } },
      ],
    },
  });

  const nifs = Object.values(SUPPLIERS).map((s) => s[2]);
  const suppliers = await prisma.supplier.findMany({ where: { nif: { in: nifs } }, select: { id: true } });
  await prisma.freightOrder.deleteMany({ where: { supplierId: { in: suppliers.map((s) => s.id) } } });

  if (ids.length) await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.warehouse.deleteMany({
    where: { type: "SITE", projectId: null, name: { in: PROJECTS.map((p) => `Estaleiro: ${p.name}`) } },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((s) => s.id) } } });
  await prisma.client.deleteMany({ where: { code: { in: Object.values(CLIENTS).map((c) => c.code) } } });
  console.log(`Demonstração removida (${ids.length} obras, ${stIds.length} extratos).`);
}

/* ─── Criação ────────────────────────────────────────────────────────────── */

/**
 * Movimentos de extrato planeados: cada um diz a conta, o sentido, o tipo e o
 * que fazer depois de importado (ligar a um custo, a um recebimento…).
 */
const planned = [];
function plan(account, m) {
  planned.push({ account, ...m });
}

async function seedProject(token, spec, ctx) {
  const { clients, suppliers, user } = ctx;
  const client = clients[spec.client];
  const b = spec.billing;
  const project = await prisma.project.create({
    data: {
      code: spec.code,
      name: spec.name,
      location: spec.location,
      region: "Luanda",
      projectType: spec.type,
      directorObra: spec.director,
      clientId: client.id,
      currency: "AOA",
      status: spec.status || "ACTIVE",
      startDate: d(spec.start),
      dueDate: d(spec.end),
      actualEndDate: spec.status === "COMPLETED" ? d(spec.end) : null,
      physicalProgressPct: spec.physical,
      budgetTotal: 0,
      budgetAllocated: 0,
      budgetConsumed: 0,
      budgetCommitted: 0,
      budgetAvailable: 0,
      billingVatPercent: b.vat,
      billingWithholdingPercent: b.withholding,
      billingCarPercent: b.car,
      billingGuaranteePercent: b.guarantee,
      billingVatCativo: b.cativo > 0,
      billingVatCativoPercent: b.cativo,
      // Como na criação pela plataforma: cada obra tem o seu estaleiro.
      warehouses: { create: { name: `Estaleiro: ${spec.name}`, type: "SITE", visibleToClient: true } },
    },
  });
  ctx.projects[spec.code] = project;

  // Venda prevista: tabela de quantidades.
  for (const [i, [code, description, total, executed]] of spec.tasks.entries()) {
    await prisma.projectProgressTask.create({
      data: {
        projectId: project.id,
        wbsCode: code,
        order: i,
        description,
        expectedQty: 1,
        executedQty: executed,
        unit: "vg",
        unitValue: total,
        totalValue: total,
      },
    });
  }

  // Orçamento de custo: necessidades aprovadas por centro de custo.
  const centers = {};
  for (const [code, name, needs] of spec.centers) {
    const cc = await prisma.costCenter.create({ data: { projectId: project.id, code, name, requiresQuotation: false } });
    centers[code] = cc;
    for (const [description, value] of needs) {
      await prisma.workNeed.create({
        data: {
          projectId: project.id,
          costCenterId: cc.id,
          description,
          quantity: 1,
          unit: "vg",
          unitPrice: value,
          originalUnitPrice: value,
          status: "APPROVED",
          responsible: spec.director,
        },
      });
    }
  }
  ctx.centers[spec.code] = centers;

  // Custos registados no centro de pagamentos.
  for (const c of spec.costs) {
    const f = fiscal(c.base, { vat: c.vat !== false, wh: Boolean(c.wh) });
    const s = c.sup ? suppliers[c.sup] : null;
    const paidNow = c.pay === "bank";
    const cost = await prisma.costPayment.create({
      data: {
        projectId: project.id,
        costCenterId: centers[c.cc].id,
        supplierId: s?.id || null,
        supplier: s?.name || null,
        docNumber: c.doc,
        // Pago: data do pagamento; a crédito: data de vencimento.
        paymentDate: d(paidNow ? c.date : c.due),
        category: c.cat,
        description: c.desc,
        budgetedAmount: f.budgetedAmount,
        paidAmount: paidNow ? f.cash : 0,
        grossAmount: f.grossAmount,
        vatAmount: f.vatAmount,
        withholdingAmount: f.withholdingAmount,
        netAmount: f.netAmount,
        fiscalApplyVat: f.fiscalApplyVat,
        fiscalApplyWithholding: f.fiscalApplyWithholding,
        fiscalInputMode: f.fiscalInputMode,
        paymentMethod: paidNow ? "Transferência bancária" : null,
        paymentType: paidNow ? "PRONTO_PAGAMENTO" : "CREDITO",
        status: paidNow ? "CONFIRMADO" : "PENDENTE",
        confirmedAt: paidNow ? d(c.date) : null,
        confirmationStatus: c.checked && paidNow ? "CONFIRMADO" : "POR_CONFIRMAR",
        responsible: spec.director,
        sourceType: "MANUAL",
        notes: c.pay === "bank" ? null : `Fatura de ${c.date.split("-").reverse().join("/")} a 30 dias`,
      },
    });
    if (c.pay === "bank" || c.pay === "settle") {
      const salary = c.cat === "MAO_DE_OBRA";
      plan(spec.account, {
        date: c.pay === "settle" ? c.paid : c.date,
        direction: "SAIDA",
        type: salary ? "OUTRO" : "PF",
        amount: f.cash,
        projectId: project.id,
        supplierId: s?.id || null,
        docNumber: c.doc,
        text: salary
          ? `PROC SALARIAL ${c.desc.split("— ")[1].toUpperCase()} ${spec.code}`
          : `TRF P/ ${s.name.toUpperCase().replace(/[,.]/g, "")} ${c.doc}`,
        after: { link: cost.id, confirm: c.pay === "settle" && c.checked },
      });
    }
  }

  // Pagamentos lidos do extrato: o custo nasce da associação na Tesouraria.
  for (const bc of spec.bankCosts) {
    const amount = r2(bc.items.reduce((a, i) => a + i.amount, 0));
    plan(spec.account, {
      date: bc.date,
      direction: "SAIDA",
      type: "PF",
      amount,
      projectId: project.id,
      docNumber: bc.doc,
      text: `${bc.text} ${bc.doc}`,
      after: { create: { cc: centers[bc.cc].id, projectId: project.id, docNumber: bc.doc, confirm: bc.confirm, items: bc.items } },
    });
  }
  for (const a of spec.atm) {
    plan("caixa", {
      date: a.date,
      direction: "SAIDA",
      type: "LEVANTAMENTO_ATM",
      amount: a.amount,
      projectId: project.id,
      text: a.text,
      after: a.items ? { create: { cc: centers[a.cc].id, projectId: project.id, confirm: false, items: a.items } } : null,
    });
  }
  for (const u of spec.unassigned) {
    plan(spec.account, {
      date: u.date,
      direction: "SAIDA",
      type: "PF",
      amount: u.amount,
      projectId: project.id,
      supplierId: suppliers[u.sup]?.id || null,
      text: u.text,
    });
  }

  // Pedidos extra da obra.
  for (const e of spec.extras) {
    const paid = e.status === "PAGO";
    await prisma.extraRequest.create({
      data: {
        type: "OBRA",
        projectId: project.id,
        costCenterId: centers[e.cc].id,
        description: e.desc,
        amount: e.amount,
        paymentSource: e.source,
        status: e.status,
        requestedBy: spec.director,
        requestedAt: d(paid ? e.date : TODAY),
        requiresQuote: false,
        paymentDueDate: d(e.date),
        approvedBy: "Direção Financeira",
        approvedAt: d(paid ? e.date : TODAY),
        paidBy: paid ? "Direção Financeira" : null,
        paidAt: paid ? d(e.date) : null,
        supplierName: e.supplierName,
      },
    });
  }

  // Lançamentos da obra (despesas diretas).
  for (const t of spec.transactions) {
    await prisma.projectTransaction.create({
      data: {
        projectId: project.id,
        costCenterId: centers[t.cc].id,
        date: d(t.date),
        description: t.desc,
        category: t.category,
        status: t.status,
        amount: t.amount,
        realizedAmount: t.status === "PAID" ? t.amount : null,
        supplier: t.supplier,
        currency: "AOA",
      },
    });
  }

  // Encomendas (pedidos de compra) ainda em curso: compromisso da obra.
  for (const o of spec.orders) {
    const total = o.items.reduce((a, [, q, p]) => a + q * p, 0);
    const s = o.sup ? suppliers[o.sup] : null;
    await prisma.purchaseOrder.create({
      data: {
        number: o.number,
        type: "PEDIDO",
        status: o.status,
        requestedByName: spec.director,
        description: o.desc,
        needDate: d(o.date),
        totalValue: total,
        supplierId: s?.id || null,
        supplierName: s?.name || o.supplierName || null,
        projectId: project.id,
        costCenterId: centers[o.cc].id,
        createdAt: d(o.date),
        items: { create: o.items.map(([name, quantity, unitPrice], i) => ({ name, quantity, unit: "un", unitPrice, totalPrice: quantity * unitPrice, order: i })) },
      },
    });
  }

  // Autos de medição aprovados.
  const reports = {};
  for (const [reportNumber, date, value] of spec.reports) {
    reports[reportNumber] = await prisma.measurementReport.create({
      data: {
        projectId: project.id,
        reportNumber,
        reportDate: d(date),
        status: "APPROVED",
        approvedBy: "Fiscalização",
        approvedAt: d(date),
        periodValTotal: value,
        notes: `Auto de medição ${reportNumber}`,
      },
    });
  }

  // Faturas e notas de crédito (pela API). Os recebimentos ficam planeados:
  // entram no extrato e são ligados depois de importado.
  for (const inv of spec.invoices) {
    let { invoice } = await api(token, "POST", "/finance/invoices", {
      projectId: project.id,
      clientId: client.id,
      kind: inv.kind || "FATURA",
      measurementId: inv.am ? reports[inv.am].id : null,
      docNumber: inv.doc,
      docDate: inv.date,
      dueDate: inv.due,
      grossAmount: inv.gross,
      advanceDeductionAmount: inv.amort || null,
      ...(inv.pct?.guarantee !== undefined ? { guaranteePercent: inv.pct.guarantee } : {}),
      notes: inv.notes || (inv.am ? `Faturação do ${inv.am}` : null),
    });
    let missing = Number(invoice.missingAmount);
    for (const event of inv.events) {
      if (event[0] === "nc") {
        const [, docNumber, docDate, grossAmount, notes] = event;
        ({ invoice } = await api(token, "POST", `/finance/invoices/${invoice.id}/credit-notes`, { docNumber, docDate, grossAmount, notes }));
        missing = Number(invoice.missingAmount);
      } else {
        const [, value, receivedDate] = event;
        const amount = r2(value === "rest" ? missing : value);
        missing = r2(missing - amount);
        plan(spec.account, {
          date: receivedDate,
          direction: "ENTRADA",
          type: "RECEBIMENTO_CLIENTE",
          amount,
          projectId: project.id,
          docNumber: inv.doc,
          text: `TRF DE ${client.name.toUpperCase().replace(/[,.—]/g, "").replace(/\s+/g, " ")} PAG ${inv.doc}`,
          after: { receipt: { invoiceId: invoice.id, amount, receivedDate } },
        });
      }
    }
    if (inv.bankUnlinked) {
      plan(spec.account, {
        date: inv.bankUnlinked,
        direction: "ENTRADA",
        type: "RECEBIMENTO_CLIENTE",
        amount: missing,
        projectId: project.id,
        text: `TRF DE ${client.name.toUpperCase().replace(/[,.—]/g, "").replace(/\s+/g, " ")} REF ${inv.am}`,
      });
    }
  }

  // Devolução de garantia: entra no extrato e regista-se pela API.
  if (spec.releases.length) {
    const { totals } = await api(token, "GET", `/finance/guarantees?projectId=${project.id}`);
    for (const [fraction, releasedDate, notes] of spec.releases) {
      const amount = r2(totals.retained * fraction);
      plan(spec.account, {
        date: releasedDate,
        direction: "ENTRADA",
        type: "OUTRO",
        amount,
        projectId: project.id,
        text: `TRF DE ${client.name.toUpperCase().replace(/[,.—]/g, "")} DEVOL GARANTIA`,
        after: { release: { projectId: project.id, amount, releasedDate, notes } },
      });
    }
  }
}

/** Mercadoria: compra para o armazém central (fica em stock) e saídas para as obras. */
async function seedStock(spec, ctx) {
  const st = spec.stock;
  const project = ctx.projects[spec.code];
  const cc = ctx.centers[spec.code][st.cc];
  const supplier = ctx.suppliers[st.sup];
  const central = await prisma.warehouse.findFirst({ where: { type: "CENTRAL", active: true }, orderBy: { createdAt: "asc" } });
  const product = await prisma.product.create({
    data: { sku: PRODUCT.sku, name: PRODUCT.name, category: "MATERIAL", unit: "UN", minStock: 50 },
  });
  const base = st.qty * PRODUCT.unitPrice;
  const f = fiscal(base);
  const need = await prisma.workNeed.create({
    data: {
      projectId: project.id,
      costCenterId: cc.id,
      date: d(st.date),
      description: `${PRODUCT.name} — compra para o armazém central`,
      quantity: st.qty,
      unit: "un",
      unitPrice: PRODUCT.unitPrice,
      originalUnitPrice: PRODUCT.unitPrice,
      status: "PAID",
      responsible: spec.director,
    },
  });
  const quote = await prisma.needQuote.create({
    data: {
      needId: need.id,
      supplierId: supplier.id,
      quotedPrice: PRODUCT.unitPrice,
      quantity: st.qty,
      totalValue: base,
      netTotal: base,
      vatAmount: f.vatAmount,
      fiscalApplyVat: true,
      vatPercent: VAT,
      selected: true,
      deliveryStatus: "RECEBIDO",
      receivedAt: d(st.date),
      invoiceConfirmedAt: d(st.date),
      invoiceConfirmedBy: "Direção Financeira",
    },
  });
  const cost = await prisma.costPayment.create({
    data: {
      projectId: project.id,
      costCenterId: cc.id,
      needId: need.id,
      supplierId: supplier.id,
      supplier: supplier.name,
      docNumber: st.doc,
      paymentDate: d(st.date),
      category: "MATERIAL",
      description: `${PRODUCT.name} × ${st.qty} (stock)`,
      budgetedAmount: base,
      paidAmount: f.cash,
      grossAmount: f.grossAmount,
      vatAmount: f.vatAmount,
      netAmount: f.netAmount,
      fiscalApplyVat: true,
      fiscalInputMode: "base",
      paymentMethod: "Transferência bancária",
      paymentType: "PRONTO_PAGAMENTO",
      status: "CONFIRMADO",
      confirmedAt: d(st.date),
      confirmationStatus: "CONFIRMADO",
      responsible: spec.director,
      sourceType: "MERCADORIA_STOCK",
    },
  });
  plan(spec.account, {
    date: st.date,
    direction: "SAIDA",
    type: "PF",
    amount: f.cash,
    supplierId: supplier.id,
    docNumber: st.doc,
    merchandise: true,
    text: `TRF P/ ${supplier.name.toUpperCase().replace(/[,.]/g, "")} ${st.doc}`,
    after: { merchLink: cost.id },
  });

  await prisma.stockMovement.create({
    data: {
      type: "ENTRY",
      quantity: st.qty,
      productId: product.id,
      warehouseId: central.id,
      userId: ctx.user.id,
      sourceQuoteId: quote.id,
      reference: st.doc,
      notes: `Receção da encomenda a ${supplier.name}`,
      createdAt: d(st.date),
    },
  });
  let left = st.qty;
  for (const [code, type, qty, date, confirmed] of st.exits) {
    left -= qty;
    await prisma.stockMovement.create({
      data: {
        type,
        quantity: qty,
        productId: product.id,
        warehouseId: central.id,
        projectId: ctx.projects[code].id,
        userId: ctx.user.id,
        reference: type === "LOSS" ? "Sacos danificados pela chuva" : `Guia de saída para ${code}`,
        notes: type === "LOSS" ? "Perda registada no armazém" : null,
        costDocNumber: confirmed ? st.doc : null,
        costConfirmedAt: confirmed ? d(date) : null,
        costConfirmedBy: confirmed ? "Direção Financeira" : null,
        createdAt: d(date),
      },
    });
  }
  await prisma.warehouseStock.create({ data: { warehouseId: central.id, productId: product.id, quantity: left } });
}

/** Frete por enviar ao financeiro, repartido por duas obras. */
async function seedFreight(ctx) {
  const allocations = [
    ["OBR-2026-001", "CC01", "Transporte de cimento Luanda → Talatona", 650 * k],
    ["OBR-2026-002", "CC01", "Transporte de cimento Luanda → Cazenga", 400 * k],
  ];
  await prisma.freightOrder.create({
    data: {
      supplierId: ctx.suppliers.transp.id,
      totalAmount: allocations.reduce((a, x) => a + x[3], 0),
      status: "PENDENTE",
      notes: "Frete do cimento do armazém central para as obras",
      createdBy: "Logística",
      allocations: {
        create: allocations.map(([code, cc, description, amount]) => ({
          projectId: ctx.projects[code].id,
          costCenterId: ctx.centers[code][cc].id,
          description,
          amount,
        })),
      },
    },
  });
}

async function seedGeneralCosts() {
  for (const g of GENERAL_COSTS) {
    const paid = g.status === "PAGO";
    await prisma.extraRequest.create({
      data: {
        type: "GERAL",
        generalCostCenterId: g.center,
        description: g.desc,
        amount: g.amount,
        paymentSource: "SOLICITACAO_TRANSFERENCIA",
        status: g.status,
        requestedBy: "Direção Financeira",
        requestedAt: d(paid ? g.date : TODAY),
        requiresQuote: false,
        paymentDueDate: d(g.date),
        approvedBy: "Administração",
        approvedAt: d(paid ? g.date : TODAY),
        paidBy: paid ? "Direção Financeira" : null,
        paidAt: paid ? d(g.date) : null,
        supplierName: g.supplierName,
      },
    });
  }
}

/** Extratos mensais por conta, com saldo inicial/final encadeados. */
async function seedStatements(token, ctx) {
  for (const t of INTERNAL_TRANSFERS) {
    plan(t.from, { date: t.date, direction: "SAIDA", type: "TRANSFERENCIA_INTERNA", amount: t.amount, text: `TRF INTERNA P/ CARTAO ${ACCOUNTS[t.to]} CARREGAMENTO` });
    plan(t.to, { date: t.date, direction: "ENTRADA", type: "TRANSFERENCIA_INTERNA", amount: t.amount, text: `TRF INTERNA DE CONTA ${ACCOUNTS[t.from]} CARREGAMENTO` });
  }
  const results = [];
  for (const [key, bank] of Object.entries(ACCOUNTS)) {
    const card = ctx.cards[key];
    const moves = planned.filter((m) => m.account === key).sort((a, b) => a.date.localeCompare(b.date) || (a.direction === "ENTRADA" ? -1 : 1));
    if (!moves.length) continue;
    // Saldo inicial: o necessário para a conta nunca ficar negativa, com folga.
    let run = 0;
    let min = 0;
    moves.forEach((m) => {
      run += m.direction === "ENTRADA" ? m.amount : -m.amount;
      min = Math.min(min, run);
    });
    let balance = Math.ceil((-min + 15 * M) / (5 * M)) * 5 * M;
    if (key === "caixa") balance = 250 * k;

    const first = moves[0].date.slice(0, 7);
    const last = TODAY.slice(0, 7);
    for (let ym = first; ym <= last; ym = nextMonth(ym)) {
      const [y, mo] = ym.split("-").map(Number);
      const monthMoves = moves.filter((m) => m.date.startsWith(ym));
      const periodEnd = ym === last ? prevDay(TODAY) : lastDay(ym);
      const opening = balance;
      monthMoves.forEach((m) => {
        balance = r2(balance + (m.direction === "ENTRADA" ? m.amount : -m.amount));
      });
      const { statement } = await api(token, "POST", "/finance/bank-statements", {
        cardId: card.id,
        name: `${bank} — ${MONTHS[mo - 1]} ${y}${ym === last ? ` (até ${periodEnd.slice(8)}/${periodEnd.slice(5, 7)})` : ""}`,
        periodStart: `${ym}-01`,
        periodEnd,
        openingBalance: opening,
        closingBalance: balance,
        fileName: `extrato_${bank}_${ym}.pdf`,
        movements: monthMoves.map((m) => ({
          projectId: m.projectId || null,
          docNumber: m.docNumber || null,
          docType: m.docNumber && /^FT /.test(m.docNumber) && m.direction === "SAIDA" ? "FATURA" : null,
          supplierId: m.supplierId || null,
          movementType: m.type,
          direction: m.direction,
          amount: m.amount,
          movementDate: m.date,
          description: m.text,
          isMerchandise: Boolean(m.merchandise),
        })),
      });
      // Liga cada movimento planeado ao criado (descrição + valor + data).
      const used = new Set();
      monthMoves.forEach((m) => {
        const created = statement.movements.find(
          (c) => !used.has(c.id) && c.description === m.text && Math.abs(Number(c.amount) - m.amount) < 0.01 && c.movementDate.slice(0, 10) === m.date
        );
        if (!created) throw new Error(`Movimento não encontrado: ${m.text}`);
        used.add(created.id);
        m.movementId = created.id;
      });
      results.push(`${bank} ${ym}: ${monthMoves.length} mov., saldo ${opening.toLocaleString("pt-PT")} → ${balance.toLocaleString("pt-PT")}`);
    }
  }
  return results;
}

async function reconcile(token, ctx) {
  // Por data: um recebimento só pode ser ligado depois da NC que o precede, etc.
  const todo = planned.filter((m) => m.after).sort((a, b) => a.date.localeCompare(b.date));
  for (const m of todo) {
    const a = m.after;
    if (a.link) {
      await api(token, "POST", `/finance/bank-movements/${m.movementId}/assign-cost`, { mode: "LINK", linkCostId: a.link, confirm: a.confirm || undefined });
    } else if (a.create) {
      await api(token, "POST", `/finance/bank-movements/${m.movementId}/assign-cost`, {
        mode: "CREATE",
        projectId: a.create.projectId,
        costCenterId: a.create.cc,
        docType: a.create.docNumber ? "FATURA" : null,
        docNumber: a.create.docNumber || null,
        confirm: a.create.confirm,
        items: a.create.items.map((i) => ({
          description: i.desc,
          supplierId: i.sup ? ctx.suppliers[i.sup].id : null,
          category: i.cat,
          amount: i.amount,
        })),
      });
    } else if (a.receipt) {
      await api(token, "POST", `/finance/invoices/${a.receipt.invoiceId}/receipts`, {
        amount: a.receipt.amount,
        receivedDate: a.receipt.receivedDate,
        method: "Transferência bancária",
        bankMovementId: m.movementId,
      });
    } else if (a.release) {
      await api(token, "POST", `/finance/projects/${a.release.projectId}/guarantee-releases`, {
        amount: a.release.amount,
        releasedDate: a.release.releasedDate,
        method: "Transferência bancária",
        notes: a.release.notes,
      });
    } else if (a.merchLink) {
      // Compra de mercadoria: o movimento fica identificado, o custo vem do consumo.
      await prisma.costPayment.update({ where: { id: a.merchLink }, data: { bankMovementId: m.movementId } });
    }
  }
}

function nextMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function lastDay(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
function prevDay(iso) {
  const t = d(iso);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

async function seed() {
  if (await prisma.project.findFirst({ where: { code: { in: PROJECTS.map((p) => p.code) } } })) {
    throw new Error("A demonstração já existe: corra «clean» primeiro.");
  }
  const user = (await prisma.user.findFirst({ where: { role: "financeiro" } })) || (await prisma.user.findFirst());
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: "ADMIN", clientId: null },
    config.jwtSecret,
    { expiresIn: "30m" }
  );

  const cards = {};
  for (const [key, bank] of Object.entries(ACCOUNTS)) {
    cards[key] = await prisma.pettyCashCard.findFirst({ where: { bank, active: true } });
    if (!cards[key]) throw new Error(`Conta/cartão ${bank} não encontrado.`);
  }

  const clients = {};
  for (const [key, c] of Object.entries(CLIENTS)) {
    clients[key] = await prisma.client.create({
      data: { code: c.code, name: c.name, region: c.region, ltvTotal: 0, churnRisk: 0, ltvPotential: 0 },
    });
  }
  const suppliers = {};
  for (const [key, [name, type, nif]] of Object.entries(SUPPLIERS)) {
    suppliers[key] = await prisma.supplier.create({ data: { name, type, nif, vatPercent: VAT } });
  }
  const ctx = { user, clients, suppliers, cards, projects: {}, centers: {} };

  console.log("A criar a carteira de demonstração…");
  for (const spec of PROJECTS) {
    await seedProject(token, spec, ctx);
    console.log(`  ✓ ${spec.code} ${spec.name}`);
  }
  for (const spec of PROJECTS) if (spec.stock) await seedStock(spec, ctx);
  await seedFreight(ctx);
  await seedGeneralCosts();
  console.log("  ✓ stock, frete e custos de estrutura");
  const statements = await seedStatements(token, ctx);
  statements.forEach((s) => console.log(`    ${s}`));
  await reconcile(token, ctx);
  console.log("  ✓ extratos importados e reconciliados");
  console.log("Carteira de demonstração criada.");
}

const mode = process.argv[2];
(mode === "clean" ? clean() : mode === "seed" ? seed() : Promise.reject(new Error("Uso: seed | clean")))
  .catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
