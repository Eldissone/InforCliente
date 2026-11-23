/**
 * Calendário Financeiro — o que há a pagar e a receber, pela data em que vence.
 *
 * É o ecrã F1 do protótipo (prototipo.html, `agdView`); o P2 «Calendário de
 * Pagamentos» e o R2 «Calendário de Recebimentos» são o mesmo calendário só de
 * um lado. No protótipo substituiu quatro ecrãs (Vencimentos, Mapa de
 * Obrigações, Previsão e Mapa de Recebimentos), por isso aqui também não se
 * criam fontes novas: junta-se o que a Área Financeira já sabe.
 *
 *  - **A pagar** — as contas a pagar do razão de custos (`buildPayables`), pela
 *    data de vencimento. Os compromissos (pedidos aprovados que ainda não são
 *    dívida) entram marcados como tal.
 *  - **A receber** — as faturas com valor em falta (`buildReceivables`), pelo
 *    vencimento efetivo. Sem vencimento registado vale o do documento mais o
 *    prazo padrão, e a linha fica marcada como estimada — como no resto da
 *    Área Financeira.
 *  - **Previstos** — autos de medição aprovados que ainda não têm fatura: é o
 *    dinheiro que se espera mas ainda não foi pedido ao cliente. A data é a do
 *    auto mais o mesmo prazo padrão, e é sempre estimada.
 *
 * Tudo sai numa lista só, com a mesma forma, para o ecrã agrupar por mês ou
 * por semana sem ter de saber de onde veio cada linha.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;

/** AAAA-MM-DD de uma data, ou `null`. */
function dayKey(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function addDays(key, days) {
  if (!key) return null;
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

const nomeObra = (p) => (p ? [p.code, p.name].filter(Boolean).join(" · ") : "");

/**
 * Estado de uma linha, como no protótipo:
 * `atr` em atraso · `pp` pago/recebido em parte · `abe` em aberto ·
 * `comp` compromisso (ainda não é dívida) · `prev` previsto.
 */
function estadoDe({ data, hoje, parcial, compromisso }) {
  if (compromisso) return "comp";
  if (data && data < hoje) return "atr";
  if (parcial) return "pp";
  return "abe";
}

/** Contas a pagar → linhas do calendário. */
function fromPayables(items, hoje) {
  return (items || [])
    .filter((p) => N(p.payable) > 0.005)
    .map((p) => {
      const data = dayKey(p.dueDate);
      return {
        id: `P:${p.id}`,
        lado: "P",
        data,
        estimada: false,
        valor: round2(p.payable),
        moeda: p.currency || "AOA",
        // Sem fornecedor nem beneficiário, diz-se que falta. O cliente da obra
        // não serve de recurso: é quem paga à MBT, não quem recebe dela.
        entidade: p.beneficiary || p.supplier || "Sem beneficiário",
        doc: [p.docNumber, p.shortDescription || p.description].filter(Boolean).join(" · "),
        sub: nomeObra(p.project) || p.costCenter?.name || "",
        grupo: p.sourceLabel || "Outros",
        estado: estadoDe({
          data,
          hoje,
          parcial: N(p.paidAmount) > 0.005,
          compromisso: p.stage === "COMPROMISSO",
        }),
        link: "/Financeiro/centro-pagamentos",
      };
    });
}

/** Faturas por receber → linhas do calendário. */
function fromReceivables(items, hoje) {
  return (items || [])
    .filter((i) => N(i.missingAmount) > 0.005)
    .map((i) => {
      const data = dayKey(i.effectiveDue || i.effectiveDueDate || i.dueDate);
      const auto = i.measurement?.reportNumber ? `AM ${i.measurement.reportNumber}` : null;
      return {
        id: `R:${i.id}`,
        lado: "R",
        data,
        estimada: Boolean(i.noDueDate ?? i.dueEstimated),
        valor: round2(i.missingAmount),
        moeda: i.project?.currency || "AOA",
        entidade: i.client?.name || i.project?.client?.name || "—",
        doc: [i.docNumber ? `Fatura ${i.docNumber}` : "Fatura", auto].filter(Boolean).join(" · "),
        sub: nomeObra(i.project),
        grupo: "Faturas emitidas",
        estado: estadoDe({ data, hoje, parcial: N(i.receivedAmount) > 0.005 }),
        link: "/Financeiro/faturacao/registar",
      };
    });
}

/**
 * Autos aprovados sem fatura → linhas previstas.
 *
 * @param {Array} reports `{ id, reportNumber, reportDate, periodValTotal,
 *   project: { code, name, currency, client: { name } } }`
 * @param {string} hoje AAAA-MM-DD
 * @param {number} prazoDias prazo padrão de recebimento
 */
function fromOpenMeasurements(reports, hoje, prazoDias) {
  return (reports || [])
    .filter((r) => N(r.periodValTotal) > 0.005)
    .map((r) => ({
      id: `A:${r.id}`,
      lado: "R",
      data: addDays(dayKey(r.reportDate), prazoDias),
      estimada: true,
      valor: round2(r.periodValTotal),
      moeda: r.project?.currency || "AOA",
      entidade: r.project?.client?.name || "—",
      doc: `Previsto · AM ${r.reportNumber}`,
      sub: nomeObra(r.project),
      grupo: "Previstos (autos ainda sem fatura)",
      estado: "prev",
      link: "/Financeiro/autos-medicao",
    }));
}

module.exports = { fromPayables, fromReceivables, fromOpenMeasurements, dayKey, addDays };
