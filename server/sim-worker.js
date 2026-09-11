import {parentPort, workerData} from 'node:worker_threads'
import {selectGhost, simulate} from '../lib/core/sim/index.js'

console.info = () => {}

try {
  const telemetry = new Map(Object.entries(workerData.telemetryByWave || {}).map(([wave, value]) => [Number(wave), value]))
  const replays = new Map(Object.entries(workerData.replaysByWave || {}).map(([wave, value]) => [Number(wave), value]))
  const ghost = selectGhost(telemetry, replays, workerData.ghost)
  const result = simulate({
    waveConfig: {...workerData.waveConfig, wave: workerData.wave, applied_budget: workerData.budget},
    scripts: workerData.scripts,
    ghost,
    seed: workerData.seed,
    maxWallSeconds: 9.5,
  })
  parentPort.postMessage({ok: true, result})
} catch (error) {
  parentPort.postMessage({ok: false, error: String(error?.message || error)})
}
