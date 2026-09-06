  // Access routes are stamped after ornament. Clearance covers the player's
  // whole body on a slope; two-cell treads stay connected to adjacent steps.
  template<class Put>
  static void stampStructureRoute(Put&& put, int x0, int floor0, int x1, int floor1,
                                  uint8_t tread, bool background) {
    if (x0 > x1) { std::swap(x0, x1); std::swap(floor0, floor1); }
    int run = imax(1, x1 - x0);
    for (int x = x0; x <= x1; x++) {
      int floor = floor0 + (int)std::lround((double)(floor1 - floor0) * (x - x0) / run);
      if (!background) for (int y = floor - PLAYER_H - 5; y < floor; y++) put(x, y, EMPTY);
      put(x, floor, tread); put(x, floor + 1, tread);
    }
  }

  // Alternating landings make vertical service wells climbable with ordinary
  // jumps. Their spacing is below the jump apex and each ledge fits a full body.
  template<class Put>
  static void stampStructureLandings(Put&& put, int cx, int half, int top, int bottom,
                                     uint8_t tread) {
    int ordinal = 0;
    for (int y = bottom - 12; y > top + 2; y -= 12, ordinal++) {
      int x0 = (ordinal & 1) ? cx + half - PLAYER_W : cx - half;
      for (int x = x0; x <= x0 + PLAYER_W; x++) put(x, y, tread);
    }
  }
