import { runBrowserCases } from './browser-harness.mjs';
import { MAT } from '../src/sand/materials.js';

async function exercise({ page, baseURL, check }, narrow = false) {
  await page.addInitScript(() => {
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (...args) {
      const el = create.apply(this, args);
      if (el.localName === 'sand-game') el.setAttribute('world-seed', String(0x5eed1234));
      return el;
    };
  });
  await page.goto(`${baseURL}/game?sandbox`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sandTest?.getInventory()?.pools?.length === 3);
  await page.evaluate((m) => {
    const t = window.__sandTest;
    t.setCreatureRuntime(false, false);
    for (const [mat, count] of [[m.STONE, 10000], [m.WOOD, 200], [m.SAND, 50], [m.WATER, 40], [m.ACID, 20]]) t.addInventory(mat, count);
  }, MAT);
  await page.waitForFunction((mat) => window.__sandTest.getInventory().pools[0].entries.some((e) => e.material === mat && e.count === 200), MAT.WOOD);
  const host = page.locator('sand-game');
  await page.evaluate(() => document.activeElement?.blur());
  await host.locator('.inv-slot[data-index="6"]').dblclick();
  const dialog = host.getByRole('dialog', { name: 'Inventory and crafting' });
  await dialog.waitFor();
  check('double-click opens the highlighted bag without canvas focus',
    await dialog.getByRole('heading', { name: 'Building materials bag' }).isVisible()
    && await host.locator('.inv-slot.inv-bag').count() === 3);
  check('opening a bag does not pick it up', await page.evaluate(() => window.__sandTest.getInventory().slots[6].pool === 1));
  await dialog.getByLabel('Sort materials').selectOption('density');
  check('density sorts wood before stone without changing the queue',
    await dialog.locator('.pool-row').first().getAttribute('data-material') === String(MAT.WOOD)
    && await page.evaluate((mat) => window.__sandTest.getInventory().pools[0].entries[0].material === mat, MAT.STONE));
  await dialog.getByRole('button', { name: 'Use as queue' }).click();
  await page.waitForFunction((mat) => window.__sandTest.getInventory().pools[0].entries[0].material === mat, MAT.WOOD);
  await dialog.getByRole('button', { name: 'Move stone earlier' }).click();
  await page.waitForFunction((mat) => window.__sandTest.getInventory().pools[0].entries[0].material === mat, MAT.STONE);
  await dialog.getByRole('button', { name: '← Inventory', exact: true }).click();
  check('existing inventory retains all 36 slots', await dialog.locator('.inv-slot').count() === 36);
  await dialog.getByRole('button', { name: 'Building materials', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Use wood in Auto' }).uncheck();
  await page.waitForFunction((mat) => window.__sandTest.getInventory().pools[0].entries.find((e) => e.material === mat)?.enabled === false, MAT.WOOD);
  await dialog.getByRole('button', { name: 'Move wood earlier' }).click();
  await page.waitForFunction((mat) => window.__sandTest.getInventory().pools[0].entries[0].material === mat, MAT.WOOD);
  await dialog.getByRole('checkbox', { name: 'Use wood in Auto' }).check();
  await page.waitForFunction((mat) => window.__sandTest.getInventory().slots[6].material === mat, MAT.WOOD);
  check('queue order and enabled state round-trip through the worker', true);
  await dialog.getByLabel('Pool placement mode').selectOption(String(MAT.STONE));
  await page.waitForFunction((mat) => window.__sandTest.getInventory().pools[0].exactMaterial === mat, MAT.STONE);
  await dialog.getByRole('button', { name: 'Withdraw wood' }).click();
  await page.waitForFunction((mat) => window.__sandTest.getInventory().pools[0].entries.find((e) => e.material === mat)?.count === 0, MAT.WOOD);
  await dialog.locator(`.pool-row[data-material="${MAT.WOOD}"]`).waitFor({ state: 'detached' });
  check('depleted materials disappear from the bag and material selector',
    await dialog.getByLabel('Pool placement mode').locator(`option[value="${MAT.WOOD}"]`).count() === 0);
  await dialog.locator('.inv-slot[data-index="9"]').click();
  await page.waitForFunction((mat) => {
    const s = window.__sandTest.getInventory().slots[9]; return s.material === mat && s.count === 200 && !s.pool;
  }, MAT.WOOD);
  await dialog.getByRole('button', { name: 'Store stacks' }).click();
  await page.waitForFunction((mat) => window.__sandTest.getInventory().slots[9].count === 0 && window.__sandTest.getInventory().pools[0].entries.find((e) => e.material === mat)?.count === 200, MAT.WOOD);
  await dialog.locator(`.pool-row[data-material="${MAT.WOOD}"]`).waitFor();
  check('withdrawal and deposit preserve ordinary stack interactions', true);
  await dialog.locator('.inv-slot[data-index="6"]').click();
  await page.waitForFunction(() => !window.__sandTest.getInventory().slots[6].pool);
  await page.keyboard.press('Delete');
  await host.locator('.inv-backdrop').click({ position: { x: 5, y: 80 } });
  await dialog.locator('.inv-slot[data-index="10"]').click();
  await page.waitForFunction(() => window.__sandTest.getInventory().slots[10].pool === 1);
  check('a bag picked up with a normal click cannot be dropped by Delete or the backdrop', true);
  await dialog.locator('.inv-slot[data-index="10"]').dblclick();
  await dialog.getByRole('heading', { name: 'Building materials bag' }).waitFor();
  check('double-clicking a bag in the inventory opens it without moving it',
    await page.evaluate(() => window.__sandTest.getInventory().slots[10].pool === 1));
  await dialog.getByRole('button', { name: '← Inventory', exact: true }).click();
  await dialog.locator('.inv-slot[data-index="10"]').click();
  await page.waitForFunction(() => !window.__sandTest.getInventory().slots[10].pool);
  await dialog.locator('.inv-slot[data-index="6"]').click();
  await page.waitForFunction(() => window.__sandTest.getInventory().slots[6].pool === 1);
  await dialog.locator('.inv-slot[data-index="6"]').dragTo(dialog.locator('.inv-slot[data-index="10"]'));
  await page.waitForFunction(() => window.__sandTest.getInventory().slots[10].pool === 1);
  await dialog.locator('.inv-slot[data-index="10"]').dragTo(dialog.locator('.inv-slot[data-index="6"]'));
  await page.waitForFunction(() => window.__sandTest.getInventory().slots[6].pool === 1);
  check('pool containers move through the existing cursor and grid', true);
  await dialog.getByRole('button', { name: 'Liquids', exact: true }).click();
  check('liquids start exact and acid starts excluded', await dialog.getByLabel('Pool placement mode').inputValue() === String(MAT.WATER) && !(await dialog.getByRole('checkbox', { name: 'Use acid in Auto' }).isChecked()));
  await dialog.getByRole('button', { name: 'Building materials', exact: true }).click();
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  check('inventory fits inside the viewport', bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y >= 0);
  await dialog.locator('.inv-slot[data-index="6"]').dblclick();
  check('bag help text is removed', !(await dialog.textContent()).includes('Auto uses checked materials')
    && !(await dialog.textContent()).includes('arrows change priority'));
  await page.screenshot({ path: `.sand-artifacts/inventory-pools-${narrow ? 'narrow' : 'desktop'}.png` });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await host.evaluate((el) => el.shadowRoot.querySelector('.sg-sim').focus());
  await page.keyboard.press('7');
  await page.waitForFunction(() => window.__sandTest.getInventory().selected === 6);
  check('hotbar presents the selected pool and material', (await host.locator('.inv-pool-active').textContent()).includes('stone'));
  await host.getByRole('button', { name: 'Inventory · E', exact: true }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Close inventory', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await host.locator('.inv-slot[data-index="8"]').dblclick();
  await dialog.getByRole('heading', { name: 'Liquids bag' }).waitFor();
  check('each bag opens its own contents and shows disabled materials explicitly',
    (await dialog.locator(`.pool-row[data-material="${MAT.ACID}"]`).textContent()).includes('Disabled'));
}

const failures = await runBrowserCases({
  desktop: (ctx) => exercise(ctx),
  narrow: (ctx) => exercise(ctx, true),
  expedition: async ({ page, baseURL, check }) => {
    await page.goto(`${baseURL}/game`);
    await page.getByRole('button', { name: 'Start exploring' }).click({ timeout: 60000 });
    const host = page.locator('sand-game');
    await host.locator('.inv-slot[data-index="7"]').dblclick();
    const dialog = host.getByRole('dialog', { name: 'Inventory and crafting' });
    await dialog.getByRole('heading', { name: 'Powders bag' }).waitFor();
    check('expedition bags open directly, including an empty bag', true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    check('Escape closes the bag without opening the expedition pause menu',
      await page.getByRole('dialog', { name: 'Expedition paused' }).count() === 0);
    await host.locator('.inv-slot[data-index="8"]').focus();
    await page.keyboard.press('Enter');
    await dialog.getByRole('heading', { name: 'Liquids bag' }).waitFor();
    check('keyboard activation opens bags from the hotbar', true);
  },
}, ['desktop', 'narrow', 'expedition'], {
  desktop: { viewport: { width: 1366, height: 900 }, reducedMotion: 'no-preference' },
  narrow: { viewport: { width: 800, height: 700 }, reducedMotion: 'no-preference' },
  expedition: { viewport: { width: 1366, height: 900 }, reducedMotion: 'no-preference' },
});
process.exit(failures ? 1 : 0);
