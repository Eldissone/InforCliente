/**
 * Importar um orçamento de uma folha de Excel, com a IA a ler as linhas.
 *
 * Três passos, e o do meio não se salta:
 *   1. escolher o ficheiro;
 *   2. **rever** o que a IA percebeu — linha a linha, com o que ela não soube
 *      assinalado e os repetidos já desmarcados;
 *   3. criar o orçamento com o que ficou marcado.
 *
 * O ficheiro não se guarda em lado nenhum: é lido, analisado e esquecido.
 */

import { apiRequest, getApiBaseUrl } from "/services/api.js";
import { getToken } from "/services/auth.js";
import { toast, escapeHtml } from "/shared/ui.js";

const esc = (v) => escapeHtml(String(v ?? ""));
const attr = (v) => esc(v).replace(/"/g, "&quot;");
const el = (id) => document.getElementById(id);
const fmt = (v, d = 0) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d });

const CATS = [
  ["material", "Material"],
  ["rh", "Mão de obra"],
  ["equipamento", "Equipamento"],
  ["viatura", "Viatura"],
  ["ferramenta", "Ferramenta"],
  ["subempreitada", "Subempreitada"],
  ["logistica", "Logística"],
];

const DESTINOS = [
  ["mapa", "Mapa de quantidades (o que se vende ao cliente)"],
  ["custo", "Folhas de custo (materiais, mão de obra, equipamentos…)"],
];

const S = {
  passo: "ficheiro",
  ficheiro: null,
  analise: null,
  destino: "mapa",
  form: null,
  aCorrer: false,
  onCriado: null,
};

/* ─── Desenho ───────────────────────────────────────────────────────────── */

function envolver(corpo) {
  return `<div class="cm-wizard-backdrop" id="impBackdrop"><div class="cm-panel cm-wizard imp-wizard">
    <div class="cm-head" style="margin-bottom:.5rem">
      <div>
        <div class="cm-head-num">Comercial · importar</div>
        <h2 class="cm-panel-title" style="font-size:1.0625rem">Importar um orçamento de Excel</h2>
      </div>
      <button class="cm-chip" type="button" id="impFechar">Fechar</button>
    </div>
    ${corpo}
  </div></div>`;
}

function passoFicheiro() {
  return envolver(`
    <p class="cm-lead">
      A IA lê a folha e diz, linha a linha, o que é cada artigo e a que barem corresponde.
      Depois mostra tudo para rever: nada entra no orçamento sem passar por si.
      O ficheiro não fica guardado.
    </p>
    <div class="imp-drop">
      <input type="file" id="impFile" accept=".xlsx,.xls,.csv" />
      <small>.xlsx, .xls ou .csv — até 12 MB</small>
    </div>
    <div class="cm-head-actions" style="margin-top:.75rem">
      <button class="cm-chip is-on" type="button" id="impAnalisar" ${S.aCorrer ? "disabled" : ""}>
        ${S.aCorrer ? "A ler a folha…" : '<span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">auto_awesome</span> Analisar com a IA'}
      </button>
      <span class="cm-lead" id="impMsg" style="margin:0"></span>
    </div>`);
}

function linhaHtml(x, i) {
  const aviso = x.dup ? `<span class="imp-dup" title="${attr(x.dup)}">repetido</span>` : "";
  const semPreco = x.pu === null ? `<span class="imp-falta" title="A folha não tinha preço">sem preço</span>` : "";
  return `<tr class="${x.on ? "" : "imp-off"}">
    <td><input type="checkbox" data-imp="${i}|on" ${x.on ? "checked" : ""}></td>
    <td><input class="cell-manual" type="text" style="width:4.5rem" value="${attr(x.cod)}" data-imp="${i}|cod"></td>
    <td>
      <input class="cell-manual" type="text" value="${attr(x.desc)}" data-imp="${i}|desc">
      <div class="imp-meta">${esc(x.grupo || "")} ${aviso} ${semPreco}</div>
    </td>
    <td>
      <select class="cell-manual" data-imp="${i}|cat">
        ${CATS.map(([k, l]) => `<option value="${k}"${x.cat === k ? " selected" : ""}>${esc(l)}</option>`).join("")}
      </select>
      ${x.barem ? `<div class="imp-meta imp-barem" title="Ligado a um barem que já existe">${esc(x.barem)}</div>` : ""}
    </td>
    <td><input class="cell-manual" type="text" style="width:3.5rem" value="${attr(x.un)}" data-imp="${i}|un"></td>
    <td><input class="cell-manual cell-num" type="number" step="any" style="width:6rem" value="${attr(x.q)}" data-imp="${i}|q"></td>
    <td><input class="cell-manual cell-num" type="number" step="any" style="width:8rem" value="${x.pu === null ? "" : attr(x.pu)}" data-imp="${i}|pu" placeholder="—"></td>
    <td class="cell-num">${fmt(x.custo)}</td>
  </tr>`;
}

function passoRever() {
  const A = S.analise;
  const F = S.form;
  const marcados = A.itens.filter((x) => x.on);
  const total = marcados.reduce((a, x) => a + (Number(x.custo) || 0), 0);
  const semPreco = marcados.filter((x) => x.pu === null).length;
  const campo = (k, label, ph = "") =>
    `<label class="pe-campo"><span>${esc(label)}</span>
      <input class="cell-manual" type="text" value="${attr(F[k])}" data-impf="${k}" placeholder="${attr(ph)}"></label>`;

  return envolver(`
    <p class="cm-lead">
      A IA leu <b>${A.analisadas}</b> linha(s) de «${esc(A.ficheiro)}» e encontrou <b>${A.itens.length}</b> artigo(s).
      Reveja antes de criar: os repetidos de outras folhas já vêm desmarcados.
    </p>

    <div class="imp-cab">
      ${campo("projectName", "Obra", "nome da obra")}
      ${campo("location", "Local")}
      ${campo("responsibleName", "Responsável")}
      <label class="pe-campo"><span>As linhas vão para</span>
        <select class="cell-manual" id="impDestino">
          ${DESTINOS.map(([k, l]) => `<option value="${k}"${S.destino === k ? " selected" : ""}>${esc(l)}</option>`).join("")}
        </select>
      </label>
    </div>

    <div class="imp-resumo">
      <span><b>${marcados.length}</b> linha(s) marcadas</span>
      <span>Total <b>${fmt(total)}</b></span>
      ${semPreco ? `<span class="imp-falta">${semPreco} sem preço</span>` : ""}
      <span class="imp-acts">
        <button type="button" class="cm-chip" data-impall="1">Marcar todas</button>
        <button type="button" class="cm-chip" data-impall="0">Desmarcar todas</button>
      </span>
    </div>

    <div class="imp-tabela">
      <table class="cm-table">
        <thead><tr><th></th><th>Cód.</th><th>Designação</th><th>Categoria</th><th>Un.</th><th>Qtd.</th><th>Preço un.</th><th>Custo</th></tr></thead>
        <tbody>${A.itens.map(linhaHtml).join("")}</tbody>
      </table>
    </div>

    <div class="cm-head-actions" style="margin-top:.75rem">
      <button class="cm-chip" type="button" id="impVoltar">‹ Outro ficheiro</button>
      <button class="cm-chip is-on" type="button" id="impCriar" ${S.aCorrer ? "disabled" : ""}>
        ${S.aCorrer ? "A criar…" : `Criar o orçamento com ${marcados.length} linha(s)`}
      </button>
      <span class="cm-lead" id="impMsg" style="margin:0"></span>
    </div>`);
}

function desenhar() {
  const host = el("cmDrawer");
  if (!host) return;
  host.innerHTML = S.passo === "ficheiro" ? passoFicheiro() : passoRever();
}

/* ─── Acções ────────────────────────────────────────────────────────────── */

async function analisar() {
  const input = el("impFile");
  const file = input?.files?.[0];
  if (!file) {
    el("impMsg").textContent = "Escolha a folha primeiro.";
    return;
  }
  S.aCorrer = true;
  desenhar();
  el("impMsg").textContent = "A IA está a ler a folha. Pode demorar até um minuto.";
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${getApiBaseUrl()}/budgets/import/analyze`, {
      method: "POST",
      headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.errors && data.errors[0]) || data.error || `Erro ${res.status}`);

    S.analise = data;
    S.form = {
      projectName: data.projeto?.obra || "",
      location: data.projeto?.local || "",
      responsibleName: "",
      cliente: data.projeto?.cliente || "",
    };
    S.passo = "rever";
  } catch (err) {
    toast(err.message || "Não foi possível ler a folha.", { type: "error" });
  } finally {
    S.aCorrer = false;
    desenhar();
    if (S.passo === "ficheiro") el("impMsg").textContent = "";
  }
}

async function criar() {
  const A = S.analise;
  const F = S.form;
  const itens = A.itens.filter((x) => x.on);
  if (!itens.length) return toast("Marque pelo menos uma linha.", { type: "error" });
  if (!String(F.projectName || "").trim()) return toast("Escreva o nome da obra.", { type: "error" });
  if (!String(F.responsibleName || "").trim()) return toast("Escreva quem é o responsável pelo orçamento.", { type: "error" });

  S.aCorrer = true;
  desenhar();
  try {
    const d = await apiRequest("/budgets/new-defaults");
    const corpo = {
      projectName: F.projectName.trim(),
      location: String(F.location || "").trim() || "—",
      responsibleName: F.responsibleName.trim(),
      validityDays: d.params?.validade || 30,
      currencyBase: d.params?.moedaBase || "AOA",
      // O preço vem da folha do cliente: é o método «preço dado».
      method: S.destino === "mapa" ? "PRECO_DADO" : d.params?.metodo || "MARGEM_SOBRE_VENDA",
      vatRate: d.params?.iva,
      destino: S.destino,
      itens,
    };
    // Cliente: o que a IA leu do cabeçalho, se houver.
    if (String(F.cliente || "").trim()) corpo.newClient = { name: F.cliente.trim() };
    else corpo.newClient = { name: "Cliente por identificar" };

    const r = await apiRequest("/budgets/import/create", { method: "POST", body: corpo });
    const imp = r.importacao || {};
    el("cmDrawer").innerHTML = "";
    toast(
      `${r.number} criado com ${imp.linhas} linha(s).` +
        (imp.semPreco ? ` ${imp.semPreco} sem preço: complete-as.` : "") +
        (imp.baremesEmFalta?.length ? ` ${imp.baremesEmFalta.length} barem(es) por criar.` : ""),
      { type: "success" }
    );
    S.onCriado?.(r);
  } catch (err) {
    toast(err.message || "Não foi possível criar o orçamento.", { type: "error" });
  } finally {
    S.aCorrer = false;
    if (el("cmDrawer")?.innerHTML) desenhar();
  }
}

/** Liga os eventos, uma vez por página. */
export function wireImportacao() {
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("#impFechar,#impAnalisar,#impVoltar,#impCriar,[data-impall]");
    if (!t) return;
    if (t.id === "impFechar") {
      el("cmDrawer").innerHTML = "";
      return;
    }
    if (t.id === "impAnalisar") return analisar();
    if (t.id === "impVoltar") {
      S.passo = "ficheiro";
      S.analise = null;
      desenhar();
      return;
    }
    if (t.id === "impCriar") return criar();
    if (t.dataset.impall !== undefined) {
      const on = t.dataset.impall === "1";
      S.analise.itens.forEach((x) => {
        x.on = on;
      });
      desenhar();
    }
  });

  const mudar = (e) => {
    const t = e.target;
    if (t.id === "impDestino") {
      S.destino = t.value;
      return;
    }
    if (t.dataset?.impf) {
      S.form[t.dataset.impf] = t.value;
      return;
    }
    if (!t.dataset?.imp || !S.analise) return;
    const [i, campo] = t.dataset.imp.split("|");
    const item = S.analise.itens[Number(i)];
    if (!item) return;
    if (campo === "on") {
      item.on = t.checked;
      desenhar();
      return;
    }
    if (campo === "q") item.q = Number(t.value) || 0;
    else if (campo === "pu") item.pu = t.value === "" ? null : Number(t.value);
    else item[campo] = t.value;
  };
  document.addEventListener("input", mudar);
  document.addEventListener("change", mudar);
}

/** Abre a importação. */
export function abrirImportacao({ onCriado } = {}) {
  S.passo = "ficheiro";
  S.analise = null;
  S.ficheiro = null;
  S.destino = "mapa";
  S.aCorrer = false;
  S.onCriado = onCriado || null;
  desenhar();
}
