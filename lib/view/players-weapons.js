import {Group, PhysicalMaterial, Vector3} from 'threepipe'
import {WeaponView} from './weapons.js'

export const PLAYER_WEAPONS = ['pistol', 'm4', 'shotgun', 'plasma', 'knife', 'grenade']

// Adapt the existing public builder once. No duplicated weapon meshes or FPS
// projection: every soldier shares these geometries and one world PBR material.
export class PlayerWeaponLibrary {
  constructor(parent, surfaces) {
    this.root = new Group(); this.root.name = 'Shared third person weapon sources'; this.root.visible = false; parent.add(this.root)
    this.source = new WeaponView(this.root)
    this.material = new PhysicalMaterial({name: 'Resistance world weapon surfaces', vertexColors: true,
      metalness: 1, roughness: 1, envMap: surfaces.envMap, roughnessMap: surfaces.roughnessMap, envMapIntensity: .8})
    this.material.registerMaterialExtensions([{
      uuid: 'terminator-third-person-weapon', computeCacheKey: 'terminator-third-person-weapon-v1',
      parsVertexSnippet: 'attribute vec2 weaponSurface; varying vec2 vWeaponSurface;',
      parsFragmentSnippet: 'varying vec2 vWeaponSurface;',
      shaderExtender(shader) {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeaponSurface = weaponSurface;')
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vWeaponSurface.y;')
        shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vWeaponSurface.x;')
      },
    }])
  }
  attach(parent) {
    const root = new Group(); root.name = 'Third Person Weapon'; parent.add(root)
    // Source weapons face -Z. Soldiers and core yaw face +Z.
    root.rotation.y = Math.PI
    const rigs = {}
    for (const id of PLAYER_WEAPONS) {
      const source = this.source.rigs[id], object = source.root.clone(true)
      object.name = `${id} third person`; root.add(object)
      object.traverse(child => {
        if (child.name.endsWith('gloved hand')) child.visible = false
        if (child.isMesh) { child.material = this.material; child.renderOrder = 0; child.frustumCulled = true }
      })
      const get = name => object.getObjectByName(source[name].name)
      rigs[id] = {id, root: object, body: get('body'), slide: get('slide'), magazine: get('magazine'),
        pump: get('pump'), muzzle: get('muzzle'),
        rightGrip: source.right.position.clone().add(new Vector3(0, .075, -.01)),
        leftGrip: source.left.position.clone().add(new Vector3(0, .065, .01))}
    }
    return {root, rigs, active: null, id: null}
  }
  stop() { this.source.dispose() }
}

export function selectPlayerWeapon(weapon, id) {
  id = PLAYER_WEAPONS.includes(id) ? id : 'pistol'
  if (weapon.id === id) return weapon.active
  for (const rig of Object.values(weapon.rigs)) rig.root.visible = rig.id === id
  weapon.id = id; weapon.active = weapon.rigs[id]
  return weapon.active
}
