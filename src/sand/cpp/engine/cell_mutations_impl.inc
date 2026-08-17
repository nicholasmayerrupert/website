CellMutationBatch::CellMutationBatch(Engine& engine,
                                     std::vector<int>& removedScratch)
    : E(engine)
#ifdef SAND_INVARIANT_CHECKS
    , layer(engine.L)
#endif
    , removed(removedScratch) {
  removed.clear();
}

CellMutationBatch::~CellMutationBatch() {
#ifdef SAND_INVARIANT_CHECKS
  assert(!changed || committed);
#endif
}

void CellMutationBatch::detachOldTopology(int cell, uint8_t oldMaterial) {
  if (E.isBodyCell(cell)) {
    if (bodyById.empty())
      for (Body* body : E.L->bodies) bodyById[body->id] = body;
    if (!E.rigid.eraseBodyCellIndex(cell, bodyById, dirtyBodies)) {
      E.L->grid[cell] = EMPTY;
      E.L->bodyOwner[cell] = -1;
    }
    return;
  }
  if (E.isComponentMaterial(oldMaterial)) {
    canceledRemovals.erase(cell);
    removedMaterialByCell[cell] = oldMaterial;
    removed.push_back(cell);
    if (E.isPlantMaterial(oldMaterial)) removedPlantTopology = true;
    else removedNonPlantTopology = true;
  }
}

bool CellMutationBatch::hasStaticMembership(int cell) {
  if (E.L->componentIndexExact) return E.L->cellComp[cell] >= 0;
  if (!staticMembershipBuilt) {
    staticMembershipGeneration = E.L->nextSeenGeneration();
    for (const Comp& component : E.L->components)
      for (int member : component.cells)
        E.L->seenStamp[member] = staticMembershipGeneration;
    staticMembershipBuilt = true;
  }
  return E.L->seenStamp[cell] == staticMembershipGeneration;
}

bool CellMutationBatch::replaceImpl(int cell, uint8_t material,
                                    bool queueStatic) {
#ifdef SAND_INVARIANT_CHECKS
  assert(E.L == layer);
#endif
  if (cell < 0 || cell >= E.cols * E.rows || !isMaterialId(material)) return false;
  if (E.isComponentMaterial(material) && !queueStatic) return false;
  uint8_t oldMaterial = E.L->grid[cell];
  if (oldMaterial == material) {
    if (queueStatic) {
      if (E.isBodyCell(cell) || hasStaticMembership(cell)) return false;
      createdStatic.push_back({cell, material});
      changed = true;
      return true;
    }
    return false;
  }
  detachOldTopology(cell, oldMaterial);
  E.writeGridIndexUnsafe(cell, material);
  changed = true;
  if (queueStatic) createdStatic.push_back({cell, material});
  return true;
}

bool CellMutationBatch::replaceLoose(int cell, uint8_t material) {
  if (!isMaterialId(material) || MAT_PLACEMENT[material] == MP_STRUCTURE)
    return false;
  return replaceImpl(cell, material, false);
}

bool CellMutationBatch::replaceAuto(int cell, uint8_t material) {
  if (!isMaterialId(material)) return false;
  if (MAT_PLACEMENT[material] != MP_STRUCTURE)
    return replaceLoose(cell, material);
  if (E.isComponentMaterial(material))
    return replaceWithStatic(cell, material);
  return false;
}

int CellMutationBatch::componentOwnerIndex(int cell) {
  if (cell < 0 || cell >= E.cols * E.rows) return -1;
  if (E.L->componentIndexExact) return E.L->cellComp[cell];
  int owner = -1;
  for (size_t index = 0; index < E.L->components.size(); index++) {
    const Comp& component = E.L->components[index];
    if (std::find(component.cells.begin(), component.cells.end(), cell)
        == component.cells.end()) continue;
    if (owner >= 0) return -1;
    owner = (int)index;
  }
  return owner;
}

bool CellMutationBatch::replacePreservingOwner(int cell, uint8_t material) {
  if (!isMaterialId(material) || cell < 0 || cell >= E.cols * E.rows)
    return false;
  if (E.isBodyCell(cell)) {
    if (MAT_PLACEMENT[material] != MP_STRUCTURE) return replaceAuto(cell, material);
    if (bodyById.empty())
      for (Body* body : E.L->bodies) bodyById[body->id] = body;
    bool replaced = E.rigid.replaceBodyCellMaterialIndex(
      cell, material, bodyById, dirtyBodies);
    changed = changed || replaced;
    return replaced;
  }
  int owner = componentOwnerIndex(cell);
  if (owner >= 0 && E.isComponentMaterial(material))
    return replaceAttached(cell, material, owner);
  return replaceAuto(cell, material);
}

bool CellMutationBatch::replaceWithStatic(int cell, uint8_t material) {
  if (!E.isComponentMaterial(material)) return false;
  return replaceImpl(cell, material, true);
}

bool CellMutationBatch::replaceAttached(int cell, uint8_t material,
                                        int componentIndex) {
#ifdef SAND_INVARIANT_CHECKS
  assert(E.L == layer);
#endif
  if (cell < 0 || cell >= E.cols * E.rows
      || !E.isComponentMaterial(material) || componentIndex < 0
      || componentIndex >= (int)E.L->components.size()
      || E.isBodyCell(cell)) return false;

  int owner = -1;
  if (E.L->componentIndexExact) {
    owner = E.L->cellComp[cell];
  } else {
    for (size_t index = 0; index < E.L->components.size(); index++) {
      const Comp& component = E.L->components[index];
      if (std::find(component.cells.begin(), component.cells.end(), cell)
          == component.cells.end()) continue;
      if (owner >= 0 && owner != (int)index) return false;
      owner = (int)index;
    }
  }
  // Component ownership is exclusive. Moving a live member would make the
  // deferred removal ambiguous and can shift positional indexes at commit.
  if (owner >= 0 && owner != componentIndex) return false;

  Comp& component = E.L->components[componentIndex];
  uint8_t oldMaterial = E.L->grid[cell];
  auto removedMaterial = removedMaterialByCell.find(cell);
  uint8_t memberMaterial = oldMaterial;
  if (owner == componentIndex && !E.isComponentMaterial(memberMaterial)
      && removedMaterial != removedMaterialByCell.end())
    memberMaterial = removedMaterial->second;
  if (owner == componentIndex && oldMaterial == material) {
    canceledRemovals.insert(cell);
    removedMaterialByCell.erase(cell);
    return false;
  }

  bool roleKnown = false, componentIsPlant = false;
  auto cachedRole = attachmentRoleByComponent.find(componentIndex);
  if (cachedRole != attachmentRoleByComponent.end()) {
    componentIsPlant = cachedRole->second != 0;
    roleKnown = true;
  } else {
    for (int member : component.cells) {
      uint8_t existingMaterial = E.L->grid[member];
      if (!E.isComponentMaterial(existingMaterial)) continue;
      componentIsPlant = E.isPlantMaterial(existingMaterial);
      roleKnown = true;
      break;
    }
    if (!roleKnown && owner == componentIndex
        && E.isComponentMaterial(memberMaterial)) {
      componentIsPlant = E.isPlantMaterial(memberMaterial);
      roleKnown = true;
    }
    if (roleKnown)
      attachmentRoleByComponent[componentIndex] = componentIsPlant ? 1 : 0;
  }
  bool productIsPlant = E.isPlantMaterial(material);
  if (roleKnown && componentIsPlant != productIsPlant) return false;
  if (!roleKnown)
    attachmentRoleByComponent[componentIndex] = productIsPlant ? 1 : 0;
  if (productIsPlant && roleKnown && E.materialEncodesPlantType(material)
      && component.plantType != E.plantTypeFromMaterial(material)) return false;

  if (owner == componentIndex) {
    // Replacing a member's material keeps its topology. Cancel every queued
    // removal of this cell once, then compact the batch in its commit epilogue.
    canceledRemovals.insert(cell);
    removedMaterialByCell.erase(cell);
  }
  E.writeGridIndexUnsafe(cell, material);
  changed = true;
  if (owner < 0) {
    component.cells.push_back(cell);
    E.noteComponentIndexAddition(componentIndex, cell);
    component.yMax = imax(component.yMax, cell / E.cols);
  }
  component.cacheDirty = true;
  E.L->componentCarryDirty = true;
  E.L->componentRegistryDirty = true;
  if (productIsPlant) {
    if (owner == componentIndex) {
      if (E.isPlantWood(memberMaterial) && component.woodCount > 0)
        component.woodCount--;
      else if (E.isPlantLeaf(memberMaterial) && component.leafCount > 0)
        component.leafCount--;
    }
    if (E.isPlantWood(material)) component.woodCount++;
    else if (E.isPlantLeaf(material)) component.leafCount++;
    if (E.materialEncodesPlantType(material))
      component.plantType = E.plantTypeFromMaterial(material);
    if (E.isSeedMaterial(material)) component.growing = true;
  }
  return true;
}

void CellMutationBatch::compactCanceledRemovals() {
  if (!canceledRemovals.empty()) {
    removed.erase(
      std::remove_if(removed.begin(), removed.end(), [&](int cell) {
        return canceledRemovals.count(cell) != 0;
      }), removed.end());
    canceledRemovals.clear();
  }
  removedPlantTopology = false;
  removedNonPlantTopology = false;
  for (int cell : removed) {
    auto oldMaterial = removedMaterialByCell.find(cell);
    if (oldMaterial != removedMaterialByCell.end()
        && E.isPlantMaterial(oldMaterial->second))
      removedPlantTopology = true;
    else
      removedNonPlantTopology = true;
  }
  removedMaterialByCell.clear();
}

void CellMutationBatch::commitBodiesOnly() {
#ifdef SAND_INVARIANT_CHECKS
  assert(E.L == layer);
#endif
  compactCanceledRemovals();
  if (!finishedBodies) {
    E.rigid.finishErasedBodies(dirtyBodies, E.L->bodyCells);
    finishedBodies = true;
  }
  committed = true;
}

void CellMutationBatch::registerCreatedStatic() {
  if (createdStatic.empty()) return;
  std::map<uint8_t, std::unordered_set<int>> byMaterial;
  for (const auto& entry : createdStatic) {
    if (E.L->grid[entry.first] == entry.second)
      byMaterial[entry.second].insert(entry.first);
  }
  for (auto& entry : byMaterial) {
    uint8_t material = entry.first;
    std::unordered_set<int>& cells = entry.second;
    if (E.isPlantMaterial(material)) {
      int yMax = 0;
      for (int cell : cells) yMax = imax(yMax, cell / E.cols);
      E.comps.registerPlantCells(material, cells, yMax);
    } else {
      E.comps.registerRigidCellsSplit(E.L->components, E.L->nextComponentId,
                                material, cells, E.isIceMaterial(material));
    }
  }
  createdStatic.clear();
}

void CellMutationBatch::commitGeneral() {
  commitBodiesOnly();
  if (!removed.empty())
    E.comps.splitRigidAfterErase(E.L->components, removed,
                           E.L->nextComponentId, false);
  registerCreatedStatic();
  committed = true;
}

void CellMutationBatch::commitPlantErosion(bool indexedExact,
                                           bool deferJointRefresh) {
  commitBodiesOnly();
  if (removedNonPlantTopology) {
    E.comps.splitRigidAfterErase(E.L->components, removed, E.L->nextComponentId,
                           false);
  } else {
    E.comps.finishPlantErosion(removed, indexedExact, deferJointRefresh);
  }
  registerCreatedStatic();
  committed = true;
}

void CellMutationBatch::commitPlantSplit(bool markGroundDirty,
                                         bool deferJointRefresh) {
  commitBodiesOnly();
  if (removedNonPlantTopology) {
    E.comps.splitRigidAfterErase(E.L->components, removed, E.L->nextComponentId,
                           false, markGroundDirty);
  } else if (!removed.empty())
    E.comps.splitPlantAfterErase(&removed, -1, markGroundDirty, false,
                           deferJointRefresh);
  registerCreatedStatic();
  committed = true;
}

void CellMutationBatch::commitRigidErosion(
    bool iceCache, bool markGroundDirty, int indexedOffset,
    ConnectivitySplitMode splitMode) {
  commitBodiesOnly();
  if (!removed.empty())
    E.comps.splitRigidAfterErase(E.L->components, removed, E.L->nextComponentId,
                           iceCache, markGroundDirty, indexedOffset, splitMode);
  registerCreatedStatic();
  committed = true;
}
