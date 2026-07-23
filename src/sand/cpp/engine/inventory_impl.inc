// Authoritative survival inventory.
// JS renders packed snapshots and forwards intents; the selected slot drives
// mining or placement.

// Destructive survival starts armed and able to harvest terrain. The blast gun
// is intentionally infinite-energy; the wood dig tool restores the mining loop.
void InventorySystem::seedStarterTools(Player& p) {
  for (int i = 0; i < INV_SLOTS; i++) p.inv[i] = InvSlot();
  p.cursor = InvSlot();
  p.emptyWeaponTriggerLatch = false;
  p.inv[0].itemKind = IK_BLAST_GUN;
  p.inv[0].count = 1;
  p.inv[1].itemKind = IK_MINING_TOOL;
  p.inv[1].isTool = 1;
  p.inv[1].toolClass = TC_DIG;
  p.inv[1].toolTier = TT_WOOD;
  p.inv[1].count = 1;
  p.selectedFootprint = E.clampSurvivalFootprintId(SURVIVAL_FOOTPRINT_DEFAULT_ID);
  setSelectedSlot(p, 0);
}
void InventorySystem::seedStarterTools(int id) { Player* p = E.findPlayer(id); if (p) seedStarterTools(*p); }
void InventorySystem::resetPlayerPlaceStroke(Player& p) {
  p.placeStrokeActive = false;
  p.placeStrokeMaterial = EMPTY;
  p.placeStrokeFootprint = -1;
}

// Select a hotbar slot and refresh the held tool: a tool slot equips its class/tier
// (mining); any other slot (material/empty) means a bare hand, so blocks placed
// from the slot don't accidentally gate mining.
void InventorySystem::setSelectedSlot(Player& p, int slot) {
  if (slot < 0) slot = 0; if (slot >= INV_HOTBAR) slot = INV_HOTBAR - 1;
  p.selectedSlot = slot;
  if (!(p.input & PI_PRIMARY)) p.emptyWeaponTriggerLatch = false;
  resetPlayerPlaceStroke(p);
  E.resetPlayerMine(p);
  InvSlot& s = p.inv[slot];
  p.bowChargeTicks = 0;
  if (s.itemKind == IK_MINING_TOOL && s.count > 0) { p.heldToolClass = TC_DIG; p.heldToolTier = s.toolTier; }
  else { p.heldToolClass = TC_HAND; p.heldToolTier = TT_HAND; }
}
void InventorySystem::setSelectedSlot(int id, int slot) { Player* p = E.findPlayer(id); if (p) setSelectedSlot(*p, slot); }
// Cycle the selected hotbar slot by `delta` with wrap-around (scroll wheel). The
// wrap policy lives here, not in JS, so all input policy stays engine-side.
void InventorySystem::cycleSelectedSlot(int id, int delta) {
  Player* p = E.findPlayer(id); if (!p) return;
  int s = ((p->selectedSlot + delta) % INV_HOTBAR + INV_HOTBAR) % INV_HOTBAR;
  setSelectedSlot(*p, s);
}

// Add `count` of `mat` to a player's inventory: top off matching stacks first, then
// fill empty slots. Returns false (and adds nothing more) if it cannot all fit, so
// the caller can leave the remainder in the world (no silent loss).
bool InventorySystem::addToInventory(Player& p, uint8_t mat, int count, uint8_t plantType) {
  InvSlot stack; stack.itemKind = IK_MATERIAL; stack.material = mat;
  stack.plantType = plantType; stack.count = count;
  return addStack(p, stack);
}
bool InventorySystem::sameStack(const InvSlot& a, const InvSlot& b) {
  if (a.count <= 0 || b.count <= 0 || a.itemKind != b.itemKind) return false;
  if (a.itemKind == IK_MATERIAL) return a.material == b.material && (a.material != SEED || a.plantType == b.plantType);
  if (a.itemKind == IK_ARROW) return true;
  return isFiniteAmmoWeapon(a.itemKind);
}
bool InventorySystem::addStack(Player& p, const InvSlot& incoming) {
  Player trial = p;
  int count = incoming.count;
  if (count <= 0) return true;
  int limit = inventoryStackLimit(incoming.itemKind);
  for (int i = 0; i < INV_SLOTS && count > 0; i++) {
    InvSlot& s = trial.inv[i];
    if (sameStack(s, incoming) && s.count < limit) {
      int add = imin(count, limit - s.count); s.count += add; count -= add;
    }
  }
  for (int i = 0; i < INV_SLOTS && count > 0; i++) {
    InvSlot& s = trial.inv[i];
    if (s.count == 0) {
      s = incoming;
      int add = imin(count, limit); s.count = add; count -= add;
    }
  }
  if (count > 0) return false;
  p = trial;
  return true;
}
bool InventorySystem::addToInventory(int id, uint8_t mat, int count, uint8_t plantType) { Player* p = E.findPlayer(id); return p ? addToInventory(*p, mat, count, plantType) : false; }
bool InventorySystem::addStack(int id, const InvSlot& stack) { Player* p = E.findPlayer(id); return p ? addStack(*p, stack) : false; }
bool InventorySystem::consumeSelectedWeaponAmmo(Player& p, uint8_t itemKind) {
  InvSlot& s = p.inv[p.selectedSlot];
  if (s.itemKind != itemKind || !isFiniteAmmoWeapon(itemKind) || s.count <= 0) return false;
  if (--s.count <= 0) {
    s = InvSlot();
    p.emptyWeaponTriggerLatch = (p.input & PI_PRIMARY) != 0;
  }
  return true;
}

// Place the selected slot's material at the aim cell, capped at how many units the
// stack can afford — consuming EXACTLY the pixels created (per-pixel economy).
// Tools/empty/self-overlap place nothing.
bool InventorySystem::placeFromSelected(Player& p, int ax, int ay, Layer* layer) {
  InvSlot& s = p.inv[p.selectedSlot];
  if (s.itemKind != IK_MATERIAL || s.isTool || s.count <= 0 || s.material == EMPTY) return false;
  // Don't reject the whole build when the disc grazes the player — place only the
  // cells outside the body (passing &p), so building against yourself still works
  // and holding keeps placing as the loose material flows/settles away.
  bool foreground = layer == &E.fg;
  if (!foreground) E.bgEnabled = true;
  E.useLayer(layer);
  int placed = E.placeMaterialAtFootprintCapped(ax, ay, E.getSurvivalFootprint(p), s.material, s.count, foreground ? &p : nullptr);
  E.useLayer(&E.fg);
  if (placed <= 0) return false;
  uint8_t placedMaterial = s.material;
  s.count -= placed; if (s.count <= 0) s = InvSlot();
  E.audio.emit(SE_PLACE, ax, ay, std::min(1.25, 0.35 + placed * 0.04), placedMaterial, foreground ? 0 : 1);
  return true;
}
bool InventorySystem::placeFromSelectedStroke(Player& p, int x0, int y0, int x1, int y1, Layer* layer) {
  InvSlot& s = p.inv[p.selectedSlot];
  if (s.itemKind != IK_MATERIAL || s.isTool || s.count <= 0 || s.material == EMPTY) return false;
  bool foreground = layer == &E.fg;
  if (!foreground) E.bgEnabled = true;
  E.useLayer(layer);
  int placed = E.placeMaterialAtFootprintStrokeCapped(x0, y0, x1, y1, E.getSurvivalFootprint(p), s.material, s.count, foreground ? &p : nullptr);
  E.useLayer(&E.fg);
  if (placed <= 0) return false;
  uint8_t placedMaterial = s.material;
  s.count -= placed; if (s.count <= 0) s = InvSlot();
  E.audio.emit(SE_PLACE, x1, y1, std::min(1.25, 0.3 + placed * 0.025), placedMaterial, foreground ? 0 : 1);
  return true;
}
bool InventorySystem::placeFromSelected(int id, int ax, int ay) { Player* p = E.findPlayer(id); return p ? placeFromSelected(*p, ax, ay, &E.fg) : false; }

// Move/swap/merge slot `from` into `to` (the openable-grid drag). Same-material
// compatible stacks merge (respecting their material/ammo limit); otherwise the
// slots swap.
void InventorySystem::moveSlot(Player& p, int from, int to) {
  if (from < 0 || from >= INV_SLOTS || to < 0 || to >= INV_SLOTS || from == to) return;
  InvSlot& a = p.inv[from]; InvSlot& b = p.inv[to];
  if (sameStack(a, b)) {
    int mv = imin(a.count, inventoryStackLimit(b.itemKind) - b.count); b.count += mv; a.count -= mv;
    if (a.count <= 0) a = InvSlot();
    return;
  }
  InvSlot tmp = a; a = b; b = tmp;
}
void InventorySystem::moveSlot(int id, int from, int to) { Player* p = E.findPlayer(id); if (p) moveSlot(*p, from, to); }

// ---- Minecraft cursor model (the carried stack p.cursor) ----
// Click a slot to pick up / place / merge / swap the carried stack. half=true is the
// right-click variant (pick up half, place one). Refreshes the held tool if the
// touched slot is the selected hotbar slot.
void InventorySystem::cursorPick(Player& p, int slot, bool half) {
  if (slot < 0 || slot >= INV_SLOTS) return;
  InvSlot& s = p.inv[slot]; InvSlot& c = p.cursor;
  bool cEmpty = c.count <= 0, sEmpty = s.count <= 0;
  if (cEmpty) {
    if (sEmpty) return;
    if (half && inventoryStackCanSplit(s.itemKind) && !s.isTool && s.count > 1) {
      c = s; c.count = (s.count + 1) / 2; s.count -= c.count;
    }
    else { c = s; s = InvSlot(); }
  } else if (sEmpty) {
    if (half && inventoryStackCanSplit(c.itemKind)) {
      s = c; s.count = 1; if (--c.count <= 0) c = InvSlot();
    }
    else { s = c; c = InvSlot(); }
  } else if (sameStack(c, s)) { // merge same material/species/ammo
    int room = inventoryStackLimit(s.itemKind) - s.count;
    int mv = half && inventoryStackCanSplit(c.itemKind)
      ? imin(1, imin(room, c.count)) : imin(room, c.count);
    s.count += mv; c.count -= mv; if (c.count <= 0) c = InvSlot();
  } else if (!half) { // different contents -> swap (left-click only)
    InvSlot tmp = s; s = c; c = tmp;
  }
  if (slot == p.selectedSlot) setSelectedSlot(p, p.selectedSlot); // re-derive held tool
}
void InventorySystem::cursorPick(int id, int slot, int half) { Player* p = E.findPlayer(id); if (p) cursorPick(*p, slot, half != 0); }

// Throw the carried stack into the world in the facing direction (drop-out).
// Materials keep their stack-count behavior; captured enemy weapons can also be
// dropped and recovered. The soulbound starter gun and mining tools stay put.
bool InventorySystem::throwFromCursor(Player& p, bool whole) {
  InvSlot& c = p.cursor;
  if (c.count <= 0 || c.itemKind == IK_BLAST_GUN || c.itemKind == IK_MINING_TOOL) return false;
  if (c.itemKind == IK_DYNAMITE_SATCHEL || c.itemKind == IK_BORE_CANNON ||
      c.itemKind == IK_ACID_MORTAR || c.itemKind == IK_CLUSTER_LAUNCHER ||
      c.itemKind == IK_MINIGUN) {
    E.itemsys.spawnStack(c, p.px + p.w / 2.0 + p.facing * 1.5, p.py + p.h / 2.0,
                         p.facing * IT_THROW_SPEED, IT_THROW_UP, IT_THROW_PICKUP_DELAY);
    c = InvSlot();
    return true;
  }
  if (c.itemKind != IK_MATERIAL || c.isTool || c.material == EMPTY) return false;
  int n = whole ? c.count : 1;
  double sx = p.px + p.w / 2.0 + p.facing * 1.5, sy = p.py + p.h / 2.0;
  E.throwItem(c.material, n, sx, sy, p.facing * IT_THROW_SPEED, IT_THROW_UP, c.plantType);
  c.count -= n; if (c.count <= 0) c = InvSlot();
  return true;
}
bool InventorySystem::throwFromCursor(int id, int whole) { Player* p = E.findPlayer(id); return p ? throwFromCursor(*p, whole != 0) : false; }

void InventorySystem::dropAll(Player& p) {
  int ordinal = 0;
  auto drop = [&](InvSlot& s) {
    if (s.count <= 0) return;
    // The infinite-ammo starter gun is a bound loadout item. Respawn grants a
    // fresh loadout, so dropping this copy would duplicate it when the old gun
    // magnetized back to the player.
    if (s.itemKind == IK_BLAST_GUN) { s = InvSlot(); return; }
    double a = ordinal++ * 2.399963229728653; // deterministic golden-angle scatter
    E.itemsys.spawnStack(s, p.px + p.w * 0.5, p.py + p.h * 0.45,
                         std::cos(a) * 1.35, -0.75 - std::fabs(std::sin(a)) * 0.8, 180);
    s = InvSlot();
  };
  for (int i = 0; i < INV_SLOTS; i++) drop(p.inv[i]);
  drop(p.cursor);
  setSelectedSlot(p, 0);
}

// Pack the carried cursor stack (one slot record) for the HUD's floating item.
int InventorySystem::buildCursorSnapshot(int playerId) {
  cursorSnap.assign(IVS_STRIDE, 0.0f);
  Player* p = E.findPlayer(playerId); if (!p) return 0;
  InvSlot& s = p->cursor;
  float* o = cursorSnap.data();
  o[IVS_MATERIAL] = (float)s.material; o[IVS_IS_TOOL] = (float)s.isTool; o[IVS_TOOL_CLASS] = (float)s.toolClass;
  o[IVS_TOOL_TIER] = (float)s.toolTier; o[IVS_COUNT] = (float)s.count; o[IVS_SELECTED] = 0.0f;
  o[IVS_PLANT_TYPE] = (float)s.plantType;
  o[IVS_ITEM_KIND] = (float)s.itemKind;
  return s.count > 0 ? 1 : 0;
}

// Pack one player's inventory into invSnapshot for the JS HUD.
int InventorySystem::buildInventorySnapshot(int playerId) {
  invSnapshot.assign((size_t)INV_SLOTS * IVS_STRIDE, 0.0f);
  Player* p = E.findPlayer(playerId);
  if (!p) return 0;
  for (int i = 0; i < INV_SLOTS; i++) {
    InvSlot& s = p->inv[i];
    float* o = invSnapshot.data() + (size_t)i * IVS_STRIDE;
    o[IVS_MATERIAL] = (float)s.material; o[IVS_IS_TOOL] = (float)s.isTool; o[IVS_TOOL_CLASS] = (float)s.toolClass;
    o[IVS_TOOL_TIER] = (float)s.toolTier; o[IVS_COUNT] = (float)s.count; o[IVS_SELECTED] = (i == p->selectedSlot) ? 1.0f : 0.0f;
    o[IVS_PLANT_TYPE] = (float)s.plantType;
    o[IVS_ITEM_KIND] = (float)s.itemKind;
  }
  return INV_SLOTS;
}

// Survival input model. The selected hotbar slot decides what the mouse buttons do:
//   - a TOOL or an EMPTY slot      -> MINE (empty = bare hand).
//         LMB mines foreground; RMB mines foreground and background together.
//   - a COMPONENT material (stone) -> creative-style DRAFT: hold to draw a growing
//         preview that consumes inventory per staged cell, stops when you run out,
//         and MATERIALIZES on release (exactly like creative solids).
//   - a loose material (sand/water)-> continuous capped paint.
// Only runs when E.survivalInventory is on, so creative is untouched.
void InventorySystem::applyInventoryPlayer(Player& p) {
  if (!p.active || !p.alive) {
    E.resetPlayerMine(p);
    resetPlayerPlaceStroke(p);
    if (E.tools.drafting && E.tools.draftOwner == p.id) E.playerFinalizeSolidDraft();
    p.prevInput = p.input; return;
  }
  if (p.toolCooldown > 0) p.toolCooldown--;
  int prev = p.prevInput;
  bool primary = (p.input & PI_PRIMARY) != 0, secondary = (p.input & PI_SECONDARY) != 0;
  if (p.emptyWeaponTriggerLatch) {
    E.resetPlayerMine(p); resetPlayerPlaceStroke(p);
    p.prevInput = p.input;
    if (primary) return;
    p.emptyWeaponTriggerLatch = false;
  }
  bool primaryRising = primary && !(prev & PI_PRIMARY);
  bool secondaryRising = secondary && !(prev & PI_SECONDARY);
  p.prevInput = p.input;
  int ax = (int)std::floor(p.aimX), ay = (int)std::floor(p.aimY);
  double cxp = p.px + p.w / 2.0, cyp = p.py + p.h / 2.0;
  auto inReachOf = [&](int tx, int ty) {
    double dx = (tx + 0.5) - cxp, dy = (ty + 0.5) - cyp;
    return dx * dx + dy * dy <= P_TOOL_REACH * P_TOOL_REACH;
  };
  bool aimInReach = inReachOf(ax, ay);
  InvSlot& sel = p.inv[p.selectedSlot];
  const SurvivalFootprint& fp = E.getSurvivalFootprint(p);

  // (1) An active component E.tools.draft this player owns takes over its originating
  //     button: extend while held, materialize on release.
  if (E.tools.drafting && E.tools.draftOwner == p.id) {
    bool held = E.tools.draftLayer ? secondary : primary;
    if (!held) { E.playerFinalizeSolidDraft(); E.playerActionCount++; }
    else if (aimInReach && !sel.isTool && sel.count > 0 && sel.material == E.tools.draftMaterial) {
      E.useLayer(E.tools.draftLayer ? &E.bg : &E.fg);
      int sx = E.tools.draftStrokeActive ? E.tools.lastDraftCx : ax, sy = E.tools.draftStrokeActive ? E.tools.lastDraftCy : ay;
      int added = E.addFootprintStrokeToDraftCapped(E.tools.draft, sx, sy, ax, ay, fp, E.rows, sel.count, E.tools.draftLayer ? nullptr : &p);
      E.tools.lastDraftCx = ax; E.tools.lastDraftCy = ay; E.tools.draftStrokeActive = true;
      if (added > 0) { sel.count -= added; if (sel.count <= 0) sel = InvSlot(); }
      E.useLayer(&E.fg);
    } else if (!aimInReach) E.tools.draftStrokeActive = false;
    return;
  }

  bool mineMode = sel.itemKind == IK_MINING_TOOL || sel.count <= 0; // tool or empty slot -> mine (empty = hand)
  if (sel.itemKind == IK_BOW) { E.projectiles.applyBowInput(p, prev); return; }
  if (sel.itemKind == IK_BLAST_GUN) { E.projectiles.applyBlastGunInput(p); return; }
  if (sel.itemKind == IK_DYNAMITE_SATCHEL) { E.projectiles.applyDynamiteSatchelInput(p, prev); return; }
  if (sel.itemKind == IK_BORE_CANNON) { E.projectiles.applyBoreCannonInput(p, prev); return; }
  if (sel.itemKind == IK_ACID_MORTAR) { E.projectiles.applyAcidMortarInput(p, prev); return; }
  if (sel.itemKind == IK_CLUSTER_LAUNCHER) { E.projectiles.applyClusterLauncherInput(p, prev); return; }
  if (sel.itemKind == IK_MINIGUN) { E.projectiles.applyMinigunInput(p); return; }
  if (sel.itemKind == IK_ARROW) { E.resetPlayerMine(p); resetPlayerPlaceStroke(p); return; }
  bool isSeed = !mineMode && sel.itemKind == IK_MATERIAL && sel.material == SEED;
  bool isComp = !mineMode && !isSeed && sel.material != EMPTY && E.isComponentMaterial(sel.material);
  if (!primary && !secondary) { E.resetPlayerMine(p); resetPlayerPlaceStroke(p); return; }

  if (mineMode) {
    if (p.placeStrokeActive) return; // selected stack ran dry during this held placement stroke
    // Hold-lock: while mining, reach is measured to the locked cell so the cursor
    // can wander without cancelling. Leaving reach of the lock (or releasing) resets.
    int reachX = p.mineActive ? p.mineX : ax, reachY = p.mineActive ? p.mineY : ay;
    if (!inReachOf(reachX, reachY)) { E.resetPlayerMine(p); return; }
    bool acted = false;
    // Creatures are hitbox entities, not grid cells. Route the same held mining
    // action through their health before resolving terrain; hurtCooldown keeps a
    // 60 Hz held button from becoming an accidental one-frame kill.
    int hitRadius = imax(fp.width, fp.height) / 2 + 1;
    int hitDamage = 7 + (int)p.heldToolTier * 4;
    acted |= E.damageCreaturesAt(ax, ay, hitRadius, hitDamage);
    if (primary) acted |= E.mineFootprint(p, ax, ay, &E.fg);
    if (secondary && !primary) acted |= E.mineFootprintBoth(p, ax, ay);
    if (acted) E.playerActionCount++;
  } else if (!aimInReach) {
    E.resetPlayerMine(p); resetPlayerPlaceStroke(p); return;
  } else if (isSeed) {
    E.resetPlayerMine(p);
    if ((primaryRising || secondaryRising) && sel.count > 0) {
      bool toBg = secondaryRising && !primaryRising;
      if (toBg) E.bgEnabled = true;
      int x0, y0;
      E.useLayer(toBg ? &E.bg : &E.fg);
      bool placed = E.getSeedOrigin(ax, ay, x0, y0) && E.placeSeedAtTyped(x0, y0, sel.plantType);
      E.useLayer(&E.fg);
      if (placed) {
        E.audio.emit(SE_PLACE, x0, y0, 0.6, SEED, toBg ? 1 : 0);
        sel.count--;
        if (sel.count <= 0) sel = InvSlot();
        E.playerActionCount++;
      }
    }
  } else if (isComp) {
    // begin a component E.tools.draft on press (stage + consume the first disc immediately).
    if (primaryRising || secondaryRising) {
      bool toBg = secondaryRising && !primaryRising;
      if (toBg) E.bgEnabled = true;
      E.tools.drafting = true; E.tools.draftOwner = p.id; E.tools.draftLayer = toBg ? 1 : 0; E.tools.draftMaterial = sel.material;
      E.tools.lastDraftCx = ax; E.tools.lastDraftCy = ay; E.tools.draftStrokeActive = true;
      E.useLayer(toBg ? &E.bg : &E.fg);
      int added = E.addFootprintToDraftCapped(E.tools.draft, ax, ay, fp, E.rows, sel.count, toBg ? nullptr : &p);
      if (added > 0) { sel.count -= added; if (sel.count <= 0) sel = InvSlot(); }
      E.useLayer(&E.fg);
      E.playerActionCount++;
    }
  } else { // loose material -> continuous capped paint (consume per cell)
    E.resetPlayerMine(p);
    if (p.toolCooldown <= 0 && sel.count > 0) {
      Layer* layer = (secondary && !primary) ? &E.bg : &E.fg;
      int layerId = layer == &E.bg ? 1 : 0;
      int fpId = E.clampSurvivalFootprintId(p.selectedFootprint);
      bool sameStroke = p.placeStrokeActive && p.placeStrokeLayer == layerId && p.placeStrokeMaterial == sel.material && p.placeStrokeFootprint == fpId;
      int sx = sameStroke ? p.placeStrokeX : ax, sy = sameStroke ? p.placeStrokeY : ay;
      if (placeFromSelectedStroke(p, sx, sy, ax, ay, layer)) p.toolCooldown = P_TOOL_COOLDOWN;
      p.placeStrokeActive = true;
      p.placeStrokeX = ax; p.placeStrokeY = ay; p.placeStrokeLayer = layerId; p.placeStrokeMaterial = sel.material; p.placeStrokeFootprint = fpId;
    }
  }
}
