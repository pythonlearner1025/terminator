import * as E from 'threepipe'
import {buildEffectsEmitters, effectsSeed, effectsTime, sampleEffectsParticle} from './effects-simulation.js'
import {createEffectsAtlas} from './effects-textures.js'

export {EFFECTS_LIMITS} from './effects-simulation.js'

/** Near-field V2 effects. Call after MapView.sync. world.time fallback is seconds; tick is 60 Hz.
 * No timers, RNG, camera changes, gameplay writes, global settings or source-material changes.
 * ready resolves after the local atlas loads; dispose is safe before or after ready.
 */
export function mountV2Effects({viewer, root, map = {}, refs = {}, preview = false}) {
  if (!root?.add) throw new TypeError('mountV2Effects requires a caller-owned Object3D root')
  const group = new E.Group()
  group.name = 'V2 localized fire smoke steam and sparks'
  group.userData.v2Effects = {preview, deterministic:true, clock:'world.tick / 60', texture:'assets/v2/effects/particles.png'}
  root.add(group)
  let disposed = false, lastTime = NaN
  const saved = [], muted = new Set()
  function mute(object, key = 'visible', value = false, seed = 0) {
    if (!object || muted.has(object)) return
    muted.add(object); saved.push({object, key, previous:object[key], value, seed}); object[key] = value
  }
  for (const fire of refs.fires || []) {
    mute(fire.flame); mute(fire.smoke)
    mute(fire.light, 'intensity', 1.45, effectsSeed(JSON.stringify(fire.pos)))
  }
  mute(refs.atmosphere?.steam); mute(refs.atmosphere?.sparks)
  for (const hazard of refs.hazards || []) mute(hazard.steam)
  // Electrical hazard arcs/lights remain the original gameplay-controlled visuals.
  let texture, ready
  if (typeof document === 'undefined') {
    const atlas = createEffectsAtlas()
    texture = new E.DataTexture(atlas.data, atlas.width, atlas.height, E.RGBAFormat)
    texture.flipY = true; texture.needsUpdate = true
    ready = Promise.resolve()
  } else {
    ready = new Promise((resolve, reject) => {
      texture = new E.TextureLoader().load(new URL('../../../assets/v2/effects/particles.png', import.meta.url).href, loaded => {
        if (disposed) loaded.dispose()
        else { group.visible = true; viewer?.setDirty?.() }
        resolve()
      }, undefined, error => { if (disposed) resolve(); else reject(new Error('V2 effects atlas failed to load', {cause:error})) })
    })
    group.visible = false
  }
  texture.name = 'V2 original soft particle density atlas'
  texture.colorSpace = E.SRGBColorSpace
  texture.wrapS = texture.wrapT = E.ClampToEdgeWrapping
  texture.minFilter = E.LinearMipmapLinearFilter; texture.magFilter = E.LinearFilter; texture.generateMipmaps = true
  const material = new E.UnlitMaterial({name:'V2 depth-tested density particles', map:texture, color:0xffffff, transparent:true, depthTest:true, depthWrite:false, fog:true, side:E.FrontSide, blending:E.NormalBlending})
  material.userData.renderToGBuffer = false
  const compile = material.onBeforeCompile.bind(material)
  const cacheKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => cacheKey() + ':v2-local-particles-2'
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer)
    shader.vertexShader = `attribute vec3 fxPosition;
attribute vec4 fxShape;
attribute vec4 fxColor;
attribute float fxTile;
varying vec4 vFxColor;
varying float vFxNearFade;
varying vec3 vFxUvMode;
` + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
vMapUv = (uv + vec2(mod(fxTile, 4.0), 1.0 - floor(fxTile / 4.0))) / vec2(4.0, 2.0);
#endif
vFxColor = fxColor;
vFxUvMode = vec3(uv, fxShape.w);`)
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = fxPosition;')
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
vec2 corner = position.xy * fxShape.xy;
float cs = cos(fxShape.z), sn = sin(fxShape.z);
vec2 rotated = vec2(cs * corner.x - sn * corner.y, sn * corner.x + cs * corner.y);
float rootScale = min(length(modelMatrix[0].xyz), min(length(modelMatrix[1].xyz), length(modelMatrix[2].xyz)));
if (fxShape.w > 0.5) {
  // Beds stay on the lid; upright wisps retain world-up as the player looks
  // down or moves around the barrel. Their distinct XZ origins provide parallax.
  vec3 localOffset;
  if (fxShape.w < 1.5) localOffset = vec3(rotated.x, 0.0, -rotated.y);
  else {
    vec2 horizontalRight = vec2(modelViewMatrix[0].x, modelViewMatrix[2].x);
    horizontalRight = length(horizontalRight) > 0.0001 ? normalize(horizontalRight) : vec2(1.0, 0.0);
    localOffset = vec3(horizontalRight.x * rotated.x, rotated.y, horizontalRight.y * rotated.x);
  }
  mvPosition += modelViewMatrix * vec4(localOffset, 0.0);
} else mvPosition.xy += rotated * rootScale;
vFxNearFade = smoothstep(0.25, 0.85, -mvPosition.z);
gl_Position = projectionMatrix * mvPosition;`)
    shader.fragmentShader = 'varying vec4 vFxColor;\nvarying float vFxNearFade;\nvarying vec3 vFxUvMode;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
diffuseColor.rgb *= vFxColor.rgb;
if (vFxUvMode.z > 0.5) {
  // Density erosion produces short broken curls, not the atlas's repeated tongues.
  float density = diffuseColor.a;
  diffuseColor.a = smoothstep(0.075, 0.48, density);
  if (vFxUvMode.z > 1.5) diffuseColor.a *= 1.0 - smoothstep(0.55, 1.0, vFxUvMode.y);
}
diffuseColor.a *= vFxColor.a * vFxNearFade;
if (diffuseColor.a < 0.001) discard;`)
  }
  const emitters = buildEffectsEmitters(map, refs)
  const batches = emitters.map(emitter => {
    const plane = new E.PlaneGeometry(1, 1)
    const geometry = new E.InstancedBufferGeometry()
    geometry.index = plane.index.clone()
    for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, plane.attributes[name].clone())
    plane.dispose()
    geometry.instanceCount = emitter.count
    for (const [name, stride] of [['fxPosition',3], ['fxShape',4], ['fxColor',4], ['fxTile',1]]) {
      geometry.setAttribute(name, new E.InstancedBufferAttribute(new Float32Array(emitter.count * stride), stride).setUsage(E.DynamicDrawUsage))
    }
    geometry.boundingSphere = new E.Sphere(new E.Vector3(0, 1, 0), 5)
    const mesh = new E.Mesh2(geometry, material)
    mesh.name = `V2 ${emitter.id}`
    mesh.position.fromArray(emitter.pos)
    mesh.castShadow = mesh.receiveShadow = false
    mesh.userData.v2Emitter = {kind:emitter.kind, count:emitter.count, seed:emitter.seed, ceiling:Number.isFinite(emitter.ceiling) ? emitter.ceiling : null}
    group.add(mesh)
    return {emitter, geometry, mesh, positions:geometry.attributes.fxPosition, shapes:geometry.attributes.fxShape, colors:geometry.attributes.fxColor, tiles:geometry.attributes.fxTile}
  })
  const sample = new Float64Array(12)
  const handle = {
    root:group,
    ready,
    stats:Object.freeze({emitters:emitters.length, particles:emitters.reduce((n,e) => n + e.count, 0), maxDrawCalls:batches.length, materials:1, textures:1, atlasBytesWithMipmaps:Math.ceil(512 * 256 * 4 * 4 / 3)}),
    sync(world) {
      if (disposed) return
      // MapView updates these each frame; suppress them even when the simulation tick is frozen.
      const time = effectsTime(world, preview)
      for (const entry of saved) entry.object[entry.key] = entry.key === 'intensity'
        ? 1.45 + .22 * Math.sin(time * 8.1 + entry.seed * 29) + .12 * Math.sin(time * 17.3 + entry.seed * 17)
        : entry.value
      for (const batch of batches) {
        const {emitter, mesh, positions, shapes, colors, tiles} = batch
        if (emitter.kind === 'hazard') {
          let active = false
          for (const hazard of world?.mapState?.hazards || EMPTY) if (hazard.slot === emitter.hazardId && hazard.kind === 'steam') { active = true; break }
          mesh.visible = preview || active
        }
        if (time === lastTime) continue
        for (let i = 0; i < emitter.count; i++) {
          sampleEffectsParticle(emitter, i, time, sample)
          positions.setXYZ(i, sample[0] - emitter.pos[0], sample[1] - emitter.pos[1], sample[2] - emitter.pos[2])
          shapes.setXYZW(i, sample[3], sample[4], sample[5], sample[11])
          colors.setXYZW(i, sample[8], sample[9], sample[10], sample[6])
          tiles.setX(i, sample[7])
        }
        positions.needsUpdate = shapes.needsUpdate = colors.needsUpdate = tiles.needsUpdate = true
      }
      lastTime = time
    },
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      for (const batch of batches) { batch.mesh.removeFromParent(); batch.geometry.dispose() }
      material.dispose(); texture.dispose()
      for (const entry of saved) entry.object[entry.key] = entry.previous
      viewer?.setDirty?.()
    },
  }
  handle.sync()
  return handle
}
const EMPTY = Object.freeze([])
