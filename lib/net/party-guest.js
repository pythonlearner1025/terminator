import {World} from '../core/world.js'
import {directionFromAngles, rayAabb, raySphere} from '../core/math.js'
import {
  PARTY_RULES,
  PartyEvents,
  defaultPartyRelay,
  normalizePartyCode,
  parsePartyMessage,
  partySocketUrl,
  sendPartyMessage,
} from './party-protocol.js'

export class PartyGuest {
  constructor({
    code,
    relay = defaultPartyRelay(),
    name = 'Resistance Fighter',
    resumeToken = null,
    WebSocket: WebSocketImpl = globalThis.WebSocket,
    worldFactory = ({seed}) => new World({seed}),
    now = () => Date.now(),
  } = {}) {
    if (!WebSocketImpl) throw new Error('WebSocket is not available')
    this.code = normalizePartyCode(code)
    this.relay = relay
    this.name = String(name || '').trim().slice(0, 40) || 'Resistance Fighter'
    this.resumeToken = resumeToken
    this.WebSocket = WebSocketImpl
    this.worldFactory = worldFactory
    this.now = now
    this.events = new PartyEvents()
    this.socket = null
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
    this.nextShotTick = 0
    this.partyState = {mode: 'guest', code: this.code, players: [], connected: false, matchStarted: false}
    this.messageCounts = {sent: {}, received: {}}
    this.snapshotTimes = []
    this.pendingPurchases = new Map()
  }

  on(type, listener) { return this.events.on(type, listener) }
  addEventListener(type, listener) { return this.events.addEventListener(type, listener) }
  removeEventListener(type, listener) { this.events.removeEventListener(type, listener) }

  async start() {
    if (this.socket) return this.partyState
    this.closed = false
    this.ended = false
    const socket = this.socket = new this.WebSocket(partySocketUrl(this.relay, this.code, 'guest'))
    socket.addEventListener('message', (event) => this.receive(event))
    socket.addEventListener('close', (event) => this.handleClose(event))
    socket.addEventListener('error', (event) => this.events.emit('error', event))
    await this.waitForWelcome()
    return this.partyState
  }

  waitForWelcome() {
    if (this.world && this.playerId) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const offWelcome = this.on('welcome', () => { cleanup(); resolve() })
      const offError = this.on('error', (event) => { cleanup(); reject(event.detail?.error || new Error('party relay connection failed')) })
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
    else if (message.type === 'snapshot') this.acceptSnapshot(message)
    else if (message.type === 'event') this.acceptEvent(message.event)
    else if (message.type === 'party_state') this.acceptPartyState(message.state)
    else if (message.type === 'start') {
      if (message.snapshot) this.acceptSnapshot(message)
      this.partyState.matchStarted = true
      this.events.emit('match-start', {snapshot: message.snapshot})
      this.emitState()
    } else if (message.type === 'purchase_result') {
      this.pendingPurchases.get(message.requestId)?.resolve(message.result)
      this.pendingPurchases.delete(message.requestId)
      this.events.emit('purchase-result', message)
    }
    else if (message.type === 'reject') this.end(message.reason || 'The party rejected this player.')
    else if (message.type === 'host_leave') this.end(message.reason || 'The host left the party.')
  }

  acceptWelcome(message) {
    this.playerId = String(message.playerId)
    this.resumeToken = message.resumeToken || this.resumeToken
    this.rules = {...PARTY_RULES, ...(message.rules || {})}
    this.world = this.worldFactory({seed: message.seed, rules: this.rules})
    this.applyAuthoritativeSnapshot(message.snapshot, Number(message.ack) || -1)
    this.events.emit('world', {world: this.world, playerId: this.playerId})
    this.events.emit('welcome', {playerId: this.playerId, rules: this.rules})
  }

  acceptSnapshot(message) {
    if (!message.snapshot || !this.world || !this.playerId) return
    const receivedAt = this.now()
    this.snapshotTimes.push(receivedAt)
    if (this.snapshotTimes.length > 200) this.snapshotTimes.shift()
    this.snapshotHistory.push({at: receivedAt, snapshot: structuredClone(message.snapshot)})
    while (this.snapshotHistory.length > 12) this.snapshotHistory.shift()
    const ack = Number(message.acks?.[this.playerId] ?? message.ack ?? -1)
    this.applyAuthoritativeSnapshot(message.snapshot, ack)
    this.interpolate(receivedAt)
    this.events.emit('snapshot', {tick: message.snapshot.tick, ack})
  }

  applyAuthoritativeSnapshot(snapshot, ack) {
    this.world.applySnapshot(snapshot)
    this.pendingInputs = this.pendingInputs.filter((entry) => entry.tick > ack)
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
    this.pendingInputs.push({tick, inputs: normalized})
    this.send({type: 'input', tick, inputs: normalized})
    this.world.predictPlayer(this.playerId, normalized)
    this.maybeSendHit(tick, normalized)
    this.interpolate(this.now())
    return tick
  }

  maybeSendHit(tick, inputs) {
    if (!inputs.fire || tick < this.nextShotTick) return
    const player = this.world.getPlayer(this.playerId)
    const weapon = this.world.weaponCatalog.weapons[player?.activeWeapon]
    const ammo = player?.ammo?.[player.activeWeapon]
    if (!player?.alive || !weapon?.mag || !ammo?.owned || ammo.mag <= 0 || player.reloadTimer > 0) return
    this.nextShotTick = tick + Math.max(1, Math.ceil(60 / weapon.rate))
    const hit = localHitscan(this.world, player, inputs)
    if (hit) this.send({type: 'hit', tick, unitId: hit.unitId, part: hit.part, weapon: player.activeWeapon})
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
    interpolateUnits(this.world, before.snapshot.units || [], after.snapshot.units || [], alpha)
    interpolatePlayers(this.world, before.snapshot.players || {}, after.snapshot.players || {}, alpha, this.playerId)
  }

  purchase(item, requestId = `${this.inputTick}:${String(item)}:${this.pendingPurchases.size}`) {
    if (!this.connected) return Promise.resolve({ok: false, error: 'Party is disconnected'})
    const result = new Promise((resolve) => this.pendingPurchases.set(requestId, {resolve}))
    this.send({type: 'purchase', item, requestId})
    return result
  }

  ready(value = true) { this.send({type: 'ready', ready: Boolean(value)}) }

  snapshotRate({windowMs = 2_000} = {}) {
    const cutoff = this.now() - windowMs
    const times = this.snapshotTimes.filter((time) => time >= cutoff)
    if (times.length < 2) return 0
    return (times.length - 1) * 1000 / (times.at(-1) - times[0])
  }

  send(message) {
    count(this.messageCounts.sent, message.type)
    sendPartyMessage(this.socket, message)
  }

  stop({notify = true} = {}) {
    if (notify) this.send({type: 'leave'})
    this.closed = true
    this.connected = false
    this.partyState.connected = false
    this.socket?.close()
    this.socket = null
    this.resolvePendingPurchases('Party disconnected')
    this.emitState()
  }

  end(notice) {
    if (this.ended) return
    this.ended = true
    this.notice = notice
    this.connected = false
    this.partyState.connected = false
    this.socket?.close()
    this.resolvePendingPurchases(notice)
    this.events.emit('ended', {notice})
    this.emitState()
  }

  handleClose(event) {
    this.socket = null
    if (!this.closed && !this.ended) this.end(event?.reason || 'The host connection was lost.')
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
    const distance = rayAabb(origin, direction, collider.center, collider.size, 100)
    if (distance !== null && distance < closest.distance) closest = {kind: 'collider', distance}
  }
  for (const unit of world.units) {
    if (!unit.alive) continue
    const spec = world.unitCatalog.types[unit.type]
    const headDistance = raySphere(origin, direction, {x: unit.pos.x, y: unit.pos.y + spec.height * 0.84, z: unit.pos.z}, spec.radius * 0.5, 100)
    const bodyDistance = rayAabb(origin, direction, {x: unit.pos.x, y: unit.pos.y + spec.height * 0.42, z: unit.pos.z},
      {x: spec.radius * 2, y: spec.height * 0.66, z: spec.radius * 2}, 100)
    let distance = bodyDistance
    let part = 'body'
    if (headDistance !== null && (distance === null || headDistance < distance)) { distance = headDistance; part = 'head' }
    if (distance !== null && distance < closest.distance) closest = {kind: 'unit', unitId: unit.id, part, distance}
  }
  return closest.kind === 'unit' ? closest : null
}

function interpolateUnits(world, beforeUnits, afterUnits, alpha) {
  const beforeById = new Map(beforeUnits.map((unit) => [unit.id, unit]))
  const afterById = new Map(afterUnits.map((unit) => [unit.id, unit]))
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
    grenade: Boolean(inputs.grenade),
    melee: Boolean(inputs.melee),
    ready: Boolean(inputs.ready),
  }
}

function count(record, type) { record[type] = (record[type] || 0) + 1 }
