// PlayerSystem method bodies (need the full Engine definition; see player.hpp).

// Player characters: deterministic AABB platformer physics over the cell grid.
// JS/network supplies a normalized input bitmask + aim per step; the engine owns
// movement, collision, and (Phase 3) player-mediated tool use. No RNG is used so
// a fixed input stream + seed replays identically across machines.

// A cell is solid to the player if it is neither empty, liquid, nor gas — i.e.
// settled powder (sand) and all rigid materials block movement; water/steam/
// fire/oil/acid/lava do not. Out of bounds: below the buffer is floor (can't
// fall out the bottom); above and to the sides is open air.
bool PlayerSystem::isSolidForPlayer(uint8_t m) {
  return E.isBlockingForPlayer(m);
}
bool PlayerSystem::playerCellSolid(int x, int y) {
  if (y >= E.rows) return true;        // floor under the world
  if (y < 0) return false;           // open sky
  if (x < 0 || x >= E.cols) return false;
  return isSolidForPlayer(E.L->grid[E.I(x, y)]);
}
// Does the AABB at (px,py) with size (w,h) overlap any solid cell?
bool PlayerSystem::playerBoxHits(double px, double py, int w, int h) {
  int ix0 = (int)std::floor(px), ix1 = (int)std::floor(px + w - 1e-6);
  int iy0 = (int)std::floor(py), iy1 = (int)std::floor(py + h - 1e-6);
  for (int y = iy0; y <= iy1; y++)
    for (int x = ix0; x <= ix1; x++)
      if (playerCellSolid(x, y)) return true;
  return false;
}
// Any solid across the player's horizontal span [px, px+w) at integer row `row`?
bool PlayerSystem::rowSolid(double px, int w, int row) {
  int ix0 = (int)std::floor(px), ix1 = (int)std::floor(px + w - 1e-6);
  for (int x = ix0; x <= ix1; x++) if (playerCellSolid(x, row)) return true;
  return false;
}
// Any solid down the player's vertical span [py, py+h) at integer column `col`?
bool PlayerSystem::colSolid(double py, int h, int col) {
  int iy0 = (int)std::floor(py), iy1 = (int)std::floor(py + h - 1e-6);
  for (int y = iy0; y <= iy1; y++) if (playerCellSolid(col, y)) return true;
  return false;
}
// How many contiguous solid pixel-E.rows have risen INTO the box from the feet up.
// 0 = feet clean (resting on top / in air). Sand falls THROUGH the player to the
// floor and piles up into him, so this measures how "buried" he is — the jump
// gate lets him leap out while shallow, and forces digging when deep.
int PlayerSystem::buryDepth(const Player& p) {
  int bottom = (int)std::floor(p.py + p.h - 1e-6), topRow = (int)std::floor(p.py), depth = 0;
  for (int row = bottom; row >= topRow; row--) { if (!rowSolid(p.px, p.w, row)) break; depth++; }
  return depth;
}
// Solid on the leading vertical edge in travel direction `dir` (full body height)?
bool PlayerSystem::edgeBlockedX(double px, double py, int w, int h, int dir) {
  int col = dir > 0 ? (int)std::floor(px + w - 1e-6) : (int)std::floor(px);
  return colSolid(py, h, col);
}
// EDGE-BASED horizontal move. Advance in <=P_MOVE_SUBSTEP steps; block only on a
// NEW leading-edge solid (solids already overlapping the box are ignored, so a
// buried/clipped player can still shuffle). A low ledge (<=P_STEP_UP) auto-climbs
// so 1-2px bumps don't stall him. Returns true if blocked.
bool PlayerSystem::tryMoveX(Player& p, double d, int bury) {
  if (d == 0) return false;
  int dir = d > 0 ? 1 : -1;
  // Too deeply buried to jump out (same cap as the jump) -> also can't walk/climb
  // out: pushing the leading edge INTO solid sand is blocked, so he must dig free.
  // (A step toward genuinely open air — leading edge empty — is still allowed.)
  if (bury > P_BURY_JUMP_MAX && edgeBlockedX(p.px, p.py, p.w, p.h, dir)) return true;
  double step = dir * P_MOVE_SUBSTEP, moved = 0;
  while (std::fabs(moved) < std::fabs(d)) {
    double adv = (std::fabs(d - moved) < P_MOVE_SUBSTEP) ? (d - moved) : step;
    bool already = edgeBlockedX(p.px, p.py, p.w, p.h, dir);          // already against a wall? don't re-block
    if (already || !edgeBlockedX(p.px + adv, p.py, p.w, p.h, dir)) { p.px += adv; moved += adv; continue; }
    bool climbed = false;
    if (p.grounded) {
      for (double up = P_MOVE_SUBSTEP; up <= P_STEP_UP + 1e-9; up += P_MOVE_SUBSTEP) {
        // raised leading edge clear AND no ceiling over the new head position
        if (!edgeBlockedX(p.px + adv, p.py - up, p.w, p.h, dir) && !rowSolid(p.px + adv, p.w, (int)std::floor(p.py - up))) {
          p.py -= up; p.px += adv; moved += adv; climbed = true; break;
        }
      }
    }
    if (!climbed) return true;
  }
  return false;
}
// EDGE-BASED downward move: rest when the row just BELOW the box bottom is solid
// (so the player sits ON TOP of the floor and never sinks). Solids already inside
// the box are ignored. Returns true on floor contact.
bool PlayerSystem::moveDown(Player& p, double d) {
  double moved = 0;
  while (moved < d - 1e-9) {
    double adv = (d - moved < P_MOVE_SUBSTEP) ? (d - moved) : P_MOVE_SUBSTEP;
    int curBottom = (int)std::floor(p.py + p.h - 1e-6);
    int newBottom = (int)std::floor(p.py + adv + p.h - 1e-6);
    if (newBottom != curBottom && rowSolid(p.px, p.w, curBottom + 1)) return true;
    p.py += adv; moved += adv;
  }
  return false;
}
// EDGE-BASED upward move: blocked only by a ceiling ABOVE the head; solids risen
// into the feet do NOT block, so a shallowly-buried player rises out as he jumps.
bool PlayerSystem::moveUp(Player& p, double d) { // d < 0
  double moved = 0;
  while (moved > d + 1e-9) {
    double adv = (d - moved > -P_MOVE_SUBSTEP) ? (d - moved) : -P_MOVE_SUBSTEP;
    int curTop = (int)std::floor(p.py);
    int newTop = (int)std::floor(p.py + adv);
    if (newTop != curTop && rowSolid(p.px, p.w, curTop - 1)) return true;
    p.py += adv; moved += adv;
  }
  return false;
}
bool PlayerSystem::tryMoveY(Player& p, double d) {
  if (d == 0) return false;
  return d > 0 ? moveDown(p, d) : moveUp(p, d);
}

int PlayerSystem::spawnPlayer(double x, double y) {
  Player p;
  p.id = nextPlayerId++;
  p.px = x; p.py = y;
  p.aimX = x; p.aimY = y;
  players.push_back(p);
  if (E.survivalInventory) E.seedStarterTools(players.back()); // survival spawns with the starter kit
  return p.id;
}
void PlayerSystem::playerSurfaceSpawn(int col, double* out) {
  int worldX0 = E.fg.worldOffsetX;
  int top = E.fg.infinite ? E.genSurfaceAt(worldX0 + col) : E.rows / 2;
  for (int c = col - PLAYER_W; c <= col + PLAYER_W; c++) {
    int surf = E.fg.infinite ? E.genSurfaceAt(worldX0 + c) : E.rows / 2;
    if (surf < top) top = surf;
  }
  out[0] = col - PLAYER_W / 2.0;
  out[1] = top - PLAYER_H - 4;
}
int PlayerSystem::spawnPlayerAtSurface(int col) {
  double out[2];
  playerSurfaceSpawn(col, out);
  return spawnPlayer(out[0], out[1]);
}
void PlayerSystem::respawnPlayer(Player& p) {
  double out[2];
  int col = (int)std::lround(p.px + p.w * 0.5);
  playerSurfaceSpawn(std::max(PLAYER_W, std::min(E.cols - PLAYER_W - 1, col)), out);
  p.px = out[0]; p.py = out[1]; p.vx = p.vy = 0;
  p.health = 100; p.alive = true; p.grounded = false; p.jumpReady = false;
  p.hurtCooldown = 120;
  resetPlayerMine(p); p.placeStrokeActive = false; p.prevInput = p.input;
  if (E.tools.drafting && E.tools.draftOwner == p.id) playerFinalizeSolidDraft();
}
Player* PlayerSystem::findPlayer(int id) {
  for (auto& p : players) if (p.id == id) return &p;
  return nullptr;
}
void PlayerSystem::removePlayer(int id) {
  for (size_t i = 0; i < players.size(); i++)
    if (players[i].id == id) { players.erase(players.begin() + i); return; }
}
void PlayerSystem::setPlayerInput(int id, int inputBits, double aimX, double aimY, int selectedTool, uint32_t seq,
                                  double moveX, double moveY) {
  Player* p = findPlayer(id);
  if (!p) return;
  p->input = inputBits;
  p->analogInput = std::isfinite(moveX) && std::isfinite(moveY);
  if (p->analogInput) {
    double mag = std::hypot(moveX, moveY);
    if (mag > 1.0) { moveX /= mag; moveY /= mag; }
    p->inputX = std::max(-1.0, std::min(1.0, moveX));
    p->inputY = std::max(-1.0, std::min(1.0, moveY));
  } else {
    p->inputX = p->inputY = 0;
  }
  p->aimX = aimX; p->aimY = aimY;
  p->selectedTool = selectedTool;
  p->inputSeq = seq;
}

// Liquid coverage of the player's AABB. Liquids are non-solid to the player, so
// without buoyancy he'd fall/walk through them at full speed. Sampling the WHOLE
// body (not just the center cell) means wading — water at the feet/lower body but
// not the mid-body center — still registers. coverage is the fraction of the body's
// cells that are liquid; deterministic (pure grid sampling, no RNG).
bool PlayerSystem::playerCellLiquid(int x, int y) {
  if (y < 0 || y >= E.rows || x < 0 || x >= E.cols) return false;
  return E.isLiquidMaterial(E.L->grid[E.I(x, y)]);
}
// Returns the liquid coverage (fraction of the player's AABB cells that are
// liquid). Deterministic: pure grid sampling, no RNG.
double PlayerSystem::samplePlayerFluidCoverage(const Player& p) {
  int ix0 = (int)std::floor(p.px), ix1 = (int)std::floor(p.px + p.w - 1e-6);
  int iy0 = (int)std::floor(p.py), iy1 = (int)std::floor(p.py + p.h - 1e-6);
  int total = 0, wet = 0;
  for (int y = iy0; y <= iy1; y++) {
    for (int x = ix0; x <= ix1; x++) {
      total++;
      if (playerCellLiquid(x, y)) wet++;
    }
  }
  return total > 0 ? (double)wet / (double)total : 0;
}

void PlayerSystem::integratePlayer(Player& p) {
  if (!p.active) return;
  bool wasGrounded = p.grounded;
  bool left = (p.input & PI_LEFT) != 0, right = (p.input & PI_RIGHT) != 0;
  double moveX = p.analogInput ? p.inputX : ((right ? 1.0 : 0.0) - (left ? 1.0 : 0.0));
  double moveStrength = std::fabs(moveX);
  bool run = (p.input & PI_RUN) != 0;
  bool wantJump = (p.input & PI_JUMP) != 0;
  // Two coverage thresholds: past MIN he's "in liquid" (drag + slow sink + slower
  // run); past the higher SWIM threshold he can also swim upward with jump/up.
  double fluidCoverage = samplePlayerFluidCoverage(p);
  bool inLiquid = fluidCoverage >= P_LIQUID_MIN_COVERAGE;
  bool swimming = fluidCoverage >= P_LIQUID_SWIM_COVERAGE;
  double maxRun = P_MAX_RUN * (run ? P_RUN_MULT : 1.0);
  if (p.analogInput) maxRun *= moveStrength;
  if (inLiquid) maxRun *= P_LIQUID_RUN_MULT;

  // horizontal accel / friction
  if (moveStrength < 1e-6) {
    p.vx *= (p.grounded ? P_GROUND_FRICTION : P_AIR_FRICTION);
    if (std::fabs(p.vx) < 0.02) p.vx = 0;
  } else {
    p.vx += P_MOVE_ACCEL * moveX;
    p.facing = moveX > 0 ? 1 : -1;
  }
  if (p.vx >  maxRun) p.vx =  maxRun;
  if (p.vx < -maxRun) p.vx = -maxRun;
  if (inLiquid) {
    p.vx *= P_LIQUID_DRAG_X;
    if (std::fabs(p.vx) < 0.02) p.vx = 0;
  }

  // jump: allowed when grounded OR shallowly buried (sand piled into his feet, up
  // to P_BURY_JUMP_MAX deep) — he can leap out of a light burial, but deeper than
  // that the jump is denied and he must dig. Re-arm only on release so a press isn't
  // lost to a single-frame `grounded` flicker. While SWIMMING the jump key is
  // consumed as the swim-up impulse below instead of a leap.
  int bury = buryDepth(p);
  bool canJump = bury <= P_BURY_JUMP_MAX && (p.grounded || bury > 0);
  if (canJump && !wantJump) p.jumpReady = true;
  if (!swimming && wantJump && canJump && p.jumpReady) {
    p.vy = -P_JUMP_VEL; p.grounded = false; p.jumpReady = false;
    E.audio.emit(SE_JUMP, p.px + p.w * 0.5, p.py + p.h, 0.8, EMPTY, 0);
  }

  // horizontal move
  if (tryMoveX(p, p.vx, bury)) p.vx = 0;

  // gravity / swim drag + vertical move. Submerged: vertical drag, gentle gravity,
  // and a low terminal sink speed -> he falls SLOWLY through water; holding jump/up
  // while swimming adds an upward impulse (capped rise speed).
  if (inLiquid) {
    p.vy *= P_LIQUID_DRAG_Y;
    p.vy += P_LIQUID_GRAVITY;
    if (swimming && wantJump) p.vy -= P_LIQUID_SWIM_ACCEL;
    if (p.vy < P_LIQUID_MAX_RISE) p.vy = P_LIQUID_MAX_RISE;
    if (p.vy > P_LIQUID_MAX_FALL) p.vy = P_LIQUID_MAX_FALL;
  } else {
    p.vy += P_GRAVITY;
    if (p.vy > P_MAX_FALL) p.vy = P_MAX_FALL;
  }
  double impactVy = p.vy;
  if (tryMoveY(p, p.vy)) p.vy = 0;
  // grounded := stable downward-edge contact (solid directly under the feet) OR
  // buried — flicker-free vs. the old "was the down-move blocked" test.
  int feetRow = (int)std::floor(p.py + p.h - 1e-6);
  p.grounded = rowSolid(p.px, p.w, feetRow + 1) || buryDepth(p) > 0;
  if (!wasGrounded && p.grounded && !inLiquid && impactVy > 0.28)
    E.audio.emit(SE_LAND, p.px + p.w * 0.5, p.py + p.h, std::min(1.5, impactVy / P_MAX_FALL + 0.25), EMPTY, 0);

  // ---- animation state (deterministic; reuses the fluid sample computed above) ----
  // Priority: liquid overrides airborne overrides grounded-move overrides idle. The
  // frame is a pure function of the actor clock, so world slowdowns do not slow
  // animation and prediction/replay stay in sync.
  double spd = std::fabs(p.vx);
  uint8_t as;
  if (swimming) as = AS_SWIM;
  else if (inLiquid) as = AS_WADE;
  else if (!p.grounded) as = (p.vy < -AS_RISE_EPS) ? AS_RISE : AS_FALL;
  else if (spd >= AS_RUN_SPEED && (p.input & PI_RUN)) as = AS_RUN;
  else if (spd >= AS_MOVE_EPS) as = AS_WALK;
  else as = AS_IDLE;
  p.animState = as;
  p.animFrame = (uint8_t)(((uint32_t)E.actorTick / ANIM_T[as]) % ANIM_N[as]);
}

// ---- player-mediated tool use (Terraria-like dig/build) ----
// The engine owns all policy: reach, cooldown, which materials place vs. mine,
// and the no-self-overlap rule for solid builds. JS only forwards PRIMARY/
// SECONDARY input bits + the aim cell.
uint8_t PlayerSystem::toolMaterial(int tool) {
  switch (tool) {
    case T_SAND: return SAND; case T_WATER: return WATER; case T_OIL: return OIL;
    case T_FIRE: return FIRE; case T_ACID: return ACID; case T_LAVA: return LAVA;
    default: return EMPTY;
  }
}
// Would a solid build (radius r at ax,ay) overlap the player's own AABB?
bool PlayerSystem::playerBuildOverlapsSelf(Player& p, int ax, int ay, int r) {
  double ix0 = std::floor(p.px), ix1 = std::floor(p.px + p.w - 1e-6);
  double iy0 = std::floor(p.py), iy1 = std::floor(p.py + p.h - 1e-6);
  double nx = ax < ix0 ? ix0 : (ax > ix1 ? ix1 : ax);
  double ny = ay < iy0 ? iy0 : (ay > iy1 ? iy1 : ay);
  double dx = ax - nx, dy = ay - ny;
  return dx * dx + dy * dy <= (double)(r * r);
}
// Apply the player's selected tool at the aim cell, into `layer`. Returns whether
// anything was placed/built. The eraser is mining and handled by the caller. Only
// the foreground collides with the player, so the no-self-overlap rule (which
// would block building on yourself) applies to foreground builds only.
bool PlayerSystem::playerUseTool(Player& p, int ax, int ay, Layer* layer) {
  int layerId = layer == &E.bg ? 1 : 0;
  E.useLayer(layer);
  bool checkSelf = (layer == &E.fg);
  bool ok = false;
  switch (p.selectedTool) {
    case T_SAND: case T_WATER: case T_OIL: case T_FIRE: case T_ACID: case T_LAVA:
      E.paintDisc(ax, ay, P_PAINT_R, toolMaterial(p.selectedTool), false); ok = true; break;
    case T_SEED: {
      int x0, y0;
      if (E.getSeedOrigin(ax, ay, x0, y0) && E.canPlaceSeedAt(x0, y0)) { E.placeSeedAt(x0, y0); ok = true; }
      break;
    }
    case T_CUBE:
      if (!(checkSelf && playerBuildOverlapsSelf(p, ax, ay, CUBE_HALF))) {
        E.spawnBox(ax, ay, CUBE_HALF, CUBE_HALF, RIGID); ok = true;
      }
      break;
    default: break; // solids (stone/driftwood/ice) use the persistent E.tools.draft in applyPlayerTools
  }
  E.useLayer(&E.fg);
  if (ok) E.audio.emit(SE_PLACE, ax, ay, 0.55, toolMaterial(p.selectedTool), layerId);
  return ok;
}
bool PlayerSystem::isSolidTool(int t) { return t == T_STONE || t == T_DRIFTWOOD || t == T_ICE; }
// Mine a single disc AT THE AIM CELL into `layer` (like every other tool: a disc at
// the cursor, NOT a sweep emanating from the player). Each held-tool actor tick is one
// hit; DURABILITY[] controls base hardness and held class/tier controls progress
// (dig ignores material type — flat class speed so only hardness + tier matter).
void PlayerSystem::resetPlayerMine(Player& p) {
  if (!p.mineActive) return;
  auto clearLayer = [&](Layer* layer) {
    E.useLayer(layer);
    if (p.mineFootprint >= 0) E.clearMineDamageFootprint(p.mineX, p.mineY, E.getSurvivalFootprint(p.mineFootprint));
    else E.clearMineDamageDisc(p.mineX, p.mineY, P_MINE_R);
  };
  if (p.mineLayer == 2) {
    clearLayer(&E.fg);
    clearLayer(&E.bg);
  } else {
    clearLayer(p.mineLayer ? &E.bg : &E.fg);
  }
  E.useLayer(&E.fg);
  p.mineActive = false;
  p.mineFootprint = -1;
}
// Any non-EMPTY cell in the footprint counts as still-mineable (solids, powders,
// liquids). Used to release a held mine-lock once the locked area is cleared.
bool PlayerSystem::mineFootprintHasContent(int cx, int cy, int footprintId, Layer* layer) {
  const SurvivalFootprint& fp = E.getSurvivalFootprint(E.clampSurvivalFootprintId(footprintId));
  auto layerHas = [&](Layer* L) {
    E.useLayer(L);
    for (const SurvivalFootprintCell& o : fp.cells) {
      int xx = cx + (int)o.ox, yy = cy + (int)o.oy;
      if (yy <= 0 || yy >= E.rows || xx <= 0 || xx >= E.cols - 1) continue;
      if (E.L->grid[E.I(xx, yy)] != EMPTY) return true;
    }
    return false;
  };
  bool has = false;
  if (!layer) {
    has = layerHas(&E.fg) || layerHas(&E.bg);
  } else {
    has = layerHas(layer);
  }
  E.useLayer(&E.fg);
  return has;
}
void PlayerSystem::resolveMineDrops(Player& p) {
  if (E.tools.lastMinedCells.empty()) return;
  const auto first = E.tools.lastMinedCells.front();
  E.audio.emit(SE_BREAK, first.cell % E.cols, first.cell / E.cols,
               std::min(1.5, 0.35 + E.tools.lastMinedCells.size() * 0.08), first.material);
  for (auto& mc : E.tools.lastMinedCells) {
    uint8_t m = mc.material; int k = mc.cell;
    int cxk = k % E.cols, cyk = k / E.cols;
    uint8_t cls = MAT_TOOLCLASS[m], tier = MAT_TOOLTIER[m];
    bool drop = false;
    if (E.isPlantLeaf(m) && p.heldToolClass == TC_DIG) {
      double r = whash2(((uint32_t)E.actorTick ^ 0x51ED5EEDu), cxk, cyk);
      if (r < LEAF_SEED_DROP_P) E.spawnItem(SEED, 1, cxk + 0.5, cyk + 0.5, 0, -0.35, mc.plantType);
      else drop = true;
    } else if (E.isLiquidMaterial(m)) drop = true;
    else if (cls != TC_NONE) {
      if (tier == TT_HAND) drop = true;
      // Dig is universal: any material class drops if the dig tool's tier is high enough.
      else if (p.heldToolClass == TC_DIG && p.heldToolTier >= tier) drop = true;
      else if (p.heldToolClass == cls && p.heldToolTier >= tier) drop = true;
    }
    double j = whash2((uint32_t)E.actorTick * 2654435761u + (uint32_t)k, cxk, cyk) - 0.5;
    if (drop) E.spawnItem(m, 1, cxk + 0.5, cyk + 0.5, j * 0.4, -0.4);
    E.spawnParticle(m, cxk + 0.5, cyk + 0.5, j * 0.8, -0.6, IT_PARTICLE_LIFE);
  }
}
bool PlayerSystem::mineDisc(Player& p, int ax, int ay, Layer* layer, bool scaledSpeed) {
  int layerId = layer == &E.bg ? 1 : 0;
  if (!p.mineActive || p.mineLayer != layerId || p.mineX != ax || p.mineY != ay || p.mineFootprint >= 0) {
    resetPlayerMine(p);
    p.mineActive = true; p.mineLayer = layerId; p.mineX = ax; p.mineY = ay; p.mineFootprint = -1;
  }
  E.useLayer(layer);
  bool changed = E.mineDamageDisc(ax, ay, P_MINE_R, p, scaledSpeed) != 0;
  resolveMineDrops(p);
  E.useLayer(&E.fg);
  return changed;
}
// Survival hold-to-mine: lock the footprint origin on press and keep hitting that
// same area while the button is held. Cursor motion does NOT retarget. The lock
// releases when (1) the footprint has nothing left to mine in the target layer(s),
// or (2) the caller stops invoking us (button released / out of reach).
bool PlayerSystem::mineFootprint(Player& p, int ax, int ay, Layer* layer, bool scaledSpeed) {
  int layerId = layer == &E.bg ? 1 : 0;
  int footprintId = E.clampSurvivalFootprintId(p.selectedFootprint);
  if (p.mineActive && p.mineLayer == layerId && p.mineFootprint == footprintId) {
    ax = p.mineX;
    ay = p.mineY;
  } else {
    resetPlayerMine(p);
    p.mineActive = true; p.mineLayer = layerId; p.mineX = ax; p.mineY = ay; p.mineFootprint = footprintId;
  }
  if (!mineFootprintHasContent(ax, ay, footprintId, layer)) {
    resetPlayerMine(p);
    return false;
  }
  E.useLayer(layer);
  bool changed = E.mineDamageFootprint(ax, ay, E.getSurvivalFootprint(footprintId), p, scaledSpeed) != 0;
  resolveMineDrops(p);
  E.useLayer(&E.fg);
  if (!mineFootprintHasContent(ax, ay, footprintId, layer)) resetPlayerMine(p);
  return changed;
}
bool PlayerSystem::mineFootprintBoth(Player& p, int ax, int ay, bool scaledSpeed) {
  int footprintId = E.clampSurvivalFootprintId(p.selectedFootprint);
  if (p.mineActive && p.mineLayer == 2 && p.mineFootprint == footprintId) {
    ax = p.mineX;
    ay = p.mineY;
  } else {
    resetPlayerMine(p);
    p.mineActive = true; p.mineLayer = 2; p.mineX = ax; p.mineY = ay; p.mineFootprint = footprintId;
  }
  if (!mineFootprintHasContent(ax, ay, footprintId, nullptr)) {
    resetPlayerMine(p);
    return false;
  }
  const SurvivalFootprint& fp = E.getSurvivalFootprint(footprintId);
  E.useLayer(&E.fg);
  bool changed = E.mineDamageFootprint(ax, ay, fp, p, scaledSpeed) != 0;
  resolveMineDrops(p);
  E.bgEnabled = true;
  E.useLayer(&E.bg);
  changed |= E.mineDamageFootprint(ax, ay, fp, p, scaledSpeed) != 0;
  resolveMineDrops(p);
  E.useLayer(&E.fg);
  if (!mineFootprintHasContent(ax, ay, footprintId, nullptr)) resetPlayerMine(p);
  return changed;
}
// ---- survival solids: the EXACT creative E.tools.draft lifecycle, driven by a player ----
// Begin a persistent solid E.tools.draft into `btn`'s layer (0=fg LMB, 1=bg RMB) using the
// player's own tool. This is the same engine E.tools.draft state + live preview + finalize
// that creative mode uses (continueDrafts / finalize*Draft), so survival places
// solids identically: hold to draw a previewed shape, release to drop ONE connected
// piece (it stays if it lands on grounded terrain, falls as one body if mid-air).
void PlayerSystem::playerBeginSolidDraft(Player& p, int tool, int ax, int ay, int btn) {
  E.tools.draftLayer = btn; E.tools.draftOwner = p.id;
  E.useLayer(btn ? &E.bg : &E.fg);
  E.tools.drafting = true;
  E.tools.lastDraftCx = ax; E.tools.lastDraftCy = ay; E.tools.draftStrokeActive = true;
  E.tools.draftMaterial = (tool == T_ICE) ? ICE : (tool == T_DRIFTWOOD) ? DRIFTWOOD : STONE;
  E.addDiscToDraft(E.tools.draft, ax, ay, E.brushFor(E.tools.draftMaterial), E.tools.draftMaterial == ICE ? E.rows - 1 : E.rows);
  E.useLayer(&E.fg);
}
// Finalize the in-progress E.tools.draft into its layer (one connected component) and clear.
void PlayerSystem::playerFinalizeSolidDraft() {
  int layer = E.tools.draftLayer;
  uint8_t material = E.tools.draftMaterial;
  int x = E.tools.lastDraftCx, y = E.tools.lastDraftCy;
  E.useLayer(E.tools.draftLayer ? &E.bg : &E.fg);
  if (E.tools.drafting) { E.finalizeDraft(); E.tools.drafting = false; E.tools.draftStrokeActive = false; E.tools.draft.clear(); }
  E.tools.draftOwner = -1;
  E.useLayer(&E.fg);
  E.audio.emit(SE_PLACE, x, y, 0.9, material, layer);
}
// Per step: LMB (primary) acts on the FOREGROUND, RMB (secondary) on the BACKGROUND.
// Eraser sweeps toward the cursor and fluids/sand paint — both repeat while held
// (cooldown-throttled). Seed + cube fire once per press. Solids use the persistent
// creative E.tools.draft: begin on press, extend (preview) while held, finalize on release.
void PlayerSystem::applyPlayerTools() {
  for (auto& p : players) {
    // Survival inventory drives the controls (selected slot = mine-tool or place-
    // material). Creative keeps the classic tool flow below.
    if (E.survivalInventory) { E.applyInventoryPlayer(p); continue; }
    if (!p.active || !p.alive) { resetPlayerMine(p); p.prevInput = p.input; continue; }
    if (p.toolCooldown > 0) p.toolCooldown--;
    int prev = p.prevInput;
    bool primary = (p.input & PI_PRIMARY) != 0, secondary = (p.input & PI_SECONDARY) != 0;
    bool primaryRising = primary && !(prev & PI_PRIMARY);
    bool secondaryRising = secondary && !(prev & PI_SECONDARY);
    bool primaryFalling = !primary && (prev & PI_PRIMARY);
    bool secondaryFalling = !secondary && (prev & PI_SECONDARY);
    p.prevInput = p.input;
    int t = p.selectedTool;
    int ax = (int)std::floor(p.aimX), ay = (int)std::floor(p.aimY);
    double cxp = p.px + p.w / 2.0, cyp = p.py + p.h / 2.0;
    double dxp = (ax + 0.5) - cxp, dyp = (ay + 0.5) - cyp;
    bool inReach = (dxp * dxp + dyp * dyp <= P_TOOL_REACH * P_TOOL_REACH);

    // --- finalize this player's solid E.tools.draft when its owning button releases (or all
    //     buttons are up) — independent of the currently selected tool ---
    if (E.tools.drafting && E.tools.draftOwner == p.id) {
      bool ownerReleased = (E.tools.draftLayer == 1) ? secondaryFalling : primaryFalling;
      if (ownerReleased || (!primary && !secondary)) { playerFinalizeSolidDraft(); E.playerActionCount++; }
    }

    // --- SOLIDS: begin / extend the persistent E.tools.draft (creative parity) ---
    if (isSolidTool(t)) {
      resetPlayerMine(p);
      bool busy = E.tools.drafting;
      if (inReach && !busy && primaryRising) { playerBeginSolidDraft(p, t, ax, ay, 0); E.playerActionCount++; }
      else if (inReach && !busy && secondaryRising) { E.bgEnabled = true; playerBeginSolidDraft(p, t, ax, ay, 1); E.playerActionCount++; }
      else if (inReach && busy && E.tools.draftOwner == p.id && (primary || secondary)) E.continueDrafts(ax, ay); // extend + preview
      else if (!inReach && busy && E.tools.draftOwner == p.id) E.tools.draftStrokeActive = false;
      continue;
    }

    // --- non-solids: fluids/sand (continuous paint), eraser (continuous sweep),
    //     seed/cube (one-shot on press) ---
    if (!primary && !secondary) { resetPlayerMine(p); continue; }
    bool continuous = E.isPaintTool(t) || t == T_ERASER;
    bool doPrimary = continuous ? primary : primaryRising;
    bool doSecondary = continuous ? secondary : secondaryRising;
    if (continuous && p.toolCooldown > 0) { doPrimary = doSecondary = false; }
    if (!doPrimary && !doSecondary) continue;
    if (!inReach) { resetPlayerMine(p); continue; }
    if (t != T_ERASER) resetPlayerMine(p);
    bool acted = false;
    if (t == T_ERASER) acted |= E.damageCreaturesAt(ax, ay, P_MINE_R + 1, 14);
    if (doPrimary) {
      if (t == T_ERASER) acted |= mineDisc(p, ax, ay, &E.fg, false);
      else acted |= playerUseTool(p, ax, ay, &E.fg);
    }
    if (doSecondary) {
      E.bgEnabled = true;
      if (t == T_ERASER) acted |= mineDisc(p, ax, ay, &E.bg, false);
      else acted |= playerUseTool(p, ax, ay, &E.bg);
    }
    if (acted) {
      if (continuous) p.toolCooldown = P_TOOL_COOLDOWN;
      E.playerActionCount++;
    }
  }
}

void PlayerSystem::updatePlayers() {
  for (auto& p : players) {
    if (p.hurtCooldown > 0) p.hurtCooldown--;
    if (p.active && p.alive) integratePlayer(p);
  }
  applyPlayerTools();
}

// ---- client-side prediction support ----
// Step ONE player's physics against the current grid, without running the world
// simulation. The client predicts its own player this way (the host owns the
// world), recording inputs to replay after a server correction.
void PlayerSystem::stepPlayerOnly(int id) {
  Player* p = findPlayer(id);
  if (p && p->active && p->alive) integratePlayer(*p);
  E.actorTick++;
}
// Snap a player to an authoritative state (reconciliation), before replaying its
// unacknowledged inputs.
void PlayerSystem::setPlayerState(int id, double x, double y, double vx, double vy, int facing, int grounded, int jumpReady) {
  Player* p = findPlayer(id);
  if (!p) return;
  p->px = x; p->py = y; p->vx = vx; p->vy = vy;
  p->facing = facing; p->grounded = grounded != 0; p->jumpReady = jumpReady != 0;
}

// Pack all players into snapshot as flat float32 records (stride
// PS_STRIDE). JS reads this zero-copy to draw the player overlay.
int PlayerSystem::buildPlayerSnapshot() {
  snapshot.assign((size_t)players.size() * PS_STRIDE, 0.0f);
  for (size_t i = 0; i < players.size(); i++) {
    const Player& p = players[i];
    float* o = snapshot.data() + i * PS_STRIDE;
    o[PS_ID]         = (float)p.id;
    o[PS_ACTIVE]     = p.active ? 1.0f : 0.0f;
    o[PS_X]          = (float)p.px;
    o[PS_Y]          = (float)p.py;
    o[PS_VX]         = (float)p.vx;
    o[PS_VY]         = (float)p.vy;
    o[PS_W]          = (float)p.w;
    o[PS_H]          = (float)p.h;
    o[PS_FACING]     = (float)p.facing;
    o[PS_GROUNDED]   = p.grounded ? 1.0f : 0.0f;
    o[PS_TOOL]       = (float)p.selectedTool;
    o[PS_AIM_X]      = (float)p.aimX;
    o[PS_AIM_Y]      = (float)p.aimY;
    o[PS_HEALTH]     = (float)p.health;
    o[PS_INPUT_SEQ]  = (float)p.inputSeq;
    o[PS_ALIVE]      = p.alive ? 1.0f : 0.0f;
    o[PS_JUMP_READY] = p.jumpReady ? 1.0f : 0.0f; // hidden jump state, needed for reconciliation
    o[PS_ANIM_STATE] = (float)p.animState;
    o[PS_ANIM_FRAME] = (float)p.animFrame;
  }
  return (int)players.size();
}
