import assert from 'node:assert/strict'
import test from 'node:test'
import * as scoutBrain from '../../../lib/core/brains/default-scout.js'
import {NAV_FUEL_COSTS} from '../../../lib/core/sandbox/index.js'
import {World} from '../../../lib/core/world.js'

const SCOUT_POS = {x: 0, y: 0, z: 13}

test('fuel exhaustion aborts the tick, preserves intent, and records fuelExhausted', () => {
  const source = 'export function tick() { while (true) {} }'
  const world = new World({scriptSources: {scout: source}})
  const unit = world.spawnUnit('scout', SCOUT_POS, {yaw: Math.PI})
  unit.intent.moveTo = {x: 2, y: 0, z: 13}
  const previousIntent = structuredClone(unit.intent)

  world.step()

  assert.deepEqual(unit.intent, previousIntent)
  assert.equal(world.telemetry.units[unit.id].fuelExhausted, 1)
  assert.deepEqual(
    world.eventLog.filter(({type}) => type === 'fuelExhausted').map(({unitId, rev}) => ({unitId, rev})),
    [{unitId: unit.id, rev: 1}],
  )
  assert.equal(unit.brain.lastFuel.exhausted, true)
  world.destroy()
})

test('a throwing script records script_error and uses the plain default brain afterward', () => {
  const source = 'export function tick() { throw new Error("boom") }'
  const world = new World({scriptSources: {scout: source}})
  const unit = world.spawnUnit('scout', SCOUT_POS, {yaw: Math.PI})

  world.step()

  const errors = world.eventLog.filter(({type}) => type === 'script_error')
  assert.equal(errors.length, 1)
  assert.equal(errors[0].unitId, unit.id)
  assert.equal(errors[0].rev, 1)
  assert.match(errors[0].message, /boom/)
  assert.equal(unit.brain, scoutBrain)
  for (let index = 0; index < 6; index += 1) world.step()
  assert.equal(world.eventLog.filter(({type}) => type === 'script_error').length, 1)
  world.destroy()
})

test('a parse failure at spawn records script_error and uses the plain default brain', () => {
  const world = new World({scriptSources: {scout: 'export function tick( {'}})
  const unit = world.spawnUnit('scout', SCOUT_POS, {yaw: Math.PI})

  const error = world.eventLog.find(({type}) => type === 'script_error')
  assert.equal(error.unitId, unit.id)
  assert.equal(error.rev, 1)
  assert.match(error.message, /SyntaxError/)
  assert.equal(unit.brain, scoutBrain)
  world.destroy()
})

test('mem persists across ticks and a value above 4 KB is rejected', () => {
  const source = `
    export function tick(self, sense, act, mem) {
      mem.count = (mem.count || 0) + 1
      if (mem.count === 3) mem.large = 'x'.repeat(5000)
    }
  `
  const world = new World({scriptSources: {scout: source}})
  const unit = world.spawnUnit('scout', SCOUT_POS, {yaw: Math.PI})

  stepUntil(world, 7)
  assert.equal(unit.mem.count, 2)
  stepUntil(world, 13)

  const error = world.eventLog.find(({type}) => type === 'script_error')
  assert.match(error.message, /limit is 4096 bytes/)
  assert.deepEqual(unit.mem, {})
  assert.equal(unit.brain, scoutBrain)
  world.destroy()
})

test('Date, Math.random, host globals, and constructor escapes are unavailable', () => {
  const source = `
    export function tick(self, sense, act, mem) {
      mem.types = [
        typeof Date,
        typeof Math.random,
        typeof fetch,
        typeof setTimeout,
        typeof process,
        globalThis.constructor.constructor('return typeof process')(),
        globalThis.constructor.constructor('return typeof window')(),
      ]
    }
  `
  const world = new World({scriptSources: {scout: source}})
  const unit = world.spawnUnit('scout', SCOUT_POS, {yaw: Math.PI})

  world.step()

  assert.deepEqual(unit.mem.types, Array(7).fill('undefined'))
  assert.equal(world.eventLog.some(({type}) => type === 'script_error'), false)
  world.destroy()
})

test('a nav host call charges its documented fuel cost', () => {
  const source = 'export function tick(self, sense) { sense.nav.canSee(self.pos) }'
  const world = new World({scriptSources: {scout: source}})
  const unit = world.spawnUnit('scout', SCOUT_POS, {yaw: Math.PI})

  world.step()

  assert.equal(unit.brain.lastFuel.navOperations, NAV_FUEL_COSTS.canSee)
  assert.equal(unit.brain.lastFuel.operations, NAV_FUEL_COSTS.canSee)
  world.destroy()
})

function stepUntil(world, tick) {
  while (world.tick < tick) world.step()
}
