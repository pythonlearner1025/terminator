import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
globalThis.ImageData??=class {}
globalThis.window??={location:{href:'http://localhost/'}}
const T=await import('three')
const {PhysicalMaterial,Mesh2}=await import('threepipe')
const {mountV2Materials,classifyV2Material}=await import('../lib/view/v2/materials.js')
const {installV2LinearFog}=await import('../lib/view/v2/fog.js')
function fixture(){
 const root=new T.Group(),geometry=new T.BoxGeometry().toNonIndexed()
 const floorMap=new T.Texture();floorMap.name='hangar_concrete_floor';floorMap.channel=1;floorMap.repeat.set(7,13)
 const ground=new PhysicalMaterial({map:floorMap,normalMap:floorMap,roughnessMap:floorMap,name:'Map ground'})
 const wall=new PhysicalMaterial({color:0x424b55,name:'V2 concrete',vertexColors:true})
 wall.userData={v2Architecture:true,v2Surface:'concrete',architectureSurface:'concrete'}
 const mask=new T.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(1,18),1)
 geometry.setAttribute('v2FractureMask',mask)
 const floor=new Mesh2(new T.BoxGeometry(),ground), damaged=new Mesh2(geometry,wall),surviving=new Mesh2(new T.BoxGeometry(),wall)
 damaged.userData={v2Architecture:true,v2Surface:'concrete',architectureSurface:'concrete',v2FractureMask:true}
 root.add(floor,damaged,surviving)
 return {root,floor,damaged,surviving,ground,wall,floorMap,mask}
}
test('12-map fracture pass binds every family correctly and preserves surviving shader, native UVs, mask and source fog',async()=>{
 const f=fixture(),sources=[f.ground,f.wall],fog=sources.map(m=>m.fog),uv=f.damaged.geometry.attributes.uv.array.slice(),mask=f.mask.array.slice(),urls=[],disposed=[]
 const h=mountV2Materials({root:f.root,loadTexture:async url=>{urls.push(url);const t=new T.Texture();t.addEventListener('dispose',()=>disposed.push(url));return t}})
 await h.ready;assert.equal(h.stats.textures,12);assert.equal(urls.length,12)
 assert.equal(classifyV2Material(f.wall,f.damaged),'fracture-masked')
 const shaders=[f.floor,f.damaged,f.surviving].map(mesh=>{const s={...T.ShaderLib.physical,uniforms:{}};mesh.material.onBeforeCompile(s,{});return s})
 for(const [shader,prefix,family] of [[shaders[0],'v2Ground','substrate-rubble'],[shaders[0],'v2Soffit','photo-soffit'],[shaders[1],'v2Spall','photo-spall']]){
  for(const suffix of ['Albedo','Normal','Surface'])assert.ok(shader.uniforms[prefix+suffix].value.name.includes(family))
  assert.equal(shader.uniforms[prefix+'Albedo'].value.colorSpace,T.SRGBColorSpace)
  assert.equal(shader.uniforms[prefix+'Normal'].value.colorSpace,T.NoColorSpace)
  assert.equal(shader.uniforms[prefix+'Surface'].value.colorSpace,T.NoColorSpace)
 }
 assert.equal(shaders[1].uniforms.v2SpallAlbedo.value.wrapS,T.ClampToEdgeWrapping)
 assert.ok(shaders[1].vertexShader.includes('attribute float v2FractureMask'))
 assert.ok(shaders[1].fragmentShader.includes('clamp(vV2FractureMask,0.,1.)'))
 assert.ok(shaders[1].fragmentShader.includes('float v2Surviving=1.-clamp(vV2FractureMask,0.,1.);'),'mask1 excludes surviving photo-normal calibration')
 assert.ok(shaders[2].fragmentShader.includes('float v2Surviving=1.;'))
 assert.ok(shaders[1].fragmentShader.includes('mix(mix(.32,.12,v2Down),mix(1.,.85,v2Down),v2Surviving)'),'damaged base retains old response underneath unchanged source spall')
 assert.ok(shaders[0].fragmentShader.includes('v2UV=vec2(dot(vV2SurfacePosition,v2U)/2.51,dot(vV2SurfacePosition,v2V)/1.55)'),'seamless ceiling metric projection unchanged')
 assert.equal((shaders[1].fragmentShader.match(/textureGrad\(v2Spall/g)||[]).length,3)
 assert.equal((shaders[1].fragmentShader.match(/#include <color_fragment>/g)||[]).length,1)
 assert.ok(!shaders[1].fragmentShader.includes('vColor.rgb'))
 assert.ok(shaders[1].fragmentShader.includes('reflectedLight.indirectDiffuse*=mix(1.,v2SpallPacked.r,v2SpallWeight)'))
 assert.ok(!shaders[1].fragmentShader.includes('reflectedLight.directDiffuse*='),'source AO does not suppress direct grazing light')
 assert.ok(shaders[1].fragmentShader.indexOf('reflectedLight.indirectDiffuse*=')>shaders[1].fragmentShader.indexOf('#include <aomap_fragment>'))
 assert.ok(!shaders[0].fragmentShader.includes('v2SpallWeight'));assert.ok(!shaders[2].fragmentShader.includes('v2SpallWeight'))
 assert.deepEqual(f.damaged.material.color,f.surviving.material.color,'same concrete palette across fracture mask')
 assert.equal(f.floor.material.map,f.floorMap);assert.deepEqual(f.floorMap.repeat.toArray(),[7,13])
 h.dispose();assert.equal(disposed.length,12);assert.equal(f.floor.material,f.ground);assert.equal(f.damaged.material,f.wall)
 assert.deepEqual(sources.map(m=>m.fog),fog);assert.deepEqual(f.damaged.geometry.attributes.uv.array,uv);assert.deepEqual(f.mask.array,mask)
})
test('explicit generated fracture is eligible; imported/preserve and missing metric UV fail closed',()=>{
 const f=fixture();f.damaged.userData.v2FractureMask=false;f.damaged.userData.architectureSurface='fracture'
 assert.equal(classifyV2Material(f.wall,f.damaged),'fracture')
 f.wall.name='Selected concrete scan';assert.equal(classifyV2Material(f.wall,f.damaged),'imported')
 f.damaged.userData.v2Surface='preserve';assert.equal(classifyV2Material(f.wall,f.damaged),null)
 f.wall.name='V2 concrete';f.damaged.userData.v2Surface='concrete';f.damaged.geometry.deleteAttribute('uv')
 assert.equal(classifyV2Material(f.wall,f.damaged),'rubble')
})
test('stop during all 12 pending maps restores sources and disposes late maps once',async()=>{
 const f=fixture(),pending=[];let released=0
 const h=mountV2Materials({root:f.root,loadTexture:()=>new Promise(resolve=>pending.push(resolve))})
 assert.equal(pending.length,12);h.dispose()
 for(const resolve of pending){const t=new T.Texture();t.addEventListener('dispose',()=>released++);resolve(t)}
 await h.ready;assert.equal(released,12);assert.equal(h.stats.ready,false);assert.equal(f.floor.material,f.ground);assert.equal(f.damaged.material,f.wall)
})
test('fracture source channels remain exact verified 0.5m study bytes with native relief calibration',()=>{
 const base=new URL('../assets/v2/materials/',import.meta.url),d=JSON.parse(readFileSync(new URL('photo-spall-provenance.json',base)))
 assert.equal(d.patch.widthMeters,.5);assert.equal(d.patch.heightMeters,.5);assert.ok(Math.abs(d.patch.displacementScaleMeters-.02)<1e-8)
 assert.equal(d.license,'CC0-1.0');assert.equal(d.additional_gpu_mib_rgba8_with_mips,4)
 for(const x of d.outputs)assert.equal(createHash('sha256').update(readFileSync(new URL(x.file,base))).digest('hex'),x.sha256)
})

test('owned fog composes after fracture hooks and inherited architecture fog without altering its owner',async()=>{
 const f=fixture();let calls=0
 f.wall.fog=true
 f.wall.onBeforeCompile=function(shader){calls++;shader.uniforms.foreign={value:this.name}}
 f.wall.customProgramCacheKey=function(){return this.name+'|foreign'}
 const sourceFog=installV2LinearFog(f.wall,{owned:true})
 const sourceCompile=f.wall.onBeforeCompile,sourceKey=f.wall.customProgramCacheKey
 const h=mountV2Materials({root:f.root,loadTexture:async()=>new T.Texture()});await h.ready
 const owned=f.damaged.material,shader={...T.ShaderLib.physical,uniforms:{}}
 owned.onBeforeCompile(shader,{})
 assert.equal(calls,1);assert.equal(shader.uniforms.foreign.value,owned.name)
 assert.ok(shader.fragmentShader.includes('v2SpallWeight'))
 const order=['opaque_fragment','fog_fragment','tonemapping_fragment','colorspace_fragment','premultiplied_alpha_fragment','dithering_fragment'].map(x=>shader.fragmentShader.indexOf(`#include <${x}>`))
 assert.ok(order.every((x,i)=>x>=0&&(!i||x>order[i-1])))
 assert.equal((shader.fragmentShader.match(/#include <fog_fragment>/g)||[]).length,1)
 assert.equal((owned.customProgramCacheKey().match(/v2-linear-scene-fog-1/g)||[]).length,1)
 h.dispose()
 assert.equal(f.wall.onBeforeCompile,sourceCompile);assert.equal(f.wall.customProgramCacheKey,sourceKey)
 assert.equal(sourceFog.attached,true);assert.equal(f.damaged.material,f.wall)
 assert.ok(!owned.customProgramCacheKey().includes('v2-linear-scene-fog-1'),'own helper detached before disposal')
 sourceFog.dispose()
})
