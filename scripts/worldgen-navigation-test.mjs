// Real walking/jumping routes must reach rooms and return to their entrance.
// Architectural stability and streaming parity are covered by the structure suites.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { initSandWasm, createEngineWasm, WORLD_FEATURE, WORLD_AREA, PLANET, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { navigationGraph, moveWorldWindow, entranceStart, indoorPlatforms, reachesPlatform } from './structure-navigation.mjs';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('structure navigation');
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/structure-navigation.json', import.meta.url)));
const make = (seed, options = {}) => createEngineWasm({ cols: 512, rows: 448, worldSeed: seed, infinite: true, sinksOn: false, ...options });
const failures = [];
function verify(name, graph, targets) {
  const missed = targets.filter(t => !graph.reaches(t.x, t.feet, t.radius ?? 7));
  const ok = graph.root >= 0 && !graph.truncated && targets.length > 0 && !missed.length;
  check(`${name}: enter, reach ${targets.length} destinations, and return`, ok);
  if (!ok) failures.push({ name, missed, graph: { nodes: graph.nodes, returns: [...graph.returns], root: graph.root } });
}

// Negative controls distinguish physical navigation from empty-space flooding,
// and a visit from a route that also permits escape.
{
  const e = make(0, { cols: 128, rows: 128, infinite: false });
  e.eraseDisc(64, 64, 100);
  const block = (l, t, r, b) => {
    for (let y = t; y <= b; y++) for (let x = l; x <= r; x++) e.paintDisc(x, y, 0, MAT.STONE, true);
    e.syncComponents();
  };
  block(0, 90, 127, 127); block(60, 0, 63, 89);
  let nav = navigationGraph(e, { left: 0, top: 0, right: 127, bottom: 120 }, [25, 90]);
  check('a sealed wall is rejected', nav.root >= 0 && !nav.reaches(90, 90));
  e.eraseDisc(64, 64, 100); block(0, 40, 47, 127); block(48, 110, 127, 127);
  nav = navigationGraph(e, { left: 0, top: 0, right: 127, bottom: 120 }, [25, 40]);
  check('a deep drop can be visited but cannot pass the return-trip check',
    nav.nodes.some(p => p.x > 60 && p.feet === 110) && !nav.reaches(80, 110));
  e.destroy();
}

check('village fixtures cover every occupation and all seven settlement biomes',
  new Set(fixtures.villages.map(v => v[0].split(':')[1])).size === 5
  && new Set(fixtures.villages.map(v => v[0].split(':')[0])).size === 7);
for (const [name, seed, x, y] of fixtures.villages) {
  const e = make(seed); moveWorldWindow(e, x, y);
  const c = e.worldContextAt(x, y - 5), b = c.bounds;
  check(`${name}: correct generated building`, c.featureKind === WORLD_FEATURE.VILLAGE_BUILDING);
  const bounds = { left: b.left - 16, right: b.right + 16, top: b.top - 24, bottom: y + 40 };
  const start = entranceStart(e, b.left - 4, y);
  const nav = navigationGraph(e, bounds, start);
  verify(name, nav, [b.left + 8, x, b.right - 8].map(x => ({ x, feet: y, radius: 4 })));
  e.destroy();
}

const landmarkTargets = {
  0: [[-46,-1],[47,-1],[4,-23]],
  2: [[-70,'west1'],[-70,'west2'],[70,'east1'],[70,'east2'],[-12,-22],[-12,-44],[30,-1]],
  3: [[-15,-1],[61,-22],[61,-44]],
  4: [[0,0],[0,-18],[0,-36],[0,19],[-43,37],[43,37]],
  5: [[-56,-1],[56,-1],[-43,36],[43,36],[0,55]],
  7: [[0,-1],[0,29]], 8: [[0,-1]],
  9: [[-62,-23],[61,-22],[0,-24],[-62,-45],[61,-44]],
  10: [[0,0],[-44,-23],[0,-23],[-30,-35],[0,-35],[-18,-47],[4,-47],[0,-61],[0,21]],
  11: [[0,-1]], 12: [[-66,-3],[0,-8],[66,-3]], 13: [[0,8]],
  14: [[0,-1],[-72,-22],[-72,-44],[72,-22],[72,-44]],
  15: [[-51,-1],[40,-22]], 16: [[-62,'igloo'],[0,'igloo'],[62,'igloo']],
  17: [[-49,'hut'],[49,'hut']], 18: [[0,'lookout']],
};
check('all seventeen inhabited landmark archetypes have destinations', Object.keys(landmarkTargets).length === 17);
for (const [kind, seed, x, y] of fixtures.landmarks) {
  if (!landmarkTargets[kind]) continue; // Aqueduct and leviathan are outdoor ruins.
  const e = make(seed); moveWorldWindow(e, x, y);
  const c = e.worldContextAt(x, y), b = c.bounds;
  check(`landmark ${kind}: planned landmark`, c.featureKind === WORLD_FEATURE.LANDMARK);
  const nav = navigationGraph(e, b, entranceStart(e, b.left + 5, e.worldSurfaceAbsAt(b.left + 5)));
  const targets = landmarkTargets[kind].map(([dx, dy]) => {
    let feet = y + dy;
    if (dy === 'igloo' || dy === 'hut') feet = e.worldSurfaceAbsAt(x + dx) - 2;
    else if (dy === 'lookout') feet = e.worldSurfaceAbsAt(x) - 36;
    else if (typeof dy === 'string') {
      const base = Math.max(-8, Math.min(8, e.worldSurfaceAbsAt(x + dx) - y));
      feet = y + base - (dy.endsWith('1') ? 22 : 44);
    }
    return { x: x + dx, feet, radius: 9 };
  });
  verify(`landmark ${kind}`, nav, targets); e.destroy();
}

check('all twenty cave architecture designs have fixtures', fixtures.caves.length === 20);
for (const [kind, seed, x, y] of fixtures.caves) {
  const e = make(seed); moveWorldWindow(e, x, y);
  const c = e.worldContextAt(x, y), b = c.bounds, deep = kind >= 8;
  check(`cave ${kind}: planned cave architecture`, c.featureKind === (deep ? WORLD_FEATURE.DEEP_STRUCTURE : WORLD_FEATURE.RUIN));
  const interior = { ...b, left: b.left + (deep ? 22 : 0), right: b.right - (deep ? 22 : 0) };
  const platforms = indoorPlatforms(e, interior, c => !!(c.tags & WORLD_AREA.INDOOR));
  const first = platforms.reduce((a, p) => !a || p.left < a.left ? p : a, null);
  const nav = navigationGraph(e, b, [first?.left ?? x, first?.feet ?? y]);
  const missed = platforms.filter(p => !reachesPlatform(nav, p));
  const ok = first && !nav.truncated && !missed.length;
  check(`cave ${kind}: every room floor connects to the entrance and back (${platforms.length} platforms)`, ok);
  if (!ok) failures.push({ name: `cave ${kind}`, missed, nodes: nav.nodes });
  e.destroy();
}

for (const [, seed, x, y] of fixtures.mines) {
  const e = make(seed); moveWorldWindow(e, x, y + 100);
  const head = e.worldContextAt(x, y - 5).bounds, rooms = new Map();
  for (let wy = y + 45; wy < y + 300; wy += 3) for (let wx = x - 120; wx < x + 120; wx += 7) {
    const c = e.worldContextAt(wx, wy);
    if (c.featureKind === WORLD_FEATURE.MINE && c.bounds.right - c.bounds.left > 20)
      rooms.set(JSON.stringify(c.bounds), c.bounds);
  }
  const targets = [...rooms.values()].map(b => ({ x: (b.left + b.right) / 2, feet: b.bottom, radius: 10 }));
  check('mine contains multiple galleries and side offices', targets.length >= 6);
  const bounds = { left: x - 135, right: x + 135, top: head.top - 20, bottom: Math.max(...targets.map(t => t.feet)) + 10 };
  verify('mine and headhouse', navigationGraph(e, bounds, entranceStart(e, head.left - 6, y)), targets);
  e.destroy();
}

const facilityUpper = {
  0: [[-25,-15],[25,-15]], 1: [], 2: [],
  3: [[-62,-20],[0,-30],[62,-20]],
  4: [[-48,-22],[-48,-46],[48,-21],[48,-33]],
  5: [[-20,-22],[20,-22]],
};
check('all six off-world facility archetypes have fixtures', fixtures.facilities.length === 6);
for (const [kind, seed, x, y] of fixtures.facilities) {
  const e = make(seed, { planetId: kind < 3 ? PLANET.MOON : PLANET.MARS }); moveWorldWindow(e, x, y + 20);
  const c = e.worldContextAt(x, y + 85), b = c.bounds;
  const bounds = { ...b, left: b.left - 24, right: b.right + 24 };
  const start = entranceStart(e, b.left - 4, y);
  const nav = navigationGraph(e, bounds, start);
  const targets = [[-60,0],[60,0],...facilityUpper[kind],[-40,68],[40,68],[-40,102],[40,102],[0,b.bottom-y-2]]
    .map(([dx,dy]) => ({ x: x + dx, feet: y + dy, radius: 14 }));
  verify(`facility ${kind}`, nav, targets); e.destroy();
}
{
  const e = make(7, { planetId: PLANET.SHIP }); moveWorldWindow(e, 0, 0);
  const nav = navigationGraph(e, { left: -172, right: 182, top: -60, bottom: 23 }, [-110,18]);
  verify('ship: both decks and all compartments', nav, [-120,-50,50,130].flatMap(x => [18,-18].map(feet => ({ x,feet }))));
  e.destroy();
}
// Small legacy ruins also need a continuous aisle through their furnishings.
check('all eight legacy ruin archetypes have fixtures', fixtures.ruins.length === 8);
for (const [kind, seed, x, floor] of fixtures.ruins) {
  const e = make(seed); moveWorldWindow(e, x, floor);
  const c = e.worldContextAt(x, floor - 5), b = c.bounds;
  check(`legacy ruin ${kind}: planned ruin`, c.featureKind === WORLD_FEATURE.RUIN);
  const bounds = { ...b, left: b.left - 8, right: b.right + 8 };
  const start = entranceStart(e, b.left + 1, floor);
  const nav = navigationGraph(e, bounds, start);
  verify(`legacy ruin ${kind}`, nav, [b.left + 7, x, b.right - 8].map(x => ({ x, feet: floor, radius: 5 })));
  e.destroy();
}

// The authored campaign keeps its deliberate repair/mining objectives. The
// occupied lodge, cellar, attic, and observatory still have ordinary access.
{
  const e = make(0x41535452, { planetId: PLANET.FRONTIER }); moveWorldWindow(e, 0, 0);
  let nav = navigationGraph(e, { left: -170, right: 180, top: -100, bottom: 110 }, entranceStart(e, -16, 14));
  verify('Hearthwood: lodge, greenhouse, attic and cellar', nav,
    [{ x: -64, feet: 14 }, { x: 96, feet: 14 }, { x: -28, feet: -36 }, { x: -100, feet: 88 }, { x: 30, feet: 88 }]);
  const y = e.worldSurfaceAbsAt(900); moveWorldWindow(e, 900, y - 70);
  nav = navigationGraph(e, { left: 840, right: 960, top: y - 178, bottom: y + 10 }, entranceStart(e, 848, y));
  verify('Windward observatory: every landing and instrument', nav,
    [-17,-38,-59,-80,-101,-122].map((dy,i) => ({ x: 900 + (i % 2 ? 15 : -15), feet: y + dy })));
  e.destroy();
}

if (failures.length) {
  const dir = process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts'; mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'navigation-failures.json'), JSON.stringify(failures));
  console.log('Unreachable destinations:', failures.map(f => ({ name: f.name, missed: f.missed })));
}
process.exitCode = done() ? 1 : 0;
