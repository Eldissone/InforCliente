// Cola isto na consola do browser (F12 → Console) e depois clica no FAB
(function diagnose() {
  const fab = document.getElementById('globalChatFab');
  const panel = document.getElementById('globalChatPanel');

  console.group('🔍 Chat FAB Diagnóstico');
  console.log('FAB existe:', !!fab);
  console.log('Panel existe:', !!panel);

  if (fab) {
    const rect = fab.getBoundingClientRect();
    const style = window.getComputedStyle(fab);
    console.log('FAB posição:', rect);
    console.log('FAB display:', style.display);
    console.log('FAB visibility:', style.visibility);
    console.log('FAB pointer-events:', style.pointerEvents);
    console.log('FAB z-index:', style.zIndex);

    // Verificar elemento por cima do FAB no centro
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    console.log('Elemento por cima do FAB:', topEl);
    console.log('É o próprio FAB?', topEl === fab || fab.contains(topEl));
  }

  if (panel) {
    const style = window.getComputedStyle(panel);
    console.log('Panel classes:', panel.className);
    console.log('Panel opacity:', style.opacity);
    console.log('Panel pointer-events:', style.pointerEvents);
  }

  // Verificar overlays no DOM
  const overlays = [...document.querySelectorAll('[class*="fixed inset"], [class*="z-[9"]')];
  console.log('Possíveis overlays:', overlays.map(el => ({ tag: el.tagName, id: el.id, class: el.className.substring(0, 80) })));

  console.groupEnd();
})();
