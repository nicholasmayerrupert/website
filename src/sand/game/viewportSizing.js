import { SIZING } from './runtimeConfig.js';

const clampMin = (v, min) => (v < min ? min : v);
const roundTo = (v, step) => Math.max(step, Math.round(v / step) * step);
const roundChunks = (n, chunkSize) => Math.ceil(n / chunkSize) * chunkSize;

export function chooseStableCssSize(rawWidth, rawHeight, prev = null, cfg = SIZING) {
  const width = clampMin(Math.floor(rawWidth || 0), 300);
  const measuredHeight = clampMin(Math.floor(rawHeight || 0), 200);
  if (!prev || !prev.height || Math.abs(width - prev.width) >= 1) return { width, height: measuredHeight };
  const threshold = cfg.stableHeightThresholdPx ?? 0;
  const height = Math.abs(measuredHeight - prev.height) >= threshold ? measuredHeight : prev.height;
  return { width, height };
}

// How many simulated cells fill the CSS box at a given logical cell size, honoring
// the min-viewport and max-cell budget (grows the cell size until under budget).
function fitCells(cssW, cssH, logicalCellPx, cfg) {
  const bucket = cfg.viewportCellBucket || 1;
  let px = logicalCellPx;
  let viewCols = 0, viewRows = 0;
  do {
    viewCols = Math.max(cfg.minViewportCols, roundTo(cssW / px, bucket));
    viewRows = Math.max(cfg.minViewportRows, roundTo(cssH / px, bucket));
    if (viewCols * viewRows <= cfg.maxViewportCells) break;
    px += 1;
  } while (px < 64);
  return { viewCols, viewRows };
}

// `zoom` scales the base logical cell size for the visible window (>1 = more
// zoomed in = fewer, larger cells). `minZoom` is the most-zoomed-out factor the
// user can reach; the BUFFER is sized for it (not the current zoom) so the sim
// buffer is constant across zoom changes — the engine/world/player survive a zoom
// (createSandGame's fit() takes its no-rebuild fast path). Defaults to `zoom` so
// legacy 4-arg callers behave exactly as before.
//
// `dprBaseline` is the devicePixelRatio captured at load. Browser page zoom (Ctrl
// +/-) changes BOTH the CSS-px box AND dpr, roughly preserving cssPx*dpr (physical
// pixels). Sizing the visible window off that physical-pixel width instead of raw
// CSS px makes the sim IGNORE browser zoom entirely: only the container size and
// the in-game zoom change how many cells are shown. Defaults to `dpr` (no
// correction) so legacy callers/tests are unchanged.
export function computeViewportSizing(cssW, cssH, dpr, cfg = SIZING, zoom = 1, minZoom = zoom, dprBaseline = dpr) {
  const safeDpr = dpr > 0 ? dpr : 1;
  const pageZoom = safeDpr / (dprBaseline > 0 ? dprBaseline : safeDpr); // 1 at load
  // Zoom-corrected ("unzoomed") CSS box used only for choosing how many cells to
  // show; the canvas backing store below still uses the REAL cssW*dpr.
  const viewCssW = cssW * pageZoom;
  const viewCssH = cssH * pageZoom;
  const base = viewCssW <= cfg.mobileMaxCssWidth ? cfg.mobileCellPx : cfg.cellPx;

  const { viewCols, viewRows } = fitCells(viewCssW, viewCssH, base * zoom, cfg);
  // Buffer reference dims: the most-zoomed-out view, so bufCols/worldRows don't
  // change when only the zoom (not the container) changes.
  const bufRef = fitCells(viewCssW, viewCssH, base * minZoom, cfg);

  const canvasW = Math.max(1, Math.round(cssW * safeDpr));
  const canvasH = Math.max(1, Math.round(cssH * safeDpr));
  const devPxPerCell = Math.max(canvasW / viewCols, canvasH / viewRows);
  // Ceil, not round: rounding down leaves viewCols*cellDev < canvasW, which shows
  // as an unpainted strip on the right/bottom (Chrome DPR buckets hit this). Ceiling
  // guarantees the cell layer always covers the backing store.
  const cellDev = Math.max(1, Math.ceil(devPxPerCell - 0.001));
  const cellSize = cssW / viewCols;

  const chunkSize = cfg.chunkSize || 32;
  let bufCols = roundChunks(bufRef.viewCols + cfg.bufferMarginCols * 2, chunkSize);
  let heightFactor = cfg.worldHeightFactor;
  let worldRows = roundChunks(Math.round(bufRef.viewRows * heightFactor), chunkSize);
  while (bufCols * worldRows > cfg.bufferMaxCells && heightFactor > 1) {
    heightFactor -= 0.25;
    worldRows = roundChunks(Math.max(bufRef.viewRows, Math.round(bufRef.viewRows * heightFactor)), chunkSize);
  }

  return {
    cssW,
    cssH,
    dpr: safeDpr,
    canvasW,
    canvasH,
    cellSize,
    cellDev,
    viewCols,
    viewRows,
    bufCols,
    worldRows,
  };
}
