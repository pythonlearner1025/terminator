import assert from 'node:assert/strict'
import test from 'node:test'
import {BuiltinSkynet} from '../../../lib/core/builtin-skynet.js'
import {POPULATION} from '../../../lib/core/population.js'
import {validateWaveConfig, waveBudget} from '../../../lib/core/waves.js'

test('built-in Skynet produces valid deterministic plans for waves 1 to 10 with empty telemetry', () => {
  const skynet = new BuiltinSkynet()
  for (let wave = 1; wave <= 10; wave += 1) {
    const budget = waveBudget(wave).applied
    const first = skynet.plan({wave, budget, telemetry: null})
    const second = skynet.plan({wave, budget, telemetry: null})
    assert.deepEqual(first, second)
    assert.equal(validateWaveConfig(first, {wave, budget, requireUnits: false}).ok, true, `wave ${wave}`)
  }
})

test('the plan holds gates, the boss group, and the population numbers only', () => {
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
    assert.deepEqual(Object.keys(config).sort(), ['knobs', 'population', 'spawns'])
    assert.equal(validateWaveConfig(config, {wave, budget, requireUnits: false}).ok, true, `wave ${wave}`)
    // The deck owns lights, fog, and doors now.
    assert.equal(config.knobs.fog, 0)
    assert.deepEqual(config.knobs.lights, {})
    assert.deepEqual(config.knobs.doors, {})
    assert.ok(config.knobs.gates.length > 0 && config.knobs.gates.length <= 3)
    const bossWave = wave === 5 || wave === 10
    assert.deepEqual(config.spawns.map(({unit}) => unit), bossWave ? ['hktank'] : [], `wave ${wave} spawns`)
    assert.deepEqual(config.population.mobIntervalSeconds, POPULATION.mobIntervalSeconds)
    assert.deepEqual(config.population.specials.t1000, POPULATION.specials.t1000)
  }
})

test('the hottest heatmap cell still decides which gates are hot', () => {
  const skynet = new BuiltinSkynet()
  const west = skynet.plan({wave: 4, budget: 780, telemetry: {heatmap: {'2:20': 40}}})
  const east = skynet.plan({wave: 4, budget: 780, telemetry: {heatmap: {'38:20': 40}}})
  assert.notDeepEqual(west.knobs.gates, east.knobs.gates)
})
