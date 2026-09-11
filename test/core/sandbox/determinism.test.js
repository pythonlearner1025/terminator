import assert from 'node:assert/strict'
import test from 'node:test'
import * as endoBrain from '../../../lib/core/brains/default-endo.js'
import * as heavyBrain from '../../../lib/core/brains/default-heavy.js'
import * as scoutBrain from '../../../lib/core/brains/default-scout.js'
import {World} from '../../../lib/core/world.js'

const POSITIONS = [
  ['scout', -8, 13],
  ['endo', 0, 13],
  ['heavy', 8, 13],
  ['scout', -8, -13],
  ['endo', 0, -13],
  ['heavy', 8, -13],
]

test('sandboxed default brains match plain default brains for a 60 second run', {timeout: 30000}, () => {
  const sandboxed = createWorld(77)
  const plain = createWorld(77, {scout: scoutBrain, endo: endoBrain, heavy: heavyBrain})

  for (let tick = 0; tick < 60 * 60; tick += 1) {
    const inputs = scenarioInputs(tick)
    sandboxed.step(inputs)
    plain.step(inputs)
  }

  assert.deepEqual(snapshot(sandboxed), snapshot(plain))
  sandboxed.destroy()
  plain.destroy()
})

test('two full 120 second runs with sandboxed brains are deterministic', {timeout: 30000}, () => {
  const first = runSandboxScenario(2029, 120)
  const second = runSandboxScenario(2029, 120)
  assert.deepEqual(first, second)
  assert.equal(first.tick, 120 * 60)
})

function runSandboxScenario(seed, seconds) {
  const world = createWorld(seed)
  for (let tick = 0; tick < seconds * 60; tick += 1) world.step(scenarioInputs(tick))
  const result = snapshot(world)
  world.destroy()
  return result
}

function createWorld(seed, brains) {
  const world = new World({seed, ...(brains ? {brains} : {})})
  for (const [type, x, z] of POSITIONS) world.spawnUnit(type, {x, y: 0, z}, {yaw: Math.atan2(-x, 9 - z)})
  return world
}

function scenarioInputs(tick) {
  return {
    move: {x: Math.sin(tick / 90) * 0.25, z: Math.cos(tick / 120) * 0.2},
    yaw: Math.sin(tick / 180),
    pitch: Math.sin(tick / 240) * 0.05,
    fire: tick % 4 === 0,
    reload: tick % 180 === 120,
    sprint: tick % 240 < 80,
    crouch: tick % 300 > 270,
  }
}

function snapshot(world) {
  return {
    tick: world.tick,
    player: structuredClone(world.player),
    units: world.units.map((unit) => ({
      id: unit.id,
      type: unit.type,
      rev: unit.rev,
      hp: unit.hp,
      pos: structuredClone(unit.pos),
      vel: structuredClone(unit.vel),
      yaw: unit.yaw,
      alive: unit.alive,
      mem: structuredClone(unit.mem),
      intent: structuredClone(unit.intent),
    })),
    eventLog: structuredClone(world.eventLog),
    telemetry: structuredClone(world.telemetry),
  }
}
