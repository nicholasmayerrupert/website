#pragma once
#include <GLES3/gl3.h>
#include <emscripten/html5.h>
#include <cstdio>

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
uniform vec2 resolution;
uniform vec3 eye, forward, rightward, upward;
uniform int bodyCount;
uniform vec4 bodyPosition[32];
uniform vec4 bodyRotation[32];
uniform vec4 bodySize[32];
uniform vec4 target;
uniform int targetBody;
out vec4 color;
const vec3 worldSize = vec3(64.0, 40.0, 64.0);
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
uint cellAt(ivec3 p, int slot) {
  if (slot < 0) return texelFetch(terrain, p, 0).r;
  return texelFetch(bodies, ivec2(p.x + 16*p.z, p.y + 16*slot), 0).r;
}
bool traceGrid(vec3 o, vec3 direction, vec3 size, int slot, float limit,
               out float distance, out vec3 normal, out ivec3 cell, out uint material) {
  vec3 d = safeDirection(direction);
  float t, endT;
  if (!boxHit(o,d,size,t,endT)) return false;
  t = max(t,0.0) + 0.0002;
  endT = min(endT,limit);
  normal = -normalize(d);
  for (int iteration = 0; iteration < 240; ++iteration) {
    if (t > endT) break;
    vec3 p = o + t*d;
    cell = ivec3(floor(p));
    if (any(lessThan(cell,ivec3(0))) || any(greaterThanEqual(cell,ivec3(size)))) break;
    material = cellAt(cell,slot);
    if (material != 0u) { distance=t; return true; }
    float stride = 1.0;
    if (slot < 0 && texelFetch(occupancy,cell/4,0).r == 0u) stride = 4.0;
    vec3 lo = floor(p / stride) * stride;
    vec3 boundary = lo + step(vec3(0), d) * stride;
    vec3 next = (boundary-o)/d;
    float nt = min(min(next.x,next.y),next.z);
    normal = next.x <= next.y && next.x <= next.z ? vec3(-sign(d.x),0,0)
           : next.y <= next.z ? vec3(0,-sign(d.y),0) : vec3(0,0,-sign(d.z));
    t = max(nt + 0.0002,t + 0.0002);
  }
  return false;
}
vec3 palette(uint m) {
  if(m==1u) return vec3(0.79,0.61,0.32);
  if(m==2u) return vec3(0.25,0.38,0.41);
  if(m==3u) return vec3(0.40,0.52,0.51);
  if(m==4u) return vec3(0.42,0.26,0.15);
  if(m==5u) return vec3(0.34,0.48,0.25);
  if(m==6u) return vec3(0.72,0.41,0.21);
  if(m==7u) return vec3(0.35,0.64,0.50);
  return vec3(0.12,0.16,0.19);
}
void main() {
  vec2 uv = (gl_FragCoord.xy*2.0-resolution)/resolution.y;
  vec3 d = normalize(forward + 0.62*(uv.x*rightward + uv.y*upward));
  vec3 sky = mix(vec3(0.64,0.75,0.76),vec3(0.18,0.33,0.41),clamp(d.y*1.4,0.0,1.0));
  sky += vec3(1.0,0.81,0.52)*pow(max(dot(d,sun),0.0),300.0)*0.8;
  float best=160.0,t;
  vec3 n, bestN=vec3(0), localP=vec3(0);
  ivec3 cell, bestCell=ivec3(0);
  uint mat=0u,m;
  int hitSlot=-1;
  if(traceGrid(eye,d,worldSize,-1,best,t,n,cell,m)) {
    best=t; bestN=n; bestCell=cell; mat=m; localP=eye+t*d;
  }
  for(int i=0;i<32;++i) {
    if(i>=bodyCount) break;
    vec4 q=bodyRotation[i];
    vec3 o=rotateQ(vec4(-q.xyz,q.w),eye-bodyPosition[i].xyz);
    vec3 rd=rotateQ(vec4(-q.xyz,q.w),d);
    int slot=int(bodyPosition[i].w);
    if(traceGrid(o,rd,bodySize[i].xyz,slot,best,t,n,cell,m)) {
      best=t; bestN=rotateQ(q,n); bestCell=cell; mat=m; hitSlot=slot; localP=o+t*rd;
    }
  }
  if(mat==0u) { color=vec4(sky,1); return; }
  vec3 p=eye+d*best;
  float grain=fract(sin(dot(vec3(bestCell),vec3(12.9898,78.233,37.719)))*43758.5453);
  vec3 base=palette(mat)*(0.90+grain*0.19);
  if(mat==4u) base*=0.87+0.13*sin(localP.y*4.0+localP.z*0.7);
  float diffuse=max(dot(bestN,sun),0.0);
  float shade=1.0;
  if(diffuse>0.01) {
    if(traceGrid(p+bestN*0.015,sun,worldSize,-1,65.0,t,n,cell,m)) shade=0.22;
    if(shade>0.5) for(int i=0;i<32;++i) {
      if(i>=bodyCount) break;
      vec4 q=bodyRotation[i];
      vec3 o=rotateQ(vec4(-q.xyz,q.w),p+bestN*0.015-bodyPosition[i].xyz);
      if(traceGrid(o,rotateQ(vec4(-q.xyz,q.w),sun),bodySize[i].xyz,int(bodyPosition[i].w),65.0,t,n,cell,m)) { shade=0.22; break; }
    }
  }
  vec3 lighting=vec3(0.43,0.53,0.60)*(0.70+0.30*max(bestN.y,0.0)) + vec3(1.0,0.87,0.66)*diffuse*shade;
  vec3 result=base*lighting;
  if(target.w>0.0 && hitSlot==targetBody && all(equal(bestCell,ivec3(target.xyz)))) {
    vec3 f=fract(localP+bestN*0.001);
    vec3 edge=min(f,1.0-f);
    float border= (edge.x<0.035?1.0:0.0)+(edge.y<0.035?1.0:0.0)+(edge.z<0.035?1.0:0.0);
    result=mix(result,vec3(1.0,0.86,0.50),border>=2.0?0.95:0.12);
  }
  float fog=1.0-exp(-best*best*0.00012);
  result=mix(result,sky,min(fog,0.85));
  result=pow(result,vec3(0.90));
  vec2 screen=gl_FragCoord.xy/resolution;
  result*=0.86+0.14*pow(16.0*screen.x*screen.y*(1.0-screen.x)*(1.0-screen.y),0.20);
  color=vec4(result,1);
}
)GLSL";

struct Renderer {
  EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context = 0;
  GLuint program=0, vao=0, textures[3]{};
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
    glGenTextures(3,textures);
    const char* names[]={"terrain","occupancy","bodies"};
    for(int i=0;i<3;++i) {
      glActiveTexture(GL_TEXTURE0+i);
      GLenum type=i<2?GL_TEXTURE_3D:GL_TEXTURE_2D;
      glBindTexture(type,textures[i]);
      glTexParameteri(type,GL_TEXTURE_MIN_FILTER,GL_NEAREST); glTexParameteri(type,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
      glTexParameteri(type,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE); glTexParameteri(type,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
      if(i<2) { glTexParameteri(type,GL_TEXTURE_WRAP_R,GL_CLAMP_TO_EDGE); glTexStorage3D(type,1,GL_R8UI,i==0?64:16,i==0?40:10,i==0?64:16); }
      else glTexStorage2D(type,1,GL_R8UI,256,512);
      glUniform1i(glGetUniformLocation(program,names[i]),i);
    }
    glPixelStorei(GL_UNPACK_ALIGNMENT,1);
    return true;
  }
  GLint uniform(const char* name) { return glGetUniformLocation(program,name); }
  void destroy() {
    if(context>0) {
      emscripten_webgl_make_context_current(context);
      glDeleteTextures(3,textures); glDeleteVertexArrays(1,&vao); glDeleteProgram(program);
      emscripten_webgl_destroy_context(context); context=0;
    }
  }
};
