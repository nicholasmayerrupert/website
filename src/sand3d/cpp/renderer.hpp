#pragma once
#include <GLES3/gl3.h>
#include <emscripten/html5.h>
#include <cstdio>
#include "voxel_clipmap.hpp"

static const char* vertexSource = R"GLSL(#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
)GLSL";

static const char* fragmentSource = R"GLSL(#version 300 es
precision highp float;
precision highp int;
precision highp usampler3D;
precision highp usampler2D;
uniform usampler3D terrain;
uniform usampler3D occupancy;
uniform usampler2D bodies;
uniform usampler3D midVoxels, midOccupancy, farVoxels, farOccupancy, horizonVoxels, horizonOccupancy;
uniform vec4 gridOrigin[4];
uniform ivec3 gridSize[4];
uniform ivec3 gridOffset[4];
uniform vec3 worldPhase;
uniform vec2 resolution;
uniform float simTime;
uniform vec3 eye, forward, rightward, upward;
uniform int bodyCount;
uniform vec4 bodyPosition[32];
uniform vec4 bodyRotation[32];
uniform vec4 bodySize[32];
uniform vec4 target;
uniform int targetBody;
out vec4 color;
const vec3 sun = vec3(-0.4364, 0.8729, 0.2182);

vec3 rotateQ(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec3 safeDirection(vec3 d) {
  return vec3(d.x < 0.0 ? min(d.x, -0.000001) : max(d.x, 0.000001),
              d.y < 0.0 ? min(d.y, -0.000001) : max(d.y, 0.000001),
              d.z < 0.0 ? min(d.z, -0.000001) : max(d.z, 0.000001));
}
bool boxHit(vec3 o, vec3 d, vec3 size, out float nearT, out float farT) {
  vec3 a = -o / d, b = (size - o) / d;
  vec3 lo = min(a,b), hi = max(a,b);
  nearT = max(max(lo.x,lo.y),lo.z);
  farT = min(min(hi.x,hi.y),hi.z);
  return farT >= max(nearT, 0.0);
}
ivec3 dimensions(int level) {return gridSize[level];}
uint gridCell(ivec3 p,int level) {
  if(level==0)return texelFetch(terrain,p,0).r;
  if(level==1)return texelFetch(midVoxels,p,0).r;
  if(level==2)return texelFetch(farVoxels,p,0).r;
  return texelFetch(horizonVoxels,p,0).r;
}
uint occupied(ivec3 p,int level,int mip) {
  if(level==0)return texelFetch(occupancy,p,mip).r;
  if(level==1)return texelFetch(midOccupancy,p,mip).r;
  if(level==2)return texelFetch(farOccupancy,p,mip).r;
  return texelFetch(horizonOccupancy,p,mip).r;
}
bool traceGrid(vec3 o,vec3 direction,vec3 size,int slot,int level,float limit,bool transmit,
               out float distance,out vec3 normal,out ivec3 cell,out uint material) {
  vec3 d=safeDirection(direction);
  float t,endT;normal=-normalize(d);material=0u;distance=limit;cell=ivec3(0);
  if(!boxHit(o,d,size,t,endT))return false;
  t=max(t,0.0)+0.0002;endT=min(endT,limit);
  for(int iteration=0;iteration<1024;++iteration) {
    if(t>endT)break;
    vec3 p=o+t*d;cell=ivec3(floor(p));
    if(any(lessThan(cell,ivec3(0)))||any(greaterThanEqual(cell,ivec3(size))))break;
    if(slot<0&&level>0) {
      vec3 fine=(p*gridOrigin[level].w+gridOrigin[level].xyz-gridOrigin[level-1].xyz)/gridOrigin[level-1].w;
      vec3 fineSize=vec3(dimensions(level-1));
      if(all(greaterThanEqual(fine,vec3(0.0)))&&all(lessThan(fine,fineSize))) {
        float a,b;boxHit(fine,d,fineSize,a,b);
        t+=max(b*gridOrigin[level-1].w/gridOrigin[level].w,0.0)+0.0002;continue;
      }
    }
    float stride=1.0;ivec3 physical=cell;
    if(slot<0) {
      physical=(cell+gridOffset[level])%dimensions(level);
      if(occupied(physical/32,level,3)==0u)stride=32.0;
      else if(occupied(physical/16,level,2)==0u)stride=16.0;
      else if(occupied(physical/8,level,1)==0u)stride=8.0;
      else if(occupied(physical/4,level,0)==0u)stride=4.0;
    }
    if(stride==1.0) {
      material=slot<0?gridCell(physical,level):texelFetch(bodies,ivec2(cell.x+64*cell.z,cell.y+64*slot),0).r;
      if(material!=0u&&!(transmit&&(material==8u||material==9u||material==11u||material==12u||material==14u))){distance=t;return true;}
    }
    vec3 boundary=floor(p/stride)*stride+step(vec3(0.0),d)*stride;
    vec3 next=(boundary-o)/d;
    normal=next.x<=next.y&&next.x<=next.z?vec3(-sign(d.x),0.0,0.0):next.y<=next.z?vec3(0.0,-sign(d.y),0.0):vec3(0.0,0.0,-sign(d.z));
    t=max(min(min(next.x,next.y),next.z)+0.0002,t+0.0002);
  }
  return false;
}
bool traceWorld(vec3 o,vec3 d,float limit,bool transmit,out float hitT,out vec3 normal,out ivec3 cell,out uint material) {
  bool found=false;hitT=limit;normal=vec3(0);cell=ivec3(0);material=0u;
  for(int level=0;level<4;++level) {
    vec4 tr=gridOrigin[level];float t;vec3 n;ivec3 c;uint m;
    if(traceGrid((o-tr.xyz)/tr.w,d,vec3(dimensions(level)),-1,level,hitT/tr.w,transmit,t,n,c,m)) {
      hitT=t*tr.w;normal=n;cell=ivec3(vec3(c)*tr.w+tr.xyz);material=m;found=true;
    }
  }
  return found;
}
vec3 palette(uint m) {
  if(m==1u) return vec3(0.79,0.61,0.32);
  if(m==2u) return vec3(0.25,0.38,0.41);
  if(m==3u) return vec3(0.40,0.52,0.51);
  if(m==4u) return vec3(0.42,0.26,0.15);
  if(m==5u) return vec3(0.34,0.48,0.25);
  if(m==6u) return vec3(0.72,0.41,0.21);
  if(m==7u) return vec3(0.35,0.64,0.50);
  if(m==8u) return vec3(0.13,0.51,0.70);
  if(m==9u) return vec3(0.43,0.86,0.15);
  if(m==10u) return vec3(1.0,0.25,0.025);
  if(m==11u) return vec3(0.78,0.87,0.89);
  if(m==12u) return vec3(1.0,0.57,0.08);
  if(m==13u) return vec3(0.43,0.44,0.42);
  if(m==14u) return vec3(0.52,0.59,0.28);
  return vec3(0.12,0.16,0.19);
}
bool traceScene(vec3 rayOrigin,vec3 rayDirection,float limit,bool transmit,
                out float best,out vec3 bestN,out ivec3 bestCell,out uint mat,out int hitSlot,out vec3 localP) {
  float t;vec3 n;ivec3 cell;uint m;
  best=limit;bestN=vec3(0);bestCell=ivec3(0);mat=0u;hitSlot=-1;localP=vec3(0);
  if(traceWorld(rayOrigin,rayDirection,best,transmit,t,n,cell,m)) {
    best=t; bestN=n; bestCell=cell; mat=m; localP=rayOrigin+t*rayDirection;
  }
  for(int i=0;i<32;++i) {
    if(i>=bodyCount) break;
    vec4 q=bodyRotation[i];
    vec3 o=rotateQ(vec4(-q.xyz,q.w),rayOrigin-bodyPosition[i].xyz);
    vec3 rd=rotateQ(vec4(-q.xyz,q.w),rayDirection);
    int slot=int(bodyPosition[i].w);
    if(traceGrid(o,rd,bodySize[i].xyz,slot,0,best,transmit,t,n,cell,m)) {
      best=t; bestN=rotateQ(q,n); bestCell=cell; mat=m; hitSlot=slot; localP=o+t*rd;
    }
  }
  return mat!=0u;
}
void main() {
  vec2 uv = (gl_FragCoord.xy*2.0-resolution)/resolution.y;
  vec3 d = normalize(forward + 0.62*(uv.x*rightward + uv.y*upward));
  vec3 sky = mix(vec3(0.64,0.75,0.76),vec3(0.18,0.33,0.41),clamp(d.y*1.4,0.0,1.0));
  sky += vec3(1.0,0.81,0.52)*pow(max(dot(d,sun),0.0),300.0)*0.8;
  float best,t;vec3 bestN,localP,n;ivec3 bestCell,cell;uint mat,m;int hitSlot;
  traceScene(eye,d,1792.0,false,best,bestN,bestCell,mat,hitSlot,localP);
  if(mat==0u) { color=vec4(sky,1.0); return; }
  vec3 p=eye+d*best;
  float grain=fract(sin(dot(vec3(bestCell)+worldPhase,vec3(12.9898,78.233,37.719)))*43758.5453);
  vec3 base=palette(mat)*(0.90+grain*0.19);
  vec3 textureP=localP+(hitSlot<0?worldPhase:vec3(0.0));
  if(mat==4u) base*=0.87+0.13*sin(textureP.y*4.0+textureP.z*0.7);
  float diffuse=max(dot(bestN,sun),0.0);
  float shade=1.0;
  if(diffuse>0.01) {
    if(traceWorld(p+bestN*0.015,sun,400.0,true,t,n,cell,m)) shade=0.22;
    if(shade>0.5) for(int i=0;i<32;++i) {
      if(i>=bodyCount) break;
      vec4 q=bodyRotation[i];
      vec3 o=rotateQ(vec4(-q.xyz,q.w),p+bestN*0.015-bodyPosition[i].xyz);
      if(traceGrid(o,rotateQ(vec4(-q.xyz,q.w),sun),bodySize[i].xyz,int(bodyPosition[i].w),0,400.0,true,t,n,cell,m)) { shade=0.22; break; }
    }
  }
  vec3 lighting=vec3(0.43,0.53,0.60)*(0.70+0.30*max(bestN.y,0.0)) + vec3(1.0,0.87,0.66)*diffuse*shade;
  vec3 result=base*lighting;
  if(mat==8u||mat==9u||mat==11u||mat==12u||mat==14u) {
    float depth;vec3 behindN,behindP;ivec3 behindCell;uint behindM;int behindSlot;
    bool found=traceScene(p+d*0.04,d,128.0,true,depth,behindN,behindCell,behindM,behindSlot,behindP);
    vec3 behind=found?palette(behindM)*(0.50+0.65*max(dot(behindN,sun),0.0)):sky;
    if(behindM==10u)behind=vec3(1.0,0.35,0.025);
    bool fluid=mat==8u||mat==9u;
    float opacity=fluid?clamp(0.28+depth*0.014,0.28,0.83):mat==12u?0.62:mat==14u?0.35:0.23;
    result=mix(behind,result,opacity);
    if(fluid) {
      float ripple=sin(textureP.x*0.34+simTime*2.3)*cos(textureP.z*0.29-simTime*1.7);
      vec3 waterN=normalize(bestN+vec3(ripple*0.09,0.0,ripple*0.07));
      float spec=pow(max(dot(reflect(-sun,waterN),-d),0.0),48.0);
      result+=vec3(0.55,0.70,0.72)*spec+palette(mat)*ripple*0.035;
    }
  }
  if(mat==10u) {
    float crust=sin(textureP.x*.53+sin(textureP.z*.41)+simTime*.7)*sin(textureP.z*.57-simTime*.45);
    result=mix(vec3(0.25,0.065,0.025),vec3(1.15,0.40,0.025),smoothstep(-.45,.5,crust));
  }
  if(mat==12u)result=mix(result,vec3(1.1,0.55+0.15*sin(simTime*8.0+textureP.y),0.035),0.8);
  if(mat==9u)result+=vec3(0.025,0.06,0.005);
  if(target.w>0.0 && hitSlot==targetBody && all(equal(bestCell,ivec3(target.xyz)))) {
    vec3 f=fract(localP+bestN*0.001);
    vec3 edge=min(f,1.0-f);
    float border= (edge.x<0.035?1.0:0.0)+(edge.y<0.035?1.0:0.0)+(edge.z<0.035?1.0:0.0);
    result=mix(result,vec3(1.0,0.86,0.50),border>=2.0?0.95:0.12);
  }
  float fog=smoothstep(1280.0,1792.0,best);
  result=mix(result,sky,min(fog,1.0));
  result=pow(result,vec3(0.90));
  vec2 screen=gl_FragCoord.xy/resolution;
  result*=0.86+0.14*pow(16.0*screen.x*screen.y*(1.0-screen.x)*(1.0-screen.y),0.20);
  color=vec4(result,1);
}
)GLSL";

struct Renderer {
  EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context = 0;
  GLuint program=0,vao=0,textures[9]{};
  std::array<std::array<std::vector<uint8_t>,4>,4> occupancyData;
  VoxelClipmap mid{2,512,256,512},far{4,512,256,512},horizon{8,512,512,512};
  VoxelClipmap& clipmap(int level){return level==1?mid:level==2?far:horizon;}
  Cell dimensions(int level){if(!level)return {W,H,D};auto& map=clipmap(level);return {map.wide,map.high,map.deep};}
  int uploaded=0;
  void invalidateLod(){mid.invalidate();far.invalidate();horizon.invalidate();}
  template<class Chunk> void uploadChunk(const Chunk& c,int slot,int level) {
    auto size=dimensions(level);int wide=size.x,high=size.y,deep=size.z;
    int cw=wide/C,ch=high/C,cx=slot%cw,cy=(slot/cw)%ch,cz=slot/(cw*ch);
    int unit=level==0?0:level*2+1;
    glActiveTexture(GL_TEXTURE0+unit);glBindTexture(GL_TEXTURE_3D,textures[unit]);
    glTexSubImage3D(GL_TEXTURE_3D,0,cx*C,cy*C,cz*C,C,C,C,GL_RED_INTEGER,GL_UNSIGNED_BYTE,c.cells.data());
    glActiveTexture(GL_TEXTURE0+unit+1);glBindTexture(GL_TEXTURE_3D,textures[unit+1]);
    for(int mip=0;mip<4;++mip) {
      int scale=4<<mip,side=C/scale,w=wide/scale,h=high/scale;
      auto& occupancy=occupancyData[level][mip];if(occupancy.empty())occupancy.resize(w*h*(deep/scale));
      std::array<uint8_t,512> block{};
      for(int z=0;z<side;++z)for(int y=0;y<side;++y)for(int x=0;x<side;++x) {
        uint8_t filled=0;
        if(mip==0) {
          for(int k=0;k<scale&&!filled;++k)for(int j=0;j<scale&&!filled;++j)for(int a=0;a<scale;++a)
            if(c.cells[x*scale+a+C*(y*scale+j+C*(z*scale+k))]){filled=1;break;}
        }else {
          for(int k=0;k<2;++k)for(int j=0;j<2;++j)for(int a=0;a<2;++a)
            filled|=occupancyData[level][mip-1][(cx*side+x)*2+a+w*2*((cy*side+y)*2+j+h*2*((cz*side+z)*2+k))];
        }
        block[x+side*(y+side*z)]=filled;
        occupancy[cx*side+x+w*(cy*side+y+h*(cz*side+z))]=filled;
      }
      glTexSubImage3D(GL_TEXTURE_3D,mip,cx*side,cy*side,cz*side,side,side,side,GL_RED_INTEGER,GL_UNSIGNED_BYTE,block.data());
    }
    ++uploaded;
  }
  void uploadWorld(VoxelWorld& world) {
    uploaded=0;
    for(int level=1;level<4;++level)clipmap(level).update(world,1.25);world.renderChanges.clear();
    for(int i=0;i<CN;++i){auto& c=world.chunks[i];if(c.upload){uploadChunk(c,i,0);c.upload=false;}}
    for(int level=1;level<4;++level) {
      auto& map=clipmap(level);
      for(int i=0;i<map.count;++i){auto& c=map.chunks[i];if(c.upload){uploadChunk(c,i,level);c.upload=false;}}
    }
    float origins[16]{};int offsets[12]{},sizes[12]{};
    for(int level=0;level<4;++level) {
      auto o=level==0?world.origin:clipmap(level).origin;
      auto size=dimensions(level);int scale=1<<level,w=size.x,h=size.y,d=size.z;
      sizes[level*3]=w;sizes[level*3+1]=h;sizes[level*3+2]=d;
      origins[level*4]=float(o.x-world.origin.x);origins[level*4+1]=float(o.y-world.origin.y);origins[level*4+2]=float(o.z-world.origin.z);origins[level*4+3]=float(scale);
      offsets[level*3]=int((o.x/scale%w+w)%w);offsets[level*3+1]=int((o.y/scale%h+h)%h);offsets[level*3+2]=int((o.z/scale%d+d)%d);
    }
    glUniform4fv(uniform("gridOrigin[0]"),4,origins);glUniform3iv(uniform("gridOffset[0]"),4,offsets);
    glUniform3iv(uniform("gridSize[0]"),4,sizes);
    glUniform3f(uniform("worldPhase"),float(world.origin.x%4096),float(world.origin.y%4096),float(world.origin.z%4096));
  }
  bool init() {
    EmscriptenWebGLContextAttributes a;
    emscripten_webgl_init_context_attributes(&a);
    a.majorVersion=2; a.alpha=false; a.depth=false; a.antialias=false;
    a.powerPreference=EM_WEBGL_POWER_PREFERENCE_HIGH_PERFORMANCE;
    context=emscripten_webgl_create_context("#voxel-canvas",&a);
    if(context<=0) return false;
    emscripten_webgl_make_context_current(context);
    auto compile=[](GLenum type,const char* src) {
      GLuint s=glCreateShader(type); glShaderSource(s,1,&src,nullptr); glCompileShader(s);
      GLint ok; glGetShaderiv(s,GL_COMPILE_STATUS,&ok);
      if(!ok) { char msg[4096]; glGetShaderInfoLog(s,sizeof(msg),nullptr,msg); std::fprintf(stderr,"%s\n",msg); glDeleteShader(s); return GLuint(0); }
      return s;
    };
    GLuint v=compile(GL_VERTEX_SHADER,vertexSource), f=compile(GL_FRAGMENT_SHADER,fragmentSource);
    if(!v||!f) return false;
    program=glCreateProgram(); glAttachShader(program,v); glAttachShader(program,f); glLinkProgram(program);
    glDeleteShader(v); glDeleteShader(f);
    GLint ok; glGetProgramiv(program,GL_LINK_STATUS,&ok);
    if(!ok) { char msg[4096]; glGetProgramInfoLog(program,sizeof(msg),nullptr,msg); std::fprintf(stderr,"%s\n",msg); return false; }
    glUseProgram(program); glGenVertexArrays(1,&vao); glBindVertexArray(vao);
    glGenTextures(9,textures);
    const char* names[]={"terrain","occupancy","bodies","midVoxels","midOccupancy","farVoxels","farOccupancy","horizonVoxels","horizonOccupancy"};
    for(int i=0;i<9;++i) {
      glActiveTexture(GL_TEXTURE0+i);
      GLenum type=i==2?GL_TEXTURE_2D:GL_TEXTURE_3D;
      bool isOccupancy=i==1||i==4||i==6||i==8;
      glBindTexture(type,textures[i]);
      glTexParameteri(type,GL_TEXTURE_MIN_FILTER,isOccupancy?GL_NEAREST_MIPMAP_NEAREST:GL_NEAREST); glTexParameteri(type,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
      glTexParameteri(type,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE); glTexParameteri(type,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
      if(i==2)glTexStorage2D(type,1,GL_R8UI,B*B,B*MAX_BODIES);
      else {
        glTexParameteri(type,GL_TEXTURE_WRAP_R,GL_CLAMP_TO_EDGE);
        auto size=dimensions(i<2?0:(i-1)/2);int scale=isOccupancy?4:1,w=size.x,h=size.y,d=size.z;
        glTexStorage3D(type,isOccupancy?4:1,GL_R8UI,w/scale,h/scale,d/scale);
      }
      glUniform1i(glGetUniformLocation(program,names[i]),i);
    }
    glPixelStorei(GL_UNPACK_ALIGNMENT,1);
    return true;
  }
  GLint uniform(const char* name) { return glGetUniformLocation(program,name); }
  void destroy() {
    if(context>0) {
      emscripten_webgl_make_context_current(context);
      glDeleteTextures(9,textures); glDeleteVertexArrays(1,&vao); glDeleteProgram(program);
      emscripten_webgl_destroy_context(context); context=0;
    }
  }
};
