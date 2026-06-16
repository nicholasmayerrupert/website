// Shared helpers for the headless engine tests. Keep these tiny and dependency
// free so sand/player/net tests can all import them.

export const MAT_COUNT = 16;

// Count cells of each material id in a grid view.
export function countMaterials(grid) {
  const c = new Array(MAT_COUNT).fill(0);
  for (let i = 0; i < grid.length; i++) c[grid[i]]++;
  return c;
}

// Order-independent FNV-1a hash of a grid view (fixed-seed determinism checks).
export function gridHash(grid) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < grid.length; i++) {
    h ^= grid[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Step an engine n times with a fixed dt (engine uses a fixed internal timestep;
// the time arg is advanced only for tool-emit throttling parity).
export function runSteps(engine, n, dt = 16) {
  let t = 0;
  for (let i = 0; i < n; i++) { t += dt; engine.step(t); }
  return t;
}

// Approximate equality for floating player coordinates.
export function approxEqual(a, b, eps = 1e-3) { return Math.abs(a - b) <= eps; }

// Minimal test harness: returns { check, done } and tracks failures.
export function makeChecker(label) {
  if (label) console.log(label);
  let failures = 0;
  const check = (name, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`); };
  const done = () => failures;
  return { check, done, get failures() { return failures; } };
}
