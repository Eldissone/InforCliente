const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();

const port = process.env.PORT || 5173;
const pagesRoot = path.join(__dirname, "src", "pages");
const srcRoot = path.join(__dirname, "src");

// Serve environment variables as a JS module
app.get("/services/config.js", (req, res) => {
  res.type("application/javascript");
  const config = {
    API_BASE_URL: process.env.API_BASE_URL || "https://infoback-c2mt.onrender.com"
  };
  res.send(`export const config = ${JSON.stringify(config)};`);
});

// Serve os arquivos estáticos do frontend (HTML/JS/CSS/assets)
app.use(express.static(pagesRoot));

// Expõe /src inteiro (opcional)
app.use("/src", express.static(srcRoot));

// Suporte aos imports atuais que resolvem para /services/* e /shared/*
app.use("/services", express.static(path.join(srcRoot, "services")));
app.use("/shared", express.static(path.join(srcRoot, "shared")));
app.use("/assets", express.static(path.join(srcRoot, "assets")));
app.use("/components", express.static(path.join(srcRoot, "components")));
app.use("/hooks", express.static(path.join(srcRoot, "hooks")));
app.use("/types", express.static(path.join(srcRoot, "types")));
app.use("/context", express.static(path.join(srcRoot, "context")));
app.use("/routes", express.static(path.join(srcRoot, "routes")));

// Rota padrão → login
app.get("/", (_req, res) => {
  res.redirect("/Auth/login.html");
});

// Helper: permitir acessar /Dashboard, /Clientes, /Projectos como diretórios
app.get("/:section", (req, res, next) => {
  const section = req.params.section;
  const file = path.join(pagesRoot, section, "index.html");
  res.sendFile(file, (err) => (err ? next() : undefined));
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Frontend em http://localhost:${port}`);
});

