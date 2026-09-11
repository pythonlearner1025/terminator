import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const safe = (value) => String(value).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]')
const dev = JSON.parse(await readFile('.kite3d/dev.json', 'utf8'))
const browser = await chromium.launch({headless: true})
const page = await browser.newPage({viewport: {width: 1440, height: 900}})
const sandboxConsole = []
const browserErrors = []
page.on('console', (message) => {
  const line = safe(message.text())
  if (line.includes('[Terminator sandbox]')) sandboxConsole.push(line)
  if (message.type() === 'error') browserErrors.push(`error: ${line}`)
})
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${safe(error.message)}`))

try {
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').waitFor({state: 'visible', timeout: 15000})
  await page.getByTestId('play').click()
  await page.waitForFunction(() => Boolean(window.terminator?.world), undefined, {timeout: 40000})
  await page.getByTestId('menu-play').evaluate((element) => element.click())
  await page.locator('[data-action="start-match"]').evaluate((element) => element.click())
  await page.waitForFunction(() => window.terminator?.world?.units?.some((unit) => (
    unit.brain?.constructor?.name === 'UnitScriptRuntime'
    && unit.mem
    && Object.keys(unit.mem).length > 0
  )), undefined, {timeout: 20000})
  const live = await page.evaluate(() => {
    const world = window.terminator.world
    const scripted = world.units.filter((unit) => unit.brain?.constructor?.name === 'UnitScriptRuntime')
    return {
      tick: world.tick,
      phase: world.phase,
      units: world.units.length,
      scriptedUnits: scripted.length,
      revs: scripted.map((unit) => unit.rev),
    }
  })
  const fuel = await page.evaluate(() => {
    const World = window.terminator.world.constructor
    const world = new World({
      scriptSources: {scout: 'export function tick() { while (true) {} }'},
      seed: 11,
    })
    const unit = world.spawnUnit('scout', {x: 0, y: 0, z: 13}, {yaw: Math.PI})
    unit.intent.moveTo = {x: 2, y: 0, z: 13}
    const previousIntent = JSON.stringify(unit.intent)
    world.step()
    const event = world.eventLog.find(({type}) => type === 'fuelExhausted')
    const result = {
      event: event ? {type: event.type, unitId: event.unitId, rev: event.rev} : null,
      interruptChecks: unit.brain.lastFuel.interruptChecks,
      intentPreserved: JSON.stringify(unit.intent) === previousIntent,
    }
    world.destroy()
    return result
  })
  const benchmark = await page.evaluate(() => {
    const World = window.terminator.world.constructor
    const world = new World({seed: 2029})
    world.player.hp = 1e9
    for (let index = 0; index < 24; index += 1) {
      const angle = index / 24 * Math.PI * 2
      world.spawnUnit(['scout', 'endo', 'heavy'][index % 3], {
        x: Math.sin(angle) * 22,
        y: 0,
        z: Math.cos(angle) * 22,
      }, {yaw: angle + Math.PI})
    }
    for (let tick = 0; tick < 600; tick += 1) world.step()
    const samples = []
    for (let tick = 0; tick < 3600; tick += 1) {
      const start = performance.now()
      world.step()
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
    const p95 = samples[Math.floor(samples.length * 0.95)]
    const result = {
      runtime: 'Chromium',
      unitsAlive: world.aliveUnits.length,
      steps: samples.length,
      meanMsPerStep: Number(mean.toFixed(4)),
      p95MsPerStep: Number(p95.toFixed(4)),
    }
    world.destroy()
    return result
  })
  await page.screenshot({path: '/tmp/terminator-sandbox-browser.png'})
  process.stdout.write(`${JSON.stringify({
    live,
    fuel,
    sandboxConsole: [...new Set(sandboxConsole)],
    benchmark,
    browserErrors: [...new Set(browserErrors)],
  }, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${safe(error.stack || error.message)}\n`)
  process.exitCode = 1
} finally {
  await browser.close()
}
