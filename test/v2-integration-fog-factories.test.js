import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData??=class{}
globalThis.window??={location:{href:'http://localhost/'}}
const E=await import('threepipe'),T=await import('three')
const {defaultMap}=await import('../lib/core/map.js')
const {mountV2Architecture}=await import('../lib/view/v2/architecture.js')
const {mountV2Ground}=await import('../lib/view/v2/ground.js')

test('architecture, scanned rubble and ground factories compose linear fog and release borrowed resources',async()=>{
 const modelRoot=new E.Group(),root=new E.Group(),textures=[],originals=[]
 for(let i=1;i<=5;i++){
  const texture=new T.Texture(),material=new E.PhysicalMaterial({name:`Selected rubble ${i}: fixture`,map:texture,fog:false})
  modelRoot.add(new E.Mesh2(new E.BoxGeometry(),material));textures.push(texture);originals.push(material)
 }
 const callbacks=textures.map(t=>[...(t._listeners?.update||[])])
 const viewer={scene:{modelRoot},setDirty(){}}
 const arch=mountV2Architecture({viewer,root,map:defaultMap});await arch.ready
 const ground=mountV2Ground({viewer,root,map:defaultMap});await ground.ready
 const owned=new Set();root.traverse(o=>{for(const mat of Array.isArray(o.material)?o.material:[o.material])if(mat)owned.add(mat)})
 assert.equal(owned.size,15)
 for(const mat of owned){
  assert.ok(mat.customProgramCacheKey().includes('|v2-linear-scene-fog-1'),mat.name)
  const shader={...T.ShaderLib.physical,uniforms:{},defines:{}}
  mat.onBeforeCompile(shader,{})
  assert.ok(shader.fragmentShader.indexOf('<fog_fragment>')<shader.fragmentShader.indexOf('<colorspace_fragment>'),mat.name)
  assert.equal(shader.fragmentShader.match(/#include\s*<fog_fragment>/g).length,1)
 }
 originals.forEach((mat,i)=>{assert.equal(mat.fog,false);assert.equal(mat.map,textures[i]);assert.ok(!mat.customProgramCacheKey().includes('|v2-linear-scene-fog-1'))})
 ground.dispose();arch.dispose();ground.dispose();arch.dispose()
 assert.equal(root.children.length,0)
 textures.forEach((t,i)=>assert.deepEqual(t._listeners?.update||[],callbacks[i]))
 for(const mat of owned)assert.ok(!mat.customProgramCacheKey().includes('|v2-linear-scene-fog-1'))
 modelRoot.traverse(o=>o.geometry?.dispose());originals.forEach(m=>{m.map=null;m.setDirty();m.dispose()});textures.forEach(t=>t.dispose())
})
