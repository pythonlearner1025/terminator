import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import test from 'node:test'
import {World} from '../../../lib/core/world.js'
import {best, ghostFromWave, ghostInputAt, last, selectGhost, simulate} from '../../../lib/core/sim/index.js'

const idleBrain = {tick() {}}
const nativeFactory = () => idleBrain
const nonLethalDefaultFactory = ({fallback}) => ({
  tick(self, sense, act, mem) {
    fallback.tick(self, sense, {...act, fire() {}, melee() {}}, mem)
  },
})

test('ghost replays recorded movement and look within one centimeter', () => {
  const original = new World({seed: 9, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})
  for (let tick = 0; tick < 8 * 60; tick += 1) {
    original.step({
      move: {x: Math.sin(tick / 50) * 0.35, z: Math.cos(tick / 70) * 0.45},
      yaw: Math.sin(tick / 80),
      pitch: Math.cos(tick / 90) * 0.1,
      sprint: tick % 120 < 30,
      crouch: tick % 180 > 160,
      fire: tick % 11 === 0,
    })
  }
  const ghost = ghostFromWave(original.telemetry, original.replay)
  const replayed = new World({seed: 9, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})
  for (let tick = 0; tick < ghost.inputs.length; tick += 1) replayed.step({...ghostInputAt(ghost, tick), fire: false})
  assert.ok(Math.hypot(original.player.pos.x - replayed.player.pos.x, original.player.pos.z - replayed.player.pos.z) < 0.01)
  assert.equal(replayed.player.yaw, original.player.yaw)
  assert.equal(replayed.player.pitch, original.player.pitch)
})

test('last, best, and numeric ghost selectors choose the intended replay', () => {
  const telemetry = new Map([
    [1, {wave: 1, time_to_clear: 80, shots: {pistol: {fired: 10, hits: 5}}}],
    [2, {wave: 2, time_to_clear: 40, shots: {m4: {fired: 10, hits: 8}}}],
    [3, {wave: 3, time_to_clear: 70, shots: {shotgun: {fired: 10, hits: 6}}}],
  ])
  const replays = new Map([[1, [{}]], [2, [{yaw: 2}]], [3, [{yaw: 3}]]])
  assert.equal(last(telemetry, replays).wave, 3)
  assert.equal(best(telemetry, replays).wave, 2)
  assert.equal(selectGhost(telemetry, replays, 1).wave, 1)
  assert.equal(best(telemetry, replays).accuracy.m4, 0.8)
})

test('simulation is deterministic for a seed and returns the protocol result shape', () => {
  const ghost = {
    accuracy: {pistol: 1},
    inputs: Array.from({length: 20 * 60}, () => ({yaw: 0, pitch: 0, fire: true})),
  }
  const options = {
    waveConfig: {
      wave: 1,
      spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 4}],
      knobs: {gates: ['N1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
    },
    ghost,
    seed: 42,
    maxSeconds: 20,
    brainFactory: nativeFactory,
  }
  const first = simulate(options)
  const second = simulate(options)
  assert.deepEqual(first, second)
  assert.deepEqual(Object.keys(first), [
    'time_to_clear', 'player_died', 'damage_to_player', 'units', 'script_errors', 'fuel_exhausted', 'seed',
  ])
  assert.equal(first.seed, 42)
  assert.equal(first.units.scout.spawned, 4)
})

test('simulator uses the injected brain factory for submitted scripts', () => {
  const seen = []
  simulate({
    waveConfig: {
      spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
      knobs: {gates: ['N1']},
    },
    scripts: {scout: {source: 'export function tick() {}', rev: 7}},
    brainFactory(args) {
      seen.push({unitType: args.unitType, source: args.source})
      return idleBrain
    },
    maxSeconds: 0.1,
  })
  assert.deepEqual(seen.map(({unitType}) => unitType).sort(), ['endo', 'heavy', 'scout'])
  assert.match(seen.find(({unitType}) => unitType === 'scout').source, /export function tick/)
})

test('24 alive units simulate at least 30 times faster than real time', () => {
  const config = {
    spawns: [
      {t: 0, gate: 'N1', unit: 'heavy', count: 8},
      {t: 0, gate: 'E1', unit: 'heavy', count: 8},
      {t: 0, gate: 'S1', unit: 'heavy', count: 8},
    ],
    knobs: {gates: ['N1', 'E1', 'S1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
  }
  simulate({waveConfig: config, ghost: {inputs: [], accuracy: {}}, seed: 77, maxSeconds: 1, brainFactory: nonLethalDefaultFactory})
  let result
  let speed = 0
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = performance.now()
    result = simulate({waveConfig: config, ghost: {inputs: [], accuracy: {}}, seed: 77, maxSeconds: 30, brainFactory: nonLethalDefaultFactory})
    const wallSeconds = (performance.now() - startedAt) / 1000
    speed = Math.max(speed, 30 / wallSeconds)
  }
  assert.equal(result.units.heavy.spawned, 24)
  assert.equal(result.units.heavy.killed, 0)
  assert.equal(result.player_died, false)
  assert.ok(speed >= 30, `expected at least 30x, measured ${speed.toFixed(1)}x`)
})
