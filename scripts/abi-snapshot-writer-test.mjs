import {
  createEngineWasm, initSandWasm,
} from '../src/sand/wasmBridge/engineFactory.js';
import { attachTestHooks } from '../src/sand/wasmBridge/testHooks.js';
import { MAT } from '../src/sand/materials.js';
import {
  CREATURE, ITEM_KIND, PROJECTILE_KIND, RECORD_CODECS, SNAPSHOT_CODECS,
  STRIDES,
} from '../src/sand/wasmBridge/abi.generated.js';
import { makeChecker } from './sand-test-util.mjs';

await initSandWasm();
const { check, done } = makeChecker('generated ABI snapshot writers');
const completeRecord = (record, codecName) => record
  && RECORD_CODECS[codecName].fields.every((field) =>
    Object.hasOwn(record, field)
      && (typeof record[field] === 'boolean' || Number.isFinite(record[field])));
const completeSnapshot = (record, codecName) => record
  && SNAPSHOT_CODECS[codecName].fields.every((field) =>
    Object.hasOwn(record, field)
      && (typeof record[field] === 'boolean' || Number.isFinite(record[field])));

{
  const engine = createEngineWasm({
    cols: 220, rows: 160, worldSeed: 0x51a7,
    sinksOn: false, infinite: false,
  });
  engine.setSurvivalInventory(true);
  const playerId = engine.spawnPlayer(83.25, 41.5);
  engine.setPlayerState(playerId, {
    x: 83.25, y: 41.5, vx: 1.75, vy: -0.5,
    facing: -1, grounded: true, jumpReady: true,
    jetpackFuel: 0.625, jetpackActive: true,
  });
  engine.setPlayerInput(playerId, {
    bits: 0, aimX: 121.5, aimY: 17.25, tool: 7, seq: 0x12345,
  });
  const player = engine.getPlayers().find((value) => value.id === playerId);
  check('player writer preserves aliases and required semantic inputs',
    completeRecord(player, 'playerSnapshot')
      && player.x === 83.25 && player.y === 41.5
      && player.vx === 1.75 && player.vy === -0.5
      && player.tool === 7 && player.inputSeq === 0x12345
      && player.aimX === 121.5 && player.aimY === 17.25
      && player.heldItemKind === ITEM_KIND.BLAST_GUN
      && player.jetpackFuel === 0.625 && player.jetpackActive);

  const itemId = engine.spawnItem(MAT.WOOD, 7, 48.25, 23.5, 0.75, -0.25);
  const item = engine.getItems().find((value) => value.id === itemId);
  check('item writer preserves member aliases and the complete packed record',
    completeRecord(item, 'itemSnapshot')
      && item.material === MAT.WOOD && item.count === 7
      && item.x === 48.25 && item.y === 23.5);

  const creatureId = engine.spawnScriptedCreature(CREATURE.FOX, 72.25, 45.5);
  const creature = engine.getCreatures().find((value) => value.id === creatureId);
  check('live creature writer preserves local coordinates and species parameters',
    completeRecord(creature, 'creatureSnapshot')
      && creature.species === CREATURE.FOX
      && creature.x === 72.25 && creature.y === 45.5
      && creature.w > 0 && creature.h > 0
      && creature.health === creature.maxHealth && creature.alive);

  engine.setPlayerInput(playerId, {
    bits: 16, aimX: 150.5, aimY: 62.25, tool: 7, seq: 0x12346,
  });
  engine.stepActors();
  const projectile = engine.getProjectiles().find((value) =>
    value.owner === playerId && value.kind === PROJECTILE_KIND.BLAST_ROUND);
  check('projectile writer preserves aliases and every packed scalar',
    completeRecord(projectile, 'projectileSnapshot')
      && projectile.id > 0 && projectile.x > 0 && projectile.y > 0
      && Number.isFinite(projectile.rotation));
  check('raw actor snapshots retain their generated strides',
    engine.getItemSnapshotData().length === engine.getItems().length * STRIDES.itemSnapshot
      && engine.getCreatureSnapshotData().length
        === engine.getCreatures().length * STRIDES.creatureSnapshot
      && engine.getProjectileSnapshotData().length
        === engine.getProjectiles().length * STRIDES.projectileSnapshot);
  engine.destroy();
}

{
  const engine = attachTestHooks(createEngineWasm({
    cols: 448, rows: 320, worldSeed: 0xB4EAC5,
    sinksOn: false, infinite: true,
  }));
  engine.setViewport(1, 1, 448, 320);
  engine.cameraSet(0, 0);
  engine.spawnPlayerAtSurface(224);
  engine.setCreatureRuntime(true, false);
  const requested = engine._spawnNearFocus(CREATURE.DYNAMITEER, 0x5151);
  const warning = engine.getCreatures().find((creature) =>
    creature.spawnProgress > 0);
  check('telegraph writer emits its explicit sparse actor semantics',
    requested && completeRecord(warning, 'creatureSnapshot')
      && warning.species === CREATURE.DYNAMITEER
      && warning.w > 0 && warning.h > 0 && warning.maxHealth > 0
      && warning.facing === 1 && warning.spawnProgress > 0
      && !warning.alive && warning.vx === 0 && warning.vy === 0
      && warning.health === 0 && warning.animFrame === 0
      && warning.attackState === 0 && warning.attackProgress === 0
      && warning.aimX === 0 && warning.aimY === 0
      && warning.attackPattern === 0);
  engine.destroy();
}

{
  const engine = attachTestHooks(createEngineWasm({
    cols: 96, rows: 72, worldSeed: 0xB0D1,
    sinksOn: false, infinite: false,
  }));
  engine._spawnBoxLayer(0, 28, 20, 2, 1, MAT.STONE);
  engine._spawnBoxLayer(1, 62, 31, 1, 2, MAT.STONE);
  const foreground = engine._bodyState(0);
  const foregroundLayer = engine._bodyStateLayer(0, 0);
  const background = engine._bodyStateLayer(1, 0);
  check('body diagnostic writers and decoder preserve every schema field',
    completeSnapshot(foreground, 'testBodyState')
      && completeSnapshot(foregroundLayer, 'testBodyState')
      && completeSnapshot(background, 'testBodyState')
      && foreground.px === 28 && foreground.py === 20
      && foregroundLayer.px === foreground.px
      && foregroundLayer.nPts === foreground.nPts
      && background.px === 62 && background.py === 31
      && typeof foreground.hadContact === 'boolean');
  engine.destroy();
}

const failures = done();
if (failures) process.exit(1);
console.log('\nall checks passed');
