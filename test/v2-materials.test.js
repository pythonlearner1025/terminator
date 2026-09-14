import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {location:{href:'http://localhost/'}}
const THREE = await import('three')
const {PhysicalMaterial, Mesh2} = await import('threepipe')
const {mountV2Materials,classifyV2Material} = await import('../lib/view/v2/materials.js')
const {patchV2SurfaceShader} = await import('../lib/view/v2/materials-shader.js')

function fixture(photo=false) {
  const root = new THREE.Group()
  const texture = new THREE.Texture()
  texture.name = 'hangar_concrete_floor_diff_1k.jpg'
  texture.repeat.set(5,10); texture.channel=1
  const material = new PhysicalMaterial({map:texture,normalMap:texture,roughnessMap:texture,aoMap:texture,metalnessMap:texture,
    color:0x809090,side:THREE.DoubleSide,vertexColors:true,depthWrite:false})
  material.name = 'Map concrete'
  if(photo) material.userData.v2Surface='concrete'
  const mesh = new Mesh2(new THREE.BoxGeometry(4,.2,8),material)
  root.add(mesh)
  return {root,texture,material,mesh}
}

test('installed PhysicalMaterial clones preserve all source map identities, transforms, flags, and geometry', async () => {
  const {root,texture,material,mesh} = fixture()
  const original = {color:material.color.clone(),normalScale:material.normalScale.clone(),data:JSON.stringify(material.userData),geometry:mesh.geometry,fog:material.fog}
  const sourceListeners=texture._listeners?.update?.length || 0
  let sourceDisposed=0, textureDisposed=0, cloneDisposed=0
  material.addEventListener('dispose',()=>sourceDisposed++)
  texture.addEventListener('dispose',()=>textureDisposed++)
  const handle=mountV2Materials({root,preview:true})
  await handle.ready
  assert.ok(mesh.material.isPhysicalMaterial)
  assert.equal(mesh.material.fog,true);assert.equal(material.fog,original.fog)
  assert.notEqual(mesh.material,material)
  for(const slot of ['map','normalMap','roughnessMap','aoMap','metalnessMap']) assert.equal(mesh.material[slot],texture)
  assert.deepEqual(texture.repeat.toArray(),[5,10]); assert.equal(texture.channel,1)
  assert.equal(mesh.material.side,THREE.DoubleSide); assert.equal(mesh.material.vertexColors,true)
  assert.equal(mesh.material.depthWrite,false); assert.equal(mesh.geometry,original.geometry)
  assert.deepEqual(material.color,original.color); assert.deepEqual(material.normalScale,original.normalScale)
  assert.equal(JSON.stringify(material.userData),original.data)
  mesh.material.addEventListener('dispose',()=>cloneDisposed++)
  handle.sync(Object.freeze({tick:120})); handle.dispose(); handle.dispose()
  assert.equal(mesh.material,material)
  assert.equal(material.fog,original.fog)
  assert.equal(sourceDisposed,0); assert.equal(textureDisposed,0); assert.equal(cloneDisposed,1)
  assert.equal(texture._listeners?.update?.length || 0,sourceListeners)
})

test('classification protects emissive/signals, optics and unlit; explicit tags and selected imports are retained', () => {
  const material=new PhysicalMaterial()
  material.name='Selected container 3: corrugated_sides'
  assert.equal(classifyV2Material(material,{}),'imported')
  material.name='V2 exposed rebar'
  assert.equal(classifyV2Material(material,{}),'metal')
  assert.equal(classifyV2Material(material,{userData:{v2Surface:'preserve'}}),null)
  material.name='Map concrete'; material.emissive.set(0xff0000)
  assert.equal(classifyV2Material(material,{}),null)
  assert.equal(classifyV2Material(new THREE.MeshBasicMaterial(),{}),null)
})

test('shared source material clones are reused and material group arrays restore exactly', () => {
  const {root,material,mesh}=fixture()
  const second=new Mesh2(mesh.geometry,[material,new PhysicalMaterial({name:'UI'})]); root.add(second)
  const original=second.material
  const handle=mountV2Materials({root})
  assert.equal(mesh.material,second.material[0]); assert.equal(second.material[1],original[1])
  assert.equal(handle.stats.materials,1)
  handle.dispose(); assert.deepEqual(second.material,original)
})

test('dispose before asynchronous loads resolve releases late textures and never changes restored materials', async () => {
  const {root,mesh,material}=fixture(true), resolve=[]
  let released=0
  const handle=mountV2Materials({root,loadTexture:()=>new Promise(done=>resolve.push(done))})
  handle.dispose()
  for(const done of resolve) {
    const texture=new THREE.Texture(); texture.addEventListener('dispose',()=>released++); done(texture)
  }
  await handle.ready
  assert.equal(released,3); assert.equal(mesh.material,material); assert.equal(handle.stats.ready,false)
})

test('load failures reject ready and cleanup keeps source textures alive', async () => {
  const {root,mesh,material}=fixture(true)
  const handle=mountV2Materials({root,loadTexture:()=>Promise.reject(new Error('fixture missing texture'))})
  await assert.rejects(handle.ready,/fixture missing texture/)
  handle.dispose(); assert.equal(mesh.material,material)
})

test('GLSL patch supports current physical shader, retains built-in PBR chunks, and transforms instances', () => {
  const shader={...THREE.ShaderLib.physical,uniforms:{}}
  patchV2SurfaceShader(shader,{v2Surface:{value:null},v2Response:{value:new THREE.Vector4(0,.84,0,0)}})
  for(const token of ['#include <map_fragment>','#include <roughnessmap_fragment>','#include <normal_fragment_maps>']) assert.ok(shader.fragmentShader.includes(token))
  assert.ok(shader.vertexShader.includes('instanceMatrix * v2World'))
  assert.ok(shader.vertexShader.includes('batchingMatrix * v2World'))
  assert.ok(shader.fragmentShader.includes('v2Packed.g'))
  assert.throws(()=>patchV2SurfaceShader({vertexShader:'',fragmentShader:'',uniforms:{}},{}),/missing vertex hook/)
})

test('ready loads share a family, preserve source callback and return project-relative asset URLs in browser', async () => {
  const {root,mesh,material}=fixture(true), urls=[]
  let called=0
  material.onBeforeCompile=function(shader){called++; shader.uniforms.previous={value:1}}
  const handle=mountV2Materials({root,loadTexture:async url=>{urls.push(url); return new THREE.Texture()}})
  await handle.ready
  const shader={...THREE.ShaderLib.physical,uniforms:{}}
  mesh.material.onBeforeCompile(shader,{})
  assert.equal(called,1); assert.equal(shader.uniforms.previous.value,1)
  assert.equal(handle.stats.textures,3); assert.equal(urls.length,3)
  assert.ok(urls.every(url=>url.includes('/assets/v2/materials/photo-worn-')))
  assert.equal(shader.uniforms.v2Albedo.value.colorSpace,THREE.SRGBColorSpace)
  handle.dispose()
})


test('legacy pipe/rust grade is dark neutral metal without modifying source or selected prop paint', () => {
  const source=new PhysicalMaterial({color:0xad7854});source.name='Map rust'
  const root=new THREE.Group(), mesh=new Mesh2(new THREE.BoxGeometry(1,1,1),source);root.add(mesh)
  const color=source.color.clone(), handle=mountV2Materials({root})
  assert.ok(mesh.material.color.r<color.r*.8)
  assert.deepEqual(source.color,color)
  handle.dispose()
  source.name='Selected container 1: frame'
  const imported=mountV2Materials({root})
  assert.deepEqual(mesh.material.color,color)
  imported.dispose()
})

test('existing Threepipe material extensions survive and unregister only on the owned copy', () => {
  const {root,material,mesh}=fixture()
  const registered=new Set()
  const extension={uuid:'v2-test-extension',computeCacheKey:'v2-test',isCompatible:()=>true,onRegister:m=>registered.add(m),onUnregister:m=>registered.delete(m)}
  material.registerMaterialExtensions([extension])
  const handle=mountV2Materials({root})
  assert.ok(mesh.material.materialExtensions.includes(extension))
  assert.ok(registered.has(material));assert.ok(registered.has(mesh.material))
  handle.dispose()
  assert.ok(registered.has(material));assert.equal(registered.size,1)
  material.unregisterMaterialExtensions([extension])
})

test('architecture fracture tags select rubble without changing imported texture transforms or source tags', () => {
  const {root,material,mesh,texture}=fixture()
  material.userData.v2Surface='concrete'
  mesh.userData.architectureSurface='fracture'
  const plain=new Mesh2(mesh.geometry,material);root.add(plain)
  const sourceTags=JSON.stringify(material.userData)
  const handle=mountV2Materials({root})
  assert.equal(mesh.material.userData.v2Surface,'rubble')
  assert.equal(plain.material.userData.v2Surface,'concrete')
  assert.notEqual(mesh.material,plain.material)
  assert.equal(mesh.material.map,texture);assert.deepEqual(texture.repeat.toArray(),[5,10])
  assert.equal(JSON.stringify(material.userData),sourceTags)
  handle.dispose();assert.equal(mesh.material,material);assert.equal(plain.material,material)
})

test('R4 upward floor substrate replaces runtime response while undersides and Stop retain source invariants', async()=>{
 const {root,mesh,material,texture}=fixture()
 const sourceColor=material.color.clone(), uv=mesh.geometry.attributes.uv.array.slice()
 const uvMatrix=texture.matrix.clone(), sourceScale=material.normalScale.clone()
 const loaded=[], disposed=[]
 const h=mountV2Materials({root,loadTexture:async url=>{
   const t=new THREE.Texture(); loaded.push(url);t.addEventListener('dispose',()=>disposed.push(url));return t
 }})
 await h.ready
 assert.equal(h.stats.textures,9)
 const shader={...THREE.ShaderLib.physical,uniforms:{}}
 mesh.material.onBeforeCompile(shader,{})
 assert.ok(shader.fragmentShader.includes('v2Response.y*(1.-v2Up)'))
 assert.ok(shader.fragmentShader.includes('v2SampleSubstrate(vV2SurfacePosition'))
 assert.ok(shader.fragmentShader.includes('metalnessFactor*=1.-v2Up'))
 assert.ok(shader.fragmentShader.includes('v2GroundPacked.g'))
 assert.ok(shader.fragmentShader.includes('texture2D(v2SoffitAlbedo,v2UV)'))
 assert.ok(!shader.fragmentShader.includes('fract(vec2(dot(vV2SurfacePosition'))
 assert.ok(shader.fragmentShader.includes('vec3(v2GroundN.x,0.,-v2GroundN.y)'))
 assert.equal(shader.uniforms.v2Response.value.x,1)
 assert.equal(shader.uniforms.v2GroundAlbedo.value.colorSpace,THREE.SRGBColorSpace)
 assert.equal(shader.uniforms.v2GroundNormal.value.colorSpace,THREE.NoColorSpace)
 for(const [prefix,family] of [['v2Ground','substrate-rubble'],['v2Soffit','photo-soffit']]) {
   for(const suffix of ['Albedo','Normal','Surface']) {
     assert.ok(shader.uniforms[prefix+suffix].value?.name.includes(family),`${prefix+suffix} must bind its own photographic family`)
   }
 }
 assert.equal(loaded.filter(url=>url.includes('substrate-rubble')).length,3)
 assert.equal(mesh.material.map,material.map)
 assert.deepEqual(mesh.material.normalScale,sourceScale)
 assert.ok(!shader.fragmentShader.includes('v2Fracture'))
 assert.ok(!shader.fragmentShader.includes('v2CoarseHeight'))
 assert.equal((shader.fragmentShader.match(/#include <color_fragment>/g)||[]).length,1)
 assert.ok(!shader.fragmentShader.includes('vColor.rgb'))
 h.dispose()
 assert.equal(mesh.material,material)
 assert.equal(material.map,texture);assert.deepEqual(material.color,sourceColor)
 assert.deepEqual(material.normalScale,sourceScale);assert.deepEqual(texture.matrix,uvMatrix)
 assert.deepEqual(mesh.geometry.attributes.uv.array,uv)
 assert.equal(disposed.length,9)
})

test('selected photoscan identity overrides concrete tags and preserves native shaders/UV maps', async()=>{
 const {root,material,mesh,texture}=fixture()
 material.name='Selected rubble 1: TextureAtlas_1001'
 mesh.userData={v2Surface:'concrete',architectureSurface:'fracture'}
 const h=mountV2Materials({root,loadTexture:async()=>{throw Error('photoscan maps must be retained')}})
 await h.ready
 const shader={...THREE.ShaderLib.physical,uniforms:{}}
 mesh.material.onBeforeCompile(shader,{})
 assert.equal(mesh.material.map,texture)
 assert.deepEqual(texture.repeat.toArray(),[5,10]);assert.equal(texture.channel,1)
 assert.ok(!shader.fragmentShader.includes('vV2SurfacePosition'))
 h.dispose()
 mesh.userData.v2Surface='preserve'
 const preserved=mountV2Materials({root});assert.equal(mesh.material,material);preserved.dispose()
})

test('photo replacement defers vertex color and alpha to the one native color_fragment',()=>{
 const shader={...THREE.ShaderLib.physical,uniforms:{}}
 patchV2SurfaceShader(shader,{v2Response:{value:new THREE.Vector4(0,.84,0,0)}})
 assert.equal((shader.fragmentShader.match(/#include <color_fragment>/g)||[]).length,1)
 assert.ok(!shader.fragmentShader.includes('vColor.rgb'))
 assert.ok(!shader.fragmentShader.includes('diffuseColor.a ='))
 assert.ok(shader.fragmentShader.indexOf('v2Target')<shader.fragmentShader.indexOf('#include <color_fragment>'))
})

test('generated near-wall photo substrate stays legible without brightening fracture chips, skyline or source',()=>{
 const root=new THREE.Group(), geometry=new THREE.BoxGeometry()
 const source=new PhysicalMaterial({color:0x424b55,name:'V2 concrete',vertexColors:true})
 source.userData={v2Architecture:true,v2Surface:'concrete',architectureSurface:'concrete'}
 const skyline=new PhysicalMaterial({color:0x252f3b,name:'V2 skyline concrete'})
 skyline.userData={v2Architecture:true,v2Surface:'concrete',architectureSurface:'skyline'}
 const chip=new PhysicalMaterial({color:0x505963,name:'V2 fractured concrete'});chip.userData={v2Architecture:true,v2Surface:'concrete',architectureSurface:'fracture'}
 const a=new Mesh2(geometry,source), b=new Mesh2(geometry,skyline), c=new Mesh2(geometry,chip);root.add(a,b,c)
 const before=source.color.clone(), skyBefore=skyline.color.clone()
 const h=mountV2Materials({root})
 assert.deepEqual(a.material.color.toArray(),[.30,.32,.33])
 assert.deepEqual(c.material.color,chip.color)
 assert.deepEqual(b.material.color,skyBefore)
 assert.deepEqual(source.color,before)
 assert.ok(source.color.r<.06,'Fixture retains actual dark generated concrete factor')
 h.dispose();assert.equal(a.material,source);assert.equal(b.material,skyline)
 geometry.dispose();source.dispose();skyline.dispose();chip.dispose()
})

test('floor and underside families share nine owned maps and late completion cannot revive a stopped clone',async()=>{
 const {root,mesh,material,texture}=fixture(), pending=[]
 const second=new Mesh2(mesh.geometry,material);root.add(second)
 const sourceListeners=texture._listeners?.update?.length||0
 let released=0
 const h=mountV2Materials({root,loadTexture:()=>new Promise(resolve=>pending.push(resolve))})
 assert.equal(pending.length,9)
 assert.equal(mesh.material,second.material)
 h.dispose()
 for(const resolve of pending){
   const t=new THREE.Texture();t.addEventListener('dispose',()=>released++);resolve(t)
 }
 await h.ready
 assert.equal(released,9);assert.equal(h.stats.ready,false)
 assert.equal(mesh.material,material);assert.equal(second.material,material)
 assert.equal(texture._listeners?.update?.length||0,sourceListeners)
})


test('world fog opt-in reaches native imported clones while preserving source and preserve-tag opt-out',async()=>{
 const {root,material,mesh}=fixture()
 material.name='Selected container 2: corrugated';material.fog=false
 for(const name of ['Map canvas','Map rubber']) {
   material.name=name
   assert.equal(classifyV2Material(material,mesh),'imported')
   const native=mountV2Materials({root});await native.ready
   const shader={...THREE.ShaderLib.physical,uniforms:{}}
   mesh.material.onBeforeCompile(shader,{})
   assert.ok(!shader.fragmentShader.includes('vV2SurfacePosition'))
   assert.equal(mesh.material.fog,true);assert.equal(mesh.material.map,material.map)
   native.dispose();assert.equal(material.fog,false);assert.equal(mesh.material,material)
 }
 material.name='Selected container 2: corrugated'
 const h=mountV2Materials({root})
 await h.ready
 assert.equal(mesh.material.fog,true);assert.equal(material.fog,false)
 assert.equal(mesh.material.map,material.map)
 h.dispose();assert.equal(mesh.material,material);assert.equal(material.fog,false)
 mesh.userData.v2Surface='preserve'
 const preserved=mountV2Materials({root});await preserved.ready
 assert.equal(mesh.material,material);assert.equal(material.fog,false);preserved.dispose()
})
