// Player characters: deterministic AABB platformer physics over the cell grid.
// JS/network supplies a normalized input bitmask + aim per step; the engine owns
// movement, collision, and player-mediated tool use. No RNG is used, so
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
// During a body step every free-body stamp is temporarily absent from the grid.
// Actor displacement therefore checks the finalized body poses directly so a
// second body remains a real obstacle in a rigid/actor/rigid sandwich.
bool PlayerSystem::playerBoxHitsOtherBody(double px, double py, int w, int h,
                                          const Body* ignored) {
  for (Body* body : E.fg.bodies) {
    if (body == ignored || body->jointRole == 2) continue;
    double radius = body->maxR + 1.0;
    if (px >= body->px + radius || px + w <= body->px - radius ||
        py >= body->py + radius || py + h <= body->py - radius) continue;
    bool hit = false;
    E.rigid.forEachBodyCell(body, [&](int x, int y, int) {
      if (!hit && px < x + 1 && px + w > x && py < y + 1 && py + h > y) hit = true;
    });
    if (hit) return true;
  }
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

bool PlayerSystem::spawnAreaLoaded(double px, double py, int margin) {
  int x0 = (int)std::floor(px) - margin;
  int y0 = (int)std::floor(py) - margin;
  int x1 = (int)std::floor(px + PLAYER_W - 1e-6) + margin;
  int y1 = (int)std::floor(py + PLAYER_H - 1e-6) + margin + 1; // support row
  return x0 >= 0 && y0 >= 0 && x1 < E.cols && y1 < E.rows;
}

bool PlayerSystem::spawnOverlapsPlayer(double px, double py, const Player* ignore) {
  for (const Player& other : players) {
    if (&other == ignore || !other.active || !other.alive) continue;
    if (px < other.px + other.w && px + PLAYER_W > other.px &&
        py < other.py + other.h && py + PLAYER_H > other.py) return true;
  }
  return false;
}

// A safe spawn is immediately supported (never hanging high in the air), has a
// clear body box, and has no fire/corrosive/molten cells close enough to deal
// damage before the player can move. Foreground is the only player-physical
// layer, so background decoration intentionally does not reject a candidate.
bool PlayerSystem::safeSpawnAt(double px, double py, const Player* ignore) {
  if (!spawnAreaLoaded(px, py, P_SPAWN_HAZARD_MARGIN) || spawnOverlapsPlayer(px, py, ignore)) return false;
  int x0 = (int)std::floor(px), x1 = (int)std::floor(px + PLAYER_W - 1e-6);
  int y0 = (int)std::floor(py), y1 = (int)std::floor(py + PLAYER_H - 1e-6);
  auto harmful = [](uint8_t m) { return m == FIRE || m == ACID || m == LAVA; };
  for (int y = y0 - P_SPAWN_HAZARD_MARGIN; y <= y1 + P_SPAWN_HAZARD_MARGIN; y++)
    for (int x = x0 - P_SPAWN_HAZARD_MARGIN; x <= x1 + P_SPAWN_HAZARD_MARGIN; x++)
      if (harmful(E.fg.grid[E.I(x, y)])) return false;
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
    uint8_t m = E.fg.grid[E.I(x, y)];
    if (E.isBlockingForPlayer(m)) return false;
  }
  int support = 0;
  for (int x = x0; x <= x1; x++) {
    uint8_t m = E.fg.grid[E.I(x, y1 + 1)];
    if (E.isBlockingForPlayer(m) && !harmful(m)) support++;
  }
  return support >= imax(2, PLAYER_W / 2);
}

// Resolve around an ABSOLUTE first-spawn anchor. Candidate order is stable:
// closest horizontal position, then closest elevation, with left/above winning
// ties. This is called rarely (join/respawn), so clarity beats a spatial index.
bool PlayerSystem::findSafeSpawnNearWorld(double worldX, double worldY, double* out, const Player* ignore) {
  int baseX = (int)std::lround(worldX - E.fg.worldOffsetX);
  int baseY = (int)std::lround(worldY - E.fg.worldOffsetY);
  int bestDistance2 = INT_MAX;
  bool found = false;
  for (int ax = 0; ax <= P_SPAWN_SEARCH_X; ax++) {
    for (int xs = 0; xs < (ax == 0 ? 1 : 2); xs++) {
      int x = baseX + (ax == 0 ? 0 : (xs == 0 ? -ax : ax));
      for (int ay = 0; ay <= P_SPAWN_SEARCH_Y; ay++) {
        int distance2 = ax * ax + ay * ay;
        if (distance2 >= bestDistance2) continue;
        for (int ys = 0; ys < (ay == 0 ? 1 : 2); ys++) {
          int y = baseY + (ay == 0 ? 0 : (ys == 0 ? -ay : ay));
          if (distance2 >= bestDistance2 || !safeSpawnAt(x, y, ignore)) continue;
          bestDistance2 = distance2;
          out[0] = x; out[1] = y;
          found = true;
        }
      }
    }
  }
  return found;
}

// Absolute spawn terrain can be completely destroyed or flooded. Once its
// neighborhood is loaded, make the smallest reliable rescue site: erase the
// body/hazard margin with the shared component-aware eraser, then place a short
// stone platform with two narrow supports reaching existing ground (or the
// buffer floor). placeMaterialAt registers every stone cell, avoiding the
// component-less raw writes that would flicker away next step.
bool PlayerSystem::buildSafeSpawnPad(double worldX, double worldY, double* out, const Player* ignore) {
  int baseX = (int)std::lround(worldX - E.fg.worldOffsetX);
  int baseY = (int)std::lround(worldY - E.fg.worldOffsetY);
  for (int offset = 0; offset <= P_SPAWN_SEARCH_X; offset += 8) {
    for (int side = 0; side < (offset == 0 ? 1 : 2); side++) {
      int x0 = baseX + (offset == 0 ? 0 : (side == 0 ? -offset : offset));
      int y0 = baseY;
      if (!spawnAreaLoaded(x0, y0, P_SPAWN_HAZARD_MARGIN + 1) ||
          spawnOverlapsPlayer(x0, y0, ignore)) continue;
      int left = x0 - P_SPAWN_HAZARD_MARGIN;
      int right = x0 + PLAYER_W - 1 + P_SPAWN_HAZARD_MARGIN;
      int top = y0 - P_SPAWN_HAZARD_MARGIN;
      int platformY = y0 + PLAYER_H;
      int pillarLeft = x0 - 1, pillarRight = x0 + PLAYER_W;
      int pillarBottom = platformY + 1;
      for (; pillarBottom < E.rows - 1; pillarBottom++) {
        uint8_t ml = E.fg.grid[E.I(pillarLeft, pillarBottom + 1)];
        uint8_t mr = E.fg.grid[E.I(pillarRight, pillarBottom + 1)];
        if (E.isBlockingForPlayer(ml) || E.isBlockingForPlayer(mr)) break;
      }

      std::vector<int> erase;
      erase.reserve((right - left + 1) * (platformY + 2 - top) +
                    2 * imax(0, pillarBottom - platformY));
      for (int y = top; y <= platformY + 1; y++)
        for (int x = left; x <= right; x++) erase.push_back(E.I(x, y));
      for (int y = platformY + 2; y <= pillarBottom; y++) {
        erase.push_back(E.I(pillarLeft, y));
        erase.push_back(E.I(pillarRight, y));
      }
      E.useLayer(&E.fg);
      E.eraseStrokeCells(erase, left, top, right, pillarBottom);
      for (int y = platformY; y <= platformY + 1; y++)
        for (int x = left; x <= right; x++) E.placeMaterialAt(x, y, 0, STONE);
      for (int y = platformY + 2; y <= pillarBottom; y++) {
        E.placeMaterialAt(pillarLeft, y, 0, STONE);
        E.placeMaterialAt(pillarRight, y, 0, STONE);
      }
      if (!safeSpawnAt(x0, y0, ignore)) continue;
      out[0] = x0; out[1] = y0;
      return true;
    }
  }
  return false;
}

int PlayerSystem::spawnPlayer(double x, double y) {
  Player p;
  p.id = nextPlayerId++;
  p.px = x; p.py = y;
  p.spawnWorldX = E.fg.worldOffsetX + x;
  p.spawnWorldY = E.fg.worldOffsetY + y;
  p.aimX = x; p.aimY = y;
  p.jetpackFuel = 1.0;
  players.push_back(p);
  if (E.survivalInventory) E.seedStarterTools(players.back());
  return p.id;
}
void PlayerSystem::playerSurfaceSpawn(int col, double* out) {
  col = std::max(PLAYER_W, std::min(E.cols - PLAYER_W - 1, col));
  int worldX0 = E.fg.worldOffsetX;
  int top = E.fg.infinite ? E.genSurfaceAt(worldX0 + col) : E.rows / 2;
  for (int c = col - PLAYER_W; c <= col + PLAYER_W; c++) {
    int surf = E.fg.infinite ? E.genSurfaceAt(worldX0 + c) : E.rows / 2;
    if (surf < top) top = surf;
  }
  double roughX = col - PLAYER_W / 2.0;
  double roughY = top - PLAYER_H - 4;
  if (findSafeSpawnNearWorld(worldX0 + roughX, E.fg.worldOffsetY + roughY, out, nullptr)) return;
  // A read-only surface query cannot build the rescue pad. Keep this fallback
  // near the generated surface; spawnPlayerAtSurface will normally never need it.
  out[0] = roughX;
  out[1] = top - PLAYER_H;
}
int PlayerSystem::spawnPlayerAtSurface(int col) {
  double out[2];
  playerSurfaceSpawn(col, out);
  return spawnPlayer(out[0], out[1]);
}
bool PlayerSystem::respawnPlayer(Player& p) {
  double out[2];
  // Do not revive outside the loaded buffer. Keeping the dead player's local
  // pose at the absolute anchor makes the existing worker camera streaming and
  // multiplayer shared-window sync load the right chunks without a destructive,
  // synchronous global shift here.
  double localAnchorX = p.spawnWorldX - E.fg.worldOffsetX;
  double localAnchorY = p.spawnWorldY - E.fg.worldOffsetY;
  if (!spawnAreaLoaded(localAnchorX, localAnchorY, P_SPAWN_HAZARD_MARGIN + 1)) return false;
  if (!findSafeSpawnNearWorld(p.spawnWorldX, p.spawnWorldY, out, &p) &&
      !buildSafeSpawnPad(p.spawnWorldX, p.spawnWorldY, out, &p)) return false;
  p.px = out[0]; p.py = out[1]; p.vx = p.vy = 0;
  p.health = 100; p.alive = true; p.grounded = false; p.jumpReady = false;
  p.deathTicks = 0; p.buriedTicks = 0; p.bowChargeTicks = 0; p.lastDamageTick = E.actorTick;
  p.respawnPending = false;
  p.jetpackFuel = 1.0; p.jetpackActive = false;
  p.shieldHealth = P_SHIELD_MAX_HEALTH; p.shieldHurtCooldown = 0;
  p.lastShieldDamageTick = -1000000;
  p.shieldActive = false;
  p.hurtCooldown = 120;
  resetPlayerMine(p); p.placeStrokeActive = false; p.prevInput = p.input;
  if (E.tools.drafting && E.tools.draftOwner == p.id) playerFinalizeSolidDraft();
  // Death drops the old loadout into the world; always restore the starter gun
  // so respawning cannot leave the combat mode soft-locked with empty hands.
  if (E.survivalInventory) E.seedStarterTools(p);
  E.audio.emit(SE_RESPAWN, p.px + p.w * .5, p.py + p.h * .5, 0.9, EMPTY);
  return true;
}
bool PlayerSystem::requestRespawn(int id) {
  Player* p = findPlayer(id);
  if (!p || p->alive || p->respawnPending) return false;
  p->respawnPending = true;
  p->px = p->spawnWorldX - E.fg.worldOffsetX;
  p->py = p->spawnWorldY - E.fg.worldOffsetY;
  p->aimX = p->px + p->w * 0.5;
  p->aimY = p->py + p->h * 0.5;
  respawnPlayer(*p); // immediate when the original spawn neighborhood is loaded
  return true;       // request accepted; otherwise streaming completes it later
}
void PlayerSystem::killPlayer(Player& p) {
  if (!p.alive) return;
  p.health = 0; p.alive = false; p.deathTicks = 0; p.vx = p.vy = 0; p.bowChargeTicks = 0;
  p.respawnPending = false; p.jetpackActive = false; p.shieldActive = false;
  resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p);
  if (E.tools.drafting && E.tools.draftOwner == p.id) playerFinalizeSolidDraft();
  E.inv.dropAll(p);
  E.audio.emit(SE_DEATH, p.px + p.w * .5, p.py + p.h * .5, 1.0, EMPTY);
}
void PlayerSystem::crushPlayer(Player& p) {
  killPlayer(p);
}
bool PlayerSystem::shieldCoversSource(const Player& p, double sourceX, double sourceY) const {
  if (!p.shieldActive || p.shieldHealth <= 0 ||
      !std::isfinite(sourceX) || !std::isfinite(sourceY)) return false;
  double centreX = p.px + p.w * .5, centreY = p.py + p.h * .5;
  double aimDx = p.aimX - centreX, aimDy = p.aimY - centreY;
  double aimLength = std::hypot(aimDx, aimDy);
  if (aimLength < 1e-6) { aimDx = p.facing; aimDy = 0; aimLength = 1; }
  double sourceDx = sourceX - centreX, sourceDy = sourceY - centreY;
  double sourceLength = std::hypot(sourceDx, sourceDy);
  if (sourceLength < 1e-6) return false; // no meaningful incoming direction
  double dot = aimDx * sourceDx + aimDy * sourceDy;
  return dot + 1e-9 >= P_SHIELD_HALF_ARC_COS * aimLength * sourceLength;
}
int PlayerSystem::damagePlayer(Player& p, int damage, int cooldown,
                               double sourceX, double sourceY,
                               bool bypassCooldown) {
  if (!p.active || !p.alive || damage <= 0) return 0;
  int remaining = damage;
  if (shieldCoversSource(p, sourceX, sourceY)) {
    if (!bypassCooldown && p.shieldHurtCooldown > 0) return 0;
    int shieldBefore = p.shieldHealth;
    int absorbed = imin(p.shieldHealth, remaining);
    p.shieldHealth -= absorbed;
    p.lastShieldDamageTick = E.actorTick;
    // Ward impacts use their own short immunity window. This
    // preserves the intended "200 ward ~= twice 100 health" combat durability
    // against high-rate explosive rounds without making the player's unguarded
    // rear invulnerable after a frontal block.
    p.shieldHurtCooldown = cooldown;
    E.audio.emit(SE_SHIELD_HIT, p.px + p.w * .5, p.py + p.h * .5,
                 std::min(1.2, .4 + absorbed / 40.0), EMPTY);
    if (shieldBefore > 0 && p.shieldHealth <= 0)
      E.audio.emit(SE_SHIELD_BREAK, p.px + p.w * .5, p.py + p.h * .5, 1.0, EMPTY);
    remaining -= absorbed;
    if (p.shieldHealth <= 0) p.shieldActive = false;
    if (remaining <= 0) return 0;
  }
  if (!bypassCooldown && p.hurtCooldown > 0) return 0;
  p.health -= remaining; p.hurtCooldown = cooldown; p.lastDamageTick = E.actorTick;
  E.audio.emit(SE_HURT, p.px + p.w * .5, p.py + p.h * .5, std::min(1.2, .45 + remaining / 30.0), EMPTY);
  if (p.health <= 0) killPlayer(p);
  return remaining;
}
void PlayerSystem::updatePlayerVitals(Player& p) {
  if (!p.alive) { p.deathTicks++; return; }
  p.shieldActive = (p.input & PI_SHIELD) != 0 && p.shieldHealth > 0;
  if (p.shieldHealth < P_SHIELD_MAX_HEALTH &&
      E.actorTick - p.lastShieldDamageTick >= P_SHIELD_RECHARGE_DELAY)
    p.shieldHealth = imin(P_SHIELD_MAX_HEALTH,
                          p.shieldHealth + P_SHIELD_RECHARGE_PER_TICK);
  int x0 = imax(0, (int)std::floor(p.px)), x1 = imin(E.cols - 1, (int)std::floor(p.px + p.w - 1e-6));
  int y0 = imax(0, (int)std::floor(p.py)), y1 = imin(E.rows - 1, (int)std::floor(p.py + p.h - 1e-6));
  int cells = 0, blocked = 0; bool fire = false, acid = false, lava = false;
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
    uint8_t m = E.fg.grid[E.I(x, y)]; cells++; blocked += E.isBlockingForPlayer(m) ? 1 : 0;
    fire |= m == FIRE; acid |= m == ACID; lava |= m == LAVA;
  }
  if (cells > 0 && blocked * 2 >= cells) p.buriedTicks++; else p.buriedTicks = 0;
  if (p.landingImpact > 3.0) damagePlayer(p, imin(45, (int)std::floor((p.landingImpact - 3.0) * 15.0)), 12);
  p.landingImpact = 0;
  if (lava && E.actorTick % 15 == 0) damagePlayer(p, 15, 15);
  else if (acid && E.actorTick % ACID_CONTACT_INTERVAL == 0)
    damagePlayer(p, ACID_CONTACT_DAMAGE, ACID_CONTACT_INTERVAL);
  else if (fire && E.actorTick % 30 == 0) damagePlayer(p, 4, 30);
  else if (p.buriedTicks >= 120 && E.actorTick % 30 == 0) damagePlayer(p, 2, 30);
  bool hazard = fire || acid || lava || p.buriedTicks >= 120;
  if (!hazard && p.health < 100 && E.actorTick - p.lastDamageTick >= 300 && E.actorTick % 30 == 0) p.health++;
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
  // Ward use is an exclusive stance. Keep movement/jetpack input available,
  // but never let a held mouse button leak into weapons, mining, or placement
  // while the ward has durability and can actually be raised.
  if ((inputBits & PI_SHIELD) && p->shieldHealth > 0)
    inputBits &= ~(PI_PRIMARY | PI_SECONDARY);
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
  // Facing follows the hand/cursor, independently of movement. A narrow
  // horizontal dead zone keeps straight-up/down aim from flickering sides as
  // quantized pointer cells cross the player's centre.
  double aimDx = aimX - (p->px + p->w * 0.5);
  if (std::isfinite(aimDx) && std::fabs(aimDx) > P_AIM_FACING_DEADZONE)
    p->facing = aimDx > 0 ? 1 : -1;
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
  p.shieldActive = (p.input & PI_SHIELD) != 0 && p.shieldHealth > 0;
  bool wasGrounded = p.grounded;
  bool left = (p.input & PI_LEFT) != 0, right = (p.input & PI_RIGHT) != 0;
  double moveX = p.analogInput ? p.inputX : ((right ? 1.0 : 0.0) - (left ? 1.0 : 0.0));
  double moveStrength = std::fabs(moveX);
  bool run = (p.input & PI_RUN) != 0;
  bool wantJump = (p.input & PI_JUMP) != 0;
  bool wantJetpack = (p.input & PI_JETPACK) != 0;
  p.jetpackActive = false;
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
    p.vy += E.scaledGravity(P_LIQUID_GRAVITY);
    if (swimming && wantJump) p.vy -= P_LIQUID_SWIM_ACCEL;
    if (p.vy < P_LIQUID_MAX_RISE) p.vy = P_LIQUID_MAX_RISE;
    if (p.vy > P_LIQUID_MAX_FALL) p.vy = P_LIQUID_MAX_FALL;
  } else {
    p.vy += E.scaledGravity(P_GRAVITY);
    // Space keeps thrusting after the ordinary ground jump. Preserve the
    // stronger initial jump impulse, then accelerate upward once it decays into
    // the jetpack's speed band. Holding an empty pack does not create a
    // recharge/thrust pulse: release Space (or land/swim) to refill it.
    bool canThrust = !p.grounded && wantJetpack && p.jetpackFuel > 1e-9;
    if (canThrust) {
      p.jetpackActive = true;
      p.jetpackFuel = std::max(0.0, p.jetpackFuel - P_JETPACK_BURN);
      if (p.vy > -P_JETPACK_MAX_RISE)
        p.vy = std::max(-P_JETPACK_MAX_RISE, p.vy - P_JETPACK_THRUST);
    } else if (!wantJetpack || p.grounded) {
      p.jetpackFuel = std::min(1.0, p.jetpackFuel + P_JETPACK_RECHARGE);
    }
    if (p.vy > P_MAX_FALL) p.vy = P_MAX_FALL;
  }
  // Liquids suppress the flame but safely recharge the pack; swimming retains
  // its established jump/up behavior.
  if (inLiquid) {
    p.jetpackActive = false;
    p.jetpackFuel = std::min(1.0, p.jetpackFuel + P_JETPACK_RECHARGE);
  }
  double impactVy = p.vy;
  if (tryMoveY(p, p.vy)) p.vy = 0;
  // grounded := stable downward-edge contact (solid directly under the feet) OR
  // buried — flicker-free vs. the old "was the down-move blocked" test.
  int feetRow = (int)std::floor(p.py + p.h - 1e-6);
  p.grounded = rowSolid(p.px, p.w, feetRow + 1) || buryDepth(p) > 0;
  if (!wasGrounded && p.grounded && !inLiquid) p.landingImpact = impactVy;
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
// Survival reuses the creative solid-draft lifecycle: hold to preview one
// connected piece and release to finalize it in the selected layer.
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

    // Finalize this player's draft when its owning button is released.
    if (E.tools.drafting && E.tools.draftOwner == p.id) {
      bool ownerReleased = (E.tools.draftLayer == 1) ? secondaryFalling : primaryFalling;
      if (ownerReleased || (!primary && !secondary)) { playerFinalizeSolidDraft(); E.playerActionCount++; }
    }

    // Begin or extend a solid draft.
    if (isSolidTool(t)) {
      resetPlayerMine(p);
      bool busy = E.tools.drafting;
      if (inReach && !busy && primaryRising) { playerBeginSolidDraft(p, t, ax, ay, 0); E.playerActionCount++; }
      else if (inReach && !busy && secondaryRising) { E.bgEnabled = true; playerBeginSolidDraft(p, t, ax, ay, 1); E.playerActionCount++; }
      else if (inReach && busy && E.tools.draftOwner == p.id && (primary || secondary)) E.continueDrafts(ax, ay); // extend + preview
      else if (!inReach && busy && E.tools.draftOwner == p.id) E.tools.draftStrokeActive = false;
      continue;
    }

    // Paint and erase continuously; seed/cube tools act once per press.
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
    if (p.active && !p.alive && p.respawnPending) respawnPlayer(p);
    if (p.hurtCooldown > 0) p.hurtCooldown--;
    if (p.shieldHurtCooldown > 0) p.shieldHurtCooldown--;
    if (p.active && p.alive) integratePlayer(p);
    if (p.active) updatePlayerVitals(p);
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
void PlayerSystem::setPlayerState(int id, double x, double y, double vx, double vy, int facing, int grounded, int jumpReady,
                                  double jetpackFuel, int jetpackActive) {
  Player* p = findPlayer(id);
  if (!p) return;
  p->px = x; p->py = y; p->vx = vx; p->vy = vy;
  p->facing = facing; p->grounded = grounded != 0; p->jumpReady = jumpReady != 0;
  p->jetpackFuel = std::isfinite(jetpackFuel) ? std::max(0.0, std::min(1.0, jetpackFuel)) : 0.0;
  p->jetpackActive = jetpackActive != 0 && p->jetpackFuel > 0;
}

// Pack players into flat PS_STRIDE records for replication and presentation.
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
    o[PS_DEATH_TICKS] = (float)p.deathTicks;
    o[PS_RESPAWN_READY] = (!p.alive && !p.respawnPending) ? 1.0f : 0.0f;
    const InvSlot& held = p.inv[p.selectedSlot];
    double chargeMax = held.count > 0 && held.itemKind == IK_BORE_CANNON
      ? BORE_CANNON_CHARGE_TICKS : BOW_CHARGE_MAX;
    o[PS_BOW_CHARGE] = (float)(p.bowChargeTicks / chargeMax);
    o[PS_HELD_ITEM_KIND] = held.count > 0 ? (float)held.itemKind : (float)IK_MATERIAL;
    o[PS_JETPACK_FUEL] = (float)p.jetpackFuel;
    o[PS_JETPACK_ACTIVE] = p.jetpackActive ? 1.0f : 0.0f;
    o[PS_SHIELD_HEALTH] = (float)p.shieldHealth;
    o[PS_SHIELD_ACTIVE] = p.shieldActive ? 1.0f : 0.0f;
  }
  return (int)players.size();
}
