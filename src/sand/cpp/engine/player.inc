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
// Horizontal collision is forgiving: the player is blocked only when MORE THAN
// HALF of his lower half is solid at the candidate position. A single protruding
// pixel (or a thin bump) doesn't stall him — he slides/steps over it. The upper
// half is ignored for horizontal blocking, so he can clip a shallow overhang.
// (Vertical collision still uses the full box, so he never sinks through floors.)
inline bool lowerHalfBlocked(double px, double py, int w, int h) {
  int ix0 = (int)std::floor(px), ix1 = (int)std::floor(px + w - 1e-6);
  int iy0 = (int)std::floor(py + h / 2.0), iy1 = (int)std::floor(py + h - 1e-6);
  int solid = 0, total = 0;
  for (int y = iy0; y <= iy1; y++)
    for (int x = ix0; x <= ix1; x++) { total++; if (playerCellSolid(x, y)) solid++; }
  return total > 0 && solid * 2 > total;
}
// Advance one axis by `d` in <=P_MOVE_SUBSTEP increments. Returns true if blocked.
bool tryMoveX(Player& p, double d) {
  if (d == 0) return false;
  double step = d > 0 ? P_MOVE_SUBSTEP : -P_MOVE_SUBSTEP, moved = 0;
  while (std::fabs(moved) < std::fabs(d)) {
    double adv = (std::fabs(d - moved) < P_MOVE_SUBSTEP) ? (d - moved) : step;
    if (!lowerHalfBlocked(p.px + adv, p.py, p.w, p.h)) { p.px += adv; moved += adv; continue; }
    // Blocked: when grounded, try to auto-climb a low ledge (so walking over
    // bumpy terrain / a 1-cell step doesn't stall, Terraria-style).
    bool climbed = false;
    if (p.grounded) {
      for (double up = P_MOVE_SUBSTEP; up <= P_STEP_UP + 1e-9; up += P_MOVE_SUBSTEP) {
        if (!lowerHalfBlocked(p.px, p.py - up, p.w, p.h) && !lowerHalfBlocked(p.px + adv, p.py - up, p.w, p.h)) {
          p.py -= up; p.px += adv; moved += adv; climbed = true; break;
        }
      }
    }
    if (!climbed) return true;
  }
  return false;
}
bool tryMoveY(Player& p, double d) {
  if (d == 0) return false;
  double step = d > 0 ? P_MOVE_SUBSTEP : -P_MOVE_SUBSTEP, moved = 0;
  while (std::fabs(moved) < std::fabs(d)) {
    double adv = (std::fabs(d - moved) < P_MOVE_SUBSTEP) ? (d - moved) : step;
    if (playerBoxHits(p.px, p.py + adv, p.w, p.h)) return true;
    p.py += adv; moved += adv;
  }
  return false;
}

int spawnPlayer(double x, double y) {
  Player p;
  p.id = nextPlayerId++;
  p.px = x; p.py = y;
  p.aimX = x; p.aimY = y;
  players.push_back(p);
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

void integratePlayer(Player& p) {
  if (!p.active) return;
  bool left = (p.input & PI_LEFT) != 0, right = (p.input & PI_RIGHT) != 0;
  bool run = (p.input & PI_RUN) != 0;
  double maxRun = P_MAX_RUN * (run ? P_RUN_MULT : 1.0);

  // horizontal accel / friction
  if (left == right) { // none or both -> decelerate
    p.vx *= (p.grounded ? P_GROUND_FRICTION : P_AIR_FRICTION);
    if (std::fabs(p.vx) < 0.02) p.vx = 0;
  } else if (right) { p.vx += P_MOVE_ACCEL; p.facing = 1; }
  else              { p.vx -= P_MOVE_ACCEL; p.facing = -1; }
  if (p.vx >  maxRun) p.vx =  maxRun;
  if (p.vx < -maxRun) p.vx = -maxRun;

  // jump: re-arm only when grounded AND the key is released, then fire on a held
  // press while grounded. The armed flag persists across frames, so a press isn't
  // lost to a single-frame `grounded` flicker (resting on shifting surface sand) —
  // unlike a raw 1-frame edge. Requiring a release to re-arm means holding the key
  // does NOT auto-bounce (Terraria-style: one press = one jump).
  bool wantJump = (p.input & PI_JUMP) != 0;
  if (p.grounded && !wantJump) p.jumpReady = true;
  if (wantJump && p.grounded && p.jumpReady) { p.vy = -P_JUMP_VEL; p.grounded = false; p.jumpReady = false; }

  // horizontal move
  if (tryMoveX(p, p.vx)) p.vx = 0;

  // gravity + vertical move; grounded iff blocked while moving down
  p.vy += P_GRAVITY;
  if (p.vy > P_MAX_FALL) p.vy = P_MAX_FALL;
  bool blockedDown = false;
  if (tryMoveY(p, p.vy)) { blockedDown = (p.vy > 0); p.vy = 0; }
  p.grounded = blockedDown;
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
    case T_STONE:
      if (!(checkSelf && playerBuildOverlapsSelf(p, ax, ay, P_BUILD_R))) {
        draftIsDriftwood = false; addDiscToDraft(stoneDraft, ax, ay, P_BUILD_R, rows);
        finalizeStoneDraft(); stoneDraft.clear(); ok = true;
      }
      break;
    case T_DRIFTWOOD:
      if (!(checkSelf && playerBuildOverlapsSelf(p, ax, ay, P_BUILD_R))) {
        addDiscToDraft(stoneDraft, ax, ay, P_BUILD_R, rows);
        finalizeDriftwoodDraft(); stoneDraft.clear(); ok = true;
      }
      break;
    case T_ICE:
      if (!(checkSelf && playerBuildOverlapsSelf(p, ax, ay, P_BUILD_R))) {
        addDiscToDraft(iceDraft, ax, ay, P_BUILD_R, rows - 1);
        finalizeIceDraft(); iceDraft.clear(); ok = true;
      }
      break;
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
    default: break;
  }
  useLayer(&fg);
  return ok;
}
// Per step: LMB (primary) acts on the FOREGROUND, RMB (secondary) on the
// BACKGROUND; the Eraser tool mines its layer. Fluids/sand/eraser repeat while
// held (throttled by the cooldown); solids + the cube fire ONCE per press (rising
// edge), so holding doesn't spam blocks/boxes.
void applyPlayerTools() {
  for (auto& p : players) {
    if (!p.active || !p.alive) { p.prevInput = p.input; continue; }
    if (p.toolCooldown > 0) p.toolCooldown--;
    bool primary = (p.input & PI_PRIMARY) != 0, secondary = (p.input & PI_SECONDARY) != 0;
    bool primaryEdge = primary && !(p.prevInput & PI_PRIMARY);
    bool secondaryEdge = secondary && !(p.prevInput & PI_SECONDARY);
    p.prevInput = p.input;
    if (!primary && !secondary) continue;
    bool continuous = isPaintTool(p.selectedTool) || p.selectedTool == T_ERASER;
    bool doPrimary = continuous ? primary : primaryEdge;
    bool doSecondary = continuous ? secondary : secondaryEdge;
    if (continuous && p.toolCooldown > 0) { doPrimary = doSecondary = false; }
    if (!doPrimary && !doSecondary) continue;
    // reach: aim must be within P_TOOL_REACH cells of the player center.
    double cxp = p.px + p.w / 2.0, cyp = p.py + p.h / 2.0;
    int ax = (int)std::floor(p.aimX), ay = (int)std::floor(p.aimY);
    double dxp = (ax + 0.5) - cxp, dyp = (ay + 0.5) - cyp;
    if (dxp * dxp + dyp * dyp > P_TOOL_REACH * P_TOOL_REACH) continue;
    bool acted = false;
    if (doPrimary) {
      if (p.selectedTool == T_ERASER) { useLayer(&fg); eraseDisc(ax, ay, P_MINE_R); useLayer(&fg); acted = true; }
      else acted |= playerUseTool(p, ax, ay, &fg);
    }
    if (doSecondary) {
      bgEnabled = true;
      if (p.selectedTool == T_ERASER) { useLayer(&bg); eraseDisc(ax, ay, P_MINE_R); useLayer(&fg); acted = true; }
      else acted |= playerUseTool(p, ax, ay, &bg);
    }
    if (acted) { if (continuous) p.toolCooldown = P_TOOL_COOLDOWN; playerActionCount++; }
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
  }
  return (int)players.size();
}
