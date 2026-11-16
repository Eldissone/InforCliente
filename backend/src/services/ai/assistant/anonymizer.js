/**
 * Troca nomes por etiquetas estáveis dentro de um pedido ("Fornecedor A",
 * "Pessoa 2"). Os nomes reais nunca saem do servidor; a tabela fica só em
 * memória durante o pedido.
 */
function createAnonymizer() {
  const maps = new Map();
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  function label(kind, name) {
    if (!name) return name;
    if (!maps.has(kind)) maps.set(kind, new Map());
    const m = maps.get(kind);
    const key = String(name).trim().toLowerCase();
    if (!m.has(key)) {
      const i = m.size;
      const suffix = kind === "Fornecedor" ? letters[i % 26] + (i >= 26 ? String(Math.floor(i / 26)) : "") : String(i + 1);
      m.set(key, `${kind} ${suffix}`);
    }
    return m.get(key);
  }

  return { label };
}

/**
 * Aplica o modo da categoria a um nome:
 * "on" → nome real · "anonymize" → etiqueta · "off" → null (não enviado).
 */
function applyMode(mode, anonymizer, kind, name) {
  if (!name) return null;
  if (mode === "on") return name;
  if (mode === "anonymize") return anonymizer.label(kind, name);
  return null;
}

module.exports = { createAnonymizer, applyMode };
