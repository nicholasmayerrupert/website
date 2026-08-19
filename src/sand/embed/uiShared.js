// Tiny helpers shared by the framework-free embed widgets (palette, inventory
// HUD, footprint menu, connect panel).

// Stop overlay presses from bubbling to the window-level game input (which
// would start a sim click through a panel). Release listeners in
// inputBindings.js run in the capture phase so a paint/WASD gesture that
// ends on a widget still unlatches even when these handlers stopPropagation.
export const SWALLOW_POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu', 'wheel'];
export function swallowEvents(el, events = SWALLOW_POINTER_EVENTS) {
  for (const ev of events) el.addEventListener(ev, (e) => e.stopPropagation());
}

// packed ABGR material color (0xAABBGGRR, R low byte) -> css rgb(...) so a
// swatch matches the in-world pixel exactly.
export function packedToRgb(c) {
  return `rgb(${c & 0xff},${(c >> 8) & 0xff},${(c >> 16) & 0xff})`;
}

// Inject a widget's <style> once per shadow root (guarded by a data attribute,
// so a remount can't stack duplicates).
export function injectStyleOnce(root, dataAttr, css) {
  if (root.querySelector(`style[${dataAttr}]`)) return;
  const s = document.createElement('style');
  s.setAttribute(dataAttr, '');
  s.textContent = css;
  root.appendChild(s);
}
