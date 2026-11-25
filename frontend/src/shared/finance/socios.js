/**
 * E4 Distribuição aos Sócios — alinhado com `V.fsoc` do protótipo:
 * Sócios e Quotas, Resumo por Sócio (com Quota), Lucros a Distribuir,
 * Empréstimos a Sócios (com Ata), abas de filtro e Movimentos dos Sócios (extrato).
 */

import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmtData, codigoNoCabecalho, seg, kpis, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, erro: null, tab: "tudo" };
const podeEditar = () => can("financeiro", "edit");

function extratoMovimentos(d) {
  const M = [];
  for (const x of d.distribuicoes || []) {
    M.push({
      data: x.data,
      cat: "lucros",
      tipo: "Distribuição de Lucros",
      socio: (x.parts || []).map((p) => `${p.nome} (${p.pct}%)`).join(" · ") || "Sócios",
      descricao: `${x.descricao || "Distribuição aprovada"}${x.exercicio ? ` · Exercício ${x.exercicio}` : ""}`,
      valor: Number(x.total) || 0,
      delAttr: `data-e4del="${esc(x.id)}"`,
    });
  }
  for (const p of d.pagamentos || []) {
    M.push({
      data: p.data,
      cat: "lucros",
      tipo: p.tipo === "IAC" ? "Pagamento IAC (Estado)" : "Pagamento de Lucros",
      socio: p.socio,
      descricao: p.notas || "",
      valor: -(Number(p.valor) || 0),
      delAttr: `data-e4pdel="${esc(p.id)}"`,
    });
  }
  for (const e of d.emprestimos || []) {
    M.push({
      data: e.data,
      cat: "emp",
      tipo: "Empréstimo a Sócio",
      socio: e.socio,
      descricao: [e.ata ? `Ata ${e.ata}` : "", e.notas || ""].filter(Boolean).join(" · "),
      valor: Number(e.valor) || 0,
      delAttr: `data-e4ldel="${esc(e.id)}"`,
    });
  }
  return M.sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
}

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const d = S.d;
  const ed = podeEditar();
  const emp = d.emprestimos || [];
  const movs = extratoMovimentos(d).filter((m) => S.tab === "tudo" || m.cat === S.tab);

  const secSocios = `
    <h3 class="f0-h3">Resumo por Sócio</h3>
    ${
      d.socios.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Sócio</th><th class="r">Quota</th><th class="r">Lucro bruto</th><th class="r">IAC</th><th class="r">A receber</th><th class="r">Já recebido</th><th class="r">Por receber</th><th></th></tr></thead>
          <tbody>${d.socios
            .map(
              (s) => `<tr><td><b>${esc(s.socio)}</b></td>
                <td class="r">${s.quota !== null && s.quota !== undefined ? `${s.quota.toLocaleString("pt-PT")}%` : "—"}</td>
                <td class="r">${fmt(s.bruto)}</td>
                <td class="r">${fmt(s.iac)}${s.iac > 0 ? `<div class="fx2-mut">${s.iacPago >= s.iac - 0.5 ? "✓ pago" : `pago ${fmt(s.iacPago)}`}</div>` : ""}</td>
                <td class="r"><b>${fmt(s.liquido)}</b></td><td class="r">${fmt(s.pago)}</td>
                <td class="r${s.remanescente < -0.5 ? " f0-neg" : ""}"><b>${fmt(s.remanescente)}</b></td>
                <td>${ed ? `<button type="button" class="finance-btn finance-btn--sm" data-e4pag="${esc(s.socio)}">Registar pagamento</button>` : ""}</td></tr>`
            )
            .join("")}</tbody></table></div>`
        : vazio("Ainda não há sócios nem quotas configuradas. Use «👥 Sócios e Quotas».")
    }`;

  const secLucros = `
    <h3 class="f0-h3">Lucros a Distribuir</h3>
    ${
      d.distribuicoes.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Ano</th><th>Data</th><th class="r">Lucro a distribuir</th><th class="r">IAC %</th><th class="r">IAC</th><th class="r">Líquido aos sócios</th><th>Repartição</th><th>Estado</th><th></th></tr></thead>
          <tbody>${d.distribuicoes
            .map((x) => {
              const iacVal = (Number(x.total) * Number(x.iacPct ?? 10)) / 100;
              const liq = Number(x.total) - iacVal;
              return `<tr>
                <td><b>${esc(x.exercicio || String(x.data || "").slice(0, 4))}</b></td>
                <td>${fmtData(x.data)}</td>
                <td class="r"><b>${fmt(x.total)}</b></td>
                <td class="r">${(x.iacPct ?? 10).toLocaleString("pt-PT")}%</td>
                <td class="r">${fmt(iacVal)}</td>
                <td class="r">${fmt(liq)}</td>
                <td class="fx2-mut">${esc((x.parts || []).map((p) => `${p.nome} ${p.pct}%`).join(" · "))}</td>
                <td><span class="fcal-pill fcal-pill--${d.remanescente <= 0.5 && d.pago > 0 ? "good" : "blue"}">${d.remanescente <= 0.5 && d.pago > 0 ? "Liquidado" : "Aprovado"}</span></td>
                <td>${ed ? `<button type="button" class="finance-btn finance-btn--sm" data-e4del="${esc(x.id)}"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button>` : ""}</td>
              </tr>`;
            })
            .join("")}</tbody></table></div>`
        : vazio("Ainda não há distribuições registadas. Use «+ Lucro a Distribuir».")
    }`;

  const secEmprestimos = `
    <h3 class="f0-h3">Empréstimos a Sócios (com Ata)</h3>
    ${
      emp.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Data</th><th>Sócio</th><th>N.º / Data da Ata</th><th class="r">Valor</th><th class="r">Devolvido</th><th class="r">Por devolver</th><th>Notas</th><th></th></tr></thead>
          <tbody>${emp
            .map((e) => {
              const falta = Math.max(0, (Number(e.valor) || 0) - (Number(e.devolvido) || 0));
              return `<tr>
                <td>${fmtData(e.data)}</td>
                <td><b>${esc(e.socio)}</b></td>
                <td>${e.ata ? esc(e.ata) : '<span class="fcal-pill fcal-pill--warn">falta ata</span>'}</td>
                <td class="r">${fmt(e.valor)}</td>
                <td class="r">${fmt(e.devolvido || 0)}</td>
                <td class="r"><b>${fmt(falta)}</b></td>
                <td class="fx2-mut">${esc(e.notas || "")}</td>
                <td class="g1-acts">${
                  ed
                    ? `<button type="button" class="finance-btn finance-btn--sm" data-e4ldev="${esc(e.id)}">Devolução</button>
                       <button type="button" class="finance-btn finance-btn--sm" data-e4ldel="${esc(e.id)}"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button>`
                    : ""
                }</td>
              </tr>`;
            })
            .join("")}</tbody></table></div>`
        : vazio("Sem empréstimos a sócios. Use «+ Empréstimo a Sócio».")
    }`;

  const secExtrato = `
    <h3 class="f0-h3">Movimentos dos Sócios (extrato)</h3>
    ${
      movs.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Data</th><th>Tipo</th><th>Sócio(s)</th><th>Descrição</th><th class="r">Valor</th><th></th></tr></thead>
          <tbody>${movs
            .map(
              (m) => `<tr>
                <td>${fmtData(m.data)}</td>
                <td>${esc(m.tipo)}</td>
                <td><b>${esc(m.socio)}</b></td>
                <td class="fx2-mut">${esc(m.descricao)}</td>
                <td class="r${m.valor < 0 ? " fcal-in" : ""}">${fmt(Math.abs(m.valor))}</td>
                <td>${ed && m.delAttr ? `<button type="button" class="finance-btn finance-btn--sm" ${m.delAttr}><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button>` : ""}</td>
              </tr>`
            )
            .join("")}</tbody></table></div>`
        : vazio("Sem movimentos registados.")
    }`;

  el.innerHTML = `
    <p class="fx2-lead">Lucros distribuídos aos sócios (com retenção de IAC) e empréstimos concedidos a sócios (suportados por ata).</p>
    ${kpis([
      { tom: "neu", titulo: "Lucros Distribuídos (bruto)", valor: fmt(d.bruto), nota: `${d.distribuicoes.length} distribuição(ões)` },
      { tom: "warn", titulo: "IAC", valor: fmt(d.iac), nota: d.iac > 0 ? `pago ${fmt(d.iacPago)} · falta ${fmt(Math.max(0, d.iac - d.iacPago))}` : "sem IAC" },
      { tom: "good", titulo: "Já Pago aos Sócios", valor: fmt(d.pago), nota: `de ${fmt(d.bruto - d.iac)} líquidos` },
      { tom: d.remanescente > 0.5 ? "warn" : "neu", titulo: "Por Pagar aos Sócios", valor: fmt(Math.max(0, d.remanescente)), nota: d.remanescente > 0.5 ? "em aberto" : "nada em dívida" },
    ])}
    <div class="cp-filtros" style="margin-bottom:8px">
      ${seg("e4t", "tab", S.tab, [
        ["tudo", "Tudo"],
        ["lucros", "Distribuição de Lucros"],
        ["emp", "Empréstimos a Sócios"],
      ])}
    </div>
    ${S.tab === "tudo" ? secSocios + secLucros + secEmprestimos + secExtrato : S.tab === "lucros" ? secSocios + secLucros + secExtrato : secEmprestimos + secExtrato}`;
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

function gerirSociosQuotas() {
  const iniciais = S.d?.quotas?.length ? S.d.quotas : S.d?.socios?.length ? S.d.socios.map((s) => ({ nome: s.socio, quota: s.quota || 0 })) : [{ nome: "", quota: "" }, { nome: "", quota: "" }];
  const linha = (q, i) => `<div class="e4-parte" style="display:flex;gap:8px;margin-bottom:6px">
    <input class="finance-input" data-qn="${i}" placeholder="Nome do sócio" value="${esc(q.nome || "")}" style="flex:1">
    <input class="finance-input" data-qp="${i}" type="number" min="0" max="100" step="any" placeholder="Quota %" value="${esc(q.quota ?? "")}" style="width:120px">
  </div>`;
  openModal({
    title: "👥 Sócios e Quotas",
    primaryLabel: "Guardar quotas",
    width: 560,
    contentHtml: `<p class="fx2-mut">Defina os sócios da empresa e a respetiva quota (%). Estes valores preenchem automaticamente as novas distribuições de lucros.</p>
      <div id="sqRows">${iniciais.map(linha).join("")}</div>
      <button type="button" class="finance-btn finance-btn--sm" id="sqAdd">+ Adicionar sócio</button>
      <span id="sqSoma" class="fx2-mut" style="margin-left:10px"></span>`,
    onRender: ({ panel }) => {
      let n = iniciais.length;
      const calc = () => {
        const s = [...panel.querySelectorAll("[data-qp]")].reduce((a, i) => a + (Number(i.value) || 0), 0);
        panel.querySelector("#sqSoma").textContent = `Total: ${s.toLocaleString("pt-PT")}%`;
      };
      panel.querySelector("#sqAdd").onclick = () => {
        panel.querySelector("#sqRows").insertAdjacentHTML("beforeend", linha({ nome: "", quota: "" }, n++));
      };
      panel.addEventListener("input", calc);
      calc();
    },
    onPrimary: async ({ panel, close }) => {
      const quotas = [...panel.querySelectorAll("[data-qn]")]
        .map((inp) => ({ nome: inp.value.trim(), quota: Number(panel.querySelector(`[data-qp="${inp.dataset.qn}"]`).value) || 0 }))
        .filter((q) => q.nome);
      try {
        await apiRequest("/finance/partners/quotas", { method: "PUT", body: { quotas } });
        toast("Quotas guardadas.", { type: "success" });
        close();
        carregar();
      } catch (e) {
        toast(e.data?.message || e.message || "Não foi possível guardar.", { type: "error" });
      }
    },
  });
}

function novoEmprestimoSocio() {
  const hoje = new Date().toISOString().slice(0, 10);
  const nomes = (S.d?.socios || []).map((s) => s.socio);
  openModal({
    title: "+ Empréstimo a Sócio",
    primaryLabel: "Registar empréstimo",
    width: 560,
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field"><label class="finance-label">Sócio *</label>
        <input id="esS" class="finance-input" list="esList" placeholder="Nome do sócio">
        <datalist id="esList">${nomes.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
      </div>
      <div class="finance-field"><label class="finance-label">Data *</label><input id="esD" class="finance-input" type="date" value="${hoje}"></div>
      <div class="finance-field"><label class="finance-label">Valor (AOA) *</label><input id="esV" class="finance-input" type="number" min="0" step="any"></div>
      <div class="finance-field"><label class="finance-label">N.º / Data da Ata</label><input id="esA" class="finance-input" placeholder="ex.: Ata n.º 03/2026"></div>
      <div class="finance-field finance-field--full"><label class="finance-label">Observações</label><input id="esN" class="finance-input"></div>
    </div>`,
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id).value.trim();
      if ($("#esS").length < 2 || !(Number($("#esV")) > 0)) return toast("Indique o sócio e o valor.", { type: "error" });
      try {
        await apiRequest("/finance/partners/loans", {
          method: "POST",
          body: { socio: $("#esS"), data: $("#esD"), valor: Number($("#esV")), ata: $("#esA") || null, notas: $("#esN") || null },
        });
        toast("Empréstimo a sócio registado.", { type: "success" });
        close();
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível registar.", { type: "error" });
      }
    },
  });
}

function devolucaoEmprestimoSocio(emp) {
  openModal({
    title: `Devolução · ${emp.socio}`,
    primaryLabel: "Guardar",
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field"><label class="finance-label">Total já devolvido</label><input id="edV" class="finance-input" type="number" min="0" step="any" value="${emp.devolvido || 0}"></div>
      <div class="finance-field"><label class="finance-label">N.º / Data da Ata</label><input id="edA" class="finance-input" value="${esc(emp.ata || "")}"></div>
    </div>`,
    onPrimary: async ({ panel, close }) => {
      try {
        await apiRequest(`/finance/partners/loans/${emp.id}`, {
          method: "PATCH",
          body: { devolvido: Number(panel.querySelector("#edV").value) || 0, ata: panel.querySelector("#edA").value.trim() || null },
        });
        close();
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível guardar.", { type: "error" });
      }
    },
  });
}

function novaDistribuicao() {
  const hoje = new Date().toISOString().slice(0, 10);
  const quotas = S.d?.quotas?.length ? S.d.quotas : [{ nome: "", quota: "" }, { nome: "", quota: "" }];
  const linha = (q, i) => `<div class="e4-parte"><input class="finance-input" data-pn="${i}" placeholder="Sócio" value="${esc(q.nome || "")}"><input class="finance-input" data-pp="${i}" type="number" min="0" max="100" step="any" placeholder="%" value="${esc(q.quota ?? "")}"></div>`;
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
      <div class="finance-field finance-field--full"><label class="finance-label">Repartição (tem de somar 100%)</label><div id="dsP">${quotas.map(linha).join("")}</div>
        <button type="button" class="finance-btn finance-btn--sm" id="dsMais">+ sócio</button> <span id="dsSoma" class="fx2-mut"></span></div>
    </div>`,
    onRender: ({ panel }) => {
      let n = quotas.length;
      const soma = () => {
        const s = [...panel.querySelectorAll("[data-pp]")].reduce((a, i) => a + (Number(i.value) || 0), 0);
        panel.querySelector("#dsSoma").textContent = `soma ${s.toLocaleString("pt-PT")}%`;
      };
      panel.querySelector("#dsMais").addEventListener("click", () => {
        panel.querySelector("#dsP").insertAdjacentHTML("beforeend", linha({ nome: "", quota: "" }, n++));
      });
      panel.addEventListener("input", soma);
      soma();
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
    acts.innerHTML = `<button type="button" class="finance-btn" id="e4Quotas">👥 Sócios e Quotas</button> <button type="button" class="finance-btn" id="e4Emp">+ Empréstimo a Sócio</button> <button type="button" class="finance-btn finance-btn--primary" id="e4Nova">+ Lucro a Distribuir</button>`;
    document.getElementById("e4Quotas").onclick = () => S.d && gerirSociosQuotas();
    document.getElementById("e4Emp").onclick = () => S.d && novoEmprestimoSocio();
    document.getElementById("e4Nova").onclick = () => S.d && novaDistribuicao();
  }
  root().addEventListener("click", async (e) => {
    const t = e.target;
    const tb = t.closest("[data-e4t]");
    if (tb) {
      const [k, v] = tb.dataset.e4t.split("|");
      S[k] = v;
      return desenhar();
    }
    const pg = t.closest("[data-e4pag]");
    if (pg) return pagamento(pg.dataset.e4pag);
    const ldev = t.closest("[data-e4ldev]");
    if (ldev) return devolucaoEmprestimoSocio((S.d.emprestimos || []).find((x) => x.id === ldev.dataset.e4ldev));
    const del = t.closest("[data-e4del], [data-e4pdel], [data-e4ldel]");
    if (del && confirm("Apagar este registo? Não se pode desfazer.")) {
      const url = del.dataset.e4del
        ? `/finance/partners/distributions/${del.dataset.e4del}`
        : del.dataset.e4pdel
        ? `/finance/partners/payments/${del.dataset.e4pdel}`
        : `/finance/partners/loans/${del.dataset.e4ldel}`;
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
