import { formatCurrency } from "../format.js";

/**
 * Gráficos da Área Financeira.
 *
 * O ApexCharts já é usado nos dashboards da plataforma, por isso é carregado
 * aqui a pedido (só quando um ecrã financeiro tem gráficos) em vez de obrigar a
 * acrescentar o script a todos os HTML. Se a CDN falhar, o ecrã mostra uma
 * mensagem no lugar do gráfico e o resto da página continua a funcionar.
 *
 * Todas as opções partem do mesmo tema — as cores e o tipo de letra são os da
 * plataforma — e os gráficos são responsivos: ocupam sempre 100% da largura do
 * cartão e são redesenhados quando o cartão muda de tamanho (grelha, menu,
 * redimensionar a janela).
 */

const APEX_CDN = "https://cdn.jsdelivr.net/npm/apexcharts";

/** Paleta da plataforma (azul institucional, verde, âmbar, violeta, vermelho). */
export const CHART_COLORS = ["#0d3fd1", "#059669", "#f59e0b", "#6d28d9", "#ed3237", "#0ea5e9", "#64748b"];

export const TONES = {
  blue: "#0d3fd1",
  emerald: "#059669",
  amber: "#f59e0b",
  violet: "#6d28d9",
  red: "#ed3237",
  slate: "#94a3b8",
  sky: "#0ea5e9",
};

export const SERIES_TONES = {
  invoiced: "#0d3fd1",
  received: "#059669",
  toBill: "#f59e0b",
  cost: "#ed3237",
  committed: "#94a3b8",
  forecast: "#6d28d9",
};

let apexPromise = null;
/** Instâncias por elemento — evita sobrepor gráficos quando o ecrã redesenha. */
const instances = new WeakMap();

/** Carrega o ApexCharts uma única vez (ou devolve o que já está na página). */
export function loadApexCharts() {
  if (typeof window === "undefined") return Promise.reject(new Error("Sem janela."));
  if (window.ApexCharts) return Promise.resolve(window.ApexCharts);
  if (apexPromise) return apexPromise;

  apexPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = APEX_CDN;
    script.async = true;
    script.onload = () =>
      window.ApexCharts ? resolve(window.ApexCharts) : reject(new Error("ApexCharts indisponível."));
    script.onerror = () => reject(new Error("Falha ao carregar a biblioteca de gráficos."));
    document.head.appendChild(script);
  });
  // Uma falha de rede não deve bloquear novas tentativas.
  apexPromise.catch(() => {
    apexPromise = null;
  });
  return apexPromise;
}

/** Formata valores em Kwanza de forma compacta para os eixos dos gráficos. */
export function compactMoney(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B Kz`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M Kz`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K Kz`;
  return `${n.toFixed(0)} Kz`;
}

export function money(value, currency = "AOA") {
  return formatCurrency(Number(value) || 0, currency);
}

function baseOptions({ currency = "AOA", height = 300 } = {}) {
  return {
    chart: {
      type: "area",
      height,
      width: "100%",
      fontFamily: "Inter, sans-serif",
      toolbar: { show: false },
      zoom: { enabled: false },
      parentHeightOffset: 0,
      animations: { enabled: true, easing: "easeinout", speed: 500 },
      // O gráfico ocupa 100% do cartão e redesenha quando o cartão muda de
      // largura (grelha, menu lateral, redimensionar a janela). É a própria
      // biblioteca que observa o contentor — não há largura fixa em lado nenhum.
      redrawOnParentResize: true,
    },
    colors: CHART_COLORS,
    dataLabels: { enabled: false },
    stroke: { curve: "smooth", width: 2.5 },
    legend: {
      show: true,
      position: "top",
      horizontalAlign: "left",
      fontFamily: "Inter, sans-serif",
      fontSize: "12px",
      fontWeight: 600,
      labels: { colors: "#64748b" },
      markers: { radius: 4, width: 10, height: 10 },
      itemMargin: { horizontal: 10, vertical: 2 },
    },
    grid: {
      borderColor: "#f1f5f9",
      strokeDashArray: 4,
      xaxis: { lines: { show: false } },
      padding: { left: 4, right: 8 },
    },
    tooltip: {
      theme: "light",
      style: { fontFamily: "Inter, sans-serif", fontSize: "12px" },
      y: { formatter: (val) => money(val, currency) },
    },
    noData: {
      text: "Sem dados para apresentar",
      align: "center",
      verticalAlign: "middle",
      style: { color: "#94a3b8", fontSize: "12px", fontFamily: "Inter, sans-serif" },
    },
  };
}

function axisLabelStyle() {
  return { style: { colors: "#94a3b8", fontSize: "11px", fontFamily: "Inter, sans-serif" } };
}

/**
 * Renderiza (ou substitui) um gráfico no elemento indicado.
 * Devolve a instância ou `null` se não foi possível desenhar.
 */
export async function mountChart(container, options) {
  const el = typeof container === "string" ? document.getElementById(container) : container;
  if (!el) return null;

  const ApexCharts = await loadApexCharts();

  // Liberta o gráfico anterior do mesmo elemento antes de desenhar o novo.
  const previous = instances.get(el);
  if (previous) {
    try {
      previous.destroy();
    } catch {
      /* ignore */
    }
    instances.delete(el);
  }
  el.innerHTML = "";
  // Marca o contentor: é por esta classe que `destroyCharts` encontra os
  // gráficos ao trocar de ecrã, mesmo que o cartão não venha de `chartCardHtml`.
  el.classList.add("finance-chart");

  const chart = new ApexCharts(el, options);
  await chart.render();
  instances.set(el, chart);
  return chart;
}

/** Remove todos os gráficos dentro de um contentor (ao trocar de ecrã/aba). */
export function destroyCharts(root = document) {
  root.querySelectorAll(".finance-chart").forEach((el) => {
    const chart = instances.get(el);
    if (chart) {
      try {
        chart.destroy();
      } catch {
        /* ignore */
      }
      instances.delete(el);
    }
  });
}

/** Mostra uma mensagem simples no lugar do gráfico quando não é possível desenhar. */
function showFallback(el, message) {
  el.innerHTML = `
    <div class="finance-chart-fallback">
      <span class="material-symbols-outlined">insights</span>
      <span>${message}</span>
    </div>`;
}

/**
 * Desenha um gráfico tratando de todos os erros: nunca rebenta o ecrã.
 * (`builder` recebe o elemento e devolve as opções do ApexCharts.)
 */
async function safeMount(id, buildOptions) {
  const el = typeof id === "string" ? document.getElementById(id) : id;
  if (!el) return null;
  try {
    const options = buildOptions(el);
    if (!options) {
      destroyElement(el);
      return null;
    }
    return await mountChart(el, options);
  } catch (err) {
    console.warn("Gráfico financeiro indisponível:", err);
    showFallback(el, "Não foi possível desenhar o gráfico.");
    return null;
  }
}

function destroyElement(el) {
  const chart = instances.get(el);
  if (chart) {
    try {
      chart.destroy();
    } catch {
      /* ignore */
    }
    instances.delete(el);
  }
  el.innerHTML = "";
}

/* ─── Tipos de gráfico ───────────────────────────────────────────────────── */

/**
 * Área/linhas — evolução mensal (faturado vs recebido vs custo).
 * `series`: [{ name, key, data: number[] }]
 */
export function drawAreaChart(id, { categories = [], series = [], currency = "AOA", height = 300 } = {}) {
  return safeMount(id, () => {
    if (!series.length || !categories.length) return null;
    return {
      ...baseOptions({ currency, height }),
      chart: { ...baseOptions({ currency, height }).chart, type: "area", stacked: false },
      series: series.map((s) => ({ name: s.name, data: s.data })),
      colors: series.map((s) => s.color || SERIES_TONES[s.key] || CHART_COLORS[0]),
      xaxis: { categories, axisBorder: { show: false }, axisTicks: { show: false }, labels: axisLabelStyle() },
      yaxis: {
        labels: { ...axisLabelStyle(), formatter: (val) => compactMoney(val) },
      },
      fill: {
        type: "gradient",
        gradient: { shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0.02, stops: [0, 90, 100] },
      },
      stroke: { curve: "smooth", width: 2.5 },
    };
  });
}

/**
 * Barras — comparações (por obra, por cliente, por fonte de custo).
 * `series`: [{ name, data: number[] }] e `horizontal: true` para barras deitadas.
 */
export function drawBarChart(
  id,
  { categories = [], series = [], currency = "AOA", height = 300, stacked = false, horizontal = false } = {}
) {
  return safeMount(id, () => {
    if (!series.length || !categories.length) return null;
    const axis = {
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { ...axisLabelStyle(), trim: true, maxHeight: 90 },
    };
    return {
      ...baseOptions({ currency, height }),
      chart: { ...baseOptions({ currency, height }).chart, type: "bar", stacked },
      series: series.map((s) => ({ name: s.name, data: s.data })),
      colors: series.map((s, index) => s.color || CHART_COLORS[index % CHART_COLORS.length]),
      plotOptions: {
        bar: {
          horizontal,
          borderRadius: 6,
          borderRadiusApplication: "end",
          columnWidth: stacked ? "60%" : "45%",
          barHeight: horizontal ? "60%" : undefined,
        },
      },
      xaxis: horizontal
        ? { type: "numeric", labels: { ...axisLabelStyle(), formatter: (val) => compactMoney(val) } }
        : axis,
      yaxis: horizontal
        ? { labels: { ...axisLabelStyle(), maxWidth: 160 } }
        : { labels: { ...axisLabelStyle(), formatter: (val) => compactMoney(val) } },
      fill: { opacity: 1 },
      stroke: { show: false },
      dataLabels: { enabled: false },
      grid: {
        ...baseOptions({ currency, height }).grid,
        yaxis: horizontal ? { lines: { show: false } } : undefined,
        xaxis: horizontal ? { lines: { show: true } } : { lines: { show: false } },
      },
    };
  });
}

/** Anel (donut) — composição de um total (aging, fontes de custo, estados). */
export function drawDonutChart(
  id,
  { labels = [], series = [], colors = CHART_COLORS, currency = "AOA", height = 280, totalLabel = "Total" } = {}
) {
  return safeMount(id, () => {
    const values = series.map((v) => Number(v) || 0);
    if (!labels.length || !values.some((v) => v > 0)) return null;
    const total = values.reduce((a, b) => a + b, 0);
    return {
      ...baseOptions({ currency, height }),
      chart: { ...baseOptions({ currency, height }).chart, type: "donut", height },
      series: values,
      labels,
      colors,
      stroke: { width: 2, colors: ["#fff"] },
      legend: {
        show: true,
        position: "bottom",
        horizontalAlign: "center",
        fontFamily: "Inter, sans-serif",
        fontSize: "12px",
        fontWeight: 600,
        labels: { colors: "#64748b" },
        markers: { radius: 4, width: 10, height: 10 },
      },
      plotOptions: {
        pie: {
          donut: {
            size: "72%",
            labels: {
              show: true,
              name: { show: true, fontSize: "11px", fontFamily: "Inter, sans-serif", color: "#94a3b8" },
              value: {
                show: true,
                fontSize: "16px",
                fontFamily: "Outfit, sans-serif",
                fontWeight: 800,
                color: "#0f172a",
                formatter: (val) => compactMoney(val),
              },
              total: {
                show: true,
                showAlways: true,
                label: totalLabel,
                fontSize: "11px",
                fontFamily: "Inter, sans-serif",
                color: "#94a3b8",
                formatter: () => compactMoney(total),
              },
            },
          },
        },
      },
      tooltip: {
        ...baseOptions({ currency, height }).tooltip,
        y: { formatter: (val) => money(val, currency) },
      },
    };
  });
}

/** Anel de progresso (radial) — % executada de uma obra. */
export function drawRadialChart(id, { value = 0, label = "", color = TONES.blue, height = 240 } = {}) {
  return safeMount(id, () => {
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    return {
      ...baseOptions({ height }),
      chart: { ...baseOptions({ height }).chart, type: "radialBar", height },
      series: [Number(pct.toFixed(1))],
      labels: [label],
      colors: [color],
      plotOptions: {
        radialBar: {
          hollow: { size: "62%", background: "#f8fafc" },
          track: { background: "#f1f5f9", strokeWidth: "100%" },
          dataLabels: {
            name: { show: true, fontSize: "11px", fontFamily: "Inter, sans-serif", color: "#94a3b8", offsetY: 22 },
            value: {
              show: true,
              fontSize: "26px",
              fontFamily: "Outfit, sans-serif",
              fontWeight: 800,
              color: "#0f172a",
              offsetY: -14,
              formatter: (val) => `${Number(val).toFixed(1)}%`,
            },
          },
        },
      },
      legend: { show: false },
      tooltip: { enabled: false },
      fill: { type: "solid" },
      stroke: { lineCap: "round" },
    };
  });
}

/** Cartão de gráfico com título, subtítulo, ações opcionais e legenda de rodapé. */
export function chartCardHtml({ id, title, subtitle = "", hint = "", span = 1, height = 300, actionsHtml = "" }) {
  const cols = [1, 2, 3].includes(span) ? ` finance-chart-card--span-${span}` : "";
  return `
    <section class="finance-card finance-chart-card${cols}">
      <header class="finance-chart-head${actionsHtml ? " finance-chart-head--row" : ""}">
        <div>
          <h2 class="finance-chart-title">${title}</h2>
          ${subtitle ? `<p class="finance-chart-subtitle">${subtitle}</p>` : ""}
        </div>
        ${actionsHtml || ""}
      </header>
      <div id="${id}" class="finance-chart" style="min-height:${height}px"></div>
      ${hint ? `<p class="finance-chart-hint">${hint}</p>` : ""}
    </section>`;
}
