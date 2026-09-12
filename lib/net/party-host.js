import {EMPTY_INPUTS, TICK_RATE} from '../core/world.js'
import {
  PARTY_RULES,
  PartyEvents,
  createPartyCode,
  createResumeToken,
  defaultPartyRelay,
  normalizePartyCode,
  parsePartyMessage,
  partyInviteEndpoint,
  partySocketUrl,
  sendPartyMessage,
} from './party-protocol.js'

const RELIABLE_EVENT_TYPES = new Set([
  'kill', 'purchase', 'phase', 'wave_summary', 'transmission', 'unit_spawn', 'unit_death',
  'player_damage', 'player_death', 'player_respawn', 'player_join', 'player_leave',
  'config_applied', 'script_error', 'unit_say', 'fuelExhausted', 'fuel_exhausted',
])

export class PartyHost {
  constructor({
    world,
    director = null,
    relay,
    code = createPartyCode(),
    name = 'Player 1',
    WebSocket: WebSocketImpl = globalThis.WebSocket,
    fetch: fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    disconnectGraceMs = PARTY_RULES.disconnectGraceMs,
  } = {}) {
    if (!world) throw new TypeError('PartyHost requires a World')
    if (!WebSocketImpl) throw new Error('WebSocket is not available')
    this.world = world
    this.director = director
    this.relay = relay || defaultPartyRelay()
    this.explicitRelay = Boolean(relay)
    this.code = normalizePartyCode(code)
    this.name = cleanName(name, 'Player 1')
    this.WebSocket = WebSocketImpl
    this.fetch = fetchImpl
    this.now = now
    this.disconnectGraceMs = disconnectGraceMs
    this.events = new PartyEvents()
    this.socket = null
    this.connected = false
    this.closed = false
    this.matchStarted = false
    this.inviteUrls = {lan: null, tunnel: null}
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
    if (this.socket) return this.state()
    if (name) {
      this.name = cleanName(name, this.name)
      this.players.get(this.world.hostPlayerId).name = this.name
      this.world.getPlayer(this.world.hostPlayerId).name = this.name
    }
    this.closed = false
    const socket = this.socket = new this.WebSocket(partySocketUrl(this.relay, this.code, 'host'))
    socket.addEventListener('message', (event) => this.receive(event))
    socket.addEventListener('close', () => this.handleClose())
    socket.addEventListener('error', (event) => this.events.emit('error', event))
    await this.waitForRelay()
    this.loadInviteUrls()
    this.emitState()
    return this.state()
  }

  waitForRelay() {
    if (this.connected) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const offReady = this.on('connected', () => { cleanup(); resolve() })
      const offError = this.on('error', (event) => { cleanup(); reject(event.detail?.error || new Error('party relay connection failed')) })
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
    if (this.world.phase !== phaseBefore
      || this.world.tick - this.lastSnapshotTick >= Math.ceil(TICK_RATE / PARTY_RULES.snapshotRate)) this.sendSnapshot()
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

  sendSnapshot() {
    this.lastSnapshotTick = this.world.tick
    this.send({
      type: 'snapshot', snapshot: networkSnapshot(this.world), acks: Object.fromEntries(this.inputAcks), sentAt: this.now(),
    })
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
    return {
      mode: 'host', code: this.code, connected: this.connected, matchStarted: this.matchStarted,
      players: [...this.players.values()].map(({peerId: _peerId, resumeToken: _resumeToken, ...player}) => ({...player})),
      ...(includeInvites ? {inviteUrls: {...this.inviteUrls}} : {}),
    }
  }

  send(message) {
    count(this.messageCounts.sent, message.type)
    sendPartyMessage(this.socket, message)
  }

  stop({notify = true} = {}) {
    if (notify) this.send({type: 'leave'})
    this.closed = true
    this.finishPreparing({ok: false, error: 'Party closed'})
    this.matchPreparing = false
    this.connected = false
    for (const playerId of this.disconnectTimers.keys()) this.clearDisconnect(playerId)
    this.socket?.close()
    this.socket = null
    this.emitState()
  }

  handleClose() {
    const wasConnected = this.connected
    this.connected = false
    this.socket = null
    if (!this.closed && wasConnected) this.events.emit('ended', {notice: 'Party relay disconnected.'})
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

function networkSnapshot(world) {
  const replay = world.replay
  world.replay = []
  try { return world.snapshot() }
  finally { world.replay = replay }
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

function partyInviteRelay(relay, code) {
  const url = new URL(partySocketUrl(relay, code, 'guest'))
  url.searchParams.delete('role')
  return url.toString()
}
