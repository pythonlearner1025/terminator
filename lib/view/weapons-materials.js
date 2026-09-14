import {PhysicalMaterial, TextureLoader, SRGBColorSpace, Vector2, Vector3, Color, CubeTexture} from 'threepipe'

export const WEAPON_SURFACES = ['steel','edge','dark','rubber','glove','pad','cloth','brass','red','olive','white','blue','pistolMark','rifleMark','plasmaMark','armoryMark']
const loader = new TextureLoader()
let sharedMaps, atlasStates
export const weaponAsset = name => new URL(`../../assets/textures/weapons/${name}`,import.meta.url).href

export function weaponSurfaceMaps() {
  if (!sharedMaps) {
    sharedMaps = {}
    atlasStates = new Map(['albedo','normal','surface','emissive'].map(name => [name, {status:'new'}]))
  }
  // Only an explicit subsequent request retries a settled failure. Calls during
  // an attempt share its promise; successful atlases are never downloaded again.
  if (sharedMaps.loading || [...atlasStates.values()].every(state => state.status === 'ready')) return sharedMaps
  sharedMaps.loading = true
  const pending = []
  for (const [name, state] of atlasStates) {
    if (state.status === 'ready') continue
    state.status = 'loading'
    pending.push(new Promise((resolve, reject) => {
      const map = loader.load(name==='surface'?new URL('../../assets/v2/performance/weapon-orm.png',import.meta.url).href:weaponAsset(`weapon-${name}.png`), texture => {
        const resident = sharedMaps[name]
        if (resident !== texture) {
          // Materials can already borrow the failed placeholder. Preserve that
          // Texture identity and its settings, replace only its decoded image.
          resident.image = texture.image
          resident.needsUpdate = true
          texture.dispose()
        }
        state.status = 'ready'
        resolve(resident)
      }, undefined, error => {state.status = 'failed'; reject(error)})
      if (!sharedMaps[name]) {
        map.name = `Weapon ${name} atlas`; map.anisotropy = 4
        if (name === 'albedo' || name === 'emissive') map.colorSpace = SRGBColorSpace
        sharedMaps[name] = map
        // Roughness G, metalness B and occlusion R retain their exact source pixels.
        if(name==='surface')sharedMaps.roughness=sharedMaps.metalness=sharedMaps.ao=map
      }
    }))
  }
  sharedMaps.ready = Promise.allSettled(pending).then(results => {
    sharedMaps.loading = false
    const failed = results.find(result => result.status === 'rejected')
    if (failed) throw failed.reason
    return [...atlasStates.keys()].map(name => sharedMaps[name])
  })
  // Optional menu preparation may have no caller awaiting it yet. The public
  // promise remains rejected so a failed match cannot pass readiness.
  sharedMaps.ready.catch(() => {})
  return sharedMaps
}

// One UV atlas and one material preserve articulation without a draw per surface.
export function weaponMaterial(projection) {
  const maps=weaponSurfaceMaps()
  const material=new PhysicalMaterial({name:'B7 worn phosphate, machined steel, molded polymer and woven gloves',
    map:maps.albedo,normalMap:maps.normal,roughnessMap:maps.roughness,
    metalnessMap:maps.metalness,aoMap:maps.ao,emissiveMap:maps.emissive,
    color:0xffffff,metalness:1,roughness:1,emissive:0xffffff,emissiveIntensity:1.2,
    specularIntensity:.35,normalScale:new Vector2(.20,.20),fog:false})
  material.userData.ssaoDisabled=true;material.userData.ssaoCastDisabled=true;material.userData.renderToGBuffer=false
  // Compact authored reflection probe. Metal reads the broad light sources, while
  // the flash below follows the actual world-space muzzle on the rendering camera.
  const faces=Array.from({length:6},(_,face)=>{
    const c=document.createElement('canvas');c.width=c.height=128
    const ctx=c.getContext('2d'),g=ctx.createLinearGradient(0,0,0,128)
    g.addColorStop(0,'#6b7988');g.addColorStop(.4,'#29333e');g.addColorStop(.65,'#0b1118');g.addColorStop(1,'#3a3025')
    ctx.fillStyle=g;ctx.fillRect(0,0,128,128)
    ctx.fillStyle=face===2?'#d5e1ed':'#a9bac7';ctx.fillRect(15,12,12,94)
    return c
  })
  material.envMap=new CubeTexture(faces);material.envMap.colorSpace=SRGBColorSpace;material.envMap.needsUpdate=true;material.envMapIntensity=.45
  const flash={position:{value:new Vector3()},color:{value:new Color()},power:{value:0},aim:{value:0}}
  material.userData.weaponFlash=flash
  material.registerMaterialExtensions([projection,{
    uuid:'terminator-weapon-lighting',computeCacheKey:'weapon-pbr-lighting-v5',
    extraUniforms:{weaponFlashPosition:flash.position,weaponFlashColor:flash.color,weaponFlashPower:flash.power,weaponAim:flash.aim},
    parsFragmentSnippet:'uniform vec3 weaponFlashPosition; uniform vec3 weaponFlashColor; uniform float weaponFlashPower; uniform float weaponAim;',
    shaderExtender(shader) {
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>', `
        vec3 geometryPosition = -vViewPosition;
        vec3 geometryNormal = normal;
        vec3 geometryViewDir = normalize(vViewPosition);
        vec3 geometryClearcoatNormal = vec3(0.0);
        IncidentLight directLight;
        directLight.color = vec3(2.8, 3.1, 3.5);
        directLight.direction = normalize(vec3(-0.5, 0.8, 0.7));
        directLight.visible = true;
        RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
        vec3 flashVector = weaponFlashPosition - geometryPosition;
        directLight.direction = normalize(flashVector);
        directLight.color = weaponFlashColor * weaponFlashPower / (0.16 + dot(flashVector,flashVector));
        RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
        vec3 iblIrradiance = vec3(0.0);
        vec3 irradiance = vec3(0.22, 0.26, 0.31);
        vec3 radiance = vec3(0.0);
        vec3 clearcoatRadiance = vec3(0.0);
      `)
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
        'outgoingLight = mix(outgoingLight, diffuseColor.rgb * (0.38 + 1.15 * max(dot(normal, normalize(vec3(-0.4, 0.8, 0.6))), 0.0)), 0.10 + (1.0 - metalnessFactor) * 0.12);\n#include <opaque_fragment>')
      // Select higher mip levels behind the sight plane while aiming. Weapon-only
      // optical softness avoids a fullscreen DOF pass and keeps the target sharp.
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv, weaponAim * (1.0 - smoothstep(0.30, 0.72, vViewPosition.z)) * 2.0);
          diffuseColor *= sampledDiffuseColor;
        #endif
      `)
    },
  }])
  return material
}
