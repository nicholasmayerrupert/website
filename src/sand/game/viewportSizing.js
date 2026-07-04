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

export function computeViewportSizing(cssW, cssH, dpr, cfg = SIZING) {
  const safeDpr = dpr > 0 ? dpr : 1;
  let logicalCellPx = cssW <= cfg.mobileMaxCssWidth ? cfg.mobileCellPx : cfg.cellPx;
  const bucket = cfg.viewportCellBucket || 1;
  let viewCols = 0, viewRows = 0;
  do {
    viewCols = Math.max(cfg.minViewportCols, roundTo(cssW / logicalCellPx, bucket));
    viewRows = Math.max(cfg.minViewportRows, roundTo(cssH / logicalCellPx, bucket));
    if (viewCols * viewRows <= cfg.maxViewportCells) break;
    logicalCellPx += 1;
  } while (logicalCellPx < 64);

  const canvasW = Math.max(1, Math.round(cssW * safeDpr));
  const canvasH = Math.max(1, Math.round(cssH * safeDpr));
  const devPxPerCell = Math.max(canvasW / viewCols, canvasH / viewRows);
  // Ceil, not round: rounding down leaves viewCols*cellDev < canvasW, which shows
  // as an unpainted strip on the right/bottom (Chrome DPR buckets hit this). Ceiling
  // guarantees the cell layer always covers the backing store.
  const cellDev = Math.max(1, Math.ceil(devPxPerCell - 0.001));
  const cellSize = cssW / viewCols;

  const chunkSize = cfg.chunkSize || 32;
  let bufCols = roundChunks(viewCols + cfg.bufferMarginCols * 2, chunkSize);
  let heightFactor = cfg.worldHeightFactor;
  let worldRows = roundChunks(Math.round(viewRows * heightFactor), chunkSize);
  while (bufCols * worldRows > cfg.bufferMaxCells && heightFactor > 1) {
    heightFactor -= 0.25;
    worldRows = roundChunks(Math.max(viewRows, Math.round(viewRows * heightFactor)), chunkSize);
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
