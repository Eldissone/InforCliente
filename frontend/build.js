const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "dist");
const src = path.join(__dirname, "src");

// 1. Limpar ou criar a pasta dist
if (fs.existsSync(dist)) {
    console.log("Cleaning old dist folder...");
    fs.rmSync(dist, { recursive: true, force: true });
}
fs.mkdirSync(dist);

console.log("🚀 Preparando build de produção...");

// 2. Copiar a pasta src inteira (HTML, JS, CSS, Assets)
console.log("Copying src folder...");
fs.cpSync(src, path.join(dist, "src"), { recursive: true });

// 3. Copiar server.js para a raiz da dist
console.log("Copying server.js...");
fs.copyFileSync(
    path.join(__dirname, "server.js"),
    path.join(dist, "server.js")
);

// 4. Copiar web.config para o IIS
console.log("Copying web.config...");
fs.copyFileSync(
    path.join(__dirname, "web.config"),
    path.join(dist, "web.config")
);

console.log("✅ Build pronto na pasta /dist para deploy no IIS");