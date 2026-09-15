// Data is scoped to one world tick and passed explicitly between substep phases.
struct RigidBodySystem::SubstepState {
  struct ContactFlags {
    uint8_t solid = 0, upward = 0, body = 0, terrainSides = 0;
  };
  struct Island {
    int bodyCount = 0;
    double maxRadius = 0;
    double minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18;
    uint64_t shockKey = 0x84222325cbf29ce4ULL;
    bool hasGeneral = false, hasPeerContacts = false;
    bool hasSpatialForce = false, hasJointBody = false;
    double biasScale = 1;
    double supportMass = 0, supportMomentX = 0;
    double terrainMinX = 1e18, terrainMaxX = -1e18;
  };
  struct Support {
    double minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18;
    bool other = false;
  };
  std::vector<ContactFlags> contact;
  std::vector<Island> islands;
  std::vector<Support> support;
  std::vector<uint8_t> activeBody;
  std::vector<double> bodyDt;
  std::vector<int> solveParent, contactOrder, contactRoot;
  std::unordered_map<uint64_t, int> bodyIndexById;
  ContactCacheKey previousRestoreKey;
  ContactCache::iterator previousRestoreEntry;
  bool previousRestoreKeyValid = false;
  std::vector<std::pair<int, int>> positionPairs;
  std::vector<uint8_t> terrainAnchored, spatialForceIsland;
  SubstepState(int count, ContactCache& cache)
    : contact(count), islands(count), support(count), activeBody(count, 0),
      bodyDt(count, 0), solveParent(count), previousRestoreEntry(cache.end()) {}
};

static uint64_t rigidBodyKey(Body* body) {
  return ((uint64_t)body->solverLayer << 32) | (uint32_t)body->id;
}
static uint64_t rigidBodyPairKey(int aId, int bId) {
  return ((uint64_t)(uint32_t)aId << 32) | (uint32_t)bId;
}
