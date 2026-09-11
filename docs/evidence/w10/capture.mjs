#!/usr/bin/env node
// Deterministic visual scenarios driven through the running game's exposed World.
// Scenario setup teleports actors, applies core damage and shortens a wave. No HUD is mocked.
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const out=new URL('./',import.meta.url)
const dev=JSON.parse(await readFile(process.env.W10_DEV_CONFIG || '/tmp/terminator-w10-dev.json','utf8'))
assert.equal(new URL(dev.url).port,'4800','Evidence must use W10 server on port 4800')
const server=process.env.W10_LOBBY_URL || 'http://127.0.0.1:7802'
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,permissions:['clipboard-read','clipboard-write']})
await context.addCookies([{name:'kite3d-token',value:new URL(dev.url).searchParams.get('t'),url:dev.origin || new URL(dev.url).origin,httpOnly:true,sameSite:'Strict'}])
const imports=await (await context.request.get(new URL('/api/import-map',dev.url).href)).json()
const page=await context.newPage()
page.setDefaultTimeout(60000)
const report={screenshots:[],assertions:[],console:[],scenarios:'Core-driven staged combat; real local lobby HTTP join, taunt and dossier fixture.'}
const clean=s=>String(s).replace(/([?&]t=)[^\s&)]+/g,'$1[redacted]')
page.on('console',m=>{if(['error','warning'].includes(m.type()))report.console.push(`${m.type()}: ${clean(m.text())}`)})
page.on('pageerror',e=>report.console.push(`pageerror: ${clean(e.message)}`))
const screen=()=>page.locator('[data-testid="game-screen"]')
const action=name=>page.locator(`[data-action="${name}"]`).filter({visible:true}).first().click()
async function capture(name){
 // Freeze an already-rendered core frame during GPU readback, preserving visible animation progress.
 await page.evaluate(()=>{const m=window.terminator?.manager;window.w10Capture={m,started:m?.started,animations:document.getAnimations().filter(a=>a.playState==='running')};if(m)m.started=false;window.w10Capture.animations.forEach(a=>a.pause())})
 try{await page.screenshot({path:new URL(name,out).pathname,timeout:60000});report.screenshots.push(name);console.log('Captured '+name)}
 finally{await page.evaluate(()=>{const c=window.w10Capture;if(c?.m)c.m.started=c.started;c?.animations.forEach(a=>a.play());delete window.w10Capture})}
}
async function ticks(n){const t=await page.evaluate(()=>window.terminator.world.tick);await page.waitForFunction(t=>window.terminator.world.tick>=t,t+n,{timeout:10000})}
async function release(){await page.evaluate(()=>{if(document.pointerLockElement)document.exitPointerLock()})}
async function layout(label){const result=await page.evaluate(()=>{const h=document.querySelector('.tm-hud'),r=h.getBoundingClientRect(),s=document.querySelector('.tm-screen');return {width:r.width,height:r.height,hudFits:h.scrollWidth<=h.clientWidth,screenFits:!s || s.hidden || (s.scrollWidth<=s.clientWidth && s.scrollHeight<=s.clientHeight+1)}});assert.ok(result.hudFits && result.screenFits,`${label}: ${JSON.stringify(result)}`);report.assertions.push({layout:label,...result})}
try{
 await mkdir(out,{recursive:true})
 // Boot the normal Kite3D runtime without editor hot reload interrupting other agents' edits.
 await writeFile(new URL('runtime.html',out),`<!doctype html><html><head><meta charset="utf-8"><title>Terminator W10 playtest</title><style>html,body,main{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%}</style><script type="importmap">${JSON.stringify(imports).replaceAll('<','\\u003c')}</script></head><body><main><canvas id="game"></canvas></main><script type="module">import {createGame} from '@kite3d/engine';window.w10Runtime=await createGame({base:new URL('/files/',location.href).href,canvas:document.getElementById('game')});</script></body></html>`)
 await page.goto(`${new URL(dev.url).origin}/files/docs/evidence/w10/runtime.html?skynetServer=${encodeURIComponent(server)}`,{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>Boolean(window.terminator?.manager?.ui),undefined,{timeout:25000})
 await page.waitForFunction(()=>window.viewer.canvas.getBoundingClientRect().width===1920)
 await page.waitForTimeout(500)
 await capture('01-main-menu.png');await layout('main 1920x1080')
 const eyeBefore=await page.locator('.tm-tracking-eyes').evaluate(el=>getComputedStyle(el).transform)
 await page.mouse.move(1500,250);await page.waitForTimeout(150)
 assert.notEqual(await page.locator('.tm-tracking-eyes').evaluate(el=>getComputedStyle(el).transform),eyeBefore)
 await action('settings')
 await page.getByLabel('Field of view').evaluate(el=>{el.value='84';el.dispatchEvent(new Event('input',{bubbles:true}))})
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('terminator.settings.v1')).fov),84)
 assert.equal(await page.evaluate(()=>window.viewer.scene.mainCamera.fov),84)
 await capture('02-settings.png');await layout('settings 1920x1080')
 await action('back');await action('quit');await capture('03-quit.png');await action('main-menu')
 assert.equal(await page.evaluate(()=>window.viewer.scene.mainCamera.fov),84)
 await action('play')
 await page.waitForFunction(()=>Boolean(window.terminator.manager.lobby.code),undefined,{timeout:10000})
 await capture('04-lobby-waiting.png')
 await action('copy-mcp')
 assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes('claude mcp add skynet'))
 const code=await page.evaluate(()=>window.terminator.manager.lobby.code)
 const join=await fetch(`${server}/api/lobby/${code}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'W10 TEST AGENT',agent_info:{purpose:'HUD integration evidence'}})})
 assert.equal(join.status,200)
 const joined=await join.json()
 const headers={'Content-Type':'application/json',Authorization:`Bearer ${joined.token}`}
 const dossier={markdown:'# Human behavior report\n\n**Subject: Resistance Fighter**\n\nThe human holds the courtyard and favors deliberate shots. Reloads expose a short opening.\n\n- Approach from two gates.\n- Force movement before committing heavy units.\n\nSurvival is a temporary condition.',traits:[{key:'aim discipline',value:'precise',confidence:.92},{key:'positioning',value:'courtyard defender',confidence:.78},{key:'reload exposure',value:'predictable',confidence:.64}]}
 assert.equal((await fetch(`${server}/api/lobby/${code}/dossier`,{method:'PUT',headers,body:JSON.stringify(dossier)})).status,200)
 await page.waitForFunction(()=>window.terminator.world.skynet.name==='W10 TEST AGENT')
 await capture('05-lobby-connected.png');await layout('lobby 1920x1080')
 await action('start-match');await ticks(4);await capture('06-wave-start.png')
 const beforeMove=await page.evaluate(()=>({...window.terminator.world.player.pos}))
 await page.keyboard.down('s');await ticks(8);await page.keyboard.up('s')
 const afterMove=await page.evaluate(()=>({...window.terminator.world.player.pos}))
 assert.ok(Math.hypot(afterMove.x-beforeMove.x,afterMove.z-beforeMove.z)>.1)
 await page.mouse.move(960,540);await page.mouse.down();await ticks(4);await page.mouse.up()
 assert.ok(await page.evaluate(()=>window.terminator.world.eventLog.some(e=>e.type==='shot' && e.by==='player')))
 report.assertions.push('WASD movement and mouse fire advance the real core')
 await release()
 await page.evaluate(()=>{
   const m=window.terminator.manager,w=m.world
   w.player.pos={x:7,y:0,z:10};w.player.yaw=Math.PI;w.player.pitch=0;m.input.yaw=Math.PI;m.input.cursorAnchorYaw=Math.PI;m.input.pitch=0
   const endo=w.spawnUnit('endo',{x:7,y:0,z:1},{yaw:0,rev:7,id:'w10-endo'})
   w.spawnUnit('scout',{x:10,y:0,z:0},{yaw:0,rev:3,id:'w10-scout'})
   w.emit('unit_say',{unitId:endo.id,text:'Your resistance is inefficient.'})
   for(const u of w.aliveUnits){u.cooldown=60;u.shotCooldown=60;u.burstRemaining=0}
   w.skynet.fallbackCount=2;w.skynet.revs={endo:7,scout:3,heavy:1}
   w.player.armor=70
   w.damagePlayer(20,endo)
   m.syncViews()
 })
 await fetch(`${server}/api/lobby/${code}/taunt`,{method:'POST',headers,body:JSON.stringify({text:'I have measured your survival. It is brief.'})})
 await page.waitForTimeout(100)
 await capture('07-under-fire.png')
 await page.evaluate(()=>{const m=window.terminator.manager,w=m.world;w.player.armor=0;w.player.hp=100;for(const u of w.aliveUnits){u.cooldown=60;u.shotCooldown=60;u.burstRemaining=0}w.damagePlayer(84,w.unitById.get('w10-endo'));m.syncViews()})
 await page.waitForTimeout(100);await capture('08-low-health.png')
 await page.evaluate(()=>{const m=window.terminator.manager;m.world.player.hp=100;m.world.player.ammo.pistol.mag=0;m.syncViews()})
 await capture('09-empty-magazine.png')
 await page.evaluate(()=>{const w=window.terminator.world;w.player.ammo.pistol.mag=2;w.startReload()})
 await page.waitForTimeout(430);await capture('09-reloading.png')
 assert.equal(await page.locator('[data-testid="reload-ring"]').isVisible(),true)
 await ticks(90)
 for(const [kind,fraction] of [['hit',.5],['headshot',.84]]){
   const shot=await page.evaluate(fraction=>{
     const m=window.terminator.manager,w=m.world,u=w.unitById.get('w10-endo')
     w.player.pos={x:7,y:0,z:4.5};w.unitById.get('w10-scout').pos={x:15,y:0,z:4}
     const dx=u.pos.x-w.player.pos.x,dz=u.pos.z-w.player.pos.z
     w.player.yaw=Math.atan2(dx,dz);w.player.pitch=Math.atan2(u.pos.y+w.unitCatalog.types[u.type].height*fraction-(w.player.pos.y+1.65),Math.hypot(dx,dz))
     m.input.yaw=w.player.yaw;m.input.cursorAnchorYaw=w.player.yaw;m.input.pitch=w.player.pitch
     w.player.fireCooldown=0;w.playerFire();m.cameraFeel.consume(w);m.syncViews()
     return w.eventLog.findLast(e=>e.type==='shot' && e.by==='player')
   },fraction)
   assert.equal(shot.hit,true);assert.equal(shot.headshot,kind==='headshot')
   await capture(kind==='hit'?'22-hit-marker.png':'23-headshot-marker.png')
 }
 await release();await page.keyboard.press('Escape')
 const pauseTick=await page.evaluate(()=>window.terminator.world.tick)
 await page.waitForTimeout(350)
 assert.equal(await page.evaluate(()=>window.terminator.world.tick),pauseTick)
 await capture('10-pause.png');await page.keyboard.press('Escape')
 // A real core headshot kill triggers hit-stop, the kill feed and the skull marker.
 const hitStop=await page.evaluate(()=>{
   const m=window.terminator.manager,w=m.world,u=w.unitById.get('w10-endo')
   w.player.yaw=Math.PI;w.player.pitch=0;m.input.yaw=Math.PI;m.input.cursorAnchorYaw=Math.PI;m.input.pitch=0
   w.damageUnit(u.id,10000,{source:'player',weapon:'pistol',headshot:true})
   w.emit('shot',{by:'player',weapon:'pistol',hit:true,headshot:true,killed:true,unitId:u.id})
   m.cameraFeel.consume(w);m.syncViews()
   return {stopped:m.cameraFeel.hitStopped,remaining:m.cameraFeel.freezeUntil-performance.now()}
 })
 assert.ok(hitStop.stopped && hitStop.remaining>0 && hitStop.remaining<=40)
 report.assertions.push({headshotHitStop:hitStop})
 await capture('11-headshot-kill.png')
 await page.evaluate(()=>{
   const m=window.terminator.manager,w=m.world
   m.director.nextSpawn=m.director.spawnSchedule.length
   for(const unit of w.aliveUnits)w.damageUnit(unit.id,10000,{source:'player',weapon:'pistol',headshot:true})
   w.player.hp=100
 })
 await page.waitForFunction(()=>window.terminator.world.phase==='intermission')
 await page.waitForTimeout(200);await capture('12-intermission.png')
 await action('trader');await capture('13-trader-weapons.png');await layout('trader 1920x1080')
 await action('purchase:m4');await page.waitForTimeout(100);await capture('14-trader-denied.png')
 await action('category:ammo');await action('purchase:ammo:pistol');await page.waitForTimeout(100);await capture('14-trader-purchase.png')
 report.purchase=await page.evaluate(()=>({available:typeof window.terminator.world.purchase==='function',feedback:document.querySelector('[data-live="purchaseFeedback"]').textContent,event:window.terminator.world.telemetry.purchases.at(-1)}))
 assert.equal(report.purchase.event.item,'ammo:pistol')
 for(const category of ['ammo','armor','items']){await action(`category:${category}`);await capture(`15-trader-${category}.png`)}
 // Assert the entire screen fits the smallest and largest required resolutions.
 for(const [width,height]of [[1280,720],[2560,1440]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(400)
   await layout(`trader ${width}x${height}`)
   await capture(`16-trader-${width}.png`)
   await action('back');await layout(`HUD ${width}x${height}`);await capture(`17-hud-${width}.png`)
   await action('pause');await action('settings');await layout(`settings ${width}x${height}`)
   await action('back');await action('resume');await action('trader')
 }
 await page.setViewportSize({width:1920,height:1080});await action('back')
 await page.keyboard.press('r');await page.waitForFunction(()=>window.terminator.world.phase==='wave')
 await page.evaluate(()=>window.terminator.world.damagePlayer(1000,{type:'heavy',pos:{x:10,y:0,z:8}}))
 await page.waitForFunction(()=>document.querySelector('[data-screen="postmatch"]'))
 await page.waitForTimeout(800);await capture('18-postmatch-typing.png')
 await page.waitForFunction(()=>document.querySelectorAll('.tm-trait').length===3,undefined,{timeout:12000})
 await capture('19-postmatch-dossier.png');await layout('postmatch 1920x1080')
 assert.equal(await page.locator('.tm-dossier-markdown script').count(),0)
 await action('play-again')
 await page.waitForFunction(()=>Boolean(window.terminator.manager.lobby.code))
 await action('start-match');await ticks(3)
 await page.evaluate(()=>{const m=window.terminator.manager;m.director.maxWaves=1;m.director.nextSpawn=m.director.spawnSchedule.length;for(const u of m.world.aliveUnits)m.world.damageUnit(u.id,10000,{source:'player',weapon:'pistol'})})
 await page.waitForFunction(()=>document.querySelector('[data-screen="postmatch"]'))
 await page.waitForTimeout(4000);await capture('21-survived.png')
 report.assertions.push('Play Again starts a fresh match; shortened one-wave fixture reaches SURVIVED')
 await action('main-menu');await action('dossier');await page.waitForTimeout(4000);await capture('20-dossier-library.png');await action('back')
 await page.evaluate(()=>{window.terminator.manager.stop()})
 assert.equal(await page.locator('.tm-hud').count(),0)
 assert.equal(await page.locator('[data-terminator-style]').count(),0)
 report.assertions.push('main to postmatch, restart, settings persistence, copy, pause freeze, R ready, HUD and style cleanup')
 report.ok=report.console.length===0
}catch(error){report.ok=false;report.error=clean(error.stack || error.message);await capture('failure.png').catch(()=>{})}
finally{await writeFile(new URL('results.json',out),JSON.stringify(report,null,2)+'\n');await browser.close()}
console.log(JSON.stringify(report,null,2))
if(!report.ok)process.exitCode=1
