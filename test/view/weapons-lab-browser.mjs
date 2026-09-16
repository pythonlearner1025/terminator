import {waitForProjectLoaded,runEditor,stopEditor,getCanvas} from '../helpers/editor-driver.mjs'
// Run after copying this worktree into .kite3d/lab-proof-project and starting its 4683 server.
// Uses a private headless browser. It never controls the owner's 4310 editor.
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {readFile, writeFile, mkdir} from 'node:fs/promises'
const dev = JSON.parse(await readFile('.kite3d/lab-proof-project/.kite3d/dev.json', 'utf8'))
assert.equal(new URL(dev.url).port, '4683')
const output = '/Users/minjunes/games/terminator-evidence/docs/evidence/weapons-lab'; await mkdir(output, {recursive:true})
const browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--use-angle=metal']})
const context = await browser.newContext({viewport:{width:1920,height:1080}, deviceScaleFactor:1, acceptDownloads:true})
await context.grantPermissions(['clipboard-read','clipboard-write'], {origin:new URL(dev.url).origin})
const page = await context.newPage(), errors = [], missing = []
const safe = text => String(text).replace(/([?&]t=)[^&\s"']+/g, '$1[private]')
page.on('pageerror', error => errors.push(safe(error.message)))
page.on('console', event => {if (event.type() === 'error') errors.push(safe(event.text()))})
page.on('response', response => {if (response.status() >= 400) missing.push(new URL(response.url()).pathname)})
const click = id => page.getByTestId(id).click()
const evaluate = fn => page.evaluate(fn)
const range = id => click('range-' + id)
const proof = {controls:[], screenshots:[], errors, missing}
async function fullViewport() {
  await evaluate(() => {
    const v = window.viewer; window.labOriginalContainerStyle = v.container.getAttribute('style') || ''
    Object.assign(v.container.style,{position:'fixed',left:'0',top:'0',width:'1920px',height:'1080px',maxWidth:'none',maxHeight:'none',zIndex:'999'})
    v.setSize({width:1920,height:1080}); v.resize(); v.setDirty()
  })
}
async function screenshot(name) {await page.waitForTimeout(200); await page.screenshot({path:`${output}/${name}.png`}); proof.screenshots.push(`${output}/${name}.png`)}
async function timeline(fraction) {await page.getByTestId('lab-scrubber').fill(String(fraction))}
try {
  await page.addInitScript(() => localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',controlsSeen:true})))
  await page.goto(dev.url, {waitUntil:'domcontentloaded'})
  await runEditor(page,{timeout:60000})
  await page.waitForFunction(() => window.terminator?.manager?.started, null, {timeout:90000})
  await evaluate(() => window.terminator.manager.ready)
  await fullViewport(); await page.waitForTimeout(1500)
  assert.equal(await evaluate(() => window.terminator.world.units.length),18)
  assert.equal(await page.locator('.tm-screen').count(),0)
  assert.equal(await evaluate(() => window.terminator.manager.director.sandboxPaused),true)
  assert.equal(await evaluate(() => window.terminator.world.sandbox.infiniteAmmo),true)
  await range('time-0'); const stopped = await evaluate(() => window.terminator.world.tick)
  await page.waitForTimeout(250); assert.equal(await evaluate(() => window.terminator.world.tick),stopped)
  await range('step-once'); await page.waitForFunction(t => window.terminator.world.tick === t + 1, stopped)
  proof.controls.push('Direct Play boot, 18 static dummies, sandbox ammo, fixed tick pause and step')
  await screenshot('01-firing-line')
  // Confirm dev reference routes and weapon selection using the public controls.
  for (const id of ['pistol','m4','shotgun','plasma','knife','grenade','sniper','launcher']) {
    await range('weapon-' + id)
    await page.waitForFunction(() => [...document.querySelectorAll('.lab-frames img')].every(i => i.complete && i.naturalWidth > 0))
    assert.equal(await evaluate(() => window.terminator.world.player.activeWeapon),id)
    assert.equal(await page.locator('.lab-frames img').count(),8)
  }
  proof.controls.push('All eight loadouts and all 64 reference image URLs')
  await range('weapon-pistol'); await click('lab-frame-0'); await click('lab-match')
  await page.keyboard.press('F1')
  assert.equal(await page.getByTestId('range-panel').isVisible(),false)
  assert.equal(await evaluate(() => window.terminator.manager.rangeView.inspecting),true)
  const comparison = await evaluate(() => {
    const c = window.viewer.canvas.getBoundingClientRect(), r = document.querySelector('[data-testid=lab-comparison]').getBoundingClientRect()
    return {canvas:[c.x,c.y,c.width,c.height],reference:[r.x,r.y,r.width,r.height]}
  })
  assert.equal(comparison.canvas[3],comparison.reference[3]); assert.equal(comparison.canvas[0]+comparison.canvas[2],comparison.reference[0])
  await screenshot('02-revolver-reference')
  await click('lab-overlay'); await page.getByTestId('lab-opacity').fill('0.35')
  assert.equal(await page.getByTestId('lab-comparison').evaluate(node => node.style.opacity),'0.35')
  assert.equal(await evaluate(() => window.viewer.canvas.getBoundingClientRect().width),1920)
  await click('lab-unpin'); assert.equal(await page.getByTestId('lab-comparison').isVisible(),false)
  proof.controls.push('Pinned reference, matched orbit preset, equal-height split, overlay opacity and canvas restoration')
  await page.keyboard.press('F2')
  assert.equal(await page.locator('[data-testid=lab-debug]').count(),0)
  assert.equal(await evaluate(() => Boolean(window.terminator.manager.lab.panel)),false)
  await evaluate(() => {window.viewer.container.setAttribute('style',window.labOriginalContainerStyle)})
  await stopEditor(page)
  await page.waitForFunction(() => !document.querySelector('[data-testid=weapons-lab]'))
  assert.equal(await page.locator('[data-weapons-lab-style]').count(),0)
  await runEditor(page)
  await page.waitForFunction(() => window.terminator?.manager?.started)
  await stopEditor(page)
  proof.controls.push('F2 removed, Stop cleanup and second Play boot')
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[])
  await writeFile('.kite3d/weapons-lab-proof.json',JSON.stringify(proof,null,2)+'\n')
  console.log(JSON.stringify(proof,null,2))
} catch(error) {
  console.error(safe(error.stack));console.error(JSON.stringify({errors,missing}))
  await page.screenshot({path:'.kite3d/lab-proof-failure.png'});process.exitCode=1
} finally {await browser.close()}
