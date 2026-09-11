StatusState* StatusEffectSystem::find(int kind, int id) {
  if (kind == SA_PLAYER) {
    auto* p = E.psys.findPlayer(id);
    return p && p->active && p->alive ? &p->effects : nullptr;
  }
  if (kind == SA_CREATURE) for (auto& c : E.creatures.creatures)
    if (c.id == id && c.alive) return &c.effects;
  return nullptr;
}

bool StatusEffectSystem::has(const StatusState& state, int effect) const {
  for (const auto& instance : state.instances) if (instance.effect == effect) return true;
  return false;
}

bool StatusEffectSystem::harmful(const StatusState& state) const {
  for (const auto& instance : state.instances)
    if (STATUS_DEFINITIONS[instance.effect].tags & ST_HARMFUL) return true;
  return false;
}

void StatusEffectSystem::rebuild(StatusState& state) const {
  state.movementScale = 1;
  state.controls = state.immunityTags = state.visuals = 0;
  for (const auto& instance : state.instances) {
    const auto& def = STATUS_DEFINITIONS[instance.effect];
    state.movementScale *= std::pow(def.movementScale, instance.strength);
    state.controls |= def.controls;
    state.visuals |= def.visual;
    state.immunityTags |= def.immunityTags;
  }
  state.movementScale = std::clamp(state.movementScale, .1, 3.0);
}

void StatusEffectSystem::clear(StatusState& state) {
  state.instances.clear();
  rebuild(state);
}

int StatusEffectSystem::cleanse(StatusState& state, int tags) {
  size_t before = state.instances.size();
  state.instances.erase(std::remove_if(state.instances.begin(), state.instances.end(),
    [&](const auto& instance) { return !tags || (STATUS_DEFINITIONS[instance.effect].tags & tags); }), state.instances.end());
  if (before != state.instances.size()) rebuild(state);
  return (int)(before - state.instances.size());
}

int StatusEffectSystem::cleanse(int kind, int id, int tags) {
  auto* state = find(kind, id);
  return state ? cleanse(*state, tags) : 0;
}

int StatusEffectSystem::remove(int kind, int id, int effect) {
  auto* state = find(kind, id);
  if (!state) return 0;
  size_t before = state->instances.size();
  state->instances.erase(std::remove_if(state->instances.begin(), state->instances.end(),
    [&](const auto& instance) { return instance.effect == effect; }), state->instances.end());
  if (before != state->instances.size()) rebuild(*state);
  return (int)(before - state->instances.size());
}

int StatusEffectSystem::apply(StatusState& state, int effect, int ticks, int strength,
                              int sourceKind, int sourceId, int immunity) {
  if (effect <= STATUS_NONE || effect >= STATUS_EFFECT_COUNT || ticks < 0 || strength < 1 || strength > 8
      || sourceKind < SA_NONE || sourceKind > SA_CREATURE || sourceId < 0
      || (sourceKind == SA_NONE) != (sourceId == 0)) return SAR_INVALID;
  const auto& def = STATUS_DEFINITIONS[effect];
  if ((state.immunityTags | immunity) & def.tags) return SAR_IMMUNE;
  ticks = ticks ? imin(ticks, def.maxTicks) : def.defaultTicks;
  int count = 0;
  for (auto& instance : state.instances) if (instance.effect == effect) {
    count++;
    if (def.stacking == SSP_INDEPENDENT) continue;
    if (strength < instance.strength) return SAR_WEAKER;
    if (strength > instance.strength) instance.remainingTicks = ticks;
    else if (def.stacking == SSP_EXTEND) instance.remainingTicks = imin(def.maxTicks, instance.remainingTicks + ticks);
    else instance.remainingTicks = imax(instance.remainingTicks, ticks);
    instance.durationTicks = imax(instance.durationTicks, instance.remainingTicks);
    instance.strength = strength; instance.sourceKind = sourceKind; instance.sourceId = sourceId;
    // Reapplication preserves periodic progress, so repeated hits cannot postpone a pulse.
    rebuild(state);
    return SAR_REFRESHED;
  }
  if (count >= def.maxStacks) return SAR_FULL;
  if (def.removeTags) cleanse(state, def.removeTags);
  if (state.instances.size() >= STATUS_MAX_INSTANCES) return SAR_FULL;
  state.instances.push_back({effect, ticks, ticks, def.periodTicks, strength, sourceKind, sourceId});
  rebuild(state);
  return SAR_APPLIED;
}

int StatusEffectSystem::apply(Player& p, int effect, int ticks, int strength, int sourceKind, int sourceId) {
  if (!p.active || !p.alive) return SAR_INVALID;
  int result = apply(p.effects, effect, ticks, strength, sourceKind, sourceId, 0);
  if (result == SAR_APPLIED || result == SAR_REFRESHED) {
    if (p.effects.controls & SC_DISARM) {
      E.magic.cancelCharge(p); E.psys.resetPlayerMine(p); E.inv.resetPlayerPlaceStroke(p);
      p.actionTicks = p.actionDefinition = p.bowChargeTicks = 0; p.actionState = AS_IDLE;
      p.shieldActive = false; p.swordCombo = p.swordComboWindow = 0; p.swordComboQueued = false;
    }
    if (p.effects.controls & SC_ROOT) p.vx = 0;
  }
  return result;
}

int StatusEffectSystem::apply(Creature& c, int effect, int ticks, int strength, int sourceKind, int sourceId) {
  if (!c.alive) return SAR_INVALID;
  int immunity = STATUS_CREATURE_IMMUNITIES[c.species];
  if (E.creatures.isProtectedNpc(c)) immunity |= ST_HARMFUL;
  int result = apply(c.effects, effect, ticks, strength, sourceKind, sourceId, immunity);
  if (result == SAR_APPLIED || result == SAR_REFRESHED) {
    if (c.effects.controls & SC_DISARM) { c.attackState = CAS_IDLE; c.attackTicks = 0; c.attackProgress = 0; }
    if (c.effects.controls & SC_ROOT) c.vx = 0;
  }
  return result;
}

int StatusEffectSystem::apply(int kind, int id, int effect, int ticks, int strength, int sourceKind, int sourceId) {
  if (kind == SA_PLAYER) {
    auto* p = E.psys.findPlayer(id);
    return p ? apply(*p, effect, ticks, strength, sourceKind, sourceId) : SAR_INVALID;
  }
  if (kind == SA_CREATURE) for (auto& c : E.creatures.creatures)
    if (c.id == id) return apply(c, effect, ticks, strength, sourceKind, sourceId);
  return SAR_INVALID;
}

std::pair<int, int> StatusEffectSystem::advance(StatusState& state) {
  int damage = 0, healing = 0;
  bool expired = false;
  for (auto& instance : state.instances) {
    const auto& def = STATUS_DEFINITIONS[instance.effect];
    if (def.periodTicks && --instance.periodTicks == 0) {
      int delta = def.healthDelta * instance.strength;
      if (delta < 0) damage -= delta; else healing += delta;
      instance.periodTicks = def.periodTicks;
    }
    if (--instance.remainingTicks == 0) expired = true;
  }
  if (expired) {
    state.instances.erase(std::remove_if(state.instances.begin(), state.instances.end(),
      [](const auto& instance) { return !instance.remainingTicks; }), state.instances.end());
    rebuild(state);
  }
  return {damage, healing};
}

void StatusEffectSystem::environment(int kind, int id, double x, double y, int w, int h) {
  if ((E.actorTick + id * 7) % 6) return;
  int water = 0, cells = 0;
  bool fire = false;
  int x0 = imax(0, (int)std::floor(x)), x1 = imin(E.cols - 1, (int)std::ceil(x + w) - 1);
  int y0 = imax(0, (int)std::floor(y)), y1 = imin(E.rows - 1, (int)std::ceil(y + h) - 1);
  for (int cy = y0; cy <= y1; cy++) for (int cx = x0; cx <= x1; cx++) {
    uint8_t material = E.fg.grid[E.I(cx, cy)];
    cells++; water += material == WATER || material == BRINE;
    uint8_t hazard = MAT_CONTACT_HAZARD_PROFILE[material];
    fire |= hazard == CHP_FIRE || hazard == CHP_LAVA;
  }
  if (cells && water * 5 >= cells) apply(kind, id, STATUS_WET);
  else if (fire) apply(kind, id, STATUS_BURNING);
}

void StatusEffectSystem::tick(Player& p) {
  if (!p.active || !p.alive) return;
  environment(SA_PLAYER, p.id, p.px, p.py, p.w, p.h);
  auto [damage, healing] = advance(p.effects);
  // Periodic damage bypasses strike immunity, armor, and guard without granting new immunity frames.
  if (damage) { p.health -= damage; p.lastDamageTick = E.actorTick; }
  if (p.health <= 0) { E.psys.killPlayer(p); return; }
  if (healing) p.health = imin(100, p.health + healing);
}

void StatusEffectSystem::tick(Creature& c) {
  if (!c.alive) return;
  const auto& species = E.creatures.species(c);
  environment(SA_CREATURE, c.id, c.wx - E.fg.worldOffsetX, c.wy - E.fg.worldOffsetY, species.w, species.h);
  auto [damage, healing] = advance(c.effects);
  c.health -= damage;
  if (c.health <= 0) { E.creatures.killCreature(c); return; }
  if (healing) c.health = imin(species.maxHealth, c.health + healing);
}

bool StatusEffectSystem::valid(const StatusState& state) const {
  if (state.instances.size() > STATUS_MAX_INSTANCES) return false;
  std::array<int, STATUS_EFFECT_COUNT> counts{};
  for (const auto& instance : state.instances) {
    if (instance.effect <= STATUS_NONE || instance.effect >= STATUS_EFFECT_COUNT) return false;
    const auto& def = STATUS_DEFINITIONS[instance.effect];
    if (++counts[instance.effect] > def.maxStacks || instance.remainingTicks < 1
        || instance.durationTicks < instance.remainingTicks || instance.durationTicks > def.maxTicks
        || instance.strength < 1 || instance.strength > 8
        || instance.sourceKind < SA_NONE || instance.sourceKind > SA_CREATURE || instance.sourceId < 0
        || (instance.sourceKind == SA_NONE) != (instance.sourceId == 0)
        || (def.periodTicks ? instance.periodTicks < 1 || instance.periodTicks > def.periodTicks : instance.periodTicks != 0)) return false;
  }
  return true;
}

int StatusEffectSystem::buildSnapshot() {
  snapshot.clear();
  auto append = [&](const StatusState& state, int kind, int id) {
    if (state.instances.empty()) return;
    for (int effect = 1; effect < STATUS_EFFECT_COUNT; effect++) {
      int remaining = 0, duration = 0, stacks = 0, strength = 0;
      for (const auto& instance : state.instances) if (instance.effect == effect) {
        remaining = imax(remaining, instance.remainingTicks); duration = imax(duration, instance.durationTicks);
        stacks++; strength += instance.strength;
      }
      if (!stacks) continue;
      size_t offset = snapshot.size(); snapshot.resize(offset + STS_STRIDE);
      auto* out = snapshot.data() + offset;
      struct Record { int actorKind, actorId, effect, remainingTicks, durationTicks, stacks, strength; };
      writeStatusSnapshot(out, Record{kind, id, effect, remaining, duration, stacks, strength});
    }
  };
  for (const auto& p : E.psys.players) if (p.active && p.alive) append(p.effects, SA_PLAYER, p.id);
  for (const auto& c : E.creatures.creatures) if (c.alive) append(c.effects, SA_CREATURE, c.id);
  return (int)snapshot.size() / STS_STRIDE;
}
