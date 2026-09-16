import * as engine from 'threepipe'
import {holdStill} from './hidden-subtrees.js'
import {releaseSubtree} from './mesh-release.js'

// Supply caches are runtime content: the director picks four spots per wave, so
// nothing about them is authored. Every object lives outside modelRoot and the
// whole root is removed on stop.
const CACHE_GREEN = 0x3dff9e
const BURST_SECONDS = .5
// One shared crate light, not one per crate. Twelve point lights broke the
// four active local lights the scene budgets, and a 9 m range washed the
// colonnade ceiling green from 15 m away. The emissive material and bloom
// carry the glow; this light only kicks the ground the player stands on.
const GLOW_RANGE_METERS = 4
const BURST_RANGE_METERS = 12
const BURST_INTENSITY = 26
const GLOW_INTENSITY = 4
const GLOW_PULSE = 6

export class CachesView {
  constructor(viewer) {
    this.viewer = viewer
    this.root = null
    this.glow = null
    this.warmupCrate = null
    this.warmupBurst = null
    this.crates = new Map()
    this.bursts = []
    this.world = null
    this.eventIndex = 0
    this.onRender = null
    this.autoSync = null
  }

  start(world) {
    this.stop()
    this.world = world
    this.root = new engine.Group()
    this.root.name = 'Supply Caches Runtime'
    // A runtime root is an empty container at the origin. Saying so keeps three
    // from marking every node under it dirty on every render pass.
    holdStill([this.root])
    this.viewer.scene.add(this.root)
    this.crateGeometry = new engine.BoxGeometry(.8, .6, .8)
    this.lidGeometry = new engine.BoxGeometry(.9, .06, .9)
    this.burstGeometry = new engine.SphereGeometry(.5, 12, 8)
    this.material = new engine.PhysicalMaterial({
      name: 'Supply cache emissive crate',
      color: 0x0f2c1e,
      emissive: CACHE_GREEN,
      emissiveIntensity: 1,
      roughness: .55,
      metalness: .1,
    })
    this.burstMaterial = new engine.MeshBasicMaterial({
      color: CACHE_GREEN,
      transparent: true,
      opacity: .7,
      depthWrite: false,
      blending: engine.AdditiveBlending,
    })
    // Point lights are created once and never hidden. three bakes the visible
    // point-light count into every program cache key, so a light that appears
    // when a crate spawns makes the whole scene link fresh programs on its next
    // draw, and that link blocks the frame. Intensity zero is off.
    this.glow = new engine.PointLight(CACHE_GREEN, 0, GLOW_RANGE_METERS, 2)
    this.glow.name = 'Supply cache shared glow'
    this.glow.castShadow = false
    this.root.add(this.glow)
    // One resident flash light. A second pickup inside the half-second burst
    // takes it over; the older burst then fades its mesh alone.
    this.burstLight = new engine.PointLight(CACHE_GREEN, 0, BURST_RANGE_METERS, 2)
    this.burstLight.name = 'Supply cache collection flash'
    this.burstLight.castShadow = false
    this.root.add(this.burstLight)
    this.eventIndex = world.eventLog?.length || 0
    this.onRender = () => (this.autoSync ? this.autoSync() : this.sync(this.world))
    this.viewer.addEventListener('preRender', this.onRender)
    this.sync(world)
  }

  sync(world) {
    if (!this.root || !world) return
    this.world = world
    const t = world.tick / 60
    const active = world.pickups?.active || []
    for (; this.eventIndex < world.eventLog.length; this.eventIndex += 1) {
      const event = world.eventLog[this.eventIndex]
      if (event.type === 'cache_taken') this.burst(event.pos, t)
    }
    for (const cache of active) if (!this.crates.has(cache.id)) this.crates.set(cache.id, this.createCrate(cache))
    for (const [id, crate] of this.crates) {
      if (active.some(cache => cache.id === id)) continue
      crate.object.removeFromParent()
      this.crates.delete(id)
    }
    // One slow breath keeps the crate readable across a dark courtyard.
    const pulse = .5 + .5 * Math.sin(t * 2)
    this.material.emissiveIntensity = .7 + pulse * 1.1
    for (const crate of this.crates.values()) {
      crate.object.rotation.y = t * .6
      crate.object.position.y = crate.baseY + .06 + pulse * .05
    }
    const nearest = this.nearestCrate(world)
    this.glow.intensity = nearest ? GLOW_INTENSITY + pulse * GLOW_PULSE : 0
    if (nearest) {
      this.glow.position.set(nearest.object.position.x, nearest.object.position.y + .8, nearest.object.position.z)
    }
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index]
      const age = (t - burst.start) / BURST_SECONDS
      if (age >= 1) {
        burst.object.removeFromParent()
        if (burst.light.userData.burst === burst) burst.light.intensity = 0
        this.bursts.splice(index, 1)
        continue
      }
      burst.object.scale.setScalar(.6 + age * 3.4)
      burst.object.material.opacity = .7 * (1 - age)
      if (burst.light.userData.burst === burst) burst.light.intensity = BURST_INTENSITY * (1 - age)
    }
    this.viewer.setDirty(this)
  }

  // A crate and a collection burst have no mesh until the director places a
  // cache, so the match warmup finds nothing of theirs to compile and the first
  // crate of a wave links its program mid frame. Show one of each while the
  // warmup runs, then hide them. They stay in the scene: threepipe unregisters
  // a material as soon as the last object holding it leaves the graph, and
  // unregistering disposes it along with the program the warmup just linked.
  primeWarmup() {
    if (!this.root || this.warmupCrate) return null
    this.warmupCrate = this.createCrate({id: 'warmup', kind: 'warmup', pos: {x: 0, y: 0, z: 0}}).object
    this.warmupBurst = new engine.Mesh(this.burstGeometry, this.burstMaterial)
    this.warmupBurst.name = 'Supply cache warmup burst'
    this.root.add(this.warmupBurst)
    return () => {
      this.warmupCrate.visible = false
      this.warmupBurst.visible = false
    }
  }

  createCrate(cache) {
    const object = new engine.Group()
    object.name = `Supply cache ${cache.id} ${cache.kind}`
    object.position.set(cache.pos.x, cache.pos.y, cache.pos.z)
    const body = new engine.Mesh(this.crateGeometry, this.material)
    body.position.y = .3
    const lid = new engine.Mesh(this.lidGeometry, this.material)
    lid.position.y = .63
    object.add(body, lid)
    this.root.add(object)
    return {id: cache.id, object, baseY: cache.pos.y}
  }

  // The shared light follows whichever live crate is closest to the player.
  nearestCrate(world) {
    const from = world.player?.pos
    let best = null
    let bestDistance = Infinity
    for (const crate of this.crates.values()) {
      const position = crate.object.position
      const distance = from ? (position.x - from.x) ** 2 + (position.z - from.z) ** 2 : 0
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = crate
    }
    return best
  }

  burst(pos, t) {
    if (!pos) return
    const object = new engine.Mesh(this.burstGeometry, this.burstMaterial.clone())
    object.name = 'Supply cache collection burst'
    object.position.set(pos.x, pos.y + .5, pos.z)
    // The flash borrows the resident light instead of adding one.
    const light = this.burstLight
    light.position.copy(object.position)
    light.intensity = BURST_INTENSITY
    this.root.add(object)
    const burst = {object, light, start: t}
    light.userData.burst = burst
    this.bursts.push(burst)
  }

  stop() {
    if (this.onRender) this.viewer.removeEventListener('preRender', this.onRender)
    this.onRender = null
    this.autoSync = null
    for (const burst of this.bursts) burst.object.material.dispose()
    this.bursts.length = 0
    this.crates.clear()
    this.glow = null
    this.burstLight = null
    this.warmupCrate = null
    this.warmupBurst = null
    releaseSubtree(this.root)
    this.root?.clear()
    this.root?.removeFromParent()
    this.crateGeometry?.dispose()
    this.lidGeometry?.dispose()
    this.burstGeometry?.dispose()
    this.material?.dispose()
    this.burstMaterial?.dispose()
    this.root = null
    this.crateGeometry = null
    this.lidGeometry = null
    this.burstGeometry = null
    this.material = null
    this.burstMaterial = null
    this.world = null
    this.eventIndex = 0
  }
}

export function mountCachesView(viewer, getWorld) {
  const view = new CachesView(viewer)
  view.start(getWorld())
  view.autoSync = () => view.sync(getWorld())
  return view
}
