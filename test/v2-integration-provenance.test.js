import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E=await import('threepipe')
const {batchPlacedMap}=await import('../lib/view/map-batching.js')

function fixture(api=E){
 const source=new E.Group(),root=new E.Group(),material=new E.PhysicalMaterial({name:'Map concrete'}),geometries=[]
 const add=(id,role,geometry)=>{
  const placement=new E.Group();placement.userData.mapPiece={id,nodeId:`${role}:${id}`,assetId:`asset-${id}`,role}
  placement.position.set(3,2,1);placement.rotation.y=.3
  placement.add(new E.Mesh2(geometry,material));source.add(placement);geometries.push(geometry)
 }
 add('wall','collider',new E.BoxGeometry()) // indexed: 36 draw elements, 24 vertices
 add('floor','collider',new E.PlaneGeometry(3,3)) // same material, different owner
 add('pipe','fixture',new E.CylinderGeometry(.1,.1,2,4)) // dynamic, not batched
 const batching=batchPlacedMap(api,source,root)
 return {source,root,material,geometries,batching,dispose(){for(const b of batching.batches)b.geometry.dispose();for(const g of geometries)g.dispose();material.dispose()}}
}

test('integration: shared-material batches retain exact indexed source draw ownership and skip dynamic pieces',()=>{
 const f=fixture()
 try{
  assert.equal(f.batching.batches.length,1);assert.equal(f.batching.dynamic.length,1)
  const geometry=f.batching.batches[0].geometry,position=geometry.attributes.position
  const bytes=Buffer.from(position.array.buffer).toString('hex'),originalGeometryData=f.geometries.map(g=>structuredClone(g.userData))
  assert.deepEqual(geometry.userData.mapSourceRanges,{version:1,unit:'draw-elements',entries:[
   {start:0,count:36,pieceId:'wall',nodeId:'collider:wall',assetId:'asset-wall',role:'collider'},
   {start:36,count:6,pieceId:'floor',nodeId:'collider:floor',assetId:'asset-floor',role:'collider'},
  ]})
  assert.equal(geometry.attributes.position,position);assert.equal(Buffer.from(position.array.buffer).toString('hex'),bytes)
  assert.deepEqual(f.geometries.map(g=>g.userData),originalGeometryData)
  assert.equal(f.batching.batches[0].material,f.material)
 }finally{f.dispose()}
})

test('integration: incorrect merged draw count is rejected by the provenance producer',()=>{
 const api={...E,mergeGeometries(geometries,groups){
  const geometry=E.mergeGeometries(geometries,groups)
  geometry.setAttribute('position',new E.Float32BufferAttribute(new Float32Array(9),3))
  return geometry
 }}
 assert.throws(()=>fixture(api),/Incomplete source ranges/)
})
