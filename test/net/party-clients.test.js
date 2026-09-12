import assert from 'node:assert/strict'
import test from 'node:test'
import {WebSocket} from 'ws'
import {World} from '../../lib/core/world.js'
import {PartyGuest} from '../../lib/net/party-guest.js'
import {PartyHost} from '../../lib/net/party-host.js'
import {startTestServer, waitFor} from '../server/helpers.js'

const idleBrain = {tick() {}}
const brains = {scout: idleBrain, endo: idleBrain, heavy: idleBrain}
const idle = {move: {x: 0, z: 0}, yaw: 0, pitch: 0}

test('one host and two headless guests join and receive a snapshot over the real relay', async (t) => {
  const session = await makeSession(t, {guests: ['Kyle', 'Sarah']})
  const [kyle, sarah] = session.guests

  assert.deepEqual([...session.host.world.players.keys()], ['player', 'guest-1', 'guest-2'])
  assert.equal(kyle.playerId, 'guest-1')
  assert.equal(sarah.playerId, 'guest-2')
  assert.equal(kyle.world.players.size, 2, 'Kyle joined before Sarah and learns the third player in party state first')

  const kyleSnapshot = once(kyle, 'snapshot')
  const sarahSnapshot = once(sarah, 'snapshot')
  session.host.step(idle)
  await Promise.all([kyleSnapshot, sarahSnapshot])
  assert.equal(kyle.world.players.size, 3)
  assert.equal(sarah.world.players.size, 3)
  assert.equal(kyle.partyState.players.length, 3)
  assert.equal(sarah.partyState.players.length, 3)
})

test('guest input reaches the host and prediction reconciles within one snapshot', async (t) => {
  const session = await makeSession(t, {guests: ['Kyle']})
  const guest = session.guests[0]
  const startingZ = guest.world.getPlayer(guest.playerId).pos.z

  guest.step({move: {x: 0, z: 1}, yaw: 0, pitch: 0, sprint: true})
  const predictedZ = guest.world.getPlayer(guest.playerId).pos.z
  assert.ok(predictedZ > startingZ, 'local prediction moves before an authoritative step')
  await waitFor(() => session.host.latestInputs.get(guest.playerId)?.tick === 0)

  const snapshot = once(guest, 'snapshot')
  session.host.step(idle)
  await snapshot
  const hostPlayer = session.host.world.getPlayer(guest.playerId)
  const guestPlayer = guest.world.getPlayer(guest.playerId)
  assert.ok(hostPlayer.pos.z > startingZ, 'the host applied the guest input')
  assert.deepEqual(guestPlayer.pos, hostPlayer.pos)
  assert.equal(guest.pendingInputs.length, 0)
})

test('host schedules twenty authoritative snapshots for sixty simulation ticks', async (t) => {
  const session = await makeSession(t, {guests: ['Sarah']})
  const guest = session.guests[0]
  session.host.lastSnapshotTick = 0

  for (let tick = 0; tick < 60; tick += 1) session.host.step(idle)
  await waitFor(() => guest.messageCounts.received.snapshot === 20)

  assert.equal(session.host.messageCounts.sent.snapshot, 20)
  assert.equal(guest.world.tick, 60)
})

test('guest local hitscan reports a hit that damages the unit on the host', async (t) => {
  const session = await makeSession(t, {guests: ['Sarah']})
  const guest = session.guests[0]
  const player = session.host.world.getPlayer(guest.playerId)
  const unit = session.host.world.spawnUnit('scout', {x: player.pos.x, y: player.pos.y, z: player.pos.z + 5})
  const startingHp = unit.hp
  const startingMag = player.ammo.pistol.mag

  const delivered = once(guest, 'snapshot')
  session.host.sendSnapshot()
  await delivered
  guest.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0, fire: true})
  await waitFor(() => session.host.pendingHits.get(guest.playerId)?.has(0))
  session.host.step(idle)

  assert.ok(unit.hp < startingHp)
  assert.equal(session.host.world.eventLog.findLast((event) => event.type === 'unit_damage').playerId, guest.playerId)
  assert.equal(session.host.world.getPlayer(guest.playerId).ammo.pistol.mag, startingMag - 1)
})

test('guest ready and purchase messages update authoritative party and player state', async (t) => {
  const session = await makeSession(t, {guests: ['Sarah']})
  const guest = session.guests[0]
  const player = session.host.world.getPlayer(guest.playerId)
  session.host.world.phase = 'intermission'
  player.hp = 40

  guest.ready()
  await waitFor(() => session.host.players.get(guest.playerId)?.ready === true)
  const event = once(guest, 'purchase-result')
  const purchase = guest.purchase('medkit', 'medkit-1')
  assert.equal((await event).result.ok, true)
  assert.equal((await purchase).ok, true)
  assert.equal(player.hp, 90)
  assert.equal(player.scrap, 300)
})

test('guest reconnects with the same player id during the grace period', async (t) => {
  const session = await makeSession(t, {guests: ['Kyle'], disconnectGraceMs: 1_000})
  const original = session.guests[0]
  const playerId = original.playerId
  const resumeToken = original.resumeToken
  original.stop()
  await waitFor(() => session.host.players.get(playerId)?.connected === false)

  const resumed = new PartyGuest({
    code: 'NET123', relay: session.fixture.url, name: 'Kyle', resumeToken, WebSocket,
    worldFactory: ({seed}) => new World({seed, brains}),
  })
  t.after(() => resumed.stop())
  await resumed.start()

  assert.equal(resumed.playerId, playerId)
  assert.equal(session.host.players.get(playerId).connected, true)
  assert.equal(session.host.world.players.size, 2)
})

test('guest disconnect keeps a ten-second-grace slot before removal and host leave ends the party', async (t) => {
  const session = await makeSession(t, {guests: ['Kyle', 'Sarah'], disconnectGraceMs: 70})
  const [kyle, sarah] = session.guests
  kyle.stop()
  await waitFor(() => session.host.players.get(kyle.playerId)?.connected === false)
  assert.equal(session.host.world.players.has(kyle.playerId), true, 'player remains during grace')
  await waitFor(() => !session.host.world.players.has(kyle.playerId), {timeoutMs: 1_000})

  const ended = once(sarah, 'ended')
  session.host.stop()
  assert.match((await ended).notice, /host left/i)
})

async function makeSession(t, {guests: names, disconnectGraceMs = 10_000}) {
  const fixture = await startTestServer({party: {lanHost: '127.0.0.1'}})
  const world = new World({seed: 2029, brains})
  const host = new PartyHost({
    world, relay: fixture.url, code: 'NET123', name: 'John', WebSocket,
    disconnectGraceMs,
  })
  await host.start()
  const guests = []
  for (const name of names) {
    const guest = new PartyGuest({
      code: 'NET123', relay: fixture.url, name, WebSocket,
      worldFactory: ({seed}) => new World({seed, brains}),
    })
    await guest.start()
    guests.push(guest)
  }
  await waitFor(() => host.world.players.size === names.length + 1)
  t.after(async () => {
    for (const guest of guests) guest.stop()
    host.stop()
    world.destroy()
    await fixture.close()
  })
  return {fixture, host, guests}
}

function once(source, type) {
  return new Promise((resolve) => {
    const off = source.on(type, (event) => { off(); resolve(event.detail) })
  })
}
