/**
 * `z.record()` no Zod 4 leva o tipo da chave à frente.
 *
 * No Zod 3, `z.record(valor)` era válido. No 4 o primeiro argumento é a chave,
 * e `z.record(z.any())` deixa o tipo do valor por preencher. Não dá erro ao
 * montar o esquema: dá erro ao validar, e só se o objeto tiver alguma chave —
 * um objeto vazio passa. Era isto que punha a gravação do orçamento a devolver
 * 500 («Cannot read properties of undefined (reading '_zod')»), e ao mesmo
 * tempo deixava os testes todos a passar.
 *
 * Estes testes olham para o código como ele está, não para uma cópia: leem os
 * ficheiros de `src/`, tiram de lá cada chamada a `z.record(` e verificam-na.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");

const SRC = path.join(__dirname, "..", "src");

function ficheirosJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ficheirosJs(p);
    return e.isFile() && e.name.endsWith(".js") ? [p] : [];
  });
}

/** Cada `z.record(...)` do ficheiro: o texto da chamada e a linha onde está. */
function chamadasRecord(texto) {
  const out = [];
  const marca = "z.record(";
  for (let i = texto.indexOf(marca); i !== -1; i = texto.indexOf(marca, i + 1)) {
    let nivel = 0;
    let fim = -1;
    const virgulas = [];
    for (let j = i + marca.length - 1; j < texto.length; j++) {
      const c = texto[j];
      if (c === "(") nivel++;
      else if (c === ")") {
        nivel--;
        if (nivel === 0) {
          fim = j;
          break;
        }
      } else if (c === "," && nivel === 1) virgulas.push(j);
    }
    assert.notEqual(fim, -1, "parêntesis sem fecho numa chamada a z.record");
    out.push({
      codigo: texto.slice(i, fim + 1),
      argumentos: virgulas.length + 1,
      linha: texto.slice(0, i).split("\n").length,
    });
  }
  return out;
}

const encontradas = ficheirosJs(SRC).flatMap((f) =>
  chamadasRecord(fs.readFileSync(f, "utf8")).map((c) => ({ ...c, ficheiro: path.relative(SRC, f) }))
);

// ─── O que o Zod 4 faz, para se saber porque é que a regra existe ───────────

test("no Zod 4, z.record com um argumento só rebenta ao validar", () => {
  const mal = z.record(z.any());
  assert.deepEqual(mal.parse({}), {}, "um objeto vazio passa — é isto que engana");
  assert.throws(() => mal.parse({ a: 1 }), /_zod/, "com uma chave, rebenta");
});

test("com o tipo da chave à frente, valida como se espera", () => {
  const bem = z.record(z.string(), z.any());
  assert.deepEqual(bem.parse({ a: 1, b: "x" }), { a: 1, b: "x" });
});

// ─── O código como está ────────────────────────────────────────────────────

test("há chamadas a z.record no código (senão este teste não guarda nada)", () => {
  assert.ok(encontradas.length > 0, "nenhuma chamada encontrada: o varrimento deixou de funcionar");
});

test("nenhum z.record fica sem o tipo da chave", () => {
  const faltam = encontradas.filter((c) => c.argumentos < 2);
  assert.deepEqual(
    faltam.map((c) => `${c.ficheiro}:${c.linha}`),
    [],
    "estes z.record só têm um argumento e vão devolver 500 com qualquer chave"
  );
});

test("cada z.record do código valida um objeto com chaves", () => {
  for (const c of encontradas) {
    const esquema = new Function("z", `return ${c.codigo};`)(z);
    const onde = `${c.ficheiro}:${c.linha}`;
    // Não se sabe que valores cada um aceita; o que importa é que a validação
    // chegue ao fim em vez de rebentar por falta do tipo do valor.
    try {
      esquema.parse({ alguma: [] });
    } catch (e) {
      assert.equal(e.name, "ZodError", `${onde} rebentou fora da validação: ${e.message}`);
    }
    try {
      esquema.parse({ alguma: { a: 1 } });
    } catch (e) {
      assert.equal(e.name, "ZodError", `${onde} rebentou fora da validação: ${e.message}`);
    }
  }
});
