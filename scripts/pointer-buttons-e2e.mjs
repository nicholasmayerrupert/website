import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { startTestServer } from './browser-harness.mjs';

const server = await startTestServer();
try {
  for (const browserType of [webkit, chromium]) {
    const browser = await browserType.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${server.baseURL}/src/sand/game/inputBindings.js`);
      await page.setContent('<div id="surface" style="width:400px;height:300px"></div><button id="hud">HUD</button>');
      await page.evaluate(async () => {
        const { createInputBindings } = await import('/src/sand/game/inputBindings.js');
        const container = document.querySelector('#surface');
        const ctx = {
          container, wrapBounds: container.getBoundingClientRect(), mouseButtons: 0,
          drawModeOn: true, inside: false, clientX: -1, clientY: -1,
          engine: { inputPointer() {}, inputClearKeys() {}, inputStick() {}, pointerButtons() {} },
          worldWorker: { edge: (kind, button) => window.edges.push([kind, button]) },
        };
        window.edges = [];
        window.ctx = ctx;
        window.bindings = createInputBindings(ctx, { refreshBounds() {} });
        window.bindings.attach();
        const hud = document.querySelector('#hud');
        hud.addEventListener('pointermove', e => e.stopPropagation());
      });
      const state = () => page.evaluate(() => ({ buttons: window.ctx.mouseButtons, edges: window.edges }));
      for (const [first, second, firstBit, secondBit] of [['right', 'left', 2, 1], ['left', 'right', 1, 2]]) {
        await page.mouse.move(100, 100);
        await page.mouse.down({ button: first });
        assert.equal((await state()).buttons, firstBit);
        await page.mouse.down({ button: second });
        assert.equal((await state()).buttons, firstBit | secondBit, `${browserType.name()}: overlapping press`);
        await page.mouse.up({ button: first });
        assert.equal((await state()).buttons, secondBit, `${browserType.name()}: overlapping release`);
        await page.mouse.up({ button: second });
        assert.equal((await state()).buttons, 0, `${browserType.name()}: all buttons released`);
      }
      assert.deepEqual((await state()).edges, [
        ['down', 2], ['down', 0], ['up', 2], ['up', 0],
        ['down', 0], ['down', 2], ['up', 0], ['up', 2],
      ]);
      await page.mouse.down({ button: 'left' });
      await page.mouse.down({ button: 'right' });
      const hud = await page.locator('#hud').boundingBox();
      await page.mouse.move(hud.x + 5, hud.y + 5);
      await page.mouse.up({ button: 'right' });
      assert.equal((await state()).buttons, 1, 'HUD cannot swallow a chord release');
      await page.mouse.up({ button: 'left' });
      assert.equal((await state()).buttons, 0);
      await page.evaluate(() => {
        window.dispatchEvent(new Event('blur'));
        document.querySelector('#surface').dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, button: -1, buttons: 3, clientX: 100, clientY: 100, pointerType: 'mouse',
        }));
      });
      assert.equal((await state()).buttons, 0, 'ordinary held-looking movement cannot resurrect a press');
      await page.mouse.click(100, 100);
      assert.deepEqual((await state()).edges.slice(-2), [['down', 0], ['up', 0]], 'fresh click works after chording');
      await page.evaluate(() => window.bindings.detach());
      const detached = await state();
      await page.mouse.click(100, 100);
      assert.deepEqual(await state(), detached, 'detach removes all button listeners');
      console.log(`${browserType.name()}: overlapping buttons, HUD release, focus recovery, and fresh clicks pass`);
    } finally { await browser.close(); }
  }
} finally { server.close(); }
