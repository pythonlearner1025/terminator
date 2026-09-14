import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import scan from '../assets/v2/architecture/rubble-cover.json' with {type:'json'}
import placements from '../lib/core/data/map-piece-placements.json' with {type:'json'}
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E=await import('threepipe')
const {default:generate}=await import('../generators/v2-preview.js')

test('integration: deterministic preview recipe removal releases owned content without disposing authored atlases',async()=>{
 const modelRoot=new E.Group(),map=new E.Group(),node=new E.Group()
 map.name='Map';modelRoot.add(map,node)
 for(const placement of placements.pieces){
  const item=new E.Group();item.name=placement.name;item.userData.mapPiece=structuredClone(placement)
  item.position.fromArray(placement.translation||[0,0,0]);item.rotation.fromArray(placement.rotation||[0,0,0])
  if(placement.quaternion)item.quaternion.fromArray(placement.quaternion)
  item.scale.fromArray(placement.scale||[1,1,1]);map.add(item)
 }
 const sources=[];let authoredDisposals=0
 for(let i=1;i<=5;i++){
  const texture=new E.Texture();texture.addEventListener('dispose',()=>authoredDisposals++)
  const material=new E.PhysicalMaterial({name:`Selected rubble ${i}: authored atlas`,map:texture})
  const mesh=new E.Mesh2(new E.BoxGeometry(),material);map.add(mesh);sources.push({mesh,texture,material,listeners:texture._listeners?.update?.length||0})
 }
 const viewer={scene:{modelRoot},getPlugin(){return null},setDirty(){}}
 // The browser recipe fetches the declared scan. Node's fetch cannot read file:
 // URLs, so only this exact fixture URL uses real local bytes and abort semantics.
 const coverURL=new URL(`../assets/models/selected/${scan.source}/scene.bin`,import.meta.url),originalFetch=globalThis.fetch
 globalThis.fetch=async(url,options={})=>String(url)===coverURL.href
  ?new Response(await readFile(coverURL,{signal:options.signal}))
  :originalFetch(url,options)
 try{
  for(let cycle=0;cycle<2;cycle++){
   const root=await generate({node,viewer,engine:E})
   let ownedDisposals=0,geometryCount=0
   root.traverse(object=>{if(object.geometry){geometryCount++;object.geometry.addEventListener('dispose',()=>ownedDisposals++)}})
   assert(geometryCount>0)
   // MapView intentionally detaches this output while its own runtime is active.
   root.userData.v2PreviewDetached=true;root.removeFromParent()
   assert.equal(ownedDisposals,0);assert(root.children.length>0)
   node.add(root);delete root.userData.v2PreviewDetached
   // Generator rerun/removal must dispose only owned geometry/materials first.
   root.removeFromParent()
   assert.equal(ownedDisposals,geometryCount);assert.equal(root.children.length,0)
   assert.equal(authoredDisposals,0)
   for(const {mesh,texture,material,listeners}of sources){assert.equal(mesh.material,material);assert.equal(material.map,texture);assert.equal(texture._listeners?.update?.length||0,listeners)}
  }
 }finally{
  globalThis.fetch=originalFetch
  for(const {mesh,texture,material}of sources){mesh.geometry.dispose();material.map=null;material.setDirty?.();material.dispose();texture.dispose()}
 }
})
