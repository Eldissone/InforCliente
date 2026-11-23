/**
 * E4 Distribuição aos Sócios — o `V.fsoc` do protótipo.
 *
 * As distribuições de lucros aprovadas (total, exercício, repartição pelos
 * sócios, IAC) e os pagamentos feitos a cada sócio (o lucro líquido) e ao
 * Estado (o IAC). Por sócio: bruto, IAC, líquido a receber, já recebido e
 * remanescente.
 */

import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, codigoNoCabecalho, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, erro: null };
const podeEditar = () => can("financeiro", "edit");

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const d = S.d;
  const ed = podeEditar();
  el.innerHTML = `
    <p class="fx2-lead">Lucros distribuídos aos sócios: as distribuições aprovadas (quanto cabe a cada sócio) e os pagamentos feitos —
      o lucro líquido a cada sócio e o IAC ao Estado (10% por omissão).</p>
    ${kpis([
      { tom: "neu", titulo: "Lucro Distribuído (bruto)", valor: fmt(d.bruto), nota: `${d.distribuicoes.length} distribuição(ões)` },
      { tom: "warn", titulo: "IAC", valor: fmt(d.iac), nota: `pago ${fmt(d.iacPago)} · falta ${fmt(Math.max(0, d.iac - d.iacPago))}` },
      { tom: "good", titulo: "Pago aos Sócios (líquido)", valor: fmt(d.pago), nota: `de ${fmt(d.bruto - d.iac)} a receber` },
      { tom: d.remanescente < -0.5 ? "bad" : "neu", titulo: "Remanescente", valor: fmt(d.remanescente), nota: d.remanescente < -0.5 ? "pago a mais" : "por pagar aos sócios" },
    ])}
    <h3 class="f0-h3">Por Sócio</h3>
    ${
      d.socios.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Sócio</th><th class="r">Lucro bruto</th><th class="r">IAC</th><th class="r">Total a receber</th><th class="r">Já recebido</th><th class="r">Remanescente</th><th></th></tr></thead>
          <tbody>${d.socios
            .map(
              (s) => `<tr><td><b>${esc(s.socio)}</b></td><td class="r">${fmt(s.bruto)}</td>
                <td class="r">${fmt(s.iac)}${s.iac > 0 ? `<div class="fx2-mut">${s.iacPago >= s.iac - 0.5 ? "✓ pago" : `pago ${fmt(s.iacPago)}`}</div>` : ""}</td>
                <td class="r"><b>${fmt(s.liquido)}</b></td><td class="r">${fmt(s.pago)}</td>
                <td class="r${s.remanescente < -0.5 ? " f0-neg" : ""}"><b>${fmt(s.remanescente)}</b></td>
                <td>${ed ? `<button type="button" class="finance-btn finance-btn--sm" data-e4pag="${esc(s.socio)}">Registar pagamento</button>` : ""}</td></tr>`
            )
            .join("")}</tbody></table></div>`
        : vazio("Ainda não há sócios com distribuições.")
    }
    <h3 class="f0-h3">Distribuições Aprovadas</h3>
    ${
      d.distribuicoes.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Data</th><th>Exercício</th><th>Descrição</th><th class="r">Total</th><th>Repartição</th><th></th></tr></thead>
          <tbody>${d.distribuicoes
            .map(
              (x) => `<tr><td>${fmtData(x.data)}</td><td>${esc(x.exercicio || "")}</td><td>${esc(x.descricao || "Distribuição de lucros")}</td><td class="r"><b>${fmt(x.total)}</b></td>
                <td class="fx2-mut">${esc(x.parts.map((p) => `${p.nome} ${p.pct}%`).join(" · "))} · IAC ${x.iacPct}%</td>
                <td>${ed ? `<button type="button" class="finance-btn finance-btn--sm" data-e4del="${esc(x.id)}">✕</button>` : ""}</td></tr>`
            )
            .join("")}</tbody></table></div>`
        : vazio("Ainda não há distribuições registadas.")
    }
    <h3 class="f0-h3">Pagamentos</h3>
    ${
      d.pagamentos.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Data</th><th>Sócio</th><th>Tipo</th><th class="r">Valor</th><th>Notas</th><th></th></tr></thead>
          <tbody>${d.pagamentos
            .map(
              (p) => `<tr><td>${fmtData(p.data)}</td><td>${esc(p.socio)}</td><td>${p.tipo === "IAC" ? "IAC (ao Estado)" : "Lucro"}</td><td class="r">${fmt(p.valor)}</td><td class="fx2-mut">${esc(p.notas || "")}</td>
                <td>${ed ? `<button type="button" class="finance-btn finance-btn--sm" data-e4pdel="${esc(p.id)}">✕</button>` : ""}</td></tr>`
            )
            .join("")}</tbody></table></div>`
        : vazio("Sem pagamentos registados.")
    }`;
}

async function carregar() {
  try {
    S.d = await apiRequest("/finance/partners");
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

function novaDistribuicao() {
  const hoje = new Date().toISOString().slice(0, 10);
  const linha = (i) => `<div class="e4-parte"><input class="finance-input" data-pn="${i}" placeholder="Sócio"><input class="finance-input" data-pp="${i}" type="number" min="0" max="100" step="any" placeholder="%"></div>`;
  openModal({
    title: "Nova distribuição de lucros",
    primaryLabel: "Guardar",
    width: 640,
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field"><label class="finance-label">Data da aprovação *</label><input id="dsD" class="finance-input" type="date" value="${hoje}"></div>
      <div class="finance-field"><label class="finance-label">Exercício</label><input id="dsE" class="finance-input" placeholder="ex.: 2025"></div>
      <div class="finance-field"><label class="finance-label">Total a distribuir (bruto) *</label><input id="dsT" class="finance-input" type="number" min="0" step="any"></div>
      <div class="finance-field"><label class="finance-label">IAC (%)</label><input id="dsI" class="finance-input" type="number" min="0" max="100" step="any" value="10"></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Descrição</label><input id="dsX" class="finance-input" placeholder="Distribuição de lucros"></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Repartição (tem de somar 100%)</label><div id="dsP">${[0, 1, 2].map(linha).join("")}</div>
        <button type="button" class="finance-btn finance-btn--sm" id="dsMais">+ sócio</button> <span id="dsSoma" class="fx2-mut"></span></div>
    </div>`,
    onRender: ({ panel }) => {
      let n = 3;
      const soma = () => {
        const s = [...panel.querySelectorAll("[data-pp]")].reduce((a, i) => a + (Number(i.value) || 0), 0);
        panel.querySelector("#dsSoma").textContent = `soma ${s.toLocaleString("pt-PT")}%`;
      };
      panel.querySelector("#dsMais").addEventListener("click", () => {
        panel.querySelector("#dsP").insertAdjacentHTML("beforeend", linha(n++));
      });
      panel.addEventListener("input", soma);
    },
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id).value.trim();
      const parts = [...panel.querySelectorAll("[data-pn]")]
        .map((i) => ({ nome: i.value.trim(), pct: Number(panel.querySelector(`[data-pp="${i.dataset.pn}"]`).value) }))
        .filter((p) => p.nome && p.pct > 0);
      try {
        await apiRequest("/finance/partners/distributions", {
          method: "POST",
          body: { data: $("#dsD"), exercicio: $("#dsE") || null, descricao: $("#dsX") || null, total: Number($("#dsT")), iacPct: $("#dsI") === "" ? 10 : Number($("#dsI")), parts },
        });
        close();
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível guardar.", { type: "error" });
      }
    },
  });
}

function pagamento(socio) {
  const hoje = new Date().toISOString().slice(0, 10);
  openModal({
    title: `Pagamento · ${socio}`,
    primaryLabel: "Registar",
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field"><label class="finance-label">Tipo</label><select id="pgT" class="finance-input"><option value="LUCRO">Lucro (ao sócio)</option><option value="IAC">IAC (ao Estado)</option></select></div>
      <div class="finance-field"><label class="finance-label">Data</label><input id="pgD" class="finance-input" type="date" value="${hoje}"></div>
      <div class="finance-field"><label class="finance-label">Valor *</label><input id="pgV" class="finance-input" type="number" min="0" step="any"></div>
      <div class="finance-field"><label class="finance-label">Notas</label><input id="pgN" class="finance-input" placeholder="ex.: transferência BAI"></div>
    </div>`,
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id).value.trim();
      try {
        await apiRequest("/finance/partners/payments", { method: "POST", body: { socio, tipo: $("#pgT"), data: $("#pgD"), valor: Number($("#pgV")), notas: $("#pgN") || null } });
        close();
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível registar.", { type: "error" });
      }
    },
  });
}

export async function render() {
  codigoNoCabecalho("E4");
  const acts = document.getElementById("financePageActions");
  if (acts && podeEditar()) {
    acts.innerHTML = `<button type="button" class="finance-btn finance-btn--primary" id="e4Nova">+ Nova distribuição</button>`;
    document.getElementById("e4Nova").onclick = novaDistribuicao;
  }
  root().addEventListener("click", async (e) => {
    const t = e.target;
    const pg = t.closest("[data-e4pag]");
    if (pg) return pagamento(pg.dataset.e4pag);
    const del = t.closest("[data-e4del], [data-e4pdel]");
    if (del && confirm("Apagar este registo? Não se pode desfazer.")) {
      const url = del.dataset.e4del ? `/finance/partners/distributions/${del.dataset.e4del}` : `/finance/partners/payments/${del.dataset.e4pdel}`;
      try {
        await apiRequest(url, { method: "DELETE" });
        carregar();
      } catch (err) {
        toast(err.message || "Não foi possível apagar.", { type: "error" });
      }
    }
  });
  desenhar();
  await carregar();
}
