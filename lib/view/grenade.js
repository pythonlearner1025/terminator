import {Group, PhysicalMaterial} from 'threepipe'
import {RuntimeObjectOwner} from '@kite3d/engine'
import {createGrenadeModel} from './weapons.js'

export class GrenadeView {
  constructor(viewer) {
    this.viewer = viewer
    this.owner = null
    this.root = null
    this.template = null
    this.visuals = new Map()
    this.activeIds = new Set()
    this.lastTick = 0
    this.material = null
  }

  start(world, weaponMaterial) {
    this.stop()
    const source = this.viewer.scene.modelRoot.getObjectByName('Player Start')
      || this.viewer.scene.modelRoot.getObjectByName('Player_Start')
    if (!source) throw new Error('Player Start authored node not found')
    this.owner = new RuntimeObjectOwner('terminator-grenade-view')
    this.root = this.owner.attachRuntimeRoot(new Group(), this.viewer.scene, source)
    this.root.name = 'Grenade Projectiles Runtime'
    this.material = worldGrenadeMaterial(weaponMaterial)
    this.template = createGrenadeModel(this.material)
    this.template.name = 'Shared M67 projectile source'
    this.template.visible = false
    this.root.add(this.template)
    this.lastTick = world.tick
    this.sync(world)
  }

  sync(world) {
    if (!this.root) return
    const dt = Math.min(0.1, Math.max(0, (world.tick - this.lastTick) / 60))
    this.lastTick = world.tick
    this.activeIds.clear()
    for (const projectile of world.projectiles) {
      if (projectile.type !== 'grenade') continue
      this.activeIds.add(projectile.id)
      let visual = this.visuals.get(projectile.id)
      if (!visual) {
        const object = this.template.clone(true)
        object.name = `${projectile.id} Runtime`
        object.visible = true
        this.root.add(object)
        visual = {object}
        this.visuals.set(projectile.id, visual)
      }
      visual.object.position.set(projectile.pos.x, projectile.pos.y, projectile.pos.z)
      const speed = Math.hypot(projectile.vel.x, projectile.vel.y, projectile.vel.z)
      visual.object.rotation.x += projectile.vel.z * dt * 5.5
      visual.object.rotation.y += speed * dt * 1.8
      visual.object.rotation.z -= projectile.vel.x * dt * 5.5
    }
    for (const [id, visual] of this.visuals) {
      if (this.activeIds.has(id)) continue
      visual.object.removeFromParent()
      this.visuals.delete(id)
    }
  }

  stop() {
    const geometries = new Set()
    this.root?.traverse(object => { if (object.geometry) geometries.add(object.geometry) })
    this.root?.clear()
    this.owner?.cleanup()
    for (const geometry of geometries) geometry.dispose()
    this.material?.dispose()
    this.owner = null
    this.root = null
    this.template = null
    this.visuals.clear()
    this.activeIds.clear()
    this.lastTick = 0
    this.material = null
  }
}

function worldGrenadeMaterial(source) {
  if (!source) throw new Error('Grenade projectile requires the loaded weapon PBR material')
  return new PhysicalMaterial({
    name: 'M67 worn phosphate and safety hardware',
    map: source.map,
    normalMap: source.normalMap,
    roughnessMap: source.roughnessMap,
    metalnessMap: source.metalnessMap,
    aoMap: source.aoMap,
    emissiveMap: source.emissiveMap,
    color: 0xffffff,
    metalness: 1,
    roughness: 1,
    emissive: 0xffffff,
    emissiveIntensity: 1.2,
    normalScale: source.normalScale?.clone(),
    envMap: source.envMap,
    envMapIntensity: 0.45,
  })
}
