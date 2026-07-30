// Free rigid bodies and component-to-body conversion.
//
// Components are grid-anchored while bodies are moving entities. This file owns
// body geometry, integration, collision sampling, and stamping settled bodies
// back into component-aware grid state.
static bool rigidLargeSlenderBody(const Body* body) {
  int shortSide = imax(1, imin(body->w, body->h));
  return imax(body->w, body->h) >= shortSide * 4 && body->maxR >= 24;
}

static bool rigidTightSlenderBounds(const Body* body) {
  return body->tightSlenderBounds;
}

void RigidBodySystem::clearContactCaches() {
  for (ContactCache& cache : contactCaches) cache.clear();
  for (auto& axes : pairAxes) axes.clear();
  for (std::vector<int>& ids : broadphaseBodyIds) ids.clear();
}
void RigidBodySystem::worldPoint(Body* b, int i, double sn, double cs, double& ox, double& oy) {
  double lx = b->points[i * 2], ly = b->points[i * 2 + 1];
  ox = b->px + lx * cs - ly * sn; oy = b->py + lx * sn + ly * cs;
}
uint8_t RigidBodySystem::bodyMaterialAt(Body* b, int localIndex) {
  if (localIndex < 0 || localIndex >= (int)b->occ.size() || !b->occ[localIndex]) return EMPTY;
  return b->cellMaterials.empty() ? b->material : b->cellMaterials[localIndex];
}
bool RigidBodySystem::computeDerived(Body* b, bool preserveWorld) {
  b->rasterFootprintValid = false;
  int nPts = 0; double sumX = 0, sumY = 0, totalMass = 0;
  for (int j = 0; j < b->h; j++) for (int i = 0; i < b->w; i++) {
    int local = j * b->w + i;
    if (!b->occ[local]) continue;
    auto materialMass = [](uint8_t material) {
      return material > EMPTY && material < TABLE ? DENSITY[material] : 0.0;
    };
    double cellMass = b->jointRole
      ? materialMass(b->cellMaterials[local]) + materialMass(b->jointPeerMaterials[local])
      : (b->cellMaterials.empty() ? 1.0 : materialMass(bodyMaterialAt(b, local)));
    if (cellMass <= 0) continue;
    nPts++;
    sumX += (b->offsetX + i) * cellMass;
    sumY += (b->offsetY + j) * cellMass;
    totalMass += cellMass;
  }
  if (nPts == 0) return false;
  double divisor = b->cellMaterials.empty() && !b->jointRole ? nPts : totalMass;
  double dx = sumX / divisor, dy = sumY / divisor;
  if (preserveWorld && (dx != 0 || dy != 0)) { double c = std::cos(b->angle), s = std::sin(b->angle); b->px += dx * c - dy * s; b->py += dx * s + dy * c; }
  b->offsetX -= dx; b->offsetY -= dy;
  b->points.assign((size_t)nPts * 2, 0.f); b->boundaryPts.clear();
  b->boundarySamples.clear(); b->boundarySampleRadii.clear();
  int pi = 0; double inertia = 0, maxR2 = 0;
  int shortSide = imax(1, imin(b->w, b->h));
  int longSide = imax(b->w, b->h);
  bool sampleCorners = nPts == b->w * b->h
    || longSide >= 24 || longSide >= shortSide * 8;
  auto filled = [&](int ii, int jj) { return ii >= 0 && ii < b->w && jj >= 0 && jj < b->h && b->occ[jj * b->w + ii]; };
  auto addSample = [&](double sx, double sy) {
    float sampleX = (float)sx, sampleY = (float)sy;
    b->boundarySamples.push_back(sampleX);
    b->boundarySamples.push_back(sampleY);
    b->boundarySampleRadii.push_back(std::hypot(
      (double)sampleX, (double)sampleY));
  };
  for (int j = 0; j < b->h; j++) for (int i = 0; i < b->w; i++) {
    if (!b->occ[j * b->w + i]) continue;
    double lx = b->offsetX + i, ly = b->offsetY + j;
    b->points[pi * 2] = (float)lx; b->points[pi * 2 + 1] = (float)ly;
    double cellMass = b->density;
    if (b->jointRole) {
      uint8_t own = b->cellMaterials[j * b->w + i];
      uint8_t peer = b->jointPeerMaterials[j * b->w + i];
      cellMass = (own > EMPTY && own < TABLE ? DENSITY[own] : 0)
               + (peer > EMPTY && peer < TABLE ? DENSITY[peer] : 0);
    } else if (!b->cellMaterials.empty()) {
      uint8_t material = bodyMaterialAt(b, j * b->w + i);
      cellMass = material > EMPTY && material < TABLE ? DENSITY[material] : 0;
    }
    double r2 = lx * lx + ly * ly; inertia += cellMass * r2; if (r2 > maxR2) maxR2 = r2;
    bool exL = !filled(i - 1, j), exR = !filled(i + 1, j), exU = !filled(i, j - 1), exD = !filled(i, j + 1);
    if (exL || exR || exU || exD) {
      b->boundaryPts.push_back(pi);
      addSample(lx, ly);                                   // cell centre
      if (exR) addSample(lx + 0.5, ly);                    // exposed face midpoints
      if (exL) addSample(lx - 0.5, ly);
      if (exD) addSample(lx, ly + 0.5);
      if (exU) addSample(lx, ly - 0.5);
      if (sampleCorners) {
        if (exL && exU) addSample(lx - 0.5, ly - 0.5);
        if (exR && exU) addSample(lx + 0.5, ly - 0.5);
        if (exL && exD) addSample(lx - 0.5, ly + 0.5);
        if (exR && exD) addSample(lx + 0.5, ly + 0.5);
      }
    }
    pi++;
  }
  double mass = b->cellMaterials.empty() && !b->jointRole ? b->density * nPts : totalMass;
  if (!b->cellMaterials.empty() || b->jointRole) b->density = mass / nPts;
  bool coversMajorAxis = true;
  if (shortSide <= 4) {
    if (b->w >= b->h) {
      for (int i = 0; i < b->w; i++) {
        bool covered = false;
        for (int j = 0; j < b->h; j++)
          if (filled(i, j)) { covered = true; break; }
        if (!covered) { coversMajorAxis = false; break; }
      }
    } else {
      for (int j = 0; j < b->h; j++) {
        bool covered = false;
        for (int i = 0; i < b->w; i++)
          if (filled(i, j)) { covered = true; break; }
        if (!covered) { coversMajorAxis = false; break; }
      }
    }
  }
  b->tightSlenderBounds =
    (int64_t)nPts * 4 >= (int64_t)b->w * b->h * 3
    || (shortSide <= 4 && coversMajorAxis);
  b->collisionRects.clear();
  b->collisionSpans.clear();
  struct CollisionRun {
    int x0, x1, child;
  };
  std::vector<CollisionRun> previousRuns, currentRuns;
  for (int j = 0; j < b->h; j++) {
    currentRuns.clear();
    int previous = 0;
    for (int i = 0; i < b->w;) {
      while (i < b->w && !filled(i, j)) i++;
      if (i >= b->w) break;
      int x0 = i;
      while (i < b->w && filled(i, j)) i++;
      int x1 = i;
      while (previous < (int)previousRuns.size()
             && (previousRuns[previous].x0 < x0
                 || (previousRuns[previous].x0 == x0
                     && previousRuns[previous].x1 < x1)))
        previous++;
      int child = -1;
      if (previous < (int)previousRuns.size()
          && previousRuns[previous].x0 == x0
          && previousRuns[previous].x1 == x1) {
        child = previousRuns[previous].child;
        b->collisionRects[child].y1 = j + 1;
      } else {
        child = (int)b->collisionRects.size();
        BodyCollisionRect rect;
        rect.x0 = x0;
        rect.y0 = j;
        rect.x1 = x1;
        rect.y1 = j + 1;
        b->collisionRects.push_back(rect);
      }
      currentRuns.push_back({x0, x1, child});
    }
    previousRuns.swap(currentRuns);
  }
  auto addFaceSpans = [&](BodyCollisionRect& rect, BodyCollisionFace face) {
    rect.spanStart[face] = (int)b->collisionSpans.size();
    int q0 = (face == BCF_LEFT || face == BCF_RIGHT) ? rect.y0 : rect.x0;
    int q1 = (face == BCF_LEFT || face == BCF_RIGHT) ? rect.y1 : rect.x1;
    int runStart = -1;
    auto exposed = [&](int q) {
      if (face == BCF_LEFT) return !filled(rect.x0 - 1, q);
      if (face == BCF_RIGHT) return !filled(rect.x1, q);
      if (face == BCF_UP) return !filled(q, rect.y0 - 1);
      return !filled(q, rect.y1);
    };
    auto finishSpan = [&](int end) {
      if (runStart < 0) return;
      double offset = (face == BCF_LEFT || face == BCF_RIGHT)
        ? b->offsetY : b->offsetX;
      b->collisionSpans.push_back({
        (float)(offset + runStart - 0.5),
        (float)(offset + end - 0.5),
      });
      runStart = -1;
    };
    for (int q = q0; q < q1; q++) {
      if (exposed(q)) {
        if (runStart < 0) runStart = q;
      } else {
        finishSpan(q);
      }
    }
    finishSpan(q1);
    rect.spanCount[face] =
      (int)b->collisionSpans.size() - rect.spanStart[face];
  };
  for (BodyCollisionRect& rect : b->collisionRects) {
    addFaceSpans(rect, BCF_LEFT);
    addFaceSpans(rect, BCF_RIGHT);
    addFaceSpans(rect, BCF_UP);
    addFaceSpans(rect, BCF_DOWN);
  }
  b->nPts = nPts; b->invMass = mass > 0 ? 1 / mass : 0; b->invInertia = inertia > 0 ? 1 / inertia : 0;
  if (++b->geometryRevision == 0) b->geometryRevision = 1;
  b->maxR = std::sqrt(maxR2); b->awake = true; b->stillTicks = 0;
  return true;
}
Body* RigidBodySystem::spawnBodyImpl(const std::vector<std::pair<int, int>>& cells, uint8_t material, double density) {
  int nPts = (int)cells.size(); if (nPts == 0) return nullptr;
  double cx = 0, cy = 0;
  for (auto& c : cells) { cx += c.first + 0.5; cy += c.second + 0.5; }
  cx /= nPts; cy /= nPts;
  int minX = 1 << 30, minY = 1 << 30, maxX = -(1 << 30), maxY = -(1 << 30);
  for (auto& c : cells) { if (c.first < minX) minX = c.first; if (c.first > maxX) maxX = c.first; if (c.second < minY) minY = c.second; if (c.second > maxY) maxY = c.second; }
  int w = maxX - minX + 1, h = maxY - minY + 1;
  Body* b = new Body();
  b->occ.assign((size_t)w * h, 0);
  for (auto& c : cells) b->occ[(size_t)(c.second - minY) * w + (c.first - minX)] = 1;
  b->w = w; b->h = h; b->offsetX = minX + 0.5 - cx; b->offsetY = minY + 0.5 - cy;
  b->px = cx; b->py = cy; b->angle = 0; b->vx = 0; b->vy = 0; b->omega = 0;
  b->material = material; b->density = density; b->id = E.L->nextBodyId++;
  computeDerived(b, false);
  E.L->bodies.push_back(b);
  return b;
}
Body* RigidBodySystem::spawnBodyImpl(const std::vector<std::pair<int, int>>& cells,
                                     const std::vector<uint8_t>& materials) {
  if (cells.empty() || cells.size() != materials.size()) return nullptr;
  Body* b = spawnBodyImpl(cells, materials[0], DENSITY[materials[0]]);
  if (!b) return nullptr;
  b->cellMaterials.assign(b->occ.size(), EMPTY);
  int minX = 1 << 30, minY = 1 << 30;
  for (const auto& cell : cells) {
    minX = imin(minX, cell.first);
    minY = imin(minY, cell.second);
  }
  for (size_t i = 0; i < cells.size(); i++) {
    int local = (cells[i].second - minY) * b->w + (cells[i].first - minX);
    b->cellMaterials[local] = materials[i];
  }
  computeDerived(b, true);
  return b;
}
Body* RigidBodySystem::spawnJointBodyImpl(
    const std::vector<std::pair<int, int>>& fgCells,
    const std::vector<uint8_t>& fgMaterials,
    const std::vector<std::pair<int, int>>& bgCells,
    const std::vector<uint8_t>& bgMaterials) {
  if (fgCells.empty() || bgCells.empty()
      || fgCells.size() != fgMaterials.size()
      || bgCells.size() != bgMaterials.size()) return nullptr;
  std::vector<std::pair<int, int>> unionCells = fgCells;
  unionCells.insert(unionCells.end(), bgCells.begin(), bgCells.end());
  std::sort(unionCells.begin(), unionCells.end());
  unionCells.erase(std::unique(unionCells.begin(), unionCells.end()), unionCells.end());

  Layer* previous = E.L;
  E.useLayer(&E.fg);
  Body* leader = spawnBodyImpl(unionCells, fgMaterials[0], DENSITY[fgMaterials[0]]);
  E.useLayer(&E.bg);
  Body* follower = spawnBodyImpl(unionCells, bgMaterials[0], DENSITY[bgMaterials[0]]);
  if (!leader || !follower) {
    E.useLayer(previous);
    return nullptr;
  }
  int jointId = imax(leader->id, follower->id);
  leader->id = follower->id = jointId;
  E.fg.nextBodyId = imax(E.fg.nextBodyId, jointId + 1);
  E.bg.nextBodyId = imax(E.bg.nextBodyId, jointId + 1);

  int minX = unionCells[0].first, minY = unionCells[0].second;
  for (const auto& cell : unionCells) {
    minX = imin(minX, cell.first);
    minY = imin(minY, cell.second);
  }
  auto fillLayerMap = [&](Body* body,
                          const std::vector<std::pair<int, int>>& ownCells,
                          const std::vector<uint8_t>& ownMaterials,
                          const std::vector<std::pair<int, int>>& peerCells,
                          const std::vector<uint8_t>& peerMaterials) {
    body->cellMaterials.assign(body->occ.size(), EMPTY);
    body->jointPeerMaterials.assign(body->occ.size(), EMPTY);
    for (size_t i = 0; i < ownCells.size(); i++) {
      int local = (ownCells[i].second - minY) * body->w + ownCells[i].first - minX;
      body->cellMaterials[local] = ownMaterials[i];
    }
    for (size_t i = 0; i < peerCells.size(); i++) {
      int local = (peerCells[i].second - minY) * body->w + peerCells[i].first - minX;
      body->jointPeerMaterials[local] = peerMaterials[i];
    }
  };
  fillLayerMap(leader, fgCells, fgMaterials, bgCells, bgMaterials);
  fillLayerMap(follower, bgCells, bgMaterials, fgCells, fgMaterials);
  leader->jointRole = 1;
  follower->jointRole = 2;
  leader->jointPeer = follower;
  follower->jointPeer = leader;
  computeDerived(leader, true);
  computeDerived(follower, true);
  syncJointFollower(leader);
  E.bg.passiveBodyIds.insert(jointId);
  E.useLayer(previous);
  return leader;
}
void RigidBodySystem::freezeCellsOntoBody(
    Layer& sourceLayer, int sourceBodyId, Layer& targetLayer,
    const std::vector<int>& cells) {
  if (cells.empty()) return;
  auto findBody = [](Layer& layer, int id) -> Body* {
    for (Body* body : layer.bodies)
      if (body->id == id) return body;
    return nullptr;
  };
  Body* source = findBody(sourceLayer, sourceBodyId);
  if (!source) return;

  Body* target = source;
  if (&sourceLayer != &targetLayer) {
    if (source->jointRole) {
      target = source->jointPeer;
      if (!target) return;
    } else {
      // A cross-layer attachment promotes the existing body to a shared-pose
      // pair. The missing layer starts empty and receives only the new cells.
      Body* peer = new Body(*source);
      std::vector<uint8_t> sourceMaterials(source->occ.size(), EMPTY);
      if (source->cellMaterials.empty()) {
        for (size_t i = 0; i < source->occ.size(); i++)
          if (source->occ[i]) sourceMaterials[i] = source->material;
      } else {
        sourceMaterials = source->cellMaterials;
      }
      source->cellMaterials = sourceMaterials;
      source->jointPeerMaterials.assign(source->occ.size(), EMPTY);
      peer->cellMaterials.assign(peer->occ.size(), EMPTY);
      peer->jointPeerMaterials = sourceMaterials;
      source->jointPeer = peer;
      peer->jointPeer = source;

      Body* leader = &sourceLayer == &E.fg ? source : peer;
      Body* follower = &sourceLayer == &E.bg ? source : peer;
      leader->jointRole = 1;
      follower->jointRole = 2;
      int oldId = source->id;
      int jointId = imax(E.fg.nextBodyId, E.bg.nextBodyId);
      E.fg.nextBodyId = E.bg.nextBodyId = jointId + 1;
      source->id = peer->id = jointId;
      for (int k : sourceLayer.bodyCells)
        if (sourceLayer.bodyOwner[k] == oldId)
          sourceLayer.bodyOwner[k] = jointId;
      (&sourceLayer == &E.fg ? E.bg : E.fg).bodies.push_back(peer);
      if (&sourceLayer == &E.bg) {
        std::vector<int> active;
        active.reserve(E.bg.bodyCells.size());
        for (int k : E.bg.bodyCells) {
          if (E.bg.bodyOwner[k] == jointId)
            E.bg.passiveBodyCells.push_back(k);
          else
            active.push_back(k);
        }
        E.bg.bodyCells = std::move(active);
      }
      E.bg.passiveBodyIds.insert(jointId);
      computeDerived(leader, true);
      computeDerived(follower, true);
      syncJointFollower(leader);
      target = &targetLayer == &E.fg ? leader : follower;
    }
  }
  if (!target) return;

  // Quantize the frozen world cells into the body's authoritative local mask.
  // Expanding that mask shifts its offset so every existing local cell keeps
  // the same world-space pose.
  std::vector<std::pair<int, int>> localCells;
  localCells.reserve(cells.size());
  double cs = std::cos(target->angle), sn = std::sin(target->angle);
  int minI = 0, minJ = 0, maxI = target->w - 1, maxJ = target->h - 1;
  for (int k : cells) {
    if (k < 0 || k >= E.cols * E.rows
        || targetLayer.grid[k] != WATER || targetLayer.bodyOwner[k] >= 0)
      continue;
    int y = k / E.cols, x = k - y * E.cols;
    double dx = x + 0.5 - target->px, dy = y + 0.5 - target->py;
    double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    int i = (int)std::lround(lx - target->offsetX);
    int j = (int)std::lround(ly - target->offsetY);
    localCells.push_back({i, j});
    minI = imin(minI, i); minJ = imin(minJ, j);
    maxI = imax(maxI, i); maxJ = imax(maxJ, j);
  }
  if (localCells.empty()) return;

  int addLeft = -minI, addTop = -minJ;
  int newW = maxI - minI + 1, newH = maxJ - minJ + 1;
  auto resize = [&](Body* body) {
    if (newW == body->w && newH == body->h) return;
    int oldW = body->w, oldH = body->h;
    std::vector<uint8_t> occ((size_t)newW * newH, 0);
    std::vector<uint8_t> own, peer;
    if (!body->cellMaterials.empty())
      own.assign((size_t)newW * newH, EMPTY);
    if (!body->jointPeerMaterials.empty())
      peer.assign((size_t)newW * newH, EMPTY);
    for (int j = 0; j < oldH; j++) for (int i = 0; i < oldW; i++) {
      int oldLocal = j * oldW + i;
      int local = (j + addTop) * newW + i + addLeft;
      occ[local] = body->occ[oldLocal];
      if (!own.empty()) own[local] = body->cellMaterials[oldLocal];
      if (!peer.empty()) peer[local] = body->jointPeerMaterials[oldLocal];
    }
    body->occ = std::move(occ);
    if (!own.empty()) body->cellMaterials = std::move(own);
    if (!peer.empty()) body->jointPeerMaterials = std::move(peer);
    body->w = newW; body->h = newH;
    body->offsetX -= addLeft; body->offsetY -= addTop;
  };
  Body* leader = target->jointRole == 2 ? target->jointPeer : target;
  Body* follower = leader && leader->jointRole == 1 ? leader->jointPeer : nullptr;
  resize(target);
  if (follower) resize(target == leader ? follower : leader);

  for (const auto& cell : localCells) {
    int local = (cell.second + addTop) * newW + cell.first + addLeft;
    if (target->cellMaterials.empty() && target->material != ICE) {
      target->cellMaterials.assign(target->occ.size(), EMPTY);
      for (size_t i = 0; i < target->occ.size(); i++)
        if (target->occ[i]) target->cellMaterials[i] = target->material;
    }
    target->occ[local] = 1;
    if (!target->cellMaterials.empty()) target->cellMaterials[local] = ICE;
    if (target->jointRole) {
      target->jointPeer->occ[local] = 1;
      target->jointPeer->jointPeerMaterials[local] = ICE;
    }
  }
  if (follower) {
    computeDerived(leader, true);
    computeDerived(follower, true);
    syncJointFollower(leader);
  } else {
    computeDerived(target, true);
  }

  Layer* previous = E.L;
  E.useLayer(&targetLayer);
  std::vector<int>& bodyCells = target->jointRole == 2
    ? targetLayer.passiveBodyCells : targetLayer.bodyCells;
  for (int k : cells) {
    if (k < 0 || k >= E.cols * E.rows
        || targetLayer.grid[k] != WATER || targetLayer.bodyOwner[k] >= 0)
      continue;
    E.writeGridIndex(k, ICE);
    targetLayer.bodyOwner[k] = target->id;
    bodyCells.push_back(k);
  }
  targetLayer.sleepingBodySupportDirty = true;
  if (E.bgEnabled) {
    E.comps.jointDirty = true;
    E.comps.jointBondsInvalid = true;
    E.comps.jointSupportValid = false;
  }
  E.useLayer(previous);
}
void RigidBodySystem::terrainNormalAt(Body* b, int cx, int cy, double bodyDensity, double& ox, double& oy) {
  int l = cx > 0 && isBodyTerrain(b, cx - 1, cy, bodyDensity) ? 1 : 0;
  int r = cx < E.cols - 1 && isBodyTerrain(b, cx + 1, cy, bodyDensity) ? 1 : 0;
  int u = cy > 0 && isBodyTerrain(b, cx, cy - 1, bodyDensity) ? 1 : 0;
  int d = cy < E.rows - 1 && isBodyTerrain(b, cx, cy + 1, bodyDensity) ? 1 : 0;
  double nx = l - r, ny = u - d;
  if (nx == 0 && ny == 0) {
    double bx = b->px - (cx + 0.5), by = b->py - (cy + 0.5);
    if (std::fabs(bx) > std::fabs(by)) {
      ox = bx < 0 ? -1 : 1; oy = 0;
    } else {
      ox = 0; oy = by < 0 ? -1 : 1;
    }
    return;
  }
  double inv = 1 / std::sqrt(nx * nx + ny * ny); ox = nx * inv; oy = ny * inv;
}
int RigidBodySystem::insideBodyIndex(Body* b, double wx, double wy) {
  double dx = wx - b->px, dy = wy - b->py;
  double lx = dx * b->cs + dy * b->sn, ly = -dx * b->sn + dy * b->cs;
  int i = (int)std::lround(lx - b->offsetX), j = (int)std::lround(ly - b->offsetY);
  if (i < 0 || i >= b->w || j < 0 || j >= b->h) return -1;
  int k = j * b->w + i; return b->occ[k] ? k : -1;
}
void RigidBodySystem::bodyNormalAt(Body* b, int idx, double wx, double wy, double& ox, double& oy) {
  int i = idx % b->w, j = idx / b->w; int w = b->w, h = b->h;
  auto at = [&](int ii, int jj) { return (ii < 0 || ii >= w || jj < 0 || jj >= h) ? 0 : (int)b->occ[jj * w + ii]; };
  int nlx = at(i - 1, j) - at(i + 1, j), nly = at(i, j - 1) - at(i, j + 1);
  if (nlx == 0 && nly == 0) {
    double dx = wx - b->px, dy = wy - b->py;
    double lx = dx * b->cs + dy * b->sn;
    double ly = -dx * b->sn + dy * b->cs;
    int left = 1, right = 1, up = 1, down = 1;
    while (at(i - left, j)) left++;
    while (at(i + right, j)) right++;
    while (at(i, j - up)) up++;
    while (at(i, j + down)) down++;
    double dl = lx - (b->offsetX + i - left + 0.5);
    double dr = b->offsetX + i + right - 0.5 - lx;
    double du = ly - (b->offsetY + j - up + 0.5);
    double dd = b->offsetY + j + down - 0.5 - ly;
    nlx = -1; nly = 0; double nearest = dl;
    if (dr < nearest) { nearest = dr; nlx = 1; nly = 0; }
    if (du < nearest) { nearest = du; nlx = 0; nly = -1; }
    if (dd < nearest) { nlx = 0; nly = 1; }
  }
  double wx2 = nlx * b->cs - nly * b->sn, wy2 = nlx * b->sn + nly * b->cs;
  double inv = 1 / std::sqrt(wx2 * wx2 + wy2 * wy2); ox = wx2 * inv; oy = wy2 * inv;
}
double RigidBodySystem::resolveContact(Contact& c) {
  return resolveContactNormal(c) + resolveContactFriction(c);
}
double RigidBodySystem::resolveContactNormal(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double aInvM = A->awake ? A->invMass : 0, aInvI = A->awake ? A->invInertia : 0;
  double bInvM = (B && B->awake) ? B->invMass : 0, bInvI = (B && B->awake) ? B->invInertia : 0;
  double rvx = A->vx - A->omega * c.ray, rvy = A->vy + A->omega * c.rax;
  if (B) { rvx -= B->vx - B->omega * c.rby; rvy -= B->vy + B->omega * c.rbx; }
  double vn = rvx * c.nx + rvy * c.ny;
  double movedN = 0;
  if (c.normalMass > 0) {
    double delta = (c.targetVn - vn) * c.normalMass;
    double newJn = c.accJn + delta; if (newJn < 0) newJn = 0;
    double applied = newJn - c.accJn; c.accJn = newJn;
    movedN = std::fabs(applied);
    double jx = applied * c.nx, jy = applied * c.ny;
    A->vx += jx * aInvM; A->vy += jy * aInvM; A->omega += aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B->vx -= jx * bInvM; B->vy -= jy * bInvM; B->omega -= bInvI * (c.rbx * jy - c.rby * jx); }
  }
  return movedN;
}
double RigidBodySystem::resolveContactFriction(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double aInvM = A->awake ? A->invMass : 0, aInvI = A->awake ? A->invInertia : 0;
  double bInvM = (B && B->awake) ? B->invMass : 0, bInvI = (B && B->awake) ? B->invInertia : 0;
  double tx = -c.ny, ty = c.nx;
  double rtvx = A->vx - A->omega * c.ray, rtvy = A->vy + A->omega * c.rax;
  if (B) { rtvx -= B->vx - B->omega * c.rby; rtvy -= B->vy + B->omega * c.rbx; }
  double vt = rtvx * tx + rtvy * ty;
  double movedT = 0;
  if (c.tangentMass > 0) {
    double candidate = c.accJt - vt * c.tangentMass;
    double coefficient = std::fabs(vt) <= R_STATIC_FRICTION_SPEED
      ? c.staticFriction : c.dynamicFriction;
    double limit = coefficient * c.accJn;
    double newJt = candidate;
    if (newJt > limit) newJt = limit;
    else if (newJt < -limit) newJt = -limit;
    double applied = newJt - c.accJt; c.accJt = newJt;
    movedT = std::fabs(applied);
    double jx = applied * tx, jy = applied * ty;
    A->vx += jx * aInvM; A->vy += jy * aInvM; A->omega += aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B->vx -= jx * bInvM; B->vy -= jy * bInvM; B->omega -= bInvI * (c.rbx * jy - c.rby * jx); }
  }
  return movedT;
}
double RigidBodySystem::resolveContactBlock(Contact& first, Contact& second) {
  Body* A = first.a;
  Body* B = first.b;
  double spanX = (A->px + first.rax) - (A->px + second.rax);
  double spanY = (A->py + first.ray) - (A->py + second.ray);
  if (second.a != A || second.b != B
      || first.nx * second.nx + first.ny * second.ny < 0.99
      || first.targetVn > 0 || second.targetVn > 0
      || spanX * spanX + spanY * spanY < R_BLOCK_SOLVE_MIN_SPAN2)
    return resolveContact(first) + resolveContact(second);
  double aInvM = A->awake ? A->invMass : 0;
  double aInvI = A->awake ? A->invInertia : 0;
  double bInvM = B && B->awake ? B->invMass : 0;
  double bInvI = B && B->awake ? B->invInertia : 0;
  auto normalVelocity = [&](const Contact& contact) {
    double rvx = A->vx - A->omega * contact.ray;
    double rvy = A->vy + A->omega * contact.rax;
    if (B) {
      rvx -= B->vx - B->omega * contact.rby;
      rvy -= B->vy + B->omega * contact.rbx;
    }
    return rvx * contact.nx + rvy * contact.ny;
  };
  double rnA1 = first.rax * first.ny - first.ray * first.nx;
  double rnA2 = second.rax * second.ny - second.ray * second.nx;
  double rnB1 = B ? first.rbx * first.ny - first.rby * first.nx : 0;
  double rnB2 = B ? second.rbx * second.ny - second.rby * second.nx : 0;
  double k11 = aInvM + bInvM + aInvI * rnA1 * rnA1 + bInvI * rnB1 * rnB1;
  double k22 = aInvM + bInvM + aInvI * rnA2 * rnA2 + bInvI * rnB2 * rnB2;
  double k12 = aInvM + bInvM + aInvI * rnA1 * rnA2 + bInvI * rnB1 * rnB2;
  double determinant = k11 * k22 - k12 * k12;
  double largestMass = std::fmax(k11, k22);
  if (k11 <= 0 || k22 <= 0
      || determinant <= 1e-3 * largestMass * largestMass)
    return resolveContact(first) + resolveContact(second);

  double old1 = first.accJn, old2 = second.accJn;
  double b1 = normalVelocity(first) - first.targetVn - k11 * old1 - k12 * old2;
  double b2 = normalVelocity(second) - second.targetVn - k12 * old1 - k22 * old2;
  double next1 = 0, next2 = 0;
  bool solved = false;

  double invDet = 1 / determinant;
  double both1 = (k12 * b2 - k22 * b1) * invDet;
  double both2 = (k12 * b1 - k11 * b2) * invDet;
  if (both1 >= 0 && both2 >= 0) {
    next1 = both1;
    next2 = both2;
    solved = true;
  }
  if (!solved) {
    double one = -b1 / k11;
    if (one >= 0 && k12 * one + b2 >= 0) {
      next1 = one;
      next2 = 0;
      solved = true;
    }
  }
  if (!solved) {
    double two = -b2 / k22;
    if (two >= 0 && k12 * two + b1 >= 0) {
      next1 = 0;
      next2 = two;
      solved = true;
    }
  }
  if (!solved && b1 >= 0 && b2 >= 0) solved = true;
  if (!solved) return resolveContact(first) + resolveContact(second);

  rigidBlockSolves++;
  double delta1 = next1 - old1;
  double delta2 = next2 - old2;
  first.accJn = next1;
  second.accJn = next2;
  double jx = delta1 * first.nx + delta2 * second.nx;
  double jy = delta1 * first.ny + delta2 * second.ny;
  A->vx += jx * aInvM;
  A->vy += jy * aInvM;
  A->omega += aInvI
    * (delta1 * (first.rax * first.ny - first.ray * first.nx)
       + delta2 * (second.rax * second.ny - second.ray * second.nx));
  if (B) {
    B->vx -= jx * bInvM;
    B->vy -= jy * bInvM;
    B->omega -= bInvI
      * (delta1 * (first.rbx * first.ny - first.rby * first.nx)
         + delta2 * (second.rbx * second.ny - second.rby * second.nx));
  }
  return std::fabs(delta1) + std::fabs(delta2)
    + resolveContactFriction(first) + resolveContactFriction(second);
}
void RigidBodySystem::applyWarmStart(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double aInvM = A->awake ? A->invMass : 0, aInvI = A->awake ? A->invInertia : 0;
  double bInvM = (B && B->awake) ? B->invMass : 0, bInvI = (B && B->awake) ? B->invInertia : 0;
  double tx = -c.ny, ty = c.nx;
  double jx = c.accJn * c.nx + c.accJt * tx;
  double jy = c.accJn * c.ny + c.accJt * ty;
  A->vx += jx * aInvM; A->vy += jy * aInvM;
  A->omega += aInvI * (c.rax * jy - c.ray * jx);
  if (B) {
    B->vx -= jx * bInvM; B->vy -= jy * bInvM;
    B->omega -= bInvI * (c.rbx * jy - c.rby * jx);
  }
}
double RigidBodySystem::resolveBias(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  bool precisePair = B && rigidLargeSlenderBody(A)
                       && rigidLargeSlenderBody(B);
  double slop = precisePair ? R_BODY_PEN_SLOP : R_PEN_SLOP;
  double bias = R_BAUMGARTE * std::fmax(0.0, c.depth - slop);
  if (bias <= 0) return 0; if (bias > R_MAX_BIAS_VEL) bias = R_MAX_BIAS_VEL;
  double aInvM = A->awake ? A->invMass : 0, aInvI = A->awake ? A->invInertia : 0;
  double bInvM = (B && B->awake && c.bIntegrated) ? B->invMass : 0;
  double bInvI = (B && B->awake && c.bIntegrated) ? B->invInertia : 0;
  double rvx = A->pvx - A->pw * c.ray, rvy = A->pvy + A->pw * c.rax;
  if (B && c.bIntegrated) {
    rvx -= B->pvx - B->pw * c.rby;
    rvy -= B->pvy + B->pw * c.rbx;
  }
  double vn = rvx * c.nx + rvy * c.ny; if (vn >= bias) return 0;
  if (c.biasMass <= 0) return 0;
  double delta = (bias - vn) * c.biasMass;
  double newJ = c.accBias + delta; if (newJ < 0) newJ = 0;
  double applied = newJ - c.accBias; c.accBias = newJ;
  double jx = applied * c.nx, jy = applied * c.ny;
  A->pvx += jx * aInvM; A->pvy += jy * aInvM; A->pw += aInvI * (c.rax * jy - c.ray * jx);
  if (B && c.bIntegrated) {
    B->pvx -= jx * bInvM;
    B->pvy -= jy * bInvM;
    B->pw -= bInvI * (c.rbx * jy - c.rby * jx);
  }
  return std::fabs(applied);
}
void RigidBodySystem::wakeBody(Body* b) {
  if (b->jointRole == 2 && b->jointPeer) b = b->jointPeer;
  b->awake = true;
  b->stillTicks = 0;
  if (b->jointRole == 1) syncJointFollower(b);
}
void RigidBodySystem::syncJointFollower(Body* leader) {
  if (!leader || leader->jointRole != 1 || !leader->jointPeer) return;
  Body* follower = leader->jointPeer;
  follower->px = leader->px; follower->py = leader->py; follower->angle = leader->angle;
  follower->vx = leader->vx; follower->vy = leader->vy; follower->omega = leader->omega;
  follower->awake = leader->awake; follower->stillTicks = leader->stillTicks;
  follower->cs = leader->cs; follower->sn = leader->sn;
}
void RigidBodySystem::breakJointBody(Body* member) {
  if (!member || !member->jointRole || !member->jointPeer) return;
  Body* leader = member->jointRole == 1 ? member : member->jointPeer;
  Body* follower = leader->jointPeer;
  syncJointFollower(leader);
  auto keepOwnLayer = [&](Body* body) {
    for (size_t i = 0; i < body->occ.size(); i++)
      body->occ[i] = body->cellMaterials[i] != EMPTY;
    body->jointPeerMaterials.clear();
    body->jointPeer = nullptr;
    body->jointRole = 0;
    computeDerived(body, true);
  };
  keepOwnLayer(leader);
  keepOwnLayer(follower);
  E.bg.passiveBodyIds.erase(follower->id);
  std::vector<int> stillPassive;
  stillPassive.reserve(E.bg.passiveBodyCells.size());
  for (int k : E.bg.passiveBodyCells) {
    if (k >= 0 && k < E.cols * E.rows && E.bg.bodyOwner[k] == follower->id)
      E.bg.bodyCells.push_back(k);
    else
      stillPassive.push_back(k);
  }
  E.bg.passiveBodyCells = std::move(stillPassive);
}
void RigidBodySystem::rigidStep(double tickDt) {
  rigidSubsteps = rigidContacts = rigidWarmStarted = 0;
  rigidVelocityIterations = rigidBiasIterations = 0;
  rigidIslands = rigidBlockSolves = 0;
  rigidIslandBodySteps = rigidGlobalBodySteps = 0;
  rigidChildPairs = rigidChildManifolds = rigidSweepFallbacks = 0;
  rigidMaxChildren = 0;
  rigidMaxContactDepth = 0;
  std::vector<Body*> solverBodies;
  solverBodies.reserve(E.L->bodies.size());
  for (Body* body : E.L->bodies)
    if (body->jointRole != 2) solverBodies.push_back(body);
  for (Body* body : solverBodies)
    rigidMaxChildren = imax(rigidMaxChildren, (int)body->collisionRects.size());
  int n = (int)solverBodies.size();
  std::vector<int> islandParent(n);
  std::vector<double> islandMinStill(n);
  std::vector<uint8_t> liquidContact(n, 0);
  std::vector<uint8_t> liquidSurfaceContact(n, 0);
  std::vector<uint8_t> fluidOnlySleep(n, 0);
  std::vector<uint8_t> awakeBeforeLiquid(n, 0);
  std::vector<double> vyBeforeLiquid(n, 0), predictedLiquidVy(n, 0);
  for (int bi = 0; bi < n; bi++) {
    Body* body = solverBodies[bi];
    awakeBeforeLiquid[bi] = body->awake ? 1 : 0;
    vyBeforeLiquid[bi] = body->vy;
    if (body->awake) body->vy += E.scaledGravity(R_GRAVITY) * tickDt;
    predictedLiquidVy[bi] = body->vy;
    body->cs = std::cos(body->angle);
    body->sn = std::sin(body->angle);
    body->hadContact = false;
    body->idx = bi;
  }
  bool coupledLiquid = coupleLiquids(solverBodies, tickDt);
  for (int bi = 0; bi < n; bi++) {
    Body* body = solverBodies[bi];
    liquidContact[bi] = body->hadContact;
    if (bi < (int)fluidBodySurface.size())
      liquidSurfaceContact[bi] = fluidBodySurface[bi];
    if (!coupledLiquid)
      body->vy = vyBeforeLiquid[bi];
    else if (awakeBeforeLiquid[bi])
      body->vy = vyBeforeLiquid[bi] + (body->vy - predictedLiquidVy[bi]);
  }
  auto bodyBounds = [](Body* body, double margin,
                       double& x0, double& y0, double& x1, double& y1) {
    double cs = body->cs, sn = body->sn;
    double lx0 = body->offsetX - 0.5;
    double lx1 = body->offsetX + body->w - 0.5;
    double ly0 = body->offsetY - 0.5;
    double ly1 = body->offsetY + body->h - 0.5;
    x0 = y0 = 1e18;
    x1 = y1 = -1e18;
    auto include = [&](double lx, double ly) {
      double wx = body->px + lx * cs - ly * sn;
      double wy = body->py + lx * sn + ly * cs;
      x0 = std::fmin(x0, wx);
      x1 = std::fmax(x1, wx);
      y0 = std::fmin(y0, wy);
      y1 = std::fmax(y1, wy);
    };
    include(lx0, ly0);
    include(lx1, ly0);
    include(lx1, ly1);
    include(lx0, ly1);
    x0 -= margin;
    y0 -= margin;
    x1 += margin;
    y1 += margin;
  };
  // Build conservative tick islands before sub-stepping. Candidate bodies share
  // one cadence; unrelated slow islands no longer inherit the fastest body's
  // rotational or translational substep count.
  std::vector<int> stepIslandParent(n), bodySubsteps(n, 1);
  double globalPointSpeed = 0;
  for (int bi = 0; bi < n; bi++) {
    stepIslandParent[bi] = bi;
    Body* body = solverBodies[bi];
    double pointSpeed = body->awake
      ? std::hypot(body->vx, body->vy)
        + std::fabs(body->omega) * std::fmax(1.0, body->maxR)
      : 0;
    globalPointSpeed = std::fmax(globalPointSpeed, pointSpeed);
  }
  int substeps = (int)std::ceil(
    (globalPointSpeed + E.scaledGravity(R_GRAVITY) * tickDt) / R_SAFE_SUBSTEP);
  substeps = imax(1, imin(R_MAX_SUBSTEPS, substeps));
  if (substeps == 1) {
    rigidIslands = n;
  } else {
    std::vector<int> islandOrder(n);
    std::vector<double> tickX0(n), tickY0(n), tickX1(n), tickY1(n);
    for (int bi = 0; bi < n; bi++) {
      islandOrder[bi] = bi;
      Body* body = solverBodies[bi];
      double pointSpeed = body->awake
        ? std::hypot(body->vx, body->vy)
          + std::fabs(body->omega) * std::fmax(1.0, body->maxR)
        : 0;
      double reach = (pointSpeed + R_MAX_SPEED + E.scaledGravity(R_GRAVITY) * tickDt) * tickDt
        + R_CONTACT_SKIN + 0.5;
      bodyBounds(body, reach,
                 tickX0[bi], tickY0[bi], tickX1[bi], tickY1[bi]);
    }
    std::sort(islandOrder.begin(), islandOrder.end(), [&](int a, int b) {
      if (tickX0[a] != tickX0[b]) return tickX0[a] < tickX0[b];
      return a < b;
    });
    for (int oi = 0; oi < n; oi++) {
      int a = islandOrder[oi];
      for (int oj = oi + 1; oj < n; oj++) {
        int b = islandOrder[oj];
        if (tickX0[b] > tickX1[a]) break;
        if (tickY1[a] < tickY0[b] || tickY1[b] < tickY0[a]) continue;
        ufUnite(stepIslandParent, a, b);
      }
    }
    std::vector<double> islandPointSpeed(n, 0);
    std::vector<int> islandBodyCount(n, 0), islandSubsteps(n, 1);
    for (int bi = 0; bi < n; bi++) {
      int root = ufFind(stepIslandParent, bi);
      Body* body = solverBodies[bi];
      islandBodyCount[root]++;
      if (!body->awake) continue;
      double pointSpeed = std::hypot(body->vx, body->vy)
        + std::fabs(body->omega) * std::fmax(1.0, body->maxR);
      islandPointSpeed[root] = std::fmax(islandPointSpeed[root], pointSpeed);
    }
    substeps = 1;
    for (int root = 0; root < n; root++) {
      if (islandBodyCount[root] == 0) continue;
      rigidIslands++;
      int count = (int)std::ceil(
        (islandPointSpeed[root] + E.scaledGravity(R_GRAVITY) * tickDt) / R_SAFE_SUBSTEP);
      count = imax(1, imin(R_MAX_SUBSTEPS, count));
      islandSubsteps[root] = count;
      substeps = imax(substeps, count);
    }
    for (int bi = 0; bi < n; bi++)
      bodySubsteps[bi] = islandSubsteps[ufFind(stepIslandParent, bi)];
  }
  rigidSubsteps = substeps;
  rigidGlobalBodySteps = n * substeps;
  std::vector<Contact>& contacts = solverContactScratch;
  contacts.clear();
  int nc = 0;
  std::vector<uint8_t> actorSweepOverlap(n, 0);
  std::vector<uint8_t> solidContact(n, 0);
  std::vector<int> solveParent(n), solveBodyCount(n);
  std::vector<int> contactOrder, contactRoot;
  std::vector<double> solveMaxRadius(n);
  std::vector<uint8_t> solveHasGeneral(n);
  struct PenPt {
    double wx, wy, nx, ny, depth;
    int bk = 0;
    int childA = -1, childB = -1;
    int featureA = -1, featureB = -1;
  };
  struct TerrainGroup { Body* peer; std::vector<PenPt> points; };
  std::vector<PenPt> penAcc, terrAcc;
  std::vector<Body*> terrPeers;
  std::vector<TerrainGroup> terrGroups;
  auto addSlenderObbManifold = [&](Body* first, Body* second,
                                   std::vector<PenPt>& points,
                                   double& referenceX, double& referenceY) {
    if (points.empty()) return false;
    struct Frame {
      double cx, cy, ax, ay, nx, ny, halfMajor, halfMinor;
      bool slender;
    };
    auto frame = [](Body* body) {
      Frame result{};
      result.slender = rigidLargeSlenderBody(body);
      bool horizontal = body->w >= body->h;
      result.ax = horizontal ? body->cs : -body->sn;
      result.ay = horizontal ? body->sn : body->cs;
      result.nx = -result.ay;
      result.ny = result.ax;
      result.halfMajor = (horizontal ? body->w : body->h) * 0.5;
      result.halfMinor = (horizontal ? body->h : body->w) * 0.5;
      double localX = body->offsetX + (body->w - 1) * 0.5;
      double localY = body->offsetY + (body->h - 1) * 0.5;
      result.cx = body->px + localX * body->cs - localY * body->sn;
      result.cy = body->py + localX * body->sn + localY * body->cs;
      return result;
    };
    Frame a = frame(first), b = frame(second);
    if (!a.slender || !b.slender)
      return false;
    auto extent = [](const Frame& shape, double x, double y) {
      return std::fabs(x * shape.ax + y * shape.ay) * shape.halfMajor
           + std::fabs(x * shape.nx + y * shape.ny) * shape.halfMinor;
    };
    const double axes[4][2] = {
      {a.ax, a.ay}, {a.nx, a.ny}, {b.ax, b.ay}, {b.nx, b.ny},
    };
    double normalX = 0, normalY = -1, minimumOverlap = 1e18;
    for (const auto& axis : axes) {
      double delta = (a.cx - b.cx) * axis[0]
                   + (a.cy - b.cy) * axis[1];
      double overlap = extent(a, axis[0], axis[1])
                     + extent(b, axis[0], axis[1])
                     - std::fabs(delta);
      if (overlap <= 0) return false;
      if (overlap >= minimumOverlap) continue;
      minimumOverlap = overlap;
      normalX = axis[0];
      normalY = axis[1];
      if (std::fabs(delta) < 1e-6) {
        double relative = (first->vx - second->vx) * normalX
                        + (first->vy - second->vy) * normalY;
        delta = relative <= 0 ? 1 : -1;
      }
      if (delta < 0) {
        normalX = -normalX;
        normalY = -normalY;
      }
    }
    referenceX = normalX;
    referenceY = normalY;
    double deepestRaster = 0;
    for (const PenPt& point : points)
      deepestRaster = std::fmax(deepestRaster, point.depth);
    double alignment = std::fabs(a.ax * b.ax + a.ay * b.ay);
    // Crossed pairs and sparse masks keep only their raster anchors. A span
    // manifold is safe when each occupied union closely fits its local bounds.
    if (alignment < R_SLENDER_PARALLEL_COS) return true;
    if (!rigidTightSlenderBounds(first)
        || !rigidTightSlenderBounds(second)) return true;
    double tangentX = -normalY, tangentY = normalX;
    double aTangent = a.cx * tangentX + a.cy * tangentY;
    double bTangent = b.cx * tangentX + b.cy * tangentY;
    double aTangentExtent = extent(a, tangentX, tangentY);
    double bTangentExtent = extent(b, tangentX, tangentY);
    double lo = std::fmax(aTangent - aTangentExtent,
                          bTangent - bTangentExtent);
    double hi = std::fmin(aTangent + aTangentExtent,
                          bTangent + bTangentExtent);
    if (hi <= lo) return true;
    double aNormal = a.cx * normalX + a.cy * normalY;
    double bNormal = b.cx * normalX + b.cy * normalY;
    double aNormalExtent = extent(a, normalX, normalY);
    double bNormalExtent = extent(b, normalX, normalY);
    double depth = std::fmin(4.5, deepestRaster);
    double plane = ((aNormal - aNormalExtent)
                  + (bNormal + bNormalExtent)) * 0.5;
    points.push_back({
      tangentX * lo + normalX * plane,
      tangentY * lo + normalY * plane,
      normalX, normalY, depth, 0,
    });
    if (hi - lo >= 1) {
      points.push_back({
        tangentX * hi + normalX * plane,
        tangentY * hi + normalY * plane,
        normalX, normalY, depth, 0,
      });
    }
    return true;
  };
  std::vector<int>& broadphaseOrder = broadphaseOrderScratch;
  std::vector<std::pair<int, int>>& broadphasePairs = broadphasePairScratch;
  broadphaseOrder.clear();
  broadphasePairs.clear();
  if (broadphasePairs.capacity() < (size_t)n * 4)
    broadphasePairs.reserve((size_t)n * 4);
  int activeLayer = E.L == &E.fg ? 0 : 1;
  std::unordered_map<int, int> bodyIndexById;
  bodyIndexById.reserve((size_t)n * 2);
  for (int i = 0; i < n; i++) bodyIndexById[solverBodies[i]->id] = i;
  std::vector<uint8_t> broadphaseSeen(n, 0);
  for (int id : broadphaseBodyIds[activeLayer]) {
    auto it = bodyIndexById.find(id);
    if (it == bodyIndexById.end() || broadphaseSeen[it->second]) continue;
    broadphaseSeen[it->second] = 1;
    broadphaseOrder.push_back(it->second);
  }
  for (int i = 0; i < n; i++)
    if (!broadphaseSeen[i]) broadphaseOrder.push_back(i);
  ContactCache& previousContacts = contactCaches[activeLayer];
  auto& activePairAxes = pairAxes[activeLayer];
  auto bodyPairKey = [](int aId, int bId) {
    return ((uint64_t)(uint32_t)aId << 32) | (uint32_t)bId;
  };
  for (auto it = activePairAxes.begin(); it != activePairAxes.end();) {
    if (it->second.age >= 4) it = activePairAxes.erase(it);
    else {
      it->second.age++;
      ++it;
    }
  }
  auto cacheKey = [&](const Contact& contact, int normalBucket) {
    bool peerLayer = contact.b && !contact.bIntegrated;
    return ContactCacheKey{
      contact.a->id,
      contact.b ? contact.b->id : -1,
      contact.childA,
      contact.childB,
      contact.featureA,
      contact.featureB,
      contact.a->geometryRevision,
      contact.b ? contact.b->geometryRevision : 0,
      (uint8_t)normalBucket,
      (uint8_t)(contact.b ? (peerLayer ? 1 - activeLayer : activeLayer) : 2),
      (uint8_t)(contact.a->maxR >= 24
        || (contact.b && contact.b->maxR >= 24)),
    };
  };
  auto localAnchors = [](const Contact& contact, double& lax, double& lay,
                         double& lbx, double& lby) {
    Body* A = contact.a;
    lax = contact.rax * A->cs + contact.ray * A->sn;
    lay = -contact.rax * A->sn + contact.ray * A->cs;
    lbx = lby = 0;
    if (!contact.b) return;
    Body* B = contact.b;
    double bcs = contact.bIntegrated ? B->cs : std::cos(B->angle);
    double bsn = contact.bIntegrated ? B->sn : std::sin(B->angle);
    lbx = contact.rbx * bcs + contact.rby * bsn;
    lby = -contact.rbx * bsn + contact.rby * bcs;
  };
  auto restoreContact = [&](Contact& contact, int normalBucket, double dt) {
    auto found = previousContacts.find(cacheKey(contact, normalBucket));
    if (found == previousContacts.end()) return;
    double lax, lay, lbx, lby;
    localAnchors(contact, lax, lay, lbx, lby);
    CachedContact* best = nullptr;
    double bestDistance = 1e18;
    for (CachedContact& cached : found->second) {
      if (cached.used || cached.nx * contact.nx + cached.ny * contact.ny < 0.7)
        continue;
      double dax = cached.lax - lax, day = cached.lay - lay;
      double aDistance = dax * dax + day * day;
      if (aDistance > R_CONTACT_CACHE_MATCH2) continue;
      double distance = aDistance;
      if (contact.b) {
        double dbx = cached.lbx - lbx, dby = cached.lby - lby;
        double bDistance = dbx * dbx + dby * dby;
        if (bDistance > R_CONTACT_CACHE_MATCH2) continue;
        distance += bDistance;
      }
      if (distance < bestDistance) {
        best = &cached;
        bestDistance = distance;
      }
    }
    if (!best) return;
    best->used = true;
    double dtRatio = best->dt > 0 ? dt / best->dt : 1;
    if (dtRatio < 0.25) dtRatio = 0.25;
    else if (dtRatio > 4) dtRatio = 4;
    contact.accJn = std::fmax(0.0, best->jn * dtRatio * R_WARM_START_FACTOR);
    double maxFriction = contact.staticFriction * contact.accJn;
    contact.accJt = best->jt * dtRatio * R_WARM_START_FACTOR;
    if (contact.accJt > maxFriction) contact.accJt = maxFriction;
    else if (contact.accJt < -maxFriction) contact.accJt = -maxFriction;
    contact.persisted = true;
    contact.targetVn = 0;
  };
  // Each layer owns its integration pass, but a joint body's collision shape is
  // present in both grids. Resolve owner-marked contacts against the peer's real
  // dynamics while leaving positional integration to that body's owning pass.
  std::unordered_map<int, Body*> peerBackgroundBodies;
  std::unordered_map<int, Body*> peerJointLeaders;
  if (E.bgEnabled) {
    if (E.L == &E.fg) {
      bool hasJointLeader = false;
      for (Body* body : solverBodies)
        if (body->jointRole == 1) { hasJointLeader = true; break; }
      if (hasJointLeader)
        for (Body* peer : E.bg.bodies)
          if (peer->jointRole == 0) peerBackgroundBodies[peer->id] = peer;
    } else if (!E.bg.passiveBodyIds.empty()) {
      for (Body* leader : E.fg.bodies)
        if (leader->jointRole == 1) peerJointLeaders[leader->id] = leader;
    }
  }
  auto peerDynamicBodyAt = [&](Body* body, int x, int y) -> Body* {
    if (!E.bgEnabled || x < 0 || x >= E.cols || y < 0 || y >= E.rows)
      return nullptr;
    int k = y * E.cols + x;
    if (E.L == &E.fg && body->jointRole == 1) {
      int owner = E.bg.bodyOwner[k];
      if (owner < 0 || owner == body->id
          || E.bg.passiveBodyIds.count(owner)) return nullptr;
      auto it = peerBackgroundBodies.find(owner);
      return it == peerBackgroundBodies.end() ? nullptr : it->second;
    }
    if (E.L == &E.bg && body->jointRole == 0) {
      int owner = E.bg.bodyOwner[k];
      if (owner < 0 || !E.bg.passiveBodyIds.count(owner)) return nullptr;
      auto it = peerJointLeaders.find(owner);
      return it == peerJointLeaders.end() ? nullptr : it->second;
    }
    return nullptr;
  };
  auto bodyUsesPeerContacts = [&](Body* body) {
    return (E.L == &E.fg && body->jointRole == 1
            && !peerBackgroundBodies.empty())
        || (E.L == &E.bg && body->jointRole == 0
            && !peerJointLeaders.empty());
  };
  double wpx, wpy, nx_, ny_;
  auto sweptPoint = [](Body* body, double lx, double ly, double t,
                       double& wx, double& wy) {
    double angle = body->angle + body->omega * t;
    double cs = std::cos(angle), sn = std::sin(angle);
    wx = body->px + body->vx * t + lx * cs - ly * sn;
    wy = body->py + body->vy * t + lx * sn + ly * cs;
  };
  auto insideBodyAt = [](Body* body, double wx, double wy, double t) {
    double angle = body->angle + body->omega * t;
    double cs = std::cos(angle), sn = std::sin(angle);
    double dx = wx - body->px - body->vx * t;
    double dy = wy - body->py - body->vy * t;
    double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    int i = (int)std::lround(lx - body->offsetX);
    int j = (int)std::lround(ly - body->offsetY);
    if (i < 0 || i >= body->w || j < 0 || j >= body->h) return -1;
    int local = j * body->w + i;
    return body->occ[local] ? local : -1;
  };
  auto bodyNormalAtTime = [](Body* body, int idx, double wx, double wy,
                             double t, double& ox, double& oy) {
    int i = idx % body->w, j = idx / body->w;
    auto at = [&](int ii, int jj) {
      return ii < 0 || ii >= body->w || jj < 0 || jj >= body->h
        ? 0 : (int)body->occ[jj * body->w + ii];
    };
    int nlx = at(i - 1, j) - at(i + 1, j);
    int nly = at(i, j - 1) - at(i, j + 1);
    double angle = body->angle + body->omega * t;
    double cs = std::cos(angle), sn = std::sin(angle);
    if (nlx == 0 && nly == 0) {
      double dx = wx - body->px - body->vx * t;
      double dy = wy - body->py - body->vy * t;
      double lx = dx * cs + dy * sn;
      double ly = -dx * sn + dy * cs;
      int left = 1, right = 1, up = 1, down = 1;
      while (at(i - left, j)) left++;
      while (at(i + right, j)) right++;
      while (at(i, j - up)) up++;
      while (at(i, j + down)) down++;
      double dl = lx - (body->offsetX + i - left + 0.5);
      double dr = body->offsetX + i + right - 0.5 - lx;
      double du = ly - (body->offsetY + j - up + 0.5);
      double dd = body->offsetY + j + down - 0.5 - ly;
      nlx = -1; nly = 0; double nearest = dl;
      if (dr < nearest) { nearest = dr; nlx = 1; nly = 0; }
      if (du < nearest) { nearest = du; nlx = 0; nly = -1; }
      if (dd < nearest) { nlx = 0; nly = 1; }
    }
    double nx = nlx * cs - nly * sn;
    double ny = nlx * sn + nly * cs;
    double inv = 1 / std::sqrt(nx * nx + ny * ny);
    ox = nx * inv;
    oy = ny * inv;
  };
  auto needsExactAngularSweep = [](Body* body) {
    if (std::fabs(body->omega) < 1e-8) return false;
    return body->maxR >= 24;
  };
  auto pairSeparatingDirection = [](Body* first, Body* second,
                                    double& ox, double& oy) {
    bool firstSlender = rigidLargeSlenderBody(first);
    bool secondSlender = rigidLargeSlenderBody(second);
    if (firstSlender && secondSlender) {
      double firstAngle = first->angle + (first->h > first->w ? M_PI * 0.5 : 0);
      double secondAngle = second->angle + (second->h > second->w ? M_PI * 0.5 : 0);
      double fax = std::cos(firstAngle), fay = std::sin(firstAngle);
      double sax = std::cos(secondAngle), say = std::sin(secondAngle);
      double alignment = fax * sax + fay * say;
      if (alignment < 0) {
        sax = -sax;
        say = -say;
        alignment = -alignment;
      }
      if (alignment >= R_SLENDER_PARALLEL_COS) {
        double axisX = fax + sax, axisY = fay + say;
        double axisLength = std::hypot(axisX, axisY);
        if (axisLength > 1e-9) {
          axisX /= axisLength;
          axisY /= axisLength;
          ox = -axisY;
          oy = axisX;
          double projection = (first->px - second->px) * ox
                            + (first->py - second->py) * oy;
          if (std::fabs(projection) < 1e-6)
            projection = -((first->vx - second->vx) * ox
                         + (first->vy - second->vy) * oy);
          if (projection < 0) {
            ox = -ox;
            oy = -oy;
          }
          return;
        }
      }
    }
    if (firstSlender != secondSlender) {
      Body* slender = firstSlender ? first : second;
      bool horizontal = slender->w >= slender->h;
      double axisX = horizontal ? slender->cs : -slender->sn;
      double axisY = horizontal ? slender->sn : slender->cs;
      ox = -axisY;
      oy = axisX;
      double projection = (first->px - second->px) * ox
                        + (first->py - second->py) * oy;
      if (std::fabs(projection) < 1e-6)
        projection = -((first->vx - second->vx) * ox
                     + (first->vy - second->vy) * oy);
      if (projection < 0) {
        ox = -ox;
        oy = -oy;
      }
      return;
    }
    ox = first->px - second->px;
    oy = first->py - second->py;
    double length = std::hypot(ox, oy);
    if (length < 1e-9) {
      ox = 0;
      oy = -1;
    } else {
      ox /= length;
      oy /= length;
    }
  };
  struct ChildFrame {
    Body* body = nullptr;
    const BodyCollisionRect* rect = nullptr;
    int child = -1;
    double px = 0, py = 0;
    double ux = 1, uy = 0, vx = 0, vy = 1;
    double cx = 0, cy = 0, hx = 0, hy = 0;
  };
  struct ChildManifold {
    PenPt points[2];
    int count = 0;
  };
  struct ChildBounds {
    double minX = 0, minY = 0, maxX = 0, maxY = 0;
  };
  struct ChildEvent {
    double position = 0;
    int child = -1;
    bool fromA = false;
    bool start = false;
  };
  std::vector<ChildManifold> childManifoldScratch;
  std::vector<ChildFrame> currentChildFramesA, currentChildFramesB;
  std::vector<ChildFrame> nextChildFramesA, nextChildFramesB;
  std::vector<ChildBounds> childBoundsA, childBoundsB;
  std::vector<ChildEvent> childEventScratch;
  std::vector<int> activeChildrenA, activeChildrenB;
  std::vector<std::pair<int, int>> childPairScratch;
  auto collectChildFrames = [](Body* body, double time,
                               std::vector<ChildFrame>& frames) {
    frames.resize(body->collisionRects.size());
    double angle = body->angle + body->omega * time;
    double ux = std::cos(angle), uy = std::sin(angle);
    double vx = -uy, vy = ux;
    double px = body->px + body->vx * time;
    double py = body->py + body->vy * time;
    for (int child = 0; child < (int)frames.size(); child++) {
      ChildFrame& frame = frames[child];
      frame.body = body;
      frame.rect = &body->collisionRects[child];
      frame.child = child;
      frame.ux = ux;
      frame.uy = uy;
      frame.vx = vx;
      frame.vy = vy;
      frame.px = px;
      frame.py = py;
      double lx = body->offsetX
        + (frame.rect->x0 + frame.rect->x1 - 1) * 0.5;
      double ly = body->offsetY
        + (frame.rect->y0 + frame.rect->y1 - 1) * 0.5;
      frame.cx = px + lx * ux + ly * vx;
      frame.cy = py + lx * uy + ly * vy;
      frame.hx = (frame.rect->x1 - frame.rect->x0) * 0.5;
      frame.hy = (frame.rect->y1 - frame.rect->y0) * 0.5;
    }
  };
  auto childFramesOverlap = [](const ChildFrame& a, const ChildFrame& b) {
    double aExtentX = std::fabs(a.ux) * a.hx + std::fabs(a.vx) * a.hy;
    double aExtentY = std::fabs(a.uy) * a.hx + std::fabs(a.vy) * a.hy;
    double bExtentX = std::fabs(b.ux) * b.hx + std::fabs(b.vx) * b.hy;
    double bExtentY = std::fabs(b.uy) * b.hx + std::fabs(b.vy) * b.hy;
    return std::fabs(a.cx - b.cx)
             <= aExtentX + bExtentX + R_CONTACT_SKIN
        && std::fabs(a.cy - b.cy)
             <= aExtentY + bExtentY + R_CONTACT_SKIN;
  };
  auto collectChildPairCandidates = [&](Body* bodyA, Body* bodyB) {
    int countA = (int)bodyA->collisionRects.size();
    int countB = (int)bodyB->collisionRects.size();
    childPairScratch.clear();
    if ((int64_t)countA * countB <= 64) {
      for (int ai = 0; ai < countA; ai++)
        for (int bi = 0; bi < countB; bi++) {
          if (!childFramesOverlap(currentChildFramesA[ai],
                                  currentChildFramesB[bi])
              && !childFramesOverlap(nextChildFramesA[ai],
                                     nextChildFramesB[bi]))
            continue;
          childPairScratch.push_back({ai, bi});
        }
      return;
    }
    childBoundsA.resize(countA);
    childBoundsB.resize(countB);
    auto boundsAtBothPoses = [&](const ChildFrame& now,
                                 const ChildFrame& next) {
      double nowX = std::fabs(now.ux) * now.hx
                  + std::fabs(now.vx) * now.hy;
      double nowY = std::fabs(now.uy) * now.hx
                  + std::fabs(now.vy) * now.hy;
      double nextX = std::fabs(next.ux) * next.hx
                   + std::fabs(next.vx) * next.hy;
      double nextY = std::fabs(next.uy) * next.hx
                   + std::fabs(next.vy) * next.hy;
      double pad = R_CONTACT_SKIN * 0.5;
      return ChildBounds{
        std::fmin(now.cx - nowX, next.cx - nextX) - pad,
        std::fmin(now.cy - nowY, next.cy - nextY) - pad,
        std::fmax(now.cx + nowX, next.cx + nextX) + pad,
        std::fmax(now.cy + nowY, next.cy + nextY) + pad,
      };
    };
    double minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18;
    double totalX = 0, totalY = 0;
    auto includeBounds = [&](const ChildBounds& bounds) {
      minX = std::fmin(minX, bounds.minX);
      minY = std::fmin(minY, bounds.minY);
      maxX = std::fmax(maxX, bounds.maxX);
      maxY = std::fmax(maxY, bounds.maxY);
      totalX += bounds.maxX - bounds.minX;
      totalY += bounds.maxY - bounds.minY;
    };
    for (int ai = 0; ai < countA; ai++) {
      childBoundsA[ai] = boundsAtBothPoses(
        currentChildFramesA[ai], nextChildFramesA[ai]);
      includeBounds(childBoundsA[ai]);
    }
    for (int bi = 0; bi < countB; bi++) {
      childBoundsB[bi] = boundsAtBothPoses(
        currentChildFramesB[bi], nextChildFramesB[bi]);
      includeBounds(childBoundsB[bi]);
    }
    double spanX = std::fmax(1e-9, maxX - minX);
    double spanY = std::fmax(1e-9, maxY - minY);
    bool sweepX = totalX * spanY <= totalY * spanX;
    childEventScratch.clear();
    childEventScratch.reserve((size_t)(countA + countB) * 2);
    auto addEvents = [&](const std::vector<ChildBounds>& bounds, bool fromA) {
      for (int child = 0; child < (int)bounds.size(); child++) {
        double lo = sweepX ? bounds[child].minX : bounds[child].minY;
        double hi = sweepX ? bounds[child].maxX : bounds[child].maxY;
        childEventScratch.push_back({lo, child, fromA, true});
        childEventScratch.push_back({hi, child, fromA, false});
      }
    };
    addEvents(childBoundsA, true);
    addEvents(childBoundsB, false);
    std::sort(childEventScratch.begin(), childEventScratch.end(),
              [](const ChildEvent& first, const ChildEvent& second) {
      if (first.position != second.position)
        return first.position < second.position;
      if (first.start != second.start) return first.start;
      if (first.fromA != second.fromA) return first.fromA;
      return first.child < second.child;
    });
    activeChildrenA.clear();
    activeChildrenB.clear();
    auto overlapsOtherAxis = [&](const ChildBounds& a,
                                 const ChildBounds& b) {
      return sweepX
        ? a.minY <= b.maxY && b.minY <= a.maxY
        : a.minX <= b.maxX && b.minX <= a.maxX;
    };
    auto removeActive = [](std::vector<int>& active, int child) {
      auto found = std::find(active.begin(), active.end(), child);
      if (found == active.end()) return;
      *found = active.back();
      active.pop_back();
    };
    for (const ChildEvent& event : childEventScratch) {
      std::vector<int>& own = event.fromA ? activeChildrenA : activeChildrenB;
      std::vector<int>& other = event.fromA ? activeChildrenB : activeChildrenA;
      if (!event.start) {
        removeActive(own, event.child);
        continue;
      }
      for (int peer : other) {
        int ai = event.fromA ? event.child : peer;
        int bi = event.fromA ? peer : event.child;
        if (!overlapsOtherAxis(childBoundsA[ai], childBoundsB[bi]))
          continue;
        if (!childFramesOverlap(currentChildFramesA[ai],
                                currentChildFramesB[bi])
            && !childFramesOverlap(nextChildFramesA[ai],
                                   nextChildFramesB[bi]))
          continue;
        childPairScratch.push_back({ai, bi});
      }
      own.push_back(event.child);
    }
    // Sequential manifold collection is order-sensitive. Restore the original
    // child-index nesting after exact swept-AABB culling.
    std::sort(childPairScratch.begin(), childPairScratch.end());
  };
  auto sweptBodyBounds = [&](Body* body, const ChildFrame& now,
                             const ChildFrame& next, double dt) {
    double localX = body->offsetX + (body->w - 1) * 0.5;
    double localY = body->offsetY + (body->h - 1) * 0.5;
    double halfX = body->w * 0.5, halfY = body->h * 0.5;
    double nowCx = now.px + localX * now.ux + localY * now.vx;
    double nowCy = now.py + localX * now.uy + localY * now.vy;
    double nextCx = next.px + localX * next.ux + localY * next.vx;
    double nextCy = next.py + localX * next.uy + localY * next.vy;
    double nowX = std::fabs(now.ux) * halfX
                + std::fabs(now.vx) * halfY;
    double nowY = std::fabs(now.uy) * halfX
                + std::fabs(now.vy) * halfY;
    double nextX = std::fabs(next.ux) * halfX
                 + std::fabs(next.vx) * halfY;
    double nextY = std::fabs(next.uy) * halfX
                 + std::fabs(next.vy) * halfY;
    double pad = (body->maxR + 0.7071067811865476)
               * std::fabs(body->omega) * dt
               + R_CONTACT_SKIN * 0.5 + 1e-9;
    return ChildBounds{
      std::fmin(nowCx - nowX, nextCx - nextX) - pad,
      std::fmin(nowCy - nowY, nextCy - nextY) - pad,
      std::fmax(nowCx + nowX, nextCx + nextX) + pad,
      std::fmax(nowCy + nowY, nextCy + nextY) + pad,
    };
  };
  auto sweptBoundsOverlap = [](const ChildBounds& a, const ChildBounds& b) {
    return a.minX <= b.maxX && b.minX <= a.maxX
        && a.minY <= b.maxY && b.minY <= a.maxY;
  };
  auto sweptObbsSeparated = [](Body* a, const ChildFrame& nowA,
                               const ChildFrame& nextA,
                               Body* b, const ChildFrame& nowB,
                               const ChildFrame& nextB, double dt) {
    struct WholeFrame {
      double cx, cy, ux, uy, vx, vy, hx, hy;
    };
    auto wholeFrame = [](Body* body, const ChildFrame& pose) {
      double localX = body->offsetX + (body->w - 1) * 0.5;
      double localY = body->offsetY + (body->h - 1) * 0.5;
      return WholeFrame{
        pose.px + localX * pose.ux + localY * pose.vx,
        pose.py + localX * pose.uy + localY * pose.vy,
        pose.ux, pose.uy, pose.vx, pose.vy,
        body->w * 0.5, body->h * 0.5,
      };
    };
    auto rotationReach = [dt](Body* body) {
      double theta = std::fabs(body->omega) * dt;
      double radius = body->maxR + 0.7071067811865476;
      return theta >= M_PI
        ? radius * 2
        : radius * 2 * std::sin(theta * 0.5);
    };
    double rotationA = rotationReach(a);
    double rotationB = rotationReach(b);
    double relativeVx = a->vx - b->vx;
    double relativeVy = a->vy - b->vy;
    auto separatedAt = [&](const WholeFrame& frameA,
                           const WholeFrame& frameB) {
      double axes[4][2] = {
        {frameA.ux, frameA.uy}, {frameA.vx, frameA.vy},
        {frameB.ux, frameB.uy}, {frameB.vx, frameB.vy},
      };
      double centerX = frameA.cx - frameB.cx;
      double centerY = frameA.cy - frameB.cy;
      for (const auto& axis : axes) {
        double extentA =
          std::fabs(axis[0] * frameA.ux + axis[1] * frameA.uy)
            * frameA.hx
          + std::fabs(axis[0] * frameA.vx + axis[1] * frameA.vy)
            * frameA.hy;
        double extentB =
          std::fabs(axis[0] * frameB.ux + axis[1] * frameB.uy)
            * frameB.hx
          + std::fabs(axis[0] * frameB.vx + axis[1] * frameB.vy)
            * frameB.hy;
        double separation =
          std::fabs(centerX * axis[0] + centerY * axis[1])
          - extentA - extentB;
        double closing =
          std::fabs(relativeVx * axis[0] + relativeVy * axis[1]) * dt
          + rotationA + rotationB + R_CONTACT_SKIN + 1e-9;
        if (separation > closing) return true;
      }
      return false;
    };
    WholeFrame currentA = wholeFrame(a, nowA);
    WholeFrame currentB = wholeFrame(b, nowB);
    if (separatedAt(currentA, currentB)) return true;
    WholeFrame endA = wholeFrame(a, nextA);
    WholeFrame endB = wholeFrame(b, nextB);
    return separatedAt(endA, endB);
  };
  auto faceNormal = [](const ChildFrame& frame, BodyCollisionFace face,
                       double& nx, double& ny) {
    if (face == BCF_LEFT) { nx = -frame.ux; ny = -frame.uy; }
    else if (face == BCF_RIGHT) { nx = frame.ux; ny = frame.uy; }
    else if (face == BCF_UP) { nx = -frame.vx; ny = -frame.vy; }
    else { nx = frame.vx; ny = frame.vy; }
  };
  auto faceForNormal = [&](const ChildFrame& frame, double nx, double ny) {
    BodyCollisionFace best = BCF_LEFT;
    double bestDot = -1e18;
    for (int fi = 0; fi < 4; fi++) {
      double fx, fy;
      faceNormal(frame, (BodyCollisionFace)fi, fx, fy);
      double dot = fx * nx + fy * ny;
      if (dot > bestDot) {
        bestDot = dot;
        best = (BodyCollisionFace)fi;
      }
    }
    return best;
  };
  auto facePoint = [](const ChildFrame& frame, BodyCollisionFace face,
                      double tangent, double& wx, double& wy) {
    double lx = 0, ly = 0;
    if (face == BCF_LEFT) {
      lx = frame.body->offsetX + frame.rect->x0 - 0.5;
      ly = tangent;
    } else if (face == BCF_RIGHT) {
      lx = frame.body->offsetX + frame.rect->x1 - 0.5;
      ly = tangent;
    } else if (face == BCF_UP) {
      lx = tangent;
      ly = frame.body->offsetY + frame.rect->y0 - 0.5;
    } else {
      lx = tangent;
      ly = frame.body->offsetY + frame.rect->y1 - 0.5;
    }
    wx = frame.px + lx * frame.ux + ly * frame.vx;
    wy = frame.py + lx * frame.uy + ly * frame.vy;
  };
  auto clipLinearRange = [](double start, double end, double lo, double hi,
                            double& u0, double& u1) {
    double delta = end - start;
    if (std::fabs(delta) < 1e-12)
      return start >= lo - 1e-9 && start <= hi + 1e-9;
    double first = (lo - start) / delta;
    double second = (hi - start) / delta;
    if (first > second) std::swap(first, second);
    u0 = std::fmax(u0, first);
    u1 = std::fmin(u1, second);
    return u1 >= u0 - 1e-9;
  };
  auto childSatManifolds = [&](const ChildFrame& a, const ChildFrame& b,
                               bool speculative) {
    struct Axis {
      double x, y;
      bool fromA;
      int order;
    };
    struct AxisCandidate {
      Axis axis;
      double overlap;
      double separation;
    };
    Axis axes[4] = {
      {a.ux, a.uy, true, 0},
      {a.vx, a.vy, true, 1},
      {b.ux, b.uy, false, 2},
      {b.vx, b.vy, false, 3},
    };
    double deltaX = a.cx - b.cx, deltaY = a.cy - b.cy;
    AxisCandidate candidates[4];
    int candidateCount = 0;
    for (const Axis& axis : axes) {
      double aExtent = std::fabs(axis.x * a.ux + axis.y * a.uy) * a.hx
                     + std::fabs(axis.x * a.vx + axis.y * a.vy) * a.hy;
      double bExtent = std::fabs(axis.x * b.ux + axis.y * b.uy) * b.hx
                     + std::fabs(axis.x * b.vx + axis.y * b.vy) * b.hy;
      double separation = deltaX * axis.x + deltaY * axis.y;
      double overlap = aExtent + bExtent + R_CONTACT_SKIN
                     - std::fabs(separation);
      if (overlap < 0) return false;
      candidates[candidateCount++] = {axis, overlap, separation};
    }
    std::sort(candidates, candidates + candidateCount,
              [](const AxisCandidate& first, const AxisCandidate& second) {
      if (first.overlap != second.overlap)
        return first.overlap < second.overlap;
      return first.axis.order < second.axis.order;
    });
    for (const AxisCandidate& candidate : candidates) {
      double minimum = candidate.overlap;
      double separation = candidate.separation;
      double normalX = candidate.axis.x;
      double normalY = candidate.axis.y;
      bool referenceA = candidate.axis.fromA;
      if (std::fabs(separation) < 1e-9) {
        double arx = a.cx - a.px, ary = a.cy - a.py;
        double brx = b.cx - b.px, bry = b.cy - b.py;
        double relativeX = (a.body->vx - a.body->omega * ary)
                         - (b.body->vx - b.body->omega * bry);
        double relativeY = (a.body->vy + a.body->omega * arx)
                         - (b.body->vy + b.body->omega * brx);
        separation = -(relativeX * candidate.axis.x
                     + relativeY * candidate.axis.y);
      }
      if (separation < 0) {
        normalX = -normalX;
        normalY = -normalY;
      }
      const ChildFrame& reference = referenceA ? a : b;
      const ChildFrame& incident = referenceA ? b : a;
      double refOutX = referenceA ? -normalX : normalX;
      double refOutY = referenceA ? -normalY : normalY;
      BodyCollisionFace refFace = faceForNormal(reference, refOutX, refOutY);
      BodyCollisionFace incFace = faceForNormal(incident, -refOutX, -refOutY);
      double refTangentX = (refFace == BCF_LEFT || refFace == BCF_RIGHT)
        ? reference.vx : reference.ux;
      double refTangentY = (refFace == BCF_LEFT || refFace == BCF_RIGHT)
        ? reference.vy : reference.uy;
      double planeX, planeY;
      facePoint(reference, refFace, 0, planeX, planeY);
      const BodyCollisionRect& refRect = *reference.rect;
      const BodyCollisionRect& incRect = *incident.rect;
      int refStart = refRect.spanStart[refFace];
      int refEnd = refStart + refRect.spanCount[refFace];
      if (refStart == refEnd) continue;
      int incStart = incRect.spanStart[incFace];
      int incEnd = incStart + incRect.spanCount[incFace];
      if (incStart == incEnd) continue;
      bool produced = false;
      for (int ii = incStart; ii < incEnd; ii++) {
        const BodyCollisionSpan& incSpan =
          incident.body->collisionSpans[ii];
        double x0, y0, x1, y1;
        facePoint(incident, incFace, incSpan.lo, x0, y0);
        facePoint(incident, incFace, incSpan.hi, x1, y1);
        double tangent0 = (x0 - reference.px) * refTangentX
                        + (y0 - reference.py) * refTangentY;
        double tangent1 = (x1 - reference.px) * refTangentX
                        + (y1 - reference.py) * refTangentY;
        double sep0 = (x0 - planeX) * refOutX + (y0 - planeY) * refOutY;
        double sep1 = (x1 - planeX) * refOutX + (y1 - planeY) * refOutY;
        double sepDelta = sep1 - sep0;
        for (int ri = refStart; ri < refEnd; ri++) {
          const BodyCollisionSpan& refSpan =
            reference.body->collisionSpans[ri];
          double u0 = 0, u1 = 1;
          if (!clipLinearRange(tangent0, tangent1,
                               refSpan.lo, refSpan.hi, u0, u1))
            continue;
          if (std::fabs(sepDelta) < 1e-12) {
            if (sep0 > R_CONTACT_SKIN) continue;
          } else {
            double crossing = (R_CONTACT_SKIN - sep0) / sepDelta;
            if (sepDelta > 0) u1 = std::fmin(u1, crossing);
            else u0 = std::fmax(u0, crossing);
            if (u1 < u0 - 1e-9) continue;
          }
          ChildManifold manifold;
          int pointCount = u1 - u0 > 1e-6 ? 2 : 1;
          for (int pi = 0; pi < pointCount; pi++) {
            double u = pi == 0 ? u0 : u1;
            double px = x0 + (x1 - x0) * u;
            double py = y0 + (y1 - y0) * u;
            double separation = sep0 + sepDelta * u;
            double satDepth = std::fmax(0.0, minimum - R_CONTACT_SKIN);
            double depth = speculative
              ? 0 : std::fmin(4.5, std::fmax(satDepth, -separation));
            px -= refOutX * separation * 0.5;
            py -= refOutY * separation * 0.5;
            PenPt point{px, py, normalX, normalY, depth};
            point.childA = a.child;
            point.childB = b.child;
            int refFeature = ((int)refFace << 24) | ri;
            int incFeature = ((int)incFace << 24) | ii;
            point.featureA = referenceA ? refFeature : incFeature;
            point.featureB = referenceA ? incFeature : refFeature;
            manifold.points[manifold.count++] = point;
          }
          childManifoldScratch.push_back(manifold);
          rigidChildManifolds++;
          produced = true;
        }
      }
      if (produced) return true;
    }
    return false;
  };
  enum ChildContactState {
    CCS_NONE,
    CCS_SPECULATIVE,
    CCS_CURRENT,
  };
  auto collectChildContacts = [&](Body* a, Body* b, double dt) {
    childManifoldScratch.clear();
    collectChildFrames(a, 0, currentChildFramesA);
    collectChildFrames(b, 0, currentChildFramesB);
    collectChildFrames(a, dt, nextChildFramesA);
    collectChildFrames(b, dt, nextChildFramesB);
    collectChildPairCandidates(a, b);
    bool currentContact = false;
    for (const auto& pair : childPairScratch) {
      int ai = pair.first, bi = pair.second;
      rigidChildPairs++;
      const ChildFrame& nowA = currentChildFramesA[ai];
      const ChildFrame& nowB = currentChildFramesB[bi];
      if (!childFramesOverlap(nowA, nowB)) {
        const ChildFrame& nextA = nextChildFramesA[ai];
        const ChildFrame& nextB = nextChildFramesB[bi];
        if (childFramesOverlap(nextA, nextB))
          childSatManifolds(nextA, nextB, true);
        continue;
      }
      if (childSatManifolds(nowA, nowB, false)) {
        currentContact = true;
        continue;
      }
      const ChildFrame& nextA = nextChildFramesA[ai];
      const ChildFrame& nextB = nextChildFramesB[bi];
      if (childFramesOverlap(nextA, nextB))
        childSatManifolds(nextA, nextB, true);
    }
    if (currentContact) return CCS_CURRENT;
    return childManifoldScratch.empty() ? CCS_NONE : CCS_SPECULATIVE;
  };
  std::vector<uint8_t> activeBody(n, 0);
  std::vector<double> bodyDt(n, 0);
  for (int sub = 0; sub < substeps; sub++) {
    for (int bi = 0; bi < n; bi++) {
      int cadence = bodySubsteps[bi];
      int before = sub * cadence / substeps;
      int after = (sub + 1) * cadence / substeps;
      activeBody[bi] = after != before;
      bodyDt[bi] = activeBody[bi] ? tickDt / cadence : 0;
      if (activeBody[bi]) rigidIslandBodySteps++;
    }
    std::fill(solidContact.begin(), solidContact.end(), 0);
    for (int bi = 0; bi < n; bi++) {
      Body* b = solverBodies[bi];
      double dt = bodyDt[bi];
      b->cs = std::cos(b->angle);
      b->sn = std::sin(b->angle);
      if (!activeBody[bi]) {
        bodyBounds(b, R_CONTACT_SKIN + 0.5,
                   b->aabbX0, b->aabbY0, b->aabbX1, b->aabbY1);
        continue;
      }
      if (b->awake) b->vy += E.scaledGravity(R_GRAVITY) * dt;
      b->pvx = 0; b->pvy = 0; b->pw = 0;
      b->hadContact = liquidContact[bi] != 0;
      b->maxDepth = 0;
      if (b->awake && !b->boundaryPts.empty()) {
        // Powder support remains a local bearing-capacity model. Liquid forces
        // have already been resolved as pressure impulses by coupleLiquids.
        double powderBottomDensityArea = 0;
        for (int bp : b->boundaryPts) {
          worldPoint(b, bp, b->sn, b->cs, wpx, wpy);
          int cx = (int)std::floor(wpx), cy = (int)std::floor(wpy);
          powderBottomDensityArea += granularMediumDensityAt(cx, cy + 1);
        }
        double bodyMass = b->invMass > 0 ? 1.0 / b->invMass : 0;
        bool powderCanBear = powderBottomDensityArea * R_GRANULAR_BEARING_DEPTH
          >= bodyMass - 1e-6;
        int powderWet = 0; double powderDensitySum = 0;
        for (int bp : b->boundaryPts) {
          worldPoint(b, bp, b->sn, b->cs, wpx, wpy);
          int cx = (int)std::floor(wpx), cy = (int)std::floor(wpy);
          double pd = 0;
          if (powderCanBear) {
            pd = granularMediumDensityAt(cx, cy);
            pd = std::fmax(pd, granularMediumDensityAt(cx - 1, cy));
            pd = std::fmax(pd, granularMediumDensityAt(cx + 1, cy));
            pd = std::fmax(pd, granularMediumDensityAt(cx, cy - 1));
            pd = std::fmax(pd, granularMediumDensityAt(cx, cy + 1));
          }
          if (pd > 0) { powderWet++; powderDensitySum += pd; }
        }
        if (powderWet > 0) {
          double powderSubmerged = (double)powderWet / b->boundaryPts.size();
          double powderSupport = powderWet > 0 ? (powderDensitySum / powderWet / b->density) * powderSubmerged : 0;
          powderSupport = std::fmin(1.0, powderSupport);
          b->vy -= E.scaledGravity(R_GRAVITY) * powderSupport * dt;
          if (std::fabs(powderSupport - 1.0) <= R_GRANULAR_REST_BAND) {
            b->vy *= R_GRANULAR_REST_DAMP;
            if (std::fabs(b->vy) < R_GRANULAR_ZERO_VY) b->vy = 0;
            if (std::fabs(b->omega) < R_SETTLE_ANG) b->omega = 0;
            b->hadContact = true;
          }
          double drag = std::fmax(0.0, 1 - R_GRANULAR_DRAG * powderSubmerged);
          b->vx *= drag;
          b->vy *= drag;
          b->omega *= std::fmax(0.0, 1 - R_GRANULAR_ANG_DRAG * powderSubmerged);
        }
      }
      if (b->awake) {
        double sp2 = b->vx * b->vx + b->vy * b->vy;
        if (sp2 > R_MAX_SPEED * R_MAX_SPEED) { double s = R_MAX_SPEED / std::sqrt(sp2); b->vx *= s; b->vy *= s; }
        double wMax = R_MAX_SPEED / (b->maxR > 0 ? b->maxR : 1);
        if (b->omega > wMax) b->omega = wMax; else if (b->omega < -wMax) b->omega = -wMax;
      }
      // Expand the broad-phase AABB by this body's per-substep reach (point speed
      // travelled this substep + contact skin) so a swept sample that starts just
      // outside the static AABB but moves into the pair this substep is not pruned.
      b->sweepMargin = (std::sqrt(b->vx * b->vx + b->vy * b->vy) + std::fabs(b->omega) * (b->maxR > 0 ? b->maxR : 1)) * dt + R_CONTACT_SKIN + 0.5;
      bodyBounds(b, b->sweepMargin,
                 b->aabbX0, b->aabbY0, b->aabbX1, b->aabbY1);
      b->omegaPre = b->omega;                                  // spin entering this substep's contact solve
    }
    // Players and creatures are pushed after the grid-body solve rather than
    // represented as impulse bodies. Treat one inside this substep's swept AABB
    // as a soft impact that absorbs restitution; otherwise a body can rebound
    // from the terrain behind an actor before the established push/crush path
    // gets to resolve their overlap.
    std::fill(actorSweepOverlap.begin(), actorSweepOverlap.end(), 0);
    if (E.L == &E.fg && (!E.psys.players.empty() || !E.creatures.creatures.empty())) {
      auto overlapsAabb = [](Body* b, double x, double y, int w, int h) {
        return x < b->aabbX1 && x + w > b->aabbX0 && y < b->aabbY1 && y + h > b->aabbY0;
      };
      for (int bi = 0; bi < n; bi++) {
        if (!activeBody[bi]) continue;
        Body* b = solverBodies[bi];
        for (const Player& p : E.psys.players) {
          if (p.active && p.alive && overlapsAabb(b, p.px, p.py, p.w, p.h)) { actorSweepOverlap[bi] = 1; break; }
        }
        if (actorSweepOverlap[bi]) continue;
        for (const Creature& c : E.creatures.creatures) {
          if (!c.alive) continue;
          const CreatureSpecies& s = E.creatures.species(c);
          double x = c.wx - E.fg.worldOffsetX, y = c.wy - E.fg.worldOffsetY;
          if (overlapsAabb(b, x, y, s.w, s.h)) { actorSweepOverlap[bi] = 1; break; }
        }
      }
    }
    contacts.clear();
    // Penetration depth of a point that is already inside target T, measured by
    // marching outward along T's surface normal until it exits the mask.
    auto penDepth = [&](Body* target, double wx, double wy,
                        double nx, double ny, bool precise) {
      if (!precise) {
        double depth = 0.5, mx = wx, my = wy;
        for (int step = 0; step < 4; step++) {
          mx += nx;
          my += ny;
          if (insideBodyIndex(target, mx, my) < 0) break;
          depth += 1;
        }
        return depth;
      }
      double inside = 0, outside = 0.25;
      while (outside <= 4.5
             && insideBodyIndex(target, wx + nx * outside,
                                wy + ny * outside) >= 0) {
        inside = outside;
        outside += 0.25;
      }
      if (outside > 4.5) return 4.5;
      for (int iteration = 0; iteration < 6; iteration++) {
        double mid = (inside + outside) * 0.5;
        if (insideBodyIndex(target, wx + nx * mid, wy + ny * mid) >= 0)
          inside = mid;
        else
          outside = mid;
      }
      return outside;
    };
    // Swept body-to-body sampling: for each exposed boundary sample of P, either
    // record an existing penetration (t=0) or march the sample's per-substep
    // RELATIVE path (P's point velocity minus T's velocity at that point) through
    // T's occupancy mask and record the first impact. The contact normal is taken
    // from T's mask surface (bodyNormalAt), oriented from B toward A via `sign`,
    // never a centre-to-centre direction. This stops a sample crossing from one
    // side of a thin body to the other without generating a contact.
    auto collectSweep = [&](Body* P, Body* T, double sign, double dt) {
      const std::vector<float>& S = P->boundarySamples; double pm = P->sweepMargin;
      const std::vector<double>& radii = P->boundarySampleRadii;
      bool preciseDepth = rigidLargeSlenderBody(P)
                       && rigidLargeSlenderBody(T);
      bool exactAngular = needsExactAngularSweep(P)
                       || needsExactAngularSweep(T);
      double relativeLinear = exactAngular
        ? std::hypot(P->vx - T->vx, P->vy - T->vy) : 0;
      double sourceAngularSpeed = std::fabs(P->omega);
      double targetAngularSpeed = std::fabs(T->omega) * T->maxR;
      for (size_t si = 0; si + 1 < S.size(); si += 2) {
        double lx = S[si], ly = S[si + 1];
        double sx = P->px + lx * P->cs - ly * P->sn, sy = P->py + lx * P->sn + ly * P->cs;
        if (sx < T->aabbX0 - pm || sx > T->aabbX1 + pm || sy < T->aabbY0 - pm || sy > T->aabbY1 + pm) continue;
        int idx0 = insideBodyIndex(T, sx, sy);
        if (idx0 >= 0) {
          bodyNormalAt(T, idx0, sx, sy, nx_, ny_);
          penAcc.push_back({
            sx, sy, nx_ * sign, ny_ * sign,
            penDepth(T, sx, sy, nx_, ny_, preciseDepth), 0,
          });
          continue;
        }
        // Compact bodies use the point's tangent over this short substep.
        // Long or large rotating bodies follow their exact circular trajectory,
        // since their endpoints can depart materially from that tangent.
        if (!exactAngular) {
          double rPx = sx - P->px, rPy = sy - P->py;
          double rTx = sx - T->px, rTy = sy - T->py;
          double mvx = ((P->vx - P->omega * rPy)
                      - (T->vx - T->omega * rTy)) * dt;
          double mvy = ((P->vy + P->omega * rPx)
                      - (T->vy + T->omega * rTx)) * dt;
          double mlen = std::sqrt(mvx * mvx + mvy * mvy);
          if (mlen < 1e-9) continue;
          double dirx = mvx / mlen, diry = mvy / mlen;
          double total = mlen + R_CONTACT_SKIN;
          int steps = (int)std::ceil(total / R_SWEEP_STEP);
          if (steps < 1) steps = 1;
          for (int k = 1; k <= steps; k++) {
            double dk = total * (double)k / steps;
            if (insideBodyIndex(T, sx + dirx * dk, sy + diry * dk) < 0)
              continue;
            double miss = total * (double)(k - 1) / steps, hit = dk;
            for (int it = 0; it < 6; it++) {
              double mid = (miss + hit) * 0.5;
              if (insideBodyIndex(T, sx + dirx * mid, sy + diry * mid) >= 0)
                hit = mid;
              else
                miss = mid;
            }
            double hx = sx + dirx * hit, hy = sy + diry * hit;
            int hidx = insideBodyIndex(T, hx, hy);
            if (hidx < 0) {
              hx = sx + dirx * dk;
              hy = sy + diry * dk;
              hidx = insideBodyIndex(T, hx, hy);
            }
            if (hidx < 0) break;
            bodyNormalAt(T, hidx, hx, hy, nx_, ny_);
            penAcc.push_back({hx, hy, nx_ * sign, ny_ * sign, 0.0, 0});
            break;
          }
          continue;
        }
        double pointRadius = radii[si / 2];
        double speedBound = relativeLinear
          + sourceAngularSpeed * pointRadius
          + targetAngularSpeed;
        if (speedBound < 1e-9) continue;
        double timeEnd = dt + R_CONTACT_SKIN / speedBound;
        double total = speedBound * timeEnd;
        int steps = (int)std::ceil(total / R_SWEEP_STEP);
        if (steps < 1) steps = 1;
        for (int k = 1; k <= steps; k++) {
          double hitTime = timeEnd * (double)k / steps;
          double hx, hy;
          sweptPoint(P, lx, ly, hitTime, hx, hy);
          if (insideBodyAt(T, hx, hy, hitTime) < 0) continue;
          double missTime = timeEnd * (double)(k - 1) / steps;
          for (int it = 0; it < 7; it++) {
            double midTime = (missTime + hitTime) * 0.5;
            double mx, my;
            sweptPoint(P, lx, ly, midTime, mx, my);
            if (insideBodyAt(T, mx, my, midTime) >= 0) hitTime = midTime;
            else missTime = midTime;
          }
          sweptPoint(P, lx, ly, hitTime, hx, hy);
          int hidx = insideBodyAt(T, hx, hy, hitTime);
          if (hidx < 0) {
            hitTime = timeEnd * (double)k / steps;
            sweptPoint(P, lx, ly, hitTime, hx, hy);
            hidx = insideBodyAt(T, hx, hy, hitTime);
          }
          if (hidx < 0) break;
          bodyNormalAtTime(T, hidx, hx, hy, hitTime, nx_, ny_);
          penAcc.push_back({hx, hy, nx_ * sign, ny_ * sign, 0.0, 0});
          break;
        }
      }
    };
    // Swept body-to-grid sampling. Static cells stay terrain contacts; owner-
    // marked peer-layer cells are grouped by their dynamic body below.
    // The loaded-buffer rim counts as solid wall: a body's own motion must not
    // carry it off the simulated window (where its raster is clipped away and it
    // silently vanishes). Off-buffer cells get an inward-pointing normal so the
    // body rests against / is pushed back from the render boundary until the
    // window streams that region into view. World-stream eviction (which legitly
    // carries bodies off-buffer and persists them) is a separate path.
    auto collectTerrain = [&](Body* b, double dt) {
      bool bodyHasPeerContacts = bodyUsesPeerContacts(b);
      const std::vector<float>& S = b->boundarySamples;
      const std::vector<double>& radii = b->boundarySampleRadii;
      bool exactAngular = needsExactAngularSweep(b);
      double linearSpeed = exactAngular ? std::hypot(b->vx, b->vy) : 0;
      double angularSpeed = std::fabs(b->omega);
      if (!bodyHasPeerContacts) {
        // The complete substep sweep lies inside the current oriented bounds
        // expanded by translation, rotational point travel, contact skin, and
        // one terrain-cell corner radius. Scan only its horizontal row spans;
        // any material found still goes through the exact sample sweep below.
        double localX = b->offsetX + (b->w - 1) * 0.5;
        double localY = b->offsetY + (b->h - 1) * 0.5;
        double centerX =
          b->px + localX * b->cs - localY * b->sn
          + b->vx * dt * 0.5;
        double centerY =
          b->py + localX * b->sn + localY * b->cs
          + b->vy * dt * 0.5;
        double theta = std::fabs(b->omega) * dt;
        double radius = b->maxR + 0.7071067811865476;
        double rotationReach = theta >= M_PI
          ? radius * 2
          : radius * 2 * std::sin(theta * 0.5);
        double pad = rotationReach + R_CONTACT_SKIN
          + 0.7071067811865476 + 1e-9;
        double halfX = b->w * 0.5 + pad
          + std::fabs(b->vx * b->cs + b->vy * b->sn) * dt * 0.5;
        double halfY = b->h * 0.5 + pad
          + std::fabs(-b->vx * b->sn + b->vy * b->cs) * dt * 0.5;
        double extentX =
          std::fabs(b->cs) * halfX + std::fabs(b->sn) * halfY;
        double extentY =
          std::fabs(b->sn) * halfX + std::fabs(b->cs) * halfY;
        if (centerX - extentX >= 0 && centerY - extentY >= 0
            && centerX + extentX < E.cols
            && centerY + extentY < E.rows) {
          bool occupied = false;
          int y0 = imax(0, (int)std::ceil(
            centerY - extentY - 0.5 - 1e-9));
          int y1 = imin(E.rows - 1, (int)std::floor(
            centerY + extentY - 0.5 + 1e-9));
          for (int y = y0; y <= y1 && !occupied; y++) {
            double dy = y + 0.5 - centerY;
            double minX = -1e18, maxX = 1e18;
            auto clipAxis = [&](double coefficient, double constant,
                                double half) {
              if (std::fabs(coefficient) < 1e-12)
                return std::fabs(constant) <= half;
              double lo = (-half - constant) / coefficient;
              double hi = (half - constant) / coefficient;
              if (lo > hi) std::swap(lo, hi);
              minX = std::fmax(minX, centerX + lo);
              maxX = std::fmin(maxX, centerX + hi);
              return minX <= maxX + 1e-9;
            };
            if (!clipAxis(b->cs, b->sn * dy, halfX)
                || !clipAxis(-b->sn, b->cs * dy, halfY))
              continue;
            int x0 = imax(0, (int)std::ceil(minX - 0.5 - 1e-9));
            int x1 = imin(E.cols - 1,
                          (int)std::floor(maxX - 0.5 + 1e-9));
            if (x0 > x1) continue;
            const uint8_t* row = E.L->grid + y * E.cols;
            int x = x0;
            for (; x + 7 <= x1; x += 8) {
              uint64_t materials = 0;
              memcpy(&materials, row + x, sizeof(materials));
              if (materials != 0) {
                occupied = true;
                break;
              }
            }
            for (; x <= x1 && !occupied; x++) {
              occupied = row[x] != EMPTY;
            }
          }
          if (!occupied) return;
        }
      }
      auto solid = [&](int ix, int iy) { return ix < 0 || ix >= E.cols || iy < 0 || iy >= E.rows || isBodyTerrain(b, ix, iy, b->density); };
      auto tnorm = [&](int ix, int iy, double& ox, double& oy) {
        if (ix < 0) { ox = 1; oy = 0; return; }
        if (ix >= E.cols) { ox = -1; oy = 0; return; }
        if (iy < 0) { ox = 0; oy = 1; return; }
        if (iy >= E.rows) { ox = 0; oy = -1; return; }
        terrainNormalAt(b, ix, iy, b->density, ox, oy);
      };
      for (size_t si = 0; si + 1 < S.size(); si += 2) {
        double lx = S[si], ly = S[si + 1];
        double sx = b->px + lx * b->cs - ly * b->sn, sy = b->py + lx * b->sn + ly * b->cs;
        int cx = (int)std::floor(sx), cy = (int)std::floor(sy);
        if (solid(cx, cy)) {
          tnorm(cx, cy, nx_, ny_);
          double depth = 0.5, mx = sx, my = sy;
          for (int s = 0; s < 4; s++) { mx += nx_; my += ny_; if (!solid((int)std::floor(mx), (int)std::floor(my))) break; depth += 1; }
          terrAcc.push_back({sx, sy, nx_, ny_, depth, 0});
          if (bodyHasPeerContacts)
            terrPeers.push_back(peerDynamicBodyAt(b, cx, cy));
          continue;
        }
        if (!exactAngular) {
          double rx = sx - b->px, ry = sy - b->py;
          double mvx = (b->vx - b->omega * ry) * dt;
          double mvy = (b->vy + b->omega * rx) * dt;
          double mlen = std::sqrt(mvx * mvx + mvy * mvy);
          if (mlen < 1e-9) continue;
          double dirx = mvx / mlen, diry = mvy / mlen;
          double total = mlen + R_CONTACT_SKIN;
          int steps = (int)std::ceil(total / R_SWEEP_STEP);
          if (steps < 1) steps = 1;
          for (int k = 1; k <= steps; k++) {
            double dk = total * (double)k / steps;
            if (!solid((int)std::floor(sx + dirx * dk),
                       (int)std::floor(sy + diry * dk)))
              continue;
            double miss = total * (double)(k - 1) / steps, hit = dk;
            for (int it = 0; it < 6; it++) {
              double mid = (miss + hit) * 0.5;
              if (solid((int)std::floor(sx + dirx * mid),
                        (int)std::floor(sy + diry * mid)))
                hit = mid;
              else
                miss = mid;
            }
            double hx = sx + dirx * hit, hy = sy + diry * hit;
            int hxx = (int)std::floor(hx), hyy = (int)std::floor(hy);
            if (!solid(hxx, hyy)) {
              hx = sx + dirx * dk;
              hy = sy + diry * dk;
              hxx = (int)std::floor(hx);
              hyy = (int)std::floor(hy);
            }
            tnorm(hxx, hyy, nx_, ny_);
            terrAcc.push_back({hx, hy, nx_, ny_, 0.0, 0});
            if (bodyHasPeerContacts)
              terrPeers.push_back(peerDynamicBodyAt(b, hxx, hyy));
            break;
          }
          continue;
        }
        double pointRadius = radii[si / 2];
        double speedBound = linearSpeed + angularSpeed * pointRadius;
        if (speedBound < 1e-9) continue;
        double timeEnd = dt + R_CONTACT_SKIN / speedBound;
        double total = speedBound * timeEnd;
        int steps = (int)std::ceil(total / R_SWEEP_STEP);
        if (steps < 1) steps = 1;
        for (int k = 1; k <= steps; k++) {
          double hitTime = timeEnd * (double)k / steps;
          double hx, hy;
          sweptPoint(b, lx, ly, hitTime, hx, hy);
          if (!solid((int)std::floor(hx), (int)std::floor(hy))) continue;
          double missTime = timeEnd * (double)(k - 1) / steps;
          for (int it = 0; it < 7; it++) {
            double midTime = (missTime + hitTime) * 0.5;
            double mx, my;
            sweptPoint(b, lx, ly, midTime, mx, my);
            if (solid((int)std::floor(mx), (int)std::floor(my))) hitTime = midTime;
            else missTime = midTime;
          }
          sweptPoint(b, lx, ly, hitTime, hx, hy);
          int hxx = (int)std::floor(hx), hyy = (int)std::floor(hy);
          if (!solid(hxx, hyy)) {
            hitTime = timeEnd * (double)k / steps;
            sweptPoint(b, lx, ly, hitTime, hx, hy);
            hxx = (int)std::floor(hx);
            hyy = (int)std::floor(hy);
          }
          tnorm(hxx, hyy, nx_, ny_);
          terrAcc.push_back({hx, hy, nx_, ny_, 0.0, 0});
          if (bodyHasPeerContacts)
            terrPeers.push_back(peerDynamicBodyAt(b, hxx, hyy));
          break;
        }
      }
    };
    // Reduce raw samples into a small contact manifold. Samples are bucketed by
    // quantized normal direction so materially different contact faces stay
    // separate (not blended into one diagonal normal); within each bucket the two
    // tangential extremes are kept so a long contact gets stable torque at both
    // ends. Deepest contributes to maxDepth for the sleep gate.
    auto reduceManifold = [&](std::vector<PenPt>& acc, Body* A, Body* B,
                              double fbx, double fby, double contactDt) {
      if (acc.empty()) return;
      int bIndex = B && B->idx >= 0 && B->idx < n
        && solverBodies[B->idx] == B ? B->idx : -1;
      const double Q = 8.0 / (2.0 * M_PI);
      double snx[8] = {0}, sny[8] = {0}; int cnt[8] = {0};
      bool sweptHit[8] = {false};
      bool childFeature[8] = {false};
      for (auto& p : acc) {
        int bk = ((int)std::lround(std::atan2(p.ny, p.nx) * Q)) & 7;
        p.bk = bk;
        snx[bk] += p.nx;
        sny[bk] += p.ny;
        cnt[bk]++;
        sweptHit[bk] = sweptHit[bk] || p.depth == 0;
        childFeature[bk] = childFeature[bk] || p.childA >= 0;
      }
      double Nx[8], Ny[8], tx[8], ty[8], loP[8], hiP[8]; PenPt* lo[8] = {nullptr}; PenPt* hi[8] = {nullptr};
      for (int bk = 0; bk < 8; bk++) {
        if (!cnt[bk]) continue;
        double nl = std::sqrt(snx[bk] * snx[bk] + sny[bk] * sny[bk]);
        if (nl < 1e-6) { Nx[bk] = fbx; Ny[bk] = fby; } else { Nx[bk] = snx[bk] / nl; Ny[bk] = sny[bk] / nl; }
        // Deep overlap samples can see the target's far-side faces too. For a
        // large slender body the reference follows its minor axis, so
        // longitudinal center offset does not discard a valid support face.
        // A sparse shape's first swept hit already identifies its entered local
        // face; a remote concave arm can put the body's center on the other side.
        // Terrain remains multi-sided for floor/wall corners.
        bool localSparseSweep = sweptHit[bk]
          && (!rigidTightSlenderBounds(A)
              || !rigidTightSlenderBounds(B));
        if (B && !childFeature[bk] && !localSparseSweep
            && Nx[bk] * fbx + Ny[bk] * fby < 0.5) {
          cnt[bk] = 0;
          continue;
        }
        tx[bk] = -Ny[bk]; ty[bk] = Nx[bk]; loP[bk] = 1e18; hiP[bk] = -1e18;
      }
      for (auto& p : acc) {
        int bk = p.bk;
        if (!cnt[bk]) continue;
        double pr = p.wx * tx[bk] + p.wy * ty[bk];
        if (pr < loP[bk] - 1e-9
            || (std::fabs(pr - loP[bk]) <= 1e-9
                && (!lo[bk] || p.depth > lo[bk]->depth))) {
          loP[bk] = pr;
          lo[bk] = &p;
        }
        if (pr > hiP[bk] + 1e-9
            || (std::fabs(pr - hiP[bk]) <= 1e-9
                && (!hi[bk] || p.depth > hi[bk]->depth))) {
          hiP[bk] = pr;
          hi[bk] = &p;
        }
      }
      auto push = [&](PenPt* p, int bk) {
        if (!p) return -1;
        double rax = p->wx - A->px, ray = p->wy - A->py;
        double rbx = B ? p->wx - B->px : 0, rby = B ? p->wy - B->py : 0;
        double rvx = A->vx - A->omega * ray, rvy = A->vy + A->omega * rax;
        if (B) { rvx -= B->vx - B->omega * rby; rvy -= B->vy + B->omega * rbx; }
        double impactVn = rvx * Nx[bk] + rvy * Ny[bk];
        bool softImpact = actorSweepOverlap[A->idx]
          || (bIndex >= 0 && actorSweepOverlap[bIndex]);
        double restitution = B ? R_BODY_RESTITUTION : R_TERRAIN_RESTITUTION;
        double targetVn = !softImpact && impactVn < -R_BOUNCE_MIN_SPEED ? -restitution * impactVn : 0;
        auto materialAtContact = [&](Body* body) {
          if (body->cellMaterials.empty()) return body->material;
          int local = insideBodyIndex(body, p->wx, p->wy);
          return local >= 0 ? bodyMaterialAt(body, local) : body->material;
        };
        bool icyContact = materialAtContact(A) == ICE
          || (B && materialAtContact(B) == ICE);
        if (!B) {
          int tx = (int)std::floor(p->wx), ty = (int)std::floor(p->wy);
          icyContact = icyContact || (tx >= 0 && tx < E.cols
            && ty >= 0 && ty < E.rows && E.L->grid[ty * E.cols + tx] == ICE);
        }
        double staticFriction = icyContact
          ? R_ICE_STATIC_FRICTION : R_STATIC_FRICTION;
        double dynamicFriction = icyContact
          ? R_ICE_DYNAMIC_FRICTION : R_DYNAMIC_FRICTION;
        Contact contact{
          A, B, rax, ray, rbx, rby, Nx[bk], Ny[bk], p->depth,
          p->childA, p->childB, p->featureA, p->featureB,
          (uint8_t)bk,
          bIndex >= 0, std::max(0.0, -impactVn), targetVn,
          contactDt, staticFriction, dynamicFriction,
          0, 0, 0,
          0, 0, 0, -1, false,
        };
        restoreContact(contact, bk, contactDt);
        int contactIndex = (int)contacts.size();
        contacts.push_back(contact);
        if (p->depth > A->maxDepth) A->maxDepth = p->depth;
        if (B && p->depth > B->maxDepth) B->maxDepth = p->depth;
        return contactIndex;
      };
      for (int bk = 0; bk < 8; bk++) {
        if (!cnt[bk]) continue;
        int first = push(lo[bk], bk);
        if (hi[bk] == lo[bk]) continue;
        int second = push(hi[bk], bk);
        contacts[first].blockMate = second;
        contacts[second].blockMate = first;
      }
      A->hadContact = true;
      solidContact[A->idx] = 1;
      if (B) {
        B->hadContact = true;
        if (bIndex >= 0) solidContact[bIndex] = 1;
      }
    };
    auto broadphaseLess = [&](int a, int b) {
      if (solverBodies[a]->aabbX0 != solverBodies[b]->aabbX0)
        return solverBodies[a]->aabbX0 < solverBodies[b]->aabbX0;
      return a < b;
    };
    // Body order is coherent across substeps and ticks. Insertion repair makes
    // the common nearly-sorted broadphase linear while preserving deterministic
    // index ordering for equal AABB starts.
    for (int i = 1; i < n; i++) {
      int value = broadphaseOrder[i];
      int j = i;
      while (j > 0 && broadphaseLess(value, broadphaseOrder[j - 1])) {
        broadphaseOrder[j] = broadphaseOrder[j - 1];
        j--;
      }
      broadphaseOrder[j] = value;
    }
    broadphasePairs.clear();
    for (int oi = 0; oi < n; oi++) {
      int a = broadphaseOrder[oi];
      Body* A = solverBodies[a];
      if (!activeBody[a]) continue;
      for (int oj = oi + 1; oj < n; oj++) {
        int b = broadphaseOrder[oj];
        Body* B = solverBodies[b];
        if (B->aabbX0 > A->aabbX1) break;
        if (!activeBody[b]) continue;
        if (A->aabbY1 < B->aabbY0 || B->aabbY1 < A->aabbY0) continue;
        broadphasePairs.push_back({imin(a, b), imax(a, b)});
      }
    }
    // Contact order is part of deterministic sequential impulse behavior.
    // Restore the original nested-loop order after sweep-and-prune culling.
    std::sort(broadphasePairs.begin(), broadphasePairs.end());
    for (const auto& pair : broadphasePairs) {
      Body* A = solverBodies[pair.first];
      Body* B = solverBodies[pair.second];
      if (!A->awake && !B->awake) continue;
      double pairDt = std::fmin(bodyDt[pair.first], bodyDt[pair.second]);
      bool aMoving = A->awake && (A->vx * A->vx + A->vy * A->vy > R_WAKE_LIN2 || A->omega * A->omega > R_WAKE_ANG2);
      bool bMoving = B->awake && (B->vx * B->vx + B->vy * B->vy > R_WAKE_LIN2 || B->omega * B->omega > R_WAKE_ANG2);
      ChildContactState childContactState =
        collectChildContacts(A, B, pairDt);
      ChildBounds sweptA, sweptB;
      if (childContactState != CCS_CURRENT) {
        sweptA = sweptBodyBounds(
          A, currentChildFramesA[0], nextChildFramesA[0], pairDt);
        sweptB = sweptBodyBounds(
          B, currentChildFramesB[0], nextChildFramesB[0], pairDt);
        if (childContactState == CCS_NONE
            && !sweptBoundsOverlap(sweptA, sweptB))
          continue;
        if (childContactState == CCS_NONE
            && sweptObbsSeparated(
              A, currentChildFramesA[0], nextChildFramesA[0],
              B, currentChildFramesB[0], nextChildFramesB[0], pairDt)) {
          continue;
        }
      }
      uint64_t pairKey = bodyPairKey(A->id, B->id);
      auto remembered = activePairAxes.find(pairKey);
      if (remembered != activePairAxes.end()
          && (remembered->second.aRevision != A->geometryRevision
              || remembered->second.bRevision != B->geometryRevision)) {
        activePairAxes.erase(remembered);
        remembered = activePairAxes.end();
      }
      double scratchNormalX = 0, scratchNormalY = 0;
      int scratchPointCount = 0;
      for (const ChildManifold& manifold : childManifoldScratch)
        for (int pi = 0; pi < manifold.count; pi++) {
          scratchNormalX += manifold.points[pi].nx;
          scratchNormalY += manifold.points[pi].ny;
          scratchPointCount++;
        }
      double scratchNormalLength =
        std::hypot(scratchNormalX, scratchNormalY);
      bool coherentScratch = scratchPointCount > 0
        && scratchNormalLength >= scratchPointCount * 0.65;
      if (coherentScratch) {
        scratchNormalX /= scratchNormalLength;
        scratchNormalY /= scratchNormalLength;
        if (remembered == activePairAxes.end()) {
          remembered = activePairAxes.emplace(pairKey, PairAxisState{
            A->geometryRevision, B->geometryRevision,
            scratchNormalX, scratchNormalY, 0,
          }).first;
        }
      }
      if (childContactState != CCS_NONE
          && remembered != activePairAxes.end())
        remembered->second.age = 0;
      if (childContactState != CCS_CURRENT) {
        rigidSweepFallbacks++;
        penAcc.clear();
        collectSweep(A, B, 1, pairDt);
        collectSweep(B, A, -1, pairDt);
        double fbx, fby;
        bool hasSlenderObb = addSlenderObbManifold(
          A, B, penAcc, fbx, fby);
        if (!penAcc.empty()) {
          if (!A->awake && bMoving) wakeBody(A);
          if (!B->awake && aMoving) wakeBody(B);
          if (!A->awake && !B->awake) continue;
          if (!hasSlenderObb)
            pairSeparatingDirection(A, B, fbx, fby);
          reduceManifold(penAcc, A, B, fbx, fby, pairDt);
          continue;
        }
        if (childContactState == CCS_NONE) continue;
      }
      if (!A->awake && bMoving) wakeBody(A);
      if (!B->awake && aMoving) wakeBody(B);
      if (!A->awake && !B->awake) continue;
      double preferredX = 0, preferredY = 0;
      bool hasPreferredNormal = false;
      if (remembered != activePairAxes.end()) {
        preferredX = remembered->second.nx;
        preferredY = remembered->second.ny;
        hasPreferredNormal = true;
      }
      penAcc.clear();
      for (const ChildManifold& manifold : childManifoldScratch) {
        for (int pi = 0; pi < manifold.count; pi++) {
          const PenPt& point = manifold.points[pi];
          if (hasPreferredNormal
              && point.nx * preferredX + point.ny * preferredY < -0.25)
            continue;
          penAcc.push_back(point);
        }
      }
      reduceManifold(penAcc, A, B, 0, -1, pairDt);
    }
    for (int bi = 0; bi < n; bi++) {
      Body* b = solverBodies[bi];
      if (!activeBody[bi] || !b->awake) continue;
      double contactDt = bodyDt[bi];
      terrAcc.clear();
      terrPeers.clear();
      collectTerrain(b, contactDt);
      if (!bodyUsesPeerContacts(b)) {
        reduceManifold(terrAcc, b, nullptr, 0, -1, contactDt);
        continue;
      }
      size_t terrGroupCount = 0;
      for (size_t pi = 0; pi < terrAcc.size(); pi++) {
        const PenPt& point = terrAcc[pi];
        Body* peer = terrPeers[pi];
        auto it = std::find_if(
          terrGroups.begin(), terrGroups.begin() + terrGroupCount,
          [&](const TerrainGroup& group) { return group.peer == peer; });
        if (it == terrGroups.begin() + terrGroupCount) {
          if (terrGroupCount == terrGroups.size())
            terrGroups.push_back({nullptr, {}});
          it = terrGroups.begin() + terrGroupCount++;
          it->peer = peer;
          it->points.clear();
        }
        it->points.push_back(point);
      }
      for (size_t gi = 0; gi < terrGroupCount; gi++) {
        TerrainGroup& group = terrGroups[gi];
        Body* peer = group.peer;
        if (peer) {
          bool bodyMoving = b->awake
            && (b->vx * b->vx + b->vy * b->vy > R_WAKE_LIN2
                || b->omega * b->omega > R_WAKE_ANG2);
          bool peerMoving = peer->awake
            && (peer->vx * peer->vx + peer->vy * peer->vy > R_WAKE_LIN2
                || peer->omega * peer->omega > R_WAKE_ANG2);
          if (!b->awake && peerMoving) wakeBody(b);
          if (!peer->awake && bodyMoving) wakeBody(peer);
          if (!b->awake && !peer->awake) continue;
          double fbx, fby;
          pairSeparatingDirection(b, peer, fbx, fby);
          reduceManifold(group.points, b, peer, fbx, fby, contactDt);
        } else {
          reduceManifold(group.points, b, nullptr, 0, -1, contactDt);
        }
      }
    }
    nc = (int)contacts.size();
    rigidContacts += nc;
    for (Contact& contact : contacts) {
      Body* A = contact.a;
      Body* B = contact.b;
      double aInvM = A->awake ? A->invMass : 0;
      double aInvI = A->awake ? A->invInertia : 0;
      double bInvM = B && B->awake ? B->invMass : 0;
      double bInvI = B && B->awake ? B->invInertia : 0;
      double tx = -contact.ny, ty = contact.nx;
      double rnA = contact.rax * contact.ny
                 - contact.ray * contact.nx;
      double rnB = B ? contact.rbx * contact.ny
                     - contact.rby * contact.nx : 0;
      double rtA = contact.rax * ty - contact.ray * tx;
      double rtB = B ? contact.rbx * ty - contact.rby * tx : 0;
      double normalK = aInvM + bInvM
        + aInvI * rnA * rnA + bInvI * rnB * rnB;
      double tangentK = aInvM + bInvM
        + aInvI * rtA * rtA + bInvI * rtB * rtB;
      if (!contact.bIntegrated) {
        bInvM = 0;
        bInvI = 0;
      }
      double biasK = aInvM + bInvM
        + aInvI * rnA * rnA + bInvI * rnB * rnB;
      contact.normalMass = normalK > 0 ? 1 / normalK : 0;
      contact.tangentMass = tangentK > 0 ? 1 / tangentK : 0;
      contact.biasMass = biasK > 0 ? 1 / biasK : 0;
#ifdef SAND_INVARIANT_CHECKS
      if (!std::isfinite(contact.normalMass)
          || !std::isfinite(contact.tangentMass)
          || !std::isfinite(contact.biasMass)
          || contact.normalMass < 0
          || contact.tangentMass < 0
          || contact.biasMass < 0) {
        emscripten_console_error(
          "RIGID CONTACT MASS INVARIANT: invalid effective mass");
        abort();
      }
#endif
      if (contact.depth > rigidMaxContactDepth)
        rigidMaxContactDepth = contact.depth;
      if (contact.persisted) rigidWarmStarted++;
      if (contact.persisted && (contact.accJn != 0 || contact.accJt != 0))
        applyWarmStart(contact);
    }
    for (const Contact& contact : contacts) {
      if (contact.persisted || contact.impactSpeed < 0.28) continue;
      E.audio.emit(SE_IMPACT, contact.a->px, contact.a->py,
                   std::min(1.8, 0.25 + contact.impactSpeed * 0.55), contact.a->material);
    }
    solveParent = stepIslandParent;
    for (const Contact& contact : contacts)
      if (contact.b && contact.bIntegrated)
        ufUnite(solveParent, contact.a->idx, contact.b->idx);
    std::fill(solveBodyCount.begin(), solveBodyCount.end(), 0);
    std::fill(solveMaxRadius.begin(), solveMaxRadius.end(), 0);
    std::fill(solveHasGeneral.begin(), solveHasGeneral.end(), 0);
    for (int bi = 0; bi < n; bi++) {
      int root = ufFind(solveParent, bi);
      solveBodyCount[root]++;
      solveMaxRadius[root] = std::fmax(solveMaxRadius[root], solverBodies[bi]->maxR);
      if (!solverBodies[bi]->blastDebris) solveHasGeneral[root] = 1;
    }
    contactOrder.resize(nc);
    contactRoot.resize(nc);
    for (int ci = 0; ci < nc; ci++) {
      contactOrder[ci] = ci;
      contactRoot[ci] = ufFind(solveParent, contacts[ci].a->idx);
    }
    std::sort(contactOrder.begin(), contactOrder.end(), [&](int a, int b) {
        if (contactRoot[a] != contactRoot[b])
          return contactRoot[a] < contactRoot[b];
        double ay = contacts[a].a->py + contacts[a].ray;
        double by = contacts[b].a->py + contacts[b].ray;
        if (ay != by) return ay > by;
        return a < b;
    });
    for (int islandStart = 0; islandStart < nc;) {
      int root = contactRoot[contactOrder[islandStart]];
      int islandEnd = islandStart + 1;
      while (islandEnd < nc
             && contactRoot[contactOrder[islandEnd]] == root)
        islandEnd++;
      int solverIters = R_BLAST_DEBRIS_SOLVER_ITERS;
      if (solveHasGeneral[root]) {
        solverIters = R_SOLVER_BASE_ITERS
          + R_SOLVER_ITERS_PER_BODY * solveBodyCount[root];
        if (solveMaxRadius[root] >= 24)
          solverIters = imax(solverIters, R_SOLVER_LARGE_BODY_ITERS);
        solverIters = imin(R_SOLVER_ITERS, solverIters);
      }
      bool hasImpactTarget = false;
      for (int oi = islandStart; oi < islandEnd; oi++)
        if (contacts[contactOrder[oi]].targetVn > 0) {
          hasImpactTarget = true;
          break;
        }
      if (hasImpactTarget) solverIters = R_SOLVER_ITERS;
      auto solveVelocity = [&](int ci) {
        Contact& contact = contacts[ci];
        int mate = contact.blockMate;
        if (mate >= 0)
          return ci < mate ? resolveContactBlock(contact, contacts[mate]) : 0.0;
        return resolveContact(contact);
      };
      // The first passes run from the lowest contact upward so support impulses
      // propagate through tall stacks promptly. Later passes alternate direction
      // to remove a permanent ordering bias.
      for (int it = 0; it < solverIters; it++) {
        rigidVelocityIterations++;
        double moved = 0;
        bool bottomUp = it < R_SHOCK_ORDER_ITERS || !(it & 1);
        if (bottomUp) {
          for (int oi = islandStart; oi < islandEnd; oi++)
            moved += solveVelocity(contactOrder[oi]);
        } else {
          for (int oi = islandEnd - 1; oi >= islandStart; oi--)
            moved += solveVelocity(contactOrder[oi]);
        }
        if (moved == 0.0) break;
      }
      for (int it = 0; it < solverIters; it++) {
        rigidBiasIterations++;
        double moved = 0;
        bool bottomUp = it < R_SHOCK_ORDER_ITERS || !(it & 1);
        if (bottomUp) {
          for (int oi = islandStart; oi < islandEnd; oi++)
            moved += resolveBias(contacts[contactOrder[oi]]);
        } else {
          for (int oi = islandEnd - 1; oi >= islandStart; oi--)
            moved += resolveBias(contacts[contactOrder[oi]]);
        }
        if (moved == 0.0) break;
      }
      islandStart = islandEnd;
    }
    ContactCache& nextContacts = nextContactCacheScratch;
    nextContacts.clear();
    nextContacts.reserve(previousContacts.size());
    for (const Contact& contact : contacts) {
      double lax, lay, lbx, lby;
      localAnchors(contact, lax, lay, lbx, lby);
      nextContacts[cacheKey(contact, contact.normalBucket)].push_back({
        lax, lay, lbx, lby, contact.nx, contact.ny,
        contact.accJn, contact.accJt, contact.dt, 0, false,
      });
    }
    // A raster contact can disappear for one substep while a long or slowly
    // rotating face crosses a cell boundary. Retain unmatched anchors briefly
    // with decaying impulses so the manifold reconnects without a cold solve.
    for (auto& entry : previousContacts) {
      for (CachedContact cached : entry.second) {
        auto bodyIt = bodyIndexById.find(entry.first.aId);
        bool activeKey = bodyIt != bodyIndexById.end()
          && activeBody[bodyIt->second];
        if (!activeKey) {
          cached.used = false;
          nextContacts[entry.first].push_back(cached);
          continue;
        }
        if (!entry.first.retainMissed) continue;
        if (cached.used || cached.age >= R_CONTACT_CACHE_MISSED_SUBSTEPS)
          continue;
        std::vector<CachedContact>& destination = nextContacts[entry.first];
        if ((int)destination.size() >= R_CONTACT_CACHE_MAX_PER_KEY) break;
        cached.age++;
        cached.jn *= R_CONTACT_CACHE_STALE_DECAY;
        cached.jt *= R_CONTACT_CACHE_STALE_DECAY;
        cached.used = false;
        destination.push_back(cached);
      }
    }
    previousContacts.swap(nextContacts);
    for (int bi = 0; bi < n; bi++) {
      Body* b = solverBodies[bi];
      if (!activeBody[bi] || !b->awake) continue;
      double dt = bodyDt[bi];
      b->px += (b->vx + b->pvx) * dt;
      b->py += (b->vy + b->pvy) * dt;
      b->angle += (b->omega + b->pw) * dt;
      // Granular support is sampled as a medium rather than a terrain contact.
      // Near rest, confirm the body has powder beneath its bottom edge so an
      // exact zero-velocity equilibrium can sleep and bake instead of remaining
      // an awake solver participant forever.
      bool looseContact = false;
      if (b->vx * b->vx + b->vy * b->vy < R_SLEEP_LIN * R_SLEEP_LIN
          && b->omega * b->omega < R_SLEEP_ANG * R_SLEEP_ANG
          && !liquidContact[bi]
          && bodyHasLooseSupport(b)) {
        b->hadContact = true;
        looseContact = true;
      }
      if (!b->hadContact) { b->stillTicks = 0; continue; }
      bool frictionalContact = solidContact[bi] || looseContact;
      if (frictionalContact
          && b->vx * b->vx + b->vy * b->vy < R_SETTLE_LIN * R_SETTLE_LIN) {
        b->vx *= R_CONTACT_LIN_DAMP;
        b->vy *= R_CONTACT_LIN_DAMP;
      }
      // Don't damp a spin the contact solve is actively building in one direction
      // (a body toppling about a corner): that is real rotation, not jitter, and
      // damping it every substep is what made hand-drawn bodies creep over
      // agonizingly slowly instead of tipping. Rest jitter oscillates sign / decays
      // (omega*omegaPre <= 0 or |omega| not growing) and is still damped, so bodies
      // whose centre of mass sits over their support stay put and settle as before.
      bool spinGrowing = b->omega * b->omegaPre > 0 && std::fabs(b->omega) > std::fabs(b->omegaPre);
      if (frictionalContact && !spinGrowing
          && b->omega * b->omega < R_SETTLE_ANG * R_SETTLE_ANG) {
        b->omega *= R_CONTACT_ANG_DAMP;
        int shortSide = imin(b->w, b->h);
        int longSide = imax(b->w, b->h);
        if (shortSide > 0 && longSide < shortSide * 2
            && std::fabs(b->omega) < R_CONTACT_ZERO_SQUAT_ANG)
          b->omega = 0;
      }
      bool fluidOnlyContact = liquidContact[bi] && !frictionalContact;
      fluidOnlySleep[bi] = fluidOnlyContact ? 1 : 0;
      // Dissipate residual vertical surface waves once the body is already
      // inside the ordinary settling band; translation and spin stay physical
      // at larger speeds.
      if (fluidOnlyContact && liquidSurfaceContact[bi]
          && std::fabs(b->vy) < R_SETTLE_LIN
          && b->maxDepth <= R_REST_DEPTH) {
        b->vy *= R_FLUID_REST_DAMP;
        int shortSide = imin(b->w, b->h);
        int longSide = imax(b->w, b->h);
        if (shortSide > 0 && longSide >= shortSide * 8
            && std::fabs(b->vx) < R_SETTLE_LIN
            && std::fabs(b->omega) < R_SETTLE_ANG) {
          b->vx *= R_FLUID_SLENDER_REST_DAMP;
          b->vy *= R_FLUID_SLENDER_REST_DAMP;
          b->omega *= R_FLUID_REST_DAMP;
        }
      }
      double sleepLinear = fluidOnlyContact ? R_FLUID_SLEEP_LIN : R_SLEEP_LIN;
      bool sleepQuiet = b->vx * b->vx + b->vy * b->vy < sleepLinear * sleepLinear
                     && b->omega * b->omega < R_SLEEP_ANG * R_SLEEP_ANG
                     && b->maxDepth <= R_REST_DEPTH;
      if (fluidOnlyContact && !liquidSurfaceContact[bi]) sleepQuiet = false;
      if (sleepQuiet) {
        b->stillTicks++;
      } else if (fluidOnlyContact) {
        b->stillTicks = liquidSurfaceContact[bi]
          ? imax(0, b->stillTicks - 1)
          : 0;
      } else {
        bool settling = b->vx * b->vx + b->vy * b->vy < R_SETTLE_LIN * R_SETTLE_LIN
                     && b->omega * b->omega < R_SETTLE_ANG * R_SETTLE_ANG
                     && b->maxDepth <= R_REST_DEPTH;
        b->stillTicks = settling ? std::fmax(0.0, b->stillTicks - 1.0) : 0;
      }
    }
  }
  std::vector<int>& savedBroadphaseIds = broadphaseBodyIds[activeLayer];
  savedBroadphaseIds.resize(broadphaseOrder.size());
  for (size_t i = 0; i < broadphaseOrder.size(); i++)
    savedBroadphaseIds[i] = solverBodies[broadphaseOrder[i]]->id;
  for (int bi = 0; bi < n; bi++) islandParent[bi] = bi;
  for (int ci = 0; ci < nc; ci++) {
    Contact& c = contacts[ci];
    if (!c.b || !c.bIntegrated || !c.a->awake || !c.b->awake) continue;
    ufUnite(islandParent, c.a->idx, c.b->idx);
  }
  for (int bi = 0; bi < n; bi++) islandMinStill[bi] = 1e18;
  for (int bi = 0; bi < n; bi++) {
    Body* b = solverBodies[bi];
    if (!b->awake) continue;
    int r = ufFind(islandParent, bi);
    double st = b->hadContact ? b->stillTicks : 0;
    if (fluidOnlySleep[bi])
      st *= (double)R_SLEEP_TICKS / R_FLUID_SLEEP_TICKS;
    if (st < islandMinStill[r]) islandMinStill[r] = st;
  }
  for (int bi = 0; bi < n; bi++) { Body* b = solverBodies[bi]; if (!b->awake) continue; if (islandMinStill[ufFind(islandParent, bi)] >= R_SLEEP_TICKS) { b->awake = false; b->vx = 0; b->vy = 0; b->omega = 0; if (b->jointRole == 1) syncJointFollower(b); } }
}
template <class F> void RigidBodySystem::forEachBodyCell(Body* b, F cb) {
  // Inverse rasterization: for each grid cell in the body's world AABB, map its
  // center back into occ space and stamp if filled. This is hole-free for
  // rotated E.L->bodies (forward occ->world point-sampling instead leaves gaps
  // between rotated E.rows). The body shape stays authoritative in occ.
  bool cacheValid = b->rasterFootprintValid
    && b->rasterPx == b->px
    && b->rasterPy == b->py
    && b->rasterAngle == b->angle
    && b->rasterGeometryRevision == b->geometryRevision
    && b->rasterCols == E.cols
    && b->rasterRows == E.rows;
  if (cacheValid) {
    for (const BodyRasterCell& cell : b->rasterFootprint)
      cb(cell.x, cell.y, cell.local);
    return;
  }
  double sn = std::sin(b->angle), cs = std::cos(b->angle);
  double lx0 = b->offsetX - 0.5, lx1 = b->offsetX + b->w - 0.5, ly0 = b->offsetY - 0.5, ly1 = b->offsetY + b->h - 0.5;
  double minWX = 1e18, minWY = 1e18, maxWX = -1e18, maxWY = -1e18;
  auto corner = [&](double lx, double ly) { double wx = b->px + lx * cs - ly * sn, wy = b->py + lx * sn + ly * cs; if (wx < minWX) minWX = wx; if (wx > maxWX) maxWX = wx; if (wy < minWY) minWY = wy; if (wy > maxWY) maxWY = wy; };
  corner(lx0, ly0); corner(lx1, ly0); corner(lx1, ly1); corner(lx0, ly1);
  int x0 = (int)std::floor(minWX), x1 = (int)std::floor(maxWX), y0 = (int)std::floor(minWY), y1 = (int)std::floor(maxWY);
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= E.cols) x1 = E.cols - 1; if (y1 >= E.rows) y1 = E.rows - 1;
  b->rasterFootprint.clear();
  for (int wy = y0; wy <= y1; wy++) for (int wx = x0; wx <= x1; wx++) {
    double dx = wx + 0.5 - b->px, dy = wy + 0.5 - b->py;
    double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    int i = (int)std::lround(lx - b->offsetX), j = (int)std::lround(ly - b->offsetY);
    if (i < 0 || i >= b->w || j < 0 || j >= b->h) continue;
    int local = j * b->w + i;
    if (b->occ[local] && bodyMaterialAt(b, local) != EMPTY)
      b->rasterFootprint.push_back({wx, wy, local});
  }
  b->rasterPx = b->px;
  b->rasterPy = b->py;
  b->rasterAngle = b->angle;
  b->rasterGeometryRevision = b->geometryRevision;
  b->rasterCols = E.cols;
  b->rasterRows = E.rows;
  b->rasterFootprintValid = true;
  for (const BodyRasterCell& cell : b->rasterFootprint)
    cb(cell.x, cell.y, cell.local);
}
int RigidBodySystem::localCellAt(Body* b, double wx, double wy) { b->cs = std::cos(b->angle); b->sn = std::sin(b->angle); return insideBodyIndex(b, wx, wy); }
bool RigidBodySystem::eraseLocalCell(Body* b, int idx) {
  if (idx < 0 || idx >= (int)b->occ.size() || !b->occ[idx]) return false;
  if (b->jointRole) breakJointBody(b);
  if (!b->occ[idx]) return false;
  b->occ[idx] = 0;
  if (!b->cellMaterials.empty()) b->cellMaterials[idx] = EMPTY;
  b->rasterFootprintValid = false;
  return true;
}

// Terrain and medium queries used by free bodies.
bool RigidBodySystem::isBodyTerrain(Body* body, int x, int y, double bodyDensity) {
  (void)bodyDensity;
  // The side sentinels bound the streamed cell window, not the physical world.
  // Treating them as terrain lets wall friction pin a buoyant body that happens
  // to straddle a streaming edge.
  if (E.L->infinite && (x == 0 || x == E.cols - 1)) return false;
  int k = y * E.cols + x;
  auto solidIn = [&](Layer& lay, bool peerLayer) {
    int owner = lay.bodyOwner[k];
    if (owner >= 0) {
      if (body && body->jointRole == 1 && owner == body->id) return false;
      // Owner cells stay present in the grid sweep. Same-layer ordinary bodies
      // use the body/body broad phase, while rigidStep promotes peer-layer owner
      // hits to dynamic contacts after the sweep identifies their exact cells.
      // Passive followers without an active leader mapping remain terrain.
      return peerLayer || lay.passiveBodyIds.count(owner) != 0;
    }
    uint8_t material = lay.grid[k];
    if (E.isBuoyantMedium(material)) return false;
    return E.isRigidMaterialClass(material);
  };
  if (body && body->jointRole == 1)
    return solidIn(E.fg, false) || solidIn(E.bg, true);
  return solidIn(*E.L, false);
}
bool RigidBodySystem::coupleLiquids(const std::vector<Body*>& bodies, double dt) {
  const int cellCount = E.cols * E.rows;
  fluidBodySurface.assign(bodies.size(), 0);
  if (bodies.empty() || cellCount == 0) return false;
  const int activeLayer = E.L == &E.bg ? 1 : 0;
  auto touchesLiquid = [&](Body* body, Layer& layer) {
    bool found = false;
    forEachBodyCell(body, [&](int x, int y, int local) {
      if (found) return;
      int lx = local - (local / body->w) * body->w;
      int ly = local / body->w;
      auto occupied = [&](int xx, int yy) {
        return xx >= 0 && xx < body->w && yy >= 0 && yy < body->h
            && body->occ[yy * body->w + xx];
      };
      if (occupied(lx - 1, ly) && occupied(lx + 1, ly)
          && occupied(lx, ly - 1) && occupied(lx, ly + 1))
        return;
      int k = y * E.cols + x;
      if ((x > 0 && E.isLiquidMaterial(layer.grid[k - 1]))
          || (x + 1 < E.cols && E.isLiquidMaterial(layer.grid[k + 1]))
          || (y > 0 && E.isLiquidMaterial(layer.grid[k - E.cols]))
          || (y + 1 < E.rows
              && E.isLiquidMaterial(layer.grid[k + E.cols])))
        found = true;
    });
    return found;
  };
  bool liquidCandidate = false;
  for (Body* body : bodies) {
    if (!body->awake) continue;
    Layer& layer = activeLayer == 0 ? E.fg : E.bg;
    if (touchesLiquid(body, layer)) {
      liquidCandidate = true;
      break;
    }
    if (body->jointRole == 1 && body->jointPeer) {
      Layer& peerLayer = activeLayer == 0 ? E.bg : E.fg;
      if (touchesLiquid(body->jointPeer, peerLayer)) {
        liquidCandidate = true;
        break;
      }
    }
  }
  if (!liquidCandidate) return false;
  for (int layer = 0; layer < 2; layer++) {
    if ((int)fluidNodeStamp[layer].size() != cellCount) {
      fluidNodeStamp[layer].assign(cellCount, 0);
      fluidNodeIndex[layer].assign(cellCount, -1);
      fluidBodyStamp[layer].assign(cellCount, 0);
      fluidBodyIndex[layer].assign(cellCount, -1);
      fluidPressureCache[layer].assign(cellCount, 0);
      fluidPressureWorldX[layer] = fluidPressureWorldY[layer] = INT32_MIN;
    }
    Layer* cacheLayer = layer == 0 ? &E.fg : &E.bg;
    if (fluidPressureWorldX[layer] != cacheLayer->worldOffsetX
        || fluidPressureWorldY[layer] != cacheLayer->worldOffsetY) {
      std::fill(fluidPressureCache[layer].begin(), fluidPressureCache[layer].end(), 0);
      fluidPressureWorldX[layer] = cacheLayer->worldOffsetX;
      fluidPressureWorldY[layer] = cacheLayer->worldOffsetY;
    }
  }
  if (++fluidNodeGeneration <= 0) {
    fluidNodeGeneration = 1;
    for (auto& stamp : fluidNodeStamp) std::fill(stamp.begin(), stamp.end(), 0);
  }
  if (++fluidBodyGeneration <= 0) {
    fluidBodyGeneration = 1;
    for (auto& stamp : fluidBodyStamp) std::fill(stamp.begin(), stamp.end(), 0);
  }

  fluidQueue.clear();
  fluidBodyBounds.assign(bodies.size() * 2,
                         {{E.cols, E.rows, -1, -1}});
  auto stampBody = [&](Body* body, int bodyIndex, int layer, bool seedLiquid) {
    std::array<int, 4>& bounds = fluidBodyBounds[bodyIndex * 2 + layer];
    forEachBodyCell(body, [&](int x, int y, int local) {
      int k = y * E.cols + x;
      fluidBodyStamp[layer][k] = fluidBodyGeneration;
      fluidBodyIndex[layer][k] = bodyIndex;
      bounds[0] = imin(bounds[0], x);
      bounds[1] = imin(bounds[1], y);
      bounds[2] = imax(bounds[2], x);
      bounds[3] = imax(bounds[3], y);
      if (!seedLiquid) return;
      int lx = local - (local / body->w) * body->w;
      int ly = local / body->w;
      auto occupied = [&](int xx, int yy) {
        return xx >= 0 && xx < body->w && yy >= 0 && yy < body->h
            && body->occ[yy * body->w + xx];
      };
      if (!occupied(lx - 1, ly) || !occupied(lx + 1, ly)
          || !occupied(lx, ly - 1) || !occupied(lx, ly + 1))
        fluidQueue.push_back(layer * cellCount + k);
    });
  };
  for (int i = 0; i < (int)bodies.size(); i++) {
    Body* body = bodies[i];
    stampBody(body, i, activeLayer, body->awake);
    if (body->jointRole == 1 && body->jointPeer)
      stampBody(body->jointPeer, i, 1 - activeLayer, body->awake);
  }

  auto layerAt = [&](int index) -> Layer* { return index == 0 ? &E.fg : &E.bg; };
  fluidSeeds.clear();
  const int offsets[4] = {-1, 1, -E.cols, E.cols};
  for (int packed : fluidQueue) {
    int layer = packed / cellCount;
    int k = packed - layer * cellCount;
    Layer* lay = layerAt(layer);
    int x = k - (k / E.cols) * E.cols, y = k / E.cols;
    int bodyIndex = fluidBodyIndex[layer][k];
    for (int d = 0; d < 4; d++) {
      if ((d == 0 && x == 0) || (d == 1 && x == E.cols - 1)
          || (d == 2 && y == 0) || (d == 3 && y == E.rows - 1)) continue;
      int nk = k + offsets[d];
      if (fluidBodyStamp[layer][nk] == fluidBodyGeneration) continue;
      if (E.isLiquidMaterial(lay->grid[nk]))
        fluidSeeds.push_back({layer * cellCount + nk, bodyIndex});
      else if (lay->grid[nk] == EMPTY || E.isGasMaterial(lay->grid[nk]))
        fluidBodySurface[bodyIndex] = 1;
    }
  }
  fluidQueue.clear();
  if (fluidSeeds.empty()) return false;
  std::sort(fluidSeeds.begin(), fluidSeeds.end(),
            [](const FluidSeed& a, const FluidSeed& b) {
              return a.packedCell != b.packedCell
                ? a.packedCell < b.packedCell : a.body < b.body;
            });
  fluidSeeds.erase(
    std::unique(fluidSeeds.begin(), fluidSeeds.end(),
                [](const FluidSeed& a, const FluidSeed& b) {
                  return a.packedCell == b.packedCell;
                }),
    fluidSeeds.end());

  // Each body samples hydrostatic head in the nearest open liquid columns just
  // outside its raster. This preserves density layers and nearby wave height
  // without walking the connected pool. The local pressure domain interpolates
  // between the two sides; sealed regions fall back to their cached pressure.
  fluidReferences.resize(bodies.size() * 2);
  std::vector<double> candidatePressure;
  candidatePressure.reserve(E.rows);
  std::vector<std::pair<int, int>> referenceColumns;
  auto buildReferenceColumn = [&](int layer, int x,
                                  std::vector<double>& pressureOut) {
    pressureOut.assign(E.rows, 0);
    if (x < 0 || x >= E.cols) return false;
    Layer* lay = layerAt(layer);
    bool inLiquid = false, openSegment = false, found = false;
    double pressure = 0, priorDensity = 0;
    for (int y = 0; y < E.rows; y++) {
      int k = y * E.cols + x;
      uint8_t material = lay->grid[k];
      bool liquid = fluidBodyStamp[layer][k] != fluidBodyGeneration
                 && E.isLiquidMaterial(material);
      if (!liquid) {
        inLiquid = openSegment = false;
        pressure = priorDensity = 0;
        continue;
      }
      double density = DENSITY[material];
      if (!inLiquid) {
        bool exposed = y == 0;
        if (y > 0) {
          int above = k - E.cols;
          uint8_t aboveMaterial = lay->grid[above];
          exposed = fluidBodyStamp[layer][above] != fluidBodyGeneration
                 && (aboveMaterial == EMPTY || E.isGasMaterial(aboveMaterial));
        }
        openSegment = exposed;
        pressure = density * E.scaledGravity(R_GRAVITY) * dt * 0.5;
      } else {
        pressure += (priorDensity + density) * 0.5 * E.scaledGravity(R_GRAVITY) * dt;
      }
      inLiquid = true;
      priorDensity = density;
      if (openSegment) {
        pressureOut[y] = pressure;
        found = true;
      }
    }
    return found;
  };
  auto selectSideReference = [&](int layer, int edgeX, int direction,
                                 int& referenceX,
                                 std::vector<double>& pressureOut) {
    referenceColumns.clear();
    for (int distance = 1; distance <= R_FLUID_REFERENCE_SEARCH; distance++) {
      int x = edgeX + direction * distance;
      if (!buildReferenceColumn(layer, x, candidatePressure)) continue;
      int surfaceY = 0;
      while (surfaceY < E.rows && candidatePressure[surfaceY] <= 0) surfaceY++;
      if (surfaceY < E.rows) referenceColumns.push_back({surfaceY, x});
    }
    if (referenceColumns.empty()) return;
    std::sort(referenceColumns.begin(), referenceColumns.end());
    referenceX = referenceColumns[referenceColumns.size() / 2].second;
    buildReferenceColumn(layer, referenceX, pressureOut);
  };
  for (int bodyIndex = 0; bodyIndex < (int)bodies.size(); bodyIndex++) {
    for (int layer = 0; layer < 2; layer++) {
      FluidReference& reference = fluidReferences[bodyIndex * 2 + layer];
      reference.leftX = reference.rightX = -1;
      reference.leftPressure.clear();
      reference.rightPressure.clear();
      const std::array<int, 4>& bounds =
        fluidBodyBounds[bodyIndex * 2 + layer];
      if (bounds[2] < bounds[0]) continue;
      if (E.isIceMaterial(bodies[bodyIndex]->material)) {
        selectSideReference(layer, bounds[0], -1, reference.leftX,
                            reference.leftPressure);
        selectSideReference(layer, bounds[2], 1, reference.rightX,
                            reference.rightPressure);
      } else {
        for (int distance = 1; distance <= R_FLUID_REFERENCE_SEARCH; distance++) {
          int x = bounds[0] - distance;
          if (!buildReferenceColumn(layer, x, candidatePressure)) continue;
          reference.leftX = x;
          reference.leftPressure = candidatePressure;
          break;
        }
        for (int distance = 1; distance <= R_FLUID_REFERENCE_SEARCH; distance++) {
          int x = bounds[2] + distance;
          if (!buildReferenceColumn(layer, x, candidatePressure)) continue;
          reference.rightX = x;
          reference.rightPressure = candidatePressure;
          break;
        }
      }
    }
  }
  auto referencePressureAt = [&](int sourceBody, int layer, int cell) {
    double cached = std::fmax(0.0f, fluidPressureCache[layer][cell]);
    if (sourceBody < 0 || sourceBody >= (int)bodies.size()) return cached;
    const FluidReference& reference =
      fluidReferences[sourceBody * 2 + layer];
    int y = cell / E.cols, x = cell - y * E.cols;
    double left = reference.leftX >= 0 ? reference.leftPressure[y] : 0;
    double right = reference.rightX >= 0 ? reference.rightPressure[y] : 0;
    if (left <= 0) return right > 0 ? right : cached;
    if (right <= 0) return left;
    double width = reference.rightX - reference.leftX;
    double weight = width > 0
      ? std::fmax(0.0, std::fmin(1.0, (x - reference.leftX) / width))
      : 0.5;
    return left + (right - left) * weight;
  };

  fluidNodes.clear();
  fluidNodeDepth.clear();
  fluidQueue.clear();
  uint8_t coupledMaterial = EMPTY;
  bool heterogeneousCoupling = false;
  // A deterministic multi-source flood extends a uniform near-field band from
  // wet body surfaces. Remote cells remain in the cellular solver.
  auto addNode = [&](int layer, int k, int depth, int sourceBody) {
    if (fluidNodeStamp[layer][k] == fluidNodeGeneration) return false;
    if (fluidBodyStamp[layer][k] == fluidBodyGeneration) return false;
    Layer* lay = layerAt(layer);
    uint8_t material = lay->grid[k];
    if (!E.isLiquidMaterial(material)) return false;
    if (coupledMaterial == EMPTY)
      coupledMaterial = material;
    else if (coupledMaterial != material)
      heterogeneousCoupling = true;
    fluidNodeStamp[layer][k] = fluidNodeGeneration;
    fluidNodeIndex[layer][k] = (int)fluidNodes.size();
    uint32_t packedVelocity = lay->liquidVel ? lay->liquidVel[k] : 0;
    double vx = E.liquidVelocityX(packedVelocity);
    double vy = E.liquidVelocityY(packedVelocity);
    double pressure = std::fmax(0.0f, fluidPressureCache[layer][k]);
    fluidNodes.push_back({lay, k, -1, sourceBody, material, vx, vy + E.scaledGravity(R_GRAVITY) * dt,
                          pressure});
    fluidNodeDepth.push_back(depth);
    fluidQueue.push_back(layer * cellCount + k);
    return true;
  };
  for (const FluidSeed& seed : fluidSeeds) {
    int layer = seed.packedCell / cellCount;
    int k = seed.packedCell - layer * cellCount;
    addNode(layer, k, 0, seed.body);
  }
  for (size_t qi = 0; qi < fluidQueue.size(); qi++) {
    int packed = fluidQueue[qi];
    int qLayer = packed / cellCount, qk = packed - qLayer * cellCount;
    int nodeIndex = fluidNodeIndex[qLayer][qk];
    int depth = fluidNodeDepth[nodeIndex];
    int sourceBody = fluidNodes[nodeIndex].sourceBody;
    if (depth >= R_FLUID_DOMAIN_RADIUS) continue;
    int y = qk / E.cols, x = qk - y * E.cols;
    if (x > 0) addNode(qLayer, qk - 1, depth + 1, sourceBody);
    if (x + 1 < E.cols) addNode(qLayer, qk + 1, depth + 1, sourceBody);
    if (y > 0) addNode(qLayer, qk - E.cols, depth + 1, sourceBody);
    if (y + 1 < E.rows) addNode(qLayer, qk + E.cols, depth + 1, sourceBody);
  }
  if (heterogeneousCoupling) {
    // A local density interface needs both sides in one pressure projection.
    // This fallback is intentionally rare: ordinary single-material reservoirs
    // retain the fixed band and never walk the connected pool.
    for (size_t qi = 0; qi < fluidQueue.size(); qi++) {
      int packed = fluidQueue[qi];
      int qLayer = packed / cellCount, qk = packed - qLayer * cellCount;
      int nodeIndex = fluidNodeIndex[qLayer][qk];
      int sourceBody = fluidNodes[nodeIndex].sourceBody;
      int y = qk / E.cols, x = qk - y * E.cols;
      if (x > 0) addNode(qLayer, qk - 1, 0, sourceBody);
      if (x + 1 < E.cols) addNode(qLayer, qk + 1, 0, sourceBody);
      if (y > 0) addNode(qLayer, qk - E.cols, 0, sourceBody);
      if (y + 1 < E.rows) addNode(qLayer, qk + E.cols, 0, sourceBody);
    }
  }
  if (fluidNodes.empty()) return false;
  std::sort(fluidNodes.begin(), fluidNodes.end(), [&](const FluidNode& a, const FluidNode& b) {
    int aLayer = a.layer == &E.bg ? 1 : 0;
    int bLayer = b.layer == &E.bg ? 1 : 0;
    return aLayer != bLayer ? aLayer < bLayer : a.cell < b.cell;
  });
  for (int i = 0; i < (int)fluidNodes.size(); i++) {
    FluidNode& node = fluidNodes[i];
    int layer = node.layer == &E.bg ? 1 : 0;
    fluidNodeIndex[layer][node.cell] = i;
  }
  int component = 0;
  std::vector<int> componentFirst;
  fluidQueue.clear();
  for (int first = 0; first < (int)fluidNodes.size(); first++) {
    if (fluidNodes[first].component >= 0) continue;
    componentFirst.push_back(first);
    fluidNodes[first].component = component;
    fluidQueue.push_back(first);
    for (size_t qi = 0; qi < fluidQueue.size(); qi++) {
      FluidNode& node = fluidNodes[fluidQueue[qi]];
      int layer = node.layer == &E.bg ? 1 : 0;
      int y = node.cell / E.cols, x = node.cell - y * E.cols;
      auto visit = [&](int k) {
        if (fluidNodeStamp[layer][k] != fluidNodeGeneration) return;
        int ni = fluidNodeIndex[layer][k];
        if (fluidNodes[ni].component >= 0) return;
        fluidNodes[ni].component = component;
        fluidQueue.push_back(ni);
      };
      if (x > 0) visit(node.cell - 1);
      if (x + 1 < E.cols) visit(node.cell + 1);
      if (y > 0) visit(node.cell - E.cols);
      if (y + 1 < E.rows) visit(node.cell + E.cols);
    }
    fluidQueue.clear();
    component++;
  }

  fluidFaces.clear();
  std::vector<uint8_t> componentHasAir((size_t)component, 0);
  std::vector<uint8_t> componentHasDomain((size_t)component, 0);
  auto addBoundaryFace = [&](int ni, int layer, int nk, int nx, int ny, bool outside) {
    FluidNode& node = fluidNodes[ni];
    if (outside) {
      fluidFaces.push_back({ni, -1, -1, (int8_t)nx, (int8_t)ny, 0, 0, 0, FF_STATIC});
      return;
    }
    if (fluidBodyStamp[layer][nk] == fluidBodyGeneration) {
      int bodyIndex = fluidBodyIndex[layer][nk];
      Body* body = bodies[bodyIndex];
      double x = node.cell - (node.cell / E.cols) * E.cols + 0.5 + nx * 0.5;
      double y = node.cell / E.cols + 0.5 + ny * 0.5;
      double rx = x - body->px, ry = y - body->py;
      double bodyNormal = (body->vx - body->omega * ry) * nx
                        + (body->vy + body->omega * rx) * ny;
      if (!body->awake) {
        fluidFaces.push_back({ni, -1, -1, (int8_t)nx, (int8_t)ny,
                              0, 0, 0, FF_STATIC});
      } else {
        fluidFaces.push_back({ni, -1, bodyIndex, (int8_t)nx, (int8_t)ny,
                              rx, ry, bodyNormal, FF_BODY});
        body->hadContact = true;
      }
      return;
    }
    uint8_t material = layerAt(layer)->grid[nk];
    if (E.isLiquidMaterial(material)) {
      uint32_t packedVelocity = layerAt(layer)->liquidVel[nk];
      double outsideVx = E.liquidVelocityX(packedVelocity);
      double outsideVy = E.liquidVelocityY(packedVelocity) + E.scaledGravity(R_GRAVITY) * dt;
      double predicted = (node.vx + outsideVx) * nx * 0.5
                       + (node.vy + outsideVy) * ny * 0.5;
      FluidFace face{ni, nk, -1, (int8_t)nx, (int8_t)ny,
                     outsideVx, E.liquidVelocityY(packedVelocity), predicted, FF_DOMAIN};
      face.inverseDensity =
        2.0 / (DENSITY[node.material] + DENSITY[material]);
      // The lateral Robin coefficient represents the pressure response of the
      // unresolved reservoir between this face and the far field.
      if (nx) face.inverseDensity /= R_FLUID_DOMAIN_RADIUS;
      face.boundaryPressure =
        referencePressureAt(node.sourceBody, layer, nk);
      fluidFaces.push_back(face);
      return;
    }
    if (material == EMPTY || E.isGasMaterial(material)) {
      double normal = node.vx * nx + node.vy * ny;
      fluidFaces.push_back({ni, -1, -1, (int8_t)nx, (int8_t)ny, 0, 0, normal, FF_AIR});
      componentHasAir[node.component] = 1;
    } else {
      fluidFaces.push_back({ni, -1, -1, (int8_t)nx, (int8_t)ny, 0, 0, 0, FF_STATIC});
    }
  };

  for (int ni = 0; ni < (int)fluidNodes.size(); ni++) {
    FluidNode& node = fluidNodes[ni];
    int layer = node.layer == &E.bg ? 1 : 0;
    int y = node.cell / E.cols, x = node.cell - y * E.cols;
    const int nx[4] = {-1, 1, 0, 0};
    const int ny[4] = {0, 0, -1, 1};
    for (int d = 0; d < 4; d++) {
      int xx = x + nx[d], yy = y + ny[d];
      bool outside = xx < 0 || xx >= E.cols || yy < 0 || yy >= E.rows;
      int nk = outside ? node.cell : yy * E.cols + xx;
      if (!outside && E.isLiquidMaterial(node.layer->grid[nk])
          && fluidNodeStamp[layer][nk] == fluidNodeGeneration) {
        if (d == 1 || d == 3) {
          int other = fluidNodeIndex[layer][nk];
          double predicted = (node.vx + fluidNodes[other].vx) * nx[d] * 0.5
                           + (node.vy + fluidNodes[other].vy) * ny[d] * 0.5;
          fluidFaces.push_back({ni, other, -1, (int8_t)nx[d], (int8_t)ny[d],
                                0, 0, predicted, FF_INTERNAL});
        }
        continue;
      }
      addBoundaryFace(ni, layer, nk, nx[d], ny[d], outside);
    }
  }
  for (FluidFace& face : fluidFaces) {
    if (face.kind != FF_DOMAIN) continue;
    FluidNode& node = fluidNodes[face.a];
    componentHasDomain[node.component] = 1;
  }
  // The Krylov operator revisits these faces up to the iteration limit. Keep
  // its fluid stencil compact and precompute invariant density coefficients;
  // full faces remain available to the one-pass velocity reconstruction.
  fluidOperatorFaces.clear();
  fluidOperatorFaces.reserve(fluidFaces.size());
  fluidBodyFaceIndices.clear();
  for (int faceIndex = 0; faceIndex < (int)fluidFaces.size(); faceIndex++) {
    const FluidFace& face = fluidFaces[faceIndex];
    if (face.kind == FF_INTERNAL) {
      double inverseDensity =
        2.0 / (DENSITY[fluidNodes[face.a].material]
             + DENSITY[fluidNodes[face.b].material]);
      fluidOperatorFaces.push_back({face.a, face.b, inverseDensity});
    } else if (face.kind == FF_AIR) {
      fluidOperatorFaces.push_back(
        {face.a, -1, 1.0 / DENSITY[fluidNodes[face.a].material]});
    } else if (face.kind == FF_DOMAIN) {
      fluidOperatorFaces.push_back({face.a, -1, face.inverseDensity});
    } else if (face.kind == FF_BODY) {
      fluidBodyFaceIndices.push_back(faceIndex);
    }
  }

  const int nodeCount = (int)fluidNodes.size();
  fluidSolvePressure.resize(nodeCount);
  fluidSolveResidual.assign(nodeCount, 0);
  fluidSolveDirection.resize(nodeCount);
  fluidSolveApplied.resize(nodeCount);
  fluidSolvePreconditioned.resize(nodeCount);
  fluidSolveDiagonal.assign(nodeCount, 1e-9);
  fluidSolveFactorDiagonal.resize(nodeCount);
  fluidSolveLower.assign(nodeCount, {{-1, -1}});
  fluidSolveLowerMatrix.assign(nodeCount, {{0, 0}});
  fluidSolveLowerFactor.assign(nodeCount, {{0, 0}});
  fluidSolveLowerCount.assign(nodeCount, 0);
  fluidSolvePinned.assign(nodeCount, 0);
  for (int i = 0; i < nodeCount; i++)
    fluidSolvePressure[i] = fluidNodes[i].pressure;
  fluidBodyDVX.assign(bodies.size(), 0);
  fluidBodyDVY.assign(bodies.size(), 0);
  fluidBodyDW.assign(bodies.size(), 0);
  for (const FluidFace& face : fluidFaces) {
    if (face.kind == FF_INTERNAL) {
      double invDensity = 2.0 / (DENSITY[fluidNodes[face.a].material]
                               + DENSITY[fluidNodes[face.b].material]);
      fluidSolveResidual[face.a] -= face.predicted;
      fluidSolveResidual[face.b] += face.predicted;
      fluidSolveDiagonal[face.a] += invDensity;
      fluidSolveDiagonal[face.b] += invDensity;
      int lo = imin(face.a, face.b), hi = imax(face.a, face.b);
      int lowerCount = fluidSolveLowerCount[hi];
      if (lowerCount < 2) {
        fluidSolveLower[hi][lowerCount] = lo;
        fluidSolveLowerMatrix[hi][lowerCount] = -invDensity;
        fluidSolveLowerCount[hi] = lowerCount + 1;
      }
    } else {
      fluidSolveResidual[face.a] -= face.predicted;
      if (face.kind == FF_AIR)
        fluidSolveDiagonal[face.a] +=
          1.0 / DENSITY[fluidNodes[face.a].material];
      else if (face.kind == FF_DOMAIN) {
        fluidSolveResidual[face.a] +=
          face.boundaryPressure * face.inverseDensity;
        fluidSolveDiagonal[face.a] += face.inverseDensity;
      } else if (face.kind == FF_BODY) {
        Body* body = bodies[face.body];
        double cross = face.rx * face.ny - face.ry * face.nx;
        fluidSolveDiagonal[face.a] +=
          body->invMass + cross * cross * body->invInertia;
      }
    }
  }
  fluidRHS.resize(nodeCount);
  for (int i = 0; i < nodeCount; i++)
    fluidRHS[i] = fluidSolveResidual[i];
  bool hasPinned = false;
  for (int c = 0; c < component; c++) {
    if (componentHasAir[c] || componentHasDomain[c]) continue;
    fluidSolvePinned[componentFirst[c]] = 1;
    hasPinned = true;
  }
  auto applyPressureOperator = [&](const double* value,
                                   std::vector<double>& output) {
    std::fill(output.begin(), output.end(), 0);
    std::fill(fluidBodyDVX.begin(), fluidBodyDVX.end(), 0);
    std::fill(fluidBodyDVY.begin(), fluidBodyDVY.end(), 0);
    std::fill(fluidBodyDW.begin(), fluidBodyDW.end(), 0);
    for (const FluidOperatorFace& face : fluidOperatorFaces) {
      if (face.b >= 0) {
        double delta =
          (value[face.a] - value[face.b]) * face.inverseDensity;
        output[face.a] += delta;
        output[face.b] -= delta;
      } else {
        output[face.a] += value[face.a] * face.inverseDensity;
      }
    }
    for (int faceIndex : fluidBodyFaceIndices) {
      const FluidFace& face = fluidFaces[faceIndex];
      double impulse = value[face.a];
      Body* body = bodies[face.body];
      double cross = face.rx * face.ny - face.ry * face.nx;
      fluidBodyDVX[face.body] += impulse * face.nx * body->invMass;
      fluidBodyDVY[face.body] += impulse * face.ny * body->invMass;
      fluidBodyDW[face.body] += impulse * cross * body->invInertia;
    }
    for (int faceIndex : fluidBodyFaceIndices) {
      const FluidFace& face = fluidFaces[faceIndex];
      double cross = face.rx * face.ny - face.ry * face.nx;
      output[face.a] += fluidBodyDVX[face.body] * face.nx
                      + fluidBodyDVY[face.body] * face.ny
                      + fluidBodyDW[face.body] * cross;
    }
    if (hasPinned)
      for (int i = 0; i < nodeCount; i++)
        if (fluidSolvePinned[i]) output[i] = value[i];
    double dot = 0;
    for (int i = 0; i < nodeCount; i++)
      dot += value[i] * output[i];
    return dot;
  };
  auto applyPressureMatrix = [&](bool useDirection) {
    const double* value = useDirection
      ? fluidSolveDirection.data() : fluidSolvePressure.data();
    return applyPressureOperator(value, fluidSolveApplied);
  };

  for (int activeSet = 0; activeSet < 2; activeSet++) {
    if (hasPinned)
      for (int i = 0; i < nodeCount; i++)
        if (fluidSolvePinned[i]) fluidSolvePressure[i] = 0;
    for (int i = 0; i < nodeCount; i++) {
      int lowerCount = fluidSolveLowerCount[i];
      if (hasPinned && fluidSolvePinned[i]) {
        fluidSolveFactorDiagonal[i] = 1;
        for (int edge = 0; edge < lowerCount; edge++)
          fluidSolveLowerFactor[i][edge] = 0;
        continue;
      }
      double diagonal = fluidSolveDiagonal[i];
      for (int edge = 0; edge < lowerCount; edge++) {
        int j = fluidSolveLower[i][edge];
        if (hasPinned && fluidSolvePinned[j]) {
          fluidSolveLowerFactor[i][edge] = 0;
          continue;
        }
        double correction = 0;
        for (int a = 0; a < edge; a++) {
          int common = fluidSolveLower[i][a];
          if (common >= j) continue;
          for (int b = 0; b < fluidSolveLowerCount[j]; b++)
            if (fluidSolveLower[j][b] == common)
              correction += fluidSolveLowerFactor[i][a]
                          * fluidSolveLowerFactor[j][b];
        }
        fluidSolveLowerFactor[i][edge] =
          (fluidSolveLowerMatrix[i][edge] - correction)
          / fluidSolveFactorDiagonal[j];
        diagonal -= fluidSolveLowerFactor[i][edge]
                  * fluidSolveLowerFactor[i][edge];
      }
      fluidSolveFactorDiagonal[i] =
        std::sqrt(std::fmax(diagonal, 1e-9));
    }
    auto applyPreconditioner = [&]() {
      for (int i = 0; i < nodeCount; i++) {
        if (hasPinned && fluidSolvePinned[i]) {
          fluidSolveApplied[i] = fluidSolvePreconditioned[i] = 0;
          continue;
        }
        double value = fluidSolveResidual[i];
        for (int edge = 0; edge < fluidSolveLowerCount[i]; edge++)
          value -= fluidSolveLowerFactor[i][edge]
                 * fluidSolveApplied[fluidSolveLower[i][edge]];
        fluidSolveApplied[i] = value / fluidSolveFactorDiagonal[i];
      }
      for (int i = nodeCount - 1; i >= 0; i--) {
        if (hasPinned && fluidSolvePinned[i]) continue;
        fluidSolvePreconditioned[i] =
          fluidSolveApplied[i] / fluidSolveFactorDiagonal[i];
        for (int edge = 0; edge < fluidSolveLowerCount[i]; edge++)
          fluidSolveApplied[fluidSolveLower[i][edge]] -=
            fluidSolveLowerFactor[i][edge]
            * fluidSolvePreconditioned[i];
      }
    };
    applyPressureMatrix(false);
    double rz = 0, rhsNorm = 0;
    for (int i = 0; i < nodeCount; i++) {
      if (hasPinned && fluidSolvePinned[i]) {
        fluidSolveResidual[i] = fluidSolveDirection[i] = 0;
        continue;
      }
      fluidSolveResidual[i] = fluidRHS[i] - fluidSolveApplied[i];
      rhsNorm += fluidSolveResidual[i] * fluidSolveResidual[i];
    }
    applyPreconditioner();
    for (int i = 0; i < nodeCount; i++) {
      if (hasPinned && fluidSolvePinned[i]) continue;
      fluidSolveDirection[i] = fluidSolvePreconditioned[i];
      rz += fluidSolveResidual[i] * fluidSolvePreconditioned[i];
    }
    for (int iteration = 0; iteration < R_FLUID_PRESSURE_ITERS && rz > 1e-18; iteration++) {
      double denom = applyPressureMatrix(true);
      if (denom <= 1e-18) break;
      double alpha = rz / denom;
      double residualNorm = 0;
      if (hasPinned) {
        for (int i = 0; i < nodeCount; i++) {
          if (fluidSolvePinned[i]) continue;
          fluidSolvePressure[i] += alpha * fluidSolveDirection[i];
          fluidSolveResidual[i] -= alpha * fluidSolveApplied[i];
          residualNorm += fluidSolveResidual[i] * fluidSolveResidual[i];
        }
      } else {
        // This norm controls stopping only; pressure arithmetic remains
        // lane-independent while the reduction uses SIMD.
        #pragma clang loop vectorize(enable)
        for (int i = 0; i < nodeCount; i++) {
          fluidSolvePressure[i] += alpha * fluidSolveDirection[i];
          fluidSolveResidual[i] -= alpha * fluidSolveApplied[i];
          residualNorm += fluidSolveResidual[i] * fluidSolveResidual[i];
        }
      }
      applyPreconditioner();
      double nextRz = 0;
      for (int i = 0; i < nodeCount; i++)
        if (!hasPinned || !fluidSolvePinned[i])
          nextRz += fluidSolveResidual[i] * fluidSolvePreconditioned[i];
      if (residualNorm <= rhsNorm * R_FLUID_PRESSURE_REL_RESIDUAL2) {
        rz = nextRz;
        break;
      }
      double beta = nextRz / rz;
      if (hasPinned) {
        for (int i = 0; i < nodeCount; i++)
          if (!fluidSolvePinned[i])
            fluidSolveDirection[i] =
              fluidSolvePreconditioned[i] + beta * fluidSolveDirection[i];
      } else {
        for (int i = 0; i < nodeCount; i++)
          fluidSolveDirection[i] =
            fluidSolvePreconditioned[i] + beta * fluidSolveDirection[i];
      }
      rz = nextRz;
    }
    bool clamped = false;
    for (int i = 0; i < nodeCount; i++)
      if (!fluidSolvePinned[i] && fluidSolvePressure[i] < 0) {
        fluidSolvePinned[i] = 1;
        fluidSolvePressure[i] = 0;
        clamped = true;
        hasPinned = true;
      }
    if (!clamped) break;
  }

  for (int i = 0; i < nodeCount; i++)
    fluidNodes[i].pressure = fluidSolvePressure[i];
  applyPressureMatrix(false);
  for (int i = 0; i < (int)bodies.size(); i++) {
    Body* body = bodies[i];
    if (fluidBodyDVX[i] == 0 && fluidBodyDVY[i] == 0 && fluidBodyDW[i] == 0) continue;
    if (!body->awake) wakeBody(body);
    body->vx += fluidBodyDVX[i];
    body->vy += fluidBodyDVY[i];
    body->omega += fluidBodyDW[i];
    body->hadContact = true;
  }

  // Reconstruct cell-centered velocity from the projected face fluxes. The
  // pressure solve operates on these face fluxes, and this transfer carries its
  // no-penetration and zero-divergence result into persistent liquid velocity.
  for (FluidNode& node : fluidNodes) node.residual = node.direction = 0;
  for (const FluidFace& face : fluidFaces) {
    FluidNode& a = fluidNodes[face.a];
    double normalVelocity = 0;
    if (face.kind == FF_INTERNAL) {
      FluidNode& b = fluidNodes[face.b];
      double inverseDensity = 2.0 / (DENSITY[a.material] + DENSITY[b.material]);
      normalVelocity = face.predicted + (a.pressure - b.pressure) * inverseDensity;
      double worldX = normalVelocity * face.nx;
      double worldY = normalVelocity * face.ny;
      if (face.nx) {
        a.residual += worldX;
        b.residual += worldX;
      } else {
        a.direction += worldY;
        b.direction += worldY;
      }
      continue;
    }
    if (face.kind == FF_AIR)
      normalVelocity = face.predicted + a.pressure / DENSITY[a.material];
    else if (face.kind == FF_DOMAIN)
      normalVelocity = face.predicted
                     + (a.pressure - face.boundaryPressure) * face.inverseDensity;
    else if (face.kind == FF_BODY) {
      Body* body = bodies[face.body];
      normalVelocity = (body->vx - body->omega * face.ry) * face.nx
                     + (body->vy + body->omega * face.rx) * face.ny;
    }
    if (face.nx) a.residual += normalVelocity * face.nx;
    else a.direction += normalVelocity * face.ny;
  }
  for (FluidNode& node : fluidNodes) {
    node.vx = node.residual * 0.5;
    node.vy = node.direction * 0.5;
  }

  // Diffuse liquid momentum across neighboring cells with a conservative
  // Jacobi pass. Uniform translation is unchanged, so carried liquid and its
  // container remain in the same freely-falling frame.
  for (FluidNode& node : fluidNodes) node.residual = node.direction = 0;
  for (const FluidFace& face : fluidFaces) {
    if (face.kind == FF_DOMAIN) {
      FluidNode& node = fluidNodes[face.a];
      uint8_t outsideMaterial = node.layer->grid[face.b];
      double mobility = (MOBILITY[node.material] + MOBILITY[outsideMaterial]) * 0.5;
      double viscosity = (0.50 + (1.0 - mobility) * 0.35) * dt;
      double inverseMass = 1.0 / DENSITY[node.material] + 1.0 / DENSITY[outsideMaterial];
      node.residual += (face.rx - node.vx) * viscosity
                     / (inverseMass * DENSITY[node.material]);
      node.direction += (face.ry - node.vy) * viscosity
                      / (inverseMass * DENSITY[node.material]);
      continue;
    }
    if (face.kind != FF_INTERNAL) continue;
    FluidNode& a = fluidNodes[face.a];
    FluidNode& b = fluidNodes[face.b];
    double mobility = (MOBILITY[a.material] + MOBILITY[b.material]) * 0.5;
    double viscosity = (0.35 + (1.0 - mobility) * 0.25) * dt;
    double inverseMass = 1.0 / DENSITY[a.material] + 1.0 / DENSITY[b.material];
    double impulseX = (b.vx - a.vx) * viscosity / inverseMass;
    double impulseY = (b.vy - a.vy) * viscosity / inverseMass;
    a.residual += impulseX / DENSITY[a.material];
    a.direction += impulseY / DENSITY[a.material];
    b.residual -= impulseX / DENSITY[b.material];
    b.direction -= impulseY / DENSITY[b.material];
  }
  for (FluidNode& node : fluidNodes) {
    node.vx += node.residual;
    node.vy += node.direction;
  }
  // Exchange tangential momentum only where liquid and body surfaces touch.
  // Matching motion produces no impulse, so retained liquid can free-fall with
  // its container while exterior slip decays through ordinary wet-face drag.
  for (const FluidFace& face : fluidFaces) {
    if (face.kind != FF_BODY) continue;
    FluidNode& node = fluidNodes[face.a];
    Body* body = bodies[face.body];
    double tangentX = -face.ny, tangentY = face.nx;
    double bodyTangent = (body->vx - body->omega * face.ry) * tangentX
                       + (body->vy + body->omega * face.rx) * tangentY;
    double relative = node.vx * tangentX + node.vy * tangentY - bodyTangent;
    double cross = face.rx * tangentY - face.ry * tangentX;
    double inverseMass = 1.0 / DENSITY[node.material]
                       + body->invMass + cross * cross * body->invInertia;
    if (inverseMass <= 0) continue;
    double viscosity = (0.025 + (1.0 - MOBILITY[node.material]) * 0.015) * dt;
    double impulse = relative * viscosity / inverseMass;
    node.vx -= impulse * tangentX / DENSITY[node.material];
    node.vy -= impulse * tangentY / DENSITY[node.material];
    body->vx += impulse * tangentX * body->invMass;
    body->vy += impulse * tangentY * body->invMass;
    body->omega += impulse * cross * body->invInertia;
  }
  for (const FluidFace& face : fluidFaces) {
    FluidNode& node = fluidNodes[face.a];
    if (face.kind == FF_STATIC) {
      double tangentX = -face.ny, tangentY = face.nx;
      double normalVelocity = node.vx * face.nx + node.vy * face.ny;
      double tangentVelocity = node.vx * tangentX + node.vy * tangentY;
      node.vx -= normalVelocity * face.nx * 0.50 * dt;
      node.vy -= normalVelocity * face.ny * 0.50 * dt;
      node.vx -= tangentVelocity * tangentX * 0.08 * dt;
      node.vy -= tangentVelocity * tangentY * 0.08 * dt;
      continue;
    }
  }
  for (FluidNode& node : fluidNodes) {
    uint32_t velocity = E.packedLiquidVelocity(node.vx, node.vy);
    node.layer->liquidVel[node.cell] = velocity;
    node.layer->nextLiquidVel[node.cell] = velocity;
    int layer = node.layer == &E.bg ? 1 : 0;
    fluidPressureCache[layer][node.cell] = (float)node.pressure;
  }
  return true;
}
double RigidBodySystem::granularMediumDensityAt(int x, int y) {
  if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return 0;
  uint8_t material = E.L->grid[y * E.cols + x];
  return E.isLooseSolidMaterial(material) ? DENSITY[material] : 0;
}
// Any loose medium is relocatable: a body submerging into liquid or powder
// displaces it (spilled around the body) rather than being blocked at the surface.
// Only liquids provide upward buoyancy; powders can support, but only by
// cancelling gravity.
bool RigidBodySystem::isBodyRelocatable(uint8_t m, int k, double bodyDensity) { (void)k; (void)bodyDensity; return E.isBuoyantMedium(m); }
// Gases (fire/steam/acrid smoke/…) never support or block a body — it sweeps
// through them and they vanish on commit.
bool RigidBodySystem::canBodyOccupy(uint8_t m, int k, double bodyDensity) { return m == EMPTY || E.isGasMaterial(m) || isBodyRelocatable(m, k, bodyDensity); }
void RigidBodySystem::spillDisplacedBodyMaterial(
    std::vector<Disp>& displaced, const std::vector<int>& edgeFootprint,
    int32_t footprintGen, int bodyId, double bodyDensity,
    const std::vector<int>* vacated) {
  if (displaced.empty()) return;
  (void)bodyDensity;
  // Spread displaced fluid sideways and downward before upward (lateral, down,
  // then up last) — same priority the component-body spill uses. A body plunging
  // into a pool then distributes the rise across the surface instead of firing a
  // narrow fountain straight up out of the entry column ("lava out the top").
  int offs[4] = {-1, 1, E.cols, -E.cols}; int gridLen = E.cols * E.rows;
  // Passability is keyed to the DISPLACED material's own density (curD), not the
  // body's: a dense fluid (lava) shoved aside by a lighter body must be able to
  // percolate through its own pool to reach the free surface — otherwise, deep in
  // the pool it finds no path and is silently dropped (volume loss). It can move
  // through EMPTY/gas, equal-or-lighter liquid, and ungrounded or equal-or-lighter
  // powder. Powder uses the SAME <= rule liquids do (not a strict <) so displaced
  // sand can rise through its own grounded pool to the surface and spread flat,
  // exactly like water — instead of jamming against equal-density sand and heaping
  // into a local cone at the body's entry column.
  double curD = 0;
  auto isPassable = [&](uint8_t m, int k) { return m == EMPTY || E.isGasMaterial(m) || (E.isLiquidMaterial(m) && DENSITY[m] <= curD) || (E.isLooseSolidMaterial(m) && (E.L->groundedCell[k] != 1 || DENSITY[m] <= curD)); };
  int32_t reservedGen = ++E.L->seenGen;
  auto inFootprint = [&](int k) { return E.L->rigidSpillFootprint[k] == footprintGen; };
  auto inOwnFootprint = [&](int k) { return inFootprint(k) && E.L->bodyOwner[k] == bodyId; };
  auto isDropTarget = [&](int k, uint8_t mat) { if (inFootprint(k) || E.L->rigidSpillReserved[k] == reservedGen || E.isBodyCell(k)) return false; uint8_t m = E.L->grid[k]; if (m == EMPTY) return true; return (E.isLiquidMaterial(m) || E.isGasMaterial(m) || E.isLooseSolidMaterial(m)) && DENSITY[m] < DENSITY[mat]; };
  // Footprint-edge seeds (used when a displaced cell's own neighbours are all
  // blocked). Permissive — any fluid/empty/gas/loose powder; canVisit re-filters
  // per displaced material once curD is set in the worklist loop below.
  auto seedPassable = [&](uint8_t m, int k) { (void)k; return m == EMPTY || E.isGasMaterial(m) || E.isBuoyantMedium(m); };
  std::vector<int> footprintEdgeStarts; int32_t edgeGen = ++E.L->seenGen;
  std::vector<int> sortedFootprint(edgeFootprint.begin(), edgeFootprint.end()); std::sort(sortedFootprint.begin(), sortedFootprint.end());
  for (int k : sortedFootprint) for (int off : offs) {
    int nk = k + off; if (nk <= 0 || nk >= gridLen || E.L->seenStamp[nk] == edgeGen) continue;
    int y = nk / E.cols, x = nk - y * E.cols; if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) continue;
    if (seedPassable(E.L->grid[nk], nk)) { E.L->seenStamp[nk] = edgeGen; footprintEdgeStarts.push_back(nk); }
  }
  // Intentionally batch by material: each density/material group gets one
  // multi-source BFS instead of clearing a queue and searching once per displaced
  // cell. Heavier groups run first so they claim spill targets before lighter
  // material; evicted lighter material is processed in later waves.
  std::vector<Disp> pending = displaced, nextPending;
  std::vector<int> queue, targets;
  for (int wave = 0; !pending.empty() && wave < TABLE + 4; wave++) {
    std::sort(pending.begin(), pending.end(), [](const Disp& a, const Disp& b) {
      if (DENSITY[a.material] != DENSITY[b.material]) return DENSITY[a.material] > DENSITY[b.material];
      if (a.material != b.material) return a.material < b.material;
      return a.from < b.from;
    });
    nextPending.clear();
    for (size_t gi = 0; gi < pending.size();) {
      uint8_t mat = pending[gi].material;
      size_t gj = gi + 1;
      while (gj < pending.size() && pending[gj].material == mat) gj++;
      curD = DENSITY[mat];
      int need = (int)(gj - gi);
      queue.clear(); targets.clear();
      // Exchange leading-edge displacement with the same body's trailing
      // vacancies before searching the wider pool. This keeps liquid wrapped
      // around a translating body instead of ejecting it to a distant free
      // surface and leaving an artificial dry wake.
      if (vacated) {
        std::vector<int> preferred(*vacated);
        std::sort(preferred.begin(), preferred.end());
        for (int k : preferred) {
          if ((int)targets.size() >= need) break;
          if (!isDropTarget(k, mat)) continue;
          // Do not pump loose material into a dry trailing cell above its free
          // surface. Local exchange targets must remain connected to compatible
          // medium; otherwise the exterior search finds the real outlet.
          bool connected = E.L->grid[k] != EMPTY;
          int y = k / E.cols, x = k - y * E.cols;
          if (!connected) {
            const int offsets[4] = {-1, 1, -E.cols, E.cols};
            for (int offset : offsets) {
              if ((offset == -1 && x == 0) || (offset == 1 && x + 1 >= E.cols)
                  || (offset == -E.cols && y == 0)
                  || (offset == E.cols && y + 1 >= E.rows))
                continue;
              uint8_t neighbor = E.L->grid[k + offset];
              if (E.isBuoyantMedium(neighbor)
                  && DENSITY[neighbor] <= DENSITY[mat]) {
                connected = true;
                break;
              }
            }
          }
          if (!connected) continue;
          E.L->rigidSpillReserved[k] = reservedGen;
          targets.push_back(k);
        }
      }
      int32_t seenGen = ++E.L->seenGen;
      auto canVisit = [&](int k) {
        if (k <= 0 || k >= gridLen || E.L->rigidSpillReserved[k] == reservedGen || E.L->seenStamp[k] == seenGen) return false;
        int y = k / E.cols, x = k - y * E.cols;
        if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows) return false;
        // A displaced cell can be enclosed by the body's newly rasterized
        // footprint (most often after rotation). Traverse this body's cells for
        // distance only so every source reaches its nearest exterior outlet;
        // other bodies remain barriers and isDropTarget still rejects all body
        // cells. Seeding only exterior neighbours let one exposed tip route the
        // entire batch through itself.
        if (inFootprint(k)) return inOwnFootprint(k);
        return isPassable(E.L->grid[k], k);
      };
      auto enqueue = [&](int k) { if (!canVisit(k)) return; E.L->seenStamp[k] = seenGen; queue.push_back(k); };
      for (size_t di = gi; di < gj; di++) {
        int from = pending[di].from;
        if (inOwnFootprint(from)) enqueue(from);
        else for (int off : offs) enqueue(from + off); // density-chain eviction outside the body
      }
      if (queue.empty()) for (int nk : footprintEdgeStarts) enqueue(nk);
      int visitBudget = imin(gridLen, imax(4096, need * 128));
      int visits = 0;
      for (size_t qi = 0; qi < queue.size() && (int)targets.size() < need && visits < visitBudget; qi++, visits++) {
        int k = queue[qi];
        if (isDropTarget(k, mat)) { E.L->rigidSpillReserved[k] = reservedGen; targets.push_back(k); }
        for (int off : offs) enqueue(k + off);
      }
      int n = imin((int)targets.size(), need);
      for (int i = 0; i < n; i++) {
        int target = targets[i];
        uint8_t evicted = E.L->grid[target];
        if (evicted != EMPTY) nextPending.push_back({evicted, target});
        E.writeGridIndex(target, mat);
      }
      gi = gj;
    }
    pending.swap(nextPending);
  }
}
double RigidBodySystem::rigidErodeProbabilityAt(int k) {
  double p = 0; int x = k % E.cols, y = k / E.cols;
  uint8_t target = E.L->grid[k];
  auto consider = [&](int nk) {
    uint8_t medium = E.L->grid[nk];
    if (medium == ACID && (target == RIGID || E.isDissolvable(target)))
      p = std::fmax(p, ACID_DISSOLVE_P);
    else if (medium == LAVA && (target == RIGID || E.isFlammable(target)))
      p = std::fmax(p, RIGID_LAVA_ERODE_P);
    else if (medium == FIRE && (target == RIGID || E.isFlammable(target)))
      p = std::fmax(p, RIGID_FIRE_ERODE_P);
  };
  if (x < E.cols - 1) consider(k + 1); if (x > 0) consider(k - 1); if (y < E.rows - 1) consider(k + E.cols); if (y > 0) consider(k - E.cols);
  return p;
}
bool RigidBodySystem::eraseBodyCellIndex(int k, std::unordered_map<int, Body*>& bodyById, std::unordered_set<Body*>& dirty) {
  int id = E.L->bodyOwner[k]; if (id < 0) return false; // E.L->bodyOwner is authoritative (cell holds the body's real material, not RIGID)
  auto it = bodyById.find(id); if (it == bodyById.end()) return false; Body* b = it->second;
  int y = k / E.cols, x = k - y * E.cols;
  int idx = localCellAt(b, x + 0.5, y + 0.5);
  if (idx < 0) return false;
  if (b->jointRole && b->jointPeer) {
    Body* leader = b->jointRole == 1 ? b : b->jointPeer;
    Body* follower = leader->jointPeer;
    if (bodyMaterialAt(b, idx) == EMPTY) return false;
    b->cellMaterials[idx] = EMPTY;
    b->jointPeer->jointPeerMaterials[idx] = EMPTY;
    if (b->jointPeer->cellMaterials[idx] == EMPTY) {
      leader->occ[idx] = 0;
      follower->occ[idx] = 0;
    }
    leader->rasterFootprintValid = false;
    follower->rasterFootprintValid = false;
    E.writeGridIndex(k, EMPTY);
    E.L->bodyOwner[k] = -1;
    dirty.insert(leader);
    if (b->jointRole == 2) {
      E.L->passiveBodyCells.erase(
        std::remove(E.L->passiveBodyCells.begin(), E.L->passiveBodyCells.end(), k),
        E.L->passiveBodyCells.end());
    }
    return true;
  }
  if (!eraseLocalCell(b, idx)) return false;
  E.writeGridIndex(k, EMPTY); E.L->bodyOwner[k] = -1; dirty.insert(b); return true;
}
void RigidBodySystem::finishErasedBodies(std::unordered_set<Body*>& dirty,
                                         std::vector<int>& cells,
                                         bool splitJointBodies) {
  if (dirty.empty()) { E.L->bodyCells = cells; return; }
  // Split each erased body by the connectivity of its actual WORLD grid cells
  // (the clean source of truth), not its occ grid: the occ<->world map is lossy
  // for rotated E.L->bodies, so an occ-space flood over-fragments a clean cut into
  // dozens of slivers and loses a half. A body merely chipped (one world
  // component) keeps its rotation via computeDerived; a body actually cut into
  // multiple pieces is rebuilt as axis-aligned E.L->bodies, inheriting velocity.
  std::unordered_set<int> removedIds;
  std::unordered_set<Body*> dirtyJoints;
  std::vector<Body*> orderedDirty;
  orderedDirty.reserve(dirty.size());
  for (Body* body : dirty) {
    if (body->jointRole) {
      dirtyJoints.insert(body->jointRole == 1 ? body : body->jointPeer);
    } else {
      orderedDirty.push_back(body);
    }
  }
  std::sort(orderedDirty.begin(), orderedDirty.end(), [](Body* a, Body* b) { return a->id < b->id; });
  std::unordered_map<int, int> originalIndexById;
  originalIndexById.reserve(E.L->bodies.size() * 2);
  std::vector<std::vector<int>> originalWorldCells(E.L->bodies.size());
  for (int i = 0; i < (int)E.L->bodies.size(); i++)
    originalIndexById[E.L->bodies[i]->id] = i;
  for (int k : cells) {
    auto found = originalIndexById.find(E.L->bodyOwner[k]);
    if (found != originalIndexById.end())
      originalWorldCells[found->second].push_back(k);
  }
  for (Body* b : orderedDirty) {
    auto containsTnt = [&](Body* body) {
      if (body->cellMaterials.empty()) return body->material == TNT && body->nPts > 0;
      for (uint8_t material : body->cellMaterials)
        if (material == TNT) return true;
      return false;
    };
    const std::vector<int>& wc = originalWorldCells[
      originalIndexById.find(b->id)->second];
    if (wc.empty()) { removedIds.insert(b->id); continue; }
    // Flood with the same 8-connectivity used by static structures and
    // component-to-body detachment. A rotated raster commonly turns a face
    // contact into a diagonal contact; treating that as a fracture makes a
    // chipped mixed-material object split even though its structural bond is
    // still intact.
    splitMemberStamp.reset((size_t)E.cols * E.rows);
    splitVisitedStamp.reset((size_t)E.cols * E.rows);
    for (int k : wc) splitMemberStamp.add(k);
    std::vector<std::vector<int>> groups;
    for (int seed : wc) {
      if (splitVisitedStamp.has(seed)) continue;
      int gid = (int)groups.size();
      groups.push_back({});
      std::vector<int> st{seed};
      splitVisitedStamp.add(seed);
      while (!st.empty()) { int k = st.back(); st.pop_back(); groups[gid].push_back(k); int y = k / E.cols, x = k - y * E.cols;
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          int nx = x + ox, ny = y + oy;
          if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
          int neighbor = ny * E.cols + nx;
          if (!splitMemberStamp.has(neighbor)
              || splitVisitedStamp.has(neighbor)) continue;
          splitVisitedStamp.add(neighbor);
          st.push_back(neighbor);
        }
      }
    }
    if (groups.size() <= 1) {
      // Several rotated raster cells can map to one local cell, so world cells
      // may remain after the authoritative local shape becomes empty.
      if (!computeDerived(b, true)) {
        removedIds.insert(b->id);
        continue;
      }
      if (!containsTnt(b)) b->fuseTicks = 0;
      continue;
    } // chip: keep the body (+ rotation)
    // genuine split: rebuild each piece as an axis-aligned body with inherited motion
    double ovx = b->vx, ovy = b->vy, ow = b->omega, opx = b->px, opy = b->py;
    int inheritedFuse = b->fuseTicks;
    for (auto& grp : groups) {
      std::vector<std::pair<int, int>> gc; gc.reserve(grp.size());
      std::vector<uint8_t> gm; gm.reserve(grp.size());
      for (int k : grp) {
        gc.push_back({k % E.cols, k / E.cols});
        gm.push_back(E.L->grid[k]);
      }
      Body* p = b->cellMaterials.empty()
        ? spawnBodyImpl(gc, b->material, b->density)
        : spawnBodyImpl(gc, gm);
      if (!p) continue;
      double rx = p->px - opx, ry = p->py - opy;
      p->vx = ovx - ow * ry; p->vy = ovy + ow * rx; p->omega = ow;
      p->blastDebris = b->blastDebris;
      p->fuseTicks = containsTnt(p) ? inheritedFuse : 0;
    }
    removedIds.insert(b->id);
  }
  if (!removedIds.empty()) {
    std::vector<Body*> keep;
    for (Body* b : E.L->bodies) { if (removedIds.count(b->id)) delete b; else keep.push_back(b); }
    E.L->bodies = std::move(keep);
  }
  // Re-assign ownership from scratch over the FORMER body cells. Body cells carry
  // the body's real material now (not RIGID), so the old `E.L->grid[k] == RIGID` no longer
  // identifies them — `wasBody` (the prior body-cell set) is the authoritative source,
  // and disambiguates a body cell from identical-looking static terrain of the same
  // material that the rebuilt footprint may overlap.
  splitWasBodyStamp.reset((size_t)E.cols * E.rows);
  splitClaimedStamp.reset((size_t)E.cols * E.rows);
  for (int k : cells) splitWasBodyStamp.add(k);
  for (int k : cells) E.L->bodyOwner[k] = -1;
  std::vector<int> kept;
  // Skip EMPTY cells: an erased cell (grid already cleared) can still fall
  // under a rotated body's re-rasterization, and claiming it would leave a
  // body-owned EMPTY cell until the next moveBodies stamp — a powder settling
  // into it that step would then be wiped by the un-stamp (silent cell loss).
  // Found by the SAND_INVARIANT_CHECKS post-step validator.
  auto claim = [&](Body* body, int k) {
    if (!splitWasBodyStamp.has(k) || splitClaimedStamp.has(k)
        || E.L->grid[k] == EMPTY) return;
    E.L->bodyOwner[k] = body->id;
    splitClaimedStamp.add(k);
    kept.push_back(k);
  };
  for (Body* b : E.L->bodies)
    forEachBodyCell(b, [&](int x, int y, int) {
      claim(b, y * E.cols + x);
    });
  for (int k : cells) if (!splitClaimedStamp.has(k)) { E.writeGridIndex(k, EMPTY); E.L->bodyOwner[k] = -1; }
  E.L->bodyCells = kept;
  if (splitJointBodies) finishErasedJointBodies(dirtyJoints);
}
void RigidBodySystem::finishErasedJointBodies(
    const std::unordered_set<Body*>& dirty) {
  if (dirty.empty()) return;
  std::unordered_set<int> dirtyIds;
  for (Body* body : dirty) {
    if (!body) continue;
    Body* leader = body->jointRole == 2 ? body->jointPeer : body;
    if (leader && leader->jointRole == 1 && leader->jointPeer)
      dirtyIds.insert(leader->id);
  }
  if (dirtyIds.empty()) return;

  std::vector<Body*> leaders;
  for (Body* body : E.fg.bodies)
    if (body->jointRole == 1 && dirtyIds.count(body->id))
      leaders.push_back(body);

  Layer* previous = E.L;
  for (Body* leader : leaders) {
    Body* follower = leader->jointPeer;
    if (!follower) continue;
    int oldId = leader->id;
    std::vector<int> worldCells;
    for (int k : E.fg.bodyCells)
      if (k >= 0 && k < E.cols * E.rows && E.fg.bodyOwner[k] == oldId)
        worldCells.push_back(k);
    for (int k : E.bg.passiveBodyCells)
      if (k >= 0 && k < E.cols * E.rows && E.bg.bodyOwner[k] == oldId)
        worldCells.push_back(k);
    std::sort(worldCells.begin(), worldCells.end());
    worldCells.erase(std::unique(worldCells.begin(), worldCells.end()),
                     worldCells.end());

    std::vector<uint8_t> layerMask(worldCells.size(), 0);
    std::unordered_map<int, int> indexOf;
    indexOf.reserve(worldCells.size());
    for (size_t i = 0; i < worldCells.size(); i++) {
      int k = worldCells[i];
      indexOf[k] = (int)i;
      if (E.fg.bodyOwner[k] == oldId) layerMask[i] |= 1;
      if (E.bg.bodyOwner[k] == oldId) layerMask[i] |= 2;
    }

    std::vector<int> component(worldCells.size(), -1);
    std::vector<std::vector<int>> groups;
    for (size_t seed = 0; seed < worldCells.size(); seed++) {
      if (component[seed] >= 0) continue;
      int group = (int)groups.size();
      groups.push_back({});
      std::vector<int> stack{(int)seed};
      component[seed] = group;
      while (!stack.empty()) {
        int ci = stack.back();
        stack.pop_back();
        int k = worldCells[ci], y = k / E.cols, x = k - y * E.cols;
        groups[group].push_back(ci);
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          int nx = x + ox, ny = y + oy;
          if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
          auto it = indexOf.find(ny * E.cols + nx);
          if (it == indexOf.end()) continue;
          int ni = it->second;
          // The two rendered layers are adjacent depth slices of one bonded
          // assembly. Surviving cells that touch in the projected raster keep
          // that bond even when a blast removed the last exactly co-occupied
          // pixel; only a real gap in the union fractures the shared body.
          if (component[ni] >= 0) continue;
          component[ni] = group;
          stack.push_back(ni);
        }
      }
    }
    uint8_t remainingLayers = 0;
    for (uint8_t mask : layerMask) remainingLayers |= mask;
    if (groups.size() <= 1 && !worldCells.empty() && remainingLayers == 3) {
      computeDerived(leader, true);
      computeDerived(follower, true);
      syncJointFollower(leader);
      bool hasTnt = false;
      for (size_t i = 0; i < worldCells.size() && !hasTnt; i++) {
        int k = worldCells[i];
        hasTnt = ((layerMask[i] & 1) && E.fg.grid[k] == TNT)
              || ((layerMask[i] & 2) && E.bg.grid[k] == TNT);
      }
      if (!hasTnt) leader->fuseTicks = follower->fuseTicks = 0;
      continue;
    }

    struct JointPiece {
      std::vector<std::pair<int, int>> fgCells, bgCells;
      std::vector<uint8_t> fgMaterials, bgMaterials;
    };
    std::vector<JointPiece> pieces(groups.size());
    for (size_t group = 0; group < groups.size(); group++) {
      JointPiece& piece = pieces[group];
      for (int ci : groups[group]) {
        int k = worldCells[ci], y = k / E.cols, x = k - y * E.cols;
        if (layerMask[ci] & 1) {
          piece.fgCells.push_back({x, y});
          piece.fgMaterials.push_back(E.fg.grid[k]);
        }
        if (layerMask[ci] & 2) {
          piece.bgCells.push_back({x, y});
          piece.bgMaterials.push_back(E.bg.grid[k]);
        }
      }
    }

    double oldPx = leader->px, oldPy = leader->py;
    double oldVx = leader->vx, oldVy = leader->vy, oldOmega = leader->omega;
    bool blastDebris = leader->blastDebris;
    int fuseTicks = leader->fuseTicks;
    auto removeOwnedCells = [&](Layer& layer, std::vector<int>& cells) {
      std::vector<int> keep;
      keep.reserve(cells.size());
      for (int k : cells) {
        if (k >= 0 && k < E.cols * E.rows && layer.bodyOwner[k] == oldId)
          layer.bodyOwner[k] = -1;
        else
          keep.push_back(k);
      }
      cells = std::move(keep);
    };
    removeOwnedCells(E.fg, E.fg.bodyCells);
    removeOwnedCells(E.bg, E.bg.passiveBodyCells);
    removeOwnedCells(E.bg, E.bg.bodyCells);
    E.bg.passiveBodyIds.erase(oldId);
    E.fg.bodies.erase(std::remove(E.fg.bodies.begin(), E.fg.bodies.end(), leader),
                      E.fg.bodies.end());
    E.bg.bodies.erase(std::remove(E.bg.bodies.begin(), E.bg.bodies.end(), follower),
                      E.bg.bodies.end());
    delete leader;
    delete follower;

    auto inheritMotion = [&](Body* body) {
      double rx = body->px - oldPx, ry = body->py - oldPy;
      body->vx = oldVx - oldOmega * ry;
      body->vy = oldVy + oldOmega * rx;
      body->omega = oldOmega;
      body->blastDebris = blastDebris;
    };
    for (JointPiece& piece : pieces) {
      bool hasTnt = std::find(piece.fgMaterials.begin(), piece.fgMaterials.end(), TNT)
                      != piece.fgMaterials.end()
                 || std::find(piece.bgMaterials.begin(), piece.bgMaterials.end(), TNT)
                      != piece.bgMaterials.end();
      if (!piece.fgCells.empty() && !piece.bgCells.empty()) {
        Body* body = spawnJointBodyImpl(piece.fgCells, piece.fgMaterials,
                                        piece.bgCells, piece.bgMaterials);
        if (!body || !body->jointPeer) continue;
        inheritMotion(body);
        body->fuseTicks = hasTnt ? fuseTicks : 0;
        body->jointPeer->blastDebris = blastDebris;
        body->jointPeer->fuseTicks = body->fuseTicks;
        syncJointFollower(body);
        for (const auto& cell : piece.fgCells) {
          int k = cell.second * E.cols + cell.first;
          E.fg.bodyOwner[k] = body->id;
          E.fg.bodyCells.push_back(k);
        }
        for (const auto& cell : piece.bgCells) {
          int k = cell.second * E.cols + cell.first;
          E.bg.bodyOwner[k] = body->jointPeer->id;
          E.bg.passiveBodyCells.push_back(k);
        }
      } else if (!piece.fgCells.empty()) {
        E.useLayer(&E.fg);
        Body* body = spawnBodyImpl(piece.fgCells, piece.fgMaterials);
        if (!body) continue;
        inheritMotion(body);
        body->fuseTicks = hasTnt ? fuseTicks : 0;
        for (const auto& cell : piece.fgCells) {
          int k = cell.second * E.cols + cell.first;
          E.fg.bodyOwner[k] = body->id;
          E.fg.bodyCells.push_back(k);
        }
      } else if (!piece.bgCells.empty()) {
        E.useLayer(&E.bg);
        Body* body = spawnBodyImpl(piece.bgCells, piece.bgMaterials);
        if (!body) continue;
        inheritMotion(body);
        body->fuseTicks = hasTnt ? fuseTicks : 0;
        for (const auto& cell : piece.bgCells) {
          int k = cell.second * E.cols + cell.first;
          E.bg.bodyOwner[k] = body->id;
          E.bg.bodyCells.push_back(k);
        }
      }
    }
    E.fg.sleepingBodySupportDirty = true;
    E.bg.sleepingBodySupportDirty = true;
  }
  E.useLayer(previous);
}
void RigidBodySystem::erodeBodies(std::vector<int>& cells) {
  if (cells.empty()) { E.L->bodyCells = cells; return; }
  std::unordered_map<int, Body*> bodyById; for (Body* b : E.L->bodies) bodyById[b->id] = b;
  std::unordered_set<Body*> dirty;
  std::vector<int> acidSmoke;
  for (int k : cells) {
    double p = rigidErodeProbabilityAt(k); if (p <= 0 || E.rand() >= p) continue;
    int x = k % E.cols, y = k / E.cols;
    bool byAcid = (x < E.cols - 1 && E.L->grid[k + 1] == ACID)
               || (x > 0 && E.L->grid[k - 1] == ACID)
               || (y < E.rows - 1 && E.L->grid[k + E.cols] == ACID)
               || (y > 0 && E.L->grid[k - E.cols] == ACID);
    if (eraseBodyCellIndex(k, bodyById, dirty) && byAcid) {
      E.audio.noteAcidDissolve(x, y);
      if (E.rand() < ACRID_SMOKE_P) acidSmoke.push_back(k);
    }
  }
  finishErasedBodies(dirty, cells);
  for (int k : acidSmoke) {
    if (E.L->grid[k] != EMPTY || E.L->bodyOwner[k] >= 0) continue;
    E.writeGridIndex(k, ACRID_SMOKE);
    E.markCellIndex(k);
  }
}
int RigidBodySystem::bodyFootprintBlocked(Body* b) {
  int blocked = 0;
  auto blockedIn = [&](Layer& lay, int k) {
    if (lay.bodyOwner[k] == b->id) return false;
    uint8_t material = lay.grid[k];
    return material != EMPTY && !E.isGasMaterial(material)
      && !E.isBuoyantMedium(material);
  };
  auto probe = [&](int x, int y, int) {
    int k = y * E.cols + x;
    if (occStamp.has(k)) return;
    occStamp.add(k);
    if (blockedIn(*E.L, k)
        || (b->jointRole == 1 && blockedIn(E.bg, k))) blocked++;
  };
  occStamp.reset((size_t)E.cols * E.rows);
  forEachBodyCell(b, probe);
  if (b->jointRole == 1 && b->jointPeer) forEachBodyCell(b->jointPeer, probe);
  return blocked;
}
// A sleeping body keeps its support if nudging it straight down by `probe`
// cells makes its footprint overlap solid terrain or another body. If nothing
// is there, its ground crumbled away (erased/dissolved/sand drained) and it
// must wake and fall. Must be called while the E.L->bodies' cells are still in the
// grid (so other E.L->bodies count as support); the body's own cells are ignored.
bool RigidBodySystem::sleepingBodyHasSupport(Body* b, double probe) {
  if (bodyHasLooseSupport(b)) return true;
  double savedPy = b->py;
  b->py = savedPy + probe;
  bool supported = false;
  forEachBodyCell(b, [&](int x, int y, int) {
    if (supported) return;
    int k = y * E.cols + x; uint8_t m = E.L->grid[k];
    if (E.isBodyCell(k)) { if (E.L->bodyOwner[k] != b->id) supported = true; return; } // another body underneath counts as support; our own cells are ignored
    if (!canBodyOccupy(m, k, b->density)) supported = true; // solid terrain / another body
  });
  b->py = savedPy;
  return supported;
}
int RigidBodySystem::bodyDepenTolerance(Body* b) { return imax(1, (int)std::floor(imin(b->w, b->h) * 0.34)); }
bool RigidBodySystem::depenetrateBodyRaster(Body* b, double prePx, double prePy, bool hasPre) {
  int tol = bodyDepenTolerance(b);
  if (bodyFootprintBlocked(b) <= tol) return false;
  double newPx = b->px, newPy = b->py, newAngle = b->angle;
  if (hasPre) {
    b->px = prePx; b->py = prePy; b->angle = newAngle;
    if (bodyFootprintBlocked(b) <= tol) {
      double lo = 0, hi = 1;
      for (int iter = 0; iter < 6; iter++) { double mid = (lo + hi) * 0.5; b->px = prePx + (newPx - prePx) * mid; b->py = prePy + (newPy - prePy) * mid; b->angle = newAngle; if (bodyFootprintBlocked(b) <= tol) lo = mid; else hi = mid; }
      b->px = prePx + (newPx - prePx) * lo; b->py = prePy + (newPy - prePy) * lo; b->angle = newAngle;
      double mvx = newPx - prePx, mvy = newPy - prePy, len = std::hypot(mvx, mvy);
      if (len > 1e-6) { double nx = mvx / len, ny = mvy / len, vn = b->vx * nx + b->vy * ny; if (vn > 0) { b->vx -= vn * nx; b->vy -= vn * ny; } }
      b->awake = true; b->stillTicks = 0; return true;
    }
  }
  b->px = newPx; b->py = newPy; b->angle = newAngle;
  double maxLift = 3.0, st = 0.125;
  for (double lift = st; lift <= maxLift + 1e-9; lift += st) { b->py = newPy - lift; if (bodyFootprintBlocked(b) <= tol) { if (b->vy > 0) b->vy = 0; b->awake = true; b->stillTicks = 0; return true; } }
  b->px = newPx; b->py = newPy; b->angle = newAngle; return false;
}

// Free bodies are grid entities while players/creatures are AABBs, so the rigid
// solver cannot see them as ordinary contacts. Resolve body->actor overlap here,
// while body cells are temporarily absent from the grid: push in the body's
// swept direction. If terrain or another body blocks that displacement, keep
// the actor in place and let its owning system apply the crush lifecycle.
bool RigidBodySystem::pushActorsFromBody(Body* b, double prePx, double prePy,
                                         double preAngle) {
  const double finalPx = b->px, finalPy = b->py, finalAngle = b->angle;
  const double dx = finalPx - prePx, dy = finalPy - prePy, da = finalAngle - preAngle;
  // Every occupied pixel square stays inside this center-line capsule for the
  // complete translation/rotation sweep. If no live actor AABB touches it,
  // rasterizing intermediate poses cannot find an overlap.
  const double sweepRadius = b->maxR + 0.7071067811865476;
  const double sweepMinX = std::fmin(prePx, finalPx) - sweepRadius;
  const double sweepMinY = std::fmin(prePy, finalPy) - sweepRadius;
  const double sweepMaxX = std::fmax(prePx, finalPx) + sweepRadius;
  const double sweepMaxY = std::fmax(prePy, finalPy) + sweepRadius;
  auto sweepOverlaps = [&](double x, double y, double w, double h) {
    return x <= sweepMaxX && x + w >= sweepMinX
        && y <= sweepMaxY && y + h >= sweepMinY;
  };
  bool actorCandidate = false;
  for (const Player& player : E.psys.players) {
    if (player.active && player.alive
        && sweepOverlaps(player.px, player.py, player.w, player.h)) {
      actorCandidate = true;
      break;
    }
  }
  if (!actorCandidate) {
    for (const Creature& creature : E.creatures.creatures) {
      if (!creature.alive) continue;
      const CreatureSpecies& species = E.creatures.species(creature);
      double x = creature.wx - E.fg.worldOffsetX;
      double y = creature.wy - E.fg.worldOffsetY;
      if (sweepOverlaps(x, y, species.w, species.h)) {
        actorCandidate = true;
        break;
      }
    }
  }
  if (!actorCandidate) return false;
  const double sweepDistance = std::max(std::hypot(dx, dy), std::fabs(da) * std::hypot(b->w, b->h) * 0.5);
  const int sweepSteps = imin(256, imax(1, (int)std::ceil(sweepDistance / 0.5)));
  const double maxCarrySpeed = 0.65;

  int minX = 0, minY = 0, maxX = -1, maxY = -1;
  std::vector<std::pair<int, int>> raster;
  auto rasterBody = [&]() {
    minX = E.cols; minY = E.rows; maxX = maxY = -1; raster.clear();
    forEachBodyCell(b, [&](int x, int y, int) {
      raster.push_back({x, y});
      minX = imin(minX, x); minY = imin(minY, y); maxX = imax(maxX, x); maxY = imax(maxY, y);
    });
  };
  auto broadOverlaps = [&](double ax, double ay, int aw, int ah) {
    return ax < maxX + 1 && ax + aw > minX && ay < maxY + 1 && ay + ah > minY;
  };
  auto overlaps = [&](double ax, double ay, int aw, int ah) {
    double ax1 = ax + aw, ay1 = ay + ah;
    for (const auto& cell : raster)
      if (ax < cell.first + 1 && ax1 > cell.first && ay < cell.second + 1 && ay1 > cell.second) return true;
    return false;
  };
  auto pushOverlapping = [&](double& ax, double& ay, int aw, int ah,
                             double& avx, double& avy, bool player) {
    int contactMinX = E.cols, contactMinY = E.rows, contactMaxX = -1, contactMaxY = -1;
    for (const auto& cell : raster) {
      if (ay < cell.second + 1 && ay + ah > cell.second) {
        contactMinX = imin(contactMinX, cell.first); contactMaxX = imax(contactMaxX, cell.first);
      }
      if (ax < cell.first + 1 && ax + aw > cell.first) {
        contactMinY = imin(contactMinY, cell.second); contactMaxY = imax(contactMaxY, cell.second);
      }
    }
    if (contactMaxX < 0 || contactMaxY < 0) return false;
    double rx = ax + aw * 0.5 - b->px, ry = ay + ah * 0.5 - b->py;
    double driveX = dx - da * ry, driveY = dy + da * rx;
    int preferred = std::hypot(driveX, driveY) < 1e-6 ? -1 :
      (std::fabs(driveX) >= std::fabs(driveY)
        ? (driveX >= 0 ? 1 : 0)
        : (driveY >= 0 ? 3 : 2)); // L,R,U,D = 0..3
    struct Candidate { double x, y; int side; } c[4] = {
      {(double)contactMinX - aw - 1e-4, ay, 0},
      {(double)contactMaxX + 1 + 1e-4, ay, 1},
      {ax, (double)contactMinY - ah - 1e-4, 2},
      {ax, (double)contactMaxY + 1 + 1e-4, 3},
    };
    if (preferred < 0) return false; // resting solver jitter must not invent a new escape direction
    Candidate& q = c[preferred];
    bool blocked = player
      ? (E.psys.playerBoxHits(q.x, q.y, aw, ah)
          || E.psys.playerBoxHitsOtherBody(q.x, q.y, aw, ah, b))
      : (E.creatures.boxHitsSolid(E.fg.worldOffsetX + q.x,
                                  E.fg.worldOffsetY + q.y, aw, ah)
          || E.creatures.boxHitsOtherBody(E.fg.worldOffsetX + q.x,
                                          E.fg.worldOffsetY + q.y, aw, ah, b));
    if (overlaps(q.x, q.y, aw, ah)) return false;
    int crushCells = b->nPts;
    if (b->jointRole == 1 && b->jointPeer) crushCells += b->jointPeer->nPts;
    if (blocked) return crushCells >= imax(16, (aw * ah + 1) / 2);
    ax = q.x; ay = q.y;
    if (q.side == 0) avx = std::min(avx, -std::min(std::fabs(driveX), maxCarrySpeed));
    else if (q.side == 1) avx = std::max(avx, std::min(std::fabs(driveX), maxCarrySpeed));
    else if (q.side == 2) avy = std::min(avy, -std::min(std::fabs(driveY), maxCarrySpeed));
    else avy = std::max(avy, std::min(std::fabs(driveY), maxCarrySpeed));
    return false;
  };
  // Walk the body's swept path at sub-cell spacing. Resolving only its final
  // raster lets a fast or thin body cross an actor completely between ticks.
  for (int step = 1; step <= sweepSteps; step++) {
    const double t = (double)step / sweepSteps;
    b->px = prePx + dx * t; b->py = prePy + dy * t; b->angle = preAngle + da * t;
    rasterBody();
    if (raster.empty()) continue;
    for (size_t i = 0; i < E.psys.players.size(); i++) {
      Player& p = E.psys.players[i];
      if (!p.active || !p.alive) continue;
      if (!broadOverlaps(p.px, p.py, p.w, p.h) || !overlaps(p.px, p.py, p.w, p.h)) continue;
      if (pushOverlapping(p.px, p.py, p.w, p.h, p.vx, p.vy, true))
        E.psys.crushPlayer(p);
    }
    for (size_t i = 0; i < E.creatures.creatures.size(); i++) {
      Creature& c = E.creatures.creatures[i];
      if (!c.alive) continue;
      const CreatureSpecies& s = E.creatures.species(c);
      double x = c.wx - E.fg.worldOffsetX, y = c.wy - E.fg.worldOffsetY;
      if (!broadOverlaps(x, y, s.w, s.h) || !overlaps(x, y, s.w, s.h)) continue;
      if (pushOverlapping(x, y, s.w, s.h, c.vx, c.vy, false))
        E.creatures.crushCreature(c);
      c.wx = E.fg.worldOffsetX + x; c.wy = E.fg.worldOffsetY + y;
    }
  }
  b->px = finalPx; b->py = finalPy; b->angle = finalAngle;
  return true;
}
// ===== Body material identity & solidify-on-rest =====
// (See the BODY-MATERIAL INVARIANT block in members.inc.) A free body stamps its
// real material into the grid; when a NON-RIGID body sleeps it bakes into a
// normal static component here. RIGID bodies stay free forever.
void RigidBodySystem::bakeBodyToGrid(Body* b, int assemblyId) {
  // The body's cells were just cleared to EMPTY (moveBodies). Restore each
  // rasterized material. Each material stays an isolated component carrying the
  // same baked-assembly id, so support and cuts use the component graph without
  // merging the old body into adjacent same-material terrain.
  bool looseSupport = bodyHasLooseSupport(b)
                   || bodyTouchesSettledLooseComponent(b);
  std::array<std::unordered_set<int>, TABLE> baked;
  forEachBodyCell(b, [&](int x, int y, int local) {
    int k = y * E.cols + x;
    if (E.L->grid[k] != EMPTY && !E.componentDisplaceable(E.L->grid[k])) return; // never clobber solid terrain it came to rest against
    uint8_t material = bodyMaterialAt(b, local);
    if (material == EMPTY || material >= TABLE) return;
    E.writeGridIndex(k, material);
    baked[material].insert(k);
  });
  for (int material = 0; material < TABLE; material++) {
    if (baked[material].empty()) continue;
    E.comps.registerBakedCells((uint8_t)material, baked[material], assemblyId,
                               E.isIceMaterial(material), looseSupport);
  }
  if (b->fuseTicks > 0)
    for (int k : baked[TNT]) E.queueDetonation(k, b->fuseTicks);
}
// Every component material has a static representation. Generic RIGID has none
// and therefore remains a body.
bool RigidBodySystem::bodySolidifies(Body* b) {
  if (b->cellMaterials.empty()) return E.isComponentMaterial(b->material);
  bool hasMaterial = false;
  for (int i = 0; i < (int)b->occ.size(); i++) {
    if (!b->occ[i]) continue;
    uint8_t own = bodyMaterialAt(b, i);
    if (own != EMPTY) {
      hasMaterial = true;
      if (!E.isComponentMaterial(own)) return false;
    }
    if (b->jointRole) {
      uint8_t peer = b->jointPeerMaterials[i];
      if (peer != EMPTY) {
        hasMaterial = true;
        if (!E.isComponentMaterial(peer)) return false;
      }
    }
  }
  return hasMaterial;
}
// Baking is a structural transition, so solver sleep alone is insufficient:
// buoyancy can put a floating body to sleep with no terrain contact. Require a
// grounded static support below the raster (or the world floor). Side contact
// does not bear the body's weight; liquids and other free bodies remain entirely
// in the rigid solver.
bool RigidBodySystem::bodyTouchesGroundedSolid(Body* b) {
  occStamp.reset((size_t)(E.cols * E.rows)); occCells.clear();
  forEachBodyCell(b, [&](int x, int y, int) {
    int k = y * E.cols + x;
    if (!occStamp.has(k)) { occStamp.add(k); occCells.push_back(k); }
  });
  for (int k : occCells) {
    int y = k / E.cols;
    if (y + 1 >= E.rows) return true;
    int neighbor = k + E.cols;
    if (occStamp.has(neighbor) || E.L->bodyOwner[neighbor] >= 0) continue;
    uint8_t material = E.L->grid[neighbor];
    if ((E.isRigidMaterialClass(material) || E.isLooseSolidMaterial(material))
        && E.L->groundedCell[neighbor]) return true;
  }
  return bodyTouchesSettledLooseComponent(b);
}
bool RigidBodySystem::bodyTouchesSettledLooseComponent(Body* b) {
  // Powder-backed baked components are retained outside the rigid grounding
  // flood. Propagate that support through static stacks, but never through a
  // body-owned cell.
  occStamp.reset((size_t)(E.cols * E.rows)); occCells.clear();
  forEachBodyCell(b, [&](int x, int y, int) {
    int k = y * E.cols + x;
    if (!occStamp.has(k)) { occStamp.add(k); occCells.push_back(k); }
  });
  const int offsets[4] = {-1, 1, -E.cols, E.cols};
  for (int k : occCells) {
    int y = k / E.cols, x = k - y * E.cols;
    for (int offset : offsets) {
      if ((offset == -1 && x == 0) || (offset == 1 && x + 1 >= E.cols)
          || (offset == -E.cols && y == 0) || (offset == E.cols && y + 1 >= E.rows))
        continue;
      int neighbor = k + offset;
      if (occStamp.has(neighbor) || E.L->bodyOwner[neighbor] >= 0
          || !E.isComponentMaterial(E.L->grid[neighbor])) continue;
      int componentId = E.L->cellComp[neighbor];
      if (componentId < 0 || componentId >= E.comps.compCount(*E.L)) continue;
      Comp* component = E.comps.compById(*E.L, componentId);
      if (component && component->settledBody
          && component->settledLooseSupport) return true;
    }
  }
  return false;
}
bool RigidBodySystem::bodyHasLooseSupport(Body* b) {
  occStamp.reset((size_t)(E.cols * E.rows)); occCells.clear();
  forEachBodyCell(b, [&](int x, int y, int) { int k = y * E.cols + x; if (!occStamp.has(k)) { occStamp.add(k); occCells.push_back(k); } });
  int solidBelow = 0, mediumBelow = 0;
  for (int k : occCells) {
    int y = k / E.cols, x = k - y * E.cols, bk = (y + 1) * E.cols + x;
    if (y + 1 < E.rows && occStamp.has(bk)) continue;
    if (y + 1 >= E.rows) { solidBelow++; continue; }
    uint8_t m = E.L->grid[bk];
    if (E.isBuoyantMedium(m)) mediumBelow++;
    else if (m != EMPTY && !E.isGasMaterial(m)) solidBelow++;
  }
  return mediumBelow > 0 && mediumBelow > solidBelow;
}
void RigidBodySystem::bakeRestingBodies() {
  auto falling = [](const std::vector<Comp>& components) {
    for (const Comp& component : components)
      if (component.buoyancyDirection > 0) return true;
    return false;
  };
  bool deferBlastBake = false;
  for (Body* b : E.L->bodies) {
    if (!b->awake && b->blastDebris) {
      deferBlastBake = falling(E.L->components);
      break;
    }
  }
  bool baked = false; std::vector<Body*> keep;
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) {
      keep.push_back(b);
      continue;
    }
    bool canBake = !b->awake && (!b->blastDebris || !deferBlastBake)
      && bodySolidifies(b) && (!b->jointPeer || bodySolidifies(b->jointPeer));
    bool groundedContact = canBake && bodyTouchesGroundedSolid(b);
    bool peerGroundedContact = false;
    if (canBake && b->jointRole == 1 && b->jointPeer) {
      Layer* previous = E.L;
      E.useLayer(&E.bg);
      peerGroundedContact = bodyTouchesGroundedSolid(b->jointPeer);
      E.useLayer(previous);
    }
    // Keep the joint component graph stable while a structural fall is active;
    // blast rubble bakes as soon as that motion clears. Other component-backed
    // bodies retain their normal solidify-on-rest behavior.
    if (canBake && (groundedContact || peerGroundedContact)) {
      int assemblyId = E.nextBakedAssemblyId++;
      if (b->jointRole == 1 && b->jointPeer) {
        Body* follower = b->jointPeer;
        syncJointFollower(b);
        Layer* previous = E.L;
        E.useLayer(&E.fg);
        bakeBodyToGrid(b, assemblyId);
        E.useLayer(&E.bg);
        bakeBodyToGrid(follower, assemblyId);
        E.bg.passiveBodyIds.erase(follower->id);
        E.bg.passiveBodyCells.erase(
          std::remove_if(E.bg.passiveBodyCells.begin(), E.bg.passiveBodyCells.end(),
                         [&](int k) {
                           return k >= 0 && k < E.cols * E.rows
                             && E.bg.bodyOwner[k] == follower->id;
                         }),
          E.bg.passiveBodyCells.end());
        std::vector<Body*> bgKeep;
        bgKeep.reserve(E.bg.bodies.size());
        for (Body* candidate : E.bg.bodies)
          if (candidate != follower) bgKeep.push_back(candidate);
        E.bg.bodies = std::move(bgKeep);
        delete follower;
        E.useLayer(previous);
      } else {
        bakeBodyToGrid(b, assemblyId);
      }
      delete b; baked = true;
    }
    else keep.push_back(b);
  }
  if (baked) {
    E.L->bodies = std::move(keep);
    if (E.L == &E.fg && E.bgEnabled)
      E.comps.jointBakeNeedsGroundRefresh = true;
  }
}
void RigidBodySystem::stampJointFollower(Body* leader) {
  if (!leader || leader->jointRole != 1 || !leader->jointPeer) return;
  Body* follower = leader->jointPeer;
  syncJointFollower(leader);
  Layer* previous = E.L;
  E.useLayer(&E.bg);
  std::vector<Disp> displaced;
  std::vector<int> footprint;
  forEachBodyCell(follower, [&](int x, int y, int local) {
    int k = y * E.cols + x;
    if (E.bg.bodyOwner[k] != -1) return;
    uint8_t material = E.bg.grid[k];
    if (!canBodyOccupy(material, k, follower->density)) {
      rigidRejectedCells++;
      return;
    }
    if (isBodyRelocatable(material, k, follower->density))
      displaced.push_back({material, k});
    E.writeGridIndex(k, bodyMaterialAt(follower, local));
    E.bg.bodyOwner[k] = follower->id;
    E.bg.passiveBodyCells.push_back(k);
    footprint.push_back(k);
  });
  int32_t footprintGen = ++E.bg.seenGen;
  for (int k : footprint) E.bg.rigidSpillFootprint[k] = footprintGen;
  spillDisplacedBodyMaterial(displaced, footprint, footprintGen,
                             follower->id, follower->density);
  E.useLayer(previous);
}
// World streaming clears body rasters before saving and translating tiles.
// Rebuild each body's current footprint immediately after both layers have
// loaded so sleeping bodies remain visible and interactive without requiring a
// simulation tick.
void RigidBodySystem::restampBodiesAfterStream() {
  std::vector<int> cells, footprint;
  std::unordered_map<int, std::pair<std::vector<Disp>, std::vector<int>>> perBody;
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    auto& stamped = perBody[body->id];
    forEachBodyCell(body, [&](int x, int y, int local) {
      int k = y * E.cols + x;
      if (E.L->bodyOwner[k] != -1) return;
      uint8_t material = E.L->grid[k];
      if (!canBodyOccupy(material, k, body->density)) return;
      if (isBodyRelocatable(material, k, body->density))
        stamped.first.push_back({material, k});
      E.writeGridIndex(k, bodyMaterialAt(body, local));
      E.L->bodyOwner[k] = body->id;
      if (body->blastDebris) E.L->groundedCell[k] = 0;
      cells.push_back(k);
      footprint.push_back(k);
      stamped.second.push_back(k);
    });
  }
  int32_t footprintGen = ++E.L->seenGen;
  for (int k : footprint) E.L->rigidSpillFootprint[k] = footprintGen;
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    auto it = perBody.find(body->id);
    if (it == perBody.end()) continue;
    spillDisplacedBodyMaterial(it->second.first, it->second.second,
                               footprintGen, body->id, body->density);
  }
  E.L->bodyCells = std::move(cells);
  if (E.L == &E.fg) {
    for (Body* body : E.fg.bodies)
      if (body->jointRole == 1) stampJointFollower(body);
  }
  E.L->sleepingBodySupportDirty = true;
}
void RigidBodySystem::moveBodies() {
  bool hasSimulatedBody = false;
  for (Body* b : E.L->bodies)
    if (b->jointRole != 2) { hasSimulatedBody = true; break; }
  if (!hasSimulatedBody && E.L->bodyCells.empty()) {
    E.L->sleepingBodySupportDirty = false;
    return;
  }
  // stepLayer already grounded the live grid before assembly motion. Repeat that
  // full-grid work only if an assembly/loose-support change dirtied it afterward,
  // or if a sleeping body needs its support revalidated. This matters for blast
  // rubble: a long TNT chain otherwise paid two grounding floods on every flight
  // tick even though its handful of awake chunks cannot need a wake probe.
  // A single-layer computeGrounded() re-flood peels dual-layer joint stamps; if
  // the next tick then skips joint, co-supported terrain sloughs off. Preserve
  // stamps when joint already ran this tick OR a prior joint closure is valid.
  bool hasSleepingBody = false;
  bool hasAwakeBody = false;
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    if (b->awake) hasAwakeBody = true;
    else hasSleepingBody = true;
  }
  bool needsGroundRefresh = E.L->groundDirty || E.L->groundContentDirty || E.L->looseGroundDirty;
  // Stable sleeping bodies remain stamped in the live grid. Support/topology
  // invalidation wakes this path even when the preceding grounding pass consumed
  // the source dirty flags.
  if (!hasAwakeBody && !needsGroundRefresh && !E.L->sleepingBodySupportDirty) return;
  if (hasSleepingBody || needsGroundRefresh) {
    if (E.bgEnabled && (E.comps.jointGroundReady || E.comps.jointSupportValid)) {
      // joint stamps intact; body wake probes do not need a re-flood
    } else {
      E.computeGrounded();
      if (E.bgEnabled) E.comps.jointDirty = true;
    }
  }
  // Wake any sleeping body whose support crumbled away since it slept, so it
  // falls instead of floating. Checked before the grid cells are cleared so
  // other E.L->bodies still count as support; body-on-body stacks cascade (the
  // bottom body wakes and moves, then the contact solver wakes those above).
  for (Body* b : E.L->bodies) if (b->jointRole != 2 && !b->awake) {
    bool supported = sleepingBodyHasSupport(b, 1.0);
    if (!supported && b->jointRole == 1 && b->jointPeer) {
      Layer* previous = E.L;
      E.useLayer(&E.bg);
      supported = sleepingBodyHasSupport(b->jointPeer, 1.0);
      E.useLayer(previous);
    }
    if (!supported) wakeBody(b);
  }
  E.L->sleepingBodySupportDirty = false;
  if (E.L == &E.fg) {
    for (int k : E.bg.passiveBodyCells) {
      if (k < 0 || k >= E.cols * E.rows) continue;
      int owner = E.bg.bodyOwner[k];
      if (owner >= 0 && E.bg.passiveBodyIds.count(owner)) {
        E.useLayer(&E.bg);
        E.writeGridIndex(k, EMPTY);
        E.bg.bodyOwner[k] = -1;
        E.useLayer(&E.fg);
      }
    }
    E.bg.passiveBodyCells.clear();
  }
  std::unordered_map<int, std::vector<int>> previousFootprints;
  for (int k : E.L->bodyCells) {
    int owner = E.L->bodyOwner[k];
    if (owner >= 0) previousFootprints[owner].push_back(k);
    if (E.isBodyCell(k)) E.writeGridIndex(k, EMPTY);
    E.L->bodyOwner[k] = -1;
  } // body-material invariant: body cells hold the body's real material; E.L->bodyOwner marks them
  std::unordered_map<int, std::array<double, 3>> prePoses;
  for (Body* b : E.L->bodies) if (b->jointRole != 2)
    prePoses[b->id] = {b->px, b->py, b->angle};
  rigidStep(1.0);
  rigidRejectedCells = 0; rigidDepenetrations = 0;
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    auto it = prePoses.find(b->id); bool hp = it != prePoses.end();
    double ppx = hp ? it->second[0] : 0, ppy = hp ? it->second[1] : 0, ppa = hp ? it->second[2] : 0;
    if (depenetrateBodyRaster(b, ppx, ppy, hp)) rigidDepenetrations++;
    if (hp && E.L == &E.fg) pushActorsFromBody(b, ppx, ppy, ppa);
  }
  bakeRestingBodies(); // a non-RIGID body that just slept solidifies after depenetration
  std::vector<int> cells, footprint;
  std::unordered_map<int, std::pair<std::vector<Disp>, std::vector<int>>> perBody;
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    auto& pb = perBody[b->id];
    forEachBodyCell(b, [&](int x, int y, int local) {
      int k = y * E.cols + x; if (E.L->bodyOwner[k] != -1) return; uint8_t m = E.L->grid[k];
      if (!canBodyOccupy(m, k, b->density)) { rigidRejectedCells++; return; }
      if (isBodyRelocatable(m, k, b->density)) pb.first.push_back({m, k});
      E.writeGridIndex(k, bodyMaterialAt(b, local)); E.L->bodyOwner[k] = b->id;
      if (b->blastDebris) E.L->groundedCell[k] = 0;
      cells.push_back(k); footprint.push_back(k); pb.second.push_back(k); // body-material invariant: stamp the body's REAL material so it renders/mines/reacts as that material
    });
  }
  {
    std::vector<Body*> keep;
    keep.reserve(E.L->bodies.size());
    for (Body* b : E.L->bodies) {
      if (b->jointRole == 2) { keep.push_back(b); continue; }
      auto it = perBody.find(b->id);
      if (it != perBody.end() && it->second.second.empty()) {
        if (b->jointRole == 1 && b->jointPeer) {
          bool hasUnionCell = false;
          for (uint8_t occupied : b->occ)
            if (occupied) { hasUnionCell = true; break; }
          if (hasUnionCell) {
            keep.push_back(b);
            continue;
          }
          Body* follower = b->jointPeer;
          E.bg.passiveBodyIds.erase(follower->id);
          E.bg.bodies.erase(
            std::remove(E.bg.bodies.begin(), E.bg.bodies.end(), follower),
            E.bg.bodies.end());
          delete follower;
        }
        delete b;
        continue;
      }
      keep.push_back(b);
    }
    if (keep.size() != E.L->bodies.size()) E.L->bodies = std::move(keep);
  }
  int32_t footprintGen = ++E.L->seenGen;
  for (int k : footprint) E.L->rigidSpillFootprint[k] = footprintGen;
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    auto it = perBody.find(b->id);
    if (it == perBody.end()) continue;
    auto old = previousFootprints.find(b->id);
    const std::vector<int>* vacated =
      old == previousFootprints.end() ? nullptr : &old->second;
    spillDisplacedBodyMaterial(it->second.first, it->second.second,
                               footprintGen, b->id, b->density, vacated);
  }
  if (E.L == &E.fg) {
    // Joint erosion rebuilds pieces from the two live owner rasters. Restore
    // the follower before acid/fire can erase the leader so the splitter sees
    // both layer maps instead of interpreting the temporarily-cleared
    // background footprint as a foreground-only body.
    std::vector<Body*> leaders;
    for (Body* b : E.fg.bodies) if (b->jointRole == 1) leaders.push_back(b);
    for (Body* leader : leaders) stampJointFollower(leader);
  }
  erodeBodies(cells);
}

template <class Cells>
bool RigidBodySystem::planAssemblyBodyPush(const Cells& assemblyCells, int dir,
                                           AssemblyBodyPush& plan) {
  plan = AssemblyBodyPush{};
  plan.layer = E.L;
  // Components only push with gravity. Rising/floating components still treat
  // rigid bodies as ordinary solid blockers.
  if (dir != E.cols || E.L->bodies.empty() || E.L->bodyCells.empty()) return true;

  std::unordered_map<int, Body*> byId;
  byId.reserve(E.L->bodies.size() * 2);
  for (Body* b : E.L->bodies) byId[b->id] = b;

  std::unordered_map<int, std::vector<int>> cellsById;
  cellsById.reserve(E.L->bodies.size() * 2);
  for (int k : E.L->bodyCells) {
    if (k < 0 || k >= E.cols * E.rows) continue;
    int id = E.L->bodyOwner[k];
    if (id >= 0 && byId.count(id)) cellsById[id].push_back(k);
  }

  std::unordered_set<int> selected, crushed;
  std::vector<int> queue;
  occStamp.reset((size_t)E.cols * E.rows);
  for (int k : assemblyCells) occStamp.add(k);
  for (int k : assemblyCells) {
    int lead = k + dir;
    if (lead < 0 || lead >= E.cols * E.rows) continue;
    if (occStamp.has(lead)) continue;
    int id = E.L->bodyOwner[lead];
    if (id < 0) continue;
    if (E.L->passiveBodyIds.count(id)) return false;
    auto it = byId.find(id);
    if (it == byId.end()) return false;
    if (it->second->blastDebris) crushed.insert(id);
    else if (selected.insert(id).second) queue.push_back(id);
  }
  if (queue.empty() && crushed.empty()) return true;

  // A body may be resting on another body. Move the entire downward stack or
  // none of it; otherwise the first body would simply overwrite/pin the next.
  // Tiny blast rubble yields instead of transmitting the stack's load.
  for (size_t qi = 0; qi < queue.size(); qi++) {
    int id = queue[qi];
    auto bodyIt = byId.find(id);
    auto cellsIt = cellsById.find(id);
    if (bodyIt == byId.end() || cellsIt == cellsById.end() || cellsIt->second.empty()) return false;
    for (int k : cellsIt->second) {
      int nk = k + dir;
      if (nk < E.cols || nk >= E.cols * E.rows) return false;
      int nextId = E.L->bodyOwner[nk];
      if (nextId < 0 || selected.count(nextId) || crushed.count(nextId)) continue;
      auto nextIt = byId.find(nextId);
      if (nextIt == byId.end()) return false;
      if (nextIt->second->blastDebris) crushed.insert(nextId);
      else if (selected.insert(nextId).second) queue.push_back(nextId);
    }
  }

  for (Body* b : E.L->bodies) {
    if (selected.count(b->id)) plan.bodies.push_back(b);
    else if (crushed.count(b->id)) plan.crushedBodies.push_back(b);
  }
  for (int k : E.L->bodyCells) {
    if (k < 0 || k >= E.cols * E.rows) continue;
    int id = E.L->bodyOwner[k];
    if (crushed.count(id)) {
      plan.vacated.insert(k);
      plan.overlay[k] = EMPTY;
      continue;
    }
    if (!selected.count(id)) continue;
    plan.oldCells.push_back(k);
    plan.newCells.push_back(k + dir);
    plan.owners.push_back(id);
    plan.vacated.insert(k);
  }
  if (plan.oldCells.empty() && plan.crushedBodies.empty()) return false;

  for (size_t i = 0; i < plan.newCells.size(); i++) {
    int nk = plan.newCells[i];
    if (nk < E.cols || nk >= E.cols * E.rows || occStamp.has(nk)) return false;
    int owner = E.L->bodyOwner[nk];
    if (owner >= 0) {
      if (!selected.count(owner) && !crushed.count(owner)) return false;
    } else {
      uint8_t m = E.L->grid[nk];
      Body* b = byId[plan.owners[i]];
      if (!b || !canBodyOccupy(m, nk, b->density)) return false;
    }
    plan.occupied.insert(nk);
  }

  for (int k : plan.oldCells) plan.overlay[k] = EMPTY;
  for (size_t i = 0; i < plan.newCells.size(); i++) {
    Body* b = byId[plan.owners[i]];
    int old = plan.oldCells[i], y = old / E.cols, x = old - y * E.cols;
    plan.overlay[plan.newCells[i]] = bodyMaterialAt(b, localCellAt(b, x + 0.5, y + 0.5));
  }
  return true;
}

void RigidBodySystem::applyAssemblyBodyPush(AssemblyBodyPush& plan) {
  if (plan.empty()) return;
  Layer* previous = E.L;
  E.useLayer(plan.layer);
  std::unordered_set<int> selected;
  selected.reserve((plan.bodies.size() + plan.crushedBodies.size()) * 2);
  for (Body* b : plan.bodies) selected.insert(b->id);
  for (Body* b : plan.crushedBodies) selected.insert(b->id);

  std::vector<int> kept;
  kept.reserve(E.L->bodyCells.size());
  for (int k : E.L->bodyCells) {
    int owner = (k >= 0 && k < E.cols * E.rows) ? E.L->bodyOwner[k] : -1;
    if (selected.count(owner)) {
      E.writeGridIndex(k, EMPTY);
      E.L->bodyOwner[k] = -1;
    } else kept.push_back(k);
  }
  for (Body* b : plan.bodies) {
    b->py += 1.0;
    if (b->vy < 0) b->vy = 0;
    wakeBody(b);
  }
  for (size_t i = 0; i < plan.newCells.size(); i++) {
    int k = plan.newCells[i], id = plan.owners[i];
    Body* b = nullptr;
    for (Body* candidate : plan.bodies) if (candidate->id == id) { b = candidate; break; }
    if (!b) continue;
    int y = k / E.cols, x = k - y * E.cols;
    E.writeGridIndex(k, bodyMaterialAt(b, localCellAt(b, x + 0.5, y + 0.5)));
    E.L->bodyOwner[k] = id;
    kept.push_back(k);
  }
  E.L->bodyCells = std::move(kept);
  if (!plan.crushedBodies.empty()) {
    std::unordered_set<int> crushed;
    crushed.reserve(plan.crushedBodies.size() * 2);
    for (Body* b : plan.crushedBodies) crushed.insert(b->id);
    std::vector<Body*> survivors;
    survivors.reserve(E.L->bodies.size() - plan.crushedBodies.size());
    for (Body* b : E.L->bodies) {
      if (crushed.count(b->id)) delete b;
      else survivors.push_back(b);
    }
    E.L->bodies = std::move(survivors);
  }
  E.useLayer(previous);
}

Body* RigidBodySystem::finishSpawn(const std::vector<std::pair<int, int>>& cells,
                                   uint8_t material, bool attachTouchingBodies) {
  if (cells.empty() || material == EMPTY || material >= TABLE) return nullptr;

  // A single placement gesture may contain disconnected islands. Each island
  // starts as its own body unless contact with an existing body welds them.
  std::map<int, std::pair<int, int>> orderedCells;
  for (const auto& cell : cells) {
    if (cell.first < 0 || cell.first >= E.cols || cell.second < 0 || cell.second >= E.rows)
      continue;
    orderedCells[cell.second * E.cols + cell.first] = cell;
  }
  if (orderedCells.empty()) return nullptr;
  std::unordered_set<int> unvisited;
  unvisited.reserve(orderedCells.size() * 2);
  for (const auto& entry : orderedCells) unvisited.insert(entry.first);
  std::vector<std::vector<std::pair<int, int>>> islands;
  std::vector<int> stack;
  for (const auto& entry : orderedCells) {
    if (!unvisited.erase(entry.first)) continue;
    islands.push_back({});
    stack.clear();
    stack.push_back(entry.first);
    while (!stack.empty()) {
      int k = stack.back();
      stack.pop_back();
      islands.back().push_back({k % E.cols, k / E.cols});
      int x = k % E.cols, y = k / E.cols;
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int nx = x + ox, ny = y + oy;
        if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
        int nk = ny * E.cols + nx;
        if (unvisited.erase(nk)) stack.push_back(nk);
      }
    }
    std::sort(islands.back().begin(), islands.back().end(),
              [&](const auto& a, const auto& b) {
                return a.second * E.cols + a.first < b.second * E.cols + b.first;
              });
  }
  if (islands.size() > 1) {
    Body* last = nullptr;
    for (const auto& island : islands) {
      Body* spawned = finishSpawn(island, material, attachTouchingBodies);
      if (spawned) last = spawned;
    }
    return last;
  }
  const std::vector<std::pair<int, int>>& spawnCells = islands[0];

  std::unordered_set<int> touchingIds;
  if (attachTouchingBodies) {
    for (const auto& cell : spawnCells) {
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int x = cell.first + ox, y = cell.second + oy;
        if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
        int owner = E.L->bodyOwner[y * E.cols + x];
        if (owner >= 0) touchingIds.insert(owner);
      }
    }
  }

  std::vector<Body*> touching;
  if (!touchingIds.empty()) {
    for (Body* body : E.L->bodies)
      if (touchingIds.count(body->id)) touching.push_back(body);
    std::sort(touching.begin(), touching.end(),
              [](Body* a, Body* b) { return a->id < b->id; });
    for (Body* body : touching)
      if (body->jointRole) breakJointBody(body);
  }

  Body* body = nullptr;
  if (touching.empty()) {
    body = spawnBodyImpl(spawnCells, material, DENSITY[material]);
  } else {
    // Placement welds every contacted body and the new cells into one raster.
    // Existing bodies may be rotated, so their current world raster is the
    // authoritative shape at the instant of attachment.
    std::map<int, uint8_t> materialAt;
    double momentumX = 0, momentumY = 0, spin = 0, oldMass = 0;
    int fuseTicks = 0;
    for (Body* source : touching) {
      double mass = source->invMass > 0 ? 1.0 / source->invMass : 0;
      momentumX += source->vx * mass;
      momentumY += source->vy * mass;
      spin += source->omega * mass;
      oldMass += mass;
      if (source->fuseTicks > 0 && (!fuseTicks || source->fuseTicks < fuseTicks))
        fuseTicks = source->fuseTicks;
      forEachBodyCell(source, [&](int x, int y, int local) {
        materialAt.emplace(y * E.cols + x, bodyMaterialAt(source, local));
      });
    }
    for (const auto& cell : spawnCells)
      materialAt[cell.second * E.cols + cell.first] = material;

    std::unordered_set<int> removedIds(touchingIds.begin(), touchingIds.end());
    std::vector<int> keptCells;
    keptCells.reserve(E.L->bodyCells.size());
    for (int k : E.L->bodyCells) {
      if (removedIds.count(E.L->bodyOwner[k])) {
        E.writeGridIndex(k, EMPTY);
        E.L->bodyOwner[k] = -1;
      } else {
        keptCells.push_back(k);
      }
    }
    E.L->bodyCells = std::move(keptCells);

    std::vector<Body*> keptBodies;
    keptBodies.reserve(E.L->bodies.size() - touching.size());
    for (Body* candidate : E.L->bodies) {
      if (!removedIds.count(candidate->id)) {
        keptBodies.push_back(candidate);
        continue;
      }
      delete candidate;
    }
    E.L->bodies = std::move(keptBodies);

    std::vector<std::pair<int, int>> mergedCells;
    std::vector<uint8_t> mergedMaterials;
    mergedCells.reserve(materialAt.size());
    mergedMaterials.reserve(materialAt.size());
    for (const auto& entry : materialAt) {
      mergedCells.push_back({entry.first % E.cols, entry.first / E.cols});
      mergedMaterials.push_back(entry.second);
    }
    body = spawnBodyImpl(mergedCells, mergedMaterials);
    if (body) {
      double addedMass = DENSITY[material] * spawnCells.size();
      double totalMass = oldMass + addedMass;
      if (totalMass > 0) {
        body->vx = momentumX / totalMass;
        body->vy = momentumY / totalMass;
        body->omega = spin / totalMass;
      }
      body->blastDebris = false;
      body->fuseTicks = fuseTicks;
    }
  }

  if (!body) return nullptr;
  int minX = E.cols - 1, minY = E.rows - 1, maxX = 0, maxY = 0;
  std::vector<Disp> displaced;
  std::vector<int> footprint;
  forEachBodyCell(body, [&](int x, int y, int local) {
    int k = y * E.cols + x;
    if (E.L->bodyOwner[k] >= 0 && E.L->bodyOwner[k] != body->id) return;
    uint8_t existing = E.L->grid[k];
    if (!canBodyOccupy(existing, k, body->density)) return;
    if (isBodyRelocatable(existing, k, body->density))
      displaced.push_back({existing, k});
    E.writeGridIndex(k, bodyMaterialAt(body, local));
    E.L->bodyOwner[k] = body->id;
    E.L->bodyCells.push_back(k);
    footprint.push_back(k);
    minX = imin(minX, x); minY = imin(minY, y);
    maxX = imax(maxX, x); maxY = imax(maxY, y);
  });
  if (!footprint.empty()) {
    int32_t footprintGen = ++E.L->seenGen;
    for (int k : footprint) E.L->rigidSpillFootprint[k] = footprintGen;
    spillDisplacedBodyMaterial(displaced, footprint, footprintGen, body->id, body->density);
    E.markDirtyRect(minX, minY, maxX, maxY);
  }
  E.L->sleepingBodySupportDirty = true;
  if (E.bgEnabled) {
    E.comps.jointDirty = true;
    E.comps.jointBondsInvalid = true;
    E.comps.jointSupportValid = false;
  }
  return body;
}
Body* RigidBodySystem::spawnBody(const std::vector<std::pair<int, int>>& cells) { return finishSpawn(cells, RIGID); }

// Primitive body shapes built engine-side. Cells are clipped like the cube tool:
// dx in [-halfW, halfW), dy in [-halfH, halfH) for the box.
Body* RigidBodySystem::spawnBox(int cx, int cy, int halfW, int halfH, uint8_t material) {
  if (material >= TABLE) material = RIGID;
  std::vector<std::pair<int, int>> cells;
  cells.reserve((size_t)imax(0, 2 * halfW) * imax(0, 2 * halfH));
  for (int dx = -halfW; dx < halfW; dx++)
    for (int dy = -halfH; dy < halfH; dy++) {
      int x = cx + dx, y = cy + dy;
      if (x >= 1 && x < E.cols - 1 && y >= 1 && y < E.rows - 1) cells.push_back({x, y});
    }
  return finishSpawn(cells, material);
}
Body* RigidBodySystem::spawnDisc(int cx, int cy, int radius, uint8_t material) {
  if (material >= TABLE) material = RIGID;
  std::vector<std::pair<int, int>> cells;
  int r2 = radius * radius;
  for (int dy = -radius; dy <= radius; dy++)
    for (int dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      int x = cx + dx, y = cy + dy;
      if (x >= 1 && x < E.cols - 1 && y >= 1 && y < E.rows - 1) cells.push_back({x, y});
    }
  return finishSpawn(cells, material);
}
