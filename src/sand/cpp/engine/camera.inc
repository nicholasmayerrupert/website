  // ViewCamera owns view state, input policy, and pure camera math. Engine-level
  // drivers below connect it to streaming, rendering, tools, and players.

  ViewCamera cam;

  // ---- cross-system drivers (Engine-level orchestration; NOT camera math) ----
  // Decide + apply a world-stream: slide the buffer (worldgen), the cell
  // texture (GL), and pull the camera back in lockstep. Returns the applied dx.
  int streamWorld() {
    // Generate the upcoming off-screen band ahead of the boundary so the shift
    // below finds it cached and skips fillRect (no ~1/sec worldgen hitch while
    // exploring).
    prefetchAdvance(cam.colX(), cam.colY(), cam.viewportCols, cam.viewportRows);
    int dx = maybeShiftWorld(cam.colX(), cam.viewportCols, CAM_SHIFT_EDGE_MARGIN);
    if (dx) { glp.glShift(dx); cam.set(cam.camX - dx, cam.camY); }
    // Vertical streaming: the player can dig down arbitrarily deep (the window
    // follows in Y too). Slide the GL texture and pull the camera back in lockstep.
    int dy = maybeShiftWorldVertical(cam.colY(), cam.viewportRows, CAM_SHIFT_EDGE_MARGIN);
    if (dy) { glp.glShiftV(dy); cam.set(cam.camX, cam.camY - dy); }
    return dx | dy;
  }
  // Apply this frame's local input. Play mode: feed the player (id) its input
  // bits + aim. Draw (free-build) mode: run the active tool at the aim cell.
  // Returns 1 if a draft preview changed (draw mode only).
  int applyLocalInput(int playerId, double now, uint32_t seq) {
    if (cam.playModeOn) {
      if (playerId) psys.setPlayerInput(playerId, cam.localInputBits(), cam.aimCellX(), cam.aimCellY(), tools.activeTool, seq,
                                   cam.stickActive() ? cam.stickX : NAN,
                                   cam.stickActive() ? cam.stickY : NAN);
      return 0;
    }
    return tools.applyTool((int)cam.aimCellX(), (int)cam.aimCellY(), now,
                           cam.pointerInside, cam.drawModeOn) ? 1 : 0;
  }
  // Pointer-driven draft preview in draw mode (build tools), using the current aim.
  int pointerDraftAtAim() { return tools.pointerDraft((int)cam.aimCellX(), (int)cam.aimCellY()); }
  int pointerDownAtAim(int button) { return tools.pointerDown((int)cam.aimCellX(), (int)cam.aimCellY(), button); }
