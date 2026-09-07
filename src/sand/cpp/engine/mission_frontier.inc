// Authored jobs and residents use absolute anchors and authoritative world state.
void MissionSystem::updateFrontierResidents() {
  for (size_t i = 0; i < E.content.residents.size(); i++) {
    if (residentIds[i]) {
      auto* actor = findCreature(residentIds[i]);
      const auto& home = E.content.residents[i];
      double homeY = home.y + E.content.surfaceOffset(home.surface);
      if (actor && E.creatures.boxInsideLoadedWindow(home.x, homeY, 8, 12, 12) &&
          (!actor->alive || std::fabs(actor->wy - homeY) > 72 || E.creatures.blockingCoverage(actor->wx,actor->wy,CREATURE_SPECIES[actor->species].w,CREATURE_SPECIES[actor->species].h) > .5)) {
        double safe[2];
        if (E.psys.findSafeSpawnNearWorld(home.x, homeY, safe, nullptr) || E.psys.buildSafeSpawnPad(home.x, homeY, safe, nullptr)) {
          actor->wx = safe[0] + E.fg.worldOffsetX; actor->wy = safe[1] + E.fg.worldOffsetY;
          actor->vx = actor->vy = 0; actor->alive = true; actor->health = CREATURE_SPECIES[actor->species].maxHealth;
          bool dormant = std::none_of(E.creatures.creatures.begin(),E.creatures.creatures.end(),[&](const auto& c){return c.id==residentIds[i];});
          if (dormant) {
            E.creatures.creatures.push_back(*actor);
            for (auto& [region, actors] : E.creatures.dormantRegions)
              actors.erase(std::remove_if(actors.begin(),actors.end(),[&](const auto& c){return c.id==residentIds[i];}),actors.end());
          }
        }
      }
      continue;
    }
    const auto& resident = E.content.residents[i];
    double x = resident.x, y = resident.y + E.content.surfaceOffset(resident.surface);
    const auto& species = CREATURE_SPECIES[resident.species];
    if (!E.creatures.boxInsideLoadedWindow(x, y, species.w, species.h, 8)) continue;
    if (!E.creatures.findGroundSpawn(resident.species, x, y, x, y)) continue;
    int id = E.creatures.spawnCreature(resident.species, x, y, false);
    if (!id) continue;
    residentIds[i] = id;
    Creature* actor = findCreature(id);
    actor->npcId = resident.id;
    actor->homeX = x; actor->roamRadius = resident.roamRadius;
  }
}

bool MissionSystem::rewardFrontier(MissionObjective& objective, Player& player) {
  const auto& quest = E.content.quests[(size_t)objective.id];
  Player before = player;
  if (quest.type == OK_DELIVER) {
    if (!E.inv.consumeMaterial(player, quest.material, quest.count)) return false;
  }
  bool rewarded = true;
  if (quest.rewardKind == 1) rewarded = E.inv.addToInventory(playerId, (uint8_t)quest.rewardId, quest.rewardCount);
  if (quest.rewardKind == 2) rewarded = E.inv.addSpecialItem(playerId, (uint8_t)quest.rewardId, quest.rewardCount);
  if (quest.rewardKind == 3) {
    if (quest.rewardId == 340 || quest.rewardId == 341) player.abilities |= 1 << (quest.rewardId - 340);
    else rewarded = E.inv.addGear(playerId, quest.rewardId, imax(1, quest.rewardCount));
  }
  if (rewarded && objective.id == 3) rewarded = E.inv.addGear(playerId, 342, 1);
  if (!rewarded) { player = before; return false; }
  if (objective.id == 7) E.audio.emit(SE_BELL,player.px,player.py,1.8,EMPTY);
  objective.state = OS_COMPLETE; objective.current = objective.required; revision++;
  return true;
}

bool MissionSystem::interactFrontier(int ownerPlayerId, int objectiveId) {
  if (missionId != MI_FRONTIER || (phase != MP_ACTIVE && phase != MP_COMPLETE) || ownerPlayerId != playerId) return false;
  auto* objective = findObjective(objectiveId);
  auto* player = E.psys.findPlayer(playerId);
  if (!objective || !player || !player->alive || objective->state != OS_ACTIVE) return false;
  const auto& quest = E.content.quests[(size_t)objectiveId];
  double targetX = objective->worldX, targetY = objective->worldY;
  if (quest.giver) {
    auto npc = std::find_if(E.creatures.creatures.begin(), E.creatures.creatures.end(), [&](const auto& c) { return c.alive && c.npcId == quest.giver; });
    if (npc == E.creatures.creatures.end()) return false;
    targetX = npc->wx; targetY = npc->wy;
  }
  double dx = E.fg.worldOffsetX + player->px + player->w * .5 - targetX;
  double dy = E.fg.worldOffsetY + player->py + player->h * .5 - targetY;
  if (dx * dx + dy * dy > 32 * 32) return false;
  if (!objective->accepted) { objective->accepted = true; revision++; return true; }
  if (objective->type != OK_DELIVER) return false;
  return rewardFrontier(*objective, *player);
}

// Authored field jobs reference the same world anchors as their blueprints.
bool MissionSystem::startFrontier(int ownerPlayerId) {
  if (E.planetId != PL_FRONTIER || missionId != MI_NONE) return false;
  Player* player = E.psys.findPlayer(ownerPlayerId);
  if (!player) return false;
  missionId = MI_FRONTIER;
  planetId = PL_FRONTIER;
  phase = MP_ACTIVE;
  playerId = ownerPlayerId;
  startActorTick = E.actorTick;
  revision = 1;
  objectives.clear();
  for (const ContentQuest& quest : E.content.quests) {
    auto& objective = addObjective((uint8_t)quest.type, !quest.prerequisites.empty() ? OS_LOCKED : OS_ACTIVE, quest.count,
                 quest.x, quest.y + E.content.surfaceOffset(quest.surface), MISSION_FLAG_PRIMARY_MARKER);
    objective.accepted = quest.giver == 0;
  }
  E.containers.initialize();
  residentIds.assign(E.content.residents.size(), 0);
  updateFrontierResidents();
  E.inv.addToInventory(playerId, BRICK, 96);

  return true;
}

void MissionSystem::updateFrontier() {
  Player* player = E.psys.findPlayer(playerId);
  if (!player || !player->alive || E.actorTick % 12 != 0) return;
  updateFrontierResidents();
  elapsedTicks = imax(0, E.actorTick - startActorTick);
  double wx = E.fg.worldOffsetX + player->px + player->w * .5;
  double wy = E.fg.worldOffsetY + player->py + player->h * .5;
  auto cell = [&](int x, int y) -> int {
    x -= E.fg.worldOffsetX; y -= E.fg.worldOffsetY;
    if (x < 1 || x >= E.cols - 1 || y < 1 || y >= E.rows - 1) return -1;
    return E.fg.grid[E.I(x, y)];
  };
  for (MissionObjective& objective : objectives) {
    const ContentQuest& quest = E.content.quests[(size_t)objective.id];
    if (objective.state == OS_LOCKED && std::all_of(quest.prerequisites.begin(), quest.prerequisites.end(),
        [&](int id) { return objectives[(size_t)id].state == OS_COMPLETE; })) {
      objective.state = OS_ACTIVE; revision++;
    }
    if (objective.state != OS_ACTIVE || !objective.accepted) continue;
    double dx = wx - objective.worldX, dy = wy - objective.worldY;
    if (quest.type == OK_DELIVER) {
      int count = E.inv.countMaterial(*player, quest.material);
      count = imin(count, objective.required);
      if (count != objective.current) { objective.current = count; revision++; }
      continue;
    }
    if (quest.type == OK_DEFEAT && !objective.targetActorId && dx * dx + dy * dy < 160 * 160) {
      objective.targetActorId = spawnMissionCreature((uint8_t)quest.species, objective.worldX, objective.worldY, objective.id);
      if (objective.targetActorId) revision++;
    }
    if (quest.type != OK_DEFEAT && dx * dx + dy * dy > quest.radius * quest.radius) continue;
    bool complete = true;
    int offset = E.content.surfaceOffset(quest.areaSurface);
    if (quest.type == OK_PASSAGE) {
      complete = false;
      for (int top = quest.top + offset; top + PLAYER_H + 1 <= quest.bottom + offset; top++) {
        bool open = true;
        for (int y = top; y < top + PLAYER_H + 2 && open; y++)
          for (int x = quest.left; x <= quest.right; x++) {
            int mat = cell(x, y);
            if (mat < 0 || E.isBlockingForActor(mat)) { open = false; break; }
          }
        if (open) { complete = true; break; }
      }
    } else if (quest.type == OK_BUILD) {
      Engine::ActiveLayerScope active(E, &E.fg);
      E.comps.ensureGroundedSingleLayer();
      int longest = 0;
      for (int y = quest.top + offset; y <= quest.bottom + offset; y++) {
        int run = 0;
        for (int x = quest.left; x <= quest.right; x++) {
          bool usable = cell(x, y) == quest.material;
          if (usable) {
            int local = E.I(x - E.fg.worldOffsetX, y - E.fg.worldOffsetY);
            usable = E.fg.groundedCell[local] && E.fg.bodyOwner[local] < 0;
          }
          for (int head = y - PLAYER_H - 1; head < y && usable; head++) {
            int mat = cell(x, head);
            if (mat < 0 || E.isBlockingForActor(mat)) usable = false;
          }
          run = usable ? run + 1 : 0;
          longest = imax(longest, run);
        }
      }
      if (objective.current != longest) { objective.current = longest; revision++; }
      complete = longest >= objective.required;
    } else if (quest.type == OK_DEFEAT) {
      complete = objective.targetActorId && objective.current >= objective.required;
    } else if (quest.type == OK_DRAIN) {
      int liquid = 0, sampled = 0;
      for (int y = quest.top + offset; y <= quest.bottom + offset; y += 3)
        for (int x = quest.left; x <= quest.right; x += 3) {
          int mat = cell(x, y);
          if (mat < 0) { complete = false; continue; }
          sampled++;
          if (E.isLiquidMaterial(mat)) liquid++;
        }
      complete = complete && sampled > 0 && liquid * 8 < sampled;
    }
    if (!complete) continue;
    if (!rewardFrontier(objective, *player)) continue;
  }
  if (phase != MP_COMPLETE && std::all_of(objectives.begin(), objectives.begin() + std::min((size_t)8, objectives.size()),
      [](const MissionObjective& objective) { return objective.state == OS_COMPLETE; })) { phase = MP_COMPLETE; revision++; }
}
