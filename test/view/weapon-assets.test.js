import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {NodeIO} from '@gltf-transform/core'
import {weaponFixture,loadWeaponFixture} from './weapon-assets-fixture.mjs'
globalThis.window ??= {}
const {Group,Triangle,Vector3}=await import('threepipe')
const {WEAPON_IDS,getWeaponLibrary,instantiateWeaponRigs}=await import('../../lib/view/weapon-assets.js')
const {WeaponAnimation}=await import('../../lib/view/weapons-animation.js')
const {PlayerWeaponLibrary,selectPlayerWeapon}=await import('../../lib/view/players-weapons.js')
const {animatePlayerWeaponMechanisms}=await import('../../lib/view/players-animation.js')
const {bootLabWorld}=await import('../../scripts/WeaponsLab.script.js')
const root=new URL('../../',import.meta.url),io=new NodeIO()
const registry=JSON.parse(await readFile(new URL('assets.json',root),'utf8'))
const parts={
  pistol:['Frame','OctagonalBarrel','LoadingLever','Cylinder','Hammer','Trigger','TriggerGuard','Grip','Sights'],
  m4:['Receiver','Bolt','Magazine','Handguard','Barrel','Stock','Grip','Trigger','Sights'],
  shotgun:['Receiver','Bolt','Magazine','Pump','Barrel','Stock','Grip','Sights'],
  plasma:['Receiver','Bolt','Magazine','Coils','Handguard','Barrel','Stock','Grip'],
  knife:['Blade','Guard','Grip'],grenade:['Shell','Fuze','Pin','Lever'],
  sniper:['Receiver','Bolt','Magazine','Scope','Bipod','Handguard','Stock','Grip'],
  launcher:['Receiver','Breech','Barrel','LeafSight','Handguard','Magazine','Stock','Grip'],
}

for(const id of [...WEAPON_IDS,'hands'])test(`${id} glTF survives round trip with PBR maps and its triangle budget`,async()=>{
  const asset=registry.files['weapon-'+id]
  assert.ok(asset?.files[id+'.bin']);assert.equal(asset.path,asset.files[id+'.gltf'])
  for(const file of Object.values(asset.files))await readFile(new URL(file,root))
  const doc=await io.read(new URL(asset.path,root).pathname)
  const names=doc.getRoot().listNodes().map(n=>n.getName())
  let triangles=0
  for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives()){
    triangles+=(p.getIndices()??p.getAttribute('POSITION')).getCount()/3
    assert.ok(p.getAttribute('NORMAL'));assert.ok(p.getAttribute('TEXCOORD_0'))
    const m=p.getMaterial()
    for(const texture of [m.getBaseColorTexture(),m.getNormalTexture(),m.getMetallicRoughnessTexture(),m.getOcclusionTexture()]){
      assert.ok(texture);assert.deepEqual(texture.getSize(),[2048,2048])
    }
    if(id==='plasma')assert.ok(m.getEmissiveTexture())
  }
  assert.ok(triangles>0&&triangles<=(id==='hands'?6000:20000),`${triangles} triangles`)
  if(id==='hands'){
    assert.equal(doc.getRoot().listSkins().length,2)
    for(const side of ['Right','Left'])for(const finger of ['Index','Middle','Ring','Little','Thumb']){
      for(const joint of [1,2,3,'Tip'])assert.ok(names.includes(side+finger+joint))
    }
  }else{
    for(const name of ['Body','Muzzle','Ejection',...parts[id]])assert.ok(names.includes(name),name)
    const muzzle=doc.getRoot().listNodes().find(n=>n.getName()==='Muzzle')
    assert.ok(muzzle.getTranslation().every(Number.isFinite))
    if(!['knife','grenade'].includes(id))for(const name of ['SightFront','SightRear'])assert.ok(names.includes(name))
  }
  const reloaded=await io.readJSON(await io.writeJSON(doc))
  assert.deepEqual(reloaded.getRoot().listNodes().map(n=>[n.getName(),n.getExtras().gltfUUID]),doc.getRoot().listNodes().map(n=>[n.getName(),n.getExtras().gltfUUID]))
})

function surfaceDistance(point,object){
  let distance=Infinity
  const triangle=new Triangle(),nearest=new Vector3()
  object.traverse(mesh=>{
    if(!mesh.isMesh)return
    const g=mesh.geometry,p=g.attributes.position,count=g.index?.count??p.count
    for(let i=0;i<count;i+=3){
      for(const [v,j] of [[triangle.a,0],[triangle.b,1],[triangle.c,2]]){
        mesh.getVertexPosition(g.index?g.index.getX(i+j):i+j,v)
        v.applyMatrix4(mesh.matrixWorld)
      }
      triangle.closestPointToPoint(point,nearest);distance=Math.min(distance,point.distanceTo(nearest))
    }
  })
  return distance
}

for(const id of WEAPON_IDS)test(`${id} posed contact bones remain within one centimeter of the loaded grip surfaces`,()=>{
  const rig=instantiateWeaponRigs(new Group(),weaponFixture)[id]
  rig.root.updateMatrixWorld(true)
  for(const side of ['Right','Left'])for(const finger of ['Thumb','Index','Middle','Ring','Little']){
    // These support hands are deliberately free during the ready pose.
    if(side==='Left'&&['knife','grenade'].includes(id))continue
    const surface=id==='grenade'?'Shell':side==='Right'?
      finger==='Index'&&!['knife','launcher'].includes(id)?id==='pistol'?'Frame':'Receiver':'Grip':
      id==='pistol'?'Grip':id==='shotgun'?'Pump':'Handguard'
    const point=rig.root.getObjectByName(side+finger+'Tip').getWorldPosition(new Vector3())
    const distance=surfaceDistance(point,rig.root.getObjectByName(rig.clips?.length?surface+'_Surface':surface))
    assert.ok(distance<=.01,`${side}${finger}: ${(distance*1000).toFixed(2)} mm from ${surface}`)
  }
})

test('authored asset cache reuses files, isolates skeletons, and responds to replacement or deletion',async()=>{
  const root=await loadWeaponFixture(),library=getWeaponLibrary(root)
  assert.equal(getWeaponLibrary(root),library)
  const a=instantiateWeaponRigs(new Group(),root),b=instantiateWeaponRigs(new Group(),root)
  assert.equal(a.pistol.root.getObjectByName('Frame_Surface').geometry,b.pistol.root.getObjectByName('Frame_Surface').geometry)
  const bone=a.pistol.root.getObjectByName('RightIndex2'),other=b.pistol.root.getObjectByName('RightIndex2')
  const saved=other.quaternion.clone();bone.rotation.z+=.8
  assert.ok(saved.equals(other.quaternion));assert.notEqual(bone,other)
  const mesh=a.pistol.root.getObjectByName('Right_Hand_and_Sleeve')
  assert.equal(mesh.skeleton.bones.find(n=>n.name===bone.name),bone)
  const source=library.sources.pistol,parent=source.parent
  source.removeFromParent()
  assert.throws(()=>getWeaponLibrary(root),/Missing authored weapon asset: pistol/)
  parent.add(source.clone(true))
  assert.notEqual(getWeaponLibrary(root),library)
  assert.equal(getWeaponLibrary(root),getWeaponLibrary(root))
})

test('third person recoil and reload preserve authored mechanism pivots',()=>{
  const scene=new Group(),library=new PlayerWeaponLibrary(scene,{},weaponFixture),weapon=library.attach(scene)
  for(const id of WEAPON_IDS){
    const gun=selectPlayerWeapon(weapon,id)
    const positions=Object.fromEntries(['slide','magazine','pump'].map(key=>[key,gun[key].position.clone()]))
    animatePlayerWeaponMechanisms(gun,id,.5,.6)
    assert.ok(gun.magazine.position.distanceTo(positions.magazine)>.1)
    animatePlayerWeaponMechanisms(gun,id,0)
    for(const key of Object.keys(positions))assert.ok(gun[key].position.distanceTo(positions[key])<1e-7,`${id} ${key}`)
  }
  library.stop()
})

// The Blender revolver has a staged loader reach. Its contact and clip tests live
// in revolver.test.js; the remaining assets use the procedural ammunition grip.
for(const id of WEAPON_IDS.filter(id=>!['pistol','knife','grenade'].includes(id)))test(`${id} reload hand follows the moving ammunition part`,()=>{
  const {world,range}=bootLabWorld();range.equip(id)
  const rigs=instantiateWeaponRigs(new Group(),weaponFixture),rig=rigs[id]
  const animation=new WeaponAnimation(rigs,{update(){},fire(){},eject(){}})
  animation.sync(world);animation.setClipTime('reload',.52,world);rig.root.updateMatrixWorld(true)
  for(const finger of ['Thumb','Index','Middle','Ring','Little']){
    const point=rig.root.getObjectByName('Left'+finger+'Tip').getWorldPosition(new Vector3())
    const distance=surfaceDistance(point,rig.magazine)
    assert.ok(distance<=.01,`${finger}: ${(distance*1000).toFixed(2)} mm`)
  }
  animation.setClipTime('idle',0,world);rig.root.updateMatrixWorld(true)
  const stored=rig.root.userData.viewModel.handPoses.LeftIndex2.quaternion
  assert.ok(rig.left.getObjectByName('LeftIndex2').quaternion.toArray().every((v,i)=>Math.abs(v-stored[i])<1e-6))
})
