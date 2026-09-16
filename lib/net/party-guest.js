import {World} from '../core/world.js'
import {rayCollider} from '../core/collision.js'
import {directionFromAngles} from '../core/math.js'
import {
  PARTY_RULES,
  PartyEvents,
  normalizePartyCode,
  parsePartyMessage,
  partySocketUrl,
  sendPartyMessage,
} from './party-protocol.js'
import {SignalingClient, configuredSignalOrigin} from './signaling.js'
import {WebRtcTransport} from './webrtc.js'

export class PartyGuest {
  constructor({
    code,
    relay = queryRelayOverride(),
    name = 'Resistance Fighter',
    resumeToken = null,
    signalOrigin = configuredSignalOrigin(),
    WebSocket: WebSocketImpl = globalThis.WebSocket,
    RTCPeerConnection: RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
    worldFactory = ({seed}) => new World({seed}),
    now = () => Date.now(),
  } = {}) {
    if (!WebSocketImpl) throw new Error('WebSocket is not available')
    this.code = normalizePartyCode(code)
    this.relay = relay
    this.signalOrigin = signalOrigin
    this.name = String(name || '').trim().slice(0, 40) || 'Resistance Fighter'
    this.resumeToken = resumeToken
    this.WebSocket = WebSocketImpl
    this.RTCPeerConnection = RTCPeerConnectionImpl
    this.worldFactory = worldFactory
    this.now = now
    this.events = new PartyEvents()
    this.socket = null
    this.signaling = null
    this.transport = null
    this.hostPeerId = null
    this.signalHostPeerId = null
    this.world = null
    this.playerId = null
    this.rules = PARTY_RULES
    this.connected = false
    this.closed = false
    this.ended = false
    this.notice = null
    this.inputTick = 0
    this.pendingInputs = []
    this.snapshotHistory = []
    this.lastSnapshotTick = -1
    this.lastAcknowledgedInputTick = -1
    this.nextShotTick = 0
    this.nextShotAt = 0
    this.partyState = {mode: 'guest', code: this.code, players: [], connected: false, matchStarted: false}
    this.messageCounts = {sent: {}, received: {}}
    this.snapshotTimes = []
    this.pendingPurchases = new Map()
    this.everWelcomed = false
    this.reconnectTimer = null
    this.reconnectStartedAt = 0
  }

  on(type, listener) { return this.events.on(type, listener) }
  addEventListener(type, listener) { return this.events.addEventListener(type, listener) }
  removeEventListener(type, listener) { this.events.removeEventListener(type, listener) }

  async start() {
    if (this.socket || this.signaling) return this.partyState
    this.closed = false
    this.ended = false
    if (this.relay) this.openSocket()
    else await this.openWebRtc()
    await this.waitForWelcome()
    return this.partyState
  }

  openSocket() {
    if (this.socket || this.closed || this.ended) return
    const socket = this.socket = new this.WebSocket(partySocketUrl(this.relay, this.code, 'guest'))
    socket.addEventListener('message', (event) => this.receive(event))
    socket.addEventListener('close', (event) => this.handleClose(event))
    socket.addEventListener('error', (event) => this.events.emit('error', event))
  }

  async openWebRtc() {
    if (this.signaling || this.closed || this.ended) return
    const signaling = this.signaling = new SignalingClient({
      code: this.code, role: 'guest', name: this.name, origin: this.signalOrigin, WebSocket: this.WebSocket,
    })
    const transport = this.transport = new WebRtcTransport({
      role: 'guest', signaling, RTCPeerConnection: this.RTCPeerConnection,
    })
    transport.start()
    transport.on('message', event => {
      if (transport === this.transport) this.receivePeer(event.detail)
    })
    transport.on('peer-open', event => {
      if (transport !== this.transport) return
      this.hostPeerId = event.detail.peerId
      this.connected = true
      this.partyState.connected = true
      this.send({type: 'join', name: this.name, ...(this.resumeToken ? {resumeToken: this.resumeToken} : {})})
      this.emitState()
    })
    transport.on('peer-close', event => {
      if (transport === this.transport && event.detail.peerId === this.hostPeerId) {
        this.handleWebRtcClose(event.detail.reason || 'The host connection was lost.')
      }
    })
    transport.on('error', event => {
      if (transport === this.transport) this.events.emit('error', event.detail)
    })
    transport.on('room-closed', event => {
      if (transport === this.transport) {
        this.end(event.detail.reason === 'host_left' ? 'The host left the party.' : 'The party expired.')
      }
    })
    signaling.on('welcome', () => {
      if (signaling === this.signaling) this.acceptSignalingRoster()
    })
    signaling.on('peer-joined', () => {
      if (signaling === this.signaling) this.acceptSignalingRoster()
    })
    signaling.on('peer-left', event => {
      if (signaling !== this.signaling) return
      this.acceptSignalingRoster()
      if (event.detail.peerId === this.signalHostPeerId) this.end('The host left the party.')
    })
    signaling.on('close', event => {
      if (signaling === this.signaling && !event.detail.expected) {
        this.handleWebRtcClose(event.detail.reason || 'The host connection was lost.')
      }
    })
    try {
      await signaling.connect()
    } catch (error) {
      if (signaling === this.signaling) this.resetWebRtcTransport()
      if (this.everWelcomed) this.scheduleReconnect(error?.message || 'The host connection was lost.')
      else throw error
    }
  }

  acceptSignalingRoster() {
    if (!this.signaling) return
    const peers = this.signaling.peerList()
    this.signalHostPeerId = peers.find(peer => peer.role === 'host')?.peerId || this.signalHostPeerId
    if (this.world) return
    const self = {
      peerId: this.signaling.peerId,
      name: this.name,
      role: 'guest',
    }
    this.partyState = {
      ...this.partyState,
      connected: false,
      signaling: true,
      players: [...peers, self].filter(peer => peer.peerId).map(peer => ({
        id: peer.peerId, name: peer.name, host: peer.role === 'host', ready: false, connected: false, signaling: true,
      })),
    }
    this.emitState()
  }

  waitForWelcome() {
    if (this.world && this.playerId) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const offWelcome = this.on('welcome', () => { cleanup(); resolve() })
      const offError = this.on('error', (event) => {
        cleanup()
        reject(event.detail instanceof Error ? event.detail : event.detail?.error || new Error('party transport connection failed'))
      })
      const offEnded = this.on('ended', (event) => { cleanup(); reject(new Error(event.detail.notice)) })
      const cleanup = () => { offWelcome(); offError(); offEnded() }
    })
  }

  receive(event) {
    const message = parsePartyMessage(event)
    if (!message) return
    count(this.messageCounts.received, message.type)
    if (message.type === 'relay_ready') {
      this.connected = true
      this.partyState.connected = true
      this.send({type: 'join', name: this.name, ...(this.resumeToken ? {resumeToken: this.resumeToken} : {})})
    } else if (message.type === 'welcome') this.acceptWelcome(message)
    else if (message.type === 'prepare') this.events.emit('match-prepare', {})
    else if (message.type === 'snapshot') this.acceptSnapshot(message)
    else if (message.type === 'event') this.acceptEvent(message.event)
    else if (message.type === 'party_state') this.acceptPartyState(message.state)
    else if (message.type === 'start') {
      if (message.snapshot) this.acceptSnapshot(message)
      this.partyState.matchStarted = true
      this.events.emit('match-start', {snapshot: message.snapshot})
      this.emitState()
    } else if (message.type === 'return_lobby') {
      if (message.snapshot) this.acceptSnapshot(message)
      this.partyState.matchStarted = false
      this.nextShotAt = this.now()
      this.events.emit('return-lobby', {snapshot: message.snapshot})
      this.emitState()
    } else if (message.type === 'purchase_result') {
      this.pendingPurchases.get(message.requestId)?.resolve(message.result)
      this.pendingPurchases.delete(message.requestId)
      this.events.emit('purchase-result', message)
    }
    else if (message.type === 'reject') this.end(message.reason || 'The party rejected this player.')
    else if (message.type === 'host_leave') this.end(message.reason || 'The host left the party.')
  }

  receivePeer({peerId, data}) {
    if (this.hostPeerId && peerId !== this.hostPeerId) return
    this.receive({data})
  }

  acceptWelcome(message) {
    this.everWelcomed = true
    this.reconnectStartedAt = 0
    this.playerId = String(message.playerId)
    this.resumeToken = message.resumeToken || this.resumeToken
    this.rules = {...PARTY_RULES, ...(message.rules || {})}
    this.world = this.worldFactory({seed: message.seed, rules: this.rules})
    this.partyState.connected = true
    this.lastSnapshotTick = -1
    const ack = Number(message.ack)
    const acknowledgedTick = Number.isInteger(ack) ? ack : -1
    this.inputTick = Math.max(this.inputTick, acknowledgedTick + 1)
    this.applyAuthoritativeSnapshot(message.snapshot, acknowledgedTick)
    this.events.emit('world', {world: this.world, playerId: this.playerId})
    this.events.emit('welcome', {playerId: this.playerId, rules: this.rules})
  }

  acceptSnapshot(message) {
    if (!message.snapshot || !this.world || !this.playerId) return
    const snapshotTick = Number(message.snapshot.tick)
    if (Number.isInteger(snapshotTick) && snapshotTick < this.lastSnapshotTick) return
    const receivedAt = this.now()
    this.snapshotTimes.push(receivedAt)
    if (this.snapshotTimes.length > 200) this.snapshotTimes.shift()
    this.snapshotHistory.push(interpolationSnapshot(receivedAt, message.snapshot))
    while (this.snapshotHistory.length > 12) this.snapshotHistory.shift()
    const ack = Number(message.acks?.[this.playerId] ?? message.ack ?? -1)
    this.applyAuthoritativeSnapshot(message.snapshot, ack)
    this.interpolate(receivedAt)
    this.events.emit('snapshot', {tick: message.snapshot.tick, ack})
  }

  applyAuthoritativeSnapshot(snapshot, ack) {
    const snapshotTick = Number(snapshot.tick)
    if (Number.isInteger(snapshotTick)) this.lastSnapshotTick = snapshotTick
    if (Number.isInteger(ack)) this.lastAcknowledgedInputTick = Math.max(this.lastAcknowledgedInputTick, ack)
    this.world.applySnapshot(snapshot, {predictOnly: true})
    this.pendingInputs = this.pendingInputs.filter((entry) => entry.tick > this.lastAcknowledgedInputTick)
    for (const entry of this.pendingInputs) this.world.predictPlayer(this.playerId, entry.inputs)
    this.world.localPlayerId = this.playerId
    this.world.hostPlayerId = this.playerId
  }

  acceptEvent(event) {
    if (!event || !this.world) return
    const duplicate = this.world.eventLog.some((item) => item.tick === event.tick && item.type === event.type
      && (item.unitId || null) === (event.unitId || null) && (item.playerId || null) === (event.playerId || null))
    if (!duplicate) this.world.eventLog.push(structuredClone(event))
    this.events.emit('event', event)
  }

  acceptPartyState(state = {}) {
    this.partyState = {...this.partyState, ...structuredClone(state), mode: 'guest', code: this.code, connected: this.connected}
    this.emitState()
  }

  step(inputs = {}) {
    if (!this.world || !this.playerId || !this.connected) return null
    const tick = this.inputTick++
    const normalized = normalizeInputs(inputs)
    const shot = this.localShot(tick, normalized)
    this.pendingInputs.push({tick, inputs: normalized})
    this.send({type: 'input', tick, inputs: normalized, ...(shot ? {shot} : {})})
    this.world.predictPlayer(this.playerId, normalized)
    this.interpolate(this.now())
    return tick
  }

  localShot(_tick, inputs) {
    const now = this.now()
    if (!inputs.fire || now < this.nextShotAt) return null
    const player = this.world.getPlayer(this.playerId)
    const weapon = this.world.weaponCatalog.weapons[player?.activeWeapon]
    const ammo = player?.ammo?.[player.activeWeapon]
    if (!player?.alive || !weapon?.mag || !ammo?.owned || ammo.mag <= 0 || player.reloadTimer > 0) return null
    this.nextShotAt = now + 1000 / weapon.rate
    const hit = localHitscan(this.world, player, inputs)
    return {
      unitId: hit?.unitId || null,
      part: hit?.part === 'head' ? 'head' : 'body',
      weapon: player.activeWeapon,
    }
  }

  interpolate(now = this.now()) {
    if (!this.world || this.snapshotHistory.length === 0) return
    const target = now - this.rules.interpolationMs
    let before = this.snapshotHistory[0]
    let after = before
    for (const entry of this.snapshotHistory) {
      if (entry.at <= target) before = entry
      if (entry.at >= target) { after = entry; break }
      after = entry
    }
    const span = after.at - before.at
    const alpha = span > 0 ? Math.max(0, Math.min(1, (target - before.at) / span)) : 0
    interpolateUnits(this.world, before.unitsById, after.unitsById, alpha)
    interpolatePlayers(this.world, before.snapshot.players || {}, after.snapshot.players || {}, alpha, this.playerId)
  }

  purchase(item, requestId = `${this.inputTick}:${String(item)}:${this.pendingPurchases.size}`) {
    if (!this.connected) return Promise.resolve({ok: false, error: 'Party is disconnected'})
    const result = new Promise((resolve) => this.pendingPurchases.set(requestId, {resolve}))
    this.send({type: 'purchase', item, requestId})
    return result
  }

  ready(value = true) { this.send({type: 'ready', ready: Boolean(value)}) }
  loaded() { this.send({type: 'loaded'}) }

  snapshotRate({windowMs = 2_000} = {}) {
    const cutoff = this.now() - windowMs
    const times = this.snapshotTimes.filter((time) => time >= cutoff)
    if (times.length < 2) return 0
    return (times.length - 1) * 1000 / (times.at(-1) - times[0])
  }

  send(message) {
    count(this.messageCounts.sent, message.type)
    if (!this.transport) return sendPartyMessage(this.socket, message)
    const data = JSON.stringify(message)
    if (message.type === 'input' || message.type === 'hit') this.transport.sendState(data, this.hostPeerId)
    else this.transport.sendReliable(data, this.hostPeerId)
  }

  stop({notify = true} = {}) {
    if (notify) this.send({type: 'leave'})
    this.closed = true
    this.clearReconnect()
    this.connected = false
    this.partyState.connected = false
    this.resetWebRtcTransport()
    this.socket?.close()
    this.socket = null
    this.resolvePendingPurchases('Party disconnected')
    this.emitState()
  }

  end(notice) {
    if (this.ended) return
    this.ended = true
    this.clearReconnect()
    this.notice = notice
    this.connected = false
    this.partyState.connected = false
    this.resetWebRtcTransport()
    this.socket?.close()
    this.resolvePendingPurchases(notice)
    this.events.emit('ended', {notice})
    this.emitState()
  }

  handleClose(event) {
    this.socket = null
    if (this.closed || this.ended) return
    this.connected = false
    this.partyState.connected = false
    this.emitState()
    if (!this.everWelcomed) {
      this.end(event?.reason || 'The host connection was lost.')
      return
    }
    this.scheduleReconnect(event?.reason || 'The host connection was lost.')
  }

  handleWebRtcClose(notice) {
    if (this.closed || this.ended) return
    this.resetWebRtcTransport()
    this.connected = false
    this.partyState.connected = false
    this.emitState()
    if (!this.everWelcomed) {
      this.end(notice)
      return
    }
    this.scheduleReconnect(notice)
  }

  resetWebRtcTransport() {
    const transport = this.transport
    const signaling = this.signaling
    this.transport = null
    this.signaling = null
    this.hostPeerId = null
    this.signalHostPeerId = null
    transport?.close()
    if (!transport) signaling?.close()
  }

  scheduleReconnect(notice) {
    if (!this.reconnectStartedAt) this.reconnectStartedAt = this.now()
    if (this.now() - this.reconnectStartedAt >= this.rules.disconnectGraceMs) {
      this.end(notice)
      return
    }
    this.clearReconnect()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.relay) this.openSocket()
      else void this.openWebRtc()
    }, 150)
  }

  clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  emitState() { this.events.emit('state', {...this.partyState, notice: this.notice}) }

  resolvePendingPurchases(error) {
    for (const pending of this.pendingPurchases.values()) pending.resolve({ok: false, error})
    this.pendingPurchases.clear()
  }
}

export function localHitscan(world, player, inputs) {
  const origin = {...player.pos, y: player.pos.y + (player.crouch ? 1.12 : 1.65)}
  const direction = directionFromAngles(inputs.yaw, inputs.pitch)
  let closest = {kind: 'miss', distance: 100}
  for (const collider of world.activeColliders()) {
    const hit = rayCollider(origin, direction, collider, 100)
    if (hit && hit.distance < closest.distance) closest = {kind: 'collider', distance: hit.distance}
  }
  for (const unit of world.units) {
    if (!unit.alive) continue
    const spec = world.unitCatalog.types[unit.type]
    const hit = rayCollider(origin, direction, world.unitHitCollider(unit, spec), closest.distance)
    if (!hit || hit.distance >= closest.distance) continue
    const volume = String(hit.part?.id || hit.part?.part || '').toLowerCase()
    closest = {kind: 'unit', unitId: unit.id, part: volume === 'head' ? 'head' : 'body', distance: hit.distance}
  }
  return closest.kind === 'unit' ? closest : null
}

// Keep detached transforms, not full simulation/telemetry state, for the same
// twelve interpolation samples. Build the lookup once per received snapshot.
function interpolationSnapshot(at, snapshot) {
  const units = (snapshot.units || []).map(({id, pos, yaw}) => ({id, pos: {...pos}, yaw}))
  const players = Object.fromEntries(Object.entries(snapshot.players || {})
    .map(([id, player]) => [id, {pos: {...player.pos}, yaw: player.yaw}]))
  return {at, snapshot: {units, players}, unitsById: new Map(units.map(unit => [unit.id, unit]))}
}

function interpolateUnits(world, beforeById, afterById, alpha) {
  for (const unit of world.units) {
    const before = beforeById.get(unit.id)
    const after = afterById.get(unit.id)
    if (!before || !after) continue
    unit.pos = lerpVec(before.pos, after.pos, alpha)
    unit.yaw = lerpAngle(before.yaw, after.yaw, alpha)
  }
}

function interpolatePlayers(world, beforePlayers, afterPlayers, alpha, localPlayerId) {
  for (const [id, player] of world.players) {
    if (id === localPlayerId) continue
    const before = beforePlayers[id]
    const after = afterPlayers[id]
    if (!before || !after) continue
    player.pos = lerpVec(before.pos, after.pos, alpha)
    player.yaw = lerpAngle(before.yaw, after.yaw, alpha)
  }
}

function lerpVec(before, after, alpha) {
  return {
    x: before.x + (after.x - before.x) * alpha,
    y: before.y + (after.y - before.y) * alpha,
    z: before.z + (after.z - before.z) * alpha,
  }
}

function lerpAngle(before = 0, after = 0, alpha) {
  let difference = (after - before) % (Math.PI * 2)
  if (difference > Math.PI) difference -= Math.PI * 2
  if (difference < -Math.PI) difference += Math.PI * 2
  return before + difference * alpha
}

function normalizeInputs(inputs = {}) {
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

function count(record, type) { record[type] = (record[type] || 0) + 1 }

function queryRelayOverride() {
  if (typeof location === 'undefined') return null
  return new URLSearchParams(location.search).get('relay') || null
}
