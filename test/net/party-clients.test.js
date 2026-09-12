import assert from 'node:assert/strict'
import test from 'node:test'
import {WebSocket} from 'ws'
import {World} from '../../lib/core/world.js'
import {PartyGuest} from '../../lib/net/party-guest.js'
import {PartyHost, networkSnapshot} from '../../lib/net/party-host.js'
import {WaveDirector} from '../../lib/core/waves.js'
import {startTestServer, waitFor} from '../server/helpers.js'

const idleBrain = {tick() {}}
const brains = {scout: idleBrain, endo: idleBrain, heavy: idleBrain}
const idle = {move: {x: 0, z: 0}, yaw: 0, pitch: 0}
const config = {
  spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
  knobs: {gates: ['N1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
}

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
  const startingY = guest.world.getPlayer(guest.playerId).pos.y

  guest.step({move: {x: 0, z: 1}, yaw: 0, pitch: 0, sprint: true, jump: true})
  const predictedZ = guest.world.getPlayer(guest.playerId).pos.z
  const predictedY = guest.world.getPlayer(guest.playerId).pos.y
  assert.ok(predictedZ > startingZ, 'local prediction moves before an authoritative step')
  assert.ok(predictedY > startingY, 'local prediction jumps before an authoritative step')
  await waitFor(() => session.host.latestInputs.get(guest.playerId)?.tick === 0)

  const snapshot = once(guest, 'snapshot')
  session.host.step(idle)
  await snapshot
  const hostPlayer = session.host.world.getPlayer(guest.playerId)
  const guestPlayer = guest.world.getPlayer(guest.playerId)
  assert.ok(hostPlayer.pos.z > startingZ, 'the host applied the guest input')
  assert.ok(hostPlayer.pos.y > startingY, 'the host applied the guest jump pulse')
  assert.deepEqual(guestPlayer.pos, hostPlayer.pos)
  assert.equal(guest.pendingInputs.length, 0)
  assert.equal(guest.lastAcknowledgedInputTick, 0)
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

test('network snapshots omit growing history and remain within the WebRTC message limit', async (t) => {
  const session = await makeSession(t, {guests: ['Sarah']})
  const guest = session.guests[0]
  const player = session.host.world.getPlayer('player')
  player.hp = 1_000_000
  player.armor = 1_000_000
  for (let tick = 0; tick < 3_600; tick += 1) session.host.world.step(idle)

  const snapshot = networkSnapshot(session.host.world)
  const encodedBytes = Buffer.byteLength(JSON.stringify({type: 'snapshot', snapshot}), 'utf8')
  const delivered = once(guest, 'snapshot')
  session.host.sendSnapshot()
  await delivered

  assert.equal(session.host.world.replay.length, 3_600)
  assert.equal(guest.world.replay.length, 0)
  assert.equal(guest.world.tick, 3_600)
  assert.equal(snapshot.telemetry.playerPath.length, 0)
  assert.equal(Object.keys(snapshot.telemetry.units).length, 0)
  assert.ok(encodedBytes < 60 * 1_024, `network snapshot was ${encodedBytes} bytes`)
  assert.equal(session.host.connected, true)
  assert.equal(guest.connected, true)
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
  guest.step({...idle, ...aimAtVolume(session.host.world, player, unit, 'chest'), fire: true})
  for (let tick = 0; tick < 4; tick += 1) guest.step(idle)
  await waitFor(() => session.host.latestInputs.get(guest.playerId)?.tick === 4)
  assert.equal(session.host.pendingHits.get(guest.playerId)?.has(0), true)
  session.host.step(idle)

  assert.ok(unit.hp < startingHp)
  assert.equal(session.host.world.eventLog.findLast((event) => event.type === 'unit_damage').playerId, guest.playerId)
  assert.equal(session.host.world.getPlayer(guest.playerId).ammo.pistol.mag, startingMag - 1)
})

test('guest shot cadence follows elapsed time when input delivery is slower than sixty hertz', async (t) => {
  const session = await makeSession(t, {guests: ['Sarah']})
  const guest = session.guests[0]
  let now = 1_000
  guest.now = () => now
  assert.ok(guest.localShot(0, {...idle, fire: true}))
  now += 200
  assert.equal(guest.localShot(1, {...idle, fire: true}), null)
  now += 200
  assert.ok(guest.localShot(2, {...idle, fire: true}))
})

test('guest launcher fire creates one authoritative shell on the reliable host path', async (t) => {
  const session = await makeSession(t, {guests: ['Sarah']})
  const guest = session.guests[0]
  const player = session.host.world.getPlayer(guest.playerId)
  player.activeWeapon = 'launcher'
  player.ammo.launcher = {owned: true, mag: 1, reserve: 0}
  const delivered = once(guest, 'snapshot')
  session.host.sendSnapshot()
  await delivered
  guest.step({...idle, fire: true})
  await waitFor(() => session.host.latestInputs.get(guest.playerId)?.tick === 0)
  session.host.step(idle)
  const shells = session.host.world.projectiles.filter(projectile => projectile.weapon === 'launcher')
  assert.equal(shells.length, 1)
  assert.equal(shells[0].ownerId, guest.playerId)
  assert.equal(player.ammo.launcher.mag, 0)
})

test('guest sniper fire resolves all penetration hits authoritatively', async (t) => {
  const session = await makeSession(t, {guests: ['Kyle']})
  const guest = session.guests[0]
  const player = session.host.world.getPlayer(guest.playerId)
  Object.assign(player, {pos: {x: 15, y: 0, z: 10}, yaw: 0, pitch: 0, activeWeapon: 'sniper'})
  player.ammo.sniper = {owned: true, mag: 1, reserve: 0}
  const units = [15, 18, 21].map(z => session.host.world.spawnUnit('endo', {x: 15, y: 0, z}))
  const delivered = once(guest, 'snapshot')
  session.host.sendSnapshot()
  await delivered
  guest.step({...idle, fire: true})
  await waitFor(() => session.host.latestInputs.get(guest.playerId)?.tick === 0)
  session.host.step(idle)
  assert.ok(units.every(unit => unit.hp < unit.maxHp))
  assert.equal(player.ammo.sniper.mag, 0)
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

test('a transient guest socket drop reconnects automatically with its player id and input sequence', async (t) => {
  const session = await makeSession(t, {guests: ['Kyle'], disconnectGraceMs: 2_000})
  const guest = session.guests[0]
  const playerId = guest.playerId
  guest.step(idle)
  await waitFor(() => session.host.latestInputs.get(playerId)?.tick === 0)
  const firstSocket = guest.socket
  firstSocket.terminate()
  await waitFor(() => guest.socket && guest.socket !== firstSocket && guest.connected)
  await waitFor(() => session.host.players.get(playerId)?.connected === true)

  const tick = guest.step({move: {x: 0, z: 1}, yaw: 0, pitch: 0})
  await waitFor(() => session.host.latestInputs.get(playerId)?.tick === tick)
  assert.equal(guest.playerId, playerId)
  assert.equal(session.host.world.players.size, 2)
})

test('host waits for its own view and every connected guest view before starting a match', async (t) => {
  const session = await makeSession(t, {guests: ['Sarah']})
  const guest = session.guests[0]
  const preparing = once(guest, 'match-prepare')
  const prepared = session.host.prepareMatch({timeoutMs: 1_000, hostLoaded: false})

  await preparing
  session.host.acceptLoaded(session.host.world.hostPlayerId)
  let settled = false
  prepared.then(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(settled, false, 'the host remains in the party lobby while the guest loads')

  guest.loaded()
  assert.deepEqual(await prepared, {ok: true})
  assert.equal(session.host.matchStarted, false)
  session.host.startMatch()
  assert.equal(session.host.matchStarted, true)
})

test('an ended match returns the connected roster to the same ready-reset party', async (t) => {
  const session = await makeSession(t, {guests: ['Sarah']})
  const guest = session.guests[0]
  const director = session.host.director = new WaveDirector(session.host.world, {maxWaves: 3})
  session.host.setReady('player', true)
  guest.ready()
  await waitFor(() => session.host.players.get(guest.playerId)?.ready)
  director.start(config)
  session.host.startMatch()
  session.host.lastSnapshotTick = session.host.world.tick
  session.host.world.damagePlayer(1000, {type: 'test'}, 'player')
  session.host.world.damagePlayer(1000, {type: 'test'}, guest.playerId)
  session.host.step(idle)
  assert.equal(session.host.world.phase, 'ended')
  await waitFor(() => guest.world.phase === 'ended')

  const returned = once(guest, 'return-lobby')
  assert.deepEqual(session.host.returnToLobby(), {ok: true})
  await returned
  assert.equal(session.host.code, 'NET123')
  assert.equal(guest.code, 'NET123')
  assert.equal(guest.world.phase, 'lobby')
  assert.equal(session.host.players.size, 2)
  assert.ok([...session.host.players.values()].every(player => player.ready === false))
  assert.equal(guest.partyState.matchStarted, false)
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

function aimAtVolume(world, player, unit, volumeId) {
  const collider = world.unitHitCollider(unit)
  const volume = collider.shapes.find(shape => shape.id === volumeId) || collider.shapes[0]
  const offset = volume.offset || {x: 0, y: 0, z: 0}
  const cos = Math.cos(collider.yaw || 0)
  const sin = Math.sin(collider.yaw || 0)
  const target = {
    x: collider.center.x + (offset.x || 0) * cos + (offset.z || 0) * sin,
    y: collider.center.y + (offset.y || 0),
    z: collider.center.z - (offset.x || 0) * sin + (offset.z || 0) * cos,
  }
  const origin = {...player.pos, y: player.pos.y + (player.crouch ? 1.12 : 1.65)}
  const dx = target.x - origin.x
  const dy = target.y - origin.y
  const dz = target.z - origin.z
  return {yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz))}
}
