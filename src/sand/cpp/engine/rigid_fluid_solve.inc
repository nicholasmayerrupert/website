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
  fluidDomainMs += emscripten_get_now() - domainStart;

  double matrixStart = emscripten_get_now();
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
  fluidMatrixMs += emscripten_get_now() - matrixStart;

  // Broad ice domains resolve once more after clamping negative pressure.
  // Compact domains leave residual surface motion to the cellular liquid pass.
  double solveStart = emscripten_get_now();
  int activeSetPasses = iceCoupling ? 2 : 1;
  for (int activeSet = 0; activeSet < activeSetPasses; activeSet++) {
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
      fluidPressureIterations++;
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
  fluidSolveMs += emscripten_get_now() - solveStart;

  double writebackStart = emscripten_get_now();
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

