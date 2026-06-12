// Seedable PRNG + grid hashing used by the sand engine benchmark.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a over a Uint8Array -> 8-char hex string.
export function hashGrid(grid) {
  let h = 0x811c9dc5;
  for (let i = 0; i < grid.length; i++) {
    h ^= grid[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
