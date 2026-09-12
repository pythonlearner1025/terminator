import assert from 'node:assert/strict'
import test from 'node:test'
import {measureColliderFit} from '../../tools/collider-fit.mjs'
import {World} from '../../lib/core/world.js'

const idleBrain = {tick() {}}
const brains = {scout: idleBrain, endo: idleBrain, heavy: idleBrain}
const PLAYER_RADIUS = 0.38

test('every prop movement and shot collider fits its visual bounds within five centimetres', async () => {
  const report = await measureColliderFit()
  for (const prop of report.props) {
    assert.ok(prop.movementBounds, `${prop.id} has no movement collider`)
    assert.ok(prop.shotBounds, `${prop.id} has no shot collider`)
    for (const [kind, fit] of [['movement', prop.overshoot], ['shot', prop.shotOvershoot]]) {
      for (const [side, errorCm] of Object.entries(fit)) {
        assert.ok(Math.abs(errorCm) <= 5.0001, `${prop.id} ${kind} ${side} differs by ${errorCm.toFixed(2)} cm`)
      }
    }
  }
})

test('player stops at the visible crate and barrel surfaces from four sides', () => {
  const fixtures = [
    {id: 'trader crate', center: {x: -7, z: 23}, half: {x: 1, z: 0.6}, y: 0.1},
    {id: 'burn barrel', center: {x: -4, z: 3}, radius: 0.395, y: 0},
  ]
  const approaches = [
    {axis: 'x', sign: -1, yaw: Math.PI / 2},
    {axis: 'x', sign: 1, yaw: -Math.PI / 2},
    {axis: 'z', sign: -1, yaw: 0},
    {axis: 'z', sign: 1, yaw: Math.PI},
  ]
  for (const fixture of fixtures) {
    for (const approach of approaches) {
      const world = new World({seed: 61, brains})
      const extent = fixture.radius ?? fixture.half[approach.axis]
      world.player.pos = {x: fixture.center.x, y: fixture.y, z: fixture.center.z}
      world.player.pos[approach.axis] += approach.sign * (extent + PLAYER_RADIUS + 0.9)
      world.player.vel = {x: 0, y: 0, z: 0}
      world.player.grounded = true
      world.player.airbornePeakY = null
      for (let tick = 0; tick < 90; tick += 1) {
        world.step({move: {x: 0, z: 1}, yaw: approach.yaw, crouch: true})
      }
      const distance = Math.abs(world.player.pos[approach.axis] - fixture.center[approach.axis])
      const clearance = distance - extent - PLAYER_RADIUS
      assert.ok(clearance >= -1e-6 && clearance <= 0.08,
        `${fixture.id} ${approach.axis}${approach.sign}: ${clearance.toFixed(3)} m from visible surface`)
    }
  }
})

test('hitscan misses prop and Endo silhouette air, then hits the skull', () => {
  const propWorld = new World({seed: 62, brains})
  const diagonal = Math.SQRT1_2
  const propMiss = propWorld.hitscan({
    origin: {x: 3, y: 0.7, z: 0.7},
    direction: {x: diagonal, y: 0, z: -diagonal},
    maxDistance: 3.4,
  })
  assert.equal(propMiss.kind, 'miss')

  const unitWorld = new World({seed: 63, brains})
  const endo = unitWorld.spawnUnit('endo', {x: 10, y: 0, z: 0}, {yaw: 0})
  const silhouetteMiss = unitWorld.hitscan({
    origin: {x: 10.36, y: 0.3, z: 5},
    direction: {x: 0, y: 0, z: -1},
    maxDistance: 10,
  })
  assert.equal(silhouetteMiss.kind, 'miss')
  const skull = unitWorld.hitscan({
    origin: {x: 10, y: 1.812, z: 5},
    direction: {x: 0, y: 0, z: -1},
    damage: 10,
    maxDistance: 10,
  })
  assert.equal(skull.kind, 'unit')
  assert.equal(skull.unitId, endo.id)
  assert.equal(skull.headshot, true)
  assert.equal(skull.hitPart, 'head')
})
