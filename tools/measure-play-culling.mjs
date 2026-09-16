#!/usr/bin/env node
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'

const label = process.argv[2] || 'probe'
const output = new URL(`../docs/evidence/play-culling/${label}.json`, import.meta.url)
const screenshot = new URL(`../docs/evidence/play-culling/${label}-first-frame.png`, import.meta.url)
const dev = JSON.parse(await readFile(new URL('../.kite3d/dev.json', import.meta.url), 'utf8'))
const warnings = []
const network = []
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
  page.on('requestfinished', async request => {
    const timing = request.timing()
    const response = await request.response()
    network.push({url: request.url(), resourceType: request.resourceType(), startEpochMs: timing.startTime,
      responseEndMs: timing.responseEnd, status: response?.status()})
  })
  await page.addInitScript(() => {
    localStorage.setItem('terminator.settings.v1', JSON.stringify({quality: 'high', controlsSeen: true}))
  })
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').waitFor({state: 'visible', timeout: 30_000})
  await page.waitForFunction(() => document.body.innerText.includes('Project loaded'), undefined, {timeout: 90_000})
  await page.waitForTimeout(500)

  await page.evaluate(() => {
    const probe = window.__playProbe = {installed: performance.now(), click: null, managerReady: null, firstRender: null}
    let value
    Object.defineProperty(window, 'terminator', {
      configurable: true,
      get: () => value,
      set: next => {
        value = next
        if (!probe.click || probe.managerReady) return
        probe.managerReady = performance.now()
        const viewer = window.viewer
        const onRender = () => {
          probe.firstRender = performance.now()
          viewer.removeEventListener('postRender', onRender)
        }
        viewer.addEventListener('postRender', onRender)
        viewer.setDirty()
      },
    })
    document.querySelector('[data-testid="play"]').addEventListener('click', () => {
      probe.click = performance.now()
    }, {capture: true, once: true})
  })

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', {interval: 100})
  await cdp.send('Profiler.start')
  await page.getByTestId('play').click({timeout: 90_000})
  await page.waitForFunction(() => Number.isFinite(window.__playProbe?.firstRender), undefined, {timeout: 90_000})
  const {profile} = await cdp.send('Profiler.stop')
  await cdp.send('Profiler.disable')
  await page.screenshot({path: fileURLToPath(screenshot), fullPage: true})

  const timing = await page.evaluate(() => {
    const p = window.__playProbe
    const resources = performance.getEntriesByType('resource')
      .filter(entry => entry.startTime >= p.click)
      .map(entry => ({name: entry.name.replace(location.origin, ''), startMs: entry.startTime - p.click,
        durationMs: entry.duration, transferBytes: entry.transferSize, decodedBytes: entry.decodedBodySize}))
    return {
      clickToManagerReadyMs: p.managerReady - p.click,
      managerReadyToFirstRenderMs: p.firstRender - p.managerReady,
      clickToFirstRenderMs: p.firstRender - p.click,
      clickEpochMs: performance.timeOrigin + p.click,
      resources,
      manager: {type: window.terminator.manager.constructor.ComponentType, started: window.terminator.manager.started,
        units: window.terminator.manager.world.units.length, visuals: window.terminator.manager.unitView.visuals.size},
      renderer: window.viewer.renderManager.webglRenderer.info.render,
    }
  })
  const cpu = summarizeProfile(profile)
  const playNetwork = network.filter(entry => entry.startEpochMs >= timing.clickEpochMs)
    .map(entry => ({...entry, url: entry.url.replace(/([?&])t=[^&]+/g, '$1t=[redacted]')}))
  const result = {label, capturedAt: new Date().toISOString(), timing: roundDeep(timing),
    network: roundDeep(playNetwork), cpu, warnings}
  await mkdir(new URL('.', output), {recursive: true})
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}

function summarizeProfile(profile) {
  const byId = new Map(profile.nodes.map(node => [node.id, node]))
  const parent = new Map()
  for (const node of profile.nodes) for (const child of node.children || []) parent.set(child, node.id)
  const entries = new Map()
  for (let index = 0; index < profile.samples.length; index += 1) {
    const deltaMs = (profile.timeDeltas[index] || 0) / 1000
    const leaf = byId.get(profile.samples[index])
    if (!leaf) continue
    add(entries, leaf.callFrame, 'selfMs', deltaMs)
    let node = leaf
    const visited = new Set()
    while (node && !visited.has(node.id)) {
      visited.add(node.id)
      add(entries, node.callFrame, 'totalMs', deltaMs)
      node = byId.get(parent.get(node.id))
    }
  }
  return [...entries.values()]
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 80)
    .map(roundDeep)
}

function add(entries, frame, field, value) {
  const url = frame.url.replace(/([?&])t=[^&]+/g, '$1t=[redacted]')
  const key = `${frame.functionName}|${url}|${frame.lineNumber}`
  const entry = entries.get(key) || {function: frame.functionName || '(anonymous)', url, line: frame.lineNumber + 1, selfMs: 0, totalMs: 0}
  entry[field] += value
  entries.set(key, entry)
}

function roundDeep(value) {
  if (typeof value === 'number') return Number(value.toFixed(3))
  if (Array.isArray(value)) return value.map(roundDeep)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundDeep(item)]))
  return value
}
