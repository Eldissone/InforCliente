const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const PR = require("../src/services/proposal/render");
const { uploadToSupabase } = require("../src/utils/storage");

/**
 * A extração mete as imagens dentro do ficheiro.
 *
 * O documento guarda caminhos (`uploads/…`); o PDF e o HTML extraídos têm de
 * abrir em qualquer lado, sem depender do servidor. Se a imagem não for
 * embebida, o PDF sai com um quadrado vazio onde devia estar a fotografia.
 */
test("as imagens entram no documento ao extrair", async () => {
  // Um PNG de 1 pixel, gravado como qualquer imagem da proposta.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const caminho = await uploadToSupabase(`propostas/__teste__/${Date.now()}.png`, png, "image/png");
  try {
    const doc = {
      capa: { imagem: caminho },
      memoria: { fotos: [{ imagem: caminho, legenda: "Uma foto" }] },
      extras: [{ zona: "anexos", tipo: "imagem", imagem: caminho }],
      contactos: { assinatura: { img: caminho } },
      tracado: { mapas: [{ imagem: caminho }] },
    };
    const saida = await PR.inlineImages(JSON.parse(JSON.stringify(doc)));
    for (const v of [
      saida.capa.imagem,
      saida.memoria.fotos[0].imagem,
      saida.extras[0].imagem,
      saida.contactos.assinatura.img,
      saida.tracado.mapas[0].imagem,
    ]) {
      assert.match(v, /^data:image\/png;base64,/, "a imagem devia estar dentro do documento");
    }
  } finally {
    const local = path.join(__dirname, "..", caminho.replace(/^uploads\//, "uploads/"));
    try { fs.unlinkSync(local); } catch { /* já não está lá */ }
  }
});

test("uma imagem que já não está lá não impede a extração", async () => {
  const doc = { capa: { imagem: "uploads/propostas/nao-existe.png" }, memoria: { fotos: [] }, extras: [] };
  const saida = await PR.inlineImages(doc);
  assert.equal(saida.capa.imagem, "uploads/propostas/nao-existe.png", "fica o caminho, sem rebentar");
});

test("um endereço externo fica como está", async () => {
  const doc = { capa: { imagem: "https://exemplo.ao/logo.png" }, memoria: { fotos: [] }, extras: [] };
  const saida = await PR.inlineImages(doc);
  assert.equal(saida.capa.imagem, "https://exemplo.ao/logo.png");
});
