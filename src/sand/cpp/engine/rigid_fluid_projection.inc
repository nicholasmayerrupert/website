  // Each body samples hydrostatic head in the nearest open liquid columns just
  // outside its raster. This preserves density layers and nearby wave height
  // without walking the connected pool. The local pressure domain interpolates
  // between the two sides; sealed regions fall back to their cached pressure.
  double referenceStart = emscripten_get_now();
  fluidReferences.resize(bodies.size() * 2);
  std::vector<std::pair<int, int>> referenceColumns;
  for (int layer = 0; layer < 2; layer++) {
    if ((int)fluidReferencePressure[layer].size() != cellCount)
      fluidReferencePressure[layer].resize(cellCount);
    fluidReferenceColumnState[layer].assign(E.cols, 0);
  }
  auto buildReferenceColumn = [&](int layer, int x) {
    if (x < 0 || x >= E.cols) return false;
    uint8_t& columnState = fluidReferenceColumnState[layer][x];
    if (columnState) return columnState == 2;
    Layer* lay = layerAt(layer);
    std::vector<double>& pressureOut = fluidReferencePressure[layer];
    bool inLiquid = false, openSegment = false, found = false;
    double pressure = 0, priorDensity = 0;
    for (int y = 0; y < E.rows; y++) {
      int k = y * E.cols + x;
      pressureOut[k] = 0;
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
        pressureOut[k] = pressure;
        found = true;
      }
    }
    columnState = found ? 2 : 1;
    return found;
  };
  auto selectSideReference = [&](int layer, int edgeX, int direction,
                                 int& referenceX) {
    referenceColumns.clear();
    for (int distance = 1; distance <= R_FLUID_REFERENCE_SEARCH; distance++) {
      int x = edgeX + direction * distance;
      if (!buildReferenceColumn(layer, x)) continue;
      int surfaceY = 0;
      while (surfaceY < E.rows
             && fluidReferencePressure[layer][surfaceY * E.cols + x] <= 0)
        surfaceY++;
      if (surfaceY < E.rows) referenceColumns.push_back({surfaceY, x});
    }
    if (referenceColumns.empty()) return;
    std::sort(referenceColumns.begin(), referenceColumns.end());
    referenceX = referenceColumns[referenceColumns.size() / 2].second;
  };
  for (int bodyIndex = 0; bodyIndex < (int)bodies.size(); bodyIndex++) {
    for (int layer = 0; layer < 2; layer++) {
      FluidReference& reference = fluidReferences[bodyIndex * 2 + layer];
      reference.leftX = reference.rightX = -1;
      const std::array<int, 4>& bounds =
        fluidBodyBounds[bodyIndex * 2 + layer];
      if (bounds[2] < bounds[0]) continue;
      if (E.isIceMaterial(bodies[bodyIndex]->material)) {
        selectSideReference(layer, bounds[0], -1, reference.leftX);
        selectSideReference(layer, bounds[2], 1, reference.rightX);
      } else {
        for (int distance = 1; distance <= R_FLUID_REFERENCE_SEARCH; distance++) {
          int x = bounds[0] - distance;
          if (!buildReferenceColumn(layer, x)) continue;
          reference.leftX = x;
          break;
        }
        for (int distance = 1; distance <= R_FLUID_REFERENCE_SEARCH; distance++) {
          int x = bounds[2] + distance;
          if (!buildReferenceColumn(layer, x)) continue;
          reference.rightX = x;
          break;
        }
      }
    }
  }
  fluidReferenceMs += emscripten_get_now() - referenceStart;
  auto referencePressureAt = [&](int sourceBody, int layer, int cell) {
    double cached = std::fmax(0.0f, fluidPressureCache[layer][cell]);
    if (sourceBody < 0 || sourceBody >= (int)bodies.size()) return cached;
    const FluidReference& reference =
      fluidReferences[sourceBody * 2 + layer];
    int y = cell / E.cols, x = cell - y * E.cols;
    double left = reference.leftX >= 0
      ? fluidReferencePressure[layer][y * E.cols + reference.leftX] : 0;
    double right = reference.rightX >= 0
      ? fluidReferencePressure[layer][y * E.cols + reference.rightX] : 0;
    if (left <= 0) return right > 0 ? right : cached;
    if (right <= 0) return left;
    double width = reference.rightX - reference.leftX;
    double weight = width > 0
      ? std::fmax(0.0, std::fmin(1.0, (x - reference.leftX) / width))
      : 0.5;
    return left + (right - left) * weight;
  };

  double domainStart = emscripten_get_now();
  fluidNodes.clear();
  fluidNodeDepth.clear();
  fluidQueue.clear();
  uint8_t coupledMaterial = EMPTY;
  bool heterogeneousCoupling = false;
  bool iceCoupling = false;
  for (Body* body : bodies) {
    if (E.isIceMaterial(body->material)
        || (body->jointPeer
            && E.isIceMaterial(body->jointPeer->material))) {
      iceCoupling = true;
      break;
    }
  }
  auto domainRadius = [&] {
    if (iceCoupling) return R_FLUID_ICE_DOMAIN_RADIUS;
    if (wetBodyCount >= R_FLUID_DENSE_BATCH_BODIES)
      return R_FLUID_DENSE_DOMAIN_RADIUS;
    if (wetBodyCount >= R_FLUID_CORRECTOR_BATCH_BODIES)
      return R_FLUID_BATCH_DOMAIN_RADIUS;
    return R_FLUID_DOMAIN_RADIUS;
  };
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
    if (depth >= domainRadius()) continue;
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
  fluidNodeCount = imax(fluidNodeCount, (int)fluidNodes.size());
  for (const FluidNode& node : fluidNodes) {
    if (node.sourceBody < 0 || node.sourceBody >= (int)bodies.size()) continue;
    bodyMinLiquidDensity[node.sourceBody] = std::fmin(
      bodyMinLiquidDensity[node.sourceBody], DENSITY[node.material]);
    bodyMaxLiquidDensity[node.sourceBody] = std::fmax(
      bodyMaxLiquidDensity[node.sourceBody], DENSITY[node.material]);
  }
  for (int bodyIndex = 0; bodyIndex < (int)bodies.size(); bodyIndex++) {
    Body* body = bodies[bodyIndex];
    fluidBodyDensityEquilibrium[bodyIndex] =
      bodyMinLiquidDensity[bodyIndex] < body->density - 1e-6
      && bodyMaxLiquidDensity[bodyIndex] > body->density + 1e-6;
  }
  std::sort(fluidQueue.begin(), fluidQueue.end());
  fluidNodeSortScratch.clear();
  fluidNodeSortScratch.reserve(fluidNodes.size());
  for (int packed : fluidQueue) {
    int layer = packed / cellCount;
    int k = packed - layer * cellCount;
    fluidNodeSortScratch.push_back(
      std::move(fluidNodes[fluidNodeIndex[layer][k]]));
  }
  fluidNodes.swap(fluidNodeSortScratch);
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
        double fluidNormal = node.vx * nx + node.vy * ny;
        fluidBodyMaxSlip[bodyIndex] = std::fmax(
          fluidBodyMaxSlip[bodyIndex],
          std::fabs(fluidNormal - bodyNormal));
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
      if (nx) face.inverseDensity /= domainRadius();
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
  fluidFaceCount = imax(fluidFaceCount, (int)fluidFaces.size());
  for (FluidFace& face : fluidFaces) {
    if (face.kind != FF_DOMAIN) continue;
    FluidNode& node = fluidNodes[face.a];
    componentHasDomain[node.component] = 1;
  }
