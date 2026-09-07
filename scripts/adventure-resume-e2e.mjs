import { runBrowserCases } from './browser-harness.mjs';
import process from 'node:process';

const resume = viewport => async ({ page, baseURL, check }) => {
  await page.goto(baseURL + '/game', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__sandPerf?.().mirrorWorldTick > 0);
  await page.getByRole('button', { name: 'Inventory (I)', exact: true }).click();
  const changedAt = Date.now();
  await page.getByRole('button', { name: 'Head: Wayfarer hood', exact: true }).click();
  await page.waitForFunction(at => document.querySelector('sand-game')._game.getSaveState().savedAt > at,
    changedAt, { timeout: 30000 });
  const original = await page.evaluate(async () => {
    const { loadAdventure } = await import('/src/sand/worker/adventureSaveStore.js');
    window.resumeFixture = await loadAdventure();
    const g = document.querySelector('sand-game')._game;
    return { cols: window.resumeFixture.cols, rows: window.resumeFixture.rows, ...g.getMissionView() };
  });
  await page.setViewportSize(viewport);
  await page.waitForFunction(() => !window.__sandPerf().workerResizePending);
  // Restore the checkpoint made on the other viewport, as a returning player would.
  await page.evaluate(async () => {
    const { saveAdventure } = await import('/src/sand/worker/adventureSaveStore.js');
    await saveAdventure(window.resumeFixture.bytes);
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('sand-game')?._game?.getSaveState().restored,
    null, { timeout: 60000 });
  await page.waitForFunction(() => window.__sandPerf().mirrorWorldTick > 0, null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getInventory()?.equipment?.length);
  const state = await page.evaluate(() => {
    const t = window.__sandTest, g = document.querySelector('sand-game')._game, dims = t.info();
    return { ...dims, ...g.getMissionView(), solids: t.solidCount(0, 0, dims.cols, dims.rows),
      head: g.getInventory().equipment[0].definitionId };
  });
  check('fixture resumes into different world dimensions', state.cols !== original.cols || state.rows !== original.rows);
  check('restored terrain reaches the renderer', state.solids > 10000);
  check('equipment survives viewport changes', state.head === 0);
  check('saved world position survives viewport changes', Math.abs(state.playerWorldX - original.playerWorldX) < 2
    && Math.abs(state.playerWorldY - original.playerWorldY) < 3);
  await page.waitForTimeout(2500);
  check('player remains on restored ground', await page.evaluate(y => {
    const g = document.querySelector('sand-game')._game;
    return g.getPlayer().alive && Math.abs(g.getMissionView().playerWorldY - y) < 3;
  }, state.playerWorldY));
};

process.exitCode = await runBrowserCases({
  grow: resume({ width: 900, height: 1200 }),
  shrink: resume({ width: 390, height: 844 }),
}, undefined, { shrink: { viewport: { width: 900, height: 1200 } } });
