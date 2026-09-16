import assert from 'node:assert/strict'
import test from 'node:test'
import {WaveDirector} from '../../../lib/core/waves.js'
import {World} from '../../../lib/core/world.js'

const idleBrain = {tick() {}}

test('health resets to 100 when a wave is cleared', () => {
  const world = new World({seed: 2029, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})
  // Legacy schedule only: the pacer has its own tests under test/core/director.
  const director = new WaveDirector(world, {maxWaves: 3, intermissionSeconds: 1, now: () => 1000, pacer: false})
  assert.equal(director.start({
    spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
    knobs: {gates: ['N1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
  }).ok, true)
  director.step({})
  world.damagePlayer(40, {type: 'test'})
  assert.equal(world.player.hp, 60, 'damage lands before the wave ends')
  for (const unit of world.aliveUnits) world.damageUnit(unit.id, 9999, {source: 'player', weapon: 'pistol'})
  director.step({})
  assert.equal(director.phase, 'intermission')
  assert.equal(world.player.hp, 100, 'wave clear restores full health')
})
