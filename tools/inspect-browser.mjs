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
const state = await page.evaluate(() => ({
  modelNames: window.viewer?.scene?.modelRoot?.children?.map((item) => item.name) || [],
  manager: Boolean(window.terminator?.manager),
  world: Boolean(window.terminator?.world),
  phase: window.terminator?.phase,
  hud: Boolean(document.querySelector('[data-testid="terminator-hud"]')),
  unitCount: window.terminator?.world?.units?.length ?? -1,
}))
console.log(JSON.stringify({state, messages}, null, 2))
if (process.argv[2]) await page.screenshot({path: process.argv[2], fullPage: true})
await browser.close()
