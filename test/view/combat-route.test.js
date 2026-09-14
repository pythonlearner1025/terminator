import test from 'node:test'
import assert from 'node:assert/strict'
import {World} from '../../lib/core/world.js'
import {createCombatRoute} from '../../tools/v2/combat-route.mjs'

test('native combat input route stays supported and moves through a populated courtyard for 3600 ticks',()=>{
 const world=new World({seed:2029});world.player.pos={x:-12,y:0,z:-17};world.sandbox.invulnerable=true
 const types=['scout','endo','heavy','t1000','hkaerial','hktank']
 for(let i=0;i<24;i++){const a=i/24*Math.PI*2,type=types[i%6];world.spawnUnit(type,{x:Math.sin(a)*20,y:type==='hkaerial'?5:0,z:Math.cos(a)*20},{yaw:a+Math.PI})}
 const route=createCombatRoute(world)
 for(let i=0;i<3600;i++){
  world.step(route.sample())
  assert(world.playerSupportAt(world.player.pos,world.player.pos.y,{radius:.38,maxAbove:.04,maxBelow:.04}))
 }
 assert.equal(world.tick,3600);assert(route.summary().distance>290);assert(route.summary().wraps>=2)
 assert(world.aliveUnits.length>=6);assert(world.eventLog.some(e=>e.type==='shot'))
})
