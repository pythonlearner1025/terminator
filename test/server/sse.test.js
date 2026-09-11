import assert from 'node:assert/strict'
import test from 'node:test'
import {createLobby, json, startTestServer} from './helpers.js'

test('SSE delivers every documented event type', async (t) => {
  const fixture = await startTestServer()
  t.after(() => fixture.close())
  const created = await createLobby(fixture.url)
  const base = `/api/lobby/${created.code}`
  const controller = new AbortController()
  t.after(() => controller.abort())
  const response = await fetch(`${fixture.url}${base}/events`, {signal: controller.signal})
  assert.equal(response.status, 200)
  const received = collectSse(response.body, controller)

  const events = [
    {type: 'damage', wave: 1, t: 1, amount: 5, unit_type: 'scout', unit_id: 's1', headshot: false, player_facing_attacker: true},
    {type: 'kill', wave: 1, t: 2, unit_type: 'scout', unit_id: 's1', weapon: 'pistol', distance: 4, headshot: true},
    {type: 'unit_spawn', wave: 1, t: 0, unit_type: 'scout', unit_id: 's1', rev: 2, cause: null},
    {type: 'unit_death', wave: 1, t: 2, unit_type: 'scout', unit_id: 's1', rev: 2, cause: 'pistol'},
    {type: 'player_pos', wave: 1, t: 1, pos: {x: 0, y: 0, z: 9}, yaw: 0, hp: 95, armor: 0, weapon: 'pistol'},
    {type: 'script_error', wave: 1, t: 1, unit_type: 'scout', unit_id: 's1', rev: 2, message: 'bad'},
    {type: 'fuel_exhausted', wave: 1, t: 1, unit_type: 'scout', unit_id: 's1', rev: 2},
    {type: 'purchase', wave: 1, t: 3, item: 'armor', price: 30},
    {type: 'config_applied', wave: 1, t: 0, fallback: false},
    {type: 'wave_summary', wave: 1, t: 4, time_to_clear: 4},
    {type: 'phase', wave: 1, t: 0, phase: 'intermission', deadline_ms: Date.now() + 10_000},
  ]
  const posted = await json(fixture.url, `${base}/game/events`, {method: 'POST', body: {events}})
  assert.equal(posted.body.delivered, events.length)

  const all = await received
  const types = new Set(all.map((event) => event.type))
  for (const type of ['phase', 'wave_summary', 'damage', 'kill', 'unit_spawn', 'unit_death', 'player_pos', 'script_error', 'fuel_exhausted', 'purchase', 'config_applied']) {
    assert.ok(types.has(type), `missing ${type}: ${JSON.stringify(all)}`)
  }
})

async function collectSse(body, controller) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const results = []
  let buffer = ''
  const target = 11
  const timeout = setTimeout(() => controller.abort(), 3_000)
  try {
    while (results.length < target) {
      const {done, value} = await reader.read()
      if (done) break
      buffer += decoder.decode(value, {stream: true})
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() || ''
      for (const chunk of chunks) {
        const data = chunk.split('\n').find((line) => line.startsWith('data: '))
        if (data) results.push(JSON.parse(data.slice(6)))
      }
    }
    return results
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}
