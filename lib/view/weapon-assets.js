import {Matrix4,Vector3,Skeleton} from 'threepipe'
export const WEAPON_IDS=['pistol','m4','shotgun','plasma','knife','grenade','sniper','launcher']
const libraries=new WeakMap()
const strip = object => object.traverse(n=>{
  for(const k of ['rootPath','sProperties','rootPathOptions','EntityComponentPlugin','kite3dGenerated','kite3dAuthoring','excludeFromExport'])delete n.userData[k]
})
function cloneRig(source) {
  const clone=source.clone(true),byName=new Map()
  clone.traverse(n=>byName.set(n.name,n))
  clone.traverse(n=>{if(n.isSkinnedMesh){
    const original=source.getObjectByName(n.name)
    n.skeleton=new Skeleton(original.skeleton.bones.map(b=>byName.get(b.name)),original.skeleton.boneInverses.map(m=>m.clone()))
    n.bindMatrix.copy(original.bindMatrix);n.bindMatrixInverse.copy(original.bindMatrixInverse)
  }})
  strip(clone);return clone
}
// The editor resolves each rootPath once. This cache indexes the loaded authored files.
// Validate identities each Play so replacement and deletion remain effective.
export function getWeaponLibrary(modelRoot) {
  if(!modelRoot)throw new Error('Weapon assets need the authored model root')
  const sources={}
  modelRoot.traverse(n=>{if(n.userData?.weaponAsset&&!sources[n.userData.weaponAsset])sources[n.userData.weaponAsset]=n})
  const cached=libraries.get(modelRoot)
  if(cached&&Object.keys(cached.sources).length===Object.keys(sources).length&&Object.keys(sources).every(id=>cached.sources[id]===sources[id]))return cached
  for(const id of [...WEAPON_IDS,'hands'])if(!sources[id])throw new Error(`Missing authored weapon asset: ${id}. Run npm run weapons and npm run scene.`)
  const library={sources,clones:0,clone(id){this.clones++;return cloneRig(sources[id])}}
  libraries.set(modelRoot,library);return library
}
function rest(hand){hand.userData.restPosition=hand.position.clone();hand.userData.restRotation=hand.rotation.clone()}
const fingers=['Index','Middle','Ring','Little','Thumb']
function orientHand(hand,side,position,kind) {
  const right=side==='Right',matrix=new Matrix4()
  // X spans the knuckles, Y points along fingers, Z points through the glove back.
  if(kind==='grip')matrix.makeBasis(new Vector3(0,-1,0),new Vector3(0,0,-1),new Vector3(1,0,0))
  else if(kind==='support')matrix.makeBasis(new Vector3(0,0,-1),new Vector3(1,0,0),new Vector3(0,-1,0))
  else matrix.makeBasis(new Vector3(1,0,0),new Vector3(0,0,-1),new Vector3(0,1,0))
  hand.position.fromArray(position);hand.quaternion.setFromRotationMatrix(matrix)
  for(const name of fingers)for(let joint=1;joint<=3;joint++){
    const bone=hand.getObjectByName(side+name+joint)
    const flex=name==='Index'&&right&&kind==='grip'?[.05,.12,.08]:name==='Thumb'?[.40,.8,.65]:kind==='open'?[.15,.30,.2]:kind==='support'?[.38,1.05,1.05]:[1.08,1.08,.82]
    bone.rotation.x=-flex[joint-1]
    if(name==='Thumb'&&joint===1)bone.rotation.z=right?-.93:-.8
  }
}
export function poseWeaponHands(rig,handsSource) {
  const hands=cloneRig(handsSource),vm=rig.root.userData.viewModel
  const right=hands.getObjectByName('RightHand'),left=hands.getObjectByName('LeftHand')
  right.removeFromParent();left.removeFromParent();rig.root.add(right,left)
  const [gx,gy,gz]=vm.grip.position,rx=vm.grip.radius[0]
  orientHand(right,'Right',[gx+rx+.009,gy+(rig.id==='m4'?.014:0),gz+.027],'grip')
  if(rig.id==='knife')orientHand(right,'Right',[-.022,-.025,.014],'support')
  if(rig.id==='grenade')orientHand(right,'Right',[.041,-.012,.033],'grip')
  if(vm.support){
    const [x,y,z]=vm.support.position,r=vm.support.radius
    orientHand(left,'Left',[x-.024,y-r[1]-.012,z],'support')
    if(rig.id==='shotgun'){left.removeFromParent();rig.pump.add(left)}
  } else orientHand(left,'Left',rig.id==='knife'?[-.22,.006,-.08]:[-.12,.067,-.017],'open')
  for(const [side,hand,elbow] of [['Right',right,[.21,-.23,.42]],['Left',left,[-.34,-.28,.29]]]){
    rig.root.updateMatrixWorld(true)
    const arm=hand.getObjectByName(side+'Forearm')
    const target=new Vector3(...elbow);rig.root.localToWorld(target);hand.worldToLocal(target);target.sub(arm.position)
    arm.quaternion.setFromUnitVectors(new Vector3(0,-1,0),target.clone().normalize())
    arm.scale.y=target.length()/.35
    rest(hand)
  }
  rig.right=right;rig.left=left
  if(vm.handPoses){
    for(const hand of [right,left])hand.traverse(n=>{const p=vm.handPoses[n.name];if(p){n.position.fromArray(p.position);n.quaternion.fromArray(p.quaternion);n.scale.fromArray(p.scale)}})
    rest(right);rest(left)
  }
  return [right,left]
}
export function instantiateWeaponRigs(parent,modelRoot,materialFor=source=>source,{hands=true,ids=WEAPON_IDS}={}) {
  const library=getWeaponLibrary(modelRoot),rigs={}
  for(const id of ids){
    const source=library.sources[id],root=library.clone(id)
    source.traverse(n=>{if(n.userData.viewModel)root.userData.viewModel=structuredClone(n.userData.viewModel)})
    root.position.set(0,0,0);root.quaternion.identity();root.scale.set(1,1,1);root.name=id+' viewmodel';parent.add(root)
    const body=root.getObjectByName('Body')
    if(!body)throw Error(`${id} asset has no Body`)
    const rig={id,root,body,slide:root.getObjectByName((id==='pistol'||id==='swingout'||id==='revolver-rebuild')?'Hammer':id==='grenade'?'Lever':'Bolt'),
      magazine:root.getObjectByName((id==='pistol'||id==='swingout'||id==='revolver-rebuild')?'Cylinder':id==='grenade'?'Pin':'Magazine'),pump:root.getObjectByName('Pump'),
      breech:root.getObjectByName('Breech'),muzzle:root.getObjectByName('Muzzle'),sight:root.userData.viewModel?.sight}
    // Blender packages own their hand skeleton and clips. Find clips on the loaded
    // glTF scene as well as the asset root (both loader conventions are supported).
    if(root.userData.viewModel?.embeddedHands){
      const clips=new Map()
      source.traverse(n=>{for(const clip of n.animations||[])clips.set(clip.name,clip)})
      for(let n=source;n&&n!==modelRoot;n=n.parent)for(const clip of n.animations||[])clips.set(clip.name,clip)
      rig.clips=[...clips.values()]
      // Only the weapon's mixer owns cloned poses. Keep editor timeline mixers on sources.
      root.traverse(n=>{n.animations=[]})
      rig.right=root.getObjectByName('HandRight');rig.left=root.getObjectByName('HandLeft')
      if(!hands){
        const handMeshes=new Set(root.userData.viewModel.embeddedHandMeshes||['Right_Hand_and_Sleeve','Left_Hand_and_Sleeve'])
        root.traverse(n=>{if(handMeshes.has(n.name))n.visible=false})
      }
      if(root.userData.viewModel.forwardAxis==='+Z')root.rotation.y=Math.PI
    }
    else if(hands)poseWeaponHands(rig,library.sources.hands)
    else {rig.right={position:new Vector3(...root.userData.viewModel.grip.position)};rig.left={position:new Vector3(...(root.userData.viewModel.support?.position||[-.08,-.05,-.18]))}}
    const moving=new Set([root,rig.slide,rig.magazine,rig.pump,rig.breech,rig.right,rig.left])
    root.traverse(n=>{
      n.updateMatrix()
      if(!rig.clips?.length&&!moving.has(n))n.matrixAutoUpdate=false
      if(n.isMesh){n.material=materialFor(n.material,id,n);n.frustumCulled=false;n.renderOrder=900;n.raycast=()=>{}}
    })
    root.visible=false;rigs[id]=rig
  }
  return rigs
}
export function instantiateGrenade(modelRoot,material) {
  const root=getWeaponLibrary(modelRoot).clone('grenade'),body=root.getObjectByName('Body')
  body.removeFromParent();body.visible=true
  body.traverse(n=>{if(n.isMesh&&material)n.material=material})
  return body
}
