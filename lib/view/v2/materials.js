import {TextureLoader, RepeatWrapping, ClampToEdgeWrapping, SRGBColorSpace, NoColorSpace, Vector4} from 'three'
import {patchV2SurfaceShader} from './materials-shader.js'
import {isV2WallReceiver,patchV2WallShader} from './materials-wall.js'
import {patchV2SpallShader} from './materials-spall.js'
import {installV2LinearFog} from './fog.js'
import {createV2MoistureUniforms,patchV2MoistureShader} from './materials-moisture.js'

export const V2_MATERIAL_DEFAULTS = Object.freeze({
  ground: Object.freeze({family:'photo-worn', coverage:.84, imported:0, substrate:true}),
  fracture: Object.freeze({family:'photo-worn',coverage:.68,imported:0,spall:true}),
  'fracture-masked': Object.freeze({family:'photo-worn',coverage:.84,imported:0,spall:true,masked:true}),
  concrete: Object.freeze({family:'photo-worn', coverage:.84, imported:0}),
  masonry: Object.freeze({family:'photo-worn', coverage:.72, imported:0}),
  soot: Object.freeze({family:'photo-worn', coverage:.84, imported:0}),
  rubble: Object.freeze({family:'photo-worn', coverage:.68, imported:0}),
  metal: Object.freeze({family:null, coverage:0, imported:1}),
  imported: Object.freeze({family:null, coverage:0, imported:1}),
})

/** Explicit tags win. Selected imported props keep every original PBR texture. */
export function classifyV2Material(material, object) {
  if (!material?.isMeshStandardMaterial && !material?.isMeshPhysicalMaterial) return null
  let tag = object?.userData?.v2Surface ?? material.userData?.v2Surface
  if (tag === 'preserve') return null
  // Selected/photoscan texture identity wins over a generic architecture concrete tag.
  if (/^Selected /i.test(material.name || '') || material.userData?.v2Photoscan || object?.userData?.v2Photoscan) return 'imported'
  const role = object?.userData?.architectureSurface ?? material.userData?.architectureSurface
  const generated=object?.userData?.v2Architecture || material.userData?.v2Architecture
  const uv=object?.geometry?.attributes?.uv, mask=object?.geometry?.attributes?.v2FractureMask
  if(generated && uv?.itemSize===2) {
    if(object.userData?.v2FractureMask && mask?.itemSize===1 && mask.count===uv.count) return 'fracture-masked'
    if(role==='fracture') return 'fracture'
  }
  if ((tag === 'concrete' || tag === 'ground') && /^(rubble|slab|chip|fracture)$/.test(role)) return 'rubble'
  tag = ({'fractured-concrete':'rubble', rebar:'metal', 'charred-steel':'metal', skyline:'concrete'})[tag] || tag
  if (Object.hasOwn(V2_MATERIAL_DEFAULTS, tag)) return tag
  if (material.transparent || material.transmission > 0 || material.emissive?.getHex() > 0) return null
  const name = material.name || ''
  // Explicit native cloth/rubber identity wins over inherited texture filenames.
  if (/^Map (canvas|rubber)$/i.test(name)) return 'imported'
  const mapName = `${material.map?.name || ''} ${material.map?.userData?.rootPath || ''} ${material.map?.source?.data?.src || ''}`
  if (/hangar_concrete_floor|asphalt_02/i.test(mapName) && !/rubber/i.test(name)) return 'ground'
  if (/^Selected /i.test(name)) return 'imported'
  if (/^Map (ground|serviceFloor)$/i.test(name)) return 'ground'
  if (/^Map concrete$/i.test(name)) return 'concrete'
  if (/^Map (rust|steel|olive|red|blue)$/i.test(name)) return 'metal'
  if (/^V2\b/i.test(name) || /^V2\b/i.test(object?.name || '')) {
    const combined = `${name} ${object?.name || ''}`
    if (/rebar|steel|metal|iron|cable/i.test(combined)) return 'metal'
    if (/ground|grit|dust|scree/i.test(combined)) return 'ground'
    if (/soot|charred/i.test(combined)) return 'soot'
    if (/brick|masonry/i.test(combined)) return 'masonry'
    if (/concrete|rubble|debris|ruin|fracture|wall|column|parapet|spall/i.test(combined)) return 'concrete'
  }
  return null
}

const mapSlots = ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap','bumpMap','displacementMap',
  'clearcoatMap','clearcoatNormalMap','clearcoatRoughnessMap','transmissionMap','thicknessMap','specularColorMap','specularIntensityMap',
  'envMap','sheenColorMap','sheenRoughnessMap','iridescenceMap','iridescenceThicknessMap','anisotropyMap','lightMap']

/**
 * Apply to the built runtime/preview map root, after architecture.
 * ready rejects on texture failure. In Node no DOM or loads are needed; inject
 * loadTexture(url) for headless resource tests. Never dispose original materials/maps.
 */
export function mountV2Materials({viewer, root, map, refs, preview=false, loadTexture} = {}) {
  if (!root?.traverse) throw new TypeError('mountV2Materials requires the supplied map root')
  const records = [], clones = new Set(), textures = new Set(), cache = new Map()
  const fogHandles = new Map()
  const stats = {meshes:0, materials:0, textures:0, bySurface:{}, preview:Boolean(preview), ready:false, disposed:false}
  const loading = new Map(), assignments = []
  const moistureUniforms = createV2MoistureUniforms(map)
  let disposed = false
  const canLoad = loadTexture || typeof document !== 'undefined'
  const loader = loadTexture || (url => new TextureLoader().loadAsync(url))
  function familyMaps(family) {
    if (loading.has(family)) return loading.get(family)
    const pending = Promise.all([family==='photo-spall' ? 'albedo.png' : 'albedo.jpg','normal.png','orm.png'].map(async (suffix, index) => {
      const url = new URL(`../../../assets/v2/materials/${family}-${suffix}`, import.meta.url).href
      const texture = await loader(url)
      if (disposed) { texture.dispose(); return null }
      texture.name = `V2 ${family} ${suffix}`
      texture.wrapS = texture.wrapT = family==='photo-spall' ? ClampToEdgeWrapping : RepeatWrapping
      texture.colorSpace = index === 0 ? SRGBColorSpace : NoColorSpace
      texture.anisotropy = Math.min(8, viewer?.renderManager?.renderer?.capabilities?.getMaxAnisotropy?.() || 4)
      texture.userData = {...texture.userData, rootPath:url, v2Owned:true}
      texture.needsUpdate = true
      textures.add(texture)
      stats.textures = textures.size
      return texture
    }))
    loading.set(family,pending)
    return pending
  }
  function cloneMaterial(source, kind, wall=false) {
    const variant=kind+(wall ? '-wall' : '')
    let variants = cache.get(source)
    if (!variants) { variants = new Map(); cache.set(source,variants) }
    if (variants.has(variant)) return variants.get(variant)
    // Preserve the installed class via copy. In Threepipe 0.5.1 clone() is
    // wrapped twice and leaves an intermediate copy subscribed to source maps.
    const material = new source.constructor().copy(source)
    if (source.materialExtensions?.length) material.registerMaterialExtensions?.([...source.materialExtensions])
    // Threepipe PhysicalMaterial defaults fog=false, unlike stock Three.
    // Only this owned world clone participates; source/sky/lamp materials stay intact.
    material.fog = true
    material.color = material.color.clone()
    if (kind === 'metal' && /^Map /i.test(source.name)) {
      const gray = material.color.r*.2126+material.color.g*.7152+material.color.b*.0722
      material.color.setRGB(
        (material.color.r*.35+gray*.65)*.57,
        (material.color.g*.35+gray*.65)*.59,
        (material.color.b*.35+gray*.65)*.62,
      )
    }
    for (const slot of mapSlots) if (slot in source) material[slot] = source[slot]
    material.name = `${source.name || kind} · V2 surface`
    material.userData = {...material.userData, v2Surface:kind, v2MaterialOwned:true}
    const settings = V2_MATERIAL_DEFAULTS[kind]
    if (settings.family && !settings.substrate) {
      material.metalness = 0
      material.roughness = .94
      // Generated near-wall skins were authored as very dark flat colors
      // (~.055 linear), unlike the original mapped concrete (.56–.65).
      // A photo multiplied by that tint loses its entire diffuse response.
      // Use a soot-darkened concrete factor only on untextured near-wall skins;
      // original fracture-chip colors, source maps, photoscans and skyline stay intact.
      if (source.userData?.v2Architecture && !source.map &&
          source.userData.architectureSurface === 'concrete') {
        material.color.setRGB(.30,.32,.33)
      }
    }
    const uniforms = {
      v2WallAlbedo:{value:null}, v2WallNormal:{value:null}, v2WallSurface:{value:null},
      v2SpallAlbedo:{value:null}, v2SpallNormal:{value:null}, v2SpallSurface:{value:null},
      v2Albedo:{value:null}, v2PhotoNormal:{value:null}, v2Surface:{value:null}, v2BaseColor:{value:material.color.clone()},
      v2SoffitAlbedo:{value:null}, v2SoffitNormal:{value:null}, v2SoffitSurface:{value:null},
      v2GroundAlbedo:{value:null}, v2GroundNormal:{value:null}, v2GroundSurface:{value:null},
      v2Response:{value:new Vector4(settings.substrate ? 1 : 0,settings.coverage,0,settings.imported)},
    }
    // Save methods from the source: Three's clone does not copy custom shader callbacks.
    const originalCompile = source.onBeforeCompile
    const originalKey = source.customProgramCacheKey
    let mapsReady = !settings.family
    material.onBeforeCompile = function(shader, renderer) {
      originalCompile?.call(this,shader,renderer)
      if (mapsReady) {
        patchV2SurfaceShader(shader,uniforms,settings)
        if(wall) patchV2WallShader(shader)
        if(settings.spall) patchV2SpallShader(shader,settings.masked)
        if(settings.substrate) patchV2MoistureShader(shader,moistureUniforms)
      }
    }
    material.customProgramCacheKey = function() {
      return `${originalKey?.call(this) || ''}|v2-photographed-surface-8|${mapsReady ? variant : 'pending'}`
    }
    fogHandles.set(material,installV2LinearFog(material,{owned:true}))
    if (canLoad && settings.family) assignments.push(Promise.all([familyMaps(settings.family),
      settings.substrate ? familyMaps('substrate-rubble') : null,
      settings.substrate ? familyMaps('photo-soffit') : null,
      settings.spall ? familyMaps('photo-spall') : null,
      wall ? familyMaps('wall-aggregate') : null,
    ]).then(([[albedo,normal,surface],substrate,soffit,spall,wallMaps]) => {
      if (disposed) return
      uniforms.v2Albedo.value = albedo
      uniforms.v2PhotoNormal.value = normal
      uniforms.v2Surface.value = surface
      if (substrate) {
        uniforms.v2GroundAlbedo.value = substrate[0]
        uniforms.v2GroundNormal.value = substrate[1]
        uniforms.v2GroundSurface.value = substrate[2]
        uniforms.v2SoffitAlbedo.value = soffit[0]
        uniforms.v2SoffitNormal.value = soffit[1]
        uniforms.v2SoffitSurface.value = soffit[2]
      }
      if(wallMaps) {
        uniforms.v2WallAlbedo.value=wallMaps[0]
        uniforms.v2WallNormal.value=wallMaps[1]
        uniforms.v2WallSurface.value=wallMaps[2]
      }
      if(spall) {
        uniforms.v2SpallAlbedo.value = spall[0]
        uniforms.v2SpallNormal.value = spall[1]
        uniforms.v2SpallSurface.value = spall[2]
      }
      mapsReady = true
      material.needsUpdate = true
      material.setDirty?.()
      viewer?.setDirty?.()
    }))
    variants.set(variant,material)
    clones.add(material)
    stats.bySurface[kind] = (stats.bySurface[kind] || 0)+1
    return material
  }
  root.traverse(object => {
    if (!object.isMesh || !object.material) return
    const original = object.material
    const entries = Array.isArray(original) ? original : [original]
    let changed = false
    const next = entries.map(source => {
      const kind = classifyV2Material(source,object)
      if (!kind) return source
      changed = true
      return cloneMaterial(source,kind,isV2WallReceiver(source,object,kind))
    })
    if (!changed) return
    const assigned = Array.isArray(original) ? next : next[0]
    object.material = assigned
    records.push({object,original,assigned:object.material, slots:next})
  })
  stats.meshes = records.length
  stats.materials = clones.size
  const ready = Promise.all([...loading.values(), ...assignments]).then(() => { stats.ready = !disposed })
  return {
    ready, stats,
    sync(world) { /* Static world-anchored material response; no simulation mutation. */ },
    dispose() {
      if (disposed) return
      disposed = true
      stats.disposed = true
      stats.ready = false
      for (const {object,original,assigned,slots} of records) {
        // Respect a later owner replacing a whole material or an individual group slot.
        if (Array.isArray(object.material) && Array.isArray(assigned)) {
          object.material = object.material.map((value,i) => value === slots[i] ? original[i] : value)
        } else if (object.material === assigned) object.material = original
      }
      for (const material of clones) {
        fogHandles.get(material)?.dispose()
        // Threepipe subscribes each clone to shared map update events. Detach
        // those references before disposal; disposing a material alone leaves them.
        for (const slot of mapSlots) if (slot in material) material[slot] = null
        material.setDirty?.()
        material.unregisterMaterialExtensions?.([...material.materialExtensions || []])
        material.dispose()
      }
      for (const texture of textures) texture.dispose()
      textures.clear(); clones.clear(); records.length=0; cache.clear(); loading.clear(); fogHandles.clear()
      viewer?.setDirty?.()
    },
  }
}
