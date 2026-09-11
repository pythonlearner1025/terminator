import {
  BoxGeometry,
  Color,
  Group,
  Mesh2,
  SphereGeometry,
  UnlitMaterial,
  Vector3,
} from 'threepipe'
import {RuntimeObjectOwner} from '@kite3d/engine'

const TEMPLATE_NAMES = {
  scout: 'Unit Template Scout',
  endo: 'Unit Template Endo',
  heavy: 'Unit Template Heavy',
}

export class UnitView {
  constructor(viewer) {
    this.viewer = viewer
    this.owner = null
    this.root = null
    this.templates = {}
    this.visuals = new Map()
    this.effects = []
    this.eventIndex = 0
    this.v1 = new Vector3()
    this.v2 = new Vector3()
  }

  start(world) {
    this.stop()
    const modelRoot = this.viewer.scene.modelRoot
    for (const [type, name] of Object.entries(TEMPLATE_NAMES)) {
      const source = findAuthored(modelRoot, name)
      if (!source) throw new Error(`${name} authored node not found`)
      this.templates[type] = source
    }
    const ownerSource = this.templates.endo
    this.owner = new RuntimeObjectOwner('terminator-unit-view')
    this.root = this.owner.attachRuntimeRoot(new Group(), this.viewer.scene, ownerSource)
    this.root.name = 'Units Runtime'
    this.eventIndex = world.eventLog.length
  }

  sync(world) {
    if (!this.owner || !this.root) return
    for (const unit of world.units) {
      let visual = this.visuals.get(unit.id)
      if (!visual) {
        const object = this.owner.cloneFrom(this.templates[unit.type], this.root, {
          name: `${unit.id} Runtime`,
          visible: true,
          position: [unit.pos.x, unit.pos.y, unit.pos.z],
          runtimeMutable: ['position', 'rotation', 'visible', 'material'],
        })
        visual = {object}
        this.visuals.set(unit.id, visual)
      }
      visual.object.position.set(unit.pos.x, unit.pos.y, unit.pos.z)
      visual.object.rotation.y = unit.yaw
      if (!unit.alive && unit.diedAtTick !== null) {
        const elapsed = (world.tick - unit.diedAtTick) / 60
        visual.object.rotation.z = Math.min(Math.PI / 2, elapsed * 1.9)
        const opacity = Math.max(0, 1 - Math.max(0, elapsed - 0.5) / 1.2)
        visual.object.traverse((child) => {
          if (!child.material) return
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          for (const material of materials) {
            material.transparent = true
            material.opacity = opacity
          }
        })
        if (opacity <= 0) visual.object.visible = false
      }
    }
    this.processEvents(world)
    this.updateEffects(world)
  }

  processEvents(world) {
    for (; this.eventIndex < world.eventLog.length; this.eventIndex += 1) {
      const event = world.eventLog[this.eventIndex]
      if (event.type !== 'shot' || event.by === 'player' || !event.origin) continue
      const target = event.target || {
        x: event.origin.x,
        y: event.origin.y,
        z: event.origin.z + 5,
      }
      this.addMuzzle(event.origin, world.tick)
      this.addTracer(event.origin, target, world.tick)
    }
  }

  addMuzzle(pos, tick) {
    const flash = new Mesh2(new SphereGeometry(0.16, 8, 5), new UnlitMaterial({color: new Color(0xffb13b)}))
    flash.name = 'Unit Muzzle Flash'
    flash.position.set(pos.x, pos.y, pos.z)
    flash.raycast = () => {}
    this.root.add(flash)
    this.effects.push({object: flash, expiresAt: tick + 5})
  }

  addTracer(from, to, tick) {
    this.v1.set(from.x, from.y, from.z)
    this.v2.set(to.x, to.y, to.z)
    const length = this.v1.distanceTo(this.v2)
    const tracer = new Mesh2(new BoxGeometry(0.025, 0.025, Math.max(0.05, length)), new UnlitMaterial({color: new Color(0xff3b24)}))
    tracer.name = 'Unit Tracer'
    tracer.position.copy(this.v1).add(this.v2).multiplyScalar(0.5)
    tracer.lookAt(this.v2)
    tracer.raycast = () => {}
    this.root.add(tracer)
    this.effects.push({object: tracer, expiresAt: tick + 7})
  }

  updateEffects(world) {
    const alive = []
    for (const effect of this.effects) {
      if (world.tick < effect.expiresAt) {
        alive.push(effect)
        continue
      }
      effect.object.removeFromParent()
      effect.object.geometry?.dispose?.()
      effect.object.material?.dispose?.()
    }
    this.effects = alive
  }

  stop() {
    this.owner?.cleanup()
    this.owner = null
    this.root = null
    this.templates = {}
    this.visuals.clear()
    this.effects = []
    this.eventIndex = 0
  }
}

function findAuthored(root, name) {
  return root.getObjectByName(name) || root.getObjectByName(name.replaceAll(' ', '_'))
}
