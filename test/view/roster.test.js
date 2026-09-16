import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {measureRosterParts,measureColliderFit} from '../../tools/collider-fit.mjs'
// Use the collider tool's DOM and texture shims. Geometry and animation remain real.
const partFit=await measureRosterParts()
const E=await import('threepipe')
const {loadUnitAsset}=await import('../../tools/load-unit-asset.mjs')
const {clonePlacedUnitFigure,cloneSkinnedFigure}=await import('../../lib/view/unit-assets.js')
const {rosterMaterials}=await import('../../lib/view/roster-materials.js')
const {bindUnitRig,animateUnit,disposeUnitRig}=await import('../../lib/view/units-animation.js')
const {resetRosterRig,rosterHit}=await import('../../lib/view/roster-animation.js')
const {RosterFx,rosterDeathPhase}=await import('../../lib/view/roster-fx.js')
const {RagdollSystem,WRECK_SECONDS}=await import('../../lib/view/ragdoll.js')
const {goreDecision}=await import('../../lib/view/gore.js')
const {TEMPLATE_NAMES}=await import('../../lib/view/units.js')
const {waveBannerTitle}=await import('../../lib/ui/boss.js')
const types=['t1000','hkaerial','hktank']
const sources=new Map(await Promise.all(types.map(async type=>[type,await loadUnitAsset(type)])))
const spec=JSON.parse(await readFile(new URL('../../lib/core/data/units.json',import.meta.url),'utf8'))
function fixture(type){
  const object=clonePlacedUnitFigure(sources.get(type),type),rig=bindUnitRig(object)
  const unit={id:'fixture-'+type,type,pos:{x:0,y:0,z:0},vel:{x:0,y:0,z:0},yaw:0,alive:true,hp:300,maxHp:900,intent:{},spawnedAt:0}
  return {object,rig,unitType:type,unit}
}
function step(v,n=30){for(let i=0;i<n;i++)animateUnit(v.rig,v.unit,1/60,i/60)}
function destroy(v){disposeUnitRig(v.rig,v.object)}

test('nested asset bone suffixes rebind to the cloned skeleton',()=>{
  const nested=clonePlacedUnitFigure(sources.get('t1000'),'t1000','far')
  nested.traverse(node=>{if(node.isBone){node.userData.name=node.name;node.name=`${node.name} 1`}})
  const clone=cloneSkinnedFigure(nested),clonedBones=new Set()
  clone.traverse(node=>{if(node.isBone)clonedBones.add(node)})
  clone.traverse(node=>{if(node.isSkinnedMesh)assert.ok(node.skeleton.bones.every(bone=>clonedBones.has(bone)))})
})

test('three roster templates register authored sources and all core part names',async()=>{
  const scene=JSON.parse(await readFile(new URL('../../assets/main.scene.gltf',import.meta.url),'utf8'))
  for(const type of types){
    assert.ok(scene.nodes.some(n=>n.name===TEMPLATE_NAMES[type] || n.name===TEMPLATE_NAMES[type].replaceAll(' ','_')),type)
    const v=fixture(type)
    for(const part of Object.keys(spec.types[type].parts).flatMap(p=>p==='Limbs'?['Upper Arm Left','Upper Arm Right','Thigh Left','Thigh Right']:p)){
      const name=part==='head'?'Head':part==='chest'?'Chest':part==='left arm'?'Upper Arm Left':part==='right arm'?'Upper Arm Right':part==='left leg'?'Thigh Left':part==='right leg'?'Thigh Right':part
      assert.ok(v.rig.joints[name],`${type}: ${part}`)
    }
    assert.ok(v.rig.roster);destroy(v)
  }
})

test('roster surfaces carry shared complete PBR maps with no vertex colors',async()=>{
  await rosterMaterials(E).ready
  for(const type of types){
    const v=fixture(type),second=fixture(type),m=v.rig.mesh.material
    for(const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap'])assert.ok(m[key]?.isTexture,`${type} ${key}`)
    assert.ok(m.envMap);assert.equal(m.metalness,1);assert.equal(m.map,second.rig.mesh.material.map)
    assert.equal(v.rig.mesh.geometry.attributes.color,undefined)
    assert.ok(v.rig.mesh.geometry.attributes.uv.array.every(Number.isFinite))
    if(v.rig.roster.lights)assert.ok(v.rig.roster.lights.emissiveMap)
    destroy(v);destroy(second)
  }
})

test('all twenty authored part bounds and both settled poses fit within five centimetres',async()=>{
  assert.equal(partFit.length,20)
  for(const row of partFit)assert.ok(row.maxErrorCm<=5,`${row.type} ${row.part}: ${row.maxErrorCm}`)
  for(const row of (await measureColliderFit()).units.filter(row=>types.includes(row.type))){
    assert.ok(row.outerCm<=5,`${row.type} ${row.pose} outer ${row.outerCm}`)
    assert.ok(row.missingCm<=5,`${row.type} ${row.pose} missing ${row.missingCm}`)
  }
})

test('liquid blades morph on attack, ripple on impact, and shimmer as HP rises without changing core state',()=>{
  const v=fixture('t1000'),r=v.rig.roster
  v.unit.intent.melee=true;const before=JSON.stringify(v.unit);step(v)
  assert.equal(JSON.stringify(v.unit),before);assert.ok(r.blades[1].scale.y>.95);assert.ok(r.palms[1].scale.x<.05)
  assert.equal(rosterHit(v,{pos:{y:1.3},part:'Chest'}),true);step(v,1)
  assert.ok(r.uniforms.ripple.value>.9);assert.equal(r.uniforms.hitY.value,1.3)
  v.unit.hp=320;step(v,1);assert.ok(r.uniforms.regen.value>0)
  v.unit.intent.melee=false;step(v,40);assert.ok(r.blades[1].scale.y<.01)
  for(const weapon of ['shotgun','launcher','sniper'])assert.equal(goreDecision({unitType:'t1000',type:'kill',weapon,headshot:true,part:'head'},900),0)
  resetRosterRig(v.rig);assert.equal(r.blades[1].scale.y,.00001);assert.equal(r.puddle.visible,false)
  destroy(v)
})

test('aerial banks, turns its turret, spins intakes, and points a bounded searchlight',()=>{
  const v=fixture('hkaerial'),r=v.rig.roster;v.unit.vel.x=5;v.unit.intent.aimAt={x:4,y:0,z:8}
  const before=JSON.stringify(v.unit);step(v)
  assert.ok(r.bank<-.1);assert.ok(r.turret.rotation.y>.3);assert.ok(r.rotors[0].rotation.y>10)
  assert.ok(r.cone.scale.y>1&&r.cone.scale.y<=14);assert.equal(JSON.stringify(v.unit),before);destroy(v)
})

test('tank scrolls the shared tread atlas, recoils both guns, and flares its rear core',()=>{
  const v=fixture('hktank'),r=v.rig.roster;v.unit.vel.z=1.6;v.unit.intent.aimAt={x:4,y:1,z:9};v.rig.recoil=1
  rosterHit(v,{part:'Core'});step(v,1)
  assert.ok(r.uniforms.scroll.value>0);assert.ok(r.cannons.every(b=>b.position.z<-.05))
  assert.ok(r.coreUniform.value>.9);assert.ok(r.turret.rotation.y>0);destroy(v)
})

test('liquid collapse creates a growing pool, sinks, and releases without metal debris',()=>{
  const v=fixture('t1000'),physics=new RagdollSystem({colliders:[]}),root=new E.Group(),fx=new RosterFx(root,physics)
  root.add(v.object);fx.prepare(v);let released=0;fx.die(v,v.unit,()=>released++)
  assert.equal(physics.records.size,0);assert.equal(rosterDeathPhase('t1000',0),'collapse')
  fx.update(.8);assert.equal(v.rig.roster.deathPhase,'pool');const size=v.rig.roster.puddle.scale.x
  fx.update(1);assert.ok(v.rig.roster.puddle.scale.x>size);assert.ok(v.object.scale.y<.001)
  fx.update(2);assert.equal(v.rig.roster.deathPhase,'sink');assert.ok(v.rig.roster.puddle.position.y<0)
  fx.update(2);assert.equal(released,1);assert.equal(fx.deaths.size,0);assert.equal(v.rig.roster.puddle.visible,false)
  fx.dispose();physics.dispose();destroy(v)
})

test('vehicle deaths use resident piece physics and keep fire through the wreck lifetime',()=>{
  for(const type of ['hkaerial','hktank']){
    const v=fixture(type),root=new E.Group(),physics=new RagdollSystem({colliders:[]}),fx=new RosterFx(root,physics)
    root.add(v.object);physics.primePools();fx.prepare(v)
    const buffers=fx.mesh.instanceMatrix.array,items=fx.items.slice();let released=0
    fx.die(v,v.unit,()=>released++)
    assert.equal(physics.records.size,type==='hkaerial'?6:1);assert.ok(v.rig.roster.pieces.every(p=>p.mesh.visible))
    fx.update(.2);assert.equal(v.rig.roster.deathPhase,'burn');assert.ok(fx.mesh.count>0)
    if(type==='hktank')assert.ok(v.object.position.y<0)
    fx.update(179);assert.equal(v.rig.roster.deathPhase,'burn');assert.equal(released,0)
    fx.update(1);assert.equal(v.rig.roster.deathPhase,'sink');fx.update(2)
    assert.equal(released,1);assert.equal(physics.records.size,0);assert.equal(fx.mesh.instanceMatrix.array,buffers)
    assert.ok(fx.items.every((p,i)=>p===items[i]));fx.dispose();physics.dispose();destroy(v)
  }
})

test('boss wave announcement remains without enemy health overlay',()=>{
  for(const current of [5,10])assert.equal(waveBannerTitle({current}),'HK-TANK INBOUND')
  assert.equal(waveBannerTitle({current:4}),'WAVE 4')
})

test('match priming allocates live aerial optics before death paths and retains those exact pools for first spawn',async()=>{
  const {UnitView}=await import('../../lib/view/units.js')
  const {defaultMap}=await import('../../lib/core/map.js')
  const scene=new E.Scene();scene.modelRoot=new E.Group();scene.add(scene.modelRoot);scene.mainCamera=new E.PerspectiveCamera()
  for(const [type,name] of Object.entries(TEMPLATE_NAMES)){
    const source=(await loadUnitAsset(type)).clone();source.name=name;scene.modelRoot.add(source)
  }
  window.addEventListener??=()=>{};window.removeEventListener??=()=>{}
  const viewer={scene,addEventListener(){},removeEventListener(){}}
  const view=new UnitView(viewer)
  try{
    view.start({map:defaultMap,eventLog:[],tick:0})
    await Promise.all([view.fx.materials.ready,view.rosterFx.ready,view.fx.gore.ready])
    const release=view.primeWarmup(),beam=view.optics.rosterPools.beam,spot=view.optics.rosterPools.spot
    assert(beam?.mesh.isInstancedMesh);assert(spot?.mesh.isInstancedMesh)
    assert.equal(beam.mesh.instanceMatrix.count,64);assert.equal(spot.mesh.instanceMatrix.count,64)
    assert.equal(view.warmupReport.pooledRigs,54)
    assert.equal(view.warmupReport.rosterDeaths,3);assert.equal(view.warmupReport.skullCrunch,1)
    const fading=[...view.ragdolls.records].filter(record=>record.fadeMaterial)
    const gore=view.fx.gore.pieces.items.filter(item=>item.record)
    assert.equal(gore.filter(item=>item.record.fadeMaterial).length,1,'prime the individual gore fade draw')
    assert(gore.some(item=>view.fx.gore.pieceBatch.getVisibleAt(item.batchId)),'retain the opaque batched gore draw')
    assert.equal(fading.filter(record=>record.object.name.startsWith('Detached hkaerial')).length,6)
    assert.equal(fading.filter(record=>record.object.name.startsWith('Detached hktank')).length,1)
    assert.equal(fading.filter(record=>record.visual).length,1,'retain the skinned heavy fade')
    let disposed=0
    const saved=fading.map(record=>{
      const mesh=record.fadeMesh,material=record.fadeMaterial,original=record.fadeOriginal
      assert.equal(material,record.visual?.rig.wreckMaterial||mesh.userData.wreckMaterial)
      assert.equal(mesh.material,material);assert.equal(material.transparent,true);assert.equal(material.depthWrite,false)
      assert(Math.abs(material.opacity-.5)<1e-8);assert.equal(record.fadeOwned,false)
      assert.equal(material.map,original.map);assert.equal(material.normalMap,original.normalMap)
      assert.equal(material.userData.renderToGBuffer,original.userData.renderToGBuffer)
      material.addEventListener('dispose',()=>disposed++)
      return {mesh,material,original,geometry:mesh.geometry}
    })
    release()
    assert.equal(view.ragdolls.records.size,0);assert.equal(view.ragdolls.clock,0)
    for(const {mesh,material,original,geometry} of saved){
      assert.equal(mesh.material,original);assert.equal(material.opacity,1);assert.equal(mesh.geometry,geometry)
    }
    assert.equal(disposed,0,'pooled fade materials survive cleanup')
    assert.deepEqual(view.warmupReport.fades,{skinned:1,gore:1,vehiclePieces:7})
    assert.equal(beam.mesh.count,0);assert.equal(spot.mesh.count,0)
    const visual=view.cloneTemplateFigure({id:'first-aerial',type:'hkaerial',pos:{x:0,y:4,z:0},yaw:0})
    view.visuals.set('first-aerial',visual)
    view.optics.update([visual])
    assert.equal(view.optics.rosterPools.beam,beam);assert.equal(view.optics.rosterPools.spot,spot)
    assert.equal(beam.mesh.count,1);assert.equal(spot.mesh.count,1)
    // Reuse an actual detached pool item at the first fade boundary. Advance
    // only its settled age; the ordinary update must perform the material swap.
    const item=gore.find(item=>saved.some(entry=>entry.mesh===item.mesh))
    const record=view.ragdolls.addDetached(item.mesh,new E.Vector3(),item.onRelease)
    item.record=record
    view.ragdolls.freeze(record)
    record.settledAt=view.ragdolls.clock-WRECK_SECONDS
    view.ragdolls.update(0)
    assert.equal(record.fadeMaterial,null);assert.equal(item.mesh.material,view.fx.gore.materials.metal)
    view.ragdolls.update(1/60)
    assert.equal(record.fadeMaterial,item.fade);assert.equal(item.mesh.material,item.fade)
    assert(item.fade.opacity<1&&item.fade.opacity>.98);assert.equal(item.mesh.visible,true)
    assert.equal(view.fx.gore.pieceBatch.getVisibleAt(item.batchId),false)
    view.ragdolls.release(record)
    assert.equal(item.fade.opacity,1);assert.equal(disposed,0)
  }finally{view.stop()}
  assert.equal(scene.children.length,1)
})
