// Isolated render comparison. Frozen 24-enemy explosion/plasma pose.
// Alternating visibility order, 4 warmup rounds, 20 samples per mode.
// This measures render cost only, not the full simulation frame budget.
import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
page.on('pageerror',e=>console.log('error',e.message))
await page.goto(dev.url,{waitUntil:'domcontentloaded'});await page.getByTestId('play').waitFor({timeout:30000});await page.waitForTimeout(700)
if(!await page.evaluate(()=>window.terminator?.world))await page.getByTestId('play').click()
await page.waitForFunction(()=>window.terminator?.world,null,{timeout:45000})
await page.evaluate(()=>{
 const m=window.terminator.manager,w=m.world;m.startViews();m.ui.screens.show(null);m.started=false
 window.viewer.canvas.style.cssText+=';position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:500;'
 w.phase='wave';w.player.pos={x:5,y:0,z:10};w.player.yaw=Math.PI;w.player.pitch=0;w.player.hp=100000;w.player.activeWeapon='plasma';w.player.ammo.plasma={owned:true,mag:10000,reserve:10000}
 for(let i=0;i<24;i++){const u=w.spawnUnit(i%3===0?'scout':i%3===1?'endo':'heavy',{x:-9+(i%8)*2.4,y:0,z:-7-Math.floor(i/8)*4});u.hp=100000}
 for(let i=0;i<120;i++){w.step({yaw:Math.PI,pitch:0});m.syncViews()}
 w.player.grenades=4;w.step({yaw:Math.PI,fire:true,grenade:true});m.syncViews()
})
await page.waitForFunction(()=>window.terminator.manager.playerView.weapons.material.normalMap?.image?.width===2048,null,{timeout:45000})
const result=await page.evaluate(async()=>{
 const m=window.terminator.manager,v=m.playerView.weapons,viewer=window.viewer,r=viewer.renderManager.webglRenderer,gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2')
 if(!ext)return {error:'No GPU timer'}
 const frame=mode=>new Promise(resolve=>{
  v.root.visible=!['weapon-hidden','all-hidden'].includes(mode)
  v.worldFx.root.visible=m.unitView.fx.root.visible=!['effects-hidden','all-hidden'].includes(mode)
  let q,start
  const before=()=>{if(['screen-disabled','all-hidden'].includes(mode))v.screenFx.uniforms.weaponHeatCount.value=0;start=performance.now();q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q)}
  const after=()=>{gl.endQuery(ext.TIME_ELAPSED_EXT);const cpu=performance.now()-start;viewer.removeEventListener('preRender',before);viewer.removeEventListener('postRender',after);const poll=()=>{if(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))return requestAnimationFrame(poll);const gpu=gl.getParameter(ext.GPU_DISJOINT_EXT)?null:gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;gl.deleteQuery(q);resolve({cpu,gpu})};requestAnimationFrame(poll)}
  viewer.addEventListener('preRender',before);viewer.addEventListener('postRender',after);viewer.setDirty()
 })
 const modes=['all','weapon-hidden','effects-hidden','screen-disabled','all-hidden']
 for(let i=0;i<4;i++)for(const mode of modes)await frame(mode)
 const results=Object.fromEntries(modes.map(mode=>[mode,[]]))
 for(let i=0;i<20;i++)for(const mode of i%2?[...modes].reverse():modes)results[mode].push(await frame(mode))
 const summary=a=>{a.sort((a,b)=>a-b);return {mean:a.reduce((s,v)=>s+v,0)/a.length,median:a[Math.floor(a.length/2)],p95:a[Math.floor(a.length*.95)]}}
 return {alive:m.world.aliveUnits.length,modes:Object.fromEntries(modes.map(mode=>[mode,{cpu:summary(results[mode].map(x=>x.cpu)),gpu:summary(results[mode].map(x=>x.gpu).filter(x=>x!==null))}]))}
})
console.log(JSON.stringify(result,null,2));await writeFile('docs/evidence/pass-weapons/render-cost.json',JSON.stringify(result,null,2))
await page.getByTestId('play').evaluate(button=>button.click())
}finally{await browser.close()}
