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

static bool rigidPreciseContact(const Contact& contact) {
  return contact.b && (!contact.bIntegrated
    || contact.a->jointRole == 1 || contact.b->jointRole == 1
    || (rigidLargeSlenderBody(contact.a)
      && rigidLargeSlenderBody(contact.b)));
}

static double rigidContactSlop(const Contact& contact) {
  return rigidPreciseContact(contact) ? R_BODY_PEN_SLOP : R_PEN_SLOP;
}

static double rigidContactVx(const Body* body) {
  return body->kinematic ? body->kinematicVx : body->vx;
}

static double rigidContactVy(const Body* body) {
  return body->kinematic ? body->kinematicVy : body->vy;
}

static double rigidContactOmega(const Body* body) {
  return body->kinematic ? body->kinematicOmega : body->omega;
}

bool RigidBodySystem::bodyFullyInsideLoadedWindow(Body* body) const {
  if (!E.L->infinite) return true;
  double cs = std::cos(body->angle), sn = std::sin(body->angle);
  constexpr double edgeTolerance = 1e-7;
  for (const BodyCollisionRect& rect : body->collisionRects) {
    double lx0 = body->offsetX + rect.x0 - 0.5;
    double lx1 = body->offsetX + rect.x1 - 0.5;
    double ly0 = body->offsetY + rect.y0 - 0.5;
    double ly1 = body->offsetY + rect.y1 - 0.5;
    auto inside = [&](double lx, double ly) {
      double x = body->px + lx * cs - ly * sn;
      double y = body->py + lx * sn + ly * cs;
      return x >= -edgeTolerance && x <= E.cols + edgeTolerance
          && y >= -edgeTolerance && y <= E.rows + edgeTolerance;
    };
    if (!inside(lx0, ly0) || !inside(lx1, ly0)
        || !inside(lx1, ly1) || !inside(lx0, ly1))
      return false;
  }
  return true;
}

void RigidBodySystem::clearContactCaches() {
  for (ContactCache& cache : contactCaches) cache.clear();
  for (auto& contacts : impactContactTicks) contacts.clear();
  for (auto& axes : pairAxes) axes.clear();
  shockAttemptCache.clear();
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
  b->erodible = false;
  b->erosionBoundaryMask.assign(b->occ.size(), 0);
  for (int local = 0; local < (int)b->occ.size(); local++) {
    uint8_t material = bodyMaterialAt(b, local);
    if (material == RIGID || E.isDissolvable(material)
        || E.isFlammable(material)) {
      b->erodible = true;
    }
    if (material == EMPTY) continue;
    int i = local % b->w, j = local / b->w;
    for (int oy = -1; oy <= 1 && !b->erosionBoundaryMask[local]; oy++)
      for (int ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        int ni = i + ox, nj = j + oy;
        if (ni < 0 || ni >= b->w || nj < 0 || nj >= b->h
            || bodyMaterialAt(b, nj * b->w + ni) == EMPTY) {
          b->erosionBoundaryMask[local] = 1;
          break;
        }
      }
  }
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
    double r2 = lx * lx + ly * ly;
    inertia += cellMass * (r2 + 1.0 / 6.0);
    if (r2 > maxR2) maxR2 = r2;
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
  b->boundarySampleBlocks.clear();
  static constexpr int BOUNDARY_SAMPLES_PER_BLOCK = 32;
  int sampleCount = (int)b->boundarySampleRadii.size();
  for (int first = 0; first < sampleCount;
       first += BOUNDARY_SAMPLES_PER_BLOCK) {
    BodyBoundarySampleBlock block;
    block.first = first;
    block.count = imin(BOUNDARY_SAMPLES_PER_BLOCK, sampleCount - first);
    block.minX = block.minY = std::numeric_limits<float>::max();
    block.maxX = block.maxY = std::numeric_limits<float>::lowest();
    for (int sample = first; sample < first + block.count; sample++) {
      float x = b->boundarySamples[sample * 2];
      float y = b->boundarySamples[sample * 2 + 1];
      block.minX = std::fmin(block.minX, x);
      block.minY = std::fmin(block.minY, y);
      block.maxX = std::fmax(block.maxX, x);
      block.maxY = std::fmax(block.maxY, y);
      block.maxRadius = std::fmax(
        block.maxRadius, b->boundarySampleRadii[sample]);
    }
    b->boundarySampleBlocks.push_back(block);
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
  b->collisionTree.clear();
  b->collisionTreeRoot = -1;
  std::vector<int> collisionOrder(b->collisionRects.size());
  for (int child = 0; child < (int)collisionOrder.size(); child++)
    collisionOrder[child] = child;
  auto buildCollisionTree = [&](auto&& self, int begin, int end) -> int {
    BodyCollisionNode node;
    node.x0 = node.y0 = INT_MAX;
    node.x1 = node.y1 = INT_MIN;
    int minCenterX = INT_MAX, maxCenterX = INT_MIN;
    int minCenterY = INT_MAX, maxCenterY = INT_MIN;
    for (int position = begin; position < end; position++) {
      const BodyCollisionRect& rect =
        b->collisionRects[collisionOrder[position]];
      node.x0 = imin(node.x0, rect.x0);
      node.y0 = imin(node.y0, rect.y0);
      node.x1 = imax(node.x1, rect.x1);
      node.y1 = imax(node.y1, rect.y1);
      int centerX = rect.x0 + rect.x1;
      int centerY = rect.y0 + rect.y1;
      minCenterX = imin(minCenterX, centerX);
      maxCenterX = imax(maxCenterX, centerX);
      minCenterY = imin(minCenterY, centerY);
      maxCenterY = imax(maxCenterY, centerY);
    }
    int nodeIndex = (int)b->collisionTree.size();
    b->collisionTree.push_back(node);
    if (end - begin == 1) {
      b->collisionTree[nodeIndex].child = collisionOrder[begin];
      return nodeIndex;
    }
    bool splitX = maxCenterX - minCenterX >= maxCenterY - minCenterY;
    std::stable_sort(collisionOrder.begin() + begin,
                     collisionOrder.begin() + end,
      [&](int first, int second) {
        const BodyCollisionRect& a = b->collisionRects[first];
        const BodyCollisionRect& c = b->collisionRects[second];
        int centerA = splitX ? a.x0 + a.x1 : a.y0 + a.y1;
        int centerC = splitX ? c.x0 + c.x1 : c.y0 + c.y1;
        return centerA != centerC ? centerA < centerC : first < second;
      });
    int middle = begin + (end - begin) / 2;
    int left = self(self, begin, middle);
    int right = self(self, middle, end);
    b->collisionTree[nodeIndex].left = left;
    b->collisionTree[nodeIndex].right = right;
    return nodeIndex;
  };
  if (!collisionOrder.empty())
    b->collisionTreeRoot = buildCollisionTree(
      buildCollisionTree, 0, (int)collisionOrder.size());
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
void RigidBodySystem::bindJointBodies(Body* leader, Body* follower, int jointId) {
  if (!leader || !follower) return;
  leader->id = follower->id = jointId;
  E.fg.nextBodyId = imax(E.fg.nextBodyId, jointId + 1);
  E.bg.nextBodyId = imax(E.bg.nextBodyId, jointId + 1);
  leader->jointRole = 1;
  follower->jointRole = 2;
  leader->jointPeer = follower;
  follower->jointPeer = leader;
  E.bg.passiveBodyIds.insert(jointId);
}
void RigidBodySystem::unbindJointBodies(Body* leader, Body* follower) {
  if (!leader || !follower) return;
  E.bg.passiveBodyIds.erase(follower->id);
  leader->jointPeer = nullptr;
  follower->jointPeer = nullptr;
  leader->jointRole = 0;
  follower->jointRole = 0;
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

  Engine::ActiveLayerScope layerScope(E, &E.fg);
  Body* leader = spawnBodyImpl(unionCells, fgMaterials[0], DENSITY[fgMaterials[0]]);
  E.useLayer(&E.bg);
  Body* follower = spawnBodyImpl(unionCells, bgMaterials[0], DENSITY[bgMaterials[0]]);
  if (!leader || !follower) return nullptr;
  int jointId = imax(leader->id, follower->id);
  bindJointBodies(leader, follower, jointId);

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
  computeDerived(leader, true);
  computeDerived(follower, true);
  syncJointFollower(leader);
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
      Body* leader = &sourceLayer == &E.fg ? source : peer;
      Body* follower = &sourceLayer == &E.bg ? source : peer;
      int oldId = source->id;
      int jointId = imax(E.fg.nextBodyId, E.bg.nextBodyId);
      bindJointBodies(leader, follower, jointId);
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

  Engine::ActiveLayerScope layerScope(E, &targetLayer);
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
  double rvx = A->vx - A->omega * c.ray, rvy = A->vy + A->omega * c.rax;
  if (B) {
    rvx -= rigidContactVx(B) - rigidContactOmega(B) * c.rby;
    rvy -= rigidContactVy(B) + rigidContactOmega(B) * c.rbx;
  }
  double vn = rvx * c.nx + rvy * c.ny;
  double movedN = 0;
  if (c.normalMass > 0) {
    double delta = (c.targetVn - vn) * c.normalMass;
    double newJn = c.accJn + delta; if (newJn < 0) newJn = 0;
    double applied = newJn - c.accJn; c.accJn = newJn;
    movedN = std::fabs(applied);
    double jx = applied * c.nx, jy = applied * c.ny;
    A->vx += jx * c.aInvM; A->vy += jy * c.aInvM; A->omega += c.aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B->vx -= jx * c.bInvM; B->vy -= jy * c.bInvM; B->omega -= c.bInvI * (c.rbx * jy - c.rby * jx); }
  }
  return movedN;
}
double RigidBodySystem::resolveContactFriction(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double tx = -c.ny, ty = c.nx;
  double rtvx = A->vx - A->omega * c.ray, rtvy = A->vy + A->omega * c.rax;
  if (B) {
    rtvx -= rigidContactVx(B) - rigidContactOmega(B) * c.rby;
    rtvy -= rigidContactVy(B) + rigidContactOmega(B) * c.rbx;
  }
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
    A->vx += jx * c.aInvM; A->vy += jy * c.aInvM; A->omega += c.aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B->vx -= jx * c.bInvM; B->vy -= jy * c.bInvM; B->omega -= c.bInvI * (c.rbx * jy - c.rby * jx); }
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
  double aInvM = first.aInvM;
  double aInvI = first.aInvI;
  double bInvM = first.bInvM;
  double bInvI = first.bInvI;
  auto normalVelocity = [&](const Contact& contact) {
    double rvx = A->vx - A->omega * contact.ray;
    double rvy = A->vy + A->omega * contact.rax;
    if (B) {
      rvx -= rigidContactVx(B) - rigidContactOmega(B) * contact.rby;
      rvy -= rigidContactVy(B) + rigidContactOmega(B) * contact.rbx;
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
  double tx = -c.ny, ty = c.nx;
  double jx = c.accJn * c.nx + c.accJt * tx;
  double jy = c.accJn * c.ny + c.accJt * ty;
  A->vx += jx * c.aInvM; A->vy += jy * c.aInvM;
  A->omega += c.aInvI * (c.rax * jy - c.ray * jx);
  if (B) {
    B->vx -= jx * c.bInvM; B->vy -= jy * c.bInvM;
    B->omega -= c.bInvI * (c.rbx * jy - c.rby * jx);
  }
}
double RigidBodySystem::resolveBias(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double slop = rigidContactSlop(c);
  double bias = R_BAUMGARTE * std::fmax(0.0, c.depth - slop);
  if (bias <= 0) return 0; if (bias > R_MAX_BIAS_VEL) bias = R_MAX_BIAS_VEL;
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
  A->pvx += jx * c.aInvM; A->pvy += jy * c.aInvM; A->pw += c.aInvI * (c.rax * jy - c.ray * jx);
  if (B && c.bIntegrated) {
    B->pvx -= jx * c.bInvM;
    B->pvy -= jy * c.bInvM;
    B->pw -= c.bInvI * (c.rbx * jy - c.rby * jx);
  }
  return std::fabs(applied);
}
void RigidBodySystem::wakeBody(Body* b) {
  if (b->jointRole == 2 && b->jointPeer) b = b->jointPeer;
  if (!bodyFullyInsideLoadedWindow(b)) return;
  b->awake = true;
  b->stillTicks = 0;
  if (b->jointRole == 1) syncJointFollower(b);
}
void RigidBodySystem::wakeBodiesTouchingCells(
    Layer& layer, const std::vector<std::pair<int, int>>& cells) {
  std::unordered_set<int> touchingIds;
  for (const auto& cell : cells) {
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      int x = cell.first + ox, y = cell.second + oy;
      if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
      int owner = layer.bodyOwner[y * E.cols + x];
      if (owner >= 0) touchingIds.insert(owner);
    }
  }
  if (touchingIds.empty()) return;
  for (Body* body : layer.bodies)
    if (touchingIds.count(body->id)) wakeBody(body);
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
    computeDerived(body, true);
  };
  unbindJointBodies(leader, follower);
  keepOwnLayer(leader);
  keepOwnLayer(follower);
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
  double rigidStageStart = emscripten_get_now();
#include "rigid_step_prepare.inc"
  rigidStepPrepareMs += emscripten_get_now() - rigidStageStart;
  rigidStageStart = emscripten_get_now();
#include "rigid_step_contacts.inc"
  rigidContactSetupMs += emscripten_get_now() - rigidStageStart;
  rigidStageStart = emscripten_get_now();
#include "rigid_step_substeps.inc"
  rigidStageStart = emscripten_get_now();
#include "rigid_step_finalize.inc"
  rigidStepFinalizeMs += emscripten_get_now() - rigidStageStart;
  rigidFluidReferenceTotalMs += fluidReferenceMs;
  rigidFluidDomainTotalMs += fluidDomainMs;
  rigidFluidMatrixTotalMs += fluidMatrixMs;
  rigidFluidSolveTotalMs += fluidSolveMs;
  rigidFluidWritebackTotalMs += fluidWritebackMs;
  rigidFluidNodesTotal += fluidNodeCount;
  rigidFluidFacesTotal += fluidFaceCount;
  rigidFluidIterationsTotal += fluidPressureIterations;
  // Background contacts resolve against the physical foreground leader. Mirror
  // any resulting motion into its passive background footprint.
  if (E.L == &E.bg)
    for (const auto& entry : peerJointLeaders)
      syncJointFollower(entry.second);
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
  b->rasterBoundaryFootprint.clear();
  for (int wy = y0; wy <= y1; wy++) for (int wx = x0; wx <= x1; wx++) {
    double dx = wx + 0.5 - b->px, dy = wy + 0.5 - b->py;
    double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    int i = (int)std::lround(lx - b->offsetX), j = (int)std::lround(ly - b->offsetY);
    if (i < 0 || i >= b->w || j < 0 || j >= b->h) continue;
    int local = j * b->w + i;
    if (b->occ[local] && bodyMaterialAt(b, local) != EMPTY) {
      b->rasterFootprint.push_back({wx, wy, local});
      if (b->erosionBoundaryMask[local])
        b->rasterBoundaryFootprint.push_back({wx, wy, local});
    }
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
#include "rigid_fluid_domain.inc"
#include "rigid_fluid_projection.inc"
#include "rigid_fluid_solve.inc"
#include "rigid_fluid_writeback.inc"
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
  rigidSpillDisplaced += (int)displaced.size();
  (void)bodyDensity;
  // Spread displaced fluid sideways and downward before upward (lateral, down,
  // then up last) — same priority the component-body spill uses. A body plunging
  // into a pool then distributes the rise across the surface instead of firing a
  // narrow fountain straight up out of the entry column ("lava out the top").
  int offs[4] = {-1, 1, E.cols, -E.cols}; int gridLen = E.cols * E.rows;
  uint8_t footprintLiquid = EMPTY;
  bool mixedLiquidFootprint = false;
  auto noteFootprintLiquid = [&](uint8_t material) {
    if (!E.isLiquidMaterial(material)) return;
    if (footprintLiquid == EMPTY)
      footprintLiquid = material;
    else if (footprintLiquid != material)
      mixedLiquidFootprint = true;
  };
  for (const Disp& cell : displaced) noteFootprintLiquid(cell.material);
  int footprintMinX = E.cols, footprintMaxX = -1, footprintMaxY = -1;
  for (int k : edgeFootprint) {
    int y = k / E.cols, x = k - y * E.cols;
    footprintMinX = imin(footprintMinX, x);
    footprintMaxX = imax(footprintMaxX, x);
    footprintMaxY = imax(footprintMaxY, y);
    if (x > 0) noteFootprintLiquid(E.L->grid[k - 1]);
    if (x + 1 < E.cols) noteFootprintLiquid(E.L->grid[k + 1]);
    if (y > 0) noteFootprintLiquid(E.L->grid[k - E.cols]);
    if (y + 1 < E.rows) noteFootprintLiquid(E.L->grid[k + E.cols]);
  }
  for (int y = footprintMaxY + 1;
       y < E.rows && y <= footprintMaxY + R_FLUID_REFERENCE_SEARCH; y++)
    for (int x = footprintMinX; x <= footprintMaxX; x++)
      noteFootprintLiquid(E.L->grid[y * E.cols + x]);
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
  std::vector<int> footprintEdgeStarts;
  bool footprintEdgesBuilt = false;
  auto buildFootprintEdgeStarts = [&]() {
    if (footprintEdgesBuilt) return;
    footprintEdgesBuilt = true;
    int32_t edgeGen = ++E.L->seenGen;
    std::vector<int> sortedFootprint(
      edgeFootprint.begin(), edgeFootprint.end());
    std::sort(sortedFootprint.begin(), sortedFootprint.end());
    for (int k : sortedFootprint) for (int off : offs) {
      int nk = k + off;
      if (nk <= 0 || nk >= gridLen || E.L->seenStamp[nk] == edgeGen)
        continue;
      int y = nk / E.cols, x = nk - y * E.cols;
      if (x <= 0 || x >= E.cols - 1 || y <= 0 || y >= E.rows)
        continue;
      if (!seedPassable(E.L->grid[nk], nk)) continue;
      E.L->seenStamp[nk] = edgeGen;
      footprintEdgeStarts.push_back(nk);
    }
  };
  std::vector<int> preferredVacancies;
  if (vacated) {
    preferredVacancies.assign(vacated->begin(), vacated->end());
    std::sort(preferredVacancies.begin(), preferredVacancies.end());
  }
  // Intentionally batch by material: each density/material group gets one
  // multi-source BFS instead of clearing a queue and searching once per displaced
  // cell. Heavier groups run first so they claim spill targets before lighter
  // material; evicted lighter material is processed in later waves.
  std::vector<Disp> pending = displaced, nextPending;
  std::vector<int> queue, targets, surfaceTargets, fallbackTargets;
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
      queue.clear(); targets.clear(); surfaceTargets.clear();
      fallbackTargets.clear();
      // Exchange leading-edge displacement with the same body's trailing
      // vacancies before searching the wider pool. This keeps liquid wrapped
      // around a translating body instead of ejecting it to a distant free
      // surface and leaving an artificial dry wake.
      if (vacated) {
        for (int k : preferredVacancies) {
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
      if ((int)targets.size() < need) rigidSpillSearches++;
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
      if (queue.empty()) {
        buildFootprintEdgeStarts();
        for (int nk : footprintEdgeStarts) enqueue(nk);
      }
      int visitBudget = imin(gridLen, imax(4096, need * 128));
      int surfaceGoal = imax(64, need * 8);
      int visits = 0;
      for (size_t qi = 0; qi < queue.size() && (int)targets.size() < need
           && visits < visitBudget; qi++, visits++) {
        int k = queue[qi];
        if (isDropTarget(k, mat)) {
          // Liquid exits at a supported free-surface cell when one is reachable.
          // Dry cells bordering the body remain a volume-preserving fallback.
          bool dryLiquidOutlet = (mixedLiquidFootprint
              || DENSITY[mat] < DENSITY[WATER] - 1e-6)
            && E.isLiquidMaterial(mat)
            && E.L->grid[k] == EMPTY;
          bool hasLiquidBelow = k + E.cols < gridLen
            && !inFootprint(k + E.cols)
            && !E.isBodyCell(k + E.cols)
            && E.isLiquidMaterial(E.L->grid[k + E.cols]);
          if (dryLiquidOutlet) {
            if (hasLiquidBelow)
              surfaceTargets.push_back(k);
            else if ((int)fallbackTargets.size() < need)
              fallbackTargets.push_back(k);
            if ((int)surfaceTargets.size() >= surfaceGoal) break;
            continue;
          }
          E.L->rigidSpillReserved[k] = reservedGen;
          targets.push_back(k);
        }
        for (int off : offs) enqueue(k + off);
      }
      // Fill the lowest reachable surface row first, distributing a partial row
      // across its width so repeated body motion cannot build a narrow mound.
      std::sort(surfaceTargets.begin(), surfaceTargets.end(), [&](int a, int b) {
        int ay = a / E.cols, by = b / E.cols;
        return ay != by ? ay > by : a < b;
      });
      for (size_t first = 0; first < surfaceTargets.size()
           && (int)targets.size() < need;) {
        size_t last = first + 1;
        int row = surfaceTargets[first] / E.cols;
        while (last < surfaceTargets.size()
               && surfaceTargets[last] / E.cols == row)
          last++;
        int take = imin(need - (int)targets.size(), (int)(last - first));
        for (int i = 0; i < take; i++) {
          size_t offset = ((size_t)(i * 2 + 1) * (last - first))
                        / (size_t)(take * 2);
          int k = surfaceTargets[first + offset];
          E.L->rigidSpillReserved[k] = reservedGen;
          targets.push_back(k);
        }
        first = last;
      }
      for (int k : fallbackTargets) {
        if ((int)targets.size() >= need) break;
        E.L->rigidSpillReserved[k] = reservedGen;
        targets.push_back(k);
      }
      rigidSpillVisits += visits;
      int n = imin((int)targets.size(), need);
      for (int i = 0; i < n; i++) {
        int target = targets[i];
        uint8_t evicted = E.L->grid[target];
        if (evicted != EMPTY) nextPending.push_back({evicted, target});
        E.writeGridIndex(target, mat);
        // A spill target may be well outside the active material span. Mirror
        // it now so a later whole-buffer swap cannot discard that volume.
        E.L->next[target] = mat;
        E.L->nextFallSpeed[target] = 0;
        E.L->nextLiquidVel[target] = 0;
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

  Engine::ActiveLayerScope layerScope(E, E.L);
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
}
void RigidBodySystem::erodeBodies(std::vector<int>& cells) {
  if (cells.empty()) { E.L->bodyCells = cells; return; }
  std::unordered_map<int, Body*> bodyById; for (Body* b : E.L->bodies) bodyById[b->id] = b;
  std::unordered_set<Body*> dirty;
  std::vector<int> acidSmoke;
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2 || !body->erodible) continue;
    for (const BodyRasterCell& cell : body->rasterBoundaryFootprint) {
      int k = cell.y * E.cols + cell.x;
      if (E.L->bodyOwner[k] != body->id) continue;
      double p = rigidErodeProbabilityAt(k);
      if (p <= 0 || E.rand() >= p) continue;
      int x = cell.x, y = cell.y;
      bool byAcid = (x < E.cols - 1 && E.L->grid[k + 1] == ACID)
                 || (x > 0 && E.L->grid[k - 1] == ACID)
                 || (y < E.rows - 1 && E.L->grid[k + E.cols] == ACID)
                 || (y > 0 && E.L->grid[k - E.cols] == ACID);
      if (eraseBodyCellIndex(k, bodyById, dirty) && byAcid) {
        E.audio.noteAcidDissolve(x, y);
        if (E.rand() < ACRID_SMOKE_P) acidSmoke.push_back(k);
      }
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
    if (E.L->infinite && (x == 0 || x == E.cols - 1)) return;
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
bool RigidBodySystem::bodyFootprintOverlapsSolid(Body* b) {
  auto blockedIn = [&](Layer& layer, int k) {
    if (layer.bodyOwner[k] == b->id) return false;
    uint8_t material = layer.grid[k];
    return material != EMPTY && !E.isGasMaterial(material)
      && !E.isBuoyantMedium(material);
  };
  auto blockedBody = [&](Body* member) {
    forEachBodyCell(member, [](int, int, int) {});
    for (const BodyRasterCell& cell : member->rasterFootprint) {
      if (E.L->infinite && (cell.x == 0 || cell.x == E.cols - 1))
        continue;
      int k = cell.y * E.cols + cell.x;
      if (blockedIn(*E.L, k)
          || (b->jointRole == 1 && blockedIn(E.bg, k))) return true;
    }
    return false;
  };
  return blockedBody(b)
      || (b->jointRole == 1 && b->jointPeer && blockedBody(b->jointPeer));
}
int RigidBodySystem::bodyTerrainBlocked(Body* b) {
  int blocked = 0;
  forEachBodyCell(b, [&](int x, int y, int) {
    if (isBodyTerrain(b, x, y, b->density)) blocked++;
  });
  return blocked;
}
bool RigidBodySystem::sleepingBodyTouchesMovingLiquid(Body* b) {
  bool moving = false;
  int previousTick = E.tick - 1;
  auto movingLiquidAt = [&](int x, int y) {
    if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) return false;
    int k = y * E.cols + x;
    if (!E.isLiquidMaterial(E.L->grid[k])) return false;
    uint32_t packed = E.L->liquidVel[k];
    double vx = E.liquidVelocityX(packed);
    double vy = E.liquidVelocityY(packed);
    if (vx * vx + vy * vy >= R_FLUID_WAKE_LIN * R_FLUID_WAKE_LIN
        || E.L->fallSpeed[k] > 0
        || E.L->vacatedStamp[k] == previousTick)
      return true;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      int xx = x + ox, yy = y + oy;
      if (xx < 0 || xx >= E.cols || yy < 0 || yy >= E.rows) continue;
      if (E.L->vacatedStamp[yy * E.cols + xx] == previousTick) return true;
    }
    return false;
  };
  forEachBodyCell(b, [&](int x, int y, int) {
    if (moving) return;
    moving = movingLiquidAt(x - 1, y)
          || movingLiquidAt(x + 1, y)
          || movingLiquidAt(x, y - 1)
          || movingLiquidAt(x, y + 1);
  });
  return moving;
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
bool RigidBodySystem::findTerrainClearAdjustment(
    Body* b, double& dx, double& dy) {
  static constexpr double directions[16][2] = {
    {0, -1}, {-0.3826834323650898, -0.9238795325112867},
    {0.3826834323650898, -0.9238795325112867},
    {-0.7071067811865476, -0.7071067811865476},
    {0.7071067811865476, -0.7071067811865476},
    {-0.9238795325112867, -0.3826834323650898},
    {0.9238795325112867, -0.3826834323650898},
    {-1, 0}, {1, 0},
    {-0.9238795325112867, 0.3826834323650898},
    {0.9238795325112867, 0.3826834323650898},
    {-0.7071067811865476, 0.7071067811865476},
    {0.7071067811865476, 0.7071067811865476},
    {-0.3826834323650898, 0.9238795325112867},
    {0.3826834323650898, 0.9238795325112867},
    {0, 1},
  };
  const double savedPx = b->px, savedPy = b->py;
  auto place = [&](double ox, double oy) {
    b->px = savedPx + ox;
    b->py = savedPy + oy;
    if (b->jointRole == 1) syncJointFollower(b);
  };
  const double step = 0.125;
  auto clearAlong = [&](const double* direction) {
    for (double radius = step; radius <= 2.0 + 1e-9; radius += step) {
      place(direction[0] * radius, direction[1] * radius);
      if (bodyFootprintOverlapsSolid(b)) continue;
      double blockedRadius = radius - step;
      double clearRadius = radius;
      for (int iteration = 0; iteration < 6; iteration++) {
        double middle = (blockedRadius + clearRadius) * 0.5;
        place(direction[0] * middle, direction[1] * middle);
        if (!bodyFootprintOverlapsSolid(b)) clearRadius = middle;
        else blockedRadius = middle;
      }
      place(0, 0);
      dx = direction[0] * clearRadius;
      dy = direction[1] * clearRadius;
      return true;
    }
    place(0, 0);
    return false;
  };

  // Follow the blocking terrain's outward normal so raster clearance cannot
  // undo the solver's tangential travel along a slope.
  double normalX = 0, normalY = 0;
  occStamp.reset((size_t)E.cols * E.rows);
  auto accumulateNormal = [&](int x, int y, int) {
    int k = y * E.cols + x;
    if (occStamp.has(k)) return;
    occStamp.add(k);
    auto blockedIn = [&](Layer& layer) {
      if (layer.bodyOwner[k] == b->id) return false;
      uint8_t material = layer.grid[k];
      return material != EMPTY && !E.isGasMaterial(material)
        && !E.isBuoyantMedium(material);
    };
    if (!blockedIn(*E.L)
        && !(b->jointRole == 1 && blockedIn(E.bg))) return;
    double nx = 0, ny = 0;
    terrainNormalAt(b, x, y, b->density, nx, ny);
    normalX += nx;
    normalY += ny;
  };
  forEachBodyCell(b, accumulateNormal);
  if (b->jointRole == 1 && b->jointPeer)
    forEachBodyCell(b->jointPeer, accumulateNormal);
  double normalLength = std::hypot(normalX, normalY);
  if (normalLength > 1e-9) {
    normalX /= normalLength;
    normalY /= normalLength;
    std::array<int, 16> order;
    for (int i = 0; i < (int)order.size(); i++) order[i] = i;
    std::stable_sort(order.begin(), order.end(), [&](int a, int c) {
      double alignmentA = directions[a][0] * normalX
                        + directions[a][1] * normalY;
      double alignmentC = directions[c][0] * normalX
                        + directions[c][1] * normalY;
      return alignmentA > alignmentC;
    });
    for (int directionIndex : order)
      if (clearAlong(directions[directionIndex])) return true;
    dx = dy = 0;
    return false;
  }

  // A balanced obstruction has no reliable normal. Use the shortest local
  // translation without changing the solver's rotation.
  for (double radius = step; radius <= 2.0 + 1e-9; radius += step) {
    bool found = false;
    double bestRadius = radius, bestX = 0, bestY = 0;
    for (const auto& direction : directions) {
      place(direction[0] * radius, direction[1] * radius);
      if (bodyFootprintOverlapsSolid(b)) continue;
      double blockedRadius = radius - step;
      double clearRadius = radius;
      for (int iteration = 0; iteration < 6; iteration++) {
        double middle = (blockedRadius + clearRadius) * 0.5;
        place(direction[0] * middle, direction[1] * middle);
        if (!bodyFootprintOverlapsSolid(b)) clearRadius = middle;
        else blockedRadius = middle;
      }
      if (!found || clearRadius < bestRadius) {
        found = true;
        bestRadius = clearRadius;
        bestX = direction[0] * clearRadius;
        bestY = direction[1] * clearRadius;
      }
    }
    place(0, 0);
    if (!found) continue;
    dx = bestX;
    dy = bestY;
    return true;
  }
  place(0, 0);
  dx = dy = 0;
  return false;
}

// ===== Body material identity & solidify-on-rest =====
// (See the BODY-MATERIAL INVARIANT block in members.inc.) A free body stamps its
// real material into the grid; when a component-backed body's raster stays fixed
// it bakes into a normal static component here. RIGID bodies stay free forever.
void RigidBodySystem::bakeBodyToGrid(Body* b, int assemblyId) {
  // The body's cells were just cleared to EMPTY (moveBodies). Restore each
  // rasterized material. Each material stays an isolated component carrying the
  // same baked-assembly id, so support and cuts use the component graph without
  // merging the old body into adjacent same-material terrain.
  std::array<std::vector<int>, TABLE> baked;
  occStamp.reset((size_t)(E.cols * E.rows));
  occCells.clear();
  double rasterStart = emscripten_get_now();
  forEachBodyCell(b, [&](int x, int y, int local) {
    int k = y * E.cols + x;
    if (!occStamp.has(k)) { occStamp.add(k); occCells.push_back(k); }
    if (E.L->grid[k] != EMPTY && !E.componentDisplaceable(E.L->grid[k])) return; // never clobber solid terrain it came to rest against
    uint8_t material = bodyMaterialAt(b, local);
    if (material == EMPTY || material >= TABLE) return;
    if (E.L->grid[k] == EMPTY) {
      E.L->grid[k] = material;
      if (material == NEUTRONIUM) {
        E.L->forceSourcePresent = true;
        E.fg.forceWakePending = E.bg.forceWakePending = true;
      }
    } else {
      E.writeGridIndex(k, material);
    }
    baked[material].push_back(k);
    rigidBakedCells++;
  });
  rigidBakeRasterMs += emscripten_get_now() - rasterStart;
  double supportStart = emscripten_get_now();
  int solidBelow = 0, mediumBelow = 0;
  bool settledLooseSupport = false;
  const int offsets[4] = {-1, 1, -E.cols, E.cols};
  for (const BodyRasterCell& cell : b->rasterBoundaryFootprint) {
    int k = cell.y * E.cols + cell.x;
    int y = cell.y, x = cell.x;
    if (y + 1 >= E.rows) solidBelow++;
    else if (!occStamp.has(k + E.cols)) {
      uint8_t below = E.L->grid[k + E.cols];
      if (E.isBuoyantMedium(below)) mediumBelow++;
      else if (below != EMPTY && !E.isGasMaterial(below)) solidBelow++;
    }
    if (settledLooseSupport) continue;
    for (int offset : offsets) {
      if ((offset == -1 && x == 0) || (offset == 1 && x + 1 >= E.cols)
          || (offset == -E.cols && y == 0)
          || (offset == E.cols && y + 1 >= E.rows)) continue;
      int neighbor = k + offset;
      if (occStamp.has(neighbor) || E.L->bodyOwner[neighbor] >= 0
          || !E.isComponentMaterial(E.L->grid[neighbor])) continue;
      int componentId = E.L->cellComp[neighbor];
      if (componentId < 0 || componentId >= E.comps.compCount(*E.L)) continue;
      Comp* component = E.comps.compById(*E.L, componentId);
      if (component && component->settledBody
          && component->settledLooseSupport) {
        settledLooseSupport = true;
        break;
      }
    }
  }
  bool looseSupport = settledLooseSupport
    || (mediumBelow > 0 && mediumBelow > solidBelow);
  rigidBakeSupportMs += emscripten_get_now() - supportStart;
  double registerStart = emscripten_get_now();
  for (int material = 0; material < TABLE; material++) {
    if (baked[material].empty()) continue;
    E.comps.registerBakedCells((uint8_t)material, baked[material], assemblyId,
                               E.isIceMaterial(material), looseSupport);
  }
  rigidBakeRegisterMs += emscripten_get_now() - registerStart;
  if (b->fuseTicks > 0)
    for (int k : baked[TNT]) E.queueDetonation(k, b->fuseTicks);
}
// Every component material has a static representation. Generic RIGID has none
// and therefore remains a body.
bool RigidBodySystem::bodySolidifies(Body* b) {
  return E.bodySolidifiesToComponents(b);
}
// Baking is a structural transition, so an unchanged raster alone is insufficient:
// buoyancy can hold a floating body still with no terrain contact. Require a
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
bool RigidBodySystem::rasterStableForBake(Body* b) {
  forEachBodyCell(b, [](int, int, int) {});
  uint8_t sampleTag = (uint8_t)E.tick;
  if (b->bakeRasterSampleTag == sampleTag)
    return b->bakeRasterStableTicks >= R_BAKE_RASTER_TICKS;
  uint32_t signature = 2166136261u;
  for (const BodyRasterCell& cell : b->rasterFootprint) {
    signature ^= (uint32_t)(cell.y * E.cols + cell.x);
    signature *= 16777619u;
    signature ^= bodyMaterialAt(b, cell.local);
    signature *= 16777619u;
  }
  signature ^= (uint32_t)b->rasterFootprint.size();
  signature *= 16777619u;
  if (b->bakeRasterSignature == signature) {
    if (b->bakeRasterStableTicks < R_BAKE_RASTER_TICKS)
      b->bakeRasterStableTicks++;
  } else {
    b->bakeRasterSignature = signature;
    b->bakeRasterStableTicks = 1;
  }
  b->bakeRasterSampleTag = sampleTag;
  return b->bakeRasterStableTicks >= R_BAKE_RASTER_TICKS;
}
void RigidBodySystem::bakeRestingBodies() {
  bool liveTntBody = false;
  for (Body* b : E.L->bodies)
    if (E.bodyContainsMaterial(b, TNT)) { liveTntBody = true; break; }
  bool baked = false; std::vector<Body*> keep;
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) {
      keep.push_back(b);
      continue;
    }
    bool explosiveBody = b->blastDebris
      || (liveTntBody && E.bodyContainsMaterial(b, TNT));
    if ((liveTntBody || explosiveBody) && b->awake) {
      keep.push_back(b);
      continue;
    }
    bool rasterBakeCandidate = !b->awake || b->rasterMayOverlapSolid;
    if (b->jointRole == 1 && b->jointPeer)
      rasterBakeCandidate = rasterBakeCandidate
        || !b->jointPeer->awake || b->jointPeer->rasterMayOverlapSolid;
    if (!liveTntBody && !rasterBakeCandidate) {
      keep.push_back(b);
      continue;
    }
    bool stableRaster = liveTntBody || rasterStableForBake(b);
    bool peerStableRaster = true;
    if (!liveTntBody && b->jointRole == 1 && b->jointPeer) {
      Engine::ActiveLayerScope layerScope(E, &E.bg);
      peerStableRaster = rasterStableForBake(b->jointPeer);
    }
    bool canBake = bodyFullyInsideLoadedWindow(b)
      && stableRaster && peerStableRaster
      && bodySolidifies(b) && (!b->jointPeer || bodySolidifies(b->jointPeer));
    if (canBake && bodyFootprintOverlapsSolid(b)) canBake = false;
    bool groundedContact = canBake && bodyTouchesGroundedSolid(b);
    bool peerGroundedContact = false;
    if (canBake && b->jointRole == 1 && b->jointPeer) {
      Engine::ActiveLayerScope layerScope(E, &E.bg);
      peerGroundedContact = bodyTouchesGroundedSolid(b->jointPeer);
    }
    if (canBake && (groundedContact || peerGroundedContact)) {
      int assemblyId = E.nextBakedAssemblyId++;
      if (b->jointRole == 1 && b->jointPeer) {
        Body* follower = b->jointPeer;
        syncJointFollower(b);
        Engine::ActiveLayerScope layerScope(E, &E.fg);
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
  Engine::ActiveLayerScope layerScope(E, &E.bg);
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
  double bodyPhaseStart = emscripten_get_now();
  if (E.L == &E.fg) {
    rigidCoreMs = rigidClearMs = rigidDepenMs = rigidBakeMs = 0;
    rigidBakeSupportMs = rigidBakeRasterMs = rigidBakeRegisterMs = 0;
    rigidBakedCells = 0;
    rigidStampMs = rigidSpillMs = 0;
    rigidPrepareMs = rigidFinalizeMs = 0;
    rigidContactMs = rigidSolveMs = 0;
    rigidPairContactMs = rigidTerrainContactMs = 0;
    rigidMotionPrepMs = rigidIntegrateMs = 0;
    rigidStepPrepareMs = rigidContactSetupMs = rigidStepFinalizeMs = 0;
    rigidOccupancyBuildMs = rigidCadenceMs = 0;
    rigidFluidCoupleMs = 0;
    rigidFluidReferenceTotalMs = rigidFluidDomainTotalMs = 0;
    rigidFluidMatrixTotalMs = rigidFluidSolveTotalMs = 0;
    rigidFluidWritebackTotalMs = 0;
    rigidFluidNodesTotal = rigidFluidFacesTotal = 0;
    rigidFluidIterationsTotal = rigidFluidDryReferencesSkipped = 0;
  }
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
  bool hasPendingBakeRaster = false;
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    if (b->awake) hasAwakeBody = true;
    else hasSleepingBody = true;
    if (E.bodyNeedsBakeTick(E.L, b))
      hasPendingBakeRaster = true;
  }
  bool needsGroundRefresh = E.L->groundDirty || E.L->groundContentDirty || E.L->looseGroundDirty;
  auto awaitingStableBakeRaster = [&]() {
    bool awaiting = false;
    for (Body* b : E.L->bodies) {
      if (!E.bodyNeedsBakeTick(E.L, b)) continue;
      if (!rasterStableForBake(b)) awaiting = true;
      if (b->jointRole == 1 && b->jointPeer) {
        Engine::ActiveLayerScope layerScope(E, &E.bg);
        if (!rasterStableForBake(b->jointPeer)) awaiting = true;
      }
    }
    return awaiting;
  };
  if (!hasAwakeBody && hasPendingBakeRaster
      && !needsGroundRefresh && !E.L->sleepingBodySupportDirty
      && awaitingStableBakeRaster()) return;
  // Stable sleeping bodies remain stamped in the live grid. Support/topology
  // invalidation wakes this path even when the preceding grounding pass consumed
  // the source dirty flags.
  if (!hasAwakeBody && !hasPendingBakeRaster
      && !needsGroundRefresh && !E.L->sleepingBodySupportDirty) return;
  if (hasSleepingBody || needsGroundRefresh) {
    if (E.bgEnabled && (E.comps.jointGroundReady || E.comps.jointSupportValid)) {
      // joint stamps intact; body wake probes do not need a re-flood
    } else {
      E.comps.computeGrounded();
      if (E.bgEnabled) E.comps.jointDirty = true;
    }
  }
  // Revalidate sleeping bodies before their grid cells are cleared. Lost
  // support wakes a falling stack from the bottom up, while fresh liquid motion
  // wakes a fluid-supported body without disturbing rigidly grounded bodies.
  for (Body* b : E.L->bodies) if (b->jointRole != 2 && !b->awake) {
    if (!bodyFullyInsideLoadedWindow(b)) continue;
    bool movingLiquid = sleepingBodyTouchesMovingLiquid(b);
    if (!movingLiquid && b->jointRole == 1 && b->jointPeer) {
      Engine::ActiveLayerScope layerScope(E, &E.bg);
      movingLiquid = sleepingBodyTouchesMovingLiquid(b->jointPeer);
    }
    if (movingLiquid) {
      bool rigidlySupported = bodyTouchesGroundedSolid(b);
      if (!rigidlySupported && b->jointRole == 1 && b->jointPeer) {
        Engine::ActiveLayerScope layerScope(E, &E.bg);
        rigidlySupported = bodyTouchesGroundedSolid(b->jointPeer);
      }
      if (!rigidlySupported) {
        wakeBody(b);
        continue;
      }
    }
    bool supported = sleepingBodyHasSupport(b, 1.0);
    if (!supported && b->jointRole == 1 && b->jointPeer) {
      Engine::ActiveLayerScope layerScope(E, &E.bg);
      supported = sleepingBodyHasSupport(b->jointPeer, 1.0);
    }
    if (!supported) wakeBody(b);
  }
  E.L->sleepingBodySupportDirty = false;
  if (!hasAwakeBody && hasPendingBakeRaster) {
    bool wokeDuringSupportCheck = false;
    for (Body* b : E.L->bodies)
      if (b->jointRole != 2 && b->awake) { wokeDuringSupportCheck = true; break; }
    if (!wokeDuringSupportCheck && awaitingStableBakeRaster()) return;
  }
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
  bool rosterChanged = false;
  size_t simulatedBodyCount = 0;
  for (Body* b : E.L->bodies) if (b->jointRole != 2) {
    if (simulatedBodyCount >= moveBodyIds.size()
        || moveBodyIds[simulatedBodyCount] != b->id)
      rosterChanged = true;
    simulatedBodyCount++;
  }
  if (simulatedBodyCount != moveBodyIds.size()) rosterChanged = true;
  if (rosterChanged) {
    moveBodyIds.clear();
    moveBodySlotById.clear();
    moveBodyIds.reserve(simulatedBodyCount);
    moveBodySlotById.reserve(simulatedBodyCount * 2);
    for (Body* b : E.L->bodies) if (b->jointRole != 2) {
      int slot = (int)moveBodyIds.size();
      moveBodyIds.push_back(b->id);
      moveBodySlotById[b->id] = slot;
    }
    movePreviousFootprints.resize(simulatedBodyCount);
    moveDisplaced.resize(simulatedBodyCount);
    moveStamped.resize(simulatedBodyCount);
  }
  for (size_t slot = 0; slot < simulatedBodyCount; slot++) {
    movePreviousFootprints[slot].clear();
    moveDisplaced[slot].clear();
    moveStamped[slot].clear();
  }
  bool batchRasterRestore = E.L->bodyCells.size()
                         >= (size_t)R_BODY_RASTER_BATCH_THRESHOLD;
  if (batchRasterRestore) {
    size_t gridSize = (size_t)E.cols * E.rows;
    if (movePreviousMaterialGrid.size() != gridSize) {
      movePreviousMaterialGrid.assign(gridSize, EMPTY);
      movePreviousOwnerGrid.assign(gridSize, -1);
    }
  }
  double clearStart = emscripten_get_now();
  rigidPrepareMs = rigidPrepareMs + (clearStart - bodyPhaseStart);
  for (int k : E.L->bodyCells) {
    int owner = E.L->bodyOwner[k];
    auto slot = moveBodySlotById.find(owner);
    if (slot != moveBodySlotById.end())
      movePreviousFootprints[slot->second].push_back(k);
    if (batchRasterRestore) {
      movePreviousMaterialGrid[k] = E.L->grid[k];
      movePreviousOwnerGrid[k] = owner;
      E.L->grid[k] = EMPTY;
      E.L->fallSpeed[k] = 0;
      E.L->liquidVel[k] = 0;
      E.L->bodyOwner[k] = -1;
      E.markLayerSimCell(E.L, k);
    } else {
      if (E.isBodyCell(k)) E.writeGridIndex(k, EMPTY);
      E.L->bodyOwner[k] = -1;
    }
  }
  double clearElapsed = emscripten_get_now() - clearStart;
  rigidClearMs = rigidClearMs + clearElapsed;
  double coreStart = emscripten_get_now();
  rigidStep(1.0);
  double coreElapsed = emscripten_get_now() - coreStart;
  rigidCoreMs = rigidCoreMs + coreElapsed;
  rigidRejectedCells = 0; rigidDepenetrations = 0;
  rigidOwnershipConflicts = 0;
  rigidRecoveryBodies = 0;
  double depenStart = emscripten_get_now();
  terrainAdjustmentParents.resize(simulatedBodyCount);
  auto adjustmentRoot = [&](int slot) {
    int root = slot;
    while (terrainAdjustmentParents[root] != root)
      root = terrainAdjustmentParents[root];
    while (terrainAdjustmentParents[slot] != slot) {
      int next = terrainAdjustmentParents[slot];
      terrainAdjustmentParents[slot] = root;
      slot = next;
    }
    return root;
  };
  for (int slot = 0; slot < (int)simulatedBodyCount; slot++)
    terrainAdjustmentParents[slot] = slot;
  for (const auto& pair : terrainContactPairs) {
    auto first = moveBodySlotById.find(pair.first);
    auto second = moveBodySlotById.find(pair.second);
    if (first == moveBodySlotById.end()
        || second == moveBodySlotById.end())
      continue;
    int a = adjustmentRoot(first->second);
    int b = adjustmentRoot(second->second);
    if (a != b) terrainAdjustmentParents[b] = a;
  }
  std::vector<uint8_t> adjustmentRootActive(simulatedBodyCount, 0);
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2 || !body->rasterMayOverlapSolid) continue;
    int slot = moveBodySlotById.find(body->id)->second;
    adjustmentRootActive[adjustmentRoot(slot)] = 1;
  }
  // Translate a complete final-contact island together so terrain correction
  // cannot pull a resting stack apart. Material and bake lifetime are irrelevant.
  for (int pass = 0; pass < 8; pass++) {
    bool adjusted = false;
    for (Body* body : E.L->bodies) {
      if (body->jointRole == 2) continue;
      int slot = moveBodySlotById.find(body->id)->second;
      int root = adjustmentRoot(slot);
      if (!adjustmentRootActive[root]
          || !bodyFootprintOverlapsSolid(body)) continue;
      double dx = 0, dy = 0;
      if (!findTerrainClearAdjustment(body, dx, dy)) continue;
      for (Body* member : E.L->bodies) {
        if (member->jointRole == 2) continue;
        int memberSlot = moveBodySlotById.find(member->id)->second;
        if (adjustmentRoot(memberSlot) != root) continue;
        member->px += dx;
        member->py += dy;
        if (member->jointRole == 1) syncJointFollower(member);
      }
      rigidDepenetrations++;
      adjusted = true;
      break;
    }
    if (!adjusted) break;
  }
  for (Body* body : E.L->bodies) {
    if (body->jointRole == 2) continue;
    int slot = moveBodySlotById.find(body->id)->second;
    if (!adjustmentRootActive[adjustmentRoot(slot)]
        || !bodyFootprintOverlapsSolid(body)) continue;
    body->awake = true;
    body->stillTicks = 0;
  }
  double depenElapsed = emscripten_get_now() - depenStart;
  rigidDepenMs = rigidDepenMs + depenElapsed;
  double bakeStart = emscripten_get_now();
  bakeRestingBodies(); // a component-backed body with a stable raster becomes static
  rigidBakeMs = rigidBakeMs + (emscripten_get_now() - bakeStart);
  moveCells.clear();
  moveFootprint.clear();
  double stampStart = emscripten_get_now();
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    int slot = moveBodySlotById.find(b->id)->second;
    std::vector<Disp>& displaced = moveDisplaced[slot];
    std::vector<int>& stamped = moveStamped[slot];
    forEachBodyCell(b, [&](int x, int y, int local) {
      int k = y * E.cols + x;
      int owner = E.L->bodyOwner[k];
      uint8_t material = bodyMaterialAt(b, local);
      if (batchRasterRestore && owner == -1 && E.L->grid[k] == EMPTY
          && movePreviousOwnerGrid[k] == b->id
          && movePreviousMaterialGrid[k] == material) {
        E.L->grid[k] = material;
        E.L->fallSpeed[k] = 0;
        E.L->liquidVel[k] = 0;
        E.L->bodyOwner[k] = b->id;
        if (material == NEUTRONIUM) {
          E.L->forceSourcePresent = true;
          E.fg.forceWakePending = E.bg.forceWakePending = true;
        }
        E.noteLooseGroundTouch2At(k, material, EMPTY);
        if (material == FIRE || material == LAVA)
          E.L->heatAddedAfterPrepare = true;
        if (b->blastDebris) E.L->groundedCell[k] = 0;
        moveCells.push_back(k);
        moveFootprint.push_back(k);
        stamped.push_back(k);
        return;
      }
      if (owner != -1) {
        rigidOwnershipConflicts++;
        return;
      }
      uint8_t m = E.L->grid[k];
      if (!canBodyOccupy(m, k, b->density)) { rigidRejectedCells++; return; }
      if (isBodyRelocatable(m, k, b->density)) displaced.push_back({m, k});
      E.writeGridIndex(k, material); E.L->bodyOwner[k] = b->id;
      if (b->blastDebris) E.L->groundedCell[k] = 0;
      moveCells.push_back(k); moveFootprint.push_back(k); stamped.push_back(k); // body-material invariant: stamp the body's REAL material so it renders/mines/reacts as that material
    });
  }
  if (batchRasterRestore)
    for (int k : E.L->bodyCells) {
      if (E.L->grid[k] != movePreviousMaterialGrid[k]
          || E.L->bodyOwner[k] != movePreviousOwnerGrid[k])
        E.markCellIndex(k);
      movePreviousMaterialGrid[k] = EMPTY;
      movePreviousOwnerGrid[k] = -1;
    }
  double stampElapsed = emscripten_get_now() - stampStart;
  rigidStampMs = rigidStampMs + stampElapsed;
  {
    std::vector<Body*> keep;
    keep.reserve(E.L->bodies.size());
    for (Body* b : E.L->bodies) {
      if (b->jointRole == 2) { keep.push_back(b); continue; }
      int slot = moveBodySlotById.find(b->id)->second;
      if (moveStamped[slot].empty()) {
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
  for (int k : moveFootprint) E.L->rigidSpillFootprint[k] = footprintGen;
  double spillStart = emscripten_get_now();
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    int slot = moveBodySlotById.find(b->id)->second;
    const std::vector<int>* vacated = movePreviousFootprints[slot].empty()
      ? nullptr : &movePreviousFootprints[slot];
    spillDisplacedBodyMaterial(moveDisplaced[slot], moveStamped[slot],
                               footprintGen, b->id, b->density, vacated);
  }
  double spillElapsed = emscripten_get_now() - spillStart;
  rigidSpillMs = rigidSpillMs + spillElapsed;
  double finalizeStart = emscripten_get_now();
  if (E.L == &E.fg) {
    // Joint erosion rebuilds pieces from the two live owner rasters. Restore
    // the follower before acid/fire can erase the leader so the splitter sees
    // both layer maps instead of interpreting the temporarily-cleared
    // background footprint as a foreground-only body.
    std::vector<Body*> leaders;
    for (Body* b : E.fg.bodies) if (b->jointRole == 1) leaders.push_back(b);
    for (Body* leader : leaders) stampJointFollower(leader);
  }
  erodeBodies(moveCells);
  rigidFinalizeMs = rigidFinalizeMs
                  + (emscripten_get_now() - finalizeStart);
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
    if (!bodyFullyInsideLoadedWindow(it->second)) return false;
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
      if (!bodyFullyInsideLoadedWindow(nextIt->second)) return false;
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
  Engine::ActiveLayerScope layerScope(E, plan.layer);
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
}

void RigidBodySystem::collectPlacementTouchingBodyIds(
    const std::vector<std::pair<int, int>>& cells,
    std::unordered_set<int>& touchingIds) {
  Layer* peer = E.bgEnabled ? (E.L == &E.fg ? &E.bg : &E.fg) : nullptr;
  std::unordered_map<int, Body*> peerById;
  if (peer) {
    peerById.reserve(peer->bodies.size() * 2);
    for (Body* body : peer->bodies) peerById[body->id] = body;
  }
  auto addPeerJoint = [&](int owner) {
    auto found = peerById.find(owner);
    if (found == peerById.end()) return;
    Body* member = found->second;
    if (!member->jointRole || !member->jointPeer) return;
    touchingIds.insert(member->jointPeer->id);
  };
  int minX = E.cols, minY = E.rows, maxX = -1, maxY = -1;
  for (const auto& cell : cells) {
    if (cell.first < 0 || cell.first >= E.cols
        || cell.second < 0 || cell.second >= E.rows) continue;
    minX = imin(minX, cell.first); minY = imin(minY, cell.second);
    maxX = imax(maxX, cell.first); maxY = imax(maxY, cell.second);
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      int x = cell.first + ox, y = cell.second + oy;
      if (x < 0 || x >= E.cols || y < 0 || y >= E.rows) continue;
      int k = y * E.cols + x;
      int owner = E.L->bodyOwner[k];
      if (owner >= 0) touchingIds.insert(owner);
      if (peer && peer->bodyOwner[k] >= 0)
        addPeerJoint(peer->bodyOwner[k]);
    }
  }
  if (maxX < minX || maxY < minY) return;
  auto addContinuousContacts = [&](const std::vector<Body*>& bodies,
                                   bool peerJointsOnly) {
    for (Body* member : bodies) {
      if (peerJointsOnly && (!member->jointRole || !member->jointPeer)) continue;
      Body* activeMember = peerJointsOnly ? member->jointPeer : member;
      if (touchingIds.count(activeMember->id)) continue;
      double closestX = std::fmax(minX + 0.5,
        std::fmin(member->px, maxX + 0.5));
      double closestY = std::fmax(minY + 0.5,
        std::fmin(member->py, maxY + 0.5));
      double dx = closestX - member->px, dy = closestY - member->py;
      double reach = member->maxR + 1.0;
      if (dx * dx + dy * dy > reach * reach) continue;
      member->cs = std::cos(member->angle);
      member->sn = std::sin(member->angle);
      for (const auto& cell : cells) {
        if (insideBodyIndex(member, cell.first + 0.5, cell.second + 0.5) < 0)
          continue;
        touchingIds.insert(activeMember->id);
        break;
      }
    }
  };
  addContinuousContacts(E.L->bodies, false);
  if (peer) addContinuousContacts(peer->bodies, true);
}

bool RigidBodySystem::placementTouchesBody(
    const std::vector<std::pair<int, int>>& cells) {
  std::unordered_set<int> touchingIds;
  collectPlacementTouchingBodyIds(cells, touchingIds);
  return !touchingIds.empty();
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
  if (attachTouchingBodies)
    collectPlacementTouchingBodyIds(spawnCells, touchingIds);

  std::vector<Body*> touching;
  bool touchesJoint = false;
  if (!touchingIds.empty()) {
    for (Body* body : E.L->bodies)
      if (touchingIds.count(body->id)) {
        touching.push_back(body);
        touchesJoint = touchesJoint || body->jointRole != 0;
      }
    std::sort(touching.begin(), touching.end(),
              [](Body* a, Body* b) { return a->id < b->id; });
  }

  Layer* placementLayer = E.L;
  Body* body = nullptr;
  if (touching.empty()) {
    body = spawnBodyImpl(spawnCells, material, DENSITY[material]);
  } else if (touchesJoint) {
    // Preserve the two-layer object when a placement welds to either half.
    // This path is placement-only; ordinary single-layer welds retain the
    // smaller layer-local merge below.
    std::map<int, uint8_t> activeMaterialAt, peerMaterialAt;
    std::array<std::unordered_set<int>, 2> removedIds;
    std::array<std::unordered_set<Body*>, 2> removedBodies;
    int activeLayer = placementLayer == &E.bg ? 1 : 0;
    int peerLayer = 1 - activeLayer;
    double momentumX = 0, momentumY = 0, spin = 0;
    int fuseTicks = 0;
    auto collectRaster = [&](Body* source, std::map<int, uint8_t>& materialAt) {
      forEachBodyCell(source, [&](int x, int y, int local) {
        materialAt.emplace(y * E.cols + x, bodyMaterialAt(source, local));
      });
    };
    for (Body* source : touching) {
      Body* physical = source->jointRole == 2 ? source->jointPeer : source;
      double mass = physical && physical->invMass > 0
        ? 1.0 / physical->invMass : 0;
      if (physical) {
        momentumX += physical->vx * mass;
        momentumY += physical->vy * mass;
        spin += physical->omega * mass;
        if (physical->fuseTicks > 0
            && (!fuseTicks || physical->fuseTicks < fuseTicks))
          fuseTicks = physical->fuseTicks;
      }
      collectRaster(source, activeMaterialAt);
      removedIds[activeLayer].insert(source->id);
      removedBodies[activeLayer].insert(source);
      if (source->jointRole && source->jointPeer) {
        collectRaster(source->jointPeer, peerMaterialAt);
        removedIds[peerLayer].insert(source->jointPeer->id);
        removedBodies[peerLayer].insert(source->jointPeer);
      }
    }
    for (const auto& cell : spawnCells)
      activeMaterialAt[cell.second * E.cols + cell.first] = material;

    auto clearRemoved = [&](Layer& layer, int layerIndex) {
      Engine::ActiveLayerScope layerScope(E, &layer);
      auto clearCells = [&](std::vector<int>& cells) {
        std::vector<int> kept;
        kept.reserve(cells.size());
        for (int k : cells) {
          if (k >= 0 && k < E.cols * E.rows
              && removedIds[layerIndex].count(layer.bodyOwner[k])) {
            E.writeGridIndex(k, EMPTY);
            layer.bodyOwner[k] = -1;
          } else {
            kept.push_back(k);
          }
        }
        cells = std::move(kept);
      };
      clearCells(layer.bodyCells);
      clearCells(layer.passiveBodyCells);
      for (Body* removed : removedBodies[layerIndex])
        if (removed->jointRole == 2) layer.passiveBodyIds.erase(removed->id);
      std::vector<Body*> kept;
      kept.reserve(layer.bodies.size());
      for (Body* candidate : layer.bodies)
        if (!removedBodies[layerIndex].count(candidate)) kept.push_back(candidate);
      layer.bodies = std::move(kept);
    };
    clearRemoved(E.fg, 0);
    clearRemoved(E.bg, 1);
    std::unordered_set<Body*> deleted;
    for (const auto& layerBodies : removedBodies)
      for (Body* removed : layerBodies)
        if (deleted.insert(removed).second) delete removed;

    auto unpack = [&](const std::map<int, uint8_t>& materialAt,
                      std::vector<std::pair<int, int>>& cells,
                      std::vector<uint8_t>& materials) {
      cells.reserve(materialAt.size());
      materials.reserve(materialAt.size());
      for (const auto& entry : materialAt) {
        cells.push_back({entry.first % E.cols, entry.first / E.cols});
        materials.push_back(entry.second);
      }
    };
    std::vector<std::pair<int, int>> activeCells, peerCells;
    std::vector<uint8_t> activeMaterials, peerMaterials;
    unpack(activeMaterialAt, activeCells, activeMaterials);
    unpack(peerMaterialAt, peerCells, peerMaterials);
    Body* leader = placementLayer == &E.fg
      ? spawnJointBodyImpl(activeCells, activeMaterials,
                           peerCells, peerMaterials)
      : spawnJointBodyImpl(peerCells, peerMaterials,
                           activeCells, activeMaterials);
    if (leader && leader->jointPeer) {
      double totalMass = leader->invMass > 0 ? 1.0 / leader->invMass : 0;
      if (totalMass > 0) {
        leader->vx = momentumX / totalMass;
        leader->vy = momentumY / totalMass;
        leader->omega = spin / totalMass;
      }
      leader->blastDebris = false;
      leader->fuseTicks = fuseTicks;
      leader->jointPeer->blastDebris = false;
      leader->jointPeer->fuseTicks = fuseTicks;
      syncJointFollower(leader);
      body = leader;
    }
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
  auto stampSpawned = [&](Layer& layer, Body* spawned, bool passive) {
    Engine::ActiveLayerScope layerScope(E, &layer);
    int minX = E.cols - 1, minY = E.rows - 1, maxX = 0, maxY = 0;
    std::vector<Disp> displaced;
    std::vector<int> footprint;
    forEachBodyCell(spawned, [&](int x, int y, int local) {
      int k = y * E.cols + x;
      if (layer.bodyOwner[k] >= 0 && layer.bodyOwner[k] != spawned->id) return;
      uint8_t existing = layer.grid[k];
      if (!canBodyOccupy(existing, k, spawned->density)) return;
      if (isBodyRelocatable(existing, k, spawned->density))
        displaced.push_back({existing, k});
      E.writeGridIndex(k, bodyMaterialAt(spawned, local));
      layer.bodyOwner[k] = spawned->id;
      (passive ? layer.passiveBodyCells : layer.bodyCells).push_back(k);
      footprint.push_back(k);
      minX = imin(minX, x); minY = imin(minY, y);
      maxX = imax(maxX, x); maxY = imax(maxY, y);
    });
    if (!footprint.empty()) {
      int32_t footprintGen = ++layer.seenGen;
      for (int k : footprint) layer.rigidSpillFootprint[k] = footprintGen;
      spillDisplacedBodyMaterial(displaced, footprint, footprintGen,
                                 spawned->id, spawned->density);
      E.markDirtyRect(minX, minY, maxX, maxY);
    }
    layer.sleepingBodySupportDirty = true;
  };
  Body* result = body;
  if (body->jointRole == 1 && body->jointPeer) {
    stampSpawned(E.fg, body, false);
    stampSpawned(E.bg, body->jointPeer, true);
    result = placementLayer == &E.fg ? body : body->jointPeer;
  } else {
    stampSpawned(*placementLayer, body, false);
  }
  if (E.bgEnabled) {
    E.comps.jointDirty = true;
    E.comps.jointBondsInvalid = true;
    E.comps.jointSupportValid = false;
  }
  return result;
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
