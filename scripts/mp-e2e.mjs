// Two-context multiplayer browser test (Phase 9, authoritative server). Boots the
// Vite dev server AND the headless authoritative sand-server, opens two browser
// contexts that each JOIN the server as pure clients, and asserts the full new
// feature set replicates across both real browsers + the real server:
//   - both clients see two players + the server's world (matching terrain)
//   - per-player inventory syncs (select + cursor pick are private to each player)
//   - dropped items replicate (a thrown item appears on both clients)
//   - disconnect drops the player for the remaining client
//
// The server runs its own real-time fixed-step loop; clients never simulate the
// world. We PAUSE each client's RAF and pump it deterministically with tickSteps
// (which sends input + drains inbound server messages), with real-time sleeps in
// between so the server can process + broadcast. World *diff* replication is
// covered exhaustively in-process by scripts/net-test.mjs (§10/§11).
//
//   node scripts/mp-e2e.mjs

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { startSandServer } from './sand-server.mjs';
import { MAT } from '../src/sand/materials.js';

const PORT = 5181, WS_PORT = 5196;
const NPM = process.platform === 'win32' ? process.execPath : 'npm';
const NPM_ARGS = process.platform === 'win32' ? [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')] : [];
const baseURL = `http://localhost:${PORT}/`;
const wsURL = `ws://localhost:${WS_PORT}`;
const ROOM = 'e2e-room';
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vite = spawn(NPM, [...NPM_ARGS, 'run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
const killVite = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(vite.pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-vite.pid, 'SIGKILL');
  } catch { /* gone */ }
};
const waitForServer = () => new Promise((resolve, reject) => {
  let buf = '';
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); resolve(); };
  const fail = (err) => { if (done) return; done = true; clearTimeout(to); clearInterval(poll); killVite(); reject(err); };
  const to = setTimeout(() => fail(new Error('dev server timeout')), 60000);
  const poll = setInterval(async () => {
    try { if ((await fetch(baseURL)).ok) finish(); } catch {}
  }, 500);
  vite.stdout.on('data', (d) => { buf += d.toString(); if (new RegExp(`localhost:${PORT}`).test(buf)) finish(); });
  vite.stderr.on('data', (d) => { const s = d.toString(); if (/error|in use/i.test(s)) fail(new Error('dev server: ' + s.trim())); });
});

const srv = await startSandServer({ port: WS_PORT, cols: 256, rows: 160, seed: 0x1234, room: ROOM });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ] });
  const open = async () => {
    const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}game`, { waitUntil: 'load' }); // survival mode (players live at /game)
    await page.waitForFunction(() => window.__sandNet && window.__sandTest && window.__sandTest.getPlayer(), null, { timeout: 30000 });
    return { ctx, page };
  };

  console.log('two-context multiplayer (authoritative server)');
  const a = await open();
  const b = await open();

  // Pause both clients' RAF; drive them deterministically with tickSteps + sleeps.
  await a.page.evaluate(() => window.__sandTest.setPaused(true));
  await b.page.evaluate(() => window.__sandTest.setPaused(true));

  // A refused connection must be a transaction: keep the local player and keep
  // stepping the single-player engine without a page refresh.
  const localBefore = await a.page.evaluate(() => ({ player: window.__sandTest.getPlayer(), count: window.__sandNet.playerCount() }));
  const failedJoin = await a.page.evaluate(async (u) => {
    try { await window.__sandNet.join(u, 'missing'); return false; } catch { return true; }
  }, `ws://localhost:${WS_PORT + 1}`);
  await a.page.evaluate(() => window.__sandNet.tickSteps(4));
  const localAfter = await a.page.evaluate(() => ({ player: window.__sandTest.getPlayer(), count: window.__sandNet.playerCount(), status: window.__sandNet.status() }));
  check('unavailable server rejects the join', failedJoin);
  check('failed join keeps the local player', !!localBefore.player && !!localAfter.player && localBefore.player.id === localAfter.player.id && localAfter.count === 1);
  check('failed join clears connected client state', !localAfter.status.connected && localAfter.status.role === null && !localAfter.status.worldReady);

  // Pump BOTH clients (send input + drain inbound) then let the server tick/reply.
  const pump = async (n = 4, ms = 90) => {
    await a.page.evaluate((k) => window.__sandNet.tickSteps(k), n);
    await b.page.evaluate((k) => window.__sandNet.tickSteps(k), n);
    await sleep(ms);
  };

  // both clients join the authoritative server
  await a.page.evaluate(([u, r]) => window.__sandNet.join(u, r), [wsURL, ROOM]);
  await b.page.evaluate(([u, r]) => window.__sandNet.join(u, r), [wsURL, ROOM]);

  // wait for both to be assigned a player + receive the world.
  let count = 0;
  for (let i = 0; i < 25; i++) {
    await pump();
    count = await a.page.evaluate(() => window.__sandNet.playerCount());
    const wr = await a.page.evaluate(() => window.__sandNet.debug().worldReady);
    if (count >= 2 && wr) break;
  }
  check(`client A sees two players (${count})`, count === 2);
  check('client B sees two players', (await b.page.evaluate(() => window.__sandNet.playerCount())) === 2);
  check('client A has an assigned player', await a.page.evaluate(() => window.__sandNet.ownPlayer() != null));

  // world replication: both clients adopted the server's buffer dims and render
  // the SAME terrain (full-world snapshot across two real browsers).
  const dimsA = await a.page.evaluate(() => window.__sandTest.info());
  check(`client A adopted server world dims (${dimsA.cols}x${dimsA.rows})`, dimsA.cols === srv.cols && dimsA.rows === srv.rows);
  const region = [Math.floor(srv.cols / 2) - 20, srv.rows - 16, Math.floor(srv.cols / 2) + 20, srv.rows - 6];
  const solid = (p) => p.evaluate((r) => window.__sandTest.solidCount(r[0], r[1], r[2], r[3]), region);
  const solidA = await solid(a.page), solidB = await solid(b.page);
  check(`both clients render the same server terrain (A ${solidA} ~ B ${solidB})`, solidA > 0 && Math.abs(solidA - solidB) <= 2);

  // Survival begins with bare hands: all inventory slots are empty.
  const inventoryEmpty = (page) => page.evaluate(() => window.__sandNet.ownInventory()?.slots?.every((slot) => !slot.count));
  check('client A begins with bare hands', await inventoryEmpty(a.page));
  check('client B begins with bare hands', await inventoryEmpty(b.page));

  // Give each authoritative player a distinct stack so the private inventory
  // and cursor replication checks below exercise real state changes.
  const pidA = await a.page.evaluate(() => window.__sandNet.ownPlayer()?.id);
  const pidB = await b.page.evaluate(() => window.__sandNet.ownPlayer()?.id);
  srv.engine.addToInventory(pidA, MAT.STONE, 3);
  srv.engine.addToInventory(pidB, MAT.WOOD, 2);
  for (let i = 0; i < 12; i++) {
    await pump();
    const ready = await a.page.evaluate(() => (window.__sandNet.ownInventory()?.slots?.[0]?.count ?? 0) === 3);
    if (ready) break;
  }

  // per-player inventory sync: A selects slot 3 -> only A's selected changes.
  await a.page.evaluate(() => window.__sandNet.select(3));
  let selA = 0, selB = 0;
  for (let i = 0; i < 12; i++) { await pump(); selA = await a.page.evaluate(() => window.__sandNet.ownInventory()?.selected ?? -1); if (selA === 3) break; }
  selB = await b.page.evaluate(() => window.__sandNet.ownInventory()?.selected ?? -1);
  check(`client A selected slot synced (${selA})`, selA === 3);
  check(`client B selection unaffected (${selB})`, selB === 0);

  // cursor sync: A picks slot 0 onto its cursor -> A carries it, slot 0 empties;
  // B is unaffected (its own wood stack stays in slot 0).
  await a.page.evaluate(() => window.__sandNet.pick(0, false));
  let curA = null;
  for (let i = 0; i < 12; i++) { await pump(); curA = await a.page.evaluate(() => window.__sandNet.ownCursor()); if (curA) break; }
  check('client A carries a cursor stack after pick', curA != null);
  check('client A slot 0 emptied after pick', await a.page.evaluate(() => (window.__sandNet.ownInventory()?.slots?.[0]?.count ?? 0) === 0));
  check('client B slot 0 still holds its stack', await b.page.evaluate(() => (window.__sandNet.ownInventory()?.slots?.[0]?.count ?? 0) === 2));

  // item replication: a dropped item spawned on the SERVER (far from both players
  // so it isn't immediately vacuumed) must appear on BOTH clients' item views.
  srv.engine.spawnItem(MAT.STONE, 3, 30, 20, 0, 0);
  let itemsA = 0, itemsB = 0;
  for (let i = 0; i < 15; i++) { await pump(); itemsA = await a.page.evaluate(() => window.__sandNet.items()); itemsB = await b.page.evaluate(() => window.__sandNet.items()); if (itemsA >= 1 && itemsB >= 1) break; }
  check(`server item replicated to client A (${itemsA})`, itemsA >= 1);
  check(`server item replicated to client B (${itemsB})`, itemsB >= 1);

  // disconnect A -> the server drops A's player; B converges to one player.
  await a.page.evaluate(() => window.__sandNet.disconnect());
  let bCount = 2;
  for (let i = 0; i < 15; i++) { await b.page.evaluate((k) => window.__sandNet.tickSteps(k), 4); await sleep(90); bCount = await b.page.evaluate(() => window.__sandNet.playerCount()); if (bCount === 1) break; }
  check(`server drops the disconnected player (B sees ${bCount})`, bCount === 1);

  await browser.close();
} catch (err) {
  console.error('mp-e2e error:', err.message);
  failures++;
} finally {
  if (browser) await browser.close().catch(() => {});
  await srv.close().catch(() => {});
  killVite();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
