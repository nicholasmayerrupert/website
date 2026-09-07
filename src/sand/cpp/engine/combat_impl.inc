bool CombatSystem::hasCharm(const Player& p, int id) const {
  return p.equipment[7].definitionId == id || p.equipment[8].definitionId == id;
}
int CombatSystem::defense(const Player& p) const {
  int amount = hasCharm(p, 223) ? 4 : 0;
  for (const auto& item : p.equipment) if (item.count) {
    const auto* gear = E.content.gear(item.definitionId);
    if (gear) amount += gear->defense;
  }
  return imin(45, amount);
}
bool CombatSystem::canGuard(const Player& p) const {
  return p.equipment[6].count && p.stamina > 0 && (p.actionTicks == 0 || p.actionState == AS_GUARD_RAISE || p.actionState == AS_GUARD_HIT);
}
void CombatSystem::tick(Player& p) {
  if (!p.alive) return;
  if (p.dodgeCooldown > 0) p.dodgeCooldown--;
  if (p.actionTicks > 0) {
    p.actionTicks--;
    const auto* gear = E.content.gear(p.actionDefinition);
    if (gear && p.actionTicks == p.actionDuration * 2 / 3) strike(p, *gear);
  }
  if (!p.shieldActive && p.actionTicks == 0 && E.actorTick % 3 == 0) p.stamina = imin(100, p.stamina + 2);
  if (E.actorTick % (hasCharm(p, 221) ? 8 : 15) == 0) p.mana = imin(100, p.mana + 1);
  if (hasCharm(p, 220) && E.actorTick - p.lastDamageTick > 300 && E.actorTick % 120 == 0)
    p.health = imin(100, p.health + 1);
}
void CombatSystem::apply(Player& p, int previousInput) {
  const auto& held = p.inv[p.selectedSlot];
  const auto* gear = E.content.gear(held.definitionId);
  if (!gear || held.count <= 0 || p.actionTicks || p.shieldActive) return;
  bool primary = (p.input & PI_PRIMARY) != 0;
  if (gear->family == 4) {
    if (primary) { p.bowChargeTicks = imin(BOW_CHARGE_MAX, p.bowChargeTicks + 1); return; }
    if ((previousInput & PI_PRIMARY) && p.bowChargeTicks && p.stamina >= gear->stamina) {
      bool arrow = false;
      for (auto& s : p.inv) if (s.itemKind == IK_ARROW && s.count) { if (!--s.count) s = InvSlot(); arrow = true; break; }
      if (arrow) {
        E.projectiles.spawnArrow(p, .25 + .75 * p.bowChargeTicks / BOW_CHARGE_MAX);
        p.stamina -= gear->stamina; p.actionState = AS_BOW; p.actionTicks = p.actionDuration = gear->cooldown;
        p.actionDefinition = 0; E.playerActionCount++;
      }
      p.bowChargeTicks = 0;
    }
    return;
  }
  if (!primary || p.stamina < gear->stamina || p.mana < gear->mana) return;
  if (gear->family > 5 && gear->family != 9 && gear->family != 10) return;
  if (gear->family == 10 && (previousInput & PI_PRIMARY)) return;
  p.stamina -= gear->stamina; p.mana -= gear->mana;
  p.actionDefinition = gear->id;
  p.actionTicks = p.actionDuration = gear->cooldown;
  p.actionState = gear->family == 1 ? AS_SWORD : gear->family == 2 ? AS_AXE : gear->family == 3 ? AS_SPEAR : gear->family == 10 ? AS_DRINK : AS_CAST;
  p.weaponKick = 1;
  if (gear->family <= 3) E.audio.emit(SE_SWING,p.px,p.py,.7,EMPTY);
  E.playerActionCount++;
}
void CombatSystem::strike(Player& p, const ContentGear& gear) {
  if (gear.family == 10) {
    auto& held = p.inv[p.selectedSlot];
    if (held.definitionId != gear.id || held.count <= 0) return;
    if (gear.id == 320) p.health = imin(100, p.health + gear.power);
    else p.mana = imin(100, p.mana + gear.power);
    if (!--held.count) held = InvSlot();
    return;
  }
  double cx = p.px + p.w * .5, cy = p.py + p.h * .42;
  double dx = p.aimX - cx, dy = p.aimY - cy, distance = std::hypot(dx, dy);
  if (distance < .01) { dx = p.facing; dy = 0; distance = 1; }
  dx /= distance; dy /= distance;
  if ((gear.family == 5 || gear.family == 9) && gear.spell != 6) {
    Projectile bolt; bolt.id = E.projectiles.nextId++; bolt.owner = p.id; bolt.kind = PK_RUNE; bolt.fuse = gear.id;
    bolt.px = cx; bolt.py = cy; bolt.vx = dx * 2.8; bolt.vy = dy * 2.8; bolt.life = imax(1, (int)std::ceil(gear.reach / 2.8));
    E.projectiles.projectiles.push_back(bolt); E.audio.emit(SE_RUNE, cx, cy, .6, (uint8_t)gear.spell); return;
  }
  double reach = gear.family <= 3 ? gear.reach : std::min((double)gear.reach, distance);
  double tx = cx, ty = cy;
  for (double at = 1; at <= reach; at += .5) {
    tx = cx + dx * at; ty = cy + dy * at;
    if (E.psys.playerCellSolid((int)tx, (int)ty)) break;
  }
  impact(p, gear, cx, cy, tx, ty, dx, dy);
}
void CombatSystem::impact(Player& p, const ContentGear& gear, double cx, double cy, double tx, double ty, double dx, double dy) {
  int damage = gear.power + (hasCharm(p, 225) ? 5 : 0);
  int spell = gear.spell;
  for (auto& creature : E.creatures.creatures) {
    if (spell == 6 || !creature.alive || E.creatures.isProtectedNpc(creature) || creature.hurtCooldown > 0) continue;
    const auto& species = E.creatures.species(creature);
    double x = creature.wx - E.fg.worldOffsetX + species.w * .5;
    double y = creature.wy - E.fg.worldOffsetY + species.h * .5;
    double vx = x - cx, vy = y - cy, length = std::hypot(vx, vy);
    bool hit = gear.family <= 3
      ? length <= std::hypot(tx - cx, ty - cy) + species.w * .5 &&
        (vx * dx + vy * dy) / std::max(1.0, length) > (gear.family == 3 ? .87 : .20)
      : std::hypot(x - tx, y - ty) < 9 + species.w * .5;
    if (!hit) continue;
    if (gear.family <= 3 && length > .01) {
      bool blocked = false;
      for (double at = .5; at < length-species.w*.4; at+=.5)
        if (E.psys.playerCellSolid((int)(cx+vx*at/length),(int)(cy+vy*at/length))) { blocked=true; break; }
      if (blocked) continue;
    }
    creature.health -= damage; creature.hurtCooldown = 15;
    if (spell == 1) creature.burnTicks = 120;
    if (spell == 2) creature.slowTicks = 150;
    if (spell == 5) creature.rootTicks = 90;
    creature.vx += dx * (spell == 3 ? 3.5 : gear.family == 2 ? 1.5 : .6);
    creature.vy -= spell == 3 ? 1.6 : .35;
    if (spell == 2 || spell == 5) { creature.attackCooldown = imax(60, creature.attackCooldown); creature.vx *= .15; }
    E.audio.emit(SE_CREATURE, x, y, .8, creature.species);
    if (creature.health <= 0) E.creatures.killCreature(creature);
  }
  if (gear.family == 2 || spell == 4) {
    E.explosives.detonate((int)tx, (int)ty, spell == 4 ? 9 : 3, spell == 4 ? 17.0 : 4.0,
      p.id, STONE, UINT32_MAX, SE_BREAK, 0.0);
  } else if (spell == 1) {
    E.tools.paintDisc((int)tx, (int)ty, 2, FIRE, false);
  } else if (spell == 2) {
    Engine::ActiveLayerScope scope(E, &E.fg);
    std::vector<int> removed;
    CellMutationBatch frozen(E, removed);
    for (int y = imax(1,(int)ty-5); y <= imin(E.rows-2,(int)ty+5); y++)
      for (int x = imax(1,(int)tx-5); x <= imin(E.cols-2,(int)tx+5); x++)
        if ((x-tx)*(x-tx)+(y-ty)*(y-ty)<=25 && E.fg.grid[E.I(x,y)]==WATER) frozen.replaceWithStatic(E.I(x,y), ICE);
    frozen.commitGeneral();
  } else if (spell == 3) {
    E.explosives.detonate((int)tx, (int)ty, 5, 2.0, p.id, EMPTY, UINT32_MAX, SE_JUMP, 0.0);
  } else if (spell == 5) {
    p.health = imin(100, p.health + 5);
    int x0, y0;
    if (E.tools.getSeedOrigin((int)tx, (int)ty, x0, y0)) E.tools.placeSeedAtTyped(x0, y0, 0);
  } else if (spell == 6) p.health = imin(100, p.health + 32);
  E.audio.emit(SE_IMPACT, cx, cy, .55, STONE);
}

// Fantasy enemies commit to a telegraphed point before resolving their strike.
void CombatSystem::enemyAttack(Creature& c) {
  const auto& species = E.creatures.species(c);
  bool boss = c.species >= CS_THORNBOUND_HART && c.species <= CS_HOLLOW_BELLKEEPER;
  bool heavy = boss || c.species == CS_ROOT_KNIGHT || c.species == CS_QUARRY_FOREMAN || c.species == CS_REACTOR_WARDEN;
  bool enraged = c.health * 2 < species.maxHealth;
  int windup = heavy ? (enraged ? 42 : 60) : 26;
  bool ring = (c.species == CS_HOLLOW_BELLKEEPER && c.attackPattern == 0) || (heavy && c.attackPattern == 2 && c.species != CS_MIRE_MATRON);
  int duration = ring ? 50 : 18;
  double x = c.wx + species.w * .5, y = c.wy + species.h * .5;
  double localX = x - E.fg.worldOffsetX, localY = y - E.fg.worldOffsetY;
  if (c.attackState == CAS_FIRING) {
    int tick = c.attackTicks++;
    c.attackProgress = 1 - c.attackTicks / (double)duration;
    bool contact = (c.species == CS_THORNBOUND_HART && c.attackPattern == 0) || c.species == CS_BRIAR_WOLF || c.species == CS_FOX || c.species == CS_BONE_GUARD;
    bool toll = ring;
    bool archer = c.species == CS_MINIGUNNER;
    if (tick == 0 && archer) {
      double dx=c.attackAimX-x,dy=c.attackAimY-y,d=std::max(1.0,std::hypot(dx,dy));
      Projectile arrow; arrow.id=E.projectiles.nextId++; arrow.owner=-c.id; arrow.kind=PK_ARROW;
      arrow.px=localX; arrow.py=localY; arrow.vx=dx/d*3.5; arrow.vy=dy/d*3.5-.2;
      arrow.fuse=species.damage; arrow.charge=.7; E.projectiles.projectiles.push_back(arrow);
      E.audio.emit(SE_BOW,localX,localY,.7,EMPTY);
    }
    if (contact) c.vx = c.facing * (heavy ? 2.1 : 1.35);
    if (tick == 0 && !ring && (c.species == CS_CINDER_CASTELLAN || c.species == CS_ROOT_KNIGHT)) {
      E.explosives.detonate((int)c.attackAimX - E.fg.worldOffsetX, (int)c.attackAimY - E.fg.worldOffsetY,
        heavy ? 8 : 5, 9, 0, STONE, UINT32_MAX, SE_IMPACT, 0.0, false, c.id);
      E.tools.paintDisc((int)c.attackAimX - E.fg.worldOffsetX, (int)c.attackAimY - E.fg.worldOffsetY, 2, FIRE, false);
    }
    if (tick == 0 && c.species == CS_MIRE_MATRON) {
      for (int side = (c.attackPattern == 1 ? -2 : -1); side <= (c.attackPattern == 1 ? 2 : 1); side++)
        E.tools.paintDisc((int)c.attackAimX - E.fg.worldOffsetX + side * 20, (int)c.attackAimY - E.fg.worldOffsetY, 4, WATER, false);
    }
    for (auto& p : E.psys.players) {
      if (!p.active || !p.alive) continue;
      double px = p.px + E.fg.worldOffsetX + p.w*.5, py = p.py + E.fg.worldOffsetY + p.h*.5;
      bool hit = false;
      if (toll) {
        double radius = 8 + tick * 1.4;
        hit = std::fabs(std::hypot(px-x, py-y) - radius) < 3 && (tick % 3 == 0);
      } else if (contact) hit = std::hypot(px-x, py-y) < species.w*.5 + 5;
      else if (tick == 0 && !archer) {
        int spread = heavy && c.attackPattern == 1 ? 1 : 0;
        if (c.species == CS_MIRE_MATRON) spread = c.attackPattern == 1 ? 2 : 1;
        for (int side = -spread; side <= spread; side++)
          hit |= std::hypot(px-c.attackAimX-side*20, py-c.attackAimY) < (heavy ? 13 : 7);
      }
      if (hit) E.psys.damagePlayer(p, heavy ? (enraged ? 28 : 22) : imin(18,species.damage), 30, localX, localY);
    }
    if (c.attackTicks >= duration) {
      c.attackState = CAS_IDLE; c.attackTicks = 0; c.attackProgress = 0;
      c.attackPattern = (c.attackPattern + 1) % 3; c.attackCooldown = heavy ? 72 : 58;
    }
    return;
  }
  if (c.attackState == CAS_CHARGING) {
    c.attackTicks++; c.attackProgress = c.attackTicks / (double)windup;
    if (c.attackTicks >= windup) {
      c.attackState = CAS_FIRING; c.attackTicks = 0; c.attackProgress = 1;
      if (c.species == CS_THORNBOUND_HART || c.species == CS_BRIAR_WOLF) c.vy = -1.3;
      E.audio.emit(SE_CREATURE, localX, localY, 1, c.species);
    }
    return;
  }
  if (c.attackCooldown > 0) return;
  double tx, ty;
  if (!E.creatures.targetPoint(c, tx, ty, nullptr, nullptr)) return;
  double range = heavy ? 80 : (c.species == CS_FOX || c.species == CS_BRIAR_WOLF || c.species == CS_BONE_GUARD ? 22 : 52);
  if (std::hypot(tx-x, ty-y) > range) return;
  c.attackAimX = tx; c.attackAimY = ty; c.facing = tx >= x ? 1 : -1;
  c.attackState = CAS_CHARGING; c.attackTicks = 0; c.attackProgress = 0;
}
