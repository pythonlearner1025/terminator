import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E=await import('threepipe')
const {RagdollSystem}=await import('../../lib/view/ragdoll.js')

// Exercise real Mesh2 setters and Object3DManager: bare three.Mesh mocks do not
// dispatch materialChanged and therefore miss renderer program disposal.
for(const family of ['gore','skinned','HK debris'])test(`${family}: fade swaps retain pooled materials and shared maps through reset`,()=>{
 const manager=new E.Object3DManager(),scene=new E.Group()
 manager.setRoot(scene);manager.registerObject(scene);scene.parentRoot=scene
 const system=new RagdollSystem({colliders:[]},manager)
 const map=new E.DataTexture(new Uint8Array([255,255,255,255]),1,1)
 const original=new E.PhysicalMaterial({map}),fade=original.clone(),geometry=new E.BoxGeometry()
 fade.transparent=true;fade.depthWrite=false
 const mesh=new E.Mesh2(geometry,original);scene.add(mesh);manager.registerObject(mesh)
 mesh.userData.wreckMaterial=fade
 const counts={original:0,fade:0,map:0}
 for(const [name,resource] of Object.entries({original,fade,map}))resource.addEventListener('dispose',()=>counts[name]++)
 for(let cycle=0;cycle<2;cycle++){
  const record=system.addDetached(mesh,new E.Vector3(),()=>{})
  record.visual=null // This focused fixture borrows the unit material-selection path below.
  system.freeze(record)
  if(family==='skinned')record.visual={rig:{mesh,wreckMaterial:fade}}
  record.settledAt=system.clock-180
  system.update(0);assert.equal(mesh.material,original)
  system.update(1/60);assert.equal(mesh.material,fade)
  assert.equal(record.fadeOwned,false);assert.equal(fade.map,map)
  assert.deepEqual(counts,{original:0,fade:0,map:0},'fade entry must not dispose the old material or shared textures')
  system.reset();assert.equal(mesh.material,original);assert.equal(fade.opacity,1)
  assert.deepEqual(counts,{original:0,fade:0,map:0},'reset must retain the warmed fade program references')
  assert.equal(manager.autoDisposeMaterials,true);assert.equal(manager.autoDisposeTextures,true)
 }
 system.dispose();mesh.removeFromParent();fade.dispose()
 assert.equal(counts.original,1);assert.equal(counts.fade,1);assert.equal(counts.map,1)
})

test('an unprepared transient fade still disposes its owned clone at release',()=>{
 const manager=new E.Object3DManager(),scene=new E.Group()
 manager.setRoot(scene);manager.registerObject(scene);scene.parentRoot=scene
 const original=new E.PhysicalMaterial(),mesh=new E.Mesh2(new E.BoxGeometry(),original)
 scene.add(mesh);manager.registerObject(mesh)
 const system=new RagdollSystem({colliders:[]},manager),record=system.addDetached(mesh,new E.Vector3(),()=>{})
 system.freeze(record);record.settledAt=system.clock-180;system.update(1/60)
 const fade=record.fadeMaterial;let disposed=0;fade.addEventListener('dispose',()=>disposed++)
 assert.equal(record.fadeOwned,true)
 system.release(record);assert.equal(mesh.material,original);assert.equal(disposed,1)
 system.release(record);assert.equal(disposed,1)
 system.dispose();mesh.removeFromParent()
})
