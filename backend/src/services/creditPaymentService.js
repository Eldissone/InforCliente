// Serviço financeiro centralizado — cálculo do plano de pagamento a crédito.
// Mantido isolado (SRP) para poder ser reutilizado por qualquer módulo que
// precise de gerar parcelas a partir de uma data de referência.

/**
 * Calcula as datas de vencimento de N parcelas mensais a partir da data de
 * receção prevista do material (ou outra data de referência acordada).
 *
 * Exemplo: receção 10/08/2026, 3 parcelas mensais -> 10/09, 10/10, 10/11.
 */
function computeInstallmentDueDates(referenceDate, installmentsCount) {
  const count = Math.max(1, Number(installmentsCount) || 1);
  const base = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);

  const dates = [];
  for (let i = 1; i <= count; i += 1) {
    const due = new Date(base);
    due.setMonth(due.getMonth() + i);
    dates.push(due);
  }
  return dates;
}

/**
 * Distribui o valor total pelas parcelas, garantindo que a soma bate certo
 * com o total (o resto de arredondamento é absorvido pela última parcela).
 */
function splitAmountIntoInstallments(totalAmount, installmentsCount) {
  const count = Math.max(1, Number(installmentsCount) || 1);
  const total = Number(totalAmount) || 0;
  const base = Math.floor((total / count) * 100) / 100;

  const amounts = new Array(count).fill(base);
  const distributed = base * count;
  const remainder = Math.round((total - distributed) * 100) / 100;
  amounts[count - 1] = Math.round((amounts[count - 1] + remainder) * 100) / 100;
  return amounts;
}

/**
 * Gera o plano de parcelas completo (data + valor) para uma encomenda a
 * crédito, a partir da data prevista de receção do material.
 */
function buildInstallmentPlan({ totalAmount, expectedReceiptDate, installmentsCount }) {
  const dueDates = computeInstallmentDueDates(expectedReceiptDate, installmentsCount);
  const amounts = splitAmountIntoInstallments(totalAmount, installmentsCount);

  return dueDates.map((dueDate, index) => ({
    number: index + 1,
    dueDate,
    amount: amounts[index],
  }));
}

module.exports = {
  computeInstallmentDueDates,
  splitAmountIntoInstallments,
  buildInstallmentPlan,
};
