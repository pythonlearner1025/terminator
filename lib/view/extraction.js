import * as engine from 'threepipe'
import {holdStill} from './hidden-subtrees.js'
import {releaseSubtree} from './mesh-release.js'

// The wave 10 extraction beacon is runtime content: it exists only while the
// director announces the pickup, so nothing about it is authored.
const BEACON_GREEN = 0x49ff9c
const LIVE_PHASES = new Set(['announced', 'arrived'])

export class ExtractionView {
  constructor(viewer) {
    this.viewer = viewer
    this.root = null
    this.world = null
    this.onRender = null
    this.autoSync = null
  }

  start(world) {
    this.stop()
    this.world = world
    this.root = new engine.Group()
    this.root.name = 'Extraction Beacon Runtime'
    // A runtime root is an empty container at the origin. Saying so keeps three
    // from marking every node under it dirty on every render pass.
    holdStill([this.root])
    this.viewer.scene.add(this.root)
    const pos = world.map?.extraction?.pos
    if (pos) this.root.position.set(pos.x, pos.y, pos.z)
    this.columnGeometry = new engine.CylinderGeometry(1.1, 1.7, 18, 18, 1, true)
    this.ringGeometry = new engine.RingGeometry(2.2, 2.9, 32)
    this.material = new engine.MeshBasicMaterial({
      color: BEACON_GREEN,
      transparent: true,
      opacity: .3,
      depthWrite: false,
      side: engine.DoubleSide,
      blending: engine.AdditiveBlending,
    })
    this.column = new engine.Mesh(this.columnGeometry, this.material)
    this.column.name = 'Extraction beacon column'
    this.column.position.y = 9
    this.ring = new engine.Mesh(this.ringGeometry, this.material)
    this.ring.name = 'Extraction beacon ground ring'
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = .05
    // Only the two meshes come and go. The root stays visible so the light
    // below it stays in the scene's light count.
    this.column.visible = false
    this.ring.visible = false
    // The beacon light is resident for the whole match. three bakes the visible
    // point-light count into every program cache key, so hiding it with the
    // column would make the whole scene link fresh programs when extraction
    // opens, and that link blocks the frame. Intensity zero is off.
    this.light = new engine.PointLight(BEACON_GREEN, 0, 26, 2)
    this.light.name = 'Extraction beacon flasher'
    this.light.position.y = 3
    this.root.add(this.column, this.ring, this.light)
    this.onRender = () => (this.autoSync ? this.autoSync() : this.sync(this.world))
    this.viewer.addEventListener('preRender', this.onRender)
    this.sync(world)
  }

  sync(world) {
    if (!this.root || !world) return
    this.world = world
    const phase = world.extraction?.phase
    const live = LIVE_PHASES.has(phase)
    if (this.column.visible !== live) {
      this.column.visible = live
      this.ring.visible = live
      this.viewer.setDirty(this)
    }
    if (!live) {
      this.light.intensity = 0
      return
    }
    // Arrival doubles the flash rate: the same beacon, read as urgent.
    const t = world.tick / 60
    const flash = .5 + .5 * Math.sin(t * (phase === 'arrived' ? 12 : 5))
    this.material.opacity = .18 + flash * .34
    this.light.intensity = 10 + flash * (phase === 'arrived' ? 46 : 22)
    this.ring.scale.setScalar(1 + flash * .08)
    this.viewer.setDirty(this)
  }

  stop() {
    if (this.onRender) this.viewer.removeEventListener('preRender', this.onRender)
    this.onRender = null
    this.autoSync = null
    releaseSubtree(this.root)
    this.root?.clear()
    this.root?.removeFromParent()
    this.columnGeometry?.dispose()
    this.ringGeometry?.dispose()
    this.material?.dispose()
    this.root = null
    this.column = null
    this.ring = null
    this.light = null
    this.columnGeometry = null
    this.ringGeometry = null
    this.material = null
    this.world = null
  }
}

export function mountExtractionView(viewer, getWorld) {
  const view = new ExtractionView(viewer)
  view.start(getWorld())
  view.autoSync = () => view.sync(getWorld())
  return view
}
