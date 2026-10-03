/**
 * Ciclo de vida da obra (Fase 1): estado, datas, pausas e contactos.
 * Mantém compatibilidade com o JSON legado em maoDeObraIndireta.registo.
 */

const STATUS_FROM_LABEL = {
  "Por Iniciar": "NOT_STARTED",
  "Em Execução": "ACTIVE",
  "Em Pausa": "ON_HOLD",
  "Concluído": "COMPLETED",
};

const LABEL_FROM_STATUS = {
  NOT_STARTED: "Por Iniciar",
  ACTIVE: "Em Execução",
  ON_HOLD: "Em Pausa",
  COMPLETED: "Concluído",
};

const PROJECT_STATUSES = ["NOT_STARTED", "ACTIVE", "ON_HOLD", "COMPLETED"];

function parseDate(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const raw = String(value).trim();
  const date = raw.includes("T") ? new Date(raw) : new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    const err = new Error("INVALID_DATE");
    err.status = 400;
    err.code = "INVALID_DATE";
    throw err;
  }
  return date;
}

function dateOnly(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeStatus(status, phaseLabel) {
  if (status && STATUS_FROM_LABEL[status]) return STATUS_FROM_LABEL[status];
  if (status && PROJECT_STATUSES.includes(status)) return status;
  if (phaseLabel && STATUS_FROM_LABEL[phaseLabel]) return STATUS_FROM_LABEL[phaseLabel];
  return status || null;
}

function readLegacyRegisto(maoDeObraIndireta) {
  const raw = maoDeObraIndireta;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.registo && typeof raw.registo === "object") {
    return raw.registo;
  }
  return {};
}

function mergeLegacyRegisto(existing, patch) {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  if (existing != null && (Array.isArray(existing) || typeof existing !== "object")) {
    base.legado = existing;
  }
  base.registo = { ...(base.registo || {}), ...patch };
  return base;
}

function pausePayload(items) {
  if (items === undefined) return undefined;
  if (!Array.isArray(items)) {
    const err = new Error("INVALID_PAUSES");
    err.status = 400;
    throw err;
  }
  return items
    .map((item) => {
      const startDate = parseDate(item.startDate || item.inicio);
      const endDate = parseDate(item.endDate || item.fim);
      if (!startDate || !endDate) return null;
      if (endDate < startDate) {
        const err = new Error("PAUSE_END_BEFORE_START");
        err.status = 400;
        err.code = "PAUSE_END_BEFORE_START";
        throw err;
      }
      return { startDate, endDate, reason: item.reason || item.motivo || null };
    })
    .filter(Boolean);
}

function assertLifecycle(status, pauses, actualEndDate) {
  if (status === "ON_HOLD" && (!pauses || !pauses.length)) {
    const err = new Error("PAUSE_REQUIRED");
    err.status = 400;
    err.code = "PAUSE_REQUIRED";
    throw err;
  }
  if (status === "COMPLETED" && !actualEndDate) {
    const err = new Error("ACTUAL_END_DATE_REQUIRED");
    err.status = 400;
    err.code = "ACTUAL_END_DATE_REQUIRED";
    throw err;
  }
}

async function assertContactsExist(tx, contactIds) {
  if (!contactIds?.length) return [];
  const ids = [...new Set(contactIds.map(String))];
  const found = await tx.contact.findMany({
    where: { id: { in: ids }, active: true },
    select: { id: true, name: true, role: true, phone: true, email: true, photoUrl: true },
  });
  if (found.length !== ids.length) {
    const err = new Error("CONTACT_NOT_FOUND");
    err.status = 400;
    err.code = "CONTACT_NOT_FOUND";
    throw err;
  }
  return found;
}

function lifecycleInclude() {
  return {
    pauses: { orderBy: { startDate: "asc" } },
    projectContacts: {
      include: {
        contact: {
          select: { id: true, name: true, role: true, phone: true, email: true, photoUrl: true, active: true },
        },
      },
    },
  };
}

function serializeLifecycle(project) {
  const legacy = readLegacyRegisto(project.maoDeObraIndireta);
  const pauses = (project.pauses || []).length
    ? project.pauses.map((pause) => ({
        id: pause.id,
        startDate: pause.startDate,
        endDate: pause.endDate,
        inicio: dateOnly(pause.startDate),
        fim: dateOnly(pause.endDate),
        reason: pause.reason || null,
      }))
    : (Array.isArray(legacy.pausas) ? legacy.pausas : []).map((pause, index) => ({
        id: `legacy-${index}`,
        startDate: parseDate(pause.inicio || pause.startDate),
        endDate: parseDate(pause.fim || pause.endDate),
        inicio: pause.inicio || dateOnly(pause.startDate),
        fim: pause.fim || dateOnly(pause.endDate),
        reason: pause.reason || null,
      }));

  const contacts = (project.projectContacts || [])
    .map((row) => row.contact)
    .filter(Boolean);

  const status = project.status;
  const estado = LABEL_FROM_STATUS[status] || legacy.estado || project.phaseLabel || "Em Execução";

  return {
    launchDate: project.launchDate || parseDate(legacy.arranque) || null,
    actualEndDate: project.actualEndDate || parseDate(legacy.conclusaoEfetiva) || null,
    estado,
    pauses,
    contacts,
    lifecycle: {
      status,
      estado,
      operationalStartDate: project.startDate || parseDate(legacy.inicioOperacional) || null,
      launchDate: project.launchDate || parseDate(legacy.arranque) || null,
      plannedEndDate: project.dueDate || parseDate(legacy.conclusaoPrevisional) || null,
      actualEndDate: project.actualEndDate || parseDate(legacy.conclusaoEfetiva) || null,
    },
  };
}

async function applyProjectRegistry(tx, projectId, input, existing) {
  const status = normalizeStatus(input.status, input.phaseLabel) || existing?.status || "ACTIVE";
  const startDate = input.startDate !== undefined ? parseDate(input.startDate) : existing?.startDate;
  const dueDate = input.dueDate !== undefined ? parseDate(input.dueDate) : existing?.dueDate;
  const launchDate = input.launchDate !== undefined ? parseDate(input.launchDate) : existing?.launchDate;
  const actualEndDate = input.actualEndDate !== undefined
    ? parseDate(input.actualEndDate)
    : (status === "COMPLETED" ? existing?.actualEndDate : existing?.actualEndDate);
  const pauses = input.pauses !== undefined ? pausePayload(input.pauses) : undefined;
  const effectivePauses = pauses !== undefined ? pauses : existing?.pauses;
  const resolvedActual = actualEndDate !== undefined ? actualEndDate : existing?.actualEndDate;

  assertLifecycle(status, effectivePauses, resolvedActual);

  const phaseLabel = input.phaseLabel || LABEL_FROM_STATUS[status] || existing?.phaseLabel || null;

  const legacyPatch = {
    estado: LABEL_FROM_STATUS[status] || phaseLabel,
    inicioOperacional: startDate ? dateOnly(startDate) : (existing && readLegacyRegisto(existing.maoDeObraIndireta).inicioOperacional) || "",
    arranque: launchDate ? dateOnly(launchDate) : (existing && readLegacyRegisto(existing.maoDeObraIndireta).arranque) || "",
    conclusaoPrevisional: dueDate ? dateOnly(dueDate) : (existing && readLegacyRegisto(existing.maoDeObraIndireta).conclusaoPrevisional) || "",
    conclusaoEfetiva: resolvedActual ? dateOnly(resolvedActual) : "",
  };
  if (pauses !== undefined) {
    legacyPatch.pausas = pauses.map((pause) => ({
      inicio: dateOnly(pause.startDate),
      fim: dateOnly(pause.endDate),
    }));
  }

  const maoDeObraIndireta = input.maoDeObraIndireta !== undefined
    ? mergeLegacyRegisto(input.maoDeObraIndireta, legacyPatch)
    : mergeLegacyRegisto(existing?.maoDeObraIndireta, legacyPatch);

  const data = {
    status,
    phaseLabel,
    startDate: startDate ?? null,
    dueDate: dueDate ?? null,
    launchDate: launchDate ?? null,
    actualEndDate: resolvedActual ?? null,
    maoDeObraIndireta,
  };

  if (projectId) {
    await tx.project.update({ where: { id: projectId }, data });
  }

  if (projectId && pauses !== undefined) {
    await tx.projectPause.deleteMany({ where: { projectId } });
    if (pauses.length) {
      await tx.projectPause.createMany({
        data: pauses.map((pause) => ({ ...pause, projectId })),
      });
    }
  }

  if (projectId && input.contactIds !== undefined) {
    const contacts = await assertContactsExist(tx, input.contactIds);
    await tx.projectContact.deleteMany({ where: { projectId } });
    if (contacts.length) {
      await tx.projectContact.createMany({
        data: contacts.map((contact) => ({ projectId, contactId: contact.id })),
      });
    }
    const director = contacts.find((c) => /director/i.test(c.role || "")) || contacts[0] || null;
    await tx.project.update({
      where: { id: projectId },
      data: {
        contact: contacts.map((c) => c.name).join(", ") || null,
        directorObra: director?.name || null,
        directorPhone: director?.phone || null,
        directorEmail: director?.email || null,
        technicians: contacts.map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          phone: c.phone,
          email: c.email,
        })),
      },
    });
  }

  return { status, phaseLabel, startDate, dueDate, launchDate, actualEndDate: resolvedActual, maoDeObraIndireta, pauses };
}

module.exports = {
  PROJECT_STATUSES,
  STATUS_FROM_LABEL,
  LABEL_FROM_STATUS,
  parseDate,
  normalizeStatus,
  lifecycleInclude,
  serializeLifecycle,
  applyProjectRegistry,
  pausePayload,
};
