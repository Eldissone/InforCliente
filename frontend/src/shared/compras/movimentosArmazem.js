/**
 * S4 Movimentos de Armazém — o `V.fstkm` do protótipo.
 *
 * Todos os movimentos de stock, do mais recente para o mais antigo, com
 * filtros por tipo, armazém e mês (no servidor) e pesquisa por produto,
 * referência ou notas.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtData, vazio, erro, root, fmtQ, select, ligar } from "./ui.js";

const S = { dados: null, erro: null, q: "", tipo: "", armazem: "", mes: "" };

const TIPOS = {
  ENTRY: ["Entrada", "in"],
  EXIT: ["Saída", "out"],
  TRANSFER_IN: ["Transf. (entrada)", "neu"],
  TRANSFER_OUT: ["Transf. (saída)", "neu"],
  ADJUSTMENT: ["Acerto", "neu"],
  LOSS: ["Perda", "bad"],
  ALLOCATION: ["Alocação a plano", "neu"],
  RETURN: ["Devolução", "in"],
};

let timer = null;

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  const D = S.dados;
  const L = D?.items || [];
  el.innerHTML = `
    <div class="fcal-filtros">
      <input type="search" class="fcal-q" data-mq placeholder="produto, código, guia, requisição…" value="${esc(S.q)}">
      ${select("tipo", S.tipo, Object.entries(TIPOS).map(([k, [l]]) => [k, l]), "Todos os tipos")}
      ${select("armazem", S.armazem, (D?.armazens || []).map((a) => [a.id, a.name]), "Todos os armazéns")}
      <input type="month" class="cs-sel" data-f="mes" value="${esc(S.mes)}">
      <span class="fx2-ajuda">${D ? `${L.length}${D.mais ? "+" : ""} movimento(s)${D.mais ? ` — a mostrar os ${D.limite} mais recentes; filtre para ver mais` : ""}` : "A carregar…"}</span>
    </div>
    ${
      !D
        ? vazio("A carregar…")
        : L.length
          ? `<div class="fx2-tw"><table class="fx2-t">
      <thead><tr><th>Data</th><th>Tipo</th><th>Referência</th><th>Produto</th><th class="r">Qtd.</th><th>Armazém</th><th>Obra</th><th class="r">Valor</th><th>Por</th></tr></thead>
      <tbody>${L.map((m) => {
        const [l, c] = TIPOS[m.tipo] || [m.tipo, "neu"];
        return `<tr>
          <td>${fmtData(m.data)}</td>
          <td><span class="cs-tp cs-tp--${c}">${esc(l)}</span></td>
          <td class="fx2-mut">${esc(m.referencia || "")}</td>
          <td><b>${esc(m.produto)}</b>${m.codigo ? ` <span class="fx2-mut">${esc(m.codigo)}</span>` : ""}${m.notas ? `<div class="fx2-mut" title="${esc(m.notas)}">${esc(String(m.notas).slice(0, 80))}</div>` : ""}</td>
          <td class="r">${fmtQ(m.quantidade)} <span class="fx2-mut">${esc(m.un)}</span></td>
          <td class="fx2-mut">${esc(m.armazem)}</td>
          <td class="fx2-mut">${esc(m.obra || "")}</td>
          <td class="r">${m.valor != null ? fmt(Math.abs(m.valor)) : `<span class="fx2-mut">—</span>`}</td>
          <td class="fx2-mut">${esc(m.por || "")}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`
          : vazio("Sem movimentos com estes filtros.")
    }
    <p class="fcal-nota">O valor é o custo gravado no movimento (entrada: o de compra; saída: o custo médio do armazém nesse momento). Para registar movimentos use <a href="/Stock">Pedidos de Logística</a> ou o armazém da obra.</p>`;
}

async function carregar() {
  S.erro = null;
  const p = new URLSearchParams();
  if (S.tipo) p.set("tipo", S.tipo);
  if (S.armazem) p.set("armazem", S.armazem);
  if (S.mes) p.set("mes", S.mes);
  if (S.q.trim()) p.set("q", S.q.trim());
  try {
    S.dados = await apiRequest(`/compras-stock/movements?${p}`);
  } catch (e) {
    S.erro = e.message;
  }
  const foco = document.activeElement?.dataset?.mq !== undefined;
  const pos = foco ? document.activeElement.selectionStart : 0;
  desenhar();
  if (foco) {
    const n = root().querySelector("[data-mq]");
    n?.focus();
    n?.setSelectionRange(pos, pos);
  }
}

export async function render() {
  // Os filtros vão ao servidor: cada mudança recarrega.
  ligar(S, desenhar, { onChange: () => carregar() });
  root().addEventListener("input", (e) => {
    if (e.target.dataset.mq === undefined) return;
    S.q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(carregar, 350);
  });
  const a = new URLSearchParams(window.location.search).get("armazem");
  if (a) S.armazem = a;
  desenhar();
  await carregar();
}
