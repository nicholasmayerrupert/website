#pragma once
// TNT / explosives (extracted from the Engine in 5e): ignition + fuses (static
// cells via pendingDetonations on the Layer; body TNT via Body::fuseTicks),
// the DURABILITY-gated crater carve across both layers, rubble/debris bodies,
// cosmetic flecks, the outward gas shockwave, and aftermath gases. Works the
// same whether the TNT is a placed solid or a free body. Draws almost
// exclusively from whash2 (position-keyed) so empty scenes cost no RNG; the
// two rand() draws it does make are order-preserved by the extraction (the
// checksum gate enforces it). Method bodies live in explosives_impl.inc.

struct Engine;

class ExplosivesSystem {
 public:
  explicit ExplosivesSystem(Engine& e) : E(e) { buildTntStencil(); }

  static const int    TNT_FUSE_TICKS = 28;   // delay from ignition to blast (~run-away time)
  static const int    TNT_CHAIN_FUSE = 1;    // one-tick rolling front: staged, without idle structural frames
  static const int    TNT_BLAST_RADIUS = 22; // crater reach (cells)
  static const int    TNT_CLUSTER_FAST_THRESHOLD = 16; // merge even modest same-tick fronts before stencils overlap heavily
  static const int    TNT_CLUSTER_BUCKET = 14; // representative spacing; blast radii still overlap into one continuous front
  static constexpr double TNT_BLAST_POWER = 20.0; // energy at the centre; falls off to 0 at the rim
  static const int    METHANE_BLAST_RADIUS = 16; // one-third broader pressure flash, still smaller than TNT
  static constexpr double METHANE_BLAST_POWER = 14.0; // fractures a wider stone shell; hard ores survive
  static const int    METHANE_BLAST_MIN_CELLS = 10;
  static const int    METHANE_BLAST_CELLS_PER_FRONT = 48;
  static const int    METHANE_BLAST_REP_SPACING = 12;
  static const int    METHANE_BLAST_FRONT_CAP = 8;
  static const int    METHANE_DEBRIS_STEP_CAP = 10; // actual surrounding material only; never generic DEBRIS
  static const int    METHANE_DEBRIS_SOURCE_TRIES = 5; // extra launch candidates make carved rubble more likely to escape
  // Debris + shockwave (Phase 3). All deterministic — velocities come from geometry +
  // whash2 (the same rand-free hash the item drops use), never rand().
  static const int    BLAST_DEBRIS_CHUNKS = 1;    // physical rubble chunks ejected per destroyed material source
  static const int    BLAST_DEBRIS_SOURCE_TRIES = 2; // try the old fan positions, but stop after the smaller budget
  static const int    BLAST_FORCED_DEBRIS_CHUNKS = 1; // extra generic blast debris, even in open air
  static constexpr double BLAST_FORCED_DEBRIS_FRAC = 0.50; // generic open-air debris spawns on half of blasts
  static const int    BLAST_DEBRIS_STEP_CAP = 3;  // max chunks a same-tick blast wave can add per layer
  static const int    BLAST_DEBRIS_SAMPLE_SIDE = 3; // fixed spatial buckets; no growing candidate list in large craters
  static const int    BLAST_DEBRIS_CAP = 64;      // hard live-body solver ceiling; per-step cap keeps chains paced
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

  // Per-step accumulator: every crater of a step carves into one of these, then
  // finishBlasts() runs the expensive finalize once (the TNT chain-lag fix).
  struct BlastOffset { int16_t ox, oy; int32_t dd; double dist; };
  struct BlastWave { int cx, cy, radius; uint32_t seed; };
  struct BlastDebrisSource { uint8_t material; int cell; };
  struct BlastBatch {
    std::vector<int> erasedStone, erasedIce;
    std::vector<int> erasedPlant;
    std::vector<BlastWave> gasShockwaves;
    Layer* energyLayer = nullptr;
    int32_t blastEnergyGen = 0;
    std::unordered_map<int, Body*> bodyById; bool bodyMapBuilt = false;
    std::unordered_set<Body*> dirtyBodies;
    int minX = 1 << 30, minY = 1 << 30, maxX = -1, maxY = -1; // union dirty rect
    int particles = 0, debrisSpawned = 0, debrisStepCap = BLAST_DEBRIS_STEP_CAP;
    bool any = false;
  };

  // Schedule a detonation at a cell (no-op if one is already pending there, so a fuse
  // is never shortened by re-ignition).
  std::vector<std::pair<int, int>> blastBoxCells(int cx, int cy, int halfW, int halfH);
  void queueDetonation(int cell, int fuse);
  void shortenTntBodyFuse(Body* b, int fuse);
  void spawnBlastRingGases(const std::vector<BlastWave>& waves);
  void activateBlastRectNow(int x0, int y0, int x1, int y1);
  bool blastBodyCandidateHasEscape(const std::vector<std::pair<int, int>>& cells, uint8_t material, bool footprintAlreadySolid);
  void spawnBlastDebrisFan(int cx, int cy, uint32_t bseed, uint8_t debrisMat, int sx0, int sy, int count, int salt, BlastBatch& bb, int tries = -1);
  bool blastEnergyDominated(BlastBatch& bb, int k, double energy);
  void carveStaticTntCluster(const std::vector<int>& cells, BlastBatch& bb, BlastBatch* otherBb);
  void carveBlast(int cx, int cy, int radius, double power, BlastBatch& bb, Body* sourceBody = nullptr, uint8_t explosiveMaterial = TNT);
  void finishBlasts(BlastBatch& bb);
  void carveBlastAcrossLayers(int cx, int cy, int radius, double power, BlastBatch& bb, BlastBatch* otherBb, Body* sourceBody = nullptr, uint8_t explosiveMaterial = TNT);
  void finishBlastBatches(BlastBatch& bb, BlastBatch* otherBb);
  void detonate(int cx, int cy, int radius, double power);
  void applyExplosives();

 private:
  Engine& E;
  std::vector<BlastOffset> tntStencil;
  void buildTntStencil();
};
