  // ================= INVENTORY (inventory.inc) =================
  // Per-player stacks (hotbar + grid). Authoritative in the engine like player
  // physics: JS reads a packed snapshot to draw the HUD and forwards slot-select /
  // move / place intents. Mining drops feed addToInventory (items.inc pickup); the
  // selected slot drives the held tool (mining) or the placed material (building).

  // Reset a player's inventory to the survival starter kit: bare hand + a wood
  // pickaxe/axe/shovel in the first hotbar slots, pickaxe selected.
  void seedStarterTools(Player& p) {
    for (int i = 0; i < INV_SLOTS; i++) p.inv[i] = InvSlot();
    auto tool = [&](int i, uint8_t cls, uint8_t tier) { p.inv[i].isTool = 1; p.inv[i].toolClass = cls; p.inv[i].toolTier = tier; p.inv[i].count = 1; };
    tool(0, TC_HAND, TT_HAND);
    tool(1, TC_PICKAXE, TT_WOOD);
    tool(2, TC_AXE, TT_WOOD);
    tool(3, TC_SHOVEL, TT_WOOD);
    setSelectedSlot(p, 1);
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

  // Place one unit of the selected slot's material at the aim cell (foreground).
  // Consumes a single count per successful call (v1 economy). Tools/empty/self-overlap
  // place nothing.
  bool placeFromSelected(Player& p, int ax, int ay, int r) {
    InvSlot& s = p.inv[p.selectedSlot];
    if (s.isTool || s.count <= 0 || s.material == EMPTY) return false;
    if (playerBuildOverlapsSelf(p, ax, ay, r)) return false;
    useLayer(&fg);
    int changed = placeMaterialAt(ax, ay, r, s.material);
    useLayer(&fg);
    if (!changed) return false;
    if (--s.count <= 0) s = InvSlot();
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

  // Survival input model: the selected hotbar slot decides the primary action — a
  // TOOL mines (continuous, drops gated by class/tier), a MATERIAL places one unit
  // per press. Only runs when survivalInventory is on, so creative is untouched.
  void applyInventoryPlayer(Player& p) {
    if (!p.active || !p.alive) { resetPlayerMine(p); p.prevInput = p.input; return; }
    if (p.toolCooldown > 0) p.toolCooldown--;
    int prev = p.prevInput;
    bool primary = (p.input & PI_PRIMARY) != 0;
    bool primaryRising = primary && !(prev & PI_PRIMARY);
    p.prevInput = p.input;
    int ax = (int)std::floor(p.aimX), ay = (int)std::floor(p.aimY);
    double cxp = p.px + p.w / 2.0, cyp = p.py + p.h / 2.0;
    double dxp = (ax + 0.5) - cxp, dyp = (ay + 0.5) - cyp;
    bool inReach = (dxp * dxp + dyp * dyp <= P_TOOL_REACH * P_TOOL_REACH);
    if (!primary || !inReach) { resetPlayerMine(p); return; }
    InvSlot& sel = p.inv[p.selectedSlot];
    if (sel.isTool) {
      if (p.toolCooldown > 0) return;
      if (mineDisc(p, ax, ay, &fg)) { p.toolCooldown = P_TOOL_COOLDOWN; playerActionCount++; }
    } else if (sel.count > 0 && primaryRising) {
      resetPlayerMine(p);
      if (placeFromSelected(p, ax, ay, P_BUILD_R)) playerActionCount++;
    }
  }
