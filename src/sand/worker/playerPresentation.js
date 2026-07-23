// Player prediction owns only immediate movement presentation. Survival state
// (health, ward, death/respawn, held items, and weapon charge) stays authoritative.
export function mergePlayerPrediction(authoritative, predicted, id) {
  if (!authoritative || !predicted) return authoritative;
  return {
    ...authoritative,
    id,
    x: predicted.x,
    y: predicted.y,
    vx: predicted.vx,
    vy: predicted.vy,
    w: predicted.w ?? authoritative.w,
    h: predicted.h ?? authoritative.h,
    facing: predicted.facing,
    grounded: predicted.grounded,
    jumpReady: predicted.jumpReady,
    jetpackFuel: predicted.jetpackFuel,
    jetpackActive: predicted.jetpackActive,
    animState: predicted.animState,
    animFrame: predicted.animFrame,
  };
}
