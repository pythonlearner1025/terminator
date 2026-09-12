import assert from 'node:assert/strict'
import test from 'node:test'
import {BuiltinSkynet} from '../../lib/core/builtin-skynet.js'
import {buildWaveSummary} from '../../lib/core/telemetry.js'
import {World} from '../../lib/core/world.js'
import {WaveDirector} from '../../lib/core/waves.js'
import {parseSandboxFlag} from '../../lib/ui/sandbox.js'

const TYPES = ['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank']
const idleBrains = Object.fromEntries(TYPES.map((type) => [type, {tick() {}}]))

test('sandbox flag accepts a non-empty value and ignores its absence', () => {
  assert.equal(parseSandboxFlag('?sandbox=1'), true)
  assert.equal(parseSandboxFlag('?other=1&sandbox=test'), true)
  assert.equal(parseSandboxFlag('?sandbox='), false)
  assert.equal(parseSandboxFlag('?party=ABC123'), false)
  assert.equal(parseSandboxFlag(''), false)
})

test('calling setSandbox with all false leaves a scripted match unchanged', () => {
  const run = (configure) => {
    const world = new World({seed: 41, brains: idleBrains})
    if (configure) world.setSandbox({invulnerable: false, infiniteScrap: false})
    world.spawnUnit('endo', {x: 5, y: 0, z: 13}, {yaw: Math.PI})
    for (let tick = 0; tick < 180; tick += 1) {
      world.step({move: {x: Math.sin(tick / 30) * 0.2, z: 0.1}, yaw: tick / 100, fire: tick % 12 === 0})
    }
    return world.snapshot()
  }
  assert.deepEqual(run(true), run(false))
})

test('invulnerability ignores direct unit damage and configured hazards', () => {
  const world = new World({seed: 42, brains: idleBrains})
  world.setSandbox({invulnerable: true, infiniteScrap: false})
  const unit = world.spawnUnit('scout', {x: 0, y: 0, z: 13})
  assert.equal(world.damagePlayer(500, unit), 0)
  assert.deepEqual({hp: world.player.hp, armor: world.player.armor, alive: world.player.alive}, {hp: 100, armor: 100, alive: true})

  const slot = world.map.hazardSlots[0]
  world.player.pos = {...slot.pos}
  world.configureMap({hazards: [{slot: slot.id, kind: slot.types[0]}]})
  world.step()
  assert.deepEqual({hp: world.player.hp, armor: world.player.armor, alive: world.player.alive}, {hp: 100, armor: 100, alive: true})
})

test('infinite Scrap stays fixed through purchases and marks telemetry', () => {
  const world = new World({seed: 43, brains: idleBrains})
  world.setSandbox({invulnerable: false, infiniteScrap: true})
  assert.equal(world.player.scrap, 999999)
  assert.equal(world.phase, 'wave')
  assert.equal(world.purchase('sniper').ok, true)
  assert.equal(world.purchase('launcher').ok, true)
  assert.equal(world.player.scrap, 999999)
  assert.equal(world.player.ammo.sniper.owned, true)
  assert.equal(world.player.ammo.launcher.owned, true)
  assert.equal(world.telemetry.sandbox, true)
  assert.equal(buildWaveSummary(world.telemetry, {wave: 1}).sandbox, true)
})

test('sandbox director stays paused for 60 seconds and starts normal wave one on command', () => {
  const world = new World({seed: 44, brains: idleBrains})
  world.setSandbox({invulnerable: true, infiniteScrap: true})
  const director = new WaveDirector(world, {builtin: new BuiltinSkynet()})
  assert.equal(director.sandboxPaused, true)
  for (let tick = 0; tick < 60 * 60; tick += 1) director.step()
  assert.equal(world.units.length, 0)
  assert.equal(director.wave, 0)

  assert.equal(director.startWaves().ok, true)
  assert.equal(director.wave, 1)
  director.step()
  assert.ok(world.units.length > 0)
  const nextSpawn = director.nextSpawn
  const waveTime = world.waveTime()
  assert.equal(director.pauseWaves(), true)
  for (let tick = 0; tick < 60 * 60; tick += 1) director.step()
  assert.equal(director.nextSpawn, nextSpawn)
  assert.equal(world.waveTime(), waveTime)
})

test('spawning every catalog type at a point installs its configured brain', () => {
  const brains = Object.fromEntries(TYPES.map((type) => [type, {type, tick() {}}]))
  const world = new World({seed: 45, brains})
  for (const [index, type] of TYPES.entries()) {
    const point = {x: -10 + index * 3, y: 0, z: 10}
    const unit = world.spawnUnit(type, point)
    assert.equal(unit.type, type)
    assert.equal(unit.brain, brains[type])
    assert.equal(unit.pos.x, point.x)
    assert.equal(unit.pos.z, point.z)
  }
  assert.deepEqual(world.aliveUnits.map((unit) => unit.type), TYPES)
})

test('sandbox supplies every weapon with full ammunition', () => {
  const world = new World({seed: 46, brains: idleBrains})
  assert.equal(world.giveAllWeapons(), true)
  for (const id of world.weaponCatalog.slots) {
    assert.deepEqual(world.player.ammo[id], {
      owned: true,
      mag: world.weaponCatalog.weapons[id].mag,
      reserve: world.weaponCatalog.weapons[id].reserveMax,
    })
  }
  assert.equal(world.player.grenades, world.weaponCatalog.weapons.grenade.max)
})
