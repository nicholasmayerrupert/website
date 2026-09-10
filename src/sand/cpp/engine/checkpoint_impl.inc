namespace {
static constexpr uint32_t CHECKPOINT_MAGIC = 0x52455453;
static constexpr uint32_t CHECKPOINT_VERSION = 6;
static constexpr size_t CHECKPOINT_MAX = 192u * 1024u * 1024u;
uint32_t checkpointHash(const uint8_t* data, size_t size) {
  uint32_t hash = 2166136261u;
  for (size_t i = 0; i < size; i++) hash = (hash ^ data[i]) * 16777619u;
  return hash;
}
template<class T> static constexpr bool CHECKPOINT_STRUCTURED =
  std::is_same_v<T, InvSlot> || std::is_same_v<T, Item> || std::is_same_v<T, Projectile> || std::is_same_v<T, Creature>;
struct CheckpointArchive {
  explicit CheckpointArchive(std::vector<uint8_t>& output, bool read = false, bool measure = false)
    : bytes(output), reading(read), measuring(measure) {}
  std::vector<uint8_t>& bytes;
  bool reading = false, measuring = false, valid = true;
  size_t at = 0;
  int layerId = 0;
  uint32_t version = CHECKPOINT_VERSION;
  struct Peer { Body* body; int layer, id; };
  std::vector<Peer> peers;
  std::map<std::pair<int,int>, Body*> bodies;
  void raw(void* value, size_t size) {
    if (!valid || size > CHECKPOINT_MAX || at > CHECKPOINT_MAX - size) { valid = false; return; }
    if (reading) {
      if (at + size > bytes.size()) { valid = false; return; }
      std::memcpy(value, bytes.data() + at, size);
    } else if (!measuring) {
      const auto* p = static_cast<const uint8_t*>(value); bytes.insert(bytes.end(), p, p + size);
    }
    at += size;
  }
  template<class T> std::enable_if_t<std::is_trivially_copyable_v<T>> field(T& value) { raw(&value, sizeof(T)); }
  template<class T, size_t N> std::enable_if_t<!std::is_trivially_copyable_v<T> || CHECKPOINT_STRUCTURED<T>> field(T (&value)[N]) { for (auto& item : value) field(item); }
  template<class... T> void fields(T&... value) { (field(value), ...); }
  template<class A, class B> void field(std::pair<A,B>& value) { fields(value.first,value.second); }
  uint32_t count(size_t size) {
    uint32_t n = (uint32_t)size; field(n);
    if (n > 4000000 || (reading && n > bytes.size() - std::min(at,bytes.size()))) { valid = false; return 0; }
    return n;
  }
  template<class T> void field(std::vector<T>& value) {
    uint32_t n = count(value.size()); if (!valid) return;
    if (reading) value.resize(n);
    if constexpr (std::is_trivially_copyable_v<T> && !std::is_pointer_v<T> && !CHECKPOINT_STRUCTURED<T>) { if (n) raw(value.data(), n * sizeof(T)); }
    else for (auto& item : value) { if (!valid) break; field(item); }
  }
  template<class K, class V, class H> void field(std::unordered_map<K,V,H>& value) { map(value); }
  template<class K, class V> void field(std::map<K,V>& value) { map(value); }
  template<class M> void map(M& value) {
    uint32_t n = count(value.size()); if (!valid) return;
    if (reading) {
      value.clear();
      for (uint32_t i=0;i<n && valid;i++) { typename M::key_type key{}; typename M::mapped_type entry{}; fields(key,entry); if (!value.emplace(std::move(key),std::move(entry)).second) valid=false; }
    } else for (auto& pair : value) { auto key=pair.first; fields(key,pair.second); }
  }
  template<class T> void field(std::unordered_set<T>& value) {
    uint32_t n=count(value.size()); if (!valid) return;
    if (reading) { value.clear(); for (uint32_t i=0;i<n && valid;i++) { T item{}; field(item); value.insert(item); } }
    else for (auto item:value) field(item);
  }
  void field(Comp& v) { fields(v.id,v.plantType,v.cells,v.yMax,v.woodCount,v.leafCount,v.age,v.cacheDirty,v.gravityGrowth,v.grounded,v.bakedAssemblyId,v.growing,v.woodCells,v.seedWoodCells); }
  void field(StoredCompFragment& v) { fields(v.id,v.cellOffsets); }
  void field(InventoryPool& v) { fields(v.entries,v.exactMaterial); }
  void field(WandState& v) { fields(v.spells,v.upgrades,v.links,v.cursor,v.initialized); }
  void field(SpellCast& v) { fields(v.spells,v.connections,v.count,v.nextSlot,v.power,v.shots,v.bounces,v.bonusDamage,v.homing,v.lifetime,v.manaCost,v.cooldown,v.charged); }
  void field(InvSlot& v) {
    static_assert(offsetof(InvSlot,wand) == 16);
    raw(&v,16);
    if (version >= 5) field(v.wand); else if (reading) v.wand = WandState();
  }
  void field(Item& v) {
    static_assert(offsetof(Item,wand) == 64);
    raw(&v,64);
    if (version >= 5) field(v.wand); else if (reading) v.wand = WandState();
  }
  void field(Projectile& v) {
    static_assert(offsetof(Projectile,cast) == 72);
    raw(&v,72);
    if (version >= 5) fields(v.cast,v.spellNode,v.spellTimer,v.spellBounces);
    else if (reading) { v.cast = SpellCast(); v.spellNode = v.spellTimer = v.spellBounces = 0; }
  }
  void field(Creature& v) {
    static_assert(offsetof(Creature, navigation) == 200);
    raw(&v, offsetof(Creature, navigation));
    auto& n = v.navigation;
    if (version >= 6) fields(n.planTicks,n.moveDir,n.jumpCooldown,n.blockedTicks,n.escapeTicks,n.turnCooldown,n.avoidTurn,n.airborneDir,n.arrived);
    else if (reading) v.navigation = CreatureNavigation();
  }
  void field(Player& v) {
    fields(v.id,v.active,v.alive,v.px,v.py,v.spawnWorldX,v.spawnWorldY,v.respawnPending,v.vx,v.vy,v.w,v.h,v.facing,v.grounded,v.selectedTool,v.aimX,v.aimY,v.input,v.inputX,v.inputY,v.analogInput,v.prevInput,v.jumpReady,v.inputSeq,v.health,v.hurtCooldown,v.lastDamageTick,v.shieldHealth,v.shieldHurtCooldown,v.lastShieldDamageTick,v.shieldActive,v.deathTicks,v.buriedTicks,v.bowChargeTicks,v.jetpackFuel,v.jetpackActive,v.landingImpact,v.weaponKick,v.toolCooldown,v.emptyWeaponTriggerLatch,v.mineActive,v.mineLayer,v.mineX,v.mineY,v.mineFootprint,v.heldToolClass,v.heldToolTier,v.inv,v.equipment,v.mana,v.stamina,v.actionTicks,v.actionState,v.actionDuration,v.actionDefinition,v.dodgeCooldown,v.abilities,v.airDashUsed,v.movementPrevInput,v.pools,v.selectedSlot,v.selectedFootprint,v.placeStrokeActive,v.placeStrokeX,v.placeStrokeY,v.placeStrokeLayer,v.placeStrokeFootprint,v.placeStrokeMaterial,v.cursor,v.animState,v.animFrame);
    if (version >= 6) fields(v.swordCombo,v.swordComboWindow,v.swordComboQueued);
    else if (reading) { v.swordCombo = v.swordComboWindow = 0; v.swordComboQueued = false; }
    if (version >= 5) fields(v.manaRecoveryTicks,v.wandChargeTicks,v.pendingCast);
    else if (reading) { v.manaRecoveryTicks = v.wandChargeTicks = 0; v.pendingCast = SpellCast(); }
  }
  void field(AdventureChest& v) { fields(v.id,v.wx,v.wy,v.opened,v.loot); if (version>=3) field(v.packed); else if (reading) v.packed=false; }
  void field(Body& v) { fields(v.id,v.occ,v.w,v.h,v.cellMaterials,v.jointPeerMaterials,v.solverLayer,v.jointRole,v.offsetX,v.offsetY,v.px,v.py,v.angle,v.acceptedWorldPx,v.acceptedWorldPy,v.acceptedAngle,v.acceptedRasterGeometryRevision,v.acceptedRasterPoseValid,v.vx,v.vy,v.omega,v.actorProxy,v.actorVx,v.actorVy,v.material,v.density,v.awake,v.stillTicks,v.worldStillTicks,v.restProbePoints,v.restProbeTicks,v.sleepSupports,v.stampRecoveryStreak,v.stampRecoveryTotal,v.stampRecoveryTick,v.stampPreclaimAttempts,v.stampPreclaimSuccesses,v.stampPreclaimBlocked,v.stampPreclaimOutside,v.stampPreclaimMovedOutside,v.stampPreclaimStartedOutside,v.rasterAssignmentLocked,v.rasterLockCell,v.rasterLockOwner,v.loadedWindowParked,v.blastDebris,v.fuseTicks,v.fuseLocalX,v.fuseLocalY,v.plantType,v.points,v.nPts,v.boundaryPts,v.boundarySamples,v.boundarySampleRadii,v.boundarySampleBlocks,v.erosionBoundaryMask,v.collisionRects,v.collisionSpans,v.collisionTree,v.collisionTreeRoot,v.geometryRevision,v.rasterFootprint,v.rasterWords,v.rasterWordsValid,v.rasterBoundaryFootprint,v.rasterPx,v.rasterPy,v.rasterAngle,v.rasterGeometryRevision,v.rasterCols,v.rasterRows,v.rasterFootprintValid,v.rasterAligned,v.rasterAlignedX,v.rasterAlignedY,v.rasterBounds,v.erodible,v.tightSlenderBounds,v.bakeRasterStableTicks,v.bakeSupportedPoseTicks,v.bakeBlockedByBody,v.invMass,v.invInertia,v.maxR,v.cs,v.sn,v.sweepMargin,v.aabbX0,v.aabbY0,v.aabbX1,v.aabbY1,v.pvx,v.pvy,v.pw,v.spatialForceApplied,v.omegaPre,v.hadContact,v.rasterMayOverlapSolid,v.recentImpactSpeed,v.denseMicrostepTicks,v.bakeRasterSampleTag,v.bakeRasterSignature,v.maxDepth,v.idx); }
  void field(Body*& body) {
    if (reading) body = new Body();
    field(*body);
    int peer = body->jointPeer ? body->jointPeer->id : 0; field(peer);
    if (reading) {
      if (!bodies.emplace(std::make_pair(layerId,body->id),body).second) valid = false;
      if (peer) peers.push_back({body,1-layerId,peer});
    }
  }
  void layer(Layer& v) {
    bool phaseA = v.grid == v.gridA.data(); field(phaseA);
    fields(v.gridA, v.gridB);
    if (reading) { v.grid = phaseA ? v.gridA.data() : v.gridB.data(); v.next = phaseA ? v.gridB.data() : v.gridA.data(); }
#define CHECKPOINT_CHANNEL(name,type,empty,store,encode,decode,accepts,operations) \
    fields(v.name.phaseA,v.name.phaseB,v.store); \
    if (reading) { v.name.current=phaseA?v.name.phaseA.data():v.name.phaseB.data(); v.name.next=phaseA?v.name.phaseB.data():v.name.phaseA.data(); }
    SAND_PERSISTENT_CELL_CHANNELS(CHECKPOINT_CHANNEL)
#undef CHECKPOINT_CHANNEL
    fields(v.worldOffsetX,v.worldOffsetY,v.worldSeed,v.gSurfBase,v.gSeaRow,v.gSoil,v.gCaveSeed,v.gTreeSeed,v.gPocketSeed,v.infinite,v.isBackground,v.chunkStamp,v.vacatedStamp,v.assemblyWakeStamp,v.blastGasStamp,v.rowMarkSpans,v.simOnlyRowMarkSpans,v.activeRowSpans,v.blastSparseCarryReady,v.componentCarryDirty,v.groundedCell,v.cellComp,v.prevCompCells,v.curCompCells,v.prevBodyCells,v.curBodyCells,v.bodyCells,v.passiveBodyCells,v.reactionFlags,v.reactionSteam,v.reactionFires,v.reactionIgnite,v.heatAddedAfterPrepare,v.mineDamage,v.mineDamageAny,v.components,v.growingPlantComponents,v.myceliumComponents,v.iceComponents,v.mobileComponents,v.componentRegistryDirty,v.nextComponentId,v.myceliumActive,v.myceliumSporePresent,v.forceSourcePresent,v.forceActive,v.groundDirty,v.groundContentDirty,v.componentIndexExact,v.componentIndexPatchOnly,v.componentIndexPatches,v.looseGroundDirty,v.looseDirtyX0,v.looseDirtyX1,v.looseDirtyCol,v.looseDirtyFull,v.groundRigidBase,v.groundBaseFlags,v.groundBaseValid,v.compsReshaped,v.deferredSplitIds,v.componentTombstones,v.crossBondedComp,v.compAdjPairs,v.bodies,v.nextBodyId,v.bodyOwner,v.passiveBodyIds,v.sleepingBodySupportDirty,v.pendingDetonations,v.tileStore,v.componentStore,v.componentStateStore,v.componentFragmentRefs,v.componentStateGcCandidates,v.dirtyWorldTiles,v.bodyStore,v.fuseStore);
  }
};
}

static void checkpointState(CheckpointArchive& a, Engine& e) {
  a.fields(e.tick,e.actorTick,e.stepSerial,e.rngState,e.worldShiftCount,e.nextBakedAssemblyId,e.bgEnabled,e.gravityScale,e.survivalInventory);
  auto weather = e.weather.checkpoint(); a.field(weather); if (a.reading) e.weather.restore(weather);
  a.layerId=0; a.layer(e.fg); a.layerId=1; a.layer(e.bg);
  a.fields(e.psys.players,e.psys.nextPlayerId,e.itemsys.items,e.itemsys.nextItemId,e.projectiles.projectiles,e.projectiles.nextId);
  a.fields(e.creatures.creatures,e.creatures.dormantRegions,e.creatures.spawnedVillageResidentSites,e.creatures.pendingSpawns,
    e.creatures.nextCreatureId,e.creatures.encounterThreat,e.creatures.encounterNextTick,e.creatures.ambientNextTick);
  auto& m=e.missions;
  a.fields(m.missionId,m.planetId,m.phase,m.playerId,m.revision,m.threatLevel,m.extractionX,m.extractionY,m.startActorTick,
    m.elapsedTicks,m.recoveredWeaponMask,m.pendingObjective,m.nextThreatActorTick,m.extractionThreatWave,m.extractionTicks,
    m.coreDestabilized,m.objectives,m.residentIds);
  a.fields(e.containers.chests,e.discovery.cells,e.discovery.revision);
  if (a.version >= 4) a.fields(e.worldClock.dayTick, e.worldClock.held, e.beds.beds);
  else if (a.reading) { e.worldClock = WorldClockSystem(); e.beds.beds.clear(); }
}
int CheckpointSystem::write(bool seal) {
  bytes.clear();
  if (E.planetId != PL_FRONTIER || E.storageRole == ESR_PRESENTATION) return 0;
  for (auto& p:E.psys.players) if (E.tools.drafting && E.tools.draftOwner==p.id) E.psys.playerFinalizeSolidDraft();
  uint32_t magic=CHECKPOINT_MAGIC, version=CHECKPOINT_VERSION, worldVersion=WORLD_GENERATION_VERSION;
  int cols=E.cols, rows=E.rows;
  // Reserve the complete snapshot once. Large cell channels must not repeatedly
  // grow/copy the output buffer during an atomic authority capture.
  CheckpointArchive measure{bytes, false, true};
  measure.fields(magic,version,cols,rows,worldVersion);
  checkpointState(measure,E);
  if (!measure.valid || measure.at > CHECKPOINT_MAX - sizeof(uint32_t)) return 0;
  bytes.reserve(measure.at + sizeof(uint32_t));
  CheckpointArchive a{bytes};
  a.fields(magic,version,cols,rows,worldVersion);
  checkpointState(a,E);
  if (!a.valid) { bytes.clear(); return 0; }
  uint32_t checksum=seal ? checkpointHash(bytes.data(),bytes.size()) : 0; a.field(checksum);
  return (int)bytes.size();
}
bool CheckpointSystem::read(const uint8_t* data, int length) {
  if (!data || length < 24 || (size_t)length > CHECKPOINT_MAX || E.planetId != PL_FRONTIER || E.storageRole == ESR_PRESENTATION) return false;
  uint32_t expected; std::memcpy(&expected,data+length-4,4);
  if (checkpointHash(data,length-4)!=expected) return false;
  bytes.assign(data,data+length-4); CheckpointArchive a{bytes,true};
  uint32_t magic=0,version=0,worldVersion=0; int cols=0,rows=0;
  a.fields(magic,version,cols,rows,worldVersion);
  if (magic!=CHECKPOINT_MAGIC || version < 2 || version > CHECKPOINT_VERSION || worldVersion!=WORLD_GENERATION_VERSION || cols!=E.cols || rows!=E.rows) return false;
  for (auto* layer:{&E.fg,&E.bg}) {
    for (auto* body:layer->bodies) delete body;
    for (auto& bucket:layer->bodyStore) for (auto& entry:bucket.second) delete entry.first;
    layer->bodies.clear(); layer->bodyStore.clear();
  }
  a.version=version;
  checkpointState(a,E);
  if (!a.valid || a.at!=bytes.size()) return false;
  if (E.worldClock.dayTick < 0 || E.worldClock.dayTick >= WorldClockSystem::DAY_TICKS) return false;
  const size_t cells=(size_t)E.cols*E.rows;
  for (auto* layer:{&E.fg,&E.bg}) {
    if (layer->gridA.size()!=cells || layer->gridB.size()!=cells || layer->bodyOwner.size()!=cells || layer->cellComp.size()!=cells) return false;
    for (const auto& comp:layer->components) for (int cell:comp.cells) if (cell<0 || (size_t)cell>=cells) return false;
    for (uint8_t mat:layer->gridA) if (!isMaterialId(mat)) return false;
    for (uint8_t mat:layer->gridB) if (!isMaterialId(mat)) return false;
    layer->groundDirty=true; layer->componentRegistryDirty=true; layer->componentIndexExact=false;
    layer->forceSourcePresent=true; layer->prefetchStore.clear();
    std::fill(layer->dirtyRender.begin(),layer->dirtyRender.end(),1);
  }
  for (const auto& peer:a.peers) {
    auto found=a.bodies.find({peer.layer,peer.id}); if (found==a.bodies.end()) return false;
    peer.body->jointPeer=found->second;
  }
  auto migrateSeed=[&](InvSlot& slot){ E.canonicalizeSeed(slot.material,slot.plantType); E.magic.initializeWand(slot); };
  for (auto& chest:E.containers.chests) for (auto& slot:chest.loot) migrateSeed(slot);
  for (auto& p:E.psys.players) {
    for (auto& slot:p.inv) migrateSeed(slot);
    migrateSeed(p.cursor);
    if (!std::isfinite(p.px) || !std::isfinite(p.py) || p.selectedSlot<0 || p.selectedSlot>=INV_HOTBAR) return false;
    p.input=p.prevInput=p.movementPrevInput=0; p.inputX=p.inputY=0;
    // Input acknowledgements belong to the browser session, not the saved world.
    p.inputSeq=0; p.mineActive=false; p.mineChestId=0; p.placeStrokeActive=false;
    p.wandChargeTicks=0;
    if (p.mana < 0 || p.mana > PLAYER_MANA_MAX || p.manaRecoveryTicks < 0 || p.manaRecoveryTicks >= 15) return false;
    for (const auto& slot:p.inv) if ((slot.itemKind==IK_GEAR && slot.definitionId && !E.content.gear(slot.definitionId)) || !E.magic.validItem(slot)) return false;
    for (const auto& slot:p.equipment) if (!E.magic.validItem(slot)) return false;
    if (!E.magic.validItem(p.cursor) || !E.magic.validCast(p.pendingCast)) return false;
    if (version < 5 && p.actionState == AS_CAST && p.actionTicks > p.actionDuration * 2 / 3) {
      InvSlot item; item.itemKind=IK_GEAR; item.definitionId=p.actionDefinition; item.count=1;
      p.pendingCast=E.magic.compileCast(item);
    }
  }
  for (const auto& dropped:E.itemsys.items) {
    InvSlot item; item.itemKind=dropped.itemKind; item.definitionId=dropped.definitionId;
    item.count=dropped.count; item.wand=dropped.wand;
    if (!E.magic.validItem(item)) return false;
  }
  for (const auto& projectile:E.projectiles.projectiles)
    if (!E.magic.validCast(projectile.cast) || projectile.spellNode < 0 || projectile.spellNode >= WAND_MAX_SPELLS ||
        projectile.spellTimer < 0 || projectile.spellTimer > 24 || projectile.spellBounces < 0 || projectile.spellBounces > 8) return false;
  for (const auto& chest:E.containers.chests) for (const auto& slot:chest.loot) if (!E.magic.validItem(slot)) return false;
  if (E.missions.objectives.size()!=E.content.quests.size() || E.missions.residentIds.size()!=E.content.residents.size()) return false;
  E.rigid.clearContactCaches(); E.containers.activeChest=0; E.discovery.revision++;
  return true;
}
