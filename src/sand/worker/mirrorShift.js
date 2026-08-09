import { isValidWorldDiff, maxWorldDiffBytes } from '../worldPacketValidation.js';

function shiftGridInPlace(grid, cols, rows, dx, dy) {
  if (dx) {
    const amount = Math.abs(dx);
    for (let y = 0; y < rows; y++) {
      const row = y * cols;
      if (dx > 0) {
        grid.copyWithin(row, row + amount, row + cols);
        grid.fill(0, row + cols - amount, row + cols);
      } else {
        grid.copyWithin(row + amount, row, row + cols - amount);
        grid.fill(0, row, row + amount);
      }
    }
  }
  if (dy) {
    const band = Math.abs(dy) * cols;
    const cells = cols * rows;
    if (dy > 0) {
      grid.copyWithin(0, band, cells);
      grid.fill(0, cells - band, cells);
    } else {
      grid.copyWithin(band, 0, cells - band);
      grid.fill(0, 0, band);
    }
  }
}

// Validate the incoming band before changing either mirror layer. The native
// diff application validates again, but it runs after this coordinate shift.
export function prepareMirrorShift(engine, packet, bytes) {
  const cols = packet?.cols;
  const rows = packet?.rows;
  const dx = packet?.shiftDx;
  const dy = packet?.shiftDy;
  if (!engine || engine.cols !== cols || engine.rows !== rows
      || !Number.isInteger(dx) || !Number.isInteger(dy) || (!dx && !dy)
      || (!!dx === !!dy)
      || Math.abs(dx) >= cols || Math.abs(dy) >= rows
      || !Number.isInteger(packet.worldOffsetX) || !Number.isInteger(packet.worldOffsetY)
      || !(bytes instanceof Uint8Array) || bytes.length > maxWorldDiffBytes(cols * rows)
      || !isValidWorldDiff(bytes, cols, rows)) return false;
  shiftGridInPlace(engine.getGrid(), cols, rows, dx, dy);
  shiftGridInPlace(engine.getGridBg(), cols, rows, dx, dy);
  engine.setMirrorWorldOffset(packet.worldOffsetX, packet.worldOffsetY);
  return true;
}
