import assert from 'node:assert/strict'
import test from 'node:test'
import {WebSocket} from 'ws'
import {startTestServer, waitFor} from '../server/helpers.js'

test('party relay forwards guest messages, targeted host messages, and peer notices', async (t) => {
  const fixture = await startTestServer({party: {lanHost: '127.0.0.1'}})
  t.after(() => fixture.close())
  const base = fixture.url.replace(/^http/, 'ws')
  const host = await connect(`${base}/party/ABC123?role=host`)
  const guestOne = await connect(`${base}/party/ABC123?role=guest`)
  const guestTwo = await connect(`${base}/party/ABC123?role=guest`)
  t.after(() => [host, guestOne, guestTwo].forEach((client) => client.socket.close()))

  const hostReady = await host.next('relay_ready')
  assert.equal(hostReady.role, 'host')
  const readyOne = await guestOne.next('relay_ready')
  const readyTwo = await guestTwo.next('relay_ready')
  assert.notEqual(readyOne.peerId, readyTwo.peerId)
  assert.deepEqual((await Promise.all([host.next('peer_join'), host.next('peer_join')])).map(({peerId}) => peerId).sort(),
    [readyOne.peerId, readyTwo.peerId].sort())

  guestOne.send({type: 'input', tick: 7, inputs: {move: {x: 0, z: 1}}})
  assert.deepEqual(await host.next('input'), {
    type: 'input', tick: 7, inputs: {move: {x: 0, z: 1}}, peerId: readyOne.peerId,
  })

  host.send({type: 'welcome', to: readyOne.peerId, playerId: 'guest-1'})
  assert.deepEqual(await guestOne.next('welcome'), {type: 'welcome', playerId: 'guest-1'})
  await assert.rejects(guestTwo.next('welcome', 60), /condition was not met/)

  host.send({type: 'snapshot', tick: 30})
  assert.equal((await guestOne.next('snapshot')).tick, 30)
  assert.equal((await guestTwo.next('snapshot')).tick, 30)

  guestOne.socket.close()
  assert.equal((await host.next('peer_leave')).peerId, readyOne.peerId)
  host.socket.close()
  assert.equal((await guestTwo.next('host_leave')).reason, 'host left the party')
})

test('party relay rejects missing hosts and a third guest', async (t) => {
  const fixture = await startTestServer()
  t.after(() => fixture.close())
  const base = fixture.url.replace(/^http/, 'ws')

  const orphan = new WebSocket(`${base}/party/N0HOST?role=guest`)
  assert.equal((await closeOf(orphan)).code, 4004)

  const host = await connect(`${base}/party/FULL03?role=host`)
  const one = await connect(`${base}/party/FULL03?role=guest`)
  const two = await connect(`${base}/party/FULL03?role=guest`)
  const third = new WebSocket(`${base}/party/FULL03?role=guest`)
  t.after(() => [host.socket, one.socket, two.socket, third].forEach((socket) => socket.close()))
  assert.equal((await closeOf(third)).code, 4003)
})

test('party invite endpoint reports LAN and registered Quick Tunnel relay URLs', async (t) => {
  const fixture = await startTestServer({party: {lanHost: '127.0.0.1'}})
  t.after(() => fixture.close())
  fixture.server.setPartyTunnelUrl('https://sample-tunnel.trycloudflare.com')

  const response = await fetch(`${fixture.url}/party/INV123/invite`)
  assert.equal(response.status, 200)
  const invite = await response.json()
  assert.equal(invite.code, 'INV123')
  assert.match(invite.lan_url, /^ws:\/\/127\.0\.0\.1:\d+\/party\/INV123$/)
  assert.equal(invite.tunnel_url, 'wss://sample-tunnel.trycloudflare.com/party/INV123')
})

async function connect(url) {
  const socket = new WebSocket(url)
  const messages = []
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())))
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return {
    socket,
    send(message) { socket.send(JSON.stringify(message)) },
    async next(type, timeoutMs = 2_000) {
      return waitFor(() => {
        const index = messages.findIndex((message) => message.type === type)
        if (index < 0) return null
        return messages.splice(index, 1)[0]
      }, {timeoutMs, intervalMs: 5})
    },
  }
}

function closeOf(socket) {
  return new Promise((resolve, reject) => {
    socket.once('close', (code, reason) => resolve({code, reason: reason.toString()}))
    socket.once('error', reject)
  })
}
