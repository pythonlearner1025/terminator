// Serial, CPU-only benchmark. Run: node test/ui/presentation-benchmark.mjs
// The frozen oracle is the pre-change implementation, not a reconstructed scan.
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import * as before from './fixtures/presentation-reference.js'
import * as after from '../../lib/ui/presentation.js'

const director={spawnSchedule:[],nextSpawn:0,phase:'combat'}
const calls=200, samples=3
function event(i) {
  const id=['player','guest-1','guest-2'][Math.floor(i/6)%3]
  switch(i%6) {
    case 0:return {type:'kill',playerId:id,unitType:Math.floor(i/6)%2?'endo':'scout',wave:i%10}
    case 1:return {type:'shot',by:id,playerId:id,hit:i%4===1}
    case 2:return {type:'player_damage',playerId:id,amount:1.25}
    case 3:return {type:'unit_damage',playerId:id,amount:3.5}
    case 4:return {type:'shot',by:`unit-${i}`,playerId:id,hit:false}
    default:return {type:'unit_spawn',unitId:`unit-${i}`}
  }
}
function world(history,phase) {
  const players=new Map(['player','guest-1','guest-2'].map(id=>[id,{id,name:id,scrap:200,alive:true,sprintStamina:6,pos:{x:0,z:0},yaw:0,ammo:{}}]))
  return {players,player:players.get('player'),hostPlayerId:'player',getPlayer(id){return players.get(id)},eventLog:history.slice(),aliveUnits:[],map:{trader:{pos:{x:1,z:2}}},unitCatalog:{types:{scout:{scrap:12},endo:{scrap:20},heavy:{scrap:50}}},weaponCatalog:{slots:[],weapons:{}},phase,wave:5,time:650}
}
function measure(api,history,delta,phase,method) {
  const w=world(history,phase)
  const run=()=>api[method](w,director)
  for(let i=0;i<40;i++)run()
  const chunks=Array.from({length:calls},(_,i)=>Array.from({length:delta},(_,j)=>event(history.length+i*delta+j)))
  let value,cpuUs=0,wallMs=0
  if(delta) {
    for(let i=0;i<calls;i++) {
      w.eventLog.push(...chunks[i])
      const startCpu=process.cpuUsage(),startWall=performance.now()
      value=run()
      wallMs+=performance.now()-startWall
      const cpu=process.cpuUsage(startCpu)
      cpuUs+=cpu.user+cpu.system
    }
  } else {
    const startCpu=process.cpuUsage(),startWall=performance.now()
    for(let i=0;i<calls;i++)value=run()
    wallMs=performance.now()-startWall
    const cpu=process.cpuUsage(startCpu)
    cpuUs=cpu.user+cpu.system
  }
  assert.deepEqual(value,before[method](w,director))
  return {cpuUs:cpuUs/calls,wallUs:wallMs*1000/calls}
}
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)]
console.log(JSON.stringify({node:process.version,calls,samples,units:'microseconds/call',timing:'median process CPU (user+system) and wall; construction/warmup/assertions/appending excluded; delta cases timed per call, fixed cases timed in batches',history:'synthetic mixed combat, three players; no world stepping or browser'}))
for(const [size,delta,phase,method] of [
  ...[10000,100000,500000].flatMap(size=>[0,4,256].map(delta=>[size,delta,'combat','presentationSnapshot'])),
  [100000,0,'ended','presentationSnapshot'],
  [100000,0,'ended','scoreboardSnapshot'],
]) {
  const history=Array.from({length:size},(_,i)=>event(i))
  const old=[],next=[]
  for(let i=0;i<samples;i++) {
    // Alternate ordering to reduce systematic warmup/GC bias.
    if(i%2){next.push(measure(after,history,delta,phase,method));old.push(measure(before,history,delta,phase,method))}
    else {old.push(measure(before,history,delta,phase,method));next.push(measure(after,history,delta,phase,method))}
  }
  const summarize=values=>Object.fromEntries(['cpuUs','wallUs'].map(key=>[key,Number(median(values.map(value=>value[key])).toFixed(3))]))
  console.log(JSON.stringify({size,delta,phase,method,before:summarize(old),after:summarize(next)}))
}
