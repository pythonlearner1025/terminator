import {Worker} from 'node:worker_threads'

export const UNIT_TYPES = new Set(['scout', 'endo', 'heavy'])

export function validateScript({unitType, source, current}, {timeoutMs = 5_000} = {}) {
  if (!UNIT_TYPES.has(unitType)) return Promise.resolve({ok: false, error: `unknown unit type: ${unitType}`, smoke_log: []})
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./script-smoke-worker.js', import.meta.url), {
      workerData: {unitType, source, current},
      resourceLimits: {maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, stackSizeMb: 1},
    })
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate().catch(() => {})
      resolve(result)
    }
    const timer = setTimeout(() => finish({ok: false, error: 'script smoke run timed out', smoke_log: []}), timeoutMs)
    worker.once('message', finish)
    worker.once('error', (error) => finish({ok: false, error: String(error.message || error), smoke_log: []}))
    worker.once('exit', (code) => {
      if (code !== 0) finish({ok: false, error: `script smoke worker exited with code ${code}`, smoke_log: []})
    })
  })
}
