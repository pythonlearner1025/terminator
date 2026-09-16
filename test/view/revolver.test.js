import test from 'node:test'
import assert from 'node:assert/strict'
import {NodeIO} from '@gltf-transform/core'
import {readFile} from 'node:fs/promises'
import {weaponFixture} from './weapon-assets-fixture.mjs'
globalThis.window??={}
const {Group,Vector3,Quaternion}=await import('threepipe')
const {instantiateWeaponRigs}=await import('../../lib/view/weapon-assets.js')
const {WeaponAnimation}=await import('../../lib/view/weapons-animation.js')
const {bootLabWorld}=await import('../../scripts/WeaponsLab.script.js')
const file=new URL('../../assets/models/weapons/pistol/pistol.gltf',import.meta.url)
const expected={Idle:2,Draw:.6,Fire:.4,Reload:2.6,AimIn:.2,AimOut:.2,AimIdle:2,Sprint:.8,Inspect:3}
const required=['Muzzle','Hammer','Cylinder','LoadingLever','Trigger','Frame','OctagonalBarrel','Grip','TriggerGuard','SightFront','SightRear','HandRight','HandLeft']
function fixture(){
 const rigs=instantiateWeaponRigs(new Group(),weaponFixture),rig=rigs.pistol
 const {world,range,director}=bootLabWorld();let flashes=0
 const animation=new WeaponAnimation(rigs,{update(){},fire(){flashes++},eject(){}})
 animation.sync(world)
 const step=(n=1)=>{for(let i=0;i<n;i++){world.tick++;animation.sync(world)}}
 return {rig,rigs,world,range,director,animation,step,get flashes(){return flashes}}
}

test('Blender package has required nodes, one skin, separate budgets, and three 2K baked maps',async()=>{
 const doc=await new NodeIO().read(file.pathname),r=doc.getRoot(),nodes=r.listNodes()
 for(const name of required)assert.ok(nodes.some(n=>n.getName()===name),name)
 assert.equal(r.listSkins().length,1)
 let hands=0,weapon=0
 for(const n of nodes)for(const p of n.getMesh()?.listPrimitives()||[]){
  const tris=p.getIndices().getCount()/3
  if(n.getName().includes('Hand_and_Sleeve'))hands+=tris;else weapon+=tris
  assert.ok(p.getAttribute('JOINTS_0'));assert.ok(p.getAttribute('WEIGHTS_0'))
  for(const t of [p.getMaterial().getBaseColorTexture(),p.getMaterial().getNormalTexture(),p.getMaterial().getMetallicRoughnessTexture(),p.getMaterial().getOcclusionTexture()])assert.deepEqual(t.getSize(),[2048,2048])
 }
 assert.ok(weapon>8000&&weapon<=12000,`${weapon} weapon triangles`)
 assert.ok(hands>3000&&hands<=8000,`${hands} hand triangles`)
 assert.equal(r.listTextures().length,3)
 const g=JSON.parse(await readFile(file,'utf8'))
 assert.ok(g.nodes.find(n=>n.name==='OctagonalBarrel').children.includes(g.nodes.findIndex(n=>n.name==='Muzzle')))
})

test('all Blender clips keep exact durations and sample on the 30 fps grid',async()=>{
 const doc=await new NodeIO().read(file.pathname)
 for(const [name,duration] of Object.entries(expected)){
  const a=doc.getRoot().listAnimations().find(a=>a.getName()===name);assert.ok(a,name)
  let end=0
  for(const s of a.listSamplers())for(const t of s.getInput().getArray()){
   assert.ok(Math.abs(t*30-Math.round(t*30))<1e-4,`${name} ${t}`);end=Math.max(end,t)
  }
  assert.ok(Math.abs(end-duration)<1e-5,`${name} ${end}`)
 }
})

test('authored pistol owns independent embedded hands and leaves other weapon paths procedural',()=>{
 const a=fixture(),b=fixture()
 assert.equal(a.rig.clips.length,9);assert.ok(a.rig.clipPlayer)
 for(const [id,rig]of Object.entries(a.rigs))if(id!=='pistol')assert.equal(rig.clipPlayer,undefined)
 const skinned=[];a.rig.root.traverse(n=>{if(n.isSkinnedMesh&&n.name.includes('Hand_and_Sleeve'))skinned.push(n)})
 assert.equal(skinned.length,2);assert.equal(a.rig.root.getObjectsByProperty('name','HandRight').length,1)
 const original=b.rig.root.getObjectByName('RightIndex1').quaternion.clone()
 a.rig.root.getObjectByName('RightIndex1').rotation.x+=.4
 assert.ok(original.equals(b.rig.root.getObjectByName('RightIndex1').quaternion))
 a.animation.dispose();b.animation.dispose()
})

test('real core shots trigger Fire, index one chamber, move Muzzle, and recover to Idle',()=>{
 const f=fixture();f.step(50)
 assert.equal(f.rig.clipPlayer.name,'Idle')
 const muzzle=f.rig.muzzle.getWorldPosition(new Vector3()),cylinder=f.rig.magazine.quaternion.clone()
 for(let i=0;i<3;i++){
  assert.ok(f.world.playerFire(f.world.player.id))
  f.step(4);assert.equal(f.rig.clipPlayer.name,'Fire')
  assert.ok(f.rig.muzzle.getWorldPosition(new Vector3()).distanceTo(muzzle)>.008)
  f.step(19)
  assert.ok(f.rig.magazine.quaternion.angleTo(cylinder)>.95)
  f.step(40);f.world.player.fireCooldown=0
 }
 assert.equal(f.flashes,3);assert.equal(f.rig.clipPlayer.name,'Idle')
 f.animation.dispose()
})

test('range clock scales mixer at 0.25x and pause leaves the pose unchanged',()=>{
 const f=fixture();f.step(50);f.range.clock.setScale(.25)
 const start=f.rig.clipPlayer.mixer.time
 for(let i=0;i<60;i++)f.step(f.range.clock.takeTicks(1000/60))
 assert.ok(Math.abs(f.rig.clipPlayer.mixer.time-start-.25)<1e-8)
 f.range.clock.setScale(0)
 for(let i=0;i<60;i++)f.step(f.range.clock.takeTicks(1000/60))
 assert.ok(Math.abs(f.rig.clipPlayer.mixer.time-start-.25)<1e-8)
 f.animation.dispose()
})

test('reload moves cylinder, fingers, and loader; aim and sprint select their own clips',()=>{
 const f=fixture();f.step(50)
 const finger=f.rig.root.getObjectByName('LeftIndex2'),ready=finger.quaternion.clone(),cylinder=f.rig.magazine.position.clone()
 assert.ok(f.range.reload());f.step()
 assert.equal(f.rig.clipPlayer.name,'Reload')
 for(let i=0;i<72;i++){f.world.player.reloadTimer-=1/60;f.step()}
 assert.ok(f.rig.magazine.position.distanceTo(cylinder)>.06)
 assert.ok(finger.quaternion.angleTo(ready)>.12)
 assert.ok(f.rig.root.getObjectByName('SpeedLoader').scale.x>.95)
 const hand=f.rig.root.getObjectByName('LeftIndexTip').getWorldPosition(new Vector3())
 const loader=f.rig.root.getObjectByName('SpeedLoader').getWorldPosition(new Vector3())
 assert.ok(hand.distanceTo(loader)<.11,'loader stays within the support hand reach')
 f.world.player.reloadTimer=0;f.step(8)
 assert.equal(f.rig.clipPlayer.name,'Idle');assert.ok(f.rig.magazine.position.distanceTo(cylinder)<1e-5)
 f.world.player.aiming=true;f.step();assert.equal(f.rig.clipPlayer.name,'AimIn')
 f.step(15);assert.equal(f.rig.clipPlayer.name,'AimIdle')
 f.world.player.aiming=false;f.step();assert.equal(f.rig.clipPlayer.name,'AimOut')
 f.step(15);f.world.player.vel.z=7;f.step();assert.equal(f.rig.clipPlayer.name,'Sprint')
 f.animation.dispose();assert.equal(f.rig.clipPlayer.mixer.stats.actions.inUse,0)
})

test('Muzzle faces local +Z and follows the barrel skin through recoil',()=>{
 const f=fixture();f.step(50)
 const rotation=new Quaternion();f.rig.muzzle.getWorldQuaternion(rotation)
 const direction=new Vector3(0,0,1).applyQuaternion(rotation)
 const barrelDirection=new Vector3(0,0,1).applyQuaternion(f.rig.root.getObjectByName('OctagonalBarrel').getWorldQuaternion(new Quaternion()))
 assert.ok(direction.distanceTo(barrelDirection)<1e-5)
 f.animation.setClipTime('fire',.25,f.world)
 assert.ok(f.rig.body.rotation.x<-.08)
 f.animation.setClipTime('fire',.5,f.world)
 const thumb=f.rig.root.getObjectByName('RightThumbTip').getWorldPosition(new Vector3())
 const spur=f.rig.root.getObjectByName('HammerContact').getWorldPosition(new Vector3())
 assert.ok(thumb.distanceTo(spur)<.012,'right thumb touches the hammer during recocking')
 f.animation.setClipTime(null,0,f.world);f.animation.dispose()
})
