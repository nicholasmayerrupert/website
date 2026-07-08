  // View camera + input policy. The state and pure view math live in
  // ViewCamera (camera.hpp — extracted in 5c); the Engine composes one as
  // `cam`, keeps thin delegating shims for existing call sites, and owns the
  // drivers below that weld the camera to worldgen/GL/tools/players.

  ViewCamera cam;

  // ---- delegating shims (existing .inc/ABI call sites) ----
  void cameraSet(double x, double y) { cam.set(x, y); }
  int cameraColX() { return cam.colX(); }
  int cameraColY() { return cam.colY(); }
  void setViewport(double dpr, double cellDev, int vCols, int vRows) { cam.setViewport(dpr, cellDev, vCols, vRows, cols, rows); }
  void inputKey(int code, int down) { cam.inputKey(code, down); }
  void inputClearKeys() { cam.inputClearKeys(); }
  void inputPointer(double cssX, double cssY, int buttons, int inside) { cam.inputPointer(cssX, cssY, buttons, inside); }
  void setPlayModeOn(int on) { cam.setPlayModeOn(on); }
  void setDrawModeOn(int on) { cam.setDrawModeOn(on); }
  double aimCellX() { return cam.aimCellX(); }
  double aimCellY() { return cam.aimCellY(); }
  int localInputBits() { return cam.localInputBits(); }
  void cameraPanFrame(double frameDtMs) { cam.panFrame(frameDtMs); }
  void cameraFollowTo(double cx, double cy) { cam.followTo(cx, cy); }

  // ---- cross-system drivers (Engine-level orchestration; NOT camera math) ----
  // Decide + apply a world-stream: slide the buffer (worldgen), the cell
  // texture (GL), and pull the camera back in lockstep. Returns the applied dx.
  int streamWorld() {
    // Generate the upcoming off-screen band ahead of the boundary so the shift
    // below finds it cached and skips fillRect (no ~1/sec worldgen hitch while
    // exploring).
    prefetchAdvance(cam.colX(), cam.colY(), cam.viewportCols, cam.viewportRows);
    int dx = maybeShiftWorld(cam.colX(), cam.viewportCols, CAM_SHIFT_EDGE_MARGIN);
    if (dx) { glShift(dx); cam.set(cam.camX - dx, cam.camY); }
    // Vertical streaming: the player can dig down arbitrarily deep (the window
    // follows in Y too). Slide the GL texture and pull the camera back in lockstep.
    int dy = maybeShiftWorldVertical(cam.colY(), cam.viewportRows, CAM_SHIFT_EDGE_MARGIN);
    if (dy) { glShiftV(dy); cam.set(cam.camX, cam.camY - dy); }
    return dx | dy;
  }
  // Apply this frame's local input. Play mode: feed the player (id) its input
  // bits + aim. Draw (free-build) mode: run the active tool at the aim cell.
  // Returns 1 if a draft preview changed (draw mode only).
  int applyLocalInput(int playerId, double now, uint32_t seq) {
    if (cam.playModeOn) {
      if (playerId) setPlayerInput(playerId, cam.localInputBits(), cam.aimCellX(), cam.aimCellY(), tools.activeTool, seq);
      return 0;
    }
    return applyTool((int)cam.aimCellX(), (int)cam.aimCellY(), now, cam.pointerInside, cam.drawModeOn) ? 1 : 0;
  }
  // Pointer-driven draft preview in draw mode (build tools), using the current aim.
  int pointerDraftAtAim() { return pointerDraft((int)cam.aimCellX(), (int)cam.aimCellY()); }
  int pointerDownAtAim(int button) { return pointerDown((int)cam.aimCellX(), (int)cam.aimCellY(), button); }
