/**
 * Traz para a folha de Materiais de cada orçamento o que a obra consumiu do armazém.
 *
 *   node scripts/consumption-to-budgets.cjs            ← só mostra o que ia fazer
 *   node scripts/consumption-to-budgets.cjs --apply    ← grava
 *
 * **Só as quantidades.** O preço fica por preencher, porque o armazém não o
 * sabe: nem o stock tem custo médio nem os movimentos têm custo unitário. Cada
 * linha importada entra no alerta «Custo unitário não preenchido» até alguém a
 * valorizar pelo barém ou por uma cotação.
 *
 * Consumo é **EXIT + LOSS**, o mesmo critério do `financeLedgerService`.
 * ALLOCATION e RETURN são a custódia das equipas e ficam de fora.
 *
 * **Repetível**: em cada passagem as linhas sem preço são substituídas e as que
 * alguém já valorizou ficam. Correr outra vez não duplica nem deita trabalho fora.
 */

require("dotenv").config();

const { prisma } = require("../src/db");
const { calcBudget } = require("../src/services/budget/calc");
const { columnsFor } = require("../src/services/budget/create");
const { consumptionRows, CONSUMPTION_TYPES } = require("../src/services/budget/stockConsumption");

const APPLY = process.argv.includes("--apply");
const n = (v) => (v == null ? 0 : Number(v));
const num = (v) => n(v).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const budgets = await prisma.budget.findMany({ orderBy: { number: "asc" } });
  const comObra = budgets.filter((b) => b.params?.codObra);

  const projects = await prisma.project.findMany({ select: { id: true, code: true, name: true } });
  const porCodigo = new Map(projects.map((p) => [p.code, p]));

  console.log(APPLY ? "A GRAVAR nas folhas de Materiais.\n" : "Simulação — nada é gravado. Use --apply para gravar.\n");
  console.log("  orçamento      obra                artigos  movimentos    quantidade  situação");

  let tocados = 0;
  let semConsumo = 0;
  const alertasDepois = [];

  for (const b of comObra) {
    const p = porCodigo.get(b.params.codObra);
    const linha = (artigos, movs, qtd, situacao) =>
      console.log(
        "  " + String(b.number).padEnd(14),
        String(b.params.codObra).padEnd(19),
        String(artigos).padStart(6),
        String(movs).padStart(11),
        num(qtd).padStart(13),
        " " + situacao
      );

    if (!p) {
      linha(0, 0, 0, "obra não encontrada");
      continue;
    }

    const movements = await prisma.stockMovement.findMany({
      where: { projectId: p.id, type: { in: CONSUMPTION_TYPES } },
      select: { productId: true, type: true, quantity: true, product: { select: { name: true, sku: true, unit: true } } },
    });

    const { rows, resumo } = consumptionRows(movements, { currency: b.currencyBase || "AOA" });
    if (!rows.length) {
      semConsumo++;
      linha(0, 0, 0, "sem saídas de armazém");
      continue;
    }

    if (!APPLY) {
      const extra = [
        resumo.comPerdas ? `${resumo.comPerdas} com perdas` : null,
        resumo.unidadesPorReconhecer.length
          ? `unidades por reconhecer: ${resumo.unidadesPorReconhecer.map((u) => u.original).join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("; ");
      linha(resumo.artigos, resumo.movimentos, resumo.quantidadeTotal, "vai preencher" + (extra ? ` (${extra})` : ""));
      continue;
    }

    const doc = {
      params: b.params,
      sheets: b.sheets || {},
      lists: b.lists,
      dispatch: b.dispatch,
      baremSnapshot: b.baremSnapshot,
    };
    const atuais = Array.isArray(doc.sheets.mat) ? doc.sheets.mat : [];
    const preservadas = atuais.filter((r) => n(r.preco) > 0);
    doc.sheets = { ...doc.sheets, mat: [...preservadas, ...rows] };

    const R = calcBudget(doc);
    await prisma.budget.update({
      where: { id: b.id },
      data: {
        ...columnsFor(doc, R),
        params: doc.params,
        sheets: doc.sheets,
        lists: doc.lists,
        dispatch: doc.dispatch,
        version: { increment: 1 },
      },
    });

    tocados++;
    const semPreco = (R.alerts || []).find((a) => a.t === "Custo unitário não preenchido");
    alertasDepois.push({ number: b.number, linhas: rows.length, semPreco: semPreco ? semPreco.n : 0, custo: R.CT });
    linha(
      resumo.artigos,
      resumo.movimentos,
      resumo.quantidadeTotal,
      `preenchido${preservadas.length ? ` (+${preservadas.length} já valorizadas, mantidas)` : ""}`
    );
  }

  console.log("");
  if (!APPLY) {
    console.log(`  ${comObra.length - semConsumo} orçamento(s) por preencher · ${semConsumo} sem saídas de armazém`);
    console.log("  Correr outra vez com --apply para gravar.");
    return;
  }

  console.log(`  ${tocados} orçamento(s) preenchidos · ${semConsumo} sem saídas de armazém`);
  const totalLinhas = alertasDepois.reduce((a, x) => a + x.linhas, 0);
  const totalSemPreco = alertasDepois.reduce((a, x) => a + x.semPreco, 0);
  const comCusto = alertasDepois.filter((x) => x.custo > 0).length;
  console.log(`  ${totalLinhas} linhas de material escritas, ${totalSemPreco} à espera de preço`);
  console.log(
    totalSemPreco === totalLinhas
      ? "  ✓ nenhuma linha ficou com um preço que o sistema não sabia"
      : `  ✗ ${totalLinhas - totalSemPreco} linha(s) com preço inesperado`
  );
  console.log(
    comCusto === 0
      ? "  ✓ o custo total continua a zero: só entraram quantidades"
      : `  ✗ ${comCusto} orçamento(s) ficaram com custo — devia ser zero`
  );
  if (totalSemPreco !== totalLinhas || comCusto !== 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("ERRO:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
