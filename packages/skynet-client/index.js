#!/usr/bin/env node
import {validateWaveConfig} from '../../lib/core/waves.js'
import {validateScript} from '../../server/script-validator.js'

const args = parseArgs(process.argv.slice(2))
if (!args.url || !/^[A-Z0-9]{6}$/.test(args.code || '')) {
  console.error('Usage: terminator-skynet-client --url http://localhost:7801 --code ABC123 [--fake]')
  process.exit(1)
}

const baseUrl = `${args.url.replace(/\/$/, '')}/api/lobby/${args.code}`
const pollMs = positiveNumber(args['poll-ms'], 500)
const maxWaves = positiveNumber(args['max-waves'], Infinity)
let token = ''
let handled = 0
let handledTargetWave = 0

const joined = await api('POST', '/join', {
  name: args.name || (args.fake ? 'Fake Skynet' : 'Reference Skynet'),
  agent_info: {client: 'terminator-skynet-client', model: args.fake ? 'scripted-fake' : process.env.SKYNET_MODEL || 'claude-sonnet-5'},
}, {allowError: true})
if (!joined.ok && joined.error) throw new Error(`join failed: ${joined.error}`)
token = joined.token || ''
process.stdout.write(`${JSON.stringify({event: 'joined', code: args.code, name: joined.state?.agent?.name})}\n`)

for (;;) {
  const state = await api('GET', '/state')
  if (state.phase === 'ended') break
  const targetWave = state.wave + 1
  if (state.phase === 'intermission' && targetWave !== handledTargetWave) {
    await playIntermission(state, targetWave)
    handledTargetWave = targetWave
    handled += 1
    process.stdout.write(`${JSON.stringify({event: 'handled_wave', wave: targetWave})}\n`)
    if (handled >= maxWaves) break
  }
  await sleep(pollMs)
}

process.stdout.write(`${JSON.stringify({event: 'complete', waves: handled})}\n`)
process.exit(0)

async function playIntermission(state, targetWave) {
  const [rules, dossier, telemetry] = await Promise.all([
    api('GET', '/rules'),
    api('GET', '/dossier'),
    state.wave > 0 ? api('GET', `/telemetry/${state.wave}`) : Promise.resolve(null),
  ])
  const proposal = args.fake
    ? fakeProposal(targetWave, dossier)
    : await askAnthropic({state, rules, telemetry, dossier, targetWave})
  const config = {spawns: proposal.spawns, knobs: proposal.knobs}
  const validation = validateWaveConfig(config, {wave: targetWave, budget: state.budget})
  if (!validation.ok) throw new Error(`model returned invalid wave config: ${validation.errors.map((item) => `${item.code}: ${item.message}`).join('; ')}`)

  const scripts = {}
  for (const item of proposal.scripts || []) {
    const result = await validateScript({unitType: item.unit_type, source: item.source})
    if (!result.ok) throw new Error(`model returned invalid ${item.unit_type} script: ${result.error}`)
    scripts[item.unit_type] = item.source
  }

  const simulation = await api('POST', '/simulate', {wave_config: config, scripts, ghost: 'last', seed: proposal.seed || targetWave * 2029})
  if (!simulation.ok) throw new Error(`simulation failed: ${simulation.error}`)
  for (const item of proposal.scripts || []) await expectOk(api('POST', '/script', item), `script ${item.unit_type}`)
  await expectOk(api('POST', '/wave_config', {wave: targetWave, ...config}), 'wave config')
  await expectOk(api('PUT', '/dossier', proposal.dossier), 'dossier')
  const taunt = await api('POST', '/taunt', {text: proposal.taunt}, {allowError: true})
  if (!taunt.ok && taunt.error !== 'TAUNT_RATE_LIMIT') throw new Error(`taunt failed: ${taunt.error}`)
  await expectOk(api('POST', '/ready', {wave: targetWave}), 'ready')
}

async function askAnthropic(context) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required unless --fake is used')
  const {default: Anthropic} = await import('@anthropic-ai/sdk')
  const client = new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY})
  const response = await client.messages.create({
    model: process.env.SKYNET_MODEL || 'claude-sonnet-5',
    max_tokens: 3000,
    system: 'You play Skynet in a wave FPS. Return only one JSON object with spawns, knobs, scripts, dossier, taunt, and seed. Respect every rule and budget. Scripts are optional and must export tick.',
    messages: [{role: 'user', content: JSON.stringify(context)}],
  })
  const text = response.content.filter((item) => item.type === 'text').map((item) => item.text).join('')
  return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''))
}

function fakeProposal(wave, dossier) {
  const source = `export function tick(self, sense, act, mem) {
  const target = sense.player?.pos || sense.lastKnownPlayer?.pos || sense.nav.gates[0]?.pos
  if (!target) return act.stop()
  act.moveTo(target)
  act.face(target)
  if (sense.player) { act.aimAt(target); if (self.type === 'scout') act.melee(); else act.fire() }
}`
  return {
    spawns: wave >= 3
      ? [{t: 0, gate: 'N1', unit: 'scout', count: 1}, {t: 1, gate: 'E1', unit: 'endo', count: 1}]
      : [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
    knobs: {
      gates: wave >= 3 ? ['N1', 'E1'] : ['N1'],
      doors: {building_ground: 'locked'},
      lights: {courtyard: 'off'},
      fog: 2,
      hazards: [],
      break_flank_wall: false,
    },
    scripts: [{unit_type: 'scout', source, note: `fake model wave ${wave}`}],
    dossier: {
      markdown: `${dossier.markdown || ''}\nObserved through wave ${wave - 1}.`.trim(),
      traits: [{key: 'sample_count', value: wave - 1, confidence: Math.min(1, wave / 10)}],
    },
    taunt: `WAVE ${wave} CONFIGURATION ACCEPTED`,
    seed: wave * 2029,
  }
}

async function api(method, route, body, {allowError = false} = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  })
  const result = await response.json()
  if (!response.ok && !allowError) throw new Error(`${method} ${route} failed with HTTP ${response.status}: ${JSON.stringify(result)}`)
  return result
}

async function expectOk(promise, label) {
  const result = await promise
  if (!result.ok) throw new Error(`${label} failed: ${JSON.stringify(result)}`)
  return result
}

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    if (key === 'fake') result.fake = true
    else {
      result[key] = values[index + 1]
      index += 1
    }
  }
  return result
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return parsed > 0 ? parsed : fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
