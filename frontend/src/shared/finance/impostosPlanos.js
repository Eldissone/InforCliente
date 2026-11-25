/**
 * G2 Planos de Pagamento (PPP) — alinhado com `V.fppp` do protótipo:
 * suporta estados Ativo / Em curso, Atrasado, Em execução, Cancelado AGT e Liquidado.
 */

import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, codigoNoCabecalho, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, erro: null, f: "", aberto: new Set() };
const TOM = { Liquidado: "good", Atrasado: "bad", "Em curso": "blue", "Em execução": "bad", "Cancelado AGT": "slate" };
const ESTADO_TOM = { Pago: "good", "Pago parcial": "warn", "Em pagamento": "blue", Atrasado: "bad", "Por pagar": "slate" };
const podeEditar = () => can("financeiro", "edit");

function datas(n, d1) {
  if (!(n > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(d1 || "")) return [];
  const [y, m, d] = d1.split("-").map(Number);
  return Array.from({ length: Math.min(n, 240) }, (_, i) => {
    const ult = new Date(Date.UTC(y, m - 1 + i + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - 1 + i, Math.min(d, ult))).toISOString().slice(0, 10);
  });
}

function matchFiltro(p, f) {
  if (!f) return true;
  if (f === "Ativo") return p.estado === "Em curso" || p.estado === "Atrasado";
  return p.estado === f;
}

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const { planos, resumo } = S.d;
  const L = planos.filter((p) => matchFiltro(p, S.f));
  const chip = (k, lbl) => `<button type="button" class="fx2-chip${S.f === k ? " on" : ""}" data-g2f="${esc(k)}">${esc(lbl)}</button>`;

  el.innerHTML = `
    <p class="fx2-lead">Acordos com a AGT (ou outra entidade) para pagar impostos em prestações. Cada prestação aparece em
      <a href="/Financeiro/impostos">G1 · Impostos</a> na data em que vence, e é aí que se cria o pedido de pagamento — tal como os outros impostos.</p>
    ${kpis([
      { tom: "neu", titulo: "Planos Ativos", valor: String(resumo.ativos), nota: `${planos.length} registado(s)` },
      { tom: "warn", titulo: "Em Dívida", valor: fmt(resumo.divida), nota: "AOA" },
      { tom: resumo.atrasadas ? "bad" : "good", titulo: "Prestações Atrasadas", valor: String(resumo.atrasadas), nota: "&nbsp;" },
      {
        tom: resumo.emExecucao ? "bad" : "neu",
        titulo: "Em Execução · Cancelados AGT",
        valor: `${resumo.emExecucao || 0} · ${resumo.cancelados || 0}`,
        nota: "situação administrativa",
      },
      {
        tom: "neu",
        titulo: "Próxima Prestação",
        valor: resumo.proxima ? fmtData(resumo.proxima.limite) : "—",
        nota: resumo.proxima ? `${fmt(resumo.proxima.valor)} AOA · ${esc(resumo.proxima.plano)}` : "&nbsp;",
      },
    ])}
    <div class="fx2-chips" style="margin-bottom:10px">
      ${chip("", `Todos (${planos.length})`)}
      ${chip("Ativo", `Ativo (${planos.filter((p) => matchFiltro(p, "Ativo")).length})`)}
      ${chip("Em execução", `Em execução (${planos.filter((p) => p.estado === "Em execução").length})`)}
      ${chip("Cancelado AGT", `Cancelado AGT (${planos.filter((p) => p.estado === "Cancelado AGT").length})`)}
      ${chip("Liquidado", `Liquidado (${planos.filter((p) => p.estado === "Liquidado").length})`)}
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Plano</th><th>Processo</th><th>Acordo</th><th class="r">Total</th><th class="r">Pago</th><th class="r">Em falta</th><th>Prestações</th><th>Próxima</th><th>Estado</th><th></th></tr></thead>
      <tbody>${L.map((p) => {
        const op = S.aberto.has(p.id);
        return `<tr class="fx2-k-row" data-g2ab="${esc(p.id)}">
            <td>${op ? "▾" : "▸"} <b>${esc(p.nome)}</b>${p.imposto ? ` <span class="fx2-mut">${esc(p.imposto)}</span>` : ""}</td>
            <td class="fx2-mut">${esc(p.processo || "—")}</td><td>${p.acordo ? fmtData(p.acordo) : "—"}</td>
            <td class="r">${fmt(p.total)}</td><td class="r">${fmt(p.pago)}</td><td class="r"><b>${fmt(p.falta)}</b></td>
            <td>${p.np}/${p.n}</td>
            <td class="fx2-mut">${p.proxima ? `${fmtData(p.proxima.limite)} · ${fmt(p.proxima.valor)}` : "—"}</td>
            <td><span class="fcal-pill fcal-pill--${TOM[p.estado] || "slate"}">${esc(p.estado)}</span></td>
            <td>${podeEditar() ? `<button type="button" class="finance-btn finance-btn--sm" data-g2ed="${esc(p.id)}">Editar</button>` : ""}</td>
          </tr>${
            op
              ? `<tr class="rg-subs"><td colspan="10"><table class="fx2-t"><thead><tr><th>Prestação</th><th>Data limite</th><th class="r">Valor</th><th>N.º Nota Liquidação</th><th>RUPE</th><th>Estado</th><th>Pedido</th></tr></thead><tbody>${p.prestacoes
                  .map(
                    (x) => `<tr><td><b>${x.plano?.prestacao}/${p.n}</b></td><td>${fmtData(x.limite)}</td><td class="r">${fmt(x.valor)}</td>
                      <td class="fx2-mut">${esc(x.nl || "")}</td><td class="fx2-mut">${esc(x.rupe || "")}</td>
                      <td><span class="fcal-pill fcal-pill--${ESTADO_TOM[x.estado] || "slate"}">${esc(x.estado)}</span></td>
                      <td>${x.pedido ? esc(x.pedido.numero) : "—"}</td></tr>`
                  )
                  .join("")}</tbody></table>
                  <p class="fx2-mut">A nota de liquidação, o RUPE e o pedido de cada prestação tratam-se em <a href="/Financeiro/impostos">G1 · Impostos</a>.</p></td></tr>`
              : ""
          }`;
      }).join("")}</tbody></table></div>`
        : vazio(planos.length ? "Nenhum plano com este filtro." : "Ainda não há planos de pagamento. Use «+ Novo PPP».")
    }`;
}

async function carregar() {
  try {
    S.d = await apiRequest("/finance/tax-plans");
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

function novoPlano() {
  openModal({
    title: "Novo plano de pagamento (PPP)",
    primaryLabel: "Criar plano",
    width: 680,
    contentHtml: `<p class="fx2-mut">N.º de prestações × valor de cada prestação, a partir da data da 1.ª — o total e as datas são calculados.</p>
    <div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field finance-field--full"><label class="finance-label">Nome do PPP *</label><input id="ppN" class="finance-input" placeholder="ex.: PPP II 2026 · Plano 2026.0000120218"></div>
      <div class="finance-field"><label class="finance-label">N.º do plano (AGT)</label><input id="ppP" class="finance-input"></div>
      <div class="finance-field"><label class="finance-label">Imposto em dívida</label><input id="ppI" class="finance-input" placeholder="ex.: IVA 2024"></div>
      <div class="finance-field"><label class="finance-label">Data do acordo *</label><input id="ppA" class="finance-input" type="date"></div>
      <div class="finance-field"><label class="finance-label">N.º de prestações *</label><input id="ppK" class="finance-input" type="number" min="1" max="240" step="1"></div>
      <div class="finance-field"><label class="finance-label">Valor de cada prestação *</label><input id="ppV" class="finance-input" type="number" min="0" step="any"></div>
      <div class="finance-field"><label class="finance-label">Data limite da 1.ª prestação *</label><input id="ppD" class="finance-input" type="date"></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Observações</label><textarea id="ppO" class="finance-textarea" rows="2"></textarea></div>
      <div class="finance-field finance-field--full" id="ppRes"></div>
    </div>`,
    onRender: ({ panel }) => {
      const res = () => {
        const n = Number(panel.querySelector("#ppK").value);
        const v = Number(panel.querySelector("#ppV").value);
        const D = datas(n, panel.querySelector("#ppD").value);
        panel.querySelector("#ppRes").innerHTML = D.length && v > 0 ? `Valor total do plano <b>${fmt(n * v)}</b> · ${D.length} prestação(ões) · última a ${fmtData(D[D.length - 1])}` : "";
      };
      panel.addEventListener("input", res);
      panel.addEventListener("change", res);
    },
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id).value.trim();
      const body = {
        nome: $("#ppN"),
        processo: $("#ppP") || null,
        imposto: $("#ppI") || null,
        acordo: $("#ppA"),
        n: Number($("#ppK")),
        valor: Number($("#ppV")),
        d1: $("#ppD"),
        notas: $("#ppO") || null,
      };
      if (body.nome.length < 2 || !body.acordo || !(body.n > 0) || !(body.valor > 0) || !body.d1) return toast("Preencha os campos com *.", { type: "error" });
      try {
        const r = await apiRequest("/finance/tax-plans", { method: "POST", body });
        toast(`Plano criado com ${r.prestacoes} prestação(ões).`, { type: "success" });
        close();
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível criar o plano.", { type: "error" });
      }
    },
  });
}

function editarPlano(p) {
  const sitAtual = p.situacaoAdmin || "ATIVO";
  openModal({
    title: `Editar ${p.nome}`,
    primaryLabel: "Guardar",
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field finance-field--full"><label class="finance-label">Nome</label><input id="peN" class="finance-input" value="${esc(p.nome)}"></div>
      <div class="finance-field"><label class="finance-label">N.º do plano (AGT)</label><input id="peP" class="finance-input" value="${esc(p.processo || "")}"></div>
      <div class="finance-field"><label class="finance-label">Imposto em dívida</label><input id="peI" class="finance-input" value="${esc(p.imposto || "")}"></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Situação do acordo</label>
        <select id="peS" class="finance-input">
          <option value="ATIVO"${sitAtual === "ATIVO" ? " selected" : ""}>Ativo (em cumprimento / automático)</option>
          <option value="EM_EXECUCAO"${sitAtual === "EM_EXECUCAO" ? " selected" : ""}>Em execução fiscal</option>
          <option value="CANCELADO_AGT"${sitAtual === "CANCELADO_AGT" ? " selected" : ""}>Cancelado pela AGT</option>
        </select>
      </div>
      <div class="finance-field finance-field--full"><label class="finance-label">Observações</label><textarea id="peO" class="finance-textarea" rows="2">${esc(p.notas || "")}</textarea></div>
      ${p.np === 0 ? `<div class="finance-field--full"><button type="button" class="finance-btn" id="peDel">Apagar este plano (nenhuma prestação paga)</button></div>` : ""}
    </div>`,
    onRender: ({ panel, close }) => {
      panel.querySelector("#peDel")?.addEventListener("click", async () => {
        if (!confirm(`Apagar o plano ${p.nome} e as suas ${p.n} prestações? Não se pode desfazer.`)) return;
        try {
          await apiRequest(`/finance/tax-plans/${p.id}`, { method: "DELETE" });
          close();
          carregar();
        } catch (e) {
          toast(e.message || "Não foi possível apagar.", { type: "error" });
        }
      });
    },
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id).value.trim();
      try {
        await apiRequest(`/finance/tax-plans/${p.id}`, {
          method: "PATCH",
          body: { nome: $("#peN"), processo: $("#peP") || null, imposto: $("#peI") || null, situacao: $("#peS"), notas: $("#peO") || null },
        });
        close();
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível guardar.", { type: "error" });
      }
    },
  });
}

export async function render() {
  codigoNoCabecalho("G2");
  const acts = document.getElementById("financePageActions");
  if (acts && podeEditar()) {
    acts.innerHTML = `<button type="button" class="finance-btn finance-btn--primary" id="g2Novo">+ Novo PPP</button>`;
    document.getElementById("g2Novo").onclick = novoPlano;
  }
  root().addEventListener("click", (e) => {
    const f = e.target.closest("[data-g2f]");
    if (f) {
      S.f = f.dataset.g2f;
      return desenhar();
    }
    const ed = e.target.closest("[data-g2ed]");
    if (ed) return editarPlano(S.d.planos.find((p) => p.id === ed.dataset.g2ed));
    const ab = e.target.closest("[data-g2ab]");
    if (ab) {
      const id = ab.dataset.g2ab;
      if (S.aberto.has(id)) S.aberto.delete(id);
      else S.aberto.add(id);
      desenhar();
    }
  });
  desenhar();
  await carregar();
}
