/**
 * Gestão do Sistema → Inteligência Artificial (só administradores).
 *
 * a) Fornecedor e modelo (Gemini por omissão, trocável), chave cifrada no servidor.
 * b) Dados enviados à IA: modo por categoria, obras excluídas.
 * c) Funcionalidades e limites (orçamento mensal, pedidos diários por utilizador).
 * d) Destinatários dos resumos e alertas (director de obra, direcção, financeiro, operadores).
 * e) Consumo do mês e registo do que foi enviado.
 *
 * Estilos próprios (prefixo .ai-) para não depender das classes Tailwind compiladas.
 */

import { apiRequest } from "../../services/api.js";
import { setButtonLoading, toast } from "../../shared/ui.js";

const MODE_LABELS = { off: "Não enviar", on: "Enviar", anonymize: "Anonimizar" };
const FEATURE_LABELS_FALLBACK = { invoice_scan: "Leitura de faturas" };

let data = null; // resposta de GET /ai/admin/settings
let draft = null; // cópia editável das definições
let usage = null;
let activeDigest = "DAILY_SUMMARY";
let wired = false;

function el(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value, currency) {
  if (value == null) return "—";
  return `${Number(value).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${esc(currency || "")}`;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function injectStyles() {
  if (document.getElementById("aiSettingsStyles")) return;
  const style = document.createElement("style");
  style.id = "aiSettingsStyles";
  style.textContent = `
    .ai-card{background:#fff;border:1px solid #f1f5f9;border-radius:18px;box-shadow:0 1px 2px rgba(15,23,42,.04);padding:22px;margin-bottom:20px}
    .ai-h2{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin:0 0 6px}
    .ai-sub{font-size:13px;color:#64748b;margin:0 0 16px}
    .ai-grid{display:grid;grid-template-columns:1fr;gap:14px}
    @media(min-width:768px){.ai-grid.cols-2{grid-template-columns:1fr 1fr}.ai-grid.cols-3{grid-template-columns:repeat(3,1fr)}}
    .ai-label{display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:6px}
    .ai-input,.ai-select{width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;font-size:14px;font-weight:500;color:#0f172a}
    .ai-input:focus,.ai-select:focus{outline:2px solid rgba(42,252,141,.45);outline-offset:1px}
    .ai-hint{font-size:12px;color:#64748b;margin:6px 0 0}
    .ai-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9}
    .ai-row:last-child{border-bottom:0}
    .ai-row-label{font-size:14px;font-weight:600;color:#0f172a}
    .ai-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:42px;padding:0 18px;border-radius:12px;border:1px solid #e2e8f0;background:#fff;font-weight:700;font-size:13px;color:#0f172a;cursor:pointer}
    .ai-btn.primary{background:#0f172a;color:#fff;border-color:#0f172a}
    .ai-btn:disabled{opacity:.55;cursor:not-allowed}
    .ai-stat{background:#fff;border:1px solid #f1f5f9;border-radius:16px;padding:18px}
    .ai-stat-k{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:6px}
    .ai-stat-v{font-size:14px;font-weight:800;color:#0f172a}
    .ai-pill{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800}
    .ai-pill.ok{background:#dcfce7;color:#166534}.ai-pill.off{background:#f1f5f9;color:#475569}.ai-pill.warn{background:#fef3c7;color:#92400e}.ai-pill.err{background:#fee2e2;color:#991b1b}
    .ai-seg{display:inline-flex;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;flex:none}
    .ai-seg button{border:0;background:#fff;padding:7px 11px;font-size:12px;font-weight:700;color:#475569;cursor:pointer}
    .ai-seg button+button{border-left:1px solid #e2e8f0}
    .ai-seg button[aria-pressed="true"]{background:#0f172a;color:#2afc8d}
    .ai-seg button:disabled{color:#cbd5e1;cursor:not-allowed}
    .ai-checklist{max-height:200px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:12px;padding:6px 10px;background:#f8fafc}
    .ai-checklist label{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;color:#0f172a}
    .ai-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
    .ai-tabs button{border:1px solid #e2e8f0;background:#fff;border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;color:#475569;cursor:pointer}
    .ai-tabs button[aria-pressed="true"]{background:#0f172a;border-color:#0f172a;color:#2afc8d}
    .ai-group{border:1px solid #f1f5f9;border-radius:14px;padding:14px;margin-bottom:12px}
    .ai-group[data-enabled="false"] .ai-group-body{opacity:.45;pointer-events:none}
    .ai-table{width:100%;border-collapse:collapse;font-size:12px}
    .ai-table th{text-align:left;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;padding:8px 6px;border-bottom:1px solid #f1f5f9}
    .ai-table td{padding:8px 6px;border-bottom:1px solid #f8fafc;color:#0f172a;vertical-align:top}
    .ai-scroll{overflow-x:auto}
    .ai-switch{width:20px;height:20px;accent-color:#0f172a;flex:none}
  `;
  document.head.appendChild(style);
}

// ── Render ──────────────────────────────────────────────────────────────────

function keyPlaceholder() {
  const key = data.settings.apiKey;
  if (key.source === "stored") return `Chave guardada (${key.hint}). Escreva para substituir.`;
  if (key.source === "env") return "A usar GEMINI_API_KEY do .env. Escreva para guardar outra.";
  if (key.source === "unreadable") return "A chave guardada não pode ser lida. Introduza-a de novo.";
  return "Sem chave. Cole aqui a chave de API.";
}

function statusCards() {
  const s = draft;
  const key = data.settings.apiKey;
  const provider = data.catalog.providers.find((p) => p.id === s.provider);
  const keyPill = key.configured
    ? `<span class="ai-pill ok">${key.source === "env" ? "Chave do .env" : "Chave guardada"}</span>`
    : key.source === "unreadable"
      ? `<span class="ai-pill err">Chave ilegível</span>`
      : `<span class="ai-pill warn">Sem chave</span>`;
  const spent = usage ? money(usage.estimatedCost, s.budgetCurrency) : "—";
  const budget = s.monthlyBudget != null ? ` de ${money(s.monthlyBudget, s.budgetCurrency)}` : "";
  return `
    <div class="ai-grid cols-3" style="margin-bottom:20px">
      <div class="ai-stat"><div class="ai-stat-k">Estado</div>
        <div class="ai-stat-v">${s.enabled ? '<span class="ai-pill ok">IA ligada</span>' : '<span class="ai-pill off">IA desligada</span>'}</div></div>
      <div class="ai-stat"><div class="ai-stat-k">Fornecedor</div>
        <div class="ai-stat-v">${esc(provider?.label || s.provider)} · ${esc(s.model)}</div>
        <div style="margin-top:6px">${keyPill}</div></div>
      <div class="ai-stat"><div class="ai-stat-k">Consumo este mês</div>
        <div class="ai-stat-v">${usage ? `${usage.requests} pedidos · ${spent}${budget}` : "—"}</div></div>
    </div>`;
}

function providerCard() {
  const s = draft;
  const provider = data.catalog.providers.find((p) => p.id === s.provider);
  return `
    <section class="ai-card">
      <h2 class="ai-h2">Fornecedor e modelo</h2>
      <p class="ai-sub">O Gemini é o fornecedor por omissão. Pode trocar quando for preciso, sem mexer no código. Ao trocar de fornecedor ou de endereço, a chave guardada é apagada e tem de a introduzir de novo.</p>
      <div class="ai-grid cols-2">
        <div><label class="ai-label" for="aiProvider">Fornecedor</label>
          <select id="aiProvider" class="ai-select">${data.catalog.providers
            .map((p) => `<option value="${esc(p.id)}" ${p.id === s.provider ? "selected" : ""}>${esc(p.label)}</option>`)
            .join("")}</select></div>
        <div><label class="ai-label" for="aiModel">Modelo principal</label>
          <input id="aiModel" class="ai-input" value="${esc(s.model)}" placeholder="${esc(provider?.defaultModel || "nome-do-modelo")}" /></div>
        <div><label class="ai-label" for="aiFallback">Modelos de recurso</label>
          <input id="aiFallback" class="ai-input" value="${esc(s.fallbackModels.join(", "))}" placeholder="Separados por vírgulas (opcional)" />
          <p class="ai-hint">Usados por ordem quando o principal está ocupado ou indisponível.</p></div>
        <div><label class="ai-label" for="aiBaseUrl">Endereço da API</label>
          <input id="aiBaseUrl" class="ai-input" value="${esc(s.baseUrl || "")}" placeholder="${esc(provider?.defaultBaseUrl || "")}" />
          <p class="ai-hint">Deixe vazio para usar o endereço oficial.</p></div>
        <div style="grid-column:1/-1"><label class="ai-label" for="aiApiKey">Chave de API</label>
          <input id="aiApiKey" class="ai-input" type="password" autocomplete="new-password" placeholder="${esc(keyPlaceholder())}" />
          <p class="ai-hint">Guardada cifrada no servidor. Nunca volta a ser mostrada.</p>
          ${
            data.settings.apiKey.source === "stored"
              ? `<label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;color:#475569"><input id="aiClearKey" type="checkbox" class="ai-switch" /> Apagar a chave guardada</label>`
              : ""
          }</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px">
        <button type="button" id="aiTestBtn" class="ai-btn"><span class="material-symbols-outlined" style="font-size:18px">wifi_tethering</span>Testar ligação</button>
        <span id="aiTestResult" role="status" style="font-size:13px;font-weight:600"></span>
      </div>
    </section>`;
}

function categoriesCard() {
  const cats = data.catalog.dataCategories;
  const excluded = new Set(draft.excludedProjectIds);
  return `
    <section class="ai-card">
      <h2 class="ai-h2">Dados enviados à IA</h2>
      <p class="ai-sub">Nada é enviado sem estar marcado aqui. "Anonimizar" troca os nomes por etiquetas (ex.: "Fornecedor A"); os nomes reais ficam no servidor.</p>
      ${cats
        .map((c) => {
          const mode = draft.dataCategories[c.key] || "off";
          return `<div class="ai-row"><span class="ai-row-label">${esc(c.label)}</span>
            <div class="ai-seg" role="group" aria-label="${esc(c.label)}">
              ${["off", "on", "anonymize"]
                .map(
                  (m) =>
                    `<button type="button" data-ai-cat="${esc(c.key)}" data-mode="${m}" aria-pressed="${mode === m}" ${
                      m === "anonymize" && !c.anonymizable ? "disabled title='Não se aplica a esta categoria'" : ""
                    }>${MODE_LABELS[m]}</button>`
                )
                .join("")}
            </div></div>`;
        })
        .join("")}
      <h3 class="ai-label" style="margin-top:18px">Obras que nunca são enviadas à IA</h3>
      <input id="aiExclSearch" class="ai-input" placeholder="Pesquisar obra…" style="margin-bottom:8px" />
      <div class="ai-checklist" id="aiExclList">
        ${data.projects
          .map(
            (p) => `<label data-search="${esc(`${p.code} ${p.name}`.toLowerCase())}">
              <input type="checkbox" class="ai-switch" data-ai-excl="${esc(p.id)}" ${excluded.has(p.id) ? "checked" : ""} />
              ${esc([p.code, p.name].filter(Boolean).join(" · "))}${p.active === false ? ' <span class="ai-pill off">inativa</span>' : ""}</label>`
          )
          .join("") || '<p class="ai-hint">Sem obras.</p>'}
      </div>
      <p class="ai-hint">${excluded.size} obra(s) excluída(s).</p>
    </section>`;
}

function featuresCard() {
  const s = draft;
  return `
    <section class="ai-card">
      <h2 class="ai-h2">Funcionalidades e limites</h2>
      <p class="ai-sub">O interruptor geral desliga toda a IA, incluindo a leitura de faturas.</p>
      <div class="ai-row"><span class="ai-row-label">IA ligada (interruptor geral)</span>
        <input type="checkbox" id="aiEnabled" class="ai-switch" ${s.enabled ? "checked" : ""} /></div>
      ${data.catalog.features
        .map(
          (f) => `<div class="ai-row"><span class="ai-row-label">${esc(f.label || FEATURE_LABELS_FALLBACK[f.key] || f.key)}</span>
            <input type="checkbox" class="ai-switch" data-ai-feature="${esc(f.key)}" ${s.features[f.key] ? "checked" : ""} ${s.enabled ? "" : "disabled"} /></div>`
        )
        .join("")}
      <div class="ai-grid cols-3" style="margin-top:16px">
        <div><label class="ai-label" for="aiBudget">Orçamento mensal</label>
          <input id="aiBudget" class="ai-input" type="number" min="0" step="0.01" value="${s.monthlyBudget ?? ""}" placeholder="Sem limite" />
          <p class="ai-hint">Aos 80 % os administradores recebem um aviso; aos 100 % os pedidos param.</p></div>
        <div><label class="ai-label" for="aiCurrency">Moeda</label>
          <input id="aiCurrency" class="ai-input" maxlength="3" value="${esc(s.budgetCurrency)}" /></div>
        <div><label class="ai-label" for="aiDaily">Pedidos por utilizador / dia</label>
          <input id="aiDaily" class="ai-input" type="number" min="0" step="1" value="${s.dailyRequestsPerUser}" />
          <p class="ai-hint">0 = sem limite.</p></div>
        <div><label class="ai-label" for="aiPriceIn">Preço por 1M tokens de entrada</label>
          <input id="aiPriceIn" class="ai-input" type="number" min="0" step="0.0001" value="${s.inputPricePerMTok ?? ""}" placeholder="Ex.: 0.30" /></div>
        <div><label class="ai-label" for="aiPriceOut">Preço por 1M tokens de saída</label>
          <input id="aiPriceOut" class="ai-input" type="number" min="0" step="0.0001" value="${s.outputPricePerMTok ?? ""}" placeholder="Ex.: 2.50" />
          <p class="ai-hint">Usados para estimar o custo. Consulte a tabela de preços do fornecedor.</p></div>
      </div>
    </section>`;
}

function userChecklist(rule) {
  const selected = new Set(rule.userIds);
  return `<div class="ai-checklist">${data.users
    .map(
      (u) => `<label><input type="checkbox" class="ai-switch" data-ai-rule-user="${esc(u.id)}" ${selected.has(u.id) ? "checked" : ""} />
        ${esc(u.name || u.email)} <span style="color:#94a3b8;font-size:11px">${esc(u.role)}</span></label>`
    )
    .join("")}</div>`;
}

function projectChecklist(rule) {
  const selected = new Set(rule.projectIds);
  return `<div class="ai-checklist">${data.projects
    .map(
      (p) => `<label><input type="checkbox" class="ai-switch" data-ai-rule-project="${esc(p.id)}" ${selected.has(p.id) ? "checked" : ""} />
        ${esc([p.code, p.name].filter(Boolean).join(" · "))}</label>`
    )
    .join("")}</div><p class="ai-hint">Nenhuma marcada = todas as obras.</p>`;
}

function recipientsCard() {
  const tabs = data.catalog.digestTypes
    .map((d) => `<button type="button" data-ai-digest="${esc(d.key)}" aria-pressed="${d.key === activeDigest}">${esc(d.label)}</button>`)
    .join("");
  const groups = data.catalog.recipientGroups
    .map((g) => {
      const rule = draft.recipientRules.find((r) => r.digestType === activeDigest && r.group === g.key);
      const ch = new Set(rule.channels);
      return `<div class="ai-group" data-ai-group="${esc(g.key)}" data-enabled="${rule.enabled}">
        <div class="ai-row" style="border:0;padding-top:0">
          <div><div class="ai-row-label">${esc(g.label)}</div><p class="ai-hint" style="margin-top:2px">${esc(g.hint)}</p></div>
          <input type="checkbox" class="ai-switch" data-ai-rule-enabled ${rule.enabled ? "checked" : ""} aria-label="Ativar ${esc(g.label)}" />
        </div>
        <div class="ai-group-body">
          <div class="ai-grid cols-3">
            <div><span class="ai-label">Canal</span>
              <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" class="ai-switch" data-ai-rule-channel="in_app" ${ch.has("in_app") ? "checked" : ""} /> No sistema</label>
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-top:4px"><input type="checkbox" class="ai-switch" data-ai-rule-channel="email" ${ch.has("email") ? "checked" : ""} /> Email</label></div>
            <div><label class="ai-label">Conteúdo</label>
              <select class="ai-select" data-ai-rule-content>${data.catalog.contentTypes
                .map((c) => `<option value="${esc(c.key)}" ${c.key === rule.content ? "selected" : ""}>${esc(c.label)}</option>`)
                .join("")}</select></div>
            <div><label class="ai-label">Hora de envio</label>
              <input type="time" class="ai-input" data-ai-rule-time value="${esc(rule.sendTime)}" ${activeDigest === "URGENT_ALERTS" ? "disabled title='Os alertas urgentes saem logo'" : ""} /></div>
          </div>
          ${g.selectsUsers ? `<div style="margin-top:12px"><span class="ai-label">Utilizadores</span>${userChecklist(rule)}</div>` : ""}
          ${g.key !== "PROJECT_DIRECTOR" ? `<div style="margin-top:12px"><span class="ai-label">Obras</span>${projectChecklist(rule)}</div>` : ""}
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
            <button type="button" class="ai-btn" data-ai-preview><span class="material-symbols-outlined" style="font-size:18px">visibility</span>Pré-visualizar</button>
            ${
              activeDigest !== "URGENT_ALERTS"
                ? '<button type="button" class="ai-btn" data-ai-sendnow><span class="material-symbols-outlined" style="font-size:18px">send</span>Enviar agora</button>'
                : ""
            }
          </div>
        </div>
      </div>`;
    })
    .join("");
  return `
    <section class="ai-card">
      <h2 class="ai-h2">Destinatários dos resumos e alertas</h2>
      <p class="ai-sub">Quem recebe cada envio, por que canal, com que conteúdo e a que horas. Os resumos diário (segunda a sábado) e semanal (à segunda-feira) são enviados à hora escolhida quando "Resumos diários e semanais" está ligado. Os números vêm sempre do sistema; a IA só escreve os pontos de atenção, com os dados autorizados acima. </p>
      <p class="ai-sub">Com "Alertas preditivos" ligado, o sistema verifica as obras a cada 30 minutos: atrasos em cadeia nos planos, materiais sem stock para os próximos 5 dias, necessidades à espera de aprovação há 3 ou mais dias e centros de custo acima do previsto. Os <b>alertas urgentes</b> saem logo, uma vez por alerta; os <b>alertas preditivos</b> chegam como lista diária à hora escolhida (segunda a sábado). Os alertas fecham sozinhos quando a situação se resolve e nunca aparecem no portal do cliente.</p>
      <div style="margin:0 0 12px"><button type="button" class="ai-btn" id="aiScanBtn"><span class="material-symbols-outlined" style="font-size:18px">radar</span>Verificar obras agora</button></div>
      <div class="ai-tabs" role="group" aria-label="Tipo de envio">${tabs}</div>
      ${groups}
    </section>`;
}

function usageCard() {
  if (!usage) return `<section class="ai-card"><h2 class="ai-h2">Consumo</h2><p class="ai-sub">A carregar…</p></section>`;
  const cur = usage.budgetCurrency;
  const featureLabel = (k) => data.catalog.features.find((f) => f.key === k)?.label || k;
  const catLabel = (k) => data.catalog.dataCategories.find((c) => c.key === k)?.label || k;
  const list = (rows, label, value) =>
    rows.length
      ? rows.map((r) => `<div class="ai-row"><span style="font-size:13px">${esc(label(r))}</span><strong style="font-size:13px">${value(r)}</strong></div>`).join("")
      : '<p class="ai-hint">Sem pedidos este mês.</p>';
  const statusPill = (s) =>
    s === "OK" ? '<span class="ai-pill ok">OK</span>' : s === "BLOCKED" ? '<span class="ai-pill warn">Bloqueado</span>' : '<span class="ai-pill err">Erro</span>';
  return `
    <section class="ai-card">
      <h2 class="ai-h2">Consumo de ${esc(usage.month)}</h2>
      <p class="ai-sub">${usage.requests} pedidos · ${Number(usage.inputTokens).toLocaleString("pt-PT")} tokens enviados · ${Number(usage.outputTokens).toLocaleString("pt-PT")} recebidos · custo estimado ${money(usage.estimatedCost, cur)}</p>
      <div class="ai-grid cols-3">
        <div><span class="ai-label">Por funcionalidade</span>${list(usage.byFeature, (r) => featureLabel(r.feature), (r) => `${r.requests} · ${money(r.estimatedCost, cur)}`)}</div>
        <div><span class="ai-label">Por utilizador</span>${list(usage.byUser, (r) => r.name, (r) => `${r.requests} · ${money(r.estimatedCost, cur)}`)}</div>
        <div><span class="ai-label">Por obra</span>${list(usage.byProject, (r) => [r.code, r.name].filter(Boolean).join(" · "), (r) => `${r.requests}`)}</div>
      </div>
      <h3 class="ai-label" style="margin-top:18px">Últimos pedidos: o que foi enviado</h3>
      <div class="ai-scroll"><table class="ai-table">
        <thead><tr><th>Quando</th><th>Utilizador</th><th>Funcionalidade</th><th>Dados enviados</th><th>Obras</th><th>Tokens</th><th>Estado</th></tr></thead>
        <tbody>${
          usage.recent.length
            ? usage.recent
                .map(
                  (r) => `<tr>
                    <td>${esc(new Date(r.createdAt).toLocaleString("pt-PT"))}</td>
                    <td>${esc(r.user)}</td>
                    <td>${esc(featureLabel(r.feature))}<div style="color:#94a3b8">${esc(r.model || r.provider)}</div></td>
                    <td>${(Array.isArray(r.categories) ? r.categories : []).map((c) => esc(catLabel(c))).join(", ") || "—"}</td>
                    <td>${r.projectCount || "—"}</td>
                    <td>${r.inputTokens ?? "—"} / ${r.outputTokens ?? "—"}</td>
                    <td>${statusPill(r.status)}${r.errorMessage ? `<div style="color:#991b1b;max-width:220px">${esc(r.errorMessage)}</div>` : ""}</td>
                  </tr>`
                )
                .join("")
            : '<tr><td colspan="7" class="ai-hint">Ainda não há pedidos registados.</td></tr>'
        }</tbody></table></div>
    </section>`;
}

function render() {
  const root = el("aiPanelRoot");
  if (!root || !data) return;
  const scrollY = window.scrollY;
  // A chave escrita (ainda não gravada) sobrevive ao redesenho.
  const typedKey = el("aiApiKey")?.value || "";
  const clearKey = Boolean(el("aiClearKey")?.checked);
  root.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px">
      <div>
        <h1 class="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">Inteligência Artificial</h1>
        <p class="text-slate-500 font-medium mt-1">Fornecedor, dados enviados, limites e destinatários. Só administradores.</p>
      </div>
      <button type="button" id="aiSaveBtn" class="ai-btn primary" style="height:48px;padding:0 22px">
        <span class="material-symbols-outlined" style="font-size:20px">save</span>Guardar alterações</button>
    </div>
    ${statusCards()}
    ${providerCard()}
    ${categoriesCard()}
    ${featuresCard()}
    ${recipientsCard()}
    ${usageCard()}`;
  if (typedKey && el("aiApiKey")) el("aiApiKey").value = typedKey;
  if (clearKey && el("aiClearKey")) el("aiClearKey").checked = true;
  window.scrollTo({ top: scrollY });
}

// ── Recolha do formulário ───────────────────────────────────────────────────

function numOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Lê os campos de texto para o rascunho (os botões/checkboxes atualizam-no logo). */
function readInputs() {
  if (!el("aiModel")) return;
  draft.provider = el("aiProvider").value;
  draft.model = el("aiModel").value.trim();
  draft.fallbackModels = el("aiFallback").value.split(",").map((m) => m.trim()).filter(Boolean);
  draft.baseUrl = el("aiBaseUrl").value.trim() || null;
  draft.monthlyBudget = numOrNull(el("aiBudget").value);
  draft.budgetCurrency = (el("aiCurrency").value.trim() || "USD").toUpperCase();
  draft.dailyRequestsPerUser = Math.max(0, Math.floor(Number(el("aiDaily").value) || 0));
  draft.inputPricePerMTok = numOrNull(el("aiPriceIn").value);
  draft.outputPricePerMTok = numOrNull(el("aiPriceOut").value);
}

function buildPayload() {
  readInputs();
  const payload = {
    enabled: draft.enabled,
    provider: draft.provider,
    model: draft.model,
    fallbackModels: draft.fallbackModels,
    baseUrl: draft.baseUrl,
    features: draft.features,
    dataCategories: draft.dataCategories,
    monthlyBudget: draft.monthlyBudget,
    budgetCurrency: draft.budgetCurrency,
    inputPricePerMTok: draft.inputPricePerMTok,
    outputPricePerMTok: draft.outputPricePerMTok,
    dailyRequestsPerUser: draft.dailyRequestsPerUser,
    excludedProjectIds: draft.excludedProjectIds,
    recipientRules: draft.recipientRules,
  };
  const typedKey = el("aiApiKey")?.value.trim();
  if (typedKey) payload.apiKey = typedKey;
  else if (el("aiClearKey")?.checked) payload.apiKey = null;
  return payload;
}

function currentRule(groupEl) {
  return draft.recipientRules.find((r) => r.digestType === activeDigest && r.group === groupEl.dataset.aiGroup);
}

function toggleInList(list, value, on) {
  const set = new Set(list);
  if (on) set.add(value);
  else set.delete(value);
  return [...set];
}

// ── Eventos (delegados no contentor, que é redesenhado) ─────────────────────

function wire() {
  if (wired) return;
  wired = true;
  const root = el("aiPanelRoot");

  root.addEventListener("click", async (e) => {
    const catBtn = e.target.closest("[data-ai-cat]");
    if (catBtn && !catBtn.disabled) {
      readInputs();
      draft.dataCategories[catBtn.dataset.aiCat] = catBtn.dataset.mode;
      render();
      return;
    }
    const digestBtn = e.target.closest("[data-ai-digest]");
    if (digestBtn) {
      readInputs();
      activeDigest = digestBtn.dataset.aiDigest;
      render();
      return;
    }
    if (e.target.closest("#aiSaveBtn")) return save();
    const previewBtn = e.target.closest("[data-ai-preview]");
    if (previewBtn) return previewDigest(previewBtn.closest("[data-ai-group]").dataset.aiGroup);
    const sendBtn = e.target.closest("[data-ai-sendnow]");
    if (sendBtn) return sendDigestNow(sendBtn, sendBtn.closest("[data-ai-group]").dataset.aiGroup);
    if (e.target.closest("#aiTestBtn")) return testConnection();
    if (e.target.closest("#aiScanBtn")) return scanAlertsNow(e.target.closest("#aiScanBtn"));
  });

  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "aiEnabled") {
      readInputs();
      draft.enabled = t.checked;
      render();
    } else if (t.id === "aiProvider") {
      readInputs();
      const provider = data.catalog.providers.find((p) => p.id === t.value);
      if (provider && t.value !== data.settings.provider) {
        draft.model = provider.defaultModel || "";
        draft.baseUrl = null;
        draft.fallbackModels = [];
      }
      render();
    } else if (t.dataset.aiFeature) {
      draft.features[t.dataset.aiFeature] = t.checked;
    } else if (t.dataset.aiExcl) {
      draft.excludedProjectIds = toggleInList(draft.excludedProjectIds, t.dataset.aiExcl, t.checked);
    } else if (t.closest("[data-ai-group]")) {
      const groupEl = t.closest("[data-ai-group]");
      const rule = currentRule(groupEl);
      if (t.hasAttribute("data-ai-rule-enabled")) {
        rule.enabled = t.checked;
        groupEl.dataset.enabled = String(t.checked);
      } else if (t.dataset.aiRuleChannel) {
        const next = toggleInList(rule.channels, t.dataset.aiRuleChannel, t.checked);
        if (!next.length) {
          t.checked = true;
          toast("Escolha pelo menos um canal.", { type: "error" });
          return;
        }
        rule.channels = next;
      } else if (t.hasAttribute("data-ai-rule-content")) rule.content = t.value;
      else if (t.hasAttribute("data-ai-rule-time")) rule.sendTime = t.value || rule.sendTime;
      else if (t.dataset.aiRuleUser) rule.userIds = toggleInList(rule.userIds, t.dataset.aiRuleUser, t.checked);
      else if (t.dataset.aiRuleProject) rule.projectIds = toggleInList(rule.projectIds, t.dataset.aiRuleProject, t.checked);
    }
  });

  root.addEventListener("input", (e) => {
    if (e.target.id !== "aiExclSearch") return;
    const q = e.target.value.trim().toLowerCase();
    el("aiExclList")?.querySelectorAll("label[data-search]").forEach((label) => {
      label.style.display = !q || label.dataset.search.includes(q) ? "" : "none";
    });
  });
}

async function save() {
  const button = el("aiSaveBtn");
  try {
    const payload = buildPayload();
    if (!payload.model) throw new Error("Indique o modelo.");
    const sel = draft.recipientRules.filter(
      (r) => r.enabled && ["DIRECTION", "OPERATORS"].includes(r.group) && !r.userIds.length
    );
    if (sel.length) throw new Error("Escolha os utilizadores da Direcção/Operadores nos envios ativos, ou desative-os.");
    setButtonLoading(button, true);
    const { settings } = await apiRequest("/ai/admin/settings", { method: "PUT", body: payload });
    data.settings = settings;
    draft = toDraft(settings);
    if (el("aiApiKey")) el("aiApiKey").value = "";
    if (el("aiClearKey")) el("aiClearKey").checked = false;
    render();
    toast("Definições de IA guardadas.", { type: "success" });
  } catch (error) {
    toast(error.message || "Não foi possível guardar.", { type: "error" });
    setButtonLoading(button, false);
  }
}

async function testConnection() {
  readInputs();
  const out = el("aiTestResult");
  const button = el("aiTestBtn");
  const body = { provider: draft.provider, model: draft.model, baseUrl: draft.baseUrl };
  const typedKey = el("aiApiKey")?.value.trim();
  if (typedKey) body.apiKey = typedKey;
  try {
    setButtonLoading(button, true);
    out.textContent = "A testar…";
    out.style.color = "#475569";
    const result = await apiRequest("/ai/admin/test", { method: "POST", body });
    if (result.ok) {
      out.textContent = `Ligação confirmada · ${result.model}${result.label ? ` (${result.label})` : ""}`;
      out.style.color = "#166534";
    } else {
      out.textContent = `Falhou: ${result.error}`;
      out.style.color = "#991b1b";
    }
  } catch (error) {
    out.textContent = `Falhou: ${error.message}`;
    out.style.color = "#991b1b";
  } finally {
    setButtonLoading(button, false);
  }
}

// ── Resumos: pré-visualizar e enviar já ─────────────────────────────────────

function ruleForApi(group) {
  const r = draft.recipientRules.find((x) => x.digestType === activeDigest && x.group === group);
  const { digestType, enabled, channels, content, sendTime, userIds, projectIds } = r;
  return { digestType, group, enabled, channels, content, sendTime, userIds, projectIds };
}

async function previewDigest(group, userId) {
  const { renderDigestHtml } = await import("../../shared/digestViewer.js");
  renderDigestHtml(null); // injeta os estilos do modal
  let overlay = document.getElementById("aiDigestPreview");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "aiDigestPreview";
    overlay.className = "dg-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest(".dg-close")) overlay.remove();
    });
    document.body.appendChild(overlay);
  }
  const groupLabel = data.catalog.recipientGroups.find((g) => g.key === group)?.label || group;
  const digestLabel = data.catalog.digestTypes.find((d) => d.key === activeDigest)?.label || activeDigest;
  overlay.innerHTML = `<div class="dg-modal" role="dialog" aria-modal="true">
    <div class="dg-head"><div><h2>Pré-visualização · ${esc(digestLabel)}</h2><p>${esc(groupLabel)} · nada é gravado nem enviado</p></div>
    <button type="button" class="dg-close" aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <div class="dg-body"><p class="dg-empty">A preparar o resumo…</p></div></div>`;
  const body = overlay.querySelector(".dg-body");
  try {
    const res = await apiRequest("/ai/admin/digests/preview", {
      method: "POST",
      body: { rule: ruleForApi(group), ...(userId ? { userId } : {}) },
    });
    if (!res.recipients.length) {
      body.innerHTML = '<p class="dg-empty">Este envio não tem destinatários com obras ativas visíveis. Verifique os utilizadores, as obras e as permissões.</p>';
      return;
    }
    const select = `<label class="ai-label" for="aiPreviewUser">Destinatário (${res.recipients.length})</label>
      <select id="aiPreviewUser" class="ai-select" style="margin-bottom:14px">${res.recipients
        .map((r) => `<option value="${esc(r.id)}" ${r.id === res.userId ? "selected" : ""}>${esc(r.name)} · ${r.projects} obra(s)</option>`)
        .join("")}</select>`;
    if (res.alerts) {
      const { renderAlertsHtml } = await import("../../shared/alertsViewer.js");
      const note =
        activeDigest === "URGENT_ALERTS"
          ? "Alertas urgentes abertos agora que este destinatário receberia (os novos saem logo, uma vez)."
          : "Lista que este destinatário receberia agora (alertas abertos das suas obras).";
      body.innerHTML = `${select}<p class="dg-empty" style="margin:0 0 10px">${note}</p>${renderAlertsHtml(res.alerts, { actions: false })}`;
    } else {
      body.innerHTML = `${select}<h3 style="font-size:15px;font-weight:700;margin:0 0 8px">${esc(res.digest.title)}</h3>${renderDigestHtml(res.digest.content, { aiUsed: res.digest.aiUsed })}`;
    }
    body.querySelector("#aiPreviewUser").addEventListener("change", (e) => previewDigest(group, e.target.value));
  } catch (error) {
    body.innerHTML = `<p class="dg-empty">${esc(error.message || "Não foi possível pré-visualizar.")}</p>`;
  }
}

async function sendDigestNow(button, group) {
  const groupLabel = data.catalog.recipientGroups.find((g) => g.key === group)?.label || group;
  const saved = data.settings.recipientRules.find((r) => r.digestType === activeDigest && r.group === group);
  const current = ruleForApi(group);
  const same =
    saved &&
    ["enabled", "content"].every((k) => saved[k] === current[k]) &&
    ["channels", "userIds", "projectIds"].every((k) => JSON.stringify([...saved[k]].sort()) === JSON.stringify([...current[k]].sort()));
  if (!same) {
    toast("Guarde primeiro as alterações deste envio.", { type: "error" });
    return;
  }
  const isAlerts = activeDigest === "PREDICTIVE_ALERTS";
  const question = isAlerts
    ? `Enviar agora a lista de alertas abertos a "${groupLabel}"?`
    : `Enviar agora o resumo a "${groupLabel}"? Quem já o recebeu hoje recebe uma versão atualizada.`;
  if (!confirm(question)) return;
  setButtonLoading(button, true);
  try {
    const res = await apiRequest("/ai/admin/digests/send", { method: "POST", body: { digestType: activeDigest, group } });
    toast(
      res.total
        ? `${isAlerts ? "Alertas enviados" : "Resumo enviado"} a ${res.sent} de ${res.total} destinatário(s)${res.failed ? ` (${res.failed} com erro)` : ""}${isAlerts && res.sent < res.total - res.failed ? "; os restantes não têm alertas abertos" : ""}.`
        : "Sem destinatários com obras ativas para este envio.",
      { type: res.failed ? "error" : "success" }
    );
  } catch (error) {
    toast(error.message || "Não foi possível enviar.", { type: "error" });
  } finally {
    setButtonLoading(button, false);
  }
}

async function scanAlertsNow(button) {
  setButtonLoading(button, true);
  try {
    const r = await apiRequest("/ai/admin/alerts/scan", { method: "POST" });
    toast(
      `${r.projects} obra(s) verificada(s): ${r.detected} situação(ões) em alerta, ${r.opened} nova(s), ${r.resolved} resolvida(s)` +
        `${r.urgentSent ? `, ${r.urgentSent} aviso(s) urgente(s) enviado(s)` : ""}.`,
      { type: "success" }
    );
  } catch (error) {
    toast(error.message || "Não foi possível verificar as obras.", { type: "error" });
  } finally {
    setButtonLoading(button, false);
  }
}

function toDraft(settings) {
  return {
    ...clone(settings),
    excludedProjectIds: settings.excludedProjects.map((p) => p.id),
  };
}

export async function loadAiPanel() {
  injectStyles();
  wire();
  const root = el("aiPanelRoot");
  if (root && !data) root.innerHTML = '<p class="ai-sub">A carregar…</p>';
  try {
    data = await apiRequest("/ai/admin/settings");
    draft = toDraft(data.settings);
    render();
  } catch (error) {
    if (root) root.innerHTML = `<p class="ai-sub">Não foi possível carregar as definições de IA: ${esc(error.message)}</p>`;
    return;
  }
  try {
    usage = await apiRequest("/ai/admin/usage");
    readInputs();
    render();
  } catch {
    /* o consumo é informativo */
  }
}
