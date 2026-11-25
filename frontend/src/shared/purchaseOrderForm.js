import { apiRequest, apiUpload } from "../services/api.js";
import { getSessionUser } from "../services/auth.js";
import { toast as uiToast } from "./ui.js";
import { refreshPedidoTotalsFromRows, collectPedidoTotalsFromItemRows, formatPedidoTotalNumber } from "./supplierFiscal.js";
import { bindNifLookup, normalizeNif, setNifLookupStatus } from "./supplierNifLookup.js";

// ══════════════════════════════════════════════════════════
// Requisição de Pagamento (o formulário «rpf» do protótipo, versão 624)
//
// Secções, por ordem: tipo (Geral / Obra · Frota e Equipamentos · Empréstimo)
// e data do pedido; Dados da Requisição (tipo de pagamento PF / TRF INT,
// cotação, moeda, terceiro com NIF, IBAN e banco); Itens a Requisitar
// (código e descrição do catálogo, RF e desconto escondidos até se pedirem);
// Centros de Custo (Geral / Obra: Sede e obras, em % ou valor); Condições de
// Pagamento (pronto, crédito total, crédito em parcelas com datas e valores);
// Documentos (a proforma).
//
// Grava em /purchase-orders. O que o pedido não tem em colunas vai em
// `typeData`: dataPedido, natureza (frota), centros (repartição) e parcelas.
// ══════════════════════════════════════════════════════════

const cache = { suppliers: [], projects: [], products: null };

/** Estado do ecrã que não vive num campo. */
const ST = {
  dist: [{ cc: "", pct: 100, val: "" }],
  distM: "pct",
  parcelas: [],
  mais: false,
  criarTerceiro: false,
  produtoAlvo: null,
  lockProject: false,
  /** «Registar o Pagamento e Conciliar»: o movimento do extrato que este pedido paga. */
  movimento: null,
};

let notify = (msg, type = "info") => uiToast(msg, { type });
let describeError = defaultDescribeError;

/**
 * Os seis tipos do servidor. `hasItems` diz quais se descrevem por linhas; os
 * outros trazem o valor em `typeData`: impostos {tipo, mes, rupe, limite,
 * valor}, pessoal {sub, mes, linhas[]}, empréstimo {por, valor, iban, fim, limite}.
 */
const REQUEST_TYPES = [
  ["SEDE", "Geral", true],
  ["OBRA", "Obra", true],
  ["FROTA", "Frota e Equipamentos", true],
  ["IMPOSTOS", "Impostos", false],
  ["PESSOAL", "Pessoal", false],
  ["EMPRESTIMO", "Empréstimo", false],
];

const $ = (id) => document.getElementById(id);
const val = (id) => $(id)?.value?.trim() || "";
const show = (id, on) => $(id)?.classList.toggle("hidden", !on);
const N = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const fmt = (v) => formatPedidoTotalNumber(v);
const hoje = () => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};
const maisDias = (iso, dias) => {
  const d = new Date(`${iso || hoje()}T12:00:00`);
  d.setDate(d.getDate() + Math.round(dias));
  return d.toISOString().slice(0, 10);
};
const maisMeses = (iso, meses) => {
  const d = new Date(`${iso || hoje()}T12:00:00`);
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
};
const semAcentos = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function typeHasItems(type) {
  const hit = REQUEST_TYPES.find(([k]) => k === type);
  return hit ? hit[2] : true;
}
const isGO = (t) => t === "SEDE" || t === "OBRA";
const GEN_RE = /^\s*(T\d+\s*-\s*)?GEN[EÉ]RICO\b/i;

function isTerceiroGenerico() {
  const nome = val("ccExtraSupplierName") || val("rqTerceiro") || "";
  return GEN_RE.test(nome);
}

function applyGenericoVisibility() {
  const comItens = typeHasItems(currentRequestType());
  const fm = $("ccPedidoModo")?.value === "FM";
  const gen = comItens && !fm && isTerceiroGenerico();
  show("rqBenefGenWrap", gen);
  if (!gen && $("rqBenefNome")) $("rqBenefNome").value = "";
}

/** O tipo escolhido. «GERAL» era o valor antigo e lê-se como sede. */
function currentRequestType() {
  const v = $("ccPedidoType")?.value || "SEDE";
  return v === "GERAL" ? "SEDE" : v;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const esc = escapeHtml;

function defaultDescribeError(err) {
  const e = err?.data?.error;
  if (e && typeof e === "object") {
    const fields = e.fieldErrors
      ? Object.entries(e.fieldErrors).flatMap(([k, msgs]) => (msgs || []).map((m) => `${k}: ${m}`))
      : [];
    const all = [...(e.formErrors || []), ...fields].filter(Boolean);
    if (all.length) return all.join(" · ");
  }
  if (typeof e === "string") return err?.data?.message || e;
  return err?.data?.message || err?.message || "Erro desconhecido";
}

export function parseItemTax(notes) {
  const text = String(notes || "");
  const pick = (re) => {
    const m = text.match(re);
    return m ? Number(String(m[1]).replace(",", ".")) : 0;
  };
  return {
    vat: pick(/IVA\s+(\d+(?:[.,]\d+)?)\s*%/i),
    retention: pick(/Ret\.?\s+(\d+(?:[.,]\d+)?)\s*%/i),
    discount: pick(/Desc\.?\s+(\d+(?:[.,]\d+)?)\s*%/i),
  };
}

export function toDateInput(value) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// ── Autocompletar (terceiros, produtos) ─────────────────────

/**
 * Liga uma lista de sugestões a um campo. `search(q)` devolve
 * [{ label, sub, value }]; `pick(value)` aplica a escolha.
 */
function bindSuggest(input, box, { search, pick, minChars = 1 }) {
  if (!input || !box || input.dataset.sugBound) return;
  input.dataset.sugBound = "1";
  let items = [];
  let idx = -1;
  const close = () => {
    box.classList.add("hidden");
    idx = -1;
  };
  const render = () => {
    const q = input.value.trim();
    if (q.length < minChars) return close();
    items = search(q).slice(0, 12);
    box.innerHTML = items.length
      ? items.map((it, i) => `<button type="button" data-i="${i}"${i === idx ? ' class="on"' : ""}>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</button>`).join("")
      : `<div class="rq-sug-empty">Nada encontrado.</div>`;
    box.classList.remove("hidden");
  };
  input.addEventListener("input", () => {
    idx = -1;
    render();
  });
  input.addEventListener("focus", () => {
    if (input.value.trim().length >= minChars) render();
  });
  input.addEventListener("keydown", (e) => {
    if (box.classList.contains("hidden")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      idx = Math.max(0, Math.min(items.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)));
      render();
    } else if (e.key === "Enter" && idx >= 0) {
      e.preventDefault();
      pick(items[idx].value);
      close();
    } else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
  box.addEventListener("mousedown", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    e.preventDefault();
    pick(items[Number(b.dataset.i)].value);
    close();
  });
}

// ── Terceiros ───────────────────────────────────────────────

function contaDe(s) {
  const contas = s?.bankAccounts || [];
  const c = contas.find((a) => a.isPrimary) || contas[0] || null;
  return { iban: s?.iban || c?.iban || "", banco: c?.bankName || "" };
}

function procurarTerceiros(q) {
  const k = semAcentos(q);
  const d = String(q).replace(/\D/g, "");
  return cache.suppliers
    .filter((s) => s.active !== false && (semAcentos(s.name).includes(k) || (d.length >= 3 && String(s.nif || "").includes(d))))
    .map((s) => ({ label: s.name, sub: s.nif ? `NIF ${s.nif}` : "", value: s }));
}

function escolherTerceiro(s) {
  if (!s) return;
  $("ccExtraSupplierId").value = s.id || "";
  $("ccExtraSupplierName").value = s.name || "";
  $("rqTerceiro").value = s.name || "";
  const nif = $("ccExtraSupplierNif");
  if (nif) {
    nif.value = s.nif || "";
    nif.dataset.validatedNif = normalizeNif(s.nif);
  }
  const { iban, banco } = contaDe(s);
  $("ccExtraSupplierIban").value = iban;
  $("rqTercBanco").value = banco;
  modoCriarTerceiro(false);
  applyGenericoVisibility();
}

function modoCriarTerceiro(on) {
  ST.criarTerceiro = Boolean(on);
  show("btnCcConsultarNif", ST.criarTerceiro);
  const b = $("rqCriarTerceiro");
  if (b) b.textContent = ST.criarTerceiro ? "× Cancelar" : "+ Criar terceiro";
  const st = $("ccExtraSupplierNifStatus");
  if (ST.criarTerceiro) {
    setNifLookupStatus(st, "Escreva o NIF e consulte na AGT: o terceiro fica registado com o nome oficial.", "info");
    st?.classList.remove("hidden");
    $("ccExtraSupplierId").value = "";
    $("ccExtraSupplierNif")?.focus();
  } else if (st) {
    st.classList.add("hidden");
  }
}

export function upsertSupplierOption(supplier) {
  if (!supplier?.id) return;
  const i = cache.suppliers.findIndex((s) => s.id === supplier.id);
  if (i >= 0) cache.suppliers[i] = supplier;
  else cache.suppliers.push(supplier);
}

function bindSupplierNifLookup() {
  bindNifLookup({
    nifInput: "ccExtraSupplierNif",
    button: "btnCcConsultarNif",
    statusEl: "ccExtraSupplierNifStatus",
    register: true,
    extraBody: () => ({ iban: val("ccExtraSupplierIban") || null }),
    onResult: ({ ok, agt, supplier }) => {
      if (!ok) return;
      if (supplier) {
        upsertSupplierOption(supplier);
        escolherTerceiro(supplier);
        return;
      }
      if (agt?.nome) {
        $("ccExtraSupplierName").value = agt.nome;
        $("rqTerceiro").value = agt.nome;
      }
    },
  });
  $("ccExtraSupplierNif")?.addEventListener("input", () => {
    const el = $("ccExtraSupplierNif");
    if (el?.dataset?.validatedNif && el.dataset.validatedNif !== normalizeNif(el.value)) delete el.dataset.validatedNif;
  });
  $("rqTerceiro")?.addEventListener("input", () => {
    // Escrever outro nome desliga o terceiro escolhido.
    const id = $("ccExtraSupplierId");
    const s = cache.suppliers.find((x) => x.id === id.value);
    if (s && s.name !== val("rqTerceiro")) {
      id.value = "";
      $("ccExtraSupplierName").value = "";
    }
    applyGenericoVisibility();
  });
}

// ── Catálogo de produtos ────────────────────────────────────

async function loadProducts() {
  if (cache.products) return cache.products;
  cache.products = [];
  for (const url of ["/products", "/products/tools"]) {
    try {
      const data = await apiRequest(url);
      const arr = Array.isArray(data) ? data : data?.items || [];
      if (arr.length) {
        cache.products = arr.filter((p) => p.active !== false);
        break;
      }
    } catch {
      /* sem permissão para esta lista: tenta a seguinte */
    }
  }
  return cache.products;
}

function procurarProdutos(q) {
  const k = semAcentos(q);
  return (cache.products || [])
    .filter((p) => semAcentos(p.name).includes(k) || semAcentos(p.sku).includes(k))
    .map((p) => ({ label: p.name, sub: [p.sku, p.unit].filter(Boolean).join(" · "), value: p }));
}

function aplicarProduto(tr, p) {
  if (!tr || !p) return;
  tr.querySelector(".cc-item-code").value = p.sku || "";
  tr.querySelector(".cc-item-desc").value = p.name || "";
  if (p.unit) tr.querySelector(".cc-item-unit").value = p.unit;
  refreshTotals();
}

function abrirNovoProduto(tr = null) {
  ST.produtoAlvo = tr;
  show("rqNovoProduto", true);
  $("rqNpNome").value = tr ? tr.querySelector(".cc-item-desc").value.trim() : "";
  $("rqNpCod").value = tr ? tr.querySelector(".cc-item-code").value.trim() : "";
  const un = tr ? tr.querySelector(".cc-item-unit").value.trim().toUpperCase() : "UN";
  $("rqNpUn").value = [...$("rqNpUn").options].some((o) => o.value === un) ? un : "UN";
  $("rqNpNome").focus();
}

async function gravarNovoProduto() {
  const name = val("rqNpNome");
  if (name.length < 2) {
    notify("Escreva o nome do produto ou serviço.", "error");
    return;
  }
  const btn = $("rqNpGravar");
  btn.disabled = true;
  try {
    const p = await apiRequest("/products", {
      method: "POST",
      body: { sku: val("rqNpCod") || null, name, category: $("rqNpCat").value, unit: $("rqNpUn").value, minStock: 0 },
    });
    (cache.products || (cache.products = [])).push(p);
    let tr = ST.produtoAlvo;
    if (!tr || !tr.isConnected) {
      const vazia = [...document.querySelectorAll("#ccItemsBody .cc-item-row")].find((r) => !r.querySelector(".cc-item-desc").value.trim());
      tr = vazia || addItemRow();
    }
    aplicarProduto(tr, p);
    show("rqNovoProduto", false);
    notify(`Produto «${p.name}» criado.`, "success");
  } catch (err) {
    notify("Não foi possível criar o produto: " + describeError(err), "error");
  } finally {
    btn.disabled = false;
  }
}

// ── Itens ───────────────────────────────────────────────────

export function hideAllItemSuggest() {
  document.querySelectorAll("#ccItemsBody .rq-sug").forEach((b) => b.classList.add("hidden"));
}

export function addItemRow() {
  const tbody = $("ccItemsBody");
  if (!tbody) return null;
  const tr = document.createElement("tr");
  tr.className = "cc-item-row";
  tr.innerHTML = `
    <td><div class="rq-ac"><input type="text" class="cc-item-code rq-in" autocomplete="off"><div class="rq-sug hidden"></div></div></td>
    <td><div class="rq-ac"><input type="text" class="cc-item-desc rq-in" autocomplete="off" placeholder="escolha do catálogo de produtos"><div class="rq-sug hidden"></div></div>
      <button type="button" class="rq-sublnk cc-item-newprod">+ criar produto</button></td>
    <td class="rq-colforn"><input type="text" class="cc-item-forn rq-in" placeholder="fornecedor"></td>
    <td><input type="text" class="cc-item-unit rq-in" value="UN"></td>
    <td><input type="number" min="0" step="any" value="1" class="cc-item-qty rq-in rq-r"></td>
    <td><input type="number" min="0" step="any" class="cc-item-price rq-in rq-r"></td>
    <td><input type="number" min="0" max="100" step="any" value="14" class="cc-item-vat rq-in rq-r"></td>
    <td class="rq-x"><input type="number" min="0" max="100" step="any" class="cc-item-wh rq-in rq-r"></td>
    <td class="rq-x"><input type="number" min="0" max="100" step="any" class="cc-item-disc rq-in rq-r"></td>
    <td class="cc-item-line-total rq-cell-tot">0,00</td>
    <td><div class="rq-rowacts"><button type="button" class="rq-obsbtn" title="Observação e documento da linha"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:text-bottom">edit</span> obs</button><button type="button" class="rq-del" aria-label="Remover item"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button></div></td>`;
  const det = document.createElement("tr");
  det.className = "rq-detail hidden";
  det.innerHTML = `<td colspan="11"><div class="rq-grid">
      <label class="rq-f rq-w2"><span>Observação da linha</span><input type="text" class="cc-item-obs rq-in"></label>
      <label class="rq-f"><span>Documento</span><select class="cc-item-doc rq-in">
        <option value="">Fatura</option><option value="DSC">Sem comprovativo</option><option value="AF">Autofaturação</option></select></label>
    </div></td>`;
  tr._det = det;
  tbody.appendChild(tr);
  tbody.appendChild(det);

  const [codeBox, descBox] = tr.querySelectorAll(".rq-sug");
  const pick = (p) => aplicarProduto(tr, p);
  loadProducts().then(() => {
    bindSuggest(tr.querySelector(".cc-item-desc"), descBox, { search: procurarProdutos, pick });
    bindSuggest(tr.querySelector(".cc-item-code"), codeBox, { search: procurarProdutos, pick });
  });
  tr.querySelector(".cc-item-newprod").addEventListener("click", () => abrirNovoProduto(tr));
  tr.querySelector(".rq-obsbtn").addEventListener("click", (e) => {
    det.classList.toggle("hidden");
    e.currentTarget.classList.toggle("on", !det.classList.contains("hidden"));
  });
  tr.querySelector(".rq-del").addEventListener("click", () => {
    tr.remove();
    det.remove();
    if (!tbody.querySelector(".cc-item-row")) addItemRow();
    refreshTotals();
  });
  refreshTotals();
  return tr;
}

/** O que se paga (base + IVA − retenção), pela mesma conta do servidor. */
function totalAPagar() {
  return collectPedidoTotalsFromItemRows("#ccItemsBody .cc-item-row").doc || 0;
}

export function refreshTotals() {
  refreshPedidoTotalsFromRows("ccPedido", "#ccItemsBody .cc-item-row");
  document.querySelectorAll("#ccItemsBody .cc-item-row").forEach((row) => {
    const q = N(row.querySelector(".cc-item-qty")?.value);
    const p = N(row.querySelector(".cc-item-price")?.value);
    const d = N(row.querySelector(".cc-item-disc")?.value);
    const cell = row.querySelector(".cc-item-line-total");
    if (cell) cell.textContent = fmt(q * p * (1 - d / 100));
  });
  renderDist();
  renderParcelas(false);
}

export function fillItemRows(items) {
  const tbody = $("ccItemsBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const list = items && items.length ? items : [{}];
  for (const it of list) {
    const row = addItemRow();
    if (!row) continue;
    const set = (sel, value, root = row) => {
      const el = root.querySelector(sel);
      if (el && value != null && value !== "") el.value = String(value);
    };
    const legacy = parseItemTax(it.notes);
    const rate = (field, fallback) => (it[field] != null ? it[field] : fallback || null);
    set(".cc-item-code", it.code);
    set(".cc-item-desc", it.name || it.description || "");
    set(".cc-item-forn", it.lineSupplierName);
    set(".cc-item-unit", it.unit);
    set(".cc-item-qty", it.quantity != null ? Number(it.quantity) : 1);
    set(".cc-item-price", it.unitPrice != null ? Number(it.unitPrice) : null);
    if (it.name || it.vatPercent != null) row.querySelector(".cc-item-vat").value = rate("vatPercent", legacy.vat) ?? "";
    set(".cc-item-wh", rate("withholdingPercent", legacy.retention));
    set(".cc-item-disc", rate("discountPercent", legacy.discount));
    set(".cc-item-obs", it.notes, row._det);
    set(".cc-item-doc", it.docException, row._det);
    if (it.notes || it.docException) {
      row._det.classList.remove("hidden");
      row.querySelector(".rq-obsbtn").classList.add("on");
    }
    if (N(it.withholdingPercent) || N(it.discountPercent)) setMais(true);
  }
  refreshTotals();
}

function setMais(on) {
  ST.mais = Boolean(on);
  $("ccItemsTable")?.classList.toggle("rq-norf", !ST.mais);
  const b = $("rqMaisBtn");
  if (b) b.textContent = ST.mais ? "esconder RF e desconto" : "mostrar RF e desconto";
}

function collectItems() {
  return Array.from(document.querySelectorAll("#ccItemsBody .cc-item-row"))
    .map((tr) => {
      const q = (sel) => tr.querySelector(sel)?.value?.trim() ?? "";
      const d = (sel) => tr._det?.querySelector(sel)?.value?.trim() ?? "";
      const num = (sel) => {
        const s = q(sel);
        return s === "" ? null : N(s);
      };
      const pct = (v) => (v != null && v >= 0 ? v : null);
      const price = num(".cc-item-price");
      return {
        code: q(".cc-item-code") || null,
        name: q(".cc-item-desc"),
        lineSupplierName: q(".cc-item-forn") || null,
        quantity: N(q(".cc-item-qty")),
        unit: q(".cc-item-unit") || null,
        unitPrice: price != null && price >= 0 ? price : null,
        vatPercent: pct(num(".cc-item-vat")),
        withholdingPercent: pct(num(".cc-item-wh")),
        discountPercent: pct(num(".cc-item-disc")),
        notes: d(".cc-item-obs") || null,
        docException: d(".cc-item-doc") || null,
      };
    })
    .filter((it) => it.name && it.quantity > 0);
}

// ── Centros de custo (Geral / Obra) ─────────────────────────

function obrasAtivas(manter) {
  return cache.projects.filter((p) => p.id === manter || !/complet|conclu|cancel|arquiv/i.test(String(p.status || "")));
}
const nomeObra = (p) => [p.referencia, p.name].filter(Boolean).join(" · ") || p.code || p.id;

function distValores() {
  const T = totalAPagar();
  return ST.dist.map((d) => (ST.distM === "val" ? N(d.val) : (T * N(d.pct)) / 100));
}

function renderDist() {
  const body = $("rqDistBody");
  if (!body) return;
  const T = totalAPagar();
  const V = distValores();
  const S = V.reduce((a, b) => a + b, 0);
  const pc = ST.distM !== "val";
  const somaPct = ST.dist.reduce((a, d) => a + N(d.pct), 0);
  const ok = pc ? Math.abs(somaPct - 100) < 0.05 : Math.abs(S - T) <= 0.5 || (!T && ST.dist.length === 1);
  const opts = (v) =>
    `<option value="">— escolha o centro de custo —</option><option value="SEDE"${v === "SEDE" ? " selected" : ""}>Sede (custos gerais)</option>` +
    `<optgroup label="Obras">${obrasAtivas(v).map((p) => `<option value="${esc(p.id)}"${p.id === v ? " selected" : ""}>${esc(nomeObra(p))}</option>`).join("")}</optgroup>`;
  const lock = ST.lockProject;
  body.innerHTML =
    ST.dist
      .map(
        (d, k) => `<tr>
      <td><select class="rq-in${d.cc ? "" : " rq-bad"}" data-dk="${k}" data-df="cc"${lock && k === 0 ? " disabled" : ""}>${opts(d.cc)}</select></td>
      <td class="rq-r" style="width:160px">${
        pc
          ? `<input class="rq-in rq-r" type="number" step="any" data-dk="${k}" data-df="pct" value="${esc(d.pct ?? "")}" style="width:90px"> %`
          : `<input class="rq-in rq-r" type="number" step="any" data-dk="${k}" data-df="val" value="${esc(d.val ?? "")}" style="width:130px">`
      }</td>
      <td class="rq-r rq-muted" style="width:150px">${pc ? fmt(V[k]) : T ? `${(V[k] / T * 100).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} %` : ""}</td>
      <td style="width:28px">${ST.dist.length > 1 ? `<button type="button" class="rq-del" data-dx="${k}"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">close</span></button>` : ""}</td></tr>`
      )
      .join("") +
    `<tr class="rq-tot"><td><button type="button" class="rq-lnk" data-dadd="1">+ Centro de custo</button>${ST.dist.length > 1 ? ` · <button type="button" class="rq-lnk" data-dig="1">partes iguais</button>` : ""}</td>
      <td class="rq-r${ok ? "" : " rq-warn"}">${pc ? `${somaPct.toLocaleString("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %` : fmt(S)}</td>
      <td class="rq-r ${ok ? "rq-ok" : "rq-warn"}">${ok ? `<span class="material-symbols-outlined" style="font-size:14px;vertical-align:text-bottom">check</span> ${fmt(T)}` : pc ? `falta ${(100 - somaPct).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} %` : `falta ${fmt(T - S)}`}</td><td></td></tr>`;
}

function bindDist() {
  const body = $("rqDistBody");
  body?.addEventListener("change", (e) => {
    const el = e.target.closest("[data-dk]");
    if (!el) return;
    ST.dist[Number(el.dataset.dk)][el.dataset.df] = el.value;
    renderDist();
  });
  body?.addEventListener("input", (e) => {
    const el = e.target.closest("input[data-dk]");
    if (!el) return;
    ST.dist[Number(el.dataset.dk)][el.dataset.df] = el.value;
  });
  body?.addEventListener("focusout", (e) => {
    if (e.target.closest("input[data-dk]")) renderDist();
  });
  body?.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.dx != null) ST.dist.splice(Number(b.dataset.dx), 1);
    else if (b.dataset.dadd) {
      const resto = Math.max(0, 100 - ST.dist.reduce((a, d) => a + N(d.pct), 0));
      ST.dist.push({ cc: "", pct: resto ? +resto.toFixed(2) : "", val: "" });
    } else if (b.dataset.dig) {
      const n = ST.dist.length;
      const T = totalAPagar();
      ST.dist.forEach((d, i) => {
        d.pct = +(i === n - 1 ? 100 - (Math.round((100 / n) * 100) / 100) * (n - 1) : Math.round((100 / n) * 100) / 100).toFixed(2);
        d.val = T ? +((T * d.pct) / 100).toFixed(2) : "";
      });
    } else return;
    renderDist();
  });
  $("rqDistModo")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-m]");
    if (!b || b.dataset.m === ST.distM) return;
    const T = totalAPagar();
    const V = distValores();
    ST.distM = b.dataset.m;
    ST.dist.forEach((d, i) => {
      if (ST.distM === "val") d.val = +V[i].toFixed(2);
      else if (T) d.pct = +((V[i] / T) * 100).toFixed(2);
    });
    $("rqDistModo").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.m === ST.distM));
    renderDist();
  });
}

/** A repartição validada, ou uma mensagem de erro. */
function lerCentros() {
  if (!ST.dist.length || ST.dist.some((d) => !d.cc)) return { erro: "Escolha o centro de custo (Sede ou obra) de cada linha." };
  const T = totalAPagar();
  const V = distValores();
  if (ST.distM === "val") {
    if (T && Math.abs(V.reduce((a, b) => a + b, 0) - T) > 0.5) return { erro: "A repartição pelos centros de custo não soma o total a pagar." };
  } else if (Math.abs(ST.dist.reduce((a, d) => a + N(d.pct), 0) - 100) > 0.05) {
    return { erro: "As percentagens dos centros de custo têm de somar 100 %." };
  }
  const centros = ST.dist.map((d, i) => ({
    tipo: d.cc === "SEDE" ? "SEDE" : "OBRA",
    projectId: d.cc === "SEDE" ? null : d.cc,
    nome: d.cc === "SEDE" ? "Sede" : nomeObra(cache.projects.find((p) => p.id === d.cc) || { id: d.cc }),
    pct: ST.distM === "val" ? (T ? +((V[i] / T) * 100).toFixed(4) : null) : N(d.pct),
    valor: +V[i].toFixed(2),
  }));
  // A obra principal (a de maior parte) fica no pedido; a repartição toda vai em typeData.
  const obras = centros.filter((c) => c.tipo === "OBRA").sort((a, b) => (b.valor || b.pct || 0) - (a.valor || a.pct || 0));
  return { centros, projectId: obras[0]?.projectId || null };
}

// ── Condições de pagamento ──────────────────────────────────

function dataPedido() {
  return val("rqDataPedido") || hoje();
}

function setCondicao(c) {
  $("ccPedidoCondicao").value = c;
  applyPaymentTermVisibility();
}

export function applyPaymentTermVisibility() {
  const fm = $("ccPedidoModo")?.value === "FM";
  if (fm) $("ccPedidoCondicao").value = "PRONTO";
  const term = $("ccPedidoCondicao")?.value || "PRONTO";
  $("rqCondSeg")?.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.c === term));
  show("rqCondSeg", !fm);
  const t = $("rqCondTitulo");
  if (t) t.textContent = fm ? "Data Limite de Pagamento" : "Condições de Pagamento";
  show("cc_rowPronto", term === "PRONTO");
  show("cc_rowCredito", term === "CREDITO");
  show("cc_rowParcial", term === "PARCIAL");
  if (term === "CREDITO" && !val("rqVencimento") && val("ccPedidoDiasCredito")) {
    $("rqVencimento").value = maisDias(dataPedido(), N(val("ccPedidoDiasCredito")));
  }
  if (term === "PARCIAL") renderParcelas(true);
}

/** As parcelas: o número manda no tamanho da lista; as datas e valores ficam. */
function renderParcelas(ajustar) {
  const body = $("rqParcelasBody");
  if (!body || $("ccPedidoCondicao")?.value !== "PARCIAL") return;
  if (ajustar) {
    const n = Math.max(2, Math.min(24, Math.round(N(val("ccPedidoPrestacoes")) || 2)));
    while (ST.parcelas.length < n) {
      const prev = ST.parcelas[ST.parcelas.length - 1];
      ST.parcelas.push({ data: prev ? maisMeses(prev.data, 1) : dataPedido(), valor: "" });
    }
    ST.parcelas.length = n;
    body.innerHTML = ST.parcelas
      .map(
        (p, i) => `<tr><td><b>${i + 1}.ª parcela</b></td>
        <td><input type="date" class="rq-in" data-pk="${i}" data-pf="data" value="${esc(p.data)}"></td>
        <td class="rq-r"><input type="number" step="any" min="0" class="rq-in rq-r" data-pk="${i}" data-pf="valor" value="${esc(p.valor)}" placeholder="0,00"></td></tr>`
      )
      .join("");
  }
  const T = totalAPagar();
  const S = ST.parcelas.reduce((a, p) => a + N(p.valor), 0);
  const ok = Math.abs(S - T) <= 0.5;
  const tot = $("rqParcTotal");
  if (tot) {
    tot.innerHTML = `${fmt(S)} de ${fmt(T)} ${ok ? '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:text-bottom">check</span>' : ""}`;
    tot.classList.toggle("rq-warn", !ok);
  }
}

function bindCondicoes() {
  $("rqCondSeg")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-c]");
    if (b) setCondicao(b.dataset.c);
  });
  $("ccPedidoDiasCredito")?.addEventListener("input", () => {
    const d = val("ccPedidoDiasCredito");
    if (d !== "") $("rqVencimento").value = maisDias(dataPedido(), N(d));
  });
  $("rqVencimento")?.addEventListener("change", () => {
    const v = val("rqVencimento");
    if (!v) return;
    const dias = Math.round((new Date(`${v}T12:00:00`) - new Date(`${dataPedido()}T12:00:00`)) / 86400000);
    $("ccPedidoDiasCredito").value = dias >= 0 ? dias : "";
  });
  $("ccPedidoPrestacoes")?.addEventListener("input", () => renderParcelas(true));
  $("rqParcelasBody")?.addEventListener("input", (e) => {
    const el = e.target.closest("[data-pk]");
    if (!el) return;
    ST.parcelas[Number(el.dataset.pk)][el.dataset.pf] = el.value;
    renderParcelas(false);
  });
  $("rqParcIguais")?.addEventListener("click", () => {
    const T = totalAPagar();
    const n = ST.parcelas.length;
    if (!(T > 0)) {
      notify("Ainda não há total a repartir: preencha os preços dos itens.", "info");
      return;
    }
    const base = Math.floor((T / n) * 100) / 100;
    ST.parcelas.forEach((p, i) => {
      p.valor = i === n - 1 ? +(T - base * (n - 1)).toFixed(2) : base;
    });
    renderParcelas(true);
  });
}

// ── Visibilidade ────────────────────────────────────────────

function refreshTipoSeg() {
  const t = currentRequestType();
  const lock = $("ccPedidoType")?.disabled;
  $("rqTipoSeg")?.querySelectorAll("button").forEach((b) => {
    const k = b.dataset.tipo;
    const on = k === "GO" ? isGO(t) : k === t;
    b.classList.toggle("on", on);
    if (k === "PESSOAL" || k === "IMPOSTOS") b.classList.toggle("hidden", !on);
    b.disabled = Boolean(lock && !on);
  });
}

export function applyTypeVisibility() {
  const type = currentRequestType();
  const comItens = typeHasItems(type);
  refreshTipoSeg();
  show("cc_rowFrota", type === "FROTA");
  show("cc_blockImpostos", type === "IMPOSTOS");
  show("cc_blockPessoal", type === "PESSOAL");
  show("cc_blockEmprestimo", type === "EMPRESTIMO");
  show("rqPagRow", comItens);
  show("ccItemsSection", comItens);
  show("rqCentros", isGO(type));
  if (!isGO(type)) {
    ST.dist = [{ cc: "", pct: 100, val: "" }];
  }
  show("rqCond", type !== "EMPRESTIMO");
  if (type === "PESSOAL" && !document.querySelector("#ccPessoalBody .cc-pes-row")) addPersonRow();
  applyPaymentModeVisibility();
  applyGenericoVisibility();
}

/** TRF INT (fundo de maneio): o fornecedor é de cada item e não há crédito. */
export function applyPaymentModeVisibility() {
  const comItens = typeHasItems(currentRequestType());
  const fm = $("ccPedidoModo")?.value === "FM";
  show("cc_rowFundo", comItens && fm);
  show("rqCotRow", comItens && !fm);
  show("rqFmNote", comItens && fm);
  $("ccItemsTable")?.classList.toggle("rq-fm", fm);
  applyQuoteRequirementVisibility();
  applyPaymentTermVisibility();
}

export function applyQuoteRequirementVisibility() {
  const comItens = typeHasItems(currentRequestType());
  const fm = $("ccPedidoModo")?.value === "FM";
  const cot = comItens && !fm && $("rqCotSel")?.value === "S";
  $("ccPedidoRequerCotacao").checked = cot;
  show("rqCotHint", cot);
  show("rqTercReq", !cot);
  show("cc_extraSupplierBlock", comItens && !fm);
}

/** Mantido para quem ainda chama: a origem do pagamento é o tipo de pagamento. */
export function applyPaymentSourceVisibility() {}

// ── Pessoal: uma linha por colaborador ──────────────────────

export function addPersonRow(data = {}) {
  const tbody = $("ccPessoalBody");
  if (!tbody) return null;
  const tr = document.createElement("tr");
  tr.className = "cc-pes-row";
  tr.innerHTML = `
    <td><input type="text" class="cc-pes-nome rq-in" placeholder="nome do colaborador"></td>
    <td><input type="text" class="cc-pes-iban rq-in" placeholder="AO06…"></td>
    <td><input type="number" step="0.01" min="0" class="cc-pes-valor rq-in rq-r"></td>
    <td style="width:28px"><button type="button" class="cc-pes-del rq-del" aria-label="Remover colaborador">×</button></td>`;
  tbody.appendChild(tr);
  const set = (sel, value) => {
    const el = tr.querySelector(sel);
    if (el && value != null && value !== "") el.value = String(value);
  };
  set(".cc-pes-nome", data.nome);
  set(".cc-pes-iban", data.iban);
  set(".cc-pes-valor", data.valor);
  tr.querySelector(".cc-pes-del").addEventListener("click", () => {
    tr.remove();
    if (!tbody.querySelector(".cc-pes-row")) addPersonRow();
    refreshPessoalTotal();
  });
  refreshPessoalTotal();
  return tr;
}

export function refreshPessoalTotal() {
  const el = $("ccPessoalTotal");
  if (!el) return;
  let total = 0;
  document.querySelectorAll("#ccPessoalBody .cc-pes-row").forEach((tr) => {
    total += N(tr.querySelector(".cc-pes-valor")?.value);
  });
  el.textContent = fmt(total);
}

function collectPessoalRows() {
  return Array.from(document.querySelectorAll("#ccPessoalBody .cc-pes-row"))
    .map((tr) => ({
      nome: tr.querySelector(".cc-pes-nome")?.value?.trim() || "",
      iban: tr.querySelector(".cc-pes-iban")?.value?.trim() || "",
      valor: N(tr.querySelector(".cc-pes-valor")?.value),
    }))
    .filter((l) => l.nome && l.valor > 0);
}

// ── Dados próprios de cada tipo ─────────────────────────────

let IMPOSTO_OBRIGACAO = null;

function collectTypeData(type) {
  if (type === "FROTA") return { viatura: val("ccPedidoViatura"), natureza: val("rqFrotaNatureza") };
  if (type === "IMPOSTOS") {
    return {
      tipo: val("ccImpTipo"),
      mes: val("ccImpMes"),
      rupe: val("ccImpRupe"),
      limite: val("ccImpLimite"),
      valor: N(val("ccImpValor")),
      ...(IMPOSTO_OBRIGACAO ? { obrigacaoId: IMPOSTO_OBRIGACAO } : {}),
    };
  }
  if (type === "PESSOAL") return { sub: val("ccPesSub"), mes: val("ccPesMes"), linhas: collectPessoalRows() };
  if (type === "EMPRESTIMO") {
    return {
      por: val("ccEmpPor"),
      modo: val("ccEmpModo") || "TRANSFERENCIA",
      valor: N(val("ccEmpValor")),
      iban: val("ccEmpIban"),
      fim: val("ccEmpFim"),
      limite: val("ccEmpLimite"),
      prest: N(val("ccEmpPrest")) || 1,
    };
  }
  return {};
}

function missingTypeData(type, d) {
  if (type === "FROTA") {
    if (!d.viatura) return "Indique a viatura ou o equipamento.";
    if (!d.natureza) return "Escolha a natureza do custo da frota.";
  }
  if (type === "IMPOSTOS") {
    if (!d.mes) return "Indique o mês de referência do imposto.";
    if (!(d.valor > 0)) return "Indique o valor do imposto.";
  }
  if (type === "PESSOAL") {
    if (!d.mes) return "Indique o mês do pedido de pessoal.";
    if (!d.linhas.length) return "Acrescente pelo menos um colaborador, com nome e valor.";
  }
  if (type === "EMPRESTIMO") {
    if (!d.por) return "Indique a empresa ou o terceiro do empréstimo.";
    if (!(d.valor > 0)) return "Indique o valor do empréstimo.";
    if (!d.limite) return "Indique a data limite do empréstimo.";
    if (!d.fim) return "Indique a finalidade do empréstimo.";
  }
  return null;
}

function fillTypeData(order) {
  const type = order.requestType || (order.projectId ? "OBRA" : "SEDE");
  const d = order.typeData || {};
  const set = (id, value) => {
    const el = $(id);
    if (el) el.value = value == null ? "" : String(value);
  };
  if (d.dataPedido) set("rqDataPedido", d.dataPedido);
  if (type === "FROTA") {
    set("ccPedidoViatura", d.viatura || "");
    const sel = $("rqFrotaNatureza");
    if (d.natureza && sel && ![...sel.options].some((o) => o.value === d.natureza)) sel.add(new Option(d.natureza, d.natureza));
    set("rqFrotaNatureza", d.natureza || "");
  }
  if (type === "IMPOSTOS") {
    IMPOSTO_OBRIGACAO = d.obrigacaoId || null;
    set("ccImpTipo", d.tipo || "IVA");
    set("ccImpMes", d.mes || "");
    set("ccImpRupe", d.rupe || "");
    set("ccImpLimite", toDateInput(d.limite));
    set("ccImpValor", d.valor != null ? d.valor : "");
  }
  if (type === "PESSOAL") {
    set("ccPesSub", d.sub || "Salários");
    set("ccPesMes", d.mes || "");
    const tbody = $("ccPessoalBody");
    if (tbody) tbody.innerHTML = "";
    (Array.isArray(d.linhas) && d.linhas.length ? d.linhas : [{}]).forEach((l) => addPersonRow(l));
  }
  if (type === "EMPRESTIMO") {
    set("ccEmpPor", d.por || "");
    set("ccEmpModo", d.modo || "TRANSFERENCIA");
    set("ccEmpValor", d.valor != null ? d.valor : "");
    set("ccEmpIban", d.iban || "");
    set("ccEmpFim", d.fim || "");
    set("ccEmpLimite", toDateInput(d.limite || order.dueDate));
    set("ccEmpPrest", d.prest != null ? d.prest : "");
  }
}

// ── Presets vindos de outras páginas ────────────────────────

/** Aplica valores iniciais (tipo, obra; imposto vindo do G1 Impostos). */
export async function applyPedidoPresets({ type, projectId, lockType, lockProject, imposto = null } = {}) {
  const typeSel = $("ccPedidoType");
  if (type && typeSel) {
    const wanted = String(type).toUpperCase() === "GERAL" ? "SEDE" : String(type).toUpperCase();
    typeSel.value = REQUEST_TYPES.some(([k]) => k === wanted) ? wanted : "SEDE";
  }
  if (lockType && typeSel) typeSel.disabled = true;

  if (imposto) {
    const set = (id, v) => {
      const el = $(id);
      if (el && v !== undefined && v !== null && v !== "") el.value = String(v);
    };
    const sel = $("ccImpTipo");
    if (sel && imposto.tipo && ![...sel.options].some((o) => o.value === imposto.tipo)) sel.add(new Option(imposto.tipo, imposto.tipo));
    set("ccImpTipo", imposto.tipo);
    set("ccImpMes", imposto.mes);
    set("ccImpRupe", imposto.rupe);
    set("ccImpLimite", imposto.limite);
    set("ccImpValor", imposto.valor);
    if (imposto.limite) set("ccPedidoDataPretendida", imposto.limite);
    IMPOSTO_OBRIGACAO = imposto.obrigacaoId || null;
  }

  if (projectId) {
    if (typeSel && !lockType) typeSel.value = "OBRA";
    ST.dist = [{ cc: projectId, pct: 100, val: "" }];
    ST.lockProject = Boolean(lockProject);
  }
  applyTypeVisibility();
  renderDist();
}

// ── Dados de referência ─────────────────────────────────────

/** Os centros de custo internos de uma obra (para a cotação, que os pede). */
export async function loadCostCentersForProject(projectId, selectedId = "") {
  const sel = $("ccExtraCostCenterId");
  if (!sel) return "";
  sel.innerHTML = `<option value=""></option>`;
  if (!projectId) return "";
  let arr = [];
  try {
    const data = await apiRequest(`/cost-centers/project/${encodeURIComponent(projectId)}`);
    arr = data?.items || data?.data || (Array.isArray(data) ? data : []);
  } catch {
    try {
      const ccs = await apiRequest("/cost-centers?limit=1000");
      const all = Array.isArray(ccs) ? ccs : ccs?.items || ccs?.data || [];
      arr = all.filter((cc) => cc.projectId === projectId || cc.project?.id === projectId);
    } catch {
      arr = [];
    }
  }
  arr = arr.filter((cc) => cc.active !== false);
  sel.innerHTML += arr.map((cc) => `<option value="${esc(cc.id)}">${esc(cc.name || cc.code || cc.id)}</option>`).join("");
  sel.value = selectedId && arr.some((c) => c.id === selectedId) ? selectedId : arr[0]?.id || "";
  return sel.value;
}

export async function ensureReferenceDataLoaded() {
  const tarefas = [];
  if (!cache.projects.length) {
    tarefas.push(
      apiRequest("/projects?pageSize=100")
        .then((r) => {
          cache.projects = (Array.isArray(r) ? r : r?.items || r?.data || []).sort((a, b) => nomeObra(a).localeCompare(nomeObra(b), "pt"));
        })
        .catch(() => {})
    );
  }
  if (!cache.suppliers.length) {
    tarefas.push(
      apiRequest("/suppliers?limit=1000")
        .then((r) => {
          cache.suppliers = Array.isArray(r) ? r : r?.items || r?.data || [];
        })
        .catch(() => {})
    );
  }
  const fundSel = $("ccPedidoFundId");
  if (fundSel && !fundSel.dataset.ccLoaded) {
    tarefas.push(
      apiRequest("/purchase-orders/payment/meta")
        .then((meta) => {
          fundSel.dataset.ccLoaded = "1";
          for (const f of meta?.funds || []) fundSel.add(new Option(f.name || f.id, f.id));
        })
        .catch(() => {})
    );
  }
  tarefas.push(loadProducts());
  await Promise.all(tarefas);
  renderDist();
}

// ── Recolha e validação ─────────────────────────────────────

function descricaoAuto(type, items, td) {
  if (type === "EMPRESTIMO") return `Empréstimo · ${td.por}${td.fim ? ` · ${td.fim}` : ""}`;
  if (type === "IMPOSTOS") return `${td.tipo} · ${td.mes}`;
  if (type === "PESSOAL") return `${td.sub} · ${td.mes}`;
  const primeiro = items[0]?.name || "";
  const resto = items.length > 1 ? ` + ${items.length - 1} ${items.length === 2 ? "item" : "itens"}` : "";
  const base = `${primeiro}${resto}`;
  return (type === "FROTA" && td.viatura ? `${td.viatura} · ${base}` : base).slice(0, 240);
}

async function buildPedidoPayload() {
  const user = getSessionUser();
  const requestedByName = val("ccPedidoSolicitante") || user?.name || user?.email || "";
  if (!requestedByName) {
    notify("Não foi possível saber quem pede: entre de novo na aplicação.", "error");
    return null;
  }
  let type = currentRequestType();
  const comItens = typeHasItems(type);
  const fm = comItens && $("ccPedidoModo")?.value === "FM";

  if (comItens && !$("ccPedidoModo")?.value) {
    notify("Escolha o tipo de pagamento (PF ou TRF INT).", "error");
    return null;
  }
  if (comItens && !fm && !$("rqCotSel")?.value) {
    notify("Diga se a requisição requer cotação.", "error");
    return null;
  }
  const requiresQuote = comItens && !fm && $("rqCotSel").value === "S";

  const items = comItens ? collectItems() : [];
  if (comItens && !items.length) {
    notify("Adicione pelo menos um item, com descrição e quantidade.", "error");
    return null;
  }
  if (fm && items.some((it) => !it.lineSupplierName)) {
    notify("No fundo de maneio, indique o fornecedor de cada item.", "error");
    return null;
  }
  const pettyCashFundId = fm ? val("ccPedidoFundId") : "";
  if (fm && !pettyCashFundId) {
    notify("Escolha a conta do fundo de maneio.", "error");
    return null;
  }

  const typeData = { ...collectTypeData(type), dataPedido: dataPedido(), ...(ST.movimento ? { movimentoId: ST.movimento.id } : {}) };
  const falta = missingTypeData(type, typeData);
  if (falta) {
    notify(falta, "error");
    return null;
  }

  // Terceiro: obrigatório no pagamento a fornecedor sem cotação.
  let supplierId = null;
  let supplierName = null;
  if (comItens && !fm) {
    supplierId = val("ccExtraSupplierId") || null;
    supplierName = val("ccExtraSupplierName") || val("rqTerceiro") || null;
    const nif = normalizeNif(val("ccExtraSupplierNif"));
    const validado = $("ccExtraSupplierNif")?.dataset?.validatedNif || "";
    if (!requiresQuote) {
      if (!supplierId && !(nif && validado === nif && supplierName) && !GEN_RE.test(supplierName || "")) {
        notify("Escolha o terceiro na lista, ou use «+ Criar terceiro» e consulte o NIF.", "error");
        return null;
      }
      if (GEN_RE.test(supplierName || "")) {
        const benef = val("rqBenefNome").toUpperCase();
        if (!benef) {
          notify("No terceiro genérico, indique o Beneficiário da conta (titular do IBAN).", "error");
          return null;
        }
        typeData.benefNome = benef;
      }
    } else if (!supplierId) {
      supplierName = null; // com cotação, as Compras escolhem o fornecedor
    }
  }

  // Centros de custo (Geral / Obra).
  let projectId = null;
  let costCenterId = null;
  if (isGO(type)) {
    const r = lerCentros();
    if (r.erro) {
      notify(r.erro, "error");
      return null;
    }
    typeData.centros = r.centros;
    projectId = r.projectId;
    type = projectId ? "OBRA" : "SEDE";
    if (projectId) costCenterId = (await loadCostCentersForProject(projectId, val("ccExtraCostCenterId"))) || null;
  }

  // Condições de pagamento (vindo do extrato: já pago, na data do movimento).
  if (ST.movimento) $("ccPedidoDataPretendida").value = String(ST.movimento.movementDate).slice(0, 10);
  const paymentTerm = type === "EMPRESTIMO" || fm || ST.movimento ? "PRONTO" : $("ccPedidoCondicao")?.value || "PRONTO";
  let dueDate = null;
  let creditDays = null;
  if (type === "EMPRESTIMO") dueDate = typeData.limite;
  else if (paymentTerm === "PRONTO") {
    dueDate = val("ccPedidoDataPretendida");
    if (!dueDate) {
      notify("Indique a data limite de pagamento.", "error");
      return null;
    }
  } else if (paymentTerm === "CREDITO") {
    dueDate = val("rqVencimento");
    if (!dueDate) {
      notify("Indique a data de vencimento do crédito.", "error");
      return null;
    }
    const d = val("ccPedidoDiasCredito");
    creditDays = d === "" ? Math.max(0, Math.round((new Date(`${dueDate}T12:00:00`) - new Date(`${dataPedido()}T12:00:00`)) / 86400000)) : Math.round(N(d));
  } else {
    if (ST.parcelas.length < 2 || ST.parcelas.some((p) => !p.data)) {
      notify("Indique a data de cada parcela.", "error");
      return null;
    }
    const T = totalAPagar();
    const S = ST.parcelas.reduce((a, p) => a + N(p.valor), 0);
    if (T > 0 && Math.abs(S - T) > 0.5) {
      notify(`As parcelas somam ${fmt(S)} e o total a pagar é ${fmt(T)}.`, "error");
      return null;
    }
    typeData.parcelas = ST.parcelas.map((p) => ({ data: p.data, valor: N(p.valor) }));
    dueDate = ST.parcelas[0].data;
  }

  const notes = [
    val("ccPedidoJust"),
    type === "FROTA" ? `Natureza: ${typeData.natureza}` : null,
    comItens && !fm && val("ccExtraSupplierIban") ? `IBAN fornecedor: ${val("ccExtraSupplierIban")}` : null,
    comItens && !fm && val("rqTercBanco") ? `Banco: ${val("rqTercBanco")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    type: "PEDIDO",
    priority: val("ccPedidoPriority") || "NORMAL",
    requestedByName,
    requestedById: user?.id || user?.sub || null,
    description: descricaoAuto(type, items, typeData) || "Requisição de pagamento",
    justification: val("ccPedidoJust") || null,
    needDate: val("ccPedidoData") || null,
    requiresQuote,
    projectId,
    costCenterId,
    supplierId,
    supplierName,
    currency: val("ccPedidoMoeda") || "AOA",
    notes: notes || null,
    items,
    requestType: type,
    paymentMode: fm ? "FM" : "FORN",
    pettyCashFundId: pettyCashFundId || null,
    typeData,
    paymentTerm,
    creditDays,
    dueDate: dueDate || null,
  };
}

export async function savePedido() {
  const payload = await buildPedidoPayload();
  if (!payload) return null;

  const extraId = val("ccPedidoExtraId");
  if (extraId) {
    const items = (payload.items || []).map((it) => ({
      description: it.name,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
      notes: it.notes,
    }));
    const amount = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
    const saved = await apiRequest(`/extra-requests/${extraId}`, {
      method: "PATCH",
      body: {
        description: payload.description,
        notes: payload.justification,
        amount,
        priority: payload.priority,
        requestedBy: payload.requestedByName,
        desiredDate: payload.needDate,
        paymentDueDate: payload.dueDate || payload.needDate,
        requiresQuote: payload.requiresQuote,
        supplierId: payload.supplierId,
        supplierName: payload.supplierName,
        items,
      },
    });
    return { saved, isEdit: true, requiresQuote: payload.requiresQuote };
  }

  const editId = val("ccPedidoEditId");
  const saved = editId
    ? await apiRequest(`/purchase-orders/${editId}`, { method: "PATCH", body: payload })
    : await apiRequest("/purchase-orders", { method: "POST", body: payload });
  return { saved, isEdit: Boolean(editId), requiresQuote: payload.requiresQuote };
}

// ── Anexos ──────────────────────────────────────────────────

export async function uploadPedidoAttachment(orderId, file) {
  return apiUpload(`/purchase-orders/${orderId}/requisition/upload`, { file, fieldName: "file" });
}

// ── Ciclo de vida ───────────────────────────────────────────

function cabecalho(order = null) {
  const user = getSessionUser();
  const por = order?.requestedByName || val("ccPedidoSolicitante") || user?.name || "—";
  $("rqKicker").textContent = order ? "REQUISIÇÃO DE PAGAMENTO" : "NOVA REQUISIÇÃO DE PAGAMENTO";
  $("rqSub").textContent = order?.number ? `N.º ${order.number} · pedido por ${por}` : `N.º atribuído ao submeter · pedido por ${por}`;
}

export function resetPedidoForm() {
  $("formNovoPedido")?.reset();
  IMPOSTO_OBRIGACAO = null;
  $("ccPedidoEditId").value = "";
  $("ccPedidoExtraId").value = "";
  $("ccPedidoType").value = "SEDE";
  $("ccPedidoModo").value = "";
  $("rqCotSel").value = "";
  $("rqDataPedido").value = hoje();
  $("ccPedidoCondicao").value = "PRONTO";
  $("ccItemsBody").innerHTML = "";
  $("ccPessoalBody").innerHTML = "";
  ST.dist = [{ cc: "", pct: 100, val: "" }];
  ST.distM = "pct";
  ST.parcelas = [];
  ST.lockProject = false;
  setMais(false);
  modoCriarTerceiro(false);
  cabecalho();
  applyTypeVisibility();
  renderDist();
}

/** Preenche o formulário com um pedido existente. */
export async function fillPedidoForm(order, { extra = false } = {}) {
  $("ccPedidoExtraId").value = extra ? order.id || "" : "";
  $("ccPedidoEditId").value = extra ? "" : order.id || "";
  $("ccPedidoPriority").value = order.priority || "NORMAL";
  $("ccPedidoSolicitante").value = order.requestedByName || "";
  $("ccPedidoData").value = toDateInput(order.needDate);
  $("ccPedidoDesc").value = order.description || "";
  $("ccPedidoJust").value = order.justification || "";
  $("ccPedidoMoeda").value = ["AOA", "USD", "EUR"].includes(order.currency) ? order.currency : "AOA";
  $("rqDataPedido").value = toDateInput(order.typeData?.dataPedido || order.createdAt) || hoje();

  let type = order.requestType || (order.projectId ? "OBRA" : "SEDE");
  if (extra && !typeHasItems(type)) type = "OBRA";
  $("ccPedidoType").value = type;

  $("ccPedidoModo").value = order.paymentMode === "FM" ? "FM" : "FORN";
  $("rqCotSel").value = order.requiresQuote ? "S" : "N";

  await ensureReferenceDataLoaded();
  fillTypeData(order);

  // Centros de custo: a repartição gravada, ou a obra / sede do pedido antigo.
  const centros = Array.isArray(order.typeData?.centros) ? order.typeData.centros : [];
  if (centros.length) {
    const temValor = centros.some((c) => c.pct == null);
    ST.distM = temValor ? "val" : "pct";
    ST.dist = centros.map((c) => ({ cc: c.tipo === "SEDE" ? "SEDE" : c.projectId, pct: c.pct ?? "", val: c.valor ?? "" }));
  } else {
    ST.dist = [{ cc: order.projectId || "SEDE", pct: 100, val: "" }];
  }
  $("rqDistModo")?.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.m === ST.distM));
  if (order.projectId) await loadCostCentersForProject(order.projectId, order.costCenterId || "");

  // Condições.
  $("ccPedidoCondicao").value = order.paymentTerm || "PRONTO";
  $("ccPedidoDiasCredito").value = order.creditDays != null ? order.creditDays : "";
  if (order.paymentTerm === "CREDITO") $("rqVencimento").value = toDateInput(order.dueDate);
  else $("ccPedidoDataPretendida").value = toDateInput(order.dueDate);
  const inst = order.paymentPlan?.installments || [];
  const parc = Array.isArray(order.typeData?.parcelas) && order.typeData.parcelas.length
    ? order.typeData.parcelas
    : inst.map((i) => ({ data: toDateInput(i.dueDate), valor: Number(i.amount) }));
  ST.parcelas = parc.map((p) => ({ data: toDateInput(p.data), valor: p.valor ?? "" }));
  if (ST.parcelas.length >= 2) $("ccPedidoPrestacoes").value = ST.parcelas.length;

  const fund = $("ccPedidoFundId");
  if (fund && order.pettyCashFundId) fund.value = order.pettyCashFundId;

  // Terceiro.
  if (order.supplierId || order.supplierName) {
    const s = cache.suppliers.find((x) => x.id === order.supplierId) || order.supplier || { id: order.supplierId || "", name: order.supplierName };
    escolherTerceiro(s);
    const iban = String(order.notes || "").match(/IBAN fornecedor:\s*(\S+)/);
    const banco = String(order.notes || "").match(/Banco:\s*(.+)/);
    if (iban && !val("ccExtraSupplierIban")) $("ccExtraSupplierIban").value = iban[1];
    if (banco && !val("rqTercBanco")) $("rqTercBanco").value = banco[1].trim();
  }
  if ($("rqBenefNome")) $("rqBenefNome").value = order.typeData?.benefNome || "";

  fillItemRows(order.items || []);
  cabecalho(extra ? null : order);
  applyTypeVisibility();
  renderDist();
  return order;
}

/** O pedido que se está a criar a partir de um movimento do extrato (ou null). */
export function movimentoDoPedido() {
  return ST.movimento;
}

/**
 * «Registar o Pagamento e Conciliar» (T2): o formulário a partir de uma saída
 * do extrato — o valor numa linha, a descrição nas observações, Sede a 100 %,
 * pagamento a fornecedor sem cotação, pronto na data do movimento. Ao
 * submeter, o pedido fica pago e conciliado com o movimento.
 */
export function aplicarMovimento(m) {
  ST.movimento = m;
  const data = String(m.movementDate || "").slice(0, 10);
  const conta = m.card ? [m.card.bank, m.card.label].filter(Boolean).join(" ") : "";
  $("formNovoPedido")?.classList.add("rq-mov");
  const info = $("rqMovInfo");
  if (info) {
    info.textContent = `Pago a ${data.split("-").reverse().join("/")} · já sai do banco, fica pago e conciliado`;
    info.classList.remove("hidden");
  }
  $("ccPedidoType").value = "SEDE";
  $("ccPedidoModo").value = "FORN";
  $("rqCotSel").value = "N";
  $("ccPedidoCondicao").value = "PRONTO";
  $("ccPedidoDataPretendida").value = data;
  $("rqDataPedido").value = data;
  $("ccPedidoJust").value = `Criado a partir do movimento bancário de ${data.split("-").reverse().join("/")}${conta ? ` (${conta})` : ""}: ${m.description || ""}`.trim();
  fillItemRows([{ name: "", quantity: 1, unitPrice: Number(m.amount) || 0, vatPercent: 0 }]);
  ST.dist = [{ cc: "SEDE", pct: 100, val: "" }];
  const t = $("rqDocsTitulo");
  if (t) t.innerHTML = 'Comprovativo de pagamento <b class="rq-req">*</b>';
  const txt = $("rqDocsTexto");
  if (txt) txt.textContent = "Anexe o comprovativo do pagamento (obrigatório). A fatura também pode ir aqui.";
  const sb = document.querySelector("#btnSubmitNovoPedido .pf-btn-label");
  if (sb) sb.textContent = "Registar o pagamento e conciliar";
  applyTypeVisibility();
  renderDist();
}

/** Liga os eventos do formulário. Chamar uma única vez por página. */
export function initPurchaseOrderForm({ showToast, apiError } = {}) {
  if (showToast) notify = showToast;
  if (apiError) describeError = apiError;

  $("rqTipoSeg")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tipo]");
    if (!b || b.disabled) return;
    const k = b.dataset.tipo;
    $("ccPedidoType").value = k === "GO" ? (isGO(currentRequestType()) ? currentRequestType() : "SEDE") : k;
    applyTypeVisibility();
  });
  $("ccPedidoModo")?.addEventListener("change", applyPaymentModeVisibility);
  $("rqCotSel")?.addEventListener("change", applyQuoteRequirementVisibility);
  $("ccPedidoMoeda")?.addEventListener("change", () => {
    document.querySelectorAll(".rq-moeda").forEach((el) => (el.textContent = val("ccPedidoMoeda") || "AOA"));
  });
  $("rqDataPedido")?.addEventListener("change", () => {
    if ($("ccPedidoCondicao").value === "CREDITO" && val("ccPedidoDiasCredito") !== "") {
      $("rqVencimento").value = maisDias(dataPedido(), N(val("ccPedidoDiasCredito")));
    }
  });
  $("rqMaisBtn")?.addEventListener("click", () => setMais(!ST.mais));
  $("btnCCAddItem")?.addEventListener("click", () => addItemRow());
  $("ccItemsTable")?.addEventListener("input", refreshTotals);
  $("ccItemsTable")?.addEventListener("change", refreshTotals);
  $("btnCCAddPessoa")?.addEventListener("click", () => addPersonRow());
  $("ccPessoalTable")?.addEventListener("input", refreshPessoalTotal);
  $("rqCriarProduto")?.addEventListener("click", () => abrirNovoProduto(null));
  $("rqNpGravar")?.addEventListener("click", gravarNovoProduto);
  $("rqNpCancelar")?.addEventListener("click", () => show("rqNovoProduto", false));
  $("rqCriarTerceiro")?.addEventListener("click", () => modoCriarTerceiro(!ST.criarTerceiro));

  bindSuggest($("rqTerceiro"), $("rqTerceiroSug"), { search: procurarTerceiros, pick: escolherTerceiro });
  bindSuggest($("ccEmpPor"), $("rqEmpSug"), {
    search: procurarTerceiros,
    pick: (s) => {
      $("ccEmpPor").value = s.name || "";
      const { iban } = contaDe(s);
      if (iban) $("ccEmpIban").value = iban;
    },
  });
  bindSupplierNifLookup();
  bindDist();
  bindCondicoes();
}
