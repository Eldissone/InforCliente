/**
 * Cria um orçamento por obra, a partir da tabela de quantidades que a obra já tem.
 *
 *   node scripts/budgets-from-projects.cjs            ← só mostra o que ia fazer
 *   node scripts/budgets-from-projects.cjs --apply    ← cria
 *   node scripts/budgets-from-projects.cjs --apply --only OBR-XXXX,OBR-YYYY
 *
 * O orçamento fica com a metodologia **«preço dado pelo cliente»**: o preço de
 * venda é o total do mapa, que é o que foi contratado, e a margem passa a ser o
 * que sobra quando alguém lançar os custos. Nenhum valor é alterado.
 *
 * Passa pelo mesmo serviço que a rota `POST /budgets` (`services/budget/create.js`),
 * para os orçamentos criados aqui serem iguais aos criados no ecrã.
 *
 * **Repetível**: um orçamento criado por aqui guarda o código da obra em
 * `params.codObra`; correr outra vez salta as obras que já o têm.
 */

require("dotenv").config();

const { prisma } = require("../src/db");
const { calcBudget } = require("../src/services/budget/calc");
const { allocate, costCenterCodeFor } = require("../src/services/budget/numbering");
const { normalizeUnit, summarizeUnits } = require("../src/services/budget/units");
const {
  columnsFor,
  snapshotFromLibrary,
  buildBudgetDocument,
  loadCompanyDefaults,
} = require("../src/services/budget/create");

const APPLY = process.argv.includes("--apply");
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > -1 ? String(process.argv[onlyArg + 1] || "").split(",").map((s) => s.trim()).filter(Boolean) : null;

const n = (v) => (v === null || v === undefined ? 0 : Number(v));
const money = (v) => n(v).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Linhas do mapa a partir da tabela de quantidades. Igual ao que a rota de
 * importação faz: os valores entram como estão e a unidade passa à grafia do
 * orçamento, com o original guardado quando muda.
 */
function rowsFromTasks(tasks) {
  return tasks
    .filter((t) => !t.parentId)
    .map((t) => {
      const u = normalizeUnit(t.unit);
      const direto = t.unitValue === null || t.unitValue === undefined ? null : Number(t.unitValue);
      const pu = direto !== null && direto !== 0 ? direto : n(t.unitValueMaterial) + n(t.unitValueService);
      const escrito = t.totalValue === null || t.totalValue === undefined ? null : Number(t.totalValue);
      const row = {
        grupo: t.itemGroup || "",
        cod: t.wbsCode || "",
        desc: t.description || "",
        un: u.unit,
        q: n(t.expectedQty),
        pu,
      };
      if (escrito !== null && escrito !== 0) row.tfix = escrito;
      if (u.original && u.unit !== u.original) row.unOrig = u.original;
      return row;
    });
}

/** O total que a obra mostra hoje, pela mesma conta do `financeLedgerService`. */
function totalDaObra(tasks) {
  return tasks
    .filter((t) => !t.parentId)
    .reduce((a, t) => {
      const escrito = t.totalValue === null || t.totalValue === undefined ? null : Number(t.totalValue);
      if (escrito && escrito > 0) return a + escrito;
      const pu = n(t.unitValue ?? n(t.unitValueMaterial) + n(t.unitValueService));
      return a + pu * n(t.expectedQty);
    }, 0);
}

async function main() {
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      currency: true,
      location: true,
      directorObra: true,
      clientId: true,
      client: { select: { id: true, name: true } },
      progressTasks: {
        select: {
          parentId: true,
          itemGroup: true,
          wbsCode: true,
          description: true,
          expectedQty: true,
          unit: true,
          unitValue: true,
          unitValueMaterial: true,
          unitValueService: true,
          totalValue: true,
        },
        orderBy: { order: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const existentes = await prisma.budget.findMany({ select: { number: true, params: true } });
  const jaFeitas = new Set(
    existentes.map((b) => (b.params && b.params.codObra ? String(b.params.codObra) : null)).filter(Boolean)
  );

  const company = await loadCompanyDefaults();
  const snapshot = await snapshotFromLibrary();
  if (!snapshot.items?.length) {
    console.error("Não há baremes na biblioteca da empresa. Carregue-os antes (Comercial › Base › Baremes).");
    process.exitCode = 1;
    return;
  }

  console.log(APPLY ? "A CRIAR orçamentos.\n" : "Simulação — nada é gravado. Use --apply para criar.\n");
  console.log("  obra                estado      moeda  linhas         total do mapa  situação");

  const feitos = [];
  let saltadas = 0;
  let semLinhas = 0;

  for (const p of projects) {
    if (ONLY && !ONLY.includes(p.code)) continue;

    const rows = rowsFromTasks(p.progressTasks);
    const total = totalDaObra(p.progressTasks);
    const linha = (situacao) =>
      console.log(
        "  " +
          String(p.code).padEnd(19),
        String(p.status).padEnd(11),
        String(p.currency || "AOA").padEnd(6),
        String(rows.length).padStart(5),
        money(total).padStart(20),
        " " + situacao
      );

    if (!rows.length) {
      semLinhas++;
      linha("sem tabela de quantidades — saltada");
      continue;
    }
    if (jaFeitas.has(p.code)) {
      saltadas++;
      linha("já tem orçamento — saltada");
      continue;
    }

    if (!APPLY) {
      const u = summarizeUnits(p.progressTasks.filter((t) => !t.parentId).map((t) => t.unit));
      const nota = [
        u.changed.length ? `${u.changed.reduce((a, r) => a + r.count, 0)} unidade(s) traduzidas` : null,
        u.unknown.length ? `${u.unknown.length} por reconhecer` : null,
        !p.clientId ? "sem cliente" : null,
      ]
        .filter(Boolean)
        .join(", ");
      linha("vai ser criada" + (nota ? ` (${nota})` : ""));
      continue;
    }

    const { number } = await allocate("ORC");
    const costCenterCode = costCenterCodeFor(number);
    const { doc } = buildBudgetDocument({
      number,
      costCenterCode,
      client: p.client,
      snapshot,
      company,
      fields: {
        projectName: p.name,
        projectCode: p.code,
        location: p.location || null,
        responsibleName: p.directorObra || null,
        projectDirName: p.directorObra || null,
        startDate: null,
        endDate: null,
        priceBaseDate: null,
        validityDays: company.params.validade ?? 30,
        currencyBase: p.currency || "AOA",
        currencyRef: company.params.moedaRef || null,
        // O preço está contratado: o que falta é saber se o custo cabe lá dentro.
        method: "PRECO_DADO",
      },
      sheets: { qt: rows },
    });

    const R = calcBudget(doc);
    const row = await prisma.budget.create({
      data: {
        number,
        revision: "R0",
        status: "EM_ELABORACAO",
        clientId: p.clientId || null,
        costCenterCode,
        date: new Date(),
        ...columnsFor(doc, R),
        params: doc.params,
        sheets: doc.sheets,
        baremSnapshot: doc.baremSnapshot,
        lists: doc.lists,
        dispatch: doc.dispatch,
        paymentTerms: {},
      },
      select: { id: true, number: true, salePriceExVat: true },
    });

    const bate = Math.abs(n(row.salePriceExVat) - total) < 0.01;
    feitos.push({ code: p.code, number: row.number, id: row.id, total, pv: n(row.salePriceExVat), bate, linhas: rows.length });
    linha(`${row.number} criado ${bate ? "✓ bate com a obra" : "✗ DIVERGE"}`);
  }

  console.log("");
  if (!APPLY) {
    console.log(`  ${projects.filter((p) => (!ONLY || ONLY.includes(p.code)) && p.progressTasks.length && !jaFeitas.has(p.code)).length} orçamento(s) por criar · ${saltadas} já feitas · ${semLinhas} sem tabela`);
    console.log("  Correr outra vez com --apply para criar.");
    return;
  }
  const maus = feitos.filter((f) => !f.bate);
  console.log(`  ${feitos.length} orçamento(s) criados · ${saltadas} saltados · ${semLinhas} sem tabela`);
  console.log(`  conferência: ${feitos.length - maus.length} batem ao cêntimo com a obra` + (maus.length ? `, ${maus.length} DIVERGEM` : ", nenhum diverge"));
  if (maus.length) {
    maus.forEach((f) => console.log(`    ✗ ${f.code} ${f.number}: obra ${money(f.total)} · orçamento ${money(f.pv)}`));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("ERRO:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
