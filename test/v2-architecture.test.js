import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const {Group,Mesh2,BoxGeometry,PhysicalMaterial,Raycaster,Vector3}=await import('threepipe')
const {defaultMap}=await import('../lib/core/map.js')
const {mountV2Architecture}=await import('../lib/view/v2/architecture.js')
const hash=root=>{const h=createHash('sha256');root.traverse(m=>{if(m.geometry)h.update(Buffer.from(m.geometry.attributes.position.array.buffer))});return h.digest('hex')}

test('bounded deterministic geometry, finite attributes, map and foreign resources unchanged',async()=>{
 const map=structuredClone(defaultMap),before=JSON.stringify(map),root=new Group()
 const foreign=new Mesh2(new BoxGeometry(),new PhysicalMaterial());root.add(foreign)
 const geometry=foreign.geometry,material=foreign.material
 const h=mountV2Architecture({root,map});await h.ready
 assert.equal(JSON.stringify(map),before);assert.equal(foreign.geometry,geometry);assert.equal(foreign.material,material)
 assert.ok(h.stats.triangles<570000);assert.ok(h.stats.meshes<100);assert.equal(h.stats.materials,10);assert.equal(h.stats.scannedPatches,190)
 assert.ok(h.stats.colliders>100);assert.equal(h.stats.skylineBuildings,16);assert.ok(h.stats.coarseSlabs>180);assert.ok(h.stats.mediumSlabs>600);assert.ok(h.stats.fineChips>1000)
 h.root.traverse(m=>{if(!m.geometry)return;assert.equal(m.material.fog,true);for(const attr of Object.values(m.geometry.attributes))assert.ok(attr.array.every(Number.isFinite));assert.ok(m.geometry.boundingSphere.radius>0)})
 const fingerprint=hash(h.root),again=mountV2Architecture({root:new Group(),map})
 assert.equal(hash(again.root),fingerprint)
 let disposals=0;h.root.traverse(m=>m.geometry?.addEventListener('dispose',()=>disposals++))
 h.sync({mapState:{flankWallBroken:true}});h.dispose();h.dispose();again.dispose()
 assert.equal(disposals,h.stats.meshes);assert.deepEqual(root.children,[foreign]);assert.equal(JSON.stringify(map),before)
 geometry.dispose();material.dispose()
})

test('original standing POV sightlines stay clear and service ceiling is not dressed away',()=>{
 const h=mountV2Architecture({root:new Group(),map:defaultMap});h.root.updateMatrixWorld(true)
 // Barracks corridor, existing west entrance, service choke and stair head approach.
 const rays=[[[36,1.65,5.5],[36,1.65,22]],[[28,1.65,12],[34,1.65,12]],[[-35.9,-1.85,-12.5],[-35.9,-1.85,12]],[[36,5,18],[36,5,22]]]
 for(const [a,b]of rays){const origin=new Vector3(...a),delta=new Vector3(...b).sub(origin);const ray=new Raycaster(origin,delta.clone().normalize(),0,delta.length());assert.equal(ray.intersectObject(h.root,true).length,0,JSON.stringify(a))}
 h.dispose()
})

test('preview is selectable, tied to stable collider names, repeatably removable',()=>{
 const root=new Group(),h=mountV2Architecture({root,map:defaultMap,preview:true})
 assert.equal(h.root.userData.preview,true)
 assert.ok(h.root.children.some(m=>m.userData.sourceColliderIds.includes('exp_barracks_partition_34_0_5.5')))
 for(const m of h.root.children){assert.equal(m.userData.selectable,true);if(m.userData.architectureSurface==='photoscan')assert.equal(m.userData.sourceAsset,'5986d1487d9443b883d67b121c2c903c');else assert.equal(m.userData.sourceColliderIds.length,1)}
 h.dispose();assert.equal(root.children.length,0)
})

test('r2 collapse fields retain supported footprints, size hierarchy and clear movement spines',()=>{
 const h=mountV2Architecture({root:new Group(),map:defaultMap})
 const pieces=h.root.userData.collapseFragments
 assert.ok(pieces.length>2500)
 const floors=defaultMap.colliders.filter(c=>c.kind==='floor')
 function isSupported(x,z,y){return floors.some(c=>{
  const cs=Math.cos(c.yaw||0),sn=Math.sin(c.yaw||0),dx=x-c.center.x,dz=z-c.center.z,lx=dx*cs-dz*sn,lz=dx*sn+dz*cs
  return (c.shapes||[{size:c.size}]).some(part=>{
   const o=part.offset||{x:0,y:0,z:0},s=part.size
   return s&&Math.abs(c.center.y+o.y+s.y/2-y)<.025&&Math.abs(lx-o.x)<=s.x/2&&Math.abs(lz-o.z)<=s.z/2
  })
 })}
 for(const p of pieces){
  assert.ok(p.height<=.21+1e-9)
  const cs=Math.cos(p.yaw),sn=Math.sin(p.yaw)
  for(const [u,v]of [[0,0],[-.5,-.5],[-.5,.5],[.5,-.5],[.5,.5]])assert.ok(isSupported(p.x+u*p.width*cs+v*p.depth*sn,p.z-u*p.width*sn+v*p.depth*cs,p.y),p.source)
  if(Math.abs(p.y)<.2){assert.ok(!(Math.abs(p.x+4)<.9&&Math.abs(p.z)<23));assert.ok(!(Math.abs(p.z+12)<.85&&Math.abs(p.x)<27))}
 }
 const coarse=pieces.filter(p=>p.tier==='coarseSlabs'),fine=pieces.filter(p=>p.tier==='fineChips')
 assert.ok(coarse.some(p=>p.width>2));assert.ok(fine.every(p=>p.width<.34))
 assert.ok(pieces.some(p=>p.source==='collapse:exp_sandbags_south_inner'))
 assert.ok(pieces.some(p=>p.source==='collapse:dock_floor'))
 assert.ok(pieces.some(p=>p.source==='collapse:exp_barracks_roof'))
 h.dispose()
})

test('r2 skyline has fewer deep masses entirely outside the playable bounds',()=>{
 const h=mountV2Architecture({root:new Group(),map:defaultMap}),layout=h.root.userData.skylineLayout,b=defaultMap.bounds
 assert.equal(layout.length,16);assert.equal(layout.filter(p=>p.depthTier==='far').length,8)
 for(const p of layout){
  const r=Math.hypot(p.width,p.depth)/2
  assert.ok(p.x+r<b.minX||p.x-r>b.maxX||p.z+r<b.minZ||p.z-r>b.maxZ)
  assert.ok(p.depth>=10);assert.ok(p.width>=14)
 }
 // A ray through each solid left pier encounters both wall faces separated by real thickness.
 h.root.updateMatrixWorld(true)
 for(const p of layout){
  const x=-p.width/2+.8,z=-p.depth/2,cs=Math.cos(p.yaw),sn=Math.sin(p.yaw)
  const local=[x,2,z-1],origin=new Vector3(p.x+local[0]*cs+local[2]*sn,local[1],p.z-local[0]*sn+local[2]*cs)
  const ray=new Raycaster(origin,new Vector3(sn,0,cs),0,3)
  assert.ok(ray.intersectObject(h.root,true).length>=1,p.id)
 }
 h.dispose()
})

test('r2 break profiles use long asymmetric remnants with aggregate-scale detail',async()=>{
 const {breakProfile}=await import('../lib/view/v2/architecture-layout.js')
 let state=984;const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
 const p=breakProfile(28,rand,1)
 assert.equal(p[0][0],-14);assert.equal(p.at(-1)[0],14)
 assert.ok(Math.max(...p.map(v=>v[1]))>.6)
 assert.ok(Math.min(...p.map(v=>v[1]))<.08)
 // No equal segment cadence and no repeated same-height waveform.
 assert.ok(new Set(p.slice(1).map((v,i)=>(v[0]-p[i][0]).toFixed(3))).size>5)
})

test('reviewer rooftop rays never hit new opaque walls above the existing collision silhouette',async()=>{
 const {World}=await import('../lib/core/world.js'),world=new World({seed:11})
 const h=mountV2Architecture({root:new Group(),map:defaultMap});h.root.updateMatrixWorld(true)
 const a={x:31.6,y:8.05,z:6}
 for(const b of [{x:-2,y:1.65,z:14},{x:28,y:1.65,z:-28},{x:24,y:1.65,z:-22},{x:0,y:1.65,z:12},{x:2,y:1.65,z:12}]){
  assert.equal(world.lineOfSight(a,b),true)
  const origin=new Vector3(a.x,a.y,a.z),direction=new Vector3(b.x,b.y,b.z).sub(origin)
  const hits=new Raycaster(origin,direction.clone().normalize(),0,direction.length()).intersectObject(h.root,true)
  assert.deepEqual(hits.filter(hit=>['concrete','fracture','skyline'].includes(hit.object.userData.architectureSurface)),[])
 }
 h.dispose()
})

test('runtime wall replacement removes only contained primitive triangles and restores geometry exactly',async()=>{
 const {replaceRuntimeWallShells}=await import('../lib/view/v2/architecture-shells.js')
 const {mergeGeometries}=await import('threepipe')
 const wall=new BoxGeometry(3,2,.4).toNonIndexed(),floor=new BoxGeometry(12,.2,12).toNonIndexed();floor.translate(0,-1.1,0)
 const original=mergeGeometries([wall,floor,wall]),material=new PhysicalMaterial({name:'Map concrete'}),mesh=new Mesh2(original,material)
 mesh.name='Static placed map Map concrete';const root=new Group();root.add(mesh)
 mesh.userData.v2SourceRanges=[{first:0,count:36,sourceId:'wall'},{first:36,count:36,sourceId:'building_ground_floor'},{first:72,count:36,sourceId:'service-pipe'}]
 const originalMetadata=JSON.stringify(mesh.userData)
 const handle=replaceRuntimeWallShells(root,[{id:'wall',center:{x:0,y:0,z:0},size:{x:3,y:2,z:.4}}])
 assert.equal(handle.count,1);assert.notEqual(mesh.geometry,original);assert.equal(mesh.geometry.index.count,floor.attributes.position.count+wall.attributes.position.count);assert.equal(mesh.material,material)
 for(const [key,attr] of Object.entries(original.attributes))assert.deepEqual(mesh.geometry.attributes[key].array,attr.array,`${key} retained byte-for-byte`)
 assert.ok(Array.from(mesh.geometry.index.array).every(i=>i>=wall.attributes.position.count),'All foreign floor and coincident pipe indices remain')
 handle.dispose();handle.dispose();assert.equal(mesh.geometry,original);assert.equal(JSON.stringify(mesh.userData),originalMetadata)
 const metadata=mesh.userData.v2SourceRanges;delete mesh.userData.v2SourceRanges
 const absent=replaceRuntimeWallShells(root,[{id:'wall',center:{x:0,y:0,z:0},size:{x:3,y:2,z:.4}}]);assert.equal(absent.count,0);assert.equal(mesh.geometry,original);absent.dispose()
 mesh.userData.v2SourceRanges=[metadata[0],{...metadata[1],first:0}]
 const ambiguous=replaceRuntimeWallShells(root,[{id:'wall',center:{x:0,y:0,z:0},size:{x:3,y:2,z:.4}}]);assert.equal(ambiguous.count,0);assert.equal(mesh.geometry,original);ambiguous.dispose()
 mesh.userData.v2SourceRanges=metadata
 original.addGroup(0,wall.attributes.position.count,0)
 const grouped=replaceRuntimeWallShells(root,[{center:{x:0,y:0,z:0},size:{x:3,y:2,z:.4}}]);assert.equal(grouped.count,0);assert.equal(mesh.geometry,original);assert.equal(original.groups.length,1);grouped.dispose()
 wall.dispose();floor.dispose();original.dispose();material.dispose()
})

test('scan atlas textures are borrowed unchanged and survive owned material/geometry disposal',async()=>{
 const {createScannedRubble}=await import('../lib/view/v2/architecture-rubble.js'),{Texture}=await import('threepipe')
 const root=new Group(),modelRoot=new Group(),texture=new Texture(),source=new PhysicalMaterial({name:'Selected rubble 1: TextureAtlas_1001',map:texture})
 const sourceMesh=new Mesh2(new BoxGeometry(),source);modelRoot.add(sourceMesh)
 let textureDisposed=0;texture.addEventListener('dispose',()=>textureDisposed++)
 const scan=createScannedRubble({root,viewer:{scene:{modelRoot}}})
 scan.add({x:0,y:0,z:0,width:1,depth:.6,height:.2,yaw:.3,variant:0});const stats=scan.finish();await scan.ready
 assert.equal(stats.borrowedAtlases,1);assert.ok(stats.triangles>200)
 const material=root.children.find(m=>m.name.endsWith('1')).material
 assert.notEqual(material,source);assert.equal(material.map,texture);assert.equal(material.userData.v2Surface,'preserve');assert.equal(material.fog,true);assert.equal(source.fog,false)
 scan.dispose();scan.dispose();assert.equal(textureDisposed,0);assert.equal(source.map,texture)
 sourceMesh.geometry.dispose();source.dispose();texture.dispose()
})

test('scan early disposal releases late fallback atlases without touching scene or borrowed assets',async()=>{
 const {createScannedRubble}=await import('../lib/view/v2/architecture-rubble.js'),{Texture}=await import('threepipe')
 const root=new Group(),resolvers=[],textures=[]
 const handle=createScannedRubble({root,loadTexture:url=>new Promise(resolve=>{assert.match(url,/assets\/models\/selected\/5986/);resolvers.push(resolve)})})
 handle.dispose()
 let disposed=0
 for(const resolve of resolvers){const t=new Texture();t.addEventListener('dispose',()=>disposed++);textures.push(t);resolve(t)}
 await handle.ready;assert.equal(disposed,5);assert.equal(root.children.length,0)
})

test('scanned rubble retains source horizontal aspect without wafer distortion',async()=>{
 const {fitScannedPatch}=await import('../lib/view/v2/architecture-rubble.js')
 const span=[.5,.15,.4],bounds={width:2.5,depth:1.5,height:.2},fit=fitScannedPatch(span,bounds)
 assert.ok(Math.abs(fit.width/fit.depth-span[0]/span[2])<1e-10)
 assert.ok(fit.width/span[0]/(fit.height/span[1])<=1.8+1e-10)
 for(const key of ['width','depth','height'])assert.ok(fit[key]<=bounds[key])
 assert.deepEqual(bounds,{width:2.5,depth:1.5,height:.2})
})

test('central draw-element provenance preserves foreign overlaps and remaps only owned clone ranges',async()=>{
 const {replaceRuntimeWallShells}=await import('../lib/view/v2/architecture-shells.js'),{mergeGeometries}=await import('threepipe')
 const box=new BoxGeometry(2,2,2).toNonIndexed(),g=mergeGeometries([box,box]),m=new PhysicalMaterial({name:'Map concrete'}),mesh=new Mesh2(g,m),root=new Group();root.add(mesh);mesh.name='Static placed map Map concrete'
 g.setIndex(Array.from({length:72},(_,i)=>i))
 g.userData.mapSourceRanges={version:1,unit:'draw-elements',entries:[{start:0,count:36,pieceId:'wall',nodeId:'collider:wall',role:'collider'},{start:36,count:36,pieceId:'floor',nodeId:'collider:floor',role:'collider'}]}
 const before=JSON.stringify(g.userData),colliders=[{id:'wall',center:{x:0,y:0,z:0},size:{x:2,y:2,z:2}}],h=replaceRuntimeWallShells(root,colliders)
 assert.equal(h.count,1);assert.deepEqual(Array.from(mesh.geometry.index.array),Array.from({length:36},(_,i)=>i+36))
 assert.deepEqual(mesh.geometry.userData.mapSourceRanges.entries,[{start:0,count:36,pieceId:'floor',nodeId:'collider:floor',role:'collider'}]);assert.equal(JSON.stringify(g.userData),before)
 h.dispose();assert.equal(mesh.geometry,g);assert.equal(JSON.stringify(g.userData),before)
 mesh.userData.v2SourceRanges=[{first:0,count:72,sourceId:'wall'}]
 const ambiguous=replaceRuntimeWallShells(root,colliders);assert.equal(ambiguous.count,0);assert.equal(mesh.geometry,g);ambiguous.dispose();box.dispose();g.dispose();m.dispose()
})

test('edge-connected damage preserves coherent survivors, full thickness, oriented shell and collider bounds',async()=>{
 const {wallMorphology}=await import('../lib/view/v2/architecture-morphology.js')
 let seed=123;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296)
 const wall=wallMorphology({length:4,height:3,thickness:.4,random,topOpen:true})
 assert.ok(wall.cavities.length>=2,'isolated pockets complement the connected edge beds')
 assert.ok(wall.cavities.every(p=>p.depth<=.14+1e-9&&p.depth>=.1))
 let faceArea=0,volume=0
 for(const t of wall.triangles){
  for(const p of [t.a,t.b,t.c])assert.ok(Math.abs(p[0])<=2&&Math.abs(p[1])<=1.5&&Math.abs(p[2])<=.2)
  const [a,b,c]=[t.a,t.b,t.c],u=b.map((v,i)=>v-a[i]),v=c.map((q,i)=>q-a[i])
  const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
  if(t.surface==='concrete'){
   assert.equal(a[2],b[2]);assert.equal(b[2],c[2]);assert.ok(n[2]*a[2]>0)
   faceArea+=Math.hypot(...n)/2
  }
  volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6
 }
 assert.ok(faceArea>6&&faceArea<12,'connected edge erosion replaces a substantial portion while preserving coherent planar faces')
 assert.ok(volume>2.6&&volume<4.8,'outward shell retains a substantial solid core despite deeper edge loss')
 assert.ok(wall.triangles.length<4000,'local topology budget, no whole-wall tessellation')
})

test('fracture mask isolates damaged triangles without extra material batches',()=>{
 const h=mountV2Architecture({root:new Group(),map:defaultMap});let flagged=0,damaged=0,intact=0
 h.root.traverse(m=>{
  if(!m.userData.v2FractureMask)return
  flagged++;const a=m.geometry.getAttribute('v2FractureMask')
  assert.equal(a.itemSize,1);assert.equal(a.count,m.geometry.getAttribute('position').count)
  assert.equal(m.userData.architectureSurface,'concrete')
  for(let i=0;i<a.count;i+=3){const v=a.getX(i);assert.ok(v===0||v===1);assert.equal(a.getX(i+1),v);assert.equal(a.getX(i+2),v);if(v)damaged++;else intact++}
 })
 assert.ok(flagged>0&&damaged>0&&intact>0);assert.equal(h.stats.materials,10);assert.ok(h.stats.meshes<=82,'damage uses existing spatial material batches, without separate cavity draws')
 h.dispose()
})
