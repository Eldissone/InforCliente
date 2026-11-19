/**
 * Gera o espelho ESM do motor de cálculo do orçamento, para o frontend.
 *
 *   node scripts/gen-budget-calc-mirror.cjs
 *
 * A FONTE DA VERDADE é `src/services/budget/calc.js`. Este script transforma-o em
 * ESM (require → import, module.exports → export) e escreve
 * `frontend/src/shared/comercial/budgetCalc.js`.
 *
 * Correr sempre que o motor mudar. `test/budgetCalc.test.js` compara os dois e
 * falha se estiverem dessincronizados.
 */

const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "../src/services/budget/calc.js");
const DST = path.resolve(__dirname, "../../frontend/src/shared/comercial/budgetCalc.js");

const HEADER = `/**
 * Motor de cálculo do orçamento — ESPELHO, para o ecrã responder enquanto se escreve.
 *
 * GERADO a partir de \`backend/src/services/budget/calc.js\`, que é a FONTE DA VERDADE.
 * Não editar à mão: altere o ficheiro do backend e gere outra vez com
 * \`node scripts/gen-budget-calc-mirror.cjs\` (na pasta backend).
 *
 * \`backend/test/budgetCalc.test.js\` importa este ficheiro e compara os resultados
 * com os do backend: se divergirem, o teste falha.
 */
`;

function main() {
  let s = fs.readFileSync(SRC, "utf8");

  // 1) cabeçalho próprio
  s = s.replace(/^\/\*\*[\s\S]*?\*\/\n/, HEADER);

  // 2) as fórmulas dos baremes vêm do espelho delas, não do serviço do backend
  const req = /const \{([^}]*)\} = require\("\.\/baremCost"\);/;
  const m0 = req.exec(s);
  if (!m0) throw new Error("Não encontrei o require do baremCost; ajuste este script.");
  s = s.replace(req, `import {${m0[1]}} from "./baremFormulas.js";`);

  // 3) module.exports → export
  const m = /module\.exports = \{([\s\S]*?)\n\};\s*$/.exec(s);
  if (!m) throw new Error("Não encontrei o module.exports no fim do ficheiro.");
  const names = m[1]
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  s = s.slice(0, m.index) + "export {\n" + names.map((n) => `  ${n},`).join("\n") + "\n};\n";

  if (/\brequire\(/.test(s) || /module\.exports/.test(s)) {
    throw new Error("Ainda há sintaxe CommonJS no espelho.");
  }

  fs.mkdirSync(path.dirname(DST), { recursive: true });
  fs.writeFileSync(DST, s, "utf8");
  console.log(`Espelho gerado: ${path.relative(process.cwd(), DST)} (${s.split("\n").length} linhas, ${names.length} exportações)`);
}

main();
