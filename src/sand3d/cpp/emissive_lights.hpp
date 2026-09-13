#pragma once

// Exposed hot cells share one source per 16-cell region. Sources retain absolute
// coordinates so the streaming ring can move without dragging the illumination.
struct EmissiveLights {
  static constexpr int LIMIT=24;
  struct Source {double x,y,z;float area,fire;};
  struct ChunkSources {int level;std::vector<Source> sources;};
  std::unordered_map<int,ChunkSources> chunks;
  std::array<float,LIMIT*4> positions{},colors{};
  int count=0;

  template<class Chunk> void update(const Chunk& chunk,int slot,int level) {
    const int id=level*65536+slot,scale=1<<level;
    if constexpr(requires{chunk.counts;}) {
      if(!chunk.counts[LAVA]&&!chunk.counts[FIRE]){chunks.erase(id);return;}
    }
    if constexpr(requires{chunk.emissive;}) {
      if(!chunk.emissive){chunks.erase(id);return;}
    }
    struct Face {float x,y,z,fire;int bin;};
    struct Bin {float x=0,y=0,z=0,fire=0;int count=0;};
    std::array<Bin,8> bins{};std::vector<Face> faces;
    constexpr Cell sides[]={{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
    for(int z=0;z<C;++z)for(int y=0;y<C;++y)for(int x=0;x<C;++x) {
      const auto m=chunk.cells[x+C*(y+C*z)];if(m!=LAVA&&m!=FIRE)continue;
      const int bin=x/16+2*(y/16+2*(z/16));
      for(auto side:sides) {
        int nx=x+side.x,ny=y+side.y,nz=z+side.z;
        if(nx>=0&&ny>=0&&nz>=0&&nx<C&&ny<C&&nz<C) {
          auto neighbor=chunk.cells[nx+C*(ny+C*nz)];
          if(neighbor!=AIR&&neighbor!=STEAM&&neighbor!=SMOKE)continue;
        }
        Face f{x+.5f+side.x*.55f,y+.5f+side.y*.55f,z+.5f+side.z*.55f,m==FIRE?1.f:0.f,bin};
        faces.push_back(f);auto& b=bins[bin];b.x+=f.x;b.y+=f.y;b.z+=f.z;b.fire+=f.fire;++b.count;
      }
    }
    if(faces.empty()){chunks.erase(id);return;}
    std::array<float,8> distances;distances.fill(INFINITY);
    std::array<Face,8> representatives{};
    for(auto f:faces) {
      const auto& b=bins[f.bin];float dx=f.x-b.x/b.count,dy=f.y-b.y/b.count,dz=f.z-b.z/b.count;
      float distance=dx*dx+dy*dy+dz*dz;
      if(distance<distances[f.bin]){distances[f.bin]=distance;representatives[f.bin]=f;}
    }
    auto& output=chunks[id];output.level=level;output.sources.clear();
    for(int i=0;i<8;++i)if(bins[i].count) {
      auto f=representatives[i];const auto& b=bins[i];
      output.sources.push_back({(double(chunk.key.x)*C+f.x)*scale,(double(chunk.key.y)*C+f.y)*scale,
        (double(chunk.key.z)*C+f.z)*scale,float(b.count*scale*scale),b.fire/b.count});
    }
  }

  template<class Bounds> void select(ChunkKey origin,float eyeX,float eyeY,float eyeZ,Bounds bounds) {
    struct Candidate {const Source* source;float score;};
    std::vector<Candidate> candidates;
    for(auto& [key,chunk]:chunks)for(const auto& source:chunk.sources) {
      bool covered=false;
      for(int level=0;level<chunk.level;++level)if(bounds(level,source.x,source.y,source.z)){covered=true;break;}
      if(covered||!bounds(chunk.level,source.x,source.y,source.z))continue;
      float dx=float(source.x-origin.x)-eyeX,dy=float(source.y-origin.y)-eyeY,dz=float(source.z-origin.z)-eyeZ;
      float distance=dx*dx+dy*dy+dz*dz;
      if(distance>2048.f*2048.f)continue;
      candidates.push_back({&source,std::min(source.area,1024.f)/(256.f+distance)});
    }
    count=std::min(int(candidates.size()),LIMIT);
    std::partial_sort(candidates.begin(),candidates.begin()+count,candidates.end(),[](const Candidate& a,const Candidate& b){
      if(a.score!=b.score)return a.score>b.score;
      const auto& x=*a.source;const auto& y=*b.source;
      return x.x!=y.x?x.x<y.x:x.y!=y.y?x.y<y.y:x.z<y.z;
    });
    for(int i=0;i<count;++i) {
      const auto& s=*candidates[i].source;
      positions[i*4]=float(s.x-origin.x);positions[i*4+1]=float(s.y-origin.y);positions[i*4+2]=float(s.z-origin.z);
      positions[i*4+3]=std::clamp(std::sqrt(s.area)*3.f,24.f,128.f);
      colors[i*4]=1.f;colors[i*4+1]=.28f+s.fire*.16f;colors[i*4+2]=.025f+s.fire*.025f;
      colors[i*4+3]=std::clamp(std::sqrt(s.area)*.11f,.12f,2.2f);
    }
  }
};
