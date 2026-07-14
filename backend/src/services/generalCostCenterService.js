const { prisma } = require("../db");

const GENERAL_COST_CENTER_SEEDS = [
  {
    id: "gcc_manutencao_frota",
    code: "MANUTENCAO_FROTA",
    name: "Manutenção Frota",
    description: "Filtros, óleos e outros materiais para manutenção das viaturas",
  },
  {
    id: "gcc_sede_escritorios",
    code: "SEDE_ESCRITORIOS",
    name: "Sede - Escritórios",
    description: "Material de escritório, material de limpeza, etc.",
  },
  {
    id: "gcc_venda_produtos",
    code: "VENDA_PRODUTOS",
    name: "Venda de Produtos",
    description: "Venda direta de produtos",
  },
  {
    id: "gcc_manutencao_preventiva",
    code: "MANUTENCAO_PREVENTIVA",
    name: "Manutenção Preventiva",
    description: "Serviços de manutenção preventiva que prestamos",
  },
  {
    id: "gcc_obras_gerais",
    code: "OBRAS_GERAIS",
    name: "Obras Gerais",
    description: "Para quando não quisermos abrir uma obra nova para obras pequenas",
  },
  {
    id: "gcc_granja_quavi",
    code: "GRANJA_QUAVI",
    name: "Granja - Quavi",
    description: "Custos da granja Quavi",
  },
];

async function ensureGeneralCostCenters() {
  try {
    for (const seed of GENERAL_COST_CENTER_SEEDS) {
      await prisma.generalCostCenter.upsert({
        where: { code: seed.code },
        create: { ...seed, active: true },
        update: {
          name: seed.name,
          description: seed.description,
          active: true,
        },
      });
    }
    console.log("✅ Centros de custo gerais verificados");
  } catch (error) {
    console.error("❌ Erro ao garantir centros gerais:", error.message);
  }
}

module.exports = { ensureGeneralCostCenters, GENERAL_COST_CENTER_SEEDS };
