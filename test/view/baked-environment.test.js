import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {previewFixture} from '../../tools/v2/preview-fixture.mjs'
const {mountV2Architecture}=await import('../../lib/view/v2/architecture.js')
const {mountV2Ground}=await import('../../lib/view/v2/ground.js')
const {mountBakedArchitecture,mountBakedGround}=await import('../../lib/view/v2/baked-environment.js')
// Color factors become Float32 uniforms on the GPU. Platform libm may differ
// by one double ULP; triangle attribute hashes and all other assertions stay exact.
function snapshot(root){
 const groups=new Map()
 root.traverse(m=>{if(!m.isMesh)return;const group=m.userData.v2Ground?'ground':m.userData.v2PileCover?m.name:m.userData.architectureSurface==='photoscan'?m.name:m.name
  const attrs=Object.entries(m.geometry.attributes).map(([key,a])=>[key==='_v2fracturemask'?'v2FractureMask':key,a]).sort(([a],[b])=>a.localeCompare(b))
  const normalized=new Map(attrs.map(([,a])=>[a,a.array instanceof Float32Array
    ? Float32Array.from(a.array,value=>Math.round(value*1e5)/1e5)
    : a.array]))
  const hashRows=[],count=m.geometry.index?.count||m.geometry.attributes.position.count,width=attrs.reduce((n,[,a])=>n+a.itemSize*4,0)*3,row=Buffer.alloc(width)
  for(let i=0;i<count;i+=3){let offset=0;for(let j=0;j<3;j++){const vertex=m.geometry.index?m.geometry.index.getX(i+j):i+j;for(const [,a]of attrs){const array=normalized.get(a),bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);bytes.copy(row,offset,vertex*a.itemSize*4,(vertex+1)*a.itemSize*4);offset+=a.itemSize*4}}hashRows.push(row.toString('base64'))}
  hashRows.sort();const hash=createHash('sha256');for(const row of hashRows)hash.update(row)
  groups.set(group+(m.userData.v2Ground?m.material.name:''),{hash:hash.digest('hex'),count,material:{color:m.material.color.toArray().map(Math.fround),roughness:m.material.roughness,metalness:m.material.metalness,side:m.material.side,vertexColors:m.material.vertexColors},shadow:[m.castShadow,m.receiveShadow]})
 });return groups
}
test('baked runtime preserves every triangle attribute, material factor and shadow flag; repeated cleanup keeps sources',async()=>{
 const f=await previewFixture(),{E,map,viewer,source,textures}=f
 const reference=new E.Group(),refs={v2ArchitectureIO:{loadBinary:url=>readFile(new URL(url))}}
 const before=performance.now(),a=mountV2Architecture({root:reference,map,viewer,refs});await a.ready
 const g=mountV2Ground({root:reference,map,viewer,preview:true});await g.ready
 const originalMs=performance.now()-before,expected=snapshot(reference);let sourceDisposals=0
 source.traverse(o=>o.geometry?.addEventListener('dispose',()=>sourceDisposals++));for(const t of textures)t.addEventListener('dispose',()=>sourceDisposals++)
 const sourceMetadata=JSON.stringify(source.userData),counts=textures.map(t=>t._listeners?.update?.length||0)
 for(let cycle=0;cycle<2;cycle++){
  const root=new E.Group(),start=performance.now(),next=mountBakedArchitecture({root,map,viewer}),ground=mountBakedGround({root,map,viewer})
  assert(next?.stats.bakedReuse);assert(ground?.stats.bakedReuse)
  console.log(JSON.stringify({cycle,proceduralCpuMs:originalMs,bakedCpuMs:performance.now()-start}))
  assert.deepEqual(snapshot(root),expected)
  next.dispose();ground.dispose();next.dispose();ground.dispose();assert.equal(root.children.length,0);assert.equal(sourceDisposals,0)
  assert.deepEqual(textures.map(t=>t._listeners?.update?.length||0),counts)
 }
 assert.equal(JSON.stringify(source.userData),sourceMetadata)
 const changed=structuredClone(map);changed.colliders[0].center.x+=.1
 assert.equal(mountBakedArchitecture({root:new E.Group(),map:changed,viewer}),null)
 assert.equal(mountBakedGround({root:new E.Group(),map:changed,viewer}),null)
 const hidden=new E.Group();source.removeFromParent();hidden.add(source)
 const detached=mountBakedGround({root:new E.Group(),map,viewer,refs:{v2BakedPreviewSource:[source]}})
 assert(detached?.stats.bakedReuse);detached.dispose()
 viewer.scene.modelRoot.add(source)
 const architecture=source.children.find(o=>o.userData.v2BakedKind==='architecture'),missing=architecture.children.find(o=>o.isMesh)
 missing.removeFromParent();assert.equal(mountBakedArchitecture({root:new E.Group(),map,viewer}),null);architecture.add(missing)
 assert.equal(mountBakedArchitecture({root:new E.Group(),map,viewer,refs}),null)
 a.dispose();g.dispose()
})
