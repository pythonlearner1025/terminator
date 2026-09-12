import {EMPTY_INPUTS, TICK_RATE} from '../core/world.js'
import {
  PARTY_RULES,
  PartyEvents,
  createPartyCode,
  createResumeToken,
  normalizePartyCode,
  parsePartyMessage,
  partyInviteEndpoint,
  partySocketUrl,
  sendPartyMessage,
} from './party-protocol.js'
import {
  SignalingClient,
  configuredSignalOrigin,
  createSignalRoom,
  signalWasOverridden,
} from './signaling.js'
import {WebRtcTransport} from './webrtc.js'

const RELIABLE_EVENT_TYPES = new Set([
  'kill', 'purchase', 'phase', 'wave_summary', 'transmission', 'unit_spawn', 'unit_death',
  'player_damage', 'player_death', 'player_respawn', 'player_join', 'player_leave',
  'config_applied', 'script_error', 'unit_say', 'fuelExhausted', 'fuel_exhausted',
])

export class PartyHost {
  constructor({
    world,
    director = null,
    relay = queryRelayOverride(),
    code = null,
    name = 'Player 1',
    signalOrigin = configuredSignalOrigin(),
    signalOverride = signalWasOverridden(),
    WebSocket: WebSocketImpl = globalThis.WebSocket,
    RTCPeerConnection: RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
    fetch: fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    disconnectGraceMs = PARTY_RULES.disconnectGraceMs,
  } = {}) {
    if (!world) throw new TypeError('PartyHost requires a World')
    if (!WebSocketImpl) throw new Error('WebSocket is not available')
    this.world = world
    this.director = director
    this.relay = relay
    this.explicitRelay = Boolean(relay)
    this.code = code ? normalizePartyCode(code) : (relay ? createPartyCode() : null)
    this.name = cleanName(name, 'Player 1')
    this.signalOrigin = signalOrigin
    this.signalOverride = signalOverride
    this.WebSocket = WebSocketImpl
    this.RTCPeerConnection = RTCPeerConnectionImpl
    this.fetch = fetchImpl === globalThis.fetch && typeof globalThis.window !== 'undefined'
      ? fetchImpl.bind(globalThis)
      : fetchImpl
    this.now = now
    this.disconnectGraceMs = disconnectGraceMs
    this.events = new PartyEvents()
    this.socket = null
    this.signaling = null
    this.transport = null
    this.connected = false
    this.closed = false
    this.matchStarted = false
    this.inviteUrls = {lan: null, tunnel: null}
    this.inviteUrl = null
    this.guestsByPeer = new Map()
    this.guestsByToken = new Map()
    this.latestInputs = new Map()
    this.inputAcks = new Map()
    this.pendingHits = new Map()
    this.disconnectTimers = new Map()
    this.eventCursor = world.eventLog.length
    this.lastSnapshotTick = -Infinity
    this.matchPreparing = false
    this.loadedPlayers = new Set()
    this.prepareWaiter = null
    this.messageCounts = {sent: {}, received: {}}
    const host = world.getPlayer(world.hostPlayerId)
    if (host) { host.name = this.name; host.connected = true }
    this.players = new Map([[world.hostPlayerId, {
      id: world.hostPlayerId, name: this.name, ready: false, connected: true, host: true,
    }]])
  }

  on(type, listener) { return this.events.on(type, listener) }
  addEventListener(type, listener) { return this.events.addEventListener(type, listener) }
  removeEventListener(type, listener) { this.events.removeEventListener(type, listener) }

  async start({name} = {}) {
    if (this.socket || this.signaling) return this.state()
    if (name) {
      this.name = cleanName(name, this.name)
      this.players.get(this.world.hostPlayerId).name = this.name
      this.world.getPlayer(this.world.hostPlayerId).name = this.name
    }
    this.closed = false
    if (!this.relay) return this.startWebRtc()
    return this.startRelay()
  }

  async startRelay() {
    const socket = this.socket = new this.WebSocket(partySocketUrl(this.relay, this.code, 'host'))
    socket.addEventListener('message', (event) => this.receive(event))
    socket.addEventListener('close', () => this.handleClose())
    socket.addEventListener('error', (event) => this.events.emit('error', event))
    await this.waitForRelay()
    this.loadInviteUrls()
    this.emitState()
    return this.state()
  }

  async startWebRtc() {
    const room = await createSignalRoom({origin: this.signalOrigin, capacity: PARTY_RULES.maxPlayers, fetch: this.fetch})
    this.code = room.code
    const signaling = this.signaling = new SignalingClient({
      code: this.code, role: 'host', name: this.name, origin: this.signalOrigin, WebSocket: this.WebSocket,
    })
    const transport = this.transport = new WebRtcTransport({
      role: 'host', signaling, RTCPeerConnection: this.RTCPeerConnection,
    })
    transport.start()
    transport.on('message', event => this.receivePeer(event.detail))
    transport.on('peer-close', event => { if (!this.closed) this.markDisconnected(event.detail.peerId) })
    transport.on('error', event => this.events.emit('error', event.detail))
    signaling.on('welcome', () => {
      this.connected = true
      this.inviteUrl = buildSignalInviteLink(this.code, this.signalOrigin, this.signalOverride)
      this.events.emit('connected', this.state())
      this.emitState()
    })
    signaling.on('peer-joined', () => this.emitState())
    signaling.on('peer-left', event => { this.markDisconnected(event.detail.peerId); this.emitState() })
    signaling.on('close', event => {
      if (!this.closed && !event.detail.expected) this.handleClose()
    })
    await signaling.connect()
    return this.state()
  }

  waitForRelay() {
    if (this.connected) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const offReady = this.on('connected', () => { cleanup(); resolve() })
      const offError = this.on('error', (event) => {
        cleanup()
        reject(event.detail instanceof Error ? event.detail : event.detail?.error || new Error('party transport connection failed'))
      })
      const offEnded = this.on('ended', (event) => { cleanup(); reject(new Error(event.detail?.notice || 'party relay closed')) })
      const cleanup = () => { offReady(); offError(); offEnded() }
    })
  }

  receive(event) {
    const message = parsePartyMessage(event)
    if (!message) return
    count(this.messageCounts.received, message.type)
    if (message.type === 'relay_ready') {
      this.connected = true
      this.events.emit('connected', this.state())
      return
    }
    if (message.type === 'peer_leave') return this.markDisconnected(message.peerId)
    if (message.type === 'join') return this.acceptGuest(message)
    const playerId = this.guestsByPeer.get(message.peerId)
    if (!playerId) return
    if (message.type === 'input') this.acceptInput(playerId, message)
    else if (message.type === 'hit') this.acceptHit(playerId, message)
    else if (message.type === 'purchase') this.acceptPurchase(playerId, message)
    else if (message.type === 'ready') this.setReady(playerId, message.ready !== false)
    else if (message.type === 'loaded') this.acceptLoaded(playerId)
    else if (message.type === 'leave') this.markDisconnected(message.peerId)
  }

  receivePeer({peerId, data}) {
    const message = parsePartyMessage({data})
    if (!message) return
    this.receive({data: JSON.stringify({...message, peerId})})
  }

  acceptGuest(message) {
    const peerId = message.peerId
    if (!peerId) return
    let playerId = message.resumeToken && this.guestsByToken.get(message.resumeToken)
    let resumeToken = message.resumeToken
    const reconnecting = playerId && this.players.get(playerId)?.connected === false && this.world.players.has(playerId)
    if (!reconnecting) {
      playerId = this.nextPlayerId()
      if (!playerId) return this.send({type: 'reject', to: peerId, reason: 'party is full'})
      resumeToken = createResumeToken()
      this.world.addPlayer({id: playerId, name: cleanName(message.name, `Player ${this.world.players.size + 1}`)})
      this.guestsByToken.set(resumeToken, playerId)
    }
    const player = this.world.getPlayer(playerId)
    player.name = cleanName(message.name, player.name)
    player.connected = true
    this.guestsByPeer.set(peerId, playerId)
    this.clearDisconnect(playerId)
    this.players.set(playerId, {id: playerId, name: player.name, ready: false, connected: true, host: false, peerId, resumeToken})
    const snapshot = networkSnapshot(this.world)
    this.send({
      type: 'welcome', to: peerId, playerId, resumeToken, seed: this.world.seed,
      rules: PARTY_RULES, snapshot, ack: this.inputAcks.get(playerId) ?? -1,
    })
    if (this.matchPreparing) this.send({type: 'prepare', to: peerId})
    this.broadcastState()
  }

  acceptInput(playerId, message) {
    const tick = Number(message.tick)
    const newest = Math.max(this.inputAcks.get(playerId) ?? -1, this.latestInputs.get(playerId)?.tick ?? -1)
    if (!Number.isInteger(tick) || tick < 0 || tick <= newest) return
    this.latestInputs.set(playerId, {tick, inputs: normalizeGuestInputs(message.inputs)})
    if (message.shot && typeof message.shot === 'object') this.acceptHit(playerId, {...message.shot, tick})
  }

  acceptHit(playerId, message) {
    const tick = Number(message.tick)
    if (!Number.isInteger(tick) || tick < 0) return
    const hits = this.pendingHits.get(playerId) || new Map()
    hits.set(tick, {
      unitId: String(message.unitId || ''),
      part: message.part === 'head' ? 'head' : 'body',
      weapon: String(message.weapon || ''),
    })
    while (hits.size > 12) hits.delete(hits.keys().next().value)
    this.pendingHits.set(playerId, hits)
  }

  acceptPurchase(playerId, message) {
    const result = this.world.purchase(String(message.item || ''), playerId)
    this.send({type: 'purchase_result', to: this.players.get(playerId)?.peerId, requestId: message.requestId, result})
    this.flushReliableEvents()
  }

  setReady(playerId = this.world.hostPlayerId, ready = true) {
    const player = this.players.get(playerId)
    if (!player) return false
    player.ready = Boolean(ready)
    this.broadcastState()
    return true
  }

  prepareMatch({timeoutMs = 180_000, hostLoaded = true} = {}) {
    if (this.matchStarted) return Promise.resolve({ok: false, error: 'Match already started'})
    if (this.prepareWaiter) return this.prepareWaiter.promise
    this.matchPreparing = true
    this.loadedPlayers = new Set(hostLoaded ? [this.world.hostPlayerId] : [])
    let resolve
    const promise = new Promise(done => { resolve = done })
    const timer = setTimeout(() => this.finishPreparing({ok: false, error: 'Players did not finish loading'}), timeoutMs)
    timer.unref?.()
    this.prepareWaiter = {promise, resolve, timer}
    this.send({type: 'prepare'})
    this.checkPrepared()
    return promise
  }

  acceptLoaded(playerId) {
    if (!this.matchPreparing || !this.players.get(playerId)?.connected) return
    this.loadedPlayers.add(playerId)
    this.checkPrepared()
  }

  cancelPreparing(error = 'Match loading was cancelled') {
    this.finishPreparing({ok: false, error: String(error?.message || error)})
  }

  checkPrepared() {
    if (!this.matchPreparing || !this.prepareWaiter) return
    const ready = [...this.players.values()].filter(player => player.connected).every(player => this.loadedPlayers.has(player.id))
    if (ready) this.finishPreparing({ok: true})
  }

  finishPreparing(result) {
    const waiter = this.prepareWaiter
    if (!waiter) return
    clearTimeout(waiter.timer)
    this.prepareWaiter = null
    if (!result.ok) this.matchPreparing = false
    waiter.resolve(result)
  }

  startMatch() {
    this.matchPreparing = false
    this.matchStarted = true
    this.flushReliableEvents()
    this.send({type: 'start', snapshot: networkSnapshot(this.world), acks: Object.fromEntries(this.inputAcks)})
    this.broadcastState()
  }

  returnToLobby() {
    if (!this.matchStarted || this.world.phase !== 'ended') return {ok: false, error: 'Match is not over'}
    const reset = this.director?.returnToLobby?.()
    if (reset === false || reset?.ok === false) return reset || {ok: false, error: 'Could not reset the match'}
    this.matchStarted = false
    for (const player of this.players.values()) player.ready = false
    this.latestInputs.clear()
    this.pendingHits.clear()
    this.loadedPlayers.clear()
    this.eventCursor = 0
    this.lastSnapshotTick = -Infinity
    this.send({
      type: 'return_lobby', snapshot: networkSnapshot(this.world), acks: Object.fromEntries(this.inputAcks),
    })
    this.broadcastState()
    return {ok: true}
  }

  step(hostInputs = EMPTY_INPUTS) {
    const phaseBefore = this.world.phase
    const bundle = {[this.world.hostPlayerId]: hostInputs}
    for (const [playerId, partyPlayer] of this.players) {
      if (partyPlayer.host) continue
      const latest = this.latestInputs.get(playerId)
      bundle[playerId] = partyPlayer.connected && latest ? {...latest.inputs, fire: false} : EMPTY_INPUTS
    }
    if (this.director) this.director.step(bundle)
    else this.world.step(bundle)
    for (const [playerId, latest] of this.latestInputs) {
      if (this.players.get(playerId)?.connected) this.inputAcks.set(playerId, latest.tick)
    }
    this.processGuestShots()
    this.flushReliableEvents()
    const phaseChanged = this.world.phase !== phaseBefore
    if (phaseChanged
      || this.world.tick - this.lastSnapshotTick >= Math.ceil(TICK_RATE / PARTY_RULES.snapshotRate)) {
      this.sendSnapshot({reliable: phaseChanged})
    }
    return bundle
  }

  processGuestShots() {
    for (const [playerId, partyPlayer] of this.players) {
      if (partyPlayer.host || !partyPlayer.connected) continue
      const latest = this.latestInputs.get(playerId)
      const player = this.world.getPlayer(playerId)
      const shots = this.pendingHits.get(playerId)
      const pending = latest && [...(shots || [])].find(([tick]) => tick <= latest.tick)
      if (!pending || !player?.alive || player.fireCooldown > 0 || player.reloadTimer > 0) continue
      const [shotTick, hit] = pending
      shots.delete(shotTick)
      const weaponId = hit.weapon
      if (player.activeWeapon !== weaponId) continue
      const weapon = this.world.weaponCatalog.weapons[weaponId]
      const ammo = player.ammo[weaponId]
      if (!weapon?.mag || !ammo?.owned || ammo.mag <= 0) continue
      const unit = hit?.weapon === weaponId ? this.world.unitById.get(hit.unitId) : null
      const validHit = Boolean(unit?.alive)
      ammo.mag -= 1
      player.fireCooldown = 1 / weapon.rate
      player.firing = true
      let result = {damage: 0, killed: false}
      if (validHit) {
        result = this.world.damageUnit(unit.id, weapon.damage * (hit.part === 'head' ? 2 : 1), {
          source: 'player', playerId, weapon: weaponId, headshot: hit.part === 'head',
        })
      }
      this.world.recordShot(weaponId, validHit, playerId)
      this.world.addSound('gunshot', player.pos, undefined, playerId)
      this.world.emit('shot', {
        by: playerId, playerId, weapon: weaponId, hit: validHit, headshot: hit?.part === 'head',
        killed: result.killed, unitId: validHit ? unit.id : null,
        origin: {...player.pos, y: player.pos.y + (player.crouch ? 1.12 : 1.65)},
      })
    }
  }

  sendSnapshot({reliable = false} = {}) {
    this.lastSnapshotTick = this.world.tick
    this.send({
      type: 'snapshot', snapshot: networkSnapshot(this.world), acks: Object.fromEntries(this.inputAcks), sentAt: this.now(),
    }, {reliable})
  }

  flushReliableEvents() {
    while (this.eventCursor < this.world.eventLog.length) {
      const event = this.world.eventLog[this.eventCursor++]
      if (RELIABLE_EVENT_TYPES.has(event.type)) this.send({type: 'event', event})
    }
  }

  markDisconnected(peerId) {
    const playerId = this.guestsByPeer.get(peerId)
    if (!playerId) return
    this.guestsByPeer.delete(peerId)
    const player = this.players.get(playerId)
    if (!player || !player.connected) return
    player.connected = false
    const worldPlayer = this.world.getPlayer(playerId)
    if (worldPlayer) worldPlayer.connected = false
    player.peerId = null
    player.ready = false
    this.latestInputs.delete(playerId)
    this.broadcastState()
    this.checkPrepared()
    const timer = setTimeout(() => this.removeDisconnected(playerId), this.disconnectGraceMs)
    timer.unref?.()
    this.disconnectTimers.set(playerId, timer)
  }

  removeDisconnected(playerId) {
    this.disconnectTimers.delete(playerId)
    const player = this.players.get(playerId)
    if (!player || player.connected) return
    this.world.removePlayer(playerId)
    this.players.delete(playerId)
    this.inputAcks.delete(playerId)
    this.pendingHits.delete(playerId)
    if (player.resumeToken) this.guestsByToken.delete(player.resumeToken)
    this.flushReliableEvents()
    this.broadcastState()
  }

  clearDisconnect(playerId) {
    const timer = this.disconnectTimers.get(playerId)
    if (timer) clearTimeout(timer)
    this.disconnectTimers.delete(playerId)
  }

  nextPlayerId() {
    for (let index = 1; index <= 2; index += 1) if (!this.world.players.has(`guest-${index}`)) return `guest-${index}`
    return null
  }

  async loadInviteUrls() {
    if (!this.fetch) return
    try {
      const response = await this.fetch(partyInviteEndpoint(this.relay, this.code))
      if (!response.ok) return
      const invite = await response.json()
      const connectedRelay = this.explicitRelay ? partyInviteRelay(this.relay, this.code) : null
      this.inviteUrls = {
        lan: buildInviteLink(this.code, connectedRelay || invite.lan_url),
        tunnel: buildInviteLink(this.code, invite.tunnel_url),
      }
      this.emitState()
    } catch {}
  }

  broadcastState() {
    this.send({type: 'party_state', state: this.state(false)})
    this.emitState()
  }

  emitState() { this.events.emit('state', this.state()) }

  state(includeInvites = true) {
    const players = this.rosterPlayers()
    return {
      mode: 'host', code: this.code, connected: this.connected, matchStarted: this.matchStarted,
      players,
      ...(includeInvites ? {inviteUrl: this.inviteUrl, inviteUrls: {...this.inviteUrls}} : {}),
    }
  }

  rosterPlayers() {
    const players = [...this.players.values()].map(({peerId: _peerId, resumeToken: _resumeToken, ...player}) => ({...player}))
    if (!this.signaling) return players
    const accepted = new Set(this.guestsByPeer.keys())
    for (const peer of this.signaling.peerList()) {
      if (peer.role !== 'guest' || accepted.has(peer.peerId)) continue
      players.push({id: peer.peerId, name: peer.name, ready: false, connected: false, host: false, signaling: true})
    }
    return players
  }

  send(message, {reliable = false} = {}) {
    count(this.messageCounts.sent, message.type)
    if (!this.transport) return sendPartyMessage(this.socket, message)
    const {to, peerId: _peerId, ...payload} = message
    const data = JSON.stringify(payload)
    if (message.type === 'snapshot' && !reliable) this.transport.sendState(data, to)
    else this.transport.sendReliable(data, to)
  }

  stop({notify = true} = {}) {
    if (notify) this.send({type: 'leave'})
    this.closed = true
    this.finishPreparing({ok: false, error: 'Party closed'})
    this.matchPreparing = false
    this.connected = false
    for (const playerId of this.disconnectTimers.keys()) this.clearDisconnect(playerId)
    this.transport?.close()
    this.transport = null
    this.signaling = null
    this.socket?.close()
    this.socket = null
    this.emitState()
  }

  handleClose() {
    const wasConnected = this.connected
    this.connected = false
    this.socket = null
    if (!this.closed && wasConnected) this.events.emit('ended', {notice: this.relay ? 'Party relay disconnected.' : 'Party signaling disconnected.'})
    this.emitState()
  }
}

function normalizeGuestInputs(inputs = {}) {
  return {
    move: {x: Number(inputs.move?.x) || 0, z: Number(inputs.move?.z) || 0},
    yaw: Number(inputs.yaw) || 0,
    pitch: Number(inputs.pitch) || 0,
    fire: Boolean(inputs.fire),
    aim: Boolean(inputs.aim),
    reload: Boolean(inputs.reload),
    switchTo: inputs.switchTo ?? null,
    sprint: Boolean(inputs.sprint),
    crouch: Boolean(inputs.crouch),
    jump: Boolean(inputs.jump),
    grenade: Boolean(inputs.grenade),
    melee: Boolean(inputs.melee),
    ready: Boolean(inputs.ready),
  }
}

function cleanName(value, fallback) {
  return String(value || '').trim().slice(0, 40) || fallback
}

function count(record, type) { record[type] = (record[type] || 0) + 1 }

export function networkSnapshot(world) {
  const replay = world.replay
  const telemetry = world.telemetry
  world.syncTelemetryPlayers()
  world.replay = []
  world.telemetry = compactNetworkTelemetry(telemetry)
  try {
    const snapshot = world.snapshot()
    delete snapshot.lastInputsBundle
    delete snapshot.scriptRevisions
    return snapshot
  }
  finally {
    world.replay = replay
    world.telemetry = telemetry
  }
}

function compactNetworkTelemetry(telemetry = {}) {
  const compactPlayer = (player = {}) => ({
    id: player.id,
    name: player.name,
    shots: structuredClone(player.shots || {}),
    damageDealt: Number(player.damageDealt) || 0,
    counters: structuredClone(player.counters || {}),
    hp: player.hp,
    armor: player.armor,
    scrap: player.scrap,
    alive: player.alive,
    downed: player.downed,
    playerPath: [],
    heatmap: {},
    damageTaken: [],
    kills: [],
    reloads: [],
    healthArmor: [],
    purchases: [],
  })
  return {
    shots: structuredClone(telemetry.shots || {}),
    timeToClear: telemetry.timeToClear ?? null,
    appliedBudget: Number(telemetry.appliedBudget) || 0,
    knobs: structuredClone(telemetry.knobs || {}),
    counters: structuredClone(telemetry.counters || {}),
    players: Object.fromEntries(Object.entries(telemetry.players || {}).map(([id, player]) => [id, compactPlayer(player)])),
    performanceMultiplier: telemetry.performanceMultiplier,
    scaling: structuredClone(telemetry.scaling || null),
    durationSeconds: telemetry.durationSeconds,
    playerPath: [],
    heatmap: {},
    damageTaken: [],
    kills: [],
    reloads: [],
    healthArmor: [],
    purchases: [],
    units: {},
  }
}

function buildInviteLink(code, relay) {
  if (!relay) return null
  if (typeof location === 'undefined') return relay
  const game = new URL(location.href)
  game.search = ''
  game.searchParams.set('party', code)
  game.searchParams.set('relay', relay)
  game.hash = ''
  return game.toString()
}

export function buildSignalInviteLink(code, signalOrigin, includeSignal = false) {
  if (typeof location === 'undefined') return null
  const game = new URL('/', location.origin)
  game.searchParams.set('party', normalizePartyCode(code))
  if (includeSignal) game.searchParams.set('signal', signalOrigin)
  return game.toString()
}

function queryRelayOverride() {
  if (typeof location === 'undefined') return null
  return new URLSearchParams(location.search).get('relay') || null
}

function partyInviteRelay(relay, code) {
  const url = new URL(partySocketUrl(relay, code, 'guest'))
  url.searchParams.delete('role')
  return url.toString()
}
