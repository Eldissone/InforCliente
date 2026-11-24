import { apiRequest } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc } from "./f2Ui.js";

/**
 * RG9 Bancos — o `V.fbco` do protótipo: Sigla · Nome · Código IBAN · Outros
 * nomes (extratos e documentos) · Contas / Financ. · Editar, e «+ Novo Banco».
 * O código no IBAN são os 4 algarismos depois de «AO06»; os outros nomes são
 * as formas com que o banco aparece nos extratos e documentos.
 */

const root = () => document.getElementById("financeRoot");
const S = { itens: null, erro: null, inativos: false };

function desenhar() {
  const el = root();
  if (S.erro) return (el.innerHTML = `<div class="finance-empty">Não foi possível carregar: ${esc(S.erro)}</div>`);
  if (!S.itens) return (el.innerHTML = '<div class="finance-empty">A carregar…</div>');
  const ed = can("financeiro", "edit");
  const L = S.itens.filter((b) => S.inativos || b.active !== false);
  el.innerHTML = `
    <div class="t3-bar">
      ${ed ? '<button type="button" class="finance-btn finance-btn--primary" data-bco="new">+ Novo Banco</button>' : ""}
      <span class="t3-sp"></span>
      <label class="t3-small t2-lbl"><input type="checkbox" data-bcoinat${S.inativos ? " checked" : ""}> mostrar inativos</label>
    </div>
    <section class="t3-sec t3-flush"><div class="fx2-tw"><table class="fx2-t bco-t">
      <thead><tr><th>Sigla</th><th>Nome</th><th>Código IBAN</th><th>Outros nomes (extratos e documentos)</th><th class="r">Contas / Financ.</th><th></th></tr></thead>
      <tbody>${L.map(
        (b) => `<tr${b.active === false ? ' class="fx2-off"' : ""}>
          <td><b>${esc(b.code)}</b></td>
          <td>${esc(b.name)}${b.active === false ? ' <span class="t2-pill">inativo</span>' : ""}</td>
          <td>${esc(b.ibanCode || "—")}</td>
          <td class="fx2-mut">${esc((b.aliases || []).join(", "))}</td>
          <td class="r" title="${b.contas} conta(s) / cartão(ões) · ${b.financiamentos} financiamento(s)">${b.contas || b.financiamentos ? `${b.contas || ""}${b.financiamentos ? ` / ${b.financiamentos}` : ""}` : ""}</td>
          <td class="r">${ed ? `<button type="button" class="finance-btn finance-btn--sm" data-bco="ed|${esc(b.id)}">Editar</button>` : ""}</td></tr>`
      ).join("")}</tbody></table></div></section>
    <p class="fx2-mut t3-small">O código IBAN são os 4 algarismos depois de «AO06» (ex.: AO06 <b>0040</b> …) — identifica o banco de uma conta. Os outros nomes ajudam a reconhecer o banco nos extratos e documentos. «Contas / Financ.» conta as contas e cartões da MBT desse banco e os financiamentos com ele.</p>`;
}

function formulario(b = null) {
  openModal({
    title: b ? `Banco ${esc(b.code)}` : "Novo Banco",
    width: 620,
    contentHtml: `<div class="t3-grid">
        <label class="t3-f"><span>Sigla <b class="t3-req">*</b></span><input class="finance-input" id="bcCode" value="${esc(b?.code || "")}" placeholder="ex.: BAI" maxlength="12"></label>
        <label class="t3-f t3-w2"><span>Nome <b class="t3-req">*</b></span><input class="finance-input" id="bcName" value="${esc(b?.name || "")}"></label>
        <label class="t3-f"><span>Código IBAN</span><input class="finance-input" id="bcIban" value="${esc(b?.ibanCode || "")}" placeholder="4 algarismos" maxlength="4" inputmode="numeric"></label>
        <label class="t3-f t3-w2"><span>Outros nomes (extratos e documentos)</span><input class="finance-input" id="bcAli" value="${esc((b?.aliases || []).join(", "))}" placeholder="separados por vírgula"></label>
        ${b ? `<label class="t3-f"><span>Estado</span><select class="finance-input" id="bcAct"><option value="1"${b.active !== false ? " selected" : ""}>Ativo</option><option value="0"${b.active === false ? " selected" : ""}>Inativo</option></select></label>` : ""}
      </div>`,
    primaryLabel: "Gravar",
    secondaryLabel: "Cancelar",
    onPrimary: async ({ body, close, btn }) => {
      const v = (id) => body.querySelector(id)?.value?.trim() || "";
      const dados = {
        code: v("#bcCode"),
        name: v("#bcName"),
        ibanCode: v("#bcIban") || null,
        aliases: v("#bcAli").split(",").map((x) => x.trim()).filter(Boolean),
        ...(b ? { active: v("#bcAct") !== "0" } : {}),
      };
      if (dados.code.length < 2 || dados.name.length < 2) return toast("Indique a sigla e o nome.", { type: "error" });
      if (dados.ibanCode && !/^\d{4}$/.test(dados.ibanCode)) return toast("O código IBAN tem 4 algarismos.", { type: "error" });
      btn.disabled = true;
      try {
        await apiRequest(b ? `/banks/${encodeURIComponent(b.id)}` : "/banks", { method: b ? "PATCH" : "POST", body: dados });
        toast(b ? "Banco atualizado." : "Banco criado.", { type: "success" });
        close();
        carregar();
      } catch (e) {
        btn.disabled = false;
        toast(e.data?.error || e.data?.message || e.message || "Falha ao gravar.", { type: "error" });
      }
    },
  });
}

async function carregar() {
  try {
    S.itens = (await apiRequest("/banks")).items || [];
    S.erro = null;
  } catch (e) {
    S.erro = e.message;
  }
  desenhar();
}

export async function render() {
  const el = root();
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-bco]");
    if (!b) return;
    const [a, id] = b.dataset.bco.split("|");
    if (a === "new") return formulario();
    if (a === "ed") return formulario(S.itens.find((x) => x.id === id));
  });
  el.addEventListener("change", (e) => {
    if (e.target.dataset.bcoinat === undefined) return;
    S.inativos = e.target.checked;
    desenhar();
  });
  desenhar();
  await carregar();
}
