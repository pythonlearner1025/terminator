import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const dev=JSON.parse(await readFile(new URL('../../../.kite3d/dev.json',import.meta.url),'utf8'))
if(new URL(dev.url).port!=='4650')throw Error('Expected port 4650')
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()})
const errors=[],checks=[]
const clients=[]
const check=(value,label)=>{assert.ok(value,label);checks.push(label)}
try{
  for(let i=0;i<2;i++){
    const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1})
    await context.request.get(dev.url)
    await context.addInitScript(()=>localStorage.setItem('terminator.settings.v1',JSON.stringify({controlsSeen:true})))
    const page=await context.newPage()
    page.on('pageerror',error=>errors.push(error.message.replace(/([?&]t=)[^&\s]+/g,'$1[redacted]')))
    await page.goto(`${dev.origin}/files/docs/evidence/pass-presentation/runtime.html?partyRelay=ws://localhost:7811&skynetServer=http://localhost:7811`)
    await page.waitForFunction(()=>window.terminator?.manager?.ui.screens.route==='main',null,{timeout:90000})
    clients.push({page,context})
  }
  const host=clients[0].page,guest=clients[1].page
  await host.getByTestId('host-party').click()
  await host.getByTestId('difficulty').selectOption('hell')
  await host.waitForFunction(()=>terminator.manager.partyState?.status==='lobby')
  const code=await host.evaluate(()=>terminator.manager.partyState.code)
  await guest.getByTestId('join-party').click()
  await guest.getByLabel('NAME',{exact:true}).fill('Reese')
  await guest.getByLabel('CODE / INVITE',{exact:true}).fill(code)
  await guest.getByLabel('RELAY',{exact:true}).fill('ws://localhost:7811')
  await guest.getByTestId('join-party-submit').click()
  await guest.waitForFunction(()=>terminator.manager.partyState?.status==='lobby')
  check(await host.getByTestId('party-start').isDisabled(),'Host Start waits for guest readiness')
  await host.getByTestId('party-ready').click()
  await guest.evaluate(()=>{terminator.manager.ui.screens.settings.controlsSeen=false})
  await guest.getByTestId('party-ready').click()
  await guest.waitForFunction(()=>terminator.manager.ui.screens.route==='controls')
  await guest.keyboard.press('Space')
  await guest.waitForFunction(()=>terminator.manager.ui.screens.route==='party-join')
  check(await guest.evaluate(()=>terminator.manager.ui.screens.settings.controlsSeen),'First-time guest dismisses controls before readiness')
  await host.getByTestId('party-start').click()
  await host.waitForFunction(()=>terminator.world.phase==='wave',null,{timeout:60000})
  await host.evaluate(()=>{for(const player of terminator.world.players.values())player.hp=1000000})
  await guest.waitForFunction(()=>terminator.world.phase==='wave' && !terminator.manager.ui.screens.route,null,{timeout:60000})
  check((await guest.getByTestId('wave-block').innerText()).includes('HELL ON EARTH'),'Guest HUD receives host difficulty through real relay snapshots')
  check(await guest.evaluate(()=>terminator.world.waveBudget===1210 && terminator.world.scaling.unitHealthMultiplier===2.16),'Two-player Hell on Earth uses combined budget and health scaling')
  await guest.getByRole('button',{name:'Pause',exact:true}).click()
  await guest.getByTestId('settings').click()
  await guest.getByTestId('bindings').click()
  const tick=await guest.evaluate(()=>terminator.world.tick)
  await guest.waitForTimeout(500)
  check(await guest.evaluate(tick=>terminator.world.tick>tick,tick),'Online simulation continues while guest rebinds')
  await guest.getByTestId('back').click();await guest.getByTestId('back').click();await guest.getByTestId('resume').click()
  check(errors.length===0,'No page errors in host and guest flow')
}finally{
  await writeFile(new URL('party-results.json',import.meta.url),JSON.stringify({checks,errors},null,2)+'\n')
  console.log(JSON.stringify({checks,errors}))
  await browser.close()
}
