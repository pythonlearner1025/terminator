import {V2_WEATHERING_GLSL} from './materials-weathering.js'

/** Registered 0.5m photographic patches, exclusively on semantic fractures. */
export function patchV2SpallShader(shader, masked=false) {
  shader.vertexShader=`varying vec2 vV2SpallMetricUv;\n${masked ? 'attribute float v2FractureMask; varying float vV2FractureMask;\n' : ''}`+shader.vertexShader
  shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
    vV2SpallMetricUv=uv;
    ${masked ? 'vV2FractureMask=v2FractureMask;' : ''}`)
  shader.fragmentShader=`
    varying vec2 vV2SpallMetricUv;
    ${masked ? 'varying float vV2FractureMask;' : ''}
    uniform sampler2D v2SpallAlbedo; uniform sampler2D v2SpallNormal; uniform sampler2D v2SpallSurface;
    ${V2_WEATHERING_GLSL}
  `+shader.fragmentShader
  // Insert before native vertex color, which still applies exactly once.
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
    vec2 v2SpallDuv1=dFdx(vV2SpallMetricUv),v2SpallDuv2=dFdy(vV2SpallMetricUv);
    float v2SpallWeight=0.;
    vec3 v2SpallN=vec3(0,0,1), v2SpallPacked=vec3(1,.84,0);
    float v2SpallEligible=${masked ? 'clamp(vV2FractureMask,0.,1.)' : '1.'};
    if(v2SpallEligible>0.) {
      vec2 cell=floor(vV2SpallMetricUv/.72);
      float seed=v2Hash(vec3(cell,17.3));
      vec2 jitter=vec2(v2Hash(vec3(cell,31.7)),v2Hash(vec3(cell,53.1)))-.5;
      vec2 local=vV2SpallMetricUv-(cell+.5)*.72-jitter*.14;
      // Quarter turns preserve the crop's exact physical width and square bounds.
      float turn=floor(v2Hash(vec3(cell,71.9))*4.);
      float cs=turn==0. ? 1. : turn==2. ? -1. : 0.;
      float sn=turn==1. ? 1. : turn==3. ? -1. : 0.;
      mat2 rotation=mat2(cs,sn,-sn,cs), inverseRotation=mat2(cs,-sn,sn,cs);
      vec2 photoUv=rotation*local/.5+.5;
      float edge=min(min(photoUv.x,photoUv.y),min(1.-photoUv.x,1.-photoUv.y));
      // Patch gaps and skipped sites prevent the distinctive pocket repeating everywhere.
      v2SpallWeight=v2SpallEligible*smoothstep(.025,.13,edge)*step(.25,seed)*.88;
      if(v2SpallWeight>0.) {
        vec3 photo=textureGrad(v2SpallAlbedo,photoUv,rotation*v2SpallDuv1/.5,rotation*v2SpallDuv2/.5).rgb;
        v2SpallPacked=textureGrad(v2SpallSurface,photoUv,rotation*v2SpallDuv1/.5,rotation*v2SpallDuv2/.5).rgb;
        v2SpallN=textureGrad(v2SpallNormal,photoUv,rotation*v2SpallDuv1/.5,rotation*v2SpallDuv2/.5).xyz*2.-1.;
        v2SpallN.xy=inverseRotation*v2SpallN.xy;
        // Preserve wall/return palette continuity: registered photograph modulates
        // mineral response around its measured linear luminance mean (.173).
        float mineral=clamp(dot(photo,vec3(.2126,.7152,.0722))/.173,.2,2.5);
        diffuseColor.rgb*=mix(1.,mineral,v2SpallWeight);
      }
    }
    #include <color_fragment>
  `)
  shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>',`
    if(v2SpallWeight>0.) roughnessFactor=mix(roughnessFactor,v2SpallPacked.g,v2SpallWeight*.75);
    #include <metalnessmap_fragment>
  `)
  // Source cavity occlusion belongs on indirect illumination. The first driver
  // A/B showed that compressing it into a .8–1 diffuse tint erased the pockets.
  // Preserve direct grazing light and the photograph's actual AO variation.
  shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`
    #include <aomap_fragment>
    reflectedLight.indirectDiffuse*=mix(1.,v2SpallPacked.r,v2SpallWeight);
  `)
  // Run after the existing photo normal, retaining its response in the quiet areas.
  shader.fragmentShader=shader.fragmentShader.replace('#include <clearcoat_normal_fragment_begin>',`
    vec3 dp1=dFdx(vV2SurfacePosition),dp2=dFdy(vV2SurfacePosition);
    if(v2SpallWeight>0.) {
      vec2 duv1=v2SpallDuv1,duv2=v2SpallDuv2;
      float determinant=duv1.x*duv2.y-duv1.y*duv2.x;
      if(abs(determinant)>1.e-10) {
        vec3 rawT=(dp1*duv2.y-dp2*duv1.y)*sign(determinant);
        vec3 rawB=(-dp1*duv2.x+dp2*duv1.x)*sign(determinant);
        vec3 tangent=normalize(rawT-v2Geom*dot(rawT,v2Geom));
        vec3 bitangent=normalize(cross(v2Geom,tangent));
        bitangent*=dot(bitangent,rawB)<0. ? -1. : 1.;
        vec3 detailWorld=normalize(tangent*v2SpallN.x+bitangent*v2SpallN.y+v2Geom*v2SpallN.z);
        normal=normalize(mix(normal,normalize(mat3(viewMatrix)*detailWorld)*faceDirection,v2SpallWeight));
      }
    }
    #include <clearcoat_normal_fragment_begin>
  `)
}
