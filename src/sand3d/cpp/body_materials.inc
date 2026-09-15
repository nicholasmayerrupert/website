  struct LooseMotion { b3Vec3 velocity{},remainder{};float fall=0; };
  // Raster snapshots copy contiguous entries; no allocation per occupied voxel.
  struct BodyCellMap {
    std::vector<std::pair<int,int>> entries;
    std::vector<int> table;
    size_t bucket(int key) const {
      uint32_t h=uint32_t(key);h^=h>>16;h*=0x7feb352d;h^=h>>15;
      size_t i=h&(table.size()-1);
      while(table[i]&&entries[table[i]-1].first!=key)i=(i+1)&(table.size()-1);
      return i;
    }
    bool contains(int key) const {return !table.empty()&&table[bucket(key)];}
    int at(int key) const {return entries[table[bucket(key)]-1].second;}
    void reserve(size_t count) {
      entries.reserve(count);size_t capacity=64;while(capacity<=count*2)capacity*=2;
      if(table.empty())table.resize(capacity);
    }
    void try_emplace(int key,int value) {
      if((entries.size()+1)*2>=table.size()) {
        table.assign(std::max(size_t(64),table.size()*2),0);
        for(size_t i=0;i<entries.size();++i)table[bucket(entries[i].first)]=int(i)+1;
      }
      auto index=bucket(key);if(table[index])return;
      entries.push_back({key,value});table[index]=int(entries.size());
    }
    void clear(){entries.clear();table.clear();}
    auto begin() const{return entries.begin();}auto end() const{return entries.end();}
  };
  BodyCellMap owners,barriers;
  using FlowMasks=std::array<std::vector<uint8_t>,CN>;
  FlowMasks edgeMasks;
  std::vector<int> edgeChunks;
  std::unordered_map<int,LooseMotion> motion;
  int displacedCells=0,blockedMoves=0;
  float couplingMs[5]{};
  static constexpr float GRAVITY=9.81f/VOXEL;
  void buildFlowFaces(Body& b) {
    for(int a=0;a<3;++a)for(int sign: {-1,1}) {
      int u=a==0?1:0,v=a==2?1:2;
      int size[3]={b.size.x,b.size.y,b.size.z},su=size[u],sv=size[v];
      std::vector<uint8_t> mask((size[a]+1)*su*sv);
      for(auto [p,n]:b.faces)if(axis(n,a)==sign)
        mask[int(axis(p,u))+su*(int(axis(p,v))+sv*int(axis(p,a)))]=1;
      for(int plane=0;plane<=size[a];++plane)for(int y=0;y<sv;++y)for(int x=0;x<su;++x) {
        auto cell=[&](int i,int j)->uint8_t&{return mask[i+su*(j+sv*plane)];};
        if(!cell(x,y))continue;int ex=x+1,ey=y+1;
        while(ex<su&&cell(ex,y))++ex;
        while(ey<sv) {bool full=true;for(int i=x;i<ex;++i)if(!cell(i,ey)){full=false;break;}if(!full)break;++ey;}
        for(int j=y;j<ey;++j)for(int i=x;i<ex;++i)cell(i,j)=0;
        float p[3]{},n[3]{};p[a]=plane;p[u]=(x+ex)*.5f;p[v]=(y+ey)*.5f;n[a]=sign;
        b.flowFaces.push_back({{p[0],p[1],p[2]},{n[0],n[1],n[2]},(ex-x)*.5f,(ey-y)*.5f});
      }
    }
  }
  void buildBodySpaces(Body& b) {
    auto index=[&](Cell c){return c.x+b.size.x*(c.y+b.size.y*c.z);};
    b.spaces.assign(b.size.x*b.size.y*b.size.z,UINT16_MAX);
    std::vector<Cell> air;
    for(int z=0;z<b.size.z;++z)for(int y=0;y<b.size.y;++y)for(int x=0;x<b.size.x;++x) {
      if(b.cells[localIndex(x,y,z)])continue;Cell c{x,y,z};b.spaces[index(c)]=UINT16_MAX-1;
      if(x==0||y==0||z==0||x==b.size.x-1||y==b.size.y-1||z==b.size.z-1){b.spaces[index(c)]=0;air.push_back(c);}
    }
    auto flood=[&](uint16_t region) {
      for(size_t k=0;k<air.size();++k)for(auto n:neighbors) {
        Cell p{air[k].x+n.x,air[k].y+n.y,air[k].z+n.z};
        if(p.x<0||p.y<0||p.z<0||p.x>=b.size.x||p.y>=b.size.y||p.z>=b.size.z)continue;
        auto& cell=b.spaces[index(p)];if(cell==UINT16_MAX-1){cell=region;air.push_back(p);}
      }
    };
    flood(0);uint16_t region=0;
    for(int z=0;z<b.size.z;++z)for(int y=0;y<b.size.y;++y)for(int x=0;x<b.size.x;++x) {
      Cell c{x,y,z};if(b.spaces[index(c)]!=UINT16_MAX-1)continue;
      b.spaces[index(c)]=++region;air={c};flood(region);
    }
    b.hasCavity=region!=0;
  }
  uint16_t bodySpace(const Body& b,b3Transform pose,Cell c) const {
    auto p=b3InvTransformPoint(pose,{c.x+.5f,c.y+.5f,c.z+.5f});
    int x=int(std::floor(p.x)),y=int(std::floor(p.y)),z=int(std::floor(p.z));
    if(x<0||y<0||z<0||x>=b.size.x||y>=b.size.y||z>=b.size.z)return 0;
    return b.spaces[x+b.size.x*(y+b.size.y*z)];
  }
  int edgeKey(Cell a,Cell b) const {
    int axis=a.x!=b.x?0:a.y!=b.y?1:2;
    return address(std::min(a.x,b.x),std::min(a.y,b.y),std::min(a.z,b.z))*3+axis;
  }
  int contactBody(Cell from,Cell to) const {
    if(!inside(to.x,to.y,to.z))return -1;
    if(blocksFlow(from,to))return barriers.at(edgeKey(from,to));
    int i=address(to.x,to.y,to.z);return occupied[i]?owners.at(i):-1;
  }
  bool blocksFlow(Cell from,Cell to) const {
    int key=edgeKey(from,to);return blockedEdge(key/3,key%3);
  }
  bool blockedEdge(int i,int axis) const {
    return blockedEdge(edgeMasks,i,axis);
  }
  static bool blockedEdge(const FlowMasks& masks,int i,int axis) {
    const auto& mask=masks[i/CELLS];return !mask.empty()&&(mask[i%CELLS]&(1<<axis));
  }
  int adjacentIndex(int i,int axis,int direction) const {
    int stride=axis==0?1:axis==1?C:C*C,local=i%CELLS,coordinate=local/stride%C;
    if(coordinate+direction>=0&&coordinate+direction<C)return i+direction*stride;
    int chunk=i/CELLS,chunkStride=axis==0?1:axis==1?CW:CW*CH,dimension=axis==0?CW:axis==1?CH:CD;
    int next=chunk/chunkStride%dimension+direction;
    chunk+=(next<0?dimension-1:next>=dimension?1-dimension:direction)*chunkStride;
    return chunk*CELLS+local+direction*(1-C)*stride;
  }
  bool clearPath(Cell from,Cell to) const {
    for(int axis: {0,2,1}) {
      int distance=axis==0?to.x-from.x:axis==1?to.y-from.y:to.z-from.z;
      for(int k=0;k<std::abs(distance);++k) {
        int sign=distance>0?1:-1;Cell p{from.x+(axis==0?sign:0),from.y+(axis==1?sign:0),from.z+(axis==2?sign:0)};
        if(contactBody(from,p)>=0)return false;from=p;
      }
    }
    return true;
  }
  void set(int x,int y,int z,uint8_t m) {
    if(inside(x,y,z)&&get(x,y,z)!=m)motion.erase(address(x,y,z));
    VoxelWorld::set(x,y,z,m);
  }
  void wakeLoose(Cell c) {
    if(!inside(c.x,c.y,c.z))return;
    int i=address(c.x,c.y,c.z);auto m=raw(i);
    if(powder(m))queueSand(i);else if(flowing(m))queueFluid(i);
  }
  void moveLoose(Cell from,Cell to) {
    int a=address(from.x,from.y,from.z),b=address(to.x,to.y,to.z);
    auto first=raw(a),second=raw(b);
    auto ma=motion.find(a),mb=motion.find(b);
    bool hasA=ma!=motion.end(),hasB=mb!=motion.end();
    LooseMotion va=hasA?ma->second:LooseMotion{},vb=hasB?mb->second:LooseMotion{};
    set(from.x,from.y,from.z,second);set(to.x,to.y,to.z,first);
    if(hasA)motion[b]=va;if(hasB)motion[a]=vb;
  }
  void noteFall(int i,float limit) {motion[i].fall=std::min(limit,motion[i].fall+GRAVITY/30);}
  void impactLoose(Cell c,Cell target) {
    int i=address(c.x,c.y,c.z);auto it=motion.find(i);if(it==motion.end()||it->second.fall==0)return;
    if(inside(target.x,target.y,target.z)) {
      int owner=contactBody(c,target);
      if(owner>=0) {
        auto& b=bodies[owner];float mass=density(raw(i));
        b3Vec3 p{c.x+.5f,c.y+.5f,c.z+.5f};
        float relative=std::max(0.f,it->second.fall+b3Body_GetWorldPointVelocity(b.id,p).y);
        b3Body_ApplyLinearImpulse(b.id,{0,-mass*relative/(1+mass/b3Body_GetMass(b.id)),0},p,true);
      }
    }
    it->second.fall=0;
  }
  void updateOccupied() {
    bool changed=false;
    for(const auto& b:bodies) {
      if(b.active!=b.rasterActive){changed=true;break;}
      if(!b.active)continue;auto a=b3Body_GetTransform(b.id),p=b.rasterPose;
      if(a.p.x!=p.p.x||a.p.y!=p.p.y||a.p.z!=p.p.z||a.q.v.x!=p.q.v.x||a.q.v.y!=p.q.v.y||a.q.v.z!=p.q.v.z||a.q.s!=p.q.s){changed=true;break;}
    }
    if(!changed)return;
    auto previous=std::move(owners);owners.clear();
    auto oldBarriers=std::move(barriers);barriers.clear();
    owners.reserve(previous.entries.size());barriers.reserve(oldBarriers.entries.size());
    for(int chunk:edgeChunks)std::vector<uint8_t>().swap(edgeMasks[chunk]);edgeChunks.clear();
    for(int i:occupiedCells)occupied[i]=0;occupiedCells.clear();
    for(int slot=0;slot<int(bodies.size());++slot) {
      auto& b=bodies[slot];b.rasterActive=b.active;if(!b.active)continue;auto tr=b3Body_GetTransform(b.id);b.rasterPose=tr;
      b3Vec3 lo{float(W),float(H),float(D)},hi{};
      for(int k=0;k<8;++k) {
        auto p=b3TransformPoint(tr,{float(k&1?b.size.x:0),float(k&2?b.size.y:0),float(k&4?b.size.z:0)});
        lo={std::min(lo.x,p.x),std::min(lo.y,p.y),std::min(lo.z,p.z)};
        hi={std::max(hi.x,p.x),std::max(hi.y,p.y),std::max(hi.z,p.z)};
      }
      // Inverse sampling fills rotated volumes without holes between forward-splatted cells.
      for(int z=std::max(0,int(std::floor(lo.z)));z<std::min(D,int(std::ceil(hi.z)));++z)
        for(int y=std::max(0,int(std::floor(lo.y)));y<std::min(H,int(std::ceil(hi.y)));++y)
          for(int x=std::max(0,int(std::floor(lo.x)));x<std::min(W,int(std::ceil(hi.x)));++x) {
            auto p=b3InvTransformPoint(tr,{x+.5f,y+.5f,z+.5f});
            int a=int(std::floor(p.x)),c=int(std::floor(p.y)),d=int(std::floor(p.z));
            if(a<0||c<0||d<0||a>=b.size.x||c>=b.size.y||d>=b.size.z||!b.cells[localIndex(a,c,d)])continue;
            int i=address(x,y,z);if(occupied[i])continue;
            occupied[i]=1;occupiedCells.push_back(i);owners.try_emplace(i,slot);
          }
      // Block center-to-center paths crossing actual voxel faces. Thin rotating
      // walls stay watertight even when neither adjacent cell center is solid.
      for(auto [local,normal,halfU,halfV]:b.flowFaces) {
        auto p=b3TransformPoint(tr,local),n=b3RotateVector(tr.q,normal);
        b3Vec3 u=normal.x?b3Vec3{0,1,0}:b3Vec3{1,0,0},v=b3Cross(normal,u);
        u=b3RotateVector(tr.q,u);v=b3RotateVector(tr.q,v);
        b3Vec3 extent{std::abs(u.x)*halfU+std::abs(v.x)*halfV,std::abs(u.y)*halfU+std::abs(v.y)*halfV,std::abs(u.z)*halfU+std::abs(v.z)*halfV};
        auto low=sub(p,extent),high=add(p,extent);
        for(int axisIndex=0;axisIndex<3;++axisIndex) {
          float denominator=axis(n,axisIndex);if(std::abs(denominator)<.00001f)continue;
          int a=(axisIndex+1)%3,b=(axisIndex+2)%3,dimensions[3]={W,H,D};
          int beginA=std::max(0,int(std::ceil(axis(low,a)-.5f))),endA=std::min(dimensions[a]-1,int(std::floor(axis(high,a)-.5f)));
          int beginB=std::max(0,int(std::ceil(axis(low,b)-.5f))),endB=std::min(dimensions[b]-1,int(std::floor(axis(high,b)-.5f)));
          for(int ca=beginA;ca<=endA;++ca)for(int cb=beginB;cb<=endB;++cb) {
            float crossing=axis(p,axisIndex)-(axis(n,a)*(ca+.5f-axis(p,a))+axis(n,b)*(cb+.5f-axis(p,b)))/denominator;
            int coordinates[3];coordinates[a]=ca;coordinates[b]=cb;coordinates[axisIndex]=int(std::floor(crossing-.5f));
            int x=coordinates[0],y=coordinates[1],z=coordinates[2];if(!inside(x,y,z))continue;
            Cell c{x,y,z},next{x+(axisIndex==0),y+(axisIndex==1),z+(axisIndex==2)};
            if(!inside(next.x,next.y,next.z))continue;
            b3Vec3 start{x+.5f,y+.5f,z+.5f};float t=b3Dot(sub(p,start),n)/denominator;
            if(t<-.00001f||t>1.00001f)continue;
            b3Vec3 hit=sub(add(start,{axisIndex==0?t:0,axisIndex==1?t:0,axisIndex==2?t:0}),p);
            if(std::abs(b3Dot(hit,u))<=halfU+.00001f&&std::abs(b3Dot(hit,v))<=halfV+.00001f) {
              int key=edgeKey(c,next),i=key/3;barriers.try_emplace(key,slot);
              auto& mask=edgeMasks[i/CELLS];if(mask.empty()){mask.resize(CELLS);edgeChunks.push_back(i/CELLS);}
              mask[i%CELLS]|=1<<(key%3);
            }
          }
        }
      }
    }
    for(const auto& [i,slot]:previous)if(!owners.contains(i)) {
      auto c=decode(i);wakeLoose(c);for(auto n:neighbors)wakeLoose({c.x+n.x,c.y+n.y,c.z+n.z});
    }
    for(auto [edge,slot]:oldBarriers)if(!barriers.contains(edge)) {
      auto c=decode(edge/3);int axis=edge%3;wakeLoose(c);wakeLoose({c.x+(axis==0),c.y+(axis==1),c.z+(axis==2)});
    }
  }
  bool displaceLoose(const BodyCellMap& previous,const BodyCellMap& oldBarriers,std::vector<int>& blocked) {
    blocked.clear();
    std::vector<int> marked;
    std::vector<std::pair<int,int>> moves;
    for(int source:occupiedCells) {
      auto m=raw(source);if((!liquid(m)&&!powder(m)&&!gas(m))||(visited[source]&2))continue;
      auto& body=bodies[owners.at(source)];auto pose=b3Body_GetTransform(body.id);
      uint16_t region=body.fresh?0:bodySpace(body,body.materialPose,decode(source));if(region==UINT16_MAX)region=0;
      std::vector<int> component{source},sources{source},vacancies;marked.push_back(source);visited[source]=3;
      // Project gas squeezed by one body together, so a large burning surface
      // shares its search for free space.
      if(gas(m))for(int i:occupiedCells) {
        if((visited[i]&2)||raw(i)!=m||owners.at(i)!=owners.at(source))continue;
        auto r=body.fresh?0:bodySpace(body,body.materialPose,decode(i));if(r==UINT16_MAX)r=0;
        if(r!=region)continue;component.push_back(i);sources.push_back(i);marked.push_back(i);visited[i]=3;
      }
      // Pressure travels through connected material and the newly swept volume.
      // Existing body walls and terrain never form a route into a sealed cavity.
      for(size_t k=0;k<component.size();++k) {
        if(vacancies.size()>=sources.size())break;
        int i=component[k];auto c=decode(i);
        for(auto n:neighbors) {
          Cell p{c.x+n.x,c.y+n.y,c.z+n.z};if(!inside(p.x,p.y,p.z))continue;
          int j=address(p.x,p.y,p.z);auto other=raw(j);
          if(!occupied[i]&&!occupied[j]&&oldBarriers.contains(edgeKey(c,p)))continue;
          bool gasRoute=gas(m)&&occupied[j]&&owners.at(j)==owners.at(source);
          if((visited[j]&1)||((visited[j]&2)&&!occupied[j])||solid(other)||(occupied[j]&&previous.contains(j)&&!gasRoute))continue;
          if(!occupied[j]&&other==AIR) {
            if(!body.hasCavity||bodySpace(body,pose,p)==region){visited[j]=1;vacancies.push_back(j);}continue;
          }
          if(body.hasCavity&&!body.fresh&&!gasRoute&&bodySpace(body,body.materialPose,p)!=region)continue;
          // Gas vents through connected fluid when a moving solid squeezes a
          // bubble. The gas and liquid cell counts both remain unchanged.
          if(other==m||(gas(m)&&(liquid(other)||gas(other)))||(liquid(m)&&gas(other))||(occupied[j]&&other==AIR)) {
            visited[j]=visited[j]|1;component.push_back(j);
            if(occupied[j]&&other==m&&!(visited[j]&2)){sources.push_back(j);marked.push_back(j);visited[j]=3;}
          }
        }
      }
      for(size_t k=0;k<vacancies.size()&&vacancies.size()<sources.size();++k) {
        auto c=decode(vacancies[k]);
        for(auto n:neighbors) {
          Cell p{c.x+n.x,c.y+n.y,c.z+n.z};if(!inside(p.x,p.y,p.z))continue;
          int j=address(p.x,p.y,p.z);
          if(!visited[j]&&!occupied[j]&&raw(j)==AIR&&!blocksFlow(c,p)&&(!body.hasCavity||bodySpace(body,pose,p)==region)){visited[j]=1;vacancies.push_back(j);}
        }
      }
      for(int i:component)visited[i]=visited[i]&2;for(int i:vacancies)visited[i]=visited[i]&2;
      if(vacancies.size()<sources.size()){
        int owner=owners.at(source);if(std::find(blocked.begin(),blocked.end(),owner)==blocked.end())blocked.push_back(owner);
        continue;
      }
      std::sort(vacancies.begin(),vacancies.end(),[&](int a,int b){return decode(a).y<decode(b).y;});
      for(size_t k=0;k<sources.size();++k) {
        if(powder(m)) {
          auto c=decode(sources[k]);size_t best=k;float score=INFINITY;
          for(size_t j=k;j<vacancies.size();++j) {
            auto p=decode(vacancies[j]);float dx=p.x-c.x,dy=p.y-c.y,dz=p.z-c.z;
            float cost=dx*dx+dy*dy+dz*dz+(dy<0?1024.f:0.f);
            if(cost<score){score=cost;best=j;}
          }
          std::swap(vacancies[k],vacancies[best]);
        }
        visited[vacancies[k]]=2;marked.push_back(vacancies[k]);moves.push_back({sources[k],vacancies[k]});
      }
    }
    for(int i:marked)visited[i]=0;
    if(!blocked.empty())return false;
    for(auto [from,to]:moves) {
      auto& b=bodies[owners.at(from)];auto c=decode(from);b3Vec3 p{c.x+.5f,c.y+.5f,c.z+.5f};
      float mass=std::max(.01f,density(raw(from)));
      auto old=motion.contains(from)?motion.at(from).velocity:b3Vec3{};
      auto impulse=mul(sub(b3Body_GetWorldPointVelocity(b.id,p),old),mass*.5f/(1+mass/b3Body_GetMass(b.id)));
      moveLoose(c,decode(to));motion[to].velocity=add(old,mul(impulse,1/mass));
      b3Body_ApplyLinearImpulse(b.id,mul(impulse,-1),p,true);++displacedCells;
    }
    return true;
  }
  void refillWake(const BodyCellMap& previous) {
    std::unordered_set<int> gaps,seen;
    for(auto [i,slot]:previous)if(!occupied[i]&&raw(i)==AIR)gaps.insert(i);
    struct Pool {uint8_t material;std::vector<int> surface;};
    std::vector<Pool> pools;
    std::unordered_map<int,int> poolOf;
    struct Gap {std::vector<int> cells;int seed;};
    std::vector<Gap> groups;
    auto lower=[&](int a,int b){return decode(a).y<decode(b).y;};
    auto surfaceCell=[&](int i) {
      auto c=decode(i);return c.y+1<H&&get(c.x,c.y+1,c.z)==AIR&&contactBody(c,{c.x,c.y+1,c.z})<0;
    };
    for(int start:gaps) {
      if(seen.contains(start))continue;
      std::vector<int> dry{start};seen.insert(start);int seed=-1;
      for(size_t k=0;k<dry.size();++k) {
        auto c=decode(dry[k]);
        for(auto n:neighbors) {
          Cell p{c.x+n.x,c.y+n.y,c.z+n.z};if(!inside(p.x,p.y,p.z))continue;
          int j=address(p.x,p.y,p.z);if(occupied[j]||blocksFlow(c,p))continue;
          if(gaps.contains(j)&&seen.insert(j).second)dry.push_back(j);
          else if(liquid(raw(j)))seed=j;
        }
      }
      if(seed<0)continue;
      poolOf.try_emplace(seed,-1);groups.push_back({std::move(dry),seed});
    }
    for(auto& gap:groups) {
      auto& dry=gap.cells;int seed=gap.seed;
      // A moving surface can leave many separate gaps in the same pool. Share
      // its connectivity and free-surface heap across all of those gaps.
      int pool=poolOf.at(seed);
      if(pool<0) {
        pool=int(pools.size());auto m=raw(seed);pools.push_back({m,{}});
        auto spans=floodLiquid(seed);
        for(auto span:spans) {
          int i=address(span.bottom.x,span.top,span.bottom.z);
          if(surfaceCell(i))pools[pool].surface.push_back(i);
        }
        for(auto& [i,owner]:poolOf)if(owner<0&&visited[i])owner=pool;
        clearLiquidVisit(spans);
        std::make_heap(pools[pool].surface.begin(),pools[pool].surface.end(),lower);
      }
      std::sort(dry.begin(),dry.end(),[&](int a,int b){return decode(a).y<decode(b).y;});
      auto& wet=pools[pool].surface;size_t target=0;
      // Connected liquid pressure fills a body's submerged wake from its free surface.
      while(target<dry.size()&&!wet.empty()) {
        int i=wet.front();auto from=decode(i),to=decode(dry[target]);
        if(from.y<=to.y)break;
        std::pop_heap(wet.begin(),wet.end(),lower);wet.pop_back();
        if(raw(i)!=pools[pool].material||!surfaceCell(i))continue;
        moveLoose(from,to);++target;
        if(from.y>0) {
          int below=address(from.x,from.y-1,from.z);
          if(raw(below)==pools[pool].material&&surfaceCell(below)) {
            wet.push_back(below);std::push_heap(wet.begin(),wet.end(),lower);
          }
        }
      }
    }
  }
  struct LiquidSpan {Cell bottom;int top;};
  std::vector<LiquidSpan> floodLiquid(int seed) {
    struct Entry {Cell cell;int index;};
    std::vector<LiquidSpan> spans;std::vector<Entry> pending{{decode(seed),seed}};auto m=raw(seed);
    auto open=[&](int i,int j,int axis,int direction) {
      return !visited[j]&&raw(j)==m&&!occupied[j]&&!blockedEdge(direction>0?i:j,axis);
    };
    // Flood vertical runs rather than enqueueing every voxel and hashing each
    // of its six neighbors. The shared visit bitmap is cleared by the caller.
    for(size_t k=0;k<pending.size();++k) {
      auto c=pending[k].cell;int index=pending[k].index;if(visited[index])continue;
      int bottom=c.y,top=c.y,lower=index,upper=index;
      while(bottom>0) {int j=adjacentIndex(lower,1,-1);if(!open(lower,j,1,-1))break;lower=j;--bottom;}
      while(top+1<H) {int j=adjacentIndex(upper,1,1);if(!open(upper,j,1,1))break;upper=j;++top;}
      spans.push_back({{c.x,bottom,c.z},top});
      for(int y=bottom,i=lower;y<=top;++y,i=adjacentIndex(i,1,1))visited[i]=1;
      for(int axis: {0,2})for(int direction: {-1,1}) {
        Cell b{c.x+(axis==0?direction:0),bottom,c.z+(axis==2?direction:0)};if(!inside(b.x,b.y,b.z))continue;
        bool run=false;int prior=0;
        for(int y=bottom,i=lower,j=adjacentIndex(lower,axis,direction);y<=top;++y,i=adjacentIndex(i,1,1),prior=j,j=adjacentIndex(j,1,1)) {
          bool pass=open(i,j,axis,direction);b.y=y;
          if(pass&&(!run||blockedEdge(prior,1)))pending.push_back({b,j});
          run=pass;
        }
      }
    }
    return spans;
  }
  void clearLiquidVisit(const std::vector<LiquidSpan>& spans) {
    for(auto span:spans)for(int y=span.bottom.y,i=address(span.bottom.x,y,span.bottom.z);y<=span.top;++y,i=adjacentIndex(i,1,1))visited[i]=0;
  }
  struct MaterialForce {b3Vec3 force{},torque{};};
  std::vector<MaterialForce> materialForces(float dt) {
    std::vector<MaterialForce> result(bodies.size());
    std::unordered_map<int,float> heads;
    for(const auto& b:bodies)if(b.active) {
      auto tr=b3Body_GetTransform(b.id);
      for(auto [local,normal]:b.faces) {
        auto p=add(b3TransformPoint(tr,local),mul(b3RotateVector(tr.q,normal),.55f));
        Cell c{int(std::floor(p.x)),int(std::floor(p.y)),int(std::floor(p.z))};
        if(!inside(c.x,c.y,c.z))continue;int i=address(c.x,c.y,c.z);
        if(liquid(raw(i))&&!occupied[i])heads.try_emplace(i,-1);
      }
    }
    auto liquidHead=[&](int seed) {
      auto known=heads.find(seed);if(known!=heads.end()&&known->second>=0)return known->second;
      auto spans=floodLiquid(seed);int top=decode(seed).y+1,surfaces=0;double total=0;
      for(auto span:spans) {
        Cell c{span.bottom.x,span.top,span.bottom.z};top=std::max(top,c.y+1);
        if(c.y+1<H&&get(c.x,c.y+1,c.z)==AIR&&contactBody(c,{c.x,c.y+1,c.z})<0){total+=c.y+1;++surfaces;}
      }
      float head=surfaces?float(total/surfaces):float(top);
      for(auto& [i,value]:heads)if(visited[i])value=head;
      clearLiquidVisit(spans);heads[seed]=head;return head;
    };
    for(int slot=0;slot<int(bodies.size());++slot) {
      auto& b=bodies[slot];if(!b.active)continue;
      auto tr=b3Body_GetTransform(b.id);auto center=b3Body_GetWorldCenter(b.id);float bodyMass=b3Body_GetMass(b.id);
      for(auto [local,normal]:b.faces) {
        auto p=b3TransformPoint(tr,local),n=b3RotateVector(tr.q,normal),outside=add(p,mul(n,.55f));
        Cell c{int(std::floor(outside.x)),int(std::floor(outside.y)),int(std::floor(outside.z))};
        if(!inside(c.x,c.y,c.z))continue;int i=address(c.x,c.y,c.z);auto m=raw(i);
        if(occupied[i]||(!liquid(m)&&!powder(m)))continue;
        float head=0;
        if(liquid(m))head=std::max(0.f,float(liquidHead(i))-p.y);
        else {
          int top=c.y+1;while(top<H&&powder(get(c.x,top,c.z))&&!occupied[address(c.x,top,c.z)])++top;
          float depth=top-p.y;
          // Dry grains transmit overburden and resist indentation under a loaded footprint.
          head=std::max(0.f,depth);
          if(n.y<-.5f)head+=6.f*std::min(b.size.x,b.size.z)*std::clamp(depth+.5f,0.f,1.f);
        }
        auto force=mul(n,-density(m)*GRAVITY*head);
        result[slot].force=add(result[slot].force,force);
        result[slot].torque=add(result[slot].torque,b3Cross(sub(p,center),force));
        auto fluid=motion.contains(i)?motion.at(i).velocity:b3Vec3{};
        auto relative=sub(fluid,b3Body_GetWorldPointVelocity(b.id,p));float vn=b3Dot(relative,n);
        float mass=density(m)/(1+density(m)/bodyMass);
        float drag=std::min(.5f,dt*((powder(m)?40.f:24.f)+std::abs(vn)))*mass;
        auto impulse=mul(add(mul(n,vn),mul(sub(relative,mul(n,vn)),powder(m)?.65f:m==LAVA?.4f:.08f)),drag);
        if(length(impulse)>.001f) {
          b3Body_ApplyLinearImpulse(b.id,impulse,p,true);
          motion[i].velocity=sub(fluid,mul(impulse,1/density(m)));wakeLoose(c);
        }
      }
    }
    return result;
  }
  void advectLoose(float dt) {
    std::vector<int> active;active.reserve(motion.size());for(const auto& [i,v]:motion)active.push_back(i);
    std::sort(active.begin(),active.end());std::unordered_set<int> moved;
    for(int start:active) {
      if(moved.contains(start))continue;auto it=motion.find(start);if(it==motion.end())continue;
      auto state=it->second;auto c=decode(start);int i=start;auto m=raw(i);
      if((!liquid(m)&&!powder(m)&&!gas(m))||occupied[i])continue;
      state.velocity=mul(state.velocity,std::exp(-dt*(powder(m)?3.f:1.f)));
      if(state.velocity.y>0)state.velocity.y=std::max(0.f,state.velocity.y-GRAVITY*dt);
      state.remainder=add(state.remainder,mul(state.velocity,dt));
      for(int axisIndex=0;axisIndex<3;++axisIndex) {
        float& remainder=axisIndex==0?state.remainder.x:axisIndex==1?state.remainder.y:state.remainder.z;
        float& velocity=axisIndex==0?state.velocity.x:axisIndex==1?state.velocity.y:state.velocity.z;
        int count=std::min(8,int(std::abs(remainder))),sign=remainder<0?-1:1;
        for(int k=0;k<count;++k) {
          Cell p{c.x+(axisIndex==0?sign:0),c.y+(axisIndex==1?sign:0),c.z+(axisIndex==2?sign:0)};
          if(!inside(p.x,p.y,p.z)){velocity=0;remainder=0;break;}
          int j=address(p.x,p.y,p.z);auto other=raw(j);
          int owner=contactBody(c,p);
          if(owner>=0||other!=AIR) {
            if(owner>=0) {
              b3Vec3 impulse{};float amount=density(m)*velocity;
              if(axisIndex==0)impulse.x=amount;else if(axisIndex==1)impulse.y=amount;else impulse.z=amount;
              b3Body_ApplyLinearImpulse(bodies[owner].id,impulse,{c.x+.5f,c.y+.5f,c.z+.5f},true);
            }else if(other==m&&!moved.contains(j)) {
              auto& next=motion[j];float amount=velocity*.5f;
              if(axisIndex==0)next.velocity.x+=amount;else if(axisIndex==1)next.velocity.y+=amount;else next.velocity.z+=amount;
              wakeLoose(p);velocity*=.5f;remainder=0;break;
            }
            velocity=0;remainder=0;break;
          }
          moveLoose(c,p);c=p;i=j;remainder-=sign;
        }
      }
      moved.insert(i);
      if(length(state.velocity)<.25f&&state.fall==0)motion.erase(i);else motion[i]=state;
    }
  }
  void stepCoupledBodies(float dt) {
    std::fill(std::begin(couplingMs),std::end(couplingMs),0.f);
    if(!bodyCount()){b3World_Step(world,dt,4);return;}
    for(auto& b:bodies)if(b.active)b.materialPose=b3Body_GetTransform(b.id);
    std::vector<int> blocked;
    if(std::any_of(bodies.begin(),bodies.end(),[](const Body& b){return b.active&&b.fresh;})) {
      BodyCellMap existing,existingEdges;
      for(auto [i,slot]:owners)if(!bodies[slot].fresh)existing.try_emplace(i,slot);
      for(auto [i,slot]:barriers)if(!bodies[slot].fresh)existingEdges.try_emplace(i,slot);
      updateOccupied();
      for(size_t retry=0;retry<bodies.size()&&!displaceLoose(existing,existingEdges,blocked);++retry) {
        bool removed=false;
        for(int slot:blocked) {auto& b=bodies[slot];if(!b.fresh)continue;b3DestroyBody(b.id);b.active=false;++limitHits;removed=true;}
        if(!removed)break;updateOccupied();
      }
    }
    for(auto& b:bodies)b.fresh=false;
    double phase=emscripten_get_now();auto forces=materialForces(dt);couplingMs[0]+=emscripten_get_now()-phase;
    int steps=1;
    for(const auto& b:bodies)if(b.active) {
      auto center=b3Body_GetLocalCenter(b.id);
      float radius=length({std::max(center.x,b.size.x-center.x),std::max(center.y,b.size.y-center.y),std::max(center.z,b.size.z-center.z)});
      float travel=(length(b3Body_GetLinearVelocity(b.id))+length(b3Body_GetAngularVelocity(b.id))*radius)*dt;
      // Fine swept-volume steps protect incompressible liquids and grains.
      // Gas uses volume projection; it does not require sub-voxel solid steps.
      auto p=b3Body_GetWorldCenter(b.id);float reach=radius+travel+1;bool dense=false;
      for(int z=std::max(0,int(p.z-reach)/C);z<=std::min(CD-1,int(p.z+reach)/C)&&!dense;++z)
        for(int y=std::max(0,int(p.y-reach)/C);y<=std::min(CH-1,int(p.y+reach)/C)&&!dense;++y)
          for(int x=std::max(0,int(p.x-reach)/C);x<=std::min(CW-1,int(p.x+reach)/C);++x) {
            const auto& c=chunks[address(x*C,y*C,z*C)/CELLS];
            if(c.sand||c.counts[WATER]||c.counts[ACID]||c.counts[LAVA]){dense=true;break;}
          }
      if(!dense)continue;
      steps=std::max(steps,std::min(16,int(std::ceil(travel/.75f))));
    }
    std::vector<b3Transform> poses(bodies.size());
    for(int substep=0;substep<steps;++substep) {
      for(int slot=0;slot<int(bodies.size());++slot)if(bodies[slot].active) {
        auto id=bodies[slot].id;poses[slot]=b3Body_GetTransform(id);bodies[slot].materialPose=poses[slot];
        if(length(forces[slot].force)>.001f)b3Body_ApplyForceToCenter(id,forces[slot].force,true);
        if(length(forces[slot].torque)>.001f)b3Body_ApplyTorque(id,forces[slot].torque,true);
      }
      phase=emscripten_get_now();auto previous=owners,previousEdges=barriers;couplingMs[1]+=emscripten_get_now()-phase;
      phase=emscripten_get_now();b3World_Step(world,dt/steps,std::max(1,(4+steps-1)/steps));couplingMs[2]+=emscripten_get_now()-phase;
      phase=emscripten_get_now();updateOccupied();couplingMs[1]+=emscripten_get_now()-phase;
      phase=emscripten_get_now();
      for(size_t retry=0;retry<bodies.size()&&!displaceLoose(previous,previousEdges,blocked);++retry) {
        // An incompressible, sealed volume rejects intrusion instead of deleting material.
        for(int slot:blocked) {
          auto id=bodies[slot].id;auto& p=poses[slot];
          b3Body_SetTransform(id,p.p,p.q);b3Body_SetLinearVelocity(id,{});b3Body_SetAngularVelocity(id,{});++blockedMoves;
        }
        updateOccupied();
      }
      couplingMs[3]+=emscripten_get_now()-phase;
      phase=emscripten_get_now();refillWake(previous);couplingMs[4]+=emscripten_get_now()-phase;
    }
  }
