// Status cues use the same confirmed actor pose and clock as the character.
// They are presentation primitives: they neither spawn cells nor consume RNG.
void GLPresenter::glDrawStatusEffects(int visuals, double x, double y, double w, double h, double phase, int species) {
  if (!visuals) return;
  double sw = E.content.spriteWidth * E.content.pixelScale;
  double sh = E.content.spriteHeight * E.content.pixelScale;
  bool groundedSprite = true;
  if (species >= 0 && species < CS_COUNT) {
    const auto& art = E.content.creatureArt[species];
    const auto& definition = CREATURE_SPECIES[species];
    sw = art.width * art.scale; sh = art.height * art.scale;
    groundedSprite = definition.humanNpc || definition.locomotion == CL_AMPHIBIOUS || definition.locomotion == CL_STATIONARY;
  }
  x += (w - sw) * .5; y += (h - sh) * (groundedSprite ? 1 : .5);
  w = sw; h = sh;
  double sx = (x - std::floor(glCamX)) * glCellDev + glOffX;
  double sy = (y - std::floor(glCamY)) * glCellDev + glOffY;
  if (sx + (w + 4) * glCellDev < 0 || sy + (h + 4) * glCellDev < 0
      || sx - 4 * glCellDev > glDevW || sy - 4 * glCellDev > glDevH) return;
  double clock = E.actorTick / 60.0 + phase;
  auto rect = [&](double px, double py, double rw, double rh, float r, float g, float b, float alpha = 1) {
    glUniform4f(glc->uColor, r, g, b, alpha);
    glSolidDev(sx + px * glCellDev, sy + py * glCellDev, rw * glCellDev, rh * glCellDev);
  };
  if (visuals & SV_FIRE) for (int i = 0; i < 6; i++) {
    double age = std::fmod(clock * 1.8 + i * .173, 1.0);
    double px = -.4 + (w + .8) * (i + .5) / 6;
    double py = h - .5 - age * std::max(3.0, h * .8);
    float alpha = (float)(1 - age * .65);
    rect(px - .45, py, .9, 1.6, .95f, .24f, .07f, alpha);
    rect(px - .2, py + .45, .4, .9, 1, .78f, .23f, alpha);
    rect(px + .05, py - .5, .3, .5, 1, .58f, .13f, alpha);
  }
  if (visuals & SV_FROST) {
    rect(-.25, h - .9, w + .5, .7, .43f, .79f, .97f, .65f);
    for (int i = 0; i < 5; i++) {
      double px = (i % 2 ? w : 0) - .4;
      double py = h * (.12 + .16 * i);
      rect(px, py, .8, 1.2, .48f, .80f, 1, .85f);
      rect(px + .2, py - .35, .35, 1.2, .86f, .98f, 1);
    }
  }
  if (visuals & SV_VINES) for (int i = 0; i < 7; i++) {
    double py = h - .4 - i * std::min(.65, h / 8);
    double px = w * .5 + std::sin(i * 1.5) * (w * .5 + .3);
    rect(px - .35, py, .7, .9, .22f, .40f, .16f);
    rect(px + (i % 2 ? -.8 : .3), py - .15, .65, .35, .61f, .77f, .28f);
  }
  if (visuals & SV_POISON) for (int i = 0; i < 4; i++) {
    double age = std::fmod(clock * .65 + i * .27, 1.0);
    double px = w * (i + .5) / 4 + std::sin(clock * 2 + i) * .5;
    double py = h - age * (h + 1.5);
    rect(px - .45, py, .9, .8, .39f, .59f, .12f, .8f);
    rect(px - .15, py - .15, .4, .35, .76f, .93f, .33f);
  }
  if (visuals & SV_BLEED) for (int i = 0; i < 3; i++) {
    double age = std::fmod(clock * 1.1 + i * .37, 1.0);
    double px = w * (.2 + i * .3);
    rect(px, h * .3 + age * h * .8, .7, 1.1, .94f, .12f, .20f, (float)(1 - age * .5));
  }
  if (visuals & SV_HEAL) for (int i = 0; i < 3; i++) {
    double age = std::fmod(clock * .65 + i * .37, 1.0);
    double px = w * (.15 + i * .35), py = h - age * (h + 1);
    float alpha = (float)(.9 - age * .5);
    rect(px - .55, py, 1.1, .3, .61f, 1, .61f, alpha);
    rect(px - .15, py - .4, .3, 1.1, .82f, 1, .72f, alpha);
  }
  if (visuals & SV_SPEED) for (int i = 0; i < 3; i++) {
    double age = std::fmod(clock * 1.6 + i * .37, 1.0);
    double py = h * (.25 + i * .25);
    rect(-2 + age * (w + 2), py, 2.4, .4, 1, .88f, .40f, (float)(.8 - age * .4));
  }
  if (visuals & SV_SHOCK) {
    // Two small stepped bolts cling to the torso; connected corners make
    // residual electricity readable without obscuring the actor's silhouette.
    static constexpr double ZIG[7] = {0, -.45, .35, -.20, .50, -.30, 0};
    int beat = (int)std::floor(clock * 12);
    double span = std::max(1.8, std::min(7.0, h * .48));
    double width = std::max(.45, std::min(1.25, w * .09));
    for (int side = 0; side < 2; side++) {
      double baseX = w * (side ? .74 : .24), baseY = h * (side ? .34 : .24);
      double sign = (beat + side) % 2 ? -1 : 1;
      float r = side ? .48f : .66f, g = side ? .78f : .90f;
      double previous = baseX;
      for (int step = 1; step <= 6; step++) {
        double px = baseX + ZIG[step] * width * sign, py = baseY + (step - 1) * span / 6;
        rect(std::min(previous, px) - .10, py, std::fabs(px - previous) + .20, .20, r, g, 1);
        rect(px - .10, py, .20, span / 6 + .12, r, g, 1);
        previous = px;
      }
      double tipY = baseY + span;
      rect(previous - .23, tipY - .10, .46, .20, .85f, .96f, 1);
      rect(previous - .10, tipY - .23, .20, .46, .85f, .96f, 1);
    }
  }
  if (visuals & SV_WATER) for (int i = 0; i < 3; i++) {
    double age = std::fmod(clock * .9 + i * .37, 1.0);
    double px = w * (.15 + i * .35), py = age * (h + .8);
    rect(px, py, .55, 1.0, .32f, .64f, .96f, .9f);
    rect(px, py + .6, .75, .4, .64f, .87f, 1, .9f);
  }
}
