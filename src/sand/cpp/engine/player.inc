// Player characters: deterministic AABB platformer physics over the cell grid.
// JS/network supplies a normalized input bitmask + aim per step; the engine owns
// movement, collision, and (Phase 3) player-mediated tool use. No RNG is used so
// a fixed input stream + seed replays identically across machines.

// A cell is solid to the player if it is neither empty, liquid, nor gas — i.e.
// settled powder (sand) and all rigid materials block movement; water/steam/
// fire/oil/acid/lava do not. Out of bounds: below the buffer is floor (can't
// fall out the bottom); above and to the sides is open air.
inline bool isSolidForPlayer(uint8_t m) {
  return m != EMPTY && MAT_KIND[m] != K_LIQUID && MAT_KIND[m] != K_GAS;
}
inline bool playerCellSolid(int x, int y) {
  if (y >= rows) return true;        // floor under the world
  if (y < 0) return false;           // open sky
  if (x < 0 || x >= cols) return false;
  return isSolidForPlayer(grid[I(x, y)]);
}
// Does the AABB at (px,py) with size (w,h) overlap any solid cell?
inline bool playerBoxHits(double px, double py, int w, int h) {
  int ix0 = (int)std::floor(px), ix1 = (int)std::floor(px + w - 1e-6);
  int iy0 = (int)std::floor(py), iy1 = (int)std::floor(py + h - 1e-6);
  for (int y = iy0; y <= iy1; y++)
    for (int x = ix0; x <= ix1; x++)
      if (playerCellSolid(x, y)) return true;
  return false;
}
// Any solid across the player's horizontal span [px, px+w) at integer row `row`?
inline bool rowSolid(double px, int w, int row) {
  int ix0 = (int)std::floor(px), ix1 = (int)std::floor(px + w - 1e-6);
  for (int x = ix0; x <= ix1; x++) if (playerCellSolid(x, row)) return true;
  return false;
}
// Any solid down the player's vertical span [py, py+h) at integer column `col`?
inline bool colSolid(double py, int h, int col) {
  int iy0 = (int)std::floor(py), iy1 = (int)std::floor(py + h - 1e-6);
  for (int y = iy0; y <= iy1; y++) if (playerCellSolid(col, y)) return true;
  return false;
}
// How many contiguous solid pixel-rows have risen INTO the box from the feet up.
// 0 = feet clean (resting on top / in air). Sand falls THROUGH the player to the
// floor and piles up into him, so this measures how "buried" he is — the jump
// gate lets him leap out while shallow, and forces digging when deep.
inline int buryDepth(const Player& p) {
  int bottom = (int)std::floor(p.py + p.h - 1e-6), topRow = (int)std::floor(p.py), depth = 0;
  for (int row = bottom; row >= topRow; row--) { if (!rowSolid(p.px, p.w, row)) break; depth++; }
  return depth;
}
// Solid on the leading vertical edge in travel direction `dir` (full body height)?
inline bool edgeBlockedX(double px, double py, int w, int h, int dir) {
  int col = dir > 0 ? (int)std::floor(px + w - 1e-6) : (int)std::floor(px);
  return colSolid(py, h, col);
}
// EDGE-BASED horizontal move. Advance in <=P_MOVE_SUBSTEP steps; block only on a
// NEW leading-edge solid (solids already overlapping the box are ignored, so a
// buried/clipped player can still shuffle). A low ledge (<=P_STEP_UP) auto-climbs
// so 1-2px bumps don't stall him. Returns true if blocked.
bool tryMoveX(Player& p, double d, int bury) {
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
bool moveDown(Player& p, double d) {
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
bool moveUp(Player& p, double d) { // d < 0
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
bool tryMoveY(Player& p, double d) {
  if (d == 0) return false;
  return d > 0 ? moveDown(p, d) : moveUp(p, d);
}

int spawnPlayer(double x, double y) {
  Player p;
  p.id = nextPlayerId++;
  p.px = x; p.py = y;
  p.aimX = x; p.aimY = y;
  players.push_back(p);
  if (survivalInventory) seedStarterTools(players.back()); // survival spawns with the starter kit
  return p.id;
}
Player* findPlayer(int id) {
  for (auto& p : players) if (p.id == id) return &p;
  return nullptr;
}
void removePlayer(int id) {
  for (size_t i = 0; i < players.size(); i++)
    if (players[i].id == id) { players.erase(players.begin() + i); return; }
}
void setPlayerInput(int id, int inputBits, double aimX, double aimY, int selectedTool, uint32_t seq) {
  Player* p = findPlayer(id);
  if (!p) return;
  p->input = inputBits;
  p->aimX = aimX; p->aimY = aimY;
  p->selectedTool = selectedTool;
  p->inputSeq = seq;
}

// Liquid coverage of the player's AABB. Liquids are non-solid to the player, so
// without buoyancy he'd fall/walk through them at full speed. Sampling the WHOLE
// body (not just the center cell) means wading — water at the feet/lower body but
// not the mid-body center — still registers. coverage is the fraction of the body's
// cells that are liquid; deterministic (pure grid sampling, no RNG).
struct PlayerFluidSample {
  double coverage = 0;
};
inline bool playerCellLiquid(int x, int y) {
  if (y < 0 || y >= rows || x < 0 || x >= cols) return false;
  return isLiquid(grid[I(x, y)]);
}
inline PlayerFluidSample samplePlayerFluid(const Player& p) {
  int ix0 = (int)std::floor(p.px), ix1 = (int)std::floor(p.px + p.w - 1e-6);
  int iy0 = (int)std::floor(p.py), iy1 = (int)std::floor(p.py + p.h - 1e-6);
  int total = 0, wet = 0;
  for (int y = iy0; y <= iy1; y++) {
    for (int x = ix0; x <= ix1; x++) {
      total++;
      if (playerCellLiquid(x, y)) wet++;
    }
  }
  PlayerFluidSample s;
  s.coverage = total > 0 ? (double)wet / (double)total : 0;
  return s;
}

void integratePlayer(Player& p) {
  if (!p.active) return;
  bool left = (p.input & PI_LEFT) != 0, right = (p.input & PI_RIGHT) != 0;
  bool run = (p.input & PI_RUN) != 0;
  bool wantJump = (p.input & PI_JUMP) != 0;
  // Two coverage thresholds: past MIN he's "in liquid" (drag + slow sink + slower
  // run); past the higher SWIM threshold he can also swim upward with jump/up.
  PlayerFluidSample fluid = samplePlayerFluid(p);
  bool inLiquid = fluid.coverage >= P_LIQUID_MIN_COVERAGE;
  bool swimming = fluid.coverage >= P_LIQUID_SWIM_COVERAGE;
  double maxRun = P_MAX_RUN * (run ? P_RUN_MULT : 1.0);
  if (inLiquid) maxRun *= P_LIQUID_RUN_MULT;

  // horizontal accel / friction
  if (left == right) { // none or both -> decelerate
    p.vx *= (p.grounded ? P_GROUND_FRICTION : P_AIR_FRICTION);
    if (std::fabs(p.vx) < 0.02) p.vx = 0;
  } else if (right) { p.vx += P_MOVE_ACCEL; p.facing = 1; }
  else              { p.vx -= P_MOVE_ACCEL; p.facing = -1; }
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
  if (!swimming && wantJump && canJump && p.jumpReady) { p.vy = -P_JUMP_VEL; p.grounded = false; p.jumpReady = false; }

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
  if (tryMoveY(p, p.vy)) p.vy = 0;
  // grounded := stable downward-edge contact (solid directly under the feet) OR
  // buried — flicker-free vs. the old "was the down-move blocked" test.
  int feetRow = (int)std::floor(p.py + p.h - 1e-6);
  p.grounded = rowSolid(p.px, p.w, feetRow + 1) || buryDepth(p) > 0;

  // ---- animation state (deterministic; reuses the fluid sample computed above) ----
  // Priority: liquid overrides airborne overrides grounded-move overrides idle. The
  // frame is a pure function of the shared `tick`, so prediction/replay stay in sync.
  double spd = std::fabs(p.vx);
  uint8_t as;
  if (swimming) as = AS_SWIM;
  else if (inLiquid) as = AS_WADE;
  else if (!p.grounded) as = (p.vy < -AS_RISE_EPS) ? AS_RISE : AS_FALL;
  else if (spd >= AS_RUN_SPEED && (p.input & PI_RUN)) as = AS_RUN;
  else if (spd >= AS_MOVE_EPS) as = AS_WALK;
  else as = AS_IDLE;
  p.animState = as;
  p.animFrame = (uint8_t)(((uint32_t)tick / ANIM_T[as]) % ANIM_N[as]);
}

// ---- player-mediated tool use (Terraria-like dig/build) ----
// The engine owns all policy: reach, cooldown, which materials place vs. mine,
// and the no-self-overlap rule for solid builds. JS only forwards PRIMARY/
// SECONDARY input bits + the aim cell.
uint8_t toolMaterial(int tool) {
  switch (tool) {
    case T_SAND: return SAND; case T_WATER: return WATER; case T_OIL: return OIL;
    case T_FIRE: return FIRE; case T_ACID: return ACID; case T_LAVA: return LAVA;
    default: return EMPTY;
  }
}
// Would a solid build (radius r at ax,ay) overlap the player's own AABB?
bool playerBuildOverlapsSelf(Player& p, int ax, int ay, int r) {
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
bool playerUseTool(Player& p, int ax, int ay, Layer* layer) {
  useLayer(layer);
  bool checkSelf = (layer == &fg);
  bool ok = false;
  switch (p.selectedTool) {
    case T_SAND: case T_WATER: case T_OIL: case T_FIRE: case T_ACID: case T_LAVA:
      paintDisc(ax, ay, P_PAINT_R, toolMaterial(p.selectedTool), false); ok = true; break;
    case T_SEED: {
      int x0, y0;
      if (getSeedOrigin(ax, ay, x0, y0) && canPlaceSeedAt(x0, y0)) { placeSeedAt(x0, y0); ok = true; }
      break;
    }
    case T_CUBE:
      if (!(checkSelf && playerBuildOverlapsSelf(p, ax, ay, CUBE_HALF))) {
        spawnBox(ax, ay, CUBE_HALF, CUBE_HALF, RIGID); ok = true;
      }
      break;
    default: break; // solids (stone/driftwood/ice) use the persistent draft in applyPlayerTools
  }
  useLayer(&fg);
  return ok;
}
inline bool isSolidTool(int t) { return t == T_STONE || t == T_DRIFTWOOD || t == T_ICE; }
// Mine a single disc AT THE AIM CELL into `layer` (like every other tool: a disc at
// the cursor, NOT a sweep emanating from the player). Each held-tool tick is one
// hit; DURABILITY[] controls base hardness and held class/tier controls progress.
void resetPlayerMine(Player& p) {
  if (!p.mineActive) return;
  useLayer(p.mineLayer ? &bg : &fg);
  clearMineDamageDisc(p.mineX, p.mineY, P_MINE_R);
  useLayer(&fg);
  p.mineActive = false;
}
bool mineDisc(Player& p, int ax, int ay, Layer* layer, bool scaledSpeed = true) {
  int layerId = layer == &bg ? 1 : 0;
  if (!p.mineActive || p.mineLayer != layerId || p.mineX != ax || p.mineY != ay) {
    resetPlayerMine(p);
    p.mineActive = true; p.mineLayer = layerId; p.mineX = ax; p.mineY = ay;
  }
  useLayer(layer);
  bool changed = mineDamageDisc(ax, ay, P_MINE_R, p, scaledSpeed) != 0;
  // Survival drops (foreground OR background mining). Each destroyed cell yields a
  // dropped ITEM iff the player's held tool satisfies the material's class+tier gate
  // (the bare hand additionally drops loose shovel-tier-0 soils; liquids scoop with
  // any tool). The block breaks either way; the tool only gates the reward. A cosmetic
  // PARTICLE always pops. No rand(): velocities use a (tick,cell) hash so the sim
  // stream stays deterministic.
  if (!lastMinedCells.empty()) {
    for (auto& mc : lastMinedCells) {
      uint8_t m = mc.first; int k = mc.second;
      int cxk = k % cols, cyk = k / cols;
      uint8_t cls = MAT_TOOLCLASS[m], tier = MAT_TOOLTIER[m];
      bool drop = false;
      if (isLiquid(m)) drop = true; // liquids are scoopable by any tool/hand (1 unit per cell)
      else if (cls != TC_NONE) {
        if (p.heldToolClass == cls && p.heldToolTier >= tier) drop = true;
        else if (p.heldToolClass == TC_HAND && cls == TC_SHOVEL && tier == TT_HAND) drop = true;
      }
      double j = whash2((uint32_t)tick * 2654435761u + (uint32_t)k, cxk, cyk) - 0.5;
      if (drop) spawnItem(m, 1, cxk + 0.5, cyk + 0.5, j * 0.4, -0.4);
      spawnParticle(m, cxk + 0.5, cyk + 0.5, j * 0.8, -0.6, IT_PARTICLE_LIFE);
    }
  }
  useLayer(&fg);
  return changed;
}
// ---- survival solids: the EXACT creative draft lifecycle, driven by a player ----
// Begin a persistent solid draft into `btn`'s layer (0=fg LMB, 1=bg RMB) using the
// player's own tool. This is the same engine draft state + live preview + finalize
// that creative mode uses (continueDrafts / finalize*Draft), so survival places
// solids identically: hold to draw a previewed shape, release to drop ONE connected
// piece (it stays if it lands on grounded terrain, falls as one body if mid-air).
void playerBeginSolidDraft(Player& p, int tool, int ax, int ay, int btn) {
  draftLayer = btn; draftOwner = p.id;
  useLayer(btn ? &bg : &fg);
  drafting = true;
  draftMaterial = (tool == T_ICE) ? ICE : (tool == T_DRIFTWOOD) ? DRIFTWOOD : STONE;
  addDiscToDraft(draft, ax, ay, brushFor(draftMaterial), draftMaterial == ICE ? rows - 1 : rows);
  useLayer(&fg);
}
// Finalize the in-progress draft into its layer (one connected component) and clear.
void playerFinalizeSolidDraft() {
  useLayer(draftLayer ? &bg : &fg);
  if (drafting) { finalizeDraft(); drafting = false; draft.clear(); }
  draftOwner = -1;
  useLayer(&fg);
}
// Per step: LMB (primary) acts on the FOREGROUND, RMB (secondary) on the BACKGROUND.
// Eraser sweeps toward the cursor and fluids/sand paint — both repeat while held
// (cooldown-throttled). Seed + cube fire once per press. Solids use the persistent
// creative draft: begin on press, extend (preview) while held, finalize on release.
void applyPlayerTools() {
  for (auto& p : players) {
    // Survival inventory drives the controls (selected slot = mine-tool or place-
    // material). Creative keeps the classic tool flow below.
    if (survivalInventory) { applyInventoryPlayer(p); continue; }
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

    // --- finalize this player's solid draft when its owning button releases (or all
    //     buttons are up) — independent of the currently selected tool ---
    if (drafting && draftOwner == p.id) {
      bool ownerReleased = (draftLayer == 1) ? secondaryFalling : primaryFalling;
      if (ownerReleased || (!primary && !secondary)) { playerFinalizeSolidDraft(); playerActionCount++; }
    }

    // --- SOLIDS: begin / extend the persistent draft (creative parity) ---
    if (isSolidTool(t)) {
      resetPlayerMine(p);
      bool busy = drafting;
      if (inReach && !busy && primaryRising) { playerBeginSolidDraft(p, t, ax, ay, 0); playerActionCount++; }
      else if (inReach && !busy && secondaryRising) { bgEnabled = true; playerBeginSolidDraft(p, t, ax, ay, 1); playerActionCount++; }
      else if (inReach && busy && draftOwner == p.id && (primary || secondary)) continueDrafts(ax, ay); // extend + preview
      continue;
    }

    // --- non-solids: fluids/sand (continuous paint), eraser (continuous sweep),
    //     seed/cube (one-shot on press) ---
    if (!primary && !secondary) { resetPlayerMine(p); continue; }
    bool continuous = isPaintTool(t) || t == T_ERASER;
    bool doPrimary = continuous ? primary : primaryRising;
    bool doSecondary = continuous ? secondary : secondaryRising;
    if (continuous && p.toolCooldown > 0) { doPrimary = doSecondary = false; }
    if (!doPrimary && !doSecondary) continue;
    if (!inReach) { resetPlayerMine(p); continue; }
    if (t != T_ERASER) resetPlayerMine(p);
    bool acted = false;
    if (doPrimary) {
      if (t == T_ERASER) acted |= mineDisc(p, ax, ay, &fg, false);
      else acted |= playerUseTool(p, ax, ay, &fg);
    }
    if (doSecondary) {
      bgEnabled = true;
      if (t == T_ERASER) acted |= mineDisc(p, ax, ay, &bg, false);
      else acted |= playerUseTool(p, ax, ay, &bg);
    }
    if (acted) {
      if (continuous) p.toolCooldown = P_TOOL_COOLDOWN;
      playerActionCount++;
    }
  }
}

void updatePlayers() {
  for (auto& p : players) if (p.active && p.alive) integratePlayer(p);
  applyPlayerTools();
}

// ---- client-side prediction support ----
// Step ONE player's physics against the current grid, without running the world
// simulation. The client predicts its own player this way (the host owns the
// world), recording inputs to replay after a server correction.
void stepPlayerOnly(int id) {
  Player* p = findPlayer(id);
  if (p && p->active && p->alive) integratePlayer(*p);
}
// Snap a player to an authoritative state (reconciliation), before replaying its
// unacknowledged inputs.
void setPlayerState(int id, double x, double y, double vx, double vy, int facing, int grounded, int jumpReady) {
  Player* p = findPlayer(id);
  if (!p) return;
  p->px = x; p->py = y; p->vx = vx; p->vy = vy;
  p->facing = facing; p->grounded = grounded != 0; p->jumpReady = jumpReady != 0;
}

// Pack all players into playerSnapshot as flat float32 records (stride
// PLAYER_SNAP_STRIDE). JS reads this zero-copy to draw the player overlay.
int buildPlayerSnapshot() {
  playerSnapshot.assign((size_t)players.size() * PLAYER_SNAP_STRIDE, 0.0f);
  for (size_t i = 0; i < players.size(); i++) {
    const Player& p = players[i];
    float* o = playerSnapshot.data() + i * PLAYER_SNAP_STRIDE;
    o[0]  = (float)p.id;
    o[1]  = p.active ? 1.0f : 0.0f;
    o[2]  = (float)p.px;
    o[3]  = (float)p.py;
    o[4]  = (float)p.vx;
    o[5]  = (float)p.vy;
    o[6]  = (float)p.w;
    o[7]  = (float)p.h;
    o[8]  = (float)p.facing;
    o[9]  = p.grounded ? 1.0f : 0.0f;
    o[10] = (float)p.selectedTool;
    o[11] = (float)p.aimX;
    o[12] = (float)p.aimY;
    o[13] = (float)p.health;
    o[14] = (float)p.inputSeq;
    o[15] = p.alive ? 1.0f : 0.0f;
    o[16] = p.jumpReady ? 1.0f : 0.0f; // hidden jump state, needed for reconciliation
    o[17] = (float)p.animState;
    o[18] = (float)p.animFrame;
  }
  return (int)players.size();
}
