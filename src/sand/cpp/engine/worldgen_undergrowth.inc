  // Low, rooted flora occupies the gaps between trees and constructed sites.
  // Absolute slots and a bounded raster keep overlapping tufts stable at seams.
  void fillSurfaceUndergrowth(int colStart, int colEnd, int rowStart, int rowEnd,
                              int reachX, int reachY) {
    if (!L->isBackground) return;
    const uint32_t seed = L->gTreeSeed ^ 0x6A55F10u;
    const int left = L->worldOffsetX + colStart, right = L->worldOffsetX + colEnd;
    for (int slot = floorDiv(left-reachX,14); slot <= floorDiv(right+reachX,14); slot++) {
      int wx = slot*14 + 3 + (int)(whash1(seed,slot)*8);
      int biome = terrain.genBiomeAt(wx);
      int ground = terrain.genSurfaceAbs(wx), localGround = ground-L->worldOffsetY;
      if (localGround+reachY < rowStart || localGround-reachY >= rowEnd || ground >= L->gSeaRow+(biome==BIOME_SWAMP?6:-1)) continue;
      double patch = wfbm2(seed ^ 0x11u,wx*.025,2.4,2,.5);
      double density = biome==BIOME_DESERT?.18:biome==BIOME_TUNDRA?.24:
        biome==BIOME_FOREST||biome==BIOME_JUNGLE||biome==BIOME_SWAMP?.38:.28;
      if (whash1(seed ^ 0x12u,slot) > density + patch*.85) continue;
      if (terrain.genBiomeAt(wx-10)!=biome || terrain.genBiomeAt(wx+10)!=biome) continue;
      int rootDepth = TerrainGen::GEN_SKIN + terrain.genSoilDepthAt(wx,biome)+1;
      bool supported = true;
      {
        ForegroundTerrainScope foregroundQuery(L);
        for (int dx=-2;dx<=2;dx++) {
          int floor=terrain.genSurfaceAbs(wx+dx);
          if (std::abs(floor-ground)>5) { supported=false; break; }
          for (int dy=0;dy<=rootDepth;dy++)
            if (terrain.genOpenCaveAt(wx+dx,floor+dy)) { supported=false; break; }
        }
      }
      if (!supported || worldContext.overlapsConstruction({wx-12,ground-28,wx+12,ground+rootDepth})) continue;

      constexpr int width=25, height=64, originY=40;
      uint8_t raster[width*height] = {};
      auto put = [&](int x,int y,uint8_t m) {
        if(x>=-12 && x<=12 && y>=-40 && y<24)raster[(y+originY)*width+x+12]=m;
      };
      auto line = [&](int ax,int ay,int bx,int by,int thickness,uint8_t m) {
        int n=imax(1,imax(std::abs(bx-ax),std::abs(by-ay)));
        for(int i=0;i<=n;i++) {
          int x=ax+(int)std::lround((double)(bx-ax)*i/n);
          int y=ay+(int)std::lround((double)(by-ay)*i/n);
          for(int d=0;d<thickness;d++)put(x+d,y,m);
        }
      };
      auto oval = [&](int x,int y,int rx,int ry,uint8_t m) {
        for(int dy=-ry;dy<=ry;dy++)for(int dx=-rx;dx<=rx;dx++)
          if(dx*dx*ry*ry+dy*dy*rx*rx<=rx*rx*ry*ry)put(x+dx,y+dy,m);
      };
      bool eye=biome==BIOME_WATCHWOOD;
      int form=(int)(whash1(seed^0x13u,slot)*4);
      int h=8+(int)(whash1(seed^0x14u,slot)*9);
      int lean=whash1(seed^0x15u,slot)<.5?-1:1;
      uint8_t stem=eye?EYE_WOOD:RUST_BRAMBLE;
      uint8_t leaf=eye?VIOLET_FROND:OCHRE_REED;
      if(biome!=BIOME_ROCKY && !eye) {
        // Each habitat has its own silhouettes; a shared raster owns clipping
        // and rooted placement so flora never depends on the loaded window.
        stem=biome==BIOME_DESERT?CACTUS:biome==BIOME_TUNDRA?DRIFTWOOD:WOOD;
        uint8_t green=biome==BIOME_TUNDRA?TEAL_LICHEN:PLANT;
        uint8_t blossom=whash1(seed^0x16u,slot)<.5?VIOLET_FROND:OCHRE_REED;
        auto flower = [&](int x,int y,uint8_t petal) {
          oval(x,y,2,1,petal);line(x,y-2,x,y+1,1,petal);put(x,y,OCHRE_REED);
        };
        auto fern = [&](int x,int up,int side,uint8_t frond) {
          line(0,0,x,-up/2,2,frond);line(x,-up/2,x+side*2,-up,1,frond);
          for(int j=2;j<up;j+=3) {
            int px=x*j/up,py=-j;
            line(0,0,px,py,1,frond);
            line(px,py,px+side*(j<up/2?4:2),py-2,1,frond);
          }
        };
        if(biome==BIOME_DESERT) {
          if(form==0) {
            // Agave rosette: blue-green blades, gold tips and a bloom spike.
            for(int i=-2;i<=2;i++) {
              int tx=i*4,ty=-h+std::abs(i)*3;
              line(0,0,tx/2,ty/2,3,CACTUS);
              line(tx/2,ty/2,tx,ty,2,TEAL_LICHEN);put(tx,ty-1,OCHRE_REED);
            }
            if(slot%3==0){line(0,0,lean,-h-5,1,OCHRE_REED);flower(lean,-h-5,VIOLET_FROND);}
          } else if(form==1) {
            // Prickly pear pads overlap at their bases, with red fruit.
            oval(0,-4,3,5,CACTUS);oval(-4,-8,3,4,CACTUS);
            oval(4,-h+3,4,5,CACTUS);line(0,-3,4,-h+3,2,CACTUS);
            line(-5,-9,-5,-6,1,TEAL_LICHEN);line(4,-h,4,-h+5,1,TEAL_LICHEN);
            flower(4,-h-2,RUST_BRAMBLE);oval(-5,-12,1,2,VIOLET_FROND);
          } else if(form==2) {
            // Rounded ribbed barrel cactus with a crown of small flowers.
            oval(0,-h/2,5,h/2,CACTUS);
            for(int x=-3;x<=3;x+=3)line(x,-h+2,x,-2,1,TEAL_LICHEN);
            flower(lean*2,-h,VIOLET_FROND);put(-5,-h/2,OCHRE_REED);put(5,-3,OCHRE_REED);
          } else {
            stem=DRIFTWOOD;
            for(int i=-1;i<=1;i++) {
              int x=i*7+lean,y=-h+std::abs(i)*4;
              line(0,0,i*3,-4,2,stem);line(i*3,-4,x,y,1,stem);
              for(int d=-2;d<=2;d+=2) {
                line(x,y+2,x+d,y-2,1,OCHRE_REED);put(x+d,y-2,RUST_BRAMBLE);
              }
            }
          }
        } else if(biome==BIOME_TUNDRA) {
          h=5+h/3;
          if(form==0) {
            // Low, wind-bent willow with russet buds above the snow.
            line(0,0,lean*7,-h+2,2,stem);
            for(int i=1;i<5;i++) {
              int x=lean*i*2,y=-i;
              line(x,y,x-lean,-h-1,1,stem);oval(x-lean,-h-1,1,2,RUST_BRAMBLE);
            }
          } else if(form==1) {
            for(int i=-2;i<=2;i++) {
              int x=i*4,y=-h+std::abs(i)*2;
              line(0,0,x,y,2,TEAL_LICHEN);
              line(x,y,x-2,y-3,1,TEAL_LICHEN);line(x,y,x+2,y-2,1,TEAL_LICHEN);
              put(x-2,y-3,MUSH_STEM);put(x+2,y-2,MUSH_STEM);
            }
          } else if(form==2) {
            // Heather cushions have individual flowering tips, not solid domes.
            for(int i=-2;i<=2;i++) {
              int x=i*3,y=-h+std::abs(i)*2;
              line(0,0,x,y,2,PINE_NEEDLES);
              oval(x,y,1,2,VIOLET_FROND);put(x,y-2,MUSH_STEM);
            }
          } else {
            for(int i=-1;i<=1;i++) {
              int x=i*5+lean,y=-h-2+std::abs(i)*3;
              line(0,0,x,y,1,OCHRE_REED);oval(x,y,2,2,MUSH_STEM);
              line(0,0,i*7,-3,1,TEAL_LICHEN);
            }
          }
        } else if(biome==BIOME_PLAINS) {
          stem=PLANT;
          for(int i=-2;i<=2;i++) {
            int x=i*4+lean,y=-h+std::abs(i)*3;
            line(0,0,x,y,1,form==1?OCHRE_REED:green);
            line(x/2,y/2,x/2+lean*3,y/2-2,1,green);
            if(form==0||form==2)flower(x,y,form==2?MUSH_STEM:blossom);
            else if(form==1){oval(x,y,1,3,OCHRE_REED);put(x,y-3,MUSH_STEM);}
            else {oval(x,y+2,2,2,BUSH_LEAF);if(i%2==0)put(x,y,VIOLET_FROND);}
          }
        } else if(biome==BIOME_FOREST) {
          if(form==0) {
            fern(-6,h,-1,PLANT);fern(5,h-3,1,TEAL_LICHEN);fern(0,h+2,lean,PLANT);
          } else if(form==1) {
            for(int i=-1;i<=1;i++) {
              int x=i*6,y=-h/2+(i==lean?-3:1);
              line(0,1,x,0,2,stem);line(x,0,x,y,2,MUSH_STEM);
              oval(x,y,4,2,MUSH_CAP);line(x-3,y+1,x+3,y+1,1,OCHRE_REED);
              put(x-1,y-1,MUSH_STEM);put(x+2,y,MUSH_STEM);
            }
          } else if(form==2) {
            // Mossy fallen branch with shelf fungi and broken twigs.
            line(-10,-2,8,-4,4,DRIFTWOOD);line(0,1,0,-2,2,stem);
            line(-5,-3,-7,-8,2,DRIFTWOOD);line(4,-4,7,-7,1,DRIFTWOOD);
            line(-8,-3,5,-5,2,MOSS);oval(-4,-5,3,1,OCHRE_REED);oval(5,-6,2,1,MUSH_CAP);
          } else {
            for(int i=-1;i<=1;i++) {
              int x=i*6,y=-h/2+(i==lean?-3:0);
              line(0,0,x,y,2,stem);oval(x,y,3,3,BUSH_LEAF);
              put(x-1,y-2,VIOLET_FROND);put(x+2,y,MUSH_CAP);
            }
          }
        } else if(biome==BIOME_JUNGLE) {
          if(form==0||form==1) {
            // Broad split leaves and upright red bracts share a veined stalk.
            line(0,0,lean*2,-h-5,2,stem);
            for(int side:{-1,1})for(int j=0;j<2;j++) {
              int x=side*(6-j*2),y=-5-j*6;
              line(0,y+3,x,y,2,stem);oval(x,y,4,form==0?3:2,PLANT);
              line(x-side*3,y+1,x+side*3,y-1,1,TEAL_LICHEN);
              if(form==0){put(x+side*3,y-2,EMPTY);put(x+side*3,y+2,EMPTY);}
            }
            if(form==1)for(int j=0;j<3;j++) {
              oval(lean*2+(j%2?2:-2),-h-4+j*3,2,1,RUST_BRAMBLE);
              put(lean*2,-h-5+j*3,OCHRE_REED);
            }
          } else if(form==2) {
            fern(-7,h+3,-1,PLANT);fern(6,h,1,PLANT);
            fern(lean*3,h+7,lean,TEAL_LICHEN);
          } else {
            for(int i=-2;i<=2;i++) {
              int x=i*4,y=-h+std::abs(i)*4;
              line(0,0,x/2,y/2,3,BUSH_LEAF);line(x/2,y/2,x,y,2,PLANT);
            }
            line(0,0,0,-h-2,2,stem);flower(0,-h-2,VIOLET_FROND);
          }
        } else if(biome==BIOME_SWAMP) {
          int waterDepth=imax(0,ground-L->gSeaRow);
          h+=waterDepth;
          if(form==0||form==1||waterDepth>0) {
            for(int i=-1;i<=1;i++) {
              int x=i*5+lean,y=-h+std::abs(i)*3;
              line(0,1,x,y,1,OCHRE_REED);
              if(form==0||waterDepth>0){oval(x,y,1,3,WOOD);put(x,y-3,OCHRE_REED);}
              else flower(x,y,VIOLET_FROND);
              line(0,0,i*8,-h/2,1,PLANT);
            }
          } else if(form==2) {
            // Knuckled cypress roots and small green shoots hug the bank.
            for(int i=-1;i<=1;i++) {
              line(i*4,1,i*5,-h/2,3,DRIFTWOOD);
              line(0,1,i*4,1,2,stem);put(i*5,-h/2-1,TEAL_LICHEN);
            }
          } else {
            fern(-6,h,-1,TEAL_LICHEN);fern(6,h-2,1,PLANT);
            line(0,0,lean*3,-h,1,stem);flower(lean*3,-h,VIOLET_FROND);
          }
        }
      } else if(form==0) {
        // Feathered fans: ivory ribs with ochre tips, or broad violet pinnae.
        line(0,1,lean*2,-h,2,stem);
        for(int y=3;y<h;y+=3)for(int side:{-1,1}) {
          int len=imax(2,(h-y)/2+2),x=lean*2*y/h;
          line(x,-y,x+side*len,-y-3,eye?2:1,eye?leaf:BONE);
          put(x+side*len,-y-4,eye?EYE_IRIS:leaf);
        }
      } else if(form==1) {
        // Forking thorn shrubs carry colored pods at unequal heights.
        line(0,1,lean*3,-h,2,stem);
        for(int side:{-1,1}) {
          int y=-h/2+(side==lean?2:-1),tip=side*(6+(slot&1));
          line(lean,y,tip,y-3,2,stem);
          line(tip,y-3,tip+side,y-7,1,eye?leaf:BONE);
          oval(tip,y-7,2,2,eye?EYE_IRIS:OCHRE_REED);
          line(side*3,y-1,side*5,y+2,1,eye?leaf:BONE);
        }
        if(eye)stampEyeGlyph(put,lean*3,-h-2,4,3,lean);
        else oval(lean*3,-h,2,3,OCHRE_REED);
      } else if(form==2) {
        // Curled fronds and branching lichen form broad, low ground cover.
        for(int side:{-1,1}) {
          line(0,1,side*7,-4,2,eye?leaf:TEAL_LICHEN);
          line(side*7,-4,side*9,-8,2,eye?leaf:TEAL_LICHEN);
          line(side*9,-8,side*6,-10,2,eye?leaf:TEAL_LICHEN);
          line(side*6,-10,side*5,-7,2,eye?EYE_IRIS:OCHRE_REED);
          for(int d=2;d<7;d+=2)line(side*d,-d/2,side*(d+2),-d/2-3,1,eye?EYE_WOOD:TEAL_LICHEN);
        }
        oval(0,-3,3,3,eye?EYE_IRIS:TEAL_LICHEN);
        line(0,1,0,-4,2,stem);
      } else {
        // Asymmetric reed clumps with warm seed heads or tiny watching buds.
        for(int i=-1;i<=1;i++) {
          int tip=i*5+lean,up=h-std::abs(i)*3+(i==lean?2:0);
          line(0,1,tip,-up,1,eye?EYE_WOOD:OCHRE_REED);
          if(eye) {
            oval(tip,-up,3,2,VIOLET_FROND);
            oval(tip,-up,1,1,EYE_IRIS);put(tip,-up,EYE_PUPIL);
          } else {
            oval(tip,-up,1,3,RUST_BRAMBLE);
            put(tip,-up-3,BONE);
          }
          line(i*2,-3,i*6,-6,1,eye?VIOLET_FROND:OCHRE_REED);
        }
      }
      // Root flares follow the local slope; the central root crosses loose soil
      // to reach the load-bearing stratum beneath it.
      for(int dx=-2;dx<=2;dx++)line(0,-2,dx,terrain.genSurfaceAbs(wx+dx)-ground+1,2,stem);
      line(0,0,0,rootDepth,2,stem);
      for(int y=-40;y<24;y++)for(int x=-12;x<=12;x++) {
        uint8_t m=raster[(y+originY)*width+x+12];
        if(m==EMPTY)continue;
        int lx=wx+x-L->worldOffsetX,ly=localGround+y;
        if(lx<colStart || lx>=colEnd || ly<rowStart || ly>=rowEnd)continue;
        uint8_t& target=L->grid[I(lx,ly)];
        bool soil=target==DIRT || target==GRASS || target==SAND || target==SNOW || target==MUD;
        bool root=y>=0 && x>=0 && x<=1 && target==VEIN_SOIL;
        // Stems that meet an uphill soil bank bury into it, including the parts
        // above the central root's elevation. Existing rock and trees stay intact.
        if(target==EMPTY || root || (biome!=BIOME_ROCKY && !eye && soil)
           || (biome==BIOME_SWAMP && target==WATER && y<0))target=m;
      }
    }
  }
