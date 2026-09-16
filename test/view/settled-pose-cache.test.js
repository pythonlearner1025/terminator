import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {cacheSettledPose} = await import('../../lib/view/settled-pose-cache.js')
const {loadUnitFigure} = await import('../../tools/load-unit-asset.mjs')
const {cloneSkinnedFigure} = await import('../../lib/view/unit-assets.js')
const {bindUnitRig} = await import('../../lib/view/units-animation.js')
const {RagdollSystem} = await import('../../lib/view/ragdoll.js')
const {GoreSystem, GorePiecePool, GORE_CRUNCH_SECONDS} = await import('../../lib/view/gore.js')

function simple() {
  const root=new E.Group(), bone=new E.Bone(), child=new E.Bone()
  root.add(bone);bone.add(child);child.position.y=1
  const mesh=new E.SkinnedMesh(new E.BufferGeometry(),new E.MeshBasicMaterial())
  root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new E.Skeleton([bone,child]));mesh.skeleton.computeBoneTexture()
  return {root,bone,child,mesh,skeleton:mesh.skeleton}
}
const render=f=>{f.root.updateMatrixWorld(true);if(f.skins)for(const skin of f.skins)skin.skeleton.update();else f.skeleton.update()}
function compare(a,b) {
  const an=[],bn=[];a.root.traverse(n=>an.push(n));b.root.traverse(n=>bn.push(n))
  assert.equal(an.length,bn.length)
  for(let i=0;i<an.length;i++) {
    assert.deepEqual(an[i].matrix.elements,bn[i].matrix.elements)
    assert.deepEqual(an[i].matrixWorld.elements,bn[i].matrixWorld.elements)
    if(an[i].isSkinnedMesh)assert.deepEqual(an[i].skeleton.boneMatrices,bn[i].skeleton.boneMatrices)
  }
  assert.deepEqual(a.mesh.bindMatrixInverse.elements,b.mesh.bindMatrixInverse.elements)
  assert.deepEqual(a.skeleton.boneMatrices,b.skeleton.boneMatrices)
}
test('600 unchanged frames skip bone math/upload invalidation with exact pose',()=>{
  const a=simple(),b=simple(),cache=cacheSettledPose(a.root)
  render(a);render(b);const version=a.skeleton.boneTexture.version
  for(let frame=0;frame<600;frame++){render(a);render(b)}
  compare(a,b)
  assert.deepEqual(cache.stats,{skinUpdates:1,skinSkips:600})
  assert.equal(a.skeleton.boneTexture.version,version)
  assert.equal(b.skeleton.boneTexture.version-version,600)
  cache.dispose();assert.equal(Object.hasOwn(a.skeleton,'update'),false)
  a.root.traverse(n=>assert.equal(Object.hasOwn(n,'updateMatrix'),false))
  render(a);assert.equal(a.skeleton.boneTexture.version,version+1)
  cache.dispose();a.skeleton.dispose();b.skeleton.dispose()
})
test('actual bone/parent/manual/inverse/resource changes invalidate; explicit world updates retain semantics',()=>{
  const a=simple(),b=simple(),cache=cacheSettledPose(a.root)
  const changes=[
    f=>f.child.scale.setScalar(.00001),
    f=>f.root.position.set(4,-.325,10),
    f=>f.bone.quaternion.setFromAxisAngle(new E.Vector3(1,0,0),.35),
    f=>f.child.position.x=Number.EPSILON,
    f=>{f.bone.matrix.elements[12]=999},
    f=>{f.bone.matrixAutoUpdate=false;f.bone.matrix.makeTranslation(2,3,4)},
    f=>f.root.add(f.child),
    f=>{f.skeleton.boneInverses[1].elements[12]+=.1},
    f=>{f.skeleton.boneMatrices=new Float32Array(f.skeleton.boneMatrices.length)},
    f=>{f.skeleton.dispose();f.skeleton.computeBoneTexture()},
  ]
  render(a);render(b)
  for(const change of changes){change(a);change(b);render(a);render(b);compare(a,b)}
  cache.dispose();a.skeleton.dispose();b.skeleton.dispose()
})
test('cache deduplicates shared skins and restores own methods without overwriting a later owner',()=>{
  const f=simple(),other=f.mesh.clone();other.skeleton=f.skeleton;f.root.add(other)
  const original=f.skeleton.update;f.skeleton.update=original
  const cache=cacheSettledPose(f.root);render(f);f.skeleton.update()
  assert.equal(cache.stats.skinUpdates,1);assert.equal(cache.stats.skinSkips,1)
  const later=()=>{};f.bone.updateMatrix=later;cache.dispose()
  assert.equal(f.bone.updateMatrix,later);assert.equal(f.skeleton.update,original)
  assert.equal(Object.hasOwn(f.skeleton,'update'),true);f.skeleton.dispose()
})
test('a later instrumentation wrapper can retain the method while disposal restores live updates',()=>{
  const f=simple(),lease=cacheSettledPose(f.root),cached=f.skeleton.update
  f.skeleton.update=function(){return cached.call(this)}
  render(f);const version=f.skeleton.boneTexture.version
  lease.dispose();render(f);render(f)
  assert.equal(f.skeleton.boneTexture.version,version+2)
  assert.deepEqual(lease.stats,{skinUpdates:1,skinSkips:0});f.skeleton.dispose()
})

// Exercise production gore methods against actual authored mesh/bone data,
// with texture-free effect containers (no browser, image decode, or GPU).
async function corpse(type='endo',cached=true) {
  const object=await loadUnitFigure(type),rig=bindUnitRig(object)
  rig.highGeometry=rig.mesh.geometry;object.position.set(4,0,10);object.updateMatrixWorld(true)
  const visual={object,rig,unitType:type,impact:{weapon:'m4'}},system=new RagdollSystem({colliders:[]})
  const gore=Object.create(GoreSystem.prototype),material=new E.MeshStandardMaterial()
  Object.assign(gore,{ragdolls:system,definitions:new Map(),visuals:new Set(),clock:0,materials:{metal:material},
    root:new E.Group(),particles:[],stumps:[],stains:[],nextStump:0,obstacles:[],ray:new E.Ray(),
    hit:{point:new E.Vector3(),normal:new E.Vector3()},stats:{maxVertices:0,crunches:0,limbs:0,splits:0,dents:0,wreckHits:0,frames:0,totalMs:0,maxMs:0},
    fx:{stats:{severedLimbs:0},hit(){gore.bursts++},particle(){},scorch(){}},bursts:0,
    inverse:new E.Matrix4(),bind:new E.Matrix4(),rotation:new E.Matrix3(),temp:new E.Object3D(),
    stumpMesh:new E.InstancedMesh(new E.BufferGeometry(),material,128),stainMesh:new E.InstancedMesh(new E.BufferGeometry(),material,1)})
  for(const key of ['v','p','d','n','scale'])gore[key]=new E.Vector3()
  gore.particles=[{fluid:true,next:0,mesh:new E.InstancedMesh(new E.BufferGeometry(),material,160),items:Array.from({length:160},()=>({pos:new E.Vector3(),vel:new E.Vector3(),life:0}))}]
  gore.stumps=Array.from({length:128},()=>({owner:null,bone:null,pos:new E.Vector3(),q:new E.Quaternion(),size:1}))
  gore.pieces=new GorePiecePool(()=>{
    const mesh=new E.Mesh(new E.BufferGeometry(),material),item={mesh,record:null,batchId:null,trail:0}
    item.onRelease=()=>{item.record=null};item.release=()=>{if(item.record)system.release(item.record)};return item
  })
  gore.prepareType(visual);gore.prepareVisual(visual);gore.primePieces()
  const unit={type,pos:{x:4,y:0,z:10},vel:{x:0,y:0,z:0},maxHp:300}
  const record=system.add(visual,unit,null,()=>{gore.releaseVisual(visual)})
  const freeze=()=>{system.freeze(record);if(!cached){record.poseCache.dispose();record.poseCache=null}}
  const skins=[];object.traverse(n=>{if(n.isSkinnedMesh){n.skeleton.computeBoneTexture();skins.push(n)}})
  return {root:object,mesh:rig.mesh,skeleton:rig.mesh.skeleton,visual,rig,system,gore,unit,record,freeze,skins,
    close(){system.dispose();gore.reset();for(const skin of skins)skin.skeleton.dispose();visual.gore.deformer.dispose();gore.pieceBatch.dispose();for(const item of gore.pieces.items)item.pieceGeometry.dispose();for(const defs of gore.definitions.values())for(const d of defs.values())d.geometry.dispose()}}
}
function hitPoint(f,name) {
  const boneId=f.skeleton.bones.indexOf(f.rig.joints[name]),skin=f.mesh.geometry.attributes.skinIndex
  let vertex=0;while(vertex<skin.count&&skin.getX(vertex)!==boneId)vertex++
  assert.ok(vertex<skin.count)
  return f.mesh.getVertexPosition(vertex,new E.Vector3()).applyMatrix4(f.mesh.matrixWorld)
}
function compareCorpse(a,b) {
  render(a);render(b);compare(a,b)
  for(const name of ['position','normal'])assert.deepEqual(a.rig.mesh.geometry.attributes[name].array,b.rig.mesh.geometry.attributes[name].array)
  assert.deepEqual(a.rig.severed,b.rig.severed)
  assert.deepEqual(a.rig.mesh.boundingSphere,b.rig.mesh.boundingSphere)
  assert.equal(a.gore.bursts,b.gore.bursts)
  const ap=a.gore.pieces.items.filter(p=>p.record),bp=b.gore.pieces.items.filter(p=>p.record)
  assert.equal(ap.length,bp.length)
  for(let i=0;i<ap.length;i++) {
    assert.deepEqual(ap[i].pieceGeometry.attributes.position.array,bp[i].pieceGeometry.attributes.position.array)
    assert.deepEqual(ap[i].mesh.position,bp[i].mesh.position)
  }
}
test('early eight-body-cap freeze preserves pending crunch, head detach, hit bursts, fade, and recycle',async()=>{
  const a=await corpse(),b=await corpse('endo',false)
  for(const f of [a,b]) {
    const point=hitPoint(f,'Head')
    f.gore.event({type:'kill',headshot:true,part:'Head',weapon:'m4'},f.visual,f.unit,f.rig.joints.Head,point,new E.Vector3(0,0,1))
    assert.ok(f.visual.gore.crunch?.count>0)
    // Fill the real active pool, forcing the oldest unit to freeze mid-crunch.
    for(let i=0;i<8;i++){const object=cloneSkinnedFigure(f.root);f.system.add({object,rig:bindUnitRig(object)},f.unit,null)}
    assert.equal(f.record.settledAt,0)
    if(f===b){f.record.poseCache.dispose();f.record.poseCache=null}
  }
  compareCorpse(a,b)
  for(const f of [a,b])f.gore.update(GORE_CRUNCH_SECONDS/2)
  compareCorpse(a,b);assert.ok(a.visual.gore.crunch)
  for(const f of [a,b])f.gore.update(GORE_CRUNCH_SECONDS/2)
  compareCorpse(a,b);assert.equal(a.visual.gore.crunch,null);assert.ok(a.rig.severed.has('Head'))
  for(const f of [a,b]) {
    const before=f.gore.bursts
    f.gore.hitWrecks({type:'shot',origin:{x:4,y:1.1,z:0}},new Map([[1,f.visual]]),{yaw:0,pitch:0})
    assert.equal(f.gore.bursts,before+1);assert.equal(f.gore.stats.wreckHits,1)
    f.system.clock=179.99;f.system.update(0);assert.equal(f.record.fadeMaterial,null)
    f.system.clock=181;f.system.update(0)
    assert.equal(f.root.position.y,-.325);assert.equal(f.record.fadeMaterial.opacity,.5)
  }
  compareCorpse(a,b)
  const lease=a.record.poseCache
  for(const f of [a,b]){f.system.clock=182;f.system.update(0);assert.equal(f.record.poseCache,null);assert.equal(Object.hasOwn(f.skeleton,'update'),false)}
  const before=lease.stats.skinUpdates;a.rig.joints.Head.scale.setScalar(1);render(a)
  assert.equal(lease.stats.skinUpdates,before)
  a.close();b.close()
})
test('actual scout/endo/heavy limb, blast split, and dent paths match uncached poses; reset releases leases',async()=>{
  for(const type of ['scout','endo','heavy']) {
    const a=await corpse(type),b=await corpse(type,false)
    for(const f of [a,b]) {
      const point=hitPoint(f,'Chest'),direction=new E.Vector3(0,0,1)
      f.gore.event({type:'unit_damage',part:'Chest',weapon:'m4',amount:100},f.visual,f.unit,f.rig.joints.Chest,point,direction)
      f.gore.event({type:'kill',part:'Forearm Left',weapon:'shotgun'},f.visual,f.unit,f.rig.joints['Forearm Left'],point,direction)
      f.gore.event({type:'kill',weapon:'launcher'},f.visual,f.unit,f.rig.joints.Chest,point,direction)
      f.freeze()
    }
    compareCorpse(a,b);assert.ok(a.rig.goreSplit);assert.ok(a.gore.stats.dents)
    for(const f of [a,b]){f.system.reset();assert.equal(f.record.poseCache,null);assert.equal(Object.hasOwn(f.skeleton,'update'),false);f.close()}
  }
})
test('repeated revival reuses the record, restores every skin, and Stop releases the final cache',async()=>{
  const f=await corpse(),original=f.skeleton.update
  let record=f.record
  for(let i=0;i<30;i++) {
    f.system.freeze(record);render(f);render(f)
    const lease=record.poseCache
    assert.ok(lease.stats.skinSkips>0)
    f.system.release(record)
    assert.equal(record.poseCache,null);assert.equal(f.skeleton.update,original)
    f.rig.joints.Head.scale.setScalar(1+i*.001);render(f)
    const next=f.system.add(f.visual,f.unit,null)
    assert.equal(next,record);record=next
  }
  f.system.freeze(record);f.close()
  assert.equal(record.poseCache,null);assert.equal(f.skeleton.update,original)
})
