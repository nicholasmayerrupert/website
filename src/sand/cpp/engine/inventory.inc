  // Survival inventory (InventorySystem, inventory.hpp) — composed here; method
  // bodies in inventory_impl.inc. Shims keep internal call sites (items pickup,
  // player tools, spawn, ABI) unchanged.
  InventorySystem inv{*this};
  void seedStarterTools(Player& p) { inv.seedStarterTools(p); }
  void seedStarterTools(int id) { inv.seedStarterTools(id); }
  void resetPlayerPlaceStroke(Player& p) { inv.resetPlayerPlaceStroke(p); }
  void setSelectedSlot(int id, int slot) { inv.setSelectedSlot(id, slot); }
  void cycleSelectedSlot(int id, int delta) { inv.cycleSelectedSlot(id, delta); }
  bool addToInventory(Player& p, uint8_t mat, int count, uint8_t plantType = PT_OAK) { return inv.addToInventory(p, mat, count, plantType); }
  bool addToInventory(int id, uint8_t mat, int count, uint8_t plantType = PT_OAK) { return inv.addToInventory(id, mat, count, plantType); }
  bool placeFromSelected(int id, int ax, int ay) { return inv.placeFromSelected(id, ax, ay); }
  void moveSlot(int id, int from, int to) { inv.moveSlot(id, from, to); }
  void cursorPick(int id, int slot, int half) { inv.cursorPick(id, slot, half); }
  bool throwFromCursor(int id, int whole) { return inv.throwFromCursor(id, whole); }
  int buildCursorSnapshot(int playerId) { return inv.buildCursorSnapshot(playerId); }
  int buildInventorySnapshot(int playerId) { return inv.buildInventorySnapshot(playerId); }
  void applyInventoryPlayer(Player& p) { inv.applyInventoryPlayer(p); }
