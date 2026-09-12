// Three's standard material samples a shared occlusion/roughness/metalness map
// once per property. Reuse the same texel when all three properties share it.
export function combineOrmMaterial(material) {
  if(!material?.roughnessMap||material.roughnessMap!==material.metalnessMap||material.roughnessMap!==material.aoMap)return material
  material.registerMaterialExtensions([{
    uuid:'terminator-shared-orm-sample',computeCacheKey:'terminator-shared-orm-sample-v2',priority:-100,
    shaderExtender(shader){
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`float roughnessFactor = roughness;
        vec4 terminatorOrm = texture2D( roughnessMap, vRoughnessMapUv );
        roughnessFactor *= terminatorOrm.g;`)
      shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>',`float metalnessFactor = metalness;
        metalnessFactor *= terminatorOrm.b;`)
      shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`float ambientOcclusion = ( terminatorOrm.r - 1.0 ) * aoMapIntensity + 1.0;
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        #if defined( USE_CLEARCOAT )
          clearcoatSpecularIndirect *= ambientOcclusion;
        #endif
        #if defined( USE_SHEEN )
          sheenSpecularIndirect *= ambientOcclusion;
        #endif
        #if defined( USE_ENVMAP ) && defined( STANDARD )
          float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
          reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
        #endif`)
    },
  }])
  return material
}
