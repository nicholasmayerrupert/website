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
  Engine::ActiveLayerScope boundary(E, &E.fg, &E.fg);
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
    { Engine::ActiveLayerScope active(E, &E.fg); E.renderer.renderFull(); glUploadFull(glTex); }
    { Engine::ActiveLayerScope active(E, &E.bg); E.renderer.renderFull(); glUploadFull(glTexBg); }
  } else {
    glCheapFirstPresent = true;
  }
  return 1;
}

int GLPresenter::glRestore() {
  Engine::ActiveLayerScope boundary(E, &E.fg, &E.fg);
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
  glLastSkyLight = glLightTick = INT_MIN; glLightWallMs = -1e9;
  glLastAnimFrame = UINT32_MAX; glVisibleAnimated = false;
  glAnimatedFg.clear(); glAnimatedBg.clear();
  glLightX0 = glLightY0 = glLightX1 = glLightY1 = -1;
  glTerrainLightIntervals.clear();
  glDynamicLightPending = false;
  glDynamicLightX0 = glDynamicLightY0 = INT_MAX;
  glDynamicLightX1 = glDynamicLightY1 = INT_MIN;
  glCheapFirstPresent = false;
  { Engine::ActiveLayerScope active(E, &E.fg); E.markAllDirty(); }
  { Engine::ActiveLayerScope active(E, &E.bg); E.markAllDirty(); }
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
  glLightTick = INT_MIN; glLightWallMs = -1e9;
  glLastAnimFrame = UINT32_MAX; glVisibleAnimated = false;
  glAnimatedFg.clear(); glAnimatedBg.clear();
  glLightX0 = glLightY0 = glLightX1 = glLightY1 = -1;
  glTerrainLightIntervals.clear();
  glDynamicLightPending = false;
  glDynamicLightX0 = glDynamicLightY0 = INT_MAX;
  glDynamicLightX1 = glDynamicLightY1 = INT_MIN;
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
  if (glUseExtPlayers && data && count > 0)
    glExtPlayers.assign(data, data + (size_t)count * GLP_STRIDE);
  else glExtPlayers.clear();
}
void GLPresenter::glSetSurvivalPreview(int on, int footprint, int erasing, int locked, int x, int y) {
  glSurvivalPreviewOn = on != 0;
  glSurvivalPreviewFootprint = E.tools.clampSurvivalFootprintId(footprint);
  glSurvivalPreviewErasing = erasing != 0;
  glSurvivalPreviewLocked = locked != 0;
  glSurvivalPreviewX = x;
  glSurvivalPreviewY = y;
}
// Client item override: when external, glDrawItems draws these instead of the
// engine-owned item list (a client does not simulate local item actors).
void GLPresenter::glSetItems(int useExternal, const float* data, int count) {
  glUseExtItems = useExternal != 0;
  if (glUseExtItems && data && count > 0)
    glExtItems.assign(data, data + (size_t)count * IS_STRIDE);
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

void GLPresenter::glCollectDynamicLights() {
  std::vector<RenderLightSource> next;
  next.reserve(GL_DYNAMIC_LIGHT_CAP);
  auto add = [&](double x, double y, int intensity) {
    int ix = (int)std::floor(x), iy = (int)std::floor(y);
    if (ix < 0 || ix >= E.cols || iy < 0 || iy >= E.rows) return;
    next.push_back({ix, iy, (uint8_t)imax(0, imin(255, intensity))});
  };
  auto addPlayer = [&](double x, double y, int w, int h, int facing, bool alive,
                       int heldItemKind, double aimX, double aimY,
                       bool jetpackActive,
                       int shieldHealth, bool shieldActive) {
    if (!alive) return;
    double cx = x + w * .5, cy = y + h * .5;
    if (heldItemKind == IK_MINING_TOOL)
      add(aimX, aimY, 225);
    if (jetpackActive)
      add(cx - facing * 1.55, y + h - 1.15, 225);
    if (shieldActive && shieldHealth > 0) {
      double dx = aimX - cx, dy = aimY - cy;
      double length = std::hypot(dx, dy);
      if (length < 1e-6) { dx = facing; dy = 0; length = 1; }
      int intensity = 170 + 45 * imin(P_SHIELD_MAX_HEALTH, shieldHealth) /
                            P_SHIELD_MAX_HEALTH;
      add(cx + dx / length * 6.2, cy + dy / length * 6.2, intensity);
    }
  };
  if (glUseExtPlayers) {
    int count = (int)(glExtPlayers.size() / GLP_STRIDE);
    for (int i = 0; i < count; i++) {
      const float* p = glExtPlayers.data() + (size_t)i * GLP_STRIDE;
      addPlayer(p[GLP_X], p[GLP_Y], (int)p[GLP_W], (int)p[GLP_H],
                (int)p[GLP_FACING], p[GLP_ALIVE] > .5f,
                (int)p[GLP_HELD_ITEM_KIND], p[GLP_AIM_X], p[GLP_AIM_Y],
                p[GLP_JETPACK_ACTIVE] > .5f,
                (int)p[GLP_SHIELD_HEALTH], p[GLP_SHIELD_ACTIVE] > .5f);
    }
  } else {
    for (const Player& p : E.psys.players) if (p.active)
      addPlayer(p.px, p.py, p.w, p.h, p.facing, p.alive,
                p.inv[p.selectedSlot].count > 0
                  ? p.inv[p.selectedSlot].itemKind : IK_MATERIAL,
                p.aimX, p.aimY, p.jetpackActive, p.shieldHealth,
                p.shieldActive);
  }

  int minigunLights = 0;
  auto addProjectile = [&](int kind, double x, double y, double vx, double vy,
                           double charge, int fuse) {
    if (kind == PK_BLAST_ROUND) add(x, y, 255);
    else if (kind == PK_DYNAMITE)
      add(x, y, (((fuse / 3) & 1) ? 225 : 185));
    else if (kind == PK_ACID_SHELL) add(x, y, 215);
    else if (kind == PK_CLUSTER_BOMB)
      add(x, y, charge < .5 ? 220 : (((fuse / 2) & 1) ? 235 : 195));
    else if (kind == PK_MINIGUN_ROUND && minigunLights++ < 6)
      add(x, y, 125);
    else if (kind == PK_BORE_BEAM) {
      double length = std::hypot(vx, vy);
      if (length < 1e-6) return;
      double dx = vx / length, dy = vy / length;
      // A few terrain-aware samples make the long beam illuminate its tunnel
      // without turning every beam pixel into a separate flood source.
      for (int i = 0; i < 6; i++) add(x + dx * i * 12.0, y + dy * i * 12.0, 245);
    } else if (kind == PK_RESCUE_BEAM) {
      double length = std::max(0.0, charge);
      for (int i = 0; i < 4; i++)
        add(x + vx * length * i / 4.0, y + vy * length * i / 4.0, 210);
    }
  };
  if (glUseExtProjectiles) {
    int count = (int)(glExtProjectiles.size() / PRS_STRIDE);
    for (int i = 0; i < count; i++) {
      const float* p = glExtProjectiles.data() + (size_t)i * PRS_STRIDE;
      addProjectile((int)p[PRS_KIND], p[PRS_X], p[PRS_Y], p[PRS_VX], p[PRS_VY],
                    p[PRS_CHARGE], (int)p[PRS_FUSE]);
    }
  } else {
    for (const Projectile& p : E.projectiles.projectiles)
      addProjectile(p.kind, p.px, p.py, p.vx, p.vy, p.charge, p.fuse);
  }

  if ((int)next.size() > GL_DYNAMIC_LIGHT_CAP) {
    auto brighter = [](const RenderLightSource& a, const RenderLightSource& b) {
      if (a.intensity != b.intensity) return a.intensity > b.intensity;
      if (a.y != b.y) return a.y < b.y;
      return a.x < b.x;
    };
    std::partial_sort(next.begin(), next.begin() + GL_DYNAMIC_LIGHT_CAP, next.end(), brighter);
    next.resize(GL_DYNAMIC_LIGHT_CAP);
  }
  bool changed = next.size() != E.renderer.dynamicLights.size();
  if (!changed) {
    for (size_t i = 0; i < next.size(); i++) {
      const RenderLightSource& a = next[i];
      const RenderLightSource& b = E.renderer.dynamicLights[i];
      if (a.x != b.x || a.y != b.y || a.intensity != b.intensity) {
        changed = true;
        break;
      }
    }
  }
  if (changed) {
    auto include = [&](const std::vector<RenderLightSource>& sources) {
      for (const RenderLightSource& source : sources) {
        glDynamicLightX0 = imin(glDynamicLightX0, source.x);
        glDynamicLightY0 = imin(glDynamicLightY0, source.y);
        glDynamicLightX1 = imax(glDynamicLightX1, source.x);
        glDynamicLightY1 = imax(glDynamicLightY1, source.y);
      }
    };
    include(E.renderer.dynamicLights);
    include(next);
    E.renderer.dynamicLights.swap(next);
    glDynamicLightPending = true;
  }
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
    { Engine::ActiveLayerScope active(E, &E.fg); E.renderer.renderFull(); glUploadFull(glTex); }
    { Engine::ActiveLayerScope active(E, &E.bg); E.renderer.renderFull(); glUploadFull(glTexBg); }
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
    { Engine::ActiveLayerScope active(E, &E.fg); E.renderer.renderFull(); glUploadFull(glTex); }
    { Engine::ActiveLayerScope active(E, &E.bg); E.renderer.renderFull(); glUploadFull(glTexBg); }
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

// Blit the player's current animation frame as sub-cell pixel rects. The sprite
// spans six world cells around the four-cell hitbox and its feet plant at the
// AABB floor; articulated arms and jetpack layers are composed around it below.
// Facing mirrors the authored body while a subtle tint distinguishes local/remote.
float GLPresenter::glActorLight(double px, double py, int w, int h) const {
  if (!Renderer::RENDER_LIGHTING_ENABLED || E.fg.light.empty()) return 1.0f;
  int x0 = imax(0, (int)std::floor(px)), x1 = imin(E.cols - 1, (int)std::floor(px + w - 1e-6));
  int y0 = imax(0, (int)std::floor(py)), y1 = imin(E.rows - 1, (int)std::floor(py + h - 1e-6));
  if (x1 < x0 || y1 < y0) return Renderer::LIGHT_AMBIENT / 255.0f;
  int sum = 0, count = 0;
  for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++) { sum += E.fg.light[E.I(x, y)]; count++; }
  float measured = count ? (float)sum / (255.0f * count) : Renderer::LIGHT_AMBIENT / 255.0f;
  return E.planetId == PL_FRONTIER ? std::max(measured, E.content.ambientAt((int)py + E.fg.worldOffsetY) / 255.f) : measured;
}

void GLPresenter::glDrawWard(double pxc, double pyc, int facing, double aimX, double aimY,
                             int shieldHealth, bool shieldActive, int camCol, int camRow) {
  if (!shieldActive || shieldHealth <= 0) return;
  double cell = (double)glCellDev;
  double originX = pxc + PLAYER_W * .5;
  double originY = pyc + PLAYER_H * .5;
  double dx = aimX - originX, dy = aimY - originY;
  if (std::hypot(dx, dy) < 1e-6) { dx = facing; dy = 0; }
  double aimAngle = std::atan2(dy, dx);
  double strength = std::max(0.0, std::min(1.0, shieldHealth / (double)P_SHIELD_MAX_HEALTH));
  double phase = E.actorTick * .16;
  float red = (float)(.48 + (1.0 - strength) * .28);
  float green = (float)(.86 + strength * .12);
  float blue = 1.0f;

  // The compositor uses premultiplied alpha. Layer a broad, quiet field between
  // two crisp rims so the ward reads as translucent curved glass rather than a
  // dotted line, while retaining the simulation's pixel-art vocabulary.
  auto wardSquare = [&](double wx, double wy, double size,
                        float r, float g, float b, float alpha) {
    double x = (wx - camCol) * cell + glOffX;
    double y = (wy - camRow) * cell + glOffY;
    glUniform4f(glc->uColor, r * alpha, g * alpha, b * alpha, alpha);
    glSolidDev(x - size * cell * .5, y - size * cell * .5,
               size * cell, size * cell);
  };
  static constexpr int SEGMENTS = 30;
  static constexpr double HALF_ARC = 3.14159265358979323846 / 3.0;
  static constexpr double FIELD_RADIUS = 6.20;
  static constexpr double OUTER_RADIUS = 6.75;
  static constexpr double INNER_RADIUS = 5.55;
  for (int i = 0; i <= SEGMENTS; i++) {
    double t = i / (double)SEGMENTS;
    double angle = aimAngle - HALF_ARC + t * HALF_ARC * 2.0;
    double shimmer = .5 + .5 * std::sin(phase + i * .83);
    double cs = std::cos(angle), sn = std::sin(angle);
    double fieldRadius = FIELD_RADIUS + std::sin(phase * .55 + i * .47) * .04;
    wardSquare(originX + cs * fieldRadius, originY + sn * fieldRadius,
               1.24, red, green, blue, (float)(.075 + strength * .045));
    wardSquare(originX + cs * OUTER_RADIUS, originY + sn * OUTER_RADIUS,
               .38, red, green, blue, (float)(.28 + strength * .18 + shimmer * .08));
    wardSquare(originX + cs * INNER_RADIUS, originY + sn * INNER_RADIUS,
               .27, .84f, .98f, 1.0f, (float)(.24 + strength * .15));
    if (i % 5 == 0) {
      wardSquare(originX + cs * FIELD_RADIUS, originY + sn * FIELD_RADIUS,
                 .31, .96f, 1.0f, 1.0f, (float)(.60 + shimmer * .20));
    }
  }
  // Luminous end caps clearly delimit the protected 120-degree sector.
  for (int side : {-1, 1}) {
    double angle = aimAngle + side * HALF_ARC;
    double cs = std::cos(angle), sn = std::sin(angle);
    wardSquare(originX + cs * FIELD_RADIUS, originY + sn * FIELD_RADIUS,
               .96, red, green, blue, .22f);
    wardSquare(originX + cs * FIELD_RADIUS, originY + sn * FIELD_RADIUS,
               .38, .96f, 1.0f, 1.0f, .92f);
  }
}

void GLPresenter::glDrawOnePlayer(double pxc, double pyc, int facing, int animState, int animFrame,
                     bool alive, int heldItemKind, double bowCharge, double aimX, double aimY,
                     double jetpackFuel, bool jetpackActive, int shieldHealth,
                     bool shieldActive, double weaponKick, int hurtCooldown, bool own, float light, int camCol, int camRow) {
  if (animState < 0 || animState >= AS_COUNT) animState = AS_IDLE;
  const auto& art = E.content;
  const int spriteWidth = art.spriteWidth, spriteHeight = art.spriteHeight;
  if (!spriteWidth || !spriteHeight) return;
  if (animFrame < 0 || animFrame >= art.clips[animState].count) animFrame = 0;
  double cell = (double)glCellDev;
  double pixel = cell * art.pixelScale;
  bool aimedWeapon = heldItemKind == IK_MINING_TOOL ||
                     heldItemKind == IK_BLAST_GUN || heldItemKind == IK_DYNAMITE_SATCHEL ||
                     heldItemKind == IK_BORE_CANNON || heldItemKind == IK_ACID_MORTAR ||
                     heldItemKind == IK_CLUSTER_LAUNCHER || heldItemKind == IK_MINIGUN ||
                     heldItemKind == IK_RESCUE_BEAM;

  // Torso follow-through stays below a quarter cell; aimed hands use the
  // physical shoulder while the head and legs breathe through the pose.
  double bodyBob = 0;
  if (alive) {
    static const double WALK_BOB[4] = {0.0, -0.10, 0.0, -0.06};
    static const double RUN_BOB[4] = {-0.14, 0.0, -0.11, 0.0};
    static const double SWIM_BOB[4] = {-0.08, 0.02, 0.08, 0.0};
    if (animState == AS_IDLE) bodyBob = std::sin(E.actorTick * .055) * .07;
    else if (animState == AS_WALK) bodyBob = WALK_BOB[animFrame % 4];
    else if (animState == AS_RUN) bodyBob = RUN_BOB[animFrame % 4];
    else if (animState == AS_WADE) bodyBob = animFrame ? -0.045 : 0.0;
    else if (animState == AS_SWIM) bodyBob = SWIM_BOB[animFrame % 4];
  }
  double sprX = (pxc + PLAYER_W * .5 - camCol) * cell + glOffX - spriteWidth * pixel * .5;
  double sprY = (pyc + PLAYER_H - camRow + bodyBob) * cell + glOffY - spriteHeight * pixel;
  if (alive) glDrawWard(pxc, pyc, facing, aimX, aimY, shieldHealth, shieldActive, camCol, camRow);

  auto worldSquare = [&](double wx, double wy, double size,
                         float r, float g, float b, float a = 1.0f) {
    double x = (wx - camCol) * cell + glOffX;
    double y = (wy - camRow) * cell + glOffY;
    glUniform4f(glc->uColor, r * light, g * light, b * light, a);
    glSolidDev(x - size * cell * .5, y - size * cell * .5, size * cell, size * cell);
  };
  auto segment = [&](double x0, double y0, double x1, double y1, double size,
                     float r, float g, float b) {
    double length = std::hypot(x1 - x0, y1 - y0);
    // The squares overlap at this spacing, preserving a continuous pixel-art
    // limb without turning each arm into dozens of tiny WebGL draw calls.
    int samples = imax(1, (int)std::ceil(length / .48));
    for (int i = 0; i <= samples; i++) {
      double t = i / (double)samples;
      worldSquare(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, size, r, g, b);
    }
  };
  auto articulatedArm = [&](double sx, double sy, double ex, double ey,
                            double hx, double hy, bool rear) {
    float shade = rear ? .78f : 1.0f;
    // A dark edge unifies the sampled squares into a readable jointed limb.
    segment(sx, sy, ex, ey, .72, 20/255.f, 18/255.f, 26/255.f);
    segment(ex, ey, hx, hy, .64, 20/255.f, 18/255.f, 26/255.f);
    segment(sx, sy, ex, ey, .53, 48/255.f * shade, 108/255.f * shade, 170/255.f * shade);
    segment(ex, ey, hx, hy, .46, 184/255.f * shade, 118/255.f * shade, 88/255.f * shade);
    worldSquare(hx, hy, .57, rear ? 184/255.f : 236/255.f,
                rear ? 118/255.f : 184/255.f, rear ? 88/255.f : 142/255.f);
  };

  // A relaxed/stroke pose is rendered as two independently articulated arms.
  // Rear arm goes behind the torso; the front one is added after the sprite.
  auto relaxedArmPose = [&](bool rear, double& sx, double& sy, double& ex,
                            double& ey, double& hx, double& hy) {
    static const double WALK_SWING[4] = {-0.66, -0.16, 0.66, 0.16};
    static const double RUN_SWING[4] = {-0.94, -0.24, 0.94, 0.24};
    static const double SWIM_STROKE[4] = {-0.70, 0.08, 0.78, 0.18};
    double swing = animState == AS_WALK ? WALK_SWING[animFrame]
                 : animState == AS_RUN ? RUN_SWING[animFrame]
                 : animState == AS_WADE ? WALK_SWING[animFrame] * .42
                 : animState == AS_SWIM ? SWIM_STROKE[animFrame]
                 : animState == AS_IDLE ? (animFrame ? .08 : -.08)
                 : 0.0;
    if (rear) swing = -swing;
    sx = pxc + PLAYER_W * .5 + facing * (rear ? -.08 : .42);
    sy = pyc + PLAYER_H * .39 + bodyBob;
    if (animState == AS_RISE) {
      ex = sx + facing * (rear ? .45 : .72); ey = sy - (rear ? .46 : .68);
      hx = ex + facing * .52; hy = ey - .48;
    } else if (animState == AS_FALL) {
      ex = sx + facing * (rear ? -.42 : .78); ey = sy + .26;
      hx = ex + facing * (rear ? -.44 : .62); hy = ey + .30;
    } else if (animState == AS_SWIM) {
      ex = sx + facing * (.70 + swing * .42); ey = sy + .35 - std::fabs(swing) * .25;
      hx = ex + facing * (.62 + swing * .48); hy = ey + .18 + swing * .34;
    } else {
      ex = sx + facing * (.24 + swing * .38); ey = sy + .92 - std::fabs(swing) * .10;
      hx = ex + facing * (.18 + swing * .42); hy = ey + .92;
    }
  };

  if (alive) {
    // The backpack is drawn behind the torso. Its twin nozzles alternate by
    // phase, the transparent gauge tracks authoritative fuel, and deterministic
    // exhaust motes make sustained thrust read even when the plume is partly
    // hidden by the player.
    double fuel = std::max(0.0, std::min(1.0, jetpackFuel));
    int thrustPhase = (int)(E.actorTick % 6);
    double vibration = jetpackActive && fuel > 0 ? (thrustPhase - 2.5) * .012 : 0.0;
    // Sit the pack just outside the six-cell authored silhouette so both tanks,
    // rather than only a side sliver, remain readable behind the body.
    double packWorldX = pxc + (facing >= 0 ? -1.0 : PLAYER_W + 1.0) + vibration;
    double packWorldY = pyc + PLAYER_H * .47 + bodyBob;
    double packX = (packWorldX - camCol) * cell + glOffX;
    double packY = (packWorldY - camRow) * cell + glOffY;

    if (jetpackActive && fuel > 0) {
      for (int nozzle = -1; nozzle <= 1; nozzle += 2) {
        int phase = (thrustPhase + (nozzle > 0 ? 3 : 0)) % 6;
        double nozzleX = packX + nozzle * cell * .25;
        double nozzleY = packY + cell * 1.11;
        double pulse = phase < 3 ? phase * .10 : (6 - phase) * .10;
        // The nozzles begin behind the torso, so carry the plume past the
        // player's feet instead of letting the later body pass occlude it.
        double outerLen = 2.45 + fuel * .70 + pulse;
        double innerLen = 1.55 + fuel * .52 + (phase & 1) * .10;
        double tipDrift = nozzle * (.08 + phase * .012);
        glUniform4f(glc->uColor, 1.0f, .25f, .035f, .82f);
        glSolidDev(nozzleX - cell * .23, nozzleY, cell * .46, cell * outerLen);
        glUniform4f(glc->uColor, 1.0f, .72f, .10f, .96f);
        glSolidDev(nozzleX - cell * .15, nozzleY, cell * .30, cell * innerLen);
        glUniform4f(glc->uColor, 1.0f, 1.0f, .72f, 1);
        glSolidDev(nozzleX - cell * .075, nozzleY, cell * .15, cell * (.30 + fuel * .16));
        glUniform4f(glc->uColor, 1.0f, .35f, .04f, .70f);
        glSolidDev(nozzleX + tipDrift * cell - cell * .13,
                   nozzleY + outerLen * cell, cell * .26, cell * .28);
      }
      for (int mote = 0; mote < 4; mote++) {
        double travel = std::fmod((double)E.actorTick * .19 + mote * .47, 1.85);
        double drift = std::sin((double)E.actorTick * .41 + mote * 2.3) * (.13 + travel * .12);
        glUniform4f(glc->uColor, 1.0f, .48f, .06f,
                    (float)std::max(.12, .70 - travel * .28));
        glSolidDev(packX + drift * cell - cell * .09,
                   packY + (2.65 + travel) * cell, cell * .18, cell * .18);
      }
    }

    // Armoured dual canisters, lower manifold, harness, and a real fuel window.
    glUniform4f(glc->uColor, .075f * light, .095f * light, .13f * light, 1);
    glSolidDev(packX - cell * .64, packY - cell * 1.08, cell * 1.28, cell * 2.22);
    for (int tank = -1; tank <= 1; tank += 2) {
      double tankX = packX + tank * cell * .29;
      glUniform4f(glc->uColor, .20f * light, .32f * light, .39f * light, 1);
      glSolidDev(tankX - cell * .22, packY - cell * .87, cell * .44, cell * 1.52);
      glUniform4f(glc->uColor, .37f * light, .55f * light, .61f * light, 1);
      glSolidDev(tankX - cell * .13, packY - cell * .76, cell * .12, cell * 1.22);
      glUniform4f(glc->uColor, .08f * light, .11f * light, .14f * light, 1);
      glSolidDev(tankX - cell * .24, packY + cell * .70, cell * .48, cell * .40);
    }
    glUniform4f(glc->uColor, .055f * light, .07f * light, .09f * light, 1);
    glSolidDev(packX - cell * .13, packY - cell * .60, cell * .26, cell * 1.06);
    if (fuel > 0) {
      double fillH = .90 * fuel;
      glUniform4f(glc->uColor, fuel < .20 ? 1.0f : .26f,
                  fuel < .20 ? .25f : .88f, fuel < .20 ? .05f : .94f, .96f);
      glSolidDev(packX - cell * .085, packY + cell * (.38 - fillH),
                 cell * .17, cell * fillH);
    }
    float statusPulse = jetpackActive && fuel > 0 && (thrustPhase < 3) ? 1.0f : .62f;
    glUniform4f(glc->uColor, (fuel < .20 ? 1.0f : .30f) * statusPulse,
                (fuel < .20 ? .18f : .92f) * statusPulse, .10f * statusPulse, 1);
    glSolidDev(packX - cell * .11, packY - cell * .86, cell * .22, cell * .18);
    glUniform4f(glc->uColor, .055f * light, .07f * light, .09f * light, 1);
    glSolidDev(packX - cell * .49, packY + cell * .90, cell * .98, cell * .30);
  }

  double rearSX = 0, rearSY = 0, rearEX = 0, rearEY = 0, rearHX = 0, rearHY = 0;
  if (alive && !aimedWeapon) {
    relaxedArmPose(true, rearSX, rearSY, rearEX, rearEY, rearHX, rearHY);
    articulatedArm(rearSX, rearSY, rearEX, rearEY, rearHX, rearHY, true);
  }

  for (int r = 0; r < spriteHeight; r++) {
    const uint8_t* row = art.spriteRow(animState, animFrame, r);
    // Merge adjacent authored pixels of the same color into one quad.
    for (int c = 0; c < spriteWidth;) {
      int source = facing >= 0 ? c : (spriteWidth - 1 - c);
      int idx = row[source];
      int run = 1;
      while (c + run < spriteWidth) {
        int nextSource = facing >= 0 ? c + run : (spriteWidth - 1 - c - run);
        if (row[nextSource] != idx) break;
        run++;
      }
      if (idx <= 0 || idx >= (int)art.palette.size()) {
        c += run;
        continue;
      }
      const float* col = art.palette[(size_t)idx].data();
      float tr = col[0], tg = col[1], tb = col[2];
      if (own) tb = std::min(1.0f, tb * 1.10f); else tr = std::min(1.0f, tr * 1.06f);
      float flash = alive && hurtCooldown > 0 && hurtCooldown <= 30 && (hurtCooldown % 6 < 3) ? .65f : 0;
      glUniform4f(glc->uColor, tr * light * (1 - flash) + flash,
                  tg * light * (1 - flash) + flash * .65f,
                  tb * light * (1 - flash) + flash * .65f, col[3]);
      double drawY = alive ? sprY + r * pixel
                           : sprY + (spriteHeight - 2) * pixel + (r / 4) * pixel * .45;
      glSolidDev(sprX + c * pixel, drawY, run * pixel, alive ? pixel : pixel * .45);
      c += run;
    }
  }
  if (alive && !aimedWeapon) {
    double sx, sy, ex, ey, hx, hy;
    relaxedArmPose(false, sx, sy, ex, ey, hx, hy);
    articulatedArm(sx, sy, ex, ey, hx, hy, false);
  }
  if (alive && (animState == AS_WALK || animState == AS_RUN)) {
    for (int mote = 0; mote < 3; mote++) {
      double age = std::fmod(E.actorTick / 18.0 + mote / 3.0, 1.0);
      worldSquare(pxc + PLAYER_W * .5 - facing * (1 + age * 3),
                  pyc + PLAYER_H - .15 - std::sin(age * 3.14159) * .6,
                  .22 + age * .15, .58f, .57f, .51f, (float)((1 - age) * .4));
    }
  }
  if (alive && heldItemKind == IK_BOW) {
    double physicalSpriteW = spriteWidth * art.pixelScale;
    double bx = sprX + (facing > 0 ? physicalSpriteW + .3 : -1.3) * cell;
    double by = sprY + 3.2 * cell;
    glUniform4f(glc->uColor, .55f * light, .31f * light, .14f * light, 1);
    glSolidDev(bx, by, cell * .45, cell * 4.4);
    glUniform4f(glc->uColor, .88f * light, .86f * light, .72f * light, 1);
    double pull = std::max(0.0, std::min(1.0, bowCharge)) * cell;
    glSolidDev(bx + (facing > 0 ? -pull : pull), by + cell * 2.0, cell * .25, cell * .25);
  }
  if (alive && aimedWeapon) {
    // Aim from the shoulder, then extend an authored arm to a real hand anchor.
    // Weapon geometry below is grip-relative, so it rotates in the hand instead
    // of orbiting around the center of the player's torso.
    double shoulderX = pxc + PLAYER_W * .5, shoulderY = pyc + PLAYER_H * .42;
    double dx = aimX - shoulderX, dy = aimY - shoulderY, d = std::hypot(dx, dy);
    if (d < 1e-6) { dx = facing; dy = 0; d = 1; }
    dx /= d; dy /= d;
    double nx = -dy, ny = dx;
    double kick = std::max(0.0, std::min(1.0, weaponKick));
    double gripReach = 1.55 - kick * kick * .65;
    double handX = shoulderX + dx * gripReach, handY = shoulderY + dy * gripReach;
    double hx = (handX - camCol) * cell + glOffX;
    double hy = (handY - camRow) * cell + glOffY;
    // Arms and muzzle bloom follow the recoiling grip.
    double supportSX = shoulderX - dx * .14 + nx * .18;
    double supportSY = shoulderY - dy * .14 + ny * .18;
    double supportEX = shoulderX + dx * .46 - nx * .52;
    double supportEY = shoulderY + dy * .46 - ny * .52;
    double supportHX = handX + dx * .74 - nx * .38;
    double supportHY = handY + dy * .74 - ny * .38;
    articulatedArm(supportSX, supportSY, supportEX, supportEY,
                   supportHX, supportHY, true);
    double leadEX = shoulderX + dx * .72 + nx * .25;
    double leadEY = shoulderY + dy * .72 + ny * .25;
    articulatedArm(shoulderX, shoulderY, leadEX, leadEY, handX, handY, false);
    auto drawPixel = [&](double forward, double side, double size,
                         float r, float g, float b, float a = 1.0f) {
      double x = hx + (dx * forward + nx * side) * cell;
      double y = hy + (dy * forward + ny * side) * cell;
      glUniform4f(glc->uColor, r * light, g * light, b * light, a);
      glSolidDev(x - size * cell * .5, y - size * cell * .5, size * cell, size * cell);
    };

    if (kick > .65 && (heldItemKind == IK_BLAST_GUN || heldItemKind == IK_BORE_CANNON ||
        heldItemKind == IK_ACID_MORTAR || heldItemKind == IK_CLUSTER_LAUNCHER || heldItemKind == IK_MINIGUN)) {
      double reach = heldItemKind == IK_MINIGUN ? 4.15 : heldItemKind == IK_BORE_CANNON ? 3.5 : 2.9;
      double mx = handX + dx * reach - nx * .68, my = handY + dy * reach - ny * .68;
      worldSquare(mx, my, 1.0 + kick * .7, 1, .55f, .08f, .75f);
      worldSquare(mx + dx * .7, my + dy * .7, .65, 1, 1, .72f);
      worldSquare(mx - nx * .8, my - ny * .8, .35, 1, .8f, .18f);
      worldSquare(mx + nx * .8, my + ny * .8, .35, 1, .8f, .18f);
    }
    if (kick > 0 && heldItemKind == IK_MINIGUN) {
      double age = 1 - kick;
      worldSquare(shoulderX - dx * (1 + age * 3), shoulderY - 1 - age * 3 + age * age * 6,
                  .3, .9f, .69f, .24f);
    }
    if (heldItemKind == IK_MINING_TOOL) {
      bool drilling = own && glSurvivalPreviewOn && glSurvivalPreviewLocked;
      double scan = drilling ? std::fmod(E.actorTick * .12, 1.0) : 0;
      drawPixel(-.52, -.56, .94, .08f, .11f, .14f);
      drawPixel(-.12, -.56, 1.02, .80f, .84f, .84f);
      drawPixel(.38, -.56, .88, .94f, .95f, .90f);
      drawPixel(-.30, .10, .72, .12f, .17f, .20f);
      drawPixel(-.16, .58, .54, .08f, .10f, .12f);
      drawPixel(-.58, -.56, .38, .96f, .67f, .10f);
      for (int rail : {-1, 1}) {
        for (int i = 0; i < 5; i++)
          drawPixel(.72 + i * .42, -.56 + rail * .43, .25,
                    .20f, .91f, .94f);
        drawPixel(2.54, -.56 + rail * .43, .36, .76f, 1.0f, 1.0f);
      }
      for (int i = 0; i < 4; i++)
        drawPixel(.82 + i * .46, -.56, .18, .10f, .28f, .31f);
      drawPixel(2.62, -.56, .54, .82f, 1.0f, 1.0f);
      if (drilling) {
        drawPixel(.7 + scan * 1.8, -.99, .38, .9f, 1, 1);
        drawPixel(2.5 - scan * 1.8, -.13, .38, .9f, 1, 1);
        drawPixel(2.8, -.56, .55 + scan * .45, .4f, .96f, 1, .55f);
      }
    } else if (heldItemKind == IK_BLAST_GUN) {
      for (int i = 0; i < 7; i++) drawPixel(-.46 + i * .48, -.68, .58, .16f, .18f, .20f);
      for (int i = 0; i < 4; i++) drawPixel(-.20 + i * .48, -1.02, .40, .31f, .36f, .40f);
      drawPixel(2.59, -.68, .72, .90f, .48f, .10f);
      drawPixel(2.21, -.68, .38, 1.0f, .72f, .18f);
      drawPixel(-.08, -.06, .58, .31f, .24f, .17f);
      drawPixel(.11, .34, .52, .26f, .20f, .15f);
    } else if (heldItemKind == IK_DYNAMITE_SATCHEL) {
      for (int stick = -1; stick <= 1; stick++) for (int i = 0; i < 4; i++)
        drawPixel(-.38 + i * .43, stick * .38, .48, stick == 0 ? .82f : .62f, .07f, .045f);
      for (int stick = -1; stick <= 1; stick++) drawPixel(.24, stick * .38, .30, .16f, .12f, .10f);
      drawPixel(1.20, 0, .30, .95f, .73f, .18f);
      drawPixel(1.49, 0, .24, 1.0f, .33f, .05f);
    } else if (heldItemKind == IK_BORE_CANNON) {
      for (int i = 0; i < 9; i++) {
        float shell = (i == 0 || i == 8) ? .30f : .18f;
        drawPixel(-.66 + i * .46, -.78, .68, shell, .25f + i * .012f, .28f + i * .012f);
      }
      for (int i = 1; i < 8; i++) drawPixel(-.66 + i * .46, -.78, .32, .20f, .86f, .82f);
      for (int i = 1; i < 7; i += 2) {
        drawPixel(-.66 + i * .46, -1.26, .34, .40f, .48f, .50f);
        drawPixel(-.66 + i * .46, -.30, .34, .40f, .48f, .50f);
      }
      drawPixel(-.08, -.16, .58, .20f, .25f, .27f);
      drawPixel(.12, .22, .50, .15f, .19f, .21f);
      drawPixel(3.24, -.78, .76, .73f, 1.0f, .91f);
      if (bowCharge > 0) {
        double rayX = handX + dx * 3.52 + nx * -.78;
        double rayY = handY + dy * 3.52 + ny * -.78;
        double length = 1e9;
        if (dx > 1e-9) length = std::min(length, (E.cols - 2.0 - rayX) / dx);
        else if (dx < -1e-9) length = std::min(length, (1.0 - rayX) / dx);
        if (dy > 1e-9) length = std::min(length, (E.rows - 2.0 - rayY) / dy);
        else if (dy < -1e-9) length = std::min(length, (1.0 - rayY) / dy);
        if (std::isfinite(length) && length > 0) {
          double progress = std::max(0.0, std::min(1.0, bowCharge));
          int samples = imax(1, (int)std::ceil(length / (2.7 - progress * 1.35)));
          for (int i = 0; i <= samples; i++) {
            double t = length * i / samples;
            double bx = (rayX + dx * t - camCol) * cell + glOffX;
            double by = (rayY + dy * t - camRow) * cell + glOffY;
            double width = cell * (.16 + progress * .34);
            glUniform4f(glc->uColor, 1.0f, .40f + .46f * progress, .10f, .16f + .58f * progress);
            glSolidDev(bx - width * .5, by - width * .5, width, width);
          }
        }
      }
    } else if (heldItemKind == IK_ACID_MORTAR) {
      for (int i = 0; i < 8; i++) drawPixel(-.48 + i * .46, -.66, .64, .16f, .22f, .15f);
      for (int i = 1; i < 7; i++) drawPixel(-.48 + i * .46, -.66, .30, .49f, .63f, .20f);
      drawPixel(2.82, -.66, .82, .25f, .34f, .19f);
      drawPixel(-.10, .04, .76, .22f, .28f, .17f);
      drawPixel(.02, .05, .42, .64f, .91f, .18f);
      drawPixel(.18, .48, .52, .18f, .22f, .15f);
      drawPixel(3.14, -.66, .30, .79f, 1.0f, .30f);
    } else if (heldItemKind == IK_CLUSTER_LAUNCHER) {
      for (int i = 0; i < 8; i++) drawPixel(-.50 + i * .46, -.68, .62, .10f, .15f, .24f);
      for (int i = 1; i < 7; i += 2) drawPixel(-.50 + i * .46, -1.03, .42, .28f, .48f, .68f);
      drawPixel(2.76, -.68, .80, .93f, .43f, .10f);
      drawPixel(-.02, -.02, .92, .16f, .23f, .32f);
      for (int k = 0; k < 3; k++) drawPixel(-.02 + std::cos(k * 2.094) * .30,
                                             -.02 + std::sin(k * 2.094) * .30,
                                             .28, .94f, .57f, .12f);
      drawPixel(.10, .52, .52, .11f, .15f, .20f);
    } else if (heldItemKind == IK_RESCUE_BEAM) {
      for (int i = 0; i < 7; i++)
        drawPixel(-.42 + i * .45, -.66, .58, .10f, .22f, .27f);
      for (int i = 1; i < 6; i++)
        drawPixel(-.42 + i * .45, -.66, .27, .24f, .94f, .91f);
      drawPixel(2.48, -.66, .76, .62f, 1.0f, .96f);
      drawPixel(-.06, .02, .74, .13f, .28f, .31f);
      drawPixel(.14, .48, .48, .11f, .19f, .22f);
    } else { // IK_MINIGUN
      // The rear motor and ammo drum sit around the grip while the barrel pack
      // projects forward, so the weapon remains planted in the hand at every
      // cursor angle. Alternating highlights give the rotary cage a live spin.
      drawPixel(-.46, -.66, .86, .10f, .14f, .18f);
      drawPixel(-.08, -.66, .94, .17f, .24f, .29f);
      drawPixel(.34, -.66, .78, .27f, .34f, .35f);
      drawPixel(-.16, -.04, 1.10, .13f, .18f, .21f);
      drawPixel(-.16, -.04, .66, .74f, .53f, .16f);
      drawPixel(.04, .52, .54, .15f, .18f, .19f);
      int rotor = kick > 0 ? (E.actorTick / 2) % 3 : 0;
      for (int barrel = 0; barrel < 3; barrel++) {
        float hot = barrel == rotor ? .70f : .38f;
        for (int i = 0; i < 8; i++)
          drawPixel(.54 + i * .43, -1.04 + barrel * .36, .28,
                    hot, hot * .88f, hot * .66f);
      }
      for (int i = 0; i < 5; i++)
        drawPixel(.72 + i * .67, -.68, .18, .10f, .13f, .15f);
      drawPixel(3.76, -.68, .62, .19f, .22f, .22f);
      drawPixel(3.94, -.68, .27, 1.0f, .55f, .10f);
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
      glDrawOnePlayer(p[GLP_X], p[GLP_Y], (int)p[GLP_FACING], (int)p[GLP_ANIM_STATE], (int)p[GLP_ANIM_FRAME],
                      p[GLP_ALIVE] > .5f, (int)p[GLP_HELD_ITEM_KIND], p[GLP_BOW_CHARGE],
                      p[GLP_AIM_X], p[GLP_AIM_Y], p[GLP_JETPACK_FUEL], p[GLP_JETPACK_ACTIVE] > .5f,
                      (int)p[GLP_SHIELD_HEALTH], p[GLP_SHIELD_ACTIVE] > .5f,
                      p[GLP_WEAPON_KICK], (int)p[GLP_HURT_COOLDOWN],
                      p[GLP_OWN] > 0.5f, light, camCol, camRow);
      glDrawHitbox(p[GLP_X], p[GLP_Y], (int)p[GLP_W], (int)p[GLP_H], 0.20f, 0.90f, 1.0f, camCol, camRow);
    }
  } else {
    for (auto& p : E.psys.players) {
      if (!p.active) continue;
      const InvSlot& held = p.inv[p.selectedSlot];
      double chargeMax = held.itemKind == IK_BORE_CANNON ? BORE_CANNON_CHARGE_TICKS : BOW_CHARGE_MAX;
      glDrawOnePlayer(p.px, p.py, p.facing, p.animState, p.animFrame, p.alive, held.count > 0 ? held.itemKind : IK_MATERIAL,
                      p.bowChargeTicks / chargeMax, p.aimX, p.aimY, p.jetpackFuel, p.jetpackActive,
                      p.shieldHealth, p.shieldActive, p.weaponKick, p.hurtCooldown, p.id == glOwnPlayerId,
                      glActorLight(p.px, p.py, p.w, p.h), camCol, camRow);
      glDrawHitbox(p.px, p.py, p.w, p.h, 0.20f, 0.90f, 1.0f, camCol, camRow);
    }
  }
}

// Dropped items + particles overlay, drawn after players (same world->screen
// transform). Each is a small rect centered on its cell at the material's color;
// particles shrink/fade by remaining life. The engine draws from its own item list
// vector — no JS state push, exactly like host-side player drawing.
// Draw one dropped item/particle. Engine-owned and host-snapshot items share this
// path, so id-keyed bob/glimmer stay in sync.
void GLPresenter::glDrawOneItem(int id, int kind, int itemKind, int material, int count, int tier, double px, double py, int life,
                   int camCol, int camRow) {
  uint32_t c = itemKind == IK_MATERIAL ? MAT_COLOR[material]
             : itemKind == IK_ARROW ? 0xffd6c49au
             : itemKind == IK_BOW ? 0xff4b6b9bu
             : itemKind == IK_BLAST_GUN ? 0xff3f76c4u
             : itemKind == IK_DYNAMITE_SATCHEL ? 0xff203fc9u
             : itemKind == IK_BORE_CANNON ? 0xffb8d851u
             : itemKind == IK_ACID_MORTAR ? 0xff4fc760u
             : itemKind == IK_CLUSTER_LAUNCHER ? 0xffcf7939u
             : itemKind == IK_MINIGUN ? 0xff3f586bu
             : itemKind == IK_RESCUE_BEAM ? 0xffd4f5d2u
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
  if (kind == IT_ITEM && itemKind == IK_MATERIAL) {
    double u = glCellDev;
    double bottom = (py + bob - camRow) * u + glOffY;
    if (count > 1) {
      glUniform4f(glc->uColor, r * .48f, g * .48f, b * .48f, a);
      glSolidDev(cx - u * .88, bottom - u * .92, u * .86, u * .70);
      glUniform4f(glc->uColor, r * .78f, g * .78f, b * .78f, a);
      glSolidDev(cx - u * .80, bottom - u * .86, u * .70, u * .52);
    }
    glUniform4f(glc->uColor, r * .42f, g * .42f, b * .42f, a);
    glSolidDev(cx - u * .68, bottom - u * 1.16, u * 1.36, u * 1.04);
    glUniform4f(glc->uColor, r, g, b, a);
    glSolidDev(cx - u * .58, bottom - u * 1.08, u * 1.16, u * .84);
    glUniform4f(glc->uColor, std::min(1.0f, r * 1.28f), std::min(1.0f, g * 1.28f),
                std::min(1.0f, b * 1.28f), a);
    glSolidDev(cx - u * .48, bottom - u * .98, u * .72, u * .24);
    glSolidDev(cx - u * .48, bottom - u * .74, u * .22, u * .30);
    return;
  }
  if (kind == IT_ITEM && itemKind == IK_MINING_TOOL) {
    double u = glCellDev;
    double bottom = (py + bob - camRow) * u + glOffY;
    glUniform4f(glc->uColor, .25f, .15f, .08f, a);
    glSolidDev(cx - u * .18, bottom - u * 1.72, u * .36, u * 1.54);
    glUniform4f(glc->uColor, r * .55f, g * .55f, b * .55f, a);
    glSolidDev(cx - u * 1.03, bottom - u * 1.90, u * 2.06, u * .42);
    glUniform4f(glc->uColor, std::min(1.0f, r * 1.25f), std::min(1.0f, g * 1.25f),
                std::min(1.0f, b * 1.25f), a);
    glSolidDev(cx - u * .84, bottom - u * 1.82, u * 1.22, u * .18);
    glSolidDev(cx + u * .70, bottom - u * 1.72, u * .34, u * .52);
    return;
  }
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
  if (kind == IT_ITEM && itemKind == IK_DYNAMITE_SATCHEL) {
    double u = glCellDev;
    double bottom = (py + bob - camRow) * glCellDev + glOffY;
    for (int stick = -1; stick <= 1; stick++) {
      glUniform4f(glc->uColor, stick == 0 ? .82f : .62f, .07f, .045f, a);
      glSolidDev(cx - u * .72, bottom - u * (1.10 + stick * .34), u * 1.44, u * .42);
    }
    glUniform4f(glc->uColor, .14f, .11f, .09f, a);
    glSolidDev(cx - u * .18, bottom - u * 1.60, u * .36, u * 1.18);
    glUniform4f(glc->uColor, 1.0f, .66f, .10f, a);
    glSolidDev(cx + u * .68, bottom - u * 1.62, u * .34, u * .34);
    return;
  }
  if (kind == IT_ITEM && itemKind == IK_BORE_CANNON) {
    double u = glCellDev;
    double bottom = (py + bob - camRow) * glCellDev + glOffY;
    glUniform4f(glc->uColor, .13f, .17f, .19f, a);
    glSolidDev(cx - u * 1.55, bottom - u * 1.16, u * 3.10, u * .78);
    glUniform4f(glc->uColor, .34f, .43f, .46f, a);
    glSolidDev(cx - u * 1.15, bottom - u * 1.38, u * .42, u * 1.05);
    glSolidDev(cx + u * .20, bottom - u * 1.38, u * .42, u * 1.05);
    glUniform4f(glc->uColor, .19f, .82f, .78f, a);
    glSolidDev(cx - u * .62, bottom - u * 1.02, u * 1.48, u * .30);
    glUniform4f(glc->uColor, .73f, 1.0f, .91f, a);
    glSolidDev(cx + u * 1.32, bottom - u * 1.20, u * .56, u * .86);
    glUniform4f(glc->uColor, .12f, .16f, .18f, a);
    glSolidDev(cx - u * 1.18, bottom - u * .50, u * .58, u * .62);
    return;
  }
  if (kind == IT_ITEM && itemKind == IK_ACID_MORTAR) {
    double u = glCellDev;
    double bottom = (py + bob - camRow) * u + glOffY;
    glUniform4f(glc->uColor, .14f, .20f, .13f, a);
    glSolidDev(cx - u * 1.45, bottom - u * 1.18, u * 2.90, u * .72);
    glUniform4f(glc->uColor, .39f, .53f, .20f, a);
    glSolidDev(cx - u * .95, bottom - u * 1.02, u * 1.96, u * .28);
    glUniform4f(glc->uColor, .20f, .27f, .16f, a);
    glSolidDev(cx - u * 1.56, bottom - u * 1.30, u * .45, u * .92);
    glUniform4f(glc->uColor, .55f, .88f, .16f, a);
    glSolidDev(cx - u * .60, bottom - u * .82, u * .82, u * .72);
    glUniform4f(glc->uColor, .75f, 1.0f, .27f, a);
    glSolidDev(cx - u * .35, bottom - u * .70, u * .28, u * .28);
    return;
  }
  if (kind == IT_ITEM && itemKind == IK_CLUSTER_LAUNCHER) {
    double u = glCellDev;
    double bottom = (py + bob - camRow) * u + glOffY;
    glUniform4f(glc->uColor, .08f, .13f, .21f, a);
    glSolidDev(cx - u * 1.50, bottom - u * 1.20, u * 3.00, u * .72);
    glUniform4f(glc->uColor, .25f, .43f, .62f, a);
    glSolidDev(cx - u * .80, bottom - u * 1.38, u * 1.64, u * .30);
    glUniform4f(glc->uColor, .91f, .40f, .08f, a);
    glSolidDev(cx + u * 1.18, bottom - u * 1.32, u * .55, u * .88);
    glUniform4f(glc->uColor, .15f, .22f, .30f, a);
    glSolidDev(cx - u * .62, bottom - u * .74, u * 1.02, u * .86);
    glUniform4f(glc->uColor, .96f, .61f, .13f, a);
    glSolidDev(cx - u * .42, bottom - u * .55, u * .25, u * .25);
    glSolidDev(cx - u * .05, bottom - u * .46, u * .25, u * .25);
    return;
  }
  if (kind == IT_ITEM && itemKind == IK_MINIGUN) {
    double u = glCellDev;
    double bottom = (py + bob - camRow) * u + glOffY;
    glUniform4f(glc->uColor, .10f, .14f, .18f, a);
    glSolidDev(cx - u * 1.52, bottom - u * 1.28, u * 1.58, u * .86);
    glUniform4f(glc->uColor, .24f, .32f, .36f, a);
    glSolidDev(cx - u * 1.26, bottom - u * 1.45, u * 1.14, u * .42);
    glUniform4f(glc->uColor, .72f, .53f, .18f, a);
    glSolidDev(cx - u * 1.18, bottom - u * .96, u * .92, u * .72);
    glUniform4f(glc->uColor, .37f, .43f, .44f, a);
    for (int barrel = 0; barrel < 3; barrel++)
      glSolidDev(cx - u * .10, bottom - u * (1.36 - barrel * .28), u * 1.72, u * .16);
    glUniform4f(glc->uColor, .12f, .15f, .17f, a);
    glSolidDev(cx + u * .18, bottom - u * 1.46, u * .24, u * 1.04);
    glSolidDev(cx + u * .72, bottom - u * 1.46, u * .24, u * 1.04);
    glUniform4f(glc->uColor, 1.0f, .52f, .08f, a);
    glSolidDev(cx + u * 1.48, bottom - u * 1.19, u * .34, u * .34);
    glUniform4f(glc->uColor, .12f, .16f, .18f, a);
    glSolidDev(cx - u * .76, bottom - u * .50, u * .54, u * .64);
    return;
  }
  if (kind == IT_ITEM && itemKind == IK_RESCUE_BEAM) {
    double u = glCellDev;
    double bottom = (py + bob - camRow) * u + glOffY;
    glUniform4f(glc->uColor, .08f, .20f, .24f, a);
    glSolidDev(cx - u * 1.35, bottom - u * 1.20, u * 2.70, u * .72);
    glUniform4f(glc->uColor, .28f, .94f, .90f, a);
    glSolidDev(cx - u * .72, bottom - u * 1.02, u * 1.65, u * .28);
    glUniform4f(glc->uColor, .65f, 1.0f, .96f, a);
    glSolidDev(cx + u * 1.12, bottom - u * 1.28, u * .48, u * .88);
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
      glDrawOneItem((int)it[IS_ID], (int)it[IS_KIND], (int)it[IS_ITEM_KIND], (int)it[IS_MATERIAL], (int)it[IS_COUNT], (int)it[IS_TOOL_TIER], it[IS_X], it[IS_Y], (int)it[IS_LIFE], camCol, camRow);
    }
    return;
  }
  if (E.itemsys.items.empty()) return;
  glUniform1i(glc->uMode, 1);
  glUniform1i(glc->uGutter, 0);
  for (auto& it : E.itemsys.items) glDrawOneItem(it.id, it.kind, it.itemKind, it.material, it.count, it.toolTier, it.px, it.py, it.life, camCol, camRow);
}

void GLPresenter::glDrawProjectiles() {
  const std::vector<float>* external = glUseExtProjectiles ? &glExtProjectiles : nullptr;
  int n = external ? (int)(external->size() / PRS_STRIDE) : (int)E.projectiles.projectiles.size();
  if (!n) return;
  glUniform1i(glc->uMode, 1); glUniform1i(glc->uGutter, 0);
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  for (int i = 0; i < n; i++) {
    double x, y, vx, vy, charge, fuse, rotation; int kind;
    if (external) {
      const float* p = external->data() + i * PRS_STRIDE;
      x=p[PRS_X]; y=p[PRS_Y]; vx=p[PRS_VX]; vy=p[PRS_VY]; charge=p[PRS_CHARGE];
      kind=(int)p[PRS_KIND]; fuse=p[PRS_FUSE]; rotation=p[PRS_ROTATION];
    } else {
      const Projectile& p=E.projectiles.projectiles[i];
      x=p.px; y=p.py; vx=p.vx; vy=p.vy; charge=p.charge;
      kind=p.kind; fuse=p.fuse; rotation=p.rotation;
    }
    double cx=(x-camCol)*glCellDev+glOffX, cy=(y-camRow)*glCellDev+glOffY;
    if (kind == PK_BORE_BEAM) {
      double speed = std::hypot(vx, vy);
      if (speed < 1e-6) continue;
      double dx = vx / speed, dy = vy / speed;
      double length = 1e9;
      if (dx > 1e-9) length = std::min(length, (E.cols - 2.0 - x) / dx);
      else if (dx < -1e-9) length = std::min(length, (1.0 - x) / dx);
      if (dy > 1e-9) length = std::min(length, (E.rows - 2.0 - y) / dy);
      else if (dy < -1e-9) length = std::min(length, (1.0 - y) / dy);
      if (!std::isfinite(length) || length <= 0) continue;
      int samples = imax(1, (int)std::ceil(length / 1.35));
      for (int sample = 0; sample <= samples; sample++) {
        double t = length * sample / samples;
        double bx = (x + dx * t - camCol) * glCellDev + glOffX;
        double by = (y + dy * t - camRow) * glCellDev + glOffY;
        double outer = glCellDev * (CREATURE_BORE_RADIUS * 2.0 + .35);
        glUniform4f(glc->uColor, .95f, .18f, .055f, .40f);
        glSolidDev(bx - outer * .5, by - outer * .5, outer, outer);
        glUniform4f(glc->uColor, 1.0f, .88f, .34f, .96f);
        glSolidDev(bx - glCellDev * .68, by - glCellDev * .68, glCellDev * 1.36, glCellDev * 1.36);
      }
      continue;
    }
    if (kind == PK_EXTRACTION_BEAM) {
      double cell = glCellDev;
      double progress = std::max(0.0, std::min(1.0, charge));
      glUniform4f(glc->uColor, .18f, .9f, .82f, (float)(.06 + progress * .14));
      glSolidDev(cx - 14 * cell, cy - 38 * cell, 28 * cell, 38 * cell);
      for (int ring = 0; ring < 4; ring++) {
        double rise = std::fmod(E.actorTick * (.08 + progress * .12) + ring * 9.5, 38.0);
        double width = (14 - rise * .12) * cell;
        glUniform4f(glc->uColor, .45f, 1.0f, .88f, (float)((1 - rise / 38) * .65));
        glSolidDev(cx - width, cy - rise * cell, width * 2, cell * .3);
        glSolidDev(cx - width, cy - rise * cell - cell, cell * .35, 2 * cell);
        glSolidDev(cx + width, cy - rise * cell - cell, cell * .35, 2 * cell);
      }
      glUniform4f(glc->uColor, .1f, .26f, .25f, 1);
      glSolidDev(cx - 14 * cell, cy, 28 * cell, cell * .65);
      glUniform4f(glc->uColor, .65f, 1.0f, .92f, 1);
      glSolidDev(cx - 14 * cell, cy, 28 * cell * progress, cell * .65);
      continue;
    }
    if (kind == PK_RESCUE_BEAM) {
      double speed = std::hypot(vx, vy);
      if (speed < 1e-6 || charge <= 0) continue;
      double dx = vx / speed, dy = vy / speed;
      int samples = imax(1, (int)std::ceil(charge / 1.15));
      for (int sample = 0; sample <= samples; sample++) {
        double t = charge * sample / samples;
        double bx = (x + dx * t - camCol) * glCellDev + glOffX;
        double by = (y + dy * t - camRow) * glCellDev + glOffY;
        double pulse = ((sample + E.actorTick) & 2) ? .52 : .72;
        glUniform4f(glc->uColor, .08f, .72f, .72f, .48f);
        glSolidDev(bx - glCellDev * pulse * .5,
                   by - glCellDev * pulse * .5,
                   glCellDev * pulse, glCellDev * pulse);
        glUniform4f(glc->uColor, .68f, 1.0f, .94f, .96f);
        glSolidDev(bx - glCellDev * .18, by - glCellDev * .18,
                   glCellDev * .36, glCellDev * .36);
      }
      continue;
    }
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
      double dc = glCellDev * 1.4;
      double ax = std::cos(rotation), ay = std::sin(rotation), pxn = -ay, pyn = ax;
      for (int stick = -1; stick <= 1; stick++) for (int seg = -1; seg <= 1; seg++) {
        double px = cx + ax * seg * dc * .32 + pxn * stick * dc * .28;
        double py = cy + ay * seg * dc * .32 + pyn * stick * dc * .28;
        glUniform4f(glc->uColor, stick == 0 ? .82f : .62f, .08f, .055f, 1);
        glSolidDev(px - dc * .23, py - dc * .23, dc * .46, dc * .46);
      }
      glUniform4f(glc->uColor, .16f, .12f, .10f, 1);
      glSolidDev(cx - dc * .48, cy - dc * .10, dc * .96, dc * .20);
      double fx = cx + ax * dc * 1.15, fy = cy + ay * dc * 1.15;
      glUniform4f(glc->uColor, ((int)fuse / 3) & 1 ? 1.0f : .92f, ((int)fuse / 3) & 1 ? .82f : .28f, .04f, 1);
      glSolidDev(fx - dc * .25, fy - dc * .25, dc * .50, dc * .50);
      continue;
    }
    if (kind == PK_ACID_SHELL) {
      double u = glCellDev, ax = std::cos(rotation), ay = std::sin(rotation);
      double pxn = -ay, pyn = ax;
      double scale = std::max(.75, std::min(2.0, charge));
      for (int trail = 1; trail <= 6; trail++) {
        double fade = (7 - trail) / 7.0;
        double tx = cx - ax * trail * u * (.315 * scale)
          + pxn * ((trail & 1) ? .11 : -.11) * scale * u;
        double ty = cy - ay * trail * u * (.315 * scale)
          + pyn * ((trail & 1) ? .11 : -.11) * scale * u;
        glUniform4f(glc->uColor, .48f, .92f, .12f, .16f + .42f * fade);
        double drop = u * scale * (.11 + .17 * fade);
        glSolidDev(tx - drop * .5, ty - drop * .5, drop, drop);
      }
      glUniform4f(glc->uColor, .10f, .16f, .10f, 1);
      glSolidDev(cx - u * .69 * scale, cy - u * .50 * scale,
                 u * 1.38 * scale, u * scale);
      glUniform4f(glc->uColor, .37f, .68f, .16f, 1);
      glSolidDev(cx - u * .50 * scale, cy - u * .37 * scale,
                 u * scale, u * .74 * scale);
      glUniform4f(glc->uColor, .72f, 1.0f, .27f, 1);
      glSolidDev(cx - u * .255 * scale, cy - u * .23 * scale,
                 u * .51 * scale, u * .46 * scale);
      glUniform4f(glc->uColor, .89f, 1.0f, .48f, 1);
      glSolidDev(cx - u * .11 * scale, cy - u * .11 * scale,
                 u * .22 * scale, u * .22 * scale);
      glUniform4f(glc->uColor, .18f, .25f, .15f, 1);
      glSolidDev(cx + ax * u * .55 * scale - u * .205 * scale,
                 cy + ay * u * .55 * scale - u * .205 * scale,
                 u * .41 * scale, u * .41 * scale);
      continue;
    }
    if (kind == PK_CLUSTER_BOMB) {
      double u = glCellDev, ax = std::cos(rotation), ay = std::sin(rotation);
      double pxn = -ay, pyn = ax;
      if (charge < .5) {
        for (int trail = 1; trail <= 6; trail++) {
          float fade = (6 - trail) / 6.0f;
          double tx = cx - ax * trail * u * .42, ty = cy - ay * trail * u * .42;
          glUniform4f(glc->uColor, 1.0f, .38f, .055f, .14f + .34f * fade);
          double s = u * (.14 + .22 * fade);
          glSolidDev(tx - s * .5, ty - s * .5, s, s);
        }
        glUniform4f(glc->uColor, .08f, .13f, .21f, 1);
        glSolidDev(cx - u * 1.24, cy - u * .88, u * 2.48, u * 1.76);
        glUniform4f(glc->uColor, .27f, .46f, .67f, 1);
        glSolidDev(cx - u * .88, cy - u * .61, u * 1.76, u * 1.22);
        glUniform4f(glc->uColor, .10f, .17f, .25f, 1);
        glSolidDev(cx - u * .19, cy - u * .80, u * .38, u * 1.60);
        glUniform4f(glc->uColor, .96f, .47f, .08f, 1);
        glSolidDev(cx + ax * u * .92 - u * .33, cy + ay * u * .92 - u * .33, u * .66, u * .66);
        for (int side : {-1, 1}) {
          double fx = cx - ax * u * .42 + pxn * side * u * 1.02;
          double fy = cy - ay * u * .42 + pyn * side * u * 1.02;
          glSolidDev(fx - u * .24, fy - u * .24, u * .48, u * .48);
        }
      } else {
        // Split children are deliberately literal mini dynamite sticks. Their
        // independently randomized rotations make the sixteen-way burst obvious
        // even before their staggered fuses reach zero.
        double pulse = (((int)fuse / 3) & 1) ? 1.0 : .70;
        for (int seg = -2; seg <= 2; seg++) {
          double sx = cx + ax * seg * u * .25;
          double sy = cy + ay * seg * u * .25;
          glUniform4f(glc->uColor, .76f * pulse, .075f, .045f, 1);
          glSolidDev(sx - u * .25, sy - u * .25, u * .50, u * .50);
        }
        glUniform4f(glc->uColor, .12f, .10f, .09f, 1);
        for (int side = -1; side <= 1; side++) {
          double bx = cx + pxn * side * u * .22;
          double by = cy + pyn * side * u * .22;
          glSolidDev(bx - u * .17, by - u * .17, u * .34, u * .34);
        }
        double fx = cx + ax * u * 1.48, fy = cy + ay * u * 1.48;
        glUniform4f(glc->uColor, 1.0f, .78f, .18f, 1);
        glSolidDev(fx - u * .23, fy - u * .23, u * .46, u * .46);
        glUniform4f(glc->uColor, 1.0f, .28f, .035f, .88f);
        glSolidDev(fx - u * .36, fy - u * .36, u * .72, u * .72);
      }
      continue;
    }
    if (kind == PK_MINIGUN_ROUND) {
      // The physical round is intentionally tiny; a sparse eight-segment hot tracer
      // keeps very fast shots readable without implying a larger blast radius.
      double u = glCellDev;
      double speed = std::max(.001, std::hypot(vx, vy));
      double nx = vx / speed, ny = vy / speed;
      for (int s = 1; s <= 8; s++) {
        float fade = (9 - s) / 8.0f;
        double tx = cx - nx * s * u * .62;
        double ty = cy - ny * s * u * .62;
        double size = u * (.10 + .15 * fade);
        glUniform4f(glc->uColor, 1.0f, .34f + .50f * fade, .055f, .12f + .70f * fade);
        glSolidDev(tx - size * .5, ty - size * .5, size, size);
      }
      glUniform4f(glc->uColor, 1.0f, .82f, .26f, 1);
      glSolidDev(cx - u * .24, cy - u * .24, u * .48, u * .48);
      glUniform4f(glc->uColor, 1.0f, 1.0f, .79f, 1);
      glSolidDev(cx - u * .10, cy - u * .10, u * .20, u * .20);
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

// Animal and combat sprites use a wide 13x7 canvas for readable tails, weapons,
// fins, and wings. Human NPCs use a shared upright 9x10 silhouette with each
// character's own six-color palette.
void GLPresenter::glDrawOneCreature(int speciesId, double px, double py, int facing, int health, int maxHealth,
                    int alive, int animFrame, int attackState, int attackPattern,
                    double attackProgress,
                    double aimX, double aimY, double spawnProgress,
                    double rescueProgress, int hurtCooldown, double shelterCharge, float light,
                    int camCol, int camRow) {
  if (speciesId < 0 || speciesId >= CS_COUNT) return;
  const CreatureSpecies& speciesDef = CREATURE_SPECIES[(size_t)speciesId];
  const CreatureBehaviorProfileDef& behavior = creatureBehavior(speciesDef);
  const auto& art = E.content.creatureArt[(size_t)speciesId];
  if (!art.width || !art.height) return;
  bool humanNpc = speciesDef.humanNpc;
  const double sw = art.width * art.scale, sh = art.height * art.scale;
  double cell = glCellDev;
  if (spawnProgress > 0) {
    // A deterministic pixel breach: two counter-rotating broken rings tighten
    // around the reserved habitat while sparks converge on the future body.
    // Pending records return here, so they never draw a corpse/hitbox and remain
    // visually distinct from a materialized, damageable creature.
    double progress = std::max(0.0, std::min(1.0, spawnProgress));
    double cx = (px + CREATURE_SPECIES[speciesId].w * .5 - camCol) * cell + glOffX;
    double cy = (py + CREATURE_SPECIES[speciesId].h * .5 - camRow) * cell + glOffY;
    double phase = progress * 9.42477796076938;
    for (int ring = 0; ring < 2; ring++) {
      double rx = cell * (CREATURE_SPECIES[speciesId].w * (.63 + ring * .18) +
                          (1.0 - progress) * (3.4 + ring));
      double ry = cell * (CREATURE_SPECIES[speciesId].h * (.70 + ring * .19) +
                          (1.0 - progress) * (2.2 + ring * .6));
      for (int segment = 0; segment < 24; segment++) {
        if (((segment + ring * 2 + (int)(progress * 24)) % 5) == 0) continue;
        double a = segment * 6.283185307179586 / 24.0 +
          (ring ? -phase : phase) * .18;
        double x = cx + std::cos(a) * rx, y = cy + std::sin(a) * ry;
        double size = cell * (.30 + progress * .23 + ring * .08);
        float alpha = (float)(.34 + progress * .46 - ring * .10);
        glUniform4f(glc->uColor, .52f * alpha, .20f * alpha,
                    1.0f * alpha, alpha);
        glSolidDev(x - size * .5, y - size * .5, size, size);
      }
    }
    for (int spark = 0; spark < 7; spark++) {
      double a = spark * 2.399963229728653 + phase * .31;
      double radius = cell * (1.1 + (1.0 - progress) * (5.4 + (spark % 3)));
      double size = cell * (.22 + progress * .24);
      double x = cx + std::cos(a) * radius, y = cy + std::sin(a) * radius;
      float alpha = (float)(.42 + progress * .48);
      glUniform4f(glc->uColor, .28f * alpha, .86f * alpha,
                  1.0f * alpha, alpha);
      glSolidDev(x - size * .5, y - size * .5, size, size);
    }
    double slitW = std::max(cell * .20, cell * progress * 1.15);
    double slitH = cell * (1.0 + progress * CREATURE_SPECIES[speciesId].h * .70);
    glUniform4f(glc->uColor, .74f, .94f, 1.0f, .86f);
    glSolidDev(cx - slitW * .5, cy - slitH * .5, slitW, slitH);
    return;
  }
  if (alive && behavior.weaponOverlay == CWO_MINIGUN && attackState == CAS_CHARGING) {
    double ox = px + speciesDef.w * .56, oy = py + speciesDef.h * .48;
    double dx = aimX - ox, dy = aimY - oy;
    int samples = imin(28, imax(2, (int)(std::hypot(dx, dy) / 3)));
    for (int i = 1; i <= samples; i++) {
      double t = i / (double)samples;
      glUniform4f(glc->uColor, 1, .65f, .15f, (float)(.18 + attackProgress * .38));
      glSolidDev((ox + dx * t - camCol) * cell + glOffX,
                 (oy + dy * t - camRow) * cell + glOffY, .3 * cell, .3 * cell);
    }
  }
  bool bossBore = (behavior.telegraph == CTH_QUARRY
                   || behavior.telegraph == CTH_WARDEN) && attackPattern == 2;
  if (alive && (behavior.telegraph == CTH_BORE || bossBore) &&
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
  if (alive && behavior.telegraph == CTH_MORTAR &&
      (attackState == CAS_CHARGING || attackState == CAS_FIRING)) {
    double ox = px + CREATURE_SPECIES[speciesId].w * .60;
    double oy = py + CREATURE_SPECIES[speciesId].h * .28;
    double dx = aimX - ox, dy = aimY - oy;
    double dist = std::hypot(dx, dy);
    double progress = std::max(0.0, std::min(1.0, attackProgress));
    double lift = std::max(5.0, std::min(16.0, dist * .20));
    int samples = imax(10, (int)std::ceil(dist / 3.0));
    for (int i = 0; i <= samples; i++) {
      double t = i / (double)samples;
      double wx = ox + dx * t;
      double wy = oy + dy * t - std::sin(t * 3.141592653589793) * lift;
      double bx = (wx - camCol) * cell + glOffX;
      double by = (wy - camRow) * cell + glOffY;
      double pulse = .14 + progress * .34;
      if (attackState == CAS_FIRING) pulse = .72;
      double size = cell * (.18 + progress * .22);
      glUniform4f(glc->uColor, .55f, 1.0f, .12f, (float)pulse);
      glSolidDev(bx - size * .5, by - size * .5, size, size);
    }
    // The landing reticle expands into the acid splash footprint, making the
    // danger readable even when the arc passes above the viewport.
    double targetX = (aimX - camCol) * cell + glOffX;
    double targetY = (aimY - camRow) * cell + glOffY;
    double radius = cell * (1.4 + progress * 2.2);
    glUniform4f(glc->uColor, .62f, 1.0f, .16f,
                attackState == CAS_FIRING ? .82f : (float)(.22 + progress * .40));
    glSolidDev(targetX - radius, targetY - cell * .14, radius * 2.0, cell * .28);
    glSolidDev(targetX - cell * .14, targetY - radius * .48, cell * .28, radius * .96);
    if (attackState == CAS_FIRING) {
      glUniform4f(glc->uColor, .82f, 1.0f, .34f, .95f);
      glSolidDev((ox - camCol) * cell + glOffX - cell * .55,
                 (oy - camRow) * cell + glOffY - cell * .55, cell * 1.10, cell * 1.10);
    }
  }
  if (alive && behavior.telegraph == CTH_CLUSTER &&
      (attackState == CAS_CHARGING || attackState == CAS_FIRING)) {
    double ox = px + CREATURE_SPECIES[speciesId].w * .58;
    double oy = py + CREATURE_SPECIES[speciesId].h * .55;
    double dx = aimX - ox, dy = aimY - oy, dist = std::hypot(dx, dy);
    double progress = std::max(0.0, std::min(1.0, attackProgress));
    int samples = imax(4, (int)std::ceil(dist / (3.4 - progress * 1.4)));
    for (int i = 0; i <= samples; i++) {
      if ((i & 1) && attackState != CAS_FIRING) continue;
      double t = i / (double)samples;
      double bx = (ox + dx * t - camCol) * cell + glOffX;
      double by = (oy + dy * t - camRow) * cell + glOffY;
      double size = cell * (.16 + progress * .26);
      glUniform4f(glc->uColor, 1.0f, .48f + .34f * (float)progress, .08f,
                  attackState == CAS_FIRING ? .86f : (float)(.18 + progress * .45));
      glSolidDev(bx - size * .5, by - size * .5, size, size);
    }
    // Four corner brackets communicate the carrier's cluster radius without
    // covering the player at the center of the target.
    double tx = (aimX - camCol) * cell + glOffX;
    double ty = (aimY - camRow) * cell + glOffY;
    double r = cell * (2.2 + progress * 1.4), arm = cell * .72;
    glUniform4f(glc->uColor, 1.0f, .62f, .12f,
                attackState == CAS_FIRING ? .90f : (float)(.24 + progress * .45));
    for (int sxSign : {-1, 1}) for (int sySign : {-1, 1}) {
      double bx = tx + sxSign * r, by = ty + sySign * r;
      glSolidDev(bx - (sxSign < 0 ? 0 : arm), by - cell * .11, arm, cell * .22);
      glSolidDev(bx - cell * .11, by - (sySign < 0 ? 0 : arm), cell * .22, arm);
    }
  }
  if (alive && behavior.telegraph == CTH_QUARRY && attackPattern == 1 &&
      attackState == CAS_CHARGING) {
    double progress = std::max(0.0, std::min(1.0, attackProgress));
    double cx = (px + CREATURE_SPECIES[speciesId].w * .5 - camCol) * cell + glOffX;
    double cy = (py + CREATURE_SPECIES[speciesId].h - camRow) * cell + glOffY;
    for (int ring = 0; ring < 3; ring++) {
      double radius = cell * (2.5 + ring * 2.4 + progress * 3.2);
      glUniform4f(glc->uColor, 1.0f, .43f + ring * .12f, .08f,
                  (float)(.18 + progress * .34));
      glSolidDev(cx - radius, cy - cell * .12, radius * 2, cell * .24);
      glSolidDev(cx - cell * .12, cy - radius * .20, cell * .24, radius * .40);
    }
  }
  if (alive && behavior.telegraph == CTH_WARDEN && attackPattern == 1 &&
      (attackState == CAS_CHARGING || attackState == CAS_FIRING)) {
    double progress = std::max(0.0, std::min(1.0, attackProgress));
    double cx = (px + CREATURE_SPECIES[speciesId].w * .5 - camCol) * cell + glOffX;
    double cy = (py + CREATURE_SPECIES[speciesId].h * .45 - camRow) * cell + glOffY;
    for (int spark = 0; spark < 8; spark++) {
      double angle = spark * .785398 + E.actorTick * .08;
      double radius = cell * (1.8 + progress * 2.2);
      double size = cell * (.24 + progress * .22);
      glUniform4f(glc->uColor, spark & 1 ? .36f : 1.0f,
                  spark & 1 ? .92f : .42f, .94f,
                  (float)(.38 + progress * .42));
      glSolidDev(cx + std::cos(angle) * radius - size * .5,
                 cy + std::sin(angle) * radius - size * .5, size, size);
    }
  }
  double sx = (px - camCol) * cell + glOffX - (sw - CREATURE_SPECIES[speciesId].w) * 0.5 * cell;
  double sy = humanNpc
    ? (py + CREATURE_SPECIES[speciesId].h - sh - camRow) * cell + glOffY
    : (py - camRow) * cell + glOffY
      - (sh - CREATURE_SPECIES[speciesId].h) * 0.5 * cell;
  int frame = speciesDef.stationaryCycle
    ? (int)((E.actorTick / 8) & 3)
    : animFrame & 3;
  // A little whole-sprite follow-through keeps the detailed limbs from feeling
  // like a flipbook pasted to the AABB. Walkers rise on their passing steps,
  // swimmers roll gently, and the downstroke gives the bird visible lift.
  if (alive) {
    if (speciesDef.renderBob == CRB_BIRD) sy += (frame == 0 ? -0.35 : frame == 2 ? 0.20 : 0.0) * cell;
    else if (speciesDef.renderBob == CRB_WASP) sy += (frame == 0 ? -0.28 : frame == 2 ? 0.16 : 0.0) * cell;
    else if (speciesDef.renderBob == CRB_AQUATIC) sy += (frame == 1 ? -0.12 : frame == 3 ? 0.12 : 0.0) * cell;
    else if (speciesDef.renderBob == CRB_WALKER && (frame & 1)) sy -= 0.10 * cell;
  }
  if (alive && CREATURE_SPECIES[speciesId].locomotion == CL_AMPHIBIOUS) {
    double shadowY = (py - camRow + CREATURE_SPECIES[speciesId].h) * cell + glOffY - 0.16 * cell;
    double shadowW = humanNpc ? 5.0 : 7.0;
    glUniform4f(glc->uColor, 8/255.f * light, 10/255.f * light, 14/255.f * light, 0.24f);
    glSolidDev(sx + (sw - shadowW) * .5 * cell, shadowY,
               shadowW * cell, std::max(1.0, 0.30 * cell));
  }
  if (alive && CREATURE_SPECIES[speciesId].hostile) {
    double windup = attackState == CAS_CHARGING ? attackProgress : 0;
    sy += windup * .45 * cell;
    sx -= facing * windup * .35 * cell;
    if (attackState == CAS_FIRING) sx -= facing * ((E.actorTick & 1) ? .35 : .12) * cell;
    if (windup > .1) {
      glUniform4f(glc->uColor, 1, .72f, .18f, (float)(.4 + windup * .6));
      glSolidDev(sx + sw * cell * .5 - .2 * cell, sy - 3.5 * cell, .4 * cell, 1.4 * cell);
      glSolidDev(sx + sw * cell * .5 - .2 * cell, sy - 1.7 * cell, .4 * cell, .4 * cell);
    }
  }
  if (shelterCharge > 0) {
    double charge = std::min(1.0, shelterCharge);
    double width = (sw + 3) * cell, height = (sh + 4) * cell * charge;
    double left = sx - 1.5 * cell, top = sy + sh * cell - height;
    glUniform4f(glc->uColor, .2f, .76f, .9f, .12f);
    glSolidDev(left, top, width, height);
    glUniform4f(glc->uColor, .45f, .94f, 1, .8f);
    glSolidDev(left, top, .25 * cell, height);
    glSolidDev(left + width - .25 * cell, top, .25 * cell, height);
    glSolidDev(left, top, width, .35 * cell);
    for (int row = 0; row < 6; row++) {
      double scan = std::fmod(row / 6.0 + E.actorTick * .003, 1.0);
      glUniform4f(glc->uColor, .4f, .92f, 1, .25f);
      glSolidDev(left, top + scan * height, width, .16 * cell);
    }
    glUniform4f(glc->uColor, charge < 1 ? .5f : 1, charge < 1 ? 1 : .62f, .2f, 1);
    glSolidDev(left + width * .5 - cell, top - cell, 2 * cell, .6 * cell);
  }
  bool departing = rescueProgress >= 1;
  double departure = departing ? std::min(1.0, rescueProgress - 1) : 0;
  if (departing) sy -= departure * departure * 16 * cell;
  if (rescueProgress > 0) {
    frame = 3;
    double scanY = sy + sh * cell * (1.0 - std::fmod(rescueProgress * 3, 1.0));
    glUniform4f(glc->uColor, .36f, 1.0f, .88f, .8f);
    glSolidDev(sx - cell, scanY, (sw + 2) * cell, cell * .3);
    if (!departing) {
      glUniform4f(glc->uColor, .02f, .09f, .12f, .9f);
      glSolidDev(sx, sy - 2.5 * cell, sw * cell, cell);
      glUniform4f(glc->uColor, .36f, 1.0f, .88f, 1);
      glSolidDev(sx, sy - 2.5 * cell, sw * cell * rescueProgress, cell);
    }
    for (int spark = 0; spark < 8; spark++) {
      double phase = std::fmod(E.actorTick * .04 + spark * .618, 1.0);
      double xx = sx + (spark % 3) * sw * cell * .5;
      glUniform4f(glc->uColor, .6f, 1.0f, .92f, (float)((1 - phase) * .8));
      glSolidDev(xx, sy + (sh - phase * (sh + 6)) * cell, cell * .4, cell * .7);
    }
  }
  double pixelH = (alive || departing) ? cell : cell * 0.42;
  double corpseBase = sy + sh * cell;
  for (int r = 0; r < art.height; r++) for (int c = 0; c < art.width; c++) {
    int idx = art.pixels[(frame * art.height + r) * art.width + c];
    if (idx <= 0 || idx >= (int)art.palette.size()) continue;
    int cc = facing >= 0 ? c : art.width - 1 - c;
    const float* col = art.palette[(size_t)idx].data();
    if (departing && ((r * 7 + c * 13) % 23) / 23.0 < departure) continue;
    float fade = (alive || departing) ? 1.0f : 0.55f;
    float flash = hurtCooldown > 0 && alive ? .6f : 0;
    float beamTint = (float)std::min(1.0, rescueProgress) * .65f;
    glUniform4f(glc->uColor,
      col[0] * fade * light * (1 - flash) + flash,
      col[1] * fade * light * (1 - flash - beamTint * .5f) + flash + beamTint * .5f,
      col[2] * fade * light * (1 - flash - beamTint * .5f) + flash + beamTint * .5f,
      col[3] * (float)(1 - departure));
    double drawY = (alive || departing) ? sy + r * cell * art.scale : corpseBase - (art.height - r) * pixelH * art.scale;
    glSolidDev(sx + cc * cell * art.scale, drawY, cell * art.scale, pixelH * art.scale);
  }
  if (alive && behavior.weaponOverlay == CWO_MINIGUN) {
    // Draw the active weapon over the body sprite so its grip remains attached
    // while the barrel pack follows the authoritative target in both axes.
    double gunX = px + CREATURE_SPECIES[speciesId].w * .56;
    if (attackState == CAS_FIRING) gunX -= facing * ((E.actorTick & 1) ? .35 : .12);
    double gunY = py + CREATURE_SPECIES[speciesId].h * .48;
    bool tracking = attackState == CAS_CHARGING || attackState == CAS_FIRING;
    double dx = tracking ? aimX - gunX : (double)facing;
    double dy = tracking ? aimY - gunY : 0.0;
    double d = std::hypot(dx, dy);
    if (d < 1e-6) { dx = facing; dy = 0; d = 1; }
    dx /= d; dy /= d;
    double nx = -dy, ny = dx;
    gunX += dx * .55;
    gunY += dy * .55;
    auto gunPixel = [&](double forward, double side, double size,
                        float r, float g, float b, float a = 1.0f) {
      double wx = gunX + dx * forward + nx * side;
      double wy = gunY + dy * forward + ny * side;
      double bx = (wx - camCol) * cell + glOffX;
      double by = (wy - camRow) * cell + glOffY;
      glUniform4f(glc->uColor, r * light, g * light, b * light, a);
      glSolidDev(bx - size * cell * .5, by - size * cell * .5, size * cell, size * cell);
    };
    gunPixel(-.42, 0, 1.06, .08f, .12f, .16f);
    gunPixel(-.02, 0, .92, .24f, .32f, .36f);
    gunPixel(-.28, .62, 1.16, .12f, .17f, .20f);
    gunPixel(-.28, .62, .72, .76f, .57f, .19f);
    int rotorRate = attackState == CAS_FIRING ? 2 : 6;
    int rotor = tracking ? (E.actorTick / rotorRate + animFrame) % 3 : 0;
    for (int barrel = 0; barrel < 3; barrel++) {
      float shine = barrel == rotor ? .72f : .38f;
      for (int seg = 0; seg < 8; seg++)
        gunPixel(.42 + seg * .42, (barrel - 1) * .34, .27,
                 shine, shine * .88f, shine * .67f);
    }
    for (int brace = 0; brace < 4; brace++)
      gunPixel(.66 + brace * .75, 0, .18, .09f, .12f, .14f);
    gunPixel(3.50, 0, .60, .17f, .21f, .22f);
    if (attackState == CAS_FIRING) {
      float flash = ((E.actorTick + animFrame) & 1) ? 1.0f : .72f;
      gunPixel(3.86, 0, .66, 1.0f, .42f * flash, .04f, .95f);
      gunPixel(4.18, 0, .38, 1.0f, .92f, .35f, .98f);
      gunPixel(3.92, -.50, .28, 1.0f, .62f, .08f, .82f);
      gunPixel(3.92, .50, .28, 1.0f, .62f, .08f, .82f);
    }
  }
  // A segmented, hard-edged health bar appears only after damage (or during
  // death), matching the survival HUD without adding noise to ambient mobs.
  if (!departing && maxHealth > 0 && health < maxHealth) {
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
                        (int)c[CSN_ATTACK_STATE], (int)c[CSN_ATTACK_PATTERN],
                        c[CSN_ATTACK_PROGRESS], c[CSN_AIM_X], c[CSN_AIM_Y],
                        c[CSN_SPAWN_PROGRESS], c[CSN_RESCUE_PROGRESS], (int)c[CSN_HURT_COOLDOWN], c[CSN_SHELTER_CHARGE],
                        glActorLight(c[CSN_X], c[CSN_Y], (int)c[CSN_W], (int)c[CSN_H]), camCol, camRow);
    }
  } else {
    for (const Creature& c : E.creatures.creatures) {
      const CreatureSpecies& s = E.creatures.species(c);
      glDrawOneCreature(c.species, c.wx - E.fg.worldOffsetX, c.wy - E.fg.worldOffsetY, c.facing, c.health,
                        s.maxHealth, c.alive ? 1 : 0, c.animFrame, c.attackState,
                        c.attackPattern, c.attackProgress,
                        c.attackAimX - E.fg.worldOffsetX, c.attackAimY - E.fg.worldOffsetY,
                        c.spawnProgress, c.rescueProgress, c.hurtCooldown, c.shelterCharge,
                        glActorLight(c.wx - E.fg.worldOffsetX, c.wy - E.fg.worldOffsetY, s.w, s.h),
                        camCol, camRow);
    }
    for (const CreatureSpawnTelegraph& p : E.creatures.pendingSpawns) {
      const CreatureSpecies& s = CREATURE_SPECIES[p.species];
      int elapsed = p.totalTicks - p.ticksRemaining;
      double progress = std::max(1.0 / p.totalTicks,
        std::min(1.0, (elapsed + 1.0) / p.totalTicks));
      double x = p.wx - E.fg.worldOffsetX, y = p.wy - E.fg.worldOffsetY;
      glDrawOneCreature(p.species, x, y, 1, 0, s.maxHealth, 0, 0,
                        CAS_IDLE, 0, 0, x, y, progress, 0, 0, 0,
                        glActorLight(x, y, s.w, s.h), camCol, camRow);
    }
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
  // The structural draft previews in its exact material color.
  if (!E.tools.draft.empty()) {
    uint32_t c = MAT_COLOR[E.tools.draftMaterial];
    float r = (c & 0xff) / 255.0f, g = ((c >> 8) & 0xff) / 255.0f, b = ((c >> 16) & 0xff) / 255.0f;
    glUniform4f(glc->uColor, df * r, df * g, df * b, 0.42f);
    for (int k : E.tools.draft) { int y = k / E.cols; cell(k - y * E.cols, y); }
  }
  if (E.tools.draftingSeed && E.tools.hasSeedOrigin) {
    bool valid = E.tools.canPlaceSeedAt(E.tools.seedOriginX, E.tools.seedOriginY);
    if (valid) glUniform4f(glc->uColor, df * 120 / 255.0f, df * 190 / 255.0f, df * 100 / 255.0f, 0.32f);
    else       glUniform4f(glc->uColor, 255 / 255.0f, 80 / 255.0f, 80 / 255.0f, 0.24f);
    cell(E.tools.seedOriginX, E.tools.seedOriginY); // a seed is a single cell
  }

  // Survival: a "cursor" footprint at the local player's aim shows where the tool
  // will act and into which layer — LMB foreground (bright), RMB background (dim),
  // dig/erase red. Faded when out of reach. While a hold-mine is locked, the
  // overlay sticks to mineX/mineY (not the live aim) so it matches dig damage.
  if (E.cam.playModeOn && glOwnPlayerId) {
    // Browser/worker play always supplies the authority-derived preview policy.
    // `off` is meaningful there: the held item is a weapon (or the player is
    // dead), so do not fall back to a tool cursor.
    if (glUseExtPlayers && !glSurvivalPreviewOn) return;
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
        fp = &E.tools.getSurvivalFootprint(glSurvivalPreviewFootprint);
        if (glSurvivalPreviewLocked) { ax = glSurvivalPreviewX; ay = glSurvivalPreviewY; }
      } else if (E.survivalInventory) {
        const InvSlot& sel = lp->inv[lp->selectedSlot];
        if (sel.count > 0 && sel.itemKind != IK_MATERIAL && sel.itemKind != IK_MINING_TOOL) return;
        erasing = sel.isTool || sel.count <= 0;
        fp = &E.tools.getSurvivalFootprint(*lp);
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
      if (erasing)   glUniform4f(glc->uColor, .28f, .9f, 1.0f, a * .55f);
      else if (toBg) glUniform4f(glc->uColor, 120 / 255.0f, 140 / 255.0f, 170 / 255.0f, a);
      else           glUniform4f(glc->uColor, 180 / 255.0f, 215 / 255.0f, 255 / 255.0f, a);
      if (fp) {
        for (const SurvivalFootprintCell& o : fp->cells) cell(ax + (int)o.ox, ay + (int)o.oy);
      } else {
        int r = erasing ? P_MINE_R : P_BUILD_R;
        for (int oy = -r; oy <= r; oy++) for (int ox = -r; ox <= r; ox++) { if (ox * ox + oy * oy > r * r) continue; cell(ax + ox, ay + oy); }
      }
      bool mineLocked = glSurvivalPreviewOn
        ? glSurvivalPreviewLocked
        : lp->mineActive && lp->mineFootprint >= 0;
      if (erasing && mineLocked && inReach) {
        double targetX = ax + .5, targetY = ay + .5;
        double shoulderX = lp->px + lp->w * .5;
        double shoulderY = lp->py + lp->h * .42;
        double dx = targetX - shoulderX, dy = targetY - shoulderY;
        double distance = std::hypot(dx, dy);
        if (distance < 1e-6) { dx = lp->facing; dy = 0; distance = 1; }
        dx /= distance;
        dy /= distance;
        double originX = shoulderX + dx * 3.85;
        double originY = shoulderY + dy * 3.85;
        double beamDistance = std::hypot(targetX - originX, targetY - originY);
        int samples = imin(64, imax(2, (int)std::ceil(beamDistance * 2.2)));
        for (int i = 0; i <= samples; i++) {
          if (((i + E.actorTick / 2) % 5) == 0) continue;
          double t = i / (double)samples;
          double bx = (originX + (targetX - originX) * t - camCol) * glCellDev + glOffX;
          double by = (originY + (targetY - originY) * t - camRow) * glCellDev + glOffY;
          double pulse = .18 + ((i + E.actorTick) & 3) * .055;
          glUniform4f(glc->uColor, .32f, .96f, 1.0f, .88f);
          glSolidDev(bx - glCellDev * pulse * .5, by - glCellDev * pulse * .5,
                     glCellDev * pulse, glCellDev * pulse);
        }
        double impactX = (targetX - camCol) * glCellDev + glOffX;
        double impactY = (targetY - camRow) * glCellDev + glOffY;
        int targetCell = E.I(imax(0, imin(E.cols - 1, ax)), imax(0, imin(E.rows - 1, ay)));
        uint8_t material = toBg ? E.bg.grid[targetCell] : E.fg.grid[targetCell];
        uint32_t debris = MAT_COLOR[material == EMPTY ? STONE : material];
        float chipR = (debris & 255) / 255.f, chipG = ((debris >> 8) & 255) / 255.f,
              chipB = ((debris >> 16) & 255) / 255.f;
        for (int spark = 0; spark < 10; spark++) {
          double age = std::fmod(E.actorTick / 24.0 + spark * .618, 1.0);
          double side = (spark & 1) ? 1 : -1;
          double size = glCellDev * (spark % 3 ? .24 : .4) * (1 - age * .5);
          glUniform4f(glc->uColor, chipR, chipG, chipB, (float)(1 - age));
          glSolidDev(impactX + side * age * (2 + spark % 3) * glCellDev,
                     impactY + (-age * 3.5 + age * age * 6) * glCellDev, size, size);
        }
        glUniform4f(glc->uColor, .86f, 1.0f, 1.0f, .96f);
        glSolidDev(impactX - glCellDev * .28, impactY - glCellDev * .28,
                   glCellDev * .56, glCellDev * .56);
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
  Engine::ActiveLayerScope boundary(E, &E.fg, &E.fg);
  E.perfLightMs = E.perfFillMs = E.perfUploadMs = 0;
  bool fgDirty = false, bgDirty = false;
  { Engine::ActiveLayerScope active(E, &E.fg); E.buildDirtyRects(); fgDirty = E.fg.dirtyRenderCount > 0; }
  { Engine::ActiveLayerScope active(E, &E.bg); E.buildDirtyRects(); bgDirty = E.bg.dirtyRenderCount > 0; }
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  bool worldShifted = E.fg.worldOffsetX != glLastWorldOffX || E.fg.worldOffsetY != glLastWorldOffY;
  bool skyChanged = (int)E.renderer.renderSkyLight != glLastSkyLight;
  bool lightDirty = E.fg.skyDirty || E.bg.skyDirty;
  bool contentDirty = forceFull || fgDirty || bgDirty || skyChanged || lightDirty ||
                      glDynamicLightPending;
  bool windowMoved = forceFull || camCol != glLastCamCol || camRow != glLastCamRow || worldShifted;
  // Reduce the monotonic clock through a safe 64-bit frame counter and keep only
  // the wrapping low 32 bits.
  double nowMs = emscripten_get_now();
  uint32_t wallAnimFrame = (uint32_t)(uint64_t)std::floor(nowMs / GL_ANIM_FRAME_MS);
  uint32_t animFrame = glAnimationPaused && glLastAnimFrame != UINT32_MAX ? glLastAnimFrame : wallAnimFrame;
  bool animationDue = !glAnimationPaused && glVisibleAnimated && animFrame != glLastAnimFrame;
  if (!contentDirty && !windowMoved && !animationDue) return;
  int x0, y0, x1, y1; glVisRect(&x0, &y0, &x1, &y1);
  bool previousWindowValid = !forceFull && !worldShifted && glLastVisX0 >= 0;
  int exposed[16], exposedCount = 0;
  auto addExposed = [&](int ax0, int ay0, int ax1, int ay1) {
    if (ax0 > ax1 || ay0 > ay1) return;
    int* r = exposed + exposedCount * 4;
    r[0] = ax0; r[1] = ay0; r[2] = ax1; r[3] = ay1;
    exposedCount++;
  };
  bool windowDisjoint = false;
  if (previousWindowValid && windowMoved) {
    int ix0 = imax(x0, glLastVisX0), iy0 = imax(y0, glLastVisY0);
    int ix1 = imin(x1, glLastVisX1), iy1 = imin(y1, glLastVisY1);
    if (ix0 > ix1 || iy0 > iy1) {
      windowDisjoint = true;
    } else {
      addExposed(x0, y0, ix0 - 1, y1);
      addExposed(ix1 + 1, y0, x1, y1);
      addExposed(ix0, y0, ix1, iy0 - 1);
      addExposed(ix0, iy1 + 1, ix1, y1);
    }
  }

  // Lighting policy: resize, world shift, and day-night changes solve the FULL
  // buffer (keeps the sky shift-remap caches coherent buffer-wide). The very
  // first authoritative frame has no cache to preserve, so solve only its
  // window+margin; newly exposed cells are solved on demand as the view moves.
  // Ordinary content changes use the same regional path on the usual throttle.
  bool lightUpdated = false, fullLightUpdated = false;
  if (Renderer::RENDER_LIGHTING_ENABLED) {
    bool firstPresent = glCheapFirstPresent;
    bool lightForced = !firstPresent && (forceFull || worldShifted || skyChanged);
    bool lightThrottleReady = glLightTick == INT_MIN ||
      (E.storageRole == ESR_PRESENTATION
        ? nowMs - glLightWallMs >= GL_PRESENTATION_LIGHT_INTERVAL_MS
        : E.tick - glLightTick >= GL_LIGHT_THROTTLE_TICKS);
    int ex0 = glLightX0 <= 0 ? 0 : glLightX0 + GL_LIGHT_EXACT_SHRINK;
    int ey0 = glLightY0 <= 0 ? 0 : glLightY0 + GL_LIGHT_EXACT_SHRINK;
    int ex1 = glLightX1 >= E.cols - 1 ? E.cols - 1 : glLightX1 - GL_LIGHT_EXACT_SHRINK;
    int ey1 = glLightY1 >= E.rows - 1 ? E.rows - 1 : glLightY1 - GL_LIGHT_EXACT_SHRINK;
    bool windowExposed = glLightX0 < 0 ||
                         imax(0, x0 - 1) < ex0 || imax(0, y0 - 1) < ey0 ||
                         imin(E.cols - 1, x1 + 1) > ex1 || imin(E.rows - 1, y1 + 1) > ey1;
    bool cacheablePan = previousWindowValid && !windowDisjoint && exposedCount > 0 &&
                        (camCol != glLastCamCol || camRow != glLastCamRow);
    bool cameraPatchReady = windowExposed && !lightForced && glLightX0 >= 0 &&
                            E.storageRole == ESR_PRESENTATION && cacheablePan;
    bool scheduledSolve = contentDirty && (lightForced || lightThrottleReady);
    if (scheduledSolve || (windowExposed && !cameraPatchReady)) {
      double t0 = emscripten_get_now();
      int lx0 = 0, ly0 = 0, lx1 = E.cols - 1, ly1 = E.rows - 1;
      if (!lightForced) {
        lx0 = imax(0, x0 - GL_LIGHT_WINDOW_MARGIN); ly0 = imax(0, y0 - GL_LIGHT_WINDOW_MARGIN);
        lx1 = imin(E.cols - 1, x1 + GL_LIGHT_WINDOW_MARGIN); ly1 = imin(E.rows - 1, y1 + GL_LIGHT_WINDOW_MARGIN);
      }
      E.renderer.computeLightingBoth(lx0, ly0, lx1, ly1);
      glLightX0 = lx0; glLightY0 = ly0; glLightX1 = lx1; glLightY1 = ly1;
      glLightTick = E.tick;
      glLightWallMs = nowMs;
      E.perfLightMs = emscripten_get_now() - t0;
      lightUpdated = fullLightUpdated = true;
      glTerrainLightIntervals.clear();
      glDynamicLightPending = false;
      glDynamicLightX0 = glDynamicLightY0 = INT_MAX;
      glDynamicLightX1 = glDynamicLightY1 = INT_MIN;
    } else if (E.storageRole == ESR_PRESENTATION) {
      double t0 = emscripten_get_now();
      std::vector<std::pair<int, int>> intervals;
      for (const auto& changed : glTerrainLightIntervals) {
        int ix0 = imax(x0, changed.first - GL_LIGHT_CHANGE_REACH);
        int ix1 = imin(x1, changed.second + GL_LIGHT_CHANGE_REACH);
        if (ix0 <= ix1) intervals.push_back({ix0, ix1});
      }
      glTerrainLightIntervals.clear();
      std::sort(intervals.begin(), intervals.end());
      size_t merged = 0;
      for (const auto& interval : intervals) {
        if (merged > 0 && interval.first <= intervals[merged - 1].second + 1) {
          intervals[merged - 1].second = imax(intervals[merged - 1].second, interval.second);
        } else {
          intervals[merged++] = interval;
        }
      }
      intervals.resize(merged);

      auto markLightRefresh = [&](int rx0, int ry0, int rx1, int ry1) {
        rx0 = imax(x0, rx0); ry0 = imax(y0, ry0);
        rx1 = imin(x1, rx1); ry1 = imin(y1, ry1);
        if (rx0 > rx1 || ry0 > ry1) return;
        { Engine::ActiveLayerScope active(E, &E.fg); E.markDirtyRect(rx0, ry0, rx1, ry1); }
        { Engine::ActiveLayerScope active(E, &E.bg); E.markDirtyRect(rx0, ry0, rx1, ry1); }
        lightUpdated = true;
      };
      // Direct skylight travels down a whole column. Re-solving each touched
      // column plus the finite bounce reach keeps falling-body and erase
      // shadows current without paying for every visible column.
      for (const auto& interval : intervals) {
        int keepX0 = interval.first, keepX1 = interval.second;
        int keepY0 = imax(0, y0 - 1), keepY1 = imin(E.rows - 1, y1 + 1);
        E.renderer.computeLightingBothPatch(
          keepX0 - GL_LIGHT_EXACT_SHRINK, keepY0 - GL_LIGHT_EXACT_SHRINK,
          keepX1 + GL_LIGHT_EXACT_SHRINK, keepY1 + GL_LIGHT_EXACT_SHRINK,
          keepX0, keepY0, keepX1, keepY1);
        markLightRefresh(keepX0, y0, keepX1, y1);
      }

      // Entity/projectile emission has finite reach in both axes, so its old
      // and new positions need only one bounded repair.
      if (glDynamicLightPending && glDynamicLightX0 <= glDynamicLightX1) {
        int keepX0 = imax(0, glDynamicLightX0 - GL_LIGHT_CHANGE_REACH);
        int keepY0 = imax(0, glDynamicLightY0 - GL_LIGHT_CHANGE_REACH);
        int keepX1 = imin(E.cols - 1, glDynamicLightX1 + GL_LIGHT_CHANGE_REACH);
        int keepY1 = imin(E.rows - 1, glDynamicLightY1 + GL_LIGHT_CHANGE_REACH);
        E.renderer.computeLightingBothPatch(
          keepX0 - GL_LIGHT_EXACT_SHRINK, keepY0 - GL_LIGHT_EXACT_SHRINK,
          keepX1 + GL_LIGHT_EXACT_SHRINK, keepY1 + GL_LIGHT_EXACT_SHRINK,
          keepX0, keepY0, keepX1, keepY1);
        markLightRefresh(keepX0, keepY0, keepX1, keepY1);
        glDynamicLightPending = false;
        glDynamicLightX0 = glDynamicLightY0 = INT_MAX;
        glDynamicLightX1 = glDynamicLightY1 = INT_MIN;
      }
      bool cameraLightPatched = false;
      int exactX0 = ex0, exactY0 = ey0, exactX1 = ex1, exactY1 = ey1;
      if (cameraPatchReady) {
        // Keep one cell beyond the sample window exact for face-lit materials,
        // plus look-ahead on every moving axis. Direct skylight is recast from
        // the real buffer edge for each repaired column, so newly exposed shaft
        // shadows are current immediately.
        int viewX0 = imax(0, x0 - 1), viewY0 = imax(0, y0 - 1);
        int viewX1 = imin(E.cols - 1, x1 + 1), viewY1 = imin(E.rows - 1, y1 + 1);
        if (camCol > glLastCamCol) {
          exactX0 = imax(exactX0, viewX0);
          exactX1 = imin(E.cols - 1, viewX1 + GL_LIGHT_PAN_LOOKAHEAD);
        } else if (camCol < glLastCamCol) {
          exactX0 = imax(0, viewX0 - GL_LIGHT_PAN_LOOKAHEAD);
          exactX1 = imin(exactX1, viewX1);
        } else {
          exactX0 = imax(exactX0, viewX0); exactX1 = imin(exactX1, viewX1);
        }
        if (camRow > glLastCamRow) {
          exactY0 = imax(exactY0, viewY0);
          exactY1 = imin(E.rows - 1, viewY1 + GL_LIGHT_PAN_LOOKAHEAD);
        } else if (camRow < glLastCamRow) {
          exactY0 = imax(0, viewY0 - GL_LIGHT_PAN_LOOKAHEAD);
          exactY1 = imin(exactY1, viewY1);
        } else {
          exactY0 = imax(exactY0, viewY0); exactY1 = imin(exactY1, viewY1);
        }
        // At a buffer edge there are no omitted sources beyond the solve. Match
        // the validity encoding by repairing the short remainder to that edge.
        if (exactX0 <= GL_LIGHT_EXACT_SHRINK) exactX0 = 0;
        if (exactY0 <= GL_LIGHT_EXACT_SHRINK) exactY0 = 0;
        if (exactX1 >= E.cols - 1 - GL_LIGHT_EXACT_SHRINK) exactX1 = E.cols - 1;
        if (exactY1 >= E.rows - 1 - GL_LIGHT_EXACT_SHRINK) exactY1 = E.rows - 1;
        if (exactX0 <= exactX1 && exactY0 <= exactY1) {
          int patches[16], patchCount = 0;
          auto addLightPatch = [&](int px0, int py0, int px1, int py1) {
            if (px0 > px1 || py0 > py1) return;
            int* p = patches + patchCount * 4;
            p[0] = px0; p[1] = py0; p[2] = px1; p[3] = py1;
            patchCount++;
          };
          // Partition the target exact rectangle around the previous one. The
          // side strips include diagonal corners; the top/bottom strips cover
          // only the old x-overlap, so no cell is solved twice as a kept pixel.
          addLightPatch(exactX0, exactY0, imin(exactX1, ex0 - 1), exactY1);
          addLightPatch(imax(exactX0, ex1 + 1), exactY0, exactX1, exactY1);
          int overlapX0 = imax(exactX0, ex0), overlapX1 = imin(exactX1, ex1);
          addLightPatch(overlapX0, exactY0, overlapX1, imin(exactY1, ey0 - 1));
          addLightPatch(overlapX0, imax(exactY0, ey1 + 1), overlapX1, exactY1);
          for (int pi = 0; pi < patchCount; pi++) {
            const int* p = patches + pi * 4;
            E.renderer.computeLightingBothPatch(
              p[0] - GL_LIGHT_EXACT_SHRINK, p[1] - GL_LIGHT_EXACT_SHRINK,
              p[2] + GL_LIGHT_EXACT_SHRINK, p[3] + GL_LIGHT_EXACT_SHRINK,
              p[0], p[1], p[2], p[3]);
          }
          cameraLightPatched = patchCount > 0;
          lightUpdated = lightUpdated || cameraLightPatched;
        }
      }
      if (lightUpdated) {
        if (cameraLightPatched) {
          glLightX0 = exactX0 <= GL_LIGHT_EXACT_SHRINK ? 0 : exactX0 - GL_LIGHT_EXACT_SHRINK;
          glLightY0 = exactY0 <= GL_LIGHT_EXACT_SHRINK ? 0 : exactY0 - GL_LIGHT_EXACT_SHRINK;
          glLightX1 = exactX1 >= E.cols - 1 ? E.cols - 1 : exactX1 + GL_LIGHT_EXACT_SHRINK;
          glLightY1 = exactY1 >= E.rows - 1 ? E.rows - 1 : exactY1 + GL_LIGHT_EXACT_SHRINK;
        } else {
          // The current sample window is exact. Constrain the validity region
          // so the next whole-cell pan repairs newly exposed lighting.
          glLightX0 = imax(0, x0 - GL_LIGHT_WINDOW_MARGIN);
          glLightY0 = imax(0, y0 - GL_LIGHT_WINDOW_MARGIN);
          glLightX1 = imin(E.cols - 1, x1 + GL_LIGHT_WINDOW_MARGIN);
          glLightY1 = imin(E.rows - 1, y1 + GL_LIGHT_WINDOW_MARGIN);
        }
        { Engine::ActiveLayerScope active(E, &E.fg); E.foldRowMarksToRender(); }
        { Engine::ActiveLayerScope active(E, &E.bg); E.foldRowMarksToRender(); }
        E.perfLightMs = emscripten_get_now() - t0;
      }
      // A patch makes the visible structural shadow current, but other changed
      // materials in the same diff still need the scheduled catch-up solve.
      if (fgDirty || bgDirty) {
        E.fg.skyDirty = true;
        E.bg.skyDirty = true;
      }
    }
  }
  // A full lighting solve can change every visible pixel. Exact patches mark
  // their repaired chunks above, while a pure pan keeps the overlap and adds at
  // most four non-overlapping edge bands.
  bool fullWindowRefresh = forceFull || worldShifted || fullLightUpdated || !previousWindowValid;
  if (!fullWindowRefresh && windowDisjoint) fullWindowRefresh = true;
  E.renderer.renderFrameSalt = animFrame;
  int cx0 = x0 >> CHUNK_SHIFT, cy0 = y0 >> CHUNK_SHIFT;
  int cx1 = x1 >> CHUNK_SHIFT, cy1 = y1 >> CHUNK_SHIFT;
  auto fillLayer = [&](Layer& lay, std::vector<uint8_t>& animatedChunks) {
    Engine::ActiveLayerScope active(E, &lay);
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
    Engine::ActiveLayerScope active(E, &lay);
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
    { Engine::ActiveLayerScope active(E, &E.fg); glUploadWindow(glTex, x0, y0, x1, y1); }
    { Engine::ActiveLayerScope active(E, &E.bg); glUploadWindow(glTexBg, x0, y0, x1, y1); }
  } else {
    uploadChanged(E.fg, glTex, glAnimatedFg);
    uploadChanged(E.bg, glTexBg, glAnimatedBg);
    for (int ri = 0; ri < exposedCount; ri++) {
      const int* r = exposed + ri * 4;
      { Engine::ActiveLayerScope active(E, &E.fg); glUploadWindow(glTex, r[0], r[1], r[2], r[3]); }
      { Engine::ActiveLayerScope active(E, &E.bg); glUploadWindow(glTexBg, r[0], r[1], r[2], r[3]); }
    }
  }
  glVisibleAnimated = fgAnimated || bgAnimated;
  E.perfUploadMs = emscripten_get_now() - tu;

  auto clearPresentedDirty = [&](Layer& lay) {
    Engine::ActiveLayerScope active(E, &lay);
    memset(lay.dirtyRender.data(), 0, (size_t)E.chunkCols * E.chunkRows);
    lay.dirtyRenderCount = 0;
    // Authority/full engines retain row marks for beginStepDirty's scheduler.
    // A presentation replica never steps cells, so retaining them would make
    // buildDirtyRects re-promote every historical diff on every later frame.
    if (E.storageRole == ESR_PRESENTATION) {
      for (int y = 0; y < E.rows; y++) {
        lay.rowMarkSpans[y].clear();
      }
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
// then foreground, then players + preview. forceFull forces a full-window refresh
// (init/resize). Returns 1 if drawn.
int GLPresenter::glRenderFrame(int forceFull) {
  Engine::ActiveLayerScope boundary(E, &E.fg, &E.fg);
  if (!glReady()) return 0;
  emscripten_webgl_make_context_current(glc->handle);
  glSyncCamera();
  glCollectDynamicLights();
  glPresentWindow(forceFull);
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
  glDrawCells(glTexBg, E.planetId == PL_FRONTIER ? E.content.backgroundTint : GL_BG_TINT, 0, 1);
  // Hide the 1px gutter when cells are tiny — a solid grid would wash out the scene.
  int gutter = (glGutterOn && glCellDev >= 3.0) ? 1 : 0;
  glDrawCells(glTex, 1.0f, gutter, 0);                     // schema transparency; empty/gutter reveal bg
  if (glc->uTint >= 0) glUniform1f(glc->uTint, 1.0f);
  glDrawCreatures();
  glDrawPlayers();
  glDrawProjectiles();
  glDrawItems();
  glDrawPreview();
  return 1;
}

void GLPresenter::glGetOffset(int* out) { glSyncCamera(); out[0] = (int)std::lround(glOffX); out[1] = (int)std::lround(glOffY); }

// Read back a top-down RGBA region of the canvas (bench flicker probe).
// glReadPixels is bottom-up, so flip its rows in place.
int GLPresenter::glReadback(int x, int y, int w, int h, uint8_t* out) {
  if (!glReady() || !out || x < 0 || y < 0 || w <= 0 || h <= 0
      || w > glDevW || h > glDevH
      || x > glDevW - w || y > glDevH - h)
    return 0;
  emscripten_webgl_make_context_current(glc->handle);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  int gy = glDevH - (y + h);
  glReadPixels(x, gy, w, h, GL_RGBA, GL_UNSIGNED_BYTE, out);
  size_t row = (size_t)w * 4;
  for (int r = 0; r < h / 2; r++) {
    uint8_t* top = out + (size_t)r * row;
    uint8_t* bottom = out + (size_t)(h - 1 - r) * row;
    std::swap_ranges(top, top + row, bottom);
  }
  return 1;
}
