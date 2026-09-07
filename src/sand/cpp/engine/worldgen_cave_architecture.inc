  // Sectioned underground architecture: the solid rear wall carries ornament,
  // light, and equipment; floors and vaults form the traversable foreground.
  template<class Put>
  __attribute__((minsize, noinline))
  void stampCaveArchitecture(Put&& write, int left, int top, int width, int height,
                            int design, bool background, uint32_t seed) {
#pragma clang attribute push (__attribute__((minsize)), apply_to = function)
    int right = left + width - 1, floor = top + height - 1, cx = left + width / 2;
    bool deep = design >= 8;
    int theme = deep ? (design - 8) / 3 : design / 2;
    int variant = deep ? (design - 8) % 3 : design % 2;
    const uint8_t shallowWall[] = {STONE, PALESTONE, MYCELIUM, STONE};
    const uint8_t deepWall[] = {BRICK, PALESTONE, BONE, DEEPSTONE};
    const uint8_t shallowTrim[] = {SANDSTONE, CRYSTAL, MUSH_STEM, MOSS};
    const uint8_t deepTrim[] = {IRON_ORE, CRYSTAL, PALESTONE, MYCELIUM};
    uint8_t wall = deep ? deepWall[theme] : shallowWall[theme];
    uint8_t trim = deep ? deepTrim[theme] : shallowTrim[theme];
    uint8_t timber = deep && theme == 0 ? IRON_ORE : PINE_WOOD;
    auto put = [&](int x, int y, uint8_t m) {
      if (x >= left && x <= right && y >= top && y <= floor) write(x, y, m);
    };
    auto rect = [&](int l, int t, int r, int b, uint8_t m) {
      for (int y = t; y <= b; y++) for (int x = l; x <= r; x++) put(x, y, m);
    };
    auto line = [&](int ax, int ay, int bx, int by, int thickness, uint8_t m) {
      int n = imax(1, imax(std::abs(ax-bx), std::abs(ay-by)));
      for (int i = 0; i <= n; i++) {
        int x = ax + (int)std::lround((double)(bx-ax)*i/n);
        int y = ay + (int)std::lround((double)(by-ay)*i/n);
        rect(x, y, x + thickness - 1, y + thickness - 1, m);
      }
    };
    auto oval = [&](int x, int y, int rx, int ry, uint8_t m, bool ring) {
      for (int dy = -ry; dy <= ry; dy++) for (int dx = -rx; dx <= rx; dx++) {
        double d = (double)dx*dx/(rx*rx) + (double)dy*dy/(ry*ry);
        if (d <= 1 && (!ring || d > .62)) put(x+dx,y+dy,m);
      }
    };
    auto lamp = [&](int x, int y) {
      if (!background) return;
      rect(x-2,y-2,x+2,y+2,timber); rect(x-1,y-1,x+1,y+1,GLASS); put(x,y,LIGHT);
    };
    auto shelf = [&](int x, int y, int w, uint8_t contents) {
      if (!background) return;
      rect(x,y,x+w,y+1,timber);
      for (int d = 1; d < w; d += 4) {
        int h = 2 + (int)(whash2(seed,x+d,y)*3);
        rect(x+d,y-h,x+d+1,y-1,contents); put(x+d,y-h-1,trim);
      }
    };
    auto arch = [&](int x, int y, int rx, int rise, uint8_t m) {
      int px=x-rx,py=y;
      for (int dx=-rx;dx<=rx;dx++) {
        int ny=y-(int)std::lround(rise*std::sqrt(std::fmax(0.,1.-(double)dx*dx/(rx*rx))));
        line(px,py,x+dx,ny,2,m);px=x+dx;py=ny;
      }
    };
    // Vault shapes vary with the use of the room, while the rear rock remains
    // continuous around the section. Masonry courses have staggered joints.
    for (int x=left;x<=right;x++) {
      double nx=std::abs(x-cx)/(width*.5);
      int roof=top+(int)(variant==1 ? nx*8 : nx*nx*10);
      if(design==6)roof=top+5;
      if (!deep && theme==2) roof=top+3+(int)(nx*nx*6);
      for (int y=roof;y<=floor;y++) {
        bool shell=y<roof+3||y>=floor-1||x<left+2||x>right-2;
        uint8_t m = wall;
        if (!shell) {
          bool joint=(y-top)%8==0 || (x-left+((y-top)/8%2)*7)%15==0;
          m=joint ? wall : (theme==2 ? (deep ? DEEPSTONE : MYCELIUM) : DEEPSTONE);
        }
        put(x,y,background||shell?m:EMPTY);
      }
      put(x,roof,trim);
    }
    // A continuous lower aisle meets the cave at both ends. Upper galleries
    // have staggered stairs and leave headroom above the lower walking floor.
    if (height>=38 && width>=42) {
      int deck=floor-22;
      rect(left+2,deck,right-2,deck+1,timber);
      int start=(seed&1)?left+4:right-26;
      if (background) for (int i=0;i<=22;i++) put(start+i,floor-1-i,timber);
      if (background) {
        for(int x=left+8;x<right-5;x+=18) {
          line(x,deck+2,x+7,deck+10,2,trim);
          rect(x,deck-6,x,deck-1,timber);
        }
        rect(left+3,deck-7,right-3,deck-7,timber);
      }
    }
    if (!deep) {
      switch (design) {
        case 0: { // Vaulted cistern: piers, water bowls, valve and overflow pipe.
          if(background) {
            for(int x=left+5;x<right-4;x+=14){
              rect(x-1,top+10,x+1,floor-2,SANDSTONE);
              arch(x+7,top+15,6,6,SANDSTONE);
              rect(x+3,floor-7,x+11,floor-2,CLAY);
              rect(x+4,floor-6,x+10,floor-3,WATER);
            }
            rect(cx-1,top+7,cx+1,floor-10,COPPER_ORE);
            oval(cx,top+12,5,5,IRON_ORE,true);line(cx-5,top+12,cx+5,top+12,1,IRON_ORE);
          }
          break;
        }
        case 1: { // Waystation: departure clock, luggage, railway signs, ticket bay.
          if(background) {
            oval(cx,top+10,7,7,SANDSTONE,false);oval(cx,top+10,5,5,PALESTONE,false);
            line(cx,top+10,cx,top+6,1,IRON_ORE);line(cx,top+10,cx+3,top+12,1,IRON_ORE);
            for(int x=left+5;x<right-4;x+=12){
              rect(x,floor-6,x+7,floor-4,timber);rect(x+1,floor-3,x+1,floor-2,timber);
              rect(x,top+20,x+7,top+23,SANDSTONE);put(x+3,top+21,COAL_ORE);
            }
            shelf(right-16,floor-12,10,CLAY);
          }
          rect(left+2,floor-1,right-2,floor-1,IRON_ORE);
          break;
        }
        case 2: { // Prism chapel: nested luminous lancets and a faceted altar.
          if(background) {
            for(int ring=0;ring<3;ring++)arch(cx,floor-5,width/2-5-ring*5,height-10-ring*6,ring%2?PALESTONE:CRYSTAL);
            for(int y=top+10;y<floor-5;y++){
              int radius=imax(1,7-std::abs(y-(top+height/2))/2);
              rect(cx-radius,y,cx+radius,y,CRYSTAL);put(cx,y,GLASS);
            }
            rect(cx-10,floor-4,cx+10,floor-2,PALESTONE);lamp(cx,top+12);
          }
          break;
        }
        case 3: { // Lapidary: lenses, mounting arms, specimen cabinets, work benches.
          if(background) {
            for(int x=left+11;x<right-6;x+=19){
              oval(x,top+12,7,7,COPPER_ORE,true);oval(x,top+12,4,4,GLASS,false);
              line(x,top+19,x,floor-6,2,IRON_ORE);rect(x-7,floor-6,x+7,floor-4,timber);
              shelf(x-6,floor-7,12,CRYSTAL);lamp(x,top+12);
            }
          }
          break;
        }
        case 4: { // Apothecary: crooked shelves, specimen jars and copper still.
          if(background) {
            for(int y=top+12;y<floor-3;y+=10){shelf(left+4,y,13,MUSH_CAP);shelf(right-17,y,13,GLOWSHROOM);}
            oval(cx,floor-11,7,8,COPPER_ORE,false);oval(cx,floor-11,4,5,GLASS,false);
            line(cx, floor-19,cx+7,top+7,2,COPPER_ORE);line(cx+7,top+7,right-7,top+7,2,COPPER_ORE);
            rect(cx-9,floor-3,cx+9,floor-2,MYCELIUM);lamp(cx,floor-11);
          }
          break;
        }
        case 5: { // Spore bells: layered mushroom canopies and suspended seed pods.
          if(background) {
            for(int x=left+8;x<right-5;x+=14){
              int y=top+10+(int)(whash2(seed,x,0)*9);
              line(x,floor-2,x-2,y+4,3,MUSH_STEM);oval(x-2,y,9,5,MUSH_CAP,false);
              rect(x-10,y+2,x+6,y+3,GLOWSHROOM);
              for(int dx=-6;dx<=6;dx+=3)line(x+dx,y+4,x+dx,y+8,1,MUSH_STEM);
              lamp(x-2,y);
            }
          }
          break;
        }
        case 6: { // Root cloister: stone arcade reclaimed by thick braided roots.
          if(background) {
            for(int x=left+6;x<right-4;x+=16){
              rect(x,top+12,x+2,floor-2,STONE);arch(x+9,top+17,7,8,MOSS);
              line(x+2,top+3,x-3,top+height/2,3,OAK_WOOD);
              line(x-3,top+height/2,x+4,floor-2,2,OAK_WOOD);
              oval(x+9,floor-5,5,3,MOSS,false);
            }
          }
          break;
        }
        case 7: { // Hanging nursery: suspended baskets over terraced growing beds.
          if(background) {
            for(int x=left+8;x<right-6;x+=13){
              int y=top+12+(x%7);
              line(x-3,top+5,x-3,y,1,PINE_WOOD);line(x+3,top+5,x+3,y,1,PINE_WOOD);
              oval(x,y,6,3,CLAY,false);oval(x,y-3,5,3,MOSS,false);put(x,y-5,GLOWBERRY);
              rect(x-4,floor-4,x+4,floor-2,CLAY);rect(x-3,floor-5,x+3,floor-5,MOSS);
              line(x,floor-6,x-2,floor-11,2,VINE);put(x-2,floor-12,GLOWSHROOM);
            }
          }
          break;
        }
      }
    } else if(theme==0) {
      if(background) {
        if(variant==0) { // Furnace cathedral: three flues and enclosed crucibles.
          for(int x=left+17;x<right-9;x+=30){
            rect(x-8,floor-18,x+8,floor-3,BRICK);arch(x,floor-10,8,9,IRON_ORE);
            rect(x-5,floor-12,x+5,floor-5,LAVA);rect(x-6,floor-4,x+6,floor-3,IRON_ORE);
            rect(x-3,top+7,x+3,floor-20,IRON_ORE);lamp(x,floor-13);
          }
        } else if(variant==1) { // Chain foundry: overhead gantry, gears, crane and cargo.
          rect(left+5,top+12,right-5,top+15,IRON_ORE);
          for(int x=left+14;x<right-10;x+=25){
            oval(x,top+27,10,10,IRON_ORE,true);oval(x,top+27,3,3,COPPER_ORE,false);
            for(int d=-8;d<=8;d++)put(x+d,top+27,COPPER_ORE);
            line(x,top+14,x,top+36,1,IRON_ORE);shelf(x-8,floor-5,16,COPPER_ORE);
            lamp(x,top+27);
          }
        } else { // Basalt pumping hall: braced pipes and a central pressure vessel.
          for(int x=left+10;x<right-7;x+=22){
            rect(x,top+8,x+3,floor-5,COPPER_ORE);rect(x-2,top+15,x+5,top+17,IRON_ORE);
            oval(x+2,floor-12,6,6,IRON_ORE,true);lamp(x+2,floor-12);
          }
          oval(cx,top+height/2,17,22,IRON_ORE,false);oval(cx,top+height/2,12,17,DEEPSTONE,false);
          for(int y=top+13;y<floor-7;y+=9)rect(cx-12,y,cx+12,y,COPPER_ORE);
          lamp(cx,top+height/2);
        }
      }
    } else if(theme==1) {
      if(background) {
        if(variant==0) { // Astral sanctuary with overlapping elliptical instruments.
          for(int ring=0;ring<4;ring++)oval(cx,top+height/2,width/2-10-ring*8,height/2-7-ring*4,ring%2?GOLD_ORE:CRYSTAL,true);
          line(cx,top+6,cx,floor-3,2,PALESTONE);line(left+6,top+height/2,right-6,top+height/2,1,PALESTONE);
        } else if(variant==1) { // Geode organ: graded crystal pipes, console, vaulted bays.
          for(int x=left+8;x<right-5;x+=7){
            int h=18+(int)(25*(1-std::abs(x-cx)/(width*.5)));
            rect(x,floor-5-h,x+3,floor-5,CRYSTAL);rect(x+1,floor-4-h,x+1,floor-7,GLASS);
          }
          rect(cx-16,floor-5,cx+16,floor-3,PALESTONE);
          for(int x=cx-14;x<=cx+14;x+=3)put(x,floor-6,COAL_ORE);
        } else { // Suspended lens bridge and specimen galleries.
          for(int x=left+14;x<right-7;x+=26){
            oval(x,top+21,10,12,PALESTONE,true);oval(x,top+21,6,8,GLASS,false);
            line(x,top+3,x,top+8,2,CRYSTAL);lamp(x,top+21);
            shelf(x-8,floor-6,16,CRYSTAL);
          }
        }
        for(int x=left+11;x<right-5;x+=19)lamp(x,top+height/2);
      }
    } else if(theme==2) {
      if(background) {
        if(variant==0) { // Mounted leviathan: articulated vertebrae, hooked ribs, skull.
          int sy=top+height/2;
          for(int x=left+17;x<right-29;x+=3){
            int y=sy+(int)(5*std::sin((x-left)*.07));line(x,y,x+3,y,3,BONE);
            if((x-left)%12<3){
              rect(x,y-4,x+2,y+4,BONE);arch(x+4,y+17,6,16,BONE);
            }
          }
          oval(right-23,sy,14,10,BONE,false);oval(right-20,sy-2,4,4,DEEPSTONE,false);
          rect(right-24,sy+4,right-7,sy+6,DEEPSTONE);
          for(int x=right-22;x<right-8;x+=4)rect(x,sy+4,x,sy+8,BONE);
          for(int x=left+10;x<right-8;x+=25)shelf(x,floor-5,16,PALESTONE);
          for(int x=left+21;x<right-10;x+=18)lamp(x,sy-7);
        } else if(variant==1) { // Ossuary amphitheater: tiers of niches and a tusk throne.
          for(int y=top+13;y<floor-14;y+=13)for(int x=left+10;x<right-7;x+=14){
            arch(x,y+6,5,8,BONE);oval(x,y+2,3,3,PALESTONE,false);put(x-1,y+2,DEEPSTONE);put(x+1,y+2,DEEPSTONE);
          }
          for(int side:{-1,1})line(cx+side*12,floor-3,cx+side*5,floor-25,3,BONE);
          rect(cx-9,floor-7,cx+9,floor-4,PALESTONE);
        } else { // Dig camp: survey grids, winches, suspended fossils, and tools.
          for(int x=left+7;x<right-5;x+=20){
            rect(x,top+8,x+2,floor-2,PINE_WOOD);line(x,top+12,x+17,top+28,2,PINE_WOOD);
            shelf(x+3,floor-6,13,BONE);oval(x+10,top+24,6,6,IRON_ORE,true);
            line(x+10,top+30,x+10,floor-14,1,IRON_ORE);oval(x+10,floor-13,5,3,BONE,false);
          }
        }
      }
    } else {
      if(background) {
        if(variant==0) { // Hanging archive with upper reading balconies and dense books.
          for(int x=left+6;x<right-8;x+=17)for(int y=top+16;y<floor-3;y+=11)shelf(x,y,12,(x+y)%3?CLAY:MYCELIUM);
          for(int x=left+14;x<right-7;x+=29){line(x,top+3,x,top+18,1,PINE_WOOD);lamp(x,top+20);}
        } else if(variant==1) { // Fungal village: overlapping caps over hollow stem houses.
          for(int x=left+17;x<right-10;x+=30){
            int y=top+17+(int)(whash2(seed,x,3)*9);
            rect(x-7,y,x+7,floor-2,MUSH_STEM);oval(x,y,16,9,MUSH_CAP,false);
            rect(x-14,y+3,x+14,y+5,GLOWSHROOM);rect(x-3,floor-15,x+3,floor-3,DEEPSTONE);
            oval(x,y+17,4,5,GLASS,false);lamp(x,y+17);
          }
        } else { // Root engine: great braided roots cradle a glowing seed reliquary.
          for(int side:{-1,1})for(int branch=0;branch<3;branch++){
            int x=cx+side*(20+branch*12);line(x,top+4,cx+side*(8+branch*4),top+height/2,3,MYCELIUM);
            line(cx+side*(8+branch*4),top+height/2,x+side*5,floor-2,3,MYCELIUM);
          }
          oval(cx,top+height/2,14,19,MUSH_STEM,true);oval(cx,top+height/2,9,13,GLOWSHROOM,false);lamp(cx,top+height/2);
        }
      }
    }
    if (background) {
      for(int x=left+10;x<right-4;x+=24) {
        lamp(x,floor-10);
        if(height>48)lamp(x,top+14);
      }
    }
    // Relief niches and irregular masonry teeth tie the vault into surrounding rock.
    if(background)for(int x=left+7;x<right-4;x+=17){
      int y=top+6+(int)(whash2(seed,x,7)*3);rect(x-2,y,x+2,y+2,trim);
    }
    stampStructureRoute(put, left, floor - 1, right, floor - 1, wall, background);
    // A stairwell connects both galleries without bisecting the lower aisle.
    if (height >= 38 && width >= 42) {
      int stairX = (seed & 1) ? left + 12 : right - 12;
      if (!background) rect(stairX - 6, top + 12, stairX + 6, floor - 2, EMPTY);
      stampStructureLandings(put, stairX, 6, top + 12, floor - 1, timber);
    }
    if(!background)for(int side:{-1,1}) {
      int edge=side<0?left:right;
      for(int dx=0;dx<3;dx++)for(int y=floor-PLAYER_H-5;y<floor-1;y++)put(edge-side*dx,y,EMPTY);
    }
#pragma clang attribute pop
  }
