const express = require("express");
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
const { pettyCashRoutes } = require("./routes/pettyCash");
const { extraRequestRoutes } = require("./routes/extraRequests");
const { generalCostCenterRoutes } = require("./routes/generalCostCenters");
const { costCategoryRoutes } = require("./routes/costCategories");
const { freightOrderRoutes } = require("./routes/freightOrders");
const { purchaseOrderRoutes } = require("./routes/purchaseOrders");
const { initialize } = require("./utils/startup");
const { auditMiddleware } = require("./middlewares/auditMiddleware");
const { createSocketServer } = require("./socket");
const { scanDueAndOverduePayments } = require("./services/paymentNotificationService");

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

      // Permitir requests sem origin
      // (Postman, curl, mobile apps)
      if (!sanitizedOrigin) {
        return callback(null, true);
      }

      // Permitir tudo se configurado com *
      if (config.frontendOrigin === "*") {
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
app.use("/uploads", express.static("uploads"));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(auditMiddleware());

app.use("/auth", authRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/clients", clientRoutes);
app.use("/projects", projectRoutes);
app.use("/users", userRoutes);
app.use("/stock", stockRoutes);
app.use("/products", productRoutes);
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
app.use("/petty-cash", pettyCashRoutes);
app.use("/extra-requests", extraRequestRoutes);
app.use("/general-cost-centers", generalCostCenterRoutes);
app.use("/cost-categories", costCategoryRoutes);
app.use("/freight-orders", freightOrderRoutes);
app.use("/purchase-orders", purchaseOrderRoutes);

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

  const status = typeof err?.status === "number" ? err.status : 500;
  const message = status >= 500 ? "INTERNAL_SERVER_ERROR" : err.message;

  if (status >= 500) {

    console.error(err);
  }

  return res.status(status).json({ error: message });
});

const server = http.createServer(app);
const io = createSocketServer(server, { corsOrigins: allowedOrigins });
app.set("io", io);

server.listen(config.port, async () => {
  console.log(`API listening on port ${config.port}`);
  console.log("WebSocket (Socket.IO) enabled at /socket.io");

  await initialize();

  const io = app.get("io");
  const scanPayments = () => {
    scanDueAndOverduePayments(io).catch((e) => console.error("scanDueAndOverduePayments:", e));
  };
  scanPayments();
  setInterval(scanPayments, 6 * 60 * 60 * 1000);
});

