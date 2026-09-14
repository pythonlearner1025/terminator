/** Independent acceptance contracts. CPU only; known failures must remain visible until fixed. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E=await import('threepipe')
const {defaultMap}=await import('../lib/core/map.js')
const {World}=await import('../lib/core/world.js')
const {mountV2Architecture}=await import('../lib/view/v2/architecture.js')
const {mountV2Materials}=await import('../lib/view/v2/materials.js')
const {mountV2Lighting}=await import('../lib/view/v2/lighting.js')
const {mountV2Effects}=await import('../lib/view/v2/effects.js')
const {patchV2SurfaceShader}=await import('../lib/view/v2/materials-shader.js')

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const baselineManifest=JSON.parse(await readFile(new URL('./fixtures/v2-review/baseline.json',import.meta.url),'utf8'))
const sha256=value=>createHash('sha256').update(value).digest('hex')
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const semanticHash=value=>value===undefined?null:sha256(JSON.stringify(canonical(value)))

test('review: added physical surface layer receives vertex color only once',()=>{
 const {ShaderLib}=E
 const shader={...ShaderLib.physical,uniforms:{}}
 patchV2SurfaceShader(shader,{})
 const colorIndex=shader.fragmentShader.indexOf('#include <color_fragment>')
 assert.ok(colorIndex>shader.fragmentShader.indexOf('#include <map_fragment>'),'Installed PBR path applies vertex color after map')
 // Built-in color_fragment multiplies the complete mixed diffuse color. A prior
 // multiplication on the replacement layer squares color on only that layer.
 assert.equal(/v2Layer\s*\*=\s*vColor/.test(shader.fragmentShader.slice(0,colorIndex)),false,
  'Replacement layer is pre-multiplied then multiplied again by retained color_fragment')
})

test('review: authored camera, existing nodes/materials and immutable targets retain baseline semantics',async()=>{
 const after=JSON.parse(await readFile(new URL('../assets/main.scene.gltf',import.meta.url),'utf8'))
 const before=baselineManifest.authored
 assert.equal(semanticHash(after.nodes.slice(0,before.nodeCount)),before.semanticHashes.nodes,'Existing authored node transforms/components must not change')
 for(const [key,hash] of Object.entries(before.semanticHashes))if(key!=='nodes')assert.equal(semanticHash(after[key]),hash,key)
 // Core performance and V2 cover integration are authorized changes. Keep the
 // original authored/camera/target baseline, and test collision behavior below
 // instead of treating every core source edit as an appearance regression.
 for(const [file,hash] of Object.entries(baselineManifest.immutableFiles))assert.equal(sha256(await readFile(new URL('../'+file,import.meta.url))),hash,`Player camera or immutable target/config changed: ${file}`)
})

test('review: optimized collision queries match the supplied performance baseline on authored geometry',async()=>{
 const fixture=new URL('./fixtures/v2-review/'+baselineManifest.collision.fixture,import.meta.url)
 assert.equal(sha256(await readFile(fixture)),baselineManifest.collision.sha256,'Immutable reference collision fixture changed')
 const baseline=await import(fixture)
 const current=await import('../lib/core/collision.js')
 const hit=value=>value&&{fraction:value.fraction,distance:value.distance,normal:value.normal}
 let seed=2029
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
 for(let i=0;i<40;i++){
  const origin={x:random()*84-42,y:random()*14-4,z:random()*60-30},direction={x:random()*2-1,y:random()*2-1,z:random()*2-1},radius=i%4===0?0:random()
  for(const collider of defaultMap.colliders){
   assert.equal(current.pointInsideColliderFootprint(origin,collider,radius),baseline.pointInsideColliderFootprint(origin,collider,radius))
   assert.equal(current.sphereIntersectsCollider(origin,radius,collider),baseline.sphereIntersectsCollider(origin,radius,collider))
   assert.deepEqual(hit(current.rayCollider(origin,direction,collider,70)),hit(baseline.rayCollider(origin,direction,collider,70)))
   assert.deepEqual(hit(current.sweepSphereCollider(origin,direction,radius,collider)),hit(baseline.sweepSphereCollider(origin,direction,radius,collider)))
  }
 }
})

test('review: stop during pending material and particle loads preserves sources, scene state and new runtime',async()=>{
 const originalLoad=E.TextureLoader.prototype.load,originalDocument=globalThis.document
 const loads=[],finishAtlases=[]
 E.TextureLoader.prototype.load=function(_url,onLoad){const texture=new E.Texture();finishAtlases.push(()=>onLoad(texture));return texture}
 globalThis.document={}
 const scene=new E.Scene(),root=new E.Group();scene.add(root)
 const fog=new E.FogExp2(0x112233,.004),background=new E.Color(0x03070d)
 scene.fog=fog;scene.background=background;scene.environmentIntensity=.32;scene.autoDisposeSceneMaps=true
 const viewer={scene,setDirty(){},getPlugin(){return null}}
 const texture=new E.Texture(),source=new E.PhysicalMaterial({name:'Map concrete',map:texture})
 const mesh=new E.Mesh2(new E.BoxGeometry(),source);root.add(mesh)
 const listeners=texture._listeners?.update?.length||0,handles=[]
 let released=0
 try{
  handles.push(mountV2Architecture({viewer,root,map:defaultMap}))
  handles.push(mountV2Materials({viewer,root,loadTexture:()=>{const load=deferred();loads.push(load);return load.promise}}))
  handles.push(mountV2Lighting({viewer,root,map:defaultMap}))
  handles.push(mountV2Effects({viewer,root,map:defaultMap}))
  const ready=Promise.all(handles.map(h=>h.ready))
  const frozen=Object.freeze({tick:120,mapState:Object.freeze({fog:0,lights:Object.freeze({})})})
  for(const handle of handles)handle.sync(frozen)
  for(const handle of [...handles].reverse())handle.dispose()
  assert.deepEqual(root.children,[mesh]);assert.equal(mesh.material,source)
  assert.equal(scene.fog,fog);assert.equal(scene.background,background);assert.equal(scene.environmentIntensity,.32)
  assert.equal(texture._listeners?.update?.length||0,listeners)
  // A subsequent runtime must not be removed or overwritten by stale callbacks.
  const nextRoot=new E.Group();nextRoot.name='Subsequent runtime';scene.add(nextRoot)
  for(const load of loads){const t=new E.Texture();t.addEventListener('dispose',()=>released++);load.resolve(t)}
  for(const finish of finishAtlases)finish();await ready
  assert.equal(released,loads.length);assert.equal(nextRoot.parent,scene)
  assert.deepEqual(root.children,[mesh]);assert.equal(mesh.material,source)
  assert.equal(scene.fog,fog);assert.equal(scene.background,background)
  for(const handle of handles){handle.sync(frozen);handle.dispose()}
  assert.equal(nextRoot.parent,scene);assert.deepEqual(root.children,[mesh])
 }finally{
  for(const handle of [...handles].reverse())handle.dispose()
  E.TextureLoader.prototype.load=originalLoad
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument
  mesh.geometry.dispose();source.map=null;source.setDirty();source.dispose();texture.dispose()
 }
})

for(const [label,to] of [['column crest',{x:-2,y:1.65,z:14}],['east wall crest',{x:28,y:1.65,z:-28}]]){
 test(`review: rooftop simulator-clear player sightline has no opaque added ${label}`,()=>{
  const world=new World({seed:2029}),from={x:31.6,y:8.05,z:6}
  const feet={x:to.x,y:0,z:to.z},support=world.playerSupportAt(feet,0,{radius:.38,maxAbove:.05,maxBelow:.05})
  assert.ok(support);assert.equal(world.positionBlocked(feet,.38,1.8),false);assert.equal(world.playerHasHeadClearance(feet,1.8,support),true)
  assert.equal(world.lineOfSight(from,to),true,'Fixture must be a valid simulated sightline')
  const handle=mountV2Architecture({root:new E.Group(),map:defaultMap,preview:true})
  try{
   handle.root.updateMatrixWorld(true)
   const a=new E.Vector3(from.x,from.y,from.z),delta=new E.Vector3(to.x,to.y,to.z).sub(a)
   const hits=new E.Raycaster(a,delta.clone().normalize(),.001,delta.length()-.001).intersectObject(handle.root,true)
    .filter(hit=>!['rebar','steel'].includes(hit.object.userData.architectureSurface))
   assert.equal(hits.length,0,`Added opaque geometry disagrees with world LOS: ${hits.map(h=>`${h.object.userData.sourceColliderIds} at ${h.point.toArray()}`).join('; ')}`)
  }finally{handle.dispose()}
 })
}
