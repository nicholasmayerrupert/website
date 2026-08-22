#!/usr/bin/env node

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, readFileSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { decodeReplayCapsule } from '../src/sand/game/replayCapsule.js';
import { npmInvocation, stopDetachedProcess } from './local-vite-process.mjs';
import { getAvailablePort } from './test-port.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const values = new Map();
const flags = new Set();
let capsulePath = null;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--') && !capsulePath) {
    capsulePath = arg;
    continue;
  }
  if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
  const [name, inline] = arg.slice(2).split('=', 2);
  if (inline !== undefined) {
    const list = values.get(name) || [];
    list.push(inline);
    values.set(name, list);
  } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
    const list = values.get(name) || [];
    list.push(argv[++i]);
    values.set(name, list);
  } else {
    flags.add(name);
  }
}

const help = () => {
  console.log(`Usage: node scripts/replay-microscope.mjs <capsule-file|-> [options]

Timeline:
  --at 120,480,900             capture arbitrary turns (repeatable)
  --filmstrip 400:700:25       capture an inclusive turn range
  --around-anomalies 6         capture +/- N turns around the first markers

Inspection:
  --body 0:936                 select and highlight a layer:id body
  --focus body                 center the camera on the selected body
  --cell 123,-45               inspect an absolute world cell (repeatable)
  --overlays bodies,contacts,velocity,labels,status,cells
  --scan-body-limit 512        bodies sampled per turn by anomaly detection

Output/runtime:
  --out <directory>            output directory (defaults to an OS temp folder)
  --viewport 1366x768          browser viewport
  --url http://localhost:5173  use an existing Vite development server
  --headed                     show Chromium
  --json-only                  omit screenshots and the HTML filmstrip
`);
};

if (flags.has('help') || flags.has('h') || !capsulePath) {
  help();
  process.exit(capsulePath ? 0 : 1);
}

const one = (name, fallback = null) => values.get(name)?.at(-1) ?? fallback;
const many = (name) => values.get(name) || [];
const parseBody = (value) => {
  if (!value) return null;
  const match = value.match(/^(\d+):(-?\d+)$/);
  if (!match) throw new Error('--body uses layer:id, for example 0:936.');
  return { layer: Number(match[1]), id: Number(match[2]) };
};
const parseCell = (value) => {
  const match = value.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (!match) throw new Error('--cell uses worldX,worldY.');
  return { x: Number(match[1]), y: Number(match[2]) };
};
const parseViewport = (value) => {
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) throw new Error('--viewport uses WIDTHxHEIGHT.');
  return { width: Number(match[1]), height: Number(match[2]) };
};
const addTurn = (set, value, turns) => {
  const turn = Number(value);
  if (!Number.isInteger(turn)) throw new Error(`Invalid replay turn: ${value}`);
  set.add(Math.max(0, Math.min(turns, turn)));
};
const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const text = capsulePath === '-'
  ? readFileSync(0, 'utf8').trim()
  : readFileSync(resolve(capsulePath), 'utf8').trim();
const capsule = await decodeReplayCapsule(text);
const body = parseBody(one('body'));
const cells = many('cell').map(parseCell);
const focus = one('focus', body ? 'body' : 'recorded');
if (!['recorded', 'body'].includes(focus))
  throw new Error('--focus must be recorded or body.');
const overlays = flags.has('no-overlay') ? [] : one(
  'overlays', 'bodies,contacts,velocity,labels,status,selection,cells',
).split(',').map((name) => name.trim()).filter(Boolean);
const scanBodyLimit = Math.max(1, Number(one('scan-body-limit', 256)) | 0);
const viewport = parseViewport(one('viewport', '1366x768'));
const outputDir = one('out')
  ? resolve(one('out'))
  : mkdtempSync(join(tmpdir(), 'sand-replay-microscope-'));
mkdirSync(outputDir, { recursive: true });

const requestedTurns = new Set();
for (const value of many('at'))
  for (const turn of value.split(',')) addTurn(requestedTurns, turn, capsule.turns);
for (const value of many('filmstrip')) {
  const match = value.match(/^(\d+):(\d+):(\d+)$/);
  if (!match) throw new Error('--filmstrip uses START:END:STEP.');
  const start = Number(match[1]);
  const end = Number(match[2]);
  const step = Math.max(1, Number(match[3]));
  for (let turn = start; turn <= end; turn += step) addTurn(requestedTurns, turn, capsule.turns);
  addTurn(requestedTurns, end, capsule.turns);
}
if (requestedTurns.size === 0) requestedTurns.add(capsule.turns);

const planetNames = ['earth', 'moon', 'mars'];
const weatherNames = ['clear', 'rain'];
let server = null;
let browser = null;
let baseURL = one('url');
const browserErrors = [];

const stopServer = () => {
  if (!server) return;
  try { stopDetachedProcess(server.pid); } catch {}
};

async function waitForServer(url) {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Vite development server timed out.');
}

const frames = [];
try {
  if (!baseURL) {
    const port = await getAvailablePort();
    baseURL = `http://127.0.0.1:${port}`;
    const npm = npmInvocation();
    server = spawn(npm.command, [
      ...npm.args, 'run', 'dev', '--', '--host', '127.0.0.1',
      '--port', String(port), '--strictPort',
    ], { cwd: ROOT, stdio: 'ignore', detached: true });
    await waitForServer(baseURL);
  }

  browser = await chromium.launch({ headless: !flags.has('headed') });
  const page = await browser.newPage({ viewport });
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => customElements.get('sand-game'), null, { timeout: 30000 });
  await page.evaluate(({ survival, planet, weather, seed }) => {
    document.querySelectorAll('sand-game').forEach((node) => node.remove());
    const host = document.createElement('sand-game');
    host.setAttribute('mode', survival ? 'survival' : 'creative');
    host.setAttribute('planet', planet);
    host.setAttribute('weather', weather);
    host.setAttribute('world-seed', String(seed));
    host.setAttribute('auto-start', '');
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.display = 'block';
    host.style.zIndex = '100000';
    document.body.appendChild(host);
  }, {
    survival: !!capsule.init.survival,
    planet: planetNames[capsule.init.planetId | 0] || 'earth',
    weather: weatherNames[capsule.init.weatherId | 0] || 'clear',
    seed: capsule.init.worldSeed >>> 0,
  });
  await page.waitForFunction(
    () => window.__sandReplayMicroscope && document.querySelector('sand-game')?._game,
    null, { timeout: 30000 },
  );
  await page.evaluate((names) => window.__sandReplayMicroscope.setOverlays(names), overlays);
  await page.evaluate(({ replayText, selected, focusMode, inspected, limit }) => (
    window.__sandReplayMicroscope.open(replayText, {
      body: selected, focus: focusMode, cells: inspected, scanBodyLimit: limit,
    })
  ), {
    replayText: text, selected: body, focusMode: focus,
    inspected: cells, limit: scanBodyLimit,
  });

  const around = Math.max(0, Number(one('around-anomalies', 0)) | 0);
  if (around > 0) {
    await page.evaluate(({ turn, selected, focusMode, inspected }) => (
      window.__sandReplayMicroscope.seek(turn, {
        body: selected, focus: focusMode, cells: inspected,
      })
    ), { turn: capsule.turns, selected: body, focusMode: focus, inspected: cells });
    const markers = await page.evaluate(() => window.__sandReplayMicroscope.timeline().markers);
    for (const marker of markers.slice(0, 8)) {
      for (let delta = -around; delta <= around; delta += Math.max(1, Math.floor(around / 3)))
        addTurn(requestedTurns, marker.turn + delta, capsule.turns);
    }
  }

  const sim = page.locator('sand-game').locator('.sg-sim');
  const width = String(capsule.turns).length;
  for (const turn of [...requestedTurns].sort((a, b) => a - b)) {
    const diagnostic = await page.evaluate(({ target, selected, focusMode, inspected }) => (
      window.__sandReplayMicroscope.seek(target, {
        body: selected, focus: focusMode, cells: inspected,
      })
    ), { target: turn, selected: body, focusMode: focus, inspected: cells });
    const stem = `turn-${String(turn).padStart(width, '0')}`;
    const jsonName = `${stem}.json`;
    writeFileSync(join(outputDir, jsonName), `${JSON.stringify(diagnostic, null, 2)}\n`);
    let imageName = null;
    let closeupName = null;
    if (!flags.has('json-only')) {
      imageName = `${stem}.png`;
      await sim.screenshot({ path: join(outputDir, imageName) });
      if (body) {
        const clip = await page.evaluate((selected) => (
          window.__sandReplayMicroscope.screenBounds(selected, 40)
        ), body);
        if (clip?.width > 1 && clip?.height > 1) {
          closeupName = `${stem}-body-${body.layer}-${body.id}.png`;
          await page.screenshot({ path: join(outputDir, closeupName), clip });
        }
      }
    }
    const selected = body
      ? diagnostic.bodies.find((candidate) => candidate.layer === body.layer && candidate.id === body.id)
      : null;
    frames.push({
      turn, tick: diagnostic.tick,
      bodies: diagnostic.bodies.length,
      contacts: diagnostic.contacts.length,
      markers: diagnostic.markers.length,
      selected,
      image: imageName,
      closeup: closeupName,
      data: jsonName,
    });
    console.log(
      `turn ${turn}/${capsule.turns}: tick ${diagnostic.tick}, `
      + `${diagnostic.bodies.length} bodies, ${diagnostic.contacts.length} contacts, `
      + `${diagnostic.markers.length} markers`,
    );
  }

  const timeline = await page.evaluate(() => window.__sandReplayMicroscope.timeline());
  const report = {
    generatedAt: new Date().toISOString(),
    capsule: {
      source: capsulePath,
      turns: capsule.turns,
      events: capsule.events.length,
      abiVersion: capsule.abiVersion,
      abiFingerprint: capsule.abiFingerprint,
      init: capsule.init,
      expectedFinal: capsule.final,
    },
    viewport,
    overlays,
    selectedBody: body,
    inspectedCells: cells,
    markers: timeline.markers,
    frames,
    browserErrors,
  };
  writeFileSync(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

  if (!flags.has('json-only')) {
    const cards = frames.map((item) => `
      <article>
        <h2>Turn ${item.turn} <small>tick ${item.tick}</small></h2>
        ${item.image ? `<a href="${escapeHtml(item.image)}"><img src="${escapeHtml(item.image)}"></a>` : ''}
        ${item.closeup ? `<a href="${escapeHtml(item.closeup)}"><img class="closeup" src="${escapeHtml(item.closeup)}"></a>` : ''}
        <p>${item.bodies} bodies · ${item.contacts} contacts · ${item.markers} markers · <a href="${escapeHtml(item.data)}">diagnostics</a></p>
      </article>`).join('');
    const markerRows = timeline.markers.map((marker) => `
      <tr><td>${marker.turn}</td><td>${escapeHtml(marker.type)}</td><td><code>${escapeHtml(JSON.stringify(marker))}</code></td></tr>`).join('');
    writeFileSync(join(outputDir, 'index.html'), `<!doctype html>
<meta charset="utf-8"><title>Sand replay microscope</title>
<style>
body{margin:0;background:#111;color:#eee;font:14px system-ui;padding:24px}h1{margin-top:0}small{color:#aaa}
.frames{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px}article{background:#1c1c1c;padding:14px;border-radius:8px}
img{display:block;width:100%;height:auto;background:#000}.closeup{margin-top:10px;max-height:420px;object-fit:contain}a{color:#70dfff}table{border-collapse:collapse;width:100%;margin-top:24px}td,th{border:1px solid #444;padding:6px;vertical-align:top}code{white-space:pre-wrap}
</style>
<h1>Sand replay microscope</h1>
<p>${capsule.turns} turns · ${capsule.events.length} events · ${timeline.markers.length} markers</p>
<div class="frames">${cards}</div>
<h2>Timeline markers</h2><table><thead><tr><th>Turn</th><th>Type</th><th>Details</th></tr></thead><tbody>${markerRows}</tbody></table>
`);
  }
  console.log(`Replay microscope output: ${outputDir}`);
} finally {
  await browser?.close().catch(() => {});
  stopServer();
}
