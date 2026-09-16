// Jump intent, traversal tolerances, and authority/prediction parity at 60 Hz.
import assert from 'node:assert/strict';
import { initSandWasm, createEngineWasm, INPUT, PLANET, MAT } from '../src/sand/wasmBridge/engineFactory.js';
import { Predictor } from '../src/sand/worker/playerPrediction.js';
import { MISSION, STATUS_CONTROL } from '../src/sand/wasmBridge/abi.generated.js';

await initSandWasm();
const options = { cols: 240, rows: 160, worldSeed: 73, planetId: PLANET.FRONTIER, sinksOn: false };
const run = INPUT.RIGHT | INPUT.RUN;
const block = (e, x0, x1, y0, y1) => {
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) e.paintDisc(x, y, 0, MAT.STONE, true);
  e.syncComponents();
};
function fixture(floorEnd = 240) {
  const e = createEngineWasm(options);
  block(e, 0, floorEnd, 130, 132);
  const id = e.spawnPlayer(60, 122);
  const reset = (state = {}) => e.setPlayerState(id, {
    x: 60, y: 122, grounded: true, jumpReady: true, ...state,
  });
  const tick = (bits = 0) => {
    e.setPlayerInput(id, { bits }); e.stepPlayerOnly(id); return e.getPlayer(id);
  };
  reset();
  return { e, id, reset, tick, p: () => e.getPlayer(id) };
}
const test = (name, fn) => { fn(); console.log(`ok: ${name}`); };

test('tap, medium, and held jumps have distinct useful heights; full reach is preserved', () => {
  const f = fixture();
  try {
    const arcs = [];
    for (const hold of [1, 8, 90]) {
      f.reset({ vx: 1.33875 });
      let peak = 122, apex = 0, p, ticks;
      for (ticks = 1; ticks <= 100; ticks++) {
        p = f.tick(run | (ticks <= hold ? INPUT.JUMP : 0));
        if (p.y < peak) { peak = p.y; apex = ticks; }
        if (ticks > 1 && p.grounded) break;
      }
      arcs.push({ hold, height: 122 - peak, apex, ticks, distance: p.x - 60 });
    }
    console.log('jump metrics:', JSON.stringify(arcs));
    assert.ok(arcs[0].height > 6 && arcs[0].height < 9);
    assert.ok(arcs[1].height > arcs[0].height + 5 && arcs[1].height < arcs[2].height - 3);
    assert.ok(Math.abs(arcs[2].height - 25.49) < 0.1);
    assert.ok(arcs[2].distance > 67 && arcs[2].distance < 70);
    assert.equal(arcs[2].apex, 26);
    assert.equal(arcs[2].ticks, 51);
  } finally { f.e.destroy(); }
});

test('coyote jump works through six unsupported ticks and expires on the seventh', () => {
  for (const delay of [0, 5, 6]) {
    const f = fixture(64);
    try {
      f.reset({ vx: 1.33875 });
      let p;
      do { p = f.tick(run); } while (p.grounded);
      assert.equal(p.coyoteTicks, 6);
      for (let i = 0; i < delay; i++) f.tick(run);
      p = f.tick(run | INPUT.JUMP);
      assert.equal(p.vy < 0, delay < 6);
      if (delay < 6) {
        assert.equal(p.coyoteTicks, 0);
        f.tick(run);
        const before = f.p().vy;
        assert.ok(f.tick(run | INPUT.JUMP).vy > before, 'a fresh press cannot double jump');
      }
    } finally { f.e.destroy(); }
  }
});

test('early landing presses chain immediately, including a released buffered tap', () => {
  for (const release of [false, true]) {
    const f = fixture();
    try {
      f.reset({ airDashUsed: true, abilities: 1 });
      f.tick(INPUT.JUMP);
      for (let i = 0; i < 30; i++) f.tick(INPUT.JUMP);
      f.tick(); // release while falling, then wait until the landing is close
      while (f.p().y < 116) f.tick();
      let p = f.tick(INPUT.JUMP);
      assert.ok(p.jumpBufferTicks > 0);
      let bounced = false;
      for (let i = 0; i < 7; i++) {
        p = f.tick(release ? 0 : INPUT.JUMP);
        if (p.vy < 0) { bounced = true; break; }
      }
      assert.ok(bounced, 'the landing consumes the early press without waiting for another press');
      assert.equal(p.grounded, false);
      assert.equal(p.jumpBufferTicks, 0);
      assert.equal(p.jumpActive, true);
      assert.equal(p.airDashUsed, false, 'a buffered landing also restores the air dash');
      assert.ok(release ? p.vy >= -0.95 : p.vy < -2, 'a released buffer produces a short hop');
    } finally { f.e.destroy(); }
  }
});

test('stale presses and a held jump never cause an unexpected landing bounce', () => {
  const f = fixture();
  try {
    f.reset({ y: 60, grounded: false });
    f.tick(INPUT.JUMP);
    for (let i = 0; i < 65; i++) f.tick(INPUT.JUMP);
    assert.equal(f.p().grounded, true);
    assert.equal(f.p().jumpBufferTicks, 0);
    f.tick(); f.tick(INPUT.JUMP);
    for (let i = 0; i < 90; i++) f.tick(INPUT.JUMP);
    assert.equal(f.p().grounded, true);
    assert.equal(f.p().jumpActive, false);
  } finally { f.e.destroy(); }
});

test('the landing buffer includes its seventh tick and expires on its eighth', () => {
  for (const ticks of [7, 8]) {
    const f = fixture();
    try {
      const fall = ticks + 0.078125 * ticks * (ticks + 1) / 2;
      f.reset({ y: 121.25 - fall, vy: 1, grounded: false });
      let p;
      for (let i = 0; i < ticks; i++) p = f.tick(INPUT.JUMP);
      assert.equal(p.vy < 0, ticks === 7);
      assert.equal(p.jumpBufferTicks, 0);
    } finally { f.e.destroy(); }
  }
});

test('rooting cancels queued jumps and jump release does not cut external upward momentum', () => {
  const f = fixture();
  try {
    f.reset({ coyoteTicks: 6, jumpBufferTicks: 7, statusControls: STATUS_CONTROL.ROOT });
    let p = f.tick(INPUT.JUMP);
    assert.equal(p.coyoteTicks, 0);
    assert.equal(p.jumpBufferTicks, 0);
    assert.ok(p.vy >= 0);
    f.e.setPlayerState(f.id, { ...p, statusControls: 0 });
    assert.ok(f.tick(INPUT.JUMP).vy >= 0, 'holding through root expiry does not invent a press');
    f.reset({ y: 80, vy: -4, grounded: false });
    assert.ok(f.tick().vy < -3.9, 'release only cuts a player-initiated jump');
    f.reset({ y: 80, vy: -4, grounded: false, jumpActive: true, jumpReady: true });
    assert.ok(f.tick().vy < -3.9, 'an already released jump cannot repeatedly cut later impulses');
  } finally { f.e.destroy(); }
});

test('air release stops within five cells; reversal and acceleration remain responsive', () => {
  const f = fixture();
  try {
    f.reset({ y: 50, grounded: false, vx: 1.33875 });
    for (let i = 0; i < 8; i++) f.tick(INPUT.RUN);
    assert.equal(f.p().vx, 0);
    assert.ok(f.p().x - 60 < 5);
    console.log('air release distance:', (f.p().x - 60).toFixed(2));
    f.reset({ y: 50, grounded: false, vx: 1.33875 });
    for (let i = 0; i < 4; i++) f.tick(INPUT.LEFT | INPUT.RUN);
    assert.ok(f.p().vx < 0);
    f.reset({ y: 50, grounded: false });
    for (let i = 0; i < 5; i++) f.tick(run);
    assert.ok(f.p().vx > 1.33);
  } finally { f.e.destroy(); }
});

test('head corners nudge one cell in either direction; flat and enclosed ceilings block', () => {
  for (const side of [-1, 1]) {
    for (const enclosed of [false, true]) {
      const f = fixture();
      try {
        const cornerX = side === -1 ? 63 : 60;
        block(f.e, cornerX, cornerX + 1, 69, 70);
        if (enclosed) block(f.e, side === -1 ? 59 : 64, side === -1 ? 60 : 65, 70, 78);
        f.reset({ y: 70, vy: -1.5, grounded: false, jumpActive: true });
        const p = f.tick(INPUT.JUMP);
        assert.equal(p.vy < 0, !enclosed);
        assert.equal(p.x, enclosed ? 60 : 60 + side);
      } finally { f.e.destroy(); }
    }
  }
  const f = fixture();
  try {
    block(f.e, 50, 75, 69, 70);
    f.reset({ y: 70, vy: -1.5, grounded: false, jumpActive: true });
    assert.equal(f.tick(INPUT.JUMP).vy, 0);
    assert.equal(f.p().x, 60);
  } finally { f.e.destroy(); }
});

test('a one-cell landing miss is caught; taller walls and low ceilings are respected', () => {
  for (const [height, ceiling] of [[1, false], [2, false], [1, true]]) {
    const f = fixture();
    try {
      block(f.e, 64, 100, 100 - height, 130);
      if (ceiling) block(f.e, 60, 64, 91, 92);
      f.reset({ y: 92, vx: 0.8, vy: 0.2, grounded: false });
      const p = f.tick(INPUT.RIGHT);
      const assisted = height === 1 && !ceiling;
      assert.equal(p.x > 60, assisted);
      if (assisted) { assert.ok(p.y <= 91.01); assert.equal(p.grounded, true); }
    } finally { f.e.destroy(); }
  }
});

test('narrow elevated landings can be crossed in a buffered jump sequence', () => {
  const f = fixture(72);
  try {
    block(f.e, 96, 108, 120, 132);
    block(f.e, 136, 148, 110, 132);
    f.reset({ x: 64, vx: 0.7875 });
    f.tick(INPUT.RIGHT | INPUT.JUMP);
    let jumps = 1, lastVy = -2, highestX = 64;
    for (let i = 0; i < 180; i++) {
      const p = f.p();
      // Run across a platform, release horizontal input above its landing, and
      // queue the next jump as the feet approach it.
      const target = jumps === 1 ? 98 : 138;
      let bits = p.x < target ? INPUT.RIGHT : 0;
      const landingY = jumps === 1 ? 112 : 102;
      if (p.vy < 0 || (p.vy > 0 && p.y > landingY - 5 && p.y < landingY)) bits |= INPUT.JUMP;
      const next = f.tick(bits);
      if (lastVy > 0 && next.vy < 0) jumps++;
      highestX = Math.max(highestX, next.x); lastVy = next.vy;
      if (jumps >= 3) break;
    }
    assert.ok(jumps >= 3 && highestX + f.p().w > 136, `chain ended at x=${highestX}, jumps=${jumps}`);
  } finally { f.e.destroy(); }
});

test('reconciliation replays coyote, buffered, and variable jumps with the same result', () => {
  const authority = fixture(), mirror = fixture();
  try {
    for (const state of [
      { y: 80, grounded: false, coyoteTicks: 4 },
      { y: 119, vy: 1.5, grounded: false, jumpBufferTicks: 5, jumpReady: false },
      { y: 100, vy: -1.5, grounded: false, jumpActive: true, jumpReady: false },
    ]) {
      authority.reset(state);
      const predictor = new Predictor(mirror.e, mirror.id);
      const initial = authority.p();
      predictor.reconcile(initial, 0, authority.e.getActorTick());
      for (let seq = 1; seq <= 3; seq++) {
        const bits = seq === 1 ? INPUT.JUMP : 0;
        authority.e.setPlayerInput(authority.id, { bits, seq });
        authority.e.stepActors();
        predictor.predict(seq, { bits });
      }
      predictor.reconcile(initial, 0, authority.e.getActorTick() - 3);
      const actual = authority.p(), predicted = predictor.state();
      for (const key of ['x', 'y', 'vx', 'vy']) assert.ok(Math.abs(actual[key] - predicted[key]) < 0.001, key);
      for (const key of ['grounded', 'jumpReady', 'coyoteTicks', 'jumpBufferTicks', 'jumpActive'])
        assert.equal(predicted[key], actual[key], key);
    }
    assert.ok(authority.e.startMission(MISSION.FRONTIER, authority.id));
    authority.reset({ coyoteTicks: 6, jumpBufferTicks: 7, jumpActive: true });
    assert.ok(mirror.e.readCheckpoint(authority.e.writeCheckpoint()));
    for (const key of ['coyoteTicks', 'jumpBufferTicks']) assert.equal(mirror.p()[key], 0);
    assert.equal(mirror.p().jumpActive, false, 'loading a save clears the live jump gesture');
  } finally { authority.e.destroy(); mirror.e.destroy(); }
});
