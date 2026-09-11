import assert from 'node:assert/strict'
import test from 'node:test'
import {BuiltinSkynet} from '../../../lib/core/builtin-skynet.js'
import {validateWaveConfig, waveBudget} from '../../../lib/core/waves.js'

test('built-in Skynet produces valid deterministic configs for waves 1 to 10 with empty telemetry', () => {
  const skynet = new BuiltinSkynet()
  for (let wave = 1; wave <= 10; wave += 1) {
    const budget = waveBudget(wave).applied
    const first = skynet.plan({wave, budget, telemetry: null})
    const second = skynet.plan({wave, budget, telemetry: null})
    assert.deepEqual(first, second)
    assert.equal(validateWaveConfig(first, {wave, budget}).ok, true, `wave ${wave}`)
  }
})

test('built-in Skynet counters rich telemetry while remaining valid for waves 1 to 10', () => {
  const telemetry = {
    shots: {
      pistol: {fired: 20, hits: 8},
      m4: {fired: 120, hits: 96},
      shotgun: {fired: 10, hits: 6},
      plasma: {fired: 20, hits: 16},
    },
    heatmap: {'3:4': 1, '22:14': 50},
    doorUses: {tunnel_w: 2, building_ground: 12},
    healthLost: 5,
    timeToClear: 45,
    damagePerMinute: 7,
  }
  const skynet = new BuiltinSkynet()
  for (let wave = 1; wave <= 10; wave += 1) {
    const budget = waveBudget(wave, telemetry).applied
    const config = skynet.plan({wave, budget, telemetry})
    assert.equal(validateWaveConfig(config, {wave, budget}).ok, true, `wave ${wave}`)
    assert.equal(config.knobs.fog, 3)
    if (wave % 3 === 0) assert.equal(Object.values(config.knobs.lights).includes('off'), true)
    if (wave >= 5) assert.equal(config.knobs.doors.building_ground, 'locked')
    if (wave >= 5) assert.equal(config.spawns[0].unit, 'heavy')
  }
})
