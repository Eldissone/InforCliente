/**
 * R4 Conta Corrente de Clientes — quanto cada cliente deve, e há quanto tempo.
 *
 * Segue o `ccCli` do protótipo (prototipo.html):
 *
 *  - por fatura, o **em aberto** é o valor da fatura menos o recebido;
 *  - o que um cliente pagou **a mais** numa fatura abate as outras dele,
 *    começando pela que vence primeiro — é dinheiro dele que a MBT tem;
 *  - o que sobrar depois disso é **crédito do cliente** (saldo negativo);
 *  - a antiguidade conta-se pelo vencimento: a vencer, 1–30, 31–60, 61–90 e
 *    mais de 90 dias; sem vencimento fica à parte.
 *
 * O valor de cada fatura é o líquido do documento (`netAmount`) — o que o
 * cliente tem de pagar depois da retenção, da caução e do seguro —, que é o
 * que o resto da Área Financeira já usa para o «em falta».
 *
 * Uma moeda de cada vez (por omissão, kwanzas, como no protótipo): somar
 * dívidas em moedas diferentes dava um número sem sentido. A resposta diz que
 * outras moedas há, para o ecrã as oferecer.
 *
 * O que a app ainda não tem e o protótipo tem: notas de crédito. Uma fatura
 * anulada no protótipo sai do saldo por uma NC; aqui não há essa figura.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;
const EPS = 0.5;

function dayKey(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const diasEntre = (de, ate) => Math.round((new Date(`${ate}T00:00:00Z`) - new Date(`${de}T00:00:00Z`)) / DAY_MS);

/** Antiguidade dos valores em aberto. `I`: `[{ ab, venc }]`. */
function aging(I, hoje) {
  const a = { av: 0, sd: 0, b1: 0, b2: 0, b3: 0, b4: 0 };
  for (const x of I) {
    if (!x.venc) {
      a.sd += x.ab;
      continue;
    }
    const n = diasEntre(x.venc, hoje);
    if (n <= 0) a.av += x.ab;
    else if (n <= 30) a.b1 += x.ab;
    else if (n <= 60) a.b2 += x.ab;
    else if (n <= 90) a.b3 += x.ab;
    else a.b4 += x.ab;
  }
  a.atr = a.b1 + a.b2 + a.b3 + a.b4;
  for (const k of Object.keys(a)) a[k] = round2(a[k]);
  return a;
}

const chaveCliente = (inv) => inv.client?.id || `nome:${inv.client?.name || "—"}`;
const moedaDe = (inv) => String(inv.currency || inv.project?.currency || "AOA").toUpperCase();

/**
 * Contas correntes de todos os clientes.
 *
 * @param {Array} invoices `{ id, docNumber, docDate, due, net, received,
 *   client: { id, name }, project: { code, name, currency }, receipts:
 *   [{ amount, receivedDate }] }` — `due` é o vencimento efetivo
 * @param {string} hoje AAAA-MM-DD
 * @param {string} [moeda] a moeda a mostrar (AOA por omissão)
 */
function buildClientAccounts(invoices, hoje, moeda = "AOA") {
  const porCliente = new Map();
  const M = String(moeda || "AOA").toUpperCase();
  const moedas = new Set();

  for (const inv of invoices || []) {
    moedas.add(moedaDe(inv));
    if (moedaDe(inv) !== M) continue;
    const k = chaveCliente(inv);
    if (!porCliente.has(k)) {
      porCliente.set(k, { id: inv.client?.id || null, nome: inv.client?.name || "—", X: [] });
    }
    porCliente.get(k).X.push(inv);
  }

  const clientes = [...porCliente.values()].map((c) => {
    let fat = 0;
    let rec = 0;
    let ult = null;
    let pool = 0;
    const I = [];

    for (const inv of c.X) {
      const v = N(inv.net);
      const r = N(inv.received);
      fat += v;
      const ab = v - r;
      if (ab > EPS) I.push({ ab, venc: dayKey(inv.due), id: inv.id });
      else if (ab < -EPS) pool += -ab;
      for (const p of inv.receipts || []) {
        rec += N(p.amount);
        const d = dayKey(p.receivedDate);
        if (d && (!ult || d > ult)) ult = d;
      }
    }

    // O recebido a mais abate o que vence primeiro.
    if (pool > EPS) {
      for (const i of [...I].sort((a, b) => (a.venc || "9").localeCompare(b.venc || "9"))) {
        if (pool <= EPS) break;
        const u = Math.min(pool, i.ab);
        i.ab -= u;
        pool -= u;
      }
    }

    const abertos = I.filter((i) => i.ab > EPS);
    const fav = pool > EPS ? pool : 0;
    return {
      id: c.id,
      nome: c.nome,
      faturas: c.X.length,
      fat: round2(fat),
      rec: round2(rec),
      ult,
      ag: aging(abertos, hoje),
      fav: round2(fav),
      saldo: round2(abertos.reduce((s, i) => s + i.ab, 0) - fav),
      abertas: abertos.length,
    };
  });

  clientes.sort((a, b) => b.saldo - a.saldo || a.nome.localeCompare(b.nome, "pt"));

  const soma = (f) => round2(clientes.reduce((s, c) => s + f(c), 0));
  const totais = {
    porReceber: soma((c) => Math.max(0, c.saldo)),
    emAtraso: soma((c) => c.ag.atr),
    mais90: soma((c) => c.ag.b4),
    credito: soma((c) => Math.max(0, -c.saldo)),
    comSaldo: clientes.filter((c) => c.saldo > EPS).length,
    comAtraso: clientes.filter((c) => c.ag.atr > EPS).length,
    com90: clientes.filter((c) => c.ag.b4 > EPS).length,
    comCredito: clientes.filter((c) => c.saldo < -EPS).length,
  };

  return { moeda: M, moedas: [...moedas].sort(), clientes, totais };
}

/**
 * Extrato de um cliente: faturas a débito, recebimentos a crédito, por data,
 * com o saldo corrido e a situação de cada fatura.
 */
function clientStatement(invoices, clienteId, hoje, moeda = "AOA") {
  const M = String(moeda || "AOA").toUpperCase();
  const X = (invoices || []).filter(
    (inv) => moedaDe(inv) === M && (inv.client?.id || `nome:${inv.client?.name || "—"}`) === clienteId
  );
  const L = [];
  for (const inv of X) {
    const v = N(inv.net);
    const ab = v - N(inv.received);
    const venc = dayKey(inv.due);
    let situacao = "liquidada";
    let atraso = 0;
    if (ab > EPS) {
      atraso = venc ? diasEntre(venc, hoje) : 0;
      situacao = atraso > 0 ? "atraso" : "aberto";
    }
    L.push({
      data: dayKey(inv.docDate),
      tipo: "FT",
      doc: inv.docNumber || "Fatura",
      obra: inv.project?.code || "",
      descricao: inv.measurement?.reportNumber ? `Auto de medição ${inv.measurement.reportNumber}` : "Fatura",
      venc,
      situacao,
      atraso: Math.max(0, atraso),
      emAberto: round2(Math.max(0, ab)),
      deb: round2(v),
      cred: 0,
      faturaId: inv.id,
    });
    for (const p of inv.receipts || []) {
      L.push({
        data: dayKey(p.receivedDate),
        tipo: "RC",
        doc: p.method ? `Recebimento · ${p.method}` : "Recebimento",
        obra: inv.docNumber || "",
        descricao: "Recebimento",
        venc: null,
        situacao: null,
        deb: 0,
        cred: round2(p.amount),
        faturaId: inv.id,
      });
    }
  }
  L.sort((a, b) => (a.data || "").localeCompare(b.data || "") || b.deb - a.deb);
  let s = 0;
  for (const l of L) {
    s += l.deb - l.cred;
    l.saldo = round2(s);
  }
  return L;
}

module.exports = { buildClientAccounts, clientStatement, aging };
