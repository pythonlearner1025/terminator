#!/usr/bin/env node
import assert from 'node:assert/strict'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const PORT = 4673
const OUTPUT = '/Users/minjunes/games/terminator-evidence/docs/evidence/roster-visuals'
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
      manager.unitView.rosterFx.reset();manager.unitView.ragdolls.reset();manager.unitView.fx.reset()
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
    window.__rosterReset({x: 4,z: 11, pitch: .36})
    const aerial = world.spawnUnit('hkaerial', {x: 4, y: 3.5, z: 4}, {id: 'evidence-hkaerial', yaw: 0})
    aerial.brain?.destroy?.()
    aerial.brain = {tick() {}}
    aerial.intent.aimAt = {x: 6, y: .8, z: 7}
    aerial.intent.fire = true
    aerial.vel.x=5
    window.__rosterSettle(40)
    world.projectiles.length=0;manager.syncViews()
  })
  await capture('02-hkaerial-bank.png')
  const aerial = await page.evaluate(() => {
    const manager = window.terminator.manager
    const visual = manager.unitView.visuals.get('evidence-hkaerial')
    return {unit: visual?.unitType, bolts: manager.playerView.weapons.projectiles.counts.bolt}
  })
  assert.deepEqual(aerial, {unit: 'hkaerial', bolts: 0})
  assert.ok(await page.evaluate(()=>Math.abs(window.terminator.manager.unitView.visuals.get('evidence-hkaerial').rig.roster.bank)>.1))
  assert.equal(await page.getByTestId('boss-bar').isVisible(),false)
  evidence.push({file: '02-hkaerial-bank.png', ...aerial,banking:true,searchlight:true})

  await page.evaluate(() => {
    const manager = window.terminator.manager
    const world = manager.world
    window.__rosterReset({x: 4,z: 9.3, pitch: -.12})
    const liquid = world.spawnUnit('t1000', {x: 4, y: 0, z: 6}, {id: 'evidence-t1000', yaw: 0})
    liquid.brain?.destroy?.()
    liquid.brain = {tick() {}}
    liquid.intent.face = {x: 4, y: 0, z: 12}
    liquid.intent.melee = true
    window.__rosterSettle(40)
    world.projectiles.length=0;manager.syncViews()
  })
  await capture('01-t1000-blade.png')
  const t1000 = await page.evaluate(() => {
    const visual = window.terminator.manager.unitView.visuals.get('evidence-t1000')
    return {unit: visual?.unitType, melee: visual?.rig.states.has('melee') || false}
  })
  assert.deepEqual(t1000, {unit: 't1000', melee: true})
  assert.equal(await page.evaluate(()=>window.terminator.manager.hud.plates.get('evidence-t1000').children[0].textContent),'T-1000')
  evidence.push({file: '01-t1000-blade.png', ...t1000,nameplate:'T-1000'})

  await page.evaluate(() => {
    const manager = window.terminator.manager
    const world = manager.world
    window.__rosterReset({x: 6,z: 10, pitch: -.06, wave: 5})
    const tank = world.spawnUnit('hktank', {x: 4, y: 0, z: 2}, {id: 'evidence-hktank', yaw: -.35})
    tank.brain?.destroy?.()
    tank.brain = {tick() {}}
    tank.intent.aimAt = {x: 0, y: 1.65, z: 12}
    tank.intent.fire = true
    window.__rosterSettle(40)
    world.projectiles.length=0;manager.syncViews()
  })
  await capture('03-hktank-boss.png')
  const tank = await page.evaluate(() => {
    const manager = window.terminator.manager
    const visual = manager.unitView.visuals.get('evidence-hktank')
    return {unit: visual?.unitType, shells: manager.playerView.weapons.projectiles.counts.shell, boss: manager.world.bossPhase}
  })
  assert.deepEqual(tank, {unit: 'hktank', shells: 0, boss: true})
  assert.equal(await page.getByTestId('boss-bar').isVisible(),true)
  assert.match(await page.getByTestId('boss-bar').innerText(),/6000 \/ 6000/)
  assert.match(await page.getByTestId('boss-bar').innerText(),/REAR POWER CORE/)
  evidence.push({file: '03-hktank-boss.png', ...tank,renderedBoss:true})

  await page.evaluate(() => {
    const m=window.terminator.manager
    m.hud.elements.banner.hidden=true
  })
  for(const [type,age,file] of [['t1000',1.6,'04-t1000-puddle.png'],['hkaerial',.25,'05-hkaerial-breakup.png'],['hktank',.65,'06-hktank-wreck.png']]) {
    await page.evaluate(({type,age})=>{
      const m=window.terminator.manager,w=m.world
      window.__rosterReset({x:4,z:type==='t1000'?8:10,pitch:type==='t1000'?-.28:type==='hkaerial'?.28:-.03,wave:type==='hktank'?5:4})
      const u=w.spawnUnit(type,{x:4,y:type==='hkaerial'?3.5:0,z:type==='t1000'?5:2},{id:'death-'+type,yaw:0})
      u.brain?.destroy?.();u.brain={tick(){}}
      window.__rosterSettle(40)
      w.damageUnit(u.id,u.hp+1,{weapon:'launcher',source:'player',playerId:w.player.id,part:type==='hktank'?'Core':'Chest'})
      for(let f=0;f<age*60;f++){w.tick++;m.syncViews()}
      m.hud.elements.banner.hidden=true
      window.viewer.setDirty()
    },{type,age})
    await capture(file)
    const death=await page.evaluate(type=>{
      const m=window.terminator.manager,v=m.unitView.visuals.get('death-'+type),r=v.rig.roster
      return {type,phase:r.deathPhase,puddle:r.puddle.visible,pieces:r.pieces.filter(p=>p.mesh.visible).length,severed:v.rig.severed.size,particles:m.unitView.rosterFx.mesh.count}
    },type)
    assert.equal(death.phase,type==='t1000'?'pool':'burn');assert.equal(death.pieces,type==='hkaerial'?6:type==='hktank'?1:0)
    if(type==='t1000'){assert.equal(death.puddle,true);assert.equal(death.severed,0)}
    else assert.ok(death.particles>0)
    evidence.push({file,...death})
  }
  const cleanup=await page.evaluate(()=>{
    const m=window.terminator.manager,root=m.unitView.root
    m.stopViews()
    return {detached:root.parent===null,rosterDisposed:m.unitView.rosterFx===null,visuals:m.unitView.visuals.size}
  })
  assert.deepEqual(cleanup,{detached:true,rosterDisposed:true,visuals:0})
  assert.deepEqual(issues, [])
  const result = {headless: true, port: PORT, viewport: [1920, 1080], evidence, cleanup, issues}
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
