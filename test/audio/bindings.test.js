import test from 'node:test'
import assert from 'node:assert/strict'
import {AudioBindings,DIRECTOR_INTENSITY,EXTRACTION_BEACON_TAG,musicIntensity} from '../../lib/audio/bindings.js'
import {SOUND_CATALOG} from '../../lib/audio/catalog.js'

// Records every engine call the bindings make. The real WebAudioEngine needs a
// browser context; the contract under test is which cue plays for which event.
function fakeEngine() {
  return {
    context:{state:'running',currentTime:0},loading:false,loops:new Map(),intensity:null,combat:false,
    played:[],loopsStarted:[],loopsStopped:[],ducks:[],intensities:[],
    start(){},stop(){},speak(){return null},updateListener(){},updateEnvironment(){},updateLoopPosition(){},
    play(name,options){this.played.push({name,options});return {}},
    startLoop(name,options={}){this.loopsStarted.push({name,tag:options.tag});return {}},
    stopLoop(tag){this.loopsStopped.push(tag);return true},
    duckMusic(amount,duration){this.ducks.push({amount,duration})},
    setIntensity(value){this.intensity=value;this.intensities.push(value)},
    setCombatActive(active){this.combat=Boolean(active)},
  }
}

function fakeWorld(extra={}) {
  const player={id:'player',pos:{x:0,y:0,z:0},hp:100,alive:true,activeWeapon:'pistol',reloadTimer:0,ammo:{pistol:{mag:6}}}
  return {
    tick:0,time:0,wave:1,phase:'wave',eventLog:[],units:[],replay:[],transmission:'',
    player,hostPlayerId:'player',players:new Map([[player.id,player]]),getPlayer(id){return this.players.get(id)},
    unitById:new Map(),unitCatalog:{types:{heavy:{spinUp:1}}},...extra,
  }
}

function bind(world,engine) {
  const bindings=new AudioBindings({world,engine,ownsEngine:false})
  bindings.start(world)
  return bindings
}

test('mob_incoming plays the horde stinger and ducks the music', () => {
  const engine=fakeEngine(),world=fakeWorld()
  const bindings=bind(world,engine)
  world.eventLog.push({type:'mob_incoming',size:12,spotId:'N1',behind:true,pos:{x:4,y:0,z:9}})
  bindings.sync(world)
  const stinger=engine.played.find(call=>call.name==='horde_stinger')
  assert.ok(stinger,`horde_stinger never played: ${engine.played.map(call=>call.name).join(',') || 'nothing'}`)
  assert.deepEqual(stinger.options.position,{x:4,y:0,z:9})
  assert.equal(engine.ducks.length,1,'the stinger ducks the music once')
  assert.ok(engine.ducks[0].amount<1,'ducking lowers the music bus')
  bindings.stop()
})

test('director states set music intensity and a world without a director keeps the old formula', () => {
  const engine=fakeEngine(),world=fakeWorld()
  const bindings=bind(world,engine)
  bindings.sync(world)
  const fallback=Math.min(1,0/24*0.75+1/40)
  assert.equal(engine.intensity,fallback,'no director keeps the alive-unit estimate')
  assert.equal(musicIntensity(world),fallback)
  const seen=[]
  for(const state of ['relax','build_up','sustain_peak','peak_fade']) {
    world.director={state,intensity:0.5,reservoir:100,reservoirMax:400}
    bindings.sync(world)
    seen.push(engine.intensity)
    assert.equal(engine.intensity,DIRECTOR_INTENSITY[state],state)
  }
  const [relax,build,peak,fade]=seen
  assert.ok(relax<build && build<peak,'relax is low, build_up is mid, sustain_peak is high')
  assert.ok(fade>build,'peak_fade stays high')
  bindings.stop()
})

test('every director verb has its own cue and the beacon loop starts and stops', () => {
  const engine=fakeEngine(),world=fakeWorld()
  const bindings=bind(world,engine)
  world.eventLog.push(
    {type:'special_dispatched',unitType:'endo',unitId:'u1',pos:{x:1,y:0,z:1}},
    {type:'special_dispatched',unitType:'heavy',unitId:'u2',pos:{x:2,y:0,z:1}},
    {type:'special_dispatched',unitType:'hkaerial',unitId:'u3',pos:{x:3,y:0,z:1}},
    {type:'special_dispatched',unitType:'t1000',unitId:'u4',pos:{x:4,y:0,z:1}},
    {type:'stragglers_enraged',count:2},
    {type:'cache_taken',id:'c1',kind:'ammo',playerId:'player',pos:{x:5,y:0,z:1}},
    {type:'extraction',phase:'announced',pos:{x:0,y:0,z:-20},t:0},
  )
  bindings.sync(world)
  const names=engine.played.map(call=>call.name)
  for(const name of ['servo_endo','heavy_stomp','aerial_whine','t1000_shimmer','skynet_static','cache_pickup']) {
    assert.ok(names.includes(name),`${name} never played: ${names.join(',')}`)
  }
  assert.deepEqual(engine.loopsStarted,[{name:'extraction_beacon',tag:EXTRACTION_BEACON_TAG}])
  world.eventLog.push({type:'extraction',phase:'complete',pos:{x:0,y:0,z:-20},t:1})
  bindings.sync(world)
  assert.ok(engine.loopsStopped.includes(EXTRACTION_BEACON_TAG),'complete stops the beacon')
  bindings.stop()
})

test('the new director sounds exist in the catalog with variations', () => {
  for(const name of ['horde_stinger','aerial_whine','t1000_shimmer','cache_pickup','extraction_beacon']) {
    const definition=SOUND_CATALOG[name]
    assert.ok(definition,`${name} is missing from the catalog`)
    assert.ok(definition.variants.length>=2,`${name} needs at least two variations`)
  }
  assert.ok(SOUND_CATALOG.extraction_beacon.loop,'the extraction beacon is a loop')
  for(const variant of SOUND_CATALOG.horde_stinger.variants) {
    assert.ok(variant.duration>=1.8 && variant.duration<=2.2,`horde_stinger runs about two seconds, got ${variant.duration}`)
  }
})
