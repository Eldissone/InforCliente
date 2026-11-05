/**
 * Campos de dinheiro da área financeira.
 *
 * O utilizador vê o valor formatado enquanto escreve («1 234 567,89»), com
 * vírgula decimal e espaço nos milhares (pt-PT, como o resto da aplicação).
 * Aceita colar «1.234.567,89», «1,234,567.89» ou «1234567.89».
 *
 *   <input class="finance-input" data-money />            → só positivos
 *   <input class="finance-input" data-money="signed" />   → aceita negativos (saldos)
 *
 *   bindMoneyInputs(panel)  liga todos os [data-money] dentro de `panel`
 *   readMoney(input)        → número (ou null se vazio/inválido)
 *   setMoney(input, value)  escreve um número já formatado
 */

const GROUP = " ";
const DECIMAL = ",";
const DECIMALS = 2;

/** Separa a parte inteira e a decimal de um texto livre. */
function splitNumber(text) {
  const raw = String(text ?? "");
  const negative = /^\s*-/.test(raw);
  const s = raw.replace(/[^\d.,]/g, "");
  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;

  let decimalAt = -1;
  if (commas && dots) {
    // Os dois presentes: o último é o separador decimal.
    decimalAt = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  } else if (commas === 1) {
    decimalAt = s.indexOf(",");
  } else if (dots === 1) {
    // «1.500» em pt é mil e quinhentos; «1.5» ou «1.50» é decimal.
    const after = s.length - s.indexOf(".") - 1;
    if (after !== 3) decimalAt = s.indexOf(".");
  }
  // Separador repetido (ex.: 1.234.567) = milhares.

  const int = (decimalAt >= 0 ? s.slice(0, decimalAt) : s).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const dec = decimalAt >= 0 ? s.slice(decimalAt + 1).replace(/\D/g, "").slice(0, DECIMALS) : null;
  return { negative, int, dec };
}

function groupThousands(int) {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
}

function compose({ negative, int, dec }, signed) {
  if (!int && dec === null) return negative && signed ? "-" : "";
  const sign = negative && signed ? "-" : "";
  return `${sign}${groupThousands(int || "0")}${dec !== null ? DECIMAL + dec : ""}`;
}

/** Número a partir do texto do campo (null se vazio). */
export function parseMoney(text) {
  const parts = splitNumber(text);
  if (!parts.int && !parts.dec) return null;
  const n = Number(`${parts.int || "0"}.${parts.dec || "0"}`);
  if (!Number.isFinite(n)) return null;
  return parts.negative ? -n : n;
}

/** Texto formatado de um número (2 casas), para preencher um campo. */
export function formatMoneyValue(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return "";
  const [int, dec] = Math.abs(n).toFixed(DECIMALS).split(".");
  return `${n < 0 ? "-" : ""}${groupThousands(int)}${DECIMAL}${dec}`;
}

export function readMoney(input) {
  if (!input) return null;
  const n = parseMoney(input.value);
  if (n === null) return null;
  return input.dataset.money === "signed" ? n : Math.abs(n);
}

export function setMoney(input, value) {
  if (input) input.value = formatMoneyValue(value);
}

/** Quantos dígitos (e separador decimal) existem antes da posição `pos`. */
function significantBefore(text, pos) {
  return text.slice(0, pos).replace(/[^\d,.-]/g, "").length;
}

function caretFor(text, count) {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (/[\d,-]/.test(text[i])) seen += 1;
    if (seen >= count) return i + 1;
  }
  return text.length;
}

function onInput(e) {
  const input = e.target;
  const signed = input.dataset.money === "signed";
  const before = input.value;
  const caret = input.selectionStart ?? before.length;
  const count = significantBefore(before, caret);
  const formatted = compose(splitNumber(before), signed);
  if (formatted === before) return;
  input.value = formatted;
  // Dígitos removidos antes do cursor (zeros à esquerda, casas a mais) não contam.
  const pos = caretFor(formatted, Math.min(count, formatted.replace(/[^\d,-]/g, "").length));
  try {
    input.setSelectionRange(pos, pos);
  } catch {
    /* campo sem seleção (ex.: oculto) */
  }
}

/** Apagar sobre um separador de milhares apaga o dígito ao lado (como num editor). */
function onBeforeInput(e) {
  const input = e.target;
  const start = input.selectionStart;
  if (start === null || start !== input.selectionEnd) return;
  if (e.inputType === "deleteContentBackward" && input.value[start - 1] === GROUP) {
    input.setSelectionRange(start - 1, start - 1);
  } else if (e.inputType === "deleteContentForward" && input.value[start] === GROUP) {
    input.setSelectionRange(start + 1, start + 1);
  }
}

function onBlur(e) {
  const input = e.target;
  const n = readMoney(input);
  input.value = n === null ? "" : formatMoneyValue(n);
}

/** Liga a formatação a todos os campos [data-money] dentro de `root`. */
export function bindMoneyInputs(root = document) {
  root.querySelectorAll("input[data-money]").forEach((input) => {
    if (input.dataset.moneyBound) return;
    input.dataset.moneyBound = "1";
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.addEventListener("beforeinput", onBeforeInput);
    input.addEventListener("input", onInput);
    input.addEventListener("blur", onBlur);
    if (input.value) input.value = formatMoneyValue(parseMoney(input.value));
  });
}
