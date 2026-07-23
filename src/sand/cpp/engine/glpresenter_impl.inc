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
  glTarget = target ? target : "";
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
  // A presentation mirror starts empty and receives its real cells from the
  // authority worker. WebGL zero-initializes new textures, so lighting and
  // uploading both empty layers here only blocks page startup; the first
  // authoritative present fills the visible window below.
  if (E.storageRole != ESR_PRESENTATION) {
    E.useLayer(&E.fg); E.renderer.renderFull(); glUploadFull(glTex);
    E.useLayer(&E.bg); E.renderer.renderFull(); glUploadFull(glTexBg);
  } else {
    glCheapFirstPresent = true;
  }
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
  glLastVisX0 = glLastVisY0 = glLastVisX1 = glLastVisY1 = -1;
  glLastSkyLight = glLightTick = INT_MIN;
  glLastAnimFrame = UINT32_MAX; glVisibleAnimated = false;
  glAnimatedFg.clear(); glAnimatedBg.clear();
  glLightX0 = glLightY0 = glLightX1 = glLightY1 = -1;
  glCheapFirstPresent = false;
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

// Release both the per-engine objects and the context-global objects. This is
// reserved for final canvas teardown; Engine replacement calls glDestroy() via
// the destructor so the next Engine can acquire the same canvas context.
void GLPresenter::glReleaseContext() {
  glDestroy();
  if (!glTarget.empty()) sandgl::release(glTarget.c_str());
  glTarget.clear();
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
// Copy the engine's live camera and viewport into the GL present state.
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
  glLastVisX0 = glLastVisY0 = glLastVisX1 = glLastVisY1 = -1;
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
void GLPresenter::glSetProjectiles(int useExternal, const float* data, int count) {
  glUseExtProjectiles = useExternal != 0;
  if (glUseExtProjectiles && data && count > 0) glExtProjectiles.assign(data, data + (size_t)count * PRS_STRIDE);
  else glExtProjectiles.clear();
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
// Slide both layer textures with shiftWorld's grid memmove. The exposed band
// repaints from dirty chunks next frame.
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
  // Most bore-ray samples can lie in the loaded buffer but outside the visible
  // camera. Preserve partially visible quads for GPU clipping, but skip fully
  // offscreen draw calls (also benefits sprites and particles generally).
  if (w <= 0 || h <= 0 || dx0 + w <= 0 || dy0 + h <= 0 || dx0 >= glDevW || dy0 >= glDevH) return;
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
                     bool alive, int heldItemKind, double bowCharge, bool own, float light, int camCol, int camRow) {
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
      double drawY = alive ? sprY + r * cell : sprY + (SPR_H - 2) * cell + (r / 4) * cell * .45;
      glSolidDev(sprX + cc * cell, drawY, cell, alive ? cell : cell * .45);
    }
  }
  if (alive && heldItemKind == IK_BOW) {
    double bx = sprX + (facing > 0 ? SPR_W + .3 : -1.3) * cell, by = sprY + 3.2 * cell;
    glUniform4f(glc->uColor, .55f * light, .31f * light, .14f * light, 1);
    glSolidDev(bx, by, cell * .45, cell * 4.4);
    glUniform4f(glc->uColor, .88f * light, .86f * light, .72f * light, 1);
    double pull = std::max(0.0, std::min(1.0, bowCharge)) * cell;
    glSolidDev(bx + (facing > 0 ? -pull : pull), by + cell * 2.0, cell * .25, cell * .25);
  }
  if (alive && heldItemKind == IK_BLAST_GUN) {
    double gx = sprX + (facing > 0 ? SPR_W - .1 : -2.8) * cell, gy = sprY + 3.45 * cell;
    glUniform4f(glc->uColor, .16f * light, .18f * light, .20f * light, 1);
    glSolidDev(gx, gy, cell * 2.9, cell * .82);
    glUniform4f(glc->uColor, .78f * light, .43f * light, .12f * light, 1);
    glSolidDev(gx + (facing > 0 ? 2.35 : 0) * cell, gy + cell * .12, cell * .72, cell * .56);
    glUniform4f(glc->uColor, .28f * light, .24f * light, .20f * light, 1);
    glSolidDev(gx + (facing > 0 ? .55 : 1.75) * cell, gy + cell * .72, cell * .58, cell * 1.15);
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
      glDrawOnePlayer(p[GLP_X], p[GLP_Y], (int)p[GLP_FACING], (int)p[GLP_ANIM_STATE], (int)p[GLP_ANIM_FRAME],
                      p[GLP_ALIVE] > .5f, (int)p[GLP_HELD_ITEM_KIND], p[GLP_BOW_CHARGE], p[GLP_OWN] > 0.5f, light, camCol, camRow);
      glDrawHitbox(p[GLP_X], p[GLP_Y], (int)p[GLP_W], (int)p[GLP_H], 0.20f, 0.90f, 1.0f, camCol, camRow);
    }
  } else {
    for (auto& p : E.psys.players) {
      if (!p.active) continue;
      const InvSlot& held = p.inv[p.selectedSlot];
      glDrawOnePlayer(p.px, p.py, p.facing, p.animState, p.animFrame, p.alive, held.count > 0 ? held.itemKind : IK_MATERIAL,
                      p.bowChargeTicks / (double)BOW_CHARGE_MAX, p.id == glOwnPlayerId, glActorLight(p.px, p.py, p.w, p.h), camCol, camRow);
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
void GLPresenter::glDrawOneItem(int id, int kind, int itemKind, int material, int tier, double px, double py, int life,
                   int camCol, int camRow) {
  uint32_t c = itemKind == IK_MATERIAL ? MAT_COLOR[material]
             : itemKind == IK_ARROW ? 0xffd6c49au
             : itemKind == IK_BOW ? 0xff4b6b9bu
             : itemKind == IK_BLAST_GUN ? 0xff3f76c4u
             : (tier == TT_GOLD ? 0xff34c7f2u : tier == TT_IRON ? 0xffe4e0d8u : tier == TT_STONE ? 0xff8f969eu : 0xff447ab0u);
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
  if (kind == IT_ITEM && itemKind == IK_ARROW) {
    glSolidDev(cx - sz * .62, cy - sz * .12, sz * 1.05, sz * .24);
    glSolidDev(cx + sz * .24, cy - sz * .30, sz * .38, sz * .60);
    return;
  }
  if (kind == IT_ITEM && itemKind == IK_BOW) {
    glSolidDev(cx - sz * .42, cy - sz * .45, sz * .22, sz * .90);
    glSolidDev(cx - sz * .20, cy - sz * .42, sz * .38, sz * .18);
    glSolidDev(cx - sz * .20, cy + sz * .24, sz * .38, sz * .18);
    return;
  }
  if (kind == IT_ITEM && itemKind == IK_BLAST_GUN) {
    glUniform4f(glc->uColor, .18f, .20f, .23f, a);
    glSolidDev(cx - sz * .62, cy - sz * .30, sz * 1.20, sz * .45);
    glUniform4f(glc->uColor, .82f, .44f, .12f, a);
    glSolidDev(cx + sz * .34, cy - sz * .24, sz * .45, sz * .33);
    glUniform4f(glc->uColor, .31f, .25f, .19f, a);
    glSolidDev(cx - sz * .18, cy + sz * .05, sz * .32, sz * .62);
    return;
  }
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
      glDrawOneItem((int)it[IS_ID], (int)it[IS_KIND], (int)it[IS_ITEM_KIND], (int)it[IS_MATERIAL], (int)it[IS_TOOL_TIER], it[IS_X], it[IS_Y], (int)it[IS_LIFE], camCol, camRow);
    }
    return;
  }
  if (E.itemsys.items.empty()) return;
  glUniform1i(glc->uMode, 1);
  glUniform1i(glc->uGutter, 0);
  for (auto& it : E.itemsys.items) glDrawOneItem(it.id, it.kind, it.itemKind, it.material, it.toolTier, it.px, it.py, it.life, camCol, camRow);
}

void GLPresenter::glDrawProjectiles() {
  const std::vector<float>* external = glUseExtProjectiles ? &glExtProjectiles : nullptr;
  int n = external ? (int)(external->size() / PRS_STRIDE) : (int)E.projectiles.projectiles.size();
  if (!n) return;
  glUniform1i(glc->uMode, 1); glUniform1i(glc->uGutter, 0);
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  for (int i = 0; i < n; i++) {
    double x, y, vx, vy, fuse, rotation; int kind;
    if (external) { const float* p = external->data() + i * PRS_STRIDE; x=p[PRS_X]; y=p[PRS_Y]; vx=p[PRS_VX]; vy=p[PRS_VY]; kind=(int)p[PRS_KIND]; fuse=p[PRS_FUSE]; rotation=p[PRS_ROTATION]; }
    else { const Projectile& p=E.projectiles.projectiles[i]; x=p.px; y=p.py; vx=p.vx; vy=p.vy; kind=p.kind; fuse=p.fuse; rotation=p.rotation; }
    double cx=(x-camCol)*glCellDev+glOffX, cy=(y-camRow)*glCellDev+glOffY;
    if (kind == PK_BLAST_ROUND) {
      double speed = std::max(.001, std::hypot(vx, vy)), nx = vx / speed, ny = vy / speed;
      for (int s = 1; s <= 8; s++) {
        float fade = (9 - s) / 9.0f;
        glUniform4f(glc->uColor, 1.0f, .28f + .35f * fade, .04f, .32f + .55f * fade);
        double px = cx - nx * s * glCellDev * .48, py = cy - ny * s * glCellDev * .48;
        double size = glCellDev * (.16 + fade * .18);
        glSolidDev(px - size * .5, py - size * .5, size, size);
      }
      glUniform4f(glc->uColor, 1.0f, .88f, .32f, 1);
      glSolidDev(cx - glCellDev * .34, cy - glCellDev * .34, glCellDev * .68, glCellDev * .68);
      glUniform4f(glc->uColor, 1.0f, 1.0f, .82f, 1);
      glSolidDev(cx - glCellDev * .16, cy - glCellDev * .16, glCellDev * .32, glCellDev * .32);
      continue;
    }
    if (kind == PK_DYNAMITE) {
      double ax = std::cos(rotation), ay = std::sin(rotation), pxn = -ay, pyn = ax;
      for (int stick = -1; stick <= 1; stick++) for (int seg = -1; seg <= 1; seg++) {
        double px = cx + ax * seg * glCellDev * .32 + pxn * stick * glCellDev * .28;
        double py = cy + ay * seg * glCellDev * .32 + pyn * stick * glCellDev * .28;
        glUniform4f(glc->uColor, stick == 0 ? .82f : .62f, .08f, .055f, 1);
        glSolidDev(px - glCellDev * .23, py - glCellDev * .23, glCellDev * .46, glCellDev * .46);
      }
      glUniform4f(glc->uColor, .16f, .12f, .10f, 1);
      glSolidDev(cx - glCellDev * .48, cy - glCellDev * .10, glCellDev * .96, glCellDev * .20);
      double fx = cx + ax * glCellDev * 1.15, fy = cy + ay * glCellDev * 1.15;
      glUniform4f(glc->uColor, ((int)fuse / 3) & 1 ? 1.0f : .92f, ((int)fuse / 3) & 1 ? .82f : .28f, .04f, 1);
      glSolidDev(fx - glCellDev * .25, fy - glCellDev * .25, glCellDev * .50, glCellDev * .50);
      continue;
    }
    double speed = std::max(.001, std::hypot(vx, vy)), nx = vx / speed, ny = vy / speed;
    glUniform4f(glc->uColor, .62f, .39f, .19f, 1);
    for (int s = 1; s <= 5; s++) {
      double px = cx - nx * s * glCellDev * .42, py = cy - ny * s * glCellDev * .42;
      glSolidDev(px - glCellDev * .15, py - glCellDev * .15, glCellDev * .30, glCellDev * .30);
    }
    glUniform4f(glc->uColor, .88f, .87f, .80f, 1);
    glSolidDev(cx - glCellDev * .28, cy - glCellDev * .28, glCellDev * .56, glCellDev * .56);
  }
}

// Original pixel sprites authored for this renderer. Each animal has a 13x7
// canvas, a six-color ramp, and four genuinely different poses. The extra
// negative space is intentional: ears, feet, tails, fins, and wing tips retain
// a readable silhouette instead of collapsing into a filled rectangle.
void GLPresenter::glDrawOneCreature(int speciesId, double px, double py, int facing, int health, int maxHealth,
                    int alive, int animFrame, int attackState, double attackProgress,
                    double aimX, double aimY, float light, int camCol, int camRow) {
  static const float pal[CS_COUNT][6][4] = {
    {{0,0,0,0},{12/255.f,31/255.f,43/255.f,1},{37/255.f,111/255.f,137/255.f,1},{74/255.f,174/255.f,180/255.f,1},{157/255.f,226/255.f,201/255.f,1},{244/255.f,218/255.f,104/255.f,1}},
    {{0,0,0,0},{20/255.f,29/255.f,27/255.f,1},{46/255.f,91/255.f,58/255.f,1},{80/255.f,139/255.f,72/255.f,1},{151/255.f,188/255.f,92/255.f,1},{238/255.f,199/255.f,72/255.f,1}},
    {{0,0,0,0},{39/255.f,25/255.f,23/255.f,1},{123/255.f,52/255.f,32/255.f,1},{204/255.f,89/255.f,42/255.f,1},{244/255.f,154/255.f,70/255.f,1},{244/255.f,225/255.f,184/255.f,1}},
    {{0,0,0,0},{40/255.f,29/255.f,31/255.f,1},{131/255.f,94/255.f,72/255.f,1},{194/255.f,151/255.f,112/255.f,1},{237/255.f,207/255.f,166/255.f,1},{241/255.f,125/255.f,133/255.f,1}},
    {{0,0,0,0},{22/255.f,20/255.f,28/255.f,1},{61/255.f,43/255.f,76/255.f,1},{105/255.f,70/255.f,124/255.f,1},{159/255.f,110/255.f,169/255.f,1},{100/255.f,224/255.f,184/255.f,1}},
    {{0,0,0,0},{29/255.f,25/255.f,28/255.f,1},{75/255.f,59/255.f,58/255.f,1},{126/255.f,99/255.f,88/255.f,1},{186/255.f,153/255.f,126/255.f,1},{238/255.f,183/255.f,185/255.f,1}},
    {{0,0,0,0},{24/255.f,28/255.f,42/255.f,1},{54/255.f,99/255.f,160/255.f,1},{91/255.f,157/255.f,211/255.f,1},{174/255.f,218/255.f,239/255.f,1},{247/255.f,179/255.f,69/255.f,1}},
    {{0,0,0,0},{28/255.f,24/255.f,22/255.f,1},{76/255.f,54/255.f,43/255.f,1},{139/255.f,91/255.f,51/255.f,1},{240/255.f,174/255.f,61/255.f,1},{194/255.f,47/255.f,39/255.f,1}},
    {{0,0,0,0},{17/255.f,23/255.f,29/255.f,1},{48/255.f,62/255.f,72/255.f,1},{80/255.f,108/255.f,116/255.f,1},{57/255.f,211/255.f,201/255.f,1},{228/255.f,255/255.f,222/255.f,1}},
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
     {"0000000003030","0000000034340","5500023333451","4555223333351","0343333333500","0001200120000","0011000011000"},
     {"0000000003030","0000000034340","0550023333451","4555223333351","0343333333500","0000121200000","0001100110000"},
     {"0000000003030","0000000034340","0000023333451","0555223333351","4433333333500","0012000012000","0110000001100"},
     {"0000000003030","0000000034340","0550023333451","4555223333351","0343333333500","0000210210000","0000110011000"}},
    {// hare: tall ears and distinct crouch, launch, tuck, and landing poses
     {"0000000400400","0000000450450","0000000450450","0042333334510","0442333333451","0002233332100","0011100011100"},
     {"0000004004000","0000004504500","0000004504500","0042333334510","0442333333451","0022333322100","1111000001100"},
     {"0000040040000","0000450450000","0000450450000","0004233334510","0042333333451","0001222111000","0000000000000"},
     {"0000000400400","0000000450450","0000000450450","0042333334510","0442333333451","0002233301200","0001100001100"}},
    {// cave crawler: armored segments, feelers, and an eight-leg ripple
     {"0100000000010","0010000000100","0011222221100","0123454343210","0012233322100","0101010101010","1000100010001"},
     {"0010000000100","0001000001000","0011222221100","0123454343210","0012233322100","0010101010100","0100010001001"},
     {"0001000010000","0010000000100","0011222221100","0123454343210","0012233322100","1000100010001","0101010101010"},
     {"0010000000100","0100000000010","0011222221100","0123454343210","0012233322100","0100010001001","0010101010100"}},
    {// mole: velvet back, shovel paws, pink snout, and low digging gait
     {"0000012221000","0001233333210","0012333333451","5123333444551","0122333333210","0005500055500","0001100001100"},
     {"0000012221000","0001233333210","0012333333451","0512333444551","0122333333210","0055000550000","0011001100000"},
     {"0000012221000","0001233333210","0012333333451","0051233444551","0122333333210","0550000055000","1100000001100"},
     {"0000012221000","0001233333210","0012333333451","0512333444551","0122333333210","0005500550000","0011000011000"}},
    {// bird: tucked body with a full upstroke-to-downstroke wing cycle
     {"0100000000010","0120000000210","0012000002100","0001223451000","0000123210000","0000012100000","0000001000000"},
     {"0000000000000","0011000011000","0012100121000","0001233451000","0000123210000","0000012100000","0000001000000"},
     {"0000000000000","0000000000000","0000111110000","0001233451000","0012233321100","0122100122100","1100000000110"},
     {"0000000000000","0000000000000","0001233451000","0012233321100","0122100122100","0110000001100","0000000000000"}},
    {// dynamiteer: soot mask, heavy coat, and a visibly raised red bundle
     {"0000011100000","0000123210000","0001233321000","0051233321550","0055222255000","0001122110000","0011000011000"},
     {"0000011100000","0000123210000","0001233321000","0051233321550","0055222255000","0000112200000","0001100110000"},
     {"0000555500000","0000544500000","0000011100000","0000123210000","0001233321000","0001122110000","0011000011000"},
     {"0000000005550","0000011054450","0000123211100","0001233321000","0001122210000","0011000110000","0110000011000"}},
    {// bore sentinel: plated walker whose cyan barrel blooms during charge/fire
     {"0000222200000","0002333320000","0012333444111","0012223332111","0001222222100","0011000011000","0110000001100"},
     {"0000222200000","0002333320000","0012333444111","0012223332111","0001222222100","0000110110000","0011000001100"},
     {"0000222200000","0002333320000","0012334555111","0012223444111","0001222222100","0000110110000","0011000001100"},
     {"0000222200005","0002333320055","0012334555555","0012223444055","0001222222005","0011000011000","0110000001100"}},
  };
  if (speciesId < 0 || speciesId >= CS_COUNT) return;
  const int sw = 13, sh = 7;
  double cell = glCellDev;
  if (alive && speciesId == CS_BORE_SENTINEL &&
      (attackState == CAS_CHARGING || attackState == CAS_FIRING)) {
    double ox = px + CREATURE_SPECIES[speciesId].w * 0.5;
    double oy = py + CREATURE_SPECIES[speciesId].h * 0.42;
    double dx = aimX - ox, dy = aimY - oy, d = std::hypot(dx, dy);
    if (d < 1e-6) { dx = facing; dy = 0; d = 1; }
    dx /= d; dy /= d;
    ox += dx * (CREATURE_SPECIES[speciesId].w * 0.5 + 0.75);
    oy += dy * (CREATURE_SPECIES[speciesId].h * 0.35 + 0.75);
    double length = 1e9;
    if (dx > 1e-9) length = std::min(length, (E.cols - 2.0 - ox) / dx);
    else if (dx < -1e-9) length = std::min(length, (1.0 - ox) / dx);
    if (dy > 1e-9) length = std::min(length, (E.rows - 2.0 - oy) / dy);
    else if (dy < -1e-9) length = std::min(length, (1.0 - oy) / dy);
    if (std::isfinite(length) && length > 0) {
      double progress = std::max(0.0, std::min(1.0, attackProgress));
      double spacing = attackState == CAS_FIRING ? 1.35 : 2.6 - progress * 1.25;
      int samples = imax(1, (int)std::ceil(length / spacing));
      for (int i = 0; i <= samples; i++) {
        double t = length * i / samples;
        double bx = (ox + dx * t - camCol) * cell + glOffX;
        double by = (oy + dy * t - camRow) * cell + glOffY;
        if (attackState == CAS_FIRING) {
          double outer = cell * (CREATURE_BORE_RADIUS * 2.0 + .35);
          glUniform4f(glc->uColor, .95f, .18f, .055f, .40f);
          glSolidDev(bx - outer * .5, by - outer * .5, outer, outer);
          glUniform4f(glc->uColor, 1.0f, .88f, .34f, .96f);
          glSolidDev(bx - cell * .68, by - cell * .68, cell * 1.36, cell * 1.36);
        } else {
          double width = cell * (.18 + progress * .38);
          glUniform4f(glc->uColor, 1.0f, .34f + .48f * progress, .10f, .18f + .58f * progress);
          glSolidDev(bx - width * .5, by - width * .5, width, width);
        }
      }
    }
  }
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
  // A segmented, hard-edged health bar appears only after damage (or during
  // death), matching the survival HUD without adding noise to ambient mobs.
  if (maxHealth > 0 && health < maxHealth) {
    double frac = std::max(0.0, std::min(1.0, health / (double)maxHealth));
    const int segments = 10;
    double border = std::max(1.0, cell * 0.22);
    double bw = sw * 0.78 * cell, bh = std::max(4.0, cell * 1.15);
    double bx = sx + (sw * cell - bw) * 0.5, by = sy - bh - cell * 0.45;
    glUniform4f(glc->uColor, 9/255.f, 11/255.f, 14/255.f, 0.96f);
    glSolidDev(bx, by, bw, bh);
    double innerX = bx + border, innerY = by + border;
    double innerW = std::max(1.0, bw - border * 2.0), innerH = std::max(1.0, bh - border * 2.0);
    double gap = std::min(std::max(0.25, cell * 0.14), innerW / (segments * 2.0));
    double segW = (innerW - gap * (segments - 1)) / segments;
    for (int i = 0; i < segments; i++) {
      double amount = std::max(0.0, std::min(1.0, frac * segments - i));
      double x = innerX + i * (segW + gap);
      glUniform4f(glc->uColor, 60/255.f, 37/255.f, 39/255.f, 0.96f);
      glSolidDev(x, innerY, segW, innerH);
      if (amount <= 0.0) continue;
      glUniform4f(glc->uColor, 217/255.f, 72/255.f, 72/255.f, 1.0f);
      glSolidDev(x, innerY, segW * amount, innerH);
      glUniform4f(glc->uColor, 240/255.f, 120/255.f, 104/255.f, 1.0f);
      glSolidDev(x, innerY, segW * amount, std::max(1.0, innerH * 0.28));
    }
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
                        (int)c[CSN_ATTACK_STATE], c[CSN_ATTACK_PROGRESS], c[CSN_AIM_X], c[CSN_AIM_Y],
                        glActorLight(c[CSN_X], c[CSN_Y], (int)c[CSN_W], (int)c[CSN_H]), camCol, camRow);
    }
  } else for (const Creature& c : E.creatures.creatures) {
    const CreatureSpecies& s = E.creatures.species(c);
    glDrawOneCreature(c.species, c.wx - E.fg.worldOffsetX, c.wy - E.fg.worldOffsetY, c.facing, c.health,
                      s.maxHealth, c.alive ? 1 : 0, c.animFrame, c.attackState, c.attackProgress,
                      c.attackAimX - E.fg.worldOffsetX, c.attackAimY - E.fg.worldOffsetY,
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
// sampled window moved (whole-cell pan / world shift / forced refresh). A pure pan
// preserves the already-valid overlap and repaints only newly exposed edge bands.
// Lighting solves the visible window +
// margin (exact inside the window — see glpresenter.hpp); forced events after
// startup (shift/day-night/texture rebuild) still solve the full buffer, and a
// pure pan re-solves only when the window drifts outside the last solve's exact zone.
void GLPresenter::glPresentWindow(int forceFull) {
  E.perfLightMs = E.perfFillMs = E.perfUploadMs = 0;
  E.useLayer(&E.fg); E.buildDirtyRects(); bool fgDirty = E.fg.dirtyRenderCount > 0;
  E.useLayer(&E.bg); E.buildDirtyRects(); bool bgDirty = E.bg.dirtyRenderCount > 0;
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  bool worldShifted = E.fg.worldOffsetX != glLastWorldOffX || E.fg.worldOffsetY != glLastWorldOffY;
  bool skyChanged = (int)E.renderer.renderSkyLight != glLastSkyLight;
  bool contentDirty = forceFull || fgDirty || bgDirty || skyChanged;
  bool windowMoved = forceFull || camCol != glLastCamCol || camRow != glLastCamRow || worldShifted;
  // Reduce the monotonic clock through a safe 64-bit frame counter and keep only
  // the wrapping low 32 bits.
  uint32_t wallAnimFrame = (uint32_t)(uint64_t)std::floor(emscripten_get_now() / GL_ANIM_FRAME_MS);
  uint32_t animFrame = glAnimationPaused && glLastAnimFrame != UINT32_MAX ? glLastAnimFrame : wallAnimFrame;
  bool animationDue = !glAnimationPaused && glVisibleAnimated && animFrame != glLastAnimFrame;
  if (!contentDirty && !windowMoved && !animationDue) return;
  int x0, y0, x1, y1; glVisRect(&x0, &y0, &x1, &y1);
  bool previousWindowValid = !forceFull && !worldShifted && glLastVisX0 >= 0;

  // Lighting policy: resize, world shift, and day-night changes solve the FULL
  // buffer (keeps the sky shift-remap caches coherent buffer-wide). The very
  // first authoritative frame has no cache to preserve, so solve only its
  // window+margin; newly exposed cells are solved on demand as the view moves.
  // Ordinary content changes use the same regional path on the usual throttle.
  bool lightUpdated = false;
  if (Renderer::RENDER_LIGHTING_ENABLED) {
    bool firstPresent = glCheapFirstPresent;
    bool lightForced = !firstPresent && (forceFull || worldShifted || skyChanged);
    bool lightThrottleReady = glLightTick == INT_MIN || E.tick - glLightTick >= GL_LIGHT_THROTTLE_TICKS;
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
      lightUpdated = true;
    }
  }
  // A lighting solve can change every visible pixel. A pure pan keeps the overlap
  // valid and adds at most four non-overlapping edge bands; ordinary grid diffs
  // between lighting solves continue to update their dirty chunks.
  bool fullWindowRefresh = forceFull || worldShifted || lightUpdated || !previousWindowValid;
  int exposed[16], exposedCount = 0;
  auto addExposed = [&](int ax0, int ay0, int ax1, int ay1) {
    if (ax0 > ax1 || ay0 > ay1) return;
    int* r = exposed + exposedCount * 4;
    r[0] = ax0; r[1] = ay0; r[2] = ax1; r[3] = ay1;
    exposedCount++;
  };
  if (!fullWindowRefresh && windowMoved) {
    int ix0 = imax(x0, glLastVisX0), iy0 = imax(y0, glLastVisY0);
    int ix1 = imin(x1, glLastVisX1), iy1 = imin(y1, glLastVisY1);
    if (ix0 > ix1 || iy0 > iy1) {
      fullWindowRefresh = true;
    } else {
      addExposed(x0, y0, ix0 - 1, y1);
      addExposed(ix1 + 1, y0, x1, y1);
      addExposed(ix0, y0, ix1, iy0 - 1);
      addExposed(ix0, iy1 + 1, ix1, y1);
    }
  }
  E.renderer.renderFrameSalt = animFrame;
  int cx0 = x0 >> CHUNK_SHIFT, cy0 = y0 >> CHUNK_SHIFT;
  int cx1 = x1 >> CHUNK_SHIFT, cy1 = y1 >> CHUNK_SHIFT;
  int cw = cx1 - cx0 + 1, count = cw * (cy1 - cy0 + 1);
  auto fillLayer = [&](Layer& lay, std::vector<uint8_t>& animatedChunks) {
    E.useLayer(&lay);
    size_t chunkTotal = (size_t)E.chunkCols * E.chunkRows;
    if (animatedChunks.size() != chunkTotal) animatedChunks.assign(chunkTotal, 0);
    for (int cy = cy0; cy <= cy1; cy++) for (int cx = cx0; cx <= cx1; cx++) {
      int ci = cy * E.chunkCols + cx;
      if (!fullWindowRefresh && !lay.dirtyRender[ci] && !(animationDue && animatedChunks[ci])) continue;
      int tx0 = imax(x0, cx * CHUNK_SIZE), ty0 = imax(y0, cy * CHUNK_SIZE);
      int tx1 = imin(x1, (cx + 1) * CHUNK_SIZE - 1), ty1 = imin(y1, (cy + 1) * CHUNK_SIZE - 1);
      bool found = E.renderer.fillRenderSpan(lay.grid, (uint32_t*)lay.renderPixels.data(), tx0, ty0, tx1, ty1);
      animatedChunks[ci] = found ? 1 : 0;
    }
    // Edge bands are cell-precise, but split at chunk boundaries so animation
    // flags remain useful when the newly visible cells first enter the window.
    for (int ri = 0; ri < exposedCount; ri++) {
      const int* r = exposed + ri * 4;
      int rcx0 = r[0] >> CHUNK_SHIFT, rcy0 = r[1] >> CHUNK_SHIFT;
      int rcx1 = r[2] >> CHUNK_SHIFT, rcy1 = r[3] >> CHUNK_SHIFT;
      for (int cy = rcy0; cy <= rcy1; cy++) for (int cx = rcx0; cx <= rcx1; cx++) {
        int ci = cy * E.chunkCols + cx;
        int tx0 = imax(r[0], cx * CHUNK_SIZE), ty0 = imax(r[1], cy * CHUNK_SIZE);
        int tx1 = imin(r[2], (cx + 1) * CHUNK_SIZE - 1), ty1 = imin(r[3], (cy + 1) * CHUNK_SIZE - 1);
        bool found = E.renderer.fillRenderSpan(lay.grid, (uint32_t*)lay.renderPixels.data(), tx0, ty0, tx1, ty1);
        if (found) animatedChunks[ci] = 1;
      }
    }
    for (int cy = cy0; cy <= cy1; cy++) for (int cx = cx0; cx <= cx1; cx++)
      if (animatedChunks[cy * E.chunkCols + cx]) return true;
    return false;
  };
  auto uploadChanged = [&](Layer& lay, GLuint tex, const std::vector<uint8_t>& animatedChunks) {
    E.useLayer(&lay);
    for (int cy = cy0; cy <= cy1; cy++) {
      int cx = cx0;
      while (cx <= cx1) {
        auto changed = [&](int x) {
          int ci = cy * E.chunkCols + x;
          return lay.dirtyRender[ci] || (animationDue && animatedChunks[ci]);
        };
        while (cx <= cx1 && !changed(cx)) cx++;
        if (cx > cx1) break;
        int run0 = cx;
        while (cx + 1 <= cx1 && changed(cx + 1)) cx++;
        int tx0 = imax(x0, run0 * CHUNK_SIZE), ty0 = imax(y0, cy * CHUNK_SIZE);
        int tx1 = imin(x1, (cx + 1) * CHUNK_SIZE - 1), ty1 = imin(y1, (cy + 1) * CHUNK_SIZE - 1);
        glUploadWindow(tex, tx0, ty0, tx1, ty1);
        cx++;
      }
    }
  };
  double tf = emscripten_get_now();
  bool fgAnimated = fillLayer(E.fg, glAnimatedFg);
  bool bgAnimated = fillLayer(E.bg, glAnimatedBg);
  E.perfFillMs = emscripten_get_now() - tf;
  double tu = emscripten_get_now();
  if (fullWindowRefresh) {
    E.useLayer(&E.fg); glUploadWindow(glTex, x0, y0, x1, y1);
    E.useLayer(&E.bg); glUploadWindow(glTexBg, x0, y0, x1, y1);
  } else {
    uploadChanged(E.fg, glTex, glAnimatedFg);
    uploadChanged(E.bg, glTexBg, glAnimatedBg);
    for (int ri = 0; ri < exposedCount; ri++) {
      const int* r = exposed + ri * 4;
      E.useLayer(&E.fg); glUploadWindow(glTex, r[0], r[1], r[2], r[3]);
      E.useLayer(&E.bg); glUploadWindow(glTexBg, r[0], r[1], r[2], r[3]);
    }
  }
  glVisibleAnimated = fgAnimated || bgAnimated;
  E.perfUploadMs = emscripten_get_now() - tu;

  auto clearPresentedDirty = [&](Layer& lay) {
    E.useLayer(&lay);
    memset(lay.dirtyRender.data(), 0, (size_t)E.chunkCols * E.chunkRows);
    lay.dirtyRenderCount = 0;
    // Authority/full engines retain row marks for beginStepDirty's scheduler.
    // A presentation replica never steps cells, so retaining them would make
    // buildDirtyRects re-promote every historical diff on every later frame.
    if (E.storageRole == ESR_PRESENTATION) {
      for (int y = 0; y < E.rows; y++) { lay.rowMarkMin[y] = E.cols; lay.rowMarkMax[y] = -1; }
    }
  };
  clearPresentedDirty(E.fg);
  clearPresentedDirty(E.bg);
  glLastCamCol = camCol; glLastCamRow = camRow;
  glLastWorldOffX = E.fg.worldOffsetX; glLastWorldOffY = E.fg.worldOffsetY;
  glLastVisX0 = x0; glLastVisY0 = y0; glLastVisX1 = x1; glLastVisY1 = y1;
  glLastSkyLight = (int)E.renderer.renderSkyLight;
  glLastAnimFrame = animFrame;
  glCheapFirstPresent = false;
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
  glDrawProjectiles();
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
