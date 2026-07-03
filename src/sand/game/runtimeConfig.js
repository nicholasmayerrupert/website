// Browser-shell policy for the drop-in sand runtime.
//
// Keep simulation, rendering, camera, player physics, tool behavior, terrain, and
// spawn placement in C++/WASM. This file is only for DOM/runtime concerns that
// cannot live in the engine: viewport sizing budgets, fixed-step cadence, and
// browser event normalization.

export const DEFAULT_TOOL = 'cube';

// Legacy tool-name bridge for old attributes/tests/network packets. Creative UI
// should prefer setCreativeMaterial(kind, value), which lets C++ route by material
// kind instead of expanding this enum.
export const TOOL_IDS = Object.freeze({
  cube: 0,
  sand: 1,
  water: 2,
  stone: 3,
  oil: 4,
  fire: 5,
  acid: 6,
  lava: 7,
  ice: 8,
  seed: 9,
  driftwood: 10,
  eraser: 11,
});

export const SIZING = Object.freeze({
  cellPx: 4,
  mobileCellPx: 3,
  mobileMaxCssWidth: 640,
  minViewportCols: 60,
  minViewportRows: 28,
  viewportCellBucket: 4,
  stableHeightThresholdPx: 48,
  maxViewportCells: 130000,
  toolCollapseWidth: 1300,
  chunkSize: 32,
  worldHeightFactor: 2.5,
  bufferMarginCols: 128,
  bufferMaxCells: 520000,
  maxFrameDtMs: 50,
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
