/**
 * E1 Financiamentos Bancários, E2 Empréstimos Obtidos e Concedidos e E3
 * Garantias e Livranças — alinhado com `V.ffin`, `V.fgrp` e `V.fgar` do protótipo.
 */

import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, codigoNoCabecalho, moedaSeg, seg, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, erro: null, vista: "E1", moeda: "", estE1: "", tabE2: "ent", obras: [], aberto: new Set() };
const podeEditar = () => can("financeiro", "edit");
const ESTADO = { ATIVA: ["ativa", "blue"], LIQUIDADO: ["liquidado", "good"], LIBERTADA: ["libertada", "slate"] };

function planoHtml(x) {
  if (!x.plano.length) return "";
  return `<table class="fx2-t e1-plano"><thead><tr><th>N.º</th><th>Data</th><th class="r">Prestação</th><th class="r">Juros</th><th class="r">Amortização</th><th class="r">Capital em dívida</th></tr></thead>
    <tbody>${x.plano
      .map((p) => `<tr${p.d <= S.d.hoje ? ' class="e1-pago"' : ""}><td>${p.k}${p.carencia ? ' <small class="fx2-mut">carência</small>' : ""}</td><td>${fmtData(p.d)}</td><td class="r">${fmt(p.prest)}</td><td class="r">${fmt(p.juro)}</td><td class="r">${fmt(p.amort)}</td><td class="r">${fmt(p.cap)}</td></tr>`)
      .join("")}</tbody></table>`;
}

function linhaFin(x, cols) {
  const op = S.aberto.has(x.id);
  const e = ESTADO[x.estado] || [x.estado, "slate"];
  return `<tr class="fx2-k-row" data-e1ab="${esc(x.id)}">${cols(x, op)}<td><span class="fcal-pill fcal-pill--${e[1]}">${e[0]}</span></td>
    <td class="g1-acts">${podeEditar() ? `<button type="button" class="finance-btn finance-btn--sm" data-e1ed="${esc(x.id)}">Editar</button>` : ""}</td></tr>
    ${op && x.plano.length ? `<tr class="rg-subs"><td colspan="20">${planoHtml(x)}<p class="fx2-mut">Uma prestação conta como paga quando a data já passou (como no protótipo).</p></td></tr>` : ""}`;
}

function vistaE1() {
  const todos = S.d.itens.filter((x) => x.categoria === "fin" && x.moeda === S.d.moeda);
  const L = todos.filter((x) => !S.estE1 || x.estado === S.estE1);
  const r = S.d.e1;
  return `${kpis([
    { tom: "warn", titulo: "Capital em Dívida", valor: fmt(r.divida), nota: `${r.n} ativo(s) · disp. linhas ${fmt(r.linhasDisponivel || 0)}` },
    { tom: "neu", titulo: "Juros por Pagar (Previstos)", valor: fmt(r.jurosPorPagar || 0), nota: "até ao fim dos contratos" },
    { tom: "bad", titulo: "Total Ainda por Pagar", valor: fmt(r.totalPorPagar ?? r.divida), nota: r.proxima ? `próx. ${fmtData(r.proxima.d)} · ${fmt(r.proxima.prest)}` : "&nbsp;" },
    { tom: r.prestacoesAtraso ? "bad" : "good", titulo: "Prestações em Atraso", valor: String(r.prestacoesAtraso || 0), nota: r.prestacoesAtraso ? "verificar banco" : "em dia" },
    { tom: "neu", titulo: "Imposto de Selo Pago", valor: fmt(r.impostoSeloPago || 0), nota: "sobre juros liquidados" },
  ])}
  <div class="cp-filtros" style="margin-bottom:8px">
    <select class="finance-input" data-e1est style="width:auto">
      <option value=""${!S.estE1 ? " selected" : ""}>Todos os estados (${todos.length})</option>
      <option value="ATIVA"${S.estE1 === "ATIVA" ? " selected" : ""}>Ativos (${todos.filter((x) => x.estado === "ATIVA").length})</option>
      <option value="LIQUIDADO"${S.estE1 === "LIQUIDADO" ? " selected" : ""}>Liquidados (${todos.filter((x) => x.estado === "LIQUIDADO").length})</option>
    </select>
  </div>
  ${
    L.length
      ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Tipo</th><th>Entidade</th><th>Contrato</th><th class="r">Montante</th><th class="r">Taxa</th><th>Início</th><th>Fim</th><th class="r">Capital em dívida</th><th class="r">Juros por pagar</th><th>Próxima prestação</th><th>Estado</th><th></th></tr></thead>
        <tbody>${L.map((x) =>
          linhaFin(
            x,
            (x, op) => `<td>${x.plano.length ? (op ? "▾ " : "▸ ") : ""}${esc(x.tipoLabel)}</td><td><b>${esc(x.entidade)}</b></td><td class="fx2-mut">${esc(x.contrato || "—")}</td>
              <td class="r">${fmt(x.montante)}</td><td class="r">${x.taxa === null ? "—" : `${x.taxa.toLocaleString("pt-PT")}%`}</td>
              <td>${x.inicio ? fmtData(x.inicio) : "—"}</td><td>${x.fim ? fmtData(x.fim) : "—"}</td>
              <td class="r"><b>${fmt(x.divida)}</b>${x.disponivel !== null ? `<div class="fx2-mut">disponível ${fmt(x.disponivel)}</div>` : ""}</td>
              <td class="r">${x.jurosPorPagar ? fmt(x.jurosPorPagar) : "—"}</td>
              <td class="fx2-mut">${x.proxima ? `${fmtData(x.proxima.d)} · ${fmt(x.proxima.prest)}` : x.liquidado ? "liquidado" : "—"}</td>`
          )
        ).join("")}</tbody></table></div>`
      : vazio("Ainda não há financiamentos registados com este filtro. Use «+ Novo Financiamento».")
  }`;
}

function vistaE2() {
  const P = S.d.e2;
  const hoje = S.d.hoje;
  const ob = S.d.itens.filter((x) => x.categoria === "fin" && x.origem !== "BANCO" && x.moeda === S.d.moeda);
  const conc = S.d.concedidos || [];
  const vencConc = conc.filter((c) => c.fim && c.fim < hoje && c.pago - c.devolvido > 0.5);
  const vencVal = vencConc.reduce((s, c) => s + Math.max(0, c.pago - c.devolvido), 0);

  const secEnt = `
    <h3 class="f0-h3">Por Entidade</h3>
    ${
      P.linhas.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Entidade</th><th class="r">A MBT Deve</th><th class="r">Deve à MBT</th><th class="r">Posição Líquida</th></tr></thead>
          <tbody>${P.linhas.map((x) => `<tr title="${esc(x.detalhe.join(" · "))}"><td><b>${esc(x.empresa)}</b></td><td class="r">${x.deve ? fmt(x.deve) : "—"}</td><td class="r">${x.deveAMbt ? fmt(x.deveAMbt) : "—"}</td><td class="r${x.liquida < 0 ? " f0-neg" : " fcal-in"}"><b>${fmt(x.liquida)}</b></td></tr>`).join("")}</tbody>
          <tfoot><tr class="f0-tot"><td>Total</td><td class="r">${fmt(P.deve)}</td><td class="r">${fmt(P.deveAMbt)}</td><td class="r">${fmt(P.liquida)}</td></tr></tfoot></table></div>`
        : vazio("Sem saldos com outras empresas ou entidades.")
    }`;

  const secObt = `
    <h3 class="f0-h3">↙ Empréstimos Obtidos</h3>
    ${
      ob.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Tipo</th><th>Empresa</th><th>Contrato</th><th class="r">Montante</th><th class="r">Em dívida</th><th>Próxima</th><th>Estado</th><th></th></tr></thead><tbody>${ob
            .map((x) =>
              linhaFin(
                x,
                (x, op) => `<td>${x.plano.length ? (op ? "▾ " : "▸ ") : ""}${esc(x.tipoLabel)}</td><td><b>${esc(x.entidade)}</b></td><td class="fx2-mut">${esc(x.contrato || "—")}</td><td class="r">${fmt(x.montante)}</td><td class="r"><b>${fmt(x.divida)}</b></td><td class="fx2-mut">${x.proxima ? `${fmtData(x.proxima.d)} · ${fmt(x.proxima.prest)}` : "—"}</td>`
              )
            )
            .join("")}</tbody></table></div>`
        : vazio("Sem empréstimos obtidos de empresas (os bancários estão em E1).")
    }`;

  const secConc = `
    <h3 class="f0-h3">↗ Empréstimos Concedidos</h3>
    ${
      conc.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Pedido</th><th>A quem</th><th class="r">Valor</th><th class="r">Pago</th><th class="r">Devolvido</th><th class="r">Em dívida à MBT</th><th>Devolução até</th><th></th></tr></thead><tbody>${conc
            .map((c) => {
              const emDiv = Math.max(0, c.pago - c.devolvido);
              const venc = c.fim && c.fim < hoje && emDiv > 0.5;
              return `<tr><td><b>${esc(c.numero)}</b></td><td>${esc(c.beneficiario)}</td><td class="r">${fmt(c.valor)}</td><td class="r">${fmt(c.pago)}</td><td class="r">${fmt(c.devolvido)}</td>
                <td class="r"><b>${fmt(emDiv)}</b></td><td${venc ? ' class="f0-neg"' : ""}>${c.fim ? fmtData(c.fim) : "—"}${venc ? ' <span class="fcal-pill fcal-pill--bad">vencido</span>' : ""}</td>
                <td>${podeEditar() ? `<button type="button" class="finance-btn finance-btn--sm" data-e2dev="${esc(c.id)}">Devolvido…</button>` : ""}</td></tr>`;
            })
            .join("")}</tbody></table></div>`
        : vazio("Sem empréstimos concedidos. Criam-se como pedido de pagamento do tipo «Empréstimo» (+ Concedido).")
    }`;

  return `${kpis([
    { tom: "bad", titulo: "A MBT Deve", valor: fmt(P.deve), nota: "empréstimos obtidos (grupo e outras empresas)" },
    { tom: "good", titulo: "Devem à MBT", valor: fmt(P.deveAMbt), nota: "empréstimos concedidos" },
    { tom: P.liquida < 0 ? "warn" : "good", titulo: "Posição Líquida", valor: fmt(P.liquida), nota: P.liquida < 0 ? "a MBT é devedora" : "a MBT é credora" },
    { tom: vencConc.length ? "bad" : "neu", titulo: "Vencidos", valor: fmt(vencVal), nota: `${vencConc.length} empréstimo(s) vencido(s)` },
  ])}
  <div class="cp-filtros" style="margin-bottom:8px">
    ${seg("e2t", "tabE2", S.tabE2, [
      ["ent", "Por Entidade"],
      ["todos", "Todos os Empréstimos"],
      ["conc", `↗ Concedidos (${conc.length})`],
      ["obt", `↙ Obtidos (${ob.length})`],
    ])}
  </div>
  ${S.tabE2 === "ent" ? secEnt + secObt + secConc : S.tabE2 === "conc" ? secConc : S.tabE2 === "obt" ? secObt : secObt + secConc}`;
}

function vistaE3() {
  const L = S.d.itens.filter((x) => x.categoria === "gar" && x.moeda === S.d.moeda).sort((a, b) => (a.validade || "9").localeCompare(b.validade || "9"));
  const r = S.d.e3;
  return `${kpis([
    { tom: "neu", titulo: "Ativas", valor: fmt(r.ativas), nota: `${r.nAtivas} garantia(s) / livrança(s)` },
    { tom: r.aExpirar ? "bad" : "good", titulo: "A Expirar em 30 Dias", valor: String(r.aExpirar), nota: fmt(r.aExpirarValor) },
    { tom: "warn", titulo: "Comissões Anuais Estimadas", valor: fmt(r.comissoes), nota: "sobre o valor ativo" },
  ])}
  ${
    L.length
      ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Tipo</th><th>Banco</th><th>Obra</th><th>Beneficiário</th><th>Modalidade</th><th class="r">Valor</th><th>Emitida</th><th>Válida até</th><th class="r">Comissão</th><th>Estado</th><th></th></tr></thead>
        <tbody>${L.map((x) =>
          linhaFin(
            x,
            () => `<td>${esc(x.tipoLabel)}</td><td><b>${esc(x.entidade)}</b></td><td class="fx2-mut">${esc(x.obra?.codigo || "—")}</td><td class="fx2-mut">${esc(x.beneficiario || "—")}</td>
              <td class="fx2-mut">${esc(x.modalidade || "")}</td><td class="r">${fmt(x.montante)}</td><td>${x.inicio ? fmtData(x.inicio) : "—"}</td>
              <td${x.aExpirar ? ' class="f0-neg"' : ""}>${x.validade ? fmtData(x.validade) : "—"}</td><td class="r">${x.comissao === null ? "—" : `${x.comissao.toLocaleString("pt-PT")}%`}</td>`
          )
        ).join("")}</tbody></table></div>`
      : vazio("Ainda não há garantias nem livranças. Use «+ Nova Garantia / Livrança».")
  }`;
}

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const corpo = S.vista === "E2" ? vistaE2() : S.vista === "E3" ? vistaE3() : vistaE1();
  el.innerHTML = `<div class="cp-filtros">${moedaSeg("e1", S.d.moeda, S.d.moedas)}</div>${corpo}`;
}

async function carregar() {
  try {
    const [d, ob] = await Promise.all([apiRequest(`/finance/financings${S.moeda ? `?moeda=${S.moeda}` : ""}`), S.obras.length ? null : apiRequest("/finance/options/projects")]);
    S.d = d;
    if (ob) S.obras = ob.items || [];
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

function formFin(x) {
  const novo = !x;
  const tipos = S.d.tipos.filter((t) => (S.vista === "E3" ? t.cat === "gar" : S.vista === "E2" && novo ? t.cat === "fin" && t.k !== "EMPRESTIMO_BANCARIO" : t.cat === "fin"));
  const o = x || { tipo: tipos[0]?.k || S.d.tipos[0].k, moeda: "AOA", estado: "ATIVA", periodoMeses: 1, carenciaMeses: 0 };
  const v = (k) => (o[k] === null || o[k] === undefined ? "" : esc(o[k]));
  const campo = (id, l, html, cls = "") => `<div class="finance-field ${cls}" data-fv="${id}"><label class="finance-label">${l}</label>${html}</div>`;
  openModal({
    title: novo ? (S.vista === "E3" ? "Nova garantia / livrança" : S.vista === "E2" ? "Novo empréstimo obtido" : "Novo financiamento") : `${o.tipoLabel} · ${o.entidade}`,
    primaryLabel: "Guardar",
    width: 720,
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      ${campo("tipo", "Tipo *", `<select id="ffT" class="finance-input">${tipos.map((t) => `<option value="${t.k}"${o.tipo === t.k ? " selected" : ""}>${esc(t.l)}</option>`).join("")}</select>`)}
      ${campo("ent", "Entidade (banco / empresa) *", `<input id="ffE" class="finance-input" value="${v("entidade")}">`)}
      ${campo("ctr", "N.º do contrato", `<input id="ffC" class="finance-input" value="${v("contrato")}">`)}
      ${campo("moe", "Moeda", `<select id="ffM" class="finance-input">${["AOA", "USD", "EUR"].map((m) => `<option${o.moeda === m ? " selected" : ""}>${m}</option>`).join("")}</select>`)}
      ${campo("mon", "Montante *", `<input id="ffV" class="finance-input" type="number" min="0" step="any" value="${v("montante")}">`)}
      ${campo("uti", "Utilizado (linhas)", `<input id="ffU" class="finance-input" type="number" min="0" step="any" value="${v("utilizado")}">`, "ff-linha")}
      ${campo("tax", "Taxa anual (%)", `<input id="ffX" class="finance-input" type="number" min="0" step="any" value="${v("taxa")}">`, "ff-plano")}
      ${campo("ini", S.vista === "E3" ? "Emitida em" : "Data de início", `<input id="ffI" class="finance-input" type="date" value="${v("inicio")}">`)}
      ${campo("pra", "Prazo (meses)", `<input id="ffP" class="finance-input" type="number" min="1" step="1" value="${v("prazoMeses")}">`, "ff-plano")}
      ${campo("per", "Prestação a cada (meses)", `<select id="ffQ" class="finance-input">${[1, 3, 6, 12].map((n) => `<option${Number(o.periodoMeses) === n ? " selected" : ""}>${n}</option>`).join("")}</select>`, "ff-plano")}
      ${campo("car", "Carência (meses)", `<input id="ffK" class="finance-input" type="number" min="0" step="1" value="${v("carenciaMeses")}">`, "ff-plano")}
      ${campo("fim", "Fim (linhas)", `<input id="ffF" class="finance-input" type="date" value="${v("fim")}">`, "ff-linha")}
      ${campo("val", "Válida até", `<input id="ffD" class="finance-input" type="date" value="${v("validade")}">`, "ff-gar")}
      ${campo("obr", "Obra", `<select id="ffO" class="finance-input"><option value="">—</option>${S.obras.map((b) => `<option value="${esc(b.id)}"${o.obra?.id === b.id ? " selected" : ""}>${esc([b.code || b.referencia, b.name].filter(Boolean).join(" · "))}</option>`).join("")}</select>`, "ff-gar")}
      ${campo("ben", "Beneficiário", `<input id="ffB" class="finance-input" value="${v("beneficiario")}">`, "ff-gar")}
      ${campo("mod", "Modalidade", `<input id="ffY" class="finance-input" placeholder="ex.: boa execução, adiantamento" value="${v("modalidade")}">`, "ff-gar")}
      ${campo("com", "Comissão anual (%)", `<input id="ffZ" class="finance-input" type="number" min="0" step="any" value="${v("comissao")}">`, "ff-gar")}
      ${campo("est", "Estado", `<select id="ffS" class="finance-input">${Object.entries(ESTADO).map(([k, [l]]) => `<option value="${k}"${o.estado === k ? " selected" : ""}>${l}</option>`).join("")}</select>`)}
      ${campo("not", "Notas", `<input id="ffN" class="finance-input" value="${v("notas")}">`, "finance-field--full")}
      ${novo ? "" : `<div class="finance-field--full"><button type="button" class="finance-btn" id="ffDel">Apagar</button></div>`}
    </div>`,
    onRender: ({ panel, close }) => {
      const mostra = () => {
        const t = panel.querySelector("#ffT").value;
        const def = S.d.tipos.find((x) => x.k === t);
        const linha = t === "LINHA_CREDITO";
        const gar = def?.cat === "gar";
        panel.querySelectorAll(".ff-linha").forEach((e) => (e.style.display = linha ? "" : "none"));
        panel.querySelectorAll(".ff-plano").forEach((e) => (e.style.display = !linha && !gar ? "" : "none"));
        panel.querySelectorAll(".ff-gar").forEach((e) => (e.style.display = gar ? "" : "none"));
      };
      panel.querySelector("#ffT").addEventListener("change", mostra);
      mostra();
      panel.querySelector("#ffDel")?.addEventListener("click", async () => {
        if (!confirm("Apagar este registo? Não se pode desfazer.")) return;
        try {
          await apiRequest(`/finance/financings/${o.id}`, { method: "DELETE" });
          close();
          carregar();
        } catch (e) {
          toast(e.message || "Não foi possível apagar.", { type: "error" });
        }
      });
    },
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id).value.trim();
      const num = (id) => ($(id) === "" ? null : Number($(id)));
      const body = {
        tipo: $("#ffT"),
        entidade: $("#ffE"),
        contrato: $("#ffC") || null,
        moeda: $("#ffM"),
        montante: Number($("#ffV")),
        utilizado: num("#ffU"),
        taxa: num("#ffX"),
        inicio: $("#ffI") || null,
        prazoMeses: num("#ffP"),
        periodoMeses: num("#ffQ"),
        carenciaMeses: num("#ffK"),
        fim: $("#ffF") || null,
        validade: $("#ffD") || null,
        obraId: $("#ffO") || null,
        beneficiario: $("#ffB") || null,
        modalidade: $("#ffY") || null,
        comissao: num("#ffZ"),
        estado: $("#ffS"),
        notas: $("#ffN") || null,
      };
      if (body.entidade.length < 2 || !(body.montante > 0)) return toast("Indique a entidade e o montante.", { type: "error" });
      try {
        await apiRequest(novo ? "/finance/financings" : `/finance/financings/${o.id}`, { method: novo ? "POST" : "PATCH", body });
        close();
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível guardar.", { type: "error" });
      }
    },
  });
}

function devolvido(c) {
  openModal({
    title: `Devolvido · ${c.numero}`,
    primaryLabel: "Guardar",
    contentHtml: `<div class="finance-field"><label class="finance-label">Total já devolvido à MBT</label><input id="dvV" class="finance-input" type="number" min="0" step="any" value="${c.devolvido || ""}"></div>`,
    onPrimary: async ({ panel, close }) => {
      try {
        await apiRequest(`/finance/financings/granted/${c.id}/returned`, { method: "POST", body: { devolvido: Number(panel.querySelector("#dvV").value) || 0 } });
        close();
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível guardar.", { type: "error" });
      }
    },
  });
}

export async function render(meta) {
  S.vista = meta?.vista || "E1";
  codigoNoCabecalho(S.vista);
  const acts = document.getElementById("financePageActions");
  if (acts && podeEditar()) {
    acts.innerHTML =
      S.vista === "E2"
        ? `<button type="button" class="finance-btn" id="e1Novo">+ Obtido</button> <a class="finance-btn finance-btn--primary" href="/Financeiro/novoPedido?type=EMPRESTIMO&lockType=1&returnTo=%2FFinanceiro%2Femprestimos">+ Concedido</a>`
        : `<button type="button" class="finance-btn finance-btn--primary" id="e1Novo">${S.vista === "E3" ? "+ Nova Garantia / Livrança" : "+ Novo Financiamento"}</button>`;
    document.getElementById("e1Novo").onclick = () => S.d && formFin(null);
  }
  root().addEventListener("click", (e) => {
    const t = e.target;
    const m = t.closest("[data-e1]");
    if (m) {
      S.moeda = m.dataset.e1.split("|")[1];
      return carregar();
    }
    const tb = t.closest("[data-e2t]");
    if (tb) {
      const [k, v] = tb.dataset.e2t.split("|");
      S[k] = v;
      return desenhar();
    }
    const ed = t.closest("[data-e1ed]");
    if (ed) return formFin(S.d.itens.find((x) => x.id === ed.dataset.e1ed));
    const dv = t.closest("[data-e2dev]");
    if (dv) return devolvido(S.d.concedidos.find((c) => c.id === dv.dataset.e2dev));
    const ab = t.closest("[data-e1ab]");
    if (ab) {
      const id = ab.dataset.e1ab;
      if (S.aberto.has(id)) S.aberto.delete(id);
      else S.aberto.add(id);
      desenhar();
    }
  });
  root().addEventListener("change", (e) => {
    if (e.target.dataset.e1est !== undefined) {
      S.estE1 = e.target.value;
      desenhar();
    }
  });
  desenhar();
  await carregar();
}
