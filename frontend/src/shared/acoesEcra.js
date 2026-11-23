/**
 * As acções que o protótipo põe em todos os ecrãs: «← Voltar», «? Dúvidas»,
 * «⤓ PDF» e «⤓ Word».
 *
 *  - **PDF e Word** geram o ecrã em papel timbrado da MBT, como o `pexp` do
 *    protótipo: capa com o código e o título, a data e quem preparou, «Sobre
 *    este documento», e depois os títulos, os indicadores e as tabelas do
 *    ecrã, pela ordem em que aparecem. As bibliotecas (jsPDF, docx) só se
 *    carregam quando se carrega no botão.
 *  - **Dúvidas** abre o assistente da página. Ao contrário do protótipo, manda
 *    ao modelo só a estrutura do ecrã (títulos, colunas, botões, notas), sem
 *    valores: para explicar como a página funciona não é preciso mais.
 *
 * Usado pelo Financeiro (`financePage.js`) e pelo Comercial (`comercial/page.js`).
 */

import { apiRequest } from "../services/api.js";
import { getSessionUser } from "../services/auth.js";

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const LIBS = {
  jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  autotable: "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js",
  docx: "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js",
};

const carregados = new Map();
function carregar(url) {
  if (!carregados.has(url)) {
    carregados.set(
      url,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`não foi possível carregar ${url}`));
        document.head.appendChild(s);
      })
    );
  }
  return carregados.get(url);
}

let logoCache = null;
async function logo() {
  if (!logoCache) {
    logoCache = fetch("/assets/images/mbt-logo.png")
      .then((r) => r.blob())
      .then(
        (b) =>
          new Promise((resolve) => {
            const fr = new FileReader();
            fr.onload = () => {
              const img = new Image();
              img.onload = () => resolve({ dataUrl: fr.result, w: img.width, h: img.height, blob: b });
              img.src = fr.result;
            };
            fr.readAsDataURL(b);
          })
      )
      .catch(() => null);
  }
  return logoCache;
}

// ─── Ler o ecrã ─────────────────────────────────────────────────────────────

/** O texto de um elemento, com o valor dos campos no lugar dos campos. */
function texto(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll("button,script,style,datalist,.material-symbols-outlined").forEach((x) => x.remove());
  // Entre elementos vai um espaço: «Receber» e «60 972 600» são duas coisas.
  c.querySelectorAll("*").forEach((x) => {
    x.prepend(" ");
    x.append(" ");
  });
  const orig = [...el.querySelectorAll("input,select,textarea")];
  [...c.querySelectorAll("input,select,textarea")].forEach((x, i) => {
    const o = orig[i];
    let v = "";
    if (o) {
      if (o.tagName === "SELECT") v = o.selectedIndex >= 0 ? o.options[o.selectedIndex].text : "";
      else if (o.type === "checkbox" || o.type === "radio") v = o.checked ? "✓" : "";
      else v = o.value;
    }
    x.replaceWith(document.createTextNode(v));
  });
  return (c.textContent || "").replace(/\s+/g, " ").trim();
}

function tabela(t) {
  const hr = t.querySelector("thead tr:last-child");
  let head = hr ? [...hr.children].map(texto) : [];
  const rows = [...t.querySelectorAll("tbody tr, tfoot tr")].map((tr) => [...tr.children].map(texto));
  if (!head.length && rows.length) head = rows.shift();
  const n = Math.max(head.length, ...rows.map((r) => r.length), 0);
  const manter = [];
  for (let j = 0; j < n; j++) if ((head[j] || "") !== "" || rows.some((r) => (r[j] || "") !== "")) manter.push(j);
  head = manter.map((j) => head[j] || "");
  const corpo = rows.map((r) => manter.map((j) => r[j] || "")).filter((r) => r.some((v) => v !== ""));
  const num = (v) => /^[-+]?[\d\s.,]+%?$/.test(v) && /\d/.test(v);
  const dir = head.map((_, j) => (corpo.length && corpo.filter((r) => r[j]).every((r) => num(r[j])) ? "right" : "left"));
  return { head, rows: corpo, dir };
}

const KPI = ".fx2-kpis, .ov-kpis, .ov-strip, .fcal-strip, .fx2-ag, .fx2-chips";
const LISTAS = ".fcal-box";
const SELECTOR = `h2, h3, ${KPI}, ${LISTAS}, table, .fcal-nota, .fx3-aviso, .fx3-alertas, .cm-note, .finance-subtitle`;

/** As listas de linhas do calendário (A Receber / A Pagar) como tabela. */
function lista(el) {
  const titulo = texto(el.querySelector(".fcal-h") || el);
  const rows = [];
  for (const r of el.querySelectorAll(".fcal-g, .fcal-r")) {
    if (r.matches(".fcal-g")) rows.push([texto(r), "", "", ""]);
    else
      rows.push([
        texto(r.querySelector(".fcal-d") || r),
        texto(r.querySelector(".fcal-n") || r),
        texto(r.querySelector(".fcal-m") || r),
        texto(r.querySelector(".fcal-v") || r),
      ]);
  }
  return { titulo, table: { head: ["Data", "Entidade", "Documento · Obra", "Valor"], rows, dir: ["left", "left", "left", "right"] } };
}
const SALTAR = ".pexp, .fx3-links, .fcal-filtros, .finance-page-header, .ph-wizard, #hlpPan, .cm-legend, button";

/** Os blocos do ecrã, pela ordem em que aparecem. */
function blocos(root) {
  const vistos = [];
  const out = [];
  for (const el of root.querySelectorAll(SELECTOR)) {
    if (el.offsetParent === null) continue;
    if (el.closest(SALTAR)) continue;
    if (vistos.some((v) => v.contains(el))) continue;
    if (el.matches("h2, h3")) {
      const t = texto(el);
      if (t) out.push({ h: t });
      continue;
    }
    vistos.push(el);
    if (el.matches(LISTAS)) {
      const l = lista(el);
      out.push({ h: l.titulo });
      if (l.table.rows.length) out.push({ table: l.table });
    } else if (el.matches("table")) {
      const t = tabela(el);
      if (t.rows.length || t.head.length) out.push({ table: t });
    } else if (el.matches(KPI)) {
      const linhas = [...el.children]
        .filter((c) => c.offsetParent !== null)
        .map((c) => {
          const partes = [...c.children].map(texto).filter(Boolean);
          return partes.length ? partes : [texto(c)];
        })
        .filter((p) => p.join("").trim());
      if (linhas.length) out.push({ kv: linhas.map((p) => [p[0], p.slice(1).join(" · ")]) });
    } else {
      const t = texto(el);
      if (t) out.push({ p: t });
    }
  }
  return out;
}

/** A estrutura do ecrã para o assistente: títulos, colunas, botões, notas — sem valores. */
function estrutura(root) {
  const L = [];
  root.querySelectorAll("h2, h3, th, .fx2-kt, .ov-kpi-label, .ov-cell-label, button, label, .fcal-nota, .fx3-aviso, .cm-note").forEach((el) => {
    if (el.offsetParent === null || el.closest("#hlpPan")) return;
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 300) return;
    const k = el.matches("button") ? `[botão ${t}]` : el.matches("th") ? `[coluna ${t}]` : t;
    if (!L.includes(k)) L.push(k);
  });
  return L.join("\n")
    .replace(/[-+]?\d[\d\s.,]*\d(?:\s?%)?/g, "…")
    .slice(0, 9000);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

function nomeFicheiro(info, ext) {
  const base = [info.codigo, info.titulo].filter(Boolean).join(" ");
  const d = new Date().toISOString().slice(0, 10);
  return `${base} — ${d}`.replace(/[\\/:*?"<>|]+/g, "-") + `.${ext}`;
}

function capa(info) {
  const u = getSessionUser() || {};
  return [
    ["Data do documento", new Date().toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" })],
    ["Preparado por", u.name || u.email || ""],
    ...(info.extra || []),
  ].filter((x) => x[1]);
}

/**
 * A fonte de base do PDF (Helvetica, WinAnsi) não tem o espaço fino que o
 * pt-PT usa nos milhares, nem «≈», «→», «⚠»… — saíam letras espaçadas e
 * símbolos errados. Troca-se cada um por um equivalente que a fonte tem.
 */
function pdfSeguro(v) {
  return String(v ?? "")
    .replace(/[\u202f\u00a0\u2009]/g, " ")
    .replace(/≈/g, "~")
    .replace(/[→⟶]/g, "->")
    .replace(/[←⟵]/g, "<-")
    .replace(/[‹]/g, "<")
    .replace(/[›]/g, ">")
    .replace(/⚠\s*/g, "! ")
    .replace(/[✓✔]/g, "v")
    .replace(/[×]/g, "x")
    .replace(/[▸▾▼▲]/g, "")
    .replace(/[^\x00-\xff€—–‘’“”•…·]/g, "");
}

async function exportarPdf(info0, root) {
  const info = { ...info0, titulo: pdfSeguro(info0.titulo), codigo: pdfSeguro(info0.codigo), lead: pdfSeguro(info0.lead) };
  await carregar(LIBS.jspdf);
  await carregar(LIBS.autotable);
  const { jsPDF } = window.jspdf;
  const B = blocos(root).map((b) => ({
    ...b,
    h: b.h && pdfSeguro(b.h),
    p: b.p && pdfSeguro(b.p),
    kv: b.kv && b.kv.map((r) => r.map(pdfSeguro)),
    table: b.table && { ...b.table, head: b.table.head.map(pdfSeguro), rows: b.table.rows.map((r) => r.map(pdfSeguro)) },
  }));
  const largo = B.some((b) => b.table && b.table.head.length > 7);
  const doc = new jsPDF({ orientation: largo ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const lg = await logo();
  const NAVY = [27, 39, 54];
  const VERDE = [22, 138, 90];

  // Cada página leva o timbre uma vez — também as que a tabela abre sozinha.
  const comTimbre = new Set();
  const timbre = () => {
    const pg = doc.internal.getCurrentPageInfo().pageNumber;
    if (comTimbre.has(pg)) return;
    comTimbre.add(pg);
    if (lg) doc.addImage(lg.dataUrl, "PNG", M, 8, 34, (34 * lg.h) / lg.w);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(102, 112, 133);
    doc.text("MBT Energia · Info Gestor", W - M, 12, { align: "right" });
    doc.setDrawColor(227, 231, 236).line(M, 19, W - M, 19);
  };
  let y = 0;
  const novaPagina = () => {
    doc.addPage();
    timbre();
    y = 26;
  };
  const espaco = (h) => {
    if (y + h > H - 16) novaPagina();
  };

  timbre();
  y = 30;
  if (info.codigo) {
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...VERDE).text(info.codigo, M, y);
    y += 6;
  }
  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(...NAVY);
  doc.text(doc.splitTextToSize(info.titulo, W - 2 * M), M, y);
  y += 9;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(31, 41, 55);
  for (const [k, v] of capa(info)) {
    doc.setTextColor(102, 112, 133).text(`${k}:`, M, y);
    doc.setTextColor(31, 41, 55).text(pdfSeguro(v), M + 36, y);
    y += 5;
  }
  if (info.lead) {
    y += 4;
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...NAVY).text("Sobre este documento", M, y);
    y += 5;
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(31, 41, 55);
    const ls = doc.splitTextToSize(info.lead, W - 2 * M);
    doc.text(ls, M, y);
    y += ls.length * 4.2 + 2;
  }

  for (const b of B) {
    if (b.h) {
      espaco(12);
      y += 4;
      doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(86, 99, 111).text(b.h.toUpperCase(), M, y);
      y += 4;
    } else if (b.p) {
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(93, 107, 124);
      const ls = doc.splitTextToSize(b.p, W - 2 * M);
      espaco(ls.length * 3.8 + 2);
      doc.text(ls, M, y + 3);
      y += ls.length * 3.8 + 3;
    } else if (b.kv || b.table) {
      const t = b.kv ? { head: [], rows: b.kv, dir: ["left", "right"] } : b.table;
      doc.autoTable({
        startY: y + 1,
        margin: { left: M, right: M, top: 26 },
        head: t.head.length ? [t.head] : undefined,
        body: t.rows,
        theme: "grid",
        styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.4, lineColor: [227, 231, 236], lineWidth: 0.2, textColor: [31, 41, 55] },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", fontSize: 7.5 },
        columnStyles: Object.fromEntries(t.dir.map((d, j) => [j, { halign: d }])),
        didDrawPage: () => timbre(),
      });
      y = doc.lastAutoTable.finalY + 4;
    }
  }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(148, 163, 184);
    doc.text(`${[info.codigo, info.titulo].filter(Boolean).join(" · ")} · página ${i} de ${n}`, W / 2, H - 8, { align: "center" });
  }
  doc.save(nomeFicheiro(info, "pdf"));
}

// ─── Word ────────────────────────────────────────────────────────────────────

async function exportarWord(info, root) {
  await carregar(LIBS.docx);
  const D = window.docx;
  const B = blocos(root);
  const lg = await logo();
  const filhos = [];
  const P = (text, o = {}) => new D.Paragraph({ children: [new D.TextRun({ text, ...o })], spacing: { after: 80 } });

  if (info.codigo) filhos.push(P(info.codigo, { bold: true, color: "168A5A", size: 20 }));
  filhos.push(new D.Paragraph({ children: [new D.TextRun({ text: info.titulo, bold: true, size: 36, color: "1B2736" })], spacing: { after: 160 } }));
  for (const [k, v] of capa(info)) filhos.push(new D.Paragraph({ children: [new D.TextRun({ text: `${k}: `, color: "667085", size: 18 }), new D.TextRun({ text: String(v), size: 18 })] }));
  if (info.lead) {
    filhos.push(new D.Paragraph({ children: [new D.TextRun({ text: "Sobre este documento", bold: true, size: 22, color: "1B2736" })], spacing: { before: 240, after: 80 } }));
    filhos.push(P(info.lead, { size: 18 }));
  }

  const celula = (text, o = {}) =>
    new D.TableCell({
      children: [new D.Paragraph({ alignment: o.dir === "right" ? D.AlignmentType.RIGHT : D.AlignmentType.LEFT, children: [new D.TextRun({ text: String(text ?? ""), size: 16, bold: !!o.head, color: o.head ? "FFFFFF" : "1F2937" })] })],
      shading: o.head ? { fill: "1B2736" } : undefined,
    });

  for (const b of B) {
    if (b.h) filhos.push(new D.Paragraph({ children: [new D.TextRun({ text: b.h.toUpperCase(), bold: true, size: 20, color: "56636F" })], spacing: { before: 240, after: 80 } }));
    else if (b.p) filhos.push(P(b.p, { size: 16, color: "5D6B7C" }));
    else if (b.kv || b.table) {
      const t = b.kv ? { head: [], rows: b.kv, dir: ["left", "right"] } : b.table;
      const linhas = [];
      if (t.head.length) linhas.push(new D.TableRow({ tableHeader: true, children: t.head.map((h) => celula(h, { head: true })) }));
      for (const r of t.rows) linhas.push(new D.TableRow({ children: r.map((v, j) => celula(v, { dir: t.dir[j] })) }));
      if (linhas.length) filhos.push(new D.Table({ rows: linhas, width: { size: 100, type: D.WidthType.PERCENTAGE } }));
      filhos.push(new D.Paragraph({ children: [] }));
    }
  }

  const cabecalho = [];
  if (lg) {
    const buf = await lg.blob.arrayBuffer();
    cabecalho.push(new D.Paragraph({ children: [new D.ImageRun({ data: buf, transformation: { width: 150, height: Math.round((150 * lg.h) / lg.w) } })] }));
  }
  const doc = new D.Document({
    sections: [
      {
        properties: { page: { size: { orientation: B.some((b) => b.table && b.table.head.length > 7) ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT } } },
        headers: { default: new D.Header({ children: cabecalho }) },
        footers: {
          default: new D.Footer({
            children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: `MBT Energia · Info Gestor · ${[info.codigo, info.titulo].filter(Boolean).join(" · ")}`, size: 14, color: "94A3B8" })] })],
          }),
        },
        children: filhos,
      },
    ],
  });
  const blob = await D.Packer.toBlob(doc);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nomeFicheiro(info, "docx");
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

// ─── Dúvidas ─────────────────────────────────────────────────────────────────

const AJUDA = { hist: {}, ocupado: false };
const SUGESTOES = [
  "Para que serve esta página?",
  "Como preencho esta página, passo a passo?",
  "De onde vêm estes valores e para onde vão?",
  "Que erros devo evitar aqui?",
];

function md(t) {
  let h = esc(t || "");
  h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^#{1,4}\s*(.+)$/gm, "<b>$1</b>");
  h = h.replace(/^\s*[-•*]\s+(.+)$/gm, "<li>$1</li>").replace(/^\s*(\d+)[.)]\s+(.+)$/gm, "<li>$1. $2</li>");
  h = h.replace(/(<li>.*?<\/li>\n?)+/g, (x) => `<ul>${x.replace(/\n/g, "")}</ul>`);
  return h.replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");
}

function desenharAjuda(ctx) {
  const pan = document.getElementById("hlpPan");
  if (!pan || pan.hidden) return;
  const info = ctx.info();
  const chave = [info.codigo, info.titulo].join("|");
  const H = AJUDA.hist[chave] || [];
  pan.innerHTML = `
    <div class="hlp-h"><div><small>Dúvidas sobre a página</small><b>${esc([info.codigo, info.titulo].filter(Boolean).join(" · "))}</b></div>
      <button type="button" class="hlp-x" data-hlp="fechar" aria-label="Fechar">×</button></div>
    <div class="hlp-b" id="hlpBody">${
      H.length
        ? H.map((m) => `<div class="hlp-m hlp-m--${m.r}">${m.r === "u" ? esc(m.t) : md(m.t)}</div>`).join("")
        : `<p class="hlp-intro">Pergunte o que quiser sobre o funcionamento desta página: o que preencher, de onde vêm os valores, como se liga às outras. O assistente vê a estrutura do ecrã — títulos, colunas, botões —, não os valores.</p>
           <div class="hlp-sug">${SUGESTOES.map((q) => `<button type="button" class="finance-btn" data-hlp="sug" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`
    }${AJUDA.ocupado ? `<div class="hlp-m hlp-m--a"><i>A pensar…</i></div>` : ""}</div>
    <form class="hlp-f" id="hlpForm"><textarea id="hlpQ" rows="2" placeholder="Escreva a sua dúvida…"></textarea>
      <div>${H.length ? `<button type="button" class="finance-btn" data-hlp="limpar">Limpar</button>` : ""}<button type="submit" class="finance-btn finance-btn--primary" ${AJUDA.ocupado ? "disabled" : ""}>Perguntar</button></div></form>`;
  const bd = document.getElementById("hlpBody");
  bd.scrollTop = bd.scrollHeight;
}

async function perguntar(ctx, q) {
  if (!q || AJUDA.ocupado) return;
  const info = ctx.info();
  const chave = [info.codigo, info.titulo].join("|");
  const H = (AJUDA.hist[chave] = AJUDA.hist[chave] || []);
  H.push({ r: "u", t: q });
  AJUDA.ocupado = true;
  desenharAjuda(ctx);
  try {
    const r = await apiRequest("/ai/page-help", {
      method: "POST",
      body: {
        pagina: { codigo: info.codigo || null, titulo: info.titulo, lead: info.lead || null, area: info.area || null },
        estrutura: estrutura(ctx.raiz()),
        pergunta: q,
        historico: H.slice(-7, -1),
      },
    });
    H.push({ r: "a", t: r.resposta || "Sem resposta." });
  } catch (e) {
    H.push({ r: "a", t: `O assistente não está disponível: ${e.message}` });
  } finally {
    AJUDA.ocupado = false;
    desenharAjuda(ctx);
  }
}

let ctxAtual = null;
let ligado = false;
function ligarEventos() {
  if (ligado) return;
  ligado = true;
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-pexp],[data-hlp]");
    if (!b || !ctxAtual) return;
    const ctx = ctxAtual;
    if (b.dataset.pexp === "voltar") {
      if (history.length > 1) history.back();
      else window.location.href = ctx.inicio || "/Dashboard";
      return;
    }
    if (b.dataset.pexp === "pdf" || b.dataset.pexp === "docx") {
      const st = document.getElementById("pexpSt");
      b.disabled = true;
      if (st) st.textContent = "A preparar…";
      try {
        if (b.dataset.pexp === "pdf") await exportarPdf(ctx.info(), ctx.raiz());
        else await exportarWord(ctx.info(), ctx.raiz());
        if (st) st.textContent = "";
      } catch (err) {
        if (st) st.textContent = `Não foi possível: ${err.message}`;
      } finally {
        b.disabled = false;
      }
      return;
    }
    if (b.dataset.pexp === "duvidas") {
      let pan = document.getElementById("hlpPan");
      if (!pan) {
        pan = document.createElement("aside");
        pan.id = "hlpPan";
        document.body.appendChild(pan);
      }
      pan.hidden = false;
      desenharAjuda(ctx);
      setTimeout(() => document.getElementById("hlpQ")?.focus(), 0);
      return;
    }
    if (b.dataset.hlp === "fechar") document.getElementById("hlpPan").hidden = true;
    if (b.dataset.hlp === "sug") perguntar(ctx, b.dataset.q);
    if (b.dataset.hlp === "limpar") {
      const info = ctx.info();
      AJUDA.hist[[info.codigo, info.titulo].join("|")] = [];
      desenharAjuda(ctx);
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "hlpForm" || !ctxAtual) return;
    e.preventDefault();
    const q = document.getElementById("hlpQ").value.trim();
    perguntar(ctxAtual, q);
  });
}

/** O HTML dos botões: «← Voltar» à parte, e o grupo Dúvidas · PDF · Word. */
export const VOLTAR_HTML = `<button type="button" class="pexp-voltar" data-pexp="voltar"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">arrow_back</span> Voltar</button>`;
export const ACOES_HTML = `<div class="pexp">
  <button type="button" class="pexp-b pexp-duvidas" data-pexp="duvidas" title="Tirar dúvidas sobre o funcionamento desta página" aria-label="Dúvidas"><span class="material-symbols-outlined">help</span></button>
  <button type="button" class="pexp-b" data-pexp="pdf" title="Gerar este ecrã em PDF, em papel timbrado da MBT"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">download</span> PDF</button>
  <button type="button" class="pexp-b" data-pexp="docx" title="Gerar este ecrã em Word, em papel timbrado da MBT"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:text-bottom">download</span> Word</button>
  <span class="pexp-st" id="pexpSt"></span>
</div>`;

/**
 * Liga as acções ao ecrã.
 *
 * @param {object} ctx
 * @param {() => {codigo?:string, titulo:string, lead?:string, area?:string, extra?:Array}} ctx.info
 * @param {() => HTMLElement} ctx.raiz o conteúdo do ecrã (o que vai para o PDF)
 */
export function ligarAcoesEcra(ctx) {
  ctxAtual = ctx;
  ligarEventos();
}

export const _teste = { blocos, tabela, estrutura, texto };
