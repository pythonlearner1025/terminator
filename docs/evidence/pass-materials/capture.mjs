import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
const dir=new URL('./',import.meta.url), result={}
await mkdir(dir,{recursive:true})
const dev=JSON.parse(await readFile(new URL('../../../.kite3d/dev.json',dir),'utf8'))
if(new URL(dev.origin).port!=='4610') throw Error('Expected materials server 4610')
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const errors=[]
const safe=s=>String(s).replace(/\?t=[^\s"']+/g,'?t=[redacted]')
page.on('pageerror',e=>errors.push(safe(e.message)))
page.on('console',m=>{if(['warning','error'].includes(m.type()))errors.push(safe(m.text()))})
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${safe(r.url())}`)})
await page.route('**/materials-evidence',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#03070d}canvas{width:100%;height:100%;display:block}</style></head><body><canvas id="game"></canvas><script type="module">
const im=await fetch('/api/import-map').then(r=>r.json());const s=document.createElement('script');s.type='importmap';s.textContent=JSON.stringify(im);document.head.append(s);
const {createGame}=await import('@kite3d/engine');window.evidenceGame=await createGame({base:new URL('/files/',location.href).href,canvas:document.querySelector('canvas')});
</script></body></html>`}))
try {
 await page.context().request.get(dev.url)
 await page.goto(dev.origin+'/materials-evidence',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>window.terminator?.manager,undefined,{timeout:60000})
 await page.evaluate(()=>{const m=window.terminator.manager;m.ui.startMatch();m.ui.screens.show(null)})
 await page.waitForFunction(()=>window.terminator.manager.viewsStarted,undefined,{timeout:60000})
 await page.evaluate(()=>window.terminator.manager.mapView.ready)
 await page.waitForTimeout(1500)
 await page.evaluate(() => {
   const m=window.terminator.manager
   m.director.step = () => { m.world.tick++ }
 })
 for(const [name,pos,yaw,pitch] of [
   ['courtyard',[11,0,11],-2.25,-.035],
   ['facade',[-3,0,8],.25,.06],
   ['dock',[16,.0,1],1.9,.03],
   ['supplies',[-5,.1,21],-.78,-.17],
 ]) {
   await page.evaluate(({pos,yaw,pitch})=>{
     const m=window.terminator.manager
     Object.assign(m.world.player.pos,{x:pos[0],y:pos[1],z:pos[2]})
     m.input.yaw=yaw;m.input.pitch=pitch;m.input.cursorAnchorYaw=yaw
     m.world.player.yaw=yaw;m.world.player.pitch=pitch;m.syncViews()
   },{pos,yaw,pitch})
   await page.waitForTimeout(600)
   await capture(name+'.png')
 }
 result.scene=await page.evaluate(()=>{
   const m=window.terminator.manager, a=m.mapView.geometry.userData.mapVisualBounds
   return {bounds:a.filter(b=>b.min.some((v,i)=>v<b.center[i]-b.size[i]/2-.03)||b.max.some((v,i)=>v>b.center[i]+b.size[i]/2+.03)),
     renderer:window.viewer.renderManager.webglRenderer?.getContext().getParameter(7937),
     pipeline:window.viewer.renderManager.pipeline,
     textures:m.mapView.geometry.mapTextures.length}
 })
 if(result.scene.bounds.length)throw Error('Map geometry exceeds a collider')
 if(process.argv.includes('--benchmark')) {
   await page.evaluate(async()=>{
     const {World}=await import('/files/lib/core/world.js')
     const m=window.terminator.manager
     const target={x:11,y:1.65,z:11}
     const brain={tick(self,sense,act){act.stop();act.face(target);act.aimAt(target);act.fire()}}
     const w=new World({seed:2029,brains:{scout:brain,endo:brain,heavy:brain}})
     w.phase='wave';w.wave=5;w.tick=24*60
     Object.assign(w.player.pos,{x:11,y:0,z:11})
     w.player.yaw=-2.25;w.player.pitch=-.035
     w.mapState.hazards=[{slot:'courtyard_center',kind:'electric'},{slot:'dock_ramp',kind:'steam'}]
     for(let i=0;i<24;i++)w.spawnUnit(['scout','endo','heavy'][i%3],{x:-14+(i%6)*3.4,y:0,z:-18+Math.floor(i/6)*4.4})
     m.unitView.stop();m.world=w;m.unitView.start(w)
     m.director.step=inputs=>{w.player.hp=100;w.player.armor=100;w.step(inputs)}
     m.input.yaw=-2.25;m.input.pitch=-.035;m.input.cursorAnchorYaw=-2.25
     window.viewer.renderManager.renderScale=1
     m.mapView.refs.weather.settings.rain=1
     m.syncViews()
   })
   await page.waitForTimeout(4000)
   const perf=await page.evaluate(async()=>{
     const v=window.viewer,m=window.terminator.manager,renderer=v.renderManager.webglRenderer
     const gl=renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info')
     const intervals=[],cpu=[],draws=[],triangles=[],times=[]
     let last=performance.now(),start=last,pre=last
     let calls=0,tris=0
     const originalRender=renderer.render
     renderer.render=function(...args){const result=originalRender.apply(this,args);calls+=this.info.render.calls;tris+=this.info.render.triangles;return result}
     const before=()=>{calls=0;tris=0;pre=performance.now()}
     const after=()=>{
       const now=performance.now();intervals.push(now-last);cpu.push(now-pre);draws.push(calls);triangles.push(tris);last=now;times.push(now)
     }
     v.addEventListener('preRender',before);v.addEventListener('postRender',after)
     await new Promise(resolve=>setTimeout(resolve,12000))
     v.removeEventListener('preRender',before);v.removeEventListener('postRender',after);renderer.render=originalRender
     const summary=a=>{a=a.slice(2).sort((x,y)=>x-y);return{meanMs:a.reduce((x,y)=>x+y,0)/a.length,p50Ms:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1)}}
     return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),canvas:[v.canvas.width,v.canvas.height],renderScale:v.renderManager.renderScale,
       alive:m.world.aliveUnits.length,elapsedMs:performance.now()-start,frames:intervals.length,frame:summary(intervals),renderSubmission:summary(cpu),meanDrawCalls:draws.reduce((a,b)=>a+b,0)/draws.length,meanTriangles:triangles.reduce((a,b)=>a+b,0)/triangles.length,
       shots:m.world.eventLog.filter(e=>e.type==='shot').length,pipeline:v.renderManager.pipeline,weather:m.mapView.refs.weather.settings}
   })
   console.log(JSON.stringify({performance:perf},null,2))
   result.performance=perf
   if(perf.alive!==24 || perf.frames<100)throw Error('Invalid performance fixture')
   await capture('24-enemies.png')
   if(process.argv.includes('--profile')) {
     const diagnostic=await page.evaluate(async()=>{
       const m=window.terminator.manager,v=window.viewer
       const measure=async()=>{const a=[];let last=performance.now();const f=()=>{const now=performance.now();a.push(now-last);last=now};v.addEventListener('postRender',f);await new Promise(r=>setTimeout(r,3500));v.removeEventListener('postRender',f);return a.slice(2).reduce((x,y)=>x+y,0)/(a.length-2)}
       m.unitView.root.visible=false
       const mapOnly=await measure()
       m.unitView.root.visible=true
       m.mapView.root.visible=false
       const unitsOnly=await measure()
       m.mapView.root.visible=true
       m.mapView.post.bloom.enabled=false
       const noBloom=await measure()
       m.mapView.post.bloom.enabled=true
       return {mapOnly,unitsOnly,noBloom}
     })
     console.log({diagnostic})
   }
 }
 result.lifecycle=await page.evaluate(async()=>{
   const m=window.terminator.manager,v=window.viewer, view=m.mapView, before=view.saved
   const weather=view.refs.weather
   const cycle=Math.ceil(m.world.time/weather.settings.lightningIntervalSeconds)+1
   weather.sync(cycle*weather.settings.lightningIntervalSeconds,m.world.mapState)
   const flash=weather.lightning.intensity>0
   weather.sync(cycle*weather.settings.lightningIntervalSeconds+1/60,m.world.mapState)
   const oneFrame=weather.lightning.intensity===0
   weather.sync(0,{lights:{courtyard:'off',building:'off',dock:'off'}})
   const zoneOff=weather.shafts.every(s=>!s.beam.visible && s.light.intensity===0)
   m.stop()
   await new Promise(resolve=>{const done=()=>{v.removeEventListener('postRender',done);resolve()};v.addEventListener('postRender',done);v.setDirty()})
   const cleanupDetail={root:!v.scene.getObjectByName('Map Runtime'),post:!v.renderManager.pipeline.includes('map-bloom'),fog:v.scene.fog===before.fog,environment:v.scene.environment===before.environment,background:v.scene.background===before.background}
   const cleaned=!v.scene.getObjectByName('Map Runtime') && !v.renderManager.pipeline.includes('map-bloom') && v.scene.fog===before.fog && v.scene.environment===before.environment && v.scene.background===before.background
   const engine=await import('threepipe'), {default:generate}=await import('/files/generators/map.generator.js')
   const {RuntimeObjectOwner}=await import('@kite3d/engine')
   const light=await generate({params:{detail:'light'},engine,viewer:v})
   let lightMeshes=0;light.traverse(o=>{if(o.isMesh)lightMeshes++})
   const lightOwner=new RuntimeObjectOwner('material-light-preview-test')
   lightOwner.attachRuntimeRoot(light,v.scene,v.scene.modelRoot.getObjectByName('Map'));lightOwner.cleanup()
   const full=await generate({params:{detail:'full'},engine,viewer:v})
   let surfaceMaterials=0, missingMaps=0, invalidVertices=0
   const materials=new Set()
   full.traverse(o=>{
     if(o.material?.userData?.mapSurface)materials.add(o.material)
     const a=o.geometry?.attributes?.position?.array
     if(a)for(const value of a)if(!Number.isFinite(value))invalidVertices++
   })
   for(const material of materials){surfaceMaterials++;if(!material.map || !material.normalMap || !material.roughnessMap)missingMaps++}
   const owner=new RuntimeObjectOwner('material-full-preview-test')
   owner.attachRuntimeRoot(full,v.scene,v.scene.modelRoot.getObjectByName('Map'))
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Full preview render timed out')),30000);const done=()=>{clearTimeout(timer);v.removeEventListener('postRender',done);resolve()};v.addEventListener('postRender',done);v.renderEnabled=true;v.setDirty()})
   owner.cleanup()
   return {flash,oneFrame,zoneOff,cleaned,cleanupDetail,lightMeshes,surfaceMaterials,missingMaps,invalidVertices}
 })
 result.errors=errors
 await writeFile(new URL('results.json',dir),JSON.stringify(result,null,2)+'\n')
 console.log({lifecycle:result.lifecycle})
 if(!result.lifecycle.flash || !result.lifecycle.oneFrame || !result.lifecycle.zoneOff || !result.lifecycle.cleaned || result.lifecycle.lightMeshes!==3 || result.lifecycle.missingMaps || result.lifecycle.invalidVertices)throw Error('Map lifecycle validation failed')
 result.errors=errors
 await writeFile(new URL('results.json',dir),JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify({scene:result.scene,lifecycle:result.lifecycle,errors},null,2))
 if(errors.length)throw Error('Browser reported errors')
} catch(e) {console.log({errors});throw e} finally {await browser.close()}

async function capture(name) {
  // Freeze only rendering after a completed frame so screenshots do not compete with the GPU.
  await page.evaluate(()=>new Promise(resolve=>{
    const v=window.viewer, done=()=>{v.removeEventListener('postRender',done);v.renderEnabled=false;resolve()}
    v.addEventListener('postRender',done);v.setDirty()
  }))
  try { await page.screenshot({path:new URL(name,dir).pathname,timeout:60000}) }
  finally { await page.evaluate(()=>{window.viewer.renderEnabled=true;window.viewer.setDirty()}) }
}

