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

// A fresh projection over the original filter's result provides a full public
// view-model oracle, independent of any prior incremental cache state.
function filteredProjection(world, playerId, options) {
  const reference = Object.create(world)
  reference.eventLog = world.eventLog.filter((event) => world.time - event.t <= 5)
  return projectViewModel(reference, playerId, options)
}

test('incremental projection preserves kill feed, player feedback, chatter and all other gameplay fields', (t) => {
  const world = new World({seed: 2029})
  t.after(() => world.destroy())
  const host = world.player
  const guest = world.addPlayer({id: 'guest', name: 'Guest'})
  host.pos = guest.pos = {x: 0, y: 0, z: 0}
  host.yaw = guest.yaw = 0
  host.hp = 19
  host.armor = 25
  host.reloadTimer = 0.5
  const enemy = world.spawnUnit('endo', {x: 0, y: 0, z: 5})
  world.spawnUnit('hktank', {x: 1, y: 0, z: 8})
  world.lineOfSight = () => true
  world.tick = 600
  world.eventLog = [9, 10, 5, 7, 200, 0, 6, 4.9999].map((time, tick) => ({
    type: 'kill', t: time, tick, unitId: `enemy-${tick}`, unitType: 'endo', weapon: 'unknown', headshot: tick === 4,
  }))
  world.eventLog.push(
    {type: 'shot', t: 9.65, tick: 10, by: host.id, hit: true, weapon: 'a'},
    {type: 'shot', t: 9.6499, tick: 11, by: host.id, hit: true, weapon: 'b'},
    {type: 'shot', t: 11, tick: 12, by: guest.id, hit: true, killed: true, weapon: 'c'},
    {type: 'shot', t: 10, tick: 13, by: host.id, hit: false, weapon: 'd'},
    {type: 'shot', t: 10, tick: 14, by: host.id, hit: true, headshot: true, weapon: 'e'},
    {type: 'player_damage', t: 9, tick: 20, amount: 3, attackerPos: {x: 1, y: 0, z: 0}, unitId: 'legacy'},
    {type: 'player_damage', t: 8.9999, tick: 21, amount: 30, attackerPos: {x: 1, y: 0, z: 0}},
    {type: 'player_damage', t: 11, tick: 22, amount: 60, playerId: guest.id, attackerPos: {x: 0, y: 0, z: 1}, unitType: 'scout'},
    {type: 'player_damage', t: 10, tick: 23, amount: 10, playerId: host.id},
    {type: 'unit_say', t: 100, tick: 30, unitId: enemy.id, text: 'Future first'},
    {type: 'unit_say', t: 5, tick: 31, unitId: enemy.id, text: 'Last qualifying by insertion'},
    {type: 'unit_say', t: 4.99, tick: 32, unitId: enemy.id, text: 'Expired last'},
  )
  const history = structuredClone(world.eventLog)
  const first = projectViewModel(world)
  assert.deepEqual(first.killFeed.map(e => e.id), ['6:enemy-6', '4:enemy-4', '3:enemy-3', '2:enemy-2', '1:enemy-1'])
  assert.deepEqual(first.killFeed.map(e => e.age), [4, -190, 3, 5, 0])
  assert.equal(first.killFeed[1].text, 'UNKNOWN  HEADSHOT  T-800 ENDO')
  assert.deepEqual(first.hitMarkers, [{id: '10:a', kind: 'hit'}, {id: '14:e', kind: 'headshot'}])
  assert.deepEqual(first.damageDirections, [{id: '20:legacy', angle: -Math.PI / 2, strength: 0.25, age: 1}])
  assert.equal(first.nameplates[0].chatter, 'Last qualifying by insertion')
  assert.equal(first.health.critical, true)
  const guestView = projectViewModel(world, guest.id)
  assert.deepEqual(guestView.hitMarkers, [{id: '12:c', kind: 'kill'}])
  assert.deepEqual(guestView.damageDirections, [{id: '22:scout', angle: 0, strength: 1, age: -1}])
  for (const tick of [600, 601, 620, 660, 900, 12301, 300, 600]) {
    world.tick = tick
    for (const playerId of [host.id, guest.id, 'missing-player']) {
      for (const includeEnemyNameplates of [true, false]) {
        const options = {includeEnemyNameplates}
        assert.deepEqual(projectViewModel(world, playerId, options), filteredProjection(world, playerId, options))
      }
    }
  }
  assert.deepEqual(world.eventLog, history, 'projection does not alter event history')
  assert.equal(first.nameplates[0].chatter, 'Last qualifying by insertion', 'previous public projections remain unchanged')
  first.killFeed.length = first.hitMarkers.length = first.damageDirections.length = first.nameplates.length = 0
  assert.deepEqual(projectViewModel(world), filteredProjection(world), 'public arrays cannot corrupt cached events')
})

test('real snapshot replacement invalidates same-length/longer suffixes and tick rewinds', (t) => {
  const world = new World({seed: 2029})
  t.after(() => world.destroy())
  world.tick = 600
  world.eventLog = Array.from({length: 4}, (_, tick) => ({
    type: 'kill', t: tick < 2 ? 0 : 10, tick, unitId: `old-${tick}`, unitType: 'scout',
  }))
  const snapshot = world.snapshot()
  projectViewModel(world)
  for (const [count, tick] of [[2, 600], [4, 600], [1, 600], [3, 300]]) {
    const oldLog = world.eventLog
    const oldBoundary = oldLog.at(-1)
    world.applySnapshot({...snapshot, tick, eventStart: 2, eventCursor: 2 + count,
      events: Array.from({length: count}, (_, id) => ({type: 'kill', t: 5, tick: 100 + id, unitId: `new-${id}`, unitType: 'heavy'})),
    })
    assert.equal(world.eventLog, oldLog, 'exercise in-place suffix replacement')
    assert.notEqual(world.eventLog.at(-1), oldBoundary)
    assert.deepEqual(projectViewModel(world), filteredProjection(world))
    assert.ok(projectViewModel(world).killFeed.some(e => e.id === '100:new-0'))
  }
  const oldLog = world.eventLog
  world.applySnapshot({...snapshot, eventStart: 0})
  assert.notEqual(world.eventLog, oldLog)
  assert.deepEqual(projectViewModel(world), filteredProjection(world))
})

test('projectViewModel does not rescan historical timestamps during sustained HUD calls', (t) => {
  const world = new World({seed: 2029})
  t.after(() => world.destroy())
  world.tick = 6000
  let historicalReads = 0, appendedReads = 0
  world.eventLog = Array.from({length: 100_000}, () => ({
    type: 'kill', get t() { historicalReads++; return 0 },
  }))
  const options = {includeEnemyNameplates: false}
  projectViewModel(world, world.hostPlayerId, options)
  assert.equal(historicalReads, 100_000)
  historicalReads = 0
  for (let frame = 0; frame < 600; frame++) {
    projectViewModel(world, world.hostPlayerId, options)
  }
  // Irrelevant event type isolates the admission predicate's timestamp reads
  // from downstream feedback-age calculations.
  world.eventLog.push({type: 'other', get t() { appendedReads++; return 100 }})
  projectViewModel(world, world.hostPlayerId, options)
  assert.equal(appendedReads, 1)
  for (let frame = 0; frame < 600; frame++) {
    world.tick += 2
    projectViewModel(world, world.hostPlayerId, options)
  }
  assert.equal(historicalReads, 0)
  const afterExpiry = appendedReads
  world.tick += 600
  projectViewModel(world, world.hostPlayerId, options)
  assert.equal(appendedReads, afterExpiry, 'expired events leave the hot path')
  t.diagnostic(`projectViewModel: 100000 historical events, 1201 subsequent calls, historical timestamp rereads=${historicalReads}`)
})
