MagicSystem::WandPose MagicSystem::wandPose(double x, double y, int facing, double aimX, double aimY,
                                           double bodyBob) const {
  WandPose pose{};
  pose.shoulderX = x + PLAYER_W * .5 + (E.planetId == PL_FRONTIER ? .3 : 0);
  pose.shoulderY = y + (E.planetId == PL_FRONTIER
    ? PLAYER_H - E.content.spriteHeight * E.content.pixelScale * .60 : PLAYER_H * .42) + bodyBob;
  double dx = aimX - pose.shoulderX, dy = aimY - pose.shoulderY, distance = std::hypot(dx, dy);
  if (distance < .01) { dx = facing; dy = 0; distance = 1; }
  // A downward cast extends the hand outward so the crystal clears the legs.
  double vertical = dy / distance;
  pose.handX = pose.shoulderX + facing * (2.35 + std::max(0.0, vertical) * .8);
  pose.handY = pose.shoulderY + 1.35 + vertical * (vertical > 0 ? -.35 : .9);
  dx = aimX - pose.handX; dy = aimY - pose.handY; distance = std::hypot(dx, dy);
  if (distance < .01) { dx = facing; dy = 0; distance = 1; }
  pose.dx = dx / distance; pose.dy = dy / distance;
  // The crystal's forward edge in the grip-relative, rotated 16x16 wand icon.
  constexpr double forward = 3.85, side = -.21;
  pose.tipX = pose.handX + pose.dx * forward - pose.dy * side;
  pose.tipY = pose.handY + pose.dy * forward + pose.dx * side;
  return pose;
}

void MagicSystem::tickMana(Player& p) {
  p.mana = std::clamp(p.mana, 0, PLAYER_MANA_MAX);
  if (!p.alive) { cancelCharge(p); p.pendingCast = SpellCast(); return; }
  if (p.mana == PLAYER_MANA_MAX) { p.manaRecoveryTicks = 0; return; }
  int interval = E.combat.hasCharm(p, 221) ? 8 : 15;
  if (++p.manaRecoveryTicks >= interval) {
    p.manaRecoveryTicks = 0; restoreMana(p, 1);
  }
}
bool MagicSystem::spendMana(Player& p, int cost) {
  if (cost < 0 || !p.alive || p.mana < cost) return false;
  p.mana -= cost; return true;
}
void MagicSystem::restoreMana(Player& p, int amount) {
  p.mana = std::clamp(p.mana + std::clamp(amount, 0, PLAYER_MANA_MAX), 0, PLAYER_MANA_MAX);
}
void MagicSystem::resetMana(Player& p) {
  p.mana = PLAYER_MANA_MAX; p.manaRecoveryTicks = 0;
  cancelCharge(p); p.pendingCast = SpellCast();
}
bool MagicSystem::continuous(const SpellCast& cast) const {
  const auto* gear = cast.count ? E.content.gear(cast.spells[0]) : nullptr;
  return gear && (gear->spell == SP_WINTERBREATH || gear->spell == SP_SPARKS);
}
void MagicSystem::cancelCharge(Player& p) {
  p.wandChargeTicks = 0; p.heldCast = SpellCast(); p.wandHoldSpent = true;
}
void MagicSystem::apply(Player& p, int previousInput) {
  bool primary = (p.input & PI_PRIMARY) != 0;
  if (!primary || !(previousInput & PI_PRIMARY)) {
    p.heldCast = SpellCast(); p.wandHoldSpent = false;
  }
  auto& item = p.inv[p.selectedSlot];
  initializeWand(item);
  SpellCast cast = p.heldCast.count ? p.heldCast : compileCast(item);
  if (!cast.count || p.shieldActive || (p.effects.controls & SC_DISARM)) { cancelCharge(p); return; }
  if (p.actionTicks > 0) return;
  bool stream = continuous(cast);
  if (p.wandHoldSpent && !p.heldCast.count) return;
  if (cast.charged) {
    if (primary) {
      int next = imin(WAND_CHARGE_TICKS + 1, p.wandChargeTicks + 1);
      if (compileCast(item, next).manaCost <= p.mana) p.wandChargeTicks = next;
      return;
    }
    if (!(previousInput & PI_PRIMARY) || p.wandChargeTicks == 0) return;
    cast = compileCast(item, p.wandChargeTicks); p.wandChargeTicks = 0;
  } else if (!primary) return;
  if (!spendMana(p, cast.manaCost)) return;
  cast.bonusDamage = E.combat.hasCharm(p, 225) ? 5 : 0;
  if (!p.wandHoldSpent) item.wand.cursor = cast.nextSlot;
  p.wandHoldSpent = true;
  if (stream) p.heldCast = cast;
  p.pendingCast = cast;
  p.actionDefinition = item.definitionId;
  p.actionTicks = p.actionDuration = imax(3, cast.cooldown);
  p.actionState = AS_CAST; p.weaponKick = 1;
  if (stream) fire(p);
  E.playerActionCount++;
}
void MagicSystem::fire(Player& p) {
  if (!p.pendingCast.count) return;
  SpellCast cast = p.pendingCast; p.pendingCast = SpellCast();
  const auto pose = wandPose(p.px, p.py, p.facing, p.aimX, p.aimY);
  double x = pose.tipX, y = pose.tipY;
  double cx = p.px + p.w * .5, cy = p.py + p.h * .42;
  int steps = imax(1, (int)std::ceil(std::hypot(x - cx, y - cy) / .25));
  for (int step = 1; step <= steps; step++) {
    double t = (double)step / steps;
    if (!E.psys.playerCellSolid((int)std::floor(cx + (x - cx) * t), (int)std::floor(cy + (y - cy) * t))) continue;
    t = (double)(step - 1) / steps;
    x = cx + (x - cx) * t; y = cy + (y - cy) * t;
    break;
  }
  double distance = std::max(.5, (p.aimX - x) * pose.dx + (p.aimY - y) * pose.dy);
  emit({cast, p.id, 0, x, y, x + pose.dx * distance, y + pose.dy * distance});
}
void MagicSystem::emit(const Pending& spell) {
  const auto& cast = spell.cast;
  for (int node = spell.node; node < cast.count; node++) {
    const auto* gear = E.content.gear(cast.spells[node]);
    if (!gear) return;
    auto* player = E.psys.findPlayer(spell.owner);
    if (gear->spell == SP_LUMEN) {
      if (player && player->alive) player->health = imin(100, player->health + 32 * cast.power * cast.shots / 100);
      E.audio.emit(SE_SPELL_IMPACT, spell.x, spell.y, .8, EMPTY);
    } else {
      int damage = (gear->power + cast.bonusDamage) * cast.power / 100;
      E.projectiles.spawnRune(spell.owner, spell.x, spell.y, spell.targetX, spell.targetY,
        gear->id, damage, &cast, node);
    }
    if (cast.connections[node] != SC_TOGETHER) break;
  }
}
void MagicSystem::trigger(Projectile& p) {
  if (p.spellNode < 0 || p.spellNode + 1 >= p.cast.count) return;
  int& connection = p.cast.connections[p.spellNode];
  if (connection != SC_IMPACT && connection != SC_TIMER) return;
  if (pending.size() < PROJECTILE_MAX) {
    double dx = p.vx, dy = p.vy, length = std::hypot(dx,dy);
    if (length < .01) { dx = 1; dy = 0; length = 1; }
    pending.push_back({p.cast, p.owner, p.spellNode + 1, p.px, p.py,
      p.px + dx / length * 64, p.py + dy / length * 64});
  }
  connection = SC_SEQUENCE; p.spellTimer = 0;
}
void MagicSystem::flush() {
  for (const auto& spell : pending) emit(spell);
  pending.clear();
}
