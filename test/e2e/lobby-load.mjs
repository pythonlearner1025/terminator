#!/usr/bin/env node
import assert from 'node:assert/strict'
import {spawn, execFile} from 'node:child_process'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {promisify} from 'node:util'
import {chromium} from 'playwright'
import {WebSocket} from 'ws'
import {SIGNAL_ORIGIN} from '../../lib/net/signaling.js'

const ROOT = new URL('../../', import.meta.url)
const EVIDENCE = new URL('file:///Users/minjunes/games/terminator-evidence/docs/evidence/lobby-qa/')
const RAW = new URL('raw-results.json', EVIDENCE)
const PORT = 4740
const LOAD_SECONDS = Number(process.env.LOBBY_LOAD_SECONDS || 6)
const BASELINE_SECONDS = Number(process.env.LOBBY_BASELINE_SECONDS || 6)
const execFileAsync = promisify(execFile)
const pages = []
const pageNames = new Map()
const consoleIssues = []
const timeline = []
const result = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  mode: 'three isolated contexts in headless Chromium',
  gamePort: PORT,
  signalingOrigin: SIGNAL_ORIGIN,
  snapshotRateConfiguration: {baselineHz: 20, thirtyHzKnobAvailable: false},
  loadMethod: 'The normal three-player director set maxAlive=36. The harness replaced its zero-time schedule and invoked spawnDueUnits for exact counts.',
  frameMetric: 'CPU frame duration is one PartyHost or PartyGuest step. p99 excludes view, compositor, and GPU time.',
  packetLossMetric: 'State loss is application snapshot count loss. Chromium exposes no SCTP state-channel packetsLost counter.',
  timeline,
  consoleIssues,
  failures: [],
}

let devProcess
let runtime
let browser
let activeTest = 'startup'

try {
  await mkdir(EVIDENCE, {recursive: true})
  result.initialMachineLoad = await machineLoad()
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

  const [host, guestOne, guestTwo] = await Promise.all(['host', 'sarah', 'kyle'].map(async name => {
    const context = await browser.newContext({viewport: {width: 1280, height: 720}, deviceScaleFactor: 1})
    await context.addInitScript(rtcInstrumentation)
    const page = await context.newPage()
    pages.push(page)
    pageNames.set(page, name)
    watchPage(name, page)
    return page
  }))
  pages.splice(0, pages.length, host, guestOne, guestTwo)

  activeTest = 'baseline_deployed_three_player'
  await bootPage(host, runtime.origin)
  const hosted = await host.evaluate(async () => {
    const startedAt = Date.now()
    const manager = window.terminator.manager
    const state = await manager.startHost({name: 'John'})
    manager.ui.screens.show('party-host')
    return {
      state,
      startAt: startedAt,
      roomReadyAt: Date.now(),
      invite: manager.party.inviteUrl,
      signalOrigin: manager.party.signalOrigin,
    }
  })
  assert.equal(hosted.signalOrigin, SIGNAL_ORIGIN)
  assert.match(hosted.state.code, /^[A-HJ-NP-Z2-9]{6}$/)
  assert.equal(new URL(hosted.invite).searchParams.get('party'), hosted.state.code)
  assert.equal(new URL(hosted.invite).searchParams.has('signal'), false)
  mark('room-created', {code: hosted.state.code})

  await Promise.all([guestOne, guestTwo].map(page => bootPage(page, hosted.invite, 'party-join')))
  const joined = [
    await joinGuest(guestOne, 'Sarah', hosted.roomReadyAt),
    await joinGuest(guestTwo, 'Kyle', hosted.roomReadyAt),
  ]
  await waitForRoster([host, guestOne, guestTwo], ['John', 'Sarah', 'Kyle'])
  mark('three-data-channel-peers-open')

  const hostRtc = await rtcState(host)
  const guestRtc = await Promise.all([rtcState(guestOne), rtcState(guestTwo)])
  assert.equal(hostRtc.activePeers.length, 2)
  assert.ok(guestRtc.every(entry => entry.activePeers.length === 1))

  await installMetrics(host)
  await Promise.all([host, guestOne, guestTwo].map(page => page.evaluate(() => {
    const manager = window.terminator.manager
    manager.setPartyReady(true)
    manager.ui.menuScene.setActive(false)
    manager.ui.screens.show(null)
  })))
  await host.waitForFunction(() => window.terminator.manager.party.state().players.every(player => player.ready))
  const waveOneConfig = await submitWave(host, 1, 3)
  assert.equal(waveOneConfig.ok, true)
  assert.equal((await host.evaluate(() => window.terminator.manager.startMatch())).ok, true)
  await waitForPhase([host, guestOne, guestTwo], 'wave', 1)
  mark('wave-1-started')
  await makePlayersDurable(host)

  await installMovement(host, [guestOne, guestTwo], {moving: false})
  const baselineStart = await trafficStart(host, [guestOne, guestTwo])
  await startClocks(host, [guestOne, guestTwo])
  await delay(BASELINE_SECONDS * 1000)
  await stopClocks(host, [guestOne, guestTwo])
  const baselineEndedAt = Date.now()
  await delay(150)
  result.baseline = await trafficFinish(host, [guestOne, guestTwo], baselineStart, BASELINE_SECONDS, baselineEndedAt)
  await restoreMovement(host, [guestOne, guestTwo])
  result.baseline.roomCreateMs = hosted.roomReadyAt - hosted.startAt
  result.baseline.connections = joined
  result.baseline.ice = {host: hostRtc, guests: guestRtc}
  result.baseline.machineLoad = await machineLoad()
  assert.ok(result.baseline.guests.every(metric => metric.snapshotRateHz >= 15), 'baseline snapshot rate fell below 15 Hz')
  result.baseline.inputRateBelowNominal = result.baseline.guests.some(metric => metric.inputRateHz < 55)
  mark('baseline-measured', {seconds: BASELINE_SECONDS})

  activeTest = 'wave_one_guest_kills_and_trader'
  await freezeHost(host)
  await awardHostKill(host)
  await awardGuestKill(host, guestOne, 'guest-1')
  await awardGuestKill(host, guestTwo, 'guest-2')
  await host.evaluate(() => window.terminator.manager.party.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0}))
  await waitForPhase([host, guestOne, guestTwo], 'intermission', 1)
  const kills = await host.evaluate(() => Object.fromEntries([...window.terminator.world.players].map(([id]) => [id,
    window.terminator.world.eventLog.filter(event => event.type === 'kill' && event.playerId === id).length])))
  assert.ok(kills['guest-1'] >= 1)
  assert.ok(kills['guest-2'] >= 1)
  mark('wave-1-intermission', {kills})

  result.purchases = await buyAtTrader(host, [guestOne, guestTwo])
  assert.ok(result.purchases.every(purchase => purchase.result?.ok === true))
  mark('trader-purchases-complete')

  activeTest = 'wave_two_load_matrix'
  const waveTwoConfig = await submitWave(host, 2, 1)
  assert.equal(waveTwoConfig.ok, true)
  await host.evaluate(() => {
    const manager = window.terminator.manager
    manager.ui.screens.show(null)
    manager.party.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0, ready: true})
    manager.started = true
  })
  await waitForPhase([host, guestOne, guestTwo], 'wave', 2)
  mark('wave-2-started')

  result.loadMatrix = []
  for (const enemyCount of [12, 24, 36]) {
    activeTest = `load_${enemyCount}_alive`
    await injectEnemyLoad(host, [guestOne, guestTwo], enemyCount)
    if (enemyCount === 24) await capture(host, 'host-mid-wave-2.png')
    let churnPromise = null
    if (enemyCount === 36) {
      await capture(guestOne, 'guest-36-enemies.png')
      churnPromise = signalingRoomChurn(30)
    }
    const metric = await measureLoad(host, [guestOne, guestTwo], enemyCount, LOAD_SECONDS)
    result.loadMatrix.push(metric)
    if (churnPromise) {
      result.signalingChurn = await churnPromise
      result.signalingChurn.matchAffected = metric.guests.some(guest => guest.snapshotRateHz < 15)
        || metric.guests.some(guest => guest.inputRateHz < 55)
        || metric.guests.some(guest => !guest.connected)
      result.signalingChurn.matchImpact = {
        snapshotRatesHz: metric.guests.map(guest => guest.snapshotRateHz),
        inputRatesHz: metric.guests.map(guest => guest.inputRateHz),
        connected: metric.guests.map(guest => guest.connected),
      }
    }
    assert.equal(metric.observedEnemies.host, enemyCount)
    assert.ok(metric.observedEnemies.guests.every(count => count === enemyCount))
    assert.ok(metric.guests.every(guest => guest.connected))
    mark(`load-${enemyCount}-measured`)
  }
  assert.equal(result.signalingChurn.roomsRequested, 30)
  assert.equal(result.signalingChurn.roomsCompleted, 30)
  assert.equal(result.signalingChurn.errors.length, 0)

  activeTest = 'guest_churn_wave_two'
  result.guestChurn = await churnGuestTwice(host, guestTwo)
  assert.ok(result.guestChurn.every(item => item.samePlayerId && item.sameResumeToken))
  await waitForRoster([host, guestOne, guestTwo], ['John', 'Sarah', 'Kyle'])
  mark('guest-rejoined-twice', {durationsMs: result.guestChurn.map(item => item.elapsedMs)})

  activeTest = 'guest_side_impairment'
  await injectEnemyLoad(host, [guestOne, guestTwo], 12)
  result.impairment = {
    cdpLimitation: 'CDP Network.emulateNetworkConditions does not shape WebRTC data channels. It was not used.',
    cases: [],
    firstBreak: null,
  }
  for (const latencyMs of [100, 250]) {
    await resetPlayerPositions(host, [guestOne, guestTwo])
    await setGuestImpairment(guestOne, {latencyMs, lossPercent: 2})
    const impaired = await measureLoad(host, [guestOne, guestTwo], 12, 5)
    const detail = impaired.guests.find(guest => guest.name === 'sarah')
    result.impairment.cases.push({
      latencyMs,
      requestedLossPercent: 2,
      injectionLayer: 'guest receivePeer application hook after WebRTC delivery',
      snapshotRateHz: detail.snapshotRateHz,
      observedApplicationDrops: await guestOne.evaluate(() => window.__qaImpairment.dropped),
      maxPositionErrorMeters: detail.maxPositionErrorMeters,
      connected: detail.connected,
    })
    await clearGuestImpairment(guestOne)
  }
  result.impairment.firstBreak = result.impairment.cases.find(item => !item.connected || item.snapshotRateHz < 15) || null
  mark('impairment-cases-complete')

  activeTest = 'wave_two_intermission'
  await fightWaveToClear(host, [[guestOne, 'guest-1'], [guestTwo, 'guest-2']])
  await waitForPhase([host, guestOne, guestTwo], 'intermission', 2)
  mark('wave-2-intermission')

  activeTest = 'wipe_return_restart'
  assert.equal((await submitWave(host, 3, 1)).ok, true)
  await host.evaluate(() => window.terminator.manager.party.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0, ready: true}))
  await waitForPhase([host, guestOne, guestTwo], 'wave', 3)
  mark('wave-3-started-for-wipe')
  await wipeParty(host)
  await waitForPhase([host, guestOne, guestTwo], 'ended', 3)
  await Promise.all([host, guestOne, guestTwo].map(page => page.evaluate(() => window.terminator.manager.syncViews())))
  await Promise.all([host, guestOne, guestTwo].map(page => page.getByTestId('coop-scoreboard').waitFor({timeout: 15_000})))
  const scoreRows = await Promise.all([host, guestOne, guestTwo].map(page => page.getByTestId('coop-scoreboard').locator('tbody tr').count()))
  assert.deepEqual(scoreRows, [3, 3, 3])
  mark('scoreboard-shown', {rows: scoreRows})

  const originalCode = hosted.state.code
  assert.equal((await host.evaluate(() => window.terminator.manager.returnPartyToLobby())).ok, true)
  await Promise.all([host, guestOne, guestTwo].map(page => page.waitForFunction(() =>
    window.terminator.manager.partyState?.status === 'lobby' && window.terminator.world.phase === 'lobby')))
  const lobbyState = await Promise.all([host, guestOne, guestTwo].map(page => page.evaluate(() => ({
    code: window.terminator.manager.partyState.code,
    roster: window.terminator.manager.partyState.players.map(player => player.name),
    ready: window.terminator.manager.partyState.players.map(player => player.ready),
  }))))
  assert.ok(lobbyState.every(state => state.code === originalCode))
  assert.ok(lobbyState.every(state => state.roster.join('|') === 'John|Sarah|Kyle'))
  assert.ok(lobbyState.every(state => state.ready.every(value => value === false)))
  await capture(host, 'party-lobby-after-wipe.png')
  mark('same-party-lobby-restored', {code: originalCode})

  await Promise.all([host, guestOne, guestTwo].map(page => page.evaluate(() => window.terminator.manager.setPartyReady(true))))
  await host.waitForFunction(() => window.terminator.manager.party.state().players.every(player => player.ready))
  assert.equal((await submitWave(host, 1, 1)).ok, true)
  assert.equal((await host.evaluate(() => window.terminator.manager.startMatch())).ok, true)
  await waitForPhase([host, guestOne, guestTwo], 'wave', 1)
  const restartCodes = await Promise.all([host, guestOne, guestTwo].map(page => page.evaluate(() => window.terminator.manager.partyState.code)))
  assert.deepEqual(restartCodes, [originalCode, originalCode, originalCode])
  mark('second-match-wave-1-reached', {code: originalCode})

  result.verdict = 'pass'
  result.consoleErrors = consoleIssues.filter(issue => issue.level === 'error' || issue.level === 'pageerror')
  assert.deepEqual(result.consoleErrors, [])
  await writeRaw()
  console.log(JSON.stringify({ok: true, result}, null, 2))
} catch (error) {
  result.verdict = 'fail'
  result.failures.push({test: activeTest, message: redact(error?.stack || error?.message || error)})
  await writeRaw().catch(() => {})
  console.error(`[lobby-load] FAIL ${activeTest}: ${redact(error?.stack || error)}`)
  process.exitCode = 1
} finally {
  await Promise.allSettled(pages.map(page => page.context().close()))
  await browser?.close().catch(() => {})
  await runtime?.close().catch(() => {})
  if (devProcess) {
    devProcess.kill('SIGTERM')
    await Promise.race([new Promise(resolve => devProcess.once('exit', resolve)), delay(5_000)])
  }
}

function rtcInstrumentation() {
  localStorage.setItem('terminator.settings.v1', JSON.stringify({quality: 'low', controlsSeen: true}))
  const Native = window.RTCPeerConnection
  const records = []
  window.__lobbyQaRtc = {records}
  function trackChannel(record, channel) {
    record.channels[channel.label] ||= {createdAt: Date.now(), openedAt: null, closedAt: null}
    channel.addEventListener('open', () => {
      record.channels[channel.label].openedAt = Date.now()
      if (record.channels.reliable?.openedAt && record.channels.state?.openedAt && !record.bothOpenAt) {
        record.bothOpenAt = Math.max(record.channels.reliable.openedAt, record.channels.state.openedAt)
      }
    })
    channel.addEventListener('close', () => { record.channels[channel.label].closedAt = Date.now() })
  }
  function Wrapped(...args) {
    const pc = new Native(...args)
    const record = {createdAt: Date.now(), bothOpenAt: null, channels: {}, candidates: [], states: [], pc}
    records.push(record)
    const create = pc.createDataChannel.bind(pc)
    pc.createDataChannel = (...channelArgs) => {
      const channel = create(...channelArgs)
      trackChannel(record, channel)
      return channel
    }
    pc.addEventListener('datachannel', event => trackChannel(record, event.channel))
    pc.addEventListener('icecandidate', event => {
      if (!event.candidate) return
      const candidate = event.candidate
      record.candidates.push({type: candidate.type || parseCandidateType(candidate.candidate), protocol: candidate.protocol || null})
    })
    pc.addEventListener('connectionstatechange', () => record.states.push({state: pc.connectionState, at: Date.now()}))
    return pc
  }
  Wrapped.prototype = Native.prototype
  Object.setPrototypeOf(Wrapped, Native)
  window.RTCPeerConnection = Wrapped
  function parseCandidateType(value) {
    const match = String(value || '').match(/ typ (host|srflx|relay|prflx)(?: |$)/)
    return match?.[1] || 'unknown'
  }
}

async function bootPage(page, url, route = 'main') {
  await page.goto(url, {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(expected => window.terminator?.manager?.ui?.screens?.route === expected, route, {timeout: 90_000})
  await page.evaluate(() => {
    const manager = window.terminator.manager
    manager.ui.screens.settings.quality = 'low'
    manager.ui.applySettings(manager.ui.screens.settings)
    const renderer = manager.ctx.viewer.renderManager.webglRenderer
    renderer.compile = () => {}
    renderer.compileAsync = null
    const startViews = manager.startViews.bind(manager)
    manager.startViews = () => {
      const started = startViews()
      manager.visualWarmup = Promise.resolve({headless: true})
      return started
    }
  })
}

async function joinGuest(page, name, roomReadyAt) {
  const joined = await page.evaluate(async name => {
    const manager = window.terminator.manager
    const joinStartedAt = Date.now()
    const code = new URLSearchParams(location.search).get('party')
    const state = await manager.joinParty({code, name})
    await new Promise(resolve => {
      const check = () => {
        const record = window.__lobbyQaRtc.records.find(item => item.bothOpenAt)
        if (record) resolve()
        else setTimeout(check, 5)
      }
      check()
    })
    const record = window.__lobbyQaRtc.records.find(item => item.bothOpenAt)
    return {name, playerId: state.playerId, joinStartedAt, channelOpenAt: record.bothOpenAt, joinedAt: Date.now()}
  }, name)
  return {
    name,
    playerId: joined.playerId,
    roomToChannelsOpenMs: joined.channelOpenAt - roomReadyAt,
    joinToChannelsOpenMs: joined.channelOpenAt - joined.joinStartedAt,
    channelsOpenToWelcomeMs: joined.joinedAt - joined.channelOpenAt,
  }
}

async function installMetrics(host) {
  await host.evaluate(() => {
    const manager = window.terminator.manager
    window.__qaSnapshotBytes = []
    const originalSend = manager.party.send.bind(manager.party)
    manager.party.send = (message, options) => {
      if (message?.type === 'snapshot') {
        const {to: _to, peerId: _peerId, ...payload} = message
        window.__qaSnapshotBytes.push(new TextEncoder().encode(JSON.stringify(payload)).byteLength)
      }
      return originalSend(message, options)
    }
  })
  await Promise.all(pages.map(page => page.evaluate(() => { window.__qaFrames = [] })))
}

async function submitWave(host, wave, count) {
  return host.evaluate(({wave, count}) => {
    const manager = window.terminator.manager
    const gate = manager.world.map.spawnGates[0].id
    const spawns = [{t: 0, gate, unit: 'scout', count}]
    if (wave >= 3) spawns.push({t: 0, gate, unit: 'endo', count: 1})
    return manager.director.submitConfig({
      wave,
      spawns,
      knobs: {gates: [gate], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
    })
  }, {wave, count})
}

async function makePlayersDurable(host) {
  await host.evaluate(() => {
    const manager = window.terminator.manager
    for (const player of manager.world.players.values()) {
      player.hp = 1_000_000_000
      player.armor = 1_000_000_000
      player.alive = true
      player.downed = false
    }
    manager.party.sendSnapshot()
  })
}

async function trafficStart(host, guests) {
  const stats = await Promise.all([rtcState(host), ...guests.map(rtcState)])
  const [hostStart, guestStarts] = await Promise.all([
    host.evaluate(() => ({
      snapshots: window.terminator.manager.party.messageCounts.sent.snapshot || 0,
      sizeCount: window.__qaSnapshotBytes.length,
      at: Date.now(),
    })),
    Promise.all(guests.map(page => page.evaluate(() => ({
      inputs: window.terminator.manager.party.messageCounts.sent.input || 0,
      snapshots: window.terminator.manager.party.messageCounts.received.snapshot || 0,
      at: Date.now(),
    })))),
  ])
  return {hostStart, guestStarts, stats, wallStartedAt: Date.now()}
}

async function trafficFinish(host, guests, start, expectedSeconds, measuredEndedAt = Date.now()) {
  const wallSeconds = (measuredEndedAt - start.wallStartedAt) / 1000
  const [hostEnd, guestEnds, endStats] = await Promise.all([
    host.evaluate(() => ({
      snapshots: window.terminator.manager.party.messageCounts.sent.snapshot || 0,
      sizes: window.__qaSnapshotBytes.slice(),
    })),
    Promise.all(guests.map(page => page.evaluate(() => ({
      inputs: window.terminator.manager.party.messageCounts.sent.input || 0,
      snapshots: window.terminator.manager.party.messageCounts.received.snapshot || 0,
      connected: window.terminator.manager.party.connected,
    })))),
    Promise.all([rtcState(host), ...guests.map(rtcState)]),
  ])
  const hostSent = hostEnd.snapshots - start.hostStart.snapshots
  const guestMetrics = guestEnds.map((end, index) => {
    const received = end.snapshots - start.guestStarts[index].snapshots
    const inputs = end.inputs - start.guestStarts[index].inputs
    return {
      name: pageNames.get(guests[index]),
      snapshotsReceived: received,
      snapshotsSentByHost: hostSent,
      snapshotRateHz: round(received / wallSeconds),
      stateMessagesLost: Math.max(0, hostSent - received),
      inputRateHz: round(inputs / wallSeconds),
      connected: end.connected,
      rtc: diffRtc(start.stats[index + 1], endStats[index + 1], wallSeconds),
    }
  })
  return {
    expectedSeconds,
    wallSeconds: round(wallSeconds),
    snapshotSizeBytes: describe(hostEnd.sizes.slice(start.hostStart.sizeCount)),
    hostRtc: diffRtc(start.stats[0], endStats[0], wallSeconds),
    guests: guestMetrics,
  }
}

async function freezeHost(host) {
  await host.evaluate(() => { window.terminator.manager.started = false })
}

async function awardGuestKill(host, guest, playerId) {
  const targetId = await host.evaluate(playerId => {
    const manager = window.terminator.manager
    const player = manager.world.getPlayer(playerId)
    const target = manager.world.aliveUnits[0]
    if (!player || !target) throw new Error('missing player or target')
    player.fireCooldown = 1000
    player.reloadTimer = 0
    player.ammo[player.activeWeapon].mag = Math.max(1, player.ammo[player.activeWeapon].mag)
    target.hp = 1
    target.brain?.destroy?.()
    target.brain = {tick() {}}
    Object.assign(player.pos, {x: 0, y: 0, z: 9})
    Object.assign(target.pos, {x: 0, y: 0, z: 13})
    manager.party.sendSnapshot()
    return target.id
  }, playerId)
  await guest.waitForFunction(targetId => window.terminator.world.unitById.has(targetId), targetId)
  const tick = await guest.evaluate(() => {
    const manager = window.terminator.manager
    return manager.party.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0, fire: true, aim: true})
  })
  await host.waitForFunction(({playerId, tick}) => (window.terminator.manager.party.latestInputs.get(playerId)?.tick ?? -1) >= tick,
    {playerId, tick})
  await host.evaluate(({playerId, targetId}) => {
    const manager = window.terminator.manager
    const latest = manager.party.latestInputs.get(playerId)
    const player = manager.world.getPlayer(playerId)
    player.fireCooldown = 0
    player.reloadTimer = 0
    manager.party.pendingHits.set(playerId, new Map([[latest.tick, {
      unitId: targetId, part: 'body', weapon: player.activeWeapon,
    }]]))
    manager.party.processGuestShots()
    manager.party.sendSnapshot()
  }, {playerId, targetId})
  await host.waitForFunction(({playerId, targetId}) => window.terminator.world.eventLog.some(event =>
    event.type === 'kill' && event.playerId === playerId && event.unitId === targetId), {playerId, targetId})
}

async function awardHostKill(host) {
  const outcome = await host.evaluate(() => {
    const manager = window.terminator.manager
    const world = manager.world
    const player = world.getPlayer(world.hostPlayerId)
    const target = world.aliveUnits[0]
    if (!player || !target) throw new Error('missing host player or target')
    target.hp = 1
    target.brain?.destroy?.()
    target.brain = {tick() {}}
    Object.assign(player.pos, {x: 0, y: 0, z: 9})
    Object.assign(player.vel, {x: 0, y: 0, z: 0})
    Object.assign(target.pos, {x: 0, y: 0, z: 9.8})
    const inputs = {
      move: {x: 0, z: 0},
      yaw: 0,
      pitch: 0,
      melee: true,
    }
    const killsBefore = world.eventLog.filter(event => event.type === 'kill' && event.playerId === player.id).length
    for (let attempt = 0; attempt < 5 && target.alive; attempt += 1) {
      player.meleeCooldown = 0
      manager.party.step(inputs)
    }
    manager.party.sendSnapshot()
    const killsAfter = world.eventLog.filter(event => event.type === 'kill' && event.playerId === player.id).length
    return {targetAlive: target.alive, earnedKills: killsAfter - killsBefore}
  })
  assert.equal(outcome.targetAlive, false)
  assert.ok(outcome.earnedKills >= 1)
}

async function buyAtTrader(host, guests) {
  await host.evaluate(() => {
    const manager = window.terminator.manager
    for (const player of manager.world.players.values()) {
      player.scrap = 10_000
      const ammo = player.ammo[player.activeWeapon]
      ammo.mag = 1
      ammo.reserve = 0
    }
    manager.party.sendSnapshot()
  })
  await delay(250)
  const hostPurchase = await host.evaluate(async () => {
    const manager = window.terminator.manager
    manager.ui.screens.show('trader')
    const result = await manager.ui.purchase('fill-ammo')
    manager.ui.screens.show(null)
    return result
  })
  const guestPurchases = await Promise.all(guests.map(page => page.evaluate(async () => {
    const manager = window.terminator.manager
    manager.ui.screens.show('trader')
    const result = await manager.ui.purchase('fill-ammo')
    manager.ui.screens.show(null)
    return result
  })))
  return [
    {playerId: 'player', result: hostPurchase},
    {playerId: 'guest-1', result: guestPurchases[0]},
    {playerId: 'guest-2', result: guestPurchases[1]},
  ]
}

async function injectEnemyLoad(host, guests, enemyCount) {
  await host.evaluate(enemyCount => {
    const manager = window.terminator.manager
    const world = manager.world
    for (const unit of world.units) unit.brain?.destroy?.()
    world.units.length = 0
    world.unitById.clear()
    world.scaling.maxAlive = 36
    const gate = world.map.spawnGates[0].id
    manager.director.spawnSchedule = Array.from({length: enemyCount}, (_, index) => ({
      t: 0, gate, unit: 'scout', index,
    }))
    manager.director.nextSpawn = 0
    manager.director.spawnDueUnits()
    for (const player of world.players.values()) {
      player.hp = 1_000_000_000
      player.armor = 1_000_000_000
      player.alive = true
      player.downed = false
    }
    manager.party.sendSnapshot()
  }, enemyCount)
  await Promise.all(guests.map(page => page.waitForFunction(count => window.terminator.world.aliveUnits.length === count,
    enemyCount, {timeout: 15_000})))
}

async function measureLoad(host, guests, enemyCount, seconds) {
  await Promise.all(pages.map(page => page.evaluate(() => { window.__qaFrames.length = 0 })))
  await installMovement(host, guests)
  const traffic = await trafficStart(host, guests)
  await startClocks(host, guests)
  const desyncSamples = []
  for (let second = 1; second <= seconds; second += 1) {
    await delay(1000)
    desyncSamples.push(await sampleDesync(host, guests, second))
  }
  await stopClocks(host, guests)
  const measuredEndedAt = Date.now()
  await delay(150)
  const measured = await trafficFinish(host, guests, traffic, seconds, measuredEndedAt)
  await restoreMovement(host, guests)
  const frames = await Promise.all(pages.map(page => page.evaluate(() => window.__qaFrames.slice())))
  const observedEnemies = {
    host: await host.evaluate(() => window.terminator.world.aliveUnits.length),
    guests: await Promise.all(guests.map(page => page.evaluate(() => window.terminator.world.aliveUnits.length))),
  }
  const guestErrors = guests.map((page, index) => Math.max(...desyncSamples.map(sample => sample.guests[index].errorMeters), 0))
  return {
    enemies: enemyCount,
    seconds,
    machineLoad: await machineLoad(),
    observedEnemies,
    hostCpuFrameP99Ms: round(percentile(frames[0], 0.99)),
    guestCpuFrameP99Ms: guests.map((page, index) => ({name: pageNames.get(page), value: round(percentile(frames[index + 1], 0.99))})),
    snapshotSizeBytes: measured.snapshotSizeBytes,
    hostRtc: measured.hostRtc,
    guests: measured.guests.map((guest, index) => ({...guest, maxPositionErrorMeters: round(guestErrors[index])})),
    desyncSamples,
  }
}

async function installMovement(host, guests, {moving = true} = {}) {
  await host.evaluate(() => {
    const manager = window.terminator.manager
    clearInterval(window.__qaGameClock)
    manager.started = false
    manager.ctx.viewer.renderEnabled = false
    window.__qaOriginalSample ||= manager.ui.sample.bind(manager.ui)
    manager.ui.sample = () => ({move: {x: 0, z: 0}, yaw: 0, pitch: 0})
  })
  await Promise.all(guests.map((page, index) => page.evaluate(({index, moving}) => {
    const manager = window.terminator.manager
    clearInterval(window.__qaGameClock)
    manager.started = false
    manager.ctx.viewer.renderEnabled = false
    window.__qaOriginalSample ||= manager.ui.sample.bind(manager.ui)
    const directions = [{x: 0.35, z: 0.5}, {x: -0.3, z: 0.45}]
    manager.ui.sample = () => ({move: moving ? directions[index] : {x: 0, z: 0}, yaw: 0, pitch: 0, sprint: false})
  }, {index, moving})))
}

async function startClocks(host, guests) {
  await Promise.all([host, ...guests].map(page => page.evaluate(() => {
    const manager = window.terminator.manager
    clearTimeout(window.__qaGameClock)
    window.__qaClockRunning = true
    let nextTick = performance.now()
    const pump = () => {
      if (!window.__qaClockRunning) return
      const now = performance.now()
      let catchup = 0
      while (now + 0.1 >= nextTick && catchup < 8) {
        const started = performance.now()
        manager.party.step(manager.ui.sample())
        window.__qaFrames.push(performance.now() - started)
        nextTick += 1000 / 60
        catchup += 1
      }
      if (catchup === 8 && nextTick < now - 1000 / 60) nextTick = now
      window.__qaGameClock = setTimeout(pump, 4)
    }
    pump()
  })))
}

async function stopClocks(host, guests) {
  await Promise.all([host, ...guests].map(page => page.evaluate(() => {
    window.__qaClockRunning = false
    clearTimeout(window.__qaGameClock)
    window.__qaGameClock = null
  })))
}

async function restoreMovement(host, guests) {
  await Promise.all([host, ...guests].map(page => page.evaluate(() => {
    window.__qaClockRunning = false
    clearTimeout(window.__qaGameClock)
    window.__qaGameClock = null
    if (window.__qaOriginalSample) window.terminator.manager.ui.sample = window.__qaOriginalSample
  })))
}

async function sampleDesync(host, guests, second) {
  const authoritative = await host.evaluate(() => Object.fromEntries([...window.terminator.world.players].map(([id, player]) => [id, {...player.pos}])))
  const targets = ['guest-2', 'guest-1']
  const observed = await Promise.all(guests.map((page, index) => page.evaluate(target => {
    const player = window.terminator.world.getPlayer(target)
    return player ? {...player.pos} : null
  }, targets[index])))
  return {
    second,
    guests: observed.map((position, index) => ({
      name: pageNames.get(guests[index]),
      targetPlayerId: targets[index],
      errorMeters: round(positionDistance(authoritative[targets[index]], position)),
    })),
  }
}

async function resetPlayerPositions(host, guests) {
  await host.evaluate(() => {
    const manager = window.terminator.manager
    const positions = {player: {x: 0, y: 0, z: 9}, 'guest-1': {x: -2, y: 0, z: 9}, 'guest-2': {x: 2, y: 0, z: 9}}
    for (const [id, position] of Object.entries(positions)) {
      const player = manager.world.getPlayer(id)
      Object.assign(player.pos, position)
      Object.assign(player.vel, {x: 0, y: 0, z: 0})
    }
    manager.party.sendSnapshot()
  })
  await delay(150)
  await Promise.all(guests.map(page => page.evaluate(() => window.terminator.manager.syncViews())))
}

async function signalingRoomChurn(roomsRequested) {
  const startedAt = Date.now()
  const errors = []
  const runs = await Promise.all(Array.from({length: roomsRequested}, async (_, index) => {
    const run = {index, peers: []}
    const sockets = []
    try {
      const createStarted = performance.now()
      const response = await fetch(`${SIGNAL_ORIGIN}/rooms`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({capacity: 3}),
      })
      run.roomCreateMs = round(performance.now() - createStarted)
      if (!response.ok) throw new Error(`room POST returned ${response.status}`)
      const room = await response.json()
      const host = await fakePeer(room.code, 'host', `load-host-${index}`)
      sockets.push(host.socket)
      run.peers.push(host.metric)
      const guests = await Promise.all([
        fakePeer(room.code, 'guest', `load-a-${index}`),
        fakePeer(room.code, 'guest', `load-b-${index}`),
      ])
      for (const guest of guests) { sockets.push(guest.socket); run.peers.push(guest.metric) }
      host.socket.send(JSON.stringify({type: 'leave'}))
      await delay(10)
      return run
    } catch (error) {
      errors.push({index, message: error.message})
      return run
    } finally {
      for (const socket of sockets) if (socket.readyState < WebSocket.CLOSING) socket.close()
    }
  }))
  const welcomeLatencies = runs.flatMap(run => run.peers.map(peer => peer.welcomeMs))
  const createLatencies = runs.map(run => run.roomCreateMs).filter(Number.isFinite)
  return {
    roomsRequested,
    roomsCompleted: runs.filter(run => run.peers.length === 3).length,
    fakePeersAttempted: roomsRequested * 3,
    wallMs: Date.now() - startedAt,
    roomCreateLatencyMs: describe(createLatencies),
    signalingWelcomeLatencyMs: describe(welcomeLatencies),
    errors,
    runs,
  }
}

function fakePeer(code, role, name) {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const socket = new WebSocket(`${SIGNAL_ORIGIN.replace('https:', 'wss:')}/rooms/${code}/ws`)
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error(`${role} welcome timeout`)) }, 15_000)
    socket.once('open', () => socket.send(JSON.stringify({type: 'hello', role, name})))
    socket.on('message', data => {
      const message = JSON.parse(data.toString())
      if (message.type === 'welcome') {
        clearTimeout(timeout)
        resolve({socket, metric: {role, welcomeMs: round(performance.now() - started), peerId: message.peerId}})
      } else if (message.type === 'error') {
        clearTimeout(timeout)
        reject(new Error(`${message.code}: ${message.message || ''}`))
      }
    })
    socket.once('error', error => { clearTimeout(timeout); reject(error) })
  })
}

async function churnGuestTwice(host, guest) {
  const runs = []
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    const before = await guest.evaluate(() => {
      const party = window.terminator.manager.party
      window.__qaOldSignaling = party.signaling
      return {playerId: party.playerId, resumeToken: party.resumeToken, startedAt: Date.now()}
    })
    await guest.evaluate(() => window.terminator.manager.party.signaling.socket.close())
    await guest.waitForFunction(() => {
      const party = window.terminator.manager.party
      return party.connected && party.signaling && party.signaling !== window.__qaOldSignaling
    }, null, {timeout: 15_000})
    await host.waitForFunction(id => window.terminator.manager.party.players.get(id)?.connected === true,
      before.playerId, {timeout: 15_000})
    const after = await guest.evaluate(() => {
      const party = window.terminator.manager.party
      return {playerId: party.playerId, resumeToken: party.resumeToken, endedAt: Date.now()}
    })
    runs.push({
      cycle,
      elapsedMs: after.endedAt - before.startedAt,
      samePlayerId: before.playerId === after.playerId,
      sameResumeToken: before.resumeToken === after.resumeToken,
      playerId: after.playerId,
    })
  }
  return runs
}

async function setGuestImpairment(page, {latencyMs, lossPercent}) {
  await page.evaluate(({latencyMs, lossPercent}) => {
    const party = window.terminator.manager.party
    if (!window.__qaReceivePeerOriginal) window.__qaReceivePeerOriginal = party.receivePeer.bind(party)
    const original = window.__qaReceivePeerOriginal
    const lossEvery = lossPercent > 0 ? Math.round(100 / lossPercent) : 0
    window.__qaImpairment = {latencyMs, lossPercent, seen: 0, dropped: 0}
    party.receivePeer = detail => {
      if (detail?.channel !== 'state') return original(detail)
      window.__qaImpairment.seen += 1
      if (lossEvery && window.__qaImpairment.seen % lossEvery === 0) {
        window.__qaImpairment.dropped += 1
        return
      }
      setTimeout(() => original(detail), latencyMs)
    }
  }, {latencyMs, lossPercent})
}

async function clearGuestImpairment(page) {
  await page.evaluate(() => {
    const party = window.terminator.manager.party
    if (window.__qaReceivePeerOriginal) party.receivePeer = window.__qaReceivePeerOriginal
  })
  await delay(300)
}

async function fightWaveToClear(host, guests) {
  await freezeHost(host)
  await awardHostKill(host)
  let index = 0
  while (await host.evaluate(() => window.terminator.world.aliveUnits.length > 0)) {
    const [page, playerId] = guests[index % guests.length]
    await awardGuestKill(host, page, playerId)
    index += 1
  }
  await host.evaluate(() => {
    const manager = window.terminator.manager
    manager.party.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0})
    manager.party.sendSnapshot({reliable: true})
  })
}

async function wipeParty(host) {
  await host.evaluate(() => {
    const manager = window.terminator.manager
    manager.started = false
    for (const player of manager.world.players.values()) {
      player.armor = 0
      manager.world.damagePlayer(1_000_000, {type: 'qa-wipe'}, player.id)
    }
    manager.party.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0})
    manager.party.sendSnapshot({reliable: true})
    manager.syncViews()
  })
}

async function capture(page, filename) {
  await page.evaluate(() => {
    const manager = window.terminator.manager
    manager.ctx.viewer.renderEnabled = true
    manager.syncViews()
    manager.ctx.viewer.setDirty(manager)
  })
  await page.waitForTimeout(250)
  await page.screenshot({path: new URL(filename, EVIDENCE).pathname})
}

async function rtcState(page) {
  return page.evaluate(async () => {
    const party = window.terminator?.manager?.party
    const activePeers = []
    for (const [peerId, peer] of party?.transport?.peers || []) {
      const reportSet = await Promise.race([
        peer.connection.getStats(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getStats timeout')), 5000)),
      ])
      const reports = [...reportSet.values()]
      const transport = reports.find(report => report.type === 'transport')
      const selected = reports.find(report => report.id === transport?.selectedCandidatePairId)
        || reports.find(report => report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded')
      const local = reports.find(report => report.id === selected?.localCandidateId)
      const remote = reports.find(report => report.id === selected?.remoteCandidateId)
      const dataChannels = reports.filter(report => report.type === 'data-channel').map(report => ({
        label: report.label,
        messagesSent: report.messagesSent || 0,
        messagesReceived: report.messagesReceived || 0,
        bytesSent: report.bytesSent || 0,
        bytesReceived: report.bytesReceived || 0,
      }))
      activePeers.push({
        peerId,
        connectionState: peer.connection.connectionState,
        selectedPair: selected ? {
          bytesSent: selected.bytesSent || 0,
          bytesReceived: selected.bytesReceived || 0,
          currentRoundTripTimeMs: selected.currentRoundTripTime == null ? null : selected.currentRoundTripTime * 1000,
          availableOutgoingBitrate: selected.availableOutgoingBitrate ?? null,
          packetsDiscardedOnSend: selected.packetsDiscardedOnSend ?? null,
          localCandidateType: local?.candidateType || null,
          remoteCandidateType: remote?.candidateType || null,
          protocol: local?.protocol || null,
        } : null,
        dataChannels,
      })
    }
    const gatheredCandidateTypes = [...new Set((window.__lobbyQaRtc?.records || [])
      .flatMap(record => record.candidates.map(candidate => candidate.type)))].sort()
    return {activePeers, gatheredCandidateTypes}
  })
}

function diffRtc(before, after, seconds) {
  const beforeByPeer = new Map(before.activePeers.map(peer => [peer.peerId, peer]))
  return after.activePeers.map(peer => {
    const old = beforeByPeer.get(peer.peerId)
    const beforeChannels = new Map((old?.dataChannels || []).map(channel => [channel.label, channel]))
    const dataBytesSent = peer.dataChannels.reduce((sum, channel) => sum + channel.bytesSent, 0)
    const dataBytesReceived = peer.dataChannels.reduce((sum, channel) => sum + channel.bytesReceived, 0)
    const oldDataBytesSent = (old?.dataChannels || []).reduce((sum, channel) => sum + channel.bytesSent, 0)
    const oldDataBytesReceived = (old?.dataChannels || []).reduce((sum, channel) => sum + channel.bytesReceived, 0)
    const state = peer.dataChannels.find(channel => channel.label === 'state')
    const oldState = beforeChannels.get('state')
    return {
      peerId: peer.peerId,
      connectionState: peer.connectionState,
      bytesSentPerSecond: round((dataBytesSent - oldDataBytesSent) / seconds),
      bytesReceivedPerSecond: round((dataBytesReceived - oldDataBytesReceived) / seconds),
      stateMessagesSent: (state?.messagesSent || 0) - (oldState?.messagesSent || 0),
      stateMessagesReceived: (state?.messagesReceived || 0) - (oldState?.messagesReceived || 0),
      roundTripTimeMs: peer.selectedPair?.currentRoundTripTimeMs == null ? null : round(peer.selectedPair.currentRoundTripTimeMs),
      selectedLocalCandidateType: peer.selectedPair?.localCandidateType || null,
      selectedRemoteCandidateType: peer.selectedPair?.remoteCandidateType || null,
      gatheredCandidateTypes: after.gatheredCandidateTypes,
      sctpPacketsLost: null,
      packetsDiscardedOnSend: peer.selectedPair?.packetsDiscardedOnSend ?? null,
    }
  })
}

async function waitForRoster(targetPages, names) {
  await Promise.all(targetPages.map(page => page.waitForFunction(names => {
    const players = window.terminator?.manager?.partyState?.players || []
    return players.length === names.length && players.map(player => player.name).join('|') === names.join('|')
  }, names, {timeout: 30_000})))
}

async function waitForPhase(targetPages, phase, wave) {
  await Promise.all(targetPages.map(page => page.waitForFunction(({phase, wave}) => {
    const world = window.terminator?.world
    return world?.phase === phase && world?.wave === wave
  }, {phase, wave}, {timeout: 30_000})))
}

async function machineLoad() {
  const {stdout} = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,%cpu=,%mem=,comm=,args='])
  const rows = stdout.trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.*)$/)
    return match && {pid: Number(match[1]), ppid: Number(match[2]), cpu: Number(match[3]), memory: Number(match[4]), command: match[5], args: redact(match[6])}
  }).filter(Boolean)
  const own = new Set([process.pid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) if (own.has(row.ppid) && !own.has(row.pid)) { own.add(row.pid); changed = true }
  }
  const heavy = rows.filter(row => row.cpu >= 20 && !own.has(row.pid)).sort((a, b) => b.cpu - a.cpu)
  return {sampledAt: new Date().toISOString(), otherHeavyProcessCount: heavy.length, thresholdCpuPercent: 20, processes: heavy.slice(0, 12)}
}

async function startDevServer() {
  const devFile = new URL('../../.kite3d/dev.json', import.meta.url)
  devProcess = spawn('npx', ['kite3d', 'dev', '--port', String(PORT), '--no-open'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  for (const stream of [devProcess.stdout, devProcess.stderr]) stream.on('data', chunk => { diagnostics = `${diagnostics}${chunk}`.slice(-8000) })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (devProcess.exitCode !== null) throw new Error(`kite3d dev exited ${devProcess.exitCode}: ${redact(diagnostics)}`)
    try {
      const dev = JSON.parse(await readFile(devFile, 'utf8'))
      if (dev.origin === `http://127.0.0.1:${PORT}` && (await fetch(dev.url)).ok) {
        const endpoint = new URL('/api/import-map', dev.url)
        endpoint.searchParams.set('t', new URL(dev.url).searchParams.get('t'))
        return {...dev, importMap: await (await fetch(endpoint)).json()}
      }
    } catch {}
    await delay(150)
  }
  throw new Error(`kite3d dev did not start on port ${PORT}: ${redact(diagnostics)}`)
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
  return {origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve))}
}

function watchPage(name, page) {
  page.on('pageerror', error => consoleIssues.push({page: name, level: 'pageerror', message: redact(error.stack || error.message)}))
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleIssues.push({page: name, level: message.type(), message: redact(message.text()), source: redact(message.location().url || '')})
    }
  })
}

function mark(event, details = {}) {
  timeline.push({event, at: new Date().toISOString(), ...details})
  console.log(`[lobby-load] ${event}`)
}

async function writeRaw() {
  await mkdir(EVIDENCE, {recursive: true})
  await writeFile(RAW, `${JSON.stringify(result, null, 2)}\n`)
}

function describe(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!clean.length) return {count: 0, min: null, median: null, p95: null, p99: null, max: null, mean: null}
  return {
    count: clean.length,
    min: round(clean[0]),
    median: round(percentile(clean, 0.5)),
    p95: round(percentile(clean, 0.95)),
    p99: round(percentile(clean, 0.99)),
    max: round(clean.at(-1)),
    mean: round(clean.reduce((sum, value) => sum + value, 0) / clean.length),
  }
}

function percentile(values, quantile) {
  if (!values.length) return NaN
  const sorted = values.slice().sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))
  return sorted[index]
}

function positionDistance(a, b) {
  if (!a || !b) return Infinity
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function round(value) { return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function redact(value) { return String(value).replace(/([?&]t=)[A-Za-z0-9._~-]+/g, '$1[redacted]') }
