/**
 * Frota — a área «frota» do protótipo (NAV_FROTA):
 *   GET  /fleet/bootstrap            todos os registos + listas (os ecrãs filtram no browser)
 *   GET  /fleet/overview             V1 Painel e V2 Alertas
 *   GET  /fleet/costs?de=&ate=&viatura=   V13 Custos por Viatura
 *   CRUD /fleet/:colecao[/:id]       vehicles, drivers, fuel, interventions, incidents, documents, insurances
 *   /fleet/workshop…                 Oficina: Calendário, Ordens de Trabalho, Material, Indicadores
 *
 * Permissões: módulo `frota` (view / create / edit / delete). O menu tem `navlinks:nav_frota`.
 * A Oficina aceita `oficina` ou `frota` (quem gere a frota faz pedidos à oficina).
 */

const express = require("express");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission, requireAnyPermission } = require("../middlewares/auth");
const F = require("../services/fleet/fleetCore");
const W = require("../services/fleet/workshopCore");

const fleetRoutes = express.Router();
fleetRoutes.use(authRequired);

const T = { s: "str", i: "int", d: "dec", t: "date", b: "bool", j: "json", a: "arr", o: "obj" };

/** Campos aceites por colecção: nome → tipo. `req`: obrigatórios na criação. */
const COLECOES = {
  vehicles: {
    model: "fleetVehicle",
    prefixo: "FR",
    porAno: false,
    campos: {
      plate: T.s, kind: T.s, brand: T.s, model: T.s, year: T.i, unit: T.s, fuel: T.s, tankCapacity: T.d, refConsumption: T.d,
      odometer: T.d, acquisitionValue: T.d, ownership: T.s, assignedTo: T.s, projectId: T.s, driverId: T.s, status: T.s,
      active: T.b, notes: T.s, maintenancePlans: T.j, tipologia: T.s, company: T.s, details: T.o,
    },
    req: [["plate", "matrícula"], ["kind", "tipo"], ["brand", "marca"], ["model", "modelo"]],
    ordem: [{ plate: "asc" }],
  },
  drivers: {
    model: "fleetDriver",
    prefixo: "MOT",
    porAno: false,
    campos: { name: T.s, licenseNumber: T.s, licenseCategory: T.s, licenseExpiry: T.t, phone: T.s, status: T.s, department: T.s, projectId: T.s, personnelId: T.s, notes: T.s },
    req: [["name", "nome"]],
    ordem: [{ name: "asc" }],
  },
  fuel: {
    model: "fleetFuel",
    prefixo: "AB",
    porAno: true,
    campos: {
      date: T.t, vehicleId: T.s, driverId: T.s, odometer: T.d, liters: T.d, pricePerLiter: T.d, amount: T.d, fuelType: T.s, fullTank: T.b,
      station: T.s, paymentMethod: T.s, receipt: T.s, projectId: T.s, justification: T.s, notes: T.s, time: T.s,
    },
    req: [["date", "data"], ["vehicleId", "viatura"], ["odometer", "km"], ["liters", "litros"]],
    ordem: [{ date: "desc" }, { createdAt: "desc" }],
  },
  interventions: {
    model: "fleetIntervention",
    prefixo: "OS",
    porAno: true,
    campos: {
      date: T.t, vehicleId: T.s, odometer: T.d, type: T.s, system: T.s, description: T.s, supplierId: T.s, workshop: T.s, technician: T.s,
      entryDate: T.t, exitDate: T.t, status: T.s, laborCost: T.d, partsCost: T.d, otherCost: T.d, warranty: T.s, nextAction: T.s,
      nextDate: T.t, nextOdometer: T.d, planIds: T.a, incidentId: T.s, notes: T.s, parts: T.j,
    },
    req: [["date", "data"], ["vehicleId", "viatura"], ["type", "tipo"], ["description", "descrição"]],
    ordem: [{ date: "desc" }, { createdAt: "desc" }],
  },
  incidents: {
    model: "fleetIncident",
    prefixo: "OC",
    porAno: true,
    campos: {
      date: T.t, vehicleId: T.s, driverId: T.s, type: T.s, severity: T.s, location: T.s, description: T.s, action: T.s, responsible: T.s,
      deadline: T.t, status: T.s, closedAt: T.t, estimatedCost: T.d, cost: T.d, insuranceClaim: T.b, injuries: T.b, notes: T.s,
      time: T.s, immobilizes: T.b, reference: T.s, claimRef: T.s, thirdParties: T.s,
    },
    req: [["date", "data"], ["vehicleId", "viatura"], ["type", "tipo"], ["description", "descrição"]],
    ordem: [{ date: "desc" }, { createdAt: "desc" }],
  },
  documents: {
    model: "fleetDocument",
    prefixo: null,
    campos: { vehicleId: T.s, type: T.s, number: T.s, entity: T.s, issueDate: T.t, expiryDate: T.t, cost: T.d, situation: T.s, notes: T.s },
    req: [["vehicleId", "viatura"], ["type", "tipo"]],
    ordem: [{ expiryDate: "desc" }],
  },
  insurances: {
    model: "fleetInsurance",
    prefixo: "SEG",
    porAno: false,
    campos: { insurer: T.s, supplierId: T.s, policyNumber: T.s, coverages: T.a, vehicleIds: T.a, startDate: T.t, endDate: T.t, premium: T.d, periodicity: T.s, notes: T.s },
    req: [["insurer", "seguradora"], ["policyNumber", "n.º da apólice"], ["startDate", "início"], ["endDate", "fim"]],
    ordem: [{ endDate: "asc" }],
  },
};

function erro(status, mensagem) {
  return Object.assign(new Error(mensagem), { status, publicMessage: mensagem });
}

function converter(tipo, v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return tipo === T.a ? [] : tipo === T.b ? false : tipo === T.j ? [] : tipo === T.o ? {} : null;
  switch (tipo) {
    case T.s: return String(v).trim() || null;
    case T.i: { const x = parseInt(v, 10); return Number.isFinite(x) ? x : null; }
    case T.d: { const x = Number(String(v).replace(",", ".")); return Number.isFinite(x) ? x : null; }
    case T.t: { const s = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw erro(400, `Data inválida: ${v}`); return new Date(`${s}T00:00:00Z`); }
    case T.b: return v === true || v === "true" || v === "1" || v === 1 || v === "Sim";
    case T.j: return Array.isArray(v) || typeof v === "object" ? v : [];
    case T.o: return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    case T.a: return (Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter(Boolean);
    default: return v;
  }
}

function lerCorpo(cfg, body, { criar }) {
  const data = {};
  for (const [k, tipo] of Object.entries(cfg.campos)) {
    const v = converter(tipo, body?.[k]);
    if (v !== undefined) data[k] = v;
  }
  if (criar) {
    const falta = cfg.req.filter(([k]) => data[k] === null || data[k] === undefined || data[k] === "").map(([, l]) => l);
    if (falta.length) throw erro(400, `Falta preencher: ${falta.join(", ")}.`);
  } else {
    const limpo = cfg.req.filter(([k]) => k in data && (data[k] === null || data[k] === "")).map(([, l]) => l);
    if (limpo.length) throw erro(400, `Não pode ficar vazio: ${limpo.join(", ")}.`);
  }
  return data;
}

/** Decimal → Number, Date → `YYYY-MM-DD` (as datas da frota são dias, não instantes). */
function plano(x) {
  if (Array.isArray(x)) return x.map(plano);
  if (!x || typeof x !== "object") return x;
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x.toNumber === "function" && x.constructor?.name === "Decimal") return x.toNumber();
  const o = {};
  for (const [k, v] of Object.entries(x)) {
    if (v instanceof Date) o[k] = k === "createdAt" || k === "updatedAt" ? v.toISOString() : v.toISOString().slice(0, 10);
    else if (v && typeof v === "object" && typeof v.toNumber === "function") o[k] = v.toNumber();
    else o[k] = v;
  }
  return o;
}

async function proximoCodigo(cfg) {
  const ano = cfg.porAno ? new Date().getUTCFullYear() : null;
  const base = ano ? `${cfg.prefixo}-${ano}-` : `${cfg.prefixo}-`;
  const rows = await prisma[cfg.model].findMany({ where: { code: { startsWith: base } }, select: { code: true } });
  return F.proximoCodigo(cfg.prefixo, rows.map((r) => r.code), { ano });
}

async function carregarTudo() {
  const [viaturas, motoristas, abastecimentos, intervencoes, ocorrencias, documentos, seguros] = await Promise.all([
    prisma.fleetVehicle.findMany({ orderBy: COLECOES.vehicles.ordem }),
    prisma.fleetDriver.findMany({ orderBy: COLECOES.drivers.ordem }),
    prisma.fleetFuel.findMany({ orderBy: COLECOES.fuel.ordem }),
    prisma.fleetIntervention.findMany({ orderBy: COLECOES.interventions.ordem }),
    prisma.fleetIncident.findMany({ orderBy: COLECOES.incidents.ordem }),
    prisma.fleetDocument.findMany({ orderBy: COLECOES.documents.ordem }),
    prisma.fleetInsurance.findMany({ orderBy: COLECOES.insurances.ordem }),
  ]);
  return {
    viaturas: plano(viaturas),
    motoristas: plano(motoristas),
    abastecimentos: plano(abastecimentos),
    intervencoes: plano(intervencoes),
    ocorrencias: plano(ocorrencias),
    documentos: plano(documentos),
    seguros: plano(seguros),
  };
}

const hojeIso = () => new Date().toISOString().slice(0, 10);

/** Uma leitura de km/horas maior do que a da viatura atualiza a viatura. */
async function atualizarConta(tx, vehicleId, odometer, date) {
  if (!vehicleId || odometer === null || odometer === undefined) return;
  const v = await tx.fleetVehicle.findUnique({ where: { id: vehicleId }, select: { odometer: true } });
  if (!v) return;
  if (v.odometer === null || Number(odometer) >= Number(v.odometer)) {
    await tx.fleetVehicle.update({ where: { id: vehicleId }, data: { odometer, odometerAt: date || new Date() } });
  }
}

/** Intervenção concluída que cumpre planos preventivos: a última execução passa a ser esta. */
async function cumprirPlanos(tx, intervencao) {
  if (!intervencao.vehicleId || !intervencao.planIds?.length || intervencao.status !== "Concluída") return;
  const v = await tx.fleetVehicle.findUnique({ where: { id: intervencao.vehicleId }, select: { maintenancePlans: true } });
  if (!v || !Array.isArray(v.maintenancePlans)) return;
  const data = F.iso(intervencao.date);
  const planos = v.maintenancePlans.map((p) =>
    intervencao.planIds.includes(p.id) ? { ...p, ultData: data, ultKm: intervencao.odometer !== null ? Number(intervencao.odometer) : p.ultKm } : p
  );
  await tx.fleetVehicle.update({ where: { id: intervencao.vehicleId }, data: { maintenancePlans: planos } });
}

function normalizarPlanos(planos) {
  return (Array.isArray(planos) ? planos : [])
    .filter((p) => String(p?.nome || "").trim() || Number(p?.km) || Number(p?.meses))
    .map((p, i) => ({
      id: String(p.id || `p${Date.now().toString(36)}${i}`),
      nome: String(p.nome || "MANUTENÇÃO").trim().toUpperCase(),
      km: Number(p.km) || null,
      meses: Number(p.meses) || null,
      ultKm: p.ultKm === "" || p.ultKm === null || p.ultKm === undefined ? null : Number(p.ultKm),
      ultData: p.ultData ? String(p.ultData).slice(0, 10) : null,
    }));
}

/** Regras próprias de cada colecção, antes de gravar. */
async function preparar(colecao, data, { atual = null } = {}) {
  if (colecao === "vehicles") {
    if (data.plate) {
      data.plate = data.plate.toUpperCase().replace(/\s+/g, "-");
      const outra = await prisma.fleetVehicle.findFirst({ where: { plate: data.plate, ...(atual ? { NOT: { id: atual.id } } : {}) } });
      if (outra) throw erro(409, `Já existe uma viatura com a matrícula ${data.plate} (${outra.code}).`);
    }
    ["kind", "brand", "model", "company"].forEach((k) => data[k] && (data[k] = data[k].toUpperCase()));
    if (data.tipologia !== undefined) {
      data.tipologia = F.TIPOLOGIAS.some(([k]) => k === data.tipologia) ? data.tipologia : "VIATURA";
      // Máquinas e equipamentos contam horas (como no protótipo), salvo indicação em contrário
      if (!atual && !data.unit && ["MAQUINA", "EQUIPAMENTO"].includes(data.tipologia)) data.unit = "HORAS";
    }
    if (data.details !== undefined) data.details = F.limparFicha(data.details);
    if ("maintenancePlans" in data) data.maintenancePlans = normalizarPlanos(data.maintenancePlans);
    if ("odometer" in data && data.odometer !== null && (!atual || Number(atual.odometer) !== data.odometer)) data.odometerAt = new Date();
    if (data.status && ["Vendida", "Abatida"].includes(data.status)) data.active = false;
  }
  if (colecao === "fuel") {
    if ((data.amount === null || data.amount === undefined) && data.liters && data.pricePerLiter) data.amount = Math.round(data.liters * data.pricePerLiter * 100) / 100;
    if (!atual && (data.amount === null || data.amount === undefined)) throw erro(400, "Indique o valor ou o preço por litro.");
    if (data.amount === null) throw erro(400, "Indique o valor ou o preço por litro.");
    if (data.time !== undefined && data.time && !/^\d{1,2}:\d{2}$/.test(data.time)) data.time = null;
    // Km abaixo do abastecimento anterior: só passa com justificação (como no protótipo)
    const vid = data.vehicleId ?? atual?.vehicleId;
    const km = data.odometer !== undefined ? data.odometer : atual?.odometer;
    const dia = F.iso(data.date ?? atual?.date);
    if (vid && km !== null && km !== undefined) {
      const anteriores = await prisma.fleetFuel.findMany({
        where: { vehicleId: vid, odometer: { not: null }, date: { lte: new Date(`${dia}T00:00:00Z`) }, ...(atual ? { NOT: { id: atual.id } } : {}) },
        orderBy: [{ date: "desc" }, { odometer: "desc" }],
        take: 1,
      });
      const prev = anteriores[0];
      const just = String(data.justification ?? atual?.justification ?? "").trim();
      if (prev && Number(km) < Number(prev.odometer) && !just) {
        throw erro(400, `Os km (${km}) são inferiores aos do abastecimento anterior (${Number(prev.odometer)} em ${F.iso(prev.date)}). Escreva a justificação.`);
      }
    }
  }
  if (colecao === "interventions" && data.parts !== undefined) {
    data.parts = F.limparPecas(data.parts);
    if (data.parts.length) data.partsCost = F.totalPecas(data.parts);
  }
  if (colecao === "incidents" && data.time !== undefined && data.time && !/^\d{1,2}:\d{2}$/.test(data.time)) data.time = null;
  if (colecao === "incidents") {
    const est = data.status ?? atual?.status;
    if (F.OCORRENCIA_FECHADA.includes(est) && !data.closedAt && !atual?.closedAt) data.closedAt = new Date(`${hojeIso()}T00:00:00Z`);
  }
  if (colecao === "insurances") {
    const ini = data.startDate ?? atual?.startDate;
    const fim = data.endDate ?? atual?.endDate;
    if (ini && fim && fim < ini) throw erro(400, "O fim da apólice é anterior ao início.");
    const viats = data.vehicleIds ?? atual?.vehicleIds ?? [];
    if (!viats.length) throw erro(400, "Escolha pelo menos uma viatura coberta.");
  }
  return data;
}

/**
 * Estado da viatura segundo as intervenções e ocorrências (o `after` dos
 * formulários do protótipo): intervenção por concluir → «Em manutenção»;
 * ocorrência aberta que imobiliza → «Avariada» / «Acidentada»; quando nada
 * a prende, volta a «Operacional».
 */
async function sincronizarEstadoViatura(tx, vehicleId) {
  if (!vehicleId) return;
  const v = await tx.fleetVehicle.findUnique({ where: { id: vehicleId }, select: { status: true, active: true } });
  if (!v || v.active === false || ["Vendida", "Abatida"].includes(v.status)) return;
  const [ints, ocs] = await Promise.all([
    tx.fleetIntervention.findMany({ where: { vehicleId }, select: { status: true, workOrderStatus: true } }),
    tx.fleetIncident.findMany({ where: { vehicleId, immobilizes: true }, select: { status: true, type: true } }),
  ]);
  const novo = F.estadoPelosRegistos(v.status, { intervencoes: ints, ocorrencias: ocs });
  if (novo && novo !== v.status) await tx.fleetVehicle.update({ where: { id: vehicleId }, data: { status: novo } });
}

async function depois(tx, colecao, row) {
  if (colecao === "fuel" || colecao === "interventions") await atualizarConta(tx, row.vehicleId, row.odometer, row.date);
  if (colecao === "interventions") await cumprirPlanos(tx, row);
  if (colecao === "interventions" || colecao === "incidents") await sincronizarEstadoViatura(tx, row.vehicleId);
}

const verFrota = requirePermission("frota", "view");

fleetRoutes.get(
  "/bootstrap",
  verFrota,
  asyncHandler(async (_req, res) => {
    const [dados, obras] = await Promise.all([
      carregarTudo(),
      prisma.project.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    ]);
    const hoje = hojeIso();
    const segs = dados.seguros;
    dados.viaturas = dados.viaturas.map((v) => ({
      ...v,
      _planos: F.estadoPlanos(v, hoje),
      _seguro: F.estadoSeguroViatura(v.id, segs, hoje),
      _planosDet: (v.maintenancePlans || []).map((p) => ({ ...p, ...F.estadoPlano(v, p, hoje) })),
    }));
    dados.motoristas = dados.motoristas.map((m) => ({ ...m, _carta: F.estadoCarta(m, hoje) }));
    dados.documentos = dados.documentos.map((d) => ({ ...d, _estado: F.estadoDocumento(d, hoje) }));
    dados.seguros = dados.seguros.map((s) => ({ ...s, _estado: F.estadoSeguro(s, hoje) }));
    const C = F.calcularAbastecimentos(dados.abastecimentos, dados.viaturas);
    dados.abastecimentos = dados.abastecimentos.map((a) => ({ ...a, _calc: C.get(a.id) || null }));
    dados.intervencoes = dados.intervencoes.map((i) => ({ ...i, _total: F.totalIntervencao(i) }));
    res.json({ hoje, listas: F.LISTAS, obras, ...dados });
  })
);

/**
 * Configurações da Frota (o `V.frcfg` do protótipo): oficinas e fornecedores
 * da frota, e quem a gere — pelo perfil (`role_permissions`) ou por exceção
 * no utilizador (`user_permissions`) no módulo `frota`.
 */
const RE_OFICINA = /oficin|lavag|mec[aâ]nic|auto|pneu|reboq|bate|chapa|pintura/i;

fleetRoutes.get(
  "/config",
  verFrota,
  asyncHandler(async (_req, res) => {
    const [fornecedores, oficinasUsadas, rolePerms, users, overrides] = await Promise.all([
      prisma.supplier.findMany({ where: { active: true }, select: { id: true, code: true, name: true, nif: true, category: true, type: true }, orderBy: { name: "asc" } }),
      prisma.fleetIntervention.groupBy({ by: ["workshop"], where: { workshop: { not: null } }, _count: true, _max: { date: true } }),
      prisma.rolePermission.findMany({ where: { OR: [{ module: "frota" }, { module: "navlinks", action: "nav_frota" }] } }),
      prisma.user.findMany({ select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
      prisma.userPermission.findMany({ where: { OR: [{ module: "frota" }, { module: "navlinks", action: "nav_frota" }] } }),
    ]);
    const nivel = (map) => {
      const ok = (a) => ["true", "own"].includes(map[a]);
      if (map.full_access === "true" || (ok("create") && ok("edit") && ok("delete"))) return "gere";
      if (ok("create") || ok("edit")) return "regista";
      if (["true", "own", "view"].includes(map.view)) return "consulta";
      return "sem";
    };
    const porPerfil = {};
    rolePerms.forEach((r) => ((porPerfil[r.role] = porPerfil[r.role] || {})[r.action] = r.allowed));
    const exc = {};
    overrides.forEach((o) => ((exc[o.userId] = exc[o.userId] || {})[o.action] = o.allowed));
    const perfis = Object.entries(porPerfil).map(([role, map]) => ({ role, nivel: role === "admin" ? "gere" : nivel(map), menu: role === "admin" || map.nav_frota === "true" }));
    const responsaveis = users
      .map((u) => {
        const base = porPerfil[u.role] || {};
        const map = { ...base, ...(exc[u.id] || {}) };
        return { id: u.id, nome: u.name || u.email, perfil: u.role, nivel: u.role === "admin" ? "gere" : nivel(map), excecao: Boolean(exc[u.id]) };
      })
      .filter((u) => u.nivel === "gere" || u.nivel === "regista");
    res.json({
      oficinas: fornecedores.filter((f) => RE_OFICINA.test(`${f.category || ""} ${f.name}`)),
      oficinasUsadas: oficinasUsadas.map((o) => ({ nome: o.workshop, intervencoes: o._count, ultima: o._max.date ? o._max.date.toISOString().slice(0, 10) : null })).sort((a, b) => b.intervencoes - a.intervencoes),
      perfis: perfis.sort((a, b) => ["gere", "regista", "consulta", "sem"].indexOf(a.nivel) - ["gere", "regista", "consulta", "sem"].indexOf(b.nivel)),
      responsaveis,
    });
  })
);

// ─── Oficina (protótipo v660/v667) ────────────────────────────────────────────

const verOficina = requireAnyPermission([["oficina", "view"], ["frota", "view"]]);
const criarOficina = requireAnyPermission([["oficina", "create"], ["frota", "create"]]);
const editarOficina = requireAnyPermission([["oficina", "edit"], ["frota", "edit"]]);

const nomeDe = (req) => req.user?.name || req.user?.email || "—";
const txt = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const dataOk = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "").slice(0, 10)) ? String(v).slice(0, 10) : "");
const horaOk = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || "")) ? String(v) : "");

function limparLinhas(L, campos, max = 60) {
  return (Array.isArray(L) ? L : []).slice(0, max).map((r) => Object.fromEntries(campos.map((c) => [c, txt(r?.[c], 300)])));
}

async function ordensDeTrabalho() {
  return plano(await prisma.fleetIntervention.findMany({ where: { workOrderStatus: { not: null } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }));
}

fleetRoutes.get(
  "/workshop",
  verOficina,
  asyncHandler(async (_req, res) => {
    const hoje = hojeIso();
    const [ots, viaturas, fornecedores] = await Promise.all([
      ordensDeTrabalho(),
      prisma.fleetVehicle.findMany({ select: { id: true, code: true, plate: true, brand: true, model: true, kind: true, status: true, active: true, odometer: true, unit: true }, orderBy: { plate: "asc" } }),
      prisma.supplier.findMany({ where: { active: true }, select: { id: true, name: true, category: true }, orderBy: { name: "asc" } }),
    ]);
    const lista = ots.map((x) => ({
      ...x,
      workOrder: W.blocoOT(x.workOrder),
      _dia: W.diaOT(x),
      _hora: W.horaOT(x),
      _sit: W.situacao(x, hoje),
      _horas: W.horasOT(x.workOrder),
      _atrasada: W.atrasada(x, hoje),
    }));
    res.json({
      hoje,
      listas: { estados: W.ESTADOS, tiposServico: W.TIPOS_SERVICO, prioridades: W.PRIORIDADES, estadosTrabalho: W.ESTADOS_TRABALHO, estadosMaterial: W.ESTADOS_MATERIAL, oficinaPropria: W.OFICINA_PROPRIA },
      ots: lista,
      viaturas: plano(viaturas),
      oficinas: fornecedores.filter((f) => RE_OFICINA.test(`${f.category || ""} ${f.name}`)),
      calendario: W.calendario(lista, hoje),
      indicadores: W.indicadores(lista),
      materiais: W.materiais(lista),
    });
  })
);

/** Novo pedido à oficina (da frota) ou novo trabalho (da própria oficina, já marcado). */
fleetRoutes.post(
  "/workshop",
  criarOficina,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const daOficina = b.modo === "of";
    const ext = daOficina && b.ext && txt(b.ext.cli) ? { cli: txt(b.ext.cli, 120), mat: txt(b.ext.mat, 40), viat: txt(b.ext.viat, 120), tel: txt(b.ext.tel, 40) } : null;
    const vehicleId = ext ? null : txt(b.vehicleId, 60) || null;
    if (!ext && !vehicleId) throw erro(400, "Escolha a viatura (ou indique o cliente externo).");
    const v = vehicleId ? await prisma.fleetVehicle.findUnique({ where: { id: vehicleId } }) : null;
    if (vehicleId && !v) throw erro(400, "Viatura não encontrada.");
    const trab = limparLinhas(b.trab, ["desc"]).filter((t) => t.desc).map((t) => ({ desc: t.desc, est: "", nota: "" }));
    if (!trab.length) throw erro(400, "Escreva pelo menos um trabalho pedido.");
    const tipo = W.TIPOS_SERVICO.includes(b.tipoServ) ? b.tipoServ : "Reparação";
    const dp = dataOk(b.dp) || hojeIso();
    const hp = horaOk(b.hp);
    let oficina = W.OFICINA_PROPRIA;
    let supplierId = null;
    if (!daOficina && b.supplierId) {
      const f = await prisma.supplier.findUnique({ where: { id: String(b.supplierId) }, select: { id: true, name: true } });
      if (!f) throw erro(400, "Fornecedor (oficina) não encontrado.");
      oficina = f.name;
      supplierId = f.id;
    }
    const now = new Date().toISOString();
    const matMBT = ["Sim", "Não", "NA"].includes(b.matMBT) ? b.matMBT : "NA";
    const workOrder = W.blocoOT({
      origem: daOficina ? "of" : "fr",
      prio: W.PRIORIDADES.includes(b.prio) ? b.prio : "Normal",
      dm: daOficina ? dp : "",
      hm: daOficina ? hp : "",
      de: dataOk(b.de),
      tec: txt(b.tec, 120),
      pedido: { d: now, por: nomeDe(req), porId: req.user.sub, dp, hp, obs: txt(b.obs, 1000) },
      trab,
      matMBT,
      mat: matMBT === "Sim" ? limparLinhas(b.mat, ["desc", "q", "un"]).filter((m) => m.desc).map((m) => ({ ...m, est: "Por entregar", qR: "", qA: "" })) : [],
      chat: [{ d: now, por: nomeDe(req), t: daOficina ? "Trabalho criado pela oficina" : `Pedido enviado à oficina${b.obs ? `: ${txt(b.obs, 300)}` : ""}` }],
      ext,
    });
    const ano = new Date().getUTCFullYear();
    const rows = await prisma.fleetIntervention.findMany({ where: { code: { startsWith: `OT-${ano}-` } }, select: { code: true } });
    const row = await prisma.fleetIntervention.create({
      data: {
        code: F.proximoCodigo("OT", rows.map((r) => r.code), { ano }),
        date: new Date(`${dp}T00:00:00Z`),
        vehicleId,
        odometer: v?.odometer ?? null,
        type: tipo,
        description: trab.map((t) => t.desc).join("\n"),
        workshop: oficina,
        supplierId,
        technician: workOrder.tec || null,
        status: "Em curso",
        workOrderStatus: daOficina ? "Marcado" : "Pedido",
        workOrder,
        createdById: req.user.sub,
      },
    });
    res.status(201).json(plano(row));
  })
);

async function otOu404(id) {
  const x = await prisma.fleetIntervention.findUnique({ where: { id } });
  if (!x || !x.workOrderStatus) throw erro(404, "Ordem de trabalho não encontrada.");
  return x;
}

/** Edição da OT: datas, técnico, trabalhos, material, horas e custos. */
fleetRoutes.patch(
  "/workshop/:id",
  editarOficina,
  asyncHandler(async (req, res) => {
    const x = await otOu404(req.params.id);
    const b = req.body || {};
    const wo = W.blocoOT(x.workOrder);
    if ("dm" in b) wo.dm = dataOk(b.dm);
    if ("hm" in b) wo.hm = horaOk(b.hm);
    if ("de" in b) wo.de = dataOk(b.de);
    if ("tec" in b) wo.tec = txt(b.tec, 120);
    if ("prio" in b && W.PRIORIDADES.includes(b.prio)) wo.prio = b.prio;
    if ("trab" in b) wo.trab = limparLinhas(b.trab, ["desc", "est", "nota"]).filter((t) => t.desc);
    if ("mat" in b) wo.mat = limparLinhas(b.mat, ["desc", "q", "un", "est", "qR", "qA"]).filter((m) => m.desc).map((m) => ({ ...m, est: W.ESTADOS_MATERIAL.includes(m.est) ? m.est : "Por entregar" }));
    if ("horas" in b) wo.horas = limparLinhas(b.horas, ["tec", "d", "ini", "fim"]).filter((h) => h.tec || h.ini || h.fim);
    const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v) || 0);
    const data = { workOrder: wo, technician: wo.tec || null };
    if ("laborCost" in b) data.laborCost = num(b.laborCost);
    if ("partsCost" in b) data.partsCost = num(b.partsCost);
    if ("otherCost" in b) data.otherCost = num(b.otherCost);
    if ("odometer" in b) data.odometer = num(b.odometer);
    if (wo.trab.length) data.description = wo.trab.map((t) => t.desc).join("\n");
    if (wo.dm) data.date = new Date(`${wo.dm}T00:00:00Z`);
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.fleetIntervention.update({ where: { id: x.id }, data });
      await atualizarConta(tx, r.vehicleId, r.odometer, r.date);
      return r;
    });
    res.json(plano(row));
  })
);

fleetRoutes.post(
  "/workshop/:id/state",
  editarOficina,
  asyncHandler(async (req, res) => {
    const x = await otOu404(req.params.id);
    const novo = String(req.body?.estado || "");
    if (novo === x.workOrderStatus) return res.json(plano(x));
    const { data, viatura } = W.mudarEstado(plano(x), novo, { hoje: hojeIso(), por: nomeDe(req) });
    ["entryDate", "exitDate"].forEach((k) => data[k] && (data[k] = new Date(`${data[k]}T00:00:00Z`)));
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.fleetIntervention.update({ where: { id: x.id }, data });
      if (viatura && r.vehicleId) {
        const v = await tx.fleetVehicle.findUnique({ where: { id: r.vehicleId }, select: { status: true, active: true } });
        if (v && v.active !== false && viatura.so(v.status)) await tx.fleetVehicle.update({ where: { id: r.vehicleId }, data: { status: viatura.status } });
      }
      if (["Concluído", "Entregue"].includes(novo)) await cumprirPlanos(tx, { ...r, status: "Concluída" });
      return r;
    });
    res.json(plano(row));
  })
);

/** Reagendar (arrastar no calendário): um pedido por aceitar passa a marcado. */
fleetRoutes.post(
  "/workshop/:id/reschedule",
  editarOficina,
  asyncHandler(async (req, res) => {
    const x = await otOu404(req.params.id);
    const dm = dataOk(req.body?.dm);
    if (!dm) throw erro(400, "Data inválida.");
    const wo = W.blocoOT(x.workOrder);
    if (wo.dm === dm) return res.json(plano(x));
    wo.dm = dm;
    wo.chat = wo.chat.concat([{ d: new Date().toISOString(), por: nomeDe(req), t: `Reagendado para ${dm}` }]);
    const row = await prisma.fleetIntervention.update({
      where: { id: x.id },
      data: { workOrder: wo, date: new Date(`${dm}T00:00:00Z`), ...(x.workOrderStatus === "Pedido" ? { workOrderStatus: "Marcado" } : {}) },
    });
    res.json(plano(row));
  })
);

fleetRoutes.post(
  "/workshop/:id/messages",
  verOficina,
  asyncHandler(async (req, res) => {
    const x = await otOu404(req.params.id);
    const t = txt(req.body?.t, 1000);
    if (!t) throw erro(400, "Escreva a mensagem.");
    const wo = W.blocoOT(x.workOrder);
    wo.chat = wo.chat.concat([{ d: new Date().toISOString(), por: nomeDe(req), t }]);
    const row = await prisma.fleetIntervention.update({ where: { id: x.id }, data: { workOrder: wo } });
    res.json(plano(row));
  })
);

fleetRoutes.get(
  "/overview",
  verFrota,
  asyncHandler(async (req, res) => {
    const dados = await carregarTudo();
    const hoje = hojeIso();
    const { mes = "", grupo = "", per = "mes" } = req.query;
    res.json({ hoje, painel: F.painel(dados, hoje), gestao: F.painelGestao(dados, hoje, { mes: String(mes), grupo: String(grupo), per: String(per) }), alertas: F.alertas(dados, hoje) });
  })
);

fleetRoutes.get(
  "/costs",
  verFrota,
  asyncHandler(async (req, res) => {
    const de = String(req.query.de || "").slice(0, 10);
    const ate = String(req.query.ate || "").slice(0, 10);
    const vid = String(req.query.viatura || "");
    const dados = await carregarTudo();
    const out = { de, ate, categorias: F.LISTAS.categoriasCusto, resumo: F.custosResumo(dados, { de, ate }) };
    if (vid) {
      const v = dados.viaturas.find((x) => x.id === vid);
      if (!v) return res.status(404).json({ error: "VIATURA_NAO_ENCONTRADA" });
      out.viatura = { id: v.id, matricula: v.plate, nome: [v.brand, v.model].filter(Boolean).join(" "), ...F.custosViatura(vid, dados, { de, ate }) };
    }
    res.json(out);
  })
);

function cfgDe(req) {
  const cfg = COLECOES[req.params.colecao];
  if (!cfg) throw erro(404, "Colecção desconhecida.");
  return cfg;
}

const permPara = (acao) => (req, res, next) => (COLECOES[req.params.colecao] ? requirePermission("frota", acao)(req, res, next) : res.status(404).json({ error: "NOT_FOUND" }));

fleetRoutes.get(
  "/:colecao",
  permPara("view"),
  asyncHandler(async (req, res) => {
    const cfg = cfgDe(req);
    const rows = await prisma[cfg.model].findMany({ orderBy: cfg.ordem });
    res.json({ items: plano(rows) });
  })
);

fleetRoutes.post(
  "/:colecao",
  permPara("create"),
  asyncHandler(async (req, res) => {
    const col = req.params.colecao;
    const cfg = cfgDe(req);
    const data = await preparar(col, lerCorpo(cfg, req.body, { criar: true }));
    if (cfg.prefixo) data.code = await proximoCodigo(cfg);
    if (col !== "drivers") data.createdById = req.user.sub;
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx[cfg.model].create({ data });
      await depois(tx, col, r);
      return r;
    });
    res.status(201).json(plano(row));
  })
);

fleetRoutes.patch(
  "/:colecao/:id",
  permPara("edit"),
  asyncHandler(async (req, res) => {
    const col = req.params.colecao;
    const cfg = cfgDe(req);
    const atual = await prisma[cfg.model].findUnique({ where: { id: req.params.id } });
    if (!atual) return res.status(404).json({ error: "NOT_FOUND" });
    const data = await preparar(col, lerCorpo(cfg, req.body, { criar: false }), { atual });
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx[cfg.model].update({ where: { id: atual.id }, data });
      await depois(tx, col, r);
      return r;
    });
    res.json(plano(row));
  })
);

fleetRoutes.delete(
  "/:colecao/:id",
  permPara("delete"),
  asyncHandler(async (req, res) => {
    const cfg = cfgDe(req);
    const atual = await prisma[cfg.model].findUnique({ where: { id: req.params.id } });
    if (!atual) return res.status(404).json({ error: "NOT_FOUND" });
    if (req.params.colecao === "vehicles") {
      const [a, i, o] = await Promise.all([
        prisma.fleetFuel.count({ where: { vehicleId: atual.id } }),
        prisma.fleetIntervention.count({ where: { vehicleId: atual.id } }),
        prisma.fleetIncident.count({ where: { vehicleId: atual.id } }),
      ]);
      if (a + i + o > 0) {
        return res.status(409).json({ error: "VIATURA_COM_REGISTOS", message: "A viatura tem registos (abastecimentos, intervenções ou ocorrências). Marque-a como Vendida / Abatida em vez de a apagar." });
      }
    }
    await prisma[cfg.model].delete({ where: { id: atual.id } });
    if (req.params.colecao === "vehicles") {
      const segs = await prisma.fleetInsurance.findMany({ where: { vehicleIds: { has: atual.id } } });
      await Promise.all(segs.map((s) => prisma.fleetInsurance.update({ where: { id: s.id }, data: { vehicleIds: s.vehicleIds.filter((x) => x !== atual.id) } })));
    }
    if (["interventions", "incidents"].includes(req.params.colecao)) await sincronizarEstadoViatura(prisma, atual.vehicleId);
    res.json({ ok: true });
  })
);

// ─── Ficheiros (fotografias da viatura e do motorista, talões, digitalizações, apólices) ───

const multer = require("multer");
const path = require("path");
const { uploadToSupabase } = require("../utils/storage");

const enviar = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const TIPOS_FICHEIRO = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/i;
const SLOTS_VIATURA = new Set(F.LISTAS.fotos.map(([k]) => k));

/**
 * POST /fleet/:colecao/:id/files  (campo `file`; `slot` opcional)
 *   viatura + slot (tq, frente…) → fotografia dessa posição
 *   motorista + slot=foto        → fotografia do motorista
 *   senão                        → junta aos anexos do registo
 */
fleetRoutes.post(
  "/:colecao/:id/files",
  permPara("edit"),
  enviar.single("file"),
  asyncHandler(async (req, res) => {
    const col = req.params.colecao;
    const cfg = cfgDe(req);
    const atual = await prisma[cfg.model].findUnique({ where: { id: req.params.id } });
    if (!atual) return res.status(404).json({ error: "NOT_FOUND" });
    if (!req.file) throw erro(400, "Escolha o ficheiro.");
    if (!TIPOS_FICHEIRO.test(req.file.mimetype || "")) throw erro(400, "Só imagens (JPG, PNG, WEBP) ou PDF.");
    const ext = (path.extname(req.file.originalname || "").toLowerCase() || (/pdf/i.test(req.file.mimetype) ? ".pdf" : ".jpg")).replace(/[^.a-z0-9]/g, "");
    const slot = String(req.body?.slot || "");
    const url = await uploadToSupabase(`frota/${col}/${atual.id}/${slot || "doc"}-${Date.now()}${ext}`, req.file.buffer, req.file.mimetype);
    let data;
    if (col === "vehicles" && SLOTS_VIATURA.has(slot)) data = { photos: { ...(atual.photos || {}), [slot]: url } };
    else if (col === "drivers" && slot === "foto") data = { photo: url };
    else {
      const nome = String(req.file.originalname || "ficheiro").slice(0, 160);
      data = { attachments: [...(Array.isArray(atual.attachments) ? atual.attachments : []), { nome, url, tipo: req.file.mimetype, d: new Date().toISOString(), por: req.user?.name || req.user?.email || "" }] };
    }
    const row = await prisma[cfg.model].update({ where: { id: atual.id }, data });
    res.json(plano(row));
  })
);

/** DELETE /fleet/:colecao/:id/files  { url } — tira o ficheiro do registo (o ficheiro fica no arquivo). */
fleetRoutes.delete(
  "/:colecao/:id/files",
  permPara("edit"),
  asyncHandler(async (req, res) => {
    const cfg = cfgDe(req);
    const atual = await prisma[cfg.model].findUnique({ where: { id: req.params.id } });
    if (!atual) return res.status(404).json({ error: "NOT_FOUND" });
    const url = String(req.body?.url || req.query.url || "");
    const data = {};
    if (Array.isArray(atual.attachments)) data.attachments = atual.attachments.filter((a) => a.url !== url);
    if (atual.photos && typeof atual.photos === "object") data.photos = Object.fromEntries(Object.entries(atual.photos).filter(([, u]) => u !== url));
    if (atual.photo === url) data.photo = null;
    const row = await prisma[cfg.model].update({ where: { id: atual.id }, data });
    res.json(plano(row));
  })
);

// Erros com mensagem para o utilizador (validação, matrícula repetida…)
fleetRoutes.use((err, _req, res, next) => {
  if (err?.publicMessage) return res.status(err.status || 400).json({ error: "FLEET_ERROR", message: err.publicMessage });
  return next(err);
});

module.exports = { fleetRoutes, COLECOES };
