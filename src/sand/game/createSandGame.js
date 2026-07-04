// Framework-agnostic falling-sand game runtime.
//
// `createSandGame(container, opts)` boots the whole interactive simulation into
// a host element using nothing but the DOM — no React. It owns its canvases,
// the render pipeline, all input, the RAF loop, world streaming, and the
// engine wiring, and returns a small handle to drive it from the outside:
//
//   const game = createSandGame(el, { initialTool: 'sand' });
//   game.setTool('water');
//   game.setDrawMode(true);
//   game.destroy();
//
// The React component in ../react/SandGame.jsx is a thin wrapper over this. The
// simulation runs in the WebAssembly engine (../wasmBridge/engineFactory.js); initSandWasm()
// must have resolved before createSandGame() is called.

import { createEngineWasm } from '../wasmBridge/engineFactory.js';
import { createGameNet } from '../net/gameNet';
import { ITEM_FIELDS } from '../net/protocol.js';
import { createParallaxBackground } from './parallaxBackground';
import {
  BUTTON_BITS,
  DEFAULT_TOOL,
  KEY_CODES,
  SIZING,
  STEP_MS,
  TEXT_INPUT_TYPES,
  TOOL_IDS,
} from './runtimeConfig';
import { chooseStableCssSize, computeViewportSizing } from './viewportSizing';

export function createSandGame(container, opts = {}) {
  const {
    initialTool = DEFAULT_TOOL,
    onLayoutChange,
    reducedMotion,
    // 'survival' (default): a player character with reach/cooldown-restricted
    // tools, camera follows. 'creative': free camera (WASD pans the infinite
    // world), draw tools place/erase anywhere with no reach limit, no character.
    mode = 'survival',
    // Survival inventory hooks: onInventory(snapshot) feeds the HUD each step;
    // onToggleInventory() opens/closes the grid (the E key). The inventory itself is
    // authoritative in the engine — these only move snapshots out and intents in.
    onInventory = null,
    onToggleInventory = null,
    onToggleFootprintMenu = null,
  } = opts;
  const survival = mode === 'survival';

  // --- Host canvas (created and owned here). The WASM engine owns a WebGL2
  // context on it and composites the cell texture, gutter grid, player overlay,
  // and draft preview directly (engine.glRenderFrame). JS no longer touches
  // pixels — it only sizes the canvas, drives the camera, and forwards input. ---
  const parallax = createParallaxBackground(container);

  const canvas = document.createElement('canvas');
  canvas.id = 'sand-main'; // stable selector for the headless pan/flicker bench
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.zIndex = '1';
  canvas.style.pointerEvents = 'none';
  canvas.style.userSelect = 'none';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  const mineProgress = document.createElement('div');
  mineProgress.style.position = 'absolute';
  mineProgress.style.width = '5px';
  mineProgress.style.height = '42px';
  mineProgress.style.border = '1px solid rgba(255,255,255,.55)';
  mineProgress.style.borderRadius = '999px';
  mineProgress.style.background = 'rgba(3,7,18,.58)';
  mineProgress.style.boxShadow = '0 6px 14px rgba(0,0,0,.35)';
  mineProgress.style.pointerEvents = 'none';
  mineProgress.style.zIndex = '69';
  mineProgress.style.overflow = 'hidden';
  mineProgress.style.display = 'none';
  const mineProgressFill = document.createElement('div');
  mineProgressFill.style.position = 'absolute';
  mineProgressFill.style.left = '0';
  mineProgressFill.style.right = '0';
  mineProgressFill.style.bottom = '0';
  mineProgressFill.style.height = '0%';
  mineProgressFill.style.background = '#f8fafc';
  mineProgressFill.style.boxShadow = '0 0 8px rgba(248,250,252,.85)';
  mineProgress.appendChild(mineProgressFill);
  container.appendChild(mineProgress);

  // Tool selection: the name is kept here only so it can be re-sent to the engine
  // when the engine is recreated (resize). All tool policy lives in C++.
  let currentToolName = initialTool;
  let drawModeOn = false;

  // Player mode (survival): WASD/arrows drive the local character and the camera
  // follows it. Free-camera mode (creative; also the pan/flicker bench) pans the
  // buffer with WASD/arrows. The local player is simulated in the engine; JS only
  // forwards input. Survival starts in play mode; creative starts in free-cam.
  let playMode = survival;
  let localPlayerId = 0;
  let inputSeq = 0;
  let lastInvHash = -1; // last pushed offline-inventory hash (HUD dirty check)
  let net = null; // multiplayer glue (created lazily on host/join)
  const netClientReady = () => !!net && net.role === 'client' && net.connected && net.worldReady;

  // One seed per mount so resizing regenerates the *same* infinite world.
  const worldSeed = (Math.random() * 4294967296) >>> 0;

  // Browser-side tunables live in runtimeConfig.js. Brush radii, emit throttle,
  // cube extent, camera behavior, input bitmask, tool policy, and terrain all
  // live in the C++ engine.
  // The camera (pan speed, follow, bounds), the world-stream edge margin, the
  // pointer->aim mapping, the player input bitmask, and the preview/overlay
  // colors all live in the C++ engine now (cpp/engine/camera.inc + gl.inc).
  // JS forwards raw events and drives the RAF/fixed-step loop.

  // Simulation engine (recreated on resize)
  // cols/rows are the BUFFER (world) dimensions, larger than the viewport;
  // viewCols/viewRows are the visible cell window the camera shows.
  let engine = null;
  let cols = 0, rows = 0, cellSize = SIZING.cellPx;
  // cellSize is CSS px per cell (drives the cell budget, appearance, and pointer
  // math). cellDev is the integer DEVICE px per cell used for all canvas drawing.
  // Sizing the backing store to device px and snapping the pan offset to whole
  // device px keeps cell edges + the 1px gutter grid on exact device pixels, so
  // the compositor never resamples them — that resampling (at browser zoom < 100%,
  // where devicePixelRatio drops below 1) is what caused the bright-block flicker.
  let dpr = 1, cellDev = SIZING.cellPx;
  let viewCols = 0, viewRows = 0;
  let stableCssSize = null;
  // Runtime zoom: an index into SIZING.zoomSteps (a multiplier on the base cell
  // size). Only the visible window scales with zoom — the sim buffer is sized for
  // the most-zoomed-out step (SIZING.zoomSteps[0]) and stays constant, so changing
  // zoom keeps the same world/player and takes fit()'s no-rebuild fast path.
  let zoomIndex = SIZING.zoomDefaultIndex;
  const zoomFactor = () => SIZING.zoomSteps[zoomIndex];
  const minZoomFactor = () => SIZING.zoomSteps[0];
  // In-game zoom relative to the default step — drives the parallax backdrop scale
  // so it grows/pans in lockstep with the sim (1 = default).
  const bgZoomScale = () => zoomFactor() / SIZING.zoomSteps[SIZING.zoomDefaultIndex];
  // devicePixelRatio at load. Browser page zoom later changes dpr (and the CSS box)
  // together; we treat this as the "100%" baseline so the sim can ignore page zoom.
  const baselineDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  // The camera lives in the engine (camera.inc). JS caches the last presented
  // position to detect movement (incl. sub-cell) and re-present.
  let lastCamX = NaN, lastCamY = NaN;
  let testPaused = false;             // DEV-only: freeze stepping for the flicker bench
  let gutterOn = true;                // DEV-only: toggle the grid for flicker A/B
  let snapOff = false;                // DEV-only: disable offset snapping for A/B
  let wrapBounds = { left: 0, right: 0, top: 0, bottom: 0 };
  let forceFullRender = true;
  let perfRenderMs = 0;
  let previewDirty = false;           // force a present so a fresh draft overlay shows

  // Rolling perf samples for window.__sandPerf / perfStats()
  const PERF_SAMPLES = 120;
  const perfStepSamples = new Float32Array(PERF_SAMPLES);
  const perfRenderSamples = new Float32Array(PERF_SAMPLES);
  let perfSampleIdx = 0;
  let perfSampleCount = 0;
  // avg + p95 of the sampled step+render frame cost (shared by both perf surfaces).
  const perfFrameSummary = () => {
    const n = perfSampleCount;
    if (!n) return { avg: 0, p95: 0, samples: 0 };
    const sums = [];
    for (let i = 0; i < n; i++) sums.push(perfStepSamples[i] + perfRenderSamples[i]);
    sums.sort((a, b) => a - b);
    return {
      avg: sums.reduce((a, b) => a + b, 0) / n,
      p95: sums[Math.min(n - 1, Math.floor(n * 0.95))],
      samples: n,
    };
  };

  // Drafting state lives entirely in the engine now; the preview reads it back.

  const parallaxCamera = (cam = engine?.getCam()) => {
    if (!engine || !cam) return undefined;
    return {
      camX: engine.getWorldOffsetX() + cam.x,
      camY: engine.getWorldOffsetY() + cam.y,
      scale: bgZoomScale(),
    };
  };

  // Pointer tracking (browser-side; the engine maps it to the aim cell)
  let clientX = -1, clientY = -1;
  let px = -1, py = -1;
  let inside = false;
  // bit 0 = LMB, bit 1 = RMB (drives player primary/secondary). This is the
  // AUTHORITATIVE held-button state and it is owned by the pointerdown/pointerup
  // EDGES, not by per-move `e.buttons`. Real hardware/drivers routinely emit a
  // `pointermove` whose `buttons` field momentarily reads 0 while the button is
  // still physically down (a "phantom release"). If a move were allowed to clear
  // mouseButtons, the engine would see PI_PRIMARY fall for a step — finalizing the
  // solid draft after a SINGLE chunk — then never see it rise again until the real
  // release, which is exactly the "places one chunk then does nothing" bug. So
  // down sets the bit, up clears it, and a move may only ADD a newly-pressed
  // button, never drop a held one.
  let mouseButtons = 0;
  // pointer e.button -> mouseButtons bit (LMB, RMB)

  const updateMineProgress = () => {
    if (!survival || !engine || !localPlayerId || !inside || !(mouseButtons & (BUTTON_BITS[0] | BUTTON_BITS[2]))) {
      mineProgress.style.display = 'none';
      return;
    }
    const progress = engine.getPlayerMineProgress?.(localPlayerId) || 0;
    if (progress <= 0) {
      mineProgress.style.display = 'none';
      return;
    }
    const x = Math.max(4, Math.min(wrapBounds.right - wrapBounds.left - 12, clientX - wrapBounds.left + 14));
    const y = Math.max(8, Math.min(wrapBounds.bottom - wrapBounds.top - 50, clientY - wrapBounds.top - 20));
    mineProgress.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    mineProgressFill.style.height = `${Math.round(progress * 100)}%`;
    mineProgress.style.display = 'block';
  };

  // Reduced motion
  let reduced = false;
  let mqReduced = null;
  let onReducedChange = null;
  if (reducedMotion !== undefined) {
    reduced = reducedMotion;
  } else if (typeof window !== 'undefined' && window.matchMedia) {
    mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mqReduced.matches;
    onReducedChange = () => (reduced = mqReduced.matches);
    mqReduced.addEventListener?.('change', onReducedChange);
    mqReduced.addListener?.(onReducedChange);
  }

  const refreshBounds = () => {
    const rect = container.getBoundingClientRect();
    wrapBounds = {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    };
    return rect;
  };

  const fit = () => {
    const { width, height } = refreshBounds();
    // The visible cell count is chosen from the PHYSICAL-pixel box (cssW*dpr,
    // corrected against the load-time dpr in computeViewportSizing), so neither the
    // device pixel ratio nor browser page zoom changes how many cells are shown —
    // only the container size and the in-game zoom do.
    dpr = window.devicePixelRatio || 1;
    stableCssSize = chooseStableCssSize(width, height, stableCssSize);
    const cssW = stableCssSize.width;
    const cssH = stableCssSize.height;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    // Size the parallax off the same zoom-corrected box as the sim so it, too,
    // ignores browser page zoom and stays in sync with the visible cells.
    const pageZoom = dpr / (baselineDpr > 0 ? baselineDpr : dpr);
    parallax.resize(cssW * pageZoom, cssH * pageZoom);
    parallax.draw(parallaxCamera());
    // Decide UI placement based on available horizontal space
    onLayoutChange?.({ uiAtBottom: width < SIZING.toolCollapseWidth });

    const sizing = computeViewportSizing(cssW, cssH, dpr, SIZING, zoomFactor(), minZoomFactor(), baselineDpr);
    cellSize = sizing.cellSize;
    cellDev = sizing.cellDev;
    canvas.width = sizing.canvasW;
    canvas.height = sizing.canvasH;
    viewCols = sizing.viewCols;
    viewRows = sizing.viewRows;
    let bufCols = sizing.bufCols;
    let worldRows = sizing.worldRows;

    // As a connected multiplayer client the simulation buffer is the SERVER's
    // (diffs are authored in its cols/rows); never rebuild it to window dims on
    // resize — only resize the GL backing store + viewport (the pure-zoom path).
    if (netClientReady() && engine) { bufCols = cols; worldRows = rows; }

    // The simulation buffer depends on logical CSS viewport cells, not on dpr. So
    // a pure zoom/display-scale change keeps the same world and only repaints at
    // the new device resolution.
    if (engine && cols === bufCols && rows === worldRows) {
      // Pure zoom (dpr) change: same world, just resize the GL backing store and
      // update the engine's cell metrics (cellDev changes with dpr).
      engine.glResize(canvas.width, canvas.height);
      engine.setViewport(dpr, cellDev, viewCols, viewRows);
      parallax.draw(parallaxCamera());
      forceFullRender = true;
      previewDirty = false;
      return;
    }
    cols = bufCols;
    rows = worldRows;

    if (engine && engine.destroy) engine.destroy(); // free a prior (e.g. WASM) engine on resize
    engine = createEngineWasm({
      cols,
      rows,
      infinite: true,
      worldSeed,
      emittersOn: false, // taps/sinks are obsolete in the streaming world
      sinksOn: false,
    });
    engine.glInit(canvas);                          // create the WebGL2 context on our canvas
    engine.glResize(canvas.width, canvas.height);
    engine.setTool(TOOL_IDS[currentToolName] ?? 0); // re-apply the selected tool
    // Viewport + camera bounds + input mode (the engine owns the camera now).
    engine.setViewport(dpr, cellDev, viewCols, viewRows);
    engine.setPlayMode(playMode);
    engine.setDrawMode(drawModeOn);
    engine.glSetFlags(gutterOn, snapOff);
    const spawnCol = Math.floor(cols / 2);
    const spawnRow = engine.worldSurfaceAt(engine.getWorldOffsetX() + spawnCol);
    // Spawn the local player on the surface in survival mode (unless a client,
    // where the host owns it — it gets removed and re-rendered from snapshots when
    // joining). Creative mode has no character.
    if (survival) engine.setSurvivalInventory(true); // mining->drops->inventory; spawnPlayer seeds the starter kit
    if (survival && !netClientReady()) {
      localPlayerId = engine.spawnPlayerAtSurface(spawnCol);
      onInventory?.(engine.getInventory(localPlayerId)); // initial HUD fill
      lastInvHash = engine.inventoryHash(localPlayerId);
    }
    // Start centered horizontally, with roughly one third of the view underground.
    engine.cameraSet((cols - viewCols) / 2, spawnRow - Math.floor(viewRows * (2 / 3)));
    parallax.draw(parallaxCamera());
    lastCamX = NaN;
    lastCamY = NaN;

    forceFullRender = true;
    previewDirty = false;
  };

  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(container);

  // Re-fit when devicePixelRatio changes (browser zoom). The ResizeObserver only
  // watches the CSS box, which is unchanged by zoom, so it wouldn't fire here;
  // fit() rebuilds the device-px backing store at the new ratio (and, since the
  // CSS-derived world dims are unchanged, keeps the running simulation).
  let mqDpr = null;
  const onDprChange = () => { fit(); watchDpr(); };
  function watchDpr() {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    mqDpr?.removeEventListener?.('change', onDprChange);
    mqDpr = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mqDpr.addEventListener?.('change', onDprChange);
  }
  watchDpr();
  const onVisualViewportResize = () => fit();
  window.visualViewport?.addEventListener?.('resize', onVisualViewportResize);

  // ---- runtime zoom (view-only; the buffer is fixed, so no world rebuild) ----
  // Re-fit at a new zoom index and keep the same world point centered (fit()'s fast
  // path leaves the camera's top-left fixed, which would drift the view as the
  // window resizes, so we recenter around the pre-zoom center).
  const applyZoom = (nextIndex) => {
    const clamped = Math.max(0, Math.min(SIZING.zoomSteps.length - 1, nextIndex | 0));
    if (clamped === zoomIndex || !engine) return;
    const cam = engine.getCam();
    const centerX = cam.x + viewCols / 2;   // buffer-cell center BEFORE the zoom
    const centerY = cam.y + viewRows / 2;
    zoomIndex = clamped;
    fit();                                    // buffer dims unchanged -> fast path (keeps the world)
    engine.cameraSet(centerX - viewCols / 2, centerY - viewRows / 2); // recenter with new viewCols/Rows
    lastCamX = NaN; lastCamY = NaN;
    forceFullRender = true;
    render(true);
  };
  const zoomBy = (delta) => applyZoom(zoomIndex + delta);
  const resetZoom = () => applyZoom(SIZING.zoomDefaultIndex);

  // Pointer helpers. JS computes the canvas-relative CSS-px position + inside
  // flag and forwards them with the button state; the engine maps that to the
  // aim cell (camera.inc owns the camera + cell metrics). mouseButtons: bit0=LMB,
  // bit1=RMB (drives the player's primary/secondary in draw mode).
  // Forward only when something actually changed (the loop calls this every
  // frame): the engine stores the pointer and derives the aim cell on demand,
  // so identical state doesn't need an FFI call. A recreated engine (resize)
  // starts with pointer state unset, hence the sentEngine check.
  let sentPX = NaN, sentPY = NaN, sentButtons = -1, sentInside = null, sentEngine = null;
  const updatePointer = (cx, cy) => {
    clientX = cx; clientY = cy;
    inside = cx >= wrapBounds.left && cx <= wrapBounds.right && cy >= wrapBounds.top && cy <= wrapBounds.bottom;
    px = cx - wrapBounds.left;
    py = cy - wrapBounds.top;
    if (!engine) return;
    if (engine === sentEngine && px === sentPX && py === sentPY && mouseButtons === sentButtons && inside === sentInside) return;
    engine.inputPointer(px, py, mouseButtons, inside);
    sentEngine = engine; sentPX = px; sentPY = py; sentButtons = mouseButtons; sentInside = inside;
  };

  // Global listeners so the canvas can stay pointer-events:none. JS forwards raw
  // pointer state; the engine owns the aim mapping and all tool policy.
  const onPointerMove = (e) => {
    // Only ADD buttons a move reports as newly pressed; a held button is released
    // solely by pointerup/pointercancel/blur. Trusting e.buttons==0 here would let
    // a phantom-release move drop a still-held button (see mouseButtons comment).
    mouseButtons |= e.buttons;
    updatePointer(e.clientX, e.clientY);
    if (playMode) { if (engine) previewDirty = true; return; } // re-present so the aim cursor follows
    if (!drawModeOn || !engine) return;
    if (inside && engine.pointerDraftAtAim()) previewDirty = true;
  };
  const onTouchMove = (e) => {
    if (!drawModeOn || !engine) return;
    if (!e.touches || e.touches.length === 0) return;
    const t = e.touches[0];
    updatePointer(t.clientX, t.clientY);
    if (inside && engine.pointerDraftAtAim()) previewDirty = true;
  };

  // LMB starts drafts / spawns the cube; RMB arms the momentary eraser. Paint
  // and erase tools act continuously in the step loop (engine.applyLocalInput).
  const onPointerDown = (e) => {
    if (!engine) return;
    // Survival aims/builds with the mouse regardless of the Draw toggle; creative
    // requires draw mode (so the page stays scrollable until the user opts in).
    if (!playMode && !drawModeOn) return;
    // Authoritative press edge: latch this button's bit (plus any other buttons the
    // event reports already down). The latch is what keeps PI_PRIMARY held across
    // steps even if later moves momentarily report buttons==0.
    mouseButtons |= e.buttons | (BUTTON_BITS[e.button] || 0);
    updatePointer(e.clientX, e.clientY);
    if (!inside) return;
    if (e.button === 0 || e.button === 2) {
      if (playMode) { previewDirty = true; e.preventDefault(); return; } // player builds/mines via input bits
      if (engine.pointerDownAtAim(e.button)) previewDirty = true;
      e.preventDefault();
    }
  };

  const onPointerUp = (e) => {
    if (!engine) return;
    // Authoritative release edge: drop only the released button's bit. Other
    // buttons stay latched until their own pointerup (or blur/cancel).
    mouseButtons &= ~(BUTTON_BITS[e.button] || 0);
    updatePointer(e.clientX, e.clientY);
    engine.pointerButtons(mouseButtons); // clears RMB/LMB when no buttons remain
    if (engine.pointerUp(e.button)) previewDirty = true;
  };

  const onContextMenu = (e) => {
    if ((drawModeOn || playMode) && inside) e.preventDefault(); // RMB places in bg; no menu
  };

  const onScroll = () => {
    refreshBounds();
    if (clientX >= 0 && clientY >= 0) updatePointer(clientX, clientY);
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

  // Movement keys (WASD/arrows + space/shift) are forwarded to the engine, which
  // owns the pan/player-input policy. The editable-target guard + preventDefault
  // stay in JS (they need the DOM event/target).
  const onKeyDown = (e) => {
    if (isEditableEvent(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    const key = e.key.toLowerCase();
    // Zoom (desktop): +/= zoom in, -/_ zoom out, 0 reset. View-only, so it never
    // rebuilds the world. Handled before movement/hotbar keys ('0' is unused there).
    if (key === '+' || key === '=') { zoomBy(1); e.preventDefault(); return; }
    if (key === '-' || key === '_') { zoomBy(-1); e.preventDefault(); return; }
    if (key === '0') { resetZoom(); e.preventDefault(); return; }
    // Survival inventory hotkeys (engine owns the selection policy): digits 1-9
    // pick a hotbar slot; E toggles the grid. Handled before the movement-key map.
    if (survival && engine && (localPlayerId || netClientReady())) {
      if (key >= '1' && key <= '9') {
        const slot = +key - 1;
        if (netClientReady()) net.sendSelect(slot); else engine.setSelectedSlot(localPlayerId, slot);
        e.preventDefault(); return;
      }
      if (key === 'e') { onToggleInventory?.(); e.preventDefault(); return; }
      if (key === 'q') { onToggleFootprintMenu?.(); e.preventDefault(); return; }
    }
    const code = KEY_CODES[key];
    if (code === undefined) return;
    engine?.inputKey(code, 1);
    if (key !== 'shift') e.preventDefault(); // arrows/space/wasd would scroll the page
  };
  const onKeyUp = (e) => {
    const code = KEY_CODES[e.key.toLowerCase()];
    if (code !== undefined) engine?.inputKey(code, 0);
  };
  const onBlur = () => {
    engine?.inputClearKeys();      // avoid keys "sticking" on focus loss
    mouseButtons = 0;              // and avoid a button "sticking" if focus is lost mid-press
    engine?.pointerButtons(0);
    updatePointer(clientX, clientY); // push the cleared state so PI_PRIMARY drops -> draft finalizes
  };
  // Pointer capture can be revoked (e.g. an OS gesture); treat it as a release so a
  // held button can never get stranded latched.
  const onPointerCancel = (e) => {
    mouseButtons &= ~(BUTTON_BITS[e.button] || 0);
    if (e.button < 0) mouseButtons = 0; // pointercancel has no button -> clear all
    updatePointer(e.clientX, e.clientY);
    engine?.pointerButtons(mouseButtons);
  };

  // Survival: scroll cycles the selected hotbar slot (wrap-around policy is in C++).
  const onWheel = (e) => {
    if (!survival || !engine || !inside || isEditableEvent(e)) return;
    if (netClientReady()) {
      const inv = net.getOwnInventory(); if (!inv) return;
      net.sendSelect((inv.selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9); // hotbar is slots 0-8
      e.preventDefault(); return;
    }
    if (!localPlayerId) return;
    engine.cycleSelectedSlot(localPlayerId, e.deltaY > 0 ? 1 : -1);
    e.preventDefault();
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  if (survival) window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // Present one frame. The engine owns the whole compositing pipeline now: it
  // reads its own camera (camera.inc), uploads the cells whose contents changed
  // (dirty-rect glTexSubImage2D), nearest-upscales the visible window onto the
  // canvas, draws the 1px gutter grid, the player overlay, and the draft preview
  // — all in C++/WebGL. JS only hands it the player set to draw.
  //
  // The sub-cell pan offset is snapped to whole device px inside the engine (the
  // documented bright-block-flicker fix); the snap/gutter A/B flags live there too.
  // Grow-only packing buffer for the per-frame client player upload.
  let packScratch = new Float32Array(0);
  const render = (full = false) => {
    if (!engine) return;
    const renderStart = performance.now();
    // Players to overlay. A client renders host-authoritative snapshot players;
    // host/local renders the engine's own players (own = the local id, blue).
    // While the bench is paused we draw none (an empty external set) so the
    // flicker probe sees only the cell grid.
    if (testPaused) {
      engine.glSetPlayers(true, null, 0);
    } else if (netClientReady()) {
      const ps = net.getPlayersForRender();
      const stride = engine.getRenderStrides().player;
      const floats = ps.length * stride;
      if (packScratch.length < floats) packScratch = new Float32Array(floats);
      const packed = packScratch.subarray(0, floats); // [x,y,w,h,facing,own,animState,animFrame]
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i], o = i * stride;
        packed[o] = p.x; packed[o + 1] = p.y; packed[o + 2] = p.w; packed[o + 3] = p.h;
        packed[o + 4] = p.facing; packed[o + 5] = p.id === net.ownPlayerId ? 1 : 0;
        packed[o + 6] = p.animState || 0; packed[o + 7] = p.animFrame || 0;
      }
      engine.glSetPlayers(true, packed, net.ownPlayerId);
    } else {
      engine.glSetPlayers(false, null, localPlayerId);
    }
    // Dropped items: a client draws the server's authoritative items; host/local
    // (and single-player) draws the engine's own (null = engine-owned).
    engine.glSetItems(netClientReady() ? net.getItemsForRender() : null);
    engine.glRenderFrame(full || forceFullRender);
    forceFullRender = false;
    previewDirty = false;
    const cam = engine.getCam();
    parallax.draw(parallaxCamera(cam));
    lastCamX = cam.x;
    lastCamY = cam.y;
    perfRenderMs = performance.now() - renderStart;
  };

  if (import.meta.env?.DEV && typeof window !== 'undefined') {
    window.__sandPerf = () => {
      const { avg, p95, samples } = perfFrameSummary();
      const perf = engine ? engine.getPerf() : { stepMs: 0, dirtyChunks: 0 };
      return {
        stepMs: Number(perf.stepMs.toFixed(2)),
        renderMs: Number(perfRenderMs.toFixed(2)),
        lightMs: Number((perf.lightMs || 0).toFixed(3)),
        fillMs: Number((perf.fillMs || 0).toFixed(3)),
        uploadMs: Number((perf.uploadMs || 0).toFixed(3)),
        avgFrameMs: Number(avg.toFixed(3)),
        p95FrameMs: Number(p95.toFixed(3)),
        samples,
        dirtyChunks: perf.dirtyChunks,
        worldShifts: engine ? engine.getWorldShiftCount() : 0,
        wasmHeapMB: engine ? Number((engine.getHeapBytes() / (1024 * 1024)).toFixed(1)) : 0,
        rows,
        cols,
      };
    };
    // Deterministic hooks for the headless pan/flicker benchmark
    // (scripts/bench-pan.mjs). DEV-only, same guard as __sandPerf above.
    window.__sandTest = {
      setCam(x, y) { engine?.cameraSet(x, y); render(false); },
      getCam() { return engine ? engine.getCam() : { x: 0, y: 0 }; },
      render() { render(false); },
      // vertical-streaming hooks (browser test): trigger a stream pass + read the
      // 2D world offset, to verify a world shift is seamless on screen.
      streamWorldTest() { if (engine) { engine.streamWorld(); render(false); } },
      worldOffset() { return engine ? { x: engine.getWorldOffsetX(), y: engine.getWorldOffsetY() } : { x: 0, y: 0 }; },
      setPaused(v) { testPaused = !!v; }, // freeze the sim so the flicker probe sees only pan changes
      setGutter(v) { gutterOn = !!v; engine?.glSetFlags(gutterOn, snapOff); render(false); },
      off() { return engine ? engine.glGetOffset() : { offX: 0, offY: 0 }; },
      setSnap(v) { snapOff = !v; engine?.glSetFlags(gutterOn, snapOff); render(false); },
      info() { return { cols, rows, cellSize, cellDev, viewCols, viewRows, dpr: window.devicePixelRatio || 1, canvasW: canvas.width, canvasH: canvas.height }; },
      // cursor (canvas-relative CSS px) -> cell, same mapping as the real input path
      cellAt(pxCss, pyCss) { const cam = engine ? engine.getCam() : { x: 0, y: 0 }; return [Math.floor(cam.x + (pxCss * dpr) / cellDev), Math.floor(cam.y + (pyCss * dpr) / cellDev)]; },
      // device-px top-left where a cell renders (for round-trip verification). The
      // snapped present offset lives in the engine now (engine.glGetOffset()).
      cellRect(cx, cy) { const cam = engine ? engine.getCam() : { x: 0, y: 0 }; const camCol = Math.floor(cam.x), camRow = Math.floor(cam.y); const o = engine ? engine.glGetOffset() : { offX: 0, offY: 0 }; return { x: (cx - camCol) * cellDev + o.offX, y: (cy - camRow) * cellDev + o.offY, size: cellDev }; },
      // read back a top-down RGBA region of the GL canvas (flicker probe)
      readPixels(x, y, w, h) { return engine ? engine.glReadPixels(x, y, w, h) : new Uint8ClampedArray(w * h * 4); },
      // player hooks for the headless gameplay test (scripts / Playwright)
      setPlayMode(v) { playMode = !!v; engine?.setPlayMode(playMode); },
      getPlayMode() { return playMode; },
      getPlayer() { return localPlayer(); },
      getPlayers() { return engine ? engine.getPlayers() : []; },
      renderedPlayers() { return playersForRender(); },
      localInput() { return currentLocalInput(); },
      heldKeys() { return engine ? engine.getHeldKeys() : 0; },
      // world-replication hooks (mp-e2e): edit the host world + measure a region.
      gridHash() { return engine ? engine.gridHash() : 0; },
      erase(x, y, r) { engine?.eraseDisc(x, y, r); },
      solidCount(x0, y0, x1, y1) {
        if (!engine) return 0;
        const g = engine.getGrid(); let n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (g[y * cols + x] !== 0) n++;
        return n;
      },
      setTool(name) { currentToolName = name; engine?.setTool(TOOL_IDS[name] ?? 0); },
      setDrawMode(v) { drawModeOn = !!v; engine?.setDrawMode(drawModeOn); },
      addInventory(material, count) { return localPlayerId && engine ? engine.addToInventory(localPlayerId, material | 0, count | 0) : false; },
      selectSlot(i) { if (localPlayerId) engine?.setSelectedSlot(localPlayerId, i | 0); },
      actionCount() { return engine ? engine.getPlayerActionCount() : 0; },
      // device-px center of the local player (for aiming real mouse events)
      playerScreen() {
        const p = localPlayer(); if (!p) return null;
        const cam = engine ? engine.getCam() : { x: 0, y: 0 };
        const camCol = Math.floor(cam.x), camRow = Math.floor(cam.y);
        const o = engine ? engine.glGetOffset() : { offX: 0, offY: 0 };
        return {
          x: ((p.x + p.w / 2 - camCol) * cellDev + o.offX) / dpr,
          y: ((p.y + p.h / 2 - camRow) * cellDev + o.offY) / dpr,
        };
      },
    };
    // Multiplayer hooks for the two-context Playwright test.
    window.__sandNet = {
      join: (url, room) => netJoin(url, room),
      disconnect: () => netDisconnect(),
      status: () => netStatus(),
      players: () => playersForRender(),
      playerCount: () => playersForRender().length,
      ownPlayer: () => (netClientReady() ? net.getOwnPlayer() : localPlayer()),
      // dropped-item count (client: from the server snapshot; else the engine).
      items: () => (netClientReady() ? net.getItemsForRender().length / ITEM_FIELDS : (engine ? engine.itemCount() : 0)),
      ownInventory: () => (netClientReady() ? net.getOwnInventory() : (localPlayerId && engine ? engine.getInventory(localPlayerId) : null)),
      ownCursor: () => (netClientReady() ? net.getOwnCursor() : (localPlayerId && engine ? engine.getCursor(localPlayerId) : null)),
      // survival intents routed to the server (used by the mp e2e test).
      select: (slot) => net.sendSelect(slot),
      pick: (slot, half) => net.sendPick(slot, half),
      throwCursor: (whole) => net.sendThrow(whole),
      debug: () => net.debug,
      // Drive N fixed sim steps synchronously (RAF-throttling-immune) so the
      // two-context multiplayer test is deterministic.
      tickSteps: (n = 1) => { for (let i = 0; i < n; i++) doFixedStep(performance.now()); render(false); },
    };
  }

  // ---- local player input + camera follow (play mode) ----
  const localPlayer = () => (engine && localPlayerId ? engine.getPlayer(localPlayerId) : null);
  // Normalized local input each step — the engine builds the bitmask (held keys +
  // mouse-as-primary/secondary) and the aim cell from the forwarded pointer. The
  // net layer sends this to the host.
  const currentLocalInput = () => {
    const a = engine ? engine.getAim() : { x: 0, y: 0 };
    return { bits: engine ? engine.localInputBits() : 0, aimX: a.x, aimY: a.y, tool: TOOL_IDS[currentToolName] ?? 0 };
  };
  // Glide the camera toward the followed player's center (clamp + lerp in C++).
  // On a client the followed player is our host-authoritative snapshot entity.
  // Runs every frame, so the local read reuses one scratch object (no per-frame
  // player-object churn).
  const followScratch = {};
  const followCamera = () => {
    const p = netClientReady()
      ? net.getOwnPlayer()
      : (engine && localPlayerId ? engine.getPlayer(localPlayerId, followScratch) : null);
    if (!p || !engine) return;
    engine.cameraFollowTo(p.x + p.w / 2, p.y + p.h / 2);
  };

  // Rebuild the local render engine to the authoritative server's buffer dims so
  // world diffs apply 1:1 (a connected client renders the server's bounded-arena
  // world, never its own). Keeps the current view metrics; does NOT spawn a local
  // player (the server owns it). Called by the net layer on the first WORLD.
  const rebuildEngineForDims = (netCols, netRows) => {
    if (engine && cols === netCols && rows === netRows) {
      if (localPlayerId) engine.removePlayer(localPlayerId);
      localPlayerId = 0;
      return engine;
    }
    if (engine && engine.destroy) engine.destroy();
    cols = netCols; rows = netRows;
    engine = createEngineWasm({ cols, rows, infinite: true, worldSeed, emittersOn: false, sinksOn: false });
    engine.glInit(canvas);
    engine.glResize(canvas.width, canvas.height);
    engine.setTool(TOOL_IDS[currentToolName] ?? 0);
    engine.setViewport(dpr, cellDev, viewCols, viewRows);
    engine.setPlayMode(playMode);
    engine.setDrawMode(drawModeOn);
    engine.glSetFlags(gutterOn, snapOff);
    if (survival) engine.setSurvivalInventory(true);
    localPlayerId = 0; // client: the server owns our player; render from snapshots
    engine.cameraSet((cols - viewCols) / 2, Math.max(0, (rows - viewRows) / 2));
    forceFullRender = true;
    previewDirty = false;
    return engine;
  };

  // Multiplayer glue. The browser is always a pure client; the authoritative
  // engine runs in a headless server (scripts/sand-server.mjs).
  net = createGameNet({
    getEngine: () => engine,
    getLocalInput: currentLocalInput,
    rebuildEngine: rebuildEngineForDims,
  });
  const playersForRender = () => (netClientReady() ? net.getPlayersForRender() : engine.getPlayers());
  const netJoin = async (url, room) => {
    try {
      await net.joinRoom(url, room);
    } catch (e) {
      net.disconnect();
      if (survival && !localPlayerId) { cols = 0; rows = 0; fit(); }
      throw e;
    }
  };
  const netDisconnect = () => {
    net.disconnect();
    // Return to single-player: rebuild the local INFINITE world at window dims (the
    // client engine was sized to the server's bounded arena). Forcing a dims
    // mismatch makes fit() take the full-rebuild path, which respawns the player.
    if (survival) { cols = 0; rows = 0; fit(); }
  };
  const netStatus = () => ({ role: net.role, connected: net.connected, worldReady: net.worldReady, remotes: net.remoteCount, ownPlayerId: net.ownPlayerId, status: net.status });

  // One fixed simulation step: world-shift + input/tool + multiplayer pump +
  // engine.step. Extracted so the main loop AND the deterministic test hook
  // (tickSteps) can drive it identically — the test path is immune to RAF
  // throttling (which otherwise makes two-context multiplayer timing flaky).
  const doFixedStep = (now) => {
    // A server-side close clears the transactional net state. Recreate the local
    // world/player on the next tick just as an explicit Disconnect does.
    if (survival && !net.connected && !localPlayerId) { cols = 0; rows = 0; fit(); }
    const isClient = netClientReady();
    // A client doesn't stream or simulate the shared world — the host is
    // authoritative and replicates it via diffs (applied in net.update).
    // streamWorld() slides the buffer, the cell texture, and the camera in lockstep.
    if (!isClient) engine.streamWorld();
    // Apply this frame's local input: feed the player (play mode) or run the
    // active tool at the aim cell (draw mode). The engine decides which.
    if (!isClient) {
      if (engine.applyLocalInput(localPlayerId, now, ++inputSeq)) previewDirty = true;
    }
    if (net.connected) net.update();
    const didStep = isClient ? false : engine.step(now);
    if (didStep) {
      perfStepSamples[perfSampleIdx] = engine.getPerf().stepMs;
      perfRenderSamples[perfSampleIdx] = perfRenderMs;
      perfSampleIdx = (perfSampleIdx + 1) % PERF_SAMPLES;
      if (perfSampleCount < PERF_SAMPLES) perfSampleCount++;
    }
    return didStep;
  };

  // Main loop
  let raf = 0;
  let lastStep = performance.now();
  let lastFrame = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (reduced) return;

    // Keep the engine's pointer fresh as the page scrolls under a static cursor
    // (re-derives inside/aim from the new canvas bounds).
    if (clientX >= 0 && clientY >= 0) updatePointer(clientX, clientY);

    // Per-frame camera pan (free-camera mode): the engine pans from held keys,
    // scaled by real frame time so motion is smooth at any refresh rate. Frame dt
    // is clamped so a long stall (e.g. tab refocus) can't produce a big jump. In
    // play mode the keys drive the player and the camera follows it (below).
    const frameDt = Math.min(SIZING.maxFrameDtMs, now - lastFrame);
    lastFrame = now;
    engine?.cameraPanFrame(frameDt);

    // Fixed-timestep simulation with catch-up: world-shift + tool application +
    // engine.step run at STEP_MS for determinism, independent of the per-frame pan
    // above. We run as many steps as the elapsed real time owes (advancing lastStep
    // by STEP_MS each, so the sub-step remainder is preserved) — a frame that runs
    // long no longer permanently drops a step's worth of time, which is what made the
    // survival character crawl under load. Capped at maxCatchupSteps so a long stall
    // (tab refocus) or sustained overload sheds its backlog instead of avalanching;
    // past the cap the sim degrades to slow-motion rather than freezing. A network
    // client never steps the world locally (the host is authoritative), so it just
    // pumps the net at STEP_MS cadence as before.
    let stepped = false;
    if (!testPaused) {
      if (netClientReady()) {
        if (now - lastStep >= STEP_MS) { doFixedStep(now); lastStep = now; }
      } else {
        const maxDebt = STEP_MS * SIZING.maxCatchupSteps;
        if (now - lastStep > maxDebt) lastStep = now - maxDebt;
        while (now - lastStep >= STEP_MS) {
          if (doFixedStep(now)) stepped = true;
          lastStep += STEP_MS;
        }
      }
    }

    // Refresh the survival HUD: from the server's inventory when connected as a
    // client (only when it changed), else from the local engine's authoritative
    // snapshot when the sim advanced (pickups/placement happen in steps).
    if (survival && onInventory) {
      if (netClientReady()) {
        if (net.consumeInventoryDirty()) { const inv = net.getOwnInventory(); if (inv) onInventory(inv); }
      } else if (stepped && localPlayerId) {
        // Only rebuild + push the snapshot when it actually changed (the hash
        // reads the packed floats without allocating slot objects).
        const h = engine.inventoryHash(localPlayerId);
        if (h !== lastInvHash) { lastInvHash = h; onInventory(engine.getInventory(localPlayerId)); }
      }
    }
    updateMineProgress();

    // Camera follows the local player each frame (smooth at any refresh rate).
    // Skipped while paused so the headless pan/flicker bench keeps full control.
    if (playMode && !testPaused) followCamera();

    // Present every frame the camera moved or the sim changed. A camera-only
    // frame is a cheap GPU blit (render() does no CPU pixel work when content
    // is unchanged), so this is safe to run at the display refresh rate.
    const cam = engine ? engine.getCam() : { x: lastCamX, y: lastCamY };
    const camMoved = cam.x !== lastCamX || cam.y !== lastCamY;
    // A connected client animates remote players from snapshots even when its own
    // grid is static, so keep presenting. previewDirty forces a present when a
    // fresh draft overlay appears with no camera/step change.
    if (stepped || camMoved || previewDirty || netClientReady()) render(false);
  };
  raf = requestAnimationFrame(loop);

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    mineProgress.remove();
    ro.disconnect();
    mqDpr?.removeEventListener?.('change', onDprChange);
    window.visualViewport?.removeEventListener?.('resize', onVisualViewportResize);
    net?.disconnect();
    if (engine && engine.destroy) engine.destroy();
    parallax.destroy();
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
    if (mqReduced && onReducedChange) {
      mqReduced.removeEventListener?.('change', onReducedChange);
      mqReduced.removeListener?.(onReducedChange);
    }
    canvas.remove();
  };

  return {
    setTool(id) { currentToolName = id; engine?.setTool(TOOL_IDS[id] ?? 0); },
    setDrawMode(on) { drawModeOn = !!on; engine?.setDrawMode(drawModeOn); },
    getDrawMode() { return drawModeOn; },
    setPlayMode(on) { playMode = !!on; engine?.setPlayMode(playMode); },
    getPlayMode() { return playMode; },
    inputKey(code, on) { engine?.inputKey(code | 0, on ? 1 : 0); },
    // Survival inventory intents. When connected as a client they go to the
    // authoritative server; offline they apply to the local engine (unchanged).
    isSurvival() { return survival; },
    selectSlot(i) { if (netClientReady()) net.sendSelect(i | 0); else if (localPlayerId) engine?.setSelectedSlot(localPlayerId, i | 0); },
    setSelectedFootprint(i) {
      if (netClientReady()) net.sendSize(i | 0);
      else if (localPlayerId && engine) {
        engine.setSelectedFootprint(localPlayerId, i | 0);
        onInventory?.(engine.getInventory(localPlayerId));
      }
    },
    getSurvivalFootprints() { return engine?.getSurvivalFootprints?.() || []; },
    moveSlot(from, to) { if (netClientReady()) net.sendMove(from | 0, to | 0); else if (localPlayerId) engine?.inventoryMove(localPlayerId, from | 0, to | 0); },
    getInventory() {
      if (netClientReady()) return net.getOwnInventory() || { slots: [], selected: 0, selectedFootprint: 0 };
      return localPlayerId && engine ? engine.getInventory(localPlayerId) : { slots: [], selected: 0, selectedFootprint: 0 };
    },
    // Minecraft cursor model (carried stack) + throw-out (facing direction).
    cursorPick(slot, half) { if (netClientReady()) net.sendPick(slot | 0, half); else if (localPlayerId) engine?.inventoryCursorPick(localPlayerId, slot | 0, half); },
    throwFromCursor(whole) { if (netClientReady()) net.sendThrow(whole); else if (localPlayerId) engine?.throwFromCursor(localPlayerId, whole); },
    getCursor() {
      if (netClientReady()) return net.getOwnCursor();
      return localPlayerId && engine ? engine.getCursor(localPlayerId) : null;
    },
    // Runtime zoom (view-only). Buttons/keys drive these; the buffer is fixed so
    // the world/player survive a zoom change.
    zoomIn() { zoomBy(1); },
    zoomOut() { zoomBy(-1); },
    resetZoom() { resetZoom(); },
    getZoom() { return { index: zoomIndex, factor: zoomFactor(), count: SIZING.zoomSteps.length }; },
    // Creative palette selection (kind: 0=material,1=seed,2=eraser,3=cube).
    setCreativeMaterial(kind, value) { engine?.setCreativeMaterial(kind, value); },
    // Live performance snapshot for the on-screen perf HUD (the /fps route). Mirrors
    // the DEV-only window.__sandPerf but is always available. fps/tickrate are left
    // to the caller to derive from wall-clock deltas of `tick` + its own frames.
    perfStats() {
      const { avg, p95 } = perfFrameSummary();
      const perf = engine ? engine.getPerf() : { stepMs: 0, dirtyChunks: 0 };
      return {
        stepMs: perf.stepMs,
        renderMs: perfRenderMs,
        lightMs: perf.lightMs || 0,
        fillMs: perf.fillMs || 0,
        uploadMs: perf.uploadMs || 0,
        avgFrameMs: avg,
        p95FrameMs: p95,
        dirtyChunks: perf.dirtyChunks,
        tick: engine ? engine.getTick() : 0,
        worldShifts: engine ? engine.getWorldShiftCount() : 0,
        heapMB: engine ? engine.getHeapBytes() / (1024 * 1024) : 0,
        rows, cols,
      };
    },
    netJoin(url, room) { return netJoin(url, room); },
    netDisconnect() { netDisconnect(); },
    netStatus() { return netStatus(); },
    destroy,
  };
}
