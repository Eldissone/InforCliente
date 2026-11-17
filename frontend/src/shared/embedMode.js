export function isEmbeddedView() {
  try {
    if (new URLSearchParams(window.location.search).get("embed") === "1") return true;
  } catch {
    /* ignore */
  }
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function applyEmbedMode() {
  if (!isEmbeddedView()) return false;
  document.documentElement.classList.add("is-embed");
  if (document.body) document.body.classList.add("is-embed");
  return true;
}

applyEmbedMode();
