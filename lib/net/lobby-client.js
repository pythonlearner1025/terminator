import {waveBudget} from '../core/waves.js'
import {buildWaveSummary} from '../core/telemetry.js'

const RELAY_EVENTS = new Set([
  'player_damage',
  'kill',
  'unit_spawn',
  'unit_death',
  'script_error',
  'fuel_exhausted',
  'fuelExhausted',
  'purchase',
  'config_applied',
])

export class LobbyClient {
  constructor({world, director, serverUrl, intermissionSeconds = 45} = {}) {
    this.world = world
    this.director = director
    this.serverUrl = String(serverUrl || configuredServerUrl()).replace(/\/$/, '')
    this.intermissionSeconds = intermissionSeconds
    this.baseUrl = null
    this.gameToken = null
    this.code = null
    this.eventIndex = 0
    this.lastPhase = 'lobby'
    this.lastPlayerPosTick = -60
    this.pendingPlan = null
    this.postedSummaryWaves = new Set()
    this.active = false
    this.inLobby = true
    this.allowStart = false
    this.queuedStartConfig = null
    this.timers = new Set()
    this.controllers = new Set()
    this.originalStart = null
    this.originalBeginWave = null
    this.overlay = null
    this.style = null
  }

  start() {
    if (this.active) return
    this.active = true
    this.patchDirector()
    this.showLobby()
    this.connect().catch(() => this.useLocalFallback())
  }

  update() {
    if (!this.active || !this.world || !this.director) return
    if (this.baseUrl) this.flushEvents()
    const phase = this.director.phase
    if (phase !== this.lastPhase) {
      this.lastPhase = phase
      if (phase === 'intermission') this.beginIntermission()
      else if (phase === 'wave') this.postPhase('wave')
      else if (phase === 'ended') this.endMatch()
    }
    if (this.baseUrl && phase === 'wave' && this.world.tick - this.lastPlayerPosTick >= 60) {
      this.lastPlayerPosTick = this.world.tick
      this.post('/game/events', {event: {
        type: 'player_pos',
        wave: this.world.wave,
        t: this.world.waveTime(),
        pos: {...this.world.player.pos},
        yaw: this.world.player.yaw,
        hp: this.world.player.hp,
        armor: this.world.player.armor,
        weapon: this.world.player.activeWeapon,
      }})
    }
  }

  stop() {
    if (!this.active) return
    this.active = false
    for (const timer of this.timers) clearInterval(timer)
    this.timers.clear()
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    if (this.originalStart) this.director.start = this.originalStart
    if (this.originalBeginWave) this.director.beginWave = this.originalBeginWave
    this.originalStart = null
    this.originalBeginWave = null
    this.overlay?.remove()
    this.style?.remove()
    if (this._resize) window.removeEventListener('resize', this._resize)
    this.overlay = null
    this.style = null
  }

  patchDirector() {
    this.originalStart = this.director.start.bind(this.director)
    this.originalBeginWave = this.director.beginWave.bind(this.director)
    this.director.start = (config = null) => {
      this.queuedStartConfig = config
      if (!this.allowStart) return {ok: true, pending: true}
      return this.originalStart(config)
    }
    this.director.beginWave = (config = null) => {
      if (this.director.phase === 'lobby') {
        const plan = this.pendingPlan
        this.pendingPlan = null
        if (!plan) return this.originalBeginWave(config)
        this.applyPlan(plan)
        const result = this.originalBeginWave(plan.config)
        this.markAppliedPlan(plan)
        return result
      }
      const plan = this.pendingPlan
      this.pendingPlan = null
      if (plan) {
        this.applyPlan(plan)
        const result = this.originalBeginWave(plan.config)
        this.markAppliedPlan(plan)
        this.postPhase('wave')
        return result
      }
      if (this.baseUrl) this.fetchPlan(this.director.wave + 1, true)
      this.world.skynet.name = 'BUILT-IN'
      return this.originalBeginWave(config)
    }
  }

  async connect() {
    if (!this.serverUrl) return this.useLocalFallback()
    const response = await this.fetch(`${this.serverUrl}/api/lobby`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({player_name: 'Resistance Fighter'}),
    })
    if (!response.ok) throw new Error(`lobby create failed with ${response.status}`)
    const created = await response.json()
    if (!this.active) return
    this.code = created.code
    this.gameToken = created.game_token
    this.baseUrl = `${this.serverUrl}/api/lobby/${created.code}`
    this.renderConnectedLobby()
    await this.fetchPlan(1, false)
    this.pollState()
  }

  useLocalFallback() {
    if (!this.active) return
    this.world.skynet.name = 'BUILT-IN'
    this.world.skynet.connected = false
    const status = this.overlay?.querySelector('[data-role="status"]')
    if (status) status.textContent = this.serverUrl ? 'LOBBY SERVER OFFLINE. STARTING BUILT-IN SKYNET.' : 'STARTING BUILT-IN SKYNET.'
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      this.beginMatch()
    }, 350)
    this.timers.add(timer)
  }

  showLobby() {
    this.style = document.createElement('style')
    this.style.textContent = `
.tm-lobby{position:fixed;z-index:90;display:grid;place-items:center;background:rgba(2,5,9,.94);color:#e8f2ff;font-family:ui-monospace,monospace;pointer-events:auto}
.tm-lobby-card{width:min(560px,calc(100% - 40px));border:1px solid #b62931;background:#0b1118;padding:28px;box-shadow:0 0 42px rgba(190,20,35,.25)}
.tm-lobby h1{margin:0 0 8px;color:#f13c45;font:28px Impact,sans-serif;letter-spacing:.08em}.tm-lobby p{font-size:12px;line-height:1.5;color:#acc0d2}
.tm-lobby-code{font:42px Impact,sans-serif;letter-spacing:.18em;color:#fff;margin:20px 0}.tm-lobby code{display:block;white-space:normal;word-break:break-word;background:#05080c;padding:10px;color:#8dd8ff}
.tm-lobby button{margin-top:18px;padding:11px 18px;border:1px solid #f13c45;background:#7d111a;color:#fff;font-weight:700;cursor:pointer}.tm-lobby button:disabled{opacity:.35;cursor:wait}
`
    document.head.appendChild(this.style)
    this.overlay = document.createElement('div')
    this.overlay.className = 'tm-lobby'
    this.overlay.dataset.testid = 'skynet-lobby'
    this.overlay.innerHTML = `<div class="tm-lobby-card"><h1>TERMINATOR: HUMAN VS SKYNET</h1><p data-role="status">CONTACTING SKYNET LOBBY...</p><div class="tm-lobby-code" data-role="code">------</div><p>CONNECT AN EXTERNAL AGENT:</p><code data-role="command">Waiting for lobby code</code><button type="button" data-testid="skynet-start-match" disabled>START MATCH</button></div>`
    document.body.appendChild(this.overlay)
    this.syncOverlayBox()
    window.addEventListener('resize', this._resize = () => this.syncOverlayBox())
  }

  syncOverlayBox() {
    if (!this.overlay) return
    const canvas = document.querySelector('[data-testid="game-canvas"]') || document.querySelector('canvas')
    const rect = canvas?.getBoundingClientRect() || {left: 0, top: 0, width: innerWidth, height: innerHeight}
    Object.assign(this.overlay.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`})
  }

  renderConnectedLobby() {
    if (!this.overlay) return
    this.overlay.querySelector('[data-role="status"]').textContent = 'SKYNET: BUILT-IN. EXTERNAL AGENT OPTIONAL.'
    this.overlay.querySelector('[data-role="code"]').textContent = this.code
    this.overlay.querySelector('[data-role="command"]').textContent = `claude mcp add skynet -- npx terminator-skynet-mcp --url ${this.serverUrl} --code ${this.code}`
    const button = this.overlay.querySelector('[data-testid="skynet-start-match"]')
    button.disabled = false
    button.addEventListener('click', () => this.beginMatch(), {once: true})
  }

  beginMatch() {
    if (!this.inLobby || !this.active) return
    this.inLobby = false
    this.allowStart = true
    this.overlay?.remove()
    this.style?.remove()
    this.overlay = null
    this.style = null
    if (this._resize) window.removeEventListener('resize', this._resize)
    this.originalStart(this.queuedStartConfig)
    this.lastPhase = this.director.phase
    this.postPhase('wave')
  }

  pollState() {
    const sync = async () => {
      if (!this.active || !this.baseUrl) return
      try {
        const response = await this.fetch(`${this.baseUrl}/state`)
        if (!response.ok) return
        const state = await response.json()
        this.world.skynet.name = state.agent?.name || 'BUILT-IN'
        this.world.skynet.connected = true
        this.world.skynet.fallbackCount = state.fallback_count || 0
        Object.assign(this.world.skynet.revs, state.script_revs || {})
        if (state.transmission) this.world.transmission = state.transmission
        const status = this.overlay?.querySelector('[data-role="status"]')
        if (status) status.textContent = state.agent ? `SKYNET AGENT CONNECTED: ${state.agent.name}` : 'SKYNET: BUILT-IN. EXTERNAL AGENT OPTIONAL.'
      } catch {
        this.world.skynet.connected = false
      }
    }
    sync()
    const timer = setInterval(sync, 750)
    timer.unref?.()
    this.timers.add(timer)
  }

  flushEvents() {
    const events = []
    for (; this.eventIndex < this.world.eventLog.length; this.eventIndex += 1) {
      const event = this.world.eventLog[this.eventIndex]
      if (RELAY_EVENTS.has(event.type)) events.push(event.type === 'fuelExhausted' ? {...event, type: 'fuel_exhausted'} : event)
    }
    if (events.length) this.post('/game/events', {events})
  }

  async beginIntermission() {
    if (!this.baseUrl || !this.director.lastTelemetry) return
    const nextWave = this.director.wave + 1
    const deadlineMs = Date.now() + Math.max(0, this.intermissionSeconds * 1000 - 300)
    try {
      await this.postWaveSummary(deadlineMs)
      this.startPlanPolling(nextWave, deadlineMs)
    } catch {
      this.world.skynet.connected = false
    }
  }

  async postWaveSummary(deadlineMs = null) {
    const wave = this.director.wave
    if (!this.baseUrl || !this.director.lastTelemetry || this.postedSummaryWaves.has(wave)) return
    const summary = buildWaveSummary(this.director.lastTelemetry, {wave, playerDied: !this.world.player.alive})
    const budget = waveBudget(wave + 1, summary).applied
    await this.post('/game/wave_summary', {
      wave,
      summary,
      replay: this.director.replays?.get(wave) || [],
      deadline_ms: deadlineMs || Date.now(),
      budget,
    }, true)
    this.postedSummaryWaves.add(wave)
  }

  startPlanPolling(wave, deadlineMs) {
    this.fetchPlan(wave, false)
    const timer = setInterval(() => {
      if (!this.active || this.director.phase !== 'intermission' || this.pendingPlan) {
        clearInterval(timer)
        this.timers.delete(timer)
        return
      }
      this.fetchPlan(wave, Date.now() >= deadlineMs)
    }, 250)
    this.timers.add(timer)
  }

  async fetchPlan(wave, force) {
    if (!this.baseUrl || this.pendingPlan || !this.active) return
    try {
      const response = await this.fetch(`${this.baseUrl}/game/plan/${wave}${force ? '?force=1' : ''}`, {
        headers: {'X-Game-Token': this.gameToken || ''},
      })
      if (response.status === 202) return
      if (!response.ok) return
      this.pendingPlan = await response.json()
    } catch {
      this.world.skynet.connected = false
    }
  }

  applyPlan(plan) {
    this.world.skynet.name = plan.agent_name || 'BUILT-IN'
    this.world.skynet.connected = true
    this.world.skynet.fallbackCount = plan.fallback_count || 0
    for (const [type, script] of Object.entries(plan.scripts || {})) {
      if (!script?.rev) continue
      if (typeof this.world.acceptScript === 'function' && script.source) {
        while ((this.world.skynet.revs[type] || 1) < script.rev) {
          const accepted = this.world.acceptScript({unitType: type, source: script.source})
          if (!accepted.ok) break
        }
      } else {
        this.world.skynet.revs[type] = script.rev
      }
    }
    const knobs = plan.config?.knobs || {}
    const details = [`FOG ${knobs.fog || 0}`]
    if (Object.keys(knobs.doors || {}).length) details.push(`DOORS ${Object.entries(knobs.doors).map(([id, state]) => `${id}:${state}`).join(',')}`)
    if (Object.keys(knobs.lights || {}).length) details.push(`LIGHTS ${Object.entries(knobs.lights).map(([id, state]) => `${id}:${state}`).join(',')}`)
    this.world.transmission = `APPLIED WAVE ${plan.wave}: ${details.join('  ')}`.slice(0, 120)
  }

  markAppliedPlan(plan) {
    const event = [...this.world.eventLog].reverse().find((item) => item.type === 'config_applied' && item.wave === this.world.wave)
    if (!event) return
    event.fallback = Boolean(plan.fallback)
    event.reason = plan.reason || undefined
  }

  postPhase(phase) {
    if (!this.baseUrl) return
    this.post('/game/phase', {
      phase,
      wave: this.world.wave,
      budget: this.world.waveBudget,
      applied_config: this.director.config,
      t: this.world.waveTime(),
    })
  }

  async endMatch() {
    if (!this.baseUrl) return
    try {
      await this.postWaveSummary()
      await this.post('/game/match_end', {stats: {wave: this.world.wave, player_alive: this.world.player.alive, scrap: this.world.player.scrap}}, true)
    } catch {
      this.world.skynet.connected = false
    }
  }

  async post(route, body, wait = false) {
    if (!this.baseUrl || !this.active) return null
    const request = this.fetch(`${this.baseUrl}${route}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Game-Token': this.gameToken || ''},
      body: JSON.stringify(body),
    })
    if (!wait) {
      request.catch(() => { this.world.skynet.connected = false })
      return null
    }
    const response = await request
    if (!response.ok) throw new Error(`lobby relay failed with ${response.status}`)
    return response.json()
  }

  async fetch(url, options = {}) {
    const controller = new AbortController()
    this.controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), 1_500)
    try {
      return await globalThis.fetch(url, {...options, signal: controller.signal})
    } finally {
      clearTimeout(timeout)
      this.controllers.delete(controller)
    }
  }
}

export function configuredServerUrl(location = globalThis.location, serverUrl = globalThis.SKYNET_SERVER_URL) {
  const value = new URLSearchParams(location?.search).get('skynetServer')
  if (value || serverUrl) return value || serverUrl
  const hostname = location?.hostname?.toLowerCase() || ''
  const loopback = hostname === 'localhost' || hostname === 'localhost.' || hostname === '[::1]' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  return loopback ? 'http://localhost:7801' : ''
}
