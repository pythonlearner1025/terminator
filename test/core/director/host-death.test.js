import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../../lib/core/world.js'
import {WaveDirector} from '../../../lib/core/waves.js'

const idleBrain = {tick() {}}
const config = {
  spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
  knobs: {gates: ['N1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
}

function makeWorld(seed = 91) {
  return new World({seed, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain, t1000: idleBrain, hkaerial: idleBrain, hktank: idleBrain}})
}

// The solo host is the only living player. When it dies the wave ends, and the
// pacer, the population and the straggler sweep all lose their target. Stepping
// must stay safe and must stay cheap: nothing may loop or throw on an empty roster.
test('the host dying mid-wave ends the match and 600 more steps stay quiet', t => {
  const world = makeWorld()
  t.after(() => world.destroy())
  const director = new WaveDirector(world)
  director.start(config)

  for (let tick = 0; tick < 120 && director.phase === 'wave'; tick += 1) director.step({})
  assert.equal(director.phase, 'wave', 'the wave is running before the kill')

  world.damagePlayer(999, {id: 'unit-1', type: 'scout', pos: {x: 0, y: 0, z: 0}}, world.hostPlayerId)
  assert.equal(world.livingPlayers.length, 0, 'the host is dead')
  director.step({})
  assert.equal(director.phase, 'ended', 'no living player ends the wave')
  assert.equal(world.phase, 'ended')

  const tickAtEnd = world.tick
  const errors = world.eventLog.filter(({type}) => type === 'script_error').length
  for (let step = 0; step < 600; step += 1) director.step({})
  assert.equal(world.tick, tickAtEnd, 'an ended match stops the simulation clock')
  assert.equal(world.eventLog.filter(({type}) => type === 'script_error').length, errors, 'no error is raised after the end')
  assert.equal(director.phase, 'ended')
})
