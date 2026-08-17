import { readFileSync } from 'node:fs';
import { initSandWasm, createEngineWasm } from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import {
  REACTION_FIXTURES, REACTION_RULES,
} from '../src/sand/wasmBridge/reactions.generated.js';
import { MAT } from '../src/sand/materials.js';
import { makeChecker } from './sand-test-util.mjs';

const COLS = 96, ROWS = 72;
await initSandWasm();
const { check, done } = makeChecker('generated reaction system');
const fixture = Object.fromEntries(
  REACTION_FIXTURES.map((rule, index) => [rule.id, index]));
const buildVariant = JSON.parse(readFileSync(
  new URL('../src/sand/wasm/build-info.json', import.meta.url), 'utf8')).variant;
const collectsBodyContacts = buildVariant === 'dev'
  || REACTION_RULES.some((rule) => rule.trigger.type === 'bodyContact');
const makeEngine = () => attachTestHooks(createEngineWasm({
  cols: COLS, rows: ROWS, worldSeed: 0x5a17, sinksOn: false, infinite: false,
}));

{
  const engine = makeEngine();
  check('runtime fixture catalogue matches generated metadata',
    Object.keys(fixture).length > 0
      && Object.keys(fixture).length === engine._reactionFixtureCount());
  engine.destroy();
}

{
  let unionWorks = true;
  for (const material of [MAT.STONE, MAT.ICE, MAT.GOLD_ORE]) {
    const engine = makeEngine();
    const source = 20 * COLS + 30;
    const target = source + COLS;
    engine.paintDisc(30, 21, 0, material, true);
    const componentId = engine._componentId(0, 0);
    engine.paintDisc(30, 20, 0, MAT.ACRID_SMOKE, true);
    const changed = engine._reactionFixture(
      fixture.fixture_gas_transmutes_component, 0, source);
    unionWorks &&= changed && engine.getGrid()[target] === MAT.IRON_ORE
      && engine._componentCount(0) === 1
      && engine._componentId(0, 0) === componentId;
    engine.destroy();
  }
  check('a selector union can transmute every matched component in place',
    unionWorks);
}

{
  const engine = makeEngine();
  const cell = 24 * COLS + 30;
  engine.paintDisc(30, 24, 0, MAT.ACRID_SMOKE, true);
  const early = engine._reactionFixture(
    fixture.fixture_aged_gas_condenses, 0, cell, -1, 2);
  const mature = engine._reactionFixture(
    fixture.fixture_aged_gas_condenses, 0, cell, -1, 3);
  check('a loose age trigger waits and then replaces through the transaction',
    !early && mature && engine.getGrid()[cell] === MAT.WATER);
  engine.destroy();
}

{
  const engine = makeEngine();
  const source = 20 * COLS + 30;
  const target = source + COLS;
  engine.paintDisc(30, 20, 0, MAT.ACRID_SMOKE, true);
  const changed = engine._reactionFixture(
    fixture.fixture_gas_deposits_component, 0, source);
  const registered = changed && engine.getGrid()[target] === MAT.STONE
    && engine._componentCount(0) === 1;
  engine.step(16);
  check('a gas can deposit a registered static component',
    registered && engine.getGrid()[target] === MAT.STONE);
  engine.destroy();
}

{
  const engine = makeEngine();
  const source = 20 * COLS + 30;
  engine.paintDisc(30, 20, 0, MAT.METHANE, true);
  const changed = engine._reactionFixture(
    fixture.fixture_gas_becomes_body, 0, source);
  check('a loose gas cell can replace itself with a shaped rigid body',
    changed && engine.getGrid()[source] === MAT.RIGID
      && engine._bodyCount() === 1
      && engine._bodyOwnerGrid(0)[source] >= 0);
  engine.destroy();
}

{
  const engine = makeEngine();
  let products = 0;
  let trials = 0;
  for (let x = 4; x < COLS - 4; x += 2) {
    const source = 20 * COLS + x;
    engine.paintDisc(x, 20, 0, MAT.ACRID_SMOKE, true);
    engine._reactionFixture(
      fixture.fixture_probabilistic_gas_deposits_fluid, 0, source);
    products += engine.getGrid()[source + COLS] === MAT.WATER ? 1 : 0;
    trials++;
  }
  check('probability uses a stable per-rule spatial channel',
    products > 0 && products < trials);
  engine.destroy();
}

{
  const engine = makeEngine();
  const source = 20 * COLS + 30;
  const target = source + COLS;
  engine.paintDisc(30, 20, 0, MAT.METHANE, true);
  const before = engine._bodyCount();
  const changed = engine._reactionFixture(
    fixture.fixture_gas_spawns_body, 0, source);
  check('a gas can spawn a real rigid body',
    changed && engine._bodyCount() === before + 1
      && engine.getGrid()[target] === MAT.RIGID
      && engine._bodyOwnerGrid(0)[target] >= 0);
  engine.destroy();
}

{
  const engine = makeEngine();
  engine.spawnBox(28, 24, 1, 1, MAT.RIGID);
  engine.spawnBox(42, 24, 1, 1, MAT.GOLD_ORE);
  const source = 24 * COLS + 28;
  const target = 24 * COLS + 42;
  const owner = engine._bodyOwnerGrid(0)[target];
  const before = engine._bodyCount();
  const changed = engine._reactionFixture(
    fixture.fixture_body_contact_transmutes_member,
    0, source, target, 1);
  check('a body-contact command changes a member without destroying its body',
    changed && engine.getGrid()[target] === MAT.IRON_ORE
      && engine._bodyOwnerGrid(0)[target] === owner
      && engine._bodyCount() === before);
  engine.destroy();
}

{
  const engine = makeEngine();
  engine.spawnBox(34, 36, 3, 3, MAT.RIGID);
  engine.spawnBox(48, 36, 3, 3, MAT.GOLD_ORE);
  engine._setBodyMotion(0, 1, 0);
  engine._setBodyMotion(1, -1, 0);
  let contacts = 0;
  for (let tick = 1; tick <= 20; tick++) {
    engine.step(tick * 16);
    contacts = Math.max(contacts, engine._reactionContactCount());
  }
  check(collectsBodyContacts
    ? 'the rigid solver publishes typed body-contact inputs'
    : 'fixture-only rigid contact collection is absent from production',
  collectsBodyContacts ? contacts > 0 : contacts === 0);
  engine.destroy();
}

done();
