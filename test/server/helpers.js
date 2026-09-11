import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createLobbyServer} from '../../server/lobby-server.js'

export async function startTestServer(options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'terminator-server-'))
  const server = createLobbyServer({dataDir, logger: {info() {}, error() {}}, ...options})
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    server,
    url,
    dataDir,
    async close() {
      server.closeAll?.()
      await new Promise((resolve) => server.close(resolve))
      await rm(dataDir, {recursive: true, force: true})
    },
  }
}

export async function createLobby(url, body = {}) {
  const response = await fetch(`${url}/api/lobby`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  })
  return response.json()
}

export async function json(url, route, {method = 'GET', body} = {}) {
  const response = await fetch(`${url}${route}`, {
    method,
    headers: {'Content-Type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  })
  return {status: response.status, body: await response.json()}
}

export const validConfig = {
  spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
  knobs: {gates: ['N1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
}

export const validScript = 'export function tick(self, sense, act, mem) { const target = sense.player?.pos || self.pos; act.moveTo(target); act.face(target) }'

export async function waitFor(check, {timeoutMs = 10_000, intervalMs = 25} = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw lastError || new Error(`condition was not met within ${timeoutMs} ms`)
}
