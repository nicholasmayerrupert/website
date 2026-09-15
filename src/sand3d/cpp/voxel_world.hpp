#pragma once
#include <array>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <cstdint>
#include <cmath>
#include <algorithm>

namespace {
constexpr float VOXEL=0.0625f;
constexpr int W=768,H=256,D=768,C=32,CW=W/C,CH=H/C,CD=D/C,CN=CW*CH*CD,CELLS=C*C*C;
constexpr int N=W*H*D,B=64,BN=B*B*B,MAX_BODIES=256;
enum Material : uint8_t { AIR, SAND, BEDROCK, STONE, WOOD, GRASS, COPPER, LEAVES, WATER, ACID, LAVA, STEAM, FIRE, STONE_DUST, SMOKE, MATERIAL_COUNT };
struct Cell { int x,y,z; };
struct ChunkKey {
  int64_t x,y,z;
  bool operator==(const ChunkKey&) const = default;
};
struct KeyHash {
  size_t operator()(ChunkKey k) const {
    auto mix=[](uint64_t x){x^=x>>30;x*=0xbf58476d1ce4e5b9ULL;x^=x>>27;x*=0x94d049bb133111ebULL;return x^(x>>31);};
    return mix(uint64_t(k.x)) ^ (mix(uint64_t(k.y))<<1) ^ (mix(uint64_t(k.z))<<2);
  }
};
int64_t floorDiv(int64_t a,int b) { return a>=0?a/b:-1-(-1-a)/b; }
int wrapIndex(int64_t a,int n){int r=int(a%n);return r<0?r+n:r;}
bool inside(int x,int y,int z) { return x>=0&&x<W&&y>=0&&y<H&&z>=0&&z<D; }
bool solid(uint8_t m) { return m>=BEDROCK&&m<=LEAVES; }
bool powder(uint8_t m){return m==SAND||m==STONE_DUST;}
bool liquid(uint8_t m){return m==WATER||m==ACID||m==LAVA;}
bool gas(uint8_t m){return m==STEAM||m==FIRE||m==SMOKE;}
bool flowing(uint8_t m){return liquid(m)||gas(m);}
constexpr int LIQUID_REACH=8;
constexpr Cell liquidSides[8]={{1,0,0},{0,0,1},{-1,0,0},{0,0,-1},{1,0,1},{-1,0,1},{-1,0,-1},{1,0,-1}};
int liquidReach(uint8_t m){return m==LAVA?2:LIQUID_REACH;}
bool flammable(uint8_t m){return m==WOOD||m==LEAVES||m==GRASS;}
bool dissolvable(uint8_t m){return (solid(m)&&m!=BEDROCK)||powder(m);}
float density(uint8_t m){return m==LAVA?2.8f:m==ACID?1.1f:m==WOOD||m==LEAVES?.55f:m==SAND?1.6f:m==STONE_DUST?1.8f:solid(m)?2.4f:m==WATER?1.f:0.f;}
int localIndex(int x,int y,int z) { return x+B*(z+B*y); }

// World coordinates seed coherent terrain; loaded chunks never affect generation.
float noise(double x,double z) {
  int64_t ix=int64_t(std::floor(x)),iz=int64_t(std::floor(z));
  float fx=float(x-ix),fz=float(z-iz);fx=fx*fx*(3-2*fx);fz=fz*fz*(3-2*fz);
  auto h=[](int64_t a,int64_t b){uint32_t n=uint32_t(a)*0x8da6b343u ^ uint32_t(b)*0xd8163841u;n^=n>>16;n*=0x7feb352du;n^=n>>15;n*=0x846ca68bu;n^=n>>16;return float(n&65535)/32767.5f-1;};
  return std::lerp(std::lerp(h(ix,iz),h(ix+1,iz),fx),std::lerp(h(ix,iz+1),h(ix+1,iz+1),fx),fz);
}
float surface(double x,double z) {
  float height=0.8f+3.0f*noise(x/36,z/36)+1.1f*noise(x/11,z/11)+0.22f*noise(x/3,z/3);
  float blend=std::clamp(float((std::max(std::abs(x),std::abs(z))-7)/7),0.f,1.f);
  return std::lerp(0.f,height,blend*blend*(3-2*blend));
}
struct TreeDescription {double x=0,y=0,z=0;bool present=false;};
TreeDescription treeAt(int64_t tx,int64_t tz) {
  double x=double(tx)*8,z=double(tz)*8;
  auto seed=KeyHash{}({tx*8,0,tz*8});
  if((std::abs(x)<=7&&std::abs(z)<=7)||(seed&3)!=0)return {};
  x+=double(seed>>8&15)*0.125-1;z+=double(seed>>16&15)*0.125-1;
  return {x,surface(x,z),z,true};
}
struct Column {
  double x,z;
  float top,cave,phase;
  TreeDescription tree;
};
Column columnAt(double x,double z) {
  return {x,z,surface(x,z),noise(x/9,z/9),noise(x/16,z/16)*3,treeAt(int64_t(std::floor((x+4)/8)),int64_t(std::floor((z+4)/8)))};
}
template<int Count,int Bits> struct PackedCells {
  std::array<uint8_t,(Count*Bits+7)/8> bytes{};
  struct Ref {
    uint8_t& byte;int shift;
    operator uint8_t() const {return (byte>>shift)&((1<<Bits)-1);}
    Ref& operator=(uint8_t v){byte=uint8_t((byte&~(((1<<Bits)-1)<<shift))|(v<<shift));return *this;}
  };
  Ref operator[](int i){return {bytes[i/(8/Bits)],i%(8/Bits)*Bits};}
  uint8_t operator[](int i) const {return (bytes[i/(8/Bits)]>>(i%(8/Bits)*Bits))&((1<<Bits)-1);}
  void fill(uint8_t){bytes.fill(0);}
};
struct TerrainChunk {
  std::array<uint8_t,CELLS> cells{};
  ChunkKey key{};
  bool valid=false,modified=false,upload=true,collision=true;
  int sand=0,solids=0;
  std::array<int,MATERIAL_COUNT> counts{};
};
struct VoxelWorld {
  struct CachedColumn {int64_t x=INT64_MAX,z=INT64_MAX;Column data{};};
  std::vector<CachedColumn> columns=std::vector<CachedColumn>(W*D);
  std::array<TerrainChunk,CN> chunks{};
  std::unordered_map<ChunkKey,std::vector<uint8_t>,KeyHash> saved;
  std::unordered_set<ChunkKey,KeyHash> renderChanges;
  ChunkKey origin{-W/2,-H/2,-D/2}; // Absolute voxel coordinate of the loaded window.
  Cell ringOrigin{};
  int sandCount=0,generated=0,restored=0,shifts=0;
  std::vector<int> sandCells;
  std::vector<int> fluidCells;
  PackedCells<N,1> fluidQueued{};
  std::array<int,MATERIAL_COUNT> materialCounts{};
  PackedCells<N,1> sandQueued{};
  std::vector<Cell> edits;
  std::unordered_map<int,uint8_t> editOriginals;
  std::unordered_set<int> supportFrontier;
  bool generating=false;
  std::unordered_map<ChunkKey,TerrainChunk,KeyHash> prepared;
  std::vector<ChunkKey> pending;
  ChunkKey pendingOrigin{};
  bool preparing=false;
  static int slot(ChunkKey k) {return wrapIndex(k.x,CW)+CW*(wrapIndex(k.y,CH)+CH*wrapIndex(k.z,CD));}
  int address(int x,int y,int z) const {
    int a=ringOrigin.x+x,b=ringOrigin.y+y,c=ringOrigin.z+z;
    if(a>=W)a-=W;if(b>=H)b-=H;if(c>=D)c-=D;
    return (a&(C-1))+C*((b&(C-1))+C*(c&(C-1)))+CELLS*(a/C+CW*(b/C+CH*(c/C)));
  }
  Cell decode(int i) const {
    int s=i/CELLS,p=i%CELLS;
    const auto& k=chunks[s].key;
    return {int(k.x*C-origin.x)+p%C,int(k.y*C-origin.y)+(p/C)%C,int(k.z*C-origin.z)+p/(C*C)};
  }
  uint8_t raw(int i) const {return chunks[i/CELLS].cells[i%CELLS];}
  uint8_t get(int x,int y,int z) const {return inside(x,y,z)?raw(address(x,y,z)):uint8_t(AIR);}
  void queueSand(int i) {if(!sandQueued[i]){sandQueued[i]=1;sandCells.push_back(i);}}
  void queueFluid(int i){if(!fluidQueued[i]){fluidQueued[i]=1;fluidCells.push_back(i);}}
  int fluidCount() const {return materialCounts[WATER]+materialCounts[ACID]+materialCounts[LAVA]+materialCounts[STEAM]+materialCounts[FIRE]+materialCounts[SMOKE];}
  bool removalKeepsConnected(int x,int y,int z) const {
    if(x==0||y==0||z==0||x==W-1||y==H-1||z==D-1)return false;
    uint32_t adjacent=0;
    constexpr int center=13;
    const Cell sides[6]={{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
    for(auto d:sides)if(solid(get(x+d.x,y+d.y,z+d.z)))adjacent|=1u<<(center+d.x+3*d.y+9*d.z);
    if((adjacent&(adjacent-1))==0)return true;
    uint32_t occupied=0;
    for(int k=0;k<3;++k)for(int j=0;j<3;++j)for(int i=0;i<3;++i)
      if((i!=1||j!=1||k!=1)&&solid(get(x+i-1,y+j-1,z+k-1)))occupied|=1u<<(i+3*j+9*k);
    static constexpr auto faces=[] {
      std::array<uint32_t,6> masks{};
      for(int k=0;k<3;++k)for(int j=0;j<3;++j)for(int i=0;i<3;++i) {
        uint32_t bit=1u<<(i+3*j+9*k);
        if(i==2)masks[0]|=bit;if(i==0)masks[1]|=bit;
        if(j==2)masks[2]|=bit;if(j==0)masks[3]|=bit;
        if(k==2)masks[4]|=bit;if(k==0)masks[5]|=bit;
      }
      return masks;
    }();
    uint32_t reached=adjacent&(~adjacent+1);
    for(int iteration=0;iteration<26;++iteration) {
      uint32_t expanded=reached|occupied&(((reached&~faces[0])<<1)|((reached&~faces[1])>>1)
        |((reached&~faces[2])<<3)|((reached&~faces[3])>>3)|((reached&~faces[4])<<9)|((reached&~faces[5])>>9));
      if((expanded&adjacent)==adjacent)return true;
      if(expanded==reached)return false;reached=expanded;
    }
    return false;
  }
  bool liquidNearOpening(int x,int y,int z) const {
    for(int cz=std::max(0,z-LIQUID_REACH)/C;cz<=std::min(D-1,z+LIQUID_REACH)/C;++cz)
      for(int cy=y/C;cy<=std::min(H-1,y+1)/C;++cy)
        for(int cx=std::max(0,x-LIQUID_REACH)/C;cx<=std::min(W-1,x+LIQUID_REACH)/C;++cx) {
          const auto& c=chunks[address(cx*C,cy*C,cz*C)/CELLS];
          if(c.counts[WATER]||c.counts[ACID]||c.counts[LAVA])return true;
        }
    return false;
  }
  void set(int x,int y,int z,uint8_t m) {
    if(!inside(x,y,z))return;
    int i=address(x,y,z);auto& c=chunks[i/CELLS];auto& v=c.cells[i%CELLS];if(v==m)return;
    renderChanges.insert(c.key);
    int ds=int(powder(m))-int(powder(v));sandCount+=ds;c.sand+=ds;c.solids+=int(solid(m))-int(solid(v));
    --materialCounts[v];++materialCounts[m];--c.counts[v];++c.counts[m];
    if(solid(v)||solid(m)) {
      c.collision=true;
      if(!generating) {
        // This proof runs before each removal, so a batch's final bridge cut
        // still requests global support validation even if earlier cuts did not.
        bool check=!solid(v)||(!solid(m)&&(supportFrontier.contains(i)||!removalKeepsConnected(x,y,z)));
        if(check) {
          edits.push_back({x,y,z});supportFrontier.erase(i);
          if(solid(m))supportFrontier.insert(i);
          for(auto n:std::array<Cell,6>{{{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}}}) {
            int a=x+n.x,b=y+n.y,d=z+n.z;
            if(inside(a,b,d)&&solid(get(a,b,d)))supportFrontier.insert(address(a,b,d));
          }
        }
        editOriginals.try_emplace(i,v);
      }
    }
    v=m;c.upload=true;c.modified=true;if(powder(m))queueSand(i);if(flowing(m))queueFluid(i);
    if(fluidCount())for(auto n:std::array<Cell,6>{{{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}}}) {
      int a=x+n.x,b=y+n.y,d=z+n.z;if(inside(a,b,d)&&flowing(get(a,b,d)))queueFluid(address(a,b,d));
    }
    // A new lower opening can drain a sleeping surface several cells away.
    if(m==AIR&&liquidNearOpening(x,y,z))for(int rise=0;rise<=1;++rise)for(auto side:liquidSides)for(int reach=1;reach<=LIQUID_REACH;++reach) {
      int a=x+side.x*reach,b=y+rise,d=z+side.z*reach;if(!inside(a,b,d))break;
      auto source=get(a,b,d);if(source==AIR)continue;
      if(liquid(source)&&reach<=liquidReach(source))queueFluid(address(a,b,d));
      break;
    }
  }
  static uint8_t generatedCell(int64_t x,int64_t y,int64_t z,const Column& column) {
    double px=column.x,py=(y+0.5)*VOXEL,pz=column.z;float top=column.top;
    // Three resistant trays make the material interactions accessible at spawn.
    if(pz>=-7&&pz<-5&&py>=-1.25&&py<0.25)for(int tray=0;tray<3;++tray) {
      double center=(tray-1)*4.5;
      if(px<center-1||px>=center+1)continue;
      if(px<center-0.75||px>=center+0.75||pz<-6.75||pz>=-5.25||py<-1)return BEDROCK;
      return py<-0.25?uint8_t(WATER+tray):uint8_t(AIR);
    }
    if(py<top) {
      // Continuous underground caverns, evaluated in world space.
      if(py<top-2.5 && py>-40 && std::abs(column.cave+float(py)*0.018f)<0.13f &&
         std::sin(py*0.7+column.phase)>0.45)return AIR;
      if(py>top-VOXEL*1.5)return GRASS;
      return ((x/3+y/2+z/5)&63)==0?COPPER:STONE;
    }
    // The starter quarry is stamped into the continuous terrain at the origin.
    if(px>=-2&&px<2&&pz>=-1&&pz<-0.5) {
      if(py>=0&&py<3&&(px<-1.5||px>=1.5))return WOOD;
      if(py>=3&&py<3.5)return STONE;
      if(py>=3.5&&py<3.75&&std::abs(px)<1.5)return COPPER;
    }
    if(px>=3&&px<4.5&&pz>=-3&&pz<-1.5&&py<1.5)return py>0.5&&py<0.875?COPPER:STONE;
    if(px>=-5&&px<-2&&pz>=1&&pz<4&&py<std::max(0.0,1.25-std::hypot(px+3.5,pz-2.5)))return SAND;
    // Sparse rooted trees use one deterministic owner per eight-metre tile.
    if(column.tree.present) {
      auto tree=column.tree;double dx=px-tree.x,dz=pz-tree.z,dy=py-tree.y;
      if(std::abs(dx)<0.1875&&std::abs(dz)<0.1875&&dy<3.2)return WOOD;
      if(dx*dx+dz*dz+(dy-3.1)*(dy-3.1)<1.45)return LEAVES;
    }
    return AIR;
  }
  int storedCell(int64_t x,int64_t y,int64_t z) const {
    ChunkKey key{floorDiv(x,C),floorDiv(y,C),floorDiv(z,C)};
    int i=(int(x)&(C-1))+C*((int(y)&(C-1))+C*(int(z)&(C-1)));
    const auto& c=chunks[slot(key)];if(c.key==key&&c.valid)return c.cells[i];
    auto it=saved.find(key);if(it==saved.end())return -1;
    const auto& data=it->second;int at=0;
    for(size_t j=0;j<data.size();j+=3){at+=data[j]+256*data[j+1];if(i<at)return data[j+2];}
    return -1;
  }
  static std::vector<uint8_t> pack(const std::array<uint8_t,CELLS>& data) {
    std::vector<uint8_t> out;
    for(int i=0;i<CELLS;){int end=i+1;while(end<CELLS&&data[end]==data[i])++end;int n=end-i;out.push_back(uint8_t(n));out.push_back(uint8_t(n>>8));out.push_back(data[i]);i=end;}
    return out;
  }
  void generateSamples(std::array<uint8_t,CELLS>& cells,ChunkKey key,int scale) {
    cells.fill(0);
    for(int z=0;z<C;++z)for(int x=0;x<C;++x) {
      int64_t wx=(key.x*C+x)*scale+scale/2,wz=(key.z*C+z)*scale+scale/2;
      Column column;
      if(scale==1) {
        auto& cached=columns[wrapIndex(wx,W)+W*wrapIndex(wz,D)];
        if(cached.x!=wx||cached.z!=wz){cached.x=wx;cached.z=wz;cached.data=columnAt((wx+0.5)*VOXEL,(wz+0.5)*VOXEL);}
        column=cached.data;
      }else column=columnAt((wx+0.5)*VOXEL,(wz+0.5)*VOXEL);
      double highest=std::max(double(column.top),3.75);
      if(column.tree.present)highest=std::max(highest,column.tree.y+4.4);
      if(key.y*C*scale*VOXEL>highest)continue;
      for(int y=0;y<C;++y)for(int dy=scale-1;dy>=0;--dy) {
        auto m=generatedCell(wx,(key.y*C+y)*scale+dy,wz,column);
        if(m){cells[x+C*(y+C*z)]=m;break;}
      }
    }
  }
  void generate(TerrainChunk& c,ChunkKey key) {
    c=TerrainChunk{};c.key=key;c.valid=true;
    auto it=saved.find(key);
    if(it!=saved.end()) {
      int at=0;const auto& data=it->second;
      for(size_t j=0;j<data.size();j+=3){int count=data[j]+256*data[j+1];std::fill_n(c.cells.begin()+at,count,data[j+2]);at+=count;}
      c.modified=true;
    } else generateSamples(c.cells,key,1);
    // Count materials while preparing the chunk, inside the streaming budget.
    // Publishing a terrain-only chunk then needs no full voxel scan.
    for(auto m:c.cells)++c.counts[m];
    for(int m=0;m<MATERIAL_COUNT;++m){if(solid(m))c.solids+=c.counts[m];if(powder(m))c.sand+=c.counts[m];}
  }
  bool prepareWindow(ChunkKey next,double budget) {
    if(!preparing) {
      pendingOrigin=next;preparing=true;
      for(int z=0;z<CD;++z)for(int y=0;y<CH;++y)for(int x=0;x<CW;++x) {
        ChunkKey k{next.x/C+x,next.y/C+y,next.z/C+z};
        if(!(chunks[slot(k)].key==k))pending.push_back(k);
      }
    }
    double deadline=emscripten_get_now()+budget;
    while(!pending.empty()) {
      auto key=pending.back();pending.pop_back();generate(prepared[key],key);
      if(emscripten_get_now()>=deadline)break;
    }
    return pending.empty();
  }
  void load(ChunkKey key) {
    int s=slot(key);auto& c=chunks[s];
    if(c.valid&&c.key==key)return;
    if(c.valid&&c.modified)saved[c.key]=pack(c.cells);
    sandCount-=c.sand;
    for(int m=0;m<MATERIAL_COUNT;++m)materialCounts[m]-=c.counts[m];
    c=TerrainChunk{};c.key=key;c.valid=true;
    auto ready=prepared.find(key);
    if(ready!=prepared.end()){c=std::move(ready->second);prepared.erase(ready);}
    else {generate(c,key);}
    if(saved.contains(key))++restored;else ++generated;
    bool active=c.sand>0;
    for(int m=WATER;m<MATERIAL_COUNT;++m)if(flowing(m)&&c.counts[m])active=true;
    if(active)for(int i=0;i<CELLS;++i){auto m=c.cells[i];if(powder(m))queueSand(s*CELLS+i);if(flowing(m))queueFluid(s*CELLS+i);}
    for(int m=0;m<MATERIAL_COUNT;++m)materialCounts[m]+=c.counts[m];
    sandCount+=c.sand;
  }
  void fillWindow() {
    ringOrigin={wrapIndex(origin.x,W),wrapIndex(origin.y,H),wrapIndex(origin.z,D)};
    for(int z=0;z<CD;++z)for(int y=0;y<CH;++y)for(int x=0;x<CW;++x)load({origin.x/C+x,origin.y/C+y,origin.z/C+z});
  }
  void resetVoxels() {
    saved.clear();prepared.clear();pending.clear();preparing=false;for(auto& c:chunks)c=TerrainChunk{};
    sandCells.clear();sandQueued.fill(0);fluidCells.clear();fluidQueued.fill(0);materialCounts.fill(0);sandCount=0;generated=restored=shifts=0;edits.clear();editOriginals.clear();supportFrontier.clear();renderChanges.clear();
    origin={-W/2,-H/2+int(4/VOXEL),-D/2+int(8/VOXEL)};fillWindow();
  }
};
}
