import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const generator = resolve(root, 'scripts/generate-biomes.mjs');
const sourceSchema = JSON.parse(readFileSync(
  resolve(root, 'src/sand/biomes.schema.json'), 'utf8'));
const sourceHandlers = readFileSync(
  resolve(root, 'src/sand/cpp/engine/cave_profile_handlers.def'), 'utf8');
const sourcePolicies = readFileSync(
  resolve(root, 'src/sand/cpp/engine/cave_handler_policies.def'), 'utf8');
const temp = mkdtempSync(resolve(tmpdir(), 'sand-biome-generator-'));
let failures = 0;

const run = (name, mutate, expectedSuccess, handlers = null, policies = null) => {
  const schema = structuredClone(sourceSchema);
  mutate(schema);
  const path = resolve(temp, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
  const handlersPath = resolve(temp, `${name}.def`);
  if (handlers !== null) writeFileSync(handlersPath, handlers);
  const policiesPath = resolve(temp, `${name}-policies.def`);
  if (policies !== null) writeFileSync(policiesPath, policies);
  const result = spawnSync(process.execPath, [generator, '--validate-only'], {
    cwd: root,
    env: {
      ...process.env,
      SAND_BIOME_SCHEMA_PATH: path,
      ...(handlers === null ? {} : {
        SAND_CAVE_PROFILE_HANDLERS_PATH: handlersPath,
      }),
      ...(policies === null ? {} : {
        SAND_CAVE_HANDLER_POLICIES_PATH: policiesPath,
      }),
    },
    encoding: 'utf8',
  });
  const passed = (result.status === 0) === expectedSuccess;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${name}`);
  if (!passed) {
    failures++;
    console.error(result.stderr || result.stdout);
  }
};

console.log('biome registry generator');
run('offworld-only biome reuses profile defaults in one record', (schema) => {
  const record = structuredClone(schema.surfaceBiomes[0]);
  record.id = schema.surfaceBiomes.length;
  record.key = 'SYNTHETIC';
  record.symbol = 'BIOME_SYNTHETIC';
  record.name = 'synthetic';
  delete record.selectionPriority;
  delete record.climate;
  const moonOrdinals = schema.surfaceBiomes.flatMap((biome) =>
    biome.profileSelection?.PGP_MOON?.ordinal ?? []);
  record.profileSelection = {
    PGP_MOON: { ordinal: Math.max(...moonOrdinals) + 1, slots: 1 },
  };
  record.offworld = {};
  schema.surfaceBiomes.push(record);
}, true);
run('zero soil denominator is rejected', (schema) => {
  schema.surfaceBiomes[0].soilBaseDenominator = 0;
}, false);
run('negative biome relief is rejected', (schema) => {
  schema.surfaceBiomes[0].surfaceReliefScale = -1;
}, false);
run('biome ridge mix must be a proportion', (schema) => {
  schema.surfaceBiomes[0].surfaceRidgeMix = 2;
}, false);
run('string biome booleans are rejected', (schema) => {
  schema.surfaceBiomes[0].copperRich = 'false';
}, false);
run('surface structure policy must be boolean', (schema) => {
  schema.surfaceBiomes[0].allowsSurfaceStructures = 1;
}, false);
run('surface structure walls must be load-bearing', (schema) => {
  schema.surfaceBiomes[0].structureWall = 'WATER';
}, false);
run('cave monument walls must be load-bearing', (schema) => {
  schema.caveBiomes[0].monumentWall = 'FIRE';
}, false);
run('generation profiles declare offworld material requirements', (schema) => {
  delete schema.generationProfileSelection.PGP_MOON
    .requiresOffworldMaterialProfile;
}, false);
run('uint8 climate term boundary is accepted', (schema) => {
  const term = structuredClone(schema.surfaceBiomes[3].climate[0][0]);
  schema.surfaceBiomes[3].climate[0] = Array.from(
    { length: 0xff }, () => structuredClone(term));
}, true);
run('oversized climate clauses are rejected', (schema) => {
  const term = structuredClone(schema.surfaceBiomes[3].climate[0][0]);
  schema.surfaceBiomes[3].climate[0] = Array.from(
    { length: 0x100 }, () => structuredClone(term));
}, false);
run('uint8 climate clause boundary is accepted', (schema) => {
  const term = structuredClone(schema.surfaceBiomes[3].climate[0][0]);
  schema.surfaceBiomes[3].climate = Array.from(
    { length: 0xff }, () => [structuredClone(term)]);
}, true);
run('oversized biome climate clause lists are rejected', (schema) => {
  const term = structuredClone(schema.surfaceBiomes[3].climate[0][0]);
  schema.surfaceBiomes[3].climate = Array.from(
    { length: 0x100 }, () => [structuredClone(term)]);
}, false);
run('unrepresentable cave weights are rejected', (schema) => {
  schema.caveBiomes[0].profileSelection.PGP_EARTH[0].weight = 1e-20;
}, false);
run('fallback cave profiles cannot hide unused pool rows', (schema) => {
  schema.caveBiomes[0].profileSelection.PGP_SHIP = [
    { band: 'shallow', ordinal: 0, weight: 1 },
  ];
}, false);
run('unreachable cave descriptor is rejected', (schema) => {
  for (const record of schema.caveBiomes)
    if (record.id === 0) record.profileSelection = {};
}, false);
run('new cave profile without a handler is rejected', (schema) => {
  schema.caveProfiles.CBP_SYNTHETIC = Object.keys(schema.caveProfiles).length;
}, false);
run('duplicate cave profile handler is rejected', () => {}, false,
  sourceHandlers.replace(
    /^SAND_CAVE_PROFILE_HANDLER\(CBP_DEEP_VOID,.*$/m,
    sourceHandlers.match(/^SAND_CAVE_PROFILE_HANDLER\(CBP_DEFAULT,.*$/m)[0]));
run('missing cave policy is rejected', () => {}, false, null,
  sourcePolicies.replace(
    /^SAND_CAVE_UPPER_DRESSING_POLICY\(CUDH_DEFAULT, 1\)\n/m, ''));
run('duplicate cave policy ids are rejected', () => {}, false, null,
  sourcePolicies.replace(
    'SAND_CAVE_UPPER_DRESSING_POLICY(CUDH_LUSH, 4)',
    'SAND_CAVE_UPPER_DRESSING_POLICY(CUDH_LUSH, 3)'));
run('reordered cave policies are rejected', () => {}, false, null,
  sourcePolicies.replace(
    'SAND_CAVE_UPPER_DRESSING_POLICY(CUDH_NONE, 0)\nSAND_CAVE_UPPER_DRESSING_POLICY(CUDH_DEFAULT, 1)',
    'SAND_CAVE_UPPER_DRESSING_POLICY(CUDH_DEFAULT, 1)\nSAND_CAVE_UPPER_DRESSING_POLICY(CUDH_NONE, 0)'));

rmSync(temp, { recursive: true, force: true });
console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
