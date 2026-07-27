  // ToolSystem is composed here; wrappers preserve the Engine's internal and ABI
  // surface while implementations live in tools_impl.inc.
  ToolSystem tools{*this};
  const SurvivalFootprint& getSurvivalFootprint(int id) const { return tools.getSurvivalFootprint(id); }
  const SurvivalFootprint& getSurvivalFootprint(const Player& p) const { return tools.getSurvivalFootprint(p); }
  void destroyCellAt(int k, uint8_t m, std::vector<int>& erasedStructural,
                     std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirtyBodies) {
    tools.destroyCellAt(k, m, erasedStructural, bodyById, dirtyBodies);
  }
  void initSurvivalFootprints() { tools.initSurvivalFootprints(); }
  int survivalFootprintCount() const { return tools.survivalFootprintCount(); }
  int clampSurvivalFootprintId(int id) const { return tools.clampSurvivalFootprintId(id); }
  int buildSurvivalFootprintSnapshot() { return tools.buildSurvivalFootprintSnapshot(); }
  void setSelectedFootprint(Player& p, int id) { tools.setSelectedFootprint(p, id); }
  void setSelectedFootprint(int id, int footprintId) { tools.setSelectedFootprint(id, footprintId); }
  int selectedFootprintId(int id) const { return tools.selectedFootprintId(id); }
  int survivalFootprintCellCount(const Player& p) const { return tools.survivalFootprintCellCount(p); }
  void survivalFootprintBounds(const SurvivalFootprint& fp, int cx, int cy, int& x0, int& y0, int& x1, int& y1) const { tools.survivalFootprintBounds(fp, cx, cy, x0, y0, x1, y1); }
  bool footprintHasMaterialAt(int cx, int cy, const SurvivalFootprint& fp) { return tools.footprintHasMaterialAt(cx, cy, fp); }
  int paintDisc(int cx, int cy, int radius, uint8_t material, bool overwrite) { return tools.paintDisc(cx, cy, radius, material, overwrite); }
  int placeMaterialAt(int cx, int cy, int radius, uint8_t mat) { return tools.placeMaterialAt(cx, cy, radius, mat); }
  void registerComponentCells(uint8_t mat, std::unordered_set<int>& cells) { tools.registerComponentCells(mat, cells); }
  int placeMaterialAtCapped(int cx, int cy, int radius, uint8_t mat, int maxCells, const Player* p = nullptr) { return tools.placeMaterialAtCapped(cx, cy, radius, mat, maxCells, p); }
  int placeMaterialAtFootprintCapped(int cx, int cy, const SurvivalFootprint& fp, uint8_t mat, int maxCells, const Player* p = nullptr) { return tools.placeMaterialAtFootprintCapped(cx, cy, fp, mat, maxCells, p); }
  const std::vector<std::pair<int, int>>& discOffsets(int radius) { return tools.discOffsets(radius); }
  void splitComponentsAfterDestroy(std::vector<int>& erasedStructural) { tools.splitComponentsAfterDestroy(erasedStructural); }
  int eraseDisc(int cx, int cy, int radius) { return tools.eraseDisc(cx, cy, radius); }
  int eraseStrokeCells(const std::vector<int>& cells, int x0, int y0, int x1, int y1) { return tools.eraseStrokeCells(cells, x0, y0, x1, y1); }
  int clearMineDamageDisc(int cx, int cy, int radius) { return tools.clearMineDamageDisc(cx, cy, radius); }
  int clearMineDamageFootprint(int cx, int cy, const SurvivalFootprint& fp) { return tools.clearMineDamageFootprint(cx, cy, fp); }
  void clearAllMineDamage() { tools.clearAllMineDamage(); }
  uint32_t mineDurationFor(uint8_t m, uint32_t areaScale) const { return tools.mineDurationFor(m, areaScale); }
  uint32_t minePowerFor(uint8_t m, const Player& miner, bool scaledSpeed, uint32_t speedMultiplier = 1) const { return tools.minePowerFor(m, miner, scaledSpeed, speedMultiplier); }
  double playerMineProgress(int id) { return tools.playerMineProgress(id); }
  int mineDamageDisc(int cx, int cy, int radius, const Player& miner, bool scaledSpeed) { return tools.mineDamageDisc(cx, cy, radius, miner, scaledSpeed); }
  int mineDamageFootprint(int cx, int cy, const SurvivalFootprint& fp, const Player& miner, bool scaledSpeed) { return tools.mineDamageFootprint(cx, cy, fp, miner, scaledSpeed); }
  int addDiscToDraft(std::unordered_set<int>& draft, int cx, int cy, int radius, int yLimit) { return tools.addDiscToDraft(draft, cx, cy, radius, yLimit); }
  int addDiscToDraftCapped(std::unordered_set<int>& d, int cx, int cy, int radius, int yLimit, int maxAdd, const Player* p) { return tools.addDiscToDraftCapped(d, cx, cy, radius, yLimit, maxAdd, p); }
  int addDiscStrokeToDraft(std::unordered_set<int>& d, int x0, int y0, int x1, int y1, int radius, int yLimit) { return tools.addDiscStrokeToDraft(d, x0, y0, x1, y1, radius, yLimit); }
  int addFootprintToDraftCapped(std::unordered_set<int>& d, int cx, int cy, const SurvivalFootprint& fp, int yLimit, int maxAdd, const Player* p) { return tools.addFootprintToDraftCapped(d, cx, cy, fp, yLimit, maxAdd, p); }
  int footprintStrokeSpacing(const SurvivalFootprint& fp) const { return tools.footprintStrokeSpacing(fp); }
  int addFootprintStrokeToDraftCapped(std::unordered_set<int>& d, int x0, int y0, int x1, int y1, const SurvivalFootprint& fp, int yLimit, int maxAdd, const Player* p) { return tools.addFootprintStrokeToDraftCapped(d, x0, y0, x1, y1, fp, yLimit, maxAdd, p); }
  int placeMaterialAtFootprintStrokeCapped(int x0, int y0, int x1, int y1, const SurvivalFootprint& fp, uint8_t mat, int maxCells, const Player* p = nullptr) { return tools.placeMaterialAtFootprintStrokeCapped(x0, y0, x1, y1, fp, mat, maxCells, p); }
  int brushFor(uint8_t m) { return tools.brushFor(m); }
  void finalizeDraft() { tools.finalizeDraft(); }
  bool getSeedOrigin(int cx, int cy, int& x0, int& y0) { return tools.getSeedOrigin(cx, cy, x0, y0); }
  bool canPlaceSeedAt(int x0, int y0) { return tools.canPlaceSeedAt(x0, y0); }
  bool placeSeedAt(int x0, int y0) { return tools.placeSeedAt(x0, y0); }
  bool placeSeedAtTyped(int x0, int y0, uint8_t pt) { return tools.placeSeedAtTyped(x0, y0, pt); }
  bool placeMyceliumSporeAt(int x0, int y0) { return tools.placeMyceliumSporeAt(x0, y0); }
  int effectiveTool() { return tools.effectiveTool(); }
  bool isPaintTool(int t) { return tools.isPaintTool(t); }
  void setTool(int tool) { tools.setTool(tool); }
  void setCreativeMaterial(int kind, int value) { tools.setCreativeMaterial(kind, value); }
  void remapDraftForShift(std::unordered_set<int>& d, int dx, int dy) { tools.remapDraftForShift(d, dx, dy); }
  void remapDraftsForShift(int dx, int dy) { tools.remapDraftsForShift(dx, dy); }
  void remapEmitStrokeForShift(int dx, int dy) { tools.remapEmitStrokeForShift(dx, dy); }
  int updateSeedDraft(int cx, int cy) { return tools.updateSeedDraft(cx, cy); }
  int continueDrafts(int cx, int cy) { return tools.continueDrafts(cx, cy); }
  int pointerDraft(int cx, int cy) { return tools.pointerDraft(cx, cy); }
  int pointerDown(int cx, int cy, int button) { return tools.pointerDown(cx, cy, button); }
  void pointerButtons(int buttons) { tools.pointerButtons(buttons); }
  int pointerUp(int button) { return tools.pointerUp(button); }
  void emitToolAt(int cx, int cy) { tools.emitToolAt(cx, cy); }
  void emitStrokeLayer(int x0, int y0, int x1, int y1, bool toBg) { tools.emitStrokeLayer(x0, y0, x1, y1, toBg); }
  void emitHeldTool(int cx, int cy, double now, bool inside, bool drawMode) { tools.emitHeldTool(cx, cy, now, inside, drawMode); }
  int applyTool(int cx, int cy, double now, bool inside, bool drawMode) { return tools.applyTool(cx, cy, now, inside, drawMode); }
