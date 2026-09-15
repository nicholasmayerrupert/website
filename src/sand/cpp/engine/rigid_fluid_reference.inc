// Integrate rho*a along connected liquid to an exposed surface. Upstream
// edges are preferred; tangential detours pass around submerged obstacles.
// Successful paths share references within this pressure pass. Sealed paths
// and exhausted search budgets fall back to the pressure solver's cache.
__attribute__((noinline))
double RigidBodySystem::spatialFluidReferencePressure(int layer, int cell) {
  Layer* lay = layer == 0 ? &E.fg : &E.bg;
  auto& stamp = fluidSpatialReferenceStamp[layer];
  auto& pressure = fluidSpatialReferencePressure[layer];
  if (stamp[cell] == fluidNodeGeneration) return pressure[cell];
  if (fluidReferenceSearchBudget[layer] <= 0) return -1.0;
  if (fluidReferenceTraceSerial == INT32_MAX) {
    for (auto& stamps : fluidSpatialReferenceStamp)
      std::fill(stamps.begin(), stamps.end(), 0);
    fluidReferenceTraceSerial = 0;
  }
  int32_t visiting = -++fluidReferenceTraceSerial;
  fluidReferencePath.clear();
  const int dx[4] = {-1, 1, 0, 0}, dy[4] = {0, 0, -1, 1};
  auto pushCell = [&](int k) {
    double ax, ay;
    E.forces.liquidAcceleration(lay, k % E.cols, k / E.cols, ax, ay);
    FluidReferenceTrace trace{k, 0, 0, {{0, 1, 2, 3}}};
    std::sort(trace.directions.begin(), trace.directions.end(), [&](int a, int b) {
      double first = ax * dx[a] + ay * dy[a], second = ax * dx[b] + ay * dy[b];
      return first != second ? first < second : a < b;
    });
    stamp[k] = visiting;
    fluidReferencePath.push_back(trace);
  };
  pushCell(cell);
  double head = -1;
  static constexpr int MAX_REFERENCE_VISITS = 1024;
  for (int visits = 0; visits < MAX_REFERENCE_VISITS && !fluidReferencePath.empty(); visits++) {
    if (fluidReferenceSearchBudget[layer] <= 0) break;
    --fluidReferenceSearchBudget[layer];
    FluidReferenceTrace& trace = fluidReferencePath.back();
    if (trace.nextDirection == 4) {
      fluidReferencePath.pop_back();
      continue;
    }
    int direction = trace.directions[trace.nextDirection++];
    int k = trace.cell, x = k % E.cols, y = k / E.cols;
    int xx = x + dx[direction], yy = y + dy[direction];
    if (xx < 0 || xx >= E.cols || yy < 0 || yy >= E.rows) continue;
    int next = yy * E.cols + xx;
    if (stamp[next] == visiting
        || fluidBodyStamp[layer][next] == fluidBodyGeneration) continue;
    uint8_t material = lay->grid[next];
    bool exposed = material == EMPTY || E.isGasMaterial(material);
    if (!exposed && !E.isLiquidMaterial(material)) continue;
    double ax, ay;
    E.forces.liquidAcceleration(lay, x, y, ax, ay);
    double density = DENSITY[lay->grid[k]];
    if (exposed) {
      trace.increment = -0.5 * density * (ax * dx[direction] + ay * dy[direction]);
      if (trace.increment < 0) continue;
      head = 0;
      break;
    }
    double nextAx, nextAy;
    E.forces.liquidAcceleration(lay, xx, yy, nextAx, nextAy);
    trace.increment = -0.5 * ((density * ax + DENSITY[material] * nextAx) * dx[direction]
                            + (density * ay + DENSITY[material] * nextAy) * dy[direction]);
    if (stamp[next] == fluidNodeGeneration) {
      head = pressure[next];
      break;
    }
    pushCell(next);
  }
  if (head < 0) return -1.0;
  double checkHead = head;
  for (auto it = fluidReferencePath.rbegin(); it != fluidReferencePath.rend(); ++it) {
    checkHead += it->increment;
    if (checkHead < 0) return -1.0;
  }
  for (auto it = fluidReferencePath.rbegin(); it != fluidReferencePath.rend(); ++it) {
    head += it->increment;
    pressure[it->cell] = head;
    stamp[it->cell] = fluidNodeGeneration;
  }
  return head;
}
