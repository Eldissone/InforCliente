/**
 * Oficina — o grupo «Oficina» da área Frota no protótipo (v660/v667):
 *   oficina     Calendário (dia / semana / mês, arrastar para reagendar) e listas laterais
 *   ordens      Ordens de Trabalho, com o ponto de situação
 *   material    Material entregue pela empresa a cada ordem
 *   indicadores Horas por técnico, tempo de reparação, trabalhos no prazo
 *
 * Uma ordem de trabalho é uma intervenção da frota com estado de oficina
 * (`GET /fleet/workshop`). Permissões: `oficina` ou `frota`.
 */

import { apiRequest } from "../../services/api.js";
import { toast } from "../ui.js";
import { abrirPainel } from "./painel.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, kpis, vazio, erro } from "../finance/f2Ui.js";
import { norm, pesquisa } from "../compras/ui.js";

const root = () => document.getElementById("financeRoot");
const S = { vista: "oficina", d: null, erro: null, q: "", f: "", md: "sem", dia: "" };

const podeCriar = () => can("oficina", "create") || can("frota", "create");
const podeEditar = () => can("oficina", "edit") || can("frota", "edit");

const COR = { Pedido: "#7a8580", Marcado: "#3a6ea5", Recebida: "#8a5cc2", "Em Trabalho": "#d98a00", "Concluído": "#1f7a42", Entregue: "#2b2f2d", Cancelado: "#b8372b" };
const DS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const pill = (t, tom) => `<span class="fcal-pill fcal-pill--${tom === "neu" ? "slate" : tom}">${esc(t)}</span>`;
const estPill = (e) => `<span class="of-est" style="--c:${COR[e] || "#7a8580"}">● ${esc(e)}</span>`;

const addD = (d, k) => new Date(Date.parse(`${d}T12:00:00Z`) + k * 864e5).toISOString().slice(0, 10);
const wk0 = (d) => addD(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));

const vById = (id) => S.d?.viaturas.find((v) => v.id === id);
const vDe = (x) => (x.vehicleId ? vById(x.vehicleId) : null);
const matDe = (x) => vDe(x)?.plate || x.workOrder?.ext?.mat || "—";
const nomeV = (x) => {
  const v = vDe(x);
  if (v) return [v.brand, v.model].filter(Boolean).join(" ");
  const e = x.workOrder?.ext;
  return e ? `${e.cli}${e.viat ? ` · ${e.viat}` : ""}` : "";
};
const otById = (id) => S.d?.ots.find((x) => x.id === id);
const ativos = () => S.d.ots.filter((x) => x.workOrderStatus !== "Cancelado");
const filtroQ = (x) => {
  const q = norm(S.q).trim();
  return !q || norm([matDe(x), nomeV(x), x.code, x.type, x.description, x.workshop].join(" ")).includes(q);
};

// ─── Calendário ───────────────────────────────────────────────────────────────

function cartao(x, grande) {
  const e = x.workOrderStatus;
  const wo = x.workOrder;
  const matP = wo.mat.filter((m) => m.est === "Por entregar" || m.est === "Não recebido").length;
  return `<div class="of-card${grande ? " of-card--g" : ""}${x._atrasada ? " is-atr" : ""}${e === "Pedido" ? " is-ped" : ""}" draggable="${podeEditar()}" data-ofot="${esc(x.id)}" style="--c:${COR[e]}" title="${esc(`${x.code} · ${x.type} · ${e}`)}">
    <div class="of-ct">${x._hora ? `<span>${esc(x._hora)}</span>` : ""}<b>${esc(matDe(x))}</b>${wo.prio !== "Normal" ? `<i title="${esc(wo.prio)}" class="material-symbols-outlined">priority_high</i>` : ""}${wo.ext ? `<i title="Cliente externo" class="material-symbols-outlined">person</i>` : ""}</div>
    <div class="of-cs">${esc(x.type)}</div>
    ${grande ? `<div class="of-cs">${esc(String(x.description || "").split("\n")[0].slice(0, 80))}</div>` : ""}
    <div class="of-cf">${estPill(e)}${matP ? `<span title="Material por receber" class="material-symbols-outlined of-mat">inventory_2</span>` : ""}</div>
  </div>`;
}

function vistaCalendario() {
  const hoje = S.d.hoje;
  const d = S.dia || hoje;
  const A = ativos().filter(filtroQ);
  const noDia = (dd) => A.filter((x) => x._dia === dd).sort((a, b) => String(a._hora).localeCompare(String(b._hora)));
  let ini;
  let tit;
  let grelha;
  if (S.md === "dia") {
    tit = `${DS[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]}, ${fmtData(d)}`;
    const L = noDia(d);
    grelha = `<div class="of-day of-day--d" data-ofdrop="${d}">${L.map((x) => cartao(x, true)).join("") || `<p class="fx2-mut" style="padding:1.25rem;text-align:center">Nada marcado para este dia.</p>`}${podeCriar() ? `<button type="button" class="of-add" data-ofnovo="${d}">+ Novo trabalho neste dia</button>` : ""}</div>`;
  } else if (S.md === "mes") {
    ini = wk0(`${d.slice(0, 7)}-01`);
    tit = `${MS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
    let g = "";
    for (let i = 0; i < 42; i++) {
      const dd = addD(ini, i);
      const L = noDia(dd);
      g += `<div class="of-day of-day--m${dd.slice(0, 7) !== d.slice(0, 7) ? " is-out" : ""}${dd === hoje ? " is-hoje" : ""}" data-ofdrop="${dd}"><button type="button" class="of-dn" data-ofgo="dia|${dd}">${Number(dd.slice(8))}</button>${L.slice(0, 3).map((x) => cartao(x)).join("")}${L.length > 3 ? `<button type="button" class="of-mais" data-ofgo="dia|${dd}">+${L.length - 3} mais</button>` : ""}</div>`;
    }
    grelha = `<div class="of-grid of-grid--m">${DS.map((x) => `<div class="of-dh">${x}</div>`).join("")}${g}</div>`;
  } else {
    ini = wk0(d);
    tit = `Semana de ${fmtData(ini)} a ${fmtData(addD(ini, 6))}`;
    let g = "";
    for (let i = 0; i < 7; i++) {
      const dd = addD(ini, i);
      const L = noDia(dd);
      g += `<div class="of-day of-day--w${dd === hoje ? " is-hoje" : ""}" data-ofdrop="${dd}"><button type="button" class="of-dh2" data-ofgo="dia|${dd}"><b>${DS[i]}</b> ${dd.slice(8)}/${dd.slice(5, 7)}<span>${L.length || ""}</span></button>${L.map((x) => cartao(x)).join("")}${podeCriar() ? `<button type="button" class="of-add" data-ofnovo="${dd}" title="Novo trabalho neste dia">+</button>` : ""}</div>`;
    }
    grelha = `<div class="of-grid of-grid--w">${g}</div>`;
  }
  const passo = (s) => {
    if (S.md === "mes") {
      const x = new Date(`${d.slice(0, 7)}-15T12:00:00Z`);
      x.setUTCMonth(x.getUTCMonth() + s);
      return x.toISOString().slice(0, 10);
    }
    return addD(d, s * (S.md === "dia" ? 1 : 7));
  };
  const K = S.d.calendario.kpis;
  const L = S.d.calendario.listas;
  const lado = (titulo, ids, vazioTxt, det) => {
    const X = ids.map(otById).filter(Boolean);
    return `<section class="fx2-blk of-side"><h3>${esc(titulo)} ${pill(String(X.length), X.length ? "warn" : "good")}</h3>${
      X.length ? X.map((x) => `<div class="of-sr" data-ofot="${esc(x.id)}"><b>${esc(matDe(x))}</b> <span>${esc(x.type)}</span><div class="fx2-mut">${det(x)}</div></div>`).join("") : `<p class="fx2-mut">${esc(vazioTxt)}</p>`
    }</section>`;
  };
  return `
    ${kpis([
      { tom: K.pedidos ? "warn" : "good", titulo: "Pedidos por Aceitar", valor: String(K.pedidos), nota: "da frota" },
      { tom: "neu", titulo: "Para Hoje", valor: String(K.hoje), nota: fmtData(hoje) },
      { tom: "blue", titulo: "Viaturas na Oficina", valor: String(K.dentro), nota: "recebidas / em trabalho" },
      { tom: K.material ? "warn" : "good", titulo: "Material por Receber", valor: String(K.material), nota: "ordens à espera" },
      { tom: K.atrasados ? "bad" : "good", titulo: "Atrasados", valor: String(K.atrasados), nota: "passou a data" },
    ])}
    <div class="of-wrap">
      <section class="fx2-blk of-cal">
        <div class="of-bar">
          <button type="button" class="finance-btn" data-ofgo="nav|${passo(-1)}">‹</button>
          <button type="button" class="finance-btn" data-ofgo="nav|${hoje}">Hoje</button>
          <button type="button" class="finance-btn" data-ofgo="nav|${passo(1)}">›</button>
          <b class="of-tit">${esc(tit)}</b>
          <span class="finance-seg" style="margin-left:auto">${[["dia", "Dia"], ["sem", "Semana"], ["mes", "Mês"]].map(([k, l]) => `<button type="button" class="${S.md === k ? "active" : ""}" data-ofgo="md|${k}">${l}</button>`).join("")}</span>
          ${pesquisa(S, "Procurar…")}
        </div>
        <div class="of-leg">${S.d.listas.estados.filter((e) => e !== "Cancelado").map((e) => `<span><i style="background:${COR[e]}"></i>${esc(e)}</span>`).join("")}${podeEditar() ? `<span class="fx2-mut">· arraste um cartão para outro dia para reagendar</span>` : ""}</div>
        ${grelha}
      </section>
      <div class="of-col">
        ${lado("Pedidos Novos por Aceitar", L.pedidos, "Sem pedidos novos.", (x) => `pretendido ${fmtData(x.workOrder.pedido?.dp)} ${esc(x.workOrder.pedido?.hp || "")} · ${esc(x.workOrder.pedido?.por || "")}`)}
        ${lado("Preparar Amanhã", L.amanha, "Nada marcado para amanhã.", (x) => `${esc(x._hora || "")} ${esc(x.workshop || "")}`)}
        ${lado("Na Oficina Agora", L.dentro, "Nenhuma viatura dentro da oficina.", (x) => esc(x._sit[0]))}
        ${L.material.length ? lado("Material por Receber", L.material, "", (x) => esc(x.workOrder.mat.filter((m) => m.est === "Por entregar" || m.est === "Não recebido").map((m) => m.desc).join(", "))) : ""}
      </div>
    </div>`;
}

// ─── Ordens de Trabalho ───────────────────────────────────────────────────────

function vistaOrdens() {
  const A = S.d.ots.filter(filtroQ);
  const aberta = (x) => !["Entregue", "Cancelado"].includes(x.workOrderStatus);
  const F = [
    ["", "Em aberto", A.filter(aberta)],
    ["Pedido", "Por aceitar", A.filter((x) => x.workOrderStatus === "Pedido")],
    ["cur", "Em curso", A.filter((x) => ["Marcado", "Recebida", "Em Trabalho"].includes(x.workOrderStatus))],
    ["Concluído", "Prontas", A.filter((x) => x.workOrderStatus === "Concluído")],
    ["Entregue", "Entregues", A.filter((x) => x.workOrderStatus === "Entregue")],
    ["all", "Todas", A],
  ];
  const sel = F.find((x) => x[0] === S.f) || F[0];
  const L = sel[2].slice().sort((a, b) => String(b._dia).localeCompare(String(a._dia)));
  return `
    <div class="fcal-filtros">${pesquisa(S, "matrícula, n.º, serviço…")}
      <div class="fx2-chips">${F.map(([k, l, x]) => `<button type="button" class="fx2-chip${sel[0] === k ? " on" : ""}" data-oft="${k}"><span>${esc(l)}</span><b>${x.length}</b></button>`).join("")}</div></div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>N.º</th><th>Viatura</th><th>Serviço</th><th>Oficina</th><th>Data</th><th>Entrega</th><th>Estado</th><th>Ponto de Situação</th><th class="r">Custo</th></tr></thead><tbody>${L.map(
            (x) => `<tr data-ofot="${esc(x.id)}" style="cursor:pointer"><td><b>${esc(x.code)}</b></td><td><b>${esc(matDe(x))}</b> <span class="fx2-mut">${esc(nomeV(x))}</span></td><td class="fx2-mut">${esc(x.type)}${x.workOrder.prio !== "Normal" ? ` ${pill(x.workOrder.prio, "bad")}` : ""}</td><td class="fx2-mut">${esc(x.workshop || "")}</td><td>${fmtData(x._dia)}${x._hora ? ` <span class="fx2-mut">${esc(x._hora)}</span>` : ""}</td><td>${x.workOrder.de ? fmtData(x.workOrder.de) : "—"}</td><td>${estPill(x.workOrderStatus)}</td><td>${pill(x._sit[0], x._sit[1])}</td><td class="r">${fmt((x.laborCost || 0) + (x.partsCost || 0) + (x.otherCost || 0))}</td></tr>`
          ).join("")}</tbody></table></div>`
        : vazio(S.d.ots.length ? "Nenhuma ordem com estes filtros." : "Ainda não há ordens de trabalho. Crie a primeira em «+ Novo Trabalho» ou peça à oficina a partir da frota.")
    }`;
}

// ─── Material ─────────────────────────────────────────────────────────────────

function vistaMaterial() {
  const R = S.d.materiais.filter((m) => {
    const x = otById(m.otId);
    return x && filtroQ(x);
  });
  const P = (m) => m.est === "Por entregar" || m.est === "Não recebido";
  const F = [
    ["", "Por receber", R.filter(P)],
    ["Recebido", "Recebido", R.filter((m) => m.est === "Recebido")],
    ["Aplicado", "Aplicado", R.filter((m) => m.est === "Aplicado")],
    ["Devolvido", "Devolvido", R.filter((m) => m.est === "Devolvido")],
    ["all", "Todo", R],
  ];
  const sel = F.find((x) => x[0] === S.f) || F[0];
  return `
    <div class="fcal-filtros">${pesquisa(S, "matrícula, n.º…")}
      <div class="fx2-chips">${F.map(([k, l, x]) => `<button type="button" class="fx2-chip${sel[0] === k ? " on" : ""}" data-oft="${k}"><span>${esc(l)}</span><b>${x.length}</b></button>`).join("")}</div></div>
    ${
      sel[2].length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Ordem</th><th>Viatura</th><th>Material</th><th class="r">Enviado</th><th class="r">Recebido</th><th class="r">Aplicado</th><th>Un.</th><th>Estado</th><th>Data</th></tr></thead><tbody>${sel[2]
            .map((m) => {
              const x = otById(m.otId);
              return `<tr data-ofot="${esc(m.otId)}" style="cursor:pointer"><td><b>${esc(m.code)}</b></td><td>${esc(matDe(x))}</td><td>${esc(m.desc)}</td><td class="r">${esc(m.q || "")}</td><td class="r">${esc(m.qR || "")}</td><td class="r">${esc(m.qA || "")}</td><td class="fx2-mut">${esc(m.un || "")}</td><td>${pill(m.est, P(m) ? "warn" : m.est === "Aplicado" ? "good" : "slate")}</td><td>${fmtData(m.dia)}</td></tr>`;
            })
            .join("")}</tbody></table></div>`
        : vazio("Sem material.")
    }
    <p class="fcal-nota">Material que a empresa entrega à oficina para cada ordem de trabalho. A oficina confirma o que recebeu e o que aplicou, na ficha da ordem.</p>`;
}

// ─── Indicadores ──────────────────────────────────────────────────────────────

function vistaIndicadores() {
  const K = S.d.indicadores;
  const mx = Math.max(1, ...K.porTecnico.map((t) => t.horas));
  const estados = S.d.listas.estados.filter((e) => K.porEstado[e]);
  return `
    ${kpis([
      { tom: "blue", titulo: "Ordens de Trabalho", valor: String(K.total), nota: `${K.porAceitar} por aceitar` },
      { tom: "neu", titulo: "Concluídas / Entregues", valor: String(K.feitas), nota: "&nbsp;" },
      { tom: "neu", titulo: "Tempo Médio de Reparação", valor: K.tempoMedio === null ? "—" : `${K.tempoMedio.toLocaleString("pt-PT", { maximumFractionDigits: 1 })} dias`, nota: "da entrada à saída" },
      { tom: K.pctPrazo === null ? "neu" : K.pctPrazo < 0.8 ? "warn" : "good", titulo: "No Prazo", valor: K.pctPrazo === null ? "—" : `${Math.round(K.pctPrazo * 100)} %`, nota: K.comPrazo ? `${K.noPrazo} de ${K.comPrazo} com entrega prevista` : "sem entregas previstas" },
      { tom: "neu", titulo: "Horas Registadas", valor: `${K.horas.toLocaleString("pt-PT", { maximumFractionDigits: 1 })} h`, nota: "&nbsp;" },
      { tom: "neu", titulo: "Mão de Obra", valor: fmt(K.maoDeObra), nota: "Kz, nas ordens" },
    ])}
    <div class="fx2-cols">
      <section class="fx2-blk"><h3>Horas por Técnico</h3>${
        K.porTecnico.length
          ? K.porTecnico.map((t) => `<div class="fx2-lin"><span>${esc(t.tec)}</span><b>${t.horas.toLocaleString("pt-PT", { maximumFractionDigits: 1 })} h</b></div><span class="fx2-bar"><i class="fx2-bar--en" style="width:${((t.horas / mx) * 100).toFixed(1)}%"></i></span>`).join("")
          : `<p class="fx2-mut">Ainda sem horas registadas nas ordens de trabalho.</p>`
      }</section>
      <section class="fx2-blk"><h3>Ordens por Estado</h3>${
        estados.length
          ? estados.map((e) => `<div class="fx2-lin"><span>${estPill(e)}</span><b>${K.porEstado[e]}</b></div><span class="fx2-bar"><i style="width:${((K.porEstado[e] / Math.max(1, K.total)) * 100).toFixed(1)}%;background:${COR[e]}"></i></span>`).join("")
          : `<p class="fx2-mut">—</p>`
      }</section>
    </div>`;
}

// ─── Ficha da ordem / novo pedido ─────────────────────────────────────────────

const linhasHtml = (k, L, cols) =>
  `<div data-ofl="${k}">${L.map(
    (r) => `<div class="of-ln">${cols
      .map(([f, ph, w, tipo, opts]) =>
        tipo === "sel"
          ? `<select class="finance-input" data-c="${f}" style="flex:${w}">${opts.map((o) => `<option${o === (r[f] || "") ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
          : `<input class="finance-input" data-c="${f}" style="flex:${w}" ${tipo ? `type="${tipo}"` : ""} placeholder="${esc(ph)}" value="${esc(r[f] ?? "")}">`
      )
      .join("")}<button type="button" class="finance-btn" data-ofrm title="Remover">✕</button></div>`
  ).join("")}</div><button type="button" class="finance-btn" data-ofadd="${k}">+ Linha</button>`;

const lerLinhas = (panel, k) =>
  [...panel.querySelectorAll(`[data-ofl="${k}"] .of-ln`)].map((ln) => Object.fromEntries([...ln.querySelectorAll("[data-c]")].map((el) => [el.dataset.c, el.value.trim()])));

const COLS = () => ({
  trab: [["desc", "trabalho pedido (ex.: mudar óleo e filtros)", 1]],
  trabE: [["desc", "trabalho", 5], ["est", "", 2, "sel", S.d.listas.estadosTrabalho], ["nota", "motivo / nota", 3]],
  mat: [["desc", "material (ex.: filtro de óleo)", 4], ["q", "qtd.", 1], ["un", "un.", 1]],
  matE: [["desc", "material", 4], ["q", "enviado", 1], ["est", "", 2, "sel", S.d.listas.estadosMaterial], ["qR", "recebido", 1], ["qA", "aplicado", 1], ["un", "un.", 1]],
  horas: [["tec", "técnico", 3], ["d", "", 2, "date"], ["ini", "", 1.4, "time"], ["fim", "", 1.4, "time"]],
});

function ligarLinhas(panel) {
  panel.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-ofrm]");
    if (rm) return rm.closest(".of-ln").remove();
    const ad = e.target.closest("[data-ofadd]");
    if (!ad) return;
    const k = ad.dataset.ofadd;
    const def = k === "horas" ? { d: S.d.hoje } : k === "matE" ? { est: "Por entregar" } : {};
    const tmp = document.createElement("div");
    tmp.innerHTML = linhasHtml(k, [def], COLS()[k]);
    panel.querySelector(`[data-ofl="${k}"]`).appendChild(tmp.querySelector(".of-ln"));
  });
}

function formNovo({ dia = "", modo = "of", vehicleId = "" } = {}) {
  const daOficina = modo === "of";
  const optsV = S.d.viaturas.filter((v) => v.active !== false).map((v) => `<option value="${esc(v.id)}"${v.id === vehicleId ? " selected" : ""}>${esc(`${v.plate} · ${[v.brand, v.model].filter(Boolean).join(" ")}`)}</option>`).join("");
  const sel = (id, opts, val) => `<select id="${id}" class="finance-input">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === val ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const campo = (l, html, cls = "") => `<div class="finance-field ${cls}"><label class="finance-label">${esc(l)}</label>${html}</div>`;
  abrirPainel({
    title: daOficina ? "Novo Trabalho na Oficina" : "Pedido à Oficina",
    width: 780,
    primaryLabel: daOficina ? "Criar Trabalho" : "Validar e Enviar",
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      ${daOficina ? campo("Para quem", sel("ofPara", [["MBT", "Viatura da empresa"], ["EXT", "Cliente externo"]], "MBT")) : ""}
      ${campo("Viatura / equipamento *", `<select id="ofV" class="finance-input"><option value="">—</option>${optsV}</select>`, "of-mbt")}
      ${daOficina ? campo("Cliente *", `<input id="ofEc" class="finance-input">`, "of-ext") + campo("Matrícula", `<input id="ofEm" class="finance-input">`, "of-ext") + campo("Viatura (marca / modelo)", `<input id="ofEv" class="finance-input">`, "of-ext") + campo("Telefone", `<input id="ofEt" class="finance-input">`, "of-ext") : ""}
      ${campo("Tipo de serviço *", sel("ofTs", S.d.listas.tiposServico.map((t) => [t, t]), "Manutenção programada"))}
      ${campo("Prioridade", sel("ofPr", S.d.listas.prioridades.map((t) => [t, t]), "Normal"))}
      ${daOficina ? "" : campo("Oficina", sel("ofOf", [["", `${S.d.listas.oficinaPropria} (própria)`], ...S.d.oficinas.map((f) => [f.id, f.name])], ""))}
      ${campo(daOficina ? "Data marcada" : "Data pretendida", `<input id="ofDp" type="date" class="finance-input" value="${esc(dia || (daOficina ? S.d.hoje : addD(S.d.hoje, 1)))}">`)}
      ${campo("Hora", `<input id="ofHp" type="time" class="finance-input" value="08:00">`)}
      ${daOficina ? campo("Entrega prevista", `<input id="ofDe" type="date" class="finance-input">`) + campo("Técnico responsável", `<input id="ofTec" class="finance-input">`) : ""}
    </div>
    <section class="fx2-blk" style="margin-top:1rem"><h3>O Que Queremos Feito *</h3>${linhasHtml("trab", [{}], COLS().trab)}</section>
    <section class="fx2-blk"><h3>Material</h3>${sel("ofMm", [["NA", "Não precisa de material"], ["Sim", "A empresa entrega o material"], ["Não", "A oficina fornece (pedir cotação)"]], "NA")}<div id="ofMat" style="margin-top:.5rem;display:none">${linhasHtml("mat", [{}], COLS().mat)}</div></section>
    <div class="finance-field finance-field--full"><label class="finance-label">Observações para a oficina</label><textarea id="ofObs" class="finance-input" rows="2"></textarea></div>`,
    onRender: ({ panel }) => {
      ligarLinhas(panel);
      const para = panel.querySelector("#ofPara");
      const mostra = () => {
        const ext = para?.value === "EXT";
        panel.querySelectorAll(".of-ext").forEach((e) => (e.style.display = ext ? "" : "none"));
        panel.querySelectorAll(".of-mbt").forEach((e) => (e.style.display = ext ? "none" : ""));
      };
      para?.addEventListener("change", mostra);
      mostra();
      const mm = panel.querySelector("#ofMm");
      mm.addEventListener("change", () => (panel.querySelector("#ofMat").style.display = mm.value === "Sim" ? "" : "none"));
    },
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id)?.value.trim() || "";
      const ext = $("#ofPara") === "EXT";
      const body = {
        modo,
        vehicleId: ext ? "" : $("#ofV"),
        ext: ext ? { cli: $("#ofEc"), mat: $("#ofEm"), viat: $("#ofEv"), tel: $("#ofEt") } : null,
        tipoServ: $("#ofTs"),
        prio: $("#ofPr"),
        supplierId: $("#ofOf") || null,
        dp: $("#ofDp"),
        hp: $("#ofHp"),
        de: $("#ofDe"),
        tec: $("#ofTec"),
        trab: lerLinhas(panel, "trab"),
        matMBT: $("#ofMm"),
        mat: lerLinhas(panel, "mat"),
        obs: $("#ofObs"),
      };
      if (ext ? !body.ext.cli : !body.vehicleId) return toast(ext ? "Indique o cliente." : "Escolha a viatura.", { type: "error" });
      if (!body.trab.some((t) => t.desc)) return toast("Escreva pelo menos um trabalho pedido.", { type: "error" });
      try {
        const r = await apiRequest("/fleet/workshop", { method: "POST", body });
        close();
        toast(daOficina ? `Trabalho ${r.code} criado.` : `Pedido ${r.code} enviado à oficina.`);
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível guardar.", { type: "error" });
      }
    },
  });
}

function fichaOT(x) {
  const wo = x.workOrder;
  const ed = podeEditar();
  const passos = S.d.listas.estados.filter((e) => e !== "Cancelado");
  const v = vDe(x);
  abrirPainel({
    title: `Ordem de Trabalho ${x.code} · ${matDe(x)}`,
    width: 900,
    primaryLabel: ed ? "Guardar" : "",
    secondaryLabel: ed ? "Cancelar" : "Fechar",
    contentHtml: `
      <p class="fx2-mut" style="margin:0 0 .5rem">${esc(x.workshop || "")}${wo.prio !== "Normal" ? ` · <b style="color:#b8372b">${esc(wo.prio)}</b>` : ""} · ${esc(x.type)}${v ? ` · ${esc(nomeV(x))}` : ""}</p>
      ${wo.ext ? `<p style="margin:0 0 .5rem">Cliente externo: <b>${esc(wo.ext.cli)}</b> · ${esc(wo.ext.mat || "")} ${esc(wo.ext.viat || "")} ${wo.ext.tel ? `· ${esc(wo.ext.tel)}` : ""}</p>` : ""}
      <div class="of-steps">${passos.map((e) => `<button type="button" class="of-step${x.workOrderStatus === e ? " on" : ""}" style="--c:${COR[e]}" data-ofst="${e}"${ed ? "" : " disabled"}>${esc(e)}</button>`).join("<span>›</span>")}
        <button type="button" class="of-step${x.workOrderStatus === "Cancelado" ? " on" : ""}" style="--c:${COR.Cancelado};margin-left:auto" data-ofst="Cancelado"${ed ? "" : " disabled"}>Cancelar ordem</button></div>
      ${wo.pedido ? `<p class="fx2-mut" style="margin:.5rem 0">Pedido por <b>${esc(wo.pedido.por || "")}</b> em ${fmtData(wo.pedido.d)} · pretendido ${fmtData(wo.pedido.dp)} ${esc(wo.pedido.hp || "")}${wo.pedido.obs ? ` · ${esc(wo.pedido.obs)}` : ""}</p>` : ""}
      <div class="finance-form-grid finance-form-grid--3" style="margin-top:.5rem">
        <div class="finance-field"><label class="finance-label">Data marcada</label><input id="otDm" type="date" class="finance-input" value="${esc(wo.dm || "")}"></div>
        <div class="finance-field"><label class="finance-label">Hora</label><input id="otHm" type="time" class="finance-input" value="${esc(wo.hm || "")}"></div>
        <div class="finance-field"><label class="finance-label">Entrega prevista</label><input id="otDe" type="date" class="finance-input" value="${esc(wo.de || "")}"></div>
        <div class="finance-field"><label class="finance-label">Técnico responsável</label><input id="otTec" class="finance-input" value="${esc(wo.tec || "")}"></div>
        <div class="finance-field"><label class="finance-label">${v ? `Km / horas (${v.unit === "HORAS" ? "h" : "km"})` : "Km / horas"}</label><input id="otKm" type="number" min="0" class="finance-input" value="${esc(x.odometer ?? "")}"></div>
        <div class="finance-field"><label class="finance-label">Prioridade</label><select id="otPr" class="finance-input">${S.d.listas.prioridades.map((p) => `<option${p === wo.prio ? " selected" : ""}>${esc(p)}</option>`).join("")}</select></div>
      </div>
      <h4 class="of-h">Trabalhos Pedidos</h4>${linhasHtml("trabE", wo.trab, COLS().trabE)}
      <h4 class="of-h">Material Entregue pela Empresa <span class="fx2-mut">— a oficina confirma o que recebeu e o que aplicou</span></h4>${linhasHtml("matE", wo.mat, COLS().matE)}
      <h4 class="of-h">Horas de Trabalho <span class="fx2-mut">— total ${x._horas.toLocaleString("pt-PT", { maximumFractionDigits: 2 })} h</span></h4>${linhasHtml("horas", wo.horas, COLS().horas)}
      <h4 class="of-h">Custos (Kz)</h4>
      <div class="finance-form-grid finance-form-grid--3">
        <div class="finance-field"><label class="finance-label">Mão de obra</label><input id="otMo" type="number" min="0" step="any" class="finance-input" value="${esc(x.laborCost ?? "")}"></div>
        <div class="finance-field"><label class="finance-label">Peças</label><input id="otPc" type="number" min="0" step="any" class="finance-input" value="${esc(x.partsCost ?? "")}"></div>
        <div class="finance-field"><label class="finance-label">Outros</label><input id="otOu" type="number" min="0" step="any" class="finance-input" value="${esc(x.otherCost ?? "")}"></div>
      </div>
      <h4 class="of-h">Conversa deste Pedido</h4>
      <div class="of-chat">${wo.chat.map((c) => `<div class="of-msg"><b>${esc(c.por || "")}</b> <span class="fx2-mut">${fmtData(c.d)} ${esc(String(c.d || "").slice(11, 16))}</span><div>${esc(c.t || "")}</div></div>`).join("") || `<p class="fx2-mut">Sem mensagens.</p>`}</div>
      <div style="display:flex;gap:.4rem;margin-top:.4rem"><input id="otMsg" class="finance-input" style="flex:1" placeholder="Escrever mensagem…"><button type="button" class="finance-btn finance-btn--primary" data-ofmsg>Enviar</button></div>`,
    onRender: ({ panel, close }) => {
      ligarLinhas(panel);
      if (!ed) panel.querySelectorAll("input:not(#otMsg), select, [data-ofadd], [data-ofrm]").forEach((el) => (el.disabled = true));
      panel.addEventListener("click", async (e) => {
        const st = e.target.closest("[data-ofst]");
        if (st && ed) {
          const novo = st.dataset.ofst;
          if (novo === x.workOrderStatus) return;
          if (novo === "Cancelado" && !confirm(`Cancelar a ordem ${x.code}?`)) return;
          try {
            await apiRequest(`/fleet/workshop/${x.id}/state`, { method: "POST", body: { estado: novo } });
            toast(`${x.code}: ${novo}.`);
            close();
            await carregar();
            const y = otById(x.id);
            if (y) fichaOT(y);
          } catch (er) {
            toast(er.message || "Não foi possível mudar o estado.", { type: "error" });
          }
          return;
        }
        if (e.target.closest("[data-ofmsg]")) {
          const t = panel.querySelector("#otMsg").value.trim();
          if (!t) return;
          try {
            await apiRequest(`/fleet/workshop/${x.id}/messages`, { method: "POST", body: { t } });
            const box = panel.querySelector(".of-chat");
            box.insertAdjacentHTML("beforeend", `<div class="of-msg"><b>Eu</b> <span class="fx2-mut">agora</span><div>${esc(t)}</div></div>`);
            panel.querySelector("#otMsg").value = "";
          } catch (er) {
            toast(er.message || "Não foi possível enviar.", { type: "error" });
          }
        }
      });
    },
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id)?.value.trim() ?? "";
      const body = {
        dm: $("#otDm"),
        hm: $("#otHm"),
        de: $("#otDe"),
        tec: $("#otTec"),
        prio: $("#otPr"),
        odometer: $("#otKm"),
        trab: lerLinhas(panel, "trabE"),
        mat: lerLinhas(panel, "matE"),
        horas: lerLinhas(panel, "horas"),
        laborCost: $("#otMo"),
        partsCost: $("#otPc"),
        otherCost: $("#otOu"),
      };
      try {
        await apiRequest(`/fleet/workshop/${x.id}`, { method: "PATCH", body });
        close();
        toast(`${x.code} gravada.`);
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível guardar.", { type: "error" });
      }
    },
  });
}

// ─── Arranque ─────────────────────────────────────────────────────────────────

const VISTAS = { oficina: vistaCalendario, ordens: vistaOrdens, material: vistaMaterial, indicadores: vistaIndicadores };

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const foco = document.activeElement?.dataset?.q !== undefined ? document.activeElement.selectionStart : null;
  el.innerHTML = VISTAS[S.vista]();
  if (foco !== null) {
    const n = el.querySelector("[data-q]");
    n?.focus();
    n?.setSelectionRange(foco, foco);
  }
}

async function carregar() {
  try {
    S.d = await apiRequest("/fleet/workshop");
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

async function reagendar(id, dm) {
  const x = otById(id);
  if (!x || x._dia === dm) return;
  try {
    await apiRequest(`/fleet/workshop/${id}/reschedule`, { method: "POST", body: { dm } });
    toast(`${x.code} passa para ${fmtData(dm)}.`);
    carregar();
  } catch (e) {
    toast(e.message || "Não foi possível reagendar.", { type: "error" });
  }
}

export async function render(meta) {
  S.vista = meta?.vista || "oficina";
  S.dia = "";
  const acts = document.getElementById("financePageActions");
  if (acts && podeCriar()) {
    acts.innerHTML = `<button type="button" class="finance-btn" id="ofPedido">Pedido à Oficina</button> <button type="button" class="finance-btn finance-btn--primary" id="ofNovo">+ Novo Trabalho</button>`;
    document.getElementById("ofNovo").onclick = () => S.d && formNovo({ modo: "of" });
    document.getElementById("ofPedido").onclick = () => S.d && formNovo({ modo: "frota" });
  }
  const el = root();
  el.addEventListener("input", (e) => {
    if (e.target.dataset.q === undefined) return;
    S.q = e.target.value;
    desenhar();
  });
  el.addEventListener("click", (e) => {
    const t = e.target;
    const go = t.closest("[data-ofgo]");
    if (go) {
      const [k, v] = go.dataset.ofgo.split("|");
      if (k === "md") S.md = v;
      if (k === "nav") S.dia = v;
      if (k === "dia") {
        S.md = "dia";
        S.dia = v;
      }
      return desenhar();
    }
    const f = t.closest("[data-oft]");
    if (f) {
      S.f = f.dataset.oft;
      return desenhar();
    }
    const nv = t.closest("[data-ofnovo]");
    if (nv) return formNovo({ dia: nv.dataset.ofnovo, modo: "of" });
    const ot = t.closest("[data-ofot]");
    if (ot) {
      const x = otById(ot.dataset.ofot);
      if (x) fichaOT(x);
    }
  });
  // arrastar um cartão para outro dia reagenda (como no protótipo)
  el.addEventListener("dragstart", (e) => {
    const c = e.target.closest?.(".of-card[data-ofot]");
    if (!c || !podeEditar()) return;
    e.dataTransfer.setData("text/plain", c.dataset.ofot);
    e.dataTransfer.effectAllowed = "move";
  });
  el.addEventListener("dragover", (e) => {
    const d = e.target.closest?.("[data-ofdrop]");
    if (!d) return;
    e.preventDefault();
    d.classList.add("is-drop");
  });
  el.addEventListener("dragleave", (e) => e.target.closest?.("[data-ofdrop]")?.classList.remove("is-drop"));
  el.addEventListener("drop", (e) => {
    const d = e.target.closest?.("[data-ofdrop]");
    if (!d) return;
    e.preventDefault();
    d.classList.remove("is-drop");
    const id = e.dataTransfer.getData("text/plain");
    if (id) reagendar(id, d.dataset.ofdrop);
  });
  desenhar();
  await carregar();
  // «Oficina» na página da viatura: abre o pedido à oficina já com a viatura
  const pedido = new URLSearchParams(window.location.search).get("pedido");
  if (pedido && podeCriar()) formNovo({ modo: "frota", vehicleId: pedido });
  const id = new URLSearchParams(window.location.search).get("ot");
  if (id && otById(id)) fichaOT(otById(id));
}
