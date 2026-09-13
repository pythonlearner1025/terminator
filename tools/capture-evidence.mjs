#!/usr/bin/env node
import {mkdir, readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const root = new URL('../', import.meta.url)
const output = new URL('file:///Users/minjunes/games/terminator-evidence/docs/evidence/phase1/')
await mkdir(output, {recursive: true})
const dev = JSON.parse(await readFile(new URL('.kite3d/dev.json', root), 'utf8'))
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({viewport: {width: 1600, height: 1080}, deviceScaleFactor: 1})
const messages = []
const sanitize = (value) => String(value).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]')
page.on('console', (message) => {
  if (['warning', 'error'].includes(message.type())) messages.push(`${message.type()}: ${sanitize(message.text())}`)
})
page.on('pageerror', (error) => messages.push(`pageerror: ${sanitize(error.stack || error.message)}`))
page.on('response', (response) => {
  if (response.status() >= 400) messages.push(`response ${response.status()} ${response.request().method()}: ${sanitize(response.url())}`)
})

try {
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').waitFor({state: 'visible', timeout: 15000})
  await page.waitForTimeout(750)
  const alreadyPlaying = await page.evaluate(() => Boolean(window.terminator?.world))
  if (!alreadyPlaying) await page.getByTestId('play').click()
  await page.waitForFunction(() => Boolean(window.terminator?.world && document.querySelector('[data-testid="terminator-hud"]')), undefined, {timeout: 15000})
  await waitTicks(40)

  const beforeWalk = await playerPosition()
  await holdKey('a', 650)
  await holdKey('s', 1250)
  const afterWalk = await playerPosition()
  if (Math.hypot(afterWalk.x - beforeWalk.x, afterWalk.z - beforeWalk.z) < 3) throw new Error('Player did not walk into the courtyard')
  await capture('gray-box-player.png')

  await fireAtCanvasCenter(420)
  await releasePointerLock()
  await waitTicks(20)
  const shotCount = await page.evaluate(() => window.terminator.world.eventLog.filter((event) => event.type === 'shot' && event.by === 'player').length)
  if (shotCount < 1) throw new Error('Mouse fire did not create a player shot')
  await capture('hud-wave.png')

  await page.waitForFunction(() => {
    const world = window.terminator?.world
    if (!world) return false
    return world.player.alive && world.aliveUnits.some((unit) => Math.hypot(unit.pos.x - world.player.pos.x, unit.pos.z - world.player.pos.z) < 8)
  }, undefined, {timeout: 20000})
  await aimAtNearestVisibleUnit()
  await capture('unit-close-up.png')
  await page.waitForFunction(() => window.terminator?.world?.telemetry?.damageTaken?.length > 0, undefined, {timeout: 12000})
  const damageEvents = await page.evaluate(() => window.terminator.world.telemetry.damageTaken.length)

  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({
      phase: window.terminator.world.phase,
      alive: window.terminator.world.aliveUnits.length,
      mag: window.terminator.world.player.ammo.pistol.mag,
      hp: window.terminator.world.player.hp,
    }))
    if (state.phase === 'intermission') break
    if (state.phase !== 'wave') throw new Error(`Wave ended in unexpected phase: ${state.phase}`)
    if (state.hp <= 0) throw new Error('Player died before Wave 1 cleared')
    if (state.mag === 0) {
      await releasePointerLock()
      await page.keyboard.down('r')
      await waitTicks(3)
      await page.keyboard.up('r')
      await waitTicks(3)
      const reloadStarted = await page.evaluate(() => window.terminator.world.player.reloadTimer > 0)
      if (!reloadStarted) throw new Error('Reload input did not start the reload timer')
      await waitTicks(100)
      const loaded = await page.evaluate(() => window.terminator.world.player.ammo.pistol.mag)
      if (loaded === 0) throw new Error('Reload timer completed without loading the pistol')
      continue
    }
    const aimed = await aimAtNearestVisibleUnit()
    if (!aimed) {
      await fireAtCanvasCenter(180)
      await waitTicks(25)
      continue
    }
    await page.mouse.down({button: 'left'})
    await waitTicks(24)
    await page.mouse.up({button: 'left'})
    await waitTicks(8)
  }
  await page.waitForFunction(() => window.terminator?.world?.phase === 'intermission', undefined, {timeout: 5000})
  await capture('intermission.png')
  const finalState = await page.evaluate(() => ({
    phase: window.terminator.world.phase,
    kills: window.terminator.world.telemetry.kills.length,
    damageEvents: window.terminator.world.telemetry.damageTaken.length,
    shots: window.terminator.world.eventLog.filter((event) => event.type === 'shot' && event.by === 'player').length,
    playerStart: window.terminator.world.replay.length > 0,
  }))
  await releasePointerLock()
  await page.getByTestId('play').click({force: true})
  await page.waitForFunction(() => !document.querySelector('[data-testid="terminator-hud"]'), undefined, {timeout: 5000})
  if (messages.length) throw new Error(`Browser emitted ${messages.length} warning or error messages:\n${messages.join('\n')}`)
  console.log(JSON.stringify({walkedFrom: beforeWalk, walkedTo: afterWalk, damageEvents, ...finalState, screenshots: [
    '/Users/minjunes/games/terminator-evidence/docs/evidence/phase1/gray-box-player.png',
    '/Users/minjunes/games/terminator-evidence/docs/evidence/phase1/hud-wave.png',
    '/Users/minjunes/games/terminator-evidence/docs/evidence/phase1/unit-close-up.png',
    '/Users/minjunes/games/terminator-evidence/docs/evidence/phase1/intermission.png',
  ]}, null, 2))
} finally {
  await browser.close()
}

async function waitTicks(count) {
  const start = await page.evaluate(() => window.terminator.world.tick)
  await page.waitForFunction((target) => window.terminator?.world?.tick >= target, start + count, {timeout: Math.max(5000, count * 100)})
}

async function holdKey(key, milliseconds) {
  await page.keyboard.down(key)
  const ticks = Math.max(1, Math.round(milliseconds / 1000 * 60))
  await waitTicks(ticks)
  await page.keyboard.up(key)
  await waitTicks(2)
}

async function playerPosition() {
  return page.evaluate(() => ({...window.terminator.world.player.pos}))
}

async function canvasRect() {
  return page.evaluate(() => {
    const rect = window.viewer.canvas.getBoundingClientRect()
    return {x: rect.left, y: rect.top, width: rect.width, height: rect.height}
  })
}

async function capture(name) {
  const clip = await canvasRect()
  await page.screenshot({path: new URL(name, output).pathname, clip})
}

async function fireAtCanvasCenter(ticks) {
  const rect = await canvasRect()
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await page.mouse.down({button: 'left'})
  await waitTicks(ticks > 100 ? Math.round(ticks / 1000 * 60) : ticks)
  await page.mouse.up({button: 'left'})
}

async function aimAtNearestVisibleUnit() {
  await releasePointerLock()
  const turn = await page.evaluate(() => {
    const manager = window.terminator?.manager
    const world = manager?.world
    const input = manager?.input
    if (!world || !input) return null
    const eye = {...world.player.pos, y: world.player.pos.y + (world.player.crouch ? 1.12 : 1.65)}
    const choices = world.aliveUnits.map((unit) => {
      const spec = world.unitCatalog.types[unit.type]
      const head = {...unit.pos, y: unit.pos.y + spec.height * 0.84}
      const yaw = Math.atan2(head.x - eye.x, head.z - eye.z)
      let delta = yaw - input.yaw
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      return {delta, clear: world.lineOfSight(eye, head), distance: Math.hypot(head.x - eye.x, head.z - eye.z)}
    }).filter((item) => item.clear).sort((a, b) => a.distance - b.distance)
    return choices[0]?.delta ?? null
  })
  if (turn === null) return false
  if (Math.abs(turn) > 0.35) {
    const key = turn < 0 ? 'ArrowRight' : 'ArrowLeft'
    await page.keyboard.down(key)
    await waitTicks(Math.min(90, Math.max(1, Math.round(Math.abs(turn) / 0.032))))
    await page.keyboard.up(key)
    await waitTicks(2)
  }
  const aim = await page.evaluate(() => {
    const manager = window.terminator?.manager
    const world = manager?.world
    const input = manager?.input
    const canvas = window.viewer?.canvas
    if (!world || !input || !canvas) return null
    const eye = {...world.player.pos, y: world.player.pos.y + (world.player.crouch ? 1.12 : 1.65)}
    const choices = world.aliveUnits.map((unit) => {
      const spec = world.unitCatalog.types[unit.type]
      const head = {...unit.pos, y: unit.pos.y + spec.height * 0.84}
      const dx = head.x - eye.x
      const dy = head.y - eye.y
      const dz = head.z - eye.z
      const planar = Math.hypot(dx, dz)
      const yaw = Math.atan2(dx, dz)
      const pitch = Math.atan2(dy, planar)
      let delta = yaw - input.cursorAnchorYaw
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      return {unit, head, yaw, pitch, delta, distance: planar, clear: world.lineOfSight(eye, head)}
    }).filter((item) => item.clear).sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.distance - b.distance)
    const target = choices[0]
    if (!target) return null
    const rect = canvas.getBoundingClientRect()
    const verticalFov = input.fov * Math.PI / 180
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * rect.width / Math.max(1, rect.height))
    const nx = -target.delta / (horizontalFov * 0.5)
    const ny = -target.pitch / (verticalFov * 0.5)
    if (Math.abs(nx) > 0.94 || Math.abs(ny) > 0.94) return null
    return {
      x: rect.left + (nx + 1) * rect.width / 2,
      y: rect.top + (ny + 1) * rect.height / 2,
      unitId: target.unit.id,
    }
  })
  if (!aim) return false
  await page.mouse.move(aim.x, aim.y)
  await waitTicks(2)
  return true
}

async function releasePointerLock() {
  const locked = await page.evaluate(() => Boolean(document.pointerLockElement))
  if (!locked) return
  await page.evaluate(() => document.exitPointerLock())
  await page.waitForFunction(() => !document.pointerLockElement, undefined, {timeout: 2000})
  await waitTicks(2)
}
