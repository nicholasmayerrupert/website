// Partial worker stream packets must render exactly like full-buffer lighting,
// including offscreen shaft provenance and subsequent camera pans.
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('streamed presentation lighting');
const { baseURL, close } = await startTestServer();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const [{ initSandWasm, createEngineWasm }, { MAT }, { prepareMirrorShift }] = await Promise.all([
      import('/src/sand/wasmBridge/engineFactory.js'),
      import('/src/sand/materials.js'),
      import('/src/sand/worker/mirrorShift.js'),
    ]);
    await initSandWasm();
    const cols = 768, rows = 384, vw = 128, vh = 96;
    const makeEngine = () => createEngineWasm({
      cols, rows, worldSeed: 7, infinite: true, sinksOn: false, storageRole: 'presentation',
    });
    const source = makeEngine(), mirror = makeEngine(), reference = makeEngine();
    const canvases = [];
    for (const e of [mirror, reference]) {
      const canvas = document.createElement('canvas');
      canvas.width = vw; canvas.height = vh;
      document.body.append(canvas); canvases.push(canvas);
      e.glInit(canvas); e.glResize(vw, vh); e.setViewport(1, 1, vw, vh);
      e.glSetFlags(false, false, true); e.setSkyLight(255);
    }
    let ox = 0, oy = -256;
    // Straight shafts cross the whole loaded height, including columns outside
    // the view's lighting margin. Caves and lamps exercise both light layers.
    const fill = () => {
      const fg = source.getGrid(), bg = source.getGridBg();
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const wx = ox + x, wy = oy + y, k = y * cols + x;
        const phase = ((wx % 256) + 256) % 256;
        const shaft = phase >= 64 && phase <= 71;
        const cave = phase >= 80 && phase <= 116 && wy % 96 >= 64;
        fg[k] = wy < 0 || shaft || cave ? MAT.EMPTY : MAT.STONE;
        bg[k] = wy < 0 ? MAT.EMPTY : MAT.STONE;
        if (phase === 100 && wy % 96 === 78) bg[k] = MAT.LAVA;
      }
    };
    // Encode just the entering strips in the same two-layer diff format used
    // by the worker. Vertical strips exclude the horizontal strip's overlap.
    const bands = (dx, dy) => {
      const rects = [];
      if (dx > 0) rects.push([cols - dx, 0, cols, rows]);
      if (dx < 0) rects.push([0, 0, -dx, rows]);
      if (dy) rects.push([
        Math.max(0, -dx), dy > 0 ? rows - dy : 0,
        cols - Math.max(0, dx), dy > 0 ? rows : -dy,
      ]);
      const size = 4 + 2 * rects.reduce((n, [x0, y0, x1, y1]) => n + 8 + (x1 - x0) * (y1 - y0), 0);
      const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
      let p = 0;
      const u16 = (v) => { view.setUint16(p, v, true); p += 2; };
      for (const grid of [source.getGrid(), source.getGridBg()]) {
        u16(rects.length);
        for (const rect of rects) {
          rect.forEach(u16);
          const [x0, y0, x1, y1] = rect;
          for (let y = y0; y < y1; y++) {
            bytes.set(grid.subarray(y * cols + x0, y * cols + x1), p);
            p += x1 - x0;
          }
        }
      }
      return bytes;
    };
    fill();
    for (const e of [mirror, reference]) {
      e.applyWorldMirror(source.serializeWorld(), ox, oy);
      e.cameraSet(256, 240); e.glRenderFrame(true);
    }
    // The independent reference always computes full-buffer lighting.
    reference.glRenderFrame(true);
    const samples = [];
    let maxDelta = 0, packetValid = true;
    const compare = (label, x, y) => {
      mirror.cameraSet(x, y); reference.cameraSet(x, y);
      mirror.glRenderFrame(false);
      const lightMs = mirror.getPerf().lightMs;
      reference.glRenderFrame(true);
      const a = mirror.glReadPixels(0, 0, vw, vh), b = reference.glReadPixels(0, 0, vw, vh);
      let delta = 0;
      for (let k = 0; k < a.length; k++) delta = Math.max(delta, Math.abs(a[k] - b[k]));
      maxDelta = Math.max(maxDelta, delta);
      samples.push({ label, delta, lightMs, fullLightMs: reference.getPerf().lightMs });
    };
    const shifts = [[128, 0], [0, 96], [0, 96], [0, 96], [128, 96],
      [-128, 0], [0, -96], [-128, -96], [0, 96], [128, 0]];
    for (let i = 0; i < shifts.length; i++) {
      const [dx, dy] = shifts[i]; ox += dx; oy += dy; fill();
      const bytes = bands(dx, dy);
      packetValid &&= prepareMirrorShift(mirror, { cols, rows, shiftDx: dx, shiftDy: dy, worldOffsetX: ox, worldOffsetY: oy }, bytes);
      packetValid &&= mirror.applyDiffMirror(bytes);
      reference.applyWorldMirror(source.serializeWorld(), ox, oy);
      compare(`shift ${dx},${dy}`, 256, 128);
      compare('pan beyond solved region', 512, 144);
      if (i === 5 || i === 6) {
        for (const e of [mirror, reference]) e.setSkyLight(i === 5 ? 64 : 255);
        compare('day/night', 512, 144);
      }
    }
    compare('deep shaft', 256 + ((256 - ox % 256) % 256), 144);
    const shaft = mirror.glReadPixels(63, 50, 1, 1);
    const sealed = mirror.glReadPixels(40, 50, 1, 1);
    const shaftLight = shaft[0] + shaft[1] + shaft[2];
    const sealedLight = sealed[0] + sealed[1] + sealed[2];
    for (const e of [source, mirror, reference]) e.destroy();
    for (const canvas of canvases) canvas.remove();
    return { maxDelta, packetValid, samples, shaftLight, sealedLight };
  });
  check('all entering-band packets apply successfully', result.packetValid);
  check(`horizontal, vertical, diagonal and returning streams match full lighting (max byte delta ${result.maxDelta})`, result.maxDelta === 0);
  check(`offscreen shaft provenance survives deep streaming (${result.shaftLight} > ${result.sealedLight})`, result.shaftLight > result.sealedLight + 50);
  console.log(JSON.stringify(result.samples));
} finally {
  await browser?.close();
  await close();
}
process.exit(done() === 0 ? 0 : 1);
