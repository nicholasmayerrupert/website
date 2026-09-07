// Player animation state machine: integratePlayer picks animState from physics
// (idle/walk/run/rise/fall/swim) deterministically; the snapshot exposes it for the
// renderer. Run: node scripts/player-anim-test.mjs

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { PLAYER_ART } from '../src/sand/content/catalog.js';
import { ANIMATION_STATES } from '../src/sand/content/compile.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const AS = { IDLE: 0, WALK: 1, RUN: 2, RISE: 3, FALL: 4, WADE: 5, SWIM: 6 };
const IN = { LEFT: 1, RIGHT: 2, JUMP: 4, RUN: 64 };
const COLS = 160, ROWS = 120, FLOOR = 90;
await initSandWasm();
const { check, done } = makeChecker('player animation states');

const e = createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 1, sinksOn: false, infinite: false });
for (let x = 10; x < 150; x++) for (let y = FLOOR; y < ROWS; y++) e.addDiscToStoneDraft(x, y, 0);
e.finalizeStoneDraft();
const id = e.spawnPlayer(60, FLOOR - 9);
let tick = 0, t = 0;
const as = () => e.getPlayer(id).animState;
// Drive `bits` for n steps; return the set of animStates observed.
const drive = (bits, n) => { const seen = new Set(); for (let i = 0; i < n; i++) { e.setPlayerInput(id, { bits, seq: ++tick }); t += 16; e.step(t); seen.add(as()); } return seen; };

drive(0, 12); // land + settle
check(`idle when still (${as()})`, as() === AS.IDLE);

check('walk while moving (no run)', drive(IN.RIGHT, 20).has(AS.WALK));
check('run with the run bit at speed', drive(IN.RIGHT | IN.RUN, 25).has(AS.RUN));

drive(0, 18); // stop
check(`back to idle after stopping (${as()})`, as() === AS.IDLE);

// jump: rise while ascending, fall while descending.
const air = new Set();
for (let i = 0; i < 45; i++) { e.setPlayerInput(id, { bits: i < 3 ? IN.JUMP : 0, seq: ++tick }); t += 16; e.step(t); air.add(as()); }
check('rise while ascending after a jump', air.has(AS.RISE));
check('fall while descending', air.has(AS.FALL));

// swim: flood the player (at its CURRENT position — it drifted right while running).
drive(0, 5);
const pp = e.getPlayer(id);
for (let s = 0; s < 4; s++) e.paintDisc(Math.round(pp.x) + 2, Math.round(pp.y) + 3, 10, MAT.WATER, true);
check('swim when submerged', drive(0, 8).has(AS.SWIM));

// the frame index stays within the state's frame count (2-4).
const p = e.getPlayer(id);
check(`animFrame in range (state ${p.animState}, frame ${p.animFrame})`, p.animFrame >= 0 && p.animFrame < PLAYER_ART.clips[ANIMATION_STATES[p.animState]].frames.length);

e.destroy();
const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
