import * as engine from 'threepipe'
import {RuntimeObjectOwner} from '@kite3d/engine'
import {MapPost} from './post.js'
import {createWeather, WEATHER_DEFAULTS} from './weather.js'
import {getQualityPreset} from './performance-quality.js'
import {batchPlacedMap} from './map-batching.js'

export const MAP_FOG_DENSITIES = [0.0045, 0.018, 0.035, 0.058]

export class MapView {
  constructor(viewer, map) {
    this.viewer = viewer
    this.map = map
    this.hiddenLights = []
    this.quality = getQualityPreset('high')
  }

  start() {
    this.stop()
    const source = this.viewer.scene.modelRoot.getObjectByName('Map')
    if (!source) throw new Error('Map authored node not found')
    this.owner = new RuntimeObjectOwner('terminator-map-view')
    this.root = this.owner.attachRuntimeRoot(new engine.Group(), this.viewer.scene, source)
    this.root.name = 'Map Runtime'
    this.geometry = this.root
    this.batching = batchPlacedMap(engine, source, this.root)
    this.root.updateMatrixWorld(true)
  }

  startEffects() {
    if (this.refs) return
    this.refs = createRuntimeRefs(engine, this.root, this.map, this.batching.dynamic)
    if (new URLSearchParams(globalThis.location?.search || '').get('colliders') === '1') {
      this.debugColliders = createColliderWireframes(this.map)
      this.root.add(this.debugColliders)
    }
    this.root.updateMatrixWorld(true)
    this.localLightEntries = []
    this.root.traverse(light => {
      if (!light.isPointLight) return
      const position = new engine.Vector3()
      light.getWorldPosition(position)
      this.root.worldToLocal(position)
      light.visible = false
      this.localLightEntries.push({light, position, score: 0, selected: false})
    })
    this.localLights = Array.from({length: 4}, (_, index) => {
      const light = new engine.PointLight(0xffffff, 0, 12, 2)
      light.name = `Bunker local light ${index + 1}`
      light.visible = true
      light.castShadow = false
      this.root.add(light)
      return light
    })
    const scene = this.viewer.scene
    this.saved = {
      fog: scene.fog,
      background: scene.background,
      environment: scene.environment,
      environmentIntensity: scene.environmentIntensity,
      backgroundIntensity: scene.backgroundIntensity,
      backgroundColor: scene.backgroundColor,
      autoDisposeSceneMaps: scene.autoDisposeSceneMaps,
    }
    scene.autoDisposeSceneMaps = false
    const activeRoot = this.root
    this.ready = this.viewer.import(new URL('../../assets/hdri/qwantani_moon_noon_puresky_2k.hdr', import.meta.url).href).then(texture => {
      if (this.root !== activeRoot) {
        texture?.dispose()
        return
      }
      this.environment = texture
      scene.environment = texture
      scene.background = texture
      scene.environmentIntensity = WEATHER_DEFAULTS.environmentIntensity
      scene.backgroundIntensity = WEATHER_DEFAULTS.skyIntensity
      this.viewer.setDirty()
    }).catch(error => {
      if (this.root === activeRoot) console.error('[Map] Environment assets failed to load', error)
    })
    scene.fog = new engine.FogExp2(0x132131, MAP_FOG_DENSITIES[0])
    scene.background = new engine.Color(0x02050a)
    for (const name of ['Cool Blue Key', 'Orange Fill']) {
      const light = scene.modelRoot.getObjectByName(name)
      if (light) {
        this.hiddenLights.push([light, light.visible])
        light.visible = false
      }
    }
    this.eventIndex = 0
    this.lastTick = 0
    this.brokenAt = null
    this.setQuality(this.quality)
    this.viewer.renderManager.resetShadows()
    this.audioGesture = () => this.startHum()
    window.addEventListener('pointerdown', this.audioGesture)
    window.addEventListener('keydown', this.audioGesture)
    this.post = new MapPost(this.viewer, this.quality)
    this.post.start()
    this.viewer.setDirty()
  }

  startHum() {
    if (!this.root) return
    if (!this.audio) {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) return
      const context = new AudioContext()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const filter = context.createBiquadFilter()
      oscillator.type = 'sawtooth'
      oscillator.frequency.value = 60
      gain.gain.value = 0
      filter.type = 'lowpass'
      filter.frequency.value = 280
      oscillator.connect(filter)
      filter.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      this.audio = {context, oscillator, gain, filter}
    }
    if (this.audio.context.state === 'suspended') this.audio.context.resume().catch(() => {})
  }

  sync(world) {
    if (!this.root || !this.refs) return
    const state = world.mapState
    const t = world.tick / 60
    const dt = Math.min(.1, Math.max(0, (world.tick - this.lastTick) / 60))
    this.lastTick = world.tick
    const ease = 1 - Math.exp(-dt * 7)
    this.viewer.scene.fog.density = MAP_FOG_DENSITIES[Math.max(0, Math.min(3, state.fog || 0))]
    this.refs.weather.sync(t, state)
    this.refs.surfaceUniforms.mapWetness.value = this.refs.weather.settings.wetness
    this.post?.sync(t)
    for (const zone of this.refs.zones) zone.light.intensity = state.lights?.[zone.id] === 'off' ? 0 : zone.power
    for (const fixture of this.refs.fixtureLights) {
      const on = state.lights?.[fixture.zone] !== 'off'
      const flicker = fixture.id === 'service-1' && Math.sin(t * 39) > .92 ? .35 : 1
      fixture.light.intensity = on ? fixture.power * flicker : 0
    }
    let moving = false
    for (const door of this.refs.doors) {
      const mode = state.doors[door.id]
      const locked = mode === 'locked'
      const distance = Math.hypot(world.player.pos.x - door.pos.x, world.player.pos.z - door.pos.z)
      const open = mode === 'open' || (!locked && mode !== 'closed' && distance < 7)
      const next = open ? 1 : 0
      const old = door.amount
      door.amount += (next - door.amount) * ease
      if (Math.abs(door.amount - next) < .005) door.amount = next
      door.shutter.scale.y = Math.max(.015, 1 - door.amount)
      door.shutter.position.y = door.baseY + door.amount * door.height / 2
      door.shutter.visible = door.amount < .99
      if (door.signal) door.signal.visible = locked
      moving ||= Math.abs(old - door.amount) > .005
    }
    for (; this.eventIndex < world.eventLog.length; this.eventIndex += 1) {
      const event = world.eventLog[this.eventIndex]
      if (event.type !== 'unit_spawn') continue
      const unit = world.unitById.get(event.unitId)
      if (!unit) continue
      const gate = this.map.spawnGates.find(item => Math.hypot(item.pos.x - unit.pos.x, item.pos.z - unit.pos.z) < 2.5)
      const gateView = gate && this.refs.gates.find(item => item.id === gate.id)
      if (gateView) gateView.lastSpawn = t
    }
    for (const gate of this.refs.gates) {
      const active = state.gates.includes(gate.id)
      const open = active && t - gate.lastSpawn < 3.5
      const old = gate.amount
      gate.amount += ((open ? 1 : 0) - gate.amount) * ease
      gate.shutter.scale.y = Math.max(.02, 1 - gate.amount)
      gate.shutter.position.y = gate.baseY + gate.amount * gate.height / 2
      const distance = Math.hypot(world.player.pos.x - gate.pos[0], world.player.pos.z - gate.pos[2])
      const bearing = Math.atan2(gate.pos[0] - world.player.pos.x, gate.pos[2] - world.player.pos.z)
      const angle = Math.abs(Math.atan2(Math.sin(bearing - world.player.yaw), Math.cos(bearing - world.player.yaw)))
      gate.light.intensity = active && (distance < 18 || angle < 1.15) ? 8 + Math.sin(t * 7) * 5 : 0
      if (gate.signal) gate.signal.scale.x = active ? .95 + Math.sin(t * 7) * .05 : .92
      moving ||= Math.abs(old - gate.amount) > .01
    }
    let hum = 0
    for (const hazard of this.refs.hazards) {
      const kind = state.hazards.find(item => item.slot === hazard.id)?.kind
      hazard.electric.visible = kind === 'electric'
      hazard.steam.visible = kind === 'steam'
      hazard.light.intensity = kind === 'electric' ? 12 + Math.sin(t * 47) * 5 : 0
      if (kind === 'electric') {
        const position = hazard.arcs.geometry.attributes.position
        for (let index = 0; index < position.count; index += 1) {
          const segment = Math.floor(index / 2)
          const end = index % 2
          const line = Math.floor(segment / 6)
          const step = segment % 6 + end
          const x = -hazard.size.x * .42 + step / 6 * hazard.size.x * .84
          const z = (line - 1) * hazard.size.z * .27 + Math.sin(step * 27 + Math.floor(t * 14) * 5) * .18
          position.setXYZ(index, x, .08 + Math.abs(Math.sin(step * 4 + Math.floor(t * 14))) * .36, z)
        }
        position.needsUpdate = true
        const distance = Math.hypot(world.player.pos.x - hazard.pos[0], world.player.pos.z - hazard.pos[2])
        hum = Math.max(hum, .025 * Math.max(0, 1 - distance / 14))
      }
      if (kind === 'steam') updateSteam(hazard.steam, t, hazard, this.quality.particleDensity)
    }
    if (this.audio) this.audio.gain.gain.setTargetAtTime(hum, this.audio.context.currentTime, .08)
    if (state.flankWallBroken && this.brokenAt === null) this.brokenAt = t
    const collapse = this.brokenAt === null ? 0 : Math.min(1, (t - this.brokenAt) / .9)
    for (const chunk of this.refs.flank) {
      chunk.piece.position.y = chunk.y * (1 - collapse) + .06 * collapse
      chunk.piece.scale.y = 1 - collapse * .92
      chunk.piece.visible = collapse < 1 || chunk.row === 0
    }
    const trader = this.refs.trader
    if (trader) {
      trader.amount += ((world.phase === 'intermission' ? 1 : 0) - trader.amount) * ease
      trader.lid.scale.z = Math.max(.08, 1 - trader.amount * .92)
      trader.lid.position.z = trader.baseZ + trader.amount * trader.depth * .46
      trader.light.intensity = trader.amount * (14 + Math.sin(t * 2) * 2)
      trader.inner.visible = trader.amount > .1
    }
    for (const [index, fire] of this.refs.fires.entries()) {
      fire.smoke.material.opacity = .22 * this.refs.weather.settings.smoke
      fire.light.intensity = 30 + Math.sin(t * 12 + index) * 5 + Math.sin(t * 29) * 3
      updateFireFlame(fire.flame, t, fire, 1, this.quality.particleDensity)
      updateFireSmoke(fire.smoke, t, fire, 1, this.quality.particleDensity)
    }
    this.refs.atmosphere.sync(t, state, this.quality.particleDensity)
    this.syncLocalLights(world.player.pos)
    if (moving || collapse > 0 && collapse < 1) this.viewer.renderManager.resetShadows()
  }

  syncLocalLights(player) {
    for (const entry of this.localLightEntries) {
      const dx = entry.position.x - player.x
      const dz = entry.position.z - player.z
      const dy = entry.position.y - player.y
      entry.score = entry.light.intensity > 0 ? entry.light.intensity / (1 + (dx * dx + dz * dz + dy * dy * 2) * .05) : -1
      entry.selected = false
    }
    for (const pooled of this.localLights) {
      let best = null
      for (const entry of this.localLightEntries) if (!entry.selected && (!best || entry.score > best.score)) best = entry
      if (!best || best.score < 0) {
        pooled.intensity = 0
        continue
      }
      best.selected = true
      pooled.position.copy(best.position)
      pooled.color.copy(best.light.color)
      pooled.intensity = best.light.intensity
      pooled.distance = best.light.distance
      pooled.decay = best.light.decay
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
      window.removeEventListener('pointerdown', this.audioGesture)
      window.removeEventListener('keydown', this.audioGesture)
      this.audioGesture = null
    }
    if (this.audio) {
      this.audio.oscillator.stop()
      this.audio.oscillator.disconnect()
      this.audio.filter.disconnect()
      this.audio.gain.disconnect()
      this.audio.context.close().catch(() => {})
      this.audio = null
    }
    this.post?.stop()
    this.post = null
    if (this.saved) {
      Object.assign(this.viewer.scene, this.saved)
      this.saved = null
      this.environment?.dispose()
      this.environment = null
    }
    for (const [light, visible] of this.hiddenLights) light.visible = visible
    this.hiddenLights = []
    this.batching?.restore()
    this.root?.traverse(object => {
      if (object.isLight) object.shadow?.dispose?.()
    })
    this.owner?.cleanup()
    this.owner = null
    this.root = null
    this.geometry = null
    this.refs = null
    this.batching = null
    this.debugColliders = null
    this.localLights = []
    this.localLightEntries = []
  }
}

function createRuntimeRefs(api, root, map, dynamic) {
  const refs = {
    doors: [], gates: [], hazards: [], fires: [], zones: [], fixtureLights: [], flank: [], trader: null,
    particleBatches: [], gateBatches: {sync() {}}, surfaceUniforms: {mapWetness: {value: .72}},
  }
  const byRole = role => dynamic.filter(object => object.userData?.mapPiece?.role === role)
  for (const object of byRole('door')) {
    const spec = map.doors.find(item => item.id === object.userData.mapPiece.id)
    const shutter = assetChild(object, 'Door shutter')
    if (!spec || !shutter) continue
    refs.doors.push({id: spec.id, object, shutter, signal: assetChild(object, 'Door lock indicator'), height: spec.size.y, amount: 0, pos: spec.pos, baseY: shutter.position.y})
  }
  for (const object of byRole('gate')) {
    const spec = map.spawnGates.find(item => item.id === object.userData.mapPiece.id)
    const shutter = assetChild(object, 'Gate shutter')
    if (!spec || !shutter) continue
    const light = new api.PointLight(0xff2010, 0, 6, 2)
    light.name = `${spec.id} red gate spill`
    light.position.set(0, spec.height || 3, -1.2)
    object.add(light)
    refs.gates.push({id: spec.id, pos: [spec.pos.x, spec.pos.y, spec.pos.z], shutter, signal: assetChild(object, 'Gate warning strip'), light, amount: 0, lastSpawn: -1000, height: spec.height || 3, baseY: shutter.position.y})
  }
  for (const object of byRole('hazard')) {
    const spec = map.hazardSlots.find(item => item.id === object.userData.mapPiece.id)
    if (!spec) continue
    const electric = new api.Group()
    electric.name = 'Electrified floor arcs'
    const geometry = new api.BufferGeometry()
    geometry.setAttribute('position', new api.Float32BufferAttribute(new Float32Array(36 * 3), 3))
    const arcs = new api.LineSegments(geometry, new api.LineBasicMaterial({color: 0x8ee8ff, transparent: true, opacity: .9, blending: api.AdditiveBlending}))
    electric.add(arcs)
    object.add(electric)
    const steamGeometry = new api.BufferGeometry()
    steamGeometry.setAttribute('position', new api.Float32BufferAttribute(new Float32Array(32 * 3), 3))
    const steam = new api.Points(steamGeometry, new api.PointsMaterial({color: 0xc9dce3, size: 1.5, transparent: true, opacity: .44, depthWrite: false}))
    object.add(steam)
    const light = new api.PointLight(0x469fff, 0, 7)
    object.add(light)
    electric.visible = false
    steam.visible = false
    refs.hazards.push({id: spec.id, pos: [spec.pos.x, spec.pos.y, spec.pos.z], size: spec.size, electric, arcs, steam, light})
  }
  for (const object of byRole('flank')) {
    const chunks = []
    object.traverse(child => {
      if (child.isMesh && namesMatch(child.name, 'Fractured flank block')) chunks.push(child)
    })
    chunks.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    chunks.forEach((piece, index) => refs.flank.push({piece, y: piece.position.y, row: Math.floor(index / 6)}))
  }
  for (const object of byRole('trader')) {
    const lid = assetChild(object, 'Trader sliding lid')
    if (!lid) continue
    const inner = new api.Mesh(new api.BoxGeometry(1.8, .04, 1), new api.MeshBasicMaterial({color: 0x52ffbd}))
    inner.name = 'Trader illuminated supplies'
    inner.visible = false
    object.add(inner)
    const light = new api.PointLight(0x75ffc7, 0, 5)
    object.add(light)
    refs.trader = {lid, inner, light, amount: 0, depth: map.trader.size.z, baseZ: lid.position.z}
  }
  for (const zone of map.lightZones) {
    const light = new api.PointLight(zone.id === 'building' ? 0xb0d4bf : 0x99c9ff, zone.id === 'building' ? 90 : zone.id === 'dock' ? 75 : 48, zone.id === 'building' ? 22 : 30)
    light.name = `Light zone ${zone.id}`
    light.position.set(zone.pos.x, zone.pos.y, zone.pos.z)
    root.add(light)
    refs.zones.push({id: zone.id, light, power: light.intensity})
  }
  for (const fixture of map.environment?.fixtures || []) {
    const light = new api.PointLight(fixture.color, fixture.power, fixture.range, 2)
    light.name = `${fixture.id} practical source`
    light.position.set(fixture.pos.x, fixture.pos.y - .2, fixture.pos.z)
    root.add(light)
    refs.fixtureLights.push({id: fixture.id, zone: fixture.zone, light, power: fixture.power})
  }
  for (const collider of map.colliders.filter(item => item.kind === 'barrel')) {
    const flame = points(api, `${collider.id} flame and embers`, 34, 0xff9029, .27, .85)
    const smoke = points(api, `${collider.id} drifting smoke`, 15, 0x79818b, 1.2, .22)
    const light = new api.PointLight(0xff681c, 32, 12)
    light.position.set(collider.center.x, collider.center.y + 1, collider.center.z)
    root.add(flame, smoke, light)
    refs.fires.push({pos: [collider.center.x, collider.center.y + .65, collider.center.z], flame, smoke, light})
  }
  const key = new api.DirectionalLight(0xabc8ef, 1.3)
  key.name = 'Map moon shadow key'
  key.position.set(-18, 34, -12)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, {left: -48, right: 48, top: 42, bottom: -42, near: 1, far: 100})
  key.shadow.bias = -.0004
  key.shadow.normalBias = .035
  key.shadow.radius = 2
  root.add(key, key.target)
  const fill = new api.HemisphereLight(0x7892ac, 0x19130e, .48)
  fill.name = 'Map night sky fill'
  root.add(fill)
  refs.weather = createWeather(api, root, map, {runtime: true})
  refs.atmosphere = createAtmosphere(api, root, map)
  return refs
}

function assetChild(root, name) {
  let found = null
  root.traverse(object => {
    if (!found && namesMatch(object.name, name)) found = object
  })
  return found
}

function namesMatch(actual, expected) {
  return actual === expected || actual === expected.replaceAll(' ', '_')
}

function createAtmosphere(api, root, map) {
  const steam = points(api, 'Expansion vent steam', Math.max(1, (map.environment?.vents?.length || 0) * 16), 0xa7bdc2, .65, .15)
  const sparks = points(api, 'Expansion cable sparks', Math.max(1, (map.environment?.sparks?.length || 0) * 12), 0xffa349, .055, .8)
  root.add(steam, sparks)
  return {
    root,
    steam,
    sparks,
    sync(t, state, density = 1) {
      const vents = map.environment?.vents || []
      const steamPositions = steam.geometry.attributes.position
      const steamCount = Math.round(steamPositions.count * density)
      steam.geometry.setDrawRange(0, steamCount)
      for (let index = 0; index < steamCount && vents.length; index += 1) {
        const source = vents[index % vents.length]
        const age = (t * .18 + index * .071) % 1
        steamPositions.setXYZ(index, source.x + Math.sin(index * 17 + age) * .25 + age * .4, source.y + age * 1.4, source.z + Math.cos(index * 7 + age) * .22)
      }
      steamPositions.needsUpdate = true
      const sources = map.environment?.sparks || []
      const sparkPositions = sparks.geometry.attributes.position
      const sparkCount = Math.round(sparkPositions.count * density)
      sparks.geometry.setDrawRange(0, sparkCount)
      sparks.visible = Math.sin(t * 2.7) > .82
      for (let index = 0; index < sparkCount && sources.length; index += 1) {
        const source = sources[index % sources.length]
        const age = (t * 1.7 + index * .073) % 1
        sparkPositions.setXYZ(index, source.x + Math.sin(index * 11) * age * .7, source.y - age * age * 1.4, source.z + Math.cos(index * 13) * age * .7)
      }
      sparkPositions.needsUpdate = true
    },
  }
}

function points(api, name, count, color, size, opacity) {
  const geometry = new api.BufferGeometry()
  geometry.setAttribute('position', new api.Float32BufferAttribute(new Float32Array(count * 3), 3))
  const material = new api.PointsMaterial({color, size, opacity, transparent: true, depthWrite: false})
  const object = new api.Points(geometry, material)
  object.name = name
  object.frustumCulled = false
  return object
}

export function createColliderWireframes(map) {
  const root = new engine.Group()
  root.name = 'Collider wireframes'
  const material = new engine.LineBasicMaterial({color: 0x32f5ff, transparent: true, opacity: .92, depthTest: false})
  const colliders = [
    ...map.colliders.filter(collider => collider.navBlock || collider.blocksSight !== false),
    ...(map.trader?.navBlock || map.trader?.blocksSight ? [map.trader] : []),
    ...map.doors.filter(door => door.default === 'locked').map(door => ({...door, id: `door:${door.id}`, center: door.pos, kind: 'door'})),
    ...(!map.flankWall.broken ? [{...map.flankWall, id: `flank:${map.flankWall.id}`, center: map.flankWall.pos, kind: 'wall'}] : []),
  ]
  for (const collider of colliders) {
    for (const part of debugPrimitives(collider)) {
      let geometry
      if (part.shape === 'cylinder') geometry = new engine.CylinderGeometry(part.radius, part.radius, part.height, 24, 1, false)
      else if (part.shape === 'sphere') geometry = new engine.SphereGeometry(part.radius, 12, 8)
      else geometry = new engine.BoxGeometry(part.size.x, part.size.y, part.size.z)
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
  const yaw = collider.yaw || 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
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
  for (let index = 0; index < count; index += 1) {
    const age = (t * .48 + index * .137) % 1
    attribute.setXYZ(index, Math.sin(index * 13) * hazard.size.x * .26 + age * .45, age * 3.8, Math.cos(index * 7) * hazard.size.z * .24 + age * .2)
  }
  attribute.needsUpdate = true
}

function updateFireFlame(points, t, fire, scale, density) {
  const attribute = points.geometry.attributes.position
  const count = activePointCount(points, density)
  for (let index = 0; index < count; index += 1) {
    const age = (t * (index % 4 === 0 ? .28 : .85) + index * .073) % 1
    const ember = index % 4 === 0
    attribute.setXYZ(index, fire.pos[0] + Math.sin(index * 17 + age * 2) * .26 * scale * (1 - age * .6) + (ember ? age * .6 : 0), fire.pos[1] + age * (ember ? 3.8 : 1.1) * scale, fire.pos[2] + Math.cos(index * 9) * .24 * scale)
  }
  attribute.needsUpdate = true
}

function updateFireSmoke(points, t, fire, scale, density) {
  const attribute = points.geometry.attributes.position
  const count = activePointCount(points, density)
  for (let index = 0; index < count; index += 1) {
    const age = (t * .11 + index * .139) % 1
    attribute.setXYZ(index, fire.pos[0] + age * 2 * scale + Math.sin(index * 3) * .3, fire.pos[1] + (1 + age * 5) * scale, fire.pos[2] + age * scale)
  }
  attribute.needsUpdate = true
}
