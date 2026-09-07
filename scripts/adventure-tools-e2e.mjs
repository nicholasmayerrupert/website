import { runBrowserCases } from './browser-harness.mjs';
import { mkdirSync } from 'node:fs';
import process from 'node:process';
const artifacts = '.sand-artifacts/adventure-tools';
mkdirSync(artifacts, { recursive: true });
process.exitCode = await runBrowserCases({ prompts: async ({ page, baseURL, check }) => {
  await page.goto(baseURL + '/game?nosave', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('sand-game')?._game?.getPlayer(), null, { timeout: 60000 });
  await page.locator('sand-game').evaluate(host => host.shadowRoot.querySelector('.sg-sim').focus());
  for (let i=0;i<40;i++) {
    const delta=await page.evaluate(()=>{
      const g=document.querySelector('sand-game')._game,v=g.getMissionView();
      const actor=g.getTalkableActors().sort((a,b)=>Math.hypot(a.worldX-v.playerWorldX,a.worldY-v.playerWorldY)-Math.hypot(b.worldX-v.playerWorldX,b.worldY-v.playerWorldY))[0];
      return {x:actor.worldX-v.playerWorldX,distance:Math.hypot(actor.worldX-v.playerWorldX,actor.worldY-v.playerWorldY)};
    });
    if(delta.distance<23)break;
    const key=delta.x<0?'a':'d';await page.keyboard.down(key);await page.waitForTimeout(80);await page.keyboard.up(key);
  }
  await page.locator('.sg-talk-button:visible').waitFor();
  for (const size of [{width:1366,height:768},{width:900,height:650}]) {
    await page.setViewportSize(size);await page.waitForTimeout(300);
    const aligned=await page.evaluate(()=>{
      const host=document.querySelector('sand-game'),g=host._game,v=g.getMissionView();
      const actor=g.getTalkableActors().sort((a,b)=>Math.hypot(a.worldX-v.playerWorldX,a.worldY-v.playerWorldY)-Math.hypot(b.worldX-v.playerWorldX,b.worldY-v.playerWorldY))[0];
      const button=[...host.shadowRoot.querySelectorAll('.sg-talk-button')].find(b=>!b.hidden),r=button.getBoundingClientRect();
      const offset=window.__sandTest.worldOffset(),cell=window.__sandTest.cellRect(actor.worldX-offset.x,actor.headWorldY-offset.y),canvas=host.shadowRoot.querySelector('#sand-main').getBoundingClientRect();
      return Math.abs(r.x+r.width/2-(canvas.x+cell.x/devicePixelRatio))<2 && Math.abs(r.bottom+8-(canvas.y+cell.y/devicePixelRatio))<2;
    });
    check(`NPC speech prompt stays centered above its rendered head at ${size.width}px`,aligned);
  }
  await page.screenshot({path:artifacts+'/npc-prompt.png'});
}, tools: async ({ page, baseURL, check }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/game?nosave', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('sand-game')?._game?.getInventory()?.slots?.length, null, { timeout: 60000 });
  await page.locator('sand-game').evaluate(host => host.shadowRoot.querySelector('.sg-sim').focus());
  const point = (dx, dy) => page.evaluate(({ dx, dy }) => {
    const host = document.querySelector('sand-game'), p = host._game.getPlayer();
    const r = window.__sandTest.cellRect(p.x + dx, p.y + (dy ?? p.h + 1));
    const bounds = host.shadowRoot.querySelector('#sand-main').getBoundingClientRect();
    return { x: bounds.x + (r.x + r.size / 2) / devicePixelRatio,
      y: bounds.y + (r.y + r.size / 2) / devicePixelRatio };
  }, { dx, dy });
  const aim = await point(45, 3);
  await page.mouse.move(aim.x, aim.y);
  const select = definition => page.evaluate(definition => {
    const g = document.querySelector('sand-game')._game;
    g.selectSlot(g.getInventory().slots.findIndex(s => definition === 'pick' ? s.isTool : s.definitionId === definition));
  }, definition);
  await select(300);
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().heldDefinition === 300);
  await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().mana < 75);
  await page.mouse.up();
  await page.waitForFunction(() => {
    const host = document.querySelector('sand-game'), p = host._game.getPlayer();
    const meter = host.shadowRoot.querySelector('[aria-label="Mana"]');
    return Number(meter.getAttribute('aria-valuenow')) === p.mana && p.mana < 80;
  });
  check('wand mana drain reaches the visible HUD', await page.locator('.survival-shield > i').evaluateAll(cells => cells.some(cell => parseFloat(cell.style.getPropertyValue('--fill')) < 100)));
  const vitals = await page.evaluate(() => {
    const p = document.querySelector('sand-game')._game.getPlayer();
    return { mana: p.mana, health: p.health };
  });
  await page.waitForFunction(value => {
    const host = document.querySelector('sand-game'), p = host._game.getPlayer();
    return p.mana > value.mana && p.health === value.health && Number(host.shadowRoot.querySelector('[aria-label="Mana"]').getAttribute('aria-valuenow')) === p.mana;
  }, vitals);
  check('mana regeneration refreshes without changing health or equipment', true);
  await page.screenshot({ path: artifacts + '/mana.png' });
  await select(1);
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().heldDefinition === 1);
  await page.mouse.down();
  await page.waitForTimeout(170);
  await page.screenshot({ path: artifacts + '/sword.png' });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const host = document.querySelector('sand-game'), p = host._game.getPlayer();
    return p.stamina < 100 && Number(host.shadowRoot.querySelector('[aria-label="Stamina"]').getAttribute('aria-valuenow')) === p.stamina;
  });
  check('sword stamina cost reaches the HUD', true);
  await page.waitForFunction(() => !document.querySelector('sand-game')._game.getPlayer().actionTicks);
  await page.keyboard.down('f');
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().shieldActive);
  await page.screenshot({ path: artifacts + '/shield.png' });
  await page.keyboard.up('f');
  await select('pick');
  await page.waitForFunction(() => !document.querySelector('sand-game')._game.getPlayer().actionTicks);
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().heldItemKind === 1);
  const size = () => page.evaluate(() => document.querySelector('sand-game')._game.getInventory().selectedFootprint);
  const originalSize = await size();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getInventory().selectedFootprint === 0);
  check('V enables single-pixel size without opening inventory', await page.getByRole('dialog', { name: 'Inventory', exact: true }).count() === 0);
  await page.keyboard.press('v');
  await page.waitForFunction(value => document.querySelector('sand-game')._game.getInventory().selectedFootprint === value, originalSize);
  await page.keyboard.press('[');
  await page.waitForFunction(value => document.querySelector('sand-game')._game.getInventory().selectedFootprint === value - 1, originalSize);
  await page.keyboard.press(']');
  await page.waitForFunction(value => document.querySelector('sand-game')._game.getInventory().selectedFootprint === value, originalSize);
  check('mining controls show radius instead of square dimensions', await page.getByRole('button', { name: 'Choose tool size (Q)' }).textContent() === `Radius ${originalSize} · Q`);
  await select(1);
  await page.waitForFunction(value => document.querySelector('sand-game').shadowRoot.querySelector('[aria-label="Choose tool size (Q)"]').textContent === `${value + 1}×${value + 1} · Q`, originalSize);
  check('placement sizes retain square dimensions', true);
  await select('pick');
  await page.waitForFunction(value => document.querySelector('sand-game').shadowRoot.querySelector('[aria-label="Choose tool size (Q)"]').textContent === `Radius ${value} · Q`, originalSize);
  await page.keyboard.press('q');
  await page.locator('.fp-panel.open').waitFor();
  check('Q opens the size picker directly', await page.getByRole('dialog', { name: 'Inventory', exact: true }).count() === 0);
  await page.locator('.fp-panel').getByRole('button', { name: '1 pixel', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getInventory().selectedFootprint === 0);
  await page.keyboard.press(']');
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getInventory().selectedFootprint === 1);
  check('choosing a size returns keyboard control to the game', true);
  await page.getByRole('button', { name: 'Toggle single-pixel size (V)', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getInventory().selectedFootprint === 0);
  const ground = await point(2, null);
  await page.mouse.move(ground.x, ground.y);
  await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('sand-game')._game.getPlayer().actionTicks > 0);
  await page.screenshot({ path: artifacts + '/pickaxe.png' });
  await page.mouse.up();
  await page.setViewportSize({ width: 390, height: 844 });
  check('size controls fit on a phone', await page.locator('.fp-controls').evaluate(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
  check('size controls leave the movement hint readable', await page.locator('sand-game').evaluate(host => {
    const controls = host.shadowRoot.querySelector('.fp-controls').getBoundingClientRect();
    const hint = host.shadowRoot.querySelector('.ad-trail-hint').getBoundingClientRect();
    return controls.bottom <= hint.top || controls.left >= hint.right;
  }));
  await page.screenshot({ path: artifacts + '/mobile-size.png' });
  check('tools render without browser errors', errors.length === 0, errors.join('; '));
} });
