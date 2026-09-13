#include <emscripten/emscripten.h>
#include <box3d/box3d.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <climits>
#include <vector>
#include "voxel_world.hpp"
#include "renderer.hpp"

namespace {
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

struct Demo : VoxelWorld {
  PackedCells<N,1> occupied{};
  PackedCells<N,2> visited{};
  std::unordered_map<ChunkKey,b3BodyId,KeyHash> terrainBodies;
  std::vector<int> occupiedCells;
  struct SavedBody { Body body; ChunkKey anchor; b3Vec3 offset,velocity,angular; b3Quat rotation; };
  std::vector<SavedBody> savedBodies;
  double streamMs=0;
  int uploaded=0;
  std::array<Body,MAX_BODIES> bodies{};
  b3WorldId world{};
  Renderer renderer;
  b3Vec3 camera{128,96,192};
  float yaw=0,pitch=-0.23f,brush=6.0f,cooldown=0;
  bool keys[8]{},held=false,paused=false;
  int tool=0,tick=0,mined=0,detached=0,limitHits=0;
  float stats[36]{};
  int reactions=0,dissolved=0,reactionEdits=0;
  double stepMs=0;
  Hit target;
  std::vector<Cell> queue;

  Demo() { queue.reserve(16384); reset(); }
  ~Demo() { renderer.destroy(); if(b3World_IsValid(world)) b3DestroyWorld(world); }
  b3Vec3 forward() const { return {std::sin(yaw)*std::cos(pitch),std::sin(pitch),-std::cos(yaw)*std::cos(pitch)}; }
  b3Vec3 right() const { return {std::cos(yaw),0,std::sin(yaw)}; }
  int freeSlot() { for(int i=0;i<MAX_BODIES;++i) if(!bodies[i].active) return i; return -1; }
  int bodyCount() const { int n=0;for(const auto& b:bodies) n+=b.active;return n; }
  void reset() {
    if(b3World_IsValid(world))b3DestroyWorld(world);
    b3SetLengthUnitsPerMeter(1/VOXEL);
    auto def=b3DefaultWorldDef();def.gravity={0,-9.81f/VOXEL,0};world=b3CreateWorld(&def);
    resetVoxels();occupied.fill(0);visited.fill(0);occupiedCells.clear();terrainBodies.clear();bodies={};savedBodies.clear();
    mined=detached=tick=limitHits=reactions=dissolved=0;cooldown=0;streamMs=0;
    std::fill(std::begin(keys),std::end(keys),false);held=false;
    camera={W/2.f,H/2.f,D/2.f};yaw=0;pitch=-0.18f;
    renderer.invalidateLod();
  }
  void stream(bool immediate=false) {
    auto begin=emscripten_get_now();
    int dx=int((camera.x-W/2.f)/C)*C;
    int dy=int((camera.y-H/2.f)/C)*C;
    int dz=int((camera.z-D/2.f)/C)*C;
    if(immediate){prepared.clear();pending.clear();preparing=false;}
    if(!dx&&!dy&&!dz&&!preparing){streamMs=0;return;}
    if(!immediate) {
      if(!prepareWindow({origin.x+dx,origin.y+dy,origin.z+dz},4.0)){streamMs=emscripten_get_now()-begin;return;}
      dx=int(pendingOrigin.x-origin.x);dy=int(pendingOrigin.y-origin.y);dz=int(pendingOrigin.z-origin.z);
    }
    b3Vec3 delta{float(dx),float(dy),float(dz)};
    camera=sub(camera,delta);
    // Physics uses local floats; the stream origin carries the large coordinates.
    for(auto [key,id]:terrainBodies)if(b3Body_IsValid(id)){auto tr=b3Body_GetTransform(id);b3Body_SetTransform(id,sub(tr.p,delta),tr.q);}
    for(auto& b:bodies)if(b.active) {
      auto tr=b3Body_GetTransform(b.id);auto p=sub(tr.p,delta);
      if(length(sub(p,camera))>160/VOXEL) {
        savedBodies.push_back({b,origin,tr.p,b3Body_GetLinearVelocity(b.id),b3Body_GetAngularVelocity(b.id),tr.q});
        b3DestroyBody(b.id);b.active=false;
      }else b3Body_SetTransform(b.id,p,tr.q);
    }
    origin.x+=dx;origin.y+=dy;origin.z+=dz;fillWindow();prepared.clear();preparing=false;++shifts;
    for(size_t i=0;i<savedBodies.size()&&freeSlot()>=0;) {
      auto& a=savedBodies[i];b3Vec3 p{float(a.anchor.x-origin.x)+a.offset.x,float(a.anchor.y-origin.y)+a.offset.y,float(a.anchor.z-origin.z)+a.offset.z};
      if(length(sub(p,camera))<144/VOXEL) {
        std::vector<Cell> cells;std::vector<uint8_t> mats;
        for(int y=0;y<a.body.size.y;++y)for(int z=0;z<a.body.size.z;++z)for(int x=0;x<a.body.size.x;++x) {
          auto m=a.body.cells[localIndex(x,y,z)];if(m){cells.push_back({x,y,z});mats.push_back(m);}
        }
        createBody(cells,mats,p,a.rotation,a.velocity,a.angular);--detached;
        savedBodies.erase(savedBodies.begin()+i);
      }else ++i;
    }
    edits.clear();updateOccupied();rebuildTerrain();streamMs=emscripten_get_now()-begin;
  }
  void moveCamera(double x,double y,double z,float a,float p) {
    camera={float(x/VOXEL-origin.x),float(y/VOXEL-origin.y),float(z/VOXEL-origin.z)};yaw=a;pitch=p;stream(true);target=pick();
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
    // Visible bodies keep colliding with cached terrain beyond the voxel simulation window.
    std::unordered_map<ChunkKey,bool,KeyHash> needed;
    for(const auto& body:bodies)if(body.active) {
      auto p=b3Body_GetPosition(body.id);
      int radius=std::max({body.size.x,body.size.y,body.size.z});
      for(int z=int(std::floor((p.z-radius)/C));z<=int(std::floor((p.z+radius)/C))+1;++z)
        for(int y=int(std::floor((p.y-radius)/C))-1;y<=int(std::floor((p.y+radius)/C))+1;++y)
          for(int x=int(std::floor((p.x-radius)/C));x<=int(std::floor((p.x+radius)/C))+1;++x)
            needed[{origin.x/C+x,origin.y/C+y,origin.z/C+z}]=true;
    }
    for(auto [key,unused]:needed) {
      auto& resident=chunks[slot(key)];bool loaded=resident.key==key;
      auto it=terrainBodies.find(key);
      if(it!=terrainBodies.end()&&(!loaded||!resident.collision))continue;
      if(it!=terrainBodies.end()){if(b3Body_IsValid(it->second))b3DestroyBody(it->second);terrainBodies.erase(it);}
      TerrainChunk remote;
      if(!loaded)generate(remote,key);
      const auto& cells=loaded?resident.cells:remote.cells;
      if(loaded)resident.collision=false;
      if(std::none_of(cells.begin(),cells.end(),[](uint8_t m){return solid(m);})) {terrainBodies[key]={};continue;}
      auto def=b3DefaultBodyDef();def.position={float(key.x*C-origin.x),float(key.y*C-origin.y),float(key.z*C-origin.z)};
      auto id=b3CreateBody(world,&def);terrainBodies[key]=id;
      buildHulls(id,C,C,C,[&](int x,int y,int z){return solid(cells[x+C*(y+C*z)])?STONE:AIR;});
    }
    for(auto it=terrainBodies.begin();it!=terrainBodies.end();) {
      if(!needed.contains(it->first)){if(b3Body_IsValid(it->second))b3DestroyBody(it->second);it=terrainBodies.erase(it);}else ++it;
    }
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
    std::vector<Cell> seeds=std::move(edits);edits.clear();
    std::vector<int> touched;
    const Cell candidates[7]={{0,0,0},{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
    for(auto seed:seeds)for(auto n:candidates) {
      Cell first{seed.x+n.x,seed.y+n.y,seed.z+n.z};
      if(!inside(first.x,first.y,first.z)||!solid(get(first.x,first.y,first.z)))continue;
      int firstId=address(first.x,first.y,first.z);if(visited[firstId])continue;
      queue.clear();std::vector<Cell> stack{first};visited[firstId]=1;touched.push_back(firstId);bool anchored=false;
      while(!stack.empty()&&!anchored) {
        auto c=stack.back();stack.pop_back();queue.push_back(c);
        if(c.x==0||c.y==0||c.z==0||c.x==W-1||c.y==H-1||c.z==D-1){anchored=true;break;}
        for(auto d:neighbors) {
          Cell v{c.x+d.x,c.y+d.y,c.z+d.z};if(!solid(get(v.x,v.y,v.z)))continue;
          int i=address(v.x,v.y,v.z);if(visited[i]==2){anchored=true;break;}
          if(!visited[i]){visited[i]=1;touched.push_back(i);stack.push_back(v);}
        }
      }
      if(anchored) {
        for(auto c:queue)visited[address(c.x,c.y,c.z)]=2;
        for(auto c:stack)visited[address(c.x,c.y,c.z)]=2;
        continue;
      }
      Cell lo{W,H,D},hi{};
      for(auto c:queue){lo={std::min(lo.x,c.x),std::min(lo.y,c.y),std::min(lo.z,c.z)};hi={std::max(hi.x,c.x),std::max(hi.y,c.y),std::max(hi.z,c.z)};}
      for(int z=lo.z;z<=hi.z;z+=B)for(int y=lo.y;y<=hi.y;y+=B)for(int x=lo.x;x<=hi.x;x+=B) {
        std::vector<Cell> cells;std::vector<uint8_t> mats;
        for(auto c:queue)if(c.x>=x&&c.x<x+B&&c.y>=y&&c.y<y+B&&c.z>=z&&c.z<z+B){cells.push_back({c.x-x,c.y-y,c.z-z});mats.push_back(get(c.x,c.y,c.z));}
        if(cells.empty()||createBody(cells,mats,{float(x),float(y),float(z)})<0)continue;
        for(auto c:cells)set(x+c.x,y+c.y,z+c.z,AIR);
      }
    }
    for(int i:touched)visited[i]=0;
    edits.clear();rebuildTerrain();updateOccupied();
  }
  void updateOccupied() {
    for(int i:occupiedCells)occupied[i]=0;occupiedCells.clear();
    if(!sandCount&&!fluidCount())return;
    for(auto& b:bodies)if(b.active) {
      auto tr=b3Body_GetTransform(b.id);
      for(int y=0;y<b.size.y;++y)for(int z=0;z<b.size.z;++z)for(int x=0;x<b.size.x;++x)if(b.cells[localIndex(x,y,z)]) {
        auto p=add(tr.p,b3RotateVector(tr.q,{x+0.5f,y+0.5f,z+0.5f}));
        int a=int(std::floor(p.x)),d=int(std::floor(p.y)),c=int(std::floor(p.z));
        if(inside(a,d,c)){int i=address(a,d,c);if(!occupied[i]){occupied[i]=1;occupiedCells.push_back(i);}}
      }
    }
  }
  void stepSand() {
    const Cell diagonals[8]={{1,0,0},{0,0,1},{-1,0,0},{0,0,-1},{1,0,1},{-1,0,1},{-1,0,-1},{1,0,-1}};
    auto empty=[&](int x,int y,int z){return inside(x,y,z)&&(get(x,y,z)==AIR||get(x,y,z)==WATER||get(x,y,z)==ACID)&&!occupied[address(x,y,z)];};
    auto grains=std::move(sandCells);sandCells.clear();sandCells.reserve(grains.size());
    for(int i:grains)sandQueued[i]=0;
    // Bottom-up order prevents a falling grain from being simulated twice.
    std::sort(grains.begin(),grains.end(),[&](int a,int b){return decode(a).y<decode(b).y;});
    for(int i:grains) {
      if(!powder(raw(i))||sandQueued[i])continue;
      auto material=raw(i);
      auto c=decode(i);int x=c.x,y=c.y,z=c.z;bool moved=false;
      if(empty(x,y-1,z)){auto m=get(x,y-1,z);set(x,y,z,m);set(x,y-1,z,material);continue;}
      if(occupied[i]) {
        for(int up=1;up<8;++up)if(empty(x,y+up,z)){auto m=get(x,y+up,z);set(x,y,z,m);set(x,y+up,z,material);moved=true;break;}
      }else for(int k=0;k<8;++k) {
        auto d=diagonals[(k+tick/2+x+z)%8];
        if(empty(x+d.x,y,z+d.z)&&empty(x+d.x,y-1,z+d.z)){auto m=get(x+d.x,y-1,z+d.z);set(x,y,z,m);set(x+d.x,y-1,z+d.z,material);moved=true;break;}
      }
      if(!moved)queueSand(i);
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
    for(int step=0;step<768&&t<farT;++step) {
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
    auto dir=forward();Hit best=cast(camera,dir,{W,H,D},[&](Cell c){return get(c.x,c.y,c.z);},8/VOXEL);
    if(!best.found)best.distance=8/VOXEL;
    for(int i=0;i<MAX_BODIES;++i)if(bodies[i].active) {
      auto& b=bodies[i];auto tr=b3Body_GetTransform(b.id);
      auto o=b3InvRotateVector(tr.q,sub(camera,tr.p));auto d=b3InvRotateVector(tr.q,dir);
      auto h=cast(o,d,b.size,[&](Cell c){return b.cells[localIndex(c.x,c.y,c.z)];},best.distance);
      if(h.found){h.slot=i;h.normal=b3RotateVector(tr.q,h.normal);h.point=add(tr.p,b3RotateVector(tr.q,h.point));best=h;}
    }
    return best;
  }
  void mineBody(int slot,Cell center) {
    auto& b=bodies[slot];
    for(int y=0;y<b.size.y;++y)for(int z=0;z<b.size.z;++z)for(int x=0;x<b.size.x;++x) {
      if((x-center.x)*(x-center.x)+(y-center.y)*(y-center.y)+(z-center.z)*(z-center.z)>brush*brush)continue;
      auto& m=b.cells[localIndex(x,y,z)];if(m){m=AIR;++mined;}
    }
    rebuildBody(slot);
  }
  void rebuildBody(int slot) {
    auto& b=bodies[slot];auto tr=b3Body_GetTransform(b.id);auto angular=b3Body_GetAngularVelocity(b.id);
    auto velocity=b3Body_GetLinearVelocity(b.id);auto oldCenter=b3Body_GetWorldCenter(b.id);
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
  #include "material_simulation.inc"
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
      auto p=add(camera,mul(forward(),2.0f/VOXEL));
      std::vector<Cell> cells;std::vector<uint8_t> mats;
      for(int y=0;y<16;++y)for(int z=0;z<16;++z)for(int x=0;x<16;++x) {cells.push_back({x,y,z});mats.push_back(x==1&&z==1?COPPER:STONE);}
      createBody(cells,mats,sub(p,{8,8,8}),b3Quat_identity,mul(forward(),8/VOXEL),{1.0f,0.3f,0.7f});
      updateOccupied();
    } else {
      bool pouring=tool==1||tool>=5;
      if(tool>=5&&fluidCount()>200000){++limitHits;return;}
      auto p=target.found?add(target.point,mul(target.normal,pouring?brush+0.6f:0.15f)):add(camera,mul(forward(),4/VOXEL));
      int cx=int(std::floor(p.x)),cy=int(std::floor(p.y)),cz=int(std::floor(p.z));
      int r=pouring?int(brush):0;
      uint8_t m=tool==1?SAND:tool==2?STONE:tool==3?WOOD:tool==5?WATER:tool==6?ACID:tool==7?LAVA:FIRE;
      bool changed=false;
      for(int z=cz-r;z<=cz+r;++z)for(int y=cy-r;y<=cy+r;++y)for(int x=cx-r;x<=cx+r;++x) {
        if(y<1||!inside(x,y,z)||get(x,y,z)||occupied[address(x,y,z)])continue;
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
    if(length(move)>0)camera=add(camera,mul(unit(move),dt*(keys[6]?12:4.5f)/VOXEL));
    stream();
    if(!paused) {
      cooldown-=dt;
      if(held&&cooldown<=0){useTool();cooldown=tool==4?0.45f:0.12f;}
      rebuildTerrain();b3World_Step(world,dt,4);
      for(auto& b:bodies)if(b.active) {
        auto tr=b3Body_GetTransform(b.id);
        if(length(sub(tr.p,camera))>160/VOXEL) {
          savedBodies.push_back({b,origin,tr.p,b3Body_GetLinearVelocity(b.id),b3Body_GetAngularVelocity(b.id),tr.q});
          b3DestroyBody(b.id);b.active=false;
        }
      }
      updateOccupied();
      if(tick%2==0){stepSand();stepMaterials();}
      if(tick%6==0)erodeBodies();
      ++tick;
    }
    target=pick();stepMs=emscripten_get_now()-start;
  }
  void render(int width,int height) {
    if(!renderer.context)return;
    glUseProgram(renderer.program);glBindVertexArray(renderer.vao);glViewport(0,0,width,height);
    renderer.uploadWorld(*this);uploaded=renderer.uploaded;
    glActiveTexture(GL_TEXTURE2);glBindTexture(GL_TEXTURE_2D,renderer.textures[2]);
    float positions[MAX_BODIES*4]{},rotations[MAX_BODIES*4]{},sizes[MAX_BODIES*4]{};int count=0;
    for(int i=0;i<MAX_BODIES;++i)if(bodies[i].active) {
      auto& b=bodies[i];if(b.dirty){glTexSubImage2D(GL_TEXTURE_2D,0,0,i*B,B*B,B,GL_RED_INTEGER,GL_UNSIGNED_BYTE,b.cells.data());b.dirty=false;}
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
    glUniform1f(renderer.uniform("simTime"),tick/60.f);
    glUniform2f(renderer.uniform("resolution"),float(width),float(height));
    glUniform4f(renderer.uniform("target"),float(target.cell.x),float(target.cell.y),float(target.cell.z),target.found?1.f:0.f);
    glUniform1i(renderer.uniform("targetBody"),target.slot);
    glDrawArrays(GL_TRIANGLES,0,3);
  }
  float* snapshot() {
    int cells=0,awake=0;float minY=1000;
    for(auto& b:bodies)if(b.active){awake+=b3Body_IsAwake(b.id);minY=std::min(minY,b3Body_GetPosition(b.id).y);for(auto m:b.cells)cells+=m!=0;}
    stats[0]=float(tick);stats[1]=float(bodyCount());stats[2]=float(awake);stats[3]=float(mined);stats[4]=float(sandCount);
    stats[5]=float((origin.x+double(camera.x))*VOXEL);stats[6]=float((origin.y+double(camera.y))*VOXEL);stats[7]=float((origin.z+double(camera.z))*VOXEL);stats[8]=float(stepMs);stats[9]=float(target.material);
    stats[10]=float(detached);stats[11]=float(cells);stats[12]=float((origin.y+double(minY))*VOXEL);stats[13]=float(limitHits);
    stats[14]=yaw;stats[15]=pitch;stats[16]=target.found?target.distance*VOXEL:-1;
    stats[17]=VOXEL;stats[18]=float(shifts);stats[19]=float(generated);stats[20]=float(restored);stats[21]=float(saved.size());stats[22]=float(streamMs);stats[23]=float(uploaded);stats[24]=float(savedBodies.size());stats[25]=float(CN);stats[26]=float(pending.size());stats[27]=std::min({camera.x,float(W)-camera.x,camera.y,float(H)-camera.y,camera.z,float(D)-camera.z})*VOXEL;
    for(int m=WATER;m<=SMOKE;++m)stats[28+m-WATER]=float(materialCounts[m]);
    stats[35]=float(reactions);
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
EMSCRIPTEN_KEEPALIVE void demo_tool(int tool){if(demo)demo->tool=std::clamp(tool,0,8);}
EMSCRIPTEN_KEEPALIVE void demo_brush(float radius){if(demo)demo->brush=std::clamp(radius,0.5f,16.0f);}
EMSCRIPTEN_KEEPALIVE void demo_pause(int paused){if(demo)demo->paused=paused!=0;}
EMSCRIPTEN_KEEPALIVE float* demo_stats(){return demo?demo->snapshot():nullptr;}
// The deterministic scenario hooks exercise the same editing and stepping paths as input.
EMSCRIPTEN_KEEPALIVE void demo_camera(double x,double y,double z,float yaw,float pitch){if(demo)demo->moveCamera(x,y,z,yaw,pitch);}
EMSCRIPTEN_KEEPALIVE int demo_material_count(int m){return demo&&m>=0&&m<MATERIAL_COUNT?demo->materialCounts[m]:0;}
EMSCRIPTEN_KEEPALIVE void demo_edit(double x,double y,double z,int m){if(demo&&m>=0&&m<MATERIAL_COUNT){demo->set(int(std::floor(x/VOXEL)-demo->origin.x),int(std::floor(y/VOXEL)-demo->origin.y),int(std::floor(z/VOXEL)-demo->origin.z),uint8_t(m));}}
EMSCRIPTEN_KEEPALIVE void demo_use(){if(demo)demo->useTool();}
EMSCRIPTEN_KEEPALIVE int demo_cell(double x,double y,double z){return demo?demo->get(int(std::floor(x/VOXEL)-demo->origin.x),int(std::floor(y/VOXEL)-demo->origin.y),int(std::floor(z/VOXEL)-demo->origin.z)):0;}
EMSCRIPTEN_KEEPALIVE int demo_render_cell(double x,double y,double z,int level){
  if(!demo)return 0;
  if(level==0)return demo_cell(x,y,z);
  return demo->renderer.clipmap(std::clamp(level,1,3)).sample(int64_t(std::floor(x/VOXEL)),int64_t(std::floor(y/VOXEL)),int64_t(std::floor(z/VOXEL)));
}
}
