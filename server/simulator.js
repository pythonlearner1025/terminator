import {Worker} from 'node:worker_threads'

export function runSimulation({waveConfig, wave, budget, scripts, ghost, telemetryByWave, replaysByWave, seed}, {timeoutMs = 10_000} = {}) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./sim-worker.js', import.meta.url), {
      workerData: {waveConfig, wave, budget, scripts, ghost, telemetryByWave, replaysByWave, seed},
      resourceLimits: {maxOldGenerationSizeMb: 128},
    })
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate().catch(() => {})
      resolve(result)
    }
    const timer = setTimeout(() => finish({ok: false, error: 'simulation exceeded the 10 second wall time cap'}), timeoutMs)
    worker.once('message', finish)
    worker.once('error', (error) => finish({ok: false, error: String(error.message || error)}))
    worker.once('exit', (code) => {
      if (code !== 0) finish({ok: false, error: `simulation worker exited with code ${code}`})
    })
  })
}
