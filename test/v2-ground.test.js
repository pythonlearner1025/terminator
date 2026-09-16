import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import data from '../assets/v2/ground/fragments.json' with {type:'json'}
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const {Group,Mesh2,BoxGeometry,PhysicalMaterial,Texture,Raycaster,Vector3}=await import('threepipe')
const {defaultMap}=await import('../lib/core/map.js')
const {World}=await import('../lib/core/world.js')
const {rayCollider}=await import('../lib/core/collision.js')
const {mountV2Ground,fitGroundPatch}=await import('../lib/view/v2/ground.js')
const hash=root=>{const h=createHash('sha256');root.traverse(m=>{for(const a of Object.values(m.geometry?.attributes||{}))h.update(Buffer.from(a.array.buffer))});return h.digest('hex')}

test('pilot04 refinement: deterministic bounded geometry with original UVs and meaningful support coverage',async()=>{
 const root=new Group(),map=structuredClone(defaultMap),before=JSON.stringify(map)
 const foreign=new Mesh2(new BoxGeometry(),new PhysicalMaterial());root.add(foreign)
 const h=mountV2Ground({root,map}),again=mountV2Ground({root:new Group(),map,preview:true});await Promise.all([h.ready,again.ready])
 assert.equal(h.stats.patches,11900);assert.equal(h.stats.triangles,269880);assert.equal(h.stats.draws,5);assert.equal(hash(h.root),hash(again.root))
 assert.ok(h.stats.coverageM2>450&&h.stats.coverageM2<500);assert.ok(h.stats.maxHeight<=.075)
 for(const id of ['ground','exp_service_floor','exp_east_yard','exp_barracks_roof'])assert.ok(h.stats.bySupport[id]>400,id)
 for(const mesh of h.root.children){
  assert.equal(mesh.userData.v2Surface,'preserve');assert.equal(mesh.userData.selectable,true);assert.equal(mesh.castShadow,false)
  for(const attribute of Object.values(mesh.geometry.attributes))assert.ok(attribute.array.every(Number.isFinite))
  const uv=mesh.geometry.attributes.uv.array
  const allowed=new Set(data.finePatches.flatMap(p=>p.groups).filter(g=>g.atlas===h.root.children.indexOf(mesh)).flatMap(g=>g.uv.map(n=>Math.fround(n))))
  assert.ok(uv.every(n=>allowed.has(n)),'retained atlas UVs')
 }
 const initial=hash(h.root);h.sync({tick:900,mapState:{flankWallBroken:true}});assert.equal(hash(h.root),initial);assert.equal(JSON.stringify(map),before)
 let disposed=0;for(const m of h.root.children)m.geometry.addEventListener('dispose',()=>disposed++)
 h.dispose();h.dispose();again.dispose();assert.equal(disposed,5);assert.deepEqual(root.children,[foreign]);assert.equal(JSON.stringify(map),before)
 foreign.geometry.dispose();foreign.material.dispose()
})

test('all actual vertices and rotated footprint corners retain exact simulator floor support',()=>{
 const world=new World({seed:11}),h=mountV2Ground({root:new Group(),map:defaultMap})
 // The fine field is now eleven typed arrays plus a source table, not 11,900
 // objects of boxed numbers. Same values, one tenth of the bytes.
 const f=h.root.userData.aggregateFragments
 assert.equal(f.count,11900);assert.ok(f.x instanceof Float64Array)
 for(let i=0;i<f.count;i++){
  const cs=Math.cos(f.yaw[i]),sn=Math.sin(f.yaw[i]),source=f.source[f.sourceIndex[i]]
  for(const [u,v]of [[0,0],[-.5,-.5],[-.5,.5],[.5,-.5],[.5,.5]]){
   const pos={x:f.x[i]+u*f.width[i]*cs+v*f.depth[i]*sn,y:f.y[i],z:f.z[i]-u*f.width[i]*sn+v*f.depth[i]*cs}
   assert.ok(world.playerSupportAt(pos,f.y[i],{radius:0,maxAbove:.025,maxBelow:.025}),source)
  }
 }
 for(const mesh of h.root.children){const pos=mesh.geometry.attributes.position.array;for(let i=0;i<pos.length;i+=3){
  const p={x:pos[i],y:pos[i+1],z:pos[i+2]};const support=world.playerSupportAt(p,p.y,{radius:0,maxAbove:.001,maxBelow:.076})
  assert.ok(support,JSON.stringify(p));assert.ok(p.x>=defaultMap.bounds.minX&&p.x<=defaultMap.bounds.maxX&&p.z>=defaultMap.bounds.minZ&&p.z<=defaultMap.bounds.maxZ)
 }}
 h.dispose()
})

test('simulator-clear standing and near-ground circulation rays stay visually clear',()=>{
 const h=mountV2Ground({root:new Group(),map:defaultMap});h.root.updateMatrixWorld(true)
 const segments=[[[36,1.65,5.5],[36,1.65,22]],[[28,1.65,12],[34,1.65,12]],[[-35.9,-1.85,-12.5],[-35.9,-1.85,12]],[[36,5,18],[36,5,22]],[[-4,.055,-20],[-4,.055,-15]],[[-35.9,-3.445,-12.5],[-35.9,-3.445,12]]]
 for(const [a,b]of segments){const origin=new Vector3(...a),delta=new Vector3(...b).sub(origin),direction=delta.clone().normalize(),ray=new Raycaster(origin,direction,0,delta.length())
  assert.equal(defaultMap.colliders.filter(c=>c.blocksSight).some(c=>rayCollider(origin,direction,c,delta.length())),false,'baseline simulator-clear ray '+a)
  assert.equal(ray.intersectObject(h.root,true).length,0,'visual clearance '+a)
 }
 h.dispose()
})

test('native scan proportions stay bounded and original source data remains untouched',()=>{
 const before=JSON.stringify(data)
 for(const patch of data.finePatches)for(const width of [.12,.25,.5]){
  const span=patch.sourceSpan,fit=fitGroundPatch(span,{width,depth:width*.7,height:.025})
  assert.ok(Math.abs(fit.width/fit.depth-span[0]/span[2])<1e-9)
  assert.ok(Math.abs(fit.width/span[0]/(fit.height/span[1])-1)<1e-9)
  assert.ok(fit.width<=width+1e-10&&fit.depth<=width*.7+1e-10&&fit.height<=.025+1e-10)
 }
 assert.equal(JSON.stringify(data),before)
})

test('cloned atlas handles protect authored maps even from generic Generator disposal',async()=>{
 const modelRoot=new Group(),originals=[];let sourceDisposals=0
 for(let i=0;i<5;i++){
  const texture=new Texture();texture.addEventListener('dispose',()=>sourceDisposals++)
  const material=new PhysicalMaterial({name:`Selected rubble ${i+1}: TextureAtlas_100${i+1}`,map:texture}),mesh=new Mesh2(new BoxGeometry(),material)
  modelRoot.add(mesh);originals.push(mesh)
 }
 const h=mountV2Ground({root:new Group(),map:defaultMap,viewer:{scene:{modelRoot}},preview:true});await h.ready
 assert.equal(h.stats.sharedImages,5)
 for(let i=0;i<5;i++){
  const owned=h.root.children[i].material,source=originals[i].material
  assert.notEqual(owned,source);assert.notEqual(owned.map,source.map);assert.equal(owned.map.source,source.map.source)
  // Generator's unconditional traversal can only dispose our handle, not its source.
  owned.map.dispose();owned.dispose()
 }
 h.dispose();h.dispose();assert.equal(sourceDisposals,0)
 for(const mesh of originals){assert.ok(mesh.material.map);mesh.geometry.dispose();mesh.material.dispose();mesh.material.map.dispose()}
})

test('stop before asynchronous loads completes never reattaches and frees every late atlas',async()=>{
 const root=new Group(),resolvers=[];let freed=0
 const h=mountV2Ground({root,map:defaultMap,loadTexture:url=>new Promise(resolve=>{assert.match(url,/assets\/models\/selected\/5986/);resolvers.push(resolve)})})
 await Promise.resolve();assert.equal(resolvers.length,5);h.dispose()
 for(const resolve of resolvers){const texture=new Texture();texture.addEventListener('dispose',()=>freed++);resolve(texture)}
 await h.ready;assert.equal(freed,5);assert.equal(root.children.length,0);assert.equal(h.stats.ready,false)
})

test('texture failure cleans partially loaded owned resources and rejects ready',async()=>{
 const root=new Group();let i=0,freed=0
 const h=mountV2Ground({root,map:defaultMap,loadTexture:async()=>{
  if(i++===2)throw Error('fixture load failure');const texture=new Texture();texture.addEventListener('dispose',()=>freed++);return texture
 }})
 await assert.rejects(h.ready,/fixture load failure/);await Promise.resolve()
 assert.equal(root.children.length,0);assert.equal(freed,4);assert.equal(h.stats.disposed,true)
})


test('visible coarse chip boundaries close onto support without stretching source top UVs',()=>{
 const h=mountV2Ground({root:new Group(),map:defaultMap});assert.ok(h.stats.solidFragments>4800);assert.ok(h.stats.edgeTriangles>120000);assert.equal(h.stats.triangles,h.stats.topTriangles+h.stats.edgeTriangles)
 let sides=0,groundVertices=0
 for(const mesh of h.root.children){const p=mesh.geometry.attributes.position.array,n=mesh.geometry.attributes.normal.array,c=mesh.geometry.attributes.color.array
  for(let i=0;i<p.length;i+=3)if(c[i]<.9){sides++;assert.equal(n[i+1],0);assert.ok(Math.abs(Math.hypot(n[i],n[i+2])-1)<1e-6)
    const bases=[.001,.701,-3.499,6.401,4.301];if(bases.some(y=>Math.abs(p[i+1]-y)<1e-5))groundVertices++
  }
 }
 assert.equal(sides,h.stats.edgeTriangles*3);assert.ok(groundVertices>=sides/2);h.dispose()
})


test('R3-GROUND-1: authored atlas subscriptions stay exact across repeated mount and disposal',async()=>{
 const modelRoot=new Group(),sources=[],textures=[],originalListeners=[]
 for(let i=0;i<5;i++){
  const texture=new Texture(),material=new PhysicalMaterial({name:`Selected rubble ${i+1}: TextureAtlas_100${i+1}`,map:texture})
  const mesh=new Mesh2(new BoxGeometry(),material);modelRoot.add(mesh);sources.push(mesh);textures.push(texture)
  originalListeners.push([...(texture._listeners?.update||[])])
 }
 let ownedDisposals=0
 for(let cycle=0;cycle<3;cycle++){
  const h=mountV2Ground({root:new Group(),map:defaultMap,viewer:{scene:{modelRoot}}});await h.ready
  const ownedTextures=h.root.children.map(m=>m.material.map)
  for(let i=0;i<5;i++){
   assert.deepEqual(textures[i]._listeners.update,originalListeners[i],'source subscriptions preserved during mount')
   ownedTextures[i].addEventListener('dispose',()=>ownedDisposals++)
   assert.equal(ownedTextures[i]._listeners.update.length,1,'owned material tracks owned atlas')
  }
  h.dispose();h.dispose()
  for(let i=0;i<5;i++){
   assert.deepEqual(textures[i]._listeners.update,originalListeners[i],'source subscriptions preserved after stop')
   assert.equal(ownedTextures[i]._listeners.update.length,0,'owned texture callbacks released')
   assert.equal(sources[i].material.map,textures[i])
  }
 }
 assert.equal(ownedDisposals,15)
 for(const mesh of sources){const t=mesh.material.map;mesh.material.map=null;mesh.material.setDirty({needsUpdate:false,refreshUi:false});mesh.material.dispose();mesh.geometry.dispose();t.dispose()}
})


test('owned ground participates in scene fog while imported authored fog state is unchanged',async()=>{
 const modelRoot=new Group(),source=new PhysicalMaterial({name:'Selected rubble 1: fog fixture',map:new Texture()})
 assert.equal(source.fog,false,'installed Threepipe default')
 const mesh=new Mesh2(new BoxGeometry(),source);modelRoot.add(mesh)
 const h=mountV2Ground({root:new Group(),map:defaultMap,viewer:{scene:{modelRoot}}});await h.ready
 for(const m of h.root.children)assert.equal(m.material.fog,true,'all borrowed-copy and fallback ground materials use scene fog')
 assert.equal(source.fog,false);h.dispose();assert.equal(source.fog,false)
 const texture=source.map;source.map=null;source.setDirty({needsUpdate:false,refreshUi:false});source.dispose();mesh.geometry.dispose();texture.dispose()
})
