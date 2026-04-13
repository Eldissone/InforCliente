import { apiRequest } from "../../services/api.js";
import { wireLogout } from "../../shared/session.js";
import { formatCurrencyKZ, formatPercent } from "../../shared/format.js";
import { toast, initMobileMenu } from "../../shared/ui.js";

let dashboardData = null;
let charts = {
  finances: null,
  stock: null,
  progress: null
};

async function loadDashboardData() {
  try {
    dashboardData = await apiRequest("/dashboard/client-summary");
    renderDashboard("all");
    populateProjectFilter();
  } catch (err) {
    toast("Não foi possível carregar os dados do dashboard.", { type: "error" });
    console.error(err);
  }
}

function renderDashboard(projectId) {
  const data = projectId === "all" 
    ? dashboardData 
    : filterDataByProject(projectId);

  updateMetrics(data);
  renderFinancialChart(data.projects);
  renderStockChart(data.stock);
  renderProgressGauge(data.overallProgress);
}

function filterDataByProject(pid) {
  const p = dashboardData.projects.find(x => x.id === pid);
  if (!p) return dashboardData;

  // For stock, we'd ideally filter by project too. 
  // Our backend returns stock summary already, but for 'all'.
  // We'll just show the same stock for now or re-fetch if needed.
  // Given the current backend implementation, dashboardData.stock is for ALL projects.
  return {
    financials: {
      totalContract: p.budget,
      totalPaid: p.paid,
      totalDebt: p.debt
    },
    overallProgress: p.progress,
    projects: [p],
    stock: dashboardData.stock // Simplification for now
  };
}

function updateMetrics(data) {
  const { financials, overallProgress } = data;
  
  document.getElementById("metricTotalContract").textContent = formatCurrencyKZ(financials.totalContract);
  document.getElementById("metricTotalPaid").textContent = formatCurrencyKZ(financials.totalPaid);
  document.getElementById("metricDebt").textContent = formatCurrencyKZ(financials.totalDebt);
  document.getElementById("metricProgress").textContent = `${overallProgress}%`;
  
  const progLine = document.getElementById("progressLine");
  if (progLine) progLine.style.width = `${overallProgress}%`;

  const percentPaid = document.getElementById("percentPaid");
  if (percentPaid && financials.totalContract > 0) {
    const pct = (financials.totalPaid / financials.totalContract) * 100;
    percentPaid.textContent = `${pct.toFixed(1)}%`;
  }
}

function renderFinancialChart(projects) {
  const options = {
    series: [
      { name: 'Total Contrato', data: projects.map(p => p.budget) },
      { name: 'Total Pago', data: projects.map(p => p.paid) }
    ],
    chart: { type: 'bar', height: 350, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
    colors: ['#0F172A', '#2afc8d'],
    plotOptions: { bar: { horizontal: false, columnWidth: '55%', borderRadius: 8 } },
    dataLabels: { enabled: false },
    stroke: { show: true, width: 2, colors: ['transparent'] },
    xaxis: { categories: projects.map(p => p.name) },
    yaxis: { title: { text: 'Valores (kz)' }, labels: { formatter: (val) => val.toLocaleString() } },
    fill: { opacity: 1 },
    tooltip: { y: { formatter: (val) => formatCurrencyKZ(val) } },
    legend: { position: 'top', fontWeight: 700 }
  };

  if (charts.finances) charts.finances.destroy();
  charts.finances = new ApexCharts(document.querySelector("#financialChart"), options);
  charts.finances.render();
}

function renderStockChart(stock) {
  const container = document.querySelector("#stockChart");
  if (!stock || stock.length === 0) {
    container.innerHTML = `<div class="text-center"><p class="text-xs text-slate-400 font-bold uppercase tracking-widest">Sem Material em Armazém</p></div>`;
    return;
  }
  container.innerHTML = ""; // Clear loader if any

  const options = {
    series: stock.map(s => s.qty),
    labels: stock.map(s => `${s.name} (${s.unit})`),
    chart: { type: 'donut', height: 350, fontFamily: 'Inter, sans-serif' },
    colors: ['#0F172A', '#1E293B', '#334155', '#475569', '#2afc8d', '#10b981'],
    legend: { position: 'bottom', fontWeight: 600 },
    stroke: { width: 0 },
    plotOptions: {
      pie: {
        donut: {
          size: '75%',
          labels: {
            show: true,
            total: {
              show: true,
              label: 'Total Itens',
              formatter: () => stock.reduce((acc, s) => acc + s.qty, 0)
            }
          }
        }
      }
    },
    dataLabels: { enabled: false }
  };

  if (charts.stock) charts.stock.destroy();
  charts.stock = new ApexCharts(container, options);
  charts.stock.render();
}

function renderProgressGauge(progress) {
  const options = {
    series: [progress],
    chart: { height: 350, type: 'radialBar', fontFamily: 'Inter, sans-serif' },
    plotOptions: {
      radialBar: {
        startAngle: -135,
        endAngle: 135,
        hollow: { size: '70%', },
        track: { background: '#f1f5f9', strokeWidth: '97%', margin: 5, },
        dataLabels: {
          name: { show: true, color: '#64748b', fontSize: '12px', fontWeight: 800, offsetY: 20 },
          value: { offsetY: -20, fontSize: '40px', fontWeight: 900, color: '#0F172A', formatter: (val) => `${val}%` }
        }
      }
    },
    fill: {
      type: 'gradient',
      gradient: {
        shade: 'dark',
        type: 'horizontal',
        shadeIntensity: 0.5,
        gradientToColors: ['#2afc8d'],
        inverseColors: true,
        opacityFrom: 1,
        opacityTo: 1,
        stops: [0, 100]
      }
    },
    stroke: { lineCap: 'round' },
    labels: ['Execução Geral'],
  };

  if (charts.progress) charts.progress.destroy();
  charts.progress = new ApexCharts(document.querySelector("#progressGauge"), options);
  charts.progress.render();
}

function populateProjectFilter() {
  const select = document.getElementById("projectFilter");
  if (!select || !dashboardData) return;

  dashboardData.projects.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });

  select.addEventListener("change", (e) => {
    renderDashboard(e.target.value);
  });
}

function init() {
  initMobileMenu();
  wireLogout();
  
  // Set client name in header from session if available
  const user = JSON.parse(localStorage.getItem("inforcliente.user") || "{}");
  if (user && user.client) {
     const headerName = document.getElementById("clientNameHeader");
     if (headerName) headerName.textContent = user.client.name;
  }

  loadDashboardData();
}

document.addEventListener("DOMContentLoaded", init);
