import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {defaultMap} from '../lib/core/map.js'
import {World} from '../lib/core/world.js'
import {colliderPrimitives, colliderSurfacesAt, rayCollider} from '../lib/core/collision.js'
import {getV2ArchitectureCover, declaredV2ArchitectureCover} from '../lib/view/v2/architecture-cover.js'
import data from '../assets/v2/architecture/rubble-cover.json' with {type:'json'}
import views from '../docs/scene-targets/views.json' with {type:'json'}

globalThis.ImageData ??= class {}
globalThis.window ??= {}
const {Group,Texture,PhysicalMaterial}=await import('threepipe')
const {mountV2CoverGeometry}=await import('../lib/view/v2/architecture-cover-view.js')
const sourceUrl=new URL(`../assets/models/selected/${data.source}/scene.bin`,import.meta.url)
const source=await readFile(sourceUrl)
const specs=getV2ArchitectureCover(defaultMap)
const map={...defaultMap,colliders:[...defaultMap.colliders,...structuredClone(specs)]}

test('pure supported bounded cover specs, exact declaration gate and unchanged source map',()=>{
  const before=JSON.stringify(defaultMap)
  assert.equal(specs.length,7)
  assert.deepEqual(getV2ArchitectureCover(defaultMap),specs)
  assert.deepEqual(getV2ArchitectureCover(map),specs)
  assert.equal(JSON.stringify(defaultMap),before)
  assert.equal(declaredV2ArchitectureCover(defaultMap).length,0)
  assert.equal(declaredV2ArchitectureCover(map).length,7)
  const changed=structuredClone(map)
  changed.colliders.at(-1).shapes[0].size.y+=.01
  assert.equal(declaredV2ArchitectureCover(changed).length,6)
  changed.colliders.push(structuredClone(changed.colliders.at(-2)))
  assert.equal(declaredV2ArchitectureCover(changed).length,5)
  for (const c of specs) {
    assert.ok(c.size.y>=.5 && c.size.y<=1.2)
    assert.equal(c.shapes.length,85)
    assert.ok(c.shapes.every(s=>s.size.x<.26 && s.size.z<.26))
    for (const part of colliderPrimitives(c)) {
      assert.ok(Math.abs(part.center.y-part.size.y/2-c.v2Pile.y)<1e-8)
      assert.ok(defaultMap.colliders.some(f=>f.kind==='floor'&&!f.yaw&&!f.shapes&&Math.abs(f.center.y+f.size.y/2-c.v2Pile.y)<.025&&Math.abs(part.center.x-f.center.x)<f.size.x/2&&Math.abs(part.center.z-f.center.z)<f.size.z/2))
    }
  }
})

test('original five POVs, service spine, barracks corridor and stair/door routes retain support and nav',()=>{
  const before=new World({map:defaultMap,seed:2029}),after=new World({map,seed:2029})
  const points=views.views.map(v=>({x:v.feet[0],y:v.feet[1],z:v.feet[2]}))
  // At least 1.5m of player-centre width through the barracks, plus 0.38m radius.
  for (let z=4.5;z<=15;z+=.25) for (const x of [35.25,36,36.75]) points.push({x,y:0,z})
  for (let z=-14;z<=14;z+=.25) points.push({x:-35.9,y:-3.5,z})
  for (const p of points) {
    assert.equal(after.positionBlocked(p,.38,1.8),false,JSON.stringify(p))
    assert.equal(after.playerHasHeadClearance(p,1.8),true)
    assert.deepEqual(after.playerSupportAt(p,p.y,{radius:.38}),before.playerSupportAt(p,p.y,{radius:.38}))
  }
  const routes=[
    [{x:36,y:0,z:5.5},{x:36,y:0,z:15}],
    [{x:28,y:0,z:12},{x:36,y:0,z:12}],
    [{x:36,y:0,z:15},{x:32,y:6.4,z:6}],
    [{x:-36,y:0,z:-23},{x:-35.9,y:-3.5,z:12}],
    [{x:-35.9,y:-3.5,z:-12.5},{x:-36,y:0,z:23}],
  ]
  for (const [a,b] of routes) {
    assert.ok(before.nav.findPath(a,b),`baseline route ${JSON.stringify(a)}`)
    assert.ok(after.nav.findPath(a,b),`new route ${JSON.stringify(a)}`)
  }
  let added=0
  for (let i=0;i<before.nav.nodes.length;i++) if (!before.nav.blocked[i] && after.nav.blocked[i]) {
    const p=before.nav.nodePoint(before.nav.nodes[i]);added++
    assert.ok(specs.some(c=>colliderSurfacesAt(p,c,defaultMap.navGrid.agentRadius).length),JSON.stringify(p))
  }
  assert.ok(added>0,'new cover participates in navigation')
  // Declared piles stop low shots at occupied high columns, but never create a
  // full-height invisible wall above the measured pile.
  for (const c of specs) {
    const part=colliderPrimitives(c).sort((a,b)=>b.size.y-a.size.y)[0]
    const origin={x:part.center.x,y:part.center.y,z:part.center.z}
    assert.ok(rayCollider(origin,{x:1,y:0,z:0},c,4))
    assert.equal(rayCollider({...origin,y:c.v2Pile.y+c.size.y+.01},{x:1,y:0,z:0},c,4),null)
    assert.equal(after.positionBlocked({x:origin.x,y:c.v2Pile.y,z:origin.z},.05,1.8),true)
  }
})

test('full native front topology/UV/normals, every rendered vertex covered by its declared envelope, bounded buffers',async()=>{
  assert.equal(createHash('sha256').update(source).digest('hex'),data.sourceBinSha256)
  const root=new Group(),h=mountV2CoverGeometry({root,map,loadBinary:()=>source})
  await h.ready
  assert.equal(h.stats.piles,7);assert.equal(h.stats.triangles,60545*7)
  assert.equal(h.stats.meshes,10);assert.equal(h.stats.materials,5)
  assert.equal(h.stats.geometryBytes,60545*7*3*32)
  const read=a=>new ({5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.type])(source.buffer,source.byteOffset+a.offset,a.count*a.components)
  const dx=(data.max[0]-data.min[0])/data.divisions,dz=(data.max[2]-data.min[2])/data.divisions
  const profile=new Map(data.cells.map(cell=>[`${Math.round((cell.x+(data.max[0]-data.min[0])/2)/dx-.5)},${Math.round((cell.z+(data.max[2]-data.min[2])/2)/dz-.5)}`,cell]))
  let vertices=0
  for (const mesh of h.root.children) {
    assert.equal(mesh.castShadow,false);assert.equal(mesh.material.fog,true)
    const group=data.groups[mesh.userData.atlas],p=read(group.position),n=read(group.normal),uv=read(group.uv),ix=read(group.index)
    const a=mesh.geometry.attributes, count=mesh.userData.verticesPerPile
    for (const [pileIndex,id] of mesh.userData.sourceColliderIds.entries()) {
      const spec=specs.find(c=>c.id===id),s=spec.v2Pile,cs=Math.cos(s.yaw),sn=Math.sin(s.yaw)
      for (let i=0;i<count;i++) {
        const j=ix[i],out=pileIndex*count+i
        const x=(p[j*3]-(data.min[0]+data.max[0])/2)*s.scale,z=(p[j*3+2]-(data.min[2]+data.max[2])/2)*s.scale
        const world=[s.x+x*cs+z*sn,s.y+(p[j*3+1]-data.min[1])*s.scale,s.z-x*sn+z*cs]
        for (let k=0;k<3;k++) assert.ok(Math.abs(a.position.array[out*3+k]-world[k])<2e-6)
        assert.equal(a.uv.array[out*2],uv[j*2]);assert.equal(a.uv.array[out*2+1],uv[j*2+1])
        const normal=[n[j*3]*cs+n[j*3+2]*sn,n[j*3+1],-n[j*3]*sn+n[j*3+2]*cs]
        for (let k=0;k<3;k++) assert.ok(Math.abs(a.normal.array[out*3+k]-normal[k])<1e-6)
        const gx=Math.min(data.divisions-1,Math.max(0,Math.floor((p[j*3]-data.min[0])/dx))),gz=Math.min(data.divisions-1,Math.max(0,Math.floor((p[j*3+2]-data.min[2])/dz)))
        const cell=profile.get(`${gx},${gz}`)
        assert.ok(cell && p[j*3+1]-data.min[1]<=cell.height+1e-7)
        vertices++
      }
    }
  }
  assert.equal(vertices,60545*7*3)
  let disposed=0;h.root.children.forEach(m=>m.geometry.addEventListener('dispose',()=>disposed++))
  h.dispose();h.dispose();assert.equal(disposed,10);assert.equal(root.children.length,0)
})

test('borrowed atlas ownership and pending load disposal/failure are exact and repeatable',async()=>{
  const modelRoot=new Group(),borrowed=[],counters=[]
  for (let i=0;i<5;i++) {
    const node=new Group(),material=new PhysicalMaterial(),texture=new Texture(),counter={material:0,texture:0}
    material.name=`Selected rubble ${i+1}: original`;material.map=texture;material.fog=false;material.userData.foreign={id:i}
    material.addEventListener('dispose',()=>counter.material++);texture.addEventListener('dispose',()=>counter.texture++)
    node.material=material;modelRoot.add(node);borrowed.push(material);counters.push(counter)
  }
  const root=new Group(),viewer={scene:{modelRoot}},before=borrowed.map(m=>({map:m.map,userData:m.userData,callback:m.onBeforeCompile}))
  const h=mountV2CoverGeometry({viewer,root,map,loadBinary:()=>source});await h.ready;h.dispose()
  borrowed.forEach((m,i)=>{assert.equal(m.map,before[i].map);assert.equal(m.userData,before[i].userData);assert.equal(m.onBeforeCompile,before[i].callback);assert.equal(m.fog,false);assert.deepEqual(counters[i],{material:0,texture:0})})
  let resolveBinary,resolveTextures=[],lateDisposals=0
  const early=mountV2CoverGeometry({root,map,loadBinary:()=>new Promise(r=>resolveBinary=r),loadTexture:()=>new Promise(r=>resolveTextures.push(r))})
  await Promise.resolve();early.dispose();resolveBinary(source)
  for (const resolve of resolveTextures) {const t=new Texture();t.addEventListener('dispose',()=>lateDisposals++);resolve(t)}
  await early.ready;assert.equal(lateDisposals,5);assert.equal(root.children.length,0);assert.equal(early.stats.meshes,0)
  const failure=mountV2CoverGeometry({viewer,root,map,loadBinary:()=>new Uint8Array(4)})
  await assert.rejects(failure.ready,/byte length/);assert.equal(root.children.length,0)
  let rejectLate
  const cancelled=mountV2CoverGeometry({viewer,root,map,loadBinary:()=>new Promise((_,reject)=>rejectLate=reject)})
  await Promise.resolve();cancelled.dispose();rejectLate(new Error('network error after stop'))
  await cancelled.ready;assert.equal(root.children.length,0)
  for (const m of borrowed) {const t=m.map;m.map=null;m.dispose();t.dispose()}
})

test('public mount joins cover readiness without regenerating decorative fans or changing the map',async()=>{
  const {mountV2Architecture}=await import('../lib/view/v2/architecture.js')
  const root=new Group(),before=JSON.stringify(map)
  const h=mountV2Architecture({root,map,refs:{v2ArchitectureIO:{loadBinary:()=>source}}})
  await h.ready
  assert.equal(h.stats.coverPiles,7);assert.equal(h.stats.coverTriangles,423815)
  assert.equal(h.stats.triangles,986731);assert.equal(h.stats.meshes,91);assert.equal(h.stats.materials,15)
  assert.equal(h.stats.volumeWalls,6);assert.equal(h.stats.scannedPatches,190)
  assert.ok(h.root.userData.collapseFragments.every(p=>!p.source.includes('v2_arch_cover_')))
  assert.equal(JSON.stringify(map),before)
  h.sync({});h.dispose();h.dispose();assert.equal(root.children.length,0)
})
