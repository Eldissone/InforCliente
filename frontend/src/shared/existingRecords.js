function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

export function existingListHtml({ title, columns, rows, empty, error, loading, actions = null }) {
  // `actions`: HTML por linha (mesma ordem de `rows`) para uma última coluna de acções.
  const hasActions = Array.isArray(actions) && actions.some(Boolean);
  const colCount = columns.length + (hasActions ? 1 : 0);
  const head = columns.map((column) => `<th>${esc(column)}</th>`).join("") + (hasActions ? `<th class="reg-existing-actions-h"><span class="sr-only">Acções</span></th>` : "");
  const body = error
    ? `<tr><td class="reg-existing-empty" colspan="${colCount}">${esc(error)}</td></tr>`
    : rows.length
      ? rows.map((cells, i) => `<tr>${cells.map((cell) => {
        const text = String(cell ?? "").trim();
        return `<td>${esc(text || "—")}</td>`;
      }).join("")}${hasActions ? `<td class="reg-existing-actions">${actions[i] || ""}</td>` : ""}</tr>`).join("")
      : `<tr><td class="reg-existing-empty" colspan="${colCount}">${esc(loading ? "A carregar..." : (empty || "Ainda não há registos."))}</td></tr>`;
  const count = loading || error
    ? ""
    : `<span>${rows.length} ${rows.length === 1 ? "registo" : "registos"}</span>`;
  return `<section class="reg-existing" data-existing-list aria-label="${esc(title)}">
    <div class="reg-existing-head"><h2>${esc(title)}</h2>${count}</div>
    <div class="reg-existing-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
  </section>`;
}
