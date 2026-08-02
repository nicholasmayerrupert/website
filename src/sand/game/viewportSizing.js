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

// How many simulated cells fill the CSS box at a given logical cell size.
function fitCells(cssW, cssH, logicalCellPx, cfg) {
  const bucket = cfg.viewportCellBucket || 1;
  const px = Math.max(1e-6, logicalCellPx);
  const viewCols = Math.max(cfg.minViewportCols, roundTo(cssW / px, bucket));
  const viewRows = Math.max(cfg.minViewportRows, roundTo(cssH / px, bucket));
  return { viewCols, viewRows };
}

// `zoom` scales the base logical cell size for the visible window (>1 = more
// zoomed in = fewer, larger cells; <1 = zoomed out = more cells). The simulation
// buffer is sized from the CURRENT zoom (view + margins), so closer zoom keeps a
// smaller loaded window and better step cost; far zoom grows the buffer.
//
// `dprBaseline` is the devicePixelRatio captured at load. Browser page zoom (Ctrl
// +/-) changes BOTH the CSS-px box AND dpr, roughly preserving cssPx*dpr (physical
// pixels). Sizing the visible window off that physical-pixel width instead of raw
// CSS px makes the sim IGNORE browser zoom entirely: only the container size and
// the in-game zoom change how many cells are shown. Defaults to `dpr` (no
// correction) so legacy callers/tests are unchanged.
//
// The 6th argument was previously `minZoom` (buffer pinned to most-zoomed-out).
// It is ignored when present so old call sites keep working.
export function computeViewportSizing(cssW, cssH, dpr, cfg = SIZING, zoom = 1, _minZoomIgnored = zoom, dprBaseline = dpr, maxBufferDimension = 0) {
  void _minZoomIgnored; // retained only to preserve the legacy positional API
  const safeDpr = dpr > 0 ? dpr : 1;
  const pageZoom = safeDpr / (dprBaseline > 0 ? dprBaseline : safeDpr); // 1 at load
  // Zoom-corrected ("unzoomed") CSS box used only for choosing how many cells to
  // show; the canvas backing store below still uses the REAL cssW*dpr.
  const viewCssW = cssW * pageZoom;
  const viewCssH = cssH * pageZoom;
  const base = viewCssW <= cfg.mobileMaxCssWidth ? cfg.mobileCellPx : cfg.cellPx;

  const chunkSize = cfg.chunkSize || 32;
  const marginCols = cfg.bufferMarginCols ?? 128;
  const marginRows = cfg.bufferMarginRows ?? 96;
  const sizeAtZoom = (candidateZoom) => {
    const view = fitCells(viewCssW, viewCssH, base * candidateZoom, cfg);
    let bufCols = roundChunks(view.viewCols + marginCols * 2, chunkSize);
    let heightFactor = cfg.worldHeightFactor ?? 2.5;
    let verticalMarginRows = marginRows;
    const minVerticalMarginRows = Math.min(
      marginRows,
      cfg.minBufferMarginRows ?? marginRows,
    );
    const fitWorldRows = () => roundChunks(
      Math.max(
        view.viewRows + verticalMarginRows * 2,
        Math.round(view.viewRows * heightFactor),
      ),
      chunkSize,
    );
    let worldRows = fitWorldRows();
    const softMax = cfg.bufferMaxCells ?? 0;
    if (softMax > 0) {
      while (bufCols * worldRows > softMax
          && (heightFactor > 1 || verticalMarginRows > minVerticalMarginRows)) {
        if (heightFactor > 1) heightFactor = Math.max(1, heightFactor - 0.25);
        else verticalMarginRows = Math.max(
          minVerticalMarginRows,
          verticalMarginRows - chunkSize,
        );
        worldRows = fitWorldRows();
      }
    }
    return { ...view, bufCols, worldRows };
  };

  let effectiveZoom = Math.max(1e-6, zoom);
  let fitted = sizeAtZoom(effectiveZoom);
  const textureLimit = Math.floor(maxBufferDimension / chunkSize) * chunkSize;
  // Each layer is one cols x rows WebGL texture. Stop zooming out only when a
  // dimension would exceed the device's actual texture limit.
  if (textureLimit >= chunkSize) {
    const exceedsLimit = () => fitted.bufCols > textureLimit || fitted.worldRows > textureLimit;
    for (let i = 0; i < 8 && exceedsLimit(); i++) {
      const scale = Math.max(fitted.bufCols / textureLimit, fitted.worldRows / textureLimit);
      effectiveZoom *= Math.max(1.01, scale * 1.002);
      fitted = sizeAtZoom(effectiveZoom);
    }
  }
  const { viewCols, viewRows, bufCols, worldRows } = fitted;

  const canvasW = Math.max(1, Math.round(cssW * safeDpr));
  const canvasH = Math.max(1, Math.round(cssH * safeDpr));
  // Fractional device-px per cell when zoomed out past 1 px/cell (multiple cells
  // per device pixel). When zoomed in, ceil so the cell layer covers the canvas
  // (integer path preserves the sub-cell pan flicker fix).
  const rawDev = Math.max(canvasW / viewCols, canvasH / viewRows);
  let cellDev;
  if (rawDev >= 1) {
    cellDev = Math.max(1, Math.ceil(rawDev - 0.001));
  } else {
    cellDev = Math.max(1e-3, rawDev);
  }
  const cellSize = cssW / viewCols;

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
    zoom: effectiveZoom,
  };
}

// Whether desired buffer dims differ enough from the live engine to justify a
// world-preserving realloc (hysteresis + always-grow when the view no longer fits).
export function shouldResizeBuffer(curCols, curRows, wantCols, wantRows, viewCols, viewRows, cfg = SIZING) {
  if (!curCols || !curRows) return true;
  // Always grow if the visible window (+ small stream margin) no longer fits.
  const edge = 48;
  if (viewCols + edge * 2 > curCols || viewRows + edge * 2 > curRows) return true;
  if (wantCols === curCols && wantRows === curRows) return false;
  const hyst = cfg.bufferResizeHysteresis ?? 0.12;
  const chunk = cfg.chunkSize || 32;
  const dCols = Math.abs(wantCols - curCols);
  const dRows = Math.abs(wantRows - curRows);
  if (dCols < chunk && dRows < chunk) return false;
  return dCols > curCols * hyst || dRows > curRows * hyst;
}
