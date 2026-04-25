const XLSX = require("xlsx");

/** Normaliza cabeçalhos para comparação */
function normalizeHeader(s) {
  if (!s) return "";
  let str = String(s);
  // Fix encoding issues
  str = fixMojibake(str);
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\w_]/g, "");
}

/** Converte valores para número de forma robusta */
function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, "");
  // Se houver pontos e vírgulas, removemos o ponto (assumindo milhar) e trocamos a vírgula por ponto (decimal)
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    // Se houver apenas vírgula, trocamos por ponto
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Corrige caracteres corrompidos (UTF-8 lido como Latin1) */
function fixMojibake(s) {
  if (typeof s !== "string") return s;
  
  let str = s;
  // Tenta correção automática via Buffer se detetar padrão UTF-8
  if (/Ã[\x80-\xBF\xa1-\xbf]/.test(str)) {
    try {
      const fixed = Buffer.from(str, "latin1").toString("utf8");
      if (!fixed.includes("\uFFFD")) str = fixed;
    } catch {}
  }

  // Limpeza manual de resíduos persistentes de codificação errada
  return str
    .replace(/â\+³/g, "³")
    .replace(/Ã³/g, "ó")
    .replace(/Ã¡/g, "á")
    .replace(/Ã©/g, "é")
    .replace(/Ã­/g, "í")
    .replace(/Ãµ/g, "õ")
    .replace(/Ã£/g, "ã")
    .replace(/Ãª/g, "ê")
    .replace(/Ã§/g, "ç")
    .replace(/Âº/g, "º")
    .replace(/Âª/g, "ª");
}

/** Detecta o separador dominante numa linha de texto */
function detectSeparator(line) {
  const counts = {
    ",": (line.match(/,/g) || []).length,
    ";": (line.match(/;/g) || []).length,
    "\t": (line.match(/\t/g) || []).length,
    "|": (line.match(/\|/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** Parse de linha CSV respeitando aspas */
function parseCSVLine(line, sep) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

/** 
 * Função Principal de Importação de Tarefas
 * Adaptada do algoritmo universal para o contexto de ProjectProgressTasks
 */
function parseTaskSheet(buffer, originalName) {
  let data = [];
  const warnings = [];
  const isCSV = originalName.toLowerCase().endsWith(".csv") || originalName.toLowerCase().endsWith(".tsv");

  try {
    if (isCSV) {
      // Tratamento especial para CSV (encoding e separadores)
      let text = buffer.toString("utf8");
      if (text.includes("\uFFFD")) {
        text = buffer.toString("latin1");
        warnings.push("Ficheiro CSV convertido de Latin1 para UTF-8.");
      }
      const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
      if (lines.length === 0) return { tasks: [], warnings: ["CSV vazio."] };
      
      const sep = detectSeparator(lines[0]);
      data = lines.map(l => parseCSVLine(l, sep).map(c => fixMojibake(c.replace(/['"]/g, "").trim())));
    } else {
      // Excel (XLSX/XLS/XLSM)
      const wb = XLSX.read(buffer, { type: "buffer" });
      const sheetName = wb.SheetNames[0]; // Pegamos a primeira aba por padrão
      const ws = wb.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    }
  } catch (err) {
    return { tasks: [], warnings: [`Erro ao processar ficheiro: ${err.message}`] };
  }

  if (!data || data.length === 0) return { tasks: [], warnings: ["Nenhum dado encontrado no ficheiro."] };

  // 1. Deteção do Cabeçalho da Tabela (Fuzzy Search)
  let headerIndex = -1;
  let maxKeywords = -1;
  const keywords = ["item", "desc", "unid", "qtd", "quant", "preco", "valor"];

  for (let i = 0; i < Math.min(data.length, 50); i++) {
    const row = data[i].map(c => normalizeHeader(String(c || "")));
    const matches = row.filter(cell => keywords.some(k => cell !== "" && cell.includes(k))).length;
    // O cabeçalho real deve ter dados depois e pelo menos 2 matches ou muitas colunas
    const filled = row.filter(c => c !== "").length;
    if ((matches > maxKeywords && matches >= 2) || (filled >= 5 && matches > maxKeywords)) {
      maxKeywords = matches;
      headerIndex = i;
    }
    if (matches >= 4) break;
  }

  // Se não encontrar cabeçalho, falha
  if (headerIndex === -1) {
    return { 
      tasks: [], 
      warnings: ["Não foi possível identificar as colunas da tabela (Item, Descrição, etc.).", `Primeiras linhas lidas: ${data.slice(0,3).map(r => r.join("|")).join(" / ")}`] 
    };
  }

  const headers = data[headerIndex].map(h => normalizeHeader(String(h || "")));
  const rows = data.slice(headerIndex + 1);

  // 2. Mapeamento das Colunas Necessárias (Expandido)
  const colMap = {
    item: headers.findIndex(h => h.includes("item") || h === "it" || h === "pos" || h === "no" || h === "n" || h.includes("codigo")),
    description: headers.findIndex(h => 
      h.includes("desc") || h.includes("design") || h.includes("servico") || 
      h.includes("nome") || h === "tarefa" || h.includes("ativid") || h.includes("trabalho")
    ),
    unit: headers.findIndex(h => h.includes("unid") || h === "un" || h.includes("unidade") || h.includes("medida") || h === "um"),
    qty: headers.findIndex(h => h.includes("qtd") || h.includes("quant") || h.includes("vol") || h.includes("qnt") || h === "q"),
    price: headers.findIndex(h => 
      h.includes("preco") || h.includes("valor") || h.includes("unit") || 
      h.includes("akz") || h.includes("usd") || h.includes("custo") || h === "pvp"
    ),
    priceMaterial: headers.findIndex(h => h.includes("material") || h.includes("mat")),
    priceService: headers.findIndex(h => h.includes("servico") || h.includes("mao_de_obra") || h.includes("m_o"))
  };

  // Fallback para descrição
  if (colMap.description === -1) colMap.description = colMap.item === 0 ? 1 : 0;

  const tasks = [];
  const rootTasks = [];
  const taskMap = new Map();
  let currentGroup = "GERAL";

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const itemVal = colMap.item !== -1 ? String(r[colMap.item] || "").trim() : "";
    const descVal = colMap.description !== -1 ? String(r[colMap.description] || "").trim() : "";
    const unitVal = colMap.unit !== -1 ? String(r[colMap.unit] || "").trim() : "";
    const qtyVal = colMap.qty !== -1 ? toNumber(r[colMap.qty]) : 0;
    const priceVal = colMap.price !== -1 ? toNumber(r[colMap.price]) : 0;

    if (!descVal && !itemVal) continue;
    if (normalizeHeader(descVal) === "total" || normalizeHeader(itemVal) === "total") continue;

    const hasData = unitVal !== "" || (qtyVal || 0) > 0 || (priceVal || 0) > 0;
    const isSubItem = itemVal.includes(".") || itemVal.includes(",");
    const isNumericItem = /^\d+$/.test(itemVal);

    // Deteção de Grupo (Header Azul)
    // Se não tem dados e não é um sub-item (ex: 1.1), tratamos como título de grupo/seção
    // Mesmo que seja um item numérico (ex: 1), se não tiver dados, o utilizador provavelmente quer que seja um cabeçalho
    if (!hasData && !isSubItem && descVal) {
      currentGroup = (itemVal ? `${itemVal} - ` : "") + descVal;
      continue;
    }

    if (!descVal) continue;

    const priceMat = colMap.priceMaterial !== -1 ? toNumber(r[colMap.priceMaterial]) : 0;
    const priceServ = colMap.priceService !== -1 ? toNumber(r[colMap.priceService]) : 0;
    const finalPrice = priceVal || (priceMat + priceServ) || 0;

    const task = {
      itemGroup: currentGroup,
      order: tasks.length + 1,
      itemCode: itemVal,
      description: descVal,
      expectedQty: qtyVal || 0,
      unit: (unitVal || "un").toLowerCase().trim().substring(0, 10),
      unitValue: finalPrice,
      unitValueMaterial: priceMat || 0,
      unitValueService: priceServ || 0,
      executedQty: 0,
      subItems: []
    };

    // Lógica de Hierarquia (ex: 1.1 é filho de 1)
    if (itemVal && itemVal.includes(".")) {
      const parts = itemVal.split(/[\.,]/);
      if (parts.length > 1) {
        const parentCode = parts.slice(0, -1).join(".");
        const parent = taskMap.get(parentCode);
        if (parent) {
          parent.subItems.push(task);
          taskMap.set(itemVal, task);
          continue;
        }
      }
    }

    rootTasks.push(task);
    if (itemVal) taskMap.set(itemVal, task);
    tasks.push(task); // Mantemos tasks flat para compatibilidade se necessário, ou retornamos rootTasks
  }

  return { tasks: rootTasks, warnings };
}

module.exports = { parseTaskSheet };
