#!/usr/bin/env node
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const GAME_PORT = 4730
const RELAY_PORT = 7831
const RELAY = `ws://127.0.0.1:${RELAY_PORT}`
const EVIDENCE = 'docs/evidence/coop-e2e'
const steps = []
const issues = []
const ownedProcesses = []

await mkdir(EVIDENCE, {recursive: true})
await ensureServers()
const dev = JSON.parse(await readFile('.kite3d/dev.json', 'utf8'))
assert.equal(new URL(dev.url).port, String(GAME_PORT), `Kite3D dev must use port ${GAME_PORT}`)

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
const thirdContext = await guestBrowser.newContext(contextOptions)
const host = await hostContext.newPage()
const guest = await guestContext.newPage()
const thirdGuest = await thirdContext.newPage()

watchPage('host', host)
watchPage('guest', guest)
watchPage('guest-2-reserved', thirdGuest)

try {
  await bootEditor(host, dev.url)
  pass('Host clicked the real Kite3D Play control and reached the game main menu')

  await host.getByTestId('host-party').click()
  await host.locator('[data-party-field="name"]').fill('John')
  await host.locator('[data-party-field="relay"]').fill(RELAY)
  await host.getByTestId('create-party').evaluate(button => button.click())
  await host.waitForFunction(() => window.terminator?.manager?.partyState?.status === 'lobby')
  await host.waitForFunction(() => Boolean(document.querySelector('[data-party="invite"]')?.value))
  const invite = await host.locator('[data-party="invite"]').inputValue()
  const partyCode = await host.evaluate(() => window.terminator.manager.partyState.code)
  assert.match(partyCode, /^[A-Z0-9]{6}$/)
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

  await Promise.all([startCombatGuard(host), startCombatGuard(guest)])
  await host.getByTestId('party-start').evaluate(button => button.click())
  await waitForPhase([host, guest], 'wave', 1)
  await assertPlayingState(host, 'host')
  await assertPlayingState(guest, 'guest')
  await Promise.all([setManualClock(host, true), setManualClock(guest, true)])
  pass('Host used Start and both browsers entered wave one with combat HUD, two players, and active local input')

  await verifyPauseReleasesPointerLock(host)
  await Promise.all([stopCombatGuard(host), stopCombatGuard(guest)])
  pass('Opening a screen during play stopped look input, released pointer lock, and Resume restored play input')

  await moveAndAssertReplication(host, guest, 'player')
  await moveAndAssertReplication(guest, host, 'guest-1')
  pass('Keyboard movement changed both local players and each remote browser received the other position change')

  const reconnect = await guest.evaluate(() => {
    const party = window.terminator.manager.party
    window.__coopOldSocket = party.socket
    return {playerId: party.playerId, resumeToken: party.resumeToken}
  })
  await guest.evaluate(() => window.terminator.manager.party.socket.close())
  await guest.waitForFunction(() => {
    const party = window.terminator.manager.party
    return party.connected && party.socket && party.socket !== window.__coopOldSocket
  }, null, {timeout: 12_000})
  await host.waitForFunction(id => window.terminator.manager.party.players.get(id)?.connected === true, reconnect.playerId)
  assert.equal(await guest.evaluate(() => window.terminator.manager.party.playerId), reconnect.playerId)
  assert.equal(await guest.evaluate(() => window.terminator.manager.party.resumeToken), reconnect.resumeToken)
  assert.deepEqual(await roster(host), ['John', 'Sarah'])
  pass('The guest dropped and automatically reconnected from the same invite with the same player id, token, and roster slot')

  await shootUntilKill(guest, 'guest-1', 55_000)
  await shootUntilKill(host, 'player', 55_000)
  let spectatePair = await thinWaveToOne(guest, host, 60_000)
  if (!spectatePair) await damageOrDownHost(host, guest, 30_000)
  await syncAndFreezeCombat(host, guest)
  await assertSharedCombatState(host, guest)
  await captureEvidence(host, `${EVIDENCE}/host-mid-wave.png`, {resume: false})
  await captureEvidence(guest, `${EVIDENCE}/guest-mid-wave.png`, {resume: false})
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
  await captureEvidence(host, `${EVIDENCE}/party-lobby-after-death.png`)
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
    mode: 'two isolated headless Chromium processes and contexts with a reserved third guest context and 1920 by 1080 evidence capture',
    gamePort: GAME_PORT,
    relayPort: RELAY_PORT,
    partyCode,
    steps,
    issues,
    screenshots: ['host-mid-wave.png', 'guest-mid-wave.png', 'party-lobby-after-death.png'],
  }
  await writeFile(`${EVIDENCE}/results.json`, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ok: true, assertions: steps.length, screenshots: result.screenshots}, null, 2))
} finally {
  await Promise.allSettled([hostContext.close(), guestContext.close(), thirdContext.close()])
  await Promise.allSettled([hostBrowser.close(), guestBrowser.close()])
  for (const child of ownedProcesses) child.kill('SIGTERM')
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
      if (source.endsWith('/files/.kite3d/state.json') && /412/.test(message.text())) return
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
    if (response.status() === 412 && url.endsWith('/files/.kite3d/state.json')) return
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

async function captureEvidence(page, path, {resume = true} = {}) {
  await setManualClock(page, false)
  await page.setViewportSize({width: 1920, height: 1080})
  await page.evaluate(async () => {
    const manager = window.terminator.manager
    const viewer = manager.ctx.viewer
    manager.ui.screens.settings.quality = 'high'
    manager.ui.applySettings(manager.ui.screens.settings)
    manager.syncViews()
    manager.hud.sync()
    if (manager.world.phase === 'wave') {
      const world = manager.world
      const player = world.getPlayer(manager.localPlayerId)
      const camera = manager.playerView?.camera
      if (player && camera) {
        const eye = {x: player.pos.x, y: player.pos.y + (player.crouched ? 1.08 : 1.65), z: player.pos.z}
        const nearby = [...world.players.values(), ...world.aliveUnits]
          .filter(entity => entity.id !== player.id && entity.alive !== false)
        let best = {yaw: player.yaw, score: -Infinity}
        for (let index = 0; index < 24; index += 1) {
          const yaw = -Math.PI + index * Math.PI / 12
          const target = {x: eye.x + Math.sin(yaw) * 8, y: eye.y, z: eye.z + Math.cos(yaw) * 8}
          let score = world.lineOfSight(eye, target) ? 20 : 0
          for (const entity of nearby) {
            const dx = entity.pos.x - player.pos.x
            const dz = entity.pos.z - player.pos.z
            const distance = Math.hypot(dx, dz)
            const bearing = Math.atan2(dx, dz)
            const separation = Math.abs(Math.atan2(Math.sin(yaw - bearing), Math.cos(yaw - bearing)))
            if (distance < 4) score += separation * (4 - distance)
          }
          if (score > best.score) best = {yaw, score}
        }
        camera.position.set(eye.x, eye.y, eye.z)
        camera.rotation.set(0, best.yaw + Math.PI, 0)
        camera.updateMatrixWorld(true)
        camera.setDirty?.({source: 'Co-op evidence framing'})
      }
    }
    await new Promise(resolve => {
      const done = () => {
        viewer.removeEventListener('postRender', done)
        viewer.renderEnabled = false
        resolve()
      }
      viewer.addEventListener('postRender', done)
      viewer.renderEnabled = true
      viewer.setDirty()
    })
  })
  await page.screenshot({path, animations: 'disabled'})
  await page.setViewportSize({width: 1280, height: 720})
  await page.evaluate(() => {
    const ui = window.terminator.manager.ui
    ui.screens.settings.quality = 'low'
    ui.applySettings(ui.screens.settings)
  })
  if (resume) await setManualClock(page, true)
}

async function setManualClock(page, active) {
  await page.evaluate(enabled => {
    clearInterval(window.__coopGameClock)
    window.__coopGameClock = null
    const manager = window.terminator?.manager
    if (!manager) return
    manager.ctx.viewer.renderEnabled = false
    if (enabled) window.__coopGameClock = setInterval(() => manager.update({deltaTime: 1000 / 60}), 1000 / 60)
  }, active)
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
      const spec = world.unitCatalog.types[target.type]
      const dx = target.pos.x - player.pos.x
      const dz = target.pos.z - player.pos.z
      const dy = target.pos.y + spec.height * 0.84 - (player.pos.y + 1.65)
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
  await page.keyboard.down(code)
  await page.waitForTimeout(milliseconds)
  await page.keyboard.up(code)
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

async function shootUntilKill(page, playerId, timeoutMs) {
  const startKills = await page.evaluate(id => window.terminator.world.eventLog.filter(event => event.type === 'kill' && event.playerId === id).length, playerId)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await aimAndAct(page, {fire: true})
    const kills = await page.evaluate(id => window.terminator.world.eventLog.filter(event => event.type === 'kill' && event.playerId === id).length, playerId)
    if (kills > startKills) { await stopCombat(page); return }
    await page.waitForTimeout(80)
  }
  await stopCombat(page)
  throw new Error(`${playerId} did not earn a kill within ${timeoutMs} ms`)
}

async function clearWaveWithPlayer(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const phase = await page.evaluate(() => window.terminator.world.phase)
    if (phase === 'intermission') { await stopCombat(page); return }
    await aimAndAct(page, {fire: true, chase: true})
    await page.waitForTimeout(80)
  }
  await stopCombat(page)
  throw new Error(`Living player did not clear wave one within ${timeoutMs} ms`)
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
    const target = units.find(unit => world.lineOfSight(
      {x: player.pos.x, y: player.pos.y + 1.65, z: player.pos.z},
      {x: unit.pos.x, y: unit.pos.y + world.unitCatalog.types[unit.type].height * 0.84, z: unit.pos.z},
    )) || units[0]
    if (!target || !player.alive) return false
    const spec = world.unitCatalog.types[target.type]
    const dx = target.pos.x - player.pos.x
    const dz = target.pos.z - player.pos.z
    const dy = target.pos.y + spec.height * 0.84 - (player.pos.y + 1.65)
    manager.input.yaw = Math.atan2(dx, dz)
    manager.input.pitch = Math.atan2(dy, Math.hypot(dx, dz))
    const visible = world.lineOfSight(
      {x: player.pos.x, y: player.pos.y + 1.65, z: player.pos.z},
      {x: target.pos.x, y: target.pos.y + spec.height * 0.84, z: target.pos.z},
    )
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
  if (!await reachable(`http://127.0.0.1:${RELAY_PORT}/health`)) {
    const lobby = spawn(process.execPath, ['server/index.js'], {
      cwd: process.cwd(), env: {...process.env, PORT: String(RELAY_PORT)}, stdio: ['ignore', 'pipe', 'pipe'],
    })
    ownedProcesses.push(lobby)
    await waitForReachable(`http://127.0.0.1:${RELAY_PORT}/health`, 15_000)
  }
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
