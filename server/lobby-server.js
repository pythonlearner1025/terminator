import http from 'node:http'
import {createHash, randomBytes, randomInt} from 'node:crypto'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {BuiltinSkynet} from '../lib/core/builtin-skynet.js'
import {buildRulesPayload, validateWaveConfig, waveBudget} from '../lib/core/waves.js'
import {validateScript, UNIT_TYPES} from './script-validator.js'
import {runSimulation} from './simulator.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA_DIR = path.join(dirname, 'data')
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const SSE_TYPES = new Set([
  'phase',
  'wave_summary',
  'damage',
  'kill',
  'unit_spawn',
  'unit_death',
  'player_pos',
  'script_error',
  'fuel_exhausted',
  'purchase',
  'config_applied',
])
const AGENT_WRITE_ROUTES = new Set(['/wave_config', '/script', '/simulate', '/dossier', '/taunt', '/ready'])
const defaultScripts = {
  scout: readFileSync(new URL('../lib/core/brains/default-scout.js', import.meta.url), 'utf8'),
  endo: readFileSync(new URL('../lib/core/brains/default-endo.js', import.meta.url), 'utf8'),
  heavy: readFileSync(new URL('../lib/core/brains/default-heavy.js', import.meta.url), 'utf8'),
}

export function createLobbyServer({dataDir = DEFAULT_DATA_DIR, logger = console, now = () => Date.now()} = {}) {
  const lobbies = new Map()
  const sockets = new Set()
  const server = http.createServer(async (request, response) => {
    const started = now()
    let logged = false
    const url = new URL(request.url || '/', 'http://localhost')
    const log = () => {
      if (logged) return
      logged = true
      logger.info?.(`${new Date(now()).toISOString()} ${request.method} ${url.pathname} ${response.statusCode} ${Math.max(0, now() - started)}ms`)
    }
    response.on('finish', log)
    setCors(response)
    if (request.method === 'OPTIONS') return sendJson(response, 204, null)

    try {
      if (request.method === 'GET' && url.pathname === '/health') return sendJson(response, 200, {ok: true, lobbies: lobbies.size})
      if (request.method === 'POST' && url.pathname === '/api/lobby') {
        const body = await readJson(request)
        const requested = typeof body.code === 'string' ? body.code.toUpperCase() : ''
        const code = /^[A-Z0-9]{6}$/.test(requested) && !lobbies.has(requested) ? requested : makeCode(lobbies)
        const lobby = await makeLobby({code, body, dataDir, now})
        lobbies.set(code, lobby)
        const origin = `http://${request.headers.host || 'localhost:7801'}`
        return sendJson(response, 201, {
          code,
          base_url: `${origin}/api/lobby/${code}`,
          game_token: lobby.gameToken,
          state: publicState(lobby),
        })
      }

      const match = url.pathname.match(/^\/api\/lobby\/([A-Z0-9]{6})(\/.*)?$/)
      if (!match) return sendError(response, 404, 'NOT_FOUND', 'route not found')
      const lobby = lobbies.get(match[1])
      if (!lobby) return sendError(response, 404, 'LOBBY_NOT_FOUND', 'lobby not found')
      const route = match[2] || '/'
      if (route.startsWith('/game/') && request.headers['x-game-token'] !== lobby.gameToken) {
        return sendError(response, 401, 'GAME_AUTH_FAILED', 'valid game token required')
      }
      if (AGENT_WRITE_ROUTES.has(route) && request.method !== 'GET') {
        if (!lobby.agent) return sendError(response, 401, 'AGENT_REQUIRED', 'an agent must join before submitting')
        if (bearerToken(request) !== lobby.agent.token) return sendError(response, 401, 'AGENT_AUTH_FAILED', 'valid agent token required')
      }

      if (request.method === 'POST' && route === '/join') {
        const body = await readJson(request)
        if (lobby.agent) return sendError(response, 409, 'AGENT_ALREADY_JOINED', 'this lobby already has an agent')
        const name = String(body.name || '').trim().slice(0, 40)
        if (!name) return sendError(response, 400, 'INVALID_AGENT_NAME', 'name is required')
        lobby.agent = {name, agentInfo: clone(body.agent_info || {}), token: randomBytes(24).toString('base64url'), joinedAt: now()}
        return sendJson(response, 200, {
          token: lobby.agent.token,
          rules: rulesFor(lobby),
          dossier: clone(lobby.dossier),
          state: publicState(lobby),
        })
      }

      if (request.method === 'GET' && route === '/state') return sendJson(response, 200, publicState(lobby))
      if (request.method === 'GET' && route === '/rules') return sendJson(response, 200, rulesFor(lobby))
      if (request.method === 'GET' && route === '/dossier') return sendJson(response, 200, clone(lobby.dossier))

      const telemetryMatch = route.match(/^\/telemetry\/(\d+)$/)
      if (request.method === 'GET' && telemetryMatch) {
        const telemetry = lobby.telemetry.get(Number(telemetryMatch[1]))
        return telemetry
          ? sendJson(response, 200, clone(telemetry))
          : sendError(response, 404, 'TELEMETRY_NOT_FOUND', 'telemetry for that wave is not available')
      }

      if (request.method === 'GET' && route === '/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        })
        response.write(`data: ${JSON.stringify({type: 'phase', phase: lobby.phase, wave: lobby.wave, t: 0, ...(lobby.deadlineMs ? {deadline_ms: lobby.deadlineMs} : {})})}\n\n`)
        lobby.clients.add(response)
        const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000)
        heartbeat.unref?.()
        request.on('close', () => {
          clearInterval(heartbeat)
          lobby.clients.delete(response)
        })
        log()
        return
      }

      if (request.method === 'POST' && route === '/wave_config') {
        const body = await readJson(request)
        const targetWave = Number(body.wave)
        if (!Number.isInteger(targetWave) || targetWave < 1) {
          return sendJson(response, 400, {ok: false, errors: [{path: 'wave', code: 'INVALID_WAVE', message: 'wave must be a positive integer'}]})
        }
        if (lobby.phase !== 'intermission') {
          return sendJson(response, 409, {ok: false, errors: [{path: 'wave', code: 'NOT_INTERMISSION', message: 'wave configs are accepted during intermission'}]})
        }
        if (targetWave !== lobby.wave + 1) {
          return sendJson(response, 409, {ok: false, errors: [{path: 'wave', code: 'WRONG_WAVE', message: `expected wave ${lobby.wave + 1}`} ]})
        }
        if (lobby.deadlineMs && now() > lobby.deadlineMs) {
          resolvePlan(lobby, targetWave, {force: true, now: now()})
          return sendJson(response, 409, {ok: false, errors: [{path: 'wave', code: 'DEADLINE_PASSED', message: 'the intermission submission deadline has passed'}]})
        }
        const config = {spawns: body.spawns, knobs: body.knobs}
        const validation = validateWaveConfig(config, {wave: targetWave, budget: lobby.budget})
        if (!validation.ok) return sendJson(response, 400, {ok: false, errors: validation.errors})
        lobby.pendingConfigs.set(targetWave, {config: clone(config), cost: validation.cost, budget: validation.budget, submittedAt: now()})
        lobby.lastValidConfig = clone(config)
        return sendJson(response, 200, {ok: true, cost: validation.cost, budget: validation.budget})
      }

      if (request.method === 'POST' && route === '/script') {
        const body = await readJson(request)
        const previous = lobby.scripts[body.unit_type]
        const current = previous ? {rev: previous.rev, source: previous.source} : null
        const result = await validateScript({unitType: body.unit_type, source: body.source, current})
        if (!result.ok) return sendJson(response, 400, result)
        const accepted = {
          unit_type: body.unit_type,
          source: String(body.source),
          note: String(body.note || '').slice(0, 500),
          rev: result.rev,
          accepted_at: now(),
        }
        lobby.scripts[body.unit_type] = accepted
        return sendJson(response, 200, {ok: true, rev: accepted.rev})
      }

      if (request.method === 'POST' && route === '/simulate') {
        const body = await readJson(request)
        const key = `${lobby.phase}:${lobby.wave}:${lobby.deadlineMs || 0}`
        const used = lobby.simulateCounts.get(key) || 0
        if (used >= 10) return sendJson(response, 429, {ok: false, error: 'SIMULATION_CAP_REACHED'})
        lobby.simulateCounts.set(key, used + 1)
        const targetWave = lobby.phase === 'intermission' ? lobby.wave + 1 : Math.max(1, lobby.wave)
        const config = body.wave_config || lobby.pendingConfigs.get(targetWave)?.config || lobby.appliedConfig
        if (!config) return sendJson(response, 400, {ok: false, error: 'NO_WAVE_CONFIG'})
        const validation = validateWaveConfig(config, {wave: targetWave, budget: lobby.budget || waveBudget(targetWave).applied})
        if (!validation.ok) return sendJson(response, 400, {ok: false, error: validation.errors.map((item) => item.code).join(', ')})
        const ghostResult = resolveGhost(lobby, body.ghost)
        if (!ghostResult.ok) return sendJson(response, 400, ghostResult)
        const scripts = body.scripts || Object.fromEntries(Object.entries(lobby.scripts).map(([type, item]) => [type, item.source]))
        for (const [unitType, item] of Object.entries(scripts || {})) {
          const source = typeof item === 'string' ? item : item?.source
          const scriptResult = await validateScript({unitType, source})
          if (!scriptResult.ok) return sendJson(response, 400, {ok: false, error: `${unitType}: ${scriptResult.error}`})
        }
        const seed = Number.isFinite(Number(body.seed)) ? Number(body.seed) : 2029
        const result = await runSimulation({
          waveConfig: config,
          wave: targetWave,
          budget: validation.budget,
          scripts,
          ghost: ghostResult.selector,
          telemetryByWave: Object.fromEntries(lobby.telemetry),
          replaysByWave: Object.fromEntries(lobby.replays),
          seed,
        })
        return sendJson(response, result.ok ? 200 : 500, result)
      }

      if (request.method === 'PUT' && route === '/dossier') {
        const body = await readJson(request)
        const traits = Array.isArray(body.traits) ? body.traits : []
        const errors = validateTraits(traits)
        if (errors.length) return sendJson(response, 400, {ok: false, errors})
        lobby.dossier = {markdown: String(body.markdown || ''), traits: clone(traits)}
        await saveDossier(lobby, dataDir)
        return sendJson(response, 200, {ok: true})
      }

      if (request.method === 'POST' && route === '/taunt') {
        const body = await readJson(request)
        const text = String(body.text || '')
        if (!text || text.length > 80) return sendJson(response, 400, {ok: false, error: 'TAUNT_LENGTH'})
        if (now() - lobby.lastTauntAt < 20_000) return sendJson(response, 429, {ok: false, error: 'TAUNT_RATE_LIMIT'})
        lobby.lastTauntAt = now()
        lobby.transmission = text
        return sendJson(response, 200, {ok: true})
      }

      if (request.method === 'POST' && route === '/ready') {
        const body = await readJson(request)
        if (!Number.isInteger(Number(body.wave))) return sendJson(response, 400, {ok: false, error: 'INVALID_WAVE'})
        lobby.readyWave = Number(body.wave)
        return sendJson(response, 200, {ok: true})
      }

      if (request.method === 'POST' && route === '/game/events') {
        const body = await readJson(request)
        const events = Array.isArray(body.events) ? body.events : body.event ? [body.event] : []
        let delivered = 0
        for (const event of events) {
          const normalized = normalizeGameEvent(event)
          if (!normalized || !allowEvent(lobby, normalized, now())) continue
          broadcast(lobby, normalized)
          delivered += 1
        }
        return sendJson(response, 200, {ok: true, delivered})
      }

      if (request.method === 'POST' && route === '/game/phase') {
        const body = await readJson(request)
        if (!['lobby', 'wave', 'intermission', 'ended'].includes(body.phase)) return sendError(response, 400, 'INVALID_PHASE', 'unknown phase')
        lobby.phase = body.phase
        lobby.wave = Number.isInteger(Number(body.wave)) ? Number(body.wave) : lobby.wave
        lobby.deadlineMs = Number.isFinite(Number(body.deadline_ms)) ? Number(body.deadline_ms) : body.phase === 'intermission' ? lobby.deadlineMs : null
        if (Number.isFinite(Number(body.budget))) lobby.budget = Number(body.budget)
        if (body.applied_config) lobby.appliedConfig = clone(body.applied_config)
        broadcast(lobby, {type: 'phase', phase: lobby.phase, wave: lobby.wave, t: Number(body.t) || 0, ...(lobby.deadlineMs ? {deadline_ms: lobby.deadlineMs} : {})})
        return sendJson(response, 200, {ok: true})
      }

      if (request.method === 'POST' && route === '/game/wave_summary') {
        const body = await readJson(request)
        const wave = Number(body.wave)
        if (!Number.isInteger(wave) || wave < 1 || !body.summary || typeof body.summary !== 'object') {
          return sendError(response, 400, 'INVALID_WAVE_SUMMARY', 'wave and summary are required')
        }
        lobby.telemetry.set(wave, clone(body.summary))
        if (Array.isArray(body.replay)) lobby.replays.set(wave, clone(body.replay))
        lobby.wave = wave
        lobby.phase = 'intermission'
        lobby.deadlineMs = Number.isFinite(Number(body.deadline_ms)) ? Number(body.deadline_ms) : now() + 45_000
        lobby.budget = Number.isFinite(Number(body.budget)) ? Number(body.budget) : waveBudget(wave + 1, body.summary).applied
        broadcast(lobby, {type: 'wave_summary', wave, t: Number(body.summary.timeToClear ?? body.summary.time_to_clear ?? 0), ...clone(body.summary)})
        broadcast(lobby, {type: 'phase', phase: 'intermission', wave, t: 0, deadline_ms: lobby.deadlineMs})
        return sendJson(response, 200, {ok: true, deadline_ms: lobby.deadlineMs, budget: lobby.budget})
      }

      const planMatch = route.match(/^\/game\/plan\/(\d+)$/)
      if (request.method === 'GET' && planMatch) {
        const targetWave = Number(planMatch[1])
        if (targetWave !== lobby.wave + 1) return sendError(response, 409, 'WRONG_WAVE', `expected wave ${lobby.wave + 1}`)
        const plan = resolvePlan(lobby, targetWave, {force: url.searchParams.get('force') === '1', now: now()})
        if (!plan) return sendJson(response, 202, {ok: false, waiting: true, deadline_ms: lobby.deadlineMs})
        return sendJson(response, 200, plan)
      }

      if (request.method === 'POST' && route === '/game/match_end') {
        const body = await readJson(request)
        lobby.phase = 'ended'
        lobby.deadlineMs = null
        await persistMatch(lobby, body.stats || body, dataDir, now())
        broadcast(lobby, {type: 'phase', phase: 'ended', wave: lobby.wave, t: Number(body.t) || 0})
        return sendJson(response, 200, {ok: true})
      }

      return sendError(response, 404, 'NOT_FOUND', 'route not found')
    } catch (error) {
      if (!response.headersSent) sendError(response, error.statusCode || 500, error.code || 'INTERNAL_ERROR', error.statusCode ? error.message : 'internal server error')
      else response.end()
    }
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.closeAll = () => {
    for (const lobby of lobbies.values()) for (const client of lobby.clients) client.end()
    for (const socket of sockets) socket.destroy()
  }
  server.lobbies = lobbies
  return server
}

async function makeLobby({code, body, dataDir, now}) {
  const playerName = String(body.player_name || 'Resistance Fighter').trim().slice(0, 80) || 'Resistance Fighter'
  const dossier = await loadDossier(playerName, dataDir)
  return {
    code,
    playerName,
    gameToken: randomBytes(24).toString('base64url'),
    createdAt: now(),
    phase: 'lobby',
    wave: 0,
    budget: waveBudget(1).applied,
    deadlineMs: null,
    appliedConfig: null,
    pendingConfigs: new Map(),
    appliedPlans: new Map(),
    fallbackWaves: new Set(),
    fallbackCount: 0,
    lastValidConfig: null,
    telemetry: new Map(),
    replays: new Map(),
    scripts: {},
    simulateCounts: new Map(),
    agent: null,
    readyWave: 0,
    lastTauntAt: -Infinity,
    transmission: '',
    dossier,
    clients: new Set(),
    damageTimes: [],
  }
}

function publicState(lobby) {
  return {
    code: lobby.code,
    phase: lobby.phase,
    wave: lobby.wave,
    budget: lobby.budget,
    deadline_ms: lobby.deadlineMs,
    applied_config: clone(lobby.appliedConfig),
    script_revs: Object.fromEntries([...UNIT_TYPES].map((type) => [type, lobby.scripts[type]?.rev || 1])),
    fallback_count: lobby.fallbackCount,
    agent: lobby.agent ? {name: lobby.agent.name, agent_info: clone(lobby.agent.agentInfo)} : null,
    agent_ready_wave: lobby.readyWave,
    transmission: lobby.transmission,
  }
}

function rulesFor(lobby) {
  return {
    ...buildRulesPayload(),
    default_scripts: clone(defaultScripts),
    caps: {simulate_calls_per_intermission: 10, simulate_wall_seconds: 10, taunt_chars: 80, taunt_interval_seconds: 20},
    current_budget: lobby.budget,
  }
}

function resolvePlan(lobby, targetWave, {force = false, now = Date.now()} = {}) {
  if (lobby.appliedPlans.has(targetWave)) return clone(lobby.appliedPlans.get(targetWave))
  const pending = lobby.pendingConfigs.get(targetWave)
  let config = pending?.config
  let fallback = false
  let reason = null
  if (!config && lobby.agent && !force && (!lobby.deadlineMs || now <= lobby.deadlineMs)) return null
  if (!config) {
    fallback = true
    if (lobby.agent) {
      reason = 'agent deadline missed'
      if (!lobby.fallbackWaves.has(targetWave)) {
        lobby.fallbackWaves.add(targetWave)
        lobby.fallbackCount += 1
      }
      const lastValidation = lobby.lastValidConfig && validateWaveConfig(lobby.lastValidConfig, {wave: targetWave, budget: lobby.budget})
      if (lastValidation?.ok) config = clone(lobby.lastValidConfig)
    } else {
      reason = 'built-in Skynet'
    }
    if (!config) config = new BuiltinSkynet().plan({wave: targetWave, budget: lobby.budget, telemetry: lobby.telemetry.get(lobby.wave) || null})
  }
  const result = {
    ok: true,
    wave: targetWave,
    config: clone(config),
    scripts: clone(lobby.scripts),
    fallback,
    reason,
    fallback_count: lobby.fallbackCount,
    agent_name: lobby.agent?.name || 'BUILT-IN',
  }
  lobby.appliedConfig = clone(config)
  lobby.appliedPlans.set(targetWave, clone(result))
  return result
}

function resolveGhost(lobby, request) {
  if (request === undefined || request === null || request === 'last') return {ok: true, selector: 'last'}
  if (request === 'best') return {ok: true, selector: 'best'}
  const wave = Number(request)
  if (!Number.isInteger(wave) || !lobby.telemetry.has(wave)) return {ok: false, error: 'GHOST_NOT_FOUND'}
  return {ok: true, selector: wave}
}

function normalizeGameEvent(event) {
  if (!event || typeof event !== 'object') return null
  const base = {wave: Number(event.wave) || 0, t: Number(event.t) || 0}
  if (event.type === 'player_damage' || event.type === 'damage') return {
    type: 'damage',
    ...base,
    amount: Number(event.amount) || 0,
    unit_type: event.unit_type || event.unitType || 'unknown',
    unit_id: event.unit_id || event.unitId || null,
    headshot: Boolean(event.headshot),
    player_facing_attacker: Boolean(event.player_facing_attacker ?? event.playerFacingAttacker),
  }
  if (event.type === 'kill') return {type: 'kill', ...base, unit_type: event.unit_type || event.unitType, unit_id: event.unit_id || event.unitId, weapon: event.weapon, distance: event.distance, headshot: Boolean(event.headshot)}
  if (event.type === 'unit_spawn' || event.type === 'unit_death') return {type: event.type, ...base, unit_id: event.unit_id || event.unitId, unit_type: event.unit_type || event.unitType, rev: event.rev, cause: event.cause || null}
  if (event.type === 'player_pos') return {type: 'player_pos', ...base, pos: clone(event.pos), yaw: Number(event.yaw) || 0, hp: Number(event.hp) || 0, armor: Number(event.armor) || 0, weapon: event.weapon}
  if (event.type === 'script_error' || event.type === 'fuel_exhausted') return {type: event.type, ...base, unit_id: event.unit_id || event.unitId, unit_type: event.unit_type || event.unitType, rev: event.rev, ...(event.message ? {message: String(event.message)} : {})}
  if (event.type === 'purchase') return {type: 'purchase', ...base, item: event.item, price: Number(event.price) || 0}
  if (event.type === 'config_applied') return {type: 'config_applied', ...base, wave: Number(event.wave) || 0, fallback: Boolean(event.fallback), ...(event.reason ? {reason: String(event.reason)} : {})}
  if (event.type === 'phase' && ['lobby', 'wave', 'intermission', 'ended'].includes(event.phase)) return {type: 'phase', ...base, phase: event.phase, ...(event.deadline_ms ? {deadline_ms: event.deadline_ms} : {})}
  if (event.type === 'wave_summary') return {type: 'wave_summary', ...base, ...clone(event)}
  return null
}

function allowEvent(lobby, event, now) {
  if (!SSE_TYPES.has(event.type)) return false
  if (event.type !== 'damage') return true
  lobby.damageTimes = lobby.damageTimes.filter((stamp) => now - stamp < 1_000)
  if (lobby.damageTimes.length >= 5) return false
  lobby.damageTimes.push(now)
  return true
}

function broadcast(lobby, event) {
  const text = `data: ${JSON.stringify(event)}\n\n`
  for (const client of lobby.clients) client.write(text)
}

function validateTraits(traits) {
  const errors = []
  traits.forEach((trait, index) => {
    if (!trait || typeof trait.key !== 'string' || !trait.key.trim()) errors.push({path: `traits.${index}.key`, code: 'INVALID_TRAIT_KEY', message: 'trait key is required'})
    if (!Number.isFinite(Number(trait?.confidence)) || Number(trait.confidence) < 0 || Number(trait.confidence) > 1) errors.push({path: `traits.${index}.confidence`, code: 'INVALID_CONFIDENCE', message: 'confidence must be from 0 to 1'})
  })
  return errors
}

async function loadDossier(playerName, dataDir) {
  const file = dossierPath(playerName, dataDir)
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return {markdown: '', traits: []}
  }
}

async function saveDossier(lobby, dataDir) {
  await mkdir(dataDir, {recursive: true})
  await writeFile(dossierPath(lobby.playerName, dataDir), `${JSON.stringify(lobby.dossier, null, 2)}\n`, 'utf8')
}

async function persistMatch(lobby, stats, dataDir, timestamp) {
  await mkdir(dataDir, {recursive: true})
  const record = {code: lobby.code, player_name: lobby.playerName, agent: lobby.agent?.name || null, fallback_count: lobby.fallbackCount, stats: clone(stats)}
  await writeFile(path.join(dataDir, `match-${lobby.code}-${timestamp}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  await saveDossier(lobby, dataDir)
}

function dossierPath(playerName, dataDir) {
  const id = createHash('sha256').update(playerName.toLowerCase()).digest('hex').slice(0, 16)
  return path.join(dataDir, `dossier-${id}.json`)
}

function makeCode(lobbies) {
  for (;;) {
    let code = ''
    for (let index = 0; index < 6; index += 1) code += CODE_CHARS[randomInt(CODE_CHARS.length)]
    if (!lobbies.has(code)) return code
  }
}

function setCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Game-Token')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
}

function sendJson(response, status, body) {
  response.statusCode = status
  if (status === 204) return response.end()
  const text = `${JSON.stringify(body)}\n`
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(text))
  response.end(text)
}

function sendError(response, status, code, message) {
  return sendJson(response, status, {ok: false, error: code, message})
}

function bearerToken(request) {
  const match = String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i)
  return match?.[1] || ''
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1024 * 1024) throw httpError(413, 'BODY_TOO_LARGE', 'request body exceeds 1 MB')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw httpError(400, 'INVALID_JSON', 'request body must be valid JSON')
  }
}

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), {statusCode, code})
}

function clone(value) {
  return value == null ? value : structuredClone(value)
}
