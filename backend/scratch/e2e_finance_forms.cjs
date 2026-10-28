/**
 * Verificação temporária das interações da Área Financeira:
 *  - formulário de Nova Fatura (secção «Recebimento» + botões de ficheiro/IA)
 *  - lançamento manual de custo
 *  - seletor 6/12 meses do Overview (o gráfico redesenha com menos meses)
 */
const jwt = require("jsonwebtoken");
const puppeteer = require("puppeteer");
const { prisma } = require("../src/db");
const { config } = require("../src/config");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok   " : "FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

(async () => {
  const user = await prisma.user.findFirst({ where: { role: "financeiro" } });
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: "ADMIN", clientId: null },
    config.jwtSecret,
    { expiresIn: "1h" }
  );

  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text());
  });

  await page.goto("http://localhost:5173/auth/login", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate(
    (t, u) => {
      localStorage.setItem("InfoCliente.token", t);
      localStorage.setItem("InfoCliente.user", JSON.stringify(u));
    },
    token,
    { id: user.id, email: user.email, name: user.name, role: "ADMIN", clientId: null }
  );

  /* ─── A) Nova Fatura ───────────────────────────────────────────────────── */
  await page.goto("http://localhost:5173/Financeiro/faturacao/registar/", { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector("#invNew", { timeout: 20000 });
  await page.click("#invNew");
  await page.waitForSelector("#inv_scanPanel", { timeout: 15000 });

  const form = await page.evaluate(() => {
    const t = (id) => document.getElementById(id)?.textContent?.trim() || null;
    const btns = [...document.querySelectorAll("#inv_scanPanel .finance-scan-actions button")].map((b) => ({
      text: b.textContent.trim(),
      icon: b.querySelector(".material-symbols-outlined")?.textContent?.trim() || null,
      title: b.getAttribute("title"),
    }));
    return {
      fileLabel: t("inv_docFile"),
      panelTitle: t("inv_scanPanel")?.slice(0, 60),
      note: t("inv_docNote"),
      buttons: btns,
      sectionTitle: [...document.querySelectorAll(".finance-section-title")].map((e) => e.textContent.trim()),
      choices: [...document.querySelectorAll("#rcv_choice .finance-choice")].map((b) => ({
        mode: b.dataset.mode,
        label: b.querySelector(".finance-choice-title")?.textContent?.trim(),
        desc: b.querySelector(".finance-choice-desc")?.textContent?.trim(),
      })),
      fieldsHiddenAtStart: document.getElementById("rcv_fields").hidden,
      amountDisabledAtStart: document.getElementById("inv_received").disabled,
      summaryStart: [t("rcv_sum_net"), t("rcv_sum_received"), t("rcv_sum_missing")],
      net: t("rcv_net"),
    };
  });

  check("Formulário de fatura: identificação do ficheiro", form.fileLabel === "Nenhum ficheiro selecionado", form.fileLabel);
  check(
    "Formulário de fatura: botões de ficheiro e IA",
    form.buttons.some((b) => b.text.includes("Escolher ficheiro")) && form.buttons.some((b) => b.text.includes("Ler fatura com IA")),
    form.buttons.map((b) => `${b.text}${b.title ? ` (${b.title})` : ""}`).join(" | ")
  );
  check(
    "Formulário de fatura: secção Recebimento com as duas opções",
    form.choices.length === 2 && form.choices.every((c) => c.label && c.desc),
    form.choices.map((c) => `${c.label}: ${c.desc}`).join(" | ")
  );
  check("Formulário de fatura: campos de recebimento começam fechados", form.fieldsHiddenAtStart && form.amountDisabledAtStart);
  check(
    "Formulário de fatura: passo-a-passo da leitura com IA",
    String(form.note).includes("Escolha o PDF") || String(form.note).includes("GEMINI_API_KEY"),
    String(form.note).slice(0, 90)
  );

  // Preencher o V. Ilíquido e escolher «Já recebi»: o valor deve ser sugerido.
  await page.evaluate(() => {
    const gross = document.getElementById("inv_gross");
    gross.value = "1000000";
    gross.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const netAfterGross = await page.evaluate(() => document.getElementById("rcv_net").textContent.trim());
  await page.click('#rcv_choice .finance-choice[data-mode="recebido"]');
  await page.waitForFunction("!document.getElementById('rcv_fields').hidden", { timeout: 5000 });
  const afterChoice = await page.evaluate(() => ({
    hidden: document.getElementById("rcv_fields").hidden,
    amount: document.getElementById("inv_received").value,
    received: document.getElementById("rcv_sum_received").textContent.trim(),
    missing: document.getElementById("rcv_sum_missing").textContent.trim(),
    active: document.querySelector("#rcv_choice .finance-choice.active")?.dataset.mode || null,
  }));
  check(
    "Recebimento: «Já recebi» abre os campos e sugere o valor líquido",
    !afterChoice.hidden && Number(afterChoice.amount) > 0 && afterChoice.active === "recebido",
    `líquido=${netAfterGross} sugerido=${afterChoice.amount} recebido=${afterChoice.received} em falta=${afterChoice.missing}`
  );

  // Recebimento parcial: o que fica em falta deve aparecer no resumo.
  await page.evaluate(() => {
    const amt = document.getElementById("inv_received");
    amt.value = "400000";
    amt.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const partial = await page.evaluate(() => ({
    received: document.getElementById("rcv_sum_received").textContent.trim(),
    missing: document.getElementById("rcv_sum_missing").textContent.trim(),
  }));
  check("Recebimento: valor parcial atualiza o resumo", partial.missing !== "0,00 Kz" && partial.received !== partial.missing, JSON.stringify(partial));

  // Voltar a «Fica em aberto»: os campos fecham e o valor volta a zero.
  await page.click('#rcv_choice .finance-choice[data-mode="aberto"]');
  const backToOpen = await page.evaluate(() => ({
    hidden: document.getElementById("rcv_fields").hidden,
    amount: document.getElementById("inv_received").value,
    missing: document.getElementById("rcv_sum_missing").textContent.trim(),
  }));
  check(
    "Recebimento: «Fica em aberto» fecha os campos e repõe o valor",
    backToOpen.hidden && Number(backToOpen.amount) === 0,
    JSON.stringify(backToOpen)
  );

  /* ─── B) Lançamento manual de custo ────────────────────────────────────── */
  await page.goto("http://localhost:5173/Financeiro/custos/registar/", { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector("#costNew", { timeout: 20000 });
  await page.click("#costNew");
  await page.waitForSelector("#mc_project", { timeout: 15000 });
  const costForm = await page.evaluate(() => {
    const ids = ["mc_project", "mc_center", "mc_category", "mc_supplier", "mc_doc", "mc_date", "mc_desc", "mc_budgeted", "mc_paid", "mc_method", "mc_type", "mc_notes"];
    const present = ids.filter((id) => document.getElementById(id));
    const centerHint = document.getElementById("mc_centerHint")?.textContent?.trim();
    return {
      present,
      missing: ids.filter((id) => !ids.includes(id) || !document.getElementById(id)),
      centerDisabled: document.getElementById("mc_center").disabled,
      centerOptions: document.getElementById("mc_center").options.length,
      hasObras: document.getElementById("mc_project").options.length,
      centerHint,
    };
  });
  check("Custo manual: todos os campos do formulário existem", costForm.present.length === 12, `em falta: ${costForm.missing.join(", ") || "nenhum"}`);
  check(
    "Custo manual: centro de custo só abre depois de escolher a obra",
    costForm.centerDisabled && costForm.centerOptions === 1 && costForm.hasObras > 1,
    `${costForm.centerHint} · obras=${costForm.hasObras}`
  );

  // Escolher a obra com centros de custo e confirmar que a lista carrega.
  const withCenters = await page.evaluate(() => {
    const sel = document.getElementById("mc_project");
    return [...sel.options].find((o) => o.value)?.value || null;
  });
  const centerLoad = await page.evaluate(async (projectId) => {
    const sel = document.getElementById("mc_project");
    sel.value = projectId;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      const center = document.getElementById("mc_center");
      if (!center.disabled && center.options.length > 1) return { options: center.options.length, hint: document.getElementById("mc_centerHint").textContent.trim() };
    }
    const center = document.getElementById("mc_center");
    return { options: center.options.length, disabled: center.disabled, hint: document.getElementById("mc_centerHint").textContent.trim() };
  }, withCenters);
  check("Custo manual: escolher a obra carrega os centros de custo", centerLoad.options > 1, JSON.stringify(centerLoad));

  /* ─── C) Seletor 6/12 meses do Overview ────────────────────────────────── */
  await page.goto("http://localhost:5173/Financeiro/overview/", { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector("#ovChartFlow .apexcharts-svg", { timeout: 25000 });
  const labels12 = await page.evaluate(() => document.querySelectorAll("#ovChartFlow .apexcharts-xaxis-texts-g text").length);
  await page.click('#ovRange button[data-months="6"]');
  await new Promise((r) => setTimeout(r, 2000));
  const after = await page.evaluate(() => ({
    labels: document.querySelectorAll("#ovChartFlow .apexcharts-xaxis-texts-g text").length,
    active: document.querySelector("#ovRange button.active")?.dataset.months,
    svg: document.querySelectorAll("#ovChartFlow .apexcharts-svg").length,
  }));
  check(
    "Overview: seletor 6/12 meses redesenha o gráfico",
    after.labels === 6 && labels12 === 12 && after.active === "6" && after.svg === 1,
    `12 meses=${labels12} etiquetas, 6 meses=${after.labels} etiquetas, activo=${after.active}`
  );

  await browser.close();
  await prisma.$disconnect();
  check("Sem erros de consola/página", errors.length === 0, errors.slice(0, 3).join(" | "));

  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length ? `\nFALHARAM: ${failed.map((f) => f.name).join("; ")}` : "\nInterações verificadas.");
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error("ERRO:", err.message);
  process.exit(1);
});
