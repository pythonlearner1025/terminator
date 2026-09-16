import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../lib/core/world.js'
import {WaveDirector} from '../../lib/core/waves.js'
import {PartyHost} from '../../lib/net/party-host.js'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
globalThis.requestAnimationFrame ??= ()=>1
const {GameManager}=await import('../../scripts/GameManager.script.js')
const {CameraFeel}=await import('../../lib/view/camera-feel.js')

for(const sessionMode of ['single','host','guest'])test(`${sessionMode} manager keeps input and fixed-step clocks running through headshot feedback`, t => {
  const world=new World({seed:2029,brains:{scout:{tick(){}}}})
  t.after(()=>world.destroy())
  const director=new WaveDirector(world)
  director.start({spawns:[{t:0,gate:'N1',unit:'scout',count:1}],knobs:{gates:['N1'],doors:{},lights:{},fog:0,hazards:[],break_flank_wall:false}})
  const feel=new CameraFeel()
  // The hold is a setting now, and it ships off. Turn it on for this case.
  feel.hitStopEnabled=true
  world.emit('shot',{by:'player',weapon:'pistol',hit:true,headshot:true,killed:true})
  world.emit('kill',{headshot:true,playerId:'player',unitId:'fixture',unitType:'scout'})
  let sampled=0,rendered=0,guestSteps=0
  const party=sessionMode==='host'?new PartyHost({world,director,WebSocket:class {}}):{step(inputs){guestSteps++;world.predictPlayer('player',inputs)}}
  const manager=Object.assign(Object.create(GameManager.prototype),{started:true,world,director,cameraFeel:feel,party,sessionMode,
    accumulator:0,ui:{frozen:false,sample(){sampled++;return {move:{x:.2,z:.2}}}},syncViews(){rendered++},lobby:null})
  manager.update({deltaTime:50})
  assert.equal(feel.headshotKills,1)
  const window=feel.freezeUntil-performance.now()
  assert.ok(window>0 && window<=40,`the headshot kill arms a 40 ms hit-stop, got ${window}`)
  // Hold the window open so the clock assertions never race the 40 ms timer.
  feel.freezeUntil=performance.now()+5000
  manager.update({deltaTime:50})
  assert.equal(sampled,6)
  assert.equal(sessionMode==='guest'?guestSteps:world.tick,6,'the simulation clock runs through the hit-stop')
  assert.equal(rendered,0,'the hit-stop holds presentation only')
  assert.equal(feel.shots,1)
  assert.ok(feel.velocity>0,'shot recoil still consumed')
  if(sessionMode==='host')assert.equal(party.messageCounts.sent.snapshot,2,'normal authoritative 20Hz schedule continues')
  // The window closes. Presentation resumes and the clocks never had to catch up.
  feel.freezeUntil=0
  manager.update({deltaTime:50})
  assert.equal(sampled,9)
  assert.equal(sessionMode==='guest'?guestSteps:world.tick,9)
  assert.equal(rendered,1,'presentation resumes when the window closes')
  if(sessionMode==='host')assert.equal(party.messageCounts.sent.snapshot,3)
  const ticks=world.tick
  manager.ui.frozen=true
  manager.syncUi=()=>{}
  manager.update({deltaTime:50})
  assert.equal(world.tick,ticks,'explicit UI pause still freezes as before')
  assert.equal(sampled,9)
})

test('the hit-stop setting ships off, so a headshot kill never holds presentation', t => {
  const world=new World({seed:2029,brains:{scout:{tick(){}}}})
  t.after(()=>world.destroy())
  const director=new WaveDirector(world)
  director.start({spawns:[{t:0,gate:'N1',unit:'scout',count:1}],knobs:{gates:['N1'],doors:{},lights:{},fog:0,hazards:[],break_flank_wall:false}})
  const feel=new CameraFeel()
  assert.equal(feel.hitStopEnabled,false,'default off')
  world.emit('kill',{headshot:true,playerId:'player',unitId:'fixture',unitType:'scout'})
  let rendered=0
  const manager=Object.assign(Object.create(GameManager.prototype),{started:true,world,director,cameraFeel:feel,
    party:null,sessionMode:'single',accumulator:0,ui:{frozen:false,sample:()=>({move:{x:0,z:0}})},syncViews(){rendered++},lobby:null})
  manager.update({deltaTime:50})
  assert.equal(feel.headshotKills,1,'the kill is still counted')
  assert.equal(feel.freezeUntil,0,'no presentation hold is armed')
  assert.equal(feel.hitStopped,false)
  assert.equal(rendered,1,'the frame renders instead of repeating the last one')
})
