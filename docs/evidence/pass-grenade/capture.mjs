import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const evidence = new URL('./', import.meta.url)
const root = new URL('../../../', evidence)
await mkdir(evidence, {recursive: true})
const dev = JSON.parse(await readFile(new URL('.kite3d/dev.json', root), 'utf8'))
if (new URL(dev.origin).port !== '4720') throw new Error('Expected grenade dev server on port 4720')

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal'],
})
const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1})
await page.emulateMedia({reducedMotion: 'reduce'})
const errors = []
const redact = value => String(value).replace(/\?t=[^\s"']+/g, '?t=[redacted]')
page.on('pageerror', error => errors.push(redact(error.message)))
page.on('console', message => {
  if (['warning', 'error'].includes(message.type())) errors.push(`${message.type()}: ${redact(message.text())}`)
})
page.on('response', response => {
  if (response.status() >= 400) errors.push(`${response.status()} ${redact(response.url())}`)
})
try {
  await page.addInitScript(() => {
    localStorage.setItem('terminator.settings.v1', JSON.stringify({quality: 'high', controlsSeen: true}))
  })
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').waitFor({state: 'visible', timeout: 30_000})
  await page.getByTestId('play').click()
  await page.waitForFunction(() => Boolean(window.terminator?.manager), undefined, {timeout: 60_000})
  await page.evaluate(() => {
    const manager = window.terminator.manager
    manager.ui.menuScene.setActive(false)
    manager.startViews()
    manager.director.step = () => {}
    manager.ui.screens.show(null)
    const viewer = window.viewer
    Object.assign(viewer.container.style, {
      position: 'fixed', left: '0', top: '0', width: '1920px', height: '1080px',
      maxWidth: 'none', maxHeight: 'none', zIndex: '2147483000',
    })
    viewer.setSize({width: 1920, height: 1080})
    viewer.renderManager.renderScale = 1
    viewer.resize()
  })
  await page.waitForFunction(() => window.terminator.manager.viewsStarted, undefined, {timeout: 60_000})
  await page.evaluate(() => window.terminator.manager.mapView.ready)
  await page.waitForTimeout(1200)
  const startupErrors = errors.splice(0)

  const flight = await page.evaluate(() => {
    const manager = window.terminator.manager
    const world = manager.world
    manager.ui.screens.show(null)
    manager.ui.menuScene.setActive(false)
    manager.director.step = () => {}
    manager.input?.stop()
    for (const unit of world.units) unit.brain?.destroy?.()
    world.units.length = 0
    world.unitById.clear()
    world.projectiles.length = 0
    world.eventLog.length = 0
    world.snapshotEventCursor = 0
    world.telemetry.units = {}
    manager.unitView.eventIndex = 0
    manager.playerView.weapons.worldFx.eventIndex = 0
    manager.playerView.weapons.animation.eventIndex = 0
    manager.cameraFeel.eventIndex = 0
    world.phase = 'wave'
    world.wave = 1
    manager.director.phase = 'wave'
    manager.director.wave = 1
    Object.assign(world.player.pos, {x: 0, y: 0, z: 9})
    Object.assign(world.player, {yaw: 0, pitch: 0.025, hp: 100, armor: 0, grenades: 4, alive: true})
    world.throwGrenade()
    for (let tick = 0; tick < 12; tick += 1) {
      world.step()
      manager.cameraFeel.consume(world)
      manager.syncViews()
    }
    const projectile = world.projectiles[0]
    const visual = manager.grenadeView.visuals.get(projectile.id)
    const meshes = []
    visual.object.traverse(object => {
      if (object.isMesh) meshes.push({
        name: object.name,
        maps: ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'].every(key => Boolean(object.material?.[key])),
      })
    })
    window.viewer.setDirty()
    return {projectile: structuredClone(projectile), meshes}
  })
  await page.waitForTimeout(80)
  await page.screenshot({path: new URL('grenade-in-flight.png', evidence).pathname})

  const blast = await page.evaluate(() => {
    const manager = window.terminator.manager
    const world = manager.world
    while (!world.eventLog.some(event => event.type === 'explosion')) {
      world.step()
      manager.cameraFeel.consume(world)
      manager.syncViews()
    }
    window.viewer.setDirty()
    const explosion = world.eventLog.find(event => event.type === 'explosion')
    return {
      explosion: structuredClone(explosion),
      projectilesRemaining: world.projectiles.length,
      visualsRemaining: manager.grenadeView.visuals.size,
      cameraShake: manager.cameraFeel.shake,
      unitHealth: Object.fromEntries(world.units.map(unit => [unit.id, unit.hp])),
    }
  })
  await page.waitForTimeout(50)
  await page.screenshot({path: new URL('grenade-explosion.png', evidence).pathname})

  const cleanup = await page.evaluate(() => {
    const manager = window.terminator.manager
    manager.stop()
    return {
      grenadeRootRemoved: !window.viewer.scene.getObjectByName('Grenade Projectiles Runtime'),
      playerRootRemoved: !window.viewer.scene.getObjectByName('Player Runtime'),
    }
  })
  const results = {flight, blast, cleanup, startupErrors, errors}
  await writeFile(new URL('results.json', evidence), `${JSON.stringify(results, null, 2)}\n`)
  if (!flight.meshes.length || flight.meshes.some(mesh => !mesh.maps)) throw new Error('Projectile PBR maps are incomplete')
  if (blast.projectilesRemaining !== 0 || blast.visualsRemaining !== 0 || blast.cameraShake <= 0 || blast.explosion.radius !== 4) throw new Error('Blast integration failed')
  if (!cleanup.grenadeRootRemoved || !cleanup.playerRootRemoved) throw new Error('Runtime cleanup failed')
  if (errors.length) throw new Error(`Browser reported ${errors.length} errors`)
  console.log(JSON.stringify({
    projectile: flight.projectile,
    explosion: blast.explosion,
    cameraShake: blast.cameraShake,
    cleanup,
    startupErrors,
    errors,
  }, null, 2))
} finally {
  await browser.close()
}
