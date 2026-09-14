import {V2_WEATHERING_GLSL} from './materials-weathering.js'
import {V2_SUBSTRATE_GLSL} from './materials-substrate.js'

/** Photographic concrete with photographic crushed floor tops and imported prop PBR. */
export function patchV2SurfaceShader(shader, uniforms, settings = {}) {
  if (!shader.vertexShader.includes('#include <project_vertex>')) throw new Error('V2 materials: missing vertex hook project_vertex')
  for (const token of ['#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <normal_fragment_maps>']) {
    if (!shader.fragmentShader.includes(token)) throw new Error(`V2 materials: missing physical shader hook ${token}`)
  }
  Object.assign(shader.uniforms, uniforms)
  const photo = uniforms.v2Response?.value.y > 0
  const ground = uniforms.v2Response?.value.x === 1
  if (!photo) return // selected imported props/rubble: completely native shader
  shader.vertexShader = 'varying vec3 vV2SurfacePosition;\nvarying vec3 vV2SurfaceNormal;\n'+shader.vertexShader
  shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', /* glsl */`
    #include <project_vertex>
    vec4 v2World=vec4(transformed,1.);
    #ifdef USE_BATCHING
      v2World = batchingMatrix * v2World;
    #endif
    #ifdef USE_INSTANCING
      v2World = instanceMatrix * v2World;
    #endif
    vV2SurfacePosition=(modelMatrix*v2World).xyz;
    vV2SurfaceNormal=inverseTransformDirection(transformedNormal,viewMatrix);
  `)
  shader.fragmentShader = /* glsl */`
    varying vec3 vV2SurfacePosition;
    varying vec3 vV2SurfaceNormal;
    uniform sampler2D v2Albedo; uniform sampler2D v2PhotoNormal; uniform sampler2D v2Surface; uniform vec3 v2BaseColor; uniform vec4 v2Response;
    ${ground ? V2_WEATHERING_GLSL+V2_SUBSTRATE_GLSL+'uniform sampler2D v2SoffitAlbedo; uniform sampler2D v2SoffitNormal; uniform sampler2D v2SoffitSurface;' : ''}
  `+shader.fragmentShader
  const orientation = /* glsl */`
    vec3 v2Geom=normalize(cross(dFdx(vV2SurfacePosition),dFdy(vV2SurfacePosition)));
    v2Geom*=dot(v2Geom,vV2SurfaceNormal)<0. ? -1. : 1.;
    float v2Up=smoothstep(.5,.95,v2Geom.y);
    float v2Down=smoothstep(.5,.95,-v2Geom.y);
    float v2Surviving=${settings.spall ? (settings.masked ? '1.-clamp(vV2FractureMask,0.,1.)' : '0.') : '1.'};
  `
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', /* glsl */`
    #include <map_fragment>
    ${orientation}
    // Shared box slots keep photographed concrete on sides/undersides and a
    // distinct packed demolition substrate on upward floor/roof faces only.
    float v2Coverage=v2Response.y*${ground ? '(1.-v2Up)' : '1.'};
    vec3 v2GroundN=vec3(0,0,1), v2GroundPacked=vec3(1,1,0);
    float v2Dust=0.;
    ${ground ? `
      if(v2Up>0.) {
        vec3 v2GroundColor;
        v2SampleSubstrate(vV2SurfacePosition,v2GroundColor,v2GroundN,v2GroundPacked,v2Dust);
        // Original source color/maps remain borrowed unchanged. Only this runtime
        // top-face shader substitutes the newly authorized photographic substrate.
        diffuseColor.rgb=mix(diffuseColor.rgb,v2GroundColor,v2Up);
      }
    ` : ''}
    vec3 v2U=vec3(1,0,0), v2V=vec3(0,1,0);
    vec3 v2Packed=vec3(1,.8,0), v2PhotoN=vec3(0,0,1);
    if(v2Coverage>0.) {
    vec2 v2UV;
    bool v2Horizontal=abs(v2Geom.y)>.65;
    if(v2Horizontal) {
      v2U=vec3(1,0,0); v2V=vec3(0,0,v2Geom.y>0. ? -1. : 1.);
      // Quiet lower-left source crop: no repeated graffiti on slabs/soffits.
      v2UV=${ground ? 'vec2(dot(vV2SurfacePosition,v2U)/2.51,dot(vV2SurfacePosition,v2V)/1.55)' : 'fract(vec2(dot(vV2SurfacePosition,v2U)/2.51,dot(vV2SurfacePosition,v2V)/1.55))'};
      ${ground ? '// Prepared periodic quiet crop: full UV wrapping has no hard tonal reset.' : 'v2UV=vec2(.01,.01)+v2UV*vec2(.23,.40);'}
    } else {
      v2U=abs(v2Geom.x)>abs(v2Geom.z) ? vec3(0,0,v2Geom.x>0. ? -1. : 1.) : vec3(v2Geom.z>0. ? 1. : -1.,0,0);
      v2V=vec3(0,1,0);
      // Rectified 10.92 x 3.87 m photographic strip, not the multi-island atlas.
      v2UV=vec2(dot(vV2SurfacePosition,v2U)/10.92,vV2SurfacePosition.y/3.87);
    }
    vec3 v2Photo;
    ${ground ? `if(v2Horizontal) {
      v2Photo=texture2D(v2SoffitAlbedo,v2UV).rgb;
      v2Packed=texture2D(v2SoffitSurface,v2UV).rgb;
      v2PhotoN=texture2D(v2SoffitNormal,v2UV).xyz*2.-1.;
    } else` : ''} {
      v2Photo=texture2D(v2Albedo,v2UV).rgb;
      v2Packed=texture2D(v2Surface,v2UV).rgb;
      v2PhotoN=texture2D(v2PhotoNormal,v2UV).xyz*2.-1.;
    }
    // Neutral mineral albedo; cold blue is supplied by lighting, not baked here.
    vec3 v2Target=v2Photo*v2BaseColor*.48*(.8+.2*v2Packed.r);
    // Built-in color_fragment follows this hook and applies vertex color once.
    diffuseColor.rgb=mix(diffuseColor.rgb,v2Target,v2Coverage);
    diffuseColor.rgb*=1.-v2Down*.12;
    }
  `)
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>', /* glsl */`
    #include <roughnessmap_fragment>
    if(v2Coverage>0.) {
      // Keep real ARM variation on dry surviving mineral; damaged zones retain
      // their previous base response underneath the separately registered spall.
      float v2OldRough=clamp(.72+v2Packed.g*.23+v2Down*.08,.75,.99);
      float v2DryRough=clamp(mix(.62,.65,v2Down)+v2Packed.g*.32,.68,.94);
      roughnessFactor=mix(roughnessFactor,mix(v2OldRough,v2DryRough,v2Surviving),.88);
    }
    ${ground ? 'if(v2Up>0.) roughnessFactor=mix(roughnessFactor,mix(v2GroundPacked.g,.96,v2Dust*.25),v2Up);' : ''}
  `)
  if(ground) shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor*=1.-v2Up;')
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>', /* glsl */`
    #include <normal_fragment_maps>
    ${ground ? `
      if(v2Up>0.) {
        vec3 v2GroundWorld=normalize(vec3(v2GroundN.x,0.,-v2GroundN.y)+v2Geom*v2GroundN.z);
        normal=normalize(mix(normal,normalize(mat3(viewMatrix)*v2GroundWorld)*faceDirection,v2Up));
      }
    ` : ''}
    // Source normal is rotated from each original atlas island during preparation.
    // Small photographed relief; no scalar cell-height differential or ridges.
    if(v2Coverage>0.) {
    // The actual scan has quiet faces and chipped slopes (90th percentile ~24deg).
    // Restore near-native slopes only on surviving surfaces. No invented height.
    v2PhotoN.xy*=mix(mix(.32,.12,v2Down),mix(1.,.85,v2Down),v2Surviving);
    vec3 v2WorldNormal=normalize(v2U*v2PhotoN.x+v2V*v2PhotoN.y+v2Geom*max(.2,v2PhotoN.z));
    vec3 v2ViewNormal=normalize(mat3(viewMatrix)*v2WorldNormal);
    v2ViewNormal*=faceDirection;
    normal=normalize(mix(normal,v2ViewNormal,v2Coverage));
    }
  `)
}
