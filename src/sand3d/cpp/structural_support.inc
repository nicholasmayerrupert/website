  void detachUnsupported() {
    auto seeds=std::move(edits);edits.clear();
    auto originals=std::move(editOriginals);editOriginals.clear();
    if(seeds.empty())return;
    std::vector<int> touched;
    std::unordered_map<ChunkKey,uint8_t,KeyHash> exteriorVisited;
    std::unordered_map<ChunkKey,TerrainChunk,KeyHash> exteriorChunks;
    std::unordered_map<ChunkKey,int64_t,KeyHash> lowestEdit;
    auto rememberEdit=[&](ChunkKey k) {
      ChunkKey column{k.x,0,k.z};auto [it,inserted]=lowestEdit.try_emplace(column,k.y);
      if(!inserted)it->second=std::min(it->second,k.y);
    };
    for(const auto& [key,data]:saved)rememberEdit(key);
    for(const auto& chunk:chunks)if(chunk.modified)rememberEdit(chunk.key);
    auto chunkKey=[&](Cell c){return ChunkKey{floorDiv(origin.x+c.x,C),floorDiv(origin.y+c.y,C),floorDiv(origin.z+c.z,C)};};
    auto exteriorIndex=[&](Cell c){return wrapIndex(origin.x+c.x,C)+C*(wrapIndex(origin.y+c.y,C)+C*wrapIndex(origin.z+c.z,C));};
    auto sample=[&](Cell c)->uint8_t {
      if(inside(c.x,c.y,c.z))return get(c.x,c.y,c.z);
      auto key=chunkKey(c);
      if(saved.contains(key)) {
        auto [it,inserted]=exteriorChunks.try_emplace(key);
        if(inserted)generate(it->second,key);
        return it->second.cells[exteriorIndex(c)];
      }
      int64_t x=origin.x+c.x,y=origin.y+c.y,z=origin.z+c.z;
      auto& cached=columns[wrapIndex(x,W)+W*wrapIndex(z,D)];
      if(cached.x!=x||cached.z!=z){cached.x=x;cached.z=z;cached.data=columnAt((x+.5)*VOXEL,(z+.5)*VOXEL);}
      return generatedCell(x,y,z,cached.data);
    };
    auto state=[&](Cell c)->uint8_t {
      if(inside(c.x,c.y,c.z))return visited[address(c.x,c.y,c.z)];
      auto it=exteriorVisited.find({c.x,c.y,c.z});return it==exteriorVisited.end()?0:it->second;
    };
    auto mark=[&](Cell c,uint8_t value) {
      if(inside(c.x,c.y,c.z)){int i=address(c.x,c.y,c.z);if(!visited[i])touched.push_back(i);visited[i]=value;}
      else exteriorVisited[{c.x,c.y,c.z}]=value;
    };
    auto rooted=[&](Cell c) {
      // Below the cave floor, an unedited vertical column is continuous rock
      // to infinite depth. A loaded-window edge is not a support witness.
      if((origin.y+c.y+.5)*VOXEL>=-40)return false;
      auto key=chunkKey(c);auto it=lowestEdit.find({key.x,0,key.z});
      return it==lowestEdit.end()||key.y<it->second;
    };
    struct Piece {Cell origin;std::vector<Cell> cells;std::vector<uint8_t> materials;};
    std::vector<Piece> pieces;
    bool capacity=true;
    const Cell candidates[7]={{0,0,0},{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
    // The DFS follows downward edges first to find the deep support witness.
    const Cell directions[6]={{1,0,0},{-1,0,0},{0,0,1},{0,0,-1},{0,1,0},{0,-1,0}};
    for(auto seed:seeds) {
      if(!capacity)break;
      for(auto n:candidates) {
        Cell first{seed.x+n.x,seed.y+n.y,seed.z+n.z};
        if(!solid(sample(first))||state(first))continue;
        queue.clear();std::vector<Cell> stack{first};mark(first,1);bool anchored=false;
        while(!stack.empty()&&!anchored) {
          auto c=stack.back();stack.pop_back();queue.push_back(c);
          if(rooted(c)){anchored=true;break;}
          for(auto d:directions) {
            Cell v{c.x+d.x,c.y+d.y,c.z+d.z};if(!solid(sample(v)))continue;
            auto visitedState=state(v);if(visitedState==2){anchored=true;break;}
            if(!visitedState){mark(v,1);stack.push_back(v);}
          }
        }
        if(anchored) {
          for(auto c:queue)mark(c,2);
          for(auto c:stack)mark(c,2);
          continue;
        }
        Cell lo=first;
        for(auto c:queue)lo={std::min(lo.x,c.x),std::min(lo.y,c.y),std::min(lo.z,c.z)};
        std::unordered_map<ChunkKey,size_t,KeyHash> partitions;
        for(auto c:queue) {
          ChunkKey key{(c.x-lo.x)/B,(c.y-lo.y)/B,(c.z-lo.z)/B};
          auto [it,inserted]=partitions.try_emplace(key,pieces.size());
          if(inserted)pieces.push_back({{lo.x+int(key.x)*B,lo.y+int(key.y)*B,lo.z+int(key.z)*B},{},{}});
          auto& piece=pieces[it->second];
          piece.cells.push_back({c.x-piece.origin.x,c.y-piece.origin.y,c.z-piece.origin.z});piece.materials.push_back(sample(c));
        }
        if(int(pieces.size())>MAX_BODIES-bodyCount()){capacity=false;break;}
      }
    }
    for(int i:touched)visited[i]=0;
    if(!capacity) {
      // Support removal is atomic: at the body limit the cut stays supported,
      // rather than leaving disconnected static islands or deleting material.
      generating=true;
      for(auto [i,m]:originals){auto c=decode(i);set(c.x,c.y,c.z,m);}
      generating=false;++limitHits;edits.clear();editOriginals.clear();
      rebuildTerrain();updateOccupied();return;
    }
    std::unordered_set<ChunkKey,KeyHash> changedExterior;
    for(auto& piece:pieces) {
      auto p=piece.origin;createBody(piece.cells,piece.materials,{float(p.x),float(p.y),float(p.z)});
      for(auto c:piece.cells) {
        c={c.x+p.x,c.y+p.y,c.z+p.z};
        if(inside(c.x,c.y,c.z)){set(c.x,c.y,c.z,AIR);continue;}
        auto key=chunkKey(c);auto [it,inserted]=exteriorChunks.try_emplace(key);
        if(inserted)generate(it->second,key);
        it->second.cells[exteriorIndex(c)]=AIR;changedExterior.insert(key);
      }
    }
    for(auto key:changedExterior) {
      saved[key]=pack(exteriorChunks.at(key).cells);renderChanges.insert(key);prepared.erase(key);
      auto collider=terrainBodies.find(key);
      if(collider!=terrainBodies.end()){if(b3Body_IsValid(collider->second))b3DestroyBody(collider->second);terrainBodies.erase(collider);}
    }
    edits.clear();editOriginals.clear();rebuildTerrain();updateOccupied();
  }
