#pragma once

// Every level stores material voxels. Only the spatial sampling interval changes.
struct VoxelClipmap {
  static constexpr int SIDE=384, AXIS=SIDE/C, COUNT=AXIS*AXIS*AXIS;
  struct Chunk {
    std::array<uint8_t,CELLS> cells{};
    ChunkKey key{};
    bool valid=false,upload=false;
  };
  int scale;
  ChunkKey origin{}; // In full-resolution voxel coordinates.
  bool ready=false,preparing=false;
  std::vector<Chunk> chunks;
  std::unordered_map<ChunkKey,Chunk,KeyHash> prepared;
  std::vector<ChunkKey> pending;
  ChunkKey nextOrigin{};
  explicit VoxelClipmap(int s):scale(s){}
  static int wrap(int64_t n){int a=int(n%AXIS);return a<0?a+AXIS:a;}
  static int slot(ChunkKey k){return wrap(k.x)+AXIS*(wrap(k.y)+AXIS*wrap(k.z));}
  bool contains(ChunkKey k) const {
    int64_t x=k.x*C*scale-origin.x,y=k.y*C*scale-origin.y,z=k.z*C*scale-origin.z;
    return ready&&x>=0&&y>=0&&z>=0&&x<SIDE*scale&&y<SIDE*scale&&z<SIDE*scale;
  }
  void invalidate(){ready=false;preparing=false;pending.clear();prepared.clear();}
  void generate(Chunk& c,ChunkKey key,VoxelWorld& world) {
    c.key=key;c.valid=true;c.upload=true;
    world.generateSamples(c.cells,key,scale);
    // Edited chunks override procedural samples, including empty cells. Each
    // column contributes its top occupied material, preserving surface layers
    // and isolated grains before choosing the most frequent visible material.
    std::array<uint8_t,CELLS> unpacked;
    for(int z=0;z<scale;++z)for(int y=0;y<scale;++y)for(int x=0;x<scale;++x) {
      ChunkKey fine{key.x*scale+x,key.y*scale+y,key.z*scale+z};
      const auto& resident=world.chunks[VoxelWorld::slot(fine)];
      const uint8_t* source=nullptr;
      if(resident.valid&&resident.key==fine) {
        if(!resident.modified)continue;
        source=resident.cells.data();
      }else {
        auto it=world.saved.find(fine);if(it==world.saved.end())continue;
        int at=0;for(size_t j=0;j<it->second.size();j+=3){int n=it->second[j]+256*it->second[j+1];std::fill_n(unpacked.begin()+at,n,it->second[j+2]);at+=n;}
        source=unpacked.data();
      }
      int side=C/scale;std::array<uint8_t,256> counts{};
      for(int k=0;k<side;++k)for(int j=0;j<side;++j)for(int i=0;i<side;++i) {
        uint8_t material=0,best=0;
        for(int dz=0;dz<scale;++dz)for(int dx=0;dx<scale;++dx)for(int dy=scale-1;dy>=0;--dy) {
          uint8_t m=source[i*scale+dx+C*(j*scale+dy+C*(k*scale+dz))];
          if(!m)continue;
          if(++counts[m]>best||(counts[m]==best&&m<material)){best=counts[m];material=m;}
          break;
        }
        c.cells[x*side+i+C*(y*side+j+C*(z*side+k))]=material;
        counts.fill(0);
      }
    }
  }
  void update(VoxelWorld& world,double budget) {
    if(chunks.empty())chunks.resize(COUNT);
    ChunkKey center{world.origin.x+W/2,world.origin.y+H/2,world.origin.z+D/2};
    ChunkKey desired{(floorDiv(center.x,C*scale)-AXIS/2)*C*scale,
                     (floorDiv(center.y,C*scale)-AXIS/2)*C*scale,
                     (floorDiv(center.z,C*scale)-AXIS/2)*C*scale};
    bool teleport=!ready||std::abs(desired.x-origin.x)>C*scale*2||std::abs(desired.y-origin.y)>C*scale*2||std::abs(desired.z-origin.z)>C*scale*2;
    if(teleport){preparing=false;prepared.clear();pending.clear();}
    if(!preparing&&(!ready||!(origin==desired))) {
      nextOrigin=desired;preparing=true;
      for(int z=0;z<AXIS;++z)for(int y=0;y<AXIS;++y)for(int x=0;x<AXIS;++x) {
        ChunkKey key{desired.x/(C*scale)+x,desired.y/(C*scale)+y,desired.z/(C*scale)+z};
        const auto& c=chunks[slot(key)];if(!ready||!c.valid||!(c.key==key))pending.push_back(key);
      }
    }
    double end=emscripten_get_now()+budget;
    while(!pending.empty()) {
      auto key=pending.back();pending.pop_back();generate(prepared[key],key,world);
      if(!teleport&&emscripten_get_now()>=end)break;
    }
    if(preparing&&pending.empty()) {
      for(auto& [key,c]:prepared)chunks[slot(key)]=std::move(c);
      prepared.clear();origin=nextOrigin;ready=true;preparing=false;
    }
    std::unordered_set<ChunkKey,KeyHash> dirty;
    for(auto key:world.renderChanges)dirty.insert({floorDiv(key.x,scale),floorDiv(key.y,scale),floorDiv(key.z,scale)});
    for(auto key:dirty) {
      if(contains(key))generate(chunks[slot(key)],key,world);
      auto it=prepared.find(key);if(it!=prepared.end())generate(it->second,key,world);
    }
  }
  uint8_t sample(int64_t x,int64_t y,int64_t z) const {
    ChunkKey key{floorDiv(x,C*scale),floorDiv(y,C*scale),floorDiv(z,C*scale)};
    if(!contains(key))return AIR;
    int i=int(floorDiv(x,scale)-key.x*C),j=int(floorDiv(y,scale)-key.y*C),k=int(floorDiv(z,scale)-key.z*C);
    return chunks[slot(key)].cells[i+C*(j+C*k)];
  }
};
