import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {createLobby, gameHeaders, json, startTestServer, waitFor} from './helpers.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('reference client --fake completes a two-wave scripted game loop', async (t) => {
  const fixture = await startTestServer()
  t.after(() => fixture.close())
  const lobby = await createLobby(fixture.url, {player_name: 'Fake Loop Player'})
  const base = `/api/lobby/${lobby.code}`
  const game = (route, options = {}) => json(fixture.url, `${base}${route}`, {...options, headers: gameHeaders(lobby)})
  await game('/game/wave_summary', {method: 'POST', body: {
    wave: 1,
    summary: {wave: 1, time_to_clear: 10, player_path: [{t: 0, x: 0, y: 0, z: 9}], shots: {pistol: {fired: 5, hits: 3}}},
    budget: 540,
    deadline_ms: Date.now() + 30_000,
  }})

  const child = spawn(process.execPath, [
    'packages/skynet-client/index.js',
    '--url', fixture.url,
    '--code', lobby.code,
    '--fake',
    '--poll-ms', '20',
    '--max-waves', '2',
  ], {cwd: repo, stdio: ['ignore', 'pipe', 'pipe']})
  t.after(() => child.kill())
  const exited = new Promise((resolve) => child.once('exit', resolve))
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  await waitFor(async () => (await json(fixture.url, `${base}/state`)).body.agent_ready_wave === 2, {timeoutMs: 15_000})
  const waveTwo = await game('/game/plan/2')
  assert.equal(waveTwo.body.fallback, false)
  assert.equal(waveTwo.body.scripts.scout.rev, 2)
  assert.equal(waveTwo.body.config.knobs.fog, 2)

  await game('/game/phase', {method: 'POST', body: {phase: 'wave', wave: 2, budget: 540, applied_config: waveTwo.body.config}})
  await game('/game/wave_summary', {method: 'POST', body: {
    wave: 2,
    summary: {wave: 2, time_to_clear: 9, player_path: [{t: 0, x: 1, y: 0, z: 9}], shots: {pistol: {fired: 4, hits: 3}}},
    budget: 660,
    deadline_ms: Date.now() + 30_000,
  }})

  await waitFor(async () => (await json(fixture.url, `${base}/state`)).body.agent_ready_wave === 3, {timeoutMs: 15_000})
  const waveThree = await game('/game/plan/3')
  assert.equal(waveThree.body.fallback, false)
  assert.equal(waveThree.body.scripts.scout.rev, 3)
  assert.equal(waveThree.body.config.spawns.length, 2)

  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`client did not exit\nstdout:\n${stdout}\nstderr:\n${stderr}`)), 10_000)
    exited.then((code) => { clearTimeout(timer); resolve(code) }, reject)
  })
  assert.equal(exitCode, 0, stderr)
  assert.match(stdout, /"event":"complete","waves":2/)
})
