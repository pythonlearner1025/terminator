// Static HTML only: one CPU headless browser, inherited cgroup, always closed.
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {launchCaptureBrowser} from './capture-browser.mjs'
const [input, output] = process.argv.slice(2)
if (!input || !output) throw Error('Usage: node integrate-public-preview.mjs PUBLIC_DIR PREVIEW_DIR')
process.env.CHROME_ARGS = JSON.stringify(['--disable-gpu', '--disable-dev-shm-usage'])
process.env.CHROME_HEADED = '0'
const destination = resolve(output)
await mkdir(destination, {recursive: true})
const browser = await launchCaptureBrowser()
try {
  const errors = []
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1})
  page.on('pageerror', error => errors.push(error.message))
  page.on('requestfailed', request => errors.push(`Request failed: ${new URL(request.url()).pathname.split('/').pop()}`))
  await page.goto(pathToFileURL(resolve(input, 'index.html')).href)
  const report = await page.evaluate(() => {
    const style = getComputedStyle(document.body)
    return {fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight,
      color: style.color, background: getComputedStyle(document.documentElement).backgroundColor,
      maxWidth: style.maxWidth, bullets: [...document.querySelectorAll('.recap li')].map(node => node.textContent),
      columns: [...document.querySelectorAll('.columns span')].map(node => node.textContent)}
  })
  assert.ok(report.fontFamily.startsWith('"Times New Roman"'))
  assert.equal(report.fontSize, '17px')
  assert.equal(report.lineHeight, '22.1px')
  assert.equal(report.color, 'rgb(0, 0, 0)')
  assert.equal(report.background, 'rgb(255, 255, 255)')
  assert.equal(report.bullets.length, 4)
  assert.ok(report.bullets.join(' ').split(/\s+/).length <= 110)
  assert.deepEqual(report.columns, ['Before', 'V2 target', 'Latest progress'])
  await page.screenshot({path: resolve(destination, 'desktop-recap.png')})
  await page.locator('#compare-five-views').scrollIntoViewIfNeeded()
  const images = page.locator('img')
  assert.equal(await images.count(), 15)
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded()
    await image.evaluate(async img => {await img.decode(); const target = img.closest('figure').dataset.group === 'target'; if (img.naturalWidth !== (target ? 1672 : 1920) || img.naturalHeight !== (target ? 941 : 1080)) throw Error('Unexpected native image dimensions')})
  }
  await page.locator('#compare-five-views').evaluate(node => node.scrollIntoView())
  await page.screenshot({path: resolve(destination, 'desktop-comparison.png')})
  await page.locator('#original-prompt').evaluate(node => node.scrollIntoView())
  await page.screenshot({path: resolve(destination, 'desktop-prompt.png')})
  const copy = JSON.parse(await readFile(resolve(input, 'public-copy.json'), 'utf8'))
  for (const excerpt of copy.excerpts) assert.equal(await page.locator(`[data-excerpt="${excerpt.id}"]`).textContent(), excerpt.text)
  await page.setViewportSize({width: 390, height: 844})
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({path: resolve(destination, 'mobile-recap.png')})
  await page.locator('#compare-five-views').evaluate(node => node.scrollIntoView())
  await page.screenshot({path: resolve(destination, 'mobile-comparison.png')})
  await page.locator('#original-prompt').evaluate(node => node.scrollIntoView())
  await page.screenshot({path: resolve(destination, 'mobile-prompt.png')})
  const mobile = await page.evaluate(() => ({width: innerWidth, documentWidth: document.documentElement.scrollWidth}))
  assert.equal(mobile.width, mobile.documentWidth, 'Mobile body overflows horizontally')
  assert.deepEqual(errors, [])
  const session = await browser.newBrowserCDPSession()
  const {processInfo} = await session.send('SystemInfo.getProcessInfo')
  await session.detach()
  const own = (await readFile('/proc/self/cgroup', 'utf8')).split('\n').find(line => line.startsWith('0::'))
  for (const process of processInfo) assert.equal((await readFile(`/proc/${process.id}/cgroup`, 'utf8')).split('\n').find(line => line.startsWith('0::')), own)
  await writeFile(resolve(destination, 'checks.json'), JSON.stringify({browser: browser.version(), mode: 'CPU headless static HTML; GPU disabled; no game runtime', report, images: 15, nativeDimensions: {gameCaptures: [1920, 1080], generatedTargets: [1672, 941]}, exactQuotes: 7, errors, mobile, cgroup: 'All Chrome processes match inherited task cgroup before and after page load', browserClosedInFinally: true}, null, 2) + '\n')
  console.log('Static desktop/mobile preview PASS; 15 native PNGs, seven exact quotes, no errors; inherited cgroup verified.')
} finally {
  await browser.close()
}
