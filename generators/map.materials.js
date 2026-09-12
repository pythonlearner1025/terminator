import {combineOrmMaterial} from '../lib/view/orm-material.js'

// Local CC0 PBR sets plus deterministic baked derivatives. Each map owns its GPU resources.
export function randomSource(seed = 2029) {
  return () => { seed = Math.imul(seed ^ seed >>> 15, 1 | seed); seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed); return ((seed ^ seed >>> 14) >>> 0) / 4294967296 }
}

export function mapMaterials(api) {
  const rand = randomSource()
  const textures = []
  function canvasTexture(draw, w = 512, h = 512) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
    draw(canvas.getContext('2d'), w, h)
    const texture = new api.CanvasTexture(canvas)
    texture.colorSpace = api.SRGBColorSpace
    texture.wrapS = texture.wrapT = api.RepeatWrapping
    texture.anisotropy = 4
    textures.push(texture)
    return texture
  }
  const loader = new api.TextureLoader(), pending = []
  const load = (name, color = false) => {
    let resolve, reject
    pending.push(new Promise((yes, no) => { resolve = yes; reject = no }))
    const texture = loader.load(new URL(`../assets/textures/map/${name}`, import.meta.url).href,
      () => resolve(), undefined, () => reject(new Error(`Map texture failed: ${name}`)))
    texture.colorSpace = color ? api.SRGBColorSpace : api.NoColorSpace
    texture.wrapS = texture.wrapT = api.RepeatWrapping
    texture.anisotropy = 8
    textures.push(texture)
    return texture
  }
  const set = (name, source = false) => ({
    map: load(source ? `${name}_diff_1k.jpg` : `${name}_albedo.jpg`, true),
    normalMap: load(source ? `${name}_nor_gl_1k.jpg` : `${name}_normal.jpg`),
    arm: load(source ? `${name}_arm_1k.jpg` : `${name}_arm.jpg`),
  })
  const concrete = set('concrete_wall_007', true), asphalt = set('asphalt_02', true)
  const rust = set('rusty_metal_02', true), paint = set('paint'), corrugated = set('corrugated')
  const canvas = set('canvas'), glass = set('glass')
  const lit = (name, color, maps = concrete, metalness = 1, roughness = 1) => {
    const mat = new api.PhysicalMaterial({color, map: maps.map, normalMap: maps.normalMap,
      roughnessMap: maps.arm, metalnessMap: maps.arm, aoMap: maps.arm,
      roughness, metalness, normalScale: new api.Vector2(.75, .75), aoMapIntensity: .8, fog: true})
    mat.name = `Map ${name}`
    mat.userData.mapSurface = true
    combineOrmMaterial(mat)
    return mat
  }
  const glow = (name, color, intensity = 3) => {
    const mat = lit(name, color, glass, 0, .65)
    mat.emissive.setHex(color); mat.emissiveMap = concrete.map; mat.emissiveIntensity = intensity
    return mat
  }
  const mats = {
    concrete: lit('weathered concrete', 0xc4cbca), ground: lit('wet cracked asphalt', 0x87969e, asphalt, 0, .93),
    serviceFloor:lit('damp service concrete',0x545f59,concrete,0,.7),
    serviceWall:lit('service cut concrete',0x7a8179,concrete,0,.92),
    housePaint:lit('barracks utility paint',0x566557,paint,0,.93),
    floor: lit('bunker concrete floor', 0x87928e, concrete, 0, .82),
    dark: lit('blackened steel', 0x3d4a50, paint, .9), rust: lit('oxidized steel', 0x886144, rust, .4),
    red: lit('oxide container', 0xac6050, corrugated), blue: lit('navy container', 0x5b8896, corrugated),
    steel: lit('galvanized steel', 0xb0b9bb, paint), yellow: lit('worn safety ochre', 0xd0ac51, paint, .45),
    truck: lit('resistance olive paint', 0x738a71, paint), rubber: lit('charred rubber', 0x293039, asphalt, 0),
    canvas: lit('frayed sandbag canvas', 0xbbb491, canvas, 0), glass: lit('cracked blast glass', 0xffffff, glass, .15), skyline: lit('distant ash concrete', 0x26323e, concrete, 0),
    redGlow: glow('Skynet signal', 0xff170a, 5), orangeGlow: glow('fire', 0xff6512, 5),
    whiteGlow: glow('fluorescent', 0xb5e1ed, 3), greenGlow: glow('resistance signal', 0x52ffbd, 3),
    electricGlow: glow('electrical arcs', 0x68c9ff, 6),
  }
  mats.serviceFloor.envMapIntensity=.05; mats.serviceWall.envMapIntensity=.08
  mats.skyline.emissive.setHex(0x142334); mats.skyline.emissiveIntensity = .5; mats.skyline.emissiveMap = concrete.map
  mats.skyline.normalScale.set(.1,.1)
  // Distant silhouettes never intersect gameplay geometry, so they cannot contribute useful screen-space occlusion.
  mats.skyline.userData.renderToGBuffer=false
  // Large-scale stains and variable wetness use world coordinates, independently of tile UVs.
  const surfaceUniforms = {mapWetness: {value: .72}}
  for (const mat of [mats.ground, mats.concrete, mats.floor]) {
    const compile = mat.onBeforeCompile, cacheKey = mat.customProgramCacheKey
    mat.onBeforeCompile = function(shader, renderer) {
      compile.call(this, shader, renderer)
      shader.uniforms.mapWetness = surfaceUniforms.mapWetness
      shader.vertexShader = 'varying vec3 vMapWorld;\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMapWorld=(modelMatrix*vec4(transformed,1.)).xyz;')
      shader.fragmentShader = 'varying vec3 vMapWorld; uniform float mapWetness;\n' + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float macro=sin(vMapWorld.x*.43+sin(vMapWorld.z*.3))*sin(vMapWorld.z*.57+vMapWorld.x*.11);
        diffuseColor.rgb*=.85+.15*macro;`)
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float wetPatch=smoothstep(.2,.82,macro)*mapWetness*step(abs(vMapWorld.y),.035);
        roughnessFactor=mix(roughnessFactor,.16,wetPatch);`)
    }
    mat.customProgramCacheKey = function() { return cacheKey.call(this) + ':bunker-world-grime-v1' }
  }
  for(const mat of [mats.dark,mats.steel,mats.yellow,mats.truck,mats.housePaint])mat.userData.mapBatchFamily='painted metal'
  for(const mat of [mats.red,mats.blue])mat.userData.mapBatchFamily='corrugated metal'
  const decalMaps = {map: load('decals_albedo.png', true), normalMap: load('decals_normal.jpg'), arm: load('decals_arm.jpg')}
  mats.decal = lit('grime scorch and bullet decal atlas', 0xffffff, decalMaps, .1)
  mats.puddle = lit('rainwater pools', 0xa8b6bd, decalMaps, 1, 1)
  for (const mat of [mats.decal, mats.puddle]) {
    mat.transparent = true; mat.depthWrite = false; mat.polygonOffset = true; mat.polygonOffsetFactor = -2
    mat.normalScale.set(.18, .18)
  }
  mats.puddle.envMapIntensity = 1.6
  mats.puddle.opacity = .45
  // One 2048 atlas batches all signs into one PBR material, including animated shutters.
  const labelTexture=canvasTexture(()=>{},2048,2048), labelCanvas=labelTexture.image
  const labelMaterial=new api.PhysicalMaterial({map:labelTexture,normalMap:paint.normalMap,
    roughnessMap:paint.arm,aoMap:paint.arm,metalnessMap:paint.arm,metalness:.05,roughness:1,
    transparent:true,depthWrite:false,side:api.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2})
  labelMaterial.name='Map weathered signage atlas'
  combineOrmMaterial(labelMaterial)
  const labels=new Map()
  function label(text,color='#c5cccb',background=null) {
    const key=[text,color,background].join('|')
    if(labels.has(key))return labels.get(key)
    const index=labels.size,w=512,h=192,x=(index%4)*w,y=Math.floor(index/4)*h
    if(y+h>2048)throw new Error('Map signage atlas capacity exceeded')
    const ctx=labelCanvas.getContext('2d')
    ctx.globalCompositeOperation='source-over'
    if(background){ctx.fillStyle=background;ctx.fillRect(x,y,w,h)}
    ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle'
    const lines=text.split('\n');ctx.font=`bold ${lines.length>1?58:84}px Arial, sans-serif`
    lines.forEach((line,i)=>ctx.fillText(line,x+w/2,y+h/2+(i-(lines.length-1)/2)*57,w-34))
    ctx.globalCompositeOperation='destination-out'
    for(let i=0;i<650;i++){ctx.fillStyle='#0009';ctx.fillRect(x+rand()*(w-7),y+rand()*(h-3),rand()*7,1+rand()*2)}
    labelTexture.needsUpdate=true
    const handle={mapLabel:{material:labelMaterial,rect:[x/2048,1-(y+h)/2048,w/2048,h/2048]}}
    labels.set(key,handle)
    return handle
  }
  const particle = canvasTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, '#ffffffff'); g.addColorStop(0.25, '#ffffff90'); g.addColorStop(1, '#ffffff00')
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  }, 64, 64)
  const flame = canvasTexture((ctx, w, h) => {
    for (let i = 0; i < 7; i++) {
      const x = w * (0.2 + i * 0.1), height = h * (0.45 + rand() * 0.5)
      const g = ctx.createLinearGradient(0, h, 0, h - height)
      g.addColorStop(0, '#fffbd0ee'); g.addColorStop(0.3, '#ffbb32dd'); g.addColorStop(0.75, '#fa500b77'); g.addColorStop(1, '#ff170000')
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 22, h)
      ctx.bezierCurveTo(x - 34, h - height * 0.5, x + 24, h - height * 0.5, x + 12, h - height)
      ctx.bezierCurveTo(x + 48, h - height * 0.3, x + 30, h - height * 0.3, x + 22, h)
      ctx.fill()
    }
  }, 128, 256)
  return {mats, label, particle, flame, textures, ready: Promise.all(pending), surfaceUniforms}
}
