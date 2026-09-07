#pragma once
// Survival inventory policy. Stacks and cursor state live on Player so the
// authority snapshot stays consistent with player state.

struct Engine;

class InventorySystem {
 public:
  explicit InventorySystem(Engine& e) : E(e) {}

  std::vector<float> invSnapshot;  // packed [IVS_STRIDE] floats per slot (one player)
  std::vector<float> cursorSnap;   // packed [IVS_STRIDE] floats for the carried cursor stack
  std::vector<int32_t> poolSnapshot;

  static int materialPool(uint8_t material);
  bool hasPool(const Player& p, int pool) const;
  bool storeInPool(Player& p, uint8_t material, int count);
  InvSlot resolveSlot(const Player& p, const InvSlot& slot) const;
  void consumeSelected(Player& p, uint8_t material, int count);
  void poolAction(int id, int pool, int action, int material, int value);
  int buildPoolSnapshot(int id);
  int countMaterial(const Player& p, uint8_t material) const;
  bool consumeMaterial(Player& p, uint8_t material, int count);

  bool addGear(int id, int definition, int count = 1);
  bool acceptsEquipment(const InvSlot& item, int slot) const;
  void seedStarterTools(Player& p);
  void seedStarterTools(int id);
  void resetPlayerPlaceStroke(Player& p);
  void setSelectedSlot(Player& p, int slot);
  void setSelectedSlot(int id, int slot);
  void cycleSelectedSlot(int id, int delta);
  bool addToInventory(Player& p, uint8_t mat, int count, uint8_t plantType = PT_STANDARD);
  bool addToInventory(int id, uint8_t mat, int count, uint8_t plantType = PT_STANDARD);
  bool addStack(Player& p, const InvSlot& stack);
  bool addStack(int id, const InvSlot& stack);
  bool addSpecialItem(int id, uint8_t itemKind, int count);
  static bool sameStack(const InvSlot& a, const InvSlot& b);
  bool consumeSelectedWeaponAmmo(Player& p, uint8_t itemKind);
  bool placeFromSelected(Player& p, int ax, int ay, Layer* layer);
  bool placeFromSelectedStroke(Player& p, int x0, int y0, int x1, int y1, Layer* layer);
  bool placeFromSelected(int id, int ax, int ay);
  void moveSlot(Player& p, int from, int to);
  void moveSlot(int id, int from, int to);
  void cursorPick(Player& p, int slot, bool half);
  void cursorPick(int id, int slot, int half);
  bool throwFromCursor(Player& p, bool whole);
  bool throwFromCursor(int id, int whole);
  void dropAll(Player& p);
  int buildCursorSnapshot(int playerId);
  int buildInventorySnapshot(int playerId);
  void applyInventoryPlayer(Player& p);

 private:
  Engine& E;
};
