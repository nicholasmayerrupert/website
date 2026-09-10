import process from 'node:process';
import fs from 'node:fs/promises';
import { runBrowserCases } from './browser-harness.mjs';

await fs.mkdir('.sand-artifacts/magic', { recursive: true });
const state = (page, predicate) => page.waitForFunction(predicate, null, { timeout: 15000 });
async function open(page, baseURL) {
  await page.goto(baseURL + '/game?nosave', { waitUntil: 'domcontentloaded' });
  await state(page, () => document.querySelector('sand-game')?._game?.getInventory()?.slots?.[2]?.wand);
  await page.getByRole('button', { name: 'Inventory (I)', exact: true }).click();
  await page.getByRole('button', { name: 'Wands', exact: true }).click();
  await page.getByRole('heading', { name: 'Wandcraft', exact: true }).waitFor();
}
process.exitCode = await runBrowserCases({
  desktop: async ({ page, baseURL, check }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await open(page, baseURL);
    await page.getByRole('combobox', { name: 'Wand to edit', exact: true }).click();
    check('only wands appear as editable containers', await page.getByRole('listbox', { name: 'Wand to edit', exact: true }).getByRole('option').count() === 1);
    await page.keyboard.press('Escape');
    await page.locator('.inv-slot[data-index="33"]').hover();
    check('loose runes explain that a wand is required', (await page.getByRole('tooltip').innerText()).includes('Install in a wand spell socket to cast'));
    check('starter wand shows its separate spell and upgrade capacities',
      await page.locator('.wand-socket.spell:visible').count() === 3 && await page.locator('.wand-socket.upgrade:visible').count() === 2);
    await page.locator('.inv-slot[data-index="34"]').click();
    await state(page, () => document.querySelector('sand-game')._game.getCursor()?.definitionId === 501);
    await page.getByRole('button', { name: 'Upgrade socket 1: Empty', exact: true }).click();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[2].wand.upgrades[0] === 501);
    await page.locator('.wand-mana').filter({ hasText: 'Next cast 23' }).waitFor();
    check('socket edit reaches the authority worker and updates the mana cost', await page.locator('.wand-mana').innerText() === 'Your mana 100/100 · Next cast 23');
    await page.locator('.inv-slot[data-index="35"]').click();
    await page.getByRole('button', { name: 'Upgrade socket 2: Empty', exact: true }).click();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[2].wand.upgrades[1] === 503);
    await page.locator('.wand-mana').filter({ hasText: 'Next cast 45' }).waitFor();
    check('combined upgrades preview the complete cost', (await page.locator('.wand-mana').innerText()).includes('Next cast 45'));
    await page.locator('.ad-wands').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.sand-artifacts/magic/wand-editor-desktop.png' });
    await page.getByRole('button', { name: 'Spell socket 1: Ember', exact: true }).focus();
    await page.keyboard.press('Enter');
    await state(page, () => document.querySelector('sand-game')._game.getCursor()?.definitionId === 300);
    await page.getByRole('button', { name: 'Spell socket 2: Empty', exact: true }).focus();
    await page.keyboard.press('Enter');
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[2].wand.spells[1] === 300);
    check('keyboard moves a spell without losing or duplicating it', await page.evaluate(() => !document.querySelector('sand-game')._game.getCursor()));
    await page.locator('.inv-slot[data-index="2"]').dragTo(page.locator('.inv-slot[data-index="5"]'));
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[5].wand?.upgrades[1] === 503);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('sand-game')._game.selectSlot(5));
    await state(page, () => document.querySelector('sand-game')._game.getPlayer()?.manaCastCost === 45);
    await page.locator('.survival-mana-caption').filter({ hasText: 'Cast 45' }).waitFor();
    await page.mouse.move(600, 230);
    await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
    await state(page, () => document.querySelector('sand-game')._game.getPlayer().mana < 65);
    check('casting spends the displayed amount from player mana', true);
    const caption = await page.locator('.survival-mana-caption').boundingBox();
    const hotbar = await page.locator('.inv-bar').boundingBox();
    check('mana forecast clears the quickbar', caption.y + caption.height < hotbar.y);
    await page.screenshot({ path: '.sand-artifacts/magic/mana-hud.png' });
    check('browser reports no errors', errors.length === 0, errors.join('; '));
  },
  touch: async ({ page, baseURL, check }) => {
    await open(page, baseURL);
    await page.locator('.ad-wands').scrollIntoViewIfNeeded();
    const sockets = await page.locator('.wand-socket.spell:visible').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; }));
    check('mobile spell order reads left to right with usable touch targets', sockets.every((box, index) => box.width >= 44 && box.height >= 44 && box.y === sockets[0].y && (!index || box.x > sockets[index - 1].x)));
    check('mobile wand editor fits inside the inventory', await page.locator('.ad-inventory').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.getByRole('button', { name: 'Spell socket 1: Ember', exact: true }).tap();
    await state(page, () => document.querySelector('sand-game')._game.getCursor()?.definitionId === 300);
    await page.getByRole('button', { name: 'Spell socket 2: Empty', exact: true }).tap();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[2].wand.spells[1] === 300);
    check('touch can move a spell between sockets', true);
    await page.getByRole('button', { name: 'Pack', exact: true }).tap();
    await page.locator('.inv-slot[data-index="34"]').tap();
    await page.getByRole('button', { name: 'Pick up', exact: true }).tap();
    await state(page, () => document.querySelector('sand-game')._game.getCursor()?.definitionId === 501);
    await page.getByRole('button', { name: 'Wands', exact: true }).tap();
    await page.getByRole('button', { name: 'Upgrade socket 1: Empty', exact: true }).tap();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[2].wand.upgrades[0] === 501);
    check('touch carries a rune from the pack across sections into a wand', true);
    await page.getByRole('button', { name: 'Spell socket 2: Ember', exact: true }).waitFor();
    await page.screenshot({ path: '.sand-artifacts/magic/wand-editor-mobile.png' });
  },
}, undefined, { touch: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } });
