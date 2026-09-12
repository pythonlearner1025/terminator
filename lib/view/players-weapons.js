import {Group, PhysicalMaterial, Vector3} from 'threepipe'
import {createWeaponRigs,WEAPON_IDS} from './weapons.js'
import {weaponSurfaceMaps} from './weapons-materials.js'

export const PLAYER_WEAPONS = WEAPON_IDS

// Adapt the existing public builder once. No duplicated weapon meshes or FPS
// projection: every soldier shares these geometries and one world PBR material.
export class PlayerWeaponLibrary {
  constructor(parent, surfaces) {
    this.root = new Group(); this.root.name = 'Shared third person weapon sources'; this.root.visible = false; parent.add(this.root)
    const maps=weaponSurfaceMaps()
    this.material = new PhysicalMaterial({name:'Resistance world weapons PBR',
      map:maps.albedo,normalMap:maps.normal,roughnessMap:maps.roughness,
      metalnessMap:maps.metalness,aoMap:maps.ao,emissiveMap:maps.emissive,
      emissive:0xffffff,emissiveIntensity:1.2,metalness:1,roughness:1,
      envMap:surfaces.envMap,envMapIntensity:.8})
    this.source={rigs:createWeaponRigs(this.root,this.material)}
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
  stop() {
    const geometries=new Set()
    this.root.traverse(object=>{if(object.geometry)geometries.add(object.geometry)})
    this.root.removeFromParent();for(const geometry of geometries)geometry.dispose();this.material.dispose()
  }
}

export function selectPlayerWeapon(weapon, id) {
  id = PLAYER_WEAPONS.includes(id) ? id : 'pistol'
  if (weapon.id === id) return weapon.active
  for (const rig of Object.values(weapon.rigs)) rig.root.visible = rig.id === id
  weapon.id = id; weapon.active = weapon.rigs[id]
  return weapon.active
}
