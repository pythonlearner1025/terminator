import assert from 'node:assert/strict'
import test from 'node:test'
import {performanceMultiplier, validateWaveConfig, waveBudget} from '../../lib/core/waves.js'

test('budget formula uses 300 + 120 N and multiplier stays in bounds', () => {
  assert.deepEqual(waveBudget(4), {base: 780, multiplier: 1, applied: 780})
  assert.equal(performanceMultiplier({healthLost: 0, timeToClear: 30, damagePerMinute: 0}), 1.5)
  assert.equal(performanceMultiplier({healthLost: 200, timeToClear: 300, damagePerMinute: 400}), 0.8)
})

test('config validation lists over budget, gate count and unknown ids together', () => {
  const config = {
    spawns: [
      {t: 0, gate: 'N1', unit: 'scout', count: 20},
      {t: 1, gate: 'NO_GATE', unit: 'unknown-unit', count: 1},
    ],
    knobs: {
      gates: ['N1', 'N2', 'E1', 'NO_GATE'],
      doors: {missing_door: 'locked'},
      lights: {missing_light: 'off'},
      fog: 0,
      hazards: [],
      break_flank_wall: false,
    },
  }
  const result = validateWaveConfig(config, {wave: 1, budget: 420})
  const codes = result.errors.map(({code}) => code)
  assert.equal(result.ok, false)
  assert.ok(codes.includes('OVER_BUDGET'))
  assert.ok(codes.includes('TOO_MANY_GATES'))
  assert.ok(codes.includes('UNKNOWN_GATE'))
  assert.ok(codes.includes('UNKNOWN_UNIT'))
  assert.ok(codes.includes('UNKNOWN_DOOR'))
  assert.ok(codes.includes('UNKNOWN_LIGHT'))
  assert.ok(result.errors.length >= 7)
})
