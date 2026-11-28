/**
 * Oficina — regras sem base de dados, tiradas do protótipo (v660 «OFICINA MBT»
 * e v667 «MENU SIMPLES»: Calendário · Ordens de Trabalho · Material · Indicadores).
 *
 * Uma ordem de trabalho (OT) é uma intervenção da frota com `workOrderStatus`
 * e o bloco `workOrder` (como o `fint.ot` do protótipo).
 */

const ESTADOS = ["Pedido", "Marcado", "Recebida", "Em Trabalho", "Concluído", "Entregue", "Cancelado"];
const FECHADOS = ["Entregue", "Cancelado"];
const TIPOS_SERVICO = ["Manutenção programada", "Reparação", "Inspeção", "Lavagem / Higienização", "Pneus", "Diagnóstico", "Outro"];
const PRIORIDADES = ["Normal", "Urgente", "Viatura parada"];
const ESTADOS_TRABALHO = ["", "Feito", "Não feito", "Adiado"];
const ESTADOS_MATERIAL = ["Por entregar", "Recebido", "Não recebido", "Aplicado", "Devolvido"];
const OFICINA_PROPRIA = "OFICINA MBT";

const iso = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : "");
const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);

/** O bloco `workOrder` sempre com todas as listas. */
function blocoOT(wo) {
  const o = wo && typeof wo === "object" ? { ...wo } : {};
  ["trab", "mat", "horas", "chat"].forEach((k) => (o[k] = Array.isArray(o[k]) ? o[k] : []));
  o.prio = o.prio || "Normal";
  return o;
}

/** Dia da OT: o marcado, senão o pretendido no pedido, senão a data da intervenção. */
const diaOT = (x) => iso(x.workOrder?.dm || x.workOrder?.pedido?.dp || x.entryDate || x.date);
const horaOT = (x) => x.workOrder?.hm || x.workOrder?.pedido?.hp || "";

/** Minutos entre "08:30" e "12:15" (0 quando a linha está incompleta ou invertida). */
function minutos(ini, fim) {
  if (!/^\d{1,2}:\d{2}/.test(String(ini || "")) || !/^\d{1,2}:\d{2}/.test(String(fim || ""))) return 0;
  const [a, b] = String(ini || "").split(":").map(Number);
  const [c, d] = String(fim || "").split(":").map(Number);
  if (![a, c].every(Number.isFinite)) return 0;
  const m = c * 60 + (d || 0) - (a * 60 + (b || 0));
  return m > 0 ? m : 0;
}
const horasOT = (wo) => blocoOT(wo).horas.reduce((s, r) => s + minutos(r.ini, r.fim) / 60, 0);

const atrasada = (x, hoje) => !["Concluído", ...FECHADOS].includes(x.workOrderStatus) && (iso(x.workOrder?.de) || diaOT(x)) < iso(hoje);
const materialPendente = (x) => blocoOT(x.workOrder).mat.some((m) => m.est === "Por entregar" || m.est === "Não recebido");

/** Ponto de situação de uma OT (o `sitOT` do protótipo): [texto, tom]. */
function situacao(x, hoje) {
  const e = x.workOrderStatus;
  const t = blocoOT(x.workOrder);
  if (e === "Cancelado") return ["Cancelado", "neu"];
  if (e === "Entregue") return ["Entregue ao cliente", "good"];
  if (e === "Concluído") return ["Pronta para entrega", "good"];
  if (e === "Pedido") return ["À espera que a oficina aceite", "warn"];
  if (atrasada(x, hoje)) return [t.de ? `Atrasada (entrega prevista ${iso(t.de)})` : "Atrasada", "bad"];
  if (materialPendente(x)) return ["Material por receber", "warn"];
  if (e === "Marcado") return [`Marcado para ${diaOT(x)}${horaOT(x) ? ` ${horaOT(x)}` : ""}`, "blue"];
  if (e === "Recebida") return ["Viatura na oficina", "blue"];
  if (e === "Em Trabalho") return [t.de ? `Em trabalho · entrega ${iso(t.de)}` : "Em trabalho", "blue"];
  return [e || "—", "neu"];
}

/**
 * Efeitos de mudar o estado (o `otSync` do protótipo): datas de entrada e
 * saída, estado da intervenção e da viatura, e a linha na conversa.
 * Devolve { data, viatura } — `data` para a intervenção, `viatura` (ou null)
 * para o estado da viatura.
 */
function mudarEstado(atual, novo, { hoje, por }) {
  if (!ESTADOS.includes(novo)) throw Object.assign(new Error(`Estado desconhecido: ${novo}`), { status: 400, publicMessage: `Estado desconhecido: ${novo}` });
  const wo = blocoOT(atual.workOrder);
  const data = { workOrderStatus: novo };
  wo.chat = wo.chat.concat([{ d: new Date().toISOString(), por, t: `Estado: ${novo}` }]);
  if (novo === "Marcado" && !wo.dm) wo.dm = wo.pedido?.dp || iso(hoje);
  if (novo === "Recebida" && !atual.entryDate) data.entryDate = iso(hoje);
  if ((novo === "Concluído" || novo === "Entregue") && !atual.exitDate) data.exitDate = iso(hoje);
  data.status = novo === "Concluído" || novo === "Entregue" ? "Concluída" : novo === "Cancelado" ? "Cancelada" : "Em curso";
  data.workOrder = wo;
  let viatura = null;
  if (atual.vehicleId) {
    if (novo === "Recebida" || novo === "Em Trabalho") viatura = { status: "Em manutenção", so: (s) => s !== "Em manutenção" };
    if (novo === "Entregue" || novo === "Cancelado") viatura = { status: "Operacional", so: (s) => /manut|oficina/i.test(s || "") };
  }
  return { data, viatura };
}

/** Calendário: KPIs e listas laterais (o `VOF` do protótipo). */
function calendario(ots, hoje) {
  const h = iso(hoje);
  const amanha = new Date(Date.parse(`${h}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  const A = ots.filter((x) => x.workOrderStatus !== "Cancelado");
  const ids = (L) => L.map((x) => x.id);
  const pedidos = A.filter((x) => x.workOrderStatus === "Pedido");
  const dentro = A.filter((x) => ["Recebida", "Em Trabalho"].includes(x.workOrderStatus));
  const hojeL = A.filter((x) => diaOT(x) === h && x.workOrderStatus !== "Entregue");
  const amanhaL = A.filter((x) => diaOT(x) === amanha && x.workOrderStatus !== "Pedido");
  const mat = A.filter((x) => materialPendente(x) && !["Entregue", "Concluído"].includes(x.workOrderStatus));
  const atr = A.filter((x) => atrasada(x, h));
  return {
    kpis: { pedidos: pedidos.length, hoje: hojeL.length, dentro: dentro.length, material: mat.length, atrasados: atr.length },
    listas: { pedidos: ids(pedidos), amanha: ids(amanhaL), dentro: ids(dentro), material: ids(mat), atrasados: ids(atr) },
  };
}

/** Material de todas as OT (o `V.frmat` do protótipo). */
function materiais(ots) {
  const R = [];
  ots.forEach((x) => blocoOT(x.workOrder).mat.forEach((m, i) => R.push({ otId: x.id, code: x.code, vehicleId: x.vehicleId, i, dia: diaOT(x), ...m })));
  return R;
}

/** Indicadores da oficina (o `V.frkpi` do protótipo). */
function indicadores(ots) {
  const A = ots;
  const porTecnico = {};
  let horas = 0;
  A.forEach((x) =>
    blocoOT(x.workOrder).horas.forEach((r) => {
      const h = minutos(r.ini, r.fim) / 60;
      if (!h) return;
      const k = r.tec || "—";
      porTecnico[k] = (porTecnico[k] || 0) + h;
      horas += h;
    })
  );
  const feitas = A.filter((x) => ["Concluído", "Entregue"].includes(x.workOrderStatus));
  const dur = feitas
    .map((x) => {
      const a = iso(x.entryDate) || diaOT(x);
      const b = iso(x.exitDate);
      return a && b ? Math.max(0, (Date.parse(b) - Date.parse(a)) / 864e5) : null;
    })
    .filter((v) => v !== null);
  const comPrazo = feitas.filter((x) => x.workOrder?.de);
  const noPrazo = comPrazo.filter((x) => x.exitDate && iso(x.exitDate) <= iso(x.workOrder.de)).length;
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, A.filter((x) => x.workOrderStatus === e).length]));
  return {
    total: A.length,
    porAceitar: porEstado.Pedido,
    feitas: feitas.length,
    tempoMedio: dur.length ? dur.reduce((s, v) => s + v, 0) / dur.length : null,
    comPrazo: comPrazo.length,
    noPrazo,
    pctPrazo: comPrazo.length ? noPrazo / comPrazo.length : null,
    horas,
    porTecnico: Object.entries(porTecnico).sort((a, b) => b[1] - a[1]).map(([tec, h]) => ({ tec, horas: h })),
    porEstado,
    maoDeObra: A.reduce((s, x) => s + n(x.laborCost), 0),
  };
}

module.exports = {
  ESTADOS,
  FECHADOS,
  TIPOS_SERVICO,
  PRIORIDADES,
  ESTADOS_TRABALHO,
  ESTADOS_MATERIAL,
  OFICINA_PROPRIA,
  blocoOT,
  diaOT,
  horaOT,
  minutos,
  horasOT,
  atrasada,
  materialPendente,
  situacao,
  mudarEstado,
  calendario,
  materiais,
  indicadores,
};
