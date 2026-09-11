SpellConnection MagicSystem::connectionForUpgrade(int upgrade) {
  switch (upgrade) {
    case WU_TOGETHER: return SC_TOGETHER;
    case WU_IMPACT: return SC_IMPACT;
    case WU_TIMER: return SC_TIMER;
    default: return SC_SEQUENCE;
  }
}
bool MagicSystem::isWand(const InvSlot& item) const {
  const auto* gear = item.itemKind == IK_GEAR && item.count > 0 ? E.content.gear(item.definitionId) : nullptr;
  return gear && gear->family == GF_WAND;
}
int MagicSystem::spellCapacity(const InvSlot& item) const {
  return isWand(item) ? E.content.gear(item.definitionId)->spellSlots : 0;
}
int MagicSystem::upgradeCapacity(const InvSlot& item) const {
  return isWand(item) ? E.content.gear(item.definitionId)->upgradeSlots : 0;
}
void MagicSystem::initializeWand(InvSlot& item) const {
  if (!isWand(item) || item.wand.initialized) return;
  item.wand = WandState(); item.wand.initialized = true;
  item.wand.spells[0] = E.content.gear(item.definitionId)->initialSpell;
}
bool MagicSystem::validItem(const InvSlot& item) const {
  if (!isWand(item)) {
    if (item.wand.initialized || item.wand.cursor != 0) return false;
    for (int id : item.wand.spells) if (id) return false;
    for (int id : item.wand.upgrades) if (id) return false;
    for (int link : item.wand.links) if (link) return false;
    return true;
  }
  if (!item.wand.initialized) return true;
  if (item.wand.cursor < 0 || item.wand.cursor >= spellCapacity(item)) return false;
  for (int i = 0; i < WAND_MAX_SPELLS; i++) if (int id = item.wand.spells[i]) {
    const auto* gear = E.content.gear(id);
    if (i >= spellCapacity(item) || !gear || gear->family != GF_SPELL) return false;
  }
  for (int i = 0; i < WAND_MAX_UPGRADES; i++) if (int id = item.wand.upgrades[i]) {
    if (i >= upgradeCapacity(item) || id < WU_AMPLIFY || id > WU_LINGER || !E.content.gear(id) ||
        item.wand.links[i] < 0 || item.wand.links[i] >= spellCapacity(item)) return false;
    if (connectionForUpgrade(id) != SC_SEQUENCE) {
      if (item.wand.links[i] >= spellCapacity(item) - 1) return false;
      for (int j = 0; j < i; j++)
        if (connectionForUpgrade(item.wand.upgrades[j]) != SC_SEQUENCE && item.wand.links[j] == item.wand.links[i]) return false;
    }
  }
  return true;
}
bool MagicSystem::validCast(const SpellCast& cast) const {
  if (cast.count < 0 || cast.count > WAND_MAX_SPELLS || cast.nextSlot < 0 || cast.nextSlot >= WAND_MAX_SPELLS ||
      cast.power < 100 || cast.power > 3200 || cast.shots < 1 || cast.shots > 16 ||
      cast.bounces < 0 || cast.bounces > 8 || cast.bonusDamage < 0 || cast.bonusDamage > 5 ||
      cast.homing < 0 || cast.homing > 4 || cast.lifetime < 100 || cast.lifetime > 500 ||
      cast.manaCost < 0 || cast.manaCost > 1000000 || cast.cooldown < 1 || cast.cooldown > 600) return false;
  for (int i = 0; i < cast.count; i++) {
    const auto* gear = E.content.gear(cast.spells[i]);
    if (!gear || gear->family != GF_SPELL || cast.connections[i] < SC_SEQUENCE || cast.connections[i] > SC_TIMER) return false;
  }
  return true;
}
bool MagicSystem::socket(int playerId, int slot, int kind, int index, int value) {
  auto* p = E.psys.findPlayer(playerId);
  if (!p || !p->active || !p->alive || slot < 0 || slot >= INV_SLOTS ||
      p->actionTicks > 0 || p->wandChargeTicks > 0 || p->heldCast.count > 0 || kind < 0 || kind > WS_CONNECTION) return false;
  InvSlot item = p->inv[slot];
  InvSlot cursor = p->cursor;
  if (!isWand(item) || index < 0 || index >= (kind == WS_SPELL ? spellCapacity(item) : upgradeCapacity(item))) return false;
  initializeWand(item);
  if (kind == WS_CONNECTION) {
    int upgrade = item.wand.upgrades[index];
    if (connectionForUpgrade(upgrade) == SC_SEQUENCE || value < 0 || value >= spellCapacity(item) - 1) return false;
    for (int i = 0; i < upgradeCapacity(item); i++)
      if (i != index && connectionForUpgrade(item.wand.upgrades[i]) != SC_SEQUENCE && item.wand.links[i] == value) return false;
    item.wand.links[index] = value;
  } else {
    const auto* gear = cursor.count > 0 && cursor.itemKind == IK_GEAR ? E.content.gear(cursor.definitionId) : nullptr;
    if (cursor.count > 0 && (!gear || gear->family != (kind == WS_SPELL ? GF_SPELL : GF_UPGRADE))) return false;
    int& socketId = kind == WS_SPELL ? item.wand.spells[index] : item.wand.upgrades[index];
    int incoming = cursor.count > 0 ? cursor.definitionId : 0;
    if (socketId && cursor.count > 1) return false;
    InvSlot removed;
    if (socketId) { removed.itemKind = IK_GEAR; removed.definitionId = socketId; removed.count = 1; }
    socketId = incoming;
    if (kind == WS_UPGRADE && connectionForUpgrade(incoming) != SC_SEQUENCE) {
      for (int source = 0; source < spellCapacity(item) - 1; source++) {
        bool used = false;
        for (int i = 0; i < upgradeCapacity(item); i++)
          if (i != index && connectionForUpgrade(item.wand.upgrades[i]) != SC_SEQUENCE && item.wand.links[i] == source) used = true;
        if (!used) { item.wand.links[index] = source; break; }
      }
    }
    if (cursor.count > 1) cursor.count--;
    else cursor = removed;
  }
  item.wand.cursor = 0;
  if (!validItem(item) || !validItem(cursor)) return false;
  p->inv[slot] = item; p->cursor = cursor;
  return true;
}
int MagicSystem::projectileCount(int definition) const {
  const auto* gear = E.content.gear(definition);
  return gear && gear->spell == SP_PRISM ? 5 : 1;
}
SpellCast MagicSystem::compileCast(const InvSlot& original, int chargeTicks) const {
  SpellCast cast;
  InvSlot item = original; initializeWand(item);
  const auto* gear = item.count > 0 && item.itemKind == IK_GEAR ? E.content.gear(item.definitionId) : nullptr;
  if (!isWand(item) || !validItem(item)) return cast;
  int surcharge = 100;
  const auto& wand = item.wand;
  int capacity = spellCapacity(item), at = wand.cursor;
  for (int i = 0; i < capacity && !wand.spells[at]; i++) at = (at + 1) % capacity;
  if (!wand.spells[at]) return cast;
  for (int i = 0; i < upgradeCapacity(item); i++) {
    switch (wand.upgrades[i]) {
      case WU_AMPLIFY: cast.power *= 2; surcharge += 15; break;
      case WU_BOUNCE: cast.bounces += 2; surcharge += 5; break;
      case WU_CHARGE: cast.charged = true; break;
      case WU_DOUBLE_SHOT: cast.shots *= 2; surcharge += 15; break;
      case WU_HOMING: cast.homing++; surcharge += 5; break;
      case WU_LINGER: cast.lifetime += 100; surcharge += 10; break;
    }
  }
  while (cast.count < WAND_MAX_SPELLS) {
    int node = cast.count++;
    cast.spells[node] = wand.spells[at];
    int next = at + 1;
    while (next < capacity && !wand.spells[next]) next++;
    int connection = SC_SEQUENCE;
    for (int i = 0; i < upgradeCapacity(item); i++)
      if (wand.links[i] == at && connectionForUpgrade(wand.upgrades[i]) != SC_SEQUENCE) {
        connection = connectionForUpgrade(wand.upgrades[i]); break;
      }
    const auto* core = E.content.gear(wand.spells[at]);
    if (next == capacity || (core->spell == SP_LUMEN && connection != SC_TOGETHER)) connection = SC_SEQUENCE;
    cast.connections[node] = connection;
    if (connection == SC_SEQUENCE) { cast.nextSlot = next == capacity ? 0 : next; break; }
    at = next;
  }
  cast.cooldown = gear->cooldown;
  if (continuous(cast)) { cast.cooldown = E.content.gear(cast.spells[0])->cooldown; cast.charged = false; chargeTicks = 0; }
  int charge = std::clamp(chargeTicks - 1, 0, WAND_CHARGE_TICKS);
  cast.power = cast.power * (100 + charge * 100 / WAND_CHARGE_TICKS) / 100;
  surcharge += charge * 15 / WAND_CHARGE_TICKS;
  int64_t cost = 0;
  for (int i = cast.count - 1; i >= 0; i--) {
    const auto* core = E.content.gear(cast.spells[i]);
    if (cast.connections[i] == SC_IMPACT || cast.connections[i] == SC_TIMER)
      cost *= projectileCount(core->id) * cast.shots;
    cost += ((int64_t)core->mana * surcharge + (continuous(cast) ? 50 : 99)) / 100;
    cost = std::min<int64_t>(cost, 1000000);
  }
  cast.manaCost = (int)cost;
  return cast;
}
