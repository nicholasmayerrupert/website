void RigidBodySystem::emitRigidManifold(
    const StepState& step, SubstepState& state, std::vector<ContactPoint>& acc,
    Body* A, Body* B, double fbx, double fby, double contactDt) {
  auto& contacts = solverContactScratch;
  if (acc.empty()) return;
  Body* shapeA = A;
  Body* shapeB = B;
  if (A->solverBody) A = A->solverBody;
  if (B && B->solverBody) B = B->solverBody;
  int bIndex = B && B->idx >= 0 && B->idx < step.n
    && step.solverBodies[B->idx] == B ? B->idx : -1;
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
  double Nx[8], Ny[8], tx[8], ty[8], loP[8], hiP[8]; ContactPoint* lo[8] = {nullptr}; ContactPoint* hi[8] = {nullptr};
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
    bool localSparseSweep = B && sweptHit[bk]
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
  auto push = [&](ContactPoint* p, int bk) {
    if (!p) return -1;
    double rax = p->wx - A->px, ray = p->wy - A->py;
    double rbx = B ? p->wx - B->px : 0, rby = B ? p->wy - B->py : 0;
    double rvx = A->vx - A->omega * ray, rvy = A->vy + A->omega * rax;
    if (B) {
      rvx -= rigidContactVx(B) - rigidContactOmega(B) * rby;
      rvy -= rigidContactVy(B) + rigidContactOmega(B) * rbx;
    }
    double impactVn = rvx * Nx[bk] + rvy * Ny[bk];
    double impactSpeed = std::max(0.0, -impactVn);
    A->recentImpactSpeed = std::fmax(
      A->recentImpactSpeed, impactSpeed);
    if (B)
      B->recentImpactSpeed = std::fmax(
        B->recentImpactSpeed, impactSpeed);
    bool softImpact = B && B->actorProxy;
    double restitution = B ? R_BODY_RESTITUTION : R_TERRAIN_RESTITUTION;
    double targetVn = !softImpact && impactVn < -R_BOUNCE_MIN_SPEED ? -restitution * impactVn : 0;
    auto materialAtContact = [&](Body* body) {
      if (body->cellMaterials.empty()) return body->material;
      int local = insideBodyIndex(body, p->wx, p->wy);
      return local >= 0 ? bodyMaterialAt(body, local) : body->material;
    };
    bool icyContact = materialAtContact(shapeA) == ICE
      || (shapeB && materialAtContact(shapeB) == ICE);
    bool streamedSideBoundary = !B && E.L->infinite
      && (p->wx < 0 || p->wx >= E.cols);
    if (!B) {
      int tx = (int)std::floor(p->wx), ty = (int)std::floor(p->wy);
      icyContact = icyContact || (tx >= 0 && tx < E.cols
        && ty >= 0 && ty < E.rows && E.L->grid[ty * E.cols + tx] == ICE);
    }
    double staticFriction = streamedSideBoundary ? 0
      : icyContact ? R_ICE_STATIC_FRICTION : R_STATIC_FRICTION;
    double dynamicFriction = streamedSideBoundary ? 0
      : icyContact ? R_ICE_DYNAMIC_FRICTION : R_DYNAMIC_FRICTION;
    Contact contact{
      .a = A, .b = B,
      .rax = rax, .ray = ray, .rbx = rbx, .rby = rby,
      .nx = Nx[bk], .ny = Ny[bk], .depth = p->depth,
      .childA = p->childA, .childB = p->childB,
      .featureA = p->featureA, .featureB = p->featureB,
      .normalBucket = (uint8_t)bk,
      .bIntegrated = bIndex >= 0,
      .impactSpeed = impactSpeed, .targetVn = targetVn, .dt = contactDt,
      .staticFriction = staticFriction, .dynamicFriction = dynamicFriction,
      .normalMass = 0, .tangentMass = 0, .biasMass = 0,
      .accJn = 0, .accJt = 0, .accBias = 0,
      .blockMate = -1, .persisted = false,
      .layer = (uint8_t)(E.L == &E.bg ? 1 : 0),
    };
    restoreContact(state, contact, bk, contactDt);
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
  if (B && B->actorProxy) return;
  A->hadContact = true;
  if (!B) A->rasterMayOverlapSolid = true;
  state.contact[A->idx].solid = 1;
  if (B) {
    B->hadContact = true;
    if (bIndex >= 0) state.contact[bIndex].solid = 1;
  }
}

