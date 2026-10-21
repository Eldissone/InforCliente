function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

export function existingListHtml({ title, columns, rows, empty, error, loading }) {
  const head = columns.map((column) => `<th>${esc(column)}</th>`).join("");
  const body = error
    ? `<tr><td class="reg-existing-empty" colspan="${columns.length}">${esc(error)}</td></tr>`
    : rows.length
      ? rows.map((cells) => `<tr>${cells.map((cell) => {
        const text = String(cell ?? "").trim();
        return `<td>${esc(text || "—")}</td>`;
      }).join("")}</tr>`).join("")
      : `<tr><td class="reg-existing-empty" colspan="${columns.length}">${esc(loading ? "A carregar..." : (empty || "Ainda não há registos."))}</td></tr>`;
  const count = loading || error
    ? ""
    : `<span>${rows.length} ${rows.length === 1 ? "registo" : "registos"}</span>`;
  return `<section class="reg-existing" data-existing-list aria-label="${esc(title)}">
    <div class="reg-existing-head"><h2>${esc(title)}</h2>${count}</div>
    <div class="reg-existing-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
  </section>`;
}
