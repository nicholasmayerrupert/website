// Real /game keyboard input, worker authority, and predicted jump presentation.
import { resolve } from 'node:path';
import process from 'node:process';
import { runBrowserCases } from './browser-harness.mjs';
import { MAT } from '../src/sand/materials.js';

process.exitCode = await runBrowserCases({
  platforming: async ({ page, baseURL, check }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseURL}/game?nosave`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__sandTest?.getPlayer() && window.__sandPerf?.().workerStatus === 'live'
      && window.__sandPerf().actorTick > 60 && !window.__sandPerf().workerResizePending, null, { timeout: 60000 });
    await page.evaluate(() => {
      window.__sandTest.setCreatureRuntime(false, false);
      window.__sandTest.previewScene(350, -30);
    });
    await page.waitForFunction(() => {
      const t = window.__sandTest, p = t.getPlayer();
      return Math.abs(p.x + t.worldOffset().x - 350) < 8;
    });
    await page.waitForTimeout(300);
    const spot = await page.evaluate(materials => {
      const t = window.__sandTest, off = t.worldOffset();
      t.setPaused(true); t.flushAuthorityControl();
      t.setCreatureRuntime(false, false);
      const x = 350 - off.x, surface = t.surfaceAt(350) - off.y;
      // A stone landing rooted in the terrain gives the keyboard probe a dry,
      // clear takeoff without depending on natural snow or water placement.
      t.paintWorker(materials.empty, x, surface - 26, 34);
      t.paintWorker(materials.stone, x, surface + 10, 20);
      t.setPlayerState({
        x: x - 2, y: surface - 18,
        vx: 0, vy: 0, grounded: false, jumpReady: true,
        jumpActive: false, coyoteTicks: 0, jumpBufferTicks: 0,
      });
      t.stepAuthorityActors(1);
      return { worldX: 348 };
    }, { empty: MAT.EMPTY, stone: MAT.STONE });
    await page.waitForTimeout(200);
    console.log('landing fixture:', await page.evaluate(() => {
      const t = window.__sandTest, p = t.getPlayer(), off = t.worldOffset();
      return { x: p.x + off.x, y: p.y + off.y, grounded: p.grounded, vy: p.vy,
        writes: window.__sandPerf().workerToolWrites, offset: off };
    }));
    await page.waitForFunction(x => {
      const p = window.__sandTest.getPlayer();
      return p.grounded && Math.abs(p.x + window.__sandTest.worldOffset().x - x) < 1;
    }, spot.worldX);
    await page.evaluate(() => {
      window.__sandTest.setPaused(false); window.__sandTest.flushAuthorityControl();
    });
    await page.locator('sand-game').evaluate(host => host.shadowRoot.querySelector('.sg-sim').focus());
    const jump = async (hold) => {
      await page.waitForFunction(() => window.__sandTest.getPlayer().grounded);
      const sampling = page.evaluate(() => new Promise(resolve => {
        const t = window.__sandTest;
        const y0 = t.getPlayer().y + t.worldOffset().y;
        let min = y0, started = performance.now();
        const frame = () => {
          min = Math.min(min, t.getPlayer().y + t.worldOffset().y);
          if (performance.now() - started >= 1200) resolve(y0 - min);
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }));
      await page.keyboard.down('Space');
      await page.waitForTimeout(hold);
      await page.keyboard.up('Space');
      return sampling;
    };
    const short = await jump(45), full = await jump(650);
    check('a keyboard tap produces a short hop through the real worker', short > 5 && short < 19, `height=${short.toFixed(2)}`);
    check('holding jump reaches the full arc', full > 23 && full < 28, `height=${full.toFixed(2)}`);
    check('the visible jump responds to release timing', full - short > 6);
    const groundY = await page.evaluate(() => window.__sandTest.getPlayer().y + window.__sandTest.worldOffset().y);
    await page.keyboard.down('Space');
    await page.waitForTimeout(200);
    await page.keyboard.up('Space');
    await page.waitForFunction(y => {
      const p = window.__sandTest.getPlayer();
      return !p.grounded && p.vy > 0 && p.y + window.__sandTest.worldOffset().y > y - 7;
    }, groundY);
    await page.keyboard.down('Space');
    await page.waitForFunction(() => window.__sandTest.getPlayer().vy < -1, null, { timeout: 1000 });
    await page.keyboard.up('Space');
    check('an early second press chains into the next jump', true);
    check('platforming has no browser exceptions', errors.length === 0, errors.join('; '));
    await page.screenshot({ path: resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts', 'platforming.png') });
  },
});
