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
    if (node.layer->liquidVel[node.cell] != velocity
        || node.layer->nextLiquidVel[node.cell] != velocity)
      E.markWorldTileDirty(node.layer, node.cell);
    node.layer->liquidVel[node.cell] = velocity;
    node.layer->nextLiquidVel[node.cell] = velocity;
    int layer = node.layer == &E.bg ? 1 : 0;
    fluidPressureCache[layer][node.cell] = (float)node.pressure;
  }
  fluidWritebackMs += emscripten_get_now() - writebackStart;
  return true;
