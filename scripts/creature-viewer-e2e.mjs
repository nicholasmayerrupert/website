import { resolve } from 'node:path';
import { runBrowserCases } from './browser-harness.mjs';

process.exitCode = await runBrowserCases({
  'creature viewer': async ({ page, baseURL, check }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseURL}/game?creature=FROST_GIANT`);
    await page.waitForFunction(() => window.__creatureViewer?.inspect().actor, null, { timeout: 60000 });
    check('deep link selects frost giant', await page.getByLabel('Creature', { exact: true }).inputValue() === 'FROST_GIANT');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const tick = await page.evaluate(() => window.__creatureViewer.inspect().tick);
    await page.waitForTimeout(120);
    check('pause freezes the clock', await page.evaluate(() => window.__creatureViewer.inspect().tick) === tick);
    await page.getByRole('button', { name: 'Step tick', exact: true }).click();
    check('single stepping advances once', await page.evaluate(() => window.__creatureViewer.inspect().tick) === tick + 1);
    await page.getByRole('button', { name: 'Source pixels', exact: true }).click();
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    const before = await page.getByLabel('Source animation preview').evaluate(c => c.toDataURL());
    await page.getByRole('button', { name: 'Next frame', exact: true }).click();
    check('frame stepping advances the source pose', await page.evaluate(() => window.__creatureViewer.inspect().frame) === 1
      && await page.getByLabel('Source animation preview').evaluate(c => c.toDataURL()) !== before);
    await page.getByLabel('Facing', { exact: true }).selectOption('-1');
    check('facing control updates the engine actor', await page.evaluate(() => window.__creatureViewer.inspect().actor.facing) === -1);
    await page.getByLabel('Playback speed').selectOption('0.5');
    check('slow playback setting is applied', await page.evaluate(() => window.__creatureViewer.inspect().speed) === .5);
    const roster = await page.evaluate(async () => {
      const { CREATURE_ROSTER, PREVIEW_MODES } = await import('/src/sand/studio/creatureViewerRuntime.js');
      const api = window.__creatureViewer, results = [];
      for (const def of CREATURE_ROSTER) {
        api.select({ creature: def.key, mode: 'move', facing: 1 }); api.step(4);
        const s = api.inspect(); results.push({ correct: s.actor?.species === def.id, contexts: s.contexts });
      }
      api.select({ creature: 'FROST_GIANT', mode: 'move' });
      for (const mode of PREVIEW_MODES.filter(m => m !== 'simulation')) {
        api.select({ mode }); api.seekFrame(api.inspect().frames - 1); api.step();
      }
      return results;
    });
    check('the complete roster spawns without accumulating GL contexts', roster.length === 35 && roster.every(s => s.correct && s.contexts === 1));
    await page.getByLabel('Creature', { exact: true }).selectOption('BONE_DINOSAUR');
    await page.waitForFunction(() => location.search.includes('creature=BONE_DINOSAUR'));
    check('roster selection keeps the URL shareable', true);
    await page.getByRole('button', { name: 'Special', exact: true }).click();
    check('special artwork is inspectable in source view', await page.getByLabel('Source animation preview').isVisible());
    await page.getByLabel('Creature', { exact: true }).selectOption('FROST_GIANT');
    await page.getByLabel('Attack pattern').selectOption('0');
    await page.getByRole('button', { name: 'Live encounter', exact: true }).click();
    const breath = await page.evaluate(async () => {
      const { PROJECTILE_KIND } = await import('/src/sand/wasmBridge/abi.generated.js');
      const s = window.__creatureViewer.step(65);
      return s.projectiles.filter(p => p.kind === PROJECTILE_KIND.FROST_BREATH).length;
    });
    check('encounters emit real simulated breath', breath >= 8);
    check('live encounters use the game view', await page.getByLabel('Live creature preview').isVisible());
    await page.getByRole('button', { name: 'Walk / move', exact: true }).click();
    await page.getByRole('button', { name: 'In game', exact: true }).click();
    await page.evaluate(() => window.__creatureViewer.seekFrame(6));
    await page.screenshot({ path: resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts', 'creature-viewer.png'), fullPage: true });
    check('viewer reports no browser errors', errors.length === 0, errors.join('; '));
  },
});
