import test from 'node:test'
import assert from 'node:assert/strict'
import {retainResourcesDuring} from '../../lib/view/retained-reparent.js'
import {detachAuthoredRoot} from '../../lib/view/authored-detachment.js'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E=await import('threepipe')

test('real Object3DManager reparent retains warmed geometry, material and texture until owner disposal',()=>{
 const manager=new E.Object3DManager(),scene=new E.Group(),dormant=new E.Group()
 manager.setRoot(scene);manager.registerObject(scene);scene.parentRoot=scene
 const texture=new E.DataTexture(new Uint8Array([255,255,255,255]),1,1),material=new E.PhysicalMaterial({map:texture}),geometry=new E.BoxGeometry()
 const mesh=new E.Mesh2(geometry,material);scene.add(mesh);manager.registerObject(mesh)
 const disposed={geometry:0,material:0,texture:0}
 for(const [key,value] of Object.entries({geometry,material,texture}))value.addEventListener('dispose',()=>disposed[key]++)
 assert.equal(manager.getGeometry(geometry.uuid),geometry)
 for(let cycle=0;cycle<3;cycle++){
  retainResourcesDuring(manager,()=>dormant.add(mesh))
  assert.equal(manager.getGeometry(geometry.uuid),undefined)
  assert.deepEqual(disposed,{geometry:0,material:0,texture:0})
  scene.add(mesh)
  assert.equal(manager.getGeometry(geometry.uuid),geometry)
  assert.equal(manager.autoDisposeGeometries,true);assert.equal(manager.autoDisposeMaterials,true);assert.equal(manager.autoDisposeTextures,true)
 }
 mesh.removeFromParent()
 assert.equal(disposed.geometry,1);assert.equal(disposed.material,1);assert.equal(disposed.texture,1)
})

test('retention scope restores mixed settings on nested calls and exceptions',()=>{
 const manager={autoDisposeObjects:true,autoDisposeGeometries:false,autoDisposeMaterials:true,autoDisposeTextures:false},saved={...manager}
 assert.throws(()=>retainResourcesDuring(manager,()=>{
  assert(Object.values(manager).every(v=>v===false))
  retainResourcesDuring(manager,()=>{});assert(Object.values(manager).every(v=>v===false));throw Error('abort')
 }),/abort/)
 assert.deepEqual(manager,saved)
})

test('restoring authored preview before its borrower is removed protects their shared geometry',()=>{
 const manager=new E.Object3DManager(),scene=new E.Group(),preview=new E.Group()
 manager.setRoot(scene);manager.registerObject(scene);scene.parentRoot=scene
 manager.registerObject(preview);scene.add(preview)
 const geometry=new E.BoxGeometry(),material=new E.PhysicalMaterial(),source=new E.Mesh2(geometry,material)
 preview.add(source);manager.registerObject(source)
 let disposed=0;geometry.addEventListener('dispose',()=>disposed++)
 const attachment=detachAuthoredRoot(preview,manager)
 assert.equal(disposed,0);assert.equal(preview.parent,null)
 const borrower=new E.Mesh2(geometry,material);scene.add(borrower);manager.registerObject(borrower)
 attachment.restore();assert.equal(preview.parent,scene)
 borrower.removeFromParent();assert.equal(disposed,0)
 assert.equal(manager.getGeometry(geometry.uuid),geometry)
 source.removeFromParent();assert.equal(disposed,1)
})
