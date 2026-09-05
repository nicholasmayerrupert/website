  const int cellCount = E.cols * E.rows;
  fluidBodySurface.assign(bodies.size(), 0);
  fluidBodyDensityEquilibrium.assign(bodies.size(), 0);
  fluidBodyMaxSlip.assign(bodies.size(), 0);
  if (bodies.empty() || cellCount == 0) return false;
  auto touchesLiquid = [&](Body* body, Layer& layer) {
    ensureBodyRaster(body);
    for (const BodyRasterCell& cell : body->rasterBoundaryFootprint) {
      int x = cell.x, y = cell.y;
      int k = y * E.cols + x;
      if ((x > 0 && E.isLiquidMaterial(layer.grid[k - 1]))
          || (x + 1 < E.cols && E.isLiquidMaterial(layer.grid[k + 1]))
          || (y > 0 && E.isLiquidMaterial(layer.grid[k - E.cols]))
          || (y + 1 < E.rows
               && E.isLiquidMaterial(layer.grid[k + E.cols])))
        return true;
    }
    return false;
  };
  bool liquidCandidate = false;
  for (Body* body : bodies) {
    int activeLayer = body->solverLayer;
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
  if (fluidNodeGeneration == INT32_MAX) {
    fluidNodeGeneration = 1;
    for (auto& stamp : fluidNodeStamp) std::fill(stamp.begin(), stamp.end(), 0);
  } else {
    fluidNodeGeneration++;
  }
  if (fluidBodyGeneration == INT32_MAX) {
    fluidBodyGeneration = 1;
    for (auto& stamp : fluidBodyStamp) std::fill(stamp.begin(), stamp.end(), 0);
  } else {
    fluidBodyGeneration++;
  }

  fluidQueue.clear();
  fluidBodyBounds.assign(bodies.size() * 2,
                         {{E.cols, E.rows, -1, -1}});
  std::vector<double> bodyMinLiquidDensity(bodies.size(), 1e30);
  std::vector<double> bodyMaxLiquidDensity(bodies.size(), 0);
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
      const int dx[4] = {-1, 1, 0, 0};
      const int dy[4] = {0, 0, -1, 1};
      for (int direction = 0; direction < 4; direction++) {
        int nx = x + dx[direction];
        int ny = y + dy[direction];
        if (nx < 0 || nx >= E.cols || ny < 0 || ny >= E.rows) continue;
        int neighbor = ny * E.cols + nx;
        uint8_t material = layer == 0
          ? E.fg.grid[neighbor] : E.bg.grid[neighbor];
        if (!E.isLiquidMaterial(material)) continue;
        bodyMinLiquidDensity[bodyIndex] = std::fmin(
          bodyMinLiquidDensity[bodyIndex], DENSITY[material]);
        bodyMaxLiquidDensity[bodyIndex] = std::fmax(
          bodyMaxLiquidDensity[bodyIndex], DENSITY[material]);
      }
    });
  };
  for (int i = 0; i < (int)bodies.size(); i++) {
    Body* body = bodies[i];
    int activeLayer = body->solverLayer;
    stampBody(body, i, activeLayer, body->awake);
    if (body->jointRole == 1 && body->jointPeer)
      stampBody(body->jointPeer, i, 1 - activeLayer, body->awake);
  }
  int wetBodyCount = 0;
  for (double density : bodyMinLiquidDensity)
    if (density < 1e30) wetBodyCount++;

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
      else if (d == 2 && !(lay->infinite
                           && (x == 0 || x == E.cols - 1))
               && (lay->grid[nk] == EMPTY
                   || E.isGasMaterial(lay->grid[nk])))
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
