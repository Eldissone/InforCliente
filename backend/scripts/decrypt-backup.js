#!/usr/bin/env node
/**
 * Abre uma cópia .icbk gerada na área de Gestão.
 * Uso: node scripts/decrypt-backup.js caminho\cópia.icbk [saida.zip]
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { decryptFile } = require("../src/services/backup/crypto");

function askHidden(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      const rl = readline.createInterface({ input: stdin, output: process.stdout });
      rl.question(label, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      if (chunk === "\u0003") {
        stdin.setRawMode(false);
        reject(new Error("Cancelado."));
        return;
      }
      if (chunk === "\r" || chunk === "\n" || chunk === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (chunk === "\u007f" || chunk === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += chunk;
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Indique o ficheiro .icbk.");
    process.exit(1);
  }
  const src = path.resolve(input);
  if (!fs.existsSync(src)) {
    console.error("Ficheiro não encontrado.");
    process.exit(1);
  }
  const dest = path.resolve(process.argv[3] || src.replace(/\.icbk$/i, "") + ".zip");
  const passphrase = await askHidden("Frase-passe: ");
  if (!passphrase) {
    console.error("Frase-passe em falta.");
    process.exit(1);
  }
  await decryptFile(src, dest, passphrase);
  console.log(`Arquivo aberto em ${dest}`);
}

main().catch((error) => {
  console.error(error.message || "Não foi possível abrir a cópia.");
  process.exit(1);
});
