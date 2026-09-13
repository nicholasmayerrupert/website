R"GLSL(
uniform int lightCount;
uniform vec4 lightPosition[24];
uniform vec4 lightColor[24];

bool opaqueMaterial(uint material) {
  return material!=0u&&material!=8u&&material!=9u&&material!=11u&&material!=12u&&material!=14u;
}
float ambientCell(vec3 position) {
  for(int level=0;level<4;++level) {
    ivec3 c=ivec3(floor((position-gridOrigin[level].xyz)/gridOrigin[level].w));
    if(any(lessThan(c,ivec3(0)))||any(greaterThanEqual(c,dimensions(level))))continue;
    if(opaqueMaterial(gridCell((c+gridOffset[level])%dimensions(level),level)))return 1.0;
    break;
  }
  for(int i=0;i<256;++i) {
    if(i>=bodyCount)break;
    vec4 q=bodyRotation[i];
    ivec3 c=ivec3(floor(rotateQ(vec4(-q.xyz,q.w),position-bodyPosition[i].xyz)));
    if(any(lessThan(c,ivec3(0)))||any(greaterThanEqual(c,ivec3(bodySize[i].xyz))))continue;
    int slot=int(bodyPosition[i].w);
    if(opaqueMaterial(texelFetch(bodies,ivec3(c.x+64*c.z,c.y+64*(slot%32),slot/32),0).r))return 1.0;
  }
  return 0.0;
}
float surfaceOcclusion(vec3 p,vec3 normal) {
  vec3 tangent=normalize(abs(normal.y)<.9?cross(normal,vec3(0,1,0)):cross(normal,vec3(0,0,1)));
  vec3 bitangent=cross(normal,tangent);
  float scale=1.0;
  for(int level=0;level<4;++level) {
    vec3 c=(p-gridOrigin[level].xyz)/gridOrigin[level].w;
    if(all(greaterThanEqual(c,vec3(0)))&&all(lessThan(c,vec3(dimensions(level))))){scale=gridOrigin[level].w;break;}
  }
  vec3 outside=p+normal*scale*.55;
  float blocked=0.0;
  for(int i=0;i<4;++i) {
    vec3 offset=i<2?tangent:bitangent;
    blocked+=ambientCell(outside+offset*(i%2==0?scale:-scale));
  }
  return 1.0-blocked*.085;
}
bool lightBlocked(vec3 origin,vec3 direction,float limit) {
  float distance;vec3 normal,localP;ivec3 cell;uint material;int slot;
  return traceScene(origin,direction,limit,true,distance,normal,cell,material,slot,localP);
}
vec3 emissiveIllumination(vec3 p,vec3 normal) {
  int first=-1,second=-1;float strongest=0.0,next=0.0;
  for(int i=0;i<24;++i) {
    if(i>=lightCount)break;
    vec3 delta=lightPosition[i].xyz-p;float distance=length(delta),radius=lightPosition[i].w;
    if(distance>=radius)continue;
    float falloff=1.0-distance/radius;
    float strength=lightColor[i].w*falloff*falloff*max(dot(normal,delta/max(distance,.01)),0.0);
    if(strength>strongest){second=first;next=strongest;first=i;strongest=strength;}
    else if(strength>next){second=i;next=strength;}
  }
  vec3 result=vec3(0.0);
  for(int k=0;k<2;++k) {
    int i=k==0?first:second;float strength=k==0?strongest:next;
    if(i<0||strength<.006)continue;
    vec3 delta=lightPosition[i].xyz-(p+normal*.025);float distance=length(delta);
    if(!lightBlocked(p+normal*.025,delta/max(distance,.01),max(distance-.08,0.0)))
      result+=lightColor[i].rgb*strength;
  }
  return result;
}
float skyCoverage(vec3 origin,vec3 direction) {
  float distance;vec3 normal,localP;ivec3 cell;uint material;int slot;
  if(!traceScene(origin,direction,96.0,true,distance,normal,cell,material,slot,localP))return 0.0;
  return 1.0-smoothstep(0.0,96.0,distance);
}
vec3 sceneIllumination(vec3 p,vec3 normal,int slot,vec3 localP,vec3 localN) {
  float diffuse=max(dot(normal,sun),0.0);
  float shade=1.0;
  if(diffuse>.01) {
    shade=0.0;
    for(int i=0;i<2;++i) {
      vec3 spread=vec3(-.4472,0.0,-.8944)*(i==0?.018:-.018);
      shade+=lightBlocked(p+normal*.025,normalize(sun+spread),400.0)?0.0:.5;
    }
  }
  // All ambient probes trace the same terrain and moving-body geometry.
  // Fixed directions and distance weighting keep the illumination stable.
  vec3 probe=p+normal*.025;
  float coverage=0.0;
  for(int i=0;i<3;++i) {
    vec3 direction=i==0?vec3(0,1,0):i==1?normalize(vec3(.65,.75,.1)):normalize(vec3(-.3,.75,-.55));
    coverage+=skyCoverage(probe,direction)/3.0;
  }
  float skyVisibility=1.0-.42*coverage;
  vec3 ambient=mix(vec3(.34,.35,.32),vec3(.44,.55,.65),normal.y*.5+.5);
  ambient*=skyVisibility*surfaceOcclusion(p,normal);
  ambient+=vec3(.12,.11,.085)*diffuse*(1.0-shade);
  return ambient+vec3(1.0,.87,.68)*diffuse*shade+emissiveIllumination(p,normal);
}
)GLSL"
