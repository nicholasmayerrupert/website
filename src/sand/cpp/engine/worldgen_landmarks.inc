  // Large surface landmarks use absolute plans, clipped writes, and column-wise
  // terrain contacts. Foreground shells remain traversable; background masonry
  // carries the architectural detail.
  void fillLandmarkGeneratedFeature(const GeneratedFeatureDef& feature,
      int colStart, int colEnd, int rowStart, int rowEnd) {
    int wx0 = L->worldOffsetX + colStart, wx1 = L->worldOffsetX + colEnd - 1;
    for (int q = floorDiv(wx0 - feature.overscanX, feature.latticeWidth);
         q <= floorDiv(wx1 + feature.overscanX, feature.latticeWidth); q++) {
      LandmarkPlan p;
      if (!worldContext.landmarkPlan(q, p) || p.right < wx0 || p.left > wx1
          || p.bottom < L->worldOffsetY + rowStart || p.top >= L->worldOffsetY + rowEnd) continue;
      const LandmarkDef& d = LANDMARKS[p.kind];
      const uint8_t wall = d.masonry, trim = d.trim, wood = d.timber;
      const bool backdrop = L->isBackground;
      ForegroundTerrainScope foregroundQuery(L);
      auto ground = [&](int x) { return terrain.genSurfaceAbs(p.center + x) - p.floorY; };
      auto put = [&](int x, int y, uint8_t mat) {
        int wx = p.center + x, wy = p.floorY + y;
        if (wx < p.left || wx > p.right || wy < p.top || wy > p.bottom) return;
        int lx = wx - L->worldOffsetX, ly = wy - L->worldOffsetY;
        if (lx >= colStart && lx < colEnd && ly >= rowStart && ly < rowEnd)
          stampGeneratedFeatureCell(feature, I(lx, ly), mat);
      };
      auto rect = [&](int l, int t, int r, int b, uint8_t mat) {
        for (int y = t; y <= b; y++) for (int x = l; x <= r; x++) put(x, y, mat);
      };
      auto line = [&](int x0, int y0, int x1, int y1, int width, uint8_t mat) {
        int steps = imax(1, imax(std::abs(x1 - x0), std::abs(y1 - y0)));
        for (int i = 0; i <= steps; i++) {
          int x = x0 + (int)std::lround((double)(x1 - x0) * i / steps);
          int y = y0 + (int)std::lround((double)(y1 - y0) * i / steps);
          rect(x - width / 2, y - width / 2, x + (width - 1) / 2, y + (width - 1) / 2, mat);
        }
      };
      auto ellipse = [&](int cx, int cy, int rx, int ry, uint8_t mat, bool outline) {
        for (int y = -ry; y <= ry; y++) for (int x = -rx; x <= rx; x++) {
          double r = (double)x * x / (rx * rx) + (double)y * y / (ry * ry);
          if (r <= 1 && (!outline || r >= .68)) put(cx + x, cy + y, mat);
        }
      };
      auto support = [&](int x, int top, uint8_t mat) {
        int soil = terrain.genSoilDepthAt(p.center + x, p.biome);
        int bottom = ground(x) + TerrainGen::GEN_SKIN + soil + 2;
        for (int y = top; y <= bottom; y++) {
          if (y >= ground(x) && terrain.genOpenCaveAt(p.center + x, p.floorY + y)) continue;
          put(x, y, y > ground(x) + 3 ? wall : mat);
        }
      };
      auto pad = [&](int l, int r, int y, uint8_t mat, bool approaches) {
        for (int x = l; x <= r; x++) support(x, y, (x - l) % 9 == 0 ? trim : mat);
        for (int x = l; x <= r; x++) for (int cy = y; cy <= y + 1; cy++)
          if (cy < ground(x) || !terrain.genOpenCaveAt(p.center + x, p.floorY + cy)) put(x, cy, mat);
        if (!approaches) return;
        for (int side : {-1, 1}) for (int step = 1; step <= 24; step++) {
          int x = (side < 0 ? l : r) + side * step;
          int g = ground(x), level = y + std::clamp(g - y, -step, step);
          for (int cy = g; cy < level; cy++) put(x, cy, EMPTY);
          support(x, level, step <= 4 ? mat : terrain.genSkinMat(p.biome, 0, false));
        }
      };
      auto window = [&](int cx, int cy, int rx, int ry) {
        if (!backdrop) return;
        for (int y = -ry; y <= ry; y++) for (int x = -rx; x <= rx; x++) {
          bool arch = y >= 0 || (double)x * x / (rx * rx) + (double)y * y / (ry * ry) <= 1;
          if (arch) put(cx + x, cy + y, x == 0 || y == 1 ? wood : GLASS);
        }
        rect(cx - rx - 1, cy + ry + 1, cx + rx + 1, cy + ry + 2, trim);
      };
      auto lamp = [&](int x, int y) {
        if (!backdrop) return;
        rect(x - 2, y - 2, x + 2, y + 2, wood);
        rect(x - 1, y - 1, x + 1, y + 1, GLASS);
        put(x, y, LIGHT);
      };
      auto room = [&](int l, int r, int top, int floor, uint8_t masonry) {
        for (int y = top; y <= floor; y++) for (int x = l; x <= r; x++) {
          bool shell = x < l + 2 || x > r - 2 || y < top + 2 || y > floor - 2;
          bool door = (x < l + 2 || x > r - 2) && y >= floor - PLAYER_H - 4 && y < floor - 1;
          put(x, y, backdrop ? masonry : shell && !door ? masonry : EMPTY);
        }
        if (backdrop) {
          for (int x = l + 3; x <= r - 3; x += 13) rect(x, top + 2, x, floor - 2, wood);
          rect(l + 2, top + 3, r - 2, top + 3, trim);
          for (int x = l + 9; x < r - 5; x += 21) window(x, top + 11, 3, 6);
          for (int x = l + 17; x < r - 8; x += 36) lamp(x, floor - 12);
          rect(l + 5, floor - 6, l + 15, floor - 5, wood);
          rect(l + 6, floor - 5, l + 7, floor - 2, wood);
          rect(l + 13, floor - 5, l + 14, floor - 2, wood);
          put(l + 10, floor - 7, CLAY); put(l + 11, floor - 7, CRYSTAL);
          for (int y = floor - 15; y < floor - 3; y += 5) {
            rect(r - 11, y, r - 4, y + 1, wood);
            for (int x = r - 10; x < r - 4; x += 3) rect(x, y - 3, x + 1, y - 1, x % 2 ? CLAY : trim);
          }
        }
      };
      auto gable = [&](int cx, int half, int y, int height, uint8_t mat) {
        for (int dx = -half; dx <= half; dx++) {
          int top = y - height * (half - std::abs(dx)) / half;
          rect(cx + dx, top, cx + dx, top + 3, mat);
          if (backdrop) rect(cx + dx, top + 4, cx + dx, y, wood);
        }
        if (backdrop) { line(cx - half, y, cx, y - height, 2, trim); line(cx, y - height, cx + half, y, 2, trim); }
      };
      auto crenels = [&](int l, int r, int y) {
        rect(l, y, r, y + 2, trim);
        for (int x = l; x < r; x += 7) rect(x, y - 4, imin(x + 3, r), y - 1, wall);
      };
      auto banner = [&](int x, int y, int length, uint8_t color) {
        if (!backdrop) return;
        rect(x - 1, y - 2, x + 6, y - 1, wood);
        rect(x, y, x + 4, y + length, color);
        rect(x + 1, y, x + 1, y + length - 2, trim);
        put(x, y + length, wall); put(x + 4, y + length, wall);
      };
      auto vines = [&](int l, int r, int y) {
        if (!backdrop) return;
        for (int x = l; x < r; x += 9) {
          int length = 3 + (int)(whash2(p.id, x, y) * 13);
          for (int dy = 0; dy < length; dy++) {
            put(x + dy / 6, y + dy, MOSS);
            if (dy % 3 == 0) put(x + dy / 6 + 1, y + dy, MOSS);
          }
        }
      };
      auto tower = [&](int cx, int half, int floor, int height, bool pointed) {
        room(cx - half, cx + half, floor - height, floor, wall);
        pad(cx - half, cx + half, floor, wall, false);
        for (int y = floor - 22; y > floor - height + 8; y -= 22) {
          rect(cx - half + 2, y, cx + half - 2, y + 1, wood);
          window(cx, y - 9, 3, 6);
          lamp(cx + half - 5, y - 6);
        }
        if (pointed) gable(cx, half + 3, floor - height, half + 9, trim);
        else crenels(cx - half - 2, cx + half + 2, floor - height - 2);
      };
      auto chamber = [&](int cx, int y, int half, int height) {
        room(cx - half, cx + half, y - height, y, wall);
        if (backdrop) {
          rect(cx - 10, y - 6, cx + 10, y - 3, trim);
          rect(cx - 8, y - 8, cx + 8, y - 7, wall);
          put(cx, y - 9, GOLD_ORE);
          lamp(cx - half + 5, y - 12); lamp(cx + half - 5, y - 12);
          for (int dx : {-half + 4, half - 4}) {
            rect(cx + dx - 1, y - 7, cx + dx + 1, y - 2, CLAY);
            put(cx + dx, y - 8, GOLD_ORE);
          }
        }
      };
      switch (p.kind) {
        case LM_WINDMILL: {
          room(-78, -14, -25, 0, wall); pad(-80, -12, 0, wall, true);
          gable(-46, 36, -25, 19, wood);
          room(20, 74, -23, 0, wall); pad(18, 76, 0, wall, true);
          gable(47, 31, -23, 16, wood);
          tower(4, 15, -1, 44, true);
          {
            ellipse(4, -46, 5, 5, trim, false);
            for (int side : {-1, 1}) {
              line(4, -46, 4 + side * 25, -46 + side * 25, 2, wood);
              line(4, -46, 4 + side * 25, -46 - side * 25, 2, wood);
              for (int r = 10; r <= 25; r += 3) {
                line(4 + side * r, -46 + side * r, 4 + side * (r - 6), -46 + side * (r + 6), 1, SANDSTONE);
                line(4 + side * r, -46 - side * r, 4 + side * (r + 6), -46 - side * (r - 6), 1, SANDSTONE);
              }
            }
          }
          break;
        }
        case LM_AQUEDUCT: {
          // Dressed arches carry a continuous channel. Wedge joints follow the
          // curve, while broad plinths and stepped abutments meet the hillside.
          for (int pier=-3;pier<=3;pier++) {
            int x=pier*29,base=ground(x);
            for(int dx=-4;dx<=4;dx++)support(x+dx,-37,wall);
            for(int dx=-7;dx<=7;dx++)support(x+dx,base-3+std::abs(dx)/3,wall);
            rect(x-6,base-3,x+6,base-2,SANDSTONE);
            rect(x-6,-39,x+6,-36,PALESTONE);
            rect(x-5,-35,x+5,-34,SANDSTONE);
            if(backdrop) {
              for(int y=-32;y<base-3;y+=6) {
                rect(x-4,y,x+4,y,PALESTONE);
                put(x+(y%12?-1:2),y+2,SANDSTONE);
              }
              rect(x-2,-32,x-1,base-5,SANDSTONE);
              if(pier%2==0)vines(x+2,x+5,-34);
            }
            if(pier==3)continue;
            for(int dx=0;dx<=29;dx++) {
              double nx=(dx-14.5)/14.5;
              int soffit=-14-(int)std::lround(16*std::sqrt(std::fmax(0.,1-nx*nx)));
              rect(x+dx,-40,x+dx,soffit+1,wall);
              for(int y=-38;y<soffit-3;y++) {
                bool course=(y+40)%5==0;
                bool joint=(dx+((y+40)/5%2)*4)%9==0;
                if(course || joint)put(x+dx,y,SANDSTONE);
              }
              int wedge=(int)((std::acos(std::clamp(nx,-1.,1.))/3.141592653589793)*13);
              rect(x+dx,soffit-2,x+dx,soffit+1,wedge%2?PALESTONE:SANDSTONE);
              if(dx>=13 && dx<=16)rect(x+dx,soffit-4,x+dx,soffit+2,PALESTONE);
            }
            if(backdrop) {
              ellipse(x+14,-36,3,3,SANDSTONE,false);
              put(x+14,-37,PALESTONE);put(x+14,-35,MOSS);
            }
          }
          rect(-96,-44,96,-40,wall);
          rect(-98,-45,98,-44,PALESTONE);
          rect(-97,-41,97,-40,SANDSTONE);
          if(backdrop)for(int x=-94;x<=94;x++) {
            put(x,-43,x%11==0?PALESTONE:DEEPSTONE);
            if(x%17<3)put(x,-40,MOSS);
          }
          for(int side:{-1,1})for(int step=0;step<10;step++) {
            int x=side*(91+step),y=-39+step*3;
            support(x,y,wall);put(x,y,PALESTONE);
          }
          for(int pier=-3;pier<=3;pier++) {
            int x=pier*29;
            if(!backdrop)rect(x-2,-32,x+2,-26,EMPTY);
            else {
              rect(x-3,-33,x+3,-25,SANDSTONE);
              lamp(x,-29);
            }
          }
          break;
        }
        case LM_CASTLE: {
          int west = std::clamp(ground(-70), -8, 8), east = std::clamp(ground(70), -8, 8);
          room(-70, 70, -25, 0, wall); pad(-72, 72, 0, wall, true); crenels(-68, 68, -27);
          tower(-70, 17, west, 59, false); tower(70, 17, east, 65, true);
          tower(-12, 23, 0, 55, false);
          if (!backdrop) rect(21, -15, 38, -2, EMPTY);
          if (backdrop) {
            rect(21, -15, 38, -2, wood);
            for (int x = 23; x < 38; x += 4) rect(x, -15, x, -2, IRON_ORE);
          }
          banner(-77, west - 37, 17, CLAY); banner(62, east - 40, 20, CLAY);
          break;
        }
        case LM_ABBEY: {
          room(-76, 47, -30, 0, wall); pad(-79, 50, 0, wall, true);
          gable(-15, 67, -30, 25, wall);
          tower(61, 17, 0, 58, false);
          for (int x = -68; x < 40; x += 23) {
            if (backdrop) rect(x, -34, x + 3, 0, wall); window(x + 12, -19, 5, 9);
          }
          if (backdrop) {
            ellipse(-14, -42, 10, 10, trim, false); ellipse(-14, -42, 7, 7, GLASS, false);
            line(-21, -49, -7, -35, 1, wall); line(-21, -35, -7, -49, 1, wall);
            for (int x = -61; x < 20; x += 19) rect(x, -6, x + 11, -4, wood);
          }
          vines(-67, 45, -29); vines(47, 72, -57);
          break;
        }
        case LM_PYRAMID: {
          pad(-102, 102, 0, wall, true);
          for (int x = -100; x <= 100; x++) {
            int top = -((100 - std::abs(x)) * 68 / 100);
            rect(x, top, x, 0, backdrop ? wall : EMPTY);
            rect(x, top, x, top + 3, wall);
            put(x, top, (top % 7 == 0) ? trim : PALESTONE);
            if (backdrop) for (int y = top + 5; y < 0; y += 10) put(x, y, x % 12 == 0 ? trim : wall);
          }
          for (int level = 0; level < 3; level++) {
            int floor = -level * 18, half = 88 - level * 28;
            rect(-half, floor, half, floor + 2, wall);
            if (backdrop) {
              for (int x = -half + 9; x < half - 5; x += 18) {
                rect(x - 2, floor - 13, x + 2, floor - 5, CLAY);
                line(x - 4, floor - 10, x + 4, floor - 10, 1, GOLD_ORE);
              }
              lamp(-half + 9, floor - 7); lamp(half - 9, floor - 7);
            }
            if (level < 2) for (int step = 0; step <= 24; step++) {
              int x = (level % 2 ? -1 : 1) * (half - 4 - step), y = floor - step * 18 / 24;
              if (!backdrop) rect(x, y - 12, x, y - 1, EMPTY);
              put(x, y, trim);
            }
          }
          rect(-3, -70, 3, -65, GOLD_ORE);
          chamber(0, 20, 23, 19); chamber(-43, 38, 18, 18); chamber(43, 38, 18, 18);
          for (int x = -99; x <= -20; x++) {
            int floor = (x + 99) * 20 / 79;
            rect(x, floor - 12, x, floor - 1, backdrop ? CLAY : EMPTY);
            put(x, floor, trim);
          }
          for (int side : {-1, 1}) for (int x = 20; x <= 43; x++) {
            int floor = 20 + (x - 20) * 18 / 23;
            rect(side * x, floor - 12, side * x, floor - 1, backdrop ? CLAY : EMPTY); put(side * x, floor, trim);
          }
          break;
        }
        case LM_TOMB: {
          for (int side : {-1, 1}) {
            room(side < 0 ? -73 : 39, side < 0 ? -39 : 73, -35, 0, wall);
            pad(side < 0 ? -75 : 37, side < 0 ? -37 : 75, 0, wall, true);
            for (int y = -35; y <= -30; y++) rect(side * 56 - 20 + (-30-y), y, side * 56 + 20 - (-30-y), y, wall);
            banner(side * 56 - 3, -28, 19, trim);
          }
          rect(-39, -25, 39, -20, wall); rect(-41, -29, 41, -26, trim);
          if (backdrop) for (int x = -30; x <= 30; x += 10) rect(x, -27, x + 3, -25, CLAY);
          chamber(-43, 37, 25, 22); chamber(43, 37, 25, 22); chamber(0, 56, 19, 18);
          for (int side : {-1, 1}) for (int x = 0; x <= 62; x++) {
            int floor = x * 37 / 62;
            rect(side * x, floor - 12, side * x, floor - 1, backdrop ? CLAY : EMPTY); put(side * x, floor, wall);
          }
          rect(-4, 25, 4, 54, backdrop ? CLAY : EMPTY);
          if (backdrop) for (int y = 26; y < 55; y += 4) rect(-4, y, 4, y, wood);
          break;
        }
        case LM_LEVIATHAN: {
          int facing = p.id & 8 ? 1 : -1;
          auto g = [&](int x) { return ground(x * facing); };
          auto boneLine = [&](int ax, int ay, int bx, int by, int width) {
            line(ax * facing, ay, bx * facing, by, width, BONE);
          };
          auto spineY = [&](int x) {
            return (g(x - 8) + g(x) + g(x + 8)) / 3 - 16
              - (int)std::lround(11 * std::sin((x + 60) * 3.141592653589793 / 150));
          };
          for (int x = -63; x <= 86; x += 2) {
            boneLine(x, spineY(x), x + 2, spineY(x + 2), x < 55 ? 4 : 3);
            if ((x + 63) % 10 < 2) {
              boneLine(x, spineY(x) - 4, x + 2, spineY(x) + 4, 3);
              put(facing * x, spineY(x) - 5, PALESTONE);
            }
          }
          for (int rib = 0; rib < 9; rib++) {
            int x = -57 + rib * 14, top = spineY(x);
            int endX = x + 8, endY = g(endX) + 4;
            int px = x, py = top;
            for (int i = 1; i <= 20; i++) {
              double t = i / 20.0;
              int nx = x + (int)std::lround(13 * std::sin(t * 2.4));
              int ny = top + (int)std::lround((endY - top) * t);
              boneLine(px, py, nx, ny, 3); px = nx; py = ny;
            }
            for (int dx = -1; dx <= 1; dx++) support(facing * (px + dx), py, BONE);
            if (backdrop) boneLine(x - 3, top + 2, x - 12, g(x - 12) + 2, 2);
          }
          int hy = g(-88) - 15;
          ellipse(facing * -88, hy, 23, 17, BONE, false);
          for (int x = -115; x <= -83; x++) for (int y = hy + 2; y <= hy + 10; y++) put(facing * x, y, BONE);
          for (int x = -113; x <= -88; x++) for (int y = hy + 7; y <= hy + 9; y++)
            if (y < g(x) - 2) put(facing * x, y, EMPTY);
          ellipse(facing * -86, hy - 2, 8, 8, EMPTY, false);
          ellipse(facing * -107, hy + 2, 3, 3, EMPTY, false);
          for (int x = -111; x <= -89; x += 5) boneLine(x, hy + 5, x + 1, hy + 10, 2);
          boneLine(-70, hy + 2, -63, spineY(-63), 5);
          boneLine(-78, hy - 11, -66, hy - 25, 3);
          boneLine(-66, hy - 25, -71, hy - 31, 2);
          // Broken limbs rest along the slope; knuckles and toes intersect soil.
          for (int side : {-1, 1}) {
            int x = side < 0 ? -33 : 39;
            int kneeX = x + side * 15, kneeY = g(kneeX) - 5;
            boneLine(x, spineY(x) + 4, kneeX, kneeY, 4);
            boneLine(kneeX, kneeY, kneeX + side * 13, g(kneeX + side * 13) + 2, 3);
            ellipse(facing * kneeX, kneeY, 4, 4, BONE, false);
          }
          boneLine(86, spineY(86), 86, g(86) - 5, 3);
          for (int x = 86; x < 112; x += 3) boneLine(x, g(x) - 5, x + 3, g(x + 3) - 3, 2);
          break;
        }
        case LM_OSSUARY: {
          // A rib-vaulted ceremonial hall, with tusks instead of masonry towers.
          room(-53, 53, -24, 0, PINE_WOOD); pad(-55, 55, 0, PALESTONE, true);
          for (int x = -59; x <= 59; x++) {
            int top = -24 - (int)std::lround(25 * std::sqrt(std::fmax(0.0, 1 - std::pow(x / 59.0, 2))));
            rect(x, top, x, top + 3, BONE);
            if (backdrop) rect(x, top + 4, x, -24, PINE_WOOD);
          }
          if (backdrop) for (int x = -42; x <= 42; x += 21) {
            line(x, -42 + std::abs(x) / 3, x + (x < 0 ? -7 : 7), -1, 3, BONE);
            banner(x + 6, -22, 13, CLAY);
          }
          for (int side : {-1, 1}) {
            int px = side * 73, py = ground(px);
            for (int dx = -3; dx <= 3; dx++) support(px + dx, py - 5, BONE);
            for (int t = 0; t <= 32; t++) {
              int x = px - side * t * t / 110;
              rect(x - imax(0, 3 - t / 10), py - t, x + imax(0, 3 - t / 10), py - t, BONE);
            }
          }
          if (backdrop) {
            ellipse(0, -39, 10, 8, BONE, false);
            ellipse(-4, -40, 2, 3, DEEPSTONE, false); ellipse(4, -40, 2, 3, DEEPSTONE, false);
            rect(-1, -37, 1, -35, DEEPSTONE);
            lamp(-30, -13); lamp(30, -13);
          }
          chamber(0, 30, 31, 20);
          rect(-5, -3, 5, 28, backdrop ? DEEPSTONE : EMPTY);
          break;
        }
        case LM_LONGHOUSE: {
          room(-80, 80, -25, 0, wood); pad(-82, 82, 0, STONE, true);
          gable(0, 86, -25, 23, PINE_WOOD);
          gable(-40, 18, -26, 13, STONE); gable(40, 18, -26, 13, STONE);
          rect(-6, -37, 2, -20, STONE); rect(-8, -40, 4, -37, ICE);
          for (int x = -76; x <= 76; x += 19) {
            if (backdrop) rect(x, -28, x + 2, 0, PINE_WOOD);
            if (backdrop) ellipse(x + 9, -11, 5, 5, IRON_ORE, true);
          }
          if (backdrop) {
            rect(-31, -7, 31, -5, OAK_WOOD);
            for (int x = -28; x <= 28; x += 9) rect(x, -4, x + 3, -2, OAK_WOOD);
            rect(-5, -4, 5, -2, STONE); put(0, -5, CRYSTAL);
          }
          for (int x = -85; x <= 85; x++) {
            int top = -25 - 23 * (86 - std::abs(x)) / 86;
            put(x, top - 1, ICE);
          }
          break;
        }
        case LM_ICEWATCH: {
          tower(-62, 18, -1, 55, true); tower(61, 20, 0, 61, true);
          rect(-44, -24, 41, -21, PINE_WOOD);
          if (backdrop) {
            for (int x = -43; x <= 41; x += 7) rect(x, -34, x, -25, PINE_WOOD);
            line(-44, -34, 41, -34, 2, PINE_WOOD);
          }
          for (int side : {-1, 1}) line(side * 44, -21, side * 56, -8, 3, STONE);
          if (backdrop) {
            for (int x = -40; x < 40; x += 11) line(x, -21, x + 9, -14, 1, ICE);
            banner(-70, -41, 17, ICE); banner(54, -47, 19, ICE);
          }
          break;
        }
        case LM_STEP_TEMPLE: {
          pad(-100, 100, 0, wall, true);
          for (int tier = 0; tier < 5; tier++) {
            int half = 96 - tier * 17, top = -12 * (tier + 1);
            rect(-half, top, half, -12 * tier, backdrop ? wall : EMPTY);
            rect(-half, top, -half + 2, -12 * tier, wall);
            rect(half - 2, top, half, -12 * tier, wall);
            rect(-half - 2, top, half + 2, top + 2, trim);
            if (backdrop) for (int x = -half + 5; x < half - 3; x += 11) {
              rect(x, top + 5, x + 5, top + 8, CLAY); put(x + 2, top + 6, MOSS);
            }
            vines(-half + 2, half, top + 2);
            lamp(-half + 9, top + 7); lamp(half - 9, top + 7);
          }
          room(-18, 18, -79, -60, wall); rect(-22, -82, 22, -79, CLAY);
          if (backdrop) {
            for (int side : {-1, 1}) {
              rect(side * 12 - 2, -76, side * 12 + 2, -61, CLAY);
              ellipse(side * 12, -72, 4, 4, GOLD_ORE, true);
            }
            rect(-4, -75, 4, -61, DEEPSTONE);
          }
          // The section exposes a descending gallery and a central burial chamber.
          for (int x = -98; x <= -22; x++) {
            int floor = (x + 98) * 18 / 76;
            rect(x, floor - 12, x, floor - 1, backdrop ? CLAY : EMPTY); put(x, floor, wall);
          }
          chamber(0, 22, 25, 22);
          if (backdrop) for (int y = -57; y < -1; y += 3) rect(-5, y, 5, y + 1, CLAY);
          break;
        }
        case LM_SANCTUARY: {
          pad(-83, 83, 0, wall, true);
          for (int x = -72; x <= 72; x += 24) {
            rect(x - 3, -32, x + 3, -2, wall); rect(x - 6, -35, x + 6, -31, trim);
            rect(x - 5, -3, x + 5, 0, trim);
            if (backdrop) rect(x, -29, x + 1, -5, CLAY);
          }
          rect(-80, -39, 80, -35, wall); rect(-82, -42, 82, -40, trim);
          room(-25, 25, -35, 0, wall); gable(0, 30, -35, 17, CLAY);
          if (backdrop) {
            ellipse(0, -21, 12, 12, GOLD_ORE, true);
            rect(-3, -28, 3, -4, STONE); rect(-11, -17, 11, -13, STONE);
            ellipse(0, -28, 6, 6, STONE, false); put(-2, -29, CRYSTAL); put(2, -29, CRYSTAL);
          }
          // Roots interrupt the colonnade, and a collapsed corner becomes talus.
          rect(61, -43, 77, -32, EMPTY);
          for (int x = 61; x <= 81; x++) support(x, ground(x) - (x % 5), STONE);
          vines(-79, 60, -38); vines(78, 80, -38);
          break;
        }
        case LM_STILT_HAMLET: {
          for (int house = -1; house <= 1; house++) {
            int cx = house * 66, floor = house == 0 ? -7 : -2;
            room(cx - 23, cx + 23, floor - 22, floor, OAK_WOOD);
            gable(cx, 27, floor - 22, 15, wood);
            for (int side : {-1, 1}) {
              for (int dx = 0; dx < 3; dx++) support(cx + side * 20 + dx, floor, wood);
              if (backdrop) line(cx + side * 20, floor, cx - side * 20, ground(cx) + 1, 2, wood);
            }
            vines(cx - 24, cx + 24, floor - 21);
          }
          for (int x = -101; x <= 101; x++) {
            int floor = -3 - (int)std::lround(3 * std::cos(x * .025));
            put(x, floor, wood); put(x, floor + 1, wood);
            if (backdrop && x % 8 == 0) rect(x, floor - 7, x, floor - 1, wood);
            if (x % 24 == 0) for (int dx = 0; dx < 2; dx++) support(x + dx, floor, wood);
          }
          if (backdrop) {
            for (int x : {-43, 41}) {
              line(x, -6, x + 8, 4, 1, wood);
              rect(x + 8, 4, x + 8, 11, MOSS);
              for (int y = 3; y < 12; y += 2) line(x + 7, y, x + 12, y, 1, MOSS);
            }
          }
          break;
        }
        case LM_SUNKEN_ROTUNDA: {
          int floor = 9;
          room(-49, 49, -24, floor, wall); pad(-51, 51, floor, wall, false);
          for (int x = -55; x <= 55; x++) {
            int top = -24 - (int)std::lround(27 * std::sqrt(std::fmax(0.0, 1 - std::pow(x / 55.0, 2))));
            rect(x, top, x, top + 3, wall);
            if (backdrop) rect(x, top + 4, x, -24, wall);
          }
          for (int x = -42; x <= 42; x += 21) {
            if (backdrop) rect(x - 2, -27, x + 2, floor, wall); window(x + 9, -14, 5, 8);
          }
          for (int x = 58; x <= 78; x++) support(x, ground(x) - std::abs(x - 68) / 5, STONE);
          if (backdrop) {
            ellipse(0, -10, 13, 13, MOSS, true); rect(-6, -4, 6, floor - 2, STONE);
            vines(-51, 51, -24);
          }
          break;
        }
        case LM_IRIS_CATHEDRAL: {
          room(-54, 54, -35, 0, wall); pad(-56, 56, 0, wall, true);
          gable(0, 60, -35, 29, EYE_WOOD);
          tower(-72, 14, 0, 61, true); tower(72, 14, 0, 66, true);
          for (int x = -42; x <= 42; x += 21) {
            if (backdrop) line(x, -44, x + (x < 0 ? -9 : 9), -3, 3, EYE_WOOD);
            window(x + 10, -21, 4, 9);
          }
          if (backdrop) {
            stampEyeGlyph(put, 0, -44, 16, 10, p.id & 8 ? -1 : 1);
            for (int x = -32; x <= 32; x += 16) {
              rect(x - 4, -7, x + 4, -5, EYE_WOOD); put(x, -8, EYE_SCLERA);
            }
            rect(-8, -4, 8, -2, PALESTONE); stampEyeGlyph(put, 0, -12, 7, 5);
          }
          break;
        }
        case LM_STAR_OBSERVATORY: {
          room(-80, -22, -26, 0, wall); pad(-82, -20, 0, wall, true);
          tower(40, 35, 0, 40, false);
          for (int x = 3; x <= 77; x++) {
            int top = -43 - (int)std::lround(27 * std::sqrt(std::fmax(0.0, 1 - std::pow((x - 40) / 37.0, 2))));
            rect(x, top, x, top + 3, PALESTONE);
            if (backdrop) rect(x, top + 4, x, -42, EYE_WOOD);
          }
          rect(-23, -21, 6, -18, wall); rect(-23, -28, 6, -27, EYE_WOOD);
          if (backdrop) {
            ellipse(-50, -15, 13, 10, CRYSTAL, true);
            line(-63, -15, -37, -15, 1, GOLD_ORE); line(-50, -25, -50, -5, 1, GOLD_ORE);
            line(39, -47, 64, -70, 6, EYE_WOOD);
            line(40, -49, 65, -72, 2, PALESTONE);
            ellipse(66, -73, 5, 5, EYE_IRIS, false);
            for (int y = -30; y <= -9; y += 7) {
              rect(16, y, 29, y + 1, wood);
              for (int x = 18; x < 29; x += 4) put(x, y - 1, CRYSTAL);
            }
          }
          gable(-51, 32, -26, 15, EYE_WOOD);
          break;
        }
        case LM_BONE_CAMP:
        case LM_BONE_LOOKOUT: {
          // Palisades follow the slope. Their sharpened tips and lashings are
          // decorative background cells, leaving the foreground path open.
          auto palisade = [&]() {
            if (!backdrop) return;
            for (int x = -90; x <= 90; x += 7) {
              if (std::abs(x) < (p.kind == LM_BONE_CAMP ? 80 : 28)) continue;
              int base = ground(x);
              if (p.kind == LM_BONE_CAMP) {
                int edge = x < 0 ? -74 : 74, step = std::abs(x - edge);
                int floor = ground(x < 0 ? -49 : 49) - 1;
                if (step <= 24) base = floor + std::clamp(base - floor, -step, step);
              }
              int h = 15 + (int)(whash2(p.id, x, 1) * 9);
              for (int dx = -2; dx <= 2; dx++) {
                support(x + dx, base, PINE_WOOD);
                rect(x + dx, base - h + std::abs(dx), x + dx, base + 2, PINE_WOOD);
              }
              rect(x - 2, base - h + 4, x + 2, base - h + 5, BONE);
              rect(x - 3, base - 8, x + 3, base - 7, OAK_WOOD);
              line(x, base - h, x + (x < 0 ? -3 : 3), base - h - 5, 2, BONE);
            }
          };
          if (p.kind == LM_BONE_CAMP) {
            for (int side : {-1, 1}) {
              int cx = side * 49, floor = ground(cx) - 1;
              room(cx - 24, cx + 24, floor - 20, floor, PINE_WOOD);
              pad(cx - 25, cx + 25, floor, DEEPSTONE, true);
              gable(cx, 30, floor - 20, 19, PINE_WOOD);
              line(cx - 30, floor - 20, cx + 4, floor - 44, 2, BONE);
              line(cx + 30, floor - 20, cx - 4, floor - 44, 2, BONE);
              if (backdrop) {
                for (int x = -15; x <= 15; x += 6) line(cx + x, floor - 18, cx + x / 2, floor - 30, 1, BONE);
                banner(cx - 4, floor - 19, 13, CLAY);
              }
            }
            if (backdrop) {
              int y = ground(0);
              line(-13, y, -10, y - 27, 3, PINE_WOOD); line(13, y, 10, y - 27, 3, PINE_WOOD);
              line(-14, y - 25, 14, y - 25, 2, BONE);
              for (int dy = 0; dy < 15; dy++) rect(-7 + dy / 5, y - 24 + dy, 7 - dy / 5, y - 24 + dy, CLAY);
              for (int side : {-1, 1}) for (int dx = -1; dx <= 1; dx++) support(side * 13 + dx, y, PINE_WOOD);
              line(0, y - 25, 0, y - 7, 1, PINE_WOOD);
              lamp(0, y - 5);
            }
          } else {
            int floor = ground(0) - 35;
            for (int side : {-1, 1}) {
              for (int dx = -2; dx <= 2; dx++) support(side * 18 + dx, floor, PINE_WOOD);
              if (backdrop) line(side * 18, floor, -side * 18, ground(-side * 18), 2, BONE);
            }
            room(-25, 25, floor - 18, floor, PINE_WOOD);
            gable(0, 32, floor - 18, 17, BONE);
            rect(-32, floor, 32, floor + 2, PINE_WOOD);
            if (backdrop) {
              for (int y = floor + 3; y <= ground(0); y += 4) rect(-4, y, 4, y, BONE);
              rect(-5, floor, -5, ground(-5), PINE_WOOD); rect(5, floor, 5, ground(5), PINE_WOOD);
              banner(-22, floor + 4, 19, CLAY); banner(17, floor + 4, 15, CLAY);
            }
            if (backdrop) for (int side : {-1, 1}) {
              int x = side * 61, y = ground(x);
              for (int dx = -2; dx <= 2; dx++) support(x + dx, y - 25, PINE_WOOD);
              ellipse(x, y - 28, 7, 6, BONE, false);
              put(x - 3, y - 29, DEEPSTONE); put(x + 3, y - 29, DEEPSTONE);
              for (int dy = 5; dy < 23; dy += 6) rect(x - 3, y - dy, x + 3, y - dy + 1, BONE);
            }
          }
          palisade();
          break;
        }
        case LM_IGLOO_CLUSTER: {
          for (int house = -1; house <= 1; house++) {
            int cx = house * 62, radius = house == 0 ? 28 : 22;
            int floor = ground(cx) - 2, height = house == 0 ? 28 : 23;
            pad(cx - radius, cx + radius, floor, ICE, false);
            for (int dx = -radius; dx <= radius; dx++) {
              int top = floor - 5 - (int)std::lround(height * std::sqrt(std::fmax(0.0, 1 - std::pow(dx / (double)radius, 2))));
              for (int y = top; y < floor; y++) {
                bool shell = y <= top + 3 || std::abs(dx) >= radius - 2;
                uint8_t mat = ICE;
                if (backdrop && !shell) {
                  bool seam = (y - floor) % 6 == 0 || (dx + 100 + ((y - floor) / 6 % 2) * 4) % 9 == 0;
                  mat = seam ? ICE : PALESTONE;
                }
                put(cx + dx, y, backdrop || shell ? mat : EMPTY);
              }
              put(cx + dx, top - 1, SNOW);
            }
            // Low, roofed entrance tunnels open through the dome's side wall.
            for (int side : {-1, 1}) for (int dx = radius - 5; dx <= radius + 11; dx++) {
              int x = cx + side * dx;
              rect(x, floor - 16, x, floor + 1, backdrop ? ICE : EMPTY);
              rect(x, floor - 16, x, floor - 14, ICE);
              put(x, floor - 17, SNOW);
              support(x, floor, ICE);
            }
            if (backdrop) {
              rect(cx + 4, floor - 5, cx + radius - 5, floor - 2, PINE_WOOD);
              rect(cx + 5, floor - 6, cx + radius - 6, floor - 6, MOSS);
              ellipse(cx - 7, floor - 15, 3, 4, GLASS, false);
              lamp(cx, floor - 10);
              rect(cx - 12, floor - 3, cx - 7, floor - 2, CLAY);
            }
          }
          break;
        }
        default: break;
      }
      // Settled fragments and biome soil conceal straight foundation edges.
      if (p.kind != LM_LEVIATHAN && p.kind != LM_IGLOO_CLUSTER && p.biome != BIOME_SWAMP) {
        for (int side : {-1, 1}) for (int i = 0; i < 4; i++) {
          int x = side * (d.halfWidth - 4 + i * 3), y = ground(x);
          for (int dx = -1; dx <= 1; dx++) support(x + dx, y - (i % 2), wall);
        }
      }
      auto route = [&](int x0, int y0, int x1, int y1) {
        stampStructureRoute(put, x0, y0, x1, y1, wood, backdrop);
      };
      auto well = [&](int cx, int half, int top, int floor) {
        if (!backdrop) rect(cx - half, top, cx + half, floor - 1, EMPTY);
        stampStructureLandings(put, cx, half, top, floor, wood);
      };
      // Entrances, buried galleries, and shared landings stay open after all
      // roofs, foundations, columns, and furnishings have been composed.
      switch (p.kind) {
        case LM_WINDMILL:
          route(-80, -1, 78, -1);
          break;
        case LM_CASTLE:
          route(-112, ground(-112), -88, -1); route(-88, -1, 88, -1);
          route(88, -1, 112, ground(112));
          break;
        case LM_ABBEY:
          route(-78, -1, 79, -1);
          break;
        case LM_PYRAMID:
          route(-102, 0, 102, 0);
          route(86, 0, 56, -18); route(-56, -18, -28, -36);
          route(-99, 0, -20, 19); route(-20, 19, 20, 19);
          route(-43, 37, -20, 19); route(20, 19, 43, 37);
          break;
        case LM_TOMB:
          route(-75, -1, 75, -1);
          route(0, -1, 62, 36); route(-62, 36, 0, -1);
          route(-63, 36, -20, 36); route(20, 36, 63, 36);
          well(0, 6, -4, 55);
          break;
        case LM_OSSUARY:
          route(-100, ground(-100), -55, -1); route(-55, -1, 55, -1);
          route(55, -1, 100, ground(100)); well(0, 6, -4, 29);
          break;
        case LM_LONGHOUSE:
          route(-82, -1, 82, -1);
          break;
        case LM_ICEWATCH:
          route(-112, ground(-112), -81, -2); route(-81, -2, -43, -2);
          route(40, -1, 82, -1); route(82, -1, 112, ground(112));
          route(-49, -24, 47, -24);
          break;
        case LM_STEP_TEMPLE:
          route(-100, 0, 100, 0);
          route(-40, 0, 12, -61); well(20, 6, -59, 0);
          route(-98, 0, -22, 18); route(-22, 18, 0, 21);
          break;
        case LM_AQUEDUCT:
        case LM_SANCTUARY:
          for (int x = -d.halfWidth; x < d.halfWidth; x++)
            route(x, p.kind == LM_SANCTUARY ? -1 : ground(x),
                  x + 1, p.kind == LM_SANCTUARY ? -1 : ground(x + 1));
          break;
        case LM_STILT_HAMLET:
          route(-106, ground(-106), -89, -3);
          route(-89, -3, -43, -3); route(-43, -3, -23, -8);
          route(-23, -8, 23, -8); route(23, -8, 43, -3);
          route(43, -3, 89, -3); route(89, -3, 106, ground(106));
          break;
        case LM_SUNKEN_ROTUNDA:
          route(-73, ground(-73), -47, 8); route(-47, 8, 47, 8);
          route(47, 8, 73, ground(73));
          break;
        case LM_IRIS_CATHEDRAL:
          route(-112, ground(-112), -88, -1); route(-88, -1, 88, -1);
          route(88, -1, 112, ground(112));
          break;
        case LM_STAR_OBSERVATORY:
          route(-106, ground(-106), -82, -1); route(-82, -1, 77, -1);
          route(77, -1, 106, ground(106));
          break;
        case LM_IGLOO_CLUSTER: {
          const int xs[] = {-110, -95, -62, 0, 62, 95, 110};
          const int ys[] = {ground(-110), ground(-62)-2, ground(-62)-2,
            ground(0)-2, ground(62)-2, ground(62)-2, ground(110)};
          for (int i = 1; i < 7; i++)
            stampStructureRoute(put, xs[i-1], ys[i-1], xs[i], ys[i], ICE, backdrop);
          break;
        }
        case LM_BONE_CAMP:
          route(-74, ground(-49) - 2, -25, ground(-49) - 2);
          route(-25, ground(-49) - 2, 25, ground(49) - 2);
          route(25, ground(49) - 2, 74, ground(49) - 2);
          break;
        case LM_BONE_LOOKOUT:
          for(int x=-100;x<100;x++)route(x,ground(x)-1,x+1,ground(x+1)-1);
          well(0, 6, ground(0) - 45, ground(0));
          break;
        default: break;
      }
      // Open stairwells after composing adjoining roofs and aisles. Landings
      // alternate sides, with room to jump past them and step onto every deck.
      auto towerWell = [&](int cx, int floor, int height) {
        well(cx, 6, floor - height + 3, floor - 1);
      };
      switch (p.kind) {
        case LM_WINDMILL: towerWell(4, -1, 44); break;
        case LM_CASTLE:
          towerWell(-70, std::clamp(ground(-70), -8, 8), 59);
          towerWell(70, std::clamp(ground(70), -8, 8), 65);
          towerWell(-12, 0, 55); break;
        case LM_ABBEY: towerWell(61, 0, 58); break;
        case LM_ICEWATCH: towerWell(-62, -1, 55); towerWell(61, 0, 61); break;
        case LM_IRIS_CATHEDRAL: towerWell(-72, 0, 61); towerWell(72, 0, 66); break;
        case LM_STAR_OBSERVATORY: towerWell(40, 0, 40); break;
        default: break;
      }

    }
  }
