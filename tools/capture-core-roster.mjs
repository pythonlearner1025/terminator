#!/usr/bin/env node
import assert from 'node:assert/strict'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const PORT = 4665
const OUTPUT = '/Users/minjunes/games/terminator-evidence/docs/evidence/core-roster'
const dev = JSON.parse(await readFile('.kite3d/dev.json', 'utf8'))
assert.equal(new URL(dev.url).port, String(PORT), `Kite3D dev must use port ${PORT}`)
await mkdir(OUTPUT, {recursive: true})

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal'],
})
const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1})
const issues = []
const sanitize = value => String(value).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]')
page.on('pageerror', error => issues.push(`pageerror: ${sanitize(error.stack || error.message)}`))
page.on('console', message => {
  if (message.type() === 'error') issues.push(`console: ${sanitize(message.text())}`)
})
page.on('response', response => {
  if (response.status() >= 400 && response.status() !== 412) {
    issues.push(`response ${response.status()}: ${sanitize(response.url())}`)
  }
})

const evidence = []
try {
  await page.addInitScript(() => {
    localStorage.setItem('terminator.settings.v1', JSON.stringify({quality: 'high', controlsSeen: true}))
  })
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').waitFor({state: 'visible', timeout: 30_000})
  await page.getByTestId('play').click()
  await page.waitForFunction(() => Boolean(window.terminator?.manager?.world), undefined, {timeout: 45_000})
  await page.waitForFunction(() => window.terminator.manager.ui?.screens?.route === 'main', undefined, {timeout: 45_000})
  await page.evaluate(async () => {
    const manager = window.terminator.manager
    const viewer = window.viewer
    Object.assign(viewer.container.style, {
      position: 'fixed', left: '0', top: '0', width: '1920px', height: '1080px',
      maxWidth: 'none', maxHeight: 'none', zIndex: '2147483000',
    })
    viewer.setSize({width: 1920, height: 1080})
    viewer.renderManager.renderScale = 1
    viewer.resize()
    manager.ui?.menuScene?.setActive(false)
    manager.startViews()
    await manager.visualWarmup
    await manager.mapView.ready
    manager.started = false
    manager.input.stop()
    manager.ui.screens.show(null)
    manager.world.player.hp = manager.world.player.maxHp = 100
    manager.world.player.armor = 100
    for (const key of Object.keys(manager.world.mapState.lights)) manager.world.mapState.lights[key] = 'on'
    window.__rosterReset = ({x = 0, z = 18, pitch = 0, wave = 1} = {}) => {
      const world = manager.world
      for (const unit of world.units) unit.brain?.destroy?.()
      world.units.length = 0
      world.unitById.clear()
      world.projectiles.length = 0
      world.eventLog.length = 0
      world.snapshotEventCursor = 0
      world.nextUnitId = 1
      world.nextProjectileId = 1
      manager.unitView.eventIndex = 0
      manager.unitView.sync(world)
      Object.assign(world.player.pos, {x, y: 0, z})
      Object.assign(world.player, {yaw: Math.PI, pitch, activeWeapon: 'm4', aiming: false, alive: true})
      world.phase = 'wave'
      world.wave = wave
      world.bossPhase = wave === 5 || wave === 10
    }
    window.__rosterSettle = (frames = 40) => {
      const world = manager.world
      for (let frame = 0; frame < frames; frame += 1) {
        world.tick += 1
        manager.syncViews()
      }
      manager.playerView.weapons.root.visible = false
      viewer.setDirty()
    }
  })

  await page.evaluate(() => {
    const manager = window.terminator.manager
    const world = manager.world
    window.__rosterReset({z: 12, pitch: .28})
    const aerial = world.spawnUnit('hkaerial', {x: 0, y: 4.5, z: 2}, {id: 'evidence-hkaerial', yaw: 0})
    aerial.brain?.destroy?.()
    aerial.brain = {tick() {}}
    aerial.intent.aimAt = {x: 0, y: 1.65, z: 12}
    aerial.intent.fire = true
    world.projectiles.push(
      {id: 'evidence-bolt-1', type: 'bolt', owner: 'unit', ownerId: aerial.id, pos: {x: -.25, y: 4, z: 5.5}, vel: {x: 0, y: -2.2, z: 18}, born: world.tick, damage: 20, splash: 0, weapon: null},
      {id: 'evidence-bolt-2', type: 'bolt', owner: 'unit', ownerId: aerial.id, pos: {x: .25, y: 3.1, z: 8.5}, vel: {x: 0, y: -2.2, z: 18}, born: world.tick, damage: 20, splash: 0, weapon: null},
    )
    window.__rosterSettle(40)
  })
  await capture('01-hkaerial-bolt-volley.png')
  const aerial = await page.evaluate(() => {
    const manager = window.terminator.manager
    const visual = manager.unitView.visuals.get('evidence-hkaerial')
    return {unit: visual?.unitType, bolts: manager.playerView.weapons.projectiles.counts.bolt}
  })
  assert.deepEqual(aerial, {unit: 'hkaerial', bolts: 2})
  evidence.push({file: '01-hkaerial-bolt-volley.png', ...aerial})

  await page.evaluate(() => {
    const manager = window.terminator.manager
    const world = manager.world
    window.__rosterReset({z: 12})
    const liquid = world.spawnUnit('t1000', {x: 0, y: 0, z: 6}, {id: 'evidence-t1000', yaw: 0})
    liquid.brain?.destroy?.()
    liquid.brain = {tick() {}}
    liquid.intent.face = {x: 0, y: 0, z: 12}
    liquid.intent.melee = true
    window.__rosterSettle(40)
  })
  await capture('02-t1000-melee.png')
  const t1000 = await page.evaluate(() => {
    const visual = window.terminator.manager.unitView.visuals.get('evidence-t1000')
    return {unit: visual?.unitType, melee: visual?.rig.states.has('melee') || false}
  })
  assert.deepEqual(t1000, {unit: 't1000', melee: true})
  evidence.push({file: '02-t1000-melee.png', ...t1000})

  await page.evaluate(() => {
    const manager = window.terminator.manager
    const world = manager.world
    window.__rosterReset({z: 12, pitch: -.02, wave: 5})
    const tank = world.spawnUnit('hktank', {x: 0, y: 0, z: 2}, {id: 'evidence-hktank', yaw: 0})
    tank.brain?.destroy?.()
    tank.brain = {tick() {}}
    tank.intent.aimAt = {x: 0, y: 1.65, z: 12}
    tank.intent.fire = true
    world.projectiles.push(
      {id: 'evidence-shell-1', type: 'shell', owner: 'unit', ownerId: tank.id, pos: {x: -.22, y: 2.4, z: 6}, vel: {x: 0, y: -.7, z: 22}, born: world.tick, damage: 60, splash: 2.5, weapon: null},
      {id: 'evidence-shell-2', projectileType: 'shell', owner: 'unit', ownerId: tank.id, pos: {x: .22, y: 2.1, z: 10}, vel: {x: 0, y: -.7, z: 22}, born: world.tick, damage: 60, splash: 2.5, weapon: null},
    )
    window.__rosterSettle(40)
  })
  await capture('03-hktank-shells.png')
  const tank = await page.evaluate(() => {
    const manager = window.terminator.manager
    const visual = manager.unitView.visuals.get('evidence-hktank')
    return {unit: visual?.unitType, shells: manager.playerView.weapons.projectiles.counts.shell, boss: manager.world.bossPhase}
  })
  assert.deepEqual(tank, {unit: 'hktank', shells: 2, boss: true})
  evidence.push({file: '03-hktank-shells.png', ...tank})

  assert.deepEqual(issues, [])
  const result = {headless: true, port: PORT, viewport: [1920, 1080], evidence, issues}
  await writeFile(`${OUTPUT}/capture.json`, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  await browser.close()
}

async function capture(file) {
  await page.evaluate(() => {
    const manager = window.terminator.manager
    manager.playerView.weapons.beforeRender(manager.playerView.camera)
    window.viewer.setDirty()
  })
  await page.waitForTimeout(300)
  await page.screenshot({path: `${OUTPUT}/${file}`})
}
