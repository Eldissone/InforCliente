/**
 * A1 Custos da Empresa — a parte de cima do ecrã, como o `V.fcus` do protótipo:
 * período (de / até), base (Aprovados · Pagos), tipo (Todos · Sede · Frota ·
 * Obras), os totais por tipo e o custo por centro de custo (com os subcustos),
 * por categoria, por origem e por mês. Números de `/finance/company-costs`.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, seg, moedaSeg, vazio, erro } from "./f2Ui.js";
import { monthLabel } from "./fluxosCore.js";

const st = { de: "", ate: "", base: "aprov", t: "", moeda: "AOA", aberto: new Set(), d: null, el: null };

const pct = (v, tot) => (tot ? `${((v / tot) * 100).toLocaleString("pt-PT", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%` : "—");
const barra = (v, tot) => `<div class="f0-bar"><i style="width:${tot ? Math.max(1, (v / tot) * 100) : 0}%"></i></div>`;

function tabela(titulo, L, tot) {
  if (!L.length) return "";
  return `<section class="finance-card f0-blk"><h3 class="f0-h3">${titulo}</h3><table class="fx2-t f0-nat"><tbody>${L.map(
    (x) => `<tr><td>${esc(x.k)}${barra(x.v, tot)}</td><td class="r"><b>${fmt(x.v)}</b><div class="fx2-mut">${pct(x.v, tot)}</div></td></tr>`
  ).join("")}<tr class="f0-tot"><td>Total</td><td class="r">${fmt(tot)}</td></tr></tbody></table></section>`;
}

function desenhar() {
  const el = st.el;
  const d = st.d;
  if (!el) return;
  const filtros = `<div class="f0-filtros">
    <label class="f0-lbl">De<input class="finance-input" type="date" data-a1f="de" value="${esc(st.de || d?.de || "")}"></label>
    <label class="f0-lbl">Até<input class="finance-input" type="date" data-a1f="ate" value="${esc(st.ate || "")}"></label>
    ${seg("a1", "base", st.base, [["aprov", "Aprovados"], ["pago", "Pagos"]])}
    ${seg("a1", "t", st.t, [["", "Todos"], ["SEDE", "Sede"], ["FROTA", "Frota"], ["OBRA", "Obras"]])}
    ${moedaSeg("a1", st.moeda, d?.moedas)}
  </div>
  <p class="fx2-lead">Todos os custos da MBT — Sede (custos gerais), Frota e Obras — mesmo os que não estão ligados a nenhuma obra.
    ${st.base === "pago" ? "Só o que já foi pago, pela data do pagamento, sem IVA." : "Custos aprovados, pela data do documento."}
    Empréstimos, impostos a entregar e transferências não são custos e não entram aqui.</p>`;
  if (!d) {
    el.innerHTML = filtros + vazio("A carregar…");
    return;
  }
  const T = d.porTipo;
  const chip = (lbl, v, nota = "") => `<span class="fx2-chip"><span>${lbl}</span> <b>${fmt(v)}</b>${nota ? ` <i>${nota}</i>` : ""}</span>`;
  const tot = d.filtrado;
  const ccRows = d.centros
    .map((c) => {
      const op = st.aberto.has(c.cc);
      return `<tr class="fx2-k-row" data-a1cc="${esc(c.cc)}"><td>${op ? "▾" : "▸"} <b>${esc(c.cc)}</b></td><td class="fx2-mut">${esc(c.tipoLbl)}</td>
        <td class="r"><b>${fmt(c.v)}</b></td><td class="r">${pct(c.v, tot)}</td><td style="min-width:90px">${barra(c.v, tot)}</td></tr>${
          op
            ? c.subs.map((s) => `<tr class="a1-sub"><td>↳ ${esc(s.k)}</td><td></td><td class="r">${fmt(s.v)}</td><td class="r fx2-mut">${pct(s.v, c.v)}</td><td></td></tr>`).join("")
            : ""
        }`;
    })
    .join("");
  const meses = d.meses.map((m) => ({ k: monthLabel(m.k), v: m.v }));
  el.innerHTML = `${filtros}
    <div class="fx2-chips">
      ${chip("Total de custos", d.total)}
      ${chip("Sede (gerais)", T.SEDE, pct(T.SEDE, d.total))}
      ${chip("Frota", T.FROTA, T.FROTA ? pct(T.FROTA, d.total) : "sem pedidos nos centros de Frota")}
      ${chip("Obras", T.OBRA, pct(T.OBRA, d.total))}
      ${d.investimento ? chip("Investimento", d.investimento, "não é custo") : ""}
    </div>
    ${
      d.centros.length
        ? `<section class="finance-card f0-blk"><h3 class="f0-h3">Por Centro de Custo <small>· clique para ver os subcustos</small></h3>
          <div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Centro de Custo</th><th>Tipo</th><th class="r">Custo</th><th class="r">%</th><th></th></tr></thead>
          <tbody>${ccRows}</tbody><tfoot><tr class="f0-tot"><td colspan="2">Total</td><td class="r">${fmt(tot)}</td><td></td><td></td></tr></tfoot></table></div></section>
          <div class="f0-grid a1-grid">${tabela("Por Categoria", d.categorias, tot)}${tabela("Por Origem do Custo", d.origens, tot)}</div>
          ${tabela("Por Mês", meses, tot)}
          <p class="fcal-nota">Material comprado para armazém só conta quando sai (consumo). Com obra → Obras; pedidos dos centros gerais do tipo Frota (RG8) → Frota; o resto → Sede.</p>`
        : vazio("Sem custos neste período.")
    }`;
}

async function carregar() {
  const q = new URLSearchParams({ base: st.base, moeda: st.moeda });
  if (st.de) q.set("de", st.de);
  if (st.ate) q.set("ate", st.ate);
  if (st.t) q.set("t", st.t);
  try {
    st.d = await apiRequest(`/finance/company-costs?${q}`);
    if (!st.de) st.de = st.d.de || "";
    desenhar();
  } catch (e) {
    if (st.el) st.el.innerHTML = erro(e.message || "erro");
  }
}

export async function renderCustosEmpresa(el) {
  if (!el) return;
  st.el = el;
  if (!el.dataset.a1Ligado) {
    el.dataset.a1Ligado = "1";
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a1]");
      if (b) {
        const [k, v] = b.dataset.a1.split("|");
        st[k] = v;
        return carregar();
      }
      const r = e.target.closest("[data-a1cc]");
      if (r) {
        const k = r.dataset.a1cc;
        if (st.aberto.has(k)) st.aberto.delete(k);
        else st.aberto.add(k);
        desenhar();
      }
    });
    el.addEventListener("change", (e) => {
      const k = e.target.dataset.a1f;
      if (!k) return;
      st[k] = e.target.value;
      carregar();
    });
  }
  desenhar();
  await carregar();
}
