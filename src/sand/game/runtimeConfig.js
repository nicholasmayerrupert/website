// Browser-shell policy for the drop-in sand runtime.
//
// Keep simulation, rendering, camera, player physics, tool behavior, terrain, and
// spawn placement in C++/WASM. This file is only for DOM/runtime concerns that
// cannot live in the engine: viewport sizing budgets, fixed-step cadence, and
// browser event normalization.

import { TOOL } from '../wasmBridge/abi.generated.js';

export const DEFAULT_TOOL = 'cube';

// Legacy tool-name bridge for old attributes/tests/network packets — ids come
// from the generated ABI manifest. Creative UI should prefer
// setCreativeMaterial(kind, value), which lets C++ route by material kind
// instead of expanding this enum.
export const TOOL_IDS = Object.freeze(
  Object.fromEntries(Object.entries(TOOL).map(([name, id]) => [name.toLowerCase(), id])),
);

export const SIZING = Object.freeze({
  // Base CSS px per simulated cell (higher = more zoomed in / fewer cells). This
  // is the DEFAULT zoom; `zoom` multiplies it at runtime.
  cellPx: 5.5,
  mobileCellPx: 3.25,
  mobileMaxCssWidth: 640,
  minViewportCols: 60,
  minViewportRows: 28,
  viewportCellBucket: 4,
  stableHeightThresholdPx: 48,
  // Soft advisory only — the view may exceed this when zoomed out (perf hit accepted).
  maxViewportCells: 130000,
  toolCollapseWidth: 1300,
  chunkSize: 32,
  worldHeightFactor: 2.5,
  // Loaded sim window padding around the visible view (cells). Buffer grows/shrinks
  // with the current zoom; these margins keep streaming/prefetch runway.
  bufferMarginCols: 128,
  bufferMarginRows: 96,
  // Soft advisory for total buffer cells (no hard clamp — extreme zoom-out is allowed).
  bufferMaxCells: 520000,
  maxFrameDtMs: 50,
  // Fixed-timestep catch-up cap: the max number of STEP_MS sim steps the main loop
  // will run in a single frame to catch up on elapsed real time. Bounds the work a
  // long/heavy frame can trigger (no catch-up avalanche); past it the sim degrades to
  // slow-motion instead of freezing. 2 * STEP_MS(16) = ~32ms of catch-up per frame.
  maxCatchupSteps: 2,
  // Continuous zoom: multiplier on cellPx. 1 = default density; >1 = zoomed in
  // (fewer, larger cells); <1 = zoomed out (more cells, larger sim buffer).
  // No hard zoom-out floor — only a tiny epsilon to avoid division by zero.
  zoomDefault: 1.0,
  zoomInMax: 8,
  zoomOutMin: 0.05,
  zoomStepFactor: 1.15,
  // Realloc the loaded window only when desired buffer dims change by this much
  // (fraction of current size) or by at least one chunk — avoids thrashing on
  // every +/- click while still tracking zoom for sim cost.
  bufferResizeHysteresis: 0.12,
});

export const STEP_MS = 16;

// Physical browser keys -> Engine InputKey codes.
export const KEY_CODES = Object.freeze({
  a: 0,
  arrowleft: 0,
  d: 1,
  arrowright: 1,
  w: 2,
  arrowup: 2,
  s: 3,
  arrowdown: 3,
  ' ': 4,
  shift: 5,
});

export const BUTTON_BITS = Object.freeze({
  0: 1,
  2: 2,
});

export const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'password',
  'number',
  'url',
  'tel',
]);
