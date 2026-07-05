#pragma once
// Survival inventory (extracted from the Engine in 5d). The stacks live ON the
// Player (inv/cursor/selectedSlot — they must replicate + reconcile with the
// player), so this class owns the POLICY: starter kit, slot selection,
// stacking/merging, per-pixel placement economy, the Minecraft cursor model
// (pick/place/swap/throw), the HUD snapshots, and the per-step survival input
// application. Method bodies live in inventory_impl.inc.

struct Engine;

class InventorySystem {
 public:
  explicit InventorySystem(Engine& e) : E(e) {}

  std::vector<float> invSnapshot;  // packed [IVS_STRIDE] floats per slot (one player)
  std::vector<float> cursorSnap;   // packed [IVS_STRIDE] floats for the carried cursor stack

  void seedStarterTools(Player& p);
  void seedStarterTools(int id);
  void resetPlayerPlaceStroke(Player& p);
  void setSelectedSlot(Player& p, int slot);
  void setSelectedSlot(int id, int slot);
  void cycleSelectedSlot(int id, int delta);
  bool addToInventory(Player& p, uint8_t mat, int count);
  bool addToInventory(int id, uint8_t mat, int count);
  bool placeFromSelected(Player& p, int ax, int ay, Layer* layer);
  bool placeFromSelectedStroke(Player& p, int x0, int y0, int x1, int y1, Layer* layer);
  bool placeFromSelected(int id, int ax, int ay);
  void moveSlot(Player& p, int from, int to);
  void moveSlot(int id, int from, int to);
  void cursorPick(Player& p, int slot, bool half);
  void cursorPick(int id, int slot, int half);
  bool throwFromCursor(Player& p, bool whole);
  bool throwFromCursor(int id, int whole);
  int buildCursorSnapshot(int playerId);
  int buildInventorySnapshot(int playerId);
  void applyInventoryPlayer(Player& p);

 private:
  Engine& E;
};
