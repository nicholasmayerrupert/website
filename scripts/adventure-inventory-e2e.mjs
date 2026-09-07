import process from 'node:process';
import assert from 'node:assert/strict';
import { runBrowserCases } from './browser-harness.mjs';
import { gearDetails } from '../src/sand/embed/gearDetails.js';

assert.equal(gearDetails(106, [{ definitionId: 100 }]).comparison.text, '+1 defense vs. Wayfarer hood');

async function open(page, baseURL) {
  await page.goto(baseURL + '/game?nosave', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('sand-game')?._game?.getInventory()?.equipment?.length);
  await page.getByRole('button', { name: 'Inventory (I)', exact: true }).click();
}
const slot = (page, index) => page.locator(`.inv-slot[data-index="${index}"]`);
const state = (page, predicate) => page.waitForFunction(predicate, null, { timeout: 15000 });

process.exitCode = await runBrowserCases({
  desktop: async ({ page, baseURL, check }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await open(page, baseURL);
    await page.evaluate(() => document.fonts.load('14px "Sand Pixel"'));
    check('all visible inventory text uses the pixel font', await page.locator('.ad-inventory').evaluate(root => [...root.querySelectorAll('*')].filter(node => node.getClientRects().length && [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())).every(node => getComputedStyle(node).fontFamily.includes('Sand Pixel'))));
    await slot(page, 0).hover();
    const tooltip = page.getByRole('tooltip');
    check('weapon tooltip shows real stats', (await tooltip.innerText()).includes('Base damage\n18'));
    check('native title does not duplicate the tooltip', !(await slot(page, 0).getAttribute('title')));
    await page.getByRole('button', { name: 'Head: Wayfarer hood', exact: true }).focus();
    check('keyboard focus reveals equipment stats', (await tooltip.innerText()).includes('Defense\n+1'));
    await page.keyboard.press('Shift+Enter');
    await state(page, () => document.querySelector('sand-game')._game.getInventory().equipment[0].definitionId === 0);
    await slot(page, 9).click({ modifiers: ['Shift'] });
    await state(page, () => document.querySelector('sand-game')._game.getInventory().equipment[0].definitionId === 100);
    check('shift-click unequips and re-equips without losing the item', await page.evaluate(() => !document.querySelector('sand-game')._game.getCursor()));
    await page.getByRole('button', { name: 'Head: Wayfarer hood', exact: true }).click();
    await state(page, () => document.querySelector('sand-game')._game.getCursor()?.definitionId === 100);
    check('carried gear keeps its item sprite', await page.locator('.inv-cursor svg').count() === 1);
    await slot(page, 9).click();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[9].definitionId === 100);
    await slot(page, 9).dragTo(page.getByRole('button', { name: 'Head: Unequipped', exact: true }));
    await state(page, () => document.querySelector('sand-game')._game.getInventory().equipment[0].definitionId === 100);
    check('dragging between pack and equipment works', true);
    await page.locator('.craft-recipe[aria-disabled="true"]').first().focus();
    check('unavailable recipes explain missing ingredients on focus', (await tooltip.innerText()).includes('Missing materials'));
    await page.getByRole('button', { name: 'Open materials bag', exact: true }).click();
    await page.getByRole('heading', { name: 'Building materials bag', exact: true }).waitFor();
    const placement = page.getByRole('combobox', { name: 'Pool placement mode' });
    await placement.click();await page.getByRole('listbox', { name: 'Pool placement mode' }).waitFor();
    await page.keyboard.press('Escape');
    check('Escape dismisses the dropdown before the inventory', await page.getByRole('dialog', { name: 'Inventory', exact: true }).isVisible() && await placement.getAttribute('aria-expanded') === 'false');
    await placement.press('ArrowDown');await placement.press('End');await placement.press('Enter');
    check('keyboard chooses a material without opening another panel', await placement.getAttribute('data-value') !== '0' && await page.getByRole('dialog', { name: 'Inventory', exact: true }).isVisible());
    check('inventory contains no native dropdowns', await page.locator('.ad-inventory select').count() === 0);
    await page.locator('.pool-row').first().getByRole('button', { name: /^Withdraw / }).click();
    await state(page, () => !!document.querySelector('sand-game')._game.getCursor());
    await page.getByRole('button', { name: '← Back to items', exact: true }).click();
    await slot(page, 9).click();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[9].count === 96);
    await slot(page, 9).click({ button: 'right' });
    await state(page, () => document.querySelector('sand-game')._game.getCursor()?.count === 48);
    await slot(page, 10).click();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[10].count === 48);
    check('right-click splits material stacks without changing the total', await page.evaluate(() => document.querySelector('sand-game')._game.getInventory().slots[9].count === 48));
    await slot(page, 10).focus(); await page.keyboard.press('ArrowRight');
    check('arrow keys move slot focus', await slot(page, 11).evaluate(node => node.getRootNode().activeElement === node));
    await page.screenshot({ path: '.sand-artifacts/adventure-browser/inventory-desktop-final.png' });
    await page.keyboard.press('Escape');
    check('equipment and tooltip close with inventory', await page.locator('.ad-equipment:visible').count() === 0 && !(await tooltip.isVisible()));
    check('no browser errors', errors.length === 0, errors.join('; '));
  },
  touch: async ({ page, baseURL, check }) => {
    await open(page, baseURL);
    await slot(page, 0).tap();
    const tooltip = page.getByRole('tooltip'); await tooltip.waitFor();
    check('first touch inspects without moving the item', await page.evaluate(() => !document.querySelector('sand-game')._game.getCursor()));
    check('touch tooltip gives the next action', (await tooltip.innerText()).includes('Tap again to pick up'));
    const bounds = await tooltip.boundingBox();
    check('tooltip stays inside the mobile viewport', bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845);
    await page.screenshot({ path: '.sand-artifacts/adventure-browser/inventory-touch-final.png' });
    await slot(page, 0).tap();
    await state(page, () => document.querySelector('sand-game')._game.getCursor()?.definitionId === 1);
    await slot(page, 9).tap();
    await state(page, () => document.querySelector('sand-game')._game.getInventory().slots[9].definitionId === 1);
    check('second touch picks up and a destination tap places', await page.evaluate(() => !document.querySelector('sand-game')._game.getCursor()));
    await page.getByRole('combobox', { name: 'Tool footprint' }).tap();
    const menu = page.getByRole('listbox', { name: 'Tool footprint' }); await menu.waitFor();
    const menuBounds = await menu.boundingBox();
    check('touch dropdown stays inside viewport', menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 391 && menuBounds.y >= 0 && menuBounds.y + menuBounds.height <= 845);
    await page.getByRole('option', { name: '3 × 3', exact: true }).tap();
    check('touch selects a building footprint', await page.getByRole('combobox', { name: 'Tool footprint' }).getAttribute('data-value') === '2');
    check('mobile inventory has no horizontal overflow', await page.evaluate(() => {
      const page = document.querySelector('sand-game').shadowRoot.querySelector('.ad-inventory');
      return document.documentElement.scrollWidth === innerWidth && page.scrollWidth <= page.clientWidth;
    }));
  },
}, undefined, { touch: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } });
