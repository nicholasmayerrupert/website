  // ================= INVENTORY (inventory.inc) =================
  // Per-player stacks (hotbar + grid). Authoritative in the engine like player
  // physics: JS reads a packed snapshot to draw the HUD and forwards slot-select /
  // move / place intents. Mining drops feed addToInventory (items.inc pickup); the
  // selected slot drives the held tool (mining) or the placed material (building).

  // Reset a player's inventory to the survival starter kit: a wood pickaxe/axe/shovel
  // in the first hotbar slots, pickaxe selected. There is NO hand slot — an empty (or
  // material) slot means the bare hand (setSelectedSlot resolves that to TC_HAND).
  void seedStarterTools(Player& p) {
    for (int i = 0; i < INV_SLOTS; i++) p.inv[i] = InvSlot();
    p.cursor = InvSlot();
    auto tool = [&](int i, uint8_t cls, uint8_t tier) { p.inv[i].isTool = 1; p.inv[i].toolClass = cls; p.inv[i].toolTier = tier; p.inv[i].count = 1; };
    tool(0, TC_PICKAXE, TT_WOOD);
    tool(1, TC_AXE, TT_WOOD);
    tool(2, TC_SHOVEL, TT_WOOD);
    setSelectedSlot(p, 0);
  }
  void seedStarterTools(int id) { Player* p = findPlayer(id); if (p) seedStarterTools(*p); }

  // Select a hotbar slot and refresh the held tool: a tool slot equips its class/tier
  // (mining); any other slot (material/empty) means a bare hand, so blocks placed
  // from the slot don't accidentally gate mining.
  void setSelectedSlot(Player& p, int slot) {
    if (slot < 0) slot = 0; if (slot >= INV_HOTBAR) slot = INV_HOTBAR - 1;
    p.selectedSlot = slot;
    InvSlot& s = p.inv[slot];
    if (s.isTool) { p.heldToolClass = s.toolClass; p.heldToolTier = s.toolTier; }
    else { p.heldToolClass = TC_HAND; p.heldToolTier = TT_HAND; }
  }
  void setSelectedSlot(int id, int slot) { Player* p = findPlayer(id); if (p) setSelectedSlot(*p, slot); }
  // Cycle the selected hotbar slot by `delta` with wrap-around (scroll wheel). The
  // wrap policy lives here, not in JS, so all input policy stays engine-side.
  void cycleSelectedSlot(int id, int delta) {
    Player* p = findPlayer(id); if (!p) return;
    int s = ((p->selectedSlot + delta) % INV_HOTBAR + INV_HOTBAR) % INV_HOTBAR;
    setSelectedSlot(*p, s);
  }

  // Add `count` of `mat` to a player's inventory: top off matching stacks first, then
  // fill empty slots. Returns false (and adds nothing more) if it cannot all fit, so
  // the caller can leave the remainder in the world (no silent loss).
  bool addToInventory(Player& p, uint8_t mat, int count) {
    if (count <= 0) return true;
    for (int i = 0; i < INV_SLOTS && count > 0; i++) {
      InvSlot& s = p.inv[i];
      if (!s.isTool && s.count > 0 && s.material == mat && s.count < INV_STACK_MAX) {
        int add = imin(count, INV_STACK_MAX - s.count); s.count += add; count -= add;
      }
    }
    for (int i = 0; i < INV_SLOTS && count > 0; i++) {
      InvSlot& s = p.inv[i];
      if (!s.isTool && s.count == 0) {
        s.material = mat; s.toolClass = 0; s.toolTier = 0;
        int add = imin(count, INV_STACK_MAX); s.count = add; count -= add;
      }
    }
    return count <= 0;
  }
  bool addToInventory(int id, uint8_t mat, int count) { Player* p = findPlayer(id); return p ? addToInventory(*p, mat, count) : false; }

  // Place the selected slot's material at the aim cell, capped at how many units the
  // stack can afford — consuming EXACTLY the pixels created (per-pixel economy).
  // Tools/empty/self-overlap place nothing.
  bool placeFromSelected(Player& p, int ax, int ay, int r) {
    InvSlot& s = p.inv[p.selectedSlot];
    if (s.isTool || s.count <= 0 || s.material == EMPTY) return false;
    // Don't reject the whole build when the disc grazes the player — place only the
    // cells outside the body (passing &p), so building against yourself still works
    // and holding keeps placing as the loose material flows/settles away.
    useLayer(&fg);
    int placed = placeMaterialAtCapped(ax, ay, r, s.material, s.count, &p);
    useLayer(&fg);
    if (placed <= 0) return false;
    s.count -= placed; if (s.count <= 0) s = InvSlot();
    return true;
  }
  bool placeFromSelected(int id, int ax, int ay) { Player* p = findPlayer(id); return p ? placeFromSelected(*p, ax, ay, P_BUILD_R) : false; }

  // Move/swap/merge slot `from` into `to` (the openable-grid drag). Same-material
  // non-tool stacks merge (respecting INV_STACK_MAX); otherwise the slots swap.
  void moveSlot(Player& p, int from, int to) {
    if (from < 0 || from >= INV_SLOTS || to < 0 || to >= INV_SLOTS || from == to) return;
    InvSlot& a = p.inv[from]; InvSlot& b = p.inv[to];
    if (!a.isTool && !b.isTool && a.count > 0 && b.count > 0 && a.material == b.material) {
      int mv = imin(a.count, INV_STACK_MAX - b.count); b.count += mv; a.count -= mv;
      if (a.count <= 0) a = InvSlot();
      return;
    }
    InvSlot tmp = a; a = b; b = tmp;
  }
  void moveSlot(int id, int from, int to) { Player* p = findPlayer(id); if (p) moveSlot(*p, from, to); }

  // ---- Minecraft cursor model (the carried stack p.cursor) ----
  // Click a slot to pick up / place / merge / swap the carried stack. half=true is the
  // right-click variant (pick up half, place one). Refreshes the held tool if the
  // touched slot is the selected hotbar slot.
  void cursorPick(Player& p, int slot, bool half) {
    if (slot < 0 || slot >= INV_SLOTS) return;
    InvSlot& s = p.inv[slot]; InvSlot& c = p.cursor;
    bool cEmpty = c.count <= 0, sEmpty = s.count <= 0;
    if (cEmpty) {
      if (sEmpty) return;
      if (half && !s.isTool && s.count > 1) { c = s; c.count = (s.count + 1) / 2; s.count -= c.count; }
      else { c = s; s = InvSlot(); }
    } else if (sEmpty) {
      if (half) { s = c; s.count = 1; if (--c.count <= 0) c = InvSlot(); }
      else { s = c; c = InvSlot(); }
    } else if (!c.isTool && !s.isTool && c.material == s.material) { // merge same material
      int room = INV_STACK_MAX - s.count;
      int mv = half ? imin(1, imin(room, c.count)) : imin(room, c.count);
      s.count += mv; c.count -= mv; if (c.count <= 0) c = InvSlot();
    } else if (!half) { // different contents -> swap (left-click only)
      InvSlot tmp = s; s = c; c = tmp;
    }
    if (slot == p.selectedSlot) setSelectedSlot(p, p.selectedSlot); // re-derive held tool
  }
  void cursorPick(int id, int slot, int half) { Player* p = findPlayer(id); if (p) cursorPick(*p, slot, half != 0); }

  // Throw the carried stack into the world in the facing direction (drop-out). whole=
  // the entire stack, else one. Tools can't be thrown. The thrown item ignores the
  // magnet briefly so it doesn't fly straight back. Returns true if anything was thrown.
  bool throwFromCursor(Player& p, bool whole) {
    InvSlot& c = p.cursor;
    if (c.count <= 0 || c.isTool || c.material == EMPTY) return false;
    int n = whole ? imin(c.count, 255) : 1;
    double sx = p.px + p.w / 2.0 + p.facing * 1.5, sy = p.py + p.h / 2.0;
    throwItem(c.material, n, sx, sy, p.facing * IT_THROW_SPEED, IT_THROW_UP);
    c.count -= n; if (c.count <= 0) c = InvSlot();
    return true;
  }
  bool throwFromCursor(int id, int whole) { Player* p = findPlayer(id); return p ? throwFromCursor(*p, whole != 0) : false; }

  // Pack the carried cursor stack (one slot record) for the HUD's floating item.
  int buildCursorSnapshot(int playerId) {
    cursorSnap.assign(INV_SNAP_STRIDE, 0.0f);
    Player* p = findPlayer(playerId); if (!p) return 0;
    InvSlot& s = p->cursor;
    float* o = cursorSnap.data();
    o[0] = (float)s.material; o[1] = (float)s.isTool; o[2] = (float)s.toolClass;
    o[3] = (float)s.toolTier; o[4] = (float)s.count; o[5] = 0.0f;
    return s.count > 0 ? 1 : 0;
  }

  // Pack one player's inventory into invSnapshot for the JS HUD.
  int buildInventorySnapshot(int playerId) {
    invSnapshot.assign((size_t)INV_SLOTS * INV_SNAP_STRIDE, 0.0f);
    Player* p = findPlayer(playerId);
    if (!p) return 0;
    for (int i = 0; i < INV_SLOTS; i++) {
      InvSlot& s = p->inv[i];
      float* o = invSnapshot.data() + (size_t)i * INV_SNAP_STRIDE;
      o[0] = (float)s.material; o[1] = (float)s.isTool; o[2] = (float)s.toolClass;
      o[3] = (float)s.toolTier; o[4] = (float)s.count; o[5] = (i == p->selectedSlot) ? 1.0f : 0.0f;
    }
    return INV_SLOTS;
  }

  // Survival input model. The selected hotbar slot decides what PRIMARY (LMB, the
  // FOREGROUND) and SECONDARY (RMB, the BACKGROUND) do:
  //   - a TOOL or an EMPTY slot      -> MINE that layer (empty = the bare hand).
  //   - a COMPONENT material (stone) -> creative-style DRAFT: hold to draw a growing
  //         preview that consumes inventory per staged cell, stops when you run out,
  //         and MATERIALIZES on release (exactly like creative solids).
  //   - a loose material (sand/water)-> continuous capped paint.
  // Only runs when survivalInventory is on, so creative is untouched.
  void applyInventoryPlayer(Player& p) {
    if (!p.active || !p.alive) {
      resetPlayerMine(p);
      if (drafting && draftOwner == p.id) playerFinalizeSolidDraft();
      p.prevInput = p.input; return;
    }
    if (p.toolCooldown > 0) p.toolCooldown--;
    int prev = p.prevInput;
    bool primary = (p.input & PI_PRIMARY) != 0, secondary = (p.input & PI_SECONDARY) != 0;
    bool primaryRising = primary && !(prev & PI_PRIMARY);
    p.prevInput = p.input;
    int ax = (int)std::floor(p.aimX), ay = (int)std::floor(p.aimY);
    double cxp = p.px + p.w / 2.0, cyp = p.py + p.h / 2.0;
    double dxp = (ax + 0.5) - cxp, dyp = (ay + 0.5) - cyp;
    bool inReach = (dxp * dxp + dyp * dyp <= P_TOOL_REACH * P_TOOL_REACH);
    InvSlot& sel = p.inv[p.selectedSlot];

    // (1) An active component draft this player owns takes over PRIMARY: extend it while
    //     held (consuming inventory per staged cell), materialize it on release.
    if (drafting && draftOwner == p.id) {
      if (!primary) { playerFinalizeSolidDraft(); playerActionCount++; }
      else if (inReach && !sel.isTool && sel.count > 0 && sel.material == draftMaterial) {
        useLayer(&fg);
        int added = addDiscToDraftCapped(draft, ax, ay, P_BUILD_R, rows, sel.count, &p);
        if (added > 0) { sel.count -= added; if (sel.count <= 0) sel = InvSlot(); }
        useLayer(&fg);
      }
      return;
    }

    bool mineMode = sel.isTool || sel.count <= 0; // tool or empty slot -> mine (empty = hand)
    bool isComp = !mineMode && sel.material != EMPTY && MAT_KIND[sel.material] == K_COMPONENT;
    if ((!primary && !secondary) || !inReach) { resetPlayerMine(p); return; }

    if (mineMode) {
      if (p.toolCooldown > 0) return;
      bool acted = false;
      if (primary) acted |= mineDisc(p, ax, ay, &fg);
      if (secondary) { bgEnabled = true; acted |= mineDisc(p, ax, ay, &bg); }
      if (acted) { p.toolCooldown = P_TOOL_COOLDOWN; playerActionCount++; }
    } else if (isComp) {
      // begin a component draft on press (stage + consume the first disc immediately).
      if (primaryRising) {
        drafting = true; draftOwner = p.id; draftLayer = 0; draftMaterial = sel.material;
        useLayer(&fg);
        int added = addDiscToDraftCapped(draft, ax, ay, P_BUILD_R, rows, sel.count, &p);
        if (added > 0) { sel.count -= added; if (sel.count <= 0) sel = InvSlot(); }
        useLayer(&fg);
        playerActionCount++;
      }
    } else { // loose material -> continuous capped paint (consume per cell)
      resetPlayerMine(p);
      if (p.toolCooldown <= 0 && sel.count > 0 && placeFromSelected(p, ax, ay, P_BUILD_R)) p.toolCooldown = P_TOOL_COOLDOWN;
    }
  }
