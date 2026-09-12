import {chromium} from 'playwright'
import {readFile,writeFile,copyFile} from 'node:fs/promises'
import assert from 'node:assert/strict'

const out=new URL('./',import.meta.url), store=new URL('../../store/',import.meta.url)
const dev=JSON.parse(await readFile(new URL('../../../.kite3d/dev.json',import.meta.url),'utf8'))
if(new URL(dev.url).port!=='4650')throw Error('Expected worktree server on 4650')
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()})
const errors=[],checks=[]
const check=(value,label)=>{assert.ok(value,label);checks.push(label)}
const safe=value=>String(value).replace(/([?&]t=)[^&\s"')]+/g,'$1[redacted]')
let benchmark
const shot=async(page,name,directory=out)=>{
  await page.waitForTimeout(350)
  await page.screenshot({path:new URL(name,directory).pathname})
}
async function client({slow=false}={}){
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1})
  await context.request.get(dev.url)
  const page=await context.newPage()
  page.on('pageerror',error=>errors.push(safe(error.message)))
  page.on('console',message=>{if(message.type()==='error')errors.push(safe(message.text()).slice(0,600))})
  if(slow)await page.route('**/assets/store/materials/*',async route=>{
    const index=['albedo','normal','roughness','metalness','ao','emissive'].findIndex(name=>route.request().url().includes(`steel-${name}`))
    await new Promise(resolve=>setTimeout(resolve,350+index*350));await route.continue()
  })
  await page.goto(`${dev.origin}/files/docs/evidence/pass-presentation/runtime.html?skynetServer=http://localhost:7811&partyRelay=ws://localhost:7811`)
  return {context,page}
}

try{
  const {page,context}=await client({slow:true})
  await page.waitForFunction(()=>{const bar=document.querySelector('[data-testid="asset-progress"]');return bar && bar.value>0 && bar.value<bar.max},null,{timeout:90000})
  const progress=await page.getByTestId('asset-progress').evaluate(bar=>({loaded:bar.value,total:bar.max}))
  check(progress.loaded<progress.total,'Loading bar reports completed real asset tasks')
  await shot(page,'03-loading.png')
  await page.waitForFunction(()=>window.terminator?.manager?.ui.screens.route==='main',null,{timeout:90000})
  await page.unroute('**/assets/store/materials/*')
  await page.mouse.move(1600,380)
  await shot(page,'01-menu.png')
  await copyFile(new URL('01-menu.png',out),new URL('01-menu.png',store))
  const first=await page.evaluate(()=>({head:terminator.manager.ui.menuScene.head.rotation.y,tick:terminator.world.tick}))
  await page.mouse.move(400,800)
  await page.waitForTimeout(200)
  check(await page.evaluate(first=>terminator.manager.ui.menuScene.head.rotation.y!==first.head && terminator.world.tick===first.tick,first),'Menu tracks cursor without advancing simulation')
  await page.getByTestId('settings').click()
  await page.getByTestId('bindings').click()
  check(await page.locator('[data-action^="bind:"]').count()===24,'Every input action has a labeled binding control')
  await page.getByTestId('bind-forward').click()
  await page.keyboard.press('KeyI')
  check(await page.getByTestId('bind-forward').innerText()==='I','Keyboard rebinding updates its label')
  await page.getByTestId('bind-aim').click()
  await page.mouse.click(900,960,{button:'middle'})
  check((await page.getByTestId('bind-aim').textContent()).trim()==='Mouse 3','Mouse buttons can be rebound')
  await shot(page,'02-bindings.png')
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem('terminator.settings.v1')).bindings.forward==='KeyI'),'Bindings persist in local storage')
  await page.getByTestId('reset-bindings').click()
  check(await page.getByTestId('bind-forward').innerText()==='W','Reset restores default bindings')
  await page.getByTestId('back').click()
  await page.getByTestId('back').click()
  await page.getByTestId('menu-play').click()
  await page.getByTestId('difficulty').selectOption('hard')
  await page.waitForFunction(()=>terminator.manager.lobby.code)
  await page.getByTestId('start-match').click()
  await page.waitForFunction(()=>terminator.manager.ui.screens.route==='controls')
  check(await page.evaluate(()=>terminator.world.phase==='lobby'),'First-play controls pause before starting the wave')
  await shot(page,'04-controls.png')
  await page.keyboard.press('Space')
  await page.waitForFunction(()=>terminator.world.phase==='wave' && !terminator.manager.ui.screens.route,null,{timeout:60000})
  check(await page.evaluate(()=>terminator.world.waveBudget===525 && terminator.world.scaling.unitHealthMultiplier===1.15),'Selected difficulty reaches live budget and unit health scaling')
  check((await page.getByTestId('wave-block').innerText()).includes('HARD'),'HUD displays selected difficulty')
  await page.evaluate(()=>{window.captureUpdate=terminator.manager.update;terminator.manager.update=()=>true})
  await shot(page,'05-wave.png')
  await copyFile(new URL('05-wave.png',out),new URL('02-bunker.png',store))

  // Store views are actual game renders. Position and loadout are staged through
  // core state, not painted into the screenshots. Gameplay geometry is unchanged.
  await page.evaluate(()=>{
    const m=terminator.manager,w=m.world
    w.player.hp=1000000;w.player.armor=100
    for(const id of ['m4','shotgun','plasma']){w.player.ammo[id].owned=true;w.player.ammo[id].reserve=200}
  })
  for(const [id,name,pos,yaw] of [
    ['m4','03-rifle.png',{x:0,y:0,z:-8},0],
    ['shotgun','04-shotgun.png',{x:12,y:0,z:-9},.85],
    ['plasma','05-plasma.png',{x:-12,y:0,z:9},-.7],
  ]){
    await page.evaluate(({id,pos,yaw})=>{
      const m=terminator.manager,w=m.world
      w.player.pos={...pos};w.player.yaw=yaw;w.player.pitch=0;w.switchWeapon(id)
      m.input.yaw=yaw;m.input.pitch=0;m.input.cursorAnchorYaw=yaw;m.input.cursor=null
      w.player.hp=1000000;w.player.armor=100
      for(let frame=0;frame<24;frame++){m.director.step({yaw,pitch:0});m.syncViews()}
      w.player.hp=100;m.syncViews()
    },{id,pos,yaw})
    await shot(page,name,store)
    await page.evaluate(()=>{terminator.world.player.hp=1000000})
  }

  benchmark=await page.evaluate(async()=>{
    const m=terminator.manager,w=m.world
    m.update=window.captureUpdate
    m.ui.screens.show(null);m.ui.screens.ended=false
    w.phase=m.director.phase='wave';w.player.alive=true;w.player.downed=false
    m.lobby.stop()
    w.units=[];m.director.spawnSchedule=[];m.director.nextSpawn=0
    w.player.pos={x:0,y:0,z:0};w.player.hp=1000000;w.player.armor=100
    w.player.yaw=0;w.player.pitch=0;m.input.yaw=0;m.input.pitch=0;m.input.cursorAnchorYaw=0;m.input.cursor=null
    w.switchWeapon('plasma');w.player.ammo.plasma.mag=20;w.player.ammo.plasma.reserve=10000
    for(let i=0;i<24;i++){
      const angle=(i/24)*Math.PI*2
      const unit=w.spawnUnit(['endo','scout','heavy'][i%3],{x:Math.sin(angle)*10,y:0,z:Math.cos(angle)*10},{yaw:angle+Math.PI})
      unit.hp=unit.maxHp=1000000
    }
    m.ui.setInput(true)
    m.ui.bindings.held.add('Mouse0')
    const samples=[];let last=performance.now();let lastGrenade=last
    const renderer=m.ctx.viewer.renderManager.renderer,gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info')
    const gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)
    await new Promise(resolve=>setTimeout(resolve,2500))
    const eventsFrom=w.eventLog.length
    const start=performance.now();last=start
    let minAlive=24,maxAlive=24
    const frame=()=>{
      const now=performance.now();samples.push(now-last);last=now
      minAlive=Math.min(minAlive,w.aliveUnits.length);maxAlive=Math.max(maxAlive,w.aliveUnits.length)
      if(now-lastGrenade>2000){w.player.grenades=4;m.ui.bindings.pulses.add('grenade');lastGrenade=now}
      if(w.player.ammo.plasma.mag<2)w.player.ammo.plasma.mag=20
    }
    m.ctx.viewer.addEventListener('postRender',frame)
    await new Promise(resolve=>setTimeout(resolve,15000))
    m.ctx.viewer.removeEventListener('postRender',frame);m.ui.bindings.held.clear()
    const elapsed=performance.now()-start
    const sorted=[...samples].sort((a,b)=>a-b)
    const events=w.eventLog.slice(eventsFrom)
    return {durationMs:elapsed,samples:samples.length,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,
      medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],
      fps:samples.length/elapsed*1000,minAlive,maxAlive,gpu,width:1920,height:1080,quality:m.ui.screens.settings.quality,
      shots:events.filter(e=>e.type==='shot').length,explosions:events.filter(e=>/explosion/.test(e.type)).length,
      ticks:w.tick,phase:w.phase,effectsEnabled:true,fixture:'8 Endo, 8 Scout, 8 Heavy; elevated health preserves 24 alive; automatic plasma fire and grenade pulses; no rendering or AI disabled'}
  })
  check(benchmark.minAlive===24 && benchmark.maxAlive===24,'Benchmark retains exactly 24 live enemies')
  check(benchmark.shots>0 && benchmark.explosions>0,'Benchmark includes active gunfire and explosions')
  await page.evaluate(()=>{
    const m=terminator.manager,w=m.world
    for(const unit of w.aliveUnits)w.damageUnit(unit.id,2000000,{source:'player',playerId:w.hostPlayerId,weapon:'plasma'})
    m.director.finishWave()
    w.player.hp=100;w.player.armor=60;w.player.scrap=2150
    m.ui.screens.show('trader');m.syncViews()
  })
  await shot(page,'06-trader.png',store)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.getByTestId('main-menu').click()
  await page.waitForFunction(()=>terminator.manager.ui.screens.route==='main')
  await page.getByTestId('menu-play').click()
  await page.getByTestId('start-match').click()
  await page.waitForFunction(()=>terminator.world.phase==='wave' && !terminator.manager.ui.screens.route)
  await page.waitForTimeout(1500)
  check(await page.evaluate(()=>terminator.manager.ui.screens.settings.controlsSeen),'Controls card stays dismissed on the next match')
  await context.close()

  // Native SVG rasterization, not a retouched screenshot.
  const iconPage=await browser.newPage({viewport:{width:512,height:512},deviceScaleFactor:1})
  await iconPage.setContent(await readFile(new URL('../../../icon.svg',import.meta.url),'utf8'))
  await iconPage.addStyleTag({content:'html,body{margin:0;width:512px;height:512px;background:transparent}svg{display:block}'})
  await iconPage.screenshot({path:new URL('icon.png',store).pathname,omitBackground:true})
  await copyFile(new URL('icon.png',store),new URL('../../../assets/store/icon.png',import.meta.url))
  await iconPage.close()
  check(errors.length===0,`No browser errors: ${errors.join('; ')}`)
}finally{
  await writeFile(new URL('results.json',out),JSON.stringify({checks,benchmark,errors},null,2)+'\n')
  console.log(JSON.stringify({checks:checks.length,benchmark,errors}))
  await browser.close()
}
