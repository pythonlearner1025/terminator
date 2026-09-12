#!/usr/bin/env node
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
import {startSignalStub} from '../net/signal-stub.mjs'

const root = new URL('../../', import.meta.url)
const stub = await startSignalStub()
const files = await startFileServer()
const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
})
const context = await browser.newContext()
const host = await context.newPage()
const guest = await context.newPage()

try {
  await Promise.all([host.goto(files.origin), guest.goto(files.origin)])
  const room = await host.evaluate(async signalOrigin => {
    const signalingModule = await import('/lib/net/signaling.js')
    const {WebRtcTransport} = await import('/lib/net/webrtc.js')
    const created = await signalingModule.createSignalRoom({origin: signalOrigin, capacity: 3})
    const signaling = new signalingModule.SignalingClient({code: created.code, role: 'host', name: 'John', origin: signalOrigin})
    const transport = new WebRtcTransport({role: 'host', signaling})
    window.peerTest = {signaling, transport, messages: [], opened: [], closed: [], errors: [], startedAt: performance.now()}
    transport.on('message', event => window.peerTest.messages.push(event.detail))
    transport.on('peer-open', event => window.peerTest.opened.push({...event.detail, at: performance.now()}))
    transport.on('peer-close', event => window.peerTest.closed.push(event.detail))
    transport.on('error', event => window.peerTest.errors.push(event.detail.message))
    transport.start()
    await signaling.connect()
    return created
  }, stub.origin)

  await guest.evaluate(async ({signalOrigin, code}) => {
    const signalingModule = await import('/lib/net/signaling.js')
    const {WebRtcTransport} = await import('/lib/net/webrtc.js')
    const signaling = new signalingModule.SignalingClient({code, role: 'guest', name: 'Sarah', origin: signalOrigin})
    const transport = new WebRtcTransport({role: 'guest', signaling})
    window.peerTest = {signaling, transport, messages: [], opened: [], closed: [], errors: [], startedAt: performance.now()}
    transport.on('message', event => window.peerTest.messages.push(event.detail))
    transport.on('peer-open', event => window.peerTest.opened.push({...event.detail, at: performance.now()}))
    transport.on('peer-close', event => window.peerTest.closed.push(event.detail))
    transport.on('error', event => window.peerTest.errors.push(event.detail.message))
    transport.start()
    await signaling.connect()
  }, {signalOrigin: stub.origin, code: room.code})

  await Promise.all([
    host.waitForFunction(() => window.peerTest?.opened.length === 1, null, {timeout: 15_000}),
    guest.waitForFunction(() => window.peerTest?.opened.length === 1, null, {timeout: 15_000}),
  ])

  const channels = await Promise.all([host, guest].map(page => page.evaluate(() => {
    const peer = [...window.peerTest.transport.peers.values()][0]
    return Object.fromEntries(Object.entries(peer.channels).map(([label, channel]) => [label, {
      readyState: channel.readyState,
      ordered: channel.ordered,
      maxRetransmits: channel.maxRetransmits,
    }]))
  })))
  for (const side of channels) {
    assert.equal(side.reliable.readyState, 'open')
    assert.equal(side.reliable.ordered, true)
    assert.equal(side.state.readyState, 'open')
    assert.equal(side.state.ordered, false)
    assert.equal(side.state.maxRetransmits, 0)
  }

  await Promise.all([host, guest].map((page, sender) => page.evaluate(senderIndex => {
    const peerId = window.peerTest.opened[0].peerId
    for (let index = 0; index < 200; index += 1) {
      window.peerTest.transport.sendState(JSON.stringify({type: 'state-test', sender: senderIndex, index}), peerId)
    }
  }, sender)))
  await Promise.all([host, guest].map(page => page.waitForFunction(() =>
    window.peerTest.messages.filter(message => JSON.parse(message.data).type === 'state-test').length >= 190,
  null, {timeout: 10_000})))

  await host.evaluate(() => {
    const peerId = window.peerTest.opened[0].peerId
    window.peerTest.transport.sendReliable(JSON.stringify({type: 'reliable-ping', value: 41}), peerId)
  })
  await guest.waitForFunction(() => window.peerTest.messages.some(message => JSON.parse(message.data).type === 'reliable-ping'))
  await guest.evaluate(() => {
    const ping = window.peerTest.messages.map(message => JSON.parse(message.data)).find(message => message.type === 'reliable-ping')
    window.peerTest.transport.sendReliable(JSON.stringify({type: 'reliable-pong', value: ping.value + 1}), window.peerTest.opened[0].peerId)
  })
  await host.waitForFunction(() => window.peerTest.messages.some(message => JSON.parse(message.data).type === 'reliable-pong'))

  const [hostResult, guestResult] = await Promise.all([host, guest].map(page => page.evaluate(() => ({
    peerId: window.peerTest.signaling.peerId,
    connectMs: window.peerTest.opened[0].at - window.peerTest.startedAt,
    stateReceived: window.peerTest.messages.filter(message => JSON.parse(message.data).type === 'state-test').length,
    reliable: window.peerTest.messages.map(message => JSON.parse(message.data)).filter(message => message.type.startsWith('reliable-')),
    errors: window.peerTest.errors,
  }))))
  assert.ok(hostResult.stateReceived >= 190, `host received ${hostResult.stateReceived} of 200 state messages`)
  assert.ok(guestResult.stateReceived >= 190, `guest received ${guestResult.stateReceived} of 200 state messages`)
  assert.deepEqual(hostResult.reliable, [{type: 'reliable-pong', value: 42}])
  assert.deepEqual(guestResult.reliable, [{type: 'reliable-ping', value: 41}])
  assert.deepEqual([...hostResult.errors, ...guestResult.errors], [])
  console.log(JSON.stringify({
    test: 'WebRTC two-page transport',
    room: room.code,
    channels,
    host: hostResult,
    guest: guestResult,
    minimumStateDelivery: 190,
  }, null, 2))
} finally {
  await Promise.all([host, guest].map(page => page.evaluate(() => window.peerTest?.transport.close()).catch(() => {})))
  await browser.close()
  await files.close()
  await stub.close()
}

async function startFileServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname === '/') {
      response.writeHead(200, {'Content-Type': 'text/html'})
      return response.end('<!doctype html><title>WebRTC transport test</title>')
    }
    if (!url.pathname.startsWith('/lib/')) {
      response.writeHead(404)
      return response.end()
    }
    try {
      const file = new URL(`.${url.pathname}`, root)
      if (!fileURLToPath(file).startsWith(fileURLToPath(root))) throw new Error('outside root')
      const source = await readFile(file)
      response.writeHead(200, {'Content-Type': 'text/javascript'})
      response.end(source)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}
