bool BedSystem::eligible(const Creature& c) const {
  return c.alive && c.health > 0 && (c.npcId || c.species == CS_VILLAGER
    || c.species == CS_VILLAGE_GUARD || c.species == CS_VILLAGE_HUNTER);
}

bool BedSystem::supported(const AdventureBed& bed) const {
  int x = (int)bed.wx - E.fg.worldOffsetX, y = (int)bed.wy - E.fg.worldOffsetY;
  if (x < 6 || x >= E.cols - 6 || y < 8 || y >= E.rows - 5) return false;
  for (int dx : {-4, 0, 4}) if (!E.psys.playerCellSolid(x + dx, y + 4)) return false;
  return !E.creatures.boxHitsSolid(bed.wx - 2, bed.wy - 4, 4, 8);
}

void BedSystem::furnish(const Creature& resident) {
  if (std::any_of(beds.begin(), beds.end(), [&](const auto& bed) { return bed.resident == resident.id; })) return;
  const auto& species = E.creatures.species(resident);
  double homeX = resident.roamRadius ? resident.homeX + species.w * .5 : resident.wx + species.w * .5;
  double homeY = resident.wy + species.h;
  if (resident.npcId) for (const auto& home : E.content.residents) if (home.id == resident.npcId) {
    homeX = home.x + species.w * .5; homeY = home.y + E.content.surfaceOffset(home.surface) + species.h;
  }
  double best = 1e9;
  AdventureBed chosen;
  for (int dy = -20; dy <= 20; dy++) for (int dx = -28; dx <= 28; dx += 2) {
    AdventureBed bed;
    bed.wx = std::floor(homeX) + dx; bed.wy = std::floor(homeY) + dy - 4;
    if (!supported(bed) || E.creatures.boxHitsSolid(bed.wx - 5, bed.wy, 11, 4)) continue;
    int x = (int)bed.wx - E.fg.worldOffsetX, floor = (int)bed.wy - E.fg.worldOffsetY + 4;
    // A ceiling and a furnished background keep beds inside real rooms.
    bool roof = false;
    for (int above = 9; above <= 28 && floor - above >= 0; above++)
      if (E.psys.playerCellSolid(x, floor - above)) { roof = true; break; }
    if (!roof || E.bg.grid[(floor - 5) * E.cols + x] == EMPTY) continue;
    bool overlap = false;
    for (const auto& chest : E.containers.chests) if (!chest.packed
        && std::fabs(chest.wx - bed.wx) < 9 && std::fabs(chest.wy - bed.wy) < 5) overlap = true;
    for (const auto& other : beds)
      if (std::fabs(other.wx - bed.wx) < 12 && std::fabs(other.wy - bed.wy) < 5) overlap = true;
    if (overlap) continue;
    double score = dx * dx + dy * dy * 4;
    if (score < best) { best = score; chosen = bed; }
  }
  if (best == 1e9) return;
  chosen.id = chosen.resident = resident.id;
  beds.push_back(chosen);
}

void BedSystem::tick() {
  if (E.planetId != PL_FRONTIER) return;
  Engine::ActiveLayerScope scope(E, &E.fg);
  if (E.actorTick % 60 == 0)
    for (const auto& resident : E.creatures.creatures) if (eligible(resident)) furnish(resident);
  for (auto& bed : beds) {
    bed.seeking = false;
    bed.sleeper = 0;
    for (const auto& p : E.psys.players) if (p.active && p.alive && p.sleepingBed == bed.id) bed.sleeper = -p.id;
    int x = (int)bed.wx - E.fg.worldOffsetX, y = (int)bed.wy - E.fg.worldOffsetY;
    if (x < 6 || x >= E.cols - 6 || y < 8 || y >= E.rows - 5) continue;
    bool floor = false;
    for (int dx : {-4, 0, 4}) if (E.psys.playerCellSolid(x + dx, y + 4)) floor = true;
    if (!floor) { bed.wy += .25; bed.sleeper = 0; }
  }
  for (auto& p : E.psys.players) if (p.sleepingBed) {
    const auto* bed = find(p.sleepingBed);
    if (!p.alive || !bed || !supported(*bed)) { wake(p, BR_OBSTRUCTED); continue; }
    if (playerDanger(p, *bed)) { wake(p, BR_UNSAFE); continue; }
    if (p.input || std::fabs(p.inputX) > .1 || std::fabs(p.inputY) > .1) { wake(p); continue; }
    if (!E.worldClock.night()) { wake(p, BR_MORNING); continue; }
    if (++p.sleepTicks >= 120) {
      E.worldClock.set(7500.0 / WorldClockSystem::DAY_TICKS, false);
      wake(p, BR_MORNING);
    }
  }
}

bool BedSystem::danger(const Creature& resident) const {
  if (resident.hurtCooldown || resident.burnTicks || resident.attackState != CAS_IDLE) return true;
  const auto& species = E.creatures.species(resident);
  if (E.creatures.fluidCoverage(resident.wx, resident.wy, species.w, species.h) > .2) return true;
  if (E.creatures.contactHazardAtBox(resident.wx, resident.wy, species.w, species.h, E.actorTick) != CHP_NONE) return true;
  for (const auto& creature : E.creatures.creatures) {
    if (!creature.alive || !E.creatures.species(creature).hostile) continue;
    if (resident.targetKind == CT_PREY && resident.targetId == creature.id) return true;
    double dx = creature.wx - resident.wx, dy = creature.wy - resident.wy;
    if (dx * dx + dy * dy < 52 * 52 && std::fabs(dy) < 24) return true;
  }
  return false;
}

bool BedSystem::rest(Creature& resident) {
  if (!eligible(resident)) return false;
  auto it = std::find_if(beds.begin(), beds.end(), [&](const auto& bed) { return bed.resident == resident.id; });
  if (it == beds.end()) return false;
  auto& bed = *it;
  if (bed.sleeper < 0) return false;
  bed.sleeper = 0;
  if (danger(resident)) bed.wakeUntil = E.actorTick + 180;
  if (!E.worldClock.night() || E.actorTick < bed.wakeUntil || !supported(bed)) return false;
  bed.seeking = true;
  const auto& species = E.creatures.species(resident);
  double x = bed.wx - species.w * .5, y = bed.wy + 4 - species.h;
  if (std::fabs(resident.wx - x) > 1.1 || std::fabs(resident.wy - y) > 1.1
      || E.creatures.boxHitsSolid(x, y, species.w, species.h)) return false;
  resident.wx = x; resident.wy = y; resident.vx = resident.vy = 0;
  resident.grounded = true; resident.animFrame = 0;
  resident.targetKind = CT_NONE; resident.targetId = 0;
  resident.attackState = CAS_IDLE; resident.attackProgress = 0;
  bed.sleeper = resident.id;
  return true;
}

const AdventureBed* BedSystem::goal(int resident) const {
  for (const auto& bed : beds) if (bed.resident == resident && bed.seeking) return &bed;
  return nullptr;
}

int BedSystem::buildSnapshot() {
  snapshot.clear();
  for (const auto& bed : beds) {
    snapshot.insert(snapshot.end(), {(float)bed.id, (float)bed.wx, (float)bed.wy,
      (float)bed.resident, (float)bed.sleeper});
  }
  return (int)snapshot.size() / 5;
}

const AdventureBed* BedSystem::find(int id) const {
  for (const auto& bed : beds) if (bed.id == id) return &bed;
  return nullptr;
}

bool BedSystem::playerDanger(const Player& p, const AdventureBed& bed) const {
  if (p.hurtCooldown || E.psys.samplePlayerFluidCoverage(p) > .2) return true;
  if (E.creatures.fluidCoverage(bed.wx - 4, bed.wy - 2, 9, 5) > .2
      || E.creatures.contactHazardAtBox(bed.wx - 4, bed.wy - 2, 9, 5, 0) != CHP_NONE) return true;
  for (const auto& c : E.creatures.creatures) {
    if (!c.alive || !E.creatures.species(c).hostile) continue;
    double dx = c.wx - bed.wx, dy = c.wy - bed.wy;
    if (dx * dx + dy * dy < 52 * 52 && std::fabs(dy) < 24) return true;
  }
  return false;
}

void BedSystem::wake(Player& p, int result) {
  for (auto& bed : beds) if (bed.sleeper == -p.id) bed.sleeper = 0;
  p.sleepingBed = p.sleepTicks = 0;
  p.bedStatus = result; p.bedRevision++;
  p.vx = p.vy = 0; p.prevInput = p.input;
}

int BedSystem::use(int player, int id) {
  Player* p = E.psys.findPlayer(player);
  if (!p || !p->active || !p->alive || E.planetId != PL_FRONTIER) return BR_NONE;
  if (!id) { if (p->sleepingBed) wake(*p); return p->bedStatus; }
  auto result = [&](int value) { p->bedStatus = value; p->bedRevision++; return value; };
  const auto* bed = find(id);
  if (!bed) return result(BR_OBSTRUCTED);
  double wx = E.fg.worldOffsetX + p->px + p->w * .5, wy = E.fg.worldOffsetY + p->py + p->h * .5;
  if (std::hypot(wx - bed->wx, wy - bed->wy) > 18) return result(BR_TOO_FAR);
  if (!supported(*bed)) return result(BR_OBSTRUCTED);
  if (bed->sleeper && bed->sleeper != -p->id) return result(BR_OCCUPIED);
  // A player must be able to reach the pillow through open room space.
  int steps = imax(1, (int)std::ceil(std::hypot(wx - bed->wx, wy - bed->wy)));
  for (int i = 1; i < steps; i++) {
    double t = i / (double)steps;
    if (E.psys.playerCellSolid((int)std::floor(wx + (bed->wx - wx) * t) - E.fg.worldOffsetX,
                              (int)std::floor(wy + (bed->wy - wy) * t) - E.fg.worldOffsetY)) return result(BR_OBSTRUCTED);
  }
  p->respawnBed = bed->id;
  if (!E.worldClock.night()) return result(BR_DAYTIME);
  if (playerDanger(*p, *bed)) return result(BR_UNSAFE);
  p->sleepingBed = bed->id; p->sleepTicks = 0;
  p->px = bed->wx - p->w * .5 - E.fg.worldOffsetX;
  p->py = bed->wy + 4 - p->h - E.fg.worldOffsetY;
  p->vx = p->vy = 0; p->grounded = true;
  p->input = p->prevInput = 0; p->inputX = p->inputY = 0;
  p->shieldActive = false; p->actionTicks = 0; p->actionState = AS_IDLE;
  E.magic.cancelCharge(*p); E.psys.resetPlayerMine(*p); E.inv.resetPlayerPlaceStroke(*p);
  for (auto& b : beds) if (b.id == id) { b.sleeper = -p->id; b.seeking = false; }
  return result(BR_SLEEPING);
}

void BedSystem::respawnAnchor(Player& p, double* out) {
  const auto* bed = find(p.respawnBed);
  if (p.respawnBed && !bed) { p.respawnBed = 0; p.bedStatus = BR_SPAWN_LOST; p.bedRevision++; }
  out[0] = bed ? bed->wx - p.w * .5 : p.spawnWorldX;
  out[1] = bed ? bed->wy + 4 - p.h : p.spawnWorldY;
}
