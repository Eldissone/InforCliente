const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "dist");

if (!fs.existsSync(dist)) {
    fs.mkdirSync(dist);
}

console.log("🚀 Preparando build de produção...");

// Copiar server.js se necessário
fs.copyFileSync(
    path.join(__dirname, "server.js"),
    path.join(dist, "server.js")
);

console.log("✅ Build pronto para deploy (IIS ou static server)");