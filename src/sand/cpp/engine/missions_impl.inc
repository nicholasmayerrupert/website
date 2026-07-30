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

void MissionSystem::carveRoom(int worldX, int worldY, int radius) {
  int localX = worldX - E.fg.worldOffsetX;
  int localY = worldY - E.fg.worldOffsetY;
  if (localX + radius <= 1 || localX - radius >= E.cols - 2 ||
      localY + radius <= 1 || localY - radius >= E.rows - 1) return;
  E.useLayer(&E.fg);
  E.eraseDisc(localX, localY, radius);
  E.useLayer(&E.fg);
}

void MissionSystem::authorFacilityRoom(int worldX, int worldY, int radius) {
  carveRoom(worldX, worldY, radius);
  int halfW = imax(8, radius * 7 / 10);
  int halfH = imax(6, radius / 2);
  uint8_t frameMaterial = missionId == MI_SILENT_QUARRY ? STONE : BRICK;

  int fgX = worldX - E.fg.worldOffsetX;
  int fgY = worldY - E.fg.worldOffsetY;
  std::unordered_set<int> foregroundFrame;
  foregroundFrame.reserve((halfW * 2 + halfH * 2) * 3);
  E.useLayer(&E.fg);
  auto addForeground = [&](int x, int y) {
    if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) return;
    int k = E.I(x, y);
    if (E.fg.bodyOwner[k] >= 0 || E.isComponentMaterial(E.fg.grid[k])) return;
    E.writeGridIndex(k, frameMaterial);
    foregroundFrame.insert(k);
  };
  for (int x = fgX - halfW; x <= fgX + halfW; x++) {
    addForeground(x, fgY - halfH);
    addForeground(x, fgY + halfH);
  }
  for (int y = fgY - halfH; y <= fgY + halfH; y++) {
    bool doorway = y >= fgY - 4 && y < fgY + halfH;
    if (!doorway) {
      addForeground(fgX - halfW, y);
      addForeground(fgX + halfW, y);
    }
  }
  E.tools.registerComponentCells(frameMaterial, foregroundFrame);

  int localX = worldX - E.bg.worldOffsetX;
  int localY = worldY - E.bg.worldOffsetY;
  if (localX + radius <= 1 || localX - radius >= E.cols - 2 ||
      localY + radius <= 1 || localY - radius >= E.rows - 1) return;
  E.useLayer(&E.bg);
  E.eraseDisc(localX, localY, radius);
  std::unordered_set<int> frame;
  frame.reserve((halfW * 2 + halfH * 2) * 2 + E.rows - localY);
  auto add = [&](int x, int y) {
    if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) return;
    int k = E.I(x, y);
    if (E.bg.bodyOwner[k] >= 0 || E.isComponentMaterial(E.bg.grid[k])) return;
    E.writeGridIndex(k, frameMaterial);
    frame.insert(k);
  };
  for (int x = localX - halfW; x <= localX + halfW; x++) {
    add(x, localY - halfH);
    add(x, localY + halfH);
  }
  for (int y = localY - halfH; y <= localY + halfH; y++) {
    add(localX - halfW, y);
    add(localX + halfW, y);
    add(localX - halfW / 2, y);
    add(localX + halfW / 2, y);
  }
  // The background support reaches the loaded floor, keeping the authored
  // frame grounded while retaining ordinary destructible component semantics.
  for (int y = localY + halfH; y < E.rows; y++) add(localX, y);
  E.tools.registerComponentCells(frameMaterial, frame);

  std::unordered_set<int> lights, glass, timber, machinery;
  auto decorate = [&](int x, int y, uint8_t material,
                      std::unordered_set<int>& cells) {
    if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) return;
    int k = E.I(x, y);
    if (E.bg.bodyOwner[k] >= 0 || E.isComponentMaterial(E.bg.grid[k])) return;
    E.writeGridIndex(k, material);
    cells.insert(k);
  };
  for (int x = localX - halfW + 3; x <= localX + halfW - 3; x += 7) {
    decorate(x, localY - halfH + 1, LIGHT, lights);
    decorate(x + 1, localY - halfH + 1, LIGHT, lights);
  }
  for (int x = localX - halfW + 4; x <= localX + halfW - 6; x += 10) {
    for (int y = localY - 3; y < localY + halfH; y++)
      decorate(x, y, GLASS, glass);
    for (int y = localY + halfH - 4; y < localY + halfH; y++)
      decorate(x + 4, y, IRON_ORE, machinery);
  }
  for (int x = localX - halfW + 2; x <= localX + halfW - 2; x++)
    decorate(x, localY + halfH - 1, PINE_WOOD, timber);
  E.tools.registerComponentCells(LIGHT, lights);
  E.tools.registerComponentCells(GLASS, glass);
  E.tools.registerComponentCells(PINE_WOOD, timber);
  E.tools.registerComponentCells(IRON_ORE, machinery);
  E.useLayer(&E.fg);
}

int MissionSystem::spawnMissionCreature(uint8_t species, int worldX, int worldY,
                                        int objectiveId, int offsetX) {
  const CreatureSpecies& policy = CREATURE_SPECIES[species];
  double wx = worldX + offsetX - policy.w * .5;
  double wy = worldY - policy.h * .5;
  int id = E.creatures.spawnCreature(species, wx, wy, false);
  if (!id) return 0;
  Creature* creature = findCreature(id);
  if (creature) {
    creature->missionObjective = objectiveId;
    creature->missionActor = true;
  }
  return id;
}

bool MissionSystem::start(int id, int ownerPlayerId) {
  if (id < MI_GREENFALL_RECOVERY || id > MI_RED_FURNACE ||
      missionId != MI_NONE || !E.findPlayer(ownerPlayerId)) return false;
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
  coreDestabilized = false;
  objectives.clear();
  objectives.reserve(4);
  E.creatureNaturalSpawning = false;

  Player* player = E.findPlayer(playerId);
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
  auto spawnResident = [&](uint8_t species, int worldX, int worldY) {
    const CreatureSpecies& resident = CREATURE_SPECIES[species];
    return E.creatures.spawnCreature(
      species, worldX - resident.w * .5, worldY - resident.h, false);
  };

  if (missionId == MI_GREENFALL_RECOVERY) {
    int crewX = centerX + side * 2 / 3, crewY = depth(.40);
    int rescueX = centerX - side * 2 / 3, rescueY = depth(.72);
    MissionObjective& clear = addObjective(
      OK_CLEAR, OS_ACTIVE, 3, crewX, crewY, MISSION_FLAG_PRIMARY_MARKER);
    MissionObjective& rescue = addObjective(
      OK_RESCUE, OS_LOCKED, 3, rescueX, rescueY, MISSION_FLAG_PRIMARY_MARKER);
    addObjective(OK_EXTRACT, OS_LOCKED, 1, extractionX, extractionY,
                 MISSION_FLAG_PRIMARY_MARKER | MISSION_FLAG_EXTRACTION);
    authorFacilityRoom(crewX, crewY, 20);
    authorFacilityRoom(rescueX, rescueY, 20);
    clear.targetActorId = spawnMissionCreature(
      CS_DYNAMITEER, crewX, crewY + 10, clear.id, -8);
    spawnMissionCreature(CS_CAUSTIC_MORTARMAN, crewX, crewY + 10, clear.id, 0);
    spawnMissionCreature(CS_DYNAMITEER, crewX, crewY + 10, clear.id, 8);
    rescue.targetActorId = 0;
  } else if (missionId == MI_SILENT_QUARRY) {
    int anchorY = depth(.48);
    MissionObjective& anchors = addObjective(
      OK_ANCHOR, OS_ACTIVE, 2, centerX - side, anchorY,
      MISSION_FLAG_PRIMARY_MARKER);
    MissionObjective& boss = addObjective(
      OK_BOSS, OS_LOCKED, 1, centerX, depth(.88),
      MISSION_FLAG_PRIMARY_MARKER);
    extractionX = centerX + side;
    extractionY = E.terrain.genSurfaceAbs(extractionX) - 5;
    addObjective(OK_EXTRACT, OS_LOCKED, 1, extractionX, extractionY,
                 MISSION_FLAG_PRIMARY_MARKER | MISSION_FLAG_EXTRACTION);
    authorFacilityRoom(centerX - side, anchorY, 17);
    authorFacilityRoom(centerX + side, depth(.68), 17);
    authorFacilityRoom(boss.worldX, boss.worldY, 24);
    spawnResident(CS_IRIS_ENGINEER, centerX - side + 8, anchorY + 8);
    spawnResident(CS_SURVEYOR, centerX + side - 8, depth(.68) + 8);
    anchors.targetActorId = spawnMissionCreature(
      CS_SHIELD_ANCHOR, centerX - side, anchorY, anchors.id);
    spawnMissionCreature(CS_SHIELD_ANCHOR, centerX + side, depth(.68), anchors.id);
  } else {
    int y0 = depth(.36), y1 = depth(.58), y2 = depth(.78);
    MissionObjective& anchors = addObjective(
      OK_ANCHOR, OS_ACTIVE, 3, centerX - side, y0,
      MISSION_FLAG_PRIMARY_MARKER);
    MissionObjective& boss = addObjective(
      OK_BOSS, OS_LOCKED, 1, centerX + side * 2 / 3, depth(.92),
      MISSION_FLAG_PRIMARY_MARKER);
    MissionObjective& core = addObjective(
      OK_CORE, OS_LOCKED, 1, centerX, depth(.96),
      MISSION_FLAG_PRIMARY_MARKER);
    extractionX = centerX - side;
    extractionY = E.terrain.genSurfaceAbs(extractionX) - 6;
    addObjective(OK_EXTRACT, OS_LOCKED, 1, extractionX, extractionY,
                 MISSION_FLAG_PRIMARY_MARKER | MISSION_FLAG_EXTRACTION);
    authorFacilityRoom(centerX - side, y0, 17);
    authorFacilityRoom(centerX, y1, 17);
    authorFacilityRoom(centerX + side, y2, 17);
    authorFacilityRoom(boss.worldX, boss.worldY, 25);
    authorFacilityRoom(core.worldX, core.worldY, 22);
    spawnResident(CS_IRIS_ENGINEER, centerX - side + 8, y0 + 8);
    spawnResident(CS_SURVEYOR, centerX + side - 8, y2 + 8);
    anchors.targetActorId = spawnMissionCreature(
      CS_SHIELD_ANCHOR, centerX - side, y0, anchors.id);
    spawnMissionCreature(CS_SHIELD_ANCHOR, centerX, y1, anchors.id);
    spawnMissionCreature(CS_SHIELD_ANCHOR, centerX + side, y2, anchors.id);
    core.targetActorId = 0;
  }

  InvSlot rescueBeam;
  rescueBeam.itemKind = IK_RESCUE_BEAM;
  rescueBeam.count = 1;
  E.inv.addStack(*player, rescueBeam);
  return true;
}

void MissionSystem::activateObjective(int objectiveId) {
  MissionObjective* objective = findObjective(objectiveId);
  if (!objective || objective->state != OS_LOCKED) return;
  objective->state = OS_ACTIVE;
  revision++;
  if (objective->type == OK_RESCUE) {
    objective->targetActorId = spawnMissionCreature(
      CS_SURVEYOR, objective->worldX, objective->worldY + 10,
      objective->id, -8);
    spawnMissionCreature(CS_SURVEYOR, objective->worldX,
                         objective->worldY + 10, objective->id, 0);
    spawnMissionCreature(CS_SURVEYOR, objective->worldX,
                         objective->worldY + 10, objective->id, 8);
  } else if (objective->type == OK_BOSS) {
    uint8_t species = missionId == MI_SILENT_QUARRY
      ? CS_QUARRY_FOREMAN : CS_REACTOR_WARDEN;
    objective->targetActorId = spawnMissionCreature(
      species, objective->worldX, objective->worldY + 10, objective->id);
  } else if (objective->type == OK_CORE) {
    objective->targetActorId = spawnMissionCreature(
      CS_REACTOR_CORE, objective->worldX, objective->worldY,
      objective->id);
  }
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
  if (!active() || creature.species != CS_SURVEYOR || !creature.alive)
    return false;
  MissionObjective* objective = findObjective(creature.missionObjective);
  if (!objective || objective->state != OS_ACTIVE ||
      objective->type != OK_RESCUE) return false;
  creature.health = 0;
  creature.alive = false;
  creature.deathTicks = 0;
  objective->current = imin(objective->required, objective->current + 1);
  if (objective->current >= objective->required) completeObjective(*objective);
  else {
    refreshObjectiveMarker(*objective);
    revision++;
  }
  E.audio.emit(SE_PICKUP,
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
  revision++;
  if (missionId == MI_RED_FURNACE && !coreDestabilized) {
    coreDestabilized = true;
    int localX = objectives[2].worldX - E.fg.worldOffsetX;
    int localY = objectives[2].worldY - E.fg.worldOffsetY;
    E.useLayer(&E.fg);
    E.detonate(localX, localY, 28, 25.0, playerId, TNT,
               (uint32_t)(E.actorTick ^ 0x52454446u));
    E.useLayer(&E.fg);
  }
}

void MissionSystem::collectRecoveredWeapons() {
  recoveredWeaponMask = 0;
  Player* player = E.findPlayer(playerId);
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
  int cadence = missionId == MI_RED_FURNACE ? 150
              : missionId == MI_SILENT_QUARRY ? 210 : 260;
  if (((E.actorTick - startActorTick) % cadence) != 0) return;
  uint8_t species = missionId == MI_RED_FURNACE
    ? ((E.actorTick / cadence) & 1 ? CS_MINIGUNNER : CS_CLUSTER_WASP)
    : missionId == MI_SILENT_QUARRY ? CS_DYNAMITEER : CS_CRAWLER;
  E.creatures.spawnNearFocus(species,
    (uint32_t)E.actorTick ^ ((uint32_t)missionId * 0x9e3779b9u));
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
  Player* player = E.findPlayer(playerId);
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
  if (dx * dx + dy * dy > 8.0 * 8.0) return;
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
  missionSnapshot[MS_REVISION] = revision;
  missionSnapshot[MS_MISSION_ID] = missionId;
  missionSnapshot[MS_PLANET_ID] = planetId;
  missionSnapshot[MS_PHASE] = phase;
  missionSnapshot[MS_OBJECTIVE_COUNT] = (int)objectives.size();
  missionSnapshot[MS_THREAT_LEVEL] = threatLevel;
  missionSnapshot[MS_EXTRACTION_X] = extractionX;
  missionSnapshot[MS_EXTRACTION_Y] = extractionY;
  missionSnapshot[MS_ELAPSED_TICKS] = elapsedTicks;
  missionSnapshot[MS_RECOVERED_WEAPON_MASK] = recoveredWeaponMask;
  return 1;
}

int MissionSystem::buildObjectiveSnapshot() {
  objectiveSnapshot.assign(objectives.size() * OS_STRIDE, 0);
  for (size_t i = 0; i < objectives.size(); i++) {
    const MissionObjective& objective = objectives[i];
    int32_t* out = objectiveSnapshot.data() + i * OS_STRIDE;
    out[OS_ID] = objective.id;
    out[OS_TYPE] = objective.type;
    out[OS_STATE] = objective.state;
    out[OS_CURRENT] = objective.current;
    out[OS_REQUIRED] = objective.required;
    out[OS_WORLD_X] = objective.worldX;
    out[OS_WORLD_Y] = objective.worldY;
    out[OS_TARGET_ACTOR_ID] = objective.targetActorId;
    out[OS_FLAGS] = objective.flags;
  }
  return (int)objectives.size();
}
