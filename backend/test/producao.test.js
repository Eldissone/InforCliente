const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const core = () => import(pathToFileURL(path.join(__dirname, "../../frontend/src/shared/comercial/producaoCore.js")).href);

const cal = { inicio: "2026-12-01", dias: 5, efic: 1, feriados: ["2026-12-25"] }; // 01/12 é terça

test("dias úteis: segunda a sexta, sem feriados", async () => {
  const P = await core();
  assert.deepEqual(P.diasUteis("2026-12-24", 3, cal), ["2026-12-24", "2026-12-28", "2026-12-29"]);
  assert.equal(P.proximoUtil("2026-12-05", cal), "2026-12-07");
});

test("duração = quantidade ÷ (rendimento × equipas × eficiência); dependências em sequência", async () => {
  const P = await core();
  const prod = {
    cal: { ...cal, efic: 0.8 },
    tarefas: [
      { id: "a", nome: "Abertura de caboucos", q: 90, rend: 10, equipas: 1, equipa: [{ f: "Servente", n: 4 }], maq: [{ tipo: "eq", nome: "Retro", n: 1 }], mat: [] },
      { id: "b", nome: "Arvoramento", q: 90, rend: 15, equipas: 2, dep: ["a"], equipa: [{ f: "Electricista", n: 3 }], maq: [], mat: [{ desc: "Poste 12m", un: "un", c: 1 }] },
    ],
    ind: [{ f: "Encarregado", n: 1, ded: 1 }],
  };
  const pl = P.planear(prod);
  const [a, b] = pl.tarefas;
  assert.equal(a.n, 12, "90 ÷ (10 × 0,8) = 11,25 → 12 dias");
  assert.equal(a.ini, "2026-12-01");
  assert.equal(a.fim, "2026-12-16");
  assert.equal(b.n, 4, "90 ÷ (15 × 2 × 0,8) = 3,75 → 4");
  assert.equal(b.ini, "2026-12-17");
  assert.equal(b.fim, "2026-12-22");
  assert.equal(pl.ind[0].dias.length, 16, "o encarregado está a obra toda");
  const rh = P.rhPorSemana(pl);
  const ele = rh.find((r) => r.f === "Electricista");
  assert.equal(ele.max, 6, "3 por equipa × 2 equipas");
  assert.equal(ele.pessoasDia, 24);
  const L = P.linhasParaFolhas(pl);
  assert.deepEqual(L.mat, [{ desc: "Poste 12m", un: "un", q: 90, orig: "tarefas", obs: "Consumo das tarefas" }]);
  assert.equal(L.eq[0].equip, "Retro");
  assert.equal(L.eq[0].d, 12);
  const M = P.metas(pl);
  assert.equal(Object.values(M[0].semanas).reduce((s, x) => s + x.q, 0).toFixed(2), "90.00");
});

test("aplicar às folhas: substitui as linhas «tarefas», mantém as manuais e o preço já posto", async () => {
  const P = await core();
  const atuais = [{ desc: "Areia", q: 5 }, { desc: "Poste 12m", q: 10, preco: 50000, orig: "tarefas" }];
  const r = P.aplicarFolha(atuais, [{ desc: "Poste 12m", q: 90, orig: "tarefas" }], "desc");
  assert.deepEqual(r, [{ desc: "Areia", q: 5 }, { desc: "Poste 12m", q: 90, preco: 50000, orig: "tarefas" }]);
});

test("EPI e alimentação pelas pessoas do plano; BoQ → tarefas sem repetir", async () => {
  const P = await core();
  const rh = [{ f: "Servente", max: 4, pessoasDia: 40 }, { f: "Encarregado", max: 1, pessoasDia: 10 }];
  const e = P.epi({ epi: { itens: [{ item: "Capacete", preco: 3000, por: { Servente: 1, Encarregado: 1 } }] } }, rh);
  assert.deepEqual([e.itens[0].pecas, e.total], [5, 15000]);
  assert.deepEqual(P.alimentacao({ alim: { ativo: true, refeicoes: 2, custo: 1500 } }, rh), { pessoasDia: 50, refeicoes: 100, total: 150000 });
  const T = P.tarefasDoMapa([{ desc: "Poste", un: "un", q: 10 }, { desc: "Cabo", un: "m", q: 0 }, { desc: "Poste", un: "un", q: 3 }], [{ nome: "Poste", un: "un" }]);
  assert.equal(T.length, 0);
});
