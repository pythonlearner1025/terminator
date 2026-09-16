import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../lib/core/world.js'
import {PartyGuest} from '../../lib/net/party-guest.js'
import {PartyHost, networkSnapshot} from '../../lib/net/party-host.js'

const Socket = class {}
const input = i => ({move:{x:Math.sin(i)*.7,z:Math.cos(i)*.7},yaw:i/20,pitch:-.1,
  sprint:i%3===0,crouch:i%5===0,jump:i%17===0,reload:i%19===0,fire:i%7===0})

function worlds(t) {
  const result = Array.from({length:3},()=>new World({seed:77}))
  t.after(()=>result.forEach(world=>world.destroy()))
  return result
}

test('prediction-only snapshot matches full restore and pending player prediction across map changes', t => {
  const [source, full, prediction] = worlds(t)
  source.addPlayer({id:'guest-1',name:'Sarah'})
  for(const [i,type] of Object.keys(source.unitCatalog.types).entries())source.spawnUnit(type,{x:10+i,y:0,z:12})
  // Existing full simulation brains must still be released when changing modes.
  const initial=source.snapshot()
  prediction.applySnapshot(initial)
  full.applySnapshot(initial)
  let destroyed=0
  for(const unit of prediction.units) {
    const destroy=unit.brain.destroy.bind(unit.brain)
    unit.brain.destroy=()=>{destroyed++;destroy()}
  }
  prediction.createUnitBrain=()=>{throw Error('prediction-only restore must not create AI')}
  let nav=prediction.nav
  for(let round=0;round<8;round++) {
    if(round===2)source.configureMap({doors:{[source.map.doors[0].id]:'locked'}})
    if(round===4)source.configureMap({break_flank_wall:true})
    if(round===6)source.configureMap({doors:{[source.map.doors[0].id]:'open'}})
    source.step({'guest-1':input(round)})
    const snapshot=JSON.parse(JSON.stringify(source.snapshot()))
    full.applySnapshot(snapshot)
    prediction.applySnapshot(snapshot,{predictOnly:true})
    assert.deepEqual(prediction.nav.blocked,full.nav.blocked)
    assert.deepEqual(prediction.nav.nodes,full.nav.nodes)
    if([2,4,6].includes(round))assert.notEqual(prediction.nav,nav)
    else assert.equal(prediction.nav,nav)
    nav=prediction.nav
    // Several unacknowledged inputs, including collisions/jump/crouch/fire/reload.
    for(let i=0;i<25;i++) {
      full.predictPlayer('guest-1',input(round*25+i))
      prediction.predictPlayer('guest-1',input(round*25+i))
      assert.deepEqual(prediction.getPlayer('guest-1'),full.getPlayer('guest-1'))
    }
    assert.deepEqual(prediction.snapshot(),full.snapshot())
    assert.ok(prediction.units.every(unit=>unit.brain===null))
  }
  assert.equal(destroyed,6)
  // Changing map identity cannot reuse the prior map's navigation.
  prediction.map=structuredClone(source.map)
  prediction.applySnapshot(source.snapshot(),{predictOnly:true})
  assert.notEqual(prediction.nav,nav)
})

test('network snapshot optional omissions preserve detached payload, cursors and authoritative history', t => {
  const [source, expected] = worlds(t)
  source.addPlayer({id:'guest-1'})
  source.spawnUnit('endo',{x:9,y:0,z:12})
  source.step(input(1))
  expected.applySnapshot(source.snapshot())
  source.snapshotEventCursor=expected.snapshotEventCursor=0
  const history=source.replay, telemetry=source.telemetry
  const actual=networkSnapshot(source)
  assert.equal(source.replay,history)
  assert.equal(source.telemetry,telemetry)
  assert.ok(history.length>0)
  assert.equal(Object.hasOwn(actual,'lastInputsBundle'),false)
  assert.equal(Object.hasOwn(actual,'scriptRevisions'),false)
  // Match the old full snapshot then omission contract, including incremental events.
  expected.replay=[]
  expected.telemetry=structuredClone(actual.telemetry)
  const old=expected.snapshot()
  delete old.lastInputsBundle;delete old.scriptRevisions
  assert.deepEqual(actual,old)
  const saved=structuredClone(actual)
  source.player.hp=3
  source.telemetry.shots.pistol={fired:100,hits:90}
  source.units[0].pos.x=88
  assert.deepEqual(actual,saved)
  const snapshot=source.snapshot
  source.snapshot=()=>{throw Error('serialization failed')}
  assert.throws(()=>networkSnapshot(source),/serialization failed/)
  assert.equal(source.replay,history)
  assert.equal(source.telemetry,telemetry)
  source.snapshot=snapshot
})

test('guest interpolation retains exact time/angle math, detached history and unacknowledged replay', t => {
  const [source, reference] = worlds(t)
  source.addPlayer({id:'guest-1'})
  source.spawnUnit('scout',{x:10,y:0,z:12})
  let now=0
  const guest=new PartyGuest({code:'ABC123',WebSocket:Socket,now:()=>now})
  t.after(()=>guest.world?.destroy())
  guest.acceptWelcome({playerId:'guest-1',seed:77,snapshot:source.snapshot(),ack:-1})
  guest.connected=true
  guest.send=()=>{}
  const history=[]
  for(let i=0;i<18;i++) {
    now=i*50
    source.tick=i*3
    source.units[0].pos.x=i
    source.units[0].yaw=i%2?Math.PI-.1:-Math.PI+.1
    source.player.pos.z=i*2
    const snapshot=source.snapshot()
    history.push({at:now,snapshot:structuredClone(snapshot)})
    if(history.length>12)history.shift()
    guest.step(input(i))
    const ack=i-2
    guest.acceptSnapshot({snapshot,acks:{'guest-1':ack}})
    reference.applySnapshot(snapshot)
    for(const pending of guest.pendingInputs)reference.predictPlayer('guest-1',pending.inputs)
    assert.deepEqual(guest.world.getPlayer('guest-1'),reference.getPlayer('guest-1'))
    snapshot.units[0].pos.x=99999
    for(const offset of [-100,0,25,100,250]) {
      const at=now+offset,target=at-100
      let before=history[0],after=before
      for(const entry of history){if(entry.at<=target)before=entry;if(entry.at>=target){after=entry;break}after=entry}
      const span=after.at-before.at,alpha=span>0?Math.max(0,Math.min(1,(target-before.at)/span)):0
      const a=before.snapshot.units[0],b=after.snapshot.units[0]
      let angle=(b.yaw-a.yaw)%(Math.PI*2)
      if(angle>Math.PI)angle-=Math.PI*2
      if(angle< -Math.PI)angle+=Math.PI*2
      guest.interpolate(at)
      assert.deepEqual(guest.world.units[0].pos,{x:a.pos.x+(b.pos.x-a.pos.x)*alpha,y:a.pos.y+(b.pos.y-a.pos.y)*alpha,z:a.pos.z+(b.pos.z-a.pos.z)*alpha})
      assert.equal(guest.world.units[0].yaw,a.yaw+angle*alpha)
      assert.equal(guest.world.getPlayer('player').pos.z, before.snapshot.players.player.pos.z+(after.snapshot.players.player.pos.z-before.snapshot.players.player.pos.z)*alpha)
    }
    assert.equal(guest.snapshotHistory.length,history.length)
  }
  const before=guest.world.tick
  guest.acceptSnapshot({snapshot:{tick:0},ack:9999})
  assert.equal(guest.world.tick,before)
  assert.equal(guest.lastAcknowledgedInputTick,15)
})

test('WebRTC dispatch retains parse validation, input normalization, deduplication and trusted peer identity', t => {
  const [world]=worlds(t)
  const host=new PartyHost({world,WebSocket:Socket})
  world.addPlayer({id:'guest-1'})
  host.guestsByPeer.set('trusted','guest-1')
  host.receivePeer({peerId:'unknown',data:JSON.stringify({type:'input',peerId:'trusted',tick:0,inputs:input(0)})})
  assert.equal(host.latestInputs.size,0)
  for(const data of ['{','[]','null','{}','{"type":3}'])host.receivePeer({peerId:'trusted',data})
  assert.equal(host.latestInputs.size,0)
  host.receivePeer({peerId:'trusted',data:JSON.stringify({type:'input',peerId:'forged',tick:7,inputs:{move:{x:'1',z:'bad'},fire:true}})})
  assert.equal(host.latestInputs.get('guest-1').tick,7)
  assert.deepEqual(host.latestInputs.get('guest-1').inputs.move,{x:1,z:0})
  host.receivePeer({peerId:'trusted',data:JSON.stringify({type:'input',tick:7,inputs:{fire:false}})})
  assert.equal(host.latestInputs.get('guest-1').inputs.fire,true)
})
