#!/usr/bin/env node
import {randomBytes} from 'node:crypto'
import {createServer} from 'node:http'
import {pathToFileURL} from 'node:url'
import {WebSocket, WebSocketServer} from 'ws'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROOM_PATH = /^\/rooms\/([A-HJ-NP-Z2-9]{6})$/
const WS_PATH = /^\/rooms\/([A-HJ-NP-Z2-9]{6})\/ws$/
const MAX_MESSAGE_BYTES = 64 * 1024
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 120
const EMPTY_ROOM_TTL_MS = 10 * 60_000

export async function startSignalStub({port = 0, host = '127.0.0.1'} = {}) {
  const rooms = new Map()
  const webSockets = new WebSocketServer({noServer: true, maxPayload: MAX_MESSAGE_BYTES})
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (request.method === 'OPTIONS') return json(response, 204, null)
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, {ok: true, version: 'v0'})
    if (request.method === 'POST' && url.pathname === '/rooms') {
      let body = {}
      try { body = await readJson(request) } catch { return json(response, 400, {error: 'bad_message'}) }
      const capacity = body.capacity === undefined ? 3 : Number(body.capacity)
      if (!Number.isInteger(capacity) || capacity < 2 || capacity > 8) return json(response, 400, {error: 'bad_capacity'})
      const code = uniqueCode(rooms)
      const room = {code, capacity, peerCounter: 0, peers: new Map(), sockets: new Set(), expiryTimer: null}
      rooms.set(code, room)
      scheduleExpiry(room)
      return json(response, 200, {code, ttlSeconds: 3600})
    }
    const roomMatch = url.pathname.match(ROOM_PATH)
    if (request.method === 'GET' && roomMatch) {
      const room = rooms.get(roomMatch[1])
      if (!room) return json(response, 404, {error: 'not_found'})
      return json(response, 200, {
        code: room.code,
        capacity: room.capacity,
        peers: [...room.peers.values()].map(publicPeer),
        open: room.peers.size < room.capacity,
      })
    }
    json(response, 404, {error: 'not_found'})
  })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost')
    const match = url.pathname.match(WS_PATH)
    const room = match && rooms.get(match[1])
    if (!room) return rejectUpgrade(socket, 404, 'Room not found')
    if (room.sockets.size >= room.capacity) return rejectUpgrade(socket, 409, 'Room full')
    webSockets.handleUpgrade(request, socket, head, webSocket => {
      webSockets.emit('connection', webSocket, request, room)
    })
  })

  webSockets.on('connection', (socket, _request, room) => {
    room.sockets.add(socket)
    cancelExpiry(room)
    const state = {peer: null, timestamps: []}
    socket.on('message', (data, isBinary) => {
      if (isBinary || data.length > MAX_MESSAGE_BYTES) return fail(socket, 'bad_message', 'JSON text frames under 64 KB are required')
      const now = Date.now()
      state.timestamps = state.timestamps.filter(timestamp => now - timestamp < RATE_WINDOW_MS)
      state.timestamps.push(now)
      if (state.timestamps.length > RATE_LIMIT) return fail(socket, 'rate_limited', 'Message rate exceeded')
      let message
      try { message = JSON.parse(data.toString()) } catch { return fail(socket, 'bad_message', 'Invalid JSON') }
      if (!message || typeof message.type !== 'string') return fail(socket, 'bad_message', 'Message type is required')
      if (!state.peer) return acceptHello(room, socket, state, message)
      handleMessage(room, socket, state.peer, message)
    })
    socket.once('close', () => removeSocket(room, socket, state.peer))
    socket.on('error', () => {})
  })

  function acceptHello(room, socket, state, message) {
    if (message.type !== 'hello' || !['host', 'guest'].includes(message.role)) {
      return fail(socket, 'bad_message', 'hello is required first')
    }
    if (message.role === 'host' && [...room.peers.values()].some(peer => peer.role === 'host')) {
      return fail(socket, 'host_exists', 'Room already has a host')
    }
    const peer = state.peer = {
      peerId: `p${++room.peerCounter}`,
      name: String(message.name || '').trim().slice(0, 40) || 'Fighter',
      role: message.role,
      socket,
    }
    const others = [...room.peers.values()]
    room.peers.set(peer.peerId, peer)
    send(socket, {type: 'welcome', peerId: peer.peerId, role: peer.role, code: room.code, peers: others.map(publicPeer)})
    broadcast(room, {type: 'peer_joined', peer: publicPeer(peer)}, peer.peerId)
  }

  function handleMessage(room, socket, peer, message) {
    if (message.type === 'ping') return send(socket, {type: 'pong'})
    if (message.type === 'leave') return socket.close(1000, 'left')
    if (message.type !== 'signal' || typeof message.to !== 'string' || !message.data || typeof message.data !== 'object') {
      return fail(socket, 'bad_message', 'Unknown message')
    }
    const target = room.peers.get(message.to)
    if (!target) return send(socket, {type: 'error', code: 'unknown_peer', message: 'Unknown peer'})
    send(target.socket, {type: 'signal', from: peer.peerId, data: message.data})
  }

  function removeSocket(room, socket, peer) {
    room.sockets.delete(socket)
    if (!peer || room.peers.get(peer.peerId) !== peer) {
      if (room.sockets.size === 0) scheduleExpiry(room)
      return
    }
    room.peers.delete(peer.peerId)
    if (peer.role === 'host') {
      broadcast(room, {type: 'room_closed', reason: 'host_left'})
      for (const other of room.sockets) other.close(1000, 'host left')
      rooms.delete(room.code)
      cancelExpiry(room)
    } else {
      broadcast(room, {type: 'peer_left', peerId: peer.peerId})
      if (room.sockets.size === 0) scheduleExpiry(room)
    }
  }

  function scheduleExpiry(room) {
    cancelExpiry(room)
    room.expiryTimer = setTimeout(() => {
      broadcast(room, {type: 'room_closed', reason: 'expired'})
      for (const socket of room.sockets) socket.close(1000, 'expired')
      rooms.delete(room.code)
    }, EMPTY_ROOM_TTL_MS)
    room.expiryTimer.unref?.()
  }

  function cancelExpiry(room) {
    if (room.expiryTimer) clearTimeout(room.expiryTimer)
    room.expiryTimer = null
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  const address = server.address()
  const origin = `http://${host}:${address.port}`
  return {
    origin,
    rooms,
    server,
    async close() {
      for (const room of rooms.values()) cancelExpiry(room)
      for (const socket of webSockets.clients) socket.terminate()
      await new Promise(resolve => webSockets.close(resolve))
      await new Promise(resolve => server.close(resolve))
    },
  }
}

function publicPeer(peer) {
  return {peerId: peer.peerId, name: peer.name, role: peer.role}
}

function broadcast(room, message, exceptPeerId = null) {
  for (const peer of room.peers.values()) if (peer.peerId !== exceptPeerId) send(peer.socket, message)
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function fail(socket, code, message) {
  send(socket, {type: 'error', code, message})
  socket.close(1008, code)
}

function json(response, status, body) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...(body === null ? {} : {'Content-Type': 'application/json'}),
  })
  response.end(body === null ? '' : JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > MAX_MESSAGE_BYTES) throw new Error('too large')
    chunks.push(chunk)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
}

function uniqueCode(rooms) {
  let code
  do {
    const bytes = randomBytes(6)
    code = Array.from(bytes, byte => CODE_CHARS[byte % CODE_CHARS.length]).join('')
  } while (rooms.has(code))
  return code
}

function rejectUpgrade(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const portIndex = process.argv.indexOf('--port')
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 0)
  const stub = await startSignalStub({port})
  console.log(`Signal stub listening on ${stub.origin}`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await stub.close()
    process.exit(0)
  })
}
