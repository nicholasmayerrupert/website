#pragma once

// Site bounds reserve the whole district. Rooms and connecting routes separately
// describe the occupied space, leaving the rock between wings in its natural state.
struct CaveSiteRoom {
  int left = 0, top = 0, right = 0, floor = 0;
  int design = 0;
};
struct CaveSiteLink {
  int from = 0, to = 0;
};
struct CaveSitePlan {
  std::array<CaveSiteRoom, 8> rooms{};
  std::array<CaveSiteLink, 9> links{};
  int roomCount = 0, linkCount = 0, mainRooms = 0;
  bool galleries = false, organic = false, castle = false;

  bool interiorAt(int x, int y) const {
    for (int i = 0; i < roomCount; i++) {
      const auto& r = rooms[i];
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.floor)
        return true;
    }
    return passageAt(x,y);
  }

  bool passageAt(int x, int y) const {
    for (int i = 0; i < linkCount; i++) {
      const auto& a = rooms[links[i].from];
      const auto& b = rooms[links[i].to];
      int ax = (a.left + a.right) / 2, bx = (b.left + b.right) / 2;
      if (x < imin(ax,bx)-3 || x > imax(ax,bx)+3) continue;
      int sampleX = std::clamp(x,imin(ax,bx),imax(ax,bx));
      int floor = a.floor + (int)std::lround((double)(b.floor-a.floor)*(sampleX-ax)/(bx-ax));
      if (y >= floor-PLAYER_H-8 && y < floor) return true;
    }
    return false;
  }
};

inline bool caveHasSprawlingSite(int design) {
  return design == 0 || design == 1 || design == 2 || design == 5
      || design == 6 || design == 9 || design == 16 || design == 18;
}

inline CaveSitePlan makeCaveSite(int left, int top, int width, int height,
                                 int design, uint32_t seed) {
  CaveSitePlan p;
  p.galleries = design == 1 || design == 9 || design == 16;
  p.organic = design == 5 || design == 18;
  p.castle = design == 6;
  int floor = top + height - 1;
  int count = width >= 180 ? 4 + (int)(seed & 1) : 3;
  p.mainRooms = count;
  int stride = (width - 46) / (count - 1);
  auto room = [&](int center, int y, int w, int h, int ornament) {
    auto& r = p.rooms[p.roomCount++];
    r.left = center - w/2; r.right = r.left + w-1;
    r.floor = y; r.top = imax(top+2, y-h+1); r.design = ornament;
  };
  for (int i = 0; i < count; i++) {
    int x = left + 23 + i*stride;
    int y = floor - (p.galleries ? 28 : 0)
          - (i%2 ? 12 : 0) - (int)(whash2(seed ^ 0x511Eu,i,0)*9);
    int w = imin(stride-12, 30 + (int)(whash2(seed ^ 0x511Fu,i,0)*13));
    int h = 26 + (int)(whash2(seed ^ 0x5120u,i,0)*15);
    if(p.castle)h += i%2 ? 20 : 8;
    int ornament = design;
    if(p.galleries && i != count/2)ornament = design == 16 ? 16 : 3;
    room(x,y,w,h,ornament);
    if(i)p.links[p.linkCount++]={i-1,i};
  }
  // Side branches use distinct horizontal positions and floors so they form real
  // forks. Their sloped approaches are walkable stair runs, not ladder-only shafts.
  if(height >= 78) {
    int parent = count/2;
    int x = left + 23 + parent*stride;
    int side = (seed&1) ? -1 : 1;
    room(imax(left+16, imin(left+width-17, x + side*(stride+12))), floor-62, 28, 26, p.castle ? 6 : design);
    p.links[p.linkCount++]={parent,p.roomCount-1};
    if((p.galleries && (seed&8)) || p.castle) {
      room(x-side*(stride*3/4), floor-2, 32, 22, p.castle ? 0 : design);
      p.links[p.linkCount++]={parent,p.roomCount-1};
    }
  }
  return p;
}
