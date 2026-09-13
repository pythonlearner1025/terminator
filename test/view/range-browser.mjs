// Run against this worktree's server: kite3d dev --port 4682 --no-open.
// All input targets a private headless page. No desktop window is created.
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
const output='/Users/minjunes/games/terminator-evidence/docs/evidence/range'
await mkdir(output,{recursive:true})
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
assert.equal(new URL(dev.url).port,'4682')
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal']})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const errors=[],missing=[]
const safe=s=>String(s).replace(/([?&]t=)[^&\s"']+/g,'$1[private]')
page.on('pageerror',e=>errors.push(safe(e.message)))
page.on('console',e=>{if(e.type()==='error'&&!e.text().includes('Failed to load resource'))errors.push(safe(e.text()))})
page.on('response',r=>{if(r.status()>=400)missing.push(new URL(r.url()).pathname)})
const click=id=>page.getByTestId('range-'+id).click()
const data=fn=>page.evaluate(fn)
const tick=()=>data(()=>window.terminator.world.tick)
async function step(){const t=await tick();await click('step-once');await page.waitForFunction(t=>window.terminator.world.tick===t+1,t)}
async function aim(type='heavy',row=20,head=false){return page.evaluate(({type,row,head})=>{
 const m=window.terminator.manager,w=m.world,slot=m.range.layout.find(s=>s.type===type&&s.row===row)
 const u=w.unitById.get(m.range.targets.get(slot.id)),p=w.player
 const y=u.pos.y+(head?(w.unitHitCollider(u).shapes.find(s=>s.part==='head')?.offset.y||w.unitCatalog.types[u.type].height*.9):w.unitCatalog.types[u.type].height*.5)
 const yaw=Math.atan2(u.pos.x-p.pos.x,u.pos.z-p.pos.z),pitch=Math.atan2(y-p.pos.y-1.65,Math.hypot(u.pos.x-p.pos.x,u.pos.z-p.pos.z))
 Object.assign(m.input,{yaw,pitch,cursor:null,cursorAnchorYaw:yaw,cursorAnchorPitch:pitch});p.yaw=yaw;p.pitch=pitch;m.syncViews()
 return {id:u.id,pos:{...u.pos},yaw,pitch}
},{type,row,head})}
async function fire(){await click('fire-once');await step()}
async function fullViewport(){await data(()=>{
 const v=window.viewer;window.rangeSavedStyle=v.container.getAttribute('style')
 Object.assign(v.container.style,{position:'fixed',left:0,top:0,width:'1920px',height:'1080px',maxWidth:'none',maxHeight:'none',zIndex:'2147483000'})
 v.setSize({width:1920,height:1080});v.resize();v.renderManager.renderScale=1
})}
const proof={weapons:[],controls:[],screenshots:[],errors,missing}
try {
 await page.addInitScript(()=>localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',controlsSeen:true})))
 await page.goto(dev.url+'&range=1&colliders=1',{waitUntil:'domcontentloaded'})
 await page.getByTestId('play').click({timeout:60000})
 await page.waitForFunction(()=>window.terminator?.manager?.rangeView&&!window.terminator.manager.ui.screens.route,null,{timeout:120000})
 await data(()=>window.terminator.manager.mapView.ready)
 assert.equal(await data(()=>window.terminator.world.aliveUnits.length),18)
 assert.equal(await page.getByTestId('sandbox-panel').count(),0)
 assert.equal(await page.getByTestId('range-hitboxes').isChecked(),true)
 await page.getByTestId('range-hitboxes').uncheck()
 await fullViewport()
 await click('time-0');let before=await tick();await page.waitForTimeout(250);assert.equal(await tick(),before)
 assert.equal(await page.locator('.tm-screen:not([hidden])').count(),0,'loading transition must finish while range time is paused')
 const hudTime=await data(()=>window.terminator.manager.hud.presentationTimeMs)
 await page.waitForTimeout(100);assert.equal(await data(()=>window.terminator.manager.hud.presentationTimeMs),hudTime)
 await step();assert.equal(await tick(),before+1);proof.controls.push('pause and one fixed tick')
 for(const id of ['pistol','m4','shotgun','plasma','knife','grenade','sniper','launcher']) {
  await click('targets-reset');await click('weapon-'+id);const target=await aim()
  assert.equal(await data(()=>window.terminator.world.player.activeWeapon),id)
  const cursor=await data(()=>window.terminator.world.eventLog.length)
  await fire()
  const record=await page.evaluate(({cursor,id})=>{
   const m=window.terminator.manager,e=m.world.eventLog.slice(cursor)
   return {id,event:e.find(e=>id==='grenade'?e.type==='grenade_thrown':e.type==='shot'&&e.weapon===id),animation:m.playerView.weapons.animation.state.mode,paths:m.rangeView.shots.length}
  },{cursor,id})
  assert.ok(record.event,`No real shot event for ${id}`)
  if(!['knife','grenade','launcher'].includes(id)){const hits=await page.evaluate(({cursor,target})=>window.terminator.world.eventLog.slice(cursor).some(e=>e.type==='unit_damage'&&e.unitId===target),{cursor,target:target.id});assert.ok(hits,`${id} must hit the 20 m row: ${JSON.stringify({target,event:record.event,input:await data(()=>window.terminator.world.previousInputs)})}`)}
  proof.weapons.push({id,event:record.event.type,hit:record.event.hit??false,animation:record.animation,paths:record.paths})
 }
 proof.controls.push('eight weapons, full ammo, real attacks aimed at the 20 m row')
 await click('weapon-m4');await aim();await fire()
 const reserve=await data(()=>window.terminator.world.player.ammo.m4.reserve)
 await page.getByTestId('range-reloads').uncheck()
 assert.equal(await data(()=>window.terminator.world.sandbox.noReload),true)
 await page.getByTestId('range-reloads').check()
 assert.equal(await data(()=>window.terminator.world.sandbox.noReload),false)
 assert.equal(await data(()=>window.terminator.world.player.ammo.m4.reserve),reserve)
 await page.keyboard.press('F1');assert.equal(await page.getByTestId('range-panel').isVisible(),false)
 await page.keyboard.press('F1');assert.equal(await page.getByTestId('range-panel').isVisible(),true)
 proof.controls.push('reload switch and F1')
 // Select each time control, then let the actual frame loop advance each rate.
 for(const scale of [1,.25,.1]) {
  await click('time-'+scale);before=await tick();await page.waitForTimeout(1000)
  const elapsed=await tick()-before
  assert.ok(elapsed>=Math.max(2,Math.floor(60*scale*.6))&&elapsed<=Math.ceil(60*scale*1.6),`unexpected rate ${scale}: ${elapsed}`)
  proof.controls.push(`${scale}x: ${elapsed} ticks in approximately one second`)
 }
 await click('time-0')
 // A plate has view-only feedback. Shoot its exact face through the actual weapon input.
 await click('weapon-sniper')
 await data(()=>{const m=window.terminator.manager,p=m.world.player,t=m.rangeView.props.plates[5],yaw=Math.atan2(t.x-p.pos.x,t.z-p.pos.z),pitch=Math.atan2(t.y-.4-p.pos.y-1.65,Math.hypot(t.x-p.pos.x,t.z-p.pos.z));Object.assign(m.input,{yaw,pitch,cursor:null,cursorAnchorYaw:yaw,cursorAnchorPitch:pitch});p.yaw=yaw;p.pitch=pitch;m.syncViews()})
 await fire();await step()
 assert.ok(await data(()=>window.terminator.manager.rangeView.props.plates.some(p=>p.hits>0&&Math.abs(p.pivot.rotation.x)>.001)))
 assert.ok(await data(()=>window.terminator.manager.rangeView.audio))
 proof.controls.push('steel plate ring and swing')
 await page.getByTestId('range-hitboxes').check();await step()
 assert.equal(await data(()=>window.terminator.manager.rangeView.unitWires.size),18)
 await page.getByTestId('range-hitboxes').uncheck()
 await page.getByTestId('range-trajectories').uncheck();assert.equal(await data(()=>window.terminator.manager.rangeView.lineMesh.visible),false)
 await page.getByTestId('range-trajectories').check()
 await page.getByTestId('range-impacts').uncheck();assert.equal(await data(()=>window.terminator.manager.rangeView.markers.visible),false)
 await page.getByTestId('range-impacts').check()
 await page.getByTestId('range-ruler').uncheck();assert.equal(await page.getByTestId('range-distance').isVisible(),false)
 await page.getByTestId('range-ruler').check();await aim();assert.match(await page.getByTestId('range-distance').textContent(),/m \/ /)
 await click('weapon-m4');await page.getByTestId('range-freeze').check();await fire()
 await click('time-1');await page.waitForTimeout(180);await click('time-0')
 assert.ok(await data(()=>{const f=window.terminator.manager.playerView.weapons.fx;return f.flashLife===f.flashMax&&f.flash.visible}))
 await page.getByTestId('range-freeze').uncheck()
 proof.controls.push('trajectory, impact, hitbox, distance and peak flash overlays')
 await click('targets-reset');await click('weapon-sniper');const old=await aim('endo',20,true)
 await fire();assert.equal(await page.evaluate(id=>window.terminator.world.unitById.get(id).alive,old.id),false)
 const diedAt=await tick();await click('time-1')
 await page.waitForFunction(id=>!window.terminator.world.unitById.has(id),old.id,{timeout:10000})
 const revived=await data(()=>{const m=window.terminator.manager;return m.world.unitById.get(m.range.targets.get('range-20-endo'))})
 assert.deepEqual(revived.pos,old.pos);assert.ok(revived.spawnedAtTick>=diedAt+119)
 await click('time-0');proof.controls.push('real sniper kill, two-second replacement and flash')
 // Three lighting frames keep real diagnostic paths from repeated target shots.
 for(const lighting of ['night','overcast','noon']) {
  await click('targets-reset');await click('time-1');await page.waitForTimeout(450);await click('time-0');await click('shots-clear');await click('light-'+lighting)
  for(const type of ['heavy','endo','t1000']){await click('weapon-m4');await aim(type);await fire()}
  await aim('heavy');await page.waitForTimeout(200)
  assert.ok(await data(()=>window.terminator.manager.rangeView.shots.length>=3))
  assert.equal(await page.locator('.tm-screen:not([hidden])').count(),0)
  await page.screenshot({path:`${output}/${lighting}.png`});proof.screenshots.push(`${output}/${lighting}.png`)
 }
 await click('weapon-sniper');await click('camera-inspect');await click('loop-idle')
 const playerBefore=await data(()=>({...window.terminator.world.player.pos}))
 const cameraBefore=await data(()=>window.terminator.manager.playerView.camera.position.toArray())
 await page.mouse.move(1120,560);await page.mouse.down();await page.mouse.move(1320,615,{steps:8});await page.mouse.up();await page.mouse.wheel(0,120)
 assert.notDeepEqual(await data(()=>window.terminator.manager.playerView.camera.position.toArray()),cameraBefore)
 assert.deepEqual(await data(()=>window.terminator.world.player.pos),playerBefore)
 await click('loop-fire');await step();assert.equal(await data(()=>window.terminator.manager.playerView.weapons.animation.state.mode),'fire')
 await click('loop-aim');await click('time-0.25');await page.waitForTimeout(1600)
 assert.ok(await data(()=>window.terminator.manager.playerView.weapons.animation.aimAmount>0))
 await click('time-0');await click('loop-idle');await click('camera-player')
 assert.deepEqual(await data(()=>window.terminator.world.player.pos),playerBefore)
 await click('camera-inspect');await page.mouse.move(1320,615);await page.mouse.down();await page.mouse.move(1130,545,{steps:8});await page.mouse.up();await click('loop-reload');await click('time-0.1')
 await page.waitForFunction(()=>{const a=window.terminator.manager.playerView.weapons.animation.state;return a.mode==='reload'&&a.reloadProgress>.43&&a.reloadProgress<.65},null,{timeout:30000})
 await page.screenshot({path:`${output}/inspect-sniper.png`});proof.screenshots.push(`${output}/inspect-sniper.png`)
 proof.controls.push('inspect orbit, zoom, idle, fire, aim, reload, and player camera restoration')
 // Run the same high-quality scene with 24 enemies and a continuous M4 firing loop.
 await click('time-0');await click('camera-player');await click('targets-reset');await click('shots-clear');await click('weapon-m4');await page.getByTestId('range-reloads').uncheck();await click('light-night');await aim()
 await data(()=>{const m=window.terminator.manager;for(let i=0;i<6;i++)m.world.spawnUnit(['endo','heavy','scout'][i%3],{x:-4+i*2,y:0,z:-25},{brain:'dummy',yaw:-Math.PI/2});for(const u of m.world.units)u.hp=u.maxHp=1000000;m.ui.bindings.held.add('Mouse0')})
 await click('time-1');await page.waitForTimeout(1500)
 proof.performance=await page.evaluate(async()=>{
  const m=window.terminator.manager,v=window.viewer,frame=[],cpu=[];let prior=performance.now()
  const original=m.update;m.update=function(e){const t=performance.now();const r=original.call(this,e);cpu.push(performance.now()-t);return r}
  await new Promise(resolve=>{function next(now){frame.push(now-prior);prior=now;if(frame.length>=360)resolve();else requestAnimationFrame(next)}requestAnimationFrame(next)})
  m.update=original
  const summary=a=>{a=a.slice(20).sort((a,b)=>a-b);return {median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],samples:a.length}}
  const gl=v.renderManager.webglRenderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
  return {frameMs:summary(frame),updateMs:summary(cpu),alive:m.world.aliveUnits.length,quality:m.ui.screens.settings.quality,canvas:[v.canvas.width,v.canvas.height],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable'}
 })
 proof.controls.push('24 enemy headless frame-time sample')
 await click('time-0');await click('shots-clear');assert.equal(await data(()=>window.terminator.manager.rangeView.shots.length),0)
 assert.equal(await data(()=>window.terminator.manager.rangeView.lines.drawRange.count),0)
 // Restore the page layout, then exercise editor Stop and a normal mode restart.
 await data(()=>{const v=window.viewer;v.container.setAttribute('style',window.rangeSavedStyle||'');v.resize();document.querySelector('[data-testid="play"]').click()})
 await page.waitForFunction(()=>!document.querySelector('[data-testid="range-panel"]'))
 await page.goto(dev.url,{waitUntil:'domcontentloaded'});await page.getByTestId('play').click({timeout:60000})
 await page.waitForFunction(()=>window.terminator?.manager?.ui,null,{timeout:60000})
 assert.equal(await page.getByTestId('range-panel').count(),0)
 assert.equal(await page.locator('[data-terminator-range-style]').count(),0)
 assert.equal(await data(()=>window.terminator.manager.range),null)
 await page.getByTestId('play').click()
 // Both flags retain independent panels with one common F1 toggle.
 await page.goto(dev.url+'&range=1&sandbox=1',{waitUntil:'domcontentloaded'});await page.getByTestId('play').click({timeout:60000})
 await page.waitForFunction(()=>window.terminator?.manager?.rangeView,null,{timeout:120000})
 await page.getByTestId('sandbox-panel').waitFor();await page.getByTestId('range-panel').waitFor()
 const a=await page.getByTestId('sandbox-panel').boundingBox(),b=await page.getByTestId('range-panel').boundingBox()
 assert.ok(a.x>=b.x+b.width,'panels must not overlap')
 await page.keyboard.press('F1');assert.equal(await page.getByTestId('sandbox-panel').isVisible(),false);assert.equal(await page.getByTestId('range-panel').isVisible(),false)
 await page.keyboard.press('F1');assert.equal(await page.getByTestId('sandbox-panel').isVisible(),true)
 await page.getByTestId('play').click()
 proof.controls.push('clear shots, editor Stop cleanup, range-off DOM, and combined sandbox panels')
 assert.deepEqual(errors,[])
 await writeFile('.kite3d/range-proof.json',JSON.stringify(proof,null,2)+'\n')
 console.log(JSON.stringify(proof,null,2))
}catch(error){console.error(safe(error.stack));console.error(JSON.stringify({errors,missing}));await page.screenshot({path:'.kite3d/range-proof-failure.png'});process.exitCode=1}
finally{await browser.close()}
