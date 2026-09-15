void RigidBodySystem::prepareRigidContactState(
    const StepState& step, SubstepState& state) {
  solverContactScratch.clear();
  broadphaseOrderScratch.clear();
  broadphasePairScratch.clear();
  if (broadphasePairScratch.capacity() < (size_t)step.n * 4)
    broadphasePairScratch.reserve((size_t)step.n * 4);
  state.bodyIndexById.reserve((size_t)step.n * 2);
  for (int i = 0; i < step.n; i++) state.bodyIndexById[rigidBodyKey(step.solverBodies[i])] = i;
  std::vector<uint8_t> broadphaseSeen(step.n, 0);
  for (uint64_t id : broadphaseBodyIds) {
    auto it = state.bodyIndexById.find(id);
    if (it == state.bodyIndexById.end() || broadphaseSeen[it->second]) continue;
    broadphaseSeen[it->second] = 1;
    broadphaseOrderScratch.push_back(it->second);
  }
  for (int i = 0; i < step.n; i++)
    if (!broadphaseSeen[i]) broadphaseOrderScratch.push_back(i);
  for (auto& ticks : impactContactTicks)
    for (auto it = ticks.begin(); it != ticks.end();)
      if (it->second < E.tick - R_IMPACT_SOUND_SEPARATION_TICKS)
        it = ticks.erase(it);
      else ++it;
  for (auto& axes : pairAxes)
    for (auto it = axes.begin(); it != axes.end();)
      if (it->second.age >= 4) it = axes.erase(it);
      else { it->second.age++; ++it; }
}

void RigidBodySystem::solveRigidStep(StepState& step, double tickDt) {
  double setupStart = emscripten_get_now();
  SubstepState state(step.n, contactCache);
  ContactGeometry geometry(*this, step.n);
  prepareRigidContactState(step, state);
  rigidContactSetupMs += emscripten_get_now() - setupStart;
  for (int sub = 0; sub < step.substeps; sub++) {
    const auto priorTraceBiasByKind = rigidTraceBiasByKind;
    double phaseStart = emscripten_get_now();
    prepareRigidSubstep(step, state, sub, tickDt);
    rigidMotionPrepMs += emscripten_get_now() - phaseStart;

    phaseStart = emscripten_get_now();
    generateRigidContacts(step, state, geometry);
    classifyRigidContacts(step, state);
    rigidContactMs += emscripten_get_now() - phaseStart;

    phaseStart = emscripten_get_now();
    prepareRigidConstraints(step, sub);
    buildRigidIslands(step, state);
    solveRigidIslands(step, state);
    limitRigidBiasMotion(step, state, priorTraceBiasByKind);
    publishRigidContacts(step, state, sub);
    rigidSolveMs += emscripten_get_now() - phaseStart;

    phaseStart = emscripten_get_now();
    integrateRigidSubstep(step, state, sub, tickDt);
    projectRigidContacts(step, state, geometry, sub);
    rigidIntegrateMs += emscripten_get_now() - phaseStart;
  }
}
