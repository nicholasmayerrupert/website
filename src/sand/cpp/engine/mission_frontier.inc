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
  for (const ContentQuest& quest : E.content.quests)
    addObjective((uint8_t)quest.type, quest.prerequisites ? OS_LOCKED : OS_ACTIVE, 1,
                 quest.x, quest.y + E.content.surfaceOffset(quest.surface), MISSION_FLAG_PRIMARY_MARKER);
  E.inv.addToInventory(playerId, BRICK, 96);
  E.inv.addToInventory(playerId, TNT, 12);
  return true;
}

void MissionSystem::updateFrontier() {
  Player* player = E.psys.findPlayer(playerId);
  if (!player || !player->alive || E.actorTick % 12 != 0) return;
  elapsedTicks = imax(0, E.actorTick - startActorTick);
  double wx = E.fg.worldOffsetX + player->px + player->w * .5;
  double wy = E.fg.worldOffsetY + player->py + player->h * .5;
  auto cell = [&](int x, int y) -> int {
    x -= E.fg.worldOffsetX; y -= E.fg.worldOffsetY;
    if (x < 1 || x >= E.cols - 1 || y < 1 || y >= E.rows - 1) return -1;
    return E.fg.grid[E.I(x, y)];
  };
  int completed = 0;
  for (const MissionObjective& objective : objectives)
    if (objective.state == OS_COMPLETE) completed |= 1 << objective.id;
  for (MissionObjective& objective : objectives) {
    const ContentQuest& quest = E.content.quests[(size_t)objective.id];
    if (objective.state == OS_LOCKED && (completed & quest.prerequisites) == quest.prerequisites) {
      objective.state = OS_ACTIVE; revision++;
    }
    if (objective.state != OS_ACTIVE) continue;
    double dx = wx - objective.worldX, dy = wy - objective.worldY;
    if (dx * dx + dy * dy > quest.radius * quest.radius) continue;
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
    Player inventoryBefore = *player;
    bool rewarded = true;
    if (quest.rewardKind == 1) rewarded = E.inv.addToInventory(playerId, (uint8_t)quest.rewardId, quest.rewardCount);
    if (quest.rewardKind == 2) rewarded = E.inv.addSpecialItem(playerId, (uint8_t)quest.rewardId, quest.rewardCount);
    if (!rewarded) { *player = inventoryBefore; continue; }
    objective.state = OS_COMPLETE; objective.current = 1; revision++;
    completed |= 1 << objective.id;
  }
  if (completed == (1 << objectives.size()) - 1) { phase = MP_COMPLETE; revision++; }
}
