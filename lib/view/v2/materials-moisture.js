import {Vector4} from 'three'
import {v2SurfaceNoise} from './materials-weathering.js'

export const V2_MOISTURE = Object.freeze({strength:1, diffuseReduction:.5, roughnessFloor:.32, roughnessMultiplier:.38, maxLeaks:4})

/** Static map-space controls; neither authored objects nor gameplay are changed. */
export function createV2MoistureUniforms(map) {
  const leaks=Array.from({length:V2_MOISTURE.maxLeaks},()=>new Vector4(0,0,0,0))
  for(const [i,p] of (map?.environment?.vents || []).slice(0,leaks.length).entries()) {
    if([p.x,p.y,p.z].every(Number.isFinite)) leaks[i].set(p.x,p.y,p.z,1)
  }
  // Largest walkable roof: bounded edge drainage, using the real authored footprint.
  const roofs=(map?.colliders || []).filter(c=>c.kind==='floor' && /roof/.test(c.id) && c.center && c.size)
  const grade=(map?.colliders || []).find(c=>c.id==='ground' && c.kind==='floor')
  const roof=roofs.reduce((a,b)=>!a || b.size.x*b.size.z>a.size.x*a.size.z ? b : a,null)
  return {
    v2MoistureControls:{value:new Vector4(V2_MOISTURE.strength,V2_MOISTURE.diffuseReduction,V2_MOISTURE.roughnessFloor,V2_MOISTURE.roughnessMultiplier)},
    v2MoistureLeaks:{value:leaks},
    v2MoistureRoof:{value:roof ? new Vector4(roof.center.x,roof.center.z,roof.size.x/2,roof.size.z/2) : new Vector4()},
    v2MoistureGradeY:{value:grade ? grade.center.y+grade.size.y/2 : 0},
    v2MoistureRoofY:{value:roof ? roof.center.y+roof.size.y/2 : -1e4},
  }
}

const clamp=x=>Math.max(0,Math.min(1,x))
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)}
/** CPU probe for deterministic bounds/coverage; AO is a crevice proxy, not height. */
export function sampleV2Moisture(p,ao,uniforms,up=1) {
  let supply=0
  for(const s of uniforms.v2MoistureLeaks.value) {
    const fall=s.y-p[1],dx=(p[0]-s.x)*.48,dz=(p[2]-s.z)*.25
    supply=Math.max(supply,s.w*smooth(-.1,.3,fall)*(1-smooth(3.6,5.2,fall))/(1+dx*dx+dz*dz))
  }
  const r=uniforms.v2MoistureRoof.value
  const edge=Math.min(r.z-Math.abs(p[0]-r.x),r.w-Math.abs(p[2]-r.y))
  if(Math.abs(p[1]-uniforms.v2MoistureRoofY.value)<.18 && edge>0) supply=Math.max(supply,.38*(1-smooth(.25,1.6,edge)))
  const a=v2SurfaceNoise([p[0]*.23+9.7,p[1]*.11+3.1,p[2]*.27+17.3])
  const b=v2SurfaceNoise([p[0]*.61+21.7,p[1]*.13+7.9,p[2]*.53+4.3])
  const field=.65*a+.35*b
  const elevated=smooth(.8,2.,p[1]-uniforms.v2MoistureGradeY.value)
  const retention=.15+.85*smooth(.1,.55,1-ao)
  return smooth(.54-supply*.20,.70-supply*.17,field)*retention*(1-elevated*.78)*uniforms.v2MoistureControls.value.x*clamp(up)
}

/** Compose after the existing ground photo layer. No normal/UV/AO rewrite. */
export function patchV2MoistureShader(shader,uniforms) {
  Object.assign(shader.uniforms,uniforms)
  shader.fragmentShader=`
    uniform vec4 v2MoistureControls;
    uniform vec4 v2MoistureLeaks[4];
    uniform vec4 v2MoistureRoof;
    uniform float v2MoistureRoofY;
    uniform float v2MoistureGradeY;
    float v2Noise(vec3 p);
    float v2MoistureField(vec3 p,float ao) {
      float supply=0.;
      for(int i=0;i<4;i++) {
        vec4 source=v2MoistureLeaks[i];
        float fall=source.y-p.y;
        vec2 delta=(p.xz-source.xz)*vec2(.48,.25);
        // A soft supply gradient shapes the irregular field, never a circular decal.
        supply=max(supply,source.w*smoothstep(-.1,.3,fall)*(1.-smoothstep(3.6,5.2,fall))/(1.+dot(delta,delta)));
      }
      vec2 inward=v2MoistureRoof.zw-abs(p.xz-v2MoistureRoof.xy);
      float edge=min(inward.x,inward.y);
      if(abs(p.y-v2MoistureRoofY)<.18 && edge>0.) supply=max(supply,.38*(1.-smoothstep(.25,1.6,edge)));
      // Two metre-scale continuous fields. No relief, tiny noise, time or camera input.
      float field=.65*v2Noise(p*vec3(.23,.11,.27)+vec3(9.7,3.1,17.3))
                 +.35*v2Noise(p*vec3(.61,.13,.53)+vec3(21.7,7.9,4.3));
      float v2DampRegion=smoothstep(.54-supply*.20,.70-supply*.17,field);
      // Exposed elevated slabs drain: they must not inherit low-ground pooling.
      // Photo AO confines lower roughness to actual crevices; dry grains dominate.
      float elevated=smoothstep(.8,2.,p.y-v2MoistureGradeY);
      float retention=.15+.85*smoothstep(.1,.55,1.-ao);
      return v2DampRegion*retention*(1.-elevated*.78)*v2MoistureControls.x;
    }
  `+shader.fragmentShader
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
    float v2Moisture=0.;
    if(v2Up>0.) v2Moisture=v2MoistureField(vV2SurfacePosition,v2GroundPacked.r)*v2Up;
    diffuseColor.rgb*=1.-v2Moisture*v2MoistureControls.y;
    #include <color_fragment>
  `)
  shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>',`
    roughnessFactor=mix(roughnessFactor,min(roughnessFactor,max(v2MoistureControls.z,roughnessFactor*v2MoistureControls.w)),v2Moisture);
    #include <metalnessmap_fragment>
  `)
}
