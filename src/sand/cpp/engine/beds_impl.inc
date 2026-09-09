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
    int x = (int)bed.wx - E.fg.worldOffsetX, y = (int)bed.wy - E.fg.worldOffsetY;
    if (x < 6 || x >= E.cols - 6 || y < 8 || y >= E.rows - 5) continue;
    bool floor = false;
    for (int dx : {-4, 0, 4}) if (E.psys.playerCellSolid(x + dx, y + 4)) floor = true;
    if (!floor) { bed.wy += .25; bed.sleeper = 0; }
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
