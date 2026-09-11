  // Large surface landmarks use absolute plans, clipped writes, and column-wise
  // terrain contacts. Foreground shells remain traversable; background masonry
  // carries the architectural detail.
  __attribute__((minsize, noinline))
  void fillLandmarkGeneratedFeature(const GeneratedFeatureDef& feature,
      int colStart, int colEnd, int rowStart, int rowEnd) {
#pragma clang attribute push (__attribute__((minsize)), apply_to = function)
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
      // Arch bands use a connected lower edge even at steep spring points.
      auto archBand = [&](int cx, int spring, int half, int rise, int width, uint8_t mat) {
        auto topAt = [&](int dx) {
          return spring - (int)std::lround(rise * std::sqrt(std::fmax(0., 1. - (double)dx * dx / (half * half))));
        };
        for (int dx = -half; dx <= half; dx++) {
          int top = topAt(dx), bottom = top + width - 1;
          if (dx > -half) bottom = imax(bottom, topAt(dx - 1));
          if (dx < half) bottom = imax(bottom, topAt(dx + 1));
          rect(cx + dx, top, cx + dx, bottom, mat);
        }
      };
      auto pendant = [&](int x, int ceiling, uint8_t metal) {
        rect(x, ceiling, x, ceiling + 3, metal);
        rect(x - 2, ceiling + 4, x + 2, ceiling + 4, metal);
        rect(x - 1, ceiling + 5, x + 1, ceiling + 5, LIGHT);
      };
      auto column = [&](int x, int top, int floor, uint8_t mat) {
        rect(x - 2, top, x + 2, floor, mat);
        rect(x - 4, top, x + 4, top + 2, PALESTONE);
        rect(x - 4, floor - 2, x + 4, floor, PALESTONE);
        if (backdrop) rect(x, top + 4, x, floor - 4, SANDSTONE);
      };
      auto rose = [&](int x, int y, int radius, uint8_t frame) {
        if (!backdrop) return;
        ellipse(x, y, radius, radius, frame, false);
        ellipse(x, y, radius - 2, radius - 2, GLASS, false);
        for (int petal = 0; petal < 8; petal++) {
          double angle = petal * 3.141592653589793 / 4.;
          line(x, y, x + (int)std::lround((radius - 1) * std::cos(angle)),
            y + (int)std::lround((radius - 1) * std::sin(angle)), 1, frame);
        }
        ellipse(x, y, 2, 2, GOLD_ORE, false); put(x, y, LIGHT);
      };
      auto room = [&](int l, int r, int top, int floor, uint8_t masonry, bool ceilingLights = true) {
        for (int y = top; y <= floor; y++) for (int x = l; x <= r; x++) {
          bool shell = x < l + 2 || x > r - 2 || y < top + 2 || y > floor - 2;
          bool door = (x < l + 2 || x > r - 2) && y >= floor - PLAYER_H - 4 && y < floor - 1;
          put(x, y, backdrop ? masonry : shell && !door ? masonry : EMPTY);
        }
        if (backdrop) {
          bool domestic = p.kind == LM_WINDMILL || p.kind == LM_LONGHOUSE
            || p.kind == LM_STILT_HAMLET || p.kind == LM_BONE_CAMP || p.kind == LM_BONE_LOOKOUT;
          if (domestic) {
            for (int x = l + 3; x <= r - 3; x += 13) rect(x, top + 2, x, floor - 2, wood);
          } else {
            for (int y = top + 7; y < floor - 2; y += 7) {
              rect(l + 2, y, r - 2, y, trim == MOSS ? PALESTONE : trim);
              for (int x = l + 5 + ((y - top) / 7 % 2) * 5; x < r - 2; x += 12)
                rect(x, y + 1, x, imin(y + 6, floor - 2), trim == MOSS ? PALESTONE : trim);
            }
          }
          rect(l + 2, top + 3, r - 2, top + 3, trim);
          for (int x = l + 9; x < r - 5; x += 21) window(x, top + 11, 3, 6);
          for (int x = l + 17; x < r - 8; x += 36) lamp(x, floor - 12);
          if (domestic) {
            rect(l + 5, floor - 6, l + 15, floor - 5, wood);
            rect(l + 6, floor - 5, l + 7, floor - 2, wood);
            rect(l + 13, floor - 5, l + 14, floor - 2, wood);
            put(l + 10, floor - 7, CLAY); put(l + 11, floor - 7, CRYSTAL);
            for (int y = floor - 15; y < floor - 3; y += 5) {
              rect(r - 11, y, r - 4, y + 1, wood);
              for (int x = r - 10; x < r - 4; x += 3) rect(x, y - 3, x + 1, y - 1, x % 2 ? CLAY : trim);
            }
          }
        } else if (ceilingLights && floor - top >= 20) {
          for (int x = l + 10; x < r - 6; x += 29) pendant(x, top + 1, wood);
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
      auto homeDetails = [&](int l, int r, int top, int floor, uint8_t timber) {
        if (backdrop) {
          rect(l + 2, top + 2, r - 2, top + 3, timber);
          rect(l + 2, floor - 3, r - 2, floor - 2, timber);
          for (int x = l + 3; x < r - 4; x += 20) {
            rect(x, top + 3, x + 1, floor - 3, timber);
            line(x + 2, top + 4, imin(x + 8, r - 3), top + 10, 1, timber);
          }
          for (int x = l + 9; x < r - 5; x += 21) {
            window(x, top + 11, 3, 5);
            rect(x - 6, top + 8, x - 5, top + 16, timber);
            rect(x + 5, top + 8, x + 6, top + 16, timber);
            put(x - 5, top + 10, IRON_ORE); put(x + 5, top + 14, IRON_ORE);
          }
          rect(r - 18, floor - 6, r - 6, floor - 3, timber);
          rect(r - 17, floor - 7, r - 7, floor - 6, MOSS);
          rect(r - 17, floor - 8, r - 14, floor - 7, PALESTONE);
        } else {
          // Ceiling pendants light the open room above the walking clearance.
          for (int x = l + 12; x < r - 8; x += 30) {
            rect(x, top + 2, x, top + 4, timber);
            rect(x - 1, top + 5, x + 1, top + 5, timber);
            put(x, top + 6, LIGHT);
          }
        }
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
        room(cx - half, cx + half, floor - height, floor, wall, false);
        pad(cx - half, cx + half, floor, wall, false);
        for (int y = floor - 22; y > floor - height + 8; y -= 22) {
          rect(cx - half + 2, y, cx + half - 2, y + 1, wood);
          window(cx, y - 9, 3, 6);
          lamp(cx + half - 5, y - 6);
          // Fixtures hang below each deck, clear of the shallow uppermost room.
          pendant(cx - half + 4, y + 1, wood);
        }
        if (pointed) gable(cx, half + 3, floor - height, half + 9, trim);
        else crenels(cx - half - 2, cx + half + 2, floor - height - 2);
      };
      auto chamber = [&](int cx, int y, int half, int height) {
        room(cx - half, cx + half, y - height, y, wall);
        if (backdrop) {
          archBand(cx, y - height + 9, half - 3, 7, 2, PALESTONE);
          for (int side : {-1, 1}) {
            int x = cx + side * (half - 7);
            rect(x - 3, y - 15, x + 3, y - 4, DEEPSTONE);
            archBand(x, y - 12, 4, 5, 1, GOLD_ORE);
            rect(x - 1, y - 10, x + 1, y - 5, CLAY);
            put(x, y - 11, LIGHT);
          }
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
          if (backdrop) {
            // Millstones, drive shaft and flour sacks give the farm wings a purpose.
            rect(-4, -37, -3, -5, IRON_ORE);
            ellipse(-29, -8, 7, 5, STONE, false); ellipse(-29, -8, 4, 3, SANDSTONE, true);
            rect(-34, -5, -24, -3, OAK_WOOD);
            line(-29, -13, -29, -19, 2, OAK_WOOD); line(-29, -18, -5, -18, 2, OAK_WOOD);
            for (int x : {33, 43, 53}) {
              ellipse(x, -6, 4, 4, SANDSTONE, false); rect(x - 2, -10, x + 2, -9, OAK_WOOD);
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
          if (backdrop) {
            // A sluice wheel and measuring marks sit over the end abutment.
            rect(78, -42, 80, -36, IRON_ORE);
            ellipse(79, -42, 4, 4, OAK_WOOD, true);
            line(75, -42, 83, -42, 1, IRON_ORE);
            rect(-93, -33, -92, -18, PALESTONE);
            for (int y = -31; y <= -19; y += 4) rect(-93, y, -90, y, SANDSTONE);
          }
          break;
        }
        case LM_CASTLE: {
          int west = std::clamp(ground(-70), -8, 8), east = std::clamp(ground(70), -8, 8);
          room(-70, 70, -25, 0, wall); pad(-72, 72, 0, wall, true);
          crenels(-68, 68, -27);
          tower(-70, 17, west, 59, false); tower(70, 17, east, 65, true);
          tower(-12, 23, 0, 55, false);
          // A projecting keep, a round-capped west bastion, and a steep east turret.
          for (int side : {-1, 1}) {
            int x = -70 + side * 20;
            line(x, west - 54, x - side * 4, west - 44, 3, SANDSTONE);
            rect(x - 2, west - 62, x + 2, west - 54, STONE);
          }
          if (backdrop) rect(-37, -51, 13, -49, PALESTONE);
          else { rect(-37, -51, -34, -49, PALESTONE); rect(10, -51, 13, -49, PALESTONE); }
          rect(-36, -33, 12, -31, SANDSTONE);
          for (int x : {-31, 7}) {
            rect(x - 2, -54, x + 2, -28, SANDSTONE);
            rect(x - 3, -56, x + 3, -54, PALESTONE);
          }
          // The east ward opens onto an arcaded hall beneath a timber gallery.
          if (backdrop) {
            rect(16, -23, 49, -2, PALESTONE);
            for (int x : {24, 42}) {
              rect(x - 6, -14, x + 6, -3, SANDSTONE);
              archBand(x, -14, 8, 7, 2, STONE);
            }
            column(15, -23, -2, STONE); column(33, -23, -2, STONE); column(51, -23, -2, STONE);
            rect(-28, -18, 3, -17, PINE_WOOD);
            for (int x = -26; x < 3; x += 6) {
              line(x, -16, x + 2, -9, 1, IRON_ORE);
              rect(x - 1, -14, x + 3, -14, IRON_ORE);
            }
            rect(-27, -6, -3, -4, OAK_WOOD); rect(-24, -3, -22, -2, OAK_WOOD);
            rect(-7, -3, -5, -2, OAK_WOOD);
            rose(-12, -43, 7, SANDSTONE);
          }
          for (int x : {24, 43}) pendant(x, -24, IRON_ORE);
          banner(-77, west - 37, 17, CLAY); banner(62, east - 40, 20, CLAY);
          banner(-29, -47, 13, CLAY); banner(2, -47, 13, CLAY);
          break;
        }
        case LM_ABBEY: {
          room(-76, 47, -30, 0, PALESTONE); pad(-79, 50, 0, wall, true);
          gable(-15, 67, -30, 25, STONE);
          tower(61, 17, 0, 58, false);
          rect(42, -61, 80, -58, PALESTONE);
          archBand(61, -58, 16, 10, 2, STONE);
          if (backdrop) {
            rect(49, -56, 73, -40, PALESTONE);
            for (int x : {54, 68}) {
              rect(x - 3, -51, x + 3, -42, DEEPSTONE);
              archBand(x, -51, 4, 4, 1, SANDSTONE);
              rect(x, -53, x, -47, IRON_ORE);
              rect(x - 2, -46, x + 2, -44, GOLD_ORE);
            }
            rect(-72, -27, 43, -2, PALESTONE);
            for (int x = -62; x <= 30; x += 23) {
              rect(x - 7, -18, x + 7, -3, SANDSTONE);
              archBand(x, -16, 9, 11, 2, STONE);
              window(x, -17, 4, 9);
              column(x - 11, -27, -2, STONE);
            }
            rose(-15, -42, 11, PALESTONE);
            for (int x = -62; x < 18; x += 18) {
              rect(x, -6, x + 10, -4, OAK_WOOD); rect(x, -9, x + 1, -5, OAK_WOOD);
            }
            rect(22, -5, 39, -3, STONE); rect(20, -7, 41, -6, PALESTONE);
            for (int x : {24, 37}) { rect(x, -12, x, -8, GOLD_ORE); put(x, -13, LIGHT); }
            rect(30, -20, 31, -8, GOLD_ORE); rect(26, -17, 35, -16, GOLD_ORE);
          }
          for (int x : {-57, -34, 12, 36}) pendant(x, -29, IRON_ORE);
          // Stepped buttresses interrupt the eaves without closing the side aisle.
          for (int x : {-73, -49, 20, 44}) {
            rect(x - 2, -33, x + 2, -23, STONE);
            line(x, -33, x + (x < 0 ? -5 : 5), -24, 2, SANDSTONE);
          }
          vines(-73, -49, -30); vines(69, 76, -57);
          break;
        }
        case LM_PYRAMID: {
          pad(-102, 102, 0, wall, true);
          for (int x = -100; x <= 100; x++) {
            int top = -((100 - std::abs(x)) * 68 / 100);
            rect(x, top, x, 0, backdrop ? wall : EMPTY);
            rect(x, top, x, top + 3, wall);
            put(x, top, (top % 7 == 0) ? trim : PALESTONE);
            if (backdrop) for (int y = top + 4; y < 0; y++) {
              bool course = (y + 70) % 7 == 0;
              bool joint = (x + 120 + ((y + 70) / 7 % 2) * 5) % 13 == 0;
              if (course || joint) put(x, y, PALESTONE);
            }
            if (top < -10 && top % 14 < 3) put(x, top + 1, CLAY);
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
          if (backdrop) {
            // The upper gallery frames a sun disk and a ceremonial stone vessel.
            ellipse(0, -53, 9, 9, GOLD_ORE, true);
            line(-13, -53, 13, -53, 1, CLAY);
            rect(-12, -42, 12, -39, PALESTONE); rect(-8, -44, 8, -43, GOLD_ORE);
            for (int x : {-69, 69}) {
              rect(x - 4, -13, x + 4, -3, CLAY);
              ellipse(x, -15, 5, 5, SANDSTONE, false);
              rect(x - 6, -4, x + 6, -2, PALESTONE); put(x, -16, LIGHT);
            }
          }
          for (int x : {-32, 32}) pendant(x, -35, GOLD_ORE);
          break;
        }
        case LM_TOMB: {
          for (int side : {-1, 1}) {
            room(side < 0 ? -73 : 39, side < 0 ? -39 : 73, -35, 0, wall);
            pad(side < 0 ? -75 : 37, side < 0 ? -37 : 75, 0, wall, true);
            for (int y = -41; y <= -31; y++) {
              int half = y < -37 ? 21 : 17 + (y + 37) / 3;
              rect(side * 56 - half, y, side * 56 + half, y, y < -38 ? PALESTONE : wall);
            }
            rect(side * 56 - 22, -42, side * 56 + 22, -41, CLAY);
            if (backdrop) {
              int cx = side * 56;
              rect(cx - 12, -28, cx + 12, -4, PALESTONE);
              ellipse(cx, -25, 5, 5, GOLD_ORE, true);
              rect(cx - 2, -21, cx + 2, -7, CLAY);
              line(cx - 9, -18, cx + 9, -15, 2, CLAY);
              for (int dx : {-9, 9}) {
                rect(cx + dx, -26, cx + dx + 1, -8, SANDSTONE);
                put(cx + dx, -12, GOLD_ORE);
              }
            }
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
          if (backdrop) {
            ellipse(0, -27, 8, 4, GOLD_ORE, true);
            rect(-1, -30, 1, -29, GOLD_ORE);
            for (int side : {-1, 1}) {
              line(side * 8, -27, side * 28, -31, 2, PALESTONE);
              for (int x = 10; x <= 27; x += 4) line(side * x, -29, side * (x + 3), -25, 1, CLAY);
            }
          }
          pendant(-25, -21, GOLD_ORE); pendant(25, -21, GOLD_ORE);
          break;
        }
        case LM_LEVIATHAN: {
          int facing = p.id & 8 ? 1 : -1;
          auto g = [&](int x) { return ground(x * facing); };
          auto boneLine = [&](int ax, int ay, int bx, int by, int width) {
            line(ax * facing, ay, bx * facing, by, width, BONE);
          };
          auto spineY = [&](int x) {
            // The spine clears nearby crests so the ribs silhouette against sky.
            int crest = g(x);
            for (int dx = -24; dx <= 24; dx += 4) crest = imin(crest, g(x + dx));
            return crest - 25 - (int)std::lround(10 * std::sin((x + 60) * 3.141592653589793 / 150));
          };
          for (int x = -63; x <= 86; x += 2) {
            boneLine(x, spineY(x), x + 2, spineY(x + 2), x < 55 ? 4 : 3);
            if ((x + 63) % 10 < 2) {
              ellipse(facing * x, spineY(x), 4, 5, BONE, false);
              boneLine(x, spineY(x) - 4, x + 2, spineY(x) - 8, 2);
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
              boneLine(px, py, nx, ny, i < 14 ? 4 : 3); px = nx; py = ny;
            }
            for (int dx = -1; dx <= 1; dx++) support(facing * (px + dx), py, BONE);
            if (backdrop) boneLine(x - 3, top + 2, x - 12, g(x - 12) + 2, 2);
          }
          int hy = imin(g(-100), g(-88)) - 25;
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
          if (backdrop) {
            // Dark seams separate vertebrae; fine jaw sutures follow the skull.
            for (int x = -60; x <= 79; x += 10) {
              boneLine(x - 2, spineY(x) - 3, x + 3, spineY(x) - 6, 2);
              put(facing * x, spineY(x), DEEPSTONE);
            }
            line(facing * -105, hy - 3, facing * -93, hy - 8, 1, PALESTONE);
            line(facing * -102, hy + 12, facing * -79, hy + 10, 1, DEEPSTONE);
            // A survey scaffold and specimen trays make the skeleton an excavation.
            int deck = g(14) - 14;
            for (int x = 14; x <= 34; x += 2) deck = imin(deck, g(x) - 14);
            for (int x : {14, 34}) {
              for (int dx = 0; dx < 2; dx++) support(facing * (x + dx), deck - 8, OAK_WOOD);
              line(facing * (x - 1), deck + 2, facing * (x + 2), deck + 2, 1, BONE);
            }
            line(facing * 12, deck, facing * 37, deck, 2, OAK_WOOD);
            line(facing * 14, deck - 8, facing * 35, deck - 8, 1, PINE_WOOD);
            line(facing * 15, deck, facing * 33, g(33), 2, OAK_WOOD);
            line(facing * 33, deck, facing * 15, g(15), 1, OAK_WOOD);
            for (int y = deck + 3; y < g(15); y += 4)
              line(facing * 14, y, facing * 18, y, 1, BONE);
            lamp(facing * 18, deck - 4);
            banner(facing * 31, deck - 7, 6, CLAY);
            for (int x : {45, 57}) {
              int y = g(x);
              rect(facing * x - 4, y - 4, facing * x + 4, y - 2, PINE_WOOD);
              rect(facing * x - 2, y - 5, facing * x + 2, y - 4, BONE);
            }
          }
          // Field lanterns hang from the ribs and illuminate the specimen below.
          for (int x : {-29, 27, 69}) pendant(facing * x, spineY(x) + 1, IRON_ORE);
          break;
        }
        case LM_OSSUARY: {
          room(-53, 53, -24, 0, PALESTONE); pad(-55, 55, 0, PALESTONE, true);
          for (int x = -59; x <= 59; x++) {
            int top = -24 - (int)std::lround(25 * std::sqrt(std::fmax(0., 1. - std::pow(x / 59., 2))));
            if (backdrop) rect(x, top + 2, x, -24, DEEPSTONE);
          }
          archBand(0, -24, 59, 25, 3, BONE);
          if (backdrop) {
            rect(-50, -21, 50, -2, DEEPSTONE);
            // Separate ivory ribs frame illuminated shelves of small reliquaries.
            for (int x : {-42, -21, 21, 42}) {
              line(x / 2, -44, x, -23, 2, BONE);
              column(x, -23, -2, BONE);
            }
            for (int x : {-32, -11, 11, 32}) {
              archBand(x, -12, 8, 9, 2, BONE);
              for (int y : {-11, -5}) {
                rect(x - 6, y, x + 6, y + 1, PALESTONE);
                for (int dx : {-4, 0, 4}) {
                  ellipse(x + dx, y - 3, 2, 2, BONE, false);
                  put(x + dx, y - 3, DEEPSTONE);
                }
              }
              put(x, -15, LIGHT);
            }
            ellipse(0, -37, 10, 9, BONE, false);
            ellipse(-4, -39, 2, 3, DEEPSTONE, false); ellipse(4, -39, 2, 3, DEEPSTONE, false);
            rect(-1, -36, 1, -33, DEEPSTONE);
            for (int x = -6; x <= 6; x += 3) rect(x, -31, x, -29, DEEPSTONE);
            line(-47, -23, -14, -43, 2, BONE); line(47, -23, 14, -43, 2, BONE);
          }
          for (int x : {-36, 36}) pendant(x, -23, BONE);
          for (int side : {-1, 1}) {
            int px = side * 73, py = ground(px);
            for (int dx = -3; dx <= 3; dx++) support(px + dx, py - 5, BONE);
            for (int t = 0; t <= 36; t++) {
              int x = px - side * t * t / 110;
              rect(x - imax(0, 3 - t / 10), py - t, x + imax(0, 3 - t / 10), py - t, BONE);
            }
            if (backdrop) banner(px - 2, py - 22, 13, CLAY);
          }
          chamber(0, 30, 31, 20);
          rect(-5, -3, 5, 28, backdrop ? DEEPSTONE : EMPTY);
          break;
        }
        case LM_LONGHOUSE: {
          room(-80, 80, -25, 0, PALESTONE); pad(-82, 82, 0, STONE, true);
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
          homeDetails(-80, 80, -25, 0, PINE_WOOD);
          if (backdrop) {
            rect(-5, -12, 5, -3, STONE);
            rect(-3, -9, 3, -4, DEEPSTONE);
            put(-1, -5, LIGHT); put(1, -5, LIGHT);
            rect(-7, -13, 7, -12, PALESTONE);
          }
          if (backdrop) {
            // A broad smoke hood and carved rafters frame the communal hearth.
            for (int y = -20; y <= -14; y++) rect(-3 - (y + 20), y, 3 + (y + 20), y, STONE);
            rect(-10, -14, 10, -13, IRON_ORE);
            for (int side : {-1, 1}) {
              line(side * 58, -26, side * 41, -39, 2, PINE_WOOD);
              for (int x : {47, 60, 70}) {
                ellipse(side * x, -6, 4, 5, OAK_WOOD, false);
                rect(side * x - 4, -7, side * x + 4, -7, IRON_ORE);
              }
            }
          }
          break;
        }
        case LM_ICEWATCH: {
          tower(-62, 18, -1, 55, true); tower(61, 20, 0, 61, true);
          rect(-44, -24, 41, -21, PINE_WOOD);
          // A snow-covered timber gallery joins the two beacon towers.
          rect(-45, -44, 43, -42, PINE_WOOD); rect(-46, -45, 44, -44, ICE);
          if (backdrop) {
            rect(-43, -41, 41, -25, PALESTONE);
            for (int x = -42; x <= 40; x += 14) {
              rect(x, -41, x + 1, -25, PINE_WOOD);
              line(x + 1, -40, imin(x + 13, 41), -27, 1, PINE_WOOD);
              window(x + 7, -34, 4, 6);
            }
            rect(-44, -26, 41, -25, PINE_WOOD);
            banner(-70, -41, 17, ICE); banner(54, -47, 19, ICE);
            for (int x : {-73, 72}) {
              rect(x - 3, -17, x + 3, -3, PINE_WOOD);
              line(x - 3, -17, x + 5, -21, 1, IRON_ORE);
              put(x + 5, -22, LIGHT);
            }
          }
          for (int x : {-31, -3, 25}) pendant(x, -42, IRON_ORE);
          for (int side : {-1, 1}) line(side * 44, -21, side * 56, -8, 3, STONE);
          for (int x = -41; x < 41; x += 11) {
            int length = 3 + (x + 50) % 5;
            line(x, -21, x + 1, -21 + length, 1, ICE);
          }
          for (int cx : {-62, 61}) {
            int top = cx < 0 ? -56 : -61;
            rect(cx - 21, top, cx + 21, top + 1, ICE);
            if (backdrop) {
              ellipse(cx, top - 7, 5, 5, GLASS, false);
              put(cx - 1, top - 7, LIGHT); put(cx + 1, top - 7, LIGHT);
            }
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
            rect(-half - 2, top, half + 2, top + 2, PALESTONE);
            rect(-half, top + 3, half, top + 3, CLAY);
            if (tier % 2 == 0) rect(-half - 3, top - 1, half + 3, top, SANDSTONE);
            if (backdrop) for (int x = -half + 5; x < half - 3; x += 11) {
              rect(x, top + 5, x + 5, top + 8, CLAY); put(x + 2, top + 6, MOSS);
            }
            vines(-half + 2, half, top + 2);
            lamp(-half + 9, top + 7); lamp(half - 9, top + 7);
          }
          room(-18, 18, -79, -60, PALESTONE); rect(-22, -82, 22, -79, CLAY);
          rect(-17, -85, 17, -83, SANDSTONE); rect(-10, -87, 10, -85, CLAY);
          if (backdrop) {
            for (int side : {-1, 1}) {
              rect(side * 12 - 2, -76, side * 12 + 2, -61, CLAY);
              ellipse(side * 12, -72, 4, 4, GOLD_ORE, true);
            }
            ellipse(0, -71, 6, 6, GOLD_ORE, true);
            rect(-5, -65, 5, -62, CLAY); put(0, -66, LIGHT);
          }
          // The section exposes a descending gallery and a central burial chamber.
          for (int x = -98; x <= -22; x++) {
            int floor = (x + 98) * 18 / 76;
            rect(x, floor - 12, x, floor - 1, backdrop ? CLAY : EMPTY); put(x, floor, wall);
          }
          chamber(0, 22, 25, 22);
          if (backdrop) for (int y = -57; y < -1; y += 3) rect(-5, y, 5, y + 1, CLAY);
          if (backdrop) {
            for (int side : {-1, 1}) {
              int x = side * 76;
              rect(x - 5, -11, x + 5, -3, STONE);
              ellipse(x, -14, 6, 6, CLAY, false);
              put(x - 2, -15, LIGHT); put(x + 2, -15, LIGHT);
              rect(x - 3, -12, x + 3, -12, DEEPSTONE);
            }
            for (int y = -55; y < -4; y += 12) {
              rect(-13, y, -9, y + 3, PALESTONE); rect(9, y, 13, y + 3, PALESTONE);
            }
          }
          pendant(-10, -78, GOLD_ORE);
          break;
        }
        case LM_SANCTUARY: {
          pad(-83, 83, 0, STONE, true);
          // A roofless garden court sits between two fragments of an arcade.
          for (int x : {-72, -48, -24, 24, 48, 72}) {
            int top = x == 72 ? -20 : -33;
            column(x, top, 0, STONE);
          }
          for (int x : {-60, -36, 36}) {
            archBand(x, -26, 12, 14, 3, SANDSTONE);
            rect(x - 12, -42, x + 12, -40, PALESTONE);
            pendant(x, -38, OAK_WOOD);
          }
          archBand(60, -26, 12, 14, 3, STONE);
          rect(64, -44, 79, -24, EMPTY);
          if (backdrop) {
            rect(-21, -24, 21, -2, SANDSTONE);
            archBand(0, -23, 22, 24, 3, PALESTONE);
            line(-20, -25, -20, -2, 2, PALESTONE); line(20, -25, 20, -2, 2, PALESTONE);
            rose(0, -32, 9, STONE);
            ellipse(0, -17, 11, 11, MOSS, true);
            rect(-3, -26, 3, -5, PALESTONE); rect(-9, -17, 9, -14, PALESTONE);
            ellipse(0, -27, 5, 5, PALESTONE, false);
            rect(-13, -4, 13, -2, STONE); rect(-10, -6, 10, -5, PALESTONE);
            for (int x : {-15, 15}) { rect(x - 2, -6, x + 2, -2, CLAY); put(x, -7, LIGHT); }
            line(56, -2, 59, -23, 3, OAK_WOOD); line(59, -19, 69, -30, 2, OAK_WOOD);
            for (int x : {54, 62, 69}) ellipse(x, -28 - (x % 3), 7, 5, MOSS, false);
          }
          for (int x = 65; x <= 81; x++) support(x, ground(x) - (x % 5), STONE);
          vines(-77, -47, -39); vines(26, 43, -38);
          break;
        }
        case LM_STILT_HAMLET: {
          for (int house = -1; house <= 1; house++) {
            int cx = house * 66, floor = house == 0 ? -7 : -2;
            int eave = floor - (house == 0 ? 24 : 22);
            room(cx - 23, cx + 23, eave, floor, PALESTONE);
            if (house < 0) {
              // The fishing shed has a single sloping roof and a broad net loft.
              for (int dx = -27; dx <= 27; dx++) {
                int top = eave - 3 - (dx + 27) * 9 / 54;
                rect(cx + dx, top, cx + dx, top + 2, wood);
                if (backdrop) rect(cx + dx, top + 3, cx + dx, eave, PALESTONE);
              }
              rect(cx + 22, eave - 11, cx + 23, eave, wood);
            } else if (house == 0) {
              gable(cx, 27, eave, 16, wood);
              rect(cx - 5, eave - 10, cx + 5, eave - 2, PALESTONE);
              gable(cx, 8, eave - 10, 5, wood);
              if (backdrop) rose(cx, eave - 7, 3, wood);
            } else {
              gable(cx - 10, 17, eave, 12, wood);
              gable(cx + 10, 17, eave, 12, wood);
            }
            for (int side : {-1, 1}) {
              for (int dx = 0; dx < 3; dx++) support(cx + side * 20 + dx, floor, wood);
              if (backdrop) line(cx + side * 20, floor, cx - side * 20, ground(cx) + 1, 2, wood);
            }
            vines(cx - 24, cx + 24, floor - 21);
            homeDetails(cx - 23, cx + 23, eave, floor, wood);
            if (backdrop && house < 0) {
              for (int x = -16; x <= 14; x += 5) line(cx + x, eave + 5, cx + x + 5, floor - 6, 1, MOSS);
              for (int y = eave + 7; y < floor - 6; y += 4) rect(cx - 16, y, cx + 18, y, wood);
            }
            if (backdrop && house > 0) {
              for (int x : {-14, 0, 13}) {
                ellipse(cx + x, floor - 6, 4, 5, OAK_WOOD, false);
                rect(cx + x - 4, floor - 7, cx + x + 4, floor - 7, IRON_ORE);
              }
            }
            if (backdrop) {
              rect(cx - 16, floor - 3, cx - 12, floor - 2, CLAY);
              rect(cx - 15, floor - 6, cx - 13, floor - 4, BUSH_LEAF);
              line(cx - 24, floor - 22, cx - 27, floor - 20, 1, wood);
              line(cx + 24, floor - 22, cx + 27, floor - 20, 1, wood);
            }
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
          const int floor = 9;
          room(-49, 49, -24, floor, PALESTONE); pad(-51, 51, floor, STONE, false);
          // An open oculus crowns a ribbed copper-green dome above a pale drum.
          for (int x = -55; x <= 55; x++) {
            int top = -24 - (int)std::lround(27 * std::sqrt(std::fmax(0., 1. - std::pow(x / 55., 2))));
            rect(x, top - 1, x, -24, EMPTY);
            if (std::abs(x) < 8) continue;
            if (backdrop) rect(x, top + 2, x, -24, SANDSTONE);
          }
          archBand(0, -24, 55, 27, 2, STONE);
          archBand(0, -25, 55, 27, 1, MOSS);
          rect(-7, -55, 7, -45, EMPTY);
          for (int side : {-1, 1}) {
            rect(side * 8 - 1, -52, side * 8 + 1, -47, PALESTONE);
            rect(side * 8 - 3, -53, side * 8 + 3, -52, PALESTONE);
          }
          if (backdrop) {
            for (int x : {-44, -27, 27, 44}) {
              int top = -24 - (int)std::lround(27 * std::sqrt(1. - std::pow(x / 55., 2)));
              line(x, top + 1, x * 7 / 8, -24, 2, PALESTONE);
            }
            rect(-47, -21, 47, 5, SANDSTONE);
            for (int x = -36; x <= 36; x += 18) {
              rect(x - 6, -13, x + 6, 3, DEEPSTONE);
              archBand(x, -12, 7, 8, 2, PALESTONE);
              rect(x - 5, -12, x + 5, 1, GLASS);
              rect(x, -17, x, 1, PALESTONE);
              put(x - 3, -10, LIGHT); put(x + 3, -10, LIGHT);
            }
            for (int x = -45; x <= 45; x += 18) column(x, -23, 7, PALESTONE);
            // The pool and its stepped rim sit behind the dry crossing.
            rect(-17, 4, 17, 7, STONE); rect(-14, 2, 14, 4, PALESTONE);
            rect(-11, 2, 11, 3, GLASS);
            for (int x = -9; x <= 9; x += 6) put(x, 2, LIGHT);
            rect(-3, -3, 3, 1, STONE); ellipse(0, -7, 5, 5, MOSS, true);
            vines(-48, -26, -24); vines(32, 49, -24);
            for (int x = -46; x < 49; x++) if ((x + 70) % 11 < 4) put(x, 6, MOSS);
          }
          rect(-54, -25, 54, -23, PALESTONE); rect(-52, -22, 52, -21, SANDSTONE);
          for (int x : {-32, 32}) pendant(x, -22, OAK_WOOD);
          for (int x = 58; x <= 78; x++) support(x, ground(x) - std::abs(x - 68) / 5, STONE);
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
          if (backdrop) {
            // Pointed, branching ribs surround luminous ocular clerestories.
            for (int side : {-1, 1}) {
              line(side * 46, -3, side * 35, -31, 3, EYE_WOOD);
              line(side * 35, -31, side * 13, -54, 2, EYE_WOOD);
              line(side * 35, -31, side * 50, -40, 2, EYE_WOOD);
              for (int x : {21, 42}) {
                int cx = side * x;
                line(cx - 6, -18, cx, -31, 2, EYE_WOOD);
                line(cx, -31, cx + 6, -18, 2, EYE_WOOD);
                stampEyeGlyph(put, cx, -21, 5, 7, side);
                put(cx, -21, LIGHT);
              }
              int cx = side * 72;
              rose(cx, side < 0 ? -49 : -54, 6, EYE_WOOD);
            }
            for (int x : {-16, 16}) {
              rect(x, -12, x, -3, GOLD_ORE); rect(x - 3, -9, x + 3, -9, GOLD_ORE);
              put(x - 3, -10, LIGHT); put(x + 3, -10, LIGHT); put(x, -13, LIGHT);
            }
          }
          for (int x : {-38, 38}) pendant(x, -34, EYE_WOOD);
          for (int side : {-1, 1}) {
            line(side * 51, -36, side * 60, -24, 3, PALESTONE);
            line(side * 60, -24, side * 64, -5, 3, EYE_WOOD);
          }
          break;
        }
        case LM_STAR_OBSERVATORY: {
          room(-80, -22, -26, 0, PALESTONE); pad(-82, -20, 0, wall, true);
          tower(40, 35, 0, 40, false);
          // The circular drum carries a slit dome and a brass equatorial mount.
          rect(1, -48, 79, -40, EMPTY);
          for (int x = 3; x <= 77; x++) {
            int top = -43 - (int)std::lround(27 * std::sqrt(std::fmax(0., 1. - std::pow((x - 40) / 37., 2))));
            if (backdrop) rect(x, top + 2, x, -41, EYE_WOOD);
          }
          archBand(40, -43, 37, 27, 2, PALESTONE);
          rect(1, -43, 79, -41, PALESTONE); rect(3, -40, 77, -39, GOLD_ORE);
          if (backdrop) {
            for (int x : {12, 25, 55, 68}) {
              int top = -43 - (int)std::lround(27 * std::sqrt(1. - std::pow((x - 40) / 37., 2)));
              line(x, top + 1, 40 + (x - 40) * 6 / 5, -43, 1, GOLD_ORE);
            }
            rect(34, -68, 43, -44, DEEPSTONE);
            rect(34, -67, 35, -44, GOLD_ORE); rect(43, -68, 44, -44, GOLD_ORE);
            rect(8, -37, 72, -24, PALESTONE);
            for (int x = 14; x <= 68; x += 18) window(x, -31, 4, 5);
            ellipse(40, -50, 10, 8, GOLD_ORE, true);
            line(31, -45, 47, -57, 2, IRON_ORE);
            line(39, -47, 63, -68, 6, EYE_WOOD);
            line(40, -49, 64, -70, 2, PALESTONE);
            ellipse(65, -71, 5, 4, GLASS, false); put(66, -72, LIGHT);
            line(40, -47, 28, -42, 2, GOLD_ORE); line(40, -47, 51, -42, 2, GOLD_ORE);
            rect(12, -19, 29, -17, wood);
            for (int y : {-14, -7}) {
              rect(13, y, 28, y + 1, wood);
              for (int x = 14; x < 28; x += 3) rect(x, y - 4, x + 1, y - 1, x % 2 ? CLAY : PALESTONE);
            }
            rect(51, -8, 68, -6, EYE_WOOD); rect(52, -5, 54, -2, EYE_WOOD);
            rect(65, -5, 67, -2, EYE_WOOD); rect(54, -10, 66, -9, PALESTONE);
          }
          for (int x : {17, 63}) pendant(x, -39, GOLD_ORE);
          rect(-23, -21, 6, -18, wall); rect(-23, -36, 6, -34, EYE_WOOD);
          if (backdrop) {
            for (int x = -22; x < 6; x += 9) line(x, -34, x + 7, -22, 1, EYE_WOOD);
            ellipse(-51, -15, 12, 10, GOLD_ORE, true);
            ellipse(-51, -15, 5, 10, GOLD_ORE, true);
            line(-64, -15, -38, -15, 1, GOLD_ORE); line(-51, -25, -51, -5, 1, GOLD_ORE);
            ellipse(-51, -15, 3, 3, GLASS, false); put(-51, -15, LIGHT);
            rect(-55, -4, -47, -2, STONE);
          }
          gable(-51, 32, -26, 15, EYE_WOOD);
          if (backdrop) rose(-51, -32, 5, PALESTONE);
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
              if (side < 0) {
                gable(cx, 30, floor - 20, 19, PINE_WOOD);
                line(cx - 30, floor - 20, cx + 4, floor - 44, 2, BONE);
                line(cx + 30, floor - 20, cx - 4, floor - 44, 2, BONE);
              } else {
                for (int dx = -30; dx <= 30; dx++) {
                  int top = floor - 23 - (int)std::lround(13 * std::sqrt(std::fmax(0., 1. - std::pow(dx / 30., 2))));
                  if (backdrop) rect(cx + dx, top + 2, cx + dx, floor - 20, CLAY);
                }
                archBand(cx, floor - 23, 30, 13, 3, PINE_WOOD);
                for (int x : {-20, 0, 20}) if (backdrop)
                  line(cx + x, floor - 21, cx + x / 2, floor - 33, 2, BONE);
                rect(cx - 25, floor - 23, cx + 25, floor - 20, PINE_WOOD);
              }
              if (backdrop) {
                for (int x = -15; x <= 15; x += 6) line(cx + x, floor - 18, cx + x / 2, floor - 30, 1, BONE);
                banner(cx - 4, floor - 19, 13, CLAY);
              }
              homeDetails(cx - 24, cx + 24, floor - 20, floor, PINE_WOOD);
              if (backdrop && side > 0) {
                rect(cx - 18, floor - 7, cx + 13, floor - 5, OAK_WOOD);
                for (int x : {-14, -4, 7}) {
                  line(cx + x, floor - 13, cx + x + 4, floor - 8, 2, BONE);
                  rect(cx + x - 1, floor - 4, cx + x + 1, floor - 2, OAK_WOOD);
                }
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
              rect(-8, y - 3, 8, y - 1, DEEPSTONE);
              rect(-5, y - 4, 5, y - 3, BONE);
              put(-2, y - 5, LIGHT); put(2, y - 5, LIGHT);
            }
          } else {
            int floor = ground(0) - 35;
            for (int side : {-1, 1}) {
              for (int dx = -2; dx <= 2; dx++) support(side * 18 + dx, floor, PINE_WOOD);
              if (backdrop) line(side * 18, floor, -side * 18, ground(-side * 18), 2, BONE);
            }
            room(-25, 25, floor - 18, floor, PINE_WOOD);
            homeDetails(-25, 25, floor - 18, floor, PINE_WOOD);
            // The watch platform has a high western canopy and a low open awning.
            for (int x = -32; x <= 32; x++) {
              int top = floor - 22 - (x < -8 ? (x + 32) * 13 / 24 : (32 - x) * 13 / 40);
              rect(x, top, x, top + 2, BONE);
              if (backdrop) rect(x, top + 3, x, floor - 18, CLAY);
            }
            rect(-24, floor - 27, -23, floor - 18, PINE_WOOD);
            rect(24, floor - 24, 25, floor - 18, PINE_WOOD);
            if (backdrop) {
              line(-8, floor - 34, -23, floor - 19, 2, BONE);
              line(-8, floor - 34, 25, floor - 19, 2, BONE);
              ellipse(16, floor - 12, 5, 4, GLASS, false); put(16, floor - 12, LIGHT);
              rect(15, floor - 8, 17, floor - 3, BONE);
            }
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
            int floor = ground(cx) - 2, height = house == 0 ? 28 : house < 0 ? 21 : 25;
            pad(cx - radius, cx + radius, floor, ICE, false);
            for (int dx = -radius; dx <= radius; dx++) {
              int top = floor - 5 - (int)std::lround(height * std::sqrt(std::fmax(0.0, 1 - std::pow(dx / (double)radius, 2))));
              for (int y = top; y < floor; y++) {
                int neighbor = floor - 5 - (int)std::lround(height * std::sqrt(std::fmax(0., 1. - std::pow((std::abs(dx) + 1.) / radius, 2))));
                bool shell = y <= imax(top + 2, neighbor) || std::abs(dx) >= radius - 2;
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
              rect(cx - 11, floor - 5, cx - 8, floor - 4, GOLD_ORE);
              put(cx - 10, floor - 6, LIGHT);
              rect(cx + 5, floor - 7, cx + 9, floor - 7, PALESTONE);
              if (house < 0) {
                for (int x : {-13, -5, 4}) {
                  rect(cx + x, floor - 12, cx + x + 5, floor - 11, PINE_WOOD);
                  rect(cx + x + 1, floor - 15, cx + x + 4, floor - 13, CLAY);
                }
              } else if (house == 0) {
                archBand(cx, floor - 19, 14, 8, 1, PINE_WOOD);
                for (int x : {-15, 15}) line(cx + x, floor - 17, cx + x, floor - 3, 1, PINE_WOOD);
              } else {
                line(cx - 15, floor - 18, cx - 7, floor - 5, 1, BONE);
                line(cx - 9, floor - 19, cx - 1, floor - 6, 1, BONE);
              }
            } else {
              int ceiling = floor - 5 - height;
              rect(cx, ceiling + 3, cx, ceiling + 6, PINE_WOOD);
              rect(cx - 1, ceiling + 7, cx + 1, ceiling + 7, PINE_WOOD);
              put(cx, ceiling + 8, LIGHT);
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
#pragma clang attribute pop
  }
