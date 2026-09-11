#!/usr/bin/env node
import {execFile as execFileCallback, spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {promisify} from 'node:util'
import {chromium} from 'playwright'

const execFile = promisify(execFileCallback)
const root = new URL('../../../', import.meta.url)
const output = new URL('./', import.meta.url)
await mkdir(output, {recursive: true})

const kite = spawn('npx', ['kite3d', 'dev', '--port', '4700', '--no-open', '--force'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let kiteOutput = ''
const editorUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Kite3D did not start within 20 seconds')), 20_000)
  const onData = (chunk) => {
    kiteOutput += String(chunk)
    const match = kiteOutput.match(/Kite3D editor: (http:\/\/[^\s]+)/)
    if (!match) return
    clearTimeout(timer)
    resolve(match[1])
  }
  kite.stdout.on('data', onData)
  kite.stderr.on('data', onData)
  kite.once('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`Kite3D exited before startup with code ${code}`))
  })
})

const browser = await chromium.launch({headless: true})
const page = await browser.newPage({viewport: {width: 1600, height: 1000}, deviceScaleFactor: 1})
const browserMessages = []
const safe = (value) => String(value).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]')
page.on('console', (message) => {
  if (!['warning', 'error'].includes(message.type())) return
  if (/GPU stall due to ReadPixels/.test(message.text())) return
  browserMessages.push(`${message.type()}: ${safe(message.text())}`)
})
page.on('pageerror', (error) => browserMessages.push(`pageerror: ${safe(error.message)}`))

let sse = null
let sseText = ''
try {
  const health = await fetch('http://localhost:7801/health')
  if (!health.ok) throw new Error('lobby server is not healthy on port 7801')
  await page.goto(editorUrl, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').waitFor({state: 'visible', timeout: 20_000})
  await page.waitForFunction(() => !document.body.innerText.includes('Loading project…'), null, {timeout: 90_000})
  await page.getByTestId('play').click()
  await page.waitForFunction(() => Boolean(window.terminator?.manager), null, {timeout: 60_000})
  await page.getByTestId('menu-play').click({force: true})
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-live="code"]')?.textContent || ''
    return /^[A-Z0-9]{6}$/.test(text)
  }, null, {timeout: 10_000})
  const code = await page.locator('[data-live="code"]').textContent()
  const base = `http://localhost:7801/api/lobby/${code}`

  sse = spawn('curl', ['-sS', '-N', '--max-time', '40', `${base}/events`], {stdio: ['ignore', 'pipe', 'pipe']})
  sse.stdout.setEncoding('utf8')
  sse.stdout.on('data', (chunk) => { sseText += chunk })
  sse.stderr.resume()

  const joinBody = {name: 'Evidence Skynet', agent_info: {client: 'curl', purpose: 'w8 evidence'}}
  const join = await curlJson(['-X', 'POST', `${base}/join`, '-H', 'Content-Type: application/json', '--data', JSON.stringify(joinBody)])
  await page.waitForFunction(() => window.terminator.world.skynet.name === 'Evidence Skynet', null, {timeout: 10_000})
  await capture(page, 'lobby-agent-connected.png')

  await page.getByTestId('start-match').click({force: true})
  await page.waitForFunction(() => window.terminator?.world?.phase === 'wave' && window.terminator.world.wave === 1, null, {timeout: 10_000})
  await page.waitForFunction(() => window.terminator.world.aliveUnits.length > 0, null, {timeout: 10_000})
  await page.waitForFunction(() => {
    const world = window.terminator.world
    if (!world) return false
    for (const unit of world.aliveUnits) world.damageUnit(unit.id, unit.hp, {source: 'player', weapon: 'pistol', distance: 5})
    return world.phase === 'intermission'
  }, null, {timeout: 20_000, polling: 100})
  await waitFor(() => sseText.includes('"type":"wave_summary"'), 10_000, 'wave summary did not arrive over SSE')

  const state = await curlJson([`${base}/state`])
  const scriptSource = `export function tick(self, sense, act, mem) {
  const target = sense.player?.pos || sense.lastKnownPlayer?.pos || self.pos
  act.moveTo(target)
  act.face(target)
  act.say('REV TWO ACTIVE')
  if (sense.player && self.type !== 'scout') { act.aimAt(target); act.fire() }
  if (sense.player && self.type === 'scout') act.melee()
}`
  const scriptBody = {unit_type: 'scout', source: scriptSource, note: 'Wave 2 evidence script'}
  const script = await curlJson(['-X', 'POST', `${base}/script`, '-H', 'Content-Type: application/json', '--data', JSON.stringify(scriptBody)])
  const configBody = {
    wave: 2,
    spawns: [{t: 0, gate: 'E1', unit: 'scout', count: 1}],
    knobs: {
      gates: ['E1'],
      doors: {building_ground: 'locked'},
      lights: {courtyard: 'off'},
      fog: 2,
      hazards: [],
      break_flank_wall: false,
    },
  }
  const config = await curlJson(['-X', 'POST', `${base}/wave_config`, '-H', 'Content-Type: application/json', '--data', JSON.stringify(configBody)])
  await page.waitForFunction(() => window.terminator.manager.lobby.pendingPlan?.scripts?.scout?.rev === 2, null, {timeout: 10_000})
  await page.keyboard.press('r')
  await page.waitForFunction(() => window.terminator.world.wave === 2 && window.terminator.world.phase === 'wave', null, {timeout: 15_000})
  await page.waitForFunction(() => window.terminator.world.aliveUnits.length > 0, null, {timeout: 10_000})
  await page.evaluate(() => {
    const manager = window.terminator.manager
    const unit = manager.world.aliveUnits[0]
    manager.started = false
    unit.pos.x = 3
    unit.pos.y = 0
    unit.pos.z = 13
    manager.world.player.pos.x = 3
    manager.world.player.pos.y = 0
    manager.world.player.pos.z = 8
    manager.world.player.yaw = 0
    manager.world.player.pitch = 0
    manager.input.yaw = 0
    manager.input.pitch = 0
    manager.syncViews()
    manager.hud.transmissionAt = 0
    manager.syncViews()
  })
  await page.waitForFunction(() => document.querySelector('.tm-nameplate:not([hidden])')?.textContent.includes('rev 2'), null, {timeout: 10_000})
  await page.waitForFunction(() => document.querySelector('[data-role="transmission"]')?.textContent.includes('courtyard:off'), null, {timeout: 10_000})
  await capture(page, 'wave2-agent-config.png')

  const applied = await page.evaluate(() => ({
    phase: window.terminator.world.phase,
    wave: window.terminator.world.wave,
    skynet: document.querySelector('[data-role="skynet"]')?.textContent,
    revs: document.querySelector('[data-role="revs"]')?.textContent,
    transmission: document.querySelector('[data-role="transmission"]')?.textContent,
    nameplates: document.querySelector('.tm-nameplate:not([hidden])')?.textContent,
    map: structuredClone(window.terminator.world.mapState),
  }))
  const events = parseSse(sseText)
  const summaryEvent = events.find((event) => event.type === 'wave_summary')
  console.log(JSON.stringify({
    code,
    commands: {
      join: `curl -sS -X POST ${base}/join -H 'Content-Type: application/json' --data '<join JSON>'`,
      events: `curl -sS -N ${base}/events`,
      script: `curl -sS -X POST ${base}/script -H 'Content-Type: application/json' --data '<script JSON>'`,
      waveConfig: `curl -sS -X POST ${base}/wave_config -H 'Content-Type: application/json' --data '<wave config JSON>'`,
    },
    responses: {
      join: {name: join.state.agent.name, phase: join.state.phase, wave: join.state.wave},
      script,
      waveConfig: config,
      state: {phase: state.phase, wave: state.wave, budget: state.budget},
    },
    sse: {wave_summary: summaryEvent, event_types: [...new Set(events.map((event) => event.type))]},
    applied,
    screenshots: ['docs/evidence/w8/lobby-agent-connected.png', 'docs/evidence/w8/wave2-agent-config.png'],
    browserMessages,
  }, null, 2))
  await page.getByTestId('play').click({force: true})
} catch (error) {
  const diagnostics = await page.evaluate(() => ({
    body: document.body.innerText.slice(0, 2000),
    hasViewer: Boolean(window.viewer),
    hasTerminator: Boolean(window.terminator),
    playButtons: [...document.querySelectorAll('[data-testid]')].map((item) => item.getAttribute('data-testid')).filter(Boolean).slice(0, 80),
  })).catch(() => ({}))
  console.error(JSON.stringify({error: String(error?.message || error), browserMessages, diagnostics}, null, 2))
  throw error
} finally {
  sse?.kill('SIGTERM')
  await browser.close()
  kite.kill('SIGINT')
}

async function curlJson(args) {
  const {stdout} = await execFile('curl', ['-sS', ...args], {maxBuffer: 1024 * 1024})
  return JSON.parse(stdout)
}

async function waitFor(check, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

function parseSse(text) {
  return text.split('\n\n').flatMap((chunk) => {
    const line = chunk.split('\n').find((item) => item.startsWith('data: '))
    if (!line) return []
    try { return [JSON.parse(line.slice(6))] } catch { return [] }
  })
}

async function capture(page, name) {
  const clip = await page.evaluate(() => {
    const rect = window.viewer.canvas.getBoundingClientRect()
    return {x: rect.left, y: rect.top, width: rect.width, height: rect.height}
  })
  await page.screenshot({path: new URL(name, output).pathname, clip})
}
