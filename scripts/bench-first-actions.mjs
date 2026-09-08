// Cold and repeated attack/hit timings through the live worker, renderer, and mixer.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const actions = (flag('--only') || 'sword,ember,prism').split(',');
const audioModes = flag('--audio') === 'off' ? [false] : flag('--audio') === 'on' ? [true] : [true, false];
const definitions = { sword: 1, ember: 300, prism: 306 };
const server = await startTestServer();
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true,
    args: flag('--angle') ? [`--use-angle=${flag('--angle')}`] : [] });
  for (const audio of audioModes) for (const action of actions) {
    assert.ok(Object.hasOwn(definitions, action), `unknown action ${action}`);
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    try {
      if (!audio) await page.addInitScript(() => { window.AudioContext = window.webkitAudioContext = undefined; });
      await page.goto(`${server.baseURL}/game?nosave`);
      await page.waitForFunction(() => window.__sandTest?.getPlayer(), null, { timeout: 60000 });
      await page.waitForTimeout(3000);
      const renderer = await page.evaluate(() => {
        const gl = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main').getContext('webgl2');
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      });
      await page.evaluate(id => {
        const t = window.__sandTest;
        t.setCreatureRuntime(true, false);
        const slot = t.getInventory().slots.findIndex(s => s.definitionId === id);
        if (slot < 0) throw new Error(`missing equipment ${id}`);
        t.selectSlot(slot);
      }, definitions[action]);
      await page.waitForFunction(id => {
        const inv = window.__sandTest.getInventory();
        return inv.slots[inv.selected]?.definitionId === id;
      }, definitions[action]);
      if (args.includes('--warm-input')) {
        await page.evaluate(() => {
          const button = document.createElement('button');
          button.id = 'first-action-warmup';
          button.textContent = 'Prepare input';
          button.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
          document.body.append(button);
        });
        await page.locator('#first-action-warmup').click();
        await page.locator('#first-action-warmup').evaluate(button => button.remove());
        await page.waitForTimeout(1000);
      }
      const cdp = flag('--trace') ? await page.context().newCDPSession(page) : null;
      if (cdp) await cdp.send('Tracing.start', {
        categories: 'devtools.timeline,v8,blink,gpu,disabled-by-default-devtools.timeline',
        transferMode: 'ReturnAsStream',
      });
      for (const trial of ['first-miss', 'repeat-miss', 'first-hit', 'repeat-hit']) {
        await page.waitForFunction(() => window.__sandTest.renderedProjectiles().length === 0,
          null, { timeout: 15000 });
        const hit = trial.endsWith('hit');
        if (hit) {
          await page.evaluate(() => {
            const t = window.__sandTest, p = t.getPlayer();
            t.setCreatureRuntime(false, false);
            t.setCombatTarget(26, p.x + 16, p.y);
          });
          await page.waitForFunction(() => {
            const creatures = window.__sandTest.getCreatures();
            return creatures.length === 1 && creatures[0].species === 26
              && creatures[0].health === creatures[0].maxHealth;
          });
        }
        await page.evaluate(() => {
          const samples = [], longTasks = [], input = [];
          let frame, last;
          const recordInput = event => input.push({ type: event.type, at: performance.now() });
          for (const type of ['pointermove', 'pointerdown', 'pointerup'])
            window.addEventListener(type, recordInput, { capture: true, passive: true });
          const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ at: e.startTime, duration: e.duration }))));
          observer.observe({ type: 'longtask' });
          function sample(now) {
            if (last !== undefined) samples.push({ at: now, dt: now - last,
              projectileValues: window.__sandTest.renderedProjectiles().length,
              actionTicks: window.__sandTest.getPlayer().actionTicks, ...window.__sandPerf() });
            last = now; frame = requestAnimationFrame(sample);
          }
          frame = requestAnimationFrame(sample);
          const before = window.__sandTest.getCreatures().map(c => ({ id: c.id, health: c.health }));
          const actionsBefore = window.__sandTest.actionCount();
          window.finishActionProbe = () => {
            cancelAnimationFrame(frame); observer.disconnect();
            for (const type of ['pointermove', 'pointerdown', 'pointerup'])
              window.removeEventListener(type, recordInput, { capture: true });
            const after = window.__sandTest.getCreatures();
            return { samples, longTasks, input, actions: window.__sandTest.actionCount() - actionsBefore,
              damaged: before.some(c => {
              const current = after.find(a => a.id === c.id);
              return current ? current.health < c.health : c.health > 0;
            }) };
          };
        });
        const point = await page.evaluate(hit => {
          const t = window.__sandTest, p = t.playerScreen();
          const bounds = document.querySelector('sand-game').shadowRoot.querySelector('#sand-main').getBoundingClientRect();
          if (!hit) return { x: bounds.x + p.x + 140, y: bounds.y + p.y - 150 };
          const hero = t.getPlayer();
          const target = t.getCreatures().filter(c => c.species === 26 && c.alive)
            .sort((a, b) => Math.abs(a.x - hero.x) - Math.abs(b.x - hero.x))[0];
          const rect = t.cellRect(target.x + target.w / 2, target.y + target.h / 2);
          return { x: bounds.x + rect.x / devicePixelRatio, y: bounds.y + rect.y / devicePixelRatio };
        }, hit);
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(100);
        await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up();
        await page.waitForTimeout(1000);
        const data = await page.evaluate(() => window.finishActionProbe());
        assert.ok(data.samples.length > 10, `${action}/${trial}: missing frames`);
        assert.equal(data.actions, 1, `${action}/${trial}: expected one attack`);
        assert.ok(action === 'sword' || data.samples.some(s => s.projectileValues > 0), `${action}/${trial}: no projectile`);
        assert.ok(!hit || data.damaged, `${action}/${trial}: did not hit an enemy`);
        const summary = { action, audio, trial, renderer, warmInput: args.includes('--warm-input'),
          damaged: data.damaged, longTasks: data.longTasks };
        for (const key of ['dt', 'renderMs', 'lightMs', 'stepMs', 'actorMs', 'mirrorApplyMs']) {
          const values = data.samples.map(s => s[key]).sort((a, b) => a - b);
          summary[key] = { p95: values[Math.floor(values.length * .95)], max: values.at(-1) };
        }
        console.log(JSON.stringify(summary));
        results.push({ ...summary, input: data.input, samples: data.samples });
      }
      if (cdp) {
        const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end');
        const { stream } = await complete;
        let trace = '';
        for (;;) {
          const chunk = await cdp.send('IO.read', { handle: stream });
          trace += chunk.data;
          if (chunk.eof) break;
        }
        await cdp.send('IO.close', { handle: stream });
        writeFileSync(`${flag('--trace')}-${action}-${audio ? 'audio' : 'silent'}.json`, trace);
      }
    } finally { await page.close(); }
  }
} finally {
  if (flag('--json')) writeFileSync(flag('--json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close(); await server.close();
}
