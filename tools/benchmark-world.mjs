#!/usr/bin/env node
import {performance} from 'node:perf_hooks'
import {World} from '../lib/core/world.js'

const world = new World({seed: 2029})
world.scaling.maxAlive = 36
world.player.hp = 1e9
world.player.armor = 1e9
const types = ['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank']
for (let index = 0; index < 36; index += 1) {
  const angle = index / 36 * Math.PI * 2
  const type = types[index % types.length]
  world.spawnUnit(type, {x: Math.sin(angle) * 22, y: type === 'hkaerial' ? 4.5 : 0, z: Math.cos(angle) * 22}, {yaw: angle + Math.PI})
}
for (let tick = 0; tick < 600; tick += 1) world.step({})
const ticks = 60 * 60
const samples = []
const start = performance.now()
for (let tick = 0; tick < ticks; tick += 1) {
  const before = performance.now()
  world.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0})
  samples.push(performance.now() - before)
}
const wallSeconds = (performance.now() - start) / 1000
const sorted = [...samples].sort((a, b) => a - b)
const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]
const max = sorted.at(-1)
const multiple = 60 / wallSeconds
console.log(JSON.stringify({simulatedSeconds: 60, wallSeconds: Number(wallSeconds.toFixed(3)), realtimeMultiple: Number(multiple.toFixed(1)), aliveUnits: world.aliveUnits.length, ticks: ticks, tickMs: {mean: Number(mean.toFixed(4)), p99: Number(p99.toFixed(4)), max: Number(max.toFixed(4))}}))
if (world.aliveUnits.length !== 36 || p99 >= 4) process.exitCode = 1
