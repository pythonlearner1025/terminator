import {T} from './geometry.mjs'
globalThis.window ??= {}
const {poseWeaponHands}=await import('../../lib/view/weapon-assets.js')
const sideNames=['Right','Left'],fingerNames=['Thumb','Index','Middle','Ring','Little']
export function bakeGripPoses(source,handsSource) {
  const id=source.userData.weaponAsset,rig={id,root:source,pump:source.getObjectByName('Pump')}
  poseWeaponHands(rig,handsSource)
  // Fit the closed fingers to the actual triangle surfaces, with a small glove clearance.
  // The trigger index stays against the receiver. The knife support hand stays open.
  for(const side of sideNames){
    if(side==='Left'&&['knife','grenade'].includes(id))continue
    for(const finger of fingerNames){
      const meshName=id==='grenade'?'Shell':side==='Right'?finger==='Index'&&!['knife','launcher'].includes(id)?id==='pistol'?'Frame':'Receiver':'Grip':id==='pistol'?'Grip':id==='shotgun'?'Pump':'Handguard'
      fitFinger(source,rig[side.toLowerCase()],side,finger,source.getObjectByName(meshName))
    }
  }
  const poses={}
  for(const hand of [rig.right,rig.left])hand.traverse(n=>{if(n.isBone||n===hand)poses[n.name]={position:n.position.toArray(),quaternion:n.quaternion.toArray(),scale:n.scale.toArray()}})
  source.userData.viewModel.handPoses=poses
  if(!['knife','grenade'].includes(id)){
    const hand=rig.left,magazine=source.getObjectByName(id==='pistol'?'Cylinder':'Magazine')
    hand.removeFromParent();source.add(hand);source.updateMatrixWorld(true)
    const box=new T.Box3().setFromObject(magazine),center=box.getCenter(new T.Vector3())
    hand.position.copy(center);hand.position.x-=.024;hand.position.y=box.min.y-.012
    source.updateMatrixWorld(true)
    for(const finger of fingerNames)fitFinger(source,hand,'Left',finger,magazine)
    const pose={}
    hand.traverse(n=>{if(n.isBone&&n.name!=='LeftForearm')pose[n.name]=n.quaternion.toArray()})
    const relative=magazine.worldToLocal(hand.getWorldPosition(new T.Vector3()))
    const rotation=magazine.getWorldQuaternion(new T.Quaternion()).invert().multiply(hand.getWorldQuaternion(new T.Quaternion()))
    source.userData.viewModel.reloadHand={position:relative.toArray(),quaternion:rotation.toArray(),bones:pose}
  }
  rig.right.removeFromParent();rig.left.removeFromParent()
}

function fitFinger(source,hand,side,finger,surface){
  const meshes=[];surface?.traverse(n=>{if(n.isMesh)meshes.push(n)})
  if(!meshes.length)return
  const tip=hand.getObjectByName(side+finger+'Tip'),jointNames=[3,2,1].map(i=>side+finger+i)
  source.updateMatrixWorld(true)
  const point=tip.getWorldPosition(new T.Vector3()),target=new T.Vector3(),tri=new T.Triangle(),v=new T.Vector3(),normal=new T.Vector3();let distance=Infinity
  for(const mesh of meshes){const g=mesh.geometry,attr=g.attributes.position
    for(let i=0;i<attr.count;i+=3){
      tri.a.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);tri.b.fromBufferAttribute(attr,i+1).applyMatrix4(mesh.matrixWorld);tri.c.fromBufferAttribute(attr,i+2).applyMatrix4(mesh.matrixWorld)
      tri.closestPointToPoint(point,v);const d=point.distanceToSquared(v)
      if(d<distance){distance=d;target.copy(v);tri.getNormal(normal)}
    }
  }
  target.addScaledVector(normal,.002)
  for(let pass=0;pass<18;pass++){
    for(const name of jointNames){
      const joint=hand.getObjectByName(name),end=joint.worldToLocal(tip.getWorldPosition(new T.Vector3())),goal=joint.worldToLocal(target.clone())
      if(end.lengthSq()<1e-10||goal.lengthSq()<1e-10)continue
      end.normalize();goal.normalize()
      const rotation=new T.Quaternion().setFromUnitVectors(end,goal);rotation.slerp(new T.Quaternion(),.35)
      joint.quaternion.multiply(rotation);source.updateMatrixWorld(true)
    }
    if(tip.getWorldPosition(v).distanceTo(target)<.0005)break
  }

}
