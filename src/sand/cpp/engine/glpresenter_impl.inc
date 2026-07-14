// GLPresenter method bodies (need the full Engine definition; see glpresenter.hpp).

bool GLPresenter::glReady() const { return glc != nullptr && glc->ready && glTex != 0; }

static bool glAllocateCellTexture(GLuint& texture, int cols, int rows) {
  texture = 0;
  for (int i = 0; i < 8 && glGetError() != GL_NO_ERROR; i++) {} // discard unrelated earlier errors
  glGenTextures(1, &texture);
  glBindTexture(GL_TEXTURE_2D, texture);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, cols, rows, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
  if (glGetError() == GL_NO_ERROR) return true;
  if (texture) glDeleteTextures(1, &texture);
  texture = 0;
  return false;
}

int GLPresenter::glInit(const char* target) {
  glc = sandgl::acquire(target);
  if (!glc) return 0;
  emscripten_webgl_make_context_current(glc->handle);
  if (!glAllocateCellTexture(glTex, E.cols, E.rows) ||
      !glAllocateCellTexture(glTexBg, E.cols, E.rows)) {
    if (glTex) glDeleteTextures(1, &glTex);
    if (glTexBg) glDeleteTextures(1, &glTexBg);
    if (glTex2) glDeleteTextures(1, &glTex2);
    glTex = glTexBg = glTex2 = 0;
    glc = nullptr;
    return 0;
  }
  glGenFramebuffers(1, &glReadFBO);
  glGenFramebuffers(1, &glDrawFBO);
  E.useLayer(&E.fg); E.renderer.renderFull(); glUploadFull(glTex);
  E.useLayer(&E.bg); E.renderer.renderFull(); glUploadFull(glTexBg);
  return 1;
}

int GLPresenter::glRestore() {
  if (!glc) return 0;
  emscripten_webgl_make_context_current(glc->handle);
  if (!sandgl::restoreProgram(*glc)) return 0;

  // The old names became invalid when the context was lost; do not delete them.
  glTex = glTexBg = glTex2 = glReadFBO = glDrawFBO = 0;
  if (!glAllocateCellTexture(glTex, E.cols, E.rows) ||
      !glAllocateCellTexture(glTexBg, E.cols, E.rows)) {
    if (glTex) glDeleteTextures(1, &glTex);
    if (glTexBg) glDeleteTextures(1, &glTexBg);
    glTex = glTexBg = 0;
    return 0;
  }
  glGenFramebuffers(1, &glReadFBO);
  glGenFramebuffers(1, &glDrawFBO);
  glLastCamCol = glLastCamRow = INT_MIN;
  glLastWorldOffX = glLastWorldOffY = INT_MIN;
  glLastSkyLight = glLightTick = INT_MIN;
  glLastAnimFrame = UINT32_MAX; glVisibleAnimated = false;
  glAnimatedFg.clear(); glAnimatedBg.clear();
  glLightX0 = glLightY0 = glLightX1 = glLightY1 = -1;
  E.useLayer(&E.fg); E.markAllDirty();
  E.useLayer(&E.bg); E.markAllDirty();
  E.useLayer(&E.fg);
  return 1;
}

// Free the per-engine GL objects (the context + program persist for the canvas).
void GLPresenter::glDestroy() {
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

void GLPresenter::glResize(int devW, int devH) { glDevW = devW; glDevH = devH; }

void GLPresenter::glSetCamera(double camX_, double camY_, double cellDev, int viewCols, int viewRows,
                 int gutterOn, int snapOff) {
  glCamX = camX_; glCamY = camY_;
  glCellDev = cellDev > 0 ? cellDev : 1.0;
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
void GLPresenter::glSyncCamera() { glSetCamera(E.cam.camX, E.cam.camY, E.cam.cellDevPx, E.cam.viewportCols, E.cam.viewportRows, glGutterOn, glSnapOff); }

// Recreate the cell textures at the engine's current cols×rows after a loaded-window
// resize. The WebGL context stays on the canvas; only the per-engine textures change.
int GLPresenter::glRebuildCellTextures(int texCols, int texRows) {
  if (!glc || !glc->ready) return 1;
  emscripten_webgl_make_context_current(glc->handle);
  GLuint nextFg = 0, nextBg = 0;
  if (!glAllocateCellTexture(nextFg, texCols, texRows) ||
      !glAllocateCellTexture(nextBg, texCols, texRows)) {
    if (nextFg) glDeleteTextures(1, &nextFg);
    if (nextBg) glDeleteTextures(1, &nextBg);
    return 0;
  }
  if (glTex) glDeleteTextures(1, &glTex);
  if (glTexBg) glDeleteTextures(1, &glTexBg);
  if (glTex2) glDeleteTextures(1, &glTex2);
  glTex = nextFg; glTexBg = nextBg; glTex2 = 0;
  glLastCamCol = glLastCamRow = INT_MIN;
  glLastWorldOffX = glLastWorldOffY = INT_MIN;
  glLastSkyLight = -1;
  glLightTick = INT_MIN;
  glLastAnimFrame = UINT32_MAX; glVisibleAnimated = false;
  glAnimatedFg.clear(); glAnimatedBg.clear();
  glLightX0 = glLightY0 = glLightX1 = glLightY1 = -1;
  return 1;
}
// DEV A/B flags (flicker bench): toggle the gutter grid and offset snapping.
void GLPresenter::glSetFlags(int gutterOn, int snapOff, int animationPaused) {
  glGutterOn = gutterOn;
  glSnapOff = snapOff;
  glAnimationPaused = animationPaused != 0;
}
void GLPresenter::glSetDebugHitboxes(int on) { glDebugHitboxes = on != 0; }

void GLPresenter::glSetPlayers(int useExternal, const float* data, int count, int ownId) {
  glOwnPlayerId = ownId;
  glUseExtPlayers = useExternal != 0;
  if (glUseExtPlayers) glExtPlayers.assign(data, data + (size_t)count * GLP_STRIDE);
  else glExtPlayers.clear();
}
void GLPresenter::glSetSurvivalPreview(int on, int footprint, int erasing, int locked, int x, int y) {
  glSurvivalPreviewOn = on != 0;
  glSurvivalPreviewFootprint = E.clampSurvivalFootprintId(footprint);
  glSurvivalPreviewErasing = erasing != 0;
  glSurvivalPreviewLocked = locked != 0;
  glSurvivalPreviewX = x;
  glSurvivalPreviewY = y;
}
// Client E.itemsys.items override: when external, glDrawItems draws these instead of the
// engine's own (a client doesn't simulate the world, so it has no local E.itemsys.items).
void GLPresenter::glSetItems(int useExternal, const float* data, int count) {
  glUseExtItems = useExternal != 0;
  if (glUseExtItems) glExtItems.assign(data, data + (size_t)count * IS_STRIDE);
  else glExtItems.clear();
}
void GLPresenter::glSetCreatures(int useExternal, const float* data, int count) {
  glUseExtCreatures = useExternal != 0;
  if (glUseExtCreatures && data && count > 0) glExtCreatures.assign(data, data + (size_t)count * CSN_STRIDE);
  else glExtCreatures.clear();
}

// ---- texture uploads (active layer's renderPixels -> the given texture) ----
void GLPresenter::glUploadFull(GLuint tex) {
  glBindTexture(GL_TEXTURE_2D, tex);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
  glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
  glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
  glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, E.cols, E.rows, GL_RGBA, GL_UNSIGNED_BYTE, E.L->renderPixels.data());
}
void GLPresenter::glUploadRects(GLuint tex) {
  glBindTexture(GL_TEXTURE_2D, tex);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glPixelStorei(GL_UNPACK_ROW_LENGTH, E.cols);
  for (size_t i = 0; i + 3 < E.L->dirtyRects.size(); i += 4) {
    int x0 = E.L->dirtyRects[i], y0 = E.L->dirtyRects[i + 1], x1 = E.L->dirtyRects[i + 2], y1 = E.L->dirtyRects[i + 3];
    int w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    glPixelStorei(GL_UNPACK_SKIP_PIXELS, x0);
    glPixelStorei(GL_UNPACK_SKIP_ROWS, y0);
    glTexSubImage2D(GL_TEXTURE_2D, 0, x0, y0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, E.L->renderPixels.data());
  }
  glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
  glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
  glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
}

// The inclusive visible-cell rect the shader will sample this frame — IDENTICAL to
// glDrawCells's window (the +1 covers the sub-cell pan shift). The present path fills
// and uploads exactly this rect, so what is sampled is always freshly rendered.
void GLPresenter::glVisRect(int* x0, int* y0, int* x1, int* y1) {
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  *x0 = camCol < 0 ? 0 : camCol;
  *y0 = camRow < 0 ? 0 : camRow;
  *x1 = imin(E.cols - 1, camCol + glViewCols + 1);
  *y1 = imin(E.rows - 1, camRow + glViewRows + 1);
}
// Upload just the inclusive [x0,y0..x1,y1] window of the active layer's renderPixels
// into `tex` (same UNPACK skip/row-length trick as glUploadRects).
void GLPresenter::glUploadWindow(GLuint tex, int x0, int y0, int x1, int y1) {
  int w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w <= 0 || h <= 0) return;
  glBindTexture(GL_TEXTURE_2D, tex);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glPixelStorei(GL_UNPACK_ROW_LENGTH, E.cols);
  glPixelStorei(GL_UNPACK_SKIP_PIXELS, x0);
  glPixelStorei(GL_UNPACK_SKIP_ROWS, y0);
  glTexSubImage2D(GL_TEXTURE_2D, 0, x0, y0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, E.L->renderPixels.data());
  glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
  glPixelStorei(GL_UNPACK_SKIP_PIXELS, 0);
  glPixelStorei(GL_UNPACK_SKIP_ROWS, 0);
}

// Slide ONE cell texture by dx world-columns (glTex2 is the scratch target).
void GLPresenter::glShiftTex(GLuint& tex, int dx) {
  int s = dx > 0 ? dx : -dx;
  glBindFramebuffer(GL_READ_FRAMEBUFFER, glReadFBO);
  glFramebufferTexture2D(GL_READ_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, glDrawFBO);
  glFramebufferTexture2D(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, glTex2, 0);
  if (dx > 0) glBlitFramebuffer(dx, 0, E.cols, E.rows, 0, 0, E.cols - dx, E.rows, GL_COLOR_BUFFER_BIT, GL_NEAREST);
  else        glBlitFramebuffer(0, 0, E.cols - s, E.rows, s, 0, E.cols, E.rows, GL_COLOR_BUFFER_BIT, GL_NEAREST);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, 0);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
  std::swap(tex, glTex2);
}
// Slide BOTH layers' textures to mirror shiftWorld's grid memmove (the GPU
// analogue of the old shiftCellCanvas). The exposed band repaints from dirty
// chunks next frame. The world shifts both layers in lockstep (P5).
void GLPresenter::glShift(int dx) {
  if (!dx || !glReady()) return;
  emscripten_webgl_make_context_current(glc->handle);
  if (dx >= E.cols || -dx >= E.cols) {
    E.useLayer(&E.fg); E.renderer.renderFull(); glUploadFull(glTex);
    E.useLayer(&E.bg); E.renderer.renderFull(); glUploadFull(glTexBg);
    return;
  }
  // The browser mirror receives already-shifted authority snapshots, so this
  // full-size scratch texture is not needed during ordinary play. Allocate it
  // only for the direct stream path (tests/standalone engines); if a constrained
  // device cannot provide it, the next present sees the changed world offset
  // and safely refills the visible window instead.
  if (!glTex2 && !glAllocateCellTexture(glTex2, E.cols, E.rows)) {
    glLastWorldOffX = glLastWorldOffY = INT_MIN;
    return;
  }
  glShiftTex(glTex, dx);
  glShiftTex(glTexBg, dx);
}
// Vertical analogue of glShiftTex: slide the cell texture by dy E.rows. The grid is
// uploaded with row 0 at the top, but the GL framebuffer origin is bottom-left, so
// a grid shift of +dy (content moves toward row 0) is a blit toward larger Y here.
void GLPresenter::glShiftTexV(GLuint& tex, int dy) {
  int s = dy > 0 ? dy : -dy;
  glBindFramebuffer(GL_READ_FRAMEBUFFER, glReadFBO);
  glFramebufferTexture2D(GL_READ_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, glDrawFBO);
  glFramebufferTexture2D(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, glTex2, 0);
  if (dy > 0) glBlitFramebuffer(0, s, E.cols, E.rows, 0, 0, E.cols, E.rows - s, GL_COLOR_BUFFER_BIT, GL_NEAREST);
  else        glBlitFramebuffer(0, 0, E.cols, E.rows - s, 0, s, E.cols, E.rows, GL_COLOR_BUFFER_BIT, GL_NEAREST);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, 0);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
  std::swap(tex, glTex2);
}
void GLPresenter::glShiftV(int dy) {
  if (!dy || !glReady()) return;
  emscripten_webgl_make_context_current(glc->handle);
  if (dy >= E.rows || -dy >= E.rows) {
    E.useLayer(&E.fg); E.renderer.renderFull(); glUploadFull(glTex);
    E.useLayer(&E.bg); E.renderer.renderFull(); glUploadFull(glTexBg);
    return;
  }
  if (!glTex2 && !glAllocateCellTexture(glTex2, E.cols, E.rows)) {
    glLastWorldOffX = glLastWorldOffY = INT_MIN;
    return;
  }
  glShiftTexV(glTex, dy);
  glShiftTexV(glTexBg, dy);
}

// ---- drawing ----
void GLPresenter::glSetClip(double dx0, double dy0, double dx1, double dy1) {
  float cx0 = (float)(dx0 / glDevW * 2.0 - 1.0);
  float cy0 = (float)(1.0 - dy0 / glDevH * 2.0);  // top
  float cx1 = (float)(dx1 / glDevW * 2.0 - 1.0);
  float cy1 = (float)(1.0 - dy1 / glDevH * 2.0);  // bottom
  glUniform4f(glc->uClipRect, cx0, cy0, cx1, cy1);
}
void GLPresenter::glSolidDev(double dx0, double dy0, double w, double h) {
  glSetClip(dx0, dy0, dx0 + w, dy0 + h);
  glUniform4f(glc->uTexRect, 0, 0, 0, 0);
  glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
}

void GLPresenter::glDrawHitbox(double px, double py, int w, int h, float r, float g, float b, int camCol, int camRow) {
  if (!glDebugHitboxes) return;
  double x = (px - camCol) * glCellDev + glOffX;
  double y = (py - camRow) * glCellDev + glOffY;
  double ww = w * glCellDev, hh = h * glCellDev;
  double line = std::max(1.0, glCellDev * 0.22);
  glUniform4f(glc->uColor, r, g, b, 0.92f);
  glSolidDev(x, y, ww, line); glSolidDev(x, y + hh - line, ww, line);
  glSolidDev(x, y, line, hh); glSolidDev(x + ww - line, y, line, hh);
}

// Draw the visible window of one layer's texture at brightness `tint`. The
// The background is forced opaque; the foreground honors per-material schema
// transparency. EMPTY foreground texels and the 1px gutter cuts reveal the
// background normally.
// Both use the same snapped camera offset (flicker fix).
void GLPresenter::glDrawCells(GLuint tex, float tint, int gutter, int opaqueAlpha) {
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  int visX0 = camCol, visY0 = camRow;
  int visX1 = imin(E.cols - 1, camCol + glViewCols + 1);  // +1 covers the sub-cell shift
  int visY1 = imin(E.rows - 1, camRow + glViewRows + 1);
  int vw = visX1 - visX0 + 1, vh = visY1 - visY0 + 1;
  if (vw <= 0 || vh <= 0) return;
  double devW = (double)vw * glCellDev, devH = (double)vh * glCellDev;
  glUniform1i(glc->uMode, 0);
  glUniform1i(glc->uGutter, gutter);
  glUniform1f(glc->uTint, tint);
  glUniform1i(glc->uOpaqueAlpha, opaqueAlpha);
  glUniform1f(glc->uCellDev, (float)glCellDev);
  glUniform2f(glc->uQuadDev, (float)devW, (float)devH);
  glUniform4f(glc->uTexRect, (float)visX0 / E.cols, (float)visY0 / E.rows,
              (float)(visX0 + vw) / E.cols, (float)(visY0 + vh) / E.rows);
  glBindTexture(GL_TEXTURE_2D, tex);
  glSetClip(glOffX, glOffY, glOffX + devW, glOffY + devH);
  glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
}

// Blit the player's current animation frame as per-pixel rects (one sprite-pixel =
// one world cell). The sprite is anchored at AABB offset (-1,-2) cells so the feet
// plant on the surface and the body centers on the 4-wide hitbox; mirrored when
// facing left. A subtle own/other tint distinguishes the local player.
float GLPresenter::glActorLight(double px, double py, int w, int h) const {
  if (!Renderer::RENDER_LIGHTING_ENABLED || E.fg.light.empty()) return 1.0f;
  int x0 = imax(0, (int)std::floor(px)), x1 = imin(E.cols - 1, (int)std::floor(px + w - 1e-6));
  int y0 = imax(0, (int)std::floor(py)), y1 = imin(E.rows - 1, (int)std::floor(py + h - 1e-6));
  if (x1 < x0 || y1 < y0) return Renderer::LIGHT_AMBIENT / 255.0f;
  int sum = 0, count = 0;
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) { sum += E.fg.light[E.I(x, y)]; count++; }
  return count ? (float)sum / (255.0f * count) : Renderer::LIGHT_AMBIENT / 255.0f;
}

void GLPresenter::glDrawOnePlayer(double pxc, double pyc, int facing, int animState, int animFrame,
                     bool own, float light, int camCol, int camRow) {
  if (animState < 0 || animState >= AS_COUNT) animState = AS_IDLE;
  if (animFrame < 0 || animFrame >= ANIM_N[animState]) animFrame = 0;
  double cell = (double)glCellDev;
  double sprX = (pxc - camCol) * glCellDev + glOffX - cell;       // (-1) cell
  double sprY = (pyc - camRow) * glCellDev + glOffY - 2.0 * cell; // (-2) cells
  for (int r = 0; r < SPR_H; r++) {
    const char* row = SPR_GRID[animState][animFrame][r];
    for (int c = 0; c < SPR_W; c++) {
      int idx = row[c] - '0';
      if (idx <= 0 || idx > 7) continue;
      int cc = (facing >= 0) ? c : (SPR_W - 1 - c);
      const float* col = SPR_PAL[idx];
      float tr = col[0], tg = col[1], tb = col[2];
      if (own) tb = std::min(1.0f, tb * 1.10f); else tr = std::min(1.0f, tr * 1.06f);
      glUniform4f(glc->uColor, tr * light, tg * light, tb * light, col[3]);
      glSolidDev(sprX + cc * cell, sprY + r * cell, cell, cell);
    }
  }
}

void GLPresenter::glDrawPlayers() {
  glUniform1i(glc->uMode, 1);
  glUniform1i(glc->uGutter, 0);
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  if (glUseExtPlayers) {
    int n = (int)(glExtPlayers.size() / GLP_STRIDE);
    for (int i = 0; i < n; i++) {
      const float* p = &glExtPlayers[(size_t)i * GLP_STRIDE];
      float light = glActorLight(p[GLP_X], p[GLP_Y], (int)p[GLP_W], (int)p[GLP_H]);
      glDrawOnePlayer(p[GLP_X], p[GLP_Y], (int)p[GLP_FACING], (int)p[GLP_ANIM_STATE], (int)p[GLP_ANIM_FRAME], p[GLP_OWN] > 0.5f, light, camCol, camRow);
      glDrawHitbox(p[GLP_X], p[GLP_Y], (int)p[GLP_W], (int)p[GLP_H], 0.20f, 0.90f, 1.0f, camCol, camRow);
    }
  } else {
    for (auto& p : E.psys.players) {
      if (!p.active || !p.alive) continue;
      glDrawOnePlayer(p.px, p.py, p.facing, p.animState, p.animFrame, p.id == glOwnPlayerId, glActorLight(p.px, p.py, p.w, p.h), camCol, camRow);
      glDrawHitbox(p.px, p.py, p.w, p.h, 0.20f, 0.90f, 1.0f, camCol, camRow);
    }
  }
}

// Dropped E.itemsys.items + particles overlay, drawn after E.psys.players (same world->screen
// transform). Each is a small rect centered on its cell at the material's color;
// particles shrink/fade by remaining life. The engine draws from its own `E.itemsys.items`
// vector — no JS state push, exactly like host-side player drawing.
// Draw one dropped item/particle. Identical for engine-owned E.itemsys.items and the
// client's host-snapshot E.itemsys.items, so id-keyed bob/glimmer stay in sync.
void GLPresenter::glDrawOneItem(int id, int kind, int material, double px, double py, int life,
                   int camCol, int camRow) {
  uint32_t c = MAT_COLOR[material];
  float r = (c & 0xff) / 255.0f, g = ((c >> 8) & 0xff) / 255.0f, b = ((c >> 16) & 0xff) / 255.0f;
  float baseA = ((c >> 24) & 0xff) / 255.0f;
  float a = (kind == IT_PARTICLE) ? baseA * (float)life / (float)IT_PARTICLE_LIFE : baseA;
  if (a <= 0.01f) return;
  double bob = 0.0;
  if (kind == IT_ITEM) {
    // render-only surface bob (per-item phase so a pile doesn't bob in lockstep).
    bob = IT_BOB_AMP * std::sin(6.2831853 * (((E.tick + id * 11) % IT_BOB_PERIOD) / (double)IT_BOB_PERIOD));
    // render-only GLIMMER: a gentle brightness pulse + an occasional bright sparkle.
    float glim = 0.88f + 0.12f * (float)std::sin(6.2831853 * (((E.tick + id * 23) % 96) / 96.0));
    r *= glim; g *= glim; b *= glim;
    if (((E.tick / 2 + id * 5) % 70) < 4) { r = std::min(1.0f, r + 0.45f); g = std::min(1.0f, g + 0.45f); b = std::min(1.0f, b + 0.45f); }
  }
  glUniform4f(glc->uColor, r, g, b, a);
  double sz = (kind == IT_PARTICLE) ? glCellDev * 0.5 : glCellDev * 0.8;
  double szCells = (kind == IT_PARTICLE) ? 0.5 : 0.8;
  // py is the item's bottom contact point; draw the sprite sitting ON it (bottom at
  // py) so a resting item never sinks into the surface. x uses the float point.
  double cx = (px - camCol) * glCellDev + glOffX;
  double cy = (py - szCells * 0.5 + bob - camRow) * glCellDev + glOffY;
  glSolidDev(cx - sz * 0.5, cy - sz * 0.5, sz, sz);
}

void GLPresenter::glDrawItems() {
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  if (glUseExtItems) {
    int n = (int)(glExtItems.size() / IS_STRIDE);
    if (!n) return;
    glUniform1i(glc->uMode, 1);
    glUniform1i(glc->uGutter, 0);
    for (int i = 0; i < n; i++) {
      const float* it = &glExtItems[(size_t)i * IS_STRIDE];
      glDrawOneItem((int)it[IS_ID], (int)it[IS_KIND], (int)it[IS_MATERIAL], it[IS_X], it[IS_Y], (int)it[IS_LIFE], camCol, camRow);
    }
    return;
  }
  if (E.itemsys.items.empty()) return;
  glUniform1i(glc->uMode, 1);
  glUniform1i(glc->uGutter, 0);
  for (auto& it : E.itemsys.items) glDrawOneItem(it.id, it.kind, it.material, it.px, it.py, it.life, camCol, camRow);
}

// Original pixel sprites authored for this renderer. Each animal has a 13x7
// canvas, a six-color ramp, and four genuinely different poses. The extra
// negative space is intentional: ears, feet, tails, fins, and wing tips retain
// a readable silhouette instead of collapsing into a filled rectangle.
void GLPresenter::glDrawOneCreature(int speciesId, double px, double py, int facing, int health, int maxHealth,
                    int alive, int animFrame, float light, int camCol, int camRow) {
  static const float pal[CS_COUNT][6][4] = {
    {{0,0,0,0},{12/255.f,31/255.f,43/255.f,1},{37/255.f,111/255.f,137/255.f,1},{74/255.f,174/255.f,180/255.f,1},{157/255.f,226/255.f,201/255.f,1},{244/255.f,218/255.f,104/255.f,1}},
    {{0,0,0,0},{20/255.f,29/255.f,27/255.f,1},{46/255.f,91/255.f,58/255.f,1},{80/255.f,139/255.f,72/255.f,1},{151/255.f,188/255.f,92/255.f,1},{238/255.f,199/255.f,72/255.f,1}},
    {{0,0,0,0},{39/255.f,25/255.f,23/255.f,1},{123/255.f,52/255.f,32/255.f,1},{204/255.f,89/255.f,42/255.f,1},{244/255.f,154/255.f,70/255.f,1},{244/255.f,225/255.f,184/255.f,1}},
    {{0,0,0,0},{40/255.f,29/255.f,31/255.f,1},{131/255.f,94/255.f,72/255.f,1},{194/255.f,151/255.f,112/255.f,1},{237/255.f,207/255.f,166/255.f,1},{241/255.f,125/255.f,133/255.f,1}},
    {{0,0,0,0},{22/255.f,20/255.f,28/255.f,1},{61/255.f,43/255.f,76/255.f,1},{105/255.f,70/255.f,124/255.f,1},{159/255.f,110/255.f,169/255.f,1},{100/255.f,224/255.f,184/255.f,1}},
    {{0,0,0,0},{29/255.f,25/255.f,28/255.f,1},{75/255.f,59/255.f,58/255.f,1},{126/255.f,99/255.f,88/255.f,1},{186/255.f,153/255.f,126/255.f,1},{238/255.f,183/255.f,185/255.f,1}},
    {{0,0,0,0},{24/255.f,28/255.f,42/255.f,1},{54/255.f,99/255.f,160/255.f,1},{91/255.f,157/255.f,211/255.f,1},{174/255.f,218/255.f,239/255.f,1},{247/255.f,179/255.f,69/255.f,1}},
  };
  static const char* const grids[CS_COUNT][4][7] = {
    {// minnow: a forked tail and alternating body bend
     {"0000000000000","0000003000000","0100333332100","0112233444510","0100333332100","0000003000000","0000000000000"},
     {"0100000000000","0110033000000","0011333332100","0002233444510","0000333332100","0000003000000","0000000000000"},
     {"0000000000000","0000003000000","0000333332100","0112233444510","0100333332100","0100003000000","0000000000000"},
     {"0000000000000","0000003000000","0000333332100","0002233444510","0011333332100","0110033000000","0100000000000"}},
    {// pike: long-backed predator with swept fins and a bright eye
     {"0000033000000","0100333332210","0112233334441","0012333444551","0112233334441","0100333332210","0000033000000"},
     {"0100003300000","0110033332210","0012233334441","0002333444551","0012233334441","0000333332210","0000003300000"},
     {"0000003300000","0000333332210","0012233334441","0102333444551","0112233334441","0100033332210","0000003300000"},
     {"0000003300000","0000333332210","0012233334441","0002333444551","0012233334441","0110033332210","0100003300000"}},
    {// fox: pointed muzzle, ears, white throat, brush tail, four-beat trot
     {"0000000000400","0000000033440","1100002333450","1112223333351","0123333333500","0001200120000","0011000011000"},
     {"0000000000400","0000000033440","0110002333450","1112223333351","0123333333500","0000121200000","0001100110000"},
     {"0000000000400","0000000033440","0011002333450","0111223333351","1123333333500","0012000012000","0110000001100"},
     {"0000000000400","0000000033440","0110002333450","1112223333351","0123333333500","0000210210000","0000110011000"}},
    {// hare: tall ears and distinct crouch, launch, tuck, and landing poses
     {"0000000040400","0000000434300","0000000334500","0011123333310","0122333333100","0012000120000","0110000011000"},
     {"0000000040400","0000000434300","0000000334500","0001123333310","0012333333100","0112200001200","0000111110000"},
     {"0000000040400","0000000434300","0000000334500","0001123333310","0012333333100","0001122110000","0000000000000"},
     {"0000000040400","0000000434300","0000000334500","0001123333310","0012333333100","0001200122000","0011000001100"}},
    {// cave crawler: armored segments, feelers, and an eight-leg ripple
     {"0100000000010","0010000000100","0011222221100","0123454343210","0012233322100","0101010101010","1000100010001"},
     {"0010000000100","0001000001000","0011222221100","0123454343210","0012233322100","0010101010100","0100010001001"},
     {"0001000010000","0010000000100","0011222221100","0123454343210","0012233322100","1000100010001","0101010101010"},
     {"0010000000100","0100000000010","0011222221100","0123454343210","0012233322100","0100010001001","0010101010100"}},
    {// mole: velvet back, shovel paws, pink snout, and low digging gait
     {"0000001100000","0000112332100","0001233333451","0112333444551","1123333333210","0101200012100","1001100011000"},
     {"0000001100000","0000112332100","0011233333451","0112333444551","1123333333210","0010120120000","0110011000000"},
     {"0000001100000","0000112332100","0001233333451","0012333444551","1123333333210","0102100001200","1100000001100"},
     {"0000001100000","0000112332100","0011233333451","0112333444551","1123333333210","0001200210000","0011000011000"}},
    {// bird: tucked body with a full upstroke-to-downstroke wing cycle
     {"0100000000010","0120000000210","0012000002100","0001223451000","0000123210000","0000012100000","0000001000000"},
     {"0000000000000","0011000011000","0012100121000","0001233451000","0000123210000","0000012100000","0000001000000"},
     {"0000000000000","0000000000000","0000111110000","0001233451000","0012233321100","0122100122100","1100000000110"},
     {"0000000000000","0000000000000","0001233451000","0012233321100","0122100122100","0110000001100","0000000000000"}},
  };
  if (speciesId < 0 || speciesId >= CS_COUNT) return;
  const int sw = 13, sh = 7;
  double cell = glCellDev;
  double sx = (px - camCol) * cell + glOffX - (sw - CREATURE_SPECIES[speciesId].w) * 0.5 * cell;
  double sy = (py - camRow) * cell + glOffY - (sh - CREATURE_SPECIES[speciesId].h) * 0.5 * cell;
  int frame = animFrame & 3;
  // A little whole-sprite follow-through keeps the detailed limbs from feeling
  // like a flipbook pasted to the AABB. Walkers rise on their passing steps,
  // swimmers roll gently, and the downstroke gives the bird visible lift.
  if (alive) {
    if (speciesId == CS_BIRD) sy += (frame == 0 ? -0.35 : frame == 2 ? 0.20 : 0.0) * cell;
    else if (CREATURE_SPECIES[speciesId].locomotion == CL_AQUATIC) sy += (frame == 1 ? -0.12 : frame == 3 ? 0.12 : 0.0) * cell;
    else if (speciesId != CS_HARE && (frame & 1)) sy -= 0.10 * cell;
  }
  if (alive && CREATURE_SPECIES[speciesId].locomotion == CL_AMPHIBIOUS) {
    double shadowY = (py - camRow + CREATURE_SPECIES[speciesId].h) * cell + glOffY - 0.16 * cell;
    glUniform4f(glc->uColor, 8/255.f * light, 10/255.f * light, 14/255.f * light, 0.24f);
    glSolidDev(sx + 3.0 * cell, shadowY, 7.0 * cell, std::max(1.0, 0.30 * cell));
  }
  double pixelH = alive ? cell : cell * 0.42;
  double corpseBase = sy + sh * cell;
  for (int r = 0; r < sh; r++) for (int c = 0; c < sw; c++) {
    int idx = grids[speciesId][frame][r][c] - '0'; if (idx <= 0 || idx >= 6) continue;
    int cc = facing >= 0 ? c : sw - 1 - c; const float* col = pal[speciesId][idx];
    float fade = alive ? 1.0f : 0.55f;
    glUniform4f(glc->uColor, col[0] * fade * light, col[1] * fade * light, col[2] * fade * light, col[3]);
    double drawY = alive ? sy + r * cell : corpseBase - (sh - r) * pixelH;
    glSolidDev(sx + cc * cell, drawY, cell, pixelH);
  }
  // A compact health bar appears only after damage (or during death), keeping
  // ambient creatures visually quiet while still making health legible.
  if (maxHealth > 0 && health < maxHealth) {
    double bw = sw * 0.72 * cell, bh = std::max(1.0, cell * 0.45), bx = sx + (sw * cell - bw) * 0.5, by = sy - cell;
    glUniform4f(glc->uColor, 28/255.f, 19/255.f, 24/255.f, 0.90f); glSolidDev(bx, by, bw, bh);
    double frac = std::max(0.0, std::min(1.0, health / (double)maxHealth));
    glUniform4f(glc->uColor, 224/255.f, 70/255.f, 78/255.f, 0.95f); glSolidDev(bx, by, bw * frac, bh);
  }
  glDrawHitbox(px, py, CREATURE_SPECIES[speciesId].w, CREATURE_SPECIES[speciesId].h,
               1.0f, CREATURE_SPECIES[speciesId].hostile ? 0.24f : 0.88f, 0.20f, camCol, camRow);
}

void GLPresenter::glDrawCreatures() {
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  glUniform1i(glc->uMode, 1); glUniform1i(glc->uGutter, 0);
  if (glUseExtCreatures) {
    int n = (int)(glExtCreatures.size() / CSN_STRIDE);
    for (int i = 0; i < n; i++) { const float* c = &glExtCreatures[(size_t)i * CSN_STRIDE];
      glDrawOneCreature((int)c[CSN_SPECIES], c[CSN_X], c[CSN_Y], (int)c[CSN_FACING], (int)c[CSN_HEALTH],
                        (int)c[CSN_MAX_HEALTH], (int)c[CSN_ALIVE], (int)c[CSN_ANIM_FRAME],
                        glActorLight(c[CSN_X], c[CSN_Y], (int)c[CSN_W], (int)c[CSN_H]), camCol, camRow);
    }
  } else for (const Creature& c : E.creatures.creatures) {
    const CreatureSpecies& s = E.creatures.species(c);
    glDrawOneCreature(c.species, c.wx - E.fg.worldOffsetX, c.wy - E.fg.worldOffsetY, c.facing, c.health,
                      s.maxHealth, c.alive ? 1 : 0, c.animFrame,
                      glActorLight(c.wx - E.fg.worldOffsetX, c.wy - E.fg.worldOffsetY, s.w, s.h), camCol, camRow);
  }
}

void GLPresenter::glDrawPreview() {
  glUniform1i(glc->uMode, 1);
  glUniform1i(glc->uGutter, 0);
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  auto cell = [&](int x, int y) {
    glSolidDev((x - camCol) * glCellDev + glOffX, (y - camRow) * glCellDev + glOffY, glCellDev, glCellDev);
  };
  // Background drafts (RMB) read darker so they look like they're behind the world.
  float df = (E.tools.draftLayer == 1) ? GL_BG_TINT : 1.0f;
  // The single component E.tools.draft previews in its own material color (generalized from the
  // old stone/ice/driftwood-specific blocks — ANY component material now previews).
  if (!E.tools.draft.empty()) {
    uint32_t c = MAT_COLOR[E.tools.draftMaterial];
    float r = (c & 0xff) / 255.0f, g = ((c >> 8) & 0xff) / 255.0f, b = ((c >> 16) & 0xff) / 255.0f;
    glUniform4f(glc->uColor, df * r, df * g, df * b, 0.42f);
    for (int k : E.tools.draft) { int y = k / E.cols; cell(k - y * E.cols, y); }
  }
  if (E.tools.draftingSeed && E.tools.hasSeedOrigin) {
    bool valid = E.canPlaceSeedAt(E.tools.seedOriginX, E.tools.seedOriginY);
    if (valid) glUniform4f(glc->uColor, df * 120 / 255.0f, df * 190 / 255.0f, df * 100 / 255.0f, 0.32f);
    else       glUniform4f(glc->uColor, 255 / 255.0f, 80 / 255.0f, 80 / 255.0f, 0.24f);
    cell(E.tools.seedOriginX, E.tools.seedOriginY); // a seed is a single cell
  }

  // Survival: a "cursor" footprint at the local player's aim shows where the tool
  // will act and into which layer — LMB foreground (bright), RMB background (dim),
  // dig/erase red. Faded when out of reach. While a hold-mine is locked, the
  // overlay sticks to mineX/mineY (not the live aim) so it matches dig damage.
  if (E.cam.playModeOn && glOwnPlayerId) {
    Player* lp = nullptr;
    for (auto& pp : E.psys.players) if (pp.id == glOwnPlayerId && pp.active) { lp = &pp; break; }
    // External snapshots use the authority's player id, while the sole local
    // Player is a prediction body with its own replica id. It still owns the
    // live aim and is therefore the correct hover-preview anchor.
    if (!lp && glUseExtPlayers) for (auto& pp : E.psys.players) if (pp.active) { lp = &pp; break; }
    if (lp) {
      int ax = (int)std::floor(lp->aimX), ay = (int)std::floor(lp->aimY);
      bool toBg = (E.cam.pointerBtns & 2) != 0;
      bool erasing = (lp->selectedTool == T_ERASER);
      const SurvivalFootprint* fp = nullptr;
      if (glSurvivalPreviewOn) {
        erasing = glSurvivalPreviewErasing;
        fp = &E.getSurvivalFootprint(glSurvivalPreviewFootprint);
        if (glSurvivalPreviewLocked) { ax = glSurvivalPreviewX; ay = glSurvivalPreviewY; }
      } else if (E.survivalInventory) {
        const InvSlot& sel = lp->inv[lp->selectedSlot];
        erasing = sel.isTool || sel.count <= 0;
        fp = &E.getSurvivalFootprint(*lp);
        // Hold-lock: dig overlay tracks the locked origin, not the cursor.
        if (erasing && lp->mineActive && lp->mineFootprint >= 0) {
          ax = lp->mineX;
          ay = lp->mineY;
          // Dual-layer mine (RMB) stays on the locked footprint even if only LMB
          // is reported in pointerBtns this frame; mineLayer 2 = both.
          if (lp->mineLayer == 1) toBg = true;
        }
      }
      double cxp = lp->px + lp->w / 2.0, cyp = lp->py + lp->h / 2.0;
      double dxp = (ax + 0.5) - cxp, dyp = (ay + 0.5) - cyp;
      bool inReach = dxp * dxp + dyp * dyp <= P_TOOL_REACH * P_TOOL_REACH;
      float a = inReach ? 0.40f : 0.14f;
      if (erasing)   glUniform4f(glc->uColor, 255 / 255.0f, 90 / 255.0f, 80 / 255.0f, a);
      else if (toBg) glUniform4f(glc->uColor, 120 / 255.0f, 140 / 255.0f, 170 / 255.0f, a);
      else           glUniform4f(glc->uColor, 180 / 255.0f, 215 / 255.0f, 255 / 255.0f, a);
      if (fp) {
        for (const SurvivalFootprintCell& o : fp->cells) cell(ax + (int)o.ox, ay + (int)o.oy);
      } else {
        int r = erasing ? P_MINE_R : P_BUILD_R;
        for (int oy = -r; oy <= r; oy++) for (int ox = -r; ox <= r; ox++) { if (ox * ox + oy * oy > r * r) continue; cell(ax + ox, ay + oy); }
      }
    }
  }
}

// Render + upload ONLY the visible window into both layers' textures, then reset the
// render-dirty flags. Gated to run when the grid changed, the skylight changed, or the
// sampled window moved (whole-cell pan / world shift / forced refresh) — the last is
// essential because off-screen texels are never sampled, so a pan that scrolls a new
// cell into view must repaint that cell here. Lighting solves the visible window +
// margin (exact inside the window — see glpresenter.hpp); forced events (shift,
// day-night, init) still solve the full buffer, and a pure pan re-solves only when
// the window drifts outside the last solve's exact zone.
void GLPresenter::glPresentWindow(int forceFull) {
  E.useLayer(&E.fg); E.buildDirtyRects(); bool fgDirty = E.fg.dirtyRenderCount > 0;
  E.useLayer(&E.bg); E.buildDirtyRects(); bool bgDirty = E.bg.dirtyRenderCount > 0;
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  bool worldShifted = E.fg.worldOffsetX != glLastWorldOffX || E.fg.worldOffsetY != glLastWorldOffY;
  bool skyChanged = (int)E.renderer.renderSkyLight != glLastSkyLight;
  bool contentDirty = forceFull || fgDirty || bgDirty || skyChanged;
  bool windowMoved = forceFull || camCol != glLastCamCol || camRow != glLastCamRow || worldShifted;
  // Threaded Emscripten can expose an epoch-sized monotonic origin. Narrowing
  // now/frameMs directly to signed int freezes at INT_MIN, so reduce through a
  // safe 64-bit frame counter and keep only the wrapping low 32 bits.
  uint32_t wallAnimFrame = (uint32_t)(uint64_t)std::floor(emscripten_get_now() / GL_ANIM_FRAME_MS);
  uint32_t animFrame = glAnimationPaused && glLastAnimFrame != UINT32_MAX ? glLastAnimFrame : wallAnimFrame;
  bool animationDue = !glAnimationPaused && glVisibleAnimated && animFrame != glLastAnimFrame;
  if (!contentDirty && !windowMoved && !animationDue) return;
  int x0, y0, x1, y1; glVisRect(&x0, &y0, &x1, &y1);

  // Lighting policy: forced events (init/resize, world shift, day-night) solve
  // the FULL buffer (keeps the sky shift-remap caches coherent buffer-wide).
  // Content changes re-solve just the window+margin on the usual throttle. A
  // window that drifts outside the last solve's exact zone re-solves
  // immediately — those cells' light is stale or was only ring-approximate.
  if (Renderer::RENDER_LIGHTING_ENABLED) {
    bool lightForced = forceFull || worldShifted || skyChanged;
    bool lightThrottleReady = E.tick - glLightTick >= GL_LIGHT_THROTTLE_TICKS;
    int ex0 = glLightX0 <= 0 ? 0 : glLightX0 + GL_LIGHT_EXACT_SHRINK;
    int ey0 = glLightY0 <= 0 ? 0 : glLightY0 + GL_LIGHT_EXACT_SHRINK;
    int ex1 = glLightX1 >= E.cols - 1 ? E.cols - 1 : glLightX1 - GL_LIGHT_EXACT_SHRINK;
    int ey1 = glLightY1 >= E.rows - 1 ? E.rows - 1 : glLightY1 - GL_LIGHT_EXACT_SHRINK;
    bool windowExposed = glLightX0 < 0 ||
                         imax(0, x0 - 1) < ex0 || imax(0, y0 - 1) < ey0 ||
                         imin(E.cols - 1, x1 + 1) > ex1 || imin(E.rows - 1, y1 + 1) > ey1;
    if ((contentDirty && (lightForced || lightThrottleReady)) || windowExposed) {
      double t0 = emscripten_get_now();
      int lx0 = 0, ly0 = 0, lx1 = E.cols - 1, ly1 = E.rows - 1;
      if (!lightForced) {
        lx0 = imax(0, x0 - GL_LIGHT_WINDOW_MARGIN); ly0 = imax(0, y0 - GL_LIGHT_WINDOW_MARGIN);
        lx1 = imin(E.cols - 1, x1 + GL_LIGHT_WINDOW_MARGIN); ly1 = imin(E.rows - 1, y1 + GL_LIGHT_WINDOW_MARGIN);
      }
      E.renderer.computeLightingBoth(lx0, ly0, lx1, ly1);
      glLightX0 = lx0; glLightY0 = ly0; glLightX1 = lx1; glLightY1 = ly1;
      glLightTick = E.tick;
      E.perfLightMs = emscripten_get_now() - t0;
    }
  }
  E.renderer.renderFrameSalt = animFrame;
  int cx0 = x0 >> CHUNK_SHIFT, cy0 = y0 >> CHUNK_SHIFT;
  int cx1 = x1 >> CHUNK_SHIFT, cy1 = y1 >> CHUNK_SHIFT;
  int cw = cx1 - cx0 + 1, count = cw * (cy1 - cy0 + 1);
  auto fillLayer = [&](Layer& lay, std::vector<uint8_t>& animatedChunks, bool animatedOnly) {
    E.useLayer(&lay);
    size_t chunkTotal = (size_t)E.chunkCols * E.chunkRows;
    if (animatedChunks.size() != chunkTotal) animatedChunks.assign(chunkTotal, 0);
    std::atomic<bool> anyAnimated{false};
#ifdef __EMSCRIPTEN_PTHREADS__
    // Unlike simulation, render chunks only read grid/light state and write
    // disjoint pixel spans, so every visible chunk can run in one wave.
    E.chunkPool.parallelFor(count, [&](int i) {
      int cy = cy0 + i / cw, cx = cx0 + i % cw;
      int ci = cy * E.chunkCols + cx;
      if (animatedOnly && !animatedChunks[ci]) return;
      int tx0 = imax(x0, cx * CHUNK_SIZE), ty0 = imax(y0, cy * CHUNK_SIZE);
      int tx1 = imin(x1, (cx + 1) * CHUNK_SIZE - 1), ty1 = imin(y1, (cy + 1) * CHUNK_SIZE - 1);
      bool found = E.renderer.fillRenderSpan(lay.grid, (uint32_t*)lay.renderPixels.data(), tx0, ty0, tx1, ty1);
      if (!animatedOnly) animatedChunks[ci] = found ? 1 : 0;
      if (found) anyAnimated.store(true, std::memory_order_relaxed);
    });
#else
    for (int cy = cy0; cy <= cy1; cy++) for (int cx = cx0; cx <= cx1; cx++) {
      int ci = cy * E.chunkCols + cx;
      if (animatedOnly && !animatedChunks[ci]) continue;
      int tx0 = imax(x0, cx * CHUNK_SIZE), ty0 = imax(y0, cy * CHUNK_SIZE);
      int tx1 = imin(x1, (cx + 1) * CHUNK_SIZE - 1), ty1 = imin(y1, (cy + 1) * CHUNK_SIZE - 1);
      bool found = E.renderer.fillRenderSpan(lay.grid, (uint32_t*)lay.renderPixels.data(), tx0, ty0, tx1, ty1);
      if (!animatedOnly) animatedChunks[ci] = found ? 1 : 0;
      if (found) anyAnimated.store(true, std::memory_order_relaxed);
    }
#endif
    return anyAnimated.load(std::memory_order_relaxed);
  };
  auto uploadAnimated = [&](Layer& lay, GLuint tex, const std::vector<uint8_t>& animatedChunks) {
    E.useLayer(&lay);
    for (int cy = cy0; cy <= cy1; cy++) {
      int cx = cx0;
      while (cx <= cx1) {
        while (cx <= cx1 && !animatedChunks[cy * E.chunkCols + cx]) cx++;
        if (cx > cx1) break;
        int run0 = cx;
        while (cx + 1 <= cx1 && animatedChunks[cy * E.chunkCols + cx + 1]) cx++;
        int tx0 = imax(x0, run0 * CHUNK_SIZE), ty0 = imax(y0, cy * CHUNK_SIZE);
        int tx1 = imin(x1, (cx + 1) * CHUNK_SIZE - 1), ty1 = imin(y1, (cy + 1) * CHUNK_SIZE - 1);
        glUploadWindow(tex, tx0, ty0, tx1, ty1);
        cx++;
      }
    }
  };
  double tf = emscripten_get_now();
  bool fgAnimated = fillLayer(E.fg, glAnimatedFg, !contentDirty && !windowMoved);
  bool bgAnimated = fillLayer(E.bg, glAnimatedBg, !contentDirty && !windowMoved);
  E.perfFillMs = emscripten_get_now() - tf;
  double tu = emscripten_get_now();
  if (contentDirty || windowMoved) {
    E.useLayer(&E.fg); glUploadWindow(glTex, x0, y0, x1, y1);
    E.useLayer(&E.bg); glUploadWindow(glTexBg, x0, y0, x1, y1);
    glVisibleAnimated = fgAnimated || bgAnimated;
  } else {
    uploadAnimated(E.fg, glTex, glAnimatedFg);
    uploadAnimated(E.bg, glTexBg, glAnimatedBg);
  }
  E.perfUploadMs = emscripten_get_now() - tu;

  E.useLayer(&E.fg); memset(E.L->dirtyRender.data(), 0, (size_t)E.chunkCols * E.chunkRows); E.fg.dirtyRenderCount = 0;
  E.useLayer(&E.bg); memset(E.L->dirtyRender.data(), 0, (size_t)E.chunkCols * E.chunkRows); E.bg.dirtyRenderCount = 0;
  glLastCamCol = camCol; glLastCamRow = camRow;
  glLastWorldOffX = E.fg.worldOffsetX; glLastWorldOffY = E.fg.worldOffsetY;
  glLastSkyLight = (int)E.renderer.renderSkyLight;
  glLastAnimFrame = animFrame;
}

// One presented frame: window-upload both layers, then composite background (darker)
// then foreground, then E.psys.players + preview. forceFull forces a full-window refresh
// (init/resize). Returns 1 if drawn.
int GLPresenter::glRenderFrame(int forceFull) {
  if (!glReady()) return 0;
  emscripten_webgl_make_context_current(glc->handle);
  glSyncCamera();
  glPresentWindow(forceFull);
  E.useLayer(&E.fg); // preview/seed checks read the foreground grid
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
  glDrawCells(glTexBg, GL_BG_TINT, 0, 1);                  // background first (darker, opaque cells)
  // Hide the 1px gutter when cells are tiny — a solid grid would wash out the scene.
  int gutter = (glGutterOn && glCellDev >= 3.0) ? 1 : 0;
  glDrawCells(glTex, 1.0f, gutter, 0);                     // schema transparency; empty/gutter reveal bg
  glDrawCreatures();
  glDrawPlayers();
  glDrawItems();
  glDrawPreview();
  return 1;
}

void GLPresenter::glGetOffset(int* out) { glSyncCamera(); out[0] = (int)std::lround(glOffX); out[1] = (int)std::lround(glOffY); }

// Read back a top-down RGBA region of the canvas (bench flicker probe). glReadPixels
// is bottom-up, so flip E.rows into `out`.
int GLPresenter::glReadback(int x, int y, int w, int h, uint8_t* out) {
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
