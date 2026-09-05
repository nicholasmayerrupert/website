import { resolve } from 'node:path';
import { runBrowserCases } from './browser-harness.mjs';

process.exitCode = await runBrowserCases({
  studio: async ({ page, baseURL, check }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseURL}/game?studio=hearth`);
    await page.waitForFunction(() => window.__gameStudio?.inspect().player, null, { timeout: 60000 });
    check('workbench uses the real worker and authored scene', await page.evaluate(() => {
      const s = window.__gameStudio.inspect();
      return s.scene === 'hearth' && s.perf.workerStatus === 'live' && Math.abs(s.player.worldX + 16) < 8;
    }));
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
    await page.waitForTimeout(200);
    const tick = await page.evaluate(() => window.__gameStudio.inspect().perf.actorTick);
    await page.getByRole('button', { name: 'Step actor', exact: true }).click();
    await page.waitForFunction(t => window.__gameStudio.inspect().perf.actorTick === t + 1, tick);
    check('single actor step advances the paused authority once', true);
    await page.getByText('Edit player pixels', { exact: true }).click();
    const pixels = page.getByLabel('Editable player pixels');
    const before = await pixels.evaluate(c => c.toDataURL());
    await pixels.click({ position: { x: 5, y: 5 } });
    check('pixel brush edits the local frame', before !== await pixels.evaluate(c => c.toDataURL()));
    await page.getByRole('button', { name: 'Discard edits' }).click();
    check('discard restores the authored frame', before === await pixels.evaluate(c => c.toDataURL()));
    const frames = await page.getByLabel('Animation frame').locator('option').count();
    await page.getByRole('button', { name: 'Duplicate frame' }).click();
    check('animation editor can add a pose', await page.getByLabel('Animation frame').locator('option').count() === frames + 1);
    await page.getByRole('button', { name: 'Delete frame' }).click();
    check('animation editor can remove a pose', await page.getByLabel('Animation frame').locator('option').count() === frames);
    await page.getByRole('button', { name: 'Discard edits' }).click();
    await page.getByText('Edit blueprint', { exact: true }).click();
    const blueprint = page.getByLabel('Editable scene blueprint');
    await blueprint.click({ position: { x: 15, y: 15 } });
    check('blueprint brush stages a physical stamp', await page.getByText(/1 pending stamps/).isVisible());
    await page.getByRole('button', { name: 'Undo stamp' }).click();
    check('blueprint undo clears the staged edit', await page.getByText(/0 pending stamps/).isVisible());
    const rejected = await page.evaluate(async () => {
      const response = await fetch('/__game-content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '../../unsafe', data: {} }) });
      return response.status;
    });
    check('content writer rejects unknown sources', rejected === 400);
    await page.getByText('Creature artwork', { exact: true }).click();
    check('art drawer previews the complete creature roster', await page.getByRole('region', { name: 'Creature artwork' }).locator('canvas').count() === 20);
    await page.getByLabel('Jump to a scene').selectOption('railway');
    await page.waitForFunction(() => window.__gameStudio.inspect().scene === 'railway' && Math.abs(window.__gameStudio.inspect().player.worldX + 690) < 8);
    await page.getByRole('button', { name: 'Reset world' }).click();
    await page.waitForFunction(() => window.__gameStudio?.inspect().scene === 'railway', null, { timeout: 60000 });
    check('reset preserves the chosen scene', await page.getByLabel('Jump to a scene').inputValue() === 'railway');
    check('workbench has no browser errors', errors.length === 0, errors.join('; '));
    await page.screenshot({ path: resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts', 'workbench.png') });
  },
});
