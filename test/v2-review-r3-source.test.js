import test from 'node:test'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {readFile} from 'node:fs/promises'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
// Explicit immutable extraction, not a sibling's live working tree.
const sourceRoot = process.env.V2_REVIEW_SOURCE_ROOT
const audit = (name, fn) => test(`review R3: ${name}`, {skip: !sourceRoot && 'Set V2_REVIEW_SOURCE_ROOT to a pinned source extraction'}, fn)
const source = path => import(pathToFileURL(resolve(sourceRoot, path)))
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('hex')

audit('wall filtering preserves crossing/foreign triangles and original buffers, and respects group/draw exclusions', async () => {
 const {replaceRuntimeWallShells}=await source('lib/view/v2/architecture-shells.js')
 const root=new E.Group(),g=new E.BufferGeometry(),m=new E.PhysicalMaterial({name:'Map concrete'})
 // Contained wall, wholly foreign floor, then a crossing triangle with two inside vertices.
 g.setAttribute('position',new E.Float32BufferAttribute([-.5,0,0,.5,0,0,0,.5,0, 5,0,0,6,0,0,5,1,0, 0,0,0,.5,0,0,5,0,0],3))
 g.setAttribute('normal',new E.Float32BufferAttribute(Array.from({length:27},(_,i)=>i%3===2?1:0),3))
 g.setAttribute('uv',new E.Float32BufferAttribute(Array.from({length:18},(_,i)=>i/17),2))
 g.setAttribute('color',new E.Uint8BufferAttribute(Array.from({length:27},(_,i)=>i*7),3,true))
 g.setIndex(new E.Uint32BufferAttribute([2,0,1,5,3,4,8,6,7],1))
 const originalIndex=bytes(g.index.array),originalAttrs=Object.fromEntries(Object.entries(g.attributes).map(([k,v])=>[k,bytes(v.array)]))
 const mesh=new E.Mesh2(g,m);mesh.name='Static placed map Map concrete';root.add(mesh)
 const colliders=[{id:'wall',center:{x:0,y:0,z:0},size:{x:2,y:2,z:2}}]
 const absent=replaceRuntimeWallShells(root,colliders);assert.equal(absent.count,0);assert.equal(mesh.geometry,g);absent.dispose()
 g.userData.mapSourceRanges={version:1,unit:'draw-elements',entries:[
  {start:0,count:3,pieceId:'wall',nodeId:'collider:wall',assetId:'wall-asset',role:'collider'},
  {start:3,count:3,pieceId:'floor',nodeId:'collider:floor',assetId:'floor-asset',role:'collider'},
  {start:6,count:3,pieceId:'wall',nodeId:'collider:wall',assetId:'wall-asset',role:'collider'},
 ]}
 let ownedDisposed=0,originalDisposed=0;g.addEventListener('dispose',()=>originalDisposed++)
 const h=replaceRuntimeWallShells(root,colliders)
 assert.equal(h.count,1);mesh.geometry.addEventListener('dispose',()=>ownedDisposed++)
 assert.deepEqual([...mesh.geometry.index.array],[5,3,4,8,6,7])
 for(const [name,attr]of Object.entries(g.attributes)){assert.equal(bytes(attr.array),originalAttrs[name]);assert.equal(bytes(mesh.geometry.attributes[name].array),originalAttrs[name]);assert.equal(mesh.geometry.attributes[name].normalized,attr.normalized)}
 assert.equal(bytes(g.index.array),originalIndex);h.dispose();h.dispose();assert.equal(mesh.geometry,g);assert.equal(originalDisposed,0);assert.equal(ownedDisposed,1)
 for(const kind of ['group','partial']){
  if(kind==='group')g.addGroup(0,3,0);else{g.clearGroups();g.setDrawRange(3,6)}
  const groups=JSON.stringify(g.groups),range={...g.drawRange};const skip=replaceRuntimeWallShells(root,colliders)
  assert.equal(skip.count,0);skip.dispose();assert.equal(mesh.geometry,g);assert.equal(JSON.stringify(g.groups),groups);assert.deepEqual(g.drawRange,range);assert.equal(bytes(g.index.array),originalIndex)
 }
 g.dispose();m.dispose()
})

audit('Generator removal protects all borrowed atlas instances and listeners over repeated previews', async () => {
 const {default:generate}=await source('generators/v2-preview.js')
 const data=JSON.parse(await readFile(resolve(sourceRoot,'lib/core/data/map-piece-placements.json'),'utf8'))
 const modelRoot=new E.Group(),map=new E.Group(),node=new E.Group();map.name='Map';modelRoot.add(map,node)
 for(const piece of data.pieces){const p=new E.Group();p.userData.mapPiece=piece;p.position.fromArray(piece.translation);p.rotation.fromArray([...piece.rotation,'XYZ']);p.scale.fromArray(piece.scale||[1,1,1]);map.add(p)}
 const textures=[],materials=[];let borrowedDisposals=0
 for(let i=1;i<=5;i++){const t=new E.Texture();t.addEventListener('dispose',()=>borrowedDisposals++);const mat=new E.PhysicalMaterial({name:`Selected rubble ${i}: audit`,map:t});const mesh=new E.Mesh2(new E.BoxGeometry(),mat);modelRoot.add(mesh);textures.push(t);materials.push(mat)}
 const listenerCounts=textures.map(t=>t._listeners?.update?.length||0)
 for(let cycle=0;cycle<3;cycle++){
  const preview=await generate({node,viewer:{scene:{modelRoot},getPlugin(){return null}},engine:E})
  assert.ok(preview.children.length);preview.removeFromParent()
  // Installed Generator removes first, then recursively disposes enumerable resources.
  preview.traverse(o=>{o.geometry?.dispose();for(const mat of Array.isArray(o.material)?o.material:[o.material]){if(!mat)continue;for(const value of Object.values(mat))if(value?.isTexture)value.dispose();mat.dispose()}})
  assert.equal(node.children.length,0);assert.equal(borrowedDisposals,0)
  assert.deepEqual(textures.map(t=>t._listeners?.update?.length||0),listenerCounts)
  materials.forEach((m,i)=>assert.equal(m.map,textures[i]))
 }
 modelRoot.traverse(o=>o.geometry?.dispose());for(const m of materials){m.map=null;m.setDirty();m.dispose()}textures.forEach(t=>t.dispose())
})

audit('material cancellation releases both early and late loads after a texture failure', async () => {
 const {mountV2Materials}=await source('lib/view/v2/materials.js')
 const root=new E.Group(),original=new E.PhysicalMaterial({name:'Map concrete'}),mesh=new E.Mesh2(new E.BoxGeometry(),original);root.add(mesh)
 const loads=[],h=mountV2Materials({root,loadTexture:()=>new Promise((resolve,reject)=>loads.push({resolve,reject}))})
 assert.equal(loads.length,3);let released=0
 const texture=()=>{const t=new E.Texture();t.addEventListener('dispose',()=>released++);return t}
 const observed=assert.rejects(h.ready,/intentional load failure/)
 loads[0].resolve(texture());await Promise.resolve();loads[1].reject(new Error('intentional load failure'));await observed
 h.dispose();assert.equal(mesh.material,original);loads[2].resolve(texture());await Promise.resolve();await Promise.resolve()
 assert.equal(released,2);h.dispose();assert.equal(released,2);mesh.geometry.dispose();original.dispose()
})

audit('real building floor caps survive primitive wall filtering', async () => {
 const {NodeIO}=await import('@gltf-transform/core')
 const {defaultMap}=await source('lib/core/map.js')
 const {replaceRuntimeWallShells}=await source('lib/view/v2/architecture-shells.js')
 const json=async path=>JSON.parse(await readFile(resolve(sourceRoot,path),'utf8'))
 const placement=(await json('lib/core/data/map-piece-placements.json')).pieces.find(p=>p.id==='building_ground_floor')
 const file=(await json('assets.json')).files[placement.assetId].path
 const gltf=await json(file),resources={}
 for(const buffer of gltf.buffers)resources[buffer.uri]=new Uint8Array(await readFile(buffer.uri.startsWith('/kite3d/')?resolve(sourceRoot,buffer.uri.slice(8)):new URL(buffer.uri,pathToFileURL(resolve(sourceRoot,file)))))
 delete gltf.extensions;delete gltf.extensionsUsed;delete gltf.extensionsRequired;delete gltf.images;delete gltf.textures
 gltf.materials=gltf.materials.map(m=>({name:m.name}))
 const doc=await new NodeIO().readJSON({json:gltf,resources})
 const placementMatrix=new E.Matrix4().compose(new E.Vector3().fromArray(placement.translation),new E.Quaternion().setFromEuler(new E.Euler(...placement.rotation)),new E.Vector3().fromArray(placement.scale||[1,1,1]))
 const walls=defaultMap.colliders.filter(c=>['wall','building_wall','tunnel_wall','column'].includes(c.kind))
 let checked=0,removed=0
 for(const node of doc.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()||[]){
  if(primitive.getMaterial()?.getName()!=='Map concrete')continue
  const geometry=new E.BufferGeometry()
  for(const [semantic,name]of [['POSITION','position'],['NORMAL','normal'],['TEXCOORD_0','uv']]){
   const attr=primitive.getAttribute(semantic);if(attr)geometry.setAttribute(name,new E.Float32BufferAttribute(attr.getArray(),attr.getElementSize()))
  }
  const index=primitive.getIndices();if(index)geometry.setIndex([...index.getArray()])
  const batch=geometry.index?geometry.toNonIndexed():geometry.clone()
  batch.applyMatrix4(placementMatrix.clone().multiply(new E.Matrix4().fromArray(node.getWorldMatrix())))
  const material=new E.PhysicalMaterial({name:'Map concrete'}),mesh=new E.Mesh2(batch,material),root=new E.Group();mesh.name='Static placed map Map concrete';root.add(mesh)
  const h=replaceRuntimeWallShells(root,walls)
  checked+=batch.attributes.position.count/3
  if(h.count)removed+=(batch.attributes.position.count-mesh.geometry.index.count)/3
  h.dispose();assert.equal(mesh.geometry,batch);batch.dispose();geometry.dispose();material.dispose()
 }
 assert.equal(checked,12,'Fixture must cover the actual twelve original floor-box triangles')
 assert.equal(removed,0,'Foreign building_ground_floor side/cap triangles must survive; wall OBB containment is not source ownership')
})

audit('actual batching records contiguous append provenance; filtering remaps only the detached clone', async () => {
 const {batchPlacedMap}=await source('lib/view/map-batching.js')
 const {replaceRuntimeWallShells}=await source('lib/view/v2/architecture-shells.js')
 const authored=new E.Group(),runtime=new E.Group(),material=new E.PhysicalMaterial({name:'Map concrete'}),geometry=new E.BoxGeometry(2,2,2)
 const originalAttributes=Object.fromEntries(Object.entries(geometry.attributes).map(([k,a])=>[k,bytes(a.array)])),originalIndex=bytes(geometry.index.array),originalMetadata=JSON.stringify(geometry.userData)
 function placement(id,role='collider',x=0){const p=new E.Group();p.name=id;p.userData.mapPiece={id,nodeId:`${role}:${id}`,assetId:`asset-${id}`,role};const mesh=new E.Mesh2(geometry,material);mesh.position.x=x;p.add(mesh);authored.add(p);return p}
 const wall=placement('wall'),foreign=placement('floor'),pipe=placement('pipe','decoration'),dynamic=placement('door','door'),crossing=placement('wall-tail','collider',5)
 // Two primitive appends for one source piece must remain separately attributed.
 const extra=new E.Mesh2(geometry,material);extra.position.x=5;wall.add(extra)
 const batch=batchPlacedMap(E,authored,runtime);assert.equal(batch.batches.length,1)
 const mesh=batch.batches[0],original=mesh.geometry,draw=original.userData.mapSourceRanges
 assert.deepEqual(draw,{version:1,unit:'draw-elements',entries:[
  {start:0,count:36,pieceId:'wall',nodeId:'collider:wall',assetId:'asset-wall',role:'collider'},
  {start:36,count:36,pieceId:'wall',nodeId:'collider:wall',assetId:'asset-wall',role:'collider'},
  {start:72,count:36,pieceId:'floor',nodeId:'collider:floor',assetId:'asset-floor',role:'collider'},
  {start:108,count:36,pieceId:'pipe',nodeId:'decoration:pipe',assetId:'asset-pipe',role:'decoration'},
  {start:144,count:36,pieceId:'wall-tail',nodeId:'collider:wall-tail',assetId:'asset-wall-tail',role:'collider'},
 ]})
 assert.equal(original.attributes.position.count,180);assert.equal(batch.dynamic.length,1)
 assert.equal(draw.entries.some(e=>e.pieceId==='door'),false)
 // All canonical identity strings are snapshots of actual source metadata.
 foreign.userData.mapPiece.id='edited-after-batch';assert.equal(draw.entries[2].pieceId,'floor')
 // Force an indexed draw with a nontrivial triangle index order, same draw ownership.
 original.setIndex(Array.from({length:180},(_,i)=>Math.floor(i/3)*3+[2,0,1][i%3]))
 const indexBefore=bytes(original.index.array),metadataBefore=JSON.stringify(original.userData)
 const h=replaceRuntimeWallShells(runtime,[{id:'wall',center:{x:0,y:0,z:0},size:{x:2,y:2,z:2}}])
 assert.equal(h.count,1);const result=mesh.geometry
 assert.deepEqual([...result.index.array],[...original.index.array].slice(36))
 assert.notEqual(result.userData,original.userData);assert.notEqual(result.userData.mapSourceRanges,draw);assert.notEqual(result.userData.mapSourceRanges.entries,draw.entries)
 assert.deepEqual(result.userData.mapSourceRanges.entries,draw.entries.slice(1).map(e=>({...e,start:e.start-36})))
 assert.equal(JSON.stringify(original.userData),metadataBefore);assert.equal(bytes(original.index.array),indexBefore)
 for(const [key,attr]of Object.entries(original.attributes))assert.equal(bytes(result.attributes[key].array),bytes(attr.array))
 result.userData.mapSourceRanges.entries[0].pieceId='owned-clone-edit'
 assert.equal(JSON.stringify(original.userData),metadataBefore)
 h.dispose();assert.equal(mesh.geometry,original);assert.equal(JSON.stringify(original.userData),metadataBefore)
 for(const [key,attr]of Object.entries(geometry.attributes))assert.equal(bytes(attr.array),originalAttributes[key])
 assert.equal(bytes(geometry.index.array),originalIndex);assert.equal(JSON.stringify(geometry.userData),originalMetadata)
 batch.restore();for(const p of [wall,foreign,pipe,dynamic,crossing])assert.equal(p.visible,true)
 original.dispose();geometry.dispose();material.dispose()
})

audit('ground teardown restores every authored atlas listener count across repeat mounts', async () => {
 const {mountV2Ground}=await source('lib/view/v2/ground.js'),{defaultMap}=await source('lib/core/map.js')
 const modelRoot=new E.Group(),textures=[],materials=[],meshes=[]
 for(let i=1;i<=5;i++){const t=new E.Texture(),m=new E.PhysicalMaterial({name:`Selected rubble ${i}: lifetime audit`,map:t}),mesh=new E.Mesh2(new E.BoxGeometry(),m);modelRoot.add(mesh);textures.push(t);materials.push(m);meshes.push(mesh)}
 const baseline=textures.map(t=>t._listeners?.update?.length||0);let sourceDisposals=0
 textures.forEach(t=>t.addEventListener('dispose',()=>sourceDisposals++))
 const counts=[]
 try{
  for(let i=0;i<3;i++){
   const root=new E.Group(),h=mountV2Ground({viewer:{scene:{modelRoot}},root,map:defaultMap});await h.ready
   assert.equal(h.stats.sharedImages,5);h.dispose();h.dispose();assert.equal(root.children.length,0)
   materials.forEach((m,j)=>assert.equal(m.map,textures[j]));assert.equal(sourceDisposals,0)
   counts.push(textures.map(t=>t._listeners?.update?.length||0))
  }
  assert.deepEqual(counts,[baseline,baseline,baseline],'Ground material copies must detach update callbacks from borrowed source atlases, not retain disposed materials')
 }finally{meshes.forEach(m=>m.geometry.dispose());materials.forEach(m=>{m.map=null;m.setDirty();m.dispose()});textures.forEach(t=>t.dispose())}
})

audit('ground partial loads and cancellation preserve callback identities and release every owned texture once', async () => {
 const {mountV2Ground}=await source('lib/view/v2/ground.js'),{defaultMap}=await source('lib/core/map.js')
 for(const fail of [false,true]){
  const modelRoot=new E.Group(),root=new E.Group(),sources=[],sourceMaterials=[],sourceMeshes=[]
  let sourceDisposed=0,sentinelCalls=0
  for(let i=1;i<=2;i++){
   const albedo=new E.Texture(),normal=new E.Texture()
   for(const t of [albedo,normal]){t.addEventListener('dispose',()=>sourceDisposed++);t.addEventListener('update',()=>sentinelCalls++);sources.push(t)}
   const m=new E.PhysicalMaterial({name:`Selected rubble ${i}: mixed pending audit`,map:albedo,normalMap:normal}),mesh=new E.Mesh2(new E.BoxGeometry(),m)
   modelRoot.add(mesh);sourceMaterials.push(m);sourceMeshes.push(mesh)
  }
  const callbacks=sources.map(t=>[...(t._listeners?.update||[])]),loads=[],owned=new Map()
  const watch=t=>{if(!owned.has(t)){owned.set(t,0);t.addEventListener('dispose',()=>owned.set(t,owned.get(t)+1))}return t}
  const h=mountV2Ground({viewer:{scene:{modelRoot}},root,map:defaultMap,loadTexture:()=>new Promise((resolve,reject)=>loads.push({resolve,reject}))})
  const rejected=fail?assert.rejects(h.ready,/intentional ground failure/):null
  try{
   for(const mesh of h.root.children)for(const slot of ['map','normalMap'])if(mesh.material[slot])watch(mesh.material[slot])
   assert.equal(owned.size,4,'Separate owned albedo/normal handles for the two borrowed source materials')
   await Promise.resolve();assert.equal(loads.length,3)
   sources.forEach((t,i)=>assert.deepEqual(t._listeners.update,callbacks[i],'copy replacement leaves exact authored callbacks'))
   if(fail){
    loads[0].resolve(watch(new E.Texture()));await Promise.resolve();await Promise.resolve()
    loads[1].reject(new Error('intentional ground failure'));await rejected
    assert.equal(h.stats.disposed,true,'failed initialization must clean partial resources')
    loads[2].resolve(watch(new E.Texture()))
   }else{
    h.dispose();for(const load of loads)load.resolve(watch(new E.Texture()));await h.ready
   }
   const subsequent=new E.Group();subsequent.name='new runtime after cancelled ground';root.add(subsequent)
   await Promise.resolve();await Promise.resolve();h.dispose()
   assert.deepEqual(root.children,[subsequent]);assert.equal(sourceDisposed,0)
   sources.forEach((t,i)=>assert.deepEqual(t._listeners.update,callbacks[i],'no source or unrelated sentinel callback removed'))
   assert.equal(owned.size,fail?6:7)
   for(const [texture,count]of owned){assert.equal(count,1,'owned atlas must dispose exactly once');assert.equal(texture._listeners?.update?.length||0,0,'owned texture must retain no material callbacks')}
   sourceMaterials.forEach((m,i)=>{assert.equal(m.map,sources[i*2]);assert.equal(m.normalMap,sources[i*2+1])})
   // Confirm user-added callbacks still function, rather than comparing counts only.
   for(const t of sources)t.dispatchEvent({type:'update'})
   assert.equal(sentinelCalls,sources.length)
  }finally{
   h.dispose();for(const m of sourceMaterials){m.map=null;m.normalMap=null;m.setDirty({needsUpdate:false,refreshUi:false});m.dispose()}
   sourceMeshes.forEach(m=>m.geometry.dispose());sources.forEach(t=>t.dispose())
  }
 }
})
