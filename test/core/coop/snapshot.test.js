import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../../lib/core/world.js'

const idleBrain = {tick() {}}
const brains = {scout: idleBrain, endo: idleBrain, heavy: idleBrain}

test('a snapshot JSON round trip reproduces subsequent deterministic steps', () => {
  const original = new World({seed: 77})
  original.addPlayer({id: 'guest-1', name: 'Kyle'})
  original.spawnUnit('scout', {x: 5, y: 0, z: 12}, {yaw: Math.PI})
  for (let tick = 0; tick < 30; tick += 1) original.step({
    player: {move: {x: 0.1, z: 0.2}, yaw: tick / 100},
    'guest-1': {move: {x: -0.2, z: 0.1}, yaw: -tick / 120},
  })

  const json = JSON.stringify(original.snapshot())
  const restored = new World({seed: 1}).applySnapshot(JSON.parse(json))
  for (let tick = 0; tick < 120; tick += 1) {
    const bundle = {
      player: {move: {x: Math.sin(tick / 20) * 0.2, z: 0.15}, yaw: tick / 80, fire: tick % 17 === 0},
      'guest-1': {move: {x: 0.1, z: Math.cos(tick / 25) * 0.2}, yaw: -tick / 90, fire: tick % 19 === 0},
    }
    original.step(bundle)
    restored.step(bundle)
  }

  assert.deepEqual(restored.snapshot(), original.snapshot())
})

test('predictPlayer matches one step of the shared movement code', () => {
  const source = new World({seed: 9, brains})
  source.addPlayer({id: 'guest-1', name: 'Sarah'})
  const snapshot = JSON.parse(JSON.stringify(source.snapshot()))
  const stepped = new World({brains}).applySnapshot(snapshot)
  const predicted = new World({brains}).applySnapshot(snapshot)
  const inputs = {move: {x: 0.35, z: 0.8}, yaw: 0.7, pitch: -0.1, sprint: true}

  stepped.step({'guest-1': inputs})
  predicted.predictPlayer('guest-1', inputs)

  assert.deepEqual(predicted.getPlayer('guest-1'), stepped.getPlayer('guest-1'))
  assert.equal(predicted.tick, source.tick, 'prediction does not advance authoritative world time')
})
