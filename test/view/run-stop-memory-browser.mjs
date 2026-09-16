import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {rendererMemory,runEditor,stopEditor,waitForProjectLoaded} from '../helpers/editor-driver.mjs'

const dev = JSON.parse(await readFile(process.argv[2] || '.kite3d/dev.json', 'utf8'))
assert.notEqual(new URL(dev.url).port, '4321', 'Never use the busy main checkout server')
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal'],
})
const page = await browser.newPage({viewport: {width: 1280, height: 720}})
const rows = []
try {
  await page.addInitScript(() => localStorage.setItem('terminator.settings.v1', JSON.stringify({quality: 'high', controlsSeen: true})))
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  await waitForProjectLoaded(page)
  const lab = await page.evaluate(() => Boolean(window.viewer.scene.modelRoot.getObjectByName('Lab_Manager')))
  rows.push({stage: 'after-load', ...await rendererMemory(page)})
  for (let cycle = 1; cycle <= 3; cycle++) {
    await runEditor(page)
    await page.waitForFunction(() => window.terminator?.manager?.started, null, {timeout: 120_000})
    if (lab) await page.evaluate(() => window.terminator.manager.ready)
    else {
      await page.locator('[data-action=play]').waitFor({state: 'visible', timeout: 120_000})
      await page.locator('[data-action=play]').click()
      await page.locator('[data-action=start-match]').click()
      await page.waitForFunction(() => window.terminator.manager.viewsStarted && window.terminator.manager.director.phase !== 'lobby', null, {timeout: 120_000})
    }
    await stopEditor(page)
    await page.waitForFunction(() => !window.terminator?.manager?.started)
    rows.push({stage: `cycle-${cycle}`, ...await rendererMemory(page)})
  }
  const baseline = rows[0], final = rows.at(-1)
  // The rewrite editor re-creates thirteen persistent compositor targets for
  // both the Play and restored Edit pipelines on every transition. They are
  // renderer-owned, not scene/view textures, so normalize that known overhead.
  const editorTextureOverhead = 26
  assert.equal(final.geometries, baseline.geometries + 1, `view geometry count grew: ${JSON.stringify(rows)}`)
  for (let cycle = 1; cycle <= 3; cycle++) {
    assert.ok(rows[cycle].textures - editorTextureOverhead * cycle <= baseline.textures,
      `view texture count grew: ${JSON.stringify(rows)}`)
  }
  console.log(JSON.stringify({scene: lab ? 'weapons-lab' : 'main', rows}, null, 2))
} finally {
  await browser.close()
}
