// Independent field jobs live in the same world as Aster Station. Completing a
// job changes inventory and the journal; it never replaces the player's world.
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
  addObjective(OK_PASSAGE, OS_ACTIVE, 1, -860,
               E.terrain.genSurfaceAbs(-790) + 28, MISSION_FLAG_PRIMARY_MARKER);
  addObjective(OK_DRAIN, OS_ACTIVE, 1, -480, 382);
  addObjective(OK_SURVEY, OS_ACTIVE, 1, 900,
               E.terrain.genSurfaceAbs(900) - 130);
  addObjective(OK_SURVEY, OS_LOCKED, 1, -64, 8);
  E.inv.addToInventory(playerId, BRICK, 640);
  E.inv.addToInventory(playerId, TNT, 48);
  E.inv.addToInventory(playerId, WATER, 240);
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
  auto finishJob = [&](MissionObjective& objective) {
    objective.state = OS_COMPLETE;
    objective.current = 1;
    revision++;
    if (objective.id == 0) E.inv.addSpecialItem(playerId, IK_BORE_CANNON, 30);
    if (objective.id == 1) E.inv.addToInventory(playerId, BRICK, 960);
    if (objective.id == 2) E.inv.addSpecialItem(playerId, IK_DYNAMITE_SATCHEL, 24);
  };
  for (MissionObjective& objective : objectives) {
    if (objective.state != OS_ACTIVE) continue;
    double dx = wx - objective.worldX, dy = wy - objective.worldY;
    if (dx * dx + dy * dy > 23.0 * 23.0) continue;
    bool complete = true;
    if (objective.type == OK_PASSAGE) {
      // A continuous actor-height opening through the rockfall is required.
      int floor = E.terrain.genSurfaceAbs(-790) + 36;
      complete = false;
      for (int top = floor - 38; top <= floor - PLAYER_H; top++) {
        bool open = true;
        for (int y = top; y < top + PLAYER_H + 2 && open; y++)
          for (int x = -808; x <= -792; x++) {
            int mat = cell(x, y);
            if (mat < 0 || E.isBlockingForActor(mat)) { open = false; break; }
          }
        if (open) { complete = true; break; }
      }
    } else if (objective.type == OK_DRAIN) {
      int liquid = 0, sampled = 0;
      for (int y = 310; y <= 394; y += 3) for (int x = -586; x <= -398; x += 3) {
        int mat = cell(x, y);
        if (mat < 0) { complete = false; continue; }
        sampled++;
        if (E.isLiquidMaterial(mat)) liquid++;
      }
      complete = complete && sampled > 1000 && liquid * 8 < sampled;
    }
    if (complete) finishJob(objective);
  }
  bool fieldComplete = true;
  for (int i = 0; i < 3; i++) fieldComplete &= objectives[i].state == OS_COMPLETE;
  if (fieldComplete && objectives[3].state == OS_LOCKED) {
    objectives[3].state = OS_ACTIVE;
    revision++;
  }
  if (objectives[3].state == OS_COMPLETE) {
    phase = MP_COMPLETE;
    revision++;
  }
}
