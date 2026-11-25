/**
 * T5 Contas Bancárias / Cartões — o `V.fcban` e o `FXDRAW.conta` do protótipo:
 *  - lista com filtros (Pesquisar, Banco, Tipo com contagens, Estado Ativas/Inativas/Todas, ✕ Limpar),
 *  - tabela de 7 colunas (Conta / Cartão, Banco, Tipo, Responsável, Saldo, Último mov., Por conciliar) + rodapé Total,
 *  - clicar numa linha abre a edição da conta/cartão (`CONTA`),
 *  - botão «+ Nova Conta / Cartão» abre o formulário completo (`NOVA CONTA`),
 *  - auto-deteção de banco pelo IBAN, secção dinâmica de Cartão de Crédito,
 *    secção de Alocação atual («+ Nova alocação deste cartão» e «Ver histórico») e botão «Eliminar».
 */

import { apiRequest } from "../../services/api.js";
import { can } from "../permissions.js";
import { openModal, toast } from "../ui.js";
import { esc, fmt, fmtData, codigoNoCabecalho, seg, vazio, erro } from "./f2Ui.js";

const root = () => document.getElementById("financeRoot");
const S = { d: null, obras: [], customBanks: [], erro: null, q: "", b: "", t: "", e: "A" };
const podeEditar = () => can("financeiro", "edit");

export const BANCOS_REG = [
  { s: "BCGA", n: "Banco Caixa Geral Angola" },
  { s: "BFA", n: "Banco de Fomento Angola" },
  { s: "BPC", n: "Banco de Poupança e Crédito" },
  { s: "BAI", n: "Banco Angolano de Investimentos" },
  { s: "BIC", n: "Banco BIC" },
  { s: "BMA", n: "Banco Millennium Atlântico" },
  { s: "SOL", n: "Banco Sol" },
  { s: "KEVE", n: "Banco Keve" },
  { s: "BNI", n: "Banco de Negócios Internacional" },
  { s: "SBA", n: "Standard Bank Angola" },
  { s: "BE", n: "Banco Económico" },
  { s: "YETU", n: "Banco Yetu" },
  { s: "ACCESS", n: "Access Bank Angola" },
  { s: "BCA", n: "Banco Comercial Angolano" },
  { s: "BCI", n: "Banco de Comércio e Indústria" },
  { s: "VTB", n: "VTB África" },
  { s: "BVB", n: "Banco Valor" },
  { s: "BCS", n: "Banco de Crédito do Sul" },
];

export const IBAN_BANK_MAP = {
  "0004": "BCGA",
  "0006": "BFA",
  "0010": "BPC",
  "0040": "BAI",
  "0051": "BIC",
  "0055": "BMA",
  "0044": "SOL",
  "0047": "KEVE",
  "0052": "BNI",
  "0060": "SBA",
  "0045": "BE",
};

export function bancoSig(v) {
  if (!v) return "";
  const s = String(v).trim();
  const u = s.toUpperCase();
  const bySig = BANCOS_REG.find((b) => b.s === u);
  if (bySig) return bySig.s;
  const byName = BANCOS_REG.find((b) => b.n.toLowerCase() === s.toLowerCase());
  if (byName) return byName.s;
  const dash = s.split(/\s*[—\-]\s*/)[0].trim().toUpperCase();
  const byPrefix = BANCOS_REG.find((b) => b.s === dash);
  if (byPrefix) return byPrefix.s;
  return s;
}

export function bancoNome(sig) {
  const s = bancoSig(sig);
  const b = BANCOS_REG.find((x) => x.s === s);
  return b ? b.n : sig || "";
}

export function bancoLbl(v) {
  if (!v) return "";
  const s = bancoSig(v);
  const b = BANCOS_REG.find((x) => x.s === s);
  return b ? `${b.s} — ${b.n}` : String(v).trim();
}

export function bancoOpts(sel = "", extraBanks = []) {
  const cur = bancoSig(sel);
  const seen = new Set(BANCOS_REG.map((b) => b.s));
  const list = [...BANCOS_REG];
  for (const eb of extraBanks) {
    const s = bancoSig(eb);
    if (s && !seen.has(s)) {
      seen.add(s);
      list.push({ s, n: "" });
    }
  }
  if (cur && !seen.has(cur)) {
    list.unshift({ s: cur, n: "" });
  }
  return (
    `<option value="">— escolher banco —</option>` +
    list
      .map(
        (b) =>
          `<option value="${esc(b.s)}"${b.s === cur ? " selected" : ""}>${esc(b.n ? `${b.s} — ${b.n}` : b.s)}</option>`
      )
      .join("")
  );
}

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function tipoPill(type) {
  if (type === "CREDITO") return '<span class="fcal-pill fcal-pill--bad">Cartão de Crédito</span>';
  if (type === "PREPAGO") return '<span class="fcal-pill fcal-pill--warn">Fundo de Maneio</span>';
  return '<span class="fcal-pill fcal-pill--slate">Conta Principal</span>';
}

function obraNome(project) {
  if (!project) return "Sede";
  return [project.code || project.referencia, project.name].filter(Boolean).join(" · ") || "Sede";
}

function saldoCaixa(c) {
  const b = Number(c?.balance) || 0;
  return c?.type === "CREDITO" ? Math.max(0, b) : b;
}

function desenhar() {
  const el = root();
  if (!el) return;
  if (S.erro) return (el.innerHTML = erro(S.erro));
  if (!S.d) return (el.innerHTML = vazio("A carregar…"));

  const all = S.d.items || [];
  const bancos = [...new Set(all.map((c) => bancoSig(c.bank)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt"));
  const q = norm(S.q).trim();

  const L = all
    .filter((c) => {
      const sig = bancoSig(c.bank);
      if (S.b && sig !== S.b) return false;
      if (S.t && c.type !== S.t) return false;
      if (S.e === "A" && !c.active) return false;
      if (S.e === "I" && c.active) return false;
      if (q) {
        const hay = norm(
          [
            c.label,
            c.bank,
            bancoLbl(c.bank),
            c.accountNumber,
            c.iban,
            c.lastDigits,
            c.holderName,
            c.responsible,
            c.allocation?.responsible,
            c.project?.name,
            c.project?.code,
          ].join(" ")
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), "pt", { numeric: true }));

  const nCP = all.filter((c) => c.active && c.type === "DEBITO").length;
  const nFM = all.filter((c) => c.active && c.type === "PREPAGO").length;
  const nCC = all.filter((c) => c.active && c.type === "CREDITO").length;
  const temFiltro = Boolean(S.q || S.b || S.t || S.e !== "A");
  const totalCaixa = L.reduce((s, c) => s + saldoCaixa(c), 0);

  el.innerHTML = `
    <div class="cp-filtros" style="align-items:flex-end;flex-wrap:wrap;gap:12px">
      <label class="finance-field" style="min-width:220px;margin:0">
        <span class="finance-label">Pesquisar</span>
        <input type="search" class="finance-input" data-t5q placeholder="código, n.º, IBAN, responsável…" value="${esc(S.q)}">
      </label>
      <label class="finance-field" style="min-width:190px;margin:0">
        <span class="finance-label">Banco</span>
        <select class="finance-input" data-t5f="b">
          <option value="">Todos</option>
          ${bancos.map((b) => `<option value="${esc(b)}"${S.b === b ? " selected" : ""}>${esc(bancoLbl(b))}</option>`).join("")}
        </select>
      </label>
      <div style="margin:0">
        ${seg("t5", "t", S.t, [
          ["", "Todos"],
          ["DEBITO", `Conta Principal (${nCP})`],
          ["PREPAGO", `Fundo de Maneio (${nFM})`],
          ["CREDITO", `Cartão de Crédito (${nCC})`],
        ])}
      </div>
      <label class="finance-field" style="min-width:120px;margin:0">
        <span class="finance-label">Estado</span>
        <select class="finance-input" data-t5f="e">
          <option value="A"${S.e === "A" ? " selected" : ""}>Ativas</option>
          <option value="I"${S.e === "I" ? " selected" : ""}>Inativas</option>
          <option value="T"${S.e === "T" ? " selected" : ""}>Todas</option>
        </select>
      </label>
      ${
        temFiltro
          ? `<button type="button" class="finance-btn finance-btn--ghost" data-t5clear style="height:36px">✕ Limpar</button>`
          : ""
      }
    </div>
    ${
      L.length
        ? `<div class="fx2-tw"><table class="fx2-t">
      <thead>
        <tr>
          <th style="width:17%">Conta / Cartão</th>
          <th style="width:9%">Banco</th>
          <th style="width:13%">Tipo</th>
          <th>Responsável</th>
          <th class="r" style="width:13%">Saldo</th>
          <th style="width:9%">Último mov.</th>
          <th class="r" style="width:8%">Por conciliar</th>
        </tr>
      </thead>
      <tbody>
        ${L.map((c) => {
          const sig = bancoSig(c.bank);
          const est = c.damagedReturn;
          const resp = c.allocation?.responsible || c.responsible;
          const obra = obraNome(c.allocation?.project || c.project);
          const s = Number(c.balance) || 0;
          const isCC = c.type === "CREDITO";
          const nConc = Number(c.unreconciledCount) || 0;
          return `<tr class="frc-r" data-contaedit="${esc(c.id)}" style="cursor:pointer${c.active ? "" : ";opacity:.55"}">
            <td title="${esc(c.label + (c.iban ? " · " + c.iban : ""))}">
              <b>${esc(c.label)}</b>${c.lastDigits ? ` <span class="fx2-mut">•••• ${esc(c.lastDigits)}</span>` : ""}${
                est
                  ? ` <span class="fcal-pill fcal-pill--bad" title="${esc(
                      "Estragado" + (est.by ? " por " + est.by : "") + (est.date ? " em " + fmtData(est.date) : "")
                    )}">estragado</span>`
                  : ""
              }
            </td>
            <td title="${esc(bancoLbl(c.bank))}"><b>${esc(sig || "—")}</b></td>
            <td>${tipoPill(c.type)}</td>
            <td>${resp ? `${esc(resp)} <span class="fx2-mut">· ${esc(obra)}</span>` : '<span class="fx2-mut">—</span>'}</td>
            <td class="r">${
              isCC && s < 0
                ? `<b style="color:var(--pt-bad)">dívida ${fmt(-s)}</b>`
                : `<b${s < 0 ? ' style="color:var(--pt-bad)"' : ""}>${fmt(s)}</b>`
            }</td>
            <td>${c.lastMovementDate ? fmtData(c.lastMovementDate) : "—"}</td>
            <td class="r">${nConc ? `<b style="color:var(--pt-warn)">${nConc}</b>` : '<span class="fx2-mut">0</span>'}</td>
          </tr>`;
        }).join("")}
      </tbody>
      <tfoot>
        <tr class="tot">
          <td colspan="4">Total (${L.length})</td>
          <td class="r">${fmt(totalCaixa)}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table></div>`
        : vazio(all.length ? "Nenhuma conta corresponde aos filtros." : "Ainda não há contas nem cartões registados.")
    }`;
}

export function abrirModalAlocacaoCartao(card, { obras = [], onSaved } = {}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const nome = [bancoSig(card.bank), card.label, card.lastDigits ? `•••• ${card.lastDigits}` : ""].filter(Boolean).join(" · ");
  openModal({
    kicker: "ALOCAÇÃO DE CARTÃO",
    title: `Alocar ${card.label}`,
    primaryLabel: "Gravar alocação",
    contentHtml: `<div class="finance-form-grid finance-form-grid--2">
      <div class="finance-field finance-field--full">
        <label class="finance-label">Cartão *</label>
        <input class="finance-input" value="${esc(nome)}" disabled>
      </div>
      <div class="finance-field">
        <label class="finance-label">Responsável *</label>
        <input id="naR" class="finance-input" placeholder="ex.: Eng. Pedro">
      </div>
      <div class="finance-field">
        <label class="finance-label">Data de início *</label>
        <input id="naD" class="finance-input" type="date" value="${hoje}">
      </div>
      <div class="finance-field finance-field--full">
        <label class="finance-label">Obra / destino</label>
        <select id="naO" class="finance-input">
          <option value="">Sede</option>
          ${obras
            .map((o) => `<option value="${esc(o.id)}">${esc([o.code || o.referencia, o.name].filter(Boolean).join(" · "))}</option>`)
            .join("")}
        </select>
      </div>
      <div class="finance-field finance-field--full">
        <label class="finance-label">Observações</label>
        <input id="naN" class="finance-input" placeholder="ex.: Fundo de maneio da obra">
      </div>
      <div class="finance-field finance-field--full fx2-mut" style="font-size:11.5px">
        Ao entregar o cartão a outra pessoa, a alocação anterior fecha-se sozinha.
      </div>
    </div>`,
    onPrimary: async ({ panel, close }) => {
      const $ = (id) => panel.querySelector(id)?.value?.trim() || "";
      if ($("#naR").length < 2) return toast("Indique o responsável.", { type: "error" });
      if (!$("#naD")) return toast("Indique a data de início.", { type: "error" });
      try {
        await apiRequest("/finance/card-allocations", {
          method: "POST",
          body: {
            cardId: card.id,
            responsavel: $("#naR"),
            obraId: $("#naO") || null,
            inicio: $("#naD"),
            notas: $("#naN") || null,
            autoClose: true,
          },
        });
        toast("Alocação gravada.", { type: "success" });
        close();
        if (onSaved) await onSaved();
      } catch (e) {
        toast(e.message || "Não foi possível gravar a alocação.", { type: "error" });
      }
    },
  });
}

export function abrirModalConta(conta = null, { todasContas = [], obras = [], extraBanks = [], onSaved } = {}) {
  const c = conta || {
    id: "",
    label: "",
    bank: "",
    type: "",
    accountNumber: "",
    iban: "",
    validade: "",
    lastDigits: "",
    currency: "AOA",
    initialBalance: 0,
    initialBalanceDate: "",
    active: true,
    limitAmount: null,
    paymentCardId: "",
    closingDay: null,
    paymentDay: null,
  };
  const isEdit = Boolean(c.id);
  const editavel = podeEditar();
  const cPs = todasContas.filter((x) => x.active && x.type === "DEBITO" && x.id !== c.id);
  const est = c.damagedReturn;
  const al = c.allocation;

  const modal = openModal({
    kicker: isEdit ? "CONTA" : "NOVA CONTA",
    title: isEdit ? c.label : "Nova conta ou cartão",
    size: "lg",
    hideFooter: true,
    contentHtml: `
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field">
          <label class="finance-label">Tipo *</label>
          <select id="ct_tipo" class="finance-input" ${editavel ? "" : "disabled"}>
            <option value=""${!c.type ? " selected" : ""}>— escolher —</option>
            <option value="DEBITO"${c.type === "DEBITO" ? " selected" : ""}>Conta Principal</option>
            <option value="PREPAGO"${c.type === "PREPAGO" ? " selected" : ""}>Fundo de Maneio</option>
            <option value="CREDITO"${c.type === "CREDITO" ? " selected" : ""}>Cartão de Crédito</option>
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label">Código / designação *</label>
          <input id="ct_cod" class="finance-input" value="${esc(c.label || "")}" placeholder="ex.: BCGA C3 - MBT" ${editavel ? "" : "disabled"}>
        </div>
        <div class="finance-field">
          <label class="finance-label">Banco *</label>
          <select id="ct_bco" class="finance-input" ${editavel ? "" : "disabled"}>
            ${bancoOpts(c.bank || "", extraBanks)}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label">N.º de conta</label>
          <input id="ct_num" class="finance-input" value="${esc(c.accountNumber || "")}" placeholder="os espaços são retirados ao gravar" ${editavel ? "" : "disabled"}>
        </div>
        <div class="finance-field finance-field--full">
          <label class="finance-label">IBAN</label>
          <input id="ct_iban" class="finance-input" value="${esc(c.iban || "")}" placeholder="AO06 0000 0000 0000 0000 0000 0" ${editavel ? "" : "disabled"}>
        </div>
        <div class="finance-field">
          <label class="finance-label">Validade do cartão</label>
          <input id="ct_val" class="finance-input" type="month" value="${esc(c.validade || "")}" ${editavel ? "" : "disabled"}>
          <small class="fx2-mut" style="font-size:11px">se tiver cartão associado</small>
        </div>
        <div class="finance-field">
          <label class="finance-label">Últimos 4 dígitos do cartão</label>
          <input id="ct_u4" class="finance-input" maxlength="4" value="${esc(c.lastDigits || "")}" placeholder="ex.: 4821" ${editavel ? "" : "disabled"}>
        </div>
        <div class="finance-field">
          <label class="finance-label">Moeda</label>
          <select id="ct_moeda" class="finance-input" ${editavel ? "" : "disabled"}>
            <option value="AOA"${(c.currency || "AOA") === "AOA" ? " selected" : ""}>AOA</option>
            <option value="USD"${c.currency === "USD" ? " selected" : ""}>USD</option>
            <option value="EUR"${c.currency === "EUR" ? " selected" : ""}>EUR</option>
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label">Saldo inicial</label>
          <input id="ct_sini" class="finance-input" type="number" step="any" value="${c.initialBalance ?? 0}" ${editavel ? "" : "disabled"}>
        </div>
        <div class="finance-field">
          <label class="finance-label">Data do saldo inicial</label>
          <input id="ct_dini" class="finance-input" type="date" value="${esc(c.initialBalanceDate || "")}" ${editavel ? "" : "disabled"}>
          <small class="fx2-mut" style="font-size:11px">Deixe em branco se vai importar os movimentos desde o início (com a linha de saldo inicial).</small>
        </div>
        <div class="finance-field">
          <label class="finance-label">Estado</label>
          <select id="ct_ativa" class="finance-input" ${editavel ? "" : "disabled"}>
            <option value="1"${c.active !== false ? " selected" : ""}>Ativa</option>
            <option value="0"${c.active === false ? " selected" : ""}>Inativa</option>
          </select>
        </div>
      </div>

      <p class="fcal-nota" style="margin-top:10px">
        Com data do saldo inicial, só os movimentos posteriores a essa data contam para o saldo. Os cartões de <b>Fundo de Maneio</b> aparecem nos pedidos pagos por fundo de maneio e na alocação de cartões; os da <b>Conta Principal</b> não.
      </p>

      <div id="ct_cc_box" style="display:${c.type === "CREDITO" ? "block" : "none"};margin-top:14px;padding-top:12px;border-top:1px solid var(--pt-bdr, #e2e8f0)">
        <h4 class="f0-h3" style="margin:0 0 10px">Cartão de Crédito</h4>
        <div class="finance-form-grid finance-form-grid--2">
          <div class="finance-field">
            <label class="finance-label">Limite de crédito (se houver)</label>
            <input id="ct_lim" class="finance-input" type="number" step="any" value="${c.limitAmount || ""}" placeholder="0 = sem limite fixo" ${editavel ? "" : "disabled"}>
          </div>
          <div class="finance-field">
            <label class="finance-label">Conta de onde se paga / carrega</label>
            <select id="ct_cpag" class="finance-input" ${editavel ? "" : "disabled"}>
              <option value="">— escolher —</option>
              ${cPs
                .map(
                  (x) =>
                    `<option value="${esc(x.id)}"${c.paymentCardId === x.id ? " selected" : ""}>${esc(x.label)} (${esc(bancoSig(x.bank))})</option>`
                )
                .join("")}
            </select>
          </div>
          <div class="finance-field">
            <label class="finance-label">Dia de fecho do extrato (se houver)</label>
            <input id="ct_dfecho" class="finance-input" type="number" min="1" max="31" value="${c.closingDay || ""}" placeholder="ex.: 25" ${editavel ? "" : "disabled"}>
          </div>
          <div class="finance-field">
            <label class="finance-label">Dia de pagamento (se houver)</label>
            <input id="ct_dpag" class="finance-input" type="number" min="1" max="31" value="${c.paymentDay || ""}" placeholder="ex.: 10" ${editavel ? "" : "disabled"}>
          </div>
        </div>
        <p class="fcal-nota" style="margin-top:8px">
          As compras entram pelo extrato do cartão e concilia-se cada uma com o seu pedido. Os carregamentos e os pagamentos são transferências da conta indicada para o cartão. Saldo positivo = dinheiro disponível no cartão; saldo negativo = dívida ao banco.
        </p>
      </div>

      ${
        isEdit
          ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--pt-bdr, #e2e8f0)">
              <h4 class="f0-h3" style="margin:0 0 8px">Alocação atual</h4>
              ${
                est
                  ? `<div style="margin-bottom:8px;padding:8px 10px;border-radius:6px;background:rgba(220,38,38,.08);color:var(--pt-bad, #dc2626);font-size:12px">
                      ⚠ Este cartão foi devolvido <b>estragado</b>${est.by ? ` por <b>${esc(est.by)}</b>` : ""}${est.date ? ` em ${fmtData(est.date)}` : ""}${est.notes ? ` (${esc(est.notes)})` : ""}.
                    </div>`
                  : ""
              }
              <div style="font-size:13px;margin-bottom:10px">
                ${
                  al
                    ? `<b>${esc(al.responsible)}</b> · ${esc(obraNome(al.project))} · desde ${fmtData(al.startDate)}`
                    : '<span class="fx2-mut">Sem alocação registada.</span>'
                }
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                ${
                  editavel
                    ? `<button type="button" class="finance-btn" id="ct_newaloc">+ Nova alocação deste cartão</button>`
                    : ""
                }
                <a class="finance-btn finance-btn--ghost" href="/Financeiro/alocacao-cartoes?q=${encodeURIComponent(c.label)}">Ver histórico</a>
              </div>
            </div>`
          : ""
      }

      <div id="ct_st" style="margin-top:10px;font-size:12.5px;min-height:18px"></div>

      <div class="app-modal__footer" style="margin-top:12px;padding:12px 0 0;border-top:1px solid var(--pt-bdr, #e2e8f0);display:flex;align-items:center;gap:8px">
        ${
          isEdit && editavel
            ? `<button type="button" class="finance-btn" id="ct_del" style="color:var(--pt-bad, #dc2626);border-color:rgba(220,38,38,.3)">Eliminar</button>`
            : ""
        }
        <span style="flex:1"></span>
        <button type="button" class="finance-btn finance-btn--ghost" id="ct_cancel">Cancelar</button>
        ${editavel ? `<button type="button" class="finance-btn finance-btn--primary" id="ct_save">Gravar</button>` : ""}
      </div>
    `,
  });

  const { panel, close } = modal;
  const $ = (sel) => panel.querySelector(sel);
  const setStatus = (msg, isError = true) => {
    const st = $("#ct_st");
    if (!st) return;
    st.style.color = isError ? "var(--pt-bad, #dc2626)" : "var(--pt-good, #16a34a)";
    st.textContent = msg;
  };

  // Mostrar/esconder secção de Cartão de Crédito conforme o Tipo
  $("#ct_tipo")?.addEventListener("change", (ev) => {
    const box = $("#ct_cc_box");
    if (box) box.style.display = ev.target.value === "CREDITO" ? "block" : "none";
  });

  // Auto-preencher o banco pelo código IBAN (AO06 + 4 dígitos do banco)
  $("#ct_iban")?.addEventListener("input", (ev) => {
    const clean = String(ev.target.value || "").replace(/\s+/g, "").toUpperCase();
    const m = clean.match(/^AO\d{2}(\d{4})/);
    const bcoEl = $("#ct_bco");
    if (m && IBAN_BANK_MAP[m[1]] && bcoEl && !bcoEl.value) {
      bcoEl.value = IBAN_BANK_MAP[m[1]];
    }
  });

  $("#ct_cancel")?.addEventListener("click", () => close());

  $("#ct_newaloc")?.addEventListener("click", () => {
    close();
    abrirModalAlocacaoCartao(c, { obras, onSaved });
  });

  $("#ct_del")?.addEventListener("click", async () => {
    if ((Number(c.movementCount) || 0) > 0) {
      return setStatus("A conta tem movimentos. Marque-a como inativa.");
    }
    if (!confirm("Eliminar a conta?")) return;
    try {
      await apiRequest(`/finance/cards/${encodeURIComponent(c.id)}`, { method: "DELETE" });
      toast("Conta eliminada.", { type: "success" });
      close();
      if (onSaved) await onSaved();
    } catch (e) {
      setStatus(e.message || "Não foi possível eliminar a conta.");
    }
  });

  $("#ct_save")?.addEventListener("click", async () => {
    const type = $("#ct_tipo")?.value || "";
    const bank = bancoSig($("#ct_bco")?.value || "");
    const label = ($("#ct_cod")?.value || "").trim().toUpperCase();

    if (!type) return setStatus("Indique o tipo: Conta Principal, Fundo de Maneio ou Cartão de Crédito.");
    if (!bank) return setStatus("Escolha o banco.");
    if (!label) return setStatus("Indique o código / designação (ex.: BCGA C3 - MBT).");

    const dup = todasContas.find((x) => x.id !== c.id && String(x.label || "").toLowerCase() === label.toLowerCase());
    if (dup) return setStatus(`Já existe uma conta com o código ${label}.`);

    const isCC = type === "CREDITO";
    const payload = {
      type,
      label,
      bank,
      accountNumber: ($("#ct_num")?.value || "").replace(/\s+/g, ""),
      iban: ($("#ct_iban")?.value || "").replace(/\s+/g, "").toUpperCase(),
      validade: ($("#ct_val")?.value || "").trim(),
      lastDigits: ($("#ct_u4")?.value || "").replace(/\s+/g, "").slice(-4),
      currency: $("#ct_moeda")?.value || "AOA",
      initialBalance: Number($("#ct_sini")?.value) || 0,
      initialBalanceDate: $("#ct_dini")?.value || "",
      active: $("#ct_ativa")?.value !== "0",
      limitAmount: isCC ? Number($("#ct_lim")?.value) || 0 : 0,
      paymentCardId: isCC ? $("#ct_cpag")?.value || "" : "",
      closingDay: isCC ? Number($("#ct_dfecho")?.value) || null : null,
      paymentDay: isCC ? Number($("#ct_dpag")?.value) || null : null,
    };

    try {
      if (isEdit) {
        await apiRequest(`/finance/cards/${encodeURIComponent(c.id)}`, { method: "PATCH", body: payload });
      } else {
        await apiRequest("/finance/cards", { method: "POST", body: payload });
      }
      toast("Conta gravada.", { type: "success" });
      close();
      if (onSaved) await onSaved();
    } catch (e) {
      setStatus(e.message || "Não foi possível gravar a conta.");
    }
  });
}

async function carregar() {
  try {
    const [d, obrasRes, banksRes] = await Promise.all([
      apiRequest("/finance/cards"),
      apiRequest("/finance/options/projects").catch(() => ({ items: [] })),
      apiRequest("/banks").catch(() => ({ items: [] })),
    ]);
    S.d = d;
    S.obras = obrasRes?.items || [];
    S.customBanks = (banksRes?.items || []).map((b) => b.name).filter(Boolean);
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render() {
  codigoNoCabecalho("T5");

  const params = new URLSearchParams(window.location.search);
  if (params.get("b")) S.b = bancoSig(params.get("b"));
  if (params.get("t")) S.t = params.get("t");
  if (params.get("q")) S.q = params.get("q");

  const acts = document.getElementById("financePageActions");
  if (acts && podeEditar()) {
    acts.innerHTML = `<button type="button" class="finance-btn finance-btn--primary" id="t5NovaConta">+ Nova Conta / Cartão</button>`;
    document.getElementById("t5NovaConta").onclick = () =>
      abrirModalConta(null, {
        todasContas: S.d?.items || [],
        obras: S.obras,
        extraBanks: S.customBanks,
        onSaved: carregar,
      });
  }

  const el = root();
  el.addEventListener("click", (e) => {
    const clearBtn = e.target.closest("[data-t5clear]");
    if (clearBtn) {
      S.q = "";
      S.b = "";
      S.t = "";
      S.e = "A";
      return desenhar();
    }
    const b = e.target.closest("[data-t5]");
    if (b) {
      const [k, v] = b.dataset.t5.split("|");
      S[k] = v;
      return desenhar();
    }
    const row = e.target.closest("[data-contaedit]");
    if (row && S.d?.items) {
      const conta = S.d.items.find((x) => String(x.id) === String(row.dataset.contaedit));
      if (conta) {
        abrirModalConta(conta, {
          todasContas: S.d.items,
          obras: S.obras,
          extraBanks: S.customBanks,
          onSaved: carregar,
        });
      }
    }
  });

  el.addEventListener("change", (e) => {
    const k = e.target.dataset.t5f;
    if (!k) return;
    S[k] = e.target.value;
    desenhar();
  });

  let tempo = null;
  el.addEventListener("input", (e) => {
    if (e.target.dataset.t5q === undefined) return;
    S.q = e.target.value;
    clearTimeout(tempo);
    tempo = setTimeout(() => {
      const pos = e.target.selectionStart;
      desenhar();
      const n = root().querySelector("[data-t5q]");
      if (n) {
        n.focus();
        n.setSelectionRange(pos, pos);
      }
    }, 200);
  });

  desenhar();
  await carregar();

  if (params.get("nova") === "1" && podeEditar()) {
    abrirModalConta(null, {
      todasContas: S.d?.items || [],
      obras: S.obras,
      extraBanks: S.customBanks,
      onSaved: carregar,
    });
  } else if (params.get("edit") && S.d?.items) {
    const conta = S.d.items.find((x) => String(x.id) === String(params.get("edit")));
    if (conta) {
      abrirModalConta(conta, {
        todasContas: S.d.items,
        obras: S.obras,
        extraBanks: S.customBanks,
        onSaved: carregar,
      });
    }
  }
}
