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
    if (chest.packed) continue;
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
  if (found == chests.end() || found->packed) return false;
  auto& chest = *found;
  double dx = chest.wx - (player->px + E.fg.worldOffsetX + player->w * .5);
  double dy = chest.wy - (player->py + E.fg.worldOffsetY + player->h * .5);
  if (dx*dx + dy*dy > 28*28) return false;
  if (slot == -2) { activeChest = chestId; chest.opened = true; return true; }
  if (slot == -3) {
    if (activeChest!=chestId || player->cursor.count<=0 || player->cursor.itemKind==IK_CHEST) return false;
    chest.loot.push_back(player->cursor); player->cursor=InvSlot();
    E.audio.emit(SE_PLACE,player->px,player->py,.7,OAK_WOOD);
    return true;
  }
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
    if (c.packed) continue;
    snapshot.push_back((float)c.id); snapshot.push_back((float)c.wx); snapshot.push_back((float)c.wy);
    snapshot.push_back(c.opened ? 1.f : 0.f); snapshot.push_back((float)c.loot.size());
  }
  return (int)snapshot.size() / 5;
}
int ContainerSystem::buildLootSnapshot() {
  lootSnapshot.clear();
  for (const auto& c : chests) if (c.id == activeChest && !c.packed) {
    lootSnapshot.resize(c.loot.size() * IVS_STRIDE);
    for (size_t i = 0; i < c.loot.size(); i++) writeInventorySlotSnapshot(lootSnapshot.data() + i * IVS_STRIDE, c.loot[i], {
      .selected = WriteInventorySlotSnapshotSelected{false}, .pool = WriteInventorySlotSnapshotPool{0}});
    return (int)c.loot.size();
  }
  return 0;
}

int ContainerSystem::target(const Player& player) const {
  double wx=player.aimX+E.fg.worldOffsetX, wy=player.aimY+E.fg.worldOffsetY;
  for (const auto& chest : chests) {
    if (chest.packed || std::abs(wx-chest.wx)>3.5 || wy<chest.wy-2 || wy>chest.wy+4) continue;
    double dx=chest.wx-(player.px+E.fg.worldOffsetX+player.w*.5);
    double dy=chest.wy+2-(player.py+E.fg.worldOffsetY+player.h*.5);
    if (dx*dx+dy*dy<=28*28) return chest.id;
  }
  return 0;
}
bool ContainerSystem::pack(Player& player, int id) {
  if (target(player)!=id) return false;
  for (auto& chest : chests) if (chest.id==id && !chest.packed) {
    InvSlot item; item.itemKind=IK_CHEST; item.definitionId=id; item.count=1;
    if (!E.inv.addStack(player,item)) return false;
    chest.packed=true;
    if (activeChest==id) activeChest=0;
    E.audio.emit(SE_PICKUP,player.px,player.py,.8,EMPTY);
    return true;
  }
  return false;
}
bool ContainerSystem::canPlace(const Player& player, int x, int y) const {
  if (x<4 || x>=E.cols-4 || y<1 || y>=E.rows-5) return false;
  if (std::hypot(x-(player.px+player.w*.5),y+2-(player.py+player.h*.5))>28) return false;
  if (x+3.5>player.px && x-3.5<player.px+player.w && y+4>player.py && y<player.py+player.h) return false;
  for (int yy=y; yy<y+4; yy++) for (int xx=x-3; xx<=x+3; xx++)
    if (E.psys.playerCellSolid(xx,yy)) return false;
  for (const auto& chest : chests) if (!chest.packed
    && std::abs(chest.wx-(x+E.fg.worldOffsetX))<7 && std::abs(chest.wy-(y+E.fg.worldOffsetY))<4) return false;
  return true;
}
bool ContainerSystem::place(Player& player, int x, int y) {
  auto& slot=player.inv[player.selectedSlot];
  if (slot.itemKind!=IK_CHEST || slot.count<=0 || !canPlace(player,x,y)) return false;
  auto found=std::find_if(chests.begin(),chests.end(),[&](const auto& c){return c.id==slot.definitionId && c.packed;});
  if (!slot.definitionId) {
    AdventureChest chest; chest.id=16000000;
    for (const auto& c : chests) chest.id=imax(chest.id,c.id+1);
    chests.push_back(std::move(chest)); found=std::prev(chests.end());
  } else if (found==chests.end()) return false;
  found->wx=x+E.fg.worldOffsetX; found->wy=y+E.fg.worldOffsetY;
  found->packed=false; found->opened=false;
  slot=InvSlot();
  E.inv.setSelectedSlot(player,player.selectedSlot);
  E.audio.emit(SE_PLACE,x,y,.7,OAK_WOOD);
  return true;
}
