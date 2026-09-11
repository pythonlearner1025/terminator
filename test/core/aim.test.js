import assert from 'node:assert/strict'
import test from 'node:test'
import {EMPTY_INPUTS, normalizeInputs, World} from '../../lib/core/world.js'
import {projectViewModel} from '../../lib/core/viewmodel.js'
import {ghostFromWave, ghostInputAt} from '../../lib/core/sim/ghost.js'

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
const speed = world => Math.hypot(world.player.vel.x, world.player.vel.z)
const walking = {move: {x: 0, z: 1}, yaw: Math.PI}

for (const id of ['pistol', 'm4', 'shotgun', 'plasma']) {
  test(`${id}: aiming reduces actual hitscan scatter and projected spread to 35%`, () => {
    const sample = aim => {
      const world = new World({seed: 2029})
      world.player.ammo[id].owned = true
      const rays = []
      const hitscan = world.hitscan.bind(world)
      world.hitscan = options => {
        rays.push({yaw: Math.atan2(options.direction.x, options.direction.z), pitch: Math.asin(options.direction.y)})
        return hitscan(options)
      }
      while (world.telemetry.shots[id].fired < 30) {
        world.step({aim, fire: true, switchTo: world.tick === 0 ? id : null,
          reload: world.player.ammo[id].mag === 0})
        if (world.player.ammo[id].reserve === 0) world.player.ammo[id].reserve = 100
        assert.ok(world.tick < 4000, '30 shots finish')
      }
      const view = projectViewModel(world)
      assert.equal(view.weapon.aiming, aim)
      close(view.weapon.spread, world.playerSpread)
      close(view.crosshair.spread, world.playerSpread)
      return {world, rays}
    }
    const hip = sample(false), ads = sample(true)
    close(ads.world.playerSpread, hip.world.playerSpread * 0.35)
    assert.equal(ads.rays.length, 30 * (ads.world.weaponCatalog.weapons[id].pellets || 1))
    for (let i = 0; i < hip.rays.length; i++) {
      close(ads.rays[i].yaw, hip.rays[i].yaw * 0.35)
      close(ads.rays[i].pitch, hip.rays[i].pitch * 0.35)
    }
  })
}

test('aiming moves at 60% speed, refuses sprint, and preserves stamina', () => {
  const world = new World({seed: 1})
  world.player.pos = {x: 5, y: 0, z: 10}
  world.step(walking)
  close(speed(world), 5)
  world.step({...walking, sprint: true})
  close(speed(world), 7.5)
  const stamina = world.player.sprintStamina
  world.step({...walking, aim: true, sprint: true})
  close(speed(world), 3)
  assert.ok(world.player.sprintStamina >= stamina)
  world.step({...walking, aim: true, crouch: true})
  close(speed(world), 2.6 * 0.6)
  world.step(walking)
  close(speed(world), 5)
  assert.equal(world.player.aiming, false)
})

test('reload immediately suppresses aim, speed penalty and firing, then held aim resumes', () => {
  const world = new World()
  world.player.pos = {x: 5, y: 0, z: 10}
  world.step({aim: true, fire: true})
  world.step({...walking, aim: true, reload: true, fire: true, sprint: true})
  assert.equal(world.player.aiming, false)
  close(speed(world), 7.5)
  close(world.playerSpread, 1.5)
  assert.equal(world.telemetry.shots.pistol.fired, 1)
  while (world.player.reloadTimer > 1 / 60) {
    world.step({aim: true, fire: true})
    assert.equal(world.player.aiming, false)
  }
  world.step({aim: true})
  assert.equal(world.player.aiming, true)
  close(world.playerSpread, 0.525)
})

test('knife and grenade quick actions ignore held aim until the action ends', () => {
  for (const action of ['melee', 'grenade']) {
    const world = new World()
    world.step({aim: true})
    assert.equal(world.player.aiming, true)
    world.step({aim: true, [action]: true})
    assert.equal(world.player.aiming, false)
    world.step({aim: true})
    assert.equal(world.player.aiming, false)
    for (let i = 0; i < 61; i++) world.step({aim: true})
    assert.equal(world.player.aiming, true)
  }
})

test('aim defaults false for old records and survives deterministic ghost replay', () => {
  assert.equal(EMPTY_INPUTS.aim, false)
  assert.equal(normalizeInputs({}).aim, false)
  assert.equal(ghostInputAt(ghostFromWave({}, [{}]), 0).aim, false)
  assert.equal(ghostInputAt(null, 0).aim, false)
  const original = new World({seed: 9})
  for (let i = 0; i < 120; i++) original.step({
    move: {x: 0.2, z: 0.1}, yaw: i / 300, aim: i % 60 < 30, sprint: true, fire: true,
    reload: i === 90,
  })
  const ghost = ghostFromWave(original.telemetry, original.replay)
  const replayed = new World({seed: 9})
  for (let i = 0; i < ghost.inputs.length; i++) {
    assert.equal(ghostInputAt(ghost, i).aim, i % 60 < 30)
    replayed.step(ghostInputAt(ghost, i))
  }
  assert.deepEqual(replayed.player, original.player)
  assert.deepEqual(replayed.eventLog, original.eventLog)
})
