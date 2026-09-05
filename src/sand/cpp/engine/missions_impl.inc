#include "mission_greenfall.inc"

MissionObjective& MissionSystem::addObjective(uint8_t type, uint8_t state,
                                               int required, int worldX,
                                               int worldY, int flags) {
  MissionObjective objective;
  objective.id = (int)objectives.size();
  objective.type = type;
  objective.state = state;
  objective.required = imax(1, required);
  objective.worldX = worldX;
  objective.worldY = worldY;
  objective.flags = flags;
  objectives.push_back(objective);
  return objectives.back();
}

MissionObjective* MissionSystem::findObjective(int objectiveId) {
  if (objectiveId < 0 || objectiveId >= (int)objectives.size()) return nullptr;
  return &objectives[objectiveId];
}

Creature* MissionSystem::findCreature(int actorId) {
  if (!actorId) return nullptr;
  for (Creature& creature : E.creatures.creatures)
    if (creature.id == actorId) return &creature;
  for (auto& entry : E.creatures.dormantRegions)
    for (Creature& creature : entry.second)
      if (creature.id == actorId) return &creature;
  return nullptr;
}

bool MissionSystem::safeMissionSpawnAt(uint8_t species, int localX,
                                       int localY) const {
  static constexpr int HAZARD_MARGIN = 4;
  const CreatureSpecies& policy = CREATURE_SPECIES[species];
  int x0 = localX, x1 = localX + policy.w - 1;
  int y0 = localY, y1 = localY + policy.h - 1;
  if (x0 - HAZARD_MARGIN < 1 || x1 + HAZARD_MARGIN >= E.cols - 1 ||
      y0 - HAZARD_MARGIN < 1 || y1 + HAZARD_MARGIN + 1 >= E.rows - 1)
    return false;
  auto dangerous = [&](uint8_t material) {
    return E.isSpawnHazard(material);
  };
  for (int y = y0 - HAZARD_MARGIN; y <= y1 + HAZARD_MARGIN; y++)
    for (int x = x0 - HAZARD_MARGIN; x <= x1 + HAZARD_MARGIN; x++)
      if (dangerous(E.fg.grid[E.I(x, y)])) return false;
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) {
    uint8_t material = E.fg.grid[E.I(x, y)];
    if (E.isBlockingForActor(material) || E.isLiquidMaterial(material))
      return false;
  }
  int support = 0;
  for (int x = x0; x <= x1; x++) {
    int k = E.I(x, y1 + 1);
    uint8_t material = E.fg.grid[k];
    if (E.isBlockingForActor(material) && !dangerous(material) &&
        E.fg.bodyOwner[k] < 0 && E.fg.groundedCell[k])
      support++;
  }
  if (support < imax(2, (policy.w + 1) / 2)) return false;

  double worldX = E.fg.worldOffsetX + localX;
  double worldY = E.fg.worldOffsetY + localY;
  for (const Creature& creature : E.creatures.creatures) {
    if (!creature.alive) continue;
    const CreatureSpecies& other = E.creatures.species(creature);
    if (worldX < creature.wx + other.w && worldX + policy.w > creature.wx &&
        worldY < creature.wy + other.h && worldY + policy.h > creature.wy)
      return false;
  }
  for (const Player& player : E.psys.players) {
    if (!player.active || !player.alive) continue;
    if (localX < player.px + player.w && localX + policy.w > player.px &&
        localY < player.py + player.h && localY + policy.h > player.py)
      return false;
  }
  return true;
}

bool MissionSystem::findSafeMissionSpawn(uint8_t species, int worldX,
                                         int worldY, double& spawnWorldX,
                                         double& spawnWorldY) const {
  const CreatureSpecies& policy = CREATURE_SPECIES[species];
  int baseX = (int)std::lround(worldX - E.fg.worldOffsetX - policy.w * .5);
  int baseY = (int)std::lround(worldY - E.fg.worldOffsetY - policy.h);
  int bestDistance2 = INT_MAX, bestX = 0, bestY = 0;
  auto consider = [&](int x, int y) {
    int dx = x - baseX, dy = y - baseY;
    int distance2 = dx * dx + dy * dy;
    if (distance2 >= bestDistance2 || !safeMissionSpawnAt(species, x, y))
      return;
    bestDistance2 = distance2;
    bestX = x;
    bestY = y;
  };
  const int NEAR_X = missionId == MI_GREENFALL_RECOVERY ? 6 : 96;
  const int NEAR_Y = missionId == MI_GREENFALL_RECOVERY ? 8 : 72;
  for (int ax = 0; ax <= NEAR_X; ax++) {
    for (int xs = 0; xs < (ax == 0 ? 1 : 2); xs++) {
      int x = baseX + (ax == 0 ? 0 : (xs == 0 ? -ax : ax));
      for (int ay = 0; ay <= NEAR_Y; ay++) {
        int distance2 = ax * ax + ay * ay;
        if (distance2 >= bestDistance2) continue;
        for (int ys = 0; ys < (ay == 0 ? 1 : 2); ys++)
          consider(x, baseY + (ay == 0 ? 0 : (ys == 0 ? -ay : ay)));
      }
    }
  }
  if (bestDistance2 == INT_MAX && missionId != MI_GREENFALL_RECOVERY) {
    for (int y = 5; y + policy.h + 5 < E.rows; y++)
      for (int x = 5; x + policy.w + 5 < E.cols; x++)
        consider(x, y);
  }
  if (bestDistance2 == INT_MAX) return false;
  spawnWorldX = E.fg.worldOffsetX + bestX;
  spawnWorldY = E.fg.worldOffsetY + bestY;
  return true;
}

int MissionSystem::spawnMissionCreature(uint8_t species, int worldX, int worldY,
                                        int objectiveId, int offsetX) {
  double wx = 0, wy = 0;
  if (!findSafeMissionSpawn(species, worldX + offsetX, worldY, wx, wy))
    return 0;
  int id = E.creatures.spawnCreature(species, wx, wy, false);
  if (!id) return 0;
  Creature* creature = findCreature(id);
  if (creature) {
    creature->missionObjective = objectiveId;
    creature->missionActor = true;
  }
  return id;
}

int MissionSystem::spawnMissionResident(uint8_t species, int worldX,
                                        int worldY) {
  double wx = 0, wy = 0;
  if (!findSafeMissionSpawn(species, worldX, worldY, wx, wy)) return 0;
  return E.creatures.spawnCreature(species, wx, wy, false);
}

bool MissionSystem::start(int id, int ownerPlayerId) {
  if (id < MI_GREENFALL_RECOVERY || id > MI_RED_FURNACE ||
      missionId != MI_NONE || !E.psys.findPlayer(ownerPlayerId)) return false;
  uint8_t expectedPlanet = id == MI_SILENT_QUARRY ? PL_MOON
                         : id == MI_RED_FURNACE ? PL_MARS : PL_EARTH;
  if (E.planetId != expectedPlanet) return false;
  missionId = (uint8_t)id;
  planetId = expectedPlanet;
  phase = MP_ACTIVE;
  playerId = ownerPlayerId;
  revision = 1;
  threatLevel = 0;
  startActorTick = E.actorTick;
  elapsedTicks = 0;
  recoveredWeaponMask = 0;
  pendingObjective = -1;
  nextThreatActorTick = 0;
  extractionThreatWave = 0;
  extractionTicks = 0;
  coreDestabilized = false;
  objectives.clear();
  objectives.reserve(4);
  E.creatureNaturalSpawning = false;
  Engine::ActiveLayerScope active(E, &E.fg);
  E.comps.ensureGroundedSingleLayer();

  Player* player = E.psys.findPlayer(playerId);
  int centerX = (int)std::lround(player->spawnWorldX);
  int surfaceY = E.terrain.genSurfaceAbs(centerX);
  int surfaceLocalY = surfaceY - E.fg.worldOffsetY;
  int availableDepth = imax(80, E.rows - surfaceLocalY - 30);
  int maxDepth = imin(220, availableDepth);
  int side = imax(42, imin(110, E.cols / 2 - 38));
  extractionX = centerX;
  extractionY = surfaceY - 7;

  auto depth = [&](double fraction) {
    return surfaceY + imax(32, (int)std::lround(maxDepth * fraction));
  };

  if (missionId == MI_GREENFALL_RECOVERY) {
    buildGreenfall(centerX, surfaceY);
    if (phase == MP_FAILED) return false;
  } else if (missionId == MI_SILENT_QUARRY) {
    int anchorY = depth(.48);
    MissionObjective& anchors = addObjective(
      OK_ANCHOR, OS_ACTIVE, 2, centerX - side, anchorY,
      MISSION_FLAG_PRIMARY_MARKER);
    addObjective(
      OK_BOSS, OS_LOCKED, 1, centerX, depth(.88),
      MISSION_FLAG_PRIMARY_MARKER);
    extractionX = centerX + side;
    extractionY = E.terrain.genSurfaceAbs(extractionX) - 5;
    addObjective(OK_EXTRACT, OS_LOCKED, 1, extractionX, extractionY,
                 MISSION_FLAG_PRIMARY_MARKER | MISSION_FLAG_EXTRACTION);
    spawnMissionResident(CS_IRIS_ENGINEER, centerX - side + 8, anchorY);
    spawnMissionResident(CS_SURVEYOR, centerX + side - 8, depth(.68));
    anchors.targetActorId = spawnMissionCreature(
      CS_SHIELD_ANCHOR, centerX - side, anchorY, anchors.id);
    spawnMissionCreature(CS_SHIELD_ANCHOR, centerX + side, depth(.68), anchors.id);
    refreshObjectiveMarker(anchors);
  } else {
    int y0 = depth(.36), y1 = depth(.58), y2 = depth(.78);
    MissionObjective& anchors = addObjective(
      OK_ANCHOR, OS_ACTIVE, 3, centerX - side, y0,
      MISSION_FLAG_PRIMARY_MARKER);
    addObjective(
      OK_BOSS, OS_LOCKED, 1, centerX + side * 2 / 3, depth(.92),
      MISSION_FLAG_PRIMARY_MARKER);
    MissionObjective& core = addObjective(
      OK_CORE, OS_LOCKED, 1, centerX, depth(.96),
      MISSION_FLAG_PRIMARY_MARKER);
    extractionX = centerX - side;
    extractionY = E.terrain.genSurfaceAbs(extractionX) - 6;
    addObjective(OK_EXTRACT, OS_LOCKED, 1, extractionX, extractionY,
                 MISSION_FLAG_PRIMARY_MARKER | MISSION_FLAG_EXTRACTION);
    spawnMissionResident(CS_IRIS_ENGINEER, centerX - side + 8, y0);
    spawnMissionResident(CS_SURVEYOR, centerX + side - 8, y2);
    anchors.targetActorId = spawnMissionCreature(
      CS_SHIELD_ANCHOR, centerX - side, y0, anchors.id);
    spawnMissionCreature(CS_SHIELD_ANCHOR, centerX, y1, anchors.id);
    spawnMissionCreature(CS_SHIELD_ANCHOR, centerX + side, y2, anchors.id);
    refreshObjectiveMarker(anchors);
    core.targetActorId = 0;
  }

  InvSlot rescueBeam;
  rescueBeam.itemKind = IK_RESCUE_BEAM;
  rescueBeam.count = 1;
  E.inv.addStack(*player, rescueBeam);
  if (missionId == MI_GREENFALL_RECOVERY) {
    for (int slot = 0; slot < INV_SLOTS; slot++)
      if (player->inv[slot].itemKind == IK_RESCUE_BEAM) {
        std::swap(player->inv[2], player->inv[slot]);
        break;
      }
  }
  return true;
}

void MissionSystem::activateObjective(int objectiveId) {
  MissionObjective* objective = findObjective(objectiveId);
  if (!objective || objective->state != OS_LOCKED) return;
  Engine::ActiveLayerScope active(E, &E.fg);
  E.comps.ensureGroundedSingleLayer();
  objective->state = OS_ACTIVE;
  revision++;
  if (objective->type == OK_RESCUE) {
    if (missionId == MI_GREENFALL_RECOVERY) {
      if (Player* player = E.psys.findPlayer(playerId))
        for (int slot = 0; slot < INV_SLOTS; slot++)
          if (player->inv[slot].itemKind == IK_RESCUE_BEAM) {
            E.inv.setSelectedSlot(*player, slot);
            break;
          }
    }
    if (missionId != MI_GREENFALL_RECOVERY) {
      objective->targetActorId = spawnMissionCreature(
        CS_SURVEYOR, objective->worldX, objective->worldY,
        objective->id, -8);
      spawnMissionCreature(CS_SURVEYOR, objective->worldX,
                           objective->worldY, objective->id, 0);
      spawnMissionCreature(CS_SURVEYOR, objective->worldX,
                           objective->worldY, objective->id, 8);
    }
  } else if (objective->type == OK_ANCHOR) {
    objective->targetActorId = spawnMissionCreature(
      CS_SHIELD_ANCHOR, objective->worldX, objective->worldY, objective->id);
  } else if (objective->type == OK_BOSS) {
    uint8_t species = missionId == MI_SILENT_QUARRY
      ? CS_QUARRY_FOREMAN : CS_REACTOR_WARDEN;
    objective->targetActorId = spawnMissionCreature(
      species, objective->worldX, objective->worldY, objective->id);
  } else if (objective->type == OK_CORE) {
    objective->targetActorId = spawnMissionCreature(
      CS_REACTOR_CORE, objective->worldX, objective->worldY,
      objective->id);
  }
  refreshObjectiveMarker(*objective);
}

void MissionSystem::refreshObjectiveMarker(MissionObjective& objective) {
  Creature* current = findCreature(objective.targetActorId);
  if (current && current->alive) {
    const CreatureSpecies& species = E.creatures.species(*current);
    objective.worldX = (int)std::lround(current->wx + species.w * .5);
    objective.worldY = (int)std::lround(current->wy + species.h * .5);
    return;
  }
  objective.targetActorId = 0;
  for (Creature& creature : E.creatures.creatures) {
    if (!creature.alive || creature.missionObjective != objective.id) continue;
    const CreatureSpecies& species = E.creatures.species(creature);
    objective.targetActorId = creature.id;
    objective.worldX = (int)std::lround(creature.wx + species.w * .5);
    objective.worldY = (int)std::lround(creature.wy + species.h * .5);
    return;
  }
  for (auto& entry : E.creatures.dormantRegions) for (Creature& creature : entry.second) {
    if (!creature.alive || creature.missionObjective != objective.id) continue;
    const CreatureSpecies& species = E.creatures.species(creature);
    objective.targetActorId = creature.id;
    objective.worldX = (int)std::lround(creature.wx + species.w * .5);
    objective.worldY = (int)std::lround(creature.wy + species.h * .5);
    return;
  }
}

void MissionSystem::completeObjective(MissionObjective& objective) {
  if (objective.state != OS_ACTIVE) return;
  objective.current = objective.required;
  objective.state = OS_COMPLETE;
  objective.targetActorId = 0;
  revision++;
  if (objective.type == OK_EXTRACT) return;
  int next = objective.id + 1;
  MissionObjective* nextObjective = findObjective(next);
  if (!nextObjective) {
    beginExtraction();
    return;
  }
  pendingObjective = next;
  if (missionId == MI_GREENFALL_RECOVERY) {
    if (Player* player = E.psys.findPlayer(playerId))
      player->health = imin(100, player->health + 30);
  }
}

void MissionSystem::onCreatureKilled(Creature& creature) {
  if (!active() || !creature.missionActor) return;
  MissionObjective* objective = findObjective(creature.missionObjective);
  if (!objective || objective->state != OS_ACTIVE) return;
  if (creature.species == CS_SURVEYOR) {
    fail();
    return;
  }
  objective->current = imin(objective->required, objective->current + 1);
  if (objective->current >= objective->required) completeObjective(*objective);
  else {
    refreshObjectiveMarker(*objective);
    revision++;
  }
}

bool MissionSystem::rescueCreature(Creature& creature) {
  if (!active() || creature.species != CS_SURVEYOR || !creature.alive ||
      creature.shelterCharge > 0)
    return false;
  MissionObjective* objective = findObjective(creature.missionObjective);
  if (!objective || objective->state != OS_ACTIVE ||
      objective->type != OK_RESCUE) return false;
  if (creature.rescueLastTick == E.actorTick) return true;
  creature.rescueLastTick = E.actorTick;
  creature.rescueProgress = std::min(1.0, creature.rescueProgress + 1.0 / 60.0);
  if (creature.rescueProgress < 1.0 - 1e-6) return true;
  creature.rescueProgress = 1;
  creature.alive = false;
  creature.deathTicks = 30;
  objective->current = imin(objective->required, objective->current + 1);
  if (objective->current >= objective->required) completeObjective(*objective);
  else {
    refreshObjectiveMarker(*objective);
    revision++;
  }
  E.audio.emit(SE_BEAM,
               creature.wx - E.fg.worldOffsetX +
                 CREATURE_SPECIES[creature.species].w * .5,
               creature.wy - E.fg.worldOffsetY +
                 CREATURE_SPECIES[creature.species].h * .5,
               1.0, EMPTY, 0);
  return true;
}

void MissionSystem::beginExtraction() {
  MissionObjective* extraction = nullptr;
  for (MissionObjective& objective : objectives)
    if (objective.type == OK_EXTRACT) extraction = &objective;
  if (!extraction) return;
  extraction->state = OS_ACTIVE;
  extraction->worldX = extractionX;
  extraction->worldY = extractionY;
  phase = MP_EXTRACTION;
  threatLevel = missionId == MI_RED_FURNACE ? 3
              : missionId == MI_SILENT_QUARRY ? 2 : 1;
  nextThreatActorTick = E.actorTick;
  extractionThreatWave = 0;
  extractionTicks = 0;
  revision++;
  if (missionId == MI_RED_FURNACE && !coreDestabilized) {
    coreDestabilized = true;
    int localX = objectives[2].worldX - E.fg.worldOffsetX;
    int localY = objectives[2].worldY - E.fg.worldOffsetY;
    Engine::ActiveLayerScope active(E, &E.fg);
    E.explosives.detonate(localX, localY, 28, 25.0, playerId, TNT,
               (uint32_t)(E.actorTick ^ 0x52454446u));
  }
}

void MissionSystem::collectRecoveredWeapons() {
  recoveredWeaponMask = 0;
  Player* player = E.psys.findPlayer(playerId);
  if (!player) return;
  auto collect = [&](const InvSlot& slot) {
    if (slot.count <= 0 || slot.itemKind < IK_DYNAMITE_SATCHEL ||
        slot.itemKind > IK_MINIGUN) return;
    recoveredWeaponMask |= 1 << (slot.itemKind - IK_DYNAMITE_SATCHEL);
  };
  for (const InvSlot& slot : player->inv) collect(slot);
  collect(player->cursor);
}

void MissionSystem::fail() {
  if (!active()) return;
  phase = MP_FAILED;
  elapsedTicks = imax(0, E.actorTick - startActorTick);
  for (MissionObjective& objective : objectives)
    if (objective.state == OS_ACTIVE) objective.state = OS_FAILED;
  revision++;
}

void MissionSystem::updateThreat() {
  if (phase != MP_EXTRACTION) return;
  if (missionId == MI_GREENFALL_RECOVERY && extractionThreatWave >= 3) return;
  if (E.actorTick < nextThreatActorTick) return;
  int cadence = missionId == MI_RED_FURNACE ? 150
              : missionId == MI_SILENT_QUARRY ? 210 : 600;
  static const uint8_t GREENFALL_ROSTER[] = {
    CS_CRAWLER, CS_DYNAMITEER, CS_CRAWLER, CS_CLUSTER_WASP
  };
  static const uint8_t QUARRY_ROSTER[] = {
    CS_BORE_SENTINEL, CS_MINIGUNNER, CS_DYNAMITEER, CS_CLUSTER_WASP
  };
  static const uint8_t FURNACE_ROSTER[] = {
    CS_MINIGUNNER, CS_BORE_SENTINEL, CS_CLUSTER_WASP,
    CS_CAUSTIC_MORTARMAN, CS_DYNAMITEER
  };
  const uint8_t* roster = missionId == MI_RED_FURNACE ? FURNACE_ROSTER
                        : missionId == MI_SILENT_QUARRY ? QUARRY_ROSTER
                        : GREENFALL_ROSTER;
  int rosterCount = missionId == MI_RED_FURNACE ? 5 : 4;
  int start = extractionThreatWave % rosterCount;
  for (int offset = 0; offset < rosterCount; offset++) {
    uint8_t species = roster[(start + offset) % rosterCount];
    uint32_t salt = (uint32_t)E.actorTick ^
      ((uint32_t)missionId * 0x9e3779b9u) ^
      ((uint32_t)extractionThreatWave * 2246822519u) ^
      ((uint32_t)species * 3266489917u);
    if (!E.creatures.spawnVisibleBreachNearFocus(species, salt)) continue;
    extractionThreatWave++;
    nextThreatActorTick = E.actorTick + cadence;
    return;
  }
  nextThreatActorTick = E.actorTick + 20;
}

void MissionSystem::update() {
  if (!active()) return;
  if (pendingObjective >= 0) {
    int next = pendingObjective;
    pendingObjective = -1;
    MissionObjective* objective = findObjective(next);
    if (objective && objective->type == OK_EXTRACT) beginExtraction();
    else activateObjective(next);
  }
  Player* player = E.psys.findPlayer(playerId);
  if (!player || !player->alive) {
    fail();
    return;
  }
  elapsedTicks = imax(0, E.actorTick - startActorTick);
  for (MissionObjective& objective : objectives)
    if (objective.state == OS_ACTIVE && objective.targetActorId)
      refreshObjectiveMarker(objective);
  updateThreat();
  if (phase != MP_EXTRACTION) return;
  double worldX = E.fg.worldOffsetX + player->px + player->w * .5;
  double worldY = E.fg.worldOffsetY + player->py + player->h * .5;
  double dx = worldX - extractionX, dy = worldY - extractionY;
  bool atBeacon = dx * dx + dy * dy <=
    (missionId == MI_GREENFALL_RECOVERY ? 14.0 * 14.0 : 8.0 * 8.0);
  if (missionId == MI_GREENFALL_RECOVERY) {
    extractionTicks = atBeacon ? extractionTicks + 1 : 0;
    // A single replicated cosmetic latch keeps the pad visible throughout escape.
    Projectile* effect = nullptr;
    for (Projectile& p : E.projectiles.projectiles)
      if (p.kind == PK_EXTRACTION_BEAM) { effect = &p; break; }
    if (!effect && (int)E.projectiles.projectiles.size() < PROJECTILE_MAX) {
      Projectile beam;
      beam.id = E.projectiles.nextId++;
      beam.kind = PK_EXTRACTION_BEAM;
      E.projectiles.projectiles.push_back(beam);
      effect = &E.projectiles.projectiles.back();
    }
    if (effect) {
      effect->px = extractionX - E.fg.worldOffsetX;
      effect->py = extractionY - E.fg.worldOffsetY + 6;
      effect->charge = std::min(1.0, extractionTicks / 120.0);
      effect->life = effect->fuse = 3;
    }
    if (extractionTicks < 120) return;
  } else if (!atBeacon) return;
  for (MissionObjective& objective : objectives)
    if (objective.type == OK_EXTRACT) completeObjective(objective);
  collectRecoveredWeapons();
  phase = MP_COMPLETE;
  revision++;
}

int MissionSystem::buildMissionSnapshot() {
  if (missionId == MI_NONE) {
    missionSnapshot.clear();
    return 0;
  }
  missionSnapshot.assign(MS_STRIDE, 0);
  writeMissionSnapshot(missionSnapshot.data(), *this, {
    .objectiveCount = WriteMissionSnapshotObjectiveCount{
      (int)objectives.size()},
  });
  return 1;
}

int MissionSystem::buildObjectiveSnapshot() {
  objectiveSnapshot.assign(objectives.size() * OS_STRIDE, 0);
  for (size_t i = 0; i < objectives.size(); i++) {
    const MissionObjective& objective = objectives[i];
    int32_t* out = objectiveSnapshot.data() + i * OS_STRIDE;
    writeObjectiveSnapshot(out, objective);
  }
  return (int)objectives.size();
}
