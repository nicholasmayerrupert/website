#pragma once
// Creative and survival tool state, edits, drafts, seeds, and pointer policy.

struct Engine;

class ToolSystem {
 public:
  explicit ToolSystem(Engine& e) : E(e) {}

  // Tool, pointer, and draft state.
  int activeTool = T_CUBE;
  bool lmbDown = false, rmbDown = false;
  int draftLayer = 0;            // 0 = foreground (LMB), 1 = background (RMB)
  int draftOwner = -1;           // survival: player owning the in-progress solid draft (-1 = creative/none)
  std::unordered_set<int> draft; // the SINGLE component draft (any material), staged then dropped on release
  uint8_t draftMaterial = STONE;
  int lastDraftCx = -1, lastDraftCy = -1;
  bool draftStrokeActive = false;
  std::vector<SurvivalFootprint> survivalFootprints;
  std::vector<int32_t> survivalFootprintSnapshot; // packed FP_STRIDE ints
  std::unordered_map<int, std::vector<std::pair<int, int>>> discOffsetCache; // center-first disc offsets per radius
  std::vector<int> draftSnapshot;
  bool drafting = false, draftingSeed = false;
  uint8_t creativeMode = CM_CUBE, creativeMaterial = STONE, creativeSeed = PT_STANDARD, creativeCreature = CS_MINNOW;
  uint8_t cubeMaterial = RIGID;  // material the CUBE tool spawns as a free body
  bool hasSeedOrigin = false; int seedOriginX = 0, seedOriginY = 0;
  double lastEmitMs = -1e9;
  int lastEmitCx = -1, lastEmitCy = -1; // continuous-paint stroke interpolation
  bool emitStrokeActive = false;
  // Cells destroyed by the last mineDamage call: (material, cellIndex) -> drops.
  struct MinedCell { uint8_t material; int cell; uint8_t plantType; };
  std::vector<MinedCell> lastMinedCells;

  // Integer cell AABB of a player for build-exclusion tests (nullptr -> empty box,
  // contains() always false).
  struct PlayerCellBox { int x0 = 0, x1 = -1, y0 = 0, y1 = -1;
    bool contains(int x, int y) const { return x >= x0 && x <= x1 && y >= y0 && y <= y1; } };
  static PlayerCellBox playerCellBox(const Player* p) {
    PlayerCellBox b;
    if (p) { b.x0 = (int)std::floor(p->px); b.x1 = (int)std::floor(p->px + p->w - 1e-6); b.y0 = (int)std::floor(p->py); b.y1 = (int)std::floor(p->py + p->h - 1e-6); }
    return b;
  }
  // Shared capped scan + stroke lerp (member templates; bodies in tools_impl.inc
  // — they need the full Engine definition and are only instantiated there).
  template <class Offs, class GetOff, class Act>
  int cappedOffsetScan(int cx, int cy, const Offs& offs, GetOff getOff, int yMaxExcl, int cap, const Player* p, Act act);
  template <class Stamp, class WantMore>
  void strokeScan(int x0, int y0, int x1, int y1, int spacing, Stamp stamp, WantMore wantMore);

  void initSurvivalFootprints();
  int survivalFootprintCount() const;
  const SurvivalFootprint& getSurvivalFootprint(int id) const;
  const SurvivalFootprint& getSurvivalFootprint(const Player& p) const;
  int clampSurvivalFootprintId(int id) const;
  int buildSurvivalFootprintSnapshot();
  void setSelectedFootprint(Player& p, int id);
  void setSelectedFootprint(int id, int footprintId);
  int selectedFootprintId(int id) const;
  int survivalFootprintCellCount(const Player& p) const;
  void survivalFootprintBounds(const SurvivalFootprint& fp, int cx, int cy, int& x0, int& y0, int& x1, int& y1) const;
  bool footprintHasMaterialAt(int cx, int cy, const SurvivalFootprint& fp);
  int paintDisc(int cx, int cy, int radius, uint8_t material, bool overwrite);
  int placeMaterialAt(int cx, int cy, int radius, uint8_t mat);
  void registerComponentCells(uint8_t mat, std::unordered_set<int>& cells);
  int placeMaterialAtCapped(int cx, int cy, int radius, uint8_t mat, int maxCells, const Player* p = nullptr);
  int placeMaterialAtFootprintCapped(int cx, int cy, const SurvivalFootprint& fp, uint8_t mat, int maxCells, const Player* p = nullptr);
  const std::vector<std::pair<int, int>>& discOffsets(int radius);
  void destroyCellAt(int k, uint8_t m, std::vector<int>& erasedStone, std::vector<int>& erasedIce, bool& erasedPlant,
                     std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirtyBodies);
  void splitComponentsAfterDestroy(std::vector<int>& erasedStone, std::vector<int>& erasedIce, bool erasedPlant);
  int eraseDisc(int cx, int cy, int radius);
  int eraseStrokeCells(const std::vector<int>& cells, int x0, int y0, int x1, int y1);
  int clearMineDamageDisc(int cx, int cy, int radius);
  int clearMineDamageFootprint(int cx, int cy, const SurvivalFootprint& fp);
  void clearAllMineDamage();
  uint32_t mineDurationFor(uint8_t m, uint32_t areaScale) const;
  uint32_t minePowerFor(uint8_t m, const Player& miner, bool scaledSpeed, uint32_t speedMultiplier = 1) const;
  double playerMineProgress(int id);
  bool mineDamageCellStep(int k, uint8_t m, const Player& miner, bool scaledSpeed, uint32_t areaScale, uint32_t speedMultiplier,
                          std::vector<int>& erasedStone, std::vector<int>& erasedIce, bool& erasedPlant,
                          std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirtyBodies);
  int mineDamageDisc(int cx, int cy, int radius, const Player& miner, bool scaledSpeed);
  int mineDamageFootprint(int cx, int cy, const SurvivalFootprint& fp, const Player& miner, bool scaledSpeed);
  int addDiscToDraft(std::unordered_set<int>& draft, int cx, int cy, int radius, int yLimit);
  int addDiscToDraftCapped(std::unordered_set<int>& d, int cx, int cy, int radius, int yLimit, int maxAdd, const Player* p);
  int addDiscStrokeToDraft(std::unordered_set<int>& d, int x0, int y0, int x1, int y1, int radius, int yLimit);
  int addFootprintToDraftCapped(std::unordered_set<int>& d, int cx, int cy, const SurvivalFootprint& fp, int yLimit, int maxAdd, const Player* p);
  int footprintStrokeSpacing(const SurvivalFootprint& fp) const;
  int addFootprintStrokeToDraftCapped(std::unordered_set<int>& d, int x0, int y0, int x1, int y1, const SurvivalFootprint& fp, int yLimit, int maxAdd, const Player* p);
  int placeMaterialAtFootprintStrokeCapped(int x0, int y0, int x1, int y1, const SurvivalFootprint& fp, uint8_t mat, int maxCells, const Player* p = nullptr);
  int brushFor(uint8_t m);
  void finalizeDraft();
  bool getSeedOrigin(int cx, int cy, int& x0, int& y0);
  bool canPlaceSeedAt(int x0, int y0);
  bool placeSeedAt(int x0, int y0);
  bool placeSeedAtTyped(int x0, int y0, uint8_t pt);
  bool placeMyceliumSporeAt(int x0, int y0);
  int effectiveTool();
  bool isPaintTool(int t);
  void setTool(int tool);
  void setCreativeMaterial(int kind, int value);
  void remapDraftForShift(std::unordered_set<int>& d, int dx, int dy);
  void remapDraftsForShift(int dx, int dy);
  void remapEmitStrokeForShift(int dx, int dy);
  int updateSeedDraft(int cx, int cy);
  int continueDrafts(int cx, int cy);
  int pointerDraft(int cx, int cy);
  int pointerDown(int cx, int cy, int button);
  void pointerButtons(int buttons);
  int pointerUp(int button);
  void emitToolAt(int cx, int cy);
  void emitStrokeLayer(int x0, int y0, int x1, int y1, bool toBg);
  void emitHeldTool(int cx, int cy, double now, bool inside, bool drawMode);
  int applyTool(int cx, int cy, double now, bool inside, bool drawMode);

 private:
  Engine& E;
};
