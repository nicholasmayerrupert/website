// Free rigid bodies and component-to-body conversion.
//
// Components are grid-anchored while bodies are moving entities. This file owns
// body geometry, integration, collision sampling, and stamping settled bodies
// back into component-aware grid state.
void RigidBodySystem::worldPoint(Body* b, int i, double sn, double cs, double& ox, double& oy) {
  double lx = b->points[i * 2], ly = b->points[i * 2 + 1];
  ox = b->px + lx * cs - ly * sn; oy = b->py + lx * sn + ly * cs;
}
uint8_t RigidBodySystem::bodyMaterialAt(Body* b, int localIndex) {
  if (localIndex < 0 || localIndex >= (int)b->occ.size() || !b->occ[localIndex]) return EMPTY;
  return b->cellMaterials.empty() ? b->material : b->cellMaterials[localIndex];
}
bool RigidBodySystem::computeDerived(Body* b, bool preserveWorld) {
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
  b->points.assign((size_t)nPts * 2, 0.f); b->boundaryPts.clear(); b->boundarySamples.clear();
  int pi = 0; double inertia = 0, maxR2 = 0;
  auto filled = [&](int ii, int jj) { return ii >= 0 && ii < b->w && jj >= 0 && jj < b->h && b->occ[jj * b->w + ii]; };
  auto addSample = [&](double sx, double sy) { b->boundarySamples.push_back((float)sx); b->boundarySamples.push_back((float)sy); };
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
    }
    pi++;
  }
  double mass = b->cellMaterials.empty() && !b->jointRole ? b->density * nPts : totalMass;
  if (!b->cellMaterials.empty() || b->jointRole) b->density = mass / nPts;
  b->nPts = nPts; b->invMass = mass > 0 ? 1 / mass : 0; b->invInertia = inertia > 0 ? 1 / inertia : 0;
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
  if (nx == 0 && ny == 0) { ox = 0; oy = -1; return; }
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
  if (nlx == 0 && nly == 0) { double rx = wx - b->px, ry = wy - b->py; double rl = std::sqrt(rx * rx + ry * ry); if (rl > 0) { ox = rx / rl; oy = ry / rl; } else { ox = 0; oy = -1; } return; }
  double wx2 = nlx * b->cs - nly * b->sn, wy2 = nlx * b->sn + nly * b->cs;
  double inv = 1 / std::sqrt(wx2 * wx2 + wy2 * wy2); ox = wx2 * inv; oy = wy2 * inv;
}
double RigidBodySystem::resolveContact(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double aInvM = A->awake ? A->invMass : 0, aInvI = A->awake ? A->invInertia : 0;
  double bInvM = (B && B->awake) ? B->invMass : 0, bInvI = (B && B->awake) ? B->invInertia : 0;
  double rvx = A->vx - A->omega * c.ray, rvy = A->vy + A->omega * c.rax;
  if (B) { rvx -= B->vx - B->omega * c.rby; rvy -= B->vy + B->omega * c.rbx; }
  double vn = rvx * c.nx + rvy * c.ny;
  double rnA = c.rax * c.ny - c.ray * c.nx, rnB = B ? c.rbx * c.ny - c.rby * c.nx : 0;
  double denom = aInvM + bInvM + aInvI * rnA * rnA + bInvI * rnB * rnB;
  double movedN = 0, movedT = 0;
  if (denom > 0) {
    double delta = (c.targetVn - vn) / denom;
    double newJn = c.accJn + delta; if (newJn < 0) newJn = 0;
    double applied = newJn - c.accJn; c.accJn = newJn;
    movedN = std::fabs(applied);
    double jx = applied * c.nx, jy = applied * c.ny;
    A->vx += jx * aInvM; A->vy += jy * aInvM; A->omega += aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B->vx -= jx * bInvM; B->vy -= jy * bInvM; B->omega -= bInvI * (c.rbx * jy - c.rby * jx); }
  }
  double tx = -c.ny, ty = c.nx;
  double rtvx = A->vx - A->omega * c.ray, rtvy = A->vy + A->omega * c.rax;
  if (B) { rtvx -= B->vx - B->omega * c.rby; rtvy -= B->vy + B->omega * c.rbx; }
  double vt = rtvx * tx + rtvy * ty;
  double rtA = c.rax * ty - c.ray * tx, rtB = B ? c.rbx * ty - c.rby * tx : 0;
  double denomT = aInvM + bInvM + aInvI * rtA * rtA + bInvI * rtB * rtB;
  if (denomT > 0) {
    double maxF = R_FRICTION * c.accJn, delta = -vt / denomT;
    double newJt = c.accJt + delta; if (newJt > maxF) newJt = maxF; else if (newJt < -maxF) newJt = -maxF;
    double applied = newJt - c.accJt; c.accJt = newJt;
    movedT = std::fabs(applied);
    double jx = applied * tx, jy = applied * ty;
    A->vx += jx * aInvM; A->vy += jy * aInvM; A->omega += aInvI * (c.rax * jy - c.ray * jx);
    if (B) { B->vx -= jx * bInvM; B->vy -= jy * bInvM; B->omega -= bInvI * (c.rbx * jy - c.rby * jx); }
  }
  return movedN + movedT;
}
double RigidBodySystem::resolveBias(Contact& c) {
  Body* A = c.a; Body* B = c.b;
  double bias = R_BAUMGARTE * std::fmax(0.0, c.depth - R_PEN_SLOP);
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
  double rnA = c.rax * c.ny - c.ray * c.nx, rnB = B ? c.rbx * c.ny - c.rby * c.nx : 0;
  double denom = aInvM + bInvM + aInvI * rnA * rnA + bInvI * rnB * rnB; if (denom <= 0) return 0;
  double delta = (bias - vn) / denom;
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
  std::vector<Body*> solverBodies;
  solverBodies.reserve(E.L->bodies.size());
  for (Body* body : E.L->bodies)
    if (body->jointRole != 2) solverBodies.push_back(body);
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
    if (body->awake) body->vy += R_GRAVITY * tickDt;
    predictedLiquidVy[bi] = body->vy;
    body->cs = std::cos(body->angle);
    body->sn = std::sin(body->angle);
    body->hadContact = false;
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
  // Substep count is driven by the fastest *point* on any body — linear speed
  // plus angular tip speed (|omega|*radius) — not just the centre velocity, so
  // a slowly-translating but fast-spinning bar still gets enough substeps that
  // its tip moves only a fraction of a cell per substep (no endpoint tunnelling).
  double maxPointSpeed = 0;
  for (Body* b : solverBodies) {
    if (!b->awake) continue;
    double lin = std::sqrt(b->vx * b->vx + b->vy * b->vy);
    double pt = lin + std::fabs(b->omega) * (b->maxR > 0 ? b->maxR : 1);
    if (pt > maxPointSpeed) maxPointSpeed = pt;
  }
  maxPointSpeed += R_GRAVITY * tickDt;
  int substeps = (int)std::ceil(maxPointSpeed / R_SAFE_SUBSTEP); if (substeps < 1) substeps = 1; if (substeps > R_MAX_SUBSTEPS) substeps = R_MAX_SUBSTEPS;
  int solverIters = R_BLAST_DEBRIS_SOLVER_ITERS;
  for (Body* b : solverBodies) if (!b->blastDebris) { solverIters = R_SOLVER_ITERS; break; }
  std::vector<Contact> contacts; int nc = 0;
  std::vector<uint8_t> actorSweepOverlap(n, 0);
  std::vector<uint8_t> solidContact(n, 0);
  struct PenPt { double wx, wy, nx, ny, depth; int bk; };
  struct TerrainGroup { Body* peer; std::vector<PenPt> points; };
  std::vector<PenPt> penAcc, terrAcc;
  std::vector<Body*> terrPeers;
  std::vector<TerrainGroup> terrGroups;
  std::vector<int> broadphaseOrder(n);
  std::vector<std::pair<int, int>> broadphasePairs;
  broadphasePairs.reserve((size_t)n * 4);
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
  for (int sub = 0; sub < substeps; sub++) {
    double dt = tickDt / substeps;
    std::fill(solidContact.begin(), solidContact.end(), 0);
    for (int bi = 0; bi < n; bi++) {
      Body* b = solverBodies[bi];
      if (b->awake) b->vy += R_GRAVITY * dt;
      b->cs = std::cos(b->angle);
      b->sn = std::sin(b->angle);
      b->pvx = 0; b->pvy = 0; b->pw = 0;
      b->hadContact = liquidContact[bi] != 0;
      b->maxDepth = 0; b->idx = bi;
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
          b->vy -= R_GRAVITY * powderSupport * dt;
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
      double cs = b->cs, sn = b->sn;
      double lx0 = b->offsetX - 0.5, lx1 = b->offsetX + b->w - 0.5, ly0 = b->offsetY - 0.5, ly1 = b->offsetY + b->h - 0.5;
      double x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
      auto corner = [&](double lx, double ly) { double wx = b->px + lx * cs - ly * sn, wy = b->py + lx * sn + ly * cs; if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy; };
      corner(lx0, ly0); corner(lx1, ly0); corner(lx1, ly1); corner(lx0, ly1);
      // Expand the broad-phase AABB by this body's per-substep reach (point speed
      // travelled this substep + contact skin) so a swept sample that starts just
      // outside the static AABB but moves into the pair this substep is not pruned.
      b->sweepMargin = (std::sqrt(b->vx * b->vx + b->vy * b->vy) + std::fabs(b->omega) * (b->maxR > 0 ? b->maxR : 1)) * dt + R_CONTACT_SKIN + 0.5;
      double m = b->sweepMargin;
      b->aabbX0 = x0 - m; b->aabbY0 = y0 - m; b->aabbX1 = x1 + m; b->aabbY1 = y1 + m;
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
    auto penDepth = [&](Body* T, double wx, double wy, double nx, double ny) { double d = 0.5, mx = wx, my = wy; for (int s = 0; s < 4; s++) { mx += nx; my += ny; if (insideBodyIndex(T, mx, my) < 0) break; d += 1; } return d; };
    // Swept body-to-body sampling: for each exposed boundary sample of P, either
    // record an existing penetration (t=0) or march the sample's per-substep
    // RELATIVE path (P's point velocity minus T's velocity at that point) through
    // T's occupancy mask and record the first impact. The contact normal is taken
    // from T's mask surface (bodyNormalAt), oriented from B toward A via `sign`,
    // never a centre-to-centre direction. This stops a sample crossing from one
    // side of a thin body to the other without generating a contact.
    auto collectSweep = [&](Body* P, Body* T, double sign, double dt) {
      const std::vector<float>& S = P->boundarySamples; double pm = P->sweepMargin;
      for (size_t si = 0; si + 1 < S.size(); si += 2) {
        double lx = S[si], ly = S[si + 1];
        double sx = P->px + lx * P->cs - ly * P->sn, sy = P->py + lx * P->sn + ly * P->cs;
        if (sx < T->aabbX0 - pm || sx > T->aabbX1 + pm || sy < T->aabbY0 - pm || sy > T->aabbY1 + pm) continue;
        int idx0 = insideBodyIndex(T, sx, sy);
        if (idx0 >= 0) {
          bodyNormalAt(T, idx0, sx, sy, nx_, ny_);
          penAcc.push_back({
            sx, sy, nx_ * sign, ny_ * sign,
            penDepth(T, sx, sy, nx_, ny_), 0,
          });
          continue;
        }
        double rPx = sx - P->px, rPy = sy - P->py, rTx = sx - T->px, rTy = sy - T->py;
        double mvx = ((P->vx - P->omega * rPy) - (T->vx - T->omega * rTy)) * dt;
        double mvy = ((P->vy + P->omega * rPx) - (T->vy + T->omega * rTx)) * dt;
        double mlen = std::sqrt(mvx * mvx + mvy * mvy);
        if (mlen < 1e-9) continue;
        double dirx = mvx / mlen, diry = mvy / mlen, total = mlen + R_CONTACT_SKIN;
        int steps = (int)std::ceil(total / R_SWEEP_STEP); if (steps < 1) steps = 1;
        for (int k = 1; k <= steps; k++) {
          double dk = total * (double)k / steps;
          if (insideBodyIndex(T, sx + dirx * dk, sy + diry * dk) < 0) continue;
          double a = total * (double)(k - 1) / steps, bb = dk;
          for (int it = 0; it < 6; it++) { double mm = (a + bb) * 0.5; if (insideBodyIndex(T, sx + dirx * mm, sy + diry * mm) >= 0) bb = mm; else a = mm; }
          double hx = sx + dirx * bb, hy = sy + diry * bb; int hidx = insideBodyIndex(T, hx, hy);
          if (hidx < 0) { hx = sx + dirx * dk; hy = sy + diry * dk; hidx = insideBodyIndex(T, hx, hy); }
          if (hidx < 0) break;
          bodyNormalAt(T, hidx, hx, hy, nx_, ny_);
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
        double rx = sx - b->px, ry = sy - b->py;
        double mvx = (b->vx - b->omega * ry) * dt, mvy = (b->vy + b->omega * rx) * dt;
        double mlen = std::sqrt(mvx * mvx + mvy * mvy);
        if (mlen < 1e-9) continue;
        double dirx = mvx / mlen, diry = mvy / mlen, total = mlen + R_CONTACT_SKIN;
        int steps = (int)std::ceil(total / R_SWEEP_STEP); if (steps < 1) steps = 1;
        for (int k = 1; k <= steps; k++) {
          double dk = total * (double)k / steps;
          if (!solid((int)std::floor(sx + dirx * dk), (int)std::floor(sy + diry * dk))) continue;
          double a = total * (double)(k - 1) / steps, bb = dk;
          for (int it = 0; it < 6; it++) { double mm = (a + bb) * 0.5; if (solid((int)std::floor(sx + dirx * mm), (int)std::floor(sy + diry * mm))) bb = mm; else a = mm; }
          double hx = sx + dirx * bb, hy = sy + diry * bb; int hxx = (int)std::floor(hx), hyy = (int)std::floor(hy);
          if (!solid(hxx, hyy)) { hx = sx + dirx * dk; hy = sy + diry * dk; hxx = (int)std::floor(hx); hyy = (int)std::floor(hy); }
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
    auto reduceManifold = [&](std::vector<PenPt>& acc, Body* A, Body* B, double fbx, double fby) {
      if (acc.empty()) return;
      int bIndex = B && B->idx >= 0 && B->idx < n
        && solverBodies[B->idx] == B ? B->idx : -1;
      const double Q = 8.0 / (2.0 * M_PI);
      double snx[8] = {0}, sny[8] = {0}; int cnt[8] = {0};
      for (auto& p : acc) { int bk = ((int)std::lround(std::atan2(p.ny, p.nx) * Q)) & 7; p.bk = bk; snx[bk] += p.nx; sny[bk] += p.ny; cnt[bk]++; }
      double Nx[8], Ny[8], tx[8], ty[8], loP[8], hiP[8]; PenPt* lo[8] = {nullptr}; PenPt* hi[8] = {nullptr};
      for (int bk = 0; bk < 8; bk++) {
        if (!cnt[bk]) continue;
        double nl = std::sqrt(snx[bk] * snx[bk] + sny[bk] * sny[bk]);
        if (nl < 1e-6) { Nx[bk] = fbx; Ny[bk] = fby; } else { Nx[bk] = snx[bk] / nl; Ny[bk] = sny[bk] / nl; }
        tx[bk] = -Ny[bk]; ty[bk] = Nx[bk]; loP[bk] = 1e18; hiP[bk] = -1e18;
      }
      for (auto& p : acc) { int bk = p.bk; double pr = p.wx * tx[bk] + p.wy * ty[bk]; if (pr < loP[bk]) { loP[bk] = pr; lo[bk] = &p; } if (pr > hiP[bk]) { hiP[bk] = pr; hi[bk] = &p; } }
      auto push = [&](PenPt* p, int bk) {
        if (!p) return;
        double rax = p->wx - A->px, ray = p->wy - A->py;
        double rbx = B ? p->wx - B->px : 0, rby = B ? p->wy - B->py : 0;
        double rvx = A->vx - A->omega * ray, rvy = A->vy + A->omega * rax;
        if (B) { rvx -= B->vx - B->omega * rby; rvy -= B->vy + B->omega * rbx; }
        double impactVn = rvx * Nx[bk] + rvy * Ny[bk];
        bool softImpact = actorSweepOverlap[A->idx]
          || (bIndex >= 0 && actorSweepOverlap[bIndex]);
        double restitution = B ? R_BODY_RESTITUTION : R_TERRAIN_RESTITUTION;
        double targetVn = !softImpact && impactVn < -R_BOUNCE_MIN_SPEED ? -restitution * impactVn : 0;
        contacts.push_back({A, B, rax, ray, rbx, rby, Nx[bk], Ny[bk], p->depth,
                            bIndex >= 0, std::max(0.0, -impactVn), targetVn,
                            0, 0, 0});
        if (p->depth > A->maxDepth) A->maxDepth = p->depth;
        if (B && p->depth > B->maxDepth) B->maxDepth = p->depth;
      };
      for (int bk = 0; bk < 8; bk++) { if (!cnt[bk]) continue; push(lo[bk], bk); if (hi[bk] != lo[bk]) push(hi[bk], bk); }
      A->hadContact = true;
      solidContact[A->idx] = 1;
      if (B) {
        B->hadContact = true;
        if (bIndex >= 0) solidContact[bIndex] = 1;
      }
    };
    for (int i = 0; i < n; i++) broadphaseOrder[i] = i;
    std::sort(broadphaseOrder.begin(), broadphaseOrder.end(),
              [&](int a, int b) {
                if (solverBodies[a]->aabbX0 != solverBodies[b]->aabbX0)
                  return solverBodies[a]->aabbX0 < solverBodies[b]->aabbX0;
                return a < b;
              });
    broadphasePairs.clear();
    for (int oi = 0; oi < n; oi++) {
      int a = broadphaseOrder[oi];
      Body* A = solverBodies[a];
      for (int oj = oi + 1; oj < n; oj++) {
        int b = broadphaseOrder[oj];
        Body* B = solverBodies[b];
        if (B->aabbX0 > A->aabbX1) break;
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
      bool aMoving = A->awake && (A->vx * A->vx + A->vy * A->vy > R_WAKE_LIN2 || A->omega * A->omega > R_WAKE_ANG2);
      bool bMoving = B->awake && (B->vx * B->vx + B->vy * B->vy > R_WAKE_LIN2 || B->omega * B->omega > R_WAKE_ANG2);
      penAcc.clear(); collectSweep(A, B, 1, dt); collectSweep(B, A, -1, dt);
      if (penAcc.empty()) continue;
      if (!A->awake && bMoving) wakeBody(A);
      if (!B->awake && aMoving) wakeBody(B);
      if (!A->awake && !B->awake) continue;
      double fbx = A->px - B->px, fby = A->py - B->py, fl = std::sqrt(fbx * fbx + fby * fby);
      if (fl < 1e-9) { fbx = 0; fby = -1; } else { fbx /= fl; fby /= fl; }
      reduceManifold(penAcc, A, B, fbx, fby);
    }
    for (int bi = 0; bi < n; bi++) {
      Body* b = solverBodies[bi]; if (!b->awake) continue;
      terrAcc.clear();
      terrPeers.clear();
      collectTerrain(b, dt);
      if (!bodyUsesPeerContacts(b)) {
        reduceManifold(terrAcc, b, nullptr, 0, -1);
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
          double fbx = b->px - peer->px, fby = b->py - peer->py;
          double fl = std::sqrt(fbx * fbx + fby * fby);
          if (fl < 1e-9) { fbx = 0; fby = -1; }
          else { fbx /= fl; fby /= fl; }
          reduceManifold(group.points, b, peer, fbx, fby);
        } else {
          reduceManifold(group.points, b, nullptr, 0, -1);
        }
      }
    }
    nc = (int)contacts.size();
    for (const Contact& contact : contacts) {
      if (contact.impactSpeed < 0.28) continue;
      E.audio.emit(SE_IMPACT, contact.a->px, contact.a->py,
                   std::min(1.8, 0.25 + contact.impactSpeed * 0.55), contact.a->material);
    }
    // Break as soon as a whole iteration applies zero impulse everywhere.
    // General bodies retain the full 64-iteration cap because structural stacks
    // genuinely use it. A scene containing only tiny blast rubble uses the
    // smaller cap above; those chunks bake when their contact islands settle.
    for (int it = 0; it < solverIters; it++) {
      double moved = 0;
      if (it & 1) for (int ci = nc - 1; ci >= 0; ci--) moved += resolveContact(contacts[ci]);
      else for (int ci = 0; ci < nc; ci++) moved += resolveContact(contacts[ci]);
      if (moved == 0.0) break;
    }
    for (int it = 0; it < solverIters; it++) {
      double moved = 0;
      if (it & 1) for (int ci = nc - 1; ci >= 0; ci--) moved += resolveBias(contacts[ci]);
      else for (int ci = 0; ci < nc; ci++) moved += resolveBias(contacts[ci]);
      if (moved == 0.0) break;
    }
    for (int bi = 0; bi < n; bi++) {
      Body* b = solverBodies[bi]; if (!b->awake) continue;
      b->px += (b->vx + b->pvx) * dt; b->py += (b->vy + b->pvy) * dt; b->angle += (b->omega + b->pw) * dt;
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
          && b->omega * b->omega < R_SETTLE_ANG * R_SETTLE_ANG)
        b->omega *= R_CONTACT_ANG_DAMP;
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
  double sn = std::sin(b->angle), cs = std::cos(b->angle);
  double lx0 = b->offsetX - 0.5, lx1 = b->offsetX + b->w - 0.5, ly0 = b->offsetY - 0.5, ly1 = b->offsetY + b->h - 0.5;
  double minWX = 1e18, minWY = 1e18, maxWX = -1e18, maxWY = -1e18;
  auto corner = [&](double lx, double ly) { double wx = b->px + lx * cs - ly * sn, wy = b->py + lx * sn + ly * cs; if (wx < minWX) minWX = wx; if (wx > maxWX) maxWX = wx; if (wy < minWY) minWY = wy; if (wy > maxWY) maxWY = wy; };
  corner(lx0, ly0); corner(lx1, ly0); corner(lx1, ly1); corner(lx0, ly1);
  int x0 = (int)std::floor(minWX), x1 = (int)std::floor(maxWX), y0 = (int)std::floor(minWY), y1 = (int)std::floor(maxWY);
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= E.cols) x1 = E.cols - 1; if (y1 >= E.rows) y1 = E.rows - 1;
  for (int wy = y0; wy <= y1; wy++) for (int wx = x0; wx <= x1; wx++) {
    double dx = wx + 0.5 - b->px, dy = wy + 0.5 - b->py;
    double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    int i = (int)std::lround(lx - b->offsetX), j = (int)std::lround(ly - b->offsetY);
    if (i < 0 || i >= b->w || j < 0 || j >= b->h) continue;
    int local = j * b->w + i;
    if (b->occ[local] && bodyMaterialAt(b, local) != EMPTY) cb(wx, wy, local);
  }
}
int RigidBodySystem::localCellAt(Body* b, double wx, double wy) { b->cs = std::cos(b->angle); b->sn = std::sin(b->angle); return insideBodyIndex(b, wx, wy); }
bool RigidBodySystem::eraseLocalCell(Body* b, int idx) {
  if (idx < 0 || idx >= (int)b->occ.size() || !b->occ[idx]) return false;
  if (b->jointRole) breakJointBody(b);
  if (!b->occ[idx]) return false;
  b->occ[idx] = 0;
  if (!b->cellMaterials.empty()) b->cellMaterials[idx] = EMPTY;
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

  const int activeLayer = E.L == &E.bg ? 1 : 0;
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
        pressure = density * R_GRAVITY * dt * 0.5;
      } else {
        pressure += (priorDensity + density) * 0.5 * R_GRAVITY * dt;
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
    fluidNodes.push_back({lay, k, -1, sourceBody, material, vx, vy + R_GRAVITY * dt,
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
      double outsideVy = E.liquidVelocityY(packedVelocity) + R_GRAVITY * dt;
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
    if (medium == ACID && E.isDissolvable(target))
      p = std::fmax(p, ACID_DISSOLVE_P);
    else if (medium == LAVA && E.isFlammable(target))
      p = std::fmax(p, RIGID_LAVA_ERODE_P);
    else if (medium == FIRE && E.isFlammable(target))
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
    computeDerived(leader, true);
    computeDerived(follower, true);
    syncJointFollower(leader);
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
  for (Body* b : orderedDirty) {
    auto containsTnt = [&](Body* body) {
      if (body->cellMaterials.empty()) return body->material == TNT && body->nPts > 0;
      for (uint8_t material : body->cellMaterials)
        if (material == TNT) return true;
      return false;
    };
    std::vector<int> wc; // b's remaining world cells
    for (int k : cells) if (E.L->bodyOwner[k] == b->id) wc.push_back(k); // body cells carry the body's real material; E.L->bodyOwner identifies them
    if (wc.empty()) { removedIds.insert(b->id); continue; }
    // Flood with the same 8-connectivity used by static structures and
    // component-to-body detachment. A rotated raster commonly turns a face
    // contact into a diagonal contact; treating that as a fracture makes a
    // chipped mixed-material object split even though its structural bond is
    // still intact.
    std::unordered_map<int, int> idxOf; for (size_t i = 0; i < wc.size(); i++) idxOf[wc[i]] = (int)i;
    std::vector<int> comp(wc.size(), -1); std::vector<std::vector<int>> groups;
    for (size_t i = 0; i < wc.size(); i++) {
      if (comp[i] != -1) continue; int gid = (int)groups.size(); groups.push_back({}); std::vector<int> st{(int)i}; comp[i] = gid;
      while (!st.empty()) { int ci = st.back(); st.pop_back(); int k = wc[ci]; groups[gid].push_back(k); int y = k / E.cols, x = k - y * E.cols;
        for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          int nx = x + ox, ny = y + oy;
          if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
          auto it = idxOf.find(ny * E.cols + nx);
          if (it == idxOf.end() || comp[it->second] != -1) continue;
          comp[it->second] = gid;
          st.push_back(it->second);
        }
      }
    }
    if (groups.size() <= 1) {
      computeDerived(b, true);
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
  std::unordered_set<int> wasBody(cells.begin(), cells.end());
  for (int k : cells) E.L->bodyOwner[k] = -1;
  std::vector<int> kept; std::unordered_set<int> claimed;
  // Skip EMPTY cells: an erased cell (grid already cleared) can still fall
  // under a rotated body's re-rasterization, and claiming it would leave a
  // body-owned EMPTY cell until the next moveBodies stamp — a powder settling
  // into it that step would then be wiped by the un-stamp (silent cell loss).
  // Found by the SAND_INVARIANT_CHECKS post-step validator.
  for (Body* b : E.L->bodies) forEachBodyCell(b, [&](int x, int y, int) { int k = y * E.cols + x; if (!wasBody.count(k) || claimed.count(k) || E.L->grid[k] == EMPTY) return; E.L->bodyOwner[k] = b->id; claimed.insert(k); kept.push_back(k); });
  for (int k : cells) if (!claimed.count(k)) { E.writeGridIndex(k, EMPTY); E.L->bodyOwner[k] = -1; }
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
          if (component[ni] >= 0 || !(layerMask[ci] & layerMask[ni])) continue;
          component[ni] = group;
          stack.push_back(ni);
        }
      }
    }
    uint8_t remainingLayers = 0;
    for (uint8_t mask : layerMask) remainingLayers |= mask;
    if (groups.size() <= 1 && !worldCells.empty() && remainingLayers == 3) {
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
// travel direction. If terrain blocks that displacement, keep the actor pinned
// in the overlap; creature engulfment damage then handles genuine crushing.
bool RigidBodySystem::pushActorsFromBody(Body* b, double prePx, double prePy, double preAngle, double preVx, double preVy) {
  const double finalPx = b->px, finalPy = b->py, finalAngle = b->angle;
  const double dx = finalPx - prePx, dy = finalPy - prePy, da = finalAngle - preAngle;
  const double sweepDistance = std::max(std::hypot(dx, dy), std::fabs(da) * std::hypot(b->w, b->h) * 0.5);
  const int sweepSteps = imin(256, imax(1, (int)std::ceil(sweepDistance / 0.5)));
  double driveX = preVx, driveY = preVy;
  if (std::hypot(driveX, driveY) < 0.05) { driveX = dx; driveY = dy; }
  const int preferred = std::hypot(driveX, driveY) < 0.05 ? -1 :
    (std::fabs(driveX) >= std::fabs(driveY) ? (driveX >= 0 ? 1 : 0) : (driveY >= 0 ? 3 : 2)); // L,R,U,D = 0..3
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
  auto pushOverlapping = [&](double& ax, double& ay, int aw, int ah, double& avx, double& avy, bool player) {
    int contactMinX = E.cols, contactMinY = E.rows, contactMaxX = -1, contactMaxY = -1;
    for (const auto& cell : raster) {
      if (ay < cell.second + 1 && ay + ah > cell.second) {
        contactMinX = imin(contactMinX, cell.first); contactMaxX = imax(contactMaxX, cell.first);
      }
      if (ax < cell.first + 1 && ax + aw > cell.first) {
        contactMinY = imin(contactMinY, cell.second); contactMaxY = imax(contactMaxY, cell.second);
      }
    }
    if (contactMaxX < 0 || contactMaxY < 0) return;
    struct Candidate { double x, y; int side; } c[4] = {
      {(double)contactMinX - aw - 1e-4, ay, 0},
      {(double)contactMaxX + 1 + 1e-4, ay, 1},
      {ax, (double)contactMinY - ah - 1e-4, 2},
      {ax, (double)contactMaxY + 1 + 1e-4, 3},
    };
    if (preferred < 0) return; // resting solver jitter must not invent a new escape direction
    Candidate& q = c[preferred];
    bool blocked = player ? E.psys.playerBoxHits(q.x, q.y, aw, ah)
                          : E.creatures.boxHitsSolid(E.fg.worldOffsetX + q.x, E.fg.worldOffsetY + q.y, aw, ah);
    if (blocked || overlaps(q.x, q.y, aw, ah)) return;
    ax = q.x; ay = q.y;
    if (q.side == 0) avx = std::min(avx, -std::min(std::fabs(driveX), maxCarrySpeed));
    else if (q.side == 1) avx = std::max(avx, std::min(std::fabs(driveX), maxCarrySpeed));
    else if (q.side == 2) avy = std::min(avy, -std::min(std::fabs(driveY), maxCarrySpeed));
    else avy = std::max(avy, std::min(std::fabs(driveY), maxCarrySpeed));
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
      pushOverlapping(p.px, p.py, p.w, p.h, p.vx, p.vy, true);
    }
    for (size_t i = 0; i < E.creatures.creatures.size(); i++) {
      Creature& c = E.creatures.creatures[i];
      if (!c.alive) continue;
      const CreatureSpecies& s = E.creatures.species(c);
      double x = c.wx - E.fg.worldOffsetX, y = c.wy - E.fg.worldOffsetY;
      if (!broadOverlaps(x, y, s.w, s.h) || !overlaps(x, y, s.w, s.h)) continue;
      pushOverlapping(x, y, s.w, s.h, c.vx, c.vy, false);
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
// direct contact with a grounded static solid (or the world floor). Liquids and
// other free bodies remain entirely in the rigid solver.
bool RigidBodySystem::bodyTouchesGroundedSolid(Body* b) {
  occStamp.reset((size_t)(E.cols * E.rows)); occCells.clear();
  forEachBodyCell(b, [&](int x, int y, int) {
    int k = y * E.cols + x;
    if (!occStamp.has(k)) { occStamp.add(k); occCells.push_back(k); }
  });
  const int offsets[4] = {-1, 1, -E.cols, E.cols};
  for (int k : occCells) {
    int y = k / E.cols, x = k - y * E.cols;
    if (y + 1 >= E.rows) return true;
    for (int offset : offsets) {
      if ((offset == -1 && x == 0) || (offset == 1 && x + 1 >= E.cols)
          || (offset == -E.cols && y == 0) || (offset == E.cols && y + 1 >= E.rows))
        continue;
      int neighbor = k + offset;
      if (occStamp.has(neighbor) || E.L->bodyOwner[neighbor] >= 0) continue;
      uint8_t material = E.L->grid[neighbor];
      if ((E.isRigidMaterialClass(material) || E.isLooseSolidMaterial(material))
          && E.L->groundedCell[neighbor]) return true;
    }
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
  std::unordered_map<int, std::array<double, 5>> prePoses;
  for (Body* b : E.L->bodies) if (b->jointRole != 2)
    prePoses[b->id] = {b->px, b->py, b->angle, b->vx, b->vy};
  rigidStep(1.0);
  rigidRejectedCells = 0; rigidDepenetrations = 0;
  for (Body* b : E.L->bodies) {
    if (b->jointRole == 2) continue;
    auto it = prePoses.find(b->id); bool hp = it != prePoses.end();
    double ppx = hp ? it->second[0] : 0, ppy = hp ? it->second[1] : 0, ppa = hp ? it->second[2] : 0;
    double pvx = hp ? it->second[3] : 0, pvy = hp ? it->second[4] : 0;
    if (depenetrateBodyRaster(b, ppx, ppy, hp)) rigidDepenetrations++;
    if (hp && E.L == &E.fg) pushActorsFromBody(b, ppx, ppy, ppa, pvx, pvy);
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
  erodeBodies(cells);
  if (E.L == &E.fg) {
    std::vector<Body*> leaders;
    for (Body* b : E.fg.bodies) if (b->jointRole == 1) leaders.push_back(b);
    for (Body* leader : leaders) stampJointFollower(leader);
  }
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
