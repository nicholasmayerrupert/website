ReactionTransaction::ReactionTransaction(Engine& engine, Layer& layer)
    : E(engine), targetLayer(layer) {}

void ReactionTransaction::queue(
    const GeneratedReactionEffect& effect,
    const ReactionSubject& source,
    const ReactionSubject& target,
    double normalX, double normalY) {
  const ReactionSubject& subject = effect.subject == ReactionSubjectSlot::SOURCE
    ? source : target;
  if (subject.layer != &targetLayer || subject.cell < 0) return;
  commands.push_back({effect, subject, normalX, normalY});
}

bool ReactionTransaction::commit() {
  if (commands.empty()) return false;
  Engine::ActiveLayerScope active(E, &targetLayer);
  std::vector<int> removed;
  CellMutationBatch mutations(E, removed);
  struct Spawn {
    int cell;
    uint8_t material;
    ReactionBodyShape shape;
    int radius, halfWidth, halfHeight;
  };
  struct Impulse {
    int bodyId;
    double x, y;
  };
  std::vector<Spawn> spawns;
  std::vector<Impulse> impulses;
  std::vector<int> detachIds;
  bool changed = false;

  auto queueSpawn = [&](int cell, const GeneratedReactionEffect& effect) {
    if (cell < 0 || cell >= E.cols * E.rows
        || targetLayer.grid[cell] != EMPTY
        || targetLayer.bodyOwner[cell] >= 0) return false;
    spawns.push_back({
      cell, effect.material, effect.shape, effect.radius,
      effect.halfWidth, effect.halfHeight,
    });
    return true;
  };
  auto applyCell = [&](int cell, const GeneratedReactionEffect& effect) {
    if (cell < 0 || cell >= E.cols * E.rows) return false;
    switch (effect.op) {
      case ReactionEffectOp::REMOVE:
        return mutations.erase(cell);
      case ReactionEffectOp::PLACE:
        if (targetLayer.grid[cell] != EMPTY
            || targetLayer.bodyOwner[cell] >= 0) return false;
        [[fallthrough]];
      case ReactionEffectOp::REPLACE:
        if (effect.topology == ReactionTopologyPolicy::PRESERVE_OWNER)
          return mutations.replacePreservingOwner(cell, effect.material);
        if (effect.topology == ReactionTopologyPolicy::STATIC)
          return mutations.replaceWithStatic(cell, effect.material);
        if (effect.topology == ReactionTopologyPolicy::BODY
            || (effect.topology == ReactionTopologyPolicy::AUTO
                && MAT_PLACEMENT[effect.material] == MP_STRUCTURE
                && !E.isComponentMaterial(effect.material))) {
          if (targetLayer.grid[cell] != EMPTY && !mutations.erase(cell))
            return false;
          return queueSpawn(cell, effect);
        }
        return mutations.replaceAuto(cell, effect.material);
      case ReactionEffectOp::SPAWN_BODY:
        return queueSpawn(cell, effect);
      case ReactionEffectOp::DETACH:
      case ReactionEffectOp::APPLY_IMPULSE:
        return false;
    }
    return false;
  };

  for (const Command& command : commands) {
    const ReactionSubject& subject = command.subject;
    if (command.effect.op == ReactionEffectOp::APPLY_IMPULSE) {
      if (subject.ownerId >= 0 && subject.topology == RTM_BODY) {
        impulses.push_back({subject.ownerId,
          command.effect.impulseX
            + command.normalX * command.effect.impulseNormal,
          command.effect.impulseY
            + command.normalY * command.effect.impulseNormal});
        changed = true;
      }
      continue;
    }
    if (command.effect.op == ReactionEffectOp::DETACH) {
      if (subject.topology == RTM_COMPONENT && subject.ownerId >= 0) {
        detachIds.push_back(subject.ownerId);
        changed = true;
      }
      continue;
    }
    if (command.effect.scope == ReactionEffectScope::CELL) {
      changed = applyCell(subject.cell, command.effect) || changed;
      continue;
    }
    std::vector<int> ownerCells;
    if (subject.topology == RTM_COMPONENT) {
      for (const Comp& component : targetLayer.components)
        if (component.id == subject.ownerId) {
          ownerCells = component.cells;
          break;
        }
    } else if (subject.topology == RTM_BODY) {
      auto appendOwned = [&](const std::vector<int>& cells) {
        for (int cell : cells)
          if (cell >= 0 && cell < E.cols * E.rows
              && targetLayer.bodyOwner[cell] == subject.ownerId)
            ownerCells.push_back(cell);
      };
      appendOwned(targetLayer.bodyCells);
      appendOwned(targetLayer.passiveBodyCells);
      std::sort(ownerCells.begin(), ownerCells.end());
      ownerCells.erase(std::unique(ownerCells.begin(), ownerCells.end()),
                       ownerCells.end());
    } else {
      ownerCells.push_back(subject.cell);
    }
    for (int cell : ownerCells)
      changed = applyCell(cell, command.effect) || changed;
  }
  mutations.commitGeneral();

  if (!detachIds.empty()) {
    std::sort(detachIds.begin(), detachIds.end());
    detachIds.erase(std::unique(detachIds.begin(), detachIds.end()),
                    detachIds.end());
    std::vector<std::vector<int>> groups;
    for (int id : detachIds)
      for (int index = 0; index < (int)targetLayer.components.size(); index++)
        if (targetLayer.components[index].id == id) {
          groups.push_back({index});
          break;
        }
    if (!groups.empty()) E.comps.detachComponentGroups(targetLayer, groups);
  }
  for (const Spawn& spawn : spawns) {
    int x = spawn.cell % E.cols, y = spawn.cell / E.cols;
    Body* body = nullptr;
    if (spawn.shape == ReactionBodyShape::DISC)
      body = E.rigid.spawnDisc(x, y, spawn.radius, spawn.material);
    else if (spawn.shape == ReactionBodyShape::BOX)
      body = E.rigid.spawnBox(x, y, spawn.halfWidth,
                              spawn.halfHeight, spawn.material);
    else
      body = E.rigid.finishSpawn({{x, y}}, spawn.material, false);
    changed = body != nullptr || changed;
  }
  if (!impulses.empty()) {
    std::unordered_map<int, Body*> bodies;
    for (Body* body : targetLayer.bodies) bodies[body->id] = body;
    for (const Impulse& impulse : impulses) {
      auto found = bodies.find(impulse.bodyId);
      if (found == bodies.end()) continue;
      Body* body = found->second->jointRole == 2
        ? found->second->jointPeer : found->second;
      if (!body || body->actorProxy) continue;
      body->vx += impulse.x * body->invMass;
      body->vy += impulse.y * body->invMass;
      E.rigid.wakeBody(body);
    }
  }
  if (changed) {
    targetLayer.groundDirty = true;
    targetLayer.groundContentDirty = true;
    targetLayer.componentCarryDirty = true;
  }
  return changed;
}
