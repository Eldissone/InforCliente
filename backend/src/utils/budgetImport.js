const path = require("path");
const XLSX = require("xlsx");

function normalizeHeader(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w_]/g, "");
}

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseBudgetSheet(buffer, originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return { lines: [], warnings: ["Planilha vazia."] };

  const ws = wb.Sheets[firstSheet];
  // Convertemos para matriz de arrays para detectar onde o header começa
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  if (!data.length) return { lines: [], warnings: ["Nenhuma linha encontrada."] };

  // Heurística para encontrar a linha de cabeçalho (procura palavras-chave nas primeiras 20 linhas)
  let headerIndex = -1;
  const keywords = ["descrição", "descricao", "item", "designação", "total", "valor", "preco", "preço", "importe"];

  for (let i = 0; i < Math.min(data.length, 20); i++) {
    const row = data[i].map(c => normalizeHeader(String(c)));
    const hasKeywords = row.some(cell => keywords.includes(cell) || keywords.some(k => cell.includes(k)));
    if (hasKeywords) {
      headerIndex = i;
      break;
    }
  }

  // Se não encontrou cabeçalho claro, assume a linha 0
  const startIndex = headerIndex === -1 ? 0 : headerIndex;
  const headers = data[startIndex].map(h => normalizeHeader(String(h)));
  const rows = data.slice(startIndex + 1);

  const warnings = [];
  const lines = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const map = new Map();
    headers.forEach((h, idx) => {
      if (h) map.set(h, r[idx]);
    });

    const description =
      map.get("description") ||
      map.get("descricao") ||
      map.get("designacao") ||
      map.get("item") ||
      map.get("name") ||
      map.get("servico") ||
      map.get("produto");

    const totalStr =
      map.get("total") ||
      map.get("valor_total") ||
      map.get("valor") ||
      map.get("importe") ||
      map.get("total_geral") ||
      map.get("preco_total") ||
      map.get("preço_total");

    const total = toNumber(totalStr);

    if (!String(description || "").trim()) continue; // ignora linhas vazias
    if (total === null) {
      // Pequeno log de aviso se tiver descrição mas sem valor
      if (description) {
        warnings.push(`Linha ${startIndex + i + 2}: Valor não identificado na coluna 'Total/Valor'.`);
      }
      continue;
    }

    const quantity = toNumber(map.get("quantity") ?? map.get("quantidade") ?? map.get("qtd") ?? map.get("unid"));
    const unitPrice = toNumber(map.get("unit_price") ?? map.get("preco_unitario") ?? map.get("valor_unitario") ?? map.get("preco"));

    lines.push({
      rowNumber: startIndex + i + 2,
      sourceFile: originalName || null,
      category: String(map.get("category") ?? map.get("categoria") ?? "").trim() || null,
      description: String(description).trim(),
      unit: String(map.get("unit") ?? map.get("unidade") ?? "").trim() || null,
      quantity: quantity === null ? null : quantity,
      unitPrice: unitPrice === null ? null : unitPrice,
      total,
    });
  }

  if (!lines.length) {
    warnings.push(
      "Nenhuma linha válida foi importada. O sistema procurou por colunas como 'Descrição/Item' e 'Total/Valor'."
    );
  }

  return { lines, warnings };
}

module.exports = { parseBudgetSheet };

