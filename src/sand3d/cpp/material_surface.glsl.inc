R"GLSL(
// Detail uses voxel coordinates: terrain stays world-anchored and moving bodies
// use their local frame. The footprint filters features before they get subpixel.
float surfaceHash(vec2 p) {
  p=mod(p,64.0);
  vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float surfaceNoise(vec2 p) {
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(surfaceHash(i),surfaceHash(i+vec2(1,0)),f.x),
             mix(surfaceHash(i+vec2(0,1)),surfaceHash(i+vec2(1,1)),f.x),f.y);
}
float surfaceDetail(float footprint,float frequency) {
  return 1.0-smoothstep(.25,1.0,footprint*frequency);
}
vec3 materialAlbedo(uint mat,vec3 p,vec3 normal,float footprint) {
  vec3 base=palette(mat);
  vec3 an=abs(normal);
  vec2 face=an.y>.5?p.xz:an.x>.5?p.zy:p.xy;
  float broad=mix(.5,surfaceNoise(face*.0625),surfaceDetail(footprint,.0625));
  float grain=(surfaceHash(floor(face))-.5)*surfaceDetail(footprint,1.0);
  base*=.94+.12*broad+.075*grain;
  if(mat==1u||mat==13u) {
    float ripple=sin(p.x*.785398+p.z*.392699+surfaceNoise(p.xz*.03125)*3.0);
    base*=1.0+.065*ripple*surfaceDetail(footprint,.25);
    base+=vec3(.08,.065,.035)*max(grain,0.0);
  } else if(mat==2u||mat==3u) {
    float mineral=mix(.5,surfaceNoise(face*.25),surfaceDetail(footprint,.25));
    float strata=sin(p.y*.785398+broad*4.0);
    base*=.88+.18*mineral+.06*strata*surfaceDetail(footprint,.125);
    float vein=smoothstep(.72,.84,broad);
    base=mix(base,vec3(.53,.56,.49),vein*.23);
  } else if(mat==4u) {
    float grainLine=sin((p.x+p.z)*3.141593+surfaceNoise(vec2(p.x+p.z,p.y*.0625))*.9);
    if(an.y>.5)grainLine=sin(length(mod(p.xz,16.0)-8.0)*2.356194);
    base*=.83+.20*broad+.16*grainLine*surfaceDetail(footprint,.5);
  } else if(mat==5u) {
    vec3 turf=mix(vec3(.27,.40,.19),vec3(.39,.51,.27),.25+.5*broad);
    if(normal.y>.5) {
      // Tapered surface blades and their wind sweep are cosmetic; the hit
      // remains the grass voxel, including on mined or detached terrain.
      vec2 bladeP=p.xz*1.5;
      vec2 root=floor(bladeP),f=fract(bladeP);
      float seed=surfaceHash(root);
      float wind=sin(simTime*1.4+(p.x+p.z)*.049087)*.10;
      float center=.3+seed*.4+(f.y-.15)*(seed-.5+wind);
      float width=mix(.12,.018,f.y);
      float aa=max(.018,footprint*1.5*.55);
      float blade=(1.0-smoothstep(width-aa,width+aa,abs(f.x-center)))*smoothstep(.02,.18,f.y);
      float visible=surfaceDetail(footprint,1.5);
      vec3 bladeColor=mix(vec3(.22,.35,.12),vec3(.43,.56,.25),f.y);
      base=mix(turf,bladeColor,blade*visible*.78);
      base*=1.0+grain*.055;
    } else {
      float crown=smoothstep(.58,.92,fract(p.y)+.12*(broad-.5));
      base=mix(turf*vec3(.82,.76,.70),turf,crown);
    }
  } else if(mat==7u) {
    base=mix(vec3(.18,.38,.22),vec3(.40,.59,.30),broad);
    float cluster=surfaceNoise(face*.5);
    base*=1.0+(cluster-.5)*.22*surfaceDetail(footprint,.5);
  } else if(mat==6u) {
    float patina=smoothstep(.53,.74,broad);
    base=mix(vec3(.70,.39,.19),vec3(.22,.46,.37),patina*.65);
    base*=.94+.10*grain;
  }
  return base;
}
)GLSL"
