const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const adminEmail = "admin@inforcliente.local";
  const operadorEmail = "operador@inforcliente.local";
  const leituraEmail = "leitura@inforcliente.local";
  const password = "admin123";

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: "admin", passwordHash },
    create: { email: adminEmail, role: "admin", passwordHash },
  });
  await prisma.user.upsert({
    where: { email: operadorEmail },
    update: { role: "operador", passwordHash },
    create: { email: operadorEmail, role: "operador", passwordHash },
  });
  await prisma.user.upsert({
    where: { email: leituraEmail },
    update: { role: "leitura", passwordHash },
    create: { email: leituraEmail, role: "leitura", passwordHash },
  });

  const clientsData = [
    {
      code: "NX-90210",
      name: "Nexus Aerotech",
      industry: "Manufatura Pesada",
      region: "Sudeste",
      tier: "Enterprise",
      status: "ACTIVE",
      healthScore: 92,
      ltvTotal: "2450000.00",
      churnRisk: "2.40",
      ltvPotential: "1200000.00",
      tags: ["High Velocity", "Tech Adopter", "B2B Heavy"],
    },
    {
      code: "GL-11422",
      name: "Global Logistics S.A.",
      industry: "Logística Integrada",
      region: "Sul",
      tier: "Corporate",
      status: "AT_RISK",
      healthScore: 45,
      ltvTotal: "1120000.00",
      churnRisk: "9.10",
      ltvPotential: "680000.00",
      tags: ["Engagement", "Renewal Window"],
    },
    {
      code: "SG-33215",
      name: "SoftGrid Solutions",
      industry: "Tecnologia (SaaS)",
      region: "Nordeste",
      tier: "Growth",
      status: "ACTIVE",
      healthScore: 78,
      ltvTotal: "890500.00",
      churnRisk: "4.80",
      ltvPotential: "510000.00",
      tags: ["Cross-sell", "API V3.2"],
    },
    {
      code: "OF-88712",
      name: "Ouro Fino Engenharia",
      industry: "Construção Civil",
      region: "Centro-Oeste",
      tier: "SMB",
      status: "INACTIVE",
      healthScore: 15,
      ltvTotal: "4200000.00",
      churnRisk: "18.00",
      ltvPotential: "200000.00",
      tags: ["Inativo"],
    },
  ];

  const clients = [];
  for (const c of clientsData) {
    const client = await prisma.client.upsert({
      where: { code: c.code },
      update: {
        name: c.name,
        industry: c.industry,
        region: c.region,
        tier: c.tier,
        status: c.status,
        healthScore: c.healthScore,
        ltvTotal: c.ltvTotal,
        churnRisk: c.churnRisk,
        ltvPotential: c.ltvPotential,
      },
      create: {
        code: c.code,
        name: c.name,
        industry: c.industry,
        region: c.region,
        tier: c.tier,
        status: c.status,
        healthScore: c.healthScore,
        ltvTotal: c.ltvTotal,
        churnRisk: c.churnRisk,
        ltvPotential: c.ltvPotential,
        tags: { create: c.tags.map((t) => ({ tag: t })) },
      },
      include: { tags: true },
    });
    clients.push(client);
  }

  const nexus = clients.find((c) => c.code === "NX-90210");
  const glob = clients.find((c) => c.code === "GL-11422");

  const projectsData = [
    {
      code: "PRJ-2024-001",
      name: "Condomínio Alpha",
      location: "Luanda, AO",
      region: "Luanda",
      status: "ACTIVE",
      startDate: new Date("2024-01-12T00:00:00.000Z"),
      dueDate: new Date("2024-12-15T00:00:00.000Z"),
      budgetTotal: "500000000.00",
      budgetAllocated: "450000000.00",
      budgetConsumed: "185400000.00",
      budgetCommitted: "85200000.00",
      budgetAvailable: "94400000.00",
      physicalProgressPct: 42,
      phaseLabel: "FASE 04 - Estrutura",
      clientId: nexus?.id || null,
    },
    {
      code: "PRJ-2024-012",
      name: "Complexo Industrial",
      location: "Benguela, AO",
      region: "Benguela",
      status: "ON_HOLD",
      startDate: new Date("2024-02-01T00:00:00.000Z"),
      dueDate: new Date("2025-02-01T00:00:00.000Z"),
      budgetTotal: "1200000000.00",
      budgetAllocated: "1200000000.00",
      budgetConsumed: "940000000.00",
      budgetCommitted: "120000000.00",
      budgetAvailable: "140000000.00",
      physicalProgressPct: 78,
      phaseLabel: "FASE 06 - Instalações",
      clientId: glob?.id || null,
    },
  ];

  const projects = [];
  for (const p of projectsData) {
    const project = await prisma.project.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        location: p.location,
        region: p.region,
        status: p.status,
        startDate: p.startDate,
        dueDate: p.dueDate,
        budgetTotal: p.budgetTotal,
        budgetAllocated: p.budgetAllocated,
        budgetConsumed: p.budgetConsumed,
        budgetCommitted: p.budgetCommitted,
        budgetAvailable: p.budgetAvailable,
        physicalProgressPct: p.physicalProgressPct,
        phaseLabel: p.phaseLabel,
        clientId: p.clientId,
      },
      create: p,
    });
    projects.push(project);
  }

  const prj = projects[0];
  if (prj) {
    const existing = await prisma.projectTransaction.count({ where: { projectId: prj.id } });
    if (existing === 0) {
      await prisma.projectTransaction.createMany({
        data: [
          {
            projectId: prj.id,
            date: new Date("2024-05-24T00:00:00.000Z"),
            description: "Fornecimento de Concreto Usinado (Lote #9921 - Cimento Forte S/A)",
            category: "MATERIALS",
            ownerName: "Eng. Ricardo Lima",
            status: "PAID",
            amount: "1240000.00",
          },
          {
            projectId: prj.id,
            date: new Date("2024-05-23T00:00:00.000Z"),
            description: "Locação de Guindaste RT 530 (Período: 30 dias - LocaEquip)",
            category: "EQUIPMENT",
            ownerName: "Sup. Carlos Mendes",
            status: "PENDING",
            amount: "45800.00",
          },
          {
            projectId: prj.id,
            date: new Date("2024-05-21T00:00:00.000Z"),
            description: "Folha de Pagamento - Equipe Civil (Quinzena 01/Maio - Diretos)",
            category: "LABOR",
            ownerName: "RH Central",
            status: "PAID",
            amount: "890200.00",
          },
          {
            projectId: prj.id,
            date: new Date("2024-05-20T00:00:00.000Z"),
            description: "Vergalhões de Aço CA-50 (Pedido Urgente - Gerdau)",
            category: "MATERIALS",
            ownerName: "Eng. Ricardo Lima",
            status: "LATE",
            amount: "3550000.00",
          },
        ],
      });
    }
  }

  if (nexus) {
    const existingEvents = await prisma.interactionEvent.count({ where: { clientId: nexus.id } });
    if (existingEvents === 0) {
      await prisma.interactionEvent.createMany({
        data: [
          {
            clientId: nexus.id,
            type: "ExecutiveReview",
            title: "Executive Review",
            description: "Q3 Strategy alignment session completed. Satisfaction reported at 9.2/10.",
            occurredAt: new Date("2023-09-12T00:00:00.000Z"),
            leadName: "Marcus J.",
          },
          {
            clientId: nexus.id,
            type: "ServiceUpgrade",
            title: "Service Upgrade",
            description: "Transitioned to Dedicated Cloud Infrastructure. Migrated 4.2TB data.",
            occurredAt: new Date("2023-09-04T00:00:00.000Z"),
            leadName: null,
          },
          {
            clientId: nexus.id,
            type: "SupportTicket",
            title: "Support Ticket #812",
            description: "Latency issue reported and resolved within 45min SLA.",
            occurredAt: new Date("2023-08-28T00:00:00.000Z"),
            leadName: "Sarah L.",
          },
          {
            clientId: nexus.id,
            type: "ContractRenewal",
            title: "Contract Renewal",
            description: "Agreement signed for additional 36-month term with expansion.",
            occurredAt: new Date("2023-08-15T00:00:00.000Z"),
            leadName: null,
          },
        ],
      });
    }
  }

  const openAlerts = await prisma.alert.count({ where: { status: "OPEN" } });
  if (openAlerts === 0) {
    await prisma.alert.createMany({
      data: [
        {
          severity: "HIGH",
          status: "OPEN",
          title: "BlueLight Corp Health Drop",
          body: "System activity decreased by 60% over the last 48 hours. Potential churn threat detected.",
          clientId: clients.find((c) => c.code === "OF-88712")?.id || null,
        },
        {
          severity: "MEDIUM",
          status: "OPEN",
          title: "NexGen Renewal Window",
          body: "Contract expires in 30 days. No renewal proposal sent yet.",
          clientId: clients.find((c) => c.code === "NX-90210")?.id || null,
        },
        {
          severity: "LOW",
          status: "OPEN",
          title: "SkyCore Capacity Limit",
          body: "User reached 95% of seat capacity. Upsell opportunity available.",
          clientId: clients.find((c) => c.code === "SG-33215")?.id || null,
        },
      ],
    });
  }

  // eslint-disable-next-line no-console
  console.log("Seed concluído.");
  // eslint-disable-next-line no-console
  console.log("Usuários seed:");
  // eslint-disable-next-line no-console
  console.log(`- admin: ${adminEmail} / ${password}`);
  // eslint-disable-next-line no-console
  console.log(`- operador: ${operadorEmail} / ${password}`);
  // eslint-disable-next-line no-console
  console.log(`- leitura: ${leituraEmail} / ${password}`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

