import {
  Group, Mesh2, UnlitMaterial, SphereGeometry, PlaneGeometry, CylinderGeometry, DataTexture,
  RGBAFormat, SRGBColorSpace, LinearFilter, RepeatWrapping, BackSide, DoubleSide,
  Color, FogExp2, DirectionalLight, HemisphereLight, TonemapPlugin, SpotLight, Vector3,
} from 'threepipe'
import {setAuthoringMetadata} from '@kite3d/engine'
import {bakeSky, bakeSmoke, bakeMist, bakePlume, bakeHorizonHaze} from './lighting-noise.js'
import {loadBakedLightingNoise} from './lighting-noise-baked.js'

/** Bounded art controls; quantities are linear light intensities except hexadecimal sRGB colors. */
export const V2_LIGHTING_PARAMS = Object.freeze({
  keyIntensity: 2.8, keyColor: 0xadcaff, fillIntensity: .13, fillColor: 0x7495c4, groundBounceColor: 0x5576a3,
  rimIntensity: 2.1, environmentIntensity: .10, exposure: 1,
  fogColor: 0x23364e, fogDensity: .0115, skyIntensity: 1.05,
  hazeOpacity: .32, bankRadiance: .28, plumeOpacity: .96, plumeRadiance: .40, shaftOpacity: .026, courtyardPower: 20, dockPower: 27,
  buildingPower: 26, fixtureScale: .022, exitScale: 1, bounceScale: 1, lampHazeOpacity: .055, exitHazeOpacity: .06, windowFillPower: 26,
})
const FOG_DENSITIES = [.0115, .021, .036, .058]

export function lightingPlumeUrl(index, moduleUrl = import.meta.url) {
  return new URL(`../../../assets/v2/lighting/plume-${index}.rgba`, moduleUrl).href
}

/** Caller owns root. Call after MapView.sync, and dispose before MapView.stop. No camera changes. */
export function mountV2Lighting({viewer, root, map, refs = {}, preview = false, params = {},
  loadNoisePixels = globalThis.window?.location?.origin && typeof fetch==='function' ? loadBakedLightingNoise : null}) {
  if (!viewer?.scene || !root?.add) throw new TypeError('V2 lighting requires viewer.scene and root')
  const p = {...V2_LIGHTING_PARAMS, ...params}
  const group = new Group(); group.name = 'V2 cold sky and distant atmosphere'
  group.userData.v2Lighting = true; group.userData.preview = preview
  const ownedMaterials = new Set(), ownedGeometry = new Set(), ownedTextures = new Set()
  const restorers = [], scene = viewer.scene
  let disposed = false
  const loadBakedPlumes=Boolean(globalThis.window?.location?.origin && typeof fetch==='function')
  const assetAbort=loadBakedPlumes||loadNoisePixels?new AbortController():null
  const pendingAssets=[]
  const noiseAssets=loadNoisePixels?Promise.resolve().then(()=>loadNoisePixels({signal:assetAbort.signal})):null
  const noiseTextures=[]
  // No unready atmosphere is rendered. MapView awaits this handle's ready before
  // match warmup, which uploads and renders the complete textures before input.
  if(noiseAssets)group.visible=false
  const saveProperty = (object, key) => { const value = object[key]; restorers.push(() => {object[key] = value}) }
  for (const key of ['fog', 'background', 'backgroundIntensity', 'environmentIntensity', 'autoDisposeSceneMaps']) saveProperty(scene, key)
  // Suppress scene-map auto-disposal while replacing an HDR background also used for reflections.
  scene.autoDisposeSceneMaps = false
  const background = new Color(0x080e19), fog = new FogExp2(p.fogColor, p.fogDensity)
  const tonemap = viewer.getPlugin?.(TonemapPlugin)
  if (tonemap) saveProperty(tonemap, 'exposure')
  const texture = (pixels, srgb = false) => {
    const result = new DataTexture(pixels.data, pixels.width, pixels.height, RGBAFormat)
    if (srgb) result.colorSpace = SRGBColorSpace
    result.minFilter = result.magFilter = LinearFilter; result.generateMipmaps = false
    if(pixels.data)result.needsUpdate = true
    ownedTextures.add(result); return result
  }
  const productionTexture=(id,procedural,srgb=false)=>{
    if(!noiseAssets)return texture(procedural(),srgb)
    const result=texture({data:null,width:1,height:1},srgb)
    noiseTextures.push([result,id]);return result
  }
  const skyMap = productionTexture('sky',bakeSky,true); skyMap.wrapS = RepeatWrapping
  skyMap.name = 'V2 baked seamless cold cloud sky'
  const mesh = (name, geometry, material) => {
    ownedGeometry.add(geometry); ownedMaterials.add(material)
    const object = new Mesh2(geometry, material); object.name = name
    object.castShadow = object.receiveShadow = false
    object.userData.mapEffect = true; group.add(object); return object
  }
  const sky = mesh('V2 fixed smoky sky dome', new SphereGeometry(118, 48, 24),
    new UnlitMaterial({map: skyMap, color: new Color().setScalar(p.skyIntensity), side: BackSide, fog: false, depthWrite: false}))
  // This is a hollow sky enclosure, not solid gameplay geometry.
  setAuthoringMetadata(sky, {role: 'direct', id: 'v2-lighting-sky', allowCameraInside: true})
  // A round shell preserves the angular projection of the 3D volume; never squash its Y axis.
  sky.renderOrder = -1000; sky.frustumCulled = false
  const plane = new PlaneGeometry(1, 1)
  const smokeMaterials = Array.from({length: 6}, (_, i) => {
    const map = productionTexture(i<4?`plume-${i}`:`smoke-${i}`,()=>i < 4 ? bakePlume(loadBakedPlumes?32:384, i) : bakeSmoke(384, i)); map.name = `V2 independent smoke volume ${i + 1}`
    if(i<4 && loadBakedPlumes && !noiseAssets) {
      const url=lightingPlumeUrl(i)
      pendingAssets.push(fetch(url,{signal:assetAbort.signal}).then(async response=>{
        if(!response.ok)throw new Error(`V2 smoke asset ${url}: HTTP ${response.status}`)
        const buffer=await response.arrayBuffer()
        if(buffer.byteLength!==512*512*4)throw new Error(`V2 smoke asset ${url}: invalid RGBA size`)
        if(disposed)return
        map.image={data:new Uint8Array(buffer),width:512,height:512};map.needsUpdate=true;viewer.setDirty?.()
      }).catch(error=>{if(!disposed)throw error}))
    }
    const material = new UnlitMaterial({map, color: new Color().setScalar(i < 4 ? p.plumeRadiance : p.bankRadiance), transparent: true,
      // Dense smoke has integrated optical depth; thin-haze attenuation must not cap its core.
      opacity: i < 4 ? p.plumeOpacity * [1,.96,.98,.94][i] : p.hazeOpacity * [.82,.58][i-4], depthWrite: false, side: DoubleSide, fog: true})
    ownedMaterials.add(material); return material
  })
  // Four connected rising masses with offset upper lobes, rooted below the
  // distant roof line. Shared roots do not follow any camera or player position.
  const banks = [
    [-44,13,48,24,38,.10],[-40,31,51,30,34,-.08],
    [48,12,47,22,35,-.12],[52,28,51,27,31,.08],
    [-56,14,-35,23,40,.12],[-51,33,-38,29,36,-.10],
    [24,13,-66,21,37,-.10],[29,29,-69,27,33,.13],
  ]
  for (const [i, [x,y,z,width,height,turn]] of banks.entries()) {
    const bank = mesh(`V2 distant smoke bank ${i + 1}`, plane, smokeMaterials[(Math.floor(i/2)+(i%2)*2)%4])
    bank.position.set(x,y,z); bank.scale.set(width,height,1)
    bank.lookAt(0,y,0); bank.rotateY(turn); bank.rotateZ(i%2 ? -.09 : .06)
  }
  const horizonMap=productionTexture('horizon',bakeHorizonHaze); horizonMap.name='V2 continuous lower haze profile'
  const horizon=mesh('V2 continuous ruined-horizon air',new CylinderGeometry(78,78,30,64,1,true),
    new UnlitMaterial({map:horizonMap,color:0x506787,opacity:.12,transparent:true,
      side:BackSide,depthWrite:false,fog:false}))
  horizon.position.y=9
  setAuthoringMetadata(horizon,{role:'direct',id:'v2-lighting-horizon-air',allowCameraInside:true})
  // Sparse, shallow haze behind cover breaks the uniform fog without covering player space.
  const depthBanks = [[-15, 2.5, 19, 16, 5, 0], [17, 2.2, 24, 19, 4, .2],
    [29, 2.4, -1, 12, 5, 1.2], [-26, 1.9, -14, 15, 4, -.45]]
  for (const [i, [x, y, z, width, height, angle]] of depthBanks.entries()) {
    const material = smokeMaterials[4 + i % 2].clone()
    material.opacity = .14
    material.color.set(i % 2 ? 0x9cbbe6 : 0x789ccc)
    const bank = mesh(`V2 cover depth haze ${i + 1}`, plane, material)
    bank.position.set(x, y, z); bank.scale.set(width, height, 1); bank.rotation.y = angle
  }
  // Actual haze-off driver proof showed the .28 face-on sheet hid stair tread
  // contrast. Put cool low-radiance air beyond the top landing, behind geometry.
  const mistMap = productionTexture('mist',bakeMist); mistMap.name = 'V2 illuminated exit air'
  const interiorBanks = [[-36, .5, 22.1, 3.2, 3, 0], [36, 1.6, 25.2, 6, 2.8, 0],
    [36, 2.45, 14, 6, 15, -Math.PI / 2], [-35.8, -.85, 3, 7, 23, -Math.PI / 2]]
  for (const [i, [x, y, z, width, height, tilt]] of interiorBanks.entries()) {
    const material = smokeMaterials[4 + i % 2].clone()
    material.opacity = i < 2 ? p.exitHazeOpacity : .055
    if (i < 2) material.map = mistMap
    material.color.set(i < 2 ? 0x678bb8 : 0xb3d2ff)
    const bank = mesh(`V2 interior suspended haze ${i + 1}`, plane, material)
    bank.position.set(x, y, z); bank.scale.set(width, height, 1); bank.rotation.x = tilt
  }
  // The visible service risers face -Z. Exit cones must shine +Z from inside the
  // corridor; the R2 sources behind the risers illuminated their hidden sides.
  // Wide upward cones approximate floor-reflected light. Their sources are 2.65 m
  // below the ceiling. Two overlapping lobes per corridor distribute the return
  // along pipes/soffits. Linear attenuation approximates an extended reflected
  // source; the exit lamps retain inverse-square falloff. No downward floor spill.
  const exitLights = []
  for (const spec of [
    {name: 'service stair daylight', zone: 'courtyard', position: [-37.25, -.95, 13.4], target: [-35.6, -1, 19.3], power: 42*p.exitScale, angle: .95, penumbra: .9},
    {name: 'barracks exit practical', zone: 'building', position: [36, 2.3, 20], target: [36, 1.4, 27.5], power: 32*p.exitScale, angle: .95, penumbra: .9},
    // Fixed exterior sources cross actual open side-window bays, grazing the
    // inward-facing partition surfaces instead of front-lighting a blank exit.
    {name: 'barracks west window crosslight', zone: 'building', position: [29.8,2,12.5], target: [38,1.2,14], power:p.windowFillPower, angle:.72, distance:15, penumbra:1},
    {name: 'barracks east window crosslight', zone: 'building', position: [42.2,1.9,7.4], target: [33.5,1.1,9.5], power:p.windowFillPower, angle:.72, distance:15, penumbra:1},
    {name: 'service ceiling bounce near', zone: 'courtyard', position: [-36,-3.15,-8], target: [-36,-.5,-8], power: 6*p.bounceScale, angle: 1.46, distance: 18, penumbra: 1, decay: 1},
    {name: 'service ceiling bounce far', zone: 'courtyard', position: [-36,-3.15,5], target: [-36,-.5,5], power: 6*p.bounceScale, angle: 1.46, distance: 18, penumbra: 1, decay: 1},
    {name: 'barracks ceiling bounce near', zone: 'building', position: [36,.35,7.7], target: [36,3,7.7], power: 5*p.bounceScale, angle: 1.46, distance: 18, penumbra: 1, decay: 1},
    {name: 'barracks ceiling bounce far', zone: 'building', position: [36,.35,17.3], target: [36,3,17.3], power: 5*p.bounceScale, angle: 1.46, distance: 18, penumbra: 1, decay: 1},
  ]) {
    const light = new SpotLight(0xa7c6fa, spec.power, spec.distance || 14, spec.angle, spec.penumbra ?? .65, spec.decay ?? 2)
    light.name = `V2 ${spec.name}`; light.position.set(...spec.position); light.target.position.set(...spec.target)
    light.castShadow = false; group.add(light, light.target); exitLights.push({light, zone: spec.zone, power: spec.power})
  }
  // Short damaged brackets are bolted into existing ruined wall tops. Fixed map
  // supports keep them coherent in every POV; no parking-lot poles or new colliders.
  const coreGeometry=new CylinderGeometry(.23,.23,.08,12),housingGeometry=new CylinderGeometry(.34,.43,.55,8)
  const braceGeometry=new CylinderGeometry(.045,.07,1,5,1)
  const coreMaterial=new UnlitMaterial({color:new Color(0xb9d4ff).multiplyScalar(6),fog:false})
  const housingMaterial=new UnlitMaterial({color:0x111b2a,fog:false})
  const supports=[
    {id:'exp_stores_rear',x:-39.5,z:28,y:6},
    {id:'exp_pump_rear',x:-39.5,z:-28,y:5},
    {id:'building_back',x:11.5,z:27,y:6},
  ]
  const up=new Vector3(0,1,0)
  for (const [i,support] of supports.entries()) {
    const authored=map?.colliders?.find(c=>c.id===support.id)
    const baseY=authored ? authored.center.y+authored.size.y/2 : support.y
    const fixture=new Group();fixture.name=`V2 distant flood fixture ${i+1}`
    fixture.position.set(support.x,baseY-.15,support.z)
    fixture.lookAt(0,baseY-.15,0);fixture.userData.supportCollider=support.id;group.add(fixture)
    const head=new Vector3(i%2?-.4:.3,1.85,.62)
    const housing=mesh(`V2 distant flood housing ${i+1}`,housingGeometry,housingMaterial)
    housing.position.copy(head);housing.rotation.x=Math.PI/2+.12;fixture.add(housing)
    const core=mesh(`V2 distant floodlamp core ${i+1}`,coreGeometry,coreMaterial)
    core.position.copy(head).add(new Vector3(0,-.035,.31));core.rotation.copy(housing.rotation);fixture.add(core)
    const bend=[i%2?-.16:.10,1.12,.06]
    for (const [j,[a,b]] of [ [[0,-.35,0],bend],[bend,head.toArray()],[[.48,-.25,.02],head.toArray()] ].entries()) {
      const brace=mesh(`V2 broken searchlight brace ${i+1}.${j+1}`,braceGeometry,housingMaterial)
      const from=new Vector3(...a),to=new Vector3(...b),direction=to.clone().sub(from)
      brace.position.copy(from).add(to).multiplyScalar(.5)
      brace.scale.y=direction.length();brace.quaternion.setFromUnitVectors(up,direction.normalize());fixture.add(brace)
    }
    const spill=mesh(`V2 floodlamp source-depth smoke ${i+1}`,plane,
      new UnlitMaterial({map:mistMap,color:0x9ebee9,opacity:p.lampHazeOpacity,
        transparent:true,depthWrite:false,side:DoubleSide,fog:false}))
    spill.position.copy(head).add(new Vector3(0,-.65,.65));spill.scale.set(3,4.5,1)
    spill.rotation.x=.12;fixture.add(spill)
  }
  // Reuse the existing shadow map and key instead of adding another expensive shadow pass.
  const existingKey = root.getObjectByName('Map moon shadow key')
  const key = existingKey || new DirectionalLight()
  const fill = root.getObjectByName('Map night sky fill') || new HemisphereLight()
  const saveLight = light => {
    const color = light.color.clone(), ground = light.groundColor?.clone(), position = light.position.clone()
    const intensity = light.intensity
    restorers.push(() => {light.color.copy(color); light.groundColor?.copy(ground); light.position.copy(position); light.intensity = intensity})
  }
  if (existingKey) saveLight(key)
  else {key.name = 'V2 preview cold key'; group.add(key, key.target)}
  if (fill.parent) saveLight(fill)
  else {fill.name = 'V2 preview sky fill'; group.add(fill)}
  // Preserve elevation/flat-ground incidence; move the reflection away from the
  // experimentally isolated barracks pool without dimming all foreground light.
  key.position.set(-38, 12, 25)
  const rim = new DirectionalLight(0x7199e0, p.rimIntensity)
  rim.name = 'V2 fixed southwest wall crosslight'; rim.position.set(-45, 8, -55)
  rim.castShadow = false; group.add(rim, rim.target)
  const sources = []
  for (const zone of refs.zones || []) {
    saveProperty(zone, 'power'); saveLight(zone.light)
    const power = zone.id === 'building' ? p.buildingPower : zone.id === 'dock' ? p.dockPower : p.courtyardPower
    sources.push({entry: zone, zone: zone.id, power, color: new Color(zone.id === 'building' ? 0x9ab5dc : 0x9fbded)})
  }
  for (const fixture of refs.fixtureLights || []) {
    saveProperty(fixture, 'power'); saveLight(fixture.light)
    sources.push({entry: fixture, zone: fixture.zone, power: fixture.power * p.fixtureScale,
      color: new Color(fixture.zone === 'service' ? 0xa2becf : 0xa7c2e9)})
  }
  const shafts = refs.weather?.shafts || []
  for (const shaft of shafts) {
    const original = shaft.beam.material, clone = original.clone()
    shaft.beam.material = clone; ownedMaterials.add(clone)
    restorers.push(() => {shaft.beam.material = original})
    saveProperty(shaft, 'power'); saveProperty(shaft.beam, 'visible'); saveLight(shaft.light)
  }
  const pools = []
  root.traverse(object => {if (/^Bunker local light \d+$/.test(object.name)) {pools.push(object); saveLight(object)}})
  root.add(group)
  function sync(world) {
    if (disposed) return
    const state = world?.mapState || {}, time = preview ? 0 : (world?.tick || 0) / 60
    // MapView may complete its HDR import after mount. Retain that environment for specular detail.
    scene.autoDisposeSceneMaps = false
    if (scene.background !== background) scene.background = background
    scene.backgroundIntensity = 1; scene.environmentIntensity = p.environmentIntensity
    if (scene.fog !== fog) scene.fog = fog
    const index = Math.max(0, Math.min(3, Math.floor(Number(state.fog) || 0)))
    fog.density = index === 0 ? p.fogDensity : FOG_DENSITIES[index]
    if (tonemap) tonemap.exposure = p.exposure
    key.color.set(p.keyColor); key.intensity = p.keyIntensity
    fill.color.set(p.fillColor); fill.groundColor.set(p.groundBounceColor); fill.intensity = p.fillIntensity
    for (const source of exitLights) source.light.intensity = state.lights?.[source.zone] === 'off' ? 0 : source.power
    for (const source of sources) {
      const {entry, zone, power, color} = source
      entry.power = power; entry.light.color.copy(color)
      const flicker = entry.id === 'service-1' && Math.sin(time * 39) > .92 ? .35 : 1
      entry.light.intensity = state.lights?.[zone] === 'off' ? 0 : power * flicker
      // MapView selected these positions earlier in the same frame. Correct pool radiance too.
      for (const pooled of pools) if (pooled.position.distanceToSquared(entry.light.position) < .0001) {
        pooled.color.copy(color); pooled.intensity = entry.light.intensity
      }
    }
    for (const shaft of shafts) {
      const on = state.lights?.[shaft.zone] !== 'off'
      shaft.power = shaft.zone === 'courtyard' ? 110 : shaft.zone === 'dock' ? 45 : 20
      shaft.light.color.set(0xb5d0ff)
      shaft.light.intensity = on && shaft.directLight ? shaft.power : 0
      shaft.beam.visible = on
      if (shaft.beam.material.uniforms?.opacity) shaft.beam.material.uniforms.opacity.value = p.shaftOpacity
    }
  }
  sync()
  if(noiseAssets)pendingAssets.push(noiseAssets.then(pixels=>{
    if(disposed)return
    for(const [texture,id] of noiseTextures){
      if(!pixels[id]?.data)throw new Error(`V2 atmosphere asset: missing ${id}`)
      texture.image={...pixels[id]};texture.needsUpdate=true
    }
    viewer.setDirty?.()
  }).catch(error=>{if(!disposed)throw error}))
  viewer.setDirty?.()
  return {
    root: group, params: Object.freeze(p), ready: Promise.all(pendingAssets).then(()=>{if(!disposed)group.visible=true}), sync,
    dispose() {
      if (disposed) return
      disposed = true
      assetAbort?.abort()
      group.removeFromParent()
      for (let i = restorers.length - 1; i >= 0; i--) restorers[i]()
      // Geometry/materials are shared between owned banks: dispose each resource exactly once.
      for (const material of ownedMaterials) material.dispose()
      for (const geometry of ownedGeometry) geometry.dispose()
      for (const item of ownedTextures) item.dispose()
      group.clear(); viewer.setDirty?.()
    },
  }
}
