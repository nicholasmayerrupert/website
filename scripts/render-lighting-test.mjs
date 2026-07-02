// Render-only lighting smoke tests. These assert the visual pixel output, not an
// exported light buffer, so lighting stays outside the ABI/protocol/save state.

import { initSandWasm, createEngineWasm } from '../src/sand/engineWasm.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 96, ROWS = 96;
const k = (x, y) => y * COLS + x;

await initSandWasm();
const { check, done } = makeChecker('render-only lighting');
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0x1eed, sinksOn: false, infinite: false });

function brightness(e, x, y) {
  const p = e.getRenderPixels();
  const i = k(x, y) * 4;
  return (p[i] + p[i + 1] + p[i + 2]) / 3;
}

function fillStone(e, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
}

function carve(e, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.eraseDisc(x, y, 0);
}

// Empty shaft from the top lights exposed deep stone faces.
{
  const e = mk();
  fillStone(e, 8, 8, 87, 88);
  carve(e, 45, 0, 50, 78);
  e.renderFull();
  const shaftFace = brightness(e, 44, 70);
  const sealed = brightness(e, 20, 70);
  check(`deep shaft face is brighter than sealed stone (${shaftFace.toFixed(1)} > ${sealed.toFixed(1)})`, shaftFace > sealed + 35);
  e.destroy();
}

// A sealed cave remains dark compared with the outside-lit surface.
{
  const e = mk();
  fillStone(e, 8, 8, 87, 88);
  carve(e, 38, 44, 57, 61);
  e.renderFull();
  const surface = brightness(e, 40, 8);
  const caveFloor = brightness(e, 45, 62);
  check(`sealed cave wall is dark (${caveFloor.toFixed(1)} < ${surface.toFixed(1)})`, caveFloor + 45 < surface);
  e.destroy();
}

// FIRE and LAVA brighten nearby cells even inside sealed space.
{
  const e = mk();
  fillStone(e, 8, 8, 87, 88);
  carve(e, 35, 42, 60, 62);
  e.paintDisc(40, 52, 0, MAT.FIRE, true);
  e.paintDisc(53, 52, 0, MAT.LAVA, true);
  e.renderFull();
  const nearFire = brightness(e, 34, 52);
  const nearLava = brightness(e, 61, 52);
  const farWall = brightness(e, 20, 52);
  check(`fire brightens nearby wall (${nearFire.toFixed(1)} > ${farWall.toFixed(1)})`, nearFire > farWall + 25);
  check(`lava brightens nearby wall (${nearLava.toFixed(1)} > ${farWall.toFixed(1)})`, nearLava > farWall + 15);
  e.destroy();
}

// Light decays quickly through solid material.
{
  const e = mk();
  fillStone(e, 16, 8, 79, 88);
  e.renderFull();
  const exposed = brightness(e, 32, 8);
  const deep = brightness(e, 32, 18);
  check(`solid wall darkens within a few cells (${deep.toFixed(1)} < ${exposed.toFixed(1)})`, deep + 60 < exposed);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
