import test from 'node:test'
import assert from 'node:assert/strict'
import {scheduleMenuPreparation} from '../../lib/ui/menu-preload.js'
import {createStartupProfile} from '../../lib/ui/startup-profile.js'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const {UiSession}=await import('../../lib/ui/session.js')
const {Hud}=await import('../../lib/ui/hud.js')
const {LobbyClient}=await import('../../lib/net/lobby-client.js')
test('public menu opens built-in Skynet without a probe, error or premature match',async t=>{
  const previousLocation=globalThis.location
  globalThis.location=new URL('https://terminator.app.blitz.dev/')
  t.after(()=>{if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation})
  const requests=t.mock.method(globalThis,'fetch',async()=>{throw Error('unexpected probe')})
  let starts=0
  const world={skynet:{name:'BUILT-IN',connected:false}}
  const director={phase:'lobby',start(){starts++;this.phase='wave'},beginWave(){}}
  const lobby=new LobbyClient({world,director})
  assert.equal(lobby.serverUrl,'')
  const session={manager:{world,director,lobby}}
  try {
    UiSession.prototype.openLobby.call(session)
    await new Promise(resolve=>setImmediate(resolve))
    const snapshot=UiSession.prototype.lobbySnapshot.call(session)
    assert.equal(snapshot.status,'Built-in Skynet is ready.')
    assert.equal(snapshot.error,null)
    assert.equal(requests.mock.callCount(),0)
    assert.equal(starts,0)
    lobby.beginMatch()
    assert.equal(starts,1)
  } finally {session.lobbyDifficulty?.dispose();lobby.stop()}
})
test('stopped menu never runs scheduled preparation; a live menu prepares once', () => {
  let id=0,runs=0
  const jobs=new Map()
  globalThis.requestAnimationFrame=fn=>{jobs.set(++id,fn);return id}
  globalThis.cancelAnimationFrame=key=>jobs.delete(key)
  globalThis.requestIdleCallback=globalThis.requestAnimationFrame
  globalThis.cancelIdleCallback=globalThis.cancelAnimationFrame
  const flush=()=>{for(const [id,fn] of [...jobs]){jobs.delete(id);fn()}}
  const cancel=scheduleMenuPreparation(()=>runs++)
  flush();cancel();flush();assert.equal(runs,0)
  scheduleMenuPreparation(()=>runs++)
  flush();flush();flush();assert.equal(runs,1)
  delete globalThis.requestIdleCallback;delete globalThis.cancelIdleCallback
})
test('repeated start requests share readiness and allow a subsequent retry', async () => {
  const gate=Promise.withResolvers();let calls=0
  const session={prepareMatch(){calls++;return gate.promise}}
  const first=UiSession.prototype.startMatch.call(session),second=UiSession.prototype.startMatch.call(session)
  assert.equal(first,second);assert.equal(calls,1)
  gate.reject(Error('503'));await assert.rejects(first,/503/)
  session.prepareMatch=async()=>{calls++;return 'ready'}
  assert.equal(await UiSession.prototype.startMatch.call(session),'ready');assert.equal(calls,2)
})
test('enemy plates are removed before projection and no new enemy DOM is created', () => {
  let removed=0,projected=0
  const hud={plates:new Map([['old-enemy',{remove(){removed++}}]]),project(){projected++;throw Error('enemy projected')}}
  const input=[{id:'old-enemy',label:'T-800',hp:50,pos:{x:0,y:0,z:0}},{id:'new-enemy',label:'HK-Tank',hp:6000}]
  Hud.prototype.renderNameplates.call(hud,input)
  assert.equal(removed,1);assert.equal(projected,0);assert.equal(hud.plates.size,0)
  assert.equal(input[0].hp,50);assert.equal(input[1].hp,6000)
})
test('profile executes void work once and records failures', async () => {
  const p=createStartupProfile();let calls=0
  p.measure('sync',()=>{calls++})
  await assert.rejects(p.measure('async',()=>Promise.reject(Error('asset'))),/asset/)
  assert.equal(calls,1);assert.equal(p.spans[1].status,'failed')
})
const {GameManager}=await import('../../scripts/GameManager.script.js')
test('synchronous view-construction failure restores the map and stops partial views', () => {
  const stopped=[]
  const manager={world:{},startup:createStartupProfile(),prepareMap(){},mapView:{startEffects(){},stop(){stopped.push('map')}},
    unitView:{start(){throw Error('missing authored template')},stop(){stopped.push('units')}},
    playerView:{stop(){stopped.push('player')}},grenadeView:{stop(){stopped.push('grenades')}}}
  assert.throws(()=>GameManager.prototype.startViews.call(manager),/missing authored template/)
  assert.equal(manager.viewsStarted,false)
  assert.equal(manager.warmupAbort.signal.aborted,true)
  assert.deepEqual(stopped,['grenades','player','units','map'])
})
