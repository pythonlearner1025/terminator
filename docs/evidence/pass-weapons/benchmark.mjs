// Read-only baseline is served by Playwright request interception from Git.
// No checkout, file replacement, external browser window or core code edits.
import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
if(new URL(dev.url).port!=='4630')throw Error('Expected port 4630')
const baseline='04f69da'
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const files=['weapons.js','weapons-animation.js','fx.js','camera-feel.js','player.js']
const original=Object.fromEntries(files.map(name=>[name,execFileSync('git',['show',`${baseline}:lib/view/${name}`],{encoding:'utf8'})]))
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const runs=[]
try {
 for(const mode of ['baseline','current','current','baseline']){
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
  const errors=[],intercepted=[]
  page.on('pageerror',e=>errors.push(e.message.replace(/\?t=[\w.~-]+/g,'?t=[redacted]')))
  if(mode==='baseline')await page.route(/\/lib\/view\/(weapons\.js|weapons-animation\.js|fx\.js|camera-feel\.js|player\.js)(\?|$)/,route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();intercepted.push(name)
    return route.fulfill({status:200,contentType:'text/javascript',body:original[name]})
  })
  await page.goto(dev.url,{waitUntil:'domcontentloaded'})
  await page.getByTestId('play').waitFor({timeout:30000});await page.waitForTimeout(700)
  if(!await page.evaluate(()=>window.terminator?.world))await page.getByTestId('play').click()
  await page.waitForFunction(()=>window.terminator?.world,null,{timeout:30000})
  await page.evaluate(()=>{
   const m=window.terminator.manager,w=m.world;m.startViews();m.ui.screens.show(null);m.started=false
   window.viewer.canvas.style.cssText+=';position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:500;'
   w.phase='wave';w.player.pos={x:5,y:0,z:10};w.player.yaw=Math.PI;w.player.pitch=0
   w.player.hp=100000;w.player.armor=0;w.player.activeWeapon='pistol'
   for(const id of ['pistol','m4','shotgun','plasma'])w.player.ammo[id]={owned:true,mag:100000,reserve:100000}
   for(let i=0;i<24;i++){
    const unit=w.spawnUnit(i%3===0?'scout':i%3===1?'endo':'heavy',{x:-9+(i%8)*2.4,y:0,z:-7-Math.floor(i/8)*4},{yaw:0})
    unit.hp=unit.maxHp=100000
   }
   m.syncViews()
  })
  if(mode==='current')await page.waitForFunction(()=>window.terminator.manager.playerView.weapons.material.normalMap?.image?.width===2048,null,{timeout:45000})
  await page.waitForTimeout(700)
  const result=await page.evaluate(async()=>{
   const m=window.terminator.manager,w=m.world,viewer=window.viewer,v=m.playerView.weapons
   const renderer=viewer.renderManager.webglRenderer,gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2')
   const debug=gl.getExtension('WEBGL_debug_renderer_info')
   const gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)
   const samples=[],queries=[],warm=120,count=240
   let frame=0,previous=0,current=null,query=null
   await new Promise(resolve=>{
    const preFrame=()=>{
      const start=performance.now(),dt=previous?start-previous:0;previous=start
      const before=w.eventLog.length
      w.player.grenades=4
      w.step({yaw:Math.PI,pitch:0,switchTo:['pistol','m4','shotgun','plasma'][Math.floor(frame/90)%4],fire:true,grenade:frame%90===0})
      const coreMs=performance.now()-start
      const viewStart=performance.now();m.cameraFeel.consume(w);m.syncViews()
      current={frameMs:dt,coreMs,viewMs:performance.now()-viewStart,events:w.eventLog.length-before}
    }
    const preRender=()=>{
      current.renderStart=performance.now()
      if(ext&&frame>=warm){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query)}
    }
    const postRender=()=>{
      current.renderMs=performance.now()-current.renderStart
      if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push(query);query=null}
      if(frame>=warm)samples.push(current)
      if(++frame>=warm+count){
        viewer.removeEventListener('preFrame',preFrame);viewer.removeEventListener('preRender',preRender);viewer.removeEventListener('postRender',postRender);resolve()
      }else viewer.setDirty()
    }
    viewer.addEventListener('preFrame',preFrame);viewer.addEventListener('preRender',preRender);viewer.addEventListener('postRender',postRender);viewer.setDirty()
   })
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
   const gpuTimes=[]
   for(const query of queries){if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)&&!gl.getParameter(ext.GPU_DISJOINT_EXT))gpuTimes.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(query)}
   const summarize=a=>{a.sort((a,b)=>a-b);return {samples:a.length,mean:a.reduce((s,v)=>s+v,0)/a.length,median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)]}}
   return {gpu,canvas:[viewer.canvas.width,viewer.canvas.height],alive:w.aliveUnits.length,
     frame:summarize(samples.map(s=>s.frameMs)),core:summarize(samples.map(s=>s.coreMs)),view:summarize(samples.map(s=>s.viewMs)),render:summarize(samples.map(s=>s.renderMs)),gpuMs:gpuTimes.length?summarize(gpuTimes):null,
     shots:w.eventLog.filter(e=>e.type==='shot').length,explosions:w.eventLog.filter(e=>e.type==='explosion').length,weaponFx:v.worldFx?{...v.worldFx.stats}:null}
  })
  runs.push({mode,...result,errors,intercepted:[...new Set(intercepted)]})
  console.log(JSON.stringify(runs.at(-1)))
  await page.getByTestId('play').evaluate(button=>button.click());await page.close()
 }
 await writeFile('docs/evidence/pass-weapons/performance.json',JSON.stringify({baseline,revision,method:'ABBA, 120 warmup + 240 measured frames per run; 24 enemies with fixture health/ammo to maintain load; cycles all four firearms and detonates four grenades; one core tick per rendered frame; 1920x1080; headless local Chrome; GPU timer queries',runs},null,2)+'\n')
 if(runs.some(r=>r.alive!==24||r.errors.length))throw Error('Invalid benchmark fixture')
 if(runs.filter(r=>r.mode==='baseline').some(r=>r.intercepted.length!==5))throw Error('Baseline interception incomplete')
}finally{await browser.close()}
