import {decodedPreviewViews} from '../tools/v2/decode-preview-buffers.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const read=async p=>JSON.parse(await readFile(p,'utf8'))
test('0.19 preview migration retains attributes, provenance, scene ids and selected texture paths',async()=>{
 const dir='assets/v2/performance/preview-019',g=await read(`${dir}/preview.gltf`),r=await read(`${dir}/migration.json`),s=await read('assets/main.scene.gltf')
 const node=s.nodes.find(n=>n.extras?.gltfUUID===r.originalNode.extras.gltfUUID)
 assert.equal(node.name,r.originalNode.name)
 assert.deepEqual(node.extras.kite3dBakedFrom,{componentId:'terminator-v2-preview-generator',...r.originalNode.extras.EntityComponentPlugin['terminator-v2-preview-generator']})
 assert.equal(node.extras.kite3dAuthoring.id,r.originalNode.extras.kite3dAuthoring.id)
 assert(!s.nodes.some(n=>Object.values(n.extras?.EntityComponentPlugin||{}).some(c=>c.type==='Generator')))
 const buffers=await Promise.all(g.buffers.filter(b=>b.uri).map(b=>readFile(`${dir}/${b.uri}`))),hash=createHash('sha256')
 assert(buffers.every(b=>b.length<50*1024*1024))
 const views=await decodedPreviewViews(g,dir)
 const accessor=id=>{const a=g.accessors[id],v=g.bufferViews[a.bufferView];return {a,bytes:views[a.bufferView].subarray(a.byteOffset||0,(a.byteOffset||0)+v.byteLength)}}
 for(const m of g.meshes){const p=m.primitives[0],index=p.indices===undefined?null:accessor(p.indices);const indices=index?new Uint32Array(index.bytes.buffer,index.bytes.byteOffset,index.a.count):null
  for(const id of Object.values(p.attributes)){const {a,bytes}=accessor(id),width=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4})[a.type]*4
   if(!indices)hash.update(bytes);else{const expanded=Buffer.alloc(indices.length*width);for(let i=0;i<indices.length;i++)bytes.copy(expanded,i*width,indices[i]*width,(indices[i]+1)*width);hash.update(expanded)}
  }
 }
 assert.equal(hash.digest('hex'),r.attributesSha256)
 assert.equal(g.meshes.length,r.meshes)
 assert.equal(g.meshes.reduce((sum,m)=>{const p=m.primitives[0];return sum+g.accessors[p.indices??p.attributes.POSITION].count/3},0),r.triangles)
 assert(g.nodes.some(n=>n.extras?.sourceColliderIds?.includes('exp_barracks_partition_34_0_5.5')))
 const assets=await read('assets.json');for(const i of g.images){assert(!i.uri.startsWith('data:'));assert((await stat(assets.files['v2-stopped-preview-019'].files[i.uri])).size>0)}
})
