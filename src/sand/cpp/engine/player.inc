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
// Advance one axis by `d` in <=P_MOVE_SUBSTEP increments, stopping at the first
// solid contact. Returns true if movement was blocked.
bool tryMoveX(Player& p, double d) {
  if (d == 0) return false;
  double step = d > 0 ? P_MOVE_SUBSTEP : -P_MOVE_SUBSTEP, moved = 0;
  while (std::fabs(moved) < std::fabs(d)) {
    double adv = (std::fabs(d - moved) < P_MOVE_SUBSTEP) ? (d - moved) : step;
    if (!playerBoxHits(p.px + adv, p.py, p.w, p.h)) { p.px += adv; moved += adv; continue; }
    // Blocked: when grounded, try to auto-climb a low ledge (so walking over
    // bumpy terrain / a 1-cell step doesn't stall, Terraria-style).
    bool climbed = false;
    if (p.grounded) {
      for (double up = P_MOVE_SUBSTEP; up <= P_STEP_UP + 1e-9; up += P_MOVE_SUBSTEP) {
        if (!playerBoxHits(p.px, p.py - up, p.w, p.h) && !playerBoxHits(p.px + adv, p.py - up, p.w, p.h)) {
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

  // jump: edge-triggered (press, not hold) and only when grounded
  bool jumpPressed = (p.input & PI_JUMP) && !(p.prevInput & PI_JUMP);
  if (jumpPressed && p.grounded) { p.vy = -P_JUMP_VEL; p.grounded = false; }

  // horizontal move
  if (tryMoveX(p, p.vx)) p.vx = 0;

  // gravity + vertical move; grounded iff blocked while moving down
  p.vy += P_GRAVITY;
  if (p.vy > P_MAX_FALL) p.vy = P_MAX_FALL;
  bool blockedDown = false;
  if (tryMoveY(p, p.vy)) { blockedDown = (p.vy > 0); p.vy = 0; }
  p.grounded = blockedDown;

  p.prevInput = p.input;
}

void updatePlayers() {
  for (auto& p : players) if (p.active && p.alive) integratePlayer(p);
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
  }
  return (int)players.size();
}
