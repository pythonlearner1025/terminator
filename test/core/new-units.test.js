import assert from 'node:assert/strict'
import test from 'node:test'
import * as defaultHkAerial from '../../lib/core/brains/default-hkaerial.js'
import {World} from '../../lib/core/world.js'
import {projectViewModel} from '../../lib/core/viewmodel.js'
import {difficultyScaling, validateWaveConfig} from '../../lib/core/waves.js'

const idle = {tick() {}}
const brains = Object.fromEntries(['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank'].map((type) => [type, idle]))

test('T-1000 regeneration waits three seconds and ignores stagger', () => {
  const world = new World({brains})
  const t1000 = world.spawnUnit('t1000', {x: 12, y: 0, z: 10})
  const endo = world.spawnUnit('endo', {x: 14, y: 0, z: 10})
  world.damageUnit(t1000.id, 100, {source: 'player', weapon: 'sniper', part: 'Chest'})
  world.damageUnit(endo.id, 100, {source: 'player', weapon: 'sniper', part: 'Chest'})
  assert.equal(t1000.staggerTicks, 0)
  assert.ok(endo.staggerTicks > 0)
  for (let tick = 0; tick < 179; tick += 1) world.step({})
  assert.equal(t1000.hp, 800)
  for (let tick = 179; tick < 240; tick += 1) world.step({})
  assert.ok(Math.abs(t1000.hp - 820) < 0.01)
})

test('HK-Aerial flies directly, holds altitude, and never enters a collider', () => {
  const world = new World({brains})
  const aerial = world.spawnUnit('hkaerial', {x: 5, y: 4.5, z: 10})
  aerial.intent.moveTo = {x: 5, y: 5.5, z: 23}
  const spec = world.unitCatalog.types.hkaerial
  for (let tick = 0; tick < 180; tick += 1) {
    world.step({})
    assert.ok(aerial.pos.y >= spec.altitudeMin && aerial.pos.y <= spec.altitudeMax)
    const center = {...aerial.pos, y: aerial.pos.y + spec.height / 2}
    for (const collider of world.activeColliders()) assert.equal(intersects(center, spec.radius, collider), false, collider.id)
  }
  assert.ok(aerial.pos.z < 16)
  assert.equal(aerial.pathCache.computedAtTick, -1000)
})

test('HK-Aerial default brain selects a strafing destination inside its orbit band', () => {
  let destination = null
  let fired = false
  defaultHkAerial.tick(
    {pos: {x: 0, y: 4.5, z: 20}, weapon: {range: 45}},
    {time: 2, rand: () => 0.25, player: {pos: {x: 0, y: 0, z: 0}, dist: 20}, lastKnownPlayer: null, sounds: []},
    {moveTo: (pos) => { destination = pos }, aimAt() {}, face() {}, fire: () => { fired = true }},
    {},
  )
  const radius = Math.hypot(destination.x, destination.z)
  assert.ok(radius >= 12 && radius <= 25)
  assert.notEqual(destination.x, 0)
  assert.equal(fired, true)
})

test('HK-Tank fires one gravity shell and a twin 18 m/s bolt burst', () => {
  const tankBrain = {tick(self, sense, act) {
    if (!sense.player) return
    act.aimAt(sense.player.pos)
    act.face(sense.player.pos)
    act.fire()
  }}
  const world = new World({seed: 31, brains: {...brains, hktank: tankBrain}})
  world.player.pos = {x: 10, y: 0, z: 10}
  world.player.hp = world.player.maxHp = 1e9
  const tank = world.spawnUnit('hktank', {x: 10, y: 0, z: -10}, {yaw: 0})
  for (let tick = 0; tick < 40; tick += 1) world.step({})
  const fired = world.eventLog.filter((event) => event.type === 'projectile_fired' && event.ownerId === tank.id)
  assert.deepEqual(fired.map(({projectileType}) => projectileType), ['shell', 'bolt', 'bolt'])
  assert.ok(Math.abs(Math.hypot(...Object.values(fired[0].vel)) - 22) < 1e-9)
  assert.ok(fired.slice(1).every(({vel}) => Math.abs(Math.hypot(...Object.values(vel)) - 18) < 1e-9))
})

test('new unit catalogs expose the exact damage parts and weak multipliers', () => {
  const world = new World({brains})
  assert.deepEqual(world.unitCatalog.types.t1000.parts, {Head: 1.5, Chest: 1, Spine: 1, Pelvis: 1, Limbs: 1})
  assert.deepEqual(world.unitCatalog.types.hkaerial.parts, {Hull: 1, 'Wing Left': 1, 'Wing Right': 1, Turret: 2, 'Thruster Left': 1, 'Thruster Right': 1})
  assert.deepEqual(world.unitCatalog.types.hktank.parts, {Hull: 1, Turret: 1, Cannon: 1, 'Tread Left': 1, 'Tread Right': 1, Core: 3})
})

test('HK-Tank scales boss health and takes triple rear Core damage', () => {
  const world = new World({brains})
  world.scaling = difficultyScaling(1, 'hell')
  const tank = world.spawnUnit('hktank', {x: 10, y: 0, z: -10}, {yaw: 0})
  assert.equal(tank.maxHp, 9600)
  const result = world.hitscan({origin: {x: 10, y: 1.2, z: -15}, direction: {x: 0, y: 0, z: 1}, weaponId: 'pistol', damage: 100})
  assert.equal(result.part, 'Core')
  assert.equal(result.headshot, false)
  assert.equal(result.damage, 300)
  assert.deepEqual(projectViewModel(world).boss, {name: 'HK-Tank', hp: 9300, hpMax: 9600})
})

test('HK-Tank is accepted only once at the dedicated wide boss gate', () => {
  const config = {
    spawns: [
      {t: 0, gate: 'boss', unit: 'hktank', count: 1},
      {t: 0, gate: 'N1', unit: 't1000', count: 1},
      {t: 1, gate: 'N2', unit: 'hkaerial', count: 1},
    ],
    knobs: {gates: ['boss', 'N1', 'N2']},
  }
  assert.equal(validateWaveConfig(config, {wave: 5, budget: 900}).ok, true)
  const narrow = structuredClone(config)
  narrow.spawns[0].gate = 'N1'
  assert.equal(validateWaveConfig(narrow, {wave: 5, budget: 900}).errors.some(({code}) => code === 'BOSS_GATE_TOO_NARROW'), true)
})

function intersects(center, radius, collider) {
  let squared = 0
  for (const axis of ['x', 'y', 'z']) {
    const half = collider.size[axis] / 2
    const near = Math.max(collider.center[axis] - half, Math.min(collider.center[axis] + half, center[axis]))
    squared += (center[axis] - near) ** 2
  }
  return squared < radius ** 2 - 1e-9
}
