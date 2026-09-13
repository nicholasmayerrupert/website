R"GLSL(
uniform int lightCount;
uniform vec4 lightPosition[24];
uniform vec4 lightColor[24];

bool opaqueMaterial(uint material) {
  return material!=0u&&material!=8u&&material!=9u&&material!=11u&&material!=12u&&material!=14u;
}
float ambientCell(vec3 position,int slot,vec3 localPosition) {
  if(slot>=0) {
    ivec3 c=ivec3(floor(localPosition));
    if(all(greaterThanEqual(c,ivec3(0)))&&all(lessThan(c,ivec3(64)))) {
      if(opaqueMaterial(texelFetch(bodies,ivec2(c.x+64*c.z,c.y+64*slot),0).r))return 1.0;
    }
  }
  for(int level=0;level<4;++level) {
    ivec3 c=ivec3(floor((position-gridOrigin[level].xyz)/gridOrigin[level].w));
    if(any(lessThan(c,ivec3(0)))||any(greaterThanEqual(c,dimensions(level))))continue;
    return opaqueMaterial(gridCell((c+gridOffset[level])%dimensions(level),level))?1.0:0.0;
  }
  return 0.0;
}
float surfaceOcclusion(vec3 p,vec3 normal,int slot,vec3 localP,vec3 localN) {
  vec3 tangent=normalize(abs(normal.y)<.9?cross(normal,vec3(0,1,0)):cross(normal,vec3(0,0,1)));
  vec3 bitangent=cross(normal,tangent);
  vec3 localT=normalize(abs(localN.y)<.9?cross(localN,vec3(0,1,0)):cross(localN,vec3(0,0,1)));
  vec3 localB=cross(localN,localT);
  float scale=1.0;
  if(slot<0)for(int level=0;level<4;++level) {
    vec3 c=(p-gridOrigin[level].xyz)/gridOrigin[level].w;
    if(all(greaterThanEqual(c,vec3(0)))&&all(lessThan(c,vec3(dimensions(level))))){scale=gridOrigin[level].w;break;}
  }
  vec3 outside=p+normal*scale*.55,localOutside=localP+localN*.55;
  float blocked=ambientCell(outside+tangent*scale,slot,localOutside+localT)
    +ambientCell(outside-tangent*scale,slot,localOutside-localT)
    +ambientCell(outside+bitangent*scale,slot,localOutside+localB)
    +ambientCell(outside-bitangent*scale,slot,localOutside-localB);
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
vec3 sceneIllumination(vec3 p,vec3 normal,int slot,vec3 localP,vec3 localN) {
  float diffuse=max(dot(normal,sun),0.0);
  float shade=diffuse>.01&&lightBlocked(p+normal*.025,sun,400.0)?0.0:1.0;
  float skyVisibility=1.0;
  if(shade<.5||diffuse<=.01||normal.y<-.1)
    skyVisibility=lightBlocked(p+normal*.025,vec3(0,1,0),256.0)?.18:1.0;
  vec3 ambient=mix(vec3(.24,.23,.19),vec3(.40,.51,.62),normal.y*.5+.5);
  ambient*=skyVisibility*surfaceOcclusion(p,normal,slot,localP,localN);
  return ambient+vec3(1.0,.87,.68)*diffuse*shade+emissiveIllumination(p,normal);
}
)GLSL"
