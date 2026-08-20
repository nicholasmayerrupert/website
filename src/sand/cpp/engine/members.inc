  // The foreground and background are independent simulations. Each Layer owns
  // its cells, components, bodies, chunk store, and dirty/render buffers; shared
  // systems such as camera, networking, players, tools, and timing stay on Engine.
  int cols, rows, chunkCols, chunkRows;
  EngineStorageRole storageRole;
  Layer fg, bg;       // the two simulations
  Layer* L = &fg;     // active layer

  inline Layer& layer(bool background) { return background ? bg : fg; }
  inline const Layer& layer(bool background) const { return background ? bg : fg; }
  inline int activeLayerIndex() const { return L == &fg ? 0 : (L == &bg ? 1 : -1); }

  // Hot coordinator paths address the active layer through L->. New temporary
  // switches should use ActiveLayerScope so early returns restore the caller's
  // layer. Direct useLayer remains for top-level phase transitions whose active
  // layer deliberately outlives the current scope.
  inline void useLayer(Layer* lay) { L = lay; }
  struct ActiveLayerScope {
    Engine& engine;
    Layer* previous;
    inline ActiveLayerScope(Engine& owner, Layer* layer)
        : engine(owner), previous(owner.L) { owner.L = layer; }
    inline ActiveLayerScope(Engine& owner, Layer* layer, Layer* restoreLayer)
        : engine(owner), previous(restoreLayer) { owner.L = layer; }
    inline ~ActiveLayerScope() { engine.L = previous; }
    ActiveLayerScope(const ActiveLayerScope&) = delete;
    ActiveLayerScope& operator=(const ActiveLayerScope&) = delete;
  };
  bool bodySolidifiesToComponents(Body* b) {
    if (b->cellMaterials.empty()) return isComponentMaterial(b->material);
    bool hasMaterial = false;
    for (int i = 0; i < (int)b->occ.size(); i++) {
      if (!b->occ[i]) continue;
      uint8_t own = b->cellMaterials[i];
      if (own != EMPTY) {
        hasMaterial = true;
        if (!isComponentMaterial(own)) return false;
      }
      if (b->jointRole) {
        uint8_t peer = b->jointPeerMaterials[i];
        if (peer != EMPTY) {
          hasMaterial = true;
          if (!isComponentMaterial(peer)) return false;
        }
      }
    }
    return hasMaterial;
  }
  bool bodyContainsMaterial(Body* b, uint8_t material) {
    if (b->cellMaterials.empty()) return b->material == material;
    for (int i = 0; i < (int)b->occ.size(); i++) {
      if (!b->occ[i]) continue;
      if (b->cellMaterials[i] == material
          || (b->jointRole && b->jointPeerMaterials[i] == material)) return true;
    }
    return false;
  }
  uint8_t bodyMaterialWithExplosiveProfile(Body* b, uint8_t profile) {
    if (b->cellMaterials.empty())
      return explosiveProfile(b->material) == profile ? b->material : EMPTY;
    for (int i = 0; i < (int)b->occ.size(); i++) {
      if (!b->occ[i]) continue;
      uint8_t material = b->cellMaterials[i];
      if (explosiveProfile(material) == profile) return material;
      if (b->jointRole) {
        material = b->jointPeerMaterials[i];
        if (explosiveProfile(material) == profile) return material;
      }
    }
    return EMPTY;
  }
  bool bodyContainsExplosiveProfile(Body* b, uint8_t profile) {
    return bodyMaterialWithExplosiveProfile(b, profile) != EMPTY;
  }
  bool bodyContainsGrowthOrigin(Body* b) {
    if (b->cellMaterials.empty())
      return isSeedMaterial(b->material) || b->material == MYCELIUM_SPORE;
    for (int i = 0; i < (int)b->occ.size(); i++) {
      if (!b->occ[i]) continue;
      if (isSeedMaterial(b->cellMaterials[i])
          || b->cellMaterials[i] == MYCELIUM_SPORE
          || (b->jointRole && (isSeedMaterial(b->jointPeerMaterials[i])
              || b->jointPeerMaterials[i] == MYCELIUM_SPORE))) return true;
    }
    return false;
  }
  bool layerBakeRetryDeferred(Layer* lay) {
    if (!lay->pendingDetonations.empty()) return true;
    for (Body* b : lay->bodies)
      if (bodyContainsExplosiveProfile(b, XP_TNT_FUSE)) return true;
    return false;
  }
  bool bodyNeedsBakeTick(Body* b) {
    if (b->jointRole == 2 || b->awake || b->bakeBlockedByBody
        || !bodySolidifiesToComponents(b))
      return false;
    // Keep one transition tick after the last stability sample so a quiet
    // layer reaches bakeRestingBodies() instead of going inactive at the gate.
    bool rasterPending = b->bakeRasterStableTicks <= R_BAKE_RASTER_TICKS;
    if (b->jointRole == 1 && b->jointPeer)
      rasterPending = rasterPending
        || b->jointPeer->bakeRasterStableTicks <= R_BAKE_RASTER_TICKS;
    return rasterPending;
  }
  // Non-consuming check: does a layer have scheduled simulation work?
  bool layerActive(Layer* lay) {
    if (!lay->pendingDetonations.empty()) return true;
    bool bakeRetryDeferred = layerBakeRetryDeferred(lay);
    for (Body* b : lay->bodies)
      if (b->jointRole != 2
          && (b->awake || b->fuseTicks > 0
              || (!bakeRetryDeferred && bodyNeedsBakeTick(b))))
        return true;
    for (int y = 0; y < rows; y++)
      if (!lay->rowMarkSpans[y].empty()
          || !lay->simOnlyRowMarkSpans[y].empty())
        return true;
    return false;
  }

  int stepSerial = 0, tick = 0, actorTick = 0, worldShiftCount = 0;
  // True when the scheduler advances only a sub-rectangle of the loaded world.
  // Destructive topology uses this to avoid waking off-focus structural masses.
  bool simulationActivityLimited = false;
  int nextBakedAssemblyId = 1;
  PlanetId planetId;
  double gravityScale;
  // Cell materials can only move in whole-cell increments. A fixed-point
  // cadence turns fractional planetary gravity into deterministic settle turns
  // without consuming the shared simulation RNG. Loose cells use stable
  // world-column phase offsets so a broad fall is distributed across frames;
  // gravityCellStep retains the shared pulse for whole-domain maintenance.
  static constexpr uint32_t GRAVITY_CADENCE_ONE = 1u << 16;
  uint32_t gravityCadenceStep = GRAVITY_CADENCE_ONE;
  uint32_t gravityCadencePhase = 0;
  bool gravityCellStep = true;
  // Last-step volume counters (accumulated across both layers in beginStepDirty /
  // end-of-step component scan). Zeroed at the start of each step().
  int perfDirtyChunks = 0, perfDirtyRows = 0, perfDirtyCells = 0;
  int perfComponentCount = 0, perfComponentCellCount = 0, perfCrossBondCount = 0;
  double perfStepMs = 0, perfActorMs = 0;
  // Present-path sub-phase timers (gl.inc glRenderFrame): the full-buffer lighting
  // solve, the windowed pixel fill, and the windowed texture upload. Render-only.
  double perfLightMs = 0, perfFillMs = 0, perfUploadMs = 0;
  double perfShiftSave = 0, perfShiftBuffers = 0, perfShiftTranslate = 0;
  double perfShiftRegister = 0, perfShiftFill = 0;
  // Predictive worldgen prefetch (worldgen.inc): amortize the shift's fillRect over
  // the off-screen frames before the boundary is crossed. Generates the upcoming
  // stream-in band into the tileStore a slice per frame so the shift can skip
  // fillRect. pfGrid is a scratch band buffer; the stage machine spans fg then bg.
  enum { PF_FG_TERRAIN = 0, PF_BG_TERRAIN = 1, PF_DONE = 2 };
  std::vector<uint8_t> pfGrid;
  int pfDx = 0, pfDy = 0, pfStage = PF_DONE, pfCursor = 0;
  int pfEx0 = 0, pfEy0 = 0, pfEw = 0, pfEh = 0; // entering band rect being prefetched
  int shiftFillHit = 0, shiftFillMiss = 0;      // per-layer shift: band cached vs fillRect fallback
  // Fine step-phase timers (ms). Dual-layer: ACCUMULATED across both stepLayer
  // calls (+ joint/cross at step level). Zeroed at the start of each step().
  double perfGroundingMs = 0;            // per-layer ensureGrounded + joint groundLayerBase
  double perfForcePrepareMs = 0;          // emitter/bin/nearest-field preparation, excluding wake scans
  double perfForceWakeMs = 0;             // affected-bin loose/body wake scans
  double perfCrossLayerGroundingMs = 0;  // joint bond scan + UF after base floods
  double perfComponentIndexMs = 0;       // indexComponents() (inside grounding)
  double perfAssemblyUnionMs = 0;        // moveRigidAssemblies + cross-layer assembly move
  double perfCarryMs = 0;
  double perfBodyMs = 0;                 // free rigid bodies (moveBodies)
  double perfSandMs = 0;                 // density interface + settleSand
  double perfLiquidMs = 0;               // ordinary liquid movement
  double perfGasMs = 0;                  // fire/steam rise
  double perfReactMs = 0;
  double perfTailMs = 0;                 // swap + liquid density/relax/level/sinks
  double perfLiquidRelaxMs = 0;          // post-swap liquid gap relaxation
  double perfLiquidSurfaceMs = 0;        // post-swap free-surface leveling
  double perfLayersMs = 0;               // wall time of both stepLayer() calls
  double perfCrossMs = 0;                // post-layer joint refresh + cross react/transfer
  bool sinksEnabled;
  uint32_t rngState;
  // Cross-layer transfer only runs once the background is "real" (has generated
  // terrain or placed material). An empty/untouched background does not interact,
  // so a pure single-layer scene (e.g. the headless tests) is byte-identical.
  bool bgEnabled = false;
  // When bgEnabled, step() runs ONE joint grounding flood over both layers up
  // front (computeGroundedBoth) so solids support solids across layers; this flag
  // tells each stepLayer() to skip its own per-layer computeGrounded() (the first
  // one — moveBodies still re-derives per-layer grounding for free bodies/sand).
  std::vector<int> acidErasedStructural, reactionErasedPlant; // reusable reaction scratch (avoids heap allocs every active step)
  std::vector<std::pair<int, int>> bodyFrozenIceScratch;
  std::vector<int> activeDensityCells, activeSandCells, activeLiquidCells, activeGasCells, activeGasRow;
  struct StoredItem { Item value; double wx = 0, wy = 0; };
  struct StoredProjectile { Projectile value; double wx = 0, wy = 0; };
  std::unordered_map<int64_t, std::vector<StoredItem>> itemStore;
  std::unordered_map<int64_t, std::vector<StoredProjectile>> projectileStore;
  int storedItemCount = 0, storedProjectileCount = 0;
  std::vector<std::pair<int32_t, int32_t>> activeSpanUnionScratch;
  std::vector<int64_t> acidCrossPairs;             // unique touched joint pairs, checked once after an acid batch
  std::vector<int> surfAbsScratch;                 // reusable per-band surface-height cache for fillTerrain
  std::vector<int> iceMeltedScratch;               // reusable per-call scratch for applyIce
  std::vector<int> reactionSnowMelt;               // reusable per-call scratch for applyReactions (snow melted by fire -> water)
  // ---- players (Terraria-like characters; physics in player.inc) ----
  // ---- dropped items + particles (entities; physics in items.inc) ----
  bool survivalInventory = false;         // survival mining->drops->inventory (set from JS)
  bool creaturesEnabled = false;          // advance existing creature actors
  bool creatureNaturalSpawning = false;   // survival or explicit /fps population mode
  int playerActionCount = 0;         // total player tool actions fired (debug/test)
  inline double rand() {
    rngState = (rngState + 0x6d2b79f5u);
    uint32_t a = rngState;
    uint32_t t = a ^ (a >> 15); t = t * (1u | a);
    uint32_t t2 = t ^ (t >> 7); t = (t + (t2 * (61u | t))) ^ t;
    return (double)(t ^ (t >> 14)) / 4294967296.0;
  }
  static inline PlanetId normalizedPlanet(int id) {
    return planetDef(id).id;
  }
  static inline double defaultGravityForPlanet(PlanetId id) {
    return planetDef(id).gravity;
  }
  void setGravityScale(double scale) {
    if (!std::isfinite(scale)) scale = defaultGravityForPlanet(planetId);
    gravityScale = std::fmax(0.05, std::fmin(1.0, scale));
    gravityCadenceStep = gravityScale >= 1.0
      ? GRAVITY_CADENCE_ONE
      : (uint32_t)std::lround(gravityScale * GRAVITY_CADENCE_ONE);
    gravityCadencePhase = 0;
    gravityCellStep = true;
  }
  inline double scaledGravity(double earthGravity) const {
    return gravityScale == 1.0 ? earthGravity : earthGravity * gravityScale;
  }
  inline bool gravityCellStepAt(int x) const {
    if (gravityCadenceStep >= GRAVITY_CADENCE_ONE) return true;
    uint32_t column = (uint32_t)L->worldOffsetX + (uint32_t)x;
    column ^= L->worldSeed ^ 0xA511E9B3u;
    column ^= column >> 16;
    column *= 0x7feb352du;
    column ^= column >> 15;
    column *= 0x846ca68bu;
    column ^= column >> 16;
    uint32_t phase = (gravityCadencePhase
                    + (column & (GRAVITY_CADENCE_ONE - 1)))
                   & (GRAVITY_CADENCE_ONE - 1);
    return phase < gravityCadenceStep;
  }
  void advanceGravityCadence() {
    if (gravityCadenceStep >= GRAVITY_CADENCE_ONE) {
      gravityCellStep = true;
      return;
    }
    uint32_t next = gravityCadencePhase + gravityCadenceStep;
    gravityCellStep = next >= GRAVITY_CADENCE_ONE;
    gravityCadencePhase = gravityCellStep ? next - GRAVITY_CADENCE_ONE : next;
  }
  inline int I(int x, int y) { return y * cols + x; }
  inline double liquidVelocityX(uint32_t packed) {
    int component = packed & 0x7fff;
    if (component & 0x4000) component -= 0x8000;
    return (double)component / 4096.0;
  }
  inline double liquidVelocityY(uint32_t packed) {
    int component = (packed >> 15) & 0x1ffff;
    if (component & 0x10000) component -= 0x20000;
    return (double)component / 16384.0;
  }
  inline uint32_t packedLiquidVelocity(double vx, double vy) {
    long qx = std::max(-16383L, std::min(16383L, std::lround(vx * 4096.0)));
    long qy = std::max(-65535L, std::min(65535L, std::lround(vy * 16384.0)));
    return (uint32_t)((qx & 0x7fff) | ((qy & 0x1ffff) << 15));
  }


  Engine(int c, int r, uint32_t seed, bool sinks, EngineStorageRole role = ESR_FULL,
         int planet = PL_EARTH)
      : cols(c), rows(r), storageRole(role), planetId(normalizedPlanet(planet)),
        gravityScale(defaultGravityForPlanet(planetId)), sinksEnabled(sinks), rngState(seed) {
    setGravityScale(gravityScale);
    chunkCols = (cols + CHUNK_SIZE - 1) / CHUNK_SIZE;
    chunkRows = (rows + CHUNK_SIZE - 1) / CHUNK_SIZE;
    fg.alloc(cols, rows, chunkCols, chunkRows, storageRole);
    bg.alloc(cols, rows, chunkCols, chunkRows, storageRole);
    if (storageRole != ESR_PRESENTATION) {
      comps.prepareAssemblyScratch((size_t)cols * rows);
    }
    useLayer(&fg);
    renderer.init(seed); // render-only RNG + shade/noise tables (separate stream)
    tools.initSurvivalFootprints();
  }
  ~Engine() { glp.glDestroy(); }

  // ---- material predicates ----
  // Material id is exact identity. MAT_CLASS is the broad gameplay/physics
  // bucket, MAT_FLAGS are extra traits, and K_COMPONENT identifies static/body-
  // bakeable structural material. Adding a material that reuses existing physics
  // should need only a schema entry.
  inline bool isEmptyMaterial(uint8_t m) { return m == EMPTY || MAT_CLASS[m] == MC_NONE; }
  inline bool isGasMaterial(uint8_t m) { return MAT_CLASS[m] == MC_GAS; }
  inline bool canGasRiseThrough(uint8_t rising, uint8_t upper) {
    return isGasMaterial(rising) && isGasMaterial(upper) && DENSITY[rising] < DENSITY[upper];
  }
  inline bool isLiquidMaterial(uint8_t m) { return MAT_CLASS[m] == MC_LIQUID; }
  inline bool isLooseSolidMaterial(uint8_t m) { return MAT_CLASS[m] == MC_SOLID; }
  inline bool isRigidMaterialClass(uint8_t m) { return MAT_CLASS[m] == MC_RIGID; }
  inline bool isComponentMaterial(uint8_t m) { return MAT_KIND[m] == K_COMPONENT; }
  inline bool isIceMaterial(uint8_t m) { return m == ICE; }
  inline bool hasRigidFlag(uint8_t m) { return MAT_FLAGS[m] & MF_RIGID; }
  inline bool isPlantMaterial(uint8_t m) { return MAT_FLAGS[m] & MF_PLANTFAMILY; }
  inline bool isDissolvable(uint8_t m) { return MAT_FLAGS[m] & MF_DISSOLVABLE; }
  inline bool isFlammable(uint8_t m) { return MAT_FLAGS[m] & MF_FLAMMABLE; }
  inline bool isSpawnHazard(uint8_t m) { return MAT_FLAGS[m] & MF_SPAWNHAZARD; }
  inline bool isHeatSource(uint8_t m) { return MAT_FLAGS[m] & MF_HEATSOURCE; }
  inline uint8_t explosiveProfile(uint8_t m) { return MAT_EXPLOSIVE_PROFILE[m]; }
  inline uint8_t materialReactionProfile(uint8_t m) {
    return MAT_REACTION_PROFILE[m];
  }
  inline bool hasMaterialReactionProfile(uint8_t m, uint8_t profile) {
    return materialReactionProfile(m) == profile;
  }
  inline bool isHeatSensitiveExplosive(uint8_t m) {
    return MAT_HEAT_SENSITIVE_EXPLOSIVE[m] != 0;
  }
  inline bool isFuseExplosive(uint8_t m) {
    return explosiveProfile(m) == XP_TNT_FUSE;
  }
  inline bool isPocketExplosive(uint8_t m) {
    return explosiveProfile(m) == XP_METHANE_POCKET;
  }
  inline bool isPlayerContactHazard(uint8_t m) {
    return CONTACT_HAZARD_PLAYER_DAMAGE[MAT_CONTACT_HAZARD_PROFILE[m]] > 0;
  }
  inline bool isLavaQuencher(uint8_t m) { return MAT_FLAGS[m] & MF_QUENCHESLAVA; }
  // Liquids that fill 1-cell gaps in a resting layer (relaxLiquidGaps).
  // LAVA still omits the flag (slow/thick); BRINE has it so submerged/free
  // brine pools coalesce and go inert instead of shimmering on ragged holes.
  inline bool relaxesGaps(uint8_t m) { return MAT_FLAGS[m] & MF_RELAXESGAPS; }
  inline bool isBearingMaterial(uint8_t m) { return MAT_FLAGS[m] & MF_BEARING; }
  inline bool isBlastDamageable(uint8_t m) { return !isEmptyMaterial(m) && !isGasMaterial(m); }
  inline bool isLooseMedium(uint8_t m) { return isLiquidMaterial(m) || isLooseSolidMaterial(m); }
  inline bool persistentLooseState(uint8_t m) { return isLooseMedium(m); }
  inline bool persistentLiquidState(uint8_t m) { return isLiquidMaterial(m); }
  inline bool persistentReactionAgeState(uint8_t m) {
    return MAT_REACTION_AGE_ENABLED[m] != 0;
  }
  inline bool isBuoyantMedium(uint8_t m) { return isLooseMedium(m); }
  inline bool isBlockingForPlayer(uint8_t m) { return !isEmptyMaterial(m) && !isGasMaterial(m) && !isLiquidMaterial(m); }
  inline bool isMineable(uint8_t m) { return !isEmptyMaterial(m) && !isGasMaterial(m); }
  // EVERY site that clears a component cell from the grid (erase, mine, acid)
  // must feed it to the unified component split path, or the component keeps an
  // invisible cell that still collides/grounds.
  // Flora-type material classification: which plant-family materials act as a tree
  // seed, trunk, or foliage, and the species/material mapping. Species-specific
  // cells are authoritative when components are reconstructed from the grid.
  // DRIFTWOOD is neither, so it never acts as a growth source.
  inline bool isSeedMaterial(uint8_t m) { return MAT_IS_PLANT_SEED[m] != 0; }
  inline bool componentHasSeed(const Layer& lay, const Comp& component) {
    for (int k : component.cells) if (isSeedMaterial(lay.grid[k])) return true;
    return false;
  }
  inline bool isPlantWood(uint8_t m) { return MAT_FLAGS[m] & MF_PLANTWOOD; }
  inline bool isPlantLeaf(uint8_t m) { return MAT_FLAGS[m] & MF_PLANTLEAF; }
  inline uint8_t validPlantType(uint8_t pt) { return pt < PLANT_SPECIES_COUNT ? pt : PT_STANDARD; }
  inline uint8_t plantSeedMat(uint8_t pt) { return PLANT_SEED_MATERIAL[validPlantType(pt)]; }
  inline uint8_t plantWoodMat(uint8_t pt) { return PLANT_WOOD_MATERIAL[validPlantType(pt)]; }
  inline uint8_t plantLeafMat(uint8_t pt) { return PLANT_LEAF_MATERIAL[validPlantType(pt)]; }
  inline bool materialEncodesPlantType(uint8_t m) { return MAT_PLANT_SPECIES[m] != NO_PLANT_SPECIES; }
  inline uint8_t plantTypeFromMaterial(uint8_t m) { uint8_t pt = MAT_PLANT_SPECIES[m]; return pt != NO_PLANT_SPECIES ? pt : PT_STANDARD; }
  inline void canonicalizeSeed(uint8_t& material, uint8_t& plantType) {
    if (!isSeedMaterial(material)) return;
    uint8_t encoded = MAT_PLANT_SPECIES[material];
    if (encoded != NO_PLANT_SPECIES) plantType = encoded;
    else material = plantSeedMat(plantType);
  }
  inline bool isMyceliumMaterial(uint8_t m) { return m == MYCELIUM || m == MYCELIUM_SPORE; }
  inline bool componentDisplaceable(uint8_t m) {
    return m == EMPTY || isLooseMedium(m) || isGasMaterial(m);
  }
  inline bool isInBounds(int x, int y) { return x > 0 && x < cols - 1 && y > 0 && y < rows; }

  // ===== BODY-MATERIAL INVARIANT (read this once; it explains the whole rewrite) =====
  // A free rigid body stamps its REAL material into the L->grid (moveBodies), so a stone
  // body's cells literally read STONE — they render, mine, and carry durability as
  // stone for free. `L->bodyOwner[k] != -1`, i.e. isBodyCell(k), is what distinguishes a
  // body-owned cell from identical-looking STATIC terrain.
  //   * Anything that just READS a cell's appearance/material (render, mining drops,
  //     durability) needs no change — material-identity is automatic.
  //   * Anything that builds or reacts with STATIC terrain (the grounding flood,
  //     component registration, the acid/lava/fire/ice/salt reactions, the world-shift
  //     clear) MUST skip body cells via isBodyCell(k). Each such site carries the
  //     comment `// body-material invariant: skip free-body cells (see isBodyCell)` so
  //     the whole pattern is greppable. Body-cell reactions stay owned by erodeBodies.
  //   * A detached structural assembly may carry a per-cell material map.
  //     Component bodies bake into isolated, assembly-tagged material
  //     partitions after a stable raster interval and real static support.
  //     Growth origins also bake at stable fluid equilibrium so their cellular
  //     growth can begin; the resulting component is re-evaluated dynamically.
  //     RIGID bodies and ordinary bodies floating on liquid remain free.
  // Fuse-profile explosives are body-agnostic and detonate whether static or
  // body-owned.
  inline bool isBodyCell(int k) { return L->bodyOwner[k] != -1; }

  inline void mergeRowSpan(
      std::vector<std::pair<int32_t, int32_t>>& spans, int x0, int x1,
      int mergeGap = 0) {
    if (x1 < x0) return;
    if (spans.empty()) {
      spans.push_back({(int32_t)x0, (int32_t)x1});
      return;
    }
    if (spans.back().second + mergeGap + 1 < x0) {
      spans.push_back({(int32_t)x0, (int32_t)x1});
      return;
    }
    auto it = std::lower_bound(
      spans.begin(), spans.end(), x0,
      [mergeGap](const auto& span, int x) {
        return span.second + mergeGap + 1 < x;
      });
    if (it == spans.end()) {
      spans.push_back({(int32_t)x0, (int32_t)x1});
      return;
    }
    if (it->first > x1 + mergeGap + 1) {
      spans.insert(it, {(int32_t)x0, (int32_t)x1});
      return;
    }
    x0 = imin(x0, (int)it->first);
    x1 = imax(x1, (int)it->second);
    auto end = it + 1;
    while (end != spans.end() && end->first <= x1 + mergeGap + 1) {
      x1 = imax(x1, (int)end->second);
      ++end;
    }
    *it = {(int32_t)x0, (int32_t)x1};
    spans.erase(it + 1, end);
  }

  inline void markLayerRowSpan(Layer* layer, int y, int x0, int x1) {
    if (y < 0 || y >= rows) return;
    x0 = imax(0, x0); x1 = imin(cols - 1, x1);
    if (x1 < x0) return;
    mergeRowSpan(layer->rowMarkSpans[y], x0, x1);
  }

  inline void markLayerCell(Layer* layer, int k) {
    if (k < 0 || k >= cols * rows) return;
    int y = k / cols;
    markLayerRowSpan(layer, y, k - y * cols, k - y * cols);
  }

  inline void markLayerSimRowSpan(
      Layer* layer, int y, int x0, int x1) {
    if (y < 0 || y >= rows) return;
    x0 = imax(0, x0); x1 = imin(cols - 1, x1);
    if (x1 < x0) return;
    mergeRowSpan(layer->simOnlyRowMarkSpans[y], x0, x1);
  }

  inline void markLayerSimCell(Layer* layer, int k) {
    if (k < 0 || k >= cols * rows) return;
    int y = k / cols;
    markLayerSimRowSpan(layer, y, k - y * cols, k - y * cols);
  }

  inline void activateRowSpanNow(int y, int x0, int x1) {
    if (y < 0 || y >= rows) return;
    x0 = imax(0, x0); x1 = imin(cols - 1, x1);
    if (x1 < x0) return;
    // Surface flow can inspect this far along a connected liquid row. Treat
    // nearby wakes as one causal region while retaining genuinely distant spans.
    mergeRowSpan(L->activeRowSpans[y], x0, x1, LIQUID_SURFACE_LOOKAHEAD);
  }

  template <typename Fn>
  inline void forEachActiveSpan(int y, int clampMin, int clampMax,
                                bool leftToRight, Fn&& fn) {
    const auto& spans = L->activeRowSpans[y];
    if (leftToRight) {
      for (const auto& span : spans) {
        int x0 = imax(clampMin, (int)span.first);
        int x1 = imin(clampMax, (int)span.second);
        if (x1 >= x0) fn(x0, x1);
      }
    } else {
      for (auto it = spans.rbegin(); it != spans.rend(); ++it) {
        int x0 = imax(clampMin, (int)it->first);
        int x1 = imin(clampMax, (int)it->second);
        if (x1 >= x0) fn(x0, x1);
      }
    }
  }

  inline bool activeSpanContains(const Layer* layer, int y, int x) const {
    const auto& spans = layer->activeRowSpans[y];
    auto it = std::lower_bound(
      spans.begin(), spans.end(), x,
      [](const auto& span, int cellX) { return span.second < cellX; });
    return it != spans.end() && it->first <= x;
  }

  template <typename Fn>
  inline void forEachActiveUnionSpan(Layer* a, bool useA, Layer* b, bool useB,
                                     int y, int clampMin, int clampMax,
                                     bool leftToRight, Fn&& fn) {
    activeSpanUnionScratch.clear();
    const auto& spansA = a->activeRowSpans[y];
    const auto& spansB = b->activeRowSpans[y];
    const std::vector<std::pair<int32_t, int32_t>>* unionSpans =
      &activeSpanUnionScratch;
    if (useA && !useB) unionSpans = &spansA;
    else if (useB && !useA) unionSpans = &spansB;
    size_t indexA = 0, indexB = 0;
    auto append = [&](const std::pair<int32_t, int32_t>& span) {
      if (!activeSpanUnionScratch.empty()
          && span.first <= activeSpanUnionScratch.back().second + 1) {
        activeSpanUnionScratch.back().second = imax(
          activeSpanUnionScratch.back().second, span.second);
      } else {
        activeSpanUnionScratch.push_back(span);
      }
    };
    if (useA && useB) {
      while (indexA < spansA.size() || indexB < spansB.size()) {
        bool takeA = indexA < spansA.size()
          && (indexB >= spansB.size()
              || spansA[indexA].first <= spansB[indexB].first);
        append(takeA ? spansA[indexA++] : spansB[indexB++]);
      }
    }
    if (leftToRight) {
      for (const auto& span : *unionSpans) {
        int x0 = imax(clampMin, (int)span.first);
        int x1 = imin(clampMax, (int)span.second);
        if (x1 >= x0) fn(x0, x1);
      }
    } else {
      for (auto it = unionSpans->rbegin();
           it != unionSpans->rend(); ++it) {
        int x0 = imax(clampMin, (int)it->first);
        int x1 = imin(clampMax, (int)it->second);
        if (x1 >= x0) fn(x0, x1);
      }
    }
  }

  void ensureComponentRegistries() {
    if (!L->componentRegistryDirty) return;
    L->growingPlantComponents.clear();
    L->myceliumComponents.clear();
    L->iceComponents.clear();
    for (int i = 0; i < (int)L->components.size(); i++) {
      Comp& component = L->components[i];
      if (component.cells.empty()) continue;
      bool hasIce = false, hasMyceliumSpore = false, hasPlant = false;
      for (int k : component.cells) {
        uint8_t material = L->grid[k];
        hasIce = hasIce || material == ICE;
        hasMyceliumSpore = hasMyceliumSpore || material == MYCELIUM_SPORE;
        hasPlant = hasPlant || isPlantMaterial(material);
      }
      if (hasIce) L->iceComponents.push_back(i);
      if (hasMyceliumSpore) {
        L->myceliumComponents.push_back(i);
      } else if (component.growing && hasPlant) {
        L->growingPlantComponents.push_back(i);
      }
    }
    L->componentRegistryDirty = false;
  }

  inline void invalidateComponentIndexPatches(Layer* layer) {
    layer->componentIndexExact = false;
    layer->componentIndexPatchOnly = false;
    layer->componentIndexPatches.clear();
  }

  inline void noteComponentIndexAddition(int componentIndex, int k) {
    if (L->componentIndexExact && componentIndex >= 0
        && componentIndex < (int)L->components.size()
        && k >= 0 && k < cols * rows)
      L->cellComp[k] = componentIndex;
    if (!L->componentIndexPatchOnly) {
      if (L->groundDirty || L->groundContentDirty || !L->groundBaseValid
          || L->groundBaseFlags.size() != L->components.size()) {
        L->groundDirty = true;
        return;
      }
      L->componentIndexPatchOnly = true;
    }
    L->componentIndexPatches.push_back({componentIndex, k});
    L->groundDirty = true;
  }

  inline void refreshMobileComponentRegistry(Layer* layer) {
    layer->mobileComponents.clear();
    for (int i = 0; i < (int)layer->components.size(); i++) {
      Comp& component = layer->components[i];
      if (!component.grounded)
        layer->mobileComponents.push_back(i);
    }
  }


#ifdef SAND_INVARIANT_CHECKS
  // Dev-build post-step validator (npm run build:sand -- --dev; NEVER commit a dev
  // artifact). Aborts loudly when a structural invariant is broken instead of
  // letting it surface later as flicker/invisible collision.
  //   A. BODY-MATERIAL: a body-owned cell (L->bodyOwner[k] != -1) must hold a
  //      non-EMPTY material (the body stamps its real material into the L->grid).
  //   B. COMPONENT-CELL: every component cell must hold a component material,
  //      must not be body-owned, and must appear in exactly one component
  //      (comp.cells dedup-by-construction).
  //   C. STATIC-MEMBERSHIP: every non-body component material belongs to a
  //      component; no structural pixel can survive as an unowned grid orphan.
  //   D. BODY-COLLISION: collision rectangles cover each occupied body cell
  //      exactly once, and their stored face spans match original-mask exposure.
  void validateInvariants(const char* where) {
    auto fail = [&](const char* what, int k, int mat, int extra) {
      char buf[240];
      snprintf(buf, sizeof(buf),
        "SAND INVARIANT VIOLATION [%s] %s tick=%d active=%s at k=%d (x=%d,y=%d) mat=%d extra=%d",
        where, what, tick, L == &bg ? "bg" : "fg", k, k % cols,
        k / cols, mat, extra);
      emscripten_console_error(buf);
      abort();
    };
    auto failBody = [&](const char* what, Body* body, int local, int extra) {
      char buf[220];
      snprintf(buf, sizeof(buf),
        "SAND INVARIANT VIOLATION [%s] %s body=%d local=%d (x=%d,y=%d) extra=%d",
        where, what, body->id, local,
        local >= 0 ? local % body->w : -1,
        local >= 0 ? local / body->w : -1, extra);
      emscripten_console_error(buf);
      abort();
    };
    std::unordered_set<Body*> liveFg(fg.bodies.begin(), fg.bodies.end());
    std::unordered_set<Body*> liveBg(bg.bodies.begin(), bg.bodies.end());
    auto checkLayer = [&](Layer& lay, bool background) {
      size_t n = (size_t)cols * rows;
#define SAND_CHECK_PERSISTENT_CELL_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
      if (lay.name.current) \
        for (size_t k = 0; k < n; k++) \
          if (lay.name.current[k] != (type)(empty) && !accepts(lay.grid[k])) \
            fail(#name " current state rejects material", (int)k, lay.grid[k], 0); \
      if (lay.name.next) \
        for (size_t k = 0; k < n; k++) \
          if (lay.name.next[k] != (type)(empty) && !accepts(lay.next[k])) \
            fail(#name " next state rejects material", (int)k, lay.next[k], 0);
      SAND_PERSISTENT_CELL_CHANNELS(SAND_CHECK_PERSISTENT_CELL_CHANNEL)
#undef SAND_CHECK_PERSISTENT_CELL_CHANNEL
      std::unordered_map<int, Body*> bodiesById;
      bodiesById.reserve(lay.bodies.size() * 2);
      for (Body* body : lay.bodies) {
        if (!body) fail("null body in layer roster", 0, -1, 0);
        if (!bodiesById.emplace(body->id, body).second)
          failBody("duplicate live body id", body, -1, body->id);
        if ((!background && body->jointRole == 2)
            || (background && body->jointRole == 1))
          failBody("joint role is in the wrong layer", body, -1, background);
        if ((body->jointRole == 0) != (body->jointPeer == nullptr))
          failBody("joint role/peer disagreement", body, -1, body->jointRole);
        bool markedPassive = lay.passiveBodyIds.count(body->id) != 0;
        if (markedPassive != (body->jointRole == 2))
          failBody("passive body id roster mismatch", body, -1, markedPassive);
      }
      for (int id : lay.passiveBodyIds)
        if (!bodiesById.count(id))
          fail("passive body id has no live body", 0, -1, id);

      std::vector<uint8_t> listed(n, 0);
      auto checkBodyCells = [&](const std::vector<int>& cells, uint8_t kind) {
        for (int k : cells) {
          if (k < 0 || k >= (int)n) fail("body cell list index out of bounds", k, -1, kind);
          if (listed[k]) fail("body cell appears more than once", k, lay.grid[k], listed[k]);
          listed[k] = kind;
          auto found = bodiesById.find(lay.bodyOwner[k]);
          if (found == bodiesById.end())
            fail("listed body cell has no live owner", k, lay.grid[k], lay.bodyOwner[k]);
          if ((found->second->jointRole == 2) != (kind == 2))
            fail("body cell is in the wrong active/passive list", k, lay.grid[k], found->second->jointRole);
        }
      };
      checkBodyCells(lay.bodyCells, 1);
      checkBodyCells(lay.passiveBodyCells, 2);
      for (size_t k = 0; k < n; k++) if (lay.bodyOwner[k] != -1) {
        if (lay.grid[k] == EMPTY)
          fail("body-owned cell is EMPTY", (int)k, 0, lay.bodyOwner[k]);
        auto found = bodiesById.find(lay.bodyOwner[k]);
        if (found == bodiesById.end())
          fail("body-owned cell has no live body", (int)k, lay.grid[k], lay.bodyOwner[k]);
        uint8_t expected = found->second->jointRole == 2 ? 2 : 1;
        if (listed[k] != expected)
          fail("body-owned cell missing from body cell roster", (int)k, lay.grid[k], listed[k]);
      }
      std::vector<uint8_t> componentListed(n, 0);
      for (int componentIndex = 0;
           componentIndex < (int)lay.components.size(); componentIndex++) {
        Comp& component = lay.components[componentIndex];
        for (int k : component.cells) {
          if (k < 0 || k >= (int)n)
            fail("component cell out of bounds", k, -1, 0);
          uint8_t material = lay.grid[k];
          if (!isComponentMaterial(material))
            fail("component cell has non-component material", k, material, 0);
          if (lay.bodyOwner[k] != -1)
            fail("component cell is body-owned", k, material, lay.bodyOwner[k]);
          if (lay.componentIndexExact && lay.cellComp[k] != componentIndex)
            fail("component cell index disagrees with membership", k,
                 material, lay.cellComp[k]);
          if (componentListed[k])
            fail("cell in two components / duplicated", k, material, 0);
          componentListed[k] = 1;
        }
      }
      for (size_t k = 0; k < n; k++)
        if (lay.bodyOwner[k] < 0 && isComponentMaterial(lay.grid[k])
            && !componentListed[k])
          fail("static component material has no membership", (int)k,
               lay.grid[k], lay.cellComp[k]);
      for (Body* body : lay.bodies) {
        std::vector<uint8_t> coverage(body->occ.size(), 0);
        int coveredCells = 0;
        auto filled = [&](int x, int y) {
          return x >= 0 && x < body->w && y >= 0 && y < body->h
            && body->occ[y * body->w + x];
        };
        for (const BodyCollisionRect& rect : body->collisionRects) {
          if (rect.x0 < 0 || rect.y0 < 0
              || rect.x1 > body->w || rect.y1 > body->h
              || rect.x0 >= rect.x1 || rect.y0 >= rect.y1)
            failBody("collision rectangle out of bounds", body, -1, 0);
          for (int y = rect.y0; y < rect.y1; y++)
            for (int x = rect.x0; x < rect.x1; x++) {
              int local = y * body->w + x;
              if (!body->occ[local])
                failBody("collision rectangle covers empty cell", body, local, 0);
              if (coverage[local]++)
                failBody("collision rectangles overlap", body, local, coverage[local]);
              coveredCells++;
            }
          for (int face = 0; face < 4; face++) {
            int start = rect.spanStart[face];
            int count = rect.spanCount[face];
            if (start < 0 || count < 0
                || start + count > (int)body->collisionSpans.size())
              failBody("collision face span range out of bounds", body, -1, face);
            int q0 = face < 2 ? rect.y0 : rect.x0;
            int q1 = face < 2 ? rect.y1 : rect.x1;
            double offset = face < 2 ? body->offsetY : body->offsetX;
            for (int q = q0; q < q1; q++) {
              bool exposed = face == BCF_LEFT ? !filled(rect.x0 - 1, q)
                : face == BCF_RIGHT ? !filled(rect.x1, q)
                : face == BCF_UP ? !filled(q, rect.y0 - 1)
                : !filled(q, rect.y1);
              double tangent = offset + q;
              int spanHits = 0;
              for (int si = start; si < start + count; si++) {
                const BodyCollisionSpan& span = body->collisionSpans[si];
                if (!(span.lo < span.hi))
                  failBody("collision face has empty span", body, -1, si);
                if (tangent > span.lo && tangent < span.hi) spanHits++;
              }
              if (spanHits != (exposed ? 1 : 0)) {
                int localX = face == BCF_LEFT ? rect.x0
                  : face == BCF_RIGHT ? rect.x1 - 1 : q;
                int localY = face == BCF_UP ? rect.y0
                  : face == BCF_DOWN ? rect.y1 - 1 : q;
                failBody("collision face exposure mismatch", body,
                         localY * body->w + localX, face);
              }
            }
          }
        }
        for (int local = 0; local < (int)body->occ.size(); local++)
          if ((body->occ[local] != 0) != (coverage[local] == 1))
            failBody("collision rectangles do not exactly cover occ",
                     body, local, coverage[local]);
        if (coveredCells != body->nPts)
          failBody("collision rectangle area differs from nPts",
                   body, -1, coveredCells);
        if (body->boundarySamples.size()
              != body->boundarySampleRadii.size() * 2)
          failBody("boundary sample radius count mismatch",
                   body, -1, (int)body->boundarySampleRadii.size());
        if (body->rasterFootprintValid
            && body->rasterGeometryRevision == body->geometryRevision) {
          for (const BodyRasterCell& cell : body->rasterFootprint) {
            if (cell.x < 0 || cell.x >= body->rasterCols
                || cell.y < 0 || cell.y >= body->rasterRows)
              failBody("cached raster cell out of bounds",
                       body, cell.local, 0);
            if (cell.local < 0
                || cell.local >= (int)body->occ.size()
                || !body->occ[cell.local])
              failBody("cached raster cell has invalid local source",
                       body, cell.local, 0);
          }
        }
      }
    };
    checkLayer(fg, false);
    checkLayer(bg, true);
    for (Body* leader : fg.bodies) {
      if (leader->jointRole != 1) continue;
      Body* follower = leader->jointPeer;
      if (!follower || !liveBg.count(follower))
        failBody("joint follower is not live in background", leader, -1, 0);
      if (follower->jointRole != 2 || follower->jointPeer != leader)
        failBody("joint peer link is not reciprocal", leader, -1,
                 follower->jointRole);
      if (leader->id != follower->id)
        failBody("joint peer id mismatch", leader, -1, follower->id);
      if (leader->w != follower->w || leader->h != follower->h
          || leader->occ != follower->occ
          || leader->offsetX != follower->offsetX
          || leader->offsetY != follower->offsetY)
        failBody("joint geometry mismatch", leader, -1, follower->id);
      if (leader->cellMaterials != follower->jointPeerMaterials
          || leader->jointPeerMaterials != follower->cellMaterials)
        failBody("joint material maps are not symmetric", leader, -1,
                 follower->id);
      if (leader->px != follower->px || leader->py != follower->py
          || leader->angle != follower->angle
          || leader->vx != follower->vx || leader->vy != follower->vy
          || leader->omega != follower->omega
          || leader->awake != follower->awake
          || leader->stillTicks != follower->stillTicks
          || leader->bakeSupportedPoseTicks
               != follower->bakeSupportedPoseTicks
          || leader->cs != follower->cs || leader->sn != follower->sn)
        failBody("joint shared pose/motion mismatch", leader, -1,
                 follower->id);
    }
    for (Body* follower : bg.bodies)
      if (follower->jointRole == 2
          && (!follower->jointPeer || !liveFg.count(follower->jointPeer)))
        failBody("joint leader is not live in foreground", follower, -1, 0);
  }
#endif

  // Dirty tracking for the active layer.
  inline void markCellIndex(int k) {
    if (k < 0 || k >= cols * rows) return;
    markWorldTileDirty(k);
    int y = k / cols, x = k - y * cols;
    markLayerRowSpan(L, y, x, x);
  }
  void markDirtyRect(int x0, int y0, int x1, int y1) {
    int mx0 = imax(0, x0), mx1 = imin(cols - 1, x1), my0 = imax(0, y0), my1 = imin(rows - 1, y1);
    markWorldRectDirty(mx0, my0, mx1, my1);
    for (int y = my0; y <= my1; y++) markLayerRowSpan(L, y, mx0, mx1);
  }
  void markAllDirty() {
    for (int y = 0; y < rows; y++) markLayerRowSpan(L, y, 0, cols - 1);
  }
  // Fully reset dirty tracking (row marks + render chunk flags) for the active layer.
  void clearAllDirty() {
    forces.invalidateLooseCandidateCache(L);
    for (int y = 0; y < rows; y++) {
      L->rowMarkSpans[y].clear();
      L->simOnlyRowMarkSpans[y].clear();
    }
    memset(L->dirtyRender.data(), 0, (size_t)chunkCols * chunkRows); L->dirtyRenderCount = 0;
  }
  void foldRowMarksToRender() {
    for (int y = 0; y < rows; y++) {
      int py0 = imax(0, y - DIRTY_PAD_Y), py1 = imin(rows - 1, y + DIRTY_PAD_Y);
      for (const auto& span : L->rowMarkSpans[y]) {
        int px0 = imax(0, (int)span.first - DIRTY_PAD_X);
        int px1 = imin(cols - 1, (int)span.second + DIRTY_PAD_X);
        int c0 = px0 >> CHUNK_SHIFT, c1 = px1 >> CHUNK_SHIFT;
        int cy0 = py0 >> CHUNK_SHIFT, cy1 = py1 >> CHUNK_SHIFT;
        for (int cy = cy0; cy <= cy1; cy++) {
          int rb = cy * chunkCols;
          for (int cx = c0; cx <= c1; cx++) {
            int ci = rb + cx;
            if (!L->dirtyRender[ci]) {
              L->dirtyRender[ci] = 1;
              L->dirtyRenderCount++;
            }
          }
        }
      }
    }
  }
  // Coalesce the per-chunk dirty flags into cell-space rectangles for the active
  // layer: [x0,y0,x1,y1) EXCLUSIVE, packed into L->dirtyRects.
  void buildDirtyRects() {
    foldRowMarksToRender();
    L->dirtyRects.clear();
    for (int cy = 0; cy < chunkRows; cy++) {
      int cy0 = cy * CHUNK_SIZE, cy1 = imin(rows, cy0 + CHUNK_SIZE), rb = cy * chunkCols, cx = 0;
      while (cx < chunkCols) {
        if (!L->dirtyRender[rb + cx]) { cx++; continue; }
        int startCx = cx;
        while (cx + 1 < chunkCols && L->dirtyRender[rb + cx + 1]) cx++;
        int x0 = startCx * CHUNK_SIZE, x1 = imin(cols, (cx + 1) * CHUNK_SIZE);
        L->dirtyRects.push_back(x0); L->dirtyRects.push_back(cy0);
        L->dirtyRects.push_back(x1); L->dirtyRects.push_back(cy1);
        cx++;
      }
    }
  }
  bool beginStepDirty() {
    for (auto& kv : L->pendingDetonations) {
      int k = kv.first;
      if (k < 0 || k >= cols * rows) continue;
      int y = k / cols, x = k - y * cols;
      markLayerRowSpan(L, y, x, x);
    }
    for (Body* b : L->bodies) if (b->jointRole != 2 && b->fuseTicks > 0) {
      int x = (int)std::lround(b->px), y = (int)std::lround(b->py);
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      markLayerRowSpan(L, y, x, x);
    }
    if (!layerBakeRetryDeferred(L))
      for (Body* b : L->bodies) if (bodyNeedsBakeTick(b)) {
        int x = (int)std::lround(b->px), y = (int)std::lround(b->py);
        if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
        markLayerRowSpan(L, y, x, x);
      }
    foldRowMarksToRender();
    for (int y = 0; y < rows; y++) {
      L->activeRowSpans[y].clear();
    }
    bool hasActive = false;
    auto activateMarks = [&](int y, auto& spans) {
      if (spans.empty()) return;
      hasActive = true;
      int py0 = imax(0, y - DIRTY_PAD_Y), py1 = imin(rows - 1, y + DIRTY_PAD_Y);
      for (const auto& span : spans) {
        int px0 = imax(0, (int)span.first - DIRTY_PAD_X);
        int px1 = imin(cols - 1, (int)span.second + DIRTY_PAD_X);
        for (int yy = py0; yy <= py1; yy++) activateRowSpanNow(yy, px0, px1);
      }
      spans.clear();
    };
    for (int y = 0; y < rows; y++) {
      activateMarks(y, L->rowMarkSpans[y]);
      activateMarks(y, L->simOnlyRowMarkSpans[y]);
    }
    if (!hasActive) return false;
    stepSerial++;
    // Accumulate dirty volume for this layer (step() zeros the counters once).
    for (int y = 0; y < rows; y++) {
      if (L->activeRowSpans[y].empty()) continue;
      perfDirtyRows++;
      int rb = (y >> CHUNK_SHIFT) * chunkCols;
      for (const auto& span : L->activeRowSpans[y]) {
        perfDirtyCells += span.second - span.first + 1;
        for (int cx = span.first >> CHUNK_SHIFT,
                 c1 = span.second >> CHUNK_SHIFT; cx <= c1; cx++) {
          int ci = rb + cx;
          if (L->chunkStamp[ci] != stepSerial) {
            L->chunkStamp[ci] = stepSerial;
            perfDirtyChunks++;
          }
        }
      }
    }
    return true;
  }
  void prepareNextBuffer() {
    for (int y = 0; y < rows; y++) {
      int rs = y * cols;
      for (const auto& span : L->activeRowSpans[y]) {
        int minX = span.first, maxX = span.second;
        size_t width = (size_t)(maxX - minX + 1);
        memset(L->next + rs + minX, EMPTY, width);
#define SAND_CLEAR_NEXT_CHANNEL_SPAN(name, type, empty, store, encode, decode, accepts, operations) \
        if (L->name.next) \
          std::fill(L->name.next + rs + minX, L->name.next + rs + minX + width, \
                    (type)(empty));
        SAND_PERSISTENT_CELL_CHANNELS(SAND_CLEAR_NEXT_CHANNEL_SPAN)
#undef SAND_CLEAR_NEXT_CHANNEL_SPAN
      }
    }
  }

  inline bool clearPersistentCurrentState(Layer* layer, int k) {
    bool changed = false;
#define SAND_CLEAR_CURRENT_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
    if (layer->name.current) { \
      changed = changed || layer->name.current[k] != (type)(empty); \
      layer->name.current[k] = (type)(empty); \
    }
    SAND_PERSISTENT_CELL_CHANNELS(SAND_CLEAR_CURRENT_CHANNEL)
#undef SAND_CLEAR_CURRENT_CHANNEL
    return changed;
  }
  inline void clearPersistentNextState(Layer* layer, int k) {
#define SAND_CLEAR_NEXT_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
    if (layer->name.next) layer->name.next[k] = (type)(empty);
    SAND_PERSISTENT_CELL_CHANNELS(SAND_CLEAR_NEXT_CHANNEL)
#undef SAND_CLEAR_NEXT_CHANNEL
  }
  inline PersistentCellSnapshot capturePersistentCurrentState(
      const Layer* layer, int k) const {
    PersistentCellSnapshot snapshot;
#define SAND_CAPTURE_CURRENT_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
    if (layer->name.current) snapshot.name = layer->name.current[k];
    SAND_PERSISTENT_CELL_CHANNELS(SAND_CAPTURE_CURRENT_CHANNEL)
#undef SAND_CAPTURE_CURRENT_CHANNEL
    return snapshot;
  }
  inline PersistentCellSnapshot capturePersistentNextState(
      const Layer* layer, int k) const {
    PersistentCellSnapshot snapshot;
#define SAND_CAPTURE_NEXT_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
    if (layer->name.next) snapshot.name = layer->name.next[k];
    SAND_PERSISTENT_CELL_CHANNELS(SAND_CAPTURE_NEXT_CHANNEL)
#undef SAND_CAPTURE_NEXT_CHANNEL
    return snapshot;
  }
  inline void restorePersistentCurrentState(
      Layer* layer, int k, uint8_t material,
      const PersistentCellSnapshot& snapshot, PersistentCellOperation operation) {
#define SAND_RESTORE_CURRENT_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
    if (layer->name.current) \
      layer->name.current[k] = ((operations) & operation) && accepts(material) \
        ? snapshot.name : (type)(empty);
    SAND_PERSISTENT_CELL_CHANNELS(SAND_RESTORE_CURRENT_CHANNEL)
#undef SAND_RESTORE_CURRENT_CHANNEL
  }
  inline void restorePersistentNextState(
      Layer* layer, int k, uint8_t material,
      const PersistentCellSnapshot& snapshot, PersistentCellOperation operation) {
#define SAND_RESTORE_NEXT_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
    if (layer->name.next) \
      layer->name.next[k] = ((operations) & operation) && accepts(material) \
        ? snapshot.name : (type)(empty);
    SAND_PERSISTENT_CELL_CHANNELS(SAND_RESTORE_NEXT_CHANNEL)
#undef SAND_RESTORE_NEXT_CHANNEL
  }
  inline void carryPersistentStateToNext(
      int fromK, int toK, uint8_t material, PersistentCellOperation operation) {
#define SAND_CARRY_NEXT_CHANNEL(name, type, empty, store, encode, decode, accepts, operations) \
    if (L->name.next) \
      L->name.next[toK] = ((operations) & operation) && accepts(material) \
        ? L->name.current[fromK] : (type)(empty);
    SAND_PERSISTENT_CELL_CHANNELS(SAND_CARRY_NEXT_CHANNEL)
#undef SAND_CARRY_NEXT_CHANNEL
  }
  inline void mirrorCurrentCellToNext(int k) {
    uint8_t material = L->grid[k];
    L->next[k] = material;
    carryPersistentStateToNext(k, k, material, PCSO_STATIONARY);
  }

  // ---- cell helpers ----
  inline bool emptyAt(int x, int y) { return x >= 0 && x < cols && y >= 0 && y < rows && L->grid[I(x, y)] == EMPTY && L->next[I(x, y)] == EMPTY; }
  inline bool touchesGridEmpty(int k) {
    int x = k % cols, y = k / cols;
    return (x > 1 && L->grid[k - 1] == EMPTY) || (x < cols - 2 && L->grid[k + 1] == EMPTY) ||
           (y > 1 && L->grid[k - cols] == EMPTY) || (y < rows - 1 && L->grid[k + cols] == EMPTY);
  }
  // A liquid only stays "active" if it has somewhere to FLOW — empty to a side or
  // below. Empty ABOVE (open sky over a flat surface) is NOT an escape: liquid
  // never flows up, so a surface cell blocked on its sides + below has settled and
  // should go inert instead of re-marking itself dirty every step forever (the
  // shimmer + the per-step diff churn that broke open oceans in multiplayer). It
  // re-wakes normally when a neighbour changes (dirty padding covers the gap).
  inline bool liquidCanEscape(int k) {
    int x = k % cols, y = k / cols;
    return (x > 1 && L->grid[k - 1] == EMPTY) || (x < cols - 2 && L->grid[k + 1] == EMPTY) ||
           (y < rows - 1 && L->grid[k + cols] == EMPTY);
  }
  // Is this surface cell L->next to an INTERNAL hole — a 1-wide empty gap in the liquid
  // layer with more of our liquid on its far side? Such a hole CAN be coalesced away
  // (relaxLiquidGaps migrates it to an edge); an OPEN edge (empty-empty beyond) or a
  // 1-lower neighbouring column (empty over liquid = a gentle slope) is NOT an
  // internal hole, so a flat-but-ragged surface or a settled puddle still goes inert.
  inline bool adjacentInternalHole(int k, uint8_t m) {
    // Only materials that participate in relaxLiquidGaps stay awake on an
    // internal hole. Others would re-mark forever on a ragged free surface.
    if (!relaxesGaps(m)) return false;
    int x = k % cols, y = k / cols;
    if (y + 1 >= rows) return false;
    // The hole must also have SUPPORT below it (non-empty) — that is the gap
    // relaxLiquidGaps actually fills. A hole with empty below is a rising bubble the
    // fall handles, not a coalesce target, and re-marking on it would spin forever.
    if (x > 2 && L->grid[k - 1] == EMPTY && L->grid[k - 2] == m && L->grid[k - 1 + cols] != EMPTY) return true;
    if (x < cols - 3 && L->grid[k + 1] == EMPTY && L->grid[k + 2] == m && L->grid[k + 1 + cols] != EMPTY) return true;
    return false;
  }
  // Powder/liquid motion (or replace) invalidates the loose grounding overlay.
  // Rigid topology uses groundDirty/groundContentDirty separately.
  inline bool isLooseOverlayMat(uint8_t m) {
    return isLooseSolidMaterial(m) || isLiquidMaterial(m);
  }
  inline void noteLooseDirtyCol(int x) {
    if (x < 0 || x >= cols) return;
    if ((int)L->looseDirtyCol.size() != cols) L->looseDirtyCol.assign(cols, 0);
    L->looseDirtyCol[x] = 1;
    if (!L->looseGroundDirty || L->looseDirtyX1 < L->looseDirtyX0) {
      L->looseDirtyX0 = x; L->looseDirtyX1 = x;
    } else {
      if (x < L->looseDirtyX0) L->looseDirtyX0 = x;
      if (x > L->looseDirtyX1) L->looseDirtyX1 = x;
    }
    L->looseGroundDirty = true;
    L->sleepingBodySupportDirty = true;
  }
  inline void noteLooseDirtyFull() {
    L->looseGroundDirty = true;
    L->sleepingBodySupportDirty = true;
    L->looseDirtyFull = true;
    L->looseDirtyX0 = 0; L->looseDirtyX1 = cols - 1;
  }
  inline void noteLooseGroundTouch(uint8_t m) {
    if (isLooseOverlayMat(m)) noteLooseDirtyFull();
  }
  inline void noteLooseGroundTouch2(uint8_t a, uint8_t b) {
    if (isLooseOverlayMat(a) || isLooseOverlayMat(b)) noteLooseDirtyFull();
  }
  inline void noteLooseGroundTouch2At(int k, uint8_t a, uint8_t b) {
    if (isLooseOverlayMat(a) || isLooseOverlayMat(b))
      noteLooseDirtyCol(k - (k / cols) * cols);
  }
  // Low-level grid storage only. This deliberately does not repair component or
  // body membership; runtime edits/reactions must use CellMutationBatch.
  inline void writeGridIndexUnsafe(int k, uint8_t m) {
    if (k < 0 || k >= cols * rows) return;
    if (L->grid[k] == m) {
      bool momentumChanged = clearPersistentCurrentState(L, k);
      if (momentumChanged) markCellIndex(k);
      return;
    }
    clearPersistentCurrentState(L, k);
    uint8_t old = L->grid[k];
    if (m == NEUTRONIUM) L->forceSourcePresent = true;
    if (m == NEUTRONIUM || old == NEUTRONIUM) {
      forces.noteNeutroniumWrite(L, k, old, m);
    }
    noteLooseGroundTouch2At(k, old, m);
    if (isHeatSource(m) && !isHeatSource(old)) L->heatAddedAfterPrepare = true;
    L->grid[k] = m;
    markCellIndex(k);
  }
  inline bool isLooseDensityMaterial(uint8_t m) { return DENSITY_SORTED[m] == 1; }
  inline bool canDisplaceByLooseDensity(uint8_t m, uint8_t d) { return isLooseDensityMaterial(m) && isLooseDensityMaterial(d) && DENSITY[m] > DENSITY[d]; }
  // True iff this cell still has a pending density swap with a neighbour — used to
  // keep an UNLEVEL two-fluid interface awake until it settles flat.
  //   - vertical (any loose material): a lighter material directly below, or a
  //     heavier one directly above (preserves powder-on-water sorting).
  //   - DIAGONAL, LIQUIDS ONLY: a denser liquid up-diagonal that `m` can rise into,
  //     or a lighter liquid down-diagonal that `m` can sink into. This is what lets a
  //     water mound under oil keep exchanging (water sinks / oil rises) until level.
  // Restricted to liquids on the diagonals so powder sorting isn't double-counted and
  // a SINGLE-fluid surface (no density difference anywhere) still returns false -> the
  // surface goes inert, no shimmer/multiplayer churn.
  inline bool touchesUnstableLooseDensityInterface(int k, uint8_t m) {
    if (!isLooseDensityMaterial(m)) return false;
    int y = k / cols, x = k - y * cols;
    if (y < rows - 1 && canDisplaceByLooseDensity(m, L->grid[k + cols])) return true;
    if (y > 1 && canDisplaceByLooseDensity(L->grid[k - cols], m)) return true;
    if (isLiquidMaterial(m)) {
      if (y > 1) {
        if (x > 1 && isLiquidMaterial(L->grid[k - cols - 1]) && canDisplaceByLooseDensity(L->grid[k - cols - 1], m)) return true;
        if (x < cols - 2 && isLiquidMaterial(L->grid[k - cols + 1]) && canDisplaceByLooseDensity(L->grid[k - cols + 1], m)) return true;
      }
      if (y < rows - 1) {
        if (x > 1 && isLiquidMaterial(L->grid[k + cols - 1]) && canDisplaceByLooseDensity(m, L->grid[k + cols - 1])) return true;
        if (x < cols - 2 && isLiquidMaterial(L->grid[k + cols + 1]) && canDisplaceByLooseDensity(m, L->grid[k + cols + 1])) return true;
      }
    }
    return false;
  }
  // Stamp source vacated for this tick AND mark it dirty. Vacate alone is not
  // enough: prepareNextBuffer only blanks active rows, and a multi-cell liquid
  // fall can leave the source outside the destination's DIRTY_PAD_Y band next
  // step. Unblanked next[source] then resurrects a 2-tick-old value as a ghost
  // trail (looks like fluid duplication while falling).
  inline void vacateForNextMove(int fromK) {
    noteLooseGroundTouch2At(fromK, L->grid[fromK], EMPTY);
    L->vacatedStamp[fromK] = tick;
    markCellIndex(fromK);
  }
  // Mark every cell on a vertical/horizontal move span dirty so intermediate
  // rows stay in the active band and get blanked next prepareNextBuffer.
  inline void markMoveSpan(int fromK, int toK) {
    int fy = fromK / cols, fx = fromK - fy * cols;
    int ty = toK / cols, tx = toK - ty * cols;
    if (fx == tx && fy == ty) { markCellIndex(fromK); return; }
    markDirtyRect(imin(fx, tx), imin(fy, ty), imax(fx, tx), imax(fy, ty));
  }
  inline void writeNextIndex(int k, uint8_t m) {
    clearPersistentNextState(L, k);
    if (L->grid[k] == m && L->vacatedStamp[k] != tick)
      carryPersistentStateToNext(k, k, m, PCSO_STATIONARY);
    // Even when next[] already holds m (stale double-buffer residue), still mark
    // if the committed grid differs — otherwise a reclaim that early-outs here
    // leaves the vacated source without a dirty mark and ghosts can return.
    if (L->next[k] == m) {
      if (L->grid[k] != m) {
        noteLooseGroundTouch2At(k, L->grid[k], m);
        markCellIndex(k);
      }
      return;
    }
    noteLooseGroundTouch2At(k, L->grid[k], m);
    noteLooseGroundTouch2At(k, L->next[k], EMPTY); // vacating/replacing prior next material
    L->next[k] = m;
    if (L->grid[k] != m
        || (isGasMaterial(m) && !GAS_PERSISTENT[MAT_GAS_PROFILE[m]])
        || (isLiquidMaterial(m) && liquidCanEscape(k))
        || touchesUnstableLooseDensityInterface(k, m)) markCellIndex(k);
  }
  inline bool canDisplaceMaterial(uint8_t m, uint8_t d) { if (isGasMaterial(d)) return true; return canDisplaceByLooseDensity(m, d); }
  // Free volume for ordinary liquid movement is EMPTY or gas. Liquid↔liquid
  // separation is a separate adjacent-swap pass.
  //
  // Gas is free volume only once per tick — the gas still sitting in grid[k]
  // with next empty. Gas already written into next[k] this tick is a rising
  // bubble parked for the rest of the settle pass. Claiming that again would
  // cascade-swap it to the free surface in one step (looks like teleporting).
  // True when liquid may claim the gas at k this tick (grid-native, not yet moved).
  inline bool liquidGasClaimableAt(int k) {
    return L->next[k] == EMPTY && L->vacatedStamp[k] != tick && isGasMaterial(L->grid[k]);
  }
  // Effective occupant of k this tick for liquid claims. Prefers next[] (already
  // settled writers) so movement decisions see the current effective contents.
  // Parked rising gas in next[] is reported as itself but is NOT free volume
  // (see liquidColumnPassable / liquidCanClaim) so the bubble rises 1 cell/tick.
  inline uint8_t liquidOccupantAt(int k) {
    uint8_t n = L->next[k];
    if (n != EMPTY) return n;
    if (L->vacatedStamp[k] == tick) return EMPTY;
    return L->grid[k];
  }
  // Fall-through: EMPTY or a claimable gas count as air. Gas already parked in
  // next[] blocks further fall this tick.
  inline bool liquidColumnPassable(int k, uint8_t m) {
    (void)m;
    if (L->assemblyWakeStamp[k] == tick) return false;
    uint8_t n = L->next[k];
    if (n != EMPTY) return false;
    if (L->vacatedStamp[k] == tick) return true;
    uint8_t g = L->grid[k];
    return g == EMPTY || isGasMaterial(g);
  }
  // Land/claim for fall / down-diagonal movement: EMPTY, claimable gas, or a
  // strictly lighter powder. Another liquid is never ordinary free volume.
  // Gas/powder already written into next[] this tick are parked displacees —
  // do not re-claim them (cascade would drop mass on vacatedStamp / overwrite).
  inline bool liquidCanClaim(int k, uint8_t m) {
    if (L->assemblyWakeStamp[k] == tick) return false;
    uint8_t n = L->next[k];
    if (n != EMPTY) {
      if (isGasMaterial(n) || isLooseSolidMaterial(n)) return false; // parked bubble/grain
      return false;
    }
    if (L->vacatedStamp[k] == tick) return true;
    uint8_t g = L->grid[k];
    return g == EMPTY || isGasMaterial(g)
      || (isLooseSolidMaterial(g) && canDisplaceByLooseDensity(m, g));
  }
  // Same-level flow / enter: EMPTY or claimable gas only. Liquid↔liquid motion
  // stays in the adjacent density pass, and parked next[] gas is blocked.
  inline bool liquidCanFlowInto(int k, uint8_t m) {
    (void)m;
    if (L->assemblyWakeStamp[k] == tick) return false;
    uint8_t n = L->next[k];
    if (n != EMPTY) return false;
    if (L->vacatedStamp[k] == tick) return true;
    uint8_t g = L->grid[k];
    return g == EMPTY || isGasMaterial(g);
  }
  inline bool canEnterIndex(int k, uint8_t m) {
    if (isLiquidMaterial(m)) return liquidCanFlowInto(k, m);
    return L->next[k] == EMPTY && (L->grid[k] == EMPTY || canDisplaceMaterial(m, L->grid[k]));
  }
  inline bool canLiquidEnter(int x, int y, uint8_t m) { return x >= 0 && x < cols && y >= 0 && y < rows && canEnterIndex(I(x, y), m); }
  inline bool supportsLiquid(uint8_t s, uint8_t m) {
    return s != EMPTY && s != m
      && (isLiquidMaterial(s) || !canDisplaceMaterial(m, s));
  }
  // True if something stacks pressure on this liquid cell: more of the same
  // material above, OR a strictly lighter liquid (e.g. water over brine). Without
  // the latter, submerged denser fluid never equalizes sideways and freezes into
  // a pyramid under the lighter layer.
  inline bool liquidPressureAbove(int k, uint8_t m) {
    int y = k / cols;
    if (y <= 1) return false;
    uint8_t a = L->grid[k - cols];
    if (a == m) return true;
    return isLiquidMaterial(a) && DENSITY[a] < DENSITY[m];
  }
  void moveMaterialInto(int fromK, int toK, uint8_t m) {
    // For liquids, capture the effective occupant (next if set, else grid) so
    // every displacement preserves the target's persistent state.
    bool displacedFromNext = isLiquidMaterial(m) && L->next[toK] != EMPTY;
    uint8_t displaced = isLiquidMaterial(m) ? liquidOccupantAt(toK) : L->grid[toK];
    PersistentCellSnapshot displacedState;
    if (displaced != EMPTY && displaced != m && canDisplaceMaterial(m, displaced)) {
      displacedState = displacedFromNext
        ? capturePersistentNextState(L, toK)
        : capturePersistentCurrentState(L, toK);
    }
    writeNextIndex(toK, m);
    carryPersistentStateToNext(fromK, toK, m, PCSO_MOVE);
    int fromY = fromK / cols, fromX = fromK - fromY * cols;
    int toY = toK / cols, toX = toK - toY * cols;
    if (toY > fromY && toX == fromX && persistentLooseState(m))
      carryNextFallSpeed(toK, acceleratedFallSpeed(fromK, m));
    vacateForNextMove(fromK);
    if (isLiquidMaterial(m)) {
      if (toY > fromY) audio.noteFluidFall(m, toK - toY * cols, toY, toY - fromY);
    } else if (isLooseSolidMaterial(m) && fromK != toK) {
      audio.notePowderMove(m, toK - toY * cols, toY,
                           std::max(1, std::abs(toK - fromK) / cols));
    }
    // Multi-cell liquid sinks (and any sparse jump) must dirty the full span so
    // vacated/intermediate rows stay blankable across the double buffer.
    if (fromK != toK) markMoveSpan(fromK, toK);
    if (displaced == EMPTY || displaced == m || !canDisplaceMaterial(m, displaced)) return;
    if (!isLiquidMaterial(m) && L->vacatedStamp[toK] == tick) return;
    // A defensive liquid→liquid path remains local and conservative. Ordinary
    // gravity movement excludes liquid targets; the post-settle adjacent-pair
    // pass owns those exchanges, and force-directed settling may also swap one
    // denser liquid into a lighter neighbour toward the source.
    if (isLiquidMaterial(m) && isLiquidMaterial(displaced)) {
      if (L->next[fromK] == EMPTY) {
        writeNextIndex(fromK, displaced);
        restorePersistentNextState(
          L, fromK, displaced, displacedState, PCSO_SWAP);
      }
      return;
    }
    // Gas / lighter powder: swap into the mover's vacated source (one cell).
    // Claim checks only allow grid-native gas/powder, so a lower liquid swap that
    // parked the displacee in next[fromK] is not re-claimed by the cell above —
    // bubbles/grains rise ~1 cell/tick instead of cascading. Always relocate:
    // the vacatedStamp[toK] powder guard below is for powder→powder ghosts and
    // would drop liquid-displaced snow/steam (water "eats" snow).
    if (isGasMaterial(displaced) || isLooseSolidMaterial(displaced)) {
      if (L->next[fromK] == EMPTY) {
        writeNextIndex(fromK, displaced);
        restorePersistentNextState(
          L, fromK, displaced, displacedState, PCSO_SWAP);
      }
      return;
    }
    // Other displacees (should be rare): only emit if grid occupant still present.
    if (L->vacatedStamp[toK] == tick) return;
    if (L->next[fromK] == EMPTY) {
      writeNextIndex(fromK, displaced);
      restorePersistentNextState(
        L, fromK, displaced, displacedState, PCSO_SWAP);
    }
  }
  inline void moveLiquidInto(int fromK, int x, int y, uint8_t m) { moveMaterialInto(fromK, I(x, y), m); }

  static const int DIRS_LF[2];
  static const int DIRS_RF[2];
