#!/usr/bin/env node
import assert from 'node:assert/strict'
import {readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const output = 'docs/evidence/w16-net'
const relay = process.env.W16_RELAY || 'ws://127.0.0.1:7816'
const dev = JSON.parse(await readFile('.kite3d/dev.json', 'utf8'))
assert.equal(new URL(dev.url).port, '4590', 'evidence must use the dev server on port 4590')
const origin = new URL(dev.url).origin

const browser = await chromium.launch({headless: true, args: [
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
]})
const hostContext = await browser.newContext({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1})
const guestContext = await browser.newContext({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1})
const hostPage = await hostContext.newPage()
const guestPage = await guestContext.newPage()
const browserIssues = []

for (const [role, page] of [['host', hostPage], ['guest', guestPage]]) {
  page.on('pageerror', (error) => browserIssues.push({role, level: 'error', text: sanitize(error.message)}))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserIssues.push({role, level: message.type(), text: sanitize(message.text())})
    }
  })
}

try {
  await boot(hostPage)
  await boot(guestPage)
  const hosted = await hostPage.evaluate(async (relayUrl) => {
    const result = await window.terminator.manager.startHost({name: 'John', relay: relayUrl})
    return {code: result.code, state: window.terminator.manager.partyState}
  }, relay)
  assert.match(hosted.code, /^[A-Z0-9]{6}$/)

  await guestPage.evaluate(async ({code, relayUrl}) => {
    await window.terminator.manager.joinParty({code, relay: relayUrl, name: 'Sarah'})
  }, {code: hosted.code, relayUrl: relay})

  await waitForTwoPlayers(hostPage, 'host')
  await waitForTwoPlayers(guestPage, 'guest')
  await Promise.all([
    hostPage.evaluate(() => window.terminator.manager.setPartyReady(true)),
    guestPage.evaluate(() => window.terminator.manager.setPartyReady(true)),
  ])
  await hostPage.waitForFunction(() => window.terminator.manager.partyState?.players?.every((player) => player.ready))
  const start = await hostPage.evaluate(() => window.terminator.manager.startMatch())
  assert.equal(start.ok, true)
  await Promise.all([
    hostPage.waitForFunction(() => window.terminator.world?.phase === 'wave' && window.terminator.world?.wave === 1),
    guestPage.waitForFunction(() => window.terminator.world?.phase === 'wave' && window.terminator.world?.wave === 1),
  ])
  await Promise.all([
    hostPage.evaluate(() => window.terminator.manager.ui.screens.show(null)),
    guestPage.evaluate(() => window.terminator.manager.ui.screens.show(null)),
  ])
  await hostPage.evaluate(() => {
    const idle = {move: {x: 0, z: 0}, yaw: 0, pitch: 0}
    window.evidenceStepper = setInterval(() => window.terminator.manager.party.step(idle), 1000 / 60)
  })
  await guestPage.evaluate(() => window.terminator.manager.party.step({
    move: {x: 1, z: 0}, yaw: 0, pitch: 0, sprint: true,
  }))
  await guestPage.waitForTimeout(500)
  await guestPage.evaluate(() => window.terminator.manager.party.step({move: {x: 0, z: 0}, yaw: 0, pitch: 0}))
  await guestPage.waitForFunction(() => (window.terminator.manager.party?.messageCounts?.received?.snapshot || 0) >= 40,
    null, {timeout: 10_000})
  await hostPage.evaluate(() => clearInterval(window.evidenceStepper))
  await Promise.all([
    hostPage.evaluate(() => window.terminator.manager.syncViews()),
    guestPage.evaluate(() => window.terminator.manager.syncViews()),
  ])
  await Promise.all([
    hostPage.waitForFunction(() => window.terminator.manager.playersView?.visuals?.size === 1),
    guestPage.waitForFunction(() => window.terminator.manager.playersView?.visuals?.size === 1),
    hostPage.waitForFunction(() => document.querySelectorAll('[data-testid="teammates"] [data-player-id]').length === 1),
    guestPage.waitForFunction(() => document.querySelectorAll('[data-testid="teammates"] [data-player-id]').length === 1),
  ])

  const [host, guest] = await Promise.all([inspect(hostPage), inspect(guestPage)])
  assert.equal(host.wave, 1)
  assert.equal(guest.wave, 1)
  assert.deepEqual(host.playerNames, ['John', 'Sarah'])
  assert.deepEqual(guest.playerNames, ['John', 'Sarah'])
  assert.equal(host.remoteVisuals, 1)
  assert.equal(guest.remoteVisuals, 1)
  assert.ok(guest.snapshotRateHz >= 18 && guest.snapshotRateHz <= 22,
    `snapshot rate ${guest.snapshotRateHz.toFixed(2)} Hz was outside 18 to 22 Hz`)
  await Promise.all([
    screenshotCanvas(hostPage, `${output}/host-wave1.png`),
    screenshotCanvas(guestPage, `${output}/guest-wave1.png`),
  ])
  assert.equal(browserIssues.filter((issue) => issue.level === 'error').length, 0, JSON.stringify(browserIssues))

  const result = {
    run: 'w16-net',
    mode: 'headless Chromium, two isolated browser contexts',
    devPort: 4590,
    relay,
    partyCode: hosted.code,
    host,
    guest,
    browserIssues,
  }
  await writeFile(`${output}/results.json`, `${JSON.stringify(result, null, 2)}\n`)
  await writeFile(`${output}/transcript.md`, transcript(result))
  console.log(JSON.stringify({
    host: {wave: host.wave, players: host.playerNames, messages: host.messages},
    guest: {wave: guest.wave, players: guest.playerNames, messages: guest.messages},
    snapshotRateHz: guest.snapshotRateHz,
    screenshots: ['host-wave1.png', 'guest-wave1.png'],
    errors: browserIssues.filter((issue) => issue.level === 'error').length,
  }, null, 2))
} finally {
  await hostPage.evaluate(() => clearInterval(window.evidenceStepper)).catch(() => {})
  await hostContext.close()
  await guestContext.close()
  await browser.close()
}

async function boot(page) {
  await page.context().request.get(dev.url)
  await page.goto(`${origin}/files/docs/evidence/w16-net/runtime.html`, {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => Boolean(window.evidenceGame && window.terminator?.manager?.ui), null,
    {timeout: 120_000, polling: 200})
}

async function screenshotCanvas(page, path) {
  await page.evaluate(async () => {
    const manager = window.terminator.manager
    const viewer = manager.ctx.viewer
    manager.syncViews()
    manager.hud.sync()
    await document.fonts.ready
    await new Promise((resolve) => {
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
}

async function waitForTwoPlayers(page, role) {
  try {
    await page.waitForFunction(() => window.terminator.world?.players?.size === 2, null, {timeout: 30_000})
  } catch (error) {
    const state = await page.evaluate(() => ({
      managerWorldPlayers: window.terminator?.manager?.world?.players?.size ?? null,
      partyWorldPlayers: window.terminator?.manager?.party?.world?.players?.size ?? null,
      localPlayerId: window.terminator?.manager?.localPlayerId ?? null,
      sessionMode: window.terminator?.manager?.sessionMode ?? null,
      partyState: window.terminator?.manager?.partyState ?? null,
    }))
    throw new Error(`${role} did not expose both players: ${JSON.stringify(state)}`, {cause: error})
  }
}

async function inspect(page) {
  return page.evaluate(() => {
    const manager = window.terminator.manager
    const party = manager.party
    const times = party.snapshotTimes || []
    const recent = times.slice(-40)
    const snapshotRateHz = recent.length > 1 ? (recent.length - 1) * 1000 / (recent.at(-1) - recent[0]) : 0
    return {
      role: manager.sessionMode,
      localPlayerId: manager.localPlayerId,
      phase: manager.world.phase,
      wave: manager.world.wave,
      tick: manager.world.tick,
      playerNames: [...manager.world.players.values()].map((player) => player.name),
      teammateRows: document.querySelectorAll('[data-testid="teammates"] [data-player-id]').length,
      remoteVisuals: manager.playersView.visuals.size,
      messages: structuredClone(party.messageCounts),
      snapshotSamples: recent.length,
      snapshotRateHz,
    }
  })
}

function transcript(result) {
  const {host, guest} = result
  return `# W16 netcode evidence\n\n` +
    `- Run: headless Chromium with two isolated browser contexts on Kite3D dev port 4590.\n` +
    `- Relay: ${result.relay}, real WebSocket lobby server.\n` +
    `- Host: wave ${host.wave}, tick ${host.tick}, players ${host.playerNames.join(', ')}, ${host.remoteVisuals} remote soldier visual.\n` +
    `- Guest: wave ${guest.wave}, tick ${guest.tick}, players ${guest.playerNames.join(', ')}, ${guest.remoteVisuals} remote soldier visual.\n` +
    `- Host message counts: ${JSON.stringify(host.messages)}.\n` +
    `- Guest message counts: ${JSON.stringify(guest.messages)}.\n` +
    `- Snapshot measurement: ${guest.snapshotSamples} samples at ${guest.snapshotRateHz.toFixed(2)} Hz.\n` +
    `- Browser errors: ${result.browserIssues.filter((issue) => issue.level === 'error').length}.\n` +
    `- Screenshots: host-wave1.png and guest-wave1.png.\n`
}

function sanitize(value) {
  return String(value).replace(/([?&]t=)[A-Za-z0-9._~-]+/g, '$1[redacted]')
}
