import {PartyEvents, normalizePartyCode} from './party-protocol.js'

export const SIGNAL_ORIGIN = 'https://blitz-games-signal.blitzapp.workers.dev'

export function configuredSignalOrigin({search, fallback = SIGNAL_ORIGIN} = {}) {
  const query = search ?? (typeof location === 'undefined' ? '' : location.search)
  const override = new URLSearchParams(query).get('signal')
  return normalizeSignalOrigin(override || fallback)
}

export function signalWasOverridden(search) {
  const query = search ?? (typeof location === 'undefined' ? '' : location.search)
  return Boolean(new URLSearchParams(query).get('signal'))
}

export async function createSignalRoom({
  origin = configuredSignalOrigin(),
  capacity = 3,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  if (!fetchImpl) throw new Error('fetch is not available')
  const response = await fetchImpl(`${normalizeSignalOrigin(origin)}/rooms`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({capacity}),
  })
  if (!response.ok) throw new Error(`party signaling room creation failed with ${response.status}`)
  const room = await response.json()
  return {...room, code: normalizePartyCode(room.code)}
}

export class SignalingClient {
  constructor({
    code,
    role,
    name = 'Fighter',
    origin = configuredSignalOrigin(),
    WebSocket: WebSocketImpl = globalThis.WebSocket,
    pingIntervalMs = 25_000,
  } = {}) {
    if (!WebSocketImpl) throw new Error('WebSocket is not available')
    if (role !== 'host' && role !== 'guest') throw new Error('signaling role must be host or guest')
    this.code = normalizePartyCode(code)
    this.role = role
    this.name = String(name || '').trim().slice(0, 40) || 'Fighter'
    this.origin = normalizeSignalOrigin(origin)
    this.WebSocket = WebSocketImpl
    this.pingIntervalMs = pingIntervalMs
    this.events = new PartyEvents()
    this.socket = null
    this.peerId = null
    this.peers = new Map()
    this.connected = false
    this.closed = false
    this.pingTimer = null
  }

  on(type, listener) { return this.events.on(type, listener) }
  addEventListener(type, listener) { return this.events.addEventListener(type, listener) }
  removeEventListener(type, listener) { this.events.removeEventListener(type, listener) }

  async connect() {
    if (this.connected) return this.state()
    if (this.socket) return this.waitForWelcome()
    this.closed = false
    const socket = this.socket = new this.WebSocket(signalingSocketUrl(this.origin, this.code))
    socket.addEventListener('open', () => this.send({type: 'hello', role: this.role, name: this.name}))
    socket.addEventListener('message', event => this.receive(event))
    socket.addEventListener('error', event => this.events.emit('error', event?.error || new Error('party signaling connection failed')))
    socket.addEventListener('close', event => this.handleClose(event))
    return this.waitForWelcome()
  }

  waitForWelcome() {
    if (this.connected) return Promise.resolve(this.state())
    return new Promise((resolve, reject) => {
      const offWelcome = this.on('welcome', () => { cleanup(); resolve(this.state()) })
      const offError = this.on('error', event => { cleanup(); reject(asError(event.detail, 'party signaling connection failed')) })
      const offClose = this.on('close', event => { cleanup(); reject(asError(event.detail, 'party signaling connection closed')) })
      const cleanup = () => { offWelcome(); offError(); offClose() }
    })
  }

  receive(event) {
    let message
    try { message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()) } catch { return }
    if (!message || typeof message.type !== 'string') return
    if (message.type === 'welcome') {
      this.peerId = String(message.peerId)
      this.role = message.role
      this.peers = new Map((message.peers || []).map(peer => [peer.peerId, cleanPeer(peer)]))
      this.connected = true
      this.startPing()
      this.events.emit('welcome', {...message, peers: this.peerList()})
    } else if (message.type === 'peer_joined' && message.peer?.peerId) {
      const peer = cleanPeer(message.peer)
      this.peers.set(peer.peerId, peer)
      this.events.emit('peer-joined', peer)
    } else if (message.type === 'peer_left' && message.peerId) {
      this.peers.delete(message.peerId)
      this.events.emit('peer-left', {peerId: String(message.peerId)})
    } else if (message.type === 'signal' && message.from && message.data) {
      this.events.emit('signal', {from: String(message.from), data: message.data})
    } else if (message.type === 'room_closed') {
      this.events.emit('room-closed', {reason: message.reason})
    } else if (message.type === 'error') {
      const error = Object.assign(new Error(message.message || message.code || 'party signaling error'), {code: message.code})
      this.events.emit('server-error', {...message, error})
      this.events.emit('error', error)
    } else if (message.type === 'pong') {
      this.events.emit('pong', message)
    }
    this.events.emit('message', message)
  }

  sendSignal(to, data) { return this.send({type: 'signal', to, data}) }

  send(message) {
    if (this.socket?.readyState !== 1) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  peerList() { return [...this.peers.values()].map(peer => ({...peer})) }

  state() {
    return {code: this.code, role: this.role, peerId: this.peerId, peers: this.peerList(), connected: this.connected}
  }

  startPing() {
    this.stopPing()
    if (!(this.pingIntervalMs > 0)) return
    this.pingTimer = setInterval(() => this.send({type: 'ping'}), this.pingIntervalMs)
    this.pingTimer.unref?.()
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  close({notify = true} = {}) {
    this.closed = true
    this.connected = false
    this.stopPing()
    if (notify) this.send({type: 'leave'})
    this.socket?.close()
    this.socket = null
    this.peers.clear()
  }

  handleClose(event) {
    const expected = this.closed
    this.connected = false
    this.stopPing()
    this.socket = null
    this.events.emit('close', {expected, code: event?.code, reason: event?.reason || ''})
  }
}

export function signalingSocketUrl(origin, code) {
  const url = new URL(normalizeSignalOrigin(origin))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/$/, '')}/rooms/${normalizePartyCode(code)}/ws`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function normalizeSignalOrigin(value) {
  const url = new URL(String(value || SIGNAL_ORIGIN))
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('party signaling origin must use http or https')
  }
  url.pathname = url.pathname.replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function cleanPeer(peer) {
  return {
    peerId: String(peer.peerId),
    name: String(peer.name || '').trim().slice(0, 40) || 'Fighter',
    role: peer.role === 'host' ? 'host' : 'guest',
  }
}

function asError(value, fallback) {
  if (value instanceof Error) return value
  if (value?.error instanceof Error) return value.error
  return new Error(value?.reason || value?.message || fallback)
}
