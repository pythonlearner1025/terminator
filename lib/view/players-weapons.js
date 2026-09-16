import {Group, Vector3} from 'threepipe'
import {WEAPON_IDS} from './weapons.js'
import {instantiateWeaponRigs} from './weapon-assets.js'

export const PLAYER_WEAPONS = WEAPON_IDS

// Soldiers reuse the authored geometry with cached world materials.
export class PlayerWeaponLibrary {
  constructor(parent, surfaces, modelRoot) {
    this.root = new Group(); this.root.name = 'Shared third person weapon sources'; this.root.visible = false; parent.add(this.root)
    this.materials=new Map()
    const materialFor=source=>{
      if(!this.materials.has(source)){
        const material=source.clone();material.envMap=surfaces.envMap;material.envMapIntensity=.8
        this.materials.set(source,material)
      }
      return this.materials.get(source)
    }
    this.source={rigs:instantiateWeaponRigs(this.root,modelRoot,materialFor,{hands:false})}
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
        if (['RightHand','LeftHand'].includes(child.name)) child.visible = false
        if (child.isMesh) { child.renderOrder = 0; child.frustumCulled = true }
      })
      const get = name => object.getObjectByName(source[name].name)
      rigs[id] = {id, root: object, body: get('body'), slide: get('slide'), magazine: get('magazine'),
        pump: get('pump'), muzzle: get('muzzle'),
        rest: {slide: source.slide.position.clone(), magazine: source.magazine.position.clone(), pump: source.pump.position.clone()},
        // Soldier hand bones sit above the palm. Keep their wrist offset from the asset grip center.
        rightGrip: source.right.position.clone().add(new Vector3(0, .075, -.01)),
        leftGrip: source.left.position.clone().add(new Vector3(0, .065, .01))}
    }
    return {root, rigs, active: null, id: null}
  }
  stop() {
    this.root.removeFromParent()
    for(const material of this.materials.values())material.dispose()
    this.materials.clear();this.root.clear()
  }
}

export function selectPlayerWeapon(weapon, id) {
  id = PLAYER_WEAPONS.includes(id) ? id : 'pistol'
  if (weapon.id === id) return weapon.active
  for (const rig of Object.values(weapon.rigs)) rig.root.visible = rig.id === id
  weapon.id = id; weapon.active = weapon.rigs[id]
  return weapon.active
}
