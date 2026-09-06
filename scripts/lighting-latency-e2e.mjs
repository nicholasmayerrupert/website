// WebGL regression for presentation-mirror lighting cadence. Two authoritative
// diffs are presented back-to-back, well inside the periodic full-light interval;
// both must update a distant skylight shadow immediately.

import { chromium } from 'playwright';
import { makeChecker } from './sand-test-util.mjs';
import { startTestServer } from './browser-harness.mjs';

const { baseURL: URL, close: stopServer } = await startTestServer();

const { check, done } = makeChecker('presentation lighting latency');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const [{ initSandWasm, createEngineWasm }, { MAT }] = await Promise.all([
      import('/src/sand/wasmBridge/engineFactory.js'),
      import('/src/sand/materials.js'),
    ]);
    await initSandWasm();
    const cols = 256, rows = 256, viewCols = 128, viewRows = 128;
    const source = createEngineWasm({
      cols, rows, infinite: false, sinksOn: false, storageRole: 'authority', worldSeed: 7,
    });
    const mirror = createEngineWasm({
      cols, rows, infinite: false, sinksOn: false, storageRole: 'presentation', worldSeed: 7,
    });
    const canvas = document.createElement('canvas');
    canvas.width = viewCols;
    canvas.height = viewRows;
    document.body.append(canvas);
    mirror.glInit(canvas);
    mirror.glResize(viewCols, viewRows);
    mirror.setViewport(1, 1, viewCols, viewRows);
    mirror.cameraSet(0, 0);
    mirror.glSetFlags(false, false, true);
    source.setSkyLight(255);
    mirror.setSkyLight(255);

    // A narrow open shaft isolates the sampled floor from light entering from
    // adjacent columns. The temporary crossbar is far above that floor.
    for (let y = 8; y <= 112; y++) {
      source.paintDisc(55, y, 0, MAT.STONE, true);
      source.paintDisc(72, y, 0, MAT.STONE, true);
      source.paintDisc(183, y, 0, MAT.STONE, true);
      source.paintDisc(202, y, 0, MAT.STONE, true);
    }
    for (let x = 55; x <= 72; x++) source.paintDisc(x, 112, 0, MAT.STONE, true);
    for (let x = 183; x <= 202; x++) source.paintDisc(x, 112, 0, MAT.STONE, true);
    for (let x = 184; x <= 201; x++) source.paintDisc(x, 48, 0, MAT.STONE, true);
    for (let y = 113; y <= 220; y++) {
      source.paintDisc(183, y, 0, MAT.STONE, true);
      source.paintDisc(202, y, 0, MAT.STONE, true);
    }
    for (let x = 183; x <= 202; x++) source.paintDisc(x, 220, 0, MAT.STONE, true);
    for (let x = 184; x <= 201; x++) source.paintDisc(x, 160, 0, MAT.STONE, true);
    source.syncComponents();
    mirror.applyWorldMirror(source.serializeWorld(), 0, 0);
    source.resetDirty();
    mirror.glRenderFrame(true);

    const brightness = (x, y) => {
      const p = mirror.glReadPixels(x, y, 1, 1);
      return (p[0] + p[1] + p[2]) / 3;
    };
    const open = brightness(63, 112);

    // This blocked shaft begins outside the first viewport's exact-light zone
    // on both axes. A diagonal pan must solve the entering strips before
    // displaying them and match a forced full-buffer reference exactly.
    let panLightMs = 0, panLightSolves = 0;
    const panLightOffsets = [];
    for (let offset = 1; offset <= 96; offset++) {
      mirror.cameraSet(offset, offset);
      mirror.glRenderFrame(false);
      const lightMs = mirror.getPerf().lightMs;
      if (lightMs > 0) {
        panLightSolves++;
        panLightOffsets.push(offset);
        panLightMs = Math.max(panLightMs, lightMs);
      }
    }
    const panShadow = brightness(192 - 96, 220 - 96);
    const panFrame = mirror.glReadPixels(0, 0, viewCols, viewRows);
    mirror.glRenderFrame(true);
    const fullShadow = brightness(192 - 96, 220 - 96);
    const fullFrame = mirror.glReadPixels(0, 0, viewCols, viewRows);
    let panFrameMaxDelta = 0;
    for (let i = 0; i < panFrame.length; i++) {
      panFrameMaxDelta = Math.max(panFrameMaxDelta, Math.abs(panFrame[i] - fullFrame[i]));
    }
    mirror.cameraSet(0, 0);
    mirror.glRenderFrame(false);

    for (let x = 56; x <= 71; x++) source.paintDisc(x, 48, 0, MAT.STONE, true);
    source.syncComponents();
    mirror.applyDiffMirror(source.serializeDiff());
    source.resetDirty();
    mirror.setMirrorWorldTick(1);
    mirror.glRenderFrame(false);
    const blocked = brightness(63, 112);
    const blockLightMs = mirror.getPerf().lightMs;

    for (let x = 56; x <= 71; x++) source.eraseDisc(x, 48, 0);
    source.syncComponents();
    mirror.applyDiffMirror(source.serializeDiff());
    source.resetDirty();
    mirror.setMirrorWorldTick(2);
    mirror.glRenderFrame(false);
    const reopened = brightness(63, 112);
    const eraseLightMs = mirror.getPerf().lightMs;

    // A user-authored loose edit is urgent, while later autonomous churn remains
    // on the periodic catch-up path.
    source.paintDisc(24, 24, 3, MAT.WATER, true);
    mirror.applyDiffMirror(source.serializeDiff(), 20, 28);
    source.resetDirty();
    mirror.setMirrorWorldTick(3);
    mirror.glRenderFrame(false);
    const editedWaterLightMs = mirror.getPerf().lightMs;
    source.paintDisc(34, 30, 2, MAT.WATER, true);
    mirror.applyDiffMirror(source.serializeDiff());
    source.resetDirty();
    mirror.setMirrorWorldTick(4);
    mirror.glRenderFrame(false);
    const flowingWaterLightMs = mirror.getPerf().lightMs;

    // Repair a shadow within the viewport, then expose the row just beyond
    // that repair. The offscreen lighting must not be treated as current.
    for (let x = 56; x <= 71; x++) source.paintDisc(x, 48, 0, MAT.STONE, true);
    for (let y = 113; y <= 150; y++) {
      source.paintDisc(55, y, 0, MAT.STONE, true);
      source.paintDisc(72, y, 0, MAT.STONE, true);
    }
    for (let x = 55; x <= 72; x++) source.paintDisc(x, 138, 0, MAT.STONE, true);
    source.syncComponents();
    mirror.applyDiffMirror(source.serializeDiff());
    source.resetDirty();
    mirror.glRenderFrame(true);
    for (let x = 56; x <= 71; x++) {
      source.eraseDisc(x, 48, 0);
      source.eraseDisc(x, 112, 0);
    }
    source.syncComponents();
    mirror.applyDiffMirror(source.serializeDiff());
    source.resetDirty();
    mirror.glRenderFrame(false);
    mirror.cameraSet(0, 11);
    mirror.glRenderFrame(false);
    const editPanFrame = mirror.glReadPixels(0, 0, viewCols, viewRows);
    mirror.glRenderFrame(true);
    const editFullFrame = mirror.glReadPixels(0, 0, viewCols, viewRows);
    let editPanMaxDelta = 0;
    for (let i = 0; i < editPanFrame.length; i++) {
      editPanMaxDelta = Math.max(editPanMaxDelta, Math.abs(editPanFrame[i] - editFullFrame[i]));
    }

    source.destroy();
    mirror.destroy();
    canvas.remove();
    return {
      open, blocked, reopened, blockLightMs, eraseLightMs, editPanMaxDelta,
      editedWaterLightMs, flowingWaterLightMs,
      panShadow, fullShadow, panFrameMaxDelta, panLightMs, panLightSolves, panLightOffsets,
    };
  });

  check(`a new blocker darkens its distant shadow in the same frame (${result.open.toFixed(1)} -> ${result.blocked.toFixed(1)})`,
    result.blocked < result.open - 12);
  check(`an immediate erase restores the light in the same frame (${result.blocked.toFixed(1)} -> ${result.reopened.toFixed(1)})`,
    result.reopened > result.blocked + 12 && Math.abs(result.reopened - result.open) < 8);
  check(`both back-to-back diffs ran lighting repairs (${result.blockLightMs.toFixed(3)}ms, ${result.eraseLightMs.toFixed(3)}ms)`,
    result.blockLightMs > 0 && result.eraseLightMs > 0);
  check(`a user-authored water edit repairs lighting immediately (${result.editedWaterLightMs.toFixed(3)}ms)`,
    result.editedWaterLightMs > 0);
  check(`autonomous water churn stays on the throttled catch-up path (${result.flowingWaterLightMs.toFixed(3)}ms)`,
    result.flowingWaterLightMs === 0);
  check(`dual-axis camera pan amortizes exact edge lighting (${result.panLightSolves} solves at ${result.panLightOffsets.join(',')}, max ${result.panLightMs.toFixed(3)}ms)`,
    result.panLightSolves > 0 && result.panLightSolves <= 4);
  check(`panned shadow matches a full-light reference (${result.panShadow.toFixed(1)} ~= ${result.fullShadow.toFixed(1)})`,
    Math.abs(result.panShadow - result.fullShadow) < 1);
  check(`camera-patched viewport exactly matches a full-light frame (max byte delta ${result.panFrameMaxDelta})`,
    result.panFrameMaxDelta === 0);
  check(`panning after a shadow repair matches full lighting (max byte delta ${result.editPanMaxDelta})`,
    result.editPanMaxDelta === 0);
} finally {
  await browser?.close();
  stopServer();
}

const failures = done();
process.exit(failures === 0 ? 0 : 1);
