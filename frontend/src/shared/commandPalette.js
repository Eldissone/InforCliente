import { apiRequest } from "../services/api.js";

/**
 * Paleta de comandos (Fase 4 — Ctrl+K / ⌘K).
 *
 * Enquanto se escreve, mostra ecrãs do menu, obras e ações rápidas (sem IA).
 * Com Enter numa frase («nova necessidade de cimento para a obra Viana»,
 * «pagamentos que vencem esta semana»), o backend interpreta-a — primeiro
 * por regras, depois pela IA se estiver ligada — e a paleta executa:
 * abre o ecrã, a obra ou o formulário de sempre. Nada é gravado sem a
 * pessoa confirmar no formulário.
 */

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const TAB_LABEL = {
  dashboard: "Resumo",
  planos_diarios: "Planos diários",
  relatorio: "Relatório",
  medicoes: "Autos de medição",
  plano_gantt: "Gantt",
  plano_financeiro: "Plano financeiro",
  stock: "Stock",
  galeria_obra: "Fotos",
  files: "Ficheiros",
  orcamento_custo: "Orçamento",
};

const EXAMPLES = [
  "abrir obra Viana",
  "nova necessidade de 20 sacos de cimento para a obra Viana",
  "pagamentos que vencem esta semana",
  "ver as fotos da obra …",
];

const role = () => {
  try {
    return String(JSON.parse(localStorage.getItem("InfoCliente.user") || "{}").role || "").toLowerCase();
  } catch {
    return "";
  }
};

let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = `
    .cp-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:12vh 16px 16px}
    .cp-modal{background:#fff;border-radius:16px;width:100%;max-width:640px;max-height:72vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(15,23,42,.35);overflow:hidden;color:#0f172a;font-size:14px}
    .cp-top{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e2e8f0}
    .cp-top input{flex:1;border:0;outline:0;font:inherit;font-size:16px;background:transparent;min-width:0}
    .cp-kbd{font-size:11px;font-weight:700;color:#64748b;border:1px solid #e2e8f0;border-radius:6px;padding:1px 6px;white-space:nowrap}
    .cp-list{overflow:auto;padding:6px 0;flex:1;min-height:0}
    .cp-sec{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;padding:8px 16px 4px}
    .cp-row{display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer;border:0;background:none;width:100%;text-align:left;font:inherit;color:inherit}
    .cp-row .material-symbols-outlined{font-size:20px;color:#475569;flex:none}
    .cp-row.active{background:#eef2ff}
    .cp-main{flex:1;min-width:0}
    .cp-label{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
    .cp-hint{display:block;font-size:12px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cp-msg{padding:14px 16px;color:#475569;font-size:13px;line-height:1.45}
    .cp-msg.err{color:#b91c1c}
    .cp-foot{border-top:1px solid #e2e8f0;padding:8px 16px;font-size:11px;color:#64748b;display:flex;gap:12px;flex-wrap:wrap}
    @media (max-width:560px){.cp-overlay{padding-top:16px}.cp-foot{display:none}}
  `;
  document.head.appendChild(style);
}

/** Ecrãs do menu que o utilizador vê (o menu já está filtrado por permissões). */
function navPages() {
  const seen = new Map();
  document.querySelectorAll("nav a[href], aside a[href], .app-sidebar a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript") || a.classList.contains("is-pending")) return;
    if (a.closest(".hidden") || a.classList.contains("hidden")) return;
    const label = a.textContent.replace(/\s+/g, " ").trim();
    if (!label || label.length > 60 || seen.has(href)) return;
    const icon = a.querySelector(".material-symbols-outlined")?.textContent?.trim() || "article";
    const group = a.closest("details")?.querySelector("summary")?.textContent?.replace(/expand_more/g, "").trim() || "";
    seen.set(href, { kind: "page", href, label: label.replace(icon, "").trim() || label, icon, hint: group });
  });
  return [...seen.values()];
}

function matchPages(query, pages, limit = 6) {
  const q = fold(query);
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  return pages
    .map((p) => {
      const hay = fold(`${p.label} ${p.hint}`);
      const label = fold(p.label);
      let score = 0;
      if (label.startsWith(q)) score = 3;
      else if (label.includes(q)) score = 2;
      else if (words.every((w) => hay.includes(w))) score = 1;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

function quickActions(isStaff) {
  const list = [];
  if (isStaff) {
    list.push({ kind: "run", run: { action: "open_approvals" }, label: "Aprovações pendentes", icon: "task_alt", hint: "Aprovar vários de uma vez", words: "aprovacoes aprovar pendentes" });
    list.push({ kind: "run", run: { action: "open_alerts" }, label: "Alertas das obras", icon: "warning", hint: "Atrasos, falta de material, derrapagens", words: "alertas atrasos" });
    list.push({ kind: "run", run: { action: "ask", question: "" }, label: "Assistente IA", icon: "auto_awesome", hint: "Perguntar sobre as obras", words: "assistente ia perguntar" });
  }
  list.push({ kind: "run", run: { action: "notifications" }, label: "Notificações", icon: "notifications", hint: "Abrir o sino", words: "notificacoes sino" });
  return list;
}

// ── Execução das intenções ──────────────────────────────────────────────────

function projectHref(projectId, tab) {
  const params = new URLSearchParams({ id: projectId });
  if (tab) params.set("tab", tab);
  return `/Projectos/projectView?${params}`;
}

const projectLabel = (p) => [p.code, p.name].filter(Boolean).join(" · ");

/** Executa a intenção com uma obra já escolhida (quando precisa de uma). */
async function runIntent(intent, project, ui) {
  const a = intent.action;
  if (a === "notifications") {
    ui.close();
    const { openNotificationCenter } = await import("./notificationCenter.js");
    return openNotificationCenter();
  }
  if (a === "open_approvals") {
    ui.close();
    const { openApprovals } = await import("./approvals.js");
    return openApprovals();
  }
  if (a === "open_alerts") {
    ui.close();
    const { openAlerts } = await import("./alertsViewer.js");
    return openAlerts();
  }
  if (a === "ask") {
    ui.close();
    const { openAssistant } = await import("./aiAssistant.js");
    return openAssistant({ projectId: project?.id || null, projectLabel: project ? projectLabel(project) : "", question: intent.question || "" });
  }
  if (a === "open_page") {
    const hit = matchPages(intent.page, navPages(), 1)[0];
    if (!hit) return ui.message(`Não encontrei o ecrã «${intent.page}» no seu menu.`, true);
    ui.close();
    window.location.href = hit.href;
    return;
  }
  if (a === "open_project") {
    ui.close();
    window.location.href = projectHref(project.id, intent.tab);
    return;
  }
  if (a === "new_need") {
    ui.close();
    const { openNeedsAssist } = await import("./needsAssist.js");
    return openNeedsAssist({
      projectId: project.id,
      text: intent.text || "",
      needsLink: projectHref(project.id, "plano_financeiro"),
    });
  }
  if (a === "register_progress") {
    ui.close();
    const { openProgressCapture } = await import("./progressCapture.js");
    return openProgressCapture({ projectId: project.id, text: intent.text || "" });
  }
  return ui.message("Não percebi o pedido.", true);
}

const NEEDS_PROJECT = new Set(["open_project", "new_need", "register_progress"]);
const ACTION_TEXT = {
  open_project: (i) => `Abrir ${i.tab ? `«${TAB_LABEL[i.tab] || i.tab}» da ` : ""}obra`,
  new_need: (i) => `Nova necessidade: ${i.text || ""}`,
  register_progress: (i) => `Registar execução: ${i.text || ""}`,
};

// ── Modal ───────────────────────────────────────────────────────────────────

let current = null;

export function openCommandPalette(initial = "") {
  if (current) {
    current.input.focus();
    return;
  }
  injectStyles();
  const isStaff = role() !== "cliente";
  const overlay = document.createElement("div");
  overlay.className = "cp-overlay";
  overlay.innerHTML = `<div class="cp-modal" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
    <div class="cp-top"><span class="material-symbols-outlined" style="color:#64748b">search</span>
      <input type="text" autocomplete="off" spellcheck="false" aria-label="Comando" placeholder="Procurar ecrã, obra… ou escrever o que quer fazer">
      <span class="cp-kbd">Esc</span></div>
    <div class="cp-list" role="listbox"></div>
    <div class="cp-foot"><span>↑↓ escolher</span><span>Enter abrir</span><span>Enter numa frase: a IA interpreta</span></div></div>`;
  document.body.appendChild(overlay);

  const st = {
    input: overlay.querySelector("input"),
    list: overlay.querySelector(".cp-list"),
    pages: navPages(),
    rows: [],
    active: 0,
    projects: [],
    projectsFor: "",
    timer: null,
    busy: false,
    picking: null, // { intent } à espera da escolha da obra
    msg: null,
  };
  current = st;

  const ui = {
    close: () => close(),
    message: (text, error = false) => {
      st.msg = { text, error };
      st.busy = false;
      render();
    },
  };

  function close() {
    clearTimeout(st.timer);
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    current = null;
  }

  function buildRows() {
    const q = st.input.value.trim();
    const rows = [];
    if (st.picking) {
      const label = ACTION_TEXT[st.picking.intent.action]?.(st.picking.intent) || "Escolha a obra";
      rows.push({ section: `${label} — qual obra?` });
      st.picking.projects.forEach((p) =>
        rows.push({ kind: "pick", project: p, label: projectLabel(p), icon: "apartment", hint: "" })
      );
      rows.push({ kind: "cancelPick", label: "Voltar", icon: "arrow_back", hint: "" });
      return rows;
    }
    if (!q) {
      rows.push({ section: "Ações rápidas" });
      quickActions(isStaff).forEach((r) => rows.push(r));
      return rows;
    }
    const qf = fold(q);
    const actions = quickActions(isStaff).filter((a) => fold(`${a.label} ${a.words}`).includes(qf));
    const pages = matchPages(q, st.pages);
    if (isStaff && q.split(/\s+/).length >= 2) {
      rows.push({ section: "Comando" });
      rows.push({ kind: "interpret", label: `«${q}»`, icon: "auto_awesome", hint: "Enter — interpretar e executar" });
    }
    if (actions.length) {
      rows.push({ section: "Ações" });
      actions.forEach((r) => rows.push(r));
    }
    if (pages.length) {
      rows.push({ section: "Ecrãs" });
      pages.forEach((r) => rows.push(r));
    }
    if (st.projects.length && st.projectsFor === q) {
      rows.push({ section: "Obras" });
      st.projects.forEach((p) => rows.push({ kind: "project", project: p, label: projectLabel(p), icon: "apartment", hint: "Abrir a obra" }));
    }
    if (isStaff && q.split(/\s+/).length < 2) {
      rows.push({ section: "Comando" });
      rows.push({ kind: "interpret", label: `«${q}»`, icon: "auto_awesome", hint: "Interpretar como comando" });
    }
    return rows;
  }

  function render() {
    st.rows = buildRows();
    const pickable = st.rows.filter((r) => !r.section);
    if (st.active >= pickable.length) st.active = Math.max(0, pickable.length - 1);
    let idx = -1;
    const body = st.rows
      .map((r) => {
        if (r.section) return `<div class="cp-sec">${esc(r.section)}</div>`;
        idx += 1;
        return `<button type="button" role="option" class="cp-row${idx === st.active ? " active" : ""}" data-cp-idx="${idx}" aria-selected="${idx === st.active}">
          <span class="material-symbols-outlined" aria-hidden="true">${esc(r.icon)}</span>
          <span class="cp-main"><span class="cp-label">${esc(r.label)}</span>${r.hint ? `<span class="cp-hint">${esc(r.hint)}</span>` : ""}</span></button>`;
      })
      .join("");
    const msg = st.busy
      ? '<div class="cp-msg">A interpretar…</div>'
      : st.msg
        ? `<div class="cp-msg${st.msg.error ? " err" : ""}">${esc(st.msg.text)}</div>`
        : !st.input.value.trim() && !st.picking && isStaff
          ? `<div class="cp-msg">Experimente: ${EXAMPLES.map((e) => `«${esc(e)}»`).join(", ")}.</div>`
          : "";
    st.list.innerHTML = msg + body;
    st.list.querySelector(".cp-row.active")?.scrollIntoView({ block: "nearest" });
  }

  function searchProjects() {
    clearTimeout(st.timer);
    const q = st.input.value.trim();
    if (!isStaff || q.length < 2 || st.picking) return;
    st.timer = setTimeout(async () => {
      try {
        const { projects } = await apiRequest(`/ai/command/projects?q=${encodeURIComponent(q)}`);
        if (st.input.value.trim() !== q || !current) return;
        st.projects = projects || [];
        st.projectsFor = q;
        render();
      } catch {
        /* sem acesso: só ecrãs */
      }
    }, 220);
  }

  async function interpret() {
    const text = st.input.value.trim();
    if (text.length < 2 || st.busy) return;
    st.busy = true;
    st.msg = null;
    render();
    try {
      const res = await apiRequest("/ai/command", { method: "POST", body: { text } });
      st.busy = false;
      const intent = res.intent;
      if (NEEDS_PROJECT.has(intent.action)) {
        const projects = res.projects || [];
        if (!projects.length) return ui.message(`Não encontrei nenhuma obra sua parecida com «${intent.project}».`, true);
        const top = projects[0];
        const clear = projects.length === 1 || top.score >= 0.9 || top.score - (projects[1]?.score || 0) >= 0.25;
        if (clear) return runIntent(intent, top, ui);
        st.picking = { intent, projects };
        st.active = 0;
        return render();
      }
      const project = intent.project && res.projects?.[0]?.score >= 0.85 ? res.projects[0] : null;
      return runIntent(intent, project, ui);
    } catch (error) {
      ui.message(error.message || "Não foi possível interpretar o comando.", true);
    }
  }

  function choose(row) {
    if (!row) return;
    if (row.kind === "page") {
      close();
      window.location.href = row.href;
    } else if (row.kind === "project") {
      close();
      window.location.href = projectHref(row.project.id);
    } else if (row.kind === "run") runIntent(row.run, null, ui);
    else if (row.kind === "interpret") interpret();
    else if (row.kind === "pick") runIntent(st.picking.intent, row.project, ui);
    else if (row.kind === "cancelPick") {
      st.picking = null;
      st.active = 0;
      render();
      st.input.focus();
    }
  }

  function onKey(e) {
    if (!current) return;
    const pickable = st.rows.filter((r) => !r.section);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (st.picking) return choose({ kind: "cancelPick" });
      return close();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!pickable.length) return;
      st.active = (st.active + (e.key === "ArrowDown" ? 1 : -1) + pickable.length) % pickable.length;
      render();
    } else if (e.key === "Enter" && document.activeElement === st.input) {
      e.preventDefault();
      choose(pickable[st.active]);
    }
  }

  st.input.addEventListener("input", () => {
    st.active = 0;
    st.msg = null;
    st.picking = null;
    render();
    searchProjects();
  });
  st.list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cp-idx]");
    if (btn) choose(st.rows.filter((r) => !r.section)[Number(btn.dataset.cpIdx)]);
  });
  overlay.addEventListener("mousedown", (e) => e.target === overlay && close());
  document.addEventListener("keydown", onKey, true);

  st.input.value = initial;
  render();
  st.input.focus();
  if (initial) searchProjects();
}

/** Botão de pesquisa no cabeçalho, ao lado do sino (quem não conhece o atalho também a encontra). */
function mountHeaderButton() {
  const profileBtn = document.querySelector("nav.app-top-nav [data-user-profile]");
  if (!profileBtn || document.getElementById("commandPaletteBtn")) return;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  const btn = document.createElement("button");
  btn.id = "commandPaletteBtn";
  btn.type = "button";
  btn.title = `Procurar ou dar um comando (${mac ? "⌘" : "Ctrl"}+K)`;
  btn.setAttribute("aria-label", "Paleta de comandos");
  btn.setAttribute(
    "style",
    "width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:10px;color:rgba(255,255,255,.75);background:transparent;border:0;cursor:pointer;"
  );
  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:22px;">search</span>';
  btn.addEventListener("mouseenter", () => (btn.style.background = "rgba(255,255,255,.1)"));
  btn.addEventListener("mouseleave", () => (btn.style.background = "transparent"));
  btn.addEventListener("click", () => openCommandPalette());
  const bell = document.getElementById("notificationBell");
  profileBtn.parentElement.insertBefore(btn, bell && bell.parentElement === profileBtn.parentElement ? bell : profileBtn);
}

let wired = false;
/** Liga o atalho Ctrl+K / ⌘K em todas as páginas. */
export function initCommandPalette() {
  if (wired) return;
  wired = true;
  mountHeaderButton();
  setTimeout(mountHeaderButton, 800); // o sino pode montar depois
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "k") {
      e.preventDefault();
      openCommandPalette();
    }
  });
}
