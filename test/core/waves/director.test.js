import {defaultMap as map} from '../../../lib/core/map.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import {BuiltinSkynet} from '../../../lib/core/builtin-skynet.js'
import scoutScriptSource from '../../../lib/core/brains/default-scout.script-src.js'
import {World} from '../../../lib/core/world.js'
import {
  WAVE_TIME_CAP_SECONDS,
  WaveDirector,
  buildRulesPayload,
  performanceMultiplier,
  validateWaveConfig,
  waveBudget,
} from '../../../lib/core/waves.js'

const idleBrain = {tick() {}}
// These tests drive the legacy spawn schedule and the phase machine, so they
// run with the in-wave pacer off. test/core/director covers the pacer itself.

test('state machine covers lobby, wave, intermission, ready, timeout, and ended', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {maxWaves: 2, intermissionSeconds: 1 / 60, now: () => 1000, pacer: false})
  assert.equal(director.phase, 'lobby')

  assert.equal(director.start(configFor(1)).ok, true)
  assert.equal(director.phase, 'wave')
  director.step({})
  killAll(world)
  director.step({})
  assert.equal(director.phase, 'intermission')
  assert.equal(director.submissionDeadlineMs, 1017)

  assert.equal(director.submitConfig({wave: 2, ...configFor(2)}, {atMs: 1001}).ok, true)
  director.step({})
  assert.equal(director.phase, 'wave', 'intermission timeout starts the queued wave')
  assert.equal(director.wave, 2)
  director.step({})
  killAll(world)
  director.step({})
  assert.equal(director.phase, 'ended')
  assert.deepEqual(director.events.history.filter(({type}) => type === 'phase').map(({phase}) => phase), [
    'lobby', 'wave', 'intermission', 'wave', 'ended',
  ])
})

test('ready ends the intermission early', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {builtin: new BuiltinSkynet(), intermissionSeconds: 15, pacer: false})
  director.start(configFor(1))
  director.step({})
  killAll(world)
  director.step({})
  assert.equal(director.intermissionTicksLeft, 15 * 60)
  director.submitConfig({wave: 2, ...configFor(2)})
  director.step({ready: true})
  assert.equal(director.phase, 'wave')
  assert.equal(director.wave, 2)
})

test('four minute cap makes current and future units abandon scripts and rush', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {pacer: false})
  director.start({
    spawns: [
      {t: 0, gate: 'N1', unit: 'scout', count: 1},
      {t: 300, gate: 'N1', unit: 'scout', count: 1},
    ],
    knobs: baseKnobs(['N1']),
  })
  director.step({})
  const originalBrain = world.aliveUnits[0].brain
  world.tick = WAVE_TIME_CAP_SECONDS * 60
  director.step({})
  assert.equal(director.rushActive, true)
  assert.notEqual(world.aliveUnits[0].brain, originalBrain)
  assert.deepEqual(world.aliveUnits[0].intent.moveTo, world.player.pos)
  assert.equal(director.spawnSchedule[1].t, WAVE_TIME_CAP_SECONDS)
  director.step({})
  assert.equal(world.units.length, 2)
  assert.notEqual(world.units[1].brain, originalBrain)
})

test('performance multiplier uses the exact three inputs and clamps both bounds', () => {
  assert.deepEqual(waveBudget(4), {base: 780, multiplier: 1, applied: 780})
  assert.equal(performanceMultiplier({healthLost: 0, timeToClear: 30, damagePerMinute: 0}), 1.1)
  assert.equal(performanceMultiplier({health_lost: 200, time_to_clear: 300, damage_per_minute: 400}), 0.9)
  assert.equal(performanceMultiplier({healthLost: 50, timeToClear: 120, damagePerMinute: 180}), 1.1)
})

test('validation returns all budget, gate, unit, id, and hazard errors without applying', () => {
  const invalid = {
    spawns: [
      {t: 0, gate: 'N1', unit: 'scout', count: 40},
      {t: 0, gate: 'N2', unit: 'endo', count: 3},
      {t: 1, gate: 'NOT_A_GATE', unit: 'not-a-unit', count: 1},
    ],
    knobs: {
      gates: ['N1', 'N2', 'E1', 'NOT_A_GATE'],
      doors: {not_a_door: 'locked'},
      lights: {not_a_light: 'off'},
      fog: 0,
      hazards: [{slot: 'not_a_slot', kind: 'electric'}],
      break_flank_wall: false,
    },
  }
  const validation = validateWaveConfig(invalid, {wave: 1, budget: 420})
  const codes = new Set(validation.errors.map(({code}) => code))
  for (const code of ['OVER_BUDGET', 'TOO_MANY_GATES', 'UNIT_BUDGET_CAP', 'UNKNOWN_GATE', 'UNKNOWN_UNIT', 'UNKNOWN_DOOR', 'UNKNOWN_LIGHT', 'UNKNOWN_HAZARD_SLOT']) {
    assert.equal(codes.has(code), true, `missing ${code}`)
  }

  const world = makeWorld()
  const director = new WaveDirector(world, {pacer: false})
  director.start(configFor(1))
  director.step({})
  killAll(world)
  director.step({})
  const appliedBefore = structuredClone(director.config)
  assert.equal(director.submitConfig({wave: 2, ...invalid}).ok, false)
  assert.deepEqual(director.config, appliedBefore)
  assert.equal(world.mapState.gates.includes('NOT_A_GATE'), false)
})

test('missing, invalid, and late submissions reuse the last valid config and count fallback', () => {
  const now = {value: 1000}
  const world = makeWorld()
  const director = new WaveDirector(world, {now: () => now.value, pacer: false})
  const first = configFor(1)
  director.start(first)
  director.step({})
  killAll(world)
  director.step({})

  const late = director.submitConfig({wave: 2, ...configFor(2)}, {atMs: director.submissionDeadlineMs + 1})
  assert.equal(late.ok, false)
  assert.equal(late.errors.some(({code}) => code === 'DEADLINE_MISSED'), true)
  director.ready(1)
  assert.equal(world.skynet.fallbackCount, 1)
  assert.deepEqual(director.config, first)
  let applied = director.events.history.filter(({type}) => type === 'config_applied').at(-1)
  assert.equal(applied.fallback, true)
  assert.equal(applied.reason, 'late_submission')
  assert.equal(applied.source, 'last_valid_config')

  director.step({})
  killAll(world)
  director.step({})
  const bad = director.submitConfig({wave: 3, spawns: [], knobs: baseKnobs([])})
  assert.equal(bad.ok, false)
  director.ready(2)
  assert.equal(world.skynet.fallbackCount, 2)
  applied = director.events.history.filter(({type}) => type === 'config_applied').at(-1)
  assert.equal(applied.reason, 'invalid_submission')
})

test('a missing submission uses the last valid config and reports the reason', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {pacer: false})
  const first = configFor(1)
  director.start(first)
  director.step({})
  killAll(world)
  director.step({})
  director.ready(1)
  const applied = director.events.history.filter(({type}) => type === 'config_applied').at(-1)
  assert.equal(applied.fallback, true)
  assert.equal(applied.reason, 'missing_submission')
  assert.equal(world.skynet.fallbackCount, 1)
  assert.deepEqual(director.config, first)
})

test('an invalid revision after a valid submission falls back to that last valid config', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {pacer: false})
  director.start(configFor(1))
  director.step({})
  killAll(world)
  director.step({})
  const valid = {
    spawns: [{t: 0, gate: 'E1', unit: 'endo', count: 1}],
    knobs: baseKnobs(['E1']),
  }
  assert.equal(director.submitConfig({wave: 2, ...valid}).ok, true)
  assert.equal(director.submitConfig({wave: 2, spawns: [], knobs: baseKnobs([])}).ok, false)
  director.ready(1)
  assert.deepEqual(director.config, valid)
  const applied = director.events.history.filter(({type}) => type === 'config_applied').at(-1)
  assert.equal(applied.fallback, true)
  assert.equal(applied.reason, 'invalid_submission')
  assert.equal(world.skynet.fallbackCount, 1)
})

test('player death ends the match and publishes a death wave summary', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {pacer: false})
  director.start(configFor(1))
  director.step({})
  world.damagePlayer(1000, world.aliveUnits[0])
  director.step({})
  assert.equal(director.phase, 'ended')
  const summary = director.events.history.find(({type}) => type === 'wave_summary')
  assert.equal(summary.player_died, true)
  assert.equal(summary.end_reason, 'player_dead')
  assert.equal(summary.time_to_clear, null)
  assert.ok(summary.duration_seconds > 0)
})

test('spawn and SSE events carry revisions, protocol names, and documented throttles', () => {
  const world = makeWorld()
  world.skynet.revs.scout = 7
  const director = new WaveDirector(world, {pacer: false})
  director.start(configFor(1))
  director.step({})
  const unit = world.aliveUnits[0]
  world.emit('script_error', {unitId: unit.id, unitType: unit.type, rev: unit.rev, message: 'bad tick'})
  world.emit('fuelExhausted', {unitId: unit.id, unitType: unit.type, rev: unit.rev})
  for (let index = 0; index < 10; index += 1) world.damagePlayer(1, unit)
  director.recordPurchase('armor', 30)
  world.damageUnit(unit.id, 999, {source: 'player', weapon: 'pistol'})
  director.step({})
  while (world.tick < 60) director.step({})

  const events = director.events.history
  const types = new Set(events.map(({type}) => type))
  for (const type of ['phase', 'wave_summary', 'damage', 'kill', 'unit_spawn', 'unit_death', 'player_pos', 'script_error', 'fuel_exhausted', 'purchase', 'config_applied']) {
    assert.equal(types.has(type), true, `missing event ${type}`)
  }
  assert.equal(events.filter(({type}) => type === 'damage').length, 5)
  assert.equal(events.find(({type}) => type === 'unit_spawn').rev, 7)
  assert.equal(events.find(({type}) => type === 'fuel_exhausted').unit_id, unit.id)
  assert.equal(events.filter(({type}) => type === 'player_pos').length, 1)
})

test('rules payload includes catalog, costs, formula, scripts, caps, and positioned map ids', () => {
  const rules = buildRulesPayload()
  assert.deepEqual(Object.keys(rules.unit_catalog.types).sort(), ['endo', 'heavy', 'hkaerial', 'hktank', 'scout', 't1000'])
  assert.equal(rules.map_knobs.costs.door, 30)
  assert.equal(rules.map_knobs.costs.hazard, 60)
  assert.deepEqual(rules.budget_formula.inputs, ['health_lost', 'time_to_clear', 'damage_per_minute'])
  assert.match(rules.default_scripts.scout, /export function tick/)
  assert.equal(rules.default_scripts.scout, scoutScriptSource)
  assert.deepEqual(rules.map_summary.gates.map(g=>g.id), map.spawnGates.map(g=>g.id))
  assert.equal(rules.map_summary.doors.every(({id, pos}) => id && Number.isFinite(pos.x)), true)
  assert.equal(rules.map_summary.light_zones.length, 3)
  assert.equal(rules.map_summary.hazard_slots.length, 2)
  assert.equal(rules.simulator.max_calls_per_intermission, 10)
  assert.equal(rules.caps.simulate_wall_seconds, 10)
})

function makeWorld() {
  return new World({seed: 2029, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})
}

function configFor() {
  return {
    spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
    knobs: baseKnobs(['N1']),
  }
}

function baseKnobs(gates) {
  return {gates, doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false}
}

function killAll(world) {
  for (const unit of world.aliveUnits) world.damageUnit(unit.id, 9999, {source: 'player', weapon: 'pistol'})
}
