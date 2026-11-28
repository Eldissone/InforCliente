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

import { apiRequest, apiUpload, getAssetUrl } from "../../services/api.js";
import { openModal, toast } from "../ui.js";
import { can } from "../permissions.js";
import { esc, fmt, fmt0, fmtData, kpis, vazio, erro } from "../finance/f2Ui.js";
import { norm, select, pesquisa, chip } from "../compras/ui.js";

const root = () => document.getElementById("financeRoot");
const S = { vista: "painel", d: null, ov: null, custos: null, erro: null, q: "", v: "", e: "", de: "", ate: "", so: "", g: "", mes: "", per: "mes" };

const urlOverview = () => `/fleet/overview?${new URLSearchParams({ mes: S.mes, grupo: S.g, per: S.per })}`;
async function recarregarPainel() {
  S.ov = await apiRequest(urlOverview());
  desenhar();
}

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
// Alinhados com o protótipo (v699): ENT.fmot / fab / fint / focr / fdoc, FXDRAW.frota e FXDRAW.seg.
// Um campo é { k, l, t, opts, req, full, ph, hint, mostrar(v), reqSe(v) }; `{ sec }` abre uma secção;
// `{ t: "calc", html(v) }` é um quadro calculado; `{ t: "html", html }` é conteúdo fixo.

const optsViaturas = (cur) => [["", "— escolher viatura —"], ...S.d.viaturas.filter((v) => ativa(v) || v.id === cur).map((v) => [v.id, vLbl(v)])];
const optsMotoristas = (cur) => [["", "— sem motorista —"], ...S.d.motoristas.filter((m) => m.status !== "Inativo" || m.id === cur).map((m) => [m.id, m.name])];
const optsObras = () => [["", "— sem obra —"], ...S.d.obras.map((o) => [o.id, [o.code, o.name].filter(Boolean).join(" · ")])];
const lista = (a) => a.map((x) => (Array.isArray(x) ? x : [x, x]));
const simNao = [["Não", "Não"], ["Sim", "Sim"]];
const nr = (x) => (x === "" || x === null || x === undefined ? null : Number(String(x).replace(",", ".")));
const kz = (x) => fmt(x);

/** Valor de um campo, incluindo os da ficha (`details.cor`). */
function valorDe(o, k) {
  if (k.startsWith("details.")) return (o.details || {})[k.slice(8)];
  return o[k];
}

function campoHtml(f, o) {
  if (f.t === "calc") return `<div class="finance-field finance-field--full" data-calc="${esc(f.k)}"></div>`;
  if (f.t === "html") return `<div class="finance-field finance-field--full">${f.html}</div>`;
  const id = `ff_${f.k.replace(".", "_")}`;
  const raw = valorDe(o, f.k);
  const val = raw === null || raw === undefined ? "" : raw;
  const lab = `<label class="finance-label" for="${id}">${esc(f.l)}<b class="fr-req"${f.req ? "" : " hidden"}> *</b></label>`;
  let input;
  if (f.t === "select" || f.t === "sim") {
    const opts = f.t === "sim" ? simNao : f.opts;
    const cur = f.t === "sim" ? (val === true ? "Sim" : "Não") : String(val);
    input = `<select id="${id}" class="finance-input">${opts.map(([v, l]) => `<option value="${esc(v)}"${cur === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  } else if (f.t === "textarea") {
    input = `<textarea id="${id}" class="finance-input" rows="2">${esc(val)}</textarea>`;
  } else if (f.t === "multi") {
    const sel = new Set(Array.isArray(val) ? val : []);
    input = `<div id="${id}" class="fr-multi">${f.opts.length ? f.opts.map(([v, l]) => `<label><input type="checkbox" value="${esc(v)}"${sel.has(v) ? " checked" : ""}> ${esc(l)}</label>`).join("") : `<span class="fx2-mut">${esc(f.vazio || "Sem opções.")}</span>`}</div>`;
  } else {
    const step = f.t === "number" ? ' step="any" min="0"' : "";
    input = `<input id="${id}" class="finance-input" type="${f.t || "text"}"${step} value="${esc(val)}"${f.ph ? ` placeholder="${esc(f.ph)}"` : ""}${f.list ? ` list="${esc(f.list)}"` : ""}>`;
  }
  return `<div class="finance-field${f.full ? " finance-field--full" : ""}" data-campo="${esc(f.k)}">${lab}${input}<small class="fx2-mut" data-hint="${esc(f.k)}">${esc(f.hint || "")}</small></div>`;
}

/** Desenha os campos por secções (as `fxsec` do protótipo). */
function camposHtml(campos, o) {
  let h = "";
  let aberta = false;
  const fecha = () => (aberta ? "</div></section>" : "");
  if (!campos[0]?.sec) {
    h += `<section class="fx2-blk fr-sec"><div class="finance-form-grid finance-form-grid--2">`;
    aberta = true;
  }
  for (const f of campos) {
    if (f.sec) {
      h += fecha();
      h += `<section class="fx2-blk fr-sec" data-secao="${esc(f.id || f.sec)}"><h3>${esc(f.sec)}</h3>${f.nota ? `<p class="fx2-mut" style="margin:-.25rem 0 .5rem">${esc(f.nota)}</p>` : ""}<div class="finance-form-grid finance-form-grid--2">`;
      aberta = true;
      continue;
    }
    h += campoHtml(f, o);
  }
  return h + fecha();
}

function lerCampos(panel, campos) {
  const body = {};
  for (const f of campos) {
    if (!f.k || f.t === "calc" || f.t === "html") continue;
    const el = panel.querySelector(`#ff_${f.k.replace(".", "_")}`);
    if (!el) continue;
    if (f.t === "sim") body[f.k] = el.value === "Sim";
    else if (f.t === "multi") body[f.k] = [...el.querySelectorAll("input:checked")].map((i) => i.value);
    else body[f.k] = el.value.trim();
  }
  return body;
}

/** Junta os campos `details.x` num objeto `details`. */
function juntarFicha(body) {
  const det = {};
  Object.keys(body).forEach((k) => {
    if (!k.startsWith("details.")) return;
    det[k.slice(8)] = body[k];
    delete body[k];
  });
  if (Object.keys(det).length) body.details = det;
  return body;
}

// ─── Ficheiros (fotografias e anexos) ─────────────────────────────────────────

const eImagem = (a) => /^image\//i.test(a?.tipo || "") || /\.(png|jpe?g|webp|gif)$/i.test(a?.url || a?.nome || "");

function anexosHtml(titulo, ajuda, o) {
  const L = Array.isArray(o.attachments) ? o.attachments : [];
  return `<section class="fx2-blk fr-sec"><h3>${esc(titulo)}</h3>
    <div class="fr-anexos">${L.map((a) => `<span class="fr-anexo">${eImagem(a) ? `<img src="${esc(getAssetUrl(a.url) || "")}" alt="">` : `<span class="material-symbols-outlined">description</span>`}<a href="${esc(getAssetUrl(a.url) || "#")}" target="_blank" rel="noopener">${esc(a.nome || "ficheiro")}</a>${o.id && pode("edit") ? `<button type="button" data-fr-anexo-rm="${esc(a.url)}" title="Tirar">✕</button>` : ""}</span>`).join("") || `<span class="fx2-mut">Sem ficheiros.</span>`}</div>
    ${pode(o.id ? "edit" : "create") ? `<label class="fr-enviar"><span class="material-symbols-outlined">upload_file</span> ${esc(ajuda)}<input type="file" data-fr-anexos multiple accept="image/*,application/pdf" hidden></label><span class="fx2-mut" data-fr-anexos-pend></span>` : ""}
  </section>`;
}

function fotosHtml(slots, o, { foto = false } = {}) {
  const P = foto ? { foto: o.photo } : o.photos || {};
  return `<section class="fx2-blk fr-sec"><h3>${foto ? "Fotografia" : "Fotografias (Estado da Viatura)"}</h3>
    <div class="fr-fotos">${slots
      .map(([k, l]) => `<label class="fr-foto" data-fr-slot="${esc(k)}">${P[k] ? `<img src="${esc(getAssetUrl(P[k]) || "")}" alt="">` : `<span class="fr-foto-vazio material-symbols-outlined">add_a_photo</span>`}<b>${esc(l)}</b>${pode(o.id ? "edit" : "create") ? `<input type="file" accept="image/*" hidden data-fr-foto="${esc(k)}"><span class="fx2-mut">${P[k] ? "Substituir" : "Carregar"}</span>` : ""}</label>`)
      .join("")}</div>
    ${foto ? "" : `<p class="fx2-mut" style="margin:.4rem 0 0">A fotografia 3/4 frente fica como imagem da viatura.</p>`}</section>`;
}

/** Liga os ficheiros escolhidos; devolve a função que os envia depois de gravar. */
function ligarFicheiros(panel, col, o) {
  const pend = [];
  panel.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-fr-anexos]")) {
      [...t.files].forEach((file) => pend.push({ file }));
      const info = panel.querySelector("[data-fr-anexos-pend]");
      if (info) info.textContent = `${pend.filter((p) => !p.slot).length} ficheiro(s) para enviar ao gravar`;
    }
    if (t.matches("[data-fr-foto]")) {
      const file = t.files[0];
      if (!file) return;
      const slot = t.dataset.frFoto;
      const i = pend.findIndex((p) => p.slot === slot);
      if (i >= 0) pend.splice(i, 1);
      pend.push({ file, slot });
      const box = t.closest(".fr-foto");
      const img = box.querySelector("img") || document.createElement("img");
      img.src = URL.createObjectURL(file);
      box.querySelector(".fr-foto-vazio")?.replaceWith(img);
    }
  });
  panel.addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-fr-anexo-rm]");
    if (!rm || !o.id) return;
    e.preventDefault();
    if (!confirm("Tirar este ficheiro do registo?")) return;
    try {
      await apiRequest(`/fleet/${col}/${o.id}/files`, { method: "DELETE", body: { url: rm.dataset.frAnexoRm } });
      rm.closest(".fr-anexo").remove();
      o.attachments = (o.attachments || []).filter((a) => a.url !== rm.dataset.frAnexoRm);
    } catch (er) {
      toast(er.message || "Não foi possível tirar o ficheiro.", { type: "error" });
    }
  });
  return async (id) => {
    for (const p of pend) {
      await apiUpload(`/fleet/${col}/${id}/files`, { file: p.file, fieldName: "file", extraFields: p.slot ? { slot: p.slot } : undefined });
    }
    return pend.length;
  };
}

/**
 * Abre o formulário de um registo. `col` é a colecção da API (vehicles, fuel…).
 * `extraAntes` / `extraHtml`: blocos antes e depois dos ficheiros; `ficheiros(o)`: HTML das fotos / anexos.
 */
function formRegisto({ col, titulo, campos, o = {}, extraHtml = "", ficheiros = null, botoes = "", onRender, prepararCorpo, depois }) {
  const novo = !o.id;
  const podeGravar = novo ? pode("create") : pode("edit");
  openModal({
    title: titulo,
    width: 860,
    primaryLabel: podeGravar ? "Gravar" : "",
    secondaryLabel: podeGravar ? "Cancelar" : "Fechar",
    contentHtml: `${camposHtml(campos, o)}${extraHtml}${ficheiros ? ficheiros(o) : ""}
      <div class="fr-rodape">${!novo && pode("delete") ? `<button type="button" class="finance-btn fr-apagar" data-fr-apagar>Apagar</button>` : ""}${botoes}</div>`,
    onRender: ({ panel, close }) => {
      let enviarFicheiros = async () => 0;
      if (ficheiros) enviarFicheiros = ligarFicheiros(panel, col, o);
      panel._enviarFicheiros = enviarFicheiros;
      if (!podeGravar) panel.querySelectorAll("input, select, textarea").forEach((el) => (el.disabled = true));
      // campos que aparecem conforme os outros, quadros calculados e obrigatórios condicionais
      const atualizar = () => {
        const v = lerCampos(panel, campos);
        for (const f of campos) {
          if (!f.k) continue;
          const box = panel.querySelector(`[data-campo="${f.k}"]`);
          if (box && f.mostrar) box.hidden = !f.mostrar(v, o);
          if (box && f.reqSe) box.querySelector(".fr-req").hidden = !(f.req || f.reqSe(v, o));
          if (f.dica) {
            const h = panel.querySelector(`[data-hint="${f.k}"]`);
            if (h) h.textContent = f.dica(v, o) || f.hint || "";
          }
          if (f.t === "calc") panel.querySelector(`[data-calc="${f.k}"]`).innerHTML = f.html(v, o);
        }
        panel.querySelectorAll("[data-secao]").forEach((sec) => {
          const def = campos.find((f) => f.sec && (f.id || f.sec) === sec.dataset.secao);
          if (def?.mostrar) sec.hidden = !def.mostrar(v, o);
        });
      };
      panel._atualizar = atualizar;
      panel.addEventListener("input", atualizar);
      panel.addEventListener("change", atualizar);
      atualizar();
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
      onRender?.({ panel, close, atualizar });
    },
    onPrimary: async ({ panel, close }) => {
      let body = lerCampos(panel, campos);
      const v = body;
      const visiveis = campos.filter((f) => f.k && !(f.mostrar && !f.mostrar(v, o)) && !campos.some((s) => s.sec && s.mostrar && !s.mostrar(v, o) && secaoDe(campos, f) === s));
      const falta = visiveis.filter((f) => (f.req || (f.reqSe && f.reqSe(v, o))) && (body[f.k] === "" || body[f.k] === undefined || (Array.isArray(body[f.k]) && !body[f.k].length))).map((f) => f.l);
      if (falta.length) return toast(`Falta preencher: ${falta.join(", ")}.`, { type: "error" });
      // campos escondidos não são gravados (ex.: secção de acidente numa avaria)
      campos.forEach((f) => {
        if (f.k && !visiveis.includes(f) && f.t !== "calc" && f.limparEscondido) delete body[f.k];
      });
      body = juntarFicha(body);
      if (prepararCorpo) body = prepararCorpo(body, panel);
      try {
        const r = await apiRequest(novo ? `/fleet/${col}` : `/fleet/${col}/${o.id}`, { method: novo ? "POST" : "PATCH", body });
        const n = await panel._enviarFicheiros(r.id);
        close();
        toast(`${novo ? `Registo ${r.code || ""} criado` : "Alterações gravadas"}${n ? ` · ${n} ficheiro(s) enviado(s)` : ""}.`);
        await depois?.(r);
        carregar();
      } catch (e) {
        toast(e.message || "Não foi possível gravar.", { type: "error" });
      }
    },
  });
}

/** A secção a que pertence um campo (a última `{ sec }` antes dele). */
function secaoDe(campos, f) {
  let s = null;
  for (const c of campos) {
    if (c.sec) s = c;
    if (c === f) return s;
  }
  return s;
}

const L = () => S.d.listas;

// ─── Viatura / máquina (FXDRAW.frota + v538 + v597 + v664 do protótipo) ──────

function perfilViatura(v) {
  const ano = S.d.hoje.slice(0, 4);
  const linhas = [
    ...S.d.abastecimentos.filter((a) => a.vehicleId === v.id).map((a) => [a.date, Number(a.amount) || 0]),
    ...S.d.intervencoes.filter((i) => i.vehicleId === v.id).map((i) => [i.date, i._total || 0]),
    ...S.d.ocorrencias.filter((x) => x.vehicleId === v.id).map((x) => [x.closedAt || x.date, Number(x.cost) || 0]),
    ...S.d.documentos.filter((d) => d.vehicleId === v.id).map((d) => [d.issueDate || "", Number(d.cost) || 0]),
  ];
  const tot = linhas.reduce((s, x) => s + x[1], 0);
  const tAno = linhas.filter((x) => String(x[0]).slice(0, 4) === ano).reduce((s, x) => s + x[1], 0);
  const cons = S.d.abastecimentos.filter((a) => a.vehicleId === v.id).map((a) => a._calc?.cons).filter((x) => x > 0);
  const nI = S.d.intervencoes.filter((i) => i.vehicleId === v.id).length;
  const nO = S.d.ocorrencias.filter((x) => x.vehicleId === v.id).length;
  const segs = S.d.seguros.filter((s) => (s.vehicleIds || []).includes(v.id));
  return `<section class="fx2-blk fr-sec"><h3 style="display:flex;align-items:center;gap:.5rem">Perfil da Viatura <a class="finance-btn" style="margin-left:auto" href="/frota/custos?viatura=${esc(v.id)}">Custos e histórico</a></h3>
      <div class="fr-perfil">
        <div><span>Custo total</span><b>${kz(tot)}</b></div><div><span>Custo de ${ano}</span><b>${kz(tAno)}</b></div>
        <div><span>Consumo médio</span><b>${cons.length ? `${(cons.reduce((s, x) => s + x, 0) / cons.length).toFixed(1)} L/100` : "—"}</b></div>
        <div><span>Intervenções</span><b>${nI}</b></div><div><span>Ocorrências</span><b>${nO}</b></div>
        <div><span>Manutenção</span><b>${pill(v._planos?.t || "—", v._planos?.k || "neu")}</b></div>
      </div></section>
    <section class="fx2-blk fr-sec"><h3>Seguro</h3>${
      segs.length
        ? `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Apólice</th><th>Seguradora</th><th>Coberturas</th><th>Validade</th><th>Estado</th></tr></thead><tbody>${segs.map((s) => `<tr><td><b>${esc(s.policyNumber)}</b></td><td>${esc(s.insurer)}</td><td class="fx2-mut">${esc((s.coverages || []).join(", "))}</td><td>${fmtData(s.startDate)} – ${fmtData(s.endDate)}</td><td>${pill(s._estado[0], s._estado[1])}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="fx2-mut">Nenhuma apólice cobre esta viatura.</p>`
    }${pode("create") ? `<button type="button" class="finance-btn" data-fr-segnovo="${esc(v.id)}">+ Nova apólice para esta viatura</button>` : ""}</section>`;
}

function formViatura(o = { tipologia: "VIATURA", unit: "KM", ownership: "PROPRIA", status: "Operacional", active: true, maintenancePlans: [], details: {}, photos: {} }) {
  const tipos = [...new Set(S.d.viaturas.map((v) => v.kind).filter(Boolean))].sort();
  const tractores = S.d.viaturas.filter((v) => v.id !== o.id && ativa(v) && v.tipologia !== "TRAILER");
  const T = (v) => v.tipologia || "VIATURA";
  const campos = [
    { sec: "Tipologia e Empresa" },
    { k: "tipologia", l: "Tipologia", t: "select", req: 1, opts: L().tipologias, hint: "Decide a unidade (km ou horas) e o grupo nos filtros" },
    { k: "company", l: "Empresa proprietária", t: "select", opts: lista(["", ...L().empresas]) },
    { k: "details.dataMat", l: "Data da matrícula", t: "date" },
    { k: "details.vendedor", l: "Vendedor / fornecedor" },
    { sec: "Dados da Viatura / Máquina" },
    { k: "kind", l: "Tipo", req: 1, ph: "LIGEIRA, PESADA, ESCAVADORA, GERADOR…", list: "frTipos" },
    { k: "unit", l: "Unidade de utilização", t: "select", opts: L().unidades },
    { k: "plate", l: "Matrícula", req: 1, ph: "ex.: LD-12-34-AB" },
    { k: "brand", l: "Marca", req: 1 },
    { k: "model", l: "Modelo", req: 1 },
    { k: "year", l: "Ano", t: "number" },
    { k: "tankCapacity", l: "Capacidade do depósito (L)", t: "number" },
    { k: "refConsumption", l: "Consumo de referência", t: "number", dica: (v) => (v.unit === "HORAS" ? "L/h" : "L/100 km") },
    { k: "odometer", l: "Km / horas atuais", t: "number", dica: (v) => (v.unit === "HORAS" ? "horas atuais" : "km atuais") },
    { k: "acquisitionValue", l: "Valor de aquisição (Kz)", t: "number" },
    { k: "ownership", l: "Propriedade", t: "select", opts: L().propriedades },
    { k: "assignedTo", l: "Atribuída a", ph: "SEDE, OBRA, DIRECÇÃO…" },
    { k: "projectId", l: "Obra", t: "select", opts: optsObras(), mostrar: (v) => /OBRA/i.test(v.assignedTo || "") || Boolean(v.projectId) },
    { sec: "Estado, Identificação e Motorista" },
    { k: "status", l: "Estado da viatura", t: "select", req: 1, opts: lista(L().estadosViatura) },
    { k: "driverId", l: "Motorista habitual", t: "select", opts: optsMotoristas(o.driverId) },
    { k: "fuel", l: "Combustível", t: "select", opts: lista(["", ...L().combustiveis]) },
    { k: "details.caixa", l: "Caixa", t: "select", opts: lista(["", ...L().caixas]) },
    { k: "details.cor", l: "Cor" },
    { k: "details.vin", l: "N.º de chassis / VIN" },
    { k: "details.motor", l: "N.º do motor" },
    { k: "details.versao", l: "Versão" },
    { k: "details.cilindrada", l: "Cilindrada (cc)", t: "number" },
    { k: "details.potencia", l: "Potência (cv)", t: "number", mostrar: (v) => v.tipologia !== "TRAILER" },
    { k: "details.dataEntrada", l: "Data de entrada na frota", t: "date" },
    { k: "details.kmInicial", l: "Km inicial", t: "number" },
    { k: "details.base", l: "Base / localização", ph: "ex.: POLIS, LUANDA" },
    { k: "details.departamento", l: "Departamento", ph: "ex.: OPERAÇÕES" },
    { sec: "Trailer, Eixos e Pneus" },
    { k: "details.tractorId", l: "Atrelado a (tractor)", t: "select", opts: [["", "— nenhum —"], ...tractores.map((v) => [v.id, vLbl(v)])], mostrar: (v) => v.tipologia === "TRAILER" },
    { k: "details.eixos", l: "Configuração de eixos", t: "select", full: 1, opts: [["", "Automático (pela tipologia)"], ...L().eixos] },
    { k: "details.suplentes", l: "Pneus suplentes", t: "number", ph: "1" },
    { sec: "Ficha Técnica Completa" },
    { k: "details.tracao", l: "Tração", t: "select", opts: lista(["", ...L().tracao]), mostrar: (v) => v.tipologia !== "TRAILER" },
    { k: "details.lugares", l: "Lugares", t: "number", mostrar: (v) => v.tipologia === "VIATURA" },
    { k: "details.pbt", l: "Peso bruto (kg)", t: "number" },
    { k: "details.tara", l: "Tara (kg)", t: "number" },
    { k: "details.carga", l: "Carga útil (kg)", t: "number" },
    { k: "details.capac", l: "Capacidade / equipamento", ph: "ex.: 3 t a 4 m, 250 kVA", mostrar: (v) => v.tipologia === "EQUIPAMENTO" || v.tipologia === "MAQUINA" },
    { k: "details.dim", l: "Dimensões C × L × A (m)", ph: "ex.: 5,3 × 1,85 × 1,8" },
    { sec: "Pneus e Jantes" },
    { k: "details.pnF", l: "Medida pneus frente", ph: "ex.: 265/65 R17" },
    { k: "details.pnT", l: "Medida pneus trás", ph: "ex.: 265/65 R17" },
    { k: "details.pnMarca", l: "Marca dos pneus" },
    { k: "details.jante", l: "Jante", t: "select", opts: lista(["", ...L().jantes]) },
    { k: "details.janteMed", l: "Medida da jante", ph: "ex.: 17 × 7,5J" },
    { k: "details.furos", l: "Fixação (furos / PCD)", ph: "ex.: 6 × 139,7" },
    { k: "details.prF", l: "Pressão frente (bar)", ph: "ex.: 2,4" },
    { k: "details.prT", l: "Pressão trás (bar)", ph: "ex.: 2,6" },
    { sec: "Segurança e Equipamento" },
    { k: "details.gps", l: "Rastreador / GPS", ph: "empresa e n.º" },
    { k: "details.extintor", l: "Extintor — validade", t: "date" },
    { k: "details.kit", l: "Kit de segurança", ph: "triângulo, colete, macaco, chave de rodas…", full: 1 },
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
  const extraHtml = `<datalist id="frTipos">${tipos.map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
    <section class="fx2-blk fr-sec"><h3>Manutenção — Planos Preventivos</h3>
      <p class="fx2-mut" style="margin:0 0 .5rem">Ex.: revisão a cada 10 000 km ou 12 meses. A intervenção que cumpre o plano atualiza a última execução.</p>
      <div class="fx2-tw"><table class="fx2-t"><thead><tr><th>Plano</th><th>Cada (km / h)</th><th>Cada (meses)</th><th>Última (km / h)</th><th>Última (data)</th><th></th></tr></thead>
      <tbody data-planos>${planos.map(linhaPlano).join("")}</tbody></table></div>
      <button type="button" class="finance-btn" data-p-add style="margin-top:.5rem">+ Plano</button></section>
    ${o.id ? perfilViatura(o) : `<section class="fx2-blk fr-sec"><h3>Seguro</h3><p class="fx2-mut">Grave a viatura e depois associe-a a uma apólice.</p></section>`}`;
  formRegisto({
    col: "vehicles",
    titulo: o.id ? `${o.code} · ${vLbl(o)}` : "Nova Viatura / Equipamento",
    campos,
    o: { ...o, tipologia: T(o) },
    extraHtml,
    ficheiros: (x) => fotosHtml(L().fotos, x) + anexosHtml("Documentos", "Juntar livrete, título, fotografias… (imagens ou PDF)", x),
    onRender: ({ panel, close }) => {
      const tb = panel.querySelector("[data-planos]");
      panel.querySelector("[data-p-add]").addEventListener("click", () => tb.insertAdjacentHTML("beforeend", linhaPlano()));
      tb.addEventListener("click", (e) => e.target.closest("[data-p-rm]")?.closest("tr").remove());
      // máquinas e equipamentos contam horas
      const tip = panel.querySelector("#ff_tipologia");
      tip.addEventListener("change", () => {
        if (["MAQUINA", "EQUIPAMENTO"].includes(tip.value) && !o.id) panel.querySelector("#ff_unit").value = "HORAS";
        if (!["MAQUINA", "EQUIPAMENTO"].includes(tip.value) && !o.id) panel.querySelector("#ff_unit").value = "KM";
      });
      panel.querySelector("[data-fr-segnovo]")?.addEventListener("click", () => {
        close();
        formSeguro(null, o.id);
      });
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

// ─── Motorista (ENT.fmot + v664 fotografia) ───────────────────────────────────

function formMotorista(o = { status: "Ativo", licenseCategory: "B" }) {
  const hist = () => {
    if (!o.id) return "";
    const A = S.d.abastecimentos.filter((x) => x.driverId === o.id);
    const O = S.d.ocorrencias.filter((x) => x.driverId === o.id);
    const V = S.d.viaturas.filter((v) => v.driverId === o.id).map((v) => v.plate);
    return `<section class="fx2-blk fr-sec"><h3>Historial</h3><p style="margin:0">${A.length} abastecimento(s) · ${fmt0(A.reduce((s, a) => s + Number(a.liters || 0), 0))} L · ${O.length} ocorrência(s)${O.length ? `: ${O.slice(0, 6).map((x) => esc(`${x.type} ${fmtData(x.date)}`)).join(", ")}` : ""}${V.length ? ` · motorista habitual de ${esc(V.join(", "))}` : ""}</p></section>`;
  };
  formRegisto({
    col: "drivers",
    titulo: o.id ? `${o.code} · ${o.name}` : "Novo Motorista",
    o,
    campos: [
      { sec: "Motorista" },
      { k: "name", l: "Nome", req: 1, full: 1 },
      { k: "phone", l: "Telefone" },
      { k: "status", l: "Estado", t: "select", opts: lista(["Ativo", "Inativo"]) },
      { k: "licenseNumber", l: "N.º da carta de condução" },
      { k: "licenseCategory", l: "Categoria", t: "select", opts: lista(L().categoriasCarta) },
      { k: "licenseExpiry", l: "Validade da carta", t: "date" },
      { k: "department", l: "Departamento" },
      { k: "projectId", l: "Obra", t: "select", opts: optsObras() },
      { k: "notes", l: "Observações", t: "textarea", full: 1 },
    ],
    extraHtml: hist(),
    ficheiros: (x) => fotosHtml([["foto", "Fotografia do motorista"]], x, { foto: true }) + anexosHtml("Documentos", "Cópia da carta, BI, outros", x),
  });
}

// ─── Abastecimento (ENT.fab) ──────────────────────────────────────────────────

/** O abastecimento anterior da mesma viatura (pela data e hora). */
function abastAnterior(v) {
  if (!v.vehicleId) return null;
  const chave = `${v.date || ""}${v.time || "~"}`;
  return S.d.abastecimentos
    .filter((a) => a.vehicleId === v.vehicleId && a.id !== v._id && a.odometer !== null && `${a.date}${a.time || ""}` <= chave)
    .sort((a, b) => `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`) || a.odometer - b.odometer)
    .slice(-1)[0];
}

function analiseAbast(v) {
  const viat = vById(v.vehicleId);
  const pr = abastAnterior(v);
  const km = nr(v.odometer);
  const lt = nr(v.liters);
  const valor = nr(v.amount) ?? (lt && nr(v.pricePerLiter) ? lt * nr(v.pricePerLiter) : null);
  const perc = pr && km !== null ? km - Number(pr.odometer) : null;
  const cons = perc > 0 && lt ? (lt / perc) * 100 : null;
  const W = [];
  if (perc !== null && perc < 0) W.push(["bad", `Os km (${fmt0(km)}) são inferiores aos do abastecimento anterior (${fmt0(pr.odometer)} em ${fmtData(pr.date)}). Escreva a justificação.`]);
  if (viat && Number(viat.tankCapacity) > 0 && lt > Number(viat.tankCapacity) * 1.05) W.push(["warn", `Litros acima da capacidade do depósito (${fmt0(viat.tankCapacity)} L).`]);
  if (cons && viat && Number(viat.refConsumption) > 0 && (cons > viat.refConsumption * 1.3 || cons < viat.refConsumption * 0.7)) W.push(["warn", `Consumo de ${cons.toFixed(1)} L/100 km, fora da referência da viatura (${Number(viat.refConsumption).toFixed(1)}).`]);
  return { pr, perc, cons, valor, W, mau: W.some((w) => w[0] === "bad") };
}

function formAbastecimento(o) {
  o = o || { date: S.d.hoje, vehicleId: S.v || "", fuelType: "Gasóleo", fullTank: true, paymentMethod: "Cartão de Combustível" };
  formRegisto({
    col: "fuel",
    titulo: o.id ? `${o.code} · ${vMat(o.vehicleId)}` : "Novo Abastecimento",
    o,
    campos: [
      { sec: "Abastecimento" },
      { k: "vehicleId", l: "Viatura", t: "select", req: 1, opts: optsViaturas(o.vehicleId) },
      { k: "driverId", l: "Motorista", t: "select", opts: optsMotoristas(o.driverId) },
      { k: "date", l: "Data", t: "date", req: 1 },
      { k: "time", l: "Hora", t: "time" },
      {
        k: "odometer", l: "Km da viatura", t: "number", req: 1,
        dica: (v) => {
          const pr = abastAnterior({ ...v, _id: o.id });
          const viat = vById(v.vehicleId);
          return pr ? `anterior: ${fmt0(pr.odometer)} em ${fmtData(pr.date)}` : viat?.odometer !== null && viat?.odometer !== undefined ? `atual na ficha: ${fmt0(viat.odometer)}` : "";
        },
      },
      { k: "liters", l: "Litros", t: "number", req: 1 },
      { k: "pricePerLiter", l: "Preço por litro (Kz)", t: "number" },
      { k: "amount", l: "Valor total (Kz)", t: "number", dica: (v) => (!v.amount && nr(v.liters) && nr(v.pricePerLiter) ? `= ${kz(nr(v.liters) * nr(v.pricePerLiter))} (litros × preço)` : "") },
      { k: "fuelType", l: "Combustível", t: "select", opts: lista(L().combustiveis) },
      { k: "fullTank", l: "Depósito cheio", t: "sim" },
      { k: "station", l: "Posto" },
      { k: "paymentMethod", l: "Pagamento", t: "select", opts: lista(L().pagamentos) },
      { k: "receipt", l: "N.º do recibo" },
      { k: "projectId", l: "Obra", t: "select", opts: optsObras() },
      { k: "notes", l: "Observações", full: 1 },
      {
        k: "_calc", t: "calc",
        html: (v) => {
          const a = analiseAbast({ ...v, _id: o.id });
          const kpi = a.perc !== null || a.cons ? `<div class="fr-perfil"><div><span>Km percorridos</span><b>${a.perc !== null ? fmt0(a.perc) : "—"}</b></div><div><span>Consumo</span><b>${a.cons ? `${a.cons.toFixed(1)} L/100 km` : "—"}</b></div><div><span>Custo por km</span><b>${a.perc > 0 && a.valor ? kz(a.valor / a.perc) : "—"}</b></div></div>` : "";
          const av = a.W.length ? `<div class="fr-avisos">${a.W.map(([t, x]) => `${pill(t === "bad" ? "Atenção" : "Aviso", t)} ${esc(x)}`).join("<br>")}</div>` : "";
          return kpi + av;
        },
      },
      { k: "justification", l: "Justificação", full: 1, mostrar: (v) => analiseAbast({ ...v, _id: o.id }).mau || Boolean(v.justification), reqSe: (v) => analiseAbast({ ...v, _id: o.id }).mau, hint: "ex.: conta-quilómetros substituído" },
    ],
    ficheiros: (x) => anexosHtml("Comprovativo", "Recibo / talão (imagem ou PDF)", x),
    onRender: ({ panel, atualizar }) => {
      // como no protótipo: a viatura sugere o combustível e o motorista habitual
      const sel = panel.querySelector("#ff_vehicleId");
      sel.addEventListener("change", () => {
        const v = vById(sel.value);
        if (!v) return;
        if (v.fuel) panel.querySelector("#ff_fuelType").value = v.fuel;
        const m = panel.querySelector("#ff_driverId");
        if (v.driverId && !m.value) m.value = v.driverId;
        atualizar();
      });
    },
  });
}

// ─── Intervenção (ENT.fint) ───────────────────────────────────────────────────

function formIntervencao(o) {
  o = o || { date: S.d.hoje, entryDate: S.d.hoje, vehicleId: S.v || "", type: "Manutenção Preventiva", status: "Concluída", planIds: [], parts: [] };
  const v0 = vById(o.vehicleId);
  const planosOpts = (veh) => (veh?.maintenancePlans || []).map((p) => [p.id, `${p.nome} (${(veh._planosDet || []).find((x) => x.id === p.id)?.t || ""})`]);
  const ocorrOpts = (vid) => [["", "— nenhuma —"], ...S.d.ocorrencias.filter((x) => x.vehicleId === vid && (!FECHADA.includes(x.status) || x.id === o.incidentId)).map((x) => [x.id, `${x.code} · ${x.type} · ${fmtData(x.date)}`])];
  const linhaPeca = (l = {}) => `<tr data-peca><td><input class="finance-input" data-c="cod" value="${esc(l.cod || "")}" placeholder="código"></td><td><input class="finance-input" data-c="desc" value="${esc(l.desc || "")}" placeholder="peça / material"></td><td><input class="finance-input r" data-c="qtd" type="number" min="0" step="any" value="${esc(l.qtd ?? "")}"></td><td><input class="finance-input r" data-c="pu" type="number" min="0" step="any" value="${esc(l.pu ?? "")}"></td><td class="r" data-c-tot>${kz((Number(l.qtd) || 0) * (Number(l.pu) || 0))}</td><td><button type="button" class="finance-btn" data-peca-rm title="Remover">✕</button></td></tr>`;
  const pecas = (panel) => [...panel.querySelectorAll("[data-peca]")].map((tr) => Object.fromEntries([...tr.querySelectorAll("[data-c]")].map((el) => [el.dataset.c, el.value.trim()])));
  const totPecas = (panel) => pecas(panel).reduce((s, l) => s + (nr(l.qtd) || 0) * (nr(l.pu) || 0), 0);
  let painelRef = null;
  formRegisto({
    col: "interventions",
    titulo: o.id ? `${o.code} · ${vMat(o.vehicleId)}` : "Nova Intervenção",
    o,
    campos: [
      { sec: "Intervenção" },
      { k: "vehicleId", l: "Viatura", t: "select", req: 1, opts: optsViaturas(o.vehicleId) },
      { k: "date", l: "Data", t: "date", req: 1 },
      { k: "odometer", l: "Km da viatura", t: "number", dica: (v) => (vById(v.vehicleId)?.odometer != null ? `atual na ficha: ${fmt0(vById(v.vehicleId).odometer)}` : "") },
      { k: "type", l: "Tipo de intervenção", t: "select", req: 1, opts: lista(L().tiposIntervencao) },
      { k: "system", l: "Sistema / componente", t: "select", opts: lista(["", ...L().sistemas]) },
      { k: "status", l: "Estado", t: "select", opts: lista(["Aberta", "Em curso", "Concluída"]), hint: "Enquanto não estiver concluída, a viatura fica «Em manutenção»" },
      { k: "description", l: "Descrição do serviço", t: "textarea", req: 1, full: 1 },
      { k: "workshop", l: "Oficina / fornecedor", list: "frOficinas" },
      { k: "technician", l: "Técnico responsável" },
      { k: "entryDate", l: "Entrada na oficina", t: "date" },
      {
        k: "exitDate", l: "Saída da oficina", t: "date",
        dica: (v) => (v.entryDate && v.exitDate ? `${Math.max(0, Math.round((Date.parse(v.exitDate) - Date.parse(v.entryDate)) / 864e5))} dia(s) parada` : ""),
      },
      { k: "incidentId", l: "Ocorrência associada", t: "select", opts: ocorrOpts(o.vehicleId) },
      { sec: "Peças e Custos" },
      { k: "_pecas", t: "html", html: `<div class="fx2-tw"><table class="fx2-t"><thead><tr><th style="width:16%">Código</th><th>Peça / material</th><th class="r" style="width:12%">Qtd</th><th class="r" style="width:16%">Preço un.</th><th class="r" style="width:16%">Total</th><th></th></tr></thead><tbody data-pecas>${(o.parts || []).map(linhaPeca).join("")}</tbody></table></div><button type="button" class="finance-btn" data-peca-add style="margin-top:.4rem">+ Peça</button>` },
      { k: "laborCost", l: "Mão-de-obra (Kz)", t: "number" },
      { k: "otherCost", l: "Outros custos / serviços (Kz)", t: "number" },
      { k: "partsCost", l: "Peças (Kz)", t: "number", hint: "Preenchido pelas linhas de peças, quando as há", mostrar: () => !painelRef || !pecas(painelRef).some((l) => l.desc || l.qtd) },
      { k: "warranty", l: "Garantia", ph: "ex.: 5 000 KM / 6 MESES" },
      {
        k: "_tot", t: "calc",
        html: (v) => {
          const p = painelRef && pecas(painelRef).some((l) => l.desc || l.qtd) ? totPecas(painelRef) : nr(v.partsCost) || 0;
          return `<div class="fr-perfil"><div><span>Custo total</span><b style="font-size:1.15rem">${kz((nr(v.laborCost) || 0) + (nr(v.otherCost) || 0) + p)}</b></div></div>`;
        },
      },
      { sec: "Planos Preventivos Cumpridos", nota: "Os planos marcados ficam com a última manutenção nesta data e nestes km." },
      { k: "planIds", l: "Planos", t: "multi", full: 1, opts: planosOpts(v0), vazio: "Esta viatura não tem planos preventivos (defina-os na ficha da viatura)." },
      { sec: "Próxima Acção" },
      { k: "nextAction", l: "Próxima acção", full: 1 },
      { k: "nextDate", l: "Próxima data", t: "date" },
      { k: "nextOdometer", l: "Próximo km", t: "number" },
      { k: "notes", l: "Observações", t: "textarea", full: 1 },
    ],
    extraHtml: `<datalist id="frOficinas"><option value="OFICINA MBT">${[...new Set(S.d.intervencoes.map((i) => i.workshop).filter(Boolean))].map((w) => `<option value="${esc(w)}">`).join("")}</datalist>`,
    ficheiros: (x) => anexosHtml("Documentos", "Fatura, orçamento, fotografias", x),
    onRender: ({ panel, atualizar }) => {
      painelRef = panel;
      const tb = panel.querySelector("[data-pecas]");
      panel.querySelector("[data-peca-add]").addEventListener("click", () => {
        tb.insertAdjacentHTML("beforeend", linhaPeca());
        atualizar();
      });
      tb.addEventListener("click", (e) => {
        if (!e.target.closest("[data-peca-rm]")) return;
        e.target.closest("tr").remove();
        atualizar();
      });
      tb.addEventListener("input", (e) => {
        const tr = e.target.closest("[data-peca]");
        if (!tr) return;
        const q = nr(tr.querySelector('[data-c="qtd"]').value) || 0;
        const p = nr(tr.querySelector('[data-c="pu"]').value) || 0;
        tr.querySelector("[data-c-tot]").textContent = kz(q * p);
      });
      const sel = panel.querySelector("#ff_vehicleId");
      sel.addEventListener("change", () => {
        const veh = vById(sel.value);
        const box = panel.querySelector("#ff_planIds");
        const ops = planosOpts(veh);
        box.innerHTML = ops.length ? ops.map(([id, l]) => `<label><input type="checkbox" value="${esc(id)}"> ${esc(l)}</label>`).join("") : `<span class="fx2-mut">Esta viatura não tem planos preventivos.</span>`;
        panel.querySelector("#ff_incidentId").innerHTML = ocorrOpts(sel.value).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
        if (veh?.odometer !== null && veh?.odometer !== undefined && !panel.querySelector("#ff_odometer").value) panel.querySelector("#ff_odometer").value = veh.odometer;
      });
      atualizar();
    },
    prepararCorpo: (body, panel) => {
      body.parts = pecas(panel).filter((l) => l.cod || l.desc || l.qtd);
      return body;
    },
  });
}

// ─── Ocorrência (ENT.focr) ────────────────────────────────────────────────────

const eAcidente = (v) => /acidente|furto|roubo|dano|vandal/i.test(v.type || "");

function formOcorrencia(o) {
  o = o || { date: S.d.hoje, vehicleId: S.v || "", type: "Avaria", severity: "Média", status: "Aberta", immobilizes: false };
  formRegisto({
    col: "incidents",
    titulo: o.id ? `${o.code} · ${vMat(o.vehicleId)}` : "Nova Ocorrência",
    o,
    campos: [
      { sec: "Ocorrência" },
      { k: "vehicleId", l: "Viatura", t: "select", req: 1, opts: optsViaturas(o.vehicleId) },
      {
        k: "driverId", l: "Motorista envolvido", t: "select", opts: optsMotoristas(o.driverId),
        dica: (v) => {
          if (!v.driverId) return "";
          const lim = new Date(Date.parse(`${v.date || S.d.hoje}T00:00:00Z`) - 365 * 864e5).toISOString().slice(0, 10);
          const n = S.d.ocorrencias.filter((x) => x.id !== o.id && x.driverId === v.driverId && String(x.date) >= lim).length;
          return n ? `⚠ ${n} outra(s) ocorrência(s) deste motorista nos últimos 12 meses` : "";
        },
      },
      { k: "date", l: "Data", t: "date", req: 1 },
      { k: "time", l: "Hora", t: "time" },
      { k: "type", l: "Tipo de ocorrência", t: "select", req: 1, opts: lista(L().tiposOcorrencia) },
      { k: "severity", l: "Gravidade", t: "select", req: 1, opts: lista(L().gravidades) },
      { k: "location", l: "Local", full: 1 },
      { k: "description", l: "O que aconteceu", t: "textarea", req: 1, full: 1 },
      { k: "immobilizes", l: "Imobiliza a viatura", t: "sim", hint: "Se sim, a viatura fica «Avariada» ou «Acidentada» até a ocorrência ser resolvida" },
      { k: "reference", l: "Ref. / n.º do auto / participação" },
      { sec: "Acidente / Sinistro", id: "acidente", mostrar: eAcidente },
      { k: "injuries", l: "Houve feridos", t: "sim" },
      { k: "insuranceClaim", l: "Participado ao seguro", t: "sim" },
      { k: "claimRef", l: "N.º da apólice / processo" },
      { k: "thirdParties", l: "Terceiros envolvidos (nome, matrícula, contacto, seguradora)", t: "textarea", full: 1 },
      { sec: "Tratamento" },
      { k: "action", l: "Acção tomada / a tomar", t: "textarea", full: 1 },
      { k: "responsible", l: "Responsável pelo tratamento" },
      { k: "deadline", l: "Prazo", t: "date" },
      { k: "status", l: "Estado", t: "select", opts: lista(L().estadosOcorrencia) },
      { k: "closedAt", l: "Data de fecho", t: "date", mostrar: (v) => FECHADA.includes(v.status) },
      { k: "estimatedCost", l: "Custo estimado (Kz)", t: "number" },
      { k: "cost", l: "Custo real (Kz)", t: "number" },
      { k: "notes", l: "Observações", full: 1 },
    ],
    ficheiros: (x) => anexosHtml("Fotografias e Documentos", "Fotografias, auto, participação, orçamento", x),
  });
}

// ─── Documento (ENT.fdoc) ─────────────────────────────────────────────────────

function formDocumento(o) {
  o = o || { vehicleId: S.v || "", type: "Inspecção Periódica", situation: "Em vigor" };
  const est = o.id ? o._estado : null;
  formRegisto({
    col: "documents",
    titulo: o.id ? `${o.type} · ${vMat(o.vehicleId)}` : "Novo Documento",
    o,
    campos: [
      { sec: est ? `Documento — ${est[0]}` : "Documento" },
      { k: "vehicleId", l: "Viatura", t: "select", req: 1, opts: optsViaturas(o.vehicleId) },
      { k: "type", l: "Tipo de documento", t: "select", req: 1, opts: lista(L().tiposDocumento), dica: (v) => (v.type === "Seguro Automóvel" ? "Para apólices com várias viaturas e pagamentos, use Seguros." : "") },
      { k: "number", l: "N.º do documento" },
      { k: "entity", l: "Entidade emissora" },
      { k: "issueDate", l: "Data de emissão", t: "date" },
      { k: "expiryDate", l: "Data de validade", t: "date" },
      { k: "cost", l: "Custo (Kz)", t: "number" },
      { k: "situation", l: "Situação", t: "select", opts: lista(L().situacoesDocumento) },
      { k: "notes", l: "Observações", full: 1 },
    ],
    ficheiros: (x) => anexosHtml("Ficheiro", "Digitalização do documento", x),
    botoes: o.id && o.expiryDate && pode("create") ? `<button type="button" class="finance-btn" data-fr-renovar>Renovar (novo documento)</button>` : "",
    onRender: ({ panel, close }) => {
      panel.querySelector("[data-fr-renovar]")?.addEventListener("click", () => {
        close();
        // como no protótipo: o novo documento parte do anterior, com emissão hoje
        formDocumento({ vehicleId: o.vehicleId, type: o.type, entity: o.entity, situation: "Em vigor", issueDate: S.d.hoje });
      });
    },
  });
}

// ─── Seguro / apólice (FXDRAW.seg) ────────────────────────────────────────────

function formSeguro(o, vidPre = "") {
  const hoje = S.d.hoje;
  const fim = new Date(`${hoje}T00:00:00Z`);
  fim.setUTCFullYear(fim.getUTCFullYear() + 1);
  o = o || { startDate: hoje, endDate: fim.toISOString().slice(0, 10), periodicity: "ANUAL", coverages: ["Responsabilidade Civil"], vehicleIds: vidPre ? [vidPre] : S.v ? [S.v] : [] };
  const seguradoras = [...new Set(S.d.seguros.map((s) => s.insurer).filter(Boolean))].sort();
  formRegisto({
    col: "insurances",
    titulo: o.id ? `${o.code} · ${o.insurer} · ${o.policyNumber}` : "Nova Apólice",
    o,
    campos: [
      { sec: o.id ? `Apólice — ${o._estado?.[0] || ""}` : "Apólice" },
      { k: "insurer", l: "Seguradora", req: 1, list: "frSeguradoras" },
      { k: "policyNumber", l: "N.º da apólice", req: 1 },
      { k: "periodicity", l: "Periodicidade do pagamento", t: "select", opts: lista(L().periodicidades) },
      { k: "premium", l: "Prémio total (Kz)", t: "number", hint: "valor da apólice para o período" },
      { k: "startDate", l: "Início", t: "date", req: 1 },
      { k: "endDate", l: "Fim / renovação", t: "date", req: 1 },
      { k: "coverages", l: "Coberturas", t: "multi", full: 1, opts: lista([...new Set([...L().coberturas, ...(o.coverages || [])])]) },
      { sec: "Viaturas Cobertas" },
      { k: "vehicleIds", l: "Viaturas", t: "multi", req: 1, full: 1, opts: S.d.viaturas.filter((v) => ativa(v) || (o.vehicleIds || []).includes(v.id)).map((v) => [v.id, vLbl(v)]), vazio: "Ainda não há viaturas registadas. Crie-as primeiro em Frota." },
      { k: "notes", l: "Observações", t: "textarea", full: 1 },
    ],
    extraHtml: `<datalist id="frSeguradoras">${seguradoras.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`,
    ficheiros: (x) => anexosHtml("Documento", "Apólice (PDF)", x),
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

// ─── Painel de Gestão da Frota (o `V.frges` do protótipo, v667) ───────────────

const MES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const mesLbl = (k) => `${MES_CURTO[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;
const COR_CAT = {
  "Combustível": "#1f7a42",
  "Manutenção e Reparação": "#8a5cc2",
  "Pneus": "#2b2f2d",
  "Ocorrências e Sinistros": "#c96b3a",
  "Multas": "#b8372b",
  "Documentos e Taxas": "#c9a227",
};
const CAT_CURTA = { "Combustível": "Combustível", "Manutenção e Reparação": "Manutenção", "Pneus": "Pneus", "Ocorrências e Sinistros": "Sinistros", "Multas": "Multas", "Documentos e Taxas": "Taxas" };

const REGISTOS = [
  ["/frota/abastecimentos", "local_gas_station", "Abastecimentos"],
  ["/frota/manutencoes", "car_repair", "Manutenções e Reparações"],
  ["/frota/planos", "event_repeat", "Planos Preventivos"],
  ["/frota/ocorrencias", "car_crash", "Ocorrências e Acidentes"],
  ["/frota/documentos", "description", "Documentos"],
  ["/frota/seguros", "verified_user", "Seguros"],
  ["/frota/custos", "price_check", "Custos por Viatura"],
  ["/frota/alertas", "notifications_active", "Alertas"],
];

function vistaPainel() {
  const G = S.ov?.gestao;
  if (!G) return vazio("A carregar…");
  const cats = L().categoriasCusto;
  const mx = Math.max(1, ...G.meses.map((m) => m.valor));
  const mxC = Math.max(1, ...G.categorias.map((c) => c.valor));
  const totCat = G.categorias.reduce((s, c) => s + c.valor, 0);
  const opMeses = G.meses.slice().reverse().map((m) => [m.mes, mesLbl(m.mes)]);
  const grupos = `<span class="finance-seg"><button type="button" class="${!S.g ? "active" : ""}" data-frg="">Todas</button>${G.grupos
    .filter((g) => g.n)
    .map((g) => `<button type="button" class="${S.g === g.k ? "active" : ""}" data-frg="${g.k}">${esc(g.l)} (${g.n})</button>`)
    .join("")}</span>`;
  const perSeg = `<span class="finance-seg">${[["mes", MES_CURTO[Number(G.mes.slice(5)) - 1]], ["3", "3 meses"], ["12", "12 meses"]]
    .map(([k, l]) => `<button type="button" class="${S.per === k ? "active" : ""}" data-frpg="${k}">${esc(l)}</button>`)
    .join("")}</span>`;
  const pilha = (m) =>
    cats.map((c) => (m.porCategoria[c] ? `<i style="height:${((m.porCategoria[c] / mx) * 100).toFixed(1)}%;background:${COR_CAT[c]}"></i>` : "")).join("");
  const dica = (m) => `${mesLbl(m.mes)}: ${fmt(m.valor)}${cats.filter((c) => m.porCategoria[c]).map((c) => ` · ${CAT_CURTA[c]} ${fmt(m.porCategoria[c])}`).join("")}`;
  return `
    <div class="fcal-filtros">${select("mes", G.mes, opMeses)}${grupos}
      ${G.alertas.total ? `<a class="fcal-todos" href="/frota/alertas">${pill(`${G.alertas.total} alerta(s)`, G.alertas.altas ? "bad" : "warn")}</a>` : ""}</div>
    ${kpis([
      { tom: "blue", titulo: "Custo do Mês", valor: fmt(G.custoMes), nota: mesLbl(G.mes) },
      { tom: "neu", titulo: "Custo 12 Meses", valor: fmt(G.custo12), nota: `média ${fmt(G.custo12 / 12)} / mês` },
      { tom: "neu", titulo: "Km / Horas no Mês", valor: fmt0(G.km), nota: `${G.viaturasComKm} viatura(s) com leituras` },
      { tom: "neu", titulo: "Custo Médio por km", valor: G.custoPorKm ? fmt(G.custoPorKm) : "—", nota: "Kz" },
      { tom: G.paradas ? "warn" : "good", titulo: "Paradas / na Oficina", valor: String(G.paradas), nota: `${G.ativas} ativa(s)`, acao: "/frota/viaturas" },
      { tom: G.ocorrenciasAbertas ? "warn" : "good", titulo: "Ocorrências Abertas", valor: String(G.ocorrenciasAbertas), nota: "por resolver", acao: "/frota/ocorrencias" },
    ])}
    <div class="fx2-cols">
      <section class="fx2-blk"><h3>Custos dos Últimos 12 Meses</h3>
        <div class="fx2-meses">${G.meses
          .map((m) => `<div class="fx2-mes" title="${esc(dica(m))}"><span class="fx2-mes-b fr-pilha">${pilha(m)}</span><span class="fx2-mes-l${m.mes === G.mes ? " on" : ""}">${MES_CURTO[Number(m.mes.slice(5)) - 1]}</span></div>`)
          .join("")}</div>
        <div class="fr-legenda">${cats.map((c) => `<span><i style="background:${COR_CAT[c]}"></i>${esc(CAT_CURTA[c])}</span>`).join("")}</div>
      </section>
      <section class="fx2-blk"><h3 style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">Custos Efetivos por Categoria <span style="margin-left:auto">${perSeg}</span></h3>
        ${
          G.categorias.length
            ? G.categorias
                .map((c) => `<div class="fx2-lin"><span>${esc(c.categoria)}</span><b>${fmt(c.valor)}</b></div><span class="fx2-bar"><i style="width:${((c.valor / mxC) * 100).toFixed(1)}%;background:${COR_CAT[c.categoria]}"></i></span>`)
                .join("") + `<div class="fx2-lin" style="border-top:1px solid #e2e8f0;margin-top:.5rem;padding-top:.4rem"><b>Total</b><b>${fmt(totCat)}</b></div>`
            : `<p class="fx2-mut">Sem custos no período.</p>`
        }
      </section>
    </div>
    <section class="fx2-blk"><h3>Custos Efetivos por Viatura e Máquina · ${esc(mesLbl(G.mes))}</h3>
      ${tabela(
        ["Viatura", ...cats.map((c) => [CAT_CURTA[c], "r"]), ["Total do Mês", "r"], ["Total 12 Meses", "r"]],
        G.linhas.map(
          (x) =>
            `<tr data-frcusv="${esc(x.vid)}" style="cursor:pointer" title="Ver os custos desta viatura"><td><b>${esc(x.matricula)}</b> <span class="fx2-mut">${esc(x.nome)}</span></td>${cats
              .map((c) => `<td class="r">${x.cat[c] ? fmt(x.cat[c]) : '<span class="fx2-mut">—</span>'}</td>`)
              .join("")}<td class="r"><b>${fmt(x.mes)}</b></td><td class="r">${fmt(x.doze)}</td></tr>`
        ),
        "Ainda não há viaturas ativas neste grupo.",
        G.linhas.length
          ? `<tfoot><tr><td>Total (${G.linhas.length})</td>${cats.map((c) => `<td class="r">${fmt(G.linhas.reduce((s, x) => s + (x.cat[c] || 0), 0))}</td>`).join("")}<td class="r">${fmt(G.custoMes)}</td><td class="r">${fmt(G.custo12)}</td></tr></tfoot>`
          : ""
      )}
    </section>
    <section class="fx2-blk"><h3>Registos</h3>
      <p class="fx2-mut" style="margin:0 0 .6rem">Listas de todas as viaturas, para procurar, registar e exportar.</p>
      <div class="fr-registos">${REGISTOS.map(([h, ic, l]) => `<a class="fr-registo" href="${h}"><span class="material-symbols-outlined">${ic}</span>${esc(l)}</a>`).join("")}</div>
    </section>`;
}

const PRIOR = { 1: ["Alta", "bad"], 2: ["Média", "warn"], 3: ["Informativo", "slate"] };

// ─── Frota (o `V.frgal` do protótipo): as viaturas em cartões ─────────────────

const GRUPOS_V = [["V", "Viaturas"], ["M", "Máquinas"], ["E", "Equipamentos"]];
const ICONE_G = { V: "airport_shuttle", M: "agriculture", E: "construction" };
const TIPOL_LBL = { VIATURA: "Viatura", TRACTOR: "Tractor / Cabeça", TRAILER: "Trailer / Reboque", MAQUINA: "Máquina", EQUIPAMENTO: "Equipamento" };
/** Grupo pela tipologia (o GRP do protótipo: Viaturas = viatura, tractor e trailer). */
function grupoV(v) {
  if (v?.tipologia) return v.tipologia === "MAQUINA" ? "M" : v.tipologia === "EQUIPAMENTO" ? "E" : "V";
  const k = norm(v?.kind);
  if (/maquin|escavad|retro|cilindro|grua|empilhad|motoniv|bulldo|pa carreg/.test(k)) return "M";
  if (/equip|gerador|compressor|betoneir/.test(k)) return "E";
  return "V";
}

function vistaViaturas() {
  const A = S.d.viaturas.filter((v) => (S.so === "inativas" ? !ativa(v) : ativa(v)));
  const Lx = A.filter((v) => (!S.g || grupoV(v) === S.g) && filtroQ([v.code, v.plate, v.brand, v.model, v.kind, v.assignedTo, mById(v.driverId)?.name].join(" "))).sort((a, b) =>
    a.plate.localeCompare(b.plate)
  );
  const n = (k) => A.filter((v) => grupoV(v) === k).length;
  const ano = S.d.hoje.slice(0, 4);
  const cons = new Set(S.d.abastecimentos.filter((a) => (a._calc?.an || []).some(([t]) => t === "warn") && String(a.date).slice(0, 4) === ano).map((a) => a.vehicleId));
  const cartao = (v) => {
    const m = mById(v.driverId);
    const g = grupoV(v);
    const avisos = [
      v._planos?.k === "bad" ? pill("manutenção", "bad") : v._planos?.k === "warn" ? pill("manutenção", "warn") : "",
      v._seguro?.[1] === "bad" ? pill("sem seguro", "bad") : "",
      cons.has(v.id) ? pill("consumo", "warn") : "",
    ].join("");
    return `<div class="fr-card" role="button" tabindex="0" data-frv="${esc(v.id)}">
      <span class="fr-av fr-av--${g}">${v.photos?.tq ? `<img src="${esc(getAssetUrl(v.photos.tq) || "")}" alt="">` : `<span class="material-symbols-outlined">${ICONE_G[g]}</span>`}</span>
      <span class="fr-ci"><b>${esc(v.plate)}</b><span>${esc([v.brand, v.model].filter(Boolean).join(" "))}${v.year ? ` (${esc(v.year)})` : ""}</span>
        <span class="fx2-mut">${esc(TIPOL_LBL[v.tipologia] || v.kind)} · ${esc(v.kind)} · ${esc(v.code)}</span>
        <span class="fx2-mut"><span class="material-symbols-outlined fr-ic">person</span> ${esc(m?.name || "Sem motorista")}</span>
        <span class="fr-pills">${pill(v.status, TOM_ESTADO[v.status] || "slate")}${avisos}</span></span>
    </div>`;
  };
  return `
    <div class="fcal-filtros">${pesquisa(S, "matrícula, marca, motorista…")}
      <span class="finance-seg"><button type="button" class="${!S.g ? "active" : ""}" data-frg="">Todos (${A.length})</button>${GRUPOS_V.filter(([k]) => n(k))
        .map(([k, l]) => `<button type="button" class="${S.g === k ? "active" : ""}" data-frg="${k}">${esc(l)} (${n(k)})</button>`)
        .join("")}</span>
      <label class="fx2-mut" style="display:inline-flex;gap:.35rem;align-items:center"><input type="checkbox" data-frina${S.so === "inativas" ? " checked" : ""}> Inativas</label></div>
    ${Lx.length ? `<div class="fr-grid">${Lx.map(cartao).join("")}</div>` : vazio(S.d.viaturas.length ? "Nenhuma viatura encontrada." : "Ainda não há viaturas. Registe a primeira em «+ Nova Viatura / Equipamento».")}`;
}

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

// ─── Configurações da Frota (o `V.frcfg` do protótipo) ────────────────────────

const CFG_TABS = [
  ["mot", "badge", "Motoristas"],
  ["seg", "verified_user", "Seguros"],
  ["prev", "event_repeat", "Planos Preventivos"],
  ["tip", "airport_shuttle", "Tipologias"],
  ["doc", "description", "Documentos Obrigatórios"],
  ["ofi", "car_repair", "Oficinas e Fornecedores"],
  ["resp", "key", "Responsáveis"],
];
const CFG_NOVO = {
  mot: ["+ Novo Motorista", () => formMotorista()],
  seg: ["+ Nova Apólice", () => formSeguro()],
  prev: ["+ Registar Manutenção", () => formIntervencao()],
};
const DOC_PARA = {
  "Livrete / Título de Propriedade": "todas as viaturas",
  "Inspecção Periódica": "viaturas e reboques",
  "Taxa de Circulação": "viaturas",
  "Seguro Automóvel": "todas (nos Seguros)",
  "Licença de Transporte": "viaturas de carga, quando aplicável",
};
const NIVEL = { gere: ["Gere a frota", "good"], regista: ["Regista", "blue"], consulta: ["Só consulta", "slate"], sem: ["Sem acesso", "bad"] };
const PERFIL = { admin: "Admin", supervisor: "Supervisor", operador: "Operador", financeiro: "Financeiro", tecnico: "Técnico", leitura: "Leitura", cliente: "Cliente" };

/** Tipologias (o separador «Tipologias» do `V.frcfg`): as do protótipo, com quantas viaturas há de cada. */
function cfgTipologias() {
  const GRUPO = { V: "Viaturas", M: "Máquinas", E: "Equipamentos" };
  const linhas = L().tipologias.map(([k, l]) => {
    const T = S.d.viaturas.filter((v) => (v.tipologia || "VIATURA") === k);
    const tipos = [...new Set(T.map((v) => v.kind).filter(Boolean))].sort();
    return `<tr><td><b>${esc(l)}</b></td><td class="fx2-mut">${esc(GRUPO[grupoV({ tipologia: k })])}</td><td class="fx2-mut">${["MAQUINA", "EQUIPAMENTO"].includes(k) ? "horas" : "km"}</td><td class="fx2-mut">${esc(tipos.join(", ") || "—")}</td><td class="r">${T.filter(ativa).length}</td><td class="r">${T.length}</td></tr>`;
  });
  return `<section class="fx2-blk"><h3>Tipologias</h3>
    ${tabela(["Tipologia", "Grupo", "Unidade", "Tipos registados", ["Ativas", "r"], ["Registadas", "r"]], linhas, "")}
    <p class="fcal-nota">A tipologia escolhe-se na ficha de cada viatura (Viatura, Tractor, Trailer, Máquina, Equipamento) e decide a unidade (km ou horas) e o grupo nos filtros. O «tipo» (ligeira, pesada, escavadora…) é livre.</p></section>`;
}

function cfgDocumentos() {
  const obr = new Set(L().documentosObrigatorios);
  return `<section class="fx2-blk"><h3>Documentos Obrigatórios</h3>
    ${tabela(["Documento", "Para", "Alerta quando falta"],
      L().tiposDocumento.filter((t) => t !== "Outro").map((t) => `<tr><td><b>${esc(t)}</b></td><td class="fx2-mut">${esc(DOC_PARA[t] || "quando aplicável")}</td><td>${obr.has(t) ? pill("sim", "warn") : pill("não", "slate")}</td></tr>`),
      "")}
    <p class="fcal-nota">O alerta aparece 30 dias antes da validade, em Alertas e no Painel da Frota. Os documentos marcados «sim» geram também alerta quando a viatura não os tem registados. Outros documentos: escolha «Outro» e escreva a descrição.</p></section>`;
}

function cfgOficinas() {
  const C = S.cfg;
  if (!C) return vazio("A carregar…");
  return `<div class="fx2-cols">
    <section class="fx2-blk"><h3>Oficinas e Fornecedores da Frota</h3>
      ${tabela(["Fornecedor", "Categoria", "NIF"],
        C.oficinas.map((f) => `<tr><td><b>${esc(f.name)}</b>${f.code ? ` <span class="fx2-mut">${esc(f.code)}</span>` : ""}</td><td class="fx2-mut">${esc(f.category || "")}</td><td class="fx2-mut">${esc(f.nif || "")}</td></tr>`),
        "Nenhum fornecedor marcado como oficina.")}
      <p class="fcal-nota">Entram aqui os terceiros cuja categoria (ou nome) indica oficina, lavagem, mecânica, pneus, bate-chapa ou pintura. <a href="/registos/terceiros">Abrir Terceiros →</a></p>
    </section>
    <section class="fx2-blk"><h3>Oficinas usadas nas intervenções</h3>
      ${tabela(["Oficina", ["Intervenções", "r"], "Última"],
        C.oficinasUsadas.map((o) => `<tr><td><b>${esc(o.nome)}</b></td><td class="r">${o.intervencoes}</td><td>${o.ultima ? fmtData(o.ultima) : "—"}</td></tr>`),
        "Ainda não há intervenções com oficina indicada.")}
    </section></div>`;
}

function cfgResponsaveis() {
  const C = S.cfg;
  if (!C) return vazio("A carregar…");
  const gerir = can("permissoes", "manage_permissions");
  return `<div class="fx2-cols">
    <section class="fx2-blk"><h3>Por perfil</h3>
      ${tabela(["Perfil", "Na frota", "Menu Frota"],
        C.perfis.map((p) => `<tr><td><b>${esc(PERFIL[p.role] || p.role)}</b></td><td>${pill(...NIVEL[p.nivel])}</td><td>${p.menu ? pill("visível", "good") : pill("oculto", "slate")}</td></tr>`),
        "")}
    </section>
    <section class="fx2-blk"><h3>Utilizadores que registam ou gerem</h3>
      ${tabela(["Utilizador", "Perfil", "Na frota", ""],
        C.responsaveis.map((u) => `<tr><td><b>${esc(u.nome)}</b></td><td class="fx2-mut">${esc(PERFIL[u.perfil] || u.perfil)}</td><td>${pill(...NIVEL[u.nivel])}</td><td>${u.excecao ? pill("exceção no utilizador", "warn") : ""}</td></tr>`),
        "Nenhum utilizador pode registar na frota.")}
    </section></div>
    <p class="fcal-nota">«Gere a frota» cria, edita e apaga; «Regista» cria e edita; «Só consulta» vê os ecrãs. O acesso define-se no módulo <b>Frota</b> e no menu <b>Menu: Frota</b>, por perfil ou com exceções por utilizador${gerir ? `, em <a href="/Users">Gestão › Permissões</a>` : " (Gestão › Permissões, só para administradores)"}.</p>`;
}

function vistaConfiguracoes() {
  const t = S.tab || "mot";
  const novo = CFG_NOVO[t];
  const corpo = t === "mot" ? vistaMotoristas() : t === "seg" ? vistaSeguros() : t === "prev" ? vistaPlanos() : t === "tip" ? cfgTipologias() : t === "doc" ? cfgDocumentos() : t === "ofi" ? cfgOficinas() : cfgResponsaveis();
  return `<div class="fr-tabs">${CFG_TABS.map(([k, ic, l]) => `<button type="button" class="fr-tab${t === k ? " on" : ""}" data-frtab="${k}"><span class="material-symbols-outlined">${ic}</span>${esc(l)}</button>`).join("")}
      ${novo && pode("create") ? `<button type="button" class="finance-btn finance-btn--primary fr-tab-novo" data-frcfgnovo="${t}">${esc(novo[0])}</button>` : ""}</div>
    ${corpo}`;
}

const VISTAS = {
  configuracoes: vistaConfiguracoes,
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
  viaturas: ["+ Nova Viatura / Equipamento", () => formViatura()],
  motoristas: ["+ Novo Motorista", () => formMotorista()],
  abastecimentos: ["+ Abastecimento", () => formAbastecimento()],
  manutencoes: ["+ Manutenção / Reparação", () => formIntervencao()],
  planos: ["+ Manutenção", () => formIntervencao()],
  ocorrencias: ["+ Ocorrência", () => formOcorrencia()],
  documentos: ["+ Documento", () => formDocumento()],
  seguros: ["+ Nova Apólice", () => formSeguro()],
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
    const [d, ov] = await Promise.all([apiRequest("/fleet/bootstrap"), precisaOv ? apiRequest(urlOverview()) : null]);
    S.d = d;
    if (ov) S.ov = ov;
    if (S.vista === "custos") await carregarCustos();
    if (S.vista === "configuracoes") S.cfg = await apiRequest("/fleet/config");
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
  S.tab = CFG_TABS.some(([k]) => k === qs.get("tab")) ? qs.get("tab") : "mot";

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
    if (S.vista === "painel" && k === "mes") return recarregarPainel();
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
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const c = e.target.closest?.(".fr-card[data-frv]");
    if (!c) return;
    e.preventDefault();
    formViatura(vById(c.dataset.frv));
  });
  el.addEventListener("click", async (e) => {
    const t = e.target;
    const c = t.closest("[data-chip]");
    if (c) {
      const [k, v] = c.dataset.chip.split("|");
      S[k] = v;
      return desenhar();
    }
    const grp = t.closest("[data-frg]");
    if (grp) {
      S.g = grp.dataset.frg;
      return S.vista === "painel" ? recarregarPainel() : desenhar();
    }
    const pg = t.closest("[data-frpg]");
    if (pg) {
      S.per = pg.dataset.frpg;
      return recarregarPainel();
    }
    if (t.matches("[data-frina]")) {
      S.so = t.checked ? "inativas" : "";
      return desenhar();
    }
    const cv = t.closest("[data-frcusv]");
    if (cv) {
      window.location.href = `/frota/custos?viatura=${encodeURIComponent(cv.dataset.frcusv)}`;
      return;
    }
    const tab = t.closest("[data-frtab]");
    if (tab) {
      Object.assign(S, { tab: tab.dataset.frtab, q: "", e: "", so: "", v: "" });
      const u = new URL(window.location.href);
      u.searchParams.set("tab", S.tab);
      window.history.replaceState(null, "", u);
      return desenhar();
    }
    const cn = t.closest("[data-frcfgnovo]");
    if (cn) return CFG_NOVO[cn.dataset.frcfgnovo]?.[1]();
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
