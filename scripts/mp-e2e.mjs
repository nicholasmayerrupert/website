// Two-context multiplayer browser test (Phase 5). Boots the Vite dev server and
// the WebSocket relay, opens two browser contexts (host + client), has the client
// move its character, and asserts both peers observe it — then that disconnecting
// removes the remote player on the host. Uses the `playwright` library directly.
//
//   node scripts/mp-e2e.mjs

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { startServer } from './dev-multiplayer-server.mjs';

const PORT = 5181, WS_PORT = 5191;
const baseURL = `http://localhost:${PORT}/`;
const wsURL = `ws://localhost:${WS_PORT}`;
const ROOM = 'e2e-room';
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

const vite = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
const killVite = () => { try { process.kill(-vite.pid, 'SIGKILL'); } catch { /* gone */ } };
const waitForServer = () => new Promise((resolve, reject) => {
  let buf = '';
  const to = setTimeout(() => { killVite(); reject(new Error('dev server timeout')); }, 60000);
  vite.stdout.on('data', (d) => { buf += d.toString(); if (new RegExp(`localhost:${PORT}`).test(buf)) { clearTimeout(to); resolve(); } });
  vite.stderr.on('data', (d) => { const s = d.toString(); if (/error|in use/i.test(s)) { clearTimeout(to); killVite(); reject(new Error('dev server: ' + s.trim())); } });
});

const relay = startServer(WS_PORT);
let browser;
try {
  await waitForServer();
  // Disable background-tab throttling so BOTH the host and client run their RAF
  // loops at full rate (otherwise a backgrounded page barely sends/processes).
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

  console.log('two-context multiplayer');
  const host = await open();
  const client = await open();

  // host the room, then join from the client
  await host.page.evaluate(([u, r]) => window.__sandNet.host(u, r), [wsURL, ROOM]);
  await host.page.waitForTimeout(200);
  const hostOwnId = await host.page.evaluate(() => window.__sandTest.getPlayer().id);
  await client.page.evaluate(([u, r]) => window.__sandNet.join(u, r), [wsURL, ROOM]);

  // wait for the host to spawn the client's player + the client to be assigned it
  await host.page.waitForFunction(() => window.__sandNet.playerCount() >= 2, null, { timeout: 10000 }).catch(() => {});
  await client.page.waitForFunction(() => window.__sandNet.ownPlayer() != null, null, { timeout: 10000 }).catch(() => {});
  const joined = await host.page.evaluate(() => window.__sandNet.playerCount());
  check(`host sees two players after join (${joined})`, joined === 2);
  const clientHasOwn = await client.page.evaluate(() => window.__sandNet.ownPlayer() != null);
  check('client has an assigned player', clientHasOwn);

  // Drive both peers DETERMINISTICALLY via tickSteps (RAF paused) so the test is
  // immune to background-tab throttling. Signal: FACING — set on the host whenever
  // the client holds LEFT/RIGHT (not edge-triggered, not blocked by terrain) and
  // propagated back in the snapshot. ws delivery happens on real-time awaits.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const remoteFacing = (own) => host.page.evaluate((o) => { const p = window.__sandNet.players().find((q) => q.id !== o); return p ? p.facing : null; }, own);
  const remoteX = (own) => host.page.evaluate((o) => { const p = window.__sandNet.players().find((q) => q.id !== o); return p ? p.x : null; }, own);
  await host.page.evaluate(() => window.__sandTest.setPaused(true));
  await client.page.evaluate(() => window.__sandTest.setPaused(true));

  await host.page.evaluate(() => window.__sandNet.tickSteps(60)); // settle remote on the ground
  const remoteXBefore = await remoteX(hostOwnId);

  // Client holds LEFT -> the host flips the remote player's facing to -1 (default
  // is +1), which both peers then observe via the snapshot.
  await client.page.keyboard.down('a');
  await client.page.evaluate(() => window.__sandNet.tickSteps(3)); // send LEFT input
  const sent = await client.page.evaluate(() => window.__sandNet.debug().sent);
  check(`client actually sent input (${sent})`, sent > 0);
  await sleep(120);
  let hostFacing = await remoteFacing(hostOwnId);
  for (let a = 0; a < 8 && hostFacing !== -1; a++) {
    await host.page.evaluate(() => window.__sandNet.tickSteps(6));
    hostFacing = await remoteFacing(hostOwnId);
    if (hostFacing === -1) break;
    await sleep(80);
  }
  const remoteXAfter = await remoteX(hostOwnId);
  await sleep(120); // host snapshots reach the client
  let clientFacing = null;
  for (let a = 0; a < 8 && clientFacing !== -1; a++) {
    await client.page.evaluate(() => window.__sandNet.tickSteps(6));
    clientFacing = await client.page.evaluate(() => { const p = window.__sandNet.ownPlayer(); return p ? p.facing : null; });
    if (clientFacing === -1) break;
    await sleep(80);
  }
  await client.page.keyboard.up('a');
  check(`host observes the remote player's input (facing ${hostFacing})`, hostFacing === -1);
  check(`client observes its own player via snapshots (facing ${clientFacing})`, clientFacing === -1);
  // movement is terrain-dependent, so this is informational, not a gate
  console.log(`   (remote x ${remoteXBefore?.toFixed(1)} -> ${remoteXAfter?.toFixed(1)})`);

  // world replication: the client receives the host's world and the host's edits.
  // Both peers are still paused; drive them in lockstep via tickSteps. Measure a
  // deep underground region (stable terrain, no sand inflow) so the host's hole
  // replicates cleanly to the client. Region is relative to the live engine dims.
  const dims = await host.page.evaluate(() => window.__sandTest.info());
  const cx = Math.floor(dims.cols / 2), ey = dims.rows - 11;
  const R = [cx - 20, dims.rows - 16, cx + 20, dims.rows - 6];
  const solidIn = (p) => p.evaluate((r) => window.__sandTest.solidCount(r[0], r[1], r[2], r[3]), R);
  // let the initial world snapshot + diffs flow to the client
  for (let i = 0; i < 6; i++) { await host.page.evaluate(() => window.__sandNet.tickSteps(2)); await sleep(40); await client.page.evaluate(() => window.__sandNet.tickSteps(2)); }
  const worldReady = await client.page.evaluate(() => window.__sandNet.debug().worldReady);
  check('client received the host world snapshot', worldReady === true);
  const beforeHost = await solidIn(host.page), beforeClient = await solidIn(client.page);
  check(`client world matches host before edit (client ${beforeClient} ~ host ${beforeHost})`, beforeHost > 0 && Math.abs(beforeClient - beforeHost) <= 2);

  // host digs a hole in that region; the diff must carry it to the client. Poll
  // host-tick + client-tick until the change converges (tolerant of ws jitter).
  await host.page.evaluate(([x, y]) => window.__sandTest.erase(x, y, 7), [cx, ey]);
  let afterHost = beforeHost, afterClient = beforeClient;
  for (let i = 0; i < 15; i++) {
    await host.page.evaluate(() => window.__sandNet.tickSteps(2)); await sleep(40); await client.page.evaluate(() => window.__sandNet.tickSteps(2));
    afterHost = await solidIn(host.page); afterClient = await solidIn(client.page);
    if (afterHost < beforeHost && Math.abs(afterClient - afterHost) <= 8) break;
  }
  check(`host edit replicated to client (host ${beforeHost}->${afterHost}, client ${beforeClient}->${afterClient})`, afterHost < beforeHost && afterClient < beforeClient && Math.abs(afterClient - afterHost) <= 8);

  // disconnect the client -> the host drops the remote player
  await client.page.evaluate(() => window.__sandNet.disconnect());
  await sleep(200); // relay broadcasts the leave to the host
  await host.page.evaluate(() => window.__sandNet.tickSteps(3)); // host processes the leave
  const afterLeave = await host.page.evaluate(() => window.__sandNet.playerCount());
  check(`host drops the remote player on disconnect (${afterLeave})`, afterLeave === 1);

  await browser.close();
} catch (err) {
  console.error('mp-e2e error:', err.message);
  failures++;
} finally {
  if (browser) await browser.close().catch(() => {});
  await relay.close().catch(() => {});
  killVite();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
