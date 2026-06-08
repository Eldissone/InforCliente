function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Próximo nº de auto sequencial (01, 02, …) para o projeto. */
function getNextReportNumber(existingReports = []) {
  const nums = (existingReports || [])
    .map((r) => {
      const m = String(r.reportNumber || "").match(/\d+/);
      return m ? parseInt(m[0], 10) : 0;
    })
    .filter((n) => Number.isFinite(n) && n > 0);

  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return String(next).padStart(2, "0");
}

function taskUnitValue(t) {
  const uvM = num(t.unitValueMaterial);
  const uvS = num(t.unitValueService);
  return t.unitValue !== null && t.unitValue !== undefined ? num(t.unitValue) : uvM + uvS;
}

function getChildTasks(tasks, parentId) {
  return tasks
    .filter((t) => t.parentId === parentId)
    .sort((a, b) => num(a.order) - num(b.order) || (a.description || "").localeCompare(b.description || "", "pt"));
}

function getRootTasks(tasks) {
  return tasks
    .filter((t) => !t.parentId)
    .sort((a, b) =>
      (a.itemGroup || "").localeCompare(b.itemGroup || "", "pt", { sensitivity: "base" }) ||
      num(a.order) - num(b.order)
    );
}

function historyQtyAt(taskId, dateStr, history, fallback = 0) {
  if (!dateStr || !history?.length) return fallback;
  const cutoff = new Date(`${String(dateStr).slice(0, 10)}T23:59:59`);
  const entries = history
    .filter((h) => h.taskId === taskId && new Date(h.date) <= cutoff)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return entries.length ? num(entries[0].accumulatedQty) : 0;
}

function resolveTaskQtys(t, allTasks, history, currentDate, prevDate) {
  const children = getChildTasks(allTasks, t.id);
  const hasChildren = children.length > 0;
  const currency = t.currency === "USD" ? "USD" : "Kz";

  if (hasChildren) {
    const childQtys = children.map((c) => resolveTaskQtys(c, allTasks, history, currentDate, prevDate));
    const exp = childQtys.reduce((s, q) => s + q.exp, 0);
    const acc = childQtys.reduce((s, q) => s + q.acc, 0);
    const prev = childQtys.reduce((s, q) => s + q.prev, 0);
    const period = childQtys.reduce((s, q) => s + q.period, 0);
    const totalVal = childQtys.reduce((s, q) => s + q.totalVal, 0);
    const accVal = childQtys.reduce((s, q) => s + q.accVal, 0);
    const prevVal = childQtys.reduce((s, q) => s + q.prevVal, 0);
    const periodVal = childQtys.reduce((s, q) => s + q.periodVal, 0);
    const open = Math.max(0, exp - acc);
    const openVal = Math.max(0, totalVal - accVal);

    return {
      exp, acc, prev, period, open, totalVal, accVal, prevVal, periodVal, openVal,
      uv: exp > 0 ? totalVal / exp : 0,
      unit: t.unit,
      currency,
      hasChildren: true,
      children: childQtys,
    };
  }

  const uv = taskUnitValue(t);
  const exp = num(t.expectedQty);
  const acc = currentDate
    ? historyQtyAt(t.id, currentDate, history, num(t.executedQty))
    : num(t.executedQty);
  const prev = prevDate ? historyQtyAt(t.id, prevDate, history, 0) : 0;
  const period = Math.max(0, acc - prev);
  const open = Math.max(0, exp - acc);
  const totalVal = uv * exp;
  const accVal = uv * acc;
  const prevVal = uv * prev;
  const periodVal = uv * period;
  const openVal = Math.max(0, totalVal - accVal);

  return {
    exp, acc, prev, period, open, totalVal, accVal, prevVal, periodVal, openVal,
    uv, unit: t.unit, currency, hasChildren: false, children: [],
  };
}

function resolveWbsCode(task, fallback) {
  return (task.wbsCode || task.itemCode || fallback || "").trim();
}

function buildMeasurementSnapshot(tasks, history, options = {}) {
  const {
    filterGroup = "all",
    currentDate = null,
    prevDate = null,
    reportNumber = "01",
    projectName = "Obra",
    currency = "Kz",
  } = options;

  const filtered = tasks.filter((t) => filterGroup === "all" || (t.itemGroup || "") === filterGroup);
  const roots = getRootTasks(filtered);
  const rows = [];

  let globalTotalVal = 0;
  roots.forEach((t) => {
    globalTotalVal += resolveTaskQtys(t, filtered, history, currentDate, prevDate).totalVal;
  });

  const grand = {
    kind: "grand",
    wbs: "",
    description: projectName.toUpperCase(),
    unit: "vg",
    currency,
    pctGlobal: 100,
    exp: 0, acc: 0, prev: 0, period: 0, open: 0,
    totalVal: 0, accVal: 0, prevVal: 0, periodVal: 0, openVal: 0,
  };

  let lastGroup = null;
  let groupCounter = 0;
  let groupIndex = 0;

  function walkTask(t, depth, wbs, rowClass) {
    const q = resolveTaskQtys(t, filtered, history, currentDate, prevDate);
    const children = getChildTasks(filtered, t.id);

    grand.exp += q.exp;
    grand.acc += q.acc;
    grand.prev += q.prev;
    grand.period += q.period;
    grand.open += q.open;
    grand.totalVal += q.totalVal;
    grand.accVal += q.accVal;
    grand.prevVal += q.prevVal;
    grand.periodVal += q.periodVal;
    grand.openVal += q.openVal;

    const pctGlobal = globalTotalVal > 0 ? (q.totalVal / globalTotalVal) * 100 : 0;
    rows.push({
      kind: "task",
      wbs: resolveWbsCode(t, wbs),
      description: t.description,
      depth,
      rowClass,
      pctGlobal,
      ...q,
    });

    children.forEach((child, i) => {
      const childWbs = resolveWbsCode(child, `${wbs}.${i + 1}`);
      const childClass = depth >= 1 ? "item" : "category";
      walkTask(child, depth + 1, childWbs, childClass);
    });
  }

  roots.forEach((t) => {
    const groupName = t.itemGroup || "Outros / Geral";

    if (filterGroup === "all" && groupName !== lastGroup) {
      groupCounter++;
      groupIndex = 0;
      const groupParents = roots.filter((p) => (p.itemGroup || "Outros / Geral") === groupName);
      const groupAgg = groupParents.reduce((agg, p) => {
        const pq = resolveTaskQtys(p, filtered, history, currentDate, prevDate);
        agg.exp += pq.exp;
        agg.acc += pq.acc;
        agg.prev += pq.prev;
        agg.period += pq.period;
        agg.open += pq.open;
        agg.totalVal += pq.totalVal;
        agg.accVal += pq.accVal;
        agg.prevVal += pq.prevVal;
        agg.periodVal += pq.periodVal;
        agg.openVal += pq.openVal;
        return agg;
      }, {
        exp: 0, acc: 0, prev: 0, period: 0, open: 0,
        totalVal: 0, accVal: 0, prevVal: 0, periodVal: 0, openVal: 0,
        unit: "vg",
        currency: groupParents[0]?.currency === "USD" ? "USD" : currency,
      });

      rows.push({
        kind: "section",
        wbs: String(groupCounter),
        description: groupName.toUpperCase(),
        depth: 0,
        rowClass: "section",
        pctGlobal: globalTotalVal > 0 ? (groupAgg.totalVal / globalTotalVal) * 100 : 0,
        hasChildren: true,
        children: [],
        ...groupAgg,
      });
      lastGroup = groupName;
    }

    groupIndex++;
    const wbsPrefix = filterGroup === "all" ? String(groupCounter) : "";
    const wbs = resolveWbsCode(t, wbsPrefix ? `${wbsPrefix}.${groupIndex}` : String(groupIndex));
    const children = getChildTasks(filtered, t.id);
    const rowClass = children.length > 0 ? "category" : "item";
    walkTask(t, 0, wbs, rowClass);
  });

  return {
    meta: { reportNumber, currentDate, prevDate, projectName, currency, filterGroup },
    rows,
    grand,
    globalTotalVal,
    periodValTotal: grand.periodVal,
    periodQtyTotal: grand.period,
  };
}

module.exports = {
  buildMeasurementSnapshot,
  getNextReportNumber,
  resolveTaskQtys,
  getChildTasks,
  getRootTasks,
  resolveWbsCode,
  historyQtyAt,
  taskUnitValue,
};
