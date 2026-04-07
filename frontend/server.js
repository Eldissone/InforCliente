const express = require("express");
const path = require("path");

const app = express();

const port = Number(process.env.PORT || 5173);
const pagesRoot = path.join(__dirname, "src", "pages");

// Serve os arquivos estáticos do frontend (HTML/JS/CSS/assets)
app.use(express.static(pagesRoot));

// Também expõe o resto do /src pra permitir imports como /services e /shared
app.use("/src", express.static(path.join(__dirname, "src")));

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

