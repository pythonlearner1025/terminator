#!/usr/bin/env node
import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
const log=await readFile('.kite3d/w11-dev.log','utf8')
const url=log.match(/http:\/\/127\.0\.0\.1:4950\/\?t=[A-Za-z0-9._~-]+/)?.[0]
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const page=await browser.newPage({viewport:{width:1920,height:1080}})
const errors=[]
page.on('pageerror',e=>errors.push(e.message.replace(/\?t=[A-Za-z0-9._~-]+/g,'?t=[redacted]')))
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().replace(/\?t=[A-Za-z0-9._~-]+/g,'?t=[redacted]'))})
try {
  await page.goto(url,{waitUntil:'domcontentloaded'})
  await page.getByTestId('play').waitFor({timeout:30000});await page.waitForTimeout(1500)
  if(!await page.evaluate(()=>!!window.terminator?.world))await page.getByTestId('play').click()
  await page.waitForFunction(()=>!!window.terminator?.world,null,{timeout:30000})
  await page.evaluate(()=>{const m=window.terminator.manager;m.ui.screens.show(null);m.director.start();m.world.player.hp=10000})
  await page.waitForFunction(()=>window.terminator?.world?.tick>90&&window.terminator.world.aliveUnits.length>0,null,{timeout:20000})
  const results=[]
  for(const id of ['pistol','m4','shotgun','plasma']) {
    await page.evaluate(id=>{const w=window.terminator.world;w.player.ammo[id]={owned:true,mag:w.weaponCatalog.weapons[id].mag,reserve:100};w.switchWeapon(id)},id)
    await page.waitForTimeout(400)
    const clip=await page.evaluate(()=>{const r=window.viewer.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})
    await page.mouse.move(clip.x+clip.width*.5,clip.y+clip.height*.5)
    await page.mouse.down();await page.waitForTimeout(250);await page.mouse.up()
    await page.evaluate(()=>document.exitPointerLock())
    await page.keyboard.press('r');await page.waitForTimeout(120)
    results.push(await page.evaluate(id=>({id,tick:window.terminator.world.tick,units:window.terminator.world.aliveUnits.length,mode:window.terminator.manager.playerView.weapons.animation.state.mode,shots:window.terminator.world.eventLog.filter(e=>e.type==='shot'&&e.by==='player'&&e.weapon===id).length,reload:window.terminator.world.player.reloadTimer}),id))
    await page.waitForTimeout(2500)
  }
  await page.keyboard.press('v');await page.waitForTimeout(120)
  const knife=await page.evaluate(()=>window.terminator.manager.playerView.weapons.animation.state.weapon)
  await page.waitForTimeout(550);await page.keyboard.press('g');await page.waitForTimeout(160)
  const grenade=await page.evaluate(()=>window.terminator.manager.playerView.weapons.animation.state.weapon)
  await page.waitForTimeout(1000)
  await page.evaluate(()=>{const m=window.terminator.manager;m.started=false;m.world.player.hp=100;m.syncViews()})
  const clip=await page.evaluate(()=>{const r=window.viewer.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})
  await page.screenshot({path:'docs/evidence/w11/live-wave.png',clip})
  const live={weapons:results,knife,grenade,errors:[...errors],testSetup:'Granted weapon inventory and 10000 health during input testing; restored health to 100 for screenshot'}
  await page.evaluate(()=>document.exitPointerLock())
  const resources=await page.evaluate(()=>{
    const m=window.terminator.manager,v=m.playerView.weapons
    const before=window.viewer.scene.getObjectByName('Player Runtime')!==undefined
    const camera=m.playerView.camera,saved=m.playerView.savedCamera.position.clone()
    m.stop()
    return{runtimeExisted:before,runtimeRemoved:!window.viewer.scene.getObjectByName('Player Runtime'),cameraRestored:camera.position.equals(saved),hudRemoved:!document.querySelector('[data-testid="terminator-hud"]')}
  })
  await page.getByTestId('play').click({force:true})
  await writeFile('docs/evidence/w11/live-results.json',JSON.stringify({live,resources,teardownErrors:errors.slice(live.errors.length)},null,2)+'\n')
  console.log(JSON.stringify({live,resources,teardownErrors:errors.slice(live.errors.length)},null,2))
  if(results.some(r=>r.shots===0||r.reload<=0)||knife!=='knife'||grenade!=='grenade')throw Error('Real input weapon test failed; see live-results.json')
}finally{await browser.close()}
