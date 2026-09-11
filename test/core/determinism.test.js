import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../lib/core/world.js'

test('120 second runs with default brains are deterministic for one seed', {timeout: 30000}, () => {
  const first = runScenario(2029)
  const second = runScenario(2029)
  assert.deepEqual(first.eventLog, second.eventLog)
  assert.deepEqual(first.telemetry, second.telemetry)
  assert.equal(first.replay.length, 120 * 60)
})

test('telemetry counters match the event log', () => {
  const world = new World({seed: 99})
  world.spawnUnit('scout', {x: 0, y: 0, z: 13}, {yaw: Math.PI})
  for (let tick = 0; tick < 180; tick += 1) {
    world.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0, fire: true})
  }
  const events = world.eventLog
  assert.equal(world.telemetry.counters.kills, events.filter(({type}) => type === 'kill').length)
  assert.equal(world.telemetry.counters.damageEvents, events.filter(({type}) => type === 'unit_damage' || type === 'player_damage').length)
  assert.equal(world.telemetry.counters.shots, events.filter(({type}) => type === 'shot').length)
  assert.equal(world.telemetry.counters.hits, events.filter(({type, hit}) => type === 'shot' && hit).length)
})

function runScenario(seed) {
  const world = new World({seed})
  const positions = [
    [-18, 12], [-12, 12], [-6, 12], [6, 12], [12, 12], [18, 12],
    [-18, -12], [-12, -12], [-6, -12], [6, -12], [12, -12], [18, -12],
    [-18, 20], [-10, 20], [10, 20], [18, 20],
    [-18, -20], [-10, -20], [10, -20], [18, -20],
    [-24, -8], [-24, 8], [24, -8], [24, 8],
  ]
  positions.forEach(([x, z], index) => {
    const type = ['scout', 'endo', 'heavy'][index % 3]
    world.spawnUnit(type, {x, y: 0, z}, {yaw: Math.atan2(-x, 9 - z)})
  })
  for (let tick = 0; tick < 120 * 60; tick += 1) {
    world.step({
      move: {x: Math.sin(tick / 90) * 0.35, z: Math.cos(tick / 120) * 0.25},
      yaw: Math.sin(tick / 180) * 1.2,
      pitch: Math.sin(tick / 240) * 0.08,
      fire: tick % 3 === 0,
      reload: tick % 180 === 120,
      sprint: tick % 240 < 80,
      crouch: tick % 300 > 260,
    })
  }
  return world
}
