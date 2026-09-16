#!/usr/bin/env node
// Repeatable frame-time stress harness for weapon fire and combat.
//
// Drives the real game through the editor Run button (the owner's path) or a
// generated standalone page, then records per-frame requestAnimationFrame
// deltas plus performance.now() spans around the world step, view sync, HUD
// sync and render. Optional CDP Profiler sampling and WebGL call counters
// attribute the spikes.
//
//   node tools/stress-frames.mjs --label=before --out=<dir>
//   node tools/stress-frames.mjs --scenarios=m4-mob --profile=m4-mob
import {spawn} from 'node:child_process'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
import {runEditor} from '../test/helpers/editor-driver.mjs'
import {createStandaloneServer} from './standalone-page.mjs'

const root = new URL('../', import.meta.url)
const projectDir = fileURLToPath(root)
const BUDGET_MS = 13.3
const STUTTER_MS = 33
const ALL_SCENARIOS = ['idle', 'revolver-air', 'm4-air', 'm4-mob', 'revolver-heads', 'wave']

const options = parseOptions(process.argv.slice(2))
let server = null
let staticServer = null
const results = []

try {
  const dev = await ensureDevServer()
  const base = options.mode === 'standalone' ? await ensureStandalone() : dev.url
  // Sandbox scenarios share one boot and reset the world between them; a normal
  // match needs its own page because the sandbox flag lives in the URL.
  const groups = [
    ['sandbox', options.scenarios.filter(name => name !== 'wave')],
    ['wave', options.scenarios.filter(name => name === 'wave')],
  ].filter(([, list]) => list.length)
  const collected = new Map(options.scenarios.map(name => [name, []]))
  for (let run = 0; run < options.runs; run += 1) {
    for (const [group, list] of groups) {
      process.stderr.write(`[stress] ${options.mode} ${group} [${list.join(' ')}] run ${run + 1}/${options.runs}\n`)
      for (const entry of await measureGroup({group, scenarios: list, base, run})) collected.get(entry.scenario).push(entry)
    }
  }
  for (const scenario of options.scenarios) {
    const runs = collected.get(scenario)
    // "Keep the better run": lowest p99, ties broken by the smaller max.
    const best = [...runs].sort((a, b) => (a.frame.p99 - b.frame.p99) || (a.frame.max - b.frame.max))[0]
    results.push({...best, runs: runs.map(entry => ({p50: entry.frame.p50, p95: entry.frame.p95, p99: entry.frame.p99, max: entry.frame.max}))})
  }
  const report = {
    tool: 'stress-frames',
    label: options.label,
    mode: options.mode,
    capturedAt: new Date().toISOString(),
    budgetMs: BUDGET_MS,
    stutterMs: STUTTER_MS,
    seconds: options.seconds,
    runs: options.runs,
    viewport: {width: options.width, height: options.height, deviceScaleFactor: options.dpr},
    headless: options.headless,
    experiment: options.experiment || null,
    quality: options.quality,
    note: options.note || null,
    scenarios: results,
  }
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (options.out) {
    await mkdir(options.out, {recursive: true})
    await writeFile(join(options.out, `stress-${options.label}-${options.mode}.json`), json)
  }
  process.stdout.write(`${table(results)}\n`)
  if (!options.out) process.stdout.write(json)
} catch (error) {
  process.stderr.write(`${redact(String(error?.stack || error))}\n`)
  process.exitCode = 1
} finally {
  await staticServer?.close()
  if (server) {
    server.kill('SIGTERM')
    await Promise.race([new Promise(done => server.once('exit', done)), delay(5_000)])
  }
}

async function measureGroup({group, scenarios, base, run}) {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: options.headless,
    // Without these Chrome paces every frame to the 60 Hz compositor and the
    // deltas quantise to 16.7 ms, which hides all cost under the budget.
    args: ['--use-angle=metal', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--js-flags=--expose-gc'],
  })
  const warnings = []
  try {
    const page = await browser.newPage({
      viewport: {width: options.width, height: options.height},
      deviceScaleFactor: options.dpr,
    })
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type())) warnings.push(`${message.type()}: ${redact(message.text())}`)
    })
    page.on('pageerror', error => warnings.push(`pageerror: ${redact(error.stack || error.message)}`))
    await page.addInitScript(quality => {
      localStorage.setItem('terminator.settings.v1', JSON.stringify({quality, controlsSeen: true}))
    }, options.quality)
    await page.addInitScript(glCountersSource)
    const url = withQuery(base, group === 'wave' ? {} : {sandbox: '1'})
    await page.goto(url, {waitUntil: 'domcontentloaded'})
    if (options.mode === 'editor') await bootEditor(page)
    else await bootStandalone(page)
    const boot = await startMatch(page, group)
    const cdp = await page.context().newCDPSession(page)
    await page.evaluate(instrumentSource)
    await page.evaluate(pilotSource)
    if (options.experiment) await page.evaluate(experimentSource, options.experiment)
    const entries = []
    for (const scenario of scenarios) {
      const wantsProfile = options.profile === scenario && run === 0
      const wantsTrace = options.trace === scenario && run === 0
      const setup = await page.evaluate(sc => window.__stressPilot.setup(sc), scenario)
      await page.waitForTimeout(options.settleSeconds * 1_000)
      if (wantsProfile) {
        await cdp.send('Profiler.enable')
        await cdp.send('Profiler.setSamplingInterval', {interval: 100})
        await cdp.send('Profiler.start')
      }
      if (wantsTrace) {
        await cdp.send('Tracing.start', {
          traceConfig: {includedCategories: ['devtools.timeline', 'v8', 'v8.execute', 'blink.user_timing', 'disabled-by-default-v8.gc']},
          transferMode: 'ReturnAsStream',
        })
      }
      await page.evaluate(seconds => window.__stress.begin(seconds), options.seconds)
      await page.waitForFunction(() => !window.__stress.recording, undefined, {timeout: (options.seconds + 60) * 1_000})
      let profile = null
      if (wantsProfile) {
        const raw = (await cdp.send('Profiler.stop')).profile
        profile = summarizeProfile(raw)
        if (options.out) {
          await mkdir(options.out, {recursive: true})
          await writeFile(join(options.out, `cpuprofile-${scenario}-${options.label}.cpuprofile`), JSON.stringify(raw))
        }
      }
      if (wantsTrace) await collectTrace(cdp, scenario)
      const frames = await page.evaluate(() => window.__stress.report())
      const after = await page.evaluate(() => window.__stressPilot.report())
      const teardown = await page.evaluate(() => window.__stressPilot.teardown())
      entries.push({scenario, run, setup, boot, after, teardown, ...summarizeFrames(frames), profile,
        warnings: [...new Set(warnings)].slice(0, 12)})
      if (teardown.lost) throw new Error(`Play stopped during ${scenario}: ${JSON.stringify(teardown)}`)
      await page.waitForTimeout(2_000)
    }
    return entries
  } finally {
    await browser.close().catch(() => {})
  }
}

// Page-side switches used to size a candidate fix before it is written.
function experimentSource(name) {
  const manager = window.terminator.manager
  const viewer = window.viewer
  const parts = String(name).split('+')
  for (const part of parts) {
    if (part === 'authored-matrix-off') {
      for (const child of viewer.scene.modelRoot.children) {
        if (child.visible === false) child.matrixWorldAutoUpdate = false
      }
      viewer.scene.modelRoot.getObjectByName('Map')?.traverse(object => {
        if (object.visible === false) object.matrixWorldAutoUpdate = false
      })
    }
    if (part === 'shadow-off') viewer.renderManager.webglRenderer.shadowMap.enabled = false
    if (part.startsWith('instanced-lod')) {
      const metres = Number(part.split(':')[1] || 5)
      for (const system of manager.unitView.instancedList || []) system.quality = {...system.quality, instancedLodDistance: metres}
    }
    if (part === 'instanced-off') {
      // Route every common back to a per-unit rig, keeping everything else.
      manager.unitView.instancedFor = () => null
    }
    if (part === 'ragdoll-off') manager.unitView.ragdolls.update = () => {}
    if (part === 'hitstop-off') Object.defineProperty(manager.cameraFeel, 'hitStopped', {get: () => false})
    if (part.startsWith('corpse-cap')) {
      const cap = Number(part.split(':')[1] || 8)
      const system = manager.unitView.ragdolls
      const update = system.update.bind(system)
      system.update = dt => {
        while (system.records.size > cap) {
          const oldest = [...system.records].sort((a, b) => a.born - b.born)[0]
          if (!oldest) break
          system.release(oldest)
        }
        return update(dt)
      }
    }
    if (part === 'rect-off') {
      const screenFx = manager.playerView?.weapons?.screenFx
      if (screenFx) { const layout = screenFx.layout.bind(screenFx); screenFx.layout = () => { screenFx.bounds ||= 'x'; layout() } }
      manager.hud.sync = () => {}
      if (screenFx) screenFx.layout = () => {}
    }
    if (part === 'static-chain') {
      viewer.scene.matrixAutoUpdate = false
      viewer.scene.modelRoot.matrixAutoUpdate = false
      viewer.scene.modelRoot.getObjectByName('Map').matrixAutoUpdate = false
    }
    if (part === 'park-authored') {
      const root = viewer.scene.modelRoot
      for (const child of [...root.children]) if (child.visible === false) root.remove(child)
      root.getObjectByName('Map')?.children.slice().forEach(child => { if (child.visible === false) child.removeFromParent() })
    }
    if (part === 'ssao-off') {
      for (const pass of viewer.renderManager.passes) if (['gbuffer', 'ssao'].includes(pass.passId)) pass.enabled = false
    }
    if (part === 'bloom-off') {
      for (const pass of viewer.renderManager.passes) if (pass.passId === 'map-bloom') pass.enabled = false
    }
    if (part === 'autonearfar-off') {
      const camera = viewer.scene.mainCamera
      globalThis.__nearFar = {before: [camera.near, camera.far]}
      viewer.scene.disableAutoNearFar('stress')
      globalThis.__nearFar.after = [camera.near, camera.far]
    }
    if (part === 'grenade-matrix-off') {
      viewer.scene.getObjectByName('Grenade Projectiles Runtime')?.traverse(object => {
        if (object.visible === false) object.matrixWorldAutoUpdate = false
      })
    }
  }
  return parts
}

async function bootEditor(page) {
  await page.waitForFunction(() => Boolean(window.kite3dProjectLoaded && window.viewer?.scene?.modelRoot), undefined, {timeout: 120_000})
  await page.waitForFunction(() => {
    let pieces = 0, loaded = 0
    window.viewer?.scene?.modelRoot?.traverse(object => {
      if (object.userData.mapPiece?.nodeId) { pieces += 1; if (object.children.length) loaded += 1 }
    })
    return pieces > 0 && pieces === loaded
  }, undefined, {timeout: 180_000})
  await runEditor(page, {timeout: 120_000})
  await page.waitForFunction(() => Boolean(window.terminator?.manager?.world), undefined, {timeout: 120_000})
}

async function bootStandalone(page) {
  await page.waitForFunction(() => Boolean(window.terminator?.manager?.world), undefined, {timeout: 180_000})
}

async function startMatch(page, scenario) {
  await page.waitForFunction(() => window.terminator?.manager?.ui?.screens?.route === 'main', undefined, {timeout: 120_000})
  const began = Date.now()
  await page.evaluate(async () => {
    const manager = window.terminator.manager
    await manager.ui.startMatch()
    manager.ui.screens.show(null)
    manager.ui.setInput(true)
    await manager.audio?.unlock?.()
  })
  // Sandbox keeps the director paused in the lobby phase on purpose; a normal match must reach a wave.
  await page.waitForFunction(() => window.terminator.manager.viewsStarted, undefined, {timeout: 120_000})
  if (scenario === 'wave') {
    await page.waitForFunction(() => window.terminator.manager.world.phase === 'wave', undefined, {timeout: 90_000})
  }
  return page.evaluate(ms => {
    const manager = window.terminator.manager
    const rect = window.viewer.canvas.getBoundingClientRect()
    return {
      startMs: ms,
      phase: manager.world.phase,
      quality: manager.performanceQuality?.id || null,
      renderScale: window.viewer.renderManager.renderScale,
      renderSize: window.viewer.renderManager.renderSize?.toArray?.() || null,
      canvas: {width: Math.round(rect.width), height: Math.round(rect.height)},
      devicePixelRatio: window.devicePixelRatio,
      programs: window.viewer.renderManager.webglRenderer.info.programs?.length ?? null,
    }
  }, Date.now() - began)
}

function summarizeFrames(data) {
  const frames = data.frames
  const deltas = frames.map(frame => frame.d)
  const pick = key => summary(frames.map(frame => frame[key]))
  const worst = [...frames].sort((a, b) => b.d - a.d).slice(0, 12).map(frame => {
    const entry = {ms: round(frame.d), cpu: round(frame.cpu), gl: {link: frame.gl, buf: frame.gb, tex: frame.gt},
      heapDeltaMb: round(frame.m / 1048576)}
    for (const name of data.buckets) if (frame[name] > 0.25) entry[name] = round(frame[name])
    return entry
  })
  const spans = {}
  for (const name of data.buckets) {
    const stat = pick(name)
    stat.totalMs = round(frames.reduce((sum, frame) => sum + (frame[name] || 0), 0))
    spans[name] = stat
  }
  return {
    frame: {...summary(deltas), over13: deltas.filter(value => value > BUDGET_MS).length, over33: deltas.filter(value => value > STUTTER_MS).length},
    cpu: pick('cpu'),
    engine: pick('engine'),
    gap: pick('gap'),
    spans,
    gl: {
      linkFrames: frames.filter(frame => frame.gl > 0).length,
      linkMs: round(frames.reduce((sum, frame) => sum + frame.glms, 0)),
      bufferCalls: frames.reduce((sum, frame) => sum + frame.gb, 0),
      bufferMs: round(frames.reduce((sum, frame) => sum + frame.gbms, 0)),
      texCalls: frames.reduce((sum, frame) => sum + frame.gt, 0),
      texMs: round(frames.reduce((sum, frame) => sum + frame.gtms, 0)),
    },
    draws: {calls: summary(frames.map(frame => frame.calls)), triangles: summary(frames.map(frame => frame.tri))},
    longTasks: data.longTasks,
    worstFrames: worst,
    counters: data.counters,
  }
}

function summary(values) {
  const clean = values.filter(Number.isFinite)
  if (!clean.length) return {samples: 0, p50: null, p95: null, p99: null, max: null}
  const sorted = [...clean].sort((a, b) => a - b)
  const at = quantile => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]
  return {samples: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted.at(-1))}
}

function summarizeProfile(profile) {
  const byId = new Map(profile.nodes.map(node => [node.id, node]))
  const parent = new Map()
  for (const node of profile.nodes) for (const child of node.children || []) parent.set(child, node.id)
  const label = node => `${node.callFrame.functionName || '(anonymous)'} @ ${shortUrl(node.callFrame.url)}:${node.callFrame.lineNumber + 1}`
  const self = new Map()
  const inclusive = new Map()
  const paths = new Map()
  const total = profile.samples?.length || 0
  const span = (profile.endTime - profile.startTime) / 1000
  const interval = total ? span / total : 0
  for (const id of profile.samples || []) {
    const node = byId.get(id)
    if (!node) continue
    const name = label(node)
    self.set(name, (self.get(name) || 0) + interval)
    const chain = []
    let cursor = id
    const seen = new Set()
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor)
      const current = byId.get(cursor)
      if (!current) break
      chain.push(label(current))
      cursor = parent.get(cursor)
    }
    for (const entry of new Set(chain)) inclusive.set(entry, (inclusive.get(entry) || 0) + interval)
    // Collapse recursion so the chain reaches the real caller instead of ten identical frames.
    const collapsed = []
    for (const entry of chain) {
      const last = collapsed[collapsed.length - 1]
      if (last && last.name === entry) last.count += 1
      else collapsed.push({name: entry, count: 1})
    }
    const key = collapsed.slice(0, 7).map(entry => entry.count > 1 ? `${entry.name} x${entry.count}` : entry.name).join(' <= ')
    paths.set(key, (paths.get(key) || 0) + interval)
  }
  const rank = map => [...map.entries()].sort((a, b) => b[1] - a[1])
  return {
    totalMs: round(span),
    samples: total,
    top: rank(self).slice(0, 30).map(([name, ms]) => ({name, selfMs: round(ms), share: round(100 * ms / Math.max(1, span))})),
    inclusive: rank(inclusive).slice(0, 30).map(([name, ms]) => ({name, totalMs: round(ms), share: round(100 * ms / Math.max(1, span))})),
    hotPaths: rank(paths).slice(0, 25).map(([name, ms]) => ({path: name, selfMs: round(ms)})),
  }
}

async function collectTrace(cdp, scenario) {
  const chunks = []
  const done = new Promise(resolveDone => {
    cdp.on('Tracing.tracingComplete', async event => {
      if (event.stream) {
        for (;;) {
          const part = await cdp.send('IO.read', {handle: event.stream, size: 1 << 20})
          chunks.push(part.data)
          if (part.eof) break
        }
        await cdp.send('IO.close', {handle: event.stream})
      }
      resolveDone()
    })
  })
  await cdp.send('Tracing.end')
  await done
  if (options.out) {
    await mkdir(options.out, {recursive: true})
    await writeFile(join(options.out, `trace-${scenario}-${options.label}.json`), chunks.join(''))
  }
}

function table(rows) {
  const lines = ['| scenario | p50 | p95 | p99 | max | >13.3ms | >33ms | cpu p99 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|']
  for (const row of rows) {
    lines.push(`| ${row.scenario} | ${row.frame.p50} | ${row.frame.p95} | ${row.frame.p99} | ${row.frame.max} | ${row.frame.over13} | ${row.frame.over33} | ${row.cpu.p99} |`)
  }
  lines.push('', '| scenario | engine p50/p99 | wait p50/p99 |', '|---|---:|---:|')
  for (const row of rows) lines.push(`| ${row.scenario} | ${row.engine.p50}/${row.engine.p99} | ${row.gap.p50}/${row.gap.p99} |`)
  lines.push('', '| scenario | top self-time spans (p99 ms) |', '|---|---|')
  for (const row of rows) {
    const top = Object.entries(row.spans).filter(([, stat]) => stat.p99 > 0.2)
      .sort((a, b) => b[1].p99 - a[1].p99).slice(0, 8).map(([name, stat]) => `${name} ${stat.p99}`).join(', ')
    lines.push(`| ${row.scenario} | ${top} |`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- page side

function glCountersSource() {
  const counters = globalThis.__gl = {link: 0, linkMs: 0, compileMs: 0, buffer: 0, bufferMs: 0, tex: 0, texMs: 0}
  const wrap = (proto, name, countKey, msKey) => {
    const original = proto?.prototype?.[name]
    if (!original) return
    proto.prototype[name] = function (...args) {
      const started = performance.now()
      const value = original.apply(this, args)
      const spent = performance.now() - started
      if (countKey) counters[countKey] += 1
      counters[msKey] += spent
      return value
    }
  }
  for (const proto of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext]) {
    wrap(proto, 'compileShader', null, 'compileMs')
    wrap(proto, 'linkProgram', 'link', 'linkMs')
    wrap(proto, 'bufferData', 'buffer', 'bufferMs')
    wrap(proto, 'bufferSubData', 'buffer', 'bufferMs')
    wrap(proto, 'texImage2D', 'tex', 'texMs')
    wrap(proto, 'texSubImage2D', 'tex', 'texMs')
    wrap(proto, 'compressedTexImage2D', 'tex', 'texMs')
  }
}

function instrumentSource() {
  if (globalThis.__stress?.installed) return
  const manager = window.terminator.manager
  const viewer = window.viewer
  const now = () => performance.now()
  const state = {
    installed: true, recording: false, frames: [], longTasks: [], deadline: 0,
    acc: {}, buckets: [],
    lastHeap: performance.memory?.usedJSHeapSize || 0,
    counters: {},
  }
  globalThis.__stress = state

  // Every wrapped call records its own self time: the inclusive duration minus
  // whatever a nested wrapped call already claimed. No span is double counted.
  const stack = []
  const wrap = (target, key, name) => {
    if (!target || typeof target[key] !== 'function') return false
    if (!state.buckets.includes(name)) state.buckets.push(name)
    const original = target[key].bind(target)
    target[key] = (...args) => {
      const parent = stack[stack.length - 1]
      stack.push(name)
      const started = now()
      try { return original(...args) } finally {
        const spent = now() - started
        stack.pop()
        state.acc[name] = (state.acc[name] || 0) + spent
        if (parent) state.acc[parent] = (state.acc[parent] || 0) - spent
      }
    }
    return true
  }

  wrap(manager, 'update', 'update')
  wrap(manager.director, 'step', 'step')
  wrap(manager, 'syncViews', 'viewSync')
  wrap(manager, 'syncUi', 'uiSync')
  wrap(manager, 'preFrame', 'hudSync')
  wrap(viewer.renderManager, 'render', 'render')
  // info.render resets when the next pass starts, so read each pass on the way out.
  const renderManager = viewer.renderManager
  const webgl = renderManager.webglRenderer
  const passRender = webgl.render.bind(webgl)
  webgl.render = (...args) => {
    const value = passRender(...args)
    state.passCalls += webgl.info.render.calls
    state.passTriangles += webgl.info.render.triangles
    return value
  }
  state.passCalls = 0
  state.passTriangles = 0
  wrap(manager.mapView, 'sync', 'map')
  wrap(manager.unitView, 'sync', 'units')
  wrap(manager.unitView.ragdolls, 'update', 'ragdolls')
  wrap(manager.unitView.fx, 'update', 'unitFx')
  wrap(manager.unitView.fx.gore, 'event', 'goreEvent')
  wrap(manager.unitView.fx, 'damage', 'fxDamage')
  wrap(manager.unitView.rosterFx, 'update', 'rosterFx')
  wrap(manager.unitView.optics, 'update', 'optics')
  wrap(manager.unitView, 'processEvents', 'unitEvents')
  wrap(manager.unitView, 'cloneTemplateFigure', 'unitClone')
  for (const system of manager.unitView.instancedList || []) wrap(system, 'sync', 'instanced')
  wrap(manager.unitView, 'recycleVisual', 'unitRecycle')
  wrap(manager.unitView, 'damageEvent', 'unitDamage')
  wrap(manager.playerView, 'sync', 'player')
  wrap(manager.playerView.weapons, 'sync', 'weapons')
  wrap(manager.playersView, 'sync', 'players')
  wrap(manager.grenadeView, 'sync', 'grenade')
  wrap(manager.cameraFeel, 'apply', 'cameraFeel')
  wrap(manager.cameraFeel, 'consume', 'cameraConsume')
  wrap(manager.cachesView, 'sync', 'caches')
  wrap(manager.extractionView, 'sync', 'extraction')
  wrap(manager.playerView.weapons, 'beforeRender', 'weaponsBeforeRender')
  wrap(manager.playerView.weapons.screenFx, 'layout', 'screenFxLayout')
  wrap(manager.playerView.weapons.fx, 'beforeRender', 'weaponFxBeforeRender')
  wrap(manager.hud, 'render', 'hudRender')
  wrap(manager.hud, 'sync', 'hudDom')
  wrap(manager.ui.screens, 'render', 'screens')
  wrap(manager.ui.spectate, 'sync', 'spectate')
  if (manager.audio) wrap(manager.audio, '_play', 'audioPlay')
  if (manager.audio) wrap(manager.audio, 'updateListener', 'audioListener')

  // The engine frame runs between these two events. Anything left over in the
  // rAF interval is waiting: the GPU, the compositor, or another task.
  state.frameStart = 0
  state.engine = 0
  viewer.addEventListener('preFrame', () => { state.frameStart = now() })
  viewer.addEventListener('postFrame', () => { state.engine += now() - state.frameStart })

  // info.render resets at the start of each pass, so capture it while the last
  // pass of the frame is still on the books.
  state.draws = {calls: 0, triangles: 0}
  viewer.addEventListener('postRender', () => {
    const info = viewer.renderManager.webglRenderer.info
    state.draws = {calls: info.render.calls, triangles: info.render.triangles}
  })

  try {
    new PerformanceObserver(list => {
      if (!state.recording) return
      for (const entry of list.getEntries()) state.longTasks.push({ms: Math.round(entry.duration), at: Math.round(entry.startTime)})
    }).observe({entryTypes: ['longtask']})
  } catch {}

  let last = 0
  const tick = stamp => {
    if (state.recording) {
      if (last) {
        const gl = globalThis.__gl
        const heap = performance.memory?.usedJSHeapSize || 0
        const frame = {d: stamp - last, engine: state.engine, gap: stamp - last - state.engine,
          m: heap - state.lastHeap, calls: state.passCalls, tri: state.passTriangles,
          gl: gl.link, glms: gl.linkMs + gl.compileMs, gb: gl.buffer, gbms: gl.bufferMs, gt: gl.tex, gtms: gl.texMs}
        let cpu = 0
        for (const name of state.buckets) { const value = state.acc[name] || 0; frame[name] = value; cpu += value }
        frame.cpu = cpu
        state.frames.push(frame)
        state.lastHeap = heap
        gl.link = gl.linkMs = gl.compileMs = gl.buffer = gl.bufferMs = gl.tex = gl.texMs = 0
      }
      last = stamp
      state.engine = 0
      state.passCalls = 0
      state.passTriangles = 0
      for (const name of state.buckets) state.acc[name] = 0
      if (stamp >= state.deadline) {
        state.recording = false
        state.counters = state.snapshot()
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  state.snapshot = () => {
    const info = viewer.renderManager.webglRenderer.info
    const scene = {objects: 0, visible: 0, bones: 0, meshes: 0, skinned: 0, lights: 0, roots: {}}
    viewer.scene.traverse(object => {
      scene.objects += 1
      if (object.visible) scene.visible += 1
      if (object.isBone) scene.bones += 1
      if (object.isMesh) scene.meshes += 1
      if (object.isSkinnedMesh) scene.skinned += 1
      if (object.isLight) scene.lights += 1
    })
    for (const child of viewer.scene.children) {
      let count = 0
      child.traverse(() => { count += 1 })
      scene.roots[child.name || child.type] = count
    }
    // Mirror Object3D.updateMatrixWorld so the report says how many nodes the
    // renderer's per-frame world-matrix walk actually visits.
    const walk = (object, force) => {
      let visited = 1
      const dirty = Boolean(object.matrixAutoUpdate) || object.matrixWorldNeedsUpdate || force
      for (const child of object.children) {
        if (child.matrixWorldAutoUpdate === true || dirty) visited += walk(child, dirty)
      }
      return visited
    }
    scene.walked = walk(viewer.scene, false)
    scene.walkedRoots = {}
    for (const child of viewer.scene.children) {
      scene.walkedRoots[child.name || child.type] = child.matrixWorldAutoUpdate === true ? walk(child, false) : 0
    }
    const frameRendering = manager.mapView?.post?.frameRendering?.stats || null
    const camera = viewer.scene.mainCamera
    const nearFar = {near: camera.near, far: camera.far, autoNearFar: camera.userData.autoNearFar ?? true, probe: globalThis.__nearFar || null}
    return {
      scene, frameRendering, nearFar,
      drawCalls: info.render.calls, triangles: info.render.triangles,
      programs: info.programs?.length ?? null, geometries: info.memory.geometries, textures: info.memory.textures,
      aliveUnits: manager.world.aliveUnits.length,
      instanced: manager.unitView?.instancedReport?.() || null,
      ragdolls: manager.unitView?.fx?.ragdolls?.records?.length ?? null,
      gorePieces: manager.unitView?.fx?.gore?.pieces?.items?.length ?? null,
      decals: manager.unitView?.fx?.decals?.length ?? null,
      audioVoices: manager.audio ? [...manager.audio.voices.values()].reduce((sum, pool) => sum + pool.length, 0) : null,
      audioStats: manager.audio ? {...manager.audio.stats, failed: manager.audio.stats.failed.length} : null,
      heapMb: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576),
      eventLog: manager.world.eventLog.length,
    }
  }
  state.begin = seconds => {
    state.frames.length = 0
    state.longTasks.length = 0
    state.before = state.snapshot()
    state.lastHeap = performance.memory?.usedJSHeapSize || 0
    last = 0
    state.deadline = performance.now() + seconds * 1_000
    state.recording = true
  }
  state.report = () => ({
    frames: state.frames.slice(1),
    buckets: state.buckets,
    longTasks: {count: state.longTasks.length, totalMs: state.longTasks.reduce((sum, task) => sum + task.ms, 0), worst: state.longTasks.sort((a, b) => b.ms - a.ms).slice(0, 8)},
    counters: {before: state.before, after: state.counters},
  })
}

function pilotSource() {
  const manager = window.terminator.manager
  const world = manager.world
  const pilot = globalThis.__stressPilot = {scenario: null, want: {fire: false, weapon: 'm4'}, shots: 0, reloads: 0, kills: 0, headshots: 0}

  const player = () => world.getPlayer(manager.localPlayerId) || world.player
  const sample = manager.ui.sample.bind(manager.ui)
  manager.ui.sample = () => {
    const input = sample()
    if (!pilot.scenario) return input
    input.move = {x: 0, z: 0}
    input.sprint = false
    input.jump = false
    input.grenade = false
    input.melee = false
    const self = player()
    const aim = pilot.aim(self)
    input.yaw = aim.yaw
    input.pitch = aim.pitch
    self.yaw = aim.yaw
    self.pitch = aim.pitch
    const weapon = self.ammo?.[pilot.want.weapon]
    if (weapon && weapon.mag <= 0) { input.reload = true; pilot.reloads += 1; input.fire = false }
    else input.fire = pilot.want.fire
    return input
  }

  pilot.aim = self => {
    if (!pilot.track) return {yaw: pilot.baseYaw, pitch: pilot.basePitch}
    let best = null, bestDistance = Infinity
    for (const unit of world.units) {
      if (!unit.alive) continue
      const distance = (unit.pos.x - self.pos.x) ** 2 + (unit.pos.z - self.pos.z) ** 2
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = unit
    }
    if (!best) return {yaw: pilot.baseYaw, pitch: pilot.basePitch}
    const dx = best.pos.x - self.pos.x, dz = best.pos.z - self.pos.z
    const eye = self.pos.y + (self.eyeHeight ?? 1.65)
    const target = best.pos.y + pilot.aimHeight
    const flat = Math.hypot(dx, dz) || 0.001
    return {yaw: Math.atan2(dx, dz) + Math.PI, pitch: Math.atan2(target - eye, flat)}
  }

  const spawnMob = (count, metres) => {
    const self = player()
    let spawned = 0
    for (let index = 0; index < count; index += 1) {
      const lane = (index % 4) - 1.5
      const row = Math.floor(index / 4)
      const x = self.pos.x + lane * 1.4
      const z = self.pos.z - (metres + row * 1.4)
      const unit = world.spawnUnit('scout', {x, y: self.pos.y, z}, {yaw: Math.atan2(self.pos.x - x, self.pos.z - z)})
      if (unit) spawned += 1
    }
    return spawned
  }

  pilot.setup = scenario => {
    pilot.scenario = scenario
    const self = player()
    pilot.baseYaw = self.yaw
    pilot.basePitch = 0
    pilot.track = false
    pilot.aimHeight = 0.8
    pilot.mob = 0
    world.scaling.maxAlive = Math.max(world.scaling.maxAlive ?? 32, 40)
    if (scenario !== 'wave') {
      world.giveAllWeapons(manager.localPlayerId)
      world.clearUnits()
    }
    if (scenario === 'idle') pilot.want = {fire: false, weapon: self.activeWeapon}
    if (scenario === 'revolver-air') { self.activeWeapon = 'pistol'; pilot.want = {fire: true, weapon: 'pistol'} }
    if (scenario === 'm4-air') { self.activeWeapon = 'm4'; pilot.want = {fire: true, weapon: 'm4'} }
    if (scenario === 'm4-mob') {
      self.activeWeapon = 'm4'; pilot.want = {fire: true, weapon: 'm4'}
      pilot.track = true; pilot.mob = spawnMob(16, 8)
      pilot.refill = 16
    }
    if (scenario === 'revolver-heads') {
      self.activeWeapon = 'pistol'; pilot.want = {fire: true, weapon: 'pistol'}
      pilot.track = true; pilot.aimHeight = 0.78; pilot.mob = spawnMob(8, 9)
      pilot.refill = 8
    }
    if (scenario === 'wave') { self.activeWeapon = 'm4'; pilot.want = {fire: true, weapon: 'm4'}; pilot.track = true }
    pilot.eventIndex = world.eventLog.length
    pilot.startTick = world.tick
    // Keep the mob populated so the stress does not fade as the scouts die.
    pilot.timer = pilot.refill ? setInterval(() => {
      const alive = world.units.filter(unit => unit.alive).length
      if (alive < pilot.refill) spawnMob(pilot.refill - alive, pilot.refill === 8 ? 9 : 8)
      const self2 = player()
      for (const id of Object.keys(self2.ammo || {})) if (self2.ammo[id].owned) self2.ammo[id].reserve = 999
    }, 500) : null
    if (scenario === 'wave') pilot.timer = setInterval(() => {
      const self2 = player()
      for (const id of Object.keys(self2.ammo || {})) if (self2.ammo[id].owned) self2.ammo[id].reserve = 999
    }, 500)
    return {scenario, weapon: self.activeWeapon, mob: pilot.mob, phase: world.phase, wave: world.wave,
      sandbox: Boolean(world.sandboxEnabled?.()), maxAlive: world.scaling.maxAlive}
  }

  // Between scenarios the corpse, gore and ragdoll population must go back to
  // the state a fresh match starts in, or every later scenario measures the
  // leftovers of the earlier one.
  pilot.teardown = () => {
    if (pilot.timer) clearInterval(pilot.timer)
    pilot.timer = null
    pilot.scenario = null
    pilot.want = {fire: false, weapon: 'm4'}
    const view = manager.unitView
    if (!view || window.terminator.manager !== manager) {
      return {objects: 0, lost: true, sameManager: window.terminator.manager === manager,
        started: Boolean(manager.started), viewsStarted: Boolean(manager.viewsStarted)}
    }
    world.clearUnits()
    view.fx.reset()
    view.ragdolls.reset()
    view.rosterFx.reset()
    for (const [id, visual] of [...view.visuals]) view.recycleVisual(id, visual, visual.unitType)
    view.eventIndex = world.eventLog.length
    manager.cameraFeel.eventIndex = world.eventLog.length
    manager.syncViews()
    let objects = 0
    window.viewer.scene.traverse(() => { objects += 1 })
    return {objects}
  }

  pilot.report = () => {
    if (pilot.timer) clearInterval(pilot.timer)
    let shots = 0, hits = 0, kills = 0, headshots = 0, explosions = 0, spawns = 0
    for (let index = pilot.eventIndex; index < world.eventLog.length; index += 1) {
      const event = world.eventLog[index]
      if (event.type === 'shot') { shots += 1; if (event.hit) hits += 1 }
      if (event.type === 'kill') { kills += 1; if (event.headshot) headshots += 1 }
      if (event.type === 'explosion') explosions += 1
      if (event.type === 'spawn') spawns += 1
    }
    return {shots, hits, kills, headshots, explosions, spawns, reloads: pilot.reloads,
      ticks: world.tick - pilot.startTick, aliveAtEnd: world.aliveUnits.length, phase: world.phase, wave: world.wave}
  }
}

// ------------------------------------------------------------------ plumbing

function parseOptions(argv) {
  const value = (name, fallback) => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
  const scenarios = value('scenarios', ALL_SCENARIOS.join(',')).split(',').filter(Boolean)
  for (const scenario of scenarios) if (!ALL_SCENARIOS.includes(scenario)) throw new Error(`Unknown scenario ${scenario}`)
  return {
    scenarios,
    seconds: Number(value('seconds', 30)),
    settleSeconds: Number(value('settle', 3)),
    runs: Math.max(1, Number(value('runs', 2))),
    mode: value('mode', 'editor'),
    label: value('label', 'run'),
    out: value('out', ''),
    port: Number(value('port', 4471)),
    width: Number(value('width', 1512)),
    height: Number(value('height', 945)),
    dpr: Number(value('dpr', 2)),
    headless: value('headless', 'on') !== 'off',
    profile: value('profile', ''),
    trace: value('trace', ''),
    experiment: value('experiment', ''),
    quality: value('quality', 'high'),
    note: value('note', ''),
  }
}

async function ensureDevServer() {
  const file = new URL('.kite3d/dev.json', root)
  const existing = await readDev(file)
  if (existing?.url && new URL(existing.url).origin === `http://127.0.0.1:${options.port}` && await reachable(existing.url)) return existing
  server = spawn('npx', ['kite3d', 'dev', '--port', String(options.port), '--no-open'], {cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe']})
  let diagnostics = ''
  server.stdout.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000) })
  server.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000) })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`kite3d dev exited ${server.exitCode}: ${redact(diagnostics)}`)
    const dev = await readDev(file)
    if (dev?.url && new URL(dev.url).origin === `http://127.0.0.1:${options.port}` && await reachable(dev.url)) return dev
    await delay(150)
  }
  throw new Error(`kite3d dev did not start on port ${options.port}: ${redact(diagnostics)}`)
}

// The standalone page is the one `npm run play` serves, so a measurement and a
// player boot the same way. It listens one port above the dev server.
async function ensureStandalone() {
  const served = await createStandaloneServer({projectDir, port: options.port + 1})
  staticServer = served
  return served.url
}

function withQuery(url, extra) {
  const parsed = new URL(url)
  for (const [key, value] of Object.entries(extra)) parsed.searchParams.set(key, value)
  return parsed.href
}

async function readDev(file) { try { return JSON.parse(await readFile(file, 'utf8')) } catch { return null } }
async function reachable(origin) { try { return (await fetch(origin, {signal: AbortSignal.timeout(800)})).ok } catch { return false } }
function delay(ms) { return new Promise(done => setTimeout(done, ms)) }
function redact(value) { return String(value).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]').replace(/t=[A-Za-z0-9._~-]{16,}/g, 't=[redacted]') }
function round(value) { return Number.isFinite(value) ? Number(value.toFixed(2)) : null }
function shortUrl(url) { return String(url || '').replace(/^https?:\/\/[^/]+/, '').replace(/\?t=[^&]*/, '').slice(-64) }
export {resolve}
