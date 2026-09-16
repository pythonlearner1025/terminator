import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../lib/core/world.js'
import {networkSnapshot} from '../../lib/net/party-host.js'

const idleBrain = {tick() {}}
const brains = {scout: idleBrain}

// Ten minutes with four idle live units and one replacement death per second.
// Count actual alive-property reads in the core loops, not noisy wall time.
test('fixed live workload does not scan or snapshot every past death', {timeout: 30_000}, (t) => {
  const world = new World({brains})
  t.after(() => world.destroy())
  let reads = 0
  const spawn = () => {
    const unit = world.spawnUnit('scout', {x: 0, y: 0, z: 0})
    let alive = unit.alive
    Object.defineProperty(unit, 'alive', {enumerable: true, configurable: true,
      get() { reads++; return alive }, set(value) { alive = value }})
    return unit
  }
  for (let i = 0; i < 4; i++) spawn()
  const samples = []
  for (let second = 0; second < 600; second++) {
    const dead = spawn()
    world.damageUnit(dead.id, dead.hp, {source: 'sandbox'})
    reads = 0
    for (let tick = 0; tick < 60; tick++) world.step({})
    const loopReads = reads
    if ([59, 299, 599].includes(second)) {
      const snapshot = networkSnapshot(world)
      samples.push({seconds: second + 1, retained: world.units.length, indexed: world.unitById.size,
        loopReads, snapshotUnits: snapshot.units.length, unitBytes: JSON.stringify(snapshot.units).length})
    }
  }
  t.diagnostic(JSON.stringify(samples))
  assert.equal(world.aliveUnits.length, 4)
  assert.equal(world.telemetry.unitTypes.scout.spawned, 604)
  assert.equal(world.telemetry.unitTypes.scout.killed, 600)
  assert.equal(Object.keys(world.telemetry.units).length, 604, 'summary records outlive simulation entities')
  assert.ok(samples.every(s => s.retained <= 7 && s.indexed <= 7), 'only live units and recent corpses remain')
  assert.equal(samples[2].loopReads, samples[0].loopReads, 'fixed workload has fixed entity scan work')
  assert.equal(samples[2].snapshotUnits, samples[0].snapshotUnits)
  assert.ok(samples[2].unitBytes <= samples[0].unitBytes * 1.05)
})

test('recent corpses survive snapshots and brains are destroyed exactly once', (t) => {
  let destroyed = 0
  const world = new World({brains: {scout: {tick() {}, destroy() { destroyed++ }}}})
  t.after(() => world.destroy())
  const unit = world.spawnUnit('scout', {x: 0, y: 0, z: 0}, {rev: 7})
  world.damageUnit(unit.id, unit.hp, {source: 'sandbox'})
  assert.equal(destroyed, 1)
  assert.equal(unit.brain, null)
  const restored = new World({brains}).applySnapshot(world.snapshot())
  t.after(() => restored.destroy())
  for (let tick = 0; tick <= 120; tick++) {
    assert.ok(world.unitById.has(unit.id), 'death remains available during the view admission window')
    world.step({})
    restored.step({})
  }
  world.step({})
  restored.step({})
  assert.equal(world.units.length, 0)
  assert.equal(world.unitById.has(unit.id), false)
  assert.equal(world.telemetry.units[unit.id].rev, 7)
  assert.equal(world.telemetry.unitTypes.scout.killed, 1)
  assert.deepEqual(restored.snapshot(), world.snapshot())
  world.clearUnits()
  assert.equal(destroyed, 1)
})

test('a dead projectile owner survives retirement until its final impact', (t) => {
  const world = new World({brains})
  t.after(() => world.destroy())
  const unit = world.spawnUnit('scout', {x: 0, y: 0, z: 0})
  const projectile = world.spawnProjectile({type: 'round', owner: 'unit', ownerId: unit.id,
    pos: {x: 0, y: 50, z: 0}, vel: {x: 0, y: 0, z: -.01}, damage: 10, life: 10})
  world.damageUnit(unit.id, unit.hp, {source: 'sandbox'})
  for (let tick = 0; tick < 180; tick++) world.step({})
  assert.ok(world.unitById.has(unit.id))
  const p = world.player.pos
  projectile.pos = {x: p.x, y: p.y + 1, z: p.z + .6}
  projectile.vel = {x: 0, y: 0, z: -60}
  world.step({})
  assert.equal(world.projectiles.length, 0)
  assert.equal(world.telemetry.units[unit.id].damageDealt, 10)
  const damage = world.eventLog.findLast(e => e.type === 'player_damage')
  assert.equal(damage.unitId, unit.id)
  assert.equal(damage.unitType, 'scout')
  world.step({})
  assert.equal(world.unitById.has(unit.id), false)
  assert.equal(world.telemetry.units[unit.id].damageDealt, 10)
})
