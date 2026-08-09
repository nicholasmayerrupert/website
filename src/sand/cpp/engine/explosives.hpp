#pragma once
// TNT and methane ignition, fuses, blast carving, debris, shock, and aftermath.
// Position-keyed hashes provide most blast variation; remaining shared-RNG order
// is part of deterministic behavior.

struct Engine;

class ExplosivesSystem {
 public:
  explicit ExplosivesSystem(Engine& e) : E(e) { buildBlastStencils(); }

  static const int    TNT_FUSE_TICKS = 28;   // delay from ignition to blast (~run-away time)
  static const int    TNT_CHAIN_FUSE = 3;    // three-tick delay between successive blast generations
  static const int    TNT_BLAST_RADIUS = 22; // crater reach (cells)
  static const int    TNT_CLUSTER_FAST_THRESHOLD = 4;  // merge compact brush-sized fronts into spatial representatives
  static const int    TNT_COMPACT_FRONT_CELLS = 13;    // one creative click: render as one pulse, not one crater per cell
  static const int    TNT_MASS_FRONT_CELLS = 64;       // enables the dense-front representative and debris policy
  static const int    TNT_CLUSTER_BUCKET = 14; // representative spacing; blast radii still overlap into one continuous front
  static const int    TNT_MASS_FRONT_BUCKETS_PER_STEP = 6; // compact spatial work budget for broad live fronts
  static constexpr double TNT_BLAST_POWER = 20.0; // energy at the centre; falls off to 0 at the rim
  static const int    METHANE_BLAST_RADIUS = 16; // one-third broader pressure flash, still smaller than TNT
  static constexpr double METHANE_BLAST_POWER = 14.0; // fractures a wider stone shell; hard ores survive
  static const int    METHANE_BLAST_MIN_CELLS = 10;
  static const int    METHANE_BLAST_CELLS_PER_FRONT = 48;
  static const int    METHANE_BLAST_REP_SPACING = 12;
  static const int    METHANE_BLAST_FRONT_CAP = 8;
  static const int    METHANE_DEBRIS_STEP_CAP = 10; // actual surrounding material only; never generic DEBRIS
  static const int    METHANE_DEBRIS_SOURCE_TRIES = 5; // extra launch candidates make carved rubble more likely to escape
  // Debris and shockwave. Velocities come from geometry and
  // whash2 (the same rand-free hash the item drops use), never rand().
  static const int    BLAST_DEBRIS_CHUNKS = 1;    // physical rubble chunks ejected per destroyed material source
  static const int    BLAST_DEBRIS_SOURCE_TRIES = 2; // try the old fan positions, but stop after the smaller budget
  static const int    BLAST_FORCED_DEBRIS_CHUNKS = 1; // extra generic blast debris, even in open air
  static const int    BLAST_FORCED_DEBRIS_TRIES = 3; // nearby placement attempts after the debris roll succeeds
  static constexpr double BLAST_FORCED_DEBRIS_FRAC = 0.75; // generic open-air debris spawns on three quarters of blasts
  static const int    BLAST_DEBRIS_STEP_CAP = 3;  // max chunks a same-tick TNT wave can add per layer
  static const int    BLAST_MASS_DEBRIS_STEP_CAP = 4; // bounded physical rubble from a dense TNT front
  static const int    BLAST_DEBRIS_SAMPLE_SIDE = 3; // fixed spatial buckets; no growing candidate list in large craters
  static const int    BLAST_DEBRIS_CAP = 24;      // hard live-body solver ceiling; per-step cap keeps chains paced
  static constexpr double BLAST_DEBRIS_SPEED = 2.2;   // chunk launch speed
  static constexpr double BLAST_PARTICLE_SPEED = 2.6; // cosmetic fleck speed
  static const int    BLAST_PARTICLE_LIFE = 26;
  static const int    BLAST_PARTICLE_CAP = 48;    // hard cap on cosmetic flecks per step (steam carries the visual now)
  static constexpr double BLAST_PUSH = 3.0;       // outward shove given to nearby free bodies
  // Blast gas: pre-existing gas inside the blast is cleared; fresh gas is stamped
  // into the outer crater ring after all carving and component cleanup.
  static constexpr double TNT_ACRID_FRAC = 0.70; // acrid smoke dominates the blast cloud
  static constexpr double TNT_STEAM_FRAC = 0.20; // plus some steam; the remaining 10% is fire
  static const int    BLAST_GAS_RING_DEPTH = 3; // fill the outer shell of each crater; no gas pathfinding
  static constexpr double BLAST_GAS_INNER_KEEP = 0.22; // inner shell is mostly air
  static constexpr double BLAST_GAS_OUTER_KEEP = 0.88; // rim stays visibly smoky
  static const int    TNT_MASS_GAS_WAVES_PER_STEP = 2;

  // Per-step transaction: every crater first contributes to one damage field.
  // The union is classified from the untouched grid, cut once, repaired once,
  // and only then consumed by the visual and physical aftermath.
  struct BlastOffset { int16_t ox, oy; double dist, energy; };
  struct BlastGasOffset { int16_t ox, oy; double keepP; };
  struct BlastDebrisEjection { double nx = 0, ny = -1; bool terrainGuided = false; };
  struct BlastDebrisCandidate { uint8_t material; int cell, dd; };
  struct BlastDebrisSource { uint8_t material; int cell; };
  struct BlastWave {
    int cx, cy, radius;
    uint32_t seed;
    double power;
    uint8_t explosiveMaterial;
    BlastDebrisEjection debrisEjection;
    std::vector<BlastDebrisCandidate> debrisCandidates;
    std::array<int16_t, TABLE * BLAST_DEBRIS_SAMPLE_SIDE * BLAST_DEBRIS_SAMPLE_SIDE> debrisSlots;
  };
  struct BlastCellRemoval { int cell; uint8_t material; };
  struct BlastParticlePlan {
    uint8_t material;
    double x, y, vx, vy;
  };
  struct BlastBatch {
    std::vector<int> forcedStaticTnt;
    std::vector<BlastCellRemoval> staticCuts;
    std::vector<int> gasCuts, bodyCuts, staticTntIgnitions;
    std::vector<int> erasedStructural;
    std::vector<BlastParticlePlan> particlePlans;
    std::vector<BlastWave> waves;
    std::unordered_set<Body*> sourceBodies, tntBodyIgnitions;
    std::unordered_map<int, Body*> bodyById; bool bodyMapBuilt = false;
    std::unordered_set<Body*> dirtyBodies;
    int minX = 1 << 30, minY = 1 << 30, maxX = -1, maxY = -1; // union dirty rect
    int particles = 0, debrisSpawned = 0, debrisStepCap = BLAST_DEBRIS_STEP_CAP;
    int gasWaveCap = INT_MAX;
    bool any = false;
    bool emitGas = true, emitParticles = true;
  };

  // Schedule a detonation at a cell, shortening an existing fuse only when the new
  // front is sooner (ordinary heat re-ignition still leaves the fuse unchanged).
  std::vector<std::pair<int, int>> blastBoxCells(int cx, int cy, int halfW, int halfH);
  void queueDetonation(int cell, int fuse);
  void shortenTntBodyFuse(Body* b, int fuse);
  void spawnBlastRingGases(const std::vector<BlastWave>& waves, int waveCap);
  void activateBlastRectNow(int x0, int y0, int x1, int y1);
  bool blastBodyCandidateHasEscape(const std::vector<std::pair<int, int>>& cells, uint8_t material, bool footprintAlreadySolid);
  BlastDebrisEjection inferBlastDebrisEjection(int cx, int cy);
  void spawnBlastDebrisFan(int cx, int cy, uint32_t bseed, uint8_t debrisMat,
                           int sx0, int sy, int count, int salt, BlastBatch& bb,
                           const BlastDebrisEjection& fallback, int tries = -1);
  void buildBlastDamage(const BlastBatch& bb);
  void carveStaticTntCluster(const std::vector<int>& cells, BlastBatch& bb, BlastBatch* otherBb,
                             bool massFront = false);
  void carveBlast(int cx, int cy, int radius, double power, BlastBatch& bb, Body* sourceBody = nullptr,
                  uint8_t explosiveMaterial = TNT, uint32_t seedSerial = UINT32_MAX);
  void evaluateBlastPlan(BlastBatch& bb);
  void applyBlastCuts(BlastBatch& bb);
  void repairBlastStructures(BlastBatch& bb);
  bool applyBlastImpulse(Body* body, int cx, int cy, int radius,
                         double power);
  void applyBlastAftermath(BlastBatch& bb);
  void carveBlastAcrossLayers(int cx, int cy, int radius, double power, BlastBatch& bb, BlastBatch* otherBb,
                              Body* sourceBody = nullptr, uint8_t explosiveMaterial = TNT,
                              int immunePlayerId = 0, uint32_t seedSerial = UINT32_MAX,
                              uint8_t soundEvent = SE_EXPLOSION,
                              double actorDamageScale = 1.0,
                              bool bypassActorCooldown = false,
                              int immuneCreatureId = 0);
  void finishBlastBatches(BlastBatch& bb, BlastBatch* otherBb);
  void damageActors(int cx, int cy, int radius, double power, int immunePlayerId = 0,
                    double damageScale = 1.0, bool bypassCooldown = false,
                    int immuneCreatureId = 0);
  void detonate(int cx, int cy, int radius, double power, int immunePlayerId = 0,
                uint8_t explosiveMaterial = TNT, uint32_t seedSerial = UINT32_MAX,
                uint8_t soundEvent = SE_EXPLOSION,
                double actorDamageScale = 1.0,
                bool bypassActorCooldown = false,
                int immuneCreatureId = 0);
  void applyExplosives();

 private:
  Engine& E;
  std::vector<BlastOffset> tntStencil;
  std::vector<BlastGasOffset> tntGasStencil;
  std::vector<BlastOffset> methaneStencil;
  std::vector<BlastGasOffset> methaneGasStencil;
  std::vector<int> addedHeatCells;
  std::vector<float> plannedDamage;
  std::vector<int32_t> plannedBestWave, plannedDamageStamp, plannedDamageCells;
  std::vector<int32_t> plannedRemovalStamp;
  int32_t plannedDamageGen = 0, plannedRemovalGen = 0;
  int plannedX0 = 0, plannedY0 = 0, plannedWidth = 0, plannedHeight = 0;
  bool plannedDense = true;
  void buildBlastStencils();
};
