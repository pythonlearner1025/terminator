import assert from 'node:assert/strict'
import test from 'node:test'
import {WebSocket} from 'ws'
import {SignalingClient, createSignalRoom} from '../../lib/net/signaling.js'
import {startSignalStub} from './signal-stub.mjs'

test('signaling creates and joins a room, reports peers, and relays opaque signals', async t => {
  const stub = await startSignalStub()
  t.after(() => stub.close())
  const created = await createSignalRoom({origin: stub.origin, capacity: 3})
  assert.match(created.code, /^[A-HJ-NP-Z2-9]{6}$/)
  assert.equal(created.ttlSeconds, 3600)

  const host = new SignalingClient({code: created.code, role: 'host', name: 'John', origin: stub.origin, WebSocket, pingIntervalMs: 20})
  const guest = new SignalingClient({code: created.code, role: 'guest', name: 'Sarah', origin: stub.origin, WebSocket, pingIntervalMs: 20})
  t.after(() => { guest.close(); host.close() })
  await host.connect()
  const joined = once(host, 'peer-joined')
  const guestWelcome = await guest.connect()
  const guestPeer = await joined

  assert.equal(host.peerId, 'p1')
  assert.equal(guestWelcome.peerId, 'p2')
  assert.deepEqual(guestWelcome.peers, [{peerId: 'p1', name: 'John', role: 'host'}])
  assert.deepEqual(guestPeer, {peerId: 'p2', name: 'Sarah', role: 'guest'})

  const offerAtGuest = once(guest, 'signal')
  host.sendSignal(guest.peerId, {sdp: {type: 'offer', sdp: 'opaque-offer'}})
  assert.deepEqual(await offerAtGuest, {from: host.peerId, data: {sdp: {type: 'offer', sdp: 'opaque-offer'}}})

  const candidateAtHost = once(host, 'signal')
  guest.sendSignal(host.peerId, {candidate: {candidate: 'opaque-candidate'}})
  assert.deepEqual(await candidateAtHost, {from: guest.peerId, data: {candidate: {candidate: 'opaque-candidate'}}})

  const pong = once(host, 'pong')
  assert.deepEqual(await pong, {type: 'pong'})

  const left = once(host, 'peer-left')
  guest.close()
  assert.deepEqual(await left, {peerId: 'p2'})

  const response = await fetch(`${stub.origin}/rooms/${created.code}`)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).peers, [{peerId: 'p1', name: 'John', role: 'host'}])
})

function once(source, type) {
  return new Promise(resolve => {
    const off = source.on(type, event => { off(); resolve(event.detail) })
  })
}
