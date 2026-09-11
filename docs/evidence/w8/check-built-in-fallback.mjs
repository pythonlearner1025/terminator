#!/usr/bin/env node
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'

const root = new URL('../../../', import.meta.url)
const kite = spawn('npx', ['kite3d', 'dev', '--port', '4700', '--no-open', '--force'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
const editorUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Kite3D did not start within 20 seconds')), 20_000)
  const onData = (chunk) => {
    output += String(chunk)
    const match = output.match(/Kite3D editor: (http:\/\/[^\s]+)/)
    if (!match) return
    clearTimeout(timer)
    resolve(match[1])
  }
  kite.stdout.on('data', onData)
  kite.stderr.on('data', onData)
})

const browser = await chromium.launch({headless: true})
const page = await browser.newPage({viewport: {width: 1280, height: 800}})
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(editorUrl, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').waitFor({state: 'visible', timeout: 20_000})
  await page.waitForFunction(() => !document.body.innerText.includes('Loading project…'), null, {timeout: 90_000})
  await page.getByTestId('play').click()
  await page.waitForFunction(() => Boolean(window.terminator?.manager), null, {timeout: 60_000})
  await page.getByTestId('menu-play').click({force: true})
  await page.waitForFunction(() => document.body.innerText.includes('Built-in Skynet is ready.'), null, {timeout: 8_000})
  await page.getByTestId('start-match').click({force: true})
  await page.waitForFunction(() => window.terminator?.world?.phase === 'wave', null, {timeout: 10_000})
  const result = await page.evaluate(() => ({
    phase: window.terminator.world.phase,
    wave: window.terminator.world.wave,
    skynet: window.terminator.world.skynet.name,
    serverConnected: window.terminator.world.skynet.connected,
    hud: document.querySelector('[data-role="skynet"]')?.textContent,
  }))
  console.log(JSON.stringify({...result, pageErrors: errors}, null, 2))
  await page.getByTestId('play').click({force: true})
} finally {
  await browser.close()
  kite.kill('SIGINT')
}
