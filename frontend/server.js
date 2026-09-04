const express = require("express");
const path = require("path");
const http = require("http");
const https = require("https");
require("dotenv").config();

const app = express();

const port = process.env.PORT || 5173;
const apiBase = (process.env.API_BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const pagesRoot = path.join(__dirname, "src", "pages");
const srcRoot = path.join(__dirname, "src");

// Serve environment variables as a JS module
app.get("/services/config.js", (req, res) => {
  res.type("application/javascript");
  const config = {
    API_BASE_URL: process.env.API_BASE_URL || "http://localhost:5000"
  };
  res.send(`export const config = ${JSON.stringify(config)};`);
});

// Proxy de uploads para o backend (miniaturas; reencaminha JWT em header ou ?token=)
app.use("/uploads", (req, res) => {
  const target = `${apiBase}${req.originalUrl}`;
  let u;
  try {
    u = new URL(target);
  } catch {
    return res.status(502).send("Erro ao carregar ficheiro do servidor API.");
  }
  const lib = u.protocol === "https:" ? https : http;
  const headers = {};
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  const proxyReq = lib.request(
    {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: "GET",
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", () => res.status(502).send("Erro ao carregar ficheiro do servidor API."));
  proxyReq.end();
});

// Remove .html da URL para SEO e consistência
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const newUrl = req.originalUrl.replace(/\.html(\?.*)?$/, '$1');
    return res.redirect(301, newUrl);
  }
  next();
});

// Serve os arquivos estáticos do frontend (HTML/JS/CSS/assets)
app.use(express.static(pagesRoot, { extensions: ['html'] }));

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
  res.redirect("/Auth/login");
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

