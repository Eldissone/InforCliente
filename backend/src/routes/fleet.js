/**
 * Frota — a área «frota» do protótipo (NAV_FROTA):
 *   GET  /fleet/bootstrap            todos os registos + listas (os ecrãs filtram no browser)
 *   GET  /fleet/overview             V1 Painel e V2 Alertas
 *   GET  /fleet/costs?de=&ate=&viatura=   V13 Custos por Viatura
 *   CRUD /fleet/:colecao[/:id]       vehicles, drivers, fuel, interventions, incidents, documents, insurances
 *
 * Permissões: módulo `frota` (view / create / edit / delete). O menu tem `navlinks:nav_frota`.
 */

const express = require("express");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission } = require("../middlewares/auth");
const F = require("../services/fleet/fleetCore");

const fleetRoutes = express.Router();
fleetRoutes.use(authRequired);

const T = { s: "str", i: "int", d: "dec", t: "date", b: "bool", j: "json", a: "arr" };

/** Campos aceites por colecção: nome → tipo. `req`: obrigatórios na criação. */
const COLECOES = {
  vehicles: {
    model: "fleetVehicle",
    prefixo: "FR",
    porAno: false,
    campos: {
      plate: T.s, kind: T.s, brand: T.s, model: T.s, year: T.i, unit: T.s, fuel: T.s, tankCapacity: T.d, refConsumption: T.d,
      odometer: T.d, acquisitionValue: T.d, ownership: T.s, assignedTo: T.s, projectId: T.s, driverId: T.s, status: T.s,
      active: T.b, notes: T.s, maintenancePlans: T.j,
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
      station: T.s, paymentMethod: T.s, receipt: T.s, projectId: T.s, justification: T.s, notes: T.s,
    },
    req: [["date", "data"], ["vehicleId", "viatura"], ["liters", "litros"]],
    ordem: [{ date: "desc" }, { createdAt: "desc" }],
  },
  interventions: {
    model: "fleetIntervention",
    prefixo: "OS",
    porAno: true,
    campos: {
      date: T.t, vehicleId: T.s, odometer: T.d, type: T.s, system: T.s, description: T.s, supplierId: T.s, workshop: T.s, technician: T.s,
      entryDate: T.t, exitDate: T.t, status: T.s, laborCost: T.d, partsCost: T.d, otherCost: T.d, warranty: T.s, nextAction: T.s,
      nextDate: T.t, nextOdometer: T.d, planIds: T.a, incidentId: T.s, notes: T.s,
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
  if (v === null || v === "") return tipo === T.a ? [] : tipo === T.b ? false : tipo === T.j ? [] : null;
  switch (tipo) {
    case T.s: return String(v).trim() || null;
    case T.i: { const x = parseInt(v, 10); return Number.isFinite(x) ? x : null; }
    case T.d: { const x = Number(String(v).replace(",", ".")); return Number.isFinite(x) ? x : null; }
    case T.t: { const s = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw erro(400, `Data inválida: ${v}`); return new Date(`${s}T00:00:00Z`); }
    case T.b: return v === true || v === "true" || v === "1" || v === 1 || v === "Sim";
    case T.j: return Array.isArray(v) || typeof v === "object" ? v : [];
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
  if (!intervencao.planIds?.length || intervencao.status !== "Concluída") return;
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
    ["kind", "brand", "model"].forEach((k) => data[k] && (data[k] = data[k].toUpperCase()));
    if ("maintenancePlans" in data) data.maintenancePlans = normalizarPlanos(data.maintenancePlans);
    if ("odometer" in data && data.odometer !== null && (!atual || Number(atual.odometer) !== data.odometer)) data.odometerAt = new Date();
    if (data.status && ["Vendida", "Abatida"].includes(data.status)) data.active = false;
  }
  if (colecao === "fuel") {
    if ((data.amount === null || data.amount === undefined) && data.liters && data.pricePerLiter) data.amount = Math.round(data.liters * data.pricePerLiter * 100) / 100;
    if (!atual && (data.amount === null || data.amount === undefined)) throw erro(400, "Indique o valor ou o preço por litro.");
    if (data.amount === null) throw erro(400, "Indique o valor ou o preço por litro.");
  }
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

async function depois(tx, colecao, row) {
  if (colecao === "fuel" || colecao === "interventions") await atualizarConta(tx, row.vehicleId, row.odometer, row.date);
  if (colecao === "interventions") await cumprirPlanos(tx, row);
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

fleetRoutes.get(
  "/overview",
  verFrota,
  asyncHandler(async (_req, res) => {
    const dados = await carregarTudo();
    const hoje = hojeIso();
    res.json({ hoje, painel: F.painel(dados, hoje), alertas: F.alertas(dados, hoje) });
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
    res.json({ ok: true });
  })
);

// Erros com mensagem para o utilizador (validação, matrícula repetida…)
fleetRoutes.use((err, _req, res, next) => {
  if (err?.publicMessage) return res.status(err.status || 400).json({ error: "FLEET_ERROR", message: err.publicMessage });
  return next(err);
});

module.exports = { fleetRoutes, COLECOES };
