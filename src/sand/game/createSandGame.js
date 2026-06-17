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
// simulation runs in the WebAssembly engine (../engineWasm.js); initSandWasm()
// must have resolved before createSandGame() is called.

import { createEngineWasm, CHUNK_SIZE } from '../engineWasm';
import { createGameNet } from '../net/gameNet';

export function createSandGame(container, opts = {}) {
  const {
    initialTool = 'cube',
    onLayoutChange,
    reducedMotion,
    // 'survival' (default): a player character with reach/cooldown-restricted
    // tools, camera follows. 'creative': free camera (WASD pans the infinite
    // world), draw tools place/erase anywhere with no reach limit, no character.
    mode = 'survival',
  } = opts;
  const survival = mode === 'survival';

  // --- Host canvas (created and owned here). The WASM engine owns a WebGL2
  // context on it and composites the cell texture, gutter grid, player overlay,
  // and draft preview directly (engine.glRenderFrame). JS no longer touches
  // pixels — it only sizes the canvas, drives the camera, and forwards input. ---
  const canvas = document.createElement('canvas');
  canvas.id = 'sand-main'; // stable selector for the headless pan/flicker bench
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.userSelect = 'none';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  // Tool selection: the name is kept here only so it can be re-sent to the
  // engine when the engine is recreated (resize). All tool policy lives in C++.
  // The engine owns the int ids; this maps the UI tool names onto them.
  const TOOL = { cube: 0, sand: 1, water: 2, stone: 3, oil: 4, fire: 5, acid: 6, lava: 7, ice: 8, seed: 9, driftwood: 10, eraser: 11 };
  let currentToolName = initialTool;
  let drawModeOn = false;

  // Player mode (survival): WASD/arrows drive the local character and the camera
  // follows it. Free-camera mode (creative; also the pan/flicker bench) pans the
  // buffer with WASD/arrows. The local player is simulated in the engine; JS only
  // forwards input. Survival starts in play mode; creative starts in free-cam.
  let playMode = survival;
  let localPlayerId = 0;
  const PLAYER_W = 4, PLAYER_H = 8; // mirrors PLAYER_W/PLAYER_H in cpp/common.hpp
  let inputSeq = 0;
  let net = null; // multiplayer glue (created lazily on host/join)

  // Surface spawn for a column: above the highest terrain across the footprint so
  // the character drops cleanly. Shared by the local spawn + remote (host) spawns.
  const surfaceSpawn = (col) => {
    const worldX0 = engine.getWorldOffsetX();
    let topSurf = engine.worldSurfaceAt(worldX0 + col);
    for (let c = col - PLAYER_W; c <= col + PLAYER_W; c++) topSurf = Math.min(topSurf, engine.worldSurfaceAt(worldX0 + c));
    return { x: col - PLAYER_W / 2, y: topSurf - PLAYER_H - 4 };
  };

  // One seed per mount so resizing regenerates the *same* infinite world.
  const worldSeed = (Math.random() * 4294967296) >>> 0;

  // ---- Tunables (render/UI side; physics tunables live in the C++ engine) ----
  const CELL_PX = 4;
  // Cap the simulation cell count so very large viewports (e.g. 1440p/4K
  // monitors) don't blow the per-step CPU budget on slow processors; cells
  // grow slightly instead.
  const MAX_CELLS = 130000;
  // Brush radii, the emit throttle, and the cube extent now live in the C++
  // engine (it owns tool policy). JS keeps only the fixed sim-step interval.
  const STEP_MS = 16;
  const TOOL_COLLAPSE_W = 1300; // px: move toolbar to bottom if wrapper width < this
  // World/camera: the simulation buffer is bigger than the viewport. It is the
  // full (fixed) world height and a horizontal window a margin wider than the
  // view; the camera pans within it (WASD/arrows). Horizontal streaming that
  // slides the window comes in a later phase.
  const WORLD_HEIGHT_FACTOR = 2.5; // world is this many viewports tall
  const BUF_MARGIN_COLS = 128;     // extra buffer columns on each side of the view
  const BUFFER_MAX_CELLS = 520000; // cap so the per-step budget stays bounded
  const MAX_FRAME_DT = 50;         // ms; clamp so a stall can't produce a big jump
  // The camera (pan speed, follow, bounds), the world-stream edge margin, the
  // pointer->aim mapping, the player input bitmask, and the preview/overlay
  // colors all live in the C++ engine now (cpp/engine/camera.inc + gl.inc).
  // JS forwards raw events and drives the RAF/fixed-step loop.

  // Simulation engine (recreated on resize)
  // cols/rows are the BUFFER (world) dimensions, larger than the viewport;
  // viewCols/viewRows are the visible cell window the camera shows.
  let engine = null;
  let cols = 0, rows = 0, cellSize = CELL_PX;
  // cellSize is CSS px per cell (drives the cell budget, appearance, and pointer
  // math). cellDev is the integer DEVICE px per cell used for all canvas drawing.
  // Sizing the backing store to device px and snapping the pan offset to whole
  // device px keeps cell edges + the 1px gutter grid on exact device pixels, so
  // the compositor never resamples them — that resampling (at browser zoom < 100%,
  // where devicePixelRatio drops below 1) is what caused the bright-block flicker.
  let dpr = 1, cellDev = CELL_PX;
  let viewCols = 0, viewRows = 0;
  // The camera lives in the engine (camera.inc). JS caches the last presented
  // position to detect movement (incl. sub-cell) and re-present.
  let lastCamX = NaN, lastCamY = NaN;
  let testPaused = false;             // DEV-only: freeze stepping for the flicker bench
  let gutterOn = true;                // DEV-only: toggle the grid for flicker A/B
  let snapOff = false;                // DEV-only: disable offset snapping for A/B
  // Physical keys -> engine InputKey codes (IK_LEFT..IK_SHIFT). The engine owns
  // the pan/player-input policy; JS just forwards held state.
  const KEY_CODE = { a: 0, arrowleft: 0, d: 1, arrowright: 1, w: 2, arrowup: 2, s: 3, arrowdown: 3, ' ': 4, shift: 5 };
  let wrapBounds = { left: 0, right: 0, top: 0, bottom: 0 };
  let forceFullRender = true;
  let perfRenderMs = 0;
  let previewDirty = false;           // force a present so a fresh draft overlay shows

  // Rolling perf samples for window.__sandPerf
  const PERF_SAMPLES = 120;
  const perfStepSamples = new Float32Array(PERF_SAMPLES);
  const perfRenderSamples = new Float32Array(PERF_SAMPLES);
  let perfSampleIdx = 0;
  let perfSampleCount = 0;

  // Drafting state lives entirely in the engine now; the preview reads it back.

  // Pointer tracking (browser-side; the engine maps it to the aim cell)
  let clientX = -1, clientY = -1;
  let px = -1, py = -1;
  let inside = false;
  let mouseButtons = 0; // bit 0 = LMB, bit 1 = RMB (drives player primary/secondary)

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
    // CSS-px size of the canvas element, and its DEVICE-px backing store. dpr < 1
    // when the browser is zoomed out; sizing the backing store to device px makes
    // it 1:1 with the screen so the compositor never resamples (no moiré).
    dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(300, Math.floor(width));
    const cssH = Math.max(200, Math.floor(height));
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    // Decide UI placement based on available horizontal space
    onLayoutChange?.({ uiAtBottom: width < TOOL_COLLAPSE_W });

    cellSize = CELL_PX;
    while (
      Math.ceil(cssW / cellSize) * Math.ceil(cssH / cellSize) > MAX_CELLS
    ) {
      cellSize++;
    }
    cellDev = Math.max(1, Math.round(cellSize * dpr)); // integer device px per cell
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    // Visible window (cells on screen) vs. the larger simulation buffer.
    viewCols = Math.max(60, Math.ceil(cssW / cellSize));
    viewRows = Math.max(28, Math.ceil(cssH / cellSize));
    // Buffer: full world height (taller than the view) + horizontal margin,
    // both rounded up to whole render chunks. Shrink the height factor if the
    // cell budget would be exceeded.
    const roundChunks = (n) => Math.ceil(n / CHUNK_SIZE) * CHUNK_SIZE;
    let bufCols = roundChunks(viewCols + BUF_MARGIN_COLS * 2);
    let heightFactor = WORLD_HEIGHT_FACTOR;
    let worldRows = roundChunks(Math.round(viewRows * heightFactor));
    while (bufCols * worldRows > BUFFER_MAX_CELLS && heightFactor > 1) {
      heightFactor -= 0.25;
      worldRows = roundChunks(Math.max(viewRows, Math.round(viewRows * heightFactor)));
    }

    // The simulation buffer depends only on CSS size + cellSize, not on dpr. So a
    // pure zoom change (dpr only) keeps the same world: just repaint at the new
    // device resolution instead of destroying and regenerating the engine.
    if (engine && cols === bufCols && rows === worldRows) {
      // Pure zoom (dpr) change: same world, just resize the GL backing store and
      // update the engine's cell metrics (cellDev changes with dpr).
      engine.glResize(canvas.width, canvas.height);
      engine.setViewport(dpr, cellDev, viewCols, viewRows);
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
    engine.setTool(TOOL[currentToolName] ?? 0); // re-apply the selected tool
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
    if (survival && (!net || net.role !== 'client')) {
      const sp = surfaceSpawn(spawnCol);
      localPlayerId = engine.spawnPlayer(sp.x, sp.y);
    }
    // Start centered horizontally, just above the surface so spawn shows ground.
    engine.cameraSet((cols - viewCols) / 2, spawnRow - Math.floor(viewRows * 0.4));
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

  // Pointer helpers. JS computes the canvas-relative CSS-px position + inside
  // flag and forwards them with the button state; the engine maps that to the
  // aim cell (camera.inc owns the camera + cell metrics). mouseButtons: bit0=LMB,
  // bit1=RMB (drives the player's primary/secondary in draw mode).
  const updatePointer = (cx, cy) => {
    clientX = cx; clientY = cy;
    inside = cx >= wrapBounds.left && cx <= wrapBounds.right && cy >= wrapBounds.top && cy <= wrapBounds.bottom;
    px = cx - wrapBounds.left;
    py = cy - wrapBounds.top;
    engine?.inputPointer(px, py, mouseButtons, inside);
  };

  // Global listeners so the canvas can stay pointer-events:none. JS forwards raw
  // pointer state; the engine owns the aim mapping and all tool policy.
  const onPointerMove = (e) => {
    mouseButtons = e.buttons;
    updatePointer(e.clientX, e.clientY);
    engine?.pointerButtons(e.buttons); // release the held/RMB state on buttons==0
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
    mouseButtons = e.buttons;
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
    mouseButtons = e.buttons;
    updatePointer(e.clientX, e.clientY);
    engine.pointerButtons(e.buttons); // clears RMB/LMB when no buttons remain
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
  const TEXT_INPUT_TYPES = new Set([
    'text', 'search', 'email', 'password', 'number', 'url', 'tel',
  ]);
  const isEditableTarget = (t) => {
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((t.type || 'text').toLowerCase());
    return false;
  };

  // Movement keys (WASD/arrows + space/shift) are forwarded to the engine, which
  // owns the pan/player-input policy. The editable-target guard + preventDefault
  // stay in JS (they need the DOM event/target).
  const onKeyDown = (e) => {
    if (isEditableTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    const key = e.key.toLowerCase();
    const code = KEY_CODE[key];
    if (code === undefined) return;
    engine?.inputKey(code, 1);
    if (key !== 'shift') e.preventDefault(); // arrows/space/wasd would scroll the page
  };
  const onKeyUp = (e) => {
    const code = KEY_CODE[e.key.toLowerCase()];
    if (code !== undefined) engine?.inputKey(code, 0);
  };
  const onBlur = () => engine?.inputClearKeys(); // avoid keys "sticking" on focus loss

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
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
  const render = (full = false) => {
    if (!engine) return;
    const renderStart = performance.now();
    // Players to overlay. A client renders host-authoritative snapshot players;
    // host/local renders the engine's own players (own = the local id, blue).
    // While the bench is paused we draw none (an empty external set) so the
    // flicker probe sees only the cell grid.
    if (testPaused) {
      engine.glSetPlayers(true, null, 0);
    } else if (net.role === 'client') {
      const ps = net.getPlayersForRender();
      const packed = new Float32Array(ps.length * 6);
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i], o = i * 6;
        packed[o] = p.x; packed[o + 1] = p.y; packed[o + 2] = p.w; packed[o + 3] = p.h;
        packed[o + 4] = p.facing; packed[o + 5] = p.id === net.ownPlayerId ? 1 : 0;
      }
      engine.glSetPlayers(true, packed, net.ownPlayerId);
    } else {
      engine.glSetPlayers(false, null, localPlayerId);
    }
    engine.glRenderFrame(full || forceFullRender);
    forceFullRender = false;
    previewDirty = false;
    const cam = engine.getCam();
    lastCamX = cam.x;
    lastCamY = cam.y;
    perfRenderMs = performance.now() - renderStart;
  };

  if (import.meta.env?.DEV && typeof window !== 'undefined') {
    window.__sandPerf = () => {
      const n = perfSampleCount;
      const sums = [];
      for (let i = 0; i < n; i++) sums.push(perfStepSamples[i] + perfRenderSamples[i]);
      sums.sort((a, b) => a - b);
      const avg = n > 0 ? sums.reduce((a, b) => a + b, 0) / n : 0;
      const p95 = n > 0 ? sums[Math.min(n - 1, Math.floor(n * 0.95))] : 0;
      const perf = engine ? engine.getPerf() : { stepMs: 0, dirtyChunks: 0 };
      return {
        stepMs: Number(perf.stepMs.toFixed(2)),
        renderMs: Number(perfRenderMs.toFixed(2)),
        avgFrameMs: Number(avg.toFixed(3)),
        p95FrameMs: Number(p95.toFixed(3)),
        samples: n,
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
      setTool(name) { currentToolName = name; engine?.setTool(TOOL[name] ?? 0); },
      setDrawMode(v) { drawModeOn = !!v; engine?.setDrawMode(drawModeOn); },
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
      host: (url, room) => netHost(url, room),
      join: (url, room) => netJoin(url, room),
      disconnect: () => netDisconnect(),
      status: () => netStatus(),
      players: () => playersForRender(),
      playerCount: () => playersForRender().length,
      ownPlayer: () => (net.role === 'client' ? net.getOwnPlayer() : localPlayer()),
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
    return { bits: engine ? engine.localInputBits() : 0, aimX: a.x, aimY: a.y, tool: TOOL[currentToolName] ?? 0 };
  };
  // Glide the camera toward the followed player's center (clamp + lerp in C++).
  // On a client the followed player is our host-authoritative snapshot entity.
  const followCamera = () => {
    const p = (net && net.role === 'client') ? net.getOwnPlayer() : localPlayer();
    if (!p || !engine) return;
    engine.cameraFollowTo(p.x + p.w / 2, p.y + p.h / 2);
  };

  // Multiplayer glue. Host runs the engine; clients render players from snapshots.
  net = createGameNet({
    getEngine: () => engine,
    getLocalInput: currentLocalInput,
    getSpawn: () => surfaceSpawn(Math.floor(cols / 2) + Math.floor((Math.random() - 0.5) * 24)),
  });
  const playersForRender = () => (net.role === 'client' ? net.getPlayersForRender() : engine.getPlayers());
  const netHost = (url, room) => net.hostRoom(url, room);
  const netJoin = (url, room) => {
    if (localPlayerId) { engine.removePlayer(localPlayerId); localPlayerId = 0; } // host owns it now
    return net.joinRoom(url, room);
  };
  const netDisconnect = () => {
    net.disconnect();
    if (survival && !localPlayerId && engine) { const sp = surfaceSpawn(Math.floor(cols / 2)); localPlayerId = engine.spawnPlayer(sp.x, sp.y); }
  };
  const netStatus = () => ({ role: net.role, connected: net.connected, remotes: net.remoteCount, ownPlayerId: net.ownPlayerId, status: net.status });

  // One fixed simulation step: world-shift + input/tool + multiplayer pump +
  // engine.step. Extracted so the main loop AND the deterministic test hook
  // (tickSteps) can drive it identically — the test path is immune to RAF
  // throttling (which otherwise makes two-context multiplayer timing flaky).
  const doFixedStep = (now) => {
    const isClient = net.role === 'client';
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
    const frameDt = Math.min(MAX_FRAME_DT, now - lastFrame);
    lastFrame = now;
    engine?.cameraPanFrame(frameDt);

    // Fixed-timestep simulation: world-shift + tool application + engine.step
    // run at STEP_MS for determinism, independent of the per-frame pan above.
    let stepped = false;
    if (now - lastStep >= STEP_MS && !testPaused) {
      stepped = doFixedStep(now);
      lastStep = now;
    }

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
    if (stepped || camMoved || previewDirty || (net.connected && net.role === 'client')) render(false);
  };
  raf = requestAnimationFrame(loop);

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    mqDpr?.removeEventListener?.('change', onDprChange);
    net?.disconnect();
    if (engine && engine.destroy) engine.destroy();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
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
    setTool(id) { currentToolName = id; engine?.setTool(TOOL[id] ?? 0); },
    setDrawMode(on) { drawModeOn = !!on; engine?.setDrawMode(drawModeOn); },
    getDrawMode() { return drawModeOn; },
    setPlayMode(on) { playMode = !!on; engine?.setPlayMode(playMode); },
    getPlayMode() { return playMode; },
    netHost(url, room) { return netHost(url, room); },
    netJoin(url, room) { return netJoin(url, room); },
    netDisconnect() { netDisconnect(); },
    netStatus() { return netStatus(); },
    destroy,
  };
}
