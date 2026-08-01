/** Visualização estilo cartão físico — BAI, BFA, Caixa Angola. */

const BANK_KEYS = {
  BAI: "BAI",
  BFA: "BFA",
  CAIXA: "CAIXA",
};

export const BANK_OPTIONS = [
  { value: "BAI", label: "BAI — Banco Angolano de Investimentos" },
  { value: "BFA", label: "BFA — Banco de Fomento Angola" },
  { value: "CAIXA", label: "Caixa Angola" },
  { value: "", label: "Outro / genérico" },
];

export function normalizeBankKey(bank) {
  const raw = String(bank || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (!raw) return "";
  if (raw.includes("bai")) return BANK_KEYS.BAI;
  if (raw.includes("bfa") || raw.includes("fomento")) return BANK_KEYS.BFA;
  if (raw.includes("caixa")) return BANK_KEYS.CAIXA;
  return "";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCardNumberGroups(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "0000 0000 0000 0000";
  const padded = digits.padStart(16, "0").slice(-16);
  return padded.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function parseCardNumberInput(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { cardNumberMasked: null, lastDigits: null };
  const digits = trimmed.replace(/\D/g, "");
  const lastDigits = digits.length ? digits.slice(-4).padStart(4, "0") : null;
  return { cardNumberMasked: trimmed, lastDigits };
}

export function displayCardNumber(card) {
  const masked = String(card?.cardNumberMasked || "").trim();
  if (masked) {
    const d = masked.replace(/\D/g, "");
    if (d.length >= 16) return formatCardNumberGroups(d);
    if (d.length >= 4) return `•••• •••• •••• ${d.slice(-4)}`;
    if (d.length > 0) return masked;
  }
  const last = String(card?.lastDigits || "").replace(/\D/g, "").slice(-4);
  if (last) return `•••• •••• •••• ${last.padStart(4, "0")}`;
  return "0000 0000 0000 0000";
}

export function displayExpiry(card) {
  const exp = card?.expiresAt;
  if (!exp) return "MM/AA";
  const d = new Date(exp);
  if (Number.isNaN(d.getTime())) return "MM/AA";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${yy}`;
}

function cardTypeLabel(type) {
  const map = { PREPAGO: "pré-pago", DEBITO: "débito", CREDITO: "crédito" };
  return map[type] || "débito";
}

function brandBlock(bankKey, bankRaw) {
  if (bankKey === BANK_KEYS.BAI) {
    return `<div class="debit-card__brand debit-card__brand--bai">
      <span class="debit-card__logo-mark" aria-hidden="true"></span>
      <span class="debit-card__logo-text">BAI</span>
    </div>`;
  }
  if (bankKey === BANK_KEYS.BFA) {
    return `<div class="debit-card__brand debit-card__brand--bfa">
      <span class="debit-card__logo-mark debit-card__logo-mark--bfa" aria-hidden="true"></span>
      <span class="debit-card__logo-text debit-card__logo-text--serif">BFA</span>
    </div>`;
  }
  if (bankKey === BANK_KEYS.CAIXA) {
    return `<div class="debit-card__brand debit-card__brand--caixa">
      <span class="debit-card__logo-mark debit-card__logo-mark--caixa" aria-hidden="true"></span>
      <span class="debit-card__logo-text debit-card__logo-text--caixa">Caixa Angola</span>
    </div>`;
  }
  const name = escapeHtml(bankRaw || "Cartão");
  return `<div class="debit-card__brand debit-card__brand--generic">
    <span class="debit-card__logo-text">${name}</span>
  </div>`;
}

function expiryLabelHtml(bankKey) {
  if (bankKey === BANK_KEYS.BAI) {
    return `<span class="debit-card__exp-label">EXPIRES END</span>`;
  }
  return `<span class="debit-card__exp-label debit-card__exp-label--stack"><span>VÁLIDO ATÉ</span><span>VALID THRU</span></span>`;
}

/**
 * @param {object} card
 * @param {{ active?: boolean, balanceHtml?: string, scopeBadgeHtml?: string, compact?: boolean }} [opts]
 */
export function renderBankCardHtml(card, opts = {}) {
  const bankKey = normalizeBankKey(card?.bank);
  const bankRaw = card?.bank || "";
  const themeClass = bankKey ? `debit-card--${bankKey.toLowerCase()}` : "debit-card--generic";
  const holder = escapeHtml(
    (card?.holderName || card?.label || "NOME APELIDO").toUpperCase().slice(0, 26)
  );
  const number = escapeHtml(displayCardNumber(card));
  const expiry = escapeHtml(displayExpiry(card));
  const typeLbl = escapeHtml(cardTypeLabel(card?.type));
  const activeClass = opts.active ? " debit-card-wrap--active" : "";
  const compactClass = opts.compact ? " debit-card--compact" : "";
  const asButton = opts.asButton !== false;

  const footerBits = [opts.scopeBadgeHtml, opts.balanceHtml].filter(Boolean).join("");
  const footer = footerBits
    ? `<div class="debit-card__app-meta">${footerBits}</div>`
    : "";

  const baiDisclaimer =
    bankKey === BANK_KEYS.BAI
      ? `<p class="debit-card__disclaimer">ELECTRONIC USE ONLY</p>`
      : "";

  const inner = `<div class="debit-card ${themeClass}${compactClass}" aria-label="Cartão ${escapeHtml(card.label || "")}">
      <div class="debit-card__decor" aria-hidden="true"></div>
      <div class="debit-card__top">
        ${brandBlock(bankKey, bankRaw)}
        <div class="debit-card__type-block">
          <span class="debit-card__type-icon" aria-hidden="true"></span>
          <span class="debit-card__type-label">${typeLbl}</span>
        </div>
      </div>
      <div class="debit-card__chip" aria-hidden="true"></div>
      <p class="debit-card__number">${number}</p>
      <div class="debit-card__expiry">
        ${expiryLabelHtml(bankKey)}
        <span class="debit-card__exp-value">${expiry}</span>
      </div>
      <p class="debit-card__holder">${holder}</p>
      ${baiDisclaimer}
      ${footer}
    </div>`;

  if (!asButton) {
    return `<div class="debit-card-wrap${activeClass} debit-card-wrap--static">${inner}</div>`;
  }

  return `<button type="button" class="debit-card-wrap${activeClass}" data-card-id="${escapeHtml(card.id)}">${inner}</button>`;
}

/** Converte input type="month" (YYYY-MM) para ISO date (1.º dia do mês). */
export function monthInputToExpiresAt(value) {
  const v = String(value || "").trim();
  if (!/^\d{4}-\d{2}$/.test(v)) return null;
  return `${v}-01T12:00:00.000Z`;
}

/** Para preencher input type="month" a partir de expiresAt. */
export function expiresAtToMonthInput(expiresAt) {
  if (!expiresAt) return "";
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}`;
}
