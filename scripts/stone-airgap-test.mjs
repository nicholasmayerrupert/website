// Regression: a single solid draft that drops PHYSICALLY-DISCONNECTED blobs (what
// a fast cursor produces — air gaps between brush stamps) must let each unsupported
// blob fall on its own, even when another blob placed in the SAME draft is grounded.
//
// Before the fix, stone/ice finalized the whole draft as ONE rigid component, so a
// single grounded blob set the component's grounded flag and the floating blobs were
// frozen in mid-air. Driftwood already did the right thing (flood-fill registration);
// this asserts stone and ice now match. Run: node scripts/stone-airgap-test.mjs
import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';

const COLS = 200, ROWS = 120, SEED = 0xC0FFEE;
await initSandWasm();
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: SEED, sinksOn: false });
const run = (e, n) => { let t = 0; for (let i = 0; i < n; i++) { t += 16; e.step(t); } };
// topmost (min) row holding `mat` within column band [x0,x1]; ROWS if none.
const topRowIn = (g, mat, x0, x1) => {
  let top = ROWS;
  for (let y = 0; y < ROWS; y++) for (let x = x0; x <= x1; x++) if (g[y * COLS + x] === mat) { top = y; y = ROWS; break; }
  return top;
};
const countIn = (g, mat, x0, x1) => { let n = 0; for (let y = 0; y < ROWS; y++) for (let x = x0; x <= x1; x++) if (g[y * COLS + x] === mat) n++; return n; };

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

// mat: 3=STONE, draft adder + finalizer chosen per material.
function scenario(name, mat, addDraft, finalize) {
  console.log(name);
  const e = mk();
  // Grounded blob: a disc resting on the floor near the left.
  addDraft(e, 40, 117, 3);
  // Floating blob: a disc in open air on the right, separated by a wide air gap.
  addDraft(e, 150, 30, 3);
  finalize(e);
  const g0 = e.getGrid();
  const floatTop0 = topRowIn(g0, mat, 140, 160);
  const groundCount0 = countIn(g0, mat, 30, 50);
  const floatCount0 = countIn(g0, mat, 140, 160);
  check(`both blobs placed (ground ${groundCount0}, float ${floatCount0})`, groundCount0 > 0 && floatCount0 > 0);
  check(`float blob starts in the air (top row ${floatTop0})`, floatTop0 < 50);

  run(e, 300);
  const g = e.getGrid();
  const floatTop = topRowIn(g, mat, 140, 160);
  const groundTop = topRowIn(g, mat, 30, 50);
  // The floating blob must have dropped to the floor; the grounded blob stays put.
  check(`unsupported blob fell to the floor (top ${floatTop0} -> ${floatTop})`, floatTop >= ROWS - 10);
  check(`grounded blob stayed near the floor (top ${groundTop})`, groundTop >= ROWS - 12);
  check(`material conserved (float ${floatCount0} -> ${countIn(g, mat, 140, 160)})`, countIn(g, mat, 140, 160) === floatCount0);
  e.destroy();
}

scenario('stone: disconnected draft, one grounded one floating', 3,
  (e, x, y, r) => e.addDiscToStoneDraft(x, y, r), (e) => e.finalizeStoneDraft());

// ICE (mat 12) shares registerRigidCellsSplit via its own draft set.
scenario('ice: disconnected draft, one grounded one floating', 12,
  (e, x, y, r) => e.addDiscToIceDraft(x, y, r), (e) => e.finalizeIceDraft());

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
