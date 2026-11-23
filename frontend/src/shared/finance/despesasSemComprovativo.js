/**
 * P3 Despesas sem Comprovativo — o `V.fdsc` do protótipo.
 *
 * As linhas de pedidos de pagamento marcadas DSC (despesa sem comprovativo) ou
 * AF (autofaturação), com o encargo de 25% que o protótipo soma às DSC para se
 * ver o custo verdadeiro da decisão.
 *
 * Na app a decisão toma-se no próprio pedido, linha a linha; aqui vê-se o que
 * foi decidido. O «por decidir» e o «apareceu a fatura» do protótipo não
 * existem ainda.
 */

import { apiRequest, apiUpload, getAssetUrl } from "../../services/api.js";
import { toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, codigoNoCabecalho, seg, kpis, vazio, erro } from "./f2Ui.js";
import { MESES } from "./calendarioCore.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, mes: "", dec: "", q: "", erro: null };

const DECISOES = [
  ["", "Por decidir"],
  ["DSC", "Mantém DSC"],
  ["AF", "Autofaturação"],
  ["FATURA", "Fatura encontrada"],
];

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const { linhas, totais, encargo } = S.d;
  const meses = [...new Set(linhas.map((l) => (l.data || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  const q = norm(S.q).trim();
  const L = linhas.filter(
    (l) =>
      (!S.mes || (l.data || "").startsWith(S.mes)) &&
      (!S.dec || (S.dec === "_" ? !l.decisao : l.decisao === S.dec)) &&
      (!q || norm([l.pedido, l.fornecedor, l.produto, l.obra].join(" ")).includes(q))
  );
  const pct = Math.round(encargo * 100);

  const edita = can("financeiro", "edit");
  el.innerHTML = `
    ${kpis([
      { tom: "warn", titulo: "Por Decidir", valor: fmt(totais.porDecidir), nota: `${totais.nPorDecidir} linha(s)` },
      {
        tom: "bad",
        titulo: "Mantém DSC",
        valor: fmt(totais.dsc),
        nota: `${totais.nDsc} linha(s) · encargo ${pct}%: ${fmt(totais.dscEncargo)} · custo ${fmt(totais.dscCustoTotal)}`,
      },
      { tom: "good", titulo: "Autofaturação", valor: fmt(totais.af), nota: `${totais.nAf} linha(s)` },
      { tom: "blue", titulo: "Fatura Encontrada", valor: fmt(totais.fatura), nota: `${totais.nFatura} linha(s)` },
    ])}
    <div class="fcal-filtros">
      <select class="fcal-ano" data-dscs="mes"><option value="">Todos os meses</option>${meses
        .map((k) => `<option value="${k}"${S.mes === k ? " selected" : ""}>${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}</option>`)
        .join("")}</select>
      ${seg("dsc", "dec", S.dec, [["", "Todas"], ["_", "Por decidir"], ["DSC", "Mantém DSC"], ["AF", "Autofaturação"], ["FATURA", "Fatura encontrada"]])}
      <input type="search" class="fcal-q" data-dscq placeholder="Pesquisar pedido, fornecedor, produto, obra…" value="${esc(S.q)}">
      <span class="fx2-ajuda">${L.length} de ${linhas.length}</span>
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Data</th><th>Pedido</th><th>Fornecedor</th><th>Produto / Serviço</th><th>Obra / CC</th><th class="r">Valor</th><th>Marcado</th><th>Decisão</th><th>Documento</th><th>Estado do pedido</th></tr></thead>
      <tbody>${L.map(
        (l) => `<tr>
          <td>${fmtData(l.data)}</td>
          <td><a href="/Financeiro/centro-pagamentos">${esc(l.pedido)}</a></td>
          <td>${esc(l.fornecedor)}</td>
          <td>${esc(l.produto)}</td>
          <td class="fx2-mut">${esc(l.obra)}</td>
          <td class="r">${fmt(l.valor)}${l.encargo ? `<div class="fcal-out fx2-mut">+ ${fmt(l.encargo)}</div>` : ""}</td>
          <td>${l.marcado === "DSC" ? '<span class="fcal-pill fcal-pill--bad">DSC</span>' : '<span class="fcal-pill fcal-pill--blue">AF</span>'}</td>
          <td>${
            edita
              ? `<select class="finance-input dsc-dec" data-dscdec="${esc(l.id)}">${DECISOES.map(
                  ([k, v]) => `<option value="${k}"${(l.decisao || "") === k ? " selected" : ""}>${v}</option>`
                ).join("")}</select>`
              : esc((DECISOES.find(([k]) => k === (l.decisao || "")) || ["", "Por decidir"])[1])
          }${l.decididoPor ? `<div class="fx2-mut">${esc(l.decididoPor)}${l.decididoEm ? ` · ${fmtData(l.decididoEm)}` : ""}</div>` : ""}</td>
          <td>${l.documento ? `<a href="${esc(getAssetUrl(l.documento))}" target="_blank" rel="noopener" title="${esc(l.documentoNome || "")}"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:text-bottom">description</span> Ver</a>` : ""}${
            edita
              ? ` <label class="finance-btn finance-btn--sm" title="Anexar a fatura que apareceu (ou o documento da autofaturação)"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:text-bottom">attach_file</span> ${l.documento ? "Trocar" : "Anexar"}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" data-dscdoc="${esc(l.id)}"></label>`
              : ""
          }</td>
          <td class="fx2-mut">${esc(l.estado)}</td>
        </tr>`
      ).join("")}</tbody>
    </table></div>`
        : vazio(linhas.length ? "Nada a mostrar com estes filtros." : "Não há despesas sem comprovativo nem autofaturações.")
    }
    <p class="fcal-nota">
      Quem pede marca a linha DSC ou AF no pedido de pagamento; o financeiro decide aqui, linha a linha: mantém
      DSC, passa a autofaturação, ou a fatura foi encontrada (anexe-a — a linha passa logo a «Fatura encontrada»).
      Uma despesa sem documento não é aceite como custo fiscal: enquanto for DSC soma-se-lhe ${pct}% de encargo,
      como no protótipo, para se ver quanto custa a decisão.
    </p>`;
}

export async function render() {
  codigoNoCabecalho("P3");
  const el = root();
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dsc]");
    if (!b) return;
    const [k, v] = b.dataset.dsc.split("|");
    S[k] = v;
    desenhar();
  });
  el.addEventListener("change", async (e) => {
    const dec = e.target.dataset.dscdec;
    if (dec) {
      try {
        await apiRequest(`/finance/dsc/${dec}`, { method: "PATCH", body: { decisao: e.target.value || null } });
        toast("Decisão gravada.", { type: "success" });
      } catch (err) {
        toast(err.message || "Não foi possível gravar.", { type: "error" });
      }
      return carregar();
    }
    const doc = e.target.dataset.dscdoc;
    if (doc) {
      const f = e.target.files?.[0];
      if (!f) return;
      const fd = new FormData();
      fd.append("file", f);
      try {
        await apiUpload(`/finance/dsc/${doc}/document`, fd);
        toast("Documento anexado.", { type: "success" });
      } catch (err) {
        toast(err.message || "Não foi possível anexar.", { type: "error" });
      }
      return carregar();
    }
    if (!e.target.dataset.dscs) return;
    S[e.target.dataset.dscs] = e.target.value;
    desenhar();
  });
  el.addEventListener("input", (e) => {
    if (e.target.dataset.dscq === undefined) return;
    S.q = e.target.value;
    const pos = e.target.selectionStart;
    desenhar();
    const n = root().querySelector("[data-dscq]");
    if (n) {
      n.focus();
      n.setSelectionRange(pos, pos);
    }
  });
  desenhar();
  await carregar();
}

async function carregar() {
  try {
    S.d = await apiRequest("/finance/dsc");
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}
