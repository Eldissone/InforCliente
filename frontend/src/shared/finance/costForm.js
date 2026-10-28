import { apiRequest } from "../../services/api.js";
import { openModal, toast, setButtonLoading } from "../ui.js";
import { formatCurrency, toDateKey } from "../format.js";
import { escapeFinanceHtml as esc } from "../financePage.js";
import { meterHtml } from "./widgets.js";

/**
 * «Associar e Confirmar Custo» — formulário partilhado.
 *
 *  - Novo Custo (Registar Custos): lançamento manual de uma despesa que não
 *    nasce noutras áreas (rendas, serviços pontuais, pagamentos ao balcão).
 *  - A partir de um movimento do extrato (Tesouraria ou levantamento ATM):
 *    cria o(s) custo(s) da obra ou liga o movimento a um pagamento já
 *    registado, sem o duplicar. Um pagamento múltiplo / ATM discrimina-se em
 *    itens e a soma tem de bater com o valor do movimento.
 *
 * Regras: mercadoria não se associa (o custo nasce na saída de stock para a
 * obra) e confirmar o custo exige o nº da fatura.
 */

export const COST_TYPES = {
  SERVICO: "Serviço",
  MATERIAL: "Material",
  MAO_DE_OBRA: "Mão de obra",
  EQUIPAMENTO: "Equipamento",
  TRANSPORTE: "Transporte",
  ADMINISTRATIVO: "Administrativo",
  OUTRO: "Outro",
};

const MOVEMENT_LABEL = {
  PF: "Pagamento fornecedor",
  LEVANTAMENTO_ATM: "Levantamento ATM",
  REEMBOLSO: "Reembolso",
  OUTRO: "Outro",
};

const NON_COST_MOVEMENTS = new Set(["RECEBIMENTO_CLIENTE", "TRANSFERENCIA_INTERNA", "OPERACAO_ANULADA"]);

const PAYMENT_METHODS = ["Banco", "Transferência", "Caixa", "Cheque", "Multicaixa"];

function money(value, currency) {
  return formatCurrency(Number(value) || 0, currency || "AOA");
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dateOnly(value) {
  const key = toDateKey(value);
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** Saídas de valores ainda sem custo (as únicas que podem ser associadas). */
export function isAssignableMovement(m) {
  return Boolean(m) && m.direction === "SAIDA" && !m.costAssigned && !NON_COST_MOVEMENTS.has(m.movementType);
}

/** Obras, fornecedores e catálogo de categorias (e, se pedido, movimentos por associar). */
export async function loadCostFormOptions({ withMovements = false } = {}) {
  const [projects, suppliers, categories, movements] = await Promise.all([
    apiRequest("/finance/options/projects"),
    apiRequest("/finance/options/suppliers"),
    apiRequest("/finance/options/cost-categories"),
    withMovements ? apiRequest("/finance/bank-movements?costAssigned=false") : Promise.resolve({ items: [] }),
  ]);
  return {
    projects: projects.items || [],
    suppliers: suppliers.items || [],
    categories: categories.items || [],
    movements: (movements.items || []).filter(isAssignableMovement),
  };
}

/* ─── Catálogo: Categoria (topo) › Subcategoria (ramo selecionável) ──────── */

function categoryTree(categories) {
  const byId = new Map(categories.map((c) => [String(c.id), c]));
  const rootOf = (c) => {
    let node = c;
    while (node?.parentId && byId.has(String(node.parentId))) node = byId.get(String(node.parentId));
    return node;
  };
  const pathBelowRoot = (c) => {
    const names = [];
    let node = c;
    while (node && node.parentId) {
      names.unshift(node.name);
      node = byId.get(String(node.parentId));
    }
    return names.join(" › ");
  };
  return {
    roots: categories.filter((c) => !c.parentId),
    byId,
    subsOf: (rootId) =>
      categories
        .filter((c) => c.parentId && c.isSelectable !== false && String(rootOf(c)?.id) === String(rootId))
        .map((c) => ({ id: c.id, label: pathBelowRoot(c) }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt")),
  };
}

/* ─── Formulário ──────────────────────────────────────────────────────────── */

function stepTitle(n, title, sub = "") {
  return `
    <div class="inv-step">
      <span class="inv-step-n">${n}</span>
      <div>
        <p class="inv-step-title">${esc(title)}</p>
        ${sub ? `<p class="inv-step-sub">${esc(sub)}</p>` : ""}
      </div>
    </div>`;
}

function itemRowHtml(index, { multi, suppliers, roots }) {
  return `
    <div class="cf-item">
      <div class="cf-item-head">
        <span class="cf-item-n">Item ${index + 1}</span>
        <button type="button" class="cf-item-remove" data-remove title="Remover item"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field finance-field--full">
          <label class="finance-label">Produto / Serviço <span class="inv-req">*</span></label>
          <input class="finance-input" data-f="description" type="text" placeholder="Ex.: Aluguer de máquina" />
        </div>
        <div class="finance-field">
          <label class="finance-label">Tipo custo</label>
          <select class="finance-select" data-f="category">
            ${Object.entries(COST_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label">Valor <span class="inv-req">*</span></label>
          <input class="finance-input" data-f="amount" type="number" min="0" step="0.01" placeholder="0,00" />
        </div>
        <div class="finance-field">
          <label class="finance-label">Categoria</label>
          <select class="finance-select" data-f="root">
            <option value="">—</option>
            ${roots.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}
          </select>
        </div>
        <div class="finance-field">
          <label class="finance-label">Subcategoria</label>
          <select class="finance-select" data-f="sub" disabled><option value="">Escolha a categoria</option></select>
        </div>
        ${
          multi
            ? `<div class="finance-field">
                 <label class="finance-label">Fornecedor do item</label>
                 <select class="finance-select" data-f="supplierId">
                   <option value="">Igual ao fornecedor geral</option>
                   ${suppliers.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}
                 </select>
               </div>
               <div class="finance-field">
                 <label class="finance-label">Nº fatura do item</label>
                 <input class="finance-input" data-f="docNumber" type="text" placeholder="Igual ao nº geral" />
               </div>`
            : ""
        }
      </div>
    </div>`;
}

function movementCardHtml(m) {
  return `
    <div class="cf-movement">
      <span class="material-symbols-outlined">${m.movementType === "LEVANTAMENTO_ATM" ? "atm" : "account_balance"}</span>
      <div>
        <strong>${esc(m.description || MOVEMENT_LABEL[m.movementType] || "Movimento")}</strong>
        <small>${esc([dateOnly(m.movementDate), MOVEMENT_LABEL[m.movementType] || m.movementType, m.card?.label].filter(Boolean).join(" · "))}</small>
      </div>
      <span class="cf-movement-value">${esc(money(m.amount))}</span>
    </div>`;
}

/**
 * Abre o formulário. Com `movement` associa esse movimento do extrato; sem ele
 * é um lançamento manual.
 */
export function openCostForm({ movement = null, options, onSaved } = {}) {
  if (movement?.isMerchandise) {
    toast("Mercadoria: o custo é gerado pela saída/consumo de stock na obra, não por associação direta.", { type: "error" });
    return;
  }
  const { projects, suppliers, categories } = options;
  const tree = categoryTree(categories);
  const m = movement;
  const today = toDateKey(new Date());

  const content = `
    <div class="inv-form">
      <div class="inv-form-main">
        <section class="inv-section">
          ${stepTitle(1, "Classificação", m ? "Movimento do extrato e obra a que o custo pertence" : "Obra e centro de custo a que a despesa pertence")}
          ${m ? movementCardHtml(m) : ""}
          <div id="cf_candidates" class="cf-candidates" hidden></div>
          <div class="finance-form-grid finance-form-grid--2" id="cf_classFields">
            <div class="finance-field">
              <label class="finance-label" for="cf_project">Obra <span class="inv-req">*</span></label>
              <select id="cf_project" class="finance-select">
                <option value="">Selecionar obra…</option>
                ${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.code ? `${p.code} · ${p.name}` : p.name)}</option>`).join("")}
              </select>
            </div>
            <div class="finance-field">
              <label class="finance-label" for="cf_center">Centro de custo <span class="inv-req">*</span></label>
              <select id="cf_center" class="finance-select" disabled><option value="">Escolha primeiro a obra</option></select>
            </div>
            <div class="finance-field finance-field--full">
              <label class="finance-label" for="cf_supplier">Fornecedor</label>
              <select id="cf_supplier" class="finance-select">
                <option value="">Selecionar fornecedor</option>
                ${suppliers.map((s) => `<option value="${esc(s.id)}">${esc(s.nif ? `${s.name} · NIF ${s.nif}` : s.name)}</option>`).join("")}
              </select>
            </div>
          </div>
        </section>

        <section class="inv-section" id="cf_itemsSection">
          <div class="cf-section-head">
            ${stepTitle(2, "Produto / Serviço", "Tipo de custo e categoria/subcategoria do catálogo")}
            ${
              m
                ? `<button type="button" id="cf_split" class="inv-link-btn">
                     <span class="material-symbols-outlined">call_split</span><span id="cf_splitLabel">Discriminar em vários itens</span>
                   </button>`
                : ""
            }
          </div>
          <div id="cf_items" class="cf-items"></div>
          <button type="button" id="cf_addItem" class="cf-add" hidden>
            <span class="material-symbols-outlined">add</span>Adicionar item
          </button>
        </section>

        <section class="inv-section" id="cf_docSection">
          ${stepTitle(3, m ? "Documento" : "Documento e pagamento")}
          <div class="finance-form-grid finance-form-grid--2">
            <div class="finance-field">
              <label class="finance-label" for="cf_doc">Nº fatura</label>
              <input id="cf_doc" class="finance-input" type="text" placeholder="Por preencher" value="${esc(m?.docNumber || "")}" />
            </div>
            <div class="finance-field">
              <label class="finance-label" for="cf_date">Data</label>
              <input id="cf_date" class="finance-input" type="date" value="${esc(m ? toDateKey(m.movementDate) || today : today)}" ${m ? "disabled" : ""} />
            </div>
            ${
              m
                ? ""
                : `<div class="finance-field">
                     <label class="finance-label" for="cf_paid">Valor pago</label>
                     <input id="cf_paid" class="finance-input" type="number" min="0" step="0.01" placeholder="0,00" />
                     <div class="inv-quick">
                       <button type="button" data-paid="all">Tudo pago</button>
                       <button type="button" data-paid="none">Nada pago</button>
                     </div>
                   </div>
                   <div class="finance-field">
                     <label class="finance-label" for="cf_method">Meio de pagamento</label>
                     <select id="cf_method" class="finance-select">
                       <option value="">—</option>
                       ${PAYMENT_METHODS.map((x) => `<option value="${x}">${x}</option>`).join("")}
                     </select>
                   </div>`
            }
          </div>
        </section>

        <section class="inv-section">
          ${stepTitle(4, "Confirmação e notas do processo")}
          <label class="cf-confirm">
            <span class="inv-switch"><input id="cf_confirm" type="checkbox" /><span></span></span>
            <span>
              <strong>Confirmar custo</strong>
              <small id="cf_confirmHint">Exige o nº da fatura. Sem confirmação o custo fica «por confirmar».</small>
            </span>
          </label>
          <textarea id="cf_notes" class="finance-textarea" rows="3" placeholder="Notas do processo: quem acompanha, documentos em falta, observações…"></textarea>
        </section>
      </div>

      <aside class="inv-form-aside">
        <div class="inv-summary">
          <p class="inv-summary-title">Resumo do custo</p>
          <dl class="inv-summary-lines">
            <div><dt>Origem</dt><dd id="cfs_origin">—</dd></div>
            <div><dt>Obra</dt><dd id="cfs_project">—</dd></div>
            <div><dt>Itens</dt><dd id="cfs_items">—</dd></div>
          </dl>
          <div class="inv-summary-net">
            <span id="cfs_totalLabel">Valor do custo</span>
            <strong id="cfs_total">—</strong>
          </div>
          <div class="inv-summary-work" id="cfs_splitBox" hidden>
            <div class="inv-summary-work-head"><span>Discriminado</span><strong id="cfs_splitPct">—</strong></div>
            <div id="cfs_splitBar"></div>
            <p class="inv-summary-note" id="cfs_splitNote">—</p>
          </div>
          <div class="inv-summary-receipt">
            <div><span>Estado</span><strong id="cfs_state">Por confirmar</strong></div>
            <div><span>Fica por pagar</span><strong id="cfs_remaining">—</strong></div>
          </div>
        </div>
      </aside>
    </div>`;

  /** Lê os itens do formulário. */
  const readItems = (panel) =>
    [...panel.querySelectorAll(".cf-item")].map((row) => {
      const get = (f) => row.querySelector(`[data-f="${f}"]`);
      const root = get("root").value;
      const sub = get("sub").value;
      const rootNode = root ? tree.byId.get(String(root)) : null;
      const hasSubs = root ? tree.subsOf(root).length > 0 : false;
      return {
        row,
        description: get("description").value.trim(),
        category: get("category").value,
        amount: round2(get("amount").value),
        // Subcategoria escolhida; senão a própria categoria, se for selecionável.
        costCategoryId: sub ? Number(sub) : rootNode && rootNode.isSelectable !== false ? Number(root) : null,
        needsSub: Boolean(root) && !sub && hasSubs && rootNode?.isSelectable === false,
        supplierId: get("supplierId")?.value || null,
        docNumber: get("docNumber")?.value.trim() || null,
      };
    });

  openModal({
    title: m ? "Associar e Confirmar Custo" : "Novo Custo",
    contentHtml: content,
    primaryLabel: m ? "Associar custo" : "Guardar custo",
    width: 1080,
    onRender: ({ panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const state = { multi: false, linkCostId: null, centersReq: 0, paidTouched: false };
      panel.__cf = state;

      const total = () => round2(readItems(panel).reduce((a, i) => a + i.amount, 0));

      const wireItem = (row) => {
        const rootSel = row.querySelector('[data-f="root"]');
        const subSel = row.querySelector('[data-f="sub"]');
        rootSel.addEventListener("change", () => {
          const subs = rootSel.value ? tree.subsOf(rootSel.value) : [];
          const rootNode = tree.byId.get(String(rootSel.value));
          const optional = rootNode?.isSelectable !== false;
          subSel.innerHTML = subs.length
            ? `<option value="">${optional ? "— (opcional)" : "Selecionar subcategoria…"}</option>` +
              subs.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("")
            : `<option value="">${rootSel.value ? "Sem subcategorias" : "Escolha a categoria"}</option>`;
          subSel.disabled = !subs.length;
        });
        row.querySelectorAll("input").forEach((el) => el.addEventListener("input", refresh));
        row.querySelectorAll("select").forEach((el) => el.addEventListener("change", refresh));
        row.querySelector("[data-remove]").addEventListener("click", () => {
          row.remove();
          // Com um só item volta ao modo simples.
          if (panel.querySelectorAll(".cf-item").length < 2) {
            state.multi = false;
            renderItems();
          } else {
            renumber();
          }
          refresh();
        });
      };

      const renumber = () => {
        panel.querySelectorAll(".cf-item").forEach((row, i) => {
          row.querySelector(".cf-item-n").textContent = `Item ${i + 1}`;
        });
      };

      /** Redesenha os itens mantendo o que já foi escrito. */
      const renderItems = () => {
        const previous = readItems(panel).map((p) => ({
          ...p,
          root: p.row.querySelector('[data-f="root"]').value,
          sub: p.row.querySelector('[data-f="sub"]').value,
        }));
        const wrap = $("cf_items");
        const count = state.multi ? Math.max(2, previous.length) : 1;
        wrap.innerHTML = Array.from({ length: count }, (_, i) => itemRowHtml(i, { multi: state.multi, suppliers, roots: tree.roots })).join("");
        wrap.querySelectorAll(".cf-item").forEach((row, i) => {
          wireItem(row);
          const prev = previous[i];
          if (!prev) return;
          row.querySelector('[data-f="description"]').value = prev.description;
          row.querySelector('[data-f="category"]').value = prev.category;
          if (prev.root) {
            const rootSel = row.querySelector('[data-f="root"]');
            rootSel.value = prev.root;
            rootSel.dispatchEvent(new Event("change"));
            row.querySelector('[data-f="sub"]').value = prev.sub;
          }
          if (prev.amount) row.querySelector('[data-f="amount"]').value = prev.amount;
        });
        // Um só item: o valor é o do movimento.
        if (m && !state.multi) wrap.querySelector('[data-f="amount"]').value = round2(m.amount);
        $("cf_addItem").hidden = !state.multi;
        if ($("cf_splitLabel")) $("cf_splitLabel").textContent = state.multi ? "Um só item" : "Discriminar em vários itens";
      };

      const loadCenters = async () => {
        const projectId = $("cf_project").value;
        const sel = $("cf_center");
        const req = ++state.centersReq;
        sel.innerHTML = `<option value="">${projectId ? "A carregar…" : "Escolha primeiro a obra"}</option>`;
        sel.disabled = true;
        if (!projectId) return;
        try {
          const data = await apiRequest(`/finance/options/cost-centers?projectId=${encodeURIComponent(projectId)}`);
          if (req !== state.centersReq) return;
          const centers = data.items || [];
          sel.innerHTML = centers.length
            ? (centers.length > 1 ? `<option value="">Selecionar centro de custo…</option>` : "") +
              centers.map((c) => `<option value="${esc(c.id)}">${esc(`${c.code} · ${c.name}`)}</option>`).join("")
            : `<option value="">A obra não tem centros de custo ativos</option>`;
          sel.disabled = !centers.length;
        } catch (err) {
          if (req === state.centersReq) sel.innerHTML = `<option value="">${esc(err.message || "Falha ao carregar")}</option>`;
        }
      };

      /** Pagamentos já registados com o mesmo valor: ligar em vez de duplicar. */
      const loadCandidates = async () => {
        if (!m) return;
        const box = $("cf_candidates");
        try {
          const data = await apiRequest(`/finance/bank-movements/${m.id}/link-candidates`);
          const list = data.items || [];
          if (!list.length) return;
          box.hidden = false;
          box.innerHTML = `
            <p class="cf-candidates-title">
              <span class="material-symbols-outlined">join_inner</span>
              Já há ${list.length === 1 ? "um pagamento registado" : "pagamentos registados"} com este valor. Se for o mesmo, ligue-o em vez de criar outro custo.
            </p>
            ${list
              .map(
                (c) => `
              <button type="button" class="cf-candidate" data-link="${esc(c.id)}">
                <span class="material-symbols-outlined">link</span>
                <span class="cf-candidate-text">
                  <strong>${esc(c.description || "Pagamento")}</strong>
                  <small>${esc([c.project?.name, c.supplier, c.docNumber, dateOnly(c.date)].filter(Boolean).join(" · "))}${c.daysApart ? ` · ${c.daysApart} dias de diferença` : ""}</small>
                </span>
                <span class="inv-am-value">${esc(money(c.amount))}</span>
              </button>`
              )
              .join("")}`;
          box.querySelectorAll("[data-link]").forEach((btn) => {
            btn.addEventListener("click", () => {
              state.linkCostId = state.linkCostId === btn.dataset.link ? null : btn.dataset.link;
              box.querySelectorAll("[data-link]").forEach((b) => b.classList.toggle("active", b.dataset.link === state.linkCostId));
              refresh();
            });
          });
        } catch {
          /* sem sugestões: segue a criação normal */
        }
      };

      function refresh() {
        const items = readItems(panel);
        const sum = round2(items.reduce((a, i) => a + i.amount, 0));
        const linking = Boolean(state.linkCostId);
        const project = projects.find((p) => p.id === $("cf_project").value) || null;
        const currency = project?.currency;

        // A ligar a um pagamento existente, o custo já está classificado.
        $("cf_classFields").classList.toggle("cf-disabled", linking);
        $("cf_itemsSection").classList.toggle("cf-disabled", linking);

        // O valor pago acompanha o total até o utilizador o alterar.
        if (!m && !state.paidTouched) $("cf_paid").value = sum || "";

        $("cfs_origin").textContent = linking ? "Ligar a pagamento existente" : m ? MOVEMENT_LABEL[m.movementType] || "Movimento" : "Lançamento manual";
        $("cfs_project").textContent = project ? project.name : "—";
        $("cfs_project").title = project ? [project.code, project.name].filter(Boolean).join(" · ") : "";
        $("cfs_items").textContent = linking ? "—" : String(items.length);
        $("cfs_totalLabel").textContent = m ? "Valor do movimento" : "Valor do custo";
        $("cfs_total").textContent = money(m ? m.amount : sum, currency);

        const splitBox = $("cfs_splitBox");
        splitBox.hidden = !m || linking || !state.multi;
        if (!splitBox.hidden) {
          const target = round2(m.amount);
          const p = target > 0 ? (sum / target) * 100 : 0;
          const diff = round2(target - sum);
          $("cfs_splitPct").textContent = `${p.toFixed(0)}%`;
          $("cfs_splitBar").innerHTML = meterHtml([{ value: p, tone: Math.abs(diff) <= 0.01 ? "emerald" : diff < 0 ? "red" : "amber" }]);
          $("cfs_splitNote").textContent =
            Math.abs(diff) <= 0.01 ? "Os itens batem com o movimento." : diff > 0 ? `Falta discriminar ${money(diff, currency)}` : `Os itens excedem o movimento em ${money(-diff, currency)}`;
        }

        const paid = m ? sum : Math.min(Number($("cf_paid").value) || 0, sum);
        const remaining = m || linking ? 0 : Math.max(round2(sum - paid), 0);
        $("cfs_remaining").textContent = money(remaining, currency);
        $("cfs_remaining").className = remaining > 0 ? "ov-warn" : "ov-pos";

        const confirm = $("cf_confirm").checked;
        const generalDoc = Boolean($("cf_doc").value.trim());
        const hasDoc = generalDoc || (state.multi && items.every((i) => i.docNumber));
        $("cfs_state").textContent = confirm ? "Confirmado" : "Por confirmar";
        $("cfs_state").className = confirm ? "ov-pos" : "ov-warn";
        const hint = $("cf_confirmHint");
        hint.textContent = confirm && !hasDoc ? "Indique o nº da fatura para confirmar." : "Exige o nº da fatura. Sem confirmação o custo fica «por confirmar».";
        hint.classList.toggle("ov-neg", confirm && !hasDoc);
      }

      // Ligações
      $("cf_project").addEventListener("change", () => {
        loadCenters();
        refresh();
      });
      $("cf_split")?.addEventListener("click", () => {
        state.multi = !state.multi;
        renderItems();
        refresh();
      });
      $("cf_addItem").addEventListener("click", () => {
        const wrap = $("cf_items");
        wrap.insertAdjacentHTML("beforeend", itemRowHtml(wrap.children.length, { multi: true, suppliers, roots: tree.roots }));
        wireItem(wrap.lastElementChild);
        wrap.lastElementChild.querySelector('[data-f="description"]').focus();
        refresh();
      });
      if (!m) {
        $("cf_paid").addEventListener("input", () => {
          state.paidTouched = true;
          refresh();
        });
        panel.querySelectorAll("[data-paid]").forEach((btn) =>
          btn.addEventListener("click", () => {
            state.paidTouched = btn.dataset.paid !== "all";
            $("cf_paid").value = btn.dataset.paid === "all" ? total() || "" : 0;
            refresh();
          })
        );
      }
      $("cf_doc").addEventListener("input", refresh);
      $("cf_confirm").addEventListener("change", refresh);

      // Valores iniciais a partir do movimento.
      if (m?.projectId) $("cf_project").value = m.projectId;
      if (m?.supplierId) $("cf_supplier").value = m.supplierId;
      renderItems();
      if (m?.description) panel.querySelector('[data-f="description"]').value = m.description;
      if ($("cf_project").value) loadCenters();
      loadCandidates();
      refresh();
    },
    onPrimary: async ({ btn, close, panel }) => {
      const $ = (id) => panel.querySelector(`#${id}`);
      const state = panel.__cf;
      const docNumber = $("cf_doc").value.trim() || null;
      const confirm = $("cf_confirm").checked;
      const notes = $("cf_notes").value.trim() || null;

      const send = async (request, okMessage) => {
        setButtonLoading(btn, true);
        try {
          await request();
          toast(okMessage, { type: "success" });
          close();
          onSaved?.();
        } catch (err) {
          toast(err.message || "Falha ao guardar o custo.", { type: "error" });
        } finally {
          setButtonLoading(btn, false);
        }
      };

      // Ligar o movimento a um pagamento já registado (reconciliação).
      if (m && state.linkCostId) {
        if (confirm && !docNumber) {
          $("cf_doc").focus();
          return toast("Indique o nº da fatura para confirmar o custo.", { type: "error" });
        }
        return send(
          () =>
            apiRequest(`/finance/bank-movements/${m.id}/assign-cost`, {
              method: "POST",
              body: { mode: "LINK", linkCostId: state.linkCostId, docNumber, confirm, notes },
            }),
          "Movimento ligado ao pagamento existente."
        );
      }

      const projectId = $("cf_project").value;
      if (!projectId) {
        $("cf_project").focus();
        return toast("Selecione a obra.", { type: "error" });
      }
      if (!$("cf_center").value) {
        $("cf_center").focus();
        return toast("Selecione o centro de custo da obra.", { type: "error" });
      }
      const items = readItems(panel);
      for (const [i, item] of items.entries()) {
        const say = (msg) => (items.length > 1 ? `Item ${i + 1}: ${msg}` : msg.charAt(0).toUpperCase() + msg.slice(1));
        if (item.description.length < 2) {
          item.row.querySelector('[data-f="description"]').focus();
          return toast(say("indique o produto/serviço."), { type: "error" });
        }
        if (!(item.amount > 0)) {
          item.row.querySelector('[data-f="amount"]').focus();
          return toast(say("indique o valor."), { type: "error" });
        }
        if (item.needsSub) {
          item.row.querySelector('[data-f="sub"]').focus();
          return toast(say("escolha a subcategoria."), { type: "error" });
        }
      }
      const sum = round2(items.reduce((a, i) => a + i.amount, 0));
      if (m && Math.abs(sum - round2(m.amount)) > 0.01) {
        return toast(`A soma dos itens (${money(sum)}) tem de ser igual ao movimento (${money(m.amount)}).`, { type: "error" });
      }
      if (confirm && items.some((i) => !(i.docNumber || docNumber))) {
        $("cf_doc").focus();
        return toast("Indique o nº da fatura para confirmar o custo.", { type: "error" });
      }
      const supplierId = $("cf_supplier").value || null;

      if (m) {
        return send(
          () =>
            apiRequest(`/finance/bank-movements/${m.id}/assign-cost`, {
              method: "POST",
              body: {
                mode: "CREATE",
                projectId,
                costCenterId: $("cf_center").value,
                docNumber,
                confirm,
                notes,
                items: items.map((i) => ({
                  description: i.description,
                  category: i.category,
                  costCategoryId: i.costCategoryId,
                  amount: i.amount,
                  supplierId: i.supplierId || supplierId,
                  docNumber: i.docNumber,
                })),
              },
            }),
          items.length > 1 ? `Custo discriminado em ${items.length} itens.` : "Custo associado ao movimento."
        );
      }

      const item = items[0];
      const paidAmount = Math.min(round2($("cf_paid").value), item.amount);
      const method = $("cf_method").value || null;
      if (paidAmount > 0 && !method) {
        $("cf_method").focus();
        return toast("Indique o meio de pagamento do valor pago.", { type: "error" });
      }
      return send(
        () =>
          apiRequest("/finance/costs", {
            method: "POST",
            body: {
              projectId,
              costCenterId: $("cf_center").value,
              supplierId,
              docNumber,
              paymentDate: $("cf_date").value || toDateKey(new Date()),
              category: item.category,
              costCategoryId: item.costCategoryId,
              description: item.description,
              budgetedAmount: item.amount,
              paidAmount,
              paymentMethod: paidAmount > 0 ? method : null,
              paymentType: paidAmount >= item.amount ? "PRONTO_PAGAMENTO" : "CREDITO",
              notes,
              confirm,
            },
          }),
        paidAmount >= item.amount ? "Custo registado e pago." : "Custo registado; o que falta pagar fica nas contas a pagar."
      );
    },
  });
}

/**
 * Registar o nº da fatura e confirmar um custo da lista (pagamento ou consumo
 * de stock). Sem permissão de aprovação só regista o nº da fatura.
 */
export function openConfirmCostModal(cost, { canApprove = false, onSaved } = {}) {
  const cur = cost.currency || cost.project?.currency || "AOA";
  const stock = cost.source === "CONSUMO_STOCK";
  openModal({
    title: canApprove ? "Confirmar custo" : "Registar nº da fatura",
    width: 560,
    contentHtml: `
      <div class="cf-movement">
        <span class="material-symbols-outlined">${stock ? "inventory_2" : "receipt_long"}</span>
        <div>
          <strong>${esc(cost.description || "—")}</strong>
          <small>${esc([cost.project?.name, cost.supplierRef?.name || cost.supplier, cost.sourceLabel].filter(Boolean).join(" · "))}</small>
        </div>
        <span class="cf-movement-value">${esc(money(cost.paidAmount, cur))}</span>
      </div>
      ${stock ? `<p class="finance-note" style="margin:0 0 1rem">Consumo de mercadoria na obra: registe o nº da fatura da <strong>compra</strong> deste material.</p>` : ""}
      <div class="finance-form-grid finance-form-grid--2">
        <div class="finance-field">
          <label class="finance-label" for="cc_doc">Nº fatura <span class="inv-req">*</span></label>
          <input id="cc_doc" class="finance-input" type="text" required value="${esc(cost.docNumber || "")}" placeholder="FT …" />
        </div>
        <div class="finance-field">
          <label class="finance-label" for="cc_resp">Responsável</label>
          <input id="cc_resp" class="finance-input" type="text" value="${esc(cost.responsible || "")}" placeholder="Quem confirma" />
        </div>
      </div>`,
    primaryLabel: canApprove ? "Confirmar custo" : "Guardar nº da fatura",
    onPrimary: async ({ btn, close, panel }) => {
      const docNumber = panel.querySelector("#cc_doc").value.trim();
      const responsible = panel.querySelector("#cc_resp").value.trim() || null;
      if (!docNumber) return toast("Indique o nº da fatura.", { type: "error" });
      setButtonLoading(btn, true);
      try {
        if (canApprove) {
          await apiRequest(`/finance/costs/${cost.id}/confirm`, { method: "POST", body: { docNumber, responsible } });
        } else {
          await apiRequest(`/finance/costs/${cost.id}`, { method: "PATCH", body: { docNumber, responsible } });
        }
        toast(canApprove ? "Custo confirmado." : "Nº da fatura registado.", { type: "success" });
        close();
        onSaved?.();
      } catch (err) {
        toast(err.message || "Falha ao guardar.", { type: "error" });
      } finally {
        setButtonLoading(btn, false);
      }
    },
  });
}
