import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../../lib/core/world.js'

test('sense hides the player outside the vision cone and behind an occluder', () => {
  const source = 'export function tick(self, sense, act, mem) { mem.playerVisible = sense.player !== null }'

  const outside = new World({scriptSources: {scout: source}})
  const outsideUnit = outside.spawnUnit('scout', {x: 0, y: 0, z: 13}, {yaw: 0})
  outside.step()
  assert.equal(outsideUnit.mem.playerVisible, false)
  outside.destroy()

  const occluded = new World({scriptSources: {scout: source}})
  occluded.player.pos = {x: 5, y: 0, z: 20}
  const occludedUnit = occluded.spawnUnit('scout', {x: 5, y: 0, z: 13}, {yaw: 0})
  occluded.step()
  assert.equal(occludedUnit.mem.playerVisible, false)
  assert.equal(occluded.lineOfSight(occluded.unitEye(occludedUnit), {...occluded.player.pos, y: 1.65}), false)
  occluded.destroy()
})

test('act.face on every brain tick still obeys the Heavy turn rate', () => {
  const source = 'export function tick(self, sense, act) { act.face({x: 0, y: 0, z: -100}) }'
  const world = new World({scriptSources: {heavy: source}})
  const unit = world.spawnUnit('heavy', {x: 0, y: 0, z: 0}, {yaw: 0})

  for (let index = 0; index < 60; index += 1) world.step()

  assert.ok(Math.abs(Math.abs(unit.yaw) - Math.PI / 2) < 1e-10, `yaw was ${unit.yaw}`)
  world.destroy()
})

test('script acceptance rejects missing tick and smoke errors, then versions new spawns', () => {
  const world = new World({seed: 9})
  const existing = world.spawnUnit('scout', {x: -2, y: 0, z: 13}, {yaw: Math.PI})

  const missing = world.acceptScript({unitType: 'scout', source: 'export const other = 1'})
  assert.equal(missing.ok, false)
  assert.match(missing.error, /must export function tick/)

  const throwing = world.acceptScript({
    unitType: 'scout',
    source: 'export function tick() { throw new Error("smoke failed") }',
  })
  assert.equal(throwing.ok, false)
  assert.match(throwing.error, /smoke failed/)
  assert.equal(throwing.smokeLog.some(({type}) => type === 'script_error'), true)

  const accepted = world.acceptScript({
    unitType: 'scout',
    source: 'export function tick(self, sense, act, mem) { mem.accepted = true }',
  })
  assert.deepEqual(accepted, {ok: true, rev: 2})
  const fresh = world.spawnUnit('scout', {x: 2, y: 0, z: 13}, {yaw: Math.PI})
  for (let index = 0; index < 6; index += 1) world.step()

  assert.equal(existing.rev, 1)
  assert.equal(fresh.rev, 2)
  assert.equal(fresh.mem.accepted, true)
  assert.equal(world.skynet.revs.scout, 2)
  world.destroy()
})

test('24 units tick at 10 Hz in deterministic staggered groups', () => {
  const source = 'export function tick(self, sense, act, mem) { mem.ticks = (mem.ticks || 0) + 1 }'
  const scripts = {scout: source, endo: source, heavy: source}
  const world = new World({scriptSources: scripts})
  for (let index = 0; index < 24; index += 1) {
    const angle = index / 24 * Math.PI * 2
    world.spawnUnit(['scout', 'endo', 'heavy'][index % 3], {
      x: Math.sin(angle) * 20,
      y: 0,
      z: Math.cos(angle) * 20,
    }, {yaw: angle + Math.PI})
  }

  const counts = []
  for (let index = 0; index < 60; index += 1) {
    world.step()
    counts.push(world.lastBrainTickCount)
  }

  assert.deepEqual(counts, Array(60).fill(4))
  assert.equal(Math.max(...counts) <= Math.ceil(world.aliveUnits.length / 4), true)
  assert.deepEqual(world.units.map(({mem}) => mem.ticks), Array(24).fill(10))
  world.destroy()
})
