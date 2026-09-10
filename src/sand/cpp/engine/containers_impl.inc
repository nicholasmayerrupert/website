void ContainerSystem::initialize() {
  if (!chests.empty()) return;
  for (const auto& definition : E.content.chests) {
    AdventureChest chest;
    chest.id = definition.id; chest.wx = definition.x;
    chest.wy = definition.y + E.content.surfaceOffset(definition.surface);
    chest.loot = definition.loot; chest.loot.resize(std::max(SLOT_COUNT, chest.loot.size()));
    chests.push_back(std::move(chest));
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
  chest.loot.resize(std::max(SLOT_COUNT, chest.loot.size()));
  double dx = chest.wx - (player->px + E.fg.worldOffsetX + player->w * .5);
  double dy = chest.wy - (player->py + E.fg.worldOffsetY + player->h * .5);
  if (dx*dx + dy*dy > 28*28) return false;
  if (slot == -2) { activeChest = chestId; chest.opened = true; return true; }
  if (slot == -3) {
    if (activeChest != chestId || !store(chest, player->cursor)) return false;
    E.audio.emit(SE_PLACE,player->px,player->py,.7,OAK_WOOD);
    return true;
  }
  if (slot < -1 || slot >= (int)chest.loot.size() || activeChest != chestId) return false;
  Player trial = *player;
  if (slot == -1) {
    for (const auto& item : chest.loot) if (!E.inv.addStack(trial, item)) return false;
    *player = std::move(trial); std::fill(chest.loot.begin(), chest.loot.end(), InvSlot());
  } else {
    if (chest.loot[(size_t)slot].count <= 0) return false;
    if (!E.inv.addStack(trial, chest.loot[(size_t)slot])) return false;
    *player = std::move(trial); chest.loot[(size_t)slot] = InvSlot();
  }
  E.audio.emit(SE_PICKUP, player->px, player->py, .8, EMPTY);
  return true;
}
int ContainerSystem::buildSnapshot() {
  snapshot.clear();
  for (const auto& c : chests) {
    if (c.packed) continue;
    snapshot.push_back((float)c.id); snapshot.push_back((float)c.wx); snapshot.push_back((float)c.wy);
    snapshot.push_back(c.opened ? 1.f : 0.f);
    snapshot.push_back((float)std::count_if(c.loot.begin(), c.loot.end(), [](const auto& slot) { return slot.count > 0; }));
  }
  return (int)snapshot.size() / 5;
}
int ContainerSystem::buildLootSnapshot() {
  lootSnapshot.clear();
  for (auto& c : chests) if (c.id == activeChest && !c.packed) {
    c.loot.resize(std::max(SLOT_COUNT, c.loot.size()));
    lootSnapshot.resize(c.loot.size() * IVS_STRIDE);
    for (size_t i = 0; i < c.loot.size(); i++) E.inv.writeSlotSnapshot(lootSnapshot.data() + i * IVS_STRIDE, c.loot[i]);
    return (int)c.loot.size();
  }
  return 0;
}

bool ContainerSystem::canStore(const InvSlot& stack) const {
  if (stack.count <= 0 || stack.isTool || inventoryPoolId(stack.itemKind)
      || stack.itemKind == IK_CHEST || stack.itemKind == IK_MINING_TOOL
      || stack.itemKind == IK_BLAST_GUN || stack.itemKind == IK_RESCUE_BEAM) return false;
  const auto* gear = stack.itemKind == IK_GEAR ? E.content.gear(stack.definitionId) : nullptr;
  return stack.itemKind != IK_GEAR || (gear && gear->family != 11);
}

bool ContainerSystem::store(AdventureChest& chest, InvSlot& stack) {
  if (!canStore(stack)) return false;
  chest.loot.resize(std::max(SLOT_COUNT, chest.loot.size()));
  int before = stack.count, limit = E.inv.stackLimit(stack);
  for (auto& slot : chest.loot) if (E.inv.sameStack(slot, stack) && slot.count < limit) {
    int amount = imin(stack.count, limit - slot.count);
    slot.count += amount; stack.count -= amount;
    if (!stack.count) break;
  }
  for (auto& slot : chest.loot) if (stack.count > 0 && slot.count <= 0) {
    slot = stack; slot.count = imin(stack.count, limit); stack.count -= slot.count;
  }
  bool changed = stack.count != before;
  if (stack.count <= 0) stack = InvSlot();
  return changed;
}

bool ContainerSystem::moveSlot(int playerId, int chestId, int index, int action) {
  if (activeChest != chestId || action < 0 || action > 2 || !interact(playerId, chestId, -2)) return false;
  auto* player = E.psys.findPlayer(playerId);
  auto& chest = *std::find_if(chests.begin(), chests.end(), [&](const auto& c) { return c.id == chestId; });
  if (action == 2) {
    if (index < 0 || index >= INV_SLOTS || player->cursor.count > 0) return false;
    if (!store(chest, player->inv[index])) return false;
    if (index == player->selectedSlot) E.inv.setSelectedSlot(*player, index);
  } else {
    if (index < 0 || index >= (int)chest.loot.size()) return false;
    auto& slot = chest.loot[(size_t)index]; auto& cursor = player->cursor;
    bool half = action == 1;
    if (cursor.count > 0 && !canStore(cursor)) return false;
    if (cursor.count <= 0) {
      if (slot.count <= 0) return false;
      cursor = slot;
      if (half && E.inv.stackLimit(slot) > 1 && !isFiniteAmmoWeapon(slot.itemKind)) {
        cursor.count = (slot.count + 1) / 2; slot.count -= cursor.count;
        if (!slot.count) slot = InvSlot();
      } else slot = InvSlot();
    } else if (slot.count <= 0 || E.inv.sameStack(slot, cursor)) {
      int room = E.inv.stackLimit(cursor) - imax(0, slot.count);
      int amount = imin(cursor.count, room);
      if (half && !isFiniteAmmoWeapon(cursor.itemKind)) amount = imin(amount, 1);
      if (amount <= 0) return false;
      if (slot.count <= 0) { slot = cursor; slot.count = 0; }
      slot.count += amount; cursor.count -= amount;
      if (cursor.count <= 0) cursor = InvSlot();
    } else if (!half) std::swap(slot, cursor);
    else return false;
  }
  E.audio.emit(SE_PICKUP, player->px, player->py, .5, EMPTY);
  return true;
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
