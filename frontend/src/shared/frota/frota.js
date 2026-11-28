/**
 * Área Frota — o `NAV_FROTA` do protótipo (V1–V13), num só módulo:
 * cada página escolhe a vista (`meta.vista`) e todas leem `GET /fleet/bootstrap`.
 *
 *   painel  V1 Painel da Frota        alertas  V2 Alertas
 *   viaturas V3 Viaturas e Equipamentos  motoristas V4 Motoristas
 *   abastecimentos V5 · manutencoes V6 · planos V7 · ocorrencias V8
 *   documentos V9 · seguros V10 · custos V13 Custos por Viatura
 *
 * Permissões: `frota:view` para ver; `frota:create` / `frota:edit` / `frota:delete`
 * mostram os botões (o backend volta a verificar).
 */

import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmt0, fmtData, kpis, vazio, erro } from "../finance/f2Ui.js";
import { norm, select, pesquisa, chip } from "../compras/ui.js";

const root = () => document.getElementById("financeRoot");
const S = { vista: "painel", d: null, ov: null, custos: null, erro: null, q: "", v: "", e: "", de: "", ate: "", so: "" };

const pode = (a) => can("frota", a);
const pill = (txt, tom) => `<span class="fcal-pill fcal-pill--${tom === "neu" ? "slate" : tom}">${esc(txt)}</span>`;
const TOM_ESTADO = { Operacional: "good", "Em obra": "good", "Em manutenção": "warn", Avariada: "bad", Acidentada: "bad", Parada: "warn", "Em reserva": "slate", Vendida: "slate", Abatida: "slate" };
const TOM_GRAV = { Baixa: "slate", Média: "warn", Alta: "bad", Crítica: "bad" };
const FECHADA = ["Resolvida", "Arquivada"];
const un = (v) => (v?.unit === "HORAS" ? "h" : "km");
const num = (x) => (x === null || x === undefined || x === "" ? "—" : fmt0(x));

const vById = (id) => S.d?.viaturas.find((v) => v.id === id);
const mById = (id) => S.d?.motoristas.find((m) => m.id === id);
const vLbl = (v) => (v ? [v.plate, [v.brand, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "—");
const vMat = (id) => vById(id)?.plate || "—";
const obraLbl = (id) => {
  const o = S.d?.obras.find((x) => x.id === id);
  return o ? [o.code, o.name].filter(Boolean).join(" · ") : "";
};
const ativa = (v) => v.active !== false && !["Vendida", "Abatida"].includes(v.status);

// ─── Formulários ──────────────────────────────────────────────────────────────

const optsViaturas = (cur) => [["", "— escolher viatura —"], ...S.d.viaturas.filter((v) => ativa(v) || v.id === cur).map((v) => [v.id, vLbl(v)])];
const optsMotoristas = (cur) => [["", "— sem motorista —"], ...S.d.motoristas.filter((m) => m.status !== "Inativo" || m.id === cur).map((m) => [m.id, m.name])];
const optsObras = () => [["", "— sem obra —"], ...S.d.obras.map((o) => [o.id, [o.code, o.name].filter(Boolean).join(" · ")])];
const lista = (a) => a.map((x) => (Array.isArray(x) ? x : [x, x]));

/** Campo: { k, l, t: text|number|date|select|textarea|check|multi, opts, req, full, ph } */
function campoHtml(f, o) {
  const id = `ff_${f.k}`;
  const val = o[f.k] === null || o[f.k] === undefined ? "" : o[f.k];
  const lab = `<label class="finance-label" for="${id}">${esc(f.l)}${f.req ? " *" : ""}</label>`;
  let input;
  if (f.t === "select") {
    input = `<select id="${id}" class="finance-input">${f.opts.map(([v, l]) => `<option value="${esc(v)}"${String(val) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  } else if (f.t === "textarea") {
    input = `<textarea id="${id}" class="finance-input" rows="2">${esc(val)}</textarea>`;
  } else if (f.t === "check") {
    input = `<label class="fx2-mut" style="display:flex;gap:.4rem;align-items:center"><input id="${id}" type="checkbox"${val === true ? " checked" : ""}> ${esc(f.ph || "Sim")}</label>`;
  } else if (f.t === "multi") {
    const sel = new Set(Array.isArray(val) ? val : []);
    input = `<div id="${id}" class="fr-multi">${f.opts.length ? f.opts.map(([v, l]) => `<label><input type="checkbox" value="${esc(v)}"${sel.has(v) ? " checked" : ""}> ${esc(l)}</label>`).join("") : `<span class="fx2-mut">${esc(f.vazio || "Sem opções.")}</span>`}</div>`;
  } else {
    const step = f.t === "number" ? ' step="any" min="0"' : "";
    input = `<input id="${id}" class="finance-input" type="${f.t || "text"}"${step} value="${esc(val)}"${f.ph ? ` placeholder="${esc(f.ph)}"` : ""}>`;
  }
  return `<div class="finance-field${f.full ? " finance-field--full" : ""}">${lab}${input}${f.hint ? `<small class="fx2-mut">${esc(f.hint)}</small>` : ""}</div>`;
}

function lerCampos(panel, campos) {
  const body = {};
  for (const f of campos) {
    const el = panel.querySelector(`#ff_${f.k}`);
    if (!el) continue;
    if (f.t === "check") body[f.k] = el.checked;
    else if (f.t === "multi") body[f.k] = [...el.querySelectorAll("input:checked")].map((i) => i.value);
    else body[f.k] = el.value.trim();
  }
  return body;
}

/** Abre o formulário de um registo. `col` é a colecção da API (vehicles, fuel…). */
function formRegisto({ col, titulo, campos, o = {}, extraHtml = "", onRender, prepararCorpo, depois }) {
  const novo = !o.id;
  const podeGravar = novo ? pode("create") : pode("edit");
  openModal({
    title: titulo,
    width: 760,
    primaryLabel: podeGravar ? "Guardar" : "",
    secondaryLabel: podeGravar ? "Cancelar" : "Fechar",
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">${campos.map((f) => campoHtml(f, o)).join("")}</div>${extraHtml}
      ${!novo && pode("delete") ? `<div style="margin-top:1rem"><button type="button" class="finance-btn" data-fr-apagar>Apagar</button></div>` : ""}`,
    onRender: ({ panel, close }) => {
      if (!podeGravar) panel.querySelectorAll("input, select, textarea").forEach((el) => (el.disabled = true));
      panel.querySelector("[data-fr-apagar]")?.addEventListener("click", async () => {
        if (!confirm("Apagar este registo? Não se pode desfazer.")) return;
        try {
          await apiRequest(`/fleet/${col}/${o.id}`, { method: "DELETE" });
          close();
          toast("Registo apagado.");
          carregar();
        } catch (e) {
          toast(e.message || "Não foi possível apagar.", { type: "error" });
        }
      });
      onRender?.({ panel });
    },
    onPrimary: async ({ panel, close }) => {
      let body = lerCampos(panel, campos);
      if (prepararCorpo) body = prepararCorpo(body, panel);
      const falta = campos.filter((f) => f.req && (body[f.k] === "" || body[f.k] === undefined || (Array.isArray(body[f.k]) && !body[f.k].length))).map((f) => f.l);
      if (falta.length) return toast(`Falta preencher: ${falta.join(", ")}.`, { type: "error" });
      try {
        const r = await apiRequest(novo ? `/fleet/${col}` : `/fleet/${col}/${o.id}`, { method: novo ? "POST" : "PATCH", body });
        close();
        toast(novo ? `Registo ${r.code || ""} criado.` : "Alterações gravadas.");
        await depois?.(r);
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível guardar.", { type: "error" });
      }
    },
  });
}

const L = () => S.d.listas;

function formViatura(o = { unit: "KM", ownership: "PROPRIA", status: "Operacional", active: true, maintenancePlans: [] }) {
  const campos = [
    { k: "kind", l: "Tipo", req: 1, ph: "LIGEIRA, PESADA, MÁQUINA, TRAILER…" },
    { k: "plate", l: "Matrícula", req: 1, ph: "LD-12-34-AB" },
    { k: "brand", l: "Marca", req: 1 },
    { k: "model", l: "Modelo", req: 1 },
    { k: "year", l: "Ano", t: "number" },
    { k: "unit", l: "Unidade de utilização", t: "select", opts: L().unidades },
    { k: "fuel", l: "Combustível", t: "select", opts: lista(["", ...L().combustiveis]) },
    { k: "odometer", l: "Km / horas atuais", t: "number" },
    { k: "tankCapacity", l: "Capacidade do depósito (L)", t: "number" },
    { k: "refConsumption", l: "Consumo de referência", t: "number", hint: "L/100 km (ou L/h nas máquinas)" },
    { k: "acquisitionValue", l: "Valor de aquisição (Kz)", t: "number" },
    { k: "ownership", l: "Propriedade", t: "select", opts: L().propriedades },
    { k: "assignedTo", l: "Atribuída a", ph: "SEDE, OBRA, DIRECÇÃO…" },
    { k: "projectId", l: "Obra", t: "select", opts: optsObras() },
    { k: "driverId", l: "Motorista / responsável", t: "select", opts: optsMotoristas(o.driverId) },
    { k: "status", l: "Estado", t: "select", opts: lista(L().estadosViatura) },
    { k: "notes", l: "Observações", t: "textarea", full: 1 },
  ];
  const planos = (o.maintenancePlans || []).slice();
  const linhaPlano = (p = {}) => `<tr data-plano="${esc(p.id || "")}">
      <td><input class="finance-input" data-p="nome" value="${esc(p.nome || "")}" placeholder="REVISÃO"></td>
      <td><input class="finance-input" data-p="km" type="number" min="0" value="${esc(p.km ?? "")}" placeholder="10000"></td>
      <td><input class="finance-input" data-p="meses" type="number" min="0" value="${esc(p.meses ?? "")}" placeholder="12"></td>
      <td><input class="finance-input" data-p="ultKm" type="number" min="0" value="${esc(p.ultKm ?? "")}"></td>
      <td><input class="finance-input" data-p="ultData" type="date" value="${esc(p.ultData || "")}"></td>
      <td><button type="button" class="finance-btn" data-p-rm title="Remover">✕</button></td></tr>`;
  const extraHtml = `<section class="fx2-blk" style="margin-top:1rem"><h3>Planos preventivos</h3>
      <p class="fx2-mut" style="margin:0 0 .5rem">Ex.: revisão a cada 10 000 km ou 12 meses. A intervenção que cumpre o plano atualiza a última execução.</p>
      <div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Plano</th><th>Cada (${esc(un(o))})</th><th>Cada (meses)</th><th>Última (${esc(un(o))})</th><th>Última (data)</th><th></th></tr></thead>
      <tbody data-planos>${planos.map(linhaPlano).join("")}</tbody></table></div>
      <button type="button" class="finance-btn" data-p-add style="margin-top:.5rem">+ Plano</button></section>`;
  formRegisto({
    col: "vehicles",
    titulo: o.id ? `${o.code} · ${vLbl(o)}` : "Nova viatura / equipamento",
    campos,
    o,
    extraHtml,
    onRender: ({ panel }) => {
      const tb = panel.querySelector("[data-planos]");
      panel.querySelector("[data-p-add]").addEventListener("click", () => tb.insertAdjacentHTML("beforeend", linhaPlano()));
      tb.addEventListener("click", (e) => e.target.closest("[data-p-rm]")?.closest("tr").remove());
    },
    prepararCorpo: (body, panel) => {
      body.maintenancePlans = [...panel.querySelectorAll("[data-plano]")].map((tr) => {
        const g = (k) => tr.querySelector(`[data-p="${k}"]`).value.trim();
        return { id: tr.dataset.plano || undefined, nome: g("nome"), km: g("km"), meses: g("meses"), ultKm: g("ultKm"), ultData: g("ultData") };
      });
      return body;
    },
  });
}

function formMotorista(o = { status: "Ativo", licenseCategory: "B" }) {
  formRegisto({
    col: "drivers",
    titulo: o.id ? `${o.code} · ${o.name}` : "Novo motorista",
    o,
    campos: [
      { k: "name", l: "Nome", req: 1, full: 1 },
      { k: "licenseNumber", l: "N.º da carta" },
      { k: "licenseCategory", l: "Categoria", t: "select", opts: lista(L().categoriasCarta) },
      { k: "licenseExpiry", l: "Validade da carta", t: "date" },
      { k: "phone", l: "Telefone" },
      { k: "department", l: "Departamento" },
      { k: "projectId", l: "Obra", t: "select", opts: optsObras() },
      { k: "status", l: "Estado", t: "select", opts: lista(["Ativo", "Inativo"]) },
      { k: "notes", l: "Observações", t: "textarea", full: 1 },
    ],
  });
}

function formAbastecimento(o) {
  o = o || { date: S.d.hoje, vehicleId: S.v || "", fuelType: "Gasóleo", fullTank: true, paymentMethod: "Cartão de Combustível" };
  const v = vById(o.vehicleId);
  formRegisto({
    col: "fuel",
    titulo: o.id ? `${o.code} · ${vMat(o.vehicleId)}` : "Novo abastecimento",
    o,
    campos: [
      { k: "date", l: "Data", t: "date", req: 1 },
      { k: "vehicleId", l: "Viatura", t: "select", req: 1, opts: optsViaturas(o.vehicleId) },
      { k: "driverId", l: "Motorista", t: "select", opts: optsMotoristas(o.driverId) },
      { k: "odometer", l: "Km / horas no abastecimento", t: "number", hint: v?.odometer ? `Último registo da viatura: ${fmt0(v.odometer)} ${un(v)}` : "" },
      { k: "liters", l: "Litros", t: "number", req: 1 },
      { k: "pricePerLiter", l: "Preço por litro (Kz)", t: "number" },
      { k: "amount", l: "Valor (Kz)", t: "number", hint: "Vazio: litros × preço por litro" },
      { k: "fuelType", l: "Combustível", t: "select", opts: lista(L().combustiveis) },
      { k: "fullTank", l: "Depósito cheio", t: "check" },
      { k: "station", l: "Posto" },
      { k: "paymentMethod", l: "Pagamento", t: "select", opts: lista(L().pagamentos) },
      { k: "receipt", l: "N.º do recibo" },
      { k: "projectId", l: "Obra", t: "select", opts: optsObras() },
      { k: "justification", l: "Justificação de anomalia", hint: "Ex.: conta-quilómetros substituído" },
      { k: "notes", l: "Observações", t: "textarea", full: 1 },
    ],
  });
}

function formIntervencao(o) {
  o = o || { date: S.d.hoje, entryDate: S.d.hoje, vehicleId: S.v || "", type: "Manutenção Preventiva", status: "Concluída", planIds: [] };
  const v = vById(o.vehicleId);
  const planosOpts = (veh) => (veh?.maintenancePlans || []).map((p) => [p.id, p.nome]);
  const campos = [
    { k: "date", l: "Data", t: "date", req: 1 },
    { k: "vehicleId", l: "Viatura", t: "select", req: 1, opts: optsViaturas(o.vehicleId) },
    { k: "odometer", l: "Km / horas", t: "number" },
    { k: "type", l: "Tipo", t: "select", req: 1, opts: lista(L().tiposIntervencao) },
    { k: "system", l: "Sistema", t: "select", opts: lista(["", ...L().sistemas]) },
    { k: "status", l: "Estado", t: "select", opts: lista(["Em curso", "Concluída"]) },
    { k: "description", l: "Descrição", req: 1, full: 1 },
    { k: "workshop", l: "Oficina" },
    { k: "technician", l: "Técnico" },
    { k: "entryDate", l: "Entrada", t: "date" },
    { k: "exitDate", l: "Saída", t: "date" },
    { k: "laborCost", l: "Mão de obra (Kz)", t: "number" },
    { k: "partsCost", l: "Peças (Kz)", t: "number" },
    { k: "otherCost", l: "Outros (Kz)", t: "number" },
    { k: "warranty", l: "Garantia" },
    { k: "nextAction", l: "Próxima acção" },
    { k: "nextDate", l: "Próxima data", t: "date" },
    { k: "planIds", l: "Planos preventivos cumpridos", t: "multi", full: 1, opts: planosOpts(v), vazio: "Escolha a viatura (e grave-a com planos) para os ver aqui." },
    { k: "notes", l: "Observações", t: "textarea", full: 1 },
  ];
  formRegisto({
    col: "interventions",
    titulo: o.id ? `${o.code} · ${vMat(o.vehicleId)}` : "Nova manutenção / reparação",
    o,
    campos,
    onRender: ({ panel }) => {
      const sel = panel.querySelector("#ff_vehicleId");
      sel.addEventListener("change", () => {
        const box = panel.querySelector("#ff_planIds");
        const ops = planosOpts(vById(sel.value));
        box.innerHTML = ops.length ? ops.map(([id, l]) => `<label><input type="checkbox" value="${esc(id)}"> ${esc(l)}</label>`).join("") : `<span class="fx2-mut">Esta viatura não tem planos preventivos.</span>`;
      });
    },
  });
}

function formOcorrencia(o) {
  o = o || { date: S.d.hoje, vehicleId: S.v || "", type: "Avaria", severity: "Média", status: "Aberta" };
  formRegisto({
    col: "incidents",
    titulo: o.id ? `${o.code} · ${vMat(o.vehicleId)}` : "Nova ocorrência",
    o,
    campos: [
      { k: "date", l: "Data", t: "date", req: 1 },
      { k: "vehicleId", l: "Viatura", t: "select", req: 1, opts: optsViaturas(o.vehicleId) },
      { k: "driverId", l: "Motorista", t: "select", opts: optsMotoristas(o.driverId) },
      { k: "type", l: "Tipo", t: "select", req: 1, opts: lista(L().tiposOcorrencia) },
      { k: "severity", l: "Gravidade", t: "select", opts: lista(L().gravidades) },
      { k: "status", l: "Estado", t: "select", opts: lista(L().estadosOcorrencia) },
      { k: "location", l: "Local" },
      { k: "deadline", l: "Prazo", t: "date" },
      { k: "description", l: "Descrição", req: 1, full: 1 },
      { k: "action", l: "Acção tomada / a tomar", full: 1 },
      { k: "responsible", l: "Responsável" },
      { k: "closedAt", l: "Data de fecho", t: "date" },
      { k: "estimatedCost", l: "Custo estimado (Kz)", t: "number" },
      { k: "cost", l: "Custo real (Kz)", t: "number" },
      { k: "insuranceClaim", l: "Participado ao seguro", t: "check" },
      { k: "injuries", l: "Houve feridos", t: "check" },
      { k: "notes", l: "Observações", t: "textarea", full: 1 },
    ],
  });
}

function formDocumento(o) {
  o = o || { vehicleId: S.v || "", type: "Inspecção Periódica", situation: "Em vigor" };
  formRegisto({
    col: "documents",
    titulo: o.id ? `${o.type} · ${vMat(o.vehicleId)}` : "Novo documento",
    o,
    campos: [
      { k: "vehicleId", l: "Viatura", t: "select", req: 1, opts: optsViaturas(o.vehicleId) },
      { k: "type", l: "Tipo", t: "select", req: 1, opts: lista(L().tiposDocumento) },
      { k: "number", l: "Número" },
      { k: "entity", l: "Entidade emissora" },
      { k: "issueDate", l: "Emissão", t: "date" },
      { k: "expiryDate", l: "Validade", t: "date" },
      { k: "cost", l: "Custo (Kz)", t: "number" },
      { k: "situation", l: "Situação", t: "select", opts: lista(L().situacoesDocumento) },
      { k: "notes", l: "Observações", t: "textarea", full: 1 },
    ],
  });
}

function formSeguro(o) {
  const hoje = S.d.hoje;
  const fim = new Date(`${hoje}T00:00:00Z`);
  fim.setUTCFullYear(fim.getUTCFullYear() + 1);
  o = o || { startDate: hoje, endDate: fim.toISOString().slice(0, 10), periodicity: "ANUAL", coverages: ["Responsabilidade Civil"], vehicleIds: S.v ? [S.v] : [] };
  formRegisto({
    col: "insurances",
    titulo: o.id ? `${o.code} · ${o.insurer} · ${o.policyNumber}` : "Nova apólice",
    o,
    campos: [
      { k: "insurer", l: "Seguradora", req: 1 },
      { k: "policyNumber", l: "N.º da apólice", req: 1 },
      { k: "startDate", l: "Início", t: "date", req: 1 },
      { k: "endDate", l: "Fim / renovação", t: "date", req: 1 },
      { k: "premium", l: "Prémio total (Kz)", t: "number" },
      { k: "periodicity", l: "Periodicidade do pagamento", t: "select", opts: lista(L().periodicidades) },
      { k: "coverages", l: "Coberturas", t: "multi", full: 1, opts: lista(L().coberturas) },
      { k: "vehicleIds", l: "Viaturas cobertas", t: "multi", req: 1, full: 1, opts: S.d.viaturas.filter((v) => ativa(v) || (o.vehicleIds || []).includes(v.id)).map((v) => [v.id, vLbl(v)]), vazio: "Ainda não há viaturas registadas." },
      { k: "notes", l: "Observações", t: "textarea", full: 1 },
    ],
  });
}

// ─── Vistas ───────────────────────────────────────────────────────────────────

const filtroViatura = () => select("v", S.v, S.d.viaturas.map((v) => [v.id, vLbl(v)]), "Todas as viaturas");
const filtroDatas = () =>
  `<label class="fx2-mut">De <input type="date" class="cs-sel" data-f="de" value="${esc(S.de)}"></label><label class="fx2-mut">Até <input type="date" class="cs-sel" data-f="ate" value="${esc(S.ate)}"></label>`;
const noPeriodo = (d) => (!S.de || String(d || "") >= S.de) && (!S.ate || String(d || "").slice(0, 10) <= S.ate);
const filtroQ = (txt) => {
  const q = norm(S.q).trim();
  return !q || norm(txt).includes(q);
};

function tabela(cab, linhas, vazioTxt, rodape = "") {
  if (!linhas.length) return vazio(vazioTxt);
  return `<div class="fx2-tw"><table class="fx2-t"><thead><tr>${cab.map((c) => (Array.isArray(c) ? `<th class="${c[1]}">${esc(c[0])}</th>` : `<th>${esc(c)}</th>`)).join("")}</tr></thead><tbody>${linhas.join("")}</tbody>${rodape}</table></div>`;
}

const linha = (attr, id, cels) => `<tr data-${attr}="${esc(id)}" style="cursor:pointer" title="Abrir">${cels.join("")}</tr>`;

function vistaPainel() {
  const P = S.ov?.painel;
  if (!P) return vazio("A carregar…");
  const mx = Math.max(1, ...P.meses.map((m) => m.valor));
  const mesAtual = S.d.hoje.slice(0, 7);
  const tp = Math.max(1, ...P.topViaturas.map((t) => t.valor));
  const tc = Math.max(1, ...P.porCategoria.map((t) => t.valor));
  const estados = Object.entries(P.porEstado);
  return `
    ${kpis([
      { tom: "blue", titulo: "Viaturas Ativas", valor: String(P.ativas), nota: estados.map(([e, c]) => `${c} ${e.toLowerCase()}`).join(" · ") || "—", acao: "/frota/viaturas" },
      { tom: P.alertas.altas ? "bad" : P.alertas.total ? "warn" : "good", titulo: "Alertas", valor: String(P.alertas.total), nota: `${P.alertas.altas} de prioridade alta`, acao: "/frota/alertas" },
      { tom: "neu", titulo: "Custo do Mês", valor: fmt(P.custoMes), nota: "Kz" },
      { tom: "neu", titulo: `Custo de ${P.ano}`, valor: fmt(P.custoAno), nota: `${fmt0(P.litrosAno)} L de combustível`, acao: "/frota/custos" },
      { tom: P.ocorrenciasAbertas ? "warn" : "good", titulo: "Ocorrências Abertas", valor: String(P.ocorrenciasAbertas), nota: "por resolver", acao: "/frota/ocorrencias" },
    ])}
    <div class="fx2-cols">
      <section class="fx2-blk"><h3>Custos por mês · ${esc(P.ano)}</h3>
        <div class="fx2-meses">${P.meses
          .map((m) => `<div class="fx2-mes" title="${esc(m.mes)}: ${fmt(m.valor)}"><span class="fx2-mes-b"><i class="fx2-bar--sa" style="width:60%;height:${((m.valor / mx) * 100).toFixed(1)}%"></i></span><span class="fx2-mes-l${m.mes === mesAtual ? " on" : ""}">${m.mes.slice(5)}</span></div>`)
          .join("")}</div>
      </section>
      <section class="fx2-blk"><h3>Por categoria · ${esc(P.ano)}</h3>
        ${P.porCategoria.length ? P.porCategoria.map((c) => `<div class="fx2-lin"><span>${esc(c.categoria)}</span><b>${fmt(c.valor)}</b></div><span class="fx2-bar"><i class="fx2-bar--sa" style="width:${((c.valor / tc) * 100).toFixed(1)}%"></i></span>`).join("") : `<p class="fx2-mut">Sem custos este ano.</p>`}
      </section>
      <section class="fx2-blk"><h3>Viaturas que mais custam · ${esc(P.ano)}</h3>
        ${P.topViaturas.length ? P.topViaturas.map((t) => `<div class="fx2-lin"><a href="/frota/custos?viatura=${esc(t.vid)}"><b>${esc(t.matricula)}</b> <span class="fx2-mut">${esc(t.nome)}</span></a><b>${fmt(t.valor)}</b></div><span class="fx2-bar"><i class="fx2-bar--sa" style="width:${((t.valor / tp) * 100).toFixed(1)}%"></i></span>`).join("") : `<p class="fx2-mut">Sem custos este ano.</p>`}
      </section>
      <section class="fx2-blk"><h3>Alertas prioritários</h3>
        ${P.alertas.primeiros.length ? P.alertas.primeiros.map(alertaLinha).join("") + `<p style="margin:.5rem 0 0"><a class="fcal-todos" href="/frota/alertas">Ver todos os alertas →</a></p>` : `<p class="fx2-mut">Sem alertas. A frota está em dia.</p>`}
      </section>
    </div>`;
}

const PRIOR = { 1: ["Alta", "bad"], 2: ["Média", "warn"], 3: ["Informativo", "slate"] };
const alertaLinha = (a) =>
  `<div class="fx2-lin"><span>${pill(PRIOR[a.p][0], PRIOR[a.p][1])} <b>${esc(a.matricula || "—")}</b> ${esc(a.problema)} <span class="fx2-mut">· ${esc(a.detalhe)}</span></span><a href="${esc(a.link)}">abrir</a></div>`;

function vistaAlertas() {
  const A = S.ov?.alertas;
  if (!A) return vazio("A carregar…");
  const areas = [...new Set(A.map((a) => a.area))];
  const Lx = A.filter((a) => (!S.e || String(a.p) === S.e) && (!S.so || a.area === S.so) && (!S.v || a.vid === S.v) && filtroQ([a.matricula, a.area, a.problema, a.detalhe].join(" ")));
  const n = (p) => A.filter((a) => a.p === p).length;
  return `
    <div class="fx2-chips">${chip("e", "", S.e, "Todos", A.length)}${chip("e", "1", S.e, "Alta", n(1))}${chip("e", "2", S.e, "Média", n(2))}${chip("e", "3", S.e, "Informativo", n(3))}</div>
    <div class="fcal-filtros">${pesquisa(S, "matrícula, problema…")}${filtroViatura()}${select("so", S.so, areas.map((a) => [a, a]), "Todas as áreas")}</div>
    ${tabela(
      ["Prioridade", "Viatura", "Área", "Problema", "Detalhe", ""],
      Lx.map((a) => `<tr><td>${pill(PRIOR[a.p][0], PRIOR[a.p][1])}</td><td><b>${esc(a.matricula || "—")}</b></td><td class="fx2-mut">${esc(a.area)}</td><td>${esc(a.problema)}</td><td class="fx2-mut">${esc(a.detalhe)}</td><td><a href="${esc(a.link)}">abrir →</a></td></tr>`),
      A.length ? "Nenhum alerta com estes filtros." : "Sem alertas. A frota está em dia."
    )}`;
}

function vistaViaturas() {
  const A = S.d.viaturas;
  const Lx = A.filter((v) => (S.so === "inativas" ? !ativa(v) : ativa(v)) && (!S.e || v.status === S.e) && filtroQ([v.code, v.plate, v.brand, v.model, v.kind, v.assignedTo, mById(v.driverId)?.name].join(" ")));
  const semSeg = A.filter((v) => ativa(v) && v._seguro?.[1] === "bad");
  const manut = A.filter((v) => ativa(v) && v._planos?.k === "bad");
  return `
    ${kpis([
      { tom: "blue", titulo: "Ativas", valor: String(A.filter(ativa).length), nota: `${A.length} registadas` },
      { tom: manut.length ? "bad" : "good", titulo: "Manutenção Ultrapassada", valor: String(manut.length), nota: manut.map((v) => v.plate).slice(0, 4).join(", ") || "nenhuma", acao: "/frota/planos" },
      { tom: semSeg.length ? "bad" : "good", titulo: "Sem Seguro Válido", valor: String(semSeg.length), nota: semSeg.map((v) => v.plate).slice(0, 4).join(", ") || "todas cobertas", acao: "/frota/seguros" },
    ])}
    <div class="fcal-filtros">${pesquisa(S, "matrícula, marca, modelo, tipo, motorista…")}${select("e", S.e, lista(L().estadosViatura), "Todos os estados")}${select("so", S.so, [["inativas", "Inativas (vendidas / abatidas)"]], "Ativas")}<span class="fx2-mut">${Lx.length} de ${A.length}</span></div>
    ${tabela(
      ["Código", "Matrícula", "Marca / modelo", "Tipo", ["Km / h", "r"], "Atribuída a", "Motorista", "Estado", "Manutenção", "Seguro"],
      Lx.map((v) =>
        linha("frv", v.id, [
          `<td class="fx2-mut">${esc(v.code)}</td>`,
          `<td><b>${esc(v.plate)}</b></td>`,
          `<td>${esc([v.brand, v.model].join(" "))}${v.year ? ` <span class="fx2-mut">(${esc(v.year)})</span>` : ""}</td>`,
          `<td class="fx2-mut">${esc(v.kind)}</td>`,
          `<td class="r">${v.odometer === null ? "—" : `${fmt0(v.odometer)} ${un(v)}`}${v.odometerAt ? `<div class="fx2-mut">${fmtData(v.odometerAt)}</div>` : ""}</td>`,
          `<td class="fx2-mut">${esc(v.assignedTo || "")}${v.projectId ? `<div>${esc(obraLbl(v.projectId))}</div>` : ""}</td>`,
          `<td class="fx2-mut">${esc(mById(v.driverId)?.name || "—")}</td>`,
          `<td>${pill(v.status, TOM_ESTADO[v.status] || "slate")}</td>`,
          `<td>${pill(v._planos?.t || "—", v._planos?.k || "neu")}</td>`,
          `<td>${pill(v._seguro?.[0] || "—", v._seguro?.[1] || "neu")}</td>`,
        ])
      ),
      A.length ? "Nenhuma viatura com estes filtros." : "Ainda não há viaturas. Registe a primeira em «+ Nova Viatura»."
    )}`;
}

function vistaMotoristas() {
  const A = S.d.motoristas;
  const Lx = A.filter((m) => (!S.e || m.status === S.e) && filtroQ([m.code, m.name, m.licenseNumber, m.phone, m.department].join(" ")));
  const viatDe = (mid) => S.d.viaturas.filter((v) => v.driverId === mid).map((v) => v.plate).join(", ");
  const cad = A.filter((m) => m.status !== "Inativo" && m._carta?.[1] !== "good" && m._carta?.[1] !== "neu");
  return `
    ${kpis([
      { tom: "blue", titulo: "Motoristas Ativos", valor: String(A.filter((m) => m.status !== "Inativo").length), nota: `${A.length} registados` },
      { tom: cad.length ? "warn" : "good", titulo: "Cartas a Rever", valor: String(cad.length), nota: "caducadas ou a caducar (60 dias)" },
    ])}
    <div class="fcal-filtros">${pesquisa(S, "nome, carta, telefone…")}${select("e", S.e, lista(["Ativo", "Inativo"]), "Todos")}</div>
    ${tabela(
      ["Código", "Nome", "Carta", "Categoria", "Validade", "Telefone", "Viaturas", "Estado"],
      Lx.map((m) =>
        linha("frm", m.id, [
          `<td class="fx2-mut">${esc(m.code)}</td>`,
          `<td><b>${esc(m.name)}</b>${m.department ? `<div class="fx2-mut">${esc(m.department)}</div>` : ""}</td>`,
          `<td class="fx2-mut">${esc(m.licenseNumber || "—")}</td>`,
          `<td>${esc(m.licenseCategory || "—")}</td>`,
          `<td>${m.licenseExpiry ? fmtData(m.licenseExpiry) : "—"} ${pill(m._carta[0], m._carta[1])}</td>`,
          `<td class="fx2-mut">${esc(m.phone || "")}</td>`,
          `<td class="fx2-mut">${esc(viatDe(m.id) || "—")}</td>`,
          `<td>${pill(m.status, m.status === "Ativo" ? "good" : "slate")}</td>`,
        ])
      ),
      A.length ? "Nenhum motorista com estes filtros." : "Ainda não há motoristas registados."
    )}`;
}

function vistaAbastecimentos() {
  const A = S.d.abastecimentos;
  const Lx = A.filter((a) => (!S.v || a.vehicleId === S.v) && noPeriodo(a.date) && (!S.e || (S.e === "an" ? a._calc?.an?.length : true)) && filtroQ([a.code, vMat(a.vehicleId), a.station, a.receipt, mById(a.driverId)?.name].join(" ")));
  const lt = Lx.reduce((s, a) => s + Number(a.liters || 0), 0);
  const vt = Lx.reduce((s, a) => s + Number(a.amount || 0), 0);
  const nAn = A.filter((a) => a._calc?.an?.length).length;
  return `
    ${kpis([
      { tom: "blue", titulo: "Abastecimentos", valor: String(Lx.length), nota: "com os filtros" },
      { tom: "neu", titulo: "Litros", valor: fmt0(lt), nota: Lx.length ? `${fmt(vt / Math.max(lt, 1))} Kz/L em média` : "—" },
      { tom: "neu", titulo: "Valor", valor: fmt(vt), nota: "Kz" },
      { tom: nAn ? "warn" : "good", titulo: "Com Anomalias", valor: String(nAn), nota: "km, consumo ou depósito" },
    ])}
    <div class="fcal-filtros">${pesquisa(S, "código, matrícula, posto, recibo…")}${filtroViatura()}${filtroDatas()}${select("e", S.e, [["an", "Só com anomalias"]], "Todos")}</div>
    ${tabela(
      ["Código", "Data", "Viatura", "Motorista", ["Km", "r"], ["Litros", "r"], ["Valor (Kz)", "r"], ["Consumo", "r"], "Posto", "Pagamento", ""],
      Lx.map((a) => {
        const c = a._calc || {};
        return linha("frab", a.id, [
          `<td class="fx2-mut">${esc(a.code)}</td>`,
          `<td>${fmtData(a.date)}</td>`,
          `<td><b>${esc(vMat(a.vehicleId))}</b></td>`,
          `<td class="fx2-mut">${esc(mById(a.driverId)?.name || "—")}</td>`,
          `<td class="r">${num(a.odometer)}${c.perc ? `<div class="fx2-mut">+${fmt0(c.perc)}</div>` : ""}</td>`,
          `<td class="r">${fmt(a.liters)}</td>`,
          `<td class="r">${fmt(a.amount)}</td>`,
          `<td class="r">${c.cons ? `${c.cons.toFixed(1)} L/100` : "—"}</td>`,
          `<td class="fx2-mut">${esc(a.station || "")}</td>`,
          `<td class="fx2-mut">${esc(a.paymentMethod || "")}</td>`,
          `<td>${(c.an || []).map(([t, txt]) => pill(t === "bad" && a.justification ? "justificado" : "!", t === "bad" && a.justification ? "slate" : t)).join(" ")}<span class="fx2-mut" style="display:block;max-width:16rem">${esc((c.an || []).map((x) => x[1]).join(" · "))}</span></td>`,
        ]);
      }),
      A.length ? "Nenhum abastecimento com estes filtros." : "Ainda não há abastecimentos registados.",
      Lx.length ? `<tfoot><tr><td colspan="5">Total (${Lx.length})</td><td class="r">${fmt(lt)}</td><td class="r">${fmt(vt)}</td><td colspan="4"></td></tr></tfoot>` : ""
    )}`;
}

function vistaManutencoes() {
  const A = S.d.intervencoes;
  const Lx = A.filter((i) => (!S.v || i.vehicleId === S.v) && noPeriodo(i.date) && (!S.e || i.status === S.e) && (!S.so || i.type === S.so) && filtroQ([i.code, vMat(i.vehicleId), i.description, i.workshop, i.system].join(" ")));
  const tot = Lx.reduce((s, i) => s + i._total, 0);
  const emCurso = A.filter((i) => i.status === "Em curso").length;
  return `
    ${kpis([
      { tom: "blue", titulo: "Intervenções", valor: String(Lx.length), nota: "com os filtros" },
      { tom: emCurso ? "warn" : "good", titulo: "Em Curso", valor: String(emCurso), nota: "viaturas na oficina" },
      { tom: "neu", titulo: "Custo", valor: fmt(tot), nota: "mão de obra + peças + outros" },
    ])}
    <div class="fcal-filtros">${pesquisa(S, "código, matrícula, descrição, oficina…")}${filtroViatura()}${select("so", S.so, lista(L().tiposIntervencao), "Todos os tipos")}${select("e", S.e, lista(["Em curso", "Concluída"]), "Todos os estados")}${filtroDatas()}</div>
    ${tabela(
      ["Código", "Data", "Viatura", "Tipo", "Descrição", "Oficina", ["Km", "r"], ["Custo (Kz)", "r"], "Estado"],
      Lx.map((i) =>
        linha("frint", i.id, [
          `<td class="fx2-mut">${esc(i.code)}</td>`,
          `<td>${fmtData(i.date)}</td>`,
          `<td><b>${esc(vMat(i.vehicleId))}</b></td>`,
          `<td class="fx2-mut">${esc(i.type)}${i.system ? `<div>${esc(i.system)}</div>` : ""}</td>`,
          `<td>${esc(i.description)}${i.planIds?.length ? ` ${pill("plano preventivo", "blue")}` : ""}</td>`,
          `<td class="fx2-mut">${esc(i.workshop || "")}</td>`,
          `<td class="r">${num(i.odometer)}</td>`,
          `<td class="r">${fmt(i._total)}</td>`,
          `<td>${pill(i.status, i.status === "Concluída" ? "good" : "warn")}</td>`,
        ])
      ),
      A.length ? "Nenhuma intervenção com estes filtros." : "Ainda não há manutenções nem reparações registadas.",
      Lx.length ? `<tfoot><tr><td colspan="7">Total (${Lx.length})</td><td class="r">${fmt(tot)}</td><td></td></tr></tfoot>` : ""
    )}`;
}

function vistaPlanos() {
  const linhas = [];
  S.d.viaturas.filter(ativa).forEach((v) => (v._planosDet || []).forEach((p) => linhas.push({ v, p })));
  const ordem = { bad: 0, warn: 1, good: 2, neu: 3 };
  const Lx = linhas.filter(({ v, p }) => (!S.v || v.id === S.v) && (!S.e || p.k === S.e) && filtroQ([v.plate, v.brand, v.model, p.nome].join(" "))).sort((a, b) => ordem[a.p.k] - ordem[b.p.k] || a.v.plate.localeCompare(b.v.plate));
  const n = (k) => linhas.filter((x) => x.p.k === k).length;
  const semPlano = S.d.viaturas.filter((v) => ativa(v) && !(v.maintenancePlans || []).length);
  return `
    <div class="fx2-chips">${chip("e", "", S.e, "Todos", linhas.length)}${chip("e", "bad", S.e, "Ultrapassados", n("bad"))}${chip("e", "warn", S.e, "Próximos", n("warn"))}${chip("e", "good", S.e, "Em dia", n("good"))}</div>
    <div class="fcal-filtros">${pesquisa(S, "matrícula, plano…")}${filtroViatura()}</div>
    ${tabela(
      ["Viatura", "Plano", "Intervalo", "Última execução", "Próxima", "Situação", ""],
      Lx.map(({ v, p }) => `<tr><td><b>${esc(v.plate)}</b> <span class="fx2-mut">${esc([v.brand, v.model].join(" "))}</span><div class="fx2-mut">atual: ${num(v.odometer)} ${un(v)}</div></td>
        <td><b>${esc(p.nome)}</b></td>
        <td class="fx2-mut">${[p.km ? `${fmt0(p.km)} ${un(v)}` : "", p.meses ? `${p.meses} meses` : ""].filter(Boolean).join(" ou ") || "—"}</td>
        <td class="fx2-mut">${[p.ultKm !== null && p.ultKm !== undefined ? `${fmt0(p.ultKm)} ${un(v)}` : "", p.ultData ? fmtData(p.ultData) : ""].filter(Boolean).join(" · ") || "—"}</td>
        <td>${[p.proxKm !== null && p.proxKm !== undefined ? `${fmt0(p.proxKm)} ${un(v)}` : "", p.proxData ? fmtData(p.proxData) : ""].filter(Boolean).join(" · ") || "—"}</td>
        <td>${pill(p.t, p.k)}</td>
        <td>${pode("create") ? `<button type="button" class="finance-btn" data-frplan="${esc(v.id)}|${esc(p.id)}">Registar execução</button>` : ""}</td></tr>`),
      linhas.length ? "Nenhum plano com estes filtros." : "Nenhuma viatura tem planos preventivos. Defina-os na ficha da viatura."
    )}
    ${semPlano.length ? `<p class="fcal-nota">Sem plano preventivo: ${semPlano.map((v) => `<a href="#" data-frv="${esc(v.id)}"><b>${esc(v.plate)}</b></a>`).join(", ")}.</p>` : ""}`;
}

function vistaOcorrencias() {
  const A = S.d.ocorrencias;
  const Lx = A.filter((o) => (!S.v || o.vehicleId === S.v) && noPeriodo(o.date) && (!S.e || (S.e === "abertas" ? !FECHADA.includes(o.status) : o.status === S.e)) && (!S.so || o.severity === S.so) && filtroQ([o.code, vMat(o.vehicleId), o.type, o.description, o.location].join(" ")));
  const ab = A.filter((o) => !FECHADA.includes(o.status));
  const crit = ab.filter((o) => ["Alta", "Crítica"].includes(o.severity)).length;
  return `
    ${kpis([
      { tom: ab.length ? "warn" : "good", titulo: "Em Aberto", valor: String(ab.length), nota: `${crit} alta(s) / crítica(s)` },
      { tom: "neu", titulo: "Custo Real", valor: fmt(Lx.reduce((s, o) => s + Number(o.cost || 0), 0)), nota: "com os filtros" },
      { tom: "neu", titulo: "Custo Estimado em Aberto", valor: fmt(ab.reduce((s, o) => s + Number(o.estimatedCost || 0), 0)), nota: "Kz" },
    ])}
    <div class="fcal-filtros">${pesquisa(S, "código, matrícula, tipo, descrição…")}${filtroViatura()}${select("e", S.e, [["abertas", "Só em aberto"], ...lista(L().estadosOcorrencia)], "Todos os estados")}${select("so", S.so, lista(L().gravidades), "Todas as gravidades")}${filtroDatas()}</div>
    ${tabela(
      ["Código", "Data", "Viatura", "Motorista", "Tipo", "Gravidade", "Descrição", "Prazo", ["Custo (Kz)", "r"], "Estado"],
      Lx.map((o) =>
        linha("frocr", o.id, [
          `<td class="fx2-mut">${esc(o.code)}</td>`,
          `<td>${fmtData(o.date)}</td>`,
          `<td><b>${esc(vMat(o.vehicleId))}</b></td>`,
          `<td class="fx2-mut">${esc(mById(o.driverId)?.name || "—")}</td>`,
          `<td>${esc(o.type)}</td>`,
          `<td>${pill(o.severity, TOM_GRAV[o.severity] || "slate")}</td>`,
          `<td>${esc(o.description)}${o.insuranceClaim ? ` ${pill("seguro", "blue")}` : ""}</td>`,
          `<td>${o.deadline ? fmtData(o.deadline) : "—"}</td>`,
          `<td class="r">${o.cost !== null ? fmt(o.cost) : o.estimatedCost !== null ? `<span class="fx2-mut">≈ ${fmt(o.estimatedCost)}</span>` : "—"}</td>`,
          `<td>${pill(o.status, FECHADA.includes(o.status) ? "good" : "warn")}</td>`,
        ])
      ),
      A.length ? "Nenhuma ocorrência com estes filtros." : "Ainda não há ocorrências registadas."
    )}`;
}

function vistaDocumentos() {
  const A = S.d.documentos;
  const Lx = A.filter((d) => (!S.v || d.vehicleId === S.v) && (!S.so || d.type === S.so) && (!S.e || d._estado[1] === S.e) && filtroQ([vMat(d.vehicleId), d.type, d.number, d.entity].join(" ")));
  const n = (k) => A.filter((d) => d._estado[1] === k).length;
  // quadro: viaturas × documentos obrigatórios
  const obr = L().documentosObrigatorios;
  const quadro = S.d.viaturas.filter(ativa).filter((v) => !S.v || v.id === S.v).map((v) => {
    const cel = obr.map((t) => {
      const d = A.filter((x) => x.vehicleId === v.id && x.type === t && x.situation !== "Arquivado").sort((a, b) => String(b.expiryDate || b.issueDate || "").localeCompare(String(a.expiryDate || a.issueDate || "")))[0];
      return `<td>${d ? pill(d.expiryDate ? fmtData(d.expiryDate) : d._estado[0], d._estado[1]) : pill("em falta", "bad")}</td>`;
    });
    return `<tr><td><b>${esc(v.plate)}</b> <span class="fx2-mut">${esc([v.brand, v.model].join(" "))}</span></td>${cel.join("")}</tr>`;
  });
  return `
    <div class="fx2-chips">${chip("e", "", S.e, "Todos", A.length)}${chip("e", "good", S.e, "Válidos", n("good"))}${chip("e", "warn", S.e, "A caducar", n("warn"))}${chip("e", "bad", S.e, "Caducados", n("bad"))}</div>
    ${quadro.length ? `<section class="fx2-blk"><h3>Documentos obrigatórios por viatura</h3>${tabela(["Viatura", ...obr], quadro, "")}</section>` : ""}
    <div class="fcal-filtros">${pesquisa(S, "matrícula, tipo, número, entidade…")}${filtroViatura()}${select("so", S.so, lista(L().tiposDocumento), "Todos os tipos")}</div>
    ${tabela(
      ["Viatura", "Tipo", "Número", "Entidade", "Emissão", "Validade", ["Custo (Kz)", "r"], "Estado"],
      Lx.map((d) =>
        linha("frdoc", d.id, [
          `<td><b>${esc(vMat(d.vehicleId))}</b></td>`,
          `<td>${esc(d.type)}</td>`,
          `<td class="fx2-mut">${esc(d.number || "")}</td>`,
          `<td class="fx2-mut">${esc(d.entity || "")}</td>`,
          `<td>${d.issueDate ? fmtData(d.issueDate) : "—"}</td>`,
          `<td>${d.expiryDate ? fmtData(d.expiryDate) : "—"}</td>`,
          `<td class="r">${d.cost !== null ? fmt(d.cost) : "—"}</td>`,
          `<td>${pill(d._estado[0], d._estado[1])}</td>`,
        ])
      ),
      A.length ? "Nenhum documento com estes filtros." : "Ainda não há documentos registados."
    )}`;
}

function vistaSeguros() {
  const A = S.d.seguros;
  const Lx = A.filter((s) => (!S.e || s._estado[1] === S.e) && (!S.v || (s.vehicleIds || []).includes(S.v)) && filtroQ([s.code, s.insurer, s.policyNumber, (s.vehicleIds || []).map(vMat).join(" "), (s.coverages || []).join(" ")].join(" ")));
  const n = (k) => A.filter((s) => s._estado[1] === k).length;
  const semS = S.d.viaturas.filter((v) => ativa(v) && v._seguro?.[1] === "bad");
  return `
    ${semS.length ? `<div class="fx2-blk" style="border-color:#f3b8b1;background:#fdecea">Sem seguro válido: ${semS.map((v) => `<b>${esc(v.plate)}</b>`).join(", ")}.</div>` : ""}
    <div class="fx2-chips">${chip("e", "", S.e, "Todas", A.length)}${chip("e", "good", S.e, "Válidas", n("good"))}${chip("e", "warn", S.e, "A expirar", n("warn"))}${chip("e", "bad", S.e, "Expiradas", n("bad"))}</div>
    <div class="fcal-filtros">${pesquisa(S, "apólice, seguradora, matrícula…")}${filtroViatura()}</div>
    ${tabela(
      ["Apólice", "Seguradora", "Viaturas", "Coberturas", "Início", "Fim", ["Prémio (Kz)", "r"], "Pagamento", "Estado"],
      Lx.map((s) =>
        linha("frseg", s.id, [
          `<td><b>${esc(s.policyNumber)}</b><div class="fx2-mut">${esc(s.code)}</div></td>`,
          `<td>${esc(s.insurer)}</td>`,
          `<td class="fx2-mut">${esc((s.vehicleIds || []).map(vMat).join(", ") || "—")}</td>`,
          `<td class="fx2-mut">${esc((s.coverages || []).join(", ") || "—")}</td>`,
          `<td>${fmtData(s.startDate)}</td>`,
          `<td>${fmtData(s.endDate)}</td>`,
          `<td class="r">${s.premium !== null ? fmt(s.premium) : "—"}</td>`,
          `<td class="fx2-mut">${esc(s.periodicity || "")}</td>`,
          `<td>${pill(s._estado[0], s._estado[1])}</td>`,
        ])
      ),
      A.length ? "Nenhuma apólice com estes filtros." : "Ainda não há apólices registadas."
    )}`;
}

function vistaCustos() {
  const C = S.custos;
  if (!C) return vazio("A carregar…");
  const cats = C.categorias;
  const per = [["Tudo", "", ""], ["Este ano", `${S.d.hoje.slice(0, 4)}-01-01`, S.d.hoje], ["Este mês", `${S.d.hoje.slice(0, 7)}-01`, S.d.hoje]];
  const perHtml = `<span class="finance-seg">${per.map(([l, a, b]) => `<button type="button" class="${S.de === a && S.ate === b ? "active" : ""}" data-frper="${a}|${b}">${esc(l)}</button>`).join("")}</span>`;
  const filtros = `<div class="fcal-filtros">${filtroViatura()}${perHtml}${filtroDatas()}</div>`;
  if (C.viatura) {
    const V = C.viatura;
    const ORIG = { abastecimento: "Abastecimento", intervencao: "Intervenção", ocorrencia: "Ocorrência", documento: "Documento" };
    return `${filtros}
      ${kpis([
        { tom: "blue", titulo: `Total · ${V.matricula}`, valor: fmt(V.total), nota: V.nome },
        { tom: "neu", titulo: "Percurso no período", valor: V.percurso ? fmt0(V.percurso) : "—", nota: "pelas leituras de km / horas" },
        { tom: "neu", titulo: "Custo por km / h", valor: V.custoPorKm ? fmt(V.custoPorKm) : "—", nota: "Kz" },
        ...V.porCategoria.filter((c) => c.valor > 0).map((c) => ({ tom: "neu", titulo: c.categoria, valor: fmt(c.valor), nota: V.total ? `${((c.valor / V.total) * 100).toFixed(0)}%` : "" })),
      ])}
      ${tabela(["Data", "Categoria", "Origem", "Referência", "Descrição", ["Valor (Kz)", "r"]],
        V.linhas.map((x) => `<tr><td>${fmtData(x.d)}</td><td>${esc(x.cat)}</td><td class="fx2-mut">${esc(ORIG[x.origem] || x.origem)}</td><td class="fx2-mut">${esc(x.ref || "")}</td><td>${esc(x.desc || "")}</td><td class="r">${fmt(x.v)}</td></tr>`),
        "Sem custos registados para esta viatura no período.",
        V.linhas.length ? `<tfoot><tr><td colspan="5">Total (${V.linhas.length})</td><td class="r">${fmt(V.total)}</td></tr></tfoot>` : "")}`;
  }
  const R = C.resumo.filter((r) => r.total > 0 || r.ativa);
  const tot = R.reduce((s, r) => s + r.total, 0);
  const porCat = Object.fromEntries(cats.map((c) => [c, R.reduce((s, r) => s + (r.cat[c] || 0), 0)]));
  return `${filtros}
    ${kpis([{ tom: "blue", titulo: "Custo da Frota", valor: fmt(tot), nota: `${R.filter((r) => r.total > 0).length} viatura(s) com custos` }, ...cats.filter((c) => porCat[c] > 0).map((c) => ({ tom: "neu", titulo: c, valor: fmt(porCat[c]), nota: tot ? `${((porCat[c] / tot) * 100).toFixed(0)}%` : "" }))])}
    ${tabela(["Viatura", ...cats.map((c) => [c, "r"]), ["Total", "r"]],
      R.map((r) => `<tr data-frcus="${esc(r.vid)}" style="cursor:pointer" title="Ver o detalhe"><td><b>${esc(r.matricula)}</b> <span class="fx2-mut">${esc(r.nome)}</span></td>${cats.map((c) => `<td class="r">${r.cat[c] ? fmt(r.cat[c]) : "—"}</td>`).join("")}<td class="r"><b>${fmt(r.total)}</b></td></tr>`),
      "Ainda não há viaturas registadas.",
      R.length ? `<tfoot><tr><td>Total</td>${cats.map((c) => `<td class="r">${fmt(porCat[c])}</td>`).join("")}<td class="r">${fmt(tot)}</td></tr></tfoot>` : "")}
    <p class="fcal-nota">Os custos saem dos registos da frota: abastecimentos, intervenções (mão de obra + peças + outros), custo real das ocorrências e custo dos documentos. Clique numa viatura para ver as linhas.</p>`;
}

const VISTAS = {
  painel: vistaPainel,
  alertas: vistaAlertas,
  viaturas: vistaViaturas,
  motoristas: vistaMotoristas,
  abastecimentos: vistaAbastecimentos,
  manutencoes: vistaManutencoes,
  planos: vistaPlanos,
  ocorrencias: vistaOcorrencias,
  documentos: vistaDocumentos,
  seguros: vistaSeguros,
  custos: vistaCustos,
};

/** Botão «+ Novo» de cada vista (só com `frota:create`). */
const NOVO = {
  viaturas: ["+ Nova Viatura", () => formViatura()],
  motoristas: ["+ Novo Motorista", () => formMotorista()],
  abastecimentos: ["+ Abastecimento", () => formAbastecimento()],
  manutencoes: ["+ Manutenção / Reparação", () => formIntervencao()],
  planos: ["+ Manutenção", () => formIntervencao()],
  ocorrencias: ["+ Ocorrência", () => formOcorrencia()],
  documentos: ["+ Documento", () => formDocumento()],
  seguros: ["+ Nova Apólice", () => formSeguro()],
  painel: ["+ Abastecimento", () => formAbastecimento()],
};

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));
  const ativo = document.activeElement;
  const foco = ativo?.dataset?.q !== undefined ? ativo.selectionStart : null;
  el.innerHTML = VISTAS[S.vista]();
  if (foco !== null) {
    const n = el.querySelector("[data-q]");
    n?.focus();
    n?.setSelectionRange(foco, foco);
  }
}

async function carregarCustos() {
  const p = new URLSearchParams();
  if (S.de) p.set("de", S.de);
  if (S.ate) p.set("ate", S.ate);
  if (S.v) p.set("viatura", S.v);
  S.custos = await apiRequest(`/fleet/costs?${p}`);
}

async function carregar() {
  try {
    const precisaOv = S.vista === "painel" || S.vista === "alertas";
    const [d, ov] = await Promise.all([apiRequest("/fleet/bootstrap"), precisaOv ? apiRequest("/fleet/overview") : null]);
    S.d = d;
    if (ov) S.ov = ov;
    if (S.vista === "custos") await carregarCustos();
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
  abrirPorUrl();
}

let abertoPorUrl = false;
function abrirPorUrl() {
  if (abertoPorUrl || !S.d) return;
  abertoPorUrl = true;
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) return;
  const v = vById(id);
  if (S.vista === "viaturas" && v) formViatura(v);
}

export async function render(meta) {
  S.vista = meta?.vista || "painel";
  const qs = new URLSearchParams(window.location.search);
  S.v = qs.get("viatura") || "";

  const acts = document.getElementById("financePageActions");
  const novo = NOVO[S.vista];
  if (acts && novo && pode("create")) {
    acts.innerHTML = `<button type="button" class="finance-btn finance-btn--primary" id="frNovo">${esc(novo[0])}</button>`;
    document.getElementById("frNovo").onclick = () => S.d && novo[1]();
  }

  const el = root();
  el.addEventListener("input", (e) => {
    if (e.target.dataset.q === undefined) return;
    S.q = e.target.value;
    desenhar();
  });
  el.addEventListener("change", async (e) => {
    const k = e.target.dataset.f;
    if (!k) return;
    S[k] = e.target.value;
    if (S.vista === "custos") {
      S.custos = null;
      desenhar();
      try {
        await carregarCustos();
      } catch (er) {
        S.erro = er.message;
      }
    }
    desenhar();
  });
  el.addEventListener("click", async (e) => {
    const t = e.target;
    const c = t.closest("[data-chip]");
    if (c) {
      const [k, v] = c.dataset.chip.split("|");
      S[k] = v;
      return desenhar();
    }
    const per = t.closest("[data-frper]");
    if (per) {
      [S.de, S.ate] = per.dataset.frper.split("|");
      S.custos = null;
      desenhar();
      await carregarCustos();
      return desenhar();
    }
    const cus = t.closest("[data-frcus]");
    if (cus) {
      S.v = cus.dataset.frcus;
      S.custos = null;
      desenhar();
      await carregarCustos();
      return desenhar();
    }
    const plan = t.closest("[data-frplan]");
    if (plan) {
      const [vid, pid] = plan.dataset.frplan.split("|");
      const v = vById(vid);
      return formIntervencao({ date: S.d.hoje, entryDate: S.d.hoje, vehicleId: vid, odometer: v?.odometer ?? "", type: "Manutenção Preventiva", status: "Concluída", planIds: [pid], description: (v?.maintenancePlans || []).find((p) => p.id === pid)?.nome || "" });
    }
    if (t.closest("a[href]") && !t.closest("[data-frv]")) return;
    const abrir = [
      ["frv", (id) => formViatura(vById(id))],
      ["frm", (id) => formMotorista(mById(id))],
      ["frab", (id) => formAbastecimento(S.d.abastecimentos.find((x) => x.id === id))],
      ["frint", (id) => formIntervencao(S.d.intervencoes.find((x) => x.id === id))],
      ["frocr", (id) => formOcorrencia(S.d.ocorrencias.find((x) => x.id === id))],
      ["frdoc", (id) => formDocumento(S.d.documentos.find((x) => x.id === id))],
      ["frseg", (id) => formSeguro(S.d.seguros.find((x) => x.id === id))],
    ];
    for (const [attr, fn] of abrir) {
      const row = t.closest(`[data-${attr}]`);
      if (row) {
        e.preventDefault();
        return fn(row.dataset[attr]);
      }
    }
  });

  desenhar();
  await carregar();
}
