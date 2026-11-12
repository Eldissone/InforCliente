// Destino do link "Planeamento" da navegação: o orçamento/planeamento da última obra aberta,
// ou a listagem de obras quando ainda não há nenhuma.
export function planeamentoHref() {
  try {
    const id = localStorage.getItem("InfoCliente.currentProjectId");
    if (id) return `/Projectos/projectView?id=${encodeURIComponent(id)}&tab=orcamento_custo`;
  } catch { /* ignore */ }
  return "/Projectos/ProjectGeral";
}
