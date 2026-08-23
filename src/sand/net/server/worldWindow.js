// Keep one chunk-aligned authoritative window around every connected player's
// requested survival view. The C++ engine persists leaving terrain in its chunk
// store, so moving/resizing this shared window is the same operation used by the
// offline authority worker.

import { ENGINE_MAX_CELLS, ENGINE_MAX_DIMENSION } from '../../engineLimits.js';

const CHUNK = 32;
const SHRINK_HYSTERESIS = 0.12;

const alignUp = (n) => Math.ceil((n - 1e-6) / CHUNK) * CHUNK;
const alignDown = (n) => Math.floor(n / CHUNK) * CHUNK;

function clampWindowSize(cols, rows) {
  let nextCols = Math.min(ENGINE_MAX_DIMENSION, Math.max(CHUNK, alignUp(cols)));
  let nextRows = Math.min(ENGINE_MAX_DIMENSION, Math.max(CHUNK, alignUp(rows)));
  while (nextCols * nextRows > ENGINE_MAX_CELLS) {
    if (nextCols >= nextRows) nextCols = Math.max(CHUNK, nextCols - CHUNK);
    else nextRows = Math.max(CHUNK, nextRows - CHUNK);
  }
  return { cols: nextCols, rows: nextRows };
}

export function syncWorldWindow(engine, peers) {
  const players = new Map(engine.getPlayers().map((p) => [p.id, p]));
  const offX = engine.getWorldOffsetX(), offY = engine.getWorldOffsetY();
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  let viewCols = 1, viewRows = 1;

  for (const peer of peers.values()) {
    const p = players.get(peer.pid);
    if (!p || !peer.view) continue;
    const cx = offX + p.x + p.w * 0.5, cy = offY + p.y + p.h * 0.5;
    left = Math.min(left, cx - peer.view.bufferCols * 0.5);
    right = Math.max(right, cx + peer.view.bufferCols * 0.5);
    top = Math.min(top, cy - peer.view.bufferRows * 0.5);
    bottom = Math.max(bottom, cy + peer.view.bufferRows * 0.5);
    viewCols = Math.max(viewCols, peer.view.viewCols);
    viewRows = Math.max(viewRows, peer.view.viewRows);
  }
  if (!Number.isFinite(left)) return false;

  const centerX = (left + right) * 0.5, centerY = (top + bottom) * 0.5;
  const positionCamera = () => {
    const cols = Math.min(viewCols, engine.cols), rows = Math.min(viewRows, engine.rows);
    engine.setViewport(1, 1, cols, rows);
    engine.cameraSet(
      centerX - engine.getWorldOffsetX() - cols * 0.5,
      centerY - engine.getWorldOffsetY() - rows * 0.5,
    );
  };
  const wanted = clampWindowSize(right - left, bottom - top);
  const wantedCols = wanted.cols, wantedRows = wanted.rows;
  const grow = wantedCols > engine.cols || wantedRows > engine.rows;
  const shrink = engine.cols - wantedCols > Math.max(CHUNK, engine.cols * SHRINK_HYSTERESIS) ||
    engine.rows - wantedRows > Math.max(CHUNK, engine.rows * SHRINK_HYSTERESIS);
  if (grow || shrink) {
    positionCamera();
    if (engine.resizeLoadedWindow(wantedCols, wantedRows)) { positionCamera(); return true; }
  }

  const targetX = alignDown((left + right - engine.cols) * 0.5);
  const targetY = alignDown((top + bottom - engine.rows) * 0.5);
  let dx = targetX - engine.getWorldOffsetX(), dy = targetY - engine.getWorldOffsetY();
  if (left >= engine.getWorldOffsetX() && right <= engine.getWorldOffsetX() + engine.cols) dx = 0;
  if (top >= engine.getWorldOffsetY() && bottom <= engine.getWorldOffsetY() + engine.rows) dy = 0;
  if (!dx && !dy) { positionCamera(); return false; }

  // shiftLayer is intentionally one-axis and requires a shift smaller than the
  // live dimension. Ordinary travel needs one iteration; the loop also handles
  // teleports without inventing a separate world-loading path.
  while (dx) {
    const step = Math.max(-engine.cols + CHUNK, Math.min(engine.cols - CHUNK, dx));
    engine.shiftWorld(step); dx -= step;
  }
  while (dy) {
    const step = Math.max(-engine.rows + CHUNK, Math.min(engine.rows - CHUNK, dy));
    engine.shiftWorldXY(0, step); dy -= step;
  }
  positionCamera();
  return true;
}
