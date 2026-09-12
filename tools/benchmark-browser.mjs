#!/usr/bin/env node
import {spawn} from 'node:child_process'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'

const root = new URL('../', import.meta.url)
const options = parseOptions(process.argv.slice(2))
const warnings = []
let server = null
let browser = null

try {
  const dev = await ensureDevServer()
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-angle=metal'],
  })
  const page = await browser.newPage({
    viewport: {width: options.width, height: options.height},
    deviceScaleFactor: 1,
  })
  const sanitize = value => String(value).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]')
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) warnings.push(`${message.type()}: ${sanitize(message.text())}`)
  })
  page.on('pageerror', error => warnings.push(`pageerror: ${sanitize(error.stack || error.message)}`))
  page.on('response', response => {
    if (response.status() >= 400) warnings.push(`response ${response.status()} ${response.request().method()}: ${sanitize(response.url())}`)
  })
  await page.addInitScript(() => {
    localStorage.setItem('terminator.settings.v1', JSON.stringify({quality: 'high', controlsSeen: true}))
  })
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').waitFor({state: 'visible', timeout: 30_000})
  await page.getByTestId('play').click()
  await page.waitForFunction(() => Boolean(window.terminator?.manager?.world), undefined, {timeout: 45_000})
  await page.waitForFunction(() => Boolean(window.terminator?.manager?.ui?.menuScene?.root)
    && window.terminator.manager.ui.screens?.route === 'main', undefined, {timeout: 45_000})
  await page.waitForFunction(() => {
    const root = window.viewer?.scene?.modelRoot
    if (!root) return false
    const materials = []
    root.traverse(object => {
      const list = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of list) if (material && !materials.includes(material)) materials.push(material)
    })
    const environments = materials.map(material => material.envMap).filter(Boolean)
    return environments.length > 0 && environments.every(texture => (texture.image?.height || texture.source?.data?.height || 0) > 1)
  }, undefined, {timeout: 20_000})
  await page.evaluate(() => {
    window.viewer.scene.modelRoot.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) if (material?.envMap) material.needsUpdate = true
    })
  })

  await page.evaluate(async ({width, height}) => {
    const manager = window.terminator.manager
    const {viewer} = window
    Object.assign(viewer.container.style, {
      position: 'fixed', left: '0', top: '0', width: `${width}px`, height: `${height}px`,
      maxWidth: 'none', maxHeight: 'none', zIndex: '2147483000',
    })
    viewer.setSize({width, height})
    viewer.renderManager.renderScale = 1
    viewer.resize()
    if (!manager.viewsStarted) {
      manager.ui?.menuScene?.setActive(false)
      manager.startViews()
      await manager.visualWarmup
      for(let attempts=0;attempts<120&&!manager.audio;attempts++)await new Promise(resolve=>requestAnimationFrame(resolve))
      await manager.audio?.unlock()
      manager.director.start()
      manager.ui?.screens?.show(null)
    }
    await manager.mapView.ready
  }, {width: options.width, height: options.height})
  await page.waitForFunction(({width, height}) => {
    const rect = window.viewer?.canvas?.getBoundingClientRect()
    return rect && Math.round(rect.width) === width && Math.round(rect.height) === height
  }, {width: options.width, height: options.height}, {timeout: 10_000})

  const setup = await page.evaluate(async ({motionBlur, disable}) => {
    const manager = window.terminator.manager
    const world = manager.world
    for (const unit of world.units) unit.brain?.destroy?.()
    world.units.length = 0
    world.unitById.clear()
    world.nextUnitId = 1
    world.eventLog.length = 0
    world.snapshotEventCursor = 0
    world.telemetry.units = {}
    manager.unitView.eventIndex = 0
    const player = world.player
    Object.assign(player.pos, {x: 0, y: 0, z: 17})
    player.yaw = Math.PI
    player.pitch = 0
    player.hp = 1e9
    player.maxHp = 1e9
    player.armor = 1e9
    player.alive = true
    player.activeWeapon = 'm4'
    player.aiming = true
    player.ammo.m4.owned = true
    player.ammo.m4.mag = 30
    player.ammo.m4.reserve = 240
    const positions = []
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 6; column += 1) {
        positions.push({x: (column - 2) * 1.1, y: 0, z: 13 - row * 1.5})
      }
    }
    for (let index = 0; index < positions.length; index += 1) {
      const type = ['scout', 'endo', 'heavy'][index % 3]
      const pos = positions[index]
      const yaw = Math.atan2(player.pos.x - pos.x, player.pos.z - pos.z)
      const unit = world.spawnUnit(type, pos, {id: `benchmark-${type}-${index + 1}`, yaw})
      unit.brain?.destroy?.()
      unit.brain = {tick() {}}
      unit.intent.aimAt = {...player.pos, y: 1.65}
      unit.intent.fire = type !== 'scout'
      unit.reactionReadyTick = 0
    }
    world.mapState.gates = world.map.spawnGates.map(gate => gate.id)
    for (const key of Object.keys(world.mapState.lights)) world.mapState.lights[key] = 'on'
    world.mapState.hazards = world.map.hazardSlots.slice(0, 2).map((slot, index) => ({slot: slot.id, kind: index ? 'steam' : 'electric'}))
    manager.mapView.refs.weather.settings.rain = 1
    manager.mapView.refs.weather.settings.smoke = 1
    manager.mapView.post.settings.motionBlur = motionBlur
    if (disable.includes('post')) {
      for (const pass of manager.ctx.viewer.renderManager.passes) if (!['render', 'screen'].includes(pass.passId)) pass.enabled = false
    } else if (disable.includes('ssao')) {
      for (const pass of manager.ctx.viewer.renderManager.passes) if (['gbuffer', 'ssao'].includes(pass.passId)) pass.enabled = false
    }
    if (disable.includes('shadow')) {
      manager.ctx.viewer.renderManager.webglRenderer.shadowMap.enabled = false
      manager.mapView.root.traverse(object => { if (object.isLight) object.castShadow = false })
    }
    if (disable.includes('weather')) manager.mapView.refs.weather.root.visible = false
    if (disable.includes('lights')) manager.mapView.root.traverse(object => {
      if (object.isPointLight || object.isSpotLight) object.visible = false
    })
    if (disable.includes('units')) manager.unitView.root.visible = false
    manager.director.step = inputs => world.step(inputs)
    manager.input?.stop()
    manager.input.yaw=player.yaw;manager.input.pitch=player.pitch
    manager.input.cursorAnchorYaw=player.yaw;manager.input.cursorAnchorPitch=player.pitch
    manager.ui?.screens?.show(null)
    // Keep newly cloned PBR units out of the first renderer traversal until the
    // shared HDR environment has real dimensions. Older builds created the
    // material before RGBELoader completed, which made a baseline depend on a
    // shader compilation race instead of measuring the same rendered scene.
    manager.unitView.root.visible = false
    manager.syncViews()
    const started = performance.now()
    while ((manager.unitView.materials?.environment?.image?.height || manager.unitView.materials?.environment?.source?.data?.height || 0) <= 1) {
      if (performance.now() - started > 20_000) throw new Error('Unit PBR environment did not finish loading')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    window.viewer.scene.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) if (material?.envMap) material.needsUpdate = true
    })
    manager.unitView.root.visible = !disable.includes('units')
    window.viewer.setDirty()
    return {units: world.aliveUnits.length, quality: manager.ui?.screens?.settings?.quality || 'high', disabled: disable,
      visualWarmup: manager.visualWarmupReport || null, audio: manager.audio ? {loading:Boolean(manager.audio.loading),decoded:manager.audio.stats.loaded} : null}
  }, {motionBlur: options.motionBlur, disable: options.disable})

  await page.waitForFunction(() => window.terminator.manager.unitView.visuals.size === 24, undefined, {timeout: 20_000})
  await page.waitForTimeout(options.warmupSeconds * 1000)
  warnings.length = 0
  const metrics = await page.evaluate(collectMetrics, {seconds: options.seconds, ragdollDeaths: options.ragdolls, goreStress: options.goreStress})
  const scene = await page.evaluate(() => {
    const {viewer} = window
    const manager = window.terminator.manager
    const camera = viewer.scene.mainCamera
    camera.updateMatrixWorld(true)
    const visibleEnemies = [...manager.unitView.visuals.values()].filter(visual => {
      const point = visual.object.position.clone()
      point.y += 1
      point.project(camera)
      return point.z > -1 && point.z < 1 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1
    }).length
    const key = manager.mapView.root.getObjectByName('Map moon shadow key')
    return {
      aliveEnemies: manager.world.aliveUnits.length,
      renderedEnemies: manager.unitView.visuals.size,
      enemiesInFrustum: visibleEnemies,
      renderScale: viewer.renderManager.renderScale,
      renderSize: viewer.renderManager.renderSize.toArray(),
      canvas: (() => { const r = viewer.canvas.getBoundingClientRect(); return {width: r.width, height: r.height} })(),
      shadowMap: key ? {width: key.shadow.mapSize.width, height: key.shadow.mapSize.height, radius: key.shadow.radius} : null,
      unitTriangles: Object.fromEntries(Object.entries(manager.unitView.runtimeTemplates).map(([type, object]) => [type, {
        high: object.userData.unitAnatomy?.triangles || 0,
        low: manager.unitView.runtimeFarTemplates[type]?.userData.unitAnatomy?.triangles || 0,
      }])),
      quality: manager.performanceQuality || null,
    }
  })
  if (options.screenshot) {
    // Keep benchmark-only invulnerability values from overflowing the shipping
    // HUD in the visual evidence. This happens after all timed samples.
    await page.evaluate(() => {
      const player = window.terminator.manager.world.player
      player.hp = player.maxHp = 100
      player.armor = 100
    })
    await page.waitForTimeout(100)
    const path = resolve(options.screenshot)
    await mkdir(new URL(`file://${path.slice(0, path.lastIndexOf('/') + 1)}`), {recursive: true})
    await page.screenshot({path, clip: {x: 0, y: 0, width: options.width, height: options.height}})
  }
  const result = {
    benchmark: 'Terminator browser performance',
    capturedAt: new Date().toISOString(),
    durationSeconds: options.seconds,
    warmupSeconds: options.warmupSeconds,
    requestedViewport: {width: options.width, height: options.height, deviceScaleFactor: 1},
    effects: {post: !options.disable.includes('post'), motionBlur: options.motionBlur, rain: 1, smoke: 1,
      hazards: ['electric', 'steam'], combatStress: `24 enemies, two enemy shots per frame, ten impact bursts per second, ${options.ragdolls} deterministic ${options.goreStress?"gore":"M4"} death(s), limb loss, and explosion events`, disabled: options.disable},
    browser: metrics.browser,
    setup,
    scene,
    frame: metrics.frame,
    gpu: metrics.gpu,
    renderer: metrics.renderer,
    textureMemory: metrics.textureMemory,
    postPasses: metrics.postPasses,
    systems: metrics.systems,
    ragdolls: metrics.ragdolls,
    gore: metrics.gore,
    topCosts: metrics.topCosts,
    worstFrames: metrics.worstFrames,
    eventFrames: metrics.eventFrames,
    workloadFpsFloor: metrics.workloadFpsFloor,
    warnings: [...new Set(warnings)],
    screenshot: options.screenshot || null,
  }
  const json = `${JSON.stringify(result, null, 2)}\n`
  if (options.output) {
    const path = resolve(options.output)
    await mkdir(new URL(`file://${path.slice(0, path.lastIndexOf('/') + 1)}`), {recursive: true})
    await writeFile(path, json)
  }
  process.stdout.write(json)
  const expectedAlive=options.ragdolls===1?24:24-options.ragdolls
  if(scene.aliveEnemies!==expectedAlive||scene.renderedEnemies!==24)process.exitCode=1
  if (result.warnings.length) process.exitCode = 1
} catch (error) {
  process.stderr.write(`${String(error?.stack || error).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]')}\n`)
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  if (server) {
    server.kill('SIGTERM')
    await Promise.race([new Promise(resolveExit => server.once('exit', resolveExit)), delay(5_000)])
  }
}

function parseOptions(argv) {
  const value = (name, fallback) => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
  return {
    width: Number(value('width', 1920)),
    height: Number(value('height', 1080)),
    seconds: Number(value('seconds', 10)),
    warmupSeconds: Number(value('warmup', 3)),
    port: Number(value('port', 4660)),
    output: value('output', ''),
    screenshot: value('screenshot', ''),
    ragdolls: Math.max(1,Math.min(8,Math.round(Number(value('ragdolls',1))))),
    goreStress: value('gore','off') === 'on',
    motionBlur: value('motion-blur', 'on') !== 'off',
    disable: value('disable', '').split(',').filter(Boolean),
  }
}

async function ensureDevServer() {
  const file = new URL('.kite3d/dev.json', root)
  const existing = await readDev(file)
  if (existing?.origin === `http://127.0.0.1:${options.port}` && await reachable(existing.url)) return existing
  server = spawn('npx', ['kite3d', 'dev', '--port', String(options.port), '--no-open'], {
    cwd: new URL('.', root), stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  server.stdout.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000) })
  server.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000) })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`kite3d dev exited ${server.exitCode}: ${redact(diagnostics)}`)
    const dev = await readDev(file)
    if (dev?.origin === `http://127.0.0.1:${options.port}` && await reachable(dev.url)) return dev
    await delay(150)
  }
  throw new Error(`kite3d dev did not become ready on port ${options.port}: ${redact(diagnostics)}`)
}

async function readDev(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return null }
}
async function reachable(origin) {
  try { return (await fetch(origin, {signal: AbortSignal.timeout(500)})).ok } catch { return false }
}
function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)) }
function redact(value) { return String(value).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]') }

async function collectMetrics({seconds,ragdollDeaths=1,goreStress=false}) {
  const round = value => Number.isFinite(value) ? Number(value.toFixed(3)) : null
  const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const summary = values => {
    if (!values.length) return {samples: 0, mean: null, p50: null, p95: null, p99: null, max: null}
    const sorted = [...values].sort((a, b) => a - b)
    const at = quantile => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]
    return {samples: values.length, mean: round(mean(values)), p50: round(at(.5)), p95: round(at(.95)), p99: round(at(.99)), max: round(sorted.at(-1))}
  }
  const inspectTextureMemory = currentViewer => {
    const textures = new Set(), visited = new WeakSet()
    const visit = (value, depth = 0) => {
      if (!value || depth > 5) return
      if (value.isTexture) { textures.add(value); return }
      if (typeof value !== 'object' || visited.has(value)) return
      visited.add(value)
      if (value.isObject3D) {
        if (Array.isArray(value.material)) value.material.forEach(material => visit(material, depth + 1))
        else visit(value.material, depth + 1)
        return
      }
      if (value.isWebGLRenderTarget) {
        visit(value.texture, depth + 1); visit(value.depthTexture, depth + 1); return
      }
      if (ArrayBuffer.isView(value) || value instanceof WebGLRenderingContext || typeof WebGL2RenderingContext !== 'undefined' && value instanceof WebGL2RenderingContext) return
      for (const key of Object.keys(value)) {
        if (['parent', 'children', 'domElement', '_listeners', 'renderer', 'viewer', 'scene'].includes(key)) continue
        visit(value[key], depth + 1)
      }
    }
    currentViewer.scene.traverse(object => visit(object))
    visit(currentViewer.scene.environment); visit(currentViewer.scene.background)
    visit(currentViewer.renderManager.composerTarget); visit(currentViewer.renderManager.composerTarget2)
    for (const pass of currentViewer.renderManager.passes) visit(pass)
    const records = [...textures].map(texture => {
      const source = texture.source?.data || texture.image
      const images = Array.isArray(source) ? source : [source]
      let bytes = 0, width = 0, height = 0
      for (const image of images) {
        const w = image?.width || image?.videoWidth || image?.data?.width || 0
        const h = image?.height || image?.videoHeight || image?.data?.height || 0
        width = Math.max(width, w); height = Math.max(height, h)
        const channels = /RedFormat/.test(String(texture.format)) ? 1 : 4
        const bytesPerChannel = /HalfFloatType/.test(String(texture.type)) ? 2 : /FloatType/.test(String(texture.type)) ? 4 : 1
        bytes += w * h * channels * bytesPerChannel * (texture.generateMipmaps ? 4 / 3 : 1)
      }
      return {name: texture.name || 'unnamed', width, height, bytes: Math.round(bytes)}
    })
    records.sort((a, b) => b.bytes - a.bytes)
    const bytes = records.reduce((sum, item) => sum + item.bytes, 0)
    return {textures: records.length, bytes, mebibytes: round(bytes / 1048576), largest: records.slice(0, 8)}
  }
  const viewer = window.viewer
  const manager = window.terminator.manager
  const renderManager = viewer.renderManager
  const renderer = renderManager.webglRenderer
  const gl = renderer.getContext()
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  const frameIntervals = [], frameWork = [], drawCalls = [], triangles = [], points = [], lines = [], frameRecords = []
  const systemStats = new Map(), passStats = new Map(), restores = []
  let renderTotals = {calls: 0, triangles: 0, points: 0, lines: 0}
  let frameStart = 0, lastFrame = 0, collecting = false, activeQuery = null, effectFrame = 0, frameSerial = -1, maxActiveRagdolls = 0, maxActivePieces = 0
  let programs = renderer.info.programs?.length || 0, priorHeap = performance.memory?.usedJSHeapSize || 0
  const pendingQueries = [], gpuSamples = []
  const combatIds=[...manager.unitView.visuals.keys()]
  const primary=manager.world.unitById.get('benchmark-heavy-3')
  const deathTargets=[primary,...manager.world.units.filter(unit=>unit!==primary)].slice(0,ragdollDeaths)
  const combatFrom = manager.unitView.v1.clone(), combatTo = manager.unitView.v2.clone(), combatHit = manager.unitView.v1.clone()
  const firstEvents = new Set()
  const currentRecord = () => frameRecords[frameSerial]
  const mark = (name, detail = '') => {
    const frame = currentRecord()
    if (!collecting || !frame) return
    const label = detail ? `${name}: ${detail}` : name
    if (!frame.events.includes(label)) frame.events.push(label)
  }
  const markFirst = (name, detail = '') => {
    if (firstEvents.has(name)) return
    firstEvents.add(name); mark(name, detail)
  }
  const record = (stats, name, duration) => {
    const item = stats.get(name) || {calls: 0, totalMs: 0, maxMs: 0}
    item.calls += 1; item.totalMs += duration; item.maxMs = Math.max(item.maxMs, duration); stats.set(name, item)
    const frame = currentRecord()
    if (collecting && frame) frame.costs[name] = (frame.costs[name] || 0) + duration
  }
  const wrap = (target, key, name, stats = systemStats, after) => {
    if (!target || typeof target[key] !== 'function') return
    const original = target[key]
    target[key] = function (...args) {
      const start = performance.now()
      try { return original.apply(this, args) } finally {
        if (collecting) {
          record(stats, name, performance.now() - start)
          after?.()
        }
      }
    }
    restores.push(() => { target[key] = original })
  }
  wrap(manager.mapView, 'sync', 'map')
  wrap(manager.unitView, 'sync', 'units')
  wrap(manager.playersView, 'sync', 'players')
  wrap(manager.playerView, 'sync', 'player')
  wrap(manager.playerView?.weapons, 'sync', 'weapons')
  wrap(manager.mapView?.refs?.weather, 'sync', 'weather')
  wrap(manager.unitView?.fx, 'update', 'fx')
  wrap(manager.unitView?.ragdolls,'update','ragdolls')
  wrap(manager.unitView?.fx?.gore,'update','gore')
  wrap(manager.unitView?.fx?.gore,'detach','gore detachment')
  wrap(manager.unitView?.fx?.gore,'deform','mesh deformation')
  wrap(manager.playersView?.fx, 'update', 'fx')
  wrap(manager.playerView?.weapons?.fx, 'update', 'fx')
  wrap(manager.hud, 'render', 'HUD')
  wrap(manager.hud, 'sync', 'HUD')
  wrap(manager.unitView?.fx, 'damage', 'unit damage', systemStats, () => {
    markFirst('first hit'); markFirst('first decal')
  })
  wrap(manager.unitView?.fx, 'sever', 'limb separation', systemStats, () => markFirst('limb loss'))
  wrap(manager.unitView?.fx, 'wreck', 'wreck effect', systemStats, () => markFirst('wreck spawn'))
  wrap(manager.audio, '_play', 'audio start', systemStats, () => markFirst('audio start'))
  wrap(renderer, 'compile', 'renderer compile', systemStats, () => markFirst('shader compile', 'explicit compile'))
  wrap(renderer, 'compileAsync', 'renderer compile async', systemStats, () => markFirst('shader compile', 'explicit compileAsync'))
  wrap(renderer, 'initTexture', 'texture upload', systemStats, () => markFirst('texture upload'))
  for (const pass of renderManager.passes) wrap(pass, 'render', pass.passId || pass.constructor?.name || 'post-pass', passStats)
  const originalRendererRender = renderer.render
  renderer.render = function (...args) {
    const value = originalRendererRender.apply(this, args)
    if (collecting) {
      const info = renderer.info.render
      renderTotals.calls += info.calls
      renderTotals.triangles += info.triangles
      renderTotals.points += info.points
      renderTotals.lines += info.lines
    }
    return value
  }
  restores.push(() => { renderer.render = originalRendererRender })

  const pollQueries = () => {
    if (!timer) return
    for (let index = pendingQueries.length - 1; index >= 0; index -= 1) {
      const query = pendingQueries[index]
      if (!gl.getQueryParameter(query.handle, gl.QUERY_RESULT_AVAILABLE)) continue
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(query.handle, gl.QUERY_RESULT) / 1e6
        gpuSamples.push(ms)
        if (frameRecords[query.frame]) frameRecords[query.frame].gpuMs = ms
      }
      gl.deleteQuery(query.handle); pendingQueries.splice(index, 1)
    }
  }
  const onPreFrame = () => {
    const now = performance.now()
    frameStart = now
    if (collecting) {
      frameSerial += 1
      const intervalMs = lastFrame ? now - lastFrame : null
      if (intervalMs !== null) frameIntervals.push(intervalMs)
      frameRecords.push({frame: frameSerial, intervalMs, workMs: null, gpuMs: null, events: [], costs: {}})
      const heap = performance.memory?.usedJSHeapSize || 0
      if (priorHeap && heap < priorHeap - 1024 * 1024) mark('GC', `${round((priorHeap - heap) / 1048576)} MiB reclaimed`)
      priorHeap = heap
    }
    lastFrame = now
    if (collecting && combatIds.length && manager.unitView.fx) {
      const started = performance.now()
      for (let offset = 0; offset < 2; offset += 1) {
        const visual=manager.unitView.visuals.get(combatIds[(effectFrame*2+offset)%combatIds.length])
        if(!visual)continue
        const muzzle = visual.rig.joints.Muzzle
        if (muzzle) muzzle.getWorldPosition(combatFrom)
        else combatFrom.copy(visual.object.position).setY(1.55)
        combatTo.set(manager.world.player.pos.x, manager.world.player.pos.y + 1.4, manager.world.player.pos.z)
        manager.unitView.fx.shot(combatFrom, combatTo, visual.rig.joints.Barrels ? 'heavy' : 'endo')
        visual.rig.recoil = 1
      }
      if (effectFrame % 6 === 0) {
        const visual=manager.unitView.visuals.get(combatIds[effectFrame%combatIds.length])
        if(visual){
          combatHit.copy(visual.object.position).setY(1.1)
          manager.unitView.fx.hit(combatHit,effectFrame,undefined,visual.object.position.y)
        }
      }
      record(systemStats, 'combat effects', performance.now() - started)
      const deathOffset=effectFrame-8
      const deathIndex=deathOffset>=0&&deathOffset%6===0?deathOffset/6:-1
      if(deathIndex>=0&&deathIndex<deathTargets.length) {
        const world=manager.world,target=deathTargets[deathIndex]
        if (target?.alive) {
          const eventStart = world.eventLog.length
          const weapon=goreStress?(deathIndex<2?'m4':deathIndex===2?'shotgun':'grenade'):'m4'
          const headshot=goreStress&&deathIndex<2
          world.damageUnit(target.id,target.hp,{source:'player',playerId:world.player.id,weapon,distance:4,headshot})
          if(goreStress) {
            const v=manager.unitView.visuals.get(target.id),part=headshot?'Head':deathIndex===2?'Upper Arm Right':'Chest'
            v.rig.joints[part].getWorldPosition(combatHit);combatHit.z+=.1
            for(let i=eventStart;i<world.eventLog.length;i++) {
              const e=world.eventLog[i]
              if(e.type==='unit_damage'||e.type==='kill')Object.assign(e,{part,pos:{x:combatHit.x,y:combatHit.y,z:combatHit.z},direction:{x:.1,y:.1,z:-1},normal:{x:-.1,y:-.1,z:1}})
            }
          }
          world.emit('shot',{by:world.player.id,playerId:world.player.id,weapon:'m4',hit:true,headshot:false,killed:true,unitId:target.id,
            origin:{...world.player.pos,y:world.player.pos.y+1.65}})
          mark(`${goreStress?"gore":"M4"} kill ${deathIndex+1}`);markFirst('first shot','M4');manager.syncViews();manager.audioBindings?.sync(world)
          const emitted = world.eventLog.slice(eventStart)
          if (emitted.some(event => event.type === 'unit_death')) markFirst('first death', 'M4 kill')
        }
      }
      if (effectFrame === 24) {
        const world = manager.world, target = world.unitById.get(goreStress?'benchmark-heavy-24':'benchmark-heavy-6')
        if (target?.alive) {
          const from=world.eventLog.length
          world.damageUnit(target.id, goreStress?target.maxHp*.6:140, {source: 'player', playerId: world.player.id, weapon: 'plasma'})
          if(goreStress) {
            manager.unitView.visuals.get(target.id).rig.joints['Thigh Left'].getWorldPosition(combatHit);combatHit.y-=.15
            Object.assign(world.eventLog[from],{part:'Thigh Left',pos:{x:combatHit.x,y:combatHit.y,z:combatHit.z},direction:{x:-.5,y:.2,z:-1},normal:{x:.5,y:-.2,z:1}})
          }
          manager.syncViews(); manager.audioBindings?.sync(world)
        }
      }
      if (effectFrame === 40) {
        const world = manager.world
        world.emit('explosion', {by: world.player.id, playerId: world.player.id, pos: {x: 0, y: .05, z: 10}, hit: true})
        manager.syncViews(); manager.audioBindings?.sync(world)
        mark('explosion')
      }
      if(ragdollDeaths===1&&effectFrame===72) {
        const target = manager.world.unitById.get('benchmark-heavy-3')
        if (target && !target.alive) {
          target.alive = true; target.hp = target.maxHp; target.diedAtTick = null
          manager.syncViews()
        }
      }
      effectFrame += 1
    }
  }
  const onPostFrame = () => {
    if (!collecting || !frameStart) return
    const workMs = performance.now() - frameStart
    frameWork.push(workMs)
    const frame = currentRecord()
    if (frame) workMs > (frame.workMs || 0) && (frame.workMs = workMs)
    maxActiveRagdolls=Math.max(maxActiveRagdolls,manager.unitView.ragdolls?.activeCount('unit')||0)
    maxActivePieces=Math.max(maxActivePieces,manager.unitView.ragdolls?.activeCount('limb')||0)
  }
  const onPreRender = () => {
    renderTotals = {calls: 0, triangles: 0, points: 0, lines: 0}
    if (!collecting || !timer || activeQuery) return
    pollQueries()
    if (pendingQueries.length >= 8) return
    activeQuery = {handle: gl.createQuery(), frame: frameSerial}
    gl.beginQuery(timer.TIME_ELAPSED_EXT, activeQuery.handle)
  }
  const onPostRender = () => {
    if (!collecting) return
    if (activeQuery) {
      gl.endQuery(timer.TIME_ELAPSED_EXT)
      pendingQueries.push(activeQuery)
      activeQuery = null
    }
    const programList = renderer.info.programs || []
    const nextPrograms = programList.length
    if (nextPrograms > programs) {
      const variants=programList.slice(programs).map(program=>{
        const diagnostics=program.diagnostics||{}
        return String(program.name||diagnostics.material?.name||program.cacheKey||'unnamed').slice(0,80)
      })
      markFirst('shader compile', `${nextPrograms - programs} program(s): ${variants.join(', ')}`)
    }
    programs = nextPrograms
    drawCalls.push(renderTotals.calls); triangles.push(renderTotals.triangles); points.push(renderTotals.points); lines.push(renderTotals.lines)
  }
  viewer.addEventListener('preFrame', onPreFrame)
  viewer.addEventListener('postFrame', onPostFrame)
  viewer.addEventListener('preRender', onPreRender)
  viewer.addEventListener('postRender', onPostRender)
  collecting = true
  await new Promise(resolveMeasure => setTimeout(resolveMeasure, seconds * 1000))
  collecting = false
  if (activeQuery) { gl.endQuery(timer.TIME_ELAPSED_EXT); pendingQueries.push(activeQuery); activeQuery = null }
  for (let attempts = 0; timer && pendingQueries.length && attempts < 120; attempts += 1) {
    pollQueries()
    if (pendingQueries.length) await new Promise(resolveFrame => requestAnimationFrame(resolveFrame))
  }
  for (const query of pendingQueries) gl.deleteQuery(query.handle)
  viewer.removeEventListener('preFrame', onPreFrame)
  viewer.removeEventListener('postFrame', onPostFrame)
  viewer.removeEventListener('preRender', onPreRender)
  viewer.removeEventListener('postRender', onPostRender)
  for (const restore of restores.reverse()) restore()

  const frames = Math.min(frameIntervals.length, frameWork.length)
  const summarizeStats = stats => Object.fromEntries([...stats].map(([name, item]) => [name, {
    calls: item.calls,
    msPerFrame: round(item.totalMs / Math.max(1, frames)),
    meanCallMs: round(item.totalMs / Math.max(1, item.calls)),
    maxCallMs: round(item.maxMs),
  }]))
  const systems = summarizeStats(systemStats)
  const postPasses = summarizeStats(passStats)
  const ranked = [
    ...Object.entries(systems).map(([name, item]) => ({area: `system:${name}`, msPerFrame: item.msPerFrame})),
    ...Object.entries(postPasses).map(([name, item]) => ({area: `pass:${name}`, msPerFrame: item.msPerFrame})),
  ].sort((a, b) => b.msPerFrame - a.msPerFrame).slice(0, 5)
  const usefulFrames = frameRecords.filter(frame => frame.workMs !== null || frame.gpuMs !== null)
  const describeFrame = frame => {
    const costs = Object.entries(frame.costs).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([area, ms]) => ({area, ms: round(ms)}))
    return {...frame, intervalMs: round(frame.intervalMs), workMs: round(frame.workMs), gpuMs: round(frame.gpuMs), costs,
      cause: frame.events.length ? frame.events.join(', ') : (costs[0]?.area || 'steady rendering')}
  }
  const worstFrames = usefulFrames.sort((a, b) => Math.max(b.workMs || 0, b.gpuMs || 0) - Math.max(a.workMs || 0, a.gpuMs || 0))
    .slice(0, 10).map(describeFrame)
  const eventFrames = frameRecords.filter(frame => frame.events.length).map(describeFrame)
  const cpuP99 = summary(frameWork).p99, gpuP99 = timer ? summary(gpuSamples).p99 : null
  const workloadFpsFloor = round(1000 / Math.max(cpuP99 || 0, gpuP99 || 0))
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    browser: {
      userAgent: navigator.userAgent,
      gpuVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      gpuRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      webgl: gl.constructor.name,
    },
    frame: {samples: frames, intervalMs: summary(frameIntervals), workMs: summary(frameWork), effectiveFps: round(1000 / mean(frameIntervals))},
    gpu: {supported: Boolean(timer), samples: gpuSamples.length, frameMs: timer ? summary(gpuSamples) : null, unresolvedQueries: pendingQueries.length},
    renderer: {
      drawCalls: summary(drawCalls), triangles: summary(triangles), points: summary(points), lines: summary(lines),
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    },
    textureMemory: inspectTextureMemory(viewer),
    postPasses,
    systems,
    ragdolls:{requestedDeaths:ragdollDeaths,maxActive:maxActiveRagdolls,viewCpuMeanMs:systems.ragdolls?.meanCallMs??null,
      viewCpuMaxMs:systems.ragdolls?.maxCallMs??null},
    gore:{stress:goreStress,maxActivePieces,pieceCapacity:manager.unitView.fx.gore?.pieces.items.length||0,meanMs:systems.gore?.meanCallMs||0,stats:manager.unitView.fx.gore?.stats||null},
    topCosts: ranked,
    worstFrames,
    eventFrames,
    workloadFpsFloor,
  }
}

function inspectTextureMemory(viewer) {
  const textures = new Set(), visited = new WeakSet()
  const visit = (value, depth = 0) => {
    if (!value || depth > 5) return
    if (value.isTexture) { textures.add(value); return }
    if (typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    if (value.isObject3D) {
      if (Array.isArray(value.material)) value.material.forEach(material => visit(material, depth + 1))
      else visit(value.material, depth + 1)
      return
    }
    if (value.isWebGLRenderTarget) {
      visit(value.texture, depth + 1); visit(value.depthTexture, depth + 1); return
    }
    if (ArrayBuffer.isView(value) || value instanceof WebGLRenderingContext || typeof WebGL2RenderingContext !== 'undefined' && value instanceof WebGL2RenderingContext) return
    for (const key of Object.keys(value)) {
      if (['parent', 'children', 'domElement', '_listeners', 'renderer', 'viewer', 'scene'].includes(key)) continue
      visit(value[key], depth + 1)
    }
  }
  viewer.scene.traverse(object => visit(object))
  visit(viewer.scene.environment); visit(viewer.scene.background)
  visit(viewer.renderManager.composerTarget); visit(viewer.renderManager.composerTarget2)
  for (const pass of viewer.renderManager.passes) visit(pass)
  const records = [...textures].map(texture => {
    const source = texture.source?.data || texture.image
    const images = Array.isArray(source) ? source : [source]
    let bytes = 0, width = 0, height = 0
    for (const image of images) {
      const w = image?.width || image?.videoWidth || image?.data?.width || 0
      const h = image?.height || image?.videoHeight || image?.data?.height || 0
      width = Math.max(width, w); height = Math.max(height, h)
      const channels = /RedFormat/.test(String(texture.format)) ? 1 : /RGFormat/.test(String(texture.format)) ? 2 : 4
      const component = /HalfFloatType/.test(String(texture.type)) ? 2 : /FloatType/.test(String(texture.type)) ? 4 : 1
      bytes += w * h * channels * component * (texture.generateMipmaps ? 4 / 3 : 1)
    }
    return {name: texture.name || texture.source?.data?.src?.split('/').at(-1) || '(unnamed)', width, height, bytes: Math.round(bytes)}
  })
  records.sort((a, b) => b.bytes - a.bytes)
  return {estimatedBytes: records.reduce((sum, item) => sum + item.bytes, 0), estimatedMiB: round(records.reduce((sum, item) => sum + item.bytes, 0) / 1048576), countedTextures: records.length, largest: records.slice(0, 8)}
}

function summary(values) {
  if (!values.length) return {mean: null, p50: null, p95: null, p99: null, max: null}
  const sorted = [...values].sort((a, b) => a - b)
  return {mean: round(mean(sorted)), p50: round(percentile(sorted, .5)), p95: round(percentile(sorted, .95)), p99: round(percentile(sorted, .99)), max: round(sorted.at(-1))}
}
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN }
function percentile(sorted, fraction) { return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] }
function round(value) { return Number.isFinite(value) ? Number(value.toFixed(3)) : null }
