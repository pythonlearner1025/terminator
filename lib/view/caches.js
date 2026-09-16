import * as engine from 'threepipe'

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
const GLOW_INTENSITY = 4
const GLOW_PULSE = 6

export class CachesView {
  constructor(viewer) {
    this.viewer = viewer
    this.root = null
    this.glow = null
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
    this.glow = new engine.PointLight(CACHE_GREEN, 0, GLOW_RANGE_METERS, 2)
    this.glow.name = 'Supply cache shared glow'
    this.glow.castShadow = false
    this.glow.visible = false
    this.root.add(this.glow)
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
    this.glow.visible = Boolean(nearest)
    if (nearest) {
      this.glow.position.set(nearest.object.position.x, nearest.object.position.y + .8, nearest.object.position.z)
      this.glow.intensity = GLOW_INTENSITY + pulse * GLOW_PULSE
    }
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index]
      const age = (t - burst.start) / BURST_SECONDS
      if (age >= 1) {
        burst.object.removeFromParent()
        burst.light.removeFromParent()
        this.bursts.splice(index, 1)
        continue
      }
      burst.object.scale.setScalar(.6 + age * 3.4)
      burst.object.material.opacity = .7 * (1 - age)
      burst.light.intensity = 26 * (1 - age)
    }
    this.viewer.setDirty(this)
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
    const light = new engine.PointLight(CACHE_GREEN, 26, 12, 2)
    light.name = 'Supply cache collection flash'
    light.position.copy(object.position)
    this.root.add(object, light)
    this.bursts.push({object, light, start: t})
  }

  stop() {
    if (this.onRender) this.viewer.removeEventListener('preRender', this.onRender)
    this.onRender = null
    this.autoSync = null
    for (const burst of this.bursts) burst.object.material.dispose()
    this.bursts.length = 0
    this.crates.clear()
    this.glow = null
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
