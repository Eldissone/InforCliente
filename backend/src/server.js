const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const cors = require("cors");
const { config } = require("./config");

const { authRoutes } = require("./routes/auth");
const { dashboardRoutes } = require("./routes/dashboard");
const { clientRoutes } = require("./routes/clients");
const { projectRoutes } = require("./routes/projects");
const { userRoutes } = require("./routes/users");
const { stockRoutes } = require("./routes/stock");
const { productRoutes } = require("./routes/products");
const { catalogCategoryRoutes } = require("./routes/catalogCategories");
const { bankRoutes } = require("./routes/banks");
const { warehouseRoutes } = require("./routes/warehouses");
const { itemRoutes } = require("./routes/items");
const { permissionsRoutes } = require("./routes/permissions");
const { dailyPlansRoutes } = require("./routes/dailyPlans");
const { logRoutes } = require("./routes/logs");
const { costCenterRoutes } = require("./routes/costCenters");
const { supplierRoutes } = require("./routes/suppliers");
const { quoteRoutes } = require("./routes/quotes");
const { conversationRoutes } = require("./routes/conversations");
const { notificationRoutes } = require("./routes/notifications");
const { aiRoutes } = require("./routes/ai");
const { approvalRoutes } = require("./routes/approvals");
const { prefillRoutes } = require("./routes/prefill");
const { pettyCashRoutes } = require("./routes/pettyCash");
const { extraRequestRoutes } = require("./routes/extraRequests");
const { generalCostCenterRoutes } = require("./routes/generalCostCenters");
const { projectLabelRoutes } = require("./routes/projectLabels");
const { costCategoryRoutes } = require("./routes/costCategories");
const { freightOrderRoutes } = require("./routes/freightOrders");
const { purchaseOrderRoutes } = require("./routes/purchaseOrders");
const { helpTicketRoutes } = require("./routes/helpTickets");
const { contactRoutes, sectorRoutes, personnelRoutes } = require("./routes/registry");
const { financeRoutes } = require("./routes/finance");
const { comprasStockRoutes } = require("./routes/comprasStock");
const { baremRoutes } = require("./routes/baremes");
const { companySettingsRoutes } = require("./routes/companySettings");
const { budgetRoutes } = require("./routes/budgets");
const { proposalRoutes } = require("./routes/proposals");
const { requisitionRoutes } = require("./routes/requisitions");
const { backupRoutes } = require("./routes/backups");
const { uploadsRoutes } = require("./routes/uploads");
const { initialize } = require("./utils/startup");
const { ensureUploadsDir } = require("./utils/storage");
const { auditMiddleware } = require("./middlewares/auditMiddleware");
const { createSocketServer } = require("./socket");
const { scanDueAndOverduePayments } = require("./services/paymentNotificationService");
const { startBackupScheduler } = require("./services/backup/service");

const app = express();
app.set("trust proxy", 1); // Confiar no IP original através de Nginx/Load Balancers

const allowedOrigins = config.frontendOrigin
  .replace(/['"]/g, "") // Remove aspas extras
  .split(",")
  .map((o) => o.trim().replace(/\/$/, "")); // Remove barra no final

console.log("Allowed origins:", allowedOrigins);

app.use(
  cors({
    origin: (origin, callback) => {
      const sanitizedOrigin = origin
        ? origin.replace(/\/$/, "")
        : null;

      console.log(
        `CORS check - Origin: ${sanitizedOrigin}`
      );

      // Pedidos sem Origin (curl, healthchecks, apps nativas) não são um
      // browser CORS; o risco está em origens web não listadas.
      if (!sanitizedOrigin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes("*")) {
        if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
          return callback(new Error("Not allowed by CORS"));
        }
        return callback(null, true);
      }

      // Validar origins permitidas
      if (allowedOrigins.includes(sanitizedOrigin)) {
        return callback(null, true);
      }

      console.warn(`CORS blocked: ${sanitizedOrigin}`);

      return callback(new Error("Not allowed by CORS"));
    },

    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
    ],

    credentials: true,
  })
);

app.options(/(.*)/, cors()); // Handle ALL preflight requests

app.use(express.json({ limit: "10mb" }));
app.use("/uploads", uploadsRoutes);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(auditMiddleware());

app.use("/auth", authRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/clients", clientRoutes);
app.use("/project-labels", projectLabelRoutes);
app.use("/projects", projectRoutes);
app.use("/users", userRoutes);
app.use("/stock", stockRoutes);
app.use("/products", productRoutes);
app.use("/catalog-categories", catalogCategoryRoutes);
app.use("/banks", bankRoutes);
app.use("/warehouses", warehouseRoutes);
app.use("/items", itemRoutes);
app.use("/permissions", permissionsRoutes);
app.use("/daily-plans", dailyPlansRoutes);
app.use("/logs", logRoutes);
app.use("/cost-centers", costCenterRoutes);
app.use("/suppliers", supplierRoutes);
app.use("/quotes", quoteRoutes);
app.use("/conversations", conversationRoutes);
app.use("/notifications", notificationRoutes);
app.use("/ai", aiRoutes);
app.use("/approvals", approvalRoutes);
app.use("/prefill", prefillRoutes);
app.use("/petty-cash", pettyCashRoutes);
app.use("/extra-requests", extraRequestRoutes);
app.use("/general-cost-centers", generalCostCenterRoutes);
app.use("/cost-categories", costCategoryRoutes);
app.use("/freight-orders", freightOrderRoutes);
app.use("/purchase-orders", purchaseOrderRoutes);
app.use("/help-tickets", helpTicketRoutes);
// Cadastros persistentes
app.use("/contacts", contactRoutes);
app.use("/sectors", sectorRoutes);
app.use("/personnel", personnelRoutes);
// Comercial / Orçamentação (Base: baremes e parâmetros)
app.use("/baremes", baremRoutes);
app.use("/company-settings", companySettingsRoutes);
app.use("/budgets", budgetRoutes);
app.use("/proposals", proposalRoutes);
app.use("/requisitions", requisitionRoutes);
// Área Financeira (faturação, custos, tesouraria, overview)
app.use("/finance", financeRoutes);
// Área Compras e Stock (base de preços, compromissos, conta corrente de fornecedores, stock)
app.use("/compras-stock", comprasStockRoutes);

// Backups
app.use("/backups", backupRoutes);

/**
 * Os erros 500 ficam também em `logs/erros-500.log`.
 *
 * O `console.error` escreve na janela onde o servidor arrancou, que nem sempre
 * se tem à mão: quando um ecrã devolve 500, é neste ficheiro que se vê qual foi
 * o pedido e onde rebentou. Guarda o método, o caminho, o utilizador e a pilha;
 * não guarda o corpo do pedido, que pode trazer dados de clientes.
 */
function registarErro500(err, req) {
  try {
    const dir = path.join(__dirname, "..", "logs");
    fs.mkdirSync(dir, { recursive: true });
    const linhas = [
      `[${new Date().toISOString()}] ${req?.method || "?"} ${req?.originalUrl || req?.url || "?"}`,
      `  utilizador: ${req?.user?.sub || "(sem sessão)"} ${req?.user?.email || ""}`.trimEnd(),
      `  ${err?.name || "Error"}: ${err?.message || String(err)}`,
      ...String(err?.stack || "").split("\n").slice(1, 9).map((l) => "  " + l.trim()),
      "",
    ];
    fs.appendFileSync(path.join(dir, "erros-500.log"), linhas.join("\n") + "\n", "utf8");
  } catch {
    // Falhar a escrever o registo não pode agravar o erro que se está a tratar.
  }
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // Zod validation
  if (err?.name === "ZodError") {
    console.error("Zod Validation Error:", JSON.stringify(err.issues, null, 2));
    console.error("Request Body:", _req.body);
    const detailsMsg = err.issues?.map(i => `${i.path?.join(".")}: ${i.message}`).join(", ");
    return res.status(400).json({
      error: `Erro de Validação: ${detailsMsg}`,
      details: err.issues,
    });
  }

  const status =
    typeof err?.status === "number"
      ? err.status
      : err?.code && err.code !== "INTERNAL_SERVER_ERROR"
        ? 400
        : 500;

  const message =
    status === 503 || err?.code === "AI_TIMEOUT"
      ? err.message || "Serviço indisponível"
      : status >= 500
        ? "INTERNAL_SERVER_ERROR"
        : (err.message || err.code || "Bad Request");

  if (status >= 500) {
    console.error(err);
    registarErro500(err, _req);
  }

  return res.status(status).json({
    error: message,
    code: err?.code,
    previstoUnitPrice: err?.previstoUnitPrice,
    requestedUnitPrice: err?.requestedUnitPrice,
  });
});

const server = http.createServer(app);
const io = createSocketServer(server, { corsOrigins: allowedOrigins });
app.set("io", io);

server.listen(config.port, async () => {
  console.log(`API listening on port ${config.port}`);
  console.log("WebSocket (Socket.IO) enabled at /socket.io");

  await initialize();
  ensureUploadsDir();

  const io = app.get("io");
  const scanPayments = () => {
    scanDueAndOverduePayments(io).catch((e) => console.error("scanDueAndOverduePayments:", e));
  };
  scanPayments();
  setInterval(scanPayments, 6 * 60 * 60 * 1000);
  startBackupScheduler();
  require("./services/ai/digests/service").startDigestScheduler(io);
  require("./services/ai/alerts/service").startAlertScheduler(io);
});


