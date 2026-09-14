import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.window ??= {}
globalThis.ImageData ??= class {}
globalThis.WebGLRenderingContext ??= class {}
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)
globalThis.cancelAnimationFrame = clearTimeout
const {warmupMatch,compileWarmupTargets} = await import('../../lib/view/match-warmup.js')
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture() {
  const controller = new AbortController(), events = []
  const object = {material:{isMaterial:true},isMesh:true, isInstancedMesh:true, count:0, visible:false, frustumCulled:true}
  const scene = {isObject3D:true, mainCamera:{}, traverse(fn){fn(object)}}
  const renderer = {shadowMap:{}, info:{programs:[]},
    compile(){events.push('compile')},
    async compileAsync(){this.compile();events.push('compile-ready')},
    getContext(){return {finish(){events.push('finish')}}}}
  const pool = {prime(){events.push('pool-prime')},reset(){events.push('pool-reset')}}
  const manager = {ctx:{viewer:{scene,renderManager:{webglRenderer:renderer,passes:[]},setDirty(){}}},viewsStarted:true,
    mapView:{ready:Promise.resolve()},unitView:{primeWarmup(){events.push('units-prime');return ()=>events.push('units-release')}},
    playerView:{weapons:{rigs:{},worldFx:{pools:{pool}},primeWarmup(){events.push('weapons-prime');return ()=>events.push('weapons-release')}}}}
  const run = () => warmupMatch(manager,{signal:controller.signal,weaponReady:Promise.resolve()})
  return {controller,events,object,renderer,manager,run}
}
test('both light variants compile once, render, and restore pooled state', async () => {
  const f=fixture(),report=await f.run()
  assert.equal(report.cancelled,undefined)
  assert.equal(f.events.filter(x=>x==='compile').length,2)
  assert.equal(f.events.filter(x=>x==='units-release').length,1)
  assert(f.events.includes('finish'))
  assert.deepEqual([f.object.count,f.object.visible,f.object.frustumCulled],[0,false,true])
})
test('asset failure prevents priming and compilation', async () => {
  const f=fixture();f.manager.mapView.ready=Promise.reject(Error('HTTP 503'))
  await assert.rejects(f.run(),/503/)
  assert.deepEqual(f.events,[])
})
test('stop settles pending readiness immediately and observes late failure', async () => {
  const f=fixture(),asset=Promise.withResolvers();f.manager.mapView.ready=asset.promise
  const pending=f.run();f.controller.abort()
  assert.deepEqual(await pending,{cancelled:true})
  asset.reject(Error('late asset failure'));await tick()
  assert.deepEqual(f.events,[])
})
test('stop during compile restores synchronously and cannot resume into restart', async () => {
  const f=fixture(),compile=Promise.withResolvers()
  f.renderer.compileAsync=()=>{f.events.push('compile');return compile.promise}
  const old=f.run();await tick()
  assert.equal(f.object.visible,true)
  f.controller.abort()
  assert.deepEqual([f.object.count,f.object.visible,f.object.frustumCulled],[0,false,true])
  assert.equal(f.events.filter(x=>x==='units-release').length,1)
  const next=fixture();await next.run()
  assert.deepEqual(await old,{cancelled:true})
  compile.resolve();await tick()
  assert.equal(f.events.filter(x=>x==='compile').length,1)
  assert(!f.events.includes('finish'))
  assert.equal(f.events.filter(x=>x==='units-release').length,1)
})
test('image timeout path can be stopped without leaking primed pools', async () => {
  const f=fixture();f.object.material={isMaterial:true,map:{isTexture:true,image:{complete:false}}}
  const pending=f.run();await tick();f.controller.abort()
  assert.deepEqual(await pending,{cancelled:true})
  assert.equal(f.events.filter(x=>x==='pool-reset').length,1)
  assert(!f.events.includes('compile'))
})
const {warmupTargets}=await import('../../lib/view/match-warmup.js')
const {holdStartupRendering}=await import('../../lib/view/startup-rendering.js')
test('warmup excludes hidden authored copies but keeps runtime borrowers and visible authored lights', () => {
  const shared={isMaterial:true},sourceMesh={material:shared,children:[]},source={visible:false,children:[sourceMesh]},light={visible:true,isLight:true,children:[]}
  const authored={visible:true,children:[source,light]},runtime={visible:false,material:shared},menu={traverse(fn){fn(this)}}
  const scene={modelRoot:authored,traverse(fn){[authored,source,sourceMesh,light,runtime,menu].forEach(fn)}}
  assert.deepEqual(warmupTargets({scene},menu),[authored,light,runtime])
  assert.equal(runtime.material,sourceMesh.material)
})
test('nested render holds release once and preserve a pre-suspended viewer', () => {
  const viewer={renderEnabled:true},a=holdStartupRendering(viewer),b=holdStartupRendering(viewer)
  a();a();assert.equal(viewer.renderEnabled,false);b();assert.equal(viewer.renderEnabled,true)
  viewer.renderEnabled=false;holdStartupRendering(viewer)();assert.equal(viewer.renderEnabled,false)
})

test('idle-light compositor warmup keeps tracer geometry primed until both variants render', async () => {
  const f=fixture(),light={visible:false,intensity:0},geometry={visible:false}
  f.manager.playerView.weapons.projectiles={lights:[light]}
  f.manager.playerView.weapons.primeWarmup=()=>{geometry.visible=true;light.visible=true;light.intensity=1.4;return()=>{geometry.visible=false;light.visible=false;light.intensity=0}}
  const states=[];f.renderer.compileAsync=async()=>states.push([geometry.visible,light.visible,light.intensity])
  await f.run()
  assert.deepEqual(states,[[true,true,1.4],[true,false,0]])
  assert.deepEqual([geometry.visible,light.visible,light.intensity],[false,false,0])
})

test('idle-light warmup preserves a fixed visible zero-intensity light policy', async () => {
  const f=fixture(),light={visible:true,intensity:0}
  f.manager.playerView.weapons.projectiles={lights:[light]}
  f.manager.playerView.weapons.primeWarmup=()=>{light.intensity=1.4;return()=>{light.visible=true;light.intensity=0}}
  const states=[];f.renderer.compileAsync=async()=>states.push([light.visible,light.intensity])
  await f.run();assert.deepEqual(states,[[true,1.4],[true,0]]);assert.deepEqual([light.visible,light.intensity],[true,0])
})

test('active compilation overlaps uploads but gates rendering and the idle variant', async () => {
  const f=fixture(),ready=Promise.withResolvers()
  f.object.material={isMaterial:true,map:{isTexture:true,image:{width:1,height:1,complete:true}}}
  let calls=0
  f.renderer.compileAsync=()=>{f.events.push(++calls===1?'active':'idle');return calls===1?ready.promise:Promise.resolve()}
  f.renderer.initTexture=()=>f.events.push('upload')
  f.manager.ctx.viewer.setDirty=()=>f.events.push('render')
  const pending=f.run();await tick()
  assert(f.events.indexOf('active')<f.events.indexOf('upload'))
  assert(!f.events.includes('render'));assert(!f.events.includes('idle'));assert(!f.events.includes('finish'))
  ready.resolve();await pending
  assert(f.events.indexOf('render')<f.events.indexOf('idle'));assert(f.events.includes('finish'))
})

test('upload failure restores state and observes a later compile failure', async () => {
  const f=fixture(),ready=Promise.withResolvers()
  f.object.material={isMaterial:true,map:{isTexture:true,image:{width:1,height:1,complete:true}}}
  f.renderer.compileAsync=()=>ready.promise
  f.renderer.initTexture=()=>{throw Error('upload failed')}
  await assert.rejects(f.run(),/upload failed/)
  assert.deepEqual([f.object.count,f.object.visible,f.object.frustumCulled],[0,false,true])
  ready.reject(Error('late compile failure'));await tick()
  assert(!f.events.includes('finish'))
})

function compileFixture(rgbm=true) {
  const events=[],opaque={name:'opaque'},transparent={name:'transparent'},previous={name:'previous'}
  let target=previous,face=3,level=2
  const renderer={getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>level,
    setRenderTarget(value,nextFace=0,nextLevel=0){target=value;face=nextFace;level=nextLevel},
    compile(root,camera,scene){root.traverse(object=>events.push({target,object,material:object.material,defines:{...object.material.defines}}))},
    async compileAsync(...args){this.compile(...args)}}
  const viewer={scene:{mainCamera:{}},renderManager:{webglRenderer:renderer,rgbm,composerTarget:opaque,renderPass:{transparentTarget:transparent}}}
  return {events,renderer,viewer,opaque,transparent,previous}
}

test('compile uses compositor output and draw hooks for each material on a mixed skinned mesh',async()=>{
  const f=compileFixture(),calls=[]
  const materials=[{isMaterial:true},{isMaterial:true,transparent:true},{isMaterial:true,transmission:1}]
  const object={geometry:{},isSkinnedMesh:true,skeleton:{},material:materials}
  for(const material of materials){
    material.onBeforeRender=(renderer,scene,camera,geometry,source)=>{
      assert.equal(source,object);assert.equal(geometry,object.geometry)
      material.defines={SSAO_ENABLED:1,INVERSE_ALPHAMAP:0};calls.push('before')
    }
    material.onAfterRender=()=>calls.push('after')
  }
  await compileWarmupTargets(f.viewer,[object])
  assert.deepEqual(f.events.map(e=>e.target),[f.opaque,f.transparent,f.transparent])
  assert.deepEqual(f.events.map(e=>e.material),materials)
  assert(f.events.every(e=>e.object.isSkinnedMesh&&e.object.skeleton===object.skeleton&&e.defines.SSAO_ENABLED===1))
  assert.deepEqual(calls,['before','after','before','after','before','after'])
  assert.equal(object.material,materials);assert.equal(f.renderer.getRenderTarget(),f.previous)
  assert.equal(f.renderer.getActiveCubeFace(),3);assert.equal(f.renderer.getActiveMipmapLevel(),2)
})

test('non-RGBM compile keeps transparency on the ordinary compositor target',async()=>{
  const f=compileFixture(false),material={isMaterial:true,transparent:true}
  Object.defineProperty(f.viewer.renderManager.renderPass,'transparentTarget',{get(){throw Error('RGBM-only target was touched')}})
  await compileWarmupTargets(f.viewer,[{material}])
  assert.equal(f.events[0].target,f.opaque)
})

test('pending parallel compilation restores framebuffer immediately and Stop observes both late failures',async()=>{
  const f=compileFixture(),controller=new AbortController(),gates=[Promise.withResolvers(),Promise.withResolvers()]
  let index=0
  f.renderer.compileAsync=function(...args){this.compile(...args);return gates[index++].promise}
  const ready=compileWarmupTargets(f.viewer,[{material:{isMaterial:true}},{material:{isMaterial:true,transparent:true}}],{signal:controller.signal})
  assert.equal(index,2);assert.equal(f.renderer.getRenderTarget(),f.previous)
  controller.abort();await assert.rejects(ready,{name:'AbortError'})
  for(const gate of gates)gate.reject(Error('late driver failure'))
  await tick();assert.equal(f.renderer.getRenderTarget(),f.previous)
})

test('a later compile hook failure balances hooks, restores target and observes earlier compilation',async()=>{
  const f=compileFixture(),gate=Promise.withResolvers();let after=0
  const first={material:{isMaterial:true}},second={material:{isMaterial:true,transparent:true,
    onBeforeRender(){throw Error('hook failed')},onAfterRender(){after++}}}
  f.renderer.compileAsync=function(...args){this.compile(...args);return gate.promise}
  assert.throws(()=>compileWarmupTargets(f.viewer,[first,second]),/hook failed/)
  assert.equal(after,1);assert.equal(f.renderer.getRenderTarget(),f.previous)
  gate.reject(Error('late driver failure'));await tick()
})

test('warmup suspends automatic pool rendering between requested compositor frames',async()=>{
  const f=fixture(),states=[],viewer=f.manager.ctx.viewer;viewer.renderEnabled=true
  f.renderer.compileAsync=async()=>{states.push(viewer.renderEnabled)}
  await f.run()
  assert.deepEqual(states,[false,false]);assert.equal(viewer.renderEnabled,true)
})
