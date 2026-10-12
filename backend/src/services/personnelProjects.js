/**
 * Alocação de obras a pessoal.
 *
 * Fonte da verdade: tabela PersonnelProject (N:N).
 * Personnel.projectId fica sincronizado com a primeira obra da lista, para
 * código legado (Folha de Ponto, listagens) que ainda lê um único id.
 *
 * INTERNO: 0..N obras. SUBCONTRATADO: no máximo 1 obra.
 */
const PERSONNEL_PROJECT_SELECT = { id: true, name: true, code: true };

const PERSONNEL_PROJECT_INCLUDE = {
  project: { select: PERSONNEL_PROJECT_SELECT },
  projectAssignments: {
    orderBy: { createdAt: "asc" },
    include: { project: { select: PERSONNEL_PROJECT_SELECT } },
  },
};

function uniqueIds(values) {
  const seen = new Set();
  const ids = [];
  for (const value of values || []) {
    const id = String(value ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function isSubcontratado(type) {
  return String(type || "").trim().toUpperCase() === "SUBCONTRATADO";
}

/**
 * Resolve a lista canónica de obras a gravar.
 * `projectIds` (array) prevalece sobre o `projectId` legado.
 * Se nenhum dos dois for enviado, usa `existingIds` (PATCH sem alteração de obras).
 */
function normalizePersonnelProjectIds({ type, projectId, projectIds, existingIds } = {}) {
  let ids;
  if (Array.isArray(projectIds)) {
    ids = uniqueIds(projectIds);
  } else if (projectId !== undefined) {
    ids = uniqueIds(projectId ? [projectId] : []);
  } else if (existingIds) {
    ids = uniqueIds(existingIds);
  } else {
    ids = [];
  }
  if (isSubcontratado(type)) ids = ids.slice(0, 1);
  return { ids, primaryId: ids[0] || null };
}

function hasProjectInput(body) {
  return Object.prototype.hasOwnProperty.call(body || {}, "projectIds")
    || Object.prototype.hasOwnProperty.call(body || {}, "projectId");
}

function assignmentCreate(ids) {
  return { create: (ids || []).map((projectId) => ({ projectId })) };
}

function assignmentReplace(ids) {
  return {
    deleteMany: {},
    create: (ids || []).map((projectId) => ({ projectId })),
  };
}

async function assertProjectsExist(ids) {
  const unique = uniqueIds(ids);
  if (!unique.length) return;
  const { prisma } = require("../db");
  const found = await prisma.project.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    const err = new Error("PROJECT_NOT_FOUND");
    err.status = 400;
    err.payload = { error: "PROJECT_NOT_FOUND" };
    throw err;
  }
}

function serializePersonnelProjects(row) {
  const fromAssignments = (row.projectAssignments || [])
    .map((rowAssign) => (rowAssign.project
      ? { id: rowAssign.project.id, name: rowAssign.project.name, code: rowAssign.project.code }
      : null))
    .filter(Boolean);
  const projects = fromAssignments.length
    ? fromAssignments
    : (row.project
      ? [{ id: row.project.id, name: row.project.name, code: row.project.code }]
      : []);
  const primary = projects[0] || null;
  return {
    projectId: primary?.id || row.projectId || null,
    project: primary,
    projectIds: projects.map((project) => project.id),
    projects,
  };
}

function takePersonnelProjectFields(body) {
  const { projectIds, ...rest } = body || {};
  return {
    rest,
    projectId: rest.projectId,
    projectIds,
    hasProjectIds: Object.prototype.hasOwnProperty.call(body || {}, "projectIds"),
    hasProjectId: Object.prototype.hasOwnProperty.call(body || {}, "projectId"),
  };
}

module.exports = {
  PERSONNEL_PROJECT_INCLUDE,
  normalizePersonnelProjectIds,
  hasProjectInput,
  assignmentCreate,
  assignmentReplace,
  assertProjectsExist,
  serializePersonnelProjects,
  takePersonnelProjectFields,
};
