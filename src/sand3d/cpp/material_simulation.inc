  // Contact rules follow the 2D engine: acid erosion, combustion, and granular
  // lava quenching. Structural edits are collected for one connectivity pass.
  static constexpr int REACTION_EDIT_BUDGET=32;
  bool reactMaterial(Cell c,uint8_t m,int phase,bool apply=true) {
    if(m==STEAM||m==SMOKE)return false;
    bool active=false;
    for(int k=0;k<6;++k) {
      auto d=neighbors[(phase+k)%6];Cell n{c.x+d.x,c.y+d.y,c.z+d.z};
      if(!inside(n.x,n.y,n.z))continue;auto other=get(n.x,n.y,n.z);
      if(m==LAVA&&(other==WATER||other==ACID)) {
        if(!apply)return true;
        set(n.x,n.y,n.z,STEAM);set(c.x,c.y,c.z,STONE_DUST);++reactions;return true;
      }
      if((m==WATER||m==ACID)&&other==LAVA) {
        if(!apply)return true;
        set(n.x,n.y,n.z,STONE_DUST);set(c.x,c.y,c.z,STEAM);++reactions;return true;
      }
      if(m==FIRE&&other==WATER) {
        if(!apply)return true;
        set(n.x,n.y,n.z,STEAM);set(c.x,c.y,c.z,AIR);++reactions;return true;
      }
      if(m==WATER&&other==FIRE) {
        if(!apply)return true;
        set(n.x,n.y,n.z,AIR);set(c.x,c.y,c.z,STEAM);++reactions;return true;
      }
      bool erodes=m==ACID&&dissolvable(other);
      bool burns=(m==LAVA||m==FIRE)&&flammable(other);
      if(!erodes&&!burns)continue;
      active=true;
      if(!apply||reactionEdits>=REACTION_EDIT_BUDGET||(!erodes&&tick%6!=0))continue;
      // Acid rolls once per contact cell, with the 2D dissolve probability.
      if(erodes){if(emscripten_random()>=0.75)return true;}
      else if(emscripten_random()>(m==LAVA?0.6:0.12))continue;
      set(n.x,n.y,n.z,erodes?(emscripten_random()<0.5?SMOKE:AIR):FIRE);
      if(erodes){++dissolved;if(emscripten_random()<0.4)set(c.x,c.y,c.z,AIR);}
      ++reactionEdits;++reactions;return true;
    }
    if(m==LAVA&&get(c.x,c.y+1,c.z)==AIR&&inside(c.x,c.y+1,c.z)) {
      active=true;if(apply&&emscripten_random()<0.001)set(c.x,c.y+1,c.z,FIRE);
    }
    return active;
  }
  void stepMaterials() {
    reactionEdits=0;
    auto active=std::move(fluidCells);fluidCells.clear();fluidCells.reserve(active.size());
    for(int i:active)fluidQueued.erase(i);
    // Deferred cells go first next tick, so sustained pouring cannot starve them.
    size_t count=std::min(active.size(),size_t(24000));
    for(size_t j=count;j<active.size();++j)if(flowing(raw(active[j])))queueFluid(active[j]);
    int phase=int(emscripten_random()*4);
    const Cell sides[4]={{1,0,0},{0,0,1},{-1,0,0},{0,0,-1}};
    for(size_t j=0;j<count;++j) {
      int i=active[j];uint8_t m=raw(i);if(!flowing(m)||fluidQueued.contains(i))continue;
      Cell c=decode(i);bool keep=reactMaterial(c,m,(phase+int(j))%6,false);
      if(gas(m)) {
        double decay=emscripten_random();
        if(m==STEAM&&(decay<0.003||c.y==H-1)){set(c.x,c.y,c.z,WATER);continue;}
        if(m==SMOKE&&decay<0.015){set(c.x,c.y,c.z,AIR);continue;}
        if(m==FIRE&&decay<0.045){set(c.x,c.y,c.z,SMOKE);continue;}
      }
      if(m==LAVA&&tick%6!=0){queueFluid(i);continue;}
      auto empty=[&](Cell p){return inside(p.x,p.y,p.z)&&!occupied[address(p.x,p.y,p.z)]&&get(p.x,p.y,p.z)==AIR;};
      auto move=[&](Cell p){auto displaced=get(p.x,p.y,p.z);set(c.x,c.y,c.z,displaced);set(p.x,p.y,p.z,m);c=p;};
      bool moved=false;
      for(int fall=0;fall<(gas(m)||m==LAVA?1:3);++fall) {
        Cell p{c.x,c.y+(gas(m)?1:-1),c.z};if(!inside(p.x,p.y,p.z)||occupied[address(p.x,p.y,p.z)])break;
        auto other=get(p.x,p.y,p.z);
        if(other!=AIR&&!(liquid(m)&&(gas(other)||(liquid(other)&&density(other)<density(m)))))break;
        move(p);moved=true;
      }
      if(!moved&&liquid(m)) {
        Cell destination=c;int bestDistance=INT_MAX;
        int first=(c.x*3+c.z*5+c.y)&7;
        // Look ahead for a lower outlet, but flow across every intervening
        // shelf cell. Settled surfaces have no outlet and stay still.
        for(int k=0;k<8;++k) {
          auto side=liquidSides[(first+k)&7];Cell previous=c;
          for(int reach=1;reach<=liquidReach(m);++reach) {
            Cell p{c.x+side.x*reach,c.y,c.z+side.z*reach};
            if(!empty(p))break;
            if(side.x&&side.z&&(!empty({p.x,p.y,previous.z})||!empty({previous.x,p.y,p.z})))break;
            Cell drop{p.x,p.y-1,p.z};
            if(empty(drop)) {
              int distance=reach*reach*(side.x*side.x+side.z*side.z);
              if(distance<bestDistance) {
                bestDistance=distance;
                destination=reach==1?drop:Cell{c.x+side.x,c.y,c.z+side.z};
              }
              break;
            }
            previous=p;
          }
        }
        if(bestDistance!=INT_MAX){move(destination);moved=true;}
      }
      if(!moved&&gas(m))for(int k=0;k<4&&!moved;++k) {
        auto side=sides[(phase+int(j)+k)%4];Cell destination=c;
        Cell p{c.x+side.x,c.y,c.z+side.z};
        if(empty(p)) {
          destination=p;
          Cell rise{p.x,p.y+1,p.z};if(empty(rise))destination=rise;
        }
        if(destination.x!=c.x||destination.y!=c.y||destination.z!=c.z){move(destination);moved=true;}
      }
      if(!moved&&(keep||gas(m)))queueFluid(i);
    }
    // Reactions use the current contacts after flow, independently of which
    // particles moved or were woken. A fixed snapshot excludes reaction products.
    const auto contacts=fluidCells;
    size_t start=contacts.empty()?0:reactionCursor%contacts.size();
    size_t checks=std::min(contacts.size(),size_t(24000));
    reactionCursor=start+checks;
    bool full=false;
    for(size_t k=0;k<checks;++k) {
      size_t j=(start+k)%contacts.size();int i=contacts[j];auto m=raw(i);
      if(flowing(m))reactMaterial(decode(i),m,(phase+int(j))%6);
      // Resume at the first contact beyond this pass's structural edit budget.
      if(!full&&reactionEdits>=REACTION_EDIT_BUDGET){reactionCursor=j+1;full=true;}
    }
    if(!edits.empty())detachUnsupported();
    else editOriginals.clear();
  }
  void erodeBodies() {
    if(!materialCounts[ACID]&&!materialCounts[LAVA]&&!materialCounts[FIRE])return;
    std::vector<int> changed;
    for(int slot=0;slot<int(bodies.size());++slot) {
      auto& b=bodies[slot];if(!b.active)continue;auto tr=b3Body_GetTransform(b.id);int removed=0;
      int radius=std::max({b.size.x,b.size.y,b.size.z})+2;bool nearby=false;
      for(int z=int(std::floor((tr.p.z-radius)/C));z<=int(std::floor((tr.p.z+radius)/C))&&!nearby;++z)
        for(int y=int(std::floor((tr.p.y-radius)/C));y<=int(std::floor((tr.p.y+radius)/C))&&!nearby;++y)
          for(int x=int(std::floor((tr.p.x-radius)/C));x<=int(std::floor((tr.p.x+radius)/C));++x) {
            ChunkKey key{origin.x/C+x,origin.y/C+y,origin.z/C+z};const auto& c=chunks[VoxelWorld::slot(key)];
            if(c.valid&&c.key==key&&(c.counts[ACID]||c.counts[LAVA]||c.counts[FIRE])){nearby=true;break;}
          }
      if(!nearby)continue;
      for(int y=0;y<b.size.y&&removed<32;++y)for(int z=0;z<b.size.z&&removed<32;++z)for(int x=0;x<b.size.x&&removed<32;++x) {
        auto& material=b.cells[localIndex(x,y,z)];if(!material)continue;
        bool boundary=false;
        for(auto d:neighbors) {
          int a=x+d.x,c=y+d.y,e=z+d.z;
          if(a<0||c<0||e<0||a>=b.size.x||c>=b.size.y||e>=b.size.z||!b.cells[localIndex(a,c,e)]){boundary=true;break;}
        }
        if(!boundary)continue;
        auto point=add(tr.p,b3RotateVector(tr.q,{x+0.5f,y+0.5f,z+0.5f}));
        Cell c{int(std::floor(point.x)),int(std::floor(point.y)),int(std::floor(point.z))};
        for(auto n:neighbors) {
          Cell p{c.x+n.x,c.y+n.y,c.z+n.z};auto m=get(p.x,p.y,p.z);
          bool acid=m==ACID&&dissolvable(material),burn=(m==LAVA||m==FIRE)&&flammable(material);
          if((!acid&&!burn)||emscripten_random()>0.2)continue;
          material=AIR;++removed;++reactions;if(acid)++dissolved;
          if(acid&&emscripten_random()<0.4)set(p.x,p.y,p.z,AIR);
          if(inside(c.x,c.y,c.z)&&get(c.x,c.y,c.z)==AIR)set(c.x,c.y,c.z,acid?SMOKE:FIRE);
          break;
        }
      }
      if(removed)changed.push_back(slot);
    }
    for(int slot:changed)rebuildBody(slot);
  }
