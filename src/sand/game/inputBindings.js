// Browser input for the sand runtime: the window-level pointer/keyboard/wheel
// listeners and the pointer-state forwarding. JS only normalizes DOM events;
// the engine owns the aim mapping and all tool/input policy.
//
// All mutable runtime state lives on the shared `ctx` object owned by
// createSandGame.js. attach()/detach() bind and unbind every listener.

import { BUTTON_BITS, KEY_CODES, TEXT_INPUT_TYPES } from './runtimeConfig';

export function createInputBindings(ctx, { refreshBounds, zoomBy, resetZoom, onToggleInventory, onToggleFootprintMenu }) {
  const hadTabIndex = ctx.container.hasAttribute('tabindex');
  const originalTabIndex = ctx.container.getAttribute('tabindex');
  // Button state is edge-owned: pointerdown sets bits, pointerup clears them,
  // and pointermove may only add bits. Some devices transiently report
  // `buttons === 0` during a held drag, which must not finalize a draft.

  // Forward only when something actually changed (the loop calls this every
  // frame): the engine stores the pointer and derives the aim cell on demand,
  // so identical state doesn't need an FFI call. A recreated engine (resize)
  // starts with pointer state unset, hence the sentEngine check.
  let sentPX = NaN, sentPY = NaN, sentButtons = -1, sentInside = null, sentEngine = null;
  const logicalButton = (e) => e.pointerType === 'touch' && e.button === 0 ? ctx.touchButton : e.button;
  const logicalButtons = (e) => {
    if (e.pointerType !== 'touch' || ctx.touchButton !== 2 || !(e.buttons & 1)) return e.buttons;
    return (e.buttons & ~1) | BUTTON_BITS[2];
  };
  const isSurfaceEvent = (e) => {
    const path = e.composedPath?.();
    if (path?.some((node) => node !== ctx.container &&
      (node.isContentEditable || ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)))) return false;
    const b = ctx.wrapBounds;
    return (path?.includes(ctx.container) || ctx.container.contains(e.target) ||
      (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom));
  };
  const ownsKeyboard = () => {
    const root = ctx.container.getRootNode?.();
    return root?.activeElement === ctx.container || document.activeElement === ctx.container;
  };
  const updatePointer = (cx, cy) => {
    ctx.clientX = cx;
    ctx.clientY = cy;
    const b = ctx.wrapBounds;
    ctx.inside = cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
    ctx.px = cx - b.left;
    ctx.py = cy - b.top;
    const e = ctx.engine;
    if (!e) return;
    if (e === sentEngine && ctx.px === sentPX && ctx.py === sentPY && ctx.mouseButtons === sentButtons && ctx.inside === sentInside) return;
    e.inputPointer(ctx.px, ctx.py, ctx.mouseButtons, ctx.inside);
    sentEngine = e; sentPX = ctx.px; sentPY = ctx.py; sentButtons = ctx.mouseButtons; sentInside = ctx.inside;
  };

  const onPointerMove = (e) => {
    // Only ADD buttons a move reports as newly pressed; a held button is
    // released solely by pointerup/pointercancel/blur (see above).
    ctx.mouseButtons |= logicalButtons(e);
    updatePointer(e.clientX, e.clientY);
    if (ctx.playMode) { if (ctx.engine) ctx.previewDirty = true; return; } // re-present so the aim cursor follows
    if (!ctx.drawModeOn || !ctx.engine) return;
    if (ctx.worldWorker) return; // worker owns creative draft/tool state
    if (ctx.inside && ctx.engine.pointerDraftAtAim()) ctx.previewDirty = true;
  };
  const onTouchMove = (e) => {
    if (!ctx.drawModeOn || !ctx.engine) return;
    // Palette/HUD touches also bubble to window through the shadow root. Only
    // cancel a gesture that actually began on the simulation surface; otherwise
    // native overflow scrolling inside the mobile material list is disabled.
    const path = e.composedPath?.();
    if (path && !path.includes(ctx.container)) return;
    if (!e.touches || e.touches.length === 0) return;
    const t = e.touches[0];
    updatePointer(t.clientX, t.clientY);
    // `overflow: hidden` alone is not a reliable gesture cancel on mobile
    // Chrome (an already-recognized pan can keep moving the page). The
    // non-passive listener plus the simulation's touch-action:none makes a
    // Draw On drag exclusively simulation input.
    if (ctx.inside && e.cancelable) e.preventDefault();
    if (ctx.worldWorker) return;
    if (ctx.inside && ctx.engine.pointerDraftAtAim()) ctx.previewDirty = true;
  };

  // LMB starts drafts / spawns the cube; RMB arms the momentary eraser. Paint
  // and erase tools act continuously in the step loop (engine.applyLocalInput).
  const onPointerDown = (e) => {
    if (!ctx.engine) return;
    // Survival aims/builds with the mouse regardless of the Draw toggle;
    // creative requires draw mode (so the page stays scrollable until the user
    // opts in).
    if (!ctx.playMode && !ctx.drawModeOn) return;
    // The embed lives alongside ordinary page content, so keyboard shortcuts
    // belong to it only after the simulation surface is explicitly focused.
    // Pointer focus uses preventScroll so activating the game never jumps the
    // surrounding page; keyboard users can reach the same surface with Tab.
    if (isSurfaceEvent(e)) ctx.container.focus({ preventScroll: true });
    // Authoritative press edge: latch this button's bit (plus any other buttons
    // the event reports already down). The latch is what keeps PI_PRIMARY held
    // across steps even if later moves momentarily report buttons==0.
    const button = logicalButton(e);
    ctx.mouseButtons |= logicalButtons(e) | (BUTTON_BITS[button] || 0);
    updatePointer(e.clientX, e.clientY);
    if (!ctx.inside) return;
    if (button === 0 || button === 2) {
      if (ctx.playMode) { ctx.previewDirty = true; e.preventDefault(); return; } // player builds/mines via input bits
      if (ctx.worldWorker) { ctx.worldWorker.edge('down', button); e.preventDefault(); return; }
      if (ctx.engine.pointerDownAtAim(button)) ctx.previewDirty = true;
      e.preventDefault();
    }
  };

  const onPointerUp = (e) => {
    if (!ctx.engine) return;
    // Authoritative release edge: drop only the released button's bit. Other
    // buttons stay latched until their own pointerup (or blur/cancel).
    const button = logicalButton(e);
    ctx.mouseButtons &= ~(BUTTON_BITS[button] || 0);
    updatePointer(e.clientX, e.clientY);
    if (!ctx.playMode && ctx.worldWorker && (button === 0 || button === 2)) {
      ctx.worldWorker.edge('up', button);
      e.preventDefault();
      return;
    }
    ctx.engine.pointerButtons(ctx.mouseButtons); // clears RMB/LMB when no buttons remain
    if (ctx.engine.pointerUp(button)) ctx.previewDirty = true;
  };

  const onContextMenu = (e) => {
    if ((ctx.drawModeOn || ctx.playMode) && ctx.inside) e.preventDefault(); // RMB places in bg; no menu
  };

  const onScroll = () => {
    refreshBounds();
    if (ctx.clientX >= 0 && ctx.clientY >= 0) updatePointer(ctx.clientX, ctx.clientY);
  };

  // Only TEXT-entry controls should swallow the WASD/arrow keys. A checkbox or
  // button keeps focus after a click, so treating every <input> as editable
  // would silently disable camera panning.
  const isEditableTarget = (t) => {
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((t.type || 'text').toLowerCase());
    return false;
  };
  const isEditableEvent = (e) => {
    if (isEditableTarget(e.target)) return true;
    return !!e.composedPath?.().some(isEditableTarget);
  };

  // Movement keys (WASD/arrows + space/shift) are forwarded to the engine,
  // which owns the pan/player-input policy. The editable-target guard +
  // preventDefault stay in JS (they need the DOM event/target).
  const onKeyDown = (e) => {
    if (!ownsKeyboard()) return;
    if (isEditableEvent(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    const key = e.key.toLowerCase();
    // Zoom (desktop): +/= zoom in, -/_ zoom out, 0 reset. The authority owns
    // any loaded-window resize (local worker or multiplayer server). Handled
    // before movement/hotbar keys ('0' is unused there).
    if (key === '+' || key === '=') { zoomBy(1); e.preventDefault(); return; }
    if (key === '-' || key === '_') { zoomBy(-1); e.preventDefault(); return; }
    if (key === '0') { resetZoom(); e.preventDefault(); return; }
    // Survival inventory hotkeys (engine owns the selection policy): digits 1-9
    // pick a hotbar slot; E toggles the grid. Handled before the movement-key map.
    if (ctx.survival && ctx.engine && (ctx.localPlayerId || ctx.netClientReady())) {
      if (key >= '1' && key <= '9') {
        const slot = +key - 1;
        if (ctx.netClientReady()) ctx.net.sendSelect(slot);
        else ctx.worldWorker?.intent('select', { slot });
        e.preventDefault();
        return;
      }
      if (key === 'e') { onToggleInventory?.(); e.preventDefault(); return; }
      if (key === 'q') { onToggleFootprintMenu?.(); e.preventDefault(); return; }
    }
    const code = KEY_CODES[key];
    if (code === undefined) return;
    ctx.engine?.inputKey(code, 1);
    if (key !== 'shift') e.preventDefault(); // arrows/space/wasd would scroll the page
  };
  const onKeyUp = (e) => {
    const code = KEY_CODES[e.key.toLowerCase()];
    if (code !== undefined) ctx.engine?.inputKey(code, 0);
  };
  const onBlur = () => {
    ctx.engine?.inputClearKeys();  // avoid keys "sticking" on focus loss
    ctx.stickX = ctx.stickY = 0;
    ctx.engine?.inputStick(0, 0);
    ctx.mouseButtons = 0;          // and avoid a button "sticking" if focus is lost mid-press
    ctx.engine?.pointerButtons(0);
    updatePointer(ctx.clientX, ctx.clientY); // push the cleared state so PI_PRIMARY drops -> draft finalizes
  };
  // Pointer capture can be revoked (e.g. an OS gesture); treat it as a release
  // so a held button can never get stranded latched.
  const onPointerCancel = (e) => {
    const button = logicalButton(e);
    ctx.mouseButtons &= ~(BUTTON_BITS[button] || 0);
    if (e.button < 0) ctx.mouseButtons = 0; // pointercancel has no button -> clear all
    updatePointer(e.clientX, e.clientY);
    ctx.engine?.pointerButtons(ctx.mouseButtons);
  };

  // Survival: scroll cycles the selected hotbar slot (wrap-around policy is in C++).
  const onWheel = (e) => {
    if (!ctx.survival || !ctx.engine || !ctx.inside || isEditableEvent(e)) return;
    if (ctx.netClientReady()) {
      const inv = ctx.net.getOwnInventory();
      if (!inv) return;
      ctx.net.sendSelect((inv.selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9); // hotbar is slots 0-8
      e.preventDefault();
      return;
    }
    const inv = ctx.worldWorker?.getInventory();
    if (!inv) return;
    ctx.worldWorker.intent('select', { slot: (inv.selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9 });
    e.preventDefault();
  };

  const attach = () => {
    if (!hadTabIndex) ctx.container.tabIndex = 0;
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    if (ctx.survival) window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  };
  const detach = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    if (!hadTabIndex) ctx.container.removeAttribute('tabindex');
    else ctx.container.setAttribute('tabindex', originalTabIndex);
  };

  return { attach, detach, updatePointer };
}
