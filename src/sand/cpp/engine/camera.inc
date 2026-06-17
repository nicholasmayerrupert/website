// View camera + input policy (ported from createSandGame.js).
//
// The engine now owns the view over the buffer and the input semantics. JS is a
// thin shell: it sizes the canvas, forwards raw DOM events (held keys, the
// pointer in canvas-relative CSS px, button state), and drives the RAF/fixed-step
// loop. Everything else — clamped camera bounds, free-camera panning, the
// follow glide, the pointer->aim-cell mapping, the player input bitmask, and the
// world-stream-with-camera-pullback — lives here.

// ---- state ----
double camX = 0, camY = 0;            // top-left visible cell (buffer space, fractional)
double camMaxX = 0, camMaxY = 0;      // travel bounds = buffer extent - visible window
int viewportCols = 0, viewportRows = 0;
int cellDevPx = 1;                    // integer device px per cell (for the aim mapping)
double viewDpr = 1;
double pointerCssX = -1, pointerCssY = -1; // last pointer, canvas-relative CSS px
int pointerBtns = 0;                  // bit0 = LMB, bit1 = RMB
bool pointerInside = false;
uint32_t heldKeys = 0;                // bitmask over InputKey
bool playModeOn = true;               // WASD drive the player (camera follows) vs. free-cam
bool drawModeOn = false;              // drawing into the sim (mouse = player primary/secondary)

// ---- camera ----
void cameraClamp() {
  if (camX < 0) camX = 0; else if (camX > camMaxX) camX = camMaxX;
  if (camY < 0) camY = 0; else if (camY > camMaxY) camY = camMaxY;
}
void cameraSetBounds(double mx, double my) { camMaxX = mx > 0 ? mx : 0; camMaxY = my > 0 ? my : 0; cameraClamp(); }
void cameraSet(double x, double y) { camX = x; camY = y; cameraClamp(); }
void cameraPanBy(double dx, double dy) { camX += dx; camY += dy; cameraClamp(); }
int cameraColX() { return (int)std::floor(camX); }
int cameraColY() { return (int)std::floor(camY); }

// Viewport + cell metrics, and the derived camera bounds. Called from JS fit().
void setViewport(double dpr, int cellDev, int vCols, int vRows) {
  viewDpr = dpr; cellDevPx = cellDev > 0 ? cellDev : 1;
  viewportCols = vCols; viewportRows = vRows;
  cameraSetBounds(cols - vCols, rows - vRows);
}

// ---- input forwarding ----
void inputKey(int code, int down) {
  if (code < 0 || code > IK_SHIFT) return;
  if (down) heldKeys |= (1u << code); else heldKeys &= ~(1u << code);
}
void inputClearKeys() { heldKeys = 0; }
void inputPointer(double cssX, double cssY, int buttons, int inside) {
  pointerCssX = cssX; pointerCssY = cssY; pointerBtns = buttons; pointerInside = inside != 0;
}
void setPlayModeOn(int on) { playModeOn = on != 0; }
void setDrawModeOn(int on) { drawModeOn = on != 0; }

// Pointer (canvas-relative CSS px) -> buffer cell, inverting the render mapping
// exactly: cells draw at cellDevPx DEVICE px, so convert to device px (* dpr)
// and divide by cellDevPx.
double aimCellX() { return std::floor(camX + pointerCssX * viewDpr / cellDevPx); }
double aimCellY() { return std::floor(camY + pointerCssY * viewDpr / cellDevPx); }

// Normalized local player input each step: held keys (+ up/space -> jump) and,
// in draw mode, the mouse buttons as primary/secondary.
int localInputBits() {
  int b = 0;
  if (heldKeys & (1u << IK_LEFT)) b |= PI_LEFT;
  if (heldKeys & (1u << IK_RIGHT)) b |= PI_RIGHT;
  if (heldKeys & ((1u << IK_UP) | (1u << IK_SPACE))) b |= PI_JUMP;
  if (heldKeys & (1u << IK_DOWN)) b |= PI_DOWN;
  if (heldKeys & (1u << IK_SHIFT)) b |= PI_RUN;
  // Survival aims/places with the mouse whenever the cursor is over the canvas —
  // no "Draw" toggle gating (the fullscreen game has no page to scroll). The
  // player only acts while a button is held, so always-aim just means "hover to
  // aim, click to build/mine."
  if (pointerInside) {
    if (pointerBtns & 1) b |= PI_PRIMARY;
    if (pointerBtns & 2) b |= PI_SECONDARY;
  }
  return b;
}

// ---- per-frame / per-step drivers ----
// Free-camera pan from held keys, scaled by real frame time. No-op in play mode
// (the keys drive the player there and the camera follows it).
void cameraPanFrame(double frameDtMs) {
  if (playModeOn) return;
  int px = (int)((heldKeys >> IK_RIGHT) & 1) - (int)((heldKeys >> IK_LEFT) & 1);
  int py = (int)((heldKeys >> IK_DOWN) & 1) - (int)((heldKeys >> IK_UP) & 1);
  if (!px && !py) return;
  double dist = CAM_PAN_CELLS_PER_SEC * (frameDtMs / 1000.0);
  cameraPanBy((px > 0 ? 1 : (px < 0 ? -1 : 0)) * dist, (py > 0 ? 1 : (py < 0 ? -1 : 0)) * dist);
}
// Glide the camera toward a target center (the followed player's center). JS
// supplies the center so the source (local engine player vs. host snapshot on a
// client) stays its concern.
void cameraFollowTo(double cx, double cy) {
  double tx = cx - viewportCols / 2.0, ty = cy - viewportRows / 2.0;
  cameraSet(camX + (tx - camX) * CAM_FOLLOW_LERP, camY + (ty - camY) * CAM_FOLLOW_LERP);
}
// Decide + apply a world-stream: slide the buffer (engine), the cell texture
// (GL), and pull the camera back in lockstep. Returns the applied dx.
int streamWorld() {
  int dx = maybeShiftWorld(cameraColX(), viewportCols, CAM_SHIFT_EDGE_MARGIN);
  if (dx) { glShift(dx); cameraSet(camX - dx, camY); }
  return dx;
}
// Apply this frame's local input. Play mode: feed the player (id) its input bits
// + aim. Draw (free-build) mode: run the active tool at the aim cell. Returns 1
// if a draft preview changed (draw mode only).
int applyLocalInput(int playerId, double now, uint32_t seq) {
  if (playModeOn) {
    if (playerId) setPlayerInput(playerId, localInputBits(), aimCellX(), aimCellY(), activeTool, seq);
    return 0;
  }
  return applyTool((int)aimCellX(), (int)aimCellY(), now, pointerInside, drawModeOn) ? 1 : 0;
}
// Pointer-driven draft preview in draw mode (build tools), using the current aim.
int pointerDraftAtAim() { return pointerDraft((int)aimCellX(), (int)aimCellY()); }
int pointerDownAtAim(int button) { return pointerDown((int)aimCellX(), (int)aimCellY(), button); }
