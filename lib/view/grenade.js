import {Group, PhysicalMaterial} from 'threepipe'
import {getWeaponLibrary} from './weapon-assets.js'
import {createGrenadeModel} from './weapons.js'
import {holdStill} from './hidden-subtrees.js'

export class GrenadeView {
  constructor(viewer) {
    this.viewer = viewer
    this.root = null
    this.template = null
    this.visuals = []
    this.dropped = 0
    this.lastTick = 0
    this.material = null
  }

  start(world, weaponMaterial, authoredSource) {
    this.stop()
    const source = authoredSource || this.viewer.scene.modelRoot.getObjectByName('Player Start')
      || this.viewer.scene.modelRoot.getObjectByName('Player_Start')
    if (!source) throw new Error('Player Start authored node not found')
    this.root = new Group()
    this.viewer.scene.add(this.root)
    this.root.name = 'Grenade Projectiles Runtime'
    // A runtime root is an empty container at the origin. Saying so keeps three
    // from marking every node under it dirty on every render pass.
    holdStill([this.root])
    let sourceMaterial
    getWeaponLibrary(this.viewer.scene.modelRoot).sources.grenade.traverse(n=>{if(n.isMesh)sourceMaterial=n.material})
    this.material = worldGrenadeMaterial(sourceMaterial)
    this.template = createGrenadeModel(this.material, this.viewer.scene.modelRoot)
    this.template.name = 'Shared M67 projectile source'
    this.template.visible = false
    // Sixteen idle projectiles carry about 220 nodes, and three.js walks every
    // one of them for world matrices on every render pass whether it is visible
    // or not. An unclaimed slot draws nothing, so it sleeps until sync claims it.
    this.template.matrixWorldAutoUpdate = false
    this.root.add(this.template)
    for (let index = 0; index < 16; index++) {
      const object = this.template.clone(true)
      object.name = `Pooled M67 projectile ${index + 1}`
      object.matrixWorldAutoUpdate = false
      this.root.add(object)
      this.visuals.push({id: null, object, seen: false})
    }
    this.lastTick = world.tick
    this.sync(world)
  }

  sync(world) {
    if (!this.root) return
    const dt = Math.min(0.1, Math.max(0, (world.tick - this.lastTick) / 60))
    this.lastTick = world.tick
    for (const visual of this.visuals) visual.seen = false
    for (const projectile of world.projectiles) {
      if (projectile.type !== 'grenade') continue
      let visual = null
      for (const slot of this.visuals) if (slot.id === projectile.id) { visual = slot; break }
      if (!visual) {
        for (const slot of this.visuals) if (slot.id === null) { visual = slot; break }
        if (!visual) { this.dropped++; continue }
        visual.id = projectile.id
        visual.object.rotation.set(0, 0, 0)
        visual.object.visible = true
        visual.object.matrixWorldAutoUpdate = true
      }
      visual.seen = true
      visual.object.position.set(projectile.pos.x, projectile.pos.y, projectile.pos.z)
      const speed = Math.hypot(projectile.vel.x, projectile.vel.y, projectile.vel.z)
      visual.object.rotation.x += projectile.vel.z * dt * 5.5
      visual.object.rotation.y += speed * dt * 1.8
      visual.object.rotation.z -= projectile.vel.x * dt * 5.5
    }
    for (const visual of this.visuals) {
      if (visual.seen) continue
      visual.id = null
      visual.object.visible = false
      visual.object.matrixWorldAutoUpdate = false
    }
  }

  primeWarmup() {
    if (!this.template) return
    this.template.visible = true
    this.template.matrixWorldAutoUpdate = true
    return () => {
      if (!this.template) return
      this.template.visible = false
      this.template.matrixWorldAutoUpdate = false
    }
  }

  stop() {
    this.root?.clear()
    this.root?.removeFromParent()

    this.material?.dispose()
    this.root = null
    this.template = null
    this.visuals.length = 0
    this.dropped = 0
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
