// FNV-1a hash of a byte grid, used to detect host/client world divergence and
// trigger resyncs. Order-dependent and stable across machines.
export function gridHashU8(grid) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < grid.length; i++) {
    h ^= grid[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
