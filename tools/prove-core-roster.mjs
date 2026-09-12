#!/usr/bin/env node
import {performance} from 'node:perf_hooks'
import {BuiltinSkynet} from '../lib/core/builtin-skynet.js'
import {simulate} from '../lib/core/sim/index.js'
import {configCost, waveBudget} from '../lib/core/waves.js'

const skynet = new BuiltinSkynet()
const rows = []
let playerDeaths = 0
let totalTicks = 0
let totalWallMs = 0

for (let wave = 1; wave <= 5; wave += 1) {
  const budget = waveBudget(wave).applied
  const config = skynet.plan({wave, budget, telemetry: null, scaling: {maxAlive: 24}})
  const inputs = Array.from({length: 240 * 60}, (_, tick) => ({
    switchTo: tick === 0 ? 5 : null,
    fire: true,
    reload: tick > 0 && tick % 660 === 500,
    move: {x: Math.floor(tick / 120) % 2 ? -0.7 : 0.7, z: 0},
    sprint: true,
  }))
  const startedAt = performance.now()
  const result = simulate({
    waveConfig: {wave, applied_budget: budget, ...config},
    ghost: {accuracy: {sniper: 1}, inputs},
    seed: 400 + wave,
    maxSeconds: 240,
  })
  const wallMs = performance.now() - startedAt
  const ticks = Math.round((result.time_to_clear ?? 240) * 60)
  playerDeaths += Number(result.player_died)
  totalTicks += ticks
  totalWallMs += wallMs
  rows.push({
    wave,
    units: Object.fromEntries(Object.entries(result.units).map(([type, stats]) => [type, stats.spawned])),
    boss: result.units.hktank?.spawned === 1,
    budget,
    cost: configCost(config),
    playerDied: result.player_died,
    clearSeconds: result.time_to_clear,
    tickMs: Number((wallMs / ticks).toFixed(4)),
  })
}

const proof = {
  rows,
  bossReached: rows.some((row) => row.wave === 5 && row.boss),
  playerDeaths,
  aggregateTickMs: Number((totalWallMs / totalTicks).toFixed(4)),
}
console.log(JSON.stringify(proof, null, 2))
if (!proof.bossReached || playerDeaths > 0 || rows.some((row) => row.clearSeconds == null)) process.exitCode = 1
