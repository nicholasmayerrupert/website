#pragma once
// WebGL presentation (the engine's compositor) — extracted from the Engine in
// 5c. Uploads the CPU-generated cell pixel buffer (Renderer) into cols x rows
// textures and draws the visible window as one nearest-neighbour upscaled
// quad, plus the 1px gutter grid, the player/creature/item overlays, and the draft
// preview. The context + program live per-canvas (gl_shared.hpp); the textures
// + FBOs here are per-engine and rebuilt on resize. Parity notes (snapped
// sub-cell offset = the documented flicker fix) live with the methods in
// glpresenter_impl.inc.

struct Engine;

class GLPresenter {
 public:
  explicit GLPresenter(Engine& e) : E(e) {}

  // Decide full-vs-incremental upload exactly like the old syncCellCanvas.
  static constexpr double GL_FULL_UPLOAD_DIRTY_RATIO = 0.38;

  sandgl::Ctx* glc = nullptr;
  GLuint glTex = 0, glTexBg = 0, glTex2 = 0, glReadFBO = 0, glDrawFBO = 0;
  // Background draws at ~55% brightness behind the foreground so it reads as "behind".
  static constexpr float GL_BG_TINT = 0.55f;
  int glDevW = 0, glDevH = 0;           // canvas backing-store size (device px)
  double glCamX = 0, glCamY = 0;        // camera top-left in buffer cells (fractional)
  double glCellDev = 1;                 // device px per cell (fractional when zoomed out past 1 px/cell)
  int glViewCols = 0, glViewRows = 0;
  int glGutterOn = 1, glSnapOff = 0;
  bool glDebugHitboxes = false;
  double glOffX = 0, glOffY = 0;        // snapped sub-cell present offset (device px)
  // Last presented window origin + world offset + skylight. The present path renders
  // only the VISIBLE window into the textures (off-screen texels are never sampled), so
  // it must re-fill whenever the sampled window moves — a whole-cell pan, a world shift,
  // or a skylight change — not just when the grid is dirty. INT_MIN forces the first frame.
  int glLastCamCol = INT_MIN, glLastCamRow = INT_MIN;
  int glLastWorldOffX = INT_MIN, glLastWorldOffY = INT_MIN;
  int glLastSkyLight = -1;
  // Lighting-recompute throttle. The full-buffer light solve is by far the costliest
  // part of the present path, so on a continuously-active scene it is re-solved at most
  // once every GL_LIGHT_THROTTLE_TICKS sim ticks and the (buffer-indexed, pan-invariant)
  // result is reused between — a barely-perceptible lag in dynamic light for a large
  // CPU saving. A world shift (light buffer misaligns), a skylight change, or a forced
  // full refresh always re-solve immediately. glLightTick is the tick of the last solve.
  static constexpr int GL_LIGHT_THROTTLE_TICKS = 2;
  int glLightTick = INT_MIN;
  // Windowed lighting (Perf 7c): throttled solves cover only the visible
  // window + GL_LIGHT_WINDOW_MARGIN. Light influence dies within 59 cells of
  // its source (min loss 4/cell, 255 -> ambient 20) and the cross-layer
  // projection is cell-to-cell, so values within the last solve region shrunk
  // by GL_LIGHT_EXACT_SHRINK (60 + the face-lit neighbour ring) are exactly
  // the full-solve values. When the window (+1) drifts outside that exact
  // zone, a re-solve is forced (throttle bypassed). Shifts/day-night/init
  // still solve the full buffer so the sky shift-remap caches stay coherent.
  static constexpr int GL_LIGHT_WINDOW_MARGIN = 72;
  static constexpr int GL_LIGHT_EXACT_SHRINK = 61;
  int glLightX0 = -1, glLightY0 = -1, glLightX1 = -1, glLightY1 = -1; // last solve region (-1 = never solved)
  int glOwnPlayerId = 0;                // which engine player draws as "own" (blue)
  bool glUseExtPlayers = false;         // client renders remote players from JS snapshots
  std::vector<float> glExtPlayers;      // packed [x,y,w,h,facing,own,animState,animFrame] per player

  // The authority owns survival inventory/tool state, while this engine is only
  // a presentation replica. Keep the tiny hover-preview state explicit instead
  // of guessing it from the predictor's deliberately inventory-free Player.
  bool glSurvivalPreviewOn = false;
  int glSurvivalPreviewFootprint = SURVIVAL_FOOTPRINT_DEFAULT_ID;
  bool glSurvivalPreviewErasing = true;
  bool glSurvivalPreviewLocked = false;
  int glSurvivalPreviewX = 0, glSurvivalPreviewY = 0;

  bool glUseExtItems = false;           // client renders dropped items from host snapshots
  std::vector<float> glExtItems;        // packed [id,kind,material,count,px,py,life] per item
  bool glUseExtCreatures = false;       // client renders authoritative creatures
  std::vector<float> glExtCreatures;    // packed creatureSnapshot records

  bool glReady() const;
  int glInit(const char* target);
  void glDestroy();
  void glResize(int devW, int devH);
  void glSetCamera(double camX_, double camY_, double cellDev, int viewCols, int viewRows,
                 int gutterOn, int snapOff);
  // Rebuild cols×rows cell textures after a loaded-window resize (keeps the GL context).
  void glRebuildCellTextures();
  void glSyncCamera();
  void glSetFlags(int gutterOn, int snapOff);
  void glSetDebugHitboxes(int on);
  void glSetPlayers(int useExternal, const float* data, int count, int ownId);
  void glSetSurvivalPreview(int on, int footprint, int erasing, int locked, int x, int y);
  void glSetItems(int useExternal, const float* data, int count);
  void glSetCreatures(int useExternal, const float* data, int count);
  void glUploadFull(GLuint tex);
  void glUploadRects(GLuint tex);
  void glVisRect(int* x0, int* y0, int* x1, int* y1);
  void glUploadWindow(GLuint tex, int x0, int y0, int x1, int y1);
  void glShiftTex(GLuint& tex, int dx);
  void glShift(int dx);
  void glShiftTexV(GLuint& tex, int dy);
  void glShiftV(int dy);
  void glSetClip(double dx0, double dy0, double dx1, double dy1);
  void glSolidDev(double dx0, double dy0, double w, double h);
  void glDrawHitbox(double px, double py, int w, int h, float r, float g, float b, int camCol, int camRow);
  void glDrawCells(GLuint tex, float tint, int gutter, int opaqueAlpha);
  float glActorLight(double px, double py, int w, int h) const;
  void glDrawOnePlayer(double pxc, double pyc, int facing, int animState, int animFrame,
                     bool own, float light, int camCol, int camRow);
  void glDrawPlayers();
  void glDrawOneItem(int id, int kind, int material, double px, double py, int life,
                   int camCol, int camRow);
  void glDrawItems();
  void glDrawOneCreature(int species, double px, double py, int facing, int health, int maxHealth,
                         int alive, int animFrame, float light, int camCol, int camRow);
  void glDrawCreatures();
  void glDrawPreview();
  void glPresentWindow(int forceFull);
  int glRenderFrame(int forceFull);
  void glGetOffset(int* out);
  int glReadback(int x, int y, int w, int h, uint8_t* out);

 private:
  Engine& E;
};
