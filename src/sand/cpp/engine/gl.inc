// WebGL presentation (the engine's compositor). Uploads the CPU-generated cell
// pixel buffer (render.inc) into a cols x rows texture and draws the visible
// window as one nearest-neighbour upscaled quad, plus the 1px gutter grid, the
// player overlay, and the draft preview. This is the C++ port of the old JS
// present()/drawPlayers()/renderPreview()/shiftCellCanvas() pipeline.
//
// Parity with the 2D path is preserved by construction: same pixel source, same
// integer-device-px snapping of the sub-cell pan offset (the documented flicker
// fix), same nearest upscale, same gutter, same overlay colors. Only the blit
// moved from a 2D canvas to GL. The context + program live per-canvas
// (gl_shared.hpp); the textures + FBOs below are per-engine and rebuilt on
// resize.

// Decide full-vs-incremental upload exactly like the old syncCellCanvas.
static constexpr double GL_FULL_UPLOAD_DIRTY_RATIO = 0.38;

sandgl::Ctx* glc = nullptr;
GLuint glTex = 0, glTexBg = 0, glTex2 = 0, glReadFBO = 0, glDrawFBO = 0;
// Background draws at ~55% brightness behind the foreground so it reads as "behind".
static constexpr float GL_BG_TINT = 0.55f;
int glDevW = 0, glDevH = 0;           // canvas backing-store size (device px)
double glCamX = 0, glCamY = 0;        // camera top-left in buffer cells (fractional)
int glCellDev = 1, glViewCols = 0, glViewRows = 0;
int glGutterOn = 1, glSnapOff = 0;
double glOffX = 0, glOffY = 0;        // snapped sub-cell present offset (device px)
int glOwnPlayerId = 0;                // which engine player draws as "own" (blue)
bool glUseExtPlayers = false;         // client renders remote players from JS snapshots
std::vector<float> glExtPlayers;      // packed [x,y,w,h,facing,own] per player

bool glReady() const { return glc != nullptr && glc->ready && glTex != 0; }

int glInit(const char* target) {
  glc = sandgl::acquire(target);
  if (!glc) return 0;
  emscripten_webgl_make_context_current(glc->handle);
  auto mkTex = [&](GLuint& t) {
    glGenTextures(1, &t);
    glBindTexture(GL_TEXTURE_2D, t);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, cols, rows, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
  };
  mkTex(glTex);
  mkTex(glTexBg);
  mkTex(glTex2);
  glGenFramebuffers(1, &glReadFBO);
  glGenFramebuffers(1, &glDrawFBO);
  useLayer(&bg); renderFull(); glUploadFull(glTexBg);
  useLayer(&fg); renderFull(); glUploadFull(glTex);
  return 1;
}

// Free the per-engine GL objects (the context + program persist for the canvas).
void glDestroy() {
  if (!glc) return;
  emscripten_webgl_make_context_current(glc->handle);
  if (glTex) glDeleteTextures(1, &glTex);
  if (glTexBg) glDeleteTextures(1, &glTexBg);
  if (glTex2) glDeleteTextures(1, &glTex2);
  if (glReadFBO) glDeleteFramebuffers(1, &glReadFBO);
  if (glDrawFBO) glDeleteFramebuffers(1, &glDrawFBO);
  glTex = glTexBg = glTex2 = glReadFBO = glDrawFBO = 0;
  glc = nullptr;
}

void glResize(int devW, int devH) { glDevW = devW; glDevH = devH; }

void glSetCamera(double camX_, double camY_, int cellDev, int viewCols, int viewRows,
                 int gutterOn, int snapOff) {
  glCamX = camX_; glCamY = camY_;
  glCellDev = cellDev > 0 ? cellDev : 1;
  glViewCols = viewCols; glViewRows = viewRows;
  glGutterOn = gutterOn; glSnapOff = snapOff;
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  double rawX = -(glCamX - camCol) * glCellDev, rawY = -(glCamY - camRow) * glCellDev;
  glOffX = snapOff ? rawX : std::round(rawX);
  glOffY = snapOff ? rawY : std::round(rawY);
}
// Copy the engine's live camera/viewport (camera.inc) into the GL present state.
// The camera moved into the engine in P2; the GL compositor reads it through
// this each frame instead of JS passing it in.
void glSyncCamera() { glSetCamera(camX, camY, cellDevPx, viewportCols, viewportRows, glGutterOn, glSnapOff); }
// DEV A/B flags (flicker bench): toggle the gutter grid and offset snapping.
void glSetFlags(int gutterOn, int snapOff) { glGutterOn = gutterOn; glSnapOff = snapOff; }

void glSetPlayers(int useExternal, const float* data, int count, int ownId) {
  glOwnPlayerId = ownId;
  glUseExtPlayers = useExternal != 0;
  if (glUseExtPlayers) glExtPlayers.assign(data, data + (size_t)count * 6);
  else glExtPlayers.clear();
}

// ---- texture uploads (active layer's renderPixels -> the given texture) ----
void glUploadFull(GLuint tex) {
  glBindTexture(GL_TEXTURE_2D, tex);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
  glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
  glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
  glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, cols, rows, GL_RGBA, GL_UNSIGNED_BYTE, L->renderPixels.data());
}
void glUploadRects(GLuint tex) {
  glBindTexture(GL_TEXTURE_2D, tex);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glPixelStorei(GL_UNPACK_ROW_LENGTH, cols);
  for (size_t i = 0; i + 3 < L->dirtyRects.size(); i += 4) {
    int x0 = L->dirtyRects[i], y0 = L->dirtyRects[i + 1], x1 = L->dirtyRects[i + 2], y1 = L->dirtyRects[i + 3];
    int w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    glPixelStorei(GL_UNPACK_SKIP_PIXELS, x0);
    glPixelStorei(GL_UNPACK_SKIP_ROWS, y0);
    glTexSubImage2D(GL_TEXTURE_2D, 0, x0, y0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, L->renderPixels.data());
  }
  glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
  glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
  glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
}

// Slide ONE cell texture by dx world-columns (glTex2 is the scratch target).
void glShiftTex(GLuint& tex, int dx) {
  int s = dx > 0 ? dx : -dx;
  glBindFramebuffer(GL_READ_FRAMEBUFFER, glReadFBO);
  glFramebufferTexture2D(GL_READ_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, glDrawFBO);
  glFramebufferTexture2D(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, glTex2, 0);
  if (dx > 0) glBlitFramebuffer(dx, 0, cols, rows, 0, 0, cols - dx, rows, GL_COLOR_BUFFER_BIT, GL_NEAREST);
  else        glBlitFramebuffer(0, 0, cols - s, rows, s, 0, cols, rows, GL_COLOR_BUFFER_BIT, GL_NEAREST);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, 0);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
  std::swap(tex, glTex2);
}
// Slide BOTH layers' textures to mirror shiftWorld's grid memmove (the GPU
// analogue of the old shiftCellCanvas). The exposed band repaints from dirty
// chunks next frame. The world shifts both layers in lockstep (P5).
void glShift(int dx) {
  if (!dx || !glReady()) return;
  emscripten_webgl_make_context_current(glc->handle);
  if (dx >= cols || -dx >= cols) {
    useLayer(&bg); renderFull(); glUploadFull(glTexBg);
    useLayer(&fg); renderFull(); glUploadFull(glTex);
    return;
  }
  glShiftTex(glTex, dx);
  glShiftTex(glTexBg, dx);
}
// Vertical analogue of glShiftTex: slide the cell texture by dy rows. The grid is
// uploaded with row 0 at the top, but the GL framebuffer origin is bottom-left, so
// a grid shift of +dy (content moves toward row 0) is a blit toward larger Y here.
void glShiftTexV(GLuint& tex, int dy) {
  int s = dy > 0 ? dy : -dy;
  glBindFramebuffer(GL_READ_FRAMEBUFFER, glReadFBO);
  glFramebufferTexture2D(GL_READ_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, glDrawFBO);
  glFramebufferTexture2D(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, glTex2, 0);
  if (dy > 0) glBlitFramebuffer(0, s, cols, rows, 0, 0, cols, rows - s, GL_COLOR_BUFFER_BIT, GL_NEAREST);
  else        glBlitFramebuffer(0, 0, cols, rows - s, 0, s, cols, rows, GL_COLOR_BUFFER_BIT, GL_NEAREST);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, 0);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
  std::swap(tex, glTex2);
}
void glShiftV(int dy) {
  if (!dy || !glReady()) return;
  emscripten_webgl_make_context_current(glc->handle);
  if (dy >= rows || -dy >= rows) {
    useLayer(&bg); renderFull(); glUploadFull(glTexBg);
    useLayer(&fg); renderFull(); glUploadFull(glTex);
    return;
  }
  glShiftTexV(glTex, dy);
  glShiftTexV(glTexBg, dy);
}

// ---- drawing ----
inline void glSetClip(double dx0, double dy0, double dx1, double dy1) {
  float cx0 = (float)(dx0 / glDevW * 2.0 - 1.0);
  float cy0 = (float)(1.0 - dy0 / glDevH * 2.0);  // top
  float cx1 = (float)(dx1 / glDevW * 2.0 - 1.0);
  float cy1 = (float)(1.0 - dy1 / glDevH * 2.0);  // bottom
  glUniform4f(glc->uClipRect, cx0, cy0, cx1, cy1);
}
inline void glSolidDev(double dx0, double dy0, double w, double h) {
  glSetClip(dx0, dy0, dx0 + w, dy0 + h);
  glUniform4f(glc->uTexRect, 0, 0, 0, 0);
  glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
}

// Draw the visible window of one layer's texture at brightness `tint`. The
// background passes gutter=0 (no internal grid — the foreground's gutter reveals
// the darker background behind it) and tint<1; the foreground passes the real
// gutter flag and tint=1. Both use the same snapped camera offset (flicker fix).
void glDrawCells(GLuint tex, float tint, int gutter) {
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  int visX0 = camCol, visY0 = camRow;
  int visX1 = imin(cols - 1, camCol + glViewCols + 1);  // +1 covers the sub-cell shift
  int visY1 = imin(rows - 1, camRow + glViewRows + 1);
  int vw = visX1 - visX0 + 1, vh = visY1 - visY0 + 1;
  if (vw <= 0 || vh <= 0) return;
  double devW = (double)vw * glCellDev, devH = (double)vh * glCellDev;
  glUniform1i(glc->uMode, 0);
  glUniform1i(glc->uGutter, gutter);
  glUniform1f(glc->uTint, tint);
  glUniform1f(glc->uCellDev, (float)glCellDev);
  glUniform2f(glc->uQuadDev, (float)devW, (float)devH);
  glUniform4f(glc->uTexRect, (float)visX0 / cols, (float)visY0 / rows,
              (float)(visX0 + vw) / cols, (float)(visY0 + vh) / rows);
  glBindTexture(GL_TEXTURE_2D, tex);
  glSetClip(glOffX, glOffY, glOffX + devW, glOffY + devH);
  glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
}

void glDrawOnePlayer(double pxc, double pyc, int w, int h, int facing, bool own,
                     int camCol, int camRow) {
  double sx = (pxc - camCol) * glCellDev + glOffX;
  double sy = (pyc - camRow) * glCellDev + glOffY;
  double pw = (double)w * glCellDev, ph = (double)h * glCellDev;
  if (own) glUniform4f(glc->uColor, 80 / 255.0f, 170 / 255.0f, 255 / 255.0f, 0.92f);
  else     glUniform4f(glc->uColor, 255 / 255.0f, 140 / 255.0f, 80 / 255.0f, 0.92f);
  glSolidDev(sx, sy, pw, ph);
  double eye = imax(1, (int)std::lround(glCellDev * 0.7));
  double ex = facing >= 0 ? sx + pw - eye - glCellDev * 0.4 : sx + glCellDev * 0.4;
  glUniform4f(glc->uColor, 20 / 255.0f, 30 / 255.0f, 45 / 255.0f, 0.9f);
  glSolidDev(ex, sy + ph * 0.18, eye, eye);
}

void glDrawPlayers() {
  glUniform1i(glc->uMode, 1);
  glUniform1i(glc->uGutter, 0);
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  if (glUseExtPlayers) {
    int n = (int)(glExtPlayers.size() / 6);
    for (int i = 0; i < n; i++) {
      const float* p = &glExtPlayers[(size_t)i * 6];
      glDrawOnePlayer(p[0], p[1], (int)p[2], (int)p[3], (int)p[4], p[5] > 0.5f, camCol, camRow);
    }
  } else {
    for (auto& p : players) {
      if (!p.active) continue;
      glDrawOnePlayer(p.px, p.py, p.w, p.h, p.facing, p.id == glOwnPlayerId, camCol, camRow);
    }
  }
}

void glDrawPreview() {
  glUniform1i(glc->uMode, 1);
  glUniform1i(glc->uGutter, 0);
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  auto cell = [&](int x, int y) {
    glSolidDev((x - camCol) * glCellDev + glOffX, (y - camRow) * glCellDev + glOffY, glCellDev, glCellDev);
  };
  // Background drafts (RMB) read darker so they look like they're behind the world.
  float df = (draftLayer == 1) ? GL_BG_TINT : 1.0f;
  if (!stoneDraft.empty()) {
    if (draftIsDriftwood) glUniform4f(glc->uColor, df * 140 / 255.0f, df * 125 / 255.0f, df * 110 / 255.0f, 0.45f);
    else                  glUniform4f(glc->uColor, df * 160 / 255.0f, df * 160 / 255.0f, df * 170 / 255.0f, 0.40f);
    for (int k : stoneDraft) { int y = k / cols; cell(k - y * cols, y); }
  }
  if (!iceDraft.empty()) {
    glUniform4f(glc->uColor, df * 150 / 255.0f, df * 225 / 255.0f, df * 240 / 255.0f, 0.40f);
    for (int k : iceDraft) { int y = k / cols; cell(k - y * cols, y); }
  }
  if (draftingSeed && hasSeedOrigin) {
    bool valid = canPlaceSeedAt(seedOriginX, seedOriginY);
    if (valid) glUniform4f(glc->uColor, df * 120 / 255.0f, df * 190 / 255.0f, df * 100 / 255.0f, 0.32f);
    else       glUniform4f(glc->uColor, 255 / 255.0f, 80 / 255.0f, 80 / 255.0f, 0.24f);
    for (int y = seedOriginY; y < seedOriginY + SEED_SIZE; y++)
      for (int x = seedOriginX; x < seedOriginX + SEED_SIZE; x++) cell(x, y);
  }

  // Survival: a "cursor" disc at the local player's aim shows where the tool will
  // act and into which layer — LMB foreground (bright), RMB background (dim), the
  // eraser red. Faded when the aim is out of the player's reach.
  if (playModeOn && glOwnPlayerId) {
    Player* lp = nullptr;
    for (auto& pp : players) if (pp.id == glOwnPlayerId && pp.active) { lp = &pp; break; }
    if (lp) {
      int ax = (int)std::floor(lp->aimX), ay = (int)std::floor(lp->aimY);
      bool toBg = (pointerBtns & 2) != 0;
      bool erasing = (lp->selectedTool == T_ERASER);
      if (erasing && (pointerBtns & 3) != 0) return;
      double cxp = lp->px + lp->w / 2.0, cyp = lp->py + lp->h / 2.0;
      double dxp = (ax + 0.5) - cxp, dyp = (ay + 0.5) - cyp;
      bool inReach = dxp * dxp + dyp * dyp <= P_TOOL_REACH * P_TOOL_REACH;
      float a = inReach ? 0.40f : 0.14f;
      if (erasing)   glUniform4f(glc->uColor, 255 / 255.0f, 90 / 255.0f, 80 / 255.0f, a);
      else if (toBg) glUniform4f(glc->uColor, 120 / 255.0f, 140 / 255.0f, 170 / 255.0f, a);
      else           glUniform4f(glc->uColor, 180 / 255.0f, 215 / 255.0f, 255 / 255.0f, a);
      int r = erasing ? P_MINE_R : P_BUILD_R;
      for (int oy = -r; oy <= r; oy++) for (int ox = -r; ox <= r; ox++) { if (ox * ox + oy * oy > r * r) continue; cell(ax + ox, ay + oy); }
    }
  }
}

// Upload one layer's changed cells into its texture (per-layer dirty decision,
// mirrors the old syncCellCanvas full-vs-rects choice).
void glUploadLayer(Layer* lay, GLuint tex, int forceFull) {
  useLayer(lay);
  buildDirtyRects();
  int chunkTotal = chunkCols * chunkRows;
  if (forceFull || L->dirtyRenderCount > 0) {
    bool whole = forceFull || L->dirtyRenderCount > (int)(chunkTotal * GL_FULL_UPLOAD_DIRTY_RATIO);
    if (whole) { renderFull(); glUploadFull(tex); }
    else { renderDirtyRects(); glUploadRects(tex); }
    memset(dirtyRender, 0, (size_t)chunkCols * chunkRows);
    L->dirtyRenderCount = 0;
  }
}

// One presented frame: upload both layers, then composite background (darker)
// then foreground, then players + preview. forceFull forces a whole-buffer
// upload (init/resize). Returns 1 if drawn.
int glRenderFrame(int forceFull) {
  if (!glReady()) return 0;
  emscripten_webgl_make_context_current(glc->handle);
  glSyncCamera();
  glUploadLayer(&bg, glTexBg, forceFull);
  glUploadLayer(&fg, glTex, forceFull);
  useLayer(&fg); // preview/seed checks read the foreground grid
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glViewport(0, 0, glDevW, glDevH);
  glDisable(GL_DEPTH_TEST);
  glEnable(GL_BLEND);
  glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
  glClearColor(0, 0, 0, 0);
  glClear(GL_COLOR_BUFFER_BIT);
  glUseProgram(glc->prog);
  glBindVertexArray(glc->vao);
  glActiveTexture(GL_TEXTURE0);
  glUniform1i(glc->uTex, 0);
  glDrawCells(glTexBg, GL_BG_TINT, 0);            // background first (darker, no internal gutter)
  glDrawCells(glTex, 1.0f, glGutterOn ? 1 : 0);   // foreground on top
  glDrawPlayers();
  glDrawPreview();
  return 1;
}

void glGetOffset(int* out) { glSyncCamera(); out[0] = (int)std::lround(glOffX); out[1] = (int)std::lround(glOffY); }

// Read back a top-down RGBA region of the canvas (bench flicker probe). glReadPixels
// is bottom-up, so flip rows into `out`.
int glReadback(int x, int y, int w, int h, uint8_t* out) {
  if (!glReady() || w <= 0 || h <= 0) return 0;
  emscripten_webgl_make_context_current(glc->handle);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  std::vector<uint8_t> tmp((size_t)w * h * 4);
  int gy = glDevH - (y + h);
  glReadPixels(x, gy, w, h, GL_RGBA, GL_UNSIGNED_BYTE, tmp.data());
  size_t row = (size_t)w * 4;
  for (int r = 0; r < h; r++) memcpy(out + (size_t)r * row, tmp.data() + (size_t)(h - 1 - r) * row, row);
  return 1;
}
