  // Separate wings occupy their own pieces of the cave. Only the connecting
  // routes carve between them; no enclosing wall or ceiling spans the site.
  template<class Put>
  void stampCaveSite(Put&& write, int left, int top, int width, int height,
                     int design, bool background, uint32_t seed, int foundation) {
    const CaveSitePlan site = makeCaveSite(left, top, width, height, design, seed);
    int right = left + width - 1, floor = top + height - 1;
    uint8_t masonry = design == 2 ? PALESTONE : design == 16 ? BONE : STONE;
    uint8_t timber = design == 9 ? IRON_ORE : PINE_WOOD;
    auto put = [&](int x, int y, uint8_t m) {
      if(!background && m!=EMPTY && site.passageAt(x,y))return;
      if(x>=left && x<=right && y>=top && y<=floor+foundation)write(x,y,m);
    };
    auto rect = [&](int l, int t, int r, int b, uint8_t m) {
      for(int y=t;y<=b;y++)for(int x=l;x<=r;x++)put(x,y,m);
    };
    auto support = [&](int x, int y, uint8_t m) {
      int anchor = y+1;
      while(anchor<floor+foundation-2 && terrain.genOpenCaveAt(x,anchor))anchor++;
      for(int py=y;py<=anchor+2;py++)for(int px=x-1;px<=x+1;px++) {
        bool roomBelow=false;
        for(int i=0;i<site.roomCount;i++) {
          const auto& r=site.rooms[i];
          if(px>=r.left && px<=r.right && py>=r.top && py<r.floor)roomBelow=true;
        }
        if(!roomBelow)put(px,py,m);
      }
    };
    auto lamp = [&](int x, int y) {
      if(!background)return;
      rect(x-1,y-1,x+1,y+1,timber);put(x,y,LIGHT);
    };
    ForegroundTerrainScope foregroundQuery(L);
    for(int i=0;i<site.roomCount;i++) {
      const auto& r=site.rooms[i];
      int w=r.right-r.left+1,h=r.floor-r.top+1,cx=(r.left+r.right)/2;
      if(site.organic) {
        // Mushroom settlements inhabit natural vaulted pockets. Caps, stems and
        // boardwalks provide their silhouette, with bare rock visible behind them.
        if(!background)for(int x=r.left;x<=r.right;x++) {
          double nx=(double)std::abs(x-cx)/(w*.5);
          int roof=r.top+3+(int)(nx*nx*9);
          for(int y=roof;y<r.floor-1;y++)put(x,y,EMPTY);
        }
        rect(r.left,r.floor-1,r.right,r.floor,MYCELIUM);
        if(background) {
          int cap=r.top+9+(i%3)*2;
          for(int y=cap;y<r.floor-1;y++) {
            int sway=(int)(2*std::sin((y-cap)*.12+i));
            rect(cx+sway-2,y,cx+sway+2,y,MUSH_STEM);
          }
          for(int x=r.left+2;x<r.right-1;x++) {
            double nx=(double)(x-cx)/(w*.45);
            int crown=cap-(int)(7*std::sqrt(std::fmax(0.,1.-nx*nx)));
            rect(x,crown,x,cap,MUSH_CAP);
            if((x-r.left)%3==0)rect(x,cap+1,x,cap+4,GLOWSHROOM);
          }
          rect(cx-5,r.floor-12,cx+5,r.floor-2,MUSH_STEM);
          rect(cx-2,r.floor-10,cx+2,r.floor-3,DEEPSTONE);
          lamp(cx,cap-2);lamp(cx+7,r.floor-8);
          for(int x=r.left+4;x<r.right-2;x+=7) {
            rect(x,r.floor-4,x+2,r.floor-2,MOSS);put(x+1,r.floor-5,GLOWSHROOM);
          }
        }
      } else {
        stampCaveArchitecture(put,r.left,r.top,w,h,r.design,background,seed^(i*0x9e3779b9u));
        if(site.castle && r.design==6) {
          for(int x=r.left;x<=r.right;x++)
            if((x-r.left)%7<3)rect(x,r.top+1,x,r.top+6,STONE);
          if(background)for(int y=r.top+14;y<r.floor-9;y+=18) {
            rect(cx-3,y-4,cx+3,y+4,PALESTONE);
            rect(cx-1,y-2,cx+1,y+3,DEEPSTONE);lamp(cx,y);
          }
        }
      }
      for(int x:{r.left+2,(r.left+r.right)/2,r.right-2})support(x,r.floor,masonry);
    }
    // Sloping bridges and rail tunnels connect room floors. Both layers share
    // exactly the same stairs, footings, and joints at the room thresholds.
    for(int i=0;i<site.linkCount;i++) {
      auto a=site.rooms[site.links[i].from],b=site.rooms[site.links[i].to];
      int ax=(a.left+a.right)/2,bx=(b.left+b.right)/2;
      if(ax>bx){std::swap(ax,bx);std::swap(a,b);}
      for(int x=ax-3;x<=bx+3;x++) {
        int sx=std::clamp(x,ax,bx);
        int y=a.floor+(int)std::lround((double)(b.floor-a.floor)*(sx-ax)/(bx-ax));
        if(!background)rect(x,y-PLAYER_H-8,x,y-1,EMPTY);
        // Existing room floors remain continuous at the branching junctions.
        put(x,y,timber);put(x,y+1,timber);
        if(site.galleries) {
          put(x,y,IRON_ORE);
          if(!site.interiorAt(x,y-PLAYER_H-7))put(x,y-PLAYER_H-9,timber);
        }
        if((x-ax)%16==0) {
          support(x,y+2,masonry);
          if(background) {
            rect(x,y-PLAYER_H-4,x,y-1,timber);
            for(int d=1;d<6;d++)put(x+d,y-PLAYER_H-4+d,timber);
            lamp(x+3,y-PLAYER_H-2);
          }
        }
      }
    }
    // End portals meet the natural cave at the two outermost wings.
    for(int side:{-1,1}) {
      const auto& r=site.rooms[side<0?0:site.mainRooms-1];
      int edge=side<0?r.left:r.right,limit=side<0?left:right;
      for(int x=imin(edge,limit);x<=imax(edge,limit);x++) {
        if(!background)rect(x,r.floor-PLAYER_H-5,x,r.floor-1,EMPTY);
        put(x,r.floor,masonry);
      }
    }
  }
