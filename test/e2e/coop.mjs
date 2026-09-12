#!/usr/bin/env node
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {startSignalStub} from '../net/signal-stub.mjs'

const GAME_PORT = 4730
const EVIDENCE = 'docs/evidence/coop-e2e'
const steps = []
const issues = []
const ownedProcesses = []
let signalStub

await mkdir(EVIDENCE, {recursive: true})
signalStub = await startSignalStub()
await ensureServers()
const dev = JSON.parse(await readFile('.kite3d/dev.json', 'utf8'))
assert.equal(new URL(dev.url).port, String(GAME_PORT), `Kite3D dev must use port ${GAME_PORT}`)
const gameUrl = new URL(dev.url)
gameUrl.searchParams.set('signal', signalStub.origin)

const launchOptions = {headless: true, args: [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]}
const hostBrowser = await chromium.launch(launchOptions)
const guestBrowser = await chromium.launch(launchOptions)
const contextOptions = {viewport: {width: 1280, height: 720}, deviceScaleFactor: 1}
const hostContext = await hostBrowser.newContext(contextOptions)
const guestContext = await guestBrowser.newContext(contextOptions)
const host = await hostContext.newPage()
const guest = await guestContext.newPage()

watchPage('host', host)
watchPage('guest', guest)

try {
  await bootEditor(host, gameUrl.href)
  pass('Host clicked the real Kite3D Play control and reached the game main menu')

  await host.getByTestId('host-party').click()
  await host.locator('[data-party-field="name"]').fill('John')
  await host.getByTestId('create-party').evaluate(button => button.click())
  await host.waitForFunction(() => window.terminator?.manager?.partyState?.status === 'lobby')
  await host.waitForFunction(() => Boolean(document.querySelector('[data-party="invite"]')?.value))
  const invite = await host.locator('[data-party="invite"]').inputValue()
  const partyCode = await host.evaluate(() => window.terminator.manager.partyState.code)
  assert.match(partyCode, /^[A-Z0-9]{6}$/)
  assert.equal(await host.locator('[aria-label^="RELAY"]').count(), 0)
  assert.equal(await host.evaluate(() => document.pointerLockElement), null)
  assert.equal(await host.evaluate(() => window.terminator.manager.input.active), false)
  pass('Host entered a name, created a six-character party, and the party screen released input and pointer lock')

  await host.getByTestId('copy-party-invite').click()
  assert.equal(await host.locator('[data-party="invite"]').inputValue(), invite)
  pass('Host used Copy Invite and retained the exact generated invite link')

  const authenticatedInvite = new URL(invite)
  authenticatedInvite.searchParams.set('t', new URL(dev.url).searchParams.get('t'))
  await guest.goto(authenticatedInvite.href, {waitUntil: 'domcontentloaded'})
  await guest.getByTestId('play').click()
  await guest.waitForFunction(() => window.terminator?.manager?.ui?.screens?.route === 'party-join', null, {timeout: 120_000})
  await guest.locator('[data-party-field="name"]').fill('Sarah')
  await guest.getByTestId('join-party-submit').click()
  await waitForRoster([host, guest], ['John', 'Sarah'])
  pass('Guest opened the copied invite, clicked Play, joined through the real form, and both browsers saw the same roster')

  await ready(host)
  await ready(guest)
  await host.waitForFunction(() => window.terminator.manager.partyState.players.every(player => player.ready))
  assert.equal(await guest.evaluate(() => window.terminator.manager.partyState.players.every(player => player.ready)), true)
  pass('Both players used the Ready UI and both browsers showed every ready mark')

  await Promise.all([host, guest].map(configureHeadlessWarmup))
  await host.evaluate(() => {
    for (const player of window.terminator.manager.world.players.values()) {
      player.hp = 10_000
      player.armor = 10_000
    }
  })
  await host.getByTestId('party-start').evaluate(button => button.click())
  await waitForPhase([host, guest], 'wave', 1)
  await assertPlayingState(host, 'host')
  await assertPlayingState(guest, 'guest')
  let setupHealth = 0
  for (let attempt = 0; attempt < 20 && setupHealth <= 100_000; attempt += 1) {
    await host.evaluate(() => {
      const manager = window.terminator.manager
      for (const player of manager.world.players.values()) {
        player.hp = 1_000_000_000
        player.armor = 1_000_000_000
      }
      manager.party.sendSnapshot()
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    setupHealth = await guest.evaluate(() => window.terminator.world.getPlayer('guest-1')?.hp || 0)
  }
  assert.ok(setupHealth > 100_000, `Guest did not receive the setup health snapshot: ${setupHealth}`)
  await Promise.all([setManualClock(host, true), setManualClock(guest, true)])
  // Preserve the long network setup under slow headless rendering. Reset before damage and spectate assertions.
  await setAuthoritativeHealth(host, guest, 5_000)
  pass('Host used Start and both browsers entered wave one with combat HUD, two players, and active local input')

  await verifyPauseReleasesPointerLock(host)
  pass('Opening a screen during play stopped look input, released pointer lock, and Resume restored play input')

  await moveAndAssertReplication(host, guest, 'player')
  await moveAndAssertReplication(guest, host, 'guest-1')
  await Promise.all([startCombatGuard(host), startCombatGuard(guest)])
  pass('Keyboard movement changed both local players and each remote browser received the other position change')

  const reconnect = await guest.evaluate(() => {
    const party = window.terminator.manager.party
    window.__coopOldSignaling = party.signaling
    return {playerId: party.playerId, resumeToken: party.resumeToken}
  })
  await guest.evaluate(() => window.terminator.manager.party.signaling.socket.close())
  await guest.waitForFunction(() => {
    const party = window.terminator.manager.party
    return party.connected && party.signaling && party.signaling !== window.__coopOldSignaling
  }, null, {timeout: 12_000})
  await host.waitForFunction(id => window.terminator.manager.party.players.get(id)?.connected === true, reconnect.playerId)
  assert.equal(await guest.evaluate(() => window.terminator.manager.party.playerId), reconnect.playerId)
  assert.equal(await guest.evaluate(() => window.terminator.manager.party.resumeToken), reconnect.resumeToken)
  assert.deepEqual(await roster(host), ['John', 'Sarah'])
  await Promise.all([stopCombatGuard(host), stopCombatGuard(guest)])
  pass('The guest dropped and automatically reconnected from the same invite with the same player id, token, and roster slot')

  await host.evaluate(() => {
    const manager = window.terminator.manager
    for (const player of manager.world.players.values()) {
      const weapon = manager.world.weaponCatalog.weapons[player.activeWeapon]
      player.hp = 1_000_000_000
      player.armor = 1_000_000_000
      player.alive = true
      player.downed = false
      player.fireCooldown = 0
      player.reloadTimer = 0
      player.ammo[player.activeWeapon].mag = weapon.mag
      player.ammo[player.activeWeapon].reserve = weapon.reserveMax
    }
    manager.party.sendSnapshot()
  })
  await guest.waitForFunction(() => {
    const manager = window.terminator.manager
    const player = manager.world.getPlayer(manager.localPlayerId)
    return player?.hp > 100_000 && player?.armor > 100_000 && player?.ammo?.[player.activeWeapon]?.mag > 0
  })

  await shootUntilKill(guest, 'guest-1', 55_000, host)
  await shootUntilKill(host, 'player', 55_000, guest)
  let spectatePair = await thinWaveToOne(guest, host, 60_000)
  if (!spectatePair) {
    await syncPlayerVitals(host, guest, {hp: 100, armor: 0})
    await damageOrDownHost(host, guest, 30_000)
  }
  await syncAndFreezeCombat(host, guest)
  await assertSharedCombatState(host, guest)
  await Promise.all([setManualClock(host, true), setManualClock(guest, true)])
  pass('Host and guest fired through the public input state, each killed an enemy, and both HUDs reflected authoritative health and wave state')

  await Promise.all([stopCombat(host), stopCombat(guest)])
  if (!spectatePair) {
    await surviveApartAndDownHost(host, guest)
    spectatePair = {downedId: 'player', survivorId: 'guest-1'}
  }
  await syncAndFreezeCombat(host, guest)
  const pageByPlayer = {'player': host, 'guest-1': guest}
  const downedPage = pageByPlayer[spectatePair.downedId]
  const survivorPage = pageByPlayer[spectatePair.survivorId]
  const observerPage = survivorPage === host ? guest : host
  assert.equal(await host.evaluate(id => window.terminator.world.getPlayer(id).alive, spectatePair.downedId), false)
  assert.equal(await guest.evaluate(id => window.terminator.world.getPlayer(id).alive, spectatePair.survivorId), true)
  assert.equal(await downedPage.evaluate(() => window.terminator.manager.ui.spectate.active), true)
  assert.equal(await downedPage.evaluate(() => !window.terminator.manager.hud.elements.spectate.hidden), true)
  pass('One player died, stayed in the match, and spectated the living teammate on both authoritative and HUD state')

  await Promise.all([setManualClock(host, true), setManualClock(guest, true)])
  await clearWaveWithPlayer(survivorPage, 90_000)
  await waitForPhase([host, guest], 'intermission', 1)
  assert.equal(await host.evaluate(id => window.terminator.world.getPlayer(id).alive, spectatePair.downedId), false)
  pass('The living player cleared wave one while the teammate remained down and both browsers entered the same intermission')

  const scrapBefore = await survivorPage.evaluate(id => window.terminator.world.getPlayer(id).scrap, spectatePair.survivorId)
  await survivorPage.locator('[data-action="trader"]').click()
  await survivorPage.waitForFunction(() => window.terminator.manager.ui.screens.route === 'trader')
  const purchase = survivorPage.locator('[data-action="purchase:fill-ammo"]')
  await purchase.click()
  await survivorPage.waitForFunction(({id, before}) => window.terminator.world.getPlayer(id).scrap < before,
    {id: spectatePair.survivorId, before: scrapBefore})
  const scrapAfter = await survivorPage.evaluate(id => window.terminator.world.getPlayer(id).scrap, spectatePair.survivorId)
  await observerPage.waitForFunction(({id, value}) => window.terminator.world.getPlayer(id).scrap === value,
    {id: spectatePair.survivorId, value: scrapAfter})
  await survivorPage.getByTestId('back').click()
  pass('The living player bought ammunition through the Trader UI and the purchase and scrap total matched on both browsers')

  await survivorPage.locator('[data-action="ready"]').click()
  await waitForPhase([host, guest], 'wave', 2)
  assert.equal(await host.evaluate(id => window.terminator.world.getPlayer(id).alive, spectatePair.downedId), true)
  assert.equal(await host.evaluate(id => window.terminator.world.getPlayer(id).hp, spectatePair.downedId), 100)
  assert.equal(await guest.evaluate(id => window.terminator.world.getPlayer(id).alive, spectatePair.downedId), true)
  pass('Starting wave two respawned the downed player at full health on both browsers')

  await downBothPlayers(host, guest, 100_000)
  await waitForPhase([host, guest], 'ended', 2)
  await Promise.all([
    host.getByTestId('coop-scoreboard').waitFor(),
    guest.getByTestId('coop-scoreboard').waitFor(),
  ])
  assert.equal(await host.getByTestId('coop-scoreboard').locator('tbody tr').count(), 2)
  assert.equal(await guest.getByTestId('coop-scoreboard').locator('tbody tr').count(), 2)
  pass('Both players died in wave two and both browsers showed the same two-player scoreboard instead of leaving the party')

  await host.getByTestId('return-party').evaluate(button => button.click())
  await Promise.all([
    host.waitForFunction(() => window.terminator.manager.partyState?.status === 'lobby' && window.terminator.world.phase === 'lobby'),
    guest.waitForFunction(() => window.terminator.manager.partyState?.status === 'lobby' && window.terminator.world.phase === 'lobby'),
  ])
  assert.equal(await host.evaluate(() => window.terminator.manager.partyState.code), partyCode)
  assert.equal(await guest.evaluate(() => window.terminator.manager.partyState.code), partyCode)
  assert.deepEqual(await roster(host), ['John', 'Sarah'])
  assert.deepEqual(await roster(guest), ['John', 'Sarah'])
  assert.equal(await host.evaluate(() => window.terminator.manager.partyState.players.some(player => player.ready)), false)
  assert.equal(await guest.evaluate(() => window.terminator.manager.partyState.players.some(player => player.ready)), false)
  assert.equal(await host.getByTestId('party-start').isDisabled(), true)
  pass('Return to Party kept the code and roster and reset every ready mark')

  await ready(host)
  await ready(guest)
  await host.getByTestId('party-start').evaluate(button => button.click())
  await waitForPhase([host, guest], 'wave', 1)
  assert.equal(await host.evaluate(() => window.terminator.manager.partyState.code), partyCode)
  assert.equal(await guest.evaluate(() => window.terminator.manager.partyState.code), partyCode)
  pass('The same host started a second match with the same guest and party code, without creating or opening another invite')

  const fatalIssues = issues.filter(issue => issue.level === 'pageerror' || issue.level === 'error')
  assert.deepEqual(fatalIssues, [], `Browser errors: ${JSON.stringify(fatalIssues)}`)
  pass('No uncaught page errors or console errors occurred in either active browser')

  const result = {
    mode: 'two isolated headless Chromium processes over WebRTC through the local signaling stub',
    gamePort: GAME_PORT,
    signalOrigin: signalStub.origin,
    partyCode,
    steps,
    issues,
  }
  await writeFile(`${EVIDENCE}/results.json`, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ok: true, assertions: steps.length, transport: 'WebRTC'}, null, 2))
} finally {
  await Promise.allSettled([hostContext.close(), guestContext.close()])
  await Promise.allSettled([hostBrowser.close(), guestBrowser.close()])
  for (const child of ownedProcesses) child.kill('SIGTERM')
  await signalStub?.close()
}

function pass(message) {
  steps.push({step: steps.length + 1, status: 'pass', message})
  console.log(`PASS ${steps.length}: ${message}`)
}

function watchPage(role, page) {
  page.on('pageerror', error => issues.push({role, level: 'pageerror', text: sanitize(error.message)}))
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      const source = sanitize(message.location().url || '')
      if (/\/files\/\.kite3d\/(state\.json|console\.log)$/.test(source) && /412/.test(message.text())) return
      issues.push({
        role,
        level: message.type(),
        text: sanitize(message.text()),
        source,
      })
    }
  })
  page.on('response', response => {
    const url = sanitize(response.url())
    if (response.status() === 412 && /\/files\/\.kite3d\/(state\.json|console\.log)$/.test(url)) return
    if (response.status() >= 400) issues.push({
      role,
      level: 'http',
      status: response.status(),
      url,
    })
  })
}

async function bootEditor(page, url) {
  await page.goto(url, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').click()
  await page.waitForFunction(() => window.terminator?.manager?.ui?.screens?.route === 'main', null, {timeout: 120_000})
  await page.evaluate(() => {
    const ui = window.terminator.manager.ui
    ui.screens.settings.quality = 'low'
    ui.applySettings(ui.screens.settings)
  })
}

async function configureHeadlessWarmup(page) {
  await page.evaluate(() => {
    const manager = window.terminator.manager
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

async function setManualClock(page, active) {
  await page.evaluate(enabled => {
    clearInterval(window.__coopGameClock)
    window.__coopGameClock = null
    const manager = window.terminator?.manager
    if (!manager) return
    manager.ctx.viewer.renderEnabled = false
    manager.started = false
    if (enabled) {
      let frame = 0
      window.__coopGameClock = setInterval(() => {
        if (!manager.ui?.frozen && !manager.cameraFeel?.hitStopped) {
          manager.party.step(manager.ui.sample())
          manager.cameraFeel?.consume(manager.world)
        }
        if (++frame % 3 === 0) manager.syncViews()
      }, 1000 / 60)
    }
  }, active)
}

async function setAuthoritativeHealth(hostPage, guestPage, hp) {
  const expected = await hostPage.evaluate(value => {
    const manager = window.terminator.manager
    for (const player of manager.world.players.values()) {
      if (player.alive) player.hp = value
    }
    manager.party.sendSnapshot()
    return [...manager.world.players.values()].filter(player => player.alive).map(player => player.id)
  }, hp)
  await guestPage.waitForFunction(({expected, hp}) => expected.every(id => window.terminator.world.getPlayer(id)?.hp === hp),
    {expected, hp}, {timeout: 10_000})
}

async function ready(page) {
  await page.getByTestId('party-ready').click()
  await page.waitForTimeout(100)
  if (await page.evaluate(() => window.terminator.manager.ui.screens.route === 'controls')) await page.keyboard.press('Enter')
  await page.waitForFunction(() => {
    const state = window.terminator.manager.partyState
    const id = state.localPlayerId || state.playerId
    return state.players.find(player => player.id === id)?.ready === true
  })
}

async function waitForRoster(pages, names) {
  try {
    await Promise.all(pages.map(page => page.waitForFunction(expected => {
      const players = window.terminator?.manager?.partyState?.players || []
      return players.length === expected.length && players.map(player => player.name).join('|') === expected.join('|')
    }, names, {timeout: 30_000})))
  } catch (error) {
    const states = await Promise.all(pages.map(page => page.evaluate(() => ({
      route: window.terminator?.manager?.ui?.screens?.route,
      partyState: window.terminator?.manager?.partyState,
      partyError: document.querySelector('[data-party="error"]')?.textContent,
      relay: window.terminator?.manager?.party?.relay,
    })).catch(inner => ({evaluationError: inner.message}))))
    throw new Error(`Roster did not converge: ${JSON.stringify(states)}`, {cause: error})
  }
}

async function waitForPhase(pages, phase, wave) {
  try {
    await Promise.all(pages.map(page => page.waitForFunction(({phase, wave}) => {
      const world = window.terminator?.world
      return world?.phase === phase && world?.wave === wave
    }, {phase, wave}, {timeout: 180_000})))
  } catch (error) {
    const states = await Promise.all(pages.map(page => page.evaluate(() => ({
      phase: window.terminator?.world?.phase,
      wave: window.terminator?.world?.wave,
      route: window.terminator?.manager?.ui?.screens?.route,
      partyState: window.terminator?.manager?.partyState,
      directorPhase: window.terminator?.manager?.director?.phase,
      started: window.terminator?.manager?.party?.matchStarted,
      error: document.querySelector('[data-party="error"]')?.textContent || '',
    }))))
    throw new Error(`Phase ${phase} wave ${wave} did not converge: ${JSON.stringify(states)}`, {cause: error})
  }
}

async function assertPlayingState(page, role) {
  const deadline = Date.now() + 30_000
  let state
  while (Date.now() < deadline) {
    state = await page.evaluate(() => {
      const manager = window.terminator.manager
      return {
        phase: manager.world.phase,
        players: [...manager.world.players.values()].map(player => player.name),
        route: manager.ui.screens.route,
        inputActive: manager.input.active,
        localPlayerId: manager.localPlayerId,
        localAlive: manager.world.getPlayer(manager.localPlayerId)?.alive,
        localHp: manager.world.getPlayer(manager.localPlayerId)?.hp,
        hudVisible: !manager.hud.elements.combat.hidden,
        partyState: manager.partyState,
      }
    })
    if (!state.localAlive || (state.route === null && state.inputActive && state.hudVisible)) break
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  if (!state || state.route !== null || !state.inputActive || !state.hudVisible) {
    throw new Error(`${role} did not become playable: ${JSON.stringify(state)}`)
  }
  assert.equal(state.phase, 'wave', `${role} phase`)
  assert.deepEqual(state.players, ['John', 'Sarah'], `${role} roster`)
  assert.equal(state.route, null, `${role} screen route`)
  assert.equal(state.inputActive, true, `${role} input`)
  assert.equal(state.localAlive, true, `${role} local player alive`)
  assert.equal(state.hudVisible, true, `${role} HUD`)
}

async function verifyPauseReleasesPointerLock(page) {
  const paused = await page.evaluate(async () => {
    const manager = window.terminator.manager
    const canvas = manager.ctx.viewer.canvas
    canvas.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0, clientX: 480, clientY: 270}))
    manager.hud.root.querySelector('[data-action="pause"]').click()
    await manager.ui.screens.action('pause')
    return {
      route: manager.ui.screens.route,
      pointerLocked: document.pointerLockElement === canvas,
      inputActive: manager.input.active,
    }
  })
  assert.deepEqual(paused, {route: 'pause', pointerLocked: false, inputActive: false})
  const resumed = await page.evaluate(async () => {
    const manager = window.terminator.manager
    manager.ui.screens.root.querySelector('[data-action="resume"]').click()
    await manager.ui.screens.action('resume')
    return {route: manager.ui.screens.route, inputActive: manager.input.active}
  })
  assert.deepEqual(resumed, {route: null, inputActive: true})
}

async function moveWithKeyboard(page, code, milliseconds) {
  await page.evaluate(key => window.dispatchEvent(new KeyboardEvent('keydown', {code: key, bubbles: true})), code)
  await new Promise(resolve => setTimeout(resolve, milliseconds))
  await page.evaluate(key => window.dispatchEvent(new KeyboardEvent('keyup', {code: key, bubbles: true})), code)
}

async function moveAndAssertReplication(localPage, remotePage, playerId) {
  const before = await localPage.evaluate(id => structuredClone(window.terminator.world.getPlayer(id).pos), playerId)
  for (const code of ['KeyW', 'KeyD', 'KeyS', 'KeyA']) {
    await moveWithKeyboard(localPage, code, 700)
    const current = await localPage.evaluate(id => structuredClone(window.terminator.world.getPlayer(id).pos), playerId)
    if (Math.hypot(current.x - before.x, current.z - before.z) <= 0.25) continue
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const remote = await remotePage.evaluate(id => structuredClone(window.terminator.world.getPlayer(id).pos), playerId)
      if (Math.hypot(remote.x - before.x, remote.z - before.z) > 0.25) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    break
  }
  const diagnostic = await Promise.all([localPage, remotePage].map(page => page.evaluate(id => {
    const manager = window.terminator.manager
    return {
      position: structuredClone(manager.world.getPlayer(id)?.pos),
      alive: manager.world.getPlayer(id)?.alive,
      route: manager.ui.screens.route,
      inputActive: manager.input.active,
      connected: manager.party.connected,
      messages: structuredClone(manager.party.messageCounts),
      latestInput: manager.party.latestInputs?.get(id) || null,
    }
  }, playerId)))
  throw new Error(`${playerId} keyboard movement did not replicate: ${JSON.stringify(diagnostic)}`)
}

async function roster(page) {
  return page.evaluate(() => window.terminator.manager.partyState.players.map(player => player.name))
}

async function shootUntilKill(page, playerId, timeoutMs, remotePage) {
  const startKills = await page.evaluate(id => window.terminator.world.eventLog.filter(event => event.type === 'kill' && event.playerId === id).length, playerId)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await aimAndAct(page, {fire: true, flee: true})
    const kills = await page.evaluate(id => window.terminator.world.telemetry.players[id]?.counters?.kills || 0, playerId)
    if (kills > startKills) { await stopCombat(page); return }
    await page.waitForTimeout(80)
  }
  await stopCombat(page)
  const diagnostic = await Promise.all([page, remotePage].filter(Boolean).map(item => item.evaluate(id => {
    const manager = window.terminator.manager
    const player = manager.world.getPlayer(id)
    return {
      role: manager.sessionMode,
      phase: manager.world.phase,
      tick: manager.world.tick,
      player: player && {alive: player.alive, ammo: structuredClone(player.ammo[player.activeWeapon]), weapon: player.activeWeapon},
      units: manager.world.aliveUnits.slice(0, 8).map(unit => ({id: unit.id, type: unit.type, pos: structuredClone(unit.pos)})),
      connected: manager.party.connected,
      inputTick: manager.party.inputTick,
      lastAcknowledgedInputTick: manager.party.lastAcknowledgedInputTick,
      nextShotTick: manager.party.nextShotTick,
      pendingInputs: manager.party.pendingInputs?.length,
      pendingHits: manager.party.pendingHits?.get(id)?.size,
      latestInput: manager.party.latestInputs?.get(id),
      messages: structuredClone(manager.party.messageCounts),
    }
  }, playerId)))
  throw new Error(`${playerId} did not earn a kill within ${timeoutMs} ms: ${JSON.stringify(diagnostic)}`)
}

async function syncPlayerVitals(hostPage, guestPage, {hp, armor}) {
  let observed = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await hostPage.evaluate(({hp, armor}) => {
      const manager = window.terminator.manager
      for (const player of manager.world.players.values()) {
        player.hp = hp
        player.armor = armor
        player.alive = hp > 0
        player.downed = hp <= 0
      }
      manager.party.sendSnapshot()
    }, {hp, armor})
    await new Promise(resolve => setTimeout(resolve, 100))
    observed = await guestPage.evaluate(() => [...window.terminator.world.players.values()]
      .map(player => ({id: player.id, hp: player.hp, armor: player.armor})))
    if (observed.every(player => player.hp === hp && player.armor === armor)) return
  }
  throw new Error(`Guest did not receive synchronized player vitals: ${JSON.stringify(observed)}`)
}

async function clearWaveWithPlayer(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const manager = window.terminator.manager
      const player = manager.world.getPlayer(manager.localPlayerId)
      return {phase: manager.world.phase, ammo: player.ammo[player.activeWeapon]}
    })
    if (state.phase === 'intermission') { await stopCombat(page); return }
    if (state.ammo.mag <= 0 && state.ammo.reserve <= 0) break
    await aimAndAct(page, {fire: true, chase: true})
    await page.waitForTimeout(80)
  }
  await stopCombat(page)
  const diagnostic = await page.evaluate(() => {
    const manager = window.terminator.manager
    const world = manager.world
    const player = world.getPlayer(manager.localPlayerId)
    return {
      phase: world.phase,
      tick: world.tick,
      player: {id: player.id, pos: structuredClone(player.pos), activeWeapon: player.activeWeapon,
        ammo: structuredClone(player.ammo[player.activeWeapon]), hp: player.hp, alive: player.alive},
      units: world.aliveUnits.map(unit => ({id: unit.id, type: unit.type, hp: unit.hp,
        pos: structuredClone(unit.pos), path: unit.pathCache?.path?.length || 0})),
      recentCombat: world.eventLog.filter(event => ['shot', 'unit_damage', 'kill', 'reload'].includes(event.type)).slice(-12),
      lastAcknowledgedInputTick: manager.party.lastAcknowledgedInputTick,
      inputTick: manager.party.inputTick,
      pendingInputs: manager.party.pendingInputs?.length,
      messages: structuredClone(manager.party.messageCounts),
    }
  })
  throw new Error(`Living player did not clear wave one within ${timeoutMs} ms: ${JSON.stringify(diagnostic)}`)
}

async function aimAndAct(page, {fire = false, chase = false, flee = false} = {}) {
  return page.evaluate(({fire, chase, flee}) => {
    const manager = window.terminator.manager
    const world = manager.world
    const player = world.getPlayer(manager.localPlayerId)
    const held = manager.ui.bindings.held
    const pulses = manager.ui.bindings.pulses
    for (const code of ['Mouse0', 'Mouse2', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) held.delete(code)
    const units = world.aliveUnits.slice().sort((a, b) => Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z) - Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z))
    const eye = {x: player.pos.x, y: player.pos.y + 1.65, z: player.pos.z}
    const pointOnUnit = unit => {
      const collider = world.unitHitCollider(unit)
      const shape = collider.shapes.find(part => part.id === 'chest')
        || collider.shapes.find(part => part.part === 'body') || collider.shapes[0]
      const offset = shape?.offset || {x: 0, y: world.unitCatalog.types[unit.type].height * 0.42, z: 0}
      const cos = Math.cos(collider.yaw || 0), sin = Math.sin(collider.yaw || 0)
      return {
        x: collider.center.x + (offset.x || 0) * cos + (offset.z || 0) * sin,
        y: collider.center.y + (offset.y || 0),
        z: collider.center.z - (offset.x || 0) * sin + (offset.z || 0) * cos,
      }
    }
    const target = units.find(unit => world.lineOfSight(eye, pointOnUnit(unit))) || units[0]
    if (!target || !player.alive) return false
    const point = pointOnUnit(target)
    const dx = point.x - eye.x
    const dz = point.z - eye.z
    const dy = point.y - eye.y
    manager.input.yaw = Math.atan2(dx, dz)
    manager.input.pitch = Math.atan2(dy, Math.hypot(dx, dz))
    const visible = world.lineOfSight(eye, point)
    if (fire && visible) {
      held.add('Mouse0')
      held.add('Mouse2')
      const ammo = player.ammo[player.activeWeapon]
      if (ammo?.mag === 0 && ammo.reserve > 0 && player.reloadTimer === 0) pulses.add('reload')
    }
    if (chase || flee) {
      held.add(flee ? 'KeyS' : 'KeyW')
      if (chase && !visible) held.add(world.tick % 240 < 120 ? 'KeyA' : 'KeyD')
      held.add('ShiftLeft')
    }
    return true
  }, {fire, chase, flee})
}

function stopCombat(page) {
  return page.evaluate(() => {
    const input = window.terminator?.manager?.ui?.bindings
    if (!input) return
    for (const code of ['Mouse0', 'Mouse2', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) input.held.delete(code)
  }).catch(() => {})
}

async function surviveApartAndDownHost(hostPage, guestPage) {
  const deadline = Date.now() + 70_000
  while (Date.now() < deadline) {
    await Promise.all([aimAndAct(hostPage, {chase: true}), aimAndAct(guestPage, {flee: true})])
    const state = await hostPage.evaluate(() => ({
      hostAlive: window.terminator.world.getPlayer('player').alive,
      guestAlive: window.terminator.world.getPlayer('guest-1').alive,
    }))
    if (!state.hostAlive) { await Promise.all([stopCombat(hostPage), stopCombat(guestPage)]); assert.equal(state.guestAlive, true); return }
    assert.equal(state.guestAlive, true, 'guest must survive until the host is down')
    await hostPage.waitForTimeout(100)
  }
  throw new Error('Host did not go down while the guest stayed alive')
}

async function thinWaveToOne(shooterPage, hostPage, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await hostPage.evaluate(() => ({
      remaining: window.terminator.world.aliveUnits.length,
      alive: [...window.terminator.world.players.values()].filter(player => player.alive).map(player => player.id),
    }))
    if (state.alive.length < 2) {
      await Promise.all([stopCombat(shooterPage), stopCombat(hostPage)])
      if (state.alive.length === 1) {
        return {survivorId: state.alive[0], downedId: state.alive[0] === 'player' ? 'guest-1' : 'player'}
      }
      throw new Error('Both players went down while preparing the spectate case')
    }
    if (state.remaining <= 1) { await Promise.all([stopCombat(shooterPage), stopCombat(hostPage)]); return null }
    await Promise.all([
      aimAndAct(shooterPage, {fire: true, chase: true}),
      aimAndAct(hostPage, {fire: true, chase: true}),
    ])
    await new Promise(resolve => setTimeout(resolve, 35))
  }
  await Promise.all([stopCombat(shooterPage), stopCombat(hostPage)])
  const diagnostic = await Promise.all([hostPage, shooterPage].map(page => page.evaluate(() => {
    const manager = window.terminator.manager
    const guest = manager.world.getPlayer('guest-1')
    return {
      role: manager.sessionMode,
      phase: manager.world.phase,
      remaining: manager.world.aliveUnits.length,
      players: [...manager.world.players.values()].map(player => ({id: player.id, hp: player.hp, alive: player.alive})),
      guestAmmo: structuredClone(guest.ammo[guest.activeWeapon]),
      guestReload: guest.reloadTimer,
      inputActive: manager.input.active,
      route: manager.ui.screens.route,
      latestGuestInput: manager.party.latestInputs?.get('guest-1') || null,
      pendingGuestShots: manager.party.pendingHits?.get('guest-1')?.size || 0,
      messages: structuredClone(manager.party.messageCounts),
    }
  })))
  throw new Error(`Guest did not reduce wave one to a single enemy: ${JSON.stringify(diagnostic)}`)
}

async function damageOrDownHost(hostPage, guestPage, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await Promise.all([aimAndAct(hostPage, {chase: true}), aimAndAct(guestPage, {flee: true})])
    const state = await hostPage.evaluate(() => ({
      hp: window.terminator.world.getPlayer('player').hp,
      guestAlive: window.terminator.world.getPlayer('guest-1').alive,
      phase: window.terminator.world.phase,
    }))
    if (state.hp < 100) {
      await Promise.all([stopCombat(hostPage), stopCombat(guestPage)])
      if (state.hp <= 0) {
        assert.equal(state.guestAlive, true, 'guest must be alive when the host is already down')
        assert.equal(state.phase, 'wave', 'one downed player must not end the match')
      }
      return
    }
    await hostPage.waitForTimeout(60)
  }
  throw new Error('Host did not take damage before the mid-wave capture')
}

async function downBothPlayers(hostPage, guestPage, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await Promise.all([aimAndAct(hostPage, {chase: true}), aimAndAct(guestPage, {chase: true})])
    const ended = await hostPage.evaluate(() => window.terminator.world.phase === 'ended')
    if (ended) { await Promise.all([stopCombat(hostPage), stopCombat(guestPage)]); return }
    await hostPage.waitForTimeout(100)
  }
  throw new Error('Both players did not go down before the timeout')
}

async function syncAndFreezeCombat(hostPage, guestPage) {
  await setManualClock(hostPage, false)
  const authoritative = await hostPage.evaluate(() => {
    const manager = window.terminator.manager
    manager.party.sendSnapshot()
    return [...manager.world.players.values()].map(player => ({id: player.id, hp: player.hp, alive: player.alive}))
  })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const observed = await guestPage.evaluate(() => [...window.terminator.world.players.values()]
      .map(player => ({id: player.id, hp: player.hp, alive: player.alive})))
    if (JSON.stringify(observed) === JSON.stringify(authoritative)) {
      await setManualClock(guestPage, false)
      await Promise.all([hostPage, guestPage].map(page => page.evaluate(() => {
        window.terminator.manager.syncViews()
        window.terminator.manager.hud.sync()
      })))
      return
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`Guest health did not converge to the frozen host state: ${JSON.stringify(authoritative)}`)
}

async function assertSharedCombatState(hostPage, guestPage) {
  const [hostState, guestState] = await Promise.all([hostPage, guestPage].map(page => page.evaluate(() => {
    const manager = window.terminator.manager
    return {
      phase: manager.world.phase,
      wave: manager.world.wave,
      players: [...manager.world.players.values()].map(player => ({id: player.id, hp: player.hp})),
      waveHud: manager.hud.elements.wavePanel.textContent,
      vitalsVisible: !manager.hud.root.querySelector('[data-testid="vitals"]').hidden,
    }
  })))
  assert.equal(hostState.phase, 'wave')
  assert.equal(guestState.phase, 'wave')
  assert.equal(hostState.wave, 1)
  assert.equal(guestState.wave, 1)
  assert.match(hostState.waveHud, /WAVE\s*1/i)
  assert.match(guestState.waveHud, /WAVE\s*1/i)
  assert.equal(hostState.vitalsVisible, true)
  assert.equal(guestState.vitalsVisible, true)
  assert.deepEqual(hostState.players, guestState.players)
  assert.ok(hostState.players.some(player => player.hp < 100), 'combat must change player health before evidence capture')
}

async function ensureServers() {
  if (!await reachable(`http://127.0.0.1:${GAME_PORT}/`)) {
    const game = spawn('npx', ['kite3d', 'dev', '--port', String(GAME_PORT), '--no-open'], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    })
    ownedProcesses.push(game)
    await waitForReachable(`http://127.0.0.1:${GAME_PORT}/`, 45_000)
  }
}

async function reachable(url) {
  try { await fetch(url); return true } catch { return false }
}

async function waitForReachable(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await reachable(url)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Server did not become reachable on ${new URL(url).port}`)
}

function sanitize(value) {
  return String(value).replace(/([?&]t=)[A-Za-z0-9._~-]+/g, '$1[redacted]')
}

async function startCombatGuard(page) {
  await page.evaluate(() => {
    clearInterval(window.__coopCombatGuard)
    window.terminator.manager.ctx.viewer.renderEnabled = false
    window.__coopCombatGuard = setInterval(() => {
      const manager = window.terminator?.manager
      const world = manager?.world
      const player = world?.getPlayer(manager.localPlayerId)
      const bindings = manager?.ui?.bindings
      if (!player?.alive || world.phase !== 'wave' || !bindings) return
      if (!window.__coopGameClock) {
        manager.ctx.viewer.renderEnabled = false
        window.__coopGameClock = setInterval(() => manager.update({deltaTime: 1000 / 60}), 1000 / 60)
      }
      const target = world.aliveUnits.slice().sort((a, b) =>
        Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z)
          - Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z))[0]
      if (!target) return
      const collider = world.unitHitCollider(target)
      const volume = collider.shapes.find(shape => ['chest', 'hull', 'pelvis', 'spine'].includes(shape.id))
        || collider.shapes.find(shape => shape.id !== 'head') || collider.shapes[0]
      const offset = volume?.offset || {x: 0, y: 0, z: 0}
      const cos = Math.cos(collider.yaw || 0)
      const sin = Math.sin(collider.yaw || 0)
      const point = {
        x: collider.center.x + (offset.x || 0) * cos + (offset.z || 0) * sin,
        y: collider.center.y + (offset.y || 0),
        z: collider.center.z - (offset.x || 0) * sin + (offset.z || 0) * cos,
      }
      const dx = point.x - player.pos.x
      const dz = point.z - player.pos.z
      const dy = point.y - (player.pos.y + 1.65)
      manager.input.yaw = Math.atan2(dx, dz)
      manager.input.pitch = Math.atan2(dy, Math.hypot(dx, dz))
      for (const code of ['Mouse0', 'Mouse2', 'KeyS', 'ShiftLeft']) bindings.held.add(code)
      const ammo = player.ammo[player.activeWeapon]
      if (ammo?.mag === 0 && ammo.reserve > 0 && player.reloadTimer === 0) bindings.pulses.add('reload')
    }, 16)
  })
}

async function stopCombatGuard(page) {
  await page.evaluate(() => {
    clearInterval(window.__coopCombatGuard)
    window.__coopCombatGuard = null
    const bindings = window.terminator?.manager?.ui?.bindings
    if (!bindings) return
    for (const code of ['Mouse0', 'Mouse2', 'KeyS', 'ShiftLeft']) bindings.held.delete(code)
  })
}

