/**
 * O editor da Proposta Técnica e Comercial.
 *
 * Desenha-se a partir do esquema (`propostaDoc.js`): cada secção, cada campo e
 * cada lista saem de lá, não de HTML escrito à mão. Quem acrescentar um campo
 * ao documento acrescenta-o ao esquema e ele aparece aqui — e o teste que
 * confronta o esquema com o documento não deixa que um fique sem o outro.
 *
 * O editor **escreve directamente no documento** que lhe é dado (`getDoc`) e
 * avisa quem o usa (`onChange`), que trata de marcar por gravar e de refazer a
 * pré-visualização. Não grava nem desenha a proposta: isso é do ecrã.
 */

import { escapeHtml } from "/shared/ui.js";
import {
  SECTIONS,
  TIPOS_ANEXO,
  getPath,
  setPath,
  addItem,
  removeItem,
  moveItem,
  novoAnexo,
  anexosDaZona,
  treeToRows,
  rowsToTree,
  rowsToText,
  textToRows,
} from "/shared/comercial/propostaDoc.js";

const esc = (v) => escapeHtml(String(v ?? ""));

/** Como se mostra uma imagem guardada (o documento só guarda o caminho). */
let resolveImg = (v) => v;
const attr = (v) => esc(v).replace(/"/g, "&quot;");

/** As secções abertas, para não fecharem todas a cada alteração. */
const abertas = new Set(["capa"]);

function lerAbertas(raiz) {
  if (!raiz) return;
  const achou = raiz.querySelectorAll("details[data-zona]");
  if (!achou.length) return;
  abertas.clear();
  achou.forEach((d) => {
    if (d.open) abertas.add(d.dataset.zona);
  });
}

/* ─── Campos ────────────────────────────────────────────────────────────── */

function campoHtml(doc, campo, prefixo, dis) {
  const path = prefixo ? `${prefixo}.${campo.path}` : campo.path;
  const v = getPath(doc, path);
  const id = `pe-${path.replace(/\./g, "-")}`;
  const largura = campo.largura ? `max-width:${campo.largura}` : "";
  const comum = `id="${attr(id)}" data-pd="${attr(path)}" data-pk="${attr(campo.kind)}" ${dis}`;

  let controlo = "";
  if (campo.kind === "area") {
    controlo = `<textarea class="cell-manual" rows="${campo.linhas || 3}" ${comum}>${esc(v)}</textarea>`;
  } else if (campo.kind === "lines") {
    const texto = Array.isArray(v) ? v.join("\n") : String(v ?? "");
    controlo = `<textarea class="cell-manual" rows="${campo.linhas || 4}" ${comum}>${esc(texto)}</textarea>`;
  } else if (campo.kind === "num") {
    controlo = `<input class="cell-manual" type="number" step="any" style="${largura}" value="${attr(v ?? "")}" ${comum}>`;
  } else if (campo.kind === "date") {
    controlo = `<input class="cell-manual" type="date" style="${largura}" value="${attr(String(v || "").slice(0, 10))}" ${comum}>`;
  } else if (campo.kind === "imagem") {
    controlo = `
      <div class="pe-img">
        ${v ? `<img src="${attr(resolveImg(v))}" alt="">` : `<span class="pe-img-vazia">sem imagem</span>`}
        <div class="pe-img-acts">
          <label class="cm-chip">Escolher…<input type="file" accept="image/*" hidden data-pimg="${attr(path)}" ${dis}></label>
          ${v ? `<button type="button" class="cm-chip" data-pimgx="${attr(path)}" ${dis}>Retirar</button>` : ""}
        </div>
      </div>`;
  } else if (campo.kind === "arvore") {
    controlo = `<textarea class="cell-manual pe-arvore" rows="8" ${comum} placeholder="Diretor de Obra — Ana&#10;  Supervisor — Bento&#10;    Chefe de equipa">${esc(v)}</textarea>`;
  } else {
    controlo = `<input class="cell-manual" type="text" style="${largura}" value="${attr(v ?? "")}" ${comum}>`;
  }

  return `
    <label class="pe-campo">
      <span>${esc(campo.label)}</span>
      ${controlo}
      ${campo.ajuda ? `<small>${esc(campo.ajuda)}</small>` : ""}
    </label>`;
}

function listaHtml(doc, campo, dis) {
  const arr = getPath(doc, campo.path);
  const linhas = Array.isArray(arr) ? arr : [];
  const botoes = (i) => `
    <div class="pe-linha-acts">
      <button type="button" class="pe-bt" data-plx="${attr(campo.path)}|${i}|up" title="Subir" ${dis}>↑</button>
      <button type="button" class="pe-bt" data-plx="${attr(campo.path)}|${i}|dn" title="Descer" ${dis}>↓</button>
      <button type="button" class="pe-bt" data-plx="${attr(campo.path)}|${i}|del" title="Retirar" ${dis}>×</button>
    </div>`;

  return `
    <div class="pe-lista">
      <div class="pe-lista-cab">
        <span>${esc(campo.label)}</span>
        <button type="button" class="cm-chip" data-pla="${attr(campo.path)}" ${dis}>+ Acrescentar</button>
      </div>
      ${campo.ajuda ? `<small class="pe-ajuda">${esc(campo.ajuda)}</small>` : ""}
      ${
        linhas.length
          ? linhas
              .map(
                (_, i) => `
        <div class="pe-linha">
          <div class="pe-linha-campos">
            ${campo.item.map((c) => campoHtml(doc, c, `${campo.path}.${i}`, dis)).join("")}
          </div>
          ${botoes(i)}
        </div>`
              )
              .join("")
          : `<p class="pe-vazio">Nada acrescentado.</p>`
      }
    </div>`;
}

/** O organograma: uma lista de cargos por nível, escrita como texto. */
function organogramaHtml(doc, campo, dis) {
  const diagramas = getPath(doc, campo.path);
  const lista = Array.isArray(diagramas) ? diagramas : [];
  return `
    <div class="pe-lista">
      <div class="pe-lista-cab">
        <span>${esc(campo.label)}</span>
        <button type="button" class="cm-chip" data-pla="${attr(campo.path)}" ${dis}>+ Acrescentar</button>
      </div>
      <small class="pe-ajuda">Um cargo por linha. Dois espaços à frente para descer um nível. O nome vem depois de «—».</small>
      ${
        lista.length
          ? lista
              .map(
                (d, i) => `
        <div class="pe-linha">
          <div class="pe-linha-campos">
            <label class="pe-campo"><span>Título</span>
              <input class="cell-manual" type="text" value="${attr(d.titulo || "")}" data-pd="${attr(campo.path)}.${i}.titulo" data-pk="text" ${dis}>
            </label>
            <label class="pe-campo"><span>Cargos</span>
              <textarea class="cell-manual pe-arvore" rows="7" data-pog="${i}" ${dis}>${esc(rowsToText(treeToRows(d.raiz)))}</textarea>
            </label>
          </div>
          <div class="pe-linha-acts">
            <button type="button" class="pe-bt" data-plx="${attr(campo.path)}|${i}|del" title="Retirar" ${dis}>×</button>
          </div>
        </div>`
              )
              .join("")
          : `<p class="pe-vazio">Sem organograma.</p>`
      }
    </div>`;
}

/* ─── Anexos ────────────────────────────────────────────────────────────── */

function anexosHtml(doc, zona, dis) {
  const meus = anexosDaZona(doc, zona);
  return `
    <div class="pe-lista pe-anexos">
      <div class="pe-lista-cab">
        <span>Anexos desta secção</span>
        <span class="pe-anexo-acts">
          ${TIPOS_ANEXO.map(([t, l]) => `<button type="button" class="cm-chip" data-pax="${attr(zona)}|${attr(t)}" ${dis}>+ ${esc(l)}</button>`).join("")}
        </span>
      </div>
      <div class="pe-ia-pedido">
        <input class="cell-manual" type="text" data-piatxt="${attr(zona)}" placeholder="Pedir um bloco à IA: o que deve dizer…" ${dis}>
        <button type="button" class="cm-chip" data-pia="bloco|${attr(zona)}" ${dis}>✦ Redigir</button>
      </div>
      ${
        meus.length
          ? meus
              .map(
                ({ x, i }) => `
        <div class="pe-linha">
          <div class="pe-linha-campos">
            <label class="pe-campo"><span>Título</span>
              <input class="cell-manual" type="text" value="${attr(x.titulo || "")}" data-pd="extras.${i}.titulo" data-pk="text" ${dis}>
            </label>
            ${
              x.tipo === "imagem"
                ? `${campoHtml(doc, { path: "imagem", label: "Imagem", kind: "imagem" }, `extras.${i}`, dis)}
                   ${campoHtml(doc, { path: "legenda", label: "Legenda", kind: "text" }, `extras.${i}`, dis)}`
                : campoHtml(doc, { path: "texto", label: "Texto", kind: "area", linhas: 4 }, `extras.${i}`, dis)
            }
          </div>
          <div class="pe-linha-acts">
            <button type="button" class="pe-bt" data-pxx="${i}" title="Retirar" ${dis}>×</button>
          </div>
        </div>`
              )
              .join("")
          : `<p class="pe-vazio">Sem anexos.</p>`
      }
    </div>`;
}

/* ─── O editor ──────────────────────────────────────────────────────────── */

export function renderEditor(doc, { editable = true, resolve } = {}) {
  if (typeof resolve === "function") resolveImg = resolve;
  if (!doc) return `<p class="cm-lead">Sem documento.</p>`;
  const dis = editable ? "" : "disabled";
  return SECTIONS.map(
    (s) => `
    <details class="pe-sec" data-zona="${attr(s.zona)}"${abertas.has(s.zona) ? " open" : ""}>
      <summary>${esc(s.titulo)}</summary>
      <div class="pe-sec-corpo">
        ${s.ajuda ? `<p class="pe-ajuda">${esc(s.ajuda)}</p>` : ""}
        ${
          s.ia
            ? `<div class="pe-ia">
                 <button type="button" class="cm-chip" data-pia="${attr(s.ia.tarefa)}|${attr(s.zona)}" ${dis}>${esc(s.ia.label)}</button>
                 <small>${esc(s.ia.ajuda || "")}</small>
               </div>`
            : ""
        }
        ${s.campos
          .map((c) => {
            if (c.kind === "list" && c.arvore) return organogramaHtml(doc, c, dis);
            if (c.kind === "list") return listaHtml(doc, c, dis);
            return campoHtml(doc, c, "", dis);
          })
          .join("")}
        ${s.anexos ? anexosHtml(doc, s.zona, dis) : ""}
      </div>
    </details>`
  ).join("");
}

/**
 * Liga o editor aos eventos, uma vez por página.
 *
 * @param {object} o
 * @param {() => object} o.getDoc o documento a editar
 * @param {() => void} o.onChange mudou alguma coisa (marcar por gravar, refazer a pré-visualização)
 * @param {() => void} o.onStructure mudou a estrutura (é preciso redesenhar o editor)
 * @param {(file: File) => Promise<string>} o.onUpload carrega uma imagem e devolve o endereço
 * @param {() => HTMLElement|null} o.host onde o editor está desenhado
 */
export function wireEditor({ getDoc, onChange, onStructure, onUpload, onAi, host }) {
  const doc = () => getDoc();

  /** O valor de um campo, pelo tipo. */
  const valorDe = (t) => {
    const k = t.dataset.pk;
    if (k === "num") return t.value === "" ? null : Number(String(t.value).replace(",", "."));
    if (k === "lines") {
      return t.value
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
    }
    return t.value;
  };

  document.addEventListener("input", (e) => {
    const t = e.target;
    const d = doc();
    if (!d) return;
    if (t.dataset?.pd) {
      setPath(d, t.dataset.pd, valorDe(t));
      onChange?.();
      return;
    }
    if (t.dataset?.pog !== undefined && t.dataset.pog !== "") {
      const i = Number(t.dataset.pog);
      const diagramas = getPath(d, "organograma.diagramas") || [];
      if (diagramas[i]) {
        diagramas[i].raiz = rowsToTree(textToRows(t.value));
        onChange?.();
      }
    }
  });

  document.addEventListener("click", async (e) => {
    const d = doc();
    if (!d) return;
    const ia = e.target.closest("[data-pia]");
    if (ia && onAi) {
      const [tarefa, zona] = ia.dataset.pia.split("|");
      const campo = tarefa === "bloco" ? document.querySelector(`[data-piatxt="${zona}"]`) : null;
      const pedido = campo?.value?.trim() || "";
      if (tarefa === "bloco" && !pedido) {
        campo?.focus();
        return;
      }
      lerAbertas(host?.());
      await onAi({ tarefa, zona, pedido, botao: ia, campo });
      return;
    }

    const alvo = e.target.closest("[data-pla],[data-plx],[data-pax],[data-pxx],[data-pimgx]");
    if (!alvo) return;

    lerAbertas(host?.());

    if (alvo.dataset.pla) {
      const path = alvo.dataset.pla;
      const campo = SECTIONS.flatMap((s) => s.campos).find((c) => c.path === path);
      addItem(d, path, campo?.novo || {});
    } else if (alvo.dataset.plx) {
      const [path, i, acc] = alvo.dataset.plx.split("|");
      if (acc === "del") removeItem(d, path, Number(i));
      else moveItem(d, path, Number(i), acc === "up" ? -1 : 1);
    } else if (alvo.dataset.pax) {
      const [zona, tipo] = alvo.dataset.pax.split("|");
      d.extras = Array.isArray(d.extras) ? d.extras : [];
      d.extras.push(novoAnexo(zona, tipo));
    } else if (alvo.dataset.pxx) {
      (d.extras || []).splice(Number(alvo.dataset.pxx), 1);
    } else if (alvo.dataset.pimgx) {
      setPath(d, alvo.dataset.pimgx, "");
    }

    onStructure?.();
    onChange?.();
  });

  document.addEventListener("change", async (e) => {
    const t = e.target;
    const d = doc();
    if (!d || !t.dataset?.pimg) return;
    const file = t.files?.[0];
    if (!file || !onUpload) return;
    try {
      const url = await onUpload(file);
      lerAbertas(host?.());
      setPath(d, t.dataset.pimg, url);
      onStructure?.();
      onChange?.();
    } finally {
      t.value = "";
    }
  });
}

export { lerAbertas };
