import test from 'node:test'
import assert from 'node:assert/strict'
import {SkynetVoice,TAUNT_INTERVAL_SECONDS,hottestZone,mountSkynetVoice,zoneAt} from '../../lib/ui/skynet-voice.js'
import {HEATMAP_CELL_METERS} from '../../lib/core/telemetry.js'

const BOUNDS={minX:-42,maxX:42,minZ:-30,maxZ:30}
function fakeWorld(time=0) {
  return {time,transmission:'RESISTANCE SIGNAL ACQUIRED',eventLog:[],map:{bounds:BOUNDS}}
}
// Heatmap keys count cells from the map's minimum corner, as World.sampleTelemetry does.
function cellKey(x,z) {
  return `${Math.floor((x-BOUNDS.minX)/HEATMAP_CELL_METERS)}:${Math.floor((z-BOUNDS.minZ)/HEATMAP_CELL_METERS)}`
}
function speak(events,time=1000) {
  const world=fakeWorld(time)
  const voice=new SkynetVoice(world)
  const lines=[]
  for(const event of events) {
    world.eventLog.push(event)
    const before=world.transmission
    voice.consume(world)
    if(world.transmission!==before)lines.push(world.transmission)
  }
  return lines
}

test('every director verb writes its own taunt and silent events write nothing', () => {
  const spaced=(type,extra,index)=>({type,t:index*TAUNT_INTERVAL_SECONDS*2,...extra})
  const cases=[
    [{type:'mob_incoming',behind:true},'POSITION KNOWN. UNITS REROUTED.'],
    [{type:'mob_incoming',behind:false},'UNITS INBOUND.'],
    [{type:'special_dispatched',unitType:'t1000'},'T-1000 DISPATCHED.'],
    [{type:'deck_card',card:'lights_out',phase:'fired'},'LIGHTS ARE MINE.'],
    [{type:'stragglers_enraged',count:3},'FINISH THEM.'],
    [{type:'extraction',phase:'announced'},'EXTRACTION SIGNAL DETECTED.'],
    [{type:'extraction',phase:'arrived'},'ALL UNITS. TERMINATE.'],
  ]
  const events=cases.map(([event],index)=>spaced(event.type,event,index))
  assert.deepEqual(speak(events),cases.map(([,line])=>line))
  const quiet=[{type:'special_dispatched',unitType:'endo',t:0},{type:'deck_card',card:'fog',phase:'fired',t:40},{type:'deck_card',card:'lights_out',phase:'dealt',t:60},
    {type:'extraction',phase:'complete',t:80},{type:'kill',unitType:'scout',t:120}]
  assert.deepEqual(speak(quiet),[],'only the table triggers a line')
})

test('at most one line every eight seconds, and the clock restarts after the gap', () => {
  const world=fakeWorld()
  const voice=new SkynetVoice(world)
  world.eventLog.push({type:'mob_incoming',behind:false,t:0})
  voice.consume(world)
  assert.equal(world.transmission,'UNITS INBOUND.')
  world.eventLog.push({type:'stragglers_enraged',t:TAUNT_INTERVAL_SECONDS-0.1})
  voice.consume(world)
  assert.equal(world.transmission,'UNITS INBOUND.','a line inside the window is dropped, not queued')
  world.eventLog.push({type:'stragglers_enraged',t:TAUNT_INTERVAL_SECONDS})
  voice.consume(world)
  assert.equal(world.transmission,'FINISH THEM.')
  world.eventLog.push({type:'deck_card',card:'lights_out',phase:'fired',t:TAUNT_INTERVAL_SECONDS+7.9})
  voice.consume(world)
  assert.equal(world.transmission,'FINISH THEM.','the window runs from the line that played')
  world.eventLog.push({type:'deck_card',card:'lights_out',phase:'fired',t:TAUNT_INTERVAL_SECONDS*2})
  voice.consume(world)
  assert.equal(world.transmission,'LIGHTS ARE MINE.')
})

test('the camp line names the hottest cell zone and its share of the wave', () => {
  const summary={type:'wave_summary',wave:3,t:500,heatmap_cell_meters:HEATMAP_CELL_METERS,heatmap:{
    [cellKey(0,0)]:40,[cellKey(4,-6)]:20,[cellKey(23,-4)]:12,[cellKey(0,22)]:8,
  }}
  assert.deepEqual(speak([summary]),['CAMPED COURTYARD 75%. ADJUSTING.'])
  assert.deepEqual(hottestZone(summary,BOUNDS),{zone:'courtyard',percent:75})
  const dock={...summary,heatmap:{[cellKey(23,-4)]:30,[cellKey(0,0)]:10}}
  assert.deepEqual(speak([dock]),['CAMPED DOCK 75%. ADJUSTING.'])
  const tunnel={...summary,heatmap:{[cellKey(-24,0)]:9,[cellKey(0,0)]:3}}
  assert.deepEqual(speak([tunnel]),['CAMPED TUNNEL 75%. ADJUSTING.'])
  assert.deepEqual(speak([{...summary,heatmap:{}}]),[],'an empty heatmap says nothing')
})

test('zones cover the named rooms and call open ground the yard', () => {
  assert.equal(zoneAt({x:0,z:0}),'courtyard')
  assert.equal(zoneAt({x:0,z:22}),'building')
  assert.equal(zoneAt({x:23,z:-4}),'dock')
  assert.equal(zoneAt({x:-24,z:0}),'tunnel')
  assert.equal(zoneAt({x:32,z:12}),'barracks')
  assert.equal(zoneAt({x:-38,z:-26}),'yard')
})

test('mounting reuses one voice per world and a new world resets the cursor', () => {
  const manager={world:fakeWorld()}
  manager.world.eventLog.push({type:'mob_incoming',behind:true,t:0})
  const first=mountSkynetVoice(manager)
  assert.equal(manager.world.transmission,'POSITION KNOWN. UNITS REROUTED.')
  assert.equal(mountSkynetVoice(manager),first,'the same world keeps the same voice')
  manager.world=fakeWorld()
  manager.world.eventLog.push({type:'stragglers_enraged',t:0})
  const second=mountSkynetVoice(manager)
  assert.notEqual(second,first,'a new match builds a new voice')
  assert.equal(manager.world.transmission,'FINISH THEM.','the rate limit does not carry into a new match')
  assert.equal(mountSkynetVoice({}),null)
})
