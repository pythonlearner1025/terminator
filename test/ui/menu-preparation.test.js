import test from 'node:test'
import assert from 'node:assert/strict'
import {access} from 'node:fs/promises'
import {createMenuAssetQueue,MENU_IMAGE_ASSETS,MENU_BINARY_ASSETS,warmMenuAsset} from '../../lib/ui/menu-preload.js'
import {createStartupProfile} from '../../lib/ui/startup-profile.js'

globalThis.ImageData ??= class {}
globalThis.window ??= {}
const {UiSession}=await import('../../lib/ui/session.js')
const {GameManager}=await import('../../scripts/GameManager.script.js')
const settle=()=>new Promise(resolve=>setImmediate(resolve))
function scheduler(){
  const jobs=new Set()
  return {schedule(fn){jobs.add(fn);return ()=>jobs.delete(fn)},flush(){for(const fn of [...jobs]){jobs.delete(fn);fn()}},jobs}
}

test('asset manifest contains only existing, unique project assets',async()=>{
  const assets=[...MENU_IMAGE_ASSETS,...MENU_BINARY_ASSETS]
  assert.equal(new Set(assets).size,assets.length)
  assert.equal(assets.length,47)
  await Promise.all(assets.map(url=>access(new URL(url))))
})
test('optional queue bounds concurrency, yields between assets and promotes without a readiness gate',async()=>{
  const clock=scheduler(),gates=[],signals=[]
  const queue=createMenuAssetQueue({assets:['a','b','c','d','e','f'],concurrency:99,schedule:clock.schedule,
    load:(url,{signal})=>{signals.push(signal);const gate=Promise.withResolvers();gates.push(gate);return gate.promise}})
  queue.start();queue.start();assert.equal(clock.jobs.size,3)
  clock.flush();await settle();assert.equal(queue.stats.active,3)
  gates[0].resolve();await settle();assert.equal(gates.length,3);assert.equal(clock.jobs.size,1)
  queue.promote();clock.flush();assert.equal(clock.jobs.size,0)
  gates[1].resolve();gates[2].resolve();await settle()
  assert.equal(queue.stats.completed,3);assert.equal(queue.stats.started,3)
  assert.equal(queue.stats.active,0);assert.equal(signals[0].aborted,false)
  queue.dispose();assert.equal(signals[0].aborted,true)
})
test('Stop aborts owned loads, clears scheduled jobs and observes late rejections',async()=>{
  const clock=scheduler(),gate=Promise.withResolvers();let signal,errors=0
  const queue=createMenuAssetQueue({assets:['a','b'],schedule:clock.schedule,concurrency:1,
    load:(_url,options)=>{signal=options.signal;return gate.promise},onError:()=>errors++})
  queue.start();clock.flush();await settle();queue.dispose()
  assert.equal(signal.aborted,true)
  gate.reject(Error('late network failure'));await settle();clock.flush()
  assert.equal(errors,0);assert.equal(queue.stats.started,1);assert.equal(clock.jobs.size,0)
})
test('an optional asset failure does not poison the next queue or block remaining hints',async()=>{
  const clock=scheduler();let failures=0
  const queue=createMenuAssetQueue({assets:['a','b'],schedule:clock.schedule,concurrency:1,
    load:async url=>{if(url==='a')throw Error('503')},onError:()=>failures++})
  queue.start();clock.flush();await settle();clock.flush();await settle()
  assert.equal(failures,1);assert.equal(queue.stats.failed,1);assert.equal(queue.stats.completed,1)
  queue.dispose()
  const retry=createMenuAssetQueue({assets:['a'],schedule:clock.schedule,load:async()=>{}})
  retry.start();clock.flush();await settle();assert.equal(retry.stats.completed,1);retry.dispose()
})
test('image warming uses decode and releases its image on completion and cancellation',async t=>{
  const images=[]
  class FakeImage {
    constructor(){images.push(this);this.gate=Promise.withResolvers()}
    decode(){return this.gate.promise}
    removeAttribute(name){assert.equal(name,'src');this.removed=true;this.gate.reject(Error('decode cancelled'))}
  }
  const previous=globalThis.Image;globalThis.Image=FakeImage
  t.after(()=>{if(previous===undefined)delete globalThis.Image;else globalThis.Image=previous})
  const abort=new AbortController()
  const loaded=warmMenuAsset('https://test.invalid/a.png',{signal:abort.signal})
  assert.equal(images[0].fetchPriority,'low');assert.equal(images[0].crossOrigin,'anonymous')
  images[0].gate.resolve();await loaded;assert.equal(images[0].removed,true)
  const stopped=warmMenuAsset('https://test.invalid/b.jpg',{signal:abort.signal})
  abort.abort();await assert.rejects(stopped);assert.equal(images[1].removed,true)
})
test('HDR warming drains low-priority responses and preserves loader ownership',async t=>{
  let options,reads=0,released=0
  t.mock.method(globalThis,'fetch',async(_url,opts)=>{options=opts;return {ok:true,body:{getReader:()=>({read:async()=>({done:++reads===3}),releaseLock:()=>released++})}}})
  const signal=new AbortController().signal
  await warmMenuAsset('https://test.invalid/sky.hdr',{signal})
  assert.deepEqual(options,{signal,cache:'force-cache',priority:'low'})
  assert.equal(reads,3);assert.equal(released,1)
})
test('input telemetry includes controls/menu waiting and keeps missing clicks distinct',t=>{
  let now=100
  t.mock.method(performance,'now',()=>now)
  t.mock.method(performance,'getEntriesByType',()=>[{startTime:0}])
  const p=createStartupProfile()
  now=300;p.beginMatch('dom-start-click',299)
  now=1400;p.beginMatch('solo-request') // controls card took 1.1 seconds
  now=2300;p.mark('match-ready')
  assert.equal(p.attempt.status,'preparing')
  now=2310;p.inputReady()
  assert.equal(p.attempt.clickToInputReadyMs,2011)
  assert.equal(p.attempt.navigationToInputReadyMs,2310)
  assert.equal(p.attempt.managerToInputReadyMs,2210)
  now=2400;p.inputReady();assert.equal(p.attempt.inputReadyAt,2310)
  now=2500;p.beginMatch('party-remote-request');now=2800;p.inputReady()
  assert.equal(p.attempt.clickToInputReadyMs,null)
  assert.equal(p.attempt.requestToInputReadyMs,300)
  now=2900;p.beginMatch('dom-start-click',2899);p.failMatch(Error('503'))
  now=3000;p.beginMatch('dom-start-click',2999);assert.equal(p.attempt.clickAt,2999)
  p.cancelMatch();assert.equal(p.attempt.status,'cancelled')
})
test('solo Start stays behind real warmup while optional preparation does not gate it',async()=>{
  const gate=Promise.withResolvers(),events=[]
  const manager={startup:createStartupProfile(),startViews(){events.push('views')},
    visualWarmup:gate.promise,releaseLoadRender:null,lobby:{active:true,beginMatch(){events.push('wave')}}}
  const session={active:true,manager,menuScene:{setActive:value=>events.push(['menu',value])},
    promotePreparation(){events.push('promote')}}
  // Audio's normal module needs a browser engine; intercept only that named
  // readiness span while retaining the real visual readiness promise.
  const measure=manager.startup.measure
  manager.startup.measure=(name,work)=>name==='audio-ready'?Promise.resolve():measure(name,work)
  const pending=UiSession.prototype.prepareMatch.call(session)
  await settle();assert.deepEqual(events,['promote',['menu',false],'views'])
  gate.resolve({textures:1});await pending
  assert.equal(events.at(-1),'wave')
  assert.equal(manager.startup.attempt.status,'preparing') // input still not active
})
test('Stop before readiness cannot launch a wave, and a retry consumes new readiness',async()=>{
  let waves=0
  const gate=Promise.withResolvers(),manager={startup:createStartupProfile(),startViews(){},visualWarmup:gate.promise,
    lobby:{active:true,beginMatch(){waves++}}}
  manager.startup.measure=(name,work)=>name==='audio-ready'?Promise.resolve():work()
  const session={active:true,manager,promotePreparation(){},menuScene:{setActive(){}}}
  const pending=UiSession.prototype.prepareMatch.call(session)
  session.active=false;gate.resolve({cancelled:true});await assert.rejects(pending,{name:'AbortError'});assert.equal(waves,0)
  session.active=true;manager.visualWarmup=Promise.resolve({textures:2})
  await UiSession.prototype.prepareMatch.call(session);assert.equal(waves,1)
})
test('stopping views clears stale party warmup before retry',()=>{
  const abort=new AbortController(),manager={warmupAbort:abort,visualWarmup:Promise.resolve(),visualWarmupReport:{},viewsStarted:false}
  GameManager.prototype.stopViews.call(manager)
  assert.equal(abort.signal.aborted,true);assert.equal(manager.visualWarmup,null);assert.equal(manager.visualWarmupReport,null)
})
test('returning to main cancels pending guest preparation before restoring menu presentation',()=>{
  const order=[],abort=new AbortController()
  const manager={startup:createStartupProfile(),warmupAbort:abort,viewsStarted:true,
    party:{cancelPreparing(){order.push('party')}},
    stopViews(){abort.abort();order.push('camera')},mapView:{stop(){order.push('map')}}}
  manager.startup.beginMatch('party-remote-request')
  UiSession.prototype.cancelMatchPreparation.call({manager})
  assert.equal(abort.signal.aborted,true)
  assert.deepEqual(order,['party','camera','map'])
  assert.equal(manager.startup.attempt.status,'cancelled')
})
test('a guest warmup that finishes after leaving never sends loaded',async()=>{
  const listeners=new Map(),gate=Promise.withResolvers();let loaded=0
  const party={on(name,fn){listeners.set(name,fn);return ()=>{}},loaded(){loaded++}}
  const manager={started:true,world:{},party,partyOffs:[],startup:createStartupProfile(),
    ui:{preparePartyMatch(){}},startViews(){this.warmupAbort=new AbortController();this.visualWarmup=gate.promise},
    _acceptPartyState(){},_setPartyState(){throw Error('unexpected state error')}}
  // prepareAudio returns immediately once the injected audio engine is absent
  // only after frames; provide a frame scheduler that runs its finite polling.
  const previous=globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame=fn=>setImmediate(fn)
  try {
    GameManager.prototype._bindParty.call(manager,party,'guest')
    listeners.get('match-prepare')()
    assert.equal(manager.startup.attempt.trigger,'party-remote-request')
    manager.warmupAbort.abort();manager.party=null
    gate.resolve({cancelled:true})
    for(let i=0;i<125;i++)await settle()
    assert.equal(loaded,0)
  } finally {
    if(previous===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previous
  }
})
test('manager shares pending lighting preparation and Stop isolates a retry from late failure',async()=>{
  const manager=new GameManager(),gates=[]
  manager.startup={measure(){const gate=Promise.withResolvers();gates.push(gate);return gate.promise}}
  const first=manager.prepareMenuAssets(),again=manager.prepareMenuAssets()
  assert.equal(first,again);assert.equal(gates.length,1)
  const oldSignal=manager.menuAssetsAbort.signal
  manager.stop();assert.equal(oldSignal.aborted,true);assert.equal(manager.menuAssets,null)
  const retry=manager.prepareMenuAssets()
  gates[0].reject(Error('old request'));await assert.rejects(first,/old request/);await settle()
  assert.equal(manager.menuAssets,retry);assert.equal(manager.menuPreparationError,null)
  gates[1].resolve({sky:{}});await retry
  assert.equal(manager.prepareMenuAssets(),retry)
  manager.stop()
})
test('menu readiness does not wait for background assets or take the gameplay camera',async t=>{
  const previousLocation=globalThis.location,previousFrame=globalThis.requestAnimationFrame,previousCancel=globalThis.cancelAnimationFrame
  const frames=new Map();let next=0
  globalThis.location=new URL('https://terminator.app.blitz.dev/')
  globalThis.requestAnimationFrame=fn=>{frames.set(++next,fn);return next}
  globalThis.cancelAnimationFrame=id=>frames.delete(id)
  t.after(()=>{
    for(const [key,value] of [['location',previousLocation],['requestAnimationFrame',previousFrame],['cancelAnimationFrame',previousCancel]]) {
      if(value===undefined)delete globalThis[key];else globalThis[key]=value
    }
  })
  const menu=Promise.withResolvers(),assets=Promise.withResolvers(),shown=[]
  const camera={name:'menu camera'},manager={startup:createStartupProfile(),viewsStarted:false,
    prepareMenuAssets(){return assets.promise},prepareMap(){throw Error('batching ran before paint')},
    startViews(){throw Error('gameplay camera taken in menu')},ctx:{viewer:{scene:{mainCamera:camera}}}}
  const session=Object.assign(Object.create(UiSession.prototype),{active:true,manager,
    screens:{show:route=>shown.push(route),loadingScreen(){}},menuScene:{load:()=>menu.promise}})
  const loading=session.loadMenu()
  assert.deepEqual(shown,['loading'])
  assert.equal(session.assetQueue.stats.started,0)
  menu.resolve();await loading
  assert.deepEqual(shown,['loading','main'])
  assert.equal(manager.ctx.viewer.scene.mainCamera,camera)
  assert.equal(manager.viewsStarted,false)
  session.cancelPreparation();session.assetQueue.dispose();assets.resolve()
  assert.equal(frames.size,0)
})
test('DOM capture measures actual Start rather than party creation or disabled buttons',()=>{
  const clicks=[],session={manager:{startup:{beginMatch:(...args)=>clicks.push(args)}},screens:{party:{state:null}}}
  const event={timeStamp:123,target:{closest:()=>button}}
  const button={disabled:false,dataset:{action:'party-start'}}
  UiSession.prototype.recordStartClick.call(session,event);assert.equal(clicks.length,0)
  session.screens.party.state={code:'ABC123',status:'lobby'}
  UiSession.prototype.recordStartClick.call(session,event)
  assert.deepEqual(clicks,[['dom-start-click',123]])
  button.disabled=true;UiSession.prototype.recordStartClick.call(session,event);assert.equal(clicks.length,1)
  button.disabled=false;button.dataset.action='start-match';event.timeStamp=456
  UiSession.prototype.recordStartClick.call(session,event);assert.deepEqual(clicks[1],['dom-start-click',456])
})
