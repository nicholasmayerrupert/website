import { CREATIVE_KIND } from '../wasmBridge/abi.generated.js';

// Creature simulation and natural population are separate concerns. Survival
// and the /fps actor view run both; selecting an egg in creative only advances
// creatures that were placed explicitly.
export function applyCreatureRuntimePolicy(ctx, engine = ctx.engine) {
  const naturalSpawning = ctx.survival || ctx.debugHitboxes;
  if (ctx.creativeKind === CREATIVE_KIND.CREATURE) ctx.creatureSimulationRequested = true;
  const simulate = !ctx.worldWorker && (naturalSpawning || ctx.creatureSimulationRequested);
  engine?.setCreatureRuntime(simulate, naturalSpawning);
}
