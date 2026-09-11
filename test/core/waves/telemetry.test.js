import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../../lib/core/world.js'
import {WaveDirector} from '../../../lib/core/waves.js'

const idleBrain = {tick() {}}

test('scripted 60 second run produces complete and internally consistent telemetry', () => {
  const world = new World({seed: 44, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})
  const director = new WaveDirector(world)
  director.start({
    spawns: [{t: 120, gate: 'N1', unit: 'scout', count: 1}],
    knobs: {gates: ['N1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
  })
  const attacker = world.spawnUnit('scout', {x: 0, y: 0, z: 13}, {rev: 4})

  for (let tick = 0; tick < 60 * 60; tick += 1) {
    if (tick === 120) world.damagePlayer(5, attacker)
    if (tick === 180) director.recordPurchase('pistol_ammo', 10)
    director.step({
      move: {x: Math.sin(tick / 120) * 0.2, z: Math.cos(tick / 180) * 0.2},
      yaw: 0,
      pitch: -0.02,
      fire: tick < 150,
      reload: tick === 180,
    })
  }
  const summary = director.finishWave()
  const raw = director.lastTelemetry
  const eventLog = world.eventLog

  assert.equal(summary.player_path.length, 60 * 4)
  assert.ok(Math.abs(Object.values(summary.heatmap).reduce((sum, seconds) => sum + seconds, 0) - 60) < 1e-9)
  assert.equal(summary.heatmap_cell_meters, 2)
  assert.equal(summary.health_armor.length, 60)
  assert.equal(summary.damage_taken.length, eventLog.filter(({type}) => type === 'player_damage').length)
  assert.equal(summary.kills.length, eventLog.filter(({type}) => type === 'kill').length)
  assert.equal(raw.counters.shots, eventLog.filter(({type}) => type === 'shot').length)
  assert.equal(raw.counters.hits, eventLog.filter(({type, hit}) => type === 'shot' && hit).length)
  assert.equal(summary.reloads.length, 1)
  assert.ok(summary.reloads[0].magazine_fraction > 0 && summary.reloads[0].magazine_fraction < 1)
  assert.deepEqual(summary.purchases.map(({item, price}) => ({item, price})), [{item: 'pistol_ammo', price: 10}])
  assert.equal(summary.time_to_clear, 60)
  assert.equal(summary.applied_budget, 420)
  assert.equal(summary.performance_multiplier, 1)
  assert.ok(summary.health_lost >= 5)
  assert.ok(summary.damage_per_minute >= 5)

  for (const stats of Object.values(summary.units)) {
    for (const field of ['unit_type', 'rev', 'lifetime', 'cause_of_death', 'distance_traveled', 'shots_fired', 'damage_dealt', 'script_errors', 'fuel_exhausted']) {
      assert.ok(Object.hasOwn(stats, field), `unit telemetry missing ${field}`)
    }
  }
  const damage = summary.damage_taken[0]
  for (const field of ['t', 'amount', 'unit_type', 'attacker_pos', 'player_pos', 'player_facing', 'player_facing_attacker']) {
    assert.ok(Object.hasOwn(damage, field), `damage event missing ${field}`)
  }
  for (const kill of summary.kills) {
    for (const field of ['t', 'unit_type', 'weapon', 'distance', 'headshot', 'time_from_first_damage']) {
      assert.ok(Object.hasOwn(kill, field), `kill missing ${field}`)
    }
  }
})

test('trader purchases use documented prices and enter telemetry and the event log', () => {
  const world = new World({seed: 5, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})
  world.player.scrap = 1000
  world.player.hp = 40
  assert.equal(world.purchase('medkit').ok, false)
  world.phase = 'intermission'
  assert.equal(world.purchase('medkit').price, 150)
  assert.equal(world.purchase('m4').price, 500)
  assert.equal(world.player.hp, 90)
  assert.equal(world.player.ammo.m4.owned, true)
  assert.deepEqual(world.telemetry.purchases.map(({item, price}) => ({item, price})), [
    {item: 'medkit', price: 150},
    {item: 'm4', price: 500},
  ])
  assert.equal(world.eventLog.filter(({type}) => type === 'purchase').length, 2)
})

test('intermission purchases are carried into the next wave summary', () => {
  const world = new World({seed: 6, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})
  const director = new WaveDirector(world, {maxWaves: 2})
  const config = {
    spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
    knobs: {gates: ['N1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
  }
  director.start(config)
  director.step({})
  world.damageUnit(world.aliveUnits[0].id, 999, {source: 'player', weapon: 'pistol'})
  director.step({})
  world.player.scrap = 200
  world.player.hp = 40
  assert.equal(world.purchase('medkit').ok, true)
  director.submitConfig({wave: 2, ...config})
  director.ready(1)
  director.step({})
  world.damageUnit(world.aliveUnits[0].id, 999, {source: 'player', weapon: 'pistol'})
  director.step({})
  const summary = director.telemetryByWave.get(2)
  assert.deepEqual(summary.purchases.map(({item, price}) => ({item, price})), [{item: 'medkit', price: 150}])
})
