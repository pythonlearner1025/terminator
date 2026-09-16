#!/usr/bin/env node
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'

const label = process.argv[2] || 'probe'
const directory = new URL(`../docs/evidence/play-culling/${label}-turn/`, import.meta.url)
const output = new URL('results.json', directory)
const dev = JSON.parse(await readFile(new URL('../.kite3d/dev.json', import.meta.url), 'utf8'))
const warnings = []
await mkdir(directory, {recursive: true})
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--no-sandbox'],
})

try {
  const page = await browser.newPage({viewport: {width: 1280, height: 720}, deviceScaleFactor: 1})
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) warnings.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', error => warnings.push(`pageerror: ${error.stack || error.message}`))
  await page.addInitScript(() => {
    localStorage.setItem('terminator.settings.v1', JSON.stringify({quality: 'high', controlsSeen: true}))
  })
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').waitFor({state: 'visible', timeout: 30_000})
  await page.waitForFunction(() => document.body.innerText.includes('Project loaded'), undefined, {timeout: 90_000})
  await page.getByTestId('play').click({timeout: 90_000})
  await page.waitForFunction(() => window.terminator?.manager?.started, undefined, {timeout: 90_000})
  await page.evaluate(async () => {
    const manager = window.terminator.manager
    const world = manager.world
    manager.capturePaused = true
    manager.input?.stop()
    for (const unit of world.units) unit.brain?.destroy?.()
    world.units.length = 0
    world.unitById.clear()
    world.nextUnitId = 1
    world.eventLog.length = 0
    world.snapshotEventCursor = 0
    world.telemetry.units = {}
    world.scaling.maxAlive = Math.max(world.maxAlive, 24)
    Object.assign(world.player.pos, {x: 0, y: 0, z: 0})
    world.player.yaw = 0
    world.player.pitch = 0
    world.player.hp = world.player.maxHp = 1e9
    world.player.alive = true
    // Hide authored references. The fixture measures only the live UnitView instances.
    window.viewer.scene.modelRoot.traverse(object => {
      if (object.userData?.rootPath?.startsWith('/kite3d/@unit-')) object.visible = false
    })
    for (let index = 0; index < 24; index += 1) {
      const angle = index * Math.PI * 2 / 24
      const type = ['scout', 'endo', 'heavy'][index % 3]
      const pos = {x: Math.sin(angle) * 12, y: 0, z: Math.cos(angle) * 12}
      const unit = world.spawnUnit(type, pos, {id: `turn-${type}-${index + 1}`, yaw: angle + Math.PI})
      unit.brain?.destroy?.()
      unit.brain = {tick() {}}
      unit.intent = {}
    }
    manager.syncViews()
    window.__turnProbe = {drawn: new Set(), prior: new Map()}
    for (const [id, visual] of manager.unitView.visuals) {
      const mesh = visual.rig.mesh
      const previous = mesh.onBeforeRender
      window.__turnProbe.prior.set(mesh, previous)
      mesh.onBeforeRender = function(...args) {
        window.__turnProbe.drawn.add(id)
        previous?.apply(this, args)
      }
    }
    Object.assign(window.viewer.container.style, {
      position: 'fixed', left: '0', top: '0', width: '1280px', height: '720px',
      maxWidth: 'none', maxHeight: 'none', zIndex: '2147483000',
    })
    window.viewer.setSize({width: 1280, height: 720})
    window.viewer.renderManager.renderScale = 1
    window.viewer.resize()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await page.waitForFunction(() => window.terminator.manager.unitView.visuals.size === 24, undefined, {timeout: 20_000})
  await page.waitForTimeout(1_000)

  const bounds = await page.evaluate(() => [...window.terminator.manager.unitView.visuals].slice(0, 6).map(([id, visual]) => {
    const mesh = visual.rig.mesh
    mesh.updateMatrixWorld(true)
    const world = mesh.boundingSphere?.clone().applyMatrix4(mesh.matrixWorld)
    return {id, objectPosition: visual.object.position.toArray(), meshPosition: mesh.position.toArray(),
      meshWorldPosition: mesh.getWorldPosition(mesh.position.clone()).toArray(),
      objectBounds: mesh.boundingSphere && {center: mesh.boundingSphere.center.toArray(), radius: mesh.boundingSphere.radius},
      worldBounds: world && {center: world.center.toArray(), radius: world.radius},
      geometryBounds: mesh.geometry.boundingSphere && {center: mesh.geometry.boundingSphere.center.toArray(), radius: mesh.geometry.boundingSphere.radius},
      intendedBounds: {center: [visual.object.position.x, visual.object.position.y + 2, visual.object.position.z], radius: 2.5}}
  }))

  const samples = []
  for (let degrees = 0; degrees < 360; degrees += 30) {
    const sample = await page.evaluate(async degrees => {
      const manager = window.terminator.manager
      const camera = window.viewer.scene.mainCamera
      const yaw = degrees * Math.PI / 180
      manager.world.player.yaw = yaw
      manager.playerView.sync(manager.world)
      manager.unitView.sync(manager.world)
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld(true)
      const matrix = new camera.projectionMatrix.constructor().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      const frustum = new manager.unitView.frustum.constructor().setFromProjectionMatrix(matrix)
      const sphere = new manager.unitView.cullSphere.constructor()
      const expected = []
      for (const unit of manager.world.units) {
        sphere.center.set(unit.pos.x, unit.pos.y + 2, unit.pos.z)
        sphere.radius = 2.5
        if (frustum.intersectsSphere(sphere)) expected.push(unit.id)
      }
      window.__turnProbe.drawn.clear()
      window.viewer.setDirty()
      await new Promise(resolve => {
        const done = () => {
          window.viewer.removeEventListener('postRender', done)
          resolve()
        }
        window.viewer.addEventListener('postRender', done)
      })
      const drawn = [...window.__turnProbe.drawn]
      const missing = expected.filter(id => !window.__turnProbe.drawn.has(id))
      return {degrees, expected: expected.length, drawnExpected: expected.length - missing.length,
        totalDrawn: drawn.length, missing, expectedIds: expected, drawnIds: drawn}
    }, degrees)
    samples.push(sample)
    if (degrees % 90 === 0) {
      await page.screenshot({path: fileURLToPath(new URL(`yaw-${String(degrees).padStart(3, '0')}.png`, directory))})
    }
  }

  const frame = await page.evaluate(async () => {
    const manager = window.terminator.manager
    const viewer = window.viewer
    const cpu = []
    const intervals = []
    const calls = []
    const triangles = []
    let started = 0
    let prior = 0
    const onPreFrame = () => { started = performance.now() }
    const onPostFrame = () => {
      if (started) cpu.push(performance.now() - started)
      calls.push(viewer.renderManager.webglRenderer.info.render.calls)
      triangles.push(viewer.renderManager.webglRenderer.info.render.triangles)
    }
    viewer.addEventListener('preFrame', onPreFrame)
    viewer.addEventListener('postFrame', onPostFrame)
    await new Promise(resolve => {
      let count = 0
      const step = now => {
        if (prior) intervals.push(now - prior)
        prior = now
        manager.world.player.yaw = count * Math.PI * 2 / 360
        viewer.setDirty()
        count += 1
        if (count >= 360) resolve()
        else requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
    viewer.removeEventListener('preFrame', onPreFrame)
    viewer.removeEventListener('postFrame', onPostFrame)
    const summary = values => {
      const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
      const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
      return {samples: sorted.length, mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
        p50: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1)}
    }
    return {intervalMs: summary(intervals), cpuMs: summary(cpu.slice(2)), calls: summary(calls.slice(2)),
      triangles: summary(triangles.slice(2)), units: manager.world.units.length}
  })
  const result = {label, capturedAt: new Date().toISOString(), bounds: roundDeep(bounds), samples, frame: roundDeep(frame), warnings}
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}

function roundDeep(value) {
  if (typeof value === 'number') return Number(value.toFixed(3))
  if (Array.isArray(value)) return value.map(roundDeep)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundDeep(item)]))
  return value
}
