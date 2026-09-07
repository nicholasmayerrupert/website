void ContainerSystem::initialize() {
  if (!chests.empty()) return;
  for (const auto& definition : E.content.chests) {
    AdventureChest chest;
    chest.id = definition.id; chest.wx = definition.x;
    chest.wy = definition.y + E.content.surfaceOffset(definition.surface);
    chest.loot = definition.loot; chests.push_back(std::move(chest));
  }
}
void ContainerSystem::tick() {
  if (E.planetId != PL_FRONTIER) return;
  if (E.actorTick % 120 == 0) {
    Engine::ActiveLayerScope scope(E, &E.fg);
    int lattice = WorldContextSystem::VILLAGE_LATTICE;
    int first = (int)std::floor((E.fg.worldOffsetX-300.0)/lattice);
    int last = (int)std::floor((E.fg.worldOffsetX+E.cols+300.0)/lattice);
    for (int q = first; q <= last; q++) {
      VillagePlan village;
      if (!E.worldContext.villagePlan(q, village)) continue;
      for (int i = 0; i < village.buildingCount; i++) {
        VillageBuildingPlan building;
        if (!E.worldContext.villageBuildingPlan(village,i,building) || std::abs(building.center)<1400) continue;
        int id = 1000000 + building.id % 7000000;
        if (std::any_of(chests.begin(),chests.end(),[&](const auto& c){return c.id==id;})) continue;
        if (!E.creatures.boxInsideLoadedWindow(building.center,building.floorY-4,6,4,8)) continue;
        AdventureChest chest; chest.id=id; chest.wx=building.center; chest.wy=building.floorY-4;
        InvSlot armor; armor.itemKind=IK_GEAR; armor.definitionId=100+building.id%36; armor.count=1;
        InvSlot cordial; cordial.itemKind=IK_GEAR; cordial.definitionId=320+(building.id%2); cordial.count=1;
        InvSlot copper; copper.material=COPPER_ORE; copper.count=20+building.id%30;
        chest.loot={armor,cordial,copper}; chests.push_back(std::move(chest));
      }
    }
  }
  for (auto& chest : chests) {
    int x = (int)chest.wx - E.fg.worldOffsetX, y = (int)chest.wy - E.fg.worldOffsetY;
    if (x < 6 || x >= E.cols - 6 || y < 1 || y >= E.rows - 8) continue;
    bool supported = false;
    for (int dx = -3; dx <= 3; dx++) if (E.psys.playerCellSolid(x + dx, y + 4)) supported = true;
    if (!supported) chest.wy += .25;
  }
}
bool ContainerSystem::interact(int playerId, int chestId, int slot) {
  auto* player = E.psys.findPlayer(playerId);
  if (!player || !player->alive || E.planetId != PL_FRONTIER) return false;
  auto found = std::find_if(chests.begin(), chests.end(), [&](const auto& c) { return c.id == chestId; });
  if (found == chests.end()) return false;
  auto& chest = *found;
  double dx = chest.wx - (player->px + E.fg.worldOffsetX + player->w * .5);
  double dy = chest.wy - (player->py + E.fg.worldOffsetY + player->h * .5);
  if (dx*dx + dy*dy > 28*28) return false;
  if (slot == -2) { activeChest = chestId; chest.opened = true; return true; }
  if (slot < -1 || slot >= (int)chest.loot.size() || activeChest != chestId) return false;
  Player trial = *player;
  if (slot == -1) {
    for (const auto& item : chest.loot) if (!E.inv.addStack(trial, item)) return false;
    *player = std::move(trial); chest.loot.clear();
  } else {
    if (!E.inv.addStack(trial, chest.loot[(size_t)slot])) return false;
    *player = std::move(trial); chest.loot.erase(chest.loot.begin() + slot);
  }
  E.audio.emit(SE_PICKUP, player->px, player->py, .8, EMPTY);
  return true;
}
int ContainerSystem::buildSnapshot() {
  snapshot.clear();
  for (const auto& c : chests) {
    snapshot.push_back((float)c.id); snapshot.push_back((float)c.wx); snapshot.push_back((float)c.wy);
    snapshot.push_back(c.opened ? 1.f : 0.f); snapshot.push_back((float)c.loot.size());
  }
  return (int)chests.size();
}
int ContainerSystem::buildLootSnapshot() {
  lootSnapshot.clear();
  for (const auto& c : chests) if (c.id == activeChest) {
    lootSnapshot.resize(c.loot.size() * IVS_STRIDE);
    for (size_t i = 0; i < c.loot.size(); i++) writeInventorySlotSnapshot(lootSnapshot.data() + i * IVS_STRIDE, c.loot[i], {
      .selected = WriteInventorySlotSnapshotSelected{false}, .pool = WriteInventorySlotSnapshotPool{0}});
    return (int)c.loot.size();
  }
  return 0;
}
