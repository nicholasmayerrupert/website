#pragma once
// WebGL compositor for layer textures, gutters, actors, and draft previews.
// Context/program state is per canvas; textures and FBOs are per engine.

struct Engine;

class GLPresenter {
 public:
  explicit GLPresenter(Engine& e) : E(e) {}

  sandgl::Ctx* glc = nullptr;
  std::string glTarget;
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
  // Inclusive cell rect whose texture pixels were valid on the last present.
  // A pure pan retains the overlap and fills only newly exposed edge bands.
  int glLastVisX0 = -1, glLastVisY0 = -1, glLastVisX1 = -1, glLastVisY1 = -1;
  // Only a brand-new presentation mirror may use the cheap regional first
  // solve. Texture rebuilds after real content exists retain the full-refresh
  // lighting contract even though they also reset the last-window sentinels.
  bool glCheapFirstPresent = false;
  // Render-only material animation runs on a low, pixel-art-friendly cadence.
  // Chunk flags are learned while filling the visible window, so a settled scene
  // repaints only chunks that actually contain animated cells.
  static constexpr double GL_ANIM_FRAME_MS = 1000.0 / 12.0;
  uint32_t glLastAnimFrame = UINT32_MAX;
  bool glVisibleAnimated = false;
  bool glAnimationPaused = false;
  std::vector<uint8_t> glAnimatedFg, glAnimatedBg;
  // Full-window lighting is throttled on continuously active scenes. Presentation
  // mirrors repair the exact columns touched by structural or user-edit diffs,
  // and moving render lights repair their bounded influence rect immediately.
  // World shifts, skylight changes, and forced refreshes still solve immediately.
  static constexpr int GL_LIGHT_THROTTLE_TICKS = 2;
  static constexpr double GL_PRESENTATION_LIGHT_INTERVAL_MS = 125.0;
  int glLightTick = INT_MIN;
  double glLightWallMs = -1e9;
  // Windowed lighting (Perf 7c): throttled solves cover only the visible
  // window + GL_LIGHT_WINDOW_MARGIN. Light influence dies within 59 cells of
  // its source (min loss 4/cell, 255 -> ambient 20) and the cross-layer
  // projection is cell-to-cell, so values within the last solve region shrunk
  // by GL_LIGHT_EXACT_SHRINK (60 + the face-lit neighbour ring) are exactly
  // the full-solve values. When the window (+1) drifts outside that exact
  // zone, a re-solve is forced (throttle bypassed). The initial presentation
  // and ordinary presentation stream shifts solve the visible window + margin.
  // Direct skylight refreshes all column provenance when the world shifts.
  // Forced refreshes and day/night changes solve the full buffer.
  static constexpr int GL_LIGHT_WINDOW_MARGIN = 72;
  static constexpr int GL_LIGHT_EXACT_SHRINK = 61;
  static constexpr int GL_LIGHT_CHANGE_REACH = 60;
  // When a pan reaches the edge of the exact lighting cache, solve fresh strips
  // beyond the viewport so later camera cells reuse exact light.
  static constexpr int GL_LIGHT_PAN_LOOKAHEAD = 32;
  static constexpr int GL_DYNAMIC_LIGHT_CAP = 32;
  // Inclusive rectangle of exact cached light, including face-light neighbours.
  // Pan patches extend it; terrain patches invalidate its offscreen portion.
  int glLightX0 = -1, glLightY0 = -1, glLightX1 = -1, glLightY1 = -1;
  // Exact x-ranges where a presentation diff changed a structural cell or a
  // worker-tagged user edit. Replication records them before replacing mirror rows.
  std::vector<std::pair<int, int>> glTerrainLightIntervals;
  void glNoteTerrainLightChange(int x0, int x1) {
    if (x0 <= x1) glTerrainLightIntervals.push_back({x0, x1});
  }
  // The old and new source bounds cover both sides of a moving light trail.
  bool glDynamicLightPending = false;
  int glDynamicLightX0 = INT_MAX, glDynamicLightY0 = INT_MAX;
  int glDynamicLightX1 = INT_MIN, glDynamicLightY1 = INT_MIN;
  int glOwnPlayerId = 0;                // which engine player draws as "own" (blue)
  bool glUseExtPlayers = false;         // client renders remote players from JS snapshots
  std::vector<float> glExtPlayers;      // packed GLP_* authority-render records

  // The authority owns survival inventory/tool state, while this engine is only
  // a presentation replica. Keep the tiny hover-preview state explicit instead
  // of guessing it from the predictor's deliberately inventory-free Player.
  bool glSurvivalPreviewOn = false;
  int glSurvivalPreviewFootprint = SURVIVAL_FOOTPRINT_DEFAULT_ID;
  bool glSurvivalPreviewErasing = true;
  bool glSurvivalPreviewLocked = false;
  int glSurvivalPreviewX = 0, glSurvivalPreviewY = 0;
  double glMineProgress = 0;
  int glMineTier = 0;

  bool glUseExtItems = false;           // client renders dropped items from host snapshots
  std::vector<float> glExtItems;        // packed IS_* authority-render records
  bool glUseExtCreatures = false;       // client renders authoritative creatures
  std::vector<float> glExtCreatures;    // packed creatureSnapshot records
  bool glUseExtProjectiles = false;
  std::vector<float> glExtProjectiles;

  bool glReady() const;
  int glInit(const char* target);
  int glRestore();
  void glDestroy();
  void glReleaseContext();
  void glResize(int devW, int devH);
  void glSetCamera(double camX_, double camY_, double cellDev, int viewCols, int viewRows,
                 int gutterOn, int snapOff);
  // Transactionally rebuild both layer textures for a loaded-window resize.
  // The shift scratch texture is lazy because presentation mirrors never use it
  // in ordinary play. New textures are validated before the old set is released,
  // so a device-memory failure leaves the current renderer intact instead of
  // producing a blank canvas. A headless engine succeeds without allocating.
  int glRebuildCellTextures(int texCols, int texRows);
  void glSyncCamera();
  void glSetFlags(int gutterOn, int snapOff, int animationPaused);
  void glSetDebugHitboxes(int on);
  void glSetPlayers(int useExternal, const float* data, int count, int ownId);
  void glSetSurvivalPreview(int on, int footprint, int erasing, int locked, int x, int y, double progress, int tier);
  void glSetItems(int useExternal, const float* data, int count);
  void glSetCreatures(int useExternal, const float* data, int count);
  void glSetProjectiles(int useExternal, const float* data, int count);
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
  void glCollectDynamicLights();
  float glActorLight(double px, double py, int w, int h) const;
  void glDrawWard(double pxc, double pyc, int facing, double aimX, double aimY,
                  int shieldHealth, bool shieldActive, int camCol, int camRow);
  void glDrawOnePlayer(double pxc, double pyc, int facing, int animState, int animFrame,
                     bool alive, int heldItemKind, double bowCharge, double aimX, double aimY,
                     double jetpackFuel, bool jetpackActive, int shieldHealth,
                     bool shieldActive, double weaponKick, int hurtCooldown, bool own, float light, int camCol, int camRow,
                     int heldDefinition, const int* equipment);
  std::vector<float> chestData;
  void glDrawChests();
  void glDrawPlayers();
  void glDrawOneItem(int id, int kind, int itemKind, int material, int count, int tier, double px, double py, int life,
                     int camCol, int camRow);
  void glDrawItems();
  void glDrawProjectiles();
  void glDrawOneCreature(int species, double px, double py, int facing, int health, int maxHealth,
                         int alive, int animFrame, int attackState, int attackPattern,
                         double attackProgress,
                         double aimX, double aimY, double spawnProgress,
                    double rescueProgress, int hurtCooldown, double shelterCharge, float light,
                         int camCol, int camRow, int npcId = 0);
  void glDrawCreatures();
  void glDrawPreview();
  void glPresentWindow(int forceFull);
  int glRenderFrame(int forceFull);
  void glGetOffset(int* out);
  int glReadback(int x, int y, int w, int h, uint8_t* out);

 private:
  Engine& E;
};
