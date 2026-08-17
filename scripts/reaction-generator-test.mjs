import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeChecker } from './sand-test-util.mjs';

const { check, done } = makeChecker('reaction generator');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'sand-reaction-generator-'));

try {
  mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'src/sand/cpp/engine'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'src/sand/wasmBridge'), { recursive: true });
  for (const file of ['generate-reactions.mjs', 'schema-json.mjs'])
    copyFileSync(join(root, 'scripts', file), join(fixtureRoot, 'scripts', file));
  copyFileSync(join(root, 'src/sand/materials.schema.json'),
    join(fixtureRoot, 'src/sand/materials.schema.json'));
  const base = JSON.parse(readFileSync(
    join(root, 'src/sand/reactions.schema.json'), 'utf8'));
  const schemaPath = join(fixtureRoot, 'src/sand/reactions.schema.json');
  const run = (schema) => {
    writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
    return spawnSync(process.execPath, ['scripts/generate-reactions.mjs'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
    });
  };

  const extended = structuredClone(base);
  extended.rules.push({
    id: 'fixture_one_record_gas_body_rule',
    source: { material: 'METHANE', topology: 'loose' },
    trigger: {
      type: 'target', direction: 'below',
      target: { material: 'EMPTY', topology: 'loose' },
    },
    schedule: { every: 7, probability: 0.25 },
    effects: [{
      op: 'spawnBody', subject: 'target', material: 'RIGID',
      shape: 'box', halfWidth: 2, halfHeight: 3,
    }],
    layer: 'current',
    priority: 30,
  });
  const generated = run(extended);
  check('one schema row generates a scheduled rigid-producing rule',
    generated.status === 0);
  if (generated.status !== 0) process.stderr.write(generated.stderr);
  const hpp = readFileSync(
    join(fixtureRoot, 'src/sand/cpp/engine/reactions.generated.hpp'), 'utf8');
  check('generated C++ owns trigger, schedule, topology, and body shape',
    hpp.includes('fixture_one_record_gas_body_rule')
      && hpp.includes('ReactionTriggerKind::TARGET')
      && hpp.includes('ReactionEffectOp::SPAWN_BODY')
      && hpp.includes('ReactionBodyShape::BOX')
      && hpp.includes('ReactionBodyShape::BOX, 0, 2, 3')
      && hpp.includes('7u, 0.25f'));
  check('selector unions compile to fixed material masks',
    hpp.includes('fixture_gas_transmutes_component')
      && hpp.includes('std::array') === false
      && hpp.includes('ULL'));

  const aged = structuredClone(base);
  aged.rules.push({
    id: 'fixture_one_record_aged_rule',
    source: { material: 'ACRID_SMOKE', topology: 'loose' },
    trigger: { type: 'self', minimumAge: 120 },
    effects: [{ op: 'remove', subject: 'source' }],
    layer: 'current',
    priority: 30,
  });
  const generatedAge = run(aged);
  const stateHpp = generatedAge.status === 0
    ? readFileSync(join(
      fixtureRoot, 'src/sand/cpp/engine/reaction_state.generated.hpp'), 'utf8')
    : '';
  check('the first production age rule compiles its persistent channel',
    generatedAge.status === 0
      && stateHpp.includes('#define SAND_HAS_REACTION_AGE_CHANNEL 1'));

  const invalidStatic = structuredClone(base);
  invalidStatic.fixtures[1].effects[0].material = 'WATER';
  check('static topology rejects a non-component product',
    run(invalidStatic).status !== 0);

  const invalidBody = structuredClone(base);
  invalidBody.fixtures[2].effects[0].material = 'WATER';
  check('body spawning rejects a non-structural product',
    run(invalidBody).status !== 0);

  const invalidAge = structuredClone(base);
  invalidAge.fixtures[0].source.topology = 'body';
  check('age rules reject unsupported owner clocks', run(invalidAge).status !== 0);

  const duplicatePriority = structuredClone(base);
  duplicatePriority.rules[1].priority = duplicatePriority.rules[0].priority;
  check('overlapping sources require deterministic priorities',
    run(duplicatePriority).status !== 0);

  const misspelledSchedule = structuredClone(base);
  misspelledSchedule.rules[0].schedule.probablity = 0.5;
  check('unknown fields fail instead of silently taking defaults',
    run(misspelledSchedule).status !== 0);

  const placeOverMaterial = structuredClone(base);
  const probabilistic = placeOverMaterial.fixtures.find(
    (rule) => rule.id === 'fixture_probabilistic_gas_deposits_fluid');
  probabilistic.trigger.target.material = 'WATER';
  check('place requires an explicitly empty target',
    run(placeOverMaterial).status !== 0);

  const incompatibleOwnerProduct = structuredClone(base);
  const transmute = incompatibleOwnerProduct.fixtures.find(
    (rule) => rule.id === 'fixture_gas_transmutes_component');
  transmute.effects[0].material = 'WATER';
  check('owner-preserving products must remain structural',
    run(incompatibleOwnerProduct).status !== 0);

  const duplicateSelfMutation = structuredClone(base);
  duplicateSelfMutation.fixtures[0].effects.push({
    op: 'remove', subject: 'target',
  });
  check('self aliases cannot hide two mutations of the same subject',
    run(duplicateSelfMutation).status !== 0);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

done();
