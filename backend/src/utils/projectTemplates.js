const projectTemplates = {
  "MÉDIA TENSÃO": [

  ],
  "POSTO DE TRANSFORMAÇÃO 160KVA": [

  ],
  "POSTO DE TRANSFORMAÇÃO 250KVA": [

  ],
  "BAIXA TENSÃO": [

  ],
  "ABERTURA E FECHAMENTO DE VALA": [

  ],
  "RAMAL SUBTERRÂNEO DE MÉDIA TENSÃO": [

  ],
  "BAIXA TENSÃO E TERRAS": [

  ],
  "OBRA COMPLEXA": []
};

function getTemplateForProjectType(type) {
  if (!type) return [];
  const upperType = type.toUpperCase().trim();

  // Exact match first
  if (projectTemplates[upperType]) {
    return projectTemplates[upperType];
  }

  // Fallback to substring matching but reverse order or specific order to prevent false positives
  const key = Object.keys(projectTemplates).find(t => upperType.includes(t));
  return key ? projectTemplates[key] : [];
}

module.exports = {
  projectTemplates,
  getTemplateForProjectType
};
