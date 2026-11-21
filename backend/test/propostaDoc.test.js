const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PD = require("../src/services/proposal/document");

/**
 * O esquema do editor da proposta (frontend) contra o documento que o servidor
 * monta.
 *
 * O ponto destes testes: **o ecrã e o documento não podem divergir**. Cada
 * campo do editor aponta a um caminho dentro do documento; se alguém mudar o
 * documento sem mudar o editor (ou ao contrário), o editor passa a escrever num
 * sítio que o modelo não lê — e o campo desaparece da proposta sem erro nenhum.
 */

const modulePath = path.join(__dirname, "..", "..", "frontend", "src", "shared", "comercial", "propostaDoc.js");
let M;

test.before(async () => {
  M = await import(pathToFileURL(modulePath).href);
});

const orcamento = () => ({
  number: "ORC-2026-0001",
  revision: "R0",
  params: {
    obra: "Electrificação do Longonjo",
    cliente: "Governo Provincial",
    local: "Longonjo, Huambo",
    moedaBase: "AOA",
    iva: 0.14,
    inicio: "2026-12-01",
    fim: "2027-05-30",
    metodo: "PRECO_DADO",
  },
  lists: {},
  sheets: { qt: [{ cod: "1.1", desc: "Abertura de cova", un: "un", q: 10, pu: 1000, grupo: "1 - REDE MT" }] },
  dispatch: {},
});

test("todas as secções do editor têm zona, título e campos", () => {
  const zonas = new Set();
  for (const s of M.SECTIONS) {
    assert.ok(s.zona, "secção sem zona");
    assert.ok(!zonas.has(s.zona), `zona repetida: ${s.zona}`);
    zonas.add(s.zona);
    assert.ok(s.titulo, `${s.zona}: sem título`);
    assert.ok(Array.isArray(s.campos), `${s.zona}: campos não é lista`);
    for (const c of s.campos) {
      assert.ok(c.path, `${s.zona}: campo sem caminho`);
      assert.ok(c.label, `${s.zona}.${c.path}: campo sem rótulo`);
      if (c.kind === "list") {
        assert.ok(Array.isArray(c.item) && c.item.length, `${s.zona}.${c.path}: lista sem campos de linha`);
        assert.ok(c.novo && typeof c.novo === "object", `${s.zona}.${c.path}: lista sem linha nova`);
      }
    }
  }
});

test("cada campo do editor aponta a um sítio que existe no documento", () => {
  const doc = PD.buildDocument([orcamento()], { reference: "PROP-2026-0001" });
  for (const s of M.SECTIONS) {
    for (const c of s.campos) {
      // A raiz do caminho tem de ser um campo do documento; o resto pode ainda
      // estar vazio (o traçado e o quadro resumo nascem nulos, de propósito).
      const raiz = c.path.split(".")[0];
      assert.ok(raiz in doc, `${s.zona}: o documento não tem «${raiz}» (campo ${c.path})`);
      if (c.kind === "list" && doc[raiz] !== null) {
        const v = M.getPath(doc, c.path);
        assert.ok(v === undefined || Array.isArray(v), `${c.path} devia ser uma lista, é ${typeof v}`);
      }
    }
  }
});

test("as zonas com anexos são as do protótipo", () => {
  assert.deepEqual(M.ZONAS_COM_ANEXOS, [
    "objectivo", "memoria", "condicoes", "quadro", "tracado", "cronograma",
    "equipamentos", "organograma", "execucao", "qsa", "comercial", "financeiro", "anexos",
  ]);
});

test("escrever num caminho cria o que falta pelo meio", () => {
  const doc = PD.buildDocument([orcamento()]);
  assert.equal(doc.tracado, null, "o traçado nasce vazio");
  M.setPath(doc, "tracado.criterios.0.titulo", "Adequação ao terreno");
  assert.equal(doc.tracado.criterios[0].titulo, "Adequação ao terreno");
  assert.ok(Array.isArray(doc.tracado.criterios), "o segmento numérico cria uma lista");
  M.setPath(doc, "quadro_resumo.texto", "Resumo");
  assert.equal(doc.quadro_resumo.texto, "Resumo");
});

test("ler um caminho que não existe devolve indefinido, não rebenta", () => {
  const doc = PD.buildDocument([orcamento()]);
  assert.equal(M.getPath(doc, "tracado.criterios.3.titulo"), undefined);
  assert.equal(M.getPath(doc, ""), undefined);
  assert.equal(M.getPath(null, "a.b"), undefined);
});

test("acrescentar, retirar e mover linhas de uma lista", () => {
  const doc = PD.buildDocument([orcamento()]);
  const p = "memoria.seccoes";
  assert.equal(M.getPath(doc, p).length, 4, "a memória nasce com quatro pontos");
  const i = M.addItem(doc, p, { titulo: "Quinto", texto: "" });
  assert.equal(i, 4);
  assert.equal(M.getPath(doc, p)[4].titulo, "Quinto");

  M.moveItem(doc, p, 4, -1);
  assert.equal(M.getPath(doc, p)[3].titulo, "Quinto");

  M.removeItem(doc, p, 3);
  assert.equal(M.getPath(doc, p).length, 4);
  assert.ok(!M.getPath(doc, p).some((x) => x.titulo === "Quinto"));

  // Mover fora dos limites não faz nada nem perde linhas.
  M.moveItem(doc, p, 0, -1);
  M.moveItem(doc, p, 3, 1);
  assert.equal(M.getPath(doc, p).length, 4);
});

test("a linha nova é uma cópia: duas linhas novas não partilham o mesmo objeto", () => {
  const doc = PD.buildDocument([orcamento()]);
  const novo = { titulo: "Fase", texto: "" };
  M.addItem(doc, "condicoes_tecnicas.fases", novo);
  M.addItem(doc, "condicoes_tecnicas.fases", novo);
  const fases = M.getPath(doc, "condicoes_tecnicas.fases");
  fases[0].titulo = "Fase I";
  assert.equal(fases[1].titulo, "Fase", "mexer numa linha não mexe na outra");
});

test("o organograma vai e volta entre árvore e lista de níveis", () => {
  const raiz = {
    cargo: "Diretor de Obra",
    nome: "Ana",
    filhos: [
      { cargo: "Supervisor", nome: "Bento", filhos: [{ cargo: "Chefe de equipa", nome: "", filhos: [] }] },
      { cargo: "HSE", nome: "Carla", filhos: [] },
    ],
  };
  const rows = M.treeToRows(raiz);
  assert.deepEqual(
    rows.map((r) => `${r.nivel}:${r.cargo}`),
    ["0:Diretor de Obra", "1:Supervisor", "2:Chefe de equipa", "1:HSE"]
  );
  const volta = M.rowsToTree(rows);
  assert.deepEqual(volta, raiz);
});

test("um nível mal escrito no organograma não perde o cargo", () => {
  // Nível 3 logo a seguir ao topo: entra como filho do que está acima.
  const tree = M.rowsToTree([
    { nivel: 0, cargo: "Diretor", nome: "" },
    { nivel: 3, cargo: "Encarregado", nome: "" },
  ]);
  assert.equal(tree.filhos.length, 1);
  assert.equal(tree.filhos[0].cargo, "Encarregado");
});

test("o organograma também se escreve como texto indentado", () => {
  const texto = ["Diretor de Obra — Ana", "  Supervisor — Bento", "    Chefe de equipa", "  HSE — Carla"].join("\n");
  const rows = M.textToRows(texto);
  assert.deepEqual(rows.map((r) => r.nivel), [0, 1, 2, 1]);
  assert.equal(rows[0].nome, "Ana");
  assert.equal(rows[2].cargo, "Chefe de equipa");
  assert.equal(rows[2].nome, "");
  const arvore = M.rowsToTree(rows);
  assert.equal(arvore.filhos.length, 2);
  assert.equal(arvore.filhos[0].filhos[0].cargo, "Chefe de equipa");
  // E volta ao mesmo texto.
  assert.equal(M.rowsToText(M.treeToRows(arvore)), texto);
});

test("os anexos ficam agarrados à sua zona", () => {
  const doc = PD.buildDocument([orcamento()]);
  doc.extras = [
    M.novoAnexo("memoria", "imagem"),
    M.novoAnexo("anexos", "texto"),
    M.novoAnexo("memoria", "texto"),
  ];
  const daMemoria = M.anexosDaZona(doc, "memoria");
  assert.equal(daMemoria.length, 2);
  // O índice tem de ser o da lista completa, senão apagar o segundo da zona
  // apagava o primeiro de outra.
  assert.deepEqual(daMemoria.map((a) => a.i), [0, 2]);
  assert.equal(M.anexosDaZona(doc, "quadro").length, 0);
});

test("o documento editado continua a ser o que o modelo desenha", () => {
  // Depois de o editor mexer em tudo o que sabe mexer, o documento tem de
  // continuar a passar pelo `finalizeDocument` sem perder nada do que tem texto.
  const doc = PD.buildDocument([orcamento()]);
  M.setPath(doc, "objectivo", "Objectivo escrito.");
  M.setPath(doc, "memoria.seccoes.0.texto", "Enquadramento escrito.");
  M.setPath(doc, "tracado.texto", "Traçado escrito.");
  M.setPath(doc, "quadro_resumo.texto", "Quadro escrito.");
  M.setPath(doc, "quadro_resumo.linhas", [{ obra: "Ucuma", mt: 23, pt: 3, bt: 12, lum: 40, lig: 200 }]);
  const fin = PD.finalizeDocument(doc);
  assert.equal(fin.objectivo, "Objectivo escrito.");
  assert.equal(fin.memoria.seccoes.length, 1);
  assert.equal(fin.tracado.texto, "Traçado escrito.");
  assert.equal(fin.quadro_resumo.linhas[0].obra, "Ucuma");
});

test("as imagens do documento são caminhos, e quem mostra é que os resolve", () => {
  const doc = PD.buildDocument([orcamento()]);
  doc.capa.imagem = "uploads/propostas/1/capa.jpg";
  doc.contactos.assinatura.img = "uploads/propostas/1/assinatura.png";
  doc.memoria.fotos = [{ imagem: "uploads/propostas/1/foto1.jpg", legenda: "Apoio 12" }];
  doc.extras = [{ zona: "tracado", tipo: "imagem", imagem: "uploads/propostas/1/mapa.png" }];
  doc.tracado = { texto: "", criterios: [], mapas: [{ imagem: "uploads/propostas/1/mapa2.png" }] };

  const visto = M.mapImages(JSON.parse(JSON.stringify(doc)), (v) => `https://servidor/${v}`);
  assert.equal(visto.capa.imagem, "https://servidor/uploads/propostas/1/capa.jpg");
  assert.equal(visto.contactos.assinatura.img, "https://servidor/uploads/propostas/1/assinatura.png");
  assert.equal(visto.memoria.fotos[0].imagem, "https://servidor/uploads/propostas/1/foto1.jpg");
  assert.equal(visto.extras[0].imagem, "https://servidor/uploads/propostas/1/mapa.png");
  assert.equal(visto.tracado.mapas[0].imagem, "https://servidor/uploads/propostas/1/mapa2.png");
  // O original fica intacto: é ele que se grava.
  assert.equal(doc.capa.imagem, "uploads/propostas/1/capa.jpg");
});

test("um documento sem imagens passa pelo resolvedor sem queixa", () => {
  const doc = PD.buildDocument([orcamento()]);
  assert.doesNotThrow(() => M.mapImages(doc, (v) => v));
  assert.equal(M.mapImages(null, (v) => v), null);
});
