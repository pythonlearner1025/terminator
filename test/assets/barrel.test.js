import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const root=new URL('../../',import.meta.url)
const id='map-barrel-0p8x1p3x0p8-103qszk'
const manifest=JSON.parse(await readFile(new URL('assets.json',root),'utf8'))
const path=new URL(manifest.files[id].path,root)
const gltf=JSON.parse(await readFile(path,'utf8'))
const bytes=await readFile(new URL(gltf.buffers[0].uri,path))
function accessor(i){
 const a=gltf.accessors[i],v=gltf.bufferViews[a.bufferView]
 const size={SCALAR:1,VEC2:2,VEC3:3}[a.type],offset=(v.byteOffset||0)+(a.byteOffset||0)
 return Array.from({length:a.count*size},(_,j)=>a.componentType===5123?bytes.readUInt16LE(offset+j*2):bytes.readFloatLE(offset+j*4))
}
test('barrel stays inside its unchanged cylinder and fits the triangle budget',()=>{
 assert.equal(gltf.meshes.length,1);assert.equal(gltf.materials.length,1)
 const p=gltf.meshes[0].primitives[0],pos=accessor(p.attributes.POSITION)
 assert.ok(gltf.accessors[p.indices].count/3<=6000)
 let low=Infinity,high=-Infinity
 for(let i=0;i<pos.length;i+=3){
  assert.ok(Math.hypot(pos[i],pos[i+2])<=.39501)
  low=Math.min(low,pos[i+1]);high=Math.max(high,pos[i+1])
 }
 assert.ok(low>=-.62001&&high<=.64201)
 assert.ok(high-low>1.25)
})
test('barrel mouth is open while its low ember pocket stays present',()=>{
 const p=gltf.meshes[0].primitives[0],pos=accessor(p.attributes.POSITION),ix=accessor(p.indices)
 // Project triangle onto XZ. A vertical ray through the mouth must first hit near the floor.
 let hit=-Infinity
 for(let i=0;i<ix.length;i+=3){
  const a=pos.slice(ix[i]*3,ix[i]*3+3),b=pos.slice(ix[i+1]*3,ix[i+1]*3+3),c=pos.slice(ix[i+2]*3,ix[i+2]*3+3)
  const den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(den)<1e-10)continue
  const u=((b[2]-c[2])*(-c[0])+(c[0]-b[0])*(-c[2]))/den
  const v=((c[2]-a[2])*(-c[0])+(a[0]-c[0])*(-c[2]))/den,w=1-u-v
  if(Math.min(u,v,w)>=-1e-6)hit=Math.max(hit,u*a[1]+v*b[1]+w*c[1])
 }
 assert.ok(hit>-.62&&hit<-.42,`Mouth ray hit at ${hit}`)
})
test('barrel ships one complete 1024 PBR set with exact manifest routes',async()=>{
 const m=gltf.materials[0]
 for(const x of [m.pbrMetallicRoughness.baseColorTexture,m.pbrMetallicRoughness.metallicRoughnessTexture,m.normalTexture,m.occlusionTexture,m.emissiveTexture])assert.ok(x)
 assert.equal(m.occlusionTexture.index,m.pbrMetallicRoughness.metallicRoughnessTexture.index)
 assert.equal(gltf.images.length,4)
 for(const im of gltf.images){
  const route=manifest.files[id].files[im.uri];assert.ok(route,im.uri)
  const data=await readFile(new URL(route,root));assert.equal(data.readUInt32BE(16),1024);assert.equal(data.readUInt32BE(20),1024)
 }
})
