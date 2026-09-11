import assert from 'node:assert/strict'
import {readdir} from 'node:fs/promises'
import test from 'node:test'
import {createLobby, json, startTestServer, validConfig, validScript} from './helpers.js'

test('all lobby HTTP endpoints complete a match relay lifecycle', async (t) => {
  const fixture = await startTestServer()
  t.after(() => fixture.close())
  const created = await createLobby(fixture.url, {code: 'ABC123', player_name: 'Sarah Connor'})
  assert.match(created.code, /^[A-Z0-9]{6}$/)
  assert.equal(created.base_url, `${fixture.url}/api/lobby/${created.code}`)
  const base = `/api/lobby/${created.code}`

  const joined = await json(fixture.url, `${base}/join`, {method: 'POST', body: {name: 'Test Skynet', agent_info: {model: 'fake'}}})
  assert.equal(joined.status, 200)
  assert.ok(joined.body.token)
  assert.equal((await json(fixture.url, `${base}/join`, {method: 'POST', body: {name: 'Second'}})).body.error, 'AGENT_ALREADY_JOINED')

  const rules = await json(fixture.url, `${base}/rules`)
  assert.equal(rules.body.script_api_version, 1)
  assert.equal(rules.body.map_summary.gates.length, 6)
  assert.equal(rules.body.simulator.max_calls_per_intermission, 10)

  const summary = {wave: 1, time_to_clear: 12, player_path: [{t: 0, x: 0, y: 0, z: 9}], shots: {pistol: {fired: 3, hits: 2}}}
  const intermission = await json(fixture.url, `${base}/game/wave_summary`, {method: 'POST', body: {wave: 1, summary, budget: 540, deadline_ms: Date.now() + 30_000}})
  assert.equal(intermission.body.ok, true)
  assert.deepEqual((await json(fixture.url, `${base}/telemetry/1`)).body, summary)

  const script = await json(fixture.url, `${base}/script`, {method: 'POST', body: {unit_type: 'scout', source: validScript, note: 'test'}})
  assert.deepEqual(script.body, {ok: true, rev: 2})
  const config = await json(fixture.url, `${base}/wave_config`, {method: 'POST', body: {wave: 2, ...validConfig}})
  assert.deepEqual(config.body, {ok: true, cost: 40, budget: 540})

  const simulation = await json(fixture.url, `${base}/simulate`, {method: 'POST', body: {wave_config: validConfig, scripts: {scout: validScript}, ghost: 'last', seed: 42}})
  assert.equal(simulation.body.ok, true)
  assert.equal(simulation.body.result.seed, 42)

  const written = await json(fixture.url, `${base}/dossier`, {method: 'PUT', body: {markdown: 'Prefers the courtyard.', traits: [{key: 'camps', value: 'courtyard', confidence: 0.8}]}})
  assert.equal(written.body.ok, true)
  assert.equal((await json(fixture.url, `${base}/dossier`)).body.traits[0].key, 'camps')
  assert.equal((await json(fixture.url, `${base}/taunt`, {method: 'POST', body: {text: 'YOU CANNOT HIDE'}})).body.ok, true)
  assert.equal((await json(fixture.url, `${base}/ready`, {method: 'POST', body: {wave: 2}})).body.ok, true)

  const plan = await json(fixture.url, `${base}/game/plan/2`)
  assert.equal(plan.body.fallback, false)
  assert.equal(plan.body.scripts.scout.rev, 2)
  await json(fixture.url, `${base}/game/phase`, {method: 'POST', body: {phase: 'wave', wave: 2, budget: 540, applied_config: plan.body.config}})
  const state = await json(fixture.url, `${base}/state`)
  assert.equal(state.body.phase, 'wave')
  assert.equal(state.body.agent.name, 'Test Skynet')

  assert.equal((await json(fixture.url, `${base}/game/events`, {method: 'POST', body: {event: {type: 'purchase', wave: 2, t: 1, item: 'armor', price: 30}}})).body.delivered, 1)
  assert.equal((await json(fixture.url, `${base}/game/match_end`, {method: 'POST', body: {stats: {wave: 2, won: true}}})).body.ok, true)
  const files = await readdir(fixture.dataDir)
  assert.ok(files.some((name) => name.startsWith('dossier-')))
  assert.ok(files.some((name) => name.startsWith('match-ABC123-')))
})

test('wave config returns every core validation error', async (t) => {
  const fixture = await startTestServer()
  t.after(() => fixture.close())
  const created = await createLobby(fixture.url)
  const base = `/api/lobby/${created.code}`
  await json(fixture.url, `${base}/game/wave_summary`, {method: 'POST', body: {wave: 2, summary: {}, budget: 660, deadline_ms: Date.now() + 30_000}})
  const result = await json(fixture.url, `${base}/wave_config`, {method: 'POST', body: {
    wave: 3,
    spawns: [
      {t: -1, gate: 'BAD', unit: 'unknown', count: 0},
      {t: 0, gate: 'N1', unit: 'heavy', count: 3},
    ],
    knobs: {
      gates: ['N1', 'N2', 'E1', 'BAD'],
      doors: {missing: 'jammed'},
      lights: {void: 'dim'},
      fog: 8,
      hazards: [{slot: 'missing', kind: 'lava'}],
      break_flank_wall: false,
    },
  }})
  assert.equal(result.body.ok, false)
  const codes = new Set(result.body.errors.map((item) => item.code))
  for (const expected of ['TOO_MANY_GATES', 'UNKNOWN_GATE', 'UNKNOWN_DOOR', 'INVALID_DOOR_STATE', 'UNKNOWN_LIGHT', 'INVALID_LIGHT_STATE', 'INVALID_FOG', 'UNKNOWN_HAZARD_SLOT', 'INVALID_SPAWN_TIME', 'UNKNOWN_UNIT', 'INVALID_COUNT', 'UNIT_BUDGET_CAP', 'TOO_FEW_UNIT_TYPES', 'OVER_BUDGET']) {
    assert.ok(codes.has(expected), `missing ${expected}: ${JSON.stringify(result.body.errors)}`)
  }
})

test('taunt and simulation caps return protocol errors', async (t) => {
  const fixture = await startTestServer()
  t.after(() => fixture.close())
  const created = await createLobby(fixture.url)
  const base = `/api/lobby/${created.code}`
  await json(fixture.url, `${base}/game/wave_summary`, {method: 'POST', body: {wave: 1, summary: {}, budget: 540, deadline_ms: Date.now() + 30_000}})

  assert.equal((await json(fixture.url, `${base}/taunt`, {method: 'POST', body: {text: 'X'.repeat(81)}})).body.error, 'TAUNT_LENGTH')
  assert.equal((await json(fixture.url, `${base}/taunt`, {method: 'POST', body: {text: 'FIRST'}})).body.ok, true)
  assert.equal((await json(fixture.url, `${base}/taunt`, {method: 'POST', body: {text: 'SECOND'}})).body.error, 'TAUNT_RATE_LIMIT')

  for (let index = 0; index < 10; index += 1) {
    const result = await json(fixture.url, `${base}/simulate`, {method: 'POST', body: {wave_config: validConfig, ghost: 'last', seed: index + 1}})
    assert.equal(result.body.ok, true, JSON.stringify(result.body))
  }
  const capped = await json(fixture.url, `${base}/simulate`, {method: 'POST', body: {wave_config: validConfig, ghost: 'last', seed: 11}})
  assert.equal(capped.status, 429)
  assert.equal(capped.body.error, 'SIMULATION_CAP_REACHED')
})

test('late config is not applied and increments fallback exactly once', async (t) => {
  let clock = 1_000
  const fixture = await startTestServer({now: () => clock})
  t.after(() => fixture.close())
  const created = await createLobby(fixture.url)
  const base = `/api/lobby/${created.code}`
  await json(fixture.url, `${base}/join`, {method: 'POST', body: {name: 'Slow Agent'}})
  await json(fixture.url, `${base}/game/wave_summary`, {method: 'POST', body: {wave: 1, summary: {}, budget: 540, deadline_ms: 1_100}})
  clock = 1_101
  const late = await json(fixture.url, `${base}/wave_config`, {method: 'POST', body: {wave: 2, spawns: validConfig.spawns, knobs: {...validConfig.knobs, fog: 3}}})
  assert.equal(late.body.errors[0].code, 'DEADLINE_PASSED')
  const state = await json(fixture.url, `${base}/state`)
  assert.equal(state.body.fallback_count, 1)
  assert.equal(state.body.applied_config.knobs.fog, 0)
  await json(fixture.url, `${base}/game/plan/2?force=1`)
  assert.equal((await json(fixture.url, `${base}/state`)).body.fallback_count, 1)
})
