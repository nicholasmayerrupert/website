// Render-only lighting smoke tests. These assert the visual pixel output, not an
// exported light buffer, so lighting stays outside the ABI/protocol/save state.

import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { MAT } from '../src/sand/materials.js';
import { INPUT, PROJECTILE_KIND } from '../src/sand/wasmBridge/abi.generated.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { NIGHT_SKY_LIGHT, NOON_SKY_LIGHT } from '../src/sand/game/dayNightCycle.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 96, ROWS = 96;
const k = (x, y) => y * COLS + x;

await initSandWasm();
const { check, done } = makeChecker('render-only lighting');
const mk = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0x1eed, sinksOn: false, infinite: false });
const mkInfinite = () => createEngineWasm({ cols: COLS, rows: ROWS, worldSeed: 0x1eed, sinksOn: false, infinite: true });

function brightness(e, x, y) {
  const p = e.getRenderPixels();
  const i = k(x, y) * 4;
  return (p[i] + p[i + 1] + p[i + 2]) / 3;
}

function brightnessLayer(e, layer, x, y) {
  const p = e.getRenderPixelsLayer(layer);
  const i = k(x, y) * 4;
  return (p[i] + p[i + 1] + p[i + 2]) / 3;
}

function fillStone(e, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
}

function carve(e, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.eraseDisc(x, y, 0);
}

function fillStoneLayer(e, layer, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.paintDiscLayer(layer, x, y, 0, MAT.STONE, true);
}

function carveLayer(e, layer, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) e.eraseDiscLayer(layer, x, y, 0);
}

function sealedActorCave(e) {
  e.setSkyLight(0);
  fillStone(e, 8, 8, 87, 88);
  carve(e, 30, 38, 65, 66);
}

// Empty shaft from the top lights exposed deep stone faces.
{
  const e = mk();
  fillStone(e, 8, 8, 87, 88);
  carve(e, 45, 0, 50, 78);
  e.renderFull();
  const shaftFace = brightness(e, 44, 70);
  const topFace = brightness(e, 44, 8);
  const sealed = brightness(e, 20, 70);
  check(`deep shaft face is brighter than sealed stone (${shaftFace.toFixed(1)} > ${sealed.toFixed(1)})`, shaftFace > sealed + 35);
  check(`open shaft keeps sky-contact faces bright down the shaft (${shaftFace.toFixed(1)} ~= ${topFace.toFixed(1)})`, Math.abs(shaftFace - topFace) < 10);
  e.destroy();
}

// A winding cave connected to the entrance gets lossy bounce, not full skylight.
{
  const e = mk();
  fillStone(e, 8, 8, 87, 88);
  carve(e, 45, 0, 50, 22);
  carve(e, 20, 22, 80, 30);
  e.renderFull();
  const shaftFace = brightness(e, 44, 18);
  const farCaveFace = brightness(e, 20, 31);
  check(`side cave falls off instead of inheriting full sky (${farCaveFace.toFixed(1)} << ${shaftFace.toFixed(1)})`, farCaveFace + 50 < shaftFace);
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
  check(`unlit cave keeps a dramatic ambient floor (${caveFloor.toFixed(1)} < 15)`, caveFloor < 15);
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

// CRYSTAL and mycelium are mild emissive blocks: visible in sealed caves without
// behaving like fire/lava-level light sources.
{
  const base = mk();
  base.setSkyLight(0);
  fillStone(base, 8, 8, 87, 88);
  carve(base, 35, 42, 60, 62);
  base.renderFull();
  const farWall = brightness(base, 20, 52);
  base.destroy();

  const crystal = mk();
  crystal.setSkyLight(0);
  fillStone(crystal, 8, 8, 87, 88);
  carve(crystal, 35, 42, 60, 62);
  crystal.paintDisc(36, 52, 0, MAT.CRYSTAL, true);
  crystal.renderFull();
  const nearCrystal = brightness(crystal, 34, 52);
  check(`crystal mildly lights a sealed cave (${nearCrystal.toFixed(1)} > ${farWall.toFixed(1)})`, nearCrystal > farWall + 18);
  crystal.destroy();

  const myc = mk();
  myc.setSkyLight(0);
  fillStone(myc, 8, 8, 87, 88);
  carve(myc, 35, 42, 60, 62);
  myc.paintDisc(36, 52, 1, MAT.MYCELIUM, true);
  myc.paintDisc(36, 52, 0, MAT.MYCELIUM_SPORE, true);
  myc.renderFull();
  const nearMyc = brightness(myc, 34, 52);
  check(`mycelium dimly lights a sealed cave (${nearMyc.toFixed(1)} > ${farWall.toFixed(1)})`, nearMyc > farWall + 8);
  myc.destroy();
}

// Moving entities seed the same terrain-aware light flood as emissive
// materials. Collect the render-only sources without needing a GL context, then
// assert that each source illuminates the surrounding cave wall.
{
  const base = mk();
  sealedActorCave(base);
  base.renderFull();
  const darkWall = brightness(base, 66, 52);
  base.destroy();

  const shield = attachTestHooks(mk());
  sealedActorCave(shield);
  const id = shield.spawnPlayer(42, 48);
  shield.setPlayerInput(id, {
    bits: INPUT.SHIELD, aimX: 75, aimY: 52, seq: 1,
  });
  shield.stepActors();
  const sources = shield._collectDynamicLights();
  shield.renderFull();
  const litWall = brightness(shield, 66, 52);
  check(`raised shield emits terrain light (${litWall.toFixed(1)} > ${darkWall.toFixed(1)})`,
    sources === 1 && litWall > darkWall + 30);
  shield.setPlayerInput(id, { bits: 0, aimX: 75, aimY: 52, seq: 2 });
  shield.stepActors();
  const clearedSources = shield._collectDynamicLights();
  shield.renderFull();
  const clearedWall = brightness(shield, 66, 52);
  check('lowering the shield removes its terrain light',
    clearedSources === 0 && Math.abs(clearedWall - darkWall) < 2);
  shield.destroy();
}

{
  const base = mk();
  sealedActorCave(base);
  base.renderFull();
  const darkWall = brightness(base, 66, 52);
  base.destroy();

  const mining = attachTestHooks(mk());
  sealedActorCave(mining);
  mining.setSurvivalInventory(true);
  const id = mining.spawnPlayer(42, 48);
  mining.setSelectedSlot(id, 1);
  mining.setPlayerInput(id, {
    bits: INPUT.PRIMARY, aimX: 62, aimY: 52, seq: 1,
  });
  mining.stepActors();
  const sources = mining._collectDynamicLights();
  mining.renderFull();
  const litWall = brightness(mining, 66, 52);
  check(`mining tool lights terrain around the cursor (${litWall.toFixed(1)} > ${darkWall.toFixed(1)})`,
    sources === 1 && litWall > darkWall + 30);
  mining.destroy();
}

{
  const base = mk();
  sealedActorCave(base);
  base.renderFull();
  const darkWall = brightness(base, 40, 67);
  base.destroy();

  const jetpack = attachTestHooks(mk());
  sealedActorCave(jetpack);
  const id = jetpack.spawnPlayer(40, 51);
  const p = jetpack.getPlayer(id);
  jetpack.setPlayerState(id, {
    ...p, x: 40, y: 51, vx: 0, vy: 0, grounded: false,
  });
  jetpack.setPlayerInput(id, {
    bits: INPUT.JETPACK, aimX: 70, aimY: 54, seq: 1,
  });
  jetpack.stepActors();
  const sources = jetpack._collectDynamicLights();
  jetpack.renderFull();
  const litWall = brightness(jetpack, 40, 67);
  check(`active jetpack emits terrain light (${litWall.toFixed(1)} > ${darkWall.toFixed(1)})`,
    jetpack.getPlayer(id).jetpackActive && sources === 1 &&
      litWall > darkWall + 30);
  jetpack.destroy();
}

{
  const base = mk();
  sealedActorCave(base);
  base.renderFull();
  const darkWall = brightness(base, 66, 52);
  base.destroy();

  const projectile = attachTestHooks(mk());
  sealedActorCave(projectile);
  projectile.setSurvivalInventory(true);
  const id = projectile.spawnPlayer(36, 48);
  projectile.setPlayerInput(id, {
    bits: INPUT.PRIMARY, aimX: 62, aimY: 52, seq: 1,
  });
  projectile.stepActors();
  const round = projectile.getProjectiles().find((p) =>
    p.kind === PROJECTILE_KIND.BLAST_ROUND);
  const sources = projectile._collectDynamicLights();
  projectile.renderFull();
  const litWall = brightness(projectile, 66, 52);
  check(`blast projectile emits terrain light (${litWall.toFixed(1)} > ${darkWall.toFixed(1)})`,
    round && sources === 1 && litWall > darkWall + 35);
  projectile.destroy();
}

// Cross-layer FIRE/LAVA seed emissive light into the opposite layer. Skylight is
// disabled here so the baseline is ambient-only, not cross-layer sky import.
{
  const base = mk();
  base.setSkyLight(0);
  fillStoneLayer(base, 1, 8, 8, 87, 88);
  base.renderFullLayer(1);
  const bgAmbient = brightnessLayer(base, 1, 48, 52);
  base.destroy();

  const lit = mk();
  lit.setSkyLight(0);
  fillStoneLayer(lit, 1, 8, 8, 87, 88);
  lit.paintDisc(48, 52, 0, MAT.FIRE, true);
  lit.renderFullLayer(1);
  const bgLit = brightnessLayer(lit, 1, 48, 52);
  check(`foreground fire brightens background stone (${bgLit.toFixed(1)} > ${bgAmbient.toFixed(1)})`, bgLit > bgAmbient + 35);
  lit.destroy();
}

{
  const base = mk();
  base.setSkyLight(0);
  fillStone(base, 8, 8, 87, 88);
  base.setBgEnabled(true);
  base.renderFull();
  const fgAmbient = brightness(base, 48, 52);
  base.destroy();

  const lit = mk();
  lit.setSkyLight(0);
  fillStone(lit, 8, 8, 87, 88);
  lit.paintDiscLayer(1, 48, 52, 0, MAT.LAVA, true);
  lit.renderFull();
  const fgLit = brightness(lit, 48, 52);
  check(`background lava brightens foreground stone (${fgLit.toFixed(1)} > ${fgAmbient.toFixed(1)})`, fgLit > fgAmbient + 35);
  lit.destroy();
}

// Cross-layer light should travel through open space in the source layer instead
// of dying immediately inside solid target-layer backdrop.
{
  const base = mk();
  base.setSkyLight(0);
  fillStone(base, 8, 8, 87, 88);
  carve(base, 28, 48, 66, 56);
  fillStoneLayer(base, 1, 8, 8, 87, 88);
  base.renderFullLayer(1);
  const farAmbient = brightnessLayer(base, 1, 62, 52);
  base.destroy();

  const lit = mk();
  lit.setSkyLight(0);
  fillStone(lit, 8, 8, 87, 88);
  carve(lit, 28, 48, 66, 56);
  fillStoneLayer(lit, 1, 8, 8, 87, 88);
  lit.paintDisc(30, 52, 0, MAT.FIRE, true);
  lit.renderFullLayer(1);
  const farBgWall = brightnessLayer(lit, 1, 62, 52);
  check(`foreground fire carries through foreground tunnel to background wall (${farBgWall.toFixed(1)} > ${farAmbient.toFixed(1)})`,
    farBgWall > farAmbient + 20);
  lit.destroy();
}

{
  const blocked = mk();
  fillStone(blocked, 8, 8, 87, 88);
  fillStoneLayer(blocked, 1, 8, 8, 87, 88);
  blocked.renderFullLayer(1);
  const blockedBgWall = brightnessLayer(blocked, 1, 78, 31);
  blocked.destroy();

  const open = mk();
  fillStone(open, 8, 8, 87, 88);
  carve(open, 45, 0, 50, 26);
  carve(open, 20, 22, 80, 30);
  fillStoneLayer(open, 1, 8, 8, 87, 88);
  open.renderFullLayer(1);
  const openBgWall = brightnessLayer(open, 1, 78, 31);
  check(`foreground skylit side cave carries light to background wall (${openBgWall.toFixed(1)} > ${blockedBgWall.toFixed(1)})`,
    openBgWall > blockedBgWall + 35);
  open.destroy();
}

// Background-only surface builds get their own skylight even when the foreground
// has terrain in front of them.
{
  const e = mk();
  fillStone(e, 8, 8, 87, 88);
  fillStoneLayer(e, 1, 30, 8, 66, 44);
  e.renderFullLayer(1);
  const bgTop = brightnessLayer(e, 1, 48, 8);
  const bgCore = brightnessLayer(e, 1, 48, 32);
  check(`background-only surface solid is sky-lit (${bgTop.toFixed(1)} > ${bgCore.toFixed(1)})`, bgTop > bgCore + 45);
  e.destroy();
}

// A foreground shaft also projects direct sky onto background solids behind it.
{
  const blocked = mk();
  fillStone(blocked, 8, 8, 87, 88);
  fillStoneLayer(blocked, 1, 8, 8, 87, 88);
  blocked.renderFullLayer(1);
  const blockedBgWall = brightnessLayer(blocked, 1, 48, 70);
  blocked.destroy();

  const open = mk();
  fillStone(open, 8, 8, 87, 88);
  fillStoneLayer(open, 1, 8, 8, 87, 88);
  carve(open, 45, 0, 50, 78);
  open.renderFullLayer(1);
  const openBgWall = brightnessLayer(open, 1, 48, 70);
  check(`foreground shaft projects skylight onto background (${openBgWall.toFixed(1)} > ${blockedBgWall.toFixed(1)})`, openBgWall > blockedBgWall + 60);
  open.destroy();
}

// A background shaft also projects direct sky into a foreground cave.
{
  const blocked = mk();
  fillStone(blocked, 8, 8, 87, 88);
  carve(blocked, 35, 66, 60, 78);
  fillStoneLayer(blocked, 1, 8, 8, 87, 88);
  blocked.renderFull();
  const blockedFgWall = brightness(blocked, 34, 70);
  blocked.destroy();

  const open = mk();
  fillStone(open, 8, 8, 87, 88);
  carve(open, 35, 66, 60, 78);
  fillStoneLayer(open, 1, 8, 8, 87, 88);
  carveLayer(open, 1, 45, 0, 50, 78);
  open.renderFull();
  const openFgWall = brightness(open, 34, 70);
  check(`background shaft projects skylight into foreground cave (${openFgWall.toFixed(1)} > ${blockedFgWall.toFixed(1)})`, openFgWall > blockedFgWall + 60);
  open.destroy();
}

// A streamed underground buffer edge is not treated as outside sky.
{
  const e = mkInfinite();
  for (let i = 0; i < 6; i++) e.shiftWorldXY(0, 32);
  fillStone(e, 8, 0, 87, 88);
  carve(e, 45, 0, 50, 78);
  e.renderFull();
  const shaftFace = brightness(e, 44, 70);
  const sealed = brightness(e, 20, 70);
  check(`underground buffer top is not fake sky (${shaftFace.toFixed(1)} ~= ${sealed.toFixed(1)})`, shaftFace < sealed + 20);
  e.destroy();
}

// A real vertical shaft keeps direct skylight across vertical streaming.
{
  const e = mkInfinite();
  for (let i = 0; i < 6; i++) {
    fillStone(e, 8, 0, 87, 95);
    carve(e, 45, 0, 50, 95);
    e.renderFull();
    if (i < 5) e.shiftWorldXY(0, 32);
  }
  const shaftFace = brightness(e, 44, 70);
  const sealed = brightness(e, 20, 70);
  check(`streamed deep shaft keeps direct skylight (${shaftFace.toFixed(1)} > ${sealed.toFixed(1)})`, shaftFace > sealed + 35);
  e.destroy();
}

// A render-only worker mirror must preserve the same absolute sky provenance
// when each vertical stream arrives as a full snapshot rather than shiftWorld.
{
  const source = mkInfinite();
  const mirror = mkInfinite();
  for (let i = 0; i < 6; i++) {
    fillStone(source, 8, 0, 87, 95);
    carve(source, 45, 0, 50, 95);
    mirror.applyWorldMirror(source.serializeWorld(), source.getWorldOffsetX(), source.getWorldOffsetY());
    mirror.renderFull();
    if (i < 5) source.shiftWorldXY(0, 32);
  }
  const shaftFace = brightness(mirror, 44, 70);
  const sealed = brightness(mirror, 20, 70);
  check(`streamed worker mirror keeps off-screen shaft skylight (${shaftFace.toFixed(1)} > ${sealed.toFixed(1)})`, shaftFace > sealed + 35);
  mirror.setSkyLight(NIGHT_SKY_LIGHT);
  mirror.renderFull();
  const nightShaftFace = brightness(mirror, 44, 70);
  mirror.setSkyLight(NOON_SKY_LIGHT);
  mirror.renderFull();
  const restoredShaftFace = brightness(mirror, 44, 70);
  check(`streamed worker mirror follows night instead of retaining cached daylight (${nightShaftFace.toFixed(1)} < ${shaftFace.toFixed(1)})`,
    nightShaftFace < shaftFace - 35);
  check(`streamed worker mirror restores daylight through the same cached shaft (${restoredShaftFace.toFixed(1)} ~= ${shaftFace.toFixed(1)})`,
    Math.abs(restoredShaftFace - shaftFace) < 10);
  source.destroy();
  mirror.destroy();
}

// The same streamed shaft stays lit while returning upward through saved chunks.
{
  const e = mkInfinite();
  for (let i = 0; i < 6; i++) {
    fillStone(e, 8, 0, 87, 95);
    carve(e, 45, 0, 50, 95);
    e.renderFull();
    if (i < 5) e.shiftWorldXY(0, 32);
  }
  e.shiftWorldXY(0, -32);
  e.renderFull();
  const shaftFace = brightness(e, 44, 42);
  const sealed = brightness(e, 20, 42);
  check(`streamed shaft stays lit when returning upward (${shaftFace.toFixed(1)} > ${sealed.toFixed(1)})`, shaftFace > sealed + 35);
  e.destroy();
}

// Direct shaft skylight survives unloading the shaft horizontally and returning.
{
  const e = mkInfinite();
  for (let i = 0; i < 6; i++) {
    fillStone(e, 8, 0, 87, 95);
    carve(e, 45, 0, 50, 95);
    e.renderFull();
    if (i < 5) e.shiftWorldXY(0, 32);
  }
  e.shiftWorldXY(64, 0);
  e.renderFull();
  e.shiftWorldXY(-64, 0);
  e.renderFull();
  const shaftFace = brightness(e, 44, 70);
  const sealed = brightness(e, 20, 70);
  check(`streamed shaft stays lit after horizontal unload/reload (${shaftFace.toFixed(1)} > ${sealed.toFixed(1)})`, shaftFace > sealed + 35);
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

// Sky brightness is render-only. The day/night cycle keeps genuine moonlight
// at midnight rather than dropping exposed terrain to the cave ambient floor.
{
  const e = mk();
  fillStone(e, 16, 8, 79, 88);
  e.renderFull();
  const day = brightness(e, 32, 8);
  e.setSkyLight(NIGHT_SKY_LIGHT);
  e.renderFull();
  const moonlit = brightness(e, 32, 8);
  e.setSkyLight(0);
  e.renderFull();
  const dark = brightness(e, 32, 8);
  check(`moonlight is dimmer than noon without changing terrain (${moonlit.toFixed(1)} < ${day.toFixed(1)})`, moonlit < day - 35 && e.getGrid()[k(32, 8)] === MAT.STONE);
  check(`midnight remains brighter than zero-skylight darkness (${moonlit.toFixed(1)} > ${dark.toFixed(1)})`, moonlit > dark + 20);
  e.destroy();
}

const failures = done();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
