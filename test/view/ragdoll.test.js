import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Ray, Vec3} from 'cannon-es'

globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {RagdollSystem, buildRagdollTerrain} = await import('../../lib/view/ragdoll.js')
const map = JSON.parse(readFileSync(new URL('../../lib/core/data/map.json',import.meta.url),'utf8'))

function fixture(pos={x:4,y:0,z:10}) {
  const object=new E.Group(), joints={}, contacts=[]
  object.position.copy(pos)
  const bone=(name,parent,x,y,z,size)=>{
    const b=new E.Bone();b.name=name;b.position.set(x,y,z);parent.add(b);joints[name]=b
    const [w,h,d]=size
    contacts.push({bone:b,corners:Array.from({length:8},(_,i)=>new E.Vector3((i&1?1:-1)*w/2,(i&2?0:-h),(i&4?1:-1)*d/2))})
    return b
  }
  const pelvis=bone('Pelvis',object,0,1,0,[.3,.15,.2]),chest=bone('Chest',pelvis,0,.4,0,[.5,.3,.24])
  bone('Head',chest,0,.4,0,[.25,.24,.24])
  for(const [side,sign] of [['Left',-1],['Right',1]]) {
    const arm=bone('Shoulder '+side,chest,sign*.32,.15,0,[.15,.35,.15])
    bone('Forearm '+side,arm,0,-.35,0,[.14,.42,.14])
    const thigh=bone('Thigh '+side,pelvis,sign*.14,-.08,0,[.16,.42,.16])
    bone('Shin '+side,thigh,0,-.42,0,[.14,.45,.18])
  }
  const mesh=new E.Mesh(new E.BoxGeometry(),new E.MeshStandardMaterial())
  object.add(mesh);object.updateMatrixWorld(true)
  return {object,rig:{joints,contacts,mesh,actuators:[],severed:new Set(),states:new Set()}}
}
const unit=(pos={x:4,y:0,z:10})=>({type:'endo',pos,vel:{x:0,y:0,z:1}})
const shot={weapon:'shotgun',headshot:false,direction:{x:0,y:0,z:-1},point:{x:4,y:1.4,z:10}}
const advance=(system,seconds)=>{for(let i=0;i<seconds*60;i++)system.update(1/60)}

test('death preserves the posed rig, inherits velocity, and applies localized head torque',()=>{
  const system=new RagdollSystem(map), state=unit(), before=JSON.stringify(state),v=fixture()
  v.rig.joints.Chest.rotation.x=.3;v.object.updateMatrixWorld(true)
  const head=v.rig.joints.Head.getWorldPosition(new E.Vector3())
  const record=system.add(v,state,{...shot,headshot:true},()=>{})
  system.syncPose(record)
  assert.ok(v.rig.joints.Head.getWorldPosition(new E.Vector3()).distanceTo(head)<1e-6)
  assert.equal(record.parts.length,11);assert.equal(record.constraints.length,10)
  assert.ok(record.parts[0].body.velocity.z < -3)
  assert.ok(record.parts.find(p=>p.bone.name==='Head').body.angularVelocity.length()>8)
  advance(system,2)
  for(const joint of record.constraints) {
    const a=joint.bodyA.pointToWorldFrame(joint.pivotA),b=joint.bodyB.pointToWorldFrame(joint.pivotB)
    assert.ok(a.distanceTo(b)<.09,'joints remain attached')
  }
  assert.equal(JSON.stringify(state),before)
  system.dispose();assert.equal(system.world.bodies.length,0);assert.equal(system.world.constraints.length,0)
})

test('terrain matches treads and leaves the actual stairwell open',()=>{
  const terrain=buildRagdollTerrain(map)
  const hitAt=(x,z)=>{
    const ray=new Ray(new Vec3(x,8,z),new Vec3(x,-1,z));ray.mode=Ray.CLOSEST;ray.updateDirection();ray.intersectBodies(terrain)
    assert.ok(ray.hasHit);return ray.result.hitPointWorld.y
  }
  for(let i=1;i<=6;i++)assert.ok(Math.abs(hitAt(10,25.5-i)-i*.5)<1e-6)
  assert.ok(Math.abs(hitAt(7,22)-3.15)<1e-6)
  for(const x of [17.2,17.7,18.2])assert.ok(Math.abs(hitAt(x,-5)-(x>=18?.7:Math.min(.6,(x-17)/1.5*.7)))<.013)
})

test('eight active cap freezes the oldest pose and retains it for 180 seconds before a two second fade',()=>{
  const system=new RagdollSystem(map),records=[];let recycled=0
  for(let i=0;i<9;i++)records.push(system.add(fixture(),unit(),shot,()=>recycled++))
  assert.equal(system.active.length,8);assert.equal(records[0].settledAt,0)
  assert.equal(system.world.constraints.length,80)
  const material=records[0].visual.rig.mesh.material
  advance(system,179);assert.equal(recycled,0)
  assert.equal(records[0].visual.rig.mesh.material,material)
  advance(system,2)
  assert.ok(Math.abs(records[0].visual.rig.mesh.material.opacity-.5)<.02)
  assert.ok(records[0].object.position.y<-.3)
  advance(system,1.1);assert.ok(recycled>=1)
  assert.equal(records[0].visual.rig.mesh.material,material)
  assert.ok(system.freeBodies.length>=11)
  system.dispose()
})

test('a detached limb settles on a tread, keeps its lifetime, and reuses a physics body',()=>{
  const system=new RagdollSystem(map)
  const mesh=new E.Mesh(new E.BoxGeometry(.14,.4,.14),new E.MeshStandardMaterial())
  mesh.position.set(10,2.3,22.5)
  let recycled=0
  const record=system.addDetached(mesh,new Vec3(0,0,0),()=>recycled++)
  advance(system,8)
  assert.notEqual(record.settledAt,null)
  assert.ok(mesh.position.y>=1.55 && mesh.position.y<1.8,`limb rests above tread: ${mesh.position.y}`)
  advance(system,171);assert.equal(recycled,0)
  advance(system,12);assert.equal(recycled,1)
  const free=system.freeBodies.length
  mesh.position.y=2.3
  system.addDetached(mesh,new Vec3(),()=>{})
  assert.equal(system.freeBodies.length,free-1)
  system.dispose()
})

test('delayed skull detachment removes its body and constraint without restarting the corpse',()=>{
  const system=new RagdollSystem(map),v=fixture(),state=unit(),before=JSON.stringify(state)
  const record=system.add(v,state,shot)
  system.update(1/60)
  const born=record.born,head=record.byBone.get(v.rig.joints.Head).body
  system.detachBone(record,v.rig.joints.Head)
  assert.equal(record.born,born);assert.equal(record.parts.length,10);assert.equal(record.constraints.length,9)
  assert.ok(!system.world.bodies.includes(head));assert.equal(JSON.stringify(state),before)
  system.update(1/60);system.dispose()
})

test('blast-split torsos omit the waist joint and receive divergent velocities',()=>{
  const system=new RagdollSystem(map),v=fixture();v.rig.goreSplit=true
  const record=system.add(v,unit(),{...shot,weapon:'launcher'})
  assert.equal(record.constraints.length,9)
  const chest=record.byBone.get(v.rig.joints.Chest).body,pelvis=record.byBone.get(v.rig.joints.Pelvis).body
  assert.ok(!record.constraints.some(j=>j.bodyA===pelvis&&j.bodyB===chest))
  assert.ok(chest.velocity.y>pelvis.velocity.y+3)
  system.dispose()
})

test('24 active pieces retain frozen records and reuse the primed physics pool',()=>{
  const system=new RagdollSystem(map);system.primePools()
  const bodies=new Set(system.freeBodies),records=new Set(system.freeLimbRecords),pieces=[]
  const hulls=new Map([...bodies].map(body=>[body,body.shapes[0].convexPolyhedronRepresentation]))
  for(let i=0;i<40;i++){
    const mesh=new E.Mesh(new E.BoxGeometry(.1,.2,.1),new E.MeshStandardMaterial());mesh.position.set(4,2,10)
    const record=system.addDetached(mesh,new Vec3(1,2,1),()=>{});pieces.push(record)
    assert.ok(records.has(record));assert.ok(bodies.has(record.parts[0].body))
    assert.equal(record.parts[0].body.shapes[0].convexPolyhedronRepresentation,hulls.get(record.parts[0].body))
    assert.ok(system.activeCount('limb')<=24)
  }
  assert.equal(system.activeCount('limb'),24);assert.equal(system.records.size,40)
  assert.notEqual(pieces[0].settledAt,null)
  system.dispose()
})
