import * as engine from 'threepipe'
import {RuntimeObjectOwner} from '@kite3d/engine'
import {createMapGroup} from '../../generators/map.geometry.js'
import {MapPost} from './post.js'
import {WEATHER_DEFAULTS} from './weather.js'
import {getQualityPreset} from './performance-quality.js'
export {createMapGroup} from '../../generators/map.geometry.js'

export const MAP_FOG_DENSITIES = [0.0045, 0.018, 0.035, 0.058]

export class MapView {
  constructor(viewer, map) {
    this.viewer = viewer; this.map = map; this.previewChildren = []; this.hiddenLights = []
    this.quality = getQualityPreset('high')
  }
  start() {
    this.stop()
    const source = this.viewer.scene.modelRoot.getObjectByName('Map')
    if (!source) throw new Error('Map authored node not found')
    this.previewChildren = source.children.filter(child => child.userData?.kite3dGenerated === true)
    this.previewVisibility = this.previewChildren.map(child => child.visible)
    for (const child of this.previewChildren) child.visible = false
    this.owner = new RuntimeObjectOwner('terminator-map-view')
    this.root = this.owner.attachRuntimeRoot(new engine.Group(), this.viewer.scene, source)
    this.root.name = 'Map Runtime'
    this.geometry = createMapGroup(engine, this.map, {markers: false, runtime: true})
    this.root.add(this.geometry); this.refs = this.geometry.mapRefs
    if (new URLSearchParams(globalThis.location?.search || '').get('colliders') === '1') {
      this.debugColliders = createColliderWireframes(this.map)
      this.root.add(this.debugColliders)
    }
    this.root.updateMatrixWorld(true)
    this.localLightEntries=[]
    this.root.traverse(light=>{
      if(!light.isPointLight)return
      const position=new engine.Vector3();light.getWorldPosition(position);this.root.worldToLocal(position)
      light.visible=false;this.localLightEntries.push({light,position,score:0,selected:false})
    })
    this.localLights=Array.from({length:4},(_,index)=>{
      const light=new engine.PointLight(0xffffff,0,12,2);light.name=`Bunker local light ${index+1}`
      light.visible=true;light.castShadow=false;this.root.add(light);return light
    })
    const scene = this.viewer.scene
    this.saved = {fog: scene.fog, background: scene.background, environment: scene.environment,
      environmentIntensity: scene.environmentIntensity, backgroundIntensity: scene.backgroundIntensity, backgroundColor: scene.backgroundColor, autoDisposeSceneMaps: scene.autoDisposeSceneMaps}
    // The editor owns its saved environment. Keep it alive while the runtime sky is active.
    scene.autoDisposeSceneMaps = false
    const activeRoot = this.root
    this.ready = Promise.all([this.geometry.mapReady, this.viewer.import(new URL('../../assets/hdri/qwantani_moon_noon_puresky_2k.hdr', import.meta.url).href)]).then(([, texture]) => {
      if (this.root !== activeRoot) { texture?.dispose(); return }
      this.environment = texture
      scene.environment = texture; scene.background = texture
      scene.environmentIntensity = WEATHER_DEFAULTS.environmentIntensity
      scene.backgroundIntensity = WEATHER_DEFAULTS.skyIntensity
      this.viewer.setDirty()
    }).catch(error => { if (this.root === activeRoot) console.error('[Map] Environment assets failed to load', error) })
    scene.fog = new engine.FogExp2(0x132131, MAP_FOG_DENSITIES[0])
    scene.background = new engine.Color(0x02050a)
    // Existing authored lights are restored on Stop, without editing their saved intensity.
    for (const name of ['Cool Blue Key', 'Orange Fill']) {
      const light = scene.modelRoot.getObjectByName(name)
      if (light) { this.hiddenLights.push([light, light.visible]); light.visible = false }
    }
    this.eventIndex = 0; this.lastTick = 0; this.brokenAt = null
    this.post = new MapPost(this.viewer, this.quality); this.post.start()
    this.setQuality(this.quality)
    this.viewer.renderManager.resetShadows()
    this.audioGesture = () => this.startHum()
    window.addEventListener('pointerdown', this.audioGesture)
    window.addEventListener('keydown', this.audioGesture)
  }
  startHum() {
    if (!this.root) return
    if (!this.audio) {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return
      const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain()
      oscillator.type = 'sawtooth'; oscillator.frequency.value = 60; gain.gain.value = 0
      const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 280
      oscillator.connect(filter); filter.connect(gain); gain.connect(context.destination); oscillator.start()
      this.audio = {context, oscillator, gain, filter}
    }
    if (this.audio.context.state === 'suspended') this.audio.context.resume().catch(() => {})
  }
  sync(world) {
    if (!this.root) return
    const state = world.mapState, t = world.tick / 60, dt = Math.min(0.1, Math.max(0, (world.tick - this.lastTick) / 60))
    this.lastTick = world.tick
    const ease = 1 - Math.exp(-dt * 7)
    this.viewer.scene.fog.density = MAP_FOG_DENSITIES[Math.max(0, Math.min(3, state.fog || 0))]
    for (const zone of this.refs.zones) {
      const on = state.lights[zone.id] !== 'off'
      zone.light.visible = false
      zone.light.intensity = on ? zone.power : 0
      zone.fixtureMaterial.emissiveIntensity = on ? 3 : 0
    }
    this.refs.weather.sync(t, state)
    this.refs.surfaceUniforms.mapWetness.value = this.refs.weather.settings.wetness
    this.post?.sync(t)
    let moving = false
    for (const door of this.refs.doors) {
      const mode = state.doors[door.id], locked = mode === 'locked'
      const distance = Math.hypot(world.player.pos.x - door.pos.x, world.player.pos.z - door.pos.z)
      // 'unlocked' is the current core's passable state. Open before the player reaches the leaf.
      const open = mode === 'open' || (!locked && mode !== 'closed' && distance < 7)
      const next = open ? 1 : 0
      const old = door.amount
      door.amount += (next - door.amount) * ease
      if (Math.abs(door.amount - next) < 0.005) door.amount = next
      door.shutter.scale.y = Math.max(0.015, 1 - door.amount)
      door.shutter.position.y = door.amount * door.height / 2
      door.shutter.visible = door.amount < 0.99
      door.signal.visible = locked
      moving ||= Math.abs(old - door.amount) > 0.005
    }
    for (; this.eventIndex < world.eventLog.length; this.eventIndex++) {
      const event = world.eventLog[this.eventIndex]
      if (event.type !== 'unit_spawn') continue
      const unit = world.unitById.get(event.unitId)
      if (!unit) continue
      // Spawn events have a unit id but no gate id. Match only units still at a gate mouth.
      const gate = this.map.spawnGates.find(g => Math.hypot(g.pos.x - unit.pos.x, g.pos.z - unit.pos.z) < 2.5)
      if (gate) this.refs.gates.find(g => g.id === gate.id).lastSpawn = t
    }
    for (const gate of this.refs.gates) {
      const active = state.gates.includes(gate.id)
      const open = active && (t - gate.lastSpawn < 3.5)
      const old = gate.amount
      gate.amount += ((open ? 1 : 0) - gate.amount) * ease
      gate.shutter.scale.y = Math.max(0.02, 1 - gate.amount)
      gate.shutter.position.y = gate.amount * 1.5
      const distance = Math.hypot(world.player.pos.x - gate.pos[0], world.player.pos.z - gate.pos[2])
      const bearing = Math.atan2(gate.pos[0] - world.player.pos.x, gate.pos[2] - world.player.pos.z)
      const angle = Math.abs(Math.atan2(Math.sin(bearing - world.player.yaw), Math.cos(bearing - world.player.yaw)))
      gate.light.visible = false
      gate.light.intensity = active && (distance < 18 || angle < 1.15) ? 8 + Math.sin(t * 7) * 5 : 0
      gate.signal.scale.x = active ? 0.95 + Math.sin(t * 7) * 0.05 : 0.92
      moving ||= Math.abs(old - gate.amount) > 0.01
    }
    this.refs.gateBatches.sync()
    let hum = 0
    for (const hazard of this.refs.hazards) {
      const kind = state.hazards.find(h => h.slot === hazard.id)?.kind
      hazard.electric.visible = kind === 'electric'; hazard.steam.visible = kind === 'steam'
      hazard.light.intensity = kind === 'electric' ? 12 + Math.sin(t * 47) * 5 : 0
      hazard.light.visible = false
      if (kind === 'electric') {
        const pos = hazard.arcs.geometry.attributes.position
        for (let i = 0; i < pos.count; i++) {
          const segment = Math.floor(i / 2), end = i % 2, line = Math.floor(segment / 6), step = segment % 6 + end
          const x = -hazard.size.x * 0.42 + step / 6 * hazard.size.x * 0.84
          const z = (line - 1) * hazard.size.z * 0.27 + Math.sin(step * 27 + Math.floor(t * 14) * 5) * 0.18
          pos.setXYZ(i, x, 0.08 + Math.abs(Math.sin(step * 4 + Math.floor(t * 14))) * 0.36, z)
        }
        pos.needsUpdate = true
        const distance = Math.hypot(world.player.pos.x - hazard.pos[0], world.player.pos.z - hazard.pos[2])
        hum = Math.max(hum, 0.025 * Math.max(0, 1 - distance / 14))
      }
      if (kind === 'steam') updateSteam(hazard.steam, t, hazard, this.quality.particleDensity)
    }
    if (this.audio) this.audio.gain.gain.setTargetAtTime(hum, this.audio.context.currentTime, 0.08)
    if (state.flankWallBroken && this.brokenAt === null) this.brokenAt = t
    const collapse = this.brokenAt === null ? 0 : Math.min(1, (t - this.brokenAt) / 0.9)
    for (const chunk of this.refs.flank) {
      // Crush inward and downward, never scatter solid debris into a walkable corridor.
      chunk.piece.position.y = chunk.y * (1 - collapse) + 0.06 * collapse
      chunk.piece.scale.y = 1 - collapse * 0.92
      chunk.piece.visible = collapse < 1 || chunk.row === 0
    }
    const trader = this.refs.trader
    trader.amount += ((world.phase === 'intermission' ? 1 : 0) - trader.amount) * ease
    // A telescoping lid remains within the crate footprint.
    trader.lid.scale.z = Math.max(0.08, 1 - trader.amount * 0.92)
    trader.lid.position.z = trader.amount * trader.depth * 0.46
    trader.light.intensity = trader.amount * (14 + Math.sin(t * 2) * 2)
    trader.light.visible = false
    trader.inner.visible = trader.amount > 0.1
    for (const [index, fire] of this.refs.fires.entries()) {
      const scale = fire.distant ? 5 : 1
      fire.smoke.material.opacity = (fire.distant ? .25 : .22) * this.refs.weather.settings.smoke
      if (fire.tongues) {
        fire.tongues.rotation.y = Math.atan2(world.player.pos.x - fire.pos[0], world.player.pos.z - fire.pos[2])
        fire.tongues.scale.set(1 + Math.sin(t * 17 + index) * 0.1, 0.94 + Math.sin(t * 11) * 0.09, 1)
      }
      if (fire.light) fire.light.intensity = 30 + Math.sin(t * 12 + index) * 5 + Math.sin(t * 29) * 3
      updateFireFlame(fire.flame, t, fire, scale, this.quality.particleDensity)
      updateFireSmoke(fire.smoke, t, fire, scale, this.quality.particleDensity)
    }
    for(const batch of this.refs.particleBatches)batch.sync()
    this.refs.atmosphere.sync(t,state,this.quality.particleDensity)
    this.syncLocalLights(world.player.pos)
    updateDust(this.refs.dust, t, this.quality.particleDensity)
    this.refs.wire.visible = Math.sin(t * 2.7) > 0.8
    updateWire(this.refs.wire, t, this.quality.particleDensity)
    if (moving || (collapse > 0 && collapse < 1)) this.viewer.renderManager.resetShadows()
  }
  syncLocalLights(player){
    for(const entry of this.localLightEntries){
      const dx=entry.position.x-player.x,dz=entry.position.z-player.z,dy=entry.position.y-player.y
      const region=entry.light.userData.mapLightRegion
      const permitted=!region||(region==='service')===(player.y<-.6)
      entry.score=permitted&&entry.light.intensity>0?entry.light.intensity/(1+(dx*dx+dz*dz+dy*dy*2)*.05):-1
      entry.selected=false
    }
    for(const pooled of this.localLights){
      let best=null
      for(const entry of this.localLightEntries)if(!entry.selected&&(!best||entry.score>best.score))best=entry
      if(!best||best.score<0){pooled.intensity=0;continue}
      best.selected=true;pooled.position.copy(best.position);pooled.color.copy(best.light.color)
      pooled.intensity=best.light.intensity;pooled.distance=best.light.distance;pooled.decay=best.light.decay
    }
  }
  setQuality(quality) {
    this.quality = quality
    if (!this.refs) return
    this.refs.weather.settings.particleDensity = quality.particleDensity
    const key = this.root?.getObjectByName('Map moon shadow key')
    if (key?.shadow) {
      key.shadow.mapSize.setScalar(quality.shadowMapSize)
      key.shadow.map?.dispose?.()
      key.shadow.map = null
    }
    this.post?.setQuality(quality)
    this.viewer.renderManager.resetShadows()
  }
  stop() {
    if (this.audioGesture) {
      window.removeEventListener('pointerdown', this.audioGesture); window.removeEventListener('keydown', this.audioGesture)
      this.audioGesture = null
    }
    if (this.audio) {
      this.audio.oscillator.stop(); this.audio.oscillator.disconnect(); this.audio.filter.disconnect(); this.audio.gain.disconnect()
      this.audio.context.close().catch(() => {}); this.audio = null
    }
    this.post?.stop(); this.post = null
    if (this.saved) {
      Object.assign(this.viewer.scene, this.saved); this.saved = null
      this.environment?.dispose(); this.environment = null
    }
    for (const [light, visible] of this.hiddenLights) light.visible = visible
    this.hiddenLights = []
    // Texture collection includes procedural textures unused by any surviving material.
    for (const texture of this.geometry?.mapTextures || []) texture.dispose()
    this.root?.traverse(object => { if (object.isLight) object.shadow?.dispose?.() })
    this.owner?.cleanup(); this.owner = null; this.root = null; this.geometry = null; this.refs = null;this.debugColliders=null;this.localLights=[];this.localLightEntries=[]
    this.previewChildren.forEach((child, index) => { child.visible = this.previewVisibility[index] })
    this.previewVisibility = []
    this.previewChildren = []
  }
}

function createColliderWireframes(map) {
  const root = new engine.Group()
  root.name = 'Collider wireframes'
  const material = new engine.LineBasicMaterial({color: 0x32f5ff, transparent: true, opacity: 0.92, depthTest: false})
  const colliders = [
    ...map.colliders.filter(collider => collider.navBlock || collider.blocksSight !== false),
    ...(map.trader?.navBlock || map.trader?.blocksSight ? [map.trader] : []),
    ...map.doors.filter(door => door.default === 'locked').map(door => ({...door, id: `door:${door.id}`, center: door.pos, kind: 'door'})),
    ...(!map.flankWall.broken ? [{...map.flankWall, id: `flank:${map.flankWall.id}`, center: map.flankWall.pos, kind: 'wall'}] : []),
  ]
  for (const collider of colliders) {
    for (const part of debugPrimitives(collider)) {
      let geometry
      if (part.shape === 'cylinder') {
        geometry = new engine.CylinderGeometry(part.radius, part.radius, part.height, 24, 1, false)
      } else {
        geometry = new engine.BoxGeometry(part.size.x, part.size.y, part.size.z)
      }
      const line = new engine.LineSegments(new engine.WireframeGeometry(geometry), material)
      line.name = `Collider ${collider.id}${part.id ? ` ${part.id}` : ''}`
      line.position.set(part.center.x, part.center.y, part.center.z)
      line.rotation.y = part.yaw || 0
      if (part.shape === 'cylinder' && part.axis === 'x') line.rotation.z = Math.PI / 2
      if (part.shape === 'cylinder' && part.axis === 'z') line.rotation.x = Math.PI / 2
      line.renderOrder = 10_000
      line.frustumCulled = false
      root.add(line)
      geometry.dispose()
    }
  }
  return root
}

function debugPrimitives(collider) {
  if (!Array.isArray(collider.shapes)) return [{...collider, shape: collider.shape || 'box'}]
  const yaw = collider.yaw || 0, cos = Math.cos(yaw), sin = Math.sin(yaw)
  return collider.shapes.map(part => ({
    ...part,
    shape: part.shape || 'box',
    center: {
      x: collider.center.x + (part.offset?.x || 0) * cos + (part.offset?.z || 0) * sin,
      y: collider.center.y + (part.offset?.y || 0),
      z: collider.center.z - (part.offset?.x || 0) * sin + (part.offset?.z || 0) * cos,
    },
    yaw: yaw + (part.yaw || 0),
  }))
}

function activePointCount(points, density) {
  const count = Math.max(0, Math.min(points.geometry.attributes.position.count, Math.round(points.geometry.attributes.position.count * density)))
  points.geometry.setDrawRange(0, count)
  return count
}

function updateSteam(points, t, hazard, density) {
  const attribute = points.geometry.attributes.position
  const count = activePointCount(points, density)
  for (let i = 0; i < count; i++) {
    const age = (t * 0.48 + i * 0.137) % 1
    attribute.setXYZ(i, hazard.pos[0] + Math.sin(i * 13) * hazard.size.x * 0.26 + age * 0.45,
      hazard.pos[1] + age * 3.8, hazard.pos[2] + Math.cos(i * 7) * hazard.size.z * 0.24 + age * 0.2)
  }
  attribute.needsUpdate = true
}

function updateFireFlame(points, t, fire, scale, density) {
  const attribute = points.geometry.attributes.position
  const count = activePointCount(points, density)
  for (let i = 0; i < count; i++) {
    const age = (t * (i % 4 === 0 ? 0.28 : 0.85) + i * 0.073) % 1
    const ember = i % 4 === 0
    attribute.setXYZ(i, fire.pos[0] + Math.sin(i * 17 + age * 2) * 0.26 * scale * (1 - age * 0.6) + (ember ? age * 0.6 : 0),
      fire.pos[1] + age * (ember ? 3.8 : 1.1) * scale, fire.pos[2] + Math.cos(i * 9) * 0.24 * scale)
  }
  attribute.needsUpdate = true
}

function updateFireSmoke(points, t, fire, scale, density) {
  const attribute = points.geometry.attributes.position
  const count = activePointCount(points, density)
  for (let i = 0; i < count; i++) {
    const age = (t * 0.11 + i * 0.139) % 1
    attribute.setXYZ(i, fire.pos[0] + age * 2 * scale + Math.sin(i * 3) * 0.3,
      fire.pos[1] + (1 + age * 5) * scale, fire.pos[2] + age * scale)
  }
  attribute.needsUpdate = true
}

function updateDust(points, t, density) {
  const attribute = points.geometry.attributes.position
  const count = activePointCount(points, density)
  for (let i = 0; i < count; i++) attribute.setXYZ(i, Math.sin(i * 17) * 24 + Math.sin(t * 0.15 + i) * 0.6,
    0.5 + (i * 0.179 + t * 0.04) % 5, Math.cos(i * 31) * 25)
  attribute.needsUpdate = true
}

function updateWire(points, t, density) {
  const attribute = points.geometry.attributes.position
  const count = activePointCount(points, density)
  for (let i = 0; i < count; i++) {
    const age = (t * 2 + i * 0.19) % 1
    attribute.setXYZ(i, -23 + age * 0.8, 2.3 - age * age * 1.8, 3.65 - age * 0.3 + Math.sin(i * 7) * age * 0.3)
  }
  attribute.needsUpdate = true
}
