import assert from 'node:assert/strict'
import test from 'node:test'
import {BuiltinSkynet} from '../../lib/core/builtin-skynet.js'
import {World} from '../../lib/core/world.js'
import {projectViewModel} from '../../lib/core/viewmodel.js'
import {WaveDirector, configCost, isBossWave, unlockedUnitTypes, validateWaveConfig, waveBudget} from '../../lib/core/waves.js'

test('the pacer unlock waves match the roster, and the plan itself spends nothing', () => {
  const skynet = new BuiltinSkynet()
  for (let wave = 1; wave <= 5; wave += 1) {
    const budget = waveBudget(wave).applied
    const config = skynet.plan({wave, budget, telemetry: null, scaling: {maxAlive: 32}})
    const bossOnly = isBossWave(wave) ? ['hktank:1'] : []
    assert.deepEqual(config.spawns.map(({unit, count}) => `${unit}:${count}`), bossOnly)
    assert.equal(configCost(config), 0, 'the whole budget reaches the pacer reservoir')
    assert.equal(validateWaveConfig(config, {wave, budget, requireUnits: false}).ok, true)
    assert.equal(config.spawns.every(({unit}) => unlockedUnitTypes(wave).includes(unit)), true)
    for (const [type, spec] of Object.entries(config.population.specials)) {
      assert.equal(unlockedUnitTypes(spec.unlockWave).includes(type), true, `${type} unlocks on wave ${spec.unlockWave}`)
      if (spec.unlockWave > 1) assert.equal(unlockedUnitTypes(spec.unlockWave - 1).includes(type), false, `${type} is locked one wave earlier`)
    }
  }
})

test('boss phases occur only on waves five and ten', () => {
  assert.deepEqual(Array.from({length: 10}, (_, index) => index + 1).filter(isBossWave), [5, 10])
  assert.equal(unlockedUnitTypes(5).includes('hktank'), true)
  assert.equal(unlockedUnitTypes(6).includes('hktank'), false)
})

test('wave five projects its boss phase and live boss health', () => {
  const world = new World({seed: 55})
  const director = new WaveDirector(world, {builtin: new BuiltinSkynet()})
  director.wave = 4
  assert.equal(director.start().ok, true)
  director.step({})
  const view = projectViewModel(world)
  assert.equal(view.wave.boss, true)
  assert.deepEqual(view.boss, {name: 'HK-Tank', hp: 6000, hpMax: 6000})
})

test('wave ten marks the finale and its summary lists all six unit types', () => {
  const world = new World({seed: 56})
  const director = new WaveDirector(world, {builtin: new BuiltinSkynet()})
  director.wave = 9
  assert.equal(director.start().ok, true)
  director.step({})
  assert.equal(projectViewModel(world).wave.finale, true)
  const summary = director.finishWave()
  assert.equal(summary.boss, true)
  assert.equal(summary.finale, true)
  assert.deepEqual(Object.keys(summary.unit_types).sort(), ['endo', 'heavy', 'hkaerial', 'hktank', 'scout', 't1000'])
})
