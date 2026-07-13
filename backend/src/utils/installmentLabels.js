const PARCELA_PREFIX_RE = /^Parcela\s+\d+(?:\/\d+)?\s*-\s*/i;

function normalizeInstallmentTotal(total) {
  const n = Number(total);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Só mostrar etiqueta de parcela quando o plano tem mais de uma. */
function shouldShowInstallmentLabel(total) {
  const n = normalizeInstallmentTotal(total);
  return n != null && n > 1;
}

/** Descrição de lançamento com prefixo de parcela apenas se total > 1. */
function buildInstallmentDescription({ installment, total, baseDescription }) {
  const base = String(baseDescription || "").trim() || "Pagamento";
  const totalN = normalizeInstallmentTotal(total) || 1;
  if (totalN <= 1) return base;
  return `Parcela ${installment}/${totalN} - ${base}`;
}

/** Remove prefixo "Parcela X" de descrições antigas com parcela única. */
function stripSingleInstallmentPrefix(description) {
  const text = String(description || "");
  const cleaned = text.replace(PARCELA_PREFIX_RE, "").trim();
  return cleaned || text;
}

function resolveDisplayDescription(description, installmentsPlanned) {
  const text = String(description || "");
  const total = normalizeInstallmentTotal(installmentsPlanned);

  if (total != null) {
    if (shouldShowInstallmentLabel(total)) return text;
    return stripSingleInstallmentPrefix(text) || text;
  }

  // Legado: inferir total a partir de "Parcela X/Y" na descrição
  const match = text.match(/^Parcela\s+(\d+)\/(\d+)\s*-/i);
  if (match) {
    const planned = Number(match[2]);
    if (!Number.isFinite(planned) || planned <= 1) {
      return stripSingleInstallmentPrefix(text) || text;
    }
    return text;
  }

  // Legado: "Parcela 1 -" sem total = parcela única
  if (/^Parcela\s+1\s*-/i.test(text)) {
    return stripSingleInstallmentPrefix(text) || text;
  }

  return text;
}

module.exports = {
  shouldShowInstallmentLabel,
  buildInstallmentDescription,
  stripSingleInstallmentPrefix,
  resolveDisplayDescription,
};
