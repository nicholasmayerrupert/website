// GLPresenter method bodies (need the full Engine definition; see glpresenter.hpp).

bool GLPresenter::glReady() const { return glc != nullptr && glc->ready && glTex != 0; }

int GLPresenter::glInit(const char* target) {
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
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, E.cols, E.rows, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
  };
  mkTex(glTex);
  mkTex(glTexBg);
  mkTex(glTex2);
  glGenFramebuffers(1, &glReadFBO);
  glGenFramebuffers(1, &glDrawFBO);
  E.useLayer(&E.fg); E.renderer.renderFull(); glUploadFull(glTex);
  E.useLayer(&E.bg); E.renderer.renderFull(); glUploadFull(glTexBg);
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

void GLPresenter::glSetCamera(double camX_, double camY_, int cellDev, int viewCols, int viewRows,
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
void GLPresenter::glSyncCamera() { glSetCamera(E.cam.camX, E.cam.camY, E.cam.cellDevPx, E.cam.viewportCols, E.cam.viewportRows, glGutterOn, glSnapOff); }
// DEV A/B flags (flicker bench): toggle the gutter grid and offset snapping.
void GLPresenter::glSetFlags(int gutterOn, int snapOff) { glGutterOn = gutterOn; glSnapOff = snapOff; }

void GLPresenter::glSetPlayers(int useExternal, const float* data, int count, int ownId) {
  glOwnPlayerId = ownId;
  glUseExtPlayers = useExternal != 0;
  if (glUseExtPlayers) glExtPlayers.assign(data, data + (size_t)count * GLP_STRIDE);
  else glExtPlayers.clear();
}
// Client E.itemsys.items override: when external, glDrawItems draws these instead of the
// engine's own (a client doesn't simulate the world, so it has no local E.itemsys.items).
void GLPresenter::glSetItems(int useExternal, const float* data, int count) {
  glUseExtItems = useExternal != 0;
  if (glUseExtItems) glExtItems.assign(data, data + (size_t)count * IS_STRIDE);
  else glExtItems.clear();
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

// Draw the visible window of one layer's texture at brightness `tint`. The
// background passes gutter=0 and opaqueAlpha=1 so rear-layer material alpha does
// not show through foreground cells; the foreground passes the real gutter flag.
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
void GLPresenter::glDrawOnePlayer(double pxc, double pyc, int facing, int animState, int animFrame,
                     bool own, int camCol, int camRow) {
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
      glUniform4f(glc->uColor, tr, tg, tb, col[3]);
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
      glDrawOnePlayer(p[GLP_X], p[GLP_Y], (int)p[GLP_FACING], (int)p[GLP_ANIM_STATE], (int)p[GLP_ANIM_FRAME], p[GLP_OWN] > 0.5f, camCol, camRow);
    }
  } else {
    for (auto& p : E.psys.players) {
      if (!p.active) continue;
      glDrawOnePlayer(p.px, p.py, p.facing, p.animState, p.animFrame, p.id == glOwnPlayerId, camCol, camRow);
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

  // Survival: a "cursor" disc at the local player's aim shows where the tool will
  // act and into which layer — LMB foreground (bright), RMB background (dim), the
  // eraser red. Faded when the aim is out of the player's reach.
  if (E.cam.playModeOn && glOwnPlayerId) {
    Player* lp = nullptr;
    for (auto& pp : E.psys.players) if (pp.id == glOwnPlayerId && pp.active) { lp = &pp; break; }
    if (lp) {
      int ax = (int)std::floor(lp->aimX), ay = (int)std::floor(lp->aimY);
      bool toBg = (E.cam.pointerBtns & 2) != 0;
      bool erasing = (lp->selectedTool == T_ERASER);
      const SurvivalFootprint* fp = nullptr;
      if (E.survivalInventory) {
        const InvSlot& sel = lp->inv[lp->selectedSlot];
        erasing = sel.isTool || sel.count <= 0;
        fp = &E.getSurvivalFootprint(*lp);
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
// cell into view must repaint that cell here. Lighting stays a FULL-buffer solve
// (computeLightingBoth, once for both layers) so the windowed fill always reads valid,
// buffer-indexed light; a pure pan reuses the existing light without re-solving.
void GLPresenter::glPresentWindow(int forceFull) {
  E.useLayer(&E.fg); E.buildDirtyRects(); bool fgDirty = E.fg.dirtyRenderCount > 0;
  E.useLayer(&E.bg); E.buildDirtyRects(); bool bgDirty = E.bg.dirtyRenderCount > 0;
  int camCol = (int)std::floor(glCamX), camRow = (int)std::floor(glCamY);
  bool worldShifted = E.fg.worldOffsetX != glLastWorldOffX || E.fg.worldOffsetY != glLastWorldOffY;
  bool skyChanged = (int)E.renderer.renderSkyLight != glLastSkyLight;
  bool contentDirty = forceFull || fgDirty || bgDirty || skyChanged;
  bool windowMoved = forceFull || camCol != glLastCamCol || camRow != glLastCamRow || worldShifted;
  if (!contentDirty && !windowMoved) return;

  // Re-solve the full-buffer lighting only when content changed AND either the light is
  // forced/invalidated (init/resize, world shift, day-night change) or the throttle
  // window has elapsed; otherwise reuse the prior light (buffer-indexed, so still valid
  // for the same buffer positions). A pure pan reuses lighting unconditionally.
  bool lightForced = forceFull || worldShifted || skyChanged;
  bool lightThrottleReady = E.tick - glLightTick >= GL_LIGHT_THROTTLE_TICKS;
  if (Renderer::RENDER_LIGHTING_ENABLED && contentDirty && (lightForced || lightThrottleReady)) {
    double t0 = emscripten_get_now();
    E.renderer.computeLightingBoth();
    glLightTick = E.tick;
    E.perfLightMs = emscripten_get_now() - t0;
  }
  int x0, y0, x1, y1; glVisRect(&x0, &y0, &x1, &y1);
  double tf = emscripten_get_now();
  E.useLayer(&E.fg); E.renderer.fillRenderSpan(E.fg.grid, (uint32_t*)E.fg.renderPixels.data(), x0, y0, x1, y1);
  E.useLayer(&E.bg); E.renderer.fillRenderSpan(E.bg.grid, (uint32_t*)E.bg.renderPixels.data(), x0, y0, x1, y1);
  E.perfFillMs = emscripten_get_now() - tf;
  double tu = emscripten_get_now();
  E.useLayer(&E.fg); glUploadWindow(glTex, x0, y0, x1, y1);
  E.useLayer(&E.bg); glUploadWindow(glTexBg, x0, y0, x1, y1);
  E.perfUploadMs = emscripten_get_now() - tu;

  E.useLayer(&E.fg); memset(E.dirtyRender, 0, (size_t)E.chunkCols * E.chunkRows); E.fg.dirtyRenderCount = 0;
  E.useLayer(&E.bg); memset(E.dirtyRender, 0, (size_t)E.chunkCols * E.chunkRows); E.bg.dirtyRenderCount = 0;
  glLastCamCol = camCol; glLastCamRow = camRow;
  glLastWorldOffX = E.fg.worldOffsetX; glLastWorldOffY = E.fg.worldOffsetY;
  glLastSkyLight = (int)E.renderer.renderSkyLight;
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
  glDrawCells(glTex, 1.0f, glGutterOn ? 1 : 0, 0);         // foreground on top
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
