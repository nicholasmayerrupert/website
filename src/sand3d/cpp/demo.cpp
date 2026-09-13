#include <emscripten/emscripten.h>
#include <box3d/box3d.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>
#include "renderer.hpp"

namespace {
constexpr int W=64,H=40,D=64,N=W*H*D,B=16,BN=B*B*B,MAX_BODIES=32,C=8;
constexpr int CW=W/C,CH=H/C,CD=D/C;
enum Material : uint8_t { AIR, SAND, BEDROCK, STONE, WOOD, GRASS, COPPER, LEAVES };
struct Cell { int x,y,z; };
int index(int x,int y,int z) { return x+W*(y+H*z); }
int localIndex(int x,int y,int z) { return x+B*(z+B*y); }
bool inside(int x,int y,int z) { return x>=0&&x<W&&y>=0&&y<H&&z>=0&&z<D; }
bool solid(uint8_t m) { return m>=BEDROCK; }
b3Vec3 add(b3Vec3 a,b3Vec3 b) { return {a.x+b.x,a.y+b.y,a.z+b.z}; }
b3Vec3 sub(b3Vec3 a,b3Vec3 b) { return {a.x-b.x,a.y-b.y,a.z-b.z}; }
b3Vec3 mul(b3Vec3 a,float s) { return {a.x*s,a.y*s,a.z*s}; }
float length(b3Vec3 a) { return std::sqrt(a.x*a.x+a.y*a.y+a.z*a.z); }
b3Vec3 unit(b3Vec3 a) { return mul(a,1.0f/std::max(0.000001f,length(a))); }
float axis(b3Vec3 a,int k) { return k==0?a.x:k==1?a.y:a.z; }
const Cell neighbors[6]={{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};

struct Body {
  b3BodyId id{};
  std::array<uint8_t,BN> cells{};
  Cell size{};
  bool active=false,dirty=false;
};
struct Hit {
  bool found=false;
  int slot=-1;
  Cell cell{};
  b3Vec3 normal{},point{};
  float distance=160;
  uint8_t material=0;
};

struct Demo {
  std::array<uint8_t,N> grid{},occupied{},visited{};
  std::array<uint8_t,(W/4)*(H/4)*(D/4)> coarse{};
  std::array<bool,CW*CH*CD> dirtyChunks{},uploadChunks{};
  std::array<b3BodyId,CW*CH*CD> terrainBodies{};
  std::array<Body,MAX_BODIES> bodies{};
  b3WorldId world{};
  Renderer renderer;
  b3Vec3 camera{32,18,55};
  float yaw=0,pitch=-0.23f,brush=1.5f,cooldown=0;
  bool keys[8]{},held=false,paused=false,coarseDirty=true;
  int tool=0,tick=0,mined=0,detached=0,sandCount=0,limitHits=0;
  float stats[20]{};
  double stepMs=0;
  Hit target;
  std::vector<Cell> queue;

  Demo() { queue.reserve(N); reset(); }
  ~Demo() { renderer.destroy(); if(b3World_IsValid(world)) b3DestroyWorld(world); }
  b3Vec3 forward() const { return {std::sin(yaw)*std::cos(pitch),std::sin(pitch),-std::cos(yaw)*std::cos(pitch)}; }
  b3Vec3 right() const { return {std::cos(yaw),0,std::sin(yaw)}; }
  int freeSlot() { for(int i=0;i<MAX_BODIES;++i) if(!bodies[i].active) return i; return -1; }
  int bodyCount() const { int n=0;for(const auto& b:bodies) n+=b.active;return n; }
  uint8_t get(int x,int y,int z) const { return inside(x,y,z)?grid[index(x,y,z)]:uint8_t(AIR); }
  void mark(int x,int y,int z,bool collision) {
    int c=x/C+CW*(y/C+CH*(z/C)); uploadChunks[c]=true; coarseDirty=true;
    if(collision) dirtyChunks[c]=true;
  }
  void set(int x,int y,int z,uint8_t m) {
    if(!inside(x,y,z)) return;
    auto& v=grid[index(x,y,z)]; if(v==m) return;
    sandCount+=(m==SAND)-(v==SAND);
    bool collision=solid(v)||solid(m); v=m; mark(x,y,z,collision);
  }
  void box(int x0,int y0,int z0,int x1,int y1,int z1,uint8_t m) {
    for(int z=z0;z<z1;++z) for(int y=y0;y<y1;++y) for(int x=x0;x<x1;++x) set(x,y,z,m);
  }
  void reset() {
    if(b3World_IsValid(world)) b3DestroyWorld(world);
    auto def=b3DefaultWorldDef(); def.gravity={0,-18,0};
    world=b3CreateWorld(&def);
    grid.fill(0); occupied.fill(0); coarse.fill(0); terrainBodies.fill({}); bodies={};
    dirtyChunks.fill(true); uploadChunks.fill(true); coarseDirty=true;
    sandCount=0; mined=0; detached=0; tick=0; limitHits=0; cooldown=0;
    std::fill(std::begin(keys),std::end(keys),false); held=false;
    camera={32,18,55}; yaw=0; pitch=-0.23f;
    for(int z=0;z<D;++z) for(int x=0;x<W;++x) {
      float edge=std::max(std::abs(x-32),std::abs(z-32));
      int top=6+int(std::max(0.0f,edge-19)*0.25f + (edge>20?2.0f*std::sin(x*0.21f)*std::sin(z*0.17f):0));
      for(int y=0;y<=top;++y) set(x,y,z,y==0?BEDROCK:y==top?GRASS:STONE);
    }
    // The quarry has an exposed copper seam, a timber gantry, and a supported stone lintel.
    box(24,7,25,26,16,28,WOOD); box(38,7,25,40,16,28,WOOD);
    box(24,16,25,40,19,28,STONE); box(27,19,25,37,20,28,COPPER);
    box(10,7,19,12,16,21,WOOD); box(19,7,19,21,16,21,WOOD);
    box(10,16,19,21,18,22,WOOD);
    box(43,7,18,50,12,24,STONE); box(43,8,23,50,11,24,COPPER);
    for(int z=31;z<42;++z) for(int x=12;x<24;++x) {
      int top=7+std::max(0,5-int(std::hypot(x-18,z-36)));
      for(int y=7;y<top;++y) set(x,y,z,SAND);
    }
    // A rooted voxel tree connects its crown to the ground through its trunk.
    box(47,7,39,49,19,41,WOOD);
    for(int z=36;z<45;++z) for(int x=44;x<53;++x) for(int y=17;y<24;++y)
      if((x-48)*(x-48)+(z-40)*(z-40)+(y-20)*(y-20)<24) set(x,y,z,LEAVES);
    rebuildTerrain();
  }

  // Merge occupied cells into non-overlapping boxes before making collision hulls.
  template<class Sample> void buildHulls(b3BodyId body,int sx,int sy,int sz,Sample sample) {
    std::vector<uint8_t> done(sx*sy*sz);
    auto ix=[&](int x,int y,int z) { return x+sx*(y+sy*z); };
    for(int z=0;z<sz;++z) for(int y=0;y<sy;++y) for(int x=0;x<sx;++x) {
      uint8_t m=sample(x,y,z); if(!solid(m)||done[ix(x,y,z)]) continue;
      auto available=[&](int a,int b,int c) { return !done[ix(a,b,c)]&&sample(a,b,c)==m; };
      int ex=x+1,ey=y+1,ez=z+1;
      while(ex<sx&&available(ex,y,z)) ++ex;
      while(ez<sz) { bool ok=true; for(int a=x;a<ex;++a) if(!available(a,y,ez)) ok=false; if(!ok)break;++ez; }
      while(ey<sy) { bool ok=true;for(int c=z;c<ez;++c)for(int a=x;a<ex;++a)if(!available(a,ey,c))ok=false;if(!ok)break;++ey; }
      for(int c=z;c<ez;++c)for(int b=y;b<ey;++b)for(int a=x;a<ex;++a)done[ix(a,b,c)]=1;
      auto hull=b3MakeOffsetBoxHull((ex-x)*0.5f,(ey-y)*0.5f,(ez-z)*0.5f,{(ex+x)*0.5f,(ey+y)*0.5f,(ez+z)*0.5f});
      auto shape=b3DefaultShapeDef(); shape.density=m==WOOD||m==LEAVES?0.55f:2.4f;
      shape.baseMaterial.friction=0.7f; shape.baseMaterial.restitution=0.05f;
      b3CreateHullShape(body,&shape,&hull.base);
    }
  }
  void rebuildTerrain() {
    bool changed=false;
    for(int z=0;z<CD;++z)for(int y=0;y<CH;++y)for(int x=0;x<CW;++x) {
      int c=x+CW*(y+CH*z); if(!dirtyChunks[c])continue;
      dirtyChunks[c]=false; changed=true;
      if(b3Body_IsValid(terrainBodies[c])) b3DestroyBody(terrainBodies[c]);
      auto def=b3DefaultBodyDef();def.position={float(x*C),float(y*C),float(z*C)};
      terrainBodies[c]=b3CreateBody(world,&def);
      buildHulls(terrainBodies[c],C,C,C,[&](int a,int b,int d){return get(x*C+a,y*C+b,z*C+d);});
    }
    if(changed) for(auto& b:bodies) if(b.active) b3Body_SetAwake(b.id,true);
  }
  int createBody(const std::vector<Cell>& cells,const std::vector<uint8_t>& materials,b3Vec3 origin,
                 b3Quat rotation=b3Quat_identity,b3Vec3 velocity={0,0,0},b3Vec3 angular={0,0,0}) {
    int slot=freeSlot(); if(slot<0) {++limitHits;return -1;}
    auto& b=bodies[slot]; b=Body{};b.active=true;b.dirty=true;
    auto def=b3DefaultBodyDef();def.type=b3_dynamicBody;def.position=origin;def.rotation=rotation;
    def.linearVelocity=velocity;def.angularVelocity=angular;def.angularDamping=0.12f;
    b.id=b3CreateBody(world,&def);
    for(size_t i=0;i<cells.size();++i) {
      auto c=cells[i];b.cells[localIndex(c.x,c.y,c.z)]=materials[i];
      b.size.x=std::max(b.size.x,c.x+1);b.size.y=std::max(b.size.y,c.y+1);b.size.z=std::max(b.size.z,c.z+1);
    }
    buildHulls(b.id,b.size.x,b.size.y,b.size.z,[&](int x,int y,int z){return b.cells[localIndex(x,y,z)];});
    ++detached;return slot;
  }
  void detachUnsupported() {
    visited.fill(0);queue.clear();
    for(int z=0;z<D;++z)for(int x=0;x<W;++x)if(solid(get(x,0,z))) {visited[index(x,0,z)]=1;queue.push_back({x,0,z});}
    for(size_t h=0;h<queue.size();++h) {
      auto c=queue[h];for(auto n:neighbors) {
        int x=c.x+n.x,y=c.y+n.y,z=c.z+n.z;
        if(!inside(x,y,z))continue;int i=index(x,y,z);
        if(!visited[i]&&solid(grid[i])) {visited[i]=1;queue.push_back({x,y,z});}
      }
    }
    for(int z=0;z<D;++z)for(int y=1;y<H;++y)for(int x=0;x<W;++x) {
      if(visited[index(x,y,z)]||!solid(get(x,y,z)))continue;
      queue.clear();queue.push_back({x,y,z});visited[index(x,y,z)]=1;
      Cell lo{x,y,z},hi=lo;
      for(size_t h=0;h<queue.size();++h) {
        auto c=queue[h];lo={std::min(lo.x,c.x),std::min(lo.y,c.y),std::min(lo.z,c.z)};
        hi={std::max(hi.x,c.x),std::max(hi.y,c.y),std::max(hi.z,c.z)};
        for(auto n:neighbors) {
          int a=c.x+n.x,b=c.y+n.y,d=c.z+n.z;if(!inside(a,b,d))continue;int i=index(a,b,d);
          if(!visited[i]&&solid(grid[i])){visited[i]=1;queue.push_back({a,b,d});}
        }
      }
      // Large disconnected regions are partitioned into bounded local voxel volumes.
      for(int oz=lo.z;oz<=hi.z;oz+=B)for(int oy=lo.y;oy<=hi.y;oy+=B)for(int ox=lo.x;ox<=hi.x;ox+=B) {
        std::vector<Cell> cells;std::vector<uint8_t> mats;
        for(auto c:queue)if(c.x>=ox&&c.x<ox+B&&c.y>=oy&&c.y<oy+B&&c.z>=oz&&c.z<oz+B) {
          cells.push_back({c.x-ox,c.y-oy,c.z-oz});mats.push_back(get(c.x,c.y,c.z));
        }
        if(cells.empty())continue;
        if(createBody(cells,mats,{float(ox),float(oy),float(oz)})<0)continue;
        for(auto c:cells)set(ox+c.x,oy+c.y,oz+c.z,AIR);
      }
    }
    rebuildTerrain();updateOccupied();
  }
  void updateOccupied() {
    occupied.fill(0);
    for(auto& b:bodies)if(b.active) {
      auto transform=b3Body_GetTransform(b.id);
      for(int y=0;y<b.size.y;++y)for(int z=0;z<b.size.z;++z)for(int x=0;x<b.size.x;++x)if(b.cells[localIndex(x,y,z)]) {
        auto p=add(transform.p,b3RotateVector(transform.q,{x+0.5f,y+0.5f,z+0.5f}));
        int a=int(std::floor(p.x)),d=int(std::floor(p.y)),c=int(std::floor(p.z));
        if(inside(a,d,c))occupied[index(a,d,c)]=1;
      }
    }
  }
  void stepSand() {
    const Cell diagonals[8]={{1,0,0},{0,0,1},{-1,0,0},{0,0,-1},{1,0,1},{-1,0,1},{-1,0,-1},{1,0,-1}};
    auto empty=[&](int x,int y,int z) {return inside(x,y,z)&&grid[index(x,y,z)]==AIR&&!occupied[index(x,y,z)];};
    for(int y=1;y<H;++y)for(int iz=0;iz<D;++iz)for(int ix=0;ix<W;++ix) {
      int x=tick%2?W-1-ix:ix,z=tick%2?D-1-iz:iz;
      if(get(x,y,z)!=SAND)continue;
      if(empty(x,y-1,z)) {set(x,y,z,AIR);set(x,y-1,z,SAND);continue;}
      if(occupied[index(x,y,z)]) {
        for(int up=1;up<6;++up)if(empty(x,y+up,z)) {set(x,y,z,AIR);set(x,y+up,z,SAND);break;}
        continue;
      }
      for(int k=0;k<8;++k) {
        auto n=diagonals[(k+tick+x+z)%8];
        if(empty(x+n.x,y,z+n.z)&&empty(x+n.x,y-1,z+n.z)) {set(x,y,z,AIR);set(x+n.x,y-1,z+n.z,SAND);break;}
      }
    }
  }
  template<class Sample> Hit cast(b3Vec3 o,b3Vec3 d,Cell size,Sample sample,float limit) {
    Hit hit; float nearT=0,farT=limit;int entry=-1;
    for(int k=0;k<3;++k) {
      float a=axis(o,k),v=axis(d,k),s=k==0?size.x:k==1?size.y:size.z;
      if(std::abs(v)<1e-7f) {if(a<0||a>=s)return hit;continue;}
      float t0=-a/v,t1=(s-a)/v;if(t0>t1)std::swap(t0,t1);
      if(t0>nearT){nearT=t0;entry=k;}farT=std::min(farT,t1);
    }
    if(nearT>farT)return hit;
    float t=nearT+0.0002f;
    b3Vec3 normal={0,0,0};if(entry>=0) {float s=axis(d,entry)>0?-1.f:1.f;if(entry==0)normal.x=s;else if(entry==1)normal.y=s;else normal.z=s;}
    for(int step=0;step<240&&t<farT;++step) {
      auto p=add(o,mul(d,t));Cell c{int(std::floor(p.x)),int(std::floor(p.y)),int(std::floor(p.z))};
      if(c.x<0||c.x>=size.x||c.y<0||c.y>=size.y||c.z<0||c.z>=size.z)break;
      auto m=sample(c);if(m){hit.found=true;hit.distance=t;hit.point=p;hit.normal=normal;hit.cell=c;hit.material=m;return hit;}
      float next=1e9;int kbest=0;
      for(int k=0;k<3;++k) {
        float v=axis(d,k);if(std::abs(v)<1e-7f)continue;
        float q=k==0?c.x:k==1?c.y:c.z;
        float nt=(q+(v>0?1:0)-axis(o,k))/v;
        if(nt<next){next=nt;kbest=k;}
      }
      t=std::max(t+0.0002f,next+0.0002f);normal={0,0,0};float s=axis(d,kbest)>0?-1.f:1.f;
      if(kbest==0)normal.x=s;else if(kbest==1)normal.y=s;else normal.z=s;
    }
    return hit;
  }
  Hit pick() {
    auto dir=forward();Hit best=cast(camera,dir,{W,H,D},[&](Cell c){return get(c.x,c.y,c.z);},32);
    if(!best.found)best.distance=32;
    for(int i=0;i<MAX_BODIES;++i)if(bodies[i].active) {
      auto& b=bodies[i];auto tr=b3Body_GetTransform(b.id);
      auto o=b3InvRotateVector(tr.q,sub(camera,tr.p));auto d=b3InvRotateVector(tr.q,dir);
      auto h=cast(o,d,b.size,[&](Cell c){return b.cells[localIndex(c.x,c.y,c.z)];},best.distance);
      if(h.found){h.slot=i;h.normal=b3RotateVector(tr.q,h.normal);h.point=add(tr.p,b3RotateVector(tr.q,h.point));best=h;}
    }
    return best;
  }
  void mineBody(int slot,Cell center) {
    auto& b=bodies[slot];auto tr=b3Body_GetTransform(b.id);auto angular=b3Body_GetAngularVelocity(b.id);
    auto velocity=b3Body_GetLinearVelocity(b.id);auto oldCenter=b3Body_GetWorldCenter(b.id);
    for(int y=0;y<b.size.y;++y)for(int z=0;z<b.size.z;++z)for(int x=0;x<b.size.x;++x) {
      if((x-center.x)*(x-center.x)+(y-center.y)*(y-center.y)+(z-center.z)*(z-center.z)>brush*brush)continue;
      auto& m=b.cells[localIndex(x,y,z)];if(m){m=AIR;++mined;}
    }
    std::array<uint8_t,BN> seen{};
    std::vector<std::vector<Cell>> groups;
    for(int y=0;y<b.size.y;++y)for(int z=0;z<b.size.z;++z)for(int x=0;x<b.size.x;++x) {
      int i=localIndex(x,y,z);if(seen[i]||!b.cells[i])continue;
      groups.push_back({{x,y,z}});seen[i]=1;auto& g=groups.back();
      for(size_t j=0;j<g.size();++j)for(auto n:neighbors) {
        Cell c{g[j].x+n.x,g[j].y+n.y,g[j].z+n.z};
        if(c.x<0||c.y<0||c.z<0||c.x>=B||c.y>=B||c.z>=B)continue;
        int k=localIndex(c.x,c.y,c.z);if(!seen[k]&&b.cells[k]){seen[k]=1;g.push_back(c);}
      }
    }
    int available=MAX_BODIES-bodyCount()+1;
    if(int(groups.size())>available) {
      // Preserve remaining material in one multi-shape body when the demo pool is full.
      for(size_t i=1;i<groups.size();++i)groups[0].insert(groups[0].end(),groups[i].begin(),groups[i].end());
      groups.resize(1);++limitHits;
    }
    auto data=b.cells;b3DestroyBody(b.id);b.active=false;
    for(auto& g:groups) {
      Cell lo{B,B,B};for(auto c:g)lo={std::min(lo.x,c.x),std::min(lo.y,c.y),std::min(lo.z,c.z)};
      std::vector<Cell> cells;std::vector<uint8_t> mats;
      for(auto c:g){cells.push_back({c.x-lo.x,c.y-lo.y,c.z-lo.z});mats.push_back(data[localIndex(c.x,c.y,c.z)]);}
      auto origin=add(tr.p,b3RotateVector(tr.q,{float(lo.x),float(lo.y),float(lo.z)}));
      int i=createBody(cells,mats,origin,tr.q,velocity,angular);
      if(i>=0) {auto center=b3Body_GetWorldCenter(bodies[i].id);b3Body_SetLinearVelocity(bodies[i].id,add(velocity,b3Cross(angular,sub(center,oldCenter))));}
    }
    updateOccupied();
  }
  void useTool() {
    target=pick();
    if(tool==0) {
      if(!target.found||target.material==BEDROCK)return;
      if(target.slot>=0){mineBody(target.slot,target.cell);return;}
      Cell c=target.cell;bool changed=false;
      int r=int(std::ceil(brush));
      for(int z=c.z-r;z<=c.z+r;++z)for(int y=c.y-r;y<=c.y+r;++y)for(int x=c.x-r;x<=c.x+r;++x) {
        if((x-c.x)*(x-c.x)+(y-c.y)*(y-c.y)+(z-c.z)*(z-c.z)>brush*brush)continue;
        auto m=get(x,y,z);if(m&&m!=BEDROCK){set(x,y,z,AIR);++mined;changed|=solid(m);}
      }
      if(changed)detachUnsupported();
    } else if(tool==4) {
      if(freeSlot()<0){++limitHits;return;}
      auto p=add(camera,mul(forward(),7));
      std::vector<Cell> cells;std::vector<uint8_t> mats;
      for(int y=0;y<3;++y)for(int z=0;z<3;++z)for(int x=0;x<3;++x) {cells.push_back({x,y,z});mats.push_back(x==1&&z==1?COPPER:STONE);}
      createBody(cells,mats,sub(p,{1.5f,1.5f,1.5f}),b3Quat_identity,mul(forward(),14),{1.0f,0.3f,0.7f});
      updateOccupied();
    } else {
      auto p=target.found?add(target.point,mul(target.normal,tool==1?brush+0.6f:0.15f)):add(camera,mul(forward(),10));
      int cx=int(std::floor(p.x)),cy=int(std::floor(p.y)),cz=int(std::floor(p.z));
      int r=tool==1?int(brush):0;
      uint8_t m=tool==1?SAND:tool==2?STONE:WOOD;
      bool changed=false;
      for(int z=cz-r;z<=cz+r;++z)for(int y=cy-r;y<=cy+r;++y)for(int x=cx-r;x<=cx+r;++x) {
        if(y<1||!inside(x,y,z)||get(x,y,z)||occupied[index(x,y,z)])continue;
        set(x,y,z,m);changed=true;
      }
      if(changed&&solid(m))detachUnsupported();
    }
  }
  void step(float dt) {
    auto start=emscripten_get_now();
    b3Vec3 move{};auto f=forward(),r=right();
    move=add(move,mul(f,float(keys[0])-float(keys[1])));move=add(move,mul(r,float(keys[3])-float(keys[2])));
    move.y+=float(keys[4])-float(keys[5]);
    if(length(move)>0)camera=add(camera,mul(unit(move),dt*(keys[6]?24:12)));
    camera.x=std::clamp(camera.x,0.5f,63.5f);camera.y=std::clamp(camera.y,1.5f,55.f);camera.z=std::clamp(camera.z,0.5f,63.5f);
    if(!paused) {
      cooldown-=dt;
      if(held&&cooldown<=0){useTool();cooldown=tool==4?0.45f:0.12f;}
      b3World_Step(world,dt,4);
      for(auto& b:bodies)if(b.active) {
        auto p=b3Body_GetPosition(b.id);
        if(p.y < -24 || p.x < -64 || p.x > W+64 || p.z < -64 || p.z > D+64) {b3DestroyBody(b.id);b.active=false;}
      }
      updateOccupied();
      if(tick%2==0)stepSand();
      ++tick;
    }
    target=pick();stepMs=emscripten_get_now()-start;
  }
  void render(int width,int height) {
    if(!renderer.context)return;
    glUseProgram(renderer.program);glBindVertexArray(renderer.vao);glViewport(0,0,width,height);
    glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_3D,renderer.textures[0]);
    std::array<uint8_t,C*C*C> packet{};
    for(int z=0;z<CD;++z)for(int y=0;y<CH;++y)for(int x=0;x<CW;++x) {
      int c=x+CW*(y+CH*z);if(!uploadChunks[c])continue;uploadChunks[c]=false;
      for(int k=0;k<C;++k)for(int j=0;j<C;++j)for(int i=0;i<C;++i)packet[i+C*(j+C*k)]=get(x*C+i,y*C+j,z*C+k);
      glTexSubImage3D(GL_TEXTURE_3D,0,x*C,y*C,z*C,C,C,C,GL_RED_INTEGER,GL_UNSIGNED_BYTE,packet.data());
    }
    if(coarseDirty) {
      coarse.fill(0);for(int z=0;z<D;++z)for(int y=0;y<H;++y)for(int x=0;x<W;++x)if(get(x,y,z))coarse[x/4+16*(y/4+10*(z/4))]=1;
      glActiveTexture(GL_TEXTURE1);glBindTexture(GL_TEXTURE_3D,renderer.textures[1]);
      glTexSubImage3D(GL_TEXTURE_3D,0,0,0,0,16,10,16,GL_RED_INTEGER,GL_UNSIGNED_BYTE,coarse.data());coarseDirty=false;
    }
    glActiveTexture(GL_TEXTURE2);glBindTexture(GL_TEXTURE_2D,renderer.textures[2]);
    float positions[MAX_BODIES*4]{},rotations[MAX_BODIES*4]{},sizes[MAX_BODIES*4]{};int count=0;
    for(int i=0;i<MAX_BODIES;++i)if(bodies[i].active) {
      auto& b=bodies[i];if(b.dirty){glTexSubImage2D(GL_TEXTURE_2D,0,0,i*16,256,16,GL_RED_INTEGER,GL_UNSIGNED_BYTE,b.cells.data());b.dirty=false;}
      auto p=b3Body_GetPosition(b.id);auto q=b3Body_GetRotation(b.id);int k=count++*4;
      positions[k]=p.x;positions[k+1]=p.y;positions[k+2]=p.z;positions[k+3]=float(i);
      rotations[k]=q.v.x;rotations[k+1]=q.v.y;rotations[k+2]=q.v.z;rotations[k+3]=q.s;
      sizes[k]=float(b.size.x);sizes[k+1]=float(b.size.y);sizes[k+2]=float(b.size.z);
    }
    glUniform1i(renderer.uniform("bodyCount"),count);
    if(count){glUniform4fv(renderer.uniform("bodyPosition[0]"),count,positions);glUniform4fv(renderer.uniform("bodyRotation[0]"),count,rotations);glUniform4fv(renderer.uniform("bodySize[0]"),count,sizes);}
    auto f=forward(),r=right(),u=b3Cross(r,f);
    glUniform3f(renderer.uniform("eye"),camera.x,camera.y,camera.z);
    glUniform3f(renderer.uniform("forward"),f.x,f.y,f.z);glUniform3f(renderer.uniform("rightward"),r.x,r.y,r.z);glUniform3f(renderer.uniform("upward"),u.x,u.y,u.z);
    glUniform2f(renderer.uniform("resolution"),float(width),float(height));
    glUniform4f(renderer.uniform("target"),float(target.cell.x),float(target.cell.y),float(target.cell.z),target.found?1.f:0.f);
    glUniform1i(renderer.uniform("targetBody"),target.slot);
    glDrawArrays(GL_TRIANGLES,0,3);
  }
  float* snapshot() {
    int cells=0,awake=0;float minY=1000;
    for(auto& b:bodies)if(b.active){awake+=b3Body_IsAwake(b.id);minY=std::min(minY,b3Body_GetPosition(b.id).y);for(auto m:b.cells)cells+=m!=0;}
    stats[0]=float(tick);stats[1]=float(bodyCount());stats[2]=float(awake);stats[3]=float(mined);stats[4]=float(sandCount);
    stats[5]=camera.x;stats[6]=camera.y;stats[7]=camera.z;stats[8]=float(stepMs);stats[9]=float(target.material);
    stats[10]=float(detached);stats[11]=float(cells);stats[12]=minY;stats[13]=float(limitHits);
    stats[14]=yaw;stats[15]=pitch;stats[16]=target.found?target.distance:-1;
    return stats;
  }
};
Demo* demo=nullptr;
}

extern "C" {
EMSCRIPTEN_KEEPALIVE int demo_create(int graphics) {
  delete demo;demo=new Demo();
  if(graphics&&!demo->renderer.init()){delete demo;demo=nullptr;return 0;}return 1;
}
EMSCRIPTEN_KEEPALIVE void demo_destroy(){delete demo;demo=nullptr;}
EMSCRIPTEN_KEEPALIVE void demo_reset(){if(demo)demo->reset();}
EMSCRIPTEN_KEEPALIVE void demo_step(float dt){if(demo)demo->step(std::clamp(dt,0.0f,1.0f/30));}
EMSCRIPTEN_KEEPALIVE void demo_render(int w,int h){if(demo)demo->render(w,h);}
EMSCRIPTEN_KEEPALIVE void demo_key(int key,int down){if(demo&&key>=0&&key<8)demo->keys[key]=down!=0;}
EMSCRIPTEN_KEEPALIVE void demo_clear_input(){if(demo){std::fill(std::begin(demo->keys),std::end(demo->keys),false);demo->held=false;}}
EMSCRIPTEN_KEEPALIVE void demo_look(float x,float y){if(demo){demo->yaw+=x*0.0025f;demo->pitch=std::clamp(demo->pitch-y*0.0025f,-1.50f,1.50f);}}
EMSCRIPTEN_KEEPALIVE void demo_hold(int held){if(demo)demo->held=held!=0;}
EMSCRIPTEN_KEEPALIVE void demo_tool(int tool){if(demo)demo->tool=std::clamp(tool,0,4);}
EMSCRIPTEN_KEEPALIVE void demo_brush(float radius){if(demo)demo->brush=std::clamp(radius,0.5f,3.5f);}
EMSCRIPTEN_KEEPALIVE void demo_pause(int paused){if(demo)demo->paused=paused!=0;}
EMSCRIPTEN_KEEPALIVE float* demo_stats(){return demo?demo->snapshot():nullptr;}
// The deterministic scenario hooks exercise the same editing and stepping paths as input.
EMSCRIPTEN_KEEPALIVE void demo_camera(float x,float y,float z,float yaw,float pitch){if(demo){demo->camera={x,y,z};demo->yaw=yaw;demo->pitch=pitch;}}
EMSCRIPTEN_KEEPALIVE void demo_use(){if(demo)demo->useTool();}
EMSCRIPTEN_KEEPALIVE int demo_cell(int x,int y,int z){return demo?demo->get(x,y,z):0;}
}
