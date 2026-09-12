import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const root = new URL('../../../', import.meta.url)
const dev = JSON.parse(await readFile(new URL('.kite3d/dev.json', root), 'utf8'))
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal'],
})

try {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1})
  await page.addInitScript(() => localStorage.setItem('terminator.settings.v1', JSON.stringify({quality: 'high', controlsSeen: true})))
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').waitFor({state: 'visible', timeout: 30_000})
  await page.getByTestId('play').click()
  await page.getByTestId('menu-play').waitFor({state: 'visible', timeout: 45_000})
  await page.evaluate(() => {
    const {viewer} = window
    Object.assign(viewer.container.style, {
      position: 'fixed', left: '0', top: '0', width: '1920px', height: '1080px',
      maxWidth: 'none', maxHeight: 'none', zIndex: '2147483000',
    })
    viewer.setSize({width: 1920, height: 1080})
    viewer.renderManager.renderScale = 1
    viewer.resize()
    window.terminator.manager.ui.screens.show('bindings')
    viewer.setDirty()
  })
  await page.getByTestId('bind-jump').waitFor({state: 'visible'})
  await page.waitForTimeout(200)
  await page.screenshot({path: new URL('controls.png', import.meta.url).pathname})
} finally {
  await browser.close()
}
