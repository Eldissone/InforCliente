const gemini = require("./gemini");
const openaiCompatible = require("./openaiCompatible");

/** Fornecedores disponíveis. Para acrescentar um: novo ficheiro + entrada aqui. */
const PROVIDERS = { [gemini.id]: gemini, [openaiCompatible.id]: openaiCompatible };

function getProvider(id) {
  return PROVIDERS[id] || null;
}

function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    defaultBaseUrl: p.defaultBaseUrl,
    defaultModel: p.defaultModel,
  }));
}

module.exports = { PROVIDERS, getProvider, listProviders };
