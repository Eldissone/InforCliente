const express = require("express");
const cors = require("cors");
const { config } = require("./config");

const { authRoutes } = require("./routes/auth");
const { dashboardRoutes } = require("./routes/dashboard");
const { clientRoutes } = require("./routes/clients");
const { projectRoutes } = require("./routes/projects");
const { userRoutes } = require("./routes/users");
const { stockRoutes } = require("./routes/stock");

const app = express();

app.use(
  cors({
    origin: config.frontendOrigin === "*" ? true : config.frontendOrigin,
    credentials: false,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static("uploads"));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/clients", clientRoutes);
app.use("/projects", projectRoutes);
app.use("/users", userRoutes);
app.use("/stock", stockRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // Zod validation
  if (err?.name === "ZodError") {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      details: err.issues?.map((i) => ({
        path: i.path?.join("."),
        message: i.message,
      })),
    });
  }

  const status = typeof err?.status === "number" ? err.status : 500;
  const message = status >= 500 ? "INTERNAL_SERVER_ERROR" : err.message;

  if (status >= 500) {
    // Keep server logs for debugging
    // eslint-disable-next-line no-console
    console.error(err);
  }

  return res.status(status).json({ error: message });
});

app.listen(config.port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${config.port}`);
});

