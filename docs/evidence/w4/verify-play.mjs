import {readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const out=new URL('./',import.meta.url)
const log=await readFile('/tmp/terminator-w4-dev.log','utf8')
const url=log.match(/http:\/\/127\.0\.0\.1:4400\/\?t=[\w.~-]+/)?.[0]
if(!url) throw new Error('No W4 server URL')
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1'})
const page=await browser.newPage({viewport:{width:1600,height:1080},deviceScaleFactor:1})
await page.addInitScript(()=>{window.EventSource=class extends EventTarget {readyState=1;close(){this.readyState=2}}})
const errors=[]
const clean=s=>String(s).replace(/\?t=[^\s"']+/g,'?t=[redacted]')
page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(clean(m.text()))})
page.on('pageerror',e=>errors.push(clean(e.stack||e.message)))
const result={previewFallback:process.env.PREVIEW_FALLBACK==='1'}
if(result.previewFallback) {
 for(const path of ['scripts/GameManager.script.js','lib/core/world.js','lib/core/waves.js','lib/ui/hud.js']) await page.route(`**/files/${path}*`,route=>route.fulfill({status:200,contentType:'text/javascript',body:execFileSync('git',['show',`979a0c0:${path}`],{encoding:'utf8'})}))
}
try {
 await page.goto(url,{waitUntil:'domcontentloaded'})
 await page.getByTestId('play').waitFor({timeout:30000});await page.waitForTimeout(1000)
 await page.getByTestId('play').click()
 await page.waitForFunction(()=>Boolean(window.terminator?.world),undefined,{timeout:30000})
 await page.evaluate(()=>{
  document.exitPointerLock?.()
  const {manager:m,world:w}=window.terminator
  w.player.hp=100000;w.player.alive=true
  m.unitView.toggleShowcase(true)
  Object.assign(m.unitView.showcase,{focus:null,angle:.3,cameraDistance:5.4,state:'idle'})
 })
 result.animationStates={}
 for(const state of ['idle','moving','aiming','spin-up','firing','hit','dying']) {
  await page.evaluate(state=>{const s=window.terminator.manager.unitView.showcase;s.state=state;s.time=0},state)
  await page.waitForTimeout(state==='dying'?1300:700)
  result.animationStates[state]=await page.evaluate(()=>window.terminator.manager.unitView.showcase.units.map(v=>({type:v.state.type,pelvisY:v.rig.joints.Pelvis.position.y,headX:v.rig.joints.Head.rotation.x,armX:v.rig.joints['Upper Arm Right'].rotation.x,barrelZ:v.rig.joints.Barrels?.rotation.z||0,eyesVisible:v.rig.eyes.visible,states:[...v.rig.states]})))
  if(['moving','firing','dying'].includes(state)) await capture(`animation-${state}.png`)
 }
 await page.evaluate(()=>{
  const {world:w,manager:m}=window.terminator
  m.unitView.toggleShowcase(false)
  // Controlled benchmark arrangement, using live core brains and the complete map.
  w.player.hp=100000;w.player.pos={x:0,y:0,z:-18};w.player.alive=true
  m.input.yaw=0;m.input.pitch=0;m.input.cursorAnchorYaw=0
  for(const u of w.units) {u.alive=false;u.diedAtTick=w.tick-300}
  for(let i=0;i<24;i++) {
   const type=['scout','endo','heavy'][i%3]
   w.spawnUnit(type,{x:(i%6-2.5)*2,y:0,z:Math.floor(i/6)*3+2},{yaw:Math.PI})
  }
  w.phase='wave'
 })
 await page.waitForTimeout(1500)
 result.performance=await page.evaluate(async()=>{
  const w=window.terminator.world,viewer=window.viewer,r=viewer.renderManager.webglRenderer
  const ext=r.getContext().getExtension('WEBGL_debug_renderer_info')
  const device=ext?r.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'
  const times=[];let last=performance.now()
  for(let i=0;i<300;i++) await new Promise(resolve=>requestAnimationFrame(now=>{times.push(now-last);last=now;resolve()}))
  const sorted=[...times].sort((a,b)=>a-b),mean=times.reduce((a,b)=>a+b)/times.length
  const rect=viewer.canvas.getBoundingClientRect()
  return{samples:times.length,alive:w.aliveUnits.length,unitTypes:Object.fromEntries(['scout','endo','heavy'].map(t=>[t,w.aliveUnits.filter(u=>u.type===t).length])),meanMs:mean,p50Ms:sorted[150],p95Ms:sorted[285],p99Ms:sorted[297],maxMs:Math.max(...times),fps:1000/mean,framesOver20ms:times.filter(t=>t>20).length,canvas:{width:rect.width,height:rect.height,pixels:[viewer.canvas.width,viewer.canvas.height]},device,rawMs:times}
 })
 await capture('24-units-live.png')
 result.liveEffects=await page.evaluate(()=>{
  const {world:w,manager:m}=window.terminator
  const u=w.aliveUnits.find(u=>u.type==='endo')
  if(!u) throw new Error('No live Endo for damage feedback')
  const head=m.unitView.visuals.get(u.id).rig.joints.Head
  const p=head.getWorldPosition(m.unitView.v1)
  w.damageUnit(u.id,1,{weapon:'pistol',source:'player',headshot:true,point:{x:p.x,y:p.y,z:p.z}})
  m.unitView.sync(w)
  const v=m.unitView.visuals.get(u.id)
  return{...m.unitView.fx.stats,hitFlinch:v.rig.hit,headshotFlash:v.rig.headshot,visuals:m.unitView.visuals.size}
 })
 await capture('headshot-sparks.png')
 // Dark-distance evidence fixes presentation positions, leaves gameplay running.
 await page.evaluate(()=>{
  const {world:w,manager:m}=window.terminator
  w.player.pos={x:0,y:0,z:-18};m.input.yaw=0;m.input.pitch=0;m.input.cursorAnchorYaw=0
  w.player.hp=100000
  const units=w.aliveUnits.slice(0,3)
  for(const [i,u] of units.entries()) {u.pos={x:(i-1)*2.2,y:0,z:2};u.yaw=Math.PI;u.intent.moveTo=null;u.vel={x:0,y:0,z:0};u.brain={tick(self,sense,act){act.stop()}}}
  window.__distanceUnits=units.map(u=>u.id)
  for(const u of w.units) if(!window.__distanceUnits.includes(u.id)) {u.alive=false;u.diedAtTick=w.tick-400;const v=m.unitView.visuals.get(u.id);if(v) v.rig.death=4}
  w.configureMap({lights:{courtyard:'off',building:'off',dock:'off'},fog:1})
  w.player.hp=100;w.player.armor=100
 })
 await page.waitForTimeout(100)
 await capture('in-game-20m-dark.png')
 result.distance=await page.evaluate(()=>window.__distanceUnits.map(id=>{const w=window.terminator.world,u=w.unitById.get(id);return{id,type:u.type,metres:Math.hypot(u.pos.x-w.player.pos.x,u.pos.z-w.player.pos.z)}}))
 await page.evaluate(()=>document.exitPointerLock?.())
 await page.getByTestId('play').click({force:true});await page.waitForTimeout(500)
 result.stop=await page.evaluate(()=>({hudPresent:Boolean(document.querySelector('[data-testid="terminator-hud"]')),runtimeRootPresent:Boolean(window.viewer?.scene.getObjectByName('Units Runtime'))}))
 result.errors=errors
 assert.equal(result.performance.alive,24)
 assert.ok(result.animationStates.moving[0].pelvisY<result.animationStates.idle[0].pelvisY-.05)
 assert.ok(result.animationStates['spin-up'][2].barrelZ>1)
 assert.ok(result.animationStates.dying.every(v=>!v.eyesVisible&&v.pelvisY<.3))
 assert.equal(result.liveEffects.hitFlinch,1);assert.equal(result.liveEffects.headshotFlash,1)
 assert.ok(result.liveEffects.sparkBursts>0&&result.liveEffects.plasmaShots>0&&result.liveEffects.minigunShots>0)
 assert.equal(result.stop.runtimeRootPresent,false)
 result.assertions='PASS: 24 alive, quadruped stance, barrel rotation, staged collapse and eye extinction, live headshot/spark/plasma/minigun events, Stop cleanup' 
 await writeFile(new URL('verification.json',out),JSON.stringify(result,null,2)+'\n')
 const printable={...result,performance:{...result.performance,rawMs:undefined}}
 console.log(JSON.stringify(printable,null,2))
} catch(e) {console.log(JSON.stringify({error:clean(e.stack),errors:errors.slice(0,8)}));throw e} finally {await browser.close()}
async function capture(name) {
 const clip=await page.evaluate(()=>{const r=window.viewer.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})
 await page.screenshot({path:new URL(name,out).pathname,clip})
}
