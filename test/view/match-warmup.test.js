import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.window ??= {}
globalThis.ImageData ??= class {}
globalThis.WebGLRenderingContext ??= class {}
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)
globalThis.cancelAnimationFrame = clearTimeout
const {warmupMatch} = await import('../../lib/view/match-warmup.js')
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture() {
  const controller = new AbortController(), events = []
  const object = {isMesh:true, isInstancedMesh:true, count:0, visible:false, frustumCulled:true}
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
