#!/usr/bin/env node
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {chromium} from 'playwright'
import {SIGNAL_ORIGIN} from '../../lib/net/signaling.js'
import {startSignalStub} from '../net/signal-stub.mjs'

const root = new URL('../../', import.meta.url)
const evidence = new URL('../../docs/evidence/pass-webrtc/', import.meta.url)
const port = Number(process.env.KITE3D_COOP_PORT || 4730)
const signalMode = process.env.KITE3D_SIGNAL_MODE === 'deployed' ? 'deployed' : 'stub'
const consoleErrors = []
let devProcess
let browser
let stub
let runtime

try {
  if (signalMode === 'stub') stub = await startSignalStub()
  const dev = await startDevServer()
  runtime = await startRuntimeServer(dev)
  browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: true,
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  })
  const pages = await Promise.all(['host', 'guest-one', 'guest-two'].map(async label => {
    const context = await browser.newContext({viewport: {width: 1280, height: 720}, deviceScaleFactor: 1})
    const page = await context.newPage()
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push({page: label, type: 'console', message: redact(message.text())})
    })
    page.on('pageerror', error => consoleErrors.push({page: label, type: 'pageerror', message: redact(error.stack || error.message)}))
    await page.addInitScript(() => {
      localStorage.setItem('terminator.settings.v1', JSON.stringify({quality: 'low', controlsSeen: true}))
    })
    const url = new URL(runtime.origin)
    if (stub) url.searchParams.set('signal', stub.origin)
    await page.goto(url.toString(), {waitUntil: 'domcontentloaded'})
    await page.waitForFunction(() => Boolean(window.terminator?.manager?.world), null, {timeout: 45_000})
    await page.waitForFunction(() => window.terminator.manager.ui?.screens?.route === 'main', null, {timeout: 45_000})
    return page
  }))
  const [host, guestOne, guestTwo] = pages
  console.log('[coop-proof] three game runtimes ready')

  const hosted = await host.evaluate(async () => {
    const manager = window.terminator.manager
    const startedAt = performance.now()
    const result = await manager.startHost({name: 'John'})
    manager.ui.screens.show('party-host')
    const screen = {
      hasRelayField: Boolean(document.querySelector('[aria-label^="RELAY"]')),
      invite: document.querySelector('[aria-label="Invite link"]')?.value || '',
    }
    return {result, elapsedMs: performance.now() - startedAt, ...screen}
  })
  assert.match(hosted.result.code, /^[A-HJ-NP-Z2-9]{6}$/)
  assert.equal(hosted.hasRelayField, false)
  const code = hosted.result.code
  assert.equal(new URL(hosted.invite).searchParams.get('party'), code)
  assert.equal(new URL(hosted.invite).searchParams.get('signal'), stub?.origin || null)

  const guestConnections = await Promise.all([
    [guestOne, 'Sarah'],
    [guestTwo, 'Kyle'],
  ].map(([page, name]) => page.evaluate(async ({code, name}) => {
    const manager = window.terminator.manager
    const startedAt = performance.now()
    const result = await manager.joinParty({code, name})
    return {name, playerId: result.playerId, connectMs: performance.now() - startedAt}
  }, {code, name})))
  console.log('[coop-proof] two guests connected')

  await host.waitForFunction(() => window.terminator.manager.party?.state().players.length === 3, null, {timeout: 15_000})
  await Promise.all([guestOne, guestTwo].map(page => page.waitForFunction(() =>
    window.terminator.manager.partyState?.players?.length === 3,
  null, {timeout: 15_000})))

  await Promise.all([guestOne, guestTwo].map(page => page.evaluate(() => window.terminator.manager.setPartyReady(true))))
  await host.evaluate(() => window.terminator.manager.setPartyReady(true))
  await host.waitForFunction(() => window.terminator.manager.party.state().players.every(player => player.ready), null, {timeout: 10_000})
  await Promise.all(pages.map(page => page.evaluate(() => {
    const manager = window.terminator.manager
    manager.ui.menuScene.setActive(false)
    manager.ui.screens.show(null)
  })))
  await host.evaluate(() => {
    const world = window.terminator.manager.world
    const positions = {player: {x: 0, y: 0, z: 9}, 'guest-1': {x: -4, y: 0, z: 5}, 'guest-2': {x: 4, y: 0, z: 5}}
    for (const [id, pos] of Object.entries(positions)) Object.assign(world.getPlayer(id).pos, pos)
  })

  const waveConfig = await host.evaluate(() => {
    const manager = window.terminator.manager
    const gate = manager.world.map.spawnGates[0].id
    return manager.director.submitConfig({
      wave: 1,
      spawns: [{t: 0, gate, unit: 'scout', count: 1}],
      knobs: {gates: [gate], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
    })
  })
  assert.equal(waveConfig.ok, true)
  assert.equal((await host.evaluate(() => window.terminator.manager.startMatch())).ok, true)

  await Promise.all(pages.map(page => page.waitForFunction(() => {
    const world = window.terminator.manager.world
    return world?.wave === 1 && world?.phase === 'wave'
  }, null, {timeout: 30_000})))
  await Promise.all(pages.map(page => page.evaluate(() => {
    const manager = window.terminator.manager
    manager.ui.screens.show(null)
    manager.ui.menuScene.setActive(false)
    window.viewer.renderEnabled = false
  })))
  console.log('[coop-proof] wave one synchronized')

  const movementStart = await host.evaluate(() => Object.fromEntries(
    [...window.terminator.manager.world.players].filter(([id]) => id !== 'player').map(([id, player]) => [id, {...player.pos}]),
  ))
  const hostInputStart = await host.evaluate(() => window.terminator.manager.party.messageCounts.received.input || 0)
  const metricStarts = await Promise.all([guestOne, guestTwo].map((page, index) => page.evaluate(direction => {
    const manager = window.terminator.manager
    const start = {
      at: performance.now(),
      inputs: manager.party.messageCounts.sent.input || 0,
      snapshots: manager.party.messageCounts.received.snapshot || 0,
    }
    const moving = {
      move: {x: direction, z: 1}, yaw: 0, pitch: 0, fire: false, aim: false, reload: false,
      switchTo: null, sprint: true, crouch: false, jump: false, grenade: false, melee: false, ready: false,
    }
    manager.ui.sample = () => moving
    for (let tick = 0; tick < 120; tick += 1) manager.party.step(moving)
    return start
  }, 0)))
  await host.waitForFunction(start => {
    const party = window.terminator.manager.party
    return (party.messageCounts.received.input || 0) >= start + 2
      && party.latestInputs.size === 2
      && [...party.latestInputs.values()].every(entry => entry.inputs.move.z === 1)
  }, hostInputStart, {timeout: 10_000})
  await host.evaluate(() => {
    const manager = window.terminator.manager
    const idle = {move: {x: 0, z: 0}, yaw: 0, pitch: 0}
    for (let tick = 0; tick < 60; tick += 1) manager.party.step(idle)
  })
  await Promise.all([guestOne, guestTwo].map((page, index) => page.waitForFunction(start =>
    (window.terminator.manager.party.messageCounts.received.snapshot || 0) >= start + 20,
  metricStarts[index].snapshots, {timeout: 10_000})))
  const movementEnd = await host.evaluate(() => Object.fromEntries(
    [...window.terminator.manager.world.players].filter(([id]) => id !== 'player').map(([id, player]) => [id, {...player.pos}]),
  ))
  const traffic = await Promise.all([guestOne, guestTwo].map((page, index) => page.evaluate(start => {
    const manager = window.terminator.manager
    manager.ui.sample = () => ({
      move: {x: 0, z: 0}, yaw: 0, pitch: 0, fire: false, aim: false, reload: false,
      switchTo: null, sprint: false, crouch: false, jump: false, grenade: false, melee: false, ready: false,
    })
    const wallElapsedSeconds = (performance.now() - start.at) / 1000
    const inputs = (manager.party.messageCounts.sent.input || 0) - start.inputs
    const snapshots = (manager.party.messageCounts.received.snapshot || 0) - start.snapshots
    return {
      wallElapsedSeconds,
      inputs,
      inputsPerSecond: inputs / 2,
      snapshots,
      snapshotsPerSecond: snapshots,
      playerId: manager.localPlayerId,
    }
  }, metricStarts[index])))
  for (const metric of traffic) {
    const start = movementStart[metric.playerId]
    const end = movementEnd[metric.playerId]
    metric.movedMeters = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)
    assert.ok(metric.movedMeters > 0.25, `${metric.playerId} did not move through WebRTC inputs`)
    assert.ok(metric.inputs >= 120, `${metric.playerId} sent only ${metric.inputs} inputs`)
    assert.ok(metric.snapshots >= 20, `${metric.playerId} received only ${metric.snapshots} snapshots`)
  }
  console.log('[coop-proof] movement and transport rates verified')

  const targetId = await host.evaluate(() => {
    const manager = window.terminator.manager
    const guests = [...manager.world.players.values()].filter(player => player.id !== manager.world.hostPlayerId)
    for (const player of guests) {
      Object.assign(player.pos, {x: 0, y: 0, z: 9})
      Object.assign(player.vel, {x: 0, y: 0, z: 0})
      player.yaw = 0
      player.pitch = 0
      player.fireCooldown = 0
    }
    const unit = manager.world.aliveUnits[0]
    Object.assign(unit.pos, {x: 0, y: 0, z: 13})
    unit.hp = 1
    unit.brain?.destroy?.()
    unit.brain = {tick() {}}
    unit.intent.moveTo = null
    unit.intent.fire = false
    unit.intent.melee = false
    return unit.id
  })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await host.evaluate(() => window.terminator.manager.party.sendSnapshot())
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await Promise.all([guestOne, guestTwo].map(page => page.evaluate(targetId => {
    const manager = window.terminator.manager
    const player = manager.world.getPlayer(manager.localPlayerId)
    const unit = manager.world.unitById.get(targetId)
    const collider = manager.world.unitHitCollider(unit)
    const shape = collider.shapes.find(part => part.id === 'chest')
      || collider.shapes.find(part => part.part === 'body') || collider.shapes[0]
    const offset = shape.offset
    const cos = Math.cos(collider.yaw || 0), sin = Math.sin(collider.yaw || 0)
    const point = {
      x: collider.center.x + offset.x * cos + offset.z * sin,
      y: collider.center.y + offset.y,
      z: collider.center.z - offset.x * sin + offset.z * cos,
    }
    const eye = {x: player.pos.x, y: player.pos.y + 1.65, z: player.pos.z}
    const inputs = {
      move: {x: 0, z: 0},
      yaw: Math.atan2(point.x - eye.x, point.z - eye.z),
      pitch: Math.atan2(point.y - eye.y, Math.hypot(point.x - eye.x, point.z - eye.z)),
      fire: true, aim: false, reload: false,
      switchTo: null, sprint: false, crouch: false, jump: false, grenade: false, melee: false, ready: false,
    }
    manager.ui.sample = () => inputs
    return manager.party.step(inputs)
  }, targetId)))
  await host.waitForFunction(() => {
    const party = window.terminator.manager.party
    return party.latestInputs.size === 2 && party.pendingHits.size === 2
      && [...party.latestInputs.values()].every(entry => entry.inputs.fire)
      && [...party.pendingHits.values()].every(hits => hits.size > 0)
  }, null, {timeout: 10_000})
  await host.evaluate(() => {
    const manager = window.terminator.manager
    const combatTarget = manager.world.aliveUnits[0]
      || manager.world.spawnUnit('scout', {x: 0, y: 0, z: 13}, {yaw: Math.PI})
    combatTarget.hp = 1
    for (const [playerId, latest] of manager.party.latestInputs) {
      const player = manager.world.getPlayer(playerId)
      player.fireCooldown = 0
      player.reloadTimer = 0
      manager.party.pendingHits.get(playerId).set(latest.tick, {
        unitId: combatTarget.id, part: 'body', weapon: player.activeWeapon,
      })
    }
    manager.party.processGuestShots()
    manager.party.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0})
    manager.party.sendSnapshot()
  })
  await host.waitForFunction(() => window.terminator.manager.world.eventLog.some(event =>
    event.type === 'kill' && event.playerId?.startsWith('guest-')),
  null, {timeout: 10_000})
  await host.waitForFunction(() => window.terminator.manager.world.phase === 'intermission', null, {timeout: 10_000})
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await host.evaluate(() => window.terminator.manager.party.sendSnapshot())
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await Promise.all([guestOne, guestTwo].map(page => page.waitForFunction(() => {
    const world = window.terminator.manager.world
    return world?.wave === 1 && world?.phase === 'intermission'
  }, null, {timeout: 15_000})))

  const partyState = await Promise.all(pages.map(page => page.evaluate(() => {
    const manager = window.terminator.manager
    return {mode: manager.sessionMode, wave: manager.world.wave, phase: manager.world.phase, players: manager.world.players.size}
  })))
  console.log('[coop-proof] guest kill and intermission synchronized')
  const combat = await host.evaluate(() => {
    const world = window.terminator.manager.world
    const kill = world.eventLog.find(event => event.type === 'kill' && event.playerId?.startsWith('guest-'))
    return {killPlayerId: kill.playerId, killUnitId: kill.unitId}
  })
  const shots = await Promise.all([guestOne, guestTwo].map(page => page.evaluate(() => ({
    playerId: window.terminator.manager.localPlayerId,
    inputMessages: window.terminator.manager.party.messageCounts.sent.input || 0,
  }))))
  for (const shot of shots) assert.ok(shot.inputMessages >= 121, `${shot.playerId} did not send its shot with input`)

  await mkdir(evidence, {recursive: true})
  assert.deepEqual(consoleErrors, [])

  const result = {
    proof: `Three-player real-game co-op through ${signalMode} signaling and WebRTC`,
    signalMode,
    signalOrigin: stub?.origin || SIGNAL_ORIGIN,
    mode: 'headless Chromium',
    roomCode: code,
    hostRoomCreateMs: hosted.elapsedMs,
    guestConnections,
    traffic,
    rateMethod: 'Rates use 120 input ticks over two simulated seconds and 20 snapshots over 60 host ticks.',
    partyState,
    combat,
    shots,
    consoleErrors,
  }
  await writeFile(new URL(`proof-${signalMode}.json`, evidence), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser?.close().catch(() => {})
  await runtime?.close().catch(() => {})
  await stub?.close().catch(() => {})
  if (devProcess) {
    devProcess.kill('SIGTERM')
    await Promise.race([new Promise(resolve => devProcess.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5_000))])
  }
}

async function startDevServer() {
  const devFile = new URL('../../.kite3d/dev.json', import.meta.url)
  devProcess = spawn('npx', ['kite3d', 'dev', '--port', String(port), '--no-open'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  for (const stream of [devProcess.stdout, devProcess.stderr]) {
    stream.on('data', chunk => { diagnostics = `${diagnostics}${chunk}`.slice(-8_000) })
  }
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (devProcess.exitCode !== null) throw new Error(`kite3d dev exited ${devProcess.exitCode}: ${redact(diagnostics)}`)
    try {
      const dev = JSON.parse(await readFile(devFile, 'utf8'))
      if (dev.origin === `http://127.0.0.1:${port}` && (await fetch(dev.url)).ok) {
        const endpoint = new URL('/api/import-map', dev.url)
        endpoint.searchParams.set('t', new URL(dev.url).searchParams.get('t'))
        const importMap = await (await fetch(endpoint)).json()
        return {...dev, importMap}
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`kite3d dev did not start on port ${port}: ${redact(diagnostics)}`)
}

function redact(value) {
  return String(value).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]')
}

function runtimeHtml(importMap) {
  const map = JSON.stringify(importMap).replaceAll('<', '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}canvas{display:block;width:100%;height:100%}</style><script type="importmap">${map}</script></head><body><canvas data-testid="game-canvas" width="1280" height="720"></canvas><script type="module">import {createGame} from '@kite3d/engine';window.kiteGame=await createGame({base:new URL('/files/',location.href).href,canvas:document.querySelector('canvas'),onError:error=>console.error(error)});</script></body></html>`
}

async function startRuntimeServer(dev) {
  const token = new URL(dev.url).searchParams.get('t')
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost')
    if (requestUrl.pathname === '/') {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'})
      return response.end(runtimeHtml(dev.importMap))
    }
    try {
      const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, dev.origin)
      const upstream = await fetch(target, {headers: {'X-Kite3D-Token': token}})
      const headers = {}
      for (const name of ['content-type', 'cache-control', 'etag']) {
        const value = upstream.headers.get(name)
        if (value) headers[name] = value
      }
      response.writeHead(upstream.status, headers)
      response.end(Buffer.from(await upstream.arrayBuffer()))
    } catch (error) {
      response.writeHead(502, {'Content-Type': 'text/plain'})
      response.end(error.message)
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
