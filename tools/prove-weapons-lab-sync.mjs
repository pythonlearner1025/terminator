#!/usr/bin/env node
import assert from 'node:assert/strict'
import {mkdir, readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const dev = JSON.parse(await readFile(process.argv[2], 'utf8'))
const port = new URL(dev.url).port
assert.ok(!['4300', '4310'].includes(port), `Proof port ${port} is reserved`)
const output = '/Users/minjunes/games/terminator-evidence/docs/evidence/weapons-lab-sync'
await mkdir(output, {recursive: true})

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal'],
})
const page = await browser.newPage({viewport: {width: 1600, height: 900}, deviceScaleFactor: 1})
const errors = []
const safe = value => String(value).replace(/([?&]t=)[^&\s"']+/g, '$1[private]')
page.on('pageerror', error => errors.push(safe(error.message)))
page.on('console', message => {if (message.type() === 'error') errors.push(safe(message.text()))})
page.on('response', response => {if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`)})

try {
  await page.addInitScript(() => localStorage.setItem('terminator.settings.v1', JSON.stringify({quality: 'high', controlsSeen: true})))
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').click({timeout: 60_000})
  await page.waitForFunction(() => window.terminator?.manager?.started, null, {timeout: 90_000})
  await page.evaluate(() => window.terminator.manager.ready)

  const inventory = await page.evaluate(() => {
    const manager = window.terminator.manager
    const scene = window.viewer.scene.modelRoot
    const targetNodes = [], plateNodes = []
    scene.traverse(node => {
      const authoredName = node.userData.name || node.name.replaceAll('_', ' ')
      if (/^\d+m .* Target$/.test(authoredName)) targetNodes.push(node)
      if (/^Plate \d$/.test(authoredName)) plateNodes.push(node)
    })
    const pistol = manager.playerView.weapons.rigs.pistol
    return {
      manager: manager.constructor.ComponentType,
      worldTargets: manager.world.units.length,
      placedTargets: targetNodes.length,
      placedPlates: plateNodes.length,
      livePlates: manager.rangeView.props.plates.length,
      weapons: Object.keys(manager.playerView.weapons.rigs),
      revolverClips: pistol.clips.map(clip => clip.name),
      revolverHands: [pistol.right?.name, pistol.left?.name],
    }
  })
  assert.equal(inventory.manager, 'WeaponsLab')
  assert.equal(inventory.worldTargets, 18)
  assert.equal(inventory.placedTargets, 18)
  assert.equal(inventory.placedPlates, 6)
  assert.equal(inventory.livePlates, 6)
  assert.deepEqual(inventory.weapons, ['pistol', 'm4', 'shotgun', 'plasma', 'knife', 'grenade', 'sniper', 'launcher'])
  assert.deepEqual(inventory.revolverHands, ['HandRight', 'HandLeft'])
  assert.deepEqual(inventory.revolverClips, ['Idle', 'Draw', 'Fire', 'Reload', 'AimIn', 'AimOut', 'AimIdle', 'Sprint', 'Inspect'])

  const rangeToggle = await page.evaluate(() => {
    const panel = window.terminator.manager.ui.rangePanel.root
    const before = panel.hidden
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'F1', key: 'F1'}))
    const after = panel.hidden
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'F1', key: 'F1'}))
    return before !== after && panel.hidden === before
  })
  assert.equal(rangeToggle, true)
  await page.getByTestId('range-time-0.25').click()
  assert.equal(await page.evaluate(() => window.terminator.manager.range.clock.scale), .25)
  await page.getByTestId('range-camera-inspect').click()
  assert.equal(await page.evaluate(() => window.terminator.manager.rangeView.inspecting), true)
  await page.getByTestId('range-camera-player').click()
  await page.getByTestId('lab-frame-0').click()
  assert.equal(await page.getByTestId('lab-comparison').isVisible(), true)
  await page.getByTestId('lab-match').click()
  assert.deepEqual(await page.evaluate(() => ({
    inspecting: window.terminator.manager.rangeView.inspecting,
    clip: window.terminator.manager.lab.clip,
  })), {inspecting: false, clip: 'idle'})
  await page.getByTestId('lab-unpin').click()
  await page.getByTestId('range-camera-player').click()
  for (const weapon of inventory.weapons) {
    await page.getByTestId(`range-weapon-${weapon}`).click()
    assert.equal(await page.evaluate(() => window.terminator.world.player.activeWeapon), weapon)
  }

  await page.evaluate(() => {
    const manager = window.terminator.manager, viewer = window.viewer
    manager.capturePaused = true
    manager.input.stop()
    manager.range.setReloads(false)
    manager.range.clock.setScale(.25)
    manager.rangeView.options.trajectories = false
    manager.rangeView.options.impacts = false
    manager.rangeView.options.ruler = false
    manager.lab.reference.strip.hidden = true
    Object.assign(viewer.container.style, {position: 'fixed', left: '0', top: '0', width: '1600px', height: '900px', maxWidth: 'none', maxHeight: 'none', zIndex: 999})
    viewer.setSize({width: 1600, height: 900})
    viewer.resize()
    window.labSyncProof = {
      setup(weapon, distance) {
        manager.rangeView.clearShots()
        manager.range.equip(weapon)
        manager.rangeView.equip(weapon)
        manager.range.layout = [{id: 'sync-proof-target', type: 'heavy', distance, row: distance,
          pos: {x: -18 + distance, y: 0, z: -13}, yaw: -Math.PI / 2}]
        manager.range.respawn()
        Object.assign(manager.world.player, {yaw: Math.PI / 2, pitch: 0})
        manager.world.player.pos.x = -18
        manager.world.player.pos.z = -13
        manager.world.tick += 120
        manager.syncViews()
        const bullets = manager.playerView.weapons.bullets
        bullets.reset()
        manager.unitView.fx.reset()
        this.start = manager.world.tick / 60
        this.events = manager.world.eventLog.length
        this.impacts = []
        bullets.deliver = impact => {this.impacts.push({kind: impact.kind, due: impact.due, at: bullets.lastTime}); bullets.arrive(impact)}
      },
      advance(frames, fire) {
        for (let frame = 0; frame < frames; frame += 1) {
          const ticks = manager.range.clock.takeTicks(1000 / 30)
          for (let tick = 0; tick < ticks; tick += 1) {
            manager.director.pauseWaves()
            manager.director.step({fire, yaw: Math.PI / 2, pitch: 0})
            manager.range.afterStep()
            manager.cameraFeel.consume(manager.world)
          }
          manager.syncViews()
        }
      },
      state() {
        const bullets = manager.playerView.weapons.bullets
        return {
          scale: manager.range.clock.scale,
          shots: manager.world.eventLog.slice(this.events).filter(event => event.type === 'shot' && !event.unitType).length,
          bullets: bullets.pool.items.filter(item => item.active).length,
          pending: bullets.impacts.pending,
          impacts: [...this.impacts],
        }
      },
    }
  })

  const captures = []
  for (const [weapon, label, distance, filename] of [
    ['pistol', 'revolver', 20, '01-revolver-025x.png'],
    ['m4', 'm4', 20, '02-m4-025x.png'],
    ['sniper', 'sniper', 40, '03-sniper-025x.png'],
  ]) {
    await page.evaluate(({weapon, distance}) => window.labSyncProof.setup(weapon, distance), {weapon, distance})
    for (let frame = 0; frame < 20; frame += 1) {
      await page.evaluate(() => window.labSyncProof.advance(1, true))
      if (await page.evaluate(() => window.labSyncProof.state().bullets > 0)) break
    }
    await page.evaluate(() => window.labSyncProof.advance(8, false))
    const inFlight = await page.evaluate(() => window.labSyncProof.state())
    assert.equal(inFlight.scale, .25)
    assert.ok(inFlight.shots > 0, `${label} did not fire`)
    assert.ok(inFlight.bullets > 0, `${label} bullet was not visible`)
    assert.equal(inFlight.impacts.length, 0, `${label} impact arrived before its bullet`)
    const path = `${output}/${filename}`
    await page.waitForTimeout(120)
    await page.screenshot({path})
    captures.push({weapon: label, path, bullets: inFlight.bullets, pending: inFlight.pending})
    for (let frame = 0; frame < 240; frame += 1) {
      await page.evaluate(() => window.labSyncProof.advance(1, false))
      if (await page.evaluate(() => window.labSyncProof.state().impacts.length > 0)) break
    }
    const arrived = await page.evaluate(() => window.labSyncProof.state())
    assert.ok(arrived.impacts.length > 0, `${label} impact did not arrive`)
    assert.ok(arrived.impacts.every(impact => impact.at >= impact.due), `${label} impact arrived before its due time`)
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({headless: true, port, inventory, rangeToggle, scale: .25, captures, errors}, null, 2))
} finally {
  await browser.close()
}
