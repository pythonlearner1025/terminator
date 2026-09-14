import {V2_WEATHERING_GLSL} from './materials-weathering.js'

/** Actual generated wall provenance, never an imported scan or generic concrete prop. */
export function isV2WallReceiver(source,object,kind) {
  if(!['concrete','fracture','fracture-masked'].includes(kind)) return false
  if(object.userData?.v2WallSubstrate===false) return false
  const role=object.userData?.architectureSurface ?? source.userData?.architectureSurface
  // Existing architecture 'fracture' batches also contain collapse fragments.
  // Only the concrete wall batch (or an explicit future wall tag) is safe.
  if((role==='concrete' || object.userData?.v2WallSubstrate===true) && object.userData?.v2Architecture && object.userData?.sourceColliderIds?.length) return true
  return source.name==='Map concrete' && object.name==='Static placed map Map concrete'
}

/** Compose into the existing photo projection; horizontal receivers remain exact R7. */
export function patchV2WallShader(shader) {
  // Separate names keep this helper independent of the unchanged spall shader.
  shader.fragmentShader=`uniform sampler2D v2WallAlbedo; uniform sampler2D v2WallNormal; uniform sampler2D v2WallSurface;\n${V2_WEATHERING_GLSL.replaceAll('v2Hash','v2WallHash').replaceAll('v2Noise','v2WallNoise')}\n`+shader.fragmentShader
  shader.fragmentShader=shader.fragmentShader.replace('float v2Dust=0.;','float v2Dust=0.; float v2WallWeight=0.;')
  shader.fragmentShader=shader.fragmentShader.replace('// Neutral mineral albedo;',`
    if(!v2Horizontal) {
      // Full substrate replacement removes the inherited 16% flat paint pedestal.
      // Authored material objects remain unchanged; only this owned shader differs.
      v2Coverage=1.;
      vec2 metric=vec2(dot(vV2SurfacePosition,v2U),vV2SurfacePosition.y)/2.1;
      // Native-scale registered quarter-turn samples, with narrow continuous
      // transitions between dominant fields instead of repeated distinctive tiles.
      vec2 qa=metric+vec2(.17,.63),qb=vec2(-metric.y,metric.x)+vec2(3.71,8.19);
      float choose=smoothstep(.46,.54,v2WallNoise(vV2SurfacePosition*.19+vec3(7.3,2.1,17.7)));
      vec3 ca=texture2D(v2WallAlbedo,qa).rgb,cb=texture2D(v2WallAlbedo,qb).rgb;
      vec3 na=texture2D(v2WallNormal,qa).xyz*2.-1.,nb=texture2D(v2WallNormal,qb).xyz*2.-1.;
      nb.xy=vec2(nb.y,-nb.x); // inverse of the color/ARM UV quarter turn
      vec3 wallN=normalize(mix(na,nb,choose));
      vec3 wallPacked=mix(texture2D(v2WallSurface,qa).rgb,texture2D(v2WallSurface,qb).rgb,choose);
      vec3 wallColor=mix(ca,cb,choose);
      wallColor=mix(vec3(dot(wallColor,vec3(.2126,.7152,.0722))),wallColor,.18);
      // Smooth cast remnants persist as connected quiet regions; exposed cement
      // aggregate dominates. This changes response, never adds procedural relief.
      float v2CastRetention=smoothstep(.55,.73,v2WallNoise(vV2SurfacePosition*vec3(.43,.31,.43)+vec3(19.1,5.7,3.2)));
      v2WallWeight=1.-v2CastRetention*.82;
      v2Photo=mix(mix(v2Photo,vec3(.24),.85),wallColor,v2WallWeight);
      v2PhotoN=normalize(mix(v2PhotoN,wallN,v2WallWeight));
      v2Packed=mix(v2Packed,wallPacked,v2WallWeight);
    }
    // Neutral mineral albedo;`)
  shader.fragmentShader=shader.fragmentShader.replace('v2PhotoN.xy*=mix(mix(.32,.12,v2Down),mix(1.,.85,v2Down),v2Surviving);',
    'v2PhotoN.xy*=mix(mix(mix(.32,.12,v2Down),mix(1.,.85,v2Down),v2Surviving),1.,v2WallWeight);')
  shader.fragmentShader=shader.fragmentShader.replace('vec3 v2Target=v2Photo*v2BaseColor*.48*(.8+.2*v2Packed.r);',
    `vec3 v2Target=v2Photo*v2BaseColor*.48*(.8+.2*v2Packed.r);
     if(v2WallWeight>0.) v2Target=v2Photo*.4;`)
  shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>',
    `if(v2WallWeight>0.) roughnessFactor=v2Packed.g;
     #include <metalnessmap_fragment>`)
  // Photo source AO is a contact-occlusion input, not a copied baked highlight.
  shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`#include <aomap_fragment>
    reflectedLight.indirectDiffuse*=mix(1.,v2Packed.r,v2WallWeight);`)
}
