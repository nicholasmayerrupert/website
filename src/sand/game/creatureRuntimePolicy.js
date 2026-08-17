import {
  CREATIVE_KIND,
  PLANET_GAMEPLAY_FLAG,
  planetHasGameplayFlag,
} from '../wasmBridge/abi.generated.js';

// Creature simulation and natural population are separate concerns. Survival
// and the /fps actor view run both; selecting an egg in creative only advances
// creatures that were placed explicitly.
/** @param {import('./runtimeContext.js').SandRuntimeContext} ctx */
export function applyCreatureRuntimePolicy(ctx, engine = ctx.engine) {
  const populationRequested = ctx.survival || ctx.debugHitboxes;
  const naturalSpawning = populationRequested
    && planetHasGameplayFlag(
      ctx.planetId, PLANET_GAMEPLAY_FLAG.NATURAL_SPAWNS,
    );
  if (ctx.creativeKind === CREATIVE_KIND.CREATURE) ctx.creatureSimulationRequested = true;
  const simulate = !ctx.worldWorker
    && (populationRequested || ctx.creatureSimulationRequested);
  engine?.setCreatureRuntime(simulate, naturalSpawning);
}
