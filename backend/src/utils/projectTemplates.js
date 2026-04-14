const projectTemplates = {
  "MÉDIA TENSÃO": [
    { order: 1, description: "Marcação da obra (Postes de MT)", expectedQty: 0, unit: "km", subItems: [
        { description: "Identificação de pontos", expectedQty: 0, unit: "un" },
        { description: "Sinalização", expectedQty: 0, unit: "un" }
    ]},
    { order: 2, description: "Distribuição dos postes", expectedQty: 0, unit: "un" },
    { order: 3, description: "Abertura de buracos", expectedQty: 0, unit: "un" },
    { order: 4, description: "Arvoramento de postes e montagem de ferragens", expectedQty: 0, unit: "un" },
    { order: 5, description: "Maciçamento dos postes (betão ciclópico)", expectedQty: 0, unit: "un" },
    { order: 6, description: "Lançamento e regulação de condutor ACSR 1X110mm2", expectedQty: 0, unit: "mts" },
    { order: 7, description: "Lançamento e regulação de condutor ACSR 1X160mm2", expectedQty: 0, unit: "mts" },
    { order: 8, description: "Verificação de conformidade do ramal", expectedQty: 0, unit: "un" }
  ],
  "POSTO DE TRANSFORMAÇÃO 160KVA": [
    { order: 1, description: "Marcação da obra (PTAS)", expectedQty: 0, unit: "un" },
    { order: 2, description: "Abertura de buracos", expectedQty: 0, unit: "un" },
    { order: 3, description: "Arvoramento de poste tipo TP4 e execução de maciço", expectedQty: 0, unit: "un" },
    { order: 4, description: "Montagem de ferragem", expectedQty: 0, unit: "un" },
    { order: 5, description: "Montagem do transformador", expectedQty: 0, unit: "un" },
    { order: 6, description: "Montagem do XS - Seccionador cut-out com fusíveis 10A", expectedQty: 0, unit: "un" },
    { order: 7, description: "Montagem do QGBT 250A", expectedQty: 0, unit: "un" },
    { order: 8, description: "Execução dos terras de serviço e protecção", expectedQty: 0, unit: "un" },
    { order: 9, description: "Verificação de conformidade do PT", expectedQty: 0, unit: "un" }
  ],
  "POSTO DE TRANSFORMAÇÃO 250KVA": [
    { order: 1, description: "Marcação da obra (PTAI)", expectedQty: 0, unit: "un" },
    { order: 2, description: "Abertura de buracos", expectedQty: 0, unit: "un" },
    { order: 3, description: "Arvoramento de poste tipo TP4 e execução de maciço", expectedQty: 0, unit: "un" },
    { order: 4, description: "Montagem de ferragem", expectedQty: 0, unit: "un" },
    { order: 5, description: "Montagem do transformador", expectedQty: 0, unit: "un" },
    { order: 6, description: "Montagem do XS - Seccionador cut-out com fusíveis 10A", expectedQty: 0, unit: "un" },
    { order: 7, description: "Montagem do QGBT 400A", expectedQty: 0, unit: "un" },
    { order: 8, description: "Execução dos terras de serviço e protecção", expectedQty: 0, unit: "un" },
    { order: 9, description: "Verificação de conformidade do PT", expectedQty: 0, unit: "un" }
  ],
  "BAIXA TENSÃO": [
    { order: 1, description: "Marcação da obra (Postes de BT)", expectedQty: 0, unit: "un" },
    { order: 2, description: "Distribuição dos postes", expectedQty: 0, unit: "un" },
    { order: 3, description: "Abertura de buracos", expectedQty: 0, unit: "un" },
    { order: 4, description: "Arvoramento de postes", expectedQty: 0, unit: "un" },
    { order: 5, description: "Maciçamento dos postes (betão ciclópico)", expectedQty: 0, unit: "un" },
    { order: 6, description: "Lançamento de regulação do cabo LXS", expectedQty: 0, unit: "mts" },
    { order: 7, description: "Instalação de luminárias", expectedQty: 0, unit: "un" },
    { order: 8, description: "Aplicação de postaletes", expectedQty: 0, unit: "un" },
    { order: 9, description: "Execução de ligações domiciliares", expectedQty: 0, unit: "un" },
    { order: 10, description: "Teste à instalação", expectedQty: 0, unit: "un" }
  ],
  "ABERTURA E FECHAMENTO DE VALA": [
    { order: 1, description: "Abertura de vala técnica", expectedQty: 0, unit: "mts" },
    { order: 2, description: "Fechamento de vala técnica", expectedQty: 0, unit: "mts" }
  ],
  "RAMAL SUBTERRÂNEO DE MÉDIA TENSÃO": [
    { order: 1, description: "Lançamento do cabo de média tensão LXHIOV 1x240mm2", expectedQty: 0, unit: "mts" },
    { order: 2, description: "Colocação de sinalização nos cabos de média tensão", expectedQty: 0, unit: "un" },
    { order: 3, description: "Execução das caixas terminais exteriores 17kv", expectedQty: 0, unit: "un" },
    { order: 4, description: "Execução das caixas terminais interiores 17kv", expectedQty: 0, unit: "un" },
    { order: 5, description: "Colocação e montagem das celas de média tensão", expectedQty: 0, unit: "un" },
    { order: 6, description: "Ligação das caixas terminais nas celas de média tensão", expectedQty: 0, unit: "un" },
    { order: 7, description: "Montagem do tranformador", expectedQty: 0, unit: "un" },
    { order: 8, description: "Interligação do Tansformador nas celas", expectedQty: 0, unit: "un" },
    { order: 9, description: "Teste à Ligação", expectedQty: 0, unit: "un" }
  ],
  "BAIXA TENSÃO E TERRAS": [
    { order: 1, description: "Montagem e ligação do QGBT", expectedQty: 0, unit: "un" },
    { order: 2, description: "Ligação do QGBT ao inversor do edifício", expectedQty: 0, unit: "un" },
    { order: 3, description: "Execução dos terras de serviço e proteção", expectedQty: 0, unit: "un" },
    { order: 4, description: "Electrificação do PT em alvenaria", expectedQty: 0, unit: "un" },
    { order: 5, description: "Ponto de Ligação e Teste do posto de transformação", expectedQty: 0, unit: "un" },
    { order: 6, description: "Teste à Ligação", expectedQty: 0, unit: "un" }
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
