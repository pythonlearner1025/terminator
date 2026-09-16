import assert from 'node:assert/strict'
import test from 'node:test'
import {presentationSnapshot,scoreboardSnapshot} from '../../lib/ui/presentation.js'
import * as reference from './fixtures/presentation-reference.js'
import {World} from '../../lib/core/world.js'
import {WaveDirector} from '../../lib/core/waves.js'
import {networkSnapshot} from '../../lib/net/party-host.js'

const director={spawnSchedule:[],nextSpawn:0,phase:'combat'}
function fixture() {
  const player={id:'player',name:'Host',scrap:20,connected:true,alive:true,sprintStamina:6,pos:{x:0,z:0},yaw:0,ammo:{},armor:50,grenades:2}
  return {player,hostPlayerId:player.id,players:new Map([[player.id,player]]),getPlayer(id){return this.players.get(id)},eventLog:[],aliveUnits:[],map:{trader:{pos:{x:1,z:2}}},unitCatalog:{types:{scout:{scrap:0.1},endo:{scrap:0.2}}},weaponCatalog:{slots:[],weapons:{}},phase:'combat',wave:1,time:2}
}
function compare(world,label='') {
  for(const id of [...world.players.keys(),'missing'])assert.deepEqual(presentationSnapshot(world,director,id),reference.presentationSnapshot(world,director,id),label)
  assert.deepEqual(scoreboardSnapshot(world),reference.scoreboardSnapshot(world),label)
}
function combat(id='player',wave=1) {
  return [
    {type:'kill',playerId:id,unitType:'scout',wave},
    {type:'shot',by:id,hit:true},
    {type:'player_damage',playerId:id,amount:1.25},
    {type:'unit_damage',playerId:id,amount:2.75},
    {type:'shot',by:'unit-1',playerId:id,hit:true},
  ]
}

test('incremental presentation equals full history, with legacy attribution and exact sums',()=>{
  const world=fixture()
  compare(world)
  for(let i=0;i<70;i++) {
    world.eventLog.push(...combat(i%2?'player':undefined,i%3),{type:'kill',unitType:i%2?'endo':'unknown',wave:1})
    compare(world,`append ${i}`)
  }
  world.eventLog.push({type:'player_damage'},{type:'player_damage',amount:null},{type:'unit_damage',playerId:'player'})
  world.phase='ended';world.localPlayerId='player';world.snapshotEventCursor=world.eventLog.length+10
  compare(world,'NaN presentation damage, scoreboard zero fallback, partial scoreboard')
  const prior=presentationSnapshot(world,director)
  prior.stats.kills.scout=999;prior.scoreboard[0].kills=999
  compare(world,'returned snapshots do not mutate the cache')
})

test('joins, leaves, roster order, late names and returning players preserve two-pass scoreboard semantics',()=>{
  const world=fixture()
  world.eventLog.push(...combat('late'),...combat('named'))
  compare(world)
  world.eventLog.push({type:'unit_damage',playerId:'named',playerName:'First name',amount:2.2},...combat('named'))
  compare(world,'name-only row excludes prior unnamed combat')
  world.eventLog.push({type:'player_leave',playerId:'late',name:'Late join'},...combat('late'),{type:'player_join',playerId:'named',name:'Membership name'})
  compare(world,'later membership retroactively counts full history and orders before name-only rows')
  world.eventLog.push({type:'misc',playerId:'other',playerName:'Other'},...combat('other'))
  world.players.set('named',{...world.player,id:'named',name:'Current',scrap:999})
  compare(world,'live roster has priority')
  world.players=new Map([...world.players].reverse())
  world.players.get('named').name='Rename';world.players.get('named').connected=false
  compare(world,'live fields and order')
  world.players.delete('named')
  compare(world,'removed roster falls back to first membership name')
  world.players.set('other',{...world.player,id:'other',name:'Returned',scrap:5})
  compare(world,'new roster restores prior unnamed stats')
  world.hostPlayerId='other';world.player=world.players.get('other')
  compare(world,'legacy event attribution follows current host')
})

test('catalog mutations, replacements, additions/removals and wave changes reprice full history exactly',()=>{
  const world=fixture()
  world.eventLog.push(...Array.from({length:110},(_,i)=>({type:'kill',unitType:['scout','endo','unknown'][i%3],wave:i%3})))
  compare(world)
  world.unitCatalog.types.scout.scrap=0.3
  compare(world,'in-place price change preserves event addition order')
  world.unitCatalog.types.unknown={scrap:10};delete world.unitCatalog.types.endo
  compare(world,'previously unknown type becomes known')
  world.unitCatalog={types:{unknown:{scrap:0},scout:{scrap:0.4},new:{scrap:8}}}
  for(const wave of [0,1,2,8,NaN]){world.wave=wave;compare(world,`wave ${wave}`)}
  world.weaponCatalog={slots:['gun'],weapons:{gun:{name:'New weapon'}}};world.player.ammo.gun={owned:true,mag:2}
  compare(world,'weapon and loadout remain live')
})

test('replacement, shrink, same-length overwrite and truncate/refill beyond cursor invalidate',()=>{
  const world=fixture()
  world.eventLog.push(...combat());compare(world)
  world.eventLog=structuredClone(combat('other'));compare(world,'new array')
  world.eventLog.length=2;compare(world,'shrink')
  world.eventLog.splice(1,1,{type:'kill',unitType:'endo',wave:1});compare(world,'same-length suffix')
  world.eventLog.length=1;world.eventLog.push(...combat());compare(world,'refill past old cursor')
  world.eventLog.length=0;world.eventLog.push(...combat(),...combat());compare(world,'retry between observations')
  world.eventLog.length=0;compare(world,'observed clear')
  world.eventLog.push(...combat());compare(world,'append after clear')
  const other=fixture();other.eventLog=world.eventLog
  compare(other,'independent world ownership');compare(world)
})

test('actual co-op applySnapshot overlaps, gaps and retry match the full-history projection',t=>{
  const host=new World(),guest=new World()
  t.after(()=>{host.destroy();guest.destroy()})
  guest.localPlayerId='guest'
  host.addPlayer({id:'guest',name:'Guest'})
  host.eventLog.push(...combat(),...combat('guest'))
  const first=networkSnapshot(host);guest.applySnapshot(first);compare(guest,'initial network replacement with compact telemetry')
  host.eventLog.push(...combat('guest'))
  const delta=networkSnapshot(host);guest.applySnapshot(delta);compare(guest,'network append delta')
  guest.applySnapshot({...delta,events:combat('player')});compare(guest,'same length overlap')
  guest.applySnapshot({...delta,events:[...combat('player'),...combat('guest')]});compare(guest,'longer overlap')
  guest.applySnapshot({...delta,events:[]});compare(guest,'truncate without append')
  guest.applySnapshot({...delta,eventStart:500,eventCursor:505,events:combat('guest')});compare(guest,'gap replacement with partial history')
  guest.applySnapshot({...first,eventStart:0,eventCursor:0,events:[]});compare(guest,'empty full replacement')
  host.phase='ended'
  const waves=new WaveDirector(host);waves.phase='ended'
  compare(host,'before retry');waves.returnToLobby();compare(host,'real return to lobby')
})

test('warm history reads stay bounded and only the appended delta is traversed',()=>{
  const world=fixture()
  const history=Array.from({length:10000},(_,i)=>({type:'shot',by:`enemy-${i}`,playerId:'player',hit:false}))
  let reads=0
  world.eventLog=new Proxy(history,{get(target,key,receiver){if(typeof key==='string' && /^\d+$/.test(key))reads++;return Reflect.get(target,key,receiver)}})
  presentationSnapshot(world,director)
  reads=0
  for(let i=0;i<100;i++){presentationSnapshot(world,director);scoreboardSnapshot(world)}
  assert.ok(reads<=400,`warm calls read ${reads} event slots`)
  history.push(...combat());reads=0
  presentationSnapshot(world,director)
  assert.ok(reads<=12,`delta reads ${reads} slots`)
  compare(world)
})

test('standalone scoreboard accepts its original minimal world shape',()=>{
  const world={players:new Map(),hostPlayerId:'host',eventLog:[{type:'kill',playerName:'Host'},{type:'player_leave',playerId:'host',name:'Left'}]}
  assert.deepEqual(scoreboardSnapshot(world),reference.scoreboardSnapshot(world))
})

test('deterministic mixed history changes stay equivalent to the original full scan',()=>{
  const world=fixture()
  let seed=71573
  const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n}
  const ids=['player','guest','late',undefined,'']
  const types=['shot','kill','player_damage','unit_damage','player_join','player_leave','misc']
  for(let batch=0;batch<180;batch++) {
    const events=Array.from({length:random(20)+1},()=>({type:types[random(types.length)],playerId:ids[random(ids.length)],by:ids[random(ids.length)],name:random(3)?undefined:`Member ${random(5)}`,playerName:random(4)?undefined:`Named ${random(5)}`,unitType:['scout','endo','unknown'][random(3)],wave:random(4),amount:[undefined,0,0.1,0.3,-2][random(5)],hit:random(2)===0}))
    if(batch%17===0)world.eventLog=events
    else {if(batch%11===0)world.eventLog.length=random(world.eventLog.length+1);world.eventLog.push(...events)}
    if(batch%7===0)world.players.set('guest',{...world.player,id:'guest',name:`Guest ${batch}`,scrap:batch})
    if(batch%13===0)world.players.delete('guest')
    if(batch%19===0)world.unitCatalog.types.scout.scrap=batch/10
    world.wave=random(4);world.phase=batch%2?'ended':'combat';world.telemetry={}
    compare(world,`mixed batch ${batch}`)
  }
})
