import {chromium} from 'playwright'
import {readFile, writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const dev = JSON.parse(await readFile('.kite3d/dev.json', 'utf8'))
assert.equal(new URL(dev.url).port, '4640')
const browser = await chromium.launch({executablePath: chromium.executablePath(), headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']})
const page = await browser.newPage()
try {
  await page.request.get(dev.url)
  await page.route('**/audio-lifecycle.html', r => r.fulfill({contentType:'text/html',body:'<!doctype html><title>Audio lifecycle</title>'}))
  await page.goto(dev.origin + '/audio-lifecycle.html')
  const result = await page.evaluate(async () => {
    const {WebAudioEngine} = await import('/files/lib/audio/engine.js')
    const {SOUND_CATALOG} = await import('/files/lib/audio/catalog.js')
    const a = new WebAudioEngine({logger: null})
    a.start(); await a.unlock()
    a.play('pistol_9mm'); a.startLoop('minigun_loop', {tag: 'test'})
    const oldContext = a.context
    await a.stop()
    a.start(); await a.unlock()
    const restarted = a.context.state === 'running' && a.stats.loaded === 101 && a.loops.has('ambient-bed') && oldContext.state === 'closed'
    await a.stop()
    a.start()
    const loading = a.unlock()
    await a.stop()
    await loading
    const cancelled = !a.running && !a.context && a.buffers.size === 0 && a.loops.size === 0
    const broken = new WebAudioEngine({logger:null, catalog:{pistol_9mm:{...SOUND_CATALOG.pistol_9mm,
      variants:SOUND_CATALOG.pistol_9mm.variants.map(v=>({...v,file:'missing-fixture.ogg'}))}}})
    broken.start({ambient:false}); await broken.unlock()
    const voice = broken.play('pistol_9mm')
    const fallback = Boolean(voice) && broken.stats.synthPlays === 1 && broken.stats.failed.length === 1
    await broken.stop()
    return {restarted, cancelled, fallback}
  })
  assert.ok(result.restarted && result.cancelled && result.fallback)
  await writeFile(new URL('lifecycle.json', import.meta.url), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally { await browser.close() }
