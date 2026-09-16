import test from 'node:test'
import assert from 'node:assert/strict'
import {batchPlacedMap} from '../../lib/view/map-batching.js'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const api=await import('threepipe')

test('batched sources stay registered and restore transforms and visibility on repeat stop',()=>{
 const source=new api.Group(),runtime=new api.Group(),marker=new api.Group(),material=new api.PhysicalMaterial({color:0x334455})
 source.add(marker)
 const placements=[]
 for(let i=0;i<4;i++){
  const root=new api.Group();root.position.set(i*3,2,1);root.name=`source ${i}`
  root.userData.mapPiece={id:`piece-${i}`,assetId:'box',role:i===3?'door':'collider'}
  const mesh=new api.Mesh2(new api.BoxGeometry(1,2,3),material);root.add(mesh);source.add(root);placements.push(root)
 }
 placements[1].visible=false
 const order=[...source.children],states=placements.map(p=>({matrix:p.matrix.clone(),position:p.position.toArray(),visible:p.visible}))
 for(let cycle=0;cycle<2;cycle++){
  const batch=batchPlacedMap(api,source,runtime)
  assert.deepEqual(source.children,order)
  assert(placements.every(p=>p.parent===source && !p.visible))
  assert.equal(batch.batches.length,1);assert.equal(batch.dynamic.length,1)
  assert.equal(batch.batches[0].geometry.attributes.position.count,36*3)
  assert.equal(batch.dynamic[0].parent,runtime)
  const extra=new api.Group();source.add(extra)
  batch.restore();batch.restore()
  assert.deepEqual(source.children,[...order,extra])
  for(let i=0;i<4;i++){
   assert.equal(placements[i].parent,source)
   assert.deepEqual(placements[i].position.toArray(),states[i].position)
   assert.equal(placements[i].visible,states[i].visible)
  }
  extra.removeFromParent()
  for(const mesh of batch.batches)mesh.geometry.dispose()
  runtime.clear()
 }
 for(const p of placements)p.children[0].geometry.dispose()
 material.dispose()
})
