RigidBodySystem::ContactCacheKey RigidBodySystem::contactCacheKey(
  const Contact& contact, int normalBucket) {
  return ContactCacheKey{
    contact.a->id,
    contact.b ? contact.b->id : -1,
    contact.childA,
    contact.childB,
    contact.featureA,
    contact.featureB,
    contact.a->geometryRevision,
    contact.b ? contact.b->geometryRevision : 0,
    (uint8_t)normalBucket,
    (uint8_t)(contact.b ? contact.b->solverLayer : 2),
    contact.a->solverLayer, contact.layer,
    (uint8_t)(contact.a->maxR >= 24
      || (contact.b && contact.b->maxR >= 24)),
  };
}
void RigidBodySystem::contactLocalAnchors(
  const Contact& contact, double& lax, double& lay, double& lbx, double& lby) {
  Body* A = contact.a;
  lax = contact.rax * A->cs + contact.ray * A->sn;
  lay = -contact.rax * A->sn + contact.ray * A->cs;
  lbx = lby = 0;
  if (!contact.b) return;
  Body* B = contact.b;
  double bcs = contact.bIntegrated ? B->cs : std::cos(B->angle);
  double bsn = contact.bIntegrated ? B->sn : std::sin(B->angle);
  lbx = contact.rbx * bcs + contact.rby * bsn;
  lby = -contact.rbx * bsn + contact.rby * bcs;
}
void RigidBodySystem::restoreContact(
  SubstepState& state, Contact& contact, int normalBucket, double dt) {
  ContactCacheKey key = contactCacheKey(contact, normalBucket);
  ContactCache::iterator found;
  if (state.previousRestoreKeyValid && key == state.previousRestoreKey) {
    found = state.previousRestoreEntry;
  } else {
    found = contactCache.find(key);
    state.previousRestoreKey = key;
    state.previousRestoreEntry = found;
    state.previousRestoreKeyValid = true;
  }
  if (found == contactCache.end()) return;
  double lax, lay, lbx, lby;
  contactLocalAnchors(contact, lax, lay, lbx, lby);
  CachedContact* best = nullptr;
  double bestDistance = 1e18;
  for (CachedContact& cached : found->second) {
    if (cached.used || cached.nx * contact.nx + cached.ny * contact.ny < 0.7)
      continue;
    double dax = cached.lax - lax, day = cached.lay - lay;
    double aDistance = dax * dax + day * day;
    if (aDistance > R_CONTACT_CACHE_MATCH2) continue;
    double distance = aDistance;
    if (contact.b) {
      double dbx = cached.lbx - lbx, dby = cached.lby - lby;
      double bDistance = dbx * dbx + dby * dby;
      if (bDistance > R_CONTACT_CACHE_MATCH2) continue;
      distance += bDistance;
    }
    if (distance < bestDistance) {
      best = &cached;
      bestDistance = distance;
    }
  }
  if (!best) return;
  best->used = true;
  double dtRatio = best->dt > 0 ? dt / best->dt : 1;
  if (dtRatio < 0.25) dtRatio = 0.25;
  else if (dtRatio > 4) dtRatio = 4;
  // Temporal substeps preserve the complete previous manifold impulse for
  // structure-scale contacts. This rule is adapted from Box2D's MIT-licensed
  // contact solver; feature/local-anchor matching above prevents transferring
  // it to a different part of an irregular body.
  // https://github.com/erincatto/box2d/blob/main/src/contact_solver.c
  bool structureContact = contact.a->maxR >= R_SOLVER_HUGE_BODY_RADIUS
    && (!contact.b
      || contact.b->maxR >= R_SOLVER_HUGE_BODY_RADIUS)
    && contact.impactSpeed <= R_STRUCTURE_WARM_START_MAX_IMPACT;
  double warmStartFactor = structureContact
    ? R_STRUCTURE_WARM_START_FACTOR : R_WARM_START_FACTOR;
  contact.accJn = std::fmax(
    0.0, best->jn * dtRatio * warmStartFactor);
  double maxFriction = contact.staticFriction * contact.accJn;
  contact.accJt = best->jt * dtRatio * warmStartFactor;
  if (contact.accJt > maxFriction) contact.accJt = maxFriction;
  else if (contact.accJt < -maxFriction) contact.accJt = -maxFriction;
  contact.persisted = true;
  contact.targetVn = 0;
}
void RigidBodySystem::publishRigidContacts(StepState& step, SubstepState& state, int sub) {
  auto& contacts = solverContactScratch;
  if (step.hasWorldJointBody && sub + 1 == step.substeps) {
    for (int contactIndex = 0;
         contactIndex < (int)contacts.size(); contactIndex++) {
      const Contact& contact = contacts[contactIndex];
      if (contact.b && contact.b->actorProxy) continue;
      double lax, lay, lbx, lby;
      contactLocalAnchors(contact, lax, lay, lbx, lby);
      double initialProjection =
        (contact.a->px + contact.rax) * contact.nx
        + (contact.a->py + contact.ray) * contact.ny;
      if (contact.b)
        initialProjection -=
          (contact.b->px + contact.rbx) * contact.nx
          + (contact.b->py + contact.rby) * contact.ny;
      worldContacts.push_back({
        contact.a->solverLayer,
        contact.b ? contact.b->solverLayer : -1,
        contact.a->id, contact.b ? contact.b->id : -1,
        lax, lay, lbx, lby, contact.nx, contact.ny,
        contact.depth, initialProjection,
        contact.targetVn, contact.staticFriction, contact.dynamicFriction,
        contact.accJn, contact.accJt,
      });
    }
  }
  for (const Contact& contact : contacts) {
    auto proxy = step.actorProxyIndex.find(contact.b);
    if (proxy == step.actorProxyIndex.end() || contact.ny >= -0.35)
      continue;
    step.actorProxies[proxy->second].crushImpulse +=
      contact.accJn * -contact.ny;
  }
  ContactCache& nextContacts = nextContactCacheScratch;
  nextContacts.clear();
  nextContacts.reserve(contactCache.size());
  ContactCacheKey previousStoreKey;
  std::vector<CachedContact>* previousStoreContacts = nullptr;
  for (const Contact& contact : contacts) {
    double lax, lay, lbx, lby;
    contactLocalAnchors(contact, lax, lay, lbx, lby);
    ContactCacheKey key = contactCacheKey(contact, contact.normalBucket);
    if (!previousStoreContacts || !(key == previousStoreKey)) {
      previousStoreContacts = &nextContacts[key];
      previousStoreKey = key;
    }
    previousStoreContacts->push_back({
      lax, lay, lbx, lby, contact.nx, contact.ny,
      contact.accJn, contact.accJt, contact.dt, 0, false,
    });
  }
  // A raster contact can disappear for one substep while a long or slowly
  // rotating face crosses a cell boundary. Retain unmatched anchors briefly
  // with decaying impulses so the manifold reconnects without a cold solve.
  for (auto& entry : contactCache) {
    for (CachedContact cached : entry.second) {
      auto bodyIt = state.bodyIndexById.find(((uint64_t)entry.first.aLayer << 32)
        | (uint32_t)entry.first.aId);
      bool activeKey = bodyIt != state.bodyIndexById.end()
        && state.activeBody[bodyIt->second];
      if (!activeKey) {
        cached.used = false;
        nextContacts[entry.first].push_back(cached);
        continue;
      }
      if (!entry.first.retainMissed) continue;
      if (cached.used || cached.age >= R_CONTACT_CACHE_MISSED_SUBSTEPS)
        continue;
      std::vector<CachedContact>& destination = nextContacts[entry.first];
      if ((int)destination.size() >= R_CONTACT_CACHE_MAX_PER_KEY) break;
      cached.age++;
      cached.jn *= R_CONTACT_CACHE_STALE_DECAY;
      cached.jt *= R_CONTACT_CACHE_STALE_DECAY;
      cached.used = false;
      destination.push_back(cached);
    }
  }
  contactCache.swap(nextContacts);
}

