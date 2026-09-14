import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData??=class {}
globalThis.window??={location:{href:'http://localhost/'}}
const T=await import('three')
const {PhysicalMaterial,Mesh2}=await import('threepipe')
const {mountV2Materials}=await import('../lib/view/v2/materials.js')
const {patchV2SurfaceShader}=await import('../lib/view/v2/materials-shader.js')
const {createV2MoistureUniforms,sampleV2Moisture,V2_MOISTURE}=await import('../lib/view/v2/materials-moisture.js')
const {defaultMap}=await import('../lib/core/map.js')

test('moisture follows static vent/roof geometry, remains bounded, and leaves dry ground dominant',()=>{
 const snapshot=JSON.stringify(defaultMap),u=createV2MoistureUniforms(defaultMap),empty=createV2MoistureUniforms()
 assert.equal(u.v2MoistureLeaks.value.length,4)
 assert.deepEqual(u.v2MoistureRoof.value.toArray(),[36,14,5,10]);assert.ok(Math.abs(u.v2MoistureRoofY.value-6.4)<1e-9)
 let dry=0,count=0,service=0,serviceBase=0
 for(let x=-25;x<25;x+=.5)for(let z=-25;z<15;z+=.5){
  const p=[x,0,z],w=sampleV2Moisture(p,.7,u)
  assert.ok(w>=0&&w<=V2_MOISTURE.strength)
  assert.equal(w,sampleV2Moisture(p,.7,u));assert.equal(sampleV2Moisture(p,.7,u,0),0)
  assert.ok(sampleV2Moisture(p,.3,u)>=sampleV2Moisture(p,.95,u),'photographic crevices retain more moisture')
  const rough=.9+(Math.max(V2_MOISTURE.roughnessFloor,.9*V2_MOISTURE.roughnessMultiplier)-.9)*w
  assert.ok(rough>=V2_MOISTURE.roughnessFloor&&rough<=.9);assert.ok(1-w*V2_MOISTURE.diffuseReduction>=.5)
  assert.ok(Math.abs(w-sampleV2Moisture([x+1e-5,0,z],.7,u))<.001,'continuous metre-scale field')
  dry+=w<.1;count++
 }
 assert.ok(dry/count>.65&&dry/count<.85)
 for(let z=-15;z<15;z+=.5)for(let x=-38.5;x<-31.5;x+=.5){service+=sampleV2Moisture([x,-3.5,z],.7,u);serviceBase+=sampleV2Moisture([x,-3.5,z],.7,empty)}
 assert.ok(service>serviceBase*1.4,'real vent locations bias service condensation')
 assert.equal(JSON.stringify(defaultMap),snapshot)
})

test('moisture preserves nine samplers, complete normal/AO hooks, source pipe PBR and exact Stop state',async()=>{
 const root=new T.Group(),map=new T.Texture();map.name='hangar_concrete_floor';map.repeat.set(9,7);map.rotation=.3;map.channel=1
 const floor=new PhysicalMaterial({name:'Map ground',map,normalMap:map,roughnessMap:map,aoMap:map,normalScale:new T.Vector2(.7,-.7)})
 const pipe=new PhysicalMaterial({name:'Map rust',roughness:.92,metalness:.42,map:new T.Texture(),normalMap:new T.Texture(),roughnessMap:new T.Texture(),aoMap:new T.Texture()})
 const selected=new PhysicalMaterial({name:'Selected truck',map:new T.Texture(),roughness:.38})
 const meshes=[floor,pipe,selected].map(m=>new Mesh2(new T.BoxGeometry(),m));root.add(...meshes)
 const originalFog=[floor.fog,pipe.fog,selected.fog],uv=meshes[0].geometry.attributes.uv.array.slice(),slots=['map','normalMap','roughnessMap','aoMap']
 const originalPipe=slots.map(k=>pipe[k]);let loads=0,released=0
 const handle=mountV2Materials({root,map:defaultMap,loadTexture:async()=>{loads++;const t=new T.Texture();t.addEventListener('dispose',()=>released++);return t}})
 await handle.ready;assert.equal(loads,9)
 const shader={...T.ShaderLib.physical,uniforms:{}};meshes[0].material.onBeforeCompile(shader,{})
 for(const [prefix,family] of [['v2Ground','substrate-rubble'],['v2Soffit','photo-soffit'],['v2','photo-worn']]) {
  const keys=prefix==='v2'?['v2Albedo','v2PhotoNormal','v2Surface']:[prefix+'Albedo',prefix+'Normal',prefix+'Surface']
  for(const k of keys)assert.ok(shader.uniforms[k].value.name.includes(family))
 }
 assert.equal(shader.uniforms.v2MoistureLeaks.value[0].x,defaultMap.environment.vents[0].x)
 assert.ok(shader.fragmentShader.includes('if(v2Up>0.) v2Moisture='),'ceilings and wall sides remain dry')
 assert.ok(!shader.fragmentShader.includes('v2Moisture*normal'))
 assert.equal((shader.fragmentShader.match(/#include <normal_fragment_maps>/g)||[]).length,1)
 assert.equal((shader.fragmentShader.match(/#include <aomap_fragment>/g)||[]).length,1)
 assert.equal((shader.fragmentShader.match(/#include <color_fragment>/g)||[]).length,1)
 assert.ok(shader.fragmentShader.indexOf('#include <fog_fragment>')<shader.fragmentShader.indexOf('#include <colorspace_fragment>'))
 const baseline={...T.ShaderLib.physical,uniforms:{}};patchV2SurfaceShader(baseline,shader.uniforms)
 assert.equal(shader.fragmentShader.match(/texture(?:2D|Grad)\(/g).length,baseline.fragmentShader.match(/texture(?:2D|Grad)\(/g).length,'no moisture texture lookup added to existing ground projection')
 for(const i of [1,2]) {const s={...T.ShaderLib.physical,uniforms:{}};meshes[i].material.onBeforeCompile(s,{});assert.ok(!s.fragmentShader.includes('v2MoistureField'))}
 assert.equal(meshes[1].material.roughness,pipe.roughness);assert.equal(meshes[1].material.metalness,pipe.metalness)
 assert.deepEqual(slots.map(k=>meshes[1].material[k]),originalPipe)
 assert.deepEqual(meshes[0].material.normalScale.toArray(),[.7,-.7]);assert.equal(meshes[0].material.map,map)
 handle.dispose();handle.dispose();assert.equal(released,9)
 assert.deepEqual(meshes.map(m=>m.material),[floor,pipe,selected]);assert.deepEqual([floor.fog,pipe.fog,selected.fog],originalFog)
 assert.deepEqual(map.repeat.toArray(),[9,7]);assert.equal(map.rotation,.3);assert.equal(map.channel,1)
 assert.deepEqual(meshes[0].geometry.attributes.uv.array,uv)
})


test('elevated canopy drainage bounds specular change while real ground crevices can become damp',()=>{
 const u=createV2MoistureUniforms(defaultMap);let strongest=0,canopyMax=0
 for(let x=-40;x<40;x+=.5)for(let z=-30;z<30;z+=.5){
  strongest=Math.max(strongest,sampleV2Moisture([x,-3.5,z],.2,u))
  const wet=sampleV2Moisture([x,4.3,z],.2,u);canopyMax=Math.max(canopyMax,wet)
  const r=.89+(Math.max(V2_MOISTURE.roughnessFloor,.89*V2_MOISTURE.roughnessMultiplier)-.89)*wet
  assert.ok(r>.76,'draining elevated slab keeps rough mineral response even in a mapped crevice')
 }
 assert.ok(strongest>.9,'localized low-ground retention is materially stronger than R6')
 assert.ok(canopyMax<=.221,'canopies never inherit ground pooling amplitude')
 const moved=structuredClone(defaultMap);moved.colliders.find(c=>c.id==='ground').center.y+=4
 assert.equal(createV2MoistureUniforms(moved).v2MoistureGradeY.value,4,'grade comes from authored geometry, not camera')
})
