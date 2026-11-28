/**
 * Formulários da Frota e da Oficina num painel lateral à direita, como no
 * protótipo (`fxOpen` → `#drawerHost`). Usa o painel lateral que a app já tem
 * (`openDrawer`, o mesmo da gestão de utilizadores), com uma só secção que
 * corre de cima a baixo — as secções do formulário ficam dentro dela.
 */

import { openDrawer } from "/Users/drawer.js";

/**
 * Mesma assinatura do `openModal` usado antes, para os formulários não mudarem:
 *   onRender({ panel, close }) · onPrimary({ panel, close }) · onDanger({ panel, close })
 * Sem `primaryLabel` o painel é só de consulta (um botão «Fechar»).
 */
export function abrirPainel({ title, subtitle = "", contentHtml, primaryLabel = "", secondaryLabel = "Cancelar", dangerLabel = "", onRender, onPrimary, onDanger, width = 760 }) {
  return openDrawer({
    title,
    subtitle,
    width,
    sections: [{ id: "f", label: "", html: `<div class="fr-painel">${contentHtml}</div>` }],
    primaryLabel: primaryLabel || "Fechar",
    cancelLabel: primaryLabel ? secondaryLabel : "Cancelar",
    dangerLabel,
    onPrimary: async ({ panel, close }) => {
      if (!primaryLabel) return close(true);
      await onPrimary?.({ panel, close: () => close(true) });
    },
    onDanger: onDanger ? async ({ panel, close }) => onDanger({ panel, close: () => close(true) }) : undefined,
    onRender: (api) => {
      if (!primaryLabel) api.panel.querySelector("[data-drawer-cancel]")?.remove();
      onRender?.({ panel: api.panel, close: () => api.close(true) });
    },
  });
}
