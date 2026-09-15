// Contact rest policy. Solid damping preserves real pivots; fluid damping
// applies only near equilibrium. Sleep age and world-space probes are separate
// clocks, and final island/support eligibility is checked in finalizeRigidStep.
void RigidBodySystem::dampSolidContact(
    Body* b, bool unbalancedSupport, bool frictionalContact,
    bool upwardContact, bool bodyContact) {
  if (frictionalContact
      && b->vx * b->vx + b->vy * b->vy < R_SETTLE_LIN * R_SETTLE_LIN) {
    b->vx *= R_CONTACT_LIN_DAMP;
    b->vy *= R_CONTACT_LIN_DAMP;
  }
  // Contact-generated spin that grows in one direction is a real topple.
  // A structure-scale body pivoting directly on terrain also keeps its spin
  // while its perimeter motion is outside the rest band. Oscillating or
  // decaying motion inside the band is damped so supported bodies settle.
  bool spinGrowing = b->omega * b->omegaPre > 0 && std::fabs(b->omega) > std::fabs(b->omegaPre);
  bool spinInsideRestBand =
    b->omega * b->omega < R_SETTLE_ANG * R_SETTLE_ANG
    && (!upwardContact || bodyContact
      || !rigidStructureScaleBody(b)
      || std::fabs(b->omega) * b->maxR
        < R_CONTACT_ANG_DAMP_POINT_SPEED);
  if (frictionalContact && !unbalancedSupport && !spinGrowing && spinInsideRestBand) {
    b->omega *= R_CONTACT_ANG_DAMP;
    int shortSide = imin(b->w, b->h);
    int longSide = imax(b->w, b->h);
    // A small angular velocity can still move a structure-scale body's
    // perimeter enough to roll. Snap it only after that point motion also
    // enters the rest band; compact bodies retain the angular threshold.
    if (shortSide > 0 && longSide < shortSide * 2
        && std::fabs(b->omega) < R_CONTACT_ZERO_SQUAT_ANG
        && (!rigidStructureScaleBody(b)
          || std::fabs(b->omega) * b->maxR
            < R_CONTACT_ZERO_SQUAT_POINT_SPEED))
      b->omega = 0;
  }
}

void RigidBodySystem::dampFluidContact(
    Body* b, bool fluidOnlyContact, bool fluidRestContact,
    bool densityEquilibrium) {
  if (fluidOnlyContact && densityEquilibrium
      && b->vx * b->vx + b->vy * b->vy
           < R_BOUNCE_MIN_SPEED * R_BOUNCE_MIN_SPEED
      && std::fabs(b->omega) < R_SETTLE_ANG * 2) {
    b->vx *= 0.25;
    b->vy *= 0.25;
    b->omega *= 0.25;
  }
  // Dissipate residual vertical surface waves once the body is already
  // inside the ordinary settling band; translation and spin stay physical
  // at larger speeds.
  if (fluidOnlyContact && fluidRestContact
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
}

void RigidBodySystem::updateSleepAge(
    Body* b, bool unbalancedSupport, bool liquidContact,
    bool fluidOnlyContact, bool fluidRestContact) {
  double sleepLinear = liquidContact
    ? R_FLUID_SLEEP_LIN : R_SLEEP_LIN;
  bool sleepQuiet = !unbalancedSupport && b->vx * b->vx + b->vy * b->vy < sleepLinear * sleepLinear
                 && b->omega * b->omega < R_SLEEP_ANG * R_SLEEP_ANG
                 && b->maxDepth <= R_REST_DEPTH;
  if (fluidOnlyContact && !fluidRestContact) sleepQuiet = false;
  if (sleepQuiet) {
    b->stillTicks++;
  } else if (fluidOnlyContact) {
    b->stillTicks = fluidRestContact
      ? imax(0, b->stillTicks - 1)
      : 0;
  } else {
    bool settling = b->vx * b->vx + b->vy * b->vy < R_SETTLE_LIN * R_SETTLE_LIN
                 && b->omega * b->omega < R_SETTLE_ANG * R_SETTLE_ANG
                 && b->maxDepth <= R_REST_DEPTH;
    b->stillTicks = settling ? std::fmax(0.0, b->stillTicks - 1.0) : 0;
  }
}

void RigidBodySystem::updateRestProbe(Body* body) {
  double cs = std::cos(body->angle), sn = std::sin(body->angle);
  double lx0 = body->offsetX - 0.5;
  double lx1 = body->offsetX + body->w - 0.5;
  double ly0 = body->offsetY - 0.5;
  double ly1 = body->offsetY + body->h - 0.5;
  double lx = std::fabs(lx0) >= std::fabs(lx1) ? lx0 : lx1;
  double ly = std::fabs(ly0) >= std::fabs(ly1) ? ly0 : ly1;
  const std::array<double, 6> points = {
    body->px, body->py,
    body->px + lx * cs, body->py + lx * sn,
    body->px - ly * sn, body->py + ly * cs,
  };
  if (body->restProbeTicks == 0) {
    body->restProbePoints = points;
    body->restProbeTicks = 1;
    return;
  }
  double radius2 = R_REST_PROBE_RADIUS * R_REST_PROBE_RADIUS;
  for (int point = 0; point < 3; point++) {
    double dx = points[point * 2] - body->restProbePoints[point * 2];
    double dy = points[point * 2 + 1] - body->restProbePoints[point * 2 + 1];
    if (dx * dx + dy * dy <= radius2) continue;
    body->restProbePoints = points;
    body->restProbeTicks = 1;
    return;
  }
  if (body->restProbeTicks < R_REST_PROBE_TICKS)
    body->restProbeTicks++;
}
