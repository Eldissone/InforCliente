/**
 * O assistente de baremes: descreve-se o recurso por palavras, a IA calcula.
 *
 * Mostra a proposta **com a conta feita em cada campo**, o que a IA teve de
 * assumir e as perguntas que tornariam o cálculo mais exacto — e só escreve no
 * formulário quando se carrega em «Aplicar». Nada vai para a biblioteca de
 * baremes sem passar pelo formulário de sempre, com as validações de sempre.
 */

import { apiRequest } from "/services/api.js";
import { toast, escapeHtml } from "/shared/ui.js";

const esc = (v) => escapeHtml(String(v ?? ""));
const attr = (v) => esc(v).replace(/"/g, "&quot;");
const el = (id) => document.getElementById(id);
const fmt = (v, d = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Exemplos de descrição, um por tipo. */
const EXEMPLOS = {
  RH: "Eletricista de 1.ª, salário base 440 000 AOA/mês, encargos de 8%, subsídio de alimentação de 2 500 por dia e transporte de 1 000 por dia.",
  EQUIPAMENTO:
    "Retroescavadora JCB 3CX própria, comprada em 2021 por 98 000 000 AOA, trabalha cerca de 1 500 h/ano, consome ~8 L/h de gasóleo. Ou: autogrua de 50 t alugada a 650 000 AOA/dia, operador incluído.",
  VIATURA:
    "Toyota Hilux 2.8 cabine dupla de 2022, comprada por 32 000 000 AOA, vida útil de 5 anos com valor residual de 20%, faz ~3 000 km/mês em estradas de terra.",
  FERRAMENTA: "Megóhmetro Megger de 5 kV comprado por 1 900 000 AOA, dura cerca de 5 anos, calibração anual de 120 000. Ou: discos de corte de 115 mm a 1 900 AOA cada.",
  LOGISTICA: "Aluguer de contentor de 20 pés no Huambo, cotação de 120 000 AOA por mês, transporte de ida e volta incluído.",
};

const S = {
  modo: "calcular",
  kind: "RH",
  campos: [],
  rotulos: {},
  descricao: "",
  pergunta: "",
  resultado: null,
  calculado: null,
  resposta: "",
  aCorrer: false,
  onAplicar: null,
};

const PILL = { alta: "is-good", média: "is-warn", baixa: "is-bad" };

function corpo() {
  if (S.modo === "duvida") {
    return `
      <p class="cm-lead">Pergunte como calcular qualquer barem ou custo. Exemplo: «Como calculo a depreciação mensal de uma Hilux de 2019 comprada em segunda mão?»</p>
      <textarea id="baQ" class="cell-manual" rows="3" placeholder="Escreva a sua dúvida">${esc(S.pergunta)}</textarea>
      <div class="cm-head-actions" style="margin-top:.5rem">
        <button class="cm-chip is-on" type="button" id="baPerguntar" ${S.aCorrer ? "disabled" : ""}>${S.aCorrer ? "A pensar…" : "Perguntar"}</button>
        <span class="cm-lead" id="baMsg" style="margin:0"></span>
      </div>
      ${S.resposta ? `<div class="ba-resposta">${esc(S.resposta)}</div>` : ""}`;
  }

  const r = S.resultado;
  return `
    <p class="cm-lead">
      Descreva o recurso com tudo o que sabe: tipo, marca e modelo, ano, preço de compra ou de aluguer,
      uso previsto, consumos, salários. O que faltar, o assistente estima — e diz-lhe o que assumiu.
    </p>
    <textarea id="baDesc" class="cell-manual" rows="4" placeholder="${attr(EXEMPLOS[S.kind] || "")}">${esc(S.descricao)}</textarea>
    <div class="cm-head-actions" style="margin-top:.5rem">
      <button class="cm-chip is-on" type="button" id="baCalcular" ${S.aCorrer ? "disabled" : ""}>${S.aCorrer ? "A calcular…" : "✦ Calcular proposta"}</button>
      <span class="cm-lead" id="baMsg" style="margin:0"></span>
    </div>
    ${r ? resultadoHtml(r) : ""}`;
}

function resultadoHtml(r) {
  const linha = (f) => {
    const v = r.campos[f.k];
    const valor = f.ty === "pct" ? (v === null ? "" : Math.round(Number(v) * 1e6) / 1e4) : v === null ? "" : v;
    const entrada =
      f.ty === "text" || f.ty === "sel" || f.ty === "fuel"
        ? `<input class="cell-manual" type="text" value="${attr(valor)}" data-bak="${attr(f.k)}">`
        : `<input class="cell-manual cell-num" type="number" step="any" value="${attr(valor)}" data-bak="${attr(f.k)}">`;
    return `<tr>
      <td>${esc(f.l)}${f.ty === "pct" ? " (%)" : ""}</td>
      <td style="width:9rem">${entrada}</td>
      <td class="ba-conta">${esc(r.explicacoes[f.k] || "")}</td>
    </tr>`;
  };

  return `
    <section class="ba-res">
      <div class="ba-res-cab">
        <h3>Proposta de barem</h3>
        <span class="cm-pill ${PILL[r.confianca] || "is-warn"}">confiança ${esc(r.confianca)}</span>
        ${S.calculado ? `<span class="ba-custo">O programa calcula <b>${fmt(S.calculado.computedCost)}</b></span>` : ""}
      </div>
      ${r.resumo ? `<p class="cm-lead">${esc(r.resumo)}</p>` : ""}
      ${r.ownership ? `<p class="cm-lead">Posse: <b>${esc(r.ownership)}</b></p>` : ""}
      ${r.unit ? `<p class="cm-lead">Unidade de custo: <b>${esc(r.unit)}</b></p>` : ""}

      <table class="cm-table ba-tabela">
        <thead><tr><th>Campo</th><th>Valor proposto</th><th>Como foi calculado</th></tr></thead>
        <tbody>${S.campos.map(linha).join("")}</tbody>
      </table>

      ${
        r.pressupostos.length
          ? `<h4>Pressupostos e estimativas</h4><ul class="ba-lista">${r.pressupostos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
          : ""
      }
      ${
        r.perguntas.length
          ? `<h4>Para afinar o cálculo</h4>
             <ul class="ba-lista">${r.perguntas.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
             <textarea id="baFollow" class="cell-manual" rows="2" placeholder="Responda aqui (pode responder só a algumas) e carregue em Recalcular."></textarea>
             <div class="cm-head-actions" style="margin-top:.4rem">
               <button class="cm-chip" type="button" id="baRecalcular" ${S.aCorrer ? "disabled" : ""}>Recalcular com estas respostas</button>
             </div>`
          : ""
      }

      <div class="cm-head-actions" style="margin-top:.75rem">
        <button class="cm-chip is-on" type="button" id="baAplicar">Aplicar ao formulário</button>
      </div>
      <p class="ba-nota">
        Valores indicativos calculados por IA. Confirme com facturas, cotações e a folha de salários
        antes de os usar numa proposta.
      </p>
    </section>`;
}

function desenhar() {
  const host = el("cmDrawer");
  if (!host) return;
  host.innerHTML = `
    <div class="cm-wizard-backdrop" id="baBackdrop"><div class="cm-panel cm-wizard ba-wizard">
      <div class="cm-head" style="margin-bottom:.5rem">
        <div>
          <div class="cm-head-num">Assistente de baremes (IA)</div>
          <h2 class="cm-panel-title" style="font-size:1.0625rem">${S.modo === "calcular" ? "Calcular um barem" : "Tirar uma dúvida"}</h2>
        </div>
        <button class="cm-chip" type="button" id="baFechar">Fechar</button>
      </div>
      <div class="cm-head-actions" style="margin-bottom:.75rem">
        <button class="cm-chip${S.modo === "calcular" ? " is-on" : ""}" type="button" data-bamodo="calcular">Calcular barem</button>
        <button class="cm-chip${S.modo === "duvida" ? " is-on" : ""}" type="button" data-bamodo="duvida">Tirar uma dúvida</button>
      </div>
      ${corpo()}
    </div></div>`;
}

/* ─── Pedidos ───────────────────────────────────────────────────────────── */

async function pedir(corpoPedido) {
  S.aCorrer = true;
  desenhar();
  if (el("baMsg")) el("baMsg").textContent = "A IA está a calcular. Pode demorar até um minuto.";
  try {
    return await apiRequest("/baremes/ai", { method: "POST", body: corpoPedido });
  } finally {
    S.aCorrer = false;
  }
}

async function calcular(respostas) {
  const desc = el("baDesc")?.value?.trim() ?? S.descricao;
  S.descricao = desc;
  if (desc.length < 8) {
    if (el("baMsg")) el("baMsg").textContent = "Descreva o recurso primeiro.";
    return;
  }
  try {
    const r = await pedir({
      modo: "calcular",
      kind: S.kind,
      descricao: desc,
      ...(respostas ? { anterior: S.resultado, respostas } : {}),
    });
    S.resultado = r.resultado;
    S.calculado = r.calculado;
    desenhar();
  } catch (err) {
    desenhar();
    if (el("baMsg")) el("baMsg").textContent = err.message;
    toast(err.message || "A IA não está disponível.", { type: "error" });
  }
}

async function perguntar() {
  const q = el("baQ")?.value?.trim() || "";
  S.pergunta = q;
  if (!q) return;
  try {
    const r = await pedir({ modo: "duvida", pergunta: q });
    S.resposta = r.resposta;
    desenhar();
  } catch (err) {
    desenhar();
    if (el("baMsg")) el("baMsg").textContent = err.message;
  }
}

/** Lê o que está na tabela (com as correções à mão) e entrega-o ao ecrã. */
function aplicar() {
  const campos = {};
  for (const f of S.campos) {
    const input = document.querySelector(`[data-bak="${f.k}"]`);
    if (!input) continue;
    const v = input.value.trim();
    if (f.ty === "text" || f.ty === "sel" || f.ty === "fuel") campos[f.k] = v || null;
    else {
      const n = v === "" ? null : Number(v.replace(",", "."));
      campos[f.k] = n === null || Number.isNaN(n) ? null : f.ty === "pct" ? n / 100 : n;
    }
  }
  el("cmDrawer").innerHTML = "";
  S.onAplicar?.({
    kind: S.kind,
    campos,
    ownership: S.resultado?.ownership || null,
    unit: S.resultado?.unit || null,
    nome: S.descricao.split(/[,.;\n]/)[0].slice(0, 80),
  });
}

/* ─── Ligações ──────────────────────────────────────────────────────────── */

export function wireAssistente() {
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("#baFechar,#baCalcular,#baRecalcular,#baPerguntar,#baAplicar,[data-bamodo]");
    if (!t) return;
    if (t.id === "baFechar") {
      el("cmDrawer").innerHTML = "";
      return;
    }
    if (t.dataset.bamodo) {
      S.modo = t.dataset.bamodo;
      desenhar();
      return;
    }
    if (t.id === "baCalcular") return calcular(null);
    if (t.id === "baRecalcular") return calcular(el("baFollow")?.value?.trim() || "");
    if (t.id === "baPerguntar") return perguntar();
    if (t.id === "baAplicar") return aplicar();
  });
}

/**
 * Abre o assistente.
 *
 * @param {string} o.kind tipo de barem (o separador aberto)
 * @param {object[]} o.campos definição dos campos desse tipo (`meta.fields[kind]`)
 * @param {(p:object) => void} o.onAplicar o que fazer com a proposta aceite
 */
export function abrirAssistente({ kind, campos, onAplicar }) {
  S.modo = "calcular";
  S.kind = kind;
  S.campos = campos || [];
  S.descricao = "";
  S.pergunta = "";
  S.resultado = null;
  S.calculado = null;
  S.resposta = "";
  S.aCorrer = false;
  S.onAplicar = onAplicar || null;
  desenhar();
}
