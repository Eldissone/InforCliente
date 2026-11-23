/**
 * T1 Contas e Saldos — o `V.ftes` do protótipo.
 *
 * O saldo disponível, os saldos por banco com as entradas e saídas do mês, o
 * fluxo dos últimos doze meses, as saídas do mês por tipo e quantos
 * movimentos estão por conciliar. As transferências internas não contam como
 * entradas nem saídas.
 */

import { apiRequest } from "../../services/api.js";
import { esc, fmt, fmtData, codigoNoCabecalho, moedaSeg, seg, kpis, vazio, erro } from "./f2Ui.js";
import { monthLabel } from "./fluxosCore.js";
import { MESES } from "./calendarioCore.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, p: "mes", mes: null, dia: "", ano: "", d1: "", d2: "", moeda: "AOA", erro: null };

const PERIODOS = [
  ["dia", "Dia"],
  ["mes", "Mês"],
  ["ano", "Ano"],
  ["12m", "12 Meses"],
  ["int", "Intervalo"],
];

const mesLongo = (k) => `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;

const barra = (v, mx, tom) =>
  `<span class="fx2-bar"><i class="fx2-bar--${tom}" style="width:${Math.min(100, (v / Math.max(1, mx)) * 100).toFixed(1)}%"></i></span>`;

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const d = S.d;
  const mx = Math.max(1, ...d.bancos.map((b) => Math.max(b.en, b.sa)));
  const mf = Math.max(1, ...d.meses.map((m) => Math.max(m.en, m.sa)));
  const mt = Math.max(1, ...d.tipos.map((t) => t.valor));
  const P = d.periodo || { rotulo: mesLongo(d.mes), de: `${d.mes}-01`, ate: `${d.mes}-28` };
  const hoje = d.hoje || P.ate;
  const anos = [...new Set([hoje.slice(0, 4), ...d.meses.map((m) => m.k.slice(0, 4))])].sort().reverse();
  const extra =
    S.p === "dia"
      ? `<input class="finance-input" type="date" data-t1f="dia" value="${esc(S.dia || hoje)}">`
      : S.p === "mes"
        ? `<input class="finance-input" type="month" data-t1f="mes" value="${esc(S.mes || d.mes)}">`
        : S.p === "ano"
          ? `<select class="finance-input" data-t1f="ano">${anos.map((y) => `<option${(S.ano || hoje.slice(0, 4)) === y ? " selected" : ""}>${y}</option>`).join("")}</select>`
          : S.p === "int"
            ? `<input class="finance-input" type="date" data-t1f="d1" value="${esc(S.d1 || P.de)}"><span class="fx2-mut">até</span><input class="finance-input" type="date" data-t1f="d2" value="${esc(S.d2 || P.ate)}">`
            : "";

  el.innerHTML = `
    <div class="fcal-filtros">
      ${seg("t1", "p", S.p, PERIODOS)} ${extra}
      ${moedaSeg("t1", d.moeda, d.moedas)}
    </div>
    ${kpis([
      {
        tom: "good",
        titulo: `Saldo Disponível (${d.moeda})`,
        valor: fmt(d.saldo),
        nota: `${d.contas} conta(s) e cartão(ões)${d.estimado ? " · há saldos estimados" : ""}`,
      },
      d.divida > 0.5 ? { tom: "bad", titulo: "Dívida de Cartões de Crédito", valor: fmt(d.divida), nota: "fora do saldo disponível" } : null,
      { tom: "neu", titulo: `Entradas · ${P.rotulo}`, valor: fmt(d.en), nota: "sem transferências internas" },
      { tom: "warn", titulo: `Saídas · ${P.rotulo}`, valor: fmt(d.sa), nota: `líquido ${fmt(d.en - d.sa)}` },
      {
        tom: d.porConciliar ? "bad" : "good",
        titulo: "Por Conciliar",
        valor: String(d.porConciliar),
        nota: "abrir os extratos ›",
        acao: "/Financeiro/tesouraria/extratos",
      },
    ])}

    <section class="fx2-blk">
      <h3>Saldo por Banco</h3>
      ${
        d.bancos.length
          ? `<div class="fx2-bancos">${d.bancos
              .map(
                (b) => `<div class="fx2-banco">
            <div class="fx2-banco-h"><b>${esc(b.banco)}</b><span class="fx2-mut">${b.contas.length} conta(s)</span></div>
            <div class="fx2-banco-s${b.saldo < 0 ? " fcal-out" : ""}">${fmt(b.saldo)}</div>
            ${b.divida > 0.5 ? `<div class="fcal-out fx2-mut">dívida cartão ${fmt(b.divida)}</div>` : ""}
            <div class="fx2-lin"><span>Entradas</span><b>${fmt(b.en)}</b></div>${barra(b.en, mx, "en")}
            <div class="fx2-lin"><span>Saídas</span><b>${fmt(b.sa)}</b></div>${barra(b.sa, mx, "sa")}
            <ul class="fx2-contas">${b.contas
              .map(
                (c) =>
                  `<li><span>${esc(c.nome)}${c.digitos ? ` ·${esc(c.digitos)}` : ""}</span><b>${fmt(c.saldo)}</b>${
                    c.estimado ? `<i title="Sem saldo registado: é o saldo do cartão">≈</i>` : `<i title="Saldo registado a ${fmtData(c.desde)}"></i>`
                  }</li>`
              )
              .join("")}</ul>
          </div>`
              )
              .join("")}</div>`
          : vazio(`Não há contas em ${d.moeda}.`)
      }
      <p class="fcal-nota">As contas e os cartões registam-se em <a href="/registos/cartoes">Contas e Cartões</a>. Sem saldo registado (extrato ou acerto), vale o saldo do cartão, marcado com ≈.</p>
    </section>

    <div class="fx2-cols">
      <section class="fx2-blk">
        <h3>Entradas e saídas · últimos 12 meses</h3>
        <div class="fx2-meses">${d.meses
          .map(
            (m) => `<div class="fx2-mes" title="${mesLongo(m.k)}: entradas ${fmt(m.en)} · saídas ${fmt(m.sa)}">
              <span class="fx2-mes-b"><i class="fx2-bar--en" style="height:${((m.en / mf) * 100).toFixed(1)}%"></i><i class="fx2-bar--sa" style="height:${((m.sa / mf) * 100).toFixed(1)}%"></i></span>
              <span class="fx2-mes-l${m.k === d.mes ? " on" : ""}">${monthLabel(m.k)}</span>
            </div>`
          )
          .join("")}</div>
      </section>
      <section class="fx2-blk">
        <h3>Para Onde Foi o Dinheiro · ${esc(P.rotulo)}</h3>
        ${
          d.tipos.length
            ? d.tipos.map((t) => `<div class="fx2-lin"><span>${esc(t.tipo)}</span><b>${fmt(t.valor)}</b></div>${barra(t.valor, mt, "sa")}`).join("")
            : `<p class="fx2-mut">Sem saídas neste período.</p>`
        }
      </section>
    </div>`;
}

async function carregar() {
  S.erro = null;
  const q = new URLSearchParams({ moeda: S.moeda, p: S.p });
  if (S.p === "mes" && S.mes) q.set("mes", S.mes);
  if (S.p === "dia" && S.dia) q.set("d", S.dia);
  if (S.p === "ano" && S.ano) q.set("ano", S.ano);
  if (S.p === "int") {
    if (S.d1) q.set("d1", S.d1);
    if (S.d2) q.set("d2", S.d2);
  }
  try {
    S.d = await apiRequest(`/finance/treasury/summary?${q}`);
    if (S.p === "mes") S.mes = S.d.mes;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render() {
  codigoNoCabecalho("T1");
  const el = root();
  el.addEventListener("change", (e) => {
    const k = e.target.dataset.t1f;
    if (!k) return;
    S[k] = e.target.value;
    carregar();
  });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-t1]");
    if (!b) return;
    const [k, v] = b.dataset.t1.split("|");
    S[k] = v;
    carregar();
  });
  desenhar();
  await carregar();
}
