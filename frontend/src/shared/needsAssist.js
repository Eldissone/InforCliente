import { apiRequest } from "../services/api.js";
import { toast } from "./ui.js";

/**
 * Necessidades assistidas (Fase 3.4).
 * Texto ou foto (lista manuscrita, print) → a IA extrai as linhas → o sistema
 * associa ao catálogo e sugere fornecedor/preço pelo histórico → o utilizador
 * revê e cria as necessidades no centro de custo escolhido.
 */

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const money = (v, cur) => `${Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 2 })} ${esc(cur || "")}`;
const MAX_SIDE = 1600;

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = `
    .na-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px}
    .na-modal{background:#fff;border-radius:18px;max-width:820px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(15,23,42,.3);overflow:hidden}
    .na-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px;background:#212e3e;color:#fff}
    .na-head h2{font-size:17px;font-weight:700;margin:0}
    .na-head p{font-size:12px;color:#cbd5e1;margin:4px 0 0}
    .na-close{margin-left:auto;background:none;border:0;color:#fff;cursor:pointer;padding:4px}
    .na-body{padding:16px 20px;overflow:auto;font-size:14px;color:#0f172a}
    .na-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;padding:12px 20px;border-top:1px solid #e2e8f0}
    .na-text{width:100%;min-height:110px;border:1px solid #cbd5e1;border-radius:12px;padding:10px 12px;font-size:14px;resize:vertical;box-sizing:border-box}
    .na-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
    .na-btn{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;border-radius:12px;padding:8px 14px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer}
    .na-btn.primary{background:#212e3e;border-color:#212e3e;color:#fff}
    .na-btn[disabled]{opacity:.5;cursor:default}
    .na-hint{font-size:12px;color:#64748b;margin:6px 0 0}
    .na-note{font-size:13px;background:#fff7ed;color:#9a3412;border-radius:10px;padding:8px 10px;margin:0 0 10px}
    .na-label{display:block;font-size:11px;font-weight:600;color:#64748b;margin-bottom:3px}
    .na-input,.na-select{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:7px 9px;font-size:13px;box-sizing:border-box;background:#fff}
    .na-item{border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin:10px 0}
    .na-item.off{opacity:.5}
    .na-grid{display:grid;grid-template-columns:2fr 90px 90px 110px;gap:8px;align-items:end}
    @media (max-width:640px){.na-grid{grid-template-columns:1fr 1fr}}
    .na-meta{font-size:12px;color:#475569;margin-top:8px;line-height:1.5}
    .na-chip{display:inline-block;font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px;background:#ecfdf5;color:#047857;margin-right:4px}
    .na-chip.none{background:#f1f5f9;color:#64748b}
    .na-price{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;font-size:13px}
    .na-preview{max-width:100%;max-height:220px;border-radius:10px;border:1px solid #e2e8f0;margin-top:10px}
  `;
  document.head.appendChild(style);
}

function close(state) {
  state.overlay.remove();
  document.removeEventListener("keydown", state.onKey);
}

/** Reduz a foto (máx. 1600 px, JPEG) para enviar menos dados e mais depressa. */
async function readImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", 0.85);
    return { mimeType: "image/jpeg", base64: out.split(",")[1], preview: out };
  } catch {
    // Formato que o navegador não desenha (ex.: HEIC): envia como está.
    return { mimeType: file.type || "image/jpeg", base64: dataUrl.split(",")[1], preview: null };
  }
}

function renderInput(state) {
  const { status } = state;
  state.body.innerHTML = `
    <label class="na-label" for="naText">O que é preciso?</label>
    <textarea id="naText" class="na-text" maxlength="4000" placeholder="Ex.: 20 sacos de cimento, 5 m3 de areia fina, 50 varões de 12 mm — urgente">${esc(state.text || "")}</textarea>
    <div class="na-row">
      <button type="button" class="na-btn primary" data-na-interpret><span class="material-symbols-outlined" style="font-size:18px">auto_awesome</span>Interpretar texto</button>
      ${
        status.photo
          ? `<label class="na-btn" style="cursor:pointer"><span class="material-symbols-outlined" style="font-size:18px">photo_camera</span>Ler foto da lista
              <input type="file" accept="image/*" capture="environment" data-na-photo style="display:none" /></label>`
          : ""
      }
    </div>
    <p class="na-hint">A IA só lê o pedido. O catálogo, os fornecedores e os preços sugeridos vêm do sistema e não são enviados à IA. Nada é criado sem confirmar.</p>`;
  state.foot.innerHTML = "";
}

function itemHtml(it, i) {
  const product = it.product
    ? `<span class="na-chip">Catálogo: ${esc(it.product.name)}</span>`
    : '<span class="na-chip none">Sem correspondência no catálogo</span>';
  const others = it.productOptions?.length > 1 ? ` · outras: ${it.productOptions.slice(1).map((p) => esc(p.name)).join(", ")}` : "";
  const sources = it.priceSources?.length
    ? it.priceSources.map((s) => `${esc(s.label)}: ${money(s.price, s.currency)}${s.supplier ? ` · ${esc(s.supplier)}` : ""}${s.date ? ` · ${esc(s.date)}` : ""}`).join("<br>")
    : "Sem histórico de preços para este material.";
  return `<div class="na-item" data-na-item="${i}">
    <label style="display:flex;gap:8px;align-items:center;font-size:12px;font-weight:600;color:#475569;margin-bottom:8px;cursor:pointer">
      <input type="checkbox" data-na-on checked /> Criar esta necessidade</label>
    <div class="na-grid">
      <div><span class="na-label">Descrição</span><input class="na-input" data-na-desc maxlength="200" value="${esc(it.product?.name && it.product.score >= 0.99 ? it.product.name : it.description)}" /></div>
      <div><span class="na-label">Quantidade</span><input type="number" min="0" step="any" class="na-input" data-na-qty value="${esc(it.quantity ?? "")}" /></div>
      <div><span class="na-label">Unidade</span><input class="na-input" data-na-unit maxlength="20" value="${esc(it.unit ?? "")}" /></div>
      <div><span class="na-label">Prioridade</span><select class="na-select" data-na-prio>${["ALTA", "MEDIA", "BAIXA"]
        .map((p) => `<option value="${p}" ${p === it.priority ? "selected" : ""}>${p === "MEDIA" ? "Média" : p === "ALTA" ? "Alta" : "Baixa"}</option>`)
        .join("")}</select></div>
    </div>
    <div class="na-meta">${product}${others}${it.notes ? `<br>Nota: ${esc(it.notes)}` : ""}</div>
    <div class="na-price">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-na-useprice ${it.price ? "" : "disabled"} /> Usar preço previsto</label>
      <input type="number" min="0" step="any" class="na-input" data-na-price style="width:140px" value="${esc(it.price?.price ?? "")}" ${it.price ? "" : "placeholder='sem sugestão'"} disabled />
    </div>
    <p class="na-hint">${sources}</p>
  </div>`;
}

function renderProposal(state) {
  const r = state.result;
  const ccOptions = state.status.costCenters.map((c) => `<option value="${esc(c.id)}">${esc(c.code)} · ${esc(c.name)} (${esc(c.currency)})</option>`).join("");
  state.body.innerHTML = `
    ${r.unreadable ? `<div class="na-note"><b>Ilegível ou não interpretado:</b> ${esc(r.unreadable)}</div>` : ""}
    ${state.preview ? `<img class="na-preview" src="${state.preview}" alt="Foto enviada" />` : ""}
    ${
      r.items.length
        ? `<div style="margin:10px 0"><label class="na-label" for="naCc">Centro de custo</label><select id="naCc" class="na-select">${ccOptions}</select></div>
           ${r.items.map(itemHtml).join("")}
           <p class="na-hint">Com preço previsto a necessidade fica aprovada; sem preço fica pendente (como no formulário manual).</p>`
        : '<p class="na-hint">A IA não encontrou materiais no pedido.</p>'
    }`;
  state.foot.innerHTML = `<button type="button" class="na-btn" data-na-back>Voltar</button>${
    r.items.length ? '<button type="button" class="na-btn primary" data-na-confirm><span class="material-symbols-outlined" style="font-size:18px">add_task</span>Criar necessidades</button>' : ""
  }`;
}

async function interpret(state, payload) {
  state.source = payload.image ? "photo" : "text";
  state.body.innerHTML = `<p class="na-hint">${payload.image ? "A ler a foto…" : "A interpretar o pedido…"}</p>`;
  state.foot.innerHTML = "";
  try {
    state.result = await apiRequest("/ai/needs/interpret", { method: "POST", body: { projectId: state.projectId, ...payload } });
    renderProposal(state);
  } catch (error) {
    renderInput(state);
    toast(error.message || "Não foi possível interpretar.", { type: "error" });
  }
}

async function confirmItems(state, button) {
  const costCenterId = state.body.querySelector("#naCc")?.value;
  if (!costCenterId) return toast("Escolha o centro de custo.", { type: "error" });
  const items = [];
  for (const node of state.body.querySelectorAll("[data-na-item]")) {
    if (!node.querySelector("[data-na-on]").checked) continue;
    const description = node.querySelector("[data-na-desc]").value.trim();
    const qtyRaw = node.querySelector("[data-na-qty]").value;
    const usePrice = node.querySelector("[data-na-useprice]").checked;
    const priceRaw = node.querySelector("[data-na-price]").value;
    if (description.length < 2) return toast("Há uma necessidade sem descrição.", { type: "error" });
    const quantity = qtyRaw === "" ? null : Number(qtyRaw);
    if (quantity !== null && !(quantity > 0)) return toast(`Quantidade inválida em "${description}".`, { type: "error" });
    const unitPrice = usePrice && priceRaw !== "" ? Number(priceRaw) : null;
    if (unitPrice !== null && !(unitPrice >= 0)) return toast(`Preço inválido em "${description}".`, { type: "error" });
    const it = state.result.items[Number(node.dataset.naItem)];
    items.push({
      description,
      quantity,
      unit: node.querySelector("[data-na-unit]").value.trim() || null,
      unitPrice,
      priority: node.querySelector("[data-na-prio]").value,
      notes: it.notes || null,
    });
  }
  if (!items.length) return toast("Escolha pelo menos uma necessidade.", { type: "error" });
  button.disabled = true;
  try {
    const res = await apiRequest("/ai/needs/confirm", { method: "POST", body: { projectId: state.projectId, costCenterId, source: state.source, items } });
    const msg = `${res.created.length} necessidade(s) criada(s).`;
    if (state.needsLink) toast(msg, { type: "success", persist: true, link: state.needsLink });
    else toast(msg, { type: "success" });
    state.onSaved?.(res);
    close(state);
  } catch (error) {
    button.disabled = false;
    toast(error.message || "Não foi possível criar as necessidades.", { type: "error" });
  }
}

/** Abre a criação assistida de necessidades da obra. */
export async function openNeedsAssist({ projectId, onSaved, needsLink = null, text = "" } = {}) {
  injectStyles();
  const overlay = document.createElement("div");
  overlay.className = "na-overlay";
  overlay.innerHTML = `<div class="na-modal" role="dialog" aria-modal="true" aria-labelledby="naTitle">
    <div class="na-head"><div><h2 id="naTitle">Nova necessidade com IA</h2><p>Escreva o pedido ou fotografe a lista. Reveja antes de criar.</p></div>
    <button type="button" class="na-close" aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <div class="na-body"><p class="na-hint">A carregar…</p></div><div class="na-foot"></div></div>`;
  const state = { overlay, projectId, onSaved, needsLink, text, body: overlay.querySelector(".na-body"), foot: overlay.querySelector(".na-foot") };
  state.onKey = (e) => e.key === "Escape" && close(state);
  document.addEventListener("keydown", state.onKey);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".na-close")) return close(state);
    if (e.target.closest("[data-na-back]")) {
      state.preview = null;
      return renderInput(state);
    }
    const confirmBtn = e.target.closest("[data-na-confirm]");
    if (confirmBtn) return confirmItems(state, confirmBtn);
    if (e.target.closest("[data-na-interpret]")) {
      const text = state.body.querySelector("#naText").value.trim();
      state.text = text;
      state.preview = null;
      if (text.length < 2) return toast("Escreva o que é preciso.", { type: "error" });
      return interpret(state, { text });
    }
  });
  overlay.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.matches("[data-na-on]")) t.closest("[data-na-item]").classList.toggle("off", !t.checked);
    if (t.matches("[data-na-useprice]")) t.closest("[data-na-item]").querySelector("[data-na-price]").disabled = !t.checked;
    if (t.matches("[data-na-photo]") && t.files?.[0]) {
      try {
        const img = await readImage(t.files[0]);
        state.preview = img.preview;
        await interpret(state, { image: { mimeType: img.mimeType, base64: img.base64 } });
      } catch {
        toast("Não foi possível ler a imagem.", { type: "error" });
      }
    }
  });

  try {
    state.status = await apiRequest(`/ai/needs/status?projectId=${encodeURIComponent(projectId)}`);
  } catch (error) {
    state.body.innerHTML = `<p class="na-hint">${esc(error.message || "Não foi possível abrir.")}</p>`;
    return;
  }
  if (!state.status.enabled) {
    state.body.innerHTML = `<p class="na-hint">${esc(state.status.reason)}</p>${
      state.status.canConfigure ? '<p style="margin-top:10px"><a class="na-btn" href="/Users/index.html?section=ai">Abrir definições de IA</a></p>' : ""
    }`;
    return;
  }
  if (!state.status.costCenters.length) {
    state.body.innerHTML = '<p class="na-hint">Esta obra não tem centros de custo ativos. Crie um centro de custo antes de registar necessidades.</p>';
    return;
  }
  renderInput(state);
}
