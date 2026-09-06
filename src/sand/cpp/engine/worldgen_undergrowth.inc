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
      if (biome != BIOME_ROCKY && biome != BIOME_WATCHWOOD) continue;
      int ground = terrain.genSurfaceAbs(wx), localGround = ground-L->worldOffsetY;
      if (localGround+reachY < rowStart || localGround-reachY >= rowEnd || ground >= L->gSeaRow-1) continue;
      double patch = wfbm2(seed ^ 0x11u,wx*.025,2.4,2,.5);
      if (whash1(seed ^ 0x12u,slot) > .28 + patch*.85) continue;
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
      if(form==0) {
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
        if(target==EMPTY || (y>=0 && x>=0 && x<=1 && target==VEIN_SOIL))target=m;
      }
    }
  }
