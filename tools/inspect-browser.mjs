#!/usr/bin/env node
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const dev = JSON.parse(await readFile(new URL('../.kite3d/dev.json', import.meta.url), 'utf8'))
const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({executablePath, headless: true})
const page = await browser.newPage({viewport: {width: 1440, height: 1000}})
const messages = []
const safe = (text) => String(text).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]')
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') messages.push(`${message.type()}: ${safe(message.text())}`)
})
page.on('pageerror', (error) => messages.push(`pageerror: ${safe(error.stack || error.message)}`))
await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
await page.getByTestId('play').click()
await page.waitForFunction(() => Boolean(window.viewer), {timeout: 15000})
await page.waitForTimeout(1500)
if (process.argv.includes('--ai')) {
  const rect = await page.evaluate(() => {
    const value = window.viewer.canvas.getBoundingClientRect()
    return {x: value.left, y: value.top, width: value.width, height: value.height}
  })
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await page.mouse.down({button: 'left'})
  await page.waitForTimeout(500)
  await page.mouse.up({button: 'left'})
  await page.waitForTimeout(10000)
}
const state = await page.evaluate(() => ({
  modelNames: window.viewer?.scene?.modelRoot?.children?.map((item) => item.name) || [],
  manager: Boolean(window.terminator?.manager),
  world: Boolean(window.terminator?.world),
  phase: window.terminator?.phase,
  hud: Boolean(document.querySelector('[data-testid="terminator-hud"]')),
  unitCount: window.terminator?.world?.units?.length ?? -1,
  player: window.terminator?.world ? {pos: window.terminator.world.player.pos, hp: window.terminator.world.player.hp} : null,
  units: window.terminator?.world?.units?.map((unit) => ({id: unit.id, pos: unit.pos, intent: unit.intent, path: unit.pathCache.path?.length, pathIndex: unit.pathCache.index, visible: unit.playerVisible})) || [],
  sounds: window.terminator?.world?.sounds?.length ?? -1,
}))
console.log(JSON.stringify({state, messages}, null, 2))
const output = process.argv.find((value) => value.endsWith('.png'))
if (output) await page.screenshot({path: output, fullPage: true})
await browser.close()
