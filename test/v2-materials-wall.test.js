import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
globalThis.ImageData??=class {}
globalThis.window??={location:{href:'http://localhost/'}}
const T=await import('three'),{PhysicalMaterial,Mesh2}=await import('threepipe')
const {mountV2Materials}=await import('../lib/view/v2/materials.js')
const {isV2WallReceiver}=await import('../lib/view/v2/materials-wall.js')
function fixture(){
 const root=new T.Group(),mat=new PhysicalMaterial({name:'V2 concrete',normalScale:new T.Vector2(.4,-.4)})
 mat.userData={v2Architecture:true,architectureSurface:'concrete',v2Surface:'concrete'}
 const wall=new Mesh2(new T.BoxGeometry().toNonIndexed(),mat)
 wall.userData={v2Architecture:true,architectureSurface:'concrete',v2Surface:'concrete',sourceColliderIds:['exp_barracks_partition_1'],v2FractureMask:true}
 wall.geometry.setAttribute('v2FractureMask',new T.Float32BufferAttribute(new Array(wall.geometry.attributes.uv.count).fill(1),1))
 const prop=new Mesh2(new T.BoxGeometry(),mat),sky=new Mesh2(new T.BoxGeometry(),mat)
 sky.userData={v2Architecture:true,architectureSurface:'skyline',sourceColliderIds:['skyline']}
 const floor=new Mesh2(new T.BoxGeometry(),new PhysicalMaterial({name:'Map ground'}));root.add(wall,prop,sky,floor)
 return {root,wall,prop,sky,floor,mat}
}
test('real wall provenance selects aggregate; props, skyline, ground and preservation never do',()=>{
 const f=fixture();assert.equal(isV2WallReceiver(f.mat,f.wall,'fracture-masked'),true)
 for(const [mesh,kind] of [[f.prop,'concrete'],[f.sky,'concrete'],[f.floor,'ground'],[f.wall,'imported']])assert.equal(isV2WallReceiver(mesh.material,mesh,kind),false)
 f.wall.userData.architectureSurface='fracture';assert.equal(isV2WallReceiver(f.mat,f.wall,'fracture'),false,'fracture batches can contain collapse rubble');
 f.wall.userData.architectureSurface='concrete';f.wall.userData.v2WallSubstrate=false;assert.equal(isV2WallReceiver(f.mat,f.wall,'fracture-masked'),false)
})
test('15-map wall composition preserves twelve existing bindings, distinct variants, UV/mask and exact cleanup',async()=>{
 const f=fixture(),originals=f.root.children.map(x=>x.material),uv=f.wall.geometry.attributes.uv.array.slice(),mask=f.wall.geometry.attributes.v2FractureMask.array.slice();let disposed=0
 const compile=f.mat.onBeforeCompile,key=f.mat.customProgramCacheKey,fog=f.mat.fog
 const h=mountV2Materials({root:f.root,loadTexture:async()=>{const t=new T.Texture();t.addEventListener('dispose',()=>disposed++);return t}});await h.ready
 assert.equal(h.stats.textures,15)
 const shader=mesh=>{const s={...T.ShaderLib.physical,uniforms:{}};mesh.material.onBeforeCompile(s,{});return s}
 const wall=shader(f.wall),floor=shader(f.floor),prop=shader(f.prop)
 for(const [s,prefix,family] of [[wall,'v2Wall','wall-aggregate'],[wall,'v2Spall','photo-spall'],[floor,'v2Ground','substrate-rubble'],[floor,'v2Soffit','photo-soffit']]) {
  for(const [suffix,space]of [['Albedo',T.SRGBColorSpace],['Normal',T.NoColorSpace],['Surface',T.NoColorSpace]]){const t=s.uniforms[prefix+suffix].value;assert.ok(t.name.includes(family));assert.equal(t.colorSpace,space)}
 }
 for(const s of [wall,floor])for(const k of ['v2Albedo','v2PhotoNormal','v2Surface'])assert.ok(s.uniforms[k].value.name.includes('photo-worn'))
 assert.ok(wall.fragmentShader.includes('if(!v2Horizontal)'))
 assert.ok(wall.fragmentShader.includes('v2Coverage=1.;'),'wall photograph is not washed out by inherited flat paint')
 assert.ok(wall.fragmentShader.includes('if(v2WallWeight>0.) v2Target=v2Photo*.4;'))
 assert.ok(wall.fragmentShader.includes('if(v2WallWeight>0.) roughnessFactor=v2Packed.g;'),'native ARM roughness retained')
 assert.ok(!/float\s+(cast|patch)\s*=/.test(wall.fragmentShader),'GLSL reserved locals excluded');
 assert.ok(wall.fragmentShader.includes('/2.1;'));assert.ok(wall.fragmentShader.includes('nb.xy=vec2(nb.y,-nb.x)'))
 assert.equal((wall.fragmentShader.match(/float v2Hash\(/g)||[]).length,1,'spall helper declaration is not duplicated')
 assert.equal((wall.fragmentShader.match(/float v2WallHash\(/g)||[]).length,1)
 assert.ok(!floor.fragmentShader.includes('v2WallWeight'));assert.ok(!prop.fragmentShader.includes('v2WallWeight'))
 assert.notEqual(f.wall.material,f.prop.material,'one source can have wall and prop variants')
 assert.equal((wall.fragmentShader.match(/#include <color_fragment>/g)||[]).length,1)
 assert.ok(wall.fragmentShader.indexOf('#include <fog_fragment>')<wall.fragmentShader.indexOf('#include <colorspace_fragment>'))
 h.dispose();h.dispose();assert.equal(disposed,15);assert.deepEqual(f.root.children.map(x=>x.material),originals)
 assert.equal(f.mat.onBeforeCompile,compile);assert.equal(f.mat.customProgramCacheKey,key);assert.equal(f.mat.fog,fog)
 assert.deepEqual(f.mat.normalScale.toArray(),[.4,-.4]);assert.deepEqual(f.wall.geometry.attributes.uv.array,uv);assert.deepEqual(f.wall.geometry.attributes.v2FractureMask.array,mask)
})
test('all fifteen pending maps are released after cancellation without touching authored walls',async()=>{
 const f=fixture(),pending=[];let disposed=0
 const h=mountV2Materials({root:f.root,loadTexture:()=>new Promise(r=>pending.push(r))});assert.equal(pending.length,15);h.dispose()
 for(const r of pending){const t=new T.Texture();t.addEventListener('dispose',()=>disposed++);r(t)}await h.ready
 assert.equal(disposed,15);assert.equal(f.wall.material,f.mat);assert.equal(h.stats.ready,false)
})
test('full photographed aggregate channels retain receipt hashes and native metric scale',()=>{
 const base=new URL('../assets/v2/materials/',import.meta.url),p=JSON.parse(readFileSync(new URL('wall-aggregate-provenance.json',base)))
 assert.deepEqual(p.metres,[2.1,2.1]);assert.equal(p.license,'CC0-1.0')
 for(const o of p.outputs)assert.equal(createHash('sha256').update(readFileSync(new URL(o.file,base))).digest('hex'),o.sha256)
 assert.equal(p.sourceFiles[0].sha256,p.outputs[0].sha256,'original full albedo is unchanged')
})
