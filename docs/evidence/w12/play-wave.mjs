#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const root = new URL('../../../', import.meta.url)
const output = new URL('./', import.meta.url)
const devFile = process.env.W12_DEV_FILE || new URL('.kite3d/dev.json', root)
const dev = JSON.parse(await readFile(devFile, 'utf8'))
if (new URL(dev.origin).port !== '4900') throw new Error(`Expected the owned dev server on port 4900, found port ${new URL(dev.origin).port}`)
const headful = process.env.W12_HEADFUL === '1'
const captureDelay = Math.max(0, Number(process.env.W12_CAPTURE_DELAY_MS) || 0)
const browser = await chromium.launch({
  headless: !headful,
  ...(headful ? {executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {}),
})
const page = await browser.newPage({viewport: {width: 1440, height: 980}, deviceScaleFactor: 1})
const sounds = []
const diagnostics = []
const safe = (value) => String(value).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]')

page.on('console', (message) => {
  const line = safe(message.text())
  if (line.startsWith('[audio] ')) sounds.push(`${new Date().toISOString()} ${line}`)
  if (['warning', 'error'].includes(message.type())) diagnostics.push(`${message.type()}: ${line}`)
})
page.on('pageerror', (error) => diagnostics.push(`pageerror: ${safe(error.stack || error.message)}`))

let summary = null
try {
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  const editorPlay = page.getByTestId('play').first()
  await editorPlay.waitFor({state: 'visible', timeout: 20000})
  await page.waitForFunction(async () => {
    if (!window.viewer?.scene?.modelRoot?.children?.length) return false
    const {EntityComponentPlugin} = await import('threepipe')
    return window.viewer.getPlugin(EntityComponentPlugin)?.hasComponentType('GameManager')
  }, undefined, {timeout: 45000})
  await page.waitForTimeout(3000)
  await editorPlay.click()
  await page.waitForFunction(() => Boolean(window.terminator?.world && document.querySelector('.tm-screen')), undefined, {timeout: 45000})
  await page.waitForFunction(() => Boolean(window.terminator?.manager?.audioBindings), undefined, {timeout: 10000})
  await page.locator('.tm-screen [data-action="play"]').click({force: true})
  await page.locator('.tm-screen [data-action="start-match"]').waitFor({state: 'visible', timeout: 10000})
  await clickAction('start-match')
  await page.waitForFunction(() => window.terminator?.manager?.director?.phase === 'wave', undefined, {timeout: 10000})
  await page.keyboard.press('Space')
  await page.waitForFunction(() => window.terminator?.manager?.audio?.context?.state === 'running', undefined, {timeout: 10000})

  const startTick = await page.evaluate(() => window.terminator.world.tick)
  await page.evaluate(() => {
    window.__w12Controller = {lockedTargetId: null, grenadeThrown: false}
    window.terminator.manager.started = false
  })
  if (captureDelay) {
    console.log('CAPTURE_WINDOW_READY')
    await page.waitForTimeout(captureDelay)
  }
  let combat = null
  for (let batch = 0; batch < 400; batch += 1) {
    combat = await page.evaluate(() => {
      const {world, director} = window.terminator.manager
      const controller = window.__w12Controller
      for (let step = 0; step < 8 && director.phase === 'wave'; step += 1) {
        const player = world.player
        const eye = {...player.pos, y: player.pos.y + (player.crouch ? 1.12 : 1.65)}
        const visible = world.aliveUnits.filter((unit) => {
          const spec = world.unitCatalog.types[unit.type]
          const point = {...unit.pos, y: unit.pos.y + spec.height * 0.46}
          return world.lineOfSight(eye, point)
        }).sort((a, b) => (
          a.id === controller.lockedTargetId ? -1
            : b.id === controller.lockedTargetId ? 1
              : a.hp - b.hp
        ))
        const target = visible[0] || null
        const nearest = [...world.aliveUnits].sort((a, b) => (
          Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z)
          - Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z)
        ))[0] || null
        let yaw = player.yaw
        let pitch = player.pitch
        let fire = false
        if (target) {
          controller.lockedTargetId = target.id
          const spec = world.unitCatalog.types[target.type]
          const dx = target.pos.x - player.pos.x
          const dz = target.pos.z - player.pos.z
          const dy = target.pos.y + spec.height * 0.46 - eye.y
          yaw = Math.atan2(dx, dz)
          pitch = Math.atan2(dy, Math.hypot(dx, dz))
          fire = true
        }
        let move = {x: 0, z: 0}
        if (nearest) {
          const dx = player.pos.x - nearest.pos.x
          const dz = player.pos.z - nearest.pos.z
          const length = Math.hypot(dx, dz) || 1
          const awayX = dx / length
          const awayZ = dz / length
          move = {
            x: awayX * Math.cos(yaw) - awayZ * Math.sin(yaw),
            z: awayX * Math.sin(yaw) + awayZ * Math.cos(yaw),
          }
        }
        const reload = player.ammo.pistol.mag <= 1 && player.reloadTimer <= 0
        const grenade = Boolean(target && !controller.grenadeThrown)
        if (grenade) controller.grenadeThrown = true
        director.step({move, yaw, pitch, fire: fire && !reload, reload, sprint: true, grenade})
      }
      return {
        phase: director.phase,
        tick: world.tick,
        hp: world.player.hp,
        alive: world.aliveUnits.length,
        kills: world.telemetry.counters.kills,
      }
    })
    await page.waitForTimeout(16)
    if (combat.phase === 'intermission') break
    if (combat.phase !== 'wave') throw new Error(`Wave 1 ended in unexpected phase: ${combat.phase}`)
    if (combat.hp <= 0) throw new Error(`Player died before clearing wave 1 at tick ${combat.tick}`)
  }
  await page.evaluate(() => {
    window.terminator.manager.started = true
    window.terminator.manager.syncViews()
  })
  if (combat?.phase !== 'intermission') throw new Error(`Wave 1 did not clear after ${combat?.tick ?? 0} core ticks`)

  await page.waitForFunction(() => window.terminator?.manager?.director?.phase === 'intermission', undefined, {timeout: 20000})
  await page.waitForTimeout(700)
  await clickAction('trader')
  await page.locator('.tm-screen [data-action="purchase:fill-ammo"]').waitFor({state: 'visible', timeout: 5000})
  await clickAction('purchase:fill-ammo')
  await page.waitForFunction(() => window.terminator.world.eventLog.some((event) => event.type === 'purchase' && event.wave === 1), undefined, {timeout: 5000})
  await page.waitForTimeout(250)
  await page.screenshot({path: new URL('wave-1-clear.png', output).pathname})
  const result = await page.evaluate(() => ({
    startTick: 0,
    endTick: window.terminator.world.tick,
    phase: window.terminator.manager.director.phase,
    kills: window.terminator.world.eventLog.filter((event) => event.type === 'kill' && event.wave === 1).length,
    shots: window.terminator.world.eventLog.filter((event) => event.type === 'shot' && event.by === 'player' && event.wave === 1).length,
    audioState: window.terminator.manager.audio.context.state,
    activeVoices: [...window.terminator.manager.audio.voices.values()].reduce((sum, pool) => sum + pool.length, 0),
  }))
  result.startTick = startTick
  const firedNames = [...new Set(sounds.map((line) => line.match(/\[audio\] ([^ ]+)/)?.[1]).filter(Boolean))]
  const required = ['ambient_bed', 'ui_click', 'wave_klaxon', 'combat_music', 'spawn_gate', 'pistol_9mm', 'unit_death', 'wave_clear', 'trader_open', 'cash_register']
  const missing = required.filter((name) => !firedNames.includes(name))
  if (missing.length) throw new Error(`Full-wave audio log missed required cues: ${missing.join(', ')}`)
  summary = {...result, firedNames, soundEvents: sounds.length, diagnostics}

  const report = [
    'Terminator W12 Playwright sound log',
    `Recorded: ${new Date().toISOString()}`,
    'Server: http://127.0.0.1:4900/?t=[redacted]',
    `Wave: 1, phase after playthrough: ${result.phase}`,
    `Ticks: ${startTick} to ${result.endTick}`,
    `Kills: ${result.kills}, player shots: ${result.shots}`,
    `AudioContext during evidence: ${result.audioState}`,
    `Distinct sounds fired: ${firedNames.length}`,
    `Sound events logged: ${sounds.length}`,
    '',
    ...sounds,
    '',
    'Diagnostics:',
    ...(diagnostics.length ? diagnostics : ['none']),
    '',
  ].join('\n')
  await writeFile(new URL('sound-log.txt', output), report)
  console.log(JSON.stringify(summary, null, 2))

  await editorPlay.click({force: true})
} catch (error) {
  const pageFailure = await page.evaluate(async () => {
    const {EntityComponentPlugin} = await import('threepipe')
    const components = window.viewer?.getPlugin(EntityComponentPlugin)?.getComponentsOfType('GameManager') || []
    const manager = components[0]
    return {
      componentRunning: window.viewer?.getPlugin(EntityComponentPlugin)?.running,
      managerFound: Boolean(manager),
      managerStarted: Boolean(manager?.started),
      phase: manager?.director?.phase || null,
      playerHp: manager?.world?.player?.hp ?? null,
      tick: manager?.world?.tick ?? null,
      alive: manager?.world?.aliveUnits?.length ?? null,
      kills: manager?.world?.telemetry?.counters?.kills ?? null,
      playerShots: manager?.world?.telemetry?.shots?.pistol ?? null,
      sounds: globalThis.__terminatorSoundLog || [],
    }
  }).catch((diagnosticError) => ({diagnosticError: String(diagnosticError)}))
  console.error(JSON.stringify({error: String(error), failure: {...pageFailure, diagnostics}}, null, 2))
  throw error
} finally {
  await browser.close()
}

async function waitTicks(count) {
  const start = await page.evaluate(() => window.terminator.world.tick)
  const target = start + count
  await page.waitForFunction((tick) => {
    const manager = window.terminator?.manager
    return !manager || manager.world?.tick >= tick || manager.director?.phase === 'ended'
  }, target, {timeout: Math.max(20000, count * 500)})
  const state = await page.evaluate(() => ({
    manager: Boolean(window.terminator?.manager),
    tick: window.terminator?.world?.tick ?? 0,
    phase: window.terminator?.manager?.director?.phase || null,
    hp: window.terminator?.world?.player?.hp ?? null,
  }))
  if (!state.manager) throw new Error('GameManager stopped during evidence run')
  if (state.phase === 'ended' && state.tick < target) throw new Error(`Player died during evidence run at tick ${state.tick}, hp ${state.hp}`)
}

async function clickAction(action) {
  await page.waitForFunction((value) => Boolean(document.querySelector(`[data-action="${value}"]`)), action, {timeout: 10000})
  await page.evaluate((value) => document.querySelector(`[data-action="${value}"]`).click(), action)
}

async function holdKey(key, ticks) {
  await page.keyboard.down(key)
  await waitTicks(ticks)
  await page.keyboard.up(key)
  await waitTicks(2)
}

async function holdKeys(keys, ticks) {
  for (const key of keys) await page.keyboard.down(key)
  await waitTicks(ticks)
  for (const key of [...keys].reverse()) await page.keyboard.up(key)
  await waitTicks(2)
}

async function kiteTicks(ticks, extraKey = null) {
  const keys = await page.evaluate(() => {
    const {world, input} = window.terminator.manager
    const player = world.player
    const nearest = [...world.aliveUnits].sort((a, b) => Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z)
      - Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z))[0]
    if (!nearest) return ['s', 'Shift']
    const dx = player.pos.x - nearest.pos.x
    const dz = player.pos.z - nearest.pos.z
    const length = Math.hypot(dx, dz) || 1
    const awayX = dx / length
    const awayZ = dz / length
    const right = awayX * Math.cos(input.yaw) + awayZ * -Math.sin(input.yaw)
    const forward = awayX * Math.sin(input.yaw) + awayZ * Math.cos(input.yaw)
    const result = ['Shift']
    if (Math.abs(right) > 0.25) result.push(right > 0 ? 'd' : 'a')
    if (Math.abs(forward) > 0.25) result.push(forward > 0 ? 'w' : 's')
    return result
  })
  if (extraKey) keys.push(extraKey)
  return holdKeys([...new Set(keys)], ticks)
}

async function kiteFor(ticks, extraKey = null) {
  let remaining = ticks
  while (remaining > 0) {
    const step = Math.min(10, remaining)
    await kiteTicks(step, extraKey)
    remaining -= step
  }
}

async function pulseKey(key) {
  await page.keyboard.down(key)
  await waitTicks(2)
  await page.keyboard.up(key)
  await waitTicks(2)
}

async function canvasRect() {
  return page.evaluate(() => {
    const rect = window.viewer.canvas.getBoundingClientRect()
    return {x: rect.left, y: rect.top, width: rect.width, height: rect.height}
  })
}

async function fireAtCanvasCenter(ticks) {
  await releasePointerLock()
  const rect = await canvasRect()
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await page.mouse.down({button: 'left'})
  await waitTicks(ticks)
  await page.mouse.up({button: 'left'})
  await releasePointerLock()
}

async function aimAtNearestVisibleUnit(preferredId = null) {
  await releasePointerLock()
  const turn = await page.evaluate((preferred) => {
    const {world, input} = window.terminator.manager
    const eye = {...world.player.pos, y: world.player.pos.y + (world.player.crouch ? 1.12 : 1.65)}
    const choices = world.aliveUnits.map((unit) => {
      const spec = world.unitCatalog.types[unit.type]
      const targetPoint = {...unit.pos, y: unit.pos.y + spec.height * 0.46}
      let delta = Math.atan2(targetPoint.x - eye.x, targetPoint.z - eye.z) - input.yaw
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      return {id: unit.id, hp: unit.hp, delta, clear: world.lineOfSight(eye, targetPoint), distance: Math.hypot(targetPoint.x - eye.x, targetPoint.z - eye.z)}
    }).filter((item) => item.clear).sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : a.hp - b.hp || a.distance - b.distance))
    return choices[0] || null
  }, preferredId)
  if (turn === null) return false
  if (Math.abs(turn.delta) > 0.3) {
    const key = turn.delta > 0 ? 'ArrowRight' : 'ArrowLeft'
    await kiteFor(Math.min(90, Math.max(1, Math.round(Math.abs(turn.delta) / 0.032))), key)
  }
  const aim = await page.evaluate((preferred) => {
    const {world, input} = window.terminator.manager
    const canvas = window.viewer.canvas
    const eye = {...world.player.pos, y: world.player.pos.y + (world.player.crouch ? 1.12 : 1.65)}
    const choices = world.aliveUnits.map((unit) => {
      const spec = world.unitCatalog.types[unit.type]
      const targetPoint = {...unit.pos, y: unit.pos.y + spec.height * 0.46}
      const dx = targetPoint.x - eye.x
      const dy = targetPoint.y - eye.y
      const dz = targetPoint.z - eye.z
      let delta = Math.atan2(dx, dz) - input.cursorAnchorYaw
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      return {id: unit.id, hp: unit.hp, targetPoint, delta, distance: Math.hypot(dx, dz), clear: world.lineOfSight(eye, targetPoint), pitch: Math.atan2(dy, Math.hypot(dx, dz))}
    }).filter((item) => item.clear).sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : a.hp - b.hp || a.distance - b.distance))
    const target = choices[0]
    if (!target) return null
    const rect = canvas.getBoundingClientRect()
    const verticalFov = input.fov * Math.PI / 180
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * rect.width / Math.max(1, rect.height))
    const nx = target.delta / (horizontalFov * 0.5)
    const ny = -target.pitch / (verticalFov * 0.5)
    if (Math.abs(nx) > 0.94 || Math.abs(ny) > 0.94) return null
    return {unitId: target.id, x: rect.left + (nx + 1) * rect.width / 2, y: rect.top + (ny + 1) * rect.height / 2}
  }, turn.id)
  if (!aim) return false
  await page.mouse.move(aim.x, aim.y)
  await waitTicks(2)
  return aim.unitId
}

async function releasePointerLock() {
  if (!await page.evaluate(() => Boolean(document.pointerLockElement))) return
  await page.evaluate(() => document.exitPointerLock())
  await page.waitForFunction(() => !document.pointerLockElement, undefined, {timeout: 2500})
  await waitTicks(2)
}
