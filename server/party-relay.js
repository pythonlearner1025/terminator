import {randomBytes} from 'node:crypto'
import {networkInterfaces} from 'node:os'
import {WebSocket, WebSocketServer} from 'ws'

const PARTY_PATH = /^\/party\/([A-Z0-9]{6})$/i
const MAX_GUESTS = 2
const MAX_MESSAGE_BYTES = 64 * 1024

export function attachPartyRelay(server, {logger = console, lanHost = null, tunnelUrl = null} = {}) {
  const rooms = new Map()
  const webSockets = new WebSocketServer({noServer: true, maxPayload: MAX_MESSAGE_BYTES})
  let publicTunnelUrl = normalizeRelayBase(tunnelUrl)

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost')
    const match = url.pathname.match(PARTY_PATH)
    if (!match) return rejectUpgrade(socket, 404, 'Party route not found')
    const role = url.searchParams.get('role')
    if (role !== 'host' && role !== 'guest') return rejectUpgrade(socket, 400, 'Party role must be host or guest')
    const code = match[1].toUpperCase()
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit('connection', webSocket, request, {code, role})
    })
  })

  webSockets.on('connection', (socket, _request, {code, role}) => {
    if (role === 'host') return connectHost(code, socket)
    connectGuest(code, socket)
  })

  function connectHost(code, socket) {
    const current = rooms.get(code)
    if (current?.host?.readyState === WebSocket.OPEN) {
      socket.close(4009, 'party already has a host')
      return
    }
    const room = current || {code, host: null, guests: new Map()}
    room.host = socket
    rooms.set(code, room)
    bindMessages(socket, (message) => forwardFromHost(room, message))
    socket.once('close', () => closeParty(room, 'host left the party'))
    send(socket, {type: 'relay_ready', code, role: 'host'})
  }

  function connectGuest(code, socket) {
    const room = rooms.get(code)
    if (!room?.host || room.host.readyState !== WebSocket.OPEN) {
      socket.close(4004, 'party host is not connected')
      return
    }
    if (room.guests.size >= MAX_GUESTS) {
      socket.close(4003, 'party is full')
      return
    }
    const peerId = makePeerId(room)
    room.guests.set(peerId, socket)
    bindMessages(socket, (message) => forwardFromGuest(room, peerId, message))
    socket.once('close', () => removeGuest(room, peerId))
    send(socket, {type: 'relay_ready', code, role: 'guest', peerId})
    send(room.host, {type: 'peer_join', peerId})
  }

  function forwardFromHost(room, message) {
    if (message.type === 'leave') {
      closeParty(room, 'host left the party')
      return
    }
    if (typeof message.to === 'string') {
      const guest = room.guests.get(message.to)
      if (guest) send(guest, withoutRouting(message))
      return
    }
    const forwarded = withoutRouting(message)
    for (const guest of room.guests.values()) send(guest, forwarded)
  }

  function forwardFromGuest(room, peerId, message) {
    if (message.type === 'leave') {
      room.guests.get(peerId)?.close(1000, 'guest left the party')
      return
    }
    send(room.host, {...withoutRouting(message), peerId})
  }

  function removeGuest(room, peerId) {
    if (!room.guests.delete(peerId)) return
    send(room.host, {type: 'peer_leave', peerId})
  }

  function closeParty(room, reason) {
    if (rooms.get(room.code) !== room) return
    rooms.delete(room.code)
    for (const guest of room.guests.values()) {
      send(guest, {type: 'host_leave', reason})
      guest.close(4004, reason)
    }
    room.guests.clear()
    if (room.host?.readyState === WebSocket.OPEN) room.host.close(1000, reason)
    room.host = null
  }

  function invite(request, code) {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 7801
    const host = lanHost || firstLanAddress() || request.headers.host?.split(':')[0] || 'localhost'
    const path = `/party/${code}`
    return {
      code,
      lan_url: `ws://${formatHost(host)}:${port}${path}`,
      tunnel_url: publicTunnelUrl ? `${publicTunnelUrl}${path}` : null,
    }
  }

  function close() {
    for (const room of [...rooms.values()]) closeParty(room, 'relay stopped')
    for (const socket of webSockets.clients) socket.terminate()
    webSockets.close()
  }

  return {
    rooms,
    invite,
    close,
    setTunnelUrl(value) { publicTunnelUrl = normalizeRelayBase(value) },
    get tunnelUrl() { return publicTunnelUrl },
  }

  function bindMessages(socket, handler) {
    socket.on('message', (data, isBinary) => {
      if (isBinary) return socket.close(1003, 'JSON text messages only')
      let message
      try { message = JSON.parse(data.toString()) } catch { return socket.close(1007, 'invalid JSON') }
      if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
        return socket.close(1007, 'message type is required')
      }
      handler(message)
    })
    socket.on('error', (error) => logger.warn?.(`Party relay socket error: ${error.message}`))
  }
}

function send(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function withoutRouting(message) {
  const {to: _to, peerId: _peerId, ...payload} = message
  return payload
}

function makePeerId(room) {
  let id
  do { id = randomBytes(6).toString('base64url') } while (room.guests.has(id))
  return id
}

function rejectUpgrade(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
}

function firstLanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return null
}

function formatHost(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

export function normalizeRelayBase(value) {
  if (!value) return null
  try {
    const url = new URL(String(value))
    if (url.protocol === 'http:') url.protocol = 'ws:'
    if (url.protocol === 'https:') url.protocol = 'wss:'
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null
    url.pathname = url.pathname.replace(/\/$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}
