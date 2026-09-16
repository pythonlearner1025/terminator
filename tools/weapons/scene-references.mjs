export const WEAPON_ASSET_IDS=['pistol','m4','shotgun','plasma','knife','grenade','sniper','launcher','hands']
export function addWeaponReferences(document,{lab=false}={}) {
  const scene=document.scenes[document.scene||0]
  for(const [i,id] of WEAPON_ASSET_IDS.entries()){
    const uuid='weapon-template-'+id,prior=document.nodes.find(n=>n.extras?.gltfUUID===uuid)
    if(prior)continue
    const index=document.nodes.length
    document.nodes.push({name:'Weapon Template '+id,translation:lab?[-21+i*.56,1.2,-4.2]:[43+i*.65,1.4,13],
      rotation:[0,.7071067811865475,0,.7071067811865476],extras:{gltfUUID:uuid,weaponAsset:id,
        rootPath:`/kite3d/@weapon-${id}/${id}.gltf`,sProperties:['position','rotation','quaternion','scale','visible','name'],
        kite3dAuthoring:{role:'template',id:uuid}}})
    scene.nodes.push(index)
  }
  return document
}
