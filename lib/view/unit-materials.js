import {combineOrmMaterial} from './orm-material.js'

// Shared atlas: one PBR draw for rigid-skinned anatomy, with no vertex colours.
// All URLs resolve from the module so both the editor and published runtime work.
let shared
export function unitMaterials(E) {
  if (shared) return shared
  const pending = []
  const load = (name, srgb = false) => {
    const url = new URL(`../../assets/textures/units/${name}`, import.meta.url).href
    let resolve, reject
    pending.push(new Promise((yes, no) => { resolve = yes; reject = no }))
    const texture = new E.TextureLoader().load(url, resolve, undefined, reject)
    texture.colorSpace = srgb ? E.SRGBColorSpace : E.NoColorSpace
    texture.anisotropy = 4
    texture.name = `Units ${name}`
    return texture
  }
  const map = load('endoskeleton-albedo.jpg', true), normalMap = load('endoskeleton-normal.png'), orm = load('endoskeleton-orm.png')
  let metal, eye, impact, environment
  pending.push(new Promise((resolve, reject) => {
    environment = new E.RGBELoader().load(new URL('../../assets/textures/units/studio_small_09_1k.hdr', import.meta.url).href, texture => {
      texture.mapping = E.EquirectangularReflectionMapping
      // Assign the environment only after RGBELoader has real dimensions. A
      // placeholder HDR texture produces invalid cube-UV shader constants.
      for (const material of [metal, eye, impact]) {
        material.envMap = texture
        material.needsUpdate = true
      }
      resolve(texture)
    }, undefined, reject)
    environment.mapping = E.EquirectangularReflectionMapping
  }))
  metal = new E.PhysicalMaterial({name: 'Endoskeleton 1K worn metal atlas', map, normalMap,
    normalScale: new E.Vector2(.55, .55), roughnessMap: orm, metalnessMap: orm, aoMap: orm,
    metalness: 1, roughness: 1, envMapIntensity: .6})
  combineOrmMaterial(metal)
  const opticOrm = load('optic-orm.png')
  eye = new E.PhysicalMaterial({name: 'Machined red optical glass', map: load('optic-albedo.png', true),
    normalMap: load('optic-normal.png'), roughnessMap: opticOrm, metalnessMap: opticOrm, aoMap: opticOrm,
    emissiveMap: load('optic-emissive.png', true), emissive: 0xff3322, emissiveIntensity: 8,
    metalness: .65, roughness: .5, envMapIntensity: .5})
  combineOrmMaterial(eye)
  // The atlas already carries baked ambient occlusion. Excluding unit skins
  // from the screen-space G-buffer avoids drawing every skinned triangle twice
  // while preserving direct light, shadows, reflections, and baked creases.
  metal.userData.renderToGBuffer = false
  eye.userData.renderToGBuffer = false
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d'), g = ctx.createRadialGradient(64,64,0,64,64,64)
  g.addColorStop(0,'#ffffffff');g.addColorStop(.06,'#ffffffee');g.addColorStop(.25,'#ffffff48');g.addColorStop(1,'#ffffff00')
  ctx.fillStyle=g;ctx.fillRect(0,0,128,128)
  const glowMap = new E.CanvasTexture(canvas)
  const halo = new E.UnlitMaterial({name:'Optical scattering', color:0xff1203, map:glowMap,
    transparent:true,depthWrite:false,blending:E.AdditiveBlending,side:E.DoubleSide})
  const impactOrm = load('impact-orm.png')
  impact = new E.PhysicalMaterial({name:'Oil scorched impact dent',map:load('impact-albedo.png',true),
    normalMap:load('impact-normal.png'),normalScale:new E.Vector2(1,1),roughnessMap:impactOrm,
    metalnessMap:impactOrm,aoMap:impactOrm,roughness:1,metalness:1,transparent:true,alphaTest:.035,
    depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,envMapIntensity:.4})
  combineOrmMaterial(impact)
  shared={metal,eye,halo,impact,glowMap,environment,ready:Promise.all(pending),textureBytes:3*1024*1024*4*4/3+4*256*256*4*4/3+3*512*512*4*4/3+1024*512*8}
  return shared
}

export function unitPreviewMaterials(E) { return unitMaterials(E) }
