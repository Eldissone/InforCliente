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

/**
 * Espera colunas (qualquer uma serve):
 * - description | descricao | item | name
 * - total | valor_total | valor | total_geral
 * Opcionais: category, unit, quantity, unit_price
 */
function parseBudgetSheet(buffer, originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  const wb =
    ext === ".csv"
      ? XLSX.read(buffer, { type: "buffer", raw: true })
      : XLSX.read(buffer, { type: "buffer" });

  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return { lines: [], warnings: ["Planilha vazia."] };

  const ws = wb.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });

  if (!rows.length) return { lines: [], warnings: ["Nenhuma linha encontrada."] };

  // Detect headers by normalizing first row keys (sheet_to_json already uses headers from first row)
  const warnings = [];
  const lines = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const entries = Object.entries(r);
    const map = new Map(entries.map(([k, v]) => [normalizeHeader(k), v]));

    const description =
      map.get("description") ||
      map.get("descricao") ||
      map.get("item") ||
      map.get("name") ||
      map.get("servico") ||
      map.get("produto");

    const total =
      toNumber(map.get("total")) ??
      toNumber(map.get("valor_total")) ??
      toNumber(map.get("valor")) ??
      toNumber(map.get("total_geral"));

    if (!String(description || "").trim()) continue; // ignora linhas vazias
    if (total === null) {
      warnings.push(`Linha ${i + 2}: sem total numérico (coluna total/valor_total/valor).`);
      continue;
    }

    const quantity = toNumber(map.get("quantity") ?? map.get("quantidade") ?? map.get("qtd"));
    const unitPrice = toNumber(map.get("unit_price") ?? map.get("preco_unitario") ?? map.get("valor_unitario"));

    lines.push({
      rowNumber: i + 2, // considerando header na linha 1
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
      "Nenhuma linha válida foi importada. Confirme se existe uma coluna de descrição e uma coluna de total (valor)."
    );
  }

  return { lines, warnings };
}

module.exports = { parseBudgetSheet };

