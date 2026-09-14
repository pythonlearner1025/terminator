import test from 'node:test'
import assert from 'node:assert/strict'
import {World} from '../../lib/core/world.js'
import {projectViewModel} from '../../lib/core/viewmodel.js'
import {withCoopNameplates} from '../../lib/ui/coop-view.js'

test('HUD projection skips enemy LOS and records while retaining all other fields and health state', () => {
  const world=new World({seed:2029})
  try {
    const player=world.player
    player.pos={x:0,y:0,z:0};player.yaw=0
    // Actual spawned units keep real gameplay HP, boss metadata and event state.
    const enemy=world.spawnUnit('endo',{x:0,y:0,z:5})
    const boss=world.spawnUnit('hktank',{x:1,y:0,z:8})
    let queries=0
    world.lineOfSight=()=>{queries++;return true}
    const before=[enemy.hp,boss.hp]
    const full=projectViewModel(world)
    assert.equal(queries,2)
    assert.deepEqual(full.nameplates.map(p=>p.id),[enemy.id,boss.id])
    assert.equal(full.nameplates[0].hp,enemy.hp)
    queries=0
    const hud=projectViewModel(world,player.id,{includeEnemyNameplates:false})
    assert.equal(queries,0)
    assert.deepEqual(hud,{...full,nameplates:[]})
    assert.deepEqual([enemy.hp,boss.hp],before)
    assert.deepEqual(projectViewModel(world,player.id,{includeEnemyNameplates:true}),full)
  } finally {world.destroy()}
})

test('guest and spectator HUDs retain teammate identifiers without enemy label queries', () => {
  const world=new World({seed:2029})
  try {
    const guest=world.addPlayer({id:'guest',name:'Guest'})
    const friend=world.addPlayer({id:'friend',name:'Friend'})
    world.spawnUnit('endo',{x:0,y:0,z:5})
    world.lineOfSight=()=>{throw Error('HUD must not query enemy labels')}
    const view=projectViewModel(world,guest.id,{includeEnemyNameplates:false})
    assert.equal(view.health.value,guest.hp)
    const hud=withCoopNameplates(view,world,guest.id,null)
    assert.deepEqual(hud.nameplates.map(p=>p.id).sort(),[world.hostPlayerId,friend.id].sort())
    assert(hud.nameplates.every(p=>p.kind==='teammate'))
    const spectate=withCoopNameplates(view,world,guest.id,{id:friend.id})
    assert.deepEqual(spectate.nameplates.map(p=>p.id),[world.hostPlayerId])
  } finally {world.destroy()}
})
