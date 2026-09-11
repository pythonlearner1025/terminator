#!/usr/bin/env node
import {performance} from 'node:perf_hooks'
import {World} from '../lib/core/world.js'

const idle = {tick(self, sense, act, mem) { mem.ticks = (mem.ticks || 0) + 1; act.stop() }}
const world = new World({seed: 2029, brains: {scout: idle, endo: idle, heavy: idle}})
for (let index = 0; index < 24; index += 1) {
  const angle = index / 24 * Math.PI * 2
  const type = ['scout', 'endo', 'heavy'][index % 3]
  world.spawnUnit(type, {x: Math.sin(angle) * 20, y: 0, z: Math.cos(angle) * 20}, {yaw: angle + Math.PI})
}
const ticks = 120 * 60
const start = performance.now()
for (let tick = 0; tick < ticks; tick += 1) world.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0})
const wallSeconds = (performance.now() - start) / 1000
const multiple = 120 / wallSeconds
console.log(JSON.stringify({simulatedSeconds: 120, wallSeconds: Number(wallSeconds.toFixed(3)), realtimeMultiple: Number(multiple.toFixed(1)), aliveUnits: world.aliveUnits.length, ticks: world.tick}))
if (world.aliveUnits.length !== 24 || multiple < 30) process.exitCode = 1
