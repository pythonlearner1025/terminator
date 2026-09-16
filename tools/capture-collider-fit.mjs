#!/usr/bin/env node
import assert from 'node:assert/strict'
import {mkdir, readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const name = process.argv[2]
assert.ok(name === 'before' || name === 'after', 'usage: node tools/capture-collider-fit.mjs before|after')
const root = new URL('../', import.meta.url)
const output = new URL(`file:///Users/minjunes/games/terminator-evidence/docs/evidence/hitboxes/${name}.png`)
const dev = JSON.parse(await readFile(new URL('.kite3d/dev.json', root), 'utf8'))
assert.equal(new URL(new URL(dev.url).origin).port, '4687')
await mkdir(new URL('file:///Users/minjunes/games/terminator-evidence/docs/evidence/hitboxes/'), {recursive: true})
const browser = await chromium.launch({executablePath: chromium.executablePath(), headless: true})
const page = await browser.newPage({viewport: {width: 1600, height: 1000}, deviceScaleFactor: 1})
const errors = []
const clean = value => String(value).replace(/([?&]t=)[^&\s)"']+/g, '$1[redacted]')
page.on('pageerror', error => errors.push(clean(error.stack || error.message)))
page.on('console', message => {
  if (message.type() === 'error') errors.push(clean(message.text()))
})
try {
  await page.request.get(dev.url)
  await page.goto(`${new URL(dev.url).origin}/files/tools/map-runtime.html?colliders=1`, {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => window.terminator?.manager?.world, null, {timeout: 90_000})
  await page.evaluate(async () => {
    const manager = window.terminator.manager
    manager.startViews()
    await manager.visualWarmup?.catch(() => {})
    manager.ui.screens.show(null)
    manager.unitView.toggleShowcase(false)
    manager.update = () => true
    manager.input.stop()
    manager.playerView.root.visible = false
    for (const element of document.body.querySelectorAll(':scope > *:not(canvas):not(script)')) element.style.display = 'none'
  })
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const manager = window.terminator.manager
    manager.ui.screens.show(null)
    manager.unitView.toggleShowcase(false)
    const camera = window.viewer.scene.mainCamera
    camera.position.set(21, 22, 28)
    camera.lookAt(0, 0.8, -1)
    camera.fov = 52
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    window.viewer.setDirty()
  })
  await page.waitForTimeout(1_500)
  const clip = await page.evaluate(() => {
    const box = window.viewer.canvas.getBoundingClientRect()
    return {x: box.left, y: box.top, width: box.width, height: box.height}
  })
  await page.screenshot({path: output.pathname, clip})
  const wireframes = await page.evaluate(() => window.viewer.scene.getObjectByName('Collider wireframes')?.children.length || 0)
  assert.ok(wireframes > 0, 'collider wireframes were not created')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({screenshot: output.pathname, wireframes}))
} finally {
  await browser.close()
}
