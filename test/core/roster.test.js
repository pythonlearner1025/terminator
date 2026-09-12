import assert from 'node:assert/strict'
import test from 'node:test'
import {BuiltinSkynet} from '../../lib/core/builtin-skynet.js'
import {World} from '../../lib/core/world.js'
import {projectViewModel} from '../../lib/core/viewmodel.js'
import {WaveDirector, configCost, isBossWave, unlockedUnitTypes, validateWaveConfig, waveBudget} from '../../lib/core/waves.js'

test('normal built-in waves unlock the roster and spend through unit cost', () => {
  const skynet = new BuiltinSkynet()
  const expected = [
    ['scout:4', 'endo:1'],
    ['heavy:1', 'scout:3', 'endo:1'],
    ['hkaerial:1', 'heavy:1', 'scout:1'],
    ['t1000:1', 'hkaerial:1', 'scout:2', 'endo:1'],
    ['hktank:1', 't1000:1', 'hkaerial:1', 'heavy:1'],
  ]
  const costs = [260, 520, 640, 760, 880]
  for (let wave = 1; wave <= 5; wave += 1) {
    const budget = waveBudget(wave).applied
    const config = skynet.plan({wave, budget, telemetry: null, scaling: {maxAlive: 24}})
    assert.deepEqual(config.spawns.map(({unit, count}) => `${unit}:${count}`), expected[wave - 1])
    assert.equal(configCost(config), costs[wave - 1])
    assert.equal(validateWaveConfig(config, {wave, budget}).ok, true)
    assert.equal(config.spawns.every(({unit}) => unlockedUnitTypes(wave).includes(unit)), true)
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
